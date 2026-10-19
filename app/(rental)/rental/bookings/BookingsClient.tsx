'use client'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  AlertTriangle, Ban, CalendarRange, ChevronRight, ClipboardList, Clock, Globe, Loader2, RefreshCw, Search, SearchX,
  X, XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import {
  addDaysToKey, bangkokDayRangeISO, bangkokTodayKey, baht, daysBetweenKeys, formatThaiDate, isDayKey, thaiError,
} from '@/lib/format'
import { num } from '@/lib/money'
import { isMigrationMissing } from '@/lib/migration'
import {
  FIX05_MISSING_MSG, RENTAL_BOOKING_STATUSES, RENTAL_SOURCES, SOURCE_LABELS, STATUS_CHIP, formatPhone, rentalDays,
  sizeLabel, statusLabel, type RentalBookingStatus, type RentalSource,
} from '@/lib/rental'
import MigrationNotice from '@/components/pos/MigrationNotice'
import { BOOKING_TABS, type BookingTab } from '@/components/rental/booking-form/bookingTabs'
import { cleanBookingNoTerm, searchCustomerIds } from '@/components/rental/booking-form/search'

// รายการการจองร้านเช่าชุด — แท็บตามสถานะ / ค้นหา (เลขที่การจอง ชื่อ เบอร์โทร LINE) / กรองช่วงวันที่ / โหลดเพิ่มทีละหน้า
// แตะแถว = เปิดหน้ารายละเอียดการจอง (ยืนยัน รับชุด คืนชุด รับเงิน พิมพ์สัญญา อยู่ที่หน้านั้น)

const PAGE_SIZE = 50
const SEARCH_LIMIT = 50
const LOAD_TIMEOUT_MS = 20000
const LOAD_TIMEOUT_MSG = 'เซิร์ฟเวอร์ตอบช้าเกินไป — กดปุ่มโหลดใหม่อีกครั้ง'
const COLUMNS =
  'id, booking_no, status, source, pickup_date, return_date, pickup_time, grand_total, paid, due, deposit_required, deposit_met, ' +
  'security_required, security_held, expires_at, created_at, ' +
  'customer:rental_customers(name, phone, is_blacklisted), lines:rental_booking_lines(id, size, item:rental_items(code, name))'

type DateField = 'pickup' | 'return' | 'created'
const DATE_FIELDS: { value: DateField; label: string }[] = [
  { value: 'pickup', label: 'วันรับชุด' },
  { value: 'return', label: 'วันคืนชุด' },
  { value: 'created', label: 'วันที่สร้าง' },
]

interface BookingRow {
  id: string
  booking_no: string
  status: RentalBookingStatus
  source: RentalSource
  pickup_date: string
  return_date: string
  pickup_time: string | null
  grand_total: number
  paid: number
  due: number
  deposit_required: number
  deposit_met: boolean
  security_held: number
  expires_at: string | null
  created_at: string
  customer_name: string
  customer_phone: string
  customer_blacklisted: boolean
  items: { code: string; name: string; size: string | null }[]
}

type Obj = Record<string, unknown>
const asObj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null)
const s = (v: unknown): string => (typeof v === 'string' ? v : '')
const sn = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)

function toRow(raw: unknown): BookingRow | null {
  const o = asObj(raw)
  if (!o) return null
  const id = s(o.id)
  if (!id) return null
  // embed แบบ to-one อาจมาเป็น object หรือ array (แล้วแต่รุ่น PostgREST) → รับทั้งสองแบบ
  const custRaw = Array.isArray(o.customer) ? o.customer[0] : o.customer
  const cust = asObj(custRaw) ?? {}
  const items: BookingRow['items'] = []
  if (Array.isArray(o.lines)) {
    for (const l of o.lines) {
      const lo = asObj(l)
      if (!lo) continue
      const itRaw = Array.isArray(lo.item) ? lo.item[0] : lo.item
      const it = asObj(itRaw) ?? {}
      items.push({ code: s(it.code), name: s(it.name), size: sn(lo.size) })
    }
  }
  const status = (RENTAL_BOOKING_STATUSES as readonly string[]).includes(s(o.status)) ? (s(o.status) as RentalBookingStatus) : 'pending'
  const source = (RENTAL_SOURCES as readonly string[]).includes(s(o.source)) ? (s(o.source) as RentalSource) : 'walkin'
  return {
    id,
    booking_no: s(o.booking_no),
    status,
    source,
    pickup_date: s(o.pickup_date).slice(0, 10),
    return_date: s(o.return_date).slice(0, 10),
    pickup_time: sn(o.pickup_time),
    grand_total: num(o.grand_total),
    paid: num(o.paid),
    due: num(o.due),
    deposit_required: num(o.deposit_required),
    deposit_met: o.deposit_met === true,
    security_held: num(o.security_held),
    expires_at: sn(o.expires_at),
    created_at: s(o.created_at),
    customer_name: s(cust.name),
    customer_phone: s(cust.phone),
    customer_blacklisted: cust.is_blacklisted === true,
    items,
  }
}

