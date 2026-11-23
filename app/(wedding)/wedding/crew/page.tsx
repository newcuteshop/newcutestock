import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { isWeddingManager, requireWedding } from '@/lib/auth/permissions'
import { bangkokTodayKey } from '@/lib/format'
import { FIX07_MISSING_MSG, parseCrewList } from '@/lib/wedding'
import { loadWeddingShopName } from '@/lib/weddingServer'
import MigrationNotice from '@/components/pos/MigrationNotice'
import CrewClient, { type CrewTab } from '@/components/wedding/crew/CrewClient'
import { rawVersionMap, wedErrorText, wedMissing } from '@/components/wedding/settings/wedRpc'

export const dynamic = 'force-dynamic'

const TITLE = 'ทีมงาน'
const SUBTITLE = 'รายชื่อ หน้าที่ ตารางงานรายเดือน และค่าตัวทีมงาน'

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await loadWeddingShopName(createClient())
  return { title: { absolute: `${TITLE} · ${shopName}` } }
}

function one(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' && s.trim() !== '' ? s.trim() : null
}

// ทีมงาน — พนักงาน b.oncloud ทุกคนเปิดได้ (รายชื่อ/ตารางงาน) · เพิ่ม-แก้ทีมงานและค่าตัว = ผู้จัดการ (wedding_manage) / แอดมิน
// รายชื่ออ่านผ่าน wed_list_crew (ตาราง wed_crew เปิดอ่านเฉพาะผู้จัดการ — พนักงานต้องไม่เห็นค่าตัว)
// ?tab=schedule&crew=<id>&month=YYYY-MM = เปิดตรงตารางงานของคนนั้น (ลิงก์จากปฏิทิน/งาน)
export default async function WeddingCrewPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  const session = await requireWedding()
  const manager = isWeddingManager(session)
  const supabase = createClient()
  const { data, error } = await supabase.rpc('wed_list_crew')
  if (error) {
    if (wedMissing(error)) return <MigrationNotice title={TITLE} subtitle={SUBTITLE} message={FIX07_MISSING_MSG} />
    throw new Error(wedErrorText(error))
  }

  const tabParam = one(searchParams?.tab)
  const tab: CrewTab = tabParam === 'schedule' || (tabParam === 'payouts' && manager) ? tabParam : 'list'
  const crewId = one(searchParams?.crew)

  return (
    <CrewClient
      initialCrew={parseCrewList(data)}
      initialVersions={manager ? rawVersionMap(data) : {}}
      manager={manager}
      today={bangkokTodayKey()}
      initialTab={crewId && tab === 'list' ? 'schedule' : tab}
      initialCrewId={crewId}
      initialMonth={one(searchParams?.month)}
    />
  )
}
