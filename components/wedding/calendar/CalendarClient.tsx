'use client'
// ปฏิทินงานร้าน b.oncloud (wed_calendar + wed_day)
// - แถบบน: เดือนก่อน/ถัดไป · ปุ่มชื่อเดือน (เลือกเดือน/ปี พ.ศ.) · วันนี้ · โหลดใหม่ + ตัวกรอง (ทีมงาน / รวมงานสอบถาม / ประเภทคิว)
//   ทีมงานและงานสอบถาม = ฐานข้อมูลกรองให้ (ส่งเป็นพารามิเตอร์) · ประเภทคิว = กรองในหน้าเว็บ
//   จำนวนงาน/คิวเต็มของแต่ละวันนับงานทั้งหมดเสมอ (ไม่ขึ้นกับตัวกรอง) — ตรงกับกฎความจุของฐานข้อมูล
// - จอกว้าง (xl+): ตารางเดือน + แผงรายละเอียดวันด้านขวา (อยู่กับที่ตอนเลื่อน)
//   แท็บเล็ต (md–xl): ตารางเดือน แตะวัน → แผงเลื่อนออกจากขวา · มือถือ: ตารางย่อ (จุดสี) + วาระสัปดาห์ แตะวัน → ชีตล่าง
// - สถานะ (เดือน / วันที่เลือก / ตัวกรอง) เขียนลง URL → โหลดหน้าใหม่/ส่งลิงก์แล้วเปิดตรงที่เดิม (?month= ?day= ?crew= ?inq=1 ?type=)
// - หน้านี้อ่านอย่างเดียว ไม่มีการเขียนข้อมูล
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, RefreshCw, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON_SM } from '@/components/theme/icons'
import MigrationNotice from '@/components/pos/MigrationNotice'
import { addDaysToKey, bangkokTodayKey, formatThaiDate } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import {
  FIX07_MISSING_MSG, crewDisplayName, crewRoleLabel, parseCrewList, parseWedCalendar,
  type WedCalendar, type WedCalendarDay, type WedCrew, type WedDaySession, type WedSessionMini,
} from '@/lib/wedding'
import {
  addMonths, dayRange, monthFirstDay, monthGridRange, monthLabel, monthOfDay,
} from '@/components/rental/calendar/dates'
import MonthGrid, { CalendarLegend } from './MonthGrid'
import { CompactMonthGrid, WeekAgenda, weekStartOf } from './CompactMonth'
import DayPanel from './DayPanel'
import DaySheet from './DaySheet'
import DayImageDialog from './DayImageDialog'
import MonthPickerDialog from './MonthPickerDialog'
import {
  DEFAULT_FILTERS, TYPE_FILTERS, conflictPairText, filtersActive, monthLabelShort, type CalFilters,
} from './calendarModel'
import { rpcWithTimeout, wedErrorText } from './rpc'
import { useWedDay } from './useWedDay'

// กลับมาที่แท็บนานกว่านี้ → โหลดปฏิทินใหม่เงียบๆ (มีคนรับงาน/ย้ายคิวจากเครื่องอื่น)
const STALE_MS = 60000
const CONFLICTS_PREVIEW = 4

// จอ xl ขึ้นไป (แผงรายละเอียดวันอยู่ข้างตาราง) — null = ยังไม่รู้ (รอบแรกฝั่งเซิร์ฟเวอร์)
function useIsXl(): boolean | null {
  const [v, setV] = useState<boolean | null>(null)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)')
    const on = () => setV(mq.matches)
    on()
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', on)
      return () => mq.removeEventListener('change', on)
    }
    mq.addListener(on)
    return () => mq.removeListener(on)
  }, [])
  return v
}

function emptyDay(day: string): WedCalendarDay {
  return { day, count_jobs: 0, full: false, sessions: [] }
}

function defaultDayOf(month: string, today: string): string {
  return monthOfDay(today) === month ? today : monthFirstDay(month)
}

function calKey(month: string, f: CalFilters): string {
  return `${month}|${f.crewId ?? ''}|${f.includeInquiries ? 1 : 0}`
}

