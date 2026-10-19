'use client'
import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'

// หน้าจองออนไลน์พังระหว่างแสดงผล (ข้อมูลผิดรูปแบบไม่คาดคิด / เน็ตหลุดตอนเปลี่ยนหน้า)
// แสดงภายใต้แถบบน/ท้ายหน้าของร้าน — ไม่พาไปหน้าระบบหลังร้าน ไม่บอกรายละเอียดทางเทคนิคกับลูกค้า
export default function BookError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // บันทึกเฉพาะชื่อ/รหัสอ้างอิง (ไม่มีข้อมูลลูกค้า/โทเคนในข้อความ error ของหน้า)
    console.error('book page error', error?.digest ?? error?.name)
  }, [error])

  return (
    <section className="card mx-auto w-full max-w-lg" role="alert">
      <div className="empty-state">
        <span className="icon-bubble icon-bubble-lg icon-bubble-warn" aria-hidden="true">
          <AlertTriangle size={28} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <h1 className="empty-state-title">เกิดข้อผิดพลาดชั่วคราว</h1>
        <p className="max-w-sm text-sm text-gray-600">กรุณาลองใหม่อีกครั้ง หากยังไม่ได้ ติดต่อร้านได้โดยตรง</p>
        {error?.digest && <p className="text-xs text-gray-400 break-all">รหัสอ้างอิง: {error.digest}</p>}
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => reset()} className="btn-primary">
            <RefreshCw {...ICON_SM} />
            ลองอีกครั้ง
          </button>
          <Link href="/book" className="btn-secondary">
            กลับหน้าแรก
          </Link>
        </div>
      </div>
    </section>
  )
}
