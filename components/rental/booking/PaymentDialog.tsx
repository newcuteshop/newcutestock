'use client'
// ป็อปอัปรายการเงินของการจอง (rental_add_payment) — ชนิดเดียวกันทั้งหมดในหน้าเดียว:
//   รับชำระ (ค่าเช่า/มัดจำ/ค่าปรับ) · รับเงินประกัน · หักเงินประกัน · คืนเงินประกัน · คืนเงินค่าเช่า
// ยอดตั้งต้น/ปุ่มยอดด่วนคิดจากยอดล่าสุดของการจอง · เพดานยอดตามกฎเดียวกับเซิร์ฟเวอร์ (เซิร์ฟเวอร์ตรวจซ้ำเสมอ)
// client_id สร้างตอนเลือกชนิด แล้วใช้ซ้ำทุกครั้งที่กดบันทึก → เน็ตหลุดแล้วกดใหม่ ระบบไม่บันทึกซ้ำ (ได้รายการเดิมกลับมา)
// ไม่รู้ผล → จำรหัส + ยอดเดิมไว้นอกป็อปอัป (ล็อกช่องกรอก) และโหลดการจองใหม่ก่อนให้กดซ้ำ
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { CheckCircle2, Info, Loader2, Printer, Wallet } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON_SM } from '@/components/theme/icons'
import { baht, formatThaiDateTime } from '@/lib/format'
import { parseMoneyInput, round2 } from '@/lib/money'
import { newUuid } from '@/lib/products'
import { promptPayPayload } from '@/lib/promptpay'
import {
  MAX_RENTAL_MONEY, METHOD_LABELS, PAYMENT_KIND_LABELS, RENTAL_CASH_METHODS, parseAddPaymentResult,
  type RentalBooking, type RentalCashMethod, type RentalPayment, type RentalPaymentKind, type RentalSettings,
} from '@/lib/rental'
import QrImage from '@/components/rental/QrImage'
import DialogShell, { DialogMessage } from './DialogShell'
import {
  UNSURE_MSG, allowedPaymentKinds, bookingFlags, callRpc, clearPending, depositOutstanding, errorText, getPending,
  maxPaymentAmount, payDepositFirst, pendingKey, rejectedAfterDuplicateCheck, securityShort, setPending,
} from './rpc'

const MAX_NOTE = 300
const PARTIAL_MSG = 'ระบบตอบกลับไม่ครบ — กดบันทึกอีกครั้งเพื่อตรวจสอบ (ระบบจะไม่บันทึกซ้ำ)'
const RESUME_MSG = 'รายการเงินครั้งก่อนยังไม่ทราบผล (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — กด "บันทึกอีกครั้ง" เพื่อตรวจสอบ ถ้าบันทึกไปแล้วจะได้รายการเดิม ไม่บันทึกซ้ำ'

const KIND_SHORT: Record<RentalPaymentKind, string> = {
  payment: 'รับชำระ',
  security_in: 'รับเงินประกัน',
  security_apply: 'หักเงินประกัน',
  security_out: 'คืนเงินประกัน',
  refund: 'คืนเงิน',
}

const SUBMIT_LABEL: Record<RentalPaymentKind, string> = {
  payment: 'บันทึกรับชำระ',
  security_in: 'บันทึกรับเงินประกัน',
  security_apply: 'บันทึกหักเงินประกัน',
  security_out: 'บันทึกคืนเงินประกัน',
  refund: 'บันทึกคืนเงิน',
}

const KIND_HINT: Record<RentalPaymentKind, string> = {
  payment: 'ค่าเช่า มัดจำ ค่าจัดส่ง หรือค่าปรับ — นับเป็นยอดชำระของการจอง',
  security_in: 'เงินประกันชุด แยกจากค่าเช่า คืนลูกค้าเมื่อคืนชุดครบสภาพดี',
  security_apply: 'นำเงินประกันที่ถืออยู่มาชำระยอดค้าง (ไม่มีเงินเข้า-ออกจริง)',
  security_out: 'จ่ายเงินประกันคืนให้ลูกค้า',
  refund: 'คืนเงินค่าเช่าที่ลูกค้าชำระไว้ (เช่น รับเกิน หรือยกเลิกแล้วคืนเงิน)',
}

type Quick = { label: string; value: number }

