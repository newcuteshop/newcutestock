// ===== การเงินร้านเช่า: แถวรายการเงิน (ตาราง rental_payments + การจอง + ลูกค้า) และยอดรวมของวัน =====
// ใช้ร่วมกันในหน้าการเงิน (/rental/payments), ป็อปอัปตรวจสลิป และใบสรุปยอดประจำวัน (80 มม.)
// ไม่มี hook / ไม่แตะ window → ใช้ได้ทั้ง server และ client
// ตัวเลขทุกช่องผ่าน num + round2 (numeric จาก PostgREST อาจมาเป็นสตริง) — ยอดเงินจริงของการจองคำนวณที่ฐานข้อมูลเสมอ
import { num, round2 } from '@/lib/money'
import { thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import {
  FIX05_MISSING_MSG, parsePayment, RENTAL_BOOKING_STATUSES, RENTAL_CASH_METHODS, RENTAL_PAYMENT_KINDS,
  type RentalBookingStatus, type RentalCashMethod, type RentalPayment, type RentalPaymentKind,
} from '@/lib/rental'

/**
 * คอลัมน์ที่ select จากตาราง rental_payments (RLS: พนักงานร้านเช่าอ่านได้)
 * แนบการจอง (booking_id → rental_bookings) และลูกค้า (customer_id → rental_customers) มาในคำขอเดียว
 */
export const PAYMENT_ROW_COLUMNS =
  'id, receipt_no, kind, method, amount, status, slip_path, note, reject_reason, voided_at, void_reason, ' +
  'created_by_name, created_at, reviewed_at, confirmed_at, booking_id, ' +
  'booking:rental_bookings(id, booking_no, status, source, pickup_date, return_date, grand_total, paid, due, ' +
  'deposit_required, deposit_met, expires_at, customer:rental_customers(name, phone))'

/** ข้อมูลการจองที่แนบมากับรายการเงิน (พอสำหรับตรวจสลิป/แสดงในรายการ) */
export interface PaymentBookingInfo {
  id: string
  booking_no: string
  status: RentalBookingStatus
  pickup_date: string
  return_date: string
  grand_total: number
  paid: number
  due: number
  deposit_required: number
  deposit_met: boolean
  expires_at: string | null
  customer_name: string
  customer_phone: string | null
}

export interface PaymentRow extends RentalPayment {
  booking_id: string
  booking: PaymentBookingInfo | null
}

type Obj = Record<string, unknown>

function asObj(v: unknown): Obj | null {
  // ความสัมพันธ์แบบหลายต่อหนึ่ง PostgREST ส่งเป็น object — บางรุ่น/บางกรณีเป็น array 1 ตัว → รับทั้งคู่
  if (Array.isArray(v)) return v.length > 0 ? asObj(v[0]) : null
  return v !== null && typeof v === 'object' ? (v as Obj) : null
}

function str(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return ''
}

function strOrNull(v: unknown): string | null {
  const s = str(v)
  return s.trim() === '' ? null : s
}

function dayKeyOf(v: unknown): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(str(v).trim())
  return m ? m[1] : ''
}

function parseBookingInfo(raw: unknown): PaymentBookingInfo | null {
  const o = asObj(raw)
  if (!o) return null
  const id = str(o.id)
  if (!id) return null
  const status = str(o.status)
  const c = asObj(o.customer)
  return {
    id,
    booking_no: str(o.booking_no),
    status: (RENTAL_BOOKING_STATUSES as readonly string[]).includes(status) ? (status as RentalBookingStatus) : 'pending',
    pickup_date: dayKeyOf(o.pickup_date),
    return_date: dayKeyOf(o.return_date),
    grand_total: round2(num(o.grand_total)),
    paid: round2(num(o.paid)),
    due: round2(num(o.due)),
    deposit_required: round2(num(o.deposit_required)),
    deposit_met: o.deposit_met === true || o.deposit_met === 'true',
    expires_at: strOrNull(o.expires_at),
    customer_name: c ? str(c.name) : '',
    customer_phone: c ? strOrNull(c.phone) : null,
  }
}

