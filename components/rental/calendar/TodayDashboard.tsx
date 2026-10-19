'use client'
// ภาพรวมวันนี้ของร้านเช่าชุด (rental_today) — งานที่ต้องทำในวัน: รับชุด / คืนชุด / เกินกำหนดคืน / ลองชุด /
// คำขอจองออนไลน์รอยืนยัน / สลิปรอตรวจ / ชุดรอซัก / ชิ้นส่งซ่อมที่มีคิวจอง / คิวรับชุดที่ชิ้นยังอยู่กับลูกค้าที่คืนช้า + เงินเข้า-ออกของวัน และเงินประกันที่ถืออยู่
// - เลือกวันอื่นได้ (ย้อนหลัง/ล่วงหน้า) เพื่อวางแผน — วันที่เลือกเขียนลง URL (?day=) ; วันนี้ = ไม่ใส่
// - ข้อมูลรอบแรกโหลดจากเซิร์ฟเวอร์ (หน้าแสดงครบทันที) — เปลี่ยนวัน/โหลดใหม่ดึงจากหน้าเว็บ ไม่โหลดทั้งหน้า
// - "พร้อมแล้ว" (ซักเสร็จ) = rental_mark_unit_clean — กดซ้ำ/เน็ตหลุดไม่เป็นไร (ตั้งค่าเดิมซ้ำได้ผลเหมือนเดิม) ไม่รู้ผล → โหลดรายการใหม่ก่อน
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Globe, Inbox, Loader2, PackageCheck,
  PackageOpen, Plus, RefreshCw, Ruler, ShieldCheck, Sparkles, Undo2, Wallet, Wrench, XCircle, type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import {
  addDaysToKey, bangkokTodayKey, baht, formatThaiDate, formatThaiDayLong, isDayKey,
} from '@/lib/format'
import { round2 } from '@/lib/money'
import { isMigrationMissing } from '@/lib/migration'
import {
  FIX05_MISSING_MSG, METHOD_LABELS, RENTAL_CASH_METHODS, parseToday, sizeLabel, type RentalToday,
} from '@/lib/rental'
import MigrationNotice from '@/components/pos/MigrationNotice'
import BookingMiniList, { miniDone } from './BookingMiniList'
import { WRITE_TIMEOUT_MS, bookingHref, rentalErrorText, rpcWithTimeout, serverAnswered } from './rpc'
import { useNow } from './useNow'

// กลับมาที่แท็บนานกว่านี้ → โหลดข้อมูลใหม่เงียบๆ (งานของวันเปลี่ยนตลอด: ลูกค้ามารับ/คืน, สลิปเข้า)
const STALE_MS = 60000

type CleanState = { busy: Set<string>; error: string; notice: string }