export default function CalendarClient({
  today: todayProp,
  initialMonth,
  initialDay,
  initialFilters,
}: {
  today: string
  initialMonth: string
  /** วันที่จากลิงก์ (?day=) — เปิดรายละเอียดวันนั้นทันที */
  initialDay: string | null
  initialFilters: CalFilters
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const isXl = useIsXl()
  const panelHeadingId = useId()
  const sheetHeadingId = useId()

  const [today, setToday] = useState(todayProp)
  const [month, setMonth] = useState(initialMonth)
  const [selected, setSelected] = useState(() => initialDay ?? defaultDayOf(initialMonth, todayProp))
  const [filters, setFilters] = useState<CalFilters>(initialFilters)
  const [cal, setCal] = useState<{ key: string; data: WedCalendar } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [crew, setCrew] = useState<WedCrew[] | null>(null)
  const [crewError, setCrewError] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [image, setImage] = useState<{ day: string; sessions: WedDaySession[] } | null>(null)
  const [showAllConflicts, setShowAllConflicts] = useState(false)
  const reqRef = useRef(0)
  const loadedAtRef = useRef(0)
  const stateRef = useRef({ month, filters })
  stateRef.current = { month, filters }
  const deepLinkRef = useRef(initialDay !== null)

  const grid = useMemo(() => monthGridRange(month), [month])
  const gridDays = useMemo(() => dayRange(grid.from, grid.to), [grid])

  // รายละเอียดวัน: จอ xl โหลดวันที่เลือกเสมอ (แผงขวา) · จอเล็กโหลดเมื่อเปิดชีต
  const dayToLoad = isXl === true || sheetOpen ? selected : null
  const dayState = useWedDay(dayToLoad)

  // ---------------------------------------------------------------------------
  // โหลดปฏิทินของเดือน + ตัวกรอง (ทีมงาน / งานสอบถาม)
  // ---------------------------------------------------------------------------
  const load = useCallback(async (m: string, f: CalFilters, opts?: { silent?: boolean }) => {
    const id = ++reqRef.current
    if (!opts?.silent) {
      setLoading(true)
      setError('')
    }
    const range = monthGridRange(m)
    const res = await rpcWithTimeout(supabase, 'wed_calendar', {
      p_from: range.from,
      p_to: range.to,
      p_crew_id: f.crewId,
      p_include_inquiries: f.includeInquiries,
    })
    if (id !== reqRef.current) return
    if (res.error) {
      const miss = isMigrationMissing(res.error)
      setMissing(miss)
      if (!opts?.silent || miss) setError(wedErrorText(res.error))
    } else {
      setCal({ key: calKey(m, f), data: parseWedCalendar(res.data) })
      setMissing(false)
      setError('')
      loadedAtRef.current = Date.now()
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    void load(month, filters)
  }, [load, month, filters])

  // รายชื่อทีมงาน (ตัวกรอง) — โหลดครั้งเดียว ; ไม่ได้ = ปิดตัวกรองทีมงาน (ปฏิทินยังใช้ได้)
  useEffect(() => {
    let alive = true
    void (async () => {
      const res = await rpcWithTimeout(supabase, 'wed_list_crew')
      if (!alive) return
      if (res.error) {
        setCrewError(true)
        return
      }
      const list = parseCrewList(res.data)
      setCrew(list)
      // ทีมงานในลิงก์ไม่มีในระบบแล้ว → ล้างตัวกรอง
      setFilters(f => (f.crewId && !list.some(c => c.id === f.crewId) ? { ...f, crewId: null } : f))
    })()
    return () => { alive = false }
  }, [supabase])

  // กลับมาที่แท็บ: อัปเดต "วันนี้" (ข้ามเที่ยงคืน) + โหลดใหม่เงียบๆ ถ้าข้อมูลเก่าเกิน 1 นาที
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      setToday(bangkokTodayKey())
      if (loadedAtRef.current > 0 && Date.now() - loadedAtRef.current > STALE_MS) {
        void load(stateRef.current.month, stateRef.current.filters, { silent: true })
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  // ลิงก์ที่ระบุวัน (?day=) บนจอเล็ก → เปิดชีตรายละเอียดวันนั้นเลย (ครั้งเดียว เมื่อรู้ขนาดจอแล้ว)
  useEffect(() => {
    if (isXl === null || !deepLinkRef.current) return
    deepLinkRef.current = false
    if (!isXl) setSheetOpen(true)
  }, [isXl])

  // ขยายจอเป็น xl ระหว่างเปิดชีต → ใช้แผงขวาแทน
  useEffect(() => {
    if (isXl) setSheetOpen(false)
  }, [isXl])

  // ---------------------------------------------------------------------------
  // URL
  // ---------------------------------------------------------------------------
  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      const set = (k: string, v: string | null) => (v ? url.searchParams.set(k, v) : url.searchParams.delete(k))
      set('month', month === monthOfDay(today) ? null : month)
      set('day', selected === defaultDayOf(month, today) ? null : selected)
      set('crew', filters.crewId)
      set('inq', filters.includeInquiries ? '1' : null)
      set('type', filters.type === 'all' ? null : filters.type)
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    } catch {
      // เบราว์เซอร์ไม่ยอมแก้ URL — ไม่เป็นไร
    }
  }, [month, selected, filters, today])

  // ---------------------------------------------------------------------------
  // การกระทำ
  // ---------------------------------------------------------------------------
  function changeMonth(m: string) {
    if (!m || m === month) return
    setMonth(m)
    setSelected(defaultDayOf(m, today))
    setShowAllConflicts(false)
  }

  // เลือกวัน (ถ้าอยู่นอกตารางของเดือนที่แสดง → เปลี่ยนเดือนตาม) ; open = เปิดชีตบนจอเล็ก
  function selectDay(day: string, open: boolean) {
    if (!day) return
    setSelected(day)
    if (day < grid.from || day > grid.to) {
      setMonth(monthOfDay(day))
      setShowAllConflicts(false)
    }
    if (open && isXl !== true) setSheetOpen(true)
  }

  function changeFilters(next: Partial<CalFilters>) {
    setFilters(f => ({ ...f, ...next }))
  }

  function reload() {
    dayState.clearAll()
    void load(month, filters)
    if (dayToLoad) dayState.reload()
    // ตัวเลขบนเมนูอยู่ใน layout — ให้เซิร์ฟเวอร์ render ใหม่ด้วย
    router.refresh()
  }

  function openImage(day: string, sessions: WedDaySession[]) {
    setImage({ day, sessions })
  }

  // ---------------------------------------------------------------------------
  // ข้อมูลที่แสดง
  // ---------------------------------------------------------------------------
  const shownCal = cal && cal.key === calKey(month, filters) ? cal.data : null
  const dayMap = useMemo(() => {
    const map = new Map<string, WedCalendarDay>()
    if (shownCal) for (const d of shownCal.days) map.set(d.day, d)
    return map
  }, [shownCal])
  const sessionIndex = useMemo(() => {
    const map = new Map<string, WedSessionMini>()
    if (shownCal) for (const d of shownCal.days) for (const s of d.sessions) map.set(s.session_id, s)
    return map
  }, [shownCal])
  const dayOf = useCallback((k: string) => dayMap.get(k) ?? emptyDay(k), [dayMap])
  const sessionsOf = useCallback(
    (k: string) => (dayMap.get(k)?.sessions ?? []).filter(s => filters.type === 'all' || s.session_type === filters.type),
    [dayMap, filters.type],
  )
  const capacity = shownCal?.capacity ?? 0

  if (missing && !shownCal) return <MigrationNotice message={FIX07_MISSING_MSG} />

  const monthDays = gridDays.filter(k => monthOfDay(k) === month)
  const totals = shownCal
    ? (() => {
      const sessions = monthDays.flatMap(k => sessionsOf(k))
      return {
        sessions: sessions.length,
        jobs: new Set(sessions.filter(s => s.status !== 'inquiry').map(s => s.booking_id)).size,
        inquiries: new Set(sessions.filter(s => s.status === 'inquiry').map(s => s.booking_id)).size,
        fullDays: monthDays.filter(k => dayOf(k).full).length,
      }
    })()
    : null
  const conflicts = shownCal?.conflicts ?? []
  const shownConflicts = showAllConflicts ? conflicts : conflicts.slice(0, CONFLICTS_PREVIEW)
  const isCurrentMonth = monthOfDay(today) === month
  const weekStart = weekStartOf(selected)
  const activeCrew = filters.crewId ? crew?.find(c => c.id === filters.crewId) ?? null : null

  const dayPanel = (headingId: string) => (
    <DayPanel
      day={selected}
      today={today}
      state={dayState}
      filters={filters}
      headingId={headingId}
      onRetry={dayState.reload}
      onOpenImage={openImage}
    />
  )

  return (
    <div className="space-y-4">
      {/* ===== เดือน + ตัวกรอง ===== */}
      <section className="card p-3 sm:p-5 space-y-3" aria-label="เลือกเดือนและตัวกรอง">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button type="button" onClick={() => changeMonth(addMonths(month, -1))} className="btn-icon shrink-0" aria-label="เดือนก่อนหน้า">
            <ChevronLeft {...ICON_SM} />
          </button>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-2 text-base sm:text-lg font-semibold text-gray-900 active:bg-gray-100 [@media(hover:hover)]:hover:bg-gray-50"
            aria-label={`เดือน${monthLabel(month)} — กดเพื่อเลือกเดือนอื่น`}
          >
            {/* จอแคบ (มือถือ) = เดือนย่อ + ปี พ.ศ. ให้เห็นครบ ; sm ขึ้นไป = ชื่อเดือนเต็ม */}
            <span className="truncate sm:hidden">{monthLabelShort(month)}</span>
            <span className="hidden truncate sm:inline">{monthLabel(month)}</span>
            <ChevronDown {...ICON_SM} className="shrink-0 text-gray-500" />
          </button>
          <button type="button" onClick={() => changeMonth(addMonths(month, 1))} className="btn-icon shrink-0" aria-label="เดือนถัดไป">
            <ChevronRight {...ICON_SM} />
          </button>
          <button
            type="button"
            onClick={() => {
              const t = bangkokTodayKey()
              setToday(t)
              if (monthOfDay(t) !== month) setMonth(monthOfDay(t))
              selectDay(t, false)
            }}
            className="btn-secondary shrink-0 px-3 text-sm"
            disabled={isCurrentMonth && selected === today}
          >
            วันนี้
          </button>
          <button type="button" onClick={reload} disabled={loading} className="btn-icon btn-icon-plain shrink-0" aria-label="โหลดปฏิทินใหม่">
            <RefreshCw {...ICON_SM} className={loading ? 'animate-spin' : undefined} />
          </button>
        </div>

        <div className="grid gap-2 sm:grid-cols-[minmax(0,16rem)_auto] sm:items-center">
          <label className="block min-w-0">
            <span className="sr-only">ทีมงาน</span>
            <select
              className="input"
              value={filters.crewId ?? ''}
              disabled={!crew}
              onChange={e => changeFilters({ crewId: e.target.value || null })}
              aria-describedby={crewError ? 'wed-cal-crew-err' : undefined}
            >
              <option value="">{crew || crewError ? 'ทีมงานทุกคน' : 'กำลังโหลดรายชื่อทีมงาน...'}</option>
              {crew && crew.filter(c => c.is_active).map(c => (
                <option key={c.id} value={c.id}>{crewDisplayName(c)} · {crewRoleLabel(c.role)}</option>
              ))}
              {crew && crew.some(c => !c.is_active) && (
                <optgroup label="ไม่ได้ใช้งานแล้ว">
                  {crew.filter(c => !c.is_active).map(c => (
                    <option key={c.id} value={c.id}>{crewDisplayName(c)} · {crewRoleLabel(c.role)}</option>
                  ))}
                </optgroup>
              )}
            </select>
            {crewError && <span id="wed-cal-crew-err" className="field-hint text-amber-800">โหลดรายชื่อทีมงานไม่ได้ — ดูได้ทุกคนตามปกติ</span>}
          </label>
          <button
            type="button"
            role="switch"
            aria-checked={filters.includeInquiries}
            onClick={() => changeFilters({ includeInquiries: !filters.includeInquiries })}
            className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-gray-300 bg-white px-3 text-left text-sm font-medium text-gray-800 sm:justify-start"
          >
            <span>รวมงานสอบถาม</span>
            <span aria-hidden="true" className={clsx('switch switch-sm', filters.includeInquiries && 'switch-on')}>
              <span className="switch-knob" />
            </span>
          </button>
        </div>

        <div className="-mx-3 overflow-x-auto px-3 scrollbar-none sm:mx-0 sm:px-0">
          <div className="flex w-max gap-2 sm:w-auto sm:flex-wrap" role="group" aria-label="ประเภทคิว">
            {TYPE_FILTERS.map(t => (
              <button
                key={t.value}
                type="button"
                className="chip-toggle"
                aria-pressed={filters.type === t.value}
                onClick={() => changeFilters({ type: t.value })}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          {totals ? (
            <p className="text-sm text-gray-600 tabular-nums">
              {monthLabel(month)}: {totals.jobs.toLocaleString('th-TH')} งาน · {totals.sessions.toLocaleString('th-TH')} คิว
              {totals.inquiries > 0 && ` · สอบถาม ${totals.inquiries.toLocaleString('th-TH')}`}
              {totals.fullDays > 0 && ` · คิวเต็ม ${totals.fullDays.toLocaleString('th-TH')} วัน`}
              {activeCrew && ` (เฉพาะ ${crewDisplayName(activeCrew)})`}
            </p>
          ) : <span />}
          {filtersActive(filters) && (
            <button type="button" onClick={() => setFilters(DEFAULT_FILTERS)} className="btn-ghost px-3 text-sm">
              ล้างตัวกรอง
            </button>
          )}
        </div>
      </section>

      {error && (
        <div role="alert" className="alert-err">
          <XCircle {...ICON_SM} />
          <div className="min-w-0 space-y-2">
            <p className="break-words">{error}</p>
            <button type="button" onClick={() => void load(month, filters)} disabled={loading} className="btn-secondary px-4 text-sm">
              <RefreshCw {...ICON_SM} />
              ลองใหม่
            </button>
          </div>
        </div>
      )}

      {/* ===== ทีมงานชนคิวในช่วงที่แสดง ===== */}
      {conflicts.length > 0 && (
        <section role="alert" className="alert-err" aria-label="ทีมงานชนคิว">
          <AlertTriangle {...ICON_SM} />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-semibold">ทีมงานชนคิว {conflicts.length.toLocaleString('th-TH')} รายการในช่วงนี้ — จัดทีมใหม่ในหน้างาน</p>
            <ul className="space-y-0.5">
              {shownConflicts.map((c, i) => (
                <li key={`${c.crew_id}-${c.this_session_id ?? ''}-${c.other_session_id ?? i}`}>
                  <button
                    type="button"
                    onClick={() => selectDay(c.date, true)}
                    className="min-h-[44px] w-full rounded px-1 text-left text-sm underline-offset-2 [@media(hover:hover)]:hover:underline"
                  >
                    <b className="tabular-nums">{formatThaiDate(c.date)}</b> · {conflictPairText(c, id => sessionIndex.get(id))}
                  </button>
                </li>
              ))}
            </ul>
            {conflicts.length > CONFLICTS_PREVIEW && (
              <button type="button" onClick={() => setShowAllConflicts(v => !v)} className="btn-ghost -ml-2 px-2 text-sm !text-red-800">
                {showAllConflicts ? 'แสดงน้อยลง' : `ดูทั้งหมด (${conflicts.length.toLocaleString('th-TH')})`}
              </button>
            )}
          </div>
        </section>
      )}

      {!shownCal && loading && (
        <div className="card p-4 sm:p-5 space-y-3" role="status" aria-busy="true">
          <span className="sr-only">กำลังโหลดปฏิทิน...</span>
          <div className="hidden md:grid grid-cols-7 gap-px">
            {[...Array(35)].map((_, i) => <div key={i} className="skeleton h-24 rounded-none" />)}
          </div>
          <div className="md:hidden space-y-2">
            {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-12 rounded-lg" />)}
          </div>
        </div>
      )}

      {shownCal && (
        <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start xl:gap-6">
          <div className="min-w-0 space-y-4">
            {/* ===== md+: ตารางเดือนเต็ม ===== */}
            <section
              className={clsx('hidden md:block card overflow-hidden transition-opacity', loading && 'opacity-60')}
              aria-label={`ปฏิทินงานเดือน${monthLabel(month)}`}
              aria-busy={loading}
            >
              <MonthGrid
                month={month}
                today={today}
                selected={selected}
                gridDays={gridDays}
                dayOf={dayOf}
                sessionsOf={sessionsOf}
                capacity={capacity}
                onSelect={d => selectDay(d, true)}
              />
              <CalendarLegend className="border-t border-gray-200 px-4 py-3" />
            </section>

            {/* ===== มือถือ: ตารางย่อ + วาระสัปดาห์ ===== */}
            <section
              className={clsx('md:hidden card overflow-hidden transition-opacity', loading && 'opacity-60')}
              aria-label={`ปฏิทินงานเดือน${monthLabel(month)}`}
              aria-busy={loading}
            >
              <CompactMonthGrid
                month={month}
                today={today}
                selected={selected}
                gridDays={gridDays}
                dayOf={dayOf}
                sessionsOf={sessionsOf}
                capacity={capacity}
                onSelect={d => selectDay(d, true)}
              />
            </section>
            <div className="md:hidden">
              <WeekAgenda
                weekStart={weekStart}
                today={today}
                selected={selected}
                dayOf={dayOf}
                sessionsOf={sessionsOf}
                loading={loading}
                onOpenDay={d => selectDay(d, true)}
                onPrevWeek={() => selectDay(addDaysToKey(selected, -7), false)}
                onNextWeek={() => selectDay(addDaysToKey(selected, 7), false)}
              />
            </div>
            <details className="md:hidden card">
              <summary className="flex min-h-[44px] cursor-pointer items-center px-4 text-sm font-medium text-gray-700">ความหมายของสีและไอคอน</summary>
              <CalendarLegend className="border-t border-gray-200 px-4 py-3" />
            </details>
          </div>

          {/* ===== xl+: แผงรายละเอียดวัน (อยู่กับที่) ===== */}
          <aside
            className="hidden xl:block xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:overflow-y-auto xl:overscroll-contain"
            aria-labelledby={panelHeadingId}
          >
            {isXl && dayPanel(panelHeadingId)}
          </aside>
        </div>
      )}

      {sheetOpen && isXl !== true && (
        <DaySheet
          labelledBy={sheetHeadingId}
          suspendEsc={image !== null}
          onClose={() => setSheetOpen(false)}
          onPrev={() => selectDay(addDaysToKey(selected, -1), false)}
          onNext={() => selectDay(addDaysToKey(selected, 1), false)}
        >
          {dayPanel(sheetHeadingId)}
        </DaySheet>
      )}

      {pickerOpen && (
        <MonthPickerDialog
          month={month}
          todayMonth={monthOfDay(today)}
          onPick={m => {
            setPickerOpen(false)
            changeMonth(m)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {image && <DayImageDialog day={image.day} sessions={image.sessions} onClose={() => setImage(null)} />}

      {/* ประกาศเดือนที่แสดงให้โปรแกรมอ่านจอ (ไว้ท้ายสุด — .sr-only ลอย ไม่ดันระยะห่างของกล่องอื่น) */}
      <p className="sr-only" aria-live="polite">ปฏิทินเดือน{monthLabel(month)}</p>
    </div>
  )
}
