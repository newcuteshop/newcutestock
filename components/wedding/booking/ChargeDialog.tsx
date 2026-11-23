'use client'
// เพิ่มค่าใช้จ่าย (wed_add_charge) — ค่าล่วงเวลา / ค่าเดินทางเพิ่ม / บริการเพิ่มเติม / อื่นๆ (ตั้งแต่ยืนยันงานจนถึงส่งงาน)
// ค่าล่วงเวลา: ตัวช่วยคิด ชั่วโมง × อัตราค่าล่วงเวลาในตั้งค่าร้าน (ผู้ใช้แก้ยอดเองได้เสมอ)
// ส่ง p_client_id (สุ่มตอนเปิด) → ส่งซ้ำด้วยรหัสเดิม ฐานข้อมูลคืนงานตามเดิม ไม่ได้ค่าใช้จ่ายซ้อนสองรายการ
// ไม่รู้ผล → ล็อกค่าที่ส่งไว้ + เก็บรหัสนอกป็อปอัป ; ถูกปฏิเสธแน่ชัด → รหัสใหม่ แก้ค่าได้
// (fix-07 ไม่ได้จด client_id ในประวัติของค่าใช้จ่าย → ตรวจผลจากประวัติไม่ได้ ให้กดส่งซ้ำด้วยรหัสเดิมแทน ซึ่งปลอดภัย)
import { useId, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Calculator, Loader2, ReceiptText } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON_SM } from '@/components/theme/icons'
import { baht } from '@/lib/format'
import { parseMoneyInput, round2 } from '@/lib/money'
import { newUuid } from '@/lib/products'
import {
  MAX_WED_MONEY, WED_CHARGE_KINDS, WED_CHARGE_KIND_LABELS,
  type WedBooking, type WedChargeKind, type WedSettings,
} from '@/lib/wedding'
import DialogShell, { DialogMessage } from '@/components/rental/booking/DialogShell'
import {
  RESUME_WRITE_MSG, clearPendingWrite, clientIdTakenElsewhere, getPendingWrite, pendingKey, runWedWrite, setPendingWrite,
} from './rpc'

interface ChargeArgs {
  kind: WedChargeKind
  desc: string
  amount: number
}

const MAX_DESC = 200

