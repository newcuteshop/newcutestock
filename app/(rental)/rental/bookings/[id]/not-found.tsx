import Link from 'next/link'
import { ArrowLeft, SearchX } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'

// notFound() ในหน้ารายละเอียดการจอง (id ผิดรูปแบบ / ไม่มีการจองนี้) — แสดงในเลย์เอาต์ร้านเช่า มีเมนูครบ
export default function RentalBookingNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="card w-full max-w-md p-5 sm:p-6 flex flex-col items-center text-center">
        <span className="icon-bubble icon-bubble-lg mb-3" aria-hidden="true">
          <SearchX size={28} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <h1 className="text-lg sm:text-xl font-semibold text-gray-900">ไม่พบการจองนี้</h1>
        <p className="text-sm text-gray-600 mt-2">ลิงก์อาจไม่ถูกต้อง หรือการจองถูกลบไปแล้ว — ค้นหาได้จากหน้ารายการการจอง</p>
        <Link href="/rental/bookings" className="btn-primary mt-5 w-full sm:w-auto">
          <ArrowLeft {...ICON_SM} />
          กลับไปรายการการจอง
        </Link>
      </div>
    </div>
  )
}
