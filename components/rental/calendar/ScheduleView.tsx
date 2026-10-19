'use client'
// ตารางงานรายเดือน (rental_schedule) — วันไหนลูกค้ามารับชุด / คืนชุด / ลองชุด
// - จอกว้าง (md+): ตารางเดือน 7 คอลัมน์ (เริ่มวันอาทิตย์) แต่ละช่องมีจำนวนงาน + ชื่อลูกค้า 3 รายการแรก → กดวันเพื่อดูรายการเต็มด้านล่าง
// - มือถือ: รายการแบบวาระ (เฉพาะวันที่มีงานในเดือนนั้น) อ่านง่ายกว่าตารางช่องเล็กๆ
// - การจองที่เกินกำหนดคืนแสดงที่ "วันนี้" (ฐานข้อมูลส่ง overdue_returns มาเฉพาะวันนี้)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  AlertTriangle, CalendarDays, CalendarX, ChevronLeft, ChevronRight, History, PackageOpen, RefreshCw, Ruler, Undo2, XCircle,
  type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { formatThaiDayLong } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { FIX05_MISSING_MSG, parseSchedule, type RentalBookingMini, type RentalScheduleDay } from '@/lib/rental'
import MigrationNotice from '@/components/pos/MigrationNotice'
import BookingMiniList, { type MiniKind } from './BookingMiniList'
import {
  THAI_WEEKDAYS_SHORT, addMonths, dayOfMonth, dayRange, monthFirstDay, monthGridRange, monthLabel, monthOfDay, weekdayDayLabel,
} from './dates'
import { rentalErrorText, rpcWithTimeout } from './rpc'

type Filter = 'all' | 'pickup' | 'return' | 'fitting'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'pickup', label: 'รับชุด' },
  { value: 'return', label: 'คืนชุด' },
  { value: 'fitting', label: 'ลองชุด' },
]

// สีตามชนิดงาน (ใช้ชื่อคลาสตรงๆ — Tailwind ตัดคลาสที่ประกอบจากตัวแปรทิ้ง) + ป้ายข้อความคู่เสมอ
const KIND_META: Record<'pickup' | 'return' | 'fitting' | 'overdue', { short: string; label: string; cls: string; icon: LucideIcon }> = {
  pickup: { short: 'รับ', label: 'ลูกค้ารับชุด', cls: 'border-brand-300 bg-brand-50 text-brand-900', icon: PackageOpen },
  return: { short: 'คืน', label: 'ลูกค้าคืนชุด', cls: 'border-green-200 bg-green-50 text-green-900', icon: Undo2 },
  fitting: { short: 'ลอง', label: 'นัดลองชุด', cls: 'border-gray-300 bg-gray-100 text-gray-800', icon: Ruler },
  overdue: { short: 'เกิน', label: 'เกินกำหนดคืน', cls: 'border-red-200 bg-red-50 text-red-800', icon: AlertTriangle },
}

interface Entry {
  kind: 'pickup' | 'return' | 'fitting' | 'overdue'
  b: RentalBookingMini
}

function emptyDay(day: string): RentalScheduleDay {
  return { day, pickups: [], returns: [], fittings: [], overdue_returns: [] }
}

// งานของวันตามตัวกรอง (เรียง: เกินกำหนด → รับ → คืน → ลอง)
function entriesOf(d: RentalScheduleDay, filter: Filter): Entry[] {
  const out: Entry[] = []
  if (filter === 'all' || filter === 'return') d.overdue_returns.forEach(b => out.push({ kind: 'overdue', b }))
  if (filter === 'all' || filter === 'pickup') d.pickups.forEach(b => out.push({ kind: 'pickup', b }))
  if (filter === 'all' || filter === 'return') d.returns.forEach(b => out.push({ kind: 'return', b }))
  if (filter === 'all' || filter === 'fitting') d.fittings.forEach(b => out.push({ kind: 'fitting', b }))
  return out
}

