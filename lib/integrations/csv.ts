// lib/integrations/csv.ts — อ่าน/เขียน CSV (RFC 4180) + นำเข้า CSV ออเดอร์ + ส่งออก CSV สต๊อก (ฝั่งเซิร์ฟเวอร์)
import type { ExportStockRow, NormalizedOrder, NormalizedOrderLine, OrderStatus } from './types'
import { ORDER_STATUS_LABELS } from './platforms'
import { normSku } from './adapters/common'

/** แยก CSV เป็นแถว/ช่อง — ตัด BOM, รองรับ CRLF/LF, เครื่องหมายคำพูด "" ภายในช่อง, ขึ้นบรรทัดใหม่ในช่องที่มีคำพูด */
export function parseCsv(text: string): string[][] {
  let s = String(text ?? '')
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const pushField = () => { row.push(field); field = '' }
  const pushRow = () => { pushField(); rows.push(row); row = [] }
  while (i < s.length) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"' && field === '') { inQuotes = true; i++; continue }
    if (ch === ',') { pushField(); i++; continue }
    if (ch === '\r') {
      if (s[i + 1] === '\n') i++
      pushRow()
      i++
      continue
    }
    if (ch === '\n') { pushRow(); i++; continue }
    field += ch
    i++
  }
  if (field !== '' || row.length > 0) pushRow()
  // ตัดบรรทัดว่างล้วน
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''))
}

function csvCell(v: string | number | null, delimiter: string): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (delimiter === '\t') return s.replace(/[\t\r\n]+/g, ' ')
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

export function toCsv(rows: (string | number | null)[][], opts: { bom?: boolean; delimiter?: ',' | '\t' } = {}): string {
  const delimiter = opts.delimiter ?? ','
  const body = rows.map(r => r.map(c => csvCell(c, delimiter)).join(delimiter)).join('\r\n') + '\r\n'
  return (opts.bom ? '\uFEFF' : '') + body
}

// ---------------------------------------------------------------------------
// นำเข้า CSV ออเดอร์ (CONTRACT §3.9)
// ---------------------------------------------------------------------------
export const ORDERS_CSV_MAX_BYTES = 1024 * 1024
export const ORDERS_CSV_MAX_ROWS = 2000
export const ORDERS_CSV_MAX_ORDERS = 500

const HEADER_ALIASES: Record<string, string[]> = {
  order_id: ['order_id', 'orderid', 'order', 'order_no', 'order_number', 'order_sn', 'เลขออเดอร์', 'เลขที่ออเดอร์', 'หมายเลขคำสั่งซื้อ', 'คำสั่งซื้อ'],
  sku: ['sku', 'seller_sku', 'model_sku', 'รหัสสินค้า', 'รหัส sku'],
  qty: ['qty', 'quantity', 'จำนวน'],
  unit_price: ['unit_price', 'price', 'ราคา', 'ราคาต่อชิ้น'],
  status: ['status', 'order_status', 'สถานะ'],
  order_date: ['order_date', 'date', 'created_at', 'วันที่', 'วันที่สั่งซื้อ'],
  qty_cancelled: ['qty_cancelled', 'cancelled', 'cancelled_qty', 'ยกเลิก', 'จำนวนที่ยกเลิก'],
}

const CENTRAL: readonly OrderStatus[] = ['unpaid', 'paid', 'ready_to_ship', 'shipped', 'completed', 'cancel_pending', 'cancelled', 'return_requested', 'returned', 'expired', 'unknown']

function normHeader(h: string): string {
  return h.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/\s+/g, ' ')
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

function dateFrom(raw: string): string | null | undefined {
  const t = raw.trim()
  if (!t) return undefined
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(t)) {
    const iso = `${t}T00:00:00+07:00`
    return Number.isNaN(Date.parse(iso)) ? null : iso
  }
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,9})?)?(Z|z|[+-][0-9]{2}(:?[0-9]{2})?)$/.test(t)) {
    return Number.isNaN(Date.parse(t.replace(' ', 'T'))) ? null : t.replace(' ', 'T')
  }
  return null
}

