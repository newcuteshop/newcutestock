'use client'
// ===== ปฏิทินว่างของชุด 1 แบบ: ชิ้น × วัน ทีละเดือน (rpc rental_item_calendar) =====
// - แถว = ชิ้นจริง 1 ตัว (รหัสชิ้น + ไซส์) · คอลัมน์ = วันในเดือน · คอลัมน์แรกติดซ้าย เลื่อนข้างได้ในกรอบของตัวเอง
// - แถบทึบ = วันเช่าจริง (สีตามสถานะการจอง กดแล้วไปหน้าการจอง) · แถบลายขีด = วันกันไว้ก่อน/หลังเช่า (เตรียม/ซักชุด)
// - ชิ้นส่งซ่อม = พื้นเทาทั้งแถว (จองใหม่ไม่ได้) · ชิ้นเลิกใช้ = จางลง
// - มือถือ: ใต้ตารางมีรายการการจองของเดือนนั้นแบบอ่านง่าย (ไม่ต้องเลื่อนตารางหา)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { addDaysToKey, bangkokTodayKey, daysBetweenKeys, formatThaiDate, thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import {
  FIX05_MISSING_MSG, STATUS_LABELS, parseItemCalendar, sizeLabel,
  type CalendarBlock, type ItemCalendar as ItemCalendarData, type RentalBookingStatus,
} from '@/lib/rental'

const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
const CELL = 34 // px ต่อวัน
const LOAD_TIMEOUT_MS = 20000

// สีแถบวันเช่าตามสถานะ (คู่ข้อความในแถบเสมอ ไม่พึ่งสีอย่างเดียว)
const RENT_TONE: Record<RentalBookingStatus, string> = {
  pending: 'border border-dashed border-amber-500 bg-amber-50 text-amber-900',
  confirmed: 'border border-brand-500 bg-brand-200 text-gray-900',
  picked_up: 'border border-green-600 bg-green-100 text-green-900',
  returned: 'border border-gray-400 bg-gray-150 text-gray-800',
  completed: 'border border-gray-300 bg-gray-100 text-gray-600',
  cancelled: 'border border-gray-300 bg-white text-gray-500',
  expired: 'border border-gray-300 bg-white text-gray-500',
  no_show: 'border border-gray-300 bg-white text-gray-500',
}

// ลายขีดของวันกันไว้ (เตรียม/ซัก)
const HATCH: React.CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(135deg, #D5D2D3 0, #D5D2D3 2px, transparent 2px, transparent 6px)',
  backgroundColor: '#FAF9FA',
}

function monthStart(key: string): string {
  return `${key.slice(0, 7)}-01`
}

function monthEnd(startKey: string): string {
  const y = Number(startKey.slice(0, 4))
  const m = Number(startKey.slice(5, 7))
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return addDaysToKey(next, -1)
}

function shiftMonth(startKey: string, delta: number): string {
  let y = Number(startKey.slice(0, 4))
  let m = Number(startKey.slice(5, 7)) + delta
  while (m < 1) { m += 12; y -= 1 }
  while (m > 12) { m -= 12; y += 1 }
  return `${y}-${String(m).padStart(2, '0')}-01`
}

function monthTitle(startKey: string): string {
  const y = Number(startKey.slice(0, 4))
  const m = Number(startKey.slice(5, 7))
  return `${MONTHS[m - 1] ?? ''} ${y + 543}`
}

