'use client'
// ข้อความสำเร็จรูปสำหรับส่ง LINE ลูกค้า — เลือกแม่แบบ → แก้ข้อความได้ → คัดลอกไปวางในแชท
// ระบบไม่ได้ส่ง LINE เอง (ไม่มีการเชื่อม LINE OA ในร้านเช่า) · ใส่ลิงก์หน้าสถานะการจองให้ลูกค้าดูยอด/แนบสลิปเอง
import { useId, useMemo, useState } from 'react'
import { Check, Copy, MessageCircle } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import type { RentalBooking, RentalSettings } from '@/lib/rental'
import DialogShell from './DialogShell'
import { LINE_TEMPLATES, buildLineMessage, suggestedTemplate, type LineTemplate } from './lineMessages'
import { absoluteUrl, copyText } from './rpc'

export default function LineMessageDialog({
  booking,
  settings,
  onClose,
}: {
  booking: RentalBooking
  settings: RentalSettings
  onClose(): void
}) {
  const textId = useId()
  const statusUrl = useMemo(() => absoluteUrl(booking.public_url_path), [booking.public_url_path])
  const [tpl, setTpl] = useState<LineTemplate>(() => suggestedTemplate(booking))
  const [text, setText] = useState(() => buildLineMessage(suggestedTemplate(booking), booking, settings, statusUrl))
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)

  function choose(t: LineTemplate) {
    setTpl(t)
    setText(buildLineMessage(t, booking, settings, statusUrl))
    setCopied(null)
  }

  async function copy() {
    const ok = await copyText(text)
    setCopied(ok ? 'ok' : 'fail')
  }

  return (
    <DialogShell
      title="ข้อความส่ง LINE ลูกค้า"
      subtitle={`การจอง ${booking.booking_no} · ${booking.customer.name}`}
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
          <button key={t.key} type="button" className="chip-toggle" aria-pressed={tpl === t.key} onClick={() => choose(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
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
    </DialogShell>
  )
}
