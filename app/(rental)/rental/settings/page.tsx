import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireRentalManager } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { FIX05_MISSING_MSG, parseRentalCategories, parseRentalSettings } from '@/lib/rental'
import MigrationNotice from '@/components/pos/MigrationNotice'
import { rentalErrorText } from '@/components/rental/money/moneyRows'
import SettingsClient from './SettingsClient'

export const metadata: Metadata = { title: 'ตั้งค่าร้านเช่า' }
export const dynamic = 'force-dynamic'

const TITLE = 'ตั้งค่าร้านเช่า'
const SUBTITLE = 'ข้อมูลร้าน ช่องทางรับเงิน นโยบายการเช่า การจองออนไลน์ ข้อตกลงในสัญญา และหมวดชุด'

// ตั้งค่าร้านเช่าชุด — เฉพาะผู้จัดการร้านเช่า (rental_manage) และแอดมิน (พนักงานทั่วไปถูกพากลับ /rental)
// ตั้งค่าโหลดผ่าน rental_get_settings (คืนแถวเดียวพร้อมค่าเริ่มต้นเสมอ) · หมวดอ่านจากตาราง rental_categories (RLS)
// ยังไม่ได้รัน supabase-fix-05-rental.sql → แจ้งให้รันไฟล์แทนหน้าพัง
export default async function RentalSettingsPage() {
  await requireRentalManager()
  const supabase = createClient()

  const [settingsRes, categoriesRes] = await Promise.all([
    supabase.rpc('rental_get_settings'),
    supabase
      .from('rental_categories')
      .select('id, name, sort_order, is_active, created_at')
      .order('sort_order')
      .order('name'),
  ])

  if (settingsRes.error) {
    if (isMigrationMissing(settingsRes.error)) {
      return <MigrationNotice title={TITLE} subtitle={SUBTITLE} message={FIX05_MISSING_MSG} />
    }
    // อ่านตั้งค่าไม่ได้ = ห้ามเปิดฟอร์มด้วยค่าเริ่มต้น (กดบันทึกแล้วจะทับค่าจริงของร้าน) → หน้าข้อผิดพลาดพร้อมปุ่มลองใหม่
    throw new Error(rentalErrorText(settingsRes.error))
  }

  return (
    <SettingsClient
      initial={parseRentalSettings(settingsRes.data)}
      categories={categoriesRes.error ? [] : parseRentalCategories(categoriesRes.data)}
      categoriesError={categoriesRes.error ? thaiError(categoriesRes.error) : null}
    />
  )
}
