import { createClient } from '@/lib/supabase/server'
import { requireRental } from '@/lib/auth/permissions'
import { bangkokTodayKey, isDayKey } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { FIX05_MISSING_MSG, parseToday, type RentalToday } from '@/lib/rental'
import MigrationNotice from '@/components/pos/MigrationNotice'
import TodayDashboard from '@/components/rental/calendar/TodayDashboard'
import { rentalErrorText } from '@/components/rental/calendar/rpc'

// /rental — ภาพรวมวันนี้ของร้านเช่าชุด (หน้าแรกหลังเลือกร้าน)
// โหลดรอบแรกที่เซิร์ฟเวอร์ (rental_today) ให้หน้าแสดงครบทันที — เปลี่ยนวัน/โหลดใหม่ทำในหน้าเว็บ (TodayDashboard)
// ?day=YYYY-MM-DD = ดูวันอื่น (วางแผนล่วงหน้า/ย้อนดู) ; ค่าเสีย = วันนี้
export default async function RentalHomePage({ searchParams }: { searchParams?: { day?: string | string[] } }) {
  await requireRental()
  const today = bangkokTodayKey()
  const raw = typeof searchParams?.day === 'string' ? searchParams.day.trim() : ''
  const day = isDayKey(raw) ? raw : today

  const supabase = createClient()
  let initial: RentalToday | null = null
  let initialError: string | null = null
  try {
    const { data, error } = await supabase.rpc('rental_today', { p_day: day })
    if (error) {
      if (isMigrationMissing(error)) {
        return <MigrationNotice title="ภาพรวมวันนี้" subtitle="งานรับ-คืนชุดและการเงินของวัน" message={FIX05_MISSING_MSG} />
      }
      initialError = rentalErrorText(error)
    } else {
      const parsed = parseToday(data)
      initial = parsed.day ? parsed : { ...parsed, day }
    }
  } catch (err) {
    // เน็ตฝั่งเซิร์ฟเวอร์หลุด — ให้หน้าเว็บแสดงกล่องแดง + ปุ่มลองใหม่ แทนหน้า error ทั้งหน้า
    initialError = rentalErrorText(err)
  }

  return <TodayDashboard initialDay={day} today={today} initial={initial} initialError={initialError} />
}
