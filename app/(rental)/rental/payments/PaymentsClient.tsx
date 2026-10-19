'use client'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  AlertCircle, ArrowDownLeft, ArrowUpRight, Banknote, Check, ChevronLeft, ChevronRight, ClipboardCheck, FileWarning,
  Inbox, Info, Printer, ReceiptText, RefreshCw, ShieldCheck, TrendingUp, Wallet, X, XCircle, type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import {
  addDaysToKey, baht, bangkokDayRangeISO, bangkokTodayKey, formatThaiDate, formatThaiDateTime, formatThaiDayLong,
  formatThaiTime, isDayKey,
} from '@/lib/format'
import { fetchAllRows } from '@/lib/fetchAllRows'
import {
  formatPhone, METHOD_LABELS, PAYMENT_KIND_LABELS, RENTAL_CASH_METHODS, RENTAL_PAYMENT_KINDS, STATUS_CHIP, STATUS_LABELS,
  paymentMoneyTime,
} from '@/lib/rental'
import PrintPortal from '@/components/pos/PrintPortal'
import {
  dayMoneyTotals, fmtCount, parsePaymentRows, PAYMENT_ROW_COLUMNS, paymentDirection, rentalErrorText, signedAmount,
  type PaymentRow,
} from '@/components/rental/money/moneyRows'
import { isFreshSlipUrl, signSlipUrls, type SignedSlipUrl } from '@/components/rental/money/slipUrls'
import SlipReviewDialog, { type SlipReviewResult } from '@/components/rental/money/SlipReviewDialog'
import PaymentsDayPrint from '@/components/rental/money/PaymentsDayPrint'

// หน้าการเงินร้านเช่าชุด: (1) รายการรับ-จ่ายเงินของวัน + ยอดรวมตามวิธี/ประเภท + พิมพ์สรุป 80 มม.
//                        (2) สลิปโอนเงินจากหน้าจองออนไลน์ที่รอตรวจ → อนุมัติ/ปฏิเสธ
// ข้อมูลอ่านจากตาราง rental_payments ตรงๆ (RLS: พนักงานร้านเช่า) — การเขียนเงินทุกอย่างผ่าน RPC เท่านั้น
// ยกเลิกรายการเงิน (void) ทำที่หน้ารายละเอียดการจอง (แตะเลขที่การจองในรายการ)

type Tab = 'day' | 'slips'
type Filter = 'all' | 'rent' | 'security' | 'other'
type Toast = { ok: boolean; text: string } | null

// สลิปรอตรวจที่แสดงพร้อมกันสูงสุด (เกินนี้ตรวจรอบแรกเสร็จแล้วโหลดใหม่)
const SLIP_LIMIT = 100
// กลับมาที่แท็บหลังทิ้งไว้นานกว่านี้ → โหลดใหม่เงียบๆ (อาจมีสลิปใหม่/รายการเงินจากเครื่องอื่น)
const STALE_MS = 60000

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'rent', label: 'ค่าเช่า / คืนเงิน' },
  { value: 'security', label: 'เงินประกัน' },
  { value: 'other', label: 'ยกเลิก / รอตรวจ' },
]

function matchFilter(p: PaymentRow, f: Filter): boolean {
  const live = p.status === 'confirmed' && !p.voided_at
  if (f === 'all') return true
  if (f === 'other') return !live
  if (!live) return false
  if (f === 'security') return p.kind === 'security_in' || p.kind === 'security_out'
  return p.kind === 'payment' || p.kind === 'refund' || p.kind === 'security_apply'
}

