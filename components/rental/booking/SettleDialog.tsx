'use client'
// สรุปเงินหลังรับคืนชุด — ทำต่อกันในขั้นตอนเดียว:
//   1) หักเงินประกันเป็นค่าเช่า/ค่าปรับที่ค้าง (security_apply)  2) รับเงินส่วนที่ยังขาด (payment)
//   3) คืนเงินที่รับเกิน (refund)  4) คืนเงินประกันส่วนที่เหลือ (security_out)  5) ปิดงาน (rental_complete)
// ยอดแต่ละขั้นคิดจากยอดตอนเปิด แล้ว "ตรึง" ไว้เมื่อเริ่มบันทึก · ทำทีละขั้นตามลำดับ หยุดเมื่อขั้นไหนไม่สำเร็จ (กดทำต่อได้)
// แต่ละขั้นมี client_id ของตัวเอง (จำไว้นอกป็อปอัป) → เน็ตหลุดแล้วกดทำต่อ ขั้นที่บันทึกไปแล้วไม่ถูกบันทึกซ้ำ
// เปิดใหม่ขณะมีขั้นที่ไม่รู้ผลค้าง → แผนมีแค่ขั้นที่ค้าง (ยอดเดิม) ทำให้รู้ผลก่อน แล้วค่อยคิดแผนที่เหลือจากยอดล่าสุด
// (ถ้าคิดขั้นอื่นจากยอดปัจจุบันปนกับขั้นค้าง ยอดสรุปจะผิด เพราะยอดปัจจุบันอาจรวมขั้นค้างไปแล้ว)
import { useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { CheckCircle2, Circle, Info, Loader2, Printer, Scale, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht } from '@/lib/format'
import { round2 } from '@/lib/money'
import { newUuid } from '@/lib/products'
import {
  METHOD_LABELS, RENTAL_CASH_METHODS, parseAddPaymentResult,
  type RentalBooking, type RentalCashMethod, type RentalPaymentKind,
} from '@/lib/rental'
import DialogShell, { DialogMessage } from './DialogShell'
import { MoneyMini } from './PaymentDialog'
import {
  UNSURE_MSG, callRpc, clearPending, errorText, getPending, pendingKey, rejectedAfterDuplicateCheck, runBookingWrite,
  setPending,
} from './rpc'

type StepKey = 'apply' | 'collect' | 'refund' | 'secout' | 'complete'
type StepState = 'todo' | 'done' | 'failed'

interface Step {
  key: StepKey
  label: string
  kind: RentalPaymentKind | null   // null = ปิดงาน
  amount: number
  method: RentalCashMethod | 'none'
  enabled: boolean
  resumed: boolean                 // มีคำขอค้างที่ยังไม่รู้ผล (ยอด/วิธีตามคำขอเดิม)
}

const STEP_KIND: Record<Exclude<StepKey, 'complete'>, RentalPaymentKind> = {
  apply: 'security_apply',
  collect: 'payment',
  refund: 'refund',
  secout: 'security_out',
}

const NOTE = 'สรุปเงินหลังรับคืนชุด'

function buildPlan(b: RentalBooking): Step[] {
  const m = b.money
  const held = Math.max(0, m.security_held)
  const due = m.due
  const apply = round2(Math.min(held, Math.max(0, due)))
  const raw: { key: Exclude<StepKey, 'complete'>; label: string; amount: number }[] = [
    { key: 'apply', label: 'หักเงินประกันเป็นยอดค้าง', amount: apply },
    { key: 'collect', label: 'รับเงินส่วนที่ยังขาด', amount: round2(Math.max(0, due - apply)) },
    { key: 'refund', label: 'คืนเงินที่รับเกิน', amount: due < -0.005 ? round2(-due) : 0 },
    { key: 'secout', label: 'คืนเงินประกันส่วนที่เหลือ', amount: round2(held - apply) },
  ]
  const steps: Step[] = []
  const resumed: Step[] = []
  for (const r of raw) {
    const pend = getPending(pendingKey(b.id, `settle:${r.key}`))
    if (pend) {
      resumed.push({ key: r.key, label: r.label, kind: STEP_KIND[r.key], amount: pend.amount, method: pend.method, enabled: true, resumed: true })
    }
  }
  if (resumed.length > 0) return resumed
  for (const r of raw) {
    if (r.amount > 0.005) {
      steps.push({ key: r.key, label: r.label, kind: STEP_KIND[r.key], amount: r.amount, method: r.key === 'apply' ? 'none' : 'cash', enabled: true, resumed: false })
    }
  }
  if (b.status === 'returned') {
    steps.push({ key: 'complete', label: 'ปิดงาน', kind: null, amount: 0, method: 'none', enabled: true, resumed: false })
  }
  return steps
}

// ยอดหลังทำตามแผน (เฉพาะขั้นที่เปิดไว้) → ปิดงานได้ไหม
function afterPlan(b: RentalBooking, steps: Step[]): { due: number; held: number } {
  let due = b.money.due
  let held = b.money.security_held
  for (const s of steps) {
    if (!s.enabled) continue
    if (s.key === 'apply') { due -= s.amount; held -= s.amount }
    if (s.key === 'collect') due -= s.amount
    if (s.key === 'refund') due += s.amount
    if (s.key === 'secout') held -= s.amount
  }
  return { due: round2(due), held: round2(held) }
}

export default function SettleDialog({
  booking,
  onClose,
  onApplied,
  reload,
  onPrintSettlement,
  justReturned = false,
}: {
  booking: RentalBooking
  onClose(): void
  onApplied(b: RentalBooking): void
  reload(): Promise<RentalBooking | null>
  onPrintSettlement(b: RentalBooking): void
  justReturned?: boolean
}) {
  const supabase = useMemo(() => createClient(), [])
  const [steps, setSteps] = useState<Step[]>(() => buildPlan(booking))
  const [states, setStates] = useState<Record<string, StepState>>({})
  const [started, setStarted] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<{ text: string; tone: 'err' | 'warn' | 'info' } | null>(null)
  const [finished, setFinished] = useState<RentalBooking | null>(null)
  // การจองล่าสุดระหว่างทำ (อัปเดตทุกขั้น)
  const latestRef = useRef(booking)
  // ยอดตอนเปิด (แผนคิดจากยอดนี้) — ระหว่างทำ booking ถูกอัปเดตทีละขั้น ถ้าคิดจากยอดใหม่จะหักซ้ำ
  const initialRef = useRef(booking)

  // แผนนี้มีแต่ขั้นที่ค้างไม่รู้ผล (ยอดเดิม) — ยังไม่คิดยอดหลังทำ/ไม่มีขั้นปิดงาน จนกว่าจะรู้ผล
  const resumeOnly = steps.length > 0 && steps.every(s => s.resumed)
  const after = afterPlan(initialRef.current, steps)
  const canComplete = Math.abs(after.due) < 0.005 && after.held < 0.005
  const runnable = steps.filter(s => s.enabled && (s.key !== 'complete' || canComplete))
  const remaining = runnable.filter(s => states[s.key] !== 'done')

  function toggle(key: StepKey) {
    if (started) return
    setSteps(prev => prev.map(s => (s.key === key && !s.resumed ? { ...s, enabled: !s.enabled } : s)))
  }

  function setMethod(key: StepKey, method: RentalCashMethod) {
    if (started) return
    setSteps(prev => prev.map(s => (s.key === key && !s.resumed ? { ...s, method } : s)))
  }

  async function runPayment(step: Step): Promise<boolean> {
    const b = latestRef.current
    const key = pendingKey(b.id, `settle:${step.key}`)
    const prev = getPending(key)
    const cid = prev?.clientId ?? newUuid()
    const hadPending = !!prev
    setPending(key, { clientId: cid, kind: step.kind as RentalPaymentKind, method: step.method, amount: step.amount, note: NOTE })
    const res = await callRpc(supabase, 'rental_add_payment', {
      p_client_id: cid,
      p_booking_id: b.id,
      p_kind: step.kind,
      p_method: step.method,
      p_amount: step.amount,
      p_note: NOTE,
    })
    if (res.ok) {
      const out = parseAddPaymentResult(res.data)
      if (out) {
        clearPending(key, cid)
        latestRef.current = out.booking
        onApplied(out.booking)
        return true
      }
      setError({ text: 'ระบบตอบกลับไม่ครบ — กด "ทำต่อ" เพื่อตรวจสอบ (ระบบจะไม่บันทึกซ้ำ)', tone: 'warn' })
      const fresh = await reload()
      if (fresh) latestRef.current = fresh
      return false
    }
    if (res.answered) {
      const definite = rejectedAfterDuplicateCheck(res.error)
      if (definite || !hadPending) clearPending(key, cid)
      setError({ text: `${step.label}: ${errorText(res.error)}`, tone: 'err' })
      return false
    }
    setError({ text: `${step.label}: ${UNSURE_MSG}`, tone: 'warn' })
    const fresh = await reload()
    if (fresh) latestRef.current = fresh
    return false
  }

  async function runComplete(): Promise<boolean> {
    const res = await runBookingWrite({
      sb: supabase,
      fn: 'rental_complete',
      args: { p_booking_id: latestRef.current.id },
      reload,
      verify: fresh => fresh.status === 'completed',
    })
    if (res.status === 'ok') {
      latestRef.current = res.booking
      onApplied(res.booking)
      return true
    }
    setError({ text: `ปิดงาน: ${res.message}`, tone: res.status === 'unsure' ? 'warn' : 'err' })
    return false
  }

  async function run() {
    if (busyRef.current || remaining.length === 0) return
    busyRef.current = true
    setBusy(true)
    setStarted(true)
    setError(null)
    try {
      for (const step of runnable) {
        if (states[step.key] === 'done') continue
        const ok = step.kind ? await runPayment(step) : await runComplete()
        setStates(prev => ({ ...prev, [step.key]: ok ? 'done' : 'failed' }))
        if (!ok) return
      }
      if (resumeOnly) {
        // รู้ผลขั้นที่ค้างครบแล้ว → คิดแผนที่เหลือใหม่จากยอดล่าสุด ให้ผู้ใช้ตรวจแล้วกดบันทึกเอง
        const latest = latestRef.current
        const next = buildPlan(latest)
        if (next.length > 0) {
          initialRef.current = latest
          setSteps(next)
          setStates({})
          setStarted(false)
          setError({ text: 'ตรวจรายการที่ค้างเรียบร้อย (ไม่บันทึกซ้ำ) — รายการด้านล่างคิดจากยอดล่าสุด ตรวจแล้วกดบันทึกเพื่อทำต่อ', tone: 'info' })
          return
        }
      }
      setFinished(latestRef.current)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  if (finished || (booking.status === 'completed' && !started)) {
    const b = finished ?? booking
    return (
      <DialogShell
        title={b.status === 'completed' ? 'ปิดงานเรียบร้อย' : 'บันทึกสรุปเงินแล้ว'}
        subtitle={`การจอง ${b.booking_no}`}
        icon={<CheckCircle2 {...ICON_SM} />}
        tone="ok"
        onClose={onClose}
        footer={
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary px-4" onClick={() => onPrintSettlement(b)}>
              <Printer {...ICON_SM} />
              พิมพ์ใบสรุปการคืนชุด
            </button>
            <button type="button" className="btn-primary flex-1 min-w-[140px]" onClick={onClose} autoFocus>เสร็จสิ้น</button>
          </div>
        }
      >
        <div aria-live="polite" className="space-y-3">
          <MoneyMini booking={b} />
          {b.status !== 'completed' && (
            <DialogMessage tone="info" text="ยังไม่ได้ปิดงาน — เคลียร์ยอดที่เหลือแล้วกด ปิดงาน ในหน้าการจอง" />
          )}
        </div>
      </DialogShell>
    )
  }

  return (
    <DialogShell
      title="สรุปเงินหลังรับคืนชุด"
      subtitle={`การจอง ${booking.booking_no} · ${booking.customer.name}`}
      icon={<Scale {...ICON_SM} />}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          {error && <DialogMessage tone={error.tone} text={error.text} />}
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <button type="button" onClick={onClose} disabled={busy} className="btn-secondary px-5">
              {started ? 'ปิด' : 'ไว้ทีหลัง'}
            </button>
            <button type="button" onClick={run} disabled={busy || remaining.length === 0} className="btn-primary flex-1 sm:flex-none sm:min-w-[200px]">
              {busy && <Loader2 {...ICON_SM} className="animate-spin" />}
              {busy ? 'กำลังบันทึก...' : started ? 'ทำต่อ' : resumeOnly ? 'ตรวจสอบรายการที่ค้าง' : 'บันทึกตามรายการ'}
            </button>
          </div>
        </>
      }
    >
      {justReturned && <DialogMessage tone="ok" text="บันทึกรับคืนชุดแล้ว — สรุปเงินประกันและยอดคงเหลือต่อได้เลย" />}
      {resumeOnly && !started && (
        <DialogMessage tone="warn" text="มีรายการที่ส่งไปแล้วแต่ยังไม่ทราบผล — กดตรวจสอบก่อน (ระบบไม่บันทึกซ้ำ) แล้วจะคิดรายการที่เหลือจากยอดล่าสุดให้" />
      )}
      <MoneyMini booking={booking} />

      {steps.length === 0 ? (
        <DialogMessage tone="info" text="ไม่มียอดที่ต้องเคลียร์" />
      ) : (
        <ol className="space-y-2">
          {steps.map((s, i) => {
            const st = states[s.key]
            const disabledComplete = s.key === 'complete' && !canComplete
            return (
              <li key={s.key} className={clsx('panel p-3 space-y-2', (!s.enabled || disabledComplete) && 'opacity-70')}>
                <div className="flex items-start gap-3">
                  {/* สถานะของขั้น (แสดงหลังเริ่มบันทึก) */}
                  {started && (
                    <span className="mt-0.5 shrink-0" aria-hidden="true">
                      {st === 'done' ? <CheckCircle2 {...ICON_SM} className="text-green-700" />
                        : st === 'failed' ? <XCircle {...ICON_SM} className="text-red-700" />
                          : <Circle {...ICON_SM} className="text-gray-400" />}
                    </span>
                  )}
                  <label className="flex min-w-0 flex-1 items-start gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={s.enabled && !disabledComplete}
                      disabled={started || busy || s.resumed || disabledComplete}
                      onChange={() => toggle(s.key)}
                      className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-medium text-gray-900">{i + 1}. {s.label}</span>
                        {s.kind && <span className="money text-gray-900">{baht(s.amount)}</span>}
                      </span>
                      {s.resumed && <span className="block text-xs text-amber-800">ขั้นนี้ส่งไปแล้วแต่ยังไม่ทราบผล — ระบบจะตรวจและไม่บันทึกซ้ำ</span>}
                      {disabledComplete && (
                        <span className="block text-xs text-gray-500">
                          ปิดงานได้เมื่อยอดค้าง = 0 และไม่ถือเงินประกัน (หลังทำตามรายการ: ค้าง {baht(after.due)} · ประกัน {baht(after.held)})
                        </span>
                      )}
                      {st === 'done' && <span className="block text-xs text-green-800">บันทึกแล้ว</span>}
                    </span>
                  </label>
                </div>
                {s.kind && s.kind !== 'security_apply' && s.enabled && (
                  <div className={clsx('grid grid-cols-4 gap-1.5', started ? 'pl-[62px]' : 'pl-8')} role="group" aria-label={`วิธีของ ${s.label}`}>
                    {RENTAL_CASH_METHODS.map(mt => (
                      <button
                        key={mt}
                        type="button"
                        className="choice min-h-[44px] px-1 text-xs"
                        aria-pressed={s.method === mt}
                        disabled={started || busy || s.resumed}
                        onClick={() => setMethod(s.key, mt)}
                      >
                        {METHOD_LABELS[mt]}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
      <p className="flex items-start gap-1.5 text-xs text-gray-500">
        <Info {...ICON_XS} className="mt-0.5 shrink-0" />
        แต่ละขั้นออกใบเสร็จแยก (พิมพ์ได้จากรายการเงินของการจอง) · ต้องการยอดอื่นให้ใช้ปุ่ม "รายการเงิน"
      </p>
    </DialogShell>
  )
}
