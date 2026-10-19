'use client'
// ตรวจสลิปโอนเงินที่ลูกค้าแนบจากหน้าจองออนไลน์ (rental_review_slip)
// รูปสลิปอยู่ในถังส่วนตัว rental-slips → ขอลิงก์ชั่วคราว 10 นาที (createSignedUrl) เฉพาะตอนเปิดดู
// อนุมัติ: แก้ยอดตามที่เงินเข้าจริงได้ + ยืนยันการจองอัตโนมัติเมื่อยอดถึงมัดจำ · ปฏิเสธ: ต้องมีเหตุผล (ลูกค้าเห็นสถานะ)
// ตรวจซ้ำ = เซิร์ฟเวอร์ปฏิเสธ "ตรวจไปแล้ว" → ไม่รู้ผลให้โหลดใหม่ สลิปไม่ได้รอตรวจแล้ว = สำเร็จ
// อนุมัติสลิปของการจองที่ยกเลิก/หมดเวลา/ไม่มารับแล้ว → เงินถูกบันทึก + เซิร์ฟเวอร์ส่ง review_warning ("ต้องคืนเงินลูกค้า") แสดงค้างไว้จนกดปิด
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { BadgeCheck, ExternalLink, Loader2, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON_SM } from '@/components/theme/icons'
import { baht, formatThaiDateTime } from '@/lib/format'
import { parseMoneyInput } from '@/lib/money'
import {
  MAX_RENTAL_MONEY, METHOD_LABELS, RENTAL_SLIP_BUCKET, parseReviewSlipResult, type RentalBooking, type RentalPayment,
} from '@/lib/rental'
import DialogShell, { DialogMessage } from './DialogShell'
import { runBookingWrite } from './rpc'

const REJECT_REASONS = ['ยอดเงินไม่ตรง', 'สลิปไม่ชัด', 'ไม่พบยอดเงินเข้าบัญชี', 'สลิปซ้ำ'] as const