function DayLists({ d, filter }: { d: RentalScheduleDay; filter: Filter }) {
  const groups: { kind: MiniKind; meta: (typeof KIND_META)[keyof typeof KIND_META]; items: RentalBookingMini[] }[] = []
  if ((filter === 'all' || filter === 'return') && d.overdue_returns.length > 0) groups.push({ kind: 'overdue', meta: KIND_META.overdue, items: d.overdue_returns })
  if ((filter === 'all' || filter === 'pickup') && d.pickups.length > 0) groups.push({ kind: 'pickup', meta: KIND_META.pickup, items: d.pickups })
  if ((filter === 'all' || filter === 'return') && d.returns.length > 0) groups.push({ kind: 'return', meta: KIND_META.return, items: d.returns })
  if ((filter === 'all' || filter === 'fitting') && d.fittings.length > 0) groups.push({ kind: 'fitting', meta: KIND_META.fitting, items: d.fittings })
  if (groups.length === 0) return <p className="px-4 py-5 sm:px-5 text-sm text-gray-500">ไม่มีงานในวันนี้</p>
  return (
    <div className="divide-y divide-gray-200">
      {groups.map(g => {
        const Icon = g.meta.icon
        return (
          <div key={g.kind}>
            <p className={clsx('flex items-center gap-1.5 px-4 py-1.5 sm:px-5 text-xs font-semibold border-y', g.meta.cls)}>
              <Icon {...ICON_XS} />
              {g.meta.label} ({g.items.length.toLocaleString('th-TH')})
            </p>
            <BookingMiniList items={g.items} kind={g.kind} />
          </div>
        )
      })}
    </div>
  )
}

