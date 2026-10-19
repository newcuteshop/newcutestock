// ===== ตัวช่วยร่วมของหน้ารายละเอียดการจอง (เรียก RPC / แยกชนิด error / รหัสคำขอค้าง / สิทธิ์ปุ่ม / ป้ายประวัติ) =====
// ใช้ฝั่งเบราว์เซอร์เท่านั้น (ทุกฟังก์ชันที่แตะ window ถูกเรียกจากปุ่ม/เอฟเฟกต์)
// หลักการเขียนข้อมูลเงิน/การจอง:
//   - กดซ้ำไม่ได้ระหว่างรอ (busyRef ในแต่ละป็อปอัป)
//   - รายการเงินใช้ client_id เดิมทุกครั้งที่ส่งซ้ำ (เซิร์ฟเวอร์คืนรายการเดิม already_saved) — รหัสค้างเก็บนอกป็อปอัป (pendingIds)
//   - "ไม่รู้ผล" (เน็ตหลุด/หมดเวลา) → โหลดการจองใหม่ก่อนให้กดซ้ำ ถ้าข้อมูลใหม่แสดงว่าสำเร็จแล้ว ถือว่าสำเร็จ (ไม่ทำซ้ำ)
import { thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { round2 } from '@/lib/money'
import type { BrowserSupabase } from '@/lib/products'
import {
  CHARGE_KIND_LABELS, CONDITION_LABELS, FIX05_MISSING_MSG, METHOD_LABELS, PAYMENT_KIND_LABELS,
  RENTAL_CHARGE_KINDS, RENTAL_CONDITIONS, RENTAL_PAYMENT_KINDS, RENTAL_PAYMENT_METHODS, STATUS_LABELS,
  RENTAL_BOOKING_STATUSES, parseBookingResult,
  type RentalBooking, type RentalBookingStatus, type RentalCashMethod, type RentalPaymentKind, type RentalLog,
} from '@/lib/rental'

export const RPC_TIMEOUT_MS = 30000
export const UNSURE_MSG =
  'ไม่แน่ใจว่าบันทึกแล้วหรือยัง (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — ตรวจข้อมูลล่าสุดด้านล่างก่อน แล้วกดอีกครั้งได้ ระบบจะไม่บันทึกซ้ำ'
export const RELOAD_FAIL_MSG = 'โหลดข้อมูลการจองล่าสุดไม่สำเร็จ — ตรวจอินเทอร์เน็ตแล้วกด "โหลดใหม่"'

// ---------------------------------------------------------------------------
// เรียก RPC พร้อมหมดเวลา
// ---------------------------------------------------------------------------
export type RpcResult = { ok: true; data: unknown } | { ok: false; error: unknown; answered: boolean }

/** เรียก RPC (หมดเวลา 30 วินาที) — ไม่ throw ; answered = เซิร์ฟเวอร์ตอบกลับจริง (มีรหัส error ของฐานข้อมูล) */
export async function callRpc(
  sb: BrowserSupabase,
  fn: string,
  args: Record<string, unknown>,
  timeoutMs = RPC_TIMEOUT_MS,
): Promise<RpcResult> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = setTimeout(() => ctrl?.abort(), timeoutMs)
  try {
    let req = sb.rpc(fn, args)
    if (ctrl) req = req.abortSignal(ctrl.signal)
    const { data, error } = await req
    if (error) return { ok: false, error, answered: serverAnswered(error) }
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: err, answered: serverAnswered(err) }
  } finally {
    clearTimeout(timer)
  }
}

// error มาจากเซิร์ฟเวอร์จริง (มีรหัส Postgres/PostgREST) — ไม่ใช่เน็ตหลุด/หมดเวลา (แบบเดียวกับ components/pos/ReturnDialog)
export function serverAnswered(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  if (typeof code !== 'string') return false
  return /^PGRST\d+$/.test(code) || /^(?!E)[0-9A-Z]{5}$/.test(code)
}

