// ===== ฟอร์มตั้งค่าร้านเช่าชุด: ค่าในช่องกรอก ↔ rental_settings + ตรวจข้อมูลตามกติกาเดียวกับ rental_save_settings =====
// หน้าตั้งค่าบันทึก "ทีละหมวด" — rental_save_settings แก้เฉพาะคีย์ที่ส่งไป (หมวดอื่นที่กำลังแก้ค้างอยู่ไม่ถูกทับ)
// ฐานข้อมูลตรวจซ้ำเสมอ — ฝั่งนี้ตรวจก่อนเพื่อบอกช่องที่ผิดได้ทันที (ข้อความ/เพดานตรงกับ supabase-fix-05-rental.sql)
// pure functions ล้วน (ไม่มี React) → ทดสอบ/ใช้ซ้ำได้
import { parseMoneyInput } from '@/lib/money'
import {
  MAX_RENTAL_DAYS, MAX_RENTAL_MONEY, RENTAL_LATE_FEE_MODES, type RentalLateFeeMode, type RentalSettings,
} from '@/lib/rental'

export const TEXT_LIMITS = {
  shop_name: 100,
  tagline: 200,
  address: 500,
  phone: 50,
  line_id: 50,
  line_url: 300,
  facebook_url: 300,
  opening_hours: 200,
  receipt_footer: 300,
  promptpay_name: 100,
  online_notice: 1000,
  terms_text: 20000,
} as const

export const MAX_BANK_ACCOUNTS = 5
export const BANK_FIELD_MAX = 100
export const MAX_BUFFER_DAYS = 14
export const MAX_HOLD_HOURS = 168

export interface BankRow {
  key: string            // คีย์ของแถวบนจอ (React key) — ไม่ส่งไปฐานข้อมูล
  bank: string
  account_no: string
  account_name: string
}

export interface SettingsForm {
  shop_name: string
  tagline: string
  address: string
  phone: string
  line_id: string
  line_url: string
  facebook_url: string
  opening_hours: string
  receipt_footer: string
  promptpay_id: string
  promptpay_name: string
  bank_accounts: BankRow[]
  booking_deposit_percent: string
  min_booking_deposit: string
  default_base_days: string
  buffer_before_days: string
  buffer_after_days: string
  late_fee_mode: RentalLateFeeMode
  late_fee_fixed: string
  online_enabled: boolean
  online_hold_hours: string
  online_min_lead_days: string
  online_max_days: string
  online_notice: string
  terms_text: string
}

export type SectionKey = 'shop' | 'payment' | 'policy' | 'online' | 'terms'

export const SECTION_FIELDS: Readonly<Record<SectionKey, readonly (keyof SettingsForm)[]>> = {
  shop: ['shop_name', 'tagline', 'address', 'phone', 'line_id', 'line_url', 'facebook_url', 'opening_hours', 'receipt_footer'],
  payment: ['promptpay_id', 'promptpay_name', 'bank_accounts'],
  policy: [
    'booking_deposit_percent', 'min_booking_deposit', 'default_base_days', 'buffer_before_days', 'buffer_after_days',
    'late_fee_mode', 'late_fee_fixed',
  ],
  online: ['online_enabled', 'online_hold_hours', 'online_min_lead_days', 'online_max_days', 'online_notice'],
  terms: ['terms_text'],
}

export const SECTION_LABELS: Readonly<Record<SectionKey, string>> = {
  shop: 'ข้อมูลร้าน',
  payment: 'ช่องทางรับเงิน',
  policy: 'นโยบายการเช่า',
  online: 'จองออนไลน์',
  terms: 'ข้อตกลงในสัญญา',
}

let bankKeySeq = 0
/** คีย์ใหม่ของแถวบัญชีธนาคาร (ใช้บนจอเท่านั้น) */
export function newBankKey(): string {
  bankKeySeq += 1
  return `bank-${bankKeySeq}`
}

