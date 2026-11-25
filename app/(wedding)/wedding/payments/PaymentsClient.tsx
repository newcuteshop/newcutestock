'use client'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import {
  AlertCircle, AlertTriangle, ArrowDownLeft, ArrowUpRight, Banknote, CalendarClock, CalendarDays, ChevronLeft,
  ChevronRight, Image as ImageIcon, Inbox, Info, Printer, ReceiptText, RefreshCw, Wallet, type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import {
  addDaysToKey, baht, bangkokTodayKey, formatThaiDate, formatThaiDateTime, formatThaiDayLong, formatThaiTime, isDayKey,
} from '@/lib/format'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { isMigrationMissing } from '@/lib/migration'
import {
  FIX07_MISSING_MSG, WED_METHOD_LABELS, WED_PAYMENT_KIND_LABELS, WED_PAYMENT_METHODS, WED_PAYMENT_PURPOSES,
  WED_PURPOSE_LABELS, WED_STATUS_CHIP, parseWedToday, thaiMonthYear,
  type WedInstallmentDue, type WedPaymentRow,
} from '@/lib/wedding'
import PrintPortal from '@/components/pos/PrintPortal'
import MigrationNotice from '@/components/pos/MigrationNotice'
import { fmtCount, rpcWithTimeout, wedBookingHref, wedErrorText } from '@/components/wedding/money/wedRpc'
import {
  WED_PAYMENT_COLUMNS, addMonths, isMonthKey, monthRange, moneyTotals, parseWedPaymentRows, recentMonths, signedAmount,
  type PeriodMode,
} from '@/components/wedding/money/paymentRows'
import WedPaymentsPrint from '@/components/wedding/money/WedPaymentsPrint'
import SlipViewDialog from '@/components/wedding/money/SlipViewDialog'

// หน้าการเงินร้าน b.oncloud:
//   (1) รายการรับ-คืนเงินของวัน/เดือน (ตามวันที่เงินเข้า paid_on) + ยอดรวมตามวิธี/รายการ + พิมพ์สรุป 80 มม.
//   (2) งวดที่ต้องตามเก็บ: เลยกำหนด + ถึงกำหนดใน 7 วัน (จาก wed_today — คำนวณงวดที่ชำระแล้วในฐานข้อมูล)
// อ่านตาราง wed_payments ตรงๆ (RLS: พนักงาน b.oncloud) — การเขียนเงินทุกอย่างผ่าน RPC ที่หน้ารายละเอียดงานเท่านั้น
// (รับเงิน/คืนเงิน/ยกเลิกรายการ ทำที่หน้างาน — แตะเลขที่งานในรายการ)

type Filter = 'all' | 'payment' | 'refund' | 'voided'

// กลับมาที่แท็บหลังทิ้งไว้นานกว่านี้ → โหลดใหม่เงียบๆ (มีรายการจากเครื่องอื่น)
const STALE_MS = 60000
// งวดที่ต้องตามเก็บแสดงก่อนกี่รายการ (เลยกำหนดขึ้นก่อน) — ที่เหลือกด "แสดงทั้งหมด"
const DUES_PREVIEW = 5

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'payment', label: 'รับชำระ' },
  { value: 'refund', label: 'คืนเงิน' },
  { value: 'voided', label: 'ยกเลิกแล้ว' },
]

function matchFilter(p: WedPaymentRow, f: Filter): boolean {
  if (f === 'all') return true
  if (f === 'voided') return !!p.voided_at
  if (p.voided_at) return false
  return p.kind === f
}

function periodRange(mode: PeriodMode, key: string): { from: string; to: string } {
  return mode === 'day' ? { from: key, to: key } : monthRange(key)
}

function StatCard({ label, value, sub, icon: Icon, hot }: {
  label: string; value: string; sub?: string; icon: LucideIcon; hot?: boolean
}) {
  return (
    <div className={clsx('stat-card', hot && 'stat-card-hot')}>
      <div className="flex items-start justify-between gap-2">
        <span className={clsx('stat-label min-w-0 pt-1', hot && 'text-gray-600')}>{label}</span>
        <span className={clsx('icon-bubble', hot && 'icon-bubble-strong')}><Icon {...ICON} /></span>
      </div>
      <p className="stat-value">
        <span className="whitespace-nowrap">{value}</span>
        {sub && <span className={clsx('stat-sub', hot && 'text-gray-600')}> <span className="whitespace-nowrap">· {sub}</span></span>}
      </p>
    </div>
  )
}

