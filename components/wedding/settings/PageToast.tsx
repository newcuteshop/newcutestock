'use client'
// โทสต์ของหน้า (แบบเดียวกับหน้าตั้งค่าร้านเช่า) — สำเร็จหายเองใน 4 วินาที · ผิดพลาดค้างจนกดปิด
// วางท้ายหน้า: มือถือชิดล่างเหนือขอบ iPhone · จอใหญ่เลี่ยงเมนูข้าง (md:left = ความกว้างเมนู)
import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { Check, X } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'

export type ToastValue = { ok: boolean; text: string } | null

/** สถานะโทสต์ + ตั้งเวลาปิดเองเมื่อสำเร็จ */
export function useToast(): [ToastValue, (t: ToastValue) => void] {
  const [toast, setToast] = useState<ToastValue>(null)
  useEffect(() => {
    if (!toast || !toast.ok) return
    const t = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(t)
  }, [toast])
  const set = useCallback((t: ToastValue) => setToast(t), [])
  return [toast, set]
}

export default function PageToast({ toast, onClose }: { toast: ToastValue; onClose: () => void }) {
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
