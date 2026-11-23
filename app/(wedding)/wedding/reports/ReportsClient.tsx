'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import {
  AlertCircle, BarChart3, CalendarRange, CheckCircle2, ClipboardList, Coins, CreditCard, Package, PiggyBank, RefreshCw,
  TrendingUp, Users, Wallet, X, type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht, bangkokTodayKey, daysBetweenKeys, formatThaiDate, formatThaiDayLong, isDayKey } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import {
  FIX07_MISSING_MSG, THAI_MONTHS_LONG, WED_BOOKING_STATUSES, WED_METHOD_LABELS, WED_PAYMENT_METHODS, WED_PAYMENT_PURPOSES,
  WED_PURPOSE_LABELS, WED_SOURCES, WED_SOURCE_LABELS, WED_STATUS_LABELS, crewDisplayName, parseWedReport, type WedReport,
} from '@/lib/wedding'
import MigrationNotice from '@/components/pos/MigrationNotice'
import WedIncomeChart, { type WedIncomeBucket } from '@/components/wedding/money/WedIncomeChart'
import WedExportButton from '@/components/wedding/money/WedExportButton'
import { addMonths } from '@/components/wedding/money/paymentRows'
import { REPORT_PRESETS, matchPreset, presetRange, reportRangeProblem } from '@/components/wedding/money/reportRange'
import { fmtCount, rpcWithTimeout, wedErrorText } from '@/components/wedding/money/wedRpc'

// รายงานร้าน b.oncloud (wed_report — เฉพาะผู้จัดการ):
//   รายรับ = เงินที่รับจริงตามวันที่รับ/คืนเงิน (paid_on) ไม่นับรายการที่ยกเลิก · งานในช่วง = งานที่วันงานแรกอยู่ในช่วง
//   ต้นทุนทีม = ค่าตัวทีมของคิวในช่วง (ตามวันคิว) · กำไรขั้นต้น = (ยอดหลังส่วนลด + ค่าใช้จ่ายเพิ่ม) − ค่าตัวทีม ของงานที่ยืนยันแล้วขึ้นไป
// ช่วงวันที่ไม่เกิน 1 ปี (เลือกวันอนาคตได้ — ดูงานที่จองล่วงหน้า/ค่าตัวทีมที่ต้องจ่าย) · ส่งออก CSV ใช้ช่วงเดียวกับที่ดูอยู่

const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const PRESETS = REPORT_PRESETS
const rangeProblem = reportRangeProblem

// แท่งกราฟรายเดือน: ใส่เดือนที่ไม่มีรายการเป็น 0 ให้ครบช่วง
function buildBuckets(from: string, to: string, report: WedReport): WedIncomeBucket[] {
  const byMonth = new Map(report.income.by_month.map(m => [m.month, m]))
  const out: WedIncomeBucket[] = []
  let m = from.slice(0, 7)
  const last = to.slice(0, 7)
  for (let guard = 0; m <= last && guard < 24; guard++) {
    const v = byMonth.get(m)
    const yy = Number(m.slice(0, 4)) + 543
    const mo = Number(m.slice(5, 7))
    out.push({
      key: m,
      label: `${THAI_MONTHS_SHORT[mo - 1] ?? ''} ${String(yy).slice(-2)}`,
      title: `${THAI_MONTHS_LONG[mo - 1] ?? ''} ${yy}`,
      payment: v?.payment ?? 0,
      refund: v?.refund ?? 0,
      net: v?.net ?? 0,
    })
    m = addMonths(m, 1)
  }
  return out
}

function StatCard({ label, value, sub, icon: Icon, hot, tone }: {
  label: string; value: string; sub?: string; icon: LucideIcon; hot?: boolean; tone?: 'neg'
}) {
  return (
    <div className={clsx('stat-card', hot && 'stat-card-hot')}>
      <div className="flex items-start justify-between gap-2">
        <span className={clsx('stat-label min-w-0 pt-1', hot && 'text-gray-600')}>{label}</span>
        <span className={clsx('icon-bubble', hot && 'icon-bubble-strong')}><Icon {...ICON} /></span>
      </div>
      <p className={clsx('stat-value', tone === 'neg' && 'text-red-700')}>
        <span className="whitespace-nowrap">{value}</span>
        {sub && <span className={clsx('stat-sub', hot && 'text-gray-600')}> <span className="whitespace-nowrap">· {sub}</span></span>}
      </p>
    </div>
  )
}