/**
 * เซิร์ฟเวอร์ปฏิเสธ "หลัง" ตรวจรหัสคำขอซ้ำแล้ว = รหัสนี้ไม่เคยถูกบันทึกแน่นอน (ทิ้งรหัสได้)
 * สิทธิ์/การเข้าสู่ระบบ/รหัสคำขอหาย ถูกตรวจ "ก่อน" ; error ชั่วคราวของฐานข้อมูล (หมดเวลา/ล็อกชน/การเชื่อมต่อ)
 * หรือ "กำลังบันทึกจากอีกเครื่อง" = คำขอเดิมอาจยังทำงานค้างอยู่ → สรุปไม่ได้ ต้องเก็บรหัสเดิมไว้
 */
export function rejectedAfterDuplicateCheck(err: unknown): boolean {
  if (!serverAnswered(err)) return false
  const e = err as { code?: unknown; message?: unknown }
  const code = String(e.code)
  const message = typeof e.message === 'string' ? e.message : ''
  if (code === '42501' || code.startsWith('PGRST')) return false
  if (/^(08|40|53|55|57|58|XX)/.test(code)) return false
  if (/เข้าสู่ระบบ|ไม่มีสิทธิ์|รหัสคำขอ|กำลังบันทึกจากอีกเครื่อง/.test(message)) return false
  return true
}

// ข้อความสิทธิ์ภาษาไทยจาก RPC ของเรา (42501) บอกชัดกว่าข้อความกลางของ thaiError
export function errorText(err: unknown): string {
  if (isMigrationMissing(err)) return FIX05_MISSING_MSG
  const e = err && typeof err === 'object' ? (err as { code?: unknown; message?: unknown }) : null
  if (e && e.code === '42501' && typeof e.message === 'string' && /[฀-๿]/.test(e.message)) return e.message.trim()
  return thaiError(err)
}

// ---------------------------------------------------------------------------
// เขียนข้อมูลการจอง (RPC ที่คืน booking json) + จัดการ "ไม่รู้ผล"
// ---------------------------------------------------------------------------
export type WriteResult =
  | { status: 'ok'; booking: RentalBooking; data: unknown; verified: boolean }
  | { status: 'rejected'; message: string; definite: boolean }
  | { status: 'unsure'; message: string; booking: RentalBooking | null }

/**
 * เรียก RPC ที่เปลี่ยนการจอง แล้วอ่าน booking จากผล ({booking} หรือ booking ตรงๆ)
 * - ตอบกลับแต่อ่านไม่ได้ / ไม่ได้คำตอบ → โหลดการจองใหม่ (reload) แล้วถาม verify ว่าข้อมูลใหม่แสดงว่าสำเร็จหรือยัง
 *   สำเร็จแล้ว → status 'ok' (verified = true) · ยังไม่ใช่ → 'unsure' (ให้ผู้ใช้ดูข้อมูลล่าสุดก่อนกดซ้ำ)
 */
export async function runBookingWrite(opts: {
  sb: BrowserSupabase
  fn: string
  args: Record<string, unknown>
  reload: () => Promise<RentalBooking | null>
  verify?: (fresh: RentalBooking) => boolean
}): Promise<WriteResult> {
  const res = await callRpc(opts.sb, opts.fn, opts.args)
  if (res.ok) {
    const booking = parseBookingResult(res.data)
    if (booking) return { status: 'ok', booking, data: res.data, verified: false }
  } else if (res.answered) {
    // ถูกปฏิเสธ (เช่น สถานะเปลี่ยนไปแล้วจากอีกเครื่อง/หมดเวลาถือคิว) → โหลดการจองใหม่เบื้องหลัง
    // ให้ปุ่ม/ยอดเงินบนจอตรงกับความจริง โดยไม่ต้องรอ (ข้อความ error แสดงทันที)
    void opts.reload().catch(() => null)
    return { status: 'rejected', message: errorText(res.error), definite: rejectedAfterDuplicateCheck(res.error) }
  }
  // ไม่รู้ผล → ดูข้อมูลจริงก่อน
  const fresh = await opts.reload()
  if (fresh && opts.verify && opts.verify(fresh)) {
    return { status: 'ok', booking: fresh, data: res.ok ? res.data : null, verified: true }
  }
  return { status: 'unsure', message: fresh ? UNSURE_MSG : `${UNSURE_MSG} (${RELOAD_FAIL_MSG})`, booking: fresh }
}

