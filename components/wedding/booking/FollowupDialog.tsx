'use client'
// วันติดตามลูกค้า (wed_set_followup) — เช่น โทรถามเรื่องมัดจำ / ส่งใบเสนอราคาแล้วรอคำตอบ
// ถึงกำหนดแล้วขึ้นเป็นตัวเลขบนเมนู "งาน/การจอง" และหน้าภาพรวม · ล้างวัน = ไม่ต้องติดตามแล้ว
// บันทึกซ้ำได้ปลอดภัย (ตั้งค่าเดิมทับ) — ไม่รู้ผลให้ดูจากข้อมูลล่าสุด
import { useId, useMemo, useRef, useState } from 'react'
import { BellRing, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON_SM } from '@/components/theme/icons'
import { addDaysToKey, bangkokTodayKey, formatThaiDayLong, isDayKey } from '@/lib/format'
import type { WedBooking } from '@/lib/wedding'
import DialogShell, { DialogMessage } from '@/components/rental/booking/DialogShell'
import { runWedWrite } from './rpc'

const MAX_NOTE = 500
const QUICK: readonly { label: string; days: number }[] = [
  { label: 'วันนี้', days: 0 },
  { label: 'พรุ่งนี้', days: 1 },
  { label: '3 วัน', days: 3 },
  { label: '1 สัปดาห์', days: 7 },
  { label: '2 สัปดาห์', days: 14 },
]

export default function FollowupDialog({
  booking,
  onClose,
  onApplied,
  reload,
}: {
  booking: WedBooking
  onClose(): void
  onApplied(b: WedBooking, message: string): void
  reload(): Promise<WedBooking | null>
}) {
  const supabase = useMemo(() => createClient(), [])
  const dateId = useId()
  const noteId = useId()
  const [today] = useState(() => bangkokTodayKey())
  const [day, setDay] = useState(booking.followup_date ?? addDaysToKey(today, 1))
  const [note, setNote] = useState(booking.followup_note ?? '')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<{ text: string; tone: 'err' | 'warn' } | null>(null)

  const cleanNote = note.trim()
  const dayOk = isDayKey(day)

  async function save(clear: boolean) {
    if (busyRef.current) return
    if (!clear && (!dayOk || cleanNote.length > MAX_NOTE)) return
    const pDate = clear ? null : day
    const pNote = clear ? null : cleanNote || null
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await runWedWrite({
        sb: supabase,
        fn: 'wed_set_followup',
        args: { p_booking_id: booking.id, p_date: pDate, p_note: pNote },
        reload,
        verify: fresh => (fresh.followup_date ?? null) === pDate && (clear || (fresh.followup_note ?? null) === pNote),
      })
      if (res.status === 'ok') {
        onApplied(res.booking, clear ? 'ล้างวันติดตามลูกค้าแล้ว' : `ตั้งวันติดตาม ${formatThaiDayLong(day)} แล้ว`)
        onClose()
        return
      }
      setError({ text: res.message, tone: res.status === 'unsure' ? 'warn' : 'err' })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title="ติดตามลูกค้า"
      subtitle={`${booking.booking_no} · ${booking.couple_names}`}
      icon={<BellRing {...ICON_SM} />}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          {error && <DialogMessage tone={error.tone} text={error.text} />}
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {booking.followup_date && (
              <button type="button" onClick={() => void save(true)} disabled={busy} className="btn-ghost px-4">
                ไม่ต้องติดตามแล้ว
              </button>
            )}
            <button type="button" onClick={onClose} disabled={busy} className="btn-secondary px-5">ยกเลิก</button>
            <button
              type="button"
              onClick={() => void save(false)}
              disabled={busy || !dayOk || cleanNote.length > MAX_NOTE}
              className="btn-primary flex-1 sm:flex-none sm:min-w-[160px]"
            >
              {busy && <Loader2 {...ICON_SM} className="animate-spin" />}
              {busy ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </>
      }
    >
      <div>
        <label htmlFor={dateId} className="field-label">วันที่ต้องติดตาม *</label>
        <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="เลือกวันด่วน">
          {QUICK.map(q => {
            const k = addDaysToKey(today, q.days)
            return (
              <button key={q.label} type="button" className="chip-toggle" aria-pressed={day === k} disabled={busy} onClick={() => setDay(k)}>
                {q.label}
              </button>
            )
          })}
        </div>
        <input id={dateId} type="date" className="input" value={day} disabled={busy} onChange={e => setDay(e.target.value)} />
        <p className="field-hint">{dayOk ? formatThaiDayLong(day) : 'เลือกวันที่'}</p>
      </div>
      <div>
        <label htmlFor={noteId} className="field-label">เรื่องที่ต้องติดตาม</label>
        <textarea
          id={noteId}
          className="input min-h-[90px]"
          value={note}
          maxLength={MAX_NOTE}
          disabled={busy}
          placeholder="เช่น โทรถามเรื่องมัดจำ / ลูกค้าขอคิดเรื่องแพ็กเกจ / รอยืนยันฤกษ์"
          onChange={e => setNote(e.target.value)}
        />
        <p className="field-hint">ไม่เกิน {MAX_NOTE} ตัวอักษร</p>
      </div>
    </DialogShell>
  )
}
