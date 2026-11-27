'use client'
// การ์ดคิวงาน 1 คิว (หมั้น / พิธีเช้า / งานเลี้ยง / พรีเวดดิ้ง / อื่นๆ)
// หน้าแรก (27/11/2569 กรอกเร็ว ตามใบยืนยันการจองของร้าน): วันที่ เวลาเริ่ม-เลิก สถานที่
// กล่อง "ข้อมูลเพิ่มเติม (ไม่บังคับ)": ประเภทคิว ชื่อคิว เวลาทีมถึงงาน ลิงก์แผนที่ ที่อยู่ ผู้ติดต่อที่สถานที่ การแต่งกายทีม หมายเหตุ
//   สถานะคิว (แก้ไขงาน) + กำหนดการ (ฤกษ์) + ทีมงาน — เปิดเองเมื่อมีข้อมูลอยู่แล้ว / มีช่องผิด / ทีมชนคิว
//   ประเภทคิวตั้งจากปุ่ม "เพิ่มคิว" (คิวแรก = งานเลี้ยง) และแสดงที่หัวการ์ดเสมอ
// คำเตือนจาก wed_quote: ทีมชนคิว (สีแดง เด่น) / วันนั้นรับงานเต็มแล้ว (ต้องกดยืนยันตอนบันทึก) / มีงานอื่นวันเดียวกัน (ข้อมูล)
import { useId } from 'react'
import clsx from 'clsx'
import {
  AlertTriangle, ArrowDown, ArrowUp, CopyPlus, ExternalLink, Info, ListOrdered, MapPin, Trash2, Users,
} from 'lucide-react'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { formatThaiDate, isDayKey } from '@/lib/format'
import {
  SESSION_STATUS_LABELS, SESSION_TYPE_LABELS, WED_SESSION_STATUSES, WED_SESSION_TYPES, safeHttpUrl, sessionTimeText,
  thaiDayName, type WedCapacityWarning, type WedCrew, type WedCrewConflict, type WedSessionStatus,
} from '@/lib/wedding'
import {
  MAX_SESSION_LONG, MAX_MAP_URL, MAX_TITLE, MAX_VENUE_ADDRESS, MAX_VENUE_CONTACT, MAX_VENUE_NAME, SESSION_EXTRA_FIELDS,
  sessionExtraFilled, type CrewDraft, type SessionCheck, type SessionDraft, type SessionField,
} from './model'
import { DateField, Field, MoreFields, TimeField, fieldAria } from './fields'
import RunSheetEditor from './RunSheetEditor'
import CrewEditor from './CrewEditor'

export interface SessionHints {
  conflicts: WedCrewConflict[]
  capacity: WedCapacityWarning | null
  /** งานอื่นที่กันคิววันนั้นอยู่แล้ว (ไม่นับงานนี้) — null = ไม่รู้ */
  jobsThatDay: number | null
  capacityLimit: number
  countsCapacity: boolean
  /** วันนี้ต้องกดยืนยันรับงานเกินตอนบันทึก (แก้ไข: เฉพาะวันที่เพิ่มใหม่) */
  needsForce: boolean
}

