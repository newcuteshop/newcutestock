import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarDays, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requireRental } from '@/lib/auth/permissions'
import { bangkokTodayKey } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { FIX05_MISSING_MSG } from '@/lib/rental'
import { ICON_SM } from '@/components/theme/icons'
import MigrationNotice from '@/components/pos/MigrationNotice'
import { isBookingTab, type BookingTab } from '@/components/rental/booking-form/bookingTabs'
import BookingsClient from './BookingsClient'

export const metadata: Metadata = { title: 'การจอง / สัญญาเช่า' }

const TITLE = 'การจอง / สัญญาเช่า'
const SUBTITLE = 'คำขอจองออนไลน์ การจองที่รอรับชุด ชุดที่ลูกค้ายืมอยู่ และประวัติการเช่า'

function first(v: string | string[] | undefined): string {
  return typeof v === 'string' ? v.trim() : Array.isArray(v) && typeof v[0] === 'string' ? v[0].trim() : ''
}

// /rental/bookings — รายการการจองแยกแท็บตามสถานะ + ค้นหาเลขที่การจอง/ชื่อ/เบอร์ลูกค้า + กรองช่วงวันที่
// ?tab=pending|confirmed|active|overdue|returned|completed|cancelled · ?q=คำค้น
// ไม่ระบุแท็บ: มีรายการรอยืนยัน (คำขอจองออนไลน์) → เปิดแท็บนั้นก่อน (ต้องยืนยันก่อนหมดเวลาถือคิว) ไม่งั้นเปิด "จองแล้ว"
// รายการดึงจากตารางตรงๆ ฝั่งหน้าเว็บ (RLS: พนักงานร้านเช่าอ่านได้) — เปลี่ยนแท็บ/ค้นหาไม่ต้องโหลดทั้งหน้าใหม่
export default async function BookingsPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  await requireRental()
  const today = bangkokTodayKey()
  const rawTab = first(searchParams.tab)
  let initialTab: BookingTab = 'confirmed'

  if (isBookingTab(rawTab)) {
    initialTab = rawTab
  } else {
    const supabase = createClient()
    const { count, error } = await supabase
      .from('rental_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
    // ยังไม่ได้รัน supabase-fix-05-rental.sql → บอกตรงๆ แทนหน้าพัง
    if (error && isMigrationMissing(error)) {
      return <MigrationNotice title={TITLE} subtitle={SUBTITLE} message={FIX05_MISSING_MSG} />
    }
    if (!error && (count ?? 0) > 0) initialTab = 'pending'
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">{TITLE}</h1>
          <p className="page-subtitle">{SUBTITLE}</p>
        </div>
        <div className="page-actions">
          <Link href="/rental/calendar" className="btn-secondary">
            <CalendarDays {...ICON_SM} />
            ปฏิทิน
          </Link>
          <Link href="/rental/bookings/new" className="btn-primary">
            <Plus {...ICON_SM} />
            สร้างการจอง
          </Link>
        </div>
      </div>
      <BookingsClient initialTab={initialTab} initialQuery={first(searchParams.q).slice(0, 60)} today={today} />
    </div>
  )
}
