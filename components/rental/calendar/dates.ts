// ===== ตัวช่วยวัน/เดือนของปฏิทินร้านเช่าชุด (pure — ใช้ได้ทั้ง server page และ client) =====
// day key = 'YYYY-MM-DD' (ปี ค.ศ.) ตามปฏิทินเวลาไทย · month key = 'YYYY-MM'
// คำนวณด้วย Date.UTC ล้วน (ผ่าน lib/format) → ไม่ขึ้นกับโซนเวลาของเครื่อง (server อยู่ UTC, เครื่องในร้านอยู่ +07)
import { addDaysToKey, daysBetweenKeys, isDayKey } from '@/lib/format'

export const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
] as const

const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'] as const

/** หัวคอลัมน์วันในสัปดาห์ เริ่มวันอาทิตย์ (แบบปฏิทินไทยทั่วไป) */
export const THAI_WEEKDAYS_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] as const
export const THAI_WEEKDAYS_FULL = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'] as const

const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/

/** เป็น month key 'YYYY-MM' ที่ถูกต้อง (ปี 2000-2100) หรือไม่ — ใช้ตรวจค่าจาก URL */
export function isMonthKey(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const m = MONTH_KEY_RE.exec(v.trim())
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  return y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12
}

/** month key ของวันนั้น ('2026-10-18' → '2026-10') ; ไม่ถูกต้อง → '' */
export function monthOfDay(dayKey: string): string {
  return isDayKey(dayKey) ? dayKey.slice(0, 7) : ''
}

/** วันแรกของเดือน ('2026-10' → '2026-10-01') */
export function monthFirstDay(monthKey: string): string {
  return `${monthKey}-01`
}

/** วันสุดท้ายของเดือน ('2026-02' → '2026-02-28') */
export function monthLastDay(monthKey: string): string {
  return addDaysToKey(monthFirstDay(addMonths(monthKey, 1)), -1)
}

/** เลื่อนเดือน n เดือน ('2026-12', 1 → '2027-01') ; key ไม่ถูกต้อง → คืนค่าเดิม */
export function addMonths(monthKey: string, n: number): string {
  const m = MONTH_KEY_RE.exec(String(monthKey ?? '').trim())
  if (!m) return monthKey
  const step = Number.isFinite(n) ? Math.trunc(n) : 0
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + step
  const y = Math.floor(total / 12)
  const mo = total - y * 12 + 1
  return `${('0000' + y).slice(-4)}-${('0' + mo).slice(-2)}`
}

/** 'ตุลาคม 2569' */
export function monthLabel(monthKey: string): string {
  const m = MONTH_KEY_RE.exec(String(monthKey ?? '').trim())
  if (!m) return '-'
  return `${THAI_MONTHS_FULL[Number(m[2]) - 1] ?? ''} ${Number(m[1]) + 543}`
}

/** วันในสัปดาห์ของ day key: 0 = อาทิตย์ … 6 = เสาร์ ; ไม่ถูกต้อง → 0 */
export function weekdayOf(dayKey: string): number {
  if (!isDayKey(dayKey)) return 0
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** วันที่ของเดือน ('2026-10-05' → 5) */
export function dayOfMonth(dayKey: string): number {
  return isDayKey(dayKey) ? Number(dayKey.slice(8, 10)) : 0
}

/** '18 ต.ค.' (ไม่มีปี — ใช้ในตาราง/แถบที่ปีชัดจากหัวเดือนแล้ว) */
export function shortDayLabel(dayKey: string): string {
  if (!isDayKey(dayKey)) return '-'
  return `${dayOfMonth(dayKey)} ${THAI_MONTHS_SHORT[Number(dayKey.slice(5, 7)) - 1] ?? ''}`
}

/** 'ส. 18 ต.ค.' — หัววันในรายการแบบย่อ */
export function weekdayDayLabel(dayKey: string): string {
  if (!isDayKey(dayKey)) return '-'
  return `${THAI_WEEKDAYS_SHORT[weekdayOf(dayKey)]}. ${shortDayLabel(dayKey)}`
}

/** รายการ day key ตั้งแต่ from ถึง to (รวมทั้งสองวัน) ; ช่วงผิด → [] (จำกัด 400 วันกันวนนาน) */
export function dayRange(from: string, to: string): string[] {
  const n = daysBetweenKeys(from, to)
  if (!Number.isFinite(n) || n < 0 || n > 400) return []
  const out: string[] = []
  for (let i = 0; i <= n; i++) out.push(addDaysToKey(from, i))
  return out
}

/**
 * ช่วงวันของตารางเดือนแบบ 7 คอลัมน์ (เริ่มอาทิตย์): ตั้งแต่วันอาทิตย์ก่อน/ตรงวันที่ 1 ถึงวันเสาร์หลัง/ตรงวันสุดท้าย
 * ได้ 35 หรือ 42 วัน (ไม่เกิน 92 วันที่ rental_schedule ยอม)
 */
export function monthGridRange(monthKey: string): { from: string; to: string } {
  const first = monthFirstDay(monthKey)
  const last = monthLastDay(monthKey)
  return {
    from: addDaysToKey(first, -weekdayOf(first)),
    to: addDaysToKey(last, 6 - weekdayOf(last)),
  }
}
