// ===== ชื่อแท็บเบราว์เซอร์ของหน้าร้าน b.oncloud (ใช้ใน generateMetadata ของ server component เท่านั้น) =====
// แม่แบบชื่อของทั้งแอป (app/layout.tsx) คือ '%s · NEWCUTE' — หน้าร้านนี้ไม่ควรขึ้นชื่อ NEWCUTE
// จึงตั้งชื่อเต็มเอง (absolute) เป็น 'ชื่อหน้า · ชื่อร้าน' โดยชื่อร้านอ่านจาก wed_settings.shop_name (ห้าม hardcode)
// ไฟล์นี้ import ของฝั่งเซิร์ฟเวอร์ (cookies) — ห้าม import จาก client component
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { loadWeddingShopName } from '@/lib/weddingServer'

export async function weddingPageMetadata(title: string): Promise<Metadata> {
  // loadWeddingShopName ไม่ throw — อ่านไม่ได้ = ชื่อร้านเริ่มต้น
  const shopName = await loadWeddingShopName(createClient())
  return { title: { absolute: `${title} · ${shopName}` } }
}
