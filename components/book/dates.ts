// ===== หน้าจองออนไลน์: ตัวช่วยวันที่ (ปฏิทินเดือน / ป้ายวันแบบสั้น / ตรวจช่วงวันเช่า) =====
// day key = 'YYYY-MM-DD' (ปี ค.ศ.) ตามปฏิทินเวลาไทย — คำนวณด้วย Date.UTC ล้วน ไม่ขึ้นกับโซนเวลาของเครื่อง
// แสดงผลเป็นปี พ.ศ. เสมอ · ฟังก์ชันล้วน ใช้ได้ทั้ง server และ client
import { addDaysToKey, daysBetweenKeys, isDayKey } from '@/lib/format'
import { rentalDays } from '@/lib/rental'

export const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
] as const
const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'] as const
/** หัวคอลัมน์ปฏิทิน เริ่มวันอาทิตย์ (แบบปฏิทินไทยทั่วไป) */
export const THAI_WEEKDAYS_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'] as const
const THAI_WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'] as const

function parts(key: string): { y: number; m: number; d: number } | null {
  if (!isDayKey(key)) return null
  const [y, m, d] = key.split('-').map(Number)
  return { y, m, d }
}

function keyOf(y: number, m: number, d: number): string {
  const t = new Date(Date.UTC(y, m - 1, d))
  return `${('0000' + t.getUTCFullYear()).slice(-4)}-${('0' + (t.getUTCMonth() + 1)).slice(-2)}-${('0' + t.getUTCDate()).slice(-2)}`
}

/** 'YYYY-MM' ของวันนั้น ; key ไม่ถูกต้อง → '' */
export function monthKeyOf(dayKey: string): string {
  const p = parts(dayKey)
  return p ? dayKey.slice(0, 7) : ''
}

function monthParts(monthKey: string): { y: number; m: number } | null {
  const mm = /^(\d{4})-(\d{2})$/.exec(monthKey)
  if (!mm) return null
  const y = Number(mm[1])
  const m = Number(mm[2])
  return m >= 1 && m <= 12 ? { y, m } : null
}

/** เลื่อนเดือน: addMonths('2026-12', 1) = '2027-01' */
export function addMonths(monthKey: string, n: number): string {
  const p = monthParts(monthKey)
  if (!p) return ''
  const t = new Date(Date.UTC(p.y, p.m - 1 + Math.trunc(n), 1))
  return `${('0000' + t.getUTCFullYear()).slice(-4)}-${('0' + (t.getUTCMonth() + 1)).slice(-2)}`
}

/** ลำดับเดือน (ใช้เทียบก่อน/หลัง) */
export function monthIndex(monthKey: string): number {
  const p = monthParts(monthKey)
  return p ? p.y * 12 + (p.m - 1) : NaN
}

/** 'ตุลาคม 2569' */
export function monthTitle(monthKey: string): string {
  const p = monthParts(monthKey)
  return p ? `${THAI_MONTHS[p.m - 1]} ${p.y + 543}` : ''
}

/** วันแรก/วันสุดท้ายของเดือน + จำนวนช่องว่างก่อนวันที่ 1 (อาทิตย์ = 0) */
export function monthInfo(monthKey: string): { first: string; last: string; lead: number; count: number } | null {
  const p = monthParts(monthKey)
  if (!p) return null
  const count = new Date(Date.UTC(p.y, p.m, 0)).getUTCDate()
  const lead = new Date(Date.UTC(p.y, p.m - 1, 1)).getUTCDay()
  return { first: keyOf(p.y, p.m, 1), last: keyOf(p.y, p.m, count), lead, count }
}

/** วันในสัปดาห์ (อาทิตย์ = 0) ; key ไม่ถูกต้อง → -1 */
export function weekdayOf(dayKey: string): number {
  const p = parts(dayKey)
  return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() : -1
}

/** 'ศ. 24 ต.ค. 69' — ป้ายสั้นสำหรับปุ่ม/สรุป ; ไม่ถูกต้อง → '-' */
export function shortDay(dayKey: string | null | undefined): string {
  const p = dayKey ? parts(dayKey) : null
  if (!p) return '-'
  const wd = THAI_WEEKDAYS_SHORT[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]
  return `${wd} ${p.d} ${THAI_MONTHS_SHORT[p.m - 1]} ${String(p.y + 543).slice(-2)}`
}

