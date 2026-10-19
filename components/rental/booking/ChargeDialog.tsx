'use client'
// เพิ่มค่าปรับ / ค่าใช้จ่าย (rental_add_charge) — หลังรับชุดแล้ว (กำลังเช่า / คืนแล้วรอปิดงาน)
// ส่ง p_client_id (สุ่มตอนเปิดป็อปอัป) → ส่งซ้ำด้วยรหัสเดิม ฐานข้อมูลคืนการจองตามเดิม ไม่ได้ค่าปรับซ้อนสองรายการ
// ไม่รู้ผล → ล็อกค่าที่ส่งไว้ + เก็บรหัสนอกป็อปอัป (ปิดแล้วเปิดใหม่ยังส่งซ้ำด้วยรหัสเดิม) ; ถูกปฏิเสธแน่ชัด → รหัสใหม่ แก้ค่าได้
import { useId, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Loader2, ReceiptText } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON_SM } from '@/components/theme/icons'
import { baht } from '@/lib/format'
import { parseMoneyInput } from '@/lib/money'
import { newUuid } from '@/lib/products'
import {
  CHARGE_KIND_LABELS, MAX_RENTAL_MONEY, RENTAL_CHARGE_KINDS, sizeLabel,
  type RentalBooking, type RentalChargeKind,
} from '@/lib/rental'
import DialogShell, { DialogMessage } from './DialogShell'
import {
  RESUME_WRITE_MSG, clearPendingWrite, clientIdTakenElsewhere, getPendingWrite, pendingKey, runBookingWrite, setPendingWrite,
} from './rpc'

interface ChargeArgs {
  kind: RentalChargeKind
  line: string
  desc: string
  amount: number
}

