'use client'
// ===== ประวัติการเช่าของชุด 1 แบบ =====
// อ่านตาราง rental_bookings ตรง (RLS: พนักงานร้านเช่า) เฉพาะการจองที่มีบรรทัดของชุดนี้ (embed !inner + กรอง item_id)
// → บรรทัดที่ได้มาเป็นของชุดนี้เท่านั้น (ชิ้นไหน ไซส์อะไร ค่าเช่าเท่าไร) · เรียงวันรับล่าสุดก่อน โหลดทีละ 30 รายการ
// ตัวเลขสรุปด้านบนมาจาก stats ของ rental_item_json (นับในฐานข้อมูล ไม่ขึ้นกับจำนวนที่โหลดมาแสดง)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, History, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { baht, formatThaiDate, thaiError } from '@/lib/format'
import { num, round2 } from '@/lib/money'
import { isMigrationMissing } from '@/lib/migration'
import {
  CONDITION_LABELS, FIX05_MISSING_MSG, LINE_STATUS_LABELS, RENTAL_BOOKING_STATUSES, RENTAL_CONDITIONS, RENTAL_LINE_STATUSES,
  STATUS_CHIP, STATUS_LABELS, rentalDays, sizeLabel,
  type RentalBookingStatus, type RentalCondition, type RentalItemStats, type RentalLineStatus,
} from '@/lib/rental'

const PAGE = 30
const LOAD_TIMEOUT_MS = 20000

type HistoryLine = {
  id: string
  unit_id: string
  size: string | null
  rent_price: number
  status: RentalLineStatus
  return_condition: RentalCondition | null
}

type HistoryRow = {
  id: string
  booking_no: string
  status: RentalBookingStatus
  pickup_date: string
  return_date: string
  returned_on: string | null
  customer_name: string
  lines: HistoryLine[]
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v)
}

function oneOf<T extends string>(v: unknown, list: readonly T[], fallback: T): T {
  const s = str(v)
  return (list as readonly string[]).includes(s) ? (s as T) : fallback
}

function toRow(raw: unknown): HistoryRow | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = str(o.id)
  if (!id) return null
  const cust = o.customer && typeof o.customer === 'object' && !Array.isArray(o.customer) ? (o.customer as Record<string, unknown>) : {}
  const lines: HistoryLine[] = []
  for (const l of Array.isArray(o.rental_booking_lines) ? o.rental_booking_lines : []) {
    if (!l || typeof l !== 'object') continue
    const x = l as Record<string, unknown>
    lines.push({
      id: str(x.id),
      unit_id: str(x.unit_id),
      size: str(x.size).trim() ? str(x.size) : null,
      rent_price: round2(num(x.rent_price)),
      status: oneOf(x.status, RENTAL_LINE_STATUSES, 'booked'),
      return_condition: x.return_condition ? oneOf(x.return_condition, RENTAL_CONDITIONS, 'ok') : null,
    })
  }
  return {
    id,
    booking_no: str(o.booking_no),
    status: oneOf(o.status, RENTAL_BOOKING_STATUSES, 'pending'),
    pickup_date: str(o.pickup_date).slice(0, 10),
    return_date: str(o.return_date).slice(0, 10),
    returned_on: o.returned_on ? str(o.returned_on).slice(0, 10) : null,
    customer_name: str(cust.name),
    lines,
  }
}

