'use client'
// หน้ารายละเอียดงาน b.oncloud (ฝั่งเบราว์เซอร์) — โครงเดียวกับหน้ารายละเอียดการจองของร้านเช่า
// - ข้อมูลตั้งต้นมาจากเซิร์ฟเวอร์ (wed_get_booking) · ทุกการกระทำได้ booking json ชุดใหม่กลับมาแทนที่ทั้งก้อน
//   แล้ว router.refresh() ให้ตัวเลขบนเมนู (ติดตามลูกค้า/ล็อกคิว/งวดเลยกำหนด/ส่งงานเลยกำหนด) อัปเดตด้วย
// - ปุ่มแสดงตาม actions จากเซิร์ฟเวอร์ (wed_booking_json) — เซิร์ฟเวอร์ตรวจซ้ำทุกครั้ง
// - เอกสารทั้งหมด (ยืนยันการจอง/ใบเสนอราคา/ใบแจ้งชำระ/ใบเสร็จ/ตารางคิว/สรุปส่งงาน/สัญญา) อยู่ในศูนย์เอกสาร (DocumentCenter)
// - มือถือ: การ์ดเรียงตามลำดับงาน (ปุ่ม → เงิน → คิวงาน → ลูกค้า → ส่งลูกค้า ...) · จอใหญ่: 2 คอลัมน์
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, ArrowLeft, Ban, BellRing, CalendarCheck, CalendarClock, CalendarX, Camera, CheckCircle2, ClipboardList,
  ExternalLink, FileImage, Hourglass, Info, Link2, Loader2, Lock, MessageCircle, Pencil, PlayCircle, RefreshCw, RotateCcw,
  Send, Trash2, Undo2, Unlock, Wallet, XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { baht, bangkokDateKey, daysBetweenKeys, formatThaiDate, formatThaiDateTime, formatThaiDayLong } from '@/lib/format'
import {
  WED_PAYMENT_KIND_LABELS, WED_STATUS_CHIP, amountDueNow, crewConflictText, parseCrewList, parseWedBooking, wedSourceLabel,
  type WedBooking, type WedCharge, type WedCrew, type WedDeliverable, type WedDeliverableStatus, type WedPayment,
  type WedPaymentKind, type WedSettings,
} from '@/lib/wedding'
import ReasonDialog from '@/components/rental/booking/ReasonDialog'
import DocumentCenter from '@/components/wedding/docs/DocumentCenter'
import type { DocKind } from '@/components/wedding/docs/docKinds'
import ActionDialog from './ActionDialog'
import { CapacityAlert, CustomerCard, InstallmentsCard, MoneyCard, PackageCard, SessionsCard } from './BookingCards'
import { ChargesCard, DeliverablesCard, PaymentsCard, TimelineCard } from './BookingLists'
import ChargeDialog from './ChargeDialog'
import DeliverableDialog from './DeliverableDialog'
import FollowupDialog from './FollowupDialog'
import HoldDialog from './HoldDialog'
import InstallmentsDialog from './InstallmentsDialog'
import LineMessageDialog from './LineMessageDialog'
import PaymentDialog from './PaymentDialog'
import { EPS, absoluteUrl, allowedPaymentKinds, callRpc, copyText, depositShort, runWedWrite, statusAtLeast } from './rpc'

type ActionKind = 'confirm' | 'mark_shot' | 'mark_delivered' | 'complete' | 'reopen' | 'release' | 'resume' | 'rotate' | 'reset_installments'

type DialogState =
  | { kind: 'pay'; payKind: WedPaymentKind }
  | { kind: 'charge' }
  | { kind: 'hold'; mode: 'hold' | 'extend' }
  | { kind: 'followup' }
  | { kind: 'installments' }
  | { kind: 'action'; action: ActionKind }
  | { kind: 'cancel' }
  | { kind: 'postpone' }
  | { kind: 'void_payment'; payment: WedPayment }
  | { kind: 'void_charge'; charge: WedCharge }
  | { kind: 'deliverable'; item: WedDeliverable | null; preset?: WedDeliverableStatus }
  | { kind: 'delete_deliverable'; item: WedDeliverable }
  | { kind: 'line' }

type Toast = { tone: 'ok' | 'err' | 'warn'; text: string; sticky?: boolean }

const CANCEL_REASONS = ['ลูกค้ายกเลิกงาน', 'ติดต่อลูกค้าไม่ได้', 'ไม่ได้ชำระมัดจำ', 'บันทึกผิด / บันทึกซ้ำ'] as const
const POSTPONE_REASONS = ['ลูกค้าเลื่อนวันงาน', 'รอฤกษ์ใหม่', 'สถานที่ไม่ว่าง', 'เหตุสุดวิสัย'] as const
const VOID_PAYMENT_REASONS = ['บันทึกผิดยอด', 'บันทึกผิดวิธีชำระ', 'บันทึกซ้ำ'] as const
const VOID_CHARGE_REASONS = ['คิดผิด', 'ร้านยกเว้นให้', 'บันทึกซ้ำ'] as const

function updatedMs(b: WedBooking): number {
  const t = Date.parse(b.updated_at)
  return Number.isFinite(t) ? t : 0
}

/** ช่วงวันงาน: วันเดียว = 'วันเสาร์ที่ 5 ธ.ค. 2569' · หลายวัน = 'dd/mm/yyyy – dd/mm/yyyy' */
function eventDatesText(b: WedBooking): string {
  if (!b.first_date) return 'ยังไม่ระบุวันงาน'
  if (!b.last_date || b.last_date === b.first_date) return formatThaiDayLong(b.first_date)
  return `${formatThaiDate(b.first_date)} – ${formatThaiDate(b.last_date)}`
}

