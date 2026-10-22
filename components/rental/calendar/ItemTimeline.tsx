'use client'
// ปฏิทินชุด (rental_item_calendar) — เลือกแบบชุด 1 แบบ แล้วดูว่าชิ้นจริงแต่ละตัว "ว่าง/ถูกจอง" วันไหนบ้างทั้งเดือน
// - แถว = ชิ้น (รหัสชิ้น + ไซส์ ติดซ้ายตอนเลื่อน) · คอลัมน์ = วัน · แถบสี = วันเช่า (สีตามสถานะการจอง) · แถบลาย = วันกันไว้ซัก/เตรียม
// - ตารางกว้างกว่าจอมือถือ → เลื่อนข้างได้เฉพาะในกล่องของตัวเอง (ทั้งหน้าไม่เลื่อนข้าง)
// - ลูกค้าที่ยังไม่คืนชุดเลยกำหนด: ฐานข้อมูลกันช่วงไว้ถึงวันคืนตามสัญญาเท่านั้น → วาดแถบแดง "เกินกำหนด" ต่อถึงวันนี้ให้เห็นว่าชิ้นยังไม่กลับมา
// - ใต้ตารางมีรายการการจองของเดือนแบบอ่านง่าย (ใช้กับโปรแกรมอ่านจอ/มือถือ)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import {
  ArrowRight, CalendarSearch, ChevronLeft, ChevronRight, ListChecks, RefreshCw, Search, Shirt, Sparkles, XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { addDaysToKey, daysBetweenKeys, formatThaiDate } from '@/lib/format'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { isMigrationMissing } from '@/lib/migration'
import {
  FIX05_MISSING_MSG, STATUS_CHIP, UNIT_STATUS_LABELS, parseItemCalendar, sizeLabel, statusLabel,
  type ItemCalendar, type RentalBookingStatus,
} from '@/lib/rental'
import MigrationNotice from '@/components/pos/MigrationNotice'
import { THAI_WEEKDAYS_SHORT, addMonths, dayOfMonth, dayRange, monthFirstDay, monthLabel, monthLastDay, monthOfDay, weekdayOf } from './dates'
import { bookingHref, rentalErrorText, rpcWithTimeout } from './rpc'

interface ItemOption {
  id: string
  code: string
  name: string
  is_active: boolean
  is_accessory: boolean
}

const MAX_OPTIONS = 300
const FIRST_W = 132   // คอลัมน์ชิ้น (px)
// ความกว้างขั้นต่ำต่อวันอยู่ในตัวแปร CSS --tl-col: มือถือ 34px (แตะง่าย เลื่อนข้างในกล่อง) · จอกว้าง 26px (ทั้งเดือนพอดีจอ)

// สีแถบวันเช่าตามสถานะการจอง (ชื่อคลาสตรงๆ) — คู่กับชื่อลูกค้า/ป้ายในรายการด้านล่างเสมอ
// ธีมฟ้าใส (#18): เทาของธีมอมฟ้า → แยกสถานะด้วยมากกว่าความสว่าง (22/10/2569)
// - จองแล้ว = ฟ้า brand-400 ทึบ + เส้น brand-700 · คืนแล้ว/ส่งซ่อม = เทากลางไม่อมฟ้า (bg-off) · วันนี้ = กรอบ ไม่ใช่พื้นสี
const BAR_CLS: Record<RentalBookingStatus, string> = {
  pending: 'border-amber-300 bg-amber-100 text-amber-900',
  confirmed: 'border-brand-700 bg-brand-400 text-gray-900',
  picked_up: 'border-green-400 bg-green-100 text-green-900',
  returned: 'border-off-line bg-off text-gray-800',
  completed: 'border-gray-300 bg-gray-100 text-gray-600',
  cancelled: 'border-red-200 bg-red-50 text-red-800',
  expired: 'border-gray-300 bg-gray-100 text-gray-500',
  no_show: 'border-red-200 bg-red-50 text-red-800',
}

