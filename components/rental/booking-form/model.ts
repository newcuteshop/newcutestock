// ===== ฟอร์มการจองร้านเช่าชุด (สร้างใหม่ / แก้ไข) — ชนิดข้อมูล + ตัวสร้าง payload + ตัวตรวจข้อมูลฝั่งหน้าจอ =====
// pure functions ล้วน (ไม่แตะ window/document) — ฐานข้อมูลตรวจซ้ำทุกข้อเสมอ หน้าจอตรวจไว้ก่อนเพื่อบอกผู้ใช้เร็วๆ
// ราคา/ยอดเงินทุกตัวที่แสดงมาจาก rental_quote (ฐานข้อมูลคำนวณ) — หน้าจอไม่คิดราคาเอง
import { parseMoneyInput } from '@/lib/money'
import { addDaysToKey, isDayKey } from '@/lib/format'
import {
  MAX_BOOKING_LINES, MAX_RENTAL_DAYS, MAX_RENTAL_MONEY, RENTAL_CASH_METHODS, RENTAL_SOURCES, phoneDigits, rentalDays,
  sizeKey, sizeLabel,
  type FindUnitsItem, type FindUnitsSize, type RentalBooking, type RentalCashMethod, type RentalCustomer,
  type RentalDeliveryMethod, type RentalQuote, type RentalSize, type RentalSource,
} from '@/lib/rental'

export type WizardStep = 1 | 2 | 3 | 4
export type WizardMode = 'create' | 'edit'

export const STEPS: readonly { n: WizardStep; label: string }[] = [
  { n: 1, label: 'วันรับ-คืนชุด' },
  { n: 2, label: 'เลือกชุด' },
  { n: 3, label: 'ลูกค้า' },
  { n: 4, label: 'สรุป / รับเงิน' },
]

// ช่องทางที่พนักงานเลือกได้ตอนสร้างการจอง ('online' มาจากหน้าจองออนไลน์เท่านั้น)
export const STAFF_SOURCES: readonly RentalSource[] = RENTAL_SOURCES.filter(s => s !== 'online')

export const MAX_NOTE = 1000
export const MAX_DISCOUNT_NOTE = 200
export const MAX_ADDRESS = 500
export const MAX_TIME_TEXT = 20
export const MAX_PAY_NOTE = 300
export const MAX_HOLD_HOURS = 168
// วันรับชุดย้อนหลังได้ไม่เกิน 30 วัน / ล่วงหน้าไม่เกิน 2 ปี (ตรงกับ rental_read_head)
export const MAX_BACKDATE_DAYS = 30
export const MAX_AHEAD_DAYS = 730

/** ชุด 1 รายการในตะกร้า (1 บรรทัด = 1 ชิ้นจริงตอนบันทึก) */
export interface CartLine {
  key: string                      // คีย์ในหน้าจอ (บรรทัดใหม่ = uuid, บรรทัดเดิม = line id)
  line_id: string | null           // แก้ไข: รหัสบรรทัดเดิม (ส่งกลับไปให้ฐานข้อมูลเก็บราคา/ชิ้นเดิมไว้)
  item_id: string
  item_code: string
  item_name: string
  is_accessory: boolean
  cover_path: string | null
  size: RentalSize                 // ไซส์ที่ต้องการ (null = ฟรีไซส์)
  unit_id: string | null           // ชิ้นที่พนักงานระบุเอง (null = ให้ระบบเลือกชิ้นที่ว่าง)
  unit_code: string | null
  /**
   * ไซส์ที่ลูกค้าขอไว้ก่อนพนักงานเลือกชิ้นเอง (เลือกชิ้นต่างไซส์ → size เปลี่ยนตามชิ้น)
   * กลับไป "ระบบเลือกชิ้นให้" → คืนไซส์นี้ (ไม่ให้ระบบไปหาชิ้นไซส์ของชิ้นที่เคยเลือกแทน) ; ไม่มีคีย์ = ยังไม่เคยเลือกชิ้นเอง
   */
  requested_size?: RentalSize
  current_unit_id: string | null   // แก้ไข: ชิ้นที่บรรทัดนี้ถืออยู่ตอนเปิดฟอร์ม (ระบบพยายามใช้ชิ้นเดิมก่อน)
  current_unit_code: string | null
  base_price: number               // ใช้แสดงเท่านั้น (ราคาจริงมาจาก rental_quote)
  base_days: number
  extra_day_price: number
  deposit: number
}

/** ลูกค้าที่เลือกจากในระบบ (ข้อมูลพอสำหรับแสดง/เตือนบัญชีดำ) */
export interface CustomerLite {
  id: string
  name: string
  phone: string
  phone2: string | null
  line_id: string | null
  id_card_no: string | null
  is_blacklisted: boolean
  blacklist_reason: string | null
}

/** ข้อมูลลูกค้าใหม่ที่กรอกในฟอร์ม (สตริงดิบ) */
export interface CustomerDraft {
  name: string
  phone: string
  line_id: string
  email: string
  id_card_no: string
  address: string
  note: string
}

export const EMPTY_CUSTOMER_DRAFT: Readonly<CustomerDraft> = {
  name: '', phone: '', line_id: '', email: '', id_card_no: '', address: '', note: '',
}

export type PayMode = 'none' | 'deposit' | 'full' | 'custom'

