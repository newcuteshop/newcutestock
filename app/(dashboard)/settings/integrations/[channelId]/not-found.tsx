import Link from 'next/link'
import { ArrowLeft, SearchX } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'

// notFound() ในหน้าช่องทาง (id ผิดรูปแบบ / ช่องทางถูกลบไปแล้ว) — แสดงในเลย์เอาต์หลัก มีเมนูครบ
export default function ChannelNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="card w-full max-w-md p-5 sm:p-6 flex flex-col items-center text-center">
        <span className="icon-bubble icon-bubble-lg mb-3" aria-hidden="true">
          <SearchX size={30} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <h1 className="font-display text-lg sm:text-xl font-bold text-gray-900">ไม่พบช่องทางนี้</h1>
        <p className="text-sm text-gray-600 mt-2">ช่องทางอาจถูกลบไปแล้ว หรือลิงก์ไม่ถูกต้อง</p>
        <Link href="/settings/integrations" className="btn-primary mt-5 w-full sm:w-auto">
          <ArrowLeft {...ICON_SM} />
          กลับไปหน้าตั้งค่าการเชื่อมต่อ
        </Link>
      </div>
    </div>
  )
}
