'use client'
// มือถือ (จอแคบกว่า md): ตารางเดือนแบบย่อ (ช่องละวัน มีจุดสีตามสถานะคิว) + วาระของสัปดาห์ที่เลือกด้านล่าง
//   แตะช่องวัน = เลือกวัน + เปิดรายละเอียดวัน (ชีตล่าง) · วาระแสดง 7 วันของสัปดาห์ที่มีวันที่เลือก
//   แถวคิวในวาระ = ลิงก์ไปหน้างาน · หัววัน = เปิดรายละเอียดวัน
import Link from 'next/link'
import clsx from 'clsx'
import { AlertTriangle, ChevronLeft, ChevronRight, MapPin } from 'lucide-react'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { addDaysToKey } from '@/lib/format'
import { WED_STATUS_CHIP, sessionTimeText, type WedCalendarDay, type WedSessionMini } from '@/lib/wedding'
import { THAI_WEEKDAYS_SHORT, dayOfMonth, monthOfDay, shortDayLabel, weekdayDayLabel, weekdayOf } from '@/components/rental/calendar/dates'
import { crewShortName } from './CrewChips'
import { SESSION_TYPE_ICON, TONE_BAR, TONE_DOT, calTone } from './calendarModel'
import { dayAria } from './MonthGrid'
import { wedBookingHref } from './rpc'

const MAX_DOTS = 3