/**
 * คำขอที่ไม่ใช่รายการเงินแต่ส่ง client_id (เพิ่มค่าปรับ rental_add_charge / ต่อเวลาถือ rental_extend_hold)
 * ไม่รู้ผล → เก็บรหัสเดิม + ค่าที่ส่งไว้นอกป็อปอัป (ปิดแล้วเปิดใหม่ก็ส่งซ้ำด้วยรหัสเดิม) — ฐานข้อมูลเห็นรหัสเดิม = คืนการจองตามเดิม ไม่ทำซ้ำ
 * key = pendingKey(booking_id, 'charge' | 'hold') · ล้างเมื่อรู้ผลแน่นอนเท่านั้น
 */
export interface PendingWrite<T> {
  clientId: string
  args: T
}
const pendingWrites = new Map<string, PendingWrite<unknown>>()

export function getPendingWrite<T>(key: string): PendingWrite<T> | null {
  return (pendingWrites.get(key) as PendingWrite<T> | undefined) ?? null
}
export function setPendingWrite<T>(key: string, p: PendingWrite<T>): void {
  pendingWrites.set(key, p)
}
export function clearPendingWrite(key: string, clientId: string): void {
  if (pendingWrites.get(key)?.clientId === clientId) pendingWrites.delete(key)
}
/** ฐานข้อมูลบอกว่ารหัสคำขอนี้ผูกกับการจองอื่นแล้ว (แทบไม่เกิด — รหัสสุ่ม) → ต้องใช้รหัสใหม่ */
export function clientIdTakenElsewhere(message: string): boolean {
  return /ถูกใช้กับการจองอื่นแล้ว/.test(message)
}
export const RESUME_WRITE_MSG =
  'คำขอครั้งก่อนยังไม่ทราบผล (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — กด "ส่งอีกครั้ง" ได้เลย ถ้าบันทึกไปแล้วจะได้ผลเดิม ไม่บันทึกซ้ำ'

// ---------------------------------------------------------------------------
// รหัสคำขอ (client_id) ที่ยังไม่รู้ผล — อยู่นอกอายุของป็อปอัป: ปิดแล้วเปิดใหม่ต้องได้รหัสเดิม + ข้อมูลเดิม
// key = '<booking_id>|<ช่อง>' เช่น 'abc|pay:payment', 'abc|settle:apply'
// ล้างเมื่อรู้ผลแน่นอนเท่านั้น (สำเร็จ รวม already_saved / ถูกปฏิเสธหลังตรวจรหัสซ้ำ)
// ---------------------------------------------------------------------------
export interface PendingPayment {
  clientId: string
  kind: RentalPaymentKind
  method: RentalCashMethod | 'none'
  amount: number
  note: string
}
const pendingIds = new Map<string, PendingPayment>()

export function pendingKey(bookingId: string, slot: string): string {
  return `${bookingId}|${slot}`
}
export function getPending(key: string): PendingPayment | null {
  return pendingIds.get(key) ?? null
}
export function setPending(key: string, p: PendingPayment): void {
  pendingIds.set(key, p)
}
export function clearPending(key: string, clientId: string): void {
  if (pendingIds.get(key)?.clientId === clientId) pendingIds.delete(key)
}

