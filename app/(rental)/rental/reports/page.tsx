import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireRentalManager } from '@/lib/auth/permissions'
import { bangkokTodayKey, daysBetweenKeys, isDayKey } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { parseReport, type RentalReport } from '@/lib/rental'
import { rentalErrorText } from '@/components/rental/money/moneyRows'
import ReportsClient from './ReportsClient'

export const metadata: Metadata = { title: 'รายงานร้านเช่า' }
export const dynamic = 'force-dynamic'

// ช่วงวันที่ยาวสุดที่ rental_report รับ (1 ปี รวมปีอธิกสุรทิน)
const MAX_DAYS = 366

// รายงานร้านเช่าชุด — เฉพาะผู้จัดการร้านเช่า (rental_manage) และแอดมิน
// ?from=YYYY-MM-DD&to=YYYY-MM-DD (ค่าเสีย/เกินวันนี้/ยาวเกิน 1 ปี = เดือนนี้)
// โหลดรายงานช่วงแรกฝั่งเซิร์ฟเวอร์ (เปิดหน้ามาเห็นตัวเลขทันที) — เปลี่ยนช่วงแล้วหน้าจอโหลดเองฝั่งเบราว์เซอร์
// rental_report อยู่ใน supabase-fix-06-rental-online.sql → ยังไม่ได้รัน = หน้าจอแจ้งให้รันไฟล์ (ไม่พังทั้งหน้า)
export default async function RentalReportsPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  await requireRentalManager()
  const supabase = createClient()

  const today = bangkokTodayKey()
  const monthStart = `${today.slice(0, 8)}01`
  const rawFrom = typeof searchParams?.from === 'string' ? searchParams.from.trim() : ''
  const rawTo = typeof searchParams?.to === 'string' ? searchParams.to.trim() : ''
  const valid =
    isDayKey(rawFrom) && isDayKey(rawTo) && rawFrom <= rawTo && rawTo <= today &&
    daysBetweenKeys(rawFrom, rawTo) + 1 <= MAX_DAYS
  const from = valid ? rawFrom : monthStart
  const to = valid ? rawTo : today

  let report: RentalReport | null = null
  let error = ''
  let missing = false
  try {
    const res = await supabase.rpc('rental_report', { p_from: from, p_to: to })
    if (res.error) {
      missing = isMigrationMissing(res.error)
      error = rentalErrorText(res.error)
    } else {
      report = parseReport(res.data)
    }
  } catch (err) {
    error = rentalErrorText(err)
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