/** ข้อมูลทั้งฟอร์ม (สตริงดิบของช่องกรอก — แปลง/ตรวจตอนสร้าง payload) */
export interface WizardDraft {
  step: WizardStep
  pickup: string
  ret: string
  eventDate: string
  fittingDate: string
  fittingTime: string
  pickupTime: string
  lines: CartLine[]
  customerMode: 'existing' | 'new'
  customer: CustomerLite | null
  newCustomer: CustomerDraft
  source: RentalSource
  status: 'confirmed' | 'pending'
  holdHours: string
  deliveryMethod: RentalDeliveryMethod
  deliveryAddress: string
  deliveryFee: string
  discount: string
  discountNote: string
  securityOverrideOn: boolean
  securityOverride: string
  note: string
  // รับเงินพร้อมสร้างการจอง (สร้างใหม่เท่านั้น)
  payMode: PayMode
  payAmount: string
  payMethod: RentalCashMethod
  payNote: string
  secOn: boolean
  secAmount: string
  secMethod: RentalCashMethod
}

export function emptyDraft(holdHours: number): WizardDraft {
  return {
    step: 1,
    pickup: '',
    ret: '',
    eventDate: '',
    fittingDate: '',
    fittingTime: '',
    pickupTime: '',
    lines: [],
    customerMode: 'existing',
    customer: null,
    newCustomer: { ...EMPTY_CUSTOMER_DRAFT },
    source: 'walkin',
    status: 'confirmed',
    holdHours: String(holdHours),
    deliveryMethod: 'pickup',
    deliveryAddress: '',
    deliveryFee: '',
    discount: '',
    discountNote: '',
    securityOverrideOn: false,
    securityOverride: '',
    note: '',
    payMode: 'none',
    payAmount: '',
    payMethod: 'cash',
    payNote: '',
    secOn: false,
    secAmount: '',
    secMethod: 'cash',
  }
}

// ---------------------------------------------------------------------------
// แปลงข้อมูลเดิม → ฟอร์ม
// ---------------------------------------------------------------------------
export function customerLiteFromCustomer(c: RentalCustomer): CustomerLite {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    phone2: c.phone2,
    line_id: c.line_id,
    id_card_no: c.id_card_no,
    is_blacklisted: c.is_blacklisted,
    blacklist_reason: c.blacklist_reason,
  }
}

function moneyText(n: number): string {
  return n > 0 ? String(n) : ''
}

/** ฟอร์มแก้ไขจากการจองเดิม (บรรทัดเดิมเก็บรหัสบรรทัด + ชิ้นเดิม — ไม่บังคับชิ้น ให้ฐานข้อมูลใช้ชิ้นเดิมถ้ายังว่าง) */
export function draftFromBooking(b: RentalBooking, holdHours: number): WizardDraft {
  const d = emptyDraft(holdHours)
  return {
    ...d,
    step: 1,
    pickup: b.pickup_date,
    ret: b.return_date,
    eventDate: b.event_date ?? '',
    fittingDate: b.fitting_date ?? '',
    fittingTime: b.fitting_time ?? '',
    pickupTime: b.pickup_time ?? '',
    lines: b.lines.map(l => ({
      key: l.id,
      line_id: l.id,
      item_id: l.item_id,
      item_code: l.item_code,
      item_name: l.item_name,
      is_accessory: l.is_accessory,
      cover_path: l.cover_path,
      size: l.size,
      unit_id: null,
      unit_code: null,
      current_unit_id: l.unit_id || null,
      current_unit_code: l.unit_code || null,
      base_price: l.base_price,
      base_days: l.base_days,
      extra_day_price: l.extra_day_price,
      deposit: l.deposit,
    })),
    customerMode: 'existing',
    customer: {
      id: b.customer.id,
      name: b.customer.name,
      phone: b.customer.phone,
      phone2: b.customer.phone2,
      line_id: b.customer.line_id,
      id_card_no: b.customer.id_card_no,
      is_blacklisted: b.customer.is_blacklisted,
      blacklist_reason: b.customer.blacklist_reason,
    },
    source: b.source,
    status: b.status === 'pending' ? 'pending' : 'confirmed',
    deliveryMethod: b.delivery_method,
    deliveryAddress: b.delivery_address ?? '',
    deliveryFee: moneyText(b.money.delivery_fee),
    discount: moneyText(b.money.discount),
    discountNote: b.money.discount_note ?? '',
    securityOverrideOn: b.money.security_override !== null,
    securityOverride: b.money.security_override !== null ? String(b.money.security_override) : '',
    note: b.note ?? '',
  }
}

// ---------------------------------------------------------------------------
// ตรวจข้อมูล
// ---------------------------------------------------------------------------
export interface DatesCheck {
  ok: boolean
  days: number
  problem: string | null   // ข้อความไทยที่ต้องแก้ก่อนไปต่อ
  warnings: string[]       // แค่เตือน (ไปต่อได้)
}

