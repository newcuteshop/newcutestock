'use client'
// ต่อเวลาถือการจองที่รอยืนยัน (rental_extend_hold) — ชุดยังถูกกันไว้ให้ลูกค้าคนนี้จนถึงเวลาใหม่
// ส่ง p_client_id (สุ่มตอนเปิดป็อปอัป) → ส่งซ้ำด้วยรหัสเดิม ฐานข้อมูลคืนการจองตามเดิม ไม่ต่อเวลาซ้ำสองรอบ
// ไม่รู้ผล → ล็อกจำนวนชั่วโมงที่ส่งไว้ + เก็บรหัสนอกป็อปอัป ; ถูกปฏิเสธแน่ชัด → รหัสใหม่
import { useMemo, useRef, useState } from 'react'
import { Hourglass, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON_SM } from '@/components/theme/icons'
import { formatThaiDateTime } from '@/lib/format'
import { newUuid } from '@/lib/products'
import type { RentalBooking } from '@/lib/rental'
import DialogShell, { DialogMessage } from './DialogShell'
import {
  RESUME_WRITE_MSG, clearPendingWrite, clientIdTakenElsewhere, getPendingWrite, pendingKey, runBookingWrite, setPendingWrite,
} from './rpc'

const HOURS = [2, 6, 12, 24, 48, 72] as const

interface HoldArgs {
  hours: number
}

export default function HoldDialog({
  booking,
  onClose,
  onApplied,
  reload,
}: {
  booking: RentalBooking
  onClose(): void
  onApplied(b: RentalBooking, message: string): void
  reload(): Promise<RentalBooking | null>
}) {
  const supabase = useMemo(() => createClient(), [])
  const key = pendingKey(booking.id, 'hold')
  const [initial] = useState(() => getPendingWrite<HoldArgs>(key))
  const [hours, setHours] = useState<number>(initial?.args.hours ?? 24)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<{ text: string; tone: 'err' | 'warn' } | null>(
    initial ? { text: RESUME_WRITE_MSG, tone: 'warn' } : null,
  )
  const clientIdRef = useRef(initial?.clientId ?? newUuid())
  const [locked, setLocked] = useState(!!initial)
  const before = booking.expires_at

  // เวลาใหม่โดยประมาณ (เซิร์ฟเวอร์คิดจริง: max(เวลาหมดเดิม, ตอนนี้) + ชั่วโมงที่เลือก)
  const base = Math.max(before ? Date.parse(before) || 0 : 0, Date.now())
  const preview = new Date(base + hours * 3600000)

  async function submit() {
    if (busyRef.current) return
    const cid = clientIdRef.current
    // ไม่รู้ผล → ดูจากประวัติการจองว่ามีรายการ "ต่อเวลาถือ" ของรหัสคำขอนี้หรือยัง (ฐานข้อมูลจดรหัสไว้)
    // ห้ามเดาจากเวลาหมดถือที่เปลี่ยน — สลิปจากลูกค้า/พนักงานอีกคนก็เลื่อนเวลานี้ได้
    const verify = (fresh: RentalBooking) => fresh.logs.some(l => l.action === 'extend_hold' && l.detail?.client_id === cid)
    const hadPending = getPendingWrite<HoldArgs>(key)?.clientId === cid
    setPendingWrite<HoldArgs>(key, { clientId: cid, args: { hours } })
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await runBookingWrite({
        sb: supabase,
        fn: 'rental_extend_hold',
        args: { p_booking_id: booking.id, p_hours: hours, p_client_id: cid },
        reload,
        verify,
      })
      if (res.status === 'ok') {
        clearPendingWrite(key, cid)
        onApplied(res.booking, res.verified ? 'ต่อเวลาถือการจองแล้ว (ตรวจจากข้อมูลล่าสุด)' : 'ต่อเวลาถือการจองแล้ว')
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
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title="ต่อเวลาถือการจอง"
      subtitle={`การจอง ${booking.booking_no}`}
      icon={<Hourglass {...ICON_SM} />}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          {error && <DialogMessage tone={error.tone} text={error.text} />}
          <div className="flex gap-2 sm:justify-end">
            <button type="button" onClick={onClose} disabled={busy} className="btn-secondary px-5">ยกเลิก</button>
            <button type="button" onClick={submit} disabled={busy} className="btn-primary flex-1 sm:flex-none sm:min-w-[180px]">
              {busy && <Loader2 {...ICON_SM} className="animate-spin" />}
              {busy ? 'กำลังบันทึก...' : locked ? `ส่งอีกครั้ง (${hours} ชั่วโมง)` : `ต่อเวลา ${hours} ชั่วโมง`}
            </button>
          </div>
        </>
      }
    >
      <p className="text-sm text-gray-700">
        หมดเวลาถือเดิม: <span className="font-semibold text-gray-900">{before ? formatThaiDateTime(before) : 'ไม่ได้กำหนด'}</span>
      </p>
      <div>
        <p className="field-label">ต่อเวลาเพิ่ม</p>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="จำนวนชั่วโมง">
          {HOURS.map(h => (
            <button key={h} type="button" className="choice" aria-pressed={hours === h} disabled={busy || locked} onClick={() => setHours(h)}>
              {h} ชม.
            </button>
          ))}
        </div>
      </div>
      <div className="panel px-3.5 py-3 text-sm text-gray-700" aria-live="polite">
        ถือการจองถึงประมาณ <span className="font-semibold text-gray-900">{formatThaiDateTime(preview)}</span>
        <p className="mt-1 text-xs text-gray-500">พ้นเวลานี้แล้วยังไม่ยืนยัน ระบบปล่อยชุดให้คนอื่นจองได้อัตโนมัติ</p>
      </div>
    </DialogShell>
  )
}
