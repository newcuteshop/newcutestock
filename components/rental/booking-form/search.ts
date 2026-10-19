// ===== ตัวช่วยค้นหาลูกค้า/การจอง (ใช้ทั้งฟอร์มการจองและหน้ารายการการจอง) =====
// ค้นตรงจากตาราง (RLS: พนักงานร้านเช่าอ่านได้) — คำค้นต้องล้างอักขระพิเศษก่อนใส่ในตัวกรอง .or() ของ PostgREST
// (จุลภาค/วงเล็บ/เครื่องหมายคำพูดทำให้รูปแบบตัวกรองพัง · % _ * เป็นอักขระพิเศษของ ilike)
import { phoneDigits } from '@/lib/rental'
import type { BrowserSupabase } from '@/lib/products'
import type { CustomerLite } from './model'

/** คอลัมน์ลูกค้าที่ฟอร์มการจองใช้ */
export const CUSTOMER_LITE_COLUMNS = 'id, name, phone, phone2, line_id, id_card_no, is_blacklisted, blacklist_reason'

/** คำค้นชื่อ/LINE: ตัดอักขระที่ใช้ในรูปแบบตัวกรองออก เหลือไม่เกิน 60 ตัว ; ว่าง → '' */
export function cleanNameTerm(raw: string): string {
  return raw
    .replace(/[%_*,()"'\\:;{}[\]<>|^`~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

/**
 * คำค้นเลขที่การจอง → A-Z 0-9 - (เช่น RT-20261018-001 หรือ 001) ; มีอักษรไทย = ค้นชื่อลูกค้า ไม่ใช่เลขที่การจอง → ''
 * (ไม่แปลงแป้นภาษาไทยกลับเป็นอังกฤษแบบช่องสแกน: ชื่ออย่าง "ภูมิ" จะกลายเป็นตัวเลขแล้วไปตรงกับเลขที่การจองมั่วๆ)
 */
export function cleanBookingNoTerm(raw: string): string {
  if (/[฀-๿]/.test(raw)) return ''
  return raw.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40)
}

/** คำค้นที่เป็นเบอร์โทร (ตัวเลข/ขีด/ช่องว่าง ≥ 3 หลัก) → ตัวเลขล้วน ; ไม่ใช่ → '' */
export function phoneTerm(raw: string): string {
  const t = raw.trim()
  if (!/^[0-9๐-๙ ()+.-]+$/.test(t)) return ''
  const d = phoneDigits(t)
  return d.length >= 3 ? d.slice(0, 15) : ''
}

/** ตัวกรอง .or() สำหรับค้นลูกค้าด้วยเบอร์โทร/ชื่อ/LINE ID ; คำค้นใช้ไม่ได้ → null */
export function customerOrFilter(raw: string): string | null {
  const digits = phoneTerm(raw)
  if (digits) return `phone.ilike.%${digits}%,phone2.ilike.%${digits}%`
  const name = cleanNameTerm(raw)
  if (name.length < 1) return null
  return `name.ilike.%${name}%,line_id.ilike.%${name}%`
}

type Obj = Record<string, unknown>

/** แถวตาราง rental_customers → CustomerLite ; ไม่มี id → null */
export function toCustomerLite(raw: unknown): CustomerLite | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Obj
  const id = typeof o.id === 'string' ? o.id : ''
  if (!id) return null
  const s = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null)
  return {
    id,
    name: typeof o.name === 'string' ? o.name : '',
    phone: typeof o.phone === 'string' ? o.phone : '',
    phone2: s(o.phone2),
    line_id: s(o.line_id),
    id_card_no: s(o.id_card_no),
    is_blacklisted: o.is_blacklisted === true,
    blacklist_reason: s(o.blacklist_reason),
  }
}

/** ค้นลูกค้า (ล่าสุดที่แก้ไขก่อน) — คำค้นใช้ไม่ได้ → [] ; error → throw (ผู้เรียกแปลงเป็นข้อความไทย) */
export async function searchCustomers(
  supabase: BrowserSupabase,
  raw: string,
  limit = 20,
  signal?: AbortSignal,
): Promise<CustomerLite[]> {
  const filter = customerOrFilter(raw)
  if (!filter) return []
  let q = supabase
    .from('rental_customers')
    .select(CUSTOMER_LITE_COLUMNS)
    .or(filter)
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (signal) q = q.abortSignal(signal)
  const { data, error } = await q
  if (error) throw error
  const out: CustomerLite[] = []
  for (const r of (data ?? []) as unknown[]) {
    const c = toCustomerLite(r)
    if (c) out.push(c)
  }
  return out
}

/** รหัสลูกค้าที่ตรงคำค้น (ใช้ค้นการจองด้วยชื่อ/เบอร์ลูกค้า) */
export async function searchCustomerIds(supabase: BrowserSupabase, raw: string, limit = 100, signal?: AbortSignal): Promise<string[]> {
  const filter = customerOrFilter(raw)
  if (!filter) return []
  let q = supabase.from('rental_customers').select('id').or(filter).limit(limit)
  if (signal) q = q.abortSignal(signal)
  const { data, error } = await q
  if (error) throw error
  const ids: string[] = []
  for (const r of (data ?? []) as unknown[]) {
    const id = r && typeof r === 'object' ? (r as Obj).id : null
    if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) ids.push(id)
  }
  return ids
}