export default function SlipReviewDialog({
  booking,
  payment,
  onClose,
  onApplied,
  reload,
}: {
  booking: RentalBooking
  payment: RentalPayment
  onClose(): void
  /** tone 'warn' = มีเรื่องที่ต้องทำต่อ (เช่น คืนเงินลูกค้า) — หน้าการจองแสดงค้างไว้จนกดปิด */
  onApplied(b: RentalBooking, message: string, tone?: 'ok' | 'warn'): void
  reload(): Promise<RentalBooking | null>
}) {
  const supabase = useMemo(() => createClient(), [])
  const amountId = useId()
  const reasonId = useId()
  const [url, setUrl] = useState<string | null>(null)
  const [urlError, setUrlError] = useState('')
  const [mode, setMode] = useState<'approve' | 'reject'>('approve')
  const [amount, setAmount] = useState(String(payment.amount))
  const [confirmBooking, setConfirmBooking] = useState(true)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<{ text: string; tone: 'err' | 'warn' } | null>(null)

  useEffect(() => {
    let alive = true
    if (!payment.slip_path) {
      setUrlError('ไม่มีไฟล์สลิปแนบมา')
      return
    }
    void (async () => {
      try {
        const { data, error: e } = await supabase.storage.from(RENTAL_SLIP_BUCKET).createSignedUrl(payment.slip_path as string, 600)
        if (!alive) return
        if (e || !data?.signedUrl) setUrlError('เปิดรูปสลิปไม่สำเร็จ ลองปิดแล้วเปิดใหม่')
        else setUrl(data.signedUrl)
      } catch {
        if (alive) setUrlError('เปิดรูปสลิปไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่')
      }
    })()
    return () => { alive = false }
  }, [supabase, payment.slip_path])

  const parsed = parseMoneyInput(amount)
  const amountOk = parsed !== null && parsed > 0 && parsed <= MAX_RENTAL_MONEY
  const cleanReason = reason.trim()
  const canSubmit = !busy && (mode === 'approve' ? amountOk : cleanReason.length >= 1 && cleanReason.length <= 200)

  async function submit() {
    if (busyRef.current || !canSubmit) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await runBookingWrite({
        sb: supabase,
        fn: 'rental_review_slip',
        args: {
          p_payment_id: payment.id,
          p_approve: mode === 'approve',
          p_amount: mode === 'approve' ? parsed : null,
          p_reason: mode === 'reject' ? cleanReason : null,
          p_confirm_booking: mode === 'approve' ? confirmBooking : false,
        },
        reload,
        verify: fresh => fresh.payments.some(p => p.id === payment.id && p.status !== 'pending_review'),
      })
      if (res.status === 'ok') {
        const confirmed = booking.status === 'pending' && res.booking.status === 'confirmed'
        // คำเตือนจากเซิร์ฟเวอร์ / ไม่รู้ผลแล้วยืนยันจากการโหลดใหม่ (ไม่มีคำตอบ) → คิดจากสถานะเอง
        const closed = res.booking.status === 'cancelled' || res.booking.status === 'expired' || res.booking.status === 'no_show'
        const warning = mode !== 'approve'
          ? null
          : res.data !== null && res.data !== undefined
            ? parseReviewSlipResult(res.data)?.review_warning ?? null
            : closed ? `การจองนี้${res.booking.status_label}แล้ว แต่บันทึกเงินจากสลิปนี้แล้ว — ติดต่อลูกค้าเพื่อคืนเงินหรือจองใหม่` : null
        if (warning) {
          onApplied(res.booking, `อนุมัติสลิปแล้ว — ${warning}`, 'warn')
        } else {
          onApplied(
            res.booking,
            mode === 'approve'
              ? `อนุมัติสลิปแล้ว${confirmed ? ' และยืนยันการจองแล้ว' : ''}`
              : 'ปฏิเสธสลิปแล้ว',
          )
        }
        onClose()
      } else {
        setError({ text: res.message, tone: res.status === 'unsure' ? 'warn' : 'err' })
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title="ตรวจสลิปโอนเงิน"
      subtitle={`การจอง ${booking.booking_no} · ${booking.customer.name}`}
      icon={<BadgeCheck {...ICON_SM} />}
      busy={busy}
      wide
      onClose={onClose}
      footer={
        <>
          {error && <DialogMessage tone={error.tone} text={error.text} />}
          <div className="flex gap-2 sm:justify-end">
            <button type="button" onClick={onClose} disabled={busy} className="btn-secondary px-5">ปิด</button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className={clsx(mode === 'approve' ? 'btn-primary' : 'btn-danger', 'flex-1 sm:flex-none sm:min-w-[180px]')}
            >
              {busy && <Loader2 {...ICON_SM} className="animate-spin" />}
              {busy ? 'กำลังบันทึก...' : mode === 'approve' ? `อนุมัติ ${amountOk && parsed !== null ? baht(parsed) : ''}` : 'ปฏิเสธสลิป'}
            </button>
          </div>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="panel flex min-h-[220px] items-center justify-center overflow-hidden p-2">
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className="block w-full" aria-label="เปิดรูปสลิปขนาดเต็ม">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="สลิปโอนเงินจากลูกค้า" className="mx-auto max-h-[52dvh] w-auto max-w-full object-contain" />
            </a>
          ) : urlError ? (
            <p className="text-sm text-gray-600 text-center px-3">{urlError}</p>
          ) : (
            <span className="skeleton block h-48 w-full" role="status"><span className="sr-only">กำลังโหลดรูปสลิป...</span></span>
          )}
        </div>
        <div className="space-y-3 text-sm">
          <dl className="panel grid grid-cols-2 gap-x-3 gap-y-1.5 px-3.5 py-3">
            <dt className="text-gray-600">ยอดที่ลูกค้าแจ้ง</dt>
            <dd className="text-right money text-gray-900">{baht(payment.amount)}</dd>
            <dt className="text-gray-600">ช่องทาง</dt>
            <dd className="text-right text-gray-900">{METHOD_LABELS[payment.method]}</dd>
            <dt className="text-gray-600">แนบเมื่อ</dt>
            <dd className="text-right text-gray-900">{formatThaiDateTime(payment.created_at)}</dd>
            <dt className="text-gray-600">ค้างชำระตอนนี้</dt>
            <dd className="text-right money text-gray-900">{baht(booking.money.due)}</dd>
            {!booking.money.deposit_met && (
              <>
                <dt className="text-gray-600">มัดจำที่ต้องจ่าย</dt>
                <dd className="text-right money text-gray-900">{baht(booking.money.deposit_required)}</dd>
              </>
            )}
          </dl>
          {payment.note && <p className="text-gray-700 break-words">หมายเหตุจากลูกค้า: {payment.note}</p>}
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1 text-sm">
              <ExternalLink {...ICON_SM} />
              เปิดรูปขนาดเต็ม
            </a>
          )}

          <div className="grid grid-cols-2 gap-2" role="group" aria-label="ผลการตรวจ">
            <button type="button" className="choice tone-leaf" aria-pressed={mode === 'approve'} disabled={busy} onClick={() => setMode('approve')}>
              <BadgeCheck {...ICON_SM} />
              อนุมัติ
            </button>
            <button type="button" className="choice tone-cherry" aria-pressed={mode === 'reject'} disabled={busy} onClick={() => setMode('reject')}>
              <XCircle {...ICON_SM} />
              ปฏิเสธ
            </button>
          </div>

          {mode === 'approve' ? (
            <>
              <div>
                <label htmlFor={amountId} className="field-label">ยอดเงินเข้าจริง (บาท) *</label>
                <input
                  id={amountId}
                  className="input text-right font-semibold tabular-nums"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  disabled={busy}
                  aria-invalid={!amountOk}
                  onChange={e => setAmount(e.target.value)}
                />
                <p className="field-hint">แก้ได้ถ้ายอดในสลิปไม่ตรงกับที่ลูกค้าแจ้ง</p>
              </div>
              {booking.status === 'pending' && (
                <label className="flex items-start gap-3 min-h-[44px] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={confirmBooking}
                    disabled={busy}
                    onChange={e => setConfirmBooking(e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
                  />
                  <span className="text-sm text-gray-800">ยืนยันการจองอัตโนมัติเมื่อยอดชำระถึงมัดจำ</span>
                </label>
              )}
            </>
          ) : (
            <div>
              <label htmlFor={reasonId} className="field-label">เหตุผลที่ปฏิเสธ *</label>
              <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="เหตุผลที่ใช้บ่อย">
                {REJECT_REASONS.map(r => (
                  <button key={r} type="button" className="chip-toggle" aria-pressed={cleanReason === r} disabled={busy} onClick={() => setReason(r)}>
                    {r}
                  </button>
                ))}
              </div>
              <input
                id={reasonId}
                className="input"
                value={reason}
                maxLength={200}
                disabled={busy}
                autoComplete="off"
                onChange={e => setReason(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>
    </DialogShell>
  )
}
