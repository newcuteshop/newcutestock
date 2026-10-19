'use client'
// หน้ารายละเอียดการจอง / สัญญาเช่า (ฝั่งเบราว์เซอร์)
// - ข้อมูลตั้งต้นมาจากเซิร์ฟเวอร์ (rental_get_booking) · ทุกการกระทำได้ booking json ชุดใหม่กลับมาแทนที่ทั้งก้อน
//   แล้ว router.refresh() ให้ตัวเลขบนเมนู (คำขอรอยืนยัน/สลิปรอตรวจ) อัปเดตด้วย
// - ปุ่มแสดงตามสถานะ/ยอดเงิน (actions จากเซิร์ฟเวอร์ + กฎเดียวกันใน rpc.ts) — เซิร์ฟเวอร์ตรวจซ้ำทุกครั้ง
// - เอกสารพิมพ์ผ่าน PrintPortal ตัวเดียวของหน้า (สัญญา A4 / ใบส่งมอบ / ใบสรุปการคืน / ใบเสร็จ 80 มม.|A4)
// - มือถือ: การ์ดเรียงตามลำดับงาน (ปุ่ม → เงิน → ลูกค้า → ชุด → ...) · จอใหญ่: 2 คอลัมน์ (งานหลักซ้าย / เงิน+ลูกค้าขวา)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  AlertTriangle, ArrowLeft, Ban, CalendarClock, CalendarPlus, CalendarX, CheckCircle2, ClipboardList, ExternalLink,
  FileText, Hourglass, Info, Link2, Loader2, MessageCircle, PackageCheck, Pencil, Printer, ReceiptText, RefreshCw,
  Scale, Undo2, Wallet, XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { baht, bangkokDateKey, formatThaiDate, formatThaiDateTime } from '@/lib/format'
import {
  DELIVERY_METHOD_LABELS, PAYMENT_KIND_LABELS, SOURCE_LABELS, STATUS_CHIP, parseRentalBooking, paymentMoneyTime,
  type RentalBooking, type RentalCharge, type RentalPayment, type RentalPaymentKind, type RentalSettings,
} from '@/lib/rental'
import ConfirmDialog from '@/components/integrations/ConfirmDialog'
import PrintPortal from '@/components/pos/PrintPortal'
import { makeQrDataUrl } from '@/components/rental/QrImage'
import ContractDoc from '@/components/rental/docs/ContractDoc'
import PickupDoc from '@/components/rental/docs/PickupDoc'
import ReceiptDoc from '@/components/rental/docs/ReceiptDoc'
import SettlementDoc from '@/components/rental/docs/SettlementDoc'
import { CustomerCard, LinesCard, MoneyCard } from './BookingCards'
import { ChargesCard, PaymentsCard, TimelineCard } from './BookingLists'
import ChargeDialog from './ChargeDialog'
import { DialogMessage } from './DialogShell'
import ExtendDialog from './ExtendDialog'
import HoldDialog from './HoldDialog'
import LineMessageDialog from './LineMessageDialog'
import PaymentDialog from './PaymentDialog'
import PickupDialog from './PickupDialog'
import ReasonDialog from './ReasonDialog'
import ReturnItemsDialog from './ReturnItemsDialog'
import SettleDialog from './SettleDialog'
import SlipReviewDialog from './SlipReviewDialog'
import {
  absoluteUrl, allowedPaymentKinds, bookingFlags, callRpc, copyText, depositOutstanding, maxPaymentAmount, payDepositFirst, runBookingWrite,
  securityShort, statusAtLeast,
} from './rpc'

type DialogState =
  | { kind: 'pay'; payKind: RentalPaymentKind; back?: 'pickup' }   // back = ปิดแล้วกลับไปป็อปอัปรับชุด (เก็บสิ่งที่ติ๊กไว้)
  | { kind: 'pickup' }
  | { kind: 'extend' }
  | { kind: 'return' }
  | { kind: 'settle'; justReturned: boolean }
  | { kind: 'charge' }
  | { kind: 'hold' }
  | { kind: 'confirm' }
  | { kind: 'complete' }
  | { kind: 'cancel' }
  | { kind: 'no_show' }
  | { kind: 'void_payment'; payment: RentalPayment }
  | { kind: 'void_charge'; charge: RentalCharge }
  | { kind: 'slip'; payment: RentalPayment }
  | { kind: 'line' }

type PrintJob =
  | { doc: 'contract'; booking: RentalBooking; qr: string | null }
  | { doc: 'pickup'; booking: RentalBooking }
  | { doc: 'settlement'; booking: RentalBooking }
  | { doc: 'receipt'; booking: RentalBooking; payment: RentalPayment; paper: '80' | 'a4' }

// sticky = ค้างไว้จนกดปิด (เรื่องที่ต้องทำต่อ เช่น คืนเงินลูกค้าหลังอนุมัติสลิปของการจองที่ปิดไปแล้ว)
type Toast = { tone: 'ok' | 'err' | 'warn'; text: string; sticky?: boolean }

const CANCEL_REASONS = ['ลูกค้ายกเลิก', 'ติดต่อลูกค้าไม่ได้', 'ไม่ได้ชำระมัดจำ', 'จองผิด / จองซ้ำ'] as const
const VOID_PAYMENT_REASONS = ['บันทึกผิดยอด', 'บันทึกผิดวิธีชำระ', 'บันทึกซ้ำ'] as const
const VOID_CHARGE_REASONS = ['คิดผิด', 'ร้านยกเว้นให้', 'บันทึกซ้ำ'] as const