export default function BookingDetailClient({
  initialBooking,
  settings,
  canManage,
}: {
  initialBooking: WedBooking
  settings: WedSettings
  canManage: boolean
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [booking, setBooking] = useState<WedBooking>(initialBooking)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [docs, setDocs] = useState<{ initialDoc?: DocKind; paymentId?: string; sessionId?: string } | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [reloading, setReloading] = useState(false)
  const [crew, setCrew] = useState<WedCrew[] | null>(null)
  const [crewLoading, setCrewLoading] = useState(false)
  // เวลาปัจจุบันฝั่งเบราว์เซอร์ (null ตอน render บนเซิร์ฟเวอร์ — กันข้อความนับถอยหลังไม่ตรงกันตอน hydrate)
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

  const reload = useCallback(async (): Promise<WedBooking | null> => {
    setReloading(true)
    try {
      const res = await callRpc(supabase, 'wed_get_booking', { p_booking_id: bookingId }, 20000)
      if (!res.ok) return null
      const b = parseWedBooking(res.data)
      if (b) setBooking(b)
      return b
    } finally {
      setReloading(false)
    }
  }, [supabase, bookingId])

  const applied = useCallback((b: WedBooking, message?: string, tone: 'ok' | 'warn' = 'ok') => {
    setBooking(b)
    if (message) setToast(tone === 'warn' ? { tone: 'warn', text: message, sticky: true } : { tone: 'ok', text: message })
    router.refresh()
  }, [router])

  async function manualReload() {
    const b = await reload()
    setToast(b ? { tone: 'ok', text: 'โหลดข้อมูลล่าสุดแล้ว' } : { tone: 'err', text: 'โหลดข้อมูลไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่' })
    if (b) router.refresh()
  }

  const closeDialog = useCallback(() => setDialog(null), [])

  // รายชื่อทีม (ผู้ตัดต่อ) — โหลดครั้งแรกที่เปิดป็อปอัปรายการส่งงาน
  const ensureCrew = useCallback(async () => {
    if (crew !== null || crewLoading) return
    setCrewLoading(true)
    try {
      const res = await callRpc(supabase, 'wed_list_crew', {}, 20000)
      setCrew(res.ok ? parseCrewList(res.data) : [])
    } finally {
      setCrewLoading(false)
    }
  }, [crew, crewLoading, supabase])

  function openDeliverable(item: WedDeliverable | null, preset?: WedDeliverableStatus) {
    void ensureCrew()
    setDialog({ kind: 'deliverable', item, preset })
  }

  // ---------- เหตุผล + RPC (ยกเลิกงาน / เลื่อนงาน / ยกเลิกรายการเงิน / ยกเลิกค่าใช้จ่าย) ----------
  async function reasonWrite(
    fn: string,
    args: Record<string, unknown>,
    verify: (fresh: WedBooking) => boolean,
    message: string,
  ): Promise<{ error: string; tone?: 'err' | 'warn' } | null> {
    const res = await runWedWrite({ sb: supabase, fn, args, reload, verify })
    if (res.status === 'ok') {
      applied(res.booking, message)
      setDialog(null)
      return null
    }
    return { error: res.message, tone: res.status === 'unsure' ? 'warn' : 'err' }
  }

  // ---------- เปลี่ยนสถานะรายการส่งงานจากในแถว ----------
  async function quickDeliverableStatus(d: WedDeliverable, status: WedDeliverableStatus): Promise<string | null> {
    const res = await runWedWrite({
      sb: supabase,
      fn: 'wed_save_deliverable',
      args: { p_booking_id: booking.id, p_item: { id: d.id, status } },
      reload,
      verify: fresh => fresh.deliverables.some(x => x.id === d.id && x.status === status),
    })
    if (res.status === 'ok') {
      const auto = res.booking.status === 'delivered' && booking.status === 'in_production'
      applied(res.booking, auto ? 'ส่งงานครบทุกรายการ — งานเปลี่ยนเป็น "ส่งงานแล้ว"' : undefined)
      return null
    }
    return res.message
  }

  async function copyPortalLink() {
    const url = absoluteUrl(booking.public_url_path)
    if (!url) {
      setToast({ tone: 'err', text: 'งานนี้ยังไม่มีลิงก์ติดตามงาน' })
      return
    }
    const ok = await copyText(url)
    setToast(ok ? { tone: 'ok', text: 'คัดลอกลิงก์ติดตามงานแล้ว' } : { tone: 'warn', text: `คัดลอกอัตโนมัติไม่ได้ — ลิงก์: ${url}` })
  }

  // ---------- สิทธิ์ปุ่ม ----------
  const a = booking.actions
  const m = booking.money
  const todayKey = now !== null ? bangkokDateKey(new Date(now)) : ''
  const payKinds = allowedPaymentKinds(booking)
  const canVoidPayment = (p: WedPayment) =>
    // กฎเดียวกับ wed_void_payment: ปิดงานแล้วไม่ได้ · พนักงานเฉพาะรายการที่บันทึกวันนี้ (เวลาไทย)
    !p.voided_at && booking.status !== 'completed' && (canManage || (todayKey !== '' && bangkokDateKey(p.created_at) === todayKey))
  const editHref = a.can_edit ? `/wedding/bookings/${booking.id}/edit` : undefined
  const portalPath = booking.public_url_path ?? ''

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* ===== หัวหน้า ===== */}
      <div className="space-y-2">
        <Link href="/wedding/bookings" className="link inline-flex min-h-[44px] items-center gap-1 text-sm">
          <ArrowLeft {...ICON_SM} />
          งานทั้งหมด
        </Link>
        <div className="page-header">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-gray-600 break-all">{booking.booking_no || 'งาน'}</span>
              <span className={WED_STATUS_CHIP[booking.status]}>{booking.status_label}</span>
              {booking.source && <span className="chip-outline">{wedSourceLabel(booking.source)}</span>}
              {booking.crew_conflicts.length > 0 && (
                <span className="badge-out"><AlertTriangle size={14} strokeWidth={1.9} aria-hidden="true" />ทีมติดงานซ้อน</span>
              )}
            </div>
            <h1 className="page-title break-words">{booking.couple_names || booking.customer.name || 'งาน'}</h1>
            <p className="page-subtitle">
              {eventDatesText(booking)}
              {booking.sessions.length > 0 ? ` · ${booking.sessions.filter(s => s.status !== 'cancelled').length} คิว` : ''}
              {booking.package.name ? ` · ${booking.package.name}` : ''}
            </p>
          </div>
          <div className="page-actions">
            <button type="button" className="btn-secondary" onClick={manualReload} disabled={reloading}>
              {reloading ? <Loader2 {...ICON_SM} className="animate-spin" /> : <RefreshCw {...ICON_SM} />}
              โหลดใหม่
            </button>
            {editHref && (
              <Link href={editHref} className="btn-secondary">
                <Pencil {...ICON_SM} />
                แก้ไขงาน
              </Link>
            )}
            <button type="button" className="btn-primary" onClick={() => setDocs({})}>
              <Send {...ICON_SM} />
              ส่งเอกสาร
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <div className="sticky top-2 z-30" aria-live="polite">
          <div role={toast.tone === 'ok' ? 'status' : 'alert'} className={toast.tone === 'ok' ? 'alert-ok' : toast.tone === 'warn' ? 'alert-warn' : 'alert-err'}>
            {toast.tone === 'ok' ? <CheckCircle2 {...ICON_SM} /> : toast.tone === 'warn' ? <AlertTriangle {...ICON_SM} /> : <XCircle {...ICON_SM} />}
            <p className="min-w-0 flex-1 break-words">{toast.text}</p>
            <button type="button" className="shrink-0 min-h-[44px] px-1 text-xs font-semibold underline underline-offset-2" onClick={() => setToast(null)}>ปิด</button>
          </div>
        </div>
      )}

      {/* มือถือ: คอลัมน์เป็น display:contents → การ์ดทุกใบเรียงตาม order ; จอใหญ่: 2 คอลัมน์ */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start lg:gap-5">
        <div className="contents lg:block lg:space-y-5 min-w-0">
          {/* ===== ขั้นต่อไป + ปุ่มการกระทำ ===== */}
          <section className="card order-1" aria-labelledby="wb-actions">
            <div className="card-header">
              <h2 id="wb-actions" className="section-title">
                <ClipboardList {...ICON} />
                การดำเนินการ
              </h2>
            </div>
            <div className="p-4 sm:p-5 space-y-4">
              <NextStep booking={booking} now={now} todayKey={todayKey} />
              {booking.crew_conflicts.length > 0 && (
                <div role="alert" className="alert-err">
                  <AlertTriangle {...ICON_SM} />
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-semibold">ทีมงานติดงานซ้อน {booking.crew_conflicts.length} รายการ — ตรวจและสลับทีมก่อนวันงาน</p>
                    <ul className="list-disc pl-4">
                      {booking.crew_conflicts.slice(0, 5).map((c, i) => (
                        <li key={i} className="break-words">{formatThaiDate(c.date)}: {crewConflictText(c)}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              <CapacityAlert warnings={booking.capacity_warnings} />
              <ActionButtons booking={booking} payKinds={payKinds} canManage={canManage} editHref={editHref} onOpen={setDialog} />
              <FollowupPanel booking={booking} todayKey={todayKey} onEdit={a.can_set_followup ? () => setDialog({ kind: 'followup' }) : undefined} />
            </div>
          </section>

          <div className="order-3">
            <SessionsCard
              booking={booking}
              editHref={editHref}
              onSchedule={sessionId => setDocs({ initialDoc: 'schedule', sessionId })}
            />
          </div>
          <div className="order-9">
            <DeliverablesCard
              booking={booking}
              canEdit={a.can_edit_deliverables}
              onAdd={() => openDeliverable(null)}
              onEdit={(d, preset) => openDeliverable(d, preset)}
              onDelete={d => setDialog({ kind: 'delete_deliverable', item: d })}
              onQuickStatus={quickDeliverableStatus}
            />
          </div>
          <div className="order-7">
            <PaymentsCard
              booking={booking}
              canVoid={canVoidPayment}
              onReceipt={p => setDocs({ initialDoc: 'receipt', paymentId: p.id })}
              onVoid={p => setDialog({ kind: 'void_payment', payment: p })}
              onAdd={payKinds.length > 0 ? () => setDialog({ kind: 'pay', payKind: payKinds[0] }) : undefined}
            />
          </div>
          <div className="order-8">
            <ChargesCard
              booking={booking}
              canVoid={a.can_add_charge}
              onVoid={c => setDialog({ kind: 'void_charge', charge: c })}
              onAdd={a.can_add_charge ? () => setDialog({ kind: 'charge' }) : undefined}
            />
          </div>
          <div className="order-12"><TimelineCard booking={booking} /></div>
        </div>

        <div className="contents lg:block lg:space-y-5 min-w-0">
          <div className="order-2">
            <MoneyCard booking={booking} onOpenPayment={payKinds.length > 0 ? () => setDialog({ kind: 'pay', payKind: payKinds[0] }) : undefined} />
          </div>
          <div className="order-6">
            <InstallmentsCard
              booking={booking}
              onEdit={a.can_set_installments && m.grand_total > EPS ? () => setDialog({ kind: 'installments' }) : undefined}
              onReset={a.can_set_installments ? () => setDialog({ kind: 'action', action: 'reset_installments' }) : undefined}
            />
          </div>
          <div className="order-4"><CustomerCard booking={booking} /></div>

          {/* ===== เอกสาร / ส่งลูกค้า ===== */}
          <section className="card order-5" aria-labelledby="wb-docs">
            <div className="card-header">
              <h2 id="wb-docs" className="section-title">
                <FileImage {...ICON} />
                เอกสาร / ส่งลูกค้า
              </h2>
            </div>
            <div className="p-4 sm:p-5 grid grid-cols-1 gap-2">
              <button type="button" className="btn-secondary justify-start" onClick={() => setDocs({})}>
                <Send {...ICON_SM} />
                ส่งเอกสารเป็นรูป / พิมพ์ / สัญญาจ้าง
              </button>
              {/* ทางลัดเปิดศูนย์เอกสารที่ชนิดนั้นเลย */}
              <div className="flex flex-wrap gap-2" role="group" aria-label="เปิดเอกสารด่วน">
                <button type="button" className="chip-toggle" onClick={() => setDocs({ initialDoc: 'confirmation' })}>ใบยืนยันการจอง</button>
                <button type="button" className="chip-toggle" onClick={() => setDocs({ initialDoc: 'quote' })}>ใบเสนอราคา</button>
                {m.due > EPS && (
                  <button type="button" className="chip-toggle" onClick={() => setDocs({ initialDoc: 'payment_request' })}>ใบแจ้งชำระเงิน</button>
                )}
                {booking.sessions.length > 0 && (
                  <button type="button" className="chip-toggle" onClick={() => setDocs({ initialDoc: 'schedule' })}>ตารางคิววันงาน</button>
                )}
                {booking.deliverables.length > 0 && (
                  <button type="button" className="chip-toggle" onClick={() => setDocs({ initialDoc: 'delivery' })}>สรุปการส่งงาน</button>
                )}
              </div>
              <button type="button" className="btn-secondary justify-start" onClick={() => setDialog({ kind: 'line' })}>
                <MessageCircle {...ICON_SM} />
                ข้อความส่ง LINE ลูกค้า
              </button>
              {portalPath && (
                <>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <button type="button" className="btn-secondary justify-start" onClick={copyPortalLink}>
                      <Link2 {...ICON_SM} />
                      คัดลอกลิงก์ติดตามงาน
                    </button>
                    <a href={portalPath} target="_blank" rel="noopener noreferrer" className="btn-icon h-11 w-11" aria-label="เปิดหน้าติดตามงานที่ลูกค้าเห็น">
                      <ExternalLink {...ICON_SM} />
                    </a>
                  </div>
                  <button type="button" className="btn-ghost justify-start text-sm" onClick={() => setDialog({ kind: 'action', action: 'rotate' })}>
                    <RotateCcw {...ICON_SM} />
                    เปลี่ยนลิงก์ใหม่ (ลิงก์เดิมใช้ไม่ได้)
                  </button>
                </>
              )}
              <p className="text-xs text-gray-500">
                {settings.portal_enabled
                  ? 'ลิงก์ติดตามงาน: คู่บ่าวสาวดูกำหนดการ ยอดชำระ สแกนพร้อมเพย์ และรับลิงก์งานที่ส่งได้เอง (ไม่ต้องเข้าสู่ระบบ)'
                  : 'ลิงก์ติดตามงานของลูกค้าปิดอยู่ — เปิดได้ที่ ตั้งค่าร้าน → ลิงก์ลูกค้า (ผู้จัดการ)'}
              </p>
            </div>
          </section>

          <div className="order-10"><PackageCard booking={booking} /></div>
          <div className="order-11"><DetailsCard booking={booking} /></div>
        </div>
      </div>

      {/* ===== ป็อปอัป ===== */}
      {dialog?.kind === 'pay' && (
        <PaymentDialog
          booking={booking}
          settings={settings}
          canManage={canManage}
          initialKind={dialog.payKind}
          onClose={closeDialog}
          onApplied={b => applied(b)}
          reload={reload}
          onOpenReceipt={p => { setDialog(null); setDocs({ initialDoc: 'receipt', paymentId: p.id }) }}
        />
      )}
      {dialog?.kind === 'charge' && (
        <ChargeDialog booking={booking} settings={settings} onClose={closeDialog} onApplied={(b, msg) => applied(b, msg)} reload={reload} />
      )}
      {dialog?.kind === 'hold' && (
        <HoldDialog
          booking={booking}
          mode={dialog.mode}
          defaultHours={settings.hold_hours}
          onClose={closeDialog}
          onApplied={(b, msg) => applied(b, msg)}
          reload={reload}
        />
      )}
      {dialog?.kind === 'followup' && (
        <FollowupDialog booking={booking} onClose={closeDialog} onApplied={(b, msg) => applied(b, msg)} reload={reload} />
      )}
      {dialog?.kind === 'installments' && (
        <InstallmentsDialog booking={booking} onClose={closeDialog} onApplied={(b, msg) => applied(b, msg)} reload={reload} />
      )}
      {dialog?.kind === 'deliverable' && (
        <DeliverableDialog
          booking={booking}
          item={dialog.item}
          presetStatus={dialog.preset}
          crew={crew ?? []}
          crewLoading={crewLoading}
          onClose={closeDialog}
          onApplied={(b, msg) => applied(b, msg)}
          reload={reload}
        />
      )}
      {dialog?.kind === 'line' && <LineMessageDialog booking={booking} settings={settings} onClose={closeDialog} />}
      {dialog?.kind === 'action' && (
        <BookingActionDialog
          action={dialog.action}
          booking={booking}
          onClose={closeDialog}
          onApplied={(b, msg) => applied(b, msg)}
          reload={reload}
        />
      )}
      {dialog?.kind === 'delete_deliverable' && (
        <ActionDialog
          booking={booking}
          title="ลบรายการส่งงาน"
          icon={<Trash2 {...ICON_SM} />}
          tone="err"
          confirmLabel="ลบรายการนี้"
          fn="wed_delete_deliverable"
          args={{ p_id: dialog.item.id }}
          verify={fresh => !fresh.deliverables.some(x => x.id === dialog.item.id)}
          successMessage={() => `ลบ "${dialog.item.name}" แล้ว`}
          onClose={closeDialog}
          onApplied={(b, msg) => applied(b, msg)}
          reload={reload}
        >
          <p>ลบ &quot;{dialog.item.name}&quot; ออกจากงานนี้ — ลบแล้วกู้คืนไม่ได้ (ประวัติงานยังจดไว้)</p>
          {dialog.item.status === 'delivered' && <p className="text-amber-800 font-medium">รายการนี้ส่งลูกค้าแล้ว ลิงก์จะหายจากหน้าติดตามงานของลูกค้าด้วย</p>}
        </ActionDialog>
      )}
      {dialog?.kind === 'cancel' && (
        <ReasonDialog
          title="ยกเลิกงาน"
          subtitle={`${booking.booking_no} · ${booking.couple_names}`}
          icon={<Ban {...ICON_SM} />}
          label="เหตุผลที่ยกเลิก"
          quickReasons={CANCEL_REASONS}
          confirmLabel="ยืนยันยกเลิกงาน"
          onClose={closeDialog}
          onSubmit={reason => reasonWrite(
            'wed_cancel',
            { p_booking_id: booking.id, p_reason: reason },
            fresh => fresh.status === 'cancelled',
            'ยกเลิกงานแล้ว — วันงานว่างให้งานอื่นจองได้',
          )}
        >
          <p>คิวของวันงานจะถูกปล่อยทันที ทีมงานที่จัดไว้ไม่ถูกนับว่าติดงานนี้อีก</p>
          {m.paid > EPS && (
            <div className="alert-warn">
              <AlertTriangle {...ICON_SM} />
              <p className="min-w-0">
                เงินที่ชำระไว้ {baht(m.paid)} ยังอยู่ในงานนี้ (ถือเป็นมัดจำที่ริบ) — ถ้าจะคืนลูกค้า ให้กด &quot;คืนเงิน&quot; หลังยกเลิก
              </p>
            </div>
          )}
        </ReasonDialog>
      )}
      {dialog?.kind === 'postpone' && (
        <ReasonDialog
          title="เลื่อนงาน"
          subtitle={`${booking.booking_no} · ${booking.couple_names}`}
          icon={<CalendarX {...ICON_SM} />}
          tone="primary"
          label="เหตุผลที่เลื่อน"
          quickReasons={POSTPONE_REASONS}
          confirmLabel="บันทึกเลื่อนงาน"
          onClose={closeDialog}
          onSubmit={reason => reasonWrite(
            'wed_postpone',
            { p_booking_id: booking.id, p_reason: reason },
            fresh => fresh.status === 'postponed',
            'บันทึกเลื่อนงานแล้ว — แก้วันงานใหม่แล้วกด "กลับมาจัดงาน"',
          )}
        >
          <p>วันงานเดิมจะว่างให้งานอื่นจองได้ · เงินที่รับไว้คงอยู่ครบ</p>
          <p>ได้วันใหม่แล้ว: กด &quot;แก้ไขงาน&quot; ใส่วันที่ใหม่ของทุกคิว แล้วกด &quot;กลับมาจัดงาน&quot; งานจะกลับเป็นสถานะเดิม</p>
        </ReasonDialog>
      )}
      {dialog?.kind === 'void_payment' && (
        <ReasonDialog
          title="ยกเลิกรายการเงิน"
          subtitle={`${dialog.payment.receipt_no ?? ''} · ${WED_PAYMENT_KIND_LABELS[dialog.payment.kind]} ${baht(dialog.payment.amount)}`}
          icon={<Ban {...ICON_SM} />}
          label="เหตุผลที่ยกเลิก"
          quickReasons={VOID_PAYMENT_REASONS}
          confirmLabel="ยืนยันยกเลิกรายการ"
          onClose={closeDialog}
          onSubmit={reason => {
            const pid = dialog.payment.id
            return reasonWrite(
              'wed_void_payment',
              { p_payment_id: pid, p_reason: reason },
              fresh => fresh.payments.some(p => p.id === pid && !!p.voided_at),
              'ยกเลิกรายการเงินแล้ว',
            )
          }}
        >
          <p>รายการจะไม่ถูกลบ แต่ไม่นับในยอดเงินอีก (ใบเสร็จที่ส่งไปแล้วถือว่าใช้ไม่ได้)</p>
          {!canManage && <p className="text-xs text-gray-500">พนักงานยกเลิกได้เฉพาะรายการที่บันทึกวันนี้</p>}
        </ReasonDialog>
      )}
      {dialog?.kind === 'void_charge' && (
        <ReasonDialog
          title="ยกเลิกค่าใช้จ่าย"
          subtitle={`${dialog.charge.description} ${baht(dialog.charge.amount)}`}
          icon={<Ban {...ICON_SM} />}
          label="เหตุผลที่ยกเลิก"
          quickReasons={VOID_CHARGE_REASONS}
          confirmLabel="ยืนยันยกเลิก"
          onClose={closeDialog}
          onSubmit={reason => {
            const cid = dialog.charge.id
            return reasonWrite(
              'wed_void_charge',
              { p_charge_id: cid, p_reason: reason },
              fresh => fresh.charges.some(c => c.id === cid && !!c.voided_at),
              'ยกเลิกค่าใช้จ่ายแล้ว',
            )
          }}
        />
      )}

      {/* ===== ศูนย์เอกสาร (รูปส่ง LINE / พิมพ์ A4 / สัญญาจ้าง) ===== */}
      {docs && (
        <DocumentCenter
          booking={booking}
          settings={settings}
          initialDoc={docs.initialDoc}
          paymentId={docs.paymentId}
          sessionId={docs.sessionId}
          onClose={() => setDocs(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ป็อปอัปยืนยันการเปลี่ยนสถานะ (ตั้งค่าตามชนิด)
// ---------------------------------------------------------------------------
function BookingActionDialog({
  action,
  booking,
  onClose,
  onApplied,
  reload,
}: {
  action: ActionKind
  booking: WedBooking
  onClose(): void
  onApplied(b: WedBooking, message: string): void
  reload(): Promise<WedBooking | null>
}) {
  const r = booking.actions.block_reasons
  const m = booking.money
  const id = booking.id
  const common = { booking, onClose, onApplied, reload }
  switch (action) {
    case 'confirm': {
      const warn = r.confirm_warning
      return (
        <ActionDialog
          {...common}
          title="ยืนยันงาน"
          icon={<CalendarCheck {...ICON_SM} />}
          confirmLabel={warn ? 'ยืนยันงาน (ยังไม่ได้มัดจำครบ)' : 'ยืนยันงาน'}
          fn="wed_confirm"
          args={{ p_booking_id: id }}
          supportsForce
          // ไม่ส่ง force ตั้งแต่ครั้งแรก: ล็อกคิวอาจหมดเวลาระหว่างเปิดหน้า (wed_confirm คืนเป็นสอบถามก่อน) แล้วเซิร์ฟเวอร์ตรวจคิวเต็มใหม่
          // — force ครั้งแรกจะข้ามการตรวจนั้นเงียบ ๆ (ยืนยันเกินคิวโดยไม่มีใครเห็น)
          // ผู้ใช้เห็นคำเตือนมัดจำแล้ว → เซิร์ฟเวอร์ตอบ hint มัดจำ = ส่งซ้ำแบบบังคับให้เอง ; ตอบ hint คิวเต็ม = ถามผู้ใช้ก่อน
          ackHint={warn ? 'deposit' : undefined}
          warning={warn}
          verify={fresh => statusAtLeast(fresh.status, 'confirmed')}
          successMessage={already => (already ? 'งานนี้ยืนยันไว้แล้ว' : 'ยืนยันงานแล้ว — สร้างรายการส่งงานตามแพ็กเกจให้แล้ว')}
        >
          <p>งาน {booking.booking_no} ของ {booking.couple_names} จะเป็น &quot;ยืนยันแล้ว&quot; และกันคิววันงานไว้ถาวร (ไม่หมดเวลาแบบล็อกคิว)</p>
          {m.deposit_met
            ? <p className="text-green-800 font-medium">ได้รับมัดจำครบแล้ว ({baht(m.paid)} จากมัดจำ {baht(m.deposit_required)})</p>
            : <p className="text-amber-800 font-medium">ชำระแล้ว {baht(m.paid)} · มัดจำ {baht(m.deposit_required)}</p>}
        </ActionDialog>
      )
    }
    case 'mark_shot': {
      const warn = r.mark_shot_warning
      return (
        <ActionDialog
          {...common}
          title="บันทึกถ่ายเสร็จ"
          icon={<Camera {...ICON_SM} />}
          confirmLabel={warn ? 'บันทึกถ่ายเสร็จ (บังคับ)' : 'บันทึกถ่ายเสร็จ'}
          fn="wed_mark_shot"
          args={{ p_booking_id: id }}
          supportsForce
          forceFirst={!!warn}
          warning={warn ? `${warn} — กดยืนยันแล้วคิวที่ยังไม่ถึงวันจะถูกบันทึกเป็น "ถ่ายแล้ว" ด้วย` : undefined}
          verify={fresh => statusAtLeast(fresh.status, 'in_production')}
          successMessage={already => (already ? 'งานนี้บันทึกถ่ายเสร็จไว้แล้ว' : 'บันทึกถ่ายเสร็จแล้ว — ติดตามงานตัดต่อได้ที่ "งานที่ต้องส่ง"')}
        >
          <p>งานจะเป็น &quot;ถ่ายเสร็จ รอส่งงาน&quot; คิวที่ถึงวันแล้วถูกบันทึกเป็นถ่ายแล้ว และเริ่มนับกำหนดส่งงาน</p>
        </ActionDialog>
      )
    }
    case 'mark_delivered': {
      const open = booking.deliverables_summary.open
      return (
        <ActionDialog
          {...common}
          title="บันทึกส่งงานแล้ว"
          icon={<Send {...ICON_SM} />}
          confirmLabel="บันทึกส่งงานแล้ว"
          fn="wed_mark_delivered"
          args={{ p_booking_id: id }}
          warning={open > 0 ? `ยังมีรายการส่งงานที่ยังไม่เป็น "ส่งแล้ว" ${open} รายการ — ปกติระบบเปลี่ยนเป็นส่งงานแล้วให้เองเมื่อทุกรายการส่งแล้ว` : undefined}
          verify={fresh => statusAtLeast(fresh.status, 'delivered')}
          successMessage={already => (already ? 'งานนี้บันทึกส่งงานไว้แล้ว' : 'บันทึกส่งงานแล้ว')}
        >
          <p>ใช้เมื่อส่งงานครบแล้วนอกระบบ (เช่น ส่งไฟล์ให้ลูกค้าโดยตรง) — ยอดค้างรับชำระต่อได้ แล้วจึงปิดงาน</p>
        </ActionDialog>
      )
    }
    case 'complete': {
      const warn = booking.status === 'in_production' ? r.complete_warning : undefined
      return (
        <ActionDialog
          {...common}
          title="ปิดงาน"
          icon={<CheckCircle2 {...ICON_SM} />}
          confirmLabel={warn ? 'ปิดงาน (บังคับ)' : 'ปิดงาน'}
          fn="wed_complete"
          args={{ p_booking_id: id }}
          supportsForce
          forceFirst={!!warn}
          warning={warn}
          verify={fresh => fresh.status === 'completed'}
          successMessage={already => (already ? 'งานนี้ปิดไว้แล้ว' : 'ปิดงานเรียบร้อย')}
        >
          <p>ยอดชำระลงตัวแล้ว — ปิดงานแล้วรับเงิน/คืนเงิน/ยกเลิกรายการเงินไม่ได้อีก (ผู้จัดการเปิดงานใหม่ได้)</p>
        </ActionDialog>
      )
    }
    case 'reopen':
      return (
        <ActionDialog
          {...common}
          title="เปิดงานใหม่"
          icon={<Unlock {...ICON_SM} />}
          confirmLabel="เปิดงานใหม่"
          fn="wed_reopen"
          args={{ p_booking_id: id }}
          verify={fresh => fresh.status === 'delivered'}
          successMessage={already => (already ? 'งานนี้เปิดอยู่แล้ว' : 'เปิดงานใหม่แล้ว (สถานะ ส่งงานแล้ว)')}
        >
          <p>งานจะกลับเป็น &quot;ส่งงานแล้ว&quot; เพื่อแก้ยอด คืนเงิน หรือยกเลิกรายการเงิน แล้วปิดงานอีกครั้ง</p>
        </ActionDialog>
      )
    case 'release':
      return (
        <ActionDialog
          {...common}
          title="ปล่อยคิว"
          icon={<Undo2 {...ICON_SM} />}
          confirmLabel="ปล่อยคิว"
          fn="wed_release_hold"
          args={{ p_booking_id: id }}
          verify={fresh => fresh.status === 'inquiry'}
          successMessage={already => (already ? 'งานนี้เป็นสอบถามอยู่แล้ว' : 'ปล่อยคิวแล้ว — กลับเป็นสอบถาม')}
        >
          <p>งานจะกลับเป็น &quot;สอบถาม&quot; วันงานว่างให้งานอื่นจองได้ (ข้อมูลงานและเงินที่รับไว้ยังอยู่ครบ)</p>
        </ActionDialog>
      )
    case 'resume':
      return (
        <ActionDialog
          {...common}
          title="กลับมาจัดงาน"
          icon={<PlayCircle {...ICON_SM} />}
          confirmLabel="กลับมาจัดงาน"
          fn="wed_resume"
          args={{ p_booking_id: id }}
          supportsForce
          verify={fresh => fresh.status !== 'postponed' && statusAtLeast(fresh.status, 'hold')}
          successMessage={already => (already ? 'งานนี้กลับมาจัดแล้ว' : 'กลับมาจัดงานแล้ว')}
        >
          <p>
            งานจะกลับเป็นสถานะก่อนเลื่อน ({booking.status_before_postpone === 'hold' ? 'ล็อกคิว รอมัดจำ' : 'ยืนยันแล้ว'}) ตามวันที่ของคิวงานตอนนี้:
          </p>
          <p className="font-medium text-gray-900">{eventDatesText(booking)}</p>
          <p className="text-xs text-gray-500">ยังไม่ได้แก้วันที่ → กด &quot;ไม่ทำ&quot; แล้วไปที่ &quot;แก้ไขงาน&quot; ก่อน</p>
        </ActionDialog>
      )
    case 'rotate': {
      const old = booking.public_token
      return (
        <ActionDialog
          {...common}
          title="เปลี่ยนลิงก์ติดตามงาน"
          icon={<RotateCcw {...ICON_SM} />}
          tone="err"
          confirmLabel="เปลี่ยนลิงก์ใหม่"
          fn="wed_rotate_token"
          args={{ p_booking_id: id }}
          verify={fresh => fresh.public_token !== old}
          successMessage={() => 'เปลี่ยนลิงก์แล้ว — คัดลอกลิงก์ใหม่ส่งให้ลูกค้า'}
        >
          <p>ลิงก์เดิมที่ส่งให้ลูกค้าไปแล้วจะเปิดไม่ได้ทันที — ใช้เมื่อลิงก์หลุดไปถึงคนอื่น</p>
        </ActionDialog>
      )
    }
    case 'reset_installments':
      return (
        <ActionDialog
          {...common}
          title="กลับไปใช้งวดมาตรฐาน"
          icon={<RotateCcw {...ICON_SM} />}
          confirmLabel="ใช้งวดมาตรฐาน"
          fn="wed_reset_installments"
          args={{ p_booking_id: id }}
          verify={fresh => !fresh.installments_custom}
          successMessage={() => 'ใช้งวดมาตรฐาน (มัดจำ + ยอดคงเหลือ) แล้ว'}
        >
          <p>งวดที่แก้เองจะถูกแทนด้วย 2 งวดมาตรฐาน: มัดจำ {baht(m.deposit_required)} และยอดคงเหลือ (ครบกำหนดตามวันชำระยอดคงเหลือ)</p>
        </ActionDialog>
      )
  }
}

// ---------------------------------------------------------------------------
// ขั้นต่อไป (สรุปว่าต้องทำอะไรต่อ)
// ---------------------------------------------------------------------------
function hoursLeft(iso: string | null, now: number | null): string {
  if (!iso || now === null) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const mins = Math.round((t - now) / 60000)
  if (mins <= 0) return 'หมดเวลาแล้ว (ยังไม่มีการชำระ = ระบบปล่อยคิวเมื่อมีการเปิดดูครั้งถัดไป)'
  if (mins < 60) return `เหลืออีก ${mins} นาที`
  const h = Math.floor(mins / 60)
  return h < 48 ? `เหลืออีก ${h} ชม. ${mins % 60} นาที` : `เหลืออีก ${Math.floor(h / 24)} วัน`
}

function untilText(todayKey: string, day: string | null): string {
  if (!todayKey || !day) return ''
  const n = daysBetweenKeys(todayKey, day)
  if (!Number.isFinite(n)) return ''
  if (n === 0) return 'วันนี้'
  if (n === 1) return 'พรุ่งนี้'
  return n > 0 ? `อีก ${n} วัน` : `ผ่านมาแล้ว ${-n} วัน`
}

function NextStep({ booking: b, now, todayKey }: { booking: WedBooking; now: number | null; todayKey: string }) {
  const m = b.money
  const r = b.actions.block_reasons
  const dueLine = m.due > EPS
    ? `ค้างชำระ ${baht(m.due)}${b.next_due ? ` · งวดถัดไป ${b.next_due.label} ${baht(b.next_due.amount)}${b.next_due.due_date ? ` ภายใน ${formatThaiDate(b.next_due.due_date)}` : ''}${b.next_due.overdue ? ' (เลยกำหนด)' : ''}` : ''}`
    : m.due < -EPS ? `รับเงินเกิน ${baht(-m.due)} — ต้องคืนลูกค้า` : 'ชำระครบแล้ว'
  const until = untilText(todayKey, b.first_date)
  let box: { cls: string; icon: ReactNode; title: string; lines: string[] }
  switch (b.status) {
    case 'inquiry':
      box = {
        cls: 'alert-info',
        icon: <Info {...ICON_SM} />,
        title: 'สอบถาม — ยังไม่ได้ล็อกคิว',
        lines: [
          b.first_date ? `วันงาน ${eventDatesText(b)}${until ? ` (${until})` : ''} — งานอื่นยังจองวันนี้ได้` : 'ยังไม่ระบุวันงาน',
          r.hold ? `ล็อกคิว: ${r.hold}` : 'ลูกค้าตกลงแล้ว → "ล็อกคิว" ระหว่างรอมัดจำ หรือ "ยืนยันงาน" เมื่อได้มัดจำ',
          m.deposit_met ? `ได้รับมัดจำครบแล้ว (${baht(m.paid)})` : `มัดจำ ${baht(m.deposit_required)}${m.paid > EPS ? ` · ชำระแล้ว ${baht(m.paid)}` : ''}`,
        ],
      }
      break
    case 'hold':
      box = {
        cls: 'alert-warn',
        icon: <Hourglass {...ICON_SM} />,
        title: 'ล็อกคิว รอมัดจำ',
        lines: [
          b.hold_until ? `ล็อกถึง ${formatThaiDateTime(b.hold_until)}${now !== null ? ` · ${hoursLeft(b.hold_until, now)}` : ''}` : '',
          `วันงาน ${eventDatesText(b)}${until ? ` (${until})` : ''}`,
          m.deposit_met ? 'ได้รับมัดจำครบแล้ว — กด "ยืนยันงาน"' : `ยังขาดมัดจำ ${baht(depositShort(b))} (มัดจำ ${baht(m.deposit_required)})`,
        ],
      }
      break
    case 'confirmed':
      box = {
        cls: 'alert-info',
        icon: <CalendarClock {...ICON_SM} />,
        title: `ยืนยันแล้ว · วันงาน ${eventDatesText(b)}${until ? ` (${until})` : ''}`,
        lines: [
          dueLine,
          m.balance_due_date && m.due > EPS ? `ชำระยอดคงเหลือภายใน ${formatThaiDate(m.balance_due_date)}` : '',
          r.mark_shot_warning ? '' : 'ถ่ายครบทุกคิวแล้ว → กด "บันทึกถ่ายเสร็จ"',
        ],
      }
      break
    case 'in_production': {
      const s = b.deliverables_summary
      const overdue = b.deliverables.filter(d => d.overdue).length
      box = {
        cls: overdue > 0 ? 'alert-warn' : 'alert-info',
        icon: <Camera {...ICON_SM} />,
        title: 'ถ่ายเสร็จ รอส่งงาน',
        lines: [
          s.total > 0 ? `ส่งแล้ว ${s.delivered}/${s.total} รายการ${overdue > 0 ? ` · เลยกำหนด ${overdue} รายการ` : ''}` : 'ยังไม่มีรายการส่งงาน — เพิ่มได้ที่ "งานที่ต้องส่ง"',
          'ทุกรายการ "ส่งแล้ว" → งานเปลี่ยนเป็นส่งงานแล้วเอง',
          dueLine,
        ],
      }
      break
    }
    case 'delivered':
      box = b.actions.can_complete
        ? { cls: 'alert-ok', icon: <CheckCircle2 {...ICON_SM} />, title: 'ส่งงานครบ ยอดลงตัว — กด "ปิดงาน" ได้เลย', lines: [] }
        : { cls: 'alert-warn', icon: <Wallet {...ICON_SM} />, title: 'ส่งงานแล้ว รอเคลียร์เงิน', lines: [r.complete || dueLine] }
      break
    case 'completed':
      box = {
        cls: 'alert-ok',
        icon: <CheckCircle2 {...ICON_SM} />,
        title: `ปิดงานแล้ว${b.completed_at ? ` เมื่อ ${formatThaiDateTime(b.completed_at)}` : ''}`,
        lines: [],
      }
      break
    case 'postponed':
      box = {
        cls: 'alert-warn',
        icon: <CalendarX {...ICON_SM} />,
        title: 'เลื่อนงาน — รอวันใหม่',
        lines: [
          b.postpone_reason ? `เหตุผล: ${b.postpone_reason}` : '',
          'ได้วันใหม่แล้ว: "แก้ไขงาน" ใส่วันที่ของทุกคิว → "กลับมาจัดงาน"',
          m.paid > EPS ? `เงินที่รับไว้ ${baht(m.paid)} ยังอยู่ครบ` : '',
        ],
      }
      break
    case 'cancelled':
      box = {
        cls: m.paid > EPS ? 'alert-warn' : 'alert-info',
        icon: <Ban {...ICON_SM} />,
        title: `ยกเลิกแล้ว${b.cancelled_at ? ` · ${formatThaiDateTime(b.cancelled_at)}` : ''}`,
        lines: [
          b.cancel_reason ? `เหตุผล: ${b.cancel_reason}` : '',
          m.paid > EPS ? `เงินที่ชำระไว้ ${baht(m.paid)} (มัดจำที่ริบ) — ถ้าคืนลูกค้า กด "คืนเงิน"` : '',
        ],
      }
      break
  }
  const lines = box.lines.filter(l => l.trim() !== '')
  return (
    <div className={box.cls}>
      {box.icon}
      <div className="min-w-0 space-y-0.5">
        <p className="font-semibold break-words">{box.title}</p>
        {lines.map((l, i) => <p key={i} className="break-words">{l}</p>)}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ติดตามลูกค้า (วัน + เรื่อง) — ถึงกำหนดแล้วขึ้นเป็นสีเตือน
// ---------------------------------------------------------------------------
function FollowupPanel({ booking: b, todayKey, onEdit }: { booking: WedBooking; todayKey: string; onEdit?: () => void }) {
  if (!b.followup_date && !onEdit) return null
  const due = !!b.followup_date && todayKey !== '' && b.followup_date <= todayKey
  return (
    <div className={`panel flex flex-wrap items-center gap-3 px-3.5 py-2.5 ${due ? 'border-amber-300 bg-amber-50' : ''}`}>
      <BellRing {...ICON_SM} className={due ? 'text-amber-800' : 'text-gray-500'} />
      <div className="min-w-0 flex-1 text-sm">
        {b.followup_date ? (
          <>
            <p className={`font-medium ${due ? 'text-amber-900' : 'text-gray-900'}`}>
              ติดตามลูกค้า {formatThaiDayLong(b.followup_date)}{due ? ' — ถึงกำหนดแล้ว' : ''}
            </p>
            {b.followup_note && <p className="text-gray-700 break-words whitespace-pre-line">{b.followup_note}</p>}
          </>
        ) : (
          <p className="text-gray-600">ยังไม่ได้ตั้งวันติดตามลูกค้า</p>
        )}
      </div>
      {onEdit && (
        <button type="button" className="btn-soft min-h-[44px] px-3 text-sm" onClick={onEdit}>
          {b.followup_date ? 'แก้' : 'ตั้งวันติดตาม'}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ปุ่มการกระทำตามสถานะ: ปุ่มหลัก 1 ปุ่ม (ขั้นต่อไป) + ปุ่มรอง + ปุ่มเงิน + ปุ่มยกเลิก
// ---------------------------------------------------------------------------
// href = ลิงก์ไปหน้าอื่น (แก้ไขงาน) แทนปุ่มเปิดป็อปอัป
type Btn = { key: string; label: string; icon: JSX.Element; onClick?: () => void; href?: string }

function BtnView({ b, className }: { b: Btn; className: string }) {
  if (b.href) {
    return (
      <Link href={b.href} className={className}>
        {b.icon}
        {b.label}
      </Link>
    )
  }
  return (
    <button type="button" className={className} onClick={b.onClick}>
      {b.icon}
      {b.label}
    </button>
  )
}

function ActionButtons({
  booking: b,
  payKinds,
  canManage,
  editHref,
  onOpen,
}: {
  booking: WedBooking
  payKinds: WedPaymentKind[]
  canManage: boolean
  editHref?: string
  onOpen(d: DialogState): void
}) {
  const a = b.actions
  const main: Btn[] = []
  const secondary: Btn[] = []
  const danger: Btn[] = []
  const act = (action: ActionKind) => () => onOpen({ kind: 'action', action })

  const confirm: Btn = { key: 'confirm', label: 'ยืนยันงาน', icon: <CalendarCheck {...ICON_SM} />, onClick: act('confirm') }
  const hold: Btn = { key: 'hold', label: 'ล็อกคิว รอมัดจำ', icon: <Lock {...ICON_SM} />, onClick: () => onOpen({ kind: 'hold', mode: 'hold' }) }
  if (b.status === 'inquiry') {
    // ได้มัดจำแล้ว = ยืนยันเลย ; ยังไม่ได้ = ล็อกคิวก่อน
    if (a.can_confirm && (b.money.deposit_met || !a.can_hold)) main.push(confirm)
    if (a.can_hold) (main.length ? secondary : main).push(hold)
    if (a.can_confirm && !main.includes(confirm)) secondary.push(confirm)
  } else if (a.can_confirm) {
    main.push(confirm)
  }
  if (a.can_mark_shot) main.push({ key: 'shot', label: 'บันทึกถ่ายเสร็จ', icon: <Camera {...ICON_SM} />, onClick: act('mark_shot') })
  if (a.can_mark_delivered) main.push({ key: 'delivered', label: 'บันทึกส่งงานแล้ว', icon: <Send {...ICON_SM} />, onClick: act('mark_delivered') })
  if (a.can_complete) main.push({ key: 'complete', label: 'ปิดงาน', icon: <CheckCircle2 {...ICON_SM} />, onClick: act('complete') })
  // ถ่ายเสร็จแต่ยังไม่บันทึกส่งงาน + ยอดลงตัว → ปิดงานแบบบังคับได้ (มีคำเตือน)
  if (b.status === 'in_production' && Math.abs(b.money.due) < EPS && b.actions.block_reasons.complete_warning) {
    secondary.push({ key: 'complete_force', label: 'ปิดงาน (ยังไม่บันทึกส่งงาน)', icon: <CheckCircle2 {...ICON_SM} />, onClick: act('complete') })
  }
  if (a.can_resume) main.push({ key: 'resume', label: 'กลับมาจัดงาน', icon: <PlayCircle {...ICON_SM} />, onClick: act('resume') })
  // ยังไม่มีวันงาน (สอบถาม) / เลื่อนงานอยู่ → ทางลัดไปใส่วันที่ในหน้าแก้ไขงาน (ล็อกคิว/กลับมาจัดงานต้องมีวันที่ก่อน)
  if (editHref && b.status === 'inquiry' && !b.first_date) {
    main.push({ key: 'dates', label: 'ใส่วันงาน', icon: <CalendarClock {...ICON_SM} />, href: editHref })
  }
  if (editHref && b.status === 'postponed') {
    secondary.push({ key: 'dates', label: 'แก้วันงานใหม่', icon: <CalendarClock {...ICON_SM} />, href: editHref })
  }

  if (a.can_extend_hold) secondary.push({ key: 'extend', label: 'ต่อเวลาล็อกคิว', icon: <Hourglass {...ICON_SM} />, onClick: () => onOpen({ kind: 'hold', mode: 'extend' }) })
  if (a.can_release) secondary.push({ key: 'release', label: 'ปล่อยคิว', icon: <Undo2 {...ICON_SM} />, onClick: act('release') })
  if (a.can_add_charge) secondary.push({ key: 'charge', label: 'เพิ่มค่าใช้จ่าย', icon: <Wallet {...ICON_SM} />, onClick: () => onOpen({ kind: 'charge' }) })
  if (a.can_postpone) secondary.push({ key: 'postpone', label: 'เลื่อนงาน', icon: <CalendarX {...ICON_SM} />, onClick: () => onOpen({ kind: 'postpone' }) })
  if (a.can_reopen && canManage) secondary.push({ key: 'reopen', label: 'เปิดงานใหม่', icon: <Unlock {...ICON_SM} />, onClick: act('reopen') })

  if (a.can_cancel) danger.push({ key: 'cancel', label: 'ยกเลิกงาน', icon: <Ban {...ICON_SM} />, onClick: () => onOpen({ kind: 'cancel' }) })

  const primary = main[0]
  const rest = [...main.slice(1), ...secondary]
  const dueNow = amountDueNow(b)
  const payLabel: Record<WedPaymentKind, string> = {
    payment: dueNow > EPS && dueNow < b.money.due - EPS
      ? `รับชำระ · ${b.next_due?.label || 'งวดถัดไป'} ${baht(dueNow)}`
      : `รับชำระ${b.money.due > EPS ? ` ${baht(b.money.due)}` : ''}`,
    refund: b.money.due < -EPS ? `คืนเงินที่รับเกิน ${baht(-b.money.due)}` : 'คืนเงิน',
  }

  if (!primary && rest.length === 0 && payKinds.length === 0 && danger.length === 0) {
    return <p className="text-sm text-gray-500">ไม่มีสิ่งที่ต้องทำกับงานนี้แล้ว</p>
  }

  return (
    <div className="space-y-3">
      {primary && (
        <BtnView b={primary} className="btn-primary w-full text-base" />
      )}
      {rest.length > 0 && (
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
          {rest.map(x => <BtnView key={x.key} b={x} className="btn-secondary" />)}
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
          {danger.map(x => (
            <button key={x.key} type="button" className="btn-danger-soft flex-1 min-w-[150px]" onClick={x.onClick}>
              {x.icon}
              {x.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ข้อมูลงาน (เวลาสถานะ / ผู้สร้าง / หมายเหตุ / มู้ดบอร์ด)
// ---------------------------------------------------------------------------
function DetailsCard({ booking: b }: { booking: WedBooking }) {
  const rows: { label: string; value: string }[] = []
  if (b.source) rows.push({ label: 'ช่องทาง', value: wedSourceLabel(b.source) })
  rows.push({ label: 'สร้างเมื่อ', value: `${formatThaiDateTime(b.created_at)}${b.created_by_name ? ` · ${b.created_by_name}` : ''}` })
  if (b.status === 'hold' && b.hold_until) rows.push({ label: 'ล็อกคิวถึง', value: formatThaiDateTime(b.hold_until) })
  if (b.confirmed_at) rows.push({ label: 'ยืนยันเมื่อ', value: formatThaiDateTime(b.confirmed_at) })
  if (b.shot_at) rows.push({ label: 'ถ่ายเสร็จเมื่อ', value: formatThaiDateTime(b.shot_at) })
  if (b.delivered_at) rows.push({ label: 'ส่งงานเมื่อ', value: formatThaiDateTime(b.delivered_at) })
  if (b.completed_at) rows.push({ label: 'ปิดงานเมื่อ', value: formatThaiDateTime(b.completed_at) })
  if (b.postponed_at) rows.push({ label: 'เลื่อนงานเมื่อ', value: formatThaiDateTime(b.postponed_at) })
  if (b.cancelled_at) rows.push({ label: 'ยกเลิกเมื่อ', value: formatThaiDateTime(b.cancelled_at) })
  return (
    <section className="card" aria-labelledby="wb-details">
      <div className="card-header">
        <h2 id="wb-details" className="section-title">
          <Info {...ICON} />
          ข้อมูลงาน
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
        {b.mood_link && (
          <a href={b.mood_link} target="_blank" rel="noopener noreferrer" className="btn-secondary w-full justify-start text-sm">
            <ExternalLink {...ICON_SM} />
            เปิดมู้ดบอร์ด / แรงบันดาลใจของลูกค้า
          </a>
        )}
        {b.customer_note && (
          <div className="panel px-3 py-2 text-sm">
            <p className="text-xs font-medium text-gray-600">ความต้องการของลูกค้า</p>
            <p className="whitespace-pre-line break-words text-gray-900">{b.customer_note}</p>
          </div>
        )}
        {b.note && (
          <div className="panel px-3 py-2 text-sm">
            <p className="text-xs font-medium text-gray-600">หมายเหตุภายในร้าน</p>
            <p className="whitespace-pre-line break-words text-gray-900">{b.note}</p>
          </div>
        )}
        {b.cancel_reason && <p className="text-sm text-red-700 break-words">เหตุผลยกเลิก: {b.cancel_reason}</p>}
        {b.postpone_reason && b.status === 'postponed' && <p className="text-sm text-amber-800 break-words">เหตุผลที่เลื่อน: {b.postpone_reason}</p>}
      </div>
    </section>
  )
}
