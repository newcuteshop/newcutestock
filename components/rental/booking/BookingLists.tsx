'use client'
// รายการเงิน · ค่าปรับ/ค่าใช้จ่าย · ประวัติการจอง ของหน้ารายละเอียดการจอง
// ปุ่มในแถวเรียก callback ของหน้าแม่ (พิมพ์ใบเสร็จ / ยกเลิกรายการ / ตรวจสลิป) — สิทธิ์ยกเลิกหน้าแม่ตัดสิน
import clsx from 'clsx'
import { ArrowDownLeft, ArrowUpRight, BadgeCheck, Ban, History, Printer, Receipt, ReceiptText, Repeat } from 'lucide-react'
import { ICON, ICON_XS } from '@/components/theme/icons'
import { baht, formatThaiDate, formatThaiDateTime } from '@/lib/format'
import {
  CHARGE_KIND_LABELS, METHOD_LABELS, PAYMENT_KIND_LABELS, PAYMENT_STATUS_LABELS,
  type RentalBooking, type RentalCharge, type RentalPayment,
} from '@/lib/rental'
import { describeLog } from './rpc'

// ---------------------------------------------------------------------------
// รายการเงิน
// ---------------------------------------------------------------------------
function kindBadge(p: RentalPayment): { cls: string; icon: JSX.Element } {
  if (p.kind === 'payment' || p.kind === 'security_in') return { cls: 'badge-in', icon: <ArrowDownLeft {...ICON_XS} /> }
  if (p.kind === 'security_apply') return { cls: 'badge-adjust', icon: <Repeat {...ICON_XS} /> }
  return { cls: 'badge-out', icon: <ArrowUpRight {...ICON_XS} /> }
}

