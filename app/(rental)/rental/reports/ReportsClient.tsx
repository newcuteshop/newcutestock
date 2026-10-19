'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import {
  AlertCircle, AlertTriangle, BarChart3, CalendarRange, CheckCircle2, ClipboardList, CreditCard, Hourglass, RefreshCw,
  ShieldCheck, Shirt, TrendingUp, Wallet, X, XCircle, type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import {
  addDaysToKey, baht, bangkokTodayKey, daysBetweenKeys, formatThaiDate, formatThaiDayLong, isDayKey,
} from '@/lib/format'
import { round2, sumBy } from '@/lib/money'
import { isMigrationMissing } from '@/lib/migration'
import {
  CHARGE_KIND_LABELS, FIX06_MISSING_MSG, METHOD_LABELS, parseReport, RENTAL_CASH_METHODS, RENTAL_CHARGE_KINDS,
  RENTAL_SOURCES, SOURCE_LABELS, type RentalReport,
} from '@/lib/rental'
import MigrationNotice from '@/components/pos/MigrationNotice'
import IncomeChart, { type IncomeBucket } from '@/components/rental/money/IncomeChart'
import RentalExportButton from '@/components/rental/money/RentalExportButton'
import { fmtCount, rentalErrorText } from '@/components/rental/money/moneyRows'

// รายงานร้านเช่าชุด (rental_report): รายรับตามวันที่รับเงินจริง (เงินประกันรับ/คืนไม่นับเป็นรายได้ · หักเงินประกันนับเป็นรายได้วันที่หัก)
// ช่วงวันที่ไม่เกิน 1 ปี · กราฟ ≤ 62 วัน = รายวัน, ยาวกว่านั้น = รายเดือน (แท่งรายวันเกินร้อยแท่งอ่านไม่ออกบนมือถือ)
// ส่งออก CSV ใช้ช่วงวันที่เดียวกับที่ดูอยู่

const MAX_DAYS = 366
const DAILY_MAX = 62
const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const THAI_MONTHS_LONG = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']

type PresetKey = 'today' | '7d' | '30d' | 'month' | 'prevMonth' | 'year'
const PRESETS: readonly { key: PresetKey; label: string }[] = [
  { key: 'today', label: 'วันนี้' },
  { key: '7d', label: '7 วัน' },
  { key: '30d', label: '30 วัน' },
  { key: 'month', label: 'เดือนนี้' },
  { key: 'prevMonth', label: 'เดือนก่อน' },
  { key: 'year', label: 'ปีนี้' },
]

function presetRange(key: PresetKey, today: string): { from: string; to: string } {
  const monthStart = `${today.slice(0, 8)}01`
  switch (key) {
    case 'today':
      return { from: today, to: today }
    case '7d':
      return { from: addDaysToKey(today, -6), to: today }
    case '30d':
      return { from: addDaysToKey(today, -29), to: today }
    case 'prevMonth': {
      const lastOfPrev = addDaysToKey(monthStart, -1)
      return { from: `${lastOfPrev.slice(0, 8)}01`, to: lastOfPrev }
    }
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today }
    case 'month':
    default:
      return { from: monthStart, to: today }
  }
}

function matchPreset(from: string, to: string, today: string): PresetKey | null {
  for (const p of PRESETS) {
    const r = presetRange(p.key, today)
    if (r.from === from && r.to === to) return p.key
  }
  return null
}

function rangeProblem(from: string, to: string, today: string): string | null {
  if (!isDayKey(from)) return 'กรุณาเลือกวันที่เริ่มต้น'
  if (!isDayKey(to)) return 'กรุณาเลือกวันที่สิ้นสุด'
  if (from > to) return 'วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด'
  if (to > today) return 'เลือกได้ถึงวันนี้เท่านั้น'
  const days = daysBetweenKeys(from, to) + 1
  if (days > MAX_DAYS) return `เลือกช่วงได้ไม่เกิน 1 ปี — ตอนนี้เลือกไว้ ${fmtCount(days)} วัน`
  return null
}