// ---------------------------------------------------------------------------
// ปุ่มที่ทำได้ (ตาม actions จากเซิร์ฟเวอร์ + ช่องที่ตัวอ่านใน lib/rental ยังไม่มี คิดจากสถานะ/ยอดเงินตามกฎเดียวกับ SQL)
// ---------------------------------------------------------------------------
export interface BookingFlags {
  edit: boolean
  confirm: boolean
  extendHold: boolean
  cancel: boolean
  noShow: boolean
  pickup: boolean
  extend: boolean
  ret: boolean
  complete: boolean
  pay: boolean
  refund: boolean
  securityIn: boolean
  securityOut: boolean
  securityApply: boolean
  addCharge: boolean
  /** คืนชุดแล้วแต่ยังมียอดค้าง/รับเกิน/ถือเงินประกัน → เปิดหน้าสรุปเงินคืน */
  settle: boolean
}

const EPS = 0.005

export function bookingFlags(b: RentalBooking): BookingFlags {
  const s = b.status
  const m = b.money
  const a = b.actions
  // เซิร์ฟเวอร์ส่ง actions มาไหม (อ่านไม่ได้ = ทุกช่อง false และไม่มีเหตุผล) — ไม่มี → คิดจากสถานะเองทั้งหมด
  const server = a.can_edit || a.can_confirm || a.can_cancel || a.can_no_show || a.can_pickup || a.can_extend
    || a.can_return || a.can_complete || a.can_pay || a.can_refund || Object.keys(a.block_reasons).length > 0
  const today = todayKeySafe()
  const local = {
    edit: s === 'pending' || s === 'confirmed',
    confirm: s === 'pending',
    cancel: s === 'pending' || s === 'confirmed',
    noShow: s === 'confirmed' && today !== '' && b.pickup_date < today,
    pickup: s === 'pending' || s === 'confirmed',
    extend: s === 'confirmed' || s === 'picked_up',
    ret: s === 'picked_up',
    complete: s === 'returned' && Math.abs(m.due) < EPS && m.security_held < EPS,
    pay: (s === 'pending' || s === 'confirmed' || s === 'picked_up' || s === 'returned') && m.due > EPS,
    refund: m.paid > EPS,
  }
  const base = server
    ? {
        edit: a.can_edit, confirm: a.can_confirm, cancel: a.can_cancel, noShow: a.can_no_show, pickup: a.can_pickup,
        extend: a.can_extend, ret: a.can_return, complete: a.can_complete, pay: a.can_pay, refund: a.can_refund,
      }
    : local
  return {
    ...base,
    // ปิดงานแล้ว = เงินของการจองเปลี่ยนไม่ได้ (ยกเลิกรายการเงินก็ไม่ได้) → ไม่เสนอคืนเงินค่าเช่า
    // (คืนเงินทั้งก้อนบนงานที่ปิดแล้ว = ยอดค้างกลับมาแต่รับชำระไม่ได้อีก)
    refund: base.refund && s !== 'completed',
    // ใช้ค่าที่เซิร์ฟเวอร์ส่งมาถ้ามี (null = ไม่ได้ส่ง → คิดจากสถานะด้วยกฎเดียวกับ rental_booking_json)
    extendHold: a.can_extend_hold ?? s === 'pending',
    securityIn: a.can_security_in ?? ((s === 'confirmed' || s === 'picked_up') && round2(m.security_required - m.security_held) > EPS),
    securityOut: a.can_security_out ?? ((s === 'picked_up' || s === 'returned' || s === 'cancelled' || s === 'no_show') && m.security_held > EPS),
    securityApply: a.can_security_apply ?? ((s === 'picked_up' || s === 'returned') && m.security_held > EPS && m.due > EPS),
    addCharge: a.can_add_charge ?? (s === 'picked_up' || s === 'returned'),
    settle: s === 'returned' && (Math.abs(m.due) >= EPS || m.security_held >= EPS),
  }
}

