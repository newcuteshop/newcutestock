import { createClient } from '@/lib/supabase/server'
import { requireWedding } from '@/lib/auth/permissions'
import { bangkokTodayKey, isDayKey } from '@/lib/format'
import { FIX07_MISSING_MSG } from '@/lib/wedding'
import { loadWeddingSettings } from '@/lib/weddingServer'
import MigrationNotice from '@/components/pos/MigrationNotice'
import { isMonthKey } from '@/components/wedding/money/paymentRows'
import { weddingPageMetadata } from '@/components/wedding/money/pageMeta'
import PaymentsClient from './PaymentsClient'

export function generateMetadata() {
  return weddingPageMetadata('การเงิน')
}

// ตัวเลขเงินต้องสดเสมอ (รายการจากเครื่องอื่น) — ห้ามแคช
export const dynamic = 'force-dynamic'

const TITLE = 'การเงิน'
const SUBTITLE = 'รายการรับ-คืนเงินรายวัน/รายเดือน งวดที่ต้องตามเก็บ และพิมพ์สรุปยอด'

// หน้าการเงินร้าน b.oncloud — พนักงานทุกคนเข้าได้ (รับเงิน/ตามเก็บงวดเป็นงานประจำ)
// ?day=YYYY-MM-DD (วันอนาคต/ค่าเสีย = วันนี้) · ?month=YYYY-MM = ดูทั้งเดือน (เดือนอนาคต = เดือนนี้)
// ตรวจว่ามีระบบร้านนี้ในฐานข้อมูลด้วย wed_get_settings (ใช้ชื่อร้านบนใบสรุปยอดด้วย)
export default async function WeddingPaymentsPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  await requireWedding()
  const { settings, missing } = await loadWeddingSettings(createClient())
  if (missing) return <MigrationNotice title={TITLE} subtitle={SUBTITLE} message={FIX07_MISSING_MSG} />

  const today = bangkokTodayKey()
  const thisMonth = today.slice(0, 7)
  const rawDay = typeof searchParams?.day === 'string' ? searchParams.day.trim() : ''
  const rawMonth = typeof searchParams?.month === 'string' ? searchParams.month.trim() : ''
  const initialDay = isDayKey(rawDay) && rawDay <= today ? rawDay : today
  const monthOk = isMonthKey(rawMonth) && rawMonth <= thisMonth
  const initialMonth = monthOk ? rawMonth : initialDay.slice(0, 7)

  return (
    <PaymentsClient
      shopName={settings.shop_name}
      today={today}
      initialMode={monthOk ? 'month' : 'day'}
      initialDay={initialDay}
      initialMonth={initialMonth}
    />
  )
}
