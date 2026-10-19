'use client'
// การ์ดแสดงผลของหน้ารายละเอียดการจอง: ลูกค้า · รายการชุด · สรุปเงิน
// แสดงผลอย่างเดียว (ปุ่มเรียก callback ของหน้าแม่) — ตัวเลขเงินทั้งหมดมาจากเซิร์ฟเวอร์ (rental_recalc) ไม่คำนวณใหม่
import { useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import {
  AlertTriangle, Ban, CheckCircle2, Contact, Eye, EyeOff, Mail, MapPin, MessageCircle, Phone, Shirt, Wallet,
} from 'lucide-react'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht } from '@/lib/format'
import {
  CONDITION_LABELS, LINE_STATUS_LABELS, UNIT_STATUS_LABELS, formatPhone, maskIdCard, phoneDigits, sizeLabel,
  type RentalBooking, type RentalBookingLine,
} from '@/lib/rental'
import RentalImage from '@/components/rental/RentalImage'
import { lineIdUrl } from './rpc'

// ---------------------------------------------------------------------------
// ลูกค้า
// ---------------------------------------------------------------------------
export function CustomerCard({ booking }: { booking: RentalBooking }) {
  const c = booking.customer
  // เลขบัตรเต็มแสดงเมื่อกดดูเท่านั้น (หน้าจอหน้าร้านมีคนอื่นมองเห็นได้)
  const [showId, setShowId] = useState(false)
  const tel = phoneDigits(c.phone)
  const tel2 = phoneDigits(c.phone2)
  const lineUrl = lineIdUrl(c.line_id)
  return (
    <section className="card" aria-labelledby="bk-customer">
      <div className="card-header">
        <h2 id="bk-customer" className="section-title">
          <Contact {...ICON} />
          ลูกค้า
        </h2>
        {c.id && (
          <Link href={`/rental/customers/${c.id}`} className="link text-sm">ประวัติลูกค้า</Link>
        )}
      </div>
      <div className="p-4 sm:p-5 space-y-3">
        <div>
          <p className="text-lg font-semibold text-gray-900 break-words">{c.name || '-'}</p>
          {/* คำขอออนไลน์ผูกลูกค้าด้วยเบอร์โทร — ชื่อที่ผู้ส่งพิมพ์อาจไม่ใช่ลูกค้าคนนี้ (คนอื่นใช้เบอร์นี้จองแทน/พิมพ์เบอร์ผิด) */}
          {booking.online_name && booking.online_name.trim() !== (c.name ?? '').trim() && (
            <p className="mt-1 text-sm text-amber-800 break-words">
              ชื่อที่ผู้จองพิมพ์ในคำขอออนไลน์: <span className="font-semibold">{booking.online_name}</span> — ตรวจสอบกับลูกค้าก่อนยืนยัน
            </p>
          )}
          {c.is_blacklisted && (
            <div role="alert" className="alert-err mt-2">
              <Ban {...ICON_SM} />
              <p className="min-w-0">ลูกค้าอยู่ในบัญชีดำ{c.blacklist_reason ? `: ${c.blacklist_reason}` : ''}</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {tel && (
            <a href={`tel:${tel}`} className="btn-secondary min-h-[44px] px-3 text-sm">
              <Phone {...ICON_SM} />
              {formatPhone(c.phone)}
            </a>
          )}
          {tel2 && (
            <a href={`tel:${tel2}`} className="btn-secondary min-h-[44px] px-3 text-sm">
              <Phone {...ICON_SM} />
              {formatPhone(c.phone2)}
            </a>
          )}
          {lineUrl && (
            <a href={lineUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-[44px] px-3 text-sm">
              <MessageCircle {...ICON_SM} />
              LINE {c.line_id}
            </a>
          )}
        </div>

        <dl className="space-y-2 text-sm">
          {c.email && (
            <div className="flex items-start gap-2">
              <dt className="sr-only">อีเมล</dt>
              <Mail {...ICON_XS} className="mt-0.5 shrink-0 text-gray-400" />
              <dd className="min-w-0 break-all text-gray-800">{c.email}</dd>
            </div>
          )}
          {c.address && (
            <div className="flex items-start gap-2">
              <dt className="sr-only">ที่อยู่</dt>
              <MapPin {...ICON_XS} className="mt-0.5 shrink-0 text-gray-400" />
              <dd className="min-w-0 whitespace-pre-line break-words text-gray-800">{c.address}</dd>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <dt className="text-gray-600">เลขบัตร/พาสปอร์ต</dt>
            <dd className="flex items-center gap-1 min-w-0">
              <span className="font-mono text-gray-900 break-all">
                {c.id_card_no ? (showId ? c.id_card_no : maskIdCard(c.id_card_no)) : 'ยังไม่ได้บันทึก'}
              </span>
              {c.id_card_no && (
                <button
                  type="button"
                  className="btn-icon btn-icon-plain"
                  aria-label={showId ? 'ซ่อนเลขบัตร' : 'แสดงเลขบัตรเต็ม'}
                  aria-pressed={showId}
                  onClick={() => setShowId(v => !v)}
                >
                  {showId ? <EyeOff {...ICON_SM} /> : <Eye {...ICON_SM} />}
                </button>
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-gray-600">ตรวจบัตรตอนรับชุด</dt>
            <dd className={booking.id_checked ? 'text-green-800 font-medium' : 'text-gray-700'}>
              {booking.status === 'pending' || booking.status === 'confirmed' ? 'ยังไม่ได้รับชุด' : booking.id_checked ? 'ตรวจแล้ว' : 'ไม่ได้ตรวจ'}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// รายการชุด
// ---------------------------------------------------------------------------
function lineChip(l: RentalBookingLine): { cls: string; label: string } {
  if (l.status === 'lost') return { cls: 'badge-out', label: LINE_STATUS_LABELS.lost }
  if (l.status === 'returned') return { cls: 'chip', label: LINE_STATUS_LABELS.returned }
  if (l.status === 'picked_up') return { cls: 'badge-in', label: LINE_STATUS_LABELS.picked_up }
  return { cls: 'chip-outline', label: LINE_STATUS_LABELS.booked }
}

export function LinesCard({ booking }: { booking: RentalBooking }) {
  const depositTotal = booking.lines.reduce((s, l) => s + l.deposit, 0)
  return (
    <section className="card" aria-labelledby="bk-lines">
      <div className="card-header">
        <h2 id="bk-lines" className="section-title">
          <Shirt {...ICON} />
          รายการชุด
          <span className="chip">{booking.lines.length}</span>
        </h2>
        <span className="text-sm text-gray-600 tabular-nums">{booking.days} วัน</span>
      </div>
      <ul className="divide-y divide-gray-100">
        {booking.lines.map(l => {
          const chip = lineChip(l)
          // ความพร้อมของชิ้น สำคัญเฉพาะก่อนรับชุด
          const notReady = l.status === 'booked' && (l.unit_status !== 'available' || l.unit_needs_cleaning)
          return (
            <li key={l.id} className="flex gap-3 px-4 py-3 sm:px-5">
              <RentalImage path={l.cover_path} alt={l.item_name} className="h-20 w-16 shrink-0 rounded-lg border border-gray-200" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <p className="min-w-0 text-sm font-semibold text-gray-900 break-words">
                    {l.item_name}
                    {l.is_accessory && <span className="ml-1.5 chip-outline align-middle">อุปกรณ์เสริม</span>}
                  </p>
                  <span className="money text-gray-900">{baht(l.rent_price)}</span>
                </div>
                <p className="text-xs text-gray-600">
                  {l.item_code} · ไซส์ {sizeLabel(l.size)} · ชิ้น <span className="font-mono text-gray-900">{l.unit_code}</span>
                </p>
                <p className="text-xs text-gray-500 tabular-nums">
                  {baht(l.base_price)} / {l.base_days} วัน{l.extra_day_price > 0 ? ` · วันเพิ่ม ${baht(l.extra_day_price)}` : ''}
                  {l.deposit > 0 ? ` · ประกัน ${baht(l.deposit)}` : ''}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={chip.cls}>{chip.label}</span>
                  {l.return_condition && !(l.status === 'lost' && l.return_condition === 'lost') && (
                    <span className={l.return_condition === 'ok' ? 'badge-in' : l.return_condition === 'dirty' ? 'badge-return' : 'badge-out'}>
                      {CONDITION_LABELS[l.return_condition]}
                    </span>
                  )}
                  {notReady && (
                    <span className="badge-return">
                      <AlertTriangle {...ICON_XS} />
                      {l.unit_status !== 'available' ? UNIT_STATUS_LABELS[l.unit_status] : 'ยังไม่ได้ซัก/เตรียม'}
                    </span>
                  )}
                </div>
                {l.return_note && <p className="text-xs text-gray-600 break-words">หมายเหตุ: {l.return_note}</p>}
              </div>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap justify-between gap-2 border-t border-gray-200 px-4 py-3 sm:px-5 text-sm">
        <span className="text-gray-600">ค่าเช่ารวม <span className="money text-gray-900">{baht(booking.money.rent_total)}</span></span>
        <span className="text-gray-600">ประกันตามชุด <span className="money text-gray-900">{baht(depositTotal)}</span></span>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// สรุปเงิน
// ---------------------------------------------------------------------------
function Row({ label, value, sub, className }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className={clsx('flex items-baseline justify-between gap-3', className)}>
      <dt className="min-w-0">
        {label}
        {sub && <span className="block text-xs font-normal text-gray-500 break-words">{sub}</span>}
      </dt>
      <dd className="shrink-0 tabular-nums">{value}</dd>
    </div>
  )
}

export function MoneyCard({ booking, onOpenPayment }: { booking: RentalBooking; onOpenPayment?: () => void }) {
  const m = booking.money
  const dueTone = m.due > 0.005 ? 'due' : m.due < -0.005 ? 'over' : 'clear'
  const depositLeft = Math.max(0, m.deposit_required - m.paid)
  return (
    <section className="card" aria-labelledby="bk-money">
      <div className="card-header">
        <h2 id="bk-money" className="section-title">
          <Wallet {...ICON} />
          สรุปเงิน
        </h2>
        {onOpenPayment && (
          <button type="button" className="btn-soft min-h-[40px] px-3 text-sm" onClick={onOpenPayment}>
            <Wallet {...ICON_XS} />
            รายการเงิน
          </button>
        )}
      </div>
      <div className="p-4 sm:p-5 space-y-4">
        {/* ตัวเลขหลักที่ต้องเห็นชัด: ค้างชำระ + เงินประกันที่ถืออยู่ */}
        <div className="grid grid-cols-2 gap-2">
          <div
            className={clsx(
              'rounded-lg border px-3 py-2.5',
              dueTone === 'due' && 'border-red-200 bg-red-50',
              dueTone === 'over' && 'border-amber-200 bg-amber-50',
              dueTone === 'clear' && 'border-green-200 bg-green-50',
            )}
          >
            <p className={clsx('text-xs font-medium', dueTone === 'due' ? 'text-red-800' : dueTone === 'over' ? 'text-amber-800' : 'text-green-800')}>
              {dueTone === 'due' ? 'ค้างชำระ' : dueTone === 'over' ? 'รับเกิน ต้องคืนลูกค้า' : 'ชำระครบแล้ว'}
            </p>
            <p className={clsx('money text-xl', dueTone === 'due' ? 'text-red-700' : dueTone === 'over' ? 'text-amber-800' : 'text-green-800')}>
              {baht(Math.abs(m.due))}
            </p>
          </div>
          <div className={clsx('rounded-lg border px-3 py-2.5', m.security_held > 0.005 ? 'border-brand-200 bg-brand-50' : 'border-gray-200 bg-gray-50')}>
            <p className="text-xs font-medium text-gray-700">ถือเงินประกัน</p>
            <p className="money text-xl text-gray-900">{baht(m.security_held)}</p>
            {m.security_required > 0 && (
              <p className="text-[11px] text-gray-500">ต้องวาง {baht(m.security_required)}</p>
            )}
          </div>
        </div>

        <dl className="space-y-1.5 text-sm text-gray-700">
          <Row label="ค่าเช่ารวม" value={baht(m.rent_total)} />
          {m.discount > 0 && <Row label="ส่วนลด" sub={m.discount_note ?? undefined} value={`-${baht(m.discount)}`} />}
          {m.delivery_fee > 0 && <Row label="ค่าจัดส่ง" value={baht(m.delivery_fee)} />}
          {m.charges_total > 0 && <Row label="ค่าปรับ / ค่าใช้จ่าย" value={baht(m.charges_total)} />}
          <Row label="ยอดรวมทั้งสิ้น" value={baht(m.grand_total)} className="border-t border-gray-200 pt-1.5 font-semibold text-gray-900" />
          <Row label="ชำระแล้ว" sub="รวมยอดที่หักจากเงินประกัน" value={baht(m.paid)} />
          <Row
            label={dueTone === 'over' ? 'รับเกิน (ต้องคืน)' : 'ค้างชำระ'}
            value={baht(Math.abs(m.due))}
            className={clsx('font-semibold', dueTone === 'due' ? 'text-red-700' : dueTone === 'over' ? 'text-amber-800' : 'text-gray-900')}
          />
        </dl>

        <dl className="space-y-1.5 border-t border-gray-200 pt-3 text-sm text-gray-700">
          <div className="flex items-baseline justify-between gap-3">
            <dt>มัดจำจองที่ต้องจ่าย</dt>
            <dd className="flex items-center gap-1.5 tabular-nums">
              {baht(m.deposit_required)}
              {m.deposit_met ? (
                <span className="badge-in"><CheckCircle2 {...ICON_XS} />ครบ</span>
              ) : (
                <span className="badge-return">ขาด {baht(depositLeft)}</span>
              )}
            </dd>
          </div>
          <Row
            label="เงินประกันที่ต้องวาง"
            sub={m.security_override !== null ? 'กำหนดเองสำหรับการจองนี้' : undefined}
            value={baht(m.security_required)}
          />
          <Row label="เงินประกันที่ถืออยู่" value={baht(m.security_held)} className="font-semibold text-gray-900" />
          {m.pending_review_total > 0 && (
            <Row label="สลิปรอตรวจ (ยังไม่นับ)" value={baht(m.pending_review_total)} className="font-medium text-amber-800" />
          )}
        </dl>
      </div>
    </section>
  )
}
