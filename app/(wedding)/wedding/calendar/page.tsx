import type { Metadata } from 'next'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { requireWedding } from '@/lib/auth/permissions'
import { bangkokTodayKey, isDayKey } from '@/lib/format'
import { WEDDING_SHOP_KIND } from '@/lib/wedding'
import { ICON_SM } from '@/components/theme/icons'
import CalendarClient from '@/components/wedding/calendar/CalendarClient'
import { DEFAULT_FILTERS, isTypeFilter, type CalFilters } from '@/components/wedding/calendar/calendarModel'
import { UUID_RE } from '@/components/wedding/calendar/rpc'
import { isMonthKey, monthOfDay } from '@/components/rental/calendar/dates'

// ชื่อแท็บเบราว์เซอร์ไม่ต่อท้าย "NEWCUTE" (คนละร้าน) — ชื่อร้านจริงอยู่ในฐานข้อมูล จึงใช้คำอธิบายร้านแทน
export const metadata: Metadata = { title: { absolute: `ปฏิทินงาน · ${WEDDING_SHOP_KIND}` } }

// /wedding/calendar — ปฏิทินงานรายเดือนของร้าน b.oncloud (แตะวันเพื่อดูรายละเอียดทุกคิวของวัน)
// ?month=YYYY-MM · ?day=YYYY-MM-DD (เปิดรายละเอียดวันนั้น) · ?crew=<uuid> · ?inq=1 · ?type=<ประเภทคิว> — ค่าเสีย = ค่าเริ่มต้น
// ข้อมูลโหลดในหน้าเว็บ (เปลี่ยนเดือน/ตัวกรองบ่อย) แบบเดียวกับปฏิทินร้านเช่า
export default async function WeddingCalendarPage({
  searchParams,
}: {
  searchParams?: { month?: string | string[]; day?: string | string[]; crew?: string | string[]; inq?: string | string[]; type?: string | string[] }
}) {
  await requireWedding()
  const today = bangkokTodayKey()
  const pick = (v: string | string[] | undefined) => (typeof v === 'string' ? v.trim() : '')
  const rawDay = pick(searchParams?.day)
  const rawMonth = pick(searchParams?.month)
  const rawCrew = pick(searchParams?.crew)
  const rawType = pick(searchParams?.type)

  const day = isDayKey(rawDay) ? rawDay : null
  // ระบุวันมา → เปิดเดือนของวันนั้น (ไม่สนใจ ?month=)
  const month = day ? monthOfDay(day) : isMonthKey(rawMonth) ? rawMonth : monthOfDay(today)
  const filters: CalFilters = {
    ...DEFAULT_FILTERS,
    crewId: UUID_RE.test(rawCrew) ? rawCrew.toLowerCase() : null,
    includeInquiries: pick(searchParams?.inq) === '1',
    type: isTypeFilter(rawType) ? rawType : 'all',
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">ปฏิทินงาน</h1>
          <p className="page-subtitle">คิวถ่ายงานรายเดือน แตะวันเพื่อดูรายละเอียดทุกงานของวัน</p>
        </div>
        <div className="page-actions">
          <Link href="/wedding/bookings/new" className="btn-primary">
            <Plus {...ICON_SM} />
            สร้างงานใหม่
          </Link>
        </div>
      </div>
      <CalendarClient today={today} initialMonth={month} initialDay={day} initialFilters={filters} />
    </div>
  )
}