/** แถวรายการเงิน 1 แถว (จาก PAYMENT_ROW_COLUMNS) ; อ่านไม่ได้/ไม่มี id → null (ไม่ throw) */
export function parsePaymentRow(raw: unknown): PaymentRow | null {
  const p = parsePayment(raw)
  if (!p) return null
  const o = asObj(raw) ?? {}
  const booking = parseBookingInfo(o.booking)
  return { ...p, booking_id: str(o.booking_id) || booking?.id || '', booking }
}

export function parsePaymentRows(raw: unknown): PaymentRow[] {
  const out: PaymentRow[] = []
  if (!Array.isArray(raw)) return out
  for (const r of raw) {
    const row = parsePaymentRow(r)
    if (row) out.push(row)
  }
  return out
}

// ---------------------------------------------------------------------------
// ทิศทางเงิน + ยอดรวม
// ---------------------------------------------------------------------------
export type MoneyDirection = 'in' | 'out' | 'none'

/** เงินเข้าร้าน (รับชำระ/รับประกัน) · ออกจากร้าน (คืนเงิน/คืนประกัน) · ไม่มีเงินเคลื่อน (หักเงินประกันเป็นค่าเช่า) */
export function paymentDirection(kind: RentalPaymentKind): MoneyDirection {
  if (kind === 'payment' || kind === 'security_in') return 'in'
  if (kind === 'refund' || kind === 'security_out') return 'out'
  return 'none'
}

/** รายการที่นับเป็นเงินจริง: ยืนยันแล้ว และไม่ถูกยกเลิก (สลิปรอตรวจ/ถูกปฏิเสธไม่นับ) */
export function isCountedPayment(p: Pick<RentalPayment, 'status' | 'voided_at'>): boolean {
  return p.status === 'confirmed' && !p.voided_at
}

/** จำนวนเงินพร้อมเครื่องหมายสำหรับแสดง: เข้า = บวก, ออก = ลบ, หักประกัน = บวก (เป็นรายได้ค่าเช่า แต่ไม่ใช่เงินสด) */
export function signedAmount(p: Pick<RentalPayment, 'kind' | 'amount'>): number {
  return paymentDirection(p.kind) === 'out' ? -p.amount : p.amount
}

export interface MethodTotal {
  in: number
  out: number
  net: number
  count: number
}

export interface DayMoneyTotals {
  /** จำนวนรายการที่นับ (ยืนยันแล้ว ไม่ยกเลิก) */
  count: number
  cash_in: number
  cash_out: number
  /** เงินเข้า − เงินออก (ไม่รวมหักเงินประกัน เพราะไม่มีเงินเคลื่อน) */
  net: number
  /**
   * รายได้ค่าเช่าสุทธิ = รับชำระ − คืนเงินค่าเช่า + หักเงินประกันเป็นค่าเช่า/ค่าปรับ
   * (กติกาเดียวกับรายงาน rental_report: เงินประกันรับ/คืนไม่ใช่รายได้)
   */
  rent_income: number
  by_method: Record<RentalCashMethod, MethodTotal>
  by_kind: Record<RentalPaymentKind, { count: number; amount: number }>
  voided: { count: number; amount: number }
  pending: { count: number; amount: number }
  rejected: { count: number; amount: number }
}

function emptyMethodTotals(): Record<RentalCashMethod, MethodTotal> {
  const out = {} as Record<RentalCashMethod, MethodTotal>
  for (const m of RENTAL_CASH_METHODS) out[m] = { in: 0, out: 0, net: 0, count: 0 }
  return out
}

function emptyKindTotals(): Record<RentalPaymentKind, { count: number; amount: number }> {
  const out = {} as Record<RentalPaymentKind, { count: number; amount: number }>
  for (const k of RENTAL_PAYMENT_KINDS) out[k] = { count: 0, amount: 0 }
  return out
}

