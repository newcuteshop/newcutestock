import type { Metadata } from 'next'
import PortalShell from '@/components/wedding/portal/PortalShell'
import PortalNotice from '@/components/wedding/portal/PortalNotice'

// /wedding-status (ไม่มีโทเคน) — ลูกค้าพิมพ์ลิงก์ไม่ครบ: บอกให้ใช้ลิงก์ที่ร้านส่งให้ (ไม่พาไปหน้าเข้าสู่ระบบ)
export const metadata: Metadata = {
  title: { absolute: 'ติดตามงาน' },
}

export default function WeddingStatusIndex() {
  return (
    <PortalShell shop={null}>
      <PortalNotice
        kind="notFound"
        title="ลิงก์ไม่ครบ"
        message="กรุณาเปิดลิงก์ติดตามงานที่ร้านส่งให้ทาง LINE (ลิงก์จะมีรหัสยาวต่อท้าย) หรือติดต่อร้านพร้อมแจ้งชื่อคู่บ่าวสาว"
      />
    </PortalShell>
  )
}
