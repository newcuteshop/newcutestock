import Link from 'next/link'
import { Plus } from 'lucide-react'
import { requireRental } from '@/lib/auth/permissions'
import { bangkokTodayKey } from '@/lib/format'
import { ICON_SM } from '@/components/theme/icons'
import CalendarClient, { type CalendarTab } from '@/components/rental/calendar/CalendarClient'
import { isMonthKey, monthOfDay } from '@/components/rental/calendar/dates'
import { UUID_RE } from '@/components/rental/calendar/rpc'

// /rental/calendar — ปฏิทินร้านเช่าชุด: ตารางงานรายเดือน (รับ/คืน/ลองชุด) + ปฏิทินชุด (ชิ้น × วัน)
// ?tab=items · ?month=YYYY-MM · ?item=<uuid> (ค่าเสีย = ค่าเริ่มต้น) — ข้อมูลโหลดในหน้าเว็บตามแท็บที่เปิด
export default async function RentalCalendarPage({
  searchParams,
}: {
  searchParams?: { tab?: string | string[]; month?: string | string[]; item?: string | string[] }
}) {
  await requireRental()
  const today = bangkokTodayKey()
  const pick = (v: string | string[] | undefined) => (typeof v === 'string' ? v.trim() : '')
  const rawTab = pick(searchParams?.tab)
  const rawMonth = pick(searchParams?.month)
  const rawItem = pick(searchParams?.item)
  const tab: CalendarTab = rawTab === 'items' ? 'items' : 'schedule'
  const month = isMonthKey(rawMonth) ? rawMonth : monthOfDay(today)
  const itemId = UUID_RE.test(rawItem) ? rawItem.toLowerCase() : null

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">ปฏิทิน</h1>
          <p className="page-subtitle">ตารางรับ-คืนชุดรายเดือน และวันว่างของชุดแต่ละชิ้น</p>
        </div>
        <div className="page-actions">
          <Link href="/rental/bookings/new" className="btn-primary">
            <Plus {...ICON_SM} />
            จองชุดใหม่
          </Link>
        </div>
      </div>
      <CalendarClient today={today} initialTab={tab} initialMonth={month} initialItemId={itemId} />
    </div>
  )
}
