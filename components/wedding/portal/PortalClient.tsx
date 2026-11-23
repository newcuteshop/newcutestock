'use client'
// ===== หน้าติดตามงานของคู่บ่าวสาว /wedding-status/<token> (ฝั่งเบราว์เซอร์) — ดูอย่างเดียว ไม่ต้องเข้าสู่ระบบ =====
// - ลิงก์นี้คือ "กุญแจ" ของลูกค้า: ใครมีลิงก์ดูได้ ข้อมูลส่วนตัวจึงถูกปิดบางส่วนมาจากฐานข้อมูล (ชื่อ/เบอร์)
//   ไม่มีทีมงาน ค่าจ้าง หมายเหตุภายใน หรือที่อยู่ลูกค้า (ฐานข้อมูลไม่ส่งมาเลย)
// - โหลดใหม่: ปุ่ม "อัปเดตสถานะ" และเมื่อกลับมาที่แท็บ/แอป (ห่างจากครั้งก่อน ≥ 15 วินาที) — ร้านอาจรับเงิน/ส่งงานแล้ว
// - สถานะที่ได้ระหว่างเปิดหน้า: ร้านปิดลิงก์ / งานยกเลิก / ลิงก์ถูกเปลี่ยน → การ์ดแจ้งเตือนแทนเนื้อหา
// - กติกาเบราว์เซอร์ในแอป LINE: ลิงก์แผนที่/ผลงานเปิดในหน้าเดิม (ไม่มี target=_blank) ไม่ใช้ window.confirm
import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  AlertTriangle, CalendarDays, Check, CheckCircle2, ChevronDown, Clapperboard, Clock, ExternalLink, Hourglass, Info,
  Link2, Loader2, MapPin, Navigation, Package, Receipt, RefreshCw, ScrollText,
} from 'lucide-react'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht, formatThaiDate, formatThaiDateTime, formatThaiDayLong } from '@/lib/format'
import {
  DELIVERABLE_STATUS_CHIP, INSTALLMENT_STATUS_CHIP, INSTALLMENT_STATUS_LABELS, WED_STATUS_CHIP, sessionTimeText,
  termsLines, weddingStatusPath,
  type WedBookingStatus, type WedPublicBooking, type WedPublicSession,
} from '@/lib/wedding'
import CopyButton from '@/components/book/CopyButton'
import { finalDueDate } from '@/components/wedding/docs/docKinds'
import ContactButtons from '@/components/book/ContactButtons'
import { fetchWeddingPortal } from './api'
import PortalShell from './PortalShell'
import PortalNotice from './PortalNotice'
import PortalPayPanel from './PortalPayPanel'

const REFRESH_GAP_MS = 15000

const STEPS: { key: string; label: string; statuses: WedBookingStatus[] }[] = [
  { key: 'booked', label: 'จองคิว', statuses: ['inquiry', 'hold'] },
  { key: 'confirmed', label: 'ยืนยันคิวแล้ว', statuses: ['confirmed'] },
  { key: 'shot', label: 'ถ่ายทำเสร็จ', statuses: ['in_production'] },
  { key: 'delivered', label: 'ส่งผลงานแล้ว', statuses: ['delivered'] },
  { key: 'completed', label: 'ปิดงาน', statuses: ['completed'] },
]

function stepIndex(s: WedBookingStatus | null): number {
  if (!s) return -1
  return STEPS.findIndex(x => x.statuses.includes(s))
}

