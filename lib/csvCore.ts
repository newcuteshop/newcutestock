// ===== อ่าน/เขียน CSV (เปิดด้วย Excel ได้) — ใช้ได้ทั้ง server และ browser (ไม่มี import ฝั่งเซิร์ฟเวอร์) =====
// - อ่าน: RFC 4180 (ช่องในเครื่องหมายคำพูด, "" = " , ขึ้นบรรทัดใหม่ในช่อง), ตัด BOM, รับ CRLF/LF/CR
//         Excel บางภาษา (ยุโรป) บันทึกคั่นด้วย ; และไฟล์ที่คัดลอกจากตารางคั่นด้วยแท็บ → เดาตัวคั่นจากแถวหัวตาราง
// - เขียน: CRLF, ใส่ BOM ให้ Excel อ่านภาษาไทยถูก, กันสูตร Excel ในช่องข้อความ (CSV injection)
//          ตัวเลขเขียนตรงๆ จุดทศนิยม '.' ไม่มีคอมมาคั่นหลักพัน (Excel แปลงเป็นตัวเลขได้)
import { bangkokTodayKey, isDayKey } from '@/lib/format'

export type CsvDelimiter = ',' | ';' | '\t'
/** ช่องรหัสที่ต้องให้ Excel เก็บเป็นข้อความเสมอ — สร้างด้วย excelTextCell() */
export interface CsvTextCell {
  readonly excelText: string
}
/** ค่าหนึ่งช่องตอนเขียน: ข้อความ (กันสูตรให้อัตโนมัติ) / ตัวเลข (เขียนตรง) / true-false / ว่าง / รหัสข้อความสำหรับ Excel */
export type CsvCell = string | number | boolean | null | undefined | CsvTextCell
export type CsvRow = readonly CsvCell[]
/** แถวที่อ่านได้ + เลขบรรทัดในไฟล์ (เริ่ม 1 = บรรทัดหัวตาราง) ที่แถวนั้นเริ่ม — ใช้บอกผู้ใช้ว่า "บรรทัดที่ x ผิด" */
export interface CsvRecord {
  line: number
  cells: string[]
}

/**
 * เดาตัวคั่นจากแถวแรกของไฟล์ (นับเฉพาะนอกเครื่องหมายคำพูด):
 * มี , อย่างน้อย 1 ตัว → ',' ; ไม่มี , แต่มี ; หรือแท็บ → ตัวที่มากกว่า (เท่ากัน = แท็บ) ; ไม่มีสักตัว → ','
 */
export function detectCsvDelimiter(text: string): CsvDelimiter {
  let s = String(text ?? '')
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  let comma = 0
  let semi = 0
  let tab = 0
  let inQuotes = false
  let seenContent = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') i++
        else inQuotes = false
      }
      continue
    }
    if (ch === '"') { inQuotes = true; seenContent = true; continue }
    if (ch === '\r' || ch === '\n') {
      // ข้ามบรรทัดว่างหัวไฟล์ — แถวหัวตาราง = บรรทัดแรกที่มีตัวอักษร (ล้างตัวนับของบรรทัดว่างก่อนหน้า)
      if (seenContent) break
      comma = 0
      semi = 0
      tab = 0
      continue
    }
    if (ch === ',') comma++
    else if (ch === ';') semi++
    else if (ch === '\t') tab++
    else if (ch.trim() !== '') seenContent = true
  }
  if (comma > 0) return ','
  if (semi === 0 && tab === 0) return ','
  return tab >= semi ? '\t' : ';'
}

/**
 * แยก CSV เป็นแถวพร้อมเลขบรรทัด — ตัดแถวที่ว่างทุกช่องทิ้ง (เช่น ,,,, ท้ายไฟล์จาก Excel)
 * delimiter ไม่ส่ง = เดาจากแถวหัวตาราง (detectCsvDelimiter)
 * ค่าในช่องเป็นข้อความดิบ (ไม่ trim) — ผู้เรียก trim/แปลงเอง และใช้ unguardCell ถ้าไฟล์มาจาก toCsv ของเราเอง
 */
