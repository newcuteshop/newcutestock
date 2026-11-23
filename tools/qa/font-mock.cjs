// ฟอนต์ Google จำลองสำหรับ `next build` แบบไม่ใช้เน็ต (เครื่องทดสอบ / QA)
//
// วิธีใช้: ตั้ง NEXT_FONT_GOOGLE_MOCKED_RESPONSES=<path เต็มของไฟล์นี้> ตอน build
//   next/font (node_modules/next/dist/compiled/@next/font/dist/google/fetch-css-from-google-fonts.js)
//   จะ require ไฟล์นี้แล้วอ่าน mockFile[url] แทนการดึง CSS จาก fonts.googleapis.com
//   และ fetch-font-file.js: url ที่ขึ้นต้นด้วย '/' = อ่านไฟล์จากดิสก์ ; อื่นๆ = บัฟเฟอร์หลอก (ไม่ต่อเน็ต)
//
// ทำไมเป็น Proxy: URL ของ Google Fonts ขึ้นกับน้ำหนัก/แกนที่ app/layout.tsx ขอ — ถ้าวันหลังเปลี่ยน weight หรือเพิ่มฟอนต์
//   ไฟล์นี้ยังตอบได้ทุก URL โดยไม่ต้องแก้ (สร้าง @font-face ตามชื่อฟอนต์และน้ำหนักใน URL เอง)
//
// ---- ทางที่ 1: ไฟล์ฟอนต์จริงของ Google (แนะนำ — ภาพ QA ใช้ฟอนต์จริง จึงเห็นตัวอักษรล้น/ตัดบรรทัดตามของจริง) ----
//   โฟลเดอร์ฟอนต์ = FONT_MOCK_DIR (ถ้าตั้ง) ไม่งั้น tools/qa/fonts/ (อยู่ใน .gitignore — ห้าม commit ไฟล์ฟอนต์)
//   โครงสร้าง: <dir>/<ชื่อฟอนต์ตัวเล็กคั่นด้วย -> /google.css + ไฟล์ .woff2 ทุกไฟล์ที่ CSS นั้นอ้าง (ชื่อไฟล์เดิมจาก fonts.gstatic.com)
//     เช่น <dir>/prompt/google.css · <dir>/ibm-plex-sans-thai/google.css (ชุด "ก่อนแก้" ของ regression ยังใช้ IBM Plex Sans Thai)
//   google.css = CSS ที่ดึงจาก https://fonts.googleapis.com/css2?family=<ชื่อ>:wght@<ทุกน้ำหนักที่ใช้>&display=swap
//     ด้วย user-agent เดียวกับ next (Chrome/104 บน Mac — ได้ไฟล์ woff2) · วิธีดึงอยู่ใน tools/qa/README.md
//   mock ตอบด้วย @font-face ของ Google ตัวจริง (ชุดอักษร/ช่วงอักขระเดียวกับเว็บจริง) แต่ชี้ url ไปไฟล์ในเครื่อง
//   เลือกเฉพาะ block ที่ตรงน้ำหนัก/style ที่ layout ขอ · ขาดน้ำหนักไหนหรือไฟล์ไหน → ฟอนต์นั้นทั้งตัวใช้ทางที่ 2
//   (ถ้าตั้ง FONT_MOCK_DIR เองแล้วใช้ไม่ได้ จะเขียนเตือนหนึ่งบรรทัดลง stderr ของ build — ภาพจะไม่ใช่ฟอนต์จริง)
//
// ---- ทางที่ 2 (เดิม): ฟอนต์ไทยที่มีในเครื่องแทน (Windows: Leelawadee UI) ----
//   ภาพหน้าจอ QA ออกมาใกล้เคียงของจริง แต่ความกว้างตัวอักษรไม่ตรง (ซ่อนปัญหาล้นได้) ; ไม่มีไฟล์ในเครื่อง (Linux/macOS) → บัฟเฟอร์หลอก
//   ตั้งเองได้ด้วย FONT_MOCK_REGULAR / FONT_MOCK_BOLD = path ไฟล์ .ttf/.otf/.woff/.woff2 (path ต้องขึ้นต้นด้วย '/' หรือเป็น C:/...)
//   ชุดอักษร (subset) อ่านจากข้อมูลฟอนต์ของ next เอง — ฟอนต์ไทยที่ชื่อไม่มีคำว่า Thai (เช่น Prompt) ก็ได้ block ไทย
'use strict'

const fs = require('fs')
const path = require('path')

