'use client'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  AlertTriangle, ArrowUpDown, CalendarRange, ChevronRight, ClipboardList, Clock, Loader2, MapPin, RefreshCw, Search,
  SearchX, X, XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { addDaysToKey, bangkokTodayKey, baht, daysBetweenKeys, formatThaiDate, isDayKey, thaiError } from '@/lib/format'
import { num, round2 } from '@/lib/money'
import { isMigrationMissing } from '@/lib/migration'
import {
  FIX07_MISSING_MSG, SESSION_TYPE_SHORT, WED_BOOKING_STATUSES, WED_SESSION_TYPES, WED_SOURCES, WED_STATUS_CHIP,
  formatPhone, normTime, wedSourceLabel, wedStatusLabel,
  type WedBookingStatus, type WedSessionType, type WedSource,
} from '@/lib/wedding'
import MigrationNotice from '@/components/pos/MigrationNotice'
import {
  BOOKING_SORTS, BOOKING_TABS, isBookingSort, type BookingSort, type BookingTab,
} from '@/components/wedding/booking-form/bookingTabs'
import { cleanBookingNoTerm, cleanNameTerm, searchCustomerIds } from '@/components/wedding/booking-form/search'

// รายการงานร้าน b.oncloud — แท็บตามสถานะ / ค้นหา (เลขที่งาน ชื่อคู่บ่าวสาว ชื่อ-เบอร์-LINE ลูกค้า) / กรองช่วงวันงาน /
// เรียงตามวันงาน / โหลดเพิ่มทีละหน้า — แตะแถว = เปิดหน้างาน (ยืนยัน รับเงิน ส่งเอกสาร ส่งงาน อยู่ที่หน้านั้น)

const PAGE_SIZE = 50
const SEARCH_LIMIT = 50
const LOAD_TIMEOUT_MS = 20000
const LOAD_TIMEOUT_MSG = 'เซิร์ฟเวอร์ตอบช้าเกินไป — กดปุ่มโหลดใหม่อีกครั้ง'
const SORT_STORAGE_KEY = 'wedding-bookings-sort'
const COLUMNS =
  'id, booking_no, status, source, couple_names, first_session_date, last_session_date, package_name, grand_total, paid, due, ' +
  'deposit_required, deposit_met, hold_until, followup_date, followup_note, created_at, ' +
  'customer:wed_customers(name, partner_name, phone), sessions:wed_sessions(id, date, start_time, session_type, status, venue_name)'

interface SessionLite {
  date: string | null
  start_time: string | null
  session_type: WedSessionType
  status: string
  venue_name: string | null
}

interface BookingRow {
  id: string
  booking_no: string
  status: WedBookingStatus
  source: WedSource | null
  couple_names: string
  first_date: string | null
  last_date: string | null
  package_name: string | null
  grand_total: number
  paid: number
  due: number
  deposit_required: number
  deposit_met: boolean
  hold_until: string | null
  followup_date: string | null
  followup_note: string | null
  created_at: string
  customer_name: string
  customer_partner: string | null
  customer_phone: string
  sessions: SessionLite[]
}

type Obj = Record<string, unknown>
const asObj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null)
const s = (v: unknown): string => (typeof v === 'string' ? v : '')
const sn = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const dk = (v: unknown): string | null => {
  const t = s(v).slice(0, 10)
  return isDayKey(t) ? t : null
}

