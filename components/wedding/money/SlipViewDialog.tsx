'use client'
// ดูรูปสลิปโอนเงินของรายการเงิน (ถัง wedding-files เป็นแบบส่วนตัว — ขอลิงก์ชั่วคราว 10 นาทีทุกครั้งที่เปิด)
// สิทธิ์อ่านถัง = พนักงาน b.oncloud (นโยบาย storage ใน supabase-fix-07-wedding.sql)
// ขอลิงก์ไม่ได้ (ไฟล์หาย/เน็ตหลุด) → บอกเหตุ + ปุ่มลองใหม่ ; ไม่เปิดแท็บใหม่ (ใช้ได้ในเบราว์เซอร์ของ LINE)
import { useCallback, useEffect, useRef, useState } from 'react'
import { ImageOff, Loader2, ReceiptText, RefreshCw } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { baht, formatThaiDate } from '@/lib/format'
import { WEDDING_FILES_BUCKET, WED_METHOD_LABELS, WED_PAYMENT_KIND_LABELS, type WedPaymentRow } from '@/lib/wedding'
import type { BrowserSupabase } from '@/lib/products'
import DialogShell from '@/components/rental/booking/DialogShell'

const SLIP_URL_TTL_SEC = 600

export default function SlipViewDialog({
  row,
  supabase,
  onClose,
}: {
  row: WedPaymentRow
  supabase: BrowserSupabase
  onClose(): void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const reqRef = useRef(0)

  const sign = useCallback(async () => {
    const id = ++reqRef.current
    setState('loading')
    setUrl(null)
    try {
      if (!row.slip_path) throw new Error('no slip')
      const { data, error } = await supabase.storage.from(WEDDING_FILES_BUCKET).createSignedUrl(row.slip_path, SLIP_URL_TTL_SEC)
      if (id !== reqRef.current) return
      if (error || !data?.signedUrl) throw error ?? new Error('no url')
      setUrl(data.signedUrl)
      setState('ready')
    } catch {
      if (id === reqRef.current) setState('error')
    }
  }, [row.slip_path, supabase])

  useEffect(() => {
    void sign()
  }, [sign])

  return (
    <DialogShell
      title="สลิปโอนเงิน"
      subtitle={
        <span className="tabular-nums">
          {row.receipt_no ?? '-'} · {WED_PAYMENT_KIND_LABELS[row.kind]} {baht(row.amount)} · {WED_METHOD_LABELS[row.method]}
          {row.paid_on ? ` · ${formatThaiDate(row.paid_on)}` : ''}
        </span>
      }
      icon={<ReceiptText {...ICON_SM} />}
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="btn-secondary w-full sm:w-auto px-5">ปิด</button>
        </div>
      }
    >
      <div className="flex min-h-[16rem] items-center justify-center rounded-lg border border-gray-200 bg-gray-50 p-2" aria-live="polite">
        {state === 'loading' && (
          <span className="inline-flex items-center gap-2 text-sm text-gray-600">
            <Loader2 {...ICON_SM} className="animate-spin" />
            กำลังโหลดรูปสลิป...
          </span>
        )}
        {state === 'error' && (
          <div className="flex flex-col items-center gap-2 text-center text-sm text-gray-600">
            <ImageOff size={28} strokeWidth={1.75} aria-hidden="true" className="text-gray-400" />
            <p>โหลดรูปสลิปไม่สำเร็จ (ไฟล์อาจถูกลบ หรืออินเทอร์เน็ตขัดข้อง)</p>
            <button type="button" onClick={() => void sign()} className="btn-secondary px-4 text-sm">
              <RefreshCw {...ICON_SM} />
              ลองอีกครั้ง
            </button>
          </div>
        )}
        {state === 'ready' && url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={`สลิปของ ${row.receipt_no ?? 'รายการเงิน'}`}
            className="max-h-[70dvh] w-auto max-w-full rounded object-contain"
            onError={() => setState('error')}
          />
        )}
      </div>
      {row.booking_no && (
        <p className="text-sm text-gray-700 break-words">
          งาน <span className="font-mono">{row.booking_no}</span>{row.couple_names ? ` · ${row.couple_names}` : ''}
        </p>
      )}
      {row.note && <p className="text-sm text-gray-600 break-words">หมายเหตุ: {row.note}</p>}
    </DialogShell>
  )
}
