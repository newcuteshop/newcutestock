'use client'
// ล็อกคิว (สอบถาม → ล็อกคิว รอมัดจำ · wed_hold) และต่อเวลาล็อกคิว (wed_extend_hold)
// - ล็อกคิว: คิววันนั้นเต็ม → เซิร์ฟเวอร์ตอบ hint คิวเต็ม → แสดงงานที่ชนแล้วให้กด "ล็อกคิวแบบบังคับ" (ไม่ส่ง force เอง)
//   กดซ้ำได้ปลอดภัย (ล็อกอยู่แล้ว = already)
// - ต่อเวลา: ส่ง p_client_id (สุ่มตอนเปิด) → ส่งซ้ำด้วยรหัสเดิม ฐานข้อมูลไม่ต่อเวลาซ้ำสองรอบ
//   ไม่รู้ผล → ล็อกจำนวนชั่วโมงที่ส่งไว้ + เก็บรหัสนอกป็อปอัป ; ตรวจผลจากประวัติงาน (ฐานข้อมูลจด client_id ไว้)
import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Hourglass, Loader2, Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON_SM } from '@/components/theme/icons'
import { formatThaiDateTime } from '@/lib/format'
import { newUuid } from '@/lib/products'
import type { WedBooking } from '@/lib/wedding'
import DialogShell, { DialogMessage } from '@/components/rental/booking/DialogShell'
import {
  RESUME_WRITE_MSG, clearPendingWrite, clientIdTakenElsewhere, getPendingWrite, pendingKey, runWedWrite, setPendingWrite,
} from './rpc'

const HOURS = [6, 12, 24, 48, 72, 168] as const

function hoursText(h: number): string {
  return h % 24 === 0 && h >= 48 ? `${h / 24} วัน` : `${h} ชม.`
}

interface HoldArgs {
  hours: number
}

