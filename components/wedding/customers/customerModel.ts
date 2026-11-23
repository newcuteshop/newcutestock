// ===== แบบฟอร์มลูกค้าร้าน b.oncloud: ค่าในช่อง ↔ payload ของ wed_save_customer (pure — ไม่มี hook) =====
// กติกาตรงกับฐานข้อมูล (wed_customer_write ใน supabase-fix-07-wedding.sql):
//   ชื่อผู้ติดต่อ 1-100 · ชื่อคู่ ≤ 100 · เบอร์ 9-15 หลัก (เก็บเฉพาะตัวเลข) · LINE ≤ 50 · Instagram ≤ 100 · Facebook ≤ 200
//   อีเมล ≤ 100 (รูปแบบ a@b.c) · ที่อยู่ ≤ 500 · หมายเหตุ ≤ 1000 · ช่องทางที่รู้จักร้าน 8 แบบ (WED_SOURCES)
import { phoneDigits, safeHttpUrl, type WedCustomer, type WedCustomerInput, type WedSource } from '@/lib/wedding'

export interface CustomerFields {
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
  source: WedSource
}

export type CustomerFieldKey = keyof CustomerFields

export const LIMITS = {
  name: 100,
  partner_name: 100,
  line_id: 50,
  instagram: 100,
  facebook: 200,
  email: 100,
  address: 500,
  note: 1000,
} as const

export function emptyFields(): CustomerFields {
  return {
    name: '', partner_name: '', phone: '', phone2: '', line_id: '', instagram: '', facebook: '', email: '',
    address: '', note: '', source: 'instagram',
  }
}

export function fieldsFromCustomer(c: WedCustomer): CustomerFields {
  return {
    name: c.name,
    partner_name: c.partner_name ?? '',
    phone: c.phone,
    phone2: c.phone2 ?? '',
    line_id: c.line_id ?? '',
    instagram: c.instagram ?? '',
    facebook: c.facebook ?? '',
    email: c.email ?? '',
    address: c.address ?? '',
    note: c.note ?? '',
    source: c.source ?? 'other',
  }
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

function tooLong(v: string, max: number, label: string): string | null {
  return v.trim().length > max ? `${label}ยาวเกินไป (สูงสุด ${max} ตัวอักษร)` : null
}

/** ตรวจค่าก่อนส่ง → {ช่อง: ข้อความ} (ว่าง = ผ่าน) */
export function validateFields(f: CustomerFields): Partial<Record<CustomerFieldKey, string>> {
  const e: Partial<Record<CustomerFieldKey, string>> = {}
  const name = f.name.trim()
  if (!name) e.name = 'กรุณากรอกชื่อผู้ติดต่อ'
  else if (name.length > LIMITS.name) e.name = `ชื่อยาวเกินไป (สูงสุด ${LIMITS.name} ตัวอักษร)`
  const checks: [CustomerFieldKey, string | null][] = [
    ['partner_name', tooLong(f.partner_name, LIMITS.partner_name, 'ชื่อคู่บ่าวสาว')],
    ['phone', phoneProblem(f.phone, 'เบอร์โทร', true)],
    ['phone2', phoneProblem(f.phone2, 'เบอร์โทรสำรอง', false)],
    ['line_id', tooLong(f.line_id, LIMITS.line_id, 'LINE ID ')],
    ['instagram', tooLong(f.instagram, LIMITS.instagram, 'Instagram ')],
    ['facebook', tooLong(f.facebook, LIMITS.facebook, 'Facebook ')],
    ['address', tooLong(f.address, LIMITS.address, 'ที่อยู่')],
    ['note', tooLong(f.note, LIMITS.note, 'หมายเหตุ')],
  ]
  for (const [k, msg] of checks) if (msg) e[k] = msg
  const email = f.email.trim()
  if (email) {
    if (email.length > LIMITS.email) e.email = `อีเมลยาวเกินไป (สูงสุด ${LIMITS.email} ตัวอักษร)`
    else if (!EMAIL_RE.test(email)) e.email = 'อีเมลไม่ถูกต้อง (เช่น name@example.com)'
  }
  return e
}

const orNull = (s: string) => {
  const t = s.trim()
  return t === '' ? null : t
}

/** payload ของ wed_save_customer — ส่งค่าที่ทำความสะอาดแล้ว (เบอร์ = ตัวเลขล้วน) ; แก้ไข = ส่งทุกช่อง (ช่องว่าง = ล้างค่า) */
export function buildPayload(
  f: CustomerFields,
  opts: { mode: 'new' | 'edit'; clientId?: string; id?: string; updatedAt?: string },
): WedCustomerInput {
  const p: WedCustomerInput = {
    name: f.name.trim(),
    partner_name: orNull(f.partner_name),
    phone: phoneDigits(f.phone),
    phone2: f.phone2.trim() ? phoneDigits(f.phone2) : null,
    line_id: orNull(f.line_id),
    // ไอจีเก็บแบบไม่มี @ นำหน้า (พิมพ์มาแบบไหนก็ได้ผลเดียวกัน → ค้นหาเจอ)
    instagram: orNull(f.instagram.trim().replace(/^@+/, '')),
    facebook: orNull(f.facebook),
    email: orNull(f.email),
    address: orNull(f.address),
    note: orNull(f.note),
    source: f.source,
  }
  if (opts.mode === 'new') {
    p.client_id = opts.clientId ?? null
  } else {
    p.id = opts.id ?? null
    if (opts.updatedAt) p.updated_at = opts.updatedAt
  }
  return p
}

/** ข้อมูลในฐานข้อมูลตรงกับที่ส่งไปหรือไม่ (ใช้ตอน "ไม่รู้ผล" — โหลดใหม่แล้วเทียบ) */
export function matchesPayload(c: WedCustomer, p: WedCustomerInput): boolean {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v))
  const same = (a: unknown, b: unknown) => s(a) === s(b)
  return same(c.name, p.name) && same(c.partner_name, p.partner_name) && same(c.phone, p.phone) &&
    same(c.phone2, p.phone2) && same(c.line_id, p.line_id) && same(c.instagram, p.instagram) &&
    same(c.facebook, p.facebook) && same(c.email, p.email) && same(c.address, p.address) &&
    same(c.note, p.note) && same(c.source ?? 'other', p.source ?? 'other')
}

