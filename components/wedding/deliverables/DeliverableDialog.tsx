'use client'
// ป็อปอัปแก้ไขรายการส่งงาน 1 ชิ้นจากกระดาน (ชื่อ / จำนวน / กำหนดส่ง / สถานะ / ลิงก์ส่งงาน / หมายเหตุ / ผู้ตัดต่อ) + ลบรายการ
// - mode 'deliver' = เปิดจากปุ่ม "ส่งงานลูกค้า" ของรายการที่ยังไม่มีลิงก์ → ตั้งสถานะส่งแล้วไว้ให้ + โฟกัสช่องลิงก์
// - กดบันทึกซ้ำระหว่างรอไม่ได้ (busyRef) · ไม่รู้ผล → อ่านแถวจริงมาเทียบก่อน (deliverableWrites)
// - Esc / แตะฉากหลังปิดได้ ยกเว้นระหว่างบันทึก (DialogShell)
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { Clapperboard, ExternalLink, Loader2, Save, Trash2 } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { formatThaiDate, formatThaiDayLong, isDayKey } from '@/lib/format'
import {
  DELIVERABLE_STATUS_LABELS, WED_DELIVERABLE_STATUSES, crewDisplayName, crewRoleLabel, safeHttpUrl,
  type WedCrew, type WedDeliverableBoardItem,
} from '@/lib/wedding'
import type { BrowserSupabase } from '@/lib/products'
import DialogShell, { DialogMessage } from '@/components/rental/booking/DialogShell'
import ConfirmDialog from '@/components/integrations/ConfirmDialog'
import { wedBookingHref } from '@/components/wedding/money/wedRpc'
import {
  DELIVERABLE_LIMITS, buildDeliverablePayload, fieldsFromItem, validateDeliverable,
  type DeliverableFieldKey, type DeliverableFields,
} from './boardModel'
import { deleteDeliverable, saveDeliverable, type DeliverableWriteResult } from './deliverableWrites'

