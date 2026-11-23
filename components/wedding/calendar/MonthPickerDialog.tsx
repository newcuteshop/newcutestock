'use client'
// เลือกเดือนของปฏิทิน: เลื่อนปี (พ.ศ.) + ปุ่ม 12 เดือน — ใช้แทน <input type="month"> (Safari/Firefox บนคอมไม่มีตัวเลือกเดือน)
import { useState } from 'react'
import clsx from 'clsx'
import { CalendarSearch, ChevronLeft, ChevronRight } from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { THAI_MONTHS_LONG } from '@/lib/wedding'
import DialogShell from '@/components/rental/booking/DialogShell'

const MIN_YEAR = 2000
const MAX_YEAR = 2100

export default function MonthPickerDialog({
  month,
  todayMonth,
  onPick,
  onClose,
}: {
  /** 'YYYY-MM' ที่แสดงอยู่ */
  month: string
  /** 'YYYY-MM' ของวันนี้ */
  todayMonth: string
  onPick(month: string): void
  onClose(): void
}) {
  const [year, setYear] = useState(() => Number(month.slice(0, 4)) || Number(todayMonth.slice(0, 4)))
  const pick = (mo: number) => onPick(`${String(year).padStart(4, '0')}-${String(mo).padStart(2, '0')}`)

  return (
    <DialogShell title="เลือกเดือน" icon={<CalendarSearch {...ICON} />} onClose={onClose}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setYear(y => Math.max(MIN_YEAR, y - 1))}
          disabled={year <= MIN_YEAR}
          className="btn-icon shrink-0"
          aria-label="ปีก่อนหน้า"
        >
          <ChevronLeft {...ICON_SM} />
        </button>
        <p className="min-w-0 flex-1 text-center text-lg font-semibold text-gray-900 tabular-nums" aria-live="polite">
          พ.ศ. {year + 543}
        </p>
        <button
          type="button"
          onClick={() => setYear(y => Math.min(MAX_YEAR, y + 1))}
          disabled={year >= MAX_YEAR}
          className="btn-icon shrink-0"
          aria-label="ปีถัดไป"
        >
          <ChevronRight {...ICON_SM} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label={`เดือนของปี พ.ศ. ${year + 543}`}>
        {THAI_MONTHS_LONG.map((name, i) => {
          const key = `${String(year).padStart(4, '0')}-${String(i + 1).padStart(2, '0')}`
          const isCurrent = key === month
          const isToday = key === todayMonth
          return (
            <button
              key={name}
              type="button"
              className={clsx('choice', isToday && !isCurrent && 'border-brand-600')}
              aria-pressed={isCurrent}
              onClick={() => pick(i + 1)}
            >
              <span>{name}</span>
              {isToday && <span className="text-[11px] font-normal text-gray-500">เดือนนี้</span>}
            </button>
          )
        })}
      </div>
      <button type="button" onClick={() => onPick(todayMonth)} className="btn-ghost w-full text-sm">
        ไปที่เดือนนี้
      </button>
    </DialogShell>
  )
}
