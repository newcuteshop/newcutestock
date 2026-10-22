'use client'
import clsx from 'clsx'
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import {
  addMonths, dayNumber, latestReturn, longDay, monthIndex, monthInfo, monthTitle, THAI_WEEKDAYS_SHORT,
} from '@/components/book/dates'

// ปฏิทินวันว่างของชุด 2 เดือน + เลือกช่วงวันรับ–วันคืน (หน้าชุด /book/item/[code])
// - สีบอกสถานะต่อวันของไซส์ที่เลือก: ว่าง (จุดเขียว) / เต็ม (ตัวจาง + คำว่า "เต็ม") / จองไม่ได้ (ก่อนวันที่จองล่วงหน้าได้)
//   ยังไม่เลือกไซส์ = ว่างถ้ามีไซส์ใดไซส์หนึ่งว่าง · ไม่พึ่งสีอย่างเดียว: มีคำว่า "เต็ม" และชื่อปุ่มบอกสถานะครบ
// - แตะครั้งแรก = วันรับชุด, ครั้งที่สอง = วันคืนชุด (วันเดียวกันได้ = เช่า 1 วัน) ; แตะวันก่อนวันรับ = เริ่มใหม่
//   ระหว่างเลือกวันคืน วันที่เกินจำนวนวันเช่าสูงสุดถูกปิด
// - ข้อมูลวันว่างผู้เรียกโหลดเอง (rental_public_availability) แล้วส่งเข้ามาเป็น avail[วัน][คีย์ไซส์] = จำนวนตัวที่ว่าง
// - วันว่างรายวันเป็นตัวช่วยเลือกเท่านั้น — ร้านยืนยันคิวจริงตอนส่งคำขอ (ฐานข้อมูลกันจองซ้อนเอง)

export type AvailMap = Record<string, Record<string, number>>

type Props = {
  monthKey: string
  onMonthChange: (monthKey: string) => void
  minMonth: string
  maxMonth: string
  earliest: string
  todayKey: string
  /** คีย์ไซส์ที่เลือก (sizeKey) ; null = ยังไม่เลือกไซส์ */
  sizeKeyValue: string | null
  sizeName: string | null
  avail: AvailMap
  loading: boolean
  error: string | null
  onRetry: () => void
  from: string | null
  to: string | null
  maxDays: number
  onPick: (day: string) => void
}

export function freeOnDay(avail: AvailMap, day: string, sizeKeyValue: string | null): number | null {
  const d = avail[day]
  if (!d) return null
  if (sizeKeyValue === null) {
    let best = 0
    for (const k of Object.keys(d)) best = Math.max(best, d[k])
    return best
  }
  return d[sizeKeyValue] ?? 0
}