/** ตรวจวันรับ-คืน (กติกาเดียวกับ rental_read_head) ; pickupChanged = false (แก้ไขแต่ไม่เปลี่ยนวันรับ) → ไม่ตรวจช่วงย้อนหลัง */
export function checkDates(d: Pick<WizardDraft, 'pickup' | 'ret' | 'eventDate' | 'fittingDate'>, today: string, pickupChanged = true): DatesCheck {
  const warnings: string[] = []
  if (!isDayKey(d.pickup)) return { ok: false, days: 0, problem: 'กรุณาเลือกวันรับชุด', warnings }
  if (!isDayKey(d.ret)) return { ok: false, days: 0, problem: 'กรุณาเลือกวันคืนชุด', warnings }
  if (d.ret < d.pickup) return { ok: false, days: 0, problem: 'วันคืนชุดต้องไม่ก่อนวันรับชุด', warnings }
  const days = rentalDays(d.pickup, d.ret)
  if (days > MAX_RENTAL_DAYS) {
    return { ok: false, days, problem: `เช่าได้ไม่เกิน ${MAX_RENTAL_DAYS} วันต่อการจอง (เลือกไว้ ${days} วัน)`, warnings }
  }
  if (pickupChanged && isDayKey(today)) {
    if (d.pickup < addDaysToKey(today, -MAX_BACKDATE_DAYS)) {
      return { ok: false, days, problem: `วันรับชุดย้อนหลังได้ไม่เกิน ${MAX_BACKDATE_DAYS} วัน`, warnings }
    }
    if (d.pickup > addDaysToKey(today, MAX_AHEAD_DAYS)) {
      return { ok: false, days, problem: 'จองล่วงหน้าได้ไม่เกิน 2 ปี', warnings }
    }
    if (d.pickup < today) warnings.push('วันรับชุดเป็นวันที่ผ่านมาแล้ว (ใช้บันทึกย้อนหลัง)')
  }
  if (d.eventDate && !isDayKey(d.eventDate)) return { ok: false, days, problem: 'วันงานไม่ถูกต้อง', warnings }
  if (d.fittingDate && !isDayKey(d.fittingDate)) return { ok: false, days, problem: 'วันลองชุดไม่ถูกต้อง', warnings }
  if (isDayKey(d.eventDate) && (d.eventDate < d.pickup || d.eventDate > d.ret)) {
    warnings.push('วันงานอยู่นอกช่วงวันเช่า — ตรวจสอบวันรับ-คืนอีกครั้ง')
  }
  if (isDayKey(d.fittingDate) && d.fittingDate > d.pickup) {
    warnings.push('วันลองชุดอยู่หลังวันรับชุด')
  }
  return { ok: true, days, problem: null, warnings }
}

export interface MoneyCheck {
  value: number          // ช่องว่าง = 0
  problem: string | null
}

/** อ่านช่องเงิน (ว่าง = 0) — ต้องไม่ติดลบ ไม่เกินเพดาน */
export function checkMoney(text: string, label: string): MoneyCheck {
  if (text.trim() === '') return { value: 0, problem: null }
  const n = parseMoneyInput(text)
  if (n === null) return { value: 0, problem: `${label}ไม่ถูกต้อง (ใส่เป็นตัวเลข)` }
  if (n < 0) return { value: 0, problem: `${label}ต้องไม่ติดลบ` }
  if (n > MAX_RENTAL_MONEY) return { value: 0, problem: `${label}มากเกินไป` }
  return { value: n, problem: null }
}

