'use client'
// ป็อปอัปเพิ่ม/แก้บริการเสริม (เฉพาะผู้จัดการ) — wed_save_addon · กติกาการบันทึกเดียวกับป็อปอัปแพ็กเกจ
// (เพิ่มใหม่ส่ง client_id เดิมทุกครั้งที่ลองซ้ำ · แก้ไขส่ง updated_at กันเขียนทับ · ไม่รู้ผล = เก็บร่างไว้ที่หน้า)
import { useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Loader2, RefreshCw, Save, Sparkles } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { newUuid } from '@/lib/products'
import { parseWedAddon, type WedAddon } from '@/lib/wedding'
import DialogShell, { DialogMessage } from '@/components/rental/booking/DialogShell'
import {
  ADDON_LIMITS, addonMatches, addonToForm, buildAddon, COMMON_UNITS, emptyAddonForm, type AddonForm,
} from './packageForm'
import { saveRecord } from './wedRpc'

export interface AddonDraft {
  clientId: string
  form: AddonForm
}

type Msg = { tone: 'err' | 'warn' | 'ok' | 'info'; text: string } | null

export default function AddonEditorDialog({
  initial,
  draft,
  nextSort,
  onClose,
  onSaved,
  onDraft,
  reload,
}: {
  initial: WedAddon | null
  draft: AddonDraft | null
  nextSort: number
  onClose: () => void
  onSaved: (addon: WedAddon, info: { created: boolean; keepOpen: boolean }) => void
  onDraft: (draft: AddonDraft | null) => void
  reload: (id: string) => Promise<WedAddon | null>
}) {
  const supabase = useMemo(() => createClient(), [])
  const [loaded, setLoaded] = useState<WedAddon | null>(initial)
  const [form, setForm] = useState<AddonForm>(() => (initial ? addonToForm(initial) : draft ? draft.form : emptyAddonForm()))
  const [clientId] = useState(() => (initial ? '' : draft?.clientId ?? newUuid()))
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const unsureRef = useRef(!initial && draft !== null)
  const [msg, setMsg] = useState<Msg>(
    !initial && draft ? { tone: 'warn', text: 'คำขอครั้งก่อนยังไม่ทราบผล — กดบันทึกอีกครั้งได้เลย ถ้าบันทึกไปแล้วจะได้รายการเดิม ไม่สร้างซ้ำ' } : null,
  )
  const [conflict, setConflict] = useState(false)

  const built = useMemo(() => buildAddon(form), [form])
  const err = (key: string) => (submitted ? built.errors[key] : undefined)

  function set<K extends keyof AddonForm>(key: K, value: AddonForm[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function reloadLatest() {
    if (!loaded || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const fresh = await reload(loaded.id)
      if (!fresh) {
        setMsg({ tone: 'err', text: 'ไม่พบบริการเสริมนี้แล้ว (อาจถูกลบจากเครื่องอื่น) — ปิดป็อปอัปแล้วโหลดหน้าใหม่' })
        return
      }
      setLoaded(fresh)
      setConflict(false)
      setMsg({ tone: 'info', text: 'โหลดข้อมูลล่าสุดแล้ว — ค่าที่คุณแก้ไว้ยังอยู่ ตรวจอีกครั้งแล้วกดบันทึก' })
    } catch {
      setMsg({ tone: 'err', text: 'โหลดข้อมูลล่าสุดไม่สำเร็จ — ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง' })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function save() {
    if (busyRef.current) return
    setSubmitted(true)
    const { payload, errors } = built
    if (Object.keys(errors).length > 0) {
      setMsg({ tone: 'err', text: 'ข้อมูลบางช่องไม่ถูกต้อง ตรวจช่องที่ขึ้นสีแดงก่อนบันทึก' })
      return
    }
    busyRef.current = true
    setBusy(true)
    setMsg(null)
    setConflict(false)
    const editing = loaded
    try {
      const out = await saveRecord<WedAddon>({
        sb: supabase,
        fn: 'wed_save_addon',
        args: {
          p_addon: editing
            ? { id: editing.id, updated_at: editing.updated_at, ...payload }
            : { client_id: clientId, sort_order: nextSort, ...payload },
        },
        parse: parseWedAddon,
        wasUnsure: unsureRef.current,
        reload: editing ? () => reload(editing.id) : undefined,
        matches: editing ? a => addonMatches(a, payload) : undefined,
      })
      if (out.status === 'ok') {
        unsureRef.current = false
        if (!editing) onDraft(null)
        if (!editing && out.already && !addonMatches(out.value, payload)) {
          setLoaded(out.value)
          setMsg({
            tone: 'warn',
            text: 'บริการเสริมนี้ถูกบันทึกไว้แล้วจากการกดครั้งก่อน (ค่าตามครั้งนั้น) — ตรวจข้อมูลบนจอแล้วกดบันทึกอีกครั้งเพื่อแก้เป็นค่าล่าสุด',
          })
          onSaved(out.value, { created: true, keepOpen: true })
          return
        }
        onSaved(out.value, { created: !editing, keepOpen: false })
        return
      }
      if (out.status === 'rejected') {
        if (out.definite) unsureRef.current = false
        if (out.conflict) setConflict(true)
        setMsg({ tone: 'err', text: out.message })
        return
      }
      unsureRef.current = true
      if (!editing) onDraft({ clientId, form })
      setMsg({ tone: 'warn', text: out.message })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  function close() {
    if (busyRef.current) return
    if (!loaded && unsureRef.current) onDraft({ clientId, form })
    onClose()
  }

  return (
    <DialogShell
      title={loaded ? 'แก้ไขบริการเสริม' : 'เพิ่มบริการเสริม'}
      subtitle={loaded ? loaded.name : 'เช่น โดรน ช่างภาพเพิ่ม ชั่วโมงเพิ่ม อัลบั้ม ไฟล์ดิบ'}
      icon={<Sparkles {...ICON_SM} />}
      busy={busy}
      onClose={close}
      footer={(
        <>
          <div aria-live="polite" className="space-y-2">
            {msg && <DialogMessage tone={msg.tone} text={msg.text} />}
            {conflict && loaded && (
              <button type="button" onClick={() => void reloadLatest()} disabled={busy} className="btn-secondary w-full">
                <RefreshCw {...ICON_SM} />
                โหลดข้อมูลล่าสุด (ค่าที่แก้ไว้ไม่หาย)
              </button>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={close} disabled={busy} className="btn-secondary w-full sm:w-auto px-5">
              ปิด
            </button>
            <button type="button" onClick={() => void save()} disabled={busy} className="btn-primary w-full sm:w-auto sm:min-w-[160px]">
              {busy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Save {...ICON_SM} />}
              {busy ? 'กำลังบันทึก...' : 'บันทึกบริการเสริม'}
            </button>
          </div>
        </>
      )}
    >
      <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); void save() }}>
        <div className="min-w-0">
          <label htmlFor="wa-name" className="field-label">ชื่อบริการเสริม *</label>
          <input
            id="wa-name"
            className="input"
            maxLength={ADDON_LIMITS.name}
            autoComplete="off"
            placeholder="เช่น โดรนถ่ายภาพมุมสูง"
            value={form.name}
            disabled={busy}
            aria-invalid={err('name') ? true : undefined}
            aria-describedby={err('name') ? 'wa-name-err' : undefined}
            onChange={e => set('name', e.target.value)}
          />
          {err('name') && <p id="wa-name-err" role="alert" className="mt-1 text-sm text-red-700">{err('name')}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <label htmlFor="wa-price" className="field-label">ราคาต่อหน่วย (บาท)</label>
            <input
              id="wa-price"
              className="input text-right tabular-nums"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={form.price}
              disabled={busy}
              aria-invalid={err('price') ? true : undefined}
              aria-describedby={err('price') ? 'wa-price-err' : undefined}
              onChange={e => set('price', e.target.value)}
              onFocus={e => e.currentTarget.select()}
            />
            {err('price') && <p id="wa-price-err" role="alert" className="mt-1 text-sm text-red-700">{err('price')}</p>}
          </div>
          <div className="min-w-0">
            <label htmlFor="wa-unit" className="field-label">หน่วย</label>
            <input
              id="wa-unit"
              className="input"
              list="wa-common-units"
              maxLength={ADDON_LIMITS.unit}
              autoComplete="off"
              placeholder="เช่น ชั่วโมง / คน / เล่ม"
              value={form.unit}
              disabled={busy}
              aria-invalid={err('unit') ? true : undefined}
              aria-describedby={err('unit') ? 'wa-unit-err' : undefined}
              onChange={e => set('unit', e.target.value)}
            />
            <datalist id="wa-common-units">
              {COMMON_UNITS.map(u => <option key={u} value={u} />)}
            </datalist>
            {err('unit') && <p id="wa-unit-err" role="alert" className="mt-1 text-sm text-red-700">{err('unit')}</p>}
          </div>
        </div>
        <div className="min-w-0">
          <label htmlFor="wa-desc" className="field-label">รายละเอียด</label>
          <textarea
            id="wa-desc"
            className="input"
            rows={3}
            maxLength={ADDON_LIMITS.description}
            value={form.description}
            disabled={busy}
            aria-invalid={err('description') ? true : undefined}
            aria-describedby="wa-desc-hint"
            onChange={e => set('description', e.target.value)}
          />
          {err('description')
            ? <p id="wa-desc-hint" role="alert" className="mt-1 text-sm text-red-700">{err('description')}</p>
            : <p id="wa-desc-hint" className="field-hint">ราคาในงานคิดเป็น จำนวน × ราคาต่อหน่วย (แก้ราคาเฉพาะงานได้ในฟอร์มงาน)</p>}
        </div>
        <div className="panel p-3">
          <button
            type="button"
            role="switch"
            aria-checked={form.is_active}
            onClick={() => set('is_active', !form.is_active)}
            disabled={busy}
            className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-gray-900">เปิดให้เลือกในฟอร์มงาน</span>
              <span className="block text-xs text-gray-500">ปิด = ไม่แสดงเป็นตัวเลือกตอนสร้าง/แก้งาน (งานเดิมไม่เปลี่ยน)</span>
            </span>
            <span aria-hidden="true" className={clsx('switch switch-leaf', form.is_active && 'switch-on')}>
              <span className="switch-knob" />
            </span>
          </button>
        </div>
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">บันทึก</button>
      </form>
    </DialogShell>
  )
}