export default function PortalClient({ token, initial }: { token: string; initial: WedPublicBooking }) {
  const [booking, setBooking] = useState<WedPublicBooking>(initial)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [pageUrl, setPageUrl] = useState('')
  const lastRefresh = useRef(Date.now())
  const busyRef = useRef(false)

  const refresh = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setRefreshing(true)
    setRefreshError(null)
    try {
      const r = await fetchWeddingPortal(token)
      lastRefresh.current = Date.now()
      if (!r.ok) {
        setRefreshError(r.message)
        return
      }
      setBooking(r.data)
    } finally {
      busyRef.current = false
      setRefreshing(false)
    }
  }, [token])

  useEffect(() => {
    setPageUrl(window.location.origin + weddingStatusPath(token))
  }, [token])

  // กลับมาที่แท็บ/แอป → โหลดสถานะใหม่
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current > REFRESH_GAP_MS) void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  const b = booking
  if (b.state !== 'ok') {
    return (
      <PortalShell shop={b.state === 'not_found' ? null : b.shop}>
        {b.state === 'disabled' ? (
          <PortalNotice kind="disabled" shop={b.shop} />
        ) : b.state === 'cancelled' ? (
          <PortalNotice kind="cancelled" shop={b.shop}>
            {(b.couple_names || b.booking_no) && (
              <p className="text-sm text-gray-700">
                {b.couple_names}
                {b.booking_no ? <span className="text-gray-500"> · เลขที่งาน {b.booking_no}</span> : null}
              </p>
            )}
          </PortalNotice>
        ) : (
          <PortalNotice kind="notFound" />
        )}
      </PortalShell>
    )
  }

  const m = b.money
  const balanceDue = finalDueDate(b)
  const idx = stepIndex(b.status)
  const terms = termsLines(b.terms_text)
  const contact = { phone: b.shop.phone, line_id: b.shop.line_id, line_url: b.shop.line_url }

  return (
    <PortalShell shop={b.shop}>
      <div className="space-y-5 sm:space-y-6">
        {/* ===== หัว: ชื่อคู่บ่าวสาว + สถานะ ===== */}
        <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="wp-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-gray-500">งานแต่งของ</p>
              <h1 id="wp-title" className="page-title break-words">{b.couple_names || '-'}</h1>
              <p className="text-sm text-gray-600">เลขที่งาน <span className="font-medium text-gray-900">{b.booking_no}</span></p>
            </div>
            {b.status && <span className={clsx(WED_STATUS_CHIP[b.status], 'h-7 px-3 text-sm')}>{b.status_label}</span>}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div className="min-w-0">
              <dt className="text-gray-500">ผู้ติดต่อ</dt>
              <dd className="break-words font-medium text-gray-900">{b.customer_name_masked || '-'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-gray-500">เบอร์โทร</dt>
              <dd className="font-medium tabular-nums text-gray-900">{b.phone_masked || '-'}</dd>
            </div>
          </dl>

          {idx >= 0 && b.status !== 'postponed' && (
            <ol className="grid grid-cols-5 gap-1" aria-label="ขั้นตอนงาน">
              {STEPS.map((s, i) => {
                const done = i < idx || b.status === 'completed'
                const current = i === idx && b.status !== 'completed'
                return (
                  <li key={s.key} className="flex min-w-0 flex-col items-center gap-1 text-center" aria-current={current ? 'step' : undefined}>
                    <span
                      className={clsx(
                        'grid h-8 w-8 place-items-center rounded-full border text-xs font-semibold',
                        done ? 'border-green-600 bg-green-600 text-white' : current ? 'border-brand-600 bg-brand-100 text-brand-700' : 'border-gray-300 bg-white text-gray-400',
                      )}
                      aria-hidden="true"
                    >
                      {done ? <Check size={14} strokeWidth={2.5} /> : i + 1}
                    </span>
                    <span className={clsx('text-[11px] leading-tight sm:text-xs', current ? 'font-semibold text-gray-900' : done ? 'text-gray-700' : 'text-gray-500')}>
                      {s.label}
                      <span className="sr-only">{done ? ' (เสร็จแล้ว)' : current ? ' (ขั้นปัจจุบัน)' : ''}</span>
                    </span>
                  </li>
                )
              })}
            </ol>
          )}

          <StatusMessage booking={b} />

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary" onClick={() => void refresh()} disabled={refreshing}>
              {refreshing ? <Loader2 {...ICON_SM} className="animate-spin" /> : <RefreshCw {...ICON_SM} />}
              อัปเดตสถานะ
            </button>
            {pageUrl && <CopyButton text={pageUrl} label="คัดลอกลิงก์หน้านี้" ariaLabel="คัดลอกลิงก์หน้าติดตามงาน" />}
          </div>
          <div aria-live="polite">
            {refreshError && (
              <p className="flex items-start gap-1.5 text-sm text-amber-800">
                <AlertTriangle {...ICON_XS} className="mt-0.5" />
                <span>อัปเดตไม่สำเร็จ: {refreshError}</span>
              </p>
            )}
          </div>
        </section>

        {/* ===== ชำระเงิน ===== */}
        <PortalPayPanel booking={b} />

        {/* ===== คิวงาน ===== */}
        <section className="card" aria-labelledby="wp-sessions-title">
          <div className="card-header">
            <h2 id="wp-sessions-title" className="section-title">
              <CalendarDays {...ICON_SM} />
              ตารางคิวงาน{b.sessions.length > 1 ? ` (${b.sessions.length} คิว)` : ''}
            </h2>
          </div>
          {b.sessions.length === 0 ? (
            <p className="p-4 text-sm text-gray-600 sm:p-5">ยังไม่ได้กำหนดวันและเวลา — ร้านจะแจ้งเมื่อยืนยันคิว</p>
          ) : (
            <ul className="divide-y divide-gray-150">
              {b.sessions.map((s, i) => <SessionItem key={`${s.date ?? 'x'}-${i}`} session={s} />)}
            </ul>
          )}
        </section>

        {/* ===== แพ็กเกจ + ผลงาน ===== */}
        <section className="card" aria-labelledby="wp-pkg-title">
          <div className="card-header">
            <h2 id="wp-pkg-title" className="section-title">
              <Package {...ICON_SM} />
              แพ็กเกจและผลงาน
            </h2>
          </div>
          <div className="space-y-4 p-4 sm:p-5">
            <div>
              <p className="break-words text-base font-semibold text-gray-900">{b.package_name || 'แพ็กเกจกำหนดเอง'}</p>
              {b.package_hours !== null && b.package_hours > 0 && (
                <p className="text-sm text-gray-600">ถ่ายทำ {b.package_hours} ชั่วโมง</p>
              )}
              {b.addons.length > 0 && (
                <p className="mt-1 break-words text-sm text-gray-700">
                  บริการเสริม: {b.addons.map(a => `${a.name}${Math.abs(a.qty - 1) > 0.001 ? ` × ${a.qty}${a.unit ? ` ${a.unit}` : ''}` : ''}`).join(', ')}
                </p>
              )}
            </div>
            <Deliverables booking={b} />
          </div>
        </section>

        {/* ===== ยอดเงิน + งวด ===== */}
        {m.grand_total > 0 && (
          <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="wp-money-title">
            <h2 id="wp-money-title" className="section-title">
              <Receipt {...ICON_SM} />
              ยอดเงิน
            </h2>
            <dl className="space-y-2 text-sm">
              <Row label="ยอดสุทธิ" value={baht(m.grand_total)} strong />
              <Row label="ชำระแล้ว" value={baht(m.paid)} />
              {m.due > 0.005 && <Row label="ยอดคงเหลือ" value={baht(m.due)} strong />}
              {m.due < -0.005 && <Row label="ร้านต้องคืนเงินส่วนเกิน" value={baht(-m.due)} />}
            </dl>
            {m.deposit_required > 0 && (
              <p className={clsx('flex items-start gap-2 text-sm', m.deposit_met ? 'text-green-800' : 'text-gray-700')}>
                {m.deposit_met ? <CheckCircle2 {...ICON_XS} className="mt-0.5" /> : <Hourglass {...ICON_XS} className="mt-0.5" />}
                <span>
                  มัดจำยืนยันคิว {baht(m.deposit_required)}
                  {m.deposit_met ? ' — ชำระครบแล้ว' : ` — ยังขาด ${baht(m.deposit_due)}`}
                </span>
              </p>
            )}
            {m.due > 0.005 && balanceDue && (
              <p className="flex items-start gap-2 text-sm text-gray-700">
                <Clock {...ICON_XS} className="mt-0.5" />
                <span>ชำระยอดคงเหลือภายใน {formatThaiDate(balanceDue)}</span>
              </p>
            )}
            {/* งวดชำระเป็นรายการ (ไม่ใช่ตาราง): จอ 375px ตาราง 4 ช่องล้นจนป้ายสถานะถูกตัด */}
            {b.installments.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-gray-900">งวดชำระ</p>
                <ul className="divide-y divide-gray-150 rounded-lg border border-gray-200">
                  {b.installments.map((it, i) => (
                    <li key={`${it.label}-${i}`} className="flex items-start justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium text-gray-900">{it.label || `งวดที่ ${i + 1}`}</p>
                        <p className="text-xs text-gray-600">{it.due_date ? `กำหนดชำระ ${formatThaiDate(it.due_date)}` : 'ยังไม่กำหนดวัน'}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="money whitespace-nowrap text-sm text-gray-900">{baht(it.amount)}</span>
                        <span className={it.overdue ? 'badge-out' : INSTALLMENT_STATUS_CHIP[it.status]}>
                          {it.overdue ? 'เลยกำหนด' : INSTALLMENT_STATUS_LABELS[it.status]}
                        </span>
                        {it.status === 'partial' && <span className="whitespace-nowrap text-xs text-gray-500">ค้าง {baht(it.amount_remaining)}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {b.booking_note && (
          <div className="alert-info">
            <Info {...ICON_SM} />
            <p className="min-w-0 whitespace-pre-line break-words">{b.booking_note}</p>
          </div>
        )}

        {/* ===== เงื่อนไข (ย่อไว้) ===== */}
        {terms.length > 0 && (
          <details className="card group">
            <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
              <span className="section-title">
                <ScrollText {...ICON_SM} />
                เงื่อนไขการให้บริการ
              </span>
              <ChevronDown {...ICON_SM} className="shrink-0 text-gray-500 transition-transform group-open:rotate-180" />
            </summary>
            <ol className="list-decimal space-y-1.5 border-t border-gray-200 py-4 pl-9 pr-4 text-sm text-gray-700 sm:pr-5">
              {terms.map((t, i) => <li key={i} className="break-words">{t}</li>)}
            </ol>
          </details>
        )}

        {/* ===== ติดต่อร้าน ===== */}
        <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="wp-contact-title">
          <h2 id="wp-contact-title" className="section-title">ติดต่อร้าน</h2>
          <p className="text-sm text-gray-600">ต้องการเปลี่ยนแปลงกำหนดการหรือสอบถามเพิ่มเติม แจ้งเลขที่งาน {b.booking_no}</p>
          <ContactButtons contact={contact} />
          <p className="flex items-center gap-1.5 pt-1 text-xs text-gray-500">
            <Link2 {...ICON_XS} />
            ลิงก์นี้ใช้ดูงานของคุณ — แชร์ให้เฉพาะคนที่ไว้ใจ
          </p>
        </section>
      </div>
    </PortalShell>
  )
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? 'font-semibold text-gray-900' : 'text-gray-600'}>{label}</dt>
      <dd className={clsx('money', strong ? 'text-base text-gray-900' : 'text-gray-900')}>{value}</dd>
    </div>
  )
}

function SessionItem({ session: s }: { session: WedPublicSession }) {
  const head = [s.type_label, s.title].filter(Boolean).join(' · ')
  const longSheet = s.run_sheet.length > 8
  return (
    <li className="space-y-2 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="break-words text-base font-semibold text-gray-900">{head || 'คิวงาน'}</p>
        <p className="text-sm font-medium text-brand-800">{s.date ? formatThaiDayLong(s.date) : 'ยังไม่กำหนดวัน'}</p>
      </div>
      <p className="flex items-center gap-1.5 text-sm text-gray-700">
        <Clock {...ICON_XS} className="shrink-0 text-gray-500" />
        {sessionTimeText(s)}
      </p>
      {(s.venue_name || s.venue_address) && (
        <div className="flex items-start gap-1.5 text-sm text-gray-700">
          <MapPin {...ICON_XS} className="mt-0.5 shrink-0 text-gray-500" />
          <div className="min-w-0">
            {s.venue_name && <p className="break-words font-medium text-gray-900">{s.venue_name}</p>}
            {s.venue_address && <p className="whitespace-pre-line break-words">{s.venue_address}</p>}
          </div>
        </div>
      )}
      {s.map_url && (
        <a href={s.map_url} rel="noreferrer" referrerPolicy="no-referrer" className="btn-secondary px-4 text-sm">
          <Navigation {...ICON_SM} />
          เปิดแผนที่
        </a>
      )}
      {s.run_sheet.length > 0 && (
        <details className="panel group" open={!longSheet}>
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-gray-900 [&::-webkit-details-marker]:hidden">
            <span>กำหนดการ / ฤกษ์ ({s.run_sheet.length} รายการ)</span>
            <ChevronDown {...ICON_XS} className="shrink-0 text-gray-500 transition-transform group-open:rotate-180" />
          </summary>
          <ol className="divide-y divide-gray-150 border-t border-gray-200">
            {s.run_sheet.map((r, i) => (
              <li key={i} className="flex gap-3 px-3 py-2 text-sm">
                <span className="w-14 shrink-0 font-semibold tabular-nums text-gray-900">{r.time ?? '-'}</span>
                <span className="min-w-0 whitespace-pre-line break-words text-gray-700">{r.text || '-'}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  )
}

function Deliverables({ booking: b }: { booking: WedPublicBooking }) {
  if (b.deliverables.length > 0) {
    const done = b.deliverables.filter(d => d.status === 'delivered').length
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Clapperboard {...ICON_XS} />
          ผลงาน (ส่งแล้ว {done}/{b.deliverables.length})
        </p>
        <ul className="space-y-2">
          {b.deliverables.map((d, i) => (
            <li key={`${d.name}-${i}`} className="panel space-y-2 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 break-words text-sm font-semibold text-gray-900">
                  {d.name}
                  {d.qty > 1 || d.unit ? <span className="font-normal text-gray-600"> · {d.qty}{d.unit ? ` ${d.unit}` : ''}</span> : null}
                </p>
                <span className={DELIVERABLE_STATUS_CHIP[d.status]}>{d.status_label}</span>
              </div>
              <p className="text-xs text-gray-600">
                {d.status === 'delivered'
                  ? `ส่งแล้วเมื่อ ${d.delivered_at ? formatThaiDateTime(d.delivered_at) : '-'}`
                  : d.due_date ? `กำหนดส่งภายใน ${formatThaiDate(d.due_date)}` : 'รอกำหนดวันส่ง'}
              </p>
              {d.link_url && (
                <a href={d.link_url} rel="noreferrer" referrerPolicy="no-referrer" className="btn-primary w-full px-4 text-sm sm:w-auto">
                  <ExternalLink {...ICON_SM} />
                  เปิดผลงาน
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
    )
  }
  if (b.deliverables_plan.length > 0) {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Clapperboard {...ICON_XS} />
          ผลงานที่จะได้รับ
        </p>
        <ul className="space-y-1.5 text-sm text-gray-700">
          {b.deliverables_plan.map((d, i) => (
            <li key={`${d.name}-${i}`} className="flex flex-wrap justify-between gap-x-3">
              <span className="min-w-0 break-words font-medium text-gray-900">
                {d.name}
                {d.qty > 1 || d.unit ? ` · ${d.qty}${d.unit ? ` ${d.unit}` : ''}` : ''}
              </span>
              <span className="text-gray-600">{d.due_days > 0 ? `ภายใน ${d.due_days} วันหลังวันงาน` : 'หลังวันงาน'}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  return null
}

// ข้อความอธิบายสถานะ + สิ่งที่คู่บ่าวสาวต้องทำต่อ
function StatusMessage({ booking: b }: { booking: WedPublicBooking }) {
  const m = b.money
  const balanceDue = finalDueDate(b)
  switch (b.status) {
    case 'inquiry':
      return (
        <div className="alert-info">
          <Info {...ICON_SM} />
          <p className="min-w-0">ร้านได้รับข้อมูลงานแล้ว — ยังไม่ได้ล็อกคิว ติดต่อร้านเพื่อยืนยันวันและชำระมัดจำ</p>
        </div>
      )
    case 'hold':
      return (
        <div className="alert-warn">
          <Hourglass {...ICON_SM} />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">ล็อกคิวไว้ให้แล้ว รอชำระมัดจำ</p>
            {m.deposit_due > 0 && <p>ชำระมัดจำ {baht(m.deposit_due)} เพื่อยืนยันคิวงาน</p>}
            {b.hold_until && <p>ร้านล็อกคิวไว้ถึง {formatThaiDateTime(b.hold_until)} น.</p>}
          </div>
        </div>
      )
    case 'confirmed':
      return (
        <div className="alert-ok">
          <CheckCircle2 {...ICON_SM} />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">ยืนยันคิวงานเรียบร้อย</p>
            {m.due > 0.005 && (
              <p>
                ยอดคงเหลือ {baht(m.due)}
                {balanceDue ? ` ชำระภายใน ${formatThaiDate(balanceDue)}` : ''}
              </p>
            )}
          </div>
        </div>
      )
    case 'in_production':
      return (
        <div className="alert-info">
          <Clapperboard {...ICON_SM} />
          <p className="min-w-0">ถ่ายทำเสร็จแล้ว ทีมงานกำลังคัดและตัดต่อผลงาน — ลิงก์ผลงานจะขึ้นด้านล่างเมื่อส่งแต่ละรายการ</p>
        </div>
      )
    case 'delivered':
      return (
        <div className="alert-ok">
          <CheckCircle2 {...ICON_SM} />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">ส่งผลงานครบแล้ว</p>
            {m.due > 0.005 ? <p>ยอดคงเหลือ {baht(m.due)}</p> : <p>เปิดดูและดาวน์โหลดผลงานได้จากลิงก์ด้านล่าง</p>}
          </div>
        </div>
      )
    case 'completed':
      return (
        <div className="alert-ok">
          <CheckCircle2 {...ICON_SM} />
          <p className="min-w-0">ปิดงานเรียบร้อย ขอบคุณที่ไว้วางใจให้เราดูแลวันสำคัญ</p>
        </div>
      )
    case 'postponed':
      return (
        <div className="alert-warn">
          <AlertTriangle {...ICON_SM} />
          <p className="min-w-0">งานเลื่อนออกไป — รอกำหนดวันใหม่กับร้าน (ยอดที่ชำระแล้วยังอยู่ครบ)</p>
        </div>
      )
    default:
      return null
  }
}
