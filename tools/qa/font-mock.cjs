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
// ไฟล์ฟอนต์จริง: IBM Plex Sans Thai โหลดแบบออฟไลน์ไม่ได้ จึงใช้ฟอนต์ไทยที่มีในเครื่องแทน (Windows: Leelawadee UI)
//   ภาพหน้าจอ QA จึงออกมาใกล้เคียงของจริง ; ไม่มีไฟล์ในเครื่อง (Linux/macOS) → ใช้บัฟเฟอร์หลอก เบราว์เซอร์ใช้ฟอนต์สำรองแทน
//   ตั้งเองได้ด้วย FONT_MOCK_REGULAR / FONT_MOCK_BOLD = path ไฟล์ .ttf/.otf/.woff/.woff2 (path ต้องขึ้นต้นด้วย '/' หรือเป็น C:/...)
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

// ช่วงอักขระแบบเดียวกับที่ Google ส่งมา (คอมเมนต์ /* subset */ เหนือ @font-face ใช้เลือกไฟล์ที่ preload)
const RANGES = {
  thai: 'U+02D7, U+0303, U+0331, U+0E01-0E5B, U+200C-200D, U+25CC',
  'latin-ext': 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  latin: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
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

function cssFor(url) {
  const fams = parseFamilies(url)
  if (fams.length === 0) return undefined
  const subsets = /Thai/i.test(url) ? ['thai', 'latin-ext', 'latin'] : ['latin-ext', 'latin']
  const blocks = []
  for (const f of fams) {
    for (const e of f.entries) {
      const file = fileFor(f.name, e.weight.split(' ')[0])
      for (const s of subsets) {
        blocks.push(
          `/* ${s} */\n@font-face {\n  font-family: '${f.name}';\n  font-style: ${e.style};\n  font-weight: ${e.weight};\n` +
          `  font-display: ${f.display};\n  src: url(${file}) format('${formatOf(file)}');\n  unicode-range: ${RANGES[s]};\n}\n`,
        )
      }
    }
  }
  return blocks.join('')
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