function weekdayOf(key: string): number {
  const y = Number(key.slice(0, 4))
  const m = Number(key.slice(5, 7))
  const d = Number(key.slice(8, 10))
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

type Seg = { block: CalendarBlock; start: number; span: number }

export default function ItemCalendar({ itemId }: { itemId: string }) {
  const supabase = useMemo(() => createClient(), [])
  const today = useMemo(() => bangkokTodayKey(), [])
  const [month, setMonth] = useState(() => monthStart(today))
  const [data, setData] = useState<ItemCalendarData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const reqRef = useRef(0)

  const from = month
  const to = monthEnd(month)
  const days = useMemo(() => {
    const n = daysBetweenKeys(from, to) + 1
    return Array.from({ length: Math.max(0, n) }, (_, i) => addDaysToKey(from, i))
  }, [from, to])

  const load = useCallback(async () => {
    const req = ++reqRef.current
    setLoading(true)
    setError('')
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('เซิร์ฟเวอร์ตอบช้าเกินไป — กด "ลองใหม่"')), LOAD_TIMEOUT_MS)
      })
      const res = await Promise.race([
        supabase.rpc('rental_item_calendar', { p_item_id: itemId, p_from: from, p_to: to }),
        timeout,
      ])
      if (req !== reqRef.current) return
      if (res.error) {
        if (isMigrationMissing(res.error)) { setMissing(true); return }
        throw res.error
      }
      setMissing(false)
      setData(parseItemCalendar(res.data))
    } catch (e) {
      if (req === reqRef.current) setError(thaiError(e))
    } finally {
      if (timer) clearTimeout(timer)
      if (req === reqRef.current) setLoading(false)
    }
  }, [supabase, itemId, from, to])

  useEffect(() => { void load() }, [load, reloadKey])

  // แถบของแต่ละชิ้น (ตัดให้อยู่ในเดือนที่ดู)
  const rows = useMemo(() => {
    const units = data?.units ?? []
    return units.map(u => {
      const segs: Seg[] = []
      for (const b of u.blocks) {
        const f = b.block_from < from ? from : b.block_from
        const t = b.block_to > to ? to : b.block_to
        const start = daysBetweenKeys(from, f)
        const span = daysBetweenKeys(f, t) + 1
        if (!Number.isFinite(start) || !Number.isFinite(span) || span <= 0) continue
        segs.push({ block: b, start, span })
      }
      return { unit: u, segs }
    })
  }, [data, from, to])

  // รายการการจองของเดือน (ไม่ซ้ำ เรียงตามวันรับ) สำหรับดูแบบรายการ
  const bookings = useMemo(() => {
    const map = new Map<string, { block: CalendarBlock; units: string[] }>()
    for (const r of rows) {
      for (const s of r.segs) {
        if (s.block.kind !== 'rent') continue
        const key = s.block.booking_id || s.block.booking_no
        const cur = map.get(key) ?? { block: s.block, units: [] }
        if (!cur.units.includes(r.unit.unit_code)) cur.units.push(r.unit.unit_code)
        map.set(key, cur)
      }
    }
    return Array.from(map.values()).sort((a, b) => (a.block.pickup_date < b.block.pickup_date ? -1 : a.block.pickup_date > b.block.pickup_date ? 1 : 0))
  }, [rows])

  const thisMonth = monthStart(today)
  const gridWidth = days.length * CELL

  return (
    <section className="card p-4 sm:p-5 space-y-4 min-w-0" aria-labelledby="ri-cal-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ri-cal-title" className="section-title">
          <CalendarDays {...ICON} />
          ปฏิทินว่างของชุด
        </h2>
        <div className="flex items-center gap-1.5">
          <button type="button" className="btn-icon" aria-label="เดือนก่อนหน้า" onClick={() => setMonth(m => shiftMonth(m, -1))}>
            <ChevronLeft {...ICON_SM} />
          </button>
          <p className="min-w-[8.5rem] text-center text-sm font-semibold text-gray-900 tabular-nums" aria-live="polite">
            {monthTitle(month)}
          </p>
          <button type="button" className="btn-icon" aria-label="เดือนถัดไป" onClick={() => setMonth(m => shiftMonth(m, 1))}>
            <ChevronRight {...ICON_SM} />
          </button>
          {month !== thisMonth && (
            <button type="button" className="btn-ghost min-h-[44px] px-3 text-sm" onClick={() => setMonth(thisMonth)}>
              เดือนนี้
            </button>
          )}
        </div>
      </div>

      {/* คำอธิบายสี */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-600" aria-label="คำอธิบายสี">
        <li className="inline-flex items-center gap-1.5"><span className={clsx('h-3 w-5 rounded-sm', RENT_TONE.pending)} aria-hidden="true" />รอยืนยัน</li>
        <li className="inline-flex items-center gap-1.5"><span className={clsx('h-3 w-5 rounded-sm', RENT_TONE.confirmed)} aria-hidden="true" />จองแล้ว</li>
        <li className="inline-flex items-center gap-1.5"><span className={clsx('h-3 w-5 rounded-sm', RENT_TONE.picked_up)} aria-hidden="true" />กำลังเช่า</li>
        <li className="inline-flex items-center gap-1.5"><span className={clsx('h-3 w-5 rounded-sm', RENT_TONE.returned)} aria-hidden="true" />คืนแล้ว</li>
        <li className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm border border-gray-300" style={HATCH} aria-hidden="true" />วันเตรียม/ซักชุด</li>
        <li className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm bg-gray-200" aria-hidden="true" />ส่งซ่อม (จองไม่ได้)</li>
      </ul>

      {missing ? (
        <div role="alert" className="alert-warn">
          <XCircle {...ICON_SM} />
          <p className="min-w-0">{FIX05_MISSING_MSG}</p>
        </div>
      ) : error ? (
        <div role="alert" className="alert-err">
          <XCircle {...ICON_SM} />
          <div className="min-w-0 space-y-2">
            <p className="break-words">{error}</p>
            <button type="button" className="btn-secondary px-4 text-sm" onClick={() => setReloadKey(k => k + 1)}>
              <RefreshCw {...ICON_SM} />
              ลองใหม่
            </button>
          </div>
        </div>
      ) : loading && !data ? (
        <div className="space-y-2" role="status">
          <span className="sr-only">กำลังโหลดปฏิทิน...</span>
          {[0, 1, 2].map(i => <div key={i} className="skeleton h-10 rounded-lg" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="empty-state py-6">ยังไม่มีชิ้นชุด — เพิ่มชิ้นที่แท็บข้อมูลชุดก่อน</p>
      ) : (
        <div className="relative">
          {loading && (
            <span className="absolute right-2 top-2 z-20 inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-600" role="status">
              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
              กำลังโหลด
            </span>
          )}
          <div className="table-wrap rounded-lg border border-gray-200" role="region" aria-label={`ตารางวันว่าง ${monthTitle(month)} (เลื่อนซ้ายขวาได้)`} tabIndex={0}>
            <div style={{ width: `calc(6.5rem + ${gridWidth}px)` }} className="min-w-full">
              {/* หัววัน */}
              <div className="flex border-b border-gray-200 bg-gray-50">
                <div className="sticky left-0 z-10 w-[6.5rem] shrink-0 border-r border-gray-200 bg-gray-50 px-2 py-1.5 text-xs font-semibold text-gray-600">
                  ชิ้น / ไซส์
                </div>
                {days.map(d => {
                  const wd = weekdayOf(d)
                  const isToday = d === today
                  return (
                    <div
                      key={d}
                      style={{ width: CELL }}
                      className={clsx(
                        'shrink-0 py-1 text-center leading-tight',
                        wd === 0 || wd === 6 ? 'bg-gray-100' : '',
                        isToday && 'bg-brand-100',
                      )}
                    >
                      <div className={clsx('text-[11px]', isToday ? 'font-semibold text-brand-700' : 'text-gray-500')}>{WEEKDAYS[wd]}</div>
                      <div className={clsx('text-sm tabular-nums', isToday ? 'font-bold text-brand-700' : 'font-medium text-gray-800')}>
                        {Number(d.slice(8, 10))}
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* แถวชิ้น */}
              {rows.map(({ unit, segs }) => {
                const maint = unit.status === 'maintenance'
                const retired = unit.status === 'retired'
                return (
                  <div key={unit.unit_id} className={clsx('flex border-b border-gray-150 last:border-b-0', retired && 'opacity-60')}>
                    <div className="sticky left-0 z-10 w-[6.5rem] shrink-0 border-r border-gray-200 bg-white px-2 py-1">
                      <p className="truncate font-mono text-xs font-semibold text-gray-900" title={unit.unit_code}>{unit.unit_code}</p>
                      <p className="truncate text-[11px] text-gray-500">
                        {sizeLabel(unit.size)}
                        {maint ? ' · ส่งซ่อม' : retired ? ' · เลิกใช้' : unit.needs_cleaning ? ' · รอซัก' : ''}
                      </p>
                    </div>
                    <div className={clsx('relative h-11 shrink-0', maint && 'bg-gray-200')} style={{ width: gridWidth }}>
                      {/* เส้นแบ่งวัน + วันนี้ */}
                      {days.map((d, i) => (
                        <span
                          key={d}
                          aria-hidden="true"
                          className={clsx('absolute inset-y-0 border-r border-gray-100', d === today && 'bg-brand-50')}
                          style={{ left: i * CELL, width: CELL }}
                        />
                      ))}
                      {segs.map((s, i) => {
                        const b = s.block
                        const label = `${b.booking_no} · ${b.customer_name} · ${STATUS_LABELS[b.status]} · รับ ${formatThaiDate(b.pickup_date)} คืน ${formatThaiDate(b.return_date)}`
                        if (b.kind === 'buffer') {
                          return (
                            <span
                              key={`${b.booking_id}-${i}`}
                              className="absolute top-2 bottom-2 rounded-sm border border-gray-300"
                              style={{ ...HATCH, left: s.start * CELL + 1, width: s.span * CELL - 2 }}
                              title={`วันเตรียม/ซักชุด (${b.booking_no})`}
                              aria-hidden="true"
                            />
                          )
                        }
                        const style = { left: s.start * CELL + 1, width: s.span * CELL - 2 }
                        // ในแถบแสดงชื่อลูกค้า (พนักงานจำชื่อได้ง่ายกว่าเลขที่) — เลขที่เต็มอยู่ใน title / รายการด้านล่าง
                        const text = s.span >= 2 ? (b.customer_name || b.booking_no) : ''
                        const cls = clsx(
                          'absolute top-1.5 bottom-1.5 flex items-center overflow-hidden rounded-md px-1.5 text-[11px] font-semibold leading-tight',
                          RENT_TONE[b.status],
                        )
                        return b.booking_id ? (
                          <Link
                            key={`${b.booking_id}-${i}`}
                            href={`/rental/bookings/${b.booking_id}`}
                            prefetch={false}
                            className={clsx(cls, 'focus-visible:z-10')}
                            style={style}
                            title={label}
                            aria-label={label}
                          >
                            <span className="truncate">{text}</span>
                          </Link>
                        ) : (
                          <span key={`${b.booking_no}-${i}`} className={cls} style={style} title={label}>
                            <span className="truncate">{text}</span>
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* รายการการจองในเดือน */}
      {!missing && !error && data && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">การจองที่มีวันเช่าในเดือนนี้ ({bookings.length})</h3>
          {bookings.length === 0 ? (
            <p className="text-sm text-gray-500">ว่างทั้งเดือน — ยังไม่มีการจอง</p>
          ) : (
            <ul className="divide-y divide-gray-150 rounded-lg border border-gray-200">
              {bookings.map(({ block: b, units }) => {
                const body = (
                  <>
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="font-mono font-semibold text-gray-900">{b.booking_no}</span>{' '}
                        <span className="text-gray-700 break-words">{b.customer_name}</span>
                      </p>
                      <p className="text-xs text-gray-500 tabular-nums">
                        รับ {formatThaiDate(b.pickup_date)} · คืน {formatThaiDate(b.return_date)} · ชิ้น {units.join(', ')}
                      </p>
                    </div>
                    <span className={clsx('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', RENT_TONE[b.status])}>
                      {STATUS_LABELS[b.status]}
                    </span>
                  </>
                )
                return (
                  <li key={b.booking_id || b.booking_no}>
                    {b.booking_id ? (
                      <Link
                        href={`/rental/bookings/${b.booking_id}`}
                        prefetch={false}
                        className="flex min-h-[52px] items-center justify-between gap-3 px-3 py-2 transition-colors [@media(hover:hover)]:hover:bg-gray-50"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="flex min-h-[52px] items-center justify-between gap-3 px-3 py-2">{body}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