// แถบสัดส่วนแนวนอน (ไม่ใช้สีอย่างเดียว — ตัวเลขอยู่ข้างแถบเสมอ) · ขอบ brand-600 ให้แถบสีอ่อนเห็นชัดบนพื้นเทา
function ShareBar({ pct }: { pct: number }) {
  const w = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0))
  return (
    <span className="block h-2 w-full overflow-hidden rounded-full bg-gray-150" aria-hidden="true">
      <span className={clsx('block h-full rounded-full bg-brand-400', w > 0 && 'border border-brand-600')} style={{ width: `${w}%` }} />
    </span>
  )
}

function ShareRow({ label, value, pct, showPct }: { label: string; value: string; pct: number; showPct: boolean }) {
  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 text-gray-700 break-words">{label}</span>
        <span className="shrink-0 whitespace-nowrap">
          <span className="font-semibold tabular-nums text-gray-900">{value}</span>
          {showPct && <span className="ml-1 text-xs text-gray-500 tabular-nums">{pct.toFixed(0)}%</span>}
        </span>
      </div>
      <ShareBar pct={pct} />
    </li>
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
  initialReport: WedReport | null
  initialError: string
  initialMissing: boolean
}) {
  const supabase = useMemo(() => createClient(), [])
  const [today, setToday] = useState(initialToday)
  // ช่วงที่แสดงอยู่ (ตรงกับ report) และช่วงที่กำลังเลือก (ช่องกรอกวันที่)
  const [range, setRange] = useState({ from: initialFrom, to: initialTo })
  const [draftFrom, setDraftFrom] = useState(initialFrom)
  const [draftTo, setDraftTo] = useState(initialTo)
  const [report, setReport] = useState<WedReport | null>(initialReport)
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
    const res = await rpcWithTimeout(supabase, 'wed_report', { p_from: from, p_to: to })
    if (id !== reqRef.current) return
    setLoading(false)
    if (res.error) {
      if (isMigrationMissing(res.error)) setMissing(true)
      else setError(wedErrorText(res.error))
      return
    }
    setMissing(false)
    setReport(parseWedReport(res.data))
    setReportRange({ from, to })
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
    setToday(bangkokTodayKey())
    setDraftFrom(from)
    setDraftTo(to)
    if (rangeProblem(from, to)) return
    setExportMsg(null)
    syncUrl(from, to)
    void load(from, to)
  }

  // ทิ้งหน้าไว้ข้ามเที่ยงคืน → "วันนี้" ของปุ่มลัดเลื่อนตาม
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') setToday(bangkokTodayKey())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const draftProblem = rangeProblem(draftFrom, draftTo)
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

  const totals = useMemo(() => {
    if (!view) return null
    const methodTotal = WED_PAYMENT_METHODS.reduce((s, m) => s + Math.max(0, view.income.by_method[m]), 0)
    const purposeTotal = WED_PAYMENT_PURPOSES.reduce((s, p) => s + Math.max(0, view.income.by_purpose[p]), 0)
    const sourceTotal = WED_SOURCES.reduce((s, k) => s + view.bookings.by_source[k], 0)
    const statusTotal = WED_BOOKING_STATUSES.reduce((s, k) => s + view.bookings.by_status[k], 0)
    const crewUnpaid = Math.max(0, view.crew.cost_total - view.crew.paid_total)
    const packageValue = view.bookings.by_package.reduce((s, p) => s + p.value, 0)
    return { methodTotal, purposeTotal, sourceTotal, statusTotal, crewUnpaid, packageValue }
  }, [view])

  const rangeText = `${formatThaiDate(viewRange.from)}${viewRange.to !== viewRange.from ? ` – ${formatThaiDate(viewRange.to)}` : ''}`
  const exportDisabled = missing || loading || !!rangeProblem(range.from, range.to)

  function exportResult(label: string) {
    return (r: { ok: true; count: number } | { ok: false; error: string }) => setExportMsg(r.ok
      ? { ok: true, text: `ดาวน์โหลดไฟล์${label}แล้ว ${fmtCount(r.count)} แถว (ช่วง ${formatThaiDate(range.from)} – ${formatThaiDate(range.to)})` }
      : { ok: false, text: r.error })
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">รายงาน</h1>
          <p className="page-subtitle">รายรับ งานตามสถานะ/ช่องทาง/แพ็กเกจ ต้นทุนทีมงาน กำไร และส่งออกไฟล์ Excel</p>
        </div>
        <div className="page-actions">
          <WedExportButton kind="bookings" label="ส่งออกงาน (Excel)" fromKey={range.from} toKey={range.to} disabled={exportDisabled} onResult={exportResult('งาน')} />
          <WedExportButton kind="payments" label="ส่งออกรายการเงิน (Excel)" fromKey={range.from} toKey={range.to} disabled={exportDisabled} onResult={exportResult('รายการเงิน')} />
          <WedExportButton kind="crew_fees" label="ส่งออกค่าตัวทีม (Excel)" fromKey={range.from} toKey={range.to} disabled={exportDisabled} onResult={exportResult('ค่าตัวทีม')} />
        </div>
      </div>

      {exportMsg && (
        <div role={exportMsg.ok ? 'status' : 'alert'} className={exportMsg.ok ? 'alert-ok' : 'alert-err'}>
          {exportMsg.ok ? <CheckCircle2 {...ICON_SM} /> : <AlertCircle {...ICON_SM} />}
          <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
            <p className="min-w-0 break-words">{exportMsg.text}</p>
            <button type="button" onClick={() => setExportMsg(null)} className="btn-icon btn-icon-plain -my-2 -mr-2 shrink-0" aria-label="ปิดข้อความ">
              <X {...ICON_SM} />
            </button>
          </div>
        </div>
      )}

      {/* ===== ช่วงวันที่ ===== */}
      <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="wr-range-title">
        <h2 id="wr-range-title" className="section-title">
          <CalendarRange {...ICON} />
          ช่วงวันที่
        </h2>
        <div className="flex gap-2 overflow-x-auto scrollbar-none sm:flex-wrap" role="group" aria-label="ช่วงวันที่ลัด">
          {PRESETS.map(p => (
            <button
              key={p.key}
              type="button"
              className="chip-toggle"
              aria-pressed={activePreset === p.key}
              onClick={() => { const r = presetRange(p.key, bangkokTodayKey()); apply(r.from, r.to) }}
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
            <label htmlFor="wr-from" className="field-label">ตั้งแต่วันที่</label>
            <input id="wr-from" type="date" className="input tabular-nums" value={draftFrom} onChange={e => setDraftFrom(e.target.value)} aria-describedby="wr-from-be" />
            <p id="wr-from-be" className="field-hint">{isDayKey(draftFrom) ? formatThaiDayLong(draftFrom) : '-'}</p>
          </div>
          <div className="min-w-0">
            <label htmlFor="wr-to" className="field-label">ถึงวันที่</label>
            <input id="wr-to" type="date" className="input tabular-nums" value={draftTo} onChange={e => setDraftTo(e.target.value)} aria-describedby="wr-to-be" />
            <p id="wr-to-be" className="field-hint">{isDayKey(draftTo) ? formatThaiDayLong(draftTo) : '-'}</p>
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
        <MigrationNotice message={FIX07_MISSING_MSG} />
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
              sub={view.income.total_refund > 0 ? `คืน ${baht(view.income.total_refund)}` : undefined}
              icon={Wallet}
              hot
            />
            <StatCard
              label="งานในช่วง (ตามวันงาน)"
              value={fmtCount(view.bookings.total)}
              sub={`รับงานใหม่ ${fmtCount(view.bookings.created)}`}
              icon={ClipboardList}
            />
            <StatCard label="มูลค่างานในช่วง" value={baht(view.bookings.value_total)} sub="ไม่นับสอบถาม/ยกเลิก" icon={Coins} />
            <StatCard
              label="กำไรขั้นต้น"
              value={baht(view.profit_total)}
              icon={PiggyBank}
              tone={view.profit_total < 0 ? 'neg' : undefined}
            />
          </div>

          {/* ===== ยอด ณ ตอนนี้ (ไม่ขึ้นกับช่วงวันที่) ===== */}
          <section className="card p-4 sm:p-5" aria-labelledby="wr-now-title">
            <h2 id="wr-now-title" className="section-title mb-3">
              <TrendingUp {...ICON} />
              ยอด ณ ตอนนี้
            </h2>
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="panel p-3">
                <dt className="text-sm text-gray-600">มูลค่างานที่ยังไม่ถึงวันงาน (ล็อกคิว/ยืนยันแล้ว)</dt>
                <dd className="money text-lg text-gray-900">{baht(view.upcoming_value)}</dd>
              </div>
              <div className="panel p-3">
                <dt className="text-sm text-gray-600">ยอดค้างรับจากลูกค้า (งานที่ยังไม่ปิด)</dt>
                <dd className={clsx('money text-lg', view.outstanding_due_total > 0 ? 'text-amber-800' : 'text-gray-900')}>
                  {baht(view.outstanding_due_total)}
                </dd>
                {view.outstanding_due_total > 0 && <Link href="/wedding/payments" className="link text-sm">ดูงวดที่ต้องตามเก็บ</Link>}
              </div>
              <div className="panel p-3">
                <dt className="text-sm text-gray-600">รับเงินเกิน (ต้องคืนลูกค้า)</dt>
                <dd className={clsx('money text-lg', view.overpaid_total > 0 ? 'text-red-700' : 'text-gray-900')}>
                  {baht(view.overpaid_total)}
                </dd>
              </div>
            </dl>
          </section>

          <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3">
            {/* ===== กราฟรายรับ ===== */}
            <section className="card min-w-0 xl:col-span-2" aria-labelledby="wr-chart-title">
              <div className="card-header">
                <h2 id="wr-chart-title" className="section-title">
                  <BarChart3 {...ICON} />
                  รายรับสุทธิรายเดือน
                </h2>
              </div>
              {view.income.total_payment === 0 && view.income.total_refund === 0 ? (
                <div className="empty-state">
                  <span className="icon-bubble icon-bubble-lg"><TrendingUp size={28} strokeWidth={1.75} aria-hidden="true" /></span>
                  <p className="empty-state-title">ยังไม่มีรายรับในช่วงนี้</p>
                </div>
              ) : (
                <>
                  <div className="relative m-4 h-56 sm:m-5 sm:h-72">
                    <WedIncomeChart buckets={buckets} ariaLabel={`กราฟรายรับสุทธิรายเดือน ช่วง ${rangeText} รวม ${baht(view.income.total_net)}`} />
                  </div>
                  {/* ตัวเลขเดียวกับกราฟเป็นตาราง (อ่านด้วยโปรแกรมอ่านจอ/ดูตัวเลขชัด) */}
                  <div className="table-wrap border-t border-gray-150">
                    <table className="table-soft min-w-[360px]">
                      <thead>
                        <tr>
                          <th>เดือน</th>
                          <th className="text-right">รับ</th>
                          <th className="text-right">คืน</th>
                          <th className="text-right">สุทธิ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {buckets.map(b => (
                          <tr key={b.key}>
                            <td className="whitespace-nowrap">{b.title}</td>
                            <td className="text-right tabular-nums whitespace-nowrap">{baht(b.payment)}</td>
                            <td className="text-right tabular-nums whitespace-nowrap">{b.refund > 0 ? `-${baht(b.refund)}` : baht(0)}</td>
                            <td className={clsx('text-right font-semibold tabular-nums whitespace-nowrap', b.net < 0 ? 'text-red-700' : 'text-gray-900')}>{baht(b.net)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              <p className="px-4 py-3 text-xs text-gray-500 sm:px-5">
                รายรับนับตามวันที่รับเงินจริง: รับชำระ − คืนเงิน (ไม่นับรายการที่ยกเลิก)
              </p>
            </section>

            {/* ===== แยกตามวิธี/รายการ ===== */}
            <section className="card min-w-0" aria-labelledby="wr-method-title">
              <div className="card-header">
                <h2 id="wr-method-title" className="section-title">
                  <CreditCard {...ICON} />
                  แยกตามวิธีชำระ
                </h2>
              </div>
              <ul className="space-y-3 p-4 sm:p-5">
                {WED_PAYMENT_METHODS.map(m => {
                  const v = view.income.by_method[m]
                  return (
                    <ShareRow
                      key={m}
                      label={WED_METHOD_LABELS[m]}
                      value={baht(v)}
                      pct={totals.methodTotal > 0 ? (Math.max(0, v) / totals.methodTotal) * 100 : 0}
                      showPct={totals.methodTotal > 0}
                    />
                  )
                })}
              </ul>
              <div className="border-t border-gray-150 p-4 sm:p-5">
                <h3 className="mb-3 text-sm font-semibold text-gray-900">รับชำระแยกตามรายการ</h3>
                <ul className="space-y-3">
                  {WED_PAYMENT_PURPOSES.map(p => {
                    const v = view.income.by_purpose[p]
                    return (
                      <ShareRow
                        key={p}
                        label={WED_PURPOSE_LABELS[p]}
                        value={baht(v)}
                        pct={totals.purposeTotal > 0 ? (Math.max(0, v) / totals.purposeTotal) * 100 : 0}
                        showPct={totals.purposeTotal > 0}
                      />
                    )
                  })}
                </ul>
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
            {/* ===== งานตามสถานะ + ช่องทาง ===== */}
            <section className="card min-w-0 space-y-4 p-4 sm:p-5" aria-labelledby="wr-bookings-title">
              <h2 id="wr-bookings-title" className="section-title">
                <ClipboardList {...ICON} />
                งานในช่วงนี้ (ตามวันงานแรก)
              </h2>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {WED_BOOKING_STATUSES.map(s => (
                  <div key={s} className="panel p-3">
                    <dt className="text-xs text-gray-600">{WED_STATUS_LABELS[s]}</dt>
                    <dd className="money text-lg text-gray-900">{fmtCount(view.bookings.by_status[s])}</dd>
                  </div>
                ))}
              </dl>
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900">ลูกค้ามาจากช่องทาง</h3>
                <ul className="space-y-2.5">
                  {WED_SOURCES.map(k => {
                    const n = view.bookings.by_source[k]
                    return (
                      <ShareRow
                        key={k}
                        label={WED_SOURCE_LABELS[k]}
                        value={fmtCount(n)}
                        pct={totals.sourceTotal > 0 ? (n / totals.sourceTotal) * 100 : 0}
                        showPct={totals.sourceTotal > 0}
                      />
                    )
                  })}
                </ul>
              </div>
            </section>

            {/* ===== แพ็กเกจ ===== */}
            <section className="card min-w-0 overflow-hidden" aria-labelledby="wr-packages-title">
              <div className="card-header flex-wrap gap-2">
                <h2 id="wr-packages-title" className="section-title">
                  <Package {...ICON} />
                  แพ็กเกจที่ขายได้
                </h2>
                {view.bookings.by_package.length > 0 && <span className="chip tabular-nums">{fmtCount(view.bookings.by_package.length)} แพ็กเกจ</span>}
              </div>
              {view.bookings.by_package.length === 0 ? (
                <div className="empty-state">
                  <span className="icon-bubble icon-bubble-lg"><Package size={28} strokeWidth={1.75} aria-hidden="true" /></span>
                  <p className="empty-state-title">ยังไม่มีงานที่ยืนยันในช่วงนี้</p>
                </div>
              ) : (
                <ul className="space-y-3 p-4 sm:p-5">
                  {view.bookings.by_package.map((p, i) => (
                    <li key={`${p.package_name}-${i}`} className="space-y-1">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 text-gray-800 break-words">
                          <span className="mr-1 text-gray-400 tabular-nums">{i + 1}.</span>
                          {p.package_name}
                        </span>
                        <span className="shrink-0 whitespace-nowrap">
                          <span className="font-semibold tabular-nums text-gray-900">{baht(p.value)}</span>
                          <span className="ml-1 text-xs text-gray-500 tabular-nums">{fmtCount(p.count)} งาน</span>
                        </span>
                      </div>
                      <ShareBar pct={totals.packageValue > 0 ? (p.value / totals.packageValue) * 100 : 0} />
                    </li>
                  ))}
                </ul>
              )}
              <p className="border-t border-gray-150 px-4 py-3 text-xs text-gray-500 sm:px-5">
                นับงานที่ล็อกคิว/ยืนยันแล้วขึ้นไป (ไม่นับสอบถาม/ยกเลิก) · มูลค่า = ยอดสุทธิของงาน
              </p>
            </section>
          </div>

          {/* ===== ทีมงาน + กำไร ===== */}
          <section className="card overflow-hidden" aria-labelledby="wr-crew-title">
            <div className="card-header flex-wrap gap-2">
              <h2 id="wr-crew-title" className="section-title">
                <Users {...ICON} />
                ค่าตัวทีมงานและกำไร
              </h2>
              <Link href="/wedding/crew" className="link text-sm">จ่ายค่าตัวทีม</Link>
            </div>
            <dl className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4 sm:p-5">
              <div className="panel p-3">
                <dt className="text-xs text-gray-600">ค่าตัวทีมในช่วง</dt>
                <dd className="money text-lg text-gray-900">{baht(view.crew.cost_total)}</dd>
              </div>
              <div className="panel p-3">
                <dt className="text-xs text-gray-600">จ่ายแล้ว</dt>
                <dd className="money text-lg text-gray-900">{baht(view.crew.paid_total)}</dd>
              </div>
              <div className="panel p-3">
                <dt className="text-xs text-gray-600">ยังไม่จ่าย</dt>
                <dd className={clsx('money text-lg', totals.crewUnpaid > 0 ? 'text-amber-800' : 'text-gray-900')}>{baht(totals.crewUnpaid)}</dd>
              </div>
              <div className="panel p-3">
                <dt className="text-xs text-gray-600">กำไรขั้นต้น</dt>
                <dd className={clsx('money text-lg', view.profit_total < 0 ? 'text-red-700' : 'text-gray-900')}>{baht(view.profit_total)}</dd>
              </div>
            </dl>
            {view.crew.by_crew.length === 0 ? (
              <p className="border-t border-gray-150 px-4 py-4 text-sm text-gray-500 sm:px-5">ไม่มีคิวงานที่ลงทีมในช่วงนี้</p>
            ) : (
              <>
                <ul className="md:hidden divide-y divide-gray-150 border-t border-gray-150">
                  {view.crew.by_crew.map(c => (
                    <li key={c.crew_id || c.name} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 break-words">{crewDisplayName(c)}</p>
                        <p className="text-xs text-gray-600 tabular-nums">{fmtCount(c.sessions)} คิว · จ่ายแล้ว {baht(c.paid)}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="money text-sm text-gray-900">{baht(c.fees)}</p>
                        {c.unpaid > 0.005 && <p className="text-xs font-medium text-amber-800 tabular-nums">ค้างจ่าย {baht(c.unpaid)}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="hidden md:block table-wrap border-t border-gray-150">
                  <table className="table-soft min-w-[560px]">
                    <thead>
                      <tr>
                        <th>ทีมงาน</th>
                        <th className="text-right">คิว</th>
                        <th className="text-right">ค่าตัวรวม</th>
                        <th className="text-right">จ่ายแล้ว</th>
                        <th className="text-right">ค้างจ่าย</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.crew.by_crew.map(c => (
                        <tr key={c.crew_id || c.name}>
                          <td className="font-medium text-gray-900 break-words">{crewDisplayName(c)}</td>
                          <td className="text-right tabular-nums">{fmtCount(c.sessions)}</td>
                          <td className="text-right tabular-nums whitespace-nowrap">{baht(c.fees)}</td>
                          <td className="text-right tabular-nums whitespace-nowrap">{baht(c.paid)}</td>
                          <td className={clsx('text-right tabular-nums whitespace-nowrap', c.unpaid > 0.005 ? 'font-semibold text-amber-800' : 'text-gray-500')}>
                            {baht(c.unpaid)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <p className="flex items-start gap-1.5 border-t border-gray-150 px-4 py-3 text-xs text-gray-500 sm:px-5">
              <AlertCircle {...ICON_XS} className="mt-px shrink-0" />
              <span className="min-w-0">
                ค่าตัวทีม = ค่าตัวของคิวที่ไม่ยกเลิกในช่วง (ตามวันคิว) ของงานที่กันคิวแล้ว ·
                กำไรขั้นต้น = (ยอดหลังส่วนลด + ค่าใช้จ่ายเพิ่ม) − ค่าตัวทีมทุกคิว ของงานที่ยืนยันแล้วขึ้นไปซึ่งวันงานแรกอยู่ในช่วง
                (ยังไม่หักค่าใช้จ่ายอื่นของร้าน)
              </span>
            </p>
          </section>

          {totals.statusTotal === 0 && view.income.total_payment === 0 && (
            <p className="text-center text-sm text-gray-500">ยังไม่มีข้อมูลในช่วงนี้ — ลองเลือก &quot;ปีนี้&quot; หรือช่วงที่มีงาน</p>
          )}
          <p className="text-center text-xs text-gray-500">
            ข้อมูล ณ {formatThaiDayLong(today)} · ส่งออก Excel ได้ที่ปุ่มด้านบน (งาน / รายการเงิน / ค่าตัวทีม ช่วงเดียวกับที่ดูอยู่)
          </p>
        </div>
      )}
    </div>
  )
}
