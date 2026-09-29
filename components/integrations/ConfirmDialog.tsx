'use client'
// ป็อปอัปยืนยันก่อนทำรายการที่ย้อนกลับไม่ได้ (ตัดการเชื่อมต่อ, ส่งสต๊อกครั้งแรก, สร้างลิงก์ฟีดใหม่ ...)
// requireAck = ต้องติ๊กช่องยืนยันก่อนจึงกดปุ่มได้ (ใช้กับเรื่องที่ทับข้อมูลบนแพลตฟอร์ม)
import { useEffect, useId, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { AlertTriangle, Loader2, X } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'

export default function ConfirmDialog({
  open, title, children, confirmLabel, tone = 'primary', requireAck, busy = false, onConfirm, onCancel, wide = false,
}: {
  open: boolean
  title: string
  children?: ReactNode
  confirmLabel: string
  tone?: 'primary' | 'danger'
  requireAck?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  wide?: boolean
}) {
  const [ack, setAck] = useState(false)
  const titleId = useId()
  const ackId = useId()

  // เปิดใหม่ทุกครั้ง = ต้องติ๊กยืนยันใหม่
  useEffect(() => {
    if (open) setAck(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onCancel])

  if (!open) return null
  const canConfirm = !busy && (!requireAck || ack)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center scrim p-3 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget && !busy) onCancel() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={clsx(
          'sheet w-full max-h-[90dvh] overflow-y-auto overscroll-contain p-5 space-y-4 pb-[calc(1.25rem_+_env(safe-area-inset-bottom))] sm:pb-5 animate-pop-in',
          wide ? 'max-w-2xl' : 'max-w-md',
        )}
      >
        <div className="flex items-start gap-3">
          <span className={clsx('icon-bubble shrink-0', tone === 'danger' ? 'icon-bubble-err' : 'icon-bubble-warn')} aria-hidden="true">
            <AlertTriangle {...ICON_SM} />
          </span>
          <h3 id={titleId} className="min-w-0 flex-1 pt-2 text-lg font-bold leading-snug text-gray-900 break-words">{title}</h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="ปิด"
            className="btn-icon btn-icon-plain -mr-2 -mt-1 shrink-0"
          >
            <X {...ICON_SM} />
          </button>
        </div>

        {children && <div className="space-y-3 text-sm text-gray-700 leading-relaxed">{children}</div>}

        {requireAck && (
          <label htmlFor={ackId} className="panel flex items-start gap-3 p-3 min-h-[44px] cursor-pointer select-none">
            <input
              id={ackId}
              type="checkbox"
              checked={ack}
              disabled={busy}
              onChange={e => setAck(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
            />
            <span className="min-w-0 text-sm font-medium text-gray-900">{requireAck}</span>
          </label>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={busy} autoFocus className="btn-secondary w-full sm:w-auto px-5">
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className={clsx(tone === 'danger' ? 'btn-danger' : 'btn-primary', 'w-full sm:w-auto px-5')}
          >
            {busy && <Loader2 {...ICON_SM} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
