// ===== โหลดรายการที่ฟอร์มงานใช้ (แพ็กเกจ / บริการเสริม / ทีมงาน) — เรียกจากหน้า server (สร้าง/แก้ไขงาน) =====
// ไม่ throw: โหลดส่วนไหนไม่ได้ → รายการว่าง + ข้อความไทย (ฟอร์มยังใช้ได้ เช่น ใช้ "แพ็กเกจกำหนดเอง" / จัดทีมทีหลัง)
// แพ็กเกจโหลดทั้งที่ใช้งานอยู่และปิดใช้งาน (ฟอร์มซ่อนตัวที่ปิดใช้งาน ยกเว้นตัวที่งานนี้เลือกไว้)
// ทีมงาน: wed_list_crew (ค่าตัวมาตรฐานส่งมาเฉพาะผู้จัดการ — ตาราง wed_crew พนักงานอ่านตรงไม่ได้)
import type { ShopSupabase } from '@/lib/shop'
import { thaiError } from '@/lib/format'
import { parseCrewList, parseWedAddons, parseWedPackages } from '@/lib/wedding'
import { isUuid, type CustomerLite } from './model'
import { CUSTOMER_LITE_COLUMNS, toCustomerLite } from './search'
import type { FormCatalog } from './BookingForm'

export const PACKAGE_COLUMNS = 'id, name, description, price, hours, crew_size, deliverables, is_active, sort_order, updated_at'
export const ADDON_COLUMNS = 'id, name, price, unit, description, is_active, sort_order, updated_at'

export async function loadFormCatalog(supabase: ShopSupabase): Promise<FormCatalog> {
  try {
    const [pkgRes, addonRes, crewRes] = await Promise.all([
      supabase.from('wed_packages').select(PACKAGE_COLUMNS).order('sort_order').order('name').limit(500),
      supabase.from('wed_addons').select(ADDON_COLUMNS).order('sort_order').order('name').limit(500),
      supabase.rpc('wed_list_crew'),
    ])
    const catErr = pkgRes.error ?? addonRes.error
    return {
      packages: pkgRes.error ? [] : parseWedPackages(pkgRes.data),
      addons: addonRes.error ? [] : parseWedAddons(addonRes.data),
      crew: crewRes.error ? [] : parseCrewList(crewRes.data),
      catalogError: catErr ? `โหลดรายการแพ็กเกจ/บริการเสริมไม่สำเร็จ (${thaiError(catErr)}) — โหลดหน้าใหม่อีกครั้ง หรือใช้ "กำหนดเอง"` : '',
      crewError: crewRes.error ? `โหลดรายชื่อทีมงานไม่สำเร็จ (${thaiError(crewRes.error)}) — โหลดหน้าใหม่อีกครั้ง หรือจัดทีมทีหลัง` : '',
    }
  } catch (err) {
    const msg = thaiError(err)
    return {
      packages: [],
      addons: [],
      crew: [],
      catalogError: `โหลดรายการแพ็กเกจ/บริการเสริมไม่สำเร็จ (${msg})`,
      crewError: `โหลดรายชื่อทีมงานไม่สำเร็จ (${msg})`,
    }
  }
}

/** ลูกค้าจากลิงก์ ?customer=<uuid> (หน้าลูกค้า → สร้างงานให้ลูกค้าคนนี้) ; ไม่พบ/ผิดรูปแบบ → null */
export async function loadPrefillCustomer(supabase: ShopSupabase, id: string): Promise<CustomerLite | null> {
  if (!isUuid(id)) return null
  try {
    const { data, error } = await supabase.from('wed_customers').select(CUSTOMER_LITE_COLUMNS).eq('id', id.toLowerCase()).maybeSingle()
    if (error) return null
    return toCustomerLite(data)
  } catch {
    return null
  }
}
