import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/permissions'
import { bangkokTodayKey, isDayKey, thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { parseDayClosing, parseDaySummary, type DayClosing } from '@/lib/pos'
import { loadShopSettings } from '@/lib/shop'
import MigrationNotice from '@/components/pos/MigrationNotice'
import CloseClient from './CloseClient'

const TITLE = 'ปิดยอดประจำวัน'
const SUBTITLE = 'สรุปยอดขายของวัน นับเงินสดในลิ้นชัก แล้วบันทึกปิดยอด'
// ประวัติการปิดยอดล่าสุดที่แสดงท้ายหน้า
const RECENT_LIMIT = 14

export default async function CloseDayPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  await requirePermission('sales')
  const supabase = createClient()

  // ?day=YYYY-MM-DD (หน้าจอเขียนลง URL ตอนเปลี่ยนวัน → โหลดหน้าใหม่แล้วยังอยู่วันเดิม) ; ไม่มี/ผิด/วันอนาคต = วันนี้
  const todayKey = bangkokTodayKey()
  const rawDay = typeof searchParams.day === 'string' ? searchParams.day.trim() : ''
  const day = isDayKey(rawDay) && rawDay <= todayKey ? rawDay : todayKey

  const [summaryRes, closingsRes, shop] = await Promise.all([
    supabase.rpc('get_day_summary', { p_day: day }),
    supabase
      .from('daily_closings')
      .select('day, opening_cash, counted_cash, expected_cash, cash_diff, revision, closed_by_name, closed_at')
      .order('day', { ascending: false })
      .limit(RECENT_LIMIT),
    loadShopSettings(supabase),
  ])

  // ยังไม่ได้รัน supabase-fix-04-pos.sql → บอกตรงๆ แทนหน้าพัง (หน้าอื่นของแอปยังใช้ได้ตามเดิม)
  if (summaryRes.error) {
    if (isMigrationMissing(summaryRes.error)) return <MigrationNotice title={TITLE} subtitle={SUBTITLE} />
    throw new Error(thaiError(summaryRes.error))
  }
  const parsed = parseDaySummary(summaryRes.data)
  if (!parsed) throw new Error('อ่านข้อมูลยอดประจำวันไม่ได้ กรุณาโหลดหน้าใหม่')
  // หน้าจอผูกตัวเลขกับ "วันที่เลือก" ด้วยคีย์ day — กันค่าแปลกจากฐานข้อมูลทำให้หน้าค้างที่โครงรอโหลด
  const summary = parsed.day === day ? parsed : { ...parsed, day }

  // ประวัติการปิดยอดโหลดไม่ได้ ไม่ควรขวางการปิดยอดวันนี้ → แจ้งเฉพาะในส่วนประวัติ
  let closings: DayClosing[] = []
  let closingsError: string | null = null
  if (closingsRes.error) {
    closingsError = isMigrationMissing(closingsRes.error)
      ? 'ฐานข้อมูลยังไม่มีตารางประวัติการปิดยอด — รันไฟล์ supabase-fix-04-pos.sql อีกครั้ง แล้วโหลดหน้านี้ใหม่'
      : thaiError(closingsRes.error)
  } else {
    const rows = Array.isArray(closingsRes.data) ? (closingsRes.data as unknown[]) : []
    closings = rows.map(parseDayClosing).filter((c): c is DayClosing => c !== null)
  }

  return (
    <CloseClient
      title={TITLE}
      subtitle={SUBTITLE}
      todayKey={todayKey}
      initialSummary={summary}
      closings={closings}
      closingsError={closingsError}
      shop={shop.settings}
    />
  )
}
