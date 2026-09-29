// ===== ตัวช่วยแสดงผลของหน้า "ตั้งค่าการเชื่อมต่อ" =====
// pure functions ล้วน (ไม่แตะ window/document) — ใช้ได้ทั้ง server component และ client component
// เวลา "กี่นาทีที่แล้ว" คิดจาก nowMs ที่เซิร์ฟเวอร์ส่งมาเป็น prop (render ฝั่งเซิร์ฟเวอร์กับเบราว์เซอร์ได้ข้อความเดียวกัน)
import { formatThaiDateTime } from '@/lib/format'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/** '5 นาทีที่แล้ว' / 'อีก 12 วัน' / เกิน 30 วันแสดงวันที่เต็ม ; ไม่มีค่า → '-' */
export function relativeThai(iso: string | null | undefined, nowMs: number): string {
  const t = toMs(iso)
  if (t === null) return '-'
  const diff = nowMs - t
  const abs = Math.abs(diff)
  if (abs < MIN) return diff >= 0 ? 'เมื่อสักครู่' : 'อีกไม่ถึง 1 นาที'
  let text: string
  if (abs < HOUR) text = `${Math.floor(abs / MIN)} นาที`
  else if (abs < DAY) text = `${Math.floor(abs / HOUR)} ชั่วโมง`
  else if (abs < 30 * DAY) text = `${Math.floor(abs / DAY)} วัน`
  else return formatThaiDateTime(iso)
  return diff >= 0 ? `${text}ที่แล้ว` : `อีก ${text}`
}

/** จำนวนวันที่เหลือ (ปัดลง, ติดลบ = เลยมาแล้ว) ; ไม่มีค่า → null */
export function daysUntil(iso: string | null | undefined, nowMs: number): number | null {
  const t = toMs(iso)
  if (t === null) return null
  return Math.floor((t - nowMs) / DAY)
}

/** ผ่านเวลานั้นไปแล้วหรือยัง */
export function isPast(iso: string | null | undefined, nowMs: number): boolean {
  const t = toMs(iso)
  return t !== null && t <= nowMs
}

// รหัสเหตุผลของสถานะช่องทาง (CONTRACT §2.3) → ข้อความไทย
const STATUS_REASON_LABELS: Record<string, string> = {
  credentials_invalid: 'คีย์ไม่ถูกต้องหรือถูกยกเลิก — ตรวจคีย์แล้วบันทึกใหม่',
  needs_reauth: 'ต้องกด "เชื่อมต่อด้วยบัญชีร้าน" ใหม่',
  auth_expired: 'การอนุญาตของร้านหมดอายุ — ต้องเชื่อมต่อร้านใหม่',
  rate_limited: 'แพลตฟอร์มจำกัดจำนวนครั้ง — ระบบจะลองใหม่เอง',
  platform_error: 'แพลตฟอร์มขัดข้อง — ระบบจะลองใหม่เอง',
  awaiting_credentials: 'รอใส่คีย์',
}

/** เหตุผลของสถานะ → ข้อความไทย (รหัสที่ไม่รู้จักแสดงตามเดิม) ; ว่าง → '' */
export function statusReasonText(reason: string | null | undefined): string {
  if (!reason) return ''
  return STATUS_REASON_LABELS[reason] ?? reason
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

/** ค่าตัวแรกของ searchParams (Next ส่งมาเป็น string | string[] | undefined) */
export function firstParam(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? ''
  return typeof v === 'string' ? v : ''
}

/** ตัวเลขที่เชื่อได้ (null/NaN → 0) */
export function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// en-US = เลขอารบิกพร้อมคอมมาเหมือนกันทั้งเซิร์ฟเวอร์และเบราว์เซอร์ (กัน hydration ไม่ตรง)
const qtyFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** จำนวนชิ้นแบบมีคอมมา เช่น 1,250 */
export function qty(v: unknown): string {
  return qtyFormatter.format(num(v))
}