export interface CustomerCheck {
  ok: boolean
  errors: Partial<Record<keyof CustomerDraft, string>>
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** ตรวจลูกค้าใหม่ (กติกาเดียวกับ rental_customer_write) */
export function checkCustomerDraft(c: CustomerDraft): CustomerCheck {
  const errors: CustomerCheck['errors'] = {}
  const name = c.name.trim()
  if (!name) errors.name = 'กรุณากรอกชื่อลูกค้า'
  else if (name.length > 100) errors.name = 'ชื่อลูกค้ายาวเกินไป (สูงสุด 100 ตัวอักษร)'
  const phoneRaw = c.phone.trim()
  const digits = phoneDigits(phoneRaw)
  if (!phoneRaw) errors.phone = 'กรุณากรอกเบอร์โทรลูกค้า'
  else if (!/^[0-9๐-๙ ()+.-]+$/.test(phoneRaw)) errors.phone = 'เบอร์โทรใส่ได้เฉพาะตัวเลข'
  else if (digits.length < 9 || digits.length > 15) errors.phone = 'เบอร์โทรต้องเป็นตัวเลข 9-15 หลัก'
  if (c.line_id.trim().length > 50) errors.line_id = 'LINE ID ยาวเกินไป (สูงสุด 50 ตัวอักษร)'
  const email = c.email.trim()
  if (email && (email.length > 100 || !EMAIL_RE.test(email))) errors.email = 'อีเมลไม่ถูกต้อง'
  const idc = c.id_card_no.trim()
  if (idc) {
    if (!/^[A-Za-z0-9 -]+$/.test(idc)) errors.id_card_no = 'เลขบัตรประชาชน/พาสปอร์ตใส่ได้เฉพาะตัวอักษรอังกฤษและตัวเลข'
    else if (idc.replace(/[\s-]/g, '').length > 30) errors.id_card_no = 'เลขบัตรประชาชน/พาสปอร์ตยาวเกินไป'
  }
  if (c.address.trim().length > MAX_ADDRESS) errors.address = `ที่อยู่ยาวเกินไป (สูงสุด ${MAX_ADDRESS} ตัวอักษร)`
  if (c.note.trim().length > MAX_NOTE) errors.note = `หมายเหตุยาวเกินไป (สูงสุด ${MAX_NOTE} ตัวอักษร)`
  return { ok: Object.keys(errors).length === 0, errors }
}

/** ข้อมูลลูกค้าใหม่สำหรับส่งฐานข้อมูล (ช่องว่าง = null) */
export function customerPayload(c: CustomerDraft): Record<string, string | null> {
  const t = (s: string) => (s.trim() === '' ? null : s.trim())
  return {
    name: c.name.trim(),
    phone: phoneDigits(c.phone),
    line_id: t(c.line_id),
    email: t(c.email),
    id_card_no: t(c.id_card_no),
    address: t(c.address),
    note: t(c.note),
  }
}

// ---------------------------------------------------------------------------
// payload ที่ส่งฐานข้อมูล
// ---------------------------------------------------------------------------
/**
 * รายการชุดตามลำดับที่ส่ง: บรรทัดที่ระบุชิ้นเองมาก่อน แล้วค่อยบรรทัดที่ให้ระบบเลือกชิ้น
 * (ฐานข้อมูลเลือกชิ้นทีละบรรทัดตามลำดับ — ถ้าบรรทัด "อัตโนมัติ" มาก่อน อาจคว้าชิ้นที่บรรทัดหลังระบุไว้ไปก่อน แล้วบรรทัดหลังชน)
 */
export function orderedLines(lines: readonly CartLine[]): CartLine[] {
  return [...lines.filter(l => l.unit_id), ...lines.filter(l => !l.unit_id)]
}

export function linesPayload(lines: readonly CartLine[]): Record<string, unknown>[] {
  return orderedLines(lines).map(l => {
    const o: Record<string, unknown> = { item_id: l.item_id, size: l.size }
    if (l.line_id) o.line_id = l.line_id
    if (l.unit_id) o.unit_id = l.unit_id
    return o
  })
}

export interface HeadValues {
  ok: boolean
  problem: string | null
  payload: Record<string, unknown>
  discount: number
  deliveryFee: number
  securityOverride: number | null
}

/** หัวการจอง (วัน/การรับชุด/ส่วนลด/เงินประกันที่กำหนดเอง/หมายเหตุ) — ส่งทุกคีย์เสมอ (แก้ไข: ค่าว่าง = ล้างค่าเดิม) */
export function headPayload(d: WizardDraft): HeadValues {
  const disc = checkMoney(d.discount, 'ส่วนลด')
  const fee = d.deliveryMethod === 'delivery' ? checkMoney(d.deliveryFee, 'ค่าจัดส่ง') : { value: 0, problem: null }
  const sec = d.securityOverrideOn ? checkMoney(d.securityOverride, 'เงินประกันที่กำหนดเอง') : { value: 0, problem: null }
  const t = (s: string) => (s.trim() === '' ? null : s.trim())
  let problem = disc.problem ?? fee.problem ?? sec.problem
  if (!problem && d.securityOverrideOn && d.securityOverride.trim() === '') problem = 'กรุณาใส่จำนวนเงินประกันที่กำหนดเอง'
  if (!problem && d.deliveryMethod === 'delivery' && d.deliveryAddress.trim().length > MAX_ADDRESS) {
    problem = `ที่อยู่จัดส่งยาวเกินไป (สูงสุด ${MAX_ADDRESS} ตัวอักษร)`
  }
  if (!problem && d.discountNote.trim().length > MAX_DISCOUNT_NOTE) problem = `หมายเหตุส่วนลดยาวเกินไป (สูงสุด ${MAX_DISCOUNT_NOTE} ตัวอักษร)`
  if (!problem && d.note.trim().length > MAX_NOTE) problem = `หมายเหตุยาวเกินไป (สูงสุด ${MAX_NOTE} ตัวอักษร)`
  if (!problem && (d.pickupTime.trim().length > MAX_TIME_TEXT || d.fittingTime.trim().length > MAX_TIME_TEXT)) {
    problem = 'เวลาที่กรอกยาวเกินไป'
  }
  const securityOverride = d.securityOverrideOn ? sec.value : null
  return {
    ok: problem === null,
    problem,
    discount: disc.value,
    deliveryFee: fee.value,
    securityOverride,
    payload: {
      pickup_date: d.pickup,
      return_date: d.ret,
      event_date: isDayKey(d.eventDate) ? d.eventDate : null,
      fitting_date: isDayKey(d.fittingDate) ? d.fittingDate : null,
      fitting_time: isDayKey(d.fittingDate) ? t(d.fittingTime) : null,
      pickup_time: t(d.pickupTime),
      delivery_method: d.deliveryMethod,
      delivery_address: d.deliveryMethod === 'delivery' ? t(d.deliveryAddress) : null,
      delivery_fee: fee.value,
      discount: disc.value,
      discount_note: disc.value > 0 ? t(d.discountNote) : null,
      security_override: securityOverride,
      note: t(d.note),
    },
  }
}

/** จำนวนชั่วโมงถือคิว (สถานะรอยืนยัน) 1..168 ; ไม่ถูกต้อง → null */
export function holdHoursValue(text: string): number | null {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n >= 1 && n <= MAX_HOLD_HOURS ? n : null
}

/** รายการเงินที่จะส่งไปพร้อมการจอง (payload.payments) */
export interface PlannedPayment {
  kind: 'payment' | 'security_in'
  method: RentalCashMethod
  amount: number
  note: string | null
}

export interface PaymentPlan {
  ok: boolean
  problem: string | null
  rentAmount: number         // ชำระค่าเช่า/มัดจำตอนนี้ (0 = ไม่รับ)
  securityAmount: number     // รับเงินประกันตอนนี้ (0 = ไม่รับ)
  payments: PlannedPayment[]
}

/**
 * รับเงินพร้อมสร้างการจอง (มัดจำ/เต็มจำนวน + เงินประกัน) — ยอดอ้างอิงจาก rental_quote
 * ฐานข้อมูลตรวจซ้ำด้วยกฎเดียวกับการรับเงินปกติ (ชำระไม่เกินยอดค้าง / ประกันไม่เกินที่ต้องเก็บ / ประกันรับได้เมื่อยืนยันแล้ว)
 */
export function planPayments(
  d: WizardDraft,
  quote: { grand_total: number; deposit_required: number; security_required: number } | null,
): PaymentPlan {
  const none: PaymentPlan = { ok: true, problem: null, rentAmount: 0, securityAmount: 0, payments: [] }
  if (d.payMode === 'none' && !d.secOn) return none
  if (!quote) return { ...none, ok: false, problem: 'รอคำนวณยอดเงินสักครู่' }
  let problem: string | null = null
  let rent = 0
  if (d.payMode === 'deposit') rent = quote.deposit_required
  else if (d.payMode === 'full') rent = quote.grand_total
  else if (d.payMode === 'custom') {
    const m = checkMoney(d.payAmount, 'จำนวนเงินที่รับ')
    if (m.problem) problem = m.problem
    else if (d.payAmount.trim() === '' || m.value <= 0) problem = 'กรุณาใส่จำนวนเงินที่รับ'
    else rent = m.value
  }
  if (!problem && d.payMode !== 'none') {
    if (rent <= 0) problem = d.payMode === 'deposit' ? 'การจองนี้ไม่ต้องเก็บมัดจำ — เลือก "ยังไม่รับ" หรือระบุจำนวนเอง' : 'ยอดที่ต้องชำระเป็น ฿0'
    else if (rent > quote.grand_total + 0.005) problem = 'รับเงินค่าเช่าเกินยอดรวมของการจอง'
  }
  if (!problem && d.payNote.trim().length > MAX_PAY_NOTE) problem = `หมายเหตุการรับเงินยาวเกินไป (สูงสุด ${MAX_PAY_NOTE} ตัวอักษร)`
  let sec = 0
  if (!problem && d.secOn) {
    if (d.status === 'pending') problem = 'รับเงินประกันได้เมื่อยืนยันการจองแล้ว — เปลี่ยนเป็น "ยืนยันการจองเลย" หรือปิดการรับเงินประกัน'
    else if (quote.security_required <= 0) problem = 'การจองนี้ไม่มีเงินประกันที่ต้องเก็บ'
    else if (d.secAmount.trim() === '') sec = quote.security_required
    else {
      const m = checkMoney(d.secAmount, 'เงินประกัน')
      if (m.problem) problem = m.problem
      else if (m.value <= 0) problem = 'กรุณาใส่จำนวนเงินประกันที่รับ'
      else if (m.value > quote.security_required + 0.005) problem = 'รับเงินประกันเกินยอดที่ต้องเก็บ'
      else sec = m.value
    }
  }
  if (problem) return { ...none, ok: false, problem }
  const payments: PlannedPayment[] = []
  if (rent > 0) {
    payments.push({ kind: 'payment', method: d.payMethod, amount: rent, note: d.payNote.trim() || null })
  }
  if (sec > 0) payments.push({ kind: 'security_in', method: d.secMethod, amount: sec, note: null })
  return { ok: true, problem: null, rentAmount: rent, securityAmount: sec, payments }
}

/** ราคา/สถานะของบรรทัดจาก rental_quote (ฐานข้อมูลคำนวณ) */
export interface LineQuote {
  rent_price: number
  deposit: number
  available: boolean
  conflict: string | null
  unit_code: string | null   // ชิ้นที่ระบบเลือกให้ (ถ้าส่งมา)
}

/**
 * ผล rental_quote ต่อบรรทัดในตะกร้า — quote.lines เรียงตามลำดับที่ส่ง (keys = คีย์บรรทัดตาม orderedLines ตอนถาม)
 * บรรทัดฟรีไซส์ (size = null) ที่ชิ้นเดิมไม่ว่างแล้ว: ฐานข้อมูลถือว่าไซส์ว่าง = "ไซส์ไหนก็ได้" → อาจได้ชิ้นไซส์อื่นมาแทนเงียบๆ
 * → ถือว่าไม่ว่าง ให้พนักงานเลือกชิ้นเอง (ลูกค้าต้องได้ไซส์ที่ตกลงไว้)
 */
export function mapLineQuotes(
  quote: RentalQuote | null,
  keys: readonly string[],
  lines: readonly CartLine[],
): Map<string, LineQuote> {
  const m = new Map<string, LineQuote>()
  if (!quote) return m
  const sizes = new Map(lines.map(l => [l.key, l.size]))
  keys.forEach((key, i) => {
    const l = quote.lines[i]
    if (!l) return
    const wrongSize = l.available && sizes.get(key) === null && l.size !== null
    m.set(key, {
      rent_price: l.rent_price,
      deposit: l.deposit,
      available: l.available && !wrongSize,
      conflict: wrongSize
        ? `ชิ้นฟรีไซส์ไม่ว่างในช่วงวันที่นี้ (ระบบจะได้ชิ้นไซส์ ${sizeLabel(l.size)} แทน) — เลือกชิ้นเองหรือเอาออก`
        : l.conflict,
      unit_code: wrongSize ? null : l.unit_code,
    })
  })
  return m
}

export function isCashMethod(v: unknown): v is RentalCashMethod {
  return typeof v === 'string' && (RENTAL_CASH_METHODS as readonly string[]).includes(v)
}

/** จำนวนรายการในตะกร้าของชุด+ไซส์นี้ (ใช้หักออกจากจำนวนชิ้นที่ว่าง) */
export function countInCart(lines: readonly CartLine[], itemId: string, size: RentalSize): number {
  const k = sizeKey(size)
  let n = 0
  for (const l of lines) if (l.item_id === itemId && sizeKey(l.size) === k) n++
  return n
}

/** ชิ้นที่บรรทัดอื่นในตะกร้าถืออยู่ (ระบุเอง หรือชิ้นเดิมของบรรทัดที่ยังไม่ได้เปลี่ยน) — ห้ามเลือกซ้ำ */
export function unitsHeldByOthers(lines: readonly CartLine[], exceptKey: string): Set<string> {
  const s = new Set<string>()
  for (const l of lines) {
    if (l.key === exceptKey) continue
    if (l.unit_id) s.add(l.unit_id)
    else if (l.current_unit_id) s.add(l.current_unit_id)
  }
  return s
}

/**
 * บรรทัดใหม่จากปุ่มไซส์ในขั้นเลือกชุด ; เพิ่มไม่ได้ (ตะกร้าเต็ม / ไซส์นี้ไม่เหลือชิ้นว่าง) → null
 * ฟรีไซส์ในชุดที่มีหลายไซส์: ถ้าส่งไซส์ว่างไป ฐานข้อมูลถือว่า "ไซส์ไหนก็ได้" → ระบุชิ้นฟรีไซส์ให้เลย กันระบบเลือกผิดไซส์
 */
export function newCartLine(lines: readonly CartLine[], item: FindUnitsItem, s: FindUnitsSize, key: string): CartLine | null {
  if (lines.length >= MAX_BOOKING_LINES) return null
  if (countInCart(lines, item.item_id, s.size) >= s.free_units.length) return null
  let unitId: string | null = null
  let unitCode: string | null = null
  if (s.size === null && item.sizes.some(z => z.size !== null)) {
    const held = unitsHeldByOthers(lines, '')
    const u = s.free_units.find(x => !held.has(x.unit_id))
    if (!u) return null
    unitId = u.unit_id
    unitCode = u.unit_code
  }
  return {
    key,
    line_id: null,
    item_id: item.item_id,
    item_code: item.code,
    item_name: item.name,
    is_accessory: item.is_accessory,
    cover_path: item.cover_path,
    size: s.size,
    unit_id: unitId,
    unit_code: unitCode,
    current_unit_id: null,
    current_unit_code: null,
    base_price: item.base_price,
    base_days: item.base_days,
    extra_day_price: item.extra_day_price,
    deposit: item.security_deposit,
  }
}

// ---------------------------------------------------------------------------
// เก็บฟอร์มที่กรอกค้าง + รหัสคำขอ (client_id) ไว้ใน sessionStorage (เฉพาะแท็บนี้ ปิดแท็บแล้วหาย)
// ---------------------------------------------------------------------------
export const DRAFT_STORAGE_KEY = 'rental-booking-draft-v1'
// ฟอร์มค้างเก่ากว่านี้ไม่กู้คืน (แต่รหัสคำขอที่ยังไม่รู้ผลยังต้องตรวจเสมอ)
export const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000

export interface StoredDraft {
  v: 1
  cid: string
  /** กดบันทึกไปแล้วแต่ยังไม่รู้ผล (ตั้งก่อนส่ง ล้างเมื่อรู้ผลแน่นอน) → เปิดหน้าใหม่ต้องตรวจก่อนว่าบันทึกไปหรือยัง */
  inflight: boolean
  /**
   * ลายเซ็นของข้อมูลที่ส่งไปแล้วด้วยรหัสคำขอนี้ (กดซ้ำตอนไม่รู้ผล = ลายเซ็นเดิม)
   * ใช้แยก "กดซ้ำฟอร์มเดิม" (พบการจองรหัสนี้ = ของฟอร์มนี้ ไปหน้านั้นได้) กับ "ฟอร์มถูกเปลี่ยนหลังส่ง"
   * (พบ = อาจเป็นการจองของข้อมูลชุดก่อน ห้ามถือว่าฟอร์มนี้บันทึกแล้ว)
   */
  sigs: string[]
  savedAt: number
  draft: WizardDraft | null
}

export const MAX_SENT_SIGS = 5

/** ลายเซ็นสั้นของข้อมูลที่ส่งบันทึก (FNV-1a 2 ชุด + ความยาว) — ข้อมูลเดิมได้ค่าเดิมเสมอ (ลำดับคีย์มาจากโค้ดชุดเดียวกัน) */
export function payloadSig(payload: unknown): string {
  const s = JSON.stringify(payload) ?? ''
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x050c5d1f) >>> 0
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}:${s.length}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

