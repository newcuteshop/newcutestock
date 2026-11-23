// ===== ฟอร์มตั้งค่าร้าน b.oncloud: ค่าในช่องกรอก ↔ wed_settings + ตรวจข้อมูลตามกติกาเดียวกับ wed_save_settings =====
// หน้าตั้งค่าบันทึก "ทีละแท็บ" — wed_save_settings แก้เฉพาะคีย์ที่ส่งไป (แท็บอื่นที่แก้ค้างอยู่ไม่ถูกทับ)
// ฐานข้อมูลตรวจซ้ำเสมอ — ฝั่งนี้ตรวจก่อนเพื่อบอกช่องที่ผิดได้ทันที (ข้อความ/เพดานตรงกับ supabase-fix-07-wedding.sql)
// pure functions ล้วน (ไม่มี React) · ใช้ตัวช่วยกลางของฟอร์มร้านเช่า (ตัดช่องว่าง/เลขไทย/พร้อมเพย์/แถวบัญชีธนาคาร) ให้ตรงกันทั้งระบบ
import { parseMoneyInput, round2 } from '@/lib/money'
import { MAX_WED_BANK_ACCOUNTS, MAX_WED_MONEY, type WedSettings } from '@/lib/wedding'
import {
  asciiDigits, BANK_FIELD_MAX, bankErrorKey, clean, newBankKey, promptPayDigits, type BankRow,
} from '@/components/rental/settings/settingsForm'

export { asciiDigits, clean, promptPayDigits, type BankRow }

export const TEXT_LIMITS = {
  shop_name: 100,
  tagline: 200,
  phone: 50,
  email: 100,
  address: 500,
  line_id: 50,
  line_url: 300,
  instagram: 300,
  facebook: 300,
  tiktok: 300,
  promptpay_name: 100,
  terms_text: 20000,
  booking_note: 1000,
  receipt_footer: 300,
} as const

/** เพดานของนโยบาย (ตรง check constraint ของ wed_settings) */
export const MAX_HOLD_HOURS = 720
export const MAX_JOBS_PER_DAY = 50
export const MAX_BALANCE_DUE_DAYS = 365

export interface WedSettingsForm {
  shop_name: string
  tagline: string
  phone: string
  email: string
  address: string
  line_id: string
  line_url: string
  instagram: string
  facebook: string
  tiktok: string
  promptpay_id: string
  promptpay_name: string
  bank_accounts: BankRow[]
  deposit_percent: string
  min_deposit: string
  balance_due_days: string
  hold_hours: string
  max_jobs_per_day: string
  overtime_rate: string
  terms_text: string
  booking_note: string
  receipt_footer: string
  portal_enabled: boolean
}

export type SectionKey = 'shop' | 'contact' | 'payment' | 'policy' | 'terms' | 'docs' | 'portal'

export const SECTION_KEYS: readonly SectionKey[] = ['shop', 'contact', 'payment', 'policy', 'terms', 'docs', 'portal'] as const

export const SECTION_FIELDS: Readonly<Record<SectionKey, readonly (keyof WedSettingsForm)[]>> = {
  shop: ['shop_name', 'tagline', 'phone', 'email', 'address'],
  contact: ['line_id', 'line_url', 'instagram', 'facebook', 'tiktok'],
  payment: ['promptpay_id', 'promptpay_name', 'bank_accounts'],
  policy: ['deposit_percent', 'min_deposit', 'balance_due_days', 'hold_hours', 'max_jobs_per_day', 'overtime_rate'],
  terms: ['terms_text'],
  docs: ['booking_note', 'receipt_footer'],
  portal: ['portal_enabled'],
}

/** ชื่อแท็บ (ปุ่มบันทึกใช้ "บันทึก" + ชื่อนี้) */
export const SECTION_LABELS: Readonly<Record<SectionKey, string>> = {
  shop: 'ข้อมูลร้าน',
  contact: 'ช่องทางติดต่อ',
  payment: 'การรับเงิน',
  policy: 'นโยบาย',
  terms: 'เงื่อนไขสัญญา',
  docs: 'ข้อความบนเอกสาร',
  portal: 'ลิงก์ลูกค้า',
}

export const NO_FLAGS: Readonly<Record<SectionKey, boolean>> = {
  shop: false, contact: false, payment: false, policy: false, terms: false, docs: false, portal: false,
}

