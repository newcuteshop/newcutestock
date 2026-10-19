'use client'
// เปลี่ยนวันคืนชุด (rental_extend) — ใช้ได้ทั้งการจองที่ยืนยันแล้วและกำลังเช่า (ขยาย หรือย่นวันคืน)
// ราคาใหม่บนจอเป็นตัวอย่างจากราคาที่บันทึกไว้ตอนจอง (lib/rental linePrice) — เซิร์ฟเวอร์คิดจริงและตรวจว่าชิ้นว่าง
// ชิ้นชนกับการจองอื่น → เซิร์ฟเวอร์แจ้งเลขที่การจองที่ชน (ข้อความไทย) · ส่งวันเดิมซ้ำ = ไม่เปลี่ยนอะไร (กดซ้ำได้ปลอดภัย)
import { useId, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { CalendarPlus, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON_SM } from '@/components/theme/icons'
import { addDaysToKey, baht, formatThaiDate, formatThaiDayLong, isDayKey } from '@/lib/format'
import { round2 } from '@/lib/money'
import { MAX_RENTAL_DAYS, linePrice, rentalDays, sizeLabel, type RentalBooking } from '@/lib/rental'
import DialogShell, { DialogMessage } from './DialogShell'
import { runBookingWrite, todayKeySafe } from './rpc'

export default function ExtendDialog({
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
  const dateId = useId()
  const [date, setDate] = useState(() => addDaysToKey(booking.return_date, 1))
  const [reprice, setReprice] = useState(true)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<{ text: string; tone: 'err' | 'warn' } | null>(null)

  const minKey = booking.pickup_date
  const maxKey = addDaysToKey(booking.pickup_date, MAX_RENTAL_DAYS - 1)
  const valid = isDayKey(date) && date >= minKey && date <= maxKey
  const newDays = valid ? rentalDays(booking.pickup_date, date) : 0
  const today = todayKeySafe()

  // ตัวอย่างค่าเช่าใหม่ของชิ้นที่ยังอยู่ในการเช่า (จองไว้/รับออกไปแล้ว)
  const preview = useMemo(() => {
    const active = booking.lines.filter(l => l.status === 'booked' || l.status === 'picked_up')
    const rows = active.map(l => ({
      line: l,
      next: reprice ? linePrice(l.base_price, l.base_days, l.extra_day_price, newDays) : l.rent_price,
    }))
    const delta = round2(rows.reduce((s, r) => s + (r.next - r.line.rent_price), 0))
    return { rows, delta }
  }, [booking.lines, reprice, newDays])

  const m = booking.money
  const changed = valid && date !== booking.return_date
  const shrink = valid && date < booking.return_date

  async function submit() {
    if (busyRef.current || !changed) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await runBookingWrite({
        sb: supabase,
        fn: 'rental_extend',
        args: { p_booking_id: booking.id, p_new_return_date: date, p_reprice: reprice },
        reload,
        verify: fresh => fresh.return_date === date,
      })
      if (res.status === 'ok') {
        onApplied(res.booking, `เปลี่ยนวันคืนเป็น ${formatThaiDate(date)} แล้ว`)
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
      title="เปลี่ยนวันคืนชุด"
      subtitle={`การจอง ${booking.booking_no}`}
      icon={<CalendarPlus {...ICON_SM} />}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          {error && <DialogMessage tone={error.tone} text={error.text} />}
          <div className="flex gap-2 sm:justify-end">
            <button type="button" onClick={onClose} disabled={busy} className="btn-secondary px-5">ยกเลิก</button>
            <button type="button" onClick={submit} disabled={busy || !changed} className="btn-primary flex-1 sm:flex-none sm:min-w-[180px]">
              {busy && <Loader2 {...ICON_SM} className="animate-spin" />}
              {busy ? 'กำลังบันทึก...' : shrink ? 'ย่นวันคืน' : 'ขยายวันคืน'}
            </button>
          </div>
        </>
      }
    >
      <div className="panel px-3.5 py-3 text-sm space-y-1">
        <div className="flex justify-between gap-3"><span className="text-gray-600">วันรับชุด</span><span className="text-gray-900">{formatThaiDate(booking.pickup_date)}</span></div>
        <div className="flex justify-between gap-3"><span className="text-gray-600">วันคืนเดิม</span><span className="text-gray-900">{formatThaiDate(booking.return_date)} ({booking.days} วัน)</span></div>
        {booking.status === 'picked_up' && today && booking.return_date < today && (
          <p className="text-xs font-medium text-red-700">เลยกำหนดคืนมาแล้ว — ขยายวันคืนแทนการคิดค่าปรับได้</p>
        )}
      </div>

      <div>
        <label htmlFor={dateId} className="field-label">วันคืนชุดใหม่ *</label>
        <input
          id={dateId}
          type="date"
          className="input"
          value={date}
          min={minKey}
          max={maxKey}
          disabled={busy}
          aria-invalid={date !== '' && !valid}
          onChange={e => { setDate(e.target.value); setError(null) }}
        />
        <p className={clsx('field-hint', date !== '' && !valid && 'text-red-700 font-medium')} aria-live="polite">
          {!valid
            ? `เลือกวันระหว่าง ${formatThaiDate(minKey)} ถึง ${formatThaiDate(maxKey)} (เช่าได้ไม่เกิน ${MAX_RENTAL_DAYS} วัน)`
            : `${formatThaiDayLong(date)} · รวม ${newDays} วัน`}
        </p>
      </div>

      <div className="panel p-3">
        <button
          type="button"
          role="switch"
          aria-checked={reprice}
          onClick={() => setReprice(r => !r)}
          disabled={busy}
          className="flex w-full min-h-[44px] items-center justify-between gap-3 text-left text-sm font-semibold text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="min-w-0">คิดค่าเช่าใหม่ตามจำนวนวัน</span>
          <span aria-hidden="true" className={clsx('switch', reprice && 'switch-on')}>
            <span className="switch-knob" />
          </span>
        </button>
        <p className="text-xs text-gray-500">
          {reprice ? 'คิดจากราคาเริ่มต้น + ราคาวันเพิ่มที่บันทึกไว้ตอนจอง' : 'ค่าเช่าเท่าเดิม (เช่น ร้านให้ฟรีวันที่เพิ่ม)'}
        </p>
      </div>

      {valid && changed && (
        <div className="space-y-2" aria-live="polite">
          <ul className="panel divide-y divide-gray-200 px-3.5 text-sm">
            {preview.rows.map(r => (
              <li key={r.line.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-gray-900 break-words">{r.line.item_name}</p>
                  <p className="text-xs text-gray-500">{sizeLabel(r.line.size)} · {r.line.unit_code}</p>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  {Math.abs(r.next - r.line.rent_price) >= 0.005 && (
                    <p className="text-xs text-gray-500 line-through">{baht(r.line.rent_price)}</p>
                  )}
                  <p className="font-semibold text-gray-900">{baht(r.next)}</p>
                </div>
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm px-1">
            <dt className="text-gray-600">ค่าเช่าเปลี่ยน</dt>
            <dd className={clsx('text-right money', preview.delta > 0 ? 'text-red-700' : preview.delta < 0 ? 'text-green-800' : 'text-gray-900')}>
              {preview.delta > 0 ? '+' : ''}{baht(preview.delta)}
            </dd>
            <dt className="text-gray-600">ยอดรวมใหม่ (ประมาณ)</dt>
            <dd className="text-right money text-gray-900">{baht(round2(m.grand_total + preview.delta))}</dd>
            <dt className="text-gray-600">ค้างชำระหลังเปลี่ยน (ประมาณ)</dt>
            <dd className="text-right money text-gray-900">{baht(round2(m.due + preview.delta))}</dd>
          </dl>
          <p className="text-xs text-gray-500">ระบบตรวจว่าชิ้นชุดว่างในวันที่เพิ่ม ถ้าชนกับการจองอื่นจะแจ้งเลขที่การจองที่ชน</p>
        </div>
      )}
    </DialogShell>
  )
}