type Obj = Record<string, unknown>
const asObj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null)
const str = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.slice(0, max) : '')
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const numOr = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

function readLine(raw: unknown): CartLine | null {
  const o = asObj(raw)
  if (!o) return null
  const key = str(o.key, 64)
  const itemId = str(o.item_id, 64)
  if (!key || !isUuid(itemId)) return null
  const unitId = strOrNull(o.unit_id)
  const lineId = strOrNull(o.line_id)
  const curUnit = strOrNull(o.current_unit_id)
  return {
    ...('requested_size' in o ? { requested_size: strOrNull(o.requested_size) } : {}),
    key,
    line_id: lineId && isUuid(lineId) ? lineId : null,
    item_id: itemId,
    item_code: str(o.item_code, 60),
    item_name: str(o.item_name, 200),
    is_accessory: o.is_accessory === true,
    cover_path: strOrNull(o.cover_path),
    size: strOrNull(o.size),
    unit_id: unitId && isUuid(unitId) ? unitId : null,
    unit_code: strOrNull(o.unit_code),
    current_unit_id: curUnit && isUuid(curUnit) ? curUnit : null,
    current_unit_code: strOrNull(o.current_unit_code),
    base_price: numOr(o.base_price, 0),
    base_days: numOr(o.base_days, 1),
    extra_day_price: numOr(o.extra_day_price, 0),
    deposit: numOr(o.deposit, 0),
  }
}

