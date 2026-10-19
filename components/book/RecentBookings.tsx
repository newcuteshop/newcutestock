'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, History } from 'lucide-react'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { bookingStatusPath } from '@/lib/rental'
import { loadRecentBookings, type RecentBooking } from '@/components/book/cart'

// "การจองของฉัน" — ลิงก์สถานะการจองที่เคยส่งจากเครื่องนี้ (ลูกค้าปิดหน้าไปแล้วกลับมาส่งสลิป/ดูสถานะได้)
// อ่านจากเครื่องหลัง mount เท่านั้น (เซิร์ฟเวอร์ไม่รู้) · ไม่มีรายการ = ไม่แสดงอะไร
export default function RecentBookings({ className }: { className?: string }) {
  const [list, setList] = useState<RecentBooking[]>([])

  useEffect(() => {
    setList(loadRecentBookings())
  }, [])

  if (list.length === 0) return null

  return (
    <section className={className} aria-labelledby="book-recent-title">
      <div className="card p-4 sm:p-5">
        <h2 id="book-recent-title" className="section-title">
          <History {...ICON_SM} />
          การจองของฉัน
        </h2>
        <p className="mt-1 text-xs text-gray-500">ดูสถานะ ชำระมัดจำ หรือส่งสลิปของการจองที่ส่งจากเครื่องนี้</p>
        <ul className="mt-2 divide-y divide-gray-150">
          {list.map(r => (
            <li key={r.token}>
              <Link href={bookingStatusPath(r.token)} className="flex min-h-[44px] items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate font-semibold text-gray-900">เลขที่ {r.booking_no}</span>
                <span className="inline-flex shrink-0 items-center gap-1 font-medium text-brand-700">
                  ดูสถานะ
                  <ChevronRight {...ICON_XS} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
