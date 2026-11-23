'use client'
// ภาพรวมร้าน b.oncloud (wed_today) — สิ่งที่ต้องดูแลในวัน:
//   คิวงานวันนี้ (เวลาทีมถึง ทีมงาน สถานที่ เงิน) + รูปตารางงานส่งกลุ่ม LINE · คิว 7 วันถัดไป · ทีมงานชนคิว (30 วัน) ·
//   ติดตามลูกค้า · ล็อกคิวใกล้หมดเวลา · งวดชำระถึงกำหนด/ค้าง · งานที่ใกล้กำหนดส่ง · ตัวเลขของเดือน (รายรับเฉพาะผู้จัดการ)
// - เลือกวันอื่นได้ (วางแผนล่วงหน้า/ย้อนดู) — วันที่เลือกเขียนลง URL (?day=) ; วันนี้ = ไม่ใส่ (แบบเดียวกับภาพรวมร้านเช่า)
// - ข้อมูลรอบแรกโหลดจากเซิร์ฟเวอร์ (หน้าแสดงครบทันที) — เปลี่ยนวัน/โหลดใหม่ดึงจากหน้าเว็บ
// - หน้านี้อ่านอย่างเดียว (การกระทำกับงานทำในหน้างาน)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  AlertTriangle, ArrowRight, CalendarClock, CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Clapperboard, Hourglass,
  ImageDown, Plus, RefreshCw, Wallet, XCircle, type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM } from '@/components/theme/icons'
import MigrationNotice from '@/components/pos/MigrationNotice'
import { addDaysToKey, bangkokTodayKey, baht, formatThaiDate, formatThaiDayLong, isDayKey } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { FIX07_MISSING_MSG, parseWedToday, thaiMonthYear, type WedSessionMini, type WedToday } from '@/lib/wedding'
import { useNow } from '@/components/rental/calendar/useNow'
import SessionDetailCard from '@/components/wedding/calendar/SessionDetailCard'
import DayImageDialog from '@/components/wedding/calendar/DayImageDialog'
import { rpcWithTimeout, wedCalendarHref, wedErrorText, wedNewBookingHref } from '@/components/wedding/calendar/rpc'
import {
  BookingMiniRows, ConflictRows, DeliverableDueRows, InstallmentDueRows, NextSessionsList,
} from './DashboardLists'

// กลับมาที่แท็บนานกว่านี้ → โหลดข้อมูลใหม่เงียบๆ
const STALE_MS = 60000
const CONFLICTS_PREVIEW = 5