function readCustomer(raw: unknown): CustomerLite | null {
  const o = asObj(raw)
  if (!o || !isUuid(o.id)) return null
  return {
    id: o.id as string,
    name: str(o.name, 200),
    phone: str(o.phone, 40),
    phone2: strOrNull(o.phone2),
    line_id: strOrNull(o.line_id),
    id_card_no: strOrNull(o.id_card_no),
    is_blacklisted: o.is_blacklisted === true,
    blacklist_reason: strOrNull(o.blacklist_reason),
  }
}

/** ฟอร์มที่เก็บไว้ (ตรวจทุกช่อง — ค่าแปลก = ค่าเริ่มต้น) ; อ่านไม่ได้ → null */
export function readStoredDraftValue(raw: unknown, holdHours: number): WizardDraft | null {
  const o = asObj(raw)
  if (!o) return null
  const base = emptyDraft(holdHours)
  const step = o.step === 1 || o.step === 2 || o.step === 3 || o.step === 4 ? o.step : 1
  const nc = asObj(o.newCustomer) ?? {}
  const lines: CartLine[] = []
  if (Array.isArray(o.lines)) {
    for (const r of o.lines.slice(0, 30)) {
      const l = readLine(r)
      if (l) lines.push(l)
    }
  }
  const day = (v: unknown) => (isDayKey(v) ? v : '')
  return {
    ...base,
    step,
    pickup: day(o.pickup),
    ret: day(o.ret),
    eventDate: day(o.eventDate),
    fittingDate: day(o.fittingDate),
    fittingTime: str(o.fittingTime, MAX_TIME_TEXT),
    pickupTime: str(o.pickupTime, MAX_TIME_TEXT),
    lines,
    customerMode: o.customerMode === 'new' ? 'new' : 'existing',
    customer: readCustomer(o.customer),
    newCustomer: {
      name: str(nc.name, 200),
      phone: str(nc.phone, 40),
      line_id: str(nc.line_id, 100),
      email: str(nc.email, 200),
      id_card_no: str(nc.id_card_no, 60),
      address: str(nc.address, MAX_ADDRESS + 100),
      note: str(nc.note, MAX_NOTE + 100),
    },
    source: STAFF_SOURCES.includes(o.source as RentalSource) ? (o.source as RentalSource) : 'walkin',
    status: o.status === 'pending' ? 'pending' : 'confirmed',
    holdHours: str(o.holdHours, 6) || base.holdHours,
    deliveryMethod: o.deliveryMethod === 'delivery' ? 'delivery' : 'pickup',
    deliveryAddress: str(o.deliveryAddress, MAX_ADDRESS + 100),
    deliveryFee: str(o.deliveryFee, 30),
    discount: str(o.discount, 30),
    discountNote: str(o.discountNote, MAX_DISCOUNT_NOTE + 50),
    securityOverrideOn: o.securityOverrideOn === true,
    securityOverride: str(o.securityOverride, 30),
    note: str(o.note, MAX_NOTE + 100),
    payMode: o.payMode === 'deposit' || o.payMode === 'full' || o.payMode === 'custom' ? o.payMode : 'none',
    payAmount: str(o.payAmount, 30),
    payMethod: isCashMethod(o.payMethod) ? o.payMethod : 'cash',
    payNote: str(o.payNote, MAX_PAY_NOTE + 50),
    secOn: o.secOn === true,
    secAmount: str(o.secAmount, 30),
    secMethod: isCashMethod(o.secMethod) ? o.secMethod : 'cash',
  }
}

