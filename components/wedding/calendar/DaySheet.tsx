'use client'
// กรอบรายละเอียดวันแบบป็อปอัป (จอแคบกว่า xl): มือถือ = ชีตล่างสูงเกือบเต็มจอ · แท็บเล็ต (md–xl) = แผงเลื่อนออกจากขวาเต็มความสูง
// แถบบนอยู่กับที่: วันก่อนหน้า / วันถัดไป / ปิด — เนื้อหาเลื่อนในกรอบ (ไม่ลากทั้งหน้า)
// Esc / แตะฉากหลัง = ปิด (suspendEsc = มีป็อปอัปซ้อนอยู่ข้างบน เช่น หน้ารูปตารางงาน → ให้ป็อปอัปบนสุดปิดก่อน)
// เปิดแล้วโฟกัสที่กรอบ · ปิดแล้วคืนโฟกัสให้ปุ่มที่กดเปิด (ช่องวันในตาราง)
import { useEffect, useRef, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'

export default function DaySheet({
  labelledBy,
  suspendEsc = false,
  onClose,
  onPrev,
  onNext,
  children,
}: {
  labelledBy: string
  suspendEsc?: boolean
  onClose(): void
  onPrev(): void
  onNext(): void
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const suspendRef = useRef(suspendEsc)
  suspendRef.current = suspendEsc
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !suspendRef.current) {
        e.preventDefault()
        closeRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      // คืนโฟกัส (ถ้าปุ่มเดิมยังอยู่ในหน้า)
      if (opener && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 !mt-0 flex items-end justify-center scrim md:items-stretch md:justify-end"
      onClick={e => { if (e.target === e.currentTarget) closeRef.current() }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="sheet flex h-[94dvh] w-full flex-col overflow-hidden rounded-b-none border-b-0 outline-none animate-fade-up md:h-full md:max-w-lg md:rounded-none md:border-y-0 md:border-r-0"
      >
        <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 px-2 py-1.5 sm:px-3">
          <button type="button" onClick={onPrev} className="btn-icon btn-icon-plain" aria-label="วันก่อนหน้า">
            <ChevronLeft {...ICON_SM} />
          </button>
          <button type="button" onClick={onNext} className="btn-icon btn-icon-plain" aria-label="วันถัดไป">
            <ChevronRight {...ICON_SM} />
          </button>
          <p className="min-w-0 flex-1 truncate text-center text-sm font-medium text-gray-600">รายละเอียดวัน</p>
          <button type="button" onClick={onClose} className="btn-icon btn-icon-plain" aria-label="ปิดรายละเอียดวัน">
            <X {...ICON} />
          </button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3 sm:px-4"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
