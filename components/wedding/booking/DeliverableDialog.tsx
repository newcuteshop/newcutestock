'use client'
// เพิ่ม / แก้รายการส่งงาน (wed_save_deliverable) — ชื่อ จำนวน หน่วย กำหนดส่ง สถานะ ลิงก์ส่งงาน หมายเหตุ ผู้ตัดต่อ
// "ส่งแล้ว" ต้องมีลิงก์ส่งงาน (http/https) หรือหมายเหตุวิธีส่ง (เช่น ส่งทางไดรฟ์ของลูกค้า) — เซิร์ฟเวอร์ตรวจซ้ำ
// ทุกรายการส่งแล้ว → งานเปลี่ยนเป็น "ส่งงานแล้ว" เอง (เซิร์ฟเวอร์ทำ)
// รายการใหม่ส่ง client_id (สุ่มตอนเปิด เก็บนอกป็อปอัปเมื่อไม่รู้ผล) → ส่งซ้ำไม่เกิดรายการซ้อน
// แก้รายการเดิม = ส่งค่าทั้งชุดแทนที่ (ส่งซ้ำได้ปลอดภัย) ; ไม่รู้ผล → ดูจากข้อมูลล่าสุดว่าค่าตรงกันหรือยัง
import { useId, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Clapperboard, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON_SM } from '@/components/theme/icons'
import { formatThaiDate, isDayKey } from '@/lib/format'
import { newUuid } from '@/lib/products'
import {
  DELIVERABLE_STATUS_LABELS, WED_DELIVERABLE_STATUSES, crewDisplayName, crewRoleLabel, isHttpUrlOrEmpty, safeHttpUrl,
  type WedBooking, type WedCrew, type WedDeliverable, type WedDeliverableStatus,
} from '@/lib/wedding'
import DialogShell, { DialogMessage } from '@/components/rental/booking/DialogShell'
import {
  RESUME_WRITE_MSG, clearPendingWrite, clientIdTakenElsewhere, getPendingWrite, pendingKey, runWedWrite, setPendingWrite,
} from './rpc'

const MAX_NAME = 120
const MAX_UNIT = 30
const MAX_LINK = 1000
const MAX_NOTE = 1000

interface DelivArgs {
  name: string
  qty: number
  unit: string
  due: string
  status: WedDeliverableStatus
  link: string
  note: string
  editor: string
}

