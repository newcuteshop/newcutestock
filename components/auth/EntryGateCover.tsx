import { Loader2 } from 'lucide-react'
import BrandMark from '@/components/theme/BrandMark'
import { ICON_SM } from '@/components/theme/icons'

// แผ่นปิดหน้าจอขณะประตูเข้าระบบล็อกอยู่ (<html data-gate="locked"> — ดู lib/auth/entry-gate.ts)
// ปกติซ่อน (display: none) · ตอนล็อก app/globals.css ซ่อนทุกอย่างใน body ยกเว้นแผ่นนี้ → ข้อมูลร้านไม่โผล่แม้แวบเดียว
// หน้าตา: พื้นขาวเรียบ + โลโก้ + ชื่อร้าน + ไอคอนหมุนเล็ก
// ต้องเป็นลูกชั้นแรกของ <body> (วางใน app/layout.tsx) · ใช้ได้ทั้ง server component
// ลิงก์สำรองโผล่หลังรอสักครู่ เผื่อสคริปต์ของหน้าโหลดไม่ขึ้น (เน็ตหลุด / ไฟล์เวอร์ชันเก่า) จะได้ไม่ค้างหน้าว่าง
// — ใช้ <a> ธรรมดา (โหลดหน้าใหม่ทั้งหน้า) ไม่ใช้ next/link
export default function EntryGateCover() {
  return (
    <div className="entry-gate-cover" role="status">
      <BrandMark size="lg" />
      <p className="text-xl font-semibold leading-tight tracking-wide text-gray-900">NEWCUTE</p>
      <p className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 {...ICON_SM} className="animate-spin text-brand-600" />
        กำลังตรวจสอบการเข้าระบบ...
      </p>
      <div className="entry-gate-later">
        <a href="/login" className="btn-secondary">ไปหน้าเข้าสู่ระบบ</a>
      </div>
    </div>
  )
}
