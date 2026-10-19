// ===== แบบฟอร์มลูกค้าร้านเช่าชุด: ค่าในช่อง ↔ payload ของ rental_save_customer (pure — ไม่มี hook) =====
// กติกาตรงกับฐานข้อมูล (rental_customer_write): ชื่อ 1-100 · เบอร์ 9-15 หลัก (เก็บเฉพาะตัวเลข) · LINE ≤ 50 · อีเมล ≤ 100
// เลขบัตร/พาสปอร์ต A-Z 0-9 ≤ 30 (ตัดช่องว่าง/ขีด, ตัวพิมพ์ใหญ่) · ที่อยู่ ≤ 500 · หมายเหตุ ≤ 1000 · เหตุผลบัญชีดำ ≤ 200
import { phoneDigits, type RentalCustomer, type RentalSource } from '@/lib/rental'

export interface CustomerFields {
  name: string
  phone: string
  phone2: string
  line_id: string
  email: string
  id_card_no: string
  address: string
  note: string
  source: RentalSource
  is_blacklisted: boolean
  blacklist_reason: string
}

export type CustomerFieldKey = keyof CustomerFields

export const LIMITS = {
  name: 100,
  line_id: 50,
  email: 100,
  id_card_no: 30,
  address: 500,
  note: 1000,
  blacklist_reason: 200,
} as const

/** ช่องทางที่พนักงานเลือกได้ตอนเพิ่มลูกค้าเอง ('online' = ระบบตั้งให้จากหน้าจองออนไลน์) */
export const STAFF_SOURCES: readonly RentalSource[] = ['walkin', 'phone', 'line', 'other'] as const

export function emptyFields(): CustomerFields {
  return {
    name: '', phone: '', phone2: '', line_id: '', email: '', id_card_no: '', address: '', note: '',
    source: 'walkin', is_blacklisted: false, blacklist_reason: '',
  }
}

export function fieldsFromCustomer(c: RentalCustomer): CustomerFields {
  return {
    name: c.name,
    phone: c.phone,
    phone2: c.phone2 ?? '',
    line_id: c.line_id ?? '',
    email: c.email ?? '',
    id_card_no: c.id_card_no ?? '',
    address: c.address ?? '',
    note: c.note ?? '',
    source: c.source,
    is_blacklisted: c.is_blacklisted,
    blacklist_reason: c.blacklist_reason ?? '',
  }
}

/** เลขบัตร/พาสปอร์ตแบบที่ฐานข้อมูลเก็บ (ตัดช่องว่าง/ขีด + ตัวพิมพ์ใหญ่ + เลขไทย → อารบิก) */
export function normalizeIdCard(v: string): string {
  return String(v ?? '')
    .replace(/[๐-๙]/g, ch => String(ch.charCodeAt(0) - 0x0e50))
    .replace(/[\s-]/g, '')
    .toUpperCase()
}

/** เลขบัตรประชาชนไทย 13 หลักผ่านการตรวจหลักสุดท้าย (mod 11) หรือไม่ — ใช้เตือนเท่านั้น (พาสปอร์ตไม่ตรวจ) */
export function thaiIdChecksumOk(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return true
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i)
  return (11 - (sum % 11)) % 10 === Number(id[12])
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const PHONE_CHARS_RE = /^[0-9๐-๙ ()+.-]+$/

function phoneProblem(raw: string, label: string, required: boolean): string | null {
  const t = raw.trim()
  if (!t) return required ? `กรุณากรอก${label}` : null
  if (!PHONE_CHARS_RE.test(t)) return `${label}ใส่ได้เฉพาะตัวเลข`
  const d = phoneDigits(t)
  if (d.length < 9 || d.length > 15) return `${label}ต้องเป็นตัวเลข 9-15 หลัก`
  return null
}