// next อ่านไฟล์จากดิสก์เฉพาะ url ที่ขึ้นต้นด้วย '/' → บน Windows ตัดอักษรไดรฟ์ออก ('/Windows/Fonts/x.ttf' = ไดรฟ์ปัจจุบัน)
function diskUrl(p) {
  if (!p) return null
  const abs = path.resolve(p)
  if (!fs.existsSync(abs)) return null
  const noDrive = abs.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
  // ไดรฟ์ของไฟล์ต้องตรงกับไดรฟ์ที่รัน build (path แบบไม่มีไดรฟ์อ้างไดรฟ์ปัจจุบัน)
  if (!fs.existsSync(path.resolve(noDrive))) return null
  return /\.(woff2?|ttf|otf|eot)$/.test(noDrive) ? noDrive : null
}

function firstExisting(list) {
  for (const p of list) {
    const u = diskUrl(p)
    if (u) return u
  }
  return null
}

const WIN = process.env.SystemRoot || process.env.windir || 'C:/Windows'
const REGULAR = firstExisting([
  process.env.FONT_MOCK_REGULAR,
  path.join(WIN, 'Fonts', 'LeelawUI.ttf'),
  path.join(WIN, 'Fonts', 'tahoma.ttf'),
  '/usr/share/fonts/truetype/tlwg/Loma.ttf',
  '/System/Library/Fonts/Supplemental/Thonburi.ttf',
])
const BOLD = firstExisting([
  process.env.FONT_MOCK_BOLD,
  path.join(WIN, 'Fonts', 'LeelaUIb.ttf'),
  path.join(WIN, 'Fonts', 'tahomabd.ttf'),
  '/usr/share/fonts/truetype/tlwg/Loma-Bold.ttf',
]) || REGULAR

// โฟลเดอร์ไฟล์ฟอนต์จริง (ทางที่ 1)
const REAL_DIR_SET = Boolean(process.env.FONT_MOCK_DIR)
const REAL_DIR = path.resolve(process.env.FONT_MOCK_DIR || path.join(__dirname, 'fonts'))

// ช่วงอักขระแบบเดียวกับที่ Google ส่งมา (คอมเมนต์ /* subset */ เหนือ @font-face ใช้เลือกไฟล์ที่ preload)
const RANGES = {
  thai: 'U+02D7, U+0303, U+0331, U+0E01-0E5B, U+200C-200D, U+25CC',
  'latin-ext': 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  latin: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
}

// ชุดอักษรของแต่ละฟอนต์จากข้อมูลที่มากับ next (ชุดเดียวกับที่ next ใช้ตรวจ subsets ใน layout)
let FONT_DATA = null
try {
  FONT_DATA = require('next/dist/compiled/@next/font/dist/google/font-data.json')
} catch {
  FONT_DATA = null
}

