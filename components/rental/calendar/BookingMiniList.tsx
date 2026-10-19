'use client'
// รายการการจองแบบย่อ (rental_today / rental_schedule) — แตะแถวเพื่อเปิดหน้ารายละเอียดการจอง
// ปุ่มโทรอยู่นอกลิงก์ของแถว (ห้ามซ้อนลิงก์ในลิงก์) · สีบอกสถานะต้องมีข้อความ/ไอคอนคู่เสมอ ไม่พึ่งสีอย่างเดียว
import Link from 'next/link'
import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, Hourglass, Phone } from 'lucide-react'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { bangkokTodayKey, baht, daysBetweenKeys, formatThaiDate } from '@/lib/format'
import { STATUS_CHIP, formatPhone, statusLabel, type RentalBookingMini } from '@/lib/rental'
import { bookingHref, telHref } from './rpc'
import { holdRemaining } from './useNow'

/** บริบทของรายการ — กำหนดบรรทัดรายละเอียดและสถานะ "ทำแล้ว" */
export type MiniKind = 'pickup' | 'return' | 'fitting' | 'overdue' | 'pending'

/** การจองนี้ "ทำเสร็จแล้ว" สำหรับรายการประเภทนั้นหรือยัง (รับชุดแล้ว / คืนชุดแล้ว) */
export function miniDone(kind: MiniKind, b: RentalBookingMini): boolean {
  if (kind === 'pickup') return b.status === 'picked_up' || b.status === 'returned' || b.status === 'completed'
  if (kind === 'return') return b.status === 'returned' || b.status === 'completed'
  return false
}

// จำนวนวันที่เกินกำหนดคืน: rental_today ส่ง days_late มา ; rental_schedule (overdue_returns) ไม่ส่ง → คิดจากวันคืนกับวันนี้
function daysLate(b: RentalBookingMini): number {
  if (b.days_late > 0) return b.days_late
  const d = daysBetweenKeys(b.return_date, bangkokTodayKey())
  return Number.isFinite(d) && d > 0 ? d : 0
}

function timeText(v: string | null): string {
  const s = (v ?? '').trim()
  return s ? `${s} น.` : ''
}

export default function BookingMiniList({
  items,
  kind,
  now = null,
  emptyText,
  showCall = true,
}: {
  items: RentalBookingMini[]
  kind: MiniKind
  /** เวลาปัจจุบัน (useNow) — ใช้นับถอยหลังเวลาถือจองของคำขอออนไลน์ ; null = ไม่แสดง */
  now?: number | null
  emptyText?: string
  showCall?: boolean
}) {
  if (items.length === 0) {
    return emptyText ? <p className="px-4 py-5 sm:px-5 text-sm text-gray-500">{emptyText}</p> : null
  }
  return (
    <ul className="divide-y divide-gray-150">
      {items.map(b => {
        const done = miniDone(kind, b)
        const hold = kind === 'pending' ? holdRemaining(b.expires_at, now) : null
        const tel = showCall ? telHref(b.customer_phone) : ''
        const time = kind === 'fitting' ? timeText(b.fitting_time) : kind === 'pickup' ? timeText(b.pickup_time) : ''
        return (
          <li key={`${kind}-${b.id}`} className="flex items-stretch">
            <Link
              href={bookingHref(b.id)}
              prefetch={false}
              className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 sm:px-5 min-h-[56px] transition-colors active:bg-gray-100 [@media(hover:hover)]:hover:bg-gray-50"
              aria-label={`เปิดการจอง ${b.booking_no} ของ ${b.customer_name || 'ลูกค้า'}`}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {done && <CheckCircle2 {...ICON_XS} className="text-green-700" />}
                  <span className={clsx('font-mono text-xs break-all', done ? 'text-gray-500' : 'text-gray-700')}>{b.booking_no}</span>
                  <span className={STATUS_CHIP[b.status]}>{statusLabel(b.status)}</span>
                </div>
                <p className={clsx('text-sm font-medium break-words', done ? 'text-gray-600' : 'text-gray-900')}>
                  {b.customer_name || '-'}
                  {b.customer_phone && (
                    <span className="font-normal text-gray-500 tabular-nums whitespace-nowrap"> · {formatPhone(b.customer_phone)}</span>
                  )}
                </p>
                {b.item_names && (
                  <p className="text-xs text-gray-600 break-words">
                    {b.item_names}
                    {b.items_count > 0 && <span className="text-gray-500 whitespace-nowrap"> ({b.items_count.toLocaleString('th-TH')} ชิ้น)</span>}
                  </p>
                )}
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 tabular-nums">
                  {kind === 'overdue' ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                      <AlertTriangle {...ICON_XS} />
                      เกินกำหนดคืน {daysLate(b).toLocaleString('th-TH')} วัน (กำหนดคืน {formatThaiDate(b.return_date)})
                    </span>
                  ) : (
                    <span>รับ {formatThaiDate(b.pickup_date)} – คืน {formatThaiDate(b.return_date)}</span>
                  )}
                  {time && (
                    <span className="inline-flex items-center gap-1">
                      <Clock {...ICON_XS} />
                      {kind === 'fitting' ? 'ลองชุด' : 'เวลารับ'} {time}
                    </span>
                  )}
                  {hold && (
                    <span
                      className={clsx(
                        'inline-flex items-center gap-1 font-medium',
                        hold.tone === 'over' ? 'text-red-700' : hold.tone === 'warn' ? 'text-amber-800' : 'text-gray-600',
                      )}
                    >
                      <Hourglass {...ICON_XS} />
                      {hold.text}
                    </span>
                  )}
                </p>
              </div>
              <div className="shrink-0 flex items-center gap-1 self-center">
                {b.due > 0.005 && !done && (
                  <span className="text-right text-xs leading-tight">
                    <span className="block text-gray-500">ค้างชำระ</span>
                    <span className="money text-sm text-amber-800">{baht(b.due)}</span>
                  </span>
                )}
                <ChevronRight {...ICON_SM} className="text-gray-400" />
              </div>
            </Link>
            {tel && (
              <a
                href={tel}
                className="btn-icon btn-icon-plain my-auto mr-2 sm:mr-3 shrink-0"
                aria-label={`โทรหา ${b.customer_name || 'ลูกค้า'} ${formatPhone(b.customer_phone)}`}
              >
                <Phone {...ICON_SM} />
              </a>
            )}
          </li>
        )
      })}
    </ul>
  )
}