function Section({
  id, title, icon: Icon, count, tone = 'normal', action, children,
}: {
  id: string
  title: string
  icon: LucideIcon
  count?: number | string
  tone?: 'normal' | 'danger' | 'warn'
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section id={id} className={clsx('card overflow-hidden scroll-mt-4', tone === 'danger' && 'border-red-200')} aria-labelledby={`${id}-title`}>
      <div className={clsx('card-header', tone === 'danger' && 'bg-red-50')}>
        <h2 id={`${id}-title`} className="section-title min-w-0 flex-wrap gap-y-0">
          <Icon {...ICON} className={tone === 'danger' ? '!text-red-700' : tone === 'warn' ? '!text-amber-600' : undefined} />
          <span className="min-w-0 break-words">{title}</span>
          {count !== undefined && <span className="text-sm font-normal text-gray-500 tabular-nums">({count})</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function StatLink({
  href, label, value, unit, note, icon: Icon, bubble = '', hot = false, danger = false,
}: {
  href: string
  label: string
  value: string
  unit?: string
  note?: string
  icon: LucideIcon
  bubble?: string
  hot?: boolean
  danger?: boolean
}) {
  return (
    <a href={href} className={clsx('stat-card card-hover', hot && 'stat-card-hot', danger && 'border-red-200')}>
      <div className="flex items-start justify-between gap-2">
        <span className={clsx('stat-label min-w-0 pt-1', danger && 'text-red-800')}>{label}</span>
        <span className={clsx('icon-bubble', bubble)}><Icon {...ICON} /></span>
      </div>
      <div className="min-w-0">
        <p className={clsx('stat-value', danger && 'text-red-700')}>
          <span className="whitespace-nowrap">{value}</span>
          {unit && <span className="stat-sub"> {unit}</span>}
        </p>
        {note && <p className="stat-sub mt-1">{note}</p>}
      </div>
    </a>
  )
}

function SkeletonRows({ n = 3 }: { n?: number }) {
  return (
    <div className="p-4 sm:p-5 space-y-3" role="status">
      <span className="sr-only">กำลังโหลด...</span>
      {[...Array(n)].map((_, i) => <div key={i} className="skeleton h-12 rounded-lg" />)}
    </div>
  )
}

export default function TodayDashboard({
  initialDay,
  today,
  initial,
  initialError,
}: {
  initialDay: string
  today: string
  initial: RentalToday | null
  initialError: string | null
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const now = useNow(30000)
  const [todayKey, setTodayKey] = useState(today)
  const [day, setDay] = useState(initialDay)
  const [data, setData] = useState<RentalToday | null>(initial)
  const [loading, setLoading] = useState(!initial && !initialError)
  const [error, setError] = useState(initialError ?? '')
  const [missing, setMissing] = useState(false)
  const [clean, setClean] = useState<CleanState>({ busy: new Set(), error: '', notice: '' })
  const cleanBusyRef = useRef(new Set<string>())
  const reqRef = useRef(0)
  const loadedAtRef = useRef(initial ? Date.now() : 0)
  const dayRef = useRef(initialDay)

  const load = useCallback(async (d: string, opts?: { silent?: boolean }) => {
    const id = ++reqRef.current
    if (!opts?.silent) {
      setLoading(true)
      setError('')
    }
    const res = await rpcWithTimeout(supabase, 'rental_today', { p_day: d })
    if (id !== reqRef.current) return
    if (res.error) {
      if (isMigrationMissing(res.error)) setMissing(true)
      // โหลดเงียบ (กลับมาที่แท็บ) ไม่สำเร็จ → คงข้อมูลเดิมไว้ ไม่ขึ้นกล่องแดง
      if (!opts?.silent) setError(rentalErrorText(res.error))
    } else {
      const parsed = parseToday(res.data)
      setData(parsed.day ? parsed : { ...parsed, day: d })
      setMissing(false)
      setError('')
      loadedAtRef.current = Date.now()
    }
    setLoading(false)
  }, [supabase])

  // ไม่มีข้อมูลรอบแรก (เซิร์ฟเวอร์โหลดไม่สำเร็จแบบไม่ใช่ error ที่แสดงแล้ว) → โหลดจากหน้าเว็บ
  useEffect(() => {
    if (!initial && !initialError) void load(initialDay)
  }, [initial, initialError, initialDay, load])

  // เซิร์ฟเวอร์ render หน้านี้ใหม่ (กดเมนู "ภาพรวมวันนี้" ขณะอยู่หน้านี้ / router.refresh()) → ใช้ข้อมูลชุดใหม่ที่ได้มา
  const propsRef = useRef({ initial, initialError })
  useEffect(() => {
    const prev = propsRef.current
    if (prev.initial === initial && prev.initialError === initialError) return
    propsRef.current = { initial, initialError }
    reqRef.current++ // คำขอที่ค้างอยู่ (ของวันเดิม) ไม่ต้องเขียนทับ
    setDay(initialDay)
    dayRef.current = initialDay
    if (initial) {
      setData(initial)
      setError('')
      loadedAtRef.current = Date.now()
    } else if (initialError) {
      setError(initialError)
    }
    setLoading(false)
  }, [initial, initialError, initialDay])

  // กลับมาที่แท็บ: อัปเดต "วันนี้" (ข้ามเที่ยงคืน) + โหลดใหม่เงียบๆ ถ้าข้อมูลเก่าเกิน 1 นาที
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      setTodayKey(bangkokTodayKey())
      if (Date.now() - loadedAtRef.current > STALE_MS) void load(dayRef.current, { silent: true })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  // เขียนวันที่เลือกลง URL (?day=) — โหลดหน้าใหม่แล้วยังอยู่วันเดิม ; วันนี้ = ไม่ใส่
  const syncUrl = useCallback((d: string, t: string) => {
    try {
      const url = new URL(window.location.href)
      if (d === t) url.searchParams.delete('day')
      else url.searchParams.set('day', d)
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    } catch {
      // เบราว์เซอร์ไม่ยอมแก้ URL — ไม่เป็นไร
    }
  }, [])

  function changeDay(next: string) {
    if (!isDayKey(next)) return
    const t = bangkokTodayKey()
    setTodayKey(t)
    setDay(next)
    dayRef.current = next
    setClean(c => ({ ...c, error: '', notice: '' }))
    syncUrl(next, t)
    void load(next)
  }

  function reload() {
    void load(day)
    // ตัวเลขบนเมนู (คำขอออนไลน์/สลิปรอตรวจ) อยู่ใน layout — ให้เซิร์ฟเวอร์ render ใหม่ด้วย
    router.refresh()
  }

  async function markClean(unitId: string, unitCode: string) {
    if (cleanBusyRef.current.has(unitId)) return
    cleanBusyRef.current.add(unitId)
    setClean(c => ({ busy: new Set(cleanBusyRef.current), error: '', notice: c.notice }))
    const res = await rpcWithTimeout(supabase, 'rental_mark_unit_clean', { p_unit_id: unitId }, WRITE_TIMEOUT_MS)
    cleanBusyRef.current.delete(unitId)
    if (res.error) {
      if (res.timedOut || !serverAnswered(res.error)) {
        // ไม่รู้ผล → โหลดรายการใหม่ก่อน (ถ้าบันทึกไปแล้ว ชิ้นนั้นจะหายจากรายการเอง)
        setClean({ busy: new Set(cleanBusyRef.current), error: `ไม่แน่ใจว่าบันทึก "${unitCode}" แล้วหรือยัง (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — กำลังโหลดรายการใหม่เพื่อตรวจสอบ`, notice: '' })
        void load(dayRef.current, { silent: true })
      } else {
        setClean({ busy: new Set(cleanBusyRef.current), error: rentalErrorText(res.error), notice: '' })
      }
      return
    }
    setData(prev => (prev ? { ...prev, units_need_cleaning: prev.units_need_cleaning.filter(u => u.unit_id !== unitId) } : prev))
    setClean({ busy: new Set(cleanBusyRef.current), error: '', notice: `${unitCode} พร้อมให้เช่าแล้ว` })
  }

  const isToday = day === todayKey
  const dayWord = isToday ? 'วันนี้' : `วันที่ ${formatThaiDate(day)}`
  // ข้อมูลที่แสดงเป็นของวันอื่น (กำลังโหลดวันใหม่) → แสดงโครงรอโหลดแทน ไม่ให้อ่านตัวเลขผิดวัน
  const shown = data && data.day === day ? data : null
  const busy = loading && !shown

  if (missing && !shown) {
    return <MigrationNotice title="ภาพรวมวันนี้" subtitle="งานรับ-คืนชุดและการเงินของวัน" message={FIX05_MISSING_MSG} />
  }

  const pickupsDone = shown ? shown.pickups.filter(b => miniDone('pickup', b)).length : 0
  const returnsDone = shown ? shown.returns.filter(b => miniDone('return', b)).length : 0
  const net = shown ? round2(shown.money_today.cash_in - shown.money_today.cash_out) : 0

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">ภาพรวม{isToday ? 'วันนี้' : 'รายวัน'}</h1>
          <p className="page-subtitle">งานรับ-คืนชุด สิ่งที่ต้องจัดการ และการเงินของวัน</p>
        </div>
        <div className="page-actions">
          <Link href="/rental/bookings/new" className="btn-primary">
            <Plus {...ICON_SM} />
            จองชุดใหม่
          </Link>
          <Link href="/rental/calendar" className="btn-secondary">
            <CalendarDays {...ICON_SM} />
            ปฏิทิน
          </Link>
        </div>
      </div>

      {/* ===== เลือกวัน ===== */}
      <section className="card p-4 sm:p-5 space-y-1" aria-label="เลือกวัน">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => changeDay(addDaysToKey(day, -1))} className="btn-icon shrink-0" aria-label="วันก่อนหน้า">
            <ChevronLeft {...ICON_SM} />
          </button>
          <input
            type="date"
            className="input min-w-0 flex-1 tabular-nums"
            value={day}
            onChange={e => { if (e.target.value) changeDay(e.target.value) }}
            aria-label="เลือกวัน"
            aria-describedby="today-day-caption"
          />
          <button type="button" onClick={() => changeDay(addDaysToKey(day, 1))} className="btn-icon shrink-0" aria-label="วันถัดไป">
            <ChevronRight {...ICON_SM} />
          </button>
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            className="btn-icon btn-icon-plain shrink-0"
            aria-label="โหลดข้อมูลใหม่"
          >
            <RefreshCw {...ICON_SM} className={loading ? 'animate-spin' : undefined} />
          </button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p id="today-day-caption" className="min-w-0 text-sm text-gray-600">{formatThaiDayLong(day)}</p>
          {!isToday && (
            <button type="button" onClick={() => changeDay(bangkokTodayKey())} className="btn-ghost shrink-0 px-3 text-sm">
              กลับไปวันนี้
            </button>
          )}
        </div>
      </section>

      {error && (
        <div role="alert" className="alert-err">
          <XCircle {...ICON_SM} />
          <div className="min-w-0 space-y-2">
            <p className="break-words">{error}</p>
            <button type="button" onClick={() => void load(day)} disabled={loading} className="btn-secondary px-4 text-sm">
              <RefreshCw {...ICON_SM} />
              ลองใหม่
            </button>
          </div>
        </div>
      )}

      {busy && (
        <div className="space-y-4" aria-busy="true">
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 xl:gap-6">
            {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-28 rounded-xl" />)}
          </div>
          <div className="card"><SkeletonRows n={4} /></div>
        </div>
      )}

      {shown && (
        <div className={clsx('space-y-4 sm:space-y-6 transition-opacity', loading && 'opacity-60')} aria-busy={loading}>
          {/* ===== เรื่องด่วน ===== */}
          {(shown.overdue.length > 0 || shown.slips_to_review > 0 || shown.pending_online.length > 0) && (
            <div className="space-y-2" aria-live="polite">
              {shown.overdue.length > 0 && (
                <a href="#today-overdue" className="alert-err font-medium">
                  <AlertTriangle {...ICON_SM} />
                  <span className="min-w-0 flex-1">
                    มีชุดเกินกำหนดคืน {shown.overdue.length.toLocaleString('th-TH')} การจอง{isToday ? '' : ` (ณ ${dayWord})`} — ติดต่อลูกค้าให้นำชุดมาคืน
                  </span>
                  <ArrowRight {...ICON_SM} />
                </a>
              )}
              {shown.slips_to_review > 0 && (
                <Link href="/rental/payments?tab=slips" className="alert-info font-medium">
                  <Inbox {...ICON_SM} />
                  <span className="min-w-0 flex-1">มีสลิปโอนเงินรอตรวจ {shown.slips_to_review.toLocaleString('th-TH')} รายการ</span>
                  <ArrowRight {...ICON_SM} />
                </Link>
              )}
              {shown.pending_online.length > 0 && (
                <a href="#today-pending" className="alert-warn font-medium">
                  <Globe {...ICON_SM} />
                  <span className="min-w-0 flex-1">
                    มีคำขอจองออนไลน์รอยืนยัน {shown.pending_online.length.toLocaleString('th-TH')} รายการ — ยืนยันก่อนหมดเวลาถือจอง
                  </span>
                  <ArrowRight {...ICON_SM} />
                </a>
              )}
            </div>
          )}

          {/* ===== ตัวเลขสรุป ===== */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 xl:gap-6">
            <StatLink
              href="#today-pickups"
              label={`ลูกค้ารับชุด${dayWord}`}
              value={shown.pickups.length.toLocaleString('th-TH')}
              unit="การจอง"
              note={shown.pickups.length > 0 ? `รับแล้ว ${pickupsDone.toLocaleString('th-TH')}` : undefined}
              icon={PackageOpen}
              bubble="icon-bubble-strong"
              hot
            />
            <StatLink
              href="#today-returns"
              label={`ลูกค้าคืนชุด${dayWord}`}
              value={shown.returns.length.toLocaleString('th-TH')}
              unit="การจอง"
              note={shown.returns.length > 0 ? `คืนแล้ว ${returnsDone.toLocaleString('th-TH')}` : undefined}
              icon={Undo2}
            />
            <StatLink
              href="#today-overdue"
              label="เกินกำหนดคืน"
              value={shown.overdue.length.toLocaleString('th-TH')}
              unit="การจอง"
              icon={AlertTriangle}
              bubble={shown.overdue.length > 0 ? 'icon-bubble-err' : ''}
              danger={shown.overdue.length > 0}
            />
            <StatLink
              href="#today-pending"
              label="คำขอออนไลน์รอยืนยัน"
              value={shown.pending_online.length.toLocaleString('th-TH')}
              unit="รายการ"
              icon={Globe}
              bubble={shown.pending_online.length > 0 ? 'icon-bubble-warn' : ''}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6 items-start">
            {/* ===== งานรับ-คืน (ซ้าย 2 ส่วน) ===== */}
            <div className="space-y-4 sm:space-y-6 xl:col-span-2 min-w-0">
              {shown.overdue.length > 0 && (
                <Section id="today-overdue" title={isToday ? 'เกินกำหนดคืน' : `เกินกำหนดคืน (ณ ${dayWord})`} icon={AlertTriangle} count={shown.overdue.length} tone="danger">
                  <BookingMiniList items={shown.overdue} kind="overdue" />
                </Section>
              )}

              {/* คิวรับชุดที่ชิ้นยังอยู่กับลูกค้าคนก่อน (คืนช้า) — รับชุดไม่ได้จนกว่าจะได้ชิ้นคืน หรือสลับไปชิ้นอื่น */}
              {shown.overdue_conflicts.length > 0 && (
                <Section
                  id="today-overdue-conflicts"
                  title="คิวรับชุดที่ชิ้นยังไม่ได้คืน"
                  icon={AlertTriangle}
                  count={shown.overdue_conflicts.length}
                  tone="danger"
                >
                  <p className="px-4 pt-3 sm:px-5 text-xs text-gray-600">
                    ชิ้นยังอยู่กับลูกค้าการจองก่อนหน้าที่เลยกำหนดคืน — ตามชุดคืน หรือเปิดการจองที่รอรับแล้วเปลี่ยนเป็นชิ้นอื่นที่ว่าง
                  </p>
                  <ul className="divide-y divide-gray-150">
                    {shown.overdue_conflicts.map(c => (
                      <li key={`${c.unit_id}-${c.booking_id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:px-5">
                        <div className="min-w-0 flex-1 basis-56">
                          <p className="text-sm text-gray-900 break-words">
                            <span className="font-mono">{c.unit_code}</span>
                            <span className="text-gray-600"> · {c.item_name}</span>
                          </p>
                          <p className="text-xs text-gray-600 tabular-nums break-words">
                            รอรับ{' '}
                            <Link href={bookingHref(c.booking_id)} prefetch={false} className="inline-flex min-h-[44px] items-center px-1 font-mono font-semibold text-brand-700 underline underline-offset-2">
                              {c.booking_no}
                            </Link>
                            {' '}· รับชุด {formatThaiDate(c.pickup_date)}
                          </p>
                          <p className="text-xs text-red-700 tabular-nums break-words">
                            ยังอยู่กับ{' '}
                            {c.out_booking_id ? (
                              <Link href={bookingHref(c.out_booking_id)} prefetch={false} className="inline-flex min-h-[44px] items-center px-1 font-mono font-semibold underline underline-offset-2">
                                {c.out_booking_no}
                              </Link>
                            ) : (
                              <span className="font-mono font-semibold">{c.out_booking_no}</span>
                            )}
                            {c.out_return_date ? ` · กำหนดคืน ${formatThaiDate(c.out_return_date)}` : ''}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section
                id="today-pickups"
                title={`ลูกค้ารับชุด${dayWord}`}
                icon={PackageOpen}
                count={shown.pickups.length > 0 ? `รับแล้ว ${pickupsDone}/${shown.pickups.length}` : undefined}
              >
                <BookingMiniList items={shown.pickups} kind="pickup" emptyText={`ไม่มีนัดรับชุด${dayWord}`} />
              </Section>

              <Section
                id="today-returns"
                title={`ลูกค้าคืนชุด${dayWord}`}
                icon={Undo2}
                count={shown.returns.length > 0 ? `คืนแล้ว ${returnsDone}/${shown.returns.length}` : undefined}
              >
                <BookingMiniList items={shown.returns} kind="return" emptyText={`ไม่มีนัดคืนชุด${dayWord}`} />
              </Section>

              {shown.fittings.length > 0 && (
                <Section id="today-fittings" title={`นัดลองชุด${dayWord}`} icon={Ruler} count={shown.fittings.length}>
                  <BookingMiniList items={shown.fittings} kind="fitting" />
                </Section>
              )}

              <Section
                id="today-pending"
                title="คำขอจองออนไลน์รอยืนยัน"
                icon={Globe}
                count={shown.pending_online.length}
                tone={shown.pending_online.length > 0 ? 'warn' : 'normal'}
                action={(
                  <Link href="/rental/bookings?tab=pending" className="link shrink-0 text-sm">
                    ดูทั้งหมด
                    <ArrowRight {...ICON_SM} />
                  </Link>
                )}
              >
                <BookingMiniList items={shown.pending_online} kind="pending" now={now} emptyText="ไม่มีคำขอจองออนไลน์ที่รอยืนยัน" />
              </Section>
            </div>

            {/* ===== ขวา: เงิน / ชุดรอซัก / ชิ้นมีปัญหา ===== */}
            <div className="space-y-4 sm:space-y-6 min-w-0">
              <Section
                id="today-money"
                title={`การเงิน${dayWord}`}
                icon={Wallet}
                action={(
                  // หน้าการเงินดูได้ถึงวันนี้เท่านั้น (วันอนาคตยังไม่มีเงินเข้า-ออก) → วันที่ผ่านมาแล้วส่ง ?day= ไป ; วันนี้/วันอนาคต = หน้าการเงินของวันนี้
                  <Link href={day < todayKey ? `/rental/payments?day=${day}` : '/rental/payments'} className="link shrink-0 text-sm">
                    รายการเงิน
                    <ArrowRight {...ICON_SM} />
                  </Link>
                )}
              >
                <div className="p-4 sm:p-5 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="panel px-3 py-2">
                      <p className="text-xs text-gray-500">เงินเข้า</p>
                      <p className="money text-base text-green-800 whitespace-nowrap">{baht(shown.money_today.cash_in)}</p>
                    </div>
                    <div className="panel px-3 py-2">
                      <p className="text-xs text-gray-500">เงินออก (คืนเงิน)</p>
                      <p className="money text-base text-red-700 whitespace-nowrap">{baht(shown.money_today.cash_out)}</p>
                    </div>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 border-b border-gray-150 pb-2">
                    <span className="text-sm font-medium text-gray-700">สุทธิ</span>
                    <span className="money text-lg text-gray-900 whitespace-nowrap">{baht(net)}</span>
                  </div>
                  {/* ยอดแยกช่องทางจากฐานข้อมูลเป็นยอดสุทธิ (เข้า − ออก) ของช่องทางนั้น → รวมกันได้เท่ากับ "สุทธิ" ด้านบน */}
                  <p className="text-xs font-medium text-gray-500">สุทธิแยกตามช่องทาง</p>
                  <dl className="!mt-1.5 space-y-1.5 text-sm">
                    {RENTAL_CASH_METHODS.map(m => (
                      <div key={m} className="flex items-baseline justify-between gap-3">
                        <dt className="text-gray-600">{METHOD_LABELS[m]}</dt>
                        <dd className="money text-gray-900 whitespace-nowrap">{baht(shown.money_today.by_method[m])}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="field-hint !mt-2">
                    นับเฉพาะเงินที่ยืนยันแล้ว (รวมรับ-คืนเงินประกัน) — ไม่รวมสลิปรอตรวจและการหักเงินประกันเป็นค่าเช่า
                  </p>
                </div>
              </Section>

              <div className="grid grid-cols-2 xl:grid-cols-1 gap-3 sm:gap-4">
                <div className="stat-card">
                  <div className="flex items-start justify-between gap-2">
                    <span className="stat-label min-w-0 pt-1">เงินประกันที่ร้านถืออยู่</span>
                    <span className="icon-bubble"><ShieldCheck {...ICON} /></span>
                  </div>
                  <div className="min-w-0">
                    <p className="stat-value"><span className="whitespace-nowrap">{baht(shown.security_held_total)}</span></p>
                    <p className="stat-sub mt-1">รวมทุกการจอง (ต้องคืนหรือหักเมื่อปิดงาน)</p>
                  </div>
                </div>
                <Link href="/rental/calendar" className="stat-card card-hover">
                  <div className="flex items-start justify-between gap-2">
                    <span className="stat-label min-w-0 pt-1">7 วันถัดไป</span>
                    <span className="icon-bubble"><CalendarDays {...ICON} /></span>
                  </div>
                  <div className="min-w-0 space-y-0.5 text-sm text-gray-700 tabular-nums">
                    <p>รับชุด <b className="money text-gray-900">{shown.upcoming_7d.pickups.toLocaleString('th-TH')}</b> การจอง</p>
                    <p>คืนชุด <b className="money text-gray-900">{shown.upcoming_7d.returns.toLocaleString('th-TH')}</b> การจอง</p>
                  </div>
                </Link>
              </div>

              <Section
                id="today-cleaning"
                title="ชุดรอซัก / เตรียม"
                icon={Sparkles}
                count={shown.units_need_cleaning.length}
              >
                <div aria-live="polite">
                  {clean.error && (
                    <div className="px-4 pt-3 sm:px-5">
                      <p role="alert" className="alert-err"><XCircle {...ICON_SM} /><span className="min-w-0 break-words">{clean.error}</span></p>
                    </div>
                  )}
                  {clean.notice && (
                    <div className="px-4 pt-3 sm:px-5">
                      <p className="alert-ok"><CheckCircle2 {...ICON_SM} /><span className="min-w-0 break-words">{clean.notice}</span></p>
                    </div>
                  )}
                </div>
                {shown.units_need_cleaning.length === 0 ? (
                  <p className="px-4 py-5 sm:px-5 text-sm text-gray-500">ไม่มีชุดที่รอซัก — ทุกชิ้นพร้อมให้เช่า</p>
                ) : (
                  <ul className="divide-y divide-gray-150">
                    {shown.units_need_cleaning.map(u => {
                      const unitBusy = clean.busy.has(u.unit_id)
                      return (
                        <li key={u.unit_id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                          <div className="min-w-0 flex-1">
                            <p className="font-mono text-sm text-gray-900 break-all">{u.unit_code}</p>
                            <p className="text-xs text-gray-600 break-words">{u.item_name} · {sizeLabel(u.size)}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void markClean(u.unit_id, u.unit_code)}
                            disabled={unitBusy}
                            className="btn-secondary shrink-0 px-3 text-sm"
                            aria-label={`ทำเครื่องหมาย ${u.unit_code} ว่าซักเสร็จ พร้อมให้เช่า`}
                          >
                            {unitBusy ? <Loader2 {...ICON_XS} className="animate-spin" /> : <PackageCheck {...ICON_XS} />}
                            พร้อมแล้ว
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Section>

              {shown.maintenance_conflicts.length > 0 && (
                <Section
                  id="today-maintenance"
                  title="ชิ้นส่งซ่อม/เลิกใช้ ที่มีคิวจอง"
                  icon={Wrench}
                  count={shown.maintenance_conflicts.length}
                  tone="warn"
                >
                  <p className="px-4 pt-3 sm:px-5 text-xs text-gray-600">
                    เปิดการจองแล้วเปลี่ยนเป็นชิ้นอื่นที่ว่างก่อนวันรับชุด หรือซ่อมให้เสร็จแล้วเปลี่ยนสถานะชิ้นเป็นพร้อมให้เช่า
                  </p>
                  <ul className="divide-y divide-gray-150">
                    {shown.maintenance_conflicts.map((c, i) => {
                      const body = (
                        <>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-gray-900 break-words">
                              <span className="font-mono">{c.unit_code}</span>
                              <span className="text-gray-600"> · {c.item_name}</span>
                            </p>
                            <p className="text-xs text-gray-600 tabular-nums">
                              <span className="font-mono">{c.booking_no}</span> · รับชุด {formatThaiDate(c.pickup_date)}
                            </p>
                          </div>
                          {c.booking_id && <ChevronRight {...ICON_SM} className="shrink-0 text-gray-400" />}
                        </>
                      )
                      return (
                        <li key={`${c.unit_code}-${c.booking_no}-${i}`}>
                          {c.booking_id ? (
                            <Link
                              href={bookingHref(c.booking_id)}
                              prefetch={false}
                              className="flex min-h-[44px] items-center gap-3 px-4 py-2.5 sm:px-5 transition-colors active:bg-gray-100 [@media(hover:hover)]:hover:bg-gray-50"
                            >
                              {body}
                            </Link>
                          ) : (
                            <div className="flex items-center gap-3 px-4 py-2.5 sm:px-5">{body}</div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </Section>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