function updatedMs(b: RentalBooking): number {
  const t = Date.parse(b.updated_at)
  return Number.isFinite(t) ? t : 0
}

export default function BookingDetailClient({
  initialBooking,
  settings,
  canManage,
}: {
  initialBooking: RentalBooking
  settings: RentalSettings
  canManage: boolean
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [booking, setBooking] = useState<RentalBooking>(initialBooking)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [print, setPrint] = useState<PrintJob | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [reloading, setReloading] = useState(false)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const confirmBusyRef = useRef(false)
  const [confirmError, setConfirmError] = useState<{ text: string; tone: 'err' | 'warn' } | null>(null)
  // เวลาปัจจุบันฝั่งเบราว์เซอร์ (null ตอน render บนเซิร์ฟเวอร์ — กันข้อความเวลานับถอยหลังไม่ตรงกันตอน hydrate)
  const [now, setNow] = useState<number | null>(null)
  const bookingId = initialBooking.id

  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  // ข้อมูลจากเซิร์ฟเวอร์รอบใหม่ (router.refresh) → ใช้เมื่อใหม่กว่าหรือเท่ากับที่มีบนจอ
  useEffect(() => {
    setBooking(prev => (prev.id !== initialBooking.id || updatedMs(initialBooking) >= updatedMs(prev) ? initialBooking : prev))
  }, [initialBooking])

  useEffect(() => {
    if (!toast || toast.sticky) return
    const t = setTimeout(() => setToast(null), toast.tone === 'ok' ? 4000 : 8000)
    return () => clearTimeout(t)
  }, [toast])

  const reload = useCallback(async (): Promise<RentalBooking | null> => {
    setReloading(true)
    try {
      const res = await callRpc(supabase, 'rental_get_booking', { p_booking_id: bookingId }, 20000)
      if (!res.ok) return null
      const b = parseRentalBooking(res.data)
      if (b) setBooking(b)
      return b
    } finally {
      setReloading(false)
    }
  }, [supabase, bookingId])

  const applied = useCallback((b: RentalBooking, message?: string, tone: 'ok' | 'warn' = 'ok') => {
    setBooking(b)
    if (message) setToast(tone === 'warn' ? { tone: 'warn', text: message, sticky: true } : { tone: 'ok', text: message })
    router.refresh()
  }, [router])

  async function manualReload() {
    const b = await reload()
    setToast(b ? { tone: 'ok', text: 'โหลดข้อมูลล่าสุดแล้ว' } : { tone: 'err', text: 'โหลดข้อมูลไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่' })
    if (b) router.refresh()
  }

  const closeDialog = useCallback(() => {
    setDialog(null)
    setConfirmError(null)
  }, [])

  // ---------- พิมพ์ ----------
  function startPrint(job: PrintJob) {
    if (print) return // กำลังพิมพ์อยู่ — รอจบก่อน (PrintPortal เปิดได้ทีละงาน)
    setPrint(job)
  }

  async function printContract() {
    if (print || preparing) return
    setPreparing(true)
    let qr: string | null = null
    try {
      const url = absoluteUrl(booking.public_url_path)
      if (url) qr = await makeQrDataUrl(url, 90)
    } catch {
      qr = null // สร้าง QR ไม่ได้ก็พิมพ์สัญญาได้ (ไม่มี QR)
    } finally {
      setPreparing(false)
    }
    startPrint({ doc: 'contract', booking, qr })
  }

  async function copyStatusLink() {
    const url = absoluteUrl(booking.public_url_path)
    if (!url) {
      setToast({ tone: 'err', text: 'การจองนี้ยังไม่มีลิงก์สถานะ' })
      return
    }
    const ok = await copyText(url)
    setToast(ok ? { tone: 'ok', text: 'คัดลอกลิงก์สถานะการจองแล้ว' } : { tone: 'warn', text: `คัดลอกอัตโนมัติไม่ได้ — ลิงก์: ${url}` })
  }

  // ---------- ยืนยันการจอง / ปิดงาน (ConfirmDialog) ----------
  async function runConfirmAction(kind: 'confirm' | 'complete') {
    if (confirmBusyRef.current) return
    confirmBusyRef.current = true
    setConfirmBusy(true)
    setConfirmError(null)
    try {
      const res = await runBookingWrite({
        sb: supabase,
        fn: kind === 'confirm' ? 'rental_confirm_booking' : 'rental_complete',
        args: { p_booking_id: booking.id },
        reload,
        verify: fresh => (kind === 'confirm' ? statusAtLeast(fresh.status, 'confirmed') : fresh.status === 'completed'),
      })
      if (res.status === 'ok') {
        applied(res.booking, kind === 'confirm' ? 'ยืนยันการจองแล้ว' : 'ปิดงานเรียบร้อย')
        setDialog(null)
      } else {
        setConfirmError({ text: res.message, tone: res.status === 'unsure' ? 'warn' : 'err' })
      }
    } finally {
      confirmBusyRef.current = false
      setConfirmBusy(false)
    }
  }

  // ---------- เหตุผล + RPC (ยกเลิก / ไม่มารับ / ยกเลิกรายการเงิน / ยกเลิกค่าปรับ) ----------
  async function reasonWrite(
    fn: string,
    args: Record<string, unknown>,
    verify: (fresh: RentalBooking) => boolean,
    message: string,
  ): Promise<{ error: string; tone?: 'err' | 'warn' } | null> {
    const res = await runBookingWrite({ sb: supabase, fn, args, reload, verify })
    if (res.status === 'ok') {
      applied(res.booking, message)
      setDialog(null)
      return null
    }
    return { error: res.message, tone: res.status === 'unsure' ? 'warn' : 'err' }
  }

  // ---------- สิทธิ์ปุ่ม ----------
  const flags = bookingFlags(booking)
  const payKinds = allowedPaymentKinds(flags)
  const todayKey = now !== null ? bangkokDateKey(new Date(now)) : ''
  const canVoidPayment = (p: RentalPayment) =>
    // วันของรายการเงิน = วันที่เงินเข้าจริง (สลิป = วันอนุมัติ) — กฎเดียวกับ rental_void_payment
    booking.status !== 'completed' && (canManage || (todayKey !== '' && bangkokDateKey(paymentMoneyTime(p)) === todayKey))
  // รายการจาก parser (ไม่ต้องแยกข้อความที่ต่อกันอีก) ; เซิร์ฟเวอร์รุ่นเก่าที่ส่งเป็นข้อความเดียว → แยกตาม ' · '
  const pickupWarnings = booking.actions.pickup_warnings.length > 0
    ? booking.actions.pickup_warnings
    : (booking.actions.block_reasons.pickup_warnings ?? '')
      .split(' · ')
      .map(s => s.trim())
      .filter(Boolean)
  const statusUrl = booking.public_url_path ?? ''
  const m = booking.money

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* ===== หัวหน้า ===== */}
      <div className="space-y-2">
        <Link href="/rental/bookings" className="link inline-flex min-h-[44px] items-center gap-1 text-sm">
          <ArrowLeft {...ICON_SM} />
          การจองทั้งหมด
        </Link>
        <div className="page-header">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="page-title font-mono break-all">{booking.booking_no || 'การจอง'}</h1>
              <span className={STATUS_CHIP[booking.status]}>{booking.status_label}</span>
              <span className="chip-outline">{SOURCE_LABELS[booking.source]}</span>
              {booking.overdue && (
                <span className="badge-out"><AlertTriangle size={14} strokeWidth={1.9} aria-hidden="true" />เกินกำหนดคืน</span>
              )}
              {booking.customer.is_blacklisted && <span className="badge-out">ลูกค้าบัญชีดำ</span>}
            </div>
            <p className="page-subtitle">
              {booking.customer.name || '-'} · รับ {formatThaiDate(booking.pickup_date)}{booking.pickup_time ? ` ${booking.pickup_time}` : ''}
              {' – '}คืน {formatThaiDate(booking.return_date)} · {booking.days} วัน
              {booking.event_date ? ` · วันงาน ${formatThaiDate(booking.event_date)}` : ''}
            </p>
          </div>
          <div className="page-actions">
            <button type="button" className="btn-secondary" onClick={manualReload} disabled={reloading}>
              {reloading ? <Loader2 {...ICON_SM} className="animate-spin" /> : <RefreshCw {...ICON_SM} />}
              โหลดใหม่
            </button>
            {flags.edit && (
              <Link href={`/rental/bookings/${booking.id}/edit`} className="btn-secondary">
                <Pencil {...ICON_SM} />
                แก้ไขการจอง
              </Link>
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div className="sticky top-2 z-30" aria-live="polite">
          <div role={toast.tone === 'ok' ? 'status' : 'alert'} className={toast.tone === 'ok' ? 'alert-ok' : toast.tone === 'warn' ? 'alert-warn' : 'alert-err'}>
            {toast.tone === 'ok' ? <CheckCircle2 {...ICON_SM} /> : toast.tone === 'warn' ? <AlertTriangle {...ICON_SM} /> : <XCircle {...ICON_SM} />}
            <p className="min-w-0 flex-1 break-words">{toast.text}</p>
            <button type="button" className="shrink-0 text-xs font-semibold underline underline-offset-2" onClick={() => setToast(null)}>ปิด</button>
          </div>
        </div>
      )}

      {/* มือถือ: คอลัมน์เป็น display:contents → การ์ดทุกใบเรียงตาม order ; จอใหญ่: 2 คอลัมน์ */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start lg:gap-5">
        <div className="contents lg:block lg:space-y-5 min-w-0">
          {/* ===== ขั้นต่อไป + ปุ่มการกระทำ ===== */}
          <section className="card order-1" aria-labelledby="bk-actions">
            <div className="card-header">
              <h2 id="bk-actions" className="section-title">
                <ClipboardList {...ICON} />
                การดำเนินการ
              </h2>
            </div>
            <div className="p-4 sm:p-5 space-y-4">
              <NextStep booking={booking} now={now} pickupWarnings={pickupWarnings} />
              <ActionButtons
                booking={booking}
                flags={flags}
                payKinds={payKinds}
                onOpen={setDialog}
              />
            </div>
          </section>

          <div className="order-4"><LinesCard booking={booking} /></div>
          <div className="order-5">
            <PaymentsCard
              booking={booking}
              canVoid={canVoidPayment}
              onPrint={(p, paper) => startPrint({ doc: 'receipt', booking, payment: p, paper })}
              onVoid={p => setDialog({ kind: 'void_payment', payment: p })}
              onReview={p => setDialog({ kind: 'slip', payment: p })}
            />
          </div>
          <div className="order-6">
            <ChargesCard
              booking={booking}
              canVoid={flags.addCharge}
              onVoid={c => setDialog({ kind: 'void_charge', charge: c })}
              onAdd={flags.addCharge ? () => setDialog({ kind: 'charge' }) : undefined}
            />
          </div>
          <div className="order-9"><TimelineCard booking={booking} /></div>
        </div>

        <div className="contents lg:block lg:space-y-5 min-w-0">
          <div className="order-2">
            <MoneyCard booking={booking} onOpenPayment={payKinds.length > 0 ? () => setDialog({ kind: 'pay', payKind: payKinds[0] }) : undefined} />
          </div>
          <div className="order-3"><CustomerCard booking={booking} /></div>

          {/* ===== เอกสาร / ส่งลูกค้า ===== */}
          <section className="card order-7" aria-labelledby="bk-docs">
            <div className="card-header">
              <h2 id="bk-docs" className="section-title">
                <FileText {...ICON} />
                เอกสาร / ส่งลูกค้า
              </h2>
            </div>
            <div className="p-4 sm:p-5 grid grid-cols-1 gap-2">
              <button type="button" className="btn-secondary justify-start" onClick={printContract} disabled={!!print || preparing}>
                {preparing ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Printer {...ICON_SM} />}
                พิมพ์สัญญาเช่า (A4 · ร้าน + ลูกค้า)
              </button>
              <button type="button" className="btn-secondary justify-start" onClick={() => startPrint({ doc: 'pickup', booking })} disabled={!!print}>
                <Printer {...ICON_SM} />
                พิมพ์ใบส่งมอบชุด
              </button>
              {statusAtLeast(booking.status, 'returned') && (
                <button type="button" className="btn-secondary justify-start" onClick={() => startPrint({ doc: 'settlement', booking })} disabled={!!print}>
                  <Printer {...ICON_SM} />
                  พิมพ์ใบสรุปการคืนชุด
                </button>
              )}
              <button type="button" className="btn-secondary justify-start" onClick={() => setDialog({ kind: 'line' })}>
                <MessageCircle {...ICON_SM} />
                ข้อความส่ง LINE ลูกค้า
              </button>
              {statusUrl && (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <button type="button" className="btn-secondary justify-start" onClick={copyStatusLink}>
                    <Link2 {...ICON_SM} />
                    คัดลอกลิงก์สถานะการจอง
                  </button>
                  <a href={statusUrl} target="_blank" rel="noopener noreferrer" className="btn-icon h-11 w-11" aria-label="เปิดหน้าสถานะการจองที่ลูกค้าเห็น">
                    <ExternalLink {...ICON_SM} />
                  </a>
                </div>
              )}
              <p className="text-xs text-gray-500">ลิงก์สถานะ: ลูกค้าดูยอด สแกนพร้อมเพย์ และแนบสลิปเองได้ (ไม่ต้องเข้าสู่ระบบ)</p>
            </div>
          </section>

          <div className="order-8"><DetailsCard booking={booking} /></div>
        </div>
      </div>

      {/* ===== ป็อปอัป ===== */}
      {dialog?.kind === 'pay' && (
        <PaymentDialog
          booking={booking}
          settings={settings}
          initialKind={dialog.payKind}
          onClose={dialog.back === 'pickup' ? () => setDialog({ kind: 'pickup' }) : closeDialog}
          onApplied={b => applied(b)}
          reload={reload}
          onPrint={(p, paper, b) => startPrint({ doc: 'receipt', booking: b, payment: p, paper })}
        />
      )}
      {dialog?.kind === 'pickup' && (
        <PickupDialog
          booking={booking}
          onClose={closeDialog}
          onApplied={(b, msg) => applied(b, msg)}
          reload={reload}
          onRequestPayment={k => setDialog({ kind: 'pay', payKind: k, back: 'pickup' })}
          onPrintPickup={b => startPrint({ doc: 'pickup', booking: b })}
        />
      )}
      {dialog?.kind === 'extend' && (
        <ExtendDialog booking={booking} onClose={closeDialog} onApplied={(b, msg) => applied(b, msg)} reload={reload} />
      )}
      {dialog?.kind === 'return' && (
        <ReturnItemsDialog
          booking={booking}
          settings={settings}
          onClose={closeDialog}
          reload={reload}
          onReturned={b => {
            applied(b, 'บันทึกรับคืนชุดแล้ว')
            setDialog({ kind: 'settle', justReturned: true })
          }}
        />
      )}
      {dialog?.kind === 'settle' && (
        <SettleDialog
          booking={booking}
          justReturned={dialog.justReturned}
          onClose={closeDialog}
          onApplied={b => applied(b)}
          reload={reload}
          onPrintSettlement={b => startPrint({ doc: 'settlement', booking: b })}
        />
      )}
      {dialog?.kind === 'charge' && (
        <ChargeDialog booking={booking} onClose={closeDialog} onApplied={(b, msg) => applied(b, msg)} reload={reload} />
      )}
      {dialog?.kind === 'hold' && (
        <HoldDialog booking={booking} onClose={closeDialog} onApplied={(b, msg) => applied(b, msg)} reload={reload} />
      )}
      {dialog?.kind === 'slip' && (
        <SlipReviewDialog
          booking={booking}
          payment={dialog.payment}
          onClose={closeDialog}
          onApplied={(b, msg, tone) => applied(b, msg, tone)}
          reload={reload}
        />
      )}
      {dialog?.kind === 'line' && (
        <LineMessageDialog booking={booking} settings={settings} onClose={closeDialog} />
      )}
      {dialog?.kind === 'cancel' && (
        <ReasonDialog
          title="ยกเลิกการจอง"
          subtitle={`การจอง ${booking.booking_no} · ${booking.customer.name}`}
          icon={<Ban {...ICON_SM} />}
          label="เหตุผลที่ยกเลิก"
          quickReasons={CANCEL_REASONS}
          confirmLabel="ยืนยันยกเลิกการจอง"
          onClose={closeDialog}
          onSubmit={reason => reasonWrite(
            'rental_cancel_booking',
            { p_booking_id: booking.id, p_reason: reason },
            fresh => fresh.status === 'cancelled',
            'ยกเลิกการจองแล้ว',
          )}
        >
          <p>ชุดที่จองไว้จะถูกปล่อยให้คนอื่นจองได้ทันที</p>
          {(m.paid > 0.005 || m.security_held > 0.005) && (
            <div className="alert-warn">
              <AlertTriangle {...ICON_SM} />
              <p className="min-w-0">
                เงินที่รับไว้ยังอยู่ในการจองนี้
                {m.paid > 0.005 ? ` (ชำระแล้ว ${baht(m.paid)} — ถือเป็นมัดจำที่ริบ ถ้าจะคืนให้กด "คืนเงิน" หลังยกเลิก)` : ''}
                {m.security_held > 0.005 ? ` · เงินประกัน ${baht(m.security_held)} ต้องคืนลูกค้า (ปุ่ม "คืนเงินประกัน")` : ''}
              </p>
            </div>
          )}
        </ReasonDialog>
      )}
      {dialog?.kind === 'no_show' && (
        <ReasonDialog
          title="ลูกค้าไม่มารับชุด"
          subtitle={`การจอง ${booking.booking_no} · นัดรับ ${formatThaiDate(booking.pickup_date)}`}
          icon={<CalendarX {...ICON_SM} />}
          label="หมายเหตุ"
          required={false}
          placeholder="ไม่ใส่ = ลูกค้าไม่มารับชุดตามนัด"
          confirmLabel="บันทึกว่าไม่มารับ"
          onClose={closeDialog}
          onSubmit={reason => reasonWrite(
            'rental_mark_no_show',
            { p_booking_id: booking.id, p_reason: reason || null },
            fresh => fresh.status === 'no_show',
            'บันทึกลูกค้าไม่มารับชุดแล้ว',
          )}
        >
          <p>ชุดจะถูกปล่อยให้คนอื่นจองได้ · เงินที่รับไว้คงอยู่ (มัดจำที่ริบ) — คืนเงินประกันได้ภายหลัง</p>
        </ReasonDialog>
      )}
      {dialog?.kind === 'void_payment' && (
        <ReasonDialog
          title="ยกเลิกรายการเงิน"
          subtitle={`${dialog.payment.receipt_no ?? ''} · ${PAYMENT_KIND_LABELS[dialog.payment.kind]} ${baht(dialog.payment.amount)}`}
          icon={<Ban {...ICON_SM} />}
          label="เหตุผลที่ยกเลิก"
          quickReasons={VOID_PAYMENT_REASONS}
          confirmLabel="ยืนยันยกเลิกรายการ"
          onClose={closeDialog}
          onSubmit={reason => {
            const pid = dialog.payment.id
            return reasonWrite(
              'rental_void_payment',
              { p_payment_id: pid, p_reason: reason },
              fresh => fresh.payments.some(p => p.id === pid && !!p.voided_at),
              'ยกเลิกรายการเงินแล้ว',
            )
          }}
        >
          <p>รายการจะไม่ถูกลบ แต่จะไม่นับในยอดเงินอีก (ใบเสร็จที่พิมพ์ไปแล้วจะแสดง "ยกเลิกแล้ว" เมื่อพิมพ์ซ้ำ)</p>
          {!canManage && <p className="text-xs text-gray-500">พนักงานยกเลิกได้เฉพาะรายการของวันนี้</p>}
        </ReasonDialog>
      )}
      {dialog?.kind === 'void_charge' && (
        <ReasonDialog
          title="ยกเลิกค่าปรับ / ค่าใช้จ่าย"
          subtitle={`${dialog.charge.description} ${baht(dialog.charge.amount)}`}
          icon={<Ban {...ICON_SM} />}
          label="เหตุผลที่ยกเลิก"
          quickReasons={VOID_CHARGE_REASONS}
          confirmLabel="ยืนยันยกเลิก"
          onClose={closeDialog}
          onSubmit={reason => {
            const cid = dialog.charge.id
            return reasonWrite(
              'rental_void_charge',
              { p_charge_id: cid, p_reason: reason },
              fresh => fresh.charges.some(c => c.id === cid && !!c.voided_at),
              'ยกเลิกค่าใช้จ่ายแล้ว',
            )
          }}
        />
      )}
      <ConfirmDialog
        open={dialog?.kind === 'confirm'}
        title="ยืนยันการจอง"
        confirmLabel="ยืนยันการจอง"
        busy={confirmBusy}
        onCancel={closeDialog}
        onConfirm={() => void runConfirmAction('confirm')}
      >
        <p>
          การจอง {booking.booking_no} ของ {booking.customer.name} จะเปลี่ยนเป็น "จองแล้ว" และไม่หมดเวลาถืออีก
        </p>
        {m.deposit_met ? (
          <p className="text-green-800 font-medium">ได้รับมัดจำครบแล้ว ({baht(m.paid)} จาก {baht(m.deposit_required)})</p>
        ) : (
          <p className="text-amber-800 font-medium">
            ยังไม่ได้รับมัดจำครบ (ชำระแล้ว {baht(m.paid)} · มัดจำ {baht(m.deposit_required)}) — ยืนยันได้ถ้าร้านตกลงกับลูกค้าแล้ว
          </p>
        )}
        {confirmError && <DialogMessage tone={confirmError.tone} text={confirmError.text} />}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog?.kind === 'complete'}
        title="ปิดงานการจองนี้"
        confirmLabel="ปิดงาน"
        busy={confirmBusy}
        onCancel={closeDialog}
        onConfirm={() => void runConfirmAction('complete')}
      >
        <p>ยอดชำระครบและเคลียร์เงินประกันแล้ว — ปิดงานแล้วแก้ไขรายการเงินของการจองนี้ไม่ได้อีก</p>
        {confirmError && <DialogMessage tone={confirmError.tone} text={confirmError.text} />}
      </ConfirmDialog>

      {/* ===== พิมพ์ (ซ่อนบนจอ) ===== */}
      <PrintPortal open={print !== null} paper={print?.doc === 'receipt' ? print.paper : 'a4'} onDone={() => setPrint(null)}>
        {print?.doc === 'contract' && <ContractDoc booking={print.booking} settings={settings} qrDataUrl={print.qr} />}
        {print?.doc === 'pickup' && <PickupDoc booking={print.booking} settings={settings} />}
        {print?.doc === 'settlement' && <SettlementDoc booking={print.booking} settings={settings} />}
        {print?.doc === 'receipt' && (
          <ReceiptDoc booking={print.booking} payment={print.payment} settings={settings} paper={print.paper} />
        )}
      </PrintPortal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ขั้นต่อไป (ข้อความสรุปว่าต้องทำอะไรต่อ)
// ---------------------------------------------------------------------------
function hoursLeft(iso: string | null, now: number | null): string {
  if (!iso || now === null) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const mins = Math.round((t - now) / 60000)
  if (mins <= 0) return 'หมดเวลาแล้ว (ระบบจะปล่อยชุดเมื่อมีการเปิดดู/จองครั้งถัดไป)'
  if (mins < 60) return `เหลืออีก ${mins} นาที`
  const h = Math.floor(mins / 60)
  return h < 48 ? `เหลืออีก ${h} ชม. ${mins % 60} นาที` : `เหลืออีก ${Math.floor(h / 24)} วัน`
}

function NextStep({ booking: b, now, pickupWarnings }: { booking: RentalBooking; now: number | null; pickupWarnings: string[] }) {
  const m = b.money
  const reasons = b.actions.block_reasons
  switch (b.status) {
    case 'pending': {
      const dep = depositOutstanding(b)
      return (
        <div className="alert-warn">
          <Hourglass {...ICON_SM} />
          <div className="min-w-0 space-y-0.5">
            <p className="font-semibold">รอยืนยันการจอง{b.source === 'online' ? ' (คำขอจองออนไลน์)' : ''}</p>
            {b.expires_at && (
              <p>ถือชุดไว้ถึง {formatThaiDateTime(b.expires_at)}{now !== null ? ` · ${hoursLeft(b.expires_at, now)}` : ''}</p>
            )}
            <p>{m.deposit_met ? 'ได้รับมัดจำครบแล้ว — กด "ยืนยันการจอง"' : `ยังไม่ได้รับมัดจำ ${baht(dep)} (มัดจำ ${baht(m.deposit_required)})`}</p>
            {m.pending_review_total > 0 && <p className="font-medium">มีสลิปรอตรวจ {baht(m.pending_review_total)} — ตรวจที่รายการเงิน</p>}
          </div>
        </div>
      )
    }
    case 'confirmed': {
      // ชิ้นที่ยังอยู่กับลูกค้าคนก่อน = รับชุดไม่ได้แม้กดบังคับ (แยกเป็นกล่องแดง) / ที่เหลือ = ข้อควรระวัง
      const blockers = b.actions.pickup_blockers
      const soft = pickupWarnings.filter(w => !blockers.includes(w))
      return (
        <div role={blockers.length ? 'alert' : undefined} className={blockers.length ? 'alert-err' : soft.length ? 'alert-warn' : 'alert-info'}>
          <PackageCheck {...ICON_SM} />
          <div className="min-w-0 space-y-0.5">
            <p className="font-semibold">นัดรับชุด {formatThaiDate(b.pickup_date)}{b.pickup_time ? ` เวลา ${b.pickup_time}` : ''}</p>
            {blockers.length > 0 && (
              <>
                <p className="font-medium">ยังส่งมอบไม่ได้ (กดบังคับก็ไม่ได้):</p>
                <ul className="list-disc pl-4">{blockers.map(w => <li key={w}>{w}</li>)}</ul>
              </>
            )}
            {soft.length > 0
              ? <ul className="list-disc pl-4">{soft.map(w => <li key={w}>{w}</li>)}</ul>
              : blockers.length === 0 && <p>พร้อมส่งมอบ — ยอดและเงินประกันครบ</p>}
            {m.pending_review_total > 0 && <p className="font-medium">มีสลิปรอตรวจ {baht(m.pending_review_total)}</p>}
          </div>
        </div>
      )
    }
    case 'picked_up':
      return b.overdue ? (
        <div role="alert" className="alert-err">
          <AlertTriangle {...ICON_SM} />
          <div className="min-w-0 space-y-0.5">
            <p className="font-semibold">เกินกำหนดคืน {b.late.late_days} วัน (กำหนด {formatThaiDate(b.return_date)})</p>
            {b.late.suggested_late_fee > 0 && <p>ค่าปรับแนะนำถึงวันนี้ {baht(b.late.suggested_late_fee)}</p>}
            {b.customer.phone && <p>โทรติดตามลูกค้า หรือกด "เปลี่ยนวันคืน" ถ้าตกลงต่อเวลา</p>}
          </div>
        </div>
      ) : (
        <div className="alert-info">
          <CalendarClock {...ICON_SM} />
          <p className="min-w-0">ลูกค้ากำลังเช่า · กำหนดคืน {formatThaiDate(b.return_date)}{m.due > 0.005 ? ` · ค้างชำระ ${baht(m.due)}` : ''}</p>
        </div>
      )
    case 'returned':
      return b.actions.can_complete || (Math.abs(m.due) < 0.005 && m.security_held < 0.005) ? (
        <div className="alert-ok">
          <CheckCircle2 {...ICON_SM} />
          <p className="min-w-0">คืนชุดแล้ว ยอดเคลียร์ครบ — กด "ปิดงาน" ได้เลย</p>
        </div>
      ) : (
        <div className="alert-warn">
          <Scale {...ICON_SM} />
          <p className="min-w-0">คืนชุดแล้ว รอเคลียร์เงิน: {reasons.complete || 'ยังมียอดค้าง/เงินประกัน'}</p>
        </div>
      )
    case 'completed':
      return (
        <div className="alert-ok">
          <CheckCircle2 {...ICON_SM} />
          <p className="min-w-0">ปิดงานแล้ว{b.completed_at ? ` เมื่อ ${formatThaiDateTime(b.completed_at)}` : ''}</p>
        </div>
      )
    default: {
      const leftover = m.security_held > 0.005 || m.paid > 0.005
      return (
        <div className={leftover ? 'alert-warn' : 'alert-info'}>
          <Info {...ICON_SM} />
          <div className="min-w-0 space-y-0.5">
            <p className="font-semibold">{b.status_label}{b.cancelled_at ? ` · ${formatThaiDateTime(b.cancelled_at)}` : ''}</p>
            {b.cancel_reason && <p>เหตุผล: {b.cancel_reason}</p>}
            {m.security_held > 0.005 && <p>ยังถือเงินประกัน {baht(m.security_held)} — คืนลูกค้าได้ที่ "คืนเงินประกัน"</p>}
            {m.paid > 0.005 && <p>เงินที่ชำระไว้ {baht(m.paid)} (ถ้าคืนลูกค้า กด "คืนเงิน")</p>}
          </div>
        </div>
      )
    }
  }
}

// ---------------------------------------------------------------------------
// ปุ่มการกระทำตามสถานะ: ปุ่มหลัก 1 ปุ่ม (ขั้นต่อไป) + ปุ่มรอง + ปุ่มเงิน + ปุ่มยกเลิก
// ---------------------------------------------------------------------------
type Btn = { key: string; label: string; icon: JSX.Element; onClick(): void; tone?: 'primary' | 'danger' }

function ActionButtons({
  booking,
  flags,
  payKinds,
  onOpen,
}: {
  booking: RentalBooking
  flags: ReturnType<typeof bookingFlags>
  payKinds: RentalPaymentKind[]
  onOpen(d: DialogState): void
}) {
  const main: Btn[] = []
  const secondary: Btn[] = []
  const danger: Btn[] = []
  const s = booking.status

  if (flags.confirm) main.push({ key: 'confirm', label: 'ยืนยันการจอง', icon: <CheckCircle2 {...ICON_SM} />, onClick: () => onOpen({ kind: 'confirm' }) })
  if (flags.pickup) (s === 'confirmed' ? main : secondary).push({ key: 'pickup', label: 'ลูกค้ารับชุด', icon: <PackageCheck {...ICON_SM} />, onClick: () => onOpen({ kind: 'pickup' }) })
  if (flags.ret) main.push({ key: 'return', label: 'รับคืนชุด', icon: <Undo2 {...ICON_SM} />, onClick: () => onOpen({ kind: 'return' }) })
  if (flags.complete) main.push({ key: 'complete', label: 'ปิดงาน', icon: <CheckCircle2 {...ICON_SM} />, onClick: () => onOpen({ kind: 'complete' }) })
  else if (flags.settle) main.push({ key: 'settle', label: 'สรุปเงิน / คืนประกัน', icon: <Scale {...ICON_SM} />, onClick: () => onOpen({ kind: 'settle', justReturned: false }) })

  if (flags.extendHold) secondary.push({ key: 'hold', label: 'ต่อเวลาถือ', icon: <Hourglass {...ICON_SM} />, onClick: () => onOpen({ kind: 'hold' }) })
  if (flags.extend) secondary.push({ key: 'extend', label: 'เปลี่ยนวันคืน', icon: <CalendarPlus {...ICON_SM} />, onClick: () => onOpen({ kind: 'extend' }) })
  if (flags.addCharge) secondary.push({ key: 'charge', label: 'เพิ่มค่าปรับ/ค่าใช้จ่าย', icon: <ReceiptText {...ICON_SM} />, onClick: () => onOpen({ kind: 'charge' }) })

  if (flags.noShow) danger.push({ key: 'no_show', label: 'ลูกค้าไม่มารับ', icon: <CalendarX {...ICON_SM} />, onClick: () => onOpen({ kind: 'no_show' }), tone: 'danger' })
  if (flags.cancel) danger.push({ key: 'cancel', label: 'ยกเลิกการจอง', icon: <Ban {...ICON_SM} />, onClick: () => onOpen({ kind: 'cancel' }), tone: 'danger' })

  // ปุ่มหลักมีได้ปุ่มเดียว — ที่เหลือลดเป็นปุ่มรอง
  const primary = main[0]
  const rest = [...main.slice(1), ...secondary]
  const payLabel: Record<RentalPaymentKind, string> = {
    // ป้ายตรงกับยอดตั้งต้นในป็อปอัป: มัดจำยังไม่ครบ = ตั้งต้นที่ยอดมัดจำ (ยอดค้างทั้งหมดเป็นปุ่มด่วนในป็อปอัป)
    payment: payDepositFirst(booking)
      ? `รับชำระ · มัดจำ ${baht(depositOutstanding(booking))}`
      : `รับชำระ${booking.money.due > 0.005 ? ` ${baht(booking.money.due)}` : ''}`,
    security_in: `รับเงินประกัน ${baht(securityShort(booking))}`,
    security_apply: `หักเงินประกัน ${baht(maxPaymentAmount(booking, 'security_apply'))}`,
    security_out: `คืนเงินประกัน ${baht(booking.money.security_held)}`,
    refund: booking.money.due < -0.005 ? `คืนเงินที่รับเกิน ${baht(-booking.money.due)}` : 'คืนเงิน',
  }

  if (!primary && rest.length === 0 && payKinds.length === 0 && danger.length === 0) {
    return <p className="text-sm text-gray-500">ไม่มีสิ่งที่ต้องทำกับการจองนี้แล้ว</p>
  }

  return (
    <div className="space-y-3">
      {primary && (
        <button type="button" className="btn-primary w-full text-base" onClick={primary.onClick}>
          {primary.icon}
          {primary.label}
        </button>
      )}
      {rest.length > 0 && (
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
          {rest.map(b => (
            <button key={b.key} type="button" className="btn-secondary" onClick={b.onClick}>
              {b.icon}
              {b.label}
            </button>
          ))}
        </div>
      )}
      {payKinds.length > 0 && (
        <div>
          <p className="section-kicker mb-1.5">เงิน</p>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
            {payKinds.map(k => (
              <button key={k} type="button" className="btn-soft" onClick={() => onOpen({ kind: 'pay', payKind: k })}>
                <Wallet {...ICON_SM} />
                <span className="min-w-0 truncate">{payLabel[k]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {danger.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
          {danger.map(b => (
            <button key={b.key} type="button" className="btn-danger-soft flex-1 min-w-[150px]" onClick={b.onClick}>
              {b.icon}
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ข้อมูลการจอง (วันเวลา / การรับชุด / หมายเหตุ / ประวัติสถานะ)
// ---------------------------------------------------------------------------
function DetailsCard({ booking: b }: { booking: RentalBooking }) {
  const rows: { label: string; value: string }[] = [
    { label: 'ช่องทาง', value: SOURCE_LABELS[b.source] },
    { label: 'วันรับชุด', value: `${formatThaiDate(b.pickup_date)}${b.pickup_time ? ` ${b.pickup_time}` : ''}` },
    { label: 'วันคืนชุด', value: `${formatThaiDate(b.return_date)} (${b.days} วัน)` },
  ]
  if (b.event_date) rows.push({ label: 'วันงาน', value: formatThaiDate(b.event_date) })
  if (b.fitting_date) rows.push({ label: 'นัดลองชุด', value: `${formatThaiDate(b.fitting_date)}${b.fitting_time ? ` ${b.fitting_time}` : ''}` })
  rows.push({
    label: 'การรับชุด',
    value: `${DELIVERY_METHOD_LABELS[b.delivery_method]}${b.delivery_method === 'delivery' && b.delivery_address ? ` — ${b.delivery_address}` : ''}`,
  })
  rows.push({ label: 'สร้างเมื่อ', value: `${formatThaiDateTime(b.created_at)}${b.created_by_name ? ` · ${b.created_by_name}` : ''}` })
  if (b.confirmed_at) rows.push({ label: 'ยืนยันเมื่อ', value: formatThaiDateTime(b.confirmed_at) })
  if (b.picked_up_at) rows.push({ label: 'รับชุดเมื่อ', value: formatThaiDateTime(b.picked_up_at) })
  if (b.returned_at) rows.push({ label: 'รับคืนเมื่อ', value: `${formatThaiDateTime(b.returned_at)}${b.returned_on ? ` (วันที่คืน ${formatThaiDate(b.returned_on)})` : ''}` })
  if (b.completed_at) rows.push({ label: 'ปิดงานเมื่อ', value: formatThaiDateTime(b.completed_at) })
  if (b.cancelled_at) rows.push({ label: b.status === 'no_show' ? 'บันทึกไม่มารับเมื่อ' : 'ยกเลิกเมื่อ', value: formatThaiDateTime(b.cancelled_at) })

  return (
    <section className="card" aria-labelledby="bk-details">
      <div className="card-header">
        <h2 id="bk-details" className="section-title">
          <Info {...ICON} />
          ข้อมูลการจอง
        </h2>
      </div>
      <div className="p-4 sm:p-5 space-y-3">
        <dl className="space-y-1.5 text-sm">
          {rows.map(r => (
            <div key={r.label} className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-gray-600">{r.label}</dt>
              <dd className="min-w-0 text-right text-gray-900 break-words">{r.value}</dd>
            </div>
          ))}
        </dl>
        {b.customer_note && (
          <div className="panel px-3 py-2 text-sm">
            <p className="text-xs font-medium text-gray-600">หมายเหตุจากลูกค้า</p>
            <p className="whitespace-pre-line break-words text-gray-900">{b.customer_note}</p>
          </div>
        )}
        {b.note && (
          <div className="panel px-3 py-2 text-sm">
            <p className="text-xs font-medium text-gray-600">หมายเหตุภายในร้าน</p>
            <p className="whitespace-pre-line break-words text-gray-900">{b.note}</p>
          </div>
        )}
        {b.cancel_reason && (
          <p className={clsx('text-sm', 'text-red-700')}>เหตุผล{b.status === 'no_show' ? 'ไม่มารับ' : 'ยกเลิก'}: {b.cancel_reason}</p>
        )}
      </div>
    </section>
  )
}
