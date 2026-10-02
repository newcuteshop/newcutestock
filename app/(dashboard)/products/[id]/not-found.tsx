import Link from 'next/link'
import { ArrowLeft, SearchX } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'

// notFound() ในหน้าแก้ไขสินค้า (id ผิดรูปแบบ / สินค้าถูกลบไปแล้ว) — แสดงในเลย์เอาต์หลัก มีเมนูครบ
export default function ProductNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="card w-full max-w-md p-5 sm:p-6 flex flex-col items-center text-center">
        <span className="icon-bubble icon-bubble-lg mb-3" aria-hidden="true">
          <SearchX size={28} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <h1 className="text-lg sm:text-xl font-semibold text-gray-900">ไม่พบสินค้านี้</h1>
        <p className="text-sm text-gray-600 mt-2">สินค้าอาจถูกลบไปแล้ว หรือลิงก์ไม่ถูกต้อง</p>
        <Link href="/products" className="btn-primary mt-5 w-full sm:w-auto">
          <ArrowLeft {...ICON_SM} />
          กลับไปรายการสินค้า
        </Link>
      </div>
    </div>
  )
}