function moneyText(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/** ค่าที่บันทึกไว้ → ค่าในช่องกรอก */
export function toForm(s: RentalSettings): SettingsForm {
  return {
    shop_name: s.shop_name,
    tagline: s.tagline ?? '',
    address: s.address ?? '',
    phone: s.phone ?? '',
    line_id: s.line_id ?? '',
    line_url: s.line_url ?? '',
    facebook_url: s.facebook_url ?? '',
    opening_hours: s.opening_hours ?? '',
    receipt_footer: s.receipt_footer ?? '',
    promptpay_id: s.promptpay_id ?? '',
    promptpay_name: s.promptpay_name ?? '',
    bank_accounts: s.bank_accounts.map(a => ({ key: newBankKey(), bank: a.bank, account_no: a.account_no, account_name: a.account_name })),
    booking_deposit_percent: moneyText(s.booking_deposit_percent),
    min_booking_deposit: moneyText(s.min_booking_deposit),
    default_base_days: String(s.default_base_days),
    buffer_before_days: String(s.buffer_before_days),
    buffer_after_days: String(s.buffer_after_days),
    late_fee_mode: s.late_fee_mode,
    late_fee_fixed: moneyText(s.late_fee_fixed),
    online_enabled: s.online_enabled,
    online_hold_hours: String(s.online_hold_hours),
    online_min_lead_days: String(s.online_min_lead_days),
    online_max_days: String(s.online_max_days),
    online_notice: s.online_notice ?? '',
    terms_text: s.terms_text,
  }
}

/** แทนค่าเฉพาะหมวดที่เพิ่งบันทึก (หมวดอื่นที่แก้ค้างอยู่คงเดิม) */
export function mergeSection(current: SettingsForm, fresh: SettingsForm, section: SectionKey): SettingsForm {
  const next = { ...current } as Record<keyof SettingsForm, unknown>
  for (const k of SECTION_FIELDS[section]) next[k] = fresh[k]
  return next as unknown as SettingsForm
}

// ตัดช่องว่างหัวท้ายแบบเดียวกับฐานข้อมูล (product_clean_text — รวม NBSP / zero-width จากการคัดลอก) ; ว่าง = null
function isEdgeSpace(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202f) ||
    (code >= 0x205f && code <= 0x2064) || code === 0xfeff || code === 0x3000 || ch.trim() === ''
}

export function clean(v: string): string | null {
  let start = 0
  let end = v.length
  while (start < end && isEdgeSpace(v[start])) start++
  while (end > start && isEdgeSpace(v[end - 1])) end--
  const t = v.slice(start, end)
  return t === '' ? null : t
}

/** เลขไทย ๐-๙ → 0-9 */
export function asciiDigits(v: string): string {
  return v.replace(/[๐-๙]/g, d => String(d.charCodeAt(0) - 0x0e50))
}

/** รหัสพร้อมเพย์ที่ร้านใช้ได้ (ตรงกับฐานข้อมูล): มือถือ 10 หลักขึ้นต้น 0 หรือเลขผู้เสียภาษี/บัตรประชาชน 13 หลัก → ตัวเลขล้วน ; ไม่ถูกต้อง → null */
export function promptPayDigits(v: string): string | null {
  const t = clean(asciiDigits(v))
  if (t === null) return null
  if (!/^[0-9 -]+$/.test(t)) return null
  const d = t.replace(/\D/g, '')
  return /^0\d{9}$/.test(d) || /^\d{13}$/.test(d) ? d : null
}

function bankRowBlank(r: BankRow): boolean {
  return clean(r.bank) === null && clean(r.account_no) === null && clean(r.account_name) === null
}

function intField(v: string, label: string, min: number, max: number): { value: number | null; error: string | null } {
  const t = clean(asciiDigits(v))
  if (t === null) return { value: null, error: `กรุณาใส่${label}` }
  if (!/^\d+$/.test(t)) return { value: null, error: `${label}ต้องเป็นจำนวนเต็ม ${min} ถึง ${max}` }
  const n = Number(t)
  if (!Number.isSafeInteger(n) || n < min || n > max) return { value: null, error: `${label}ต้องเป็นจำนวนเต็ม ${min} ถึง ${max}` }
  return { value: n, error: null }
}

function moneyField(v: string, label: string): { value: number | null; error: string | null } {
  if (clean(v) === null) return { value: 0, error: null } // ว่าง = 0
  const n = parseMoneyInput(v)
  if (n === null) return { value: null, error: `${label}: รูปแบบจำนวนเงินไม่ถูกต้อง` }
  if (n < 0) return { value: null, error: `${label}ต้องไม่ติดลบ` }
  if (n > MAX_RENTAL_MONEY) return { value: null, error: `${label}สูงเกินไป` }
  return { value: n, error: null }
}