// แท่งกราฟ: ใส่วันที่ไม่มีรายการเป็น 0 ให้ครบช่วง (ฐานข้อมูลอาจส่งมาเฉพาะวันที่มีเงินเข้า-ออก)
function buildBuckets(from: string, to: string, report: RentalReport): IncomeBucket[] {
  const byDay: Record<string, { payment: number; refund: number; net: number }> = {}
  for (const d of report.income.by_day) {
    const cur = byDay[d.day] ?? { payment: 0, refund: 0, net: 0 }
    byDay[d.day] = { payment: cur.payment + d.payment, refund: cur.refund + d.refund, net: cur.net + d.net }
  }
  const days = daysBetweenKeys(from, to) + 1
  if (!Number.isFinite(days) || days <= 0) return []
  const out: IncomeBucket[] = []
  if (days <= DAILY_MAX) {
    for (let i = 0; i < days; i++) {
      const k = addDaysToKey(from, i)
      const v = byDay[k] ?? { payment: 0, refund: 0, net: 0 }
      const m = Number(k.slice(5, 7))
      out.push({
        key: k,
        label: `${Number(k.slice(8, 10))} ${THAI_MONTHS_SHORT[m - 1] ?? ''}`,
        title: formatThaiDayLong(k),
        payment: round2(v.payment),
        refund: round2(v.refund),
        net: round2(v.net),
      })
    }
    return out
  }
  // รายเดือน
  const index: Record<string, number> = {}
  for (let i = 0; i < days; i++) {
    const k = addDaysToKey(from, i)
    const mk = k.slice(0, 7)
    if (index[mk] === undefined) {
      const y = Number(k.slice(0, 4)) + 543
      const m = Number(k.slice(5, 7))
      index[mk] = out.length
      out.push({
        key: mk,
        label: `${THAI_MONTHS_SHORT[m - 1] ?? ''} ${String(y).slice(-2)}`,
        title: `${THAI_MONTHS_LONG[m - 1] ?? ''} ${y}`,
        payment: 0,
        refund: 0,
        net: 0,
      })
    }
    const v = byDay[k]
    if (v) {
      const b = out[index[mk]]
      b.payment += v.payment
      b.refund += v.refund
      b.net += v.net
    }
  }
  for (const b of out) {
    b.payment = round2(b.payment)
    b.refund = round2(b.refund)
    b.net = round2(b.net)
  }
  return out
}

function StatCard({ label, value, sub, icon: Icon, hot, wide }: {
  label: string; value: string; sub?: string; icon: LucideIcon; hot?: boolean; wide?: boolean
}) {
  return (
    <div className={clsx('stat-card', hot && 'stat-card-hot', wide && 'col-span-2 lg:col-span-1')}>
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

// แถบสัดส่วนแนวนอน (ไม่ใช้สีอย่างเดียว — ตัวเลขอยู่ข้างแถบเสมอ)
function ShareBar({ pct }: { pct: number }) {
  const w = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0))
  return (
    <span className="block h-2 w-full overflow-hidden rounded-full bg-gray-150" aria-hidden="true">
      <span className="block h-full rounded-full bg-brand-400" style={{ width: `${w}%` }} />
    </span>
  )
}

