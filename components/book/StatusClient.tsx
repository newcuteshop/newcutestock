'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import {
  AlertTriangle, Ban, CalendarDays, Check, CheckCircle2, ClipboardList, Hourglass, Info, Link2, Loader2, Receipt,
  RefreshCw, ShieldCheck, XCircle,
} from 'lucide-react'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht, formatThaiDate, formatThaiDateTime } from '@/lib/format'
import {
  bookingStatusPath, PAYMENT_STATUS_LABELS, sizeLabel, STATUS_CHIP, type PublicBooking, type RentalBookingStatus,
} from '@/lib/rental'
import ConfirmDialog from '@/components/integrations/ConfirmDialog'
import RentalImage from '@/components/rental/RentalImage'
import { cancelPublicBooking, fetchPublicBooking } from '@/components/book/api'
import { forgetBooking, rememberBooking } from '@/components/book/cart'
import { shortDay, timeLeftText } from '@/components/book/dates'
import ContactButtons from '@/components/book/ContactButtons'
import CopyButton from '@/components/book/CopyButton'
import PaymentPanel from '@/components/book/PaymentPanel'

// หน้าสถานะการจองของลูกค้า /book/status/<token> (ฝั่งเบราว์เซอร์)
// - ลิงก์นี้คือ "กุญแจ" ของลูกค้า: ใครมีลิงก์ดูได้ ข้อมูลส่วนตัวจึงถูกปิดบางส่วนมาจากฐานข้อมูลแล้ว (ชื่อ/เบอร์)
// - โหลดสถานะใหม่: ปุ่ม "อัปเดตสถานะ", กลับมาที่แท็บ (ห่างจากครั้งก่อน ≥ 15 วินาที), หลังส่งสลิป/ยกเลิก, และตอนหมดเวลาถือคิว
// - ยกเลิกคำขอได้เฉพาะตอน "รอยืนยัน" (ป็อปอัปยืนยันของระบบ ไม่ใช้ window.confirm — แอป LINE บล็อก)

type Props = {
  token: string
  initial: PublicBooking
  /** 1 = เพิ่งส่งคำขอ · 2 = ส่งซ้ำแล้วได้คำขอเดิม · 0 = เปิดลิงก์ปกติ */
  justCreated: 0 | 1 | 2
}

const STEPS: { status: RentalBookingStatus; label: string }[] = [
  { status: 'pending', label: 'ส่งคำขอจอง' },
  { status: 'confirmed', label: 'ร้านยืนยันการจอง' },
  { status: 'picked_up', label: 'รับชุดแล้ว' },
  { status: 'returned', label: 'คืนชุดแล้ว' },
  { status: 'completed', label: 'เสร็จสิ้น' },
]
const REFRESH_GAP_MS = 15000

function stepIndex(s: RentalBookingStatus): number {
  return STEPS.findIndex(x => x.status === s)
}

function paymentChip(status: string): string {
  return status === 'confirmed' ? 'badge-in' : status === 'rejected' ? 'badge-out' : 'badge-return'
}