/** อ่านที่เก็บไว้ (JSON สตริง) ; อ่านไม่ได้/รูปแบบผิด → null */
export function parseStoredDraft(json: string | null, holdHours: number): StoredDraft | null {
  if (!json) return null
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  const o = asObj(raw)
  if (!o || o.v !== 1 || !isUuid(o.cid)) return null
  return {
    v: 1,
    cid: (o.cid as string).toLowerCase(),
    inflight: o.inflight === true,
    sigs: Array.isArray(o.sigs)
      ? (o.sigs as unknown[]).filter((x): x is string => typeof x === 'string' && x.length <= 40).slice(-MAX_SENT_SIGS)
      : [],
    savedAt: numOr(o.savedAt, 0),
    draft: o.draft ? readStoredDraftValue(o.draft, holdHours) : null,
  }
}

/** ฟอร์มนี้มีอะไรที่ผู้ใช้กรอกไว้แล้วหรือยัง (ไม่มี = ไม่ต้องกู้คืน/ไม่ต้องเตือน) */
export function draftHasContent(d: WizardDraft): boolean {
  return d.pickup !== '' || d.lines.length > 0 || d.customer !== null || d.newCustomer.name.trim() !== '' ||
    d.newCustomer.phone.trim() !== ''
}

// ---------------------------------------------------------------------------
// เลือกชิ้นเอง / กลับไปให้ระบบเลือก — จำไซส์ที่ลูกค้าขอไว้
// ---------------------------------------------------------------------------
export function chooseUnit(
  line: CartLine,
  u: { unit_id: string; unit_code: string; size: RentalSize } | null,
): CartLine {
  const wanted = line.requested_size !== undefined ? line.requested_size : line.size
  if (!u) {
    // กลับไปให้ระบบเลือก → ใช้ไซส์ที่ขอไว้เดิม (ไม่ใช่ไซส์ของชิ้นที่เพิ่งเลือก)
    const { requested_size: _drop, ...rest } = line
    void _drop
    return { ...rest, unit_id: null, unit_code: null, size: wanted }
  }
  return { ...line, unit_id: u.unit_id, unit_code: u.unit_code, size: u.size, requested_size: wanted }
}

