'use client'
// รายการย่อยของหน้าภาพรวม (wed_today): คิว 7 วันถัดไป / ติดตามลูกค้า / ล็อกคิวใกล้หมดเวลา / งวดชำระ / งานที่ใกล้กำหนดส่ง / ทีมงานชนคิว
// ทุกแถวเปิดหน้ารายละเอียดงานได้ · ปุ่มโทรอยู่นอกลิงก์ของแถว (ห้ามซ้อนลิงก์ในลิงก์)
// สีบอกสถานะต้องมีข้อความคู่เสมอ ไม่พึ่งสีอย่างเดียว
import Link from 'next/link'
import clsx from 'clsx'
import { AlertTriangle, CalendarClock, ChevronRight, Hourglass, MapPin, Phone } from 'lucide-react'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht, daysBetweenKeys, formatThaiDate } from '@/lib/format'
import {
  DELIVERABLE_STATUS_CHIP, WED_STATUS_CHIP, deliverableStatusLabel, formatPhone, sessionTimeText,
  type WedBookingMini, type WedCrewConflict, type WedDeliverableBoardItem, type WedInstallmentDue, type WedSessionMini,
} from '@/lib/wedding'
import { weekdayDayLabel } from '@/components/rental/calendar/dates'
import { crewShortName } from '@/components/wedding/calendar/CrewChips'
import { SESSION_TYPE_ICON, TONE_BAR, calTone, conflictPairText } from '@/components/wedding/calendar/calendarModel'
import { telHref, wedBookingHref, wedCalendarHref } from '@/components/wedding/calendar/rpc'

const ROW_LINK = 'flex min-w-0 flex-1 items-start gap-3 px-4 py-3 sm:px-5 min-h-[56px] transition-colors active:bg-gray-100 [@media(hover:hover)]:hover:bg-gray-50'

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-5 sm:px-5 text-sm text-gray-500">{text}</p>
}

/** 'อีก 3 วัน' / 'พรุ่งนี้' / 'วันนี้' / 'เลยมา 2 วัน' เทียบกับวันอ้างอิง */
export function relDay(target: string | null, ref: string): string {
  if (!target) return ''
  const n = daysBetweenKeys(ref, target)
  if (!Number.isFinite(n)) return ''
  if (n === 0) return 'วันนี้'
  if (n === 1) return 'พรุ่งนี้'
  if (n > 1) return `อีก ${n.toLocaleString('th-TH')} วัน`
  return `เลยมา ${(-n).toLocaleString('th-TH')} วัน`
}