export default function SessionCard({
  index,
  count,
  session,
  check,
  showErrors,
  manager,
  showStatus,
  crewList,
  crewError,
  hints,
  copyCrewFrom,
  onChange,
  onMove,
  onRemove,
  onDuplicate,
  canDuplicate,
  reveal = 0,
  mk,
  disabled,
}: {
  index: number
  count: number
  session: SessionDraft
  check: SessionCheck | undefined
  showErrors: boolean
  manager: boolean
  /** แก้ไขงานเดิม: เปลี่ยนสถานะคิวได้ (รอถ่าย / ถ่ายแล้ว / ยกเลิกคิวนี้) */
  showStatus: boolean
  crewList: readonly WedCrew[]
  crewError: string
  hints: SessionHints | null
  copyCrewFrom: { label: string; crew: CrewDraft[] } | null
  onChange: (fn: (s: SessionDraft) => SessionDraft) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  onDuplicate: () => void
  canDuplicate: boolean
  /** เลขที่เปลี่ยนเมื่อกดแถบลัด/กดบันทึกแล้วยังไม่ครบ → เปิดกล่องพับที่มีช่องผิด */
  reveal?: number
  mk: () => string
  disabled?: boolean
}) {
  const uid = useId()
  const id = (k: string) => `${uid}-${k}`
  const s = session
  const fields = check?.fields ?? {}

  // วันที่ยังไม่ใส่: แจ้งเมื่อกดบันทึกแล้วเท่านั้น ; ค่าผิดรูปแบบ: แจ้งทันที
  function err(f: SessionField): string | undefined {
    const e = fields[f]
    if (!e) return undefined
    if (f === 'date' && s.date === '' && !showErrors) return undefined
    return e
  }

  function set(p: Partial<SessionDraft>) {
    onChange(x => ({ ...x, ...p }))
  }

  const mapUrl = safeHttpUrl(s.map_url)
  const cancelled = s.status === 'cancelled'
  const headDate = isDayKey(s.date) ? `${thaiDayName(s.date, true)} ${formatThaiDate(s.date)}` : 'ยังไม่ระบุวัน'
  const conflicts = hints?.conflicts ?? []
  // กล่องพับ: ช่องที่มีค่า / มีช่องผิดหรือทีมชนคิวข้างใน (เปิดเอง)
  const extraFilled = sessionExtraFilled(s)
  const extraProblem = SESSION_EXTRA_FIELDS.some(f => !!fields[f]) ||
    (check ? Object.keys(check.runRows).length > 0 || Object.keys(check.crew).length > 0 : false) ||
    conflicts.length > 0

  return (
    <article
      className={clsx('card overflow-hidden', conflicts.length > 0 && 'border-red-300', cancelled && 'opacity-80')}
      aria-labelledby={`${id('h')} ${id('hd')}`}
    >
      {/* ===== หัวการ์ด: ลำดับ + ประเภท + ปุ่มเลื่อน/ลบ ; วัน-เวลาบรรทัดล่าง (มือถือไม่บีบหัวการ์ดเป็นหลายบรรทัด) ===== */}
      <div className="flex flex-wrap items-center gap-x-2 border-b border-gray-150 bg-gray-50 px-3 py-2 sm:px-4">
        <span className="chip-strong shrink-0 tabular-nums">คิวที่ {index + 1}</span>
        <h3 id={id('h')} className="min-w-0 flex-1 text-sm font-semibold text-gray-900 break-words">
          {SESSION_TYPE_LABELS[s.session_type]}
          {cancelled && <span className="badge-out ml-1.5 align-middle">ยกเลิกคิวนี้</span>}
        </h3>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            className="btn-icon btn-icon-plain"
            onClick={() => onMove(-1)}
            disabled={disabled || index === 0}
            aria-label={`เลื่อนคิวที่ ${index + 1} ขึ้น`}
          >
            <ArrowUp {...ICON_SM} />
          </button>
          <button
            type="button"
            className="btn-icon btn-icon-plain"
            onClick={() => onMove(1)}
            disabled={disabled || index === count - 1}
            aria-label={`เลื่อนคิวที่ ${index + 1} ลง`}
          >
            <ArrowDown {...ICON_SM} />
          </button>
          <button
            type="button"
            className="btn-icon btn-icon-plain"
            onClick={onRemove}
            disabled={disabled || count <= 1}
            aria-label={`ลบคิวที่ ${index + 1}`}
          >
            <Trash2 {...ICON_SM} />
          </button>
        </div>
        <p id={id('hd')} className="basis-full text-xs text-gray-600 tabular-nums break-words">
          {headDate}
          {(s.start_time || s.end_time) && <> · {sessionTimeText({ start_time: s.start_time, end_time: s.end_time }, '')}</>}
          {s.call_time && <> · ทีมถึง {s.call_time} น.</>}
        </p>
      </div>

      <div className="p-3 sm:p-4 space-y-4">
        {/* ===== ช่องหลัก: วันที่ เวลาเริ่ม-เลิก สถานที่ (มีแถบสรุปข้างจอ lg = การ์ดแคบ → วันที่เต็มแถว) ===== */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <DateField
            id={id('date')}
            label="วันที่"
            value={s.date}
            onChange={v => set({ date: v })}
            disabled={disabled}
            error={err('date')}
            hint="งานสอบถามยังไม่ต้องระบุวันได้"
          />
          <div className="grid grid-cols-2 gap-2 sm:gap-4">
            <TimeField id={id('st')} label="เวลาเริ่ม" value={s.start_time} onChange={v => set({ start_time: v })} disabled={disabled} error={err('start_time')} />
            <TimeField id={id('et')} label="เวลาเลิก" value={s.end_time} onChange={v => set({ end_time: v })} disabled={disabled} error={err('end_time')} />
          </div>
          <Field id={id('venue')} label="สถานที่" error={err('venue_name')} className="sm:col-span-2 lg:col-span-1 xl:col-span-2">
            <div className="input-icon">
              <MapPin {...ICON_SM} />
              <input
                id={id('venue')}
                className="input pl-11"
                value={s.venue_name}
                maxLength={MAX_VENUE_NAME}
                placeholder="เช่น บ้านเจ้าสาว / โรงแรม..."
                disabled={disabled}
                {...fieldAria(id('venue'), err('venue_name'))}
                onChange={e => set({ venue_name: e.target.value })}
              />
            </div>
          </Field>
        </div>

        {/* ===== ข้อมูลเพิ่มเติม (พับไว้) ===== */}
        <MoreFields
          contents="ประเภทคิว ชื่อคิว เวลาทีมถึงงาน แผนที่ ที่อยู่ ผู้ติดต่อ การแต่งกายทีม หมายเหตุ กำหนดการ ทีมงาน"
          filled={extraFilled}
          initialOpen={extraFilled > 0}
          problem={extraProblem}
          signal={reveal}
        >
          <div>
            <p className="field-label">ประเภทคิว</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label={`ประเภทของคิวที่ ${index + 1}`}>
              {WED_SESSION_TYPES.map(t => (
                <button
                  key={t}
                  type="button"
                  className="chip-toggle"
                  aria-pressed={s.session_type === t}
                  disabled={disabled}
                  onClick={() => set({ session_type: t })}
                >
                  {SESSION_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <Field id={id('title')} label="ชื่อคิว (ถ้ามี)" error={err('title')}>
              <input
                id={id('title')}
                className="input"
                value={s.title}
                maxLength={MAX_TITLE}
                placeholder="เช่น พิธีหมั้นช่วงเช้า / After party"
                disabled={disabled}
                {...fieldAria(id('title'), err('title'))}
                onChange={e => set({ title: e.target.value })}
              />
            </Field>
            <TimeField id={id('ct')} label="ทีมถึงงาน" value={s.call_time} onChange={v => set({ call_time: v })} disabled={disabled} error={err('call_time')} />
            <Field
              id={id('map')}
              className="sm:col-span-2 lg:col-span-1 xl:col-span-2"
              label="ลิงก์แผนที่"
              error={err('map_url')}
              hint={mapUrl ? (
                <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1">
                  <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
                  เปิดแผนที่ตรวจดู
                </a>
              ) : 'วางลิงก์ Google Maps (ขึ้นต้น https://)'}
            >
              <input
                id={id('map')}
                type="url"
                inputMode="url"
                className="input"
                value={s.map_url}
                maxLength={MAX_MAP_URL}
                placeholder="https://maps.app.goo.gl/..."
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={disabled}
                {...fieldAria(id('map'), err('map_url'), true)}
                onChange={e => set({ map_url: e.target.value })}
              />
            </Field>
            <Field id={id('addr')} label="ที่อยู่สถานที่" error={err('venue_address')} className="sm:col-span-2 lg:col-span-1 xl:col-span-2">
              <textarea
                id={id('addr')}
                className="input"
                rows={2}
                value={s.venue_address}
                maxLength={MAX_VENUE_ADDRESS}
                disabled={disabled}
                {...fieldAria(id('addr'), err('venue_address'))}
                onChange={e => set({ venue_address: e.target.value })}
              />
            </Field>
            <Field id={id('vc')} label="ผู้ติดต่อที่สถานที่" error={err('venue_contact')}>
              <input
                id={id('vc')}
                className="input"
                value={s.venue_contact}
                maxLength={MAX_VENUE_CONTACT}
                placeholder="เช่น คุณแอน (ฝ่ายจัดเลี้ยง) 08x-xxx-xxxx"
                disabled={disabled}
                {...fieldAria(id('vc'), err('venue_contact'))}
                onChange={e => set({ venue_contact: e.target.value })}
              />
            </Field>
            <Field id={id('dress')} label="การแต่งกายทีมงาน" error={err('dress_code')}>
              <input
                id={id('dress')}
                className="input"
                value={s.dress_code}
                maxLength={MAX_SESSION_LONG}
                placeholder="เช่น ชุดสุภาพโทนดำ"
                disabled={disabled}
                {...fieldAria(id('dress'), err('dress_code'))}
                onChange={e => set({ dress_code: e.target.value })}
              />
            </Field>
            <Field id={id('notes')} label="หมายเหตุคิวนี้" error={err('notes')} className="sm:col-span-2 lg:col-span-1 xl:col-span-2">
              <textarea
                id={id('notes')}
                className="input"
                rows={2}
                value={s.notes}
                maxLength={MAX_SESSION_LONG}
                placeholder="เช่น ที่จอดรถด้านหลัง / ห้ามใช้แฟลชระหว่างพิธีสงฆ์"
                disabled={disabled}
                {...fieldAria(id('notes'), err('notes'))}
                onChange={e => set({ notes: e.target.value })}
              />
            </Field>
            {showStatus && (
              <Field id={id('status')} label="สถานะคิว" hint="ยกเลิกคิวนี้ = ไม่นับคิว/ทีมชนคิว แต่ยังเก็บข้อมูลไว้">
                <select
                  id={id('status')}
                  className="input"
                  value={s.status}
                  disabled={disabled}
                  {...fieldAria(id('status'), null, true)}
                  onChange={e => {
                    const v = e.target.value
                    if ((WED_SESSION_STATUSES as readonly string[]).includes(v)) set({ status: v as WedSessionStatus })
                  }}
                >
                  {WED_SESSION_STATUSES.map(x => <option key={x} value={x}>{SESSION_STATUS_LABELS[x]}</option>)}
                </select>
              </Field>
            )}
          </div>

          {/* ===== กำหนดการ / ฤกษ์ ===== */}
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <ListOrdered {...ICON_SM} className="text-brand-600" />
              กำหนดการ / ฤกษ์
              {s.run_sheet.length > 0 && <span className="chip h-5 px-1.5 tabular-nums">{s.run_sheet.length}</span>}
            </p>
            <RunSheetEditor
              rows={s.run_sheet}
              sessionType={s.session_type}
              errors={check?.runRows ?? {}}
              onChange={rows => set({ run_sheet: rows })}
              mk={mk}
              disabled={disabled}
            />
          </div>

          {/* ===== ทีมงาน ===== */}
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Users {...ICON_SM} className="text-brand-600" />
              ทีมงานคิวนี้
              {s.crew.length > 0 && <span className="chip h-5 px-1.5 tabular-nums">{s.crew.length}</span>}
            </p>
            <CrewEditor
              crew={s.crew}
              crewList={crewList}
              crewError={crewError}
              errors={check?.crew ?? {}}
              conflicts={conflicts}
              manager={manager}
              copyFrom={copyCrewFrom}
              onChange={crew => set({ crew })}
              mk={mk}
              disabled={disabled}
            />
          </div>
        </MoreFields>

        {/* ===== คำเตือนจากฐานข้อมูล ===== */}
        {hints && hints.capacity && !cancelled && (
          <div className={hints.countsCapacity ? 'alert-warn' : 'alert-info'} role="status">
            <AlertTriangle {...ICON_SM} />
            <div className="min-w-0 space-y-1">
              <p className="font-semibold">
                วันที่ {formatThaiDate(hints.capacity.date)} รับงานได้ {hints.capacityLimit} งานต่อวัน
                {hints.countsCapacity ? ' — งานนี้จะเกินจำนวน' : ' — ถ้าล็อกคิว/ยืนยันงานนี้จะเกินจำนวน'}
              </p>
              {hints.capacity.bookings.length > 0 && (
                <p className="break-words">
                  มีงานอยู่แล้ว: {hints.capacity.bookings.map(b => [b.booking_no, b.couple_names].filter(Boolean).join(' ')).join(', ')}
                </p>
              )}
              {hints.needsForce && <p>ตอนบันทึกจะให้กดยืนยันรับงานเกินอีกครั้ง</p>}
            </div>
          </div>
        )}
        {hints && !hints.capacity && hints.jobsThatDay !== null && hints.jobsThatDay > 0 && isDayKey(s.date) && !cancelled && (
          <p className="flex items-start gap-1.5 text-xs text-gray-600" role="status">
            <Info size={14} strokeWidth={2} aria-hidden="true" className="mt-px shrink-0 text-brand-600" />
            <span className="min-w-0">
              วันนี้มีงานอื่นที่กันคิวแล้ว {hints.jobsThatDay} งาน
              {hints.capacityLimit > 0 ? ` (รับได้ ${hints.capacityLimit} งานต่อวัน)` : ''}
            </span>
          </p>
        )}

        {canDuplicate && (
          <button type="button" className="btn-ghost -ml-2 px-2 text-sm" onClick={onDuplicate} disabled={disabled}>
            <CopyPlus {...ICON_SM} />
            เพิ่มคิวถัดไปที่สถานที่เดียวกัน
          </button>
        )}
      </div>
    </article>
  )
}
