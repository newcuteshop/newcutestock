'use client'
// ส่วน "คิวงาน" ของฟอร์ม: งานหนึ่งมีได้ 1–10 คิว (หมั้น/พิธีเช้า/งานเลี้ยง/พรีเวดดิ้ง/อื่นๆ) — เพิ่ม ลบ เลื่อนลำดับ
// ลำดับในฟอร์ม = ลำดับบนเอกสาร (ฐานข้อมูลเก็บเป็น sort_order) ; ลบคิวเดิมที่บันทึกแล้ว/มีข้อมูล → ถามยืนยันก่อน
import { useState } from 'react'
import { CalendarClock, Plus } from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { MAX_WED_SESSIONS, SESSION_TYPE_LABELS, WED_SESSION_TYPES, type WedCrew, type WedSessionType } from '@/lib/wedding'
import ConfirmDialog from '@/components/integrations/ConfirmDialog'
import { sessionLike, type SessionCheck, type SessionDraft, type WedDraft } from './model'
import { FormSection } from './fields'
import SessionCard, { type SessionHints } from './SessionCard'

function hasContent(s: SessionDraft): boolean {
  return !!(s.id || s.date || s.start_time || s.venue_name.trim() || s.title.trim() || s.crew.length > 0 || s.run_sheet.length > 0 ||
    s.notes.trim() || s.venue_address.trim())
}

export default function SessionsEditor({
  draft,
  setSessions,
  checks,
  hintsFor,
  showErrors,
  manager,
  showStatus,
  crewList,
  crewError,
  sessionsProblem,
  mk,
  disabled,
}: {
  draft: WedDraft
  setSessions: (fn: (list: SessionDraft[]) => SessionDraft[]) => void
  checks: Record<string, SessionCheck>
  hintsFor: (index: number, s: SessionDraft) => SessionHints | null
  showErrors: boolean
  manager: boolean
  showStatus: boolean
  crewList: readonly WedCrew[]
  crewError: string
  sessionsProblem: string | null
  mk: () => string
  disabled?: boolean
}) {
  const [removeKey, setRemoveKey] = useState<string | null>(null)
  const [announce, setAnnounce] = useState('')
  const list = draft.sessions
  const full = list.length >= MAX_WED_SESSIONS
  const removing = removeKey ? list.findIndex(s => s.key === removeKey) : -1

  function add(type: WedSessionType) {
    if (full) return
    const last = list[list.length - 1] ?? null
    // คิวใหม่ใช้วัน/สถานที่ของคิวสุดท้ายเป็นค่าเริ่ม (งานแต่งส่วนใหญ่หลายคิวในวันเดียว ที่เดียว) — แก้ได้
    setSessions(l => [...l, sessionLike(mk(), last, type)])
    setAnnounce(`เพิ่มคิวที่ ${list.length + 1} (${SESSION_TYPE_LABELS[type]}) แล้ว`)
  }

  function duplicateAfter(i: number) {
    if (full) return
    const base = list[i]
    setSessions(l => {
      const next = [...l]
      next.splice(i + 1, 0, sessionLike(mk(), base, base.session_type))
      return next
    })
    setAnnounce(`เพิ่มคิวที่ ${i + 2} แล้ว`)
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= list.length) return
    setSessions(l => {
      const next = [...l]
      const [x] = next.splice(i, 1)
      next.splice(j, 0, x)
      return next
    })
    setAnnounce(`ย้ายคิวไปเป็นลำดับที่ ${j + 1}`)
  }

  function remove(key: string) {
    setSessions(l => (l.length <= 1 ? l : l.filter(s => s.key !== key)))
    setRemoveKey(null)
    setAnnounce('ลบคิวแล้ว')
  }

  function askRemove(s: SessionDraft) {
    if (list.length <= 1) return
    if (hasContent(s)) setRemoveKey(s.key)
    else remove(s.key)
  }

  const first = list[0]
  return (
    <FormSection
      section="sessions"
      title={<>คิวงาน <span className="chip tabular-nums">{list.length}/{MAX_WED_SESSIONS}</span></>}
      icon={<CalendarClock {...ICON} />}
      describe="แต่ละคิวคือช่วงที่ทีมต้องไปถ่าย (หมั้น พิธีเช้า งานเลี้ยง พรีเวดดิ้ง) — วัน เวลา สถานที่ และทีมงาน"
    >
      {sessionsProblem && <p role="alert" className="text-sm font-medium text-red-700">{sessionsProblem}</p>}
      <p className="sr-only" aria-live="polite">{announce}</p>
      <div className="space-y-4">
        {list.map((s, i) => (
          <SessionCard
            key={s.key}
            index={i}
            count={list.length}
            session={s}
            check={checks[s.key]}
            showErrors={showErrors}
            manager={manager}
            showStatus={showStatus && !!s.id}
            crewList={crewList}
            crewError={crewError}
            hints={hintsFor(i, s)}
            copyCrewFrom={i > 0 && first && first.crew.length > 0 ? { label: 'คิวที่ 1', crew: first.crew } : null}
            onChange={fn => setSessions(l => l.map(x => (x.key === s.key ? fn(x) : x)))}
            onMove={dir => move(i, dir)}
            onRemove={() => askRemove(s)}
            onDuplicate={() => duplicateAfter(i)}
            canDuplicate={!full}
            mk={mk}
            disabled={disabled}
          />
        ))}
      </div>

      <div className="space-y-2">
        <p className="field-label">{full ? `ครบ ${MAX_WED_SESSIONS} คิวแล้ว` : 'เพิ่มคิวงาน'}</p>
        <div className="flex flex-wrap gap-2">
          {WED_SESSION_TYPES.map(t => (
            <button key={t} type="button" className="btn-dashed px-3 text-sm" onClick={() => add(t)} disabled={disabled || full}>
              <Plus {...ICON_SM} />
              {SESSION_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={removing >= 0}
        title={`ลบคิวที่ ${removing + 1}?`}
        confirmLabel="ลบคิวนี้"
        tone="danger"
        onCancel={() => setRemoveKey(null)}
        onConfirm={() => removeKey && remove(removeKey)}
      >
        <p>ข้อมูลของคิวนี้ (วัน เวลา สถานที่ กำหนดการ และทีมงาน) จะหายไปจากฟอร์ม</p>
        {removing >= 0 && list[removing]?.id && (
          <p>
            คิวนี้บันทึกไว้แล้ว — จะถูกลบจากงานเมื่อกดบันทึกการแก้ไข ถ้าแค่ไม่ได้ถ่ายคิวนี้แต่อยากเก็บประวัติไว้
            ให้เปลี่ยน &quot;สถานะคิว&quot; เป็น &quot;ยกเลิกคิวนี้&quot; แทน
          </p>
        )}
      </ConfirmDialog>
    </FormSection>
  )
}