/** คำค้นลูกค้าที่ปลอดภัยสำหรับตัวกรอง or=() ของ PostgREST (ตัดอักขระพิเศษ , ( ) " \ % * :) */
export function cleanCustomerSearch(raw: string): { text: string; digits: string } {
  const text = String(raw ?? '').replace(/[,()"\\%*:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
  // พิมพ์เป็นเบอร์ (ตัวเลข/ขีด/ช่องว่างล้วน อย่างน้อย 3 หลัก) → ค้นจากเบอร์
  const digits = /^[0-9๐-๙ ()+.-]+$/.test(text) ? phoneDigits(text) : ''
  return { text: text.replace(/^@+/, ''), digits: digits.length >= 3 ? digits : '' }
}

/** ลิงก์เพิ่มเพื่อนด้วย LINE ID (ไอดีที่ขึ้นต้น @ = บัญชีทางการ ใช้ได้เหมือนกัน) */
export function lineHref(lineId: string | null | undefined): string {
  const t = String(lineId ?? '').trim()
  return t ? `https://line.me/R/ti/p/~${encodeURIComponent(t)}` : ''
}

// ชื่อบัญชีโซเชียล: ตัวอักษรอังกฤษ ตัวเลข จุด ขีดล่าง (ไม่มีช่องว่าง)
const HANDLE_RE = /^[A-Za-z0-9._]{1,60}$/

/** ลิงก์ Instagram: ลิงก์เต็ม (http/https) ใช้ตามนั้น · ชื่อบัญชี → instagram.com/<ชื่อ> · อื่นๆ → '' */
export function instagramHref(v: string | null | undefined): string {
  const t = String(v ?? '').trim()
  if (!t) return ''
  if (/^https?:\/\//i.test(t)) return safeHttpUrl(t) ?? ''
  const handle = t.replace(/^@+/, '')
  return HANDLE_RE.test(handle) ? `https://www.instagram.com/${encodeURIComponent(handle)}` : ''
}

/** ลิงก์ Facebook: ลิงก์เต็มใช้ตามนั้น · ชื่อผู้ใช้ (ไม่มีช่องว่าง) → facebook.com/<ชื่อ> · ชื่อที่มีช่องว่าง = แสดงเป็นข้อความอย่างเดียว */
export function facebookHref(v: string | null | undefined): string {
  const t = String(v ?? '').trim()
  if (!t) return ''
  if (/^https?:\/\//i.test(t)) return safeHttpUrl(t) ?? ''
  return HANDLE_RE.test(t) ? `https://www.facebook.com/${encodeURIComponent(t)}` : ''
}

/** ชื่อแสดงของลูกค้า: 'ชื่อ & คู่' (ไม่มีคู่ = ชื่ออย่างเดียว) */
export function customerTitle(c: { name: string; partner_name: string | null }): string {
  const p = (c.partner_name ?? '').trim()
  return p ? `${c.name} & ${p}` : c.name
}