export default function ChargeDialog({
  booking,
  onClose,
  onApplied,
  reload,
}: {
  booking: RentalBooking
  onClose(): void
  onApplied(b: RentalBooking, message: string): void
  reload(): Promise<RentalBooking | null>
}) {
  const supabase = useMemo(() => createClient(), [])
  const lineId = useId()
  const descId = useId()
  const amountId = useId()
  const key = pendingKey(booking.id, 'charge')
  // คำขอครั้งก่อนที่ยังไม่รู้ผล (ป็อปอัปถูกปิดกลางทาง) → เปิดมาด้วยค่าเดิม + รหัสเดิม
  const [initial] = useState(() => getPendingWrite<ChargeArgs>(key))
  const [kind, setKind] = useState<RentalChargeKind>(initial?.args.kind ?? 'damage')
  const [line, setLine] = useState(initial?.args.line ?? '')
  const [desc, setDesc] = useState(initial?.args.desc ?? CHARGE_KIND_LABELS.damage)
  const [descTouched, setDescTouched] = useState(!!initial)
  const [amount, setAmount] = useState(initial ? String(initial.args.amount) : '')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<{ text: string; tone: 'err' | 'warn' } | null>(
    initial ? { text: RESUME_WRITE_MSG, tone: 'warn' } : null,
  )
  const clientIdRef = useRef(initial?.clientId ?? newUuid())
  // ส่งไปแล้วแต่ไม่รู้ผล → ห้ามแก้ค่า (ส่งซ้ำต้องเป็นค่าเดิมกับรหัสเดิม)
  const [locked, setLocked] = useState(!!initial)

  const parsed = parseMoneyInput(amount)
  const amountOk = parsed !== null && parsed > 0 && parsed <= MAX_RENTAL_MONEY
  const cleanDesc = desc.trim()
  const canSubmit = !busy && amountOk && cleanDesc.length >= 1 && cleanDesc.length <= 200

  // คำอธิบายตั้งต้น = ประเภท + รหัสชิ้น (ถ้าเลือก) — ผู้ใช้แก้เองแล้วไม่ทับ
  function autoDesc(k: RentalChargeKind, lineIdValue: string) {
    if (descTouched) return
    const l = booking.lines.find(x => x.id === lineIdValue)
    setDesc(`${CHARGE_KIND_LABELS[k]}${l ? ` ${l.unit_code}` : ''}`)
  }

  async function submit() {
    if (busyRef.current || !canSubmit || parsed === null) return
    const args: ChargeArgs = { kind, line, desc: cleanDesc, amount: parsed }
    const cid = clientIdRef.current
    const hadPending = getPendingWrite<ChargeArgs>(key)?.clientId === cid
    // จำไว้ก่อนส่ง (นอกป็อปอัป) — ปิดกลางทางแล้วเปิดใหม่ยังได้รหัสเดิม
    setPendingWrite(key, { clientId: cid, args })
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await runBookingWrite({
        sb: supabase,
        fn: 'rental_add_charge',
        args: {
          p_booking_id: booking.id,
          p_kind: args.kind,
          p_description: args.desc,
          p_amount: args.amount,
          p_line_id: args.line || null,
          p_client_id: cid,
        },
        reload,
        // ไม่รู้ผล → ดูจากประวัติการจองว่ามี "เพิ่มค่าปรับ" ของรหัสคำขอนี้หรือยัง (ฐานข้อมูลจดรหัสไว้)
        // ห้ามเดาจากชนิด+ยอดที่ตรงกัน — พนักงานอีกคนอาจเพิ่มรายการเดียวกันพร้อมกัน ; ฐานข้อมูลรุ่นที่ไม่จดรหัส = ส่งซ้ำด้วยรหัสเดิม (ไม่ซ้ำ)
        verify: fresh => fresh.logs.some(l => l.action === 'charge_add' && l.detail?.client_id === cid),
      })
      if (res.status === 'ok') {
        clearPendingWrite(key, cid)
        onApplied(res.booking, `เพิ่ม${CHARGE_KIND_LABELS[args.kind]} ${baht(args.amount)} แล้ว${res.verified ? ' (ตรวจจากข้อมูลล่าสุด)' : ''}`)
        onClose()
        return
      }
      if (res.status === 'rejected') {
        // ปฏิเสธแน่ชัด / ครั้งแรกที่ส่งรหัสนี้ = ไม่ได้บันทึก → รหัสใหม่ แก้ค่าได้
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
      title="เพิ่มค่าปรับ / ค่าใช้จ่าย"
      subtitle={`การจอง ${booking.booking_no}`}
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
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="group" aria-label="ประเภทค่าใช้จ่าย">
          {RENTAL_CHARGE_KINDS.map(k => (
            <button
              key={k}
              type="button"
              className="choice px-1"
              aria-pressed={kind === k}
              disabled={busy || locked}
              onClick={() => { setKind(k); autoDesc(k, line) }}
            >
              {CHARGE_KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor={lineId} className="field-label">ชิ้นที่เกี่ยวข้อง</label>
        <select
          id={lineId}
          className="input"
          value={line}
          disabled={busy || locked}
          onChange={e => { setLine(e.target.value); autoDesc(kind, e.target.value) }}
        >
          <option value="">ทั้งการจอง (ไม่ระบุชิ้น)</option>
          {booking.lines.map(l => (
            <option key={l.id} value={l.id}>{l.unit_code} · {l.item_name} · {sizeLabel(l.size)}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={descId} className="field-label">รายละเอียด *</label>
        <input
          id={descId}
          className="input"
          value={desc}
          maxLength={200}
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
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }}
        />
        <p className={clsx('field-hint', amount.trim() !== '' && !amountOk && 'text-red-700 font-medium')}>
          {amount.trim() !== '' && !amountOk ? 'กรอกจำนวนเงินมากกว่า 0' : 'ยอดนี้บวกเข้ายอดรวมของการจอง — หักจากเงินประกันได้ที่ปุ่ม "รายการเงิน"'}
        </p>
      </div>
    </DialogShell>
  )
}
