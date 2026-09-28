// ===== ตัวช่วยอ่านรหัสบาร์โค้ด / SKU =====
// ปัญหาหลัก: เครื่องสแกน USB/บลูทูธ "พิมพ์" รหัสผ่านคีย์บอร์ด ถ้าเครื่องค้างภาษาไทยอยู่
// รหัสจะออกมาเป็นอักษรไทย (แป้นเกษมณี) → แปลงกลับเป็นตัวอักษรบนแป้น US-QWERTY
//
// ตัวอย่างที่ต้องได้เสมอ:
//   normalizeScannedCode('คคถจตตต//จจๅึ') === '8850999220017'
//   normalizeScannedCode('ฆ็ณฑธขจจๅ')     === 'SHIRT-001'   (ข = ปุ่ม '-' ไม่กด shift)
//   normalizeScannedCode(' ABC-12\r\n')    === 'ABC-12'

// แป้นเกษมณี (มอก. 820-2538) — [ปุ่ม US ไม่กด shift, ปุ่ม US กด shift, ไทยไม่กด shift, ไทยกด shift]
// ไทยที่เป็น ASCII (เช่น '_' '/' '"') จะไม่อยู่ในตาราง THAI_TO_US แต่ไปอยู่ใน ASCII_TO_US แทน
const KEDMANEE: [string, string, string, string][] = [
  // แถวตัวเลข
  ['`', '~', '_', '%'],
  ['1', '!', 'ๅ', '+'],
  ['2', '@', '/', '๑'],
  ['3', '#', '-', '๒'],
  ['4', '$', 'ภ', '๓'],
  ['5', '%', 'ถ', '๔'],
  ['6', '^', 'ุ', 'ู'],
  ['7', '&', 'ึ', '฿'],
  ['8', '*', 'ค', '๕'],
  ['9', '(', 'ต', '๖'],
  ['0', ')', 'จ', '๗'],
  ['-', '_', 'ข', '๘'],
  ['=', '+', 'ช', '๙'],
  // แถว q
  ['q', 'Q', 'ๆ', '๐'],
  ['w', 'W', 'ไ', '"'],
  ['e', 'E', 'ำ', 'ฎ'],
  ['r', 'R', 'พ', 'ฑ'],
  ['t', 'T', 'ะ', 'ธ'],
  ['y', 'Y', 'ั', 'ํ'],
  ['u', 'U', 'ี', '๊'],
  ['i', 'I', 'ร', 'ณ'],
  ['o', 'O', 'น', 'ฯ'],
  ['p', 'P', 'ย', 'ญ'],
  ['[', '{', 'บ', 'ฐ'],
  [']', '}', 'ล', ','],
  ['\\', '|', 'ฃ', 'ฅ'],
  // แถว a
  ['a', 'A', 'ฟ', 'ฤ'],
  ['s', 'S', 'ห', 'ฆ'],
  ['d', 'D', 'ก', 'ฏ'],
  ['f', 'F', 'ด', 'โ'],
  ['g', 'G', 'เ', 'ฌ'],
  ['h', 'H', '้', '็'],
  ['j', 'J', '่', '๋'],
  ['k', 'K', 'า', 'ษ'],
  ['l', 'L', 'ส', 'ศ'],
  [';', ':', 'ว', 'ซ'],
  ["'", '"', 'ง', '.'],
  // แถว z
  ['z', 'Z', 'ผ', '('],
  ['x', 'X', 'ป', ')'],
  ['c', 'C', 'แ', 'ฉ'],
  ['v', 'V', 'อ', 'ฮ'],
  ['b', 'B', 'ิ', 'ฺ'],
  ['n', 'N', 'ื', '์'],
  ['m', 'M', 'ท', '?'],
  [',', '<', 'ม', 'ฒ'],
  ['.', '>', 'ใ', 'ฬ'],
  ['/', '?', 'ฝ', 'ฦ'],
]

const THAI_RE = /[฀-๿]/

// อักษรไทย -> ตัวอักษร US  |  ASCII ที่แป้นไทยพิมพ์ออกมา -> ตัวอักษร US
const THAI_TO_US: Record<string, string> = {}
const ASCII_TO_US: Record<string, string> = {}