// ---------------------------------------------------------------------------
// คิว 7 วันถัดไป (จัดกลุ่มตามวัน)
// ---------------------------------------------------------------------------
export function NextSessionsList({ sessions }: { sessions: readonly WedSessionMini[] }) {
  if (sessions.length === 0) return <Empty text="ไม่มีคิวงานใน 7 วันถัดไป" />
  const groups: { day: string; items: WedSessionMini[] }[] = []
  for (const s of sessions) {
    const last = groups[groups.length - 1]
    if (last && last.day === s.date) last.items.push(s)
    else groups.push({ day: s.date, items: [s] })
  }
  return (
    <div className="divide-y divide-gray-200">
      {groups.map(g => (
        <div key={g.day}>
          <Link
            href={wedCalendarHref(g.day)}
            prefetch={false}
            className="flex min-h-[44px] items-center justify-between gap-2 bg-gray-50 px-4 py-1.5 sm:px-5 text-sm font-semibold text-gray-900 transition-colors [@media(hover:hover)]:hover:bg-gray-100"
            aria-label={`ดู${weekdayDayLabel(g.day)}ในปฏิทิน (${g.items.length} คิว)`}
          >
            <span>{weekdayDayLabel(g.day)}</span>
            <span className="inline-flex items-center gap-1 text-xs font-normal text-gray-500 tabular-nums">
              {g.items.length.toLocaleString('th-TH')} คิว
              <ChevronRight {...ICON_XS} />
            </span>
          </Link>
          <ul className="divide-y divide-gray-150">
            {g.items.map(s => {
              const Icon = SESSION_TYPE_ICON[s.session_type]
              const crew = s.crew.map(crewShortName).join(', ')
              return (
                <li key={s.session_id}>
                  <Link
                    href={wedBookingHref(s.booking_id)}
                    prefetch={false}
                    className={clsx(ROW_LINK, TONE_BAR[calTone(s.status)])}
                    aria-label={`เปิดงาน ${s.booking_no} ${s.couple_names} ${s.type_label} ${sessionTimeText(s)}`}
                  >
                    <div className="w-16 shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-gray-900">
                      {s.start_time ?? s.call_time ?? '—'}
                      {s.call_time && <span className="block text-[11px] font-normal text-gray-500">ทีมถึง {s.call_time}</span>}
                    </div>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        <span className="text-sm font-semibold text-gray-900 break-words">{s.couple_names || s.booking_no}</span>
                        <span className={WED_STATUS_CHIP[s.status]}>{s.status_label}</span>
                      </p>
                      <p className="flex items-center gap-1 text-xs text-gray-600">
                        <Icon {...ICON_XS} className="shrink-0 text-brand-600" />
                        <span className="min-w-0 break-words">{s.type_label}{s.title ? ` · ${s.title}` : ''}</span>
                      </p>
                      {s.venue_name && (
                        <p className="flex items-center gap-1 text-xs text-gray-600">
                          <MapPin {...ICON_XS} className="shrink-0 text-gray-400" />
                          <span className="min-w-0 break-words">{s.venue_name}</span>
                        </p>
                      )}
                      <p className={clsx('text-xs break-words', crew ? 'text-gray-600' : 'font-medium text-amber-800')}>
                        {crew ? `ทีม: ${crew}` : 'ยังไม่ได้จัดทีมงาน'}
                      </p>
                      {s.has_conflict && (
                        <p className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
                          <AlertTriangle {...ICON_XS} />
                          ทีมงานชนคิว
                        </p>
                      )}
                    </div>
                    <ChevronRight {...ICON_SM} className="shrink-0 self-center text-gray-400" />
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// งานแบบย่อ (ติดตามลูกค้า / ล็อกคิวใกล้หมด)
// ---------------------------------------------------------------------------
/** เวลาที่เหลือของการล็อกคิว: 'เหลือ 5 ชม. 12 นาที' · 'เลยเวลาล็อกคิวแล้ว' ; now = null (ยังไม่ hydrate) → null */
export function holdLeft(holdUntil: string | null, now: number | null): { text: string; over: boolean } | null {
  if (!holdUntil || now === null) return null
  const t = new Date(holdUntil).getTime()
  if (!Number.isFinite(t)) return null
  const ms = t - now
  if (ms <= 0) return { text: 'เลยเวลาล็อกคิวแล้ว — ยืนยันงาน ต่อเวลา หรือปล่อยคิว', over: true }
  const totalMin = Math.max(1, Math.floor(ms / 60000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return { text: `ล็อกคิวเหลือ ${h > 0 ? `${h} ชม. ` : ''}${m > 0 || h === 0 ? `${m} นาที` : ''}`.trim(), over: false }
}

export function BookingMiniRows({
  items,
  kind,
  day,
  now = null,
  emptyText,
}: {
  items: readonly WedBookingMini[]
  kind: 'followup' | 'hold'
  /** วันอ้างอิงของหน้า (เทียบวันนัดติดตาม) */
  day: string
  now?: number | null
  emptyText: string
}) {
  if (items.length === 0) return <Empty text={emptyText} />
  return (
    <ul className="divide-y divide-gray-150">
      {items.map(b => {
        const tel = telHref(b.phone)
        const hold = kind === 'hold' ? holdLeft(b.hold_until, now) : null
        return (
          <li key={`${kind}-${b.id}`} className="flex items-stretch">
            <Link
              href={wedBookingHref(b.id)}
              prefetch={false}
              className={ROW_LINK}
              aria-label={`เปิดงาน ${b.booking_no} ${b.couple_names}`}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-xs text-gray-700 break-all">{b.booking_no}</span>
                  <span className={WED_STATUS_CHIP[b.status]}>{b.status_label}</span>
                </p>
                <p className="text-sm font-medium text-gray-900 break-words">{b.couple_names || b.customer_name || '-'}</p>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 tabular-nums">
                  {b.first_date && <span>วันงาน {formatThaiDate(b.first_date)}</span>}
                  {b.package_name && <span className="break-words">{b.package_name}</span>}
                </p>
                {kind === 'followup' && (
                  <p className="flex items-start gap-1 text-xs text-amber-800">
                    <CalendarClock {...ICON_XS} className="mt-px shrink-0" />
                    <span className="min-w-0 break-words">
                      นัดติดตาม {formatThaiDate(b.followup_date)}{b.followup_date ? ` (${relDay(b.followup_date, day)})` : ''}
                      {b.followup_note && ` — ${b.followup_note}`}
                    </span>
                  </p>
                )}
                {hold && (
                  <p className={clsx('inline-flex items-center gap-1 text-xs font-medium', hold.over ? 'text-red-700' : 'text-amber-800')}>
                    <Hourglass {...ICON_XS} />
                    {hold.text}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1 self-center">
                {kind === 'hold' && !b.deposit_met && b.deposit_required > 0.005 && (
                  <span className="text-right text-xs leading-tight">
                    <span className="block text-gray-500">มัดจำ</span>
                    <span className="money text-sm text-amber-800">{baht(b.deposit_required)}</span>
                  </span>
                )}
                <ChevronRight {...ICON_SM} className="text-gray-400" />
              </div>
            </Link>
            {tel && (
              <a
                href={tel}
                className="btn-icon btn-icon-plain my-auto mr-2 sm:mr-3 shrink-0"
                aria-label={`โทรหา ${b.customer_name || b.couple_names || 'ลูกค้า'} ${formatPhone(b.phone)}`}
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

// ---------------------------------------------------------------------------
// งวดชำระที่ถึงกำหนด / ค้าง (ภายใน 7 วัน + ที่เลยกำหนด)
// ---------------------------------------------------------------------------
export function InstallmentDueRows({ items, day }: { items: readonly WedInstallmentDue[]; day: string }) {
  if (items.length === 0) return <Empty text="ไม่มีงวดชำระที่ถึงกำหนดใน 7 วันนี้" />
  return (
    <ul className="divide-y divide-gray-150">
      {items.map((it, i) => (
        <li key={`${it.booking_id}-${it.installment_id ?? it.seq}-${i}`}>
          <Link
            href={wedBookingHref(it.booking_id)}
            prefetch={false}
            className={ROW_LINK}
            aria-label={`เปิดงาน ${it.booking_no} ${it.couple_names} งวด ${it.label}`}
          >
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm font-medium text-gray-900 break-words">{it.couple_names || it.booking_no}</p>
              <p className="text-xs text-gray-600 break-words">
                <span className="font-mono">{it.booking_no}</span> · {it.label || `งวดที่ ${it.seq}`}
              </p>
              <p className={clsx('text-xs tabular-nums', it.overdue ? 'font-semibold text-red-700' : 'text-gray-600')}>
                {it.overdue && <AlertTriangle {...ICON_XS} className="mr-1 inline -mt-0.5" />}
                กำหนด {formatThaiDate(it.due_date)}{it.due_date ? ` (${relDay(it.due_date, day)})` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1 self-center">
              <span className="text-right text-xs leading-tight">
                <span className={clsx('block', it.overdue ? 'text-red-700' : 'text-gray-500')}>{it.overdue ? 'เลยกำหนด' : 'ต้องชำระ'}</span>
                <span className={clsx('money text-sm', it.overdue ? 'text-red-700' : 'text-gray-900')}>{baht(it.amount_remaining)}</span>
              </span>
              <ChevronRight {...ICON_SM} className="text-gray-400" />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// ชิ้นงานที่ใกล้กำหนดส่ง / เลยกำหนด
// ---------------------------------------------------------------------------
export function DeliverableDueRows({ items, day }: { items: readonly WedDeliverableBoardItem[]; day: string }) {
  if (items.length === 0) return <Empty text="ไม่มีงานที่ต้องส่งใน 7 วันนี้" />
  return (
    <ul className="divide-y divide-gray-150">
      {items.map(d => (
        <li key={d.id}>
          <Link
            href={wedBookingHref(d.booking_id)}
            prefetch={false}
            className={ROW_LINK}
            aria-label={`เปิดงาน ${d.booking_no} ${d.couple_names} ชิ้นงาน ${d.name}`}
          >
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-gray-900 break-words">
                  {d.name}{d.qty > 1 ? ` ${d.qty.toLocaleString('th-TH')}${d.unit ? ` ${d.unit}` : ''}` : ''}
                </span>
                <span className={DELIVERABLE_STATUS_CHIP[d.status]}>{deliverableStatusLabel(d.status)}</span>
              </p>
              <p className="text-xs text-gray-600 break-words">
                {d.couple_names || '-'} · <span className="font-mono">{d.booking_no}</span>
                {d.editor_name && ` · ตัดต่อ: ${d.editor_name}`}
              </p>
              <p className={clsx('text-xs tabular-nums', d.overdue ? 'font-semibold text-red-700' : 'text-gray-600')}>
                {d.overdue && <AlertTriangle {...ICON_XS} className="mr-1 inline -mt-0.5" />}
                กำหนดส่ง {formatThaiDate(d.due_date)}{d.due_date ? ` (${relDay(d.due_date, day)})` : ''}
              </p>
            </div>
            <ChevronRight {...ICON_SM} className="shrink-0 self-center text-gray-400" />
          </Link>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// ทีมงานชนคิว (30 วันข้างหน้า)
// ---------------------------------------------------------------------------
export function ConflictRows({
  items,
  lookup,
}: {
  items: readonly WedCrewConflict[]
  lookup(sessionId: string): WedSessionMini | null | undefined
}) {
  return (
    <ul className="divide-y divide-gray-150">
      {items.map((c, i) => (
        <li key={`${c.crew_id}-${c.this_session_id ?? ''}-${c.other_session_id ?? i}`}>
          <Link href={wedCalendarHref(c.date)} prefetch={false} className={ROW_LINK} aria-label={`ดูวันที่ ${formatThaiDate(c.date)} ในปฏิทิน`}>
            <AlertTriangle {...ICON_SM} className="mt-0.5 shrink-0 text-red-700" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm font-semibold text-gray-900 tabular-nums">{weekdayDayLabel(c.date)}</p>
              <p className="text-sm text-gray-700 break-words">{conflictPairText(c, lookup)}</p>
            </div>
            <ChevronRight {...ICON_SM} className="shrink-0 self-center text-gray-400" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
