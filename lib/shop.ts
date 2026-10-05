// ===== โหลดข้อมูลร้าน/ตั้งค่าใบเสร็จ (get_shop_settings) — ใช้ได้ทั้ง server component และ client =====
// ใบเสร็จต้องพิมพ์ได้เสมอแม้โหลดข้อมูลร้านไม่สำเร็จ → error ทุกแบบได้ค่าเริ่มต้นกลับไป (ไม่ throw)
import type { createClient as createServerSupabase } from '@/lib/supabase/server'
import type { createClient as createBrowserSupabase } from '@/lib/supabase/client'
import { isMigrationMissing } from '@/lib/migration'
import { DEFAULT_SHOP_SETTINGS, parseShopSettings, type ShopSettings } from '@/lib/pos'

/** supabase client ฝั่งเซิร์ฟเวอร์ (lib/supabase/server) หรือฝั่งเบราว์เซอร์ (lib/supabase/client) */
export type ShopSupabase = ReturnType<typeof createServerSupabase> | ReturnType<typeof createBrowserSupabase>

/**
 * settings = ข้อมูลร้าน (โหลดไม่ได้ = ค่าเริ่มต้น DEFAULT_SHOP_SETTINGS)
 * missing = true เมื่อฐานข้อมูลยังไม่ได้รัน supabase-fix-04-pos.sql (หน้าตั้งค่าร้านใช้แสดง MigrationNotice)
 * error อื่น (เน็ตหลุด/สิทธิ์) → ค่าเริ่มต้น + missing false — ไม่ทำให้หน้าขาย/ประวัติบิลเปิดไม่ได้
 */
export async function loadShopSettings(supabase: ShopSupabase): Promise<{ settings: ShopSettings; missing: boolean }> {
  try {
    const { data, error } = await supabase.rpc('get_shop_settings')
    if (error) return { settings: { ...DEFAULT_SHOP_SETTINGS }, missing: isMigrationMissing(error) }
    return { settings: parseShopSettings(data), missing: false }
  } catch (err) {
    return { settings: { ...DEFAULT_SHOP_SETTINGS }, missing: isMigrationMissing(err) }
  }
}
