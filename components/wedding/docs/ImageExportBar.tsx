'use client'
// ===== ปุ่มส่งรูป (แชร์ / บันทึกรูป / คัดลอกรูป) + ข้อความผลลัพธ์ + รูปให้กดค้างบันทึก — คู่กับ useImageExport =====
// มือถือ: 3 ปุ่มเรียงแถวเดียว (สูง ≥ 44px) · ปุ่มหลัก = แชร์ (มือถือส่วนใหญ่เปิดแผ่นแชร์ → เลือก LINE)
// เครื่องที่แชร์ไฟล์ไม่ได้ (คอมพิวเตอร์) ปุ่มแชร์ยังกดได้ = บันทึกไฟล์แทน (บอกในข้อความ)
import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, Copy, Download, Info, Loader2, Share2, X, XCircle } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import type { ExportMessage, ImageExport } from './useImageExport'

export function ExportMessageBox({ message }: { message: ExportMessage | null }) {
  return (
    <div aria-live="polite">
      {message && (
        <div
          role={message.tone === 'err' || message.tone === 'warn' ? 'alert' : 'status'}
          className={
            message.tone === 'err' ? 'alert-err' : message.tone === 'warn' ? 'alert-warn' : message.tone === 'ok' ? 'alert-ok' : 'alert-info'
          }
        >
          {message.tone === 'err' ? <XCircle {...ICON_SM} /> : message.tone === 'warn' ? <AlertTriangle {...ICON_SM} /> : message.tone === 'ok' ? <CheckCircle2 {...ICON_SM} /> : <Info {...ICON_SM} />}
          <p className="min-w-0 break-words">{message.text}</p>
        </div>
      )}
    </div>
  )
}

/** ปุ่ม 3 ปุ่ม — disabled = เนื้อหายังไม่พร้อม (เช่น ยังไม่มีรายการให้ทำใบเสร็จ) */
export default function ImageExportBar({
  exp,
  disabled = false,
  className,
}: {
  exp: ImageExport
  disabled?: boolean
  className?: string
}) {
  const off = disabled || exp.busy
  // มือถือ: ช่องไฟไอคอน-ข้อความ 6px + ขอบใน 4px — จอ 375 ปุ่มละ ~109px ข้อความ "คัดลอกรูป" (15px/600) ต้องการ ~66px ; ขอบ px-2 + gap-2 เดิมเหลือ ~65px → ถูกตัดเป็น "คัดลอก…"
  return (
    <div className={clsx('grid grid-cols-3 gap-2', className)}>
      <button type="button" className="btn-primary min-w-0 gap-1.5 px-1 sm:gap-2 sm:px-4" onClick={() => void exp.share()} disabled={off}>
        {exp.action === 'share' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Share2 {...ICON_SM} />}
        <span className="truncate">แชร์</span>
      </button>
      <button type="button" className="btn-secondary min-w-0 gap-1.5 px-1 sm:gap-2 sm:px-4" onClick={() => void exp.download()} disabled={off}>
        {exp.action === 'download' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Download {...ICON_SM} />}
        <span className="truncate">บันทึกรูป</span>
      </button>
      <button type="button" className="btn-secondary min-w-0 gap-1.5 px-1 sm:gap-2 sm:px-4" onClick={() => void exp.copy()} disabled={off}>
        {exp.action === 'copy' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Copy {...ICON_SM} />}
        <span className="truncate">คัดลอกรูป</span>
      </button>
    </div>
  )
}

/** รูปผลลัพธ์ให้กดค้างบันทึก (เบราว์เซอร์ในแอป LINE / ดาวน์โหลดไม่ได้) */
export function ExportResultView({ exp, alt }: { exp: ImageExport; alt: string }) {
  if (!exp.result) return null
  return (
    <section className="panel space-y-2 p-3" aria-label="รูปที่สร้างแล้ว">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-sm font-semibold text-gray-900">รูปพร้อมแล้ว — กดค้างที่รูปเพื่อบันทึกหรือแชร์</p>
        <button type="button" className="btn-icon btn-icon-plain shrink-0" onClick={exp.clearResult} aria-label="ปิดรูป">
          <X {...ICON_SM} />
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={exp.result} alt={alt} className="mx-auto block h-auto max-h-[70dvh] w-auto max-w-full rounded-lg border border-gray-200 bg-white" />
    </section>
  )
}
