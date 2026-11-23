// ===== การเงินร้าน b.oncloud: แถวรายการเงิน (ตาราง wed_payments + งาน) และยอดรวมของช่วงวันที่ =====
// ใช้ร่วมกันในหน้าการเงิน (/wedding/payments) และใบสรุปยอด 80 มม. (WedPaymentsPrint)
// ไม่มี hook / ไม่แตะ window → ใช้ได้ทั้ง server และ client
// วันของรายการ = paid_on (วันที่เงินเข้า/ออกจริงที่บันทึกไว้ — กติกาเดียวกับรายงาน wed_report)
// รายการที่ยกเลิก (voided_at) ไม่นับในยอด แต่ยังแสดงในรายการ (ขีดฆ่า) เพื่อให้ตรวจย้อนได้
import { addDaysToKey, isDayKey } from '@/lib/format'
import { num, round2 } from '@/lib/money'
import {
  WED_PAYMENT_METHODS, WED_PAYMENT_PURPOSES, parseWedPaymentRow,
  type WedPaymentMethod, type WedPaymentPurpose, type WedPaymentRow,
} from '@/lib/wedding'

/** คอลัมน์ที่ select จาก wed_payments (RLS: พนักงาน b.oncloud) + งานที่ผูกอยู่ (booking_id → wed_bookings) ในคำขอเดียว */
export const WED_PAYMENT_COLUMNS =
  'id, receipt_no, kind, method, amount, paid_on, purpose, slip_path, note, voided_at, void_reason, ' +
  'created_by_name, created_at, booking_id, booking:wed_bookings(id, booking_no, couple_names)'

export function parseWedPaymentRows(raw: unknown): WedPaymentRow[] {
  const out: WedPaymentRow[] = []
  if (!Array.isArray(raw)) return out
  for (const r of raw) {
    const row = parseWedPaymentRow(r)
    if (row) out.push(row)
  }
  return out
}

/** เงินของรายการนี้ (รับ = บวก · คืน = ลบ) */
export function signedAmount(p: Pick<WedPaymentRow, 'kind' | 'amount'>): number {
  return p.kind === 'refund' ? -p.amount : p.amount
}

export function isCounted(p: Pick<WedPaymentRow, 'voided_at'>): boolean {
  return !p.voided_at
}

export interface MethodTotal {
  in: number
  out: number
  net: number
  count: number
}

export interface DayTotal {
  day: string
  count: number
  in: number
  out: number
  net: number
}

export interface WedMoneyTotals {
  /** จำนวนรายการที่นับ (ไม่ยกเลิก) */
  count: number
  payments: { count: number; amount: number }
  refunds: { count: number; amount: number }
  /** รับ − คืน */
  net: number
  by_method: Record<WedPaymentMethod, MethodTotal>
  /** รับชำระแยกตามวัตถุประสงค์ (ไม่มีวัตถุประสงค์ = อื่นๆ) */
  by_purpose: Record<WedPaymentPurpose, { count: number; amount: number }>
  voided: { count: number; amount: number }
  /** รายวัน (เก่า → ใหม่) — ใช้ตอนดูทั้งเดือน */
  by_day: DayTotal[]
}

/** ยอดรวมของรายการเงินชุดหนึ่ง — รวมแบบสตางค์เต็มแล้วปัดตอนท้าย */
export function moneyTotals(rows: readonly WedPaymentRow[]): WedMoneyTotals {
  const byMethod = {} as Record<WedPaymentMethod, MethodTotal>
  for (const m of WED_PAYMENT_METHODS) byMethod[m] = { in: 0, out: 0, net: 0, count: 0 }
  const byPurpose = {} as Record<WedPaymentPurpose, { count: number; amount: number }>
  for (const p of WED_PAYMENT_PURPOSES) byPurpose[p] = { count: 0, amount: 0 }
  const days = new Map<string, DayTotal>()
  const payments = { count: 0, amount: 0 }
  const refunds = { count: 0, amount: 0 }
  const voided = { count: 0, amount: 0 }
  let count = 0

  for (const p of rows) {
    const amount = num(p.amount)
    if (p.voided_at) {
      voided.count++
      voided.amount += amount
      continue
    }
    count++
    const m = byMethod[p.method]
    m.count++
    const dayKey = p.paid_on && isDayKey(p.paid_on) ? p.paid_on : ''
    let d = dayKey ? days.get(dayKey) : undefined
    if (dayKey && !d) {
      d = { day: dayKey, count: 0, in: 0, out: 0, net: 0 }
      days.set(dayKey, d)
    }
    if (d) d.count++
    if (p.kind === 'refund') {
      refunds.count++
      refunds.amount += amount
      m.out += amount
      if (d) d.out += amount
    } else {
      payments.count++
      payments.amount += amount
      m.in += amount
      if (d) d.in += amount
      const purpose = byPurpose[p.purpose ?? 'other']
      purpose.count++
      purpose.amount += amount
    }
  }

  for (const key of WED_PAYMENT_METHODS) {
    const m = byMethod[key]
    m.in = round2(m.in)
    m.out = round2(m.out)
    m.net = round2(m.in - m.out)
  }
  for (const key of WED_PAYMENT_PURPOSES) byPurpose[key].amount = round2(byPurpose[key].amount)
  const byDay = Array.from(days.values())
    .map(d => ({ ...d, in: round2(d.in), out: round2(d.out), net: round2(d.in - d.out) }))
    .sort((a, b) => a.day.localeCompare(b.day))

  return {
    count,
    payments: { count: payments.count, amount: round2(payments.amount) },
    refunds: { count: refunds.count, amount: round2(refunds.amount) },
    net: round2(payments.amount - refunds.amount),
    by_method: byMethod,
    by_purpose: byPurpose,
    voided: { count: voided.count, amount: round2(voided.amount) },
    by_day: byDay,
  }
}

// ---------------------------------------------------------------------------
// ช่วงวันที่ของหน้า (วัน / เดือน)
// ---------------------------------------------------------------------------
export type PeriodMode = 'day' | 'month'

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

export function isMonthKey(v: unknown): v is string {
  return typeof v === 'string' && MONTH_RE.test(v)
}

/** วันแรก–วันสุดท้ายของเดือน 'YYYY-MM' */
export function monthRange(month: string): { from: string; to: string } {
  const first = `${month}-01`
  const m = MONTH_RE.exec(month)
  if (!m) return { from: first, to: first }
  const y = Number(m[1])
  const mo = Number(m[2])
  const nextFirst = mo === 12 ? `${y + 1}-01-01` : `${m[1]}-${String(mo + 1).padStart(2, '0')}-01`
  return { from: first, to: addDaysToKey(nextFirst, -1) }
}

/** เลื่อนเดือนไป n เดือน (ติดลบ = ย้อน) */
export function addMonths(month: string, n: number): string {
  const m = MONTH_RE.exec(month)
  if (!m) return month
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + Math.trunc(n)
  const y = Math.floor(idx / 12)
  return `${String(y).padStart(4, '0')}-${String((idx % 12) + 1).padStart(2, '0')}`
}

/** รายการเดือนให้เลือก: เดือนนี้ย้อนหลัง count เดือน (ใหม่ → เก่า) */
export function recentMonths(thisMonth: string, count = 36): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i++) out.push(addMonths(thisMonth, -i))
  return out
}