export default function ScheduleView({
  month,
  today,
  onMonthChange,
}: {
  month: string
  today: string
  onMonthChange: (m: string) => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [days, setDays] = useState<Map<string, RentalScheduleDay>>(new Map())
  const [loadedMonth, setLoadedMonth] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [showPast, setShowPast] = useState(false)
  const [selected, setSelected] = useState(() => (monthOfDay(today) === month ? today : monthFirstDay(month)))
  const reqRef = useRef(0)

  const grid = useMemo(() => monthGridRange(month), [month])
  const gridDays = useMemo(() => dayRange(grid.from, grid.to), [grid])

  const load = useCallback(async (m: string) => {
    const id = ++reqRef.current
    setLoading(true)
    setError('')
    const range = monthGridRange(m)
    const res = await rpcWithTimeout(supabase, 'rental_schedule', { p_from: range.from, p_to: range.to })
    if (id !== reqRef.current) return
    if (res.error) {
      setMissing(isMigrationMissing(res.error))
      setError(rentalErrorText(res.error))
    } else {
      const map = new Map<string, RentalScheduleDay>()
      for (const d of parseSchedule(res.data).days) map.set(d.day, d)
      setDays(map)
      setLoadedMonth(m)
      setMissing(false)
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    void load(month)
  }, [load, month])

  // เปลี่ยนเดือน → เลือกวันนี้ (ถ้าอยู่ในเดือนนั้น) ไม่งั้นวันที่ 1
  useEffect(() => {
    setSelected(monthOfDay(today) === month ? today : monthFirstDay(month))
    setShowPast(false)
  }, [month, today])

  if (missing) return <MigrationNotice message={FIX05_MISSING_MSG} />

  const shownOk = loadedMonth === month && !error
  const dayOf = (k: string) => days.get(k) ?? emptyDay(k)
  const monthDays = gridDays.filter(k => monthOfDay(k) === month)
  const agendaDays = shownOk ? monthDays.filter(k => entriesOf(dayOf(k), filter).length > 0) : []
  // มือถือ + เดือนปัจจุบัน: เริ่มรายการที่วันนี้ (งานที่ผ่านไปแล้วซ่อนไว้ กดแสดงได้) — ไม่ต้องเลื่อนผ่านครึ่งเดือนที่จบแล้ว
  const isCurrentMonth = monthOfDay(today) === month
  const visibleAgenda = isCurrentMonth && !showPast ? agendaDays.filter(k => k >= today) : agendaDays
  const hiddenPast = agendaDays.length - visibleAgenda.length
  const totals = shownOk
    ? monthDays.reduce(
      (acc, k) => {
        const d = dayOf(k)
        acc.pickup += d.pickups.length
        acc.return += d.returns.length
        acc.fitting += d.fittings.length
        return acc
      },
      { pickup: 0, return: 0, fitting: 0 },
    )
    : null
  const selDay = dayOf(selected)

  return (
    <div className="space-y-4">
      {/* ===== เลือกเดือน + ตัวกรอง ===== */}
      <section className="card p-4 sm:p-5 space-y-3" aria-label="เลือกเดือนและชนิดงาน">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onMonthChange(addMonths(month, -1))} className="btn-icon shrink-0" aria-label="เดือนก่อนหน้า">
            <ChevronLeft {...ICON_SM} />
          </button>
          <h2 className="min-w-0 flex-1 text-center text-base sm:text-lg font-semibold text-gray-900" aria-live="polite">
            {monthLabel(month)}
          </h2>
          <button type="button" onClick={() => onMonthChange(addMonths(month, 1))} className="btn-icon shrink-0" aria-label="เดือนถัดไป">
            <ChevronRight {...ICON_SM} />
          </button>
          <button type="button" onClick={() => void load(month)} disabled={loading} className="btn-icon btn-icon-plain shrink-0" aria-label="โหลดตารางงานใหม่">
            <RefreshCw {...ICON_SM} className={loading ? 'animate-spin' : undefined} />
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label="ชนิดงาน">
            {FILTERS.map(f => (
              <button key={f.value} type="button" className="chip-toggle" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
                {f.label}
              </button>
            ))}
          </div>
          {monthOfDay(today) !== month && (
            <button type="button" onClick={() => onMonthChange(monthOfDay(today))} className="btn-ghost px-3 text-sm">
              กลับไปเดือนนี้
            </button>
          )}
        </div>
        {totals && (
          <p className="text-sm text-gray-600 tabular-nums">
            ทั้งเดือน: รับชุด {totals.pickup.toLocaleString('th-TH')} · คืนชุด {totals.return.toLocaleString('th-TH')} · ลองชุด {totals.fitting.toLocaleString('th-TH')} การจอง
          </p>
        )}
      </section>

      {error && (
        <div role="alert" className="alert-err">
          <XCircle {...ICON_SM} />
          <div className="min-w-0 space-y-2">
            <p className="break-words">{error}</p>
            <button type="button" onClick={() => void load(month)} disabled={loading} className="btn-secondary px-4 text-sm">
              <RefreshCw {...ICON_SM} />
              ลองใหม่
            </button>
          </div>
        </div>
      )}

      {!shownOk && loading && (
        <div className="card p-4 sm:p-5 space-y-3" role="status" aria-busy="true">
          <span className="sr-only">กำลังโหลดตารางงาน...</span>
          {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-16 rounded-lg" />)}
        </div>
      )}

      {shownOk && (
        <>
          {/* ===== จอกว้าง: ตารางเดือน ===== */}
          <section className={clsx('hidden md:block card overflow-hidden transition-opacity', loading && 'opacity-60')} aria-label={`ตารางงานเดือน${monthLabel(month)}`} aria-busy={loading}>
            <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50" aria-hidden="true">
              {THAI_WEEKDAYS_SHORT.map((w, i) => (
                <div key={w} className={clsx('px-2 py-2 text-center text-xs font-semibold', i === 0 || i === 6 ? 'text-brand-700' : 'text-gray-600')}>{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {gridDays.map((k, idx) => {
                const d = dayOf(k)
                const entries = entriesOf(d, filter)
                const inMonth = monthOfDay(k) === month
                const isToday = k === today
                const isSel = k === selected
                const counts = {
                  pickup: entries.filter(e => e.kind === 'pickup').length,
                  return: entries.filter(e => e.kind === 'return').length,
                  fitting: entries.filter(e => e.kind === 'fitting').length,
                  overdue: entries.filter(e => e.kind === 'overdue').length,
                }
                const summary = [
                  counts.overdue ? `เกินกำหนดคืน ${counts.overdue}` : '',
                  counts.pickup ? `รับชุด ${counts.pickup}` : '',
                  counts.return ? `คืนชุด ${counts.return}` : '',
                  counts.fitting ? `ลองชุด ${counts.fitting}` : '',
                ].filter(Boolean).join(' ')
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSelected(k)}
                    aria-pressed={isSel}
                    aria-label={`${formatThaiDayLong(k)}${isToday ? ' (วันนี้)' : ''} ${summary || 'ไม่มีงาน'}`}
                    className={clsx(
                      'flex min-h-[112px] flex-col items-stretch gap-1 p-1.5 text-left align-top transition-colors',
                      idx % 7 !== 0 && 'border-l border-gray-150',
                      idx >= 7 && 'border-t border-gray-150',
                      !inMonth && 'bg-gray-50',
                      isSel ? 'bg-brand-50 outline outline-2 -outline-offset-2 outline-brand-500' : '[@media(hover:hover)]:hover:bg-gray-50',
                    )}
                  >
                    <span className="flex items-center justify-between gap-1">
                      <span
                        className={clsx(
                          'inline-grid h-6 min-w-[1.5rem] place-items-center rounded-full px-1 text-xs font-semibold tabular-nums',
                          isToday ? 'bg-brand-400 text-gray-900' : inMonth ? 'text-gray-900' : 'text-gray-400',
                        )}
                      >
                        {dayOfMonth(k)}
                      </span>
                      {entries.length > 0 && <span className="text-[11px] text-gray-500 tabular-nums">{entries.length} งาน</span>}
                    </span>
                    {entries.slice(0, 3).map(e => (
                      <span
                        key={`${e.kind}-${e.b.id}`}
                        className={clsx('block truncate rounded border px-1 py-px text-[11px] leading-4', KIND_META[e.kind].cls)}
                      >
                        <b className="font-semibold">{KIND_META[e.kind].short}</b> {e.b.customer_name || e.b.booking_no}
                      </span>
                    ))}
                    {entries.length > 3 && (
                      <span className="text-[11px] font-medium text-gray-600">+ อีก {entries.length - 3} รายการ</span>
                    )}
                  </button>
                )
              })}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-200 px-4 py-2.5 text-xs text-gray-600">
              {(['pickup', 'return', 'fitting', 'overdue'] as const).map(k => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <span className={clsx('rounded border px-1 text-[11px] font-semibold', KIND_META[k].cls)}>{KIND_META[k].short}</span>
                  {KIND_META[k].label}
                </span>
              ))}
            </div>
          </section>

          {/* ===== จอกว้าง: รายการของวันที่เลือก ===== */}
          <section className="hidden md:block card overflow-hidden" aria-live="polite" aria-labelledby="schedule-day-title">
            <div className="card-header">
              <h2 id="schedule-day-title" className="section-title">
                <CalendarDays {...ICON} />
                {formatThaiDayLong(selected)}
                {selected === today && <span className="chip-strong">วันนี้</span>}
              </h2>
            </div>
            <DayLists d={selDay} filter={filter} />
          </section>

          {/* ===== มือถือ: รายการแบบวาระ ===== */}
          <section className={clsx('md:hidden space-y-3 transition-opacity', loading && 'opacity-60')} aria-label={`รายการงานเดือน${monthLabel(month)}`} aria-busy={loading}>
            {hiddenPast > 0 && (
              <button type="button" onClick={() => setShowPast(true)} className="btn-secondary w-full text-sm">
                <History {...ICON_SM} />
                แสดงวันที่ผ่านมาแล้วของเดือนนี้ ({hiddenPast.toLocaleString('th-TH')} วัน)
              </button>
            )}
            {showPast && isCurrentMonth && agendaDays.some(k => k < today) && (
              <button type="button" onClick={() => setShowPast(false)} className="btn-ghost w-full text-sm">
                ซ่อนวันที่ผ่านมาแล้ว
              </button>
            )}
            {visibleAgenda.length === 0 ? (
              <div className="card empty-state">
                <span className="icon-bubble icon-bubble-lg"><CalendarX size={28} strokeWidth={1.75} aria-hidden="true" /></span>
                <p className="empty-state-title">
                  ไม่มีงาน{filter === 'all' ? '' : FILTERS.find(f => f.value === filter)?.label}{hiddenPast > 0 ? 'ตั้งแต่วันนี้ถึงสิ้นเดือน' : 'ในเดือนนี้'}
                </p>
              </div>
            ) : (
              visibleAgenda.map(k => (
                <div key={k} className={clsx('card overflow-hidden', k === today && 'border-brand-300')}>
                  <div className={clsx('flex items-center justify-between gap-2 px-4 py-2 border-b border-gray-200', k === today ? 'bg-brand-50' : 'bg-gray-50')}>
                    <h3 className="text-sm font-semibold text-gray-900">{weekdayDayLabel(k)}</h3>
                    {k === today && <span className="chip-strong">วันนี้</span>}
                  </div>
                  <DayLists d={dayOf(k)} filter={filter} />
                </div>
              ))
            )}
          </section>
        </>
      )}
    </div>
  )
}
