// ===== ฟอร์มงาน/การจองร้าน b.oncloud (สร้างใหม่ / แก้ไข) — ชนิดข้อมูล + ตัวตรวจ + ตัวสร้าง payload =====
// pure functions ล้วน (ไม่แตะ window/document) — ฐานข้อมูลตรวจซ้ำทุกข้อเสมอ (wed_read_head / wed_read_sessions / wed_read_addons)
// หน้าจอตรวจไว้ก่อนเพื่อบอกผู้ใช้เร็วๆ ว่าต้องแก้ช่องไหน ; ยอดเงินทุกตัวที่แสดงมาจาก wed_quote (ฐานข้อมูลคำนวณ) — หน้าจอไม่คิดราคาเอง
// คีย์ของรายการในฟอร์ม (คิว/ทีม/กำหนดการ/บริการเสริม/งานที่ส่ง): ข้อมูลเดิม = คีย์จากรหัสในฐานข้อมูล (ตรงกันทั้ง server และ client)
//   รายการที่เพิ่มใหม่ในหน้าจอ = uuid (ผู้เรียกส่งเข้ามา) — ห้ามใช้คีย์เป็น id ของช่องกรอก (ใช้ useId แทน)
import { parseMoneyInput, round2 } from '@/lib/money'
import { addDaysToKey, isDayKey } from '@/lib/format'
import {
  MAX_PACKAGE_DELIVERABLES, MAX_RUN_SHEET_ROWS, MAX_WED_MONEY, MAX_WED_SESSIONS, WED_CREW_ROLES, WED_PAYMENT_METHODS,
  WED_SESSION_STATUSES, WED_SESSION_TYPES, WED_SOURCES, normTime, phoneDigits, safeHttpUrl,
  type WedBooking, type WedCrew, type WedCrewRole, type WedCustomer, type WedDeliverablePlanItem, type WedPackage,
  type WedPaymentMethod, type WedQuote, type WedSessionStatus, type WedSessionType, type WedSource,
} from '@/lib/wedding'

export type FormMode = 'create' | 'edit'
export type CreateStatus = 'inquiry' | 'hold' | 'confirmed'

// ---------------------------------------------------------------------------
// เพดานความยาว (ตรงกับ supabase-fix-07-wedding.sql)
// ---------------------------------------------------------------------------
export const MAX_COUPLE = 120
export const MAX_TITLE = 120
export const MAX_VENUE_NAME = 150
export const MAX_VENUE_ADDRESS = 500
export const MAX_MAP_URL = 500
export const MAX_VENUE_CONTACT = 150
export const MAX_SESSION_LONG = 2000      // การแต่งกายทีม / หมายเหตุคิว
export const MAX_RUN_TEXT = 200
export const MAX_CREW_PER_SESSION = 20
export const MAX_ADDONS = 30
export const MAX_ADDON_NAME = 100
export const MAX_ADDON_UNIT = 30
export const MAX_ADDON_QTY = 9999
export const MAX_PLAN_NAME = 120
export const MAX_PLAN_UNIT = 30
export const MAX_PLAN_QTY = 100000
export const MAX_PLAN_DAYS = 365
export const MAX_PKG_NAME = 100
export const MAX_PKG_DESC = 3000
export const MAX_PKG_HOURS = 999.9
export const MAX_DISCOUNT_NOTE = 200
export const MAX_FOLLOWUP_NOTE = 500
export const MAX_COORD_NAME = 100
export const MAX_COORD_PHONE = 50
export const MAX_MOOD = 500
export const MAX_CUSTOMER_NOTE = 2000
export const MAX_NOTE = 2000
export const MAX_PAY_NOTE = 300
export const MAX_HOLD_HOURS = 720
// วันที่ของคิวย้อนหลังได้ไม่เกิน 2 ปี / ล่วงหน้าไม่เกิน 3 ปี (ตรวจเฉพาะวันที่ที่เปลี่ยน — ตรงกับ wed_read_sessions)
export const MAX_BACKDATE_DAYS = 730
export const MAX_AHEAD_DAYS = 1100

// ลูกค้า (wed_customer_write)
export const MAX_CUST_NAME = 100
export const MAX_CUST_LINE = 50
export const MAX_CUST_IG = 100
export const MAX_CUST_FB = 200
export const MAX_CUST_EMAIL = 100
export const MAX_CUST_ADDRESS = 500
export const MAX_CUST_NOTE = 1000

/** ส่วนของฟอร์ม (ใช้ทำแถบลัดด้านบน + พาไปส่วนที่ยังไม่ครบ) */
export type SectionId = 'customer' | 'sessions' | 'package' | 'money' | 'status' | 'other'
export const SECTIONS: readonly { id: SectionId; label: string }[] = [
  { id: 'customer', label: 'ลูกค้า' },
  { id: 'sessions', label: 'คิวงาน' },
  { id: 'package', label: 'แพ็กเกจ' },
  { id: 'money', label: 'ยอดเงิน' },
  { id: 'status', label: 'สถานะ' },
  { id: 'other', label: 'อื่นๆ' },
]
export function sectionDomId(id: SectionId): string {
  return `wbf-sec-${id}`
}

// ---------------------------------------------------------------------------
// ชนิดข้อมูลของฟอร์ม (สตริงดิบของช่องกรอก — แปลง/ตรวจตอนสร้าง payload)
// ---------------------------------------------------------------------------
/** ลูกค้าที่เลือกจากในระบบ (พอสำหรับแสดง + เสนอชื่อคู่บ่าวสาว) */
export interface CustomerLite {
  id: string
  name: string
  partner_name: string | null
  phone: string
  phone2: string | null
  line_id: string | null
  instagram: string | null
  source: WedSource | null
}

export interface CustomerDraft {
  name: string
  partner_name: string
  phone: string
  phone2: string
  line_id: string
  instagram: string
  facebook: string
  email: string
  address: string
  note: string
}

export const EMPTY_CUSTOMER_DRAFT: Readonly<CustomerDraft> = {
  name: '', partner_name: '', phone: '', phone2: '', line_id: '', instagram: '', facebook: '', email: '', address: '', note: '',
}

export interface RunRowDraft {
  key: string
  time: string   // 'HH:MM' หรือว่าง
  text: string
}

export interface CrewDraft {
  key: string
  crew_id: string
  name: string            // ไว้แสดงในฟอร์ม (ข้อมูลจริงอ่านจากรายการทีมงาน)
  nickname: string | null
  color: string
  role: WedCrewRole
  fee: string             // ผู้จัดการเท่านั้น — ว่าง = ค่าตัวเดิม/ค่าตัวมาตรฐาน
  fee_paid_on: string | null   // จ่ายค่าตัวแล้ว (ห้ามเอาออก/แก้ค่าตัว)
  note: string
}

export interface SessionDraft {
  key: string
  id: string | null       // แก้ไข: รหัสคิวเดิม (null = คิวใหม่)
  session_type: WedSessionType
  title: string
  date: string
  start_time: string
  end_time: string
  call_time: string
  venue_name: string
  venue_address: string
  map_url: string
  venue_contact: string
  dress_code: string
  notes: string
  run_sheet: RunRowDraft[]
  status: WedSessionStatus
  crew: CrewDraft[]
}

export interface PlanItemDraft {
  key: string
  name: string
  qty: string
  unit: string
  due_days: string
}

export interface AddonDraft {
  key: string
  id: string | null        // แก้ไข: แถวเดิม
  addon_id: string | null  // เลือกจากรายการบริการเสริม (null = พิมพ์เอง)
  name: string
  qty: string
  unit_price: string
  unit: string
}

export type PayMode = 'none' | 'deposit' | 'full' | 'custom'
export type PackageMode = 'catalog' | 'custom'

export interface WedDraft {
  customerMode: 'existing' | 'new'
  customer: CustomerLite | null
  newCustomer: CustomerDraft
  coupleNames: string
  source: WedSource
  status: CreateStatus
  holdHours: string
  sessions: SessionDraft[]
  packageMode: PackageMode
  packageId: string | null
  /** แพ็กเกจจากรายการ: ปรับชื่อ/ราคา/ชั่วโมง/รายละเอียดเฉพาะงานนี้ */
  pkgCustomize: boolean
  pkgName: string
  pkgPrice: string
  pkgHours: string
  pkgDescription: string
  plan: PlanItemDraft[]
  addons: AddonDraft[]
  travelFee: string
  discount: string
  discountNote: string
  /** มัดจำที่พิมพ์เอง (บาท) — ว่าง = คิดอัตโนมัติ (% ของยอดงาน ขั้นต่ำตามนโยบาย) ; 0 = ไม่เก็บมัดจำ */
  depositOverride: string
  balanceDueOverride: string
  followupDate: string
  followupNote: string
  coordinatorName: string
  coordinatorPhone: string
  moodLink: string
  customerNote: string
  note: string
  // รับเงินพร้อมสร้างงาน (สร้างใหม่เท่านั้น)
  payMode: PayMode
  payAmount: string
  payMethod: WedPaymentMethod
  payNote: string
}

