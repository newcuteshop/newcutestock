'use client'
// ป็อปอัปรับชำระ / คืนเงินของงาน (wed_add_payment)
// - ยอดตั้งต้น = งวดถัดไปที่ค้าง (ไม่เกินยอดค้างทั้งงาน) · ปุ่มยอดด่วน: งวดถัดไป / มัดจำที่ขาด / ยอดค้างทั้งหมด / กรอกเอง
// - วันที่รับเงิน: ไม่เกินวันนี้ · พนักงานย้อนหลังได้ 60 วัน ผู้จัดการย้อนได้ทุกวัน (เซิร์ฟเวอร์ตรวจซ้ำ)
// - สลิป (ไม่บังคับ): ย่อรูปแล้วอัปโหลดเข้า wedding-files ก่อน แล้วส่ง path ให้ RPC — อัปโหลดแล้วไม่อัปโหลดซ้ำตอนกดส่งอีกครั้ง
// - client_id สร้างตอนเลือกชนิด แล้วใช้ซ้ำทุกครั้งที่กดบันทึก → เน็ตหลุดแล้วกดใหม่ ระบบไม่บันทึกซ้ำ (ได้รายการเดิมกลับมา)
//   ไม่รู้ผล → จำรหัส + ค่าที่ส่ง (รวม path สลิป) ไว้นอกป็อปอัป ล็อกช่องกรอก และโหลดงานใหม่ก่อนให้กดซ้ำ
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { CheckCircle2, FileImage, ImagePlus, Info, Loader2, Receipt, Wallet, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { addDaysToKey, baht, bangkokTodayKey, formatThaiDate, formatThaiDateTime, isDayKey } from '@/lib/format'
import { parseMoneyInput, round2 } from '@/lib/money'
import { newUuid } from '@/lib/products'
import { formatPromptPayId, isValidPromptPayId, promptPayPayload } from '@/lib/promptpay'
import {
  MAX_WED_MONEY, WED_METHOD_LABELS, WED_PAYMENT_KIND_LABELS, WED_PAYMENT_METHODS, WED_PAYMENT_PURPOSES, WED_PURPOSE_LABELS,
  amountDueNow, parseWedAddPaymentResult,
  type WedBooking, type WedPayment, type WedPaymentKind, type WedPaymentMethod, type WedPaymentPurpose, type WedSettings,
} from '@/lib/wedding'
import QrImage from '@/components/rental/QrImage'
import DialogShell, { DialogMessage } from '@/components/rental/booking/DialogShell'
import {
  EPS, UNSURE_MSG, allowedPaymentKinds, callRpc, clearPendingWrite, clientIdTakenElsewhere, depositShort, errorText,
  getPendingWrite, maxPaymentAmount, pendingKey, rejectedAfterDuplicateCheck, setPendingWrite, type PendingPaymentArgs,
} from './rpc'
import { uploadWeddingSlip } from './slipUrls'

const MAX_NOTE = 300
const PARTIAL_MSG = 'ระบบตอบกลับไม่ครบ — กดบันทึกอีกครั้งเพื่อตรวจสอบ (ระบบจะไม่บันทึกซ้ำ)'
const RESUME_MSG = 'รายการเงินครั้งก่อนยังไม่ทราบผล (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — กด "บันทึกอีกครั้ง" เพื่อตรวจสอบ ถ้าบันทึกไปแล้วจะได้รายการเดิม ไม่บันทึกซ้ำ'
const STAFF_BACKDATE_DAYS = 60

const SUBMIT_LABEL: Record<WedPaymentKind, string> = { payment: 'บันทึกรับชำระ', refund: 'บันทึกคืนเงิน' }
const KIND_HINT: Record<WedPaymentKind, string> = {
  payment: 'มัดจำ ค่างวด ยอดคงเหลือ หรือค่าใช้จ่ายเพิ่ม — นับเป็นยอดชำระของงาน',
  refund: 'คืนเงินที่ลูกค้าชำระไว้ (เช่น รับเกิน หรือยกเลิกงานแล้วคืนเงินบางส่วน)',
}

type Quick = { key: string; label: string; value: number }

function quickAmounts(b: WedBooking, kind: WedPaymentKind): Quick[] {
  const m = b.money
  const out: Quick[] = []
  const push = (key: string, label: string, value: number) => {
    const v = round2(value)
    if (v > EPS && !out.some(q => Math.abs(q.value - v) < EPS)) out.push({ key, label, value: v })
  }
  if (kind === 'payment') {
    if (m.due <= EPS) return out
    if (b.next_due) push('next', b.next_due.label || 'งวดถัดไป', Math.min(b.next_due.amount, m.due))
    push('deposit', 'มัดจำที่ขาด', depositShort(b))
    push('all', 'ยอดค้างทั้งหมด', m.due)
  } else {
    if (m.due < -EPS) push('over', 'ยอดที่รับเกิน', -m.due)
    push('all', 'คืนทั้งหมดที่ชำระ', m.paid)
  }
  return out
}

/** ยอดตั้งต้น: รับชำระ = ยอดที่ควรเก็บตอนนี้ · คืนเงิน = เฉพาะตอนรับเกิน (ไม่ตั้งให้คืนทั้งก้อนโดยไม่ตั้งใจ) */
function defaultAmount(b: WedBooking, kind: WedPaymentKind): number {
  if (kind === 'refund') return b.money.due < -EPS ? round2(-b.money.due) : 0
  return amountDueNow(b)
}

function amountText(n: number): string {
  return n > 0 ? String(round2(n)) : ''
}

interface SlipState {
  file: File | null
  preview: string | null    // object URL ของไฟล์ที่เลือก
  path: string | null       // อัปโหลดแล้ว (ใช้ซ้ำ)
}
const NO_SLIP: SlipState = { file: null, preview: null, path: null }

export default function PaymentDialog({
  booking,
  settings,
  canManage,
  initialKind,
  onClose,
  onApplied,
  reload,
  onOpenReceipt,
}: {
  booking: WedBooking
  settings: WedSettings
  canManage: boolean
  initialKind: WedPaymentKind
  onClose(): void
  onApplied(b: WedBooking): void
  reload(): Promise<WedBooking | null>
  /** เปิดศูนย์เอกสาร (ใบเสร็จ/ใบคืนเงิน เป็นรูป + พิมพ์) */
  onOpenReceipt(payment: WedPayment, booking: WedBooking): void
}) {
  const supabase = useMemo(() => createClient(), [])
  const amountId = useId()
  const noteId = useId()
  const dateId = useId()
  const fileId = useId()
  const kinds = useMemo(() => allowedPaymentKinds(booking), [booking])
  const [kind, setKind] = useState<WedPaymentKind>(() => (kinds.includes(initialKind) ? initialKind : kinds[0] ?? initialKind))
  const [today] = useState(() => bangkokTodayKey())
  const minDay = canManage ? '' : addDaysToKey(today, -STAFF_BACKDATE_DAYS)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<WedPaymentMethod>('transfer')
  const [purpose, setPurpose] = useState<WedPaymentPurpose | null>(null)
  const [paidOn, setPaidOn] = useState(today)
  const [note, setNote] = useState('')
  const [slip, setSlip] = useState<SlipState>(NO_SLIP)
  const [clientId, setClientId] = useState('')
  const [locked, setLocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<'' | 'upload' | 'save'>('')
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [result, setResult] = useState<{ payment: WedPayment | null; booking: WedBooking; already_saved: boolean } | null>(null)
  const previewRef = useRef<string | null>(null)

  // คืนหน่วยความจำรูปตัวอย่างเมื่อเปลี่ยนรูป/ปิดป็อปอัป
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current) }, [])
  function setSlipState(next: SlipState) {
    if (previewRef.current && previewRef.current !== next.preview) URL.revokeObjectURL(previewRef.current)
    previewRef.current = next.preview
    setSlip(next)
  }

  // เลือกชนิด → รหัสคำขอใหม่ + ยอดตั้งต้น ; ชนิดนี้มีรายการที่ยังไม่รู้ผลค้าง → กลับไปที่รหัสเดิม + ค่าเดิม (ล็อกช่อง)
  function setup(k: WedPaymentKind) {
    const pend = getPendingWrite<PendingPaymentArgs>(pendingKey(booking.id, `pay:${k}`))
    setKind(k)
    setError('')
    if (pend) {
      setClientId(pend.clientId)
      setAmount(amountText(pend.args.amount))
      setMethod(pend.args.method)
      setPurpose(pend.args.purpose)
      setPaidOn(pend.args.paidOn)
      setNote(pend.args.note)
      setSlipState({ file: null, preview: null, path: pend.args.slipPath })
      setLocked(true)
      setNotice(RESUME_MSG)
    } else {
      setClientId(newUuid())
      setAmount(amountText(defaultAmount(booking, k)))
      setPurpose(null)
      setNote('')
      setLocked(false)
      setNotice('')
    }
  }

  useEffect(() => {
    setup(kind)
    // ตั้งค่าครั้งเดียวตอนเปิด — ไม่รีเซ็ตเมื่อยอดของงานถูกอัปเดตระหว่างเปิดอยู่
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shownKinds = locked && !kinds.includes(kind) ? [kind, ...kinds] : kinds
  const max = maxPaymentAmount(booking, kind)
  const parsed = parseMoneyInput(amount)
  const amountErr =
    amount.trim() === '' ? ''
      : parsed === null ? 'กรอกจำนวนเงินเป็นตัวเลข'
        : parsed <= 0 ? 'จำนวนเงินต้องมากกว่า 0'
          : parsed > MAX_WED_MONEY ? 'จำนวนเงินสูงเกินไป'
            // ยอดที่ส่งค้างไว้ (ล็อก) ต้องส่งซ้ำได้แม้ยอดค้างเปลี่ยนไปแล้ว — ตรวจเพดานเฉพาะยอดใหม่
            : !locked && parsed > max + EPS ? `ไม่เกิน ${baht(max)}`
              : ''
  const dateErr = !isDayKey(paidOn) ? 'เลือกวันที่รับเงิน'
    : paidOn > today ? 'วันที่ต้องไม่เป็นวันในอนาคต'
      : !locked && minDay && paidOn < minDay ? `ย้อนหลังได้ถึง ${formatThaiDate(minDay)} (เก่ากว่านี้ให้ผู้จัดการบันทึก)`
        : ''
  const cleanNote = note.trim()
  const canSubmit = !busy && !!clientId && parsed !== null && parsed > 0 && amountErr === '' && dateErr === '' && cleanNote.length <= MAX_NOTE
  const quick = quickAmounts(booking, kind)
  const ppOk = isValidPromptPayId(settings.promptpay_id)
  const showQr = kind === 'payment' && method === 'promptpay' && parsed !== null && parsed > 0
  const qrText = showQr && ppOk && settings.promptpay_id ? promptPayPayload(settings.promptpay_id, parsed ?? 0) : ''

  function pickFile(f: File | null | undefined) {
    if (!f) return
    if (f.type && !f.type.startsWith('image/')) {
      setError('ไฟล์สลิปต้องเป็นรูปภาพ (JPG, PNG, WEBP)')
      return
    }
    setError('')
    setSlipState({ file: f, preview: URL.createObjectURL(f), path: null })
  }

  async function submit() {
    if (busyRef.current || !canSubmit || parsed === null) return
    const key = pendingKey(booking.id, `pay:${kind}`)
    const cid = clientId
    const hadPending = getPendingWrite<PendingPaymentArgs>(key)?.clientId === cid
    busyRef.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      // 1) อัปโหลดสลิปก่อน (ถ้ามีและยังไม่ได้อัป) — อัปแล้วจำ path ไว้ กดบันทึกซ้ำในป็อปอัปนี้ใช้ไฟล์เดิม ไม่อัปใหม่
      // ยอมรับโดยตั้งใจ: ถ้าบันทึกเงินถูกปฏิเสธแล้วปิดป็อปอัป (หรืออัปไม่รู้ผลแล้วอัปใหม่) ไฟล์สลิปนั้นค้างใน wedding-files
      // โดยไม่มีรายการเงินอ้างถึง — พนักงานไม่มีสิทธิ์ลบไฟล์ในถัง (กันลบหลักฐาน) จึงไม่ลบจากหน้านี้ ; ถ้าจะเก็บกวาด
      // ให้ผู้ดูแลหาไฟล์ใน wedding-files ที่ไม่มีแถว wed_payments.slip_path ตรงกัน
      let slipPath = slip.path
      if (slip.file && !slipPath) {
        setStage('upload')
        try {
          slipPath = await uploadWeddingSlip(supabase, booking.id, slip.file)
          setSlip(s => ({ ...s, path: slipPath }))
        } catch (e) {
          setError(`อัปโหลดสลิปไม่สำเร็จ: ${e instanceof Error ? e.message : 'ลองใหม่อีกครั้ง'} — ลองใหม่ หรือเอาสลิปออกแล้วบันทึกเงินก่อน`)
          return
        }
      }
      // 2) จำค่าไว้ก่อนส่ง (นอกป็อปอัป) — ปิดกลางทางแล้วเปิดใหม่ยังได้รหัสเดิม ไม่บันทึกซ้ำ
      const args: PendingPaymentArgs = {
        kind, method, amount: parsed, paidOn, purpose: kind === 'payment' ? purpose : null, note: cleanNote, slipPath,
      }
      setPendingWrite<PendingPaymentArgs>(key, { clientId: cid, args })
      setStage('save')
      const res = await callRpc(supabase, 'wed_add_payment', {
        p_client_id: cid,
        p_booking_id: booking.id,
        p_kind: args.kind,
        p_method: args.method,
        p_amount: args.amount,
        p_paid_on: args.paidOn,
        p_purpose: args.purpose,
        p_note: args.note || null,
        p_slip_path: args.slipPath,
      })
      if (res.ok) {
        const out = parseWedAddPaymentResult(res.data)
        if (!out) {
          setLocked(true)
          setError(PARTIAL_MSG)
          await reload()
          return
        }
        clearPendingWrite(key, cid)
        setLocked(false)
        setResult(out)
        onApplied(out.booking)
        return
      }
      if (res.answered) {
        const message = errorText(res.error)
        const definite = rejectedAfterDuplicateCheck(res.error)
        if (definite || !hadPending || clientIdTakenElsewhere(message)) {
          clearPendingWrite(key, cid)
          setLocked(false)
          if (clientIdTakenElsewhere(message)) setClientId(newUuid())
        }
        setError(message)
        if (definite) await reload()
        return
      }
      setLocked(true)
      setError(UNSURE_MSG)
      await reload()
    } finally {
      busyRef.current = false
      setBusy(false)
      setStage('')
    }
  }

  // ===== บันทึกสำเร็จ =====
  if (result) {
    const p = result.payment
    return (
      <DialogShell
        title={result.already_saved ? 'รายการนี้บันทึกไว้แล้ว' : 'บันทึกรายการเงินแล้ว'}
        subtitle={`${booking.booking_no} · ${booking.couple_names}`}
        icon={<CheckCircle2 {...ICON_SM} />}
        tone="ok"
        onClose={onClose}
        footer={
          <div className="flex flex-wrap gap-2">
            {p && (
              <button type="button" className="btn-secondary px-4" onClick={() => onOpenReceipt(p, result.booking)}>
                <Receipt {...ICON_SM} />
                {p.kind === 'refund' ? 'ใบคืนเงิน (รูป/พิมพ์)' : 'ใบเสร็จ (รูป/พิมพ์)'}
              </button>
            )}
            <button type="button" className="btn-primary flex-1 min-w-[140px]" onClick={onClose} autoFocus>เสร็จสิ้น</button>
          </div>
        }
      >
        <div aria-live="polite" className="space-y-3">
          {result.already_saved && <DialogMessage tone="warn" text="ระบบได้รับคำขอนี้ไปแล้วก่อนหน้า — ไม่ได้บันทึกเงินซ้ำ" />}
          {p ? (
            <div className="panel px-4 py-3 space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold text-gray-900">{WED_PAYMENT_KIND_LABELS[p.kind]}</span>
                <span className="money text-2xl text-brand-700">{baht(p.amount)}</span>
              </div>
              <Line label="วิธี" value={WED_METHOD_LABELS[p.method]} />
              {p.purpose && <Line label="สำหรับ" value={WED_PURPOSE_LABELS[p.purpose]} />}
              <Line label="วันที่รับ/จ่ายเงิน" value={formatThaiDate(p.paid_on)} />
              <Line label="เลขที่" value={p.receipt_no ?? '-'} mono />
              <Line label="บันทึกเมื่อ" value={formatThaiDateTime(p.created_at)} />
              {p.slip_path && <Line label="สลิป" value="แนบแล้ว" />}
            </div>
          ) : (
            <DialogMessage tone="info" text="บันทึกแล้ว — ดูรายการได้ในส่วนรายการเงินของงาน" />
          )}
          <MoneyMini booking={result.booking} />
        </div>
      </DialogShell>
    )
  }

  if (shownKinds.length === 0) {
    return (
      <DialogShell title="รายการเงิน" subtitle={`${booking.booking_no} · ${booking.couple_names}`} icon={<Wallet {...ICON_SM} />} onClose={onClose}
        footer={<button type="button" className="btn-secondary w-full" onClick={onClose}>ปิด</button>}
      >
        <DialogMessage
          tone="info"
          text={booking.actions.block_reasons.pay || booking.actions.block_reasons.refund || 'ตอนนี้ไม่มีรายการเงินที่บันทึกได้'}
        />
        <MoneyMini booking={booking} />
      </DialogShell>
    )
  }

  return (
    <DialogShell
      title={kind === 'refund' ? 'คืนเงินลูกค้า' : 'รับชำระเงิน'}
      subtitle={`${booking.booking_no} · ${booking.couple_names}`}
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
              {busy ? (stage === 'upload' ? 'กำลังอัปโหลดสลิป...' : 'กำลังบันทึก...') : locked ? 'บันทึกอีกครั้ง' : SUBMIT_LABEL[kind]}
            </button>
          </div>
        </>
      }
    >
      <MoneyMini booking={booking} />

      {shownKinds.length > 1 && (
        <div>
          <p className="field-label">ประเภทรายการ</p>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="ประเภทรายการเงิน">
            {shownKinds.map(k => (
              <button
                key={k}
                type="button"
                className="choice"
                aria-pressed={kind === k}
                disabled={busy || (locked && kind !== k)}
                onClick={() => { if (kind !== k) setup(k) }}
              >
                {WED_PAYMENT_KIND_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="field-hint -mt-2">{KIND_HINT[kind]}</p>

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
        />
        <p id={`${amountId}-hint`} className={clsx('field-hint', amountErr && 'text-red-700 font-medium')} aria-live="polite">
          {amountErr || (locked ? 'ยอดเดิมที่ส่งไว้ — ส่งซ้ำได้ ระบบไม่บันทึกซ้ำ' : `บันทึกได้ไม่เกิน ${baht(max)}`)}
        </p>
        {quick.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="ยอดด่วน">
            {quick.map(q => (
              <button
                key={q.key}
                type="button"
                className="chip-toggle max-w-full whitespace-normal text-left"
                aria-pressed={parsed !== null && Math.abs(parsed - q.value) < EPS}
                disabled={busy || locked}
                onClick={() => { setAmount(amountText(q.value)); setError('') }}
              >
                {q.label} {baht(q.value)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="field-label">{kind === 'refund' ? 'คืนเงินโดย' : 'รับเงินโดย'}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="group" aria-label="วิธีชำระเงิน">
          {WED_PAYMENT_METHODS.map(mt => (
            <button key={mt} type="button" className="choice" aria-pressed={method === mt} disabled={busy || locked} onClick={() => setMethod(mt)}>
              {WED_METHOD_LABELS[mt]}
            </button>
          ))}
        </div>
      </div>

      {showQr && (
        <div className="panel p-3 flex flex-col items-center gap-2">
          {qrText ? (
            <>
              <QrImage
                text={qrText}
                size={180}
                label={`สแกนจ่าย ${baht(parsed ?? 0)}${settings.promptpay_name ? ` · ${settings.promptpay_name}` : ''}`}
              />
              <p className="text-xs text-gray-600">พร้อมเพย์ {formatPromptPayId(settings.promptpay_id)}</p>
            </>
          ) : (
            <p className="text-sm text-gray-600 text-center">ยังไม่ได้ตั้งเลขพร้อมเพย์ของร้าน (ตั้งได้ที่ ตั้งค่าร้าน → การรับเงิน)</p>
          )}
        </div>
      )}
      {kind === 'payment' && method === 'transfer' && settings.bank_accounts.length > 0 && (
        <div className="panel px-3.5 py-2.5 text-xs text-gray-700 space-y-0.5">
          <p className="font-medium text-gray-800">บัญชีของร้าน</p>
          {settings.bank_accounts.map((a, i) => (
            <p key={i} className="break-words">{a.bank} {a.account_no}{a.account_name ? ` · ${a.account_name}` : ''}</p>
          ))}
        </div>
      )}

      {kind === 'payment' && (
        <div>
          <p className="field-label">สำหรับ</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="วัตถุประสงค์ของเงิน">
            <button type="button" className="chip-toggle" aria-pressed={purpose === null} disabled={busy || locked} onClick={() => setPurpose(null)}>
              ให้ระบบเลือก
            </button>
            {WED_PAYMENT_PURPOSES.map(p => (
              <button key={p} type="button" className="chip-toggle" aria-pressed={purpose === p} disabled={busy || locked} onClick={() => setPurpose(p)}>
                {WED_PURPOSE_LABELS[p]}
              </button>
            ))}
          </div>
          <p className="field-hint">ให้ระบบเลือก: ยังไม่ครบมัดจำ = มัดจำ · ปิดยอดทั้งหมด = ยอดคงเหลือ · อื่นๆ = ชำระงวด</p>
        </div>
      )}

      <div>
        <label htmlFor={dateId} className="field-label">วันที่{kind === 'refund' ? 'คืนเงิน' : 'รับเงิน'} *</label>
        <input
          id={dateId}
          type="date"
          className="input"
          value={paidOn}
          max={today}
          min={minDay || undefined}
          disabled={busy || locked}
          aria-invalid={dateErr !== ''}
          aria-describedby={`${dateId}-hint`}
          onChange={e => setPaidOn(e.target.value)}
        />
        <p id={`${dateId}-hint`} className={clsx('field-hint', dateErr && 'text-red-700 font-medium')}>
          {dateErr || (isDayKey(paidOn) ? formatThaiDate(paidOn) : '')}
          {!dateErr && !canManage ? ' · ย้อนหลังได้ไม่เกิน 60 วัน' : ''}
        </p>
      </div>

      <div>
        <p className="field-label" id={`${fileId}-label`}>สลิป / หลักฐาน (ไม่บังคับ)</p>
        {slip.preview || slip.path ? (
          <div className="panel flex items-center gap-3 p-2.5">
            {slip.preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={slip.preview} alt="สลิปที่เลือก" className="h-16 w-16 shrink-0 rounded-lg border border-gray-200 object-cover" />
            ) : (
              <span className="icon-bubble shrink-0" aria-hidden="true"><FileImage {...ICON_SM} /></span>
            )}
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium text-gray-900">{slip.path ? 'อัปโหลดสลิปแล้ว' : 'จะอัปโหลดเมื่อกดบันทึก'}</p>
              <p className="text-xs text-gray-500">ระบบย่อรูปให้อัตโนมัติ · ดูได้เฉพาะทีมงานร้าน</p>
            </div>
            {!locked && (
              <button
                type="button"
                className="btn-icon btn-icon-plain shrink-0"
                aria-label="เอาสลิปออก"
                disabled={busy}
                onClick={() => setSlipState(NO_SLIP)}
              >
                <X {...ICON_SM} />
              </button>
            )}
          </div>
        ) : (
          <label
            htmlFor={fileId}
            className={clsx('btn-dashed w-full justify-center', (busy || locked) && 'pointer-events-none opacity-60')}
          >
            <ImagePlus {...ICON_SM} />
            เลือกรูปสลิป
          </label>
        )}
        <input
          id={fileId}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-labelledby={`${fileId}-label`}
          disabled={busy || locked}
          onChange={e => { pickFile(e.target.files?.[0]); e.target.value = '' }}
        />
      </div>

      <div>
        <label htmlFor={noteId} className="field-label">หมายเหตุ</label>
        <input
          id={noteId}
          className="input"
          value={note}
          maxLength={MAX_NOTE}
          disabled={busy || locked}
          autoComplete="off"
          placeholder="เช่น โอนเข้าบัญชีกสิกร / ผู้ใหญ่ฝ่ายเจ้าบ่าวจ่ายแทน"
          onChange={e => setNote(e.target.value)}
        />
      </div>
      {kind === 'refund' && booking.status === 'cancelled' && (
        <div className="alert-info">
          <Info {...ICON_SM} />
          <p className="min-w-0">งานยกเลิกแล้ว — เงินที่ไม่คืนถือเป็นมัดจำที่ริบ (นับเป็นรายได้)</p>
        </div>
      )}
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

/** สรุปยอดเงินย่อของงาน (บนสุดของป็อปอัปเงิน) */
export function MoneyMini({ booking }: { booking: WedBooking }) {
  const m = booking.money
  const tone = m.due > EPS ? 'text-red-700' : m.due < -EPS ? 'text-amber-800' : 'text-green-800'
  return (
    <dl className="panel grid grid-cols-2 gap-x-4 gap-y-1.5 px-3.5 py-3 text-sm">
      <dt className="text-gray-600">ยอดสุทธิ</dt>
      <dd className="text-right money text-gray-900">{baht(m.grand_total)}</dd>
      <dt className="text-gray-600">ชำระแล้ว</dt>
      <dd className="text-right money text-gray-900">{baht(m.paid)}</dd>
      <dt className={clsx('font-medium', tone)}>{m.due > EPS ? 'ค้างชำระ' : m.due < -EPS ? 'รับเกิน (ต้องคืน)' : 'ชำระครบ'}</dt>
      <dd className={clsx('text-right money', tone)}>{baht(Math.abs(m.due))}</dd>
      <dt className="text-gray-600">มัดจำ</dt>
      <dd className="text-right text-gray-900">
        <span className="money">{baht(m.deposit_required)}</span>
        <span className={clsx('ml-1.5 text-xs font-medium', m.deposit_met ? 'text-green-800' : 'text-amber-800')}>
          {m.deposit_met ? 'ครบ' : `ขาด ${baht(m.deposit_due)}`}
        </span>
      </dd>
      {booking.next_due && m.due > EPS && (
        <>
          <dt className="text-gray-600 flex items-center gap-1"><Receipt {...ICON_XS} />งวดถัดไป</dt>
          <dd className="text-right text-gray-900">
            <span className="money">{baht(booking.next_due.amount)}</span>
            <span className="block text-xs text-gray-500">
              {booking.next_due.label}{booking.next_due.due_date ? ` · ${formatThaiDate(booking.next_due.due_date)}` : ''}
              {booking.next_due.overdue ? ' · เลยกำหนด' : ''}
            </span>
          </dd>
        </>
      )}
    </dl>
  )
}
