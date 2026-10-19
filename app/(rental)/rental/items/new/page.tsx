import { createClient } from '@/lib/supabase/server'
import { requireRentalManager } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { FIX05_MISSING_MSG, loadRentalShopName } from '@/lib/rental'
import MigrationNotice from '@/components/pos/MigrationNotice'
import ItemEditor from '@/components/rental/items/ItemEditor'
import { loadItemFormData } from '../itemPageData'

// /rental/items/new — เพิ่มชุดเช่าแบบใหม่ (เฉพาะผู้จัดการร้านเช่า)
// หัวเรื่อง/ปุ่มกลับอยู่ในฟอร์ม (บันทึกแล้วพาไปหน้าของชุดนั้นทันที)
export default async function NewRentalItemPage() {
  await requireRentalManager()
  const supabase = createClient()

  let data: Awaited<ReturnType<typeof loadItemFormData>>
  try {
    data = await loadItemFormData(supabase, null)
  } catch (e) {
    if (isMigrationMissing(e)) return <MigrationNotice title="เพิ่มชุดใหม่" message={FIX05_MISSING_MSG} />
    throw e instanceof Error ? e : new Error(thaiError(e))
  }
  const shopName = await loadRentalShopName(supabase)

  return (
    <ItemEditor
      categories={data.categories}
      settings={data.settings}
      otherCodes={data.otherCodes}
      canManage
      shopName={shopName}
    />
  )
}
