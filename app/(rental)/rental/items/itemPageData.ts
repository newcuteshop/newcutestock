// ข้อมูลประกอบฟอร์มชุดเช่า (หน้าเพิ่มใหม่ + หน้าชุด) — ใช้ฝั่ง server เท่านั้น
import type { createClient } from '@/lib/supabase/server'
import { thaiError } from '@/lib/format'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { isMigrationMissing } from '@/lib/migration'
import {
  DEFAULT_RENTAL_SETTINGS, parseRentalCategories, parseRentalSettings,
  type RentalCategory, type RentalSettings,
} from '@/lib/rental'

type ServerSupabase = ReturnType<typeof createClient>

/**
 * หมวด + ตั้งค่าร้าน (วันเช่าเริ่มต้น / วันกันก่อน-หลัง) + รหัสของชุดอื่นทั้งหมด (เช็กรหัสซ้ำ/แนะนำรหัสถัดไป)
 * ยังไม่ได้รัน fix-05 → throw error เดิม (ผู้เรียกเช็ก isMigrationMissing แล้วแสดง MigrationNotice)
 * อ่านตั้งค่าร้านไม่ได้ด้วยเหตุอื่น → ใช้ค่าเริ่มต้น (ฟอร์มยังใช้ได้ ฐานข้อมูลใช้ค่าจริงตอนบันทึก)
 */
export async function loadItemFormData(
  supabase: ServerSupabase,
  excludeItemId: string | null,
): Promise<{ categories: RentalCategory[]; settings: RentalSettings; otherCodes: string[] }> {
  const [catRes, settingsRes, codeRows] = await Promise.all([
    supabase.from('rental_categories').select('id, name, sort_order, is_active, created_at').order('sort_order').order('name'),
    supabase.rpc('rental_get_settings'),
    fetchAllRows<{ id: unknown; code: unknown }>((from, to) =>
      supabase.from('rental_items').select('id, code').order('id').range(from, to)),
  ])
  if (catRes.error) {
    if (isMigrationMissing(catRes.error)) throw catRes.error
    throw new Error(thaiError(catRes.error))
  }
  const settings = settingsRes.error ? { ...DEFAULT_RENTAL_SETTINGS, bank_accounts: [] } : parseRentalSettings(settingsRes.data)
  const otherCodes = codeRows
    .filter(r => typeof r.code === 'string' && String(r.id) !== excludeItemId)
    .map(r => String(r.code))
  return { categories: parseRentalCategories(catRes.data ?? []), settings, otherCodes }
}