// ลายเส้นทแยงของวันกันไว้ (ซัก/เตรียม) — แยกจากวันเช่าได้โดยไม่ต้องพึ่งสี
// สีเส้น = gray-300 ของร้าน (ตัวแปร CSS) → ร้านเช่าเป็นเทาอมฟ้าตามธีม #18 ฟ้าใส (22/10/2569)
const HATCH_STYLE: React.CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(135deg, rgb(var(--c-gray-300)) 0, rgb(var(--c-gray-300)) 1px, transparent 1px, transparent 6px)',
}

const LEGEND: { label: string; cls: string; hatch?: boolean }[] = [
  { label: 'รอยืนยัน', cls: BAR_CLS.pending },
  { label: 'จองแล้ว', cls: BAR_CLS.confirmed },
  { label: 'กำลังเช่า', cls: BAR_CLS.picked_up },
  { label: 'คืนแล้ว / เสร็จสิ้น', cls: BAR_CLS.returned },
  { label: 'เกินกำหนดคืน', cls: 'border-red-300 bg-red-100 text-red-900' },
  { label: 'วันกันไว้ซัก/เตรียม', cls: 'border-gray-300 bg-white', hatch: true },
  { label: 'ส่งซ่อม / เลิกใช้', cls: 'border-off-line bg-off' },
]

function toOption(raw: unknown): ItemOption | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id : ''
  if (!id) return null
  return {
    id,
    code: typeof o.code === 'string' ? o.code : '',
    name: typeof o.name === 'string' ? o.name : '',
    is_active: o.is_active !== false,
    is_accessory: o.is_accessory === true,
  }
}

function optionLabel(o: ItemOption): string {
  const tags: string[] = []
  if (o.is_accessory) tags.push('เครื่องประดับ')
  if (!o.is_active) tags.push('ปิดใช้งาน')
  return `${o.code} · ${o.name}${tags.length ? ` (${tags.join(', ')})` : ''}`
}

interface Seg {
  key: string
  start: number      // ดัชนีคอลัมน์วันแรก (0 = วันแรกของเดือน)
  end: number        // ดัชนีคอลัมน์วันสุดท้าย (รวม)
  kind: 'rent' | 'buffer' | 'overdue'
  booking_id: string
  booking_no: string
  status: RentalBookingStatus
  customer_name: string
  pickup_date: string
  return_date: string
  from: string
  to: string
}