// "อีก 3 วัน" / "วันนี้" / "พรุ่งนี้" / "เลยมา 2 วัน"
function relDay(today: string, key: string, word: string): string {
  const d = daysBetweenKeys(today, key)
  if (!Number.isFinite(d)) return ''
  if (d === 0) return `${word}วันนี้`
  if (d === 1) return `${word}พรุ่งนี้`
  if (d > 1) return `อีก ${d} วัน${word}`
  return `เลยวัน${word} ${-d} วัน`
}

// เวลาที่เหลือของการถือคิว (คำขอจองออนไลน์/รอยืนยัน)
function holdLeft(expiresAt: string | null, now: number): { text: string; urgent: boolean } | null {
  if (!expiresAt) return null
  const t = new Date(expiresAt).getTime()
  if (!Number.isFinite(t)) return null
  const ms = t - now
  if (ms <= 0) return { text: 'หมดเวลาถือคิวแล้ว', urgent: true }
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h >= 24) return { text: `ถือคิวอีก ${Math.floor(h / 24)} วัน ${h % 24} ชม.`, urgent: false }
  return { text: h > 0 ? `ถือคิวอีก ${h} ชม. ${m} นาที` : `ถือคิวอีก ${m} นาที`, urgent: h < 3 }
}

function itemsText(items: BookingRow['items']): string {
  if (items.length === 0) return '-'
  const shown = items.slice(0, 3).map(it => `${it.code || it.name} (${sizeLabel(it.size)})`)
  return items.length > 3 ? `${shown.join(', ')} และอีก ${items.length - 3} ชุด` : shown.join(', ')
}