export function PaymentsCard({
  booking,
  canVoid,
  onPrint,
  onVoid,
  onReview,
}: {
  booking: RentalBooking
  canVoid(p: RentalPayment): boolean
  onPrint(p: RentalPayment, paper: '80' | 'a4'): void
  onVoid(p: RentalPayment): void
  onReview(p: RentalPayment): void
}) {
  const list = [...booking.payments].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
  return (
    <section className="card" aria-labelledby="bk-payments" id="bk-payments-section">
      <div className="card-header">
        <h2 id="bk-payments" className="section-title">
          <Receipt {...ICON} />
          รายการเงิน
          <span className="chip">{booking.payments.length}</span>
        </h2>
      </div>
      {list.length === 0 ? (
        <p className="empty-state">ยังไม่มีรายการเงิน</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {list.map(p => {
            const badge = kindBadge(p)
            const voided = !!p.voided_at
            const pending = p.status === 'pending_review'
            const rejected = p.status === 'rejected'
            const out = p.kind === 'refund' || p.kind === 'security_out'
            return (
              <li key={p.id} className={clsx('px-4 py-3 sm:px-5 space-y-2', (voided || rejected) && 'bg-gray-50')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={badge.cls}>{badge.icon}{PAYMENT_KIND_LABELS[p.kind]}</span>
                      {p.method !== 'none' && <span className="chip-outline">{METHOD_LABELS[p.method]}</span>}
                      {pending && <span className="badge-return">{PAYMENT_STATUS_LABELS.pending_review}</span>}
                      {rejected && <span className="badge-out">{PAYMENT_STATUS_LABELS.rejected}</span>}
                      {voided && <span className="badge-out">ยกเลิกแล้ว</span>}
                    </div>
                    <p className="text-xs text-gray-600">
                      {formatThaiDateTime(p.created_at)}
                      {p.receipt_no && <> · <span className="font-mono">{p.receipt_no}</span></>}
                      {p.created_by_name && <> · {p.created_by_name}</>}
                    </p>
                    {p.note && <p className="text-xs text-gray-700 break-words">หมายเหตุ: {p.note}</p>}
                    {rejected && p.reject_reason && <p className="text-xs text-red-700 break-words">เหตุผลที่ไม่อนุมัติ: {p.reject_reason}</p>}
                    {voided && <p className="text-xs text-red-700 break-words">ยกเลิกเมื่อ {formatThaiDateTime(p.voided_at)}{p.void_reason ? ` — ${p.void_reason}` : ''}</p>}
                  </div>
                  <span className={clsx('money shrink-0 text-base', voided || rejected ? 'text-gray-400 line-through' : out ? 'text-red-700' : 'text-gray-900')}>
                    {out ? '-' : ''}{baht(p.amount)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {pending && (
                    <button type="button" className="btn-soft min-h-[40px] px-3 text-sm" onClick={() => onReview(p)}>
                      <BadgeCheck {...ICON_XS} />
                      ตรวจสลิป
                    </button>
                  )}
                  {p.status === 'confirmed' && (
                    <>
                      <button type="button" className="btn-secondary min-h-[40px] px-3 text-sm" onClick={() => onPrint(p, '80')} aria-label={`พิมพ์ใบเสร็จ ${p.receipt_no ?? ''} ขนาด 80 มม.`}>
                        <Printer {...ICON_XS} />
                        80 มม.
                      </button>
                      <button type="button" className="btn-secondary min-h-[40px] px-3 text-sm" onClick={() => onPrint(p, 'a4')} aria-label={`พิมพ์ใบเสร็จ ${p.receipt_no ?? ''} ขนาด A4`}>
                        <Printer {...ICON_XS} />
                        A4
                      </button>
                    </>
                  )}
                  {!voided && p.status === 'confirmed' && canVoid(p) && (
                    <button type="button" className="btn-danger-soft min-h-[40px] px-3 text-sm" onClick={() => onVoid(p)}>
                      <Ban {...ICON_XS} />
                      ยกเลิกรายการ
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// ค่าปรับ / ค่าใช้จ่าย
// ---------------------------------------------------------------------------
export function ChargesCard({
  booking,
  canVoid,
  onVoid,
  onAdd,
}: {
  booking: RentalBooking
  canVoid: boolean
  onVoid(c: RentalCharge): void
  onAdd?: () => void
}) {
  if (booking.charges.length === 0 && !onAdd) return null
  const unitOf = (lineId: string | null) => booking.lines.find(l => l.id === lineId)?.unit_code ?? ''
  return (
    <section className="card" aria-labelledby="bk-charges">
      <div className="card-header">
        <h2 id="bk-charges" className="section-title">
          <ReceiptText {...ICON} />
          ค่าปรับ / ค่าใช้จ่าย
        </h2>
        {onAdd && (
          <button type="button" className="btn-soft min-h-[40px] px-3 text-sm" onClick={onAdd}>เพิ่ม</button>
        )}
      </div>
      {booking.charges.length === 0 ? (
        <p className="empty-state">ยังไม่มีค่าปรับหรือค่าใช้จ่ายเพิ่ม</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {booking.charges.map(c => {
            const voided = !!c.voided_at
            const unit = unitOf(c.line_id)
            return (
              <li key={c.id} className={clsx('px-4 py-3 sm:px-5', voided && 'bg-gray-50')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium text-gray-900 break-words">{c.description}</p>
                    <p className="text-xs text-gray-600">
                      {CHARGE_KIND_LABELS[c.kind]}{unit ? ` · ชิ้น ${unit}` : ''} · {formatThaiDateTime(c.created_at)}
                      {c.created_by_name ? ` · ${c.created_by_name}` : ''}
                    </p>
                    {voided && <p className="text-xs text-red-700 break-words">ยกเลิกแล้ว{c.void_reason ? ` — ${c.void_reason}` : ''}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className={clsx('money', voided ? 'text-gray-400 line-through' : 'text-gray-900')}>{baht(c.amount)}</span>
                    {!voided && canVoid && (
                      <button type="button" className="btn-danger-soft min-h-[40px] px-3 text-sm" onClick={() => onVoid(c)}>
                        <Ban {...ICON_XS} />
                        ยกเลิก
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// ประวัติการจอง
// ---------------------------------------------------------------------------
export function TimelineCard({ booking }: { booking: RentalBooking }) {
  return (
    <section className="card" aria-labelledby="bk-logs">
      <div className="card-header">
        <h2 id="bk-logs" className="section-title">
          <History {...ICON} />
          ประวัติการจอง
        </h2>
      </div>
      {booking.logs.length === 0 ? (
        <p className="empty-state">ยังไม่มีประวัติ</p>
      ) : (
        <ol className="px-4 py-3 sm:px-5">
          {booking.logs.map((log, i) => {
            const v = describeLog(log, baht, formatThaiDate)
            return (
              <li key={`${log.created_at}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
                {/* เส้นเชื่อมแนวตั้ง (ตกแต่ง) */}
                {i < booking.logs.length - 1 && (
                  <span aria-hidden="true" className="absolute left-[5px] top-4 bottom-0 w-px bg-gray-200" />
                )}
                <span aria-hidden="true" className={clsx('relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2', i === 0 ? 'border-brand-600 bg-brand-100' : 'border-gray-300 bg-white')} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">{v.label}</p>
                  {v.lines.map((line, j) => (
                    <p key={j} className="text-xs text-gray-700 break-words">{line}</p>
                  ))}
                  <p className="text-xs text-gray-500">
                    {formatThaiDateTime(log.created_at)}{log.actor_name ? ` · ${log.actor_name}` : ''}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
