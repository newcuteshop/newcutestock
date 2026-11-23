// ===== เขียนรายการส่งงาน (wed_save_deliverable / wed_delete_deliverable) + จัดการ "ไม่รู้ผล" — ใช้ฝั่ง client =====
// การแก้รายการเดิม (มี id) ส่งค่าเดิมซ้ำได้ผลเหมือนเดิม จึงกดซ้ำได้ปลอดภัยโดยไม่ต้องมีรหัสคำขอ
// ไม่รู้ผล (เน็ตหลุด/หมดเวลา) → อ่านแถวจริงจากตาราง wed_deliverables (RLS: พนักงาน b.oncloud) มาเทียบก่อนบอกผู้ใช้
//   ตรงกับที่ส่ง = บันทึกแล้ว · ลบแล้วไม่พบแถว = ลบแล้ว · อื่นๆ = ให้ดูข้อมูลล่าสุดแล้วกดอีกครั้ง
import type { BrowserSupabase } from '@/lib/products'
import {
  parseSaveDeliverableResult, parseWedBookingResult,
  type WedBooking, type WedDeliverable, type WedDeliverableInput,
} from '@/lib/wedding'
import { WRITE_TIMEOUT_MS, rpcWithTimeout, serverAnswered, wedErrorText } from '@/components/wedding/money/wedRpc'
import { rowMatches } from './boardModel'

export const DELIVERABLE_UNSURE_MSG =
  'ไม่แน่ใจว่าบันทึกแล้วหรือยัง (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — โหลดกระดานใหม่เพื่อดูสถานะล่าสุด แล้วกดอีกครั้งได้'

const ROW_COLUMNS = 'id, booking_id, name, qty, unit, due_date, status, link_url, note, editor_crew_id'

export type DeliverableWriteResult =
  | { status: 'ok'; deliverable: WedDeliverable | null; booking: WedBooking | null; verified: boolean }
  | { status: 'rejected'; message: string }
  | { status: 'unsure'; message: string }

export async function saveDeliverable(
  sb: BrowserSupabase,
  bookingId: string,
  payload: Partial<WedDeliverableInput> & { id: string },
): Promise<DeliverableWriteResult> {
  const res = await rpcWithTimeout(sb, 'wed_save_deliverable', { p_booking_id: bookingId, p_item: payload }, WRITE_TIMEOUT_MS)
  if (!res.error) {
    const r = parseSaveDeliverableResult(res.data)
    if (r.deliverable) return { status: 'ok', deliverable: r.deliverable, booking: r.booking, verified: false }
  } else if (!res.timedOut && serverAnswered(res.error)) {
    return { status: 'rejected', message: wedErrorText(res.error) }
  }
  // ไม่รู้ผล / ตอบกลับอ่านไม่ได้ → ดูแถวจริง
  try {
    const { data, error } = await sb.from('wed_deliverables').select(ROW_COLUMNS).eq('id', payload.id).maybeSingle()
    if (!error && data && rowMatches(data as Record<string, unknown>, payload)) {
      return { status: 'ok', deliverable: null, booking: null, verified: true }
    }
  } catch {
    // อ่านไม่ได้ — ตกไปที่ "ไม่แน่ใจ"
  }
  return { status: 'unsure', message: DELIVERABLE_UNSURE_MSG }
}

export async function deleteDeliverable(sb: BrowserSupabase, id: string): Promise<DeliverableWriteResult> {
  const res = await rpcWithTimeout(sb, 'wed_delete_deliverable', { p_id: id }, WRITE_TIMEOUT_MS)
  if (!res.error) return { status: 'ok', deliverable: null, booking: parseWedBookingResult(res.data), verified: false }
  if (!res.timedOut && serverAnswered(res.error)) {
    const message = wedErrorText(res.error)
    // ถูกลบไปแล้ว (จากการกดครั้งก่อนที่เน็ตหลุด หรือจากเครื่องอื่น) = ผลที่ต้องการอยู่แล้ว
    if (/ไม่พบรายการส่งงานนี้/.test(message)) return { status: 'ok', deliverable: null, booking: null, verified: true }
    return { status: 'rejected', message }
  }
  try {
    const { data, error } = await sb.from('wed_deliverables').select('id').eq('id', id).maybeSingle()
    if (!error && !data) return { status: 'ok', deliverable: null, booking: null, verified: true }
  } catch {
    // อ่านไม่ได้ — ตกไปที่ "ไม่แน่ใจ"
  }
  return { status: 'unsure', message: DELIVERABLE_UNSURE_MSG }
}