export function parseCsvRecords(text: string, opts: { delimiter?: CsvDelimiter } = {}): CsvRecord[] {
  let s = String(text ?? '')
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  const delimiter = opts.delimiter ?? detectCsvDelimiter(s)
  const out: CsvRecord[] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let line = 1        // บรรทัดปัจจุบันในไฟล์
  let rowStart = 1    // บรรทัดที่แถวนี้เริ่ม
  let rowHasData = false // แถวนี้มีอะไรเลยไหม (แยกบรรทัดว่างล้วนออกจากแถวสุดท้ายที่ไม่มีขึ้นบรรทัด)

  const pushField = () => { row.push(field); field = '' }
  const pushRow = () => {
    pushField()
    if (row.some(c => c.trim() !== '')) out.push({ line: rowStart, cells: row })
    row = []
    rowHasData = false
  }

  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false
        i++
        continue
      }
      // ขึ้นบรรทัดใหม่ภายในช่อง: เก็บเป็น \n และนับบรรทัดต่อ (CRLF นับเป็น 1 บรรทัด)
      if (ch === '\r') {
        field += '\n'
        line++
        i += s[i + 1] === '\n' ? 2 : 1
        continue
      }
      if (ch === '\n') { field += '\n'; line++; i++; continue }
      field += ch
      i++
      continue
    }
    // เครื่องหมายคำพูดเปิดช่องได้เฉพาะตอนต้นช่อง (กลางช่อง = ตัวอักษรธรรมดา แบบเดียวกับ Excel)
    if (ch === '"' && field === '') { inQuotes = true; rowHasData = true; i++; continue }
    if (ch === delimiter) { pushField(); rowHasData = true; i++; continue }
    if (ch === '\r' || ch === '\n') {
      pushRow()
      i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1
      line++
      rowStart = line
      continue
    }
    field += ch
    rowHasData = true
    i++
  }
  if (rowHasData || field !== '' || row.length > 0) pushRow()
  return out
}

/** แยก CSV เป็นตาราง string[][] (ตัดแถวว่างล้วน, เดาตัวคั่นจากแถวหัวตาราง) — ต้องการเลขบรรทัดใช้ parseCsvRecords */
export function parseCsv(text: string, opts: { delimiter?: CsvDelimiter } = {}): string[][] {
  return parseCsvRecords(text, opts).map(r => r.cells)
}

// ข้อความที่ Excel จะตีความเป็นสูตร (รวมตัวเต็มความกว้าง ＝＋－＠ ที่ Excel บางภาษารับเป็นสูตรด้วย)
const FORMULA_START_RE = /^[=+\-@\t\r＝＋－＠]/
// ตัวเลขล้วน ('-50', '+3', '1.25') ไม่มีทางเป็นสูตรอันตราย → ไม่ต้องกัน (Excel ยังอ่านเป็นตัวเลขได้)
const PLAIN_NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/

/** กันสูตร Excel ในช่องข้อความ: ขึ้นต้นด้วย = + - @ แท็บ หรือ CR → เติม ' ข้างหน้า (ตัวเลขล้วนไม่เติม) */
export function safeCell(v: string | null | undefined): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (!FORMULA_START_RE.test(s) || PLAIN_NUMBER_RE.test(s)) return s
  return "'" + s
}

// ="ข้อความ" ที่ excelTextCell เขียนไว้ ("" ข้างใน = ")
const EXCEL_TEXT_RE = /^="((?:[^"]|"")*)"$/

/**
 * รหัส (SKU/บาร์โค้ด) ที่ Excel ชอบแปลงเองตอนเปิด CSV: เลขยาว → 8.85E+12, ตัด 0 ข้างหน้า, '1-2' / 'SEP-01' → วันที่
 * แล้วบันทึกกลับเป็นค่าที่แปลงแล้ว = รหัสเสีย → เขียนเป็นสูตร ="รหัส" ให้ Excel/Google Sheets เก็บเป็นข้อความ
 * (เปิดแล้วเห็นรหัสเดิม บันทึกกลับเป็น CSV ได้ข้อความเดิม) ; ไฟล์ที่ยังเป็น ="..." อยู่ unguardCell แกะกลับให้
 */
export function excelTextCell(v: string | null | undefined): CsvTextCell | string {
  const s = v === null || v === undefined ? '' : String(v)
  return s === '' ? '' : { excelText: s }
}

