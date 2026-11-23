'use client'
// ป็อปอัปยืนยันการเปลี่ยนสถานะงาน (ล็อกคิว/ยืนยัน/ถ่ายเสร็จ/ส่งงาน/ปิดงาน/เปิดใหม่/ปล่อยคิว/กลับมาจัดงาน/เปลี่ยนลิงก์ ...)
// การบังคับ (p_force) ทำเป็น 2 ขั้นเสมอ — ไม่ส่ง force ไปเองโดยที่ผู้ใช้ไม่เห็นเหตุผล:
//   - เซิร์ฟเวอร์ตอบ hint (คิวเต็ม/มัดจำไม่ครบ/ยังมีคิวในอนาคต/ยังไม่ส่งงาน) → แสดงข้อความจากเซิร์ฟเวอร์ + ปุ่ม "ทำต่อแบบบังคับ"
//   - คำเตือนที่รู้ล่วงหน้า (block_reasons.*_warning) แสดงในป็อปอัปตั้งแต่เปิด:
//       forceFirst = ส่ง force ตั้งแต่ครั้งแรก (ใช้เมื่อคำเตือนนั้นเป็นเหตุเดียวที่เป็นไปได้ เช่น ถ่ายเสร็จทั้งที่ยังมีคิวในอนาคต)
//       ackHint   = ผู้ใช้เห็นคำเตือนนี้แล้ว ถ้าเซิร์ฟเวอร์ตอบ hint เดียวกัน → ส่งซ้ำแบบบังคับให้เลย (hint อื่น = ถามใหม่)
// ทุกคำสั่งในไฟล์ fix-07 กดซ้ำได้ปลอดภัย (สถานะนั้นอยู่แล้ว = already) → "ไม่รู้ผล" ให้กดใหม่ได้ด้วยค่าเดิม
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON_SM } from '@/components/theme/icons'
import type { WedBooking } from '@/lib/wedding'
import DialogShell, { DialogMessage } from '@/components/rental/booking/DialogShell'
import { runWedWrite, type ForceHint } from './rpc'

const FORCE_TITLE: Record<ForceHint, string> = {
  capacity: 'คิววันนั้นเต็มแล้ว',
  deposit: 'ยังไม่ได้รับมัดจำครบ',
  future_sessions: 'ยังมีคิวงานที่ยังไม่ถึงวัน',
  not_delivered: 'ยังไม่ได้บันทึกส่งงาน',
}

export default function ActionDialog({
  booking,
  title,
  subtitle,
  icon,
  tone = 'brand',
  confirmLabel,
  fn,
  args,
  supportsForce = false,
  forceFirst = false,
  ackHint,
  warning,
  verify,
  successMessage,
  children,
  onClose,
  onApplied,
  reload,
}: {
  booking: WedBooking
  title: string
  subtitle?: ReactNode
  icon: ReactNode
  tone?: 'brand' | 'warn' | 'err'
  confirmLabel: string
  fn: string
  args: Record<string, unknown>
  supportsForce?: boolean
  forceFirst?: boolean
  ackHint?: ForceHint
  /** คำเตือนที่รู้ล่วงหน้า (แสดงเป็นกล่องเหลือง) */
  warning?: string
  verify: (fresh: WedBooking) => boolean
  successMessage: (already: boolean, verified: boolean) => string
  children?: ReactNode
  onClose(): void
  onApplied(b: WedBooking, message: string): void
  reload(): Promise<WedBooking | null>
}) {
  const supabase = useMemo(() => createClient(), [])
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<{ text: string; tone: 'err' | 'warn' } | null>(null)
  const [forceNeeded, setForceNeeded] = useState<{ hint: ForceHint; message: string } | null>(null)

  async function send(force: boolean): Promise<void> {
    const callArgs = supportsForce ? { ...args, p_force: force } : args
    const res = await runWedWrite({ sb: supabase, fn, args: callArgs, reload, verify })
    if (res.status === 'ok') {
      onApplied(res.booking, successMessage(res.already, res.verified))
      onClose()
      return
    }
    if (res.status === 'rejected') {
      if (supportsForce && res.hint && !force) {
        // ผู้ใช้เห็นคำเตือนเรื่องนี้แล้วในป็อปอัป → ทำต่อแบบบังคับเลย
        if (ackHint && res.hint === ackHint) {
          await send(true)
          return
        }
        setForceNeeded({ hint: res.hint, message: res.message })
        return
      }
      setError({ text: res.message, tone: 'err' })
      return
    }
    setError({ text: res.message, tone: 'warn' })
  }

  async function submit(force: boolean) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await send(force)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const forcing = !!forceNeeded
  return (
    <DialogShell
      title={title}
      subtitle={subtitle ?? `${booking.booking_no} · ${booking.couple_names}`}
      icon={icon}
      tone={forcing ? 'warn' : tone}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          {error && <DialogMessage tone={error.tone} text={error.text} />}
          <div className="flex gap-2 sm:justify-end">
            <button type="button" onClick={onClose} disabled={busy} className="btn-secondary px-5">ไม่ทำ</button>
            <button
              type="button"
              onClick={() => void submit(forcing || (supportsForce && forceFirst))}
              disabled={busy}
              className={`${tone === 'err' && !forcing ? 'btn-danger' : 'btn-primary'} flex-1 sm:flex-none sm:min-w-[200px]`}
            >
              {busy && <Loader2 {...ICON_SM} className="animate-spin" />}
              {busy ? 'กำลังบันทึก...' : forcing ? 'ทำต่อแบบบังคับ' : confirmLabel}
            </button>
          </div>
        </>
      }
    >
      {children && <div className="space-y-3 text-sm text-gray-700 leading-relaxed">{children}</div>}
      {warning && !forcing && (
        <div role="note" className="alert-warn">
          <AlertTriangle {...ICON_SM} />
          <p className="min-w-0 break-words">{warning}</p>
        </div>
      )}
      {forceNeeded && (
        <div role="alert" className="alert-warn">
          <AlertTriangle {...ICON_SM} />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">{FORCE_TITLE[forceNeeded.hint]}</p>
            <p className="break-words whitespace-pre-line">{forceNeeded.message}</p>
            <p className="text-xs">ตรวจให้แน่ใจก่อน แล้วกด &quot;ทำต่อแบบบังคับ&quot; ถ้าต้องการทำรายการนี้จริง</p>
          </div>
        </div>
      )}
    </DialogShell>
  )
}
