'use client'
// รายชื่อลูกค้าร้านเช่าชุด — ค้นหาจากชื่อ / LINE ID / เบอร์โทร, กรองเฉพาะบัญชีดำ, โหลดเพิ่มทีละหน้า
// อ่านตาราง rental_customers ตรงๆ (RLS: พนักงานร้านเช่า) + สรุปการจองของลูกค้าในหน้านั้น (จำนวนครั้ง / จองล่าสุด / ยอดค้าง)
// เลขบัตรในรายการแสดงแบบปิดเหลือ 4 ตัวท้ายเสมอ (เลขเต็มดูได้เฉพาะหน้ารายละเอียดลูกค้า)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { Ban, ChevronRight, Contact, Loader2, RefreshCw, Search, SearchX, UserPlus, X, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { baht, formatThaiDate } from '@/lib/format'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { num, round2 } from '@/lib/money'
import { isMigrationMissing } from '@/lib/migration'
import {
  FIX05_MISSING_MSG, SOURCE_LABELS, STATUS_CHIP, formatPhone, isOpenStatus, maskIdCard, parseCustomer, statusLabel,
  RENTAL_BOOKING_STATUSES, type RentalBookingStatus, type RentalCustomer,
} from '@/lib/rental'
import MigrationNotice from '@/components/pos/MigrationNotice'
import { LOAD_TIMEOUT_MS, LOAD_TIMEOUT_MSG, customerHref, rentalErrorText } from '@/components/rental/calendar/rpc'
import { cleanCustomerSearch } from './customerModel'

type Filter = 'all' | 'blacklist'

const PAGE_SIZE = 50
// เฉพาะคอลัมน์ที่รายการใช้ (ที่อยู่/หมายเหตุ/อีเมลไม่ดึงมาทั้งหน้า — ดูได้ในหน้ารายละเอียด ; ค้นหาจากอีเมลยังได้โดยไม่ต้อง select)
// id_card_no ต้องดึงมาเพื่อแสดงแบบปิดเหลือ 4 ตัวท้าย
const COLUMNS = 'id, name, phone, phone2, line_id, id_card_no, is_blacklisted, blacklist_reason, source, created_at, updated_at'

interface Summary {
  count: number
  open: number
  due: number
  last: { id: string; booking_no: string; status: RentalBookingStatus; pickup_date: string } | null
}

function toStatus(v: unknown): RentalBookingStatus {
  return typeof v === 'string' && (RENTAL_BOOKING_STATUSES as readonly string[]).includes(v) ? (v as RentalBookingStatus) : 'pending'
}

