'use client'
// ตารางเดือนแบบเต็ม (จอ md ขึ้นไป): 7 คอลัมน์ เริ่มวันอาทิตย์ · ช่องละวัน
//   หัวช่อง: วันที่ (วันนี้ = วงทอง) + "คิวเต็ม" / จำนวนงานเทียบความจุ
//   ชิปคิวไม่เกิน 3 อัน (จุดแดง = ทีมชนคิว · ไอคอนประเภท · เวลา · คู่บ่าวสาว) สีตามสถานะ + "อีก n คิว"
// ทั้งช่องเป็นปุ่มเดียว (ชิปข้างในเป็นข้อความ ไม่ซ้อนปุ่ม) — aria-label สรุปทุกอย่างในช่องให้โปรแกรมอ่านจอ
import clsx from 'clsx'
import { formatThaiDayLong } from '@/lib/format'
import {
  SESSION_TYPE_LABELS, WED_SESSION_TYPES, WED_STATUS_SHORT, type WedCalendarDay, type WedSessionMini,
} from '@/lib/wedding'
import { THAI_WEEKDAYS_SHORT, dayOfMonth, monthOfDay } from '@/components/rental/calendar/dates'
import { CAL_TONES, SESSION_TYPE_ICON, TONE_CHIP, TONE_LABEL, calTone, chipTime } from './calendarModel'

export const MAX_CHIPS = 3

/** สรุปช่องวันให้โปรแกรมอ่านจอ */
export function dayAria(day: WedCalendarDay, sessions: readonly WedSessionMini[], today: string, capacity: number): string {
  const parts = [formatThaiDayLong(day.day)]
  if (day.day === today) parts.push('(วันนี้)')
  parts.push(sessions.length > 0 ? `${sessions.length} คิว` : 'ไม่มีคิว')
  if (day.full) parts.push('คิวเต็ม')
  else if (capacity > 0 && day.count_jobs > 0) parts.push(`รับแล้ว ${day.count_jobs} จาก ${capacity} งาน`)
  if (sessions.some(s => s.has_conflict)) parts.push('มีทีมงานชนคิว')
  sessions.slice(0, MAX_CHIPS).forEach(s => {
    parts.push(`${chipTime(s) ? `${chipTime(s)} น.` : ''} ${s.type_label} ${s.couple_names} ${WED_STATUS_SHORT[s.status]}`.trim())
  })
  if (sessions.length > MAX_CHIPS) parts.push(`และอีก ${sessions.length - MAX_CHIPS} คิว`)
  return parts.join(' · ')
}

// ช่องวันแคบ (คอมที่มีแผงรายละเอียดวันข้าง ๆ ช่องละ ~95px) → ชื่อคู่บ่าวสาวขึ้นบรรทัดใหม่เอง (flex-wrap + ความกว้างขั้นต่ำ 3.5rem)
// แทนที่จะถูกตัดเหลือ 'คุ…' ; ช่องกว้างพออยู่บรรทัดเดียวเหมือนเดิม
export function SessionChip({ s }: { s: WedSessionMini }) {
  const Icon = SESSION_TYPE_ICON[s.session_type]
  const time = chipTime(s)
  const who = s.couple_names || s.booking_no
  return (
    <span
      title={[time ? `${time} น.` : '', who].filter(Boolean).join(' ')}
      className={clsx('flex min-w-0 flex-wrap items-center gap-x-1 rounded px-1 py-px text-[11px] leading-4', TONE_CHIP[calTone(s.status)])}
    >
      {s.has_conflict && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-600 ring-1 ring-white" />}
      <Icon size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />
      {time && <b className="shrink-0 font-semibold tabular-nums">{time}</b>}
      <span className="min-w-[3.5rem] flex-1 truncate">{who}</span>
    </span>
  )
}

/** ป้ายอธิบายสี/ไอคอนใต้ตาราง */
export function CalendarLegend({ className }: { className?: string }) {
  return (
    <div className={clsx('space-y-2 text-xs text-gray-600', className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {CAL_TONES.map(t => (
          <span key={t} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={clsx('inline-block h-4 w-6 rounded', TONE_CHIP[t])} />
            {TONE_LABEL[t]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-red-600" />
          ทีมงานชนคิว
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="badge-out !h-5 !px-1.5 text-[11px]">เต็ม</span>
          รับงานครบตามจำนวนต่อวันแล้ว
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {WED_SESSION_TYPES.map(t => {
          const Icon = SESSION_TYPE_ICON[t]
          return (
            <span key={t} className="inline-flex items-center gap-1">
              <Icon size={14} strokeWidth={1.9} aria-hidden="true" className="text-brand-600" />
              {SESSION_TYPE_LABELS[t]}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export default function MonthGrid({
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
  /** คิวของวันหลังกรองประเภทแล้ว */
  sessionsOf(k: string): WedSessionMini[]
  capacity: number
  onSelect(day: string): void
}) {
  return (
    <div>
      <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50" aria-hidden="true">
        {THAI_WEEKDAYS_SHORT.map((w, i) => (
          <div key={w} className={clsx('px-2 py-2 text-center text-xs font-semibold', i === 0 || i === 6 ? 'text-brand-700' : 'text-gray-600')}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {gridDays.map((k, idx) => {
          const d = dayOf(k)
          const list = sessionsOf(k)
          const inMonth = monthOfDay(k) === month
          const isToday = k === today
          const isSel = k === selected
          return (
            <button
              key={k}
              type="button"
              data-day={k}
              onClick={() => onSelect(k)}
              aria-pressed={isSel}
              aria-label={dayAria(d, list, today, capacity)}
              className={clsx(
                'flex min-h-[116px] min-w-0 flex-col items-stretch gap-1 p-1.5 text-left align-top transition-colors',
                idx % 7 !== 0 && 'border-l border-gray-150',
                idx >= 7 && 'border-t border-gray-150',
                !inMonth && 'bg-gray-50',
                isSel ? 'bg-brand-50 outline outline-2 -outline-offset-2 outline-brand-600' : '[@media(hover:hover)]:hover:bg-gray-50',
              )}
            >
              <span className="flex items-center justify-between gap-1">
                <span
                  className={clsx(
                    'inline-grid h-6 min-w-[1.5rem] place-items-center rounded-full px-1 text-xs font-semibold tabular-nums',
                    isToday ? 'bg-brand-400 text-gray-900 ring-2 ring-brand-600 ring-offset-1' : inMonth ? 'text-gray-900' : 'text-gray-400',
                  )}
                >
                  {dayOfMonth(k)}
                </span>
                {d.full ? (
                  <span className="badge-out !h-5 !px-1.5 text-[11px]">เต็ม</span>
                ) : capacity > 0 && d.count_jobs > 0 ? (
                  <span className="text-[11px] text-gray-500 tabular-nums">{d.count_jobs}/{capacity} งาน</span>
                ) : null}
              </span>
              {list.slice(0, MAX_CHIPS).map(s => <SessionChip key={s.session_id} s={s} />)}
              {list.length > MAX_CHIPS && (
                <span className="px-1 text-[11px] font-medium text-gray-600">+ อีก {list.length - MAX_CHIPS} คิว</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
