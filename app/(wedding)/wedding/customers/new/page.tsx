import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireWedding } from '@/lib/auth/permissions'
import { ICON_SM } from '@/components/theme/icons'
import NewCustomerClient from '@/components/wedding/customers/NewCustomerClient'
import { weddingPageMetadata } from '@/components/wedding/money/pageMeta'

export function generateMetadata() {
  return weddingPageMetadata('เพิ่มลูกค้า')
}

// /wedding/customers/new — เพิ่มลูกค้าร้าน b.oncloud (พนักงานทุกคนเพิ่มได้)
export default async function NewWeddingCustomerPage() {
  await requireWedding()
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <Link href="/wedding/customers" className="link -mt-2 text-sm">
            <ArrowLeft {...ICON_SM} />
            กลับไปรายชื่อลูกค้า
          </Link>
          <h1 className="page-title">เพิ่มลูกค้าใหม่</h1>
          <p className="page-subtitle">กรอกอย่างน้อยชื่อผู้ติดต่อและเบอร์โทร — ข้อมูลอื่นเพิ่มภายหลังได้</p>
        </div>
      </div>
      <NewCustomerClient />
    </div>
  )
}
