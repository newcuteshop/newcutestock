import Link from 'next/link'
import { UserPlus } from 'lucide-react'
import { requireWedding } from '@/lib/auth/permissions'
import { ICON_SM } from '@/components/theme/icons'
import CustomersClient from '@/components/wedding/customers/CustomersClient'
import { weddingPageMetadata } from '@/components/wedding/money/pageMeta'

export function generateMetadata() {
  return weddingPageMetadata('ลูกค้า')
}

// /wedding/customers — รายชื่อลูกค้าร้าน b.oncloud (ค้นหา / กรองช่องทางที่รู้จักร้าน / งานล่าสุด)
// ข้อมูลโหลดในหน้าเว็บ (ค้นหา/โหลดเพิ่มไม่ต้องโหลดทั้งหน้าใหม่) — ยังไม่รัน fix-07 → หน้าเว็บแสดงกล่องเตือนเอง
export default async function WeddingCustomersPage() {
  await requireWedding()
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">ลูกค้า</h1>
          <p className="page-subtitle">คู่บ่าวสาว ช่องทางติดต่อ และประวัติงานของแต่ละคู่</p>
        </div>
        <div className="page-actions">
          <Link href="/wedding/customers/new" className="btn-primary">
            <UserPlus {...ICON_SM} />
            เพิ่มลูกค้า
          </Link>
        </div>
      </div>
      <CustomersClient />
    </div>
  )
}