/** ยอดมัดจำที่ยังต้องจ่าย (มัดจำที่ต้องจ่าย − ชำระแล้ว ไม่เกินยอดค้าง) ; ครบแล้ว = 0 */
export function depositOutstanding(b: RentalBooking): number {
  const m = b.money
  if (m.deposit_met) return 0
  return Math.max(0, Math.min(round2(m.deposit_required - m.paid), m.due))
}

/** รับชำระ: ตั้งต้นที่ยอดมัดจำ (มัดจำยังไม่ครบ และน้อยกว่ายอดค้างทั้งหมด) — ป้ายปุ่มกับยอดตั้งต้นในป็อปอัปใช้กฎเดียวกัน */
export function payDepositFirst(b: RentalBooking): boolean {
  const dep = depositOutstanding(b)
  return dep > EPS && dep < b.money.due - EPS
}

/** เงินประกันที่ยังต้องเก็บ */
export function securityShort(b: RentalBooking): number {
  return Math.max(0, round2(b.money.security_required - b.money.security_held))
}

/** ยอดสูงสุดที่บันทึกได้ของรายการเงินแต่ละชนิด (กฎเดียวกับ rental_add_payment_core) */
export function maxPaymentAmount(b: RentalBooking, kind: RentalPaymentKind): number {
  const m = b.money
  switch (kind) {
    case 'payment': return Math.max(0, m.due)
    case 'refund': return Math.max(0, m.paid)
    case 'security_in': return securityShort(b)
    case 'security_out': return Math.max(0, m.security_held)
    case 'security_apply': return Math.max(0, Math.min(m.security_held, m.due))
  }
}

/** ชนิดรายการเงินที่ทำได้ตอนนี้ (เรียงตามที่ใช้บ่อย) */
export function allowedPaymentKinds(f: BookingFlags): RentalPaymentKind[] {
  const out: RentalPaymentKind[] = []
  if (f.pay) out.push('payment')
  if (f.securityIn) out.push('security_in')
  if (f.securityApply) out.push('security_apply')
  if (f.securityOut) out.push('security_out')
  if (f.refund) out.push('refund')
  return out
}

// ---------------------------------------------------------------------------
// วันที่ / ลิงก์ / คลิปบอร์ด
// ---------------------------------------------------------------------------
const ymd = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', calendar: 'gregory', numberingSystem: 'latn',
})

/** day key วันนี้ตามเวลาไทย ; ใช้นอกเบราว์เซอร์/อ่านไม่ได้ → '' */
export function todayKeySafe(): string {
  try {
    const parts = ymd.formatToParts(new Date())
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
    const y = get('year')
    const m = get('month')
    const d = get('day')
    return y && m && d ? `${y}-${m}-${d}` : ''
  } catch {
    return ''
  }
}

/** ลิงก์เต็มจาก path (เช่น /book/status/<token>) — ฝั่งเซิร์ฟเวอร์คืน path เดิม */
export function absoluteUrl(path: string | null | undefined): string {
  if (!path) return ''
  if (typeof window === 'undefined') return path
  return `${window.location.origin}${path.startsWith('/') ? '' : '/'}${path}`
}

/** คัดลอกข้อความ (clipboard API → สำรองด้วย textarea ชั่วคราว) → สำเร็จหรือไม่ */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // ลองวิธีสำรองต่อ
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = value
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '0'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

/** ลิงก์ LINE ของลูกค้าจาก LINE ID (เปิดหน้าเพิ่มเพื่อน) ; ว่าง → '' */
export function lineIdUrl(lineId: string | null | undefined): string {
  const id = String(lineId ?? '').trim()
  if (!id) return ''
  // LINE ID ส่วนตัวใช้ ~ นำหน้า, บัญชีทางการ (ขึ้นต้น @) ใช้ /R/ti/p/@id
  return id.startsWith('@')
    ? `https://line.me/R/ti/p/${encodeURIComponent(id)}`
    : `https://line.me/ti/p/~${encodeURIComponent(id)}`
}