export default function ItemTimeline({
  month,
  today,
  itemId,
  onItemChange,
  onMonthChange,
}: {
  month: string
  today: string
  itemId: string | null
  onItemChange: (id: string | null) => void
  onMonthChange: (m: string) => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [options, setOptions] = useState<ItemOption[] | null>(null)
  const [optionsError, setOptionsError] = useState('')
  const [missing, setMissing] = useState(false)
  const [query, setQuery] = useState('')
  const [cal, setCal] = useState<ItemCalendar | null>(null)
  const [calKey, setCalKey] = useState('')
  const [calLoading, setCalLoading] = useState(false)
  const [calError, setCalError] = useState('')
  const reqRef = useRef(0)

  const from = monthFirstDay(month)
  const to = monthLastDay(month)
  const days = useMemo(() => dayRange(from, to), [from, to])
  const wantKey = itemId ? `${itemId}|${month}` : ''

  const loadOptions = useCallback(async () => {
    setOptionsError('')
    try {
      const rows = await fetchAllRows<unknown>((a, b) => supabase
        .from('rental_items')
        .select('id, code, name, is_active, is_accessory')
        .order('code')
        .order('id')
        .range(a, b))
      const list: ItemOption[] = []
      for (const r of rows) {
        const o = toOption(r)
        if (o) list.push(o)
      }
      setOptions(list)
    } catch (err) {
      if (isMigrationMissing(err)) setMissing(true)
      setOptionsError(rentalErrorText(err))
      setOptions(prev => prev ?? [])
    }
  }, [supabase])

  useEffect(() => {
    void loadOptions()
  }, [loadOptions])

  const loadCal = useCallback(async (id: string, m: string) => {
    const req = ++reqRef.current
    setCalLoading(true)
    setCalError('')
    const res = await rpcWithTimeout(supabase, 'rental_item_calendar', {
      p_item_id: id,
      p_from: monthFirstDay(m),
      p_to: monthLastDay(m),
    })
    if (req !== reqRef.current) return
    if (res.error) {
      if (isMigrationMissing(res.error)) setMissing(true)
      setCalError(rentalErrorText(res.error))
    } else {
      setCal(parseItemCalendar(res.data))
      setCalKey(`${id}|${m}`)
    }
    setCalLoading(false)
  }, [supabase])

  useEffect(() => {
    if (!itemId) {
      reqRef.current++
      setCal(null)
      setCalKey('')
      setCalError('')
      setCalLoading(false)
      return
    }
    void loadCal(itemId, month)
  }, [itemId, month, loadCal])

  const filtered = useMemo(() => {
    const list = options ?? []
    const q = query.trim().toLowerCase()
    const hit = q ? list.filter(o => o.code.toLowerCase().includes(q) || o.name.toLowerCase().includes(q)) : list
    const cut = hit.slice(0, MAX_OPTIONS)
    // ชุดที่เลือกอยู่ต้องอยู่ในตัวเลือกเสมอ (ไม่งั้นช่องเลือกว่างทั้งที่กำลังดูชุดนั้น)
    if (itemId && !cut.some(o => o.id === itemId)) {
      const sel = list.find(o => o.id === itemId)
      if (sel) cut.unshift(sel)
    }
    return { list: cut, total: hit.length }
  }, [options, query, itemId])

  if (missing) return <MigrationNotice message={FIX05_MISSING_MSG} />

  const shown = cal && calKey === wantKey ? cal : null
  const selectedOption = itemId ? (options ?? []).find(o => o.id === itemId) ?? null : null

  // ===== แถบของแต่ละชิ้น (ตัดให้อยู่ในเดือนที่ดู) =====
  const n = days.length
  const idxOf = (k: string) => daysBetweenKeys(from, k)
  const segsOf = (blocks: ItemCalendar['units'][number]['blocks']): Seg[] => {
    const out: Seg[] = []
    for (const b of blocks) {
      const s = Math.max(0, idxOf(b.block_from))
      const e = Math.min(n - 1, idxOf(b.block_to))
      if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) continue
      out.push({
        key: `${b.booking_id}-${b.kind}-${b.block_from}`,
        start: s, end: e, kind: b.kind,
        booking_id: b.booking_id, booking_no: b.booking_no, status: b.status, customer_name: b.customer_name,
        pickup_date: b.pickup_date, return_date: b.return_date, from: b.block_from, to: b.block_to,
      })
      // ลูกค้ายังไม่คืนเลยกำหนด → แถบแดงจากวันหลังกำหนดคืนถึงวันนี้ (ทับวันกันไว้ซัก)
      if (b.kind === 'rent' && b.status === 'picked_up' && b.return_date && b.return_date < today) {
        const os = Math.max(0, idxOf(addDaysToKey(b.return_date, 1)))
        const oe = Math.min(n - 1, idxOf(today))
        if (Number.isFinite(os) && Number.isFinite(oe) && oe >= os) {
          out.push({
            key: `${b.booking_id}-overdue`,
            start: os, end: oe, kind: 'overdue',
            booking_id: b.booking_id, booking_no: b.booking_no, status: b.status, customer_name: b.customer_name,
            pickup_date: b.pickup_date, return_date: b.return_date, from: addDaysToKey(b.return_date, 1), to: today,
          })
        }
      }
    }
    return out
  }

  // ===== รายการการจองของเดือน (รวมทุกชิ้น) =====
  const bookings = (() => {
    if (!shown) return []
    const map = new Map<string, { id: string; no: string; status: RentalBookingStatus; customer: string; pickup: string; ret: string; units: string[] }>()
    for (const u of shown.units) {
      for (const b of u.blocks) {
        if (!b.booking_id) continue
        const cur = map.get(b.booking_id)
        if (cur) {
          if (!cur.units.includes(u.unit_code)) cur.units.push(u.unit_code)
        } else {
          map.set(b.booking_id, {
            id: b.booking_id, no: b.booking_no, status: b.status, customer: b.customer_name,
            pickup: b.pickup_date, ret: b.return_date, units: [u.unit_code],
          })
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => (a.pickup < b.pickup ? -1 : a.pickup > b.pickup ? 1 : a.no.localeCompare(b.no)))
  })()

  const template = `${FIRST_W}px repeat(${n}, minmax(var(--tl-col), 1fr))`
  const minWidth = `calc(${FIRST_W}px + ${n} * var(--tl-col))`

  return (
    <div className="space-y-4">
      {/* ===== เลือกชุด + เดือน ===== */}
      <section className="card p-4 sm:p-5 space-y-3" aria-label="เลือกชุดและเดือน">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="timeline-search" className="field-label">ค้นหาชุด (รหัส / ชื่อ)</label>
            <div className="input-icon">
              <Search {...ICON_SM} />
              <input
                id="timeline-search"
                type="search"
                className="input pl-11"
                placeholder="เช่น DR-001 หรือ ชุดไทย"
                value={query}
                onChange={e => setQuery(e.target.value)}
                autoComplete="off"
                maxLength={60}
                enterKeyHint="search"
              />
            </div>
          </div>
          <div>
            <label htmlFor="timeline-item" className="field-label">ชุดที่ต้องการดู</label>
            <select
              id="timeline-item"
              className="input"
              value={itemId ?? ''}
              onChange={e => onItemChange(e.target.value || null)}
              disabled={options === null}
              aria-describedby="timeline-item-hint"
            >
              <option value="">{options === null ? 'กำลังโหลดรายการชุด...' : '— เลือกชุด —'}</option>
              {filtered.list.map(o => <option key={o.id} value={o.id}>{optionLabel(o)}</option>)}
            </select>
            <p id="timeline-item-hint" className="field-hint">
              {options === null
                ? 'กำลังโหลด...'
                : query.trim()
                  ? `พบ ${filtered.total.toLocaleString('th-TH')} ชุด${filtered.total > MAX_OPTIONS ? ` (แสดง ${MAX_OPTIONS} รายการแรก — พิมพ์ค้นหาให้แคบลง)` : ''}`
                  : `ทั้งหมด ${(options ?? []).length.toLocaleString('th-TH')} ชุด`}
            </p>
          </div>
        </div>
        {optionsError && (
          <div role="alert" className="alert-err">
            <XCircle {...ICON_SM} />
            <div className="min-w-0 space-y-2">
              <p className="break-words">โหลดรายการชุดไม่สำเร็จ: {optionsError}</p>
              <button type="button" onClick={() => void loadOptions()} className="btn-secondary px-4 text-sm">
                <RefreshCw {...ICON_SM} />
                ลองใหม่
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onMonthChange(addMonths(month, -1))} className="btn-icon shrink-0" aria-label="เดือนก่อนหน้า">
            <ChevronLeft {...ICON_SM} />
          </button>
          <p className="min-w-0 flex-1 text-center text-base sm:text-lg font-semibold text-gray-900" aria-live="polite">{monthLabel(month)}</p>
          <button type="button" onClick={() => onMonthChange(addMonths(month, 1))} className="btn-icon shrink-0" aria-label="เดือนถัดไป">
            <ChevronRight {...ICON_SM} />
          </button>
          <button
            type="button"
            onClick={() => { if (itemId) void loadCal(itemId, month) }}
            disabled={!itemId || calLoading}
            className="btn-icon btn-icon-plain shrink-0"
            aria-label="โหลดปฏิทินชุดใหม่"
          >
            <RefreshCw {...ICON_SM} className={calLoading ? 'animate-spin' : undefined} />
          </button>
        </div>
        {monthOfDay(today) !== month && (
          <div className="flex justify-end">
            <button type="button" onClick={() => onMonthChange(monthOfDay(today))} className="btn-ghost px-3 text-sm">
              กลับไปเดือนนี้
            </button>
          </div>
        )}
      </section>

      {!itemId ? (
        <div className="card empty-state">
          <span className="icon-bubble icon-bubble-lg"><CalendarSearch size={28} strokeWidth={1.75} aria-hidden="true" /></span>
          <p className="empty-state-title">เลือกชุดเพื่อดูวันว่างของแต่ละชิ้น</p>
          <p className="max-w-md">ค้นหาด้วยรหัสหรือชื่อชุดด้านบน — ตารางจะแสดงทุกชิ้น (ทุกไซส์) ของชุดนั้นตลอดทั้งเดือน</p>
        </div>
      ) : (
        <>
          {calError && (
            <div role="alert" className="alert-err">
              <XCircle {...ICON_SM} />
              <div className="min-w-0 space-y-2">
                <p className="break-words">{calError}</p>
                <button type="button" onClick={() => void loadCal(itemId, month)} disabled={calLoading} className="btn-secondary px-4 text-sm">
                  <RefreshCw {...ICON_SM} />
                  ลองใหม่
                </button>
              </div>
            </div>
          )}

          {!shown && calLoading && (
            <div className="card p-4 sm:p-5 space-y-3" role="status" aria-busy="true">
              <span className="sr-only">กำลังโหลดปฏิทินชุด...</span>
              {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-11 rounded-lg" />)}
            </div>
          )}

          {shown && (
            <>
              <section className={clsx('card overflow-hidden transition-opacity', calLoading && 'opacity-60')} aria-busy={calLoading} aria-labelledby="timeline-title">
                <div className="card-header flex-wrap">
                  <h2 id="timeline-title" className="section-title min-w-0 flex-wrap gap-y-0">
                    <Shirt {...ICON} />
                    <span className="font-mono text-sm sm:text-base">{shown.item.code || selectedOption?.code}</span>
                    <span className="min-w-0 break-words">{shown.item.name || selectedOption?.name}</span>
                  </h2>
                  <Link href={`/rental/items/${encodeURIComponent(itemId)}`} prefetch={false} className="link shrink-0 text-sm">
                    เปิดหน้าชุด
                    <ArrowRight {...ICON_SM} />
                  </Link>
                </div>

                {shown.units.length === 0 ? (
                  <div className="empty-state">
                    <p className="empty-state-title">ชุดนี้ยังไม่มีชิ้นจริง</p>
                    <p>เพิ่มชิ้น (ไซส์/รหัสชิ้น) ได้ที่หน้าชุด แล้วกลับมาดูวันว่างอีกครั้ง</p>
                  </div>
                ) : (
                  <div className="table-wrap" role="group" aria-label={`วันว่างรายชิ้น เดือน${monthLabel(month)}`}>
                    <div className="[--tl-col:34px] lg:[--tl-col:26px]" style={{ minWidth }}>
                      {/* หัววัน */}
                      <div className="grid border-b border-gray-200 bg-gray-50" style={{ gridTemplateColumns: template }} aria-hidden="true">
                        <div className="sticky left-0 z-10 border-r border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-600" style={{ gridColumn: 1, gridRow: 1 }}>
                          ชิ้น / ไซส์
                        </div>
                        {days.map((k, i) => {
                          const wd = weekdayOf(k)
                          const isToday = k === today
                          return (
                            <div
                              key={k}
                              style={{ gridColumn: i + 2, gridRow: 1 }}
                              className={clsx(
                                'flex flex-col items-center justify-center py-1 text-center leading-tight border-l border-gray-150',
                                // วันนี้ = กรอบ brand-600 บนพื้นขาว (ไม่ใช้พื้นฟ้า — ใกล้สีแถบ "จองแล้ว" เกินไป)
                                isToday ? 'bg-white text-gray-900 ring-2 ring-inset ring-brand-600' : wd === 0 || wd === 6 ? 'text-brand-700' : 'text-gray-600',
                              )}
                            >
                              <span className="text-[10px]">{THAI_WEEKDAYS_SHORT[wd]}</span>
                              <span className="text-xs font-semibold tabular-nums">{dayOfMonth(k)}</span>
                            </div>
                          )
                        })}
                      </div>

                      {/* แถวชิ้น */}
                      {shown.units.map((u, ui) => {
                        const segs = segsOf(u.blocks)
                        const blocked = new Set<number>()
                        for (const s of segs) for (let i = s.start; i <= s.end; i++) blocked.add(i)
                        const out = u.status !== 'available'
                        const freeDays = out ? 0 : n - blocked.size
                        return (
                          <div
                            key={u.unit_id}
                            className={clsx('grid', ui > 0 && 'border-t border-gray-150')}
                            style={{ gridTemplateColumns: template }}
                          >
                            <div
                              className={clsx('sticky left-0 z-10 flex min-h-[52px] flex-col justify-center border-r border-gray-200 px-3 py-1.5', out ? 'bg-gray-100' : 'bg-white')}
                              style={{ gridColumn: 1, gridRow: 1 }}
                            >
                              <span className="truncate font-mono text-xs font-semibold text-gray-900" title={u.unit_code}>{u.unit_code}</span>
                              <span className="flex flex-wrap items-center gap-x-1.5 text-[11px] leading-4 text-gray-600">
                                <span>{sizeLabel(u.size)}</span>
                                {out ? (
                                  <span className="font-medium text-gray-700">{u.status === 'retired' ? 'เลิกใช้' : 'ส่งซ่อม'}</span>
                                ) : (
                                  <span className="tabular-nums">ว่าง {freeDays} วัน</span>
                                )}
                                {u.needs_cleaning && (
                                  <span className="inline-flex items-center gap-0.5 text-amber-800" title="รอซัก/เตรียม">
                                    <Sparkles size={12} strokeWidth={1.9} aria-hidden="true" />
                                    รอซัก
                                  </span>
                                )}
                              </span>
                              {out && <span className="sr-only">{UNIT_STATUS_LABELS[u.status]}</span>}
                            </div>
                            {days.map((k, i) => {
                              const wd = weekdayOf(k)
                              return (
                                <div
                                  key={k}
                                  aria-hidden="true"
                                  style={{ gridColumn: i + 2, gridRow: 1 }}
                                  className={clsx(
                                    'border-l border-gray-150',
                                    out ? 'bg-off' : k === today ? 'bg-brand-50' : wd === 0 || wd === 6 ? 'bg-gray-50' : '',
                                  )}
                                />
                              )
                            })}
                            {segs.map(s => {
                              const title = s.kind === 'buffer'
                                ? `วันกันไว้ซัก/เตรียม ${formatThaiDate(s.from)}${s.from !== s.to ? ` – ${formatThaiDate(s.to)}` : ''} (${s.booking_no})`
                                : s.kind === 'overdue'
                                  ? `${s.booking_no} ${s.customer_name} — เกินกำหนดคืน (กำหนดคืน ${formatThaiDate(s.return_date)}) ยังไม่ได้คืนชุด`
                                  : `${s.booking_no} ${s.customer_name} — ${statusLabel(s.status)} รับ ${formatThaiDate(s.pickup_date)} คืน ${formatThaiDate(s.return_date)}`
                              const style = { gridColumn: `${s.start + 2} / ${s.end + 3}`, gridRow: 1 }
                              if (s.kind === 'buffer') {
                                return (
                                  <span
                                    key={s.key}
                                    style={{ ...style, ...HATCH_STYLE }}
                                    className="relative z-[1] mx-0.5 my-2.5 rounded border border-gray-300 bg-white"
                                    title={title}
                                  >
                                    <span className="sr-only">{title}</span>
                                  </span>
                                )
                              }
                              return (
                                <Link
                                  key={s.key}
                                  href={bookingHref(s.booking_id)}
                                  prefetch={false}
                                  style={style}
                                  title={title}
                                  aria-label={title}
                                  className={clsx(
                                    'relative flex min-w-0 items-center overflow-hidden rounded border px-1.5 text-[11px] font-medium leading-4 mx-0.5 my-2',
                                    s.kind === 'overdue' ? 'z-[2] border-red-300 bg-red-100 text-red-900' : clsx('z-[1]', BAR_CLS[s.status]),
                                  )}
                                >
                                  <span className="truncate">{s.kind === 'overdue' ? 'เกินกำหนด' : s.customer_name || s.booking_no}</span>
                                </Link>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* คำอธิบายสี */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-200 px-4 py-2.5 sm:px-5 text-xs text-gray-600">
                  {LEGEND.map(l => (
                    <span key={l.label} className="inline-flex items-center gap-1.5">
                      <span className={clsx('inline-block h-3.5 w-5 rounded border', l.cls)} style={l.hatch ? HATCH_STYLE : undefined} aria-hidden="true" />
                      {l.label}
                    </span>
                  ))}
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-3.5 w-5 rounded border-2 border-brand-600 bg-white" aria-hidden="true" />
                    วันนี้
                  </span>
                </div>
              </section>

              {/* ===== รายการการจองของเดือน ===== */}
              <section className="card overflow-hidden" aria-labelledby="timeline-bookings-title">
                <div className="card-header">
                  <h2 id="timeline-bookings-title" className="section-title">
                    <ListChecks {...ICON} />
                    การจองของชุดนี้ในเดือน{monthLabel(month)}
                    <span className="text-sm font-normal text-gray-500">({bookings.length.toLocaleString('th-TH')})</span>
                  </h2>
                </div>
                {bookings.length === 0 ? (
                  <p className="px-4 py-5 sm:px-5 text-sm text-gray-500">ยังไม่มีการจองในเดือนนี้ — ทุกชิ้นที่พร้อมให้เช่าว่างทั้งเดือน</p>
                ) : (
                  <ul className="divide-y divide-gray-150">
                    {bookings.map(b => {
                      const late = b.status === 'picked_up' && b.ret !== '' && b.ret < today
                      return (
                        <li key={b.id}>
                          <Link
                            href={bookingHref(b.id)}
                            prefetch={false}
                            className="flex min-h-[56px] items-center gap-3 px-4 py-3 sm:px-5 transition-colors active:bg-gray-100 [@media(hover:hover)]:hover:bg-gray-50"
                          >
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="font-mono text-xs text-gray-700 break-all">{b.no}</span>
                                <span className={STATUS_CHIP[b.status]}>{statusLabel(b.status)}</span>
                                {late && <span className="badge-out">เกินกำหนดคืน</span>}
                              </div>
                              <p className="text-sm font-medium text-gray-900 break-words">{b.customer || '-'}</p>
                              <p className="text-xs text-gray-600 tabular-nums">
                                รับ {formatThaiDate(b.pickup)} – คืน {formatThaiDate(b.ret)} · ชิ้น <span className="font-mono">{b.units.join(', ')}</span>
                              </p>
                            </div>
                            <ChevronRight {...ICON_XS} className="shrink-0 text-gray-400" />
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}
