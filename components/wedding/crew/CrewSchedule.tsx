'use client'
// ตารางงานรายเดือนของทีมงาน 1 คน (wed_crew_schedule) — คิวของงานที่กันคิวแล้ว (ล็อกคิว/ยืนยัน/ถ่ายเสร็จ/ส่งแล้ว/ปิดงาน)
// ไม่นับคิวที่ยกเลิก · ค่าตัวรายคิว + สถานะจ่าย แสดงเฉพาะผู้จัดการ (พนักงานไม่ได้รับค่าตัวจากฐานข้อมูลเลย)
// สรุปจำนวนคิว/วันทำงานของเดือน = ภาระงานของคนนั้น · ปุ่ม "คัดลอกตารางงาน" ส่งให้ทีมงานทาง LINE ได้ทันที
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import {
  AlertCircle, CalendarDays, ChevronLeft, ChevronRight, Clock, Copy, ExternalLink, MapPin, RefreshCw,
} from 'lucide-react'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { baht, formatThaiDate, formatThaiDayLong } from '@/lib/format'
import {
  crewDisplayName, crewRoleLabel, parseCrewSchedule, SESSION_STATUS_LABELS, thaiMonthYear, WED_STATUS_CHIP,
  WED_STATUS_SHORT, type WedCrew, type WedCrewSchedule, type WedCrewScheduleItem,
} from '@/lib/wedding'
import type { ToastValue } from '@/components/wedding/settings/PageToast'
import { callRpc, copyText, wedErrorText } from '@/components/wedding/settings/wedRpc'
import CrewAvatar from './CrewAvatar'
import { addMonths, monthOf, monthRange, scheduleLineText, scheduleTimeText } from './crewModel'

function groupByDate(items: readonly WedCrewScheduleItem[]): { date: string | null; items: WedCrewScheduleItem[] }[] {
  const out: { date: string | null; items: WedCrewScheduleItem[] }[] = []
  for (const s of items) {
    const last = out[out.length - 1]
    if (last && last.date === s.date) last.items.push(s)
    else out.push({ date: s.date, items: [s] })
  }
  return out
}