export default function ReportsClient({
  today: initialToday,
  initialFrom,
  initialTo,
  initialReport,
  initialError,
  initialMissing,
}: {
  today: string
  initialFrom: string
  initialTo: string
  initialReport: RentalReport | null
  initialError: string
  initialMissing: boolean
}) {
  const supabase = useMemo(() => createClient(), [])
  const [today, setToday] = useState(initialToday)
  // ช่วงที่แสดงอยู่ (ตรงกับ report) และช่วงที่กำลังเลือก (ช่องกรอกวันที่)
  const [range, setRange] = useState({ from: initialFrom, to: initialTo })
  const [draftFrom, setDraftFrom] = useState(initialFrom)
  const [draftTo, setDraftTo] = useState(initialTo)
  const [report, setReport] = useState<RentalReport | null>(initialReport)
  const [reportRange, setReportRange] = useState(initialReport ? { from: initialFrom, to: initialTo } : null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(initialError)
  const [missing, setMissing] = useState(initialMissing)
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const reqRef = useRef(0)

  const load = useCallback(async (from: string, to: string) => {
    const id = ++reqRef.current
    setRange({ from, to })
    setLoading(true)
    setError('')
    try {
      const { data, error: rpcError } = await supabase.rpc('rental_report', { p_from: from, p_to: to })
      if (id !== reqRef.current) return
      if (rpcError) {
        if (isMigrationMissing(rpcError)) setMissing(true)
        else setError(rentalErrorText(rpcError))
        return
      }
      setMissing(false)
      setReport(parseReport(data))
      setReportRange({ from, to })
    } catch (err) {
      if (id === reqRef.current) setError(rentalErrorText(err))
    } finally {
      if (id === reqRef.current) setLoading(false)
    }
  }, [supabase])

  // เขียนช่วงวันที่ลง URL — โหลดหน้าใหม่/ส่งลิงก์ให้คนอื่นแล้วได้ช่วงเดิม
  const syncUrl = useCallback((from: string, to: string) => {
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('from', from)
      url.searchParams.set('to', to)
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    } catch {
      // แก้ URL ไม่ได้ ไม่เป็นไร
    }
  }, [])

  function apply(from: string, to: string) {
    const t = bangkokTodayKey()
    setToday(t)
    setDraftFrom(from)
    setDraftTo(to)
    if (rangeProblem(from, to, t)) return
    setExportMsg(null)
    syncUrl(from, to)
    void load(from, to)
  }

  function choosePreset(key: PresetKey) {
    const t = bangkokTodayKey()
    const r = presetRange(key, t)
    apply(r.from, r.to)
  }

  // ทิ้งหน้าไว้ข้ามเที่ยงคืน → "วันนี้" ของปุ่มลัดเลื่อนตาม
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') setToday(bangkokTodayKey())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const draftProblem = rangeProblem(draftFrom, draftTo, today)
  const draftDirty = draftFrom !== range.from || draftTo !== range.to
  const activePreset = matchPreset(range.from, range.to, today)
  const shownReport = report && reportRange && reportRange.from === range.from && reportRange.to === range.to ? report : null
  const stale = report !== null && shownReport === null // กำลังโหลดช่วงใหม่ — แสดงของเดิมแบบจาง

  const view = shownReport ?? report
  const viewRange = shownReport ? range : reportRange ?? range
  const buckets = useMemo(
    () => (view ? buildBuckets(viewRange.from, viewRange.to, view) : []),
    [view, viewRange.from, viewRange.to],
  )
  const dayCount = daysBetweenKeys(viewRange.from, viewRange.to) + 1
  const monthly = dayCount > DAILY_MAX

  const totals = useMemo(() => {
    if (!view) return null
    const payment = sumBy(view.income.by_day, d => d.payment)
    const refund = sumBy(view.income.by_day, d => d.refund)
    const charges = sumBy(RENTAL_CHARGE_KINDS, k => view.charges[k])
    const lost = view.bookings.cancelled + view.bookings.no_show + view.bookings.expired
    // รวมยอดหักจากเงินประกันด้วย — total_net นับส่วนนี้เป็นรายรับ แต่ไม่อยู่ในวิธีชำระใด
    const methodTotal = sumBy(RENTAL_CASH_METHODS, m => Math.max(0, view.income.by_method[m])) + Math.max(0, view.income.security_apply)
    const sourceTotal = RENTAL_SOURCES.reduce((s, k) => s + view.bookings.by_source[k], 0)
    return { payment, refund, charges, lost, methodTotal, sourceTotal }
  }, [view])

  const rangeText = `${formatThaiDate(viewRange.from)}${viewRange.to !== viewRange.from ? ` – ${formatThaiDate(viewRange.to)}` : ''}`

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">รายงานร้านเช่า</h1>
          <p className="page-subtitle">รายรับ การจอง ชุดยอดนิยม และส่งออกข้อมูลเป็นไฟล์ Excel</p>
        </div>
        <div className="page-actions">
          <RentalExportButton
            kind="bookings"
            label="ส่งออกการจอง (Excel)"
            fromKey={range.from}
            toKey={range.to}
            disabled={missing || loading}
            onResult={r => setExportMsg(r.ok
              ? { ok: true, text: `ดาวน์โหลดไฟล์การจองแล้ว ${fmtCount(r.count)} รายการ (ตามวันรับชุด ${formatThaiDate(range.from)} – ${formatThaiDate(range.to)})` }
              : { ok: false, text: r.error })}
          />
          <RentalExportButton
            kind="payments"
            label="ส่งออกรายการเงิน (Excel)"
            fromKey={range.from}
            toKey={range.to}
            disabled={missing || loading}
            onResult={r => setExportMsg(r.ok
              ? { ok: true, text: `ดาวน์โหลดไฟล์รายการเงินแล้ว ${fmtCount(r.count)} รายการ (ตามวันที่บันทึก ${formatThaiDate(range.from)} – ${formatThaiDate(range.to)})` }
              : { ok: false, text: r.error })}
          />
        </div>
      </div>

      {exportMsg && (
        <div role={exportMsg.ok ? 'status' : 'alert'} className={exportMsg.ok ? 'alert-ok' : 'alert-err'}>
          {exportMsg.ok ? <CheckCircle2 {...ICON_SM} /> : <AlertCircle {...ICON_SM} />}
          <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
            <p className="min-w-0 break-words">{exportMsg.text}</p>
            <button
              type="button"
              onClick={() => setExportMsg(null)}
              className="btn-icon btn-icon-plain -my-2 -mr-2 shrink-0"
              aria-label="ปิดข้อความ"
            >
              <X {...ICON_SM} />
            </button>
          </div>
        </div>
      )}

      {/* ===== ช่วงวันที่ ===== */}
      <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="rr-range-title">
        <h2 id="rr-range-title" className="section-title">
          <CalendarRange {...ICON} />
          ช่วงวันที่
        </h2>
        <div className="flex flex-wrap gap-2" role="group" aria-label="ช่วงวันที่ลัด">
          {PRESETS.map(p => (
            <button
              key={p.key}
              type="button"
              className="chip-toggle"
              aria-pressed={activePreset === p.key}
              onClick={() => choosePreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={e => { e.preventDefault(); apply(draftFrom, draftTo) }}
          noValidate
        >
          <div className="min-w-0">
            <label htmlFor="rr-from" className="field-label">ตั้งแต่วันที่</label>
            <input
              id="rr-from"
              type="date"
              className="input tabular-nums"
              value={draftFrom}
              max={today}
              onChange={e => setDraftFrom(e.target.value)}
              aria-describedby="rr-from-be"
            />
            <p id="rr-from-be" className="field-hint">{isDayKey(draftFrom) ? formatThaiDayLong(draftFrom) : '-'}</p>
          </div>
          <div className="min-w-0">
            <label htmlFor="rr-to" className="field-label">ถึงวันที่</label>
            <input
              id="rr-to"
              type="date"
              className="input tabular-nums"
              value={draftTo}
              max={today}
              onChange={e => setDraftTo(e.target.value)}
              aria-describedby="rr-to-be"
            />
            <p id="rr-to-be" className="field-hint">{isDayKey(draftTo) ? formatThaiDayLong(draftTo) : '-'}</p>
          </div>
          <div className="sm:pb-6">
            <button type="submit" disabled={!!draftProblem || loading} className="btn-primary w-full sm:w-auto">
              {loading ? <RefreshCw {...ICON_SM} className="animate-spin" /> : <BarChart3 {...ICON_SM} />}
              {draftDirty ? 'ดูรายงาน' : 'โหลดใหม่'}
            </button>
          </div>
        </form>
        {draftProblem && (draftFrom !== '' || draftTo !== '') && (
          <p role="alert" className="text-sm text-red-700">{draftProblem}</p>
        )}
      </section>

      {missing ? (
        <MigrationNotice message={FIX06_MISSING_MSG} />
      ) : error && !view ? (
        <div role="alert" className="alert-err">
          <AlertCircle {...ICON_SM} />
          <div className="min-w-0 space-y-2">
            <p className="break-words">{error}</p>
            <button type="button" onClick={() => void load(range.from, range.to)} className="btn-secondary bg-white px-4 text-sm">
              <RefreshCw {...ICON_SM} />
              ลองอีกครั้ง
            </button>
          </div>
        </div>
      ) : !view || !totals ? (
        <div className="space-y-4" role="status">
          <span className="sr-only">กำลังโหลดรายงาน...</span>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="stat-card">
                <div className="skeleton h-4 w-20" />
                <div className="skeleton h-7 w-24" />
              </div>
            ))}
          </div>
          <div className="skeleton h-72 rounded-xl" />
        </div>
      ) : (
        <div aria-busy={loading} className={clsx('space-y-4 sm:space-y-6', (loading || stale) && 'opacity-60')}>
          {error && (
            <div role="alert" className="alert-err">
              <AlertCircle {...ICON_SM} />
              <p className="min-w-0 break-words">{error} — ตัวเลขด้านล่างเป็นของช่วง {rangeText}</p>
            </div>
          )}

          <p className="text-sm text-gray-600">
            ช่วง <span className="font-semibold text-gray-900 tabular-nums">{rangeText}</span>
            <span className="text-gray-500"> ({fmtCount(dayCount)} วัน)</span>
          </p>

          {/* ===== การ์ดสรุปของช่วง ===== */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:gap-6">
            <StatCard
              label="รายรับสุทธิ"
              value={baht(view.income.total_net)}
              sub={totals.refund > 0 ? `คืน ${baht(totals.refund)}` : undefined}
              icon={Wallet}
              hot
              wide
            />
            <StatCard
              label="การจองใหม่"
              value={`${fmtCount(view.bookings.created)}`}
              sub={`ปิดงาน ${fmtCount(view.bookings.completed)}`}
              icon={ClipboardList}
            />
            <StatCard
              label="ยกเลิก / ไม่มารับ / หมดเวลา"
              value={`${fmtCount(totals.lost)}`}
              icon={XCircle}
            />
            <StatCard label="ค่าปรับและค่าเสียหาย" value={baht(totals.charges)} icon={AlertTriangle} wide />
          </div>

          {/* ===== ยอด ณ ตอนนี้ (ไม่ขึ้นกับช่วงวันที่) ===== */}
          <section className="card p-4 sm:p-5" aria-labelledby="rr-now-title">
            <h2 id="rr-now-title" className="section-title mb-3">
              <ShieldCheck {...ICON} />
              ยอดคงค้าง ณ ตอนนี้
            </h2>
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="panel p-3">
                <dt className="text-sm text-gray-600">เงินประกันที่ร้านถืออยู่</dt>
                <dd className="money text-lg text-gray-900">{baht(view.security_held_total)}</dd>
              </div>
              <div className="panel p-3">
                <dt className="text-sm text-gray-600">ยอดค้างชำระรวม (การจองที่ยังไม่ปิด)</dt>
                <dd className={clsx('money text-lg', view.outstanding_due_total > 0 ? 'text-red-700' : 'text-gray-900')}>
                  {baht(view.outstanding_due_total)}
                </dd>
              </div>
              <div className="panel p-3">
                <dt className="text-sm text-gray-600">รับเงินเกิน (ต้องคืนลูกค้า)</dt>
                <dd className={clsx('money text-lg', view.overpaid_total > 0 ? 'text-red-700' : 'text-gray-900')}>
                  {baht(view.overpaid_total)}
                </dd>
              </div>
              <div className="panel p-3">
                <dt className="text-sm text-gray-600">เกินกำหนดคืนชุด</dt>
                <dd className={clsx('money text-lg', view.overdue_count > 0 ? 'text-red-700' : 'text-gray-900')}>
                  {fmtCount(view.overdue_count)} <span className="text-sm font-normal text-gray-600">รายการ</span>
                </dd>
                {view.overdue_count > 0 && (
                  <Link href="/rental/bookings?tab=overdue" className="link text-sm">ดูรายการเกินกำหนดคืน</Link>
                )}
              </div>
            </dl>
          </section>

          <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3">
            {/* ===== กราฟรายรับ ===== */}
            <section className="card min-w-0 xl:col-span-2" aria-labelledby="rr-chart-title">
              <div className="card-header">
                <h2 id="rr-chart-title" className="section-title">
                  <BarChart3 {...ICON} />
                  {monthly ? 'รายรับสุทธิรายเดือน' : 'รายรับสุทธิรายวัน'}
                </h2>
              </div>
              {totals.payment === 0 && totals.refund === 0 ? (
                <div className="empty-state">
                  <span className="icon-bubble icon-bubble-lg"><TrendingUp size={28} strokeWidth={1.75} aria-hidden="true" /></span>
                  <p className="empty-state-title">ยังไม่มีรายรับในช่วงนี้</p>
                </div>
              ) : (
                <div className="relative m-4 h-56 sm:m-5 sm:h-72">
                  <IncomeChart
                    buckets={buckets}
                    ariaLabel={`กราฟรายรับสุทธิ${monthly ? 'รายเดือน' : 'รายวัน'} ช่วง ${rangeText} รวม ${baht(view.income.total_net)}`}
                  />
                </div>
              )}
              <p className="px-4 pb-4 text-xs text-gray-500 sm:px-5">
                รายรับนับตามวันที่รับเงินจริง: รับชำระ − คืนเงินค่าเช่า + หักเงินประกันเป็นค่าเช่า/ค่าปรับ (เงินประกันที่รับ/คืนไม่นับเป็นรายได้)
              </p>
            </section>

            {/* ===== แยกตามวิธีชำระ ===== */}
            <section className="card min-w-0" aria-labelledby="rr-method-title">
              <div className="card-header">
                <h2 id="rr-method-title" className="section-title">
                  <CreditCard {...ICON} />
                  แยกตามวิธีชำระ
                </h2>
              </div>
              <ul className="space-y-3 p-4 sm:p-5">
                {RENTAL_CASH_METHODS.map(m => {
                  const v = view.income.by_method[m]
                  const pct = totals.methodTotal > 0 ? (Math.max(0, v) / totals.methodTotal) * 100 : 0
                  return (
                    <li key={m} className="space-y-1">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-gray-700">{METHOD_LABELS[m]}</span>
                        <span className="whitespace-nowrap">
                          <span className={clsx('font-semibold tabular-nums', v < 0 ? 'text-red-700' : 'text-gray-900')}>{baht(v)}</span>
                          {totals.methodTotal > 0 && <span className="ml-1 text-xs text-gray-500 tabular-nums">{pct.toFixed(0)}%</span>}
                        </span>
                      </div>
                      <ShareBar pct={pct} />
                    </li>
                  )
                })}
                {view.income.security_apply > 0 && (() => {
                  const v = view.income.security_apply
                  const pct = totals.methodTotal > 0 ? (v / totals.methodTotal) * 100 : 0
                  return (
                    <li className="space-y-1">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-gray-700">หักจากเงินประกัน</span>
                        <span className="whitespace-nowrap">
                          <span className="font-semibold tabular-nums text-gray-900">{baht(v)}</span>
                          {totals.methodTotal > 0 && <span className="ml-1 text-xs text-gray-500 tabular-nums">{pct.toFixed(0)}%</span>}
                        </span>
                      </div>
                      <ShareBar pct={pct} />
                    </li>
                  )
                })()}
              </ul>
            </section>
          </div>

          {/* ===== ชุดยอดนิยม ===== */}
          <section className="card overflow-hidden" aria-labelledby="rr-items-title">
            <div className="card-header flex-wrap gap-2">
              <h2 id="rr-items-title" className="section-title">
                <Shirt {...ICON} />
                ชุดที่ทำรายได้สูงสุด
              </h2>
              {view.items.length > 0 && <span className="chip tabular-nums">{fmtCount(view.items.length)} แบบ</span>}
            </div>
            {view.items.length === 0 ? (
              <div className="empty-state">
                <span className="icon-bubble icon-bubble-lg"><Shirt size={28} strokeWidth={1.75} aria-hidden="true" /></span>
                <p className="empty-state-title">ยังไม่มีการเช่าในช่วงนี้</p>
              </div>
            ) : (
              <>
                <ol className="md:hidden divide-y divide-gray-150">
                  {view.items.map((it, i) => (
                    <li key={it.item_id || `${it.code}-${i}`} className="space-y-1.5 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 break-words">
                            <span className="mr-1 text-gray-400 tabular-nums">{i + 1}.</span>
                            {it.name}
                          </p>
                          <p className="font-mono text-xs text-gray-500 break-all">{it.code}</p>
                        </div>
                        <span className="money shrink-0 text-gray-900">{baht(it.rent_revenue)}</span>
                      </div>
                      <p className="text-xs text-gray-600 tabular-nums">
                        เช่า {fmtCount(it.bookings)} ครั้ง · {fmtCount(it.days_rented)} วัน · ใช้งาน {it.utilization_pct.toFixed(0)}%
                      </p>
                      <ShareBar pct={it.utilization_pct} />
                    </li>
                  ))}
                </ol>
                <div className="hidden md:block table-wrap">
                  <table className="table-soft min-w-[680px]">
                    <thead>
                      <tr>
                        <th className="w-10">#</th>
                        <th>ชุด</th>
                        <th className="text-right">ครั้งที่เช่า</th>
                        <th className="text-right">วันที่ถูกเช่า</th>
                        <th className="text-right">รายได้ค่าเช่า</th>
                        <th className="w-48">อัตราการใช้งาน</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.items.map((it, i) => (
                        <tr key={it.item_id || `${it.code}-${i}`}>
                          <td className="text-gray-500 tabular-nums">{i + 1}</td>
                          <td>
                            <span className="block font-medium text-gray-900 break-words">{it.name}</span>
                            <span className="block font-mono text-xs text-gray-500">{it.code}</span>
                          </td>
                          <td className="text-right tabular-nums">{fmtCount(it.bookings)}</td>
                          <td className="text-right tabular-nums">{fmtCount(it.days_rented)}</td>
                          <td className="text-right font-semibold tabular-nums whitespace-nowrap">{baht(it.rent_revenue)}</td>
                          <td>
                            <div className="flex items-center gap-2">
                              <span className="w-12 shrink-0 text-right text-xs tabular-nums text-gray-700">{it.utilization_pct.toFixed(0)}%</span>
                              <ShareBar pct={it.utilization_pct} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <p className="border-t border-gray-150 px-4 py-3 text-xs text-gray-500 sm:px-5">
              อัตราการใช้งาน = วันที่ชิ้นของชุดนั้นถูกเช่า เทียบกับจำนวนวันในช่วง × จำนวนชิ้นที่มี (สูง = ควรเพิ่มชิ้น / ต่ำ = ลองโปรโมต)
            </p>
          </section>

          <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
            {/* ===== การจอง ===== */}
            <section className="card min-w-0 space-y-4 p-4 sm:p-5" aria-labelledby="rr-bookings-title">
              <h2 id="rr-bookings-title" className="section-title">
                <ClipboardList {...ICON} />
                การจองในช่วงนี้
              </h2>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  { label: 'จองใหม่', value: view.bookings.created },
                  { label: 'รับชุดไปแล้ว', value: view.bookings.picked_up },
                  { label: 'เสร็จสิ้น', value: view.bookings.completed },
                  { label: 'ยกเลิก', value: view.bookings.cancelled },
                  { label: 'ไม่มารับชุด', value: view.bookings.no_show },
                  { label: 'หมดเวลาถือจอง', value: view.bookings.expired },
                ].map(s => (
                  <div key={s.label} className="panel p-3">
                    <dt className="text-xs text-gray-600">{s.label}</dt>
                    <dd className="money text-lg text-gray-900">{fmtCount(s.value)}</dd>
                  </div>
                ))}
              </dl>
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900">ช่องทางที่ลูกค้าจอง</h3>
                <ul className="space-y-2.5">
                  {RENTAL_SOURCES.map(k => {
                    const n = view.bookings.by_source[k]
                    const pct = totals.sourceTotal > 0 ? (n / totals.sourceTotal) * 100 : 0
                    return (
                      <li key={k} className="space-y-1">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="text-gray-700">{SOURCE_LABELS[k]}</span>
                          <span className="whitespace-nowrap tabular-nums">
                            <span className="font-semibold text-gray-900">{fmtCount(n)}</span>
                            {totals.sourceTotal > 0 && <span className="ml-1 text-xs text-gray-500">{pct.toFixed(0)}%</span>}
                          </span>
                        </div>
                        <ShareBar pct={pct} />
                      </li>
                    )
                  })}
                </ul>
              </div>
            </section>

            {/* ===== ค่าปรับ / ค่าใช้จ่าย ===== */}
            <section className="card min-w-0 space-y-3 p-4 sm:p-5" aria-labelledby="rr-charges-title">
              <h2 id="rr-charges-title" className="section-title">
                <Hourglass {...ICON} />
                ค่าปรับ ค่าใช้จ่าย และเงินประกัน
              </h2>
              <div className="panel space-y-1.5 p-3 text-sm">
                {RENTAL_CHARGE_KINDS.map(k => (
                  <div key={k} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-gray-600">{CHARGE_KIND_LABELS[k]}</span>
                    <span className="shrink-0 whitespace-nowrap font-medium tabular-nums text-gray-900">{baht(view.charges[k])}</span>
                  </div>
                ))}
                <hr className="divider !my-2" />
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold text-gray-900">รวม</span>
                  <span className="money text-base text-gray-900">{baht(totals.charges)}</span>
                </div>
              </div>
              <p className="flex items-start gap-1.5 text-xs text-gray-500">
                <AlertCircle {...ICON_XS} className="mt-px shrink-0" />
                <span className="min-w-0">ยอดที่เรียกเก็บ (ไม่รวมรายการที่ยกเลิก) — เงินที่รับจริงอยู่ในรายรับด้านบน</span>
              </p>

              {/* เงินประกันเข้า-ออกในช่วง: ไม่ใช่รายรับ แต่เป็นเงินสดที่ผ่านลิ้นชัก/บัญชีจริง (ใช้ตรวจยอดเงินสด) */}
              <h3 className="pt-1 text-sm font-semibold text-gray-900">เงินประกันในช่วงนี้</h3>
              <div className="panel space-y-1.5 p-3 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-gray-600">รับเงินประกัน</span>
                  <span className="shrink-0 whitespace-nowrap font-medium tabular-nums text-gray-900">{baht(view.security.received)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-gray-600">คืนเงินประกัน</span>
                  <span className="shrink-0 whitespace-nowrap font-medium tabular-nums text-gray-900">
                    {view.security.returned > 0 ? `-${baht(view.security.returned)}` : baht(0)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-gray-600">หักเป็นค่าเช่า/ค่าปรับ (นับเป็นรายรับแล้ว)</span>
                  <span className="shrink-0 whitespace-nowrap font-medium tabular-nums text-gray-900">{baht(view.security.applied)}</span>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
