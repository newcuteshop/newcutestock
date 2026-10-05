import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { parseShopSettings } from '@/lib/pos'
import MigrationNotice from '@/components/pos/MigrationNotice'
import ShopSettingsClient from './ShopSettingsClient'

const TITLE = 'ข้อมูลร้าน / ใบเสร็จ'
const SUBTITLE = 'ชื่อร้าน ที่อยู่ และรูปแบบใบเสร็จ — ใช้กับใบเสร็จ ใบคืนสินค้า และสรุปยอดประจำวัน'

export default async function ShopSettingsPage() {
  await requireAdmin()
  const supabase = createClient()

  // เรียก RPC ตรง (ไม่ใช้ loadShopSettings ที่คืนค่าเริ่มต้นเมื่อโหลดไม่ได้)
  // — หน้านี้ต้องเห็นค่าจริงเท่านั้น ไม่งั้นกดบันทึกแล้วค่าเริ่มต้นจะทับที่อยู่/เลขผู้เสียภาษีเดิมของร้าน
  const { data, error } = await supabase.rpc('get_shop_settings')
  if (error) {
    if (isMigrationMissing(error)) return <MigrationNotice title={TITLE} subtitle={SUBTITLE} />
    throw new Error(thaiError(error))
  }

  return (
    <ShopSettingsClient
      title={TITLE}
      subtitle={SUBTITLE}
      initial={parseShopSettings(data)}
      sampleAt={new Date().toISOString()}
    />
  )
}