// ---------------------------------------------------------------------------
// แก้ไขแล้วไม่รู้ผล: การจองล่าสุดตรงกับข้อมูลที่ส่งไปหรือไม่ (ตรง = การบันทึกของเราเองผ่านแล้ว ไม่ใช่เครื่องอื่นแก้)
// ---------------------------------------------------------------------------
const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null)
const sameMoney = (a: unknown, b: unknown) =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.005 : same(a, b)

export function bookingMatchesEdit(latest: RentalBooking, payload: Record<string, unknown>): boolean {
  if (!same(latest.pickup_date, payload.pickup_date) || !same(latest.return_date, payload.return_date)) return false
  if (!same(latest.event_date, payload.event_date) || !same(latest.fitting_date, payload.fitting_date)) return false
  if (!same(latest.fitting_time, payload.fitting_time) || !same(latest.pickup_time, payload.pickup_time)) return false
  if (!same(latest.delivery_method, payload.delivery_method) || !same(latest.delivery_address, payload.delivery_address)) return false
  if (!same(latest.note, payload.note)) return false
  const m = latest.money
  if (!sameMoney(m.discount, payload.discount) || !sameMoney(m.delivery_fee, payload.delivery_fee)) return false
  if (!sameMoney(m.security_override, payload.security_override)) return false
  // หมายเหตุส่วนลด: ส่งมาเฉพาะตอนมีส่วนลด (ไม่มีส่วนลด = null)
  if ('discount_note' in payload && !same(m.discount_note, payload.discount_note)) return false
  if (typeof payload.customer_id === 'string') {
    if (latest.customer.id !== payload.customer_id) return false
  } else {
    const c = payload.customer && typeof payload.customer === 'object' ? (payload.customer as Record<string, unknown>) : null
    if (!c || phoneDigits(latest.customer.phone) !== c.phone) return false
    if (typeof c.name === 'string' && latest.customer.name.trim() !== c.name.trim()) return false
  }
  const lines = Array.isArray(payload.lines) ? (payload.lines as Record<string, unknown>[]) : []
  if (lines.length !== latest.lines.length) return false
  const left = [...latest.lines]
  // บรรทัดเดิม (มี line_id) ต้องอยู่ครบ ; บรรทัดใหม่จับคู่ด้วยชุด + ชิ้น/ไซส์
  const ordered = [...lines.filter(l => typeof l.line_id === 'string'), ...lines.filter(l => typeof l.line_id !== 'string')]
  for (const l of ordered) {
    // ชิ้น (ถ้าระบุ) และไซส์ (ถ้าระบุ) ต้องตรงทั้งบรรทัดเดิมและบรรทัดใหม่ — แก้แค่ชิ้น/ไซส์ของบรรทัดเดิมก็ต้องเห็นว่าไม่ตรง
    const unitSizeOk = (x: (typeof left)[number]) => {
      if (typeof l.unit_id === 'string' && x.unit_id !== l.unit_id) return false
      return l.size === null || l.size === undefined || sizeKey(x.size) === sizeKey(l.size as RentalSize)
    }
    const i = left.findIndex(x => {
      if (typeof l.line_id === 'string') return x.id === l.line_id && x.item_id === l.item_id && unitSizeOk(x)
      if (x.item_id !== l.item_id) return false
      return unitSizeOk(x)
    })
    if (i < 0) return false
    left.splice(i, 1)
  }
  return true
}
