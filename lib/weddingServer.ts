// ===== ร้าน b.oncloud: โหลดค่าที่หลายหน้าใช้ร่วมกัน (หน้าเลือกร้าน /select, layout หลังร้าน /wedding/*) =====
// รับ supabase client จากผู้เรียก (server: lib/supabase/server · client: lib/supabase/client) แบบเดียวกับ loadRentalShopName
// ไม่ throw เด็ดขาด: อ่านไม่ได้ (ยังไม่รัน supabase-fix-07-wedding.sql / ไม่มีสิทธิ์ / เน็ตหลุด) → ค่าเริ่มต้น/null
// ไม่มี 'use client' และไม่ import ของฝั่งเซิร์ฟเวอร์ — ชื่อไฟล์บอกว่าใช้หลักๆ ใน server component
import type { ShopSupabase } from '@/lib/shop'
import { isMigrationMissing } from '@/lib/migration'
import {
  DEFAULT_WEDDING_SETTINGS,
  DEFAULT_WEDDING_SHOP_NAME,
  parseWedBadges,
  parseWeddingSettings,
  type WedBadges,
  type WedSettings,
} from '@/lib/wedding'

/**
 * ชื่อร้านจาก wed_settings.shop_name (ห้าม hardcode ชื่อร้าน) — อ่านไม่ได้ → DEFAULT_WEDDING_SHOP_NAME
 * อ่านจากตาราง (นโยบาย select = wed_staff()) — ผู้ใช้ที่ไม่มีสิทธิ์ร้านนี้ได้แถวว่าง = ชื่อเริ่มต้น
 */
export async function loadWeddingShopName(supabase: ShopSupabase): Promise<string> {
  try {
    const { data, error } = await supabase.from('wed_settings').select('shop_name').limit(1).maybeSingle()
    if (error || !data) return DEFAULT_WEDDING_SHOP_NAME
    const raw = (data as Record<string, unknown>).shop_name
    const name = typeof raw === 'string' ? raw.trim() : ''
    return name || DEFAULT_WEDDING_SHOP_NAME
  } catch {
    return DEFAULT_WEDDING_SHOP_NAME
  }
}

/** ตัวเลขบนเมนู (wed_badges) — อ่านไม่ได้ → null (ไม่แสดงตัวเลข) */
export async function loadWeddingBadges(supabase: ShopSupabase): Promise<WedBadges | null> {
  try {
    const { data, error } = await supabase.rpc('wed_badges')
    if (error) return null
    return parseWedBadges(data)
  } catch {
    return null
  }
}

/**
 * ตั้งค่าร้านทั้งชุด (wed_get_settings) — settings โหลดไม่ได้ = ค่าเริ่มต้น
 * missing = true เมื่อฐานข้อมูลยังไม่ได้รัน supabase-fix-07-wedding.sql (หน้าใช้แสดง MigrationNotice + FIX07_MISSING_MSG)
 * error = ข้อผิดพลาดอื่น (สิทธิ์ / เน็ตหลุด) ไว้ให้หน้าตัดสินใจเองว่าจะแจ้งหรือใช้ค่าเริ่มต้นต่อ
 */
export async function loadWeddingSettings(
  supabase: ShopSupabase,
): Promise<{ settings: WedSettings; missing: boolean; error: unknown | null }> {
  try {
    const { data, error } = await supabase.rpc('wed_get_settings')
    if (error) {
      return { settings: { ...DEFAULT_WEDDING_SETTINGS, bank_accounts: [] }, missing: isMigrationMissing(error), error }
    }
    return { settings: parseWeddingSettings(data), missing: false, error: null }
  } catch (err) {
    return { settings: { ...DEFAULT_WEDDING_SETTINGS, bank_accounts: [] }, missing: isMigrationMissing(err), error: err }
  }
}
