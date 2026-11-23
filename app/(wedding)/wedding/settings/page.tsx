import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireWeddingManager } from '@/lib/auth/permissions'
import { FIX07_MISSING_MSG } from '@/lib/wedding'
import { loadWeddingSettings, loadWeddingShopName } from '@/lib/weddingServer'
import MigrationNotice from '@/components/pos/MigrationNotice'
import SettingsClient from '@/components/wedding/settings/SettingsClient'
import { wedErrorText } from '@/components/wedding/settings/wedRpc'

export const dynamic = 'force-dynamic'

const TITLE = 'ตั้งค่าร้าน'
const SUBTITLE = 'ข้อมูลร้าน โลโก้ ช่องทางติดต่อ การรับเงิน นโยบายมัดจำ เงื่อนไขสัญญา ข้อความบนเอกสาร และลิงก์ลูกค้า'

// ชื่อแท็บเบราว์เซอร์ใช้ชื่อร้าน b.oncloud (แม่แบบหลักของแอปต่อท้าย "NEWCUTE" — หน้าในร้านนี้ตั้งชื่อเต็มเอง)
export async function generateMetadata(): Promise<Metadata> {
  const shopName = await loadWeddingShopName(createClient())
  return { title: { absolute: `${TITLE} · ${shopName}` } }
}

// ตั้งค่าร้าน b.oncloud — เฉพาะผู้จัดการ (wedding_manage) และแอดมิน (พนักงานทั่วไปถูกพากลับ /wedding)
// โหลดผ่าน wed_get_settings (คืนแถวเดียวพร้อมค่าเริ่มต้นเสมอ) · ยังไม่ได้รัน supabase-fix-07-wedding.sql → แจ้งให้รันไฟล์แทนหน้าพัง
export default async function WeddingSettingsPage() {
  await requireWeddingManager()
  const { settings, missing, error } = await loadWeddingSettings(createClient())
  if (missing) {
    return <MigrationNotice title={TITLE} subtitle={SUBTITLE} message={FIX07_MISSING_MSG} />
  }
  // อ่านตั้งค่าไม่ได้ = ห้ามเปิดฟอร์มด้วยค่าเริ่มต้น (กดบันทึกแล้วจะทับค่าจริงของร้าน) → หน้าข้อผิดพลาดพร้อมปุ่มลองใหม่
  if (error) throw new Error(wedErrorText(error))
  return <SettingsClient initial={settings} />
}
