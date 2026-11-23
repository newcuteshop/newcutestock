// ===== ตัวช่วยร่วมของหน้ารายละเอียดงาน b.oncloud (เรียก RPC / แยกชนิด error / รหัสคำขอค้าง / สิทธิ์ปุ่ม) =====
// ใช้ฝั่งเบราว์เซอร์เท่านั้น — หลักการเดียวกับ components/rental/booking/rpc.ts (ใช้ตัวช่วยกลางของร้านเช่าซ้ำ ไม่เขียนใหม่):
//   - กดซ้ำไม่ได้ระหว่างรอ (busyRef ในแต่ละป็อปอัป)
//   - รายการเงิน/ค่าใช้จ่าย/รายการส่งงานใหม่ ใช้ client_id เดิมทุกครั้งที่ส่งซ้ำ (เซิร์ฟเวอร์คืนรายการเดิม already_saved)
//     รหัสค้างเก็บนอกป็อปอัป (ปิดแล้วเปิดใหม่ต้องได้รหัสเดิม + ค่าเดิม)
//   - "ไม่รู้ผล" (เน็ตหลุด/หมดเวลา) → โหลดงานใหม่ก่อนให้กดซ้ำ ข้อมูลใหม่แสดงว่าสำเร็จแล้ว = ถือว่าสำเร็จ (ไม่ทำซ้ำ)
//   - ข้อผิดพลาดที่ "กดยืนยันแบบบังคับแล้วทำต่อได้" แยกด้วย wedForceHint (hint จาก fix-07) ส่งกลับให้ป็อปอัปถามผู้ใช้
import { thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { round2 } from '@/lib/money'
import type { BrowserSupabase } from '@/lib/products'
import {
  FIX07_MISSING_MSG, parseWedActionResult, wedForceHint,
  type WedBooking, type WedBookingStatus, type WedPaymentKind, type WedPaymentMethod, type WedPaymentPurpose,
} from '@/lib/wedding'
import { callRpc, rejectedAfterDuplicateCheck } from '@/components/rental/booking/rpc'

export { callRpc, copyText, absoluteUrl, lineIdUrl, todayKeySafe, rejectedAfterDuplicateCheck } from '@/components/rental/booking/rpc'

export const UNSURE_MSG =
  'ไม่แน่ใจว่าบันทึกแล้วหรือยัง (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — ตรวจข้อมูลล่าสุดด้านล่างก่อน แล้วกดอีกครั้งได้ ระบบจะไม่บันทึกซ้ำ'
export const RELOAD_FAIL_MSG = 'โหลดข้อมูลงานล่าสุดไม่สำเร็จ — ตรวจอินเทอร์เน็ตแล้วกด "โหลดใหม่"'
export const RESUME_WRITE_MSG =
  'คำขอครั้งก่อนยังไม่ทราบผล (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — กด "ส่งอีกครั้ง" ได้เลย ถ้าบันทึกไปแล้วจะได้ผลเดิม ไม่บันทึกซ้ำ'

export type ForceHint = NonNullable<ReturnType<typeof wedForceHint>>

/** ข้อความผิดพลาดภาษาไทย: ยังไม่รัน fix-07 → บอกชื่อไฟล์ ; สิทธิ์ (42501) ข้อความไทยจาก RPC บอกชัดกว่าข้อความกลาง */
export function errorText(err: unknown): string {
  if (isMigrationMissing(err)) return FIX07_MISSING_MSG
  const e = err && typeof err === 'object' ? (err as { code?: unknown; message?: unknown }) : null
  if (e && (e.code === '42501' || e.code === 'P0001') && typeof e.message === 'string' && /[฀-๿]/.test(e.message)) {
    return e.message.trim()
  }
  return thaiError(err)
}

// ---------------------------------------------------------------------------
// เขียนข้อมูลงาน (RPC ที่คืน booking json — ตรงๆ หรือห่อ {booking}) + จัดการ "ไม่รู้ผล"
// ---------------------------------------------------------------------------
export type WedWriteResult =
  | { status: 'ok'; booking: WedBooking; data: unknown; already: boolean; verified: boolean }
  | { status: 'rejected'; message: string; definite: boolean; hint: ForceHint | null }
  | { status: 'unsure'; message: string; booking: WedBooking | null }

/**
 * เรียก RPC ที่เปลี่ยนงาน แล้วอ่านงานจากผล
 * - ถูกปฏิเสธ → โหลดงานใหม่เบื้องหลัง (ปุ่ม/ยอดบนจอตรงกับความจริง) + ส่ง hint ของการบังคับกลับไป
 * - ตอบกลับแต่อ่านไม่ได้ / ไม่ได้คำตอบ → โหลดงานใหม่ แล้วถาม verify ว่าข้อมูลใหม่แสดงว่าสำเร็จหรือยัง
 */
export async function runWedWrite(opts: {
  sb: BrowserSupabase
  fn: string
  args: Record<string, unknown>
  reload: () => Promise<WedBooking | null>
  verify?: (fresh: WedBooking) => boolean
}): Promise<WedWriteResult> {
  const res = await callRpc(opts.sb, opts.fn, opts.args)
  if (res.ok) {
    const out = parseWedActionResult(res.data)
    if (out) return { status: 'ok', booking: out.booking, data: res.data, already: out.already, verified: false }
  } else if (res.answered) {
    const hint = wedForceHint(res.error)
    // ต้องกดบังคับ = ยังไม่ได้เปลี่ยนอะไร ไม่ต้องโหลดใหม่ ; อื่นๆ (สถานะเปลี่ยนจากอีกเครื่อง ฯลฯ) → โหลดใหม่เบื้องหลัง
    if (!hint) void opts.reload().catch(() => null)
    return { status: 'rejected', message: errorText(res.error), definite: rejectedAfterDuplicateCheck(res.error), hint }
  }
  const fresh = await opts.reload()
  if (fresh && opts.verify && opts.verify(fresh)) {
    return { status: 'ok', booking: fresh, data: res.ok ? res.data : null, already: false, verified: true }
  }
  return { status: 'unsure', message: fresh ? UNSURE_MSG : `${UNSURE_MSG} (${RELOAD_FAIL_MSG})`, booking: fresh }
}

// ---------------------------------------------------------------------------
// รหัสคำขอ (client_id) ที่ยังไม่รู้ผล — อยู่นอกอายุของป็อปอัป
// key = '<booking_id>|<ช่อง>' เช่น 'abc|pay:payment', 'abc|charge', 'abc|hold', 'abc|deliv:new'
// ล้างเมื่อรู้ผลแน่นอนเท่านั้น (สำเร็จ รวม already_saved / ถูกปฏิเสธหลังตรวจรหัสซ้ำ)
// ---------------------------------------------------------------------------
export interface PendingWrite<T> {
  clientId: string
  args: T
}
const pendingWrites = new Map<string, PendingWrite<unknown>>()

export function pendingKey(bookingId: string, slot: string): string {
  return `${bookingId}|${slot}`
}
export function getPendingWrite<T>(key: string): PendingWrite<T> | null {
  return (pendingWrites.get(key) as PendingWrite<T> | undefined) ?? null
}
export function setPendingWrite<T>(key: string, p: PendingWrite<T>): void {
  pendingWrites.set(key, p)
}
export function clearPendingWrite(key: string, clientId: string): void {
  if (pendingWrites.get(key)?.clientId === clientId) pendingWrites.delete(key)
}
/** ฐานข้อมูลบอกว่ารหัสคำขอนี้ผูกกับงานอื่นแล้ว (แทบไม่เกิด — รหัสสุ่ม) → ต้องใช้รหัสใหม่ */
export function clientIdTakenElsewhere(message: string): boolean {
  return /ถูกใช้กับงานอื่นแล้ว/.test(message)
}

/** ค่าที่จำไว้ของรายการเงินที่ยังไม่รู้ผล (รวม path สลิปที่อัปโหลดแล้ว — ส่งซ้ำไม่ต้องอัปโหลดใหม่) */
export interface PendingPaymentArgs {
  kind: WedPaymentKind
  method: WedPaymentMethod
  amount: number
  paidOn: string
  purpose: WedPaymentPurpose | null
  note: string
  slipPath: string | null
}

// ---------------------------------------------------------------------------
// สถานะ / ยอดเงิน
// ---------------------------------------------------------------------------
export const EPS = 0.005

/** ลำดับขั้นของงาน (เลื่อน/ยกเลิก = นอกลำดับ) — ใช้ตรวจผลหลัง "ไม่รู้ผล" */
const STATUS_ORDER: Record<WedBookingStatus, number> = {
  inquiry: 0, hold: 1, confirmed: 2, in_production: 3, delivered: 4, completed: 5, postponed: 8, cancelled: 9,
}
export function statusAtLeast(s: WedBookingStatus, target: WedBookingStatus): boolean {
  return STATUS_ORDER[s] >= STATUS_ORDER[target] && STATUS_ORDER[s] < 8
}

/** ยอดสูงสุดที่บันทึกได้ (กฎเดียวกับ wed_add_payment_core) */
export function maxPaymentAmount(b: WedBooking, kind: WedPaymentKind): number {
  return kind === 'payment' ? Math.max(0, b.money.due) : Math.max(0, b.money.paid)
}

/** มัดจำที่ยังขาด (ไม่เกินยอดค้าง) ; ครบแล้ว = 0 */
export function depositShort(b: WedBooking): number {
  if (b.money.deposit_met) return 0
  return Math.max(0, Math.min(round2(b.money.deposit_required - b.money.paid), b.money.due))
}

/** ชนิดรายการเงินที่ทำได้ตอนนี้ (ตาม actions จากเซิร์ฟเวอร์) */
export function allowedPaymentKinds(b: WedBooking): WedPaymentKind[] {
  const out: WedPaymentKind[] = []
  if (b.actions.can_pay) out.push('payment')
  if (b.actions.can_refund) out.push('refund')
  return out
}

/** ลิงก์โปรไฟล์ Instagram จากชื่อบัญชี ('@name' / 'name' / ลิงก์เต็ม) ; อ่านไม่ได้ → '' */
export function instagramUrl(handle: string | null | undefined): string {
  const raw = String(handle ?? '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw)
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : ''
    } catch {
      return ''
    }
  }
  const name = raw.replace(/^@+/, '')
  return /^[A-Za-z0-9._]{1,30}$/.test(name) ? `https://www.instagram.com/${name}/` : ''
}

/** ลิงก์ Facebook (ลิงก์เต็มเท่านั้น — ชื่อเพจ/ชื่อคนเดาลิงก์ไม่ได้) ; อื่นๆ → '' */
export function facebookUrl(v: string | null | undefined): string {
  const raw = String(v ?? '').trim()
  if (!/^https?:\/\//i.test(raw)) return ''
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : ''
  } catch {
    return ''
  }
}