function subsetsFor(name, url) {
  const known = FONT_DATA && FONT_DATA[name] && Array.isArray(FONT_DATA[name].subsets) ? FONT_DATA[name].subsets : null
  // ลำดับเดิม: ไทย → latin-ext → latin (เฉพาะชุดที่มีช่วงอักขระใน RANGES)
  if (known) return Object.keys(RANGES).filter(s => known.includes(s))
  return /Thai/i.test(url) ? ['thai', 'latin-ext', 'latin'] : ['latin-ext', 'latin']
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function fileFor(family, weight) {
  const disk = Number(weight) >= 600 ? BOLD : REGULAR
  // ไม่มีไฟล์ในเครื่อง → URL หลอก (ไม่ขึ้นต้นด้วย '/') next จะใช้ Buffer.from(url) ไม่ต่อเน็ต
  return disk || `https://fonts.mock.invalid/${slug(family)}-${weight}.woff2`
}

function formatOf(url) {
  const ext = /\.([a-z0-9]+)$/.exec(url)
  const map = { ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2', eot: 'embedded-opentype' }
  return map[ext ? ext[1] : 'woff2'] || 'woff2'
}

// family=IBM+Plex+Sans+Thai:wght@400;500;600;700  |  family=Inter:ital,wght@0,400;1,700  |  family=Roboto
function parseFamilies(url) {
  const out = []
  let q
  try { q = new URL(url).searchParams } catch { return out }
  for (const fam of q.getAll('family')) {
    const [name, axesPart] = fam.split(':')
    const entries = []
    if (axesPart && axesPart.includes('@')) {
      const [axesNames, values] = axesPart.split('@')
      const names = axesNames.split(',')
      for (const tuple of values.split(';')) {
        const vals = tuple.split(',')
        const e = { style: 'normal', weight: '400' }
        names.forEach((n, i) => {
          if (n === 'ital') e.style = vals[i] === '1' ? 'italic' : 'normal'
          else if (n === 'wght') e.weight = vals[i].replace('..', ' ')
        })
        entries.push(e)
      }
    } else {
      entries.push({ style: 'normal', weight: '400' })
    }
    out.push({ name: name.replace(/\+/g, ' '), entries, display: q.get('display') || 'swap' })
  }
  return out
}

// ---- ทางที่ 1: CSS ของ Google ตัวจริง + ไฟล์ในเครื่อง ----
// คืนชุด @font-face ของฟอนต์นี้ (ชี้ไฟล์ในเครื่อง) หรือ null = ใช้ไม่ได้ (ไม่มีโฟลเดอร์/ขาดน้ำหนัก/ขาดไฟล์)
function realCssFor(f) {
  const dir = path.join(REAL_DIR, slug(f.name))
  const cssPath = path.join(dir, 'google.css')
  if (!fs.existsSync(cssPath)) return null
  const css = fs.readFileSync(cssPath, 'utf8')
  // แต่ละ block = คอมเมนต์ชุดอักษร /* thai */ + @font-face { ... } (รูปแบบที่ Google ส่งมา)
  const blocks = css.match(/\/\*\s*[\w-]+\s*\*\/\s*@font-face\s*\{[^}]*\}/g) || []
  const parsed = blocks.map(b => ({
    text: b,
    family: (/font-family:\s*'([^']+)'/.exec(b) || [])[1],
    style: (/font-style:\s*([\w-]+)/.exec(b) || [])[1] || 'normal',
    weight: ((/font-weight:\s*([\d ]+)/.exec(b) || [])[1] || '400').trim(),
    url: (/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(b) || [])[1],
  }))
  const out = []
  for (const e of f.entries) {
    const hits = parsed.filter(p => p.family === f.name && p.style === e.style && p.weight === e.weight)
    if (hits.length === 0) return null
    for (const h of hits) {
      if (!h.url) return null
      const local = diskUrl(path.join(dir, path.basename(new URL(h.url).pathname)))
      if (!local) return null
      out.push(
        h.text
          .replace(h.url, () => local)
          .replace(/font-display:\s*[\w-]+/, () => `font-display: ${f.display}`) + '\n',
      )
    }
  }
  return out.join('')
}

const warned = new Set()
function warnOnce(name) {
  if (!REAL_DIR_SET || warned.has(name)) return
  warned.add(name)
  process.stderr.write(`[font-mock] ไม่มีไฟล์ฟอนต์จริงครบสำหรับ "${name}" ใน ${REAL_DIR} — ใช้ฟอนต์แทนในเครื่อง (ภาพ QA ไม่ใช่ฟอนต์จริง)\n`)
}

// ---- ทางที่ 2: @font-face สร้างเอง ชี้ฟอนต์ไทยในเครื่อง ----
function fallbackCssFor(f, url) {
  const subsets = subsetsFor(f.name, url)
  const blocks = []
  for (const e of f.entries) {
    const file = fileFor(f.name, e.weight.split(' ')[0])
    for (const s of subsets) {
      blocks.push(
        `/* ${s} */\n@font-face {\n  font-family: '${f.name}';\n  font-style: ${e.style};\n  font-weight: ${e.weight};\n` +
        `  font-display: ${f.display};\n  src: url(${file}) format('${formatOf(file)}');\n  unicode-range: ${RANGES[s]};\n}\n`,
      )
    }
  }
  return blocks.join('')
}

function cssFor(url) {
  const fams = parseFamilies(url)
  if (fams.length === 0) return undefined
  const parts = []
  for (const f of fams) {
    let real = null
    try { real = realCssFor(f) } catch { real = null }
    if (real) {
      parts.push(real)
    } else {
      warnOnce(f.name)
      parts.push(fallbackCssFor(f, url))
    }
  }
  return parts.join('')
}

module.exports = new Proxy({}, {
  get(_target, key) {
    if (typeof key !== 'string') return undefined
    if (!/^https:\/\/fonts\.googleapis\.com\/css2?\?/.test(key)) return undefined
    return cssFor(key)
  },
  has(_target, key) {
    return typeof key === 'string' && /^https:\/\/fonts\.googleapis\.com\/css2?\?/.test(key)
  },
})
