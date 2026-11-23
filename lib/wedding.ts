// ===== ร้าน b.oncloud (คอนเทนต์งานแต่ง): ชนิดข้อมูล + ตัวอ่าน JSON ของ RPC (supabase-fix-07-wedding.sql) =====
// ใช้ได้ทั้ง server และ client (ไม่มี import ฝั่งเซิร์ฟเวอร์ ไม่แตะ window/document ตอนโหลดไฟล์) — แบบเดียวกับ lib/rental.ts
// ตัวอ่าน (parse*) ไม่ throw เด็ดขาด: ค่าแปลก/หายไป → ค่าปลอดภัย (เงิน = 0 ปัด 2 ตำแหน่ง, ข้อความ = '' หรือ null, ธง = false)
//   - ตัวอ่าน "รายการเดียว" (งาน/แพ็กเกจ/ลูกค้า/ทีมงาน/ชิ้นงานส่ง/รายการเงิน ...) → null เมื่อไม่ใช่ object หรือไม่มีรหัสหลัก
//   - ตัวอ่าน "ภาพรวม" (ตั้งค่า/ปฏิทิน/วัน/วันนี้/ตัวเลขเมนู/รายงาน/หน้าลูกค้า ...) → คืนค่าเสมอ (ไม่มีข้อมูล = รายการว่าง)
// numeric จาก PostgREST อาจมาเป็นสตริง → ทุกช่องเงินผ่าน num + round2 (lib/money.ts)
// ช่องที่ "เฉพาะผู้จัดการ" (ค่าจ้างทีม / ต้นทุนทีม / กำไร / รายได้เดือนนี้) ฐานข้อมูลไม่ส่งมาให้พนักงาน → null = ซ่อน (ไม่ใช่ 0)
// ชื่อคีย์ตรงกับ JSON ของ supabase-fix-07-wedding.sql (ตรวจกับไฟล์จริงแล้ว) — บางตัวรับชื่อสำรองไว้ด้วยเผื่อ SQL ปรับภายหลัง
import { num, round2 } from '@/lib/money'
import { addDaysToKey, isDayKey } from '@/lib/format'

export { phoneDigits, formatPhone, maskPhone } from '@/lib/rental'

// ---------------------------------------------------------------------------
// ค่าคงที่
// ---------------------------------------------------------------------------
/** ชื่อร้านเริ่มต้นเมื่อยังไม่ได้ตั้ง (ห้าม hardcode ที่อื่น — อ่านจาก wed_settings.shop_name เสมอ) */
export const DEFAULT_WEDDING_SHOP_NAME = 'b.oncloud.wedding content'
/** คำอธิบายร้านใต้ชื่อในเมนู/หน้าเลือกร้าน */
export const WEDDING_SHOP_KIND = 'คอนเทนต์งานแต่ง'
/** ถังรูปสาธารณะของร้าน (โลโก้) — path = 'logo/<uuid>.<ext>' (อัปโหลด/ลบได้เฉพาะผู้จัดการ) */
export const WEDDING_PUBLIC_BUCKET = 'wedding-public'
/** ถังไฟล์ส่วนตัว (สลิปโอนเงิน) — path = '<booking_id>/<uuid>.<ext>' ดูผ่าน createSignedUrl */
export const WEDDING_FILES_BUCKET = 'wedding-files'
/** หน้าติดตามงานของคู่บ่าวสาว (สาธารณะ ไม่ต้องเข้าสู่ระบบ) — ลิงก์เต็ม = window.location.origin + weddingStatusPath(token) */
export const WEDDING_STATUS_PATH = '/wedding-status'
export const MAX_WED_MONEY = 99999999.99
export const MAX_WED_SESSIONS = 10
export const MAX_RUN_SHEET_ROWS = 40
export const MAX_WED_BANK_ACCOUNTS = 5
export const MAX_PACKAGE_DELIVERABLES = 30
/** ช่วงวันที่ wed_calendar รับได้ต่อครั้ง */
export const WED_CALENDAR_MAX_DAYS = 62
/** จำนวนแถวต่อหน้าของ wed_export_* */
export const WED_EXPORT_PAGE_SIZE = 1000
/** ขนาดไฟล์สูงสุด: โลโก้ (wedding-public) / สลิป (wedding-files) */
export const WED_LOGO_MAX_BYTES = 2 * 1024 * 1024
export const WED_SLIP_MAX_BYTES = 5 * 1024 * 1024

/** สีประจำตัวทีมงาน 10 สี (หน้าทีมงานเลือกจากชุดนี้เท่านั้น) — ตัวอักษรบนสีเหล่านี้ใช้ขาวได้ทุกสี (>= 4.5:1) */
export const CREW_COLORS: readonly string[] = [
  '#8A5A12', '#A12222', '#B84E1C', '#2A7D50', '#1B6080',
  '#2D3B7C', '#5C3579', '#8C2C42', '#4C5427', '#423D36',
] as const
export const DEFAULT_CREW_COLOR = CREW_COLORS[0]

/** ข้อความเมื่อฐานข้อมูลยังไม่มีระบบร้าน b.oncloud (ใช้คู่ isMigrationMissing จาก lib/migration.ts + MigrationNotice) */
export const FIX07_MISSING_MSG =
  'ฐานข้อมูลยังไม่มีระบบร้าน b.oncloud (คอนเทนต์งานแต่ง) — รันไฟล์ supabase-fix-07-wedding.sql ใน Supabase SQL Editor ก่อน แล้วโหลดหน้านี้ใหม่'

// ---------------------------------------------------------------------------
// ตัวช่วยอ่านค่า (ภายในไฟล์)
// ---------------------------------------------------------------------------
type Obj = Record<string, unknown>

function asObj(v: unknown): Obj | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null
}

// jsonb บางเส้นทางมาเป็นสตริง JSON → แปลงก่อน (แปลงไม่ได้ = null)
function asObjLoose(v: unknown): Obj | null {
  if (typeof v === 'string') {
    const t = v.trim()
    if (t.startsWith('{')) {
      try { return asObj(JSON.parse(t)) } catch { return null }
    }
    return null
  }
  return asObj(v)
}

function asArr(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') {
    const t = v.trim()
    if (t.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(t)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }
  }
  return []
}

function text(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return ''
}

// ข้อความว่าง/ช่องว่างล้วน = null
function textOrNull(v: unknown): string | null {
  const s = text(v)
  return s.trim() === '' ? null : s
}

function bool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true' || v === 't' || v === 1) return true
  if (v === 'false' || v === 'f' || v === 0) return false
  return fallback
}

function boolOrNull(v: unknown): boolean | null {
  if (v === null || v === undefined || v === '') return null
  return bool(v)
}

function int(v: unknown): number {
  return Math.trunc(num(v))
}

// จำนวนบริการเสริมเป็นทศนิยมได้ (numeric(8,2) ในฐานข้อมูล เช่น 1.5 ชม.) — ปัดเป็นจำนวนเต็มจะทำให้ยอดเพี้ยนตอนบันทึกซ้ำ
function addonQty(v: unknown): number {
  const q = Math.round(num(v) * 100) / 100
  return q > 0 ? q : 1
}

function count(v: unknown): number {
  return Math.max(0, int(v))
}

function money(v: unknown): number {
  return round2(num(v))
}

function moneyOrNull(v: unknown): number | null {
  return v === null || v === undefined || v === '' ? null : round2(num(v))
}

function has(o: Obj, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined && o[k] !== null
}

// ค่าแรกที่มีอยู่จริงจากชื่อคีย์สำรองหลายแบบ (ไม่มีเลย = undefined)
function pick(o: Obj, ...keys: string[]): unknown {
  for (const k of keys) if (has(o, k)) return o[k]
  return undefined
}

// day key 'YYYY-MM-DD' (ตัดเวลาท้ายออกถ้ามี) ; ไม่ใช่วันที่ = ''
function dayKey(v: unknown): string {
  const s = text(v).trim()
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s)
  return m && isDayKey(m[1]) ? m[1] : ''
}

function dayKeyOrNull(v: unknown): string | null {
  const k = dayKey(v)
  return k === '' ? null : k
}

function list<T>(v: unknown, parse: (raw: unknown) => T | null): T[] {
  const out: T[] = []
  const a = asArr(v)
  for (let i = 0; i < a.length; i++) {
    let item: T | null = null
    try { item = parse(a[i]) } catch { item = null }
    if (item !== null) out.push(item)
  }
  return out
}

function textList(v: unknown): string[] {
  const out: string[] = []
  const a = asArr(v)
  for (let i = 0; i < a.length; i++) {
    const s = textOrNull(a[i])
    if (s !== null) out.push(s.trim())
  }
  return out
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  const s = text(v).trim()
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback
}

function oneOfOrNull<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  const s = text(v).trim()
  return (allowed as readonly string[]).includes(s) ? (s as T) : null
}