export default function CrewSchedule({
  crew,
  crewId,
  month,
  manager,
  today,
  onChange,
  onMessage,
}: {
  crew: readonly WedCrew[]
  crewId: string | null
  month: string
  manager: boolean
  today: string
  onChange: (crewId: string | null, month: string) => void
  onMessage: (t: ToastValue) => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [data, setData] = useState<{ key: string; value: WedCrewSchedule } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const reqRef = useRef(0)

  const selected = crew.find(c => c.id === crewId) ?? null
  const key = crewId ? `${crewId}|${month}` : ''

  const load = useCallback(async () => {
    if (!crewId) return
    const id = ++reqRef.current
    const { from, to } = monthRange(month)
    setLoading(true)
    setError('')
    const res = await callRpc(supabase, 'wed_crew_schedule', { p_crew_id: crewId, p_from: from, p_to: to })
    if (id !== reqRef.current) return
    setLoading(false)
    if (!res.ok) {
      setError(wedErrorText(res.error))
      return
    }
    setData({ key: `${crewId}|${month}`, value: parseCrewSchedule(res.data) })
  }, [supabase, crewId, month])

  useEffect(() => {
    void load()
  }, [load])

  const shown = data && data.key === key ? data.value : null
  const groups = useMemo(() => (shown ? groupByDate(shown.sessions) : []), [shown])
  const thisMonth = monthOf(today)

  async function copySchedule() {
    if (!selected || !shown) return
    const ok = await copyText(scheduleLineText(selected, month, shown.sessions, manager))
    onMessage(ok
      ? { ok: true, text: `คัดลอกตารางงานของ ${crewDisplayName(selected)} แล้ว — วางในแชท LINE ได้เลย` }
      : { ok: false, text: 'คัดลอกไม่สำเร็จ — เบราว์เซอร์นี้ไม่อนุญาตให้คัดลอกอัตโนมัติ' })
  }

  const activeCrew = crew.filter(c => c.is_active)
  const inactiveCrew = crew.filter(c => !c.is_active)

  return (
    <section className="card min-w-0" aria-labelledby="wcs-title">
      <div className="card-header flex-wrap gap-2">
        <h2 id="wcs-title" className="section-title">
          <CalendarDays {...ICON} />
          ตารางงานรายคน
        </h2>
        {selected && shown && (
          <button type="button" onClick={() => void copySchedule()} className="btn-secondary px-3">
            <Copy {...ICON_SM} />
            คัดลอกตารางงาน (ส่ง LINE)
          </button>
        )}
      </div>
      <div className="space-y-4 p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="min-w-0">
            <label htmlFor="wcs-crew" className="field-label">ทีมงาน</label>
            <select
              id="wcs-crew"
              className="input"
              value={crewId ?? ''}
              onChange={e => onChange(e.target.value || null, month)}
            >
              <option value="">— เลือกทีมงาน —</option>
              {activeCrew.map(c => (
                <option key={c.id} value={c.id}>{crewDisplayName(c)} · {crewRoleLabel(c.role)}</option>
              ))}
              {inactiveCrew.length > 0 && (
                <optgroup label="ปิดใช้งานแล้ว">
                  {inactiveCrew.map(c => (
                    <option key={c.id} value={c.id}>{crewDisplayName(c)} · {crewRoleLabel(c.role)}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="เลือกเดือน">
            <button
              type="button"
              onClick={() => onChange(crewId, addMonths(month, -1))}
              className="btn-icon"
              aria-label="เดือนก่อนหน้า"
            >
              <ChevronLeft {...ICON_SM} />
            </button>
            <p className="min-w-[8.5rem] flex-1 text-center text-base font-semibold text-gray-900 tabular-nums md:flex-none" aria-live="polite">
              {thaiMonthYear(month)}
            </p>
            <button
              type="button"
              onClick={() => onChange(crewId, addMonths(month, 1))}
              className="btn-icon"
              aria-label="เดือนถัดไป"
            >
              <ChevronRight {...ICON_SM} />
            </button>
            {month !== thisMonth && (
              <button type="button" onClick={() => onChange(crewId, thisMonth)} className="btn-secondary ml-1 px-3">
                เดือนนี้
              </button>
            )}
          </div>
        </div>

        {!crewId ? (
          <div className="empty-state rounded-lg border border-dashed border-gray-300">
            <CalendarDays size={28} strokeWidth={1.6} aria-hidden="true" className="text-gray-400" />
            <p className="empty-state-title">เลือกทีมงานเพื่อดูตารางงาน</p>
            <p>เห็นทุกคิวของเดือน เวลาทีมถึงงาน สถานที่ และหน้าที่ของคนนั้น</p>
          </div>
        ) : error && !shown ? (
          <div role="alert" className="alert-err">
            <AlertCircle {...ICON_SM} />
            <div className="min-w-0 space-y-2">
              <p className="break-words">{error}</p>
              <button type="button" onClick={() => void load()} className="btn-secondary bg-white px-4 text-sm">
                <RefreshCw {...ICON_SM} />
                ลองอีกครั้ง
              </button>
            </div>
          </div>
        ) : !shown ? (
          <div className="space-y-2" role="status">
            <span className="sr-only">กำลังโหลดตารางงาน...</span>
            {[0, 1, 2].map(i => <div key={i} className="skeleton h-20 rounded-lg" />)}
          </div>
        ) : (
          <div className={clsx('space-y-4', loading && 'opacity-60')} aria-busy={loading}>
            {selected && (
              <div className="panel flex flex-wrap items-center gap-3 p-3">
                <CrewAvatar crew={selected} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 break-words">{crewDisplayName(selected)}</p>
                  <p className="text-sm text-gray-600">{crewRoleLabel(selected.role)}{!selected.is_active && ' · ปิดใช้งานแล้ว'}</p>
                </div>
                <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                  <div>
                    <dt className="text-xs text-gray-500">คิวงาน</dt>
                    <dd className="money text-gray-900">{shown.totals.sessions.toLocaleString('en-US')} คิว</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">วันทำงาน</dt>
                    <dd className="money text-gray-900">{shown.totals.days.toLocaleString('en-US')} วัน</dd>
                  </div>
                  {manager && shown.totals.fees !== null && (
                    <>
                      <div>
                        <dt className="text-xs text-gray-500">ค่าตัวรวม</dt>
                        <dd className="money text-gray-900">{baht(shown.totals.fees)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">ค้างจ่าย</dt>
                        <dd className={clsx('money', (shown.totals.unpaid ?? 0) > 0 ? 'text-amber-800' : 'text-gray-900')}>
                          {baht(shown.totals.unpaid ?? 0)}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
              </div>
            )}
            {error && (
              <div role="alert" className="alert-err">
                <AlertCircle {...ICON_SM} />
                <p className="min-w-0 break-words">{error}</p>
              </div>
            )}

            {groups.length === 0 ? (
              <p className="panel p-3 text-sm text-gray-500">ไม่มีคิวงานในเดือนนี้</p>
            ) : (
              <ol className="space-y-4" aria-label={`คิวงานเดือน${thaiMonthYear(month)}`}>
                {groups.map(g => {
                  const isToday = g.date === today
                  const past = g.date !== null && g.date < today
                  return (
                    <li key={g.date ?? 'none'} className="space-y-2">
                      <h3 className={clsx('flex flex-wrap items-center gap-2 text-sm font-semibold', past ? 'text-gray-500' : 'text-gray-900')}>
                        {g.date ? formatThaiDayLong(g.date) : 'ไม่ระบุวัน'}
                        {isToday && <span className="chip-strong">วันนี้</span>}
                        {g.items.length > 1 && <span className="chip">{g.items.length.toLocaleString('en-US')} คิว</span>}
                      </h3>
                      <ul className="space-y-2">
                        {g.items.map(s => {
                          const map = s.map_url
                          return (
                            <li
                              key={`${s.session_id}`}
                              className={clsx(
                                'flex flex-col gap-2 rounded-lg border bg-white p-3 sm:flex-row sm:items-start sm:gap-4',
                                isToday ? 'border-brand-400' : 'border-gray-200',
                              )}
                            >
                              <p className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-gray-900 sm:w-44 sm:items-start">
                                <Clock {...ICON_XS} className="shrink-0 text-brand-600 sm:mt-0.5" />
                                <span className="min-w-0">{scheduleTimeText(s)}</span>
                              </p>
                              <div className="min-w-0 flex-1 space-y-1">
                                <p className="font-semibold text-gray-900 break-words">{s.couple_names || s.booking_no}</p>
                                <p className="text-sm text-gray-700 break-words">
                                  {s.type_label}
                                  {s.title && <span> · {s.title}</span>}
                                  {s.booking_no && (
                                    <>
                                      {' · '}
                                      {/* ลิงก์ในบรรทัด: ขยายพื้นที่กดแนวตั้งด้วย ::after (ไม่ดันระยะบรรทัด) */}
                                      <Link href={`/wedding/bookings/${s.booking_id}`} className="relative font-medium text-brand-700 underline-offset-4 hover:underline after:absolute after:-inset-y-3 after:inset-x-0 after:content-['']">
                                        {s.booking_no}
                                      </Link>
                                    </>
                                  )}
                                </p>
                                {(s.venue_name || map) && (
                                  // หมุดอยู่บรรทัดเดียวกับชื่อสถานที่เสมอ (ชื่อยาวขึ้นบรรทัดใหม่ใต้ตัวเอง ไม่ดันหมุดไปอยู่ลำพัง)
                                  <div className="flex items-start gap-1.5 text-sm text-gray-700">
                                    <MapPin {...ICON_XS} className="mt-0.5 shrink-0 text-gray-500" />
                                    <div className="min-w-0 flex-1">
                                      {s.venue_name && <p className="break-words">{s.venue_name}</p>}
                                      {map && (
                                        <a href={map} target="_blank" rel="noopener noreferrer" className="link -my-1 min-h-[40px] text-sm">
                                          เปิดแผนที่
                                          <ExternalLink {...ICON_XS} />
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                )}
                                <div className="flex flex-wrap gap-1.5 pt-0.5">
                                  <span className="chip">{crewRoleLabel(s.role)}</span>
                                  <span className={WED_STATUS_CHIP[s.status]}>{WED_STATUS_SHORT[s.status]}</span>
                                  {s.session_status === 'done' && <span className="badge-in">{SESSION_STATUS_LABELS.done}</span>}
                                </div>
                                {s.note && <p className="text-xs text-gray-500 break-words">หมายเหตุ: {s.note}</p>}
                              </div>
                              {manager && s.fee !== null && (
                                <div className="shrink-0 text-left sm:w-32 sm:text-right">
                                  <p className="money text-gray-900">{baht(s.fee)}</p>
                                  <p className={clsx('text-xs', s.fee_paid_on ? 'text-green-800' : 'text-amber-800')}>
                                    {s.fee_paid_on ? `จ่ายแล้ว ${formatThaiDate(s.fee_paid_on)}` : 'ค้างจ่าย'}
                                  </p>
                                </div>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