function signedBaht(n: number): string {
  return n < 0 ? `-${baht(Math.abs(n))}` : baht(n)
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

// ป้ายสถานะของรายการเงิน (ยืนยันแล้ว = ไม่มีป้าย)
function PaymentStateChip({ p }: { p: PaymentRow }) {
  if (p.voided_at) return <span className="badge-out">ยกเลิกแล้ว</span>
  if (p.status === 'pending_review') return <span className="badge-return">รอตรวจสลิป</span>
  if (p.status === 'rejected') return <span className="badge-adjust">ไม่อนุมัติ</span>
  return null
}

function AmountText({ p, className }: { p: PaymentRow; className?: string }) {
  const live = p.status === 'confirmed' && !p.voided_at
  const dir = paymentDirection(p.kind)
  const n = signedAmount(p)
  return (
    <span
      className={clsx(
        'money whitespace-nowrap',
        !live ? 'text-gray-400 line-through' : dir === 'out' ? 'text-red-700' : dir === 'none' ? 'text-gray-600' : 'text-gray-900',
        className,
      )}
    >
      {dir === 'in' && live ? '+' : ''}{signedBaht(n)}
    </span>
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

export default function PaymentsClient({
  shopName,
  initialDay,
  today,
  initialTab,
}: {
  shopName: string
  initialDay: string
  today: string
  initialTab: Tab
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [tab, setTab] = useState<Tab>(initialTab)
  const [todayKey, setTodayKey] = useState(today)
  const [day, setDay] = useState(initialDay)
  const dayRef = useRef(initialDay)

  // ----- รายการเงินของวัน -----
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [rowsDay, setRowsDay] = useState('')   // วันที่ของ rows (ระหว่างโหลดวันใหม่ ห้ามโชว์ตัวเลขวันเก่าใต้หัววันใหม่)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const dayReqRef = useRef(0)
  const dayLoadedAtRef = useRef(0)

  // ----- สลิปรอตรวจ -----
  const [slips, setSlips] = useState<PaymentRow[]>([])
  const [slipsLoaded, setSlipsLoaded] = useState(false)
  const [slipsLoading, setSlipsLoading] = useState(true)
  const [slipsError, setSlipsError] = useState('')
  const [slipUrls, setSlipUrls] = useState<Record<string, SignedSlipUrl>>({})
  const slipUrlsRef = useRef<Record<string, SignedSlipUrl>>({})
  const slipReqRef = useRef(0)
  const slipsLoadedAtRef = useRef(0)
  const [reviewId, setReviewId] = useState<string | null>(null)

  const [toast, setToast] = useState<Toast>(null)
  // คำเตือน "ต้องบันทึกคืนเงิน" หลังอนุมัติสลิปของการจองที่ปิดไปแล้ว — แยกจากโทสต์ ไม่ถูกโทสต์ถัดไปทับ อยู่จนกดปิดทีละรายการ
  const [refundWarnings, setRefundWarnings] = useState<{ id: string; bookingId: string | null; text: string }[]>([])
  const [printing, setPrinting] = useState(false)
  const [printedAt, setPrintedAt] = useState('')

  // ---------- โหลดรายการเงินของวัน ----------
  const loadDay = useCallback(async (d: string, silent = false) => {
    const id = ++dayReqRef.current
    if (!silent) {
      setLoading(true)
      setError('')
    }
    // error ตัวจริงจาก PostgREST (มีรหัส) — fetchAllRows โยนแค่ข้อความที่แปลแล้ว ใช้ตัดสินว่า "ยังไม่ได้รันไฟล์ SQL" ไม่ได้
    let rawError: unknown = null
    try {
      const range = bangkokDayRangeISO(d)
      // เวลาแบบ UTC (…Z) ในตัวกรอง or=(…) — ไม่มีเครื่องหมาย '+' ของ +07:00 ให้ต้องกังวลเรื่องการเข้ารหัส URL
      const startISO = new Date(range.startISO).toISOString()
      const endISO = new Date(range.endISO).toISOString()
      // วันของรายการ = วันที่เงินเข้า/ออกจริง (กฎเดียวกับภาพรวมวันนี้/รายงาน/ใบเสร็จ):
      //   ยืนยันแล้ว → confirmed_at (สลิปที่แจ้งเมื่อวานแต่อนุมัติวันนี้ = เงินของวันนี้) · รอตรวจ/ไม่อนุมัติ → เวลาที่แจ้ง (created_at)
      const data = await fetchAllRows<unknown>(async (from, to) => {
        const res = await supabase
          .from('rental_payments')
          .select(PAYMENT_ROW_COLUMNS)
          .or(
            `and(status.eq.confirmed,confirmed_at.gte.${startISO},confirmed_at.lt.${endISO}),` +
            `and(status.neq.confirmed,created_at.gte.${startISO},created_at.lt.${endISO})`,
          )
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to)
        if (res.error) rawError = rawError ?? res.error
        return res
      })
      if (id !== dayReqRef.current) return
      // เรียงตามเวลาเงินเข้า/ออกจริง (ล่าสุดก่อน) — หน้าละรายการเรียงตามเวลาบันทึกเพื่อแบ่งหน้าได้คงที่
      const list = parsePaymentRows(data)
      list.sort((a, b) => {
        const ta = Date.parse(paymentMoneyTime(a))
        const tb = Date.parse(paymentMoneyTime(b))
        if (ta !== tb) return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0)
        return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
      })
      setRows(list)
      setRowsDay(d)
      setError('')
      dayLoadedAtRef.current = Date.now()
    } catch (err) {
      if (id !== dayReqRef.current) return
      if (!silent) {
        setRows([])
        setRowsDay('')
        setError(rentalErrorText(rawError ?? err))
      }
    } finally {
      if (id === dayReqRef.current) setLoading(false)
    }
  }, [supabase])

  // ---------- ลิงก์รูปสลิป (ขอเฉพาะที่ยังไม่มี/ใกล้หมดอายุ) ----------
  const ensureSlipUrls = useCallback(async (list: readonly PaymentRow[], force = false) => {
    const now = Date.now()
    const paths = list
      .map(r => r.slip_path)
      .filter((p): p is string => !!p && (force || !isFreshSlipUrl(slipUrlsRef.current[p], now)))
    if (paths.length === 0) return
    const signed = await signSlipUrls(supabase, paths)
    slipUrlsRef.current = { ...slipUrlsRef.current, ...signed }
    setSlipUrls(slipUrlsRef.current)
  }, [supabase])

  // ---------- โหลดสลิปรอตรวจ ----------
  const loadSlips = useCallback(async (silent = false) => {
    const id = ++slipReqRef.current
    if (!silent) {
      setSlipsLoading(true)
      setSlipsError('')
    }
    try {
      const { data, error: qError } = await supabase
        .from('rental_payments')
        .select(PAYMENT_ROW_COLUMNS)
        .eq('status', 'pending_review')
        .is('voided_at', null)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(SLIP_LIMIT)
      if (id !== slipReqRef.current) return
      if (qError) {
        if (!silent) setSlipsError(rentalErrorText(qError))
        return
      }
      const list = parsePaymentRows(data)
      setSlips(list)
      setSlipsLoaded(true)
      setSlipsError('')
      slipsLoadedAtRef.current = Date.now()
      void ensureSlipUrls(list)
    } catch (err) {
      if (id === slipReqRef.current && !silent) setSlipsError(rentalErrorText(err))
    } finally {
      if (id === slipReqRef.current) setSlipsLoading(false)
    }
  }, [supabase, ensureSlipUrls])

  // โหลดครั้งแรก
  useEffect(() => {
    void loadDay(dayRef.current)
    void loadSlips()
  }, [loadDay, loadSlips])

  // เขียนวัน/แท็บลง URL (?day= &tab=) — โหลดหน้าใหม่แล้วยังอยู่ที่เดิม ; วันนี้ + แท็บรายการ = ไม่ใส่
  const syncUrl = useCallback((d: string, t: Tab, todayK: string) => {
    try {
      const url = new URL(window.location.href)
      if (d === todayK) url.searchParams.delete('day')
      else url.searchParams.set('day', d)
      if (t === 'slips') url.searchParams.set('tab', 'slips')
      else url.searchParams.delete('tab')
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    } catch {
      // แก้ URL ไม่ได้ ไม่เป็นไร — แค่โหลดหน้าใหม่แล้วกลับไปค่าเริ่มต้น
    }
  }, [])

  function changeDay(next: string) {
    if (!isDayKey(next)) return
    const t = bangkokTodayKey()
    setTodayKey(t)
    const target = next > t ? t : next
    if (target === dayRef.current && rowsDay === target) return
    dayRef.current = target
    setDay(target)
    setFilter('all')
    syncUrl(target, tab, t)
    void loadDay(target)
  }

  function changeTab(next: Tab) {
    setTab(next)
    syncUrl(dayRef.current, next, todayKey)
    // เปิดแท็บสลิปแล้วลิงก์รูปเก่าใกล้หมดอายุ → ขอใหม่
    if (next === 'slips') void ensureSlipUrls(slips)
  }

  // กลับมาที่แท็บ: อัปเดต "วันนี้" + โหลดใหม่เงียบๆ เมื่อทิ้งไว้นาน (ไม่ทำระหว่างเปิดป็อปอัปตรวจสลิป)
  const reviewOpenRef = useRef(false)
  reviewOpenRef.current = reviewId !== null
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      const t = bangkokTodayKey()
      setTodayKey(k => (t > k ? t : k))
      if (reviewOpenRef.current) return
      const now = Date.now()
      if (now - slipsLoadedAtRef.current > STALE_MS) void loadSlips(true)
      if (now - dayLoadedAtRef.current > STALE_MS) void loadDay(dayRef.current, true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loadDay, loadSlips])

  // โทสต์สำเร็จหายเองใน 5 วินาที
  useEffect(() => {
    if (!toast || !toast.ok) return
    const t = window.setTimeout(() => setToast(null), 5000)
    return () => window.clearTimeout(t)
  }, [toast])

  // ---------- ตรวจสลิป ----------
  const reviewRow = reviewId ? slips.find(s => s.id === reviewId) ?? null : null

  function openReview(row: PaymentRow) {
    setReviewId(row.id)
    void ensureSlipUrls([row])
  }

  const closeReview = useCallback(() => setReviewId(null), [])

  const handleReviewed = useCallback((r: SlipReviewResult) => {
    const row = slips.find(s => s.id === r.paymentId)
    const no = row?.booking?.booking_no ?? ''
    setReviewId(null)
    setSlips(prev => prev.filter(s => s.id !== r.paymentId))
    const amt = r.amount !== null ? ` ยอด ${baht(r.amount)}` : ''
    // อนุมัติสลิปของการจองที่ปิดไปแล้ว → คำเตือนให้คืนเงินเข้ากล่องแดงของตัวเอง (โทสต์ถัดไปไม่ทับ — อยู่จนกดปิด)
    if (r.approved && r.warning) {
      const warn = r.warning
      setRefundWarnings(prev => [
        ...prev.filter(w => w.id !== r.paymentId),
        { id: r.paymentId, bookingId: row?.booking?.id ?? null, text: `อนุมัติสลิป${no ? ` ${no}` : ''}${amt} แล้ว — ${warn}` },
      ])
      setToast(null)
    } else {
      setToast({
        ok: true,
        text: r.approved
          ? `อนุมัติสลิป${no ? ` ${no}` : ''}${amt} แล้ว${r.autoConfirmed ? ' · ยืนยันการจองให้แล้ว' : ''}`
          : `ปฏิเสธสลิป${no ? ` ${no}` : ''} แล้ว`,
      })
    }
    // อนุมัติแล้ว = เงินของวันนี้ (วันอนุมัติ) / ปฏิเสธ = สถานะในรายการของวันที่แจ้งเปลี่ยน → โหลดวันที่เปิดดูอยู่ใหม่
    void loadDay(dayRef.current, true)
    // ตัวเลขบนเมนู (สลิปรอตรวจ / คำขอจองออนไลน์) อยู่ใน layout ฝั่งเซิร์ฟเวอร์
    if (navigator.onLine !== false) router.refresh()
  }, [slips, loadDay, router])

  const handleStale = useCallback(() => {
    setReviewId(null)
    void loadSlips()
    if (navigator.onLine !== false) router.refresh()
  }, [loadSlips, router])

  // ---------- คำนวณ ----------
  const shown = rowsDay === day && !error
  const totals = useMemo(() => dayMoneyTotals(shown ? rows : []), [rows, shown])
  const visibleRows = shown ? rows.filter(r => matchFilter(r, filter)) : []
  const isToday = day === todayKey
  const methodsShown = RENTAL_CASH_METHODS.filter(m => m === 'cash' || totals.by_method[m].count > 0)
  const kindsShown = RENTAL_PAYMENT_KINDS.filter(k => totals.by_kind[k].count > 0)

  function startPrint() {
    if (!shown || printing) return
    setPrintedAt(new Date().toISOString())
    setPrinting(true)
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">การเงิน</h1>
          <p className="page-subtitle">รายการรับ-จ่ายเงินประจำวัน ตรวจสลิปโอนเงินจากลูกค้า และพิมพ์สรุปยอด</p>
        </div>
        {tab === 'day' && (
        <div className="page-actions">
          <button
            type="button"
            onClick={startPrint}
            disabled={!shown || loading}
            className="btn-secondary w-full sm:w-auto"
          >
            <Printer {...ICON_SM} />
            พิมพ์สรุปยอดวัน
          </button>
        </div>
        )}
      </div>

      {refundWarnings.length > 0 && (
        <div className="sticky top-2 z-30 space-y-2" role="alert">
          {refundWarnings.map(w => (
            <div key={w.id} className="alert-err shadow-sm">
              <AlertCircle {...ICON_SM} />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="break-words font-medium">{w.text}</p>
                {w.bookingId && (
                  <Link
                    href={`/rental/bookings/${encodeURIComponent(w.bookingId)}`}
                    className="inline-flex min-h-[44px] items-center font-semibold underline underline-offset-2"
                  >
                    เปิดการจองเพื่อบันทึกคืนเงิน
                  </Link>
                )}
              </div>
              <button
                type="button"
                onClick={() => setRefundWarnings(prev => prev.filter(x => x.id !== w.id))}
                className="btn-icon btn-icon-plain -my-1 -mr-2 shrink-0 text-current"
                aria-label="ปิดคำเตือนนี้"
              >
                <X {...ICON_SM} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ===== แท็บ ===== */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="หมวดการเงิน">
        <button
          type="button"
          onClick={() => changeTab('day')}
          className="chip-toggle"
          aria-pressed={tab === 'day'}
        >
          <Wallet {...ICON_XS} />
          รายการเงินของวัน
        </button>
        <button
          type="button"
          onClick={() => changeTab('slips')}
          className="chip-toggle"
          aria-pressed={tab === 'slips'}
        >
          <ClipboardCheck {...ICON_XS} />
          สลิปรอตรวจ
          {slipsLoaded && <span className="tabular-nums">({fmtCount(slips.length)}{slips.length >= SLIP_LIMIT ? '+' : ''})</span>}
        </button>
      </div>

      {/* ===================== รายการเงินของวัน ===================== */}
      {tab === 'day' && (
        <div className="space-y-4 sm:space-y-6">
          {/* เลือกวัน */}
          <div className="card p-3 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => changeDay(addDaysToKey(day, -1))}
                  className="btn-icon shrink-0"
                  aria-label="วันก่อนหน้า"
                >
                  <ChevronLeft {...ICON} />
                </button>
                <input
                  type="date"
                  className="input min-w-0 flex-1 tabular-nums sm:w-44 sm:flex-none"
                  value={day}
                  max={todayKey}
                  onChange={e => { if (e.target.value) changeDay(e.target.value) }}
                  aria-label="เลือกวัน"
                  aria-describedby="pay-day-caption"
                />
                <button
                  type="button"
                  onClick={() => changeDay(addDaysToKey(day, 1))}
                  disabled={day >= todayKey}
                  className="btn-icon shrink-0"
                  aria-label="วันถัดไป"
                >
                  <ChevronRight {...ICON} />
                </button>
              </div>
              <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <p id="pay-day-caption" className="min-w-0 text-sm font-semibold text-gray-900 sm:text-base">
                  {formatThaiDayLong(day)}
                  {isToday && <span className="chip ml-2 align-middle">วันนี้</span>}
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  {!isToday && (
                    <button type="button" onClick={() => changeDay(todayKey)} className="btn-secondary px-3">
                      วันนี้
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void loadDay(day)}
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
                <button type="button" onClick={() => void loadDay(day)} className="btn-secondary bg-white px-4 text-sm">
                  <RefreshCw {...ICON_SM} />
                  ลองอีกครั้ง
                </button>
              </div>
            </div>
          ) : !shown ? (
            <div className="space-y-4" role="status">
              <span className="sr-only">กำลังโหลดรายการเงินของวันที่เลือก...</span>
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
                <StatCard label="เงินเข้า" value={baht(totals.cash_in)} sub={`${fmtCount(totals.count)} รายการ`} icon={ArrowDownLeft} />
                <StatCard label="เงินออก" value={baht(totals.cash_out)} icon={ArrowUpRight} />
                <StatCard label="รายได้ค่าเช่าสุทธิ" value={signedBaht(totals.rent_income)} sub="ไม่รวมเงินประกัน" icon={TrendingUp} />
                <StatCard label="เงินเข้าสุทธิ" value={signedBaht(totals.net)} icon={Wallet} hot />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
                {/* แยกตามวิธี */}
                <section className="card min-w-0 space-y-3 p-4 sm:p-5" aria-labelledby="pay-method-title">
                  <h2 id="pay-method-title" className="section-title">
                    <Banknote {...ICON} />
                    แยกตามวิธีชำระ
                  </h2>
                  <div className="table-wrap">
                    <table className="table-soft min-w-[320px]">
                      <thead>
                        <tr>
                          <th>วิธี</th>
                          <th className="text-right">เข้า</th>
                          <th className="text-right">ออก</th>
                          <th className="text-right">สุทธิ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {methodsShown.map(m => {
                          const t = totals.by_method[m]
                          return (
                            <tr key={m}>
                              <td className="whitespace-nowrap">
                                {METHOD_LABELS[m]}
                                <span className="ml-1 text-xs text-gray-500 tabular-nums">({fmtCount(t.count)})</span>
                              </td>
                              <td className="text-right tabular-nums whitespace-nowrap">{baht(t.in)}</td>
                              <td className="text-right tabular-nums whitespace-nowrap">{t.out > 0 ? `-${baht(t.out)}` : baht(0)}</td>
                              <td className={clsx('text-right font-semibold tabular-nums whitespace-nowrap', t.net < 0 ? 'text-red-700' : 'text-gray-900')}>
                                {signedBaht(t.net)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="panel p-3 text-sm">
                    <SummaryLine label={isToday ? 'เงินสดที่ควรเพิ่มในลิ้นชักวันนี้' : 'เงินสดที่ควรเพิ่มในลิ้นชักของวันนั้น'} value={signedBaht(totals.by_method.cash.net)} strong />
                    <p className="mt-1 text-xs text-gray-500">= รับเงินสด − จ่ายคืนเป็นเงินสด (ยังไม่รวมเงินทอนตั้งต้น)</p>
                  </div>
                </section>

                {/* แยกตามประเภท */}
                <section className="card min-w-0 space-y-3 p-4 sm:p-5" aria-labelledby="pay-kind-title">
                  <h2 id="pay-kind-title" className="section-title">
                    <ReceiptText {...ICON} />
                    แยกตามประเภท
                  </h2>
                  {kindsShown.length === 0 ? (
                    <p className="panel p-3 text-sm text-gray-500">{isToday ? 'ยังไม่มีรายการเงินที่ยืนยันแล้วในวันนี้' : 'ไม่มีรายการเงินที่ยืนยันแล้วในวันนั้น'}</p>
                  ) : (
                    <div className="panel space-y-1.5 p-3 text-sm">
                      {kindsShown.map(k => (
                        <SummaryLine
                          key={k}
                          label={`${PAYMENT_KIND_LABELS[k]} (${fmtCount(totals.by_kind[k].count)})`}
                          value={k === 'refund' || k === 'security_out' ? `-${baht(totals.by_kind[k].amount)}` : baht(totals.by_kind[k].amount)}
                        />
                      ))}
                    </div>
                  )}
                  {(totals.voided.count > 0 || totals.pending.count > 0 || totals.rejected.count > 0) && (
                    <ul className="space-y-1 text-xs text-gray-600">
                      {totals.voided.count > 0 && (
                        <li>ยกเลิกแล้ว {fmtCount(totals.voided.count)} รายการ ({baht(totals.voided.amount)}) — ไม่นับในยอด</li>
                      )}
                      {totals.pending.count > 0 && (
                        <li>สลิปที่แจ้ง{isToday ? 'วันนี้' : 'ในวันนั้น'}ยังรอตรวจ {fmtCount(totals.pending.count)} ใบ ({baht(totals.pending.amount)}) — นับเมื่ออนุมัติแล้ว</li>
                      )}
                      {totals.rejected.count > 0 && <li>สลิปที่ไม่อนุมัติ {fmtCount(totals.rejected.count)} ใบ</li>}
                    </ul>
                  )}
                  <p className="flex items-start gap-1.5 text-xs text-gray-500">
                    <Info {...ICON_XS} className="mt-px shrink-0" />
                    <span className="min-w-0">
                      &quot;หักเงินประกัน&quot; เป็นรายได้ค่าเช่า แต่ไม่มีเงินเข้า-ออกจริง จึงไม่อยู่ในเงินเข้า/เงินออก
                    </span>
                  </p>
                </section>
              </div>

              {/* รายการ */}
              <section className="card overflow-hidden" aria-labelledby="pay-list-title">
                <div className="card-header flex-wrap gap-2">
                  <h2 id="pay-list-title" className="section-title">
                    <Wallet {...ICON} />
                    {isToday ? 'รายการเงินวันนี้' : `รายการเงินวันที่ ${formatThaiDate(day)}`}
                  </h2>
                  <span className="chip tabular-nums">{fmtCount(rows.length)} รายการ</span>
                </div>
                <div className="flex flex-wrap gap-2 border-b border-gray-150 px-4 py-3 sm:px-5" role="group" aria-label="กรองรายการ">
                  {FILTERS.map(f => (
                    <button
                      key={f.value}
                      type="button"
                      className="chip-toggle"
                      aria-pressed={filter === f.value}
                      onClick={() => setFilter(f.value)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {visibleRows.length === 0 ? (
                  <div className="empty-state">
                    <span className="icon-bubble icon-bubble-lg">
                      <Inbox size={28} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    <p className="empty-state-title">
                      {rows.length === 0 ? (isToday ? 'ยังไม่มีรายการเงินในวันนี้' : 'ไม่มีรายการเงินในวันนั้น') : 'ไม่มีรายการตามที่กรอง'}
                    </p>
                  </div>
                ) : (
                  <>
                    {/* มือถือ: แตะทั้งแถว → หน้าการจอง */}
                    <ul className="md:hidden divide-y divide-gray-150">
                      {visibleRows.map(p => (
                        <li key={p.id}>
                          <PaymentMobileRow p={p} />
                        </li>
                      ))}
                    </ul>

                    {/* จอกว้าง: ตาราง */}
                    <div className="hidden md:block table-wrap">
                      <table className="table-soft min-w-[760px]">
                        <thead>
                          <tr>
                            <th>เวลา</th>
                            <th>เลขที่ใบเสร็จ</th>
                            <th>การจอง / ลูกค้า</th>
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
                                {formatThaiTime(paymentMoneyTime(p))}
                                {slipApprovedLater(p) && <span className="block">แจ้งเมื่อ {formatThaiDateTime(p.created_at)}</span>}
                              </td>
                              <td className="whitespace-nowrap font-mono text-xs text-gray-700">{p.receipt_no ?? '-'}</td>
                              <td className="min-w-0">
                                {p.booking ? (
                                  <Link
                                    href={`/rental/bookings/${encodeURIComponent(p.booking.id)}`}
                                    className="link font-mono text-xs"
                                  >
                                    {p.booking.booking_no}
                                  </Link>
                                ) : (
                                  <span className="text-xs text-gray-400">-</span>
                                )}
                                {p.booking?.customer_name && (
                                  <span className="block text-sm text-gray-700 break-words">{p.booking.customer_name}</span>
                                )}
                              </td>
                              <td className="text-sm">
                                <span className="block whitespace-nowrap text-gray-900">{PAYMENT_KIND_LABELS[p.kind]}</span>
                                <PaymentStateChip p={p} />
                                {p.voided_at && p.void_reason && (
                                  <span className="block text-xs text-gray-500 break-words">เหตุผล: {p.void_reason}</span>
                                )}
                              </td>
                              <td className="whitespace-nowrap text-sm text-gray-600">{METHOD_LABELS[p.method]}</td>
                              <td className="text-right"><AmountText p={p} /></td>
                              <td className="text-xs text-gray-500 break-words">{p.created_by_name ?? (p.status === 'confirmed' ? '-' : 'ลูกค้า (ออนไลน์)')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
            </div>
          )}
        </div>
      )}

      {/* ===================== สลิปรอตรวจ ===================== */}
      {tab === 'slips' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 text-sm text-gray-600">
              สลิปที่ลูกค้าแนบจากลิงก์จองออนไลน์ — ตรวจยอดกับแอปธนาคารของร้านก่อนอนุมัติ (เรียงจากที่แจ้งก่อน)
            </p>
            <button
              type="button"
              onClick={() => void loadSlips()}
              disabled={slipsLoading}
              className="btn-secondary px-3 text-sm"
            >
              <RefreshCw {...ICON_SM} className={slipsLoading ? 'animate-spin' : undefined} />
              โหลดใหม่
            </button>
          </div>

          {slipsError ? (
            <div role="alert" className="alert-err">
              <XCircle {...ICON_SM} />
              <div className="min-w-0 space-y-2">
                <p className="break-words">{slipsError}</p>
                <button type="button" onClick={() => void loadSlips()} className="btn-secondary bg-white px-4 text-sm">
                  <RefreshCw {...ICON_SM} />
                  ลองอีกครั้ง
                </button>
              </div>
            </div>
          ) : !slipsLoaded ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" role="status">
              <span className="sr-only">กำลังโหลดสลิป...</span>
              {[0, 1].map(i => <div key={i} className="skeleton h-40 rounded-xl" />)}
            </div>
          ) : slips.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <span className="icon-bubble icon-bubble-lg icon-bubble-ok">
                  <ShieldCheck size={28} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <p className="empty-state-title">ไม่มีสลิปรอตรวจ</p>
                <p className="text-sm text-gray-500">เมื่อลูกค้าแนบสลิปจากหน้าจองออนไลน์ รายการจะขึ้นที่นี่</p>
              </div>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label="สลิปรอตรวจ">
              {slips.map(s => (
                <li key={s.id} className="card flex min-w-0 gap-3 p-3 sm:p-4">
                  <SlipThumb row={s} slip={s.slip_path ? slipUrls[s.slip_path] : undefined} onOpen={() => openReview(s)} />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {s.booking ? (
                        <Link href={`/rental/bookings/${encodeURIComponent(s.booking.id)}`} className="link font-mono text-sm">
                          {s.booking.booking_no}
                        </Link>
                      ) : (
                        <span className="font-mono text-sm text-gray-500">-</span>
                      )}
                      {s.booking && <span className={STATUS_CHIP[s.booking.status]}>{STATUS_LABELS[s.booking.status]}</span>}
                    </div>
                    <p className="text-sm text-gray-900 break-words">
                      {s.booking?.customer_name || '-'}
                      {s.booking?.customer_phone && (
                        <span className="text-gray-500 tabular-nums"> · {formatPhone(s.booking.customer_phone)}</span>
                      )}
                    </p>
                    <p className="money text-xl text-gray-900">{baht(s.amount)}</p>
                    <p className="text-xs text-gray-500 tabular-nums">แจ้งเมื่อ {formatThaiDateTime(s.created_at)}</p>
                    {s.booking && (
                      <p className="text-xs text-gray-600 tabular-nums">
                        ค้างชำระ {baht(s.booking.due)} · มัดจำ {baht(s.booking.deposit_required)}
                        {s.booking.deposit_met ? ' (ครบแล้ว)' : ''}
                      </p>
                    )}
                    {s.booking?.status === 'pending' && s.booking.expires_at && (
                      <p className="text-xs text-gray-600 tabular-nums">ถือจองถึง {formatThaiDateTime(s.booking.expires_at)}</p>
                    )}
                    {s.note && <p className="text-xs text-gray-600 break-words">หมายเหตุ: {s.note}</p>}
                    <div className="pt-1">
                      <button type="button" onClick={() => openReview(s)} className="btn-primary w-full sm:w-auto px-4">
                        <ClipboardCheck {...ICON_SM} />
                        ตรวจสลิป
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {slips.length >= SLIP_LIMIT && (
            <p className="text-xs text-gray-500">แสดง {fmtCount(SLIP_LIMIT)} ใบแรก — ตรวจรอบนี้เสร็จแล้วกด &quot;โหลดใหม่&quot; เพื่อดูใบที่เหลือ</p>
          )}
        </div>
      )}

      <SlipReviewDialog
        open={reviewRow !== null}
        row={reviewRow}
        slip={reviewRow?.slip_path ? slipUrls[reviewRow.slip_path] : undefined}
        supabase={supabase}
        onClose={closeReview}
        onDone={handleReviewed}
        onReloadSlip={() => { if (reviewRow) void ensureSlipUrls([reviewRow], true) }}
        onStale={handleStale}
      />

      <PrintPortal open={printing} paper="80" onDone={() => setPrinting(false)}>
        <PaymentsDayPrint
          shopName={shopName}
          day={day}
          rows={shown ? rows : []}
          totals={totals}
          pendingSlips={slips.length}
          printedAt={printedAt || new Date().toISOString()}
        />
      </PrintPortal>

      {toast && (
        <div
          role={toast.ok ? 'status' : 'alert'}
          aria-live="polite"
          className="pointer-events-none fixed inset-x-4 z-40 flex justify-center bottom-[calc(1rem_+_env(safe-area-inset-bottom))] md:left-[calc(15rem_+_1rem)] lg:bottom-6"
        >
          <div className={clsx(toast.ok ? 'toast-ok' : 'toast-err', 'pointer-events-auto')}>
            <span className="toast-icon">
              {toast.ok
                ? <Check size={18} strokeWidth={2.4} aria-hidden="true" />
                : <X size={18} strokeWidth={2.4} aria-hidden="true" />}
            </span>
            <span className="min-w-0 break-words">{toast.text}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="btn-icon btn-icon-plain -my-1 -mr-3 text-current"
              aria-label="ปิดข้อความ"
            >
              <X {...ICON_SM} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// สลิปที่อนุมัติทีหลัง (เวลาเงินเข้า ≠ เวลาที่ลูกค้าแจ้ง เกิน 1 นาที) → แสดงเวลาแจ้งเดิมกำกับ
function slipApprovedLater(p: PaymentRow): boolean {
  if (!p.slip_path || p.status !== 'confirmed' || !p.confirmed_at) return false
  const a = Date.parse(p.confirmed_at)
  const b = Date.parse(p.created_at)
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 60000
}

// แถวรายการเงินบนมือถือ — มีการจอง = ทั้งแถวเป็นลิงก์ไปหน้าการจอง
function PaymentMobileRow({ p }: { p: PaymentRow }) {
  const body = (
    <>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm text-gray-900">
          {PAYMENT_KIND_LABELS[p.kind]}
          <span className="text-gray-500"> · {METHOD_LABELS[p.method]}</span>
        </p>
        <p className="text-xs text-gray-500 tabular-nums break-all">
          {formatThaiTime(paymentMoneyTime(p))}
          {p.receipt_no ? ` · ${p.receipt_no}` : ''}
          {slipApprovedLater(p) ? ` · แจ้งเมื่อ ${formatThaiDateTime(p.created_at)}` : ''}
        </p>
        {p.booking && (
          <p className="text-xs text-gray-600 break-words">
            <span className="font-mono">{p.booking.booking_no}</span>
            {p.booking.customer_name ? ` · ${p.booking.customer_name}` : ''}
          </p>
        )}
        {p.voided_at && p.void_reason && <p className="text-xs text-gray-500 break-words">เหตุผลยกเลิก: {p.void_reason}</p>}
      </div>
      <div className="shrink-0 space-y-1 text-right">
        <AmountText p={p} />
        <div><PaymentStateChip p={p} /></div>
      </div>
    </>
  )
  if (!p.booking) return <div className="flex items-start gap-3 px-4 py-3">{body}</div>
  return (
    <Link
      href={`/rental/bookings/${encodeURIComponent(p.booking.id)}`}
      className="flex min-h-[56px] items-start gap-3 px-4 py-3 active:bg-gray-50"
      aria-label={`${PAYMENT_KIND_LABELS[p.kind]} ${baht(p.amount)} การจอง ${p.booking.booking_no}`}
    >
      {body}
    </Link>
  )
}

// รูปย่อสลิป (กดเพื่อเปิดป็อปอัปตรวจ)
function SlipThumb({ row, slip, onOpen }: { row: PaymentRow; slip: SignedSlipUrl | undefined; onOpen: () => void }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [slip?.url])
  const label = `ดูสลิปของการจอง ${row.booking?.booking_no ?? ''}`
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative flex h-32 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
      aria-label={label}
    >
      {!row.slip_path ? (
        <FileWarning size={24} strokeWidth={1.75} aria-hidden="true" className="text-gray-400" />
      ) : slip === undefined ? (
        <span className="skeleton block h-full w-full" aria-hidden="true" />
      ) : !slip.url || failed ? (
        <span className="px-2 text-center text-[11px] leading-tight text-gray-500">แตะเพื่อโหลดรูป</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={slip.url} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => setFailed(true)} />
      )}
    </button>
  )
}