// ---------------------------------------------------------------------------
// ประวัติการจอง (rental_logs) → ข้อความไทย
// ---------------------------------------------------------------------------
const LOG_LABELS: Record<string, string> = {
  create: 'สร้างการจอง',
  online_request: 'ลูกค้าส่งคำขอจองออนไลน์',
  update: 'แก้ไขการจอง',
  confirm: 'ยืนยันการจอง',
  extend_hold: 'ต่อเวลาถือการจอง',
  expire: 'หมดเวลาถือการจอง',
  cancel: 'ยกเลิกการจอง',
  public_cancel: 'ลูกค้ายกเลิกคำขอจอง',
  no_show: 'ลูกค้าไม่มารับชุด',
  pickup: 'ลูกค้ารับชุด',
  extend: 'เปลี่ยนวันคืนชุด',
  return: 'รับคืนชุด',
  charge_add: 'เพิ่มค่าปรับ / ค่าใช้จ่าย',
  charge_void: 'ยกเลิกค่าปรับ / ค่าใช้จ่าย',
  complete: 'ปิดงาน',
  payment: 'บันทึกรายการเงิน',
  payment_void: 'ยกเลิกรายการเงิน',
  slip_add: 'ลูกค้าแนบสลิปโอนเงิน',
  slip_approve: 'อนุมัติสลิป',
  slip_reject: 'ไม่อนุมัติสลิป',
  blacklist_override: 'จองให้ลูกค้าในบัญชีดำ (ยืนยันแล้ว)',
  blacklist_flag: 'คำขอจองจากลูกค้าในบัญชีดำ — ตรวจก่อนยืนยัน',
}

type Detail = Record<string, unknown> | null

function dText(d: Detail, k: string): string {
  if (!d) return ''
  const v = d[k]
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return ''
}

