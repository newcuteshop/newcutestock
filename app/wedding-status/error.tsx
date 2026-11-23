'use client'
import { useEffect } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import PortalShell from '@/components/wedding/portal/PortalShell'

// หน้าติดตามงานพังระหว่างแสดงผล (ข้อมูลผิดรูปแบบไม่คาดคิด / เน็ตหลุดตอนเปลี่ยนหน้า)
// ไม่พาไปหน้าระบบหลังร้าน ไม่บอกรายละเอียดทางเทคนิคกับลูกค้า
export default function WeddingStatusError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // บันทึกเฉพาะชื่อ/รหัสอ้างอิง (ไม่มีข้อมูลลูกค้า/โทเคนในข้อความ)
    console.error('wedding-status page error', error?.digest ?? error?.name)
  }, [error])

  return (
    <PortalShell shop={null}>
      <section className="card mx-auto w-full max-w-lg" role="alert">
        <div className="empty-state">
          <span className="icon-bubble icon-bubble-lg icon-bubble-warn" aria-hidden="true">
            <AlertTriangle size={28} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <h1 className="empty-state-title">เกิดข้อผิดพลาดชั่วคราว</h1>
          <p className="max-w-sm text-sm text-gray-600">กรุณาลองใหม่อีกครั้ง หากยังไม่ได้ ติดต่อร้านได้โดยตรง</p>
          {error?.digest && <p className="break-all text-xs text-gray-400">รหัสอ้างอิง: {error.digest}</p>}
          <button type="button" onClick={() => reset()} className="btn-primary mt-3">
            <RefreshCw {...ICON_SM} />
            ลองอีกครั้ง
          </button>
        </div>
      </section>
    </PortalShell>
  )
}
