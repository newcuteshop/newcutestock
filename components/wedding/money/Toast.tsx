'use client'
// โทสต์ลอยท้ายจอ (ผลการบันทึก) — หน้าตาเดียวกับหน้าการเงินร้านเช่า
// สำเร็จ = หายเองใน 5 วินาที · ผิดพลาด/ไม่แน่ใจ = อยู่จนกดปิด (ผู้ใช้ต้องอ่านทัน) · aria-live ให้โปรแกรมอ่านจอประกาศ
import { useEffect } from 'react'
import clsx from 'clsx'
import { Check, X } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'

export type ToastMsg = { ok: boolean; text: string } | null

export default function Toast({ toast, onClose }: { toast: ToastMsg; onClose(): void }) {
  useEffect(() => {
    if (!toast || !toast.ok) return
    const t = window.setTimeout(onClose, 5000)
    return () => window.clearTimeout(t)
  }, [toast, onClose])

  if (!toast) return null
  return (
    <div
      role={toast.ok ? 'status' : 'alert'}
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 z-40 flex justify-center bottom-[calc(1rem_+_env(safe-area-inset-bottom))] md:left-[calc(15rem_+_1rem)] lg:bottom-6"
    >
      <div className={clsx(toast.ok ? 'toast-ok' : 'toast-err', 'pointer-events-auto')}>
        <span className="toast-icon">
          {toast.ok
            ? <Check size={18} strokeWidth={2.4} aria-hidden="true" />
            : <X size={18} strokeWidth={2.4} aria-hidden="true" />}
        </span>
        <span className="min-w-0 break-words">{toast.text}</span>
        <button
          type="button"
          onClick={onClose}
          className="btn-icon btn-icon-plain -my-1 -mr-3 text-current"
          aria-label="ปิดข้อความ"
        >
          <X {...ICON_SM} />
        </button>
      </div>
    </div>
  )
}
