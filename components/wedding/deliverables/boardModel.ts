// ===== กระดานงานตัดต่อ/ส่งงาน: ตัวกรอง คอลัมน์ ขั้นถัดไป และการตรวจฟอร์ม (pure — ไม่มี hook) =====
// ข้อมูลมาจาก wed_deliverables_board(p_status, p_from, p_to) — ฐานข้อมูลกรองสถานะ/ช่วงกำหนดส่งให้ (ไม่เกิน 1,000 รายการ)
// ตัวกรองผู้ตัดต่อ/คำค้นทำในเครื่อง (ข้อมูลชุดเดียวกัน ไม่ต้องยิงฐานข้อมูลซ้ำทุกครั้งที่เปลี่ยน)
import { daysBetweenKeys } from '@/lib/format'
import {
  isHttpUrlOrEmpty, type WedBoardFilter, type WedDeliverableBoardItem, type WedDeliverableInput, type WedDeliverableStatus,
} from '@/lib/wedding'

export type BoardScope = 'open' | 'overdue' | 'delivered' | 'all'

export const BOARD_SCOPES: readonly { key: BoardScope; label: string }[] = [
  { key: 'open', label: 'ยังไม่ส่ง' },
  { key: 'overdue', label: 'เลยกำหนด' },
  { key: 'delivered', label: 'ส่งแล้ว' },
  { key: 'all', label: 'ทั้งหมด' },
]

export function isBoardScope(v: unknown): v is BoardScope {
  return v === 'open' || v === 'overdue' || v === 'delivered' || v === 'all'
}

/** ตัวกรองที่ส่งให้ wed_deliverables_board (null = ทุกสถานะ) */
export function scopeToFilter(scope: BoardScope): WedBoardFilter | null {
  return scope === 'all' ? null : scope
}

/** คอลัมน์ที่แสดงตามขอบเขต (ยังไม่ส่ง/เลยกำหนด = 3 ขั้นก่อนส่ง · ส่งแล้ว = คอลัมน์เดียว · ทั้งหมด = 4 ขั้น) */
export function columnsFor(scope: BoardScope): WedDeliverableStatus[] {
  if (scope === 'delivered') return ['delivered']
  if (scope === 'all') return ['pending', 'editing', 'review', 'delivered']
  return ['pending', 'editing', 'review']
}

/** รายการนี้ยังอยู่ในขอบเขตที่เปิดดูไหม (หลังเปลี่ยนสถานะ) */
export function inScope(item: Pick<WedDeliverableBoardItem, 'status' | 'overdue'>, scope: BoardScope): boolean {
  if (scope === 'all') return true
  if (scope === 'delivered') return item.status === 'delivered'
  if (scope === 'overdue') return item.status !== 'delivered' && item.overdue
  return item.status !== 'delivered'
}

/** ขั้นถัดไปของงานตัดต่อ (ปุ่มลัดบนการ์ด) ; ส่งแล้ว = ไม่มี */
export const NEXT_STEP: Readonly<Record<WedDeliverableStatus, { to: WedDeliverableStatus; label: string } | null>> = {
  pending: { to: 'editing', label: 'เริ่มตัดต่อ' },
  editing: { to: 'review', label: 'ส่งตรวจ' },
  review: { to: 'delivered', label: 'ส่งลูกค้า' },
  delivered: null,
}

/** ส่งแล้วต้องมีลิงก์หรือหมายเหตุวิธีส่งงาน (กติกาเดียวกับ wed_save_deliverable) */
export function canDeliverDirectly(item: Pick<WedDeliverableBoardItem, 'link_url' | 'note'>): boolean {
  return !!(item.link_url || (item.note ?? '').trim())
}

/** เลยกำหนดกี่วัน (ยังไม่ส่ง + มีกำหนด + กำหนดอยู่ก่อนวันนี้) ; ไม่เลย = 0 */
export function daysLate(item: Pick<WedDeliverableBoardItem, 'status' | 'due_date'>, today: string): number {
  if (item.status === 'delivered' || !item.due_date) return 0
  const d = daysBetweenKeys(item.due_date, today)
  return Number.isFinite(d) && d > 0 ? d : 0
}

/** เหลืออีกกี่วันถึงกำหนด (0 = วันนี้) ; ไม่มีกำหนด/ส่งแล้ว/เลยแล้ว = null */
export function daysLeft(item: Pick<WedDeliverableBoardItem, 'status' | 'due_date'>, today: string): number | null {
  if (item.status === 'delivered' || !item.due_date) return null
  const d = daysBetweenKeys(today, item.due_date)
  return Number.isFinite(d) && d >= 0 ? d : null
}

export type EditorFilter = 'any' | 'none' | string