/** ตรวจค่าก่อนส่ง → {ช่อง: ข้อความ} (ว่าง = ผ่าน) */
export function validateFields(f: CustomerFields, opts: { canManage: boolean }): Partial<Record<CustomerFieldKey, string>> {
  const e: Partial<Record<CustomerFieldKey, string>> = {}
  const name = f.name.trim()
  if (!name) e.name = 'กรุณากรอกชื่อลูกค้า'
  else if (name.length > LIMITS.name) e.name = `ชื่อยาวเกินไป (สูงสุด ${LIMITS.name} ตัวอักษร)`
  const p1 = phoneProblem(f.phone, 'เบอร์โทร', true)
  if (p1) e.phone = p1
  const p2 = phoneProblem(f.phone2, 'เบอร์โทรสำรอง', false)
  if (p2) e.phone2 = p2
  if (f.line_id.trim().length > LIMITS.line_id) e.line_id = `LINE ID ยาวเกินไป (สูงสุด ${LIMITS.line_id} ตัวอักษร)`
  const email = f.email.trim()
  if (email) {
    if (email.length > LIMITS.email) e.email = `อีเมลยาวเกินไป (สูงสุด ${LIMITS.email} ตัวอักษร)`
    else if (!EMAIL_RE.test(email)) e.email = 'อีเมลไม่ถูกต้อง (เช่น name@example.com)'
  }
  const id = normalizeIdCard(f.id_card_no)
  if (id) {
    if (!/^[A-Z0-9]+$/.test(id)) e.id_card_no = 'เลขบัตรประชาชน/พาสปอร์ตใส่ได้เฉพาะตัวอักษรอังกฤษและตัวเลข'
    else if (id.length > LIMITS.id_card_no) e.id_card_no = `เลขบัตรประชาชน/พาสปอร์ตยาวเกินไป (สูงสุด ${LIMITS.id_card_no} ตัว)`
  }
  if (f.address.trim().length > LIMITS.address) e.address = `ที่อยู่ยาวเกินไป (สูงสุด ${LIMITS.address} ตัวอักษร)`
  if (f.note.trim().length > LIMITS.note) e.note = `หมายเหตุยาวเกินไป (สูงสุด ${LIMITS.note} ตัวอักษร)`
  if (opts.canManage && f.is_blacklisted) {
    const r = f.blacklist_reason.trim()
    if (!r) e.blacklist_reason = 'กรุณาระบุเหตุผลที่ติดบัญชีดำ (พนักงานคนอื่นจะเห็นตอนจอง)'
    else if (r.length > LIMITS.blacklist_reason) e.blacklist_reason = `เหตุผลยาวเกินไป (สูงสุด ${LIMITS.blacklist_reason} ตัวอักษร)`
  }
  return e
}

const orNull = (s: string) => {
  const t = s.trim()
  return t === '' ? null : t
}

/**
 * payload ของ rental_save_customer — ส่งค่าที่ทำความสะอาดแล้ว (เบอร์ = ตัวเลขล้วน, เลขบัตร = ตัวพิมพ์ใหญ่ไม่มีขีด)
 * ช่องบัญชีดำส่งเฉพาะผู้จัดการ (พนักงานส่งมา = ฐานข้อมูลปฏิเสธเมื่อค่าเปลี่ยน)
 */
export function buildPayload(
  f: CustomerFields,
  opts: { mode: 'new' | 'edit'; canManage: boolean; clientId?: string; id?: string; updatedAt?: string },
): Record<string, unknown> {
  const p: Record<string, unknown> = {
    name: f.name.trim(),
    phone: phoneDigits(f.phone),
    phone2: f.phone2.trim() ? phoneDigits(f.phone2) : null,
    line_id: orNull(f.line_id),
    email: orNull(f.email),
    id_card_no: orNull(normalizeIdCard(f.id_card_no)),
    address: orNull(f.address),
    note: orNull(f.note),
  }
  if (opts.mode === 'new') {
    p.client_id = opts.clientId
    p.source = f.source
  } else {
    p.id = opts.id
    if (opts.updatedAt) p.updated_at = opts.updatedAt
  }
  if (opts.canManage) {
    p.is_blacklisted = f.is_blacklisted
    p.blacklist_reason = f.is_blacklisted ? orNull(f.blacklist_reason) : null
  }
  return p
}

/** ข้อมูลในฐานข้อมูลตรงกับที่ส่งไปหรือไม่ (ใช้ตอน "ไม่รู้ผล" — โหลดใหม่แล้วเทียบ) */
export function matchesPayload(c: RentalCustomer, p: Record<string, unknown>): boolean {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v))
  const same = (a: unknown, b: unknown) => s(a) === s(b)
  if (!same(c.name, p.name) || !same(c.phone, p.phone) || !same(c.phone2, p.phone2)) return false
  if (!same(c.line_id, p.line_id) || !same(c.email, p.email) || !same(c.id_card_no, p.id_card_no)) return false
  if (!same(c.address, p.address) || !same(c.note, p.note)) return false
  if ('is_blacklisted' in p) {
    if (c.is_blacklisted !== p.is_blacklisted) return false
    if (c.is_blacklisted && !same(c.blacklist_reason, p.blacklist_reason)) return false
  }
  return true
}

/** คำค้นลูกค้าที่ปลอดภัยสำหรับตัวกรอง or=() ของ PostgREST (ตัดอักขระพิเศษ , ( ) " \ % * :) */
export function cleanCustomerSearch(raw: string): { text: string; digits: string } {
  const text = String(raw ?? '').replace(/[,()"\\%*:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
  // พิมพ์เป็นเบอร์ (ตัวเลข/ขีด/ช่องว่างล้วน อย่างน้อย 3 หลัก) → ค้นจากเบอร์
  const digits = /^[0-9๐-๙ ()+.-]+$/.test(text) ? phoneDigits(text) : ''
  return { text, digits: digits.length >= 3 ? digits : '' }
}
