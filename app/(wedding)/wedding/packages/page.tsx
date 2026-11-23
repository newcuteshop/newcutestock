import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireWeddingManager } from '@/lib/auth/permissions'
import { FIX07_MISSING_MSG, parseWedAddons, parseWedPackages } from '@/lib/wedding'
import { loadWeddingShopName } from '@/lib/weddingServer'
import MigrationNotice from '@/components/pos/MigrationNotice'
import PackagesClient from '@/components/wedding/settings/PackagesClient'
import { ADDON_COLUMNS, PACKAGE_COLUMNS } from '@/components/wedding/settings/packageForm'
import { wedErrorText, wedMissing } from '@/components/wedding/settings/wedRpc'

export const dynamic = 'force-dynamic'

const TITLE = 'แพ็กเกจ & บริการเสริม'
const SUBTITLE = 'ราคา ชั่วโมงทำงาน ทีมงาน และงานที่ลูกค้าจะได้รับ — ใช้เป็นค่าตั้งต้นตอนสร้างงาน'

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await loadWeddingShopName(createClient())
  return { title: { absolute: `แพ็กเกจ · ${shopName}` } }
}

// แพ็กเกจ + บริการเสริม — เฉพาะผู้จัดการ (wedding_manage) และแอดมิน
// อ่านจากตาราง (RLS: wed_staff) · เขียนผ่าน wed_save_package / wed_save_addon / wed_delete_* ในหน้าเท่านั้น
export default async function WeddingPackagesPage() {
  await requireWeddingManager()
  const supabase = createClient()
  const [pk, ad] = await Promise.all([
    supabase.from('wed_packages').select(PACKAGE_COLUMNS).order('sort_order').order('name'),
    supabase.from('wed_addons').select(ADDON_COLUMNS).order('sort_order').order('name'),
  ])

  if (pk.error) {
    if (wedMissing(pk.error)) return <MigrationNotice title={TITLE} subtitle={SUBTITLE} message={FIX07_MISSING_MSG} />
    // อ่านแพ็กเกจไม่ได้ = ห้ามแสดงรายการว่าง (บอสจะคิดว่าแพ็กเกจหาย) → หน้าข้อผิดพลาดพร้อมปุ่มลองใหม่
    throw new Error(wedErrorText(pk.error))
  }

  return (
    <PackagesClient
      packages={parseWedPackages(pk.data)}
      addons={ad.error ? [] : parseWedAddons(ad.data)}
      addonsError={ad.error ? wedErrorText(ad.error) : null}
    />
  )
}