function Section({
  id, title, icon: Icon, count, tone = 'normal', action, children,
}: {
  id: string
  title: string
  icon: LucideIcon
  count?: number | string
  tone?: 'normal' | 'danger' | 'warn'
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section id={id} className={clsx('card overflow-hidden scroll-mt-4', tone === 'danger' && 'border-red-200')} aria-labelledby={`${id}-title`}>
      <div className={clsx('card-header flex-wrap', tone === 'danger' && 'bg-red-50')}>
        <h2 id={`${id}-title`} className="section-title min-w-0 flex-wrap gap-y-0">
          <Icon {...ICON} className={tone === 'danger' ? '!text-red-700' : tone === 'warn' ? '!text-amber-600' : undefined} />
          <span className="min-w-0 break-words">{title}</span>
          {count !== undefined && <span className="text-sm font-normal text-gray-500 tabular-nums">({count})</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function StatLink({
  href, label, value, unit, note, icon: Icon, bubble = '', hot = false, danger = false,
}: {
  href: string
  label: string
  value: string
  unit?: string
  note?: string
  icon: LucideIcon
  bubble?: string
  hot?: boolean
  danger?: boolean
}) {
  return (
    <a href={href} className={clsx('stat-card card-hover', hot && 'stat-card-hot', danger && 'border-red-200')}>
      <div className="flex items-start justify-between gap-2">
        <span className={clsx('stat-label min-w-0 pt-1', danger && 'text-red-800')}>{label}</span>
        <span className={clsx('icon-bubble', bubble)}><Icon {...ICON} /></span>
      </div>
      <div className="min-w-0">
        <p className={clsx('stat-value', danger && 'text-red-700')}>
          <span className="whitespace-nowrap">{value}</span>
          {unit && <span className="stat-sub"> {unit}</span>}
        </p>
        {note && <p className="stat-sub mt-1">{note}</p>}
      </div>
    </a>
  )
}

function MonthNumber({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="panel px-3 py-2.5">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="money text-lg text-gray-900 whitespace-nowrap">{value}</p>
      {note && <p className="text-[11px] text-gray-500">{note}</p>}
    </div>
  )
}

export default function WeddingDashboard({
  initialDay,
  today,
  initial,
  initialError,
}: {
  initialDay: string
  today: string
  initial: WedToday | null
  initialError: string | null
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const now = useNow(30000)
  const [todayKey, setTodayKey] = useState(today)
  const [day, setDay] = useState(initialDay)
  const [data, setData] = useState<WedToday | null>(initial)
  const [loading, setLoading] = useState(!initial && !initialError)
  const [error, setError] = useState(initialError ?? '')
  const [missing, setMissing] = useState(false)
  const [imageOpen, setImageOpen] = useState(false)
  const [showAllConflicts, setShowAllConflicts] = useState(false)
  const reqRef = useRef(0)
  const loadedAtRef = useRef(initial ? Date.now() : 0)
  const dayRef = useRef(initialDay)

  const load = useCallback(async (d: string, opts?: { silent?: boolean }) => {
    const id = ++reqRef.current
    if (!opts?.silent) {
      setLoading(true)
      setError('')
    }
    const res = await rpcWithTimeout(supabase, 'wed_today', { p_day: d })
    if (id !== reqRef.current) return
    if (res.error) {
      if (isMigrationMissing(res.error)) setMissing(true)
      // โหลดเงียบ (กลับมาที่แท็บ) ไม่สำเร็จ → คงข้อมูลเดิมไว้ ไม่ขึ้นกล่องแดง
      if (!opts?.silent) setError(wedErrorText(res.error))
    } else {
      const parsed = parseWedToday(res.data)
      setData(parsed.day ? parsed : { ...parsed, day: d })
      setMissing(false)
      setError('')
      loadedAtRef.current = Date.now()
    }
    setLoading(false)
  }, [supabase])

  // ไม่มีข้อมูลรอบแรก → โหลดจากหน้าเว็บ
  useEffect(() => {
    if (!initial && !initialError) void load(initialDay)
  }, [initial, initialError, initialDay, load])

  // เซิร์ฟเวอร์ render หน้านี้ใหม่ (กดเมนู "ภาพรวม" ขณะอยู่หน้านี้ / router.refresh()) → ใช้ข้อมูลชุดใหม่
  const propsRef = useRef({ initial, initialError })
  useEffect(() => {
    const prev = propsRef.current
    if (prev.initial === initial && prev.initialError === initialError) return
    propsRef.current = { initial, initialError }
    reqRef.current++
    setDay(initialDay)
    dayRef.current = initialDay
    if (initial) {
      setData(initial)
      setError('')
      loadedAtRef.current = Date.now()
    } else if (initialError) {
      setError(initialError)
    }
    setLoading(false)
  }, [initial, initialError, initialDay])

  // กลับมาที่แท็บ: อัปเดต "วันนี้" + โหลดใหม่เงียบๆ ถ้าข้อมูลเก่าเกิน 1 นาที
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      setTodayKey(bangkokTodayKey())
      if (Date.now() - loadedAtRef.current > STALE_MS) void load(dayRef.current, { silent: true })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  const syncUrl = useCallback((d: string, t: string) => {
    try {
      const url = new URL(window.location.href)
      if (d === t) url.searchParams.delete('day')
      else url.searchParams.set('day', d)
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    } catch {
      // เบราว์เซอร์ไม่ยอมแก้ URL — ไม่เป็นไร
    }
  }, [])

  function changeDay(next: string) {
    if (!isDayKey(next)) return
    const t = bangkokTodayKey()
    setTodayKey(t)
    setDay(next)
    dayRef.current = next
    setShowAllConflicts(false)
    syncUrl(next, t)
    void load(next)
  }

  function reload() {
    void load(day)
    // ตัวเลขบนเมนู (ติดตามลูกค้า/ส่งงาน/งวดค้าง) อยู่ใน layout — ให้เซิร์ฟเวอร์ render ใหม่ด้วย
    router.refresh()
  }

  const isToday = day === todayKey
  const dayWord = isToday ? 'วันนี้' : `วันที่ ${formatThaiDate(day)}`
  const shown = data && data.day === day ? data : null
  const busy = loading && !shown

  // คิวทั้งหมดในหน้า (หาชื่องานฝั่ง "คิวนี้" ของรายการทีมชนคิว)
  const sessionIndex = useMemo(() => {
    const map = new Map<string, WedSessionMini>()
    if (shown) {
      for (const s of shown.today_sessions) map.set(s.session_id, s)
      for (const s of shown.next7) map.set(s.session_id, s)
    }
    return map
  }, [shown])

  if (missing && !shown) {
    return <MigrationNotice title="ภาพรวม" subtitle="คิวงาน สิ่งที่ต้องติดตาม และการเงินของร้าน" message={FIX07_MISSING_MSG} />
  }

  const todayJobs = shown ? new Set(shown.today_sessions.map(s => s.booking_id)).size : 0
  const capacity = shown?.capacity ?? 0
  const overdueInstallments = shown ? shown.installments_due.filter(i => i.overdue) : []
  const overdueDeliverables = shown ? shown.deliverables_due.filter(d => d.overdue) : []
  const followCount = shown ? shown.followups.length + shown.holds_expiring.length : 0
  const conflicts = shown?.conflicts ?? []
  const shownConflicts = showAllConflicts ? conflicts : conflicts.slice(0, CONFLICTS_PREVIEW)
  const monthName = shown?.month.month ? thaiMonthYear(shown.month.month) : ''

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">ภาพรวม{isToday ? 'วันนี้' : 'รายวัน'}</h1>
          <p className="page-subtitle">คิวงาน สิ่งที่ต้องติดตาม และการเงินของร้าน</p>
        </div>
        <div className="page-actions">
          <Link href="/wedding/bookings/new" className="btn-primary">
            <Plus {...ICON_SM} />
            สร้างงาน
          </Link>
          <Link href={wedCalendarHref(isToday ? null : day)} className="btn-secondary">
            <CalendarDays {...ICON_SM} />
            เปิดปฏิทิน
          </Link>
        </div>
      </div>

      {/* ===== เลือกวัน ===== */}
      <section className="card p-4 sm:p-5 space-y-1" aria-label="เลือกวัน">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => changeDay(addDaysToKey(day, -1))} className="btn-icon shrink-0" aria-label="วันก่อนหน้า">
            <ChevronLeft {...ICON_SM} />
          </button>
          <input
            type="date"
            className="input min-w-0 flex-1 tabular-nums"
            value={day}
            onChange={e => { if (e.target.value) changeDay(e.target.value) }}
            aria-label="เลือกวัน"
            aria-describedby="wed-dash-day-caption"
          />
          <button type="button" onClick={() => changeDay(addDaysToKey(day, 1))} className="btn-icon shrink-0" aria-label="วันถัดไป">
            <ChevronRight {...ICON_SM} />
          </button>
          <button type="button" onClick={reload} disabled={loading} className="btn-icon btn-icon-plain shrink-0" aria-label="โหลดข้อมูลใหม่">
            <RefreshCw {...ICON_SM} className={loading ? 'animate-spin' : undefined} />
          </button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p id="wed-dash-day-caption" className="min-w-0 text-sm text-gray-600">{formatThaiDayLong(day)}</p>
          {!isToday && (
            <button type="button" onClick={() => changeDay(bangkokTodayKey())} className="btn-ghost shrink-0 px-3 text-sm">
              กลับไปวันนี้
            </button>
          )}
        </div>
      </section>

      {error && (
        <div role="alert" className="alert-err">
          <XCircle {...ICON_SM} />
          <div className="min-w-0 space-y-2">
            <p className="break-words">{error}</p>
            <button type="button" onClick={() => void load(day)} disabled={loading} className="btn-secondary px-4 text-sm">
              <RefreshCw {...ICON_SM} />
              ลองใหม่
            </button>
          </div>
        </div>
      )}

      {busy && (
        <div className="space-y-4" aria-busy="true" role="status">
          <span className="sr-only">กำลังโหลด...</span>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 xl:gap-6">
            {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-28 rounded-xl" />)}
          </div>
          <div className="card p-4 sm:p-5 space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-12 rounded-lg" />)}
          </div>
        </div>
      )}

      {shown && (
        <div className={clsx('space-y-4 sm:space-y-6 transition-opacity', loading && 'opacity-60')} aria-busy={loading}>
          {/* ===== เรื่องด่วน ===== */}
          {(conflicts.length > 0 || overdueInstallments.length > 0 || shown.holds_expiring.length > 0 || overdueDeliverables.length > 0) && (
            <div className="space-y-2" aria-live="polite">
              {conflicts.length > 0 && (
                <a href="#dash-conflicts" className="alert-err font-medium">
                  <AlertTriangle {...ICON_SM} />
                  <span className="min-w-0 flex-1">
                    ทีมงานชนคิว {conflicts.length.toLocaleString('th-TH')} รายการใน 30 วันข้างหน้า — จัดทีมใหม่ก่อนวันงาน
                  </span>
                  <ArrowRight {...ICON_SM} />
                </a>
              )}
              {overdueInstallments.length > 0 && (
                <a href="#dash-installments" className="alert-err font-medium">
                  <Wallet {...ICON_SM} />
                  <span className="min-w-0 flex-1">
                    มีงวดชำระเลยกำหนด {overdueInstallments.length.toLocaleString('th-TH')} งวด
                    รวม {baht(overdueInstallments.reduce((s, i) => s + i.amount_remaining, 0))} — ติดตามลูกค้า
                  </span>
                  <ArrowRight {...ICON_SM} />
                </a>
              )}
              {shown.holds_expiring.length > 0 && (
                <a href="#dash-holds" className="alert-warn font-medium">
                  <Hourglass {...ICON_SM} />
                  <span className="min-w-0 flex-1">
                    ล็อกคิวใกล้หมดเวลา {shown.holds_expiring.length.toLocaleString('th-TH')} งาน — ทวงมัดจำ หรือยืนยันงาน
                  </span>
                  <ArrowRight {...ICON_SM} />
                </a>
              )}
              {overdueDeliverables.length > 0 && (
                <a href="#dash-deliverables" className="alert-warn font-medium">
                  <Clapperboard {...ICON_SM} />
                  <span className="min-w-0 flex-1">
                    มีงานส่งลูกค้าเลยกำหนด {overdueDeliverables.length.toLocaleString('th-TH')} รายการ
                  </span>
                  <ArrowRight {...ICON_SM} />
                </a>
              )}
            </div>
          )}

          {/* ===== ตัวเลขสรุป ===== */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 xl:gap-6">
            <StatLink
              href="#dash-today"
              label={`คิวงาน${dayWord}`}
              value={shown.today_sessions.length.toLocaleString('th-TH')}
              unit="คิว"
              note={shown.today_sessions.length > 0
                ? `${todayJobs.toLocaleString('th-TH')} งาน${capacity > 0 ? ` (รับได้ ${capacity.toLocaleString('th-TH')})` : ''}`
                : undefined}
              icon={CalendarDays}
              bubble="icon-bubble-strong"
              hot
            />
            <StatLink
              href="#dash-next7"
              label="7 วันถัดไป"
              value={shown.next7.length.toLocaleString('th-TH')}
              unit="คิว"
              note={shown.next7.length > 0 ? `${new Set(shown.next7.map(s => s.booking_id)).size.toLocaleString('th-TH')} งาน` : undefined}
              icon={CalendarRange}
            />
            <StatLink
              href="#dash-followups"
              label="ต้องติดตามลูกค้า"
              value={followCount.toLocaleString('th-TH')}
              unit="งาน"
              note={shown.holds_expiring.length > 0 ? `ล็อกคิวใกล้หมด ${shown.holds_expiring.length.toLocaleString('th-TH')}` : undefined}
              icon={CalendarClock}
              bubble={followCount > 0 ? 'icon-bubble-warn' : ''}
            />
            <StatLink
              href="#dash-installments"
              label="งวดชำระเลยกำหนด"
              value={overdueInstallments.length.toLocaleString('th-TH')}
              unit="งวด"
              note={`ถึงกำหนดใน 7 วัน ${shown.installments_due.filter(i => !i.overdue).length.toLocaleString('th-TH')} งวด`}
              icon={Wallet}
              bubble={overdueInstallments.length > 0 ? 'icon-bubble-err' : ''}
              danger={overdueInstallments.length > 0}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6 items-start">
            {/* ===== ซ้าย: คิวงาน ===== */}
            <div className="space-y-4 sm:space-y-6 xl:col-span-2 min-w-0">
              <Section
                id="dash-today"
                title={`คิวงาน${dayWord}`}
                icon={CalendarDays}
                count={shown.today_sessions.length > 0 ? shown.today_sessions.length : undefined}
                action={shown.today_sessions.length > 0 ? (
                  <button type="button" onClick={() => setImageOpen(true)} className="btn-secondary shrink-0 px-3 text-sm">
                    <ImageDown {...ICON_SM} />
                    รูปตารางงาน{dayWord}
                  </button>
                ) : undefined}
              >
                {shown.today_sessions.length === 0 ? (
                  <div className="flex flex-col items-start gap-3 px-4 py-5 sm:px-5">
                    <p className="text-sm text-gray-500">
                      ไม่มีคิวงาน{dayWord}
                      {capacity > 0 ? ` — รับงานได้ ${capacity.toLocaleString('th-TH')} งาน` : ''}
                    </p>
                    <Link href={wedNewBookingHref(day)} prefetch={false} className="btn-secondary px-3 text-sm">
                      <Plus {...ICON_SM} />
                      สร้างงาน{dayWord}
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-3 bg-gray-50 p-3 sm:p-4">
                    {shown.today_sessions.map(s => (
                      <SessionDetailCard key={s.session_id} s={s} today={todayKey} compact />
                    ))}
                  </div>
                )}
              </Section>

              <Section
                id="dash-next7"
                title="คิวงาน 7 วันถัดไป"
                icon={CalendarRange}
                count={shown.next7.length}
                action={(
                  <Link href={wedCalendarHref(addDaysToKey(day, 1))} className="link shrink-0 text-sm">
                    เปิดปฏิทิน
                    <ArrowRight {...ICON_SM} />
                  </Link>
                )}
              >
                <NextSessionsList sessions={shown.next7} />
              </Section>

              {conflicts.length > 0 && (
                <Section id="dash-conflicts" title="ทีมงานชนคิว (30 วันข้างหน้า)" icon={AlertTriangle} count={conflicts.length} tone="danger">
                  <p className="px-4 pt-3 sm:px-5 text-xs text-gray-600">
                    ทีมงานคนเดียวกันถูกจัดลงสองคิวที่เวลาทับกัน — เปิดวันนั้นในปฏิทิน แล้วเข้าไปเปลี่ยนทีมในหน้างาน
                  </p>
                  <ConflictRows items={shownConflicts} lookup={id => sessionIndex.get(id)} />
                  {conflicts.length > CONFLICTS_PREVIEW && (
                    <div className="border-t border-gray-150 px-4 py-1 sm:px-5">
                      <button type="button" onClick={() => setShowAllConflicts(v => !v)} className="btn-ghost -ml-2 px-2 text-sm">
                        {showAllConflicts ? 'แสดงน้อยลง' : `ดูทั้งหมด (${conflicts.length.toLocaleString('th-TH')})`}
                      </button>
                    </div>
                  )}
                </Section>
              )}
            </div>

            {/* ===== ขวา: ติดตาม / เงิน / ส่งงาน / เดือนนี้ ===== */}
            <div className="space-y-4 sm:space-y-6 min-w-0">
              <Section
                id="dash-followups"
                title="ติดตามลูกค้า"
                icon={CalendarClock}
                count={shown.followups.length}
                tone={shown.followups.length > 0 ? 'warn' : 'normal'}
                action={(
                  <Link href="/wedding/bookings" className="link shrink-0 text-sm">
                    งานทั้งหมด
                    <ArrowRight {...ICON_SM} />
                  </Link>
                )}
              >
                <BookingMiniRows items={shown.followups} kind="followup" day={day} emptyText="ไม่มีลูกค้าที่ถึงวันนัดติดตาม" />
              </Section>

              <Section
                id="dash-holds"
                title="ล็อกคิวใกล้หมดเวลา (24 ชม.)"
                icon={Hourglass}
                count={shown.holds_expiring.length}
                tone={shown.holds_expiring.length > 0 ? 'warn' : 'normal'}
              >
                <BookingMiniRows items={shown.holds_expiring} kind="hold" day={day} now={now} emptyText="ไม่มีงานที่ล็อกคิวใกล้หมดเวลา" />
              </Section>

              <Section
                id="dash-installments"
                title="งวดชำระถึงกำหนด"
                icon={Wallet}
                count={shown.installments_due.length}
                tone={overdueInstallments.length > 0 ? 'danger' : 'normal'}
                action={(
                  <Link href="/wedding/payments" className="link shrink-0 text-sm">
                    การเงิน
                    <ArrowRight {...ICON_SM} />
                  </Link>
                )}
              >
                <InstallmentDueRows items={shown.installments_due} day={day} />
              </Section>

              <Section
                id="dash-deliverables"
                title="งานที่ต้องส่งลูกค้า (7 วัน)"
                icon={Clapperboard}
                count={shown.deliverables_due.length}
                tone={overdueDeliverables.length > 0 ? 'warn' : 'normal'}
                action={(
                  <Link href={overdueDeliverables.length > 0 ? '/wedding/deliverables?status=overdue' : '/wedding/deliverables'} className="link shrink-0 text-sm">
                    กระดานส่งงาน
                    <ArrowRight {...ICON_SM} />
                  </Link>
                )}
              >
                <DeliverableDueRows items={shown.deliverables_due} day={day} />
              </Section>

              <Section id="dash-month" title={monthName ? `เดือน${monthName}` : 'เดือนนี้'} icon={CalendarDays}>
                <div className="grid grid-cols-2 gap-2 p-4 sm:p-5">
                  <MonthNumber label="งานที่มีคิวในเดือน" value={shown.month.jobs.toLocaleString('th-TH')} note="งาน (ล็อกคิวขึ้นไป)" />
                  <MonthNumber label="ยืนยันงานใหม่" value={shown.month.bookings_confirmed.toLocaleString('th-TH')} note="งาน (นับตามวันที่ยืนยัน)" />
                  <MonthNumber label="งานเข้าใหม่" value={shown.month.inquiries_new.toLocaleString('th-TH')} note="สร้างงานในเดือนนี้" />
                  {shown.month.revenue !== null && (
                    <MonthNumber label="รายรับสุทธิ" value={baht(shown.month.revenue)} note="รับเงิน − คืนเงิน (ตามวันที่รับ)" />
                  )}
                </div>
              </Section>
            </div>
          </div>
        </div>
      )}

      {imageOpen && shown && (
        <DayImageDialog day={shown.day} sessions={shown.today_sessions} onClose={() => setImageOpen(false)} />
      )}
    </div>
  )
}
