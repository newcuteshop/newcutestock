'use client'
import { useId } from 'react'
import { AlertTriangle, CalendarDays, CalendarClock } from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { addDaysToKey, formatThaiDayLong, isDayKey } from '@/lib/format'
import { MAX_RENTAL_DAYS, rentalDays } from '@/lib/rental'
import type { DatesCheck, WizardDraft } from './model'

// ขั้นที่ 1: วันรับ-คืนชุด (+ เวลารับ, วันงาน, นัดลองชุด)
// จำนวนวันเช่า = นับรวมวันรับและวันคืน (รับศุกร์ คืนอาทิตย์ = 3 วัน) — ราคาจริงฐานข้อมูลคิดจากจำนวนวันนี้
// เปลี่ยนวันรับ → วันคืนเลื่อนตามโดยคงจำนวนวันเดิม (พนักงานส่วนใหญ่เลื่อนทั้งช่วง)

const DATE_INPUT = 'input block min-w-0 appearance-none tabular-nums [&::-webkit-date-and-time-value]:text-left'

export default function DatesStep({
  draft,
  patch,
  today,
  defaultDays,
  check,
  disabled,
}: {
  draft: WizardDraft
  patch: (p: Partial<WizardDraft>) => void
  today: string
  defaultDays: number
  check: DatesCheck
  disabled?: boolean
}) {
  const pickupId = useId()
  const returnId = useId()
  const pickupTimeId = useId()
  const eventId = useId()
  const fitDateId = useId()
  const fitTimeId = useId()
  const problemId = useId()

  const days = isDayKey(draft.pickup) && isDayKey(draft.ret) && draft.ret >= draft.pickup ? rentalDays(draft.pickup, draft.ret) : 0
  // ปุ่มลัดจำนวนวัน: วันที่ใช้บ่อย + จำนวนวันพื้นฐานของร้าน
  const dayChips = Array.from(new Set([1, 2, 3, 5, 7, defaultDays]))
    .filter(n => n >= 1 && n <= MAX_RENTAL_DAYS)
    .sort((a, b) => a - b)

  function setPickup(v: string) {
    if (!isDayKey(v)) {
      patch({ pickup: v })
      return
    }
    // คงจำนวนวันเดิม (ยังไม่มีวันคืน = จำนวนวันพื้นฐานของร้าน)
    const keep = days > 0 ? days : Math.max(1, defaultDays)
    patch({ pickup: v, ret: addDaysToKey(v, keep - 1) })
  }

  function setDays(n: number) {
    if (!isDayKey(draft.pickup)) return
    patch({ ret: addDaysToKey(draft.pickup, n - 1) })
  }

  const tomorrow = addDaysToKey(today, 1)

  return (
    <div className="space-y-4">
      <section className="card p-4 sm:p-5 space-y-4" aria-labelledby={`${pickupId}-title`}>
        <h2 id={`${pickupId}-title`} className="section-title">
          <CalendarDays {...ICON} />
          วันรับและวันคืนชุด
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor={pickupId} className="field-label">วันรับชุด *</label>
            <input
              id={pickupId}
              type="date"
              className={DATE_INPUT}
              value={draft.pickup}
              disabled={disabled}
              required
              aria-invalid={check.problem !== null && !isDayKey(draft.pickup) ? true : undefined}
              aria-describedby={`${pickupId}-be${check.problem ? ` ${problemId}` : ''}`}
              onChange={e => setPickup(e.target.value)}
            />
            <p id={`${pickupId}-be`} className="field-hint">
              {isDayKey(draft.pickup) ? formatThaiDayLong(draft.pickup) : 'ยังไม่ได้เลือกวัน'}
            </p>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="เลือกวันรับชุดด่วน">
              <button
                type="button"
                className="chip-toggle"
                aria-pressed={draft.pickup === today}
                disabled={disabled}
                onClick={() => setPickup(today)}
              >
                วันนี้
              </button>
              <button
                type="button"
                className="chip-toggle"
                aria-pressed={draft.pickup === tomorrow}
                disabled={disabled}
                onClick={() => setPickup(tomorrow)}
              >
                พรุ่งนี้
              </button>
            </div>
          </div>

          <div className="min-w-0">
            <label htmlFor={returnId} className="field-label">วันคืนชุด *</label>
            <input
              id={returnId}
              type="date"
              className={DATE_INPUT}
              value={draft.ret}
              min={isDayKey(draft.pickup) ? draft.pickup : undefined}
              disabled={disabled}
              required
              aria-invalid={check.problem !== null && isDayKey(draft.pickup) ? true : undefined}
              aria-describedby={`${returnId}-be${check.problem ? ` ${problemId}` : ''}`}
              onChange={e => patch({ ret: e.target.value })}
            />
            <p id={`${returnId}-be`} className="field-hint">
              {isDayKey(draft.ret) ? formatThaiDayLong(draft.ret) : 'ยังไม่ได้เลือกวัน'}
            </p>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="จำนวนวันเช่า">
              {dayChips.map(n => (
                <button
                  key={n}
                  type="button"
                  className="chip-toggle tabular-nums"
                  aria-pressed={days === n}
                  disabled={disabled || !isDayKey(draft.pickup)}
                  onClick={() => setDays(n)}
                >
                  {n} วัน
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* สรุปจำนวนวัน / ปัญหา */}
        <div aria-live="polite" className="space-y-2">
          {check.problem ? (
            <p id={problemId} role="alert" className="flex items-start gap-1.5 text-sm font-medium text-red-700">
              <AlertTriangle {...ICON_SM} className="mt-px shrink-0" />
              <span className="min-w-0">{check.problem}</span>
            </p>
          ) : days > 0 ? (
            <div className="panel px-3.5 py-2.5 text-sm text-gray-700">
              เช่า <span className="font-semibold text-gray-900 tabular-nums">{days}</span> วัน
              <span className="text-gray-500"> (นับรวมวันรับและวันคืน)</span>
            </div>
          ) : null}
          {check.warnings.map(w => (
            <p key={w} className="flex items-start gap-1.5 text-sm font-medium text-amber-800">
              <AlertTriangle {...ICON_SM} className="mt-px shrink-0" />
              <span className="min-w-0">{w}</span>
            </p>
          ))}
        </div>

        <div className="max-w-xs">
          <label htmlFor={pickupTimeId} className="field-label">เวลานัดรับชุด (ถ้ามี)</label>
          <input
            id={pickupTimeId}
            type="time"
            className="input tabular-nums"
            value={draft.pickupTime}
            disabled={disabled}
            onChange={e => patch({ pickupTime: e.target.value })}
          />
        </div>
      </section>

      <section className="card p-4 sm:p-5 space-y-4" aria-labelledby={`${eventId}-title`}>
        <h2 id={`${eventId}-title`} className="section-title">
          <CalendarClock {...ICON} />
          วันงานและนัดลองชุด
          <span className="text-sm font-normal text-gray-500">(ไม่บังคับ)</span>
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="min-w-0">
            <label htmlFor={eventId} className="field-label">วันงาน</label>
            <input
              id={eventId}
              type="date"
              className={DATE_INPUT}
              value={draft.eventDate}
              disabled={disabled}
              onChange={e => patch({ eventDate: e.target.value })}
            />
            <p className="field-hint">{isDayKey(draft.eventDate) ? formatThaiDayLong(draft.eventDate) : 'วันที่ลูกค้าใส่ชุดไปงาน'}</p>
          </div>
          <div className="min-w-0">
            <label htmlFor={fitDateId} className="field-label">วันนัดลองชุด</label>
            <input
              id={fitDateId}
              type="date"
              className={DATE_INPUT}
              value={draft.fittingDate}
              disabled={disabled}
              onChange={e => patch({ fittingDate: e.target.value })}
            />
            <p className="field-hint">{isDayKey(draft.fittingDate) ? formatThaiDayLong(draft.fittingDate) : 'ไม่มีนัดลองให้เว้นว่าง'}</p>
          </div>
          <div className="min-w-0">
            <label htmlFor={fitTimeId} className="field-label">เวลานัดลอง</label>
            <input
              id={fitTimeId}
              type="time"
              className="input tabular-nums"
              value={draft.fittingTime}
              disabled={disabled || !isDayKey(draft.fittingDate)}
              onChange={e => patch({ fittingTime: e.target.value })}
            />
          </div>
        </div>
      </section>
    </div>
  )
}
