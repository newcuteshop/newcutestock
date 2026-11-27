'use client'
// การ์ดแสดงผลของหน้ารายละเอียดงาน: ลูกค้า · คิวงาน · แพ็กเกจ/บริการเสริม · สรุปเงิน · งวดชำระ
// แสดงผลอย่างเดียว (ปุ่มเรียก callback ของหน้าแม่) — ตัวเลขเงินทั้งหมดมาจากเซิร์ฟเวอร์ (wed_recalc) ไม่คำนวณใหม่
// ค่าตัวทีม/ต้นทุน/กำไร: ฐานข้อมูลส่งมาเฉพาะผู้จัดการ (null = ไม่แสดง) — หน้าไม่ต้องเดาสิทธิ์เอง
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import {
  AlertTriangle, CalendarClock, CalendarDays, Check, CheckCircle2, Clock, Contact, Copy, ExternalLink, FileImage, Instagram, Mail,
  MapPin, MessageCircle, Package, Phone, RotateCcw, Shirt, StickyNote, UserRound, Users, Wallet,
} from 'lucide-react'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht, formatThaiDate, formatThaiDayLong } from '@/lib/format'
import {
  INSTALLMENT_STATUS_CHIP, INSTALLMENT_STATUS_LABELS, SESSION_STATUS_LABELS, callTimeText, crewConflictText, crewDisplayName,
  balanceDuePolicyText, balanceDueShortNotice, crewRoleLabel, formatPhone, phoneDigits, sessionTimeText, wedDepositCap, wedDepositPercent, wedNoDeposit,
  safeHttpUrl, sameHandle, wedSourceLabel,
  type WedBooking, type WedCapacityWarning, type WedSession, type WedSource,
} from '@/lib/wedding'
import { EPS, copyText, facebookUrl, instagramUrl, lineIdUrl } from './rpc'