export default function DeliverableDialog({
  booking,
  item,
  presetStatus,
  crew,
  crewLoading,
  onClose,
  onApplied,
  reload,
}: {
  booking: WedBooking
  /** null = เพิ่มรายการใหม่ */
  item: WedDeliverable | null
  /** เปิดมาจากการเลือกสถานะในรายการ (เช่น "ส่งแล้ว" แต่ยังไม่มีลิงก์) */
  presetStatus?: WedDeliverableStatus
  crew: WedCrew[]
  crewLoading: boolean
  onClose(): void
  onApplied(b: WedBooking, message: string): void
  reload(): Promise<WedBooking | null>
}) {
  const supabase = useMemo(() => createClient(), [])
  const ids = { name: useId(), qty: useId(), unit: useId(), due: useId(), link: useId(), note: useId(), editor: useId() }
  const key = pendingKey(booking.id, 'deliv:new')
  const [initial] = useState(() => (item ? null : getPendingWrite<DelivArgs>(key)))
  const start: DelivArgs = initial?.args ?? {
    name: item?.name ?? '',
    qty: item?.qty ?? 1,
    unit: item?.unit ?? '',
    due: item?.due_date ?? '',
    status: presetStatus ?? item?.status ?? 'pending',
    link: item?.link_url ?? '',
    note: item?.note ?? '',
    editor: item?.editor_crew_id ?? '',
  }
  const [name, setName] = useState(start.name)
  const [qty, setQty] = useState(String(start.qty))
  const [unit, setUnit] = useState(start.unit)
  const [due, setDue] = useState(start.due)
  const [status, setStatus] = useState<WedDeliverableStatus>(start.status)
  const [link, setLink] = useState(start.link)
  const [note, setNote] = useState(start.note)
  const [editor, setEditor] = useState(start.editor)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<{ text: string; tone: 'err' | 'warn' } | null>(
    initial ? { text: RESUME_WRITE_MSG, tone: 'warn' } : null,
  )
  const clientIdRef = useRef(initial?.clientId ?? newUuid())
  const [locked, setLocked] = useState(!!initial)

  const qtyNum = Number(qty.trim())
  const qtyOk = Number.isInteger(qtyNum) && qtyNum >= 1 && qtyNum <= 100000
  const cleanName = name.trim()
  const cleanLink = link.trim()
  const cleanNote = note.trim()
  const linkOk = isHttpUrlOrEmpty(cleanLink) && cleanLink.length <= MAX_LINK
  const needProof = status === 'delivered' && cleanLink === '' && cleanNote === ''
  const dueOk = due === '' || isDayKey(due)
  const canSubmit = !busy && cleanName.length >= 1 && cleanName.length <= MAX_NAME && qtyOk && unit.trim().length <= MAX_UNIT
    && dueOk && linkOk && cleanNote.length <= MAX_NOTE && !needProof

  // ผู้ตัดต่อ: ทีมที่ใช้งานอยู่ (ฝ่ายตัดต่อขึ้นก่อน) + คนที่เลือกไว้เดิมแม้ปิดใช้งานแล้ว
  const editorOptions = useMemo(() => {
    const list = crew.filter(c => c.is_active || c.id === start.editor)
    return [...list].sort((a, b) => Number(b.role === 'editor') - Number(a.role === 'editor') || a.name.localeCompare(b.name, 'th'))
  }, [crew, start.editor])

  async function submit() {
    if (busyRef.current || !canSubmit) return
    const args: DelivArgs = {
      name: cleanName, qty: qtyNum, unit: unit.trim(), due, status, link: cleanLink, note: cleanNote, editor,
    }
    const payload: Record<string, unknown> = {
      name: args.name,
      qty: args.qty,
      unit: args.unit || null,
      due_date: args.due || null,
      status: args.status,
      link_url: args.link || null,
      note: args.note || null,
      editor_crew_id: args.editor || null,
    }
    const cid = clientIdRef.current
    const hadPending = !item && getPendingWrite<DelivArgs>(key)?.clientId === cid
    if (item) payload.id = item.id
    else {
      payload.client_id = cid
      setPendingWrite<DelivArgs>(key, { clientId: cid, args })
    }
    const same = (d: WedDeliverable) => d.name === args.name && d.qty === args.qty && (d.unit ?? '') === args.unit
      && (d.due_date ?? '') === args.due && d.status === args.status && (d.link_url ?? '') === (safeHttpUrl(args.link) ?? '')
      && (d.note ?? '') === args.note && (d.editor_crew_id ?? '') === args.editor
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await runWedWrite({
        sb: supabase,
        fn: 'wed_save_deliverable',
        args: { p_booking_id: booking.id, p_item: payload },
        reload,
        // แก้รายการเดิม: ค่าในข้อมูลล่าสุดตรงกับที่ส่ง = สำเร็จ · รายการใหม่: ตรวจไม่ได้ (ไม่มีรหัสในประวัติ) → ส่งซ้ำด้วยรหัสเดิม
        verify: item ? fresh => fresh.deliverables.some(d => d.id === item.id && same(d)) : undefined,
      })
      if (res.status === 'ok') {
        if (!item) clearPendingWrite(key, cid)
        const auto = res.booking.status === 'delivered' && booking.status === 'in_production'
        onApplied(res.booking, res.already
          ? 'รายการนี้บันทึกไว้แล้วก่อนหน้า (ไม่ได้เพิ่มซ้ำ)'
          : `${item ? 'บันทึก' : 'เพิ่ม'}รายการส่งงานแล้ว${auto ? ' — ส่งครบทุกรายการ งานเปลี่ยนเป็น "ส่งงานแล้ว"' : ''}`)
        onClose()
        return
      }
      if (res.status === 'rejected') {
        if (!item && (res.definite || !hadPending || clientIdTakenElsewhere(res.message))) {
          clearPendingWrite(key, cid)
          clientIdRef.current = newUuid()
          setLocked(false)
        }
        setError({ text: res.message, tone: 'err' })
        return
      }
      if (!item) setLocked(true)
      setError({ text: res.message, tone: 'warn' })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const disabled = busy || locked
  return (
    <DialogShell
      title={item ? 'แก้รายการส่งงาน' : 'เพิ่มรายการส่งงาน'}
      subtitle={`${booking.booking_no} · ${booking.couple_names}`}
      icon={<Clapperboard {...ICON_SM} />}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          {error && <DialogMessage tone={error.tone} text={error.text} />}
          <div className="flex gap-2 sm:justify-end">
            <button type="button" onClick={onClose} disabled={busy} className="btn-secondary px-5">ยกเลิก</button>
            <button type="button" onClick={submit} disabled={!canSubmit} className="btn-primary flex-1 sm:flex-none sm:min-w-[180px]">
              {busy && <Loader2 {...ICON_SM} className="animate-spin" />}
              {busy ? 'กำลังบันทึก...' : locked ? 'ส่งอีกครั้ง' : item ? 'บันทึก' : 'เพิ่มรายการ'}
            </button>
          </div>
        </>
      }
    >
      <div>
        <label htmlFor={ids.name} className="field-label">ชื่องานที่ส่ง *</label>
        <input
          id={ids.name}
          className="input"
          value={name}
          maxLength={MAX_NAME}
          disabled={disabled}
          autoComplete="off"
          placeholder="เช่น ภาพถ่ายแต่งสีครบ / วิดีโอไฮไลต์ 3–5 นาที / คลิปสั้นลงโซเชียล"
          onChange={e => setName(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={ids.qty} className="field-label">จำนวน *</label>
          <input
            id={ids.qty}
            className="input text-right tabular-nums"
            inputMode="numeric"
            autoComplete="off"
            value={qty}
            disabled={disabled}
            aria-invalid={!qtyOk}
            onChange={e => setQty(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={ids.unit} className="field-label">หน่วย</label>
          <input
            id={ids.unit}
            className="input"
            value={unit}
            maxLength={MAX_UNIT}
            disabled={disabled}
            autoComplete="off"
            placeholder="ภาพ / คลิป / อัลบั้ม"
            onChange={e => setUnit(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label htmlFor={ids.due} className="field-label">กำหนดส่ง</label>
        <input id={ids.due} type="date" className="input" value={due} disabled={disabled} onChange={e => setDue(e.target.value)} />
        <p className="field-hint">{due && isDayKey(due) ? formatThaiDate(due) : 'ไม่ระบุ = ไม่นับเกินกำหนด'}</p>
      </div>
      <div>
        <p className="field-label">สถานะ</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="group" aria-label="สถานะงานที่ส่ง">
          {WED_DELIVERABLE_STATUSES.map(s => (
            <button key={s} type="button" className="choice" aria-pressed={status === s} disabled={disabled} onClick={() => setStatus(s)}>
              {DELIVERABLE_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor={ids.link} className="field-label">ลิงก์ส่งงาน{status === 'delivered' ? ' (หรือใส่หมายเหตุวิธีส่ง)' : ''}</label>
        <input
          id={ids.link}
          className="input"
          type="url"
          inputMode="url"
          value={link}
          maxLength={MAX_LINK}
          disabled={disabled}
          autoComplete="off"
          placeholder="https://drive.google.com/..."
          aria-invalid={!linkOk}
          onChange={e => setLink(e.target.value)}
        />
        <p className={clsx('field-hint', !linkOk && 'text-red-700 font-medium')}>
          {!linkOk ? 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://' : 'ลูกค้าเห็นลิงก์นี้ในหน้าติดตามงานเมื่อสถานะเป็น "ส่งแล้ว"'}
        </p>
      </div>
      <div>
        <label htmlFor={ids.note} className="field-label">หมายเหตุ</label>
        <textarea
          id={ids.note}
          className="input min-h-[80px]"
          value={note}
          maxLength={MAX_NOTE}
          disabled={disabled}
          placeholder="เช่น ส่งไฟล์ทางไดรฟ์ของลูกค้า / รอลูกค้าเลือกภาพ"
          onChange={e => setNote(e.target.value)}
        />
        {needProof && <p className="field-hint text-red-700 font-medium">บันทึก &quot;ส่งแล้ว&quot; ต้องใส่ลิงก์ส่งงาน หรือหมายเหตุวิธีส่งงาน</p>}
      </div>
      <div>
        <label htmlFor={ids.editor} className="field-label">ผู้ตัดต่อ / ผู้รับผิดชอบ</label>
        <select id={ids.editor} className="input" value={editor} disabled={disabled || crewLoading} onChange={e => setEditor(e.target.value)}>
          <option value="">{crewLoading ? 'กำลังโหลดรายชื่อทีม...' : 'ยังไม่ระบุ'}</option>
          {editorOptions.map(c => (
            <option key={c.id} value={c.id}>
              {crewDisplayName(c)} · {crewRoleLabel(c.role)}{c.is_active ? '' : ' (ปิดใช้งาน)'}
            </option>
          ))}
          {/* ผู้ตัดต่อเดิมที่ไม่อยู่ในรายชื่อ (โหลดไม่ได้) — ยังเลือกค้างไว้ได้ ไม่หายเงียบ */}
          {editor && !editorOptions.some(c => c.id === editor) && (
            <option value={editor}>{item?.editor_name ?? 'ผู้ตัดต่อเดิม'}</option>
          )}
        </select>
      </div>
    </DialogShell>
  )
}