function quickAmounts(b: RentalBooking, kind: RentalPaymentKind): Quick[] {
  const m = b.money
  const out: Quick[] = []
  switch (kind) {
    case 'payment': {
      if (payDepositFirst(b)) out.push({ label: 'มัดจำที่ต้องจ่าย', value: depositOutstanding(b) })
      if (m.due > 0.005) out.push({ label: 'ยอดค้างทั้งหมด', value: m.due })
      break
    }
    case 'security_in': {
      const short = securityShort(b)
      if (short > 0.005) out.push({ label: 'ประกันทั้งหมด', value: short })
      break
    }
    case 'security_apply': {
      const max = maxPaymentAmount(b, kind)
      if (max > 0.005) out.push({ label: m.security_held <= m.due ? 'หักประกันทั้งหมด' : 'หักเท่ายอดค้าง', value: max })
      break
    }
    case 'security_out':
      if (m.security_held > 0.005) out.push({ label: 'คืนประกันทั้งหมด', value: m.security_held })
      break
    case 'refund':
      if (m.due < -0.005) out.push({ label: 'ยอดที่รับเกิน', value: round2(-m.due) })
      if (m.paid > 0.005) out.push({ label: 'คืนทั้งหมดที่ชำระ', value: m.paid })
      break
  }
  return out
}

/**
 * ยอดตั้งต้นของแต่ละชนิด = ปุ่มด่วนแรก ยกเว้นคืนเงินค่าเช่า: ตั้งต้นเฉพาะตอนลูกค้าจ่ายเกิน (ยอดที่รับเกิน)
 * ไม่เกิน = ปล่อยว่างให้พิมพ์เอง (ไม่ให้กดบันทึกทันทีแล้วคืนเงินทั้งก้อนโดยไม่ตั้งใจ)
 */
function defaultAmount(b: RentalBooking, kind: RentalPaymentKind): number {
  if (kind === 'refund') return b.money.due < -0.005 ? round2(-b.money.due) : 0
  return quickAmounts(b, kind)[0]?.value ?? 0
}

function amountText(n: number): string {
  return n > 0 ? String(round2(n)) : ''
}