export default function BookingsClient({
  initialTab,
  initialQuery,
  today,
}: {
  initialTab: BookingTab
  initialQuery: string
  today: string
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [todayKey, setTodayKey] = useState(today)
  const [tab, setTab] = useState<BookingTab>(initialTab)
  const [searchInput, setSearchInput] = useState(initialQuery)
  const [search, setSearch] = useState(initialQuery.trim())
  const [searchHint, setSearchHint] = useState('')
  const [dateOpen, setDateOpen] = useState(false)
  const [dateField, setDateField] = useState<DateField>('pickup')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [rows, setRows] = useState<BookingRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [moreError, setMoreError] = useState('')
  const [missing, setMissing] = useState(false)
  const [counts, setCounts] = useState<Partial<Record<BookingTab, number>>>({})
  const [now, setNow] = useState(() => Date.now())
  const reqRef = useRef(0)
  const offsetRef = useRef(0)

  const searching = search !== ''
  const fromOk = isDayKey(from)
  const toOk = isDayKey(to)
  const dateActive = fromOk || toOk
  const dateProblem = fromOk && toOk && to < from ? 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น' : ''

  // ===== โหลดรายการ =====
  const fetchPage = useCallback(async (offset: number) => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = setTimeout(() => ctrl?.abort(), LOAD_TIMEOUT_MS)
    try {
      let q = supabase.from('rental_bookings').select(COLUMNS)
      if (searching) {
        // เลขที่การจอง หรือ ลูกค้าที่ชื่อ/เบอร์/LINE ตรงคำค้น (หาลูกค้าก่อน แล้วค่อยกรองการจองด้วยรหัสลูกค้า)
        const term = cleanBookingNoTerm(search)
        const ids = await searchCustomerIds(supabase, search, 100, ctrl?.signal)
        const ors: string[] = []
        if (term) ors.push(`booking_no.ilike.%${term}%`)
        if (ids.length > 0) ors.push(`customer_id.in.(${ids.join(',')})`)
        if (ors.length === 0) return { rows: [] as BookingRow[], more: false }
        q = q.or(ors.join(','))
      } else {
        const today0 = bangkokTodayKey()
        switch (tab) {
          case 'pending':
            q = q.eq('status', 'pending').order('expires_at', { ascending: true, nullsFirst: false })
            break
          case 'confirmed':
            q = q.eq('status', 'confirmed').order('pickup_date', { ascending: true })
            break
          case 'active':
            q = q.eq('status', 'picked_up').gte('return_date', today0).order('return_date', { ascending: true })
            break
          case 'overdue':
            q = q.eq('status', 'picked_up').lt('return_date', today0).order('return_date', { ascending: true })
            break
          case 'returned':
            q = q.eq('status', 'returned').order('returned_at', { ascending: false, nullsFirst: false })
            break
          case 'completed':
            q = q.eq('status', 'completed').order('completed_at', { ascending: false, nullsFirst: false })
            break
          case 'cancelled':
            q = q.in('status', ['cancelled', 'expired', 'no_show']).order('updated_at', { ascending: false })
            break
        }
      }
      // ช่วงวันที่ (วันรับ/วันคืน = day key ตรงๆ ; วันที่สร้าง = ช่วงเวลาตามวันไทย)
      if (!dateProblem) {
        if (dateField === 'created') {
          if (fromOk) q = q.gte('created_at', bangkokDayRangeISO(from).startISO)
          if (toOk) q = q.lt('created_at', bangkokDayRangeISO(to).endISO)
        } else {
          const col = dateField === 'pickup' ? 'pickup_date' : 'return_date'
          if (fromOk) q = q.gte(col, from)
          if (toOk) q = q.lte(col, to)
        }
      }
      q = searching
        ? q.order('created_at', { ascending: false }).order('id', { ascending: false }).range(0, SEARCH_LIMIT - 1)
        : q.order('booking_no', { ascending: true }).range(offset, offset + PAGE_SIZE)
      if (ctrl) q = q.abortSignal(ctrl.signal)
      const { data, error: qError } = await q
      if (qError) throw qError
      const list: BookingRow[] = []
      for (const r of (data ?? []) as unknown[]) {
        const row = toRow(r)
        if (row) list.push(row)
      }
      const more = !searching && list.length > PAGE_SIZE
      return { rows: more ? list.slice(0, PAGE_SIZE) : list, more }
    } catch (err) {
      // หมดเวลา (รวมตอนค้นรหัสลูกค้าก่อน) → ข้อความไทยเดียวกัน ไม่ใช่ "AbortError"
      if (ctrl?.signal.aborted) throw new Error(LOAD_TIMEOUT_MSG)
      throw err
    } finally {
      clearTimeout(timer)
    }
  }, [supabase, searching, search, tab, dateField, from, to, fromOk, toOk, dateProblem])

  const load = useCallback(async (reset: boolean) => {
    const reqId = ++reqRef.current
    if (reset) {
      setLoading(true)
      setHasMore(false)
    } else {
      setLoadingMore(true)
    }
    setError('')
    setMoreError('')
    try {
      const offset = reset ? 0 : offsetRef.current
      const res = await fetchPage(offset)
      if (reqId !== reqRef.current) return
      offsetRef.current = offset + res.rows.length
      setHasMore(res.more)
      setNow(Date.now())
      setRows(prev => {
        if (reset) return res.rows
        const seen = new Set(prev.map(r => r.id))
        return [...prev, ...res.rows.filter(r => !seen.has(r.id))]
      })
    } catch (err) {
      if (reqId !== reqRef.current) return
      if (isMigrationMissing(err)) setMissing(true)
      if (reset) {
        setRows([])
        setError(isMigrationMissing(err) ? FIX05_MISSING_MSG : thaiError(err))
      } else {
        setMoreError(thaiError(err))
      }
    } finally {
      if (reqId === reqRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [fetchPage])

  // คำขอที่เลยเวลาถือคิวจะถูกเปลี่ยนเป็น "หมดเวลา" ตอนมีการเรียกฟังก์ชันของร้าน (ไม่ใช่ตอนอ่านตาราง)
  // → เรียก rental_badges() (ถูกและเบา — กวาดรายการหมดเวลาให้ด้วย) ก่อนโหลดรายการครั้งแรก/กดโหลดใหม่ เพื่อให้แท็บถูกต้อง
  const sweep = useCallback(async () => {
    try {
      await supabase.rpc('rental_badges')
    } catch {
      // กวาดไม่ได้ก็แสดงตามตาราง (แถวที่เลยเวลาแล้วมีป้าย "หมดเวลาถือคิวแล้ว" อยู่แล้ว)
    }
  }, [supabase])
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let alive = true
    void sweep().then(() => { if (alive) setReady(true) })
    return () => { alive = false }
  }, [sweep])

  useEffect(() => {
    if (ready) void load(true)
  }, [load, ready])

  // ===== จำนวนในแท็บงานที่ยังเปิดอยู่ (ไม่ขึ้นกับคำค้น/ช่วงวัน) =====
  const loadCounts = useCallback(async () => {
    const t0 = bangkokTodayKey()
    const base = () => supabase.from('rental_bookings').select('id', { count: 'exact', head: true })
    try {
      const [p, c, a, o, r] = await Promise.all([
        base().eq('status', 'pending'),
        base().eq('status', 'confirmed'),
        base().eq('status', 'picked_up').gte('return_date', t0),
        base().eq('status', 'picked_up').lt('return_date', t0),
        base().eq('status', 'returned'),
      ])
      const pick = (x: { count: number | null; error: unknown }) => (x.error ? undefined : x.count ?? 0)
      setCounts({ pending: pick(p), confirmed: pick(c), active: pick(a), overdue: pick(o), returned: pick(r) })
    } catch {
      // นับไม่ได้ = ไม่แสดงตัวเลขบนแท็บ
    }
  }, [supabase])

  useEffect(() => {
    if (ready) void loadCounts()
  }, [loadCounts, ready])

  async function refreshAll() {
    await sweep()
    void load(true)
    void loadCounts()
  }

  // กลับมาที่แท็บ (เช่น หลังยืนยันการจองในหน้ารายละเอียด/ข้ามเที่ยงคืน) → ตัวเลข/วันนี้/เวลาถือคิว ต้องตามทัน
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      setTodayKey(bangkokTodayKey())
      setNow(Date.now())
      void loadCounts()
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [loadCounts])

  // จำแท็บ/คำค้นไว้ใน URL (กดย้อนกลับจากหน้าการจองแล้วกลับมาที่แท็บเดิม)
  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', tab)
      if (search) url.searchParams.set('q', search)
      else url.searchParams.delete('q')
      if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url.href)
    } catch {
      // แก้ URL ไม่ได้ก็ไม่เป็นไร
    }
  }, [tab, search])

  function handleSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const raw = searchInput.trim()
    if (!raw) {
      setSearch('')
      setSearchHint('')
      return
    }
    if (raw.replace(/[%_*,()"'\\]/g, '').trim().length < 2 && !/^\d+$/.test(raw)) {
      setSearchHint('พิมพ์อย่างน้อย 2 ตัวอักษร (เลขที่การจอง ชื่อ เบอร์โทร หรือ LINE ID)')
      return
    }
    setSearchHint('')
    setSearch(raw.slice(0, 60))
  }

  function clearSearch() {
    setSearchInput('')
    setSearch('')
    setSearchHint('')
  }

  function preset(kind: 'today' | 'tomorrow' | 'week' | 'month') {
    const t = bangkokTodayKey()
    if (kind === 'today') { setFrom(t); setTo(t) }
    if (kind === 'tomorrow') { const n = addDaysToKey(t, 1); setFrom(n); setTo(n) }
    if (kind === 'week') { setFrom(t); setTo(addDaysToKey(t, 6)) }
    if (kind === 'month') {
      // วันที่ 1 + 31 วัน = อยู่ในเดือนถัดไปเสมอ → วันที่ 1 ของเดือนถัดไป − 1 วัน = วันสุดท้ายของเดือนนี้
      const first = `${t.slice(0, 8)}01`
      setFrom(first)
      setTo(addDaysToKey(`${addDaysToKey(first, 31).slice(0, 8)}01`, -1))
    }
  }

  function clearDates() {
    setFrom('')
    setTo('')
  }

  const tabInfo = BOOKING_TABS.find(t => t.key === tab) ?? BOOKING_TABS[0]
  const dateSummary = dateActive
    ? `${DATE_FIELDS.find(f => f.value === dateField)?.label ?? ''} ${fromOk ? formatThaiDate(from) : '...'} – ${toOk ? formatThaiDate(to) : '...'}`
    : ''

  // ข้อความเด่นของแถวตามแท็บ (สิ่งที่ต้องทำต่อ)
  function keyNote(r: BookingRow): { text: string; tone: 'red' | 'amber' | 'gray' } | null {
    if (r.status === 'pending') {
      const h = holdLeft(r.expires_at, now)
      return h ? { text: h.text, tone: h.urgent ? 'red' : 'amber' } : null
    }
    if (r.status === 'confirmed') {
      const d = daysBetweenKeys(todayKey, r.pickup_date)
      const text = relDay(todayKey, r.pickup_date, 'รับ')
      return text ? { text: r.pickup_time && d === 0 ? `${text} ${r.pickup_time} น.` : text, tone: d < 0 ? 'red' : d <= 1 ? 'amber' : 'gray' } : null
    }
    if (r.status === 'picked_up') {
      const d = daysBetweenKeys(todayKey, r.return_date)
      if (d < 0) return { text: `เกินกำหนดคืน ${-d} วัน`, tone: 'red' }
      return { text: relDay(todayKey, r.return_date, 'คืน'), tone: d <= 1 ? 'amber' : 'gray' }
    }
    if (r.status === 'returned' && r.security_held > 0.005) return { text: `ถือเงินประกัน ${baht(r.security_held)}`, tone: 'amber' }
    return null
  }

  function moneyNote(r: BookingRow): { text: string; tone: 'red' | 'amber' | 'green' | 'gray' } | null {
    const open = r.status === 'pending' || r.status === 'confirmed' || r.status === 'picked_up' || r.status === 'returned'
    if (r.due < -0.005) return { text: `รับเกิน ${baht(-r.due)}`, tone: 'amber' }
    if (!open) return null
    if ((r.status === 'pending' || r.status === 'confirmed') && r.deposit_required > 0.005 && !r.deposit_met) {
      return { text: r.paid > 0.005 ? `มัดจำยังไม่ครบ (ค้าง ${baht(r.due)})` : 'ยังไม่ได้มัดจำ', tone: 'amber' }
    }
    if (r.due > 0.005) return { text: `ค้าง ${baht(r.due)}`, tone: r.status === 'picked_up' || r.status === 'returned' ? 'red' : 'amber' }
    if (r.grand_total > 0) return { text: 'ชำระครบ', tone: 'green' }
    return null
  }

  const toneClass = (t: 'red' | 'amber' | 'green' | 'gray') =>
    t === 'red' ? 'text-red-700' : t === 'amber' ? 'text-amber-800' : t === 'green' ? 'text-green-700' : 'text-gray-500'

  if (missing && !loading && rows.length === 0) {
    return <MigrationNotice message={FIX05_MISSING_MSG} />
  }

  return (
    <div className="space-y-4">
      {/* ===== ค้นหา + ตัวกรอง ===== */}
      <section className="card p-4 sm:p-5 space-y-3" aria-label="ค้นหาและกรองการจอง">
        <form onSubmit={handleSearch} className="flex items-center gap-2" role="search">
          <div className="input-icon flex-1 min-w-0">
            <Search {...ICON_SM} />
            <input
              type="search"
              className="input pl-11"
              placeholder="เลขที่ ชื่อ เบอร์โทร"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={60}
              aria-label="ค้นหาการจอง"
              aria-describedby={searchHint ? 'bk-search-hint' : undefined}
            />
          </div>
          <button type="submit" className="btn-primary shrink-0 px-4">
            <Search {...ICON_SM} />
            <span className="hidden sm:inline">ค้นหา</span>
            <span className="sr-only sm:hidden">ค้นหา</span>
          </button>
          <button
            type="button"
            onClick={() => setDateOpen(o => !o)}
            className={clsx('btn-secondary shrink-0 px-3 sm:px-4', dateActive && 'border-brand-600')}
            aria-expanded={dateOpen}
            aria-controls="bk-date-panel"
          >
            <CalendarRange {...ICON_SM} />
            <span className="hidden sm:inline">ช่วงวันที่</span>
            <span className="sr-only sm:hidden">กรองช่วงวันที่</span>
          </button>
        </form>
        {searchHint && <p id="bk-search-hint" role="alert" className="text-xs font-medium text-red-700">{searchHint}</p>}

        {dateOpen && (
          <div id="bk-date-panel" className="panel p-3 space-y-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="กรองตามวันไหน">
              {DATE_FIELDS.map(f => (
                <button key={f.value} type="button" className="chip-toggle" aria-pressed={dateField === f.value} onClick={() => setDateField(f.value)}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor="bk-from" className="field-label">ตั้งแต่วันที่</label>
                <input
                  id="bk-from"
                  type="date"
                  className="input block min-w-0 appearance-none tabular-nums [&::-webkit-date-and-time-value]:text-left"
                  value={from}
                  onChange={e => setFrom(e.target.value)}
                />
                <p className="field-hint tabular-nums">{fromOk ? `พ.ศ. ${formatThaiDate(from)}` : 'ไม่จำกัด'}</p>
              </div>
              <div className="min-w-0">
                <label htmlFor="bk-to" className="field-label">ถึงวันที่</label>
                <input
                  id="bk-to"
                  type="date"
                  className="input block min-w-0 appearance-none tabular-nums [&::-webkit-date-and-time-value]:text-left"
                  value={to}
                  min={fromOk ? from : undefined}
                  aria-invalid={dateProblem ? true : undefined}
                  onChange={e => setTo(e.target.value)}
                />
                <p className={clsx('mt-1 text-xs tabular-nums', dateProblem ? 'font-medium text-red-700' : 'text-gray-500')}>
                  {dateProblem || (toOk ? `พ.ศ. ${formatThaiDate(to)}` : 'ไม่จำกัด')}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="ช่วงวันที่ด่วน">
              <button type="button" className="chip-toggle" onClick={() => preset('today')}>วันนี้</button>
              <button type="button" className="chip-toggle" onClick={() => preset('tomorrow')}>พรุ่งนี้</button>
              <button type="button" className="chip-toggle" onClick={() => preset('week')}>7 วันข้างหน้า</button>
              <button type="button" className="chip-toggle" onClick={() => preset('month')}>เดือนนี้</button>
              {dateActive && (
                <button type="button" className="btn-ghost px-3 text-sm" onClick={clearDates}>
                  <X {...ICON_SM} />
                  ล้างช่วงวันที่
                </button>
              )}
            </div>
          </div>
        )}

        {searching ? (
          <div className="panel flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <p className="min-w-0 text-sm text-gray-700 break-words">
              ผลค้นหา <b>{search}</b> จากทุกสถานะ (ล่าสุด {SEARCH_LIMIT} รายการ)
            </p>
            <button type="button" onClick={clearSearch} className="btn-ghost px-3 text-sm">
              <X {...ICON_SM} />
              ล้างการค้นหา
            </button>
          </div>
        ) : (
          // แท็บสถานะ: มือถือเลื่อนแนวนอนในกล่องของตัวเอง (หน้าไม่เลื่อนข้าง)
          <div className="-mx-4 overflow-x-auto px-4 scrollbar-none sm:-mx-5 sm:px-5" role="group" aria-label="สถานะการจอง">
            <div className="flex gap-2 md:flex-wrap">
              {BOOKING_TABS.map(t => {
                const n = counts[t.key]
                return (
                  <button
                    key={t.key}
                    type="button"
                    className={clsx('chip-toggle shrink-0', t.key === 'overdue' && (n ?? 0) > 0 && tab !== t.key && 'border-red-300 text-red-800')}
                    aria-pressed={tab === t.key}
                    onClick={() => setTab(t.key)}
                  >
                    {t.label}
                    {t.counted && n !== undefined && n > 0 && (
                      <span className={clsx(t.key === 'overdue' ? 'badge-out' : 'chip', 'h-5 px-1.5 tabular-nums')}>{n}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {dateActive && !dateOpen && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
            <CalendarRange {...ICON_XS} className="text-brand-600" />
            <span className="min-w-0 break-words">{dateSummary}</span>
            <button type="button" className="btn-ghost min-h-[36px] px-2 text-sm" onClick={clearDates} aria-label="ล้างช่วงวันที่">
              <X {...ICON_XS} />
            </button>
          </div>
        )}
      </section>

      {/* ===== รายการ ===== */}
      <section className="card overflow-hidden" aria-busy={loading}>
        <div className="card-header flex-wrap gap-2">
          <h2 className="section-title">
            <ClipboardList {...ICON} />
            {searching ? 'ผลการค้นหา' : tabInfo.label}
          </h2>
          <div className="flex items-center gap-2">
            {!loading && !error && (
              <span className="chip tabular-nums">{rows.length.toLocaleString('th-TH')}{hasMore ? '+' : ''} รายการ</span>
            )}
            <button
              type="button"
              onClick={() => void refreshAll()}
              disabled={loading}
              className="btn-icon btn-icon-plain"
              aria-label="โหลดรายการใหม่"
            >
              <RefreshCw {...ICON_SM} className={loading ? 'animate-spin' : undefined} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-4 sm:p-5 space-y-3" role="status">
            <span className="sr-only">กำลังโหลดการจอง...</span>
            {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-16 rounded-lg" />)}
          </div>
        ) : error ? (
          <div className="p-4 sm:p-5">
            <div role="alert" className="alert-err">
              <XCircle {...ICON_SM} />
              <div className="min-w-0 space-y-2">
                <p className="break-words">{error}</p>
                <button type="button" onClick={() => void load(true)} className="btn-secondary px-4 text-sm">
                  <RefreshCw {...ICON_SM} />
                  ลองใหม่
                </button>
              </div>
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <span className="icon-bubble icon-bubble-lg">
              {searching ? <SearchX size={28} strokeWidth={1.75} aria-hidden="true" /> : <ClipboardList size={28} strokeWidth={1.75} aria-hidden="true" />}
            </span>
            <p className="empty-state-title break-words">
              {searching ? `ไม่พบการจองที่ตรงกับ "${search}"` : dateActive ? `ไม่มีรายการ "${tabInfo.label}" ในช่วงวันที่เลือก` : `ไม่มีรายการ "${tabInfo.label}"`}
            </p>
            {!searching && (tab === 'pending' || tab === 'confirmed') && (
              <Link href="/rental/bookings/new" className="btn-secondary px-4 text-sm">สร้างการจอง</Link>
            )}
          </div>
        ) : (
          <>
            {/* มือถือ/แท็บเล็ต: การ์ดเรียงลงมา แตะทั้งการ์ดเพื่อเปิดการจอง */}
            <ul className="lg:hidden divide-y divide-gray-150">
              {rows.map(r => {
                const kn = keyNote(r)
                const mn = moneyNote(r)
                return (
                  <li key={r.id}>
                    <Link
                      href={`/rental/bookings/${r.id}`}
                      className="flex items-start gap-3 px-4 py-3 active:bg-gray-50 [@media(hover:hover)]:hover:bg-gray-50"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-sm text-gray-800 break-all">{r.booking_no}</span>
                          <span className={STATUS_CHIP[r.status]}>{statusLabel(r.status)}</span>
                          {r.source === 'online' && (
                            <span className="chip-outline"><Globe size={12} strokeWidth={2} aria-hidden="true" />ออนไลน์</span>
                          )}
                        </div>
                        <p className="text-sm font-medium text-gray-900 break-words">
                          {r.customer_name || '-'}
                          {r.customer_blacklisted && <span className="badge-out ml-1.5 align-middle"><Ban size={12} strokeWidth={2} aria-hidden="true" />บัญชีดำ</span>}
                          {r.customer_phone && <span className="font-normal text-gray-500 tabular-nums"> · {formatPhone(r.customer_phone)}</span>}
                        </p>
                        <p className="text-xs text-gray-600 tabular-nums">
                          รับ {formatThaiDate(r.pickup_date)} → คืน {formatThaiDate(r.return_date)}
                          <span className="text-gray-400"> ({rentalDays(r.pickup_date, r.return_date)} วัน)</span>
                        </p>
                        <p className="text-xs text-gray-500 break-words">{itemsText(r.items)}</p>
                        {kn && (
                          <p className={clsx('flex items-center gap-1 text-xs font-medium', toneClass(kn.tone))}>
                            {kn.tone === 'red' ? <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" /> : <Clock size={14} strokeWidth={2} aria-hidden="true" />}
                            {kn.text}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right space-y-0.5">
                        <p className={clsx('money', r.status === 'cancelled' || r.status === 'expired' ? 'text-gray-400' : 'text-gray-900')}>{baht(r.grand_total)}</p>
                        {mn && <p className={clsx('text-xs font-medium tabular-nums', toneClass(mn.tone))}>{mn.text}</p>}
                        <ChevronRight {...ICON_XS} className="ml-auto mt-1 text-gray-300" />
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>

            {/* จอกว้าง: ตาราง */}
            <div className="hidden lg:block table-wrap">
              <table className="table-soft min-w-[900px]">
                <thead>
                  <tr>
                    <th>เลขที่ / สถานะ</th>
                    <th>ลูกค้า</th>
                    <th>วันรับ – คืน</th>
                    <th>ชุด</th>
                    <th className="text-right">ยอดรวม</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const kn = keyNote(r)
                    const mn = moneyNote(r)
                    return (
                      <tr key={r.id} onClick={() => router.push(`/rental/bookings/${r.id}`)} className="cursor-pointer">
                        <td className="whitespace-nowrap align-top">
                          {/* คลิกตรงไหนของแถวก็เปิดการจอง (แถว onClick) — ลิงก์ที่เลขที่ไว้ให้คีย์บอร์ด/เปิดแท็บใหม่ */}
                          <Link
                            href={`/rental/bookings/${r.id}`}
                            onClick={e => e.stopPropagation()}
                            className="font-mono text-xs text-gray-800 underline-offset-4 [@media(hover:hover)]:hover:underline"
                          >
                            {r.booking_no}
                          </Link>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className={STATUS_CHIP[r.status]}>{statusLabel(r.status)}</span>
                            {r.source !== 'walkin' && <span className="chip-outline">{SOURCE_LABELS[r.source]}</span>}
                          </div>
                        </td>
                        <td className="align-top">
                          <p className="font-medium text-gray-900 break-words">
                            {r.customer_name || '-'}
                            {r.customer_blacklisted && <span className="badge-out ml-1.5">บัญชีดำ</span>}
                          </p>
                          {r.customer_phone && <p className="text-xs text-gray-500 tabular-nums">{formatPhone(r.customer_phone)}</p>}
                        </td>
                        <td className="whitespace-nowrap align-top tabular-nums">
                          <p className="text-gray-800">{formatThaiDate(r.pickup_date)} – {formatThaiDate(r.return_date)}</p>
                          <p className="text-xs text-gray-500">{rentalDays(r.pickup_date, r.return_date)} วัน{r.pickup_time ? ` · รับ ${r.pickup_time} น.` : ''}</p>
                          {kn && <p className={clsx('text-xs font-medium', toneClass(kn.tone))}>{kn.text}</p>}
                        </td>
                        <td className="align-top text-xs text-gray-600 max-w-[260px] break-words">{itemsText(r.items)}</td>
                        <td className="whitespace-nowrap text-right align-top">
                          <p className={clsx('money', r.status === 'cancelled' || r.status === 'expired' ? 'text-gray-400' : 'text-gray-900')}>{baht(r.grand_total)}</p>
                          {mn && <p className={clsx('text-xs font-medium tabular-nums', toneClass(mn.tone))}>{mn.text}</p>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {hasMore && (
              <div className="border-t border-gray-150 p-3 text-center space-y-2">
                {moreError && (
                  <div role="alert" className="alert-err text-left">
                    <XCircle {...ICON_SM} />
                    <p className="min-w-0 break-words">{moreError}</p>
                  </div>
                )}
                <button type="button" onClick={() => void load(false)} disabled={loadingMore} className="btn-secondary px-5">
                  {loadingMore && <Loader2 {...ICON_SM} className="animate-spin" />}
                  {loadingMore ? 'กำลังโหลด...' : 'โหลดเพิ่ม'}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
