// ===== ร้านเช่าชุด: ชนิดข้อมูล + ตัวอ่าน JSON ของ RPC (supabase-fix-05-rental.sql / supabase-fix-06-rental-online.sql) =====
// ใช้ได้ทั้ง server และ client (ไม่มี import ฝั่งเซิร์ฟเวอร์ ไม่แตะ window/document ตอนโหลดไฟล์)
// ตัวอ่าน (parse*) ไม่ throw เด็ดขาด: ค่าแปลก/หายไป → ค่าปลอดภัย (เงิน = 0 ปัด 2 ตำแหน่ง, ข้อความ = '' หรือ null, ธง = false)
//   - ตัวอ่าน "รายการเดียว" (การจอง / ชุด / ลูกค้า / ชุดหน้าเว็บ / การจองหน้าเว็บ) → null เมื่อไม่ใช่ object หรือไม่มีรหัสหลัก
//   - ตัวอ่าน "ภาพรวม" (ตั้งค่า / ค้นหาชุดว่าง / ปฏิทิน / ตาราง / วันนี้ / รายงาน / แคตตาล็อก ...) → คืนค่าเสมอ (ไม่มีข้อมูล = รายการว่าง)
// numeric จาก PostgREST อาจมาเป็นสตริง → ทุกช่องเงินผ่าน num + round2 (lib/money.ts)
// ไซส์ null = "ฟรีไซส์" (หน่วยที่ไม่ระบุไซส์) — ใช้ sizeLabel()/sizeKey() ตอนแสดงผล/ทำ key
import { num, round2 } from '@/lib/money'
import { daysBetweenKeys } from '@/lib/format'
import type { ShopSupabase } from '@/lib/shop'

// ---------------------------------------------------------------------------
// ค่าคงที่
// ---------------------------------------------------------------------------
/** ถังรูปชุด (public read) — path = '<item_id>/<uuid>.<ext>' */
export const RENTAL_IMAGE_BUCKET = 'rental-images'
/** ถังสลิปโอนเงิน (private — ดูผ่าน createSignedUrl) — path = '<booking_id>/<uuid>.<ext>' */
export const RENTAL_SLIP_BUCKET = 'rental-slips'
/** ชื่อร้านเริ่มต้นเมื่อยังไม่ได้ตั้ง (ห้าม hardcode ชื่อร้านจริง — อ่านจาก rental_settings.shop_name เสมอ) */
export const DEFAULT_RENTAL_SHOP_NAME = 'ร้านเช่าชุด'
export const MAX_RENTAL_DAYS = 60
export const MAX_BOOKING_LINES = 30
export const MAX_PUBLIC_LINES = 10
export const MAX_SLIPS_PER_BOOKING = 5
/** สลิปที่ส่งได้ทั้งหมดต่อการจอง (ทุกสถานะ รวมที่ไม่อนุมัติ/ยกเลิก) — ตรงกับ rental_public_add_slip */
export const MAX_SLIP_UPLOADS_PER_BOOKING = 10
export const MAX_RENTAL_MONEY = 99999999.99
/** ลิงก์หน้าจองออนไลน์ (สัมพัทธ์) — ลิงก์เต็มสร้างจาก window.location.origin + PUBLIC_BOOK_PATH */
export const PUBLIC_BOOK_PATH = '/book'

/** ข้อความเมื่อฐานข้อมูลยังไม่มีระบบร้านเช่าชุด (ใช้คู่ isMigrationMissing จาก lib/migration.ts) */
export const FIX05_MISSING_MSG =
  'ฐานข้อมูลยังไม่มีระบบร้านเช่าชุด — รันไฟล์ supabase-fix-05-rental.sql ใน Supabase SQL Editor ก่อน แล้วโหลดหน้านี้ใหม่'
/** ข้อความเมื่อยังไม่มีระบบจองออนไลน์/รายงานร้านเช่า */
export const FIX06_MISSING_MSG =
  'ฐานข้อมูลยังไม่มีระบบจองออนไลน์/รายงานร้านเช่าชุด — รันไฟล์ supabase-fix-06-rental-online.sql ใน Supabase SQL Editor ก่อน แล้วโหลดหน้านี้ใหม่'

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

function int(v: unknown): number {
  return Math.trunc(num(v))
}

function intOrNull(v: unknown): number | null {
  return v === null || v === undefined || v === '' ? null : int(v)
}

function money(v: unknown): number {
  return round2(num(v))
}

function moneyOrNull(v: unknown): number | null {
  return v === null || v === undefined || v === '' ? null : round2(num(v))
}

function boolOrNull(v: unknown): boolean | null {
  if (v === null || v === undefined || v === '') return null
  return bool(v)
}

// day key 'YYYY-MM-DD' (ตัดเวลาท้ายออกถ้ามี) ; ไม่ใช่วันที่ = ''
function dayKey(v: unknown): string {
  const s = text(v).trim()
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s)
  return m ? m[1] : ''
}

function dayKeyOrNull(v: unknown): string | null {
  const k = dayKey(v)
  return k === '' ? null : k
}

function list<T>(v: unknown, parse: (raw: unknown) => T | null): T[] {
  const out: T[] = []
  const a = asArr(v)
  for (let i = 0; i < a.length; i++) {
    const item = parse(a[i])
    if (item !== null) out.push(item)
  }
  return out
}

function textList(v: unknown): string[] {
  const out: string[] = []
  const a = asArr(v)
  for (let i = 0; i < a.length; i++) {
    const s = textOrNull(a[i])
    if (s !== null) out.push(s)
  }
  return out
}