function textField(
  payload: Record<string, unknown>, errors: Record<string, string>,
  key: keyof typeof TEXT_LIMITS, v: string, opts: { required?: string; url?: string } = {},
) {
  const t = clean(v)
  const max = TEXT_LIMITS[key]
  if (t === null) {
    if (opts.required) errors[key] = opts.required
    payload[key] = null
    return
  }
  if (t.length > max) errors[key] = `ยาวเกินไป (สูงสุด ${max.toLocaleString('en-US')} ตัวอักษร)`
  else if (opts.url && !/^https?:\/\/\S+$/i.test(t)) errors[key] = opts.url
  payload[key] = t
}

/** คีย์ error ของแต่ละช่องในบัญชีธนาคาร */
export function bankErrorKey(index: number, field: 'bank' | 'account_no' | 'account_name' | 'row'): string {
  return `bank_accounts.${index}.${field}`
}

/**
 * ค่าในฟอร์มของหมวดหนึ่ง → payload ที่ส่งให้ rental_save_settings + error รายช่อง (คีย์ = ชื่อช่อง)
 * มี error = ห้ามส่ง
 */
export function buildSection(section: SectionKey, f: SettingsForm): { payload: Record<string, unknown>; errors: Record<string, string> } {
  const payload: Record<string, unknown> = {}
  const errors: Record<string, string> = {}

  if (section === 'shop') {
    textField(payload, errors, 'shop_name', f.shop_name, { required: 'กรุณาใส่ชื่อร้าน' })
    textField(payload, errors, 'tagline', f.tagline)
    textField(payload, errors, 'address', f.address)
    textField(payload, errors, 'phone', f.phone)
    textField(payload, errors, 'line_id', f.line_id)
    textField(payload, errors, 'line_url', f.line_url, { url: 'ลิงก์ LINE ต้องขึ้นต้นด้วย https://' })
    textField(payload, errors, 'facebook_url', f.facebook_url, { url: 'ลิงก์ Facebook ต้องขึ้นต้นด้วย https://' })
    textField(payload, errors, 'opening_hours', f.opening_hours)
    textField(payload, errors, 'receipt_footer', f.receipt_footer)
  }

  if (section === 'payment') {
    const raw = clean(asciiDigits(f.promptpay_id))
    if (raw === null) {
      payload.promptpay_id = null
    } else {
      const d = promptPayDigits(raw)
      if (d === null) errors.promptpay_id = 'พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขผู้เสียภาษี/บัตรประชาชน 13 หลัก (ตัวเลขเท่านั้น)'
      payload.promptpay_id = d ?? raw
    }
    textField(payload, errors, 'promptpay_name', f.promptpay_name)
    const rows = f.bank_accounts.filter(r => !bankRowBlank(r))
    if (rows.length > MAX_BANK_ACCOUNTS) errors.bank_accounts = `ใส่บัญชีธนาคารได้ไม่เกิน ${MAX_BANK_ACCOUNTS} บัญชี`
    const accounts: { bank: string; account_no: string; account_name: string }[] = []
    f.bank_accounts.forEach((r, i) => {
      if (bankRowBlank(r)) return
      const bank = clean(r.bank)
      const no = clean(r.account_no)
      const name = clean(r.account_name)
      if (bank === null) errors[bankErrorKey(i, 'bank')] = 'กรุณาใส่ชื่อธนาคาร'
      else if (bank.length > BANK_FIELD_MAX) errors[bankErrorKey(i, 'bank')] = `ยาวเกินไป (สูงสุด ${BANK_FIELD_MAX} ตัวอักษร)`
      if (no === null) errors[bankErrorKey(i, 'account_no')] = 'กรุณาใส่เลขบัญชี'
      else if (no.length > BANK_FIELD_MAX) errors[bankErrorKey(i, 'account_no')] = `ยาวเกินไป (สูงสุด ${BANK_FIELD_MAX} ตัวอักษร)`
      if (name === null) errors[bankErrorKey(i, 'account_name')] = 'กรุณาใส่ชื่อบัญชี'
      else if (name.length > BANK_FIELD_MAX) errors[bankErrorKey(i, 'account_name')] = `ยาวเกินไป (สูงสุด ${BANK_FIELD_MAX} ตัวอักษร)`
      accounts.push({ bank: bank ?? '', account_no: no ?? '', account_name: name ?? '' })
    })
    payload.bank_accounts = accounts
  }

  if (section === 'policy') {
    const pctText = clean(asciiDigits(f.booking_deposit_percent).replace(/%/g, ''))
    const pct = pctText === null ? null : parseMoneyInput(pctText)
    if (pct === null || pct < 0 || pct > 100) errors.booking_deposit_percent = 'เปอร์เซ็นต์มัดจำต้องอยู่ระหว่าง 0 ถึง 100'
    else payload.booking_deposit_percent = pct
    const min = moneyField(f.min_booking_deposit, 'มัดจำขั้นต่ำ')
    if (min.error) errors.min_booking_deposit = min.error
    else payload.min_booking_deposit = min.value
    const base = intField(f.default_base_days, 'จำนวนวันเช่าพื้นฐาน', 1, MAX_RENTAL_DAYS)
    if (base.error) errors.default_base_days = base.error
    else payload.default_base_days = base.value
    const before = intField(f.buffer_before_days, 'วันเตรียมชุดก่อนรับ', 0, MAX_BUFFER_DAYS)
    if (before.error) errors.buffer_before_days = before.error
    else payload.buffer_before_days = before.value
    const after = intField(f.buffer_after_days, 'วันซัก/ตรวจชุดหลังคืน', 0, MAX_BUFFER_DAYS)
    if (after.error) errors.buffer_after_days = after.error
    else payload.buffer_after_days = after.value
    payload.late_fee_mode = (RENTAL_LATE_FEE_MODES as readonly string[]).includes(f.late_fee_mode) ? f.late_fee_mode : 'per_day_item'
    // อัตราคงที่ใช้เฉพาะโหมด "คิดอัตราคงที่ต่อวัน" — โหมดอื่นไม่ส่งช่องนี้ (ช่องถูกซ่อน ค่าเดิมในฐานข้อมูลคงไว้)
    if (f.late_fee_mode === 'fixed_per_day') {
      const fixed = moneyField(f.late_fee_fixed, 'ค่าปรับคืนช้าต่อวัน')
      if (fixed.error) errors.late_fee_fixed = fixed.error
      else if ((fixed.value ?? 0) <= 0) errors.late_fee_fixed = 'กรุณาใส่ค่าปรับต่อวัน (มากกว่า 0)'
      else payload.late_fee_fixed = fixed.value
    }
  }

  if (section === 'online') {
    payload.online_enabled = f.online_enabled
    const hold = intField(f.online_hold_hours, 'เวลาถือการจองออนไลน์ (ชั่วโมง)', 1, MAX_HOLD_HOURS)
    if (hold.error) errors.online_hold_hours = hold.error
    else payload.online_hold_hours = hold.value
    const lead = intField(f.online_min_lead_days, 'จองล่วงหน้าอย่างน้อย (วัน)', 0, 365)
    if (lead.error) errors.online_min_lead_days = lead.error
    else payload.online_min_lead_days = lead.value
    const max = intField(f.online_max_days, 'จำนวนวันเช่าสูงสุดทางออนไลน์', 1, MAX_RENTAL_DAYS)
    if (max.error) errors.online_max_days = max.error
    else payload.online_max_days = max.value
    textField(payload, errors, 'online_notice', f.online_notice)
  }

  if (section === 'terms') {
    textField(payload, errors, 'terms_text', f.terms_text, { required: 'กรุณาใส่ข้อตกลงในสัญญาเช่า' })
  }

  return { payload, errors }
}

/** สถานะ "แก้ไขแล้วยังไม่บันทึก" ของหมวด — เทียบค่าในช่อง (ตัดช่องว่างหัวท้าย) กับค่าที่บันทึกไว้ */
export function sectionDirty(section: SectionKey, f: SettingsForm, saved: SettingsForm): boolean {
  return sectionSnapshot(section, f) !== sectionSnapshot(section, saved)
}

function sectionSnapshot(section: SectionKey, f: SettingsForm): string {
  const out: unknown[] = []
  for (const k of SECTION_FIELDS[section]) {
    const v = f[k]
    if (k === 'bank_accounts') {
      out.push((v as BankRow[]).filter(r => !bankRowBlank(r)).map(r => [clean(r.bank), clean(r.account_no), clean(r.account_name)]))
    } else if (typeof v === 'string') {
      out.push(clean(v))
    } else {
      out.push(v)
    }
  }
  return JSON.stringify(out)
}