export default function ItemHistory({
  itemId, unitCodes, stats, activeUnits,
}: {
  itemId: string
  /** id ชิ้น → รหัสชิ้น (ชิ้นทั้งหมดของชุดรวมที่เลิกใช้) */
  unitCodes: ReadonlyMap<string, string>
  stats: RentalItemStats
  /** จำนวนชิ้นที่ยังไม่เลิกใช้ (ใช้คิดอัตราการถูกเช่า 90 วัน) */
  activeUnits: number
}) {
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const reqRef = useRef(0)

  const loadPage = useCallback(async (offset: number) => {
    const req = ++reqRef.current
    setLoading(true)
    setError('')
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('เซิร์ฟเวอร์ตอบช้าเกินไป — กด "ลองใหม่"')), LOAD_TIMEOUT_MS)
      })
      const res = await Promise.race([
        supabase
          .from('rental_bookings')
          .select(
            'id, booking_no, status, pickup_date, return_date, returned_on, customer:rental_customers(name), ' +
            'rental_booking_lines!inner(id, unit_id, size, rent_price, status, return_condition, item_id)',
          )
          .eq('rental_booking_lines.item_id', itemId)
          .order('pickup_date', { ascending: false })
          .order('id', { ascending: false })
          .range(offset, offset + PAGE),
        timeout,
      ])
      if (req !== reqRef.current) return
      if (res.error) {
        if (isMigrationMissing(res.error)) { setMissing(true); return }
        throw res.error
      }
      const list = (Array.isArray(res.data) ? res.data : []).map(toRow).filter((r): r is HistoryRow => r !== null)
      // ขอเกินมา 1 แถวไว้ดูว่ายังมีต่อไหม
      setHasMore(list.length > PAGE)
      const pageRows = list.slice(0, PAGE)
      setRows(prev => (offset === 0 ? pageRows : [...prev, ...pageRows.filter(r => !prev.some(p => p.id === r.id))]))
    } catch (e) {
      if (req === reqRef.current) setError(thaiError(e))
    } finally {
      if (timer) clearTimeout(timer)
      if (req === reqRef.current) setLoading(false)
    }
  }, [supabase, itemId])

  useEffect(() => { void loadPage(0) }, [loadPage])

  // อัตราการถูกเช่า 90 วัน = วันที่ถูกเช่ารวม ÷ (90 × จำนวนชิ้นที่ใช้งาน)
  const utilization = activeUnits > 0 ? Math.min(100, Math.round((stats.days_rented_90d / (90 * activeUnits)) * 100)) : 0

  return (
    <section className="card p-4 sm:p-5 space-y-4 min-w-0" aria-labelledby="ri-hist-title">
      <h2 id="ri-hist-title" className="section-title">
        <History {...ICON} />
        ประวัติการเช่า
      </h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="panel px-3 py-2.5">
          <p className="text-xs text-gray-500">ถูกจองทั้งหมด</p>
          <p className="money text-lg text-gray-900">{stats.bookings_total.toLocaleString('en-US')} ครั้ง</p>
        </div>
        <div className="panel px-3 py-2.5">
          <p className="text-xs text-gray-500">รายได้ค่าเช่ารวม</p>
          <p className="money text-lg text-gray-900">{baht(stats.revenue_total)}</p>
        </div>
        <div className="panel px-3 py-2.5">
          <p className="text-xs text-gray-500">วันที่ถูกเช่า (90 วัน)</p>
          <p className="money text-lg text-gray-900">{stats.days_rented_90d.toLocaleString('en-US')} วัน</p>
        </div>
        <div className="panel px-3 py-2.5">
          <p className="text-xs text-gray-500">อัตราการถูกเช่า (90 วัน)</p>
          <p className="money text-lg text-gray-900">{utilization}%</p>
        </div>
      </div>
      <p className="text-xs text-gray-500">รายได้นับเฉพาะการจองที่ลูกค้ารับชุดไปแล้ว · อัตราการถูกเช่า = วันที่ถูกเช่า ÷ (90 วัน × ชิ้นที่ใช้งาน {activeUnits} ชิ้น)</p>

      {missing ? (
        <div role="alert" className="alert-warn">
          <XCircle {...ICON_SM} />
          <p className="min-w-0">{FIX05_MISSING_MSG}</p>
        </div>
      ) : (
        <>
          {rows.length === 0 && loading && (
            <div className="space-y-2" role="status">
              <span className="sr-only">กำลังโหลดประวัติ...</span>
              {[0, 1, 2].map(i => <div key={i} className="skeleton h-14 rounded-lg" />)}
            </div>
          )}
          {rows.length === 0 && !loading && !error && (
            <p className="empty-state py-6">ชุดนี้ยังไม่เคยถูกจอง</p>
          )}
          {rows.length > 0 && (
            <ul className="divide-y divide-gray-150 rounded-lg border border-gray-200">
              {rows.map(r => {
                const days = rentalDays(r.pickup_date, r.return_date)
                const rent = r.lines.reduce((s, l) => s + l.rent_price, 0)
                return (
                  <li key={r.id}>
                    <Link
                      href={`/rental/bookings/${r.id}`}
                      prefetch={false}
                      className="flex min-h-[56px] items-start justify-between gap-3 px-3 py-2.5 transition-colors [@media(hover:hover)]:hover:bg-gray-50"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <span className="font-mono font-semibold text-gray-900">{r.booking_no}</span>
                          <span className={STATUS_CHIP[r.status]}>{STATUS_LABELS[r.status]}</span>
                        </p>
                        <p className="text-sm text-gray-700 break-words">{r.customer_name || '-'}</p>
                        <p className="text-xs text-gray-500 tabular-nums">
                          รับ {formatThaiDate(r.pickup_date)} · คืน {formatThaiDate(r.return_date)} ({days} วัน)
                          {r.returned_on && r.returned_on !== r.return_date ? ` · คืนจริง ${formatThaiDate(r.returned_on)}` : ''}
                        </p>
                        <ul className="flex flex-wrap gap-1.5 pt-0.5">
                          {r.lines.map(l => (
                            <li key={l.id} className="chip max-w-full">
                              <span className="min-w-0 truncate font-mono">{unitCodes.get(l.unit_id) ?? 'ชิ้นที่ถูกลบ'}</span>
                              <span>{sizeLabel(l.size)}</span>
                              {l.status !== 'booked' && l.status !== 'picked_up' && <span>· {LINE_STATUS_LABELS[l.status]}</span>}
                              {l.return_condition && l.return_condition !== 'ok' && !(l.status === 'lost' && l.return_condition === 'lost') && (
                                <span>· {CONDITION_LABELS[l.return_condition]}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="money text-sm text-gray-900">{baht(round2(rent))}</span>
                        <ChevronRight size={16} strokeWidth={2} className="text-gray-400" aria-hidden="true" />
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
          {error && (
            <div role="alert" className="alert-err">
              <XCircle {...ICON_SM} />
              <div className="min-w-0 space-y-2">
                <p className="break-words">{error}</p>
                <button type="button" className="btn-secondary px-4 text-sm" onClick={() => { void loadPage(rows.length) }}>
                  <RefreshCw {...ICON_SM} />
                  ลองใหม่
                </button>
              </div>
            </div>
          )}
          {hasMore && !error && (
            <div className="flex justify-center">
              <button type="button" className="btn-secondary w-full sm:w-auto" disabled={loading} onClick={() => { void loadPage(rows.length) }}>
                {loading ? <Loader2 {...ICON_SM} className="animate-spin" /> : <ChevronDown {...ICON_SM} />}
                โหลดเพิ่ม
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
