'use client'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ChevronLeft, ChevronRight, History, Info, Loader2, Receipt, RefreshCw, Search, SearchX, ShoppingBag, X, XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import {
  addDaysToKey, bangkokDayRangeISO, bangkokTodayKey, baht, formatThaiDate, formatThaiDateTime, formatThaiDayLong,
  formatThaiTime, isDayKey, thaiError,
} from '@/lib/format'
import { normalizeScannedCode } from '@/lib/barcode'
import { num, round2, sumBy } from '@/lib/money'
import { isMigrationMissing } from '@/lib/migration'
import { isMissingSalesColumn } from '@/lib/salesCompat'
import { billStatus, qtyLinesOf, type SaleDetail, type ShopSettings } from '@/lib/pos'
import { PAYMENT_METHOD_LABELS, saleChannelLabel } from '@/lib/integrations/labels'
import BillDetailDialog from '@/components/pos/BillDetailDialog'
import MigrationNotice from '@/components/pos/MigrationNotice'

type StatusFilter = 'all' | 'normal' | 'voided' | 'returned'
// รุ่นฐานข้อมูล: 4 = มี refunded_amount (fix-04) · 3 = มี channel/voided_at (fix-03) · 0 = ตารางเดิม
type Level = 4 | 3 | 0

interface BillRow {
  id: string
  sale_no: string
  net_amount: number
  payment_method: string
  created_at: string
  channel: string | null
  voided_at: string | null
  refunded_amount: number
  // ใบคืนของบิล (fix-04) — บิลที่คืนของแต่ยอดคืน 0 บาท (ของแถมราคา 0 / บิลส่วนลดเต็ม) refunded_amount ยังเป็น 0
  // จึงต้องดูจากใบคืนจริง ไม่งั้นบิลนั้นตกไปอยู่ "ปกติ" และป้ายสถานะไม่บอกว่ามีคืนสินค้า
  returns: readonly unknown[]
  // รายการสินค้าของบิล — มีเฉพาะแถวที่เพิ่งเปิดดู/ยกเลิก/คืนสินค้าในป็อปอัป (ได้จาก get_sale_detail)
  // มีแล้ว billStatus ดูจาก "จำนวนชิ้นที่คืน" แบบเดียวกับหน้ารายละเอียดบิล (ป้ายในรายการกับในป็อปอัปตรงกัน)
  items?: SaleDetail['items']
  // จำนวนชิ้นที่ขาย/คืนแล้ว รวมต่อสินค้า (fix-04: แนบ sale_items + sale_return_items มากับรายการบิล)
  // → ป้ายในรายการใช้กติกา "จำนวนชิ้น" เดียวกับหน้ารายละเอียดและไฟล์ส่งออก (pos_bill_status) ตั้งแต่ยังไม่เปิดบิล
  //   ไม่งั้นต้องเดาจากเงิน ซึ่งผิดกับบิลมีของแถม ฿0 / บิลยอดสุทธิ 0 ; null = ฐานข้อมูลรุ่นเก่า (ใช้กติกาเงินตามเดิม)
  qtyLines: { qty: number; returned_qty: number }[] | null
}

const PAGE_SIZE = 100
const SEARCH_LIMIT = 50
const LOAD_TIMEOUT_MS = 20000
const LOAD_TIMEOUT_MSG = 'เซิร์ฟเวอร์ตอบช้าเกินไป — กดปุ่มโหลดใหม่อีกครั้ง'
const COLUMNS: Record<Level, string> = {
  4: 'id, sale_no, net_amount, payment_method, created_at, channel, voided_at, refunded_amount, sale_items(product_id, qty), sale_return_items(product_id, qty)',
  3: 'id, sale_no, net_amount, payment_method, created_at, channel, voided_at',
  0: 'id, sale_no, net_amount, payment_method, created_at',
}
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'normal', label: 'ปกติ' },
  { value: 'voided', label: 'ยกเลิก' },
  { value: 'returned', label: 'มีคืนสินค้า' },
]

