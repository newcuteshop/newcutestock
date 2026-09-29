// ===== ตรวจไฟล์ CSV ออเดอร์ในเบราว์เซอร์ก่อนส่ง (แสดงตัวอย่าง + จุดผิด) =====
// กติกาเดียวกับ parseOrdersCsv ใน lib/integrations/csv.ts (ไฟล์นั้นเป็นฝั่งเซิร์ฟเวอร์ import ในหน้าเว็บไม่ได้)
// → แก้กติกาที่ไหน ต้องแก้ทั้ง 2 ที่ให้ตรงกัน ; เซิร์ฟเวอร์ตรวจซ้ำเองทุกครั้งอยู่แล้ว ไฟล์นี้มีไว้ให้เห็นปัญหาก่อนกดนำเข้า
// pure functions ล้วน
import { ORDER_STATUS_LABELS } from '@/lib/integrations/platforms'
import type { OrderStatus } from '@/lib/integrations/types'

export const CSV_MAX_BYTES = 1024 * 1024
export const CSV_MAX_ROWS = 2000
export const CSV_MAX_ORDERS = 500

export const ORDER_CSV_COLUMNS = ['order_id', 'sku', 'qty', 'unit_price', 'status', 'order_date', 'qty_cancelled'] as const
type Col = (typeof ORDER_CSV_COLUMNS)[number]

// ชื่อหัวคอลัมน์ที่รับได้ (ตรงกับ HEADER_ALIASES ฝั่งเซิร์ฟเวอร์)
const HEADER_ALIASES: Record<Col, string[]> = {
  order_id: ['order_id', 'orderid', 'order', 'order_no', 'order_number', 'order_sn', 'เลขออเดอร์', 'เลขที่ออเดอร์', 'หมายเลขคำสั่งซื้อ', 'คำสั่งซื้อ'],
  sku: ['sku', 'seller_sku', 'model_sku', 'รหัสสินค้า', 'รหัส sku'],
  qty: ['qty', 'quantity', 'จำนวน'],
  unit_price: ['unit_price', 'price', 'ราคา', 'ราคาต่อชิ้น'],
  status: ['status', 'order_status', 'สถานะ'],
  order_date: ['order_date', 'date', 'created_at', 'วันที่', 'วันที่สั่งซื้อ'],
  qty_cancelled: ['qty_cancelled', 'cancelled', 'cancelled_qty', 'ยกเลิก', 'จำนวนที่ยกเลิก'],
}
const REQUIRED: Col[] = ['order_id', 'sku', 'qty']

const CENTRAL: readonly OrderStatus[] = [
  'unpaid', 'paid', 'ready_to_ship', 'shipped', 'completed', 'cancel_pending',
  'cancelled', 'return_requested', 'returned', 'expired', 'unknown',
]

/** RFC 4180: ตัด BOM, รองรับ CRLF/LF, เครื่องหมายคำพูดครอบค่าที่มีจุลภาค/ขึ้นบรรทัดใหม่ ; ตัดบรรทัดว่างล้วน */
export function parseCsvText(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
      continue
    }
    if (ch === '"' && field === '') { inQuotes = true; continue }
    if (ch === ',') { row.push(field); field = ''; continue }
    if (ch === '\r') {
      if (src[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
      continue
    }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += ch
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''))
}

function normHeader(h: string): string {
  return h.replace(/^\ufeff/, '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function statusFrom(raw: string): OrderStatus | null {
  const t = raw.trim()
  if (!t) return 'completed'
  const low = t.toLowerCase().replace(/[\s-]+/g, '_')
  if ((CENTRAL as readonly string[]).includes(low)) return low as OrderStatus
  if (low === 'canceled') return 'cancelled'
  for (const [k, label] of Object.entries(ORDER_STATUS_LABELS)) if (label === t) return k as OrderStatus
  return null
}

function dateOk(raw: string): boolean {
  const t = raw.trim()
  if (!t) return true
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(t)) return !Number.isNaN(Date.parse(`${t}T00:00:00+07:00`))
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,9})?)?(Z|z|[+-][0-9]{2}(:?[0-9]{2})?)$/.test(t)) {
    return !Number.isNaN(Date.parse(t.replace(' ', 'T')))
  }
  return false
}

