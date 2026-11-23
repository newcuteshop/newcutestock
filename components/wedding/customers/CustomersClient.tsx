'use client'
// รายชื่อลูกค้าร้าน b.oncloud — ค้นหาจากชื่อ / ชื่อคู่ / เบอร์ / LINE / Instagram / อีเมล, กรองตามช่องทางที่รู้จักร้าน, โหลดเพิ่มทีละหน้า
// อ่านตาราง wed_customers ตรงๆ (RLS: พนักงาน b.oncloud) + สรุปงานของลูกค้าในหน้านั้นจาก wed_bookings
// (จำนวนงาน / วันงานล่าสุด / ยอดค้าง) — สรุปอ่านไม่ได้ก็ยังเห็นรายชื่อ
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { ChevronRight, Contact, Loader2, RefreshCw, Search, SearchX, UserPlus, X, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { baht, formatThaiDate } from '@/lib/format'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { num, round2 } from '@/lib/money'
import { isMigrationMissing } from '@/lib/migration'
import {
  FIX07_MISSING_MSG, WED_BOOKING_STATUSES, WED_SOURCES, WED_SOURCE_LABELS, WED_STATUS_CHIP, WED_STATUS_SHORT,
  formatPhone, parseWedCustomer, type WedBookingStatus, type WedCustomer, type WedSource,
} from '@/lib/wedding'
import MigrationNotice from '@/components/pos/MigrationNotice'
import { LOAD_TIMEOUT_MS, LOAD_TIMEOUT_MSG, fmtCount, wedCustomerHref, wedErrorText } from '@/components/wedding/money/wedRpc'
import { cleanCustomerSearch, customerTitle } from './customerModel'

type SourceFilter = 'all' | WedSource

const PAGE_SIZE = 50
// เฉพาะคอลัมน์ที่รายการใช้ (ที่อยู่/หมายเหตุไม่ดึงมาทั้งหน้า — ดูได้ในหน้ารายละเอียด)
const COLUMNS = 'id, name, partner_name, phone, phone2, line_id, instagram, facebook, email, source, created_at, updated_at'

interface Summary {
  count: number
  active: number
  due: number
  /** วันงาน (วันคิวสุดท้าย) ล่าสุดของงานที่ไม่ยกเลิก */
  lastEvent: string | null
  last: { booking_no: string; status: WedBookingStatus; couple_names: string } | null
}

function toStatus(v: unknown): WedBookingStatus {
  return typeof v === 'string' && (WED_BOOKING_STATUSES as readonly string[]).includes(v) ? (v as WedBookingStatus) : 'inquiry'
}

function dayKeyOf(v: unknown): string | null {
  const m = typeof v === 'string' ? /^(\d{4}-\d{2}-\d{2})/.exec(v) : null
  return m ? m[1] : null
}

export default function CustomersClient() {
  const supabase = useMemo(() => createClient(), [])
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [source, setSource] = useState<SourceFilter>('all')
  const [rows, setRows] = useState<WedCustomer[]>([])
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

  const fetchPage = useCallback(async (offset: number, term: string, src: SourceFilter) => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = setTimeout(() => ctrl?.abort(), LOAD_TIMEOUT_MS)
    try {
      const { text, digits } = cleanCustomerSearch(term)
      let q = supabase.from('wed_customers').select(COLUMNS)
      if (digits) q = q.or(`phone.ilike.%${digits}%,phone2.ilike.%${digits}%`)
      else if (text) {
        q = q.or(
          `name.ilike.%${text}%,partner_name.ilike.%${text}%,line_id.ilike.%${text}%,` +
          `instagram.ilike.%${text}%,facebook.ilike.%${text}%,email.ilike.%${text}%`,
        )
      }
      if (src !== 'all') q = q.eq('source', src)
      // ขอเกิน 1 แถว เพื่อรู้ว่ายังมีหน้าถัดไป
      q = q.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + PAGE_SIZE)
      if (ctrl) q = q.abortSignal(ctrl.signal)
      const res = await q
      if (res.error) {
        if (ctrl?.signal.aborted) throw new Error(LOAD_TIMEOUT_MSG)
        throw res.error
      }
      const list: WedCustomer[] = []
      for (const raw of (Array.isArray(res.data) ? res.data : []) as unknown[]) {
        const c = parseWedCustomer(raw)
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

  // สรุปงานของลูกค้าในหน้านั้น — อ่านไม่ได้ก็แค่ไม่แสดงสรุป (รายชื่อยังใช้ได้)
  const loadSummaries = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    try {
      const list = await fetchAllRows<Record<string, unknown>>((a, b) => supabase
        .from('wed_bookings')
        .select('id, customer_id, booking_no, couple_names, status, last_session_date, due, created_at')
        .in('customer_id', ids)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(a, b))
      const map = new Map<string, Summary>()
      for (const id of ids) map.set(id, { count: 0, active: 0, due: 0, lastEvent: null, last: null })
      for (const r of list) {
        const s = map.get(typeof r.customer_id === 'string' ? r.customer_id : '')
        if (!s) continue
        const status = toStatus(r.status)
        s.count++
        if (status !== 'completed' && status !== 'cancelled') s.active++
        // ยอดค้าง: ไม่นับงานยกเลิก/สอบถาม (ยังไม่ได้ตกลงราคา) — กติกาเดียวกับ stats ของ wed_get_customer
        if (status !== 'cancelled' && status !== 'inquiry') {
          const d = num(r.due)
          if (d > 0.005) s.due = round2(s.due + d)
        }
        const ev = status !== 'cancelled' ? dayKeyOf(r.last_session_date) : null
        if (ev && (!s.lastEvent || ev > s.lastEvent)) s.lastEvent = ev
        if (!s.last) {
          s.last = {
            booking_no: typeof r.booking_no === 'string' ? r.booking_no : '',
            status,
            couple_names: typeof r.couple_names === 'string' ? r.couple_names : '',
          }
        }
      }
      setSummaries(prev => {
        const next = new Map(prev)
        map.forEach((v, k) => next.set(k, v))
        return next
      })
    } catch {
      // ไม่แสดงสรุปงาน
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
      const list = await fetchPage(offset, search, source)
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
        setError(wedErrorText(err))
      } else {
        setMoreError(wedErrorText(err))
      }
    } finally {
      if (id === reqRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [fetchPage, loadSummaries, search, source])

  useEffect(() => {
    void load(true)
  }, [load])

  if (missing) return <MigrationNotice message={FIX07_MISSING_MSG} />

  const searching = search.trim() !== ''
  const filtered = source !== 'all'

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
              placeholder="ค้นหาชื่อ / ชื่อคู่ / เบอร์ / LINE / IG"
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
        <div className="flex items-start gap-2">
          {/* มือถือ: เลื่อนแนวนอนในแถวเดียว (9 ตัวเลือกไม่กินพื้นที่ทั้งจอ) · จอกว้าง: ขึ้นบรรทัดใหม่ตามปกติ */}
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto scrollbar-none sm:flex-wrap" role="group" aria-label="กรองตามช่องทางที่รู้จักร้าน">
            <button type="button" className="chip-toggle" aria-pressed={source === 'all'} onClick={() => setSource('all')}>ทุกช่องทาง</button>
            {WED_SOURCES.map(s => (
              <button key={s} type="button" className="chip-toggle" aria-pressed={source === s} onClick={() => setSource(s)}>
                {WED_SOURCE_LABELS[s]}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void load(true)} disabled={loading} className="btn-icon btn-icon-plain shrink-0" aria-label="โหลดรายชื่อใหม่">
            <RefreshCw {...ICON_SM} className={loading ? 'animate-spin' : undefined} />
          </button>
        </div>
      </section>

      {/* ===== รายชื่อ ===== */}
      <section className="card overflow-hidden" aria-busy={loading} aria-labelledby="wed-customers-title">
        <div className="card-header">
          <h2 id="wed-customers-title" className="section-title">
            <Contact {...ICON} />
            {searching ? 'ผลการค้นหา' : filtered ? `ลูกค้าจาก ${WED_SOURCE_LABELS[source as WedSource]}` : 'ลูกค้าทั้งหมด'}
          </h2>
          {!loading && !error && (
            <span className="chip tabular-nums">{fmtCount(rows.length)}{hasMore ? '+' : ''} คน</span>
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
              {searching ? `ไม่พบลูกค้าที่ตรงกับ "${search.trim()}"` : filtered ? 'ยังไม่มีลูกค้าจากช่องทางนี้' : 'ยังไม่มีลูกค้าในระบบ'}
            </p>
            {!searching && !filtered && (
              <Link href="/wedding/customers/new" className="btn-primary mt-2">
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
                      href={wedCustomerHref(c.id)}
                      prefetch={false}
                      className="flex min-h-[56px] items-start gap-3 px-4 py-3 transition-colors active:bg-gray-100"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-medium text-gray-900 break-words">{customerTitle(c)}</span>
                          {c.source && <span className="chip">{WED_SOURCE_LABELS[c.source]}</span>}
                        </p>
                        <p className="text-xs text-gray-600 tabular-nums break-words">
                          {formatPhone(c.phone)}
                          {c.line_id && <span> · LINE {c.line_id}</span>}
                          {c.instagram && <span> · IG {c.instagram}</span>}
                        </p>
                        {s && (
                          <p className="text-xs text-gray-500 tabular-nums">
                            {s.count > 0
                              ? <>งาน {fmtCount(s.count)} งาน{s.lastEvent ? ` · วันงานล่าสุด ${formatThaiDate(s.lastEvent)}` : ''}</>
                              : 'ยังไม่มีงาน'}
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
                    <th className="text-right">งาน</th>
                    <th>วันงานล่าสุด</th>
                    <th>งานล่าสุด</th>
                    <th className="text-right">ค้างชำระ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(c => {
                    const s = summaries.get(c.id)
                    return (
                      <tr key={c.id}>
                        <td className="min-w-[200px]">
                          <Link href={wedCustomerHref(c.id)} prefetch={false} className="font-medium text-gray-900 underline-offset-4 [@media(hover:hover)]:hover:underline break-words">
                            {customerTitle(c)}
                          </Link>
                          {c.source && <div className="mt-1"><span className="chip">{WED_SOURCE_LABELS[c.source]}</span></div>}
                        </td>
                        <td className="text-gray-700">
                          <span className="block tabular-nums whitespace-nowrap">{formatPhone(c.phone)}</span>
                          {c.line_id && <span className="block text-xs text-gray-500 break-all">LINE {c.line_id}</span>}
                          {c.instagram && <span className="block text-xs text-gray-500 break-all">IG {c.instagram}</span>}
                        </td>
                        <td className="text-right tabular-nums text-gray-700">
                          {s ? (
                            <>
                              {fmtCount(s.count)}
                              {s.active > 0 && <span className="block text-xs text-gray-500">กำลังดำเนินการ {fmtCount(s.active)}</span>}
                            </>
                          ) : <span className="text-gray-400">-</span>}
                        </td>
                        <td className="whitespace-nowrap tabular-nums text-gray-700">
                          {s?.lastEvent ? formatThaiDate(s.lastEvent) : <span className="text-gray-400">-</span>}
                        </td>
                        <td className="min-w-[160px]">
                          {s?.last ? (
                            <span className="flex flex-col gap-1">
                              <span className="font-mono text-xs text-gray-700">{s.last.booking_no}</span>
                              <span className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                                <span className={WED_STATUS_CHIP[s.last.status]}>{WED_STATUS_SHORT[s.last.status]}</span>
                                <span className="break-words">{s.last.couple_names}</span>
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