function toRow(raw: unknown): BillRow | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id : ''
  if (!id) return null
  return {
    id,
    sale_no: typeof o.sale_no === 'string' ? o.sale_no : String(o.sale_no ?? ''),
    net_amount: num(o.net_amount),
    payment_method: typeof o.payment_method === 'string' ? o.payment_method : '',
    created_at: typeof o.created_at === 'string' ? o.created_at : '',
    channel: typeof o.channel === 'string' && o.channel ? o.channel : null,
    voided_at: typeof o.voided_at === 'string' && o.voided_at ? o.voided_at : null,
    refunded_amount: num(o.refunded_amount),
    returns: Array.isArray(o.sale_returns) ? o.sale_returns : [],
    // รวมจำนวนที่ขาย / คืนแล้ว ต่อสินค้า (qtyLinesOf ใน lib/pos — ตัวเดียวกับรายการขายล่าสุดในหน้าขาย)
    qtyLines: Array.isArray(o.sale_items) ? qtyLinesOf(o.sale_items, o.sale_return_items) : null,
  }
}

// ป้ายสถานะของแถว: เปิดบิลแล้ว (มีรายการจาก get_sale_detail) ใช้รายการนั้น ; ไม่งั้นใช้จำนวนรวมต่อสินค้าที่แนบมากับรายการ
function rowStatus(r: BillRow) {
  return billStatus(r.items ? r : { ...r, items: r.qtyLines })
}

// คำค้นเลขที่บิล: แปลงตัวอักษรที่พิมพ์ตอนคีย์บอร์ดเป็นภาษาไทยกลับเป็นแป้น US แล้วเหลือแค่ A-Z 0-9 -
// (กันอักขระพิเศษของ ilike อย่าง % _ หลุดเข้าไปในเงื่อนไข)
function cleanSearch(raw: string): string {
  return normalizeScannedCode(raw).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40)
}

function PaymentCell({ row }: { row: BillRow }) {
  const channel = row.channel && row.channel !== 'store' ? saleChannelLabel(row.channel) : ''
  if (row.payment_method === 'marketplace') {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <ShoppingBag {...ICON_XS} className="text-brand-600" />
        {channel || PAYMENT_METHOD_LABELS.marketplace}
      </span>
    )
  }
  return (
    <span className="whitespace-nowrap">
      {(PAYMENT_METHOD_LABELS as Record<string, string>)[row.payment_method] ?? row.payment_method}
      {channel && <span className="text-gray-500"> · {channel}</span>}
    </span>
  )
}