export default function AvailabilityCalendar(props: Props) {
  const { monthKey, onMonthChange, minMonth, maxMonth, loading, error, onRetry } = props
  const second = addMonths(monthKey, 1)
  const canPrev = monthIndex(monthKey) > monthIndex(minMonth)
  const canNext = monthIndex(second) < monthIndex(maxMonth)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="btn-icon"
          onClick={() => onMonthChange(addMonths(monthKey, -1))}
          disabled={!canPrev}
          aria-label="เดือนก่อนหน้า"
        >
          <ChevronLeft {...ICON_SM} />
        </button>
        <p className="min-w-0 text-center text-sm font-semibold text-gray-900" aria-live="polite">
          {monthTitle(monthKey)} – {monthTitle(second)}
        </p>
        <button
          type="button"
          className="btn-icon"
          onClick={() => onMonthChange(addMonths(monthKey, 1))}
          disabled={!canNext}
          aria-label="เดือนถัดไป"
        >
          <ChevronRight {...ICON_SM} />
        </button>
      </div>

      {error && (
        <div role="alert" className="alert-warn">
          <AlertTriangle {...ICON_SM} />
          <div className="min-w-0 space-y-2">
            <p>โหลดวันว่างไม่สำเร็จ: {error}</p>
            <button type="button" className="btn-secondary" onClick={onRetry}>
              <RefreshCw {...ICON_XS} />
              ลองอีกครั้ง
            </button>
          </div>
        </div>
      )}
      {loading && (
        <p className="flex items-center gap-1.5 text-sm text-gray-500" role="status">
          <Loader2 {...ICON_XS} className="animate-spin" />
          กำลังโหลดวันว่าง...
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <MonthGrid {...props} month={monthKey} />
        <MonthGrid {...props} month={second} />
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-600" aria-label="ความหมายของสีในปฏิทิน">
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-green-600" aria-hidden="true" /> ว่าง
        </li>
        <li className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-red-700" aria-hidden="true">เต็ม</span> ไม่ว่าง
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-4 rounded bg-brand-400" aria-hidden="true" /> วันที่เลือก
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-4 rounded bg-gray-100" aria-hidden="true" /> จองไม่ได้
        </li>
      </ul>
    </div>
  )
}

function MonthGrid({
  month, earliest, todayKey, sizeKeyValue, sizeName, avail, from, to, maxDays, onPick,
}: Props & { month: string }) {
  const info = monthInfo(month)
  if (!info) return null
  const maxRet = from && !to ? latestReturn(from, maxDays) : null
  const cells: (string | null)[] = []
  for (let i = 0; i < info.lead; i++) cells.push(null)
  for (let d = 1; d <= info.count; d++) cells.push(`${month}-${('0' + d).slice(-2)}`)

  return (
    <div className="min-w-0">
      <p className="mb-2 text-center text-sm font-semibold text-gray-700">{monthTitle(month)}</p>
      <div className="grid grid-cols-7 gap-0.5 text-center" role="presentation">
        {THAI_WEEKDAYS_SHORT.map(w => (
          <span key={w} className="pb-1 text-[11px] font-medium text-gray-500" aria-hidden="true">{w}</span>
        ))}
        {cells.map((day, i) => {
          if (!day) return <span key={`blank-${i}`} aria-hidden="true" />
          const tooSoon = day < earliest
          const beyond = maxRet !== null && day > maxRet
          const free = tooSoon ? null : freeOnDay(avail, day, sizeKeyValue)
          const full = free === 0
          const isStart = day === from
          const isEnd = day === to
          const inRange = !!from && !!to && day > from && day < to
          const disabled = tooSoon || beyond || full
          const status = tooSoon
            ? 'จองไม่ได้'
            : full
              ? sizeName ? `ไซส์ ${sizeName} เต็ม` : 'เต็มทุกไซส์'
              : beyond
                ? `เกิน ${maxDays} วัน`
                : free === null
                  ? 'ยังไม่ทราบวันว่าง'
                  : 'ว่าง'
          const role = isStart && isEnd ? 'วันรับและวันคืนชุด' : isStart ? 'วันรับชุด' : isEnd ? 'วันคืนชุด' : inRange ? 'อยู่ในช่วงเช่า' : ''
          return (
            <button
              key={day}
              type="button"
              disabled={disabled}
              onClick={() => onPick(day)}
              aria-pressed={isStart || isEnd || inRange}
              aria-label={`${longDay(day)} — ${status}${role ? ` · ${role}` : ''}`}
              className={clsx(
                'relative flex h-11 min-w-0 flex-col items-center justify-center rounded-lg text-sm tabular-nums transition-colors',
                isStart || isEnd
                  ? 'bg-brand-400 font-semibold text-gray-900'
                  : inRange
                    // ช่วงเช่า = brand-200 (ฟ้า #D3EDF7) — brand-100 (#E9F6FB) แทบเท่าพื้นเทาของวัน "จองไม่ได้" (gray-100) ในธีมฟ้าใส
                    ? 'bg-brand-200 text-gray-900'
                    : disabled
                      ? tooSoon || beyond
                        ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                        : 'cursor-not-allowed text-gray-400'
                      : 'text-gray-900 hover:bg-gray-100 active:bg-gray-150',
                day === todayKey && !isStart && !isEnd && 'ring-1 ring-inset ring-gray-300',
              )}
            >
              <span className={clsx(full && !isStart && !isEnd && 'line-through')}>{dayNumber(day)}</span>
              {!tooSoon && !beyond && (
                full ? (
                  <span className="text-[9px] font-semibold leading-none text-red-700" aria-hidden="true">เต็ม</span>
                ) : free !== null && free > 0 ? (
                  <span
                    className={clsx('mt-0.5 h-1.5 w-1.5 rounded-full', isStart || isEnd ? 'bg-gray-900' : 'bg-green-600')}
                    aria-hidden="true"
                  />
                ) : null
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
