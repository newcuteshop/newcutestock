import { createClient } from '@/lib/supabase/server'
import { requireWeddingManager } from '@/lib/auth/permissions'
import { bangkokTodayKey } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { parseWedReport, type WedReport } from '@/lib/wedding'
import { presetRange, reportRangeProblem } from '@/components/wedding/money/reportRange'
import { wedErrorText } from '@/components/wedding/money/wedRpc'
import { weddingPageMetadata } from '@/components/wedding/money/pageMeta'
import ReportsClient from './ReportsClient'

export function generateMetadata() {
  return weddingPageMetadata('รายงาน')
}

export const dynamic = 'force-dynamic'

// รายงานร้าน b.oncloud — เฉพาะผู้จัดการ (wedding_manage) และแอดมิน (พนักงานถูกส่งกลับ /wedding)
// ?from=YYYY-MM-DD&to=YYYY-MM-DD (ค่าเสีย/ยาวเกิน 1 ปี = เดือนนี้ทั้งเดือน)
// โหลดรายงานช่วงแรกฝั่งเซิร์ฟเวอร์ (เปิดหน้ามาเห็นตัวเลขทันที) — เปลี่ยนช่วงแล้วหน้าจอโหลดเองฝั่งเบราว์เซอร์
// ยังไม่ได้รัน supabase-fix-07-wedding.sql = หน้าจอแจ้งให้รันไฟล์ (ไม่พังทั้งหน้า)
export default async function WeddingReportsPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  await requireWeddingManager()
  const supabase = createClient()

  const today = bangkokTodayKey()
  const rawFrom = typeof searchParams?.from === 'string' ? searchParams.from.trim() : ''
  const rawTo = typeof searchParams?.to === 'string' ? searchParams.to.trim() : ''
  const fallback = presetRange('month', today)
  const valid = reportRangeProblem(rawFrom, rawTo) === null
  const from = valid ? rawFrom : fallback.from
  const to = valid ? rawTo : fallback.to

  let report: WedReport | null = null
  let error = ''
  let missing = false
  try {
    const res = await supabase.rpc('wed_report', { p_from: from, p_to: to })
    if (res.error) {
      missing = isMigrationMissing(res.error)
      error = wedErrorText(res.error)
    } else {
      report = parseWedReport(res.data)
    }
  } catch (err) {
    error = wedErrorText(err)
  }

  return (
    <ReportsClient
      today={today}
      initialFrom={from}
      initialTo={to}
      initialReport={report}
      initialError={missing ? '' : error}
      initialMissing={missing}
    />
  )
}