export default function BillsClient({
  initialDay,
  today,
  shop,
  canRefund,
}: {
  initialDay: string
  today: string
  shop: ShopSettings
  canRefund: boolean
}) {
  const supabase = useMemo(() => createClient(), [])
  const [todayKey, setTodayKey] = useState(today)
  const [day, setDay] = useState(initialDay)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')          // คำค้นที่ใช้อยู่ (ว่าง = ดูรายวัน)
  const [searchHint, setSearchHint] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [rows, setRows] = useState<BillRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [moreError, setMoreError] = useState('')   // โหลดหน้าถัดไปไม่สำเร็จ (รายการเดิมยังอยู่)
  const [level, setLevel] = useState<Level>(4)
  const levelRef = useRef<Level>(4)
  const reqRef = useRef(0)
  const rawOffsetRef = useRef(0)   // จำนวนแถวที่อ่านจากฐานข้อมูลแล้ว (ใช้เป็น offset ของ "โหลดเพิ่ม")
  const [detailId, setDetailId] = useState<string | null>(null)

  // ดึงบิล 1 หน้า (offset = จำนวนแถวที่อ่านจากฐานข้อมูลไปแล้ว) — ฐานข้อมูลรุ่นเก่ากว่าลดคอลัมน์ลงเอง
  const fetchPage = useCallback(async (opts: { day: string; search: string; status: StatusFilter; offset: number }) => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = setTimeout(() => ctrl?.abort(), LOAD_TIMEOUT_MS)
    try {
      const run = async (lvl: Level) => {
        // ฐานข้อมูลยังไม่มีคอลัมน์ที่ใช้กรอง = ไม่มีบิลแบบนั้นแน่นอน (ยังยกเลิก/คืนไม่ได้)
        if (opts.status === 'voided' && lvl === 0) return { data: [] as unknown[], error: null }
        if (opts.status === 'returned' && lvl < 4) return { data: [] as unknown[], error: null }
        // fix-04: แนบรหัสใบคืนของแต่ละบิลมาด้วย — "มีคืนสินค้า" ดูจากใบคืนจริง ไม่ใช่ยอดคืนเงิน
        // (คืนของแถมราคา 0 / บิลส่วนลดเต็ม = มีใบคืนแต่ยอดคืน 0 บาท) ; !inner = เอาเฉพาะบิลที่มีใบคืนอย่างน้อย 1 ใบ
        const columns = lvl === 4
          ? `${COLUMNS[4]}, ${opts.status === 'returned' ? 'sale_returns!inner(id)' : 'sale_returns(id)'}`
          : COLUMNS[lvl]
        let q = supabase.from('sales').select(columns)
        if (opts.search) {
          q = q.ilike('sale_no', `%${opts.search}%`)
        } else {
          const { startISO, endISO } = bangkokDayRangeISO(opts.day)
          q = q.gte('created_at', startISO).lt('created_at', endISO)
        }
        if (opts.status === 'voided') q = q.not('voided_at', 'is', null)
        if (opts.status === 'normal') {
          if (lvl >= 3) q = q.is('voided_at', null)
          // บิลที่มีใบคืนยอด 0 บาท ฐานข้อมูลกรองตรงนี้ไม่ได้ → ตัดออกในเครื่องหลังโหลด (ดู load)
          if (lvl === 4) q = q.eq('refunded_amount', 0)
        }
        if (opts.status === 'returned') q = q.is('voided_at', null)
        q = q.order('created_at', { ascending: false }).order('id', { ascending: false })
        // ขอเกิน 1 แถว เพื่อรู้ว่ายังมีหน้าถัดไปไหม
        q = opts.search ? q.range(0, SEARCH_LIMIT - 1) : q.range(opts.offset, opts.offset + PAGE_SIZE)
        if (ctrl) q = q.abortSignal(ctrl.signal)
        const r = await q
        return { data: (r.data ?? []) as unknown[], error: r.error as unknown }
      }
      let lvl = levelRef.current
      let res = await run(lvl)
      if (res.error && lvl === 4 && isMigrationMissing(res.error)) {
        lvl = 3
        res = await run(lvl)
      }
      if (res.error && lvl === 3 && isMissingSalesColumn(res.error)) {
        lvl = 0
        res = await run(lvl)
      }
      // หมดเวลา (ยกเลิกคำขอเอง) → ข้อความไทย แทนข้อความ AbortError ภาษาอังกฤษ
      if (res.error && ctrl?.signal.aborted) throw new Error(LOAD_TIMEOUT_MSG)
      if (res.error) throw res.error
      levelRef.current = lvl
      const list: BillRow[] = []
      for (const raw of res.data) {
        const row = toRow(raw)
        if (row) list.push(row)
      }
      return { rows: list, level: lvl }
    } finally {
      clearTimeout(timer)
    }
  }, [supabase])

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
      // offset นับจากแถวที่ฐานข้อมูลส่งมาจริง (รวมแถวที่ตัดทิ้งในเครื่อง) — ไม่ใช่จำนวนที่แสดง กันข้าม/วนหน้าเดิม
      let offset = reset ? 0 : rawOffsetRef.current
      let more = false
      let pageRows: BillRow[] = []
      let pageLevel: Level = levelRef.current
      // หน้าที่ถูกตัดทิ้งหมด (บิลมีใบคืนยอด 0 ล้วน) แต่ยังมีหน้าถัดไป → อ่านต่อเอง (จำกัดรอบ กันวนนาน)
      for (let round = 0; ; round++) {
        const res = await fetchPage({ day, search, status, offset })
        if (reqId !== reqRef.current) return
        pageLevel = res.level
        more = !search && res.rows.length > PAGE_SIZE
        const pageRaw = more ? res.rows.slice(0, PAGE_SIZE) : res.rows
        offset += pageRaw.length
        // "ปกติ" = ไม่ยกเลิก ไม่มีคืนเงิน และไม่มีใบคืนเลย (ใบคืนยอด 0 บาทตัดตรงนี้)
        pageRows = status === 'normal' ? pageRaw.filter(r => r.returns.length === 0) : pageRaw
        if (pageRows.length > 0 || !more || round >= 4) break
      }
      rawOffsetRef.current = offset
      setLevel(pageLevel)
      setHasMore(more)
      setRows(prev => {
        if (reset) return pageRows
        // กันแถวซ้ำ (มีบิลใหม่เข้ามาระหว่างเลื่อนดู ทำให้ลำดับเลื่อน)
        const seen = new Set(prev.map(r => r.id))
        return [...prev, ...pageRows.filter(r => !seen.has(r.id))]
      })
    } catch (err) {
      if (reqId !== reqRef.current) return
      if (reset) {
        setRows([])
        setError(thaiError(err))
      } else {
        setMoreError(thaiError(err))
      }
    } finally {
      if (reqId === reqRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [fetchPage, day, search, status])

  // เปลี่ยนวัน / คำค้น / สถานะ → โหลดใหม่ตั้งแต่ต้น
  useEffect(() => {
    void load(true)
  }, [load])

  // กลับมาที่แท็บหลังเที่ยงคืน → วันนี้เปลี่ยน (ปุ่ม "ถัดไป" / "วันนี้" ต้องตามทัน)
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') setTodayKey(bangkokTodayKey())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  function changeDay(next: string) {
    if (!isDayKey(next)) return
    const t = bangkokTodayKey()
    setTodayKey(t)
    setDay(next > t ? t : next)
  }

  function handleSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const raw = searchInput.trim()
    if (!raw) {
      setSearch('')
      setSearchHint('')
      return
    }
    const term = cleanSearch(raw)
    if (!term) {
      setSearchHint('ค้นหาได้เฉพาะเลขที่บิล (ตัวอักษร ตัวเลข และขีด เช่น S-20261005-001 หรือ 001)')
      return
    }
    setSearchHint('')
    setSearch(term)
  }

  function clearSearch() {
    setSearchInput('')
    setSearch('')
    setSearchHint('')
  }

  const closeDetail = useCallback(() => setDetailId(null), [])

  // ยกเลิก/คืนสินค้าในป็อปอัปแล้ว → อัปเดตแถวในรายการทันที (ไม่ต้องโหลดใหม่ทั้งรายการ)
  const handleChanged = useCallback((sale: SaleDetail) => {
    setRows(prev => prev.map(r => (r.id === sale.id
      ? { ...r, voided_at: sale.voided_at, refunded_amount: sale.refunded_amount, net_amount: sale.net_amount, returns: sale.returns, items: sale.items }
      : r)))
  }, [])

  const searching = search !== ''
  // ยอดรวมของวัน: เฉพาะตอนดูทั้งหมดของวัน และโหลดครบทุกบิลแล้ว (ยังมีหน้าถัดไป = ยอดไม่ครบ ไม่แสดง)
  const showTotals = !searching && status === 'all' && !hasMore && !loading && !error && rows.length > 0
  const activeRows = rows.filter(r => !r.voided_at)
  const totals = {
    bills: activeRows.length,
    net: sumBy(activeRows, r => r.net_amount),
    refunds: sumBy(activeRows, r => r.refunded_amount),
    voided: rows.length - activeRows.length,
  }
  const isToday = day === todayKey

  return (
    <div className="space-y-4">
      {level < 4 && <MigrationNotice message="ฐานข้อมูลยังไม่มีระบบยกเลิกบิล/คืนสินค้า — ดูรายการบิลได้ แต่เปิดรายละเอียดไม่ได้ รันไฟล์ supabase-fix-04-pos.sql ใน Supabase SQL Editor ก่อน แล้วโหลดหน้านี้ใหม่" />}

      {/* ===== ตัวกรอง ===== */}
      <section className="card p-4 sm:p-5 space-y-3" aria-label="ตัวกรองบิล">
        <form onSubmit={handleSearch} className="flex items-center gap-2" role="search">
          <div className="input-icon flex-1 min-w-0">
            <Search {...ICON_SM} />
            <input
              type="text"
              className="input pl-11"
              placeholder="ค้นหาเลขที่บิล (ทุกวัน)"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={60}
              aria-label="ค้นหาเลขที่บิล"
              aria-describedby={searchHint ? 'bills-search-hint' : undefined}
            />
          </div>
          <button type="submit" className="btn-primary shrink-0 px-4">
            <Search {...ICON_SM} />
            <span className="hidden sm:inline">ค้นหา</span>
            <span className="sr-only sm:hidden">ค้นหา</span>
          </button>
        </form>
        {searchHint && <p id="bills-search-hint" role="alert" className="text-xs font-medium text-red-700">{searchHint}</p>}

        {searching ? (
          <div className="panel flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <p className="min-w-0 text-sm text-gray-700 break-words">
              ผลค้นหา <b className="font-mono">{search}</b> จากทุกวัน (ล่าสุด {SEARCH_LIMIT} บิล)
            </p>
            <button type="button" onClick={clearSearch} className="btn-ghost px-3 text-sm">
              <X {...ICON_SM} />
              ล้างการค้นหา
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => changeDay(addDaysToKey(day, -1))}
                className="btn-icon shrink-0"
                aria-label="วันก่อนหน้า"
              >
                <ChevronLeft {...ICON_SM} />
              </button>
              <input
                type="date"
                className="input min-w-0 flex-1 tabular-nums"
                value={day}
                max={todayKey}
                onChange={e => { if (e.target.value) changeDay(e.target.value) }}
                aria-label="เลือกวัน"
                aria-describedby="bills-day-caption"
              />
              <button
                type="button"
                onClick={() => changeDay(addDaysToKey(day, 1))}
                disabled={day >= todayKey}
                className="btn-icon shrink-0"
                aria-label="วันถัดไป"
              >
                <ChevronRight {...ICON_SM} />
              </button>
            </div>
            {/* วันที่แบบไทย (ช่องเลือกวันแสดงตามภาษาเครื่อง) + ปุ่มกลับมาวันนี้ */}
            <div className="flex items-center justify-between gap-2">
              <p id="bills-day-caption" className="min-w-0 text-sm text-gray-600">{formatThaiDayLong(day)}</p>
              {!isToday && (
                <button type="button" onClick={() => changeDay(bangkokTodayKey())} className="btn-ghost shrink-0 px-3 text-sm">
                  กลับไปวันนี้
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2" role="group" aria-label="สถานะบิล">
          {STATUS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              className="chip-toggle"
              aria-pressed={status === opt.value}
              onClick={() => setStatus(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {!canRefund && (
          <p className="flex items-start gap-1.5 text-xs text-gray-500">
            <Info {...ICON_XS} className="mt-px shrink-0" />
            <span className="min-w-0">
              บัญชีนี้ดูบิลและพิมพ์ใบเสร็จซ้ำได้ — การยกเลิกบิล/คืนสินค้าต้องได้สิทธิ์ &quot;ยกเลิกบิล / คืนสินค้า&quot; จากแอดมิน
            </span>
          </p>
        )}
      </section>

      {/* ===== ยอดรวมของวัน (เฉพาะบิลที่โหลดครบ) ===== */}
      {showTotals && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-live="polite">
          <div className="stat-card">
            <p className="stat-label">บิลขาย</p>
            <p className="stat-value"><span className="whitespace-nowrap">{totals.bills.toLocaleString('th-TH')}</span> <span className="stat-sub">บิล</span></p>
          </div>
          <div className="stat-card">
            <p className="stat-label">ยอดขายสุทธิ</p>
            <div>
              <p className="stat-value"><span className="whitespace-nowrap">{baht(totals.net)}</span></p>
              {totals.refunds > 0 && (
                <p className="stat-sub mt-1">หลังหักคืน <span className="whitespace-nowrap">{baht(round2(totals.net - totals.refunds))}</span></p>
              )}
            </div>
          </div>
          {level === 4 && (
            <div className="stat-card">
              <p className="stat-label">{isToday ? 'คืนเงิน (บิลของวันนี้)' : 'คืนเงิน (บิลของวันที่เลือก)'}</p>
              <p className="stat-value"><span className="whitespace-nowrap">{baht(totals.refunds)}</span></p>
            </div>
          )}
          {level >= 3 && (
            <div className="stat-card">
              <p className="stat-label">บิลที่ยกเลิก</p>
              <p className="stat-value"><span className="whitespace-nowrap">{totals.voided.toLocaleString('th-TH')}</span> <span className="stat-sub">บิล</span></p>
            </div>
          )}
        </div>
      )}

      {/* ===== รายการบิล ===== */}
      <section className="card overflow-hidden" aria-busy={loading}>
        <div className="card-header flex-wrap gap-2">
          <h2 className="section-title">
            <History {...ICON} />
            {searching ? 'ผลการค้นหา' : isToday ? 'บิลวันนี้' : `บิลวันที่ ${formatThaiDate(day)}`}
          </h2>
          <div className="flex items-center gap-2">
            {!loading && !error && (
              <span className="chip tabular-nums">{rows.length.toLocaleString('th-TH')}{hasMore ? '+' : ''} บิล</span>
            )}
            <button
              type="button"
              onClick={() => void load(true)}
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
            <span className="sr-only">กำลังโหลดบิล...</span>
            {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-12 rounded-lg" />)}
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
              {searching ? <SearchX size={28} strokeWidth={1.75} aria-hidden="true" /> : <Receipt size={28} strokeWidth={1.75} aria-hidden="true" />}
            </span>
            <p className="empty-state-title break-words">
              {searching
                ? `ไม่พบบิลที่ตรงกับ "${search}"`
                : status === 'all' ? 'ไม่มีบิลในวันนี้' : 'ไม่มีบิลตามสถานะที่เลือกในวันนี้'}
            </p>
          </div>
        ) : (
          <>
            {/* มือถือ: แถวเรียงลงมา แตะทั้งแถวเพื่อดูรายละเอียด */}
            <ul className="md:hidden divide-y divide-gray-150">
              {rows.map(r => {
                const st = rowStatus(r)
                const voided = !!r.voided_at
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setDetailId(r.id)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left min-h-[56px] active:bg-gray-50"
                      aria-label={`ดูรายละเอียดบิล ${r.sale_no}`}
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className={`font-mono text-sm break-all ${voided ? 'text-gray-400' : 'text-gray-800'}`}>{r.sale_no}</p>
                        <p className="text-xs text-gray-500 tabular-nums">
                          {searching ? formatThaiDateTime(r.created_at) : formatThaiTime(r.created_at)}
                        </p>
                        <p className="text-xs text-gray-600"><PaymentCell row={r} /></p>
                      </div>
                      <div className="shrink-0 text-right space-y-1">
                        <p className={voided ? 'money text-gray-400 line-through' : 'money text-gray-900'}>{baht(r.net_amount)}</p>
                        {st.key !== 'normal' && <span className={st.chipClass}>{st.label}</span>}
                        {st.key === 'partial' && r.refunded_amount > 0 && <p className="text-xs text-amber-800 tabular-nums">คืน {baht(r.refunded_amount)}</p>}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>

            {/* จอกว้าง: ตาราง */}
            <div className="hidden md:block table-wrap">
              <table className="table-soft min-w-[640px]">
                <thead>
                  <tr>
                    <th>เลขที่</th>
                    <th>{searching ? 'วันเวลา' : 'เวลา'}</th>
                    <th>ชำระ / ช่องทาง</th>
                    <th className="text-right">ยอดสุทธิ</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const st = rowStatus(r)
                    const voided = !!r.voided_at
                    return (
                      <tr key={r.id} onClick={() => setDetailId(r.id)} className="cursor-pointer">
                        <td className="whitespace-nowrap">
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); setDetailId(r.id) }}
                            className={`font-mono text-xs text-left underline-offset-4 [@media(hover:hover)]:hover:underline ${voided ? 'text-gray-400' : 'text-gray-700'}`}
                            aria-label={`ดูรายละเอียดบิล ${r.sale_no}`}
                          >
                            {r.sale_no}
                          </button>
                        </td>
                        <td className="text-xs text-gray-500 whitespace-nowrap tabular-nums">
                          {searching ? formatThaiDateTime(r.created_at) : formatThaiTime(r.created_at)}
                        </td>
                        <td className="text-gray-600"><PaymentCell row={r} /></td>
                        <td className="text-right whitespace-nowrap">
                          <span className={voided ? 'money text-gray-400 line-through' : 'money text-gray-900'}>{baht(r.net_amount)}</span>
                          {st.key === 'partial' && r.refunded_amount > 0 && <span className="block text-xs text-amber-800 tabular-nums">คืน {baht(r.refunded_amount)}</span>}
                        </td>
                        <td className="whitespace-nowrap"><span className={st.chipClass}>{st.label}</span></td>
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
                <button
                  type="button"
                  onClick={() => void load(false)}
                  disabled={loadingMore}
                  className="btn-secondary px-5"
                >
                  {loadingMore && <Loader2 {...ICON_SM} className="animate-spin" />}
                  {loadingMore ? 'กำลังโหลด...' : 'โหลดเพิ่ม'}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <BillDetailDialog
        saleId={detailId}
        open={detailId !== null}
        onClose={closeDetail}
        canRefund={canRefund}
        shop={shop}
        onChanged={handleChanged}
      />
    </div>
  )
}