export function newRunRow(key: string): RunRowDraft {
  return { key, time: '', text: '' }
}

export function newSessionDraft(key: string, type: WedSessionType = 'reception', date = ''): SessionDraft {
  return {
    key,
    id: null,
    session_type: type,
    title: '',
    date: isDayKey(date) ? date : '',
    start_time: '',
    end_time: '',
    call_time: '',
    venue_name: '',
    venue_address: '',
    map_url: '',
    venue_contact: '',
    dress_code: '',
    notes: '',
    run_sheet: [],
    status: 'scheduled',
    crew: [],
  }
}

/** คิวใหม่ที่คัดลอกสถานที่/การแต่งกายจากคิวต้นแบบ (ไม่คัดลอกวัน/เวลา/ทีม/กำหนดการ) */
export function sessionLike(key: string, base: SessionDraft | null, type: WedSessionType): SessionDraft {
  const s = newSessionDraft(key, type, base?.date ?? '')
  if (!base) return s
  return {
    ...s,
    venue_name: base.venue_name,
    venue_address: base.venue_address,
    map_url: base.map_url,
    venue_contact: base.venue_contact,
    dress_code: base.dress_code,
  }
}

export function newCrewDraft(key: string, c: WedCrew, manager: boolean): CrewDraft {
  return {
    key,
    crew_id: c.id,
    name: c.name,
    nickname: c.nickname,
    color: c.color,
    role: c.role,
    fee: manager && c.default_fee !== null && c.default_fee > 0 ? String(c.default_fee) : '',
    fee_paid_on: null,
    note: '',
  }
}

export function emptyDraft(holdHours: number, firstDate = ''): WedDraft {
  return {
    customerMode: 'existing',
    customer: null,
    newCustomer: { ...EMPTY_CUSTOMER_DRAFT },
    coupleNames: '',
    source: 'instagram',
    status: 'inquiry',
    holdHours: String(clampHold(holdHours)),
    sessions: [newSessionDraft('s1', 'reception', firstDate)],
    packageMode: 'catalog',
    packageId: null,
    pkgCustomize: false,
    pkgName: '',
    pkgPrice: '',
    pkgHours: '',
    pkgDescription: '',
    plan: [],
    addons: [],
    travelFee: '',
    discount: '',
    discountNote: '',
    depositOverride: '',
    balanceDueOverride: '',
    followupDate: '',
    followupNote: '',
    coordinatorName: '',
    coordinatorPhone: '',
    moodLink: '',
    customerNote: '',
    note: '',
    payMode: 'none',
    payAmount: '',
    payMethod: 'transfer',
    payNote: '',
  }
}

export function clampHold(h: number): number {
  const n = Number.isFinite(h) ? Math.trunc(h) : 72
  return Math.min(MAX_HOLD_HOURS, Math.max(1, n || 72))
}

// ---------------------------------------------------------------------------
// แปลงข้อมูลเดิม → ฟอร์ม
// ---------------------------------------------------------------------------
export function customerLiteFromCustomer(c: WedCustomer): CustomerLite {
  return {
    id: c.id, name: c.name, partner_name: c.partner_name, phone: c.phone, phone2: c.phone2, line_id: c.line_id,
    instagram: c.instagram, source: c.source,
  }
}

function moneyText(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? String(n) : ''
}

/** แผนงานที่ส่ง → แถวในฟอร์ม (คีย์ = ลำดับ — ข้อมูลชุดเดียวกันได้คีย์เดียวกันทั้ง server/client) */
export function planDraftFrom(items: readonly WedDeliverablePlanItem[], prefix = 'p'): PlanItemDraft[] {
  return items.slice(0, MAX_PACKAGE_DELIVERABLES).map((p, i) => ({
    key: `${prefix}${i}`,
    name: p.name,
    qty: String(p.qty),
    unit: p.unit,
    due_days: String(p.due_days),
  }))
}

/**
 * จำนวนบริการเสริมจาก JSON ดิบของ wed_get_booking (รหัสแถว → จำนวน ทศนิยม 2 ตำแหน่ง)
 * ฐานข้อมูลเก็บจำนวนเป็นทศนิยมได้ (เช่น ชั่วโมงเพิ่ม 1.5) — อ่านจาก JSON ดิบตรงๆ ให้ฟอร์มแก้ไขส่งจำนวนเดิมกลับไปเป๊ะ
 * (ถ้าส่งจำนวนที่ถูกปัดกลับไป ยอดเงินของงานจะเปลี่ยนเองทั้งที่ผู้ใช้ไม่ได้แก้)
 */
export function rawAddonQtyMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  try {
    const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
    const src = o && o.booking && typeof o.booking === 'object' ? (o.booking as Record<string, unknown>) : o
    const list = src && Array.isArray(src.addons) ? (src.addons as unknown[]) : []
    for (const r of list) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) continue
      const x = r as Record<string, unknown>
      if (typeof x.id !== 'string' || x.id === '') continue
      const n = typeof x.qty === 'number' ? x.qty : typeof x.qty === 'string' && x.qty.trim() !== '' ? Number(x.qty) : NaN
      if (!Number.isFinite(n) || n <= 0 || n > MAX_ADDON_QTY) continue
      out[x.id] = Math.round(n * 100) / 100
    }
  } catch {
    // อ่านไม่ได้ = ใช้จำนวนจากตัวอ่านปกติ
  }
  return out
}

/** ฟอร์มแก้ไขจากงานเดิม — คิว/ทีม/บริการเสริมเดิมเก็บรหัสไว้ (ฐานข้อมูลแก้แถวเดิม ไม่สร้างใหม่)
 *  addonQty = จำนวนบริการเสริมจาก JSON ดิบ (rawAddonQtyMap) — ไม่มี = ใช้จำนวนจากตัวอ่าน */
export function draftFromBooking(
  b: WedBooking,
  holdHours: number,
  manager: boolean,
  addonQty?: Readonly<Record<string, number>>,
): WedDraft {
  const d = emptyDraft(holdHours)
  const pkg = b.package
  const catalog = !!pkg.id
  return {
    ...d,
    customerMode: 'existing',
    customer: {
      id: b.customer.id,
      name: b.customer.name,
      partner_name: b.customer.partner_name,
      phone: b.customer.phone,
      phone2: b.customer.phone2,
      line_id: b.customer.line_id,
      instagram: b.customer.instagram,
      source: b.customer.source,
    },
    coupleNames: b.couple_names,
    source: b.source ?? 'other',
    status: b.status === 'hold' ? 'hold' : b.status === 'inquiry' ? 'inquiry' : 'confirmed',
    sessions: b.sessions.map(s => ({
      key: s.id,
      id: s.id,
      session_type: s.session_type,
      title: s.title ?? '',
      date: s.date ?? '',
      start_time: s.start_time ?? '',
      end_time: s.end_time ?? '',
      call_time: s.call_time ?? '',
      venue_name: s.venue_name ?? '',
      venue_address: s.venue_address ?? '',
      map_url: s.map_url ?? '',
      venue_contact: s.venue_contact ?? '',
      dress_code: s.dress_code ?? '',
      notes: s.notes ?? '',
      run_sheet: s.run_sheet.map((r, i) => ({ key: `${s.id}:r${i}`, time: r.time ?? '', text: r.text })),
      status: s.status,
      crew: s.crew.map(c => ({
        key: `${s.id}:${c.crew_id}`,
        crew_id: c.crew_id,
        name: c.name,
        nickname: c.nickname,
        color: c.color,
        role: c.role,
        fee: manager && c.fee !== null ? String(c.fee) : '',
        fee_paid_on: c.fee_paid_on,
        note: c.note ?? '',
      })),
    })),
    packageMode: catalog ? 'catalog' : 'custom',
    packageId: catalog ? pkg.id : null,
    pkgCustomize: false,
    pkgName: pkg.name,
    pkgPrice: moneyText(pkg.price),
    pkgHours: pkg.hours > 0 ? String(pkg.hours) : '',
    pkgDescription: pkg.description ?? '',
    plan: planDraftFrom(b.deliverables_plan),
    addons: b.addons.map(a => ({
      key: a.id || `a:${a.name}`,
      id: a.id || null,
      addon_id: a.addon_id,
      name: a.name,
      qty: String(a.id && addonQty && typeof addonQty[a.id] === 'number' ? addonQty[a.id] : a.qty),
      unit_price: String(a.unit_price),
      unit: a.unit ?? '',
    })),
    travelFee: moneyText(b.travel_fee),
    discount: moneyText(b.discount),
    discountNote: b.discount_note ?? '',
    // 0 ก็เป็นค่าที่ตั้งใจ (ไม่เก็บมัดจำ) — ห้ามใช้ moneyText ที่ตัด 0 ทิ้ง
    depositOverride: b.money.deposit_override !== null ? String(b.money.deposit_override) : '',
    balanceDueOverride: b.money.balance_due_date_override ?? '',
    followupDate: b.followup_date ?? '',
    followupNote: b.followup_note ?? '',
    coordinatorName: b.coordinator_name ?? '',
    coordinatorPhone: b.coordinator_phone ?? '',
    moodLink: b.mood_link ?? '',
    customerNote: b.customer_note ?? '',
    note: b.note ?? '',
  }
}