// ไซส์ (null = ฟรีไซส์) ไม่ซ้ำ ตามลำดับที่ฐานข้อมูลส่งมา (ฐานข้อมูลเรียงตาม product_size_rank แล้ว)
function sizeList(v: unknown): RentalSize[] {
  const out: RentalSize[] = []
  const seen = new Set<string>()
  const a = asArr(v)
  for (let i = 0; i < a.length; i++) {
    const s = sizeOf(a[i])
    const k = sizeKey(s)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}

function sizeOf(v: unknown): RentalSize {
  return textOrNull(v)
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  const s = text(v).trim()
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback
}

// ---------------------------------------------------------------------------
// ชนิดค่าแบบ enum + ป้ายภาษาไทย
// ---------------------------------------------------------------------------
/** ไซส์ของชิ้นชุด — null = ฟรีไซส์ */
export type RentalSize = string | null

export type RentalBookingStatus =
  | 'pending' | 'confirmed' | 'picked_up' | 'returned' | 'completed' | 'cancelled' | 'expired' | 'no_show'
export const RENTAL_BOOKING_STATUSES: readonly RentalBookingStatus[] = [
  'pending', 'confirmed', 'picked_up', 'returned', 'completed', 'cancelled', 'expired', 'no_show',
] as const

export type RentalLineStatus = 'booked' | 'picked_up' | 'returned' | 'lost'
export const RENTAL_LINE_STATUSES: readonly RentalLineStatus[] = ['booked', 'picked_up', 'returned', 'lost'] as const

export type RentalSource = 'walkin' | 'online' | 'phone' | 'line' | 'other'
export const RENTAL_SOURCES: readonly RentalSource[] = ['walkin', 'online', 'phone', 'line', 'other'] as const

export type RentalPaymentKind = 'payment' | 'refund' | 'security_in' | 'security_out' | 'security_apply'
export const RENTAL_PAYMENT_KINDS: readonly RentalPaymentKind[] = [
  'payment', 'refund', 'security_in', 'security_out', 'security_apply',
] as const

/** วิธีรับ/จ่ายเงิน — 'none' ใช้กับ security_apply (หักเงินประกัน ไม่มีเงินเข้า-ออกจริง) เท่านั้น */
export type RentalPaymentMethod = 'cash' | 'transfer' | 'promptpay' | 'credit' | 'none'
export const RENTAL_PAYMENT_METHODS: readonly RentalPaymentMethod[] = ['cash', 'transfer', 'promptpay', 'credit', 'none'] as const
/** วิธีที่มีเงินเข้า-ออกจริง (ตัวเลือกในฟอร์มรับเงิน/คืนเงิน) */
export type RentalCashMethod = Exclude<RentalPaymentMethod, 'none'>
export const RENTAL_CASH_METHODS: readonly RentalCashMethod[] = ['cash', 'transfer', 'promptpay', 'credit'] as const

export type RentalPaymentStatus = 'confirmed' | 'pending_review' | 'rejected'
export const RENTAL_PAYMENT_STATUSES: readonly RentalPaymentStatus[] = ['confirmed', 'pending_review', 'rejected'] as const

export type RentalCondition = 'ok' | 'dirty' | 'damaged' | 'lost'
export const RENTAL_CONDITIONS: readonly RentalCondition[] = ['ok', 'dirty', 'damaged', 'lost'] as const

export type RentalChargeKind = 'late' | 'damage' | 'lost' | 'cleaning' | 'delivery' | 'other'
export const RENTAL_CHARGE_KINDS: readonly RentalChargeKind[] = ['late', 'damage', 'lost', 'cleaning', 'delivery', 'other'] as const

export type RentalUnitStatus = 'available' | 'maintenance' | 'retired'
export const RENTAL_UNIT_STATUSES: readonly RentalUnitStatus[] = ['available', 'maintenance', 'retired'] as const

export type RentalLateFeeMode = 'per_day_item' | 'fixed_per_day' | 'none'
export const RENTAL_LATE_FEE_MODES: readonly RentalLateFeeMode[] = ['per_day_item', 'fixed_per_day', 'none'] as const

export type RentalDeliveryMethod = 'pickup' | 'delivery'
export const RENTAL_DELIVERY_METHODS: readonly RentalDeliveryMethod[] = ['pickup', 'delivery'] as const

/** วันที่ถูกจองในปฏิทินชุด: rent = วันเช่าจริง, buffer = วันกันไว้ก่อน/หลัง (ซัก/เตรียมชุด) */
export type RentalBlockKind = 'rent' | 'buffer'

export const STATUS_LABELS: Readonly<Record<RentalBookingStatus, string>> = {
  pending: 'รอยืนยัน',
  confirmed: 'จองแล้ว',
  picked_up: 'กำลังเช่า',
  returned: 'คืนแล้ว รอปิดงาน',
  completed: 'เสร็จสิ้น',
  cancelled: 'ยกเลิก',
  expired: 'หมดเวลาถือจอง',
  no_show: 'ไม่มารับชุด',
}

// คลาสป้ายใน app/globals.css: รอยืนยัน = อำพัน · จองแล้ว = โรสโกลด์ · กำลังเช่า = เขียว · คืนแล้วรอปิด = ขอบเทา
// เสร็จสิ้น = เทาเรียบ · ยกเลิก/ไม่มารับ = แดง · หมดเวลา = เทาเข้ม (ใช้คู่ไอคอน/ข้อความเสมอ ไม่พึ่งสีอย่างเดียว)
export const STATUS_CHIP: Readonly<Record<RentalBookingStatus, string>> = {
  pending: 'badge-return',
  confirmed: 'chip-strong',
  picked_up: 'badge-in',
  returned: 'chip-outline',
  completed: 'chip',
  cancelled: 'badge-out',
  expired: 'badge-adjust',
  no_show: 'badge-out',
}

export const LINE_STATUS_LABELS: Readonly<Record<RentalLineStatus, string>> = {
  booked: 'จองไว้',
  picked_up: 'ลูกค้ารับแล้ว',
  returned: 'คืนแล้ว',
  lost: 'สูญหาย',
}

export const SOURCE_LABELS: Readonly<Record<RentalSource, string>> = {
  walkin: 'หน้าร้าน',
  online: 'จองออนไลน์',
  phone: 'โทรศัพท์',
  line: 'LINE',
  other: 'อื่นๆ',
}

export const PAYMENT_KIND_LABELS: Readonly<Record<RentalPaymentKind, string>> = {
  payment: 'ชำระค่าเช่า',
  refund: 'คืนเงินค่าเช่า',
  security_in: 'รับเงินประกัน',
  security_out: 'คืนเงินประกัน',
  security_apply: 'หักเงินประกัน',
}

/** หัวเอกสารใบเสร็จตามชนิดรายการเงิน */
export const RECEIPT_TITLES: Readonly<Record<RentalPaymentKind, string>> = {
  payment: 'ใบเสร็จรับเงิน',
  refund: 'ใบคืนเงิน',
  security_in: 'ใบรับเงินประกัน',
  security_out: 'ใบคืนเงินประกัน',
  security_apply: 'ใบหักเงินประกัน',
}

export const METHOD_LABELS: Readonly<Record<RentalPaymentMethod, string>> = {
  cash: 'เงินสด',
  transfer: 'โอนเงิน',
  promptpay: 'พร้อมเพย์',
  credit: 'บัตรเครดิต',
  none: 'หักจากเงินประกัน',
}

export const PAYMENT_STATUS_LABELS: Readonly<Record<RentalPaymentStatus, string>> = {
  confirmed: 'ยืนยันแล้ว',
  pending_review: 'รอตรวจสลิป',
  rejected: 'ไม่อนุมัติ',
}

export const CONDITION_LABELS: Readonly<Record<RentalCondition, string>> = {
  ok: 'สภาพดี',
  dirty: 'เปื้อน / ต้องซัก',
  damaged: 'ชำรุด',
  lost: 'สูญหาย',
}

export const CHARGE_KIND_LABELS: Readonly<Record<RentalChargeKind, string>> = {
  late: 'ค่าปรับคืนช้า',
  damage: 'ค่าเสียหาย',
  lost: 'ค่าชุดสูญหาย',
  cleaning: 'ค่าซัก / ทำความสะอาด',
  delivery: 'ค่าจัดส่ง',
  other: 'ค่าใช้จ่ายอื่นๆ',
}

export const UNIT_STATUS_LABELS: Readonly<Record<RentalUnitStatus, string>> = {
  available: 'พร้อมให้เช่า',
  maintenance: 'ส่งซ่อม / ไม่พร้อมให้เช่า',
  retired: 'เลิกใช้',
}

export const LATE_FEE_MODE_LABELS: Readonly<Record<RentalLateFeeMode, string>> = {
  per_day_item: 'คิดต่อวันต่อชุด (ตามราคาวันเพิ่มของชุด)',
  fixed_per_day: 'คิดอัตราคงที่ต่อวัน (ต่อการจอง)',
  none: 'ไม่คิดค่าปรับคืนช้า',
}

export const DELIVERY_METHOD_LABELS: Readonly<Record<RentalDeliveryMethod, string>> = {
  pickup: 'รับที่ร้าน',
  delivery: 'จัดส่ง',
}

/** ป้ายสถานะการจอง (ค่าแปลก → แสดงตามที่ได้มา) */
export function statusLabel(status: string | null | undefined): string {
  const s = text(status)
  return (RENTAL_BOOKING_STATUSES as readonly string[]).includes(s) ? STATUS_LABELS[s as RentalBookingStatus] : s || '-'
}

/** สถานะที่ "กันชิ้นชุดไว้" (ช่วงวันของชิ้นนั้นจองซ้ำไม่ได้) — ตรงกับ blocking ในฐานข้อมูล */
export function isBlockingStatus(status: RentalBookingStatus): boolean {
  return status !== 'cancelled' && status !== 'expired' && status !== 'no_show'
}

/** การจองที่ยังไม่จบ (ต้องดูแลต่อ) */
export function isOpenStatus(status: RentalBookingStatus): boolean {
  return status === 'pending' || status === 'confirmed' || status === 'picked_up' || status === 'returned'
}

// ---------------------------------------------------------------------------
// ตัวช่วยคำนวณ/แสดงผล
// ---------------------------------------------------------------------------
/** ป้ายไซส์: null/ว่าง = 'ฟรีไซส์' */
export function sizeLabel(size: RentalSize | undefined): string {
  const s = typeof size === 'string' ? size.trim() : ''
  return s === '' ? 'ฟรีไซส์' : s
}

/** คีย์ไซส์สำหรับ Map/React key (ฟรีไซส์ = '') — เทียบไม่สนตัวพิมพ์ */
export function sizeKey(size: RentalSize | undefined): string {
  return typeof size === 'string' ? size.trim().toLowerCase() : ''
}

/**
 * จำนวนวันเช่าแบบนับรวมวันแรกและวันสุดท้าย (รับศุกร์ คืนอาทิตย์ = 3 วัน)
 * day key ไม่ถูกต้อง หรือวันคืนก่อนวันรับ → 0
 */
export function rentalDays(fromKey: string, toKey: string): number {
  const d = daysBetweenKeys(fromKey, toKey)
  if (!Number.isFinite(d) || d < 0) return 0
  return d + 1
}

/**
 * ราคาเช่าของ 1 ชุดตามจำนวนวัน = ราคาเริ่มต้น + max(0, วัน − วันที่รวมในราคา) × ราคาวันเพิ่ม (ปัด 2 ตำแหน่ง)
 * ใช้แสดงตัวอย่างฝั่งหน้าจอเท่านั้น — ราคาจริงฐานข้อมูลคำนวณเอง (rental_quote / rental_create_booking)
 */
export function linePrice(basePrice: number, baseDays: number, extraDayPrice: number, days: number): number {
  const base = Math.max(0, num(basePrice))
  const bd = Math.max(1, Math.trunc(num(baseDays)) || 1)
  const extra = Math.max(0, num(extraDayPrice))
  const d = Math.max(0, Math.trunc(num(days)))
  if (d === 0) return 0
  return round2(base + Math.max(0, d - bd) * extra)
}

/** ลิงก์รูปในถัง rental-images (ถังเป็น public) — path = '<item_id>/<ไฟล์>' ; path ว่าง → '' */
export function rentalImageUrl(path: string | null | undefined): string {
  const encoded = String(path ?? '')
    .split('/')
    .filter(part => part !== '')
    .map(part => encodeURIComponent(part))
    .join('/')
  if (!encoded) return ''
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
  return `${base}/storage/v1/object/public/${RENTAL_IMAGE_BUCKET}/${encoded}`
}

/** เบอร์โทรเหลือแต่ตัวเลข (ตัดขีด/ช่องว่าง, เลขไทย → อารบิก) */
export function phoneDigits(phone: string | null | undefined): string {
  return String(phone ?? '').replace(/[๐-๙]/g, ch => String(ch.charCodeAt(0) - 0x0e50)).replace(/\D/g, '')
}

/** แสดงเบอร์โทรอ่านง่าย: มือถือ 10 หลัก 081-234-5678 · บ้าน 9 หลัก 02-123-4567 · อื่นๆ ตามเดิม */
export function formatPhone(phone: string | null | undefined): string {
  const d = phoneDigits(phone)
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`
  return d || String(phone ?? '')
}

/** ปิดเลขกลางของเบอร์โทร: 0812345678 → 081-xxx-5678 · 9 หลัก → 021-xx-4567 (สั้นกว่า 8 หลัก → ปิดหมดเหลือ 2 ตัวท้าย) ; ว่าง → '' */
export function maskPhone(phone: string | null | undefined): string {
  const d = phoneDigits(phone)
  if (!d) return ''
  if (d.length < 8) return 'x'.repeat(Math.max(0, d.length - 2)) + d.slice(-2)
  return `${d.slice(0, 3)}-${'x'.repeat(d.length - 7)}-${d.slice(-4)}`
}

/**
 * ปิดเลขบัตรประชาชน/พาสปอร์ต เหลือ 4 ตัวท้าย: 1234567890123 → xxxxxxxxx0123 ; สั้นกว่า 5 ตัว → ปิดทั้งหมด ; ว่าง → ''
 * (เลขเต็มแสดงเฉพาะหน้ารายละเอียดลูกค้า + สัญญาฉบับร้าน)
 */
export function maskIdCard(idCard: string | null | undefined): string {
  const s = String(idCard ?? '').replace(/[\s-]/g, '')
  if (!s) return ''
  if (s.length <= 4) return 'x'.repeat(s.length)
  return 'x'.repeat(s.length - 4) + s.slice(-4)
}

/** โทเคนลิงก์สถานะการจอง (64 ตัวอักษรฐาน 16 ตัวเล็ก) */
export function isBookingToken(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
}

/** path หน้าสถานะการจองสำหรับลูกค้า */
export function bookingStatusPath(token: string): string {
  return `${PUBLIC_BOOK_PATH}/status/${encodeURIComponent(token)}`
}

// ---------------------------------------------------------------------------
// ตั้งค่าร้าน: rental_get_settings / rental_save_settings
// ---------------------------------------------------------------------------
export interface RentalBankAccount {
  bank: string
  account_no: string
  account_name: string
}

export interface RentalSettings {
  shop_name: string
  tagline: string | null
  address: string | null
  phone: string | null
  line_id: string | null
  line_url: string | null
  facebook_url: string | null
  opening_hours: string | null
  promptpay_id: string | null     // เบอร์มือถือ 10 หลัก หรือเลขผู้เสียภาษี 13 หลัก
  promptpay_name: string | null
  bank_accounts: RentalBankAccount[]
  booking_deposit_percent: number // มัดจำจอง % ของค่าเช่าหลังส่วนลด
  min_booking_deposit: number
  default_base_days: number
  buffer_before_days: number
  buffer_after_days: number       // วันกันไว้หลังคืน (ซัก) — ค่าเริ่มต้น 1
  late_fee_mode: RentalLateFeeMode
  late_fee_fixed: number
  online_enabled: boolean
  online_hold_hours: number
  online_min_lead_days: number
  online_max_days: number
  online_notice: string | null
  terms_text: string
  receipt_footer: string | null
  updated_at: string | null
  updated_by: string | null
  public_url_path: string         // '/book'
}

export const DEFAULT_RENTAL_SETTINGS: Readonly<RentalSettings> = {
  shop_name: DEFAULT_RENTAL_SHOP_NAME,
  tagline: null,
  address: null,
  phone: null,
  line_id: null,
  line_url: null,
  facebook_url: null,
  opening_hours: null,
  promptpay_id: null,
  promptpay_name: null,
  bank_accounts: [],
  booking_deposit_percent: 50,
  min_booking_deposit: 0,
  default_base_days: 3,
  buffer_before_days: 0,
  buffer_after_days: 1,
  late_fee_mode: 'per_day_item',
  late_fee_fixed: 0,
  online_enabled: true,
  online_hold_hours: 24,
  online_min_lead_days: 1,
  online_max_days: 14,
  online_notice: null,
  terms_text: '',
  receipt_footer: 'ขอบคุณที่ใช้บริการค่ะ',
  updated_at: null,
  updated_by: null,
  public_url_path: PUBLIC_BOOK_PATH,
}

function parseBankAccount(raw: unknown): RentalBankAccount | null {
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

/** ตั้งค่าร้านเช่า (rental_get_settings / rental_save_settings) — คืนค่าเสมอ (ช่องที่หาย = ค่าเริ่มต้น) */
export function parseRentalSettings(raw: unknown): RentalSettings {
  const o = asObjLoose(raw)
  const d = DEFAULT_RENTAL_SETTINGS
  if (!o) return { ...d, bank_accounts: [] }
  const has = (k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined && o[k] !== null
  return {
    shop_name: textOrNull(o.shop_name)?.trim() || d.shop_name,
    tagline: textOrNull(o.tagline),
    address: textOrNull(o.address),
    phone: textOrNull(o.phone),
    line_id: textOrNull(o.line_id),
    line_url: textOrNull(o.line_url),
    facebook_url: textOrNull(o.facebook_url),
    opening_hours: textOrNull(o.opening_hours),
    promptpay_id: textOrNull(o.promptpay_id),
    promptpay_name: textOrNull(o.promptpay_name),
    bank_accounts: list(o.bank_accounts, parseBankAccount),
    booking_deposit_percent: has('booking_deposit_percent')
      ? Math.min(100, Math.max(0, money(o.booking_deposit_percent)))
      : d.booking_deposit_percent,
    min_booking_deposit: has('min_booking_deposit') ? Math.max(0, money(o.min_booking_deposit)) : d.min_booking_deposit,
    default_base_days: intIn(o.default_base_days, d.default_base_days, 1, MAX_RENTAL_DAYS),
    buffer_before_days: intIn(o.buffer_before_days, d.buffer_before_days, 0, 30),
    buffer_after_days: intIn(o.buffer_after_days, d.buffer_after_days, 0, 30),
    late_fee_mode: oneOf(o.late_fee_mode, RENTAL_LATE_FEE_MODES, d.late_fee_mode),
    late_fee_fixed: has('late_fee_fixed') ? Math.max(0, money(o.late_fee_fixed)) : d.late_fee_fixed,
    online_enabled: has('online_enabled') ? bool(o.online_enabled, d.online_enabled) : d.online_enabled,
    online_hold_hours: intIn(o.online_hold_hours, d.online_hold_hours, 1, 24 * 30),
    online_min_lead_days: intIn(o.online_min_lead_days, d.online_min_lead_days, 0, 365),
    online_max_days: intIn(o.online_max_days, d.online_max_days, 1, MAX_RENTAL_DAYS),
    online_notice: textOrNull(o.online_notice),
    terms_text: text(o.terms_text),
    receipt_footer: has('receipt_footer') ? textOrNull(o.receipt_footer) : d.receipt_footer,
    updated_at: textOrNull(o.updated_at),
    updated_by: textOrNull(o.updated_by),
    public_url_path: textOrNull(o.public_url_path) ?? PUBLIC_BOOK_PATH,
  }
}

// ---------------------------------------------------------------------------
// หมวดหมู่ (select ตาราง rental_categories)
// ---------------------------------------------------------------------------
export interface RentalCategory {
  id: string
  name: string
  sort_order: number
  is_active: boolean
  created_at: string
}

/** แถวหมวดหมู่ (ตาราง rental_categories หรือ {id,name} จาก rental_public_info) ; ไม่มี id → null */
export function parseRentalCategory(raw: unknown): RentalCategory | null {
  const o = asObj(raw)
  if (!o) return null
  const id = text(o.id)
  if (!id) return null
  return {
    id,
    name: text(o.name),
    sort_order: int(o.sort_order),
    is_active: bool(o.is_active, true),
    created_at: text(o.created_at),
  }
}

export function parseRentalCategories(raw: unknown): RentalCategory[] {
  return list(raw, parseRentalCategory)
}

// ---------------------------------------------------------------------------
// ชุด (แบบชุด + ชิ้นจริง): rental_save_item / rental_get_item  (rental_item_json)
// ---------------------------------------------------------------------------
export interface RentalItemImage {
  id: string
  path: string
  sort_order: number
  width: number | null
  height: number | null
}

export interface RentalUnit {
  id: string
  unit_code: string
  size: RentalSize
  status: RentalUnitStatus
  needs_cleaning: boolean
  condition_note: string | null
  has_history: boolean   // เคยถูกจอง → ลบไม่ได้ ใช้สถานะเลิกใช้แทน
  next_booking: { booking_no: string; pickup_date: string } | null
}

export interface RentalItemStats {
  bookings_total: number
  revenue_total: number
  days_rented_90d: number
}

export interface RentalItem {
  id: string
  code: string
  name: string
  category_id: string | null
  category_name: string | null
  description: string | null
  color: string | null
  base_price: number
  base_days: number
  extra_day_price: number
  security_deposit: number
  replacement_cost: number
  buffer_before_days: number | null   // null = ใช้ค่าจากตั้งค่าร้าน
  buffer_after_days: number | null
  is_accessory: boolean
  is_public: boolean
  is_active: boolean
  tags: string[]
  created_at: string
  updated_at: string                  // ใช้เป็นตัวล็อกเวอร์ชันตอนบันทึก (optimistic lock)
  already_saved: boolean              // rental_save_item ส่ง client_id ซ้ำ → true (บันทึกไปแล้วก่อนหน้า)
  images: RentalItemImage[]
  units: RentalUnit[]
  sizes: RentalSize[]                 // ไซส์ของชิ้นที่พร้อมให้เช่า (ไม่ซ้ำ เรียงตามไซส์)
  stats: RentalItemStats
}

/** รูป 1 รูป (ใน images ของชุด / ผลของ rental_add_item_image) ; ไม่มี path → null */
export function parseRentalItemImage(raw: unknown): RentalItemImage | null {
  const o = asObj(raw)
  if (!o) return null
  const path = text(o.path)
  if (!path) return null
  return {
    id: text(o.id),
    path,
    sort_order: int(o.sort_order),
    width: intOrNull(o.width),
    height: intOrNull(o.height),
  }
}

export function parseRentalUnit(raw: unknown): RentalUnit | null {
  const o = asObj(raw)
  if (!o) return null
  const id = text(o.id) || text(o.unit_id)
  if (!id) return null
  const nb = asObj(o.next_booking)
  return {
    id,
    unit_code: text(o.unit_code),
    size: sizeOf(o.size),
    status: oneOf(o.status, RENTAL_UNIT_STATUSES, 'available'),
    needs_cleaning: bool(o.needs_cleaning),
    condition_note: textOrNull(o.condition_note),
    has_history: bool(o.has_history),
    next_booking: nb && text(nb.booking_no) ? { booking_no: text(nb.booking_no), pickup_date: dayKey(nb.pickup_date) } : null,
  }
}

/** ชุด 1 แบบ (rental_item_json) ; ไม่ใช่ object หรือไม่มี id → null */
export function parseRentalItem(raw: unknown): RentalItem | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const id = text(o.id)
  if (!id) return null
  const st = asObj(o.stats) ?? {}
  const images = list(o.images, parseRentalItemImage).sort((a, b) => a.sort_order - b.sort_order)
  return {
    id,
    code: text(o.code),
    name: text(o.name),
    category_id: textOrNull(o.category_id),
    category_name: textOrNull(o.category_name),
    description: textOrNull(o.description),
    color: textOrNull(o.color),
    base_price: money(o.base_price),
    base_days: Math.max(1, int(o.base_days) || 1),
    extra_day_price: money(o.extra_day_price),
    security_deposit: money(o.security_deposit),
    replacement_cost: money(o.replacement_cost),
    buffer_before_days: intOrNull(o.buffer_before_days),
    buffer_after_days: intOrNull(o.buffer_after_days),
    is_accessory: bool(o.is_accessory),
    is_public: bool(o.is_public, true),
    is_active: bool(o.is_active, true),
    tags: textList(o.tags),
    created_at: text(o.created_at),
    updated_at: text(o.updated_at),
    already_saved: bool(o.already_saved),
    images,
    units: list(o.units, parseRentalUnit),
    sizes: sizeList(o.sizes),
    stats: {
      bookings_total: int(st.bookings_total),
      revenue_total: money(st.revenue_total),
      days_rented_90d: int(st.days_rented_90d),
    },
  }
}

/**
 * ผลของ rental_delete_item / rental_delete_item_image → path รูปที่ต้องลบออกจากถัง
 * รับได้หลายรูปแบบ: ['a','b'] / {paths:[...]} / {image_paths:[...]} / {path:'a'}
 */
export function parseDeletedImagePaths(raw: unknown): string[] {
  if (Array.isArray(raw)) return textList(raw)
  const o = asObjLoose(raw)
  if (!o) return []
  if (Array.isArray(o.paths)) return textList(o.paths)
  if (Array.isArray(o.image_paths)) return textList(o.image_paths)
  const one = textOrNull(o.path)
  return one ? [one] : []
}

/** การจองในอนาคตที่ชนกับชิ้นที่เพิ่งตั้งเป็นส่งซ่อม/เลิกใช้ (ผลของ rental_set_unit_status) */
export interface RentalUnitConflict {
  booking_id: string | null
  booking_no: string
  status: RentalBookingStatus
  customer_name: string | null
  pickup_date: string
  return_date: string
}

/** ผลของ rental_set_unit_status: {conflicts:[...]} หรือ array ตรงๆ ; อื่นๆ → [] */
export function parseUnitConflicts(raw: unknown): RentalUnitConflict[] {
  const o = asObjLoose(raw)
  const src = Array.isArray(raw) ? raw : o ? o.conflicts : null
  return list(src, (r): RentalUnitConflict | null => {
    const c = asObj(r)
    if (!c) return null
    const no = text(c.booking_no)
    if (!no) return null
    return {
      booking_id: textOrNull(c.booking_id),
      booking_no: no,
      status: oneOf(c.status, RENTAL_BOOKING_STATUSES, 'confirmed'),
      customer_name: textOrNull(c.customer_name),
      pickup_date: dayKey(c.pickup_date),
      return_date: dayKey(c.return_date),
    }
  })
}

// ---------------------------------------------------------------------------
// ลูกค้า: rental_save_customer / rental_get_customer (+ แถวตาราง rental_customers จากการค้นหา)
// ---------------------------------------------------------------------------
export interface RentalCustomerStats {
  bookings: number
  completed: number
  cancelled_no_show: number
  total_paid: number
  last_booking_at: string | null
}

export interface RentalCustomerBooking {
  id: string
  booking_no: string
  status: RentalBookingStatus
  pickup_date: string
  return_date: string
  grand_total: number
  due: number
}

export interface RentalCustomer {
  id: string
  name: string
  phone: string
  phone2: string | null
  line_id: string | null
  email: string | null
  id_card_no: string | null   // เลขเต็ม — แสดงแบบปิดด้วย maskIdCard ในรายการ
  address: string | null
  note: string | null
  is_blacklisted: boolean
  blacklist_reason: string | null
  source: RentalSource
  created_at: string
  updated_at: string
  stats: RentalCustomerStats  // แถวจากตาราง (ไม่มี stats) → ศูนย์ทั้งหมด
  bookings: RentalCustomerBooking[] // เฉพาะ rental_get_customer (ล่าสุด 50 รายการ) ; อื่นๆ = []
}

function parseCustomerBooking(raw: unknown): RentalCustomerBooking | null {
  const o = asObj(raw)
  if (!o) return null
  const id = text(o.id)
  if (!id) return null
  return {
    id,
    booking_no: text(o.booking_no),
    status: oneOf(o.status, RENTAL_BOOKING_STATUSES, 'pending'),
    pickup_date: dayKey(o.pickup_date),
    return_date: dayKey(o.return_date),
    grand_total: money(o.grand_total),
    due: money(o.due),
  }
}

/** ลูกค้า 1 คน ; ไม่มี id → null */
export function parseCustomer(raw: unknown): RentalCustomer | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const id = text(o.id)
  if (!id) return null
  const st = asObj(o.stats) ?? {}
  return {
    id,
    name: text(o.name),
    phone: text(o.phone),
    phone2: textOrNull(o.phone2),
    line_id: textOrNull(o.line_id),
    email: textOrNull(o.email),
    id_card_no: textOrNull(o.id_card_no),
    address: textOrNull(o.address),
    note: textOrNull(o.note),
    is_blacklisted: bool(o.is_blacklisted),
    blacklist_reason: textOrNull(o.blacklist_reason),
    source: oneOf(o.source, RENTAL_SOURCES, 'walkin'),
    created_at: text(o.created_at),
    updated_at: text(o.updated_at),
    stats: {
      bookings: int(st.bookings),
      completed: int(st.completed),
      cancelled_no_show: int(st.cancelled_no_show),
      total_paid: money(st.total_paid),
      last_booking_at: textOrNull(st.last_booking_at),
    },
    bookings: list(o.bookings, parseCustomerBooking),
  }
}

// ---------------------------------------------------------------------------
// ค้นหาชุดว่างตามช่วงวัน: rental_find_units
// ---------------------------------------------------------------------------
export interface FindUnitsFreeUnit {
  unit_id: string
  unit_code: string
  needs_cleaning: boolean
}

export interface FindUnitsSize {
  size: RentalSize
  free_units: FindUnitsFreeUnit[]
  total_units: number
}

export interface FindUnitsItem {
  item_id: string
  code: string
  name: string
  category_name: string | null
  is_accessory: boolean
  cover_path: string | null
  base_price: number
  base_days: number
  extra_day_price: number
  security_deposit: number
  rent_price: number        // ราคาเช่าสำหรับช่วงวันที่ค้นหา
  sizes: FindUnitsSize[]
}

export interface FindUnitsResult {
  days: number
  items: FindUnitsItem[]
}

function parseFreeUnit(raw: unknown): FindUnitsFreeUnit | null {
  const o = asObj(raw)
  if (!o) return null
  const id = text(o.unit_id) || text(o.id)
  if (!id) return null
  return { unit_id: id, unit_code: text(o.unit_code), needs_cleaning: bool(o.needs_cleaning) }
}

function parseFindSize(raw: unknown): FindUnitsSize | null {
  const o = asObj(raw)
  if (!o) return null
  const free = list(o.free_units, parseFreeUnit)
  return { size: sizeOf(o.size), free_units: free, total_units: Math.max(free.length, int(o.total_units)) }
}

function parseFindItem(raw: unknown): FindUnitsItem | null {
  const o = asObj(raw)
  if (!o) return null
  const id = text(o.item_id) || text(o.id)
  if (!id) return null
  return {
    item_id: id,
    code: text(o.code),
    name: text(o.name),
    category_name: textOrNull(o.category_name),
    is_accessory: bool(o.is_accessory),
    cover_path: textOrNull(o.cover_path),
    base_price: money(o.base_price),
    base_days: Math.max(1, int(o.base_days) || 1),
    extra_day_price: money(o.extra_day_price),
    security_deposit: money(o.security_deposit),
    rent_price: money(o.rent_price),
    sizes: list(o.sizes, parseFindSize),
  }
}

/** ผลค้นหาชุดว่าง — คืนค่าเสมอ */
export function parseFindUnits(raw: unknown): FindUnitsResult {
  const o = asObjLoose(raw)
  if (!o) return { days: 0, items: [] }
  return { days: Math.max(0, int(o.days)), items: list(o.items, parseFindItem) }
}

// ---------------------------------------------------------------------------
// ปฏิทินรายชุด (ชิ้น × วัน): rental_item_calendar
// ---------------------------------------------------------------------------
export interface CalendarBlock {
  booking_id: string
  booking_no: string
  status: RentalBookingStatus
  customer_name: string
  pickup_date: string
  return_date: string
  block_from: string   // day key (รวมวันนี้)
  block_to: string     // day key (รวมวันนี้)
  kind: RentalBlockKind
}

export interface ItemCalendarUnit {
  unit_id: string
  unit_code: string
  size: RentalSize
  status: RentalUnitStatus
  needs_cleaning: boolean
  blocks: CalendarBlock[]
}

export interface ItemCalendar {
  item: { id: string; code: string; name: string }
  from: string
  to: string
  units: ItemCalendarUnit[]
}

function parseCalendarBlock(raw: unknown): CalendarBlock | null {
  const o = asObj(raw)
  if (!o) return null
  const from = dayKey(o.block_from)
  const to = dayKey(o.block_to)
  if (!from || !to) return null
  return {
    booking_id: text(o.booking_id),
    booking_no: text(o.booking_no),
    status: oneOf(o.status, RENTAL_BOOKING_STATUSES, 'confirmed'),
    customer_name: text(o.customer_name),
    pickup_date: dayKey(o.pickup_date),
    return_date: dayKey(o.return_date),
    block_from: from,
    block_to: to,
    kind: oneOf(o.kind, ['rent', 'buffer'] as const, 'rent'),
  }
}

function parseCalendarUnit(raw: unknown): ItemCalendarUnit | null {
  const o = asObj(raw)
  if (!o) return null
  const id = text(o.unit_id) || text(o.id)
  if (!id) return null
  return {
    unit_id: id,
    unit_code: text(o.unit_code),
    size: sizeOf(o.size),
    status: oneOf(o.status, RENTAL_UNIT_STATUSES, 'available'),
    needs_cleaning: bool(o.needs_cleaning),
    blocks: list(o.blocks, parseCalendarBlock),
  }
}

/** ปฏิทินรายชุด — คืนค่าเสมอ (ไม่มีข้อมูล = ไม่มีชิ้น) */
export function parseItemCalendar(raw: unknown): ItemCalendar {
  const o = asObjLoose(raw) ?? {}
  const it = asObj(o.item) ?? {}
  return {
    item: { id: text(it.id), code: text(it.code), name: text(it.name) },
    from: dayKey(o.from),
    to: dayKey(o.to),
    units: list(o.units, parseCalendarUnit),
  }
}

// ---------------------------------------------------------------------------
// การจองแบบย่อ (ตารางงาน / วันนี้)
// ---------------------------------------------------------------------------
export interface RentalBookingMini {
  id: string
  booking_no: string
  status: RentalBookingStatus
  customer_name: string
  customer_phone: string | null
  pickup_date: string
  return_date: string
  fitting_date: string | null
  fitting_time: string | null
  pickup_time: string | null
  items_count: number
  item_names: string     // ชื่อชุด 3 รายการแรกต่อกัน
  due: number
  days_late: number      // เฉพาะรายการเกินกำหนดคืน (อื่นๆ = 0)
  expires_at: string | null // เฉพาะคำขอจองออนไลน์ที่รอยืนยัน
}

export function parseBookingMini(raw: unknown): RentalBookingMini | null {
  const o = asObj(raw)
  if (!o) return null
  const id = text(o.id) || text(o.booking_id)
  if (!id) return null
  return {
    id,
    booking_no: text(o.booking_no),
    status: oneOf(o.status, RENTAL_BOOKING_STATUSES, 'pending'),
    customer_name: text(o.customer_name),
    customer_phone: textOrNull(o.customer_phone),
    pickup_date: dayKey(o.pickup_date),
    return_date: dayKey(o.return_date),
    fitting_date: dayKeyOrNull(o.fitting_date),
    fitting_time: textOrNull(o.fitting_time),
    pickup_time: textOrNull(o.pickup_time),
    items_count: Math.max(0, int(o.items_count)),
    item_names: text(o.item_names),
    due: money(o.due),
    days_late: Math.max(0, int(o.days_late)),
    expires_at: textOrNull(o.expires_at),
  }
}

// ---------------------------------------------------------------------------
// ตารางงานรายวัน: rental_schedule
// ---------------------------------------------------------------------------
export interface RentalScheduleDay {
  day: string
  pickups: RentalBookingMini[]
  returns: RentalBookingMini[]
  fittings: RentalBookingMini[]
  overdue_returns: RentalBookingMini[]
}

export interface RentalSchedule {
  days: RentalScheduleDay[]
}

/** ตารางงาน — คืนค่าเสมอ (วันที่ไม่ถูกต้องถูกข้าม) */
export function parseSchedule(raw: unknown): RentalSchedule {
  const o = asObjLoose(raw) ?? {}
  return {
    days: list(o.days, (r): RentalScheduleDay | null => {
      const d = asObj(r)
      if (!d) return null
      const day = dayKey(d.day)
      if (!day) return null
      return {
        day,
        pickups: list(d.pickups, parseBookingMini),
        returns: list(d.returns, parseBookingMini),
        fittings: list(d.fittings, parseBookingMini),
        overdue_returns: list(d.overdue_returns, parseBookingMini),
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// ภาพรวมวันนี้: rental_today / ตัวเลขบนเมนู: rental_badges
// ---------------------------------------------------------------------------
export type RentalMethodTotals = Record<RentalCashMethod, number>

export interface RentalToday {
  day: string
  pickups: RentalBookingMini[]
  returns: RentalBookingMini[]
  overdue: RentalBookingMini[]          // มี days_late
  pending_online: RentalBookingMini[]   // มี expires_at
  slips_to_review: number
  fittings: RentalBookingMini[]
  units_need_cleaning: { unit_id: string; unit_code: string; item_name: string; size: RentalSize }[]
  maintenance_conflicts: { unit_code: string; item_name: string; booking_id: string | null; booking_no: string; pickup_date: string }[]
  /** การจองที่รอรับชุด แต่ชิ้นนั้นยังอยู่กับลูกค้าคนก่อนที่คืนช้า (out_* = การจองที่ยังไม่คืน) — ต้องตามชุดคืนหรือสลับชิ้น */
  overdue_conflicts: RentalOverdueConflict[]
  money_today: { cash_in: number; cash_out: number; by_method: RentalMethodTotals }
  security_held_total: number
  upcoming_7d: { pickups: number; returns: number }
}

export interface RentalOverdueConflict {
  unit_id: string
  unit_code: string
  item_name: string
  booking_id: string
  booking_no: string
  pickup_date: string
  out_booking_id: string
  out_booking_no: string
  out_return_date: string
}

function parseOverdueConflict(raw: unknown): RentalOverdueConflict | null {
  const c = asObj(raw)
  if (!c) return null
  const bookingId = text(c.booking_id)
  const unitId = text(c.unit_id)
  if (!bookingId || !unitId) return null
  return {
    unit_id: unitId,
    unit_code: text(c.unit_code),
    item_name: text(c.item_name),
    booking_id: bookingId,
    booking_no: text(c.booking_no),
    pickup_date: dayKey(c.pickup_date),
    out_booking_id: text(c.out_booking_id),
    out_booking_no: text(c.out_booking_no),
    out_return_date: dayKey(c.out_return_date),
  }
}

function parseMethodTotals(raw: unknown): RentalMethodTotals {
  const o = asObj(raw) ?? {}
  return { cash: money(o.cash), transfer: money(o.transfer), promptpay: money(o.promptpay), credit: money(o.credit) }
}

/** ภาพรวมวันนี้ — คืนค่าเสมอ */
export function parseToday(raw: unknown): RentalToday {
  const o = asObjLoose(raw) ?? {}
  const m = asObj(o.money_today) ?? {}
  const up = asObj(o.upcoming_7d) ?? {}
  return {
    day: dayKey(o.day),
    pickups: list(o.pickups, parseBookingMini),
    returns: list(o.returns, parseBookingMini),
    overdue: list(o.overdue, parseBookingMini),
    pending_online: list(o.pending_online, parseBookingMini),
    slips_to_review: Math.max(0, int(o.slips_to_review)),
    fittings: list(o.fittings, parseBookingMini),
    units_need_cleaning: list(o.units_need_cleaning, r => {
      const u = asObj(r)
      if (!u) return null
      const id = text(u.unit_id)
      if (!id) return null
      return { unit_id: id, unit_code: text(u.unit_code), item_name: text(u.item_name), size: sizeOf(u.size) }
    }),
    maintenance_conflicts: list(o.maintenance_conflicts, r => {
      const c = asObj(r)
      if (!c) return null
      return {
        unit_code: text(c.unit_code),
        item_name: text(c.item_name),
        booking_id: textOrNull(c.booking_id),
        booking_no: text(c.booking_no),
        pickup_date: dayKey(c.pickup_date),
      }
    }),
    overdue_conflicts: list(o.overdue_conflicts, parseOverdueConflict),
    money_today: { cash_in: money(m.cash_in), cash_out: money(m.cash_out), by_method: parseMethodTotals(m.by_method) },
    security_held_total: money(o.security_held_total),
    upcoming_7d: { pickups: Math.max(0, int(up.pickups)), returns: Math.max(0, int(up.returns)) },
  }
}

export interface RentalBadges {
  pending_online: number
  slips: number
  overdue: number
}

/** ตัวเลขบนเมนู (rental_badges) — อ่านไม่ได้ = 0 ทั้งหมด */
export function parseBadges(raw: unknown): RentalBadges {
  const o = asObjLoose(raw) ?? {}
  return {
    pending_online: Math.max(0, int(o.pending_online)),
    slips: Math.max(0, int(o.slips)),
    overdue: Math.max(0, int(o.overdue)),
  }
}

// ---------------------------------------------------------------------------
// การจองแบบเต็ม: rental_get_booking (และ booking ในผลของ create/update/action ทั้งหมด)
// ---------------------------------------------------------------------------
export interface RentalBookingCustomer {
  id: string
  name: string
  phone: string
  phone2: string | null
  line_id: string | null
  email: string | null
  id_card_no: string | null
  address: string | null
  is_blacklisted: boolean
  blacklist_reason: string | null
}

export interface RentalMoney {
  rent_total: number
  discount: number
  discount_note: string | null
  delivery_fee: number
  charges_total: number
  grand_total: number
  paid: number
  due: number                    // ติดลบ = รับเกิน ต้องคืนเงิน
  security_required: number
  security_override: number | null
  security_held: number
  deposit_required: number
  deposit_met: boolean
  pending_review_total: number   // ยอดสลิปที่ลูกค้าแจ้งโอน รอตรวจ (ยังไม่นับใน paid)
  /** นโยบายมัดจำที่จำไว้ตอนสร้างการจอง (% ของยอดรวม / ขั้นต่ำ) — null = ฐานข้อมูลรุ่นเก่าไม่ได้ส่งมา */
  deposit_percent: number | null
  min_deposit: number | null
}

export interface RentalBookingLine {
  id: string
  item_id: string
  item_code: string
  item_name: string
  is_accessory: boolean
  cover_path: string | null
  unit_id: string
  unit_code: string
  size: RentalSize
  rent_price: number
  base_price: number
  base_days: number
  extra_day_price: number
  deposit: number
  replacement_cost: number
  status: RentalLineStatus
  return_condition: RentalCondition | null
  return_note: string | null
  unit_status: RentalUnitStatus
  unit_needs_cleaning: boolean
}

export interface RentalCharge {
  id: string
  line_id: string | null
  kind: RentalChargeKind
  description: string
  amount: number
  voided_at: string | null
  void_reason: string | null
  created_by_name: string | null
  created_at: string
}

export interface RentalPayment {
  id: string
  receipt_no: string | null
  kind: RentalPaymentKind
  method: RentalPaymentMethod
  amount: number
  status: RentalPaymentStatus
  slip_path: string | null
  note: string | null
  reject_reason: string | null
  voided_at: string | null
  void_reason: string | null
  created_by_name: string | null
  created_at: string             // เวลาที่บันทึก/ลูกค้าแจ้งโอน
  reviewed_at: string | null
  /** วันเวลาที่เงินเข้า/ออกจริง (รับเงินที่ร้าน = ตอนบันทึก, สลิป = ตอนอนุมัติ) — null = ยังไม่ยืนยัน/ไม่อนุมัติ */
  confirmed_at: string | null
}

export interface RentalLog {
  action: string
  detail: Record<string, unknown> | null
  actor_name: string | null
  created_at: string
}

export interface RentalBookingActions {
  can_edit: boolean
  can_confirm: boolean
  can_cancel: boolean
  can_no_show: boolean
  can_pickup: boolean
  can_extend: boolean
  can_return: boolean
  can_complete: boolean
  can_pay: boolean
  can_refund: boolean
  // ปุ่มย่อยที่ fix-05 ส่งมาเพิ่ม — null = เซิร์ฟเวอร์ไม่ได้ส่ง (ให้หน้าจอคิดจากสถานะเอง)
  can_extend_hold: boolean | null
  can_security_in: boolean | null
  can_security_out: boolean | null
  can_security_apply: boolean | null
  can_add_charge: boolean | null
  /** เหตุผลที่ทำบางอย่างไม่ได้ (คีย์ = ชื่อการกระทำ เช่น 'complete' / 'pickup') เป็นข้อความไทยพร้อมแสดง */
  block_reasons: Record<string, string>
  /** ข้อควรระวังก่อนรับชุด (block_reasons.pickup_warnings แบบรายการ) — ว่าง = ไม่มี */
  pickup_warnings: string[]
  /** เหตุที่รับชุดไม่ได้เด็ดขาด แม้กดยืนยัน (เช่น ชิ้นยังอยู่กับลูกค้าคนก่อนที่คืนช้า) — ข้อความเหล่านี้อยู่ใน pickup_warnings ด้วย */
  pickup_blockers: string[]
}

export interface RentalBooking {
  id: string
  booking_no: string
  source: RentalSource
  status: RentalBookingStatus
  status_label: string
  public_token: string | null
  public_url_path: string | null   // '/book/status/<token>'
  customer: RentalBookingCustomer
  /** ชื่อที่ลูกค้าพิมพ์ตอนส่งคำขอออนไลน์ (อาจไม่ตรงกับชื่อลูกค้าในระบบที่ผูกด้วยเบอร์) — null = ไม่ใช่คำขอออนไลน์ */
  online_name: string | null
  pickup_date: string
  return_date: string
  days: number
  event_date: string | null
  fitting_date: string | null
  fitting_time: string | null
  pickup_time: string | null
  delivery_method: RentalDeliveryMethod
  delivery_address: string | null
  customer_note: string | null
  note: string | null
  cancel_reason: string | null
  expires_at: string | null
  id_checked: boolean
  money: RentalMoney
  lines: RentalBookingLine[]
  charges: RentalCharge[]
  payments: RentalPayment[]
  logs: RentalLog[]
  late: { late_days: number; suggested_late_fee: number }
  overdue: boolean
  actions: RentalBookingActions
  created_at: string
  created_by_name: string | null
  confirmed_at: string | null
  picked_up_at: string | null
  returned_at: string | null
  returned_on: string | null
  completed_at: string | null
  cancelled_at: string | null
  updated_at: string               // ตัวล็อกเวอร์ชันสำหรับ rental_update_booking
}

const NO_ACTIONS: RentalBookingActions = {
  can_edit: false, can_confirm: false, can_cancel: false, can_no_show: false, can_pickup: false,
  can_extend: false, can_return: false, can_complete: false, can_pay: false, can_refund: false,
  can_extend_hold: null, can_security_in: null, can_security_out: null, can_security_apply: null, can_add_charge: null,
  block_reasons: {}, pickup_warnings: [], pickup_blockers: [],
}

function parseMoney(raw: unknown): RentalMoney {
  const o = asObj(raw) ?? {}
  return {
    rent_total: money(o.rent_total),
    discount: money(o.discount),
    discount_note: textOrNull(o.discount_note),
    delivery_fee: money(o.delivery_fee),
    charges_total: money(o.charges_total),
    grand_total: money(o.grand_total),
    paid: money(o.paid),
    due: money(o.due),
    security_required: money(o.security_required),
    security_override: moneyOrNull(o.security_override),
    security_held: money(o.security_held),
    deposit_required: money(o.deposit_required),
    deposit_met: bool(o.deposit_met),
    pending_review_total: money(o.pending_review_total),
    deposit_percent: moneyOrNull(o.deposit_percent),
    min_deposit: moneyOrNull(o.min_deposit),
  }
}

function parseBookingCustomer(raw: unknown): RentalBookingCustomer {
  const o = asObj(raw) ?? {}
  return {
    id: text(o.id),
    name: text(o.name),
    phone: text(o.phone),
    phone2: textOrNull(o.phone2),
    line_id: textOrNull(o.line_id),
    email: textOrNull(o.email),
    id_card_no: textOrNull(o.id_card_no),
    address: textOrNull(o.address),
    is_blacklisted: bool(o.is_blacklisted),
    blacklist_reason: textOrNull(o.blacklist_reason),
  }
}

export function parseBookingLine(raw: unknown): RentalBookingLine | null {
  const o = asObj(raw)
  if (!o) return null
  const id = text(o.id)
  if (!id) return null
  const cond = textOrNull(o.return_condition)
  return {
    id,
    item_id: text(o.item_id),
    item_code: text(o.item_code),
    item_name: text(o.item_name),
    is_accessory: bool(o.is_accessory),
    cover_path: textOrNull(o.cover_path),
    unit_id: text(o.unit_id),
    unit_code: text(o.unit_code),
    size: sizeOf(o.size),
    rent_price: money(o.rent_price),
    base_price: money(o.base_price),
    base_days: Math.max(1, int(o.base_days) || 1),
    extra_day_price: money(o.extra_day_price),
    deposit: money(o.deposit),
    replacement_cost: money(o.replacement_cost),
    status: oneOf(o.status, RENTAL_LINE_STATUSES, 'booked'),
    return_condition: cond === null ? null : oneOf(cond, RENTAL_CONDITIONS, 'ok'),
    return_note: textOrNull(o.return_note),
    unit_status: oneOf(o.unit_status, RENTAL_UNIT_STATUSES, 'available'),
    unit_needs_cleaning: bool(o.unit_needs_cleaning),
  }
}

export function parseCharge(raw: unknown): RentalCharge | null {
  const o = asObj(raw)
  if (!o) return null
  const id = text(o.id)
  if (!id) return null
  return {
    id,
    line_id: textOrNull(o.line_id),
    kind: oneOf(o.kind, RENTAL_CHARGE_KINDS, 'other'),
    description: text(o.description),
    amount: money(o.amount),
    voided_at: textOrNull(o.voided_at),
    void_reason: textOrNull(o.void_reason),
    created_by_name: textOrNull(o.created_by_name),
    created_at: text(o.created_at),
  }
}

export function parsePayment(raw: unknown): RentalPayment | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const id = text(o.id)
  if (!id) return null
  return {
    id,
    receipt_no: textOrNull(o.receipt_no),
    kind: oneOf(o.kind, RENTAL_PAYMENT_KINDS, 'payment'),
    method: oneOf(o.method, RENTAL_PAYMENT_METHODS, 'cash'),
    amount: money(o.amount),
    status: oneOf(o.status, RENTAL_PAYMENT_STATUSES, 'confirmed'),
    slip_path: textOrNull(o.slip_path),
    note: textOrNull(o.note),
    reject_reason: textOrNull(o.reject_reason),
    voided_at: textOrNull(o.voided_at),
    void_reason: textOrNull(o.void_reason),
    created_by_name: textOrNull(o.created_by_name),
    created_at: text(o.created_at),
    reviewed_at: textOrNull(o.reviewed_at),
    confirmed_at: textOrNull(o.confirmed_at),
  }
}

/** วันเวลาที่ใช้ลงบัญชีของรายการเงิน: เงินที่ยืนยันแล้ว = confirmed_at (สลิป = วันอนุมัติ) / อื่นๆ = เวลาที่บันทึก */
export function paymentMoneyTime(p: Pick<RentalPayment, 'status' | 'created_at' | 'confirmed_at'>): string {
  return p.status === 'confirmed' && p.confirmed_at ? p.confirmed_at : p.created_at
}

function parseLog(raw: unknown): RentalLog | null {
  const o = asObj(raw)
  if (!o) return null
  return {
    action: text(o.action),
    detail: asObjLoose(o.detail),
    actor_name: textOrNull(o.actor_name),
    created_at: text(o.created_at),
  }
}

function parseActions(raw: unknown): RentalBookingActions {
  const o = asObj(raw)
  if (!o) return { ...NO_ACTIONS, block_reasons: {}, pickup_warnings: [], pickup_blockers: [] }
  const reasons: Record<string, string> = {}
  const br = asObj(o.block_reasons)
  const pickupWarnings = br && Array.isArray(br.pickup_warnings)
    ? textList(br.pickup_warnings).map(s => s.trim()).filter(Boolean)
    : []
  const pickupBlockers = br && Array.isArray(br.pickup_blockers)
    ? textList(br.pickup_blockers).map(s => s.trim()).filter(Boolean)
    : []
  if (br) {
    for (const key of Object.keys(br)) {
      const v = br[key]
      const s = Array.isArray(v) ? textList(v).join(' · ') : text(v)
      if (s.trim()) reasons[key] = s
    }
  }
  return {
    can_edit: bool(o.can_edit),
    can_confirm: bool(o.can_confirm),
    can_cancel: bool(o.can_cancel),
    can_no_show: bool(o.can_no_show),
    can_pickup: bool(o.can_pickup),
    can_extend: bool(o.can_extend),
    can_return: bool(o.can_return),
    can_complete: bool(o.can_complete),
    can_pay: bool(o.can_pay),
    can_refund: bool(o.can_refund),
    can_extend_hold: boolOrNull(o.can_extend_hold),
    can_security_in: boolOrNull(o.can_security_in),
    can_security_out: boolOrNull(o.can_security_out),
    can_security_apply: boolOrNull(o.can_security_apply),
    can_add_charge: boolOrNull(o.can_add_charge),
    block_reasons: reasons,
    pickup_warnings: pickupWarnings,
    pickup_blockers: pickupBlockers,
  }
}

/** การจองแบบเต็ม ; ไม่ใช่ object หรือไม่มี id → null */
export function parseRentalBooking(raw: unknown): RentalBooking | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const id = text(o.id)
  if (!id) return null
  const status = oneOf(o.status, RENTAL_BOOKING_STATUSES, 'pending')
  const pickup = dayKey(o.pickup_date)
  const ret = dayKey(o.return_date)
  const late = asObj(o.late) ?? {}
  const token = textOrNull(o.public_token)
  return {
    id,
    booking_no: text(o.booking_no),
    source: oneOf(o.source, RENTAL_SOURCES, 'walkin'),
    status,
    status_label: textOrNull(o.status_label) ?? STATUS_LABELS[status],
    public_token: token,
    public_url_path: textOrNull(o.public_url_path) ?? (token ? bookingStatusPath(token) : null),
    customer: parseBookingCustomer(o.customer),
    online_name: textOrNull(o.online_name),
    pickup_date: pickup,
    return_date: ret,
    days: o.days === undefined || o.days === null ? rentalDays(pickup, ret) : Math.max(0, int(o.days)),
    event_date: dayKeyOrNull(o.event_date),
    fitting_date: dayKeyOrNull(o.fitting_date),
    fitting_time: textOrNull(o.fitting_time),
    pickup_time: textOrNull(o.pickup_time),
    delivery_method: oneOf(o.delivery_method, RENTAL_DELIVERY_METHODS, 'pickup'),
    delivery_address: textOrNull(o.delivery_address),
    customer_note: textOrNull(o.customer_note),
    note: textOrNull(o.note),
    cancel_reason: textOrNull(o.cancel_reason),
    expires_at: textOrNull(o.expires_at),
    id_checked: bool(o.id_checked),
    money: parseMoney(o.money),
    lines: list(o.lines, parseBookingLine),
    charges: list(o.charges, parseCharge),
    payments: list(o.payments, parsePayment),
    logs: list(o.logs, parseLog),
    late: { late_days: Math.max(0, int(late.late_days)), suggested_late_fee: Math.max(0, money(late.suggested_late_fee)) },
    overdue: bool(o.overdue),
    actions: parseActions(o.actions),
    created_at: text(o.created_at),
    created_by_name: textOrNull(o.created_by_name),
    confirmed_at: textOrNull(o.confirmed_at),
    picked_up_at: textOrNull(o.picked_up_at),
    returned_at: textOrNull(o.returned_at),
    returned_on: dayKeyOrNull(o.returned_on),
    completed_at: textOrNull(o.completed_at),
    cancelled_at: textOrNull(o.cancelled_at),
    updated_at: text(o.updated_at),
  }
}

/**
 * ผลของ RPC ที่คืน "การจอง" — รับได้ทั้ง booking json ตรงๆ (rental_confirm_booking / rental_pickup / rental_review_slip ฯลฯ)
 * และแบบห่อ {booking: ...} ; อ่านไม่ได้ → null
 */
export function parseBookingResult(raw: unknown): RentalBooking | null {
  const o = asObjLoose(raw)
  if (!o) return null
  if (o.booking !== undefined) return parseRentalBooking(o.booking)
  return parseRentalBooking(o)
}

/**
 * rental_create_booking → {already_saved, payload_matches, booking} ; การจองอ่านไม่ได้ → null
 * payload_matches (เมื่อ already_saved): true = ข้อมูลชุดเดิมกับที่บันทึกไว้ / false = รหัสคำขอเดิมแต่ข้อมูลอื่น
 *   (ห้ามถือว่าเป็นการจองของฟอร์มนี้) / null = ฐานข้อมูลไม่รู้ (การจองเก่าก่อนมีลายนิ้วมือ) → ใช้การตรวจฝั่งหน้าจอ
 */
export function parseCreateBookingResult(raw: unknown): { already_saved: boolean; payload_matches: boolean | null; booking: RentalBooking } | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const booking = parseRentalBooking(o.booking ?? o)
  return booking ? { already_saved: bool(o.already_saved), payload_matches: boolOrNull(o.payload_matches), booking } : null
}

/** rental_review_slip → การจอง + review_warning (เช่น อนุมัติสลิปของการจองที่ยกเลิก/หมดเวลาแล้ว ต้องคืนเงินลูกค้า) */
export function parseReviewSlipResult(raw: unknown): { booking: RentalBooking; review_warning: string | null } | null {
  const booking = parseBookingResult(raw)
  if (!booking) return null
  const o = asObjLoose(raw)
  const w = o ? textOrNull(o.review_warning) : null
  return { booking, review_warning: w && w.trim() ? w.trim() : null }
}

/** rental_add_payment → {already_saved, payment, booking} ; อ่านไม่ได้ → null */
export function parseAddPaymentResult(raw: unknown): { already_saved: boolean; payment: RentalPayment | null; booking: RentalBooking } | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const booking = parseRentalBooking(o.booking)
  if (!booking) return null
  return { already_saved: bool(o.already_saved), payment: parsePayment(o.payment), booking }
}

// ---------------------------------------------------------------------------
// ใบเสนอราคา (ดูราคาก่อนจอง): rental_quote
// ---------------------------------------------------------------------------
export interface RentalQuoteLine {
  line_id: string | null   // ตอนแก้ไขการจอง = บรรทัดเดิม
  item_id: string
  item_code: string
  item_name: string
  unit_id: string | null
  unit_code: string | null // ชิ้นที่ระบบเลือกให้ (ไม่ว่าง = null)
  size: RentalSize
  rent_price: number
  deposit: number
  available: boolean
  conflict: string | null   // ข้อความไทยบอกว่าชนกับการจองไหน (ไม่ว่าง)
}

export interface RentalQuote {
  days: number
  pickup_date: string | null
  return_date: string | null
  lines: RentalQuoteLine[]
  all_available: boolean
  rent_total: number
  discount: number
  discount_ok: boolean     // ส่วนลดไม่เกินค่าเช่ารวม
  delivery_fee: number
  grand_total: number
  security_required: number
  deposit_required: number
}

/** ใบเสนอราคา — คืนค่าเสมอ */
export function parseQuote(raw: unknown): RentalQuote {
  const o = asObjLoose(raw) ?? {}
  return {
    days: Math.max(0, int(o.days)),
    pickup_date: dayKeyOrNull(o.pickup_date),
    return_date: dayKeyOrNull(o.return_date),
    lines: list(o.lines, (r): RentalQuoteLine | null => {
      const l = asObj(r)
      if (!l) return null
      return {
        line_id: textOrNull(l.line_id),
        item_id: text(l.item_id),
        item_code: text(l.item_code),
        item_name: text(l.item_name),
        unit_id: textOrNull(l.unit_id),
        unit_code: textOrNull(l.unit_code),
        size: sizeOf(l.size),
        rent_price: money(l.rent_price),
        deposit: money(l.deposit),
        available: bool(l.available),
        conflict: textOrNull(l.conflict),
      }
    }),
    all_available: o.all_available === undefined || o.all_available === null
      ? asArr(o.lines).every(r => bool(asObj(r)?.available))
      : bool(o.all_available),
    rent_total: money(o.rent_total),
    discount: money(o.discount),
    discount_ok: o.discount_ok === undefined || o.discount_ok === null
      ? money(o.discount) <= money(o.rent_total)
      : bool(o.discount_ok),
    delivery_fee: money(o.delivery_fee),
    grand_total: money(o.grand_total),
    security_required: money(o.security_required),
    deposit_required: money(o.deposit_required),
  }
}

// ---------------------------------------------------------------------------
// รายงาน: rental_report
// ---------------------------------------------------------------------------
export interface RentalReportDay {
  day: string
  payment: number
  refund: number
  net: number
}

export interface RentalReportItem {
  item_id: string
  code: string
  name: string
  bookings: number
  rent_revenue: number
  days_rented: number
  utilization_pct: number
  is_accessory: boolean
  units: number
}

export interface RentalReport {
  from: string | null
  to: string | null
  days: number
  income: {
    by_day: RentalReportDay[]
    by_method: RentalMethodTotals
    /** รายรับที่หักจากเงินประกัน (ไม่อยู่ใน by_method ของวิธีชำระ แต่รวมอยู่ใน total_net) */
    security_apply: number
    total_payment: number
    total_refund: number
    total_net: number
  }
  security: { received: number; returned: number; applied: number }
  charges: Record<RentalChargeKind, number>
  charges_total: number
  bookings: {
    created: number
    picked_up: number
    completed: number
    cancelled: number
    expired: number
    no_show: number
    by_source: Record<RentalSource, number>
  }
  items: RentalReportItem[]
  security_held_total: number
  overdue_count: number
  outstanding_due_total: number
  overpaid_total: number
}

/** รายงานร้านเช่า — คืนค่าเสมอ */
export function parseReport(raw: unknown): RentalReport {
  const o = asObjLoose(raw) ?? {}
  const inc = asObj(o.income) ?? {}
  const ch = asObj(o.charges) ?? {}
  const bk = asObj(o.bookings) ?? {}
  const src = asObj(bk.by_source) ?? {}
  const sec = asObj(o.security) ?? {}
  const byMethodRaw = asObj(inc.by_method) ?? {}
  const charges: Record<RentalChargeKind, number> = {
    late: money(ch.late),
    damage: money(ch.damage),
    lost: money(ch.lost),
    cleaning: money(ch.cleaning),
    delivery: money(ch.delivery),
    other: money(ch.other),
  }
  const byDay = list(inc.by_day, (r): RentalReportDay | null => {
    const d = asObj(r)
    if (!d) return null
    const day = dayKey(d.day)
    if (!day) return null
    return { day, payment: money(d.payment), refund: money(d.refund), net: money(d.net) }
  })
  return {
    from: dayKeyOrNull(o.from),
    to: dayKeyOrNull(o.to),
    days: Math.max(0, int(o.days)),
    income: {
      by_day: byDay,
      by_method: parseMethodTotals(inc.by_method),
      security_apply: money(byMethodRaw.security_apply),
      total_payment: inc.total_payment === undefined ? round2(byDay.reduce((s, d) => s + d.payment, 0)) : money(inc.total_payment),
      total_refund: inc.total_refund === undefined ? round2(byDay.reduce((s, d) => s + d.refund, 0)) : money(inc.total_refund),
      total_net: money(inc.total_net),
    },
    security: { received: money(sec.received), returned: money(sec.returned), applied: money(sec.applied) },
    charges,
    charges_total: ch.total === undefined
      ? round2(RENTAL_CHARGE_KINDS.reduce((s, k) => s + charges[k], 0))
      : money(ch.total),
    bookings: {
      created: Math.max(0, int(bk.created)),
      picked_up: Math.max(0, int(bk.picked_up)),
      completed: Math.max(0, int(bk.completed)),
      cancelled: Math.max(0, int(bk.cancelled)),
      expired: Math.max(0, int(bk.expired)),
      no_show: Math.max(0, int(bk.no_show)),
      by_source: {
        walkin: Math.max(0, int(src.walkin)),
        online: Math.max(0, int(src.online)),
        phone: Math.max(0, int(src.phone)),
        line: Math.max(0, int(src.line)),
        other: Math.max(0, int(src.other)),
      },
    },
    items: list(o.items, (r): RentalReportItem | null => {
      const it = asObj(r)
      if (!it) return null
      return {
        item_id: text(it.item_id),
        code: text(it.code),
        name: text(it.name),
        bookings: Math.max(0, int(it.bookings)),
        rent_revenue: money(it.rent_revenue),
        days_rented: Math.max(0, int(it.days_rented)),
        utilization_pct: Math.max(0, round2(num(it.utilization_pct))),
        is_accessory: bool(it.is_accessory),
        units: Math.max(0, int(it.units)),
      }
    }),
    security_held_total: money(o.security_held_total),
    overdue_count: Math.max(0, int(o.overdue_count)),
    outstanding_due_total: money(o.outstanding_due_total),
    overpaid_total: money(o.overpaid_total),
  }
}

// ---------------------------------------------------------------------------
// หน้าจองออนไลน์สาธารณะ (fix-06): rental_public_*
// ---------------------------------------------------------------------------
export interface PublicInfo {
  online_enabled: boolean
  shop_name: string
  tagline: string | null
  address: string | null
  phone: string | null
  line_id: string | null
  line_url: string | null
  facebook_url: string | null
  opening_hours: string | null
  online_notice: string | null
  terms_text: string
  booking_deposit_percent: number
  min_booking_deposit: number
  online_min_lead_days: number
  online_max_days: number
  online_hold_hours: number
  default_base_days: number
  categories: { id: string; name: string }[]
  /** วันนี้ (เวลาไทย) ตามฐานข้อมูล — null = ไม่ได้ส่งมา */
  today: string | null
}

/** ข้อมูลร้านสำหรับหน้าจองออนไลน์ — คืนค่าเสมอ (อ่านไม่ได้ = ปิดรับจองออนไลน์ ชื่อร้านเริ่มต้น) */
export function parsePublicInfo(raw: unknown): PublicInfo {
  const o = asObjLoose(raw)
  const d = DEFAULT_RENTAL_SETTINGS
  if (!o) {
    return {
      online_enabled: false, shop_name: d.shop_name, tagline: null, address: null, phone: null, line_id: null,
      line_url: null, facebook_url: null, opening_hours: null, online_notice: null, terms_text: '',
      booking_deposit_percent: d.booking_deposit_percent, min_booking_deposit: d.min_booking_deposit,
      online_min_lead_days: d.online_min_lead_days, online_max_days: d.online_max_days,
      online_hold_hours: d.online_hold_hours, default_base_days: d.default_base_days, categories: [], today: null,
    }
  }
  const s = parseRentalSettings(o)
  return {
    online_enabled: bool(o.online_enabled),
    shop_name: s.shop_name,
    tagline: s.tagline,
    address: s.address,
    phone: s.phone,
    line_id: s.line_id,
    line_url: s.line_url,
    facebook_url: s.facebook_url,
    opening_hours: s.opening_hours,
    online_notice: s.online_notice,
    terms_text: s.terms_text,
    booking_deposit_percent: s.booking_deposit_percent,
    min_booking_deposit: s.min_booking_deposit,
    online_min_lead_days: s.online_min_lead_days,
    online_max_days: s.online_max_days,
    online_hold_hours: s.online_hold_hours,
    default_base_days: s.default_base_days,
    categories: list(o.categories, r => {
      const c = asObj(r)
      if (!c) return null
      const id = text(c.id)
      return id ? { id, name: text(c.name) } : null
    }),
    today: dayKeyOrNull(o.today),
  }
}

export interface PublicCatalogItem {
  id: string
  code: string
  name: string
  category_name: string | null
  color: string | null
  base_price: number
  base_days: number
  extra_day_price: number
  security_deposit: number
  cover_path: string | null
  sizes: RentalSize[]
  is_accessory: boolean
  available: boolean | null   // null = ยังไม่ได้เลือกวัน
  rent_price: number | null   // null = ยังไม่ได้เลือกวัน
}

export interface PublicCatalog {
  items: PublicCatalogItem[]
  pickup_date: string | null
  return_date: string | null
  days: number | null         // null = ยังไม่ได้เลือกวัน
}

export function parsePublicCatalogItem(raw: unknown): PublicCatalogItem | null {
  const o = asObj(raw)
  if (!o) return null
  const id = text(o.id) || text(o.item_id)
  const code = text(o.code)
  if (!id && !code) return null
  return {
    id,
    code,
    name: text(o.name),
    category_name: textOrNull(o.category_name),
    color: textOrNull(o.color),
    base_price: money(o.base_price),
    base_days: Math.max(1, int(o.base_days) || 1),
    extra_day_price: money(o.extra_day_price),
    security_deposit: money(o.security_deposit),
    cover_path: textOrNull(o.cover_path),
    sizes: sizeList(o.sizes),
    is_accessory: bool(o.is_accessory),
    available: boolOrNull(o.available),
    rent_price: moneyOrNull(o.rent_price),
  }
}

/** แคตตาล็อกหน้าเว็บ — คืนค่าเสมอ */
export function parsePublicCatalog(raw: unknown): PublicCatalog {
  const o = asObjLoose(raw)
  const src = Array.isArray(raw) ? raw : o ? o.items : null
  return {
    items: list(src, parsePublicCatalogItem),
    pickup_date: o ? dayKeyOrNull(o.pickup_date) : null,
    return_date: o ? dayKeyOrNull(o.return_date) : null,
    days: o ? intOrNull(o.days) : null,
  }
}

export interface PublicItem {
  id: string
  code: string
  name: string
  category_name: string | null
  description: string | null
  color: string | null
  base_price: number
  base_days: number
  extra_day_price: number
  security_deposit: number
  images: { path: string; width: number | null; height: number | null }[]
  sizes: RentalSize[]
  is_accessory: boolean
  tags: string[]
  accessories: PublicCatalogItem[]
}

/** ชุด 1 แบบบนหน้าเว็บ ; ไม่มี id → null */
export function parsePublicItem(raw: unknown): PublicItem | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const id = text(o.id)
  if (!id) return null
  return {
    id,
    code: text(o.code),
    name: text(o.name),
    category_name: textOrNull(o.category_name),
    description: textOrNull(o.description),
    color: textOrNull(o.color),
    base_price: money(o.base_price),
    base_days: Math.max(1, int(o.base_days) || 1),
    extra_day_price: money(o.extra_day_price),
    security_deposit: money(o.security_deposit),
    images: list(o.images, r => {
      const im = asObj(r)
      if (!im) return null
      const path = text(im.path)
      return path ? { path, width: intOrNull(im.width), height: intOrNull(im.height) } : null
    }),
    sizes: sizeList(o.sizes),
    is_accessory: bool(o.is_accessory),
    tags: textList(o.tags),
    accessories: list(o.accessories, parsePublicCatalogItem),
  }
}

export interface PublicAvailabilityDay {
  day: string
  sizes: { size: RentalSize; free: number }[]
}

export interface PublicAvailability {
  item_id: string | null
  from: string | null
  to: string | null
  buffer_before_days: number
  buffer_after_days: number
  days: PublicAvailabilityDay[]
}

/** วันว่างของชุดรายไซส์ — คืนค่าเสมอ */
export function parsePublicAvailability(raw: unknown): PublicAvailability {
  const o = asObjLoose(raw) ?? {}
  return {
    item_id: textOrNull(o.item_id),
    from: dayKeyOrNull(o.from),
    to: dayKeyOrNull(o.to),
    buffer_before_days: Math.max(0, int(o.buffer_before_days)),
    buffer_after_days: Math.max(0, int(o.buffer_after_days)),
    days: list(o.days, (r): PublicAvailabilityDay | null => {
      const d = asObj(r)
      if (!d) return null
      const day = dayKey(d.day)
      if (!day) return null
      return {
        day,
        sizes: list(d.sizes, s => {
          const z = asObj(s)
          if (!z) return null
          return { size: sizeOf(z.size), free: Math.max(0, int(z.free)) }
        }),
      }
    }),
  }
}

export interface PublicRequestResult {
  already_saved: boolean
  booking_no: string
  token: string
  status: RentalBookingStatus
  expires_at: string | null
  deposit_required: number
  grand_total: number
  status_path: string        // '/book/status/<token>'
}

/** ผลการส่งคำขอจองออนไลน์ ; ไม่มีโทเคนที่ถูกรูปแบบ → null */
export function parsePublicRequestResult(raw: unknown): PublicRequestResult | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const token = text(o.token)
  if (!isBookingToken(token)) return null
  return {
    already_saved: bool(o.already_saved),
    booking_no: text(o.booking_no),
    token,
    status: oneOf(o.status, RENTAL_BOOKING_STATUSES, 'pending'),
    expires_at: textOrNull(o.expires_at),
    deposit_required: money(o.deposit_required),
    grand_total: money(o.grand_total),
    // ใช้ path ที่สร้างจากโทเคนที่ตรวจแล้วเสมอ (ไม่เชื่อ path จากภายนอกตรงๆ)
    status_path: bookingStatusPath(token),
  }
}

export interface PublicBookingLine {
  item_name: string
  item_code: string
  size: RentalSize
  rent_price: number
  deposit: number
  cover_path: string | null
}

export interface PublicBookingMoney {
  rent_total: number
  discount: number
  delivery_fee: number
  charges_total: number
  grand_total: number
  paid: number
  due: number
  deposit_required: number
  deposit_due: number         // มัดจำที่ยังต้องโอน (ไม่ต่ำกว่า 0)
  deposit_met: boolean
  security_required: number
  pending_review_total: number
}

export interface PublicBooking {
  booking_no: string
  status: RentalBookingStatus
  status_label: string
  shop_name: string
  customer_name_masked: string
  phone_masked: string
  pickup_date: string
  return_date: string
  days: number
  event_date: string | null
  lines: PublicBookingLine[]
  money: PublicBookingMoney
  payments: { created_at: string; amount: number; status: RentalPaymentStatus; kind: RentalPaymentKind; kind_label: string }[]
  expires_at: string | null
  payment_info: { promptpay_id: string | null; promptpay_name: string | null; bank_accounts: RentalBankAccount[] }
  slips_count: number
  slips_max: number
  can_upload_slip: boolean
  can_cancel: boolean
  contact: { phone: string | null; line_id: string | null; line_url: string | null }
  created_at: string | null
  confirmed_at: string | null
  picked_up_at: string | null
  returned_at: string | null
  completed_at: string | null
  cancelled_at: string | null
}

/** การจองสำหรับลูกค้าที่ถือโทเคน ; ไม่มีเลขที่การจอง → null */
export function parsePublicBooking(raw: unknown): PublicBooking | null {
  const o = asObjLoose(raw)
  if (!o) return null
  const no = text(o.booking_no)
  if (!no) return null
  const status = oneOf(o.status, RENTAL_BOOKING_STATUSES, 'pending')
  const m = asObj(o.money) ?? {}
  const pi = asObj(o.payment_info) ?? {}
  const ct = asObj(o.contact) ?? {}
  const pickup = dayKey(o.pickup_date)
  const ret = dayKey(o.return_date)
  return {
    booking_no: no,
    status,
    status_label: textOrNull(o.status_label) ?? STATUS_LABELS[status],
    shop_name: textOrNull(o.shop_name)?.trim() || DEFAULT_RENTAL_SHOP_NAME,
    customer_name_masked: text(o.customer_name_masked),
    phone_masked: text(o.phone_masked),
    pickup_date: pickup,
    return_date: ret,
    days: o.days === undefined || o.days === null ? rentalDays(pickup, ret) : Math.max(0, int(o.days)),
    event_date: dayKeyOrNull(o.event_date),
    lines: list(o.lines, (r): PublicBookingLine | null => {
      const l = asObj(r)
      if (!l) return null
      return {
        item_name: text(l.item_name),
        item_code: text(l.item_code),
        size: sizeOf(l.size),
        rent_price: money(l.rent_price),
        deposit: money(l.deposit),
        cover_path: textOrNull(l.cover_path),
      }
    }),
    money: {
      rent_total: money(m.rent_total),
      discount: money(m.discount),
      delivery_fee: money(m.delivery_fee),
      charges_total: money(m.charges_total),
      grand_total: money(m.grand_total),
      paid: money(m.paid),
      due: money(m.due),
      deposit_required: money(m.deposit_required),
      deposit_due: m.deposit_due === undefined || m.deposit_due === null
        ? Math.max(0, round2(money(m.deposit_required) - money(m.paid)))
        : Math.max(0, money(m.deposit_due)),
      deposit_met: bool(m.deposit_met),
      security_required: money(m.security_required),
      pending_review_total: money(m.pending_review_total),
    },
    payments: list(o.payments, r => {
      const p = asObj(r)
      if (!p) return null
      return {
        created_at: text(p.created_at),
        amount: money(p.amount),
        status: oneOf(p.status, RENTAL_PAYMENT_STATUSES, 'confirmed'),
        kind: oneOf(p.kind, RENTAL_PAYMENT_KINDS, 'payment'),
        kind_label: text(p.kind_label),
      }
    }),
    expires_at: textOrNull(o.expires_at),
    payment_info: {
      promptpay_id: textOrNull(pi.promptpay_id),
      promptpay_name: textOrNull(pi.promptpay_name),
      bank_accounts: list(pi.bank_accounts, parseBankAccount),
    },
    slips_count: Math.max(0, int(o.slips_count)),
    slips_max: Math.max(0, int(o.slips_max) || MAX_SLIPS_PER_BOOKING),
    can_upload_slip: bool(o.can_upload_slip),
    can_cancel: bool(o.can_cancel),
    contact: { phone: textOrNull(ct.phone), line_id: textOrNull(ct.line_id), line_url: textOrNull(ct.line_url) },
    created_at: textOrNull(o.created_at),
    confirmed_at: textOrNull(o.confirmed_at),
    picked_up_at: textOrNull(o.picked_up_at),
    returned_at: textOrNull(o.returned_at),
    completed_at: textOrNull(o.completed_at),
    cancelled_at: textOrNull(o.cancelled_at),
  }
}

// ---------------------------------------------------------------------------
// โหลดค่าที่ทุกหน้าของร้านเช่าใช้ (ใช้ได้ทั้ง server component และ client) — ไม่ throw
// ---------------------------------------------------------------------------
/** ชื่อร้านเช่าชุดจาก rental_settings.shop_name — อ่านไม่ได้ (ยังไม่รัน fix-05 / ไม่มีสิทธิ์ / เน็ตหลุด) → ชื่อเริ่มต้น */
export async function loadRentalShopName(supabase: ShopSupabase): Promise<string> {
  try {
    const { data, error } = await supabase.from('rental_settings').select('shop_name').limit(1).maybeSingle()
    if (error || !data) return DEFAULT_RENTAL_SHOP_NAME
    const name = textOrNull((data as Obj).shop_name)
    return name?.trim() || DEFAULT_RENTAL_SHOP_NAME
  } catch {
    return DEFAULT_RENTAL_SHOP_NAME
  }
}

/** ตัวเลขบนเมนูร้านเช่า (rental_badges) — อ่านไม่ได้ → null (ไม่แสดงตัวเลข) */
export async function loadRentalBadges(supabase: ShopSupabase): Promise<RentalBadges | null> {
  try {
    const { data, error } = await supabase.rpc('rental_badges')
    if (error) return null
    return parseBadges(data)
  } catch {
    return null
  }
}