function intFrom(raw: string): number | null {
  const t = raw.trim().replace(/,/g, '')
  if (!/^[0-9]+$/.test(t)) return null
  const n = Number(t)
  return Number.isSafeInteger(n) ? n : null
}

function priceOk(raw: string): boolean {
  const t = raw.trim().replace(/,/g, '').replace(/^฿/, '')
  if (!t) return true
  return /^[0-9]+(\.[0-9]{1,2})?$/.test(t) && Number(t) <= 99999999.99
}

// ตัดช่องว่าง/อักขระล่องหนที่หัว-ท้าย แล้วทำตัวเล็ก (เหมือน normSku ฝั่งเซิร์ฟเวอร์)
const EDGE_JUNK = /^[\s\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]+|[\s\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]+$/g
function normSku(s: string): string {
  return s.normalize('NFC').replace(EDGE_JUNK, '').toLowerCase()
}

export interface PreviewRow {
  row: number            // เลขแถวในไฟล์ (หัวตาราง = แถว 1)
  order_id: string
  sku: string
  qty: string
  status: string
  order_date: string
  problem: string        // ว่าง = แถวนี้ผ่าน
}

export interface CsvPreview {
  fatal: string | null                 // ปัญหาทั้งไฟล์ (ส่งไม่ได้เลย)
  warnings: string[]
  rows: PreviewRow[]
  errors: { row: number; message: string }[]
  orders: number                       // ออเดอร์ที่จะนำเข้าได้ (ไม่มีแถวผิด)
  badOrders: number                    // ออเดอร์ที่มีแถวผิด → เซิร์ฟเวอร์ข้ามทั้งออเดอร์
  lines: number
  units: number
}

