'use client'
// การ์ดรายละเอียดคิวงาน 1 คิว (จาก wed_day / wed_today.today_sessions) — ใช้ในแผงรายละเอียดวันของปฏิทิน และ "คิวงานวันนี้" ในหน้าภาพรวม
// แสดงครบ: เวลา / ทีมถึง / ประเภท / คู่บ่าวสาว / ลูกค้า (โทร-คัดลอกเบอร์, LINE) / ผู้ประสานงาน / สถานที่ + แผนที่ /
//          ทีมงาน (+ ค่าตัวเฉพาะผู้จัดการ) / แพ็กเกจ + บริการเสริม / ชิ้นงานส่ง / สถานะเงิน / การแต่งกาย / หมายเหตุ / กำหนดการ / ทีมชนคิว
// compact = หน้าภาพรวม: ส่วนที่ยาว (กำหนดการ แพ็กเกจ หมายเหตุ) พับไว้ใน "รายละเอียดเพิ่มเติม"
// ลิงก์จากผู้ใช้ (แผนที่/มู้ดบอร์ด) ผ่าน safeHttpUrl ใน lib/wedding แล้ว (http/https เท่านั้น)
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, Clock, Copy, ExternalLink, Image as ImageIcon, MapPin, MessageCircle, Package,
  Phone, Shirt, StickyNote, UserRound,
} from 'lucide-react'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { copyText } from '@/components/book/CopyButton'
import { baht, formatThaiDate } from '@/lib/format'
import {
  DELIVERABLE_STATUS_CHIP, WED_STATUS_CHIP, callTimeText, crewConflictText, deliverableStatusLabel, formatPhone, normTime,
  sessionTimeText, type WedDayMoney, type WedDaySession, type WedBookingStatus,
} from '@/lib/wedding'
import CrewChips from './CrewChips'
import { SESSION_TYPE_ICON, TONE_BAR, calTone } from './calendarModel'
import { lineIdUrl, telHref, wedBookingHref } from './rpc'

// ---------------------------------------------------------------------------
// ปุ่มคัดลอกเล็ก (เบอร์โทร / LINE ID) — ผลประกาศผ่าน aria-live
// ---------------------------------------------------------------------------
export function CopyMini({ value, what }: { value: string; what: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const timer = useRef<number | null>(null)
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])
  async function onClick() {
    const ok = await copyText(value)
    setState(ok ? 'ok' : 'fail')
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), ok ? 2000 : 5000)
  }
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className="btn-ghost min-h-[44px] md:min-h-[32px] shrink-0 px-2.5 text-xs"
        aria-label={`คัดลอก${what} ${value}`}
      >
        {state === 'ok' ? <Check {...ICON_XS} /> : <Copy {...ICON_XS} />}
        {state === 'ok' ? 'คัดลอกแล้ว' : 'คัดลอก'}
      </button>
      <span aria-live="polite" className={state === 'fail' ? 'basis-full text-xs text-red-700' : 'sr-only'}>
        {state === 'ok' ? `คัดลอก${what}แล้ว` : state === 'fail' ? 'คัดลอกไม่ได้ — กดค้างที่ข้อความเพื่อคัดลอกเอง' : ''}
      </span>
    </>
  )
}

// ---------------------------------------------------------------------------
// สถานะเงินของงาน (ชิป + ยอด)
// ---------------------------------------------------------------------------
export interface MoneyChip {
  cls: string
  text: string
}

/** ชิปสถานะเงิน: มัดจำแล้ว/ยังไม่มัดจำ · ถึงกำหนดชำระ (งวดเลยกำหนด/ถึงวันนี้) · ค้าง ฿x · ชำระครบ */
export function moneyChips(m: WedDayMoney, status: WedBookingStatus, today: string): MoneyChip[] {
  const out: MoneyChip[] = []
  if (m.grand_total <= 0.005) return out
  if (status !== 'inquiry' && m.deposit_required > 0.005) {
    out.push(m.deposit_met
      ? { cls: 'badge-in', text: 'มัดจำแล้ว' }
      : { cls: 'badge-return', text: `ยังไม่ได้มัดจำ (${baht(m.deposit_required)})` })
  }
  if (m.due > 0.005) {
    const next = m.next_installment
    const dueNow = !!next && next.amount > 0.005 && (next.overdue || (!!next.due_date && next.due_date <= today))
    if (dueNow && next) {
      out.push({ cls: 'badge-out', text: `ถึงกำหนดชำระ ${baht(Math.min(next.amount, m.due))}` })
    }
    out.push({ cls: dueNow ? 'chip-outline' : 'badge-return', text: `ค้าง ${baht(m.due)}` })
  } else if (status !== 'inquiry') {
    out.push({ cls: 'badge-in', text: m.due < -0.005 ? `ชำระเกิน ${baht(-m.due)}` : 'ชำระครบแล้ว' })
  }
  return out
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold text-gray-500">{children}</p>
}