export default function PaymentDialog({
  booking,
  settings,
  initialKind,
  onClose,
  onApplied,
  reload,
  onPrint,
}: {
  booking: RentalBooking
  settings: RentalSettings
  initialKind: RentalPaymentKind
  onClose(): void
  onApplied(b: RentalBooking): void
  reload(): Promise<RentalBooking | null>
  onPrint(payment: RentalPayment, paper: '80' | 'a4', booking: RentalBooking): void
}) {
  const supabase = useMemo(() => createClient(), [])
  const amountId = useId()
  const noteId = useId()
  const kinds = useMemo(() => allowedPaymentKinds(bookingFlags(booking)), [booking])
  const [kind, setKind] = useState<RentalPaymentKind>(() => (kinds.includes(initialKind) ? initialKind : kinds[0] ?? initialKind))
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<RentalCashMethod>('cash')
  const [note, setNote] = useState('')
  const [clientId, setClientId] = useState('')
  const [locked, setLocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [result, setResult] = useState<{ payment: RentalPayment | null; booking: RentalBooking; already_saved: boolean } | null>(null)

  // เลือกชนิด → รหัสคำขอใหม่ + ยอดตั้งต้น ; ชนิดนี้มีรายการที่ยังไม่รู้ผลค้าง → กลับไปที่รหัสเดิม + ยอดเดิม (ล็อกช่อง)
  function setup(k: RentalPaymentKind) {
    const pend = getPending(pendingKey(booking.id, `pay:${k}`))
    setKind(k)
    setError('')
    if (pend) {
      setClientId(pend.clientId)
      setAmount(amountText(pend.amount))
      if (pend.method !== 'none') setMethod(pend.method)
      setNote(pend.note)
      setLocked(true)
      setNotice(RESUME_MSG)
    } else {
      setClientId(newUuid())
      setAmount(amountText(defaultAmount(booking, k)))
      setNote('')
      setLocked(false)
      setNotice('')
    }
  }

  useEffect(() => {
    setup(kind)
    // ตั้งค่าครั้งเดียวตอนเปิด — ไม่รีเซ็ตเมื่อยอดการจองถูกอัปเดตระหว่างเปิดอยู่
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // รายการค้างที่ไม่รู้ผล: ชนิดนั้นอาจไม่อยู่ในชนิดที่ทำได้แล้ว (เช่น ยอดถูกชำระไปแล้วจริง) แต่ต้องกดส่งซ้ำเพื่อดูผลได้
  const shownKinds = locked && !kinds.includes(kind) ? [kind, ...kinds] : kinds
  const max = maxPaymentAmount(booking, kind)
  const parsed = parseMoneyInput(amount)
  const amountErr =
    amount.trim() === '' ? ''
      : parsed === null ? 'กรอกจำนวนเงินเป็นตัวเลข'
        : parsed <= 0 ? 'จำนวนเงินต้องมากกว่า 0'
          : parsed > MAX_RENTAL_MONEY ? 'จำนวนเงินสูงเกินไป'
            // ไม่ล็อก (ยอดใหม่) เท่านั้นที่ตรวจเพดาน — ยอดที่ส่งค้างไว้ต้องส่งซ้ำได้แม้ยอดค้างเปลี่ยนไปแล้ว
            : !locked && parsed > max + 0.005 ? `ไม่เกิน ${baht(max)}`
              : ''
  const cleanNote = note.trim()
  const canSubmit = !busy && !!clientId && parsed !== null && parsed > 0 && amountErr === '' && cleanNote.length <= MAX_NOTE
  const quick = quickAmounts(booking, kind)
  const sendMethod: RentalCashMethod | 'none' = kind === 'security_apply' ? 'none' : method
  const showQr = sendMethod === 'promptpay' && (kind === 'payment' || kind === 'security_in') && parsed !== null && parsed > 0
  const qrText = showQr && settings.promptpay_id ? promptPayPayload(settings.promptpay_id, parsed ?? 0) : ''

  async function submit() {
    if (busyRef.current || !canSubmit || parsed === null) return
    const key = pendingKey(booking.id, `pay:${kind}`)
    const cid = clientId
    const hadPending = getPending(key)?.clientId === cid
    // จำไว้ก่อนส่ง (นอกป็อปอัป) — ปิดป็อปอัปกลางทาง เปิดใหม่ก็ยังได้รหัสเดิม ไม่บันทึกซ้ำ
    setPending(key, { clientId: cid, kind, method: sendMethod, amount: parsed, note: cleanNote })
    busyRef.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await callRpc(supabase, 'rental_add_payment', {
        p_client_id: cid,
        p_booking_id: booking.id,
        p_kind: kind,
        p_method: sendMethod,
        p_amount: parsed,
        p_note: cleanNote || null,
      })
      if (res.ok) {
        const out = parseAddPaymentResult(res.data)
        if (!out) {
          setLocked(true)
          setError(PARTIAL_MSG)
          await reload()
          return
        }
        clearPending(key, cid)
        setLocked(false)
        setResult(out)
        onApplied(out.booking)
        return
      }
      if (res.answered) {
        const definite = rejectedAfterDuplicateCheck(res.error)
        if (definite || !hadPending) {
          clearPending(key, cid)
          setLocked(false)
        }
        setError(errorText(res.error))
        // ถูกปฏิเสธเพราะยอดบนจอเก่า → โหลดยอดล่าสุดให้เลย
        if (definite) await reload()
        return
      }
      // ไม่รู้ผล → ล็อกยอดเดิมไว้ + โหลดการจองใหม่ให้เห็นยอดจริงก่อนกดซ้ำ
      setLocked(true)
      setError(UNSURE_MSG)
      await reload()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  // ===== บันทึกสำเร็จ =====
  if (result) {
    const p = result.payment
    return (
      <DialogShell
        title={result.already_saved ? 'รายการนี้บันทึกไว้แล้ว' : 'บันทึกรายการเงินแล้ว'}
        subtitle={`การจอง ${booking.booking_no}`}
        icon={<CheckCircle2 {...ICON_SM} />}
        tone="ok"
        onClose={onClose}
        footer={
          <div className="flex flex-wrap gap-2">
            {p && (
              <>
                <button type="button" className="btn-secondary px-4" onClick={() => onPrint(p, '80', result.booking)}>
                  <Printer {...ICON_SM} />
                  ใบเสร็จ 80 มม.
                </button>
                <button type="button" className="btn-secondary px-4" onClick={() => onPrint(p, 'a4', result.booking)}>
                  <Printer {...ICON_SM} />
                  A4
                </button>
              </>
            )}
            <button type="button" className="btn-primary flex-1 min-w-[140px]" onClick={onClose} autoFocus>เสร็จสิ้น</button>
          </div>
        }
      >
        <div aria-live="polite" className="space-y-3">
          {result.already_saved && (
            <DialogMessage tone="warn" text="ระบบได้รับคำขอนี้ไปแล้วก่อนหน้า — ไม่ได้บันทึกเงินซ้ำ" />
          )}
          {p ? (
            <div className="panel px-4 py-3 space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold text-gray-900">{PAYMENT_KIND_LABELS[p.kind]}</span>
                <span className="money text-2xl text-brand-700">{baht(p.amount)}</span>
              </div>
              <Line label="วิธี" value={METHOD_LABELS[p.method]} />
              <Line label="เลขที่ใบเสร็จ" value={p.receipt_no ?? '-'} mono />
              <Line label="เวลา" value={formatThaiDateTime(p.created_at)} />
            </div>
          ) : (
            <DialogMessage tone="info" text="บันทึกแล้ว — ดูรายการได้ในส่วนรายการเงินของการจอง" />
          )}
          <MoneyMini booking={result.booking} />
        </div>
      </DialogShell>
    )
  }

  if (shownKinds.length === 0) {
    return (
      <DialogShell title="รายการเงิน" subtitle={`การจอง ${booking.booking_no}`} icon={<Wallet {...ICON_SM} />} onClose={onClose}
        footer={<button type="button" className="btn-secondary w-full" onClick={onClose}>ปิด</button>}
      >
        <DialogMessage tone="info" text="ตอนนี้ไม่มีรายการเงินที่บันทึกได้ (ไม่มียอดค้าง/เงินประกันที่ต้องรับหรือคืน)" />
        <MoneyMini booking={booking} />
      </DialogShell>
    )
  }

  return (
    <DialogShell
      title="รายการเงิน"
      subtitle={`การจอง ${booking.booking_no} · ${booking.customer.name}`}
      icon={<Wallet {...ICON_SM} />}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <DialogMessage tone="err" text={error} />
          <DialogMessage tone="warn" text={notice} />
          <div className="flex gap-2 sm:justify-end">
            <button type="button" onClick={onClose} disabled={busy} className="btn-secondary px-5">ยกเลิก</button>
            <button type="button" onClick={submit} disabled={!canSubmit} className="btn-primary flex-1 sm:flex-none sm:min-w-[200px]">
              {busy && <Loader2 {...ICON_SM} className="animate-spin" />}
              {busy ? 'กำลังบันทึก...' : locked ? 'บันทึกอีกครั้ง' : SUBMIT_LABEL[kind]}
            </button>
          </div>
        </>
      }
    >
      <MoneyMini booking={booking} />

      <div>
        <p className="field-label">ประเภทรายการ</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="group" aria-label="ประเภทรายการเงิน">
          {shownKinds.map(k => (
            <button
              key={k}
              type="button"
              className="choice"
              aria-pressed={kind === k}
              disabled={busy || (locked && kind !== k)}
              onClick={() => { if (kind !== k) setup(k) }}
            >
              {KIND_SHORT[k]}
            </button>
          ))}
        </div>
        <p className="field-hint">{KIND_HINT[kind]}</p>
      </div>

      <div>
        <label htmlFor={amountId} className="field-label">จำนวนเงิน (บาท) *</label>
        <input
          id={amountId}
          className="input text-right text-lg font-semibold tabular-nums"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          disabled={busy || locked}
          aria-invalid={amountErr !== ''}
          aria-describedby={`${amountId}-hint`}
          onChange={e => { setAmount(e.target.value); setError('') }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }}
        />
        <p id={`${amountId}-hint`} className={clsx('field-hint', amountErr && 'text-red-700 font-medium')} aria-live="polite">
          {amountErr || (locked ? 'ยอดเดิมที่ส่งไว้ — ส่งซ้ำได้ ระบบไม่บันทึกซ้ำ' : `บันทึกได้ไม่เกิน ${baht(max)}`)}
        </p>
        {quick.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="ยอดด่วน">
            {quick.map(q => (
              <button
                key={q.label}
                type="button"
                className="chip-toggle"
                aria-pressed={parsed !== null && Math.abs(parsed - q.value) < 0.005}
                disabled={busy || locked}
                onClick={() => { setAmount(amountText(q.value)); setError('') }}
              >
                {q.label} {baht(q.value)}
              </button>
            ))}
          </div>
        )}
      </div>

      {kind !== 'security_apply' ? (
        <div>
          <p className="field-label">{kind === 'refund' || kind === 'security_out' ? 'จ่ายคืนโดย' : 'รับเงินโดย'}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="group" aria-label="วิธีชำระเงิน">
            {RENTAL_CASH_METHODS.map(mt => (
              <button
                key={mt}
                type="button"
                className="choice"
                aria-pressed={method === mt}
                disabled={busy || locked}
                onClick={() => setMethod(mt)}
              >
                {METHOD_LABELS[mt]}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="alert-info">
          <Info {...ICON_SM} />
          <p className="min-w-0">หักจากเงินประกันที่ร้านถืออยู่ {baht(booking.money.security_held)} — ไม่ต้องรับเงินจากลูกค้า</p>
        </div>
      )}

      {showQr && (
        <div className="panel p-3 flex flex-col items-center gap-2">
          {qrText ? (
            <QrImage
              text={qrText}
              size={180}
              label={`สแกนจ่าย ${baht(parsed ?? 0)}${settings.promptpay_name ? ` · ${settings.promptpay_name}` : ''}`}
            />
          ) : (
            <p className="text-sm text-gray-600 text-center">ยังไม่ได้ตั้งเลขพร้อมเพย์ของร้าน (ตั้งได้ที่ ตั้งค่าร้านเช่า)</p>
          )}
        </div>
      )}

      <div>
        <label htmlFor={noteId} className="field-label">หมายเหตุ</label>
        <input
          id={noteId}
          className="input"
          value={note}
          maxLength={MAX_NOTE}
          disabled={busy || locked}
          autoComplete="off"
          placeholder="เช่น โอนเข้าบัญชีกสิกร / ลูกค้าจ่ายแทน"
          onChange={e => setNote(e.target.value)}
        />
      </div>
    </DialogShell>
  )
}

function Line({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-sm text-gray-600">
      <span>{label}</span>
      <span className={clsx('text-right text-gray-900', mono && 'font-mono text-xs sm:text-sm break-all')}>{value}</span>
    </div>
  )
}

/** สรุปยอดเงินย่อของการจอง (บนสุดของป็อปอัปเงิน) */
export function MoneyMini({ booking }: { booking: RentalBooking }) {
  const m = booking.money
  return (
    <dl className="panel grid grid-cols-2 gap-x-4 gap-y-1.5 px-3.5 py-3 text-sm">
      <dt className="text-gray-600">ยอดรวม</dt>
      <dd className="text-right money text-gray-900">{baht(m.grand_total)}</dd>
      <dt className="text-gray-600">ชำระแล้ว</dt>
      <dd className="text-right money text-gray-900">{baht(m.paid)}</dd>
      <dt className={clsx('font-medium', m.due > 0.005 ? 'text-red-700' : m.due < -0.005 ? 'text-amber-800' : 'text-green-800')}>
        {m.due > 0.005 ? 'ค้างชำระ' : m.due < -0.005 ? 'รับเกิน (ต้องคืน)' : 'ชำระครบ'}
      </dt>
      <dd className={clsx('text-right money', m.due > 0.005 ? 'text-red-700' : m.due < -0.005 ? 'text-amber-800' : 'text-green-800')}>
        {baht(Math.abs(m.due))}
      </dd>
      {(m.security_required > 0 || m.security_held > 0) && (
        <>
          <dt className="text-gray-600">ประกัน ถืออยู่ / ต้องวาง</dt>
          <dd className="text-right money text-gray-900">{baht(m.security_held)} / {baht(m.security_required)}</dd>
        </>
      )}
      {m.pending_review_total > 0 && (
        <>
          <dt className="text-amber-800">สลิปรอตรวจ</dt>
          <dd className="text-right money text-amber-800">{baht(m.pending_review_total)}</dd>
        </>
      )}
    </dl>
  )
}
