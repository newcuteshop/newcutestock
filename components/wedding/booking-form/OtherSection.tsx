'use client'
// ส่วน "ติดตามลูกค้า / ผู้ประสานงาน / มู้ดแอนด์โทน / หมายเหตุ" ของฟอร์มงาน
// วันติดตามลูกค้า → ขึ้นตัวเลขบนเมนู "งาน/การจอง" เมื่อถึงวัน (งานสอบถาม/ล็อกคิว/ยืนยัน/เลื่อน)
// 27/11/2569 กรอกเร็ว: ทั้งส่วนพับไว้ (ไม่บังคับ) — เปิดเองเมื่อมีข้อมูลอยู่แล้ว / มีช่องผิด / กดแถบลัด "อื่นๆ"
import { useId } from 'react'
import { ExternalLink, StickyNote } from 'lucide-react'
import { ICON } from '@/components/theme/icons'
import { addDaysToKey } from '@/lib/format'
import { safeHttpUrl } from '@/lib/wedding'
import {
  MAX_COORD_NAME, MAX_COORD_PHONE, MAX_CUSTOMER_NOTE, MAX_FOLLOWUP_NOTE, MAX_MOOD, MAX_NOTE, otherFilled, type CoreCheck,
  type WedDraft,
} from './model'
import { DateField, Field, FoldBadge, FormSection, fieldAria, useDisclosure } from './fields'

export default function OtherSection({
  draft,
  patch,
  check,
  today,
  reveal = 0,
  revealOpen = false,
  disabled,
}: {
  draft: WedDraft
  patch: (p: Partial<WedDraft>) => void
  check: CoreCheck
  today: string
  /** เลขที่เปลี่ยนเมื่อกดแถบลัด/กดบันทึกแล้วยังไม่ครบ */
  reveal?: number
  /** reveal ครั้งนี้มาจากแถบลัด "อื่นๆ" → เปิดส่วนนี้แม้ไม่มีช่องผิด */
  revealOpen?: boolean
  disabled?: boolean
}) {
  const uid = useId()
  const o = check.other
  const mood = safeHttpUrl(draft.moodLink)
  const filled = otherFilled(draft)
  const problem = !!(o.followupDate || o.followupNote || o.coordinatorName || o.coordinatorPhone || o.moodLink || o.customerNote || o.note)
  const [open, setOpen] = useDisclosure(filled > 0, problem, reveal, revealOpen)

  return (
    <FormSection
      section="other"
      title="ติดตามลูกค้า ผู้ประสานงาน และหมายเหตุ"
      icon={<StickyNote {...ICON} />}
      describe={open ? undefined : 'ไม่บังคับ · วันติดตามลูกค้า ผู้ประสานงาน ความต้องการลูกค้า หมายเหตุภายในร้าน'}
      collapse={{
        open,
        onToggle: () => setOpen(v => !v),
        badge: open ? null : <FoldBadge problem={problem} filled={filled} />,
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DateField
          id={`${uid}-fu`}
          label="วันที่ต้องติดตามลูกค้า"
          value={draft.followupDate}
          onChange={v => patch({ followupDate: v })}
          disabled={disabled}
          error={o.followupDate}
          hint="ถึงวันแล้วขึ้นเตือนที่เมนูงาน/การจอง"
        />
        <Field id={`${uid}-fun`} label="เรื่องที่ต้องติดตาม" error={o.followupNote}>
          <input
            id={`${uid}-fun`}
            className="input"
            value={draft.followupNote}
            maxLength={MAX_FOLLOWUP_NOTE}
            placeholder="เช่น ส่งใบเสนอราคา / ทวงมัดจำ / ถามวันพรีเวดดิ้ง"
            disabled={disabled}
            {...fieldAria(`${uid}-fun`, o.followupNote)}
            onChange={e => patch({ followupNote: e.target.value })}
          />
        </Field>
      </div>
      {!draft.followupDate && (
        <div className="-mt-2 flex flex-wrap gap-2" role="group" aria-label="ตั้งวันติดตามด่วน">
          <button type="button" className="chip-toggle" disabled={disabled} onClick={() => patch({ followupDate: addDaysToKey(today, 1) })}>พรุ่งนี้</button>
          <button type="button" className="chip-toggle" disabled={disabled} onClick={() => patch({ followupDate: addDaysToKey(today, 3) })}>อีก 3 วัน</button>
          <button type="button" className="chip-toggle" disabled={disabled} onClick={() => patch({ followupDate: addDaysToKey(today, 7) })}>อีก 1 สัปดาห์</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id={`${uid}-cn`} label="ผู้ประสานงานวันงาน" error={o.coordinatorName} hint="เช่น เวดดิ้งแพลนเนอร์ / ญาติที่ดูแลหน้างาน">
          <input
            id={`${uid}-cn`}
            className="input"
            value={draft.coordinatorName}
            maxLength={MAX_COORD_NAME}
            disabled={disabled}
            {...fieldAria(`${uid}-cn`, o.coordinatorName, true)}
            onChange={e => patch({ coordinatorName: e.target.value })}
          />
        </Field>
        <Field id={`${uid}-cp`} label="เบอร์ผู้ประสานงาน" error={o.coordinatorPhone}>
          <input
            id={`${uid}-cp`}
            type="tel"
            inputMode="tel"
            className="input tabular-nums"
            value={draft.coordinatorPhone}
            maxLength={MAX_COORD_PHONE}
            disabled={disabled}
            {...fieldAria(`${uid}-cp`, o.coordinatorPhone)}
            onChange={e => patch({ coordinatorPhone: e.target.value })}
          />
        </Field>
      </div>

      <Field
        id={`${uid}-mood`}
        label="ลิงก์มู้ดแอนด์โทน / รูปตัวอย่างที่ลูกค้าชอบ"
        error={o.moodLink}
        hint={mood ? (
          <a href={mood} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1">
            <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
            เปิดลิงก์ตรวจดู
          </a>
        ) : 'เช่น Pinterest / Google Drive (ขึ้นต้น https://)'}
      >
        <input
          id={`${uid}-mood`}
          type="url"
          inputMode="url"
          className="input"
          value={draft.moodLink}
          maxLength={MAX_MOOD}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://"
          disabled={disabled}
          {...fieldAria(`${uid}-mood`, o.moodLink, true)}
          onChange={e => patch({ moodLink: e.target.value })}
        />
      </Field>

      <Field id={`${uid}-cnote`} label="ความต้องการของลูกค้า" error={o.customerNote} hint="เช่น ช็อตที่อยากได้ ธีมสี แขกคนสำคัญที่ต้องถ่ายให้ได้">
        <textarea
          id={`${uid}-cnote`}
          className="input"
          rows={3}
          value={draft.customerNote}
          maxLength={MAX_CUSTOMER_NOTE}
          disabled={disabled}
          {...fieldAria(`${uid}-cnote`, o.customerNote, true)}
          onChange={e => patch({ customerNote: e.target.value })}
        />
      </Field>
      <Field id={`${uid}-note`} label="หมายเหตุภายในร้าน" error={o.note} hint="ไม่แสดงบนเอกสารและหน้าติดตามงานของลูกค้า">
        <textarea
          id={`${uid}-note`}
          className="input"
          rows={2}
          value={draft.note}
          maxLength={MAX_NOTE}
          disabled={disabled}
          {...fieldAria(`${uid}-note`, o.note, true)}
          onChange={e => patch({ note: e.target.value })}
        />
      </Field>
    </FormSection>
  )
}
