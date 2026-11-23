// ===== ตัวช่วยเรียกฐานข้อมูลของหน้าร้าน b.oncloud ที่ W-6 ดูแล (ส่งงาน / ลูกค้า / การเงิน / รายงาน) — ใช้ฝั่ง client =====
// ตัวเรียก RPC แบบมีเวลาจำกัด + แยก "เซิร์ฟเวอร์ตอบจริง" กับ "เน็ตหลุด" ใช้ตัวเดียวกับร้านเช่า (components/rental/calendar/rpc.ts)
// เพราะเป็นกลไกกลางที่ไม่ผูกกับร้าน — ที่ต่างคือข้อความ "ยังไม่ได้รันไฟล์ SQL" ต้องชี้ไป supabase-fix-07-wedding.sql
import { thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { FIX07_MISSING_MSG } from '@/lib/wedding'

export {
  LOAD_TIMEOUT_MS, LOAD_TIMEOUT_MSG, UUID_RE, WRITE_TIMEOUT_MS, rpcWithTimeout, serverAnswered, telHref,
  type RpcOutcome,
} from '@/components/rental/calendar/rpc'

const THAI_RE = /[฀-๿]/

/**
 * error → ข้อความไทยของร้าน b.oncloud:
 * ยังไม่ได้รัน fix-07 → บอกชื่อไฟล์ ; 42501 ที่ฐานข้อมูลบอกเหตุผลเป็นภาษาไทยมาเอง → ใช้ข้อความนั้น
 * (thaiError จะเหลือแค่ "ไม่มีสิทธิ์ทำรายการนี้" ซึ่งไม่บอกว่าขาดสิทธิ์อะไร) ; อื่นๆ → thaiError
 */
export function wedErrorText(err: unknown): string {
  if (isMigrationMissing(err)) return FIX07_MISSING_MSG
  const e = err && typeof err === 'object' ? (err as { code?: unknown; message?: unknown }) : null
  if (e && String(e.code ?? '') === '42501' && typeof e.message === 'string' && THAI_RE.test(e.message)) return e.message.trim()
  return thaiError(err)
}

/** ลิงก์หน้ารายละเอียดงาน (W-3) */
export function wedBookingHref(bookingId: string): string {
  return `/wedding/bookings/${encodeURIComponent(bookingId)}`
}

/** ลิงก์หน้ารายละเอียดลูกค้า */
export function wedCustomerHref(customerId: string): string {
  return `/wedding/customers/${encodeURIComponent(customerId)}`
}

/** ลิงก์สร้างงานใหม่ให้ลูกค้าคนนี้ (หน้าสร้างงานของ W-2 อ่าน ?customer=) */
export function wedNewBookingHref(customerId?: string | null): string {
  return customerId ? `/wedding/bookings/new?customer=${encodeURIComponent(customerId)}` : '/wedding/bookings/new'
}

/** จำนวนเต็มแบบมีคอมมา (ตัวเลขอารบิก ตรงกับหน้าอื่นของระบบ) */
export function fmtCount(n: number): string {
  const v = Math.trunc(Number(n))
  return (Number.isFinite(v) ? v : 0).toLocaleString('en-US')
}
