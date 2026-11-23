'use client'
// รายละเอียดลูกค้าร้าน b.oncloud: ข้อมูลติดต่อ (โทร / LINE / IG / Facebook กดเปิดได้ + คัดลอก) · ยอดรวม · ประวัติงานทั้งหมด (ล่าสุด 100 งาน)
// แก้ไขในหน้าเดียวกัน (CustomerForm แบบแก้ไข — กันเขียนทับด้วย updated_at)
// ผลการบันทึกของ wed_save_customer ไม่มีรายการงาน → คงประวัติงานเดิมไว้ (แก้ข้อมูลลูกค้าไม่เปลี่ยนงาน)
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import {
  ArrowLeft, CalendarPlus, Check, CheckCircle2, ChevronRight, ClipboardList, Contact, Copy, Facebook, Info, Instagram,
  Mail, MessageCircle, Pencil, Phone,
} from 'lucide-react'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht, formatThaiDate, formatThaiDateTime } from '@/lib/format'
import {
  WED_SOURCE_LABELS, WED_STATUS_CHIP, formatPhone, isOpenWedStatus, type WedBookingMini, type WedCustomerDetail,
} from '@/lib/wedding'
import { fmtCount, telHref, wedBookingHref, wedNewBookingHref } from '@/components/wedding/money/wedRpc'
import CustomerForm from './CustomerForm'
import { customerTitle, facebookHref, instagramHref, lineHref } from './customerModel'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 py-2.5 sm:grid-cols-[8rem_1fr] sm:gap-3">
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="min-w-0 text-sm text-gray-900 break-words">{children}</dd>
    </div>
  )
}

// ปุ่มคัดลอกข้อความ (เบอร์/ไอดี) — คัดลอกไม่ได้ (เบราว์เซอร์ไม่ให้สิทธิ์) ก็ไม่เป็นไร ข้อความยังอยู่ให้กดค้างคัดลอกเอง
function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setDone(true)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setDone(false), 1800)
    } catch {
      setDone(false)
    }
  }
  return (
    <button type="button" onClick={() => void copy()} className="btn-ghost px-3 text-sm" aria-label={`คัดลอก${label}`}>
      {done ? <Check {...ICON_XS} /> : <Copy {...ICON_XS} />}
      <span aria-live="polite">{done ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>
    </button>
  )
}

// งานที่ยังมียอดค้างให้ตามเก็บ (ไม่นับสอบถาม/ยกเลิก — ยังไม่ได้ตกลงราคา/ไม่ต้องเก็บแล้ว)
function owes(b: WedBookingMini): boolean {
  return b.status !== 'inquiry' && b.status !== 'cancelled' && b.due > 0.005
}

function eventText(b: WedBookingMini): string {
  if (!b.first_date) return 'ยังไม่กำหนดวัน'
  if (b.last_date && b.last_date !== b.first_date) return `${formatThaiDate(b.first_date)} – ${formatThaiDate(b.last_date)}`
  return formatThaiDate(b.first_date)
}

