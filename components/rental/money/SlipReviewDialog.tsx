'use client'
// ป็อปอัปตรวจสลิปโอนเงินที่ลูกค้าแนบมาจากหน้าจองออนไลน์ → อนุมัติ (แก้ยอดได้) / ปฏิเสธ (ต้องมีเหตุผล)
// เรียก rental_review_slip(p_payment_id, p_approve, p_amount, p_reason, p_confirm_booking) — ฐานข้อมูลคำนวณยอดการจองใหม่เอง
// กันบันทึกซ้ำ: ปุ่มล็อกระหว่างส่ง (ref + state) ; ฐานข้อมูลก็ปฏิเสธการตรวจซ้ำเองอยู่แล้ว ("สลิปนี้ตรวจไปแล้ว")
// เน็ตหลุดระหว่างส่ง (ไม่รู้ว่าบันทึกไปหรือยัง) → อ่านสถานะสลิปจากฐานข้อมูลก่อนเสมอ ค่อยให้กดซ้ำ
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  AlertCircle, AlertTriangle, CheckCircle2, ExternalLink, FileWarning, Loader2, RefreshCw, X, XCircle,
} from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { baht, formatThaiDate, formatThaiDateTime } from '@/lib/format'
import { parseMoneyInput, round2 } from '@/lib/money'
import {
  formatPhone, MAX_RENTAL_MONEY, parseBookingResult, parseReviewSlipResult, STATUS_CHIP, STATUS_LABELS, type RentalBooking,
} from '@/lib/rental'
import type { BrowserSupabase } from '@/lib/products'
import { rentalErrorText, serverAnswered, type PaymentRow } from './moneyRows'
import type { SignedSlipUrl } from './slipUrls'

export interface SlipReviewResult {
  paymentId: string
  approved: boolean
  amount: number | null
  /** การจองหลังตรวจ (null = ยืนยันผลจากการอ่านสถานะซ้ำหลังเน็ตหลุด ไม่มีข้อมูลการจองล่าสุด) */
  booking: RentalBooking | null
  autoConfirmed: boolean
  /** คำเตือนจากฐานข้อมูลหลังอนุมัติ (เช่น การจองถูกยกเลิก/หมดเวลาแล้ว ต้องคืนเงินลูกค้า) — null = ไม่มี */
  warning: string | null
}

type Mode = 'approve' | 'reject'

const REJECT_REASONS = ['ยอดเงินไม่ตรงกับสลิป', 'สลิปไม่ชัด อ่านไม่ได้', 'ไม่พบยอดเงินเข้าบัญชีร้าน', 'สลิปซ้ำกับที่แจ้งแล้ว']
const MAX_REASON = 200

const UNSURE_MSG =
  'ไม่แน่ใจว่าบันทึกสำเร็จหรือไม่ (เน็ตหลุดระหว่างส่ง) — ตรวจสอบแล้วสลิปนี้ยังรอตรวจอยู่ กดอีกครั้งได้'
const UNSURE_UNKNOWN_MSG =
  'ไม่แน่ใจว่าบันทึกสำเร็จหรือไม่ และตรวจสอบสถานะล่าสุดไม่ได้ — กด "ตรวจสอบสถานะ" ก่อน แล้วค่อยกดอีกครั้ง'

function moneyText(n: number): string {
  return String(round2(n))
}

