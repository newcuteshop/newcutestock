// ===== ตัวช่วยค้นหาลูกค้า/งาน ร้าน b.oncloud (ใช้ทั้งฟอร์มงานและหน้ารายการงาน) =====
// ค้นตรงจากตาราง wed_customers (RLS: พนักงาน b.oncloud อ่านได้) — คำค้นล้างอักขระพิเศษก่อนใส่ตัวกรอง .or() ของ PostgREST
// ตัวล้างคำค้น (ชื่อ/เลขที่/เบอร์) ใช้ชุดเดียวกับร้านเช่าชุด (กติกาของ PostgREST เหมือนกัน)
import { cleanBookingNoTerm, cleanNameTerm, phoneTerm } from '@/components/rental/booking-form/search'
import type { BrowserSupabase } from '@/lib/products'
import { WED_SOURCES, type WedSource } from '@/lib/wedding'
import { isUuid, type CustomerLite } from './model'

export { cleanBookingNoTerm, cleanNameTerm, phoneTerm }

/** คอลัมน์ลูกค้าที่ฟอร์มงานใช้ */
export const CUSTOMER_LITE_COLUMNS = 'id, name, partner_name, phone, phone2, line_id, instagram, facebook, source'

/** ตัวกรอง .or() สำหรับค้นลูกค้าด้วยเบอร์โทร / ชื่อ / ชื่อคู่ / LINE / IG ; คำค้นใช้ไม่ได้ → null */
export function customerOrFilter(raw: string): string | null {
  const digits = phoneTerm(raw)
  if (digits) return `phone.ilike.%${digits}%,phone2.ilike.%${digits}%`
  const name = cleanNameTerm(raw)
  if (name.length < 1) return null
  return `name.ilike.%${name}%,partner_name.ilike.%${name}%,line_id.ilike.%${name}%,instagram.ilike.%${name}%`
}

type Obj = Record<string, unknown>

/** แถวตาราง wed_customers → CustomerLite ; ไม่มี id → null */
export function toCustomerLite(raw: unknown): CustomerLite | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Obj
  if (!isUuid(o.id)) return null
  const s = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null)
  return {
    id: (o.id as string).toLowerCase(),
    name: typeof o.name === 'string' ? o.name : '',
    partner_name: s(o.partner_name),
    phone: typeof o.phone === 'string' ? o.phone : '',
    phone2: s(o.phone2),
    line_id: s(o.line_id),
    instagram: s(o.instagram),
    facebook: s(o.facebook),
    source: typeof o.source === 'string' && (WED_SOURCES as readonly string[]).includes(o.source) ? (o.source as WedSource) : null,
  }
}

function toList(data: unknown): CustomerLite[] {
  const out: CustomerLite[] = []
  for (const r of (Array.isArray(data) ? data : []) as unknown[]) {
    const c = toCustomerLite(r)
    if (c) out.push(c)
  }
  return out
}

/** ลูกค้าที่แก้ไขล่าสุด (คำค้นว่าง) */
export async function recentCustomers(supabase: BrowserSupabase, limit = 8, signal?: AbortSignal): Promise<CustomerLite[]> {
  let q = supabase.from('wed_customers').select(CUSTOMER_LITE_COLUMNS).order('updated_at', { ascending: false }).limit(limit)
  if (signal) q = q.abortSignal(signal)
  const { data, error } = await q
  if (error) throw error
  return toList(data)
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
    .from('wed_customers')
    .select(CUSTOMER_LITE_COLUMNS)
    .or(filter)
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (signal) q = q.abortSignal(signal)
  const { data, error } = await q
  if (error) throw error
  return toList(data)
}

/** ลูกค้าที่ใช้เบอร์นี้อยู่แล้ว (ตรงตัว เบอร์หลักหรือเบอร์สำรอง) — กันสร้างลูกค้าซ้ำ */
export async function customersByPhone(
  supabase: BrowserSupabase,
  digits: string,
  limit = 3,
  signal?: AbortSignal,
): Promise<CustomerLite[]> {
  if (!/^\d{9,15}$/.test(digits)) return []
  let q = supabase
    .from('wed_customers')
    .select(CUSTOMER_LITE_COLUMNS)
    .or(`phone.eq.${digits},phone2.eq.${digits}`)
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (signal) q = q.abortSignal(signal)
  const { data, error } = await q
  if (error) throw error
  return toList(data)
}

/** รหัสลูกค้าที่ตรงคำค้น (ใช้ค้นงานด้วยชื่อ/เบอร์ลูกค้า) */
export async function searchCustomerIds(supabase: BrowserSupabase, raw: string, limit = 100, signal?: AbortSignal): Promise<string[]> {
  const filter = customerOrFilter(raw)
  if (!filter) return []
  let q = supabase.from('wed_customers').select('id').or(filter).limit(limit)
  if (signal) q = q.abortSignal(signal)
  const { data, error } = await q
  if (error) throw error
  const ids: string[] = []
  for (const r of (Array.isArray(data) ? data : []) as unknown[]) {
    const id = r && typeof r === 'object' ? (r as Obj).id : null
    if (isUuid(id)) ids.push(id)
  }
  return ids
}