export default function SessionDetailCard({
  s,
  today,
  compact = false,
}: {
  s: WedDaySession
  today: string
  compact?: boolean
}) {
  const tone = calTone(s.status)
  const TypeIcon = SESSION_TYPE_ICON[s.session_type]
  const call = callTimeText(s.call_time)
  const conflictIds = new Set(s.conflicts.map(c => c.crew_id).filter(Boolean))
  const chips = moneyChips(s.money, s.status, today)
  const tel = telHref(s.customer.phone)
  const coordTel = telHref(s.coordinator_phone)
  const lineUrl = lineIdUrl(s.customer.line_id)
  const customerName = [s.customer.name, s.customer.partner_name].filter(Boolean).join(' & ')
  const next = s.money.next_installment
  const hasMore = s.run_sheet.length > 0 || !!s.package_name || s.addons.length > 0 || s.deliverables.total > 0
    || !!s.dress_code || !!s.notes || !!s.customer_note || !!s.note || !!s.mood_link

  const details = (
    <div className="space-y-3">
      {/* ===== แพ็กเกจ / บริการเสริม / ชิ้นงานส่ง ===== */}
      {(s.package_name || s.addons.length > 0 || s.deliverables.total > 0) && (
        <div className="space-y-1.5">
          <Label>แพ็กเกจและงานที่ต้องส่ง</Label>
          {s.package_name && (
            <p className="flex items-start gap-1.5 text-sm text-gray-900 break-words">
              <Package {...ICON_XS} className="mt-0.5 shrink-0 text-brand-600" />
              <span>
                {s.package_name}
                {s.package_hours !== null && s.package_hours > 0 && (
                  <span className="text-gray-500 tabular-nums"> · {s.package_hours.toLocaleString('th-TH')} ชม.</span>
                )}
              </span>
            </p>
          )}
          {s.addons.length > 0 && (
            <p className="text-xs text-gray-600 break-words">
              บริการเสริม: {s.addons.map(a => `${a.name}${Math.abs(a.qty - 1) > 0.001 ? ` × ${a.qty.toLocaleString('th-TH')}${a.unit ? ` ${a.unit}` : ''}` : ''}`).join(' · ')}
            </p>
          )}
          {s.deliverables.total > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-gray-600 tabular-nums">
                ส่งงานแล้ว {s.deliverables.delivered.toLocaleString('th-TH')}/{s.deliverables.total.toLocaleString('th-TH')} รายการ
                {s.deliverables.overdue > 0 && <span className="font-semibold text-red-700"> · เลยกำหนด {s.deliverables.overdue.toLocaleString('th-TH')}</span>}
              </p>
              {s.deliverables.items.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {s.deliverables.items.map((d, i) => (
                    <li key={`${d.name}-${i}`} className={DELIVERABLE_STATUS_CHIP[d.status]}>
                      <span className="max-w-[14rem] truncate">{d.name}{d.qty > 1 ? ` ${d.qty.toLocaleString('th-TH')}${d.unit ? ` ${d.unit}` : ''}` : ''}</span>
                      <span className="opacity-80">· {deliverableStatusLabel(d.status)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== การแต่งกาย / หมายเหตุ ===== */}
      {s.dress_code && (
        <div className="space-y-1">
          <Label>การแต่งกายทีมงาน</Label>
          <p className="flex items-start gap-1.5 text-sm text-gray-900 whitespace-pre-line break-words">
            <Shirt {...ICON_XS} className="mt-0.5 shrink-0 text-brand-600" />
            <span className="min-w-0">{s.dress_code}</span>
          </p>
        </div>
      )}
      {(s.notes || s.customer_note || s.note) && (
        <div className="space-y-1.5">
          <Label>หมายเหตุ</Label>
          {s.notes && (
            <p className="flex items-start gap-1.5 text-sm text-gray-900 whitespace-pre-line break-words">
              <StickyNote {...ICON_XS} className="mt-0.5 shrink-0 text-brand-600" />
              <span className="min-w-0"><span className="text-gray-500">คิวนี้: </span>{s.notes}</span>
            </p>
          )}
          {s.customer_note && (
            <p className="text-sm text-gray-900 whitespace-pre-line break-words">
              <span className="text-gray-500">ลูกค้าขอ: </span>{s.customer_note}
            </p>
          )}
          {s.note && (
            <p className="text-sm text-gray-900 whitespace-pre-line break-words">
              <span className="text-gray-500">โน้ตภายใน: </span>{s.note}
            </p>
          )}
        </div>
      )}
      {s.mood_link && (
        <a href={s.mood_link} target="_blank" rel="noopener noreferrer" className="link text-sm break-all">
          <ImageIcon {...ICON_XS} />
          เปิดมู้ดบอร์ด / ภาพตัวอย่าง
          <ExternalLink {...ICON_XS} />
        </a>
      )}

      {/* ===== กำหนดการ (ฤกษ์ / ลำดับงาน) ===== */}
      {s.run_sheet.length > 0 && (
        <div className="space-y-1.5">
          <Label>กำหนดการ ({s.run_sheet.length.toLocaleString('th-TH')} รายการ)</Label>
          <div className="table-wrap rounded-lg border border-gray-200">
            <table className="table-soft w-full text-sm">
              <thead>
                <tr>
                  <th scope="col" className="w-20 px-3 py-2 text-left">เวลา</th>
                  <th scope="col" className="px-3 py-2 text-left">รายการ</th>
                </tr>
              </thead>
              <tbody>
                {s.run_sheet.map((r, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap px-3 py-2 align-top font-semibold tabular-nums text-gray-900">{r.time ? `${r.time} น.` : '-'}</td>
                    <td className="px-3 py-2 align-top text-gray-800 break-words">{r.text || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <article className={clsx('card overflow-hidden', TONE_BAR[tone])} aria-label={`${s.type_label} ${s.couple_names} ${sessionTimeText(s)}`}>
      <div className="space-y-3 p-3.5 sm:p-4">
        {/* ===== หัว: เวลา + ประเภท + สถานะ ===== */}
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 space-y-0.5">
            <p className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold text-gray-900 tabular-nums">
              <span>{sessionTimeText(s)}</span>
              {call && (
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
                  <Clock {...ICON_XS} />
                  {call}
                </span>
              )}
            </p>
            <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-gray-700">
              <TypeIcon {...ICON_XS} className="shrink-0 text-brand-600" />
              <span className="font-medium">{s.type_label}</span>
              {s.title && <span className="min-w-0 break-words text-gray-600">· {s.title}</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {s.session_status === 'done' && (
              <span className="badge-in"><CheckCircle2 {...ICON_XS} />ถ่ายแล้ว</span>
            )}
            <span className={WED_STATUS_CHIP[s.status]}>{s.status_label}</span>
          </div>
        </div>

        {/* ===== คู่บ่าวสาว + เปิดงาน ===== */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-lg font-semibold leading-snug text-gray-900 break-words">{s.couple_names || '-'}</p>
            <p className="text-xs text-gray-500">
              <span className="font-mono">{s.booking_no}</span>
              {s.sessions_in_booking > 1 && <span> · งานนี้มี {s.sessions_in_booking.toLocaleString('th-TH')} คิว</span>}
            </p>
          </div>
          <Link href={wedBookingHref(s.booking_id)} prefetch={false} className="btn-secondary shrink-0 px-3 text-sm">
            เปิดงาน
            <ArrowRight {...ICON_XS} />
          </Link>
        </div>

        {/* ===== ทีมชนคิว ===== */}
        {(s.conflicts.length > 0 || s.has_conflict) && (
          <div role="alert" className="alert-err">
            <AlertTriangle {...ICON_SM} />
            <div className="min-w-0 space-y-0.5">
              <p className="font-semibold">ทีมงานชนคิว</p>
              {s.conflicts.length > 0
                ? s.conflicts.map((c, i) => <p key={`${c.crew_id}-${c.other_session_id ?? i}`} className="text-sm break-words">{crewConflictText(c)}</p>)
                : <p className="text-sm">มีทีมงานในคิวนี้ถูกจัดลงคิวอื่นที่เวลาทับกัน — เปิดงานเพื่อจัดทีมใหม่</p>}
            </div>
          </div>
        )}

        {/* ===== สถานที่ ===== */}
        <div className="space-y-1">
          <Label>สถานที่</Label>
          <div className="flex items-start gap-1.5 text-sm text-gray-900">
            <MapPin {...ICON_XS} className="mt-0.5 shrink-0 text-brand-600" />
            <div className="min-w-0 space-y-0.5 break-words">
              <p className="font-medium">{s.venue_name || 'ยังไม่ระบุสถานที่'}</p>
              {s.venue_address && <p className="text-gray-600 whitespace-pre-line">{s.venue_address}</p>}
              {s.venue_contact && <p className="text-gray-600">ติดต่อสถานที่: {s.venue_contact}</p>}
            </div>
          </div>
          {s.map_url && (
            <a href={s.map_url} target="_blank" rel="noopener noreferrer" className="link text-sm">
              <ExternalLink {...ICON_XS} />
              เปิดแผนที่
            </a>
          )}
        </div>

        {/* ===== ลูกค้า + ผู้ประสานงาน ===== */}
        <div className="space-y-1">
          <Label>ลูกค้า</Label>
          <p className="flex items-center gap-1.5 text-sm font-medium text-gray-900 break-words">
            <UserRound {...ICON_XS} className="shrink-0 text-brand-600" />
            {customerName || '-'}
          </p>
          {s.customer.phone && (
            <div className="flex flex-wrap items-center gap-x-1">
              {tel ? (
                <a href={tel} className="link px-1 text-sm tabular-nums md:min-h-[32px]" aria-label={`โทรหา ${customerName || 'ลูกค้า'} ${formatPhone(s.customer.phone)}`}>
                  <Phone {...ICON_XS} />
                  {formatPhone(s.customer.phone)}
                </a>
              ) : (
                <span className="text-sm tabular-nums">{formatPhone(s.customer.phone)}</span>
              )}
              <CopyMini value={formatPhone(s.customer.phone)} what="เบอร์ลูกค้า" />
            </div>
          )}
          {s.customer.line_id && (
            <div className="flex flex-wrap items-center gap-x-1">
              {lineUrl ? (
                <a href={lineUrl} target="_blank" rel="noopener noreferrer" className="link px-1 text-sm break-all md:min-h-[32px]">
                  <MessageCircle {...ICON_XS} />
                  LINE: {s.customer.line_id}
                </a>
              ) : (
                <span className="text-sm">LINE: {s.customer.line_id}</span>
              )}
              <CopyMini value={s.customer.line_id} what="LINE ID" />
            </div>
          )}
          {s.customer.instagram && <p className="text-sm text-gray-600 break-all">IG: {s.customer.instagram}</p>}
          {(s.coordinator_name || s.coordinator_phone) && (
            <div className="flex flex-wrap items-center gap-x-1.5 pt-0.5 text-sm text-gray-700">
              <span className="text-gray-500">ผู้ประสานงาน:</span>
              <span className="font-medium text-gray-900 break-words">{s.coordinator_name || '-'}</span>
              {s.coordinator_phone && (coordTel ? (
                <a href={coordTel} className="link px-1 tabular-nums md:min-h-[32px]" aria-label={`โทรหาผู้ประสานงาน ${formatPhone(s.coordinator_phone)}`}>
                  <Phone {...ICON_XS} />
                  {formatPhone(s.coordinator_phone)}
                </a>
              ) : (
                <span className="tabular-nums">{s.coordinator_phone}</span>
              ))}
            </div>
          )}
        </div>

        {/* ===== ทีมงาน ===== */}
        <div className="space-y-1.5">
          <Label>ทีมงาน ({s.crew.length.toLocaleString('th-TH')} คน)</Label>
          <CrewChips crew={s.crew} showFee conflictIds={conflictIds} />
        </div>

        {/* ===== เงิน ===== */}
        {s.money.grand_total > 0.005 && (
          <div className="space-y-1.5">
            <Label>{s.status === 'inquiry' ? 'ราคาที่เสนอ' : 'การชำระเงิน'}</Label>
            <p className="text-sm text-gray-700 tabular-nums">
              ยอดสุทธิ <b className="money text-gray-900">{baht(s.money.grand_total)}</b>
              {s.status !== 'inquiry' && <> · ชำระแล้ว <b className="money text-gray-900">{baht(s.money.paid)}</b></>}
            </p>
            {chips.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {chips.map(c => <span key={c.text} className={c.cls}>{c.text}</span>)}
              </div>
            )}
            {next && next.amount > 0.005 && s.money.due > 0.005 && (
              <p className={clsx('text-xs tabular-nums', next.overdue ? 'font-semibold text-red-700' : 'text-gray-600')}>
                งวดถัดไป: {next.label || 'ยอดคงเหลือ'} {baht(Math.min(next.amount, s.money.due))}
                {next.due_date && ` · กำหนด ${formatThaiDate(next.due_date)}`}
                {next.overdue && ' (เลยกำหนด)'}
              </p>
            )}
          </div>
        )}

        {/* ===== ส่วนยาว: แสดงเลย (ปฏิทิน) / พับไว้ (ภาพรวม) ===== */}
        {hasMore && (compact ? (
          <details className="group rounded-lg border border-gray-200">
            <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium text-brand-700 [&::-webkit-details-marker]:hidden">
              รายละเอียดเพิ่มเติม (กำหนดการ แพ็กเกจ หมายเหตุ)
              <ArrowRight {...ICON_XS} className="shrink-0 transition-transform group-open:rotate-90" />
            </summary>
            <div className="border-t border-gray-200 p-3">{details}</div>
          </details>
        ) : details)}

        {normTime(s.call_time) === null && s.status !== 'inquiry' && (
          <p className="text-xs text-gray-500">ยังไม่ได้ระบุเวลาทีมถึงงาน</p>
        )}
      </div>
    </article>
  )
}
