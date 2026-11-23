import { requireWedding } from '@/lib/auth/permissions'
import { bangkokTodayKey, isDayKey } from '@/lib/format'
import DeliverablesBoardClient from '@/components/wedding/deliverables/DeliverablesBoardClient'
import { isBoardScope } from '@/components/wedding/deliverables/boardModel'
import { weddingPageMetadata } from '@/components/wedding/money/pageMeta'

export function generateMetadata() {
  return weddingPageMetadata('ส่งงาน/ตัดต่อ')
}

// สถานะงานต้องสดเสมอ (ทีมตัดต่ออัปเดตจากหลายเครื่อง) — ห้ามแคช
export const dynamic = 'force-dynamic'

// /wedding/deliverables — กระดานงานตัดต่อ/ส่งงานของทุกงาน (พนักงาน b.oncloud ทุกคน)
// ?status=open|overdue|delivered|all (ค่าเริ่มต้น = ยังไม่ส่ง) · ?from= &to= = ช่วงกำหนดส่ง (YYYY-MM-DD)
// ข้อมูลโหลดในหน้าเว็บ (เปลี่ยนตัวกรอง/บันทึกไม่ต้องโหลดทั้งหน้า) — ยังไม่รัน fix-07 → หน้าเว็บแสดงกล่องเตือนเอง
export default async function WeddingDeliverablesPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  await requireWedding()
  const rawStatus = typeof searchParams?.status === 'string' ? searchParams.status : ''
  const rawFrom = typeof searchParams?.from === 'string' ? searchParams.from.trim() : ''
  const rawTo = typeof searchParams?.to === 'string' ? searchParams.to.trim() : ''
  const from = isDayKey(rawFrom) ? rawFrom : ''
  const to = isDayKey(rawTo) && (!from || rawTo >= from) ? rawTo : ''

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">ส่งงาน/ตัดต่อ</h1>
          <p className="page-subtitle">งานที่ต้องตัดต่อและส่งให้ลูกค้าของทุกงาน เรียงตามกำหนดส่ง</p>
        </div>
      </div>
      <DeliverablesBoardClient
        initialScope={isBoardScope(rawStatus) ? rawStatus : 'open'}
        initialFrom={from}
        initialTo={to}
        today={bangkokTodayKey()}
      />
    </div>
  )
}
