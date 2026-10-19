'use client'
import { useEffect, useId, useRef } from 'react'
import { FileText, X } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'

// ป็อปอัปเงื่อนไขการเช่าชุด (ข้อความจากตั้งค่าร้าน terms_text) — แต่ละบรรทัดที่ไม่ว่าง = 1 ข้อ เลขข้อเรียงใหม่ให้เอง
// (ร้านพิมพ์ "1." นำหน้ามาเองก็ได้ ระบบตัดเลขเดิมออกก่อนเรียงใหม่ — เลขไม่ซ้ำ/ไม่ข้าม)
// Esc / แตะพื้นหลัง / ปุ่มปิด = ปิด · ปุ่ม "ยอมรับเงื่อนไข" = ติ๊กช่องยอมรับให้แล้วปิด

export function termsClauses(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(l => l.replace(/^\s*(?:ข้อ\s*[0-9๐-๙]{1,3}\s*[.):]?|[0-9๐-๙]{1,3}\s*[.)](?=\s|$))\s*/, '').trim())
    .filter(l => l !== '')
}

export default function TermsDialog({
  open, shopName, termsText, onClose, onAccept,
}: {
  open: boolean
  shopName: string
  termsText: string
  onClose: () => void
  onAccept?: () => void
}) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  const clauses = termsClauses(termsText)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center scrim p-3 sm:items-center sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="sheet flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden animate-pop-in"
      >
        <div className="flex items-start gap-3 border-b border-gray-200 px-5 py-4">
          <span className="icon-bubble shrink-0" aria-hidden="true">
            <FileText {...ICON_SM} />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 id={titleId} className="text-lg font-semibold leading-snug text-gray-900">เงื่อนไขการเช่าชุด</h2>
            <p className="text-sm text-gray-500 break-words">{shopName}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="ปิด" className="btn-icon btn-icon-plain -mr-2 -mt-1 shrink-0">
            <X {...ICON_SM} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {clauses.length === 0 ? (
            <p className="text-sm text-gray-600">ร้านยังไม่ได้กำหนดเงื่อนไขการเช่า — สอบถามรายละเอียดกับร้านได้โดยตรง</p>
          ) : (
            <ol className="list-decimal space-y-2 pl-6 text-sm leading-relaxed text-gray-800">
              {clauses.map((c, i) => (
                <li key={i} className="break-words pl-1">{c}</li>
              ))}
            </ol>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-gray-200 px-5 py-3 pb-[calc(0.75rem_+_env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:pb-3">
          <button type="button" onClick={onClose} className="btn-secondary w-full sm:w-auto">
            ปิด
          </button>
          {onAccept && (
            <button type="button" onClick={onAccept} className="btn-primary w-full sm:w-auto">
              อ่านแล้ว ยอมรับเงื่อนไข
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