/** แผนงานที่ส่งของงานนี้ยังแก้ได้ไหม (ตรงกับ wed_read_head: ก่อนยืนยันงานเท่านั้น) */
export function planEditable(mode: FormMode, b: WedBooking | null | undefined): boolean {
  if (mode === 'create' || !b) return true
  return b.status === 'inquiry' || b.status === 'hold' || (b.status === 'postponed' && !b.confirmed_at)
}

/** ชื่อคู่บ่าวสาวที่เสนอจากข้อมูลลูกค้า: 'คุณมิว & คุณเจ' */
export function coupleSuggestion(name: string | null | undefined, partner: string | null | undefined): string {
  const fmt = (s: string | null | undefined) => {
    const t = String(s ?? '').trim()
    if (!t) return ''
    // ชื่อแรกพอ (ไม่เอานามสกุล) ; มีคำนำหน้าอยู่แล้วไม่เติม "คุณ"
    const firstWord = t.split(/\s+/)[0]
    return /^(คุณ|นาย|นาง|นางสาว|น\.ส\.|ดร\.)/.test(firstWord) ? firstWord : `คุณ${firstWord}`
  }
  const a = fmt(name)
  const b = fmt(partner)
  const out = a && b ? `${a} & ${b}` : a || b
  return out.slice(0, MAX_COUPLE)
}

// ---------------------------------------------------------------------------
// ตัวช่วยอ่านช่องกรอก
// ---------------------------------------------------------------------------
export interface MoneyCheck {
  value: number          // ช่องว่าง = 0
  problem: string | null
}

/** อ่านช่องเงิน (ว่าง = 0) — ต้องไม่ติดลบ ไม่เกินเพดาน ทศนิยมไม่เกิน 2 ตำแหน่ง */
export function checkMoney(text: string, label: string): MoneyCheck {
  if (text.trim() === '') return { value: 0, problem: null }
  const n = parseMoneyInput(text)
  if (n === null) return { value: 0, problem: `${label}ไม่ถูกต้อง (ใส่เป็นตัวเลข)` }
  if (n < 0) return { value: 0, problem: `${label}ต้องไม่ติดลบ` }
  if (n > MAX_WED_MONEY) return { value: 0, problem: `${label}สูงเกินไป` }
  return { value: n, problem: null }
}

/** อ่านจำนวน (ทศนิยมได้ตาม decimals) ; ว่าง → null */
function checkNumber(text: string, label: string, min: number, max: number, decimals: number): { value: number | null; problem: string | null } {
  const t = text.trim()
  if (t === '') return { value: null, problem: null }
  const n = parseMoneyInput(t)
  if (n === null) return { value: null, problem: `${label}ไม่ถูกต้อง (ใส่เป็นตัวเลข)` }
  const f = 10 ** decimals
  if (Math.round(n * f) / f !== n) {
    return { value: null, problem: decimals === 0 ? `${label}ต้องเป็นจำนวนเต็ม` : `${label}ทศนิยมได้ไม่เกิน ${decimals} ตำแหน่ง` }
  }
  if (n < min || n > max) return { value: null, problem: `${label}ต้องอยู่ระหว่าง ${min.toLocaleString('th-TH')} ถึง ${max.toLocaleString('th-TH')}` }
  return { value: n, problem: null }
}