export function matchesFilters(
  item: WedDeliverableBoardItem,
  f: { editor: EditorFilter; search: string },
): boolean {
  if (f.editor === 'none' && item.editor_crew_id) return false
  if (f.editor !== 'any' && f.editor !== 'none' && item.editor_crew_id !== f.editor) return false
  const q = f.search.trim().toLowerCase()
  if (!q) return true
  return [item.name, item.couple_names, item.booking_no, item.editor_name ?? '', item.note ?? '']
    .some(s => s.toLowerCase().includes(q))
}

// ---------------------------------------------------------------------------
// ฟอร์มแก้ไขรายการส่งงาน (ป็อปอัป)
// ---------------------------------------------------------------------------
export interface DeliverableFields {
  name: string
  qty: string
  unit: string
  due_date: string
  status: WedDeliverableStatus
  link_url: string
  note: string
  editor_crew_id: string
}

export type DeliverableFieldKey = keyof DeliverableFields

export const DELIVERABLE_LIMITS = { name: 120, unit: 30, link_url: 1000, note: 1000, qty: 100000 } as const

export function fieldsFromItem(item: WedDeliverableBoardItem, presetStatus?: WedDeliverableStatus): DeliverableFields {
  return {
    name: item.name,
    qty: String(item.qty),
    unit: item.unit ?? '',
    due_date: item.due_date ?? '',
    status: presetStatus ?? item.status,
    link_url: item.link_url ?? '',
    note: item.note ?? '',
    editor_crew_id: item.editor_crew_id ?? '',
  }
}

export function validateDeliverable(f: DeliverableFields): Partial<Record<DeliverableFieldKey, string>> {
  const e: Partial<Record<DeliverableFieldKey, string>> = {}
  const name = f.name.trim()
  if (!name) e.name = 'กรุณาใส่ชื่องานที่ส่ง'
  else if (name.length > DELIVERABLE_LIMITS.name) e.name = `ชื่อยาวเกินไป (สูงสุด ${DELIVERABLE_LIMITS.name} ตัวอักษร)`
  const qty = Number(f.qty.trim())
  if (!/^\d+$/.test(f.qty.trim()) || !Number.isInteger(qty) || qty < 1 || qty > DELIVERABLE_LIMITS.qty) {
    e.qty = 'จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป'
  }
  if (f.unit.trim().length > DELIVERABLE_LIMITS.unit) e.unit = `หน่วยยาวเกินไป (สูงสุด ${DELIVERABLE_LIMITS.unit} ตัวอักษร)`
  const link = f.link_url.trim()
  if (link.length > DELIVERABLE_LIMITS.link_url) e.link_url = `ลิงก์ยาวเกินไป (สูงสุด ${DELIVERABLE_LIMITS.link_url} ตัวอักษร)`
  else if (!isHttpUrlOrEmpty(link)) e.link_url = 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https:// (เช่น ลิงก์ Google Drive)'
  if (f.note.trim().length > DELIVERABLE_LIMITS.note) e.note = `หมายเหตุยาวเกินไป (สูงสุด ${DELIVERABLE_LIMITS.note} ตัวอักษร)`
  if (f.status === 'delivered' && !link && !f.note.trim()) {
    e.link_url = 'ส่งแล้วต้องใส่ลิงก์ส่งงาน หรือเขียนหมายเหตุว่าส่งทางไหน'
  }
  return e
}

/** payload ของ wed_save_deliverable (แก้ไขรายการเดิม — ส่งทุกช่อง) */
export function buildDeliverablePayload(id: string, f: DeliverableFields): WedDeliverableInput & { id: string } {
  const orNull = (s: string) => (s.trim() === '' ? null : s.trim())
  return {
    id,
    name: f.name.trim(),
    qty: Math.max(1, Math.trunc(Number(f.qty.trim()) || 1)),
    unit: orNull(f.unit),
    due_date: f.due_date.trim() || null,
    status: f.status,
    link_url: orNull(f.link_url),
    note: orNull(f.note),
    editor_crew_id: f.editor_crew_id || null,
  }
}

/** แถวในตาราง wed_deliverables (ใช้ตรวจตอน "ไม่รู้ผล") ตรงกับที่ส่งไปหรือไม่ — เทียบเฉพาะช่องที่ส่ง */
export function rowMatches(row: Record<string, unknown>, p: Partial<WedDeliverableInput>): boolean {
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())
  const day = (v: unknown) => s(v).slice(0, 10)
  for (const key of Object.keys(p) as (keyof WedDeliverableInput)[]) {
    if (key === 'id' || key === 'sort_order') continue
    const want = p[key]
    if (key === 'due_date') {
      if (day(row.due_date) !== day(want)) return false
    } else if (key === 'qty') {
      if (Number(row.qty) !== Number(want)) return false
    } else if (s(row[key]) !== s(want)) {
      return false
    }
  }
  return true
}