export function CompactMonthGrid({
  month,
  today,
  selected,
  gridDays,
  dayOf,
  sessionsOf,
  capacity,
  onSelect,
}: {
  month: string
  today: string
  selected: string
  gridDays: readonly string[]
  dayOf(k: string): WedCalendarDay
  sessionsOf(k: string): WedSessionMini[]
  capacity: number
  onSelect(day: string): void
}) {
  return (
    <div>
      <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50" aria-hidden="true">
        {THAI_WEEKDAYS_SHORT.map((w, i) => (
          <div key={w} className={clsx('py-1.5 text-center text-[11px] font-semibold', i === 0 || i === 6 ? 'text-brand-700' : 'text-gray-600')}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {gridDays.map((k, idx) => {
          const d = dayOf(k)
          const list = sessionsOf(k)
          const inMonth = monthOfDay(k) === month
          const isToday = k === today
          const isSel = k === selected
          const conflict = list.some(s => s.has_conflict)
          return (
            <button
              key={k}
              type="button"
              data-day={k}
              onClick={() => onSelect(k)}
              aria-pressed={isSel}
              aria-label={dayAria(d, list, today, capacity)}
              className={clsx(
                'relative flex min-h-[56px] min-w-0 flex-col items-center gap-1 px-0.5 pb-1.5 pt-1 transition-colors active:bg-gray-100',
                idx % 7 !== 0 && 'border-l border-gray-150',
                idx >= 7 && 'border-t border-gray-150',
                !inMonth && 'bg-gray-50',
                isSel && 'bg-brand-50 outline outline-2 -outline-offset-2 outline-brand-600',
              )}
            >
              <span
                className={clsx(
                  'inline-grid h-6 min-w-[1.5rem] place-items-center rounded-full px-0.5 text-xs font-semibold tabular-nums',
                  isToday ? 'bg-brand-400 text-gray-900 ring-2 ring-brand-600' : inMonth ? 'text-gray-900' : 'text-gray-400',
                )}
              >
                {dayOfMonth(k)}
              </span>
              <span className="flex h-2.5 items-center justify-center gap-0.5" aria-hidden="true">
                {list.slice(0, MAX_DOTS).map(s => (
                  <span key={s.session_id} className={clsx('h-2 w-2 rounded-full', TONE_DOT[calTone(s.status)])} />
                ))}
                {list.length > MAX_DOTS && <span className="text-[10px] font-semibold leading-none text-gray-600">+</span>}
              </span>
              {d.full && <span className="text-[10px] font-semibold leading-none text-red-700" aria-hidden="true">เต็ม</span>}
              {conflict && <span aria-hidden="true" className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-600" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** วันอาทิตย์ของสัปดาห์ที่มีวันนั้น */
export function weekStartOf(day: string): string {
  return addDaysToKey(day, -Math.max(0, weekdayOf(day)))
}

function AgendaRow({ s }: { s: WedSessionMini }) {
  const Icon = SESSION_TYPE_ICON[s.session_type]
  const crew = s.crew.map(crewShortName).join(', ')
  return (
    <li>
      <Link
        href={wedBookingHref(s.booking_id)}
        prefetch={false}
        className={clsx('flex min-h-[56px] items-start gap-3 py-2.5 pl-3 pr-3 transition-colors active:bg-gray-100', TONE_BAR[calTone(s.status)])}
        aria-label={`เปิดงาน ${s.booking_no} ${s.couple_names} ${s.type_label} ${sessionTimeText(s)}`}
      >
        <div className="w-[4.5rem] shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-gray-900">
          {s.start_time ?? s.call_time ?? '—'}
          {s.call_time && s.start_time && <span className="block text-[11px] font-normal text-gray-500">ทีมถึง {s.call_time}</span>}
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="min-w-0 text-sm font-semibold text-gray-900 break-words">{s.couple_names || s.booking_no}</span>
            <span className={WED_STATUS_CHIP[s.status]}>{s.status_label}</span>
          </p>
          <p className="flex items-center gap-1 text-xs text-gray-600">
            <Icon {...ICON_XS} className="shrink-0 text-brand-600" />
            <span className="min-w-0 break-words">{s.type_label}{s.title ? ` · ${s.title}` : ''}</span>
          </p>
          {s.venue_name && (
            <p className="flex items-center gap-1 text-xs text-gray-600">
              <MapPin {...ICON_XS} className="shrink-0 text-gray-400" />
              <span className="min-w-0 break-words">{s.venue_name}</span>
            </p>
          )}
          <p className={clsx('text-xs break-words', crew ? 'text-gray-600' : 'font-medium text-amber-800')}>
            {crew ? `ทีม: ${crew}` : 'ยังไม่ได้จัดทีมงาน'}
          </p>
          {s.has_conflict && (
            <p className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
              <AlertTriangle {...ICON_XS} />
              ทีมงานชนคิว
            </p>
          )}
        </div>
      </Link>
    </li>
  )
}

export function WeekAgenda({
  weekStart,
  today,
  selected,
  dayOf,
  sessionsOf,
  loading,
  onOpenDay,
  onPrevWeek,
  onNextWeek,
}: {
  weekStart: string
  today: string
  selected: string
  dayOf(k: string): WedCalendarDay
  sessionsOf(k: string): WedSessionMini[]
  loading: boolean
  onOpenDay(day: string): void
  onPrevWeek(): void
  onNextWeek(): void
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysToKey(weekStart, i))
  const total = days.reduce((n, k) => n + sessionsOf(k).length, 0)
  return (
    <section className={clsx('card overflow-hidden transition-opacity', loading && 'opacity-60')} aria-labelledby="wed-week-title" aria-busy={loading}>
      <div className="flex items-center gap-1 border-b border-gray-200 px-2 py-1.5">
        <button type="button" onClick={onPrevWeek} className="btn-icon btn-icon-plain shrink-0" aria-label="สัปดาห์ก่อนหน้า">
          <ChevronLeft {...ICON_SM} />
        </button>
        <h2 id="wed-week-title" className="min-w-0 flex-1 text-center text-sm font-semibold text-gray-900 tabular-nums" aria-live="polite">
          สัปดาห์ {shortDayLabel(days[0])} – {shortDayLabel(days[6])}
          <span className="block text-xs font-normal text-gray-500">{total.toLocaleString('th-TH')} คิว</span>
        </h2>
        <button type="button" onClick={onNextWeek} className="btn-icon btn-icon-plain shrink-0" aria-label="สัปดาห์ถัดไป">
          <ChevronRight {...ICON_SM} />
        </button>
      </div>
      <ol className="divide-y divide-gray-200">
        {days.map(k => {
          const d = dayOf(k)
          const list = sessionsOf(k)
          const isToday = k === today
          return (
            <li key={k} className={clsx(k === selected && 'bg-brand-50/60')}>
              <button
                type="button"
                onClick={() => onOpenDay(k)}
                className={clsx('flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-1.5 text-left', isToday ? 'bg-brand-50' : 'bg-gray-50')}
                aria-label={`ดูรายละเอียด${weekdayDayLabel(k)}${isToday ? ' (วันนี้)' : ''} ${list.length} คิว${d.full ? ' คิวเต็ม' : ''}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{weekdayDayLabel(k)}</span>
                  {isToday && <span className="chip-strong">วันนี้</span>}
                  {d.full && <span className="badge-out">เต็ม</span>}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-gray-500 tabular-nums">
                  {list.length > 0 ? `${list.length} คิว` : 'ว่าง'}
                  <ChevronRight {...ICON_XS} />
                </span>
              </button>
              {list.length > 0 && (
                <ul className="divide-y divide-gray-150 border-t border-gray-150">
                  {list.map(s => <AgendaRow key={s.session_id} s={s} />)}
                </ul>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