/** ช่องเวลา ('HH:MM' จาก input type=time) ; ว่าง → null ; ผิดรูปแบบ → undefined */
export function timeValue(text: string): string | null | undefined {
  const t = text.trim()
  if (t === '') return null
  if (!/^\d{1,2}[:.]\d{2}(:\d{2})?$/.test(t)) return undefined
  const n = normTime(t.replace('.', ':'))
  return n ?? undefined
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

const tOrNull = (s: string): string | null => (s.trim() === '' ? null : s.trim())

function tooLong(s: string, max: number): boolean {
  return s.trim().length > max
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const PHONE_CHARS_RE = /^[0-9๐-๙ ()+.-]+$/

// ---------------------------------------------------------------------------
// ตรวจลูกค้าใหม่ (กติกาเดียวกับ wed_customer_write)
// ---------------------------------------------------------------------------
export interface CustomerCheck {
  ok: boolean
  errors: Partial<Record<keyof CustomerDraft, string>>
}

function phoneProblem(raw: string, required: boolean): string | undefined {
  const t = raw.trim()
  if (!t) return required ? 'กรุณากรอกเบอร์โทรลูกค้า' : undefined
  if (!PHONE_CHARS_RE.test(t)) return 'เบอร์โทรใส่ได้เฉพาะตัวเลข'
  const d = phoneDigits(t)
  if (d.length < 9 || d.length > 15) return 'เบอร์โทรต้องเป็นตัวเลข 9-15 หลัก'
  return undefined
}

export function checkCustomerDraft(c: CustomerDraft): CustomerCheck {
  const errors: CustomerCheck['errors'] = {}
  const name = c.name.trim()
  if (!name) errors.name = 'กรุณากรอกชื่อลูกค้า (ผู้ติดต่อหลัก)'
  else if (name.length > MAX_CUST_NAME) errors.name = `ชื่อยาวเกินไป (สูงสุด ${MAX_CUST_NAME} ตัวอักษร)`
  if (tooLong(c.partner_name, MAX_CUST_NAME)) errors.partner_name = `ชื่อคู่ยาวเกินไป (สูงสุด ${MAX_CUST_NAME} ตัวอักษร)`
  const p1 = phoneProblem(c.phone, true)
  if (p1) errors.phone = p1
  const p2 = phoneProblem(c.phone2, false)
  if (p2) errors.phone2 = p2.replace('เบอร์โทร', 'เบอร์โทรสำรอง')
  if (tooLong(c.line_id, MAX_CUST_LINE)) errors.line_id = `LINE ID ยาวเกินไป (สูงสุด ${MAX_CUST_LINE} ตัวอักษร)`
  if (tooLong(c.instagram, MAX_CUST_IG)) errors.instagram = `Instagram ยาวเกินไป (สูงสุด ${MAX_CUST_IG} ตัวอักษร)`
  if (tooLong(c.facebook, MAX_CUST_FB)) errors.facebook = `Facebook ยาวเกินไป (สูงสุด ${MAX_CUST_FB} ตัวอักษร)`
  const email = c.email.trim()
  if (email && (email.length > MAX_CUST_EMAIL || !EMAIL_RE.test(email))) errors.email = 'อีเมลไม่ถูกต้อง'
  if (tooLong(c.address, MAX_CUST_ADDRESS)) errors.address = `ที่อยู่ยาวเกินไป (สูงสุด ${MAX_CUST_ADDRESS} ตัวอักษร)`
  if (tooLong(c.note, MAX_CUST_NOTE)) errors.note = `หมายเหตุยาวเกินไป (สูงสุด ${MAX_CUST_NOTE} ตัวอักษร)`
  return { ok: Object.keys(errors).length === 0, errors }
}

/** ลูกค้าใหม่สำหรับส่งฐานข้อมูล (ช่องว่าง = null) — ช่องทางที่รู้จักร้าน = ช่องทางของงานนี้ */
export function customerPayload(c: CustomerDraft, source: WedSource): Record<string, string | null> {
  const d2 = phoneDigits(c.phone2)
  return {
    name: c.name.trim(),
    partner_name: tOrNull(c.partner_name),
    phone: phoneDigits(c.phone),
    phone2: d2 ? d2 : null,
    line_id: tOrNull(c.line_id),
    instagram: tOrNull(c.instagram),
    facebook: tOrNull(c.facebook),
    email: tOrNull(c.email),
    address: tOrNull(c.address),
    source,
    note: tOrNull(c.note),
  }
}

// ---------------------------------------------------------------------------
// ตรวจคิวงาน (กติกาเดียวกับ wed_read_sessions)
// ---------------------------------------------------------------------------
export type SessionField =
  | 'date' | 'start_time' | 'end_time' | 'call_time' | 'title' | 'venue_name' | 'venue_address' | 'map_url'
  | 'venue_contact' | 'dress_code' | 'notes'

export interface SessionCheck {
  fields: Partial<Record<SessionField, string>>
  runRows: Record<string, string>   // คีย์แถวกำหนดการ → ข้อความผิด
  crew: Record<string, string>      // คีย์ทีมงาน → ข้อความผิด
  problem: string | null            // ข้อความรวมของคิวนี้ (ข้อแรก)
  /** รูปแบบข้อมูลถูกต้องพอจะถามราคาได้ (ไม่นับ "ยังไม่ได้ใส่วันที่") */
  formatOk: boolean
  warnings: string[]
}

export interface SessionsCheckCtx {
  today: string
  /** ต้องมีวันที่ทุกคิวที่ไม่ยกเลิก (งานที่ไม่ใช่ "สอบถาม"/"เลื่อนงาน") */
  requireDates: boolean
  /** แก้ไข: วันที่เดิมของคิวเดิม (ไม่เปลี่ยนวัน = ไม่ตรวจช่วงย้อนหลัง/ล่วงหน้า) */
  originalDates?: ReadonlyMap<string, string | null>
  manager: boolean
}

export function checkSession(s: SessionDraft, index: number, ctx: SessionsCheckCtx): SessionCheck {
  const label = `คิวที่ ${index + 1}`
  const fields: SessionCheck['fields'] = {}
  const runRows: Record<string, string> = {}
  const crew: Record<string, string> = {}
  const warnings: string[] = []
  let missingDate = false

  // วันที่
  if (s.date.trim() === '') {
    if (ctx.requireDates && s.status !== 'cancelled') {
      fields.date = 'กรุณาเลือกวันที่ของคิวนี้'
      missingDate = true
    }
  } else if (!isDayKey(s.date)) {
    fields.date = 'วันที่ไม่ถูกต้อง'
  } else {
    const orig = s.id && ctx.originalDates ? ctx.originalDates.get(s.id) ?? null : null
    const changed = !s.id || orig !== s.date
    if (changed && isDayKey(ctx.today)) {
      if (s.date < addDaysToKey(ctx.today, -MAX_BACKDATE_DAYS)) fields.date = 'วันที่ย้อนหลังได้ไม่เกิน 2 ปี'
      else if (s.date > addDaysToKey(ctx.today, MAX_AHEAD_DAYS)) fields.date = 'วันที่ล่วงหน้าได้ไม่เกิน 3 ปี'
      else if (s.date < ctx.today && s.status === 'scheduled') warnings.push(`${label} เป็นวันที่ผ่านมาแล้ว`)
    }
  }

  // เวลา
  const st = timeValue(s.start_time)
  const et = timeValue(s.end_time)
  const ct = timeValue(s.call_time)
  if (st === undefined) fields.start_time = 'เวลาไม่ถูกต้อง (เช่น 09:30)'
  if (et === undefined) fields.end_time = 'เวลาไม่ถูกต้อง (เช่น 12:00)'
  if (ct === undefined) fields.call_time = 'เวลาไม่ถูกต้อง (เช่น 08:00)'
  if (st && et && minutes(et) <= minutes(st)) fields.end_time = 'เวลาเลิกต้องหลังเวลาเริ่ม'
  if (ct && st && minutes(ct) > minutes(st)) fields.call_time = 'เวลาทีมถึงงานต้องไม่ช้ากว่าเวลาเริ่ม'
  if (ct && !st && et && minutes(ct) >= minutes(et)) fields.call_time = 'เวลาทีมถึงงานต้องก่อนเวลาเลิก'

  // ข้อความ
  if (tooLong(s.title, MAX_TITLE)) fields.title = `ยาวเกินไป (สูงสุด ${MAX_TITLE} ตัวอักษร)`
  if (tooLong(s.venue_name, MAX_VENUE_NAME)) fields.venue_name = `ยาวเกินไป (สูงสุด ${MAX_VENUE_NAME} ตัวอักษร)`
  if (tooLong(s.venue_address, MAX_VENUE_ADDRESS)) fields.venue_address = `ยาวเกินไป (สูงสุด ${MAX_VENUE_ADDRESS} ตัวอักษร)`
  if (tooLong(s.venue_contact, MAX_VENUE_CONTACT)) fields.venue_contact = `ยาวเกินไป (สูงสุด ${MAX_VENUE_CONTACT} ตัวอักษร)`
  if (tooLong(s.dress_code, MAX_SESSION_LONG)) fields.dress_code = `ยาวเกินไป (สูงสุด ${MAX_SESSION_LONG} ตัวอักษร)`
  if (tooLong(s.notes, MAX_SESSION_LONG)) fields.notes = `ยาวเกินไป (สูงสุด ${MAX_SESSION_LONG} ตัวอักษร)`
  const map = s.map_url.trim()
  if (map) {
    if (map.length > MAX_MAP_URL) fields.map_url = `ลิงก์ยาวเกินไป (สูงสุด ${MAX_MAP_URL} ตัวอักษร)`
    else if (!/^https?:\/\/\S+$/i.test(map) || !safeHttpUrl(map)) fields.map_url = 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://'
  }

  // กำหนดการ
  if (s.run_sheet.length > MAX_RUN_SHEET_ROWS) runRows._all = `กำหนดการใส่ได้ไม่เกิน ${MAX_RUN_SHEET_ROWS} แถว`
  for (const r of s.run_sheet) {
    const t = timeValue(r.time)
    if (t === undefined) runRows[r.key] = 'เวลาไม่ถูกต้อง'
    else if (r.text.trim() === '' && t) runRows[r.key] = 'กรุณาใส่รายละเอียดของเวลานี้'
    else if (tooLong(r.text, MAX_RUN_TEXT)) runRows[r.key] = `ยาวเกินไป (สูงสุด ${MAX_RUN_TEXT} ตัวอักษร)`
  }

  // ทีมงาน
  const seen = new Set<string>()
  if (s.crew.length > MAX_CREW_PER_SESSION) crew._all = `ทีมงานในคิวเดียวได้ไม่เกิน ${MAX_CREW_PER_SESSION} คน`
  for (const c of s.crew) {
    if (seen.has(c.crew_id)) crew[c.key] = 'เลือกทีมงานคนนี้ซ้ำในคิวเดียวกัน'
    seen.add(c.crew_id)
    if (ctx.manager && c.fee.trim() !== '') {
      const m = checkMoney(c.fee, 'ค่าตัว')
      if (m.problem) crew[c.key] = m.problem
    }
    if (!crew[c.key] && tooLong(c.note, 300)) crew[c.key] = 'หมายเหตุยาวเกินไป (สูงสุด 300 ตัวอักษร)'
  }

  const firstField = Object.values(fields)[0]
  const firstRun = Object.values(runRows)[0]
  const firstCrew = Object.values(crew)[0]
  const first = firstField ?? firstRun ?? firstCrew
  const formatOk = Object.keys(runRows).length === 0 && Object.keys(crew).length === 0 &&
    Object.entries(fields).every(([k]) => k === 'date' && missingDate)
  return { fields, runRows, crew, problem: first ? `${label}: ${first}` : null, formatOk, warnings }
}

// ---------------------------------------------------------------------------
// payload ที่ส่งฐานข้อมูล
// ---------------------------------------------------------------------------
export function sessionsPayload(sessions: readonly SessionDraft[], manager: boolean): Record<string, unknown>[] {
  return sessions.map(s => {
    const o: Record<string, unknown> = {}
    if (s.id) o.id = s.id
    o.session_type = s.session_type
    o.title = tOrNull(s.title)
    o.date = isDayKey(s.date) ? s.date : null
    o.start_time = timeValue(s.start_time) ?? null
    o.end_time = timeValue(s.end_time) ?? null
    o.call_time = timeValue(s.call_time) ?? null
    o.venue_name = tOrNull(s.venue_name)
    o.venue_address = tOrNull(s.venue_address)
    o.map_url = tOrNull(s.map_url)
    o.venue_contact = tOrNull(s.venue_contact)
    o.dress_code = tOrNull(s.dress_code)
    o.notes = tOrNull(s.notes)
    // แถวว่างทั้งเวลาและข้อความ = ไม่ส่ง
    o.run_sheet = s.run_sheet
      .filter(r => r.text.trim() !== '' || r.time.trim() !== '')
      .map(r => ({ time: timeValue(r.time) ?? null, text: r.text.trim() }))
    o.status = s.status
    o.crew = s.crew.map(c => {
      const x: Record<string, unknown> = { crew_id: c.crew_id, role: c.role }
      // ค่าตัว: ผู้จัดการเท่านั้น (พนักงานส่งไปฐานข้อมูลก็ไม่รับ) ; ว่าง = ค่าเดิม/ค่าตัวมาตรฐาน
      if (manager && c.fee.trim() !== '') {
        const m = checkMoney(c.fee, 'ค่าตัว')
        if (!m.problem) x.fee = m.value
      }
      x.note = tOrNull(c.note)
      return x
    })
    return o
  })
}

export interface CoreCheck {
  ok: boolean
  /** รูปแบบข้อมูลพอถามราคาได้ (wed_quote) — ไม่บังคับลูกค้า/ชื่อคู่บ่าวสาว/วันที่ */
  quotable: boolean
  problems: { section: SectionId; text: string }[]
  sessions: Record<string, SessionCheck>
  pkg: Partial<Record<'name' | 'price' | 'hours' | 'description', string>>
  plan: Record<string, string>
  addons: Record<string, string>
  money: Partial<Record<'travelFee' | 'discount' | 'discountNote' | 'depositOverride' | 'balanceDueOverride', string>>
  other: Partial<Record<'couple' | 'followupDate' | 'followupNote' | 'coordinatorName' | 'coordinatorPhone' | 'moodLink' |
    'customerNote' | 'note' | 'holdHours', string>>
  warnings: string[]
  payload: Record<string, unknown>
}

export interface CoreCtx extends SessionsCheckCtx {
  mode: FormMode
  /** แผนงานที่ส่งยังแก้ได้ (สร้างใหม่ / งานที่ยังไม่ยืนยัน) */
  planOpen: boolean
  /** แก้ไข: แพ็กเกจเดิมของงาน (เลือกตัวเดิม = ไม่ส่งรายละเอียดแพ็กเกจซ้ำ ถ้าไม่ได้ปรับเอง) */
  originalPackageId?: string | null
}

/**
 * ตรวจ + สร้าง payload ส่วนหลักของงาน (ทุกอย่างยกเว้นลูกค้า/สถานะ/รับเงิน/force/client_id)
 * ลำดับคีย์คงที่เสมอ (ใช้ทำลายเซ็นข้อมูลที่ส่ง) — แก้ไข: ส่งทุกคีย์ที่ฟอร์มแก้ได้ (ค่าว่าง = ล้างค่าเดิม)
 */
export function checkCore(d: WedDraft, ctx: CoreCtx): CoreCheck {
  const problems: CoreCheck['problems'] = []
  const warnings: string[] = []
  const add = (section: SectionId, text: string | null | undefined) => {
    if (text) problems.push({ section, text })
  }
  let quotable = true

  // ----- ชื่อคู่บ่าวสาว -----
  const other: CoreCheck['other'] = {}
  const couple = d.coupleNames.trim()
  if (!couple) other.couple = 'กรุณากรอกชื่อคู่บ่าวสาว (เช่น คุณมิว & คุณเจ)'
  else if (couple.length > MAX_COUPLE) other.couple = `ชื่อคู่บ่าวสาวยาวเกินไป (สูงสุด ${MAX_COUPLE} ตัวอักษร)`
  add('customer', other.couple)

  // ----- คิวงาน -----
  const sessions: Record<string, SessionCheck> = {}
  if (d.sessions.length === 0) add('sessions', 'กรุณาเพิ่มคิวงานอย่างน้อย 1 คิว')
  if (d.sessions.length > MAX_WED_SESSIONS) add('sessions', `งานหนึ่งมีคิวงานได้ไม่เกิน ${MAX_WED_SESSIONS} คิว`)
  if (d.sessions.length === 0 || d.sessions.length > MAX_WED_SESSIONS) quotable = false
  d.sessions.forEach((s, i) => {
    const c = checkSession(s, i, ctx)
    sessions[s.key] = c
    add('sessions', c.problem)
    if (!c.formatOk) quotable = false
    warnings.push(...c.warnings)
  })

  // ----- แพ็กเกจ -----
  const pkg: CoreCheck['pkg'] = {}
  const sendPkgFields = d.packageMode === 'custom' || d.pkgCustomize
  let pkgPrice = 0
  let pkgHours: number | null = null
  // ยังไม่เลือกแพ็กเกจได้ (เช่น งานสอบถามที่ลูกค้ายังไม่ตัดสินใจ) — แค่เตือน
  if (d.packageMode === 'catalog' && !d.packageId) warnings.push('ยังไม่ได้เลือกแพ็กเกจ')
  if (sendPkgFields) {
    const m = checkMoney(d.pkgPrice, 'ราคาแพ็กเกจ')
    if (m.problem) pkg.price = m.problem
    pkgPrice = m.value
    const h = checkNumber(d.pkgHours, 'จำนวนชั่วโมง', 0, MAX_PKG_HOURS, 1)
    if (h.problem) pkg.hours = h.problem
    pkgHours = h.value
    if (tooLong(d.pkgName, MAX_PKG_NAME)) pkg.name = `ชื่อแพ็กเกจยาวเกินไป (สูงสุด ${MAX_PKG_NAME} ตัวอักษร)`
    else if (d.pkgName.trim() === '' && pkgPrice > 0) pkg.name = 'กรุณาใส่ชื่อแพ็กเกจ'
    if (tooLong(d.pkgDescription, MAX_PKG_DESC)) pkg.description = `รายละเอียดยาวเกินไป (สูงสุด ${MAX_PKG_DESC} ตัวอักษร)`
  }
  add('package', pkg.name ?? pkg.price ?? pkg.hours ?? pkg.description)
  if (Object.keys(pkg).length > 0) quotable = false

  // ----- งานที่ส่ง -----
  const plan: Record<string, string> = {}
  if (ctx.planOpen) {
    if (d.plan.length > MAX_PACKAGE_DELIVERABLES) add('package', `รายการงานที่ส่งใส่ได้ไม่เกิน ${MAX_PACKAGE_DELIVERABLES} รายการ`)
    for (const p of d.plan) {
      const name = p.name.trim()
      const q = checkNumber(p.qty, 'จำนวน', 1, MAX_PLAN_QTY, 0)
      const dd = checkNumber(p.due_days, 'จำนวนวันส่งงาน', 0, MAX_PLAN_DAYS, 0)
      if (!name && (p.qty.trim() || p.unit.trim() || p.due_days.trim())) plan[p.key] = 'กรุณาใส่ชื่องานที่ส่ง'
      else if (name.length > MAX_PLAN_NAME) plan[p.key] = `ชื่อยาวเกินไป (สูงสุด ${MAX_PLAN_NAME} ตัวอักษร)`
      else if (q.problem) plan[p.key] = q.problem
      else if (tooLong(p.unit, MAX_PLAN_UNIT)) plan[p.key] = `หน่วยยาวเกินไป (สูงสุด ${MAX_PLAN_UNIT} ตัวอักษร)`
      else if (dd.problem) plan[p.key] = dd.problem
    }
    const firstPlan = Object.values(plan)[0]
    if (firstPlan) {
      add('package', `งานที่ส่ง: ${firstPlan}`)
      quotable = false
    }
  }

  // ----- บริการเสริม -----
  const addons: Record<string, string> = {}
  if (d.addons.length > MAX_ADDONS) {
    add('package', `บริการเสริมใส่ได้ไม่เกิน ${MAX_ADDONS} รายการ`)
    quotable = false
  }
  for (const a of d.addons) {
    const q = checkNumber(a.qty, 'จำนวน', 0.01, MAX_ADDON_QTY, 2)
    const pr = checkMoney(a.unit_price, 'ราคาต่อหน่วย')
    if (!a.name.trim()) addons[a.key] = 'กรุณาใส่ชื่อบริการเสริม'
    else if (a.name.trim().length > MAX_ADDON_NAME) addons[a.key] = `ชื่อยาวเกินไป (สูงสุด ${MAX_ADDON_NAME} ตัวอักษร)`
    else if (q.problem) addons[a.key] = q.problem
    else if (a.qty.trim() === '') addons[a.key] = 'กรุณาใส่จำนวน'
    else if (pr.problem) addons[a.key] = pr.problem
    else if (tooLong(a.unit, MAX_ADDON_UNIT)) addons[a.key] = `หน่วยยาวเกินไป (สูงสุด ${MAX_ADDON_UNIT} ตัวอักษร)`
  }
  const firstAddon = Object.values(addons)[0]
  if (firstAddon) {
    add('package', `บริการเสริม: ${firstAddon}`)
    quotable = false
  }

  // ----- เงิน -----
  const money: CoreCheck['money'] = {}
  const travel = checkMoney(d.travelFee, 'ค่าเดินทาง')
  const disc = checkMoney(d.discount, 'ส่วนลด')
  if (travel.problem) money.travelFee = travel.problem
  if (disc.problem) money.discount = disc.problem
  if (tooLong(d.discountNote, MAX_DISCOUNT_NOTE)) money.discountNote = `เหตุผลส่วนลดยาวเกินไป (สูงสุด ${MAX_DISCOUNT_NOTE} ตัวอักษร)`
  // มัดจำกำหนดเอง: ว่าง = อัตโนมัติ (ส่ง null) ; ฐานข้อมูลใช้ไม่เกินยอดหลังส่วนลด (ไม่มีค่าใช้จ่ายเพิ่ม = ยอดสุทธิ)
  const depositBlank = d.depositOverride.trim() === ''
  const dep = checkMoney(d.depositOverride, 'มัดจำ')
  if (dep.problem) money.depositOverride = dep.problem
  if (d.balanceDueOverride.trim() && !isDayKey(d.balanceDueOverride)) money.balanceDueOverride = 'วันที่ไม่ถูกต้อง'
  add('money', money.travelFee ?? money.discount ?? money.discountNote ?? money.depositOverride ?? money.balanceDueOverride)
  if (money.travelFee || money.discount || money.depositOverride || money.balanceDueOverride) quotable = false

  // ----- อื่นๆ -----
  if (d.followupDate.trim() && !isDayKey(d.followupDate)) other.followupDate = 'วันที่ไม่ถูกต้อง'
  if (tooLong(d.followupNote, MAX_FOLLOWUP_NOTE)) other.followupNote = `ยาวเกินไป (สูงสุด ${MAX_FOLLOWUP_NOTE} ตัวอักษร)`
  if (tooLong(d.coordinatorName, MAX_COORD_NAME)) other.coordinatorName = `ยาวเกินไป (สูงสุด ${MAX_COORD_NAME} ตัวอักษร)`
  if (tooLong(d.coordinatorPhone, MAX_COORD_PHONE)) other.coordinatorPhone = `ยาวเกินไป (สูงสุด ${MAX_COORD_PHONE} ตัวอักษร)`
  const mood = d.moodLink.trim()
  if (mood) {
    if (mood.length > MAX_MOOD) other.moodLink = `ลิงก์ยาวเกินไป (สูงสุด ${MAX_MOOD} ตัวอักษร)`
    else if (!/^https?:\/\/\S+$/i.test(mood) || !safeHttpUrl(mood)) other.moodLink = 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://'
  }
  if (tooLong(d.customerNote, MAX_CUSTOMER_NOTE)) other.customerNote = `ยาวเกินไป (สูงสุด ${MAX_CUSTOMER_NOTE} ตัวอักษร)`
  if (tooLong(d.note, MAX_NOTE)) other.note = `ยาวเกินไป (สูงสุด ${MAX_NOTE} ตัวอักษร)`
  add('other', other.followupDate ?? other.followupNote ?? other.coordinatorName ?? other.coordinatorPhone ?? other.moodLink ??
    other.customerNote ?? other.note)
  if (other.followupDate || other.moodLink) quotable = false

  // ----- payload (ลำดับคีย์คงที่) -----
  const payload: Record<string, unknown> = {}
  payload.couple_names = couple
  if (d.packageMode === 'catalog') {
    payload.package_id = d.packageId
  } else {
    payload.package_id = null
  }
  if (sendPkgFields) {
    payload.package_name = tOrNull(d.pkgName)
    payload.package_price = pkgPrice
    payload.package_hours = pkgHours
    payload.package_description = tOrNull(d.pkgDescription)
  }
  if (ctx.planOpen) {
    payload.deliverables_plan = d.plan
      .filter(p => p.name.trim() !== '')
      .map(p => {
        const q = checkNumber(p.qty, 'จำนวน', 1, MAX_PLAN_QTY, 0).value
        const dd = checkNumber(p.due_days, 'จำนวนวันส่งงาน', 0, MAX_PLAN_DAYS, 0).value
        return { name: p.name.trim(), qty: q ?? 1, unit: tOrNull(p.unit), due_days: dd ?? 30 }
      })
  }
  payload.addons = d.addons.map(a => {
    const o: Record<string, unknown> = {}
    if (a.id) o.id = a.id
    o.addon_id = a.addon_id
    o.name = a.name.trim()
    o.unit = tOrNull(a.unit)
    o.qty = checkNumber(a.qty, 'จำนวน', 0.01, MAX_ADDON_QTY, 2).value ?? 1
    o.unit_price = checkMoney(a.unit_price, 'ราคาต่อหน่วย').value
    return o
  })
  payload.travel_fee = travel.value
  payload.discount = disc.value
  payload.discount_note = disc.value > 0 ? tOrNull(d.discountNote) : null
  // ส่งเสมอ (สร้าง/แก้ไข/ถามราคา) — null = กลับไปคิดอัตโนมัติ (แบบเดียวกับ balance_due_date_override)
  payload.deposit_override = depositBlank || dep.problem ? null : dep.value
  payload.sessions = sessionsPayload(d.sessions, ctx.manager)
  payload.balance_due_date_override = isDayKey(d.balanceDueOverride) ? d.balanceDueOverride : null
  payload.followup_date = isDayKey(d.followupDate) ? d.followupDate : null
  payload.followup_note = tOrNull(d.followupNote)
  payload.coordinator_name = tOrNull(d.coordinatorName)
  payload.coordinator_phone = tOrNull(d.coordinatorPhone)
  payload.mood_link = mood ? mood : null
  payload.customer_note = tOrNull(d.customerNote)
  payload.note = tOrNull(d.note)

  return {
    ok: problems.length === 0,
    quotable,
    problems,
    sessions,
    pkg,
    plan,
    addons,
    money,
    other,
    warnings,
    payload,
  }
}

/** ชั่วโมงล็อกคิว 1..720 ; ไม่ถูกต้อง → null */
export function holdHoursValue(text: string): number | null {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n >= 1 && n <= MAX_HOLD_HOURS ? n : null
}

// ---------------------------------------------------------------------------
// รับเงินพร้อมสร้างงาน
// ---------------------------------------------------------------------------
export interface PlannedPayment {
  kind: 'payment'
  method: WedPaymentMethod
  amount: number
  purpose: 'deposit' | 'balance' | null
  note: string | null
}

export interface PaymentPlan {
  ok: boolean
  problem: string | null
  amount: number           // รับตอนนี้ (0 = ไม่รับ)
  payments: PlannedPayment[]
}

/** ยอดที่รับพร้อมสร้างงาน — อ้างอิง wed_quote (ฐานข้อมูลตรวจซ้ำด้วยกฎเดียวกับการรับเงินปกติ: ไม่เกินยอดค้าง) */
export function planPayment(d: WedDraft, quote: WedQuote | null): PaymentPlan {
  const none: PaymentPlan = { ok: true, problem: null, amount: 0, payments: [] }
  if (d.payMode === 'none') return none
  if (!quote) return { ...none, ok: false, problem: 'รอคำนวณยอดเงินสักครู่' }
  const grand = quote.money.grand_total
  let amount = 0
  let problem: string | null = null
  if (d.payMode === 'deposit') amount = quote.money.deposit_required
  else if (d.payMode === 'full') amount = grand
  else {
    const m = checkMoney(d.payAmount, 'จำนวนเงินที่รับ')
    if (m.problem) problem = m.problem
    else if (d.payAmount.trim() === '' || m.value <= 0) problem = 'กรุณาใส่จำนวนเงินที่รับ'
    else amount = m.value
  }
  if (!problem) {
    if (amount <= 0) {
      problem = d.payMode === 'deposit'
        ? 'งานนี้ไม่ต้องเก็บมัดจำ — เลือก "ยังไม่รับ" หรือระบุจำนวนเอง'
        : 'ยอดที่ต้องชำระเป็น ฿0'
    } else if (amount > grand + 0.005) {
      problem = 'รับเงินเกินยอดสุทธิของงาน'
    }
  }
  if (!problem && tooLong(d.payNote, MAX_PAY_NOTE)) problem = `หมายเหตุการรับเงินยาวเกินไป (สูงสุด ${MAX_PAY_NOTE} ตัวอักษร)`
  if (problem) return { ...none, ok: false, problem }
  // มัดจำเท่ายอดสุทธิ (กำหนดเองเกินยอด / ขั้นต่ำ / 100%) = จ่ายครบทั้งงาน → ใบเสร็จต้องไม่เขียนว่า "มัดจำ"
  //   (กติกาเดียวกับวัตถุประสงค์อัตโนมัติใน wed_add_payment_core)
  const purpose = d.payMode === 'full' || (d.payMode === 'deposit' && amount >= grand - 0.005) ? 'balance'
    : d.payMode === 'deposit' ? 'deposit' : null
  return {
    ok: true,
    problem: null,
    amount: round2(amount),
    payments: [{ kind: 'payment', method: d.payMethod, amount: round2(amount), purpose, note: tOrNull(d.payNote) }],
  }
}

// ---------------------------------------------------------------------------
// ตัวช่วยจับคู่ผล wed_quote กับแถวในฟอร์ม
// ---------------------------------------------------------------------------
/** การชนกันของทีมงานในคิว (this_index เริ่ม 1 = ลำดับคิวในฟอร์มตอนถามราคา) */
export function conflictsForSession<T extends { this_index: number | null; this_session_id: string | null }>(
  list: readonly T[],
  index: number,
  sessionId: string | null,
): T[] {
  return list.filter(c => (c.this_index !== null ? c.this_index === index + 1 : !!sessionId && c.this_session_id === sessionId))
}

/** วันที่ที่ "เพิ่มใหม่" เทียบกับงานเดิม (แก้ไข: ฐานข้อมูลถามยืนยันคิวเต็มเฉพาะวันที่ใหม่) */
export function newDatesOf(sessions: readonly SessionDraft[], originalDates: readonly string[]): Set<string> {
  const orig = new Set(originalDates)
  const out = new Set<string>()
  for (const s of sessions) {
    if (s.status !== 'cancelled' && isDayKey(s.date) && !orig.has(s.date)) out.add(s.date)
  }
  return out
}

// ---------------------------------------------------------------------------
// เก็บฟอร์มที่กรอกค้าง + รหัสคำขอ (client_id) ไว้ใน sessionStorage (เฉพาะแท็บนี้ ปิดแท็บแล้วหาย)
// ---------------------------------------------------------------------------
export const DRAFT_STORAGE_KEY = 'wedding-booking-draft-v1'
// ฟอร์มค้างเก่ากว่านี้ไม่กู้คืน (แต่รหัสคำขอที่ยังไม่รู้ผลยังต้องตรวจเสมอ)
export const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000
export const MAX_SENT_SIGS = 5

export interface StoredDraft {
  v: 1
  cid: string
  /** กดบันทึกไปแล้วแต่ยังไม่รู้ผล (ตั้งก่อนส่ง ล้างเมื่อรู้ผลแน่นอน) → เปิดหน้าใหม่ต้องตรวจก่อนว่าบันทึกไปหรือยัง */
  inflight: boolean
  /** ลายเซ็นข้อมูลที่ส่งไปแล้วด้วยรหัสนี้ — แยก "กดซ้ำฟอร์มเดิม" กับ "ฟอร์มถูกเปลี่ยนหลังส่ง" */
  sigs: string[]
  savedAt: number
  draft: WedDraft | null
}

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

/**
 * ลายเซ็นตัวตนของคำขอสร้าง/แก้ไขงาน = ข้อมูลงานโดยไม่นับธง force (ตรงกับฐานข้อมูล: wed_payload_md5)
 * force เป็นแค่ "ยืนยันว่ารับทราบคำเตือน" ไม่ใช่ข้อมูลงาน: ส่งครั้งแรกไม่รู้ผล (บันทึกแล้วแต่คำตอบหาย) แล้วงานที่เพิ่งบันทึก
 * ทำให้วันนั้นคิวเต็ม → ครั้งถัดไปถูกบังคับส่ง force — ถ้านับ force ด้วย จะถือว่าเป็น "ฟอร์มถูกแก้หลังส่ง" แล้วชวนให้สร้างงานใหม่ (งาน+มัดจำซ้ำ)
 */
export function requestSig(payload: Record<string, unknown>): string {
  if (!('force' in payload)) return payloadSig(payload)
  const rest: Record<string, unknown> = { ...payload }
  delete rest.force
  return payloadSig(rest)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

type Obj = Record<string, unknown>
const asObj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null)
const str = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.slice(0, max) : '')
const strOrNull = (v: unknown, max = 2000): string | null => (typeof v === 'string' && v !== '' ? v.slice(0, max) : null)
const numOr = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const keyOf = (v: unknown, fallback: string): string => {
  const k = str(v, 80)
  return k || fallback
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/
const day = (v: unknown) => (isDayKey(v) ? v : '')

function readCustomerLite(raw: unknown): CustomerLite | null {
  const o = asObj(raw)
  if (!o || !isUuid(o.id)) return null
  return {
    id: (o.id as string).toLowerCase(),
    name: str(o.name, 200),
    partner_name: strOrNull(o.partner_name, 200),
    phone: str(o.phone, 40),
    phone2: strOrNull(o.phone2, 40),
    line_id: strOrNull(o.line_id, 100),
    instagram: strOrNull(o.instagram, 200),
    source: typeof o.source === 'string' && (WED_SOURCES as readonly string[]).includes(o.source) ? (o.source as WedSource) : null,
  }
}

function readSession(raw: unknown, i: number): SessionDraft | null {
  const o = asObj(raw)
  if (!o) return null
  const key = keyOf(o.key, `s${i + 1}`)
  const id = isUuid(o.id) ? (o.id as string).toLowerCase() : null
  const run: RunRowDraft[] = []
  if (Array.isArray(o.run_sheet)) {
    o.run_sheet.slice(0, MAX_RUN_SHEET_ROWS).forEach((r, j) => {
      const x = asObj(r)
      if (x) run.push({ key: keyOf(x.key, `${key}:r${j}`), time: str(x.time, 8), text: str(x.text, MAX_RUN_TEXT + 50) })
    })
  }
  const crew: CrewDraft[] = []
  if (Array.isArray(o.crew)) {
    o.crew.slice(0, MAX_CREW_PER_SESSION).forEach((c, j) => {
      const x = asObj(c)
      if (!x || !isUuid(x.crew_id)) return
      crew.push({
        key: keyOf(x.key, `${key}:c${j}`),
        crew_id: (x.crew_id as string).toLowerCase(),
        name: str(x.name, 200),
        nickname: strOrNull(x.nickname, 100),
        color: typeof x.color === 'string' && COLOR_RE.test(x.color) ? x.color : '#423D36',
        role: oneOf(x.role, WED_CREW_ROLES, 'other'),
        fee: str(x.fee, 30),
        fee_paid_on: isDayKey(x.fee_paid_on) ? x.fee_paid_on : null,
        note: str(x.note, 400),
      })
    })
  }
  return {
    key,
    id,
    session_type: oneOf(o.session_type, WED_SESSION_TYPES, 'reception'),
    title: str(o.title, MAX_TITLE + 50),
    date: day(o.date),
    start_time: str(o.start_time, 8),
    end_time: str(o.end_time, 8),
    call_time: str(o.call_time, 8),
    venue_name: str(o.venue_name, MAX_VENUE_NAME + 50),
    venue_address: str(o.venue_address, MAX_VENUE_ADDRESS + 100),
    map_url: str(o.map_url, MAX_MAP_URL + 100),
    venue_contact: str(o.venue_contact, MAX_VENUE_CONTACT + 50),
    dress_code: str(o.dress_code, MAX_SESSION_LONG + 100),
    notes: str(o.notes, MAX_SESSION_LONG + 100),
    run_sheet: run,
    status: oneOf(o.status, WED_SESSION_STATUSES, 'scheduled'),
    crew,
  }
}

/** ฟอร์มที่เก็บไว้ (ตรวจทุกช่อง — ค่าแปลก = ค่าเริ่มต้น) ; อ่านไม่ได้ → null */
export function readStoredDraftValue(raw: unknown, holdHours: number): WedDraft | null {
  const o = asObj(raw)
  if (!o) return null
  const base = emptyDraft(holdHours)
  const nc = asObj(o.newCustomer) ?? {}
  const sessions: SessionDraft[] = []
  if (Array.isArray(o.sessions)) {
    o.sessions.slice(0, MAX_WED_SESSIONS).forEach((r, i) => {
      const s = readSession(r, i)
      if (s) sessions.push(s)
    })
  }
  const plan: PlanItemDraft[] = []
  if (Array.isArray(o.plan)) {
    o.plan.slice(0, MAX_PACKAGE_DELIVERABLES).forEach((r, i) => {
      const x = asObj(r)
      if (x) plan.push({ key: keyOf(x.key, `p${i}`), name: str(x.name, 200), qty: str(x.qty, 12), unit: str(x.unit, 60), due_days: str(x.due_days, 6) })
    })
  }
  const addons: AddonDraft[] = []
  if (Array.isArray(o.addons)) {
    o.addons.slice(0, MAX_ADDONS).forEach((r, i) => {
      const x = asObj(r)
      if (!x) return
      addons.push({
        key: keyOf(x.key, `a${i}`),
        id: null,   // สร้างใหม่เท่านั้นที่เก็บฟอร์มไว้ — ไม่มีแถวเดิม
        addon_id: isUuid(x.addon_id) ? (x.addon_id as string).toLowerCase() : null,
        name: str(x.name, 200),
        qty: str(x.qty, 12),
        unit_price: str(x.unit_price, 30),
        unit: str(x.unit, 60),
      })
    })
  }
  const status: CreateStatus = o.status === 'hold' || o.status === 'confirmed' ? o.status : 'inquiry'
  const pay: PayMode = o.payMode === 'deposit' || o.payMode === 'full' || o.payMode === 'custom' ? o.payMode : 'none'
  return {
    ...base,
    customerMode: o.customerMode === 'new' ? 'new' : 'existing',
    customer: readCustomerLite(o.customer),
    newCustomer: {
      name: str(nc.name, 200),
      partner_name: str(nc.partner_name, 200),
      phone: str(nc.phone, 40),
      phone2: str(nc.phone2, 40),
      line_id: str(nc.line_id, 100),
      instagram: str(nc.instagram, 200),
      facebook: str(nc.facebook, 300),
      email: str(nc.email, 200),
      address: str(nc.address, MAX_CUST_ADDRESS + 100),
      note: str(nc.note, MAX_CUST_NOTE + 100),
    },
    coupleNames: str(o.coupleNames, MAX_COUPLE + 50),
    source: oneOf(o.source, WED_SOURCES, base.source),
    status,
    holdHours: str(o.holdHours, 6) || base.holdHours,
    sessions: sessions.length > 0 ? sessions : base.sessions,
    packageMode: o.packageMode === 'custom' ? 'custom' : 'catalog',
    packageId: isUuid(o.packageId) ? (o.packageId as string).toLowerCase() : null,
    pkgCustomize: o.pkgCustomize === true,
    pkgName: str(o.pkgName, MAX_PKG_NAME + 50),
    pkgPrice: str(o.pkgPrice, 30),
    pkgHours: str(o.pkgHours, 10),
    pkgDescription: str(o.pkgDescription, MAX_PKG_DESC + 100),
    plan,
    addons,
    travelFee: str(o.travelFee, 30),
    discount: str(o.discount, 30),
    discountNote: str(o.discountNote, MAX_DISCOUNT_NOTE + 50),
    depositOverride: str(o.depositOverride, 30),
    balanceDueOverride: day(o.balanceDueOverride),
    followupDate: day(o.followupDate),
    followupNote: str(o.followupNote, MAX_FOLLOWUP_NOTE + 50),
    coordinatorName: str(o.coordinatorName, MAX_COORD_NAME + 50),
    coordinatorPhone: str(o.coordinatorPhone, MAX_COORD_PHONE + 20),
    moodLink: str(o.moodLink, MAX_MOOD + 100),
    customerNote: str(o.customerNote, MAX_CUSTOMER_NOTE + 100),
    note: str(o.note, MAX_NOTE + 100),
    payMode: pay,
    payAmount: str(o.payAmount, 30),
    payMethod: oneOf(o.payMethod, WED_PAYMENT_METHODS, base.payMethod),
    payNote: str(o.payNote, MAX_PAY_NOTE + 50),
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
  let draft: WedDraft | null = null
  try {
    draft = o.draft ? readStoredDraftValue(o.draft, holdHours) : null
  } catch {
    draft = null
  }
  return {
    v: 1,
    cid: (o.cid as string).toLowerCase(),
    inflight: o.inflight === true,
    sigs: Array.isArray(o.sigs)
      ? (o.sigs as unknown[]).filter((x): x is string => typeof x === 'string' && x.length <= 40).slice(-MAX_SENT_SIGS)
      : [],
    savedAt: numOr(o.savedAt, 0),
    draft,
  }
}

/** ฟอร์มนี้มีอะไรที่ผู้ใช้กรอกไว้แล้วหรือยัง (ไม่มี = ไม่ต้องกู้คืน/ไม่ต้องเตือน) */
export function draftHasContent(d: WedDraft): boolean {
  if (d.customer || d.newCustomer.name.trim() || d.newCustomer.phone.trim() || d.coupleNames.trim()) return true
  if (d.packageId || d.addons.length > 0 || d.travelFee.trim() || d.discount.trim() || d.depositOverride.trim()) return true
  return d.sessions.some(s => s.date !== '' || s.venue_name.trim() !== '' || s.crew.length > 0 || s.start_time !== '' || s.title.trim() !== '')
}

// ---------------------------------------------------------------------------
// แก้ไขแล้วไม่รู้ผล: งานล่าสุดตรงกับข้อมูลที่ส่งไปหรือไม่ (ตรง = การบันทึกของเราเองผ่านแล้ว ไม่ใช่เครื่องอื่นแก้)
// ---------------------------------------------------------------------------
const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null)
const sameMoney = (a: unknown, b: unknown) =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.005 : same(a, b)

export function bookingMatchesEdit(latest: WedBooking, payload: Record<string, unknown>): boolean {
  if (latest.couple_names.trim() !== String(payload.couple_names ?? '').trim()) return false
  if ('source' in payload && !same(latest.source, payload.source)) return false
  if (typeof payload.customer_id === 'string') {
    if (latest.customer.id !== payload.customer_id) return false
  } else {
    const c = asObj(payload.customer)
    if (!c || phoneDigits(latest.customer.phone) !== c.phone) return false
    if (typeof c.name === 'string' && latest.customer.name.trim() !== c.name.trim()) return false
  }
  if ('package_id' in payload && !same(latest.package.id, payload.package_id)) return false
  if ('package_name' in payload && !same(latest.package.name || null, payload.package_name)) return false
  if ('package_price' in payload && !sameMoney(latest.package.price, payload.package_price)) return false
  if (!sameMoney(latest.travel_fee, payload.travel_fee) || !sameMoney(latest.discount, payload.discount)) return false
  if ('deposit_override' in payload && !sameMoney(latest.money.deposit_override, payload.deposit_override)) return false
  if (!same(latest.followup_date, payload.followup_date) || !same(latest.followup_note, payload.followup_note)) return false
  if (!same(latest.coordinator_name, payload.coordinator_name) || !same(latest.coordinator_phone, payload.coordinator_phone)) return false
  // ลิงก์ผ่าน URL() ทั้งสองฝั่ง (ฐานข้อมูลเก็บตามที่ส่ง ตัวอ่านแปลงเป็นรูปมาตรฐาน)
  if (!same(latest.mood_link, payload.mood_link ? safeHttpUrl(payload.mood_link) : null)) return false
  if (!same(latest.customer_note, payload.customer_note) || !same(latest.note, payload.note)) return false
  const sessions = Array.isArray(payload.sessions) ? (payload.sessions as Obj[]) : []
  if (sessions.length !== latest.sessions.length) return false
  for (let i = 0; i < sessions.length; i++) {
    const p = sessions[i]
    const s = latest.sessions[i]
    if (typeof p.id === 'string' && p.id !== s.id) return false
    if (!same(s.session_type, p.session_type) || !same(s.date, p.date) || !same(s.title, p.title)) return false
    if (!same(s.start_time, p.start_time) || !same(s.end_time, p.end_time) || !same(s.call_time, p.call_time)) return false
    if (!same(s.venue_name, p.venue_name) || !same(s.status, p.status)) return false
    const crew = Array.isArray(p.crew) ? (p.crew as Obj[]) : []
    if (crew.length !== s.crew.length) return false
    const ids = new Set(s.crew.map(c => c.crew_id))
    if (!crew.every(c => typeof c.crew_id === 'string' && ids.has(c.crew_id))) return false
  }
  const addons = Array.isArray(payload.addons) ? (payload.addons as Obj[]) : []
  if (addons.length !== latest.addons.length) return false
  for (let i = 0; i < addons.length; i++) {
    const p = addons[i]
    const a = latest.addons[i]
    // เทียบยอดของแถว (จำนวน × ราคาต่อหน่วย) แทนจำนวนตรงๆ — จำนวนทศนิยมจากตัวอ่านอาจถูกปัด แต่ยอดแถวมาจากฐานข้อมูลเสมอ
    const qty = typeof p.qty === 'number' ? p.qty : NaN
    const price = typeof p.unit_price === 'number' ? p.unit_price : NaN
    if (a.name.trim() !== String(p.name ?? '').trim() || !sameMoney(a.unit_price, price)) return false
    if (!Number.isFinite(qty) || !sameMoney(a.amount, round2(qty * price))) return false
  }
  return true
}

/** รายการแพ็กเกจที่แสดงในฟอร์ม: ใช้งานอยู่ + ตัวที่งานนี้เลือกไว้ (แม้ปิดใช้งานแล้ว) */
export function visiblePackages(all: readonly WedPackage[], selectedId: string | null): WedPackage[] {
  return all.filter(p => p.is_active || p.id === selectedId)
}

// ---------------------------------------------------------------------------
// payload ทั้งก้อนที่ส่ง RPC (ฟอร์มใช้ชุดนี้ชุดเดียว — ลำดับคีย์คงที่ ใช้ทำลายเซ็นข้อมูลที่ส่ง)
// ---------------------------------------------------------------------------
/** ลูกค้าของงาน: เลือกจากในระบบ = customer_id / ลูกค้าใหม่ = customer (ฐานข้อมูลสร้างให้ตอนบันทึก) */
export function customerPartOf(d: WedDraft): Record<string, unknown> {
  if (d.customerMode === 'existing' && d.customer) return { customer_id: d.customer.id }
  return { customer: customerPayload(d.newCustomer, d.source) }
}

/** wed_quote: ส่วนหลักของงาน + สถานะ (สร้างใหม่) หรือ booking_id (แก้ไข — ฐานข้อมูลใช้ยอดที่รับแล้ว/ค่าใช้จ่ายเพิ่มของงานเดิม) */
export function quotePayloadOf(core: CoreCheck, mode: FormMode, status: CreateStatus, bookingId: string | null): Record<string, unknown> {
  const p: Record<string, unknown> = { ...core.payload }
  if (mode === 'create') p.status = status
  else if (bookingId) p.booking_id = bookingId
  return p
}

/** wed_create_booking (p_payload) */
export function createPayloadOf(d: WedDraft, core: CoreCheck, plan: PaymentPlan, force: boolean): Record<string, unknown> {
  const p: Record<string, unknown> = { ...customerPartOf(d), ...core.payload, source: d.source, status: d.status }
  if (d.status === 'hold') p.hold_hours = holdHoursValue(d.holdHours)
  if (plan.payments.length > 0) {
    p.payments = plan.payments.map(x => {
      const o: Record<string, unknown> = { kind: x.kind, method: x.method, amount: x.amount }
      if (x.purpose) o.purpose = x.purpose
      if (x.note) o.note = x.note
      return o
    })
  }
  if (force) p.force = true
  return p
}

/** wed_update_booking (p_payload ก่อนเติม client_id) — คีย์ที่ส่ง = แทนค่าเดิม (คิว/บริการเสริม = รายการทั้งหมด) */
export function updateBodyOf(d: WedDraft, core: CoreCheck, force: boolean): Record<string, unknown> {
  const p: Record<string, unknown> = { ...customerPartOf(d), ...core.payload, source: d.source }
  if (force) p.force = true
  return p
}