for (let i = 0; i < KEDMANEE.length; i++) {
  const [us, usShift, th, thShift] = KEDMANEE[i]
  if (THAI_RE.test(th)) THAI_TO_US[th] = us
  else ASCII_TO_US[th] = us
  if (THAI_RE.test(thShift)) THAI_TO_US[thShift] = usShift
  else ASCII_TO_US[thShift] = usShift
}

function hasThai(s: string): boolean {
  return THAI_RE.test(s)
}

// ตัด CR/LF/TAB (และอักขระควบคุมอื่นที่เครื่องสแกนอาจแนบมา) แล้ว trim
function cleanRaw(raw: string): string {
  return String(raw ?? '').replace(/[\x00-\x1F\x7F]/g, '').trim()
}

// แปลงเต็มรูปแบบ: อักษรไทย + ASCII ที่แป้นไทยพิมพ์ออกมา (ใช้เมื่อมีอักษรไทยอย่างน้อย 1 ตัว)
function convertFull(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i)
    if (Object.prototype.hasOwnProperty.call(THAI_TO_US, ch)) out += THAI_TO_US[ch]
    else if (Object.prototype.hasOwnProperty.call(ASCII_TO_US, ch)) out += ASCII_TO_US[ch]
    else out += ch
  }
  return out
}

// แปลงเฉพาะอักษรไทย ปล่อย ASCII ไว้ตามเดิม (เครื่องสแกนบางรุ่นส่งตัวเลข/สัญลักษณ์แบบไม่ขึ้นกับภาษา)
function convertThaiOnly(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i)
    out += Object.prototype.hasOwnProperty.call(THAI_TO_US, ch) ? THAI_TO_US[ch] : ch
  }
  return out
}

/** ทำความสะอาดรหัสที่สแกนได้ — ถ้ามีอักษรไทย (คีย์บอร์ดค้างภาษาไทย) จะแปลงกลับเป็นแป้น US */
export function normalizeScannedCode(raw: string): string {
  const s = cleanRaw(raw)
  if (!s) return ''
  return hasThai(s) ? convertFull(s).trim() : s
}

/** รหัสที่เป็นไปได้ทั้งหมด (ไม่ซ้ำ ไม่ว่าง): ค่าเดิม, แปลงเต็ม, แปลงเฉพาะอักษรไทย */
export function codeCandidates(raw: string): string[] {
  const s = cleanRaw(raw)
  const list: string[] = [s]
  if (hasThai(s)) {
    list.push(convertFull(s).trim())
    list.push(convertThaiOnly(s).trim())
  }
  const out: string[] = []
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    if (c && out.indexOf(c) === -1) out.push(c)
  }
  return out
}

/** เทียบรหัสแบบไม่สนตัวพิมพ์เล็ก/ใหญ่ และช่องว่างหัวท้าย (ต้องไม่ว่างทั้งคู่) */
export function sameCode(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false
  const x = String(a).trim().toLowerCase()
  const y = String(b).trim().toLowerCase()
  return x !== '' && x === y
}

/** หาสินค้าจากรหัสที่สแกน — เทียบบาร์โค้ดก่อน (ทุกรหัสที่เป็นไปได้) แล้วค่อยเทียบ SKU */
export function findByCode<T extends { sku: string; barcode?: string | null }>(items: T[], raw: string): T | undefined {
  const candidates = codeCandidates(raw)
  if (candidates.length === 0) return undefined
  for (let c = 0; c < candidates.length; c++) {
    for (let i = 0; i < items.length; i++) {
      if (sameCode(items[i].barcode, candidates[c])) return items[i]
    }
  }
  for (let c = 0; c < candidates.length; c++) {
    for (let i = 0; i < items.length; i++) {
      if (sameCode(items[i].sku, candidates[c])) return items[i]
    }
  }
  return undefined
}

/** ตัวอักษร ASCII ที่พิมพ์ได้ล้วน (ใช้ตรวจว่ารหัสพิมพ์เป็นบาร์โค้ด CODE128 ได้) */
export function isPrintableAscii(s: string): boolean {
  return /^[\x20-\x7E]+$/.test(s)
}
