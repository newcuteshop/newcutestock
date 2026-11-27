// ===== ร้าน b.oncloud: โหลดค่าที่หลายหน้าใช้ร่วมกัน (หน้าเลือกร้าน /select, layout หลังร้าน /wedding/*) =====
// รับ supabase client จากผู้เรียก (server: lib/supabase/server · client: lib/supabase/client) แบบเดียวกับ loadRentalShopName
// ไม่ throw เด็ดขาด: อ่านไม่ได้ (ยังไม่รัน supabase-fix-07-wedding.sql / ไม่มีสิทธิ์ / เน็ตหลุด) → ค่าเริ่มต้น/null
// ไม่มี 'use client' และไม่ import ของฝั่งเซิร์ฟเวอร์ — ชื่อไฟล์บอกว่าใช้หลักๆ ใน server component
import type { Metadata } from 'next'
import type { ShopSupabase } from '@/lib/shop'
import { isMigrationMissing } from '@/lib/migration'
import {
  DEFAULT_WEDDING_SETTINGS,
  DEFAULT_WEDDING_SHOP_NAME,
  parseWedBadges,
  parseWeddingSettings,
  weddingLogoUrl,
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

/**
 * ชื่อร้าน + ลิงก์โลโก้ร้าน (wed_settings.shop_name, logo_path) ในคำขอเดียว — ใช้กับเมนูหลังร้าน / หน้าเลือกร้าน / ไอคอนแท็บ
 * อ่านจากตาราง (นโยบาย select = wed_staff()) — ไม่มีสิทธิ์/อ่านไม่ได้ = ชื่อเริ่มต้น + ไม่มีโลโก้ ('' = ใช้สัญลักษณ์เดิมของร้าน)
 * ไม่แคชข้ามคำขอ: ผู้จัดการอัปโหลดโลโก้ใหม่ (ชื่อไฟล์ใหม่ทุกครั้ง) แล้วหน้าตั้งค่าสั่ง router.refresh() → layout อ่านลิงก์ใหม่ทันที
 */
export async function loadWeddingBrand(supabase: ShopSupabase): Promise<{ shopName: string; logoUrl: string }> {
  try {
    const { data, error } = await supabase.from('wed_settings').select('shop_name, logo_path').limit(1).maybeSingle()
    if (error || !data) return { shopName: DEFAULT_WEDDING_SHOP_NAME, logoUrl: '' }
    const row = data as Record<string, unknown>
    const name = typeof row.shop_name === 'string' ? row.shop_name.trim() : ''
    const path = typeof row.logo_path === 'string' ? row.logo_path : null
    return { shopName: name || DEFAULT_WEDDING_SHOP_NAME, logoUrl: weddingLogoUrl({ logo_path: path }) }
  } catch {
    return { shopName: DEFAULT_WEDDING_SHOP_NAME, logoUrl: '' }
  }
}

/**
 * ไอคอนแท็บเบราว์เซอร์ของหน้าติดตามงาน /wedding-status/<token> (generateMetadata ของหน้านั้นอ่านข้อมูลร้านอยู่แล้ว) = โลโก้ร้าน
 *   ไม่มีโลโก้ → undefined (ไอคอนแอปเดิม) ; หลังร้าน /wedding/** ใช้ ShopTabIcon อย่างเดียว (ไม่อ่านฐานข้อมูลเพิ่มทุกการเปลี่ยนหน้า)
 * - shortcut มาก่อน /favicon.ico ที่ Next.js ใส่ให้เสมอ (เบราว์เซอร์ที่เลือกตัวแรกได้โลโก้) ; Chrome ใช้ ShopTabIcon ช่วยอีกชั้น
 * - ตั้ง icons เมื่อไร Next.js ไม่ใส่ไอคอนไฟล์ของแอป (icon.svg / apple-icon.png) ให้แล้ว → ใส่ apple-icon เดิมกลับ
 *   (ไอคอนแอปบนหน้าจอโฮม/manifest ใช้ชุดเดียวทุกร้าน ไม่เปลี่ยน)
 */
export function weddingTabIcons(logoUrl: string): Metadata['icons'] | undefined {
  if (!logoUrl) return undefined
  return {
    shortcut: [{ url: logoUrl }],
    icon: [{ url: logoUrl }],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
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
