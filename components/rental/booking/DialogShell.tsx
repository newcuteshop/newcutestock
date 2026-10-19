'use client'
// โครงป็อปอัปของหน้ารายละเอียดการจอง (แบบเดียวกับ components/pos/ReturnDialog):
// มือถือ = ชีตล่างเต็มความกว้าง สูงไม่เกิน 94dvh · จอใหญ่ = กล่องกลางจอ
// หัว (อยู่กับที่) → เนื้อหาเลื่อนได้ → ท้าย (อยู่กับที่ เว้นขอบล่างของ iPhone)
// Esc / แตะฉากหลัง = ปิด ยกเว้นระหว่างบันทึก (busy) · เปิดแล้วโฟกัสที่กล่อง (โปรแกรมอ่านจออ่านหัวเรื่องก่อน)
import { useEffect, useId, useRef, type ReactNode } from 'react'
import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'

export default function DialogShell({
  title,
  subtitle,
  icon,
  tone = 'brand',
  busy = false,
  wide = false,
  onClose,
  children,
  footer,
}: {
  title: string
  subtitle?: ReactNode
  icon?: ReactNode
  tone?: 'brand' | 'warn' | 'err' | 'ok'
  busy?: boolean
  wide?: boolean
  onClose(): void
  children: ReactNode
  footer?: ReactNode
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  // ค่าล่าสุดเสมอ (ผู้เรียกมักส่งฟังก์ชันใหม่ทุก render)
  const busyRef = useRef(busy)
  busyRef.current = busy
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    panelRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busyRef.current) {
        e.preventDefault()
        closeRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="fixed inset-0 z-[60] !mt-0 flex items-end sm:items-center justify-center scrim sm:p-4"
      onClick={e => { if (e.target === e.currentTarget && !busyRef.current) closeRef.current() }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={clsx(
          'sheet flex w-full flex-col max-h-[94dvh] sm:max-h-[90dvh] overflow-hidden rounded-b-none border-b-0 sm:rounded-4xl sm:border-b animate-fade-up outline-none',
          wide ? 'max-w-2xl' : 'max-w-lg',
        )}
      >
        <div className="shrink-0 flex items-center justify-between gap-3 border-b border-gray-200 px-4 sm:px-5 py-3">
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <span
                className={clsx(
                  'icon-bubble shrink-0',
                  tone === 'warn' && 'icon-bubble-warn',
                  tone === 'err' && 'icon-bubble-err',
                  tone === 'ok' && 'icon-bubble-ok',
                )}
                aria-hidden="true"
              >
                {icon}
              </span>
            )}
            <div className="min-w-0">
              <h3 id={titleId} className="text-lg font-semibold leading-snug text-gray-900 break-words">{title}</h3>
              {subtitle && <div className="text-xs text-gray-600 break-words">{subtitle}</div>}
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="ปิด" className="btn-icon btn-icon-plain -mr-2 shrink-0">
            <X {...ICON} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4 space-y-4">
          {children}
        </div>

        {footer && (
          <div
            className="shrink-0 border-t border-gray-200 bg-white px-4 sm:px-5 pt-3 space-y-2"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/** กล่องข้อความผิดพลาด/ไม่แน่ใจ (aria-live) — ใช้ในท้ายป็อปอัป */
export function DialogMessage({ tone, text }: { tone: 'err' | 'warn' | 'ok' | 'info'; text: string }) {
  if (!text) return null
  const cls = tone === 'err' ? 'alert-err' : tone === 'warn' ? 'alert-warn' : tone === 'ok' ? 'alert-ok' : 'alert-info'
  const Icon = tone === 'err' ? XCircle : tone === 'warn' ? AlertTriangle : tone === 'ok' ? CheckCircle2 : Info
  return (
    <div role={tone === 'err' || tone === 'warn' ? 'alert' : 'status'} className={cls}>
      <Icon {...ICON_SM} />
      <p className="min-w-0 break-words whitespace-pre-line">{text}</p>
    </div>
  )
}
