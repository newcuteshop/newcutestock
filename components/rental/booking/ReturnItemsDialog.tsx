'use client'
// รับคืนชุด (rental_return) — วันที่คืน · สภาพรายชิ้น (ปกติ/เปื้อน/ชำรุด/สูญหาย) · ค่าปรับคืนช้า (เติมให้ตามที่ร้านตั้ง แก้ได้)
//   · ค่าเสียหาย/ค่าชุดหาย รายชิ้น · ค่าใช้จ่ายอื่น · สรุปเทียบกับเงินประกันที่ถือ
// ค่าปรับทั้งหมดส่งไปพร้อมการรับคืนในคำขอเดียว (เซิร์ฟเวอร์บันทึกตามที่ส่งมาเท่านั้น)
// ชิ้นปกติ: ติ๊ก "พร้อมให้เช่าต่อทันที" ได้ (ไม่ต้องซัก) ; อื่นๆ ระบบตั้งเป็น "ต้องซัก" ; สูญหาย = ชิ้นถูกเลิกใช้
// รับคืนซ้ำเมื่อคืนไปแล้วเซิร์ฟเวอร์ปฏิเสธ → ไม่รู้ผลให้โหลดใหม่ สถานะคืนแล้ว = สำเร็จ (ค่าปรับไม่ถูกบันทึกซ้ำ)
import { useId, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Loader2, Undo2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON_SM } from '@/components/theme/icons'
import { baht, daysBetweenKeys, formatThaiDate, isDayKey } from '@/lib/format'
import { parseMoneyInput, round2 } from '@/lib/money'
import {
  CONDITION_LABELS, MAX_RENTAL_MONEY, RENTAL_CONDITIONS, sizeLabel,
  type RentalBooking, type RentalChargeKind, type RentalCondition, type RentalSettings,
} from '@/lib/rental'
import RentalImage from '@/components/rental/RentalImage'
import DialogShell, { DialogMessage } from './DialogShell'
import { runBookingWrite, statusAtLeast, todayKeySafe } from './rpc'

type LineState = { condition: RentalCondition; note: string; ready: boolean; fee: string }

function feeText(n: number): string {
  return n > 0 ? String(round2(n)) : ''
}

// ช่องเงินว่าง = 0 ; พิมพ์ผิด = null
function moneyOrZero(s: string): number | null {
  if (s.trim() === '') return 0
  const n = parseMoneyInput(s)
  if (n === null || n < 0 || n > MAX_RENTAL_MONEY) return null
  return n
}