export default function CustomersClient() {
  const supabase = useMemo(() => createClient(), [])
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [rows, setRows] = useState<RentalCustomer[]>([])
  const [summaries, setSummaries] = useState<Map<string, Summary>>(new Map())
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [moreError, setMoreError] = useState('')
  const [missing, setMissing] = useState(false)
  const reqRef = useRef(0)
  const offsetRef = useRef(0)

  // พิมพ์ค้นหา → รอหยุดพิมพ์ 350ms แล้วค่อยค้น (ไม่ยิงฐานข้อมูลทุกตัวอักษร)
  useEffect(() => {
    const t = setTimeout(() => setSearch(input), 350)
    return () => clearTimeout(t)
  }, [input])

  const fetchPage = useCallback(async (offset: number, term: string, flt: Filter) => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = setTimeout(() => ctrl?.abort(), LOAD_TIMEOUT_MS)
    try {
      const { text, digits } = cleanCustomerSearch(term)
      let q = supabase.from('rental_customers').select(COLUMNS)
      if (digits) q = q.or(`phone.ilike.%${digits}%,phone2.ilike.%${digits}%`)
      else if (text) q = q.or(`name.ilike.%${text}%,line_id.ilike.%${text}%,email.ilike.%${text}%`)
      if (flt === 'blacklist') q = q.eq('is_blacklisted', true)
      // ขอเกิน 1 แถว เพื่อรู้ว่ายังมีหน้าถัดไป
      q = q.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + PAGE_SIZE)
      if (ctrl) q = q.abortSignal(ctrl.signal)
      const res = await q
      if (res.error) {
        if (ctrl?.signal.aborted) throw new Error(LOAD_TIMEOUT_MSG)
        throw res.error
      }
      const list: RentalCustomer[] = []
      for (const raw of (Array.isArray(res.data) ? res.data : []) as unknown[]) {
        const c = parseCustomer(raw)
        if (c) list.push(c)
      }
      return list
    } catch (err) {
      if (ctrl?.signal.aborted) throw new Error(LOAD_TIMEOUT_MSG)
      throw err
    } finally {
      clearTimeout(timer)
    }
  }, [supabase])

  // สรุปการจองของลูกค้าในหน้านั้น — อ่านไม่ได้ก็แค่ไม่แสดงสรุป (รายชื่อยังใช้ได้)
  const loadSummaries = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    try {
      const rows = await fetchAllRows<Record<string, unknown>>((a, b) => supabase
        .from('rental_bookings')
        .select('id, customer_id, booking_no, status, pickup_date, due, created_at')
        .in('customer_id', ids)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(a, b))
      const map = new Map<string, Summary>()
      for (const id of ids) map.set(id, { count: 0, open: 0, due: 0, last: null })
      for (const r of rows) {
        const cid = typeof r.customer_id === 'string' ? r.customer_id : ''
        const s = map.get(cid)
        if (!s) continue
        const status = toStatus(r.status)
        s.count++
        if (isOpenStatus(status)) {
          s.open++
          const d = num(r.due)
          if (d > 0.005) s.due = round2(s.due + d)
        }
        if (!s.last && typeof r.id === 'string') {
          s.last = {
            id: r.id,
            booking_no: typeof r.booking_no === 'string' ? r.booking_no : '',
            status,
            pickup_date: typeof r.pickup_date === 'string' ? r.pickup_date.slice(0, 10) : '',
          }
        }
      }
      setSummaries(prev => {
        const next = new Map(prev)
        map.forEach((v, k) => next.set(k, v))
        return next
      })
    } catch {
      // ไม่แสดงสรุปการจอง
    }
  }, [supabase])

  const load = useCallback(async (reset: boolean) => {
    const id = ++reqRef.current
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
      const list = await fetchPage(offset, search, filter)
      if (id !== reqRef.current) return
      const more = list.length > PAGE_SIZE
      const page = more ? list.slice(0, PAGE_SIZE) : list
      offsetRef.current = offset + page.length
      setHasMore(more)
      setMissing(false)
      setRows(prev => {
        if (reset) return page
        const seen = new Set(prev.map(r => r.id))
        return [...prev, ...page.filter(r => !seen.has(r.id))]
      })
      if (reset) setSummaries(new Map())
      void loadSummaries(page.map(r => r.id))
    } catch (err) {
      if (id !== reqRef.current) return
      if (isMigrationMissing(err)) setMissing(true)
      if (reset) {
        setRows([])
        setError(rentalErrorText(err))
      } else {
        setMoreError(rentalErrorText(err))
      }
    } finally {
      if (id === reqRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [fetchPage, loadSummaries, search, filter])

  useEffect(() => {
    void load(true)
  }, [load])

  if (missing) return <MigrationNotice message={FIX05_MISSING_MSG} />

  const searching = search.trim() !== ''

  return (
    <div className="space-y-4">
      {/* ===== ค้นหา / ตัวกรอง ===== */}
      <section className="card p-4 sm:p-5 space-y-3" aria-label="ค้นหาลูกค้า">
        <form
          role="search"
          className="flex items-center gap-2"
          onSubmit={e => { e.preventDefault(); setSearch(input) }}
        >
          <div className="input-icon flex-1 min-w-0">
            <Search {...ICON_SM} />
            <input
              type="search"
              className="input pl-11"
              placeholder="ค้นหาชื่อ / เบอร์โทร / LINE ID"
              value={input}
              onChange={e => setInput(e.target.value)}
              enterKeyHint="search"
              autoComplete="off"
              maxLength={60}
              aria-label="ค้นหาลูกค้า"
            />
          </div>
          {input && (
            <button type="button" onClick={() => { setInput(''); setSearch('') }} className="btn-icon shrink-0" aria-label="ล้างคำค้นหา">
              <X {...ICON_SM} />
            </button>
          )}
        </form>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label="ตัวกรองลูกค้า">
            <button type="button" className="chip-toggle lift-hover lift-tab" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>ทั้งหมด</button>
            <button type="button" className="chip-toggle lift-hover lift-tab" aria-pressed={filter === 'blacklist'} onClick={() => setFilter('blacklist')}>
              <Ban size={14} strokeWidth={1.9} aria-hidden="true" />
              บัญชีดำ
            </button>
          </div>
          <button type="button" onClick={() => void load(true)} disabled={loading} className="btn-icon btn-icon-plain" aria-label="โหลดรายชื่อใหม่">
            <RefreshCw {...ICON_SM} className={loading ? 'animate-spin' : undefined} />
          </button>
        </div>
      </section>

      {/* ===== รายชื่อ ===== */}
      <section className="card overflow-hidden" aria-busy={loading} aria-labelledby="customers-title">
        <div className="card-header">
          <h2 id="customers-title" className="section-title">
            <Contact {...ICON} />
            {searching ? 'ผลการค้นหา' : filter === 'blacklist' ? 'ลูกค้าที่ติดบัญชีดำ' : 'ลูกค้าทั้งหมด'}
          </h2>
          {!loading && !error && (
            <span className="chip tabular-nums">{rows.length.toLocaleString('th-TH')}{hasMore ? '+' : ''} คน</span>
          )}
        </div>

        {loading ? (
          <div className="p-4 sm:p-5 space-y-3" role="status">
            <span className="sr-only">กำลังโหลดรายชื่อลูกค้า...</span>
            {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-14 rounded-lg" />)}
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
              {searching ? <SearchX size={28} strokeWidth={1.75} aria-hidden="true" /> : <Contact size={28} strokeWidth={1.75} aria-hidden="true" />}
            </span>
            <p className="empty-state-title break-words">
              {searching ? `ไม่พบลูกค้าที่ตรงกับ "${search.trim()}"` : filter === 'blacklist' ? 'ไม่มีลูกค้าที่ติดบัญชีดำ' : 'ยังไม่มีลูกค้าในระบบ'}
            </p>
            {!searching && filter === 'all' && (
              <Link href="/rental/customers/new" className="btn-primary mt-2">
                <UserPlus {...ICON_SM} />
                เพิ่มลูกค้า
              </Link>
            )}
          </div>
        ) : (
          <>
            {/* มือถือ: แถวเรียงลงมา */}
            <ul className="md:hidden divide-y divide-gray-150">
              {rows.map(c => {
                const s = summaries.get(c.id)
                return (
                  <li key={c.id}>
                    <Link
                      href={customerHref(c.id)}
                      prefetch={false}
                      className="flex min-h-[56px] items-start gap-3 px-4 py-3 transition-colors active:bg-gray-100"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-medium text-gray-900 break-words">{c.name}</span>
                          {c.is_blacklisted && <span className="badge-out"><Ban size={12} strokeWidth={1.9} aria-hidden="true" />บัญชีดำ</span>}
                        </p>
                        <p className="text-xs text-gray-600 tabular-nums break-words">
                          {formatPhone(c.phone)}
                          {c.line_id && <span> · LINE {c.line_id}</span>}
                        </p>
                        {s && (
                          <p className="text-xs text-gray-500 tabular-nums">
                            {s.count > 0
                              ? <>จอง {s.count.toLocaleString('th-TH')} ครั้ง{s.last ? ` · ล่าสุดรับชุด ${formatThaiDate(s.last.pickup_date)}` : ''}</>
                              : 'ยังไม่เคยจอง'}
                            {s.due > 0.005 && <span className="font-medium text-amber-800"> · ค้างชำระ {baht(s.due)}</span>}
                          </p>
                        )}
                      </div>
                      <ChevronRight {...ICON_SM} className="mt-1 shrink-0 text-gray-400" />
                    </Link>
                  </li>
                )
              })}
            </ul>

            {/* จอกว้าง: ตาราง */}
            <div className="hidden md:block table-wrap">
              <table className="table-soft min-w-[760px]">
                <thead>
                  <tr>
                    <th>ลูกค้า</th>
                    <th>ติดต่อ</th>
                    <th>เลขบัตร</th>
                    <th className="text-right">การจอง</th>
                    <th>จองล่าสุด</th>
                    <th className="text-right">ค้างชำระ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(c => {
                    const s = summaries.get(c.id)
                    return (
                      <tr key={c.id}>
                        <td className="min-w-[180px]">
                          <Link href={customerHref(c.id)} prefetch={false} className="font-medium text-gray-900 underline-offset-4 [@media(hover:hover)]:hover:underline break-words">
                            {c.name}
                          </Link>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {c.is_blacklisted && <span className="badge-out"><Ban size={12} strokeWidth={1.9} aria-hidden="true" />บัญชีดำ</span>}
                            <span className="chip">{SOURCE_LABELS[c.source]}</span>
                          </div>
                        </td>
                        <td className="text-gray-700">
                          <span className="block tabular-nums whitespace-nowrap">{formatPhone(c.phone)}</span>
                          {c.line_id && <span className="block text-xs text-gray-500 break-all">LINE {c.line_id}</span>}
                        </td>
                        <td className="font-mono text-xs text-gray-600 whitespace-nowrap">{maskIdCard(c.id_card_no) || '-'}</td>
                        <td className="text-right tabular-nums text-gray-700">
                          {s ? (
                            <>
                              {s.count.toLocaleString('th-TH')}
                              {s.open > 0 && <span className="block text-xs text-gray-500">กำลังดำเนินการ {s.open}</span>}
                            </>
                          ) : <span className="text-gray-400">-</span>}
                        </td>
                        <td className="whitespace-nowrap">
                          {s?.last ? (
                            <span className="flex flex-col gap-1">
                              <span className="font-mono text-xs text-gray-700">{s.last.booking_no}</span>
                              <span className="flex items-center gap-1.5 text-xs text-gray-500 tabular-nums">
                                {formatThaiDate(s.last.pickup_date)}
                                <span className={STATUS_CHIP[s.last.status]}>{statusLabel(s.last.status)}</span>
                              </span>
                            </span>
                          ) : <span className="text-gray-400">-</span>}
                        </td>
                        <td className={clsx('text-right whitespace-nowrap', s && s.due > 0.005 ? 'money text-amber-800' : 'text-gray-400')}>
                          {s && s.due > 0.005 ? baht(s.due) : '-'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {(hasMore || moreError) && (
              <div className="border-t border-gray-150 p-4 sm:p-5 space-y-2">
                {moreError && <p role="alert" className="text-sm font-medium text-red-700 break-words">{moreError}</p>}
                <button type="button" onClick={() => void load(false)} disabled={loadingMore} className="btn-secondary w-full sm:w-auto">
                  {loadingMore ? <Loader2 {...ICON_SM} className="animate-spin" /> : <RefreshCw {...ICON_SM} />}
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
