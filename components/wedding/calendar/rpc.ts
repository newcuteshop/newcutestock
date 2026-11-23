// ===== ตัวช่วยเรียกฐานข้อมูล + ลิงก์ของหน้าปฏิทินงาน / ภาพรวม ร้าน b.oncloud — ใช้ฝั่ง client =====
// ใช้ rpcWithTimeout ตัวเดียวกับร้านเช่า (มีเวลาจำกัด ไม่ throw) — ต่างแค่ข้อความ "ยังไม่รันไฟล์" ชี้ไปที่ fix-07
// หน้าปฏิทิน/ภาพรวมอ่านอย่างเดียว (ไม่มีการเขียนข้อมูล) → ไม่ต้องมี client_id / ตรวจผลไม่แน่ใจ
import { thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { FIX07_MISSING_MSG, phoneDigits } from '@/lib/wedding'

export { LOAD_TIMEOUT_MS, UUID_RE, rpcWithTimeout } from '@/components/rental/calendar/rpc'

const THAI_RE = /[฀-๿]/

/** ข้อความ error ภาษาไทยสำหรับหน้าร้าน b.oncloud */
export function wedErrorText(err: unknown): string {
  if (isMigrationMissing(err)) return FIX07_MISSING_MSG
  const e = err && typeof err === 'object' ? (err as { code?: unknown; message?: unknown }) : null
  // ข้อความไทยจาก RPC ของเรา (42501 ขาดสิทธิ์ / P0001 ช่วงวันที่ผิด ฯลฯ) ชัดกว่าข้อความกลาง
  if (e && (e.code === '42501' || e.code === 'P0001') && typeof e.message === 'string' && THAI_RE.test(e.message)) {
    return e.message.trim()
  }
  return thaiError(err)
}

/** หน้ารายละเอียดงาน (W-3) */
export function wedBookingHref(bookingId: string): string {
  return `/wedding/bookings/${encodeURIComponent(bookingId)}`
}

/** หน้าสร้างงานใหม่ (W-2) — ส่งวันที่ไปกรอกคิวแรกให้ */
export function wedNewBookingHref(day?: string | null): string {
  return day ? `/wedding/bookings/new?date=${encodeURIComponent(day)}` : '/wedding/bookings/new'
}

/** ปฏิทินงาน เปิดที่วันนั้น (เลือกวัน + เดือนของวันนั้น) */
export function wedCalendarHref(day?: string | null): string {
  return day ? `/wedding/calendar?day=${encodeURIComponent(day)}` : '/wedding/calendar'
}

/** ลิงก์โทรออก (ตัวเลขล้วน) ; ไม่มีเบอร์ → '' */
export function telHref(phone: string | null | undefined): string {
  const d = phoneDigits(phone)
  return d ? `tel:${d}` : ''
}

/** ลิงก์เพิ่มเพื่อน LINE จาก LINE ID (บัญชีทางการขึ้นต้น @ ใช้ /R/ti/p/@id) ; ว่าง → '' */
export function lineIdUrl(lineId: string | null | undefined): string {
  const id = String(lineId ?? '').trim()
  if (!id) return ''
  return id.startsWith('@')
    ? `https://line.me/R/ti/p/${encodeURIComponent(id)}`
    : `https://line.me/ti/p/~${encodeURIComponent(id)}`
}