function intFrom(raw: string): number | null {
  const t = raw.trim().replace(/,/g, '')
  if (!/^[0-9]+$/.test(t)) return null
  const n = Number(t)
  return Number.isSafeInteger(n) ? n : null
}

function priceFrom(raw: string): number | null | undefined {
  const t = raw.trim().replace(/,/g, '').replace(/^฿/, '')
  if (!t) return undefined
  if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(t)) return null
  const n = Number(t)
  return n <= 99999999.99 ? n : null
}

/** อ่านไฟล์ออเดอร์: รวมแถวตามเลขออเดอร์ รวมบรรทัดตาม SKU (จำนวนรวมกัน) — ออเดอร์ที่มีแถวผิดจะไม่ถูกนำเข้าทั้งออเดอร์ */
export function parseOrdersCsv(text: string): { orders: NormalizedOrder[]; errors: { row: number; message: string; orderId?: string }[] } {
  const errors: { row: number; message: string; orderId?: string }[] = []
  if (Buffer.byteLength(String(text ?? ''), 'utf8') > ORDERS_CSV_MAX_BYTES) {
    return { orders: [], errors: [{ row: 0, message: 'ไฟล์ใหญ่เกิน 1 MB' }] }
  }
  const rows = parseCsv(text)
  if (rows.length === 0) return { orders: [], errors: [{ row: 0, message: 'ไฟล์ว่าง' }] }
  if (rows.length - 1 > ORDERS_CSV_MAX_ROWS) return { orders: [], errors: [{ row: 0, message: `มีเกิน ${ORDERS_CSV_MAX_ROWS} แถว — แบ่งไฟล์ก่อนนำเข้า` }] }

  const header = rows[0].map(normHeader)
  const col: Record<string, number> = {}
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = header.findIndex(h => aliases.includes(h))
    if (idx >= 0) col[key] = idx
  }
  const missing = ['order_id', 'sku', 'qty'].filter(k => col[k] === undefined)
  if (missing.length) return { orders: [], errors: [{ row: 1, message: `แถวหัวตารางต้องมีคอลัมน์ ${missing.join(', ')}` }] }

  interface Acc { order: NormalizedOrder; lines: Map<string, NormalizedOrderLine>; bad: boolean }
  const orders = new Map<string, Acc>()
  const cell = (r: string[], k: string) => (col[k] === undefined ? '' : (r[col[k]] ?? '').trim())

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const rowNo = i + 1
    if (r.every(c => c.trim() === '')) continue
    const orderId = cell(r, 'order_id')
    const rowErr = (message: string) => {
      errors.push({ row: rowNo, message, ...(orderId ? { orderId } : {}) })
      if (orderId && orders.has(orderId)) orders.get(orderId)!.bad = true
      else if (orderId) orders.set(orderId, { order: { external_order_id: orderId, status: 'completed', lines: [] }, lines: new Map(), bad: true })
    }
    if (!orderId) { rowErr('ไม่มีเลขออเดอร์'); continue }
    if (orderId.length > 100 || /[\x00-\x1f\x7f]/.test(orderId)) { rowErr('เลขออเดอร์ไม่ถูกต้อง'); continue }
    const sku = cell(r, 'sku')
    if (!sku || !normSku(sku)) { rowErr('ไม่มี SKU'); continue }
    if (sku.length > 200) { rowErr('SKU ยาวเกิน 200 ตัวอักษร'); continue }
    const qty = intFrom(cell(r, 'qty'))
    if (qty === null || qty < 1 || qty > 100000) { rowErr('จำนวนต้องเป็นจำนวนเต็ม 1 ขึ้นไป'); continue }
    const qc = cell(r, 'qty_cancelled') ? intFrom(cell(r, 'qty_cancelled')) : 0
    if (qc === null || qc > qty) { rowErr('จำนวนที่ยกเลิกไม่ถูกต้อง'); continue }
    const price = priceFrom(cell(r, 'unit_price'))
    if (price === null) { rowErr('ราคาไม่ถูกต้อง'); continue }
    const status = statusFrom(cell(r, 'status'))
    if (!status) { rowErr(`สถานะไม่รู้จัก: ${cell(r, 'status').slice(0, 30)}`); continue }
    const date = dateFrom(cell(r, 'order_date'))
    if (date === null) { rowErr('วันที่ต้องเป็น YYYY-MM-DD หรือ ISO 8601 พร้อมโซนเวลา'); continue }

    let acc = orders.get(orderId)
    if (!acc) {
      if (orders.size >= ORDERS_CSV_MAX_ORDERS) { errors.push({ row: rowNo, message: `นำเข้าได้ครั้งละไม่เกิน ${ORDERS_CSV_MAX_ORDERS} ออเดอร์`, orderId }); continue }
      acc = { order: { external_order_id: orderId, status, created_at: date ?? null, currency: 'THB', lines: [] }, lines: new Map(), bad: false }
      orders.set(orderId, acc)
    } else if (!acc.bad && acc.lines.size > 0 && acc.order.status !== status) {
      rowErr('สถานะของออเดอร์เดียวกันไม่ตรงกันในแต่ละแถว')
      continue
    }
    if (acc.lines.size === 0 && !acc.bad) {
      acc.order.status = status
      if (date) acc.order.created_at = date
    }
    const key = normSku(sku)
    const line = acc.lines.get(key)
    if (line) {
      line.qty += qty
      line.qty_cancelled = (line.qty_cancelled ?? 0) + qc
      if ((line.unit_price === null || line.unit_price === undefined) && price !== undefined) line.unit_price = price
      if (line.qty > 100000) { rowErr('จำนวนรวมของ SKU เดียวกันเกิน 100000'); continue }
    } else {
      acc.lines.set(key, { sku, qty, qty_cancelled: qc, ...(price !== undefined ? { unit_price: price } : {}) })
    }
  }

  const out: NormalizedOrder[] = []
  for (const acc of Array.from(orders.values())) {
    if (acc.bad || acc.lines.size === 0) continue
    if (acc.lines.size > 200) {
      errors.push({ row: 0, message: 'ออเดอร์มีสินค้าเกิน 200 รายการ', orderId: acc.order.external_order_id })
      continue
    }
    const lines = Array.from(acc.lines.values())
    const total = lines.every(l => typeof l.unit_price === 'number')
      ? Math.round(lines.reduce((s, l) => s + (l.qty - (l.qty_cancelled ?? 0)) * (l.unit_price as number), 0) * 100) / 100
      : null
    out.push({ ...acc.order, lines, total, raw: { source: 'csv' } })
  }
  return { orders: out, errors }
}

// ---------------------------------------------------------------------------
// ส่งออก CSV สต๊อก (Excel ภาษาไทย → มี BOM)
// ---------------------------------------------------------------------------
/** กันสูตร Excel (=, +, -, @) ในช่องข้อความ */
function safeText(s: string | null): string | null {
  if (s === null || s === undefined) return null
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s
}

export function stockRowsToCsv(rows: ExportStockRow[]): string {
  const header = ['sku', 'barcode', 'name', 'size', 'color', 'category', 'sell_price', 'available', 'stock_qty', 'owed_qty', 'is_active', 'external_sku']
  const body = rows.map(r => [
    safeText(r.sku), safeText(r.barcode), safeText(r.name), safeText(r.size), safeText(r.color), safeText(r.category),
    Number(r.sell_price ?? 0).toFixed(2), r.available, r.stock_qty, r.owed_qty, r.is_active ? 'yes' : 'no', safeText(r.external_sku),
  ])
  return toCsv([header, ...body], { bom: true })
}
