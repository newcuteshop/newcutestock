import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isRentalManager, requireRental } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { FIX05_MISSING_MSG, loadRentalShopName, parseRentalItem } from '@/lib/rental'
import MigrationNotice from '@/components/pos/MigrationNotice'
import ItemEditor, { type ItemTab } from '@/components/rental/items/ItemEditor'
import { loadItemFormData } from '../itemPageData'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TABS: readonly ItemTab[] = ['info', 'calendar', 'history']

function one(v: string | string[] | undefined): string | null {
  return typeof v === 'string' ? v : null
}

// /rental/items/<id> — หน้าชุดเช่า 1 แบบ (ข้อมูล + ชิ้น / ปฏิทินว่าง / ประวัติการเช่า)
// พนักงานร้านเช่าดูได้ · แก้ไขได้เฉพาะผู้จัดการร้านเช่า (ฟอร์มกลายเป็นดูอย่างเดียว)
// ?tab=calendar|history เปิดแท็บนั้นเลย · ?saved=new|again มาจากการเพิ่มชุดใหม่
export default async function RentalItemPage({
  params, searchParams,
}: {
  params: { id: string }
  searchParams?: { saved?: string | string[]; tab?: string | string[] }
}) {
  const session = await requireRental()
  if (!UUID_RE.test(params.id)) notFound()
  const id = params.id.toLowerCase()
  const supabase = createClient()

  const itemRes = await supabase.rpc('rental_get_item', { p_item_id: id })
  if (itemRes.error) {
    if (isMigrationMissing(itemRes.error)) return <MigrationNotice title="ชุดเช่า" message={FIX05_MISSING_MSG} />
    const text = thaiError(itemRes.error)
    if (text.includes('ไม่พบชุดนี้')) notFound()
    throw new Error(text)
  }
  const item = parseRentalItem(itemRes.data)
  if (!item) notFound()

  let data: Awaited<ReturnType<typeof loadItemFormData>>
  try {
    data = await loadItemFormData(supabase, item.id)
  } catch (e) {
    if (isMigrationMissing(e)) return <MigrationNotice title="ชุดเช่า" message={FIX05_MISSING_MSG} />
    throw e instanceof Error ? e : new Error(thaiError(e))
  }
  const shopName = await loadRentalShopName(supabase)

  const saved = one(searchParams?.saved)
  const tab = one(searchParams?.tab)
  return (
    <ItemEditor
      key={item.id}
      initial={item}
      categories={data.categories}
      settings={data.settings}
      otherCodes={data.otherCodes}
      canManage={isRentalManager(session)}
      shopName={shopName}
      savedNotice={saved === 'new' || saved === 'again' ? saved : null}
      initialTab={tab && (TABS as readonly string[]).includes(tab) ? (tab as ItemTab) : 'info'}
    />
  )
}