function toRow(raw: unknown): BookingRow | null {
  const o = asObj(raw)
  if (!o) return null
  const id = s(o.id)
  if (!id) return null
  // embed แบบ to-one อาจมาเป็น object หรือ array (แล้วแต่รุ่น PostgREST) → รับทั้งสองแบบ
  const custRaw = Array.isArray(o.customer) ? o.customer[0] : o.customer
  const cust = asObj(custRaw) ?? {}
  const sessions: SessionLite[] = []
  if (Array.isArray(o.sessions)) {
    for (const x of o.sessions) {
      const so = asObj(x)
      if (!so) continue
      const t = s(so.session_type)
      sessions.push({
        date: dk(so.date),
        start_time: normTime(so.start_time),
        session_type: (WED_SESSION_TYPES as readonly string[]).includes(t) ? (t as WedSessionType) : 'other',
        status: s(so.status) || 'scheduled',
        venue_name: sn(so.venue_name),
      })
    }
  }
  // คิวเรียงตามวันแล้วเวลา (ไม่มีวันไว้ท้าย)
  sessions.sort((a, b) => `${a.date ?? '9999'}${a.start_time ?? ''}`.localeCompare(`${b.date ?? '9999'}${b.start_time ?? ''}`))
  const st = s(o.status)
  const src = s(o.source)
  return {
    id,
    booking_no: s(o.booking_no),
    status: (WED_BOOKING_STATUSES as readonly string[]).includes(st) ? (st as WedBookingStatus) : 'inquiry',
    source: (WED_SOURCES as readonly string[]).includes(src) ? (src as WedSource) : null,
    couple_names: s(o.couple_names),
    first_date: dk(o.first_session_date),
    last_date: dk(o.last_session_date),
    package_name: sn(o.package_name),
    grand_total: round2(num(o.grand_total)),
    paid: round2(num(o.paid)),
    due: round2(num(o.due)),
    deposit_required: round2(num(o.deposit_required)),
    deposit_met: o.deposit_met === true,
    hold_until: sn(o.hold_until),
    followup_date: dk(o.followup_date),
    followup_note: sn(o.followup_note),
    created_at: s(o.created_at),
    customer_name: s(cust.name),
    customer_partner: sn(cust.partner_name),
    customer_phone: s(cust.phone),
    sessions,
  }
}

// "อีก 3 วัน" / "วันนี้" / "พรุ่งนี้" / "ผ่านมา 2 วัน"
function relDay(today: string, key: string): { text: string; d: number } | null {
  const d = daysBetweenKeys(today, key)
  if (!Number.isFinite(d)) return null
  if (d === 0) return { text: 'วันนี้', d }
  if (d === 1) return { text: 'พรุ่งนี้', d }
  if (d > 1) return { text: `อีก ${d} วัน`, d }
  return { text: `ผ่านมา ${-d} วัน`, d }
}

// เวลาที่เหลือของการล็อกคิว
function holdLeft(until: string | null, now: number): { text: string; urgent: boolean } | null {
  if (!until) return null
  const t = new Date(until).getTime()
  if (!Number.isFinite(t)) return null
  const ms = t - now
  if (ms <= 0) return { text: 'หมดเวลาล็อกคิวแล้ว', urgent: true }
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h >= 24) return { text: `ล็อกคิวอีก ${Math.floor(h / 24)} วัน ${h % 24} ชม.`, urgent: false }
  return { text: h > 0 ? `ล็อกคิวอีก ${h} ชม. ${m} นาที` : `ล็อกคิวอีก ${m} นาที`, urgent: h < 6 }
}

function dateRangeText(r: BookingRow): string {
  if (!r.first_date) return 'ยังไม่กำหนดวันงาน'
  if (!r.last_date || r.last_date === r.first_date) return formatThaiDate(r.first_date)
  return `${formatThaiDate(r.first_date)} – ${formatThaiDate(r.last_date)}`
}

function sessionsText(r: BookingRow): string {
  const live = r.sessions.filter(x => x.status !== 'cancelled')
  if (live.length === 0) return ''
  const types = Array.from(new Set(live.map(x => SESSION_TYPE_SHORT[x.session_type])))
  return `${live.length} คิว · ${types.join(' · ')}`
}

