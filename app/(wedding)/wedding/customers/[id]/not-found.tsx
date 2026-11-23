import Link from 'next/link'
import { ArrowLeft, SearchX } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'

// notFound() ในหน้ารายละเอียดลูกค้า (id ผิดรูปแบบ / ไม่มีลูกค้านี้) — แสดงในเลย์เอาต์ร้าน b.oncloud มีเมนูครบ
export default function WeddingCustomerNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="card w-full max-w-md p-5 sm:p-6 flex flex-col items-center text-center">
        <span className="icon-bubble icon-bubble-lg mb-3" aria-hidden="true">
          <SearchX size={28} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <h1 className="text-lg sm:text-xl font-semibold text-gray-900">ไม่พบลูกค้านี้</h1>
        <p className="text-sm text-gray-600 mt-2">ลิงก์อาจไม่ถูกต้อง หรือข้อมูลลูกค้าถูกลบไปแล้ว</p>
        <Link href="/wedding/customers" className="btn-primary mt-5 w-full sm:w-auto">
          <ArrowLeft {...ICON_SM} />
          กลับไปรายชื่อลูกค้า
        </Link>
      </div>
    </div>
  )
}