export default function CustomerDetailClient({
  initial,
  savedNotice,
}: {
  initial: WedCustomerDetail
  savedNotice: 'new' | 'again' | null
}) {
  const [customer, setCustomer] = useState<WedCustomerDetail>(initial)
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState(
    savedNotice === 'new' ? 'เพิ่มลูกค้าใหม่แล้ว'
      : savedNotice === 'again' ? 'ลูกค้านี้ถูกบันทึกไว้แล้วจากการกดครั้งก่อน (ระบบไม่ได้สร้างซ้ำ)'
        : '',
  )

  // ล้าง ?saved= ออกจาก URL — โหลดหน้าใหม่แล้วข้อความ "บันทึกแล้ว" ไม่ค้าง
  useEffect(() => {
    if (!savedNotice) return
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('saved')
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    } catch {
      // ไม่เป็นไร
    }
  }, [savedNotice])

  const c = customer
  const st = c.stats
  const tel = telHref(c.phone)
  const tel2 = telHref(c.phone2)
  const line = lineHref(c.line_id)
  const ig = instagramHref(c.instagram)
  const fb = facebookHref(c.facebook)
  const activeCount = st ? st.active : c.bookings.filter(b => isOpenWedStatus(b.status)).length
  const lastEvent = st?.last_event_date ?? null

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <Link href="/wedding/customers" className="link -mt-2 text-sm">
            <ArrowLeft {...ICON_SM} />
            กลับไปรายชื่อลูกค้า
          </Link>
          <h1 className="page-title break-words">{customerTitle(c)}</h1>
          <p className="page-subtitle flex flex-wrap items-center gap-2">
            {c.source && <span className="chip">{WED_SOURCE_LABELS[c.source]}</span>}
            {c.created_at && <span>ลูกค้าตั้งแต่ {formatThaiDate(c.created_at)}</span>}
          </p>
        </div>
        {!editing && (
          <div className="page-actions">
            <Link href={wedNewBookingHref(c.id)} className="btn-primary">
              <CalendarPlus {...ICON_SM} />
              สร้างงานให้ลูกค้านี้
            </Link>
            <button type="button" onClick={() => { setEditing(true); setNotice('') }} className="btn-secondary">
              <Pencil {...ICON_SM} />
              แก้ไขข้อมูล
            </button>
          </div>
        )}
      </div>

      <div aria-live="polite" className="space-y-2">
        {notice && (
          <p className="alert-ok"><CheckCircle2 {...ICON_SM} /><span className="min-w-0 break-words">{notice}</span></p>
        )}
      </div>

      {editing ? (
        <div className="mx-auto w-full max-w-3xl">
          <CustomerForm
            mode="edit"
            initial={c}
            onSaved={(saved, info) => {
              // ผลบันทึกมีสถิติชุดใหม่ (stats) แต่ไม่มีรายการงาน → ยอดรวมตามสถิติใหม่ ประวัติงานคงเดิม
              setCustomer(prev => {
                const stats = saved.stats ?? prev.stats
                return {
                  ...prev,
                  ...saved,
                  stats,
                  bookings: prev.bookings,
                  totals: stats
                    ? { bookings: stats.bookings, grand_total: stats.total_value, paid: stats.total_paid, due: stats.total_due }
                    : prev.totals,
                }
              })
              setEditing(false)
              setNotice(info.already_saved ? 'ข้อมูลถูกบันทึกไว้แล้ว' : 'บันทึกการแก้ไขแล้ว')
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <>
          {/* ===== สถิติ ===== */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="stat-card">
              <p className="stat-label">งานทั้งหมด</p>
              <p className="stat-value">
                <span className="whitespace-nowrap">{fmtCount(c.totals.bookings)}</span> <span className="stat-sub">งาน</span>
              </p>
              {activeCount > 0 && <p className="stat-sub">กำลังดำเนินการ {fmtCount(activeCount)}</p>}
            </div>
            <div className="stat-card">
              <p className="stat-label">วันงานล่าสุด</p>
              <p className="stat-value"><span className="whitespace-nowrap">{lastEvent ? formatThaiDate(lastEvent) : '-'}</span></p>
            </div>
            <div className="stat-card">
              <p className="stat-label">มูลค่างานรวม</p>
              <p className="stat-value"><span className="whitespace-nowrap">{baht(c.totals.grand_total)}</span></p>
              <p className="stat-sub">ไม่นับงานที่ยกเลิก</p>
            </div>
            <div className={clsx('stat-card', c.totals.due > 0.005 && 'border-amber-200')}>
              <p className="stat-label">ชำระแล้ว</p>
              <p className="stat-value"><span className="whitespace-nowrap">{baht(c.totals.paid)}</span></p>
              {c.totals.due > 0.005 && <p className="stat-sub font-medium text-amber-800">ค้างชำระ {baht(c.totals.due)}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 sm:gap-6 items-start">
            {/* ===== ข้อมูลลูกค้า ===== */}
            <section className="card overflow-hidden xl:col-span-2" aria-labelledby="wed-customer-info-title">
              <div className="card-header">
                <h2 id="wed-customer-info-title" className="section-title"><Contact {...ICON} />ข้อมูลลูกค้า</h2>
              </div>
              <dl className="divide-y divide-gray-150 px-4 sm:px-5">
                <Row label="ผู้ติดต่อหลัก">{c.name}</Row>
                <Row label="ชื่อคู่">{c.partner_name || '-'}</Row>
                <Row label="เบอร์โทร">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="tabular-nums">{formatPhone(c.phone) || '-'}</span>
                    {tel && (
                      <a href={tel} className="btn-soft px-3 text-sm" aria-label={`โทรหา ${c.name}`}>
                        <Phone {...ICON_XS} />
                        โทร
                      </a>
                    )}
                    {c.phone && <CopyButton value={c.phone} label="เบอร์โทร" />}
                  </span>
                </Row>
                {c.phone2 && (
                  <Row label="เบอร์สำรอง">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="tabular-nums">{formatPhone(c.phone2)}</span>
                      {tel2 && (
                        <a href={tel2} className="btn-soft px-3 text-sm" aria-label={`โทรเบอร์สำรองของ ${c.name}`}>
                          <Phone {...ICON_XS} />
                          โทร
                        </a>
                      )}
                    </span>
                  </Row>
                )}
                <Row label="LINE ID">
                  {c.line_id ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="break-all">{c.line_id}</span>
                      {line && (
                        <a href={line} target="_blank" rel="noopener noreferrer" className="btn-soft px-3 text-sm">
                          <MessageCircle {...ICON_XS} />
                          เปิด LINE
                        </a>
                      )}
                      <CopyButton value={c.line_id} label="LINE ID" />
                    </span>
                  ) : '-'}
                </Row>
                <Row label="Instagram">
                  {c.instagram ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="break-all">{c.instagram}</span>
                      {ig && (
                        <a href={ig} target="_blank" rel="noopener noreferrer" className="btn-soft px-3 text-sm">
                          <Instagram {...ICON_XS} />
                          เปิด IG
                        </a>
                      )}
                    </span>
                  ) : '-'}
                </Row>
                <Row label="Facebook">
                  {c.facebook ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="break-all">{c.facebook}</span>
                      {fb && (
                        <a href={fb} target="_blank" rel="noopener noreferrer" className="btn-soft px-3 text-sm">
                          <Facebook {...ICON_XS} />
                          เปิด Facebook
                        </a>
                      )}
                    </span>
                  ) : '-'}
                </Row>
                <Row label="อีเมล">
                  {c.email ? (
                    <a href={`mailto:${c.email}`} className="inline-flex min-h-[44px] items-center gap-1.5 text-brand-700 underline-offset-4 [@media(hover:hover)]:hover:underline break-all">
                      <Mail {...ICON_XS} />
                      {c.email}
                    </a>
                  ) : '-'}
                </Row>
                <Row label="ที่อยู่"><span className="whitespace-pre-line">{c.address || '-'}</span></Row>
                <Row label="หมายเหตุ"><span className="whitespace-pre-line">{c.note || '-'}</span></Row>
                {c.updated_at && <Row label="แก้ไขล่าสุด"><span className="tabular-nums">{formatThaiDateTime(c.updated_at)}</span></Row>}
              </dl>
            </section>

            {/* ===== ประวัติงาน ===== */}
            <section className="card overflow-hidden xl:col-span-3" aria-labelledby="wed-customer-bookings-title">
              <div className="card-header">
                <h2 id="wed-customer-bookings-title" className="section-title min-w-0 flex-wrap gap-y-0">
                  <ClipboardList {...ICON} />
                  ประวัติงาน
                  {c.bookings.length > 0 && (
                    <span className="text-sm font-normal text-gray-500">
                      ({fmtCount(c.bookings.length)}{c.totals.bookings > c.bookings.length ? ` จาก ${fmtCount(c.totals.bookings)}` : ''})
                    </span>
                  )}
                </h2>
              </div>
              {c.bookings.length === 0 ? (
                <div className="empty-state">
                  <span className="icon-bubble icon-bubble-lg"><ClipboardList size={28} strokeWidth={1.75} aria-hidden="true" /></span>
                  <p className="empty-state-title">ยังไม่มีงานของลูกค้านี้</p>
                  <Link href={wedNewBookingHref(c.id)} className="btn-soft mt-2">
                    <CalendarPlus {...ICON_SM} />
                    สร้างงานให้ลูกค้านี้
                  </Link>
                </div>
              ) : (
                <>
                  <ul className="md:hidden divide-y divide-gray-150">
                    {c.bookings.map(b => (
                      <li key={b.id}>
                        <Link
                          href={wedBookingHref(b.id)}
                          prefetch={false}
                          className="flex min-h-[56px] items-center gap-3 px-4 py-3 transition-colors active:bg-gray-100"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="font-mono text-xs text-gray-700 break-all">{b.booking_no}</span>
                              <span className={WED_STATUS_CHIP[b.status]}>{b.status_label}</span>
                            </p>
                            <p className="text-sm text-gray-900 break-words">{b.couple_names}</p>
                            <p className="text-xs text-gray-600 tabular-nums">
                              {eventText(b)}{b.package_name ? ` · ${b.package_name}` : ''}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="money text-sm text-gray-900">{baht(b.grand_total)}</p>
                            {owes(b) && <p className="text-xs font-medium text-amber-800 tabular-nums">ค้าง {baht(b.due)}</p>}
                          </div>
                          <ChevronRight {...ICON_SM} className="shrink-0 text-gray-400" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <div className="hidden md:block table-wrap">
                    <table className="table-soft min-w-[640px]">
                      <thead>
                        <tr>
                          <th>เลขที่</th>
                          <th>คู่บ่าวสาว / แพ็กเกจ</th>
                          <th>สถานะ</th>
                          <th>วันงาน</th>
                          <th className="text-right">ยอดสุทธิ</th>
                          <th className="text-right">ค้างชำระ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.bookings.map(b => (
                          <tr key={b.id}>
                            <td className="whitespace-nowrap">
                              <Link href={wedBookingHref(b.id)} prefetch={false} className="font-mono text-xs text-brand-700 underline-offset-4 [@media(hover:hover)]:hover:underline">
                                {b.booking_no}
                              </Link>
                            </td>
                            <td className="min-w-[160px]">
                              <span className="block text-gray-900 break-words">{b.couple_names}</span>
                              {b.package_name && <span className="block text-xs text-gray-500 break-words">{b.package_name}</span>}
                            </td>
                            <td><span className={WED_STATUS_CHIP[b.status]}>{b.status_label}</span></td>
                            <td className="whitespace-nowrap text-gray-700 tabular-nums">{eventText(b)}</td>
                            <td className="text-right money text-gray-900 whitespace-nowrap">{baht(b.grand_total)}</td>
                            <td className={clsx('text-right whitespace-nowrap', owes(b) ? 'money text-amber-800' : 'text-gray-400')}>
                              {owes(b) ? baht(b.due) : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {c.totals.bookings > c.bookings.length && (
                    <p className="flex items-start gap-1.5 border-t border-gray-150 px-4 py-2.5 sm:px-5 text-xs text-gray-500">
                      <Info {...ICON_XS} className="mt-px shrink-0" />
                      แสดง {fmtCount(c.bookings.length)} งานล่าสุด
                    </p>
                  )}
                </>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
