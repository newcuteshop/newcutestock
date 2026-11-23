'use client'
// ข้อความสำเร็จรูปสำหรับส่ง LINE คู่บ่าวสาว — เลือกแม่แบบ → (เตือนก่อนวันงาน: เลือกคิว) → แก้ข้อความได้ → คัดลอกไปวางในแชท
// ระบบไม่ได้ส่ง LINE เอง · ใส่ลิงก์หน้าติดตามงานเมื่อร้านเปิดใช้
import { useId, useMemo, useState } from 'react'
import { Check, Copy, MessageCircle } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { bangkokTodayKey, formatThaiDate } from '@/lib/format'
import type { WedBooking, WedSettings } from '@/lib/wedding'
import DialogShell from '@/components/rental/booking/DialogShell'
import { LINE_TEMPLATES, buildLineMessage, datedSessions, nextSession, suggestedTemplate, type LineTemplate } from './lineMessages'
import { absoluteUrl, copyText } from './rpc'

export default function LineMessageDialog({
  booking,
  settings,
  onClose,
}: {
  booking: WedBooking
  settings: WedSettings
  onClose(): void
}) {
  const textId = useId()
  const sessionId = useId()
  const portalUrl = useMemo(
    () => (settings.portal_enabled ? absoluteUrl(booking.public_url_path) : ''),
    [settings.portal_enabled, booking.public_url_path],
  )
  const sessions = useMemo(() => datedSessions(booking), [booking])
  const [today] = useState(() => bangkokTodayKey())
  const [sessId, setSessId] = useState<string>(() => nextSession(booking, today)?.id ?? '')
  const session = sessions.find(s => s.id === sessId) ?? null
  const [tpl, setTpl] = useState<LineTemplate>(() => suggestedTemplate(booking))
  const [text, setText] = useState(() => buildLineMessage(suggestedTemplate(booking), booking, settings, portalUrl, session))
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)

  function rebuild(t: LineTemplate, sid: string) {
    setText(buildLineMessage(t, booking, settings, portalUrl, sessions.find(s => s.id === sid) ?? null))
    setCopied(null)
  }

  async function copy() {
    const ok = await copyText(text)
    setCopied(ok ? 'ok' : 'fail')
  }

  return (
    <DialogShell
      title="ข้อความส่ง LINE ลูกค้า"
      subtitle={`${booking.booking_no} · ${booking.couple_names}`}
      icon={<MessageCircle {...ICON_SM} />}
      onClose={onClose}
      footer={
        <>
          <p className="text-xs text-gray-600 min-h-[1rem]" aria-live="polite">
            {copied === 'ok' ? 'คัดลอกแล้ว — ไปวางในแชท LINE ของลูกค้าได้เลย'
              : copied === 'fail' ? 'คัดลอกอัตโนมัติไม่ได้ — กดค้างที่ข้อความแล้วเลือกคัดลอกเอง' : ''}
          </p>
          <div className="flex gap-2 sm:justify-end">
            <button type="button" onClick={onClose} className="btn-secondary px-5">ปิด</button>
            <button type="button" onClick={copy} className="btn-primary flex-1 sm:flex-none sm:min-w-[180px]">
              {copied === 'ok' ? <Check {...ICON_SM} /> : <Copy {...ICON_SM} />}
              {copied === 'ok' ? 'คัดลอกแล้ว' : 'คัดลอกข้อความ'}
            </button>
          </div>
        </>
      }
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label="แม่แบบข้อความ">
        {LINE_TEMPLATES.map(t => (
          <button
            key={t.key}
            type="button"
            className="chip-toggle"
            aria-pressed={tpl === t.key}
            onClick={() => { setTpl(t.key); rebuild(t.key, sessId) }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tpl === 'reminder' && sessions.length > 1 && (
        <div>
          <label htmlFor={sessionId} className="field-label">คิวงาน</label>
          <select
            id={sessionId}
            className="input"
            value={sessId}
            onChange={e => { setSessId(e.target.value); rebuild(tpl, e.target.value) }}
          >
            {sessions.map(s => (
              <option key={s.id} value={s.id}>{formatThaiDate(s.date)} · {s.type_label}{s.title ? ` · ${s.title}` : ''}</option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label htmlFor={textId} className="field-label">ข้อความ (แก้ไขได้ก่อนคัดลอก)</label>
        <textarea
          id={textId}
          className="input min-h-[300px] font-normal leading-relaxed"
          value={text}
          onChange={e => { setText(e.target.value); setCopied(null) }}
          spellCheck={false}
        />
      </div>
      {!settings.portal_enabled && (
        <p className="text-xs text-gray-500">ลิงก์ติดตามงานของลูกค้าปิดอยู่ (เปิดได้ที่ ตั้งค่าร้าน → ลิงก์ลูกค้า) จึงไม่ได้ใส่ลิงก์ในข้อความ</p>
      )}
    </DialogShell>
  )
}