function numText(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/** ค่าที่บันทึกไว้ → ค่าในช่องกรอก */
export function toForm(s: WedSettings): WedSettingsForm {
  return {
    shop_name: s.shop_name,
    tagline: s.tagline ?? '',
    phone: s.phone ?? '',
    email: s.email ?? '',
    address: s.address ?? '',
    line_id: s.line_id ?? '',
    line_url: s.line_url ?? '',
    instagram: s.instagram ?? '',
    facebook: s.facebook ?? '',
    tiktok: s.tiktok ?? '',
    promptpay_id: s.promptpay_id ?? '',
    promptpay_name: s.promptpay_name ?? '',
    bank_accounts: s.bank_accounts.map(a => ({ key: newBankKey(), bank: a.bank, account_no: a.account_no, account_name: a.account_name })),
    deposit_percent: numText(s.deposit_percent),
    min_deposit: numText(s.min_deposit),
    balance_due_days: String(s.balance_due_days),
    hold_hours: String(s.hold_hours),
    max_jobs_per_day: String(s.max_jobs_per_day),
    overtime_rate: numText(s.overtime_rate),
    terms_text: s.terms_text,
    booking_note: s.booking_note ?? '',
    receipt_footer: s.receipt_footer ?? '',
    portal_enabled: s.portal_enabled,
  }
}

/** แทนค่าเฉพาะแท็บที่เพิ่งบันทึก (แท็บอื่นที่แก้ค้างอยู่คงเดิม) */
export function mergeSection(current: WedSettingsForm, fresh: WedSettingsForm, section: SectionKey): WedSettingsForm {
  const next = { ...current } as Record<keyof WedSettingsForm, unknown>
  for (const k of SECTION_FIELDS[section]) next[k] = fresh[k]
  return next as unknown as WedSettingsForm
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
  if (n > MAX_WED_MONEY) return { value: null, error: `${label}สูงเกินไป` }
  return { value: n, error: null }
}

function textField(
  payload: Record<string, unknown>, errors: Record<string, string>,
  key: keyof typeof TEXT_LIMITS, v: string, opts: { required?: string; url?: string; email?: string } = {},
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
  else if (opts.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) errors[key] = opts.email
  payload[key] = t
}

/** มัดจำตามกติกาเดียวกับ wed_recalc: ceil(ยอด × % ÷ 100) ไม่ต่ำกว่ามัดจำขั้นต่ำ และไม่เกินยอดสุทธิ */
export function depositFor(total: number, pct: number, min: number): number {
  return Math.min(total, Math.max(min, Math.ceil(round2((total * pct) / 100))))
}

/**
 * ค่าในฟอร์มของแท็บหนึ่ง → payload ที่ส่งให้ wed_save_settings + error รายช่อง (คีย์ = ชื่อช่อง)
 * มี error = ห้ามส่ง
 */
export function buildSection(section: SectionKey, f: WedSettingsForm): { payload: Record<string, unknown>; errors: Record<string, string> } {
  const payload: Record<string, unknown> = {}
  const errors: Record<string, string> = {}

  if (section === 'shop') {
    textField(payload, errors, 'shop_name', f.shop_name, { required: 'กรุณาใส่ชื่อร้าน' })
    textField(payload, errors, 'tagline', f.tagline)
    textField(payload, errors, 'phone', f.phone)
    textField(payload, errors, 'email', f.email, { email: 'อีเมลร้านไม่ถูกต้อง (เช่น hello@example.com)' })
    textField(payload, errors, 'address', f.address)
  }

  if (section === 'contact') {
    textField(payload, errors, 'line_id', f.line_id)
    textField(payload, errors, 'line_url', f.line_url, { url: 'ลิงก์ LINE ต้องขึ้นต้นด้วย http:// หรือ https://' })
    textField(payload, errors, 'instagram', f.instagram)
    textField(payload, errors, 'facebook', f.facebook)
    textField(payload, errors, 'tiktok', f.tiktok)
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
    if (rows.length > MAX_WED_BANK_ACCOUNTS) errors.bank_accounts = `ใส่บัญชีธนาคารได้ไม่เกิน ${MAX_WED_BANK_ACCOUNTS} บัญชี`
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
    const pctText = clean(asciiDigits(f.deposit_percent).replace(/%/g, ''))
    const pct = pctText === null ? null : parseMoneyInput(pctText)
    if (pct === null || pct < 0 || pct > 100) errors.deposit_percent = 'เปอร์เซ็นต์มัดจำต้องอยู่ระหว่าง 0 ถึง 100'
    else payload.deposit_percent = pct
    const min = moneyField(f.min_deposit, 'มัดจำขั้นต่ำ')
    if (min.error) errors.min_deposit = min.error
    else payload.min_deposit = min.value
    const due = intField(f.balance_due_days, 'จำนวนวันก่อนวันงานที่ต้องชำระครบ', 0, MAX_BALANCE_DUE_DAYS)
    if (due.error) errors.balance_due_days = due.error
    else payload.balance_due_days = due.value
    const hold = intField(f.hold_hours, 'เวลาล็อกคิวรอมัดจำ (ชั่วโมง)', 1, MAX_HOLD_HOURS)
    if (hold.error) errors.hold_hours = hold.error
    else payload.hold_hours = hold.value
    const jobs = intField(f.max_jobs_per_day, 'จำนวนงานสูงสุดต่อวัน', 0, MAX_JOBS_PER_DAY)
    if (jobs.error) errors.max_jobs_per_day = jobs.error
    else payload.max_jobs_per_day = jobs.value
    const ot = moneyField(f.overtime_rate, 'ค่าล่วงเวลาต่อชั่วโมง')
    if (ot.error) errors.overtime_rate = ot.error
    else payload.overtime_rate = ot.value
  }

  if (section === 'terms') {
    textField(payload, errors, 'terms_text', f.terms_text, { required: 'กรุณาใส่เงื่อนไขสัญญา' })
  }

  if (section === 'docs') {
    textField(payload, errors, 'booking_note', f.booking_note)
    textField(payload, errors, 'receipt_footer', f.receipt_footer)
  }

  if (section === 'portal') {
    payload.portal_enabled = f.portal_enabled
  }

  return { payload, errors }
}

/** สถานะ "แก้ไขแล้วยังไม่บันทึก" ของแท็บ — เทียบค่าในช่อง (ตัดช่องว่างหัวท้าย) กับค่าที่บันทึกไว้ */
export function sectionDirty(section: SectionKey, f: WedSettingsForm, saved: WedSettingsForm): boolean {
  return sectionSnapshot(section, f) !== sectionSnapshot(section, saved)
}

function sectionSnapshot(section: SectionKey, f: WedSettingsForm): string {
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