export default function DeliverableDialog({
  item,
  mode,
  crew,
  supabase,
  onClose,
  onSaved,
  onDeleted,
}: {
  item: WedDeliverableBoardItem
  mode: 'edit' | 'deliver'
  crew: readonly WedCrew[]
  supabase: BrowserSupabase
  onClose(): void
  /** บันทึกแล้ว — result.deliverable = null เมื่อยืนยันผลจากการอ่านแถวจริง (ให้กระดานโหลดใหม่) */
  onSaved(result: Extract<DeliverableWriteResult, { status: 'ok' }>, sent: DeliverableFields): void
  onDeleted(result: Extract<DeliverableWriteResult, { status: 'ok' }>): void
}) {
  const uid = useId()
  const [f, setF] = useState<DeliverableFields>(() => fieldsFromItem(item, mode === 'deliver' ? 'delivered' : undefined))
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ tone: 'err' | 'warn'; text: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const busyRef = useRef(false)
  const linkRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (mode === 'deliver') linkRef.current?.focus()
  }, [mode])

  const errors = validateDeliverable(f)
  const shown = tried ? errors : {}

  // ผู้ตัดต่อ: ทีมที่ใช้งานอยู่ (ตำแหน่งตัดต่อขึ้นก่อน) + คนเดิมของรายการแม้ปิดใช้งานไปแล้ว
  const editorOptions = useMemo(() => {
    const list = crew.filter(c => c.is_active || c.id === item.editor_crew_id)
    return [...list].sort((a, b) => Number(b.role === 'editor') - Number(a.role === 'editor') || a.name.localeCompare(b.name, 'th'))
  }, [crew, item.editor_crew_id])
  const editorMissing = !!item.editor_crew_id && !crew.some(c => c.id === item.editor_crew_id)

  function set<K extends DeliverableFieldKey>(key: K, value: DeliverableFields[K]) {
    if (busyRef.current) return
    setF(prev => ({ ...prev, [key]: value }))
    setError(null)
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busyRef.current) return
    setTried(true)
    if (Object.keys(errors).length > 0) {
      setError({ tone: 'err', text: 'กรุณาแก้ช่องที่มีข้อความสีแดงก่อนบันทึก' })
      const first = (Object.keys(errors) as DeliverableFieldKey[])[0]
      document.getElementById(`${uid}-${first}`)?.focus()
      return
    }
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const r = await saveDeliverable(supabase, item.booking_id, buildDeliverablePayload(item.id, f))
      if (r.status === 'ok') {
        onSaved(r, f)
        return
      }
      setError({ tone: r.status === 'unsure' ? 'warn' : 'err', text: r.message })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const r = await deleteDeliverable(supabase, item.id)
      if (r.status === 'ok') {
        setConfirmDelete(false)
        onDeleted(r)
        return
      }
      setConfirmDelete(false)
      setError({ tone: r.status === 'unsure' ? 'warn' : 'err', text: r.message })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const fid = (k: DeliverableFieldKey) => `${uid}-${k}`
  const errId = (k: DeliverableFieldKey) => `${uid}-${k}-err`
  const fieldError = (k: DeliverableFieldKey) => shown[k]
    ? <p id={errId(k)} className="mt-1 text-xs font-medium text-red-700">{shown[k]}</p>
    : null
  const previewLink = safeHttpUrl(f.link_url)
  const formId = `${uid}-form`

  return (
    <>
      {/* ป็อปอัปยืนยันลบ (z-50) อยู่ใต้ DialogShell (z-60) → ระหว่างถามยืนยันซ่อนฟอร์มไว้ก่อน (ค่าที่กรอกยังอยู่ใน state) */}
      {!confirmDelete && (
      <DialogShell
        title={mode === 'deliver' ? 'ส่งงานให้ลูกค้า' : 'แก้ไขรายการส่งงาน'}
        subtitle={
          <span>
            <span className="font-mono">{item.booking_no}</span>
            {item.couple_names ? ` · ${item.couple_names}` : ''}
          </span>
        }
        icon={<Clapperboard {...ICON_SM} />}
        busy={busy}
        wide
        onClose={onClose}
        footer={
          <>
            {error && <DialogMessage tone={error.tone} text={error.text} />}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                className="btn-danger-soft w-full sm:w-auto px-4"
              >
                <Trash2 {...ICON_SM} />
                ลบรายการนี้
              </button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <button type="button" onClick={onClose} disabled={busy} className="btn-secondary w-full sm:w-auto px-5">
                  ยกเลิก
                </button>
                <button type="submit" form={formId} disabled={busy} className="btn-primary w-full sm:w-auto px-6">
                  {busy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Save {...ICON_SM} />}
                  {busy ? 'กำลังบันทึก...' : mode === 'deliver' ? 'บันทึกว่าส่งแล้ว' : 'บันทึก'}
                </button>
              </div>
            </div>
          </>
        }
      >
        <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-4" aria-busy={busy}>
          <div className="grid gap-4 sm:grid-cols-[1fr_6rem_7rem]">
            <div>
              <label htmlFor={fid('name')} className="field-label">ชื่องานที่ส่ง <span className="text-red-700">*</span></label>
              <input
                id={fid('name')}
                className="input"
                value={f.name}
                onChange={e => set('name', e.target.value)}
                maxLength={DELIVERABLE_LIMITS.name + 10}
                placeholder="เช่น ภาพถ่ายแต่งสี, วิดีโอไฮไลต์"
                aria-invalid={!!shown.name}
                aria-describedby={shown.name ? errId('name') : undefined}
              />
              {fieldError('name')}
            </div>
            <div>
              <label htmlFor={fid('qty')} className="field-label">จำนวน</label>
              <input
                id={fid('qty')}
                className="input tabular-nums"
                inputMode="numeric"
                value={f.qty}
                onChange={e => set('qty', e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                aria-invalid={!!shown.qty}
                aria-describedby={shown.qty ? errId('qty') : undefined}
              />
              {fieldError('qty')}
            </div>
            <div>
              <label htmlFor={fid('unit')} className="field-label">หน่วย</label>
              <input
                id={fid('unit')}
                className="input"
                value={f.unit}
                onChange={e => set('unit', e.target.value)}
                maxLength={DELIVERABLE_LIMITS.unit + 5}
                placeholder="ภาพ / คลิป"
                aria-invalid={!!shown.unit}
                aria-describedby={shown.unit ? errId('unit') : undefined}
              />
              {fieldError('unit')}
            </div>
          </div>

          <fieldset>
            <legend className="field-label">สถานะ</legend>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {WED_DELIVERABLE_STATUSES.map(s => (
                <button key={s} type="button" className="choice" aria-pressed={f.status === s} onClick={() => set('status', s)}>
                  {DELIVERABLE_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor={fid('link_url')} className="field-label">
              ลิงก์ส่งงาน{f.status === 'delivered' && <span className="text-red-700"> *</span>}
            </label>
            <input
              id={fid('link_url')}
              ref={linkRef}
              className="input"
              type="url"
              inputMode="url"
              value={f.link_url}
              onChange={e => set('link_url', e.target.value)}
              maxLength={DELIVERABLE_LIMITS.link_url + 20}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://drive.google.com/..."
              aria-invalid={!!shown.link_url}
              aria-describedby={[shown.link_url ? errId('link_url') : '', `${uid}-link-hint`].filter(Boolean).join(' ')}
            />
            {fieldError('link_url')}
            <p id={`${uid}-link-hint`} className="field-hint mt-1">
              ลิงก์นี้ลูกค้าเห็นในหน้าติดตามงานเมื่อสถานะเป็น &quot;ส่งแล้ว&quot; — ส่งทางอื่น (เช่น แฟลชไดรฟ์) ให้เขียนในหมายเหตุแทน
            </p>
            {previewLink && (
              <a href={previewLink} target="_blank" rel="noopener noreferrer" className="link text-sm break-all">
                <ExternalLink size={14} strokeWidth={1.9} aria-hidden="true" />
                ทดลองเปิดลิงก์
              </a>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={fid('due_date')} className="field-label">กำหนดส่ง</label>
              <input
                id={fid('due_date')}
                type="date"
                className="input tabular-nums"
                value={f.due_date}
                onChange={e => set('due_date', e.target.value)}
                aria-describedby={`${uid}-due-be`}
              />
              <p id={`${uid}-due-be`} className="field-hint">
                {isDayKey(f.due_date) ? formatThaiDayLong(f.due_date) : 'ไม่กำหนดวันส่ง'}
                {item.last_session_date ? ` · วันงานสุดท้าย ${formatThaiDate(item.last_session_date)}` : ''}
              </p>
            </div>
            <div>
              <label htmlFor={fid('editor_crew_id')} className="field-label">ผู้ตัดต่อ</label>
              <select
                id={fid('editor_crew_id')}
                className="input"
                value={f.editor_crew_id}
                onChange={e => set('editor_crew_id', e.target.value)}
              >
                <option value="">ยังไม่มอบหมาย</option>
                {editorMissing && item.editor_crew_id && (
                  <option value={item.editor_crew_id}>{item.editor_name || 'ผู้ตัดต่อเดิม'}</option>
                )}
                {editorOptions.map(c => (
                  <option key={c.id} value={c.id}>
                    {crewDisplayName(c)} · {crewRoleLabel(c.role)}{c.is_active ? '' : ' (ปิดใช้งาน)'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor={fid('note')} className="field-label">หมายเหตุ</label>
            <textarea
              id={fid('note')}
              className="input"
              rows={3}
              value={f.note}
              onChange={e => set('note', e.target.value)}
              maxLength={DELIVERABLE_LIMITS.note + 20}
              placeholder="เช่น ลูกค้าขอแก้สีโทนอุ่น, ส่งแฟลชไดรฟ์ทางไปรษณีย์"
              aria-invalid={!!shown.note}
              aria-describedby={shown.note ? errId('note') : undefined}
            />
            {fieldError('note')}
          </div>

          <p className="text-xs text-gray-500">
            งานเต็มอยู่ที่{' '}
            <Link href={wedBookingHref(item.booking_id)} className="font-medium text-brand-700 underline underline-offset-4">
              หน้ารายละเอียดงาน {item.booking_no}
            </Link>
            {' '}(เพิ่มรายการส่งงานใหม่ได้ที่นั่น)
          </p>
        </form>
      </DialogShell>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="ลบรายการส่งงานนี้?"
        confirmLabel="ลบรายการ"
        tone="danger"
        busy={busy}
        onConfirm={() => void handleDelete()}
        onCancel={() => { if (!busyRef.current) setConfirmDelete(false) }}
      >
        <p className="break-words">
          &quot;{item.name}&quot; ของงาน <span className="font-mono">{item.booking_no}</span> จะถูกลบออกจากรายการที่ต้องส่ง
          (ประวัติการลบยังอยู่ในหน้ารายละเอียดงาน)
        </p>
      </ConfirmDialog>
    </>
  )
}