function dNum(d: Detail, k: string): number | null {
  if (!d) return null
  const v = d[k]
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function dBool(d: Detail, k: string): boolean {
  if (!d) return false
  const v = d[k]
  return v === true || v === 'true'
}

function oneOfLabel<T extends string>(v: string, allowed: readonly T[], labels: Readonly<Record<T, string>>): string {
  return (allowed as readonly string[]).includes(v) ? labels[v as T] : v
}

export interface LogView {
  label: string
  lines: string[]
}

/**
 * ประวัติ 1 รายการ → หัวข้อ + รายละเอียดสั้นๆ (ข้อความไทย)
 * fmtMoney / fmtDay ส่งเข้ามา (lib/format) เพื่อให้ไฟล์นี้ไม่ผูกกับรูปแบบแสดงผล
 */
export function describeLog(
  log: RentalLog,
  fmtMoney: (n: number) => string,
  fmtDay: (key: string) => string,
): LogView {
  const d = log.detail
  const label = LOG_LABELS[log.action] ?? (log.action || 'รายการ')
  const lines: string[] = []
  const money = (k: string, prefix: string) => {
    const n = dNum(d, k)
    if (n !== null) lines.push(`${prefix} ${fmtMoney(n)}`)
  }
  switch (log.action) {
    case 'create': {
      const st = dText(d, 'status')
      if (st) lines.push(`สถานะเริ่มต้น: ${oneOfLabel(st, RENTAL_BOOKING_STATUSES, STATUS_LABELS)}`)
      const from = dText(d, 'pickup_date')
      const to = dText(d, 'return_date')
      if (from && to) lines.push(`รับ ${fmtDay(from)} – คืน ${fmtDay(to)}`)
      break
    }
    case 'payment': {
      const kind = dText(d, 'kind')
      const method = dText(d, 'method')
      const parts = [
        kind ? oneOfLabel(kind, RENTAL_PAYMENT_KINDS, PAYMENT_KIND_LABELS) : '',
        method && method !== 'none' ? oneOfLabel(method, RENTAL_PAYMENT_METHODS, METHOD_LABELS) : '',
      ].filter(Boolean)
      const amount = dNum(d, 'amount')
      if (parts.length || amount !== null) lines.push(`${parts.join(' · ')}${amount !== null ? ` ${fmtMoney(amount)}` : ''}`.trim())
      const no = dText(d, 'receipt_no')
      if (no) lines.push(`ใบเสร็จ ${no}`)
      break
    }
    case 'payment_void': {
      const kind = dText(d, 'kind')
      const amount = dNum(d, 'amount')
      const no = dText(d, 'receipt_no')
      lines.push([no, kind ? oneOfLabel(kind, RENTAL_PAYMENT_KINDS, PAYMENT_KIND_LABELS) : '', amount !== null ? fmtMoney(amount) : '']
        .filter(Boolean).join(' · '))
      break
    }
    case 'extend_hold': {
      const h = dNum(d, 'hours')
      if (h !== null) lines.push(`เพิ่ม ${h} ชั่วโมง`)
      break
    }
    case 'extend': {
      const o = dText(d, 'old_return_date')
      const n = dText(d, 'new_return_date')
      if (o && n) lines.push(`วันคืน ${fmtDay(o)} → ${fmtDay(n)}`)
      const a = dNum(d, 'rent_total_old')
      const b = dNum(d, 'rent_total_new')
      if (a !== null && b !== null && Math.abs(a - b) >= EPS) lines.push(`ค่าเช่ารวม ${fmtMoney(a)} → ${fmtMoney(b)}`)
      if (d && d.reprice === false) lines.push('ไม่คิดค่าเช่าเพิ่ม')
      break
    }
    case 'pickup': {
      lines.push(dBool(d, 'id_checked') ? 'ตรวจบัตรแล้ว' : 'ไม่ได้ตรวจบัตร')
      if (dBool(d, 'auto_confirmed')) lines.push('ยืนยันการจองอัตโนมัติ')
      if (dBool(d, 'forced')) {
        const r = dText(d, 'force_reason')
        lines.push(`รับทั้งที่มีข้อควรระวัง${r ? `: ${r}` : ''}`)
      }
      const swaps = d && Array.isArray(d.swaps) ? d.swaps : []
      const codes = swaps
        .map(s => (s && typeof s === 'object' ? (s as Record<string, unknown>).unit_code : null))
        .filter((c): c is string => typeof c === 'string' && c !== '')
      if (codes.length) lines.push(`สลับชิ้นเป็น ${codes.join(', ')}`)
      const note = dText(d, 'note')
      if (note) lines.push(note)
      break
    }
    case 'return': {
      const on = dText(d, 'returned_on')
      if (on) lines.push(`คืนวันที่ ${fmtDay(on)}`)
      const late = dNum(d, 'late_days')
      if (late !== null && late > 0) lines.push(`คืนช้า ${late} วัน`)
      const items = d && Array.isArray(d.lines) ? d.lines : []
      const conds = items
        .map(x => {
          if (!x || typeof x !== 'object') return ''
          const o = x as Record<string, unknown>
          const code = typeof o.unit_code === 'string' ? o.unit_code : ''
          const c = typeof o.condition === 'string' ? oneOfLabel(o.condition, RENTAL_CONDITIONS, CONDITION_LABELS) : ''
          return code ? `${code} ${c}`.trim() : ''
        })
        .filter(Boolean)
      if (conds.length) lines.push(conds.join(' · '))
      const ch = dNum(d, 'charges_added')
      if (ch !== null && ch > 0) lines.push(`ค่าปรับ/ค่าใช้จ่าย ${fmtMoney(ch)}`)
      const note = dText(d, 'note')
      if (note) lines.push(note)
      break
    }
    case 'charge_add': {
      const kind = dText(d, 'kind')
      const desc = dText(d, 'description')
      const amount = dNum(d, 'amount')
      lines.push([desc || (kind ? oneOfLabel(kind, RENTAL_CHARGE_KINDS, CHARGE_KIND_LABELS) : ''), amount !== null ? fmtMoney(amount) : '']
        .filter(Boolean).join(' '))
      break
    }
    case 'charge_void':
      money('amount', 'ยอด')
      break
    case 'slip_add':
      money('amount', 'ยอดที่แจ้งโอน')
      break
    case 'slip_approve': {
      money('amount', 'ยอดที่อนุมัติ')
      if (dBool(d, 'auto_confirmed')) lines.push('ยืนยันการจองอัตโนมัติ')
      break
    }
    case 'slip_reject':
      money('amount', 'ยอดที่แจ้ง')
      break
    case 'complete':
      money('grand_total', 'ยอดรวม')
      break
    case 'confirm':
      if (d && 'by_slip' in d) lines.push('ยืนยันจากการอนุมัติสลิป')
      break
    case 'update': {
      // fix-05 ส่งคู่ [เดิม, ใหม่] เฉพาะช่องที่เปลี่ยน
      const pair = (k: string): [string, string] | null => {
        const v = d ? d[k] : null
        if (!Array.isArray(v) || v.length !== 2) return null
        const a = v[0] === null || v[0] === undefined ? '' : String(v[0])
        const b = v[1] === null || v[1] === undefined ? '' : String(v[1])
        return a && b ? [a, b] : null
      }
      // วันรับ/วันคืนส่งมาคู่กันเสมอเมื่อมีวันใดวันหนึ่งเปลี่ยน
      const pk = pair('pickup_date')
      const rt = pair('return_date')
      if (pk && rt && (pk[0] !== pk[1] || rt[0] !== rt[1])) {
        lines.push(`วันเช่า ${fmtDay(pk[0])} – ${fmtDay(rt[0])} → ${fmtDay(pk[1])} – ${fmtDay(rt[1])}`)
      }
      if (dBool(d, 'customer_changed')) lines.push('เปลี่ยนลูกค้า')
      const disc = pair('discount')
      if (disc && disc[0] !== disc[1]) {
        const a = Number(disc[0])
        const b = Number(disc[1])
        if (Number.isFinite(a) && Number.isFinite(b)) lines.push(`ส่วนลด ${fmtMoney(a)} → ${fmtMoney(b)}`)
      }
      const n = dNum(d, 'lines')
      if (n !== null) lines.push(`รายการชุด ${n} รายการ`)
      break
    }
    case 'online_request':
      if (dBool(d, 'linked_existing_customer')) {
        lines.push(dBool(d, 'name_differs')
          ? 'เบอร์โทรตรงกับลูกค้าเดิม แต่ชื่อที่กรอกไม่ตรง — ตรวจก่อนยืนยัน'
          : 'เบอร์โทรตรงกับลูกค้าเดิม (ผูกกับประวัติเดิม)')
        const nm = dText(d, 'name')
        if (nm && dBool(d, 'name_differs')) lines.push(`ชื่อที่กรอก: ${nm}`)
      }
      if (dBool(d, 'blacklisted')) lines.push('ลูกค้าอยู่ในบัญชีดำ')
      break
    default:
      break
  }
  const reason = dText(d, 'reason')
  if (reason) lines.push(`เหตุผล: ${reason}`)
  return { label, lines: lines.filter(l => l.trim() !== '') }
}

/** สถานะนี้เลยขั้นนั้นไปแล้วหรือยัง (ใช้ตรวจผลหลัง "ไม่รู้ผล") */
const STATUS_ORDER: Record<RentalBookingStatus, number> = {
  pending: 0, confirmed: 1, picked_up: 2, returned: 3, completed: 4, cancelled: 9, expired: 9, no_show: 9,
}
export function statusAtLeast(s: RentalBookingStatus, target: RentalBookingStatus): boolean {
  return STATUS_ORDER[s] >= STATUS_ORDER[target] && STATUS_ORDER[s] < 9
}