export default function ReturnItemsDialog({
  booking,
  settings,
  onClose,
  onReturned,
  reload,
}: {
  booking: RentalBooking
  settings: RentalSettings
  onClose(): void
  onReturned(b: RentalBooking): void
  reload(): Promise<RentalBooking | null>
}) {
  const supabase = useMemo(() => createClient(), [])
  const dateId = useId()
  const lateId = useId()
  const otherDescId = useId()
  const otherAmtId = useId()
  const noteId = useId()
  const today = todayKeySafe()
  const lines = useMemo(() => booking.lines.filter(l => l.status === 'picked_up'), [booking.lines])

  const [returnedOn, setReturnedOn] = useState(() => (today && today >= booking.pickup_date ? today : booking.pickup_date))
  const [state, setState] = useState<Record<string, LineState>>(() => {
    const init: Record<string, LineState> = {}
    for (const l of lines) init[l.id] = { condition: 'ok', note: '', ready: false, fee: '' }
    return init
  })
  // ค่าปรับคืนช้า: null = ใช้ค่าที่ระบบแนะนำตามวันที่คืน (ผู้ใช้ยังไม่แก้เอง)
  const [lateText, setLateText] = useState<string | null>(null)
  const [otherDesc, setOtherDesc] = useState('')
  const [otherAmt, setOtherAmt] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<{ text: string; tone: 'err' | 'warn' } | null>(null)

  const dateValid = isDayKey(returnedOn) && returnedOn >= booking.pickup_date && (!today || returnedOn <= today)
  const lateDays = dateValid ? Math.max(0, daysBetweenKeys(booking.return_date, returnedOn)) : 0

  // อัตราค่าปรับต่อวัน: ใช้อัตราจากเซิร์ฟเวอร์ถ้ามี (คำนวณแบบเดียวกับ rental_late_info) ไม่งั้นคิดจากตั้งค่าร้าน
  const perDay = useMemo(() => {
    if (booking.late.late_days > 0) return round2(booking.late.suggested_late_fee / booking.late.late_days)
    if (settings.late_fee_mode === 'per_day_item') return round2(lines.reduce((s, l) => s + l.extra_day_price, 0))
    if (settings.late_fee_mode === 'fixed_per_day') return settings.late_fee_fixed
    return 0
  }, [booking.late, settings.late_fee_mode, settings.late_fee_fixed, lines])
  const suggestedLate = round2(lateDays * perDay)
  const lateValue = lateText === null ? suggestedLate : moneyOrZero(lateText)

  function patch(id: string, p: Partial<LineState>) {
    setState(prev => ({ ...prev, [id]: { ...prev[id], ...p } }))
    setError(null)
  }

  function setCondition(id: string, c: RentalCondition) {
    const l = lines.find(x => x.id === id)
    const prev = state[id]
    // สูญหาย → เติมค่าชุดหายตามราคาชดเชยที่ตั้งไว้ ; ชำรุด/เปื้อน → กรอกเอง (เปลี่ยนจากสูญหายมา = ล้างค่าที่เติมไว้) ; ปกติ → ไม่มีค่าใช้จ่าย
    const fee = c === 'lost'
      ? feeText(l?.replacement_cost ?? 0)
      : c === 'ok' || prev?.condition === 'lost' ? '' : prev?.fee ?? ''
    patch(id, { condition: c, fee, ready: c === 'ok' ? prev?.ready ?? false : false })
  }

  // ค่าปรับที่จะส่ง + ตรวจช่องเงิน
  const charges: { line_id?: string; kind: RentalChargeKind; description: string; amount: number }[] = []
  let invalid = ''
  if (lateValue === null) invalid = 'ค่าปรับคืนช้าไม่ถูกต้อง'
  else if (lateValue > 0) charges.push({ kind: 'late', description: `ค่าปรับคืนช้า ${lateDays} วัน`.slice(0, 200), amount: lateValue })
  for (const l of lines) {
    const s = state[l.id]
    if (!s || s.condition === 'ok') continue
    const fee = moneyOrZero(s.fee)
    if (fee === null) {
      invalid = `จำนวนเงินของชิ้น ${l.unit_code} ไม่ถูกต้อง`
      continue
    }
    if (fee <= 0) continue
    const kind: RentalChargeKind = s.condition === 'lost' ? 'lost' : s.condition === 'damaged' ? 'damage' : 'cleaning'
    const what = s.condition === 'lost' ? 'ค่าชุดสูญหาย' : s.condition === 'damaged' ? 'ค่าเสียหาย' : 'ค่าซักพิเศษ'
    charges.push({
      line_id: l.id,
      kind,
      description: `${what} ${l.unit_code}${s.note.trim() ? ` — ${s.note.trim()}` : ''}`.slice(0, 200),
      amount: fee,
    })
  }
  const otherValue = moneyOrZero(otherAmt)
  if (otherValue === null) invalid = 'จำนวนเงินค่าใช้จ่ายอื่นไม่ถูกต้อง'
  else if (otherValue > 0) {
    if (!otherDesc.trim()) invalid = 'กรอกรายละเอียดค่าใช้จ่ายอื่น'
    else charges.push({ kind: 'other', description: otherDesc.trim().slice(0, 200), amount: otherValue })
  }
  const newCharges = round2(charges.reduce((s, c) => s + c.amount, 0))

  const m = booking.money
  const dueAfter = round2(m.due + newCharges)
  const held = m.security_held
  const apply = round2(Math.min(held, Math.max(0, dueAfter)))
  const refundSec = round2(held - apply)
  const collect = round2(Math.max(0, dueAfter - apply))

  const canSubmit = !busy && dateValid && invalid === '' && lines.length > 0 && note.trim().length <= 500

  async function submit() {
    if (busyRef.current || !canSubmit) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await runBookingWrite({
        sb: supabase,
        fn: 'rental_return',
        args: {
          p_booking_id: booking.id,
          p_payload: {
            returned_on: returnedOn,
            lines: lines.map(l => {
              const s = state[l.id]
              return {
                line_id: l.id,
                condition: s?.condition ?? 'ok',
                note: s?.note.trim() || null,
                clean: s?.condition === 'ok' ? !!s.ready : false,
              }
            }),
            charges,
            note: note.trim() || null,
          },
        },
        reload,
        verify: fresh => statusAtLeast(fresh.status, 'returned'),
      })
      if (res.status === 'ok') {
        onReturned(res.booking)
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
      title="รับคืนชุด"
      subtitle={`การจอง ${booking.booking_no} · ${booking.customer.name}`}
      icon={<Undo2 {...ICON_SM} />}
      busy={busy}
      wide
      onClose={onClose}
      footer={
        <>
          {invalid && <p className="text-xs font-medium text-red-700" aria-live="polite">{invalid}</p>}
          {error && <DialogMessage tone={error.tone} text={error.text} />}
          <div className="flex gap-2 sm:justify-end">
            <button type="button" onClick={onClose} disabled={busy} className="btn-secondary px-5">ยกเลิก</button>
            <button type="button" onClick={submit} disabled={!canSubmit} className="btn-primary flex-1 sm:flex-none sm:min-w-[200px]">
              {busy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Undo2 {...ICON_SM} />}
              {busy ? 'กำลังบันทึก...' : 'ยืนยันรับคืนชุด'}
            </button>
          </div>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor={dateId} className="field-label">วันที่คืน *</label>
          <input
            id={dateId}
            type="date"
            className="input"
            value={returnedOn}
            min={booking.pickup_date}
            max={today || undefined}
            disabled={busy}
            aria-invalid={!dateValid}
            onChange={e => { setReturnedOn(e.target.value); setError(null) }}
          />
          <p className={clsx('field-hint', !dateValid && 'text-red-700 font-medium')}>
            {dateValid
              ? `คืน ${formatThaiDate(returnedOn)} · กำหนดคืน ${formatThaiDate(booking.return_date)} · ${lateDays > 0 ? `ช้า ${lateDays} วัน` : 'ไม่ช้า'}`
              : `เลือกวันระหว่าง ${formatThaiDate(booking.pickup_date)} ถึงวันนี้`}
          </p>
        </div>
        <div>
          <label htmlFor={lateId} className="field-label">ค่าปรับคืนช้า (บาท)</label>
          <input
            id={lateId}
            className="input text-right tabular-nums"
            inputMode="decimal"
            autoComplete="off"
            value={lateText ?? feeText(suggestedLate)}
            disabled={busy}
            aria-invalid={lateValue === null}
            onChange={e => setLateText(e.target.value)}
          />
          <p className="field-hint">
            {lateDays > 0
              ? perDay > 0 ? `แนะนำ ${lateDays} วัน × ${baht(perDay)} = ${baht(suggestedLate)} (แก้ได้ / ใส่ 0 = ไม่คิด)` : 'ร้านตั้งไว้ไม่คิดค่าปรับคืนช้า'
              : 'คืนตรงเวลา'}
            {lateText !== null && (
              <button type="button" className="link ml-2" onClick={() => setLateText(null)} disabled={busy}>ใช้ค่าแนะนำ</button>
            )}
          </p>
        </div>
      </div>

      <div>
        <p className="field-label">สภาพชุดที่คืน (ทุกชิ้น)</p>
        <ul className="space-y-2">
          {lines.map(l => {
            const s = state[l.id]
            if (!s) return null
            const noteFieldId = `rnote-${l.id}`
            const feeFieldId = `rfee-${l.id}`
            return (
              <li key={l.id} className="panel p-3 space-y-2.5">
                <div className="flex items-start gap-3">
                  <RentalImage path={l.cover_path} alt="" className="h-14 w-12 shrink-0 rounded-lg border border-gray-200" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 break-words">{l.item_name}</p>
                    <p className="text-xs text-gray-500">{sizeLabel(l.size)} · <span className="font-mono">{l.unit_code}</span></p>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="group" aria-label={`สภาพของ ${l.unit_code}`}>
                  {RENTAL_CONDITIONS.map(c => (
                    <button
                      key={c}
                      type="button"
                      className={clsx('choice min-h-[44px]', c === 'ok' && 'tone-leaf', c === 'dirty' && 'tone-honey', (c === 'damaged' || c === 'lost') && 'tone-cherry')}
                      aria-pressed={s.condition === c}
                      disabled={busy}
                      onClick={() => setCondition(l.id, c)}
                    >
                      {CONDITION_LABELS[c]}
                    </button>
                  ))}
                </div>
                {s.condition === 'ok' ? (
                  <label className="flex items-center gap-2 min-h-[44px] text-sm text-gray-800 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={s.ready}
                      disabled={busy}
                      onChange={e => patch(l.id, { ready: e.target.checked })}
                      className="h-5 w-5 shrink-0 accent-brand-600"
                    />
                    พร้อมให้เช่าต่อทันที (ไม่ต้องซัก)
                  </label>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-2">
                    <div>
                      <label htmlFor={noteFieldId} className="sr-only">หมายเหตุสภาพ {l.unit_code}</label>
                      <input
                        id={noteFieldId}
                        className="input"
                        value={s.note}
                        maxLength={150}
                        disabled={busy}
                        autoComplete="off"
                        placeholder={s.condition === 'lost' ? 'รายละเอียด (เช่น ลูกค้าแจ้งหาย)' : 'ตำแหน่ง/ลักษณะรอย'}
                        onChange={e => patch(l.id, { note: e.target.value })}
                      />
                    </div>
                    <div>
                      <label htmlFor={feeFieldId} className="sr-only">
                        {s.condition === 'lost' ? 'ค่าชุดสูญหาย' : s.condition === 'damaged' ? 'ค่าเสียหาย' : 'ค่าซักพิเศษ'} {l.unit_code}
                      </label>
                      <input
                        id={feeFieldId}
                        className="input text-right tabular-nums"
                        inputMode="decimal"
                        autoComplete="off"
                        value={s.fee}
                        disabled={busy}
                        placeholder={s.condition === 'lost' ? 'ค่าชุดหาย' : s.condition === 'damaged' ? 'ค่าเสียหาย' : 'ค่าซัก (ถ้ามี)'}
                        aria-invalid={moneyOrZero(s.fee) === null}
                        onChange={e => patch(l.id, { fee: e.target.value })}
                      />
                    </div>
                    {s.condition === 'lost' && (
                      <p className="sm:col-span-2 text-xs text-gray-500">
                        ราคาชดเชยที่ตั้งไว้ {baht(l.replacement_cost)} · ชิ้นนี้จะถูกตั้งเป็น "เลิกใช้"
                      </p>
                    )}
                    {s.condition !== 'lost' && <p className="sm:col-span-2 text-xs text-gray-500">ชิ้นนี้จะถูกตั้งเป็น "ต้องซัก/ตรวจก่อนให้เช่าต่อ"</p>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      <div>
        <p className="field-label">ค่าใช้จ่ายอื่น (ถ้ามี)</p>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-2">
          <div>
            <label htmlFor={otherDescId} className="sr-only">รายละเอียดค่าใช้จ่ายอื่น</label>
            <input id={otherDescId} className="input" value={otherDesc} maxLength={200} disabled={busy} autoComplete="off"
              placeholder="เช่น อุปกรณ์เสริมไม่ครบ" onChange={e => setOtherDesc(e.target.value)} />
          </div>
          <div>
            <label htmlFor={otherAmtId} className="sr-only">จำนวนเงินค่าใช้จ่ายอื่น</label>
            <input id={otherAmtId} className="input text-right tabular-nums" inputMode="decimal" autoComplete="off" value={otherAmt}
              disabled={busy} placeholder="จำนวนเงิน" aria-invalid={otherValue === null} onChange={e => setOtherAmt(e.target.value)} />
          </div>
        </div>
      </div>

      <div>
        <label htmlFor={noteId} className="field-label">หมายเหตุการรับคืน</label>
        <input id={noteId} className="input" value={note} maxLength={500} disabled={busy} autoComplete="off" onChange={e => setNote(e.target.value)} />
      </div>

      <div className="panel px-3.5 py-3 text-sm space-y-1" aria-live="polite">
        <Row label="ค่าปรับ/ค่าใช้จ่ายที่จะเพิ่ม" value={baht(newCharges)} />
        <Row label="ยอดค้างหลังรับคืน" value={baht(dueAfter)} strong={dueAfter > 0.005} />
        <Row label="เงินประกันที่ถืออยู่" value={baht(held)} />
        <hr className="my-1.5 border-gray-200" />
        {apply > 0 && <Row label="หักจากเงินประกันได้" value={baht(apply)} />}
        {refundSec > 0.005 && <Row label="คืนเงินประกันให้ลูกค้า" value={baht(refundSec)} strong />}
        {collect > 0.005 && <Row label="เก็บเงินเพิ่มจากลูกค้า" value={baht(collect)} strong tone="err" />}
        {dueAfter < -0.005 && <Row label="รับเกิน ต้องคืนลูกค้า" value={baht(-dueAfter)} strong tone="warn" />}
        <p className="pt-1 text-xs text-gray-500">บันทึกแล้วจะไปหน้าสรุปเงิน: หักเงินประกัน / คืนเงินประกัน / รับเงินเพิ่ม ได้ในขั้นตอนเดียว</p>
      </div>
    </DialogShell>
  )
}

function Row({ label, value, strong = false, tone }: { label: string; value: string; strong?: boolean; tone?: 'err' | 'warn' }) {
  return (
    <div className={clsx('flex justify-between gap-3', strong && 'font-semibold', tone === 'err' ? 'text-red-700' : tone === 'warn' ? 'text-amber-800' : 'text-gray-800')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}
