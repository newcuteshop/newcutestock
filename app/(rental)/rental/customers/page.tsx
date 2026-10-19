import Link from 'next/link'
import { UserPlus } from 'lucide-react'
import { requireRental } from '@/lib/auth/permissions'
import { ICON_SM } from '@/components/theme/icons'
import CustomersClient from '@/components/rental/customers/CustomersClient'

// /rental/customers — รายชื่อลูกค้าร้านเช่าชุด (ค้นหา / บัญชีดำ / ประวัติการจองย่อ)
// ข้อมูลโหลดในหน้าเว็บ (ค้นหา/โหลดเพิ่มไม่ต้องโหลดทั้งหน้าใหม่) — ยังไม่รัน fix-05 → หน้าเว็บแสดงกล่องเตือนเอง
export default async function RentalCustomersPage() {
  await requireRental()
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">ลูกค้า</h1>
          <p className="page-subtitle">ข้อมูลติดต่อ ประวัติการเช่า และบัญชีดำ</p>
        </div>
        <div className="page-actions">
          <Link href="/rental/customers/new" className="btn-primary">
            <UserPlus {...ICON_SM} />
            เพิ่มลูกค้า
          </Link>
        </div>
      </div>
      <CustomersClient />
    </div>
  )
}