export default function SlipReviewDialog({
  open,
  row,
  slip,
  supabase,
  onClose,
  onDone,
  onReloadSlip,
  onStale,
}: {
  open: boolean
  row: PaymentRow | null
  /** ลิงก์รูปสลิป (undefined = ยังไม่ได้ขอ / กำลังขอ) */
  slip: SignedSlipUrl | undefined
  supabase: BrowserSupabase
  onClose: () => void
  onDone: (result: SlipReviewResult) => void
  /** ขอลิงก์รูปใหม่ (ลิงก์หมดอายุ/โหลดรูปไม่ได้) */
  onReloadSlip: () => void
  /** ข้อมูลในรายการเก่าแล้ว (มีคนตรวจสลิปนี้ไปแล้ว) → ปิดป็อปอัปแล้วโหลดรายการใหม่ */
  onStale: () => void
}) {
  const [mode, setMode] = useState<Mode>('approve')
  const [amountText, setAmountText] = useState('')
  const [confirmBooking, setConfirmBooking] = useState(true)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  // ส่งแล้วไม่รู้ผล + อ่านสถานะซ้ำไม่ได้ → ห้ามกดซ้ำจนกว่าจะตรวจสอบสถานะสำเร็จ
  const [unsure, setUnsure] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const amountId = useId()
  const amountHintId = useId()
  const reasonId = useId()
  const confirmId = useId()

  const paymentId = row?.id ?? ''

  // เปิดสลิปใหม่ → ฟอร์มเริ่มใหม่ (ยอดตั้งต้น = ยอดที่ลูกค้าแจ้ง)
  useEffect(() => {
    if (!open || !row) return
    setMode('approve')
    setAmountText(moneyText(row.amount))
    setConfirmBooking(true)
    setReason('')
    setError('')
    setStale(false)
    setUnsure(false)
    setImgFailed(false)
    const t = window.setTimeout(() => closeRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
    // เปลี่ยนเฉพาะเมื่อเปิดสลิปใบใหม่ (row object ใหม่จากการโหลดซ้ำของใบเดิมไม่ล้างสิ่งที่กรอก)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, paymentId])

  // ลิงก์รูปเปลี่ยน (ขอใหม่แล้ว) → ลองแสดงรูปอีกครั้ง
  useEffect(() => {
    setImgFailed(false)
  }, [slip?.url])

  const close = useCallback(() => {
    if (!busyRef.current) onClose()
  }, [onClose])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busyRef.current) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !row) return null

  const booking = row.booking
  const claimed = row.amount
  const parsedAmount = parseMoneyInput(amountText)
  let amountProblem = ''
  if (amountText.trim() === '') amountProblem = 'กรุณาใส่ยอดเงินที่ได้รับจริง'
  else if (parsedAmount === null) amountProblem = 'รูปแบบจำนวนเงินไม่ถูกต้อง (ใส่เฉพาะตัวเลข เช่น 1500 หรือ 1,500.50)'
  else if (parsedAmount <= 0) amountProblem = 'ยอดเงินต้องมากกว่า 0'
  else if (parsedAmount > MAX_RENTAL_MONEY) amountProblem = 'ยอดเงินสูงเกินไป'
  const amount = amountProblem ? null : parsedAmount
  const due = booking ? booking.due : 0
  const over = amount !== null && booking ? round2(amount - Math.max(0, due)) : 0
  const reasonClean = reason.trim()
  const reasonProblem = reasonClean === '' ? 'กรุณาระบุเหตุผลที่ปฏิเสธ' : reasonClean.length > MAX_REASON ? `เหตุผลยาวเกินไป (สูงสุด ${MAX_REASON} ตัวอักษร)` : ''
  const isPending = booking?.status === 'pending'
  const bookingClosed = booking ? ['cancelled', 'expired', 'no_show', 'completed'].includes(booking.status) : false
  const canSubmit = !busy && !stale && !unsure && (mode === 'approve' ? amount !== null : !reasonProblem)
  // ยอดหลังอนุมัติ (ประมาณ) — ใช้บอกว่าจะถึงมัดจำไหม (ฐานข้อมูลตัดสินจริง)
  const paidAfter = booking && amount !== null ? round2(booking.paid + amount) : null
  const willMeetDeposit = booking && paidAfter !== null ? paidAfter >= booking.deposit_required - 0.005 : false

  // อ่านสถานะสลิปจากฐานข้อมูล (หลังส่งแล้วไม่รู้ผล) → ตรวจไปแล้ว = จบงาน ; ยังรอตรวจ = ให้กดใหม่ได้
  async function verifyStatus(): Promise<'done' | 'pending' | 'unknown'> {
    try {
      const { data, error: readError } = await supabase
        .from('rental_payments')
        .select('status, amount, voided_at')
        .eq('id', paymentId)
        .maybeSingle()
      if (readError) return 'unknown'
      const st = data && typeof data === 'object' ? String((data as { status?: unknown }).status ?? '') : ''
      if (!data || st === '') return 'unknown'
      if (st === 'pending_review') return 'pending'
      onDone({
        paymentId,
        approved: st === 'confirmed',
        amount: st === 'confirmed' ? round2(Number((data as { amount?: unknown }).amount) || 0) : null,
        booking: null,
        autoConfirmed: false,
        // ยืนยันผลจากการอ่านสถานะสลิป (ไม่มีคำตอบของฐานข้อมูล) → ดูสถานะการจองที่แนบมาเอง
        warning: st === 'confirmed' && booking && ['cancelled', 'expired', 'no_show'].includes(booking.status)
          ? `การจองนี้${STATUS_LABELS[booking.status]}แล้ว แต่บันทึกเงินจากสลิปนี้แล้ว — ติดต่อลูกค้าเพื่อคืนเงินหรือจองใหม่`
          : null,
      })
      return 'done'
    } catch {
      return 'unknown'
    }
  }

  async function handleUnsure() {
    const st = await verifyStatus()
    if (st === 'done') return
    if (st === 'pending') {
      setUnsure(false)
      setError(UNSURE_MSG)
    } else {
      setUnsure(true)
      setError(UNSURE_UNKNOWN_MSG)
    }
  }

  async function checkStatus() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await handleUnsure()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function submit() {
    if (busyRef.current || !canSubmit) return
    busyRef.current = true
    setBusy(true)
    setError('')
    const approve = mode === 'approve'
    try {
      const { data, error: rpcError } = await supabase.rpc('rental_review_slip', {
        p_payment_id: paymentId,
        p_approve: approve,
        p_amount: approve ? amount : null,
        p_reason: approve ? null : reasonClean,
        // ยืนยันการจองให้อัตโนมัติ (ฐานข้อมูลยืนยันเฉพาะเมื่อการจองรอยืนยันและยอดถึงมัดจำแล้ว)
        p_confirm_booking: approve ? confirmBooking : false,
      })
      if (rpcError) {
        if (!serverAnswered(rpcError)) {
          await handleUnsure()
          return
        }
        const msg = rentalErrorText(rpcError)
        setError(msg)
        if (msg.includes('โหลดหน้าใหม่')) setStale(true)
        return
      }
      const after = parseBookingResult(data)
      onDone({
        paymentId,
        approved: approve,
        amount: approve ? amount : null,
        booking: after,
        autoConfirmed: approve && booking?.status === 'pending' && after?.status === 'confirmed',
        warning: approve ? parseReviewSlipResult(data)?.review_warning ?? null : null,
      })
    } catch (err) {
      if (serverAnswered(err)) setError(rentalErrorText(err))
      else await handleUnsure()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const slipUrl = slip?.url ?? null

  return (
    <div
      className="fixed inset-0 z-50 !mt-0 flex items-end sm:items-center justify-center scrim p-3 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) close() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="sheet w-full max-w-3xl max-h-[92dvh] overflow-y-auto overscroll-contain animate-pop-in"
      >
        {/* หัว (ติดบนเวลาเลื่อน) */}
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-gray-150 bg-white px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold leading-snug text-gray-900">ตรวจสลิปโอนเงิน</h2>
            <p className="mt-0.5 text-sm text-gray-500 break-words">
              การจอง <span className="font-mono text-gray-700">{booking?.booking_no || '-'}</span>
              {' · '}แจ้งเมื่อ <span className="tabular-nums">{formatThaiDateTime(row.created_at)}</span>
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            disabled={busy}
            aria-label="ปิด"
            className="btn-icon btn-icon-plain -mr-2 -mt-1 shrink-0"
          >
            <X {...ICON_SM} />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
          {/* ===== รูปสลิป ===== */}
          <div className="min-w-0 space-y-2">
            <div className="panel flex min-h-[200px] items-center justify-center overflow-hidden p-2 md:min-h-[240px]">
              {!row.slip_path ? (
                <p className="flex items-center gap-2 px-3 text-center text-sm text-gray-500">
                  <FileWarning {...ICON_SM} className="shrink-0" />
                  รายการนี้ไม่มีไฟล์สลิปแนบมา
                </p>
              ) : slip === undefined ? (
                <span role="status" className="skeleton block h-[240px] w-full rounded-lg md:h-[320px]">
                  <span className="sr-only">กำลังโหลดรูปสลิป...</span>
                </span>
              ) : !slipUrl || imgFailed ? (
                <div role="alert" className="space-y-2 px-3 text-center text-sm text-gray-600">
                  <p>โหลดรูปสลิปไม่ได้ (ลิงก์หมดอายุหรือเน็ตหลุด)</p>
                  <button type="button" onClick={onReloadSlip} className="btn-secondary px-4 text-sm">
                    <RefreshCw {...ICON_SM} />
                    โหลดรูปใหม่
                  </button>
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={slipUrl}
                  alt={`สลิปโอนเงินของการจอง ${booking?.booking_no ?? ''}`}
                  className="block max-h-[42dvh] w-auto max-w-full rounded-md bg-white object-contain md:max-h-[60dvh]"
                  onError={() => setImgFailed(true)}
                />
              )}
            </div>
            {slipUrl && !imgFailed && (
              <a
                href={slipUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost -ml-2 min-h-[44px] px-2 text-sm"
              >
                <ExternalLink {...ICON_SM} />
                เปิดรูปขนาดเต็ม
              </a>
            )}
          </div>

          {/* ===== ข้อมูลการจอง + ตัดสินใจ ===== */}
          <div className="min-w-0 space-y-4">
            {booking ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={STATUS_CHIP[booking.status]}>{STATUS_LABELS[booking.status]}</span>
                  <span className="text-sm text-gray-600 tabular-nums">
                    รับ {formatThaiDate(booking.pickup_date)} – คืน {formatThaiDate(booking.return_date)}
                  </span>
                </div>
                <p className="text-sm text-gray-900 break-words">
                  <span className="font-semibold">{booking.customer_name || '-'}</span>
                  {booking.customer_phone && <span className="text-gray-600 tabular-nums"> · {formatPhone(booking.customer_phone)}</span>}
                </p>
                <dl className="panel grid grid-cols-2 gap-x-3 gap-y-1.5 p-3 text-sm">
                  <dt className="text-gray-600">ยอดรวม</dt>
                  <dd className="text-right font-medium tabular-nums text-gray-900">{baht(booking.grand_total)}</dd>
                  <dt className="text-gray-600">ชำระแล้ว</dt>
                  <dd className="text-right font-medium tabular-nums text-gray-900">{baht(booking.paid)}</dd>
                  <dt className="text-gray-600">ค้างชำระ</dt>
                  <dd className={clsx('text-right font-semibold tabular-nums', booking.due > 0 ? 'text-red-700' : 'text-gray-900')}>
                    {baht(booking.due)}
                  </dd>
                  <dt className="text-gray-600">มัดจำที่ต้องจ่าย</dt>
                  <dd className="text-right font-medium tabular-nums text-gray-900">
                    {baht(booking.deposit_required)}
                    {booking.deposit_met && <span className="ml-1 text-xs text-green-700">(ครบแล้ว)</span>}
                  </dd>
                </dl>
                {booking.status === 'pending' && booking.expires_at && (
                  <p className="text-xs text-gray-600 tabular-nums">
                    ถือการจองไว้ถึง {formatThaiDateTime(booking.expires_at)} — ยืนยันก่อนเวลานี้ ไม่งั้นคำขอหมดอายุ
                  </p>
                )}
              </div>
            ) : (
              <p className="panel p-3 text-sm text-gray-600">อ่านข้อมูลการจองไม่ได้ — ตรวจที่หน้าการจองก่อนอนุมัติ</p>
            )}

            <div className="panel space-y-1 p-3">
              <p className="text-sm text-gray-600">ยอดที่ลูกค้าแจ้งโอน</p>
              <p className="money text-2xl text-gray-900">{baht(claimed)}</p>
              {row.note && <p className="text-sm text-gray-700 break-words">หมายเหตุจากลูกค้า: {row.note}</p>}
            </div>

            {bookingClosed && (
              <div className="alert-warn">
                <AlertTriangle {...ICON_SM} />
                <p className="min-w-0 break-words">
                  การจองนี้{booking ? STATUS_LABELS[booking.status] : ''}แล้ว — ถ้าเงินเข้าบัญชีจริงให้อนุมัติ แล้วบันทึกคืนเงินที่หน้าการจอง
                </p>
              </div>
            )}

            {/* อนุมัติ / ปฏิเสธ — ปุ่มสลับแบบ aria-pressed (สีเขียว/แดงของ .choice.tone-* ผูกกับ aria-pressed) */}
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="ผลการตรวจสลิป">
              <button
                type="button"
                aria-pressed={mode === 'approve'}
                onClick={() => { setMode('approve'); setError('') }}
                disabled={busy}
                className="choice tone-leaf min-h-[48px]"
              >
                <CheckCircle2 {...ICON_SM} />
                อนุมัติ
              </button>
              <button
                type="button"
                aria-pressed={mode === 'reject'}
                onClick={() => { setMode('reject'); setError('') }}
                disabled={busy}
                className="choice tone-cherry min-h-[48px]"
              >
                <XCircle {...ICON_SM} />
                ปฏิเสธ
              </button>
            </div>

            {mode === 'approve' ? (
              <div className="space-y-3">
                <div>
                  <label htmlFor={amountId} className="field-label">ยอดเงินที่ได้รับจริง (บาท)</label>
                  <input
                    id={amountId}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    className="input text-right text-lg font-semibold tabular-nums"
                    value={amountText}
                    disabled={busy}
                    aria-invalid={amountProblem && amountText.trim() !== '' ? true : undefined}
                    aria-describedby={amountHintId}
                    onChange={e => { setAmountText(e.target.value); setError('') }}
                    onFocus={e => e.currentTarget.select()}
                  />
                  {amountProblem && amountText.trim() !== '' ? (
                    <p id={amountHintId} role="alert" className="mt-1 text-sm text-red-700">{amountProblem}</p>
                  ) : (
                    <p id={amountHintId} className="field-hint">ตรวจยอดกับแอปธนาคารของร้าน — ยอดไม่ตรงกับที่ลูกค้าแจ้ง แก้ได้ที่ช่องนี้</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setAmountText(moneyText(claimed))}
                      disabled={busy}
                      className="chip-toggle"
                      aria-pressed={amount !== null && Math.abs(amount - claimed) < 0.005}
                    >
                      ตามที่แจ้ง {baht(claimed)}
                    </button>
                    {booking && due > 0 && Math.abs(due - claimed) >= 0.005 && (
                      <button
                        type="button"
                        onClick={() => setAmountText(moneyText(due))}
                        disabled={busy}
                        className="chip-toggle"
                        aria-pressed={amount !== null && Math.abs(amount - due) < 0.005}
                      >
                        ยอดค้าง {baht(due)}
                      </button>
                    )}
                  </div>
                </div>

                {booking && amount !== null && over > 0.005 && (
                  <div className="alert-warn">
                    <AlertTriangle {...ICON_SM} />
                    <p className="min-w-0 break-words">
                      ยอดนี้เกินยอดค้าง {baht(over)} — อนุมัติได้ แต่หลังอนุมัติให้บันทึก &quot;คืนเงิน&quot; ส่วนเกินที่หน้าการจอง
                    </p>
                  </div>
                )}

                {isPending && (
                  <label htmlFor={confirmId} className="panel flex min-h-[48px] cursor-pointer select-none items-start gap-3 p-3">
                    <input
                      id={confirmId}
                      type="checkbox"
                      checked={confirmBooking}
                      disabled={busy}
                      onChange={e => setConfirmBooking(e.target.checked)}
                      className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
                    />
                    <span className="min-w-0 text-sm">
                      <span className="block font-medium text-gray-900">ยืนยันการจองให้อัตโนมัติเมื่อยอดถึงมัดจำ</span>
                      <span className="block text-xs text-gray-500">
                        {booking && amount !== null
                          ? willMeetDeposit
                            ? `หลังอนุมัติชำระแล้ว ${baht(paidAfter)} ถึงมัดจำ ${baht(booking.deposit_required)} — การจองจะเปลี่ยนเป็น "จองแล้ว"`
                            : `หลังอนุมัติชำระแล้ว ${baht(paidAfter)} ยังไม่ถึงมัดจำ ${baht(booking.deposit_required)} — การจองยังรอยืนยัน`
                          : 'การจองจะเปลี่ยนเป็น "จองแล้ว" เมื่อยอดชำระถึงมัดจำ'}
                      </span>
                    </span>
                  </label>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <label htmlFor={reasonId} className="field-label">เหตุผลที่ปฏิเสธ (ลูกค้าเห็นข้อความนี้)</label>
                <textarea
                  id={reasonId}
                  className="input"
                  rows={2}
                  maxLength={MAX_REASON}
                  value={reason}
                  disabled={busy}
                  aria-invalid={reason !== '' && reasonProblem ? true : undefined}
                  onChange={e => { setReason(e.target.value); setError('') }}
                />
                {reason !== '' && reasonProblem && <p role="alert" className="text-sm text-red-700">{reasonProblem}</p>}
                <div className="flex flex-wrap gap-2" role="group" aria-label="เหตุผลที่ใช้บ่อย">
                  {REJECT_REASONS.map(r => (
                    <button
                      key={r}
                      type="button"
                      className="chip-toggle"
                      aria-pressed={reasonClean === r}
                      disabled={busy}
                      onClick={() => { setReason(r); setError('') }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div aria-live="polite">
              {error && (
                <div role="alert" className="alert-err">
                  <AlertCircle {...ICON_SM} />
                  <div className="min-w-0 space-y-2">
                    <p className="break-words">{error}</p>
                    {stale && (
                      <button type="button" onClick={onStale} className="btn-secondary bg-white px-4 text-sm">
                        <RefreshCw {...ICON_SM} />
                        โหลดรายการใหม่
                      </button>
                    )}
                    {unsure && (
                      <button type="button" onClick={() => void checkStatus()} disabled={busy} className="btn-secondary bg-white px-4 text-sm">
                        {busy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <RefreshCw {...ICON_SM} />}
                        ตรวจสอบสถานะ
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ปุ่ม (ติดล่างเวลาเลื่อน) */}
        <div
          className="sticky bottom-0 z-10 flex flex-col-reverse gap-2 border-t border-gray-150 bg-white px-5 pt-3 sm:flex-row sm:justify-end"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <button type="button" onClick={close} disabled={busy} className="btn-secondary w-full sm:w-auto px-5">
            ยกเลิก
          </button>
          {mode === 'approve' ? (
            <button type="button" onClick={() => void submit()} disabled={!canSubmit} className="btn-primary w-full sm:w-auto px-5">
              {busy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <CheckCircle2 {...ICON_SM} />}
              {amount !== null ? `อนุมัติ ${baht(amount)}` : 'อนุมัติสลิป'}
            </button>
          ) : (
            <button type="button" onClick={() => void submit()} disabled={!canSubmit} className="btn-danger w-full sm:w-auto px-5">
              {busy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <XCircle {...ICON_SM} />}
              ปฏิเสธสลิป
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