/** 'วันศุกร์ที่ 24 ตุลาคม 2569' — ใช้เป็นชื่อปุ่มวันในปฏิทินให้โปรแกรมอ่านจอ */
export function longDay(dayKey: string): string {
  const p = parts(dayKey)
  if (!p) return ''
  const wd = THAI_WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]
  return `วัน${wd}ที่ ${p.d} ${THAI_MONTHS[p.m - 1]} ${p.y + 543}`
}

/** เลขวันที่ของเดือน (1-31) */
export function dayNumber(dayKey: string): number {
  const p = parts(dayKey)
  return p ? p.d : 0
}

/** รายการวันตั้งแต่ from ถึง to (รวมทั้งสองวัน) — ไม่ถูกต้อง/ยาวเกิน 400 วัน → [] */
export function eachDay(from: string, to: string): string[] {
  const n = daysBetweenKeys(from, to)
  if (!Number.isFinite(n) || n < 0 || n > 400) return []
  const out: string[] = []
  for (let i = 0; i <= n; i++) out.push(addDaysToKey(from, i))
  return out
}

/** วันแรกที่รับชุดได้ = วันนี้ + จำนวนวันที่ต้องจองล่วงหน้า */
export function earliestPickup(todayKey: string, leadDays: number): string {
  return addDaysToKey(todayKey, Math.max(0, Math.trunc(leadDays) || 0))
}

/** วันคืนช้าที่สุดที่เลือกได้ เมื่อรับชุดวัน pickup และเช่าได้ไม่เกิน maxDays วัน */
export function latestReturn(pickup: string, maxDays: number): string {
  return addDaysToKey(pickup, Math.max(1, Math.trunc(maxDays) || 1) - 1)
}

/**
 * ตรวจช่วงวันเช่าตามเงื่อนไขจองออนไลน์ (ฐานข้อมูลตรวจซ้ำอีกชั้น) — ผ่าน = null, ไม่ผ่าน = ข้อความไทย
 * วันรับ ≥ วันนี้ + จองล่วงหน้า · วันคืน ≥ วันรับ · จำนวนวัน (นับรวมวันรับและวันคืน) ไม่เกิน maxDays
 */
export function rangeProblem(pickup: string | null, ret: string | null, todayKey: string, leadDays: number, maxDays: number): string | null {
  if (!pickup || !ret) return 'กรุณาเลือกวันรับชุดและวันคืนชุด'
  if (!isDayKey(pickup) || !isDayKey(ret)) return 'วันที่ไม่ถูกต้อง กรุณาเลือกใหม่'
  const earliest = earliestPickup(todayKey, leadDays)
  if (pickup < earliest) {
    return leadDays > 0
      ? `ต้องจองล่วงหน้าอย่างน้อย ${leadDays} วัน (รับชุดได้ตั้งแต่ ${shortDay(earliest)})`
      : 'วันรับชุดต้องไม่ก่อนวันนี้'
  }
  if (ret < pickup) return 'วันคืนชุดต้องไม่ก่อนวันรับชุด'
  const days = rentalDays(pickup, ret)
  if (days > maxDays) return `จองออนไลน์ได้ครั้งละไม่เกิน ${maxDays} วัน`
  return null
}

/**
 * เวลาที่เหลือก่อนหมดเวลาถือคิว เช่น 'อีก 5 ชม. 20 นาที' / 'อีก 2 วัน 3 ชม.' ; หมดแล้ว → 'หมดเวลาแล้ว' ; อ่านไม่ได้ → ''
 */
export function timeLeftText(expiresAt: string | null | undefined, nowMs: number): string {
  if (!expiresAt) return ''
  const t = new Date(expiresAt).getTime()
  if (!Number.isFinite(t)) return ''
  const ms = t - nowMs
  if (ms <= 0) return 'หมดเวลาแล้ว'
  const totalMin = Math.floor(ms / 60000)
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins = totalMin % 60
  if (days > 0) return `อีก ${days} วัน ${hours} ชม.`
  if (hours > 0) return `อีก ${hours} ชม. ${mins} นาที`
  return `อีก ${Math.max(1, mins)} นาที`
}