// ข้อความในสูตรปลอดภัย: อยู่ในเครื่องหมายคำพูดของสตริงล้วน (" ข้างในเบิ้ลเป็น "") — ไม่มีทางหลุดเป็นสูตรอื่น
// สูตร Excel รับสตริงได้ไม่เกิน 255 ตัวและห้ามขึ้นบรรทัด → เกินนั้นเขียนเป็นข้อความธรรมดา (กันสูตรตามปกติ)
function excelTextFormula(text: string): string {
  const t = String(text ?? '')
  if (t === '') return ''
  if (t.length > 255 || /[\r\n]/.test(t)) return safeCell(t)
  return '="' + t.replace(/"/g, '""') + '"'
}

/**
 * กลับด้านของ safeCell / excelTextCell (ใช้ตอนนำเข้าไฟล์ที่ส่งออกจากระบบนี้):
 * ' ที่เราเติมกันสูตรไว้ (ตามด้วย = + - @ ...) → ตัดออก ; ="รหัส" → รหัส ; ค่าอื่นคืนเดิม
 */
export function unguardCell(v: string): string {
  const s = String(v ?? '')
  const m = EXCEL_TEXT_RE.exec(s)
  if (m) return m[1].replace(/""/g, '"')
  return s.length > 1 && s[0] === "'" && FORMULA_START_RE.test(s.slice(1)) ? s.slice(1) : s
}

function formatNumberCell(n: number): string {
  if (!Number.isFinite(n)) return ''
  if (Object.is(n, -0)) return '0'
  // เลขทั่วไป String() ได้รูปธรรมดา ('1234.5'); ค่าเล็ก/ใหญ่มากจะเป็นรูปยกกำลัง → ขยายเป็นทศนิยมธรรมดา
  const s = String(n)
  if (!/e/i.test(s)) return s
  if (Number.isInteger(n)) return BigInt(n).toString()
  const fixed = n.toFixed(Math.abs(n) < 1 ? 10 : 0)
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
}

function encodeCell(v: CsvCell, delimiter: CsvDelimiter): string {
  let s: string
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') s = formatNumberCell(v)
  else if (typeof v === 'boolean') s = v ? 'TRUE' : 'FALSE'
  else if (typeof v === 'object') s = excelTextFormula(v.excelText)
  else s = safeCell(v)
  if (delimiter === '\t') return s.replace(/[\t\r\n]+/g, ' ')
  // ใส่เครื่องหมายคำพูดเมื่อมี " ตัวคั่น (ทั้ง , และ ; เผื่อเปิดใน Excel ที่ใช้ ;) ขึ้นบรรทัด หรือช่องว่างหัว/ท้าย
  if (/[",;\r\n]/.test(s) || /^\s|\s$/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

/** ตาราง → ข้อความ CSV (CRLF ทุกแถวรวมแถวสุดท้าย) ; bom: true = ขึ้นต้นด้วย BOM ให้ Excel อ่านภาษาไทยถูก */
export function toCsv(rows: readonly CsvRow[], opts: { bom?: boolean; delimiter?: CsvDelimiter } = {}): string {
  const delimiter = opts.delimiter ?? ','
  let body = ''
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    const cells: string[] = []
    for (let c = 0; c < row.length; c++) cells.push(encodeCell(row[c], delimiter))
    body += cells.join(delimiter) + '\r\n'
  }
  return (opts.bom ? '﻿' : '') + body
}

/** ชื่อไฟล์ที่ปลอดภัยทุกระบบ: เหลือเฉพาะ A-Z a-z 0-9 . _ - (อย่างอื่นกลายเป็น -) ยาวไม่เกิน 120 และลงท้าย .csv */
function safeCsvFilename(name: string): string {
  let base = String(name ?? '').trim().replace(/\.csv$/i, '')
  base = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '')
  if (!base) base = 'newcute-export'
  return base.slice(0, 116) + '.csv'
}

/**
 * ดาวน์โหลดไฟล์ CSV ในเบราว์เซอร์ (ใส่ BOM ให้เสมอ) — rows เป็นตาราง หรือข้อความ CSV ที่สร้างไว้แล้วก็ได้
 * ต้องเรียกในฝั่ง client เท่านั้น (ไม่มี document บนเซิร์ฟเวอร์ → ไม่ทำอะไร)
 */
export function downloadCsv(filename: string, rows: readonly CsvRow[] | string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return
  let text = typeof rows === 'string' ? rows : toCsv(rows, { bom: true })
  if (text.charCodeAt(0) !== 0xfeff) text = '﻿' + text
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = safeCsvFilename(filename)
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // คืนหน่วยความจำหลังเบราว์เซอร์เริ่มดาวน์โหลดแล้ว (iOS ช้ากว่า → รอ 10 วินาที)
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/**
 * ชื่อไฟล์มาตรฐาน: 'newcute-<base>-YYYYMMDD[-YYYYMMDD].csv'
 * ไม่ส่ง fromKey = วันนี้ (เวลาไทย) ; toKey ว่าง/เท่ากับ fromKey = วันเดียว
 * เช่น csvFilename('sales', '2026-10-01', '2026-10-05') → 'newcute-sales-20261001-20261005.csv'
 */
export function csvFilename(base: string, fromKey?: string | null, toKey?: string | null): string {
  const tag = String(base ?? '').trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'export'
  const from = fromKey && isDayKey(fromKey) ? fromKey.trim() : bangkokTodayKey()
  const to = toKey && isDayKey(toKey) ? toKey.trim() : ''
  const compact = (k: string) => k.replace(/-/g, '')
  const range = to && to !== from ? `${compact(from)}-${compact(to)}` : compact(from)
  return `newcute-${tag}-${range}.csv`
}

/** ไฟล์น่าจะไม่ใช่ UTF-8 (ภาษาไทยจะเพี้ยน): มีอักขระแทนที่ U+FFFD ตั้งแต่ 3 ตัว หรือเกิน 1% ของข้อความ */
export function looksMisencoded(text: string): boolean {
  const s = String(text ?? '')
  if (!s) return false
  let bad = 0
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 0xfffd) bad++
  return bad >= 3 || (bad > 0 && bad / s.length > 0.01)
}
