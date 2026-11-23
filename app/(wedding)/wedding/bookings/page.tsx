import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarDays, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requireWedding } from '@/lib/auth/permissions'
import { bangkokTodayKey } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { FIX07_MISSING_MSG } from '@/lib/wedding'
import { loadWeddingShopName } from '@/lib/weddingServer'
import { ICON_SM } from '@/components/theme/icons'
import MigrationNotice from '@/components/pos/MigrationNotice'
import { isBookingTab, type BookingTab } from '@/components/wedding/booking-form/bookingTabs'
import BookingsClient from './BookingsClient'

const TITLE = 'งาน / การจอง'
const SUBTITLE = 'งานที่ลูกค้าสอบถาม ล็อกคิวรอมัดจำ งานที่ยืนยันแล้ว งานรอส่ง และประวัติงานทั้งหมด'

// ชื่อแท็บเบราว์เซอร์ใช้ชื่อร้านจากตั้งค่า (ไม่ใช่ชื่อระบบหลัก)
export async function generateMetadata(): Promise<Metadata> {
  const shop = await loadWeddingShopName(createClient())
  return { title: { absolute: `${TITLE} · ${shop}` } }
}

function first(v: string | string[] | undefined): string {
  return typeof v === 'string' ? v.trim() : Array.isArray(v) && typeof v[0] === 'string' ? v[0].trim() : ''
}

// /wedding/bookings — รายการงานแยกแท็บตามสถานะ + ค้นหาเลขที่งาน/ชื่อคู่บ่าวสาว/ชื่อ-เบอร์ลูกค้า + กรองช่วงวันงาน
// ?tab=inquiry|hold|confirmed|in_production|delivered|completed|postponed|cancelled · ?q=คำค้น
// ไม่ระบุแท็บ: มีงานล็อกคิวรอมัดจำ → เปิดแท็บนั้นก่อน (ต้องตามมัดจำก่อนหมดเวลาล็อกคิว)
//   ไม่งั้นมีงานสอบถามที่ถึงวันติดตาม → แท็บสอบถาม ; ไม่งั้นเปิด "ยืนยันแล้ว"
// รายการดึงจากตารางตรงๆ ฝั่งหน้าเว็บ (RLS: พนักงาน b.oncloud อ่านได้) — เปลี่ยนแท็บ/ค้นหาไม่ต้องโหลดทั้งหน้าใหม่
export default async function WeddingBookingsPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  await requireWedding()
  const today = bangkokTodayKey()
  const rawTab = first(searchParams.tab)
  let initialTab: BookingTab = 'confirmed'

  if (isBookingTab(rawTab)) {
    initialTab = rawTab
  } else {
    const supabase = createClient()
    // กวาดงานล็อกคิวที่หมดเวลา (→ สอบถาม) ก่อนนับ ให้แท็บที่เปิดตรงกับความจริง — ทำไม่ได้ก็นับตามตาราง
    try {
      await supabase.rpc('wed_badges')
    } catch {
      // ไม่เป็นไร
    }
    const [holds, followups] = await Promise.all([
      supabase.from('wed_bookings').select('id', { count: 'exact', head: true }).eq('status', 'hold'),
      supabase
        .from('wed_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'inquiry')
        .lte('followup_date', today),
    ])
    // ยังไม่ได้รัน supabase-fix-07-wedding.sql → บอกตรงๆ แทนหน้าพัง
    if (holds.error && isMigrationMissing(holds.error)) {
      return <MigrationNotice title={TITLE} subtitle={SUBTITLE} message={FIX07_MISSING_MSG} />
    }
    if (!holds.error && (holds.count ?? 0) > 0) initialTab = 'hold'
    else if (!followups.error && (followups.count ?? 0) > 0) initialTab = 'inquiry'
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">{TITLE}</h1>
          <p className="page-subtitle">{SUBTITLE}</p>
        </div>
        <div className="page-actions">
          <Link href="/wedding/calendar" className="btn-secondary">
            <CalendarDays {...ICON_SM} />
            ปฏิทินงาน
          </Link>
          <Link href="/wedding/bookings/new" className="btn-primary">
            <Plus {...ICON_SM} />
            สร้างงาน
          </Link>
        </div>
      </div>
      <BookingsClient initialTab={initialTab} initialQuery={first(searchParams.q).slice(0, 60)} today={today} />
    </div>
  )
}
