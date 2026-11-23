import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireWedding } from '@/lib/auth/permissions'
import { bangkokTodayKey, isDayKey } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { FIX07_MISSING_MSG, WEDDING_SHOP_KIND, parseWedToday, type WedToday } from '@/lib/wedding'
import MigrationNotice from '@/components/pos/MigrationNotice'
import WeddingDashboard from '@/components/wedding/dashboard/WeddingDashboard'
import { wedErrorText } from '@/components/wedding/calendar/rpc'

// ชื่อแท็บเบราว์เซอร์ไม่ต่อท้าย "NEWCUTE" (คนละร้าน) — ชื่อร้านจริงอยู่ในฐานข้อมูล จึงใช้คำอธิบายร้านแทน
export const metadata: Metadata = { title: { absolute: `ภาพรวม · ${WEDDING_SHOP_KIND}` } }

// /wedding — ภาพรวมร้าน b.oncloud (หน้าแรกหลังเลือกร้าน)
// โหลดรอบแรกที่เซิร์ฟเวอร์ (wed_today) ให้หน้าแสดงครบทันที — เปลี่ยนวัน/โหลดใหม่ทำในหน้าเว็บ (WeddingDashboard)
// ?day=YYYY-MM-DD = ดูวันอื่น (วางแผนล่วงหน้า/ย้อนดู) ; ค่าเสีย = วันนี้
export default async function WeddingHomePage({ searchParams }: { searchParams?: { day?: string | string[] } }) {
  await requireWedding()
  const today = bangkokTodayKey()
  const raw = typeof searchParams?.day === 'string' ? searchParams.day.trim() : ''
  const day = isDayKey(raw) ? raw : today

  const supabase = createClient()
  let initial: WedToday | null = null
  let initialError: string | null = null
  try {
    const { data, error } = await supabase.rpc('wed_today', { p_day: day })
    if (error) {
      if (isMigrationMissing(error)) {
        return <MigrationNotice title="ภาพรวม" subtitle="คิวงาน สิ่งที่ต้องติดตาม และการเงินของร้าน" message={FIX07_MISSING_MSG} />
      }
      initialError = wedErrorText(error)
    } else {
      const parsed = parseWedToday(data)
      initial = parsed.day ? parsed : { ...parsed, day }
    }
  } catch (err) {
    // เน็ตฝั่งเซิร์ฟเวอร์หลุด — ให้หน้าเว็บแสดงกล่องแดง + ปุ่มลองใหม่ แทนหน้า error ทั้งหน้า
    initialError = wedErrorText(err)
  }

  return <WeddingDashboard initialDay={day} today={today} initial={initial} initialError={initialError} />
}