export default function StatusClient({ token, initial, justCreated }: Props) {
  const [booking, setBooking] = useState<PublicBooking>(initial)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [gone, setGone] = useState(false)
  const [now, setNow] = useState<number | null>(null)
  const [statusUrl, setStatusUrl] = useState('')
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  const cancelBusyRef = useRef(false)
  const [cancelMsg, setCancelMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const lastRefresh = useRef(Date.now())
  const expiredRefreshed = useRef(false)

  const refresh = useCallback(async (): Promise<PublicBooking | null> => {
    setRefreshing(true)
    setRefreshError(null)
    const r = await fetchPublicBooking(token)
    lastRefresh.current = Date.now()
    setRefreshing(false)
    if (!r.ok) {
      setRefreshError(r.message)
      return null
    }
    if (!r.data) {
      setGone(true)
      forgetBooking(token)
      return null
    }
    setBooking(r.data)
    return r.data
  }, [token])

  // นาฬิกาสำหรับนับเวลาถือคิว (เริ่มหลัง mount — กันเวลาเซิร์ฟเวอร์กับเครื่องลูกค้าไม่ตรงตอน hydrate)
  useEffect(() => {
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(t)
  }, [])

  // ลิงก์เต็มสำหรับคัดลอก + จำการจองไว้ในเครื่อง + ลบ ?new= ออกจาก URL (แชร์/บุ๊กมาร์กแล้วไม่ขึ้นข้อความ "เพิ่งส่ง" อีก)
  useEffect(() => {
    setStatusUrl(window.location.origin + bookingStatusPath(token))
    rememberBooking(initial.booking_no, token)
    if (justCreated) {
      try {
        window.history.replaceState(null, '', bookingStatusPath(token))
      } catch {
        // ไม่กระทบการใช้งาน
      }
    }
    // ทำครั้งเดียวตอนเปิดหน้า
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // กลับมาที่แท็บ/แอป → โหลดสถานะใหม่ (ร้านอาจยืนยัน/ตรวจสลิปแล้ว)
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current > REFRESH_GAP_MS) void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  // หมดเวลาถือคิวระหว่างเปิดหน้า → โหลดใหม่ครั้งเดียว (ฐานข้อมูลเปลี่ยนเป็นหมดเวลาเอง)
  const expiresMs = booking.expires_at ? new Date(booking.expires_at).getTime() : NaN
  useEffect(() => {
    if (booking.status !== 'pending' || now === null || !Number.isFinite(expiresMs)) return
    if (now >= expiresMs && !expiredRefreshed.current) {
      expiredRefreshed.current = true
      void refresh()
    }
  }, [booking.status, now, expiresMs, refresh])

  async function doCancel() {
    if (cancelBusyRef.current) return
    cancelBusyRef.current = true
    setCancelBusy(true)
    setCancelMsg(null)
    const r = await cancelPublicBooking(token)
    if (r.ok) {
      setCancelOpen(false)
      setCancelMsg({ ok: true, text: 'ยกเลิกคำขอจองแล้ว' })
      await refresh()
    } else if (r.unsure) {
      // ไม่รู้ว่ายกเลิกสำเร็จไหม → ดูสถานะล่าสุดก่อน (ยกเลิกซ้ำไม่มีผลเสีย แต่ไม่ให้ลูกค้าเข้าใจผิด)
      const b = await refresh()
      if (b && b.status === 'cancelled') {
        setCancelOpen(false)
        setCancelMsg({ ok: true, text: 'ยกเลิกคำขอจองแล้ว' })
      } else {
        setCancelMsg({ ok: false, text: 'สัญญาณไม่เสถียร ยังยกเลิกไม่สำเร็จ — ลองอีกครั้ง' })
      }
    } else {
      setCancelMsg({ ok: false, text: r.message })
      await refresh()
    }
    cancelBusyRef.current = false
    setCancelBusy(false)
  }

  if (gone) {
    return (
      <section className="card mx-auto max-w-lg">
        <div className="empty-state">
          <span className="icon-bubble icon-bubble-lg icon-bubble-warn" aria-hidden="true">
            <AlertTriangle size={28} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <h1 className="empty-state-title">ไม่พบการจองนี้แล้ว</h1>
          <p className="max-w-sm">กรุณาติดต่อร้านเพื่อสอบถามสถานะการจอง</p>
          <ContactButtons contact={booking.contact} className="mt-3 w-full justify-center" />
        </div>
      </section>
    )
  }

  const b = booking
  const m = b.money
  const idx = stepIndex(b.status)
  const ended = b.status === 'cancelled' || b.status === 'expired' || b.status === 'no_show'
  const pendingReviewCount = b.payments.filter(p => p.status === 'pending_review').length
  const depositLeft = Math.max(0, m.deposit_required - m.paid)

  return (
    <div className="mx-auto max-w-3xl space-y-5 sm:space-y-6">
      {justCreated === 1 && (
        <div className="alert-ok" role="status">
          <CheckCircle2 {...ICON_SM} />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">ส่งคำขอจองเรียบร้อยแล้ว</p>
            <p>บันทึกลิงก์หน้านี้ไว้ (หรือกดคัดลอกลิงก์ด้านล่าง) เพื่อกลับมาดูสถานะและส่งสลิปการโอน</p>
          </div>
        </div>
      )}
      {justCreated === 2 && (
        <div className="alert-info" role="status">
          <Info {...ICON_SM} />
          <p className="min-w-0">
            คำขอนี้ถูกส่งไว้ก่อนแล้ว (ระบบไม่สร้างซ้ำ) — ถ้าต้องการจองชุดอื่นเพิ่ม{' '}
            <Link href="/book" className="font-semibold underline underline-offset-4">กลับไปเลือกชุด</Link>
          </p>
        </div>
      )}

      {/* ===== หัว: เลขที่ + สถานะ ===== */}
      <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="st-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-gray-500">การจองที่ {b.shop_name}</p>
            <h1 id="st-title" className="page-title break-all">{b.booking_no}</h1>
          </div>
          <span className={clsx(STATUS_CHIP[b.status], 'h-7 px-3 text-sm')}>{b.status_label}</span>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-gray-500">ผู้จอง</dt>
            <dd className="font-medium text-gray-900 break-words">{b.customer_name_masked || '-'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-gray-500">เบอร์โทร</dt>
            <dd className="font-medium tabular-nums text-gray-900">{b.phone_masked || '-'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-gray-500">รับชุด</dt>
            <dd className="font-medium text-gray-900">{shortDay(b.pickup_date)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-gray-500">คืนชุด</dt>
            <dd className="font-medium text-gray-900">
              {shortDay(b.return_date)} <span className="font-normal text-gray-500">({b.days} วัน)</span>
            </dd>
          </div>
          {b.event_date && (
            <div className="min-w-0">
              <dt className="text-gray-500">วันงาน</dt>
              <dd className="font-medium text-gray-900">{formatThaiDate(b.event_date)}</dd>
            </div>
          )}
        </dl>

        {/* ขั้นตอน */}
        {!ended && idx >= 0 && (
          <ol className="grid grid-cols-5 gap-1" aria-label="ขั้นตอนการจอง">
            {STEPS.map((s, i) => {
              const done = i < idx || b.status === 'completed'
              const current = i === idx && b.status !== 'completed'
              return (
                <li key={s.status} className="flex min-w-0 flex-col items-center gap-1 text-center" aria-current={current ? 'step' : undefined}>
                  <span
                    className={clsx(
                      'grid h-8 w-8 place-items-center rounded-full border text-xs font-semibold',
                      done ? 'border-green-600 bg-green-600 text-white' : current ? 'border-brand-600 bg-brand-100 text-brand-700' : 'border-gray-300 bg-white text-gray-400',
                    )}
                    aria-hidden="true"
                  >
                    {done ? <Check size={14} strokeWidth={2.5} /> : i + 1}
                  </span>
                  <span className={clsx('text-[11px] leading-tight sm:text-xs', current ? 'font-semibold text-gray-900' : done ? 'text-gray-700' : 'text-gray-400')}>
                    {s.label}
                    <span className="sr-only">{done ? ' (เสร็จแล้ว)' : current ? ' (ขั้นปัจจุบัน)' : ''}</span>
                  </span>
                </li>
              )
            })}
          </ol>
        )}

        <StatusMessage booking={b} now={now} depositLeft={depositLeft} pendingReviewCount={pendingReviewCount} />

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? <Loader2 {...ICON_SM} className="animate-spin" /> : <RefreshCw {...ICON_SM} />}
            อัปเดตสถานะ
          </button>
          {statusUrl && <CopyButton text={statusUrl} label="คัดลอกลิงก์หน้านี้" ariaLabel="คัดลอกลิงก์หน้าสถานะการจอง" />}
        </div>
        <div aria-live="polite">
          {refreshError && (
            <p className="flex items-start gap-1.5 text-sm text-amber-800">
              <AlertTriangle {...ICON_XS} className="mt-0.5" />
              <span>อัปเดตไม่สำเร็จ: {refreshError}</span>
            </p>
          )}
          {cancelMsg && !cancelOpen && (
            <p className={clsx('text-sm', cancelMsg.ok ? 'text-green-800' : 'text-red-700')}>{cancelMsg.text}</p>
          )}
        </div>
      </section>

      {/* ===== ชำระเงิน ===== */}
      {b.can_upload_slip && <PaymentPanel booking={b} token={token} onCheck={refresh} />}
      {!b.can_upload_slip && (b.status === 'pending' || b.status === 'confirmed') && (
        // ส่งสลิปครบจำนวนที่ระบบรับแล้ว (กันส่งรูปไม่จำกัด: ที่ยังนับไม่เกิน 5 / ที่เคยส่งทั้งหมดไม่เกิน 10) — ส่วนที่เหลือคุยกับร้านโดยตรง
        <div className="alert-info" role="status">
          <Info {...ICON_SM} />
          <p className="min-w-0">
            {b.slips_count >= b.slips_max
              ? `ส่งสลิปครบ ${b.slips_max} รูปแล้ว ร้านกำลังตรวจสอบ — `
              : 'ส่งสลิปออนไลน์ครบจำนวนครั้งที่ระบบรับแล้ว — '}
            หากต้องการส่งสลิปเพิ่ม กรุณาส่งให้ร้านทาง LINE พร้อมแจ้งเลขที่การจอง
          </p>
        </div>
      )}

      {/* ===== รายการชุด ===== */}
      <section className="card" aria-labelledby="st-lines-title">
        <div className="card-header">
          <h2 id="st-lines-title" className="section-title">
            <ClipboardList {...ICON_SM} />
            รายการชุด ({b.lines.length})
          </h2>
        </div>
        <ul className="divide-y divide-gray-150">
          {b.lines.map((l, i) => (
            <li key={`${l.item_code}-${i}`} className="flex gap-3 p-3 sm:p-4">
              <RentalImage path={l.cover_path} alt="" className="h-20 w-16 shrink-0 rounded-lg border border-gray-200" />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 break-words text-sm font-semibold text-gray-900">{l.item_name}</p>
                <p className="text-xs text-gray-500">
                  รหัส {l.item_code} · ไซส์ <span className="font-medium text-gray-700">{sizeLabel(l.size)}</span>
                </p>
                {l.deposit > 0 && <p className="text-xs text-gray-500">ค่าประกันชุด {baht(l.deposit)}</p>}
              </div>
              <p className="money shrink-0 text-sm text-gray-900">{baht(l.rent_price)}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ===== ยอดเงิน ===== */}
      <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="st-money-title">
        <h2 id="st-money-title" className="section-title">
          <Receipt {...ICON_SM} />
          ยอดเงิน
        </h2>
        <dl className="space-y-2 text-sm">
          <Row label="ค่าเช่า" value={baht(m.rent_total)} />
          {m.discount > 0 && <Row label="ส่วนลด" value={`-${baht(m.discount)}`} />}
          {m.delivery_fee > 0 && <Row label="ค่าจัดส่ง" value={baht(m.delivery_fee)} />}
          {m.charges_total > 0 && <Row label="ค่าใช้จ่ายเพิ่มเติม" value={baht(m.charges_total)} />}
          <div className="divider" />
          <Row label="ยอดรวม" value={baht(m.grand_total)} strong />
          <Row label="ชำระแล้ว" value={baht(m.paid)} />
          {m.pending_review_total > 0 && <Row label="สลิปรอร้านตรวจสอบ" value={baht(m.pending_review_total)} />}
          {m.due > 0.005 && <Row label="ยอดคงเหลือ" value={baht(m.due)} strong />}
          {m.due < -0.005 && <Row label="ร้านต้องคืนเงินส่วนเกิน" value={baht(-m.due)} />}
        </dl>
        {m.deposit_required > 0 && !ended && (
          <p className={clsx('flex items-start gap-2 text-sm', m.deposit_met ? 'text-green-800' : 'text-gray-700')}>
            {m.deposit_met ? <CheckCircle2 {...ICON_XS} className="mt-0.5" /> : <Hourglass {...ICON_XS} className="mt-0.5" />}
            <span>
              มัดจำเพื่อยืนยันการจอง {baht(m.deposit_required)}
              {m.deposit_met ? ' — ชำระครบแล้ว' : ` — ยังขาด ${baht(depositLeft)}`}
            </span>
          </p>
        )}
        {m.security_required > 0 && !ended && (
          <p className="flex items-start gap-2 text-sm text-gray-700">
            <ShieldCheck {...ICON_XS} className="mt-0.5 text-brand-600" />
            <span>
              ค่าประกันชุด {baht(m.security_required)} — ชำระที่ร้านวันรับชุด ได้คืนเมื่อคืนชุดครบและสภาพดี
            </span>
          </p>
        )}
      </section>

      {/* ===== ประวัติการชำระ ===== */}
      {b.payments.length > 0 && (
        <section className="card" aria-labelledby="st-pay-title">
          <div className="card-header">
            <h2 id="st-pay-title" className="section-title">รายการชำระเงิน</h2>
          </div>
          <ul className="divide-y divide-gray-150">
            {b.payments.map((p, i) => (
              <li key={`${p.created_at}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{p.kind_label || 'ชำระเงิน'}</p>
                  <p className="text-xs text-gray-500">{formatThaiDateTime(p.created_at)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={paymentChip(p.status)}>{PAYMENT_STATUS_LABELS[p.status]}</span>
                  <span className={clsx('money text-sm', p.status === 'rejected' ? 'text-gray-400 line-through' : 'text-gray-900')}>
                    {baht(p.amount)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {b.payments.some(p => p.status === 'rejected') && (
            <p className="border-t border-gray-200 px-4 py-3 text-xs text-gray-500 sm:px-5">
              สลิปที่ไม่อนุมัติ: ร้านตรวจไม่พบยอดโอนหรือยอดไม่ตรง — ติดต่อร้านเพื่อสอบถาม หรือส่งสลิปที่ถูกต้องอีกครั้ง
            </p>
          )}
        </section>
      )}

      {/* ===== ติดต่อร้าน / ยกเลิก ===== */}
      <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="st-contact-title">
        <h2 id="st-contact-title" className="section-title">ติดต่อร้าน</h2>
        <p className="text-sm text-gray-600">ต้องการเปลี่ยนวัน เปลี่ยนชุด หรือสอบถามเพิ่มเติม แจ้งเลขที่การจอง {b.booking_no}</p>
        <ContactButtons contact={b.contact} />
        {b.can_cancel && (
          <div className="border-t border-gray-200 pt-3">
            <button type="button" className="btn-danger-soft" onClick={() => { setCancelMsg(null); setCancelOpen(true) }}>
              <Ban {...ICON_SM} />
              ยกเลิกคำขอจองนี้
            </button>
          </div>
        )}
        <p className="flex items-center gap-1.5 pt-1 text-xs text-gray-400">
          <Link2 {...ICON_XS} />
          ลิงก์นี้ใช้ดูการจองของคุณ — แชร์ให้เฉพาะคนที่ไว้ใจ
        </p>
      </section>

      <div className="text-center">
        <Link href="/book" className="link">
          <CalendarDays {...ICON_XS} />
          ดูชุดอื่น / จองเพิ่ม
        </Link>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        title="ยกเลิกคำขอจองนี้?"
        confirmLabel="ยืนยันยกเลิก"
        tone="danger"
        busy={cancelBusy}
        onConfirm={() => void doCancel()}
        onCancel={() => { if (!cancelBusyRef.current) setCancelOpen(false) }}
      >
        <p>คำขอ {b.booking_no} จะถูกยกเลิก และร้านจะปล่อยคิวชุดให้ลูกค้าคนอื่น</p>
        {m.paid > 0 && (
          <p>คุณชำระเงินไปแล้ว {baht(m.paid)} — การคืนเงินเป็นไปตามเงื่อนไขของร้าน กรุณาติดต่อร้านหลังยกเลิก</p>
        )}
        {cancelMsg && !cancelMsg.ok && (
          <p role="alert" className="flex items-start gap-1.5 text-red-700">
            <XCircle {...ICON_XS} className="mt-0.5" />
            <span>{cancelMsg.text}</span>
          </p>
        )}
      </ConfirmDialog>
    </div>
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

// ข้อความอธิบายสถานะ + สิ่งที่ลูกค้าต้องทำต่อ
function StatusMessage({
  booking: b, now, depositLeft, pendingReviewCount,
}: {
  booking: PublicBooking
  now: number | null
  depositLeft: number
  pendingReviewCount: number
}) {
  const left = b.status === 'pending' && now !== null ? timeLeftText(b.expires_at, now) : ''
  switch (b.status) {
    case 'pending':
      return (
        <div className="alert-warn">
          <Hourglass {...ICON_SM} />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">รอร้านยืนยันการจอง</p>
            {pendingReviewCount > 0 ? (
              <p>ได้รับสลิปแล้ว ร้านกำลังตรวจสอบยอดโอน</p>
            ) : depositLeft > 0.005 && b.can_upload_slip ? (
              <p>ชำระมัดจำ {baht(depositLeft)} แล้วส่งสลิปด้านล่าง เพื่อให้ร้านยืนยันคิวชุดให้</p>
            ) : (
              <p>ร้านกำลังตรวจสอบคิวชุดและจะยืนยันให้เร็วที่สุด</p>
            )}
            {b.expires_at && (
              <p>
                ร้านถือคิวไว้ถึง {formatThaiDateTime(b.expires_at)}
                {left ? ` (${left})` : ''}
              </p>
            )}
          </div>
        </div>
      )
    case 'confirmed':
      return (
        <div className="alert-ok">
          <CheckCircle2 {...ICON_SM} />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">ร้านยืนยันการจองแล้ว</p>
            <p>มารับชุดวันที่ {shortDay(b.pickup_date)} และคืนชุดภายในวันที่ {shortDay(b.return_date)}</p>
            {b.money.due > 0.005 && <p>ยอดคงเหลือ {baht(b.money.due)} ชำระก่อนหรือในวันรับชุด</p>}
          </div>
        </div>
      )
    case 'picked_up':
      return (
        <div className="alert-info">
          <Info {...ICON_SM} />
          <p className="min-w-0">กำลังเช่าอยู่ — กรุณาคืนชุดภายในวันที่ {shortDay(b.return_date)} (คืนช้ามีค่าปรับตามเงื่อนไขของร้าน)</p>
        </div>
      )
    case 'returned':
      return (
        <div className="alert-info">
          <Info {...ICON_SM} />
          <p className="min-w-0">ร้านได้รับชุดคืนแล้ว กำลังตรวจสภาพชุดและสรุปยอด/เงินประกัน</p>
        </div>
      )
    case 'completed':
      return (
        <div className="alert-ok">
          <CheckCircle2 {...ICON_SM} />
          <p className="min-w-0">เสร็จสิ้นเรียบร้อย ขอบคุณที่ใช้บริการ</p>
        </div>
      )
    case 'cancelled':
      return (
        <div className="alert-err">
          <XCircle {...ICON_SM} />
          <p className="min-w-0">การจองนี้ถูกยกเลิกแล้ว — ต้องการจองใหม่ เลือกชุดได้ที่หน้าแรก</p>
        </div>
      )
    case 'expired':
      return (
        <div className="alert-err">
          <XCircle {...ICON_SM} />
          <p className="min-w-0">หมดเวลาถือคิว — คำขอนี้ไม่ได้รับการยืนยันภายในเวลาที่กำหนด ส่งคำขอใหม่ได้ที่หน้าแรก</p>
        </div>
      )
    case 'no_show':
      return (
        <div className="alert-err">
          <XCircle {...ICON_SM} />
          <p className="min-w-0">ไม่ได้มารับชุดตามนัด การจองนี้ถูกปิดแล้ว — ติดต่อร้านหากมีข้อสงสัย</p>
        </div>
      )
    default:
      return null
  }
}