// 'YYYY-MM' จากค่าที่ขึ้นต้นด้วยปี-เดือน ; อื่นๆ = ''
function monthKeyOf(v: unknown): string {
  const m = /^(\d{4})-(\d{2})/.exec(text(v).trim())
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2]}` : ''
}

// ตัวเลขสถิติแบบ {คีย์: จำนวน} — คีย์อะไรก็ได้ ค่าเป็นจำนวนเต็มไม่ติดลบ
function countMap(v: unknown): Record<string, number> {
  const o = asObjLoose(v)
  const out: Record<string, number> = {}
  if (!o) return out
  for (const k of Object.keys(o)) out[k] = count(o[k])
  return out
}

// ตัวเลขเงินแบบ {คีย์: ยอด}
function moneyMap(v: unknown): Record<string, number> {
  const o = asObjLoose(v)
  const out: Record<string, number> = {}
  if (!o) return out
  for (const k of Object.keys(o)) out[k] = money(o[k])
  return out
}

// ห่อตัวอ่านทั้งก้อน: ถ้ามีอะไรหลุดจริงๆ (ไม่ควรเกิด) คืนค่าสำรองแทนการ throw
function safe<T>(fn: () => T, fallback: () => T): T {
  try { return fn() } catch { return fallback() }
}

// ---------------------------------------------------------------------------
// ชนิดค่าแบบ enum + ป้ายภาษาไทย
// ---------------------------------------------------------------------------
export type WedBookingStatus =
  | 'inquiry' | 'hold' | 'confirmed' | 'in_production' | 'delivered' | 'completed' | 'postponed' | 'cancelled'
export const WED_BOOKING_STATUSES: readonly WedBookingStatus[] = [
  'inquiry', 'hold', 'confirmed', 'in_production', 'delivered', 'completed', 'postponed', 'cancelled',
] as const
/** สถานะที่นับคิว (ความจุต่อวัน) และนับการชนกันของทีมงาน — ตรงกับ SQL */
export const WED_COUNTING_STATUSES: readonly WedBookingStatus[] = [
  'hold', 'confirmed', 'in_production', 'delivered', 'completed',
] as const

export const WED_STATUS_LABELS: Readonly<Record<WedBookingStatus, string>> = {
  inquiry: 'สอบถาม',
  hold: 'ล็อกคิว รอมัดจำ',
  confirmed: 'ยืนยันแล้ว',
  in_production: 'ถ่ายเสร็จ รอส่งงาน',
  delivered: 'ส่งงานแล้ว',
  completed: 'ปิดงาน',
  postponed: 'เลื่อนงาน',
  cancelled: 'ยกเลิก',
}

/** ป้ายสั้น (แท็บรายการงาน / ชิปในปฏิทิน) */
export const WED_STATUS_SHORT: Readonly<Record<WedBookingStatus, string>> = {
  inquiry: 'สอบถาม',
  hold: 'ล็อกคิว',
  confirmed: 'ยืนยันแล้ว',
  in_production: 'ถ่ายเสร็จ-รอส่ง',
  delivered: 'ส่งแล้ว',
  completed: 'ปิดงาน',
  postponed: 'เลื่อน',
  cancelled: 'ยกเลิก',
}

// คลาสป้ายใน app/globals.css (ใช้คู่ข้อความเสมอ ไม่พึ่งสีอย่างเดียว):
// สอบถาม = ขอบเทา · ล็อกคิว = อำพัน · ยืนยัน = ทองเข้ม · ถ่ายเสร็จ = เขียว · ส่งแล้ว/ปิดงาน = เทาเรียบ · เลื่อน = เทาเข้ม · ยกเลิก = แดง
export const WED_STATUS_CHIP: Readonly<Record<WedBookingStatus, string>> = {
  inquiry: 'chip-outline',
  hold: 'badge-return',
  confirmed: 'chip-strong',
  in_production: 'badge-in',
  delivered: 'chip',
  completed: 'chip',
  postponed: 'badge-adjust',
  cancelled: 'badge-out',
}

export type WedSessionType = 'engagement' | 'ceremony' | 'reception' | 'prewedding' | 'other'
export const WED_SESSION_TYPES: readonly WedSessionType[] = ['engagement', 'ceremony', 'reception', 'prewedding', 'other'] as const
export const SESSION_TYPE_LABELS: Readonly<Record<WedSessionType, string>> = {
  engagement: 'หมั้น/สู่ขอ',
  ceremony: 'พิธีเช้า',
  reception: 'งานเลี้ยง',
  prewedding: 'พรีเวดดิ้ง',
  other: 'อื่นๆ',
}
/** คำสั้น สำหรับชิปเล็กในช่องปฏิทิน */
export const SESSION_TYPE_SHORT: Readonly<Record<WedSessionType, string>> = {
  engagement: 'หมั้น',
  ceremony: 'พิธี',
  reception: 'เลี้ยง',
  prewedding: 'พรีเวด',
  other: 'อื่นๆ',
}

export type WedSessionStatus = 'scheduled' | 'done' | 'cancelled'
export const WED_SESSION_STATUSES: readonly WedSessionStatus[] = ['scheduled', 'done', 'cancelled'] as const
export const SESSION_STATUS_LABELS: Readonly<Record<WedSessionStatus, string>> = {
  scheduled: 'รอถ่าย',
  done: 'ถ่ายแล้ว',
  cancelled: 'ยกเลิกคิวนี้',
}

export type WedCrewRole = 'photo' | 'video' | 'content' | 'drone' | 'assistant' | 'editor' | 'makeup' | 'other'
export const WED_CREW_ROLES: readonly WedCrewRole[] = [
  'photo', 'video', 'content', 'drone', 'assistant', 'editor', 'makeup', 'other',
] as const
export const CREW_ROLE_LABELS: Readonly<Record<WedCrewRole, string>> = {
  photo: 'ช่างภาพ',
  video: 'ช่างวิดีโอ',
  content: 'คอนเทนต์ครีเอเตอร์',
  drone: 'โดรน',
  assistant: 'ผู้ช่วย',
  editor: 'ตัดต่อ',
  makeup: 'แต่งหน้า',
  other: 'อื่นๆ',
}

export type WedSource = 'instagram' | 'facebook' | 'tiktok' | 'line' | 'referral' | 'walkin' | 'website' | 'other'
export const WED_SOURCES: readonly WedSource[] = [
  'instagram', 'facebook', 'tiktok', 'line', 'referral', 'walkin', 'website', 'other',
] as const
export const WED_SOURCE_LABELS: Readonly<Record<WedSource, string>> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  line: 'LINE',
  referral: 'ลูกค้าแนะนำ',
  walkin: 'ติดต่อเอง / หน้างาน',
  website: 'เว็บไซต์',
  other: 'อื่นๆ',
}

export type WedDeliverableStatus = 'pending' | 'editing' | 'review' | 'delivered'
export const WED_DELIVERABLE_STATUSES: readonly WedDeliverableStatus[] = ['pending', 'editing', 'review', 'delivered'] as const
export const DELIVERABLE_STATUS_LABELS: Readonly<Record<WedDeliverableStatus, string>> = {
  pending: 'รอตัด',
  editing: 'กำลังตัด',
  review: 'รอตรวจ',
  delivered: 'ส่งแล้ว',
}
export const DELIVERABLE_STATUS_CHIP: Readonly<Record<WedDeliverableStatus, string>> = {
  pending: 'chip-outline',
  editing: 'badge-return',
  review: 'chip-strong',
  delivered: 'badge-in',
}

export type WedPaymentKind = 'payment' | 'refund'
export const WED_PAYMENT_KINDS: readonly WedPaymentKind[] = ['payment', 'refund'] as const
export const WED_PAYMENT_KIND_LABELS: Readonly<Record<WedPaymentKind, string>> = {
  payment: 'รับชำระ',
  refund: 'คืนเงิน',
}
/** หัวเอกสารตามชนิดรายการเงิน */
export const WED_RECEIPT_TITLES: Readonly<Record<WedPaymentKind, string>> = {
  payment: 'ใบเสร็จรับเงิน',
  refund: 'ใบคืนเงิน',
}

export type WedPaymentMethod = 'cash' | 'transfer' | 'promptpay' | 'credit'
export const WED_PAYMENT_METHODS: readonly WedPaymentMethod[] = ['cash', 'transfer', 'promptpay', 'credit'] as const
export const WED_METHOD_LABELS: Readonly<Record<WedPaymentMethod, string>> = {
  cash: 'เงินสด',
  transfer: 'โอนเงิน',
  promptpay: 'พร้อมเพย์',
  credit: 'บัตรเครดิต',
}

export type WedPaymentPurpose = 'deposit' | 'installment' | 'balance' | 'extra' | 'other'
export const WED_PAYMENT_PURPOSES: readonly WedPaymentPurpose[] = ['deposit', 'installment', 'balance', 'extra', 'other'] as const
export const WED_PURPOSE_LABELS: Readonly<Record<WedPaymentPurpose, string>> = {
  deposit: 'มัดจำ',
  installment: 'ชำระงวด',
  balance: 'ยอดคงเหลือ',
  extra: 'ค่าใช้จ่ายเพิ่มเติม',
  other: 'อื่นๆ',
}

export type WedChargeKind = 'overtime' | 'travel' | 'extra' | 'other'
export const WED_CHARGE_KINDS: readonly WedChargeKind[] = ['overtime', 'travel', 'extra', 'other'] as const
export const WED_CHARGE_KIND_LABELS: Readonly<Record<WedChargeKind, string>> = {
  overtime: 'ค่าล่วงเวลา',
  travel: 'ค่าเดินทางเพิ่ม',
  extra: 'บริการเพิ่มเติม',
  other: 'ค่าใช้จ่ายอื่นๆ',
}

export type WedInstallmentStatus = 'paid' | 'partial' | 'due' | 'upcoming'
export const WED_INSTALLMENT_STATUSES: readonly WedInstallmentStatus[] = ['paid', 'partial', 'due', 'upcoming'] as const
export const INSTALLMENT_STATUS_LABELS: Readonly<Record<WedInstallmentStatus, string>> = {
  paid: 'ชำระแล้ว',
  partial: 'ชำระบางส่วน',
  due: 'ถึงกำหนดชำระ',
  upcoming: 'ยังไม่ถึงกำหนด',
}
export const INSTALLMENT_STATUS_CHIP: Readonly<Record<WedInstallmentStatus, string>> = {
  paid: 'badge-in',
  partial: 'badge-return',
  due: 'badge-out',
  upcoming: 'chip-outline',
}

// ป้ายจาก enum — ค่าแปลก → แสดงตามที่ได้มา (ว่าง = '-')
function labelFrom<T extends string>(map: Readonly<Record<T, string>>, v: string | null | undefined): string {
  const s = text(v).trim()
  return Object.prototype.hasOwnProperty.call(map, s) ? map[s as T] : s || '-'
}
export const wedStatusLabel = (v: string | null | undefined) => labelFrom(WED_STATUS_LABELS, v)
export const sessionTypeLabel = (v: string | null | undefined) => labelFrom(SESSION_TYPE_LABELS, v)
export const crewRoleLabel = (v: string | null | undefined) => labelFrom(CREW_ROLE_LABELS, v)
export const wedSourceLabel = (v: string | null | undefined) => labelFrom(WED_SOURCE_LABELS, v)
export const deliverableStatusLabel = (v: string | null | undefined) => labelFrom(DELIVERABLE_STATUS_LABELS, v)
export const wedMethodLabel = (v: string | null | undefined) => labelFrom(WED_METHOD_LABELS, v)
export const wedPurposeLabel = (v: string | null | undefined) => labelFrom(WED_PURPOSE_LABELS, v)
export const wedChargeKindLabel = (v: string | null | undefined) => labelFrom(WED_CHARGE_KIND_LABELS, v)
export const installmentStatusLabel = (v: string | null | undefined) => labelFrom(INSTALLMENT_STATUS_LABELS, v)

/** สถานะที่นับคิว/การชนกันของทีม */
export function isCountingStatus(status: string | null | undefined): boolean {
  return (WED_COUNTING_STATUSES as readonly string[]).includes(text(status))
}

/** งานที่ยังไม่จบ (ต้องดูแลต่อ) */
export function isOpenWedStatus(status: string | null | undefined): boolean {
  const s = text(status)
  return s !== 'completed' && s !== 'cancelled'
}

// ---------------------------------------------------------------------------
// ตัวช่วยแสดงผล
// ---------------------------------------------------------------------------
const THAI_WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'] as const
/** หัวคอลัมน์ปฏิทิน (เริ่มวันอาทิตย์) */
export const THAI_WEEKDAYS_SHORT: readonly string[] = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] as const
export const THAI_MONTHS_LONG: readonly string[] = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
] as const

/** วันในสัปดาห์ของ day key (0 = อาทิตย์) ; key ไม่ถูกต้อง → -1 */
export function weekdayOf(day: string | null | undefined): number {
  const k = dayKey(day)
  if (!k) return -1
  const [y, m, d] = k.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** ชื่อวันภาษาไทย: '2026-11-23' → 'จันทร์' ; short = 'จ' ; key ไม่ถูกต้อง → '' */
export function thaiDayName(day: string | null | undefined, short = false): string {
  const w = weekdayOf(day)
  if (w < 0) return ''
  return short ? THAI_WEEKDAYS_SHORT[w] : THAI_WEEKDAYS[w]
}

/** 'พฤศจิกายน 2569' จาก 'YYYY-MM' หรือ day key ; ไม่ถูกต้อง → '' */
export function thaiMonthYear(monthOrDay: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(text(monthOrDay).trim())
  if (!m) return ''
  const mo = Number(m[2])
  if (mo < 1 || mo > 12) return ''
  return `${THAI_MONTHS_LONG[mo - 1]} ${Number(m[1]) + 543}`
}

/** เวลา time ของ Postgres ('09:30:00' / '9:30') → 'HH:MM' ; ไม่ใช่เวลา → null */
export function normTime(v: unknown): string | null {
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(text(v))
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 23 || mi > 59) return null
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

/** 'HH:MM น.' ; ไม่มีเวลา → '' */
export function formatTimeTh(v: unknown): string {
  const t = normTime(v)
  return t ? `${t} น.` : ''
}

/**
 * ช่วงเวลาของคิวงาน: '09:00–12:00 น.' · มีแต่เริ่ม '09:00 น.' · มีแต่จบ 'ถึง 12:00 น.' · ไม่มีเวลา → fallback (ค่าเริ่มต้น 'ไม่ระบุเวลา')
 */
export function sessionTimeText(
  s: { start_time?: string | null; end_time?: string | null } | null | undefined,
  fallback = 'ไม่ระบุเวลา',
): string {
  const a = normTime(s?.start_time)
  const b = normTime(s?.end_time)
  if (a && b) return `${a}–${b} น.`
  if (a) return `${a} น.`
  if (b) return `ถึง ${b} น.`
  return fallback
}

/** 'ทีมถึง 08:00 น.' ; ไม่มีเวลาทีมถึงงาน → '' */
export function callTimeText(v: unknown): string {
  const t = normTime(v)
  return t ? `ทีมถึง ${t} น.` : ''
}

/** ลิงก์ http/https เท่านั้น (กัน javascript: / data:) — ใช้ก่อนใส่ href ทุกครั้ง ; อื่นๆ → null */
export function safeHttpUrl(v: unknown): string | null {
  const s = text(v).trim()
  if (!s || s.length > 2000) return null
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

/** ช่องลิงก์ที่ผู้ใช้กรอก (แผนที่/ส่งงาน/มู้ดบอร์ด) ถูกต้องไหม: ว่างได้ หรือ http/https */
export function isHttpUrlOrEmpty(v: string | null | undefined): boolean {
  const s = String(v ?? '').trim()
  return s === '' || safeHttpUrl(s) !== null
}

/** ลิงก์รูปในถัง wedding-public (public) — path = 'logo/<ไฟล์>' ; path ว่าง → '' ; เป็นลิงก์ http(s) อยู่แล้ว → ตามนั้น */
export function weddingImageUrl(path: string | null | undefined): string {
  const raw = String(path ?? '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return safeHttpUrl(raw) ?? ''
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
  // ได้ path แบบเต็มของ storage มา ('/storage/v1/object/public/...') → ต่อท้ายโดเมนเลย
  if (raw.startsWith('/storage/')) return `${base}${raw}`
  const encoded = raw
    .replace(new RegExp(`^/?${WEDDING_PUBLIC_BUCKET}/`), '')
    .split('/')
    .filter(part => part !== '' && part !== '.' && part !== '..')
    .map(part => encodeURIComponent(part))
    .join('/')
  if (!encoded) return ''
  return `${base}/storage/v1/object/public/${WEDDING_PUBLIC_BUCKET}/${encoded}`
}

/** ลิงก์โลโก้ร้านจากตั้งค่า (logo_path ก่อน, แล้ว logo_url_path) ; ไม่มีโลโก้ → '' */
export function weddingLogoUrl(s: { logo_path?: string | null; logo_url_path?: string | null } | null | undefined): string {
  return weddingImageUrl(s?.logo_path) || weddingImageUrl(s?.logo_url_path)
}

/** โทเคนลิงก์ติดตามงาน (64 ตัวอักษรฐาน 16 ตัวเล็ก) */
export function isWeddingToken(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
}

/** path หน้าติดตามงานของคู่บ่าวสาว '/wedding-status/<token>' */
export function weddingStatusPath(token: string): string {
  return `${WEDDING_STATUS_PATH}/${encodeURIComponent(token)}`
}

/**
 * ยอดที่ควรเรียกเก็บ "ตอนนี้" (ใบแจ้งชำระ / QR พร้อมเพย์): งวดถัดไปที่ยังค้าง (next_due) แต่ไม่เกินยอดค้างทั้งงาน
 * ไม่มีงวด → ยอดค้างทั้งงาน ; ค้าง ≤ 0 → 0 ; งานยกเลิก → 0
 */
export function amountDueNow(b: { next_due: WedNextDue | null; money: { due: number }; status?: string | null } | null | undefined): number {
  if (!b) return 0
  // งานยกเลิก: ฐานข้อมูลยังเก็บยอดค้างไว้ (เงินที่รับแล้วไม่หาย) แต่ห้ามเรียกเก็บเพิ่ม → 0
  if (b.status === 'cancelled') return 0
  const due = round2(num(b.money?.due))
  if (due <= 0) return 0
  const next = b.next_due ? round2(num(b.next_due.amount)) : 0
  return next > 0 ? Math.min(next, due) : due
}

// ---------------------------------------------------------------------------
// ตั้งค่าร้าน: wed_get_settings / wed_save_settings
// ---------------------------------------------------------------------------
export interface WedBankAccount {
  bank: string
  account_no: string
  account_name: string
}

export interface WedSettings {
  shop_name: string
  tagline: string | null
  phone: string | null
  line_id: string | null
  line_url: string | null
  instagram: string | null
  facebook: string | null
  tiktok: string | null
  email: string | null
  address: string | null
  logo_path: string | null       // path ในถัง wedding-public ('logo/<uuid>.<ext>')
  logo_url_path: string | null   // path สาธารณะของ storage ที่ฐานข้อมูลส่งมา — แสดงผลด้วย weddingLogoUrl(settings)
  promptpay_id: string | null    // เบอร์มือถือ 10 หลัก หรือเลขผู้เสียภาษี 13 หลัก
  promptpay_name: string | null
  bank_accounts: WedBankAccount[]
  deposit_percent: number        // มัดจำ % ของยอดก่อนค่าใช้จ่ายเพิ่ม (base_total)
  min_deposit: number
  balance_due_days: number       // ชำระยอดคงเหลือก่อนวันงานแรกกี่วัน
  hold_hours: number             // ล็อกคิวรอมัดจำได้กี่ชั่วโมง
  max_jobs_per_day: number       // 0 = ไม่จำกัด
  overtime_rate: number          // บาท/ชั่วโมง (ตัวช่วยคิดค่าล่วงเวลา)
  terms_text: string             // เงื่อนไขสัญญา (ข้อละบรรทัด)
  booking_note: string | null    // ข้อความท้ายรูปเอกสารการจอง
  receipt_footer: string | null
  portal_enabled: boolean        // เปิดลิงก์ติดตามงานให้ลูกค้า
  updated_at: string | null
  updated_by: string | null
}

export const DEFAULT_WEDDING_SETTINGS: Readonly<WedSettings> = {
  shop_name: DEFAULT_WEDDING_SHOP_NAME,
  tagline: null,
  phone: null,
  line_id: null,
  line_url: null,
  instagram: null,
  facebook: null,
  tiktok: null,
  email: null,
  address: null,
  logo_path: null,
  logo_url_path: null,
  promptpay_id: null,
  promptpay_name: null,
  bank_accounts: [],
  deposit_percent: 30,
  min_deposit: 0,
  balance_due_days: 7,
  hold_hours: 72,
  max_jobs_per_day: 2,
  overtime_rate: 0,
  terms_text: '',
  booking_note: null,
  receipt_footer: null,
  portal_enabled: true,
  updated_at: null,
  updated_by: null,
}

function parseBankAccount(raw: unknown): WedBankAccount | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const acc = { bank: text(o.bank).trim(), account_no: text(o.account_no).trim(), account_name: text(o.account_name).trim() }
  return acc.bank || acc.account_no || acc.account_name ? acc : null
}

function intIn(v: unknown, fallback: number, min: number, max: number): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = int(v)
  return n < min || n > max ? fallback : n
}

/** ตั้งค่าร้าน (wed_get_settings / wed_save_settings / select wed_settings) — คืนค่าเสมอ (ช่องที่หาย = ค่าเริ่มต้น) */
export function parseWeddingSettings(raw: unknown): WedSettings {
  return safe(() => {
    const top = asObjLoose(raw)
    // บาง RPC ห่อมาเป็น {settings: {...}}
    const o = top && asObjLoose(top.settings) ? asObjLoose(top.settings) : top
    const d = DEFAULT_WEDDING_SETTINGS
    if (!o) return { ...d, bank_accounts: [] }
    return {
      shop_name: textOrNull(o.shop_name)?.trim() || d.shop_name,
      tagline: textOrNull(o.tagline),
      phone: textOrNull(o.phone),
      line_id: textOrNull(o.line_id),
      line_url: textOrNull(o.line_url),
      instagram: textOrNull(o.instagram),
      facebook: textOrNull(o.facebook),
      tiktok: textOrNull(o.tiktok),
      email: textOrNull(o.email),
      address: textOrNull(o.address),
      logo_path: textOrNull(o.logo_path),
      logo_url_path: textOrNull(o.logo_url_path),
      promptpay_id: textOrNull(o.promptpay_id),
      promptpay_name: textOrNull(o.promptpay_name),
      bank_accounts: list(o.bank_accounts, parseBankAccount).slice(0, MAX_WED_BANK_ACCOUNTS),
      deposit_percent: has(o, 'deposit_percent') ? Math.min(100, Math.max(0, money(o.deposit_percent))) : d.deposit_percent,
      min_deposit: has(o, 'min_deposit') ? Math.max(0, money(o.min_deposit)) : d.min_deposit,
      balance_due_days: intIn(o.balance_due_days, d.balance_due_days, 0, 365),
      hold_hours: intIn(o.hold_hours, d.hold_hours, 1, 24 * 60),
      max_jobs_per_day: intIn(o.max_jobs_per_day, d.max_jobs_per_day, 0, 100),
      overtime_rate: has(o, 'overtime_rate') ? Math.max(0, money(o.overtime_rate)) : d.overtime_rate,
      terms_text: text(o.terms_text),
      booking_note: textOrNull(o.booking_note),
      receipt_footer: textOrNull(o.receipt_footer),
      portal_enabled: has(o, 'portal_enabled') ? bool(o.portal_enabled, d.portal_enabled) : d.portal_enabled,
      updated_at: textOrNull(o.updated_at),
      updated_by: textOrNull(o.updated_by),
    }
  }, () => ({ ...DEFAULT_WEDDING_SETTINGS, bank_accounts: [] }))
}

/** เงื่อนไขสัญญาเป็นรายข้อ (ตัดบรรทัดว่าง + ตัดเลขข้อเดิม '1.' / '1)' ออก ให้เอกสารใส่เลขใหม่เอง) */
export function termsLines(termsText: string | null | undefined): string[] {
  return String(termsText ?? '')
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^(?:\d+|[๐-๙]+)\s*[.)]\s*/, '').trim())
    .filter(line => line !== '')
}

// ---------------------------------------------------------------------------
// แพ็กเกจ + บริการเสริม (select wed_packages / wed_addons, wed_save_package / wed_save_addon)
// ---------------------------------------------------------------------------
export interface WedDeliverablePlanItem {
  name: string
  qty: number
  unit: string
  due_days: number   // ส่งงานภายในกี่วันหลังวันงานสุดท้าย
}

export interface WedPackage {
  id: string
  name: string
  description: string | null
  price: number
  hours: number
  crew_size: number
  deliverables: WedDeliverablePlanItem[]
  is_active: boolean
  sort_order: number
  updated_at: string
  /** จำนวนงานที่ใช้แพ็กเกจนี้ (จาก RPC) — null = ไม่ได้ส่งมา (select ตาราง) */
  bookings_count: number | null
}

export interface WedAddon {
  id: string
  name: string
  price: number
  unit: string | null
  description: string | null
  is_active: boolean
  sort_order: number
  updated_at: string
  bookings_count: number | null
}

export function parseDeliverablePlanItem(raw: unknown): WedDeliverablePlanItem | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const name = text(o.name).trim()
  if (!name) return null
  return {
    name,
    qty: Math.max(1, int(o.qty) || 1),
    unit: text(o.unit).trim(),
    due_days: Math.min(365, Math.max(0, int(o.due_days))),
  }
}

export function parseDeliverablesPlan(raw: unknown): WedDeliverablePlanItem[] {
  return list(raw, parseDeliverablePlanItem).slice(0, MAX_PACKAGE_DELIVERABLES)
}

export function parseWedPackage(raw: unknown): WedPackage | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const id = text(o.id)
  if (!id) return null
  return {
    id,
    name: text(o.name),
    description: textOrNull(o.description),
    price: Math.max(0, money(o.price)),
    hours: Math.max(0, Math.round(num(o.hours) * 10) / 10),
    crew_size: Math.min(20, count(o.crew_size)),
    deliverables: parseDeliverablesPlan(o.deliverables),
    is_active: has(o, 'is_active') ? bool(o.is_active, true) : true,
    sort_order: int(o.sort_order),
    updated_at: text(o.updated_at),
    bookings_count: has(o, 'bookings_count') ? count(o.bookings_count) : null,
  }
}

/** รายการแพ็กเกจ (เรียงตาม sort_order แล้วชื่อ) */
export function parseWedPackages(raw: unknown): WedPackage[] {
  return list(raw, parseWedPackage).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'th'))
}

export function parseWedAddon(raw: unknown): WedAddon | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const id = text(o.id)
  if (!id) return null
  return {
    id,
    name: text(o.name),
    price: Math.max(0, money(o.price)),
    unit: textOrNull(o.unit),
    description: textOrNull(o.description),
    is_active: has(o, 'is_active') ? bool(o.is_active, true) : true,
    sort_order: int(o.sort_order),
    updated_at: text(o.updated_at),
    bookings_count: has(o, 'bookings_count') ? count(o.bookings_count) : null,
  }
}

export function parseWedAddons(raw: unknown): WedAddon[] {
  return list(raw, parseWedAddon).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'th'))
}

/** ผลของ wed_delete_package / wed_delete_addon — {deleted} หรือ {deactivated} (ใช้อยู่จึงปิดใช้แทนการลบ) */
export function parseSoftDeleteResult(raw: unknown): { deleted: boolean; deactivated: boolean } {
  const o = asObjLoose(raw) ?? {}
  return { deleted: bool(o.deleted), deactivated: bool(pick(o, 'deactivated', 'soft_deleted')) }
}

// ---------------------------------------------------------------------------
// ลูกค้า (select wed_customers / wed_save_customer / wed_get_customer)
// ---------------------------------------------------------------------------
export interface WedCustomer {
  id: string
  name: string               // ผู้ติดต่อหลัก
  partner_name: string | null
  phone: string
  phone2: string | null
  line_id: string | null
  instagram: string | null
  facebook: string | null
  email: string | null
  address: string | null
  source: WedSource | null
  note: string | null
  created_at: string | null
  updated_at: string | null
  /** สถิติจาก RPC (wed_save_customer / wed_get_customer) — null = select ตาราง (ไม่มีสถิติ) */
  stats: WedCustomerStats | null
}

export interface WedCustomerStats {
  bookings: number
  active: number          // ยังไม่จบ (ไม่ใช่ปิดงาน/ยกเลิก)
  completed: number
  cancelled: number
  total_value: number     // ยอดสุทธิรวม (ไม่นับงานยกเลิก)
  total_paid: number
  total_due: number       // ค้างชำระ (ไม่นับงานยกเลิก/สอบถาม)
  last_event_date: string | null
  last_booking_at: string | null
}

export interface WedBookingMini {
  id: string                 // booking_id
  booking_no: string
  status: WedBookingStatus
  status_label: string
  source: WedSource | null
  couple_names: string
  customer_id: string | null
  customer_name: string | null
  phone: string | null
  line_id: string | null
  first_date: string | null  // วันงานแรก (คิวแรก)
  last_date: string | null
  sessions_count: number
  package_name: string | null
  grand_total: number
  paid: number
  due: number
  deposit_required: number
  deposit_met: boolean
  followup_date: string | null
  followup_note: string | null
  hold_until: string | null
  created_at: string | null
}

export interface WedCustomerTotals {
  bookings: number
  grand_total: number
  paid: number
  due: number
}

export interface WedCustomerDetail extends WedCustomer {
  bookings: WedBookingMini[]
  totals: WedCustomerTotals
}

export function parseWedCustomer(raw: unknown): WedCustomer | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const id = text(o.id)
  if (!id) return null
  return {
    id,
    name: text(o.name),
    partner_name: textOrNull(o.partner_name),
    phone: text(o.phone),
    phone2: textOrNull(o.phone2),
    line_id: textOrNull(o.line_id),
    instagram: textOrNull(o.instagram),
    facebook: textOrNull(o.facebook),
    email: textOrNull(o.email),
    address: textOrNull(o.address),
    source: oneOfOrNull(o.source, WED_SOURCES),
    note: textOrNull(o.note),
    created_at: textOrNull(o.created_at),
    updated_at: textOrNull(o.updated_at),
    stats: parseCustomerStats(o.stats),
  }
}

function parseCustomerStats(raw: unknown): WedCustomerStats | null {
  const o = asObjLoose(raw)
  if (!o) return null
  return {
    bookings: count(o.bookings),
    active: count(o.active),
    completed: count(o.completed),
    cancelled: count(o.cancelled),
    total_value: money(o.total_value),
    total_paid: money(o.total_paid),
    total_due: money(o.total_due),
    last_event_date: dayKeyOrNull(o.last_event_date),
    last_booking_at: textOrNull(o.last_booking_at),
  }
}

export function parseWedCustomers(raw: unknown): WedCustomer[] {
  return list(raw, parseWedCustomer)
}

/** การจองแบบย่อ (ประวัติลูกค้า / ติดตามลูกค้า / ล็อกคิวใกล้หมด) — รับทั้ง id และ booking_id */
export function parseWedBookingMini(raw: unknown): WedBookingMini | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const id = text(pick(o, 'booking_id', 'id'))
  if (!id) return null
  const status = oneOf(o.status, WED_BOOKING_STATUSES, 'inquiry')
  const m = asObj(o.money) ?? o
  return {
    id,
    booking_no: text(o.booking_no),
    status,
    status_label: textOrNull(o.status_label) ?? WED_STATUS_LABELS[status],
    source: oneOfOrNull(o.source, WED_SOURCES),
    couple_names: text(o.couple_names),
    customer_id: textOrNull(o.customer_id),
    customer_name: textOrNull(pick(o, 'customer_name', 'name')),
    phone: textOrNull(pick(o, 'customer_phone', 'phone')),
    line_id: textOrNull(pick(o, 'customer_line_id', 'line_id')),
    first_date: dayKeyOrNull(pick(o, 'first_session_date', 'first_date', 'event_date', 'date')),
    last_date: dayKeyOrNull(pick(o, 'last_session_date', 'last_date')),
    sessions_count: count(o.sessions_count),
    package_name: textOrNull(o.package_name),
    grand_total: money(m.grand_total),
    paid: money(m.paid),
    due: money(m.due),
    deposit_required: money(m.deposit_required),
    deposit_met: bool(m.deposit_met),
    followup_date: dayKeyOrNull(o.followup_date),
    followup_note: textOrNull(o.followup_note),
    hold_until: textOrNull(o.hold_until),
    created_at: textOrNull(o.created_at),
  }
}

/** wed_get_customer → ลูกค้า + ประวัติงาน + ยอดรวม ; อ่านไม่ได้ → null */
export function parseWedCustomerDetail(raw: unknown): WedCustomerDetail | null {
  return safe(() => {
    const top = asObjLoose(raw)
    if (!top) return null
    const cust = parseWedCustomer(asObjLoose(top.customer) ?? top)
    if (!cust) return null
    const bookings = list(top.bookings, parseWedBookingMini)
    // ยอดรวม: สถิติจากฐานข้อมูล (stats) ก่อน → totals → รวมจากประวัติงานเอง
    const st = cust.stats
    const t = asObjLoose(top.totals) ?? {}
    const sum = (k: 'grand_total' | 'paid' | 'due') => round2(bookings.filter(b => b.status !== 'cancelled').reduce((s, b) => s + b[k], 0))
    return {
      ...cust,
      bookings,
      totals: {
        bookings: st ? st.bookings
          : has(t, 'bookings') || has(t, 'count') || has(t, 'bookings_count') ? count(pick(t, 'bookings', 'bookings_count', 'count'))
          : bookings.length,
        grand_total: st ? st.total_value : has(t, 'grand_total') ? money(t.grand_total) : sum('grand_total'),
        paid: st ? st.total_paid : has(t, 'paid') ? money(t.paid) : sum('paid'),
        due: st ? st.total_due : has(t, 'due') ? money(t.due) : sum('due'),
      },
    }
  }, () => null)
}

// ---------------------------------------------------------------------------
// ทีมงาน (wed_list_crew / wed_save_crew / select wed_crew [M])
// ---------------------------------------------------------------------------
export interface WedCrew {
  id: string
  name: string
  nickname: string | null
  role: WedCrewRole
  color: string
  is_active: boolean
  phone: string | null
  line_id: string | null
  /** ค่าจ้างมาตรฐานต่อคิว — null = ไม่ได้ส่งมา (พนักงานไม่เห็นค่าจ้าง) */
  default_fee: number | null
  note: string | null
}

// สีจากฐานข้อมูลต้องเป็น #RRGGBB เท่านั้น (ใช้ใน style) — อื่นๆ → สีเริ่มต้น
function crewColor(v: unknown): string {
  const s = text(v).trim()
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : DEFAULT_CREW_COLOR
}

export function parseWedCrew(raw: unknown): WedCrew | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const id = text(pick(o, 'id', 'crew_id'))
  if (!id) return null
  return {
    id,
    name: text(o.name),
    nickname: textOrNull(o.nickname),
    role: oneOf(o.role, WED_CREW_ROLES, 'other'),
    color: crewColor(o.color),
    is_active: has(o, 'is_active') ? bool(o.is_active, true) : true,
    phone: textOrNull(o.phone),
    line_id: textOrNull(o.line_id),
    default_fee: moneyOrNull(o.default_fee),
    note: textOrNull(o.note),
  }
}

/** wed_list_crew → ทีมงาน (ใช้งานอยู่ก่อน แล้วตามชื่อ) */
export function parseCrewList(raw: unknown): WedCrew[] {
  return list(raw, parseWedCrew).sort((a, b) =>
    Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name, 'th'))
}

/** ชื่อเรียกทีมงาน: 'ชื่อเล่น (ชื่อ)' หรือชื่ออย่างเดียว */
export function crewDisplayName(c: { name: string; nickname?: string | null } | null | undefined): string {
  if (!c) return ''
  const nick = (c.nickname ?? '').trim()
  const name = (c.name ?? '').trim()
  return nick && nick !== name ? `${nick} (${name})` : name || nick
}

// ---------------------------------------------------------------------------
// คิวงาน / ทีมงานในคิว / การชนกัน (ร่วมกันหลาย RPC)
// ---------------------------------------------------------------------------
export interface WedRunSheetRow {
  time: string | null   // 'HH:MM' หรือ null (ไม่ระบุเวลา)
  text: string
}

export interface WedSessionCrew {
  crew_id: string
  name: string
  nickname: string | null
  role: WedCrewRole
  color: string
  /** ค่าจ้างคิวนี้ — null = ไม่ได้ส่งมา (พนักงาน) */
  fee: number | null
  fee_paid_on: string | null
  note: string | null
}

export interface WedCrewConflict {
  crew_id: string
  crew_name: string             // ชื่อเล่น (ถ้ามี) หรือชื่อ
  crew_full_name: string | null
  date: string
  /** ลำดับคิวในฟอร์ม (เริ่ม 1) — คิวใหม่ที่ยังไม่มี id ใช้ตัวนี้จับคู่กับแถวในฟอร์ม (wed_quote / ผลบันทึก) */
  this_index: number | null
  this_session_id: string | null
  other_session_id: string | null
  other_booking_id: string | null
  other_booking_no: string
  other_couple: string
  other_type_label: string | null
  other_time: string   // ข้อความเวลาของอีกงาน (จากฐานข้อมูล)
  /** ชนกับคิวอื่นในงานเดียวกันเอง */
  same_booking: boolean
}

export interface WedCapacityWarning {
  date: string
  count_jobs: number
  capacity: number
  message: string | null
  bookings: { booking_id: string | null; booking_no: string; couple_names: string }[]
}

export function parseRunSheet(raw: unknown): WedRunSheetRow[] {
  return list(raw, (r): WedRunSheetRow | null => {
    const o = asObjLoose(r)
    if (!o) {
      // แถวเป็นข้อความล้วน
      const t = textOrNull(r)
      return t ? { time: null, text: t.trim() } : null
    }
    const t = text(o.text).trim()
    const time = normTime(o.time)
    return t || time ? { time, text: t } : null
  }).slice(0, MAX_RUN_SHEET_ROWS)
}

export function parseSessionCrew(raw: unknown): WedSessionCrew | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const crewId = text(pick(o, 'crew_id', 'id'))
  if (!crewId) return null
  return {
    crew_id: crewId,
    name: text(pick(o, 'name', 'crew_name')),
    nickname: textOrNull(o.nickname),
    role: oneOf(o.role, WED_CREW_ROLES, 'other'),
    color: crewColor(o.color),
    fee: moneyOrNull(o.fee),
    fee_paid_on: dayKeyOrNull(o.fee_paid_on),
    note: textOrNull(o.note),
  }
}

export function parseCrewConflict(raw: unknown): WedCrewConflict | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const crewId = text(o.crew_id)
  const date = dayKey(o.date)
  if (!crewId && !date) return null
  return {
    crew_id: crewId,
    crew_name: text(pick(o, 'crew_name', 'name')),
    crew_full_name: textOrNull(o.crew_full_name),
    date,
    this_index: has(o, 'this_index') ? int(o.this_index) : null,
    this_session_id: textOrNull(pick(o, 'this_session_id', 'session_id')),
    other_session_id: textOrNull(o.other_session_id),
    other_booking_id: textOrNull(o.other_booking_id),
    other_booking_no: text(o.other_booking_no),
    other_couple: text(pick(o, 'other_couple', 'other_couple_names')),
    other_type_label: textOrNull(o.other_type_label),
    other_time: text(o.other_time),
    same_booking: bool(o.same_booking),
  }
}

export function parseCrewConflicts(raw: unknown): WedCrewConflict[] {
  return list(raw, parseCrewConflict)
}

export function parseCapacityWarning(raw: unknown): WedCapacityWarning | null {
  const o = asObjLoose(raw)
  if (!o) {
    const msg = textOrNull(raw)
    return msg ? { date: '', count_jobs: 0, capacity: 0, message: msg.trim(), bookings: [] } : null
  }
  const date = dayKey(pick(o, 'date', 'day'))
  const message = textOrNull(o.message)
  if (!date && !message) return null
  return {
    date,
    count_jobs: count(pick(o, 'count_jobs', 'count', 'jobs')),
    capacity: count(pick(o, 'capacity', 'max', 'max_jobs_per_day')),
    message,
    bookings: list(pick(o, 'bookings', 'others', 'other_bookings'), r => {
      const b = asObjLoose(r)
      if (!b) return null
      return {
        booking_id: textOrNull(pick(b, 'booking_id', 'id')),
        booking_no: text(b.booking_no),
        couple_names: text(b.couple_names),
      }
    }),
  }
}

export function parseCapacityWarnings(raw: unknown): WedCapacityWarning[] {
  return list(raw, parseCapacityWarning)
}

/** ข้อความไทยของการชนกันของทีมงาน (พร้อมแสดง) */
export function crewConflictText(c: WedCrewConflict): string {
  const time = c.other_time ? ` (${c.other_time})` : ''
  if (c.same_booking) return `${c.crew_name || 'ทีมงาน'} ถูกจัดลงสองคิวที่เวลาทับกันในงานนี้${time}`
  const other = [c.other_booking_no, c.other_couple].filter(Boolean).join(' ')
  return `${c.crew_name || 'ทีมงาน'} ติดงาน ${other || 'อื่น'}${time} วันเดียวกัน`
}

// ---------------------------------------------------------------------------
// ปฏิทิน: wed_calendar
// ---------------------------------------------------------------------------
export interface WedSessionMini {
  session_id: string
  booking_id: string
  booking_no: string
  status: WedBookingStatus
  status_label: string
  couple_names: string
  session_type: WedSessionType
  type_label: string
  title: string | null
  date: string
  start_time: string | null   // 'HH:MM'
  end_time: string | null
  call_time: string | null
  venue_name: string | null
  map_url: string | null      // ผ่าน safeHttpUrl แล้ว
  session_status: WedSessionStatus
  crew: WedSessionCrew[]
  due: number
  deposit_met: boolean
  has_conflict: boolean
}

export interface WedCalendarDay {
  day: string
  count_jobs: number
  full: boolean
  sessions: WedSessionMini[]
}

export interface WedCalendar {
  from: string | null
  to: string | null
  capacity: number   // 0 = ไม่จำกัด
  days: WedCalendarDay[]
  conflicts: WedCrewConflict[]
}

// เรียงคิวตามวัน แล้วเวลา (ทีมถึง/เริ่ม) — ไม่มีเวลาไว้ท้าย
function sessionSortKey(s: { date: string | null; call_time: string | null; start_time: string | null }): string {
  return `${s.date ?? '9999-99-99'} ${s.call_time ?? s.start_time ?? '99:99'}`
}

export function parseSessionMini(raw: unknown): WedSessionMini | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const sessionId = text(pick(o, 'session_id', 'id'))
  if (!sessionId) return null
  const status = oneOf(o.status, WED_BOOKING_STATUSES, 'inquiry')
  const type = oneOf(o.session_type, WED_SESSION_TYPES, 'other')
  return {
    session_id: sessionId,
    booking_id: text(o.booking_id),
    booking_no: text(o.booking_no),
    status,
    status_label: textOrNull(o.status_label) ?? WED_STATUS_LABELS[status],
    couple_names: text(o.couple_names),
    session_type: type,
    type_label: textOrNull(o.type_label) ?? SESSION_TYPE_LABELS[type],
    title: textOrNull(o.title),
    date: dayKey(o.date),
    start_time: normTime(o.start_time),
    end_time: normTime(o.end_time),
    call_time: normTime(o.call_time),
    venue_name: textOrNull(o.venue_name),
    map_url: safeHttpUrl(o.map_url),
    session_status: oneOf(o.session_status, WED_SESSION_STATUSES, 'scheduled'),
    crew: list(o.crew, parseSessionCrew),
    due: money(o.due),
    deposit_met: bool(o.deposit_met),
    has_conflict: bool(o.has_conflict),
  }
}

/** wed_calendar — คืนค่าเสมอ (วันเรียงตามวันที่, คิวในวันเรียงตามเวลา) */
export function parseWedCalendar(raw: unknown): WedCalendar {
  return safe(() => {
    const o = asObjLoose(raw) ?? {}
    const days = list(o.days, (r): WedCalendarDay | null => {
      const d = asObjLoose(r)
      if (!d) return null
      const day = dayKey(pick(d, 'day', 'date'))
      if (!day) return null
      const sessions = list(d.sessions, parseSessionMini).sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)))
      return {
        day,
        count_jobs: has(d, 'count_jobs') ? count(d.count_jobs) : new Set(sessions.filter(s => isCountingStatus(s.status)).map(s => s.booking_id)).size,
        full: bool(d.full),
        sessions,
      }
    }).sort((a, b) => a.day.localeCompare(b.day))
    return {
      from: dayKeyOrNull(o.from),
      to: dayKeyOrNull(o.to),
      capacity: count(o.capacity),
      days,
      conflicts: parseCrewConflicts(o.conflicts),
    }
  }, () => ({ from: null, to: null, capacity: 0, days: [], conflicts: [] }))
}

// ---------------------------------------------------------------------------
// รายละเอียดทั้งวัน: wed_day (ใช้ซ้ำใน wed_today.today_sessions)
// ---------------------------------------------------------------------------
export interface WedNextDue {
  seq: number | null   // null = ยอดคงเหลือทั้งงาน (ไม่มีแผนงวด)
  label: string
  due_date: string | null
  amount: number       // ยอดที่ยังค้างของงวดนั้น (ไม่เกินยอดค้างทั้งงาน)
  overdue: boolean
}

export interface WedDeliverablesSummary {
  total: number
  delivered: number
  overdue: number
  items: { name: string; qty: number; unit: string; status: WedDeliverableStatus; due_date: string | null }[]
}

export interface WedDayMoney {
  grand_total: number
  paid: number
  due: number
  deposit_required: number
  deposit_met: boolean
  next_installment: WedNextDue | null
}

export interface WedDaySession extends WedSessionMini {
  venue_address: string | null
  venue_contact: string | null
  dress_code: string | null
  notes: string | null
  run_sheet: WedRunSheetRow[]
  package_name: string | null
  package_hours: number | null
  addons: { name: string; qty: number; unit: string | null }[]
  deliverables: WedDeliverablesSummary
  money: WedDayMoney
  customer: { name: string; partner_name: string | null; phone: string | null; line_id: string | null; instagram: string | null }
  coordinator_name: string | null
  coordinator_phone: string | null
  mood_link: string | null      // ผ่าน safeHttpUrl แล้ว
  customer_note: string | null
  note: string | null
  /** จำนวนคิวทั้งหมดของงานนี้ (ไม่นับที่ยกเลิก) */
  sessions_in_booking: number
  conflicts: WedCrewConflict[]
}

export interface WedDay {
  day: string
  capacity: number
  count_jobs: number
  full: boolean
  sessions: WedDaySession[]
  conflicts: WedCrewConflict[]
}

export function parseNextDue(raw: unknown): WedNextDue | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const amount = money(pick(o, 'amount_remaining', 'amount'))
  const label = text(o.label).trim()
  if (!label && amount <= 0) return null
  return { seq: has(o, 'seq') ? count(o.seq) : null, label, due_date: dayKeyOrNull(o.due_date), amount, overdue: bool(o.overdue) }
}

// รับได้ทั้งรายการชิ้นงานตรงๆ และ {total, delivered, overdue, items}
function parseDeliverablesSummary(raw: unknown): WedDeliverablesSummary {
  const isList = Array.isArray(raw) || (typeof raw === 'string' && raw.trim().startsWith('['))
  const ob: Obj = isList ? {} : asObjLoose(raw) ?? {}
  const items = list(isList ? raw : ob.items, r => {
    const d = asObjLoose(r)
    if (!d) return null
    const name = text(d.name).trim()
    if (!name) return null
    return {
      name,
      qty: Math.max(1, int(d.qty) || 1),
      unit: text(d.unit).trim(),
      status: oneOf(d.status, WED_DELIVERABLE_STATUSES, 'pending'),
      due_date: dayKeyOrNull(d.due_date),
    }
  })
  return {
    total: has(ob, 'total') ? count(ob.total) : items.length,
    delivered: has(ob, 'delivered') ? count(ob.delivered) : items.filter(i => i.status === 'delivered').length,
    overdue: count(ob.overdue),
    items,
  }
}

function parseDayMoney(raw: unknown): WedDayMoney {
  const o = asObjLoose(raw) ?? {}
  return {
    grand_total: money(o.grand_total),
    paid: money(o.paid),
    due: money(o.due),
    deposit_required: money(o.deposit_required),
    deposit_met: bool(o.deposit_met),
    next_installment: parseNextDue(pick(o, 'next_installment', 'next_due')),
  }
}

export function parseDaySession(raw: unknown): WedDaySession | null {
  const mini = parseSessionMini(raw)
  if (!mini) return null
  const o = asObjLoose(raw) ?? {}
  const c = asObjLoose(o.customer) ?? {}
  const coord = asObjLoose(o.coordinator) ?? {}
  const money0 = parseDayMoney(o.money)
  return {
    ...mini,
    // คิวในหน้าวันมี money แยกก้อน — ใช้ยอดค้าง/มัดจำจากก้อนนั้นถ้าระดับบนไม่ได้ส่งมา
    due: has(o, 'due') ? mini.due : money0.due,
    deposit_met: has(o, 'deposit_met') ? mini.deposit_met : money0.deposit_met,
    venue_address: textOrNull(o.venue_address),
    venue_contact: textOrNull(o.venue_contact),
    dress_code: textOrNull(o.dress_code),
    notes: textOrNull(o.notes),
    run_sheet: parseRunSheet(o.run_sheet),
    package_name: textOrNull(o.package_name),
    package_hours: has(o, 'package_hours') ? Math.max(0, Math.round(num(o.package_hours) * 10) / 10) : null,
    addons: list(o.addons, r => {
      const a = asObjLoose(r)
      if (!a) return null
      const name = text(a.name).trim()
      return name ? { name, qty: addonQty(a.qty), unit: textOrNull(a.unit) } : null
    }),
    deliverables: parseDeliverablesSummary(pick(o, 'deliverables', 'deliverables_summary')),
    money: money0,
    customer: {
      name: text(pick(c, 'name', 'customer_name')),
      partner_name: textOrNull(c.partner_name),
      phone: textOrNull(c.phone),
      line_id: textOrNull(c.line_id),
      instagram: textOrNull(c.instagram),
    },
    coordinator_name: textOrNull(pick(o, 'coordinator_name')) ?? textOrNull(coord.name),
    coordinator_phone: textOrNull(pick(o, 'coordinator_phone')) ?? textOrNull(coord.phone),
    mood_link: safeHttpUrl(o.mood_link),
    customer_note: textOrNull(o.customer_note),
    note: textOrNull(o.note),
    sessions_in_booking: count(o.sessions_in_booking),
    conflicts: parseCrewConflicts(o.conflicts),
  }
}

/** wed_day — คืนค่าเสมอ */
export function parseWedDay(raw: unknown): WedDay {
  return safe(() => {
    const o = asObjLoose(raw) ?? {}
    const sessions = list(o.sessions, parseDaySession).sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)))
    return {
      day: dayKey(pick(o, 'day', 'date')),
      capacity: count(o.capacity),
      count_jobs: has(o, 'count_jobs') ? count(o.count_jobs) : new Set(sessions.filter(s => isCountingStatus(s.status)).map(s => s.booking_id)).size,
      full: bool(o.full),
      sessions,
      conflicts: parseCrewConflicts(o.conflicts),
    }
  }, () => ({ day: '', capacity: 0, count_jobs: 0, full: false, sessions: [], conflicts: [] }))
}

// ---------------------------------------------------------------------------
// งานแบบเต็ม: wed_get_booking (และ booking ในผลของ create/update/action ทั้งหมด)
// ---------------------------------------------------------------------------
export interface WedBookingCustomer {
  id: string
  name: string
  partner_name: string | null
  phone: string
  phone2: string | null
  line_id: string | null
  instagram: string | null
  facebook: string | null
  email: string | null
  address: string | null
  source: WedSource | null
  note: string | null
}

export interface WedBookingPackage {
  id: string | null        // null = แพ็กเกจกำหนดเอง
  name: string
  price: number
  hours: number
  description: string | null
}

export interface WedBookingAddon {
  id: string
  addon_id: string | null  // null = พิมพ์เอง (ไม่อยู่ในรายการบริการเสริม)
  name: string
  qty: number
  unit_price: number
  amount: number           // qty × unit_price (จากฐานข้อมูล)
  unit: string | null
}

export interface WedSession {
  id: string
  session_type: WedSessionType
  type_label: string
  title: string | null
  date: string | null      // null ได้เฉพาะงานสอบถาม/เลื่อน
  start_time: string | null
  end_time: string | null
  call_time: string | null
  venue_name: string | null
  venue_address: string | null
  map_url: string | null   // ผ่าน safeHttpUrl แล้ว
  venue_contact: string | null
  dress_code: string | null
  notes: string | null
  run_sheet: WedRunSheetRow[]
  status: WedSessionStatus
  sort_order: number
  crew: WedSessionCrew[]
  conflicts: WedCrewConflict[]
}

/**
 * วันชำระยอดคงเหลือ (ตามนโยบาย ไม่ได้กำหนดเอง) ช้ากว่า "วันงานแรก − N วัน" หรือไม่ = งานกระชั้นชิด
 * ฐานข้อมูล (wed_recalc / wed_quote) ไม่ให้วันนี้ย้อนไปก่อนวันครบกำหนดมัดจำ (วันจอง/ล็อกคิว) → ข้อความ "N วันก่อนวันงานแรก" ไม่จริง
 * firstDate = วันงานแรกของคิวที่ไม่ยกเลิก (กฎเดียวกับฐานข้อมูล)
 */
export function balanceDueShortNotice(dueDate: string | null, firstDate: string | null, days: number | null): boolean {
  if (!dueDate || !firstDate || days === null || !Number.isFinite(days)) return false
  const policy = addDaysToKey(firstDate, -days)
  return !!policy && dueDate > policy
}

export interface WedMoney {
  package_price: number
  addons_total: number
  travel_fee: number
  discount: number
  discount_note: string | null
  pre_discount_total: number   // แพ็กเกจ + บริการเสริม + ค่าเดินทาง (ก่อนส่วนลด)
  base_total: number       // แพ็กเกจ + บริการเสริม + ค่าเดินทาง − ส่วนลด
  charges_total: number    // ค่าใช้จ่ายเพิ่มที่ยังไม่ยกเลิก
  grand_total: number
  paid: number             // รับ − คืน (ไม่นับรายการที่ยกเลิก)
  due: number              // ติดลบ = รับเกิน
  deposit_required: number
  deposit_met: boolean
  deposit_due: number          // มัดจำที่ยังขาด (≥ 0)
  deposit_percent: number | null
  min_deposit: number | null
  balance_due_days: number | null
  balance_due_date: string | null
  balance_due_date_override: string | null
  /** ต้นทุนค่าจ้างทีม / กำไร — null = ไม่ได้ส่งมา (พนักงาน) */
  crew_cost_total: number | null
  profit: number | null
}

export interface WedInstallment {
  id: string
  seq: number
  label: string
  due_date: string | null
  amount: number
  paid_amount: number
  amount_remaining: number
  status: WedInstallmentStatus
  /** เลยกำหนดแล้วยังค้าง */
  overdue: boolean
}

export interface WedCharge {
  id: string
  kind: WedChargeKind
  description: string
  amount: number
  voided_at: string | null
  void_reason: string | null
  created_by_name: string | null
  created_at: string
}

export interface WedPayment {
  id: string
  receipt_no: string | null
  kind: WedPaymentKind
  method: WedPaymentMethod
  amount: number
  paid_on: string | null        // วันที่รับ/คืนเงินจริง (day key)
  purpose: WedPaymentPurpose | null
  slip_path: string | null      // path ในถัง wedding-files (ดูผ่าน signed URL)
  note: string | null
  voided_at: string | null
  void_reason: string | null
  created_by_name: string | null
  created_at: string
}

export interface WedDeliverable {
  id: string
  booking_id: string
  name: string
  qty: number
  unit: string | null
  due_date: string | null
  status: WedDeliverableStatus
  link_url: string | null       // ผ่าน safeHttpUrl แล้ว
  note: string | null
  editor_crew_id: string | null
  editor_name: string | null
  delivered_at: string | null
  sort_order: number
  updated_at: string | null
  /** ยังไม่ส่งและเลยกำหนดส่ง (คิดตามวันไทยในฐานข้อมูล) */
  overdue: boolean
}

export interface WedLog {
  action: string
  detail: Record<string, unknown> | null
  actor_name: string | null
  created_at: string
}

export interface WedBookingActions {
  can_edit: boolean
  can_hold: boolean
  can_extend_hold: boolean
  can_release: boolean
  can_confirm: boolean
  can_mark_shot: boolean
  can_mark_delivered: boolean
  can_complete: boolean
  can_reopen: boolean
  can_postpone: boolean
  can_resume: boolean
  can_cancel: boolean
  can_pay: boolean
  can_refund: boolean
  can_add_charge: boolean
  can_set_installments: boolean
  can_edit_deliverables: boolean
  can_set_followup: boolean
  /**
   * เหตุผลที่ทำบางอย่างไม่ได้ (คีย์ = ชื่อการกระทำ: hold / confirm / mark_shot / mark_delivered / complete / cancel / pay / refund / add_charge)
   * และคำเตือนที่ต้องกดยืนยันแบบบังคับ (คีย์ลงท้าย _warning: confirm_warning / mark_shot_warning / complete_warning)
   * เป็นข้อความไทยพร้อมแสดง ; ไม่มีคีย์ = ไม่มีเหตุผล/คำเตือน
   */
  block_reasons: Record<string, string>
}

export interface WedBooking {
  id: string
  booking_no: string
  status: WedBookingStatus
  status_label: string
  status_before_postpone: WedBookingStatus | null
  source: WedSource | null
  couple_names: string
  customer: WedBookingCustomer
  public_token: string | null
  public_url_path: string | null   // '/wedding-status/<token>'
  package: WedBookingPackage
  deliverables_plan: WedDeliverablePlanItem[]
  addons: WedBookingAddon[]
  travel_fee: number
  discount: number
  discount_note: string | null
  /** คิวงานตามลำดับในฟอร์ม (sort_order — ลำดับเดียวกับฐานข้อมูล) ; ดูตามเวลาจริงใช้ sessionsByDate(sessions) */
  sessions: WedSession[]
  /** วันงานแรก/สุดท้าย (คิวที่ไม่ยกเลิกและมีวันที่) — null = ยังไม่กำหนดวัน */
  first_date: string | null
  last_date: string | null
  money: WedMoney
  installments: WedInstallment[]
  /** แผนงวดแก้เองแล้ว (ไม่ใช่แผนเริ่มต้น มัดจำ + ยอดคงเหลือ) */
  installments_custom: boolean
  next_due: WedNextDue | null
  charges: WedCharge[]
  payments: WedPayment[]
  deliverables: WedDeliverable[]
  deliverables_summary: { total: number; open: number; delivered: number }
  logs: WedLog[]                   // ใหม่ก่อน
  hold_until: string | null
  followup_date: string | null
  followup_note: string | null
  coordinator_name: string | null
  coordinator_phone: string | null
  mood_link: string | null         // ผ่าน safeHttpUrl แล้ว
  customer_note: string | null
  note: string | null
  cancel_reason: string | null
  postpone_reason: string | null
  capacity_warnings: WedCapacityWarning[]
  /** การชนกันของทีมงานทุกคิวรวมกัน (ไม่ซ้ำ) */
  crew_conflicts: WedCrewConflict[]
  actions: WedBookingActions
  created_at: string
  created_by_name: string | null
  updated_at: string               // ตัวล็อกเวอร์ชันสำหรับ wed_update_booking
  confirmed_at: string | null
  shot_at: string | null
  delivered_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  postponed_at: string | null
}

const NO_WED_ACTIONS: WedBookingActions = {
  can_edit: false, can_hold: false, can_extend_hold: false, can_release: false, can_confirm: false,
  can_mark_shot: false, can_mark_delivered: false, can_complete: false, can_reopen: false, can_postpone: false,
  can_resume: false, can_cancel: false, can_pay: false, can_refund: false, can_add_charge: false,
  can_set_installments: false, can_edit_deliverables: false, can_set_followup: false,
  block_reasons: {},
}

function parseBookingCustomer(raw: unknown): WedBookingCustomer {
  const c = parseWedCustomer(raw)
  if (c) {
    return {
      id: c.id, name: c.name, partner_name: c.partner_name, phone: c.phone, phone2: c.phone2, line_id: c.line_id,
      instagram: c.instagram, facebook: c.facebook, email: c.email, address: c.address, source: c.source, note: c.note,
    }
  }
  const o = asObjLoose(raw) ?? {}
  return {
    id: '', name: text(o.name), partner_name: textOrNull(o.partner_name), phone: text(o.phone), phone2: null,
    line_id: textOrNull(o.line_id), instagram: null, facebook: null, email: null, address: null, source: null, note: null,
  }
}

function parseBookingPackage(raw: unknown, top: Obj): WedBookingPackage {
  const o = asObjLoose(raw)
  if (o) {
    return {
      id: textOrNull(o.id),
      name: text(o.name),
      price: Math.max(0, money(o.price)),
      hours: Math.max(0, Math.round(num(o.hours) * 10) / 10),
      description: textOrNull(o.description),
    }
  }
  // สำรอง: คอลัมน์ snapshot ระดับบน (package_id / package_name ...)
  return {
    id: textOrNull(top.package_id),
    name: text(top.package_name),
    price: Math.max(0, money(top.package_price)),
    hours: Math.max(0, Math.round(num(top.package_hours) * 10) / 10),
    description: textOrNull(top.package_description),
  }
}

export function parseBookingAddon(raw: unknown): WedBookingAddon | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const name = text(o.name).trim()
  if (!name) return null
  const qty = addonQty(o.qty)
  const unitPrice = Math.max(0, money(o.unit_price))
  return {
    id: text(o.id),
    addon_id: textOrNull(o.addon_id),
    name,
    qty,
    unit_price: unitPrice,
    amount: has(o, 'amount') ? money(o.amount) : round2(qty * unitPrice),
    unit: textOrNull(o.unit),
  }
}

export function parseWedSession(raw: unknown): WedSession | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const id = text(pick(o, 'id', 'session_id'))
  if (!id) return null
  const type = oneOf(o.session_type, WED_SESSION_TYPES, 'other')
  return {
    id,
    session_type: type,
    type_label: textOrNull(o.type_label) ?? SESSION_TYPE_LABELS[type],
    title: textOrNull(o.title),
    date: dayKeyOrNull(o.date),
    start_time: normTime(o.start_time),
    end_time: normTime(o.end_time),
    call_time: normTime(o.call_time),
    venue_name: textOrNull(o.venue_name),
    venue_address: textOrNull(o.venue_address),
    map_url: safeHttpUrl(o.map_url),
    venue_contact: textOrNull(o.venue_contact),
    dress_code: textOrNull(o.dress_code),
    notes: textOrNull(o.notes),
    run_sheet: parseRunSheet(o.run_sheet),
    status: oneOf(o.status, WED_SESSION_STATUSES, 'scheduled'),
    sort_order: int(o.sort_order),
    crew: list(o.crew, parseSessionCrew),
    conflicts: parseCrewConflicts(o.conflicts),
  }
}

/** คิวงานเรียงตามวัน แล้วเวลา (ทีมถึง/เริ่ม) — ไม่มีวันไว้ท้าย (สำเนาใหม่ ไม่แก้รายการเดิม) */
export function sessionsByDate<T extends { date: string | null; call_time: string | null; start_time: string | null }>(sessions: readonly T[]): T[] {
  return [...sessions].sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)))
}

function parseWedMoney(raw: unknown, top: Obj, addons: WedBookingAddon[], pkg: WedBookingPackage): WedMoney {
  const o = asObjLoose(raw) ?? {}
  const addonsTotal = round2(addons.reduce((s, a) => s + a.amount, 0))
  const packagePrice = has(o, 'package_price') ? money(o.package_price) : pkg.price
  const addonsTot = has(o, 'addons_total') ? money(o.addons_total) : addonsTotal
  const travel = has(o, 'travel_fee') ? money(o.travel_fee) : money(top.travel_fee)
  const depositRequired = money(o.deposit_required)
  const paid = money(o.paid)
  return {
    package_price: packagePrice,
    addons_total: addonsTot,
    travel_fee: travel,
    discount: has(o, 'discount') ? money(o.discount) : money(top.discount),
    discount_note: textOrNull(pick(o, 'discount_note')) ?? textOrNull(top.discount_note),
    pre_discount_total: has(o, 'pre_discount_total') ? money(o.pre_discount_total) : round2(packagePrice + addonsTot + travel),
    base_total: money(o.base_total),
    charges_total: money(o.charges_total),
    grand_total: money(o.grand_total),
    paid,
    due: money(o.due),
    deposit_required: depositRequired,
    deposit_met: bool(o.deposit_met),
    deposit_due: has(o, 'deposit_due') ? Math.max(0, money(o.deposit_due)) : Math.max(0, round2(depositRequired - paid)),
    deposit_percent: moneyOrNull(o.deposit_percent),
    min_deposit: moneyOrNull(o.min_deposit),
    balance_due_days: has(o, 'balance_due_days') ? count(o.balance_due_days) : null,
    balance_due_date: dayKeyOrNull(o.balance_due_date),
    balance_due_date_override: dayKeyOrNull(o.balance_due_date_override),
    crew_cost_total: moneyOrNull(o.crew_cost_total),
    profit: moneyOrNull(o.profit),
  }
}

export function parseInstallment(raw: unknown): WedInstallment | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const id = text(o.id)
  const seq = count(o.seq)
  if (!id && !seq) return null
  const amount = money(o.amount)
  const paid = money(pick(o, 'paid_amount', 'paid'))
  return {
    id,
    seq,
    label: text(o.label),
    due_date: dayKeyOrNull(o.due_date),
    amount,
    paid_amount: paid,
    amount_remaining: has(o, 'amount_remaining') ? money(o.amount_remaining) : Math.max(0, round2(amount - paid)),
    status: oneOf(o.status, WED_INSTALLMENT_STATUSES, 'upcoming'),
    overdue: bool(o.overdue),
  }
}

export function parseWedCharge(raw: unknown): WedCharge | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const id = text(o.id)
  if (!id) return null
  return {
    id,
    kind: oneOf(o.kind, WED_CHARGE_KINDS, 'other'),
    description: text(o.description),
    amount: money(o.amount),
    voided_at: textOrNull(o.voided_at),
    void_reason: textOrNull(o.void_reason),
    created_by_name: textOrNull(o.created_by_name),
    created_at: text(o.created_at),
  }
}

export function parseWedPayment(raw: unknown): WedPayment | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const id = text(o.id)
  if (!id) return null
  return {
    id,
    receipt_no: textOrNull(o.receipt_no),
    kind: oneOf(o.kind, WED_PAYMENT_KINDS, 'payment'),
    method: oneOf(o.method, WED_PAYMENT_METHODS, 'cash'),
    amount: money(o.amount),
    paid_on: dayKeyOrNull(o.paid_on),
    purpose: oneOfOrNull(o.purpose, WED_PAYMENT_PURPOSES),
    slip_path: textOrNull(o.slip_path),
    note: textOrNull(o.note),
    voided_at: textOrNull(o.voided_at),
    void_reason: textOrNull(o.void_reason),
    created_by_name: textOrNull(o.created_by_name),
    created_at: text(o.created_at),
  }
}

export function parseWedDeliverable(raw: unknown): WedDeliverable | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const id = text(o.id)
  if (!id) return null
  return {
    id,
    booking_id: text(o.booking_id),
    name: text(o.name),
    qty: Math.max(1, int(o.qty) || 1),
    unit: textOrNull(o.unit),
    due_date: dayKeyOrNull(o.due_date),
    status: oneOf(o.status, WED_DELIVERABLE_STATUSES, 'pending'),
    link_url: safeHttpUrl(o.link_url),
    note: textOrNull(o.note),
    editor_crew_id: textOrNull(o.editor_crew_id),
    editor_name: textOrNull(o.editor_name),
    delivered_at: textOrNull(o.delivered_at),
    sort_order: int(o.sort_order),
    updated_at: textOrNull(o.updated_at),
    overdue: bool(o.overdue),
  }
}

function parseLog(raw: unknown): WedLog | null {
  const o = asObjLoose(raw)
  if (!o) return null
  return {
    action: text(o.action),
    detail: asObjLoose(o.detail),
    actor_name: textOrNull(o.actor_name),
    created_at: text(o.created_at),
  }
}

function parseWedActions(raw: unknown): WedBookingActions {
  const o = asObjLoose(raw)
  if (!o) return { ...NO_WED_ACTIONS, block_reasons: {} }
  const reasons: Record<string, string> = {}
  const br = asObjLoose(o.block_reasons)
  if (br) {
    for (const key of Object.keys(br)) {
      const v = br[key]
      const s = Array.isArray(v) ? textList(v).join(' · ') : text(v)
      if (s.trim()) reasons[key] = s.trim()
    }
  }
  return {
    can_edit: bool(o.can_edit),
    can_hold: bool(o.can_hold),
    can_extend_hold: bool(o.can_extend_hold),
    can_release: bool(o.can_release),
    can_confirm: bool(o.can_confirm),
    can_mark_shot: bool(o.can_mark_shot),
    can_mark_delivered: bool(o.can_mark_delivered),
    can_complete: bool(o.can_complete),
    can_reopen: bool(o.can_reopen),
    can_postpone: bool(o.can_postpone),
    can_resume: bool(o.can_resume),
    can_cancel: bool(o.can_cancel),
    can_pay: bool(o.can_pay),
    can_refund: bool(o.can_refund),
    can_add_charge: bool(o.can_add_charge),
    can_set_installments: bool(o.can_set_installments),
    can_edit_deliverables: bool(o.can_edit_deliverables),
    can_set_followup: bool(o.can_set_followup),
    block_reasons: reasons,
  }
}

// รวมการชนกันจากทุกคิว + ระดับบน (ไม่ซ้ำ)
function mergeConflicts(...groups: WedCrewConflict[][]): WedCrewConflict[] {
  const seen = new Set<string>()
  const out: WedCrewConflict[] = []
  for (const g of groups) {
    for (const c of g) {
      const k = [c.crew_id, c.date, c.this_session_id ?? '', c.this_index ?? '', c.other_session_id ?? '', c.other_booking_no].join('|')
      if (seen.has(k)) continue
      seen.add(k)
      out.push(c)
    }
  }
  return out
}

/** งานแบบเต็ม ; ไม่ใช่ object หรือไม่มี id → null */
export function parseWedBooking(raw: unknown): WedBooking | null {
  return safe(() => {
    const o = asObjLoose(raw)
    if (!o) return null
    const id = text(o.id)
    if (!id) return null
    const status = oneOf(o.status, WED_BOOKING_STATUSES, 'inquiry')
    const token = textOrNull(o.public_token)
    const pkg = parseBookingPackage(o.package, o)
    const addons = list(o.addons, parseBookingAddon)
    // ลำดับตามฟอร์ม (sort_order) แบบเดียวกับฐานข้อมูล — ค่าเท่ากันคงลำดับเดิมที่ส่งมา
    const sessions = list(o.sessions, parseWedSession).sort((a, b) => a.sort_order - b.sort_order)
    const dated = sessions.filter(s => s.status !== 'cancelled' && s.date).map(s => s.date as string).sort()
    const sessionConflicts = sessions.map(s => s.conflicts)
    const logs = list(o.logs, parseLog).sort((a, b) => b.created_at.localeCompare(a.created_at))
    return {
      id,
      booking_no: text(o.booking_no),
      status,
      status_label: textOrNull(o.status_label) ?? WED_STATUS_LABELS[status],
      status_before_postpone: oneOfOrNull(o.status_before_postpone, WED_BOOKING_STATUSES),
      source: oneOfOrNull(o.source, WED_SOURCES),
      couple_names: text(o.couple_names),
      customer: parseBookingCustomer(o.customer),
      public_token: token,
      public_url_path: textOrNull(o.public_url_path) ?? (token ? weddingStatusPath(token) : null),
      package: pkg,
      deliverables_plan: parseDeliverablesPlan(o.deliverables_plan),
      addons,
      travel_fee: money(o.travel_fee),
      discount: money(o.discount),
      discount_note: textOrNull(o.discount_note),
      sessions,
      first_date: dated[0] ?? null,
      last_date: dated.length ? dated[dated.length - 1] : null,
      money: parseWedMoney(o.money, o, addons, pkg),
      installments: list(o.installments, parseInstallment).sort((a, b) => a.seq - b.seq),
      installments_custom: bool(o.installments_custom),
      next_due: parseNextDue(o.next_due),
      charges: list(o.charges, parseWedCharge),
      payments: list(o.payments, parseWedPayment),
      deliverables: list(o.deliverables, parseWedDeliverable).sort((a, b) => a.sort_order - b.sort_order),
      deliverables_summary: (() => {
        const ds = asObjLoose(o.deliverables_summary)
        const items = list(o.deliverables, parseWedDeliverable)
        const delivered = ds && has(ds, 'delivered') ? count(ds.delivered) : items.filter(d => d.status === 'delivered').length
        const total = ds && has(ds, 'total') ? count(ds.total) : items.length
        return { total, delivered, open: ds && has(ds, 'open') ? count(ds.open) : Math.max(0, total - delivered) }
      })(),
      logs,
      hold_until: textOrNull(o.hold_until),
      followup_date: dayKeyOrNull(o.followup_date),
      followup_note: textOrNull(o.followup_note),
      coordinator_name: textOrNull(o.coordinator_name),
      coordinator_phone: textOrNull(o.coordinator_phone),
      mood_link: safeHttpUrl(o.mood_link),
      customer_note: textOrNull(o.customer_note),
      note: textOrNull(o.note),
      cancel_reason: textOrNull(o.cancel_reason),
      postpone_reason: textOrNull(o.postpone_reason),
      capacity_warnings: parseCapacityWarnings(o.capacity_warnings),
      crew_conflicts: mergeConflicts(parseCrewConflicts(o.crew_conflicts), ...sessionConflicts),
      actions: parseWedActions(o.actions),
      created_at: text(o.created_at),
      created_by_name: textOrNull(o.created_by_name),
      updated_at: text(o.updated_at),
      confirmed_at: textOrNull(o.confirmed_at),
      shot_at: textOrNull(o.shot_at),
      delivered_at: textOrNull(o.delivered_at),
      completed_at: textOrNull(o.completed_at),
      cancelled_at: textOrNull(o.cancelled_at),
      postponed_at: textOrNull(o.postponed_at),
    }
  }, () => null)
}

/**
 * ผลของ RPC ที่คืน "งาน" — รับได้ทั้ง booking json ตรงๆ (wed_get_booking / wed_confirm / wed_hold ฯลฯ)
 * และแบบห่อ {booking: ..., already?: boolean} ; อ่านไม่ได้ → null
 * already = ทำซ้ำของเดิม (เช่น ยืนยันงานที่ยืนยันแล้ว / ส่ง client_id เดิม) — ฐานข้อมูลไม่ได้เปลี่ยนอะไรเพิ่ม
 */
export function parseWedActionResult(raw: unknown): { booking: WedBooking; already: boolean } | null {
  return safe(() => {
    const o = asObjLoose(raw)
    if (!o) return null
    const booking = o.booking !== undefined ? parseWedBooking(o.booking) : parseWedBooking(o)
    if (!booking) return null
    return { booking, already: bool(pick(o, 'already', 'already_saved', 'already_done')) }
  }, () => null)
}

/** เหมือน parseWedActionResult แต่คืนเฉพาะงาน */
export function parseWedBookingResult(raw: unknown): WedBooking | null {
  return parseWedActionResult(raw)?.booking ?? null
}

export interface WedCreateBookingResult {
  already_saved: boolean
  /** (เมื่อ already_saved) true = ข้อมูลชุดเดิม · false = รหัสคำขอเดิมแต่ข้อมูลอื่น (ห้ามถือว่าเป็นงานของฟอร์มนี้) · null = ไม่รู้ */
  payload_matches: boolean | null
  booking: WedBooking
  crew_conflicts: WedCrewConflict[]
  capacity_warnings: WedCapacityWarning[]
}

/** wed_create_booking / wed_update_booking → {already_saved, payload_matches, booking} ; งานอ่านไม่ได้ → null */
export function parseWedCreateBookingResult(raw: unknown): WedCreateBookingResult | null {
  return safe(() => {
    const o = asObjLoose(raw)
    if (!o) return null
    const booking = parseWedBooking(o.booking ?? o)
    if (!booking) return null
    const conflicts = has(o, 'crew_conflicts') ? parseCrewConflicts(o.crew_conflicts) : booking.crew_conflicts
    const capacity = has(o, 'capacity_warnings') ? parseCapacityWarnings(o.capacity_warnings) : booking.capacity_warnings
    return {
      already_saved: bool(o.already_saved),
      payload_matches: boolOrNull(o.payload_matches),
      booking,
      crew_conflicts: conflicts,
      capacity_warnings: capacity,
    }
  }, () => null)
}

/** wed_add_payment → {already_saved, payment, booking} ; อ่านไม่ได้ → null */
export function parseWedAddPaymentResult(raw: unknown): { already_saved: boolean; payment: WedPayment | null; booking: WedBooking } | null {
  return safe(() => {
    const o = asObjLoose(raw)
    if (!o) return null
    const booking = parseWedBooking(o.booking)
    if (!booking) return null
    return { already_saved: bool(o.already_saved), payment: parseWedPayment(o.payment), booking }
  }, () => null)
}

/** wed_add_charge → {already_saved?, charge?, booking} หรืองานตรงๆ */
export function parseWedAddChargeResult(raw: unknown): { already_saved: boolean; charge: WedCharge | null; booking: WedBooking } | null {
  return safe(() => {
    const o = asObjLoose(raw)
    if (!o) return null
    const booking = parseWedBooking(o.booking ?? o)
    if (!booking) return null
    return { already_saved: bool(o.already_saved), charge: parseWedCharge(o.charge), booking }
  }, () => null)
}

/**
 * wed_save_deliverable → งาน (booking json) + {deliverable, already_saved} ต่อท้าย
 * รับแบบห่อ {booking, deliverable} ด้วย ; wed_delete_deliverable คืนงานอย่างเดียว (deliverable = null)
 */
export function parseSaveDeliverableResult(raw: unknown): { deliverable: WedDeliverable | null; booking: WedBooking | null; already_saved: boolean } {
  return safe(() => {
    const o = asObjLoose(raw)
    if (!o) return { deliverable: null, booking: null, already_saved: false }
    const booking = o.booking !== undefined ? parseWedBooking(o.booking) : parseWedBooking(o)
    // ไม่มี booking_no + ไม่มี deliverable = ได้ชิ้นงานตรงๆ (ไม่ใช่งาน)
    const looksLikeBooking = o.booking !== undefined || has(o, 'booking_no')
    return {
      deliverable: o.deliverable !== undefined ? parseWedDeliverable(o.deliverable) : looksLikeBooking ? null : parseWedDeliverable(o),
      booking: looksLikeBooking ? booking : null,
      already_saved: bool(o.already_saved),
    }
  }, () => ({ deliverable: null, booking: null, already_saved: false }))
}

/** wed_void_payment → {already_voided, payment, booking} ; อ่านไม่ได้ → null */
export function parseWedVoidPaymentResult(raw: unknown): { already_voided: boolean; payment: WedPayment | null; booking: WedBooking } | null {
  return safe(() => {
    const o = asObjLoose(raw)
    if (!o) return null
    const booking = parseWedBooking(o.booking)
    if (!booking) return null
    return { already_voided: bool(o.already_voided), payment: parseWedPayment(o.payment), booking }
  }, () => null)
}

/** wed_mark_crew_paid → {ok, updated} */
export function parseMarkCrewPaidResult(raw: unknown): { updated: number } {
  const o = asObjLoose(raw) ?? {}
  return { updated: count(o.updated) }
}

/**
 * ข้อผิดพลาดที่ "กดยืนยันแบบบังคับ (force) แล้วทำต่อได้" — อ่านจาก hint ของ PostgrestError ที่ fix-07 ตั้งไว้
 * 'capacity' = คิวเต็ม (wed_create/update_booking, wed_hold, wed_resume ... ส่ง force) · 'deposit' = มัดจำไม่ครบ (wed_confirm p_force)
 * 'future_sessions' = ยังมีคิวที่ยังไม่ถึงวัน (wed_mark_shot p_force) · 'not_delivered' = ยังไม่ส่งงาน (wed_complete p_force) ; อื่นๆ → null
 */
export function wedForceHint(err: unknown): 'capacity' | 'deposit' | 'future_sessions' | 'not_delivered' | null {
  const e = asObj(err)
  const hint = e ? text(e.hint).trim() : ''
  switch (hint) {
    case 'wed_capacity': return 'capacity'
    case 'wed_deposit': return 'deposit'
    case 'wed_future_sessions': return 'future_sessions'
    case 'wed_not_delivered': return 'not_delivered'
    default: return null
  }
}

// ---------------------------------------------------------------------------
// ดูราคา/ความจุ/การชนกันก่อนบันทึก: wed_quote
// ---------------------------------------------------------------------------
export interface WedQuoteSession {
  index: number              // ลำดับในฟอร์ม (เริ่ม 1)
  id: string | null
  session_type: WedSessionType
  date: string | null
  start_time: string | null
  end_time: string | null
  call_time: string | null
  status: WedSessionStatus
  /** จำนวนงานที่กันคิววันนั้นอยู่แล้ว (ไม่นับงานนี้) — null = ไม่มีวันที่ */
  jobs_that_day: number | null
}

export interface WedQuote {
  status: WedBookingStatus
  /** สถานะนี้กันคิวไหม (สอบถาม = ไม่กัน → ไม่ต้องสนคิวเต็ม) */
  counts_capacity: boolean
  capacity: number           // งานต่อวันสูงสุด (0 = ไม่จำกัด)
  package: WedBookingPackage
  deliverables_plan: WedDeliverablePlanItem[]
  money: WedMoney
  /** ส่วนลดไม่เกินยอดก่อนส่วนลด */
  discount_ok: boolean
  addons: { name: string; qty: number; unit_price: number; amount: number }[]
  sessions: WedQuoteSession[]
  installments: { seq: number; label: string; due_date: string | null; amount: number }[]
  capacity_warnings: WedCapacityWarning[]
  crew_conflicts: WedCrewConflict[]
  /** ข้อความเตือนอื่น (ภาษาไทย) — ว่าง = ไม่มี */
  warnings: string[]
  /** เกินความจุต่อวันและสถานะกันคิว → ตอนบันทึกต้องส่ง force (หลังผู้ใช้ยืนยัน) */
  needs_force: boolean
}

/** wed_quote — คืนค่าเสมอ (เงินอยู่ใน money หรือระดับบนก็ได้) */
export function parseWedQuote(raw: unknown): WedQuote {
  return safe(() => {
    const o = asObjLoose(raw) ?? {}
    const m = asObjLoose(o.money) ? o.money : o
    const addons = list(o.addons, parseBookingAddon)
    const pkg = parseBookingPackage(o.package, o)
    const capacity = parseCapacityWarnings(o.capacity_warnings)
    const status = oneOf(o.status, WED_BOOKING_STATUSES, 'inquiry')
    const counts = has(o, 'counts_capacity') ? bool(o.counts_capacity) : isCountingStatus(status)
    const mo = asObjLoose(m) ?? {}
    const money0 = parseWedMoney(m, o, addons, pkg)
    return {
      status,
      counts_capacity: counts,
      capacity: count(o.capacity),
      package: pkg,
      deliverables_plan: parseDeliverablesPlan(o.deliverables_plan),
      money: money0,
      discount_ok: has(mo, 'discount_ok') ? bool(mo.discount_ok) : money0.discount <= money0.pre_discount_total,
      addons: addons.map(a => ({ name: a.name, qty: a.qty, unit_price: a.unit_price, amount: a.amount })),
      sessions: list(o.sessions, (r): WedQuoteSession | null => {
        const x = asObjLoose(r)
        if (!x) return null
        return {
          index: int(x.index),
          id: textOrNull(x.id),
          session_type: oneOf(x.session_type, WED_SESSION_TYPES, 'other'),
          date: dayKeyOrNull(x.date),
          start_time: normTime(x.start_time),
          end_time: normTime(x.end_time),
          call_time: normTime(x.call_time),
          status: oneOf(x.status, WED_SESSION_STATUSES, 'scheduled'),
          jobs_that_day: has(x, 'jobs_that_day') ? count(x.jobs_that_day) : null,
        }
      }),
      installments: list(o.installments, r => {
        const i = parseInstallment(r)
        return i ? { seq: i.seq, label: i.label, due_date: i.due_date, amount: i.amount } : null
      }),
      capacity_warnings: capacity,
      crew_conflicts: parseCrewConflicts(o.crew_conflicts),
      warnings: [...textList(o.warnings), ...textList(o.errors)],
      needs_force: has(o, 'needs_force') ? bool(o.needs_force) : counts && capacity.length > 0,
    }
  }, () => {
    const pkg: WedBookingPackage = { id: null, name: '', price: 0, hours: 0, description: null }
    return {
      status: 'inquiry', counts_capacity: false, capacity: 0, package: pkg, deliverables_plan: [],
      money: parseWedMoney({}, {}, [], pkg), discount_ok: true, addons: [], sessions: [], installments: [],
      capacity_warnings: [], crew_conflicts: [], warnings: [], needs_force: false,
    }
  })
}

// ---------------------------------------------------------------------------
// กระดานส่งงาน: wed_deliverables_board
// ---------------------------------------------------------------------------
export interface WedDeliverableBoardItem extends WedDeliverable {
  booking_no: string
  couple_names: string
  booking_status: WedBookingStatus
  booking_status_label: string
  last_session_date: string | null
}

/** ตัวกรอง p_status ของ wed_deliverables_board: สถานะชิ้นงาน หรือ 'open' (ยังไม่ส่ง) / 'overdue' (เลยกำหนด) ; null = ทั้งหมด */
export type WedBoardFilter = WedDeliverableStatus | 'open' | 'overdue'

export function parseDeliverableBoardItem(raw: unknown): WedDeliverableBoardItem | null {
  const d = parseWedDeliverable(raw)
  if (!d) return null
  const o = asObjLoose(raw) ?? {}
  const bs = oneOf(pick(o, 'booking_status', 'status_of_booking'), WED_BOOKING_STATUSES, 'confirmed')
  return {
    ...d,
    booking_no: text(o.booking_no),
    couple_names: text(o.couple_names),
    booking_status: bs,
    booking_status_label: textOrNull(o.booking_status_label) ?? WED_STATUS_LABELS[bs],
    last_session_date: dayKeyOrNull(o.last_session_date),
  }
}

/** wed_deliverables_board — คืนรายการเสมอ (เรียงตามกำหนดส่ง ไม่มีกำหนดไว้ท้าย) */
export function parseDeliverablesBoard(raw: unknown): WedDeliverableBoardItem[] {
  const top = asObjLoose(raw)
  const src = top ? pick(top, 'items', 'deliverables') : raw
  return list(src, parseDeliverableBoardItem).sort((a, b) =>
    (a.due_date ?? '9999-99-99').localeCompare(b.due_date ?? '9999-99-99') || a.sort_order - b.sort_order)
}

// ---------------------------------------------------------------------------
// ตารางงานทีมงาน / ค่าจ้างทีม: wed_crew_schedule [S] / wed_crew_payouts [M]
// ---------------------------------------------------------------------------
export interface WedCrewScheduleItem {
  session_id: string
  booking_id: string
  booking_no: string
  status: WedBookingStatus
  couple_names: string
  session_type: WedSessionType
  type_label: string
  title: string | null
  date: string | null
  start_time: string | null
  end_time: string | null
  call_time: string | null
  venue_name: string | null
  map_url: string | null
  session_status: WedSessionStatus
  role: WedCrewRole
  note: string | null
  /** null = ไม่ได้ส่งมา (พนักงาน) */
  fee: number | null
  fee_paid_on: string | null
}

export interface WedCrewSchedule {
  crew: WedCrew | null
  from: string | null
  to: string | null
  sessions: WedCrewScheduleItem[]
  /** fees/paid/unpaid = null สำหรับพนักงาน (ไม่เห็นค่าจ้าง) */
  totals: { sessions: number; days: number; fees: number | null; paid: number | null; unpaid: number | null }
}

export function parseCrewScheduleItem(raw: unknown): WedCrewScheduleItem | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const sessionId = text(pick(o, 'session_id', 'id'))
  if (!sessionId) return null
  const status = oneOf(pick(o, 'status', 'booking_status'), WED_BOOKING_STATUSES, 'confirmed')
  const type = oneOf(o.session_type, WED_SESSION_TYPES, 'other')
  return {
    session_id: sessionId,
    booking_id: text(o.booking_id),
    booking_no: text(o.booking_no),
    status,
    couple_names: text(o.couple_names),
    session_type: type,
    type_label: textOrNull(o.type_label) ?? SESSION_TYPE_LABELS[type],
    title: textOrNull(pick(o, 'title', 'session_title')),
    date: dayKeyOrNull(o.date),
    start_time: normTime(o.start_time),
    end_time: normTime(o.end_time),
    call_time: normTime(o.call_time),
    venue_name: textOrNull(o.venue_name),
    map_url: safeHttpUrl(o.map_url),
    session_status: oneOf(o.session_status, WED_SESSION_STATUSES, 'scheduled'),
    role: oneOf(o.role, WED_CREW_ROLES, 'other'),
    note: textOrNull(o.note),
    fee: moneyOrNull(o.fee),
    fee_paid_on: dayKeyOrNull(o.fee_paid_on),
  }
}

/** wed_crew_schedule — รับทั้งรายการตรงๆ และ {crew, from, to, sessions, totals} ; คืนค่าเสมอ */
export function parseCrewSchedule(raw: unknown): WedCrewSchedule {
  return safe(() => {
    const top = asObjLoose(raw)
    const sessions = list(top ? pick(top, 'sessions', 'items') : raw, parseCrewScheduleItem)
      .sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)))
    const o = top ?? {}
    const t = asObjLoose(o.totals) ?? {}
    const fees = sessions.map(s => s.fee)
    const anyFee = fees.some(f => f !== null)
    const sumFees = (pred: (s: WedCrewScheduleItem) => boolean) =>
      round2(sessions.filter(pred).reduce((s, x) => s + (x.fee ?? 0), 0))
    return {
      crew: parseWedCrew(o.crew),
      from: dayKeyOrNull(o.from),
      to: dayKeyOrNull(o.to),
      sessions,
      totals: {
        sessions: has(t, 'sessions') ? count(t.sessions) : sessions.length,
        days: has(t, 'days') ? count(t.days) : new Set(sessions.map(x => x.date).filter(Boolean)).size,
        fees: has(t, 'fees') ? money(t.fees) : anyFee ? sumFees(() => true) : null,
        paid: has(t, 'paid') ? money(t.paid) : anyFee ? sumFees(s => s.fee_paid_on !== null) : null,
        unpaid: has(t, 'unpaid') ? money(t.unpaid) : anyFee ? sumFees(s => s.fee_paid_on === null) : null,
      },
    }
  }, () => ({ crew: null, from: null, to: null, sessions: [], totals: { sessions: 0, days: 0, fees: null, paid: null, unpaid: null } }))
}

export interface WedCrewPayoutLine {
  session_id: string
  booking_id: string
  booking_no: string
  couple_names: string
  booking_status: WedBookingStatus
  session_status: WedSessionStatus
  date: string | null
  session_type: WedSessionType
  type_label: string
  role: WedCrewRole
  fee: number
  fee_paid_on: string | null
}

export interface WedCrewPayout {
  crew_id: string
  name: string
  nickname: string | null
  role: WedCrewRole
  color: string
  is_active: boolean
  sessions: number
  fees: number
  paid: number
  unpaid: number
  lines: WedCrewPayoutLine[]
}

export interface WedCrewPayouts {
  from: string | null
  to: string | null
  crew: WedCrewPayout[]
  totals: { sessions: number; fees: number; paid: number; unpaid: number }
}

function parsePayoutLine(raw: unknown): WedCrewPayoutLine | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const sessionId = text(o.session_id)
  if (!sessionId) return null
  const type = oneOf(o.session_type, WED_SESSION_TYPES, 'other')
  return {
    session_id: sessionId,
    booking_id: text(o.booking_id),
    booking_no: text(o.booking_no),
    couple_names: text(o.couple_names),
    booking_status: oneOf(o.booking_status, WED_BOOKING_STATUSES, 'confirmed'),
    session_status: oneOf(o.session_status, WED_SESSION_STATUSES, 'scheduled'),
    date: dayKeyOrNull(o.date),
    session_type: type,
    type_label: textOrNull(o.type_label) ?? SESSION_TYPE_LABELS[type],
    role: oneOf(o.role, WED_CREW_ROLES, 'other'),
    fee: money(o.fee),
    fee_paid_on: dayKeyOrNull(o.fee_paid_on),
  }
}

/** wed_crew_payouts [M] — คืนค่าเสมอ (รับทั้ง {crew|by_crew|items: [...]} และรายการตรงๆ) */
export function parseCrewPayouts(raw: unknown): WedCrewPayouts {
  return safe(() => {
    const top = asObjLoose(raw)
    const o = top ?? {}
    const crew = list(top ? pick(top, 'crew', 'by_crew', 'items') : raw, (r): WedCrewPayout | null => {
      const c = asObjLoose(r)
      if (!c) return null
      const crewId = text(pick(c, 'crew_id', 'id'))
      if (!crewId) return null
      const lines = list(pick(c, 'lines', 'sessions_list', 'items', 'sessions'), parsePayoutLine)
      const sumLines = (pred: (l: WedCrewPayoutLine) => boolean) => round2(lines.filter(pred).reduce((s, l) => s + l.fee, 0))
      const sessionsCount = pick(c, 'sessions_count', 'count')
      return {
        crew_id: crewId,
        name: text(c.name),
        nickname: textOrNull(c.nickname),
        role: oneOf(c.role, WED_CREW_ROLES, 'other'),
        color: crewColor(c.color),
        is_active: has(c, 'is_active') ? bool(c.is_active, true) : true,
        sessions: sessionsCount !== undefined ? count(sessionsCount)
          : typeof c.sessions === 'number' || typeof c.sessions === 'string' ? count(c.sessions) : lines.length,
        fees: has(c, 'fees') ? money(c.fees) : has(c, 'total_fee') ? money(c.total_fee) : sumLines(() => true),
        paid: has(c, 'paid') ? money(c.paid) : sumLines(l => l.fee_paid_on !== null),
        unpaid: has(c, 'unpaid') ? money(c.unpaid) : sumLines(l => l.fee_paid_on === null),
        lines,
      }
    })
    const t = asObjLoose(o.totals) ?? {}
    const sum = (k: 'sessions' | 'fees' | 'paid' | 'unpaid') => round2(crew.reduce((s, c) => s + c[k], 0))
    return {
      from: dayKeyOrNull(o.from),
      to: dayKeyOrNull(o.to),
      crew,
      totals: {
        sessions: has(t, 'sessions') ? count(t.sessions) : sum('sessions'),
        fees: has(t, 'fees') ? money(t.fees) : sum('fees'),
        paid: has(t, 'paid') ? money(t.paid) : sum('paid'),
        unpaid: has(t, 'unpaid') ? money(t.unpaid) : sum('unpaid'),
      },
    }
  }, () => ({ from: null, to: null, crew: [], totals: { sessions: 0, fees: 0, paid: 0, unpaid: 0 } }))
}

// ---------------------------------------------------------------------------
// หน้าภาพรวม: wed_today · ตัวเลขบนเมนู: wed_badges
// ---------------------------------------------------------------------------
export interface WedInstallmentDue {
  booking_id: string
  booking_no: string
  couple_names: string
  status: WedBookingStatus
  status_label: string
  installment_id: string | null
  seq: number
  label: string
  due_date: string | null
  amount: number
  amount_remaining: number
  overdue: boolean
}

export interface WedToday {
  day: string
  capacity: number
  today_sessions: WedDaySession[]
  next7: WedSessionMini[]
  followups: WedBookingMini[]
  holds_expiring: WedBookingMini[]
  installments_due: WedInstallmentDue[]
  deliverables_due: WedDeliverableBoardItem[]
  conflicts: WedCrewConflict[]
  month: {
    month: string            // 'YYYY-MM'
    bookings_confirmed: number
    jobs: number             // งาน (ที่กันคิว) ที่มีคิวในเดือนนี้
    inquiries_new: number    // งานที่สร้างใหม่ในเดือนนี้
    /** รายรับเดือนนี้ (สุทธิ) — null = ไม่ได้ส่งมา (พนักงาน) */
    revenue: number | null
  }
}

export function parseInstallmentDue(raw: unknown): WedInstallmentDue | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const bookingId = text(o.booking_id)
  if (!bookingId) return null
  const status = oneOf(o.status, WED_BOOKING_STATUSES, 'confirmed')
  return {
    booking_id: bookingId,
    booking_no: text(o.booking_no),
    couple_names: text(o.couple_names),
    status,
    status_label: textOrNull(o.status_label) ?? WED_STATUS_LABELS[status],
    installment_id: textOrNull(o.installment_id),
    seq: count(o.seq),
    label: text(o.label),
    due_date: dayKeyOrNull(o.due_date),
    amount: money(o.amount),
    amount_remaining: money(pick(o, 'amount_remaining', 'amount')),
    overdue: bool(o.overdue),
  }
}

/** wed_today — คืนค่าเสมอ */
export function parseWedToday(raw: unknown): WedToday {
  return safe(() => {
    const o = asObjLoose(raw) ?? {}
    const m = asObjLoose(o.month) ?? {}
    return {
      day: dayKey(pick(o, 'day', 'date')),
      capacity: count(o.capacity),
      today_sessions: list(o.today_sessions, parseDaySession).sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b))),
      next7: list(o.next7, parseSessionMini).sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b))),
      followups: list(o.followups, parseWedBookingMini),
      holds_expiring: list(o.holds_expiring, parseWedBookingMini),
      installments_due: list(o.installments_due, parseInstallmentDue),
      deliverables_due: list(o.deliverables_due, parseDeliverableBoardItem),
      conflicts: parseCrewConflicts(o.conflicts),
      month: {
        month: monthKeyOf(m.month),
        bookings_confirmed: count(m.bookings_confirmed),
        jobs: count(m.jobs),
        inquiries_new: count(m.inquiries_new),
        revenue: moneyOrNull(m.revenue),
      },
    }
  }, () => ({
    day: '', capacity: 0, today_sessions: [], next7: [], followups: [], holds_expiring: [], installments_due: [],
    deliverables_due: [], conflicts: [], month: { month: '', bookings_confirmed: 0, jobs: 0, inquiries_new: 0, revenue: null },
  }))
}

export interface WedBadges {
  followups: number
  holds_expiring: number
  deliverables_overdue: number
  installments_overdue: number
}

/** ตัวเลขบนเมนู (wed_badges) — อ่านไม่ได้ = 0 ทั้งหมด */
export function parseWedBadges(raw: unknown): WedBadges {
  const o = asObjLoose(raw) ?? {}
  return {
    followups: count(o.followups),
    holds_expiring: count(o.holds_expiring),
    deliverables_overdue: count(o.deliverables_overdue),
    installments_overdue: count(o.installments_overdue),
  }
}

// ---------------------------------------------------------------------------
// รายงาน: wed_report [M]
// ---------------------------------------------------------------------------
export interface WedReportMonth {
  month: string   // 'YYYY-MM'
  payment: number
  refund: number
  net: number
}

export interface WedReportPackage {
  package_name: string
  count: number
  value: number
}

export interface WedReportCrew {
  crew_id: string
  name: string
  nickname: string | null
  sessions: number
  fees: number
  paid: number
  unpaid: number
}

export interface WedReport {
  from: string | null
  to: string | null
  income: {
    by_month: WedReportMonth[]
    by_method: Record<WedPaymentMethod, number>
    /** รับชำระตามวัตถุประสงค์ (ไม่หักคืนเงิน) */
    by_purpose: Record<WedPaymentPurpose, number>
    total_payment: number
    total_refund: number
    total_net: number
  }
  bookings: {
    by_status: Record<WedBookingStatus, number>
    by_source: Record<WedSource, number>
    by_package: WedReportPackage[]
    total: number            // งานที่วันงานแรกอยู่ในช่วง
    created: number          // งานที่สร้างในช่วง
    value_total: number      // มูลค่างาน (ไม่นับยกเลิก/สอบถาม)
  }
  crew: { cost_total: number; paid_total: number; by_crew: WedReportCrew[] }
  profit_total: number
  upcoming_value: number
  outstanding_due_total: number
  overpaid_total: number
}

function emptyWedReport(): WedReport {
  const byStatus = {} as Record<WedBookingStatus, number>
  for (const s of WED_BOOKING_STATUSES) byStatus[s] = 0
  const bySource = {} as Record<WedSource, number>
  for (const s of WED_SOURCES) bySource[s] = 0
  const byMethod = {} as Record<WedPaymentMethod, number>
  for (const m of WED_PAYMENT_METHODS) byMethod[m] = 0
  const byPurpose = {} as Record<WedPaymentPurpose, number>
  for (const p of WED_PAYMENT_PURPOSES) byPurpose[p] = 0
  return {
    from: null, to: null,
    income: { by_month: [], by_method: byMethod, by_purpose: byPurpose, total_payment: 0, total_refund: 0, total_net: 0 },
    bookings: { by_status: byStatus, by_source: bySource, by_package: [], total: 0, created: 0, value_total: 0 },
    crew: { cost_total: 0, paid_total: 0, by_crew: [] },
    profit_total: 0, upcoming_value: 0, outstanding_due_total: 0, overpaid_total: 0,
  }
}

/** wed_report — คืนค่าเสมอ */
export function parseWedReport(raw: unknown): WedReport {
  return safe(() => {
    const o = asObjLoose(raw) ?? {}
    const inc = asObjLoose(o.income) ?? {}
    const bk = asObjLoose(o.bookings) ?? {}
    const cr = asObjLoose(o.crew) ?? {}
    const byMonth = list(inc.by_month, (r): WedReportMonth | null => {
      const d = asObjLoose(r)
      if (!d) return null
      const month = monthKeyOf(d.month)
      if (!month) return null
      return { month, payment: money(d.payment), refund: money(d.refund), net: money(d.net) }
    }).sort((a, b) => a.month.localeCompare(b.month))
    const methods = moneyMap(inc.by_method)
    const statuses = countMap(bk.by_status)
    const sources = countMap(bk.by_source)
    const byStatus = {} as Record<WedBookingStatus, number>
    for (const s of WED_BOOKING_STATUSES) byStatus[s] = statuses[s] ?? 0
    const bySource = {} as Record<WedSource, number>
    for (const s of WED_SOURCES) bySource[s] = sources[s] ?? 0
    const byMethod = {} as Record<WedPaymentMethod, number>
    for (const m of WED_PAYMENT_METHODS) byMethod[m] = methods[m] ?? 0
    const purposes = moneyMap(inc.by_purpose)
    const byPurpose = {} as Record<WedPaymentPurpose, number>
    for (const p of WED_PAYMENT_PURPOSES) byPurpose[p] = purposes[p] ?? 0
    const totalPayment = has(inc, 'total_payment') ? money(inc.total_payment) : round2(byMonth.reduce((s, d) => s + d.payment, 0))
    const totalRefund = has(inc, 'total_refund') ? money(inc.total_refund) : round2(byMonth.reduce((s, d) => s + d.refund, 0))
    return {
      from: dayKeyOrNull(o.from),
      to: dayKeyOrNull(o.to),
      income: {
        by_month: byMonth,
        by_method: byMethod,
        by_purpose: byPurpose,
        total_payment: totalPayment,
        total_refund: totalRefund,
        total_net: has(inc, 'total_net') ? money(inc.total_net) : round2(totalPayment - totalRefund),
      },
      bookings: {
        by_status: byStatus,
        by_source: bySource,
        by_package: list(bk.by_package, (r): WedReportPackage | null => {
          const p = asObjLoose(r)
          if (!p) return null
          return { package_name: text(p.package_name) || 'ไม่ระบุแพ็กเกจ', count: count(p.count), value: money(p.value) }
        }),
        total: has(bk, 'total') ? count(bk.total) : Object.values(byStatus).reduce((s, n) => s + n, 0),
        created: count(bk.created),
        value_total: money(bk.value_total),
      },
      crew: {
        cost_total: money(cr.cost_total),
        paid_total: money(cr.paid_total),
        by_crew: list(cr.by_crew, (r): WedReportCrew | null => {
          const c = asObjLoose(r)
          if (!c) return null
          return {
            crew_id: text(c.crew_id),
            name: text(c.name),
            nickname: textOrNull(c.nickname),
            sessions: count(c.sessions),
            fees: money(c.fees),
            paid: money(c.paid),
            unpaid: money(c.unpaid),
          }
        }),
      },
      profit_total: money(o.profit_total),
      upcoming_value: money(o.upcoming_value),
      outstanding_due_total: money(o.outstanding_due_total),
      overpaid_total: money(o.overpaid_total),
    }
  }, emptyWedReport)
}

// ---------------------------------------------------------------------------
// ส่งออก CSV: wed_export_bookings / wed_export_payments / wed_export_crew_fees [M] (returns table — แถวละ object)
// ชื่อคอลัมน์ตามที่ตกลงกับ supabase-fix-07-wedding.sql — คอลัมน์ที่ไม่มี = '' / 0 / null (ไม่ throw)
// ---------------------------------------------------------------------------
export interface WedExportBookingRow {
  booking_no: string
  status: string
  status_label: string
  source: string
  source_label: string
  created_at: string | null
  couple_names: string
  customer_name: string
  customer_phone: string
  first_date: string | null
  last_date: string | null
  sessions_count: number
  sessions: string          // สรุปคิว (ข้อความ)
  package_name: string
  package_price: number
  addons: string            // สรุปบริการเสริม (ข้อความ)
  addons_total: number
  travel_fee: number
  discount: number
  base_total: number
  charges_total: number
  grand_total: number
  paid: number
  due: number
  deposit_required: number
  crew_cost_total: number | null
  profit: number | null
  cancel_reason: string
  note: string
  created_by_name: string
}

export interface WedExportPaymentRow {
  receipt_no: string
  paid_on: string | null
  created_at: string | null
  booking_no: string
  couple_names: string
  customer_name: string
  kind: string
  kind_label: string
  method: string
  method_label: string
  purpose: string
  purpose_label: string
  amount: number
  /** ผลต่อยอดรับจริง (รับ = +, คืน = −, ยกเลิก = 0) */
  income_effect: number
  status: string
  status_label: string
  has_slip: boolean
  note: string
  voided_at: string | null
  void_reason: string
  created_by_name: string
}

export interface WedExportCrewFeeRow {
  date: string | null
  booking_no: string
  couple_names: string
  booking_status: string
  booking_status_label: string
  session_type: string
  type_label: string
  session_title: string
  crew_name: string
  crew_nickname: string
  role: string
  role_label: string
  fee: number
  fee_paid_on: string | null
  paid: boolean
}

function exportRows<T>(raw: unknown, map: (o: Obj) => T): T[] {
  return list(raw, r => {
    const o = asObjLoose(r)
    return o ? map(o) : null
  })
}

export function parseExportBookings(raw: unknown): WedExportBookingRow[] {
  return exportRows(raw, o => ({
    booking_no: text(o.booking_no),
    status: text(o.status),
    status_label: textOrNull(o.status_label) ?? wedStatusLabel(text(o.status)),
    source: text(o.source),
    source_label: textOrNull(o.source_label) ?? (text(o.source) ? wedSourceLabel(text(o.source)) : ''),
    created_at: textOrNull(o.created_at),
    couple_names: text(o.couple_names),
    customer_name: text(o.customer_name),
    customer_phone: text(o.customer_phone),
    first_date: dayKeyOrNull(pick(o, 'first_date', 'first_session_date')),
    last_date: dayKeyOrNull(pick(o, 'last_date', 'last_session_date')),
    sessions_count: count(o.sessions_count),
    sessions: text(o.sessions),
    package_name: text(o.package_name),
    package_price: money(o.package_price),
    addons: text(o.addons),
    addons_total: money(o.addons_total),
    travel_fee: money(o.travel_fee),
    discount: money(o.discount),
    base_total: money(o.base_total),
    charges_total: money(o.charges_total),
    grand_total: money(o.grand_total),
    paid: money(o.paid),
    due: money(o.due),
    deposit_required: money(o.deposit_required),
    crew_cost_total: moneyOrNull(o.crew_cost_total),
    profit: moneyOrNull(o.profit),
    cancel_reason: text(o.cancel_reason),
    note: text(o.note),
    created_by_name: text(o.created_by_name),
  }))
}

export function parseExportPayments(raw: unknown): WedExportPaymentRow[] {
  return exportRows(raw, o => ({
    receipt_no: text(o.receipt_no),
    paid_on: dayKeyOrNull(o.paid_on),
    created_at: textOrNull(o.created_at),
    booking_no: text(o.booking_no),
    couple_names: text(o.couple_names),
    customer_name: text(o.customer_name),
    kind: text(o.kind),
    kind_label: textOrNull(o.kind_label) ?? labelFrom(WED_PAYMENT_KIND_LABELS, text(o.kind)),
    method: text(o.method),
    method_label: textOrNull(o.method_label) ?? wedMethodLabel(text(o.method)),
    purpose: text(o.purpose),
    purpose_label: textOrNull(o.purpose_label) ?? (text(o.purpose) ? wedPurposeLabel(text(o.purpose)) : ''),
    amount: money(o.amount),
    income_effect: money(o.income_effect),
    status: text(o.status),
    status_label: text(o.status_label),
    has_slip: bool(o.has_slip),
    note: text(o.note),
    voided_at: textOrNull(o.voided_at),
    void_reason: text(o.void_reason),
    created_by_name: text(o.created_by_name),
  }))
}

export function parseExportCrewFees(raw: unknown): WedExportCrewFeeRow[] {
  return exportRows(raw, o => ({
    date: dayKeyOrNull(pick(o, 'date', 'session_date')),
    booking_no: text(o.booking_no),
    couple_names: text(o.couple_names),
    booking_status: text(o.booking_status),
    booking_status_label: textOrNull(o.booking_status_label) ?? (text(o.booking_status) ? wedStatusLabel(text(o.booking_status)) : ''),
    session_type: text(o.session_type),
    type_label: textOrNull(o.type_label) ?? (text(o.session_type) ? sessionTypeLabel(text(o.session_type)) : ''),
    session_title: text(pick(o, 'session_title', 'title')),
    crew_name: text(o.crew_name),
    crew_nickname: text(o.crew_nickname),
    role: text(o.role),
    role_label: textOrNull(o.role_label) ?? (text(o.role) ? crewRoleLabel(text(o.role)) : ''),
    fee: money(o.fee),
    fee_paid_on: dayKeyOrNull(o.fee_paid_on),
    paid: has(o, 'paid') ? bool(o.paid) : dayKeyOrNull(o.fee_paid_on) !== null,
  }))
}

// ---------------------------------------------------------------------------
// รายการเงินจาก select ตาราง wed_payments (หน้าการเงิน) — รับ booking ที่ embed มา (wed_bookings / booking)
// ---------------------------------------------------------------------------
export interface WedPaymentRow extends WedPayment {
  booking_id: string
  booking_no: string
  couple_names: string
}

export function parseWedPaymentRow(raw: unknown): WedPaymentRow | null {
  const p = parseWedPayment(raw)
  if (!p) return null
  const o = asObjLoose(raw) ?? {}
  const b = asObjLoose(pick(o, 'booking', 'wed_bookings')) ?? {}
  return {
    ...p,
    booking_id: text(pick(o, 'booking_id')) || text(b.id),
    booking_no: text(pick(o, 'booking_no')) || text(b.booking_no),
    couple_names: text(pick(o, 'couple_names')) || text(b.couple_names),
  }
}

// ---------------------------------------------------------------------------
// หน้าติดตามงานของคู่บ่าวสาว (สาธารณะ): wed_public_booking
// ---------------------------------------------------------------------------
export interface WedPublicShop {
  name: string
  tagline: string | null
  phone: string | null
  line_id: string | null
  line_url: string | null    // ผ่าน safeHttpUrl แล้ว
  instagram: string | null
  facebook: string | null
  tiktok: string | null
  email: string | null
  logo_url_path: string | null   // แสดงด้วย weddingImageUrl(logo_url_path)
}

export interface WedPublicSession {
  session_type: WedSessionType
  type_label: string
  title: string | null
  date: string | null
  start_time: string | null
  end_time: string | null
  venue_name: string | null
  venue_address: string | null
  map_url: string | null
  run_sheet: WedRunSheetRow[]
}

export interface WedPublicDeliverable {
  name: string
  qty: number
  unit: string | null
  due_date: string | null
  status: WedDeliverableStatus
  status_label: string
  link_url: string | null    // มีเฉพาะเมื่อส่งแล้ว (ผ่าน safeHttpUrl)
  delivered_at: string | null
}

export interface WedPublicBooking {
  /**
   * 'ok' = แสดงได้ · 'cancelled' = งานยกเลิก (ข้อมูลย่อ) · 'disabled' = ร้านปิดลิงก์ติดตามงาน
   * 'not_found' = อ่านไม่ได้ — หมายเหตุ: โทเคนผิด/ไม่พบงาน ฐานข้อมูล raise error 'ไม่พบงานนี้ ...' (ไม่ได้คืน payload)
   *   หน้าเว็บต้องจับ error ของ RPC แล้วแสดงสถานะ "ไม่พบงาน" เอง
   */
  state: 'ok' | 'cancelled' | 'not_found' | 'disabled'
  message: string | null
  shop: WedPublicShop
  booking_no: string
  status: WedBookingStatus | null
  status_label: string
  couple_names: string
  customer_name_masked: string
  phone_masked: string
  sessions: WedPublicSession[]
  package_name: string | null
  package_hours: number | null
  addons: { name: string; qty: number; unit: string | null }[]
  deliverables: WedPublicDeliverable[]
  /** แผนชิ้นงานจากแพ็กเกจ (มีเฉพาะตอนยังไม่ได้สร้างรายการส่งงาน) */
  deliverables_plan: WedDeliverablePlanItem[]
  money: {
    grand_total: number; paid: number; due: number; deposit_required: number; deposit_met: boolean
    deposit_due: number; balance_due_date: string | null
  }
  installments: {
    label: string; due_date: string | null; amount: number; paid_amount: number; amount_remaining: number
    status: WedInstallmentStatus; overdue: boolean
  }[]
  next_due: WedNextDue | null
  payment_info: { promptpay_id: string | null; promptpay_name: string | null; bank_accounts: WedBankAccount[] }
  booking_note: string | null
  terms_text: string
  hold_until: string | null
  created_at: string | null
  confirmed_at: string | null
  shot_at: string | null
  delivered_at: string | null
  completed_at: string | null
}

const EMPTY_PUBLIC_SHOP: WedPublicShop = {
  name: DEFAULT_WEDDING_SHOP_NAME, tagline: null, phone: null, line_id: null, line_url: null, instagram: null,
  facebook: null, tiktok: null, email: null, logo_url_path: null,
}

function emptyPublicBooking(state: WedPublicBooking['state'], message: string | null): WedPublicBooking {
  return {
    state, message, shop: { ...EMPTY_PUBLIC_SHOP }, booking_no: '', status: null, status_label: '', couple_names: '',
    customer_name_masked: '', phone_masked: '', sessions: [], package_name: null, package_hours: null, addons: [],
    deliverables: [], deliverables_plan: [],
    money: { grand_total: 0, paid: 0, due: 0, deposit_required: 0, deposit_met: false, deposit_due: 0, balance_due_date: null },
    installments: [], next_due: null, payment_info: { promptpay_id: null, promptpay_name: null, bank_accounts: [] },
    booking_note: null, terms_text: '', hold_until: null, created_at: null, confirmed_at: null, shot_at: null,
    delivered_at: null, completed_at: null,
  }
}

/**
 * wed_public_booking — คืนค่าเสมอ: อ่านไม่ได้/ไม่มีเลขงาน → state 'not_found'
 * ฐานข้อมูลบอกสถานะด้วย state ('ok' / 'cancelled' / 'disabled') — รับ {found:false} / {portal_enabled:false} ไว้ด้วย
 */
export function parseWedPublicBooking(raw: unknown): WedPublicBooking {
  return safe((): WedPublicBooking => {
    const o = asObjLoose(raw)
    if (!o) return emptyPublicBooking('not_found', null)
    const message = textOrNull(o.message)
    const s = asObjLoose(o.shop) ?? {}
    const shop: WedPublicShop = {
      name: textOrNull(s.name)?.trim() || DEFAULT_WEDDING_SHOP_NAME,
      tagline: textOrNull(s.tagline),
      phone: textOrNull(s.phone),
      line_id: textOrNull(s.line_id),
      line_url: safeHttpUrl(s.line_url),
      instagram: textOrNull(s.instagram),
      facebook: textOrNull(s.facebook),
      tiktok: textOrNull(s.tiktok),
      email: textOrNull(s.email),
      logo_url_path: textOrNull(s.logo_url_path),
    }
    const st = text(o.state).trim()
    if (st === 'disabled' || bool(o.disabled) || (has(o, 'portal_enabled') && !bool(o.portal_enabled, true))) {
      return { ...emptyPublicBooking('disabled', message), shop }
    }
    if (st === 'not_found' || (has(o, 'found') && !bool(o.found, true))) return { ...emptyPublicBooking('not_found', message), shop }
    const bookingNo = text(o.booking_no)
    const status = oneOfOrNull(o.status, WED_BOOKING_STATUSES)
    if (!bookingNo && !status) return { ...emptyPublicBooking('not_found', message), shop }
    const m = asObjLoose(o.money) ?? {}
    const pi = asObjLoose(o.payment_info) ?? {}
    const base: WedPublicBooking = {
      state: st === 'cancelled' || status === 'cancelled' ? 'cancelled' : 'ok',
      message,
      shop,
      booking_no: bookingNo,
      status,
      status_label: textOrNull(o.status_label) ?? (status ? WED_STATUS_LABELS[status] : ''),
      couple_names: text(o.couple_names),
      customer_name_masked: text(o.customer_name_masked),
      phone_masked: text(o.phone_masked),
      sessions: list(o.sessions, (r): WedPublicSession | null => {
        const x = asObjLoose(r)
        if (!x) return null
        const type = oneOf(x.session_type, WED_SESSION_TYPES, 'other')
        return {
          session_type: type,
          type_label: textOrNull(x.type_label) ?? SESSION_TYPE_LABELS[type],
          title: textOrNull(x.title),
          date: dayKeyOrNull(x.date),
          start_time: normTime(x.start_time),
          end_time: normTime(x.end_time),
          venue_name: textOrNull(x.venue_name),
          venue_address: textOrNull(x.venue_address),
          map_url: safeHttpUrl(x.map_url),
          run_sheet: parseRunSheet(x.run_sheet),
        }
      }).sort((a, b) => `${a.date ?? '9999'} ${a.start_time ?? '99'}`.localeCompare(`${b.date ?? '9999'} ${b.start_time ?? '99'}`)),
      package_name: textOrNull(o.package_name),
      package_hours: has(o, 'package_hours') ? Math.max(0, Math.round(num(o.package_hours) * 10) / 10) : null,
      addons: list(o.addons, r => {
        const a = asObjLoose(r)
        if (!a) return null
        const name = text(a.name).trim()
        return name ? { name, qty: addonQty(a.qty), unit: textOrNull(a.unit) } : null
      }),
      deliverables_plan: parseDeliverablesPlan(o.deliverables_plan),
      deliverables: list(o.deliverables, (r): WedPublicDeliverable | null => {
        const d = asObjLoose(r)
        if (!d) return null
        const name = text(d.name).trim()
        if (!name) return null
        const dst = oneOf(d.status, WED_DELIVERABLE_STATUSES, 'pending')
        return {
          name,
          qty: Math.max(1, int(d.qty) || 1),
          unit: textOrNull(d.unit),
          due_date: dayKeyOrNull(d.due_date),
          status: dst,
          status_label: textOrNull(d.status_label) ?? DELIVERABLE_STATUS_LABELS[dst],
          // ลิงก์โชว์เฉพาะชิ้นที่ส่งแล้ว (กันไว้อีกชั้น แม้ฐานข้อมูลจะไม่ส่งมาอยู่แล้ว)
          link_url: dst === 'delivered' ? safeHttpUrl(d.link_url) : null,
          delivered_at: textOrNull(d.delivered_at),
        }
      }),
      money: {
        grand_total: money(m.grand_total),
        paid: money(m.paid),
        due: money(m.due),
        deposit_required: money(m.deposit_required),
        deposit_met: bool(m.deposit_met),
        deposit_due: Math.max(0, money(m.deposit_due)),
        balance_due_date: dayKeyOrNull(m.balance_due_date),
      },
      installments: list(o.installments, r => {
        const i = asObjLoose(r)
        if (!i) return null
        const amount = money(i.amount)
        const paidAmount = money(i.paid_amount)
        return {
          label: text(i.label),
          due_date: dayKeyOrNull(i.due_date),
          amount,
          paid_amount: paidAmount,
          amount_remaining: has(i, 'amount_remaining') ? money(i.amount_remaining) : Math.max(0, round2(amount - paidAmount)),
          status: oneOf(i.status, WED_INSTALLMENT_STATUSES, 'upcoming'),
          overdue: bool(i.overdue),
        }
      }),
      next_due: parseNextDue(o.next_due),
      payment_info: {
        promptpay_id: textOrNull(pi.promptpay_id),
        promptpay_name: textOrNull(pi.promptpay_name),
        bank_accounts: list(pi.bank_accounts, parseBankAccount).slice(0, MAX_WED_BANK_ACCOUNTS),
      },
      booking_note: textOrNull(o.booking_note),
      terms_text: text(o.terms_text),
      hold_until: textOrNull(o.hold_until),
      created_at: textOrNull(o.created_at),
      confirmed_at: textOrNull(o.confirmed_at),
      shot_at: textOrNull(o.shot_at),
      delivered_at: textOrNull(o.delivered_at),
      completed_at: textOrNull(o.completed_at),
    }
    return base
  }, () => emptyPublicBooking('not_found', null))
}

// ---------------------------------------------------------------------------
// ข้อมูลที่ส่งเข้า RPC (ชนิดอย่างเดียว — ฐานข้อมูลตรวจซ้ำทุกช่อง)
// ---------------------------------------------------------------------------
export interface WedSessionCrewInput {
  crew_id: string
  role?: WedCrewRole | null
  /** ผู้จัดการเท่านั้น — พนักงานไม่ส่ง (ฐานข้อมูลใช้ค่าจ้างมาตรฐานของทีมงาน) */
  fee?: number | null
  note?: string | null
}

export interface WedSessionInput {
  id?: string | null          // ตอนแก้ไข = คิวเดิม (ไม่ส่ง = คิวใหม่)
  session_type: WedSessionType
  title?: string | null
  date?: string | null
  start_time?: string | null  // 'HH:MM'
  end_time?: string | null
  call_time?: string | null
  venue_name?: string | null
  venue_address?: string | null
  map_url?: string | null
  venue_contact?: string | null
  dress_code?: string | null
  notes?: string | null
  run_sheet?: WedRunSheetRow[]
  status?: WedSessionStatus
  crew?: WedSessionCrewInput[]
}

export interface WedAddonInput {
  id?: string | null          // ตอนแก้ไข = แถวเดิม
  addon_id?: string | null
  name: string
  qty: number
  unit_price: number
}

export interface WedCustomerInput {
  id?: string | null
  client_id?: string | null
  name: string
  partner_name?: string | null
  phone: string
  phone2?: string | null
  line_id?: string | null
  instagram?: string | null
  facebook?: string | null
  email?: string | null
  address?: string | null
  source?: WedSource | null
  note?: string | null
  updated_at?: string | null
}

/** payload ของ wed_quote / wed_create_booking / wed_update_booking */
export interface WedBookingPayload {
  customer_id?: string | null
  customer?: WedCustomerInput | null
  couple_names: string
  status?: 'inquiry' | 'hold' | 'confirmed'
  source?: WedSource | null
  package_id?: string | null
  package_name?: string | null
  package_price?: number | null
  package_hours?: number | null
  package_description?: string | null
  deliverables_plan?: WedDeliverablePlanItem[]
  addons?: WedAddonInput[]
  travel_fee?: number
  discount?: number
  discount_note?: string | null
  sessions: WedSessionInput[]
  followup_date?: string | null
  followup_note?: string | null
  coordinator_name?: string | null
  coordinator_phone?: string | null
  mood_link?: string | null
  customer_note?: string | null
  note?: string | null
  force?: boolean
  /** wed_update_booking: รหัสคำขอสำหรับกดซ้ำ/เน็ตหลุด */
  client_id?: string | null
  /** wed_create_booking: รับเงินทันทีหลังสร้าง */
  payments?: { kind: 'payment'; method: WedPaymentMethod; amount: number; note?: string | null }[]
}

export interface WedPackageInput {
  id?: string | null
  client_id?: string | null
  updated_at?: string | null
  name: string
  description?: string | null
  price: number
  hours: number
  crew_size: number
  deliverables: WedDeliverablePlanItem[]
  is_active?: boolean
  sort_order?: number
}

export interface WedAddonCatalogInput {
  id?: string | null
  client_id?: string | null
  updated_at?: string | null
  name: string
  price: number
  unit?: string | null
  description?: string | null
  is_active?: boolean
  sort_order?: number
}

export interface WedCrewInput {
  id?: string | null
  client_id?: string | null
  updated_at?: string | null
  name: string
  nickname?: string | null
  role: WedCrewRole
  phone?: string | null
  line_id?: string | null
  default_fee?: number | null
  color?: string | null
  is_active?: boolean
  note?: string | null
}

export interface WedDeliverableInput {
  id?: string | null
  name: string
  qty: number
  unit?: string | null
  due_date?: string | null
  status: WedDeliverableStatus
  link_url?: string | null
  note?: string | null
  editor_crew_id?: string | null
  sort_order?: number
}

/** wed_save_settings: ส่งเฉพาะช่องที่แก้ (ช่องที่ไม่ส่ง = คงเดิม) */
export type WedSettingsInput = Partial<Omit<WedSettings, 'updated_at' | 'updated_by' | 'logo_url_path'>>