/** ยอดรวมของรายการเงินชุดหนึ่ง (เช่น ทั้งวัน) — รวมแบบสตางค์เต็มแล้วปัดตอนท้าย */
export function dayMoneyTotals(rows: readonly RentalPayment[]): DayMoneyTotals {
  const byMethod = emptyMethodTotals()
  const byKind = emptyKindTotals()
  let count = 0
  let cashIn = 0
  let cashOut = 0
  let rentIncome = 0
  const voided = { count: 0, amount: 0 }
  const pending = { count: 0, amount: 0 }
  const rejected = { count: 0, amount: 0 }

  for (const p of rows) {
    const amount = num(p.amount)
    if (p.voided_at) {
      voided.count++
      voided.amount += amount
      continue
    }
    if (p.status === 'pending_review') {
      pending.count++
      pending.amount += amount
      continue
    }
    if (p.status === 'rejected') {
      rejected.count++
      rejected.amount += amount
      continue
    }
    count++
    byKind[p.kind].count++
    byKind[p.kind].amount += amount
    if (p.kind === 'payment' || p.kind === 'security_apply') rentIncome += amount
    if (p.kind === 'refund') rentIncome -= amount
    const dir = paymentDirection(p.kind)
    if (dir === 'none' || p.method === 'none') continue
    const m = byMethod[p.method]
    m.count++
    if (dir === 'in') {
      cashIn += amount
      m.in += amount
    } else {
      cashOut += amount
      m.out += amount
    }
  }

  for (const key of RENTAL_CASH_METHODS) {
    const m = byMethod[key]
    m.in = round2(m.in)
    m.out = round2(m.out)
    m.net = round2(m.in - m.out)
  }
  for (const key of RENTAL_PAYMENT_KINDS) byKind[key].amount = round2(byKind[key].amount)

  return {
    count,
    cash_in: round2(cashIn),
    cash_out: round2(cashOut),
    net: round2(cashIn - cashOut),
    rent_income: round2(rentIncome),
    by_method: byMethod,
    by_kind: byKind,
    voided: { count: voided.count, amount: round2(voided.amount) },
    pending: { count: pending.count, amount: round2(pending.amount) },
    rejected: { count: rejected.count, amount: round2(rejected.amount) },
  }
}

// ---------------------------------------------------------------------------
// ข้อผิดพลาด
// ---------------------------------------------------------------------------
const THAI_RE = /[฀-๿]/

/**
 * error → ข้อความไทย:
 * ยังไม่ได้รันไฟล์ SQL → missingMsg ; สิทธิ์ไม่พอที่ฐานข้อมูลบอกเหตุผลเป็นภาษาไทยมาเอง (42501) → ใช้ข้อความนั้น
 * (thaiError จะเหลือแค่ "ไม่มีสิทธิ์ทำรายการนี้" ซึ่งไม่บอกว่าขาดสิทธิ์อะไร) ; อื่นๆ → thaiError
 */
export function rentalErrorText(err: unknown, missingMsg: string = FIX05_MISSING_MSG): string {
  if (isMigrationMissing(err)) return missingMsg
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; message?: unknown }
    if (String(e.code ?? '') === '42501' && typeof e.message === 'string' && THAI_RE.test(e.message)) return e.message.trim()
  }
  return thaiError(err)
}

/**
 * error มีรหัสของ Postgres/PostgREST = เซิร์ฟเวอร์ตอบจริง (บันทึก/ไม่บันทึกแน่นอน)
 * ไม่มีรหัส = เน็ตหลุด/หมดเวลา → ไม่แน่ใจว่าบันทึกไปแล้วหรือยัง ต้องอ่านสถานะล่าสุดก่อนให้กดซ้ำ
 */
export function serverAnswered(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  if (typeof code !== 'string') return false
  return /^PGRST\d+$/.test(code) || /^(?!E)[0-9A-Z]{5}$/.test(code)
}

/** จำนวนเต็มแบบมีคอมมา (ตัวเลขอารบิก ตรงกับหน้าอื่นของระบบ) */
export function fmtCount(n: number): string {
  return Math.trunc(num(n)).toLocaleString('en-US')
}