export default function HoldDialog({
  booking,
  mode,
  defaultHours,
  onClose,
  onApplied,
  reload,
}: {
  booking: WedBooking
  mode: 'hold' | 'extend'
  defaultHours: number
  onClose(): void
  onApplied(b: WedBooking, message: string): void
  reload(): Promise<WedBooking | null>
}) {
  const supabase = useMemo(() => createClient(), [])
  const key = pendingKey(booking.id, 'hold')
  const [initial] = useState(() => (mode === 'extend' ? getPendingWrite<HoldArgs>(key) : null))
  const choices = useMemo(() => {
    const set = new Set<number>(HOURS)
    if (defaultHours >= 1 && defaultHours <= 720) set.add(defaultHours)
    return Array.from(set).sort((a, b) => a - b)
  }, [defaultHours])
  const [hours, setHours] = useState<number>(initial?.args.hours ?? (mode === 'hold' ? defaultHours : 24))
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<{ text: string; tone: 'err' | 'warn' } | null>(
    initial ? { text: RESUME_WRITE_MSG, tone: 'warn' } : null,
  )
  const [capacityMsg, setCapacityMsg] = useState('')
  const clientIdRef = useRef(initial?.clientId ?? newUuid())
  const [locked, setLocked] = useState(!!initial)

  // เวลาใหม่โดยประมาณ (เซิร์ฟเวอร์คิดจริง: ล็อก = ตอนนี้ + ชั่วโมง · ต่อเวลา = max(เวลาเดิม, ตอนนี้) + ชั่วโมง)
  const base = mode === 'extend' ? Math.max(booking.hold_until ? Date.parse(booking.hold_until) || 0 : 0, Date.now()) : Date.now()
  const preview = new Date(base + hours * 3600000)

  async function submitHold(force: boolean) {
    const res = await runWedWrite({
      sb: supabase,
      fn: 'wed_hold',
      args: { p_booking_id: booking.id, p_hours: hours, p_force: force },
      reload,
      verify: fresh => fresh.status === 'hold',
    })
    if (res.status === 'ok') {
      onApplied(res.booking, res.already ? 'งานนี้ล็อกคิวอยู่แล้ว' : `ล็อกคิวแล้ว ${hoursText(hours)}`)
      onClose()
      return
    }
    if (res.status === 'rejected' && res.hint === 'capacity' && !force) {
      setCapacityMsg(res.message)
      return
    }
    setError({ text: res.message, tone: res.status === 'unsure' ? 'warn' : 'err' })
  }

  async function submitExtend() {
    const cid = clientIdRef.current
    const verify = (fresh: WedBooking) => fresh.logs.some(l => l.action === 'extend_hold' && l.detail?.client_id === cid)
    const hadPending = getPendingWrite<HoldArgs>(key)?.clientId === cid
    setPendingWrite<HoldArgs>(key, { clientId: cid, args: { hours } })
    const res = await runWedWrite({
      sb: supabase,
      fn: 'wed_extend_hold',
      args: { p_booking_id: booking.id, p_hours: hours, p_client_id: cid },
      reload,
      verify,
    })
    if (res.status === 'ok') {
      clearPendingWrite(key, cid)
      onApplied(res.booking, res.already ? 'ต่อเวลาไปแล้วก่อนหน้า (ไม่ได้ต่อซ้ำ)' : `ต่อเวลาล็อกคิวแล้ว ${hoursText(hours)}`)
      onClose()
      return
    }
    if (res.status === 'rejected') {
      if (res.definite || !hadPending || clientIdTakenElsewhere(res.message)) {
        clearPendingWrite(key, cid)
        clientIdRef.current = newUuid()
        setLocked(false)
      }
      setError({ text: res.message, tone: 'err' })
      return
    }
    setLocked(true)
    setError({ text: res.message, tone: 'warn' })
  }

  async function submit() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      if (mode === 'hold') await submitHold(capacityMsg !== '')
      else await submitExtend()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const forcing = capacityMsg !== ''
  const label = mode === 'hold'
    ? forcing ? 'ล็อกคิวแบบบังคับ' : `ล็อกคิว ${hoursText(hours)}`
    : locked ? `ส่งอีกครั้ง (${hoursText(hours)})` : `ต่อเวลา ${hoursText(hours)}`

  return (
    <DialogShell
      title={mode === 'hold' ? 'ล็อกคิว รอมัดจำ' : 'ต่อเวลาล็อกคิว'}
      subtitle={`${booking.booking_no} · ${booking.couple_names}`}
      icon={mode === 'hold' ? <Lock {...ICON_SM} /> : <Hourglass {...ICON_SM} />}
      tone={forcing ? 'warn' : 'brand'}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          {error && <DialogMessage tone={error.tone} text={error.text} />}
          <div className="flex gap-2 sm:justify-end">
            <button type="button" onClick={onClose} disabled={busy} className="btn-secondary px-5">ยกเลิก</button>
            <button type="button" onClick={submit} disabled={busy} className="btn-primary flex-1 sm:flex-none sm:min-w-[200px]">
              {busy && <Loader2 {...ICON_SM} className="animate-spin" />}
              {busy ? 'กำลังบันทึก...' : label}
            </button>
          </div>
        </>
      }
    >
      {mode === 'hold' ? (
        <p className="text-sm text-gray-700">
          กันวันงานไว้ให้ลูกค้ารายนี้ชั่วคราวระหว่างรอมัดจำ — นับเป็นคิวของวันนั้น (งานอื่นจองวันเดียวกันได้ไม่เกินจำนวนงานต่อวันที่ตั้งไว้)
        </p>
      ) : (
        <p className="text-sm text-gray-700">
          ล็อกคิวถึงเดิม: <span className="font-semibold text-gray-900">{booking.hold_until ? formatThaiDateTime(booking.hold_until) : 'ไม่ได้กำหนด'}</span>
        </p>
      )}
      <div>
        <p className="field-label">{mode === 'hold' ? 'ล็อกไว้นาน' : 'ต่อเวลาเพิ่ม'}</p>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="จำนวนชั่วโมง">
          {choices.map(h => (
            <button
              key={h}
              type="button"
              className="choice"
              aria-pressed={hours === h}
              disabled={busy || locked || forcing}
              onClick={() => setHours(h)}
            >
              {hoursText(h)}
            </button>
          ))}
        </div>
      </div>
      <div className="panel px-3.5 py-3 text-sm text-gray-700" aria-live="polite">
        ล็อกคิวถึงประมาณ <span className="font-semibold text-gray-900">{formatThaiDateTime(preview)}</span>
        <p className="mt-1 text-xs text-gray-500">
          พ้นเวลานี้แล้วยังไม่ยืนยันและยังไม่มีการชำระเงิน ระบบปล่อยคิวกลับเป็น &quot;สอบถาม&quot; ให้อัตโนมัติ
        </p>
      </div>
      {forcing && (
        <div role="alert" className="alert-warn">
          <AlertTriangle {...ICON_SM} />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">คิววันนั้นเต็มแล้ว</p>
            <p className="break-words whitespace-pre-line">{capacityMsg}</p>
            <p className="text-xs">ทีมรับงานเกินจำนวนต่อวันที่ตั้งไว้ได้ — กด &quot;ล็อกคิวแบบบังคับ&quot; ถ้าตกลงรับงานนี้จริง</p>
          </div>
        </div>
      )}
    </DialogShell>
  )
}