function SummaryLine({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={clsx('min-w-0', strong ? 'font-semibold text-gray-900' : 'text-gray-600')}>{label}</span>
      <span className={clsx('shrink-0 whitespace-nowrap tabular-nums', strong ? 'money text-base text-gray-900' : 'font-medium text-gray-900')}>
        {value}
      </span>
    </div>
  )
}

function AmountText({ p, className }: { p: WedPaymentRow; className?: string }) {
  const n = signedAmount(p)
  return (
    <span
      className={clsx(
        'money whitespace-nowrap',
        p.voided_at ? 'text-gray-400 line-through' : n < 0 ? 'text-red-700' : 'text-gray-900',
        className,
      )}
    >
      {!p.voided_at && n > 0 ? '+' : ''}{baht(n)}
    </span>
  )
}

export default function PaymentsClient({
  shopName,
  today: initialToday,
  initialMode,
  initialDay,
  initialMonth,
}: {
  shopName: string
  today: string
  initialMode: PeriodMode
  initialDay: string
  initialMonth: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const [today, setToday] = useState(initialToday)
  const [mode, setMode] = useState<PeriodMode>(initialMode)
  const [day, setDay] = useState(initialDay)
  const [month, setMonth] = useState(initialMonth)
  const periodRef = useRef<{ mode: PeriodMode; key: string }>({ mode: initialMode, key: initialMode === 'day' ? initialDay : initialMonth })

  // ----- รายการเงินของช่วง -----
  const [rows, setRows] = useState<WedPaymentRow[]>([])
  const [rowsKey, setRowsKey] = useState('')   // ช่วงของ rows (ระหว่างโหลดช่วงใหม่ ห้ามโชว์ตัวเลขช่วงเก่าใต้หัวช่วงใหม่)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const reqRef = useRef(0)
  const loadedAtRef = useRef(0)

  // ----- งวดที่ต้องตามเก็บ -----
  const [dues, setDues] = useState<WedInstallmentDue[]>([])
  const [duesLoaded, setDuesLoaded] = useState(false)
  const [duesError, setDuesError] = useState('')
  const [showAllDues, setShowAllDues] = useState(false)
  const duesReqRef = useRef(0)

  const [slipRow, setSlipRow] = useState<WedPaymentRow | null>(null)
  const [printing, setPrinting] = useState(false)
  const [printedAt, setPrintedAt] = useState('')

  // ---------- โหลดรายการเงินของช่วง ----------
  const loadPeriod = useCallback(async (m: PeriodMode, key: string, silent = false) => {
    const id = ++reqRef.current
    periodRef.current = { mode: m, key }
    if (!silent) {
      setLoading(true)
      setError('')
    }
    // error ตัวจริงจาก PostgREST (มีรหัส) — fetchAllRows โยนแค่ข้อความที่แปลแล้ว ใช้ตัดสินว่า "ยังไม่ได้รันไฟล์ SQL" ไม่ได้
    let rawError: unknown = null
    try {
      const r = periodRange(m, key)
      const data = await fetchAllRows<unknown>(async (a, b) => {
        const res = await supabase
          .from('wed_payments')
          .select(WED_PAYMENT_COLUMNS)
          .gte('paid_on', r.from)
          .lte('paid_on', r.to)
          .order('paid_on', { ascending: false })
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(a, b)
        if (res.error) rawError = rawError ?? res.error
        return res
      })
      if (id !== reqRef.current) return
      setRows(parseWedPaymentRows(data))
      setRowsKey(`${m}|${key}`)
      setError('')
      setMissing(false)
      loadedAtRef.current = Date.now()
    } catch (err) {
      if (id !== reqRef.current) return
      if (isMigrationMissing(rawError ?? err)) {
        setMissing(true)
        return
      }
      if (!silent) {
        setRows([])
        setRowsKey('')
        setError(wedErrorText(rawError ?? err))
      }
    } finally {
      if (id === reqRef.current) setLoading(false)
    }
  }, [supabase])

  // ---------- งวดที่ต้องตามเก็บ (เลยกำหนด + ถึงกำหนดใน 7 วัน) ----------
  const loadDues = useCallback(async (silent = false) => {
    const id = ++duesReqRef.current
    if (!silent) setDuesError('')
    const res = await rpcWithTimeout(supabase, 'wed_today', {})
    if (id !== duesReqRef.current) return
    if (res.error) {
      if (!silent) setDuesError(wedErrorText(res.error))
      return
    }
    const list = parseWedToday(res.data).installments_due
    // เลยกำหนดก่อน แล้วตามวันครบกำหนด
    list.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due_date ?? '').localeCompare(b.due_date ?? ''))
    setDues(list)
    setDuesLoaded(true)
    setDuesError('')
  }, [supabase])

  useEffect(() => {
    void loadPeriod(periodRef.current.mode, periodRef.current.key)
    void loadDues()
  }, [loadPeriod, loadDues])

  // เขียนช่วงลง URL (?day= / ?month=) — โหลดหน้าใหม่แล้วยังอยู่ที่เดิม ; วันนี้ = ไม่ใส่
  const syncUrl = useCallback((m: PeriodMode, key: string, todayKey: string) => {
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('day')
      url.searchParams.delete('month')
      if (m === 'month') url.searchParams.set('month', key)
      else if (key !== todayKey) url.searchParams.set('day', key)
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    } catch {
      // แก้ URL ไม่ได้ ไม่เป็นไร — แค่โหลดหน้าใหม่แล้วกลับไปค่าเริ่มต้น
    }
  }, [])

  function go(m: PeriodMode, rawKey: string) {
    const t = bangkokTodayKey()
    setToday(t)
    const thisMonth = t.slice(0, 7)
    let key = rawKey
    if (m === 'day') {
      if (!isDayKey(key)) return
      if (key > t) key = t
      setDay(key)
    } else {
      if (!isMonthKey(key)) return
      if (key > thisMonth) key = thisMonth
      setMonth(key)
    }
    setMode(m)
    if (periodRef.current.mode === m && periodRef.current.key === key && rowsKey === `${m}|${key}`) return
    setFilter('all')
    syncUrl(m, key, t)
    void loadPeriod(m, key)
  }

  // กลับมาที่แท็บ: อัปเดต "วันนี้" + โหลดใหม่เงียบๆ เมื่อทิ้งไว้นาน (ไม่ทำระหว่างเปิดดูสลิป)
  const slipOpenRef = useRef(false)
  slipOpenRef.current = slipRow !== null
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      const t = bangkokTodayKey()
      setToday(k => (t > k ? t : k))
      if (slipOpenRef.current) return
      if (Date.now() - loadedAtRef.current > STALE_MS) {
        void loadPeriod(periodRef.current.mode, periodRef.current.key, true)
        void loadDues(true)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loadPeriod, loadDues])

  // ---------- คำนวณ ----------
  const periodKey = mode === 'day' ? day : month
  const shown = rowsKey === `${mode}|${periodKey}` && !error
  const totals = useMemo(() => moneyTotals(shown ? rows : []), [rows, shown])
  const visibleRows = shown ? rows.filter(r => matchFilter(r, filter)) : []
  const thisMonth = today.slice(0, 7)
  const isCurrent = mode === 'day' ? day === today : month === thisMonth
  const periodText = mode === 'day' ? formatThaiDayLong(day) : thaiMonthYear(month)
  const methodsShown = WED_PAYMENT_METHODS.filter(m => m === 'cash' || totals.by_method[m].count > 0)
  const purposesShown = WED_PAYMENT_PURPOSES.filter(p => totals.by_purpose[p].count > 0)
  const months = useMemo(() => {
    const list = recentMonths(thisMonth, 36)
    return list.includes(month) ? list : [month, ...list]
  }, [thisMonth, month])
  const overdueDues = dues.filter(d => d.overdue)
  const overdueTotal = overdueDues.reduce((s, d) => s + d.amount_remaining, 0)

  function startPrint() {
    if (!shown || printing) return
    setPrintedAt(new Date().toISOString())
    setPrinting(true)
  }

  if (missing) return <MigrationNotice title="การเงิน" message={FIX07_MISSING_MSG} />

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">การเงิน</h1>
          <p className="page-subtitle">รายการรับ-คืนเงินรายวัน/รายเดือน งวดที่ต้องตามเก็บ และพิมพ์สรุปยอด</p>
        </div>
        <div className="page-actions">
          <button type="button" onClick={startPrint} disabled={!shown || loading} className="btn-secondary w-full sm:w-auto">
            <Printer {...ICON_SM} />
            {mode === 'day' ? 'พิมพ์สรุปยอดวัน' : 'พิมพ์สรุปยอดเดือน'}
          </button>
        </div>
      </div>

      {/* ===== งวดที่ต้องตามเก็บ ===== */}
      <section className={clsx('card overflow-hidden', overdueDues.length > 0 && 'border-red-200')} aria-labelledby="wp-dues-title">
        <div className="card-header flex-wrap gap-2">
          <h2 id="wp-dues-title" className="section-title">
            <CalendarClock {...ICON} />
            งวดที่ต้องตามเก็บ
          </h2>
          <div className="flex items-center gap-2">
            {overdueDues.length > 0 && (
              <span className="badge-out tabular-nums">เลยกำหนด {fmtCount(overdueDues.length)} งวด · {baht(overdueTotal)}</span>
            )}
            <button type="button" onClick={() => void loadDues()} className="btn-icon btn-icon-plain" aria-label="โหลดงวดที่ต้องตามเก็บใหม่">
              <RefreshCw {...ICON_SM} />
            </button>
          </div>
        </div>
        {duesError ? (
          <div className="p-4 sm:p-5">
            <div role="alert" className="alert-err">
              <AlertCircle {...ICON_SM} />
              <p className="min-w-0 break-words">{duesError}</p>
            </div>
          </div>
        ) : !duesLoaded ? (
          <div className="p-4 sm:p-5 space-y-2" role="status">
            <span className="sr-only">กำลังโหลดงวดที่ต้องตามเก็บ...</span>
            {[0, 1].map(i => <div key={i} className="skeleton h-12 rounded-lg" />)}
          </div>
        ) : dues.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-500 sm:px-5">ไม่มีงวดที่เลยกำหนด หรือถึงกำหนดใน 7 วันข้างหน้า</p>
        ) : (
          <>
          <ul className="divide-y divide-gray-150">
            {(showAllDues ? dues : dues.slice(0, DUES_PREVIEW)).map(d => (
              <li key={`${d.booking_id}-${d.installment_id ?? d.seq}`}>
                <Link
                  href={wedBookingHref(d.booking_id)}
                  prefetch={false}
                  className="flex min-h-[56px] items-center gap-3 px-4 py-3 transition-colors active:bg-gray-100 sm:px-5 [@media(hover:hover)]:hover:bg-gray-50"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium text-gray-900 break-words">{d.couple_names || '-'}</span>
                      <span className={WED_STATUS_CHIP[d.status]}>{d.status_label}</span>
                    </p>
                    <p className="text-xs text-gray-600 tabular-nums break-words">
                      <span className="font-mono">{d.booking_no}</span> · {d.label || `งวดที่ ${d.seq}`}
                      {d.due_date ? ` · ครบกำหนด ${formatThaiDate(d.due_date)}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={clsx('money text-sm', d.overdue ? 'text-red-700' : 'text-gray-900')}>{baht(d.amount_remaining)}</p>
                    {d.overdue
                      ? <span className="badge-out">เลยกำหนด</span>
                      : <span className="chip-outline">{d.due_date === today ? 'วันนี้' : 'ใกล้ถึงกำหนด'}</span>}
                  </div>
                  <ChevronRight {...ICON_SM} className="shrink-0 text-gray-400" />
                </Link>
              </li>
            ))}
          </ul>
          {dues.length > DUES_PREVIEW && (
            <div className="border-t border-gray-150 px-4 py-3 sm:px-5">
              <button type="button" onClick={() => setShowAllDues(v => !v)} className="btn-secondary w-full sm:w-auto" aria-expanded={showAllDues}>
                {showAllDues ? 'แสดงน้อยลง' : `แสดงทั้งหมด ${fmtCount(dues.length)} งวด`}
              </button>
            </div>
          )}
          </>
        )}
      </section>

      {/* ===== เลือกช่วง ===== */}
      <div className="card space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="ดูแบบ">
          <button type="button" className="chip-toggle lift-hover lift-tab" aria-pressed={mode === 'day'} onClick={() => go('day', day)}>
            <CalendarDays {...ICON_XS} />
            รายวัน
          </button>
          <button type="button" className="chip-toggle lift-hover lift-tab" aria-pressed={mode === 'month'} onClick={() => go('month', month)}>
            <CalendarClock {...ICON_XS} />
            รายเดือน
          </button>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => (mode === 'day' ? go('day', addDaysToKey(day, -1)) : go('month', addMonths(month, -1)))}
              className="btn-icon shrink-0"
              aria-label={mode === 'day' ? 'วันก่อนหน้า' : 'เดือนก่อนหน้า'}
            >
              <ChevronLeft {...ICON} />
            </button>
            {mode === 'day' ? (
              <input
                type="date"
                className="input min-w-0 flex-1 tabular-nums sm:w-44 sm:flex-none"
                value={day}
                max={today}
                onChange={e => { if (e.target.value) go('day', e.target.value) }}
                aria-label="เลือกวัน"
                aria-describedby="wp-period-caption"
              />
            ) : (
              <select
                className="input min-w-0 flex-1 sm:w-52 sm:flex-none"
                value={month}
                onChange={e => go('month', e.target.value)}
                aria-label="เลือกเดือน"
                aria-describedby="wp-period-caption"
              >
                {months.map(m => <option key={m} value={m}>{thaiMonthYear(m)}</option>)}
              </select>
            )}
            <button
              type="button"
              onClick={() => (mode === 'day' ? go('day', addDaysToKey(day, 1)) : go('month', addMonths(month, 1)))}
              disabled={isCurrent}
              className="btn-icon shrink-0"
              aria-label={mode === 'day' ? 'วันถัดไป' : 'เดือนถัดไป'}
            >
              <ChevronRight {...ICON} />
            </button>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <p id="wp-period-caption" className="min-w-0 text-sm font-semibold text-gray-900 sm:text-base">
              {periodText}
              {isCurrent && <span className="chip ml-2 align-middle">{mode === 'day' ? 'วันนี้' : 'เดือนนี้'}</span>}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              {!isCurrent && (
                <button type="button" onClick={() => go(mode, mode === 'day' ? today : thisMonth)} className="btn-secondary px-3">
                  {mode === 'day' ? 'วันนี้' : 'เดือนนี้'}
                </button>
              )}
              <button
                type="button"
                onClick={() => void loadPeriod(mode, periodKey)}
                disabled={loading}
                className="btn-icon"
                aria-label="โหลดรายการใหม่"
                title="โหลดรายการใหม่"
              >
                <RefreshCw {...ICON_SM} className={loading ? 'animate-spin' : undefined} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {error ? (
        <div role="alert" className="alert-err">
          <AlertCircle {...ICON_SM} />
          <div className="min-w-0 space-y-2">
            <p className="break-words">{error}</p>
            <button type="button" onClick={() => void loadPeriod(mode, periodKey)} className="btn-secondary bg-white px-4 text-sm">
              <RefreshCw {...ICON_SM} />
              ลองอีกครั้ง
            </button>
          </div>
        </div>
      ) : !shown ? (
        <div className="space-y-4" role="status">
          <span className="sr-only">กำลังโหลดรายการเงิน...</span>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="stat-card">
                <div className="skeleton h-4 w-20" />
                <div className="skeleton h-7 w-24" />
              </div>
            ))}
          </div>
          <div className="skeleton h-48 rounded-xl" />
        </div>
      ) : (
        <div aria-busy={loading} className={clsx('space-y-4 sm:space-y-6', loading && 'opacity-60')}>
          {/* การ์ดสรุป */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:gap-6" aria-live="polite">
            <StatCard label="รับชำระ" value={baht(totals.payments.amount)} sub={`${fmtCount(totals.payments.count)} รายการ`} icon={ArrowDownLeft} />
            <StatCard label="คืนเงิน" value={baht(totals.refunds.amount)} sub={totals.refunds.count > 0 ? `${fmtCount(totals.refunds.count)} รายการ` : undefined} icon={ArrowUpRight} />
            <StatCard label={mode === 'day' ? 'เงินสดเข้าลิ้นชัก' : 'เงินสดสุทธิ'} value={baht(totals.by_method.cash.net)} icon={Banknote} />
            <StatCard label="รับสุทธิ" value={baht(totals.net)} icon={Wallet} hot />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
            {/* แยกตามวิธี */}
            <section className="card min-w-0 space-y-3 p-4 sm:p-5" aria-labelledby="wp-method-title">
              <h2 id="wp-method-title" className="section-title">
                <Banknote {...ICON} />
                แยกตามวิธีชำระ
              </h2>
              <div className="table-wrap">
                <table className="table-soft min-w-[320px]">
                  <thead>
                    <tr>
                      <th>วิธี</th>
                      <th className="text-right">รับ</th>
                      <th className="text-right">คืน</th>
                      <th className="text-right">สุทธิ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {methodsShown.map(m => {
                      const t = totals.by_method[m]
                      return (
                        <tr key={m}>
                          <td className="whitespace-nowrap">
                            {WED_METHOD_LABELS[m]}
                            <span className="ml-1 text-xs text-gray-500 tabular-nums">({fmtCount(t.count)})</span>
                          </td>
                          <td className="text-right tabular-nums whitespace-nowrap">{baht(t.in)}</td>
                          <td className="text-right tabular-nums whitespace-nowrap">{t.out > 0 ? `-${baht(t.out)}` : baht(0)}</td>
                          <td className={clsx('text-right font-semibold tabular-nums whitespace-nowrap', t.net < 0 ? 'text-red-700' : 'text-gray-900')}>
                            {baht(t.net)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {mode === 'day' && (
                <div className="panel p-3 text-sm">
                  <SummaryLine label={isCurrent ? 'เงินสดที่ควรเพิ่มในลิ้นชักวันนี้' : 'เงินสดที่ควรเพิ่มในลิ้นชักของวันนั้น'} value={baht(totals.by_method.cash.net)} strong />
                  <p className="mt-1 text-xs text-gray-500">= รับเงินสด − คืนเป็นเงินสด (ยังไม่รวมเงินทอนตั้งต้น)</p>
                </div>
              )}
            </section>

            {/* แยกตามรายการ */}
            <section className="card min-w-0 space-y-3 p-4 sm:p-5" aria-labelledby="wp-purpose-title">
              <h2 id="wp-purpose-title" className="section-title">
                <ReceiptText {...ICON} />
                รับชำระแยกตามรายการ
              </h2>
              {purposesShown.length === 0 ? (
                <p className="panel p-3 text-sm text-gray-500">ยังไม่มีการรับชำระใน{mode === 'day' ? 'วันนี้' : 'เดือนนี้'}</p>
              ) : (
                <div className="panel space-y-1.5 p-3 text-sm">
                  {purposesShown.map(p => (
                    <SummaryLine
                      key={p}
                      label={`${WED_PURPOSE_LABELS[p]} (${fmtCount(totals.by_purpose[p].count)})`}
                      value={baht(totals.by_purpose[p].amount)}
                    />
                  ))}
                  {totals.refunds.count > 0 && (
                    <SummaryLine label={`คืนเงิน (${fmtCount(totals.refunds.count)})`} value={`-${baht(totals.refunds.amount)}`} />
                  )}
                  <hr className="divider !my-2" />
                  <SummaryLine label="รับสุทธิ" value={baht(totals.net)} strong />
                </div>
              )}
              {totals.voided.count > 0 && (
                <p className="text-xs text-gray-600">
                  ยกเลิกแล้ว {fmtCount(totals.voided.count)} รายการ ({baht(totals.voided.amount)}) — ไม่นับในยอด
                </p>
              )}
              <p className="flex items-start gap-1.5 text-xs text-gray-500">
                <Info {...ICON_XS} className="mt-px shrink-0" />
                <span className="min-w-0">นับตามวันที่รับ/คืนเงินจริงที่บันทึกไว้ (ตรงกับรายงานรายรับ)</span>
              </p>
            </section>
          </div>

          {/* ยอดรายวันของเดือน */}
          {mode === 'month' && (
            <section className="card overflow-hidden" aria-labelledby="wp-days-title">
              <div className="card-header">
                <h2 id="wp-days-title" className="section-title">
                  <CalendarDays {...ICON} />
                  ยอดรายวัน
                </h2>
                <span className="chip tabular-nums">{fmtCount(totals.by_day.length)} วันที่มีรายการ</span>
              </div>
              {totals.by_day.length === 0 ? (
                <p className="px-4 py-4 text-sm text-gray-500 sm:px-5">ไม่มีรายการเงินในเดือนนี้</p>
              ) : (
                <div className="table-wrap">
                  <table className="table-soft min-w-[420px]">
                    <thead>
                      <tr>
                        <th>วันที่</th>
                        <th className="text-right">รายการ</th>
                        <th className="text-right">รับ</th>
                        <th className="text-right">คืน</th>
                        <th className="text-right">สุทธิ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...totals.by_day].reverse().map(d => (
                        <tr key={d.day}>
                          <td className="whitespace-nowrap">
                            <button type="button" onClick={() => go('day', d.day)} className="link tabular-nums">
                              {formatThaiDate(d.day)}
                            </button>
                          </td>
                          <td className="text-right tabular-nums">{fmtCount(d.count)}</td>
                          <td className="text-right tabular-nums whitespace-nowrap">{baht(d.in)}</td>
                          <td className="text-right tabular-nums whitespace-nowrap">{d.out > 0 ? `-${baht(d.out)}` : baht(0)}</td>
                          <td className={clsx('text-right font-semibold tabular-nums whitespace-nowrap', d.net < 0 ? 'text-red-700' : 'text-gray-900')}>
                            {baht(d.net)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* รายการ */}
          <section className="card overflow-hidden" aria-labelledby="wp-list-title">
            <div className="card-header flex-wrap gap-2">
              <h2 id="wp-list-title" className="section-title">
                <Wallet {...ICON} />
                {mode === 'day' ? (isCurrent ? 'รายการเงินวันนี้' : `รายการเงินวันที่ ${formatThaiDate(day)}`) : `รายการเงิน ${thaiMonthYear(month)}`}
              </h2>
              <span className="chip tabular-nums">{fmtCount(rows.length)} รายการ</span>
            </div>
            <div className="flex gap-2 overflow-x-auto scrollbar-none border-b border-gray-150 px-4 py-3 sm:flex-wrap sm:px-5" role="group" aria-label="กรองรายการ">
              {FILTERS.map(f => (
                <button key={f.value} type="button" className="chip-toggle lift-hover lift-tab" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
                  {f.label}
                </button>
              ))}
            </div>

            {visibleRows.length === 0 ? (
              <div className="empty-state">
                <span className="icon-bubble icon-bubble-lg"><Inbox size={28} strokeWidth={1.75} aria-hidden="true" /></span>
                <p className="empty-state-title">
                  {rows.length === 0 ? (mode === 'day' ? 'ไม่มีรายการเงินในวันนี้' : 'ไม่มีรายการเงินในเดือนนี้') : 'ไม่มีรายการตามที่กรอง'}
                </p>
                {rows.length === 0 && <p className="text-sm text-gray-500">รับเงิน/คืนเงินได้ที่หน้ารายละเอียดของแต่ละงาน</p>}
              </div>
            ) : (
              <>
                {/* มือถือ */}
                <ul className="md:hidden divide-y divide-gray-150">
                  {visibleRows.map(p => (
                    <li key={p.id} className="flex items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="text-sm text-gray-900">
                          {WED_PAYMENT_KIND_LABELS[p.kind]}
                          {p.purpose && <span className="text-gray-600"> ({WED_PURPOSE_LABELS[p.purpose]})</span>}
                          <span className="text-gray-500"> · {WED_METHOD_LABELS[p.method]}</span>
                        </p>
                        <p className="text-xs text-gray-500 tabular-nums break-all">
                          {mode === 'month' && p.paid_on ? `${formatThaiDate(p.paid_on)} · ` : ''}
                          บันทึก {formatThaiTime(p.created_at)}
                          {p.receipt_no ? ` · ${p.receipt_no}` : ''}
                        </p>
                        {p.booking_id && (
                          // เลขที่งานห้ามหักกลาง (ชื่อคู่ยาวๆ ขึ้นบรรทัดใหม่แทน) · แตะได้สูง 44px
                          <Link href={wedBookingHref(p.booking_id)} prefetch={false} className="-my-1 flex min-h-[44px] flex-wrap items-center gap-x-1 py-1 text-xs text-brand-700">
                            <span className="whitespace-nowrap font-mono">{p.booking_no}</span>
                            {p.couple_names ? <span className="min-w-0 break-words text-gray-700">· {p.couple_names}</span> : null}
                          </Link>
                        )}
                        {p.voided_at && p.void_reason && <p className="text-xs text-gray-500 break-words">เหตุผลยกเลิก: {p.void_reason}</p>}
                        {p.slip_path && (
                          <button type="button" onClick={() => setSlipRow(p)} className="btn-ghost -ml-2 px-2 text-xs">
                            <ImageIcon {...ICON_XS} />
                            ดูสลิป
                          </button>
                        )}
                      </div>
                      <div className="shrink-0 space-y-1 text-right">
                        <AmountText p={p} />
                        {p.voided_at && <div><span className="badge-out">ยกเลิกแล้ว</span></div>}
                      </div>
                    </li>
                  ))}
                </ul>

                {/* จอกว้าง */}
                <div className="hidden md:block table-wrap">
                  <table className="table-soft min-w-[820px]">
                    <thead>
                      <tr>
                        <th>{mode === 'day' ? 'เวลาบันทึก' : 'วันที่รับ/คืน'}</th>
                        <th>เลขที่ใบเสร็จ</th>
                        <th>งาน / คู่บ่าวสาว</th>
                        <th>รายการ</th>
                        <th>วิธี</th>
                        <th className="text-right">จำนวนเงิน</th>
                        <th>ผู้บันทึก</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map(p => (
                        <tr key={p.id}>
                          <td className="whitespace-nowrap text-xs text-gray-500 tabular-nums">
                            {mode === 'month' && p.paid_on
                              ? <span className="block text-sm text-gray-700">{formatThaiDate(p.paid_on)}</span>
                              : null}
                            {mode === 'day' ? formatThaiTime(p.created_at) : `บันทึก ${formatThaiDateTime(p.created_at)}`}
                          </td>
                          <td className="whitespace-nowrap font-mono text-xs text-gray-700">{p.receipt_no ?? '-'}</td>
                          <td className="min-w-[180px]">
                            {p.booking_id ? (
                              <Link href={wedBookingHref(p.booking_id)} prefetch={false} className="link min-h-0 font-mono text-xs">
                                {p.booking_no || 'เปิดงาน'}
                              </Link>
                            ) : <span className="text-xs text-gray-400">-</span>}
                            {p.couple_names && <span className="block text-sm text-gray-700 break-words">{p.couple_names}</span>}
                          </td>
                          <td className="text-sm">
                            <span className="block whitespace-nowrap text-gray-900">
                              {WED_PAYMENT_KIND_LABELS[p.kind]}{p.purpose ? ` · ${WED_PURPOSE_LABELS[p.purpose]}` : ''}
                            </span>
                            {p.voided_at && <span className="badge-out">ยกเลิกแล้ว</span>}
                            {p.voided_at && p.void_reason && <span className="block text-xs text-gray-500 break-words">เหตุผล: {p.void_reason}</span>}
                            {p.note && <span className="block text-xs text-gray-500 break-words">{p.note}</span>}
                          </td>
                          <td className="whitespace-nowrap text-sm text-gray-600">
                            {WED_METHOD_LABELS[p.method]}
                            {p.slip_path && (
                              <button type="button" onClick={() => setSlipRow(p)} className="link min-h-0 block text-xs">
                                ดูสลิป
                              </button>
                            )}
                          </td>
                          <td className="text-right"><AmountText p={p} /></td>
                          <td className="min-w-[7rem] text-xs text-gray-500 break-words">{p.created_by_name ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <p className="flex items-start gap-1.5 border-t border-gray-150 px-4 py-3 text-xs text-gray-500 sm:px-5">
              <AlertTriangle {...ICON_XS} className="mt-px shrink-0" />
              <span className="min-w-0">รับเงิน คืนเงิน และยกเลิกรายการ ทำที่หน้ารายละเอียดงาน (แตะเลขที่งาน) — หน้านี้ใช้ดูและสรุปยอดเท่านั้น</span>
            </p>
          </section>
        </div>
      )}

      {slipRow && <SlipViewDialog row={slipRow} supabase={supabase} onClose={() => setSlipRow(null)} />}

      <PrintPortal open={printing} paper="80" onDone={() => setPrinting(false)}>
        <WedPaymentsPrint
          shopName={shopName}
          mode={mode}
          periodKey={periodKey}
          rows={shown ? rows : []}
          totals={totals}
          printedAt={printedAt || new Date().toISOString()}
        />
      </PrintPortal>
    </div>
  )
}
