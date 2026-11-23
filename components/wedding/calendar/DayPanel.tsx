'use client'
// เนื้อหารายละเอียดวันเดียว (wed_day): หัววัน + จำนวนงาน/คิวเต็ม + ปุ่ม (สร้างงานวันนี้ / รูปตารางงานวันนี้) + การ์ดทุกคิวของวัน
// ใช้ทั้งในแผงขวา (จอกว้าง) และในชีต (มือถือ/แท็บเล็ต) — ตัวโหลดข้อมูลอยู่ที่ CalendarClient (useWedDay) ให้สองที่เห็นข้อมูลชุดเดียวกัน
// ตัวกรองของปฏิทิน (ทีมงาน / รวมงานสอบถาม / ประเภทคิว) ใช้กับรายละเอียดวันด้วย ให้ตรงกับที่ตารางเดือนแสดง
//   คิวที่ถูกซ่อนบอกจำนวนไว้ + ปุ่มแสดงทั้งหมดของวัน (รายละเอียดวันต้องดูครบได้เสมอ)
import { useEffect, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { AlertTriangle, CalendarPlus, CalendarX, Eye, ImageDown, RefreshCw, XCircle } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import MigrationNotice from '@/components/pos/MigrationNotice'
import { formatThaiDayLong } from '@/lib/format'
import { FIX07_MISSING_MSG, type WedDaySession } from '@/lib/wedding'
import { shortDayLabel } from '@/components/rental/calendar/dates'
import SessionDetailCard from './SessionDetailCard'
import { conflictPairText, filtersActive, sessionPasses, type CalFilters } from './calendarModel'
import { wedNewBookingHref } from './rpc'
import type { WedDayState } from './useWedDay'

/** คำต่อท้ายปุ่มของวัน: 'วันนี้' หรือ 'วันที่ 5 ต.ค.' */
export function dayWordOf(day: string, today: string): string {
  return day === today ? 'วันนี้' : `วันที่ ${shortDayLabel(day)}`
}

export default function DayPanel({
  day,
  today,
  state,
  filters,
  headingId,
  onRetry,
  onOpenImage,
}: {
  day: string
  today: string
  state: WedDayState
  filters: CalFilters
  headingId: string
  onRetry(): void
  onOpenImage(day: string, sessions: WedDaySession[]): void
}) {
  const [showAll, setShowAll] = useState(false)
  // เปลี่ยนวัน/ตัวกรอง → กลับไปแสดงตามตัวกรอง
  useEffect(() => {
    setShowAll(false)
  }, [day, filters])

  const data = state.data && state.data.day === day ? state.data : null
  const all = data?.sessions ?? []
  const passing = all.filter(s => sessionPasses(s, filters))
  const shown = showAll ? all : passing
  const hidden = all.length - passing.length
  const dayWord = dayWordOf(day, today)
  // รูปตารางงานสำหรับกลุ่ม LINE ทีมงาน = คิวที่กันคิวแล้ว (ไม่รวมงานสอบถาม — เลือกใส่เพิ่มได้ในหน้ารูป)
  const imageSessions = all

  return (
    <div className="space-y-3" aria-busy={state.loading}>
      {/* ===== หัววัน ===== */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={headingId} className="text-base sm:text-lg font-semibold leading-snug text-gray-900">{formatThaiDayLong(day)}</h2>
          {day === today && <span className="chip-strong">วันนี้</span>}
          {data?.full && <span className="badge-out">คิวเต็ม</span>}
        </div>
        {data && (
          <p className="text-sm text-gray-600 tabular-nums">
            {data.count_jobs.toLocaleString('th-TH')} งานที่กันคิว
            {data.capacity > 0 ? ` (รับได้ ${data.capacity.toLocaleString('th-TH')} งานต่อวัน)` : ' (ไม่จำกัดจำนวนงานต่อวัน)'}
            {all.length > 0 && ` · ${all.length.toLocaleString('th-TH')} คิว`}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Link href={wedNewBookingHref(day)} prefetch={false} className="btn-primary flex-1 px-3 text-sm sm:flex-none">
            <CalendarPlus {...ICON_SM} />
            สร้างงาน{dayWord}
          </Link>
          <button
            type="button"
            onClick={() => onOpenImage(day, imageSessions)}
            disabled={!data || imageSessions.length === 0}
            className="btn-secondary flex-1 px-3 text-sm sm:flex-none"
          >
            <ImageDown {...ICON_SM} />
            รูปตารางงาน{dayWord}
          </button>
        </div>
      </div>

      {state.missing && <MigrationNotice message={FIX07_MISSING_MSG} />}

      {state.error && !state.missing && (
        <div role="alert" className="alert-err">
          <XCircle {...ICON_SM} />
          <div className="min-w-0 space-y-2">
            <p className="break-words">{state.error}</p>
            <button type="button" onClick={onRetry} disabled={state.loading} className="btn-secondary px-4 text-sm">
              <RefreshCw {...ICON_SM} />
              ลองใหม่
            </button>
          </div>
        </div>
      )}

      {/* ยังไม่มีข้อมูลของวันนี้ (รวมจังหวะก่อนเริ่มโหลด) และไม่มี error → โครงรอโหลด */}
      {!data && !state.error && !state.missing && (
        <div className="space-y-3" role="status">
          <span className="sr-only">กำลังโหลดรายละเอียดวัน...</span>
          {[...Array(2)].map((_, i) => <div key={i} className="skeleton h-48 rounded-xl" />)}
        </div>
      )}

      {data && (
        <div className={clsx('space-y-3 transition-opacity', state.loading && 'opacity-60')} aria-live="polite">
          {data.conflicts.length > 0 && (
            <div role="alert" className="alert-err">
              <AlertTriangle {...ICON_SM} />
              <div className="min-w-0 space-y-0.5">
                <p className="font-semibold">ทีมงานชนคิว {data.conflicts.length.toLocaleString('th-TH')} รายการในวันนี้</p>
                {data.conflicts.map((c, i) => (
                  <p key={`${c.crew_id}-${c.this_session_id ?? ''}-${c.other_session_id ?? i}`} className="text-sm break-words">
                    {conflictPairText(c, id => all.find(x => x.session_id === id))}
                  </p>
                ))}
              </div>
            </div>
          )}

          {hidden > 0 && filtersActive(filters) && (
            <div className="alert-info">
              <Eye {...ICON_SM} />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="break-words">
                  {showAll
                    ? `แสดงทุกคิวของวันนี้ (รวม ${hidden.toLocaleString('th-TH')} คิวที่ไม่ตรงตัวกรอง)`
                    : `ซ่อน ${hidden.toLocaleString('th-TH')} คิวที่ไม่ตรงตัวกรอง`}
                </p>
                <button type="button" onClick={() => setShowAll(v => !v)} className="btn-ghost -ml-2 px-2 text-sm">
                  {showAll ? 'แสดงเฉพาะที่ตรงตัวกรอง' : 'แสดงทุกคิวของวันนี้'}
                </button>
              </div>
            </div>
          )}

          {shown.length === 0 ? (
            <div className="card empty-state">
              <span className="icon-bubble icon-bubble-lg"><CalendarX size={28} strokeWidth={1.75} aria-hidden="true" /></span>
              <p className="empty-state-title">{all.length === 0 ? 'ยังไม่มีคิวงานในวันนี้' : 'ไม่มีคิวที่ตรงตัวกรอง'}</p>
              {all.length === 0 && (
                <p>
                  {data.capacity > 0
                    ? `รับงานได้อีก ${Math.max(0, data.capacity - data.count_jobs).toLocaleString('th-TH')} งาน`
                    : 'วันนี้ยังว่าง'}
                </p>
              )}
            </div>
          ) : (
            shown.map(s => <SessionDetailCard key={s.session_id} s={s} today={today} />)
          )}
        </div>
      )}
    </div>
  )
}
