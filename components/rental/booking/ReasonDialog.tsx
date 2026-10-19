'use client'
// ป็อปอัป "ใส่เหตุผลแล้วยืนยัน" ใช้ร่วม: ยกเลิกการจอง · ลูกค้าไม่มารับ · ยกเลิกรายการเงิน · ยกเลิกค่าปรับ
// onSubmit คืนข้อความผิดพลาด (แสดงในป็อปอัป) หรือ null เมื่อสำเร็จ (ผู้เรียกปิดป็อปอัปเอง)
import { useId, useRef, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import DialogShell, { DialogMessage } from './DialogShell'

const MAX_REASON = 200

export default function ReasonDialog({
  title,
  subtitle,
  icon,
  tone = 'danger',
  label,
  quickReasons = [],
  required = true,
  placeholder,
  confirmLabel,
  children,
  onClose,
  onSubmit,
}: {
  title: string
  subtitle?: ReactNode
  icon: ReactNode
  tone?: 'danger' | 'primary'
  label: string
  quickReasons?: readonly string[]
  required?: boolean
  placeholder?: string
  confirmLabel: string
  children?: ReactNode
  onClose(): void
  onSubmit(reason: string): Promise<{ error: string; tone?: 'err' | 'warn' } | null>
}) {
  const id = useId()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [message, setMessage] = useState<{ error: string; tone?: 'err' | 'warn' } | null>(null)

  const clean = reason.trim()
  const ok = (!required || clean.length >= 1) && clean.length <= MAX_REASON

  async function submit() {
    if (busyRef.current || !ok) return
    busyRef.current = true
    setBusy(true)
    setMessage(null)
    try {
      const res = await onSubmit(clean)
      if (res) setMessage(res)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title={title}
      subtitle={subtitle}
      icon={icon}
      tone={tone === 'danger' ? 'err' : 'brand'}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          {message && <DialogMessage tone={message.tone ?? 'err'} text={message.error} />}
          <div className="flex gap-2 sm:justify-end">
            <button type="button" onClick={onClose} disabled={busy} className="btn-secondary px-5">ไม่ทำ</button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || !ok}
              className={`${tone === 'danger' ? 'btn-danger' : 'btn-primary'} flex-1 sm:flex-none sm:min-w-[180px]`}
            >
              {busy && <Loader2 {...ICON_SM} className="animate-spin" />}
              {busy ? 'กำลังบันทึก...' : confirmLabel}
            </button>
          </div>
        </>
      }
    >
      {children && <div className="space-y-3 text-sm text-gray-700 leading-relaxed">{children}</div>}
      <div>
        <label htmlFor={id} className="field-label">{label}{required ? ' *' : ''}</label>
        {quickReasons.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="เหตุผลที่ใช้บ่อย">
            {quickReasons.map(r => (
              <button key={r} type="button" className="chip-toggle" aria-pressed={clean === r} disabled={busy} onClick={() => setReason(r)}>
                {r}
              </button>
            ))}
          </div>
        )}
        <input
          id={id}
          className="input"
          value={reason}
          maxLength={MAX_REASON}
          disabled={busy}
          placeholder={placeholder ?? 'พิมพ์เหตุผล หรือเลือกจากด้านบน'}
          autoComplete="off"
          aria-invalid={reason !== '' && !ok}
          onChange={e => setReason(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }}
        />
        <p className="field-hint">ไม่เกิน {MAX_REASON} ตัวอักษร · บันทึกไว้ในประวัติการจอง</p>
      </div>
    </DialogShell>
  )
}
