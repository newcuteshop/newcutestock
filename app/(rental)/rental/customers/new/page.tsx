import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { isRentalManager, requireRental } from '@/lib/auth/permissions'
import { ICON_SM } from '@/components/theme/icons'
import NewCustomerClient from '@/components/rental/customers/NewCustomerClient'

// /rental/customers/new — เพิ่มลูกค้าร้านเช่าชุด (พนักงานร้านเช่าเพิ่มได้ ; ช่องบัญชีดำเฉพาะผู้จัดการ)
export default async function NewRentalCustomerPage() {
  const session = await requireRental()
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <Link href="/rental/customers" className="link -mt-2 text-sm">
            <ArrowLeft {...ICON_SM} />
            กลับไปรายชื่อลูกค้า
          </Link>
          <h1 className="page-title">เพิ่มลูกค้าใหม่</h1>
          <p className="page-subtitle">กรอกอย่างน้อยชื่อและเบอร์โทร — ข้อมูลอื่นเพิ่มภายหลังได้</p>
        </div>
      </div>
      <NewCustomerClient canManage={isRentalManager(session)} />
    </div>
  )
}
