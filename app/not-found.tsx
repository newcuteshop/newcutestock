import Link from 'next/link'
import { Home, SearchX } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import EntryGate from '@/components/auth/EntryGate'

// ที่อยู่เว็บที่ไม่มีอยู่จริง — แทนหน้า 404 ภาษาอังกฤษของ Next.js
// หน้าเดี่ยว (ไม่มีเมนู) หน้าตาชุดเดียวกับหน้าเข้าสู่ระบบ: การ์ดนม + กันสาดลายทางหัวการ์ด
// หน้านี้ไม่อยู่ใต้ layout ของระบบ จึงต้องมีประตูเข้าระบบเอง — ไม่งั้นหน้าต่างใหม่ที่เปิดลิงก์ผิดจะค้างที่หน้าล็อก
export default function NotFound() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <EntryGate />
      <div className="card card-milk w-full max-w-md overflow-hidden border-2 text-center">
        <div className="awning decor" aria-hidden="true" />
        <div className="px-5 pt-4 pb-6 sm:px-6 flex flex-col items-center">
          <span className="icon-bubble icon-bubble-lg mb-3" aria-hidden="true">
            <SearchX size={30} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <h1 className="font-display text-lg sm:text-xl font-bold text-gray-900">ไม่พบหน้านี้</h1>
          <p className="text-sm text-gray-600 mt-2">ลิงก์อาจพิมพ์ผิด หรือหน้านี้ถูกย้ายไปแล้ว</p>
          <Link href="/dashboard" className="btn-primary mt-5 w-full sm:w-auto">
            <Home {...ICON_SM} />
            กลับหน้าภาพรวม
          </Link>
        </div>
      </div>
    </div>
  )
}