// ---------------------------------------------------------------------------
// แถวช่องทางติดต่อ: แตะที่ค่า = คัดลอก · ปุ่มขวา = โทร/เปิดแอป
// ---------------------------------------------------------------------------
function ContactRow({
  icon,
  label,
  value,
  copyValue,
  href,
  hrefLabel,
  external = false,
  actionIcon,
}: {
  icon: JSX.Element
  label: string
  value: string
  copyValue?: string
  href?: string
  hrefLabel?: string
  external?: boolean
  /** ไอคอนปุ่มขวา (ไม่ส่ง = โทร / เปิดลิงก์ ตาม external) */
  actionIcon?: JSX.Element
}) {
  const [state, setState] = useState<'ok' | 'fail' | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  async function copy() {
    const ok = await copyText(copyValue ?? value)
    setState(ok ? 'ok' : 'fail')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState(null), 2000)
  }
  return (
    <div className="flex items-stretch gap-2">
      <button
        type="button"
        onClick={copy}
        className="panel flex min-h-[44px] min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left"
        aria-label={`คัดลอก${label} ${value}`}
      >
        <span className="shrink-0 text-gray-500">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] leading-tight text-gray-500">{label}</span>
          <span className="block break-all text-sm font-medium text-gray-900">{value}</span>
        </span>
        <span className="shrink-0 text-xs text-gray-500" aria-live="polite">
          {state === 'ok' ? <span className="inline-flex items-center gap-1 text-green-800"><Check {...ICON_XS} />คัดลอกแล้ว</span>
            : state === 'fail' ? 'คัดลอกไม่ได้' : <Copy {...ICON_XS} />}
        </span>
      </button>
      {href && (
        <a
          href={href}
          className="btn-icon h-11 w-11 shrink-0 self-center"
          aria-label={hrefLabel ?? label}
          {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {actionIcon ?? (external ? <ExternalLink {...ICON_SM} /> : <Phone {...ICON_SM} />)}
        </a>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ลูกค้า + ผู้ประสานงาน
// ---------------------------------------------------------------------------
export function CustomerCard({ booking }: { booking: WedBooking }) {
  const c = booking.customer
  const tel = phoneDigits(c.phone)
  const tel2 = phoneDigits(c.phone2)
  const lineUrl = lineIdUrl(c.line_id)
  const ig = instagramUrl(c.instagram)
  const fb = facebookUrl(c.facebook)
  const coordTel = phoneDigits(booking.coordinator_phone)
  // ช่องทางที่ติดต่อมาของงานนี้ + ชื่อในช่องทางนั้น (source_detail — fix-11) ขึ้นเป็นแถวแรก
  //   ไม่มีชื่อ (งานเก่า / ไม่ได้กรอก) = ไม่มีแถวนี้ (แบบเดิม) ; ชื่อเดียวกับช่องเดียวกันของลูกค้า = ไม่ขึ้นซ้ำอีกแถว
  const src = booking.source
  const srcDetail = booking.source_detail
  const srcHref = !srcDetail ? ''
    : src === 'facebook' ? facebookUrl(srcDetail)
      : src === 'instagram' ? instagramUrl(srcDetail)
        : src === 'line' ? lineIdUrl(srcDetail)
          : src === 'website' ? safeHttpUrl(srcDetail) ?? '' : ''
  const srcIcon = src === 'instagram' ? <Instagram {...ICON_SM} />
    : src === 'facebook' ? <UserRound {...ICON_SM} />
      : src === 'referral' ? <Users {...ICON_SM} />
        : src === 'website' ? <ExternalLink {...ICON_SM} /> : <MessageCircle {...ICON_SM} />
  const dupOf = (s: WedSource, v: string | null) => !!srcDetail && src === s && sameHandle(v, srcDetail)
  return (
    <section className="card" aria-labelledby="wb-customer">
      <div className="card-header">
        <h2 id="wb-customer" className="section-title">
          <Contact {...ICON} />
          ลูกค้า
        </h2>
        {c.id && <Link href={`/wedding/customers/${c.id}`} className="link text-sm">ประวัติลูกค้า</Link>}
      </div>
      <div className="p-4 sm:p-5 space-y-3">
        <div>
          <p className="text-lg font-semibold text-gray-900 break-words">{c.name || '-'}</p>
          {c.partner_name && <p className="text-sm text-gray-700 break-words">คู่: {c.partner_name}</p>}
          {c.source && <p className="text-xs text-gray-500 mt-0.5">รู้จักร้านจาก {wedSourceLabel(c.source)}</p>}
        </div>
        <div className="space-y-2">
          {srcDetail && (
            <ContactRow
              icon={srcIcon}
              label={src ? `ติดต่อมาทาง ${wedSourceLabel(src)}` : 'ช่องทางที่ติดต่อมา'}
              value={srcDetail}
              href={srcHref || undefined}
              hrefLabel={src ? `เปิด ${wedSourceLabel(src)}` : 'เปิดลิงก์'}
              external
            />
          )}
          {tel && <ContactRow icon={<Phone {...ICON_SM} />} label="เบอร์โทร" value={formatPhone(c.phone)} copyValue={tel} href={`tel:${tel}`} hrefLabel={`โทร ${formatPhone(c.phone)}`} />}
          {tel2 && <ContactRow icon={<Phone {...ICON_SM} />} label="เบอร์สำรอง" value={formatPhone(c.phone2)} copyValue={tel2} href={`tel:${tel2}`} hrefLabel={`โทร ${formatPhone(c.phone2)}`} />}
          {c.line_id && !dupOf('line', c.line_id) && <ContactRow icon={<MessageCircle {...ICON_SM} />} label="LINE ID" value={c.line_id} href={lineUrl || undefined} hrefLabel="เปิด LINE" external />}
          {c.instagram && !dupOf('instagram', c.instagram) && <ContactRow icon={<Instagram {...ICON_SM} />} label="Instagram" value={c.instagram} href={ig || undefined} hrefLabel="เปิด Instagram" external />}
          {c.facebook && !dupOf('facebook', c.facebook) && <ContactRow icon={<UserRound {...ICON_SM} />} label="Facebook" value={c.facebook} href={fb || undefined} hrefLabel="เปิด Facebook" external />}
          {c.email && <ContactRow icon={<Mail {...ICON_SM} />} label="อีเมล" value={c.email} href={`mailto:${c.email}`} hrefLabel="ส่งอีเมล" actionIcon={<Mail {...ICON_SM} />} />}
        </div>
        {c.address && (
          <div className="flex items-start gap-2 text-sm">
            <MapPin {...ICON_XS} className="mt-0.5 shrink-0 text-gray-400" />
            <p className="min-w-0 whitespace-pre-line break-words text-gray-800">{c.address}</p>
          </div>
        )}
        {c.note && (
          <div className="panel px-3 py-2 text-sm">
            <p className="text-xs font-medium text-gray-600">หมายเหตุลูกค้า</p>
            <p className="whitespace-pre-line break-words text-gray-900">{c.note}</p>
          </div>
        )}
        {(booking.coordinator_name || coordTel) && (
          <div className="border-t border-gray-100 pt-3 space-y-2">
            <p className="section-kicker">ผู้ประสานงานฝั่งลูกค้า</p>
            {booking.coordinator_name && <p className="text-sm font-medium text-gray-900 break-words">{booking.coordinator_name}</p>}
            {coordTel && (
              <ContactRow
                icon={<Phone {...ICON_SM} />}
                label="เบอร์ผู้ประสานงาน"
                value={formatPhone(booking.coordinator_phone)}
                copyValue={coordTel}
                href={`tel:${coordTel}`}
                hrefLabel={`โทร ${formatPhone(booking.coordinator_phone)}`}
              />
            )}
          </div>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// คิววันเต็ม (งานนี้นับเป็นคิวของวันนั้นแล้วเกินจำนวนต่อวัน)
// ---------------------------------------------------------------------------
export function CapacityAlert({ warnings }: { warnings: WedCapacityWarning[] }) {
  if (warnings.length === 0) return null
  return (
    <div role="alert" className="alert-warn">
      <AlertTriangle {...ICON_SM} />
      <div className="min-w-0 space-y-1">
        <p className="font-semibold">คิวเกินจำนวนงานต่อวัน</p>
        <ul className="list-disc pl-4 space-y-0.5">
          {warnings.map((w, i) => (
            <li key={`${w.date}-${i}`} className="break-words">
              {w.message ?? `${formatThaiDate(w.date)}: ${w.count_jobs} งาน (รับได้ ${w.capacity} งาน)`}
              {w.bookings.length > 0 && (
                <span className="block text-xs">
                  งานวันเดียวกัน: {w.bookings.map(b => [b.booking_no, b.couple_names].filter(Boolean).join(' ')).join(' · ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// คิวงาน (ทุกรายละเอียด + กำหนดการ + ทีมงาน + การชนกัน)
// ---------------------------------------------------------------------------
function SessionBlock({ s, index, onSchedule }: { s: WedSession; index: number; onSchedule?: (sessionId: string) => void }) {
  const cancelled = s.status === 'cancelled'
  const call = callTimeText(s.call_time)
  return (
    <li className={clsx('px-4 py-4 sm:px-5 space-y-3', cancelled && 'bg-gray-50')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="chip-outline">คิว {index + 1}</span>
            <span className="chip-strong">{s.type_label}</span>
            {s.status !== 'scheduled' && (
              <span className={s.status === 'done' ? 'badge-in' : 'badge-out'}>{SESSION_STATUS_LABELS[s.status]}</span>
            )}
          </div>
          {s.title && s.title !== s.type_label && <p className={clsx('font-semibold text-gray-900 break-words', cancelled && 'line-through')}>{s.title}</p>}
        </div>
        {onSchedule && !cancelled && s.date && (
          <button type="button" className="btn-soft min-h-[44px] px-3 text-sm" onClick={() => onSchedule(s.id)}>
            <FileImage {...ICON_XS} />
            ตารางคิว (รูป)
          </button>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div className="flex items-start gap-2">
          <dt className="sr-only">วันที่</dt>
          <CalendarDays {...ICON_XS} className="mt-0.5 shrink-0 text-gray-400" />
          <dd className="min-w-0 font-medium text-gray-900">{s.date ? formatThaiDayLong(s.date) : 'ยังไม่ระบุวันที่'}</dd>
        </div>
        <div className="flex items-start gap-2">
          <dt className="sr-only">เวลา</dt>
          <Clock {...ICON_XS} className="mt-0.5 shrink-0 text-gray-400" />
          <dd className="min-w-0 text-gray-900">
            {sessionTimeText(s)}
            {call && <span className="ml-1.5 chip-outline align-middle">{call}</span>}
          </dd>
        </div>
      </dl>

      {(s.venue_name || s.venue_address || s.map_url || s.venue_contact) && (
        <div className="panel px-3 py-2.5 text-sm space-y-1">
          <div className="flex items-start gap-2">
            <MapPin {...ICON_XS} className="mt-0.5 shrink-0 text-gray-400" />
            <div className="min-w-0 flex-1">
              {s.venue_name && <p className="font-medium text-gray-900 break-words">{s.venue_name}</p>}
              {s.venue_address && <p className="whitespace-pre-line break-words text-gray-700">{s.venue_address}</p>}
              {s.venue_contact && <p className="text-xs text-gray-600 break-words">ติดต่อสถานที่: {s.venue_contact}</p>}
            </div>
          </div>
          {s.map_url && (
            <a href={s.map_url} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-[40px] px-3 text-sm w-full sm:w-auto">
              <ExternalLink {...ICON_XS} />
              เปิดแผนที่
            </a>
          )}
        </div>
      )}

      {s.dress_code && (
        <p className="flex items-start gap-2 text-sm text-gray-800">
          <Shirt {...ICON_XS} className="mt-0.5 shrink-0 text-gray-400" />
          <span className="min-w-0 break-words"><span className="text-gray-600">การแต่งกาย:</span> {s.dress_code}</span>
        </p>
      )}
      {s.notes && (
        <p className="flex items-start gap-2 text-sm text-gray-800">
          <StickyNote {...ICON_XS} className="mt-0.5 shrink-0 text-gray-400" />
          <span className="min-w-0 whitespace-pre-line break-words">{s.notes}</span>
        </p>
      )}

      {s.run_sheet.length > 0 && (
        <div>
          <p className="section-kicker mb-1.5">กำหนดการ / ฤกษ์</p>
          <ol className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
            {s.run_sheet.map((r, i) => (
              <li key={i} className="flex gap-3 px-3 py-2">
                <span className="w-14 shrink-0 font-semibold tabular-nums text-gray-900">{r.time ?? '-'}</span>
                <span className="min-w-0 break-words text-gray-800">{r.text}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div>
        <p className="section-kicker mb-1.5 flex items-center gap-1"><Users {...ICON_XS} />ทีมงาน</p>
        {s.crew.length === 0 ? (
          <p className="text-sm text-gray-500">ยังไม่ได้จัดทีม</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {s.crew.map(c => (
              <li key={c.crew_id} className="panel flex items-center gap-2 px-2.5 py-1.5 text-sm">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: c.color }} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="font-medium text-gray-900">{crewDisplayName(c)}</span>
                  <span className="text-gray-600"> · {crewRoleLabel(c.role)}</span>
                  {c.fee !== null && (
                    <span className="block text-xs text-gray-600 tabular-nums">
                      ค่าตัว {baht(c.fee)} · {c.fee_paid_on ? `จ่ายแล้ว ${formatThaiDate(c.fee_paid_on)}` : 'ยังไม่จ่าย'}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {s.conflicts.length > 0 && (
        <div role="alert" className="alert-err">
          <AlertTriangle {...ICON_SM} />
          <div className="min-w-0 space-y-0.5">
            <p className="font-semibold">ทีมงานติดงานซ้อน</p>
            <ul className="list-disc pl-4">
              {s.conflicts.map((c, i) => <li key={i} className="break-words">{crewConflictText(c)}</li>)}
            </ul>
          </div>
        </div>
      )}
    </li>
  )
}

export function SessionsCard({
  booking,
  editHref,
  onSchedule,
}: {
  booking: WedBooking
  editHref?: string
  /** เปิดศูนย์เอกสาร "ตารางคิววันงาน" ของคิวนั้น (ส่งเข้ากลุ่ม LINE ทีม / ให้คู่บ่าวสาว) */
  onSchedule?: (sessionId: string) => void
}) {
  return (
    <section className="card" aria-labelledby="wb-sessions">
      <div className="card-header">
        <h2 id="wb-sessions" className="section-title">
          <CalendarClock {...ICON} />
          คิวงาน
          <span className="chip">{booking.sessions.length}</span>
        </h2>
        {editHref && <Link href={editHref} className="link text-sm">แก้คิวงาน</Link>}
      </div>
      {booking.sessions.length === 0 ? (
        <p className="empty-state">ยังไม่มีคิวงาน — กด &quot;แก้ไขงาน&quot; เพื่อเพิ่มวันงาน</p>
      ) : (
        <ol className="divide-y divide-gray-100">
          {booking.sessions.map((s, i) => <SessionBlock key={s.id} s={s} index={i} onSchedule={onSchedule} />)}
        </ol>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// แพ็กเกจ + บริการเสริม + แผนงานที่ต้องส่ง
// ---------------------------------------------------------------------------
export function PackageCard({ booking }: { booking: WedBooking }) {
  const p = booking.package
  const showPlan = booking.deliverables.length === 0 && booking.deliverables_plan.length > 0
  return (
    <section className="card" aria-labelledby="wb-package">
      <div className="card-header">
        <h2 id="wb-package" className="section-title">
          <Package {...ICON} />
          แพ็กเกจ / บริการเสริม
        </h2>
      </div>
      <div className="p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 break-words">{p.name || 'ไม่ระบุแพ็กเกจ'}</p>
            <p className="text-xs text-gray-600">
              {p.id ? 'จากรายการแพ็กเกจ' : 'แพ็กเกจกำหนดเอง'}{p.hours > 0 ? ` · ${p.hours} ชั่วโมง` : ''}
            </p>
          </div>
          <span className="money text-gray-900">{baht(p.price)}</span>
        </div>
        {p.description && <p className="whitespace-pre-line break-words text-sm text-gray-700">{p.description}</p>}

        {booking.addons.length > 0 && (
          <div>
            <p className="section-kicker mb-1.5">บริการเสริม</p>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm">
              {booking.addons.map(a => (
                <li key={a.id || a.name} className="flex items-start justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 break-words text-gray-900">
                    {a.name}
                    <span className="block text-xs text-gray-500 tabular-nums">
                      {a.qty} {a.unit ?? 'รายการ'} × {baht(a.unit_price)}
                    </span>
                  </span>
                  <span className="money shrink-0 text-gray-900">{baht(a.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {booking.travel_fee > 0 && (
          <div className="flex justify-between gap-3 text-sm">
            <span className="text-gray-700">ค่าเดินทาง</span>
            <span className="money text-gray-900">{baht(booking.travel_fee)}</span>
          </div>
        )}

        {showPlan && (
          <div>
            <p className="section-kicker mb-1.5">งานที่ต้องส่ง (ตามแพ็กเกจ)</p>
            <ul className="space-y-1 text-sm">
              {booking.deliverables_plan.map((d, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="min-w-0 break-words text-gray-900">{d.name}{d.qty > 1 ? ` ${d.qty}${d.unit ? ` ${d.unit}` : ''}` : ''}</span>
                  <span className="shrink-0 text-xs text-gray-600">ส่งภายใน {d.due_days} วันหลังวันงาน</span>
                </li>
              ))}
            </ul>
            <p className="field-hint">สร้างเป็นรายการส่งงานให้อัตโนมัติเมื่อยืนยันงาน</p>
          </div>
        )}
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

export function MoneyCard({ booking, onOpenPayment }: { booking: WedBooking; onOpenPayment?: () => void }) {
  const m = booking.money
  const tone = m.due > EPS ? 'due' : m.due < -EPS ? 'over' : 'clear'
  const noDeposit = wedNoDeposit(m)
  const pct = wedDepositPercent(m)
  const policy = [
    pct !== null ? `${pct}%` : '',
    m.min_deposit !== null && m.min_deposit > 0 ? `ขั้นต่ำ ${baht(m.min_deposit)}` : '',
  ].filter(Boolean).join(' · ')
  // มัดจำกำหนดเอง: ไม่อ้าง % ; ใส่ไว้เกินยอดหลังส่วนลด = ฐานข้อมูลใช้เท่ายอดนั้น (บอกค่าที่ใส่ไว้ให้รู้)
  const cap = wedDepositCap(m)
  const depositSub = m.deposit_source === 'manual'
    ? cap.capped && m.deposit_override !== null
      ? `กำหนดเอง ${baht(m.deposit_override)} — เกิน${cap.label} จึงใช้เท่า${cap.label}`
      : 'กำหนดเองสำหรับงานนี้'
    : policy ? `นโยบายตอนจอง ${policy}` : ''
  return (
    <section className="card" aria-labelledby="wb-money">
      <div className="card-header">
        <h2 id="wb-money" className="section-title">
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
        <div className="grid grid-cols-2 gap-2">
          <div
            className={clsx(
              'rounded-lg border px-3 py-2.5',
              tone === 'due' && 'border-red-200 bg-red-50',
              tone === 'over' && 'border-amber-200 bg-amber-50',
              tone === 'clear' && 'border-green-200 bg-green-50',
            )}
          >
            <p className={clsx('text-xs font-medium', tone === 'due' ? 'text-red-800' : tone === 'over' ? 'text-amber-800' : 'text-green-800')}>
              {tone === 'due' ? 'ค้างชำระ' : tone === 'over' ? 'รับเกิน ต้องคืนลูกค้า' : 'ชำระครบแล้ว'}
            </p>
            <p className={clsx('money text-xl', tone === 'due' ? 'text-red-700' : tone === 'over' ? 'text-amber-800' : 'text-green-800')}>
              {baht(Math.abs(m.due))}
            </p>
          </div>
          {noDeposit ? (
            // มัดจำ 0 (กำหนด 0 / นโยบาย 0%) = งานนี้ไม่เก็บมัดจำ — ไม่เขียนว่า "มัดจำครบแล้ว ฿0"
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
              <p className="text-xs font-medium text-gray-700">มัดจำ</p>
              <p className="text-lg font-semibold leading-7 text-gray-900">ไม่เก็บมัดจำ</p>
            </div>
          ) : (
            <div className={clsx('rounded-lg border px-3 py-2.5', m.deposit_met ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50')}>
              <p className={clsx('text-xs font-medium', m.deposit_met ? 'text-green-800' : 'text-amber-800')}>
                {m.deposit_met ? 'มัดจำครบแล้ว' : 'มัดจำยังขาด'}
              </p>
              <p className={clsx('money text-xl', m.deposit_met ? 'text-green-800' : 'text-amber-800')}>
                {baht(m.deposit_met ? m.deposit_required : m.deposit_due)}
              </p>
              {!m.deposit_met && <p className="text-[11px] text-gray-600">จากมัดจำ {baht(m.deposit_required)}</p>}
            </div>
          )}
        </div>

        <dl className="space-y-1.5 text-sm text-gray-700">
          <Row label="แพ็กเกจ" value={baht(m.package_price)} />
          {m.addons_total > 0 && <Row label="บริการเสริม" value={baht(m.addons_total)} />}
          {m.travel_fee > 0 && <Row label="ค่าเดินทาง" value={baht(m.travel_fee)} />}
          {m.discount > 0 && <Row label="ส่วนลด" sub={m.discount_note ?? undefined} value={`-${baht(m.discount)}`} />}
          <Row label="ยอดหลังส่วนลด" value={baht(m.base_total)} className="border-t border-gray-200 pt-1.5" />
          {m.charges_total > 0 && <Row label="ค่าใช้จ่ายเพิ่ม" sub="ล่วงเวลา / เดินทางเพิ่ม / บริการเพิ่ม" value={baht(m.charges_total)} />}
          <Row label="ยอดสุทธิ" value={baht(m.grand_total)} className="border-t border-gray-200 pt-1.5 font-semibold text-gray-900" />
          <Row label="ชำระแล้ว" sub="รับชำระ − คืนเงิน" value={baht(m.paid)} />
          <Row
            label={tone === 'over' ? 'รับเกิน (ต้องคืน)' : 'ค้างชำระ'}
            value={baht(Math.abs(m.due))}
            className={clsx('font-semibold', tone === 'due' ? 'text-red-700' : tone === 'over' ? 'text-amber-800' : 'text-gray-900')}
          />
        </dl>

        <dl className="space-y-1.5 border-t border-gray-200 pt-3 text-sm text-gray-700">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="min-w-0">
              มัดจำที่ต้องชำระ
              {depositSub && <span className="block text-xs text-gray-500">{depositSub}</span>}
            </dt>
            {noDeposit ? (
              <dd className="text-gray-900">ไม่เก็บมัดจำ</dd>
            ) : (
              <dd className="flex items-center gap-1.5 tabular-nums">
                {baht(m.deposit_required)}
                {m.deposit_met
                  ? <span className="badge-in"><CheckCircle2 {...ICON_XS} />ครบ</span>
                  : <span className="badge-return">ขาด {baht(m.deposit_due)}</span>}
              </dd>
            )}
          </div>
          {m.balance_due_date && (
            <Row
              label="ชำระยอดคงเหลือภายใน"
              sub={m.balance_due_date_override ? 'กำหนดเองสำหรับงานนี้'
                : balanceDueShortNotice(m.balance_due_date, booking.first_date, m.balance_due_days) ? 'งานกระชั้นชิด — ภายในวันที่จอง'
                : m.balance_due_days !== null ? balanceDuePolicyText(m.balance_due_days) : undefined}
              value={formatThaiDate(m.balance_due_date)}
            />
          )}
        </dl>

        {(m.crew_cost_total !== null || m.profit !== null) && (
          <dl className="space-y-1.5 border-t border-gray-200 pt-3 text-sm text-gray-700">
            <p className="section-kicker">เฉพาะผู้จัดการ</p>
            {m.crew_cost_total !== null && <Row label="ค่าตัวทีมงาน (ต้นทุน)" value={baht(m.crew_cost_total)} />}
            {m.profit !== null && (
              <Row
                label="กำไรขั้นต้น"
                sub="ยอดสุทธิ − ค่าตัวทีมงาน"
                value={baht(m.profit)}
                className={clsx('font-semibold', m.profit < 0 ? 'text-red-700' : 'text-gray-900')}
              />
            )}
          </dl>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// งวดชำระ
// ---------------------------------------------------------------------------
export function InstallmentsCard({
  booking,
  onEdit,
  onReset,
}: {
  booking: WedBooking
  onEdit?: () => void
  onReset?: () => void
}) {
  const list = booking.installments
  return (
    <section className="card" aria-labelledby="wb-installments">
      <div className="card-header flex-wrap">
        <h2 id="wb-installments" className="section-title">
          <CalendarClock {...ICON} />
          งวดชำระ
          {booking.installments_custom && <span className="chip-outline">แก้เอง</span>}
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {onReset && booking.installments_custom && (
            <button type="button" className="btn-ghost min-h-[40px] px-2.5 text-sm" onClick={onReset}>
              <RotateCcw {...ICON_XS} />
              งวดมาตรฐาน
            </button>
          )}
          {onEdit && (
            <button type="button" className="btn-soft min-h-[40px] px-3 text-sm" onClick={onEdit}>แก้งวด</button>
          )}
        </div>
      </div>
      {list.length === 0 ? (
        <p className="empty-state">{booking.money.grand_total > EPS ? 'ยังไม่มีงวดชำระ' : 'ยอดสุทธิเป็น 0 — ไม่มีงวดชำระ'}</p>
      ) : (
        <ol className="divide-y divide-gray-100">
          {list.map(i => (
            <li key={i.id || i.seq} className={clsx('flex items-start justify-between gap-3 px-4 py-3 sm:px-5', i.overdue && 'bg-red-50')}>
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold text-gray-900 break-words">{i.seq}. {i.label || `งวดที่ ${i.seq}`}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={INSTALLMENT_STATUS_CHIP[i.status]}>{INSTALLMENT_STATUS_LABELS[i.status]}</span>
                  {i.overdue && <span className="badge-out"><AlertTriangle {...ICON_XS} />เลยกำหนด</span>}
                  <span className="text-xs text-gray-600">{i.due_date ? `ครบกำหนด ${formatThaiDate(i.due_date)}` : 'ไม่ระบุวันครบกำหนด'}</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="money text-gray-900">{baht(i.amount)}</p>
                {i.status !== 'paid' && i.paid_amount > EPS && <p className="text-xs text-gray-600 tabular-nums">จ่ายแล้ว {baht(i.paid_amount)}</p>}
                {i.status !== 'paid' && <p className="text-xs font-medium text-red-700 tabular-nums">ค้าง {baht(i.amount_remaining)}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