export function previewOrdersCsv(text: string, bytes: number): CsvPreview {
  const out: CsvPreview = { fatal: null, warnings: [], rows: [], errors: [], orders: 0, badOrders: 0, lines: 0, units: 0 }
  if (bytes > CSV_MAX_BYTES) { out.fatal = 'ไฟล์ใหญ่เกิน 1 MB — แบ่งเป็นหลายไฟล์'; return out }
  if (text.includes('\ufffd')) {
    out.warnings.push('ไฟล์อาจไม่ใช่ UTF-8 (ตัวอักษรไทยเพี้ยน) — ใน Excel ให้บันทึกเป็น "CSV UTF-8"')
  }
  const all = parseCsvText(text)
  if (all.length === 0) { out.fatal = 'ไฟล์ว่าง'; return out }
  // หัวตารางมีช่องเดียวแต่มีแท็บ/เซมิโคลอน = ไฟล์คั่นด้วยตัวอื่น
  if (all[0].length === 1 && /[\t;]/.test(all[0][0])) {
    out.fatal = 'ไฟล์ต้องคั่นคอลัมน์ด้วยจุลภาค (,) — ใน Excel ให้บันทึกเป็น "CSV UTF-8"'
    return out
  }
  if (all.length - 1 > CSV_MAX_ROWS) { out.fatal = `มี ${all.length - 1} แถว เกินครั้งละ ${CSV_MAX_ROWS} แถว — แบ่งเป็นหลายไฟล์`; return out }

  const header = all[0].map(normHeader)
  const idx: Partial<Record<Col, number>> = {}
  for (const c of ORDER_CSV_COLUMNS) {
    const i = header.findIndex(h => HEADER_ALIASES[c].includes(h))
    if (i >= 0) idx[c] = i
  }
  const missing = REQUIRED.filter(c => idx[c] === undefined)
  if (missing.length > 0) {
    out.fatal = `ไม่พบคอลัมน์ที่จำเป็น: ${missing.join(', ')} — แถวแรกต้องเป็นหัวตาราง (ดูไฟล์ตัวอย่าง)`
    return out
  }
  if (all.length === 1) { out.fatal = 'มีแต่หัวตาราง ไม่มีรายการออเดอร์'; return out }

  const cell = (r: string[], c: Col) => {
    const i = idx[c]
    return i === undefined ? '' : (r[i] ?? '').trim()
  }
  const orders = new Map<string, { status: OrderStatus | null; bad: boolean; lines: Map<string, number> }>()

  for (let k = 1; k < all.length; k++) {
    const r = all[k]
    if (r.every(c => c.trim() === '')) continue
    const rowNo = k + 1
    const pr: PreviewRow = {
      row: rowNo, order_id: cell(r, 'order_id'), sku: cell(r, 'sku'), qty: cell(r, 'qty'),
      status: cell(r, 'status'), order_date: cell(r, 'order_date'), problem: '',
    }
    out.rows.push(pr)
    const orderId = pr.order_id
    const fail = (message: string) => {
      pr.problem = message
      out.errors.push({ row: rowNo, message })
      if (orderId) {
        const acc = orders.get(orderId)
        if (acc) acc.bad = true
        else orders.set(orderId, { status: null, bad: true, lines: new Map() })
      }
    }
    if (!orderId) { fail('ไม่มีเลขออเดอร์'); continue }
    if (orderId.length > 100 || /[\x00-\x1f\x7f]/.test(orderId)) { fail('เลขออเดอร์ไม่ถูกต้อง'); continue }
    if (!pr.sku || !normSku(pr.sku)) { fail('ไม่มี SKU'); continue }
    if (pr.sku.length > 200) { fail('SKU ยาวเกิน 200 ตัวอักษร'); continue }
    const q = intFrom(pr.qty)
    if (q === null || q < 1 || q > 100000) { fail('จำนวนต้องเป็นจำนวนเต็ม 1 ขึ้นไป'); continue }
    const qcRaw = cell(r, 'qty_cancelled')
    const qc = qcRaw ? intFrom(qcRaw) : 0
    if (qc === null || qc > q) { fail('จำนวนที่ยกเลิกไม่ถูกต้อง'); continue }
    if (!priceOk(cell(r, 'unit_price'))) { fail('ราคาไม่ถูกต้อง'); continue }
    const status = statusFrom(pr.status)
    if (!status) { fail(`สถานะไม่รู้จัก: ${pr.status.slice(0, 30)}`); continue }
    if (!dateOk(pr.order_date)) { fail('วันที่ต้องเป็น YYYY-MM-DD หรือ ISO 8601 พร้อมโซนเวลา'); continue }

    let acc = orders.get(orderId)
    if (!acc) {
      acc = { status, bad: false, lines: new Map() }
      orders.set(orderId, acc)
    } else if (!acc.bad && acc.lines.size > 0 && acc.status !== status) {
      fail('สถานะของออเดอร์เดียวกันไม่ตรงกันในแต่ละแถว')
      continue
    }
    if (acc.lines.size === 0 && !acc.bad) acc.status = status
    const key = normSku(pr.sku)
    acc.lines.set(key, (acc.lines.get(key) ?? 0) + q)
  }

  if (orders.size > CSV_MAX_ORDERS) {
    out.fatal = `มี ${orders.size} ออเดอร์ เกินครั้งละ ${CSV_MAX_ORDERS} ออเดอร์ — แบ่งเป็นหลายไฟล์`
    return out
  }
  for (const acc of Array.from(orders.values())) {
    if (acc.bad || acc.lines.size === 0) { if (acc.bad) out.badOrders++; continue }
    if (acc.lines.size > 200) { out.badOrders++; continue }
    out.orders++
    out.lines += acc.lines.size
    acc.lines.forEach(n => { out.units += n })
  }
  return out
}

/** ไฟล์ตัวอย่าง (มี BOM ให้ Excel อ่านภาษาไทยถูก) */
export function sampleOrdersCsv(): string {
  return '\ufeff' + [
    ORDER_CSV_COLUMNS.join(','),
    'ORDER-0001,NC-A-M,2,390,completed,2026-09-29,0',
    'ORDER-0001,NC-A-L,1,390,completed,2026-09-29,0',
    'ORDER-0002,NC-B-S,1,450,paid,2026-09-29,',
  ].join('\r\n') + '\r\n'
}