export default function ChargeDialog({
  booking,
  settings,
  onClose,
  onApplied,
  reload,
}: {
  booking: WedBooking
  settings: WedSettings
  onClose(): void
  onApplied(b: WedBooking, message: string): void
  reload(): Promise<WedBooking | null>
}) {
  const supabase = useMemo(() => createClient(), [])
  const descId = useId()
  const amountId = useId()
  const hoursId = useId()
  const key = pendingKey(booking.id, 'charge')
  const [initial] = useState(() => getPendingWrite<ChargeArgs>(key))
  const [kind, setKind] = useState<WedChargeKind>(initial?.args.kind ?? 'overtime')
  const [desc, setDesc] = useState(initial?.args.desc ?? WED_CHARGE_KIND_LABELS.overtime)
  const [descTouched, setDescTouched] = useState(!!initial)
  const [amount, setAmount] = useState(initial ? String(initial.args.amount) : '')
  const [hours, setHours] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<{ text: string; tone: 'err' | 'warn' } | null>(
    initial ? { text: RESUME_WRITE_MSG, tone: 'warn' } : null,
  )
  const clientIdRef = useRef(initial?.clientId ?? newUuid())
  const [locked, setLocked] = useState(!!initial)

  const parsed = parseMoneyInput(amount)
  const amountOk = parsed !== null && parsed > 0 && parsed <= MAX_WED_MONEY
  const cleanDesc = desc.trim()
  const canSubmit = !busy && amountOk && cleanDesc.length >= 1 && cleanDesc.length <= MAX_DESC
  const rate = settings.overtime_rate
  const hoursNum = parseMoneyInput(hours)
  const hoursOk = hoursNum !== null && hoursNum > 0 && hoursNum <= 48
  const suggested = hoursOk && rate > 0 ? round2(hoursNum * rate) : 0

  function chooseKind(k: WedChargeKind) {
    setKind(k)
    if (!descTouched) setDesc(WED_CHARGE_KIND_LABELS[k])
  }

  // ชั่วโมงเปลี่ยน → คำอธิบายตั้งต้นบอกจำนวนชั่วโมง (ผู้ใช้แก้คำอธิบายเองแล้วไม่ทับ)
  function changeHours(v: string) {
    setHours(v)
    const h = parseMoneyInput(v)
    if (!descTouched && kind === 'overtime') {
      setDesc(h !== null && h > 0 ? `${WED_CHARGE_KIND_LABELS.overtime} ${h} ชั่วโมง` : WED_CHARGE_KIND_LABELS.overtime)
    }
  }

  async function submit() {
    if (busyRef.current || !canSubmit || parsed === null) return
    const args: ChargeArgs = { kind, desc: cleanDesc, amount: parsed }
    const cid = clientIdRef.current
    const hadPending = getPendingWrite<ChargeArgs>(key)?.clientId === cid
    setPendingWrite(key, { clientId: cid, args })
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await runWedWrite({
        sb: supabase,
        fn: 'wed_add_charge',
        args: { p_client_id: cid, p_booking_id: booking.id, p_kind: args.kind, p_description: args.desc, p_amount: args.amount },
        reload,
      })
      if (res.status === 'ok') {
        clearPendingWrite(key, cid)
        onApplied(res.booking, res.already
          ? 'รายการนี้บันทึกไว้แล้วก่อนหน้า (ไม่ได้เพิ่มซ้ำ)'
          : `เพิ่ม${WED_CHARGE_KIND_LABELS[args.kind]} ${baht(args.amount)} แล้ว`)
        onClose()
        return
      }
      if (res.status === 'rejected') {
        if (res.definite || !hadPending || clientIdTakenElsewhere(res.message)) {
          clearPendingWrite(key, cid)
          clientIdRef.current = newUuid()
          setLocked(false)
        }
        setError({ text: res.message, tone: 'err' })
        return
      }
      setLocked(true)
      setError({ text: res.message, tone: 'warn' })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title="เพิ่มค่าใช้จ่าย"
      subtitle={`${booking.booking_no} · ${booking.couple_names}`}
      icon={<ReceiptText {...ICON_SM} />}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          {error && <DialogMessage tone={error.tone} text={error.text} />}
          <div className="flex gap-2 sm:justify-end">
            <button type="button" onClick={onClose} disabled={busy} className="btn-secondary px-5">ยกเลิก</button>
            <button type="button" onClick={submit} disabled={!canSubmit} className="btn-primary flex-1 sm:flex-none sm:min-w-[180px]">
              {busy && <Loader2 {...ICON_SM} className="animate-spin" />}
              {busy ? 'กำลังบันทึก...' : locked ? 'ส่งอีกครั้ง' : 'เพิ่มรายการ'}
            </button>
          </div>
        </>
      }
    >
      <div>
        <p className="field-label">ประเภท</p>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="ประเภทค่าใช้จ่าย">
          {WED_CHARGE_KINDS.map(k => (
            <button key={k} type="button" className="choice px-1" aria-pressed={kind === k} disabled={busy || locked} onClick={() => chooseKind(k)}>
              {WED_CHARGE_KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </div>

      {kind === 'overtime' && (
        <div className="panel p-3 space-y-2">
          <label htmlFor={hoursId} className="field-label mb-0 flex items-center gap-1.5">
            <Calculator {...ICON_SM} />
            ตัวช่วยคิดค่าล่วงเวลา
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id={hoursId}
              className="input w-28 text-right tabular-nums"
              inputMode="decimal"
              autoComplete="off"
              placeholder="ชั่วโมง"
              value={hours}
              disabled={busy || locked}
              onChange={e => changeHours(e.target.value)}
            />
            <span className="text-sm text-gray-700">ชม. × {rate > 0 ? baht(rate) : 'ยังไม่ได้ตั้งอัตรา'}</span>
            {suggested > 0 && (
              <button
                type="button"
                className="chip-toggle"
                aria-pressed={parsed !== null && Math.abs(parsed - suggested) < 0.005}
                disabled={busy || locked}
                onClick={() => setAmount(String(suggested))}
              >
                ใช้ยอด {baht(suggested)}
              </button>
            )}
          </div>
          {rate <= 0 && <p className="text-xs text-gray-500">ตั้งอัตราค่าล่วงเวลาต่อชั่วโมงได้ที่ ตั้งค่าร้าน → นโยบาย (ผู้จัดการ)</p>}
        </div>
      )}

      <div>
        <label htmlFor={descId} className="field-label">รายละเอียด *</label>
        <input
          id={descId}
          className="input"
          value={desc}
          maxLength={MAX_DESC}
          disabled={busy || locked}
          autoComplete="off"
          onChange={e => { setDesc(e.target.value); setDescTouched(true) }}
        />
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
          aria-invalid={amount.trim() !== '' && !amountOk}
          onChange={e => setAmount(e.target.value)}
        />
        <p className={clsx('field-hint', amount.trim() !== '' && !amountOk && 'text-red-700 font-medium')}>
          {amount.trim() !== '' && !amountOk ? 'กรอกจำนวนเงินมากกว่า 0' : 'ยอดนี้บวกเข้ายอดสุทธิของงาน — งวดสุดท้ายที่ยังค้างจะรับส่วนต่างให้อัตโนมัติ'}
        </p>
      </div>
    </DialogShell>
  )
}