function venueText(r: BookingRow): string {
  const names = Array.from(new Set(r.sessions.filter(x => x.status !== 'cancelled' && x.venue_name).map(x => x.venue_name as string)))
  if (names.length === 0) return ''
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} และอีก ${names.length - 2} แห่ง` : names.join(', ')
}

// คิวถัดไปที่ยังไม่ถึง (วันนี้ขึ้นไป) — ไม่มี = null
function nextSession(r: BookingRow, today: string): SessionLite | null {
  return r.sessions.find(x => x.status === 'scheduled' && x.date !== null && x.date >= today) ?? null
}

function readSort(): BookingSort {
  try {
    const v = window.localStorage.getItem(SORT_STORAGE_KEY)
    return isBookingSort(v) ? v : 'auto'
  } catch {
    return 'auto'
  }
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
  const [sort, setSort] = useState<BookingSort>('auto')
  const [searchInput, setSearchInput] = useState(initialQuery)
  const [search, setSearch] = useState(initialQuery.trim())
  const [searchHint, setSearchHint] = useState('')
  const [dateOpen, setDateOpen] = useState(false)
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
  const tabInfo = BOOKING_TABS.find(t => t.key === tab) ?? BOOKING_TABS[0]
  const effSort: Exclude<BookingSort, 'auto'> =
    sort !== 'auto' ? sort : tabInfo.sort === 'desc' ? 'event_desc' : 'event_asc'

  // จำการเรียงที่เลือกไว้ในเครื่องนี้ (ไม่มีก็ใช้ตามสถานะ)
  useEffect(() => {
    setSort(readSort())
  }, [])
  function changeSort(v: BookingSort) {
    setSort(v)
    try {
      window.localStorage.setItem(SORT_STORAGE_KEY, v)
    } catch {
      // เก็บไม่ได้ก็ไม่เป็นไร
    }
  }

  // ===== โหลดรายการ =====
  const fetchPage = useCallback(async (offset: number) => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = setTimeout(() => ctrl?.abort(), LOAD_TIMEOUT_MS)
    try {
      let q = supabase.from('wed_bookings').select(COLUMNS)
      if (searching) {
        // เลขที่งาน / ชื่อคู่บ่าวสาว / ลูกค้าที่ชื่อ-เบอร์-LINE ตรงคำค้น (หาลูกค้าก่อน แล้วค่อยกรองงานด้วยรหัสลูกค้า)
        const term = cleanBookingNoTerm(search)
        const name = cleanNameTerm(search)
        const ids = await searchCustomerIds(supabase, search, 100, ctrl?.signal)
        const ors: string[] = []
        if (term) ors.push(`booking_no.ilike.%${term}%`)
        if (name.length >= 2 && !/^\d+$/.test(name)) ors.push(`couple_names.ilike.%${name}%`)
        if (ids.length > 0) ors.push(`customer_id.in.(${ids.join(',')})`)
        if (ors.length === 0) return { rows: [] as BookingRow[], more: false }
        q = q.or(ors.join(','))
      } else {
        q = q.eq('status', tab)
      }
      // ช่วงวันงาน: งานที่มีคิวอยู่ในช่วง (วันงานแรก ≤ วันสิ้นสุด และ วันงานสุดท้าย ≥ วันเริ่ม)
      if (!dateProblem) {
        if (toOk) q = q.lte('first_session_date', to)
        if (fromOk) q = q.gte('last_session_date', from)
      }
      if (searching) {
        q = q.order('created_at', { ascending: false }).order('id', { ascending: false }).range(0, SEARCH_LIMIT - 1)
      } else {
        if (effSort === 'created_desc') q = q.order('created_at', { ascending: false })
        else q = q.order('first_session_date', { ascending: effSort === 'event_asc', nullsFirst: false })
        q = q.order('created_at', { ascending: false }).order('id', { ascending: true }).range(offset, offset + PAGE_SIZE)
      }
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
  }, [supabase, searching, search, tab, from, to, fromOk, toOk, dateProblem, effSort])

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
        setError(isMigrationMissing(err) ? FIX07_MISSING_MSG : thaiError(err))
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

  // งานล็อกคิวที่หมดเวลาถูกเปลี่ยนเป็น "สอบถาม" ตอนเรียกฟังก์ชันของร้าน (ไม่ใช่ตอนอ่านตาราง)
  // → เรียก wed_badges() (เบา — กวาดงานหมดเวลาให้ด้วย) ก่อนโหลดรายการครั้งแรก/กดโหลดใหม่ เพื่อให้แท็บถูกต้อง
  const sweep = useCallback(async () => {
    try {
      await supabase.rpc('wed_badges')
    } catch {
      // กวาดไม่ได้ก็แสดงตามตาราง (แถวที่เลยเวลาแล้วมีป้าย "หมดเวลาล็อกคิวแล้ว" อยู่แล้ว)
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

  // ===== จำนวนบนแท็บของงานที่ยังต้องดูแล (ไม่ขึ้นกับคำค้น/ช่วงวัน) =====
  const loadCounts = useCallback(async () => {
    const base = () => supabase.from('wed_bookings').select('id', { count: 'exact', head: true })
    const keys = BOOKING_TABS.filter(t => t.counted).map(t => t.key)
    try {
      const res = await Promise.all(keys.map(k => base().eq('status', k)))
      const next: Partial<Record<BookingTab, number>> = {}
      res.forEach((x, i) => {
        if (!x.error) next[keys[i]] = x.count ?? 0
      })
      setCounts(next)
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

  // กลับมาที่แท็บ (เช่น หลังยืนยันงานในหน้ารายละเอียด/ข้ามเที่ยงคืน) → ตัวเลข/วันนี้/เวลาล็อกคิว ต้องตามทัน
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

  // จำแท็บ/คำค้นไว้ใน URL (กดย้อนกลับจากหน้างานแล้วกลับมาที่แท็บเดิม)
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
      setSearchHint('พิมพ์อย่างน้อย 2 ตัวอักษร (เลขที่งาน ชื่อคู่บ่าวสาว ชื่อลูกค้า เบอร์โทร หรือ LINE ID)')
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

  function preset(kind: 'today' | 'week' | 'month' | 'next') {
    const t = bangkokTodayKey()
    // วันที่ 1 + 31 วัน = อยู่ในเดือนถัดไปเสมอ → วันที่ 1 ของเดือนถัดไป − 1 วัน = วันสุดท้ายของเดือน
    const monthEnd = (firstDay: string) => addDaysToKey(`${addDaysToKey(firstDay, 31).slice(0, 8)}01`, -1)
    if (kind === 'today') { setFrom(t); setTo(t) }
    if (kind === 'week') { setFrom(t); setTo(addDaysToKey(t, 6)) }
    if (kind === 'month') {
      const f = `${t.slice(0, 8)}01`
      setFrom(f)
      setTo(monthEnd(f))
    }
    if (kind === 'next') {
      const f = `${addDaysToKey(`${t.slice(0, 8)}01`, 31).slice(0, 8)}01`
      setFrom(f)
      setTo(monthEnd(f))
    }
  }

  function clearDates() {
    setFrom('')
    setTo('')
  }

  const dateSummary = dateActive
    ? `วันงาน ${fromOk ? formatThaiDate(from) : '...'} – ${toOk ? formatThaiDate(to) : '...'}`
    : ''

  // ข้อความเด่นของแถว (สิ่งที่ต้องทำต่อ)
  function keyNote(r: BookingRow): { text: string; tone: 'red' | 'amber' | 'gray' } | null {
    if (r.status === 'hold') {
      const h = holdLeft(r.hold_until, now)
      return h ? { text: h.text, tone: h.urgent ? 'red' : 'amber' } : null
    }
    if ((r.status === 'inquiry' || r.status === 'postponed') && r.followup_date) {
      const d = daysBetweenKeys(todayKey, r.followup_date)
      const note = r.followup_note ? ` — ${r.followup_note}` : ''
      if (d < 0) return { text: `เลยวันติดตามลูกค้า ${-d} วัน${note}`, tone: 'red' }
      if (d === 0) return { text: `ติดตามลูกค้าวันนี้${note}`, tone: 'amber' }
      return { text: `ติดตามลูกค้า ${formatThaiDate(r.followup_date)}${note}`, tone: 'gray' }
    }
    if (r.status === 'postponed') return { text: 'เลื่อนงาน — รอวันงานใหม่', tone: 'amber' }
    if (r.status === 'confirmed' || r.status === 'inquiry') {
      const n = nextSession(r, todayKey)
      if (!n || !n.date) return null
      const rel = relDay(todayKey, n.date)
      if (!rel) return null
      const time = n.start_time ? ` ${n.start_time} น.` : ''
      return { text: `${SESSION_TYPE_SHORT[n.session_type]}${rel.text}${rel.d <= 1 ? time : ''}`, tone: rel.d <= 1 ? 'amber' : 'gray' }
    }
    if (r.status === 'in_production' && r.last_date) {
      const d = daysBetweenKeys(r.last_date, todayKey)
      return Number.isFinite(d) && d >= 0 ? { text: `ถ่ายเสร็จ ${d} วันแล้ว — รอส่งงาน`, tone: d > 30 ? 'red' : 'gray' } : null
    }
    return null
  }

  function moneyNote(r: BookingRow): { text: string; tone: 'red' | 'amber' | 'green' | 'gray' } | null {
    if (r.due < -0.005) return { text: `รับเกิน ${baht(-r.due)}`, tone: 'amber' }
    if (r.status === 'cancelled' || r.status === 'completed') return null
    if (r.grand_total <= 0) return null
    if (r.deposit_required > 0.005 && !r.deposit_met && r.status !== 'inquiry') {
      return { text: r.paid > 0.005 ? `มัดจำยังไม่ครบ (ค้าง ${baht(r.due)})` : 'ยังไม่ได้มัดจำ', tone: 'amber' }
    }
    if (r.due > 0.005) {
      return { text: `ค้าง ${baht(r.due)}`, tone: r.status === 'delivered' || r.status === 'in_production' ? 'red' : 'gray' }
    }
    return { text: 'ชำระครบ', tone: 'green' }
  }

  const toneClass = (t: 'red' | 'amber' | 'green' | 'gray') =>
    t === 'red' ? 'text-red-700' : t === 'amber' ? 'text-amber-800' : t === 'green' ? 'text-green-700' : 'text-gray-500'

  if (missing && !loading && rows.length === 0) {
    return <MigrationNotice message={FIX07_MISSING_MSG} />
  }

  return (
    <div className="space-y-4">
      {/* ===== ค้นหา + ตัวกรอง ===== */}
      <section className="card p-4 sm:p-5 space-y-3" aria-label="ค้นหาและกรองงาน">
        <form onSubmit={handleSearch} className="flex items-center gap-2" role="search">
          <div className="input-icon flex-1 min-w-0">
            <Search {...ICON_SM} />
            <input
              type="search"
              className="input pl-11"
              placeholder="เลขที่ ชื่อคู่บ่าวสาว เบอร์โทร"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={60}
              aria-label="ค้นหางาน"
              aria-describedby={searchHint ? 'wbk-search-hint' : undefined}
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
            aria-controls="wbk-date-panel"
          >
            <CalendarRange {...ICON_SM} />
            <span className="hidden sm:inline">ช่วงวันงาน</span>
            <span className="sr-only sm:hidden">กรองช่วงวันงาน</span>
          </button>
        </form>
        {searchHint && <p id="wbk-search-hint" role="alert" className="text-xs font-medium text-red-700">{searchHint}</p>}

        {dateOpen && (
          <div id="wbk-date-panel" className="panel p-3 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor="wbk-from" className="field-label">วันงานตั้งแต่</label>
                <input
                  id="wbk-from"
                  type="date"
                  className="input block min-w-0 appearance-none tabular-nums [&::-webkit-date-and-time-value]:text-left"
                  value={from}
                  onChange={e => setFrom(e.target.value)}
                />
                <p className="field-hint tabular-nums">{fromOk ? `พ.ศ. ${formatThaiDate(from)}` : 'ไม่จำกัด'}</p>
              </div>
              <div className="min-w-0">
                <label htmlFor="wbk-to" className="field-label">ถึงวันที่</label>
                <input
                  id="wbk-to"
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
              <button type="button" className="chip-toggle" onClick={() => preset('week')}>7 วันข้างหน้า</button>
              <button type="button" className="chip-toggle" onClick={() => preset('month')}>เดือนนี้</button>
              <button type="button" className="chip-toggle" onClick={() => preset('next')}>เดือนหน้า</button>
              {dateActive && (
                <button type="button" className="btn-ghost px-3 text-sm" onClick={clearDates}>
                  <X {...ICON_SM} />
                  ล้างช่วงวันที่
                </button>
              )}
            </div>
            <p className="field-hint">งานที่ยังไม่กำหนดวันจะไม่แสดงเมื่อกรองช่วงวันงาน</p>
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
          <div className="-mx-4 overflow-x-auto px-4 scrollbar-none sm:-mx-5 sm:px-5" role="group" aria-label="สถานะงาน">
            <div className="flex gap-2 md:flex-wrap">
              {BOOKING_TABS.map(t => {
                const n = counts[t.key]
                return (
                  <button
                    key={t.key}
                    type="button"
                    className="chip-toggle shrink-0"
                    aria-pressed={tab === t.key}
                    onClick={() => setTab(t.key)}
                  >
                    {t.label}
                    {t.counted && n !== undefined && n > 0 && (
                      <span className={clsx(t.key === 'hold' ? 'badge-return' : 'chip', 'h-5 px-1.5 tabular-nums')}>{n}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {dateActive && !dateOpen ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-gray-700">
              <CalendarRange {...ICON_XS} className="text-brand-600" />
              <span className="min-w-0 break-words">{dateSummary}</span>
              <button type="button" className="btn-ghost min-h-[36px] px-2 text-sm" onClick={clearDates} aria-label="ล้างช่วงวันที่">
                <X {...ICON_XS} />
              </button>
            </div>
          ) : <span />}
          {!searching && (
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <ArrowUpDown {...ICON_XS} className="shrink-0 text-gray-500" />
              <span className="sr-only">เรียงรายการ</span>
              <select
                className="input w-auto pr-9"
                value={sort}
                onChange={e => changeSort(isBookingSort(e.target.value) ? e.target.value : 'auto')}
                aria-label="เรียงรายการ"
              >
                {BOOKING_SORTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}
        </div>
      </section>

      {/* ===== รายการ ===== */}
      <section className="card overflow-hidden" aria-busy={loading}>
        <div className="card-header flex-wrap gap-2">
          <h2 className="section-title">
            <ClipboardList {...ICON} />
            {searching ? 'ผลการค้นหา' : wedStatusLabel(tab)}
          </h2>
          <div className="flex items-center gap-2">
            {!loading && !error && (
              <span className="chip tabular-nums">{rows.length.toLocaleString('th-TH')}{hasMore ? '+' : ''} งาน</span>
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
            <span className="sr-only">กำลังโหลดรายการงาน...</span>
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
              {searching
                ? `ไม่พบงานที่ตรงกับ "${search}"`
                : dateActive ? `ไม่มีงาน "${tabInfo.label}" ในช่วงวันงานที่เลือก` : `ไม่มีงาน "${tabInfo.label}"`}
            </p>
            {!searching && (tab === 'inquiry' || tab === 'hold' || tab === 'confirmed') && (
              <Link href="/wedding/bookings/new" className="btn-secondary px-4 text-sm">สร้างงาน</Link>
            )}
          </div>
        ) : (
          <>
            {/* มือถือ/แท็บเล็ต: การ์ดเรียงลงมา แตะทั้งการ์ดเพื่อเปิดงาน */}
            <ul className="lg:hidden divide-y divide-gray-150">
              {rows.map(r => {
                const kn = keyNote(r)
                const mn = moneyNote(r)
                const st = sessionsText(r)
                const venue = venueText(r)
                return (
                  <li key={r.id}>
                    <Link
                      href={`/wedding/bookings/${r.id}`}
                      className="flex items-start gap-3 px-4 py-3 active:bg-gray-50 [@media(hover:hover)]:hover:bg-gray-50"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-sm text-gray-800 break-all">{r.booking_no}</span>
                          <span className={WED_STATUS_CHIP[r.status]}>{wedStatusLabel(r.status)}</span>
                        </div>
                        <p className="text-sm font-semibold text-gray-900 break-words">{r.couple_names || '-'}</p>
                        <p className="text-xs text-gray-600 break-words">
                          {r.customer_name || '-'}
                          {r.customer_phone && <span className="tabular-nums"> · {formatPhone(r.customer_phone)}</span>}
                        </p>
                        <p className="text-xs text-gray-600 tabular-nums">
                          {dateRangeText(r)}
                          {st && <span className="text-gray-500"> · {st}</span>}
                        </p>
                        {(venue || r.package_name) && (
                          <p className="flex items-start gap-1 text-xs text-gray-500 break-words">
                            {venue && <MapPin size={13} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />}
                            <span className="min-w-0">{[venue, r.package_name].filter(Boolean).join(' · ')}</span>
                          </p>
                        )}
                        {kn && (
                          <p className={clsx('flex items-start gap-1 text-xs font-medium', toneClass(kn.tone))}>
                            {kn.tone === 'red'
                              ? <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" className="mt-px shrink-0" />
                              : <Clock size={14} strokeWidth={2} aria-hidden="true" className="mt-px shrink-0" />}
                            <span className="min-w-0 break-words">{kn.text}</span>
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right space-y-0.5">
                        <p className={clsx('money', r.status === 'cancelled' ? 'text-gray-400' : 'text-gray-900')}>{baht(r.grand_total)}</p>
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
              <table className="table-soft min-w-[960px]">
                <thead>
                  <tr>
                    <th>เลขที่ / สถานะ</th>
                    <th>คู่บ่าวสาว / ลูกค้า</th>
                    <th>วันงาน</th>
                    <th>สถานที่ / แพ็กเกจ</th>
                    <th className="text-right">ยอดสุทธิ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const kn = keyNote(r)
                    const mn = moneyNote(r)
                    const st = sessionsText(r)
                    const venue = venueText(r)
                    return (
                      <tr key={r.id} onClick={() => router.push(`/wedding/bookings/${r.id}`)} className="cursor-pointer">
                        <td className="whitespace-nowrap align-top">
                          {/* คลิกตรงไหนของแถวก็เปิดงาน (แถว onClick) — ลิงก์ที่เลขที่ไว้ให้คีย์บอร์ด/เปิดแท็บใหม่ */}
                          <Link
                            href={`/wedding/bookings/${r.id}`}
                            onClick={e => e.stopPropagation()}
                            className="font-mono text-xs text-gray-800 underline-offset-4 [@media(hover:hover)]:hover:underline"
                          >
                            {r.booking_no}
                          </Link>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className={WED_STATUS_CHIP[r.status]}>{wedStatusLabel(r.status)}</span>
                            {r.source && <span className="chip-outline">{wedSourceLabel(r.source)}</span>}
                          </div>
                        </td>
                        <td className="align-top">
                          <p className="font-semibold text-gray-900 break-words">{r.couple_names || '-'}</p>
                          <p className="text-xs text-gray-500 break-words">
                            {r.customer_name || '-'}
                            {r.customer_phone && <span className="tabular-nums"> · {formatPhone(r.customer_phone)}</span>}
                          </p>
                        </td>
                        <td className="align-top tabular-nums">
                          <p className="whitespace-nowrap text-gray-800">{dateRangeText(r)}</p>
                          {st && <p className="text-xs text-gray-500">{st}</p>}
                          {kn && <p className={clsx('max-w-[260px] text-xs font-medium break-words', toneClass(kn.tone))}>{kn.text}</p>}
                        </td>
                        <td className="align-top text-xs text-gray-600 max-w-[260px] break-words">
                          {venue && <p>{venue}</p>}
                          {r.package_name && <p className="text-gray-500">{r.package_name}</p>}
                          {!venue && !r.package_name && '-'}
                        </td>
                        <td className="whitespace-nowrap text-right align-top">
                          <p className={clsx('money', r.status === 'cancelled' ? 'text-gray-400' : 'text-gray-900')}>{baht(r.grand_total)}</p>
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
