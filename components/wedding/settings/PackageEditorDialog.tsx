'use client'
// ป็อปอัปเพิ่ม/แก้แพ็กเกจ (เฉพาะผู้จัดการ) — wed_save_package
// - เพิ่มใหม่: ส่ง client_id (สุ่มครั้งเดียวต่อร่าง) → กดซ้ำ/เน็ตหลุดแล้วลองใหม่ ไม่เกิดแพ็กเกจซ้ำ
//   ไม่รู้ผลแล้วปิดป็อปอัป → ร่าง + รหัสเดิมเก็บไว้ที่หน้า (เปิด "เพิ่มแพ็กเกจ" ใหม่ได้ค่าเดิม ส่งซ้ำด้วยรหัสเดิม)
// - แก้ไข: ส่ง updated_at ที่โหลดมา → เครื่องอื่นแก้ก่อน = บันทึกไม่ผ่าน ให้กด "โหลดข้อมูลล่าสุด" (สิ่งที่พิมพ์ไว้ไม่หาย)
// รายการงานที่ส่ง = ค่าตั้งต้นของงานที่เลือกแพ็กเกจนี้ (แก้ในงานได้จนกว่าจะยืนยันงาน) · แถวว่างไม่ถูกบันทึก
import { useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, Loader2, Package, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { newUuid } from '@/lib/products'
import { MAX_PACKAGE_DELIVERABLES, parseWedPackage, type WedPackage } from '@/lib/wedding'
import DialogShell, { DialogMessage } from '@/components/rental/booking/DialogShell'
import {
  buildPackage, COMMON_DELIVERABLES, COMMON_UNITS, emptyPackageForm, emptyPlanRow, MAX_CREW_SIZE, packageMatches,
  packageToForm, PACKAGE_LIMITS, planErrorKey, type PackageForm, type PlanRow,
} from './packageForm'
import { saveRecord } from './wedRpc'

/** ร่างแพ็กเกจใหม่ที่บันทึกแล้ว "ไม่รู้ผล" — หน้าเก็บไว้ให้เปิดป็อปอัปใหม่ได้ค่าเดิม + รหัสคำขอเดิม */
export interface PackageDraft {
  clientId: string
  form: PackageForm
}

type Msg = { tone: 'err' | 'warn' | 'ok' | 'info'; text: string } | null

export default function PackageEditorDialog({
  initial,
  draft,
  nextSort,
  onClose,
  onSaved,
  onDraft,
  reload,
}: {
  /** null = เพิ่มใหม่ */
  initial: WedPackage | null
  draft: PackageDraft | null
  nextSort: number
  onClose: () => void
  /** keepOpen = บันทึกแล้วแต่ยังเปิดป็อปอัปค้างไว้ (ได้แพ็กเกจที่บันทึกไว้ก่อนหน้าคืนมา ค่าไม่ตรงกับที่กรอก) */
  onSaved: (pkg: WedPackage, info: { created: boolean; keepOpen: boolean }) => void
  onDraft: (draft: PackageDraft | null) => void
  reload: (id: string) => Promise<WedPackage | null>
}) {
  const supabase = useMemo(() => createClient(), [])
  const [loaded, setLoaded] = useState<WedPackage | null>(initial)
  const [form, setForm] = useState<PackageForm>(() =>
    initial ? packageToForm(initial) : draft ? draft.form : emptyPackageForm())
  const [clientId] = useState(() => (initial ? '' : draft?.clientId ?? newUuid()))
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const unsureRef = useRef(!initial && draft !== null)
  const [msg, setMsg] = useState<Msg>(
    !initial && draft ? { tone: 'warn', text: 'คำขอครั้งก่อนยังไม่ทราบผล — กดบันทึกอีกครั้งได้เลย ถ้าบันทึกไปแล้วจะได้แพ็กเกจเดิม ไม่สร้างซ้ำ' } : null,
  )
  const [conflict, setConflict] = useState(false)

  const built = useMemo(() => buildPackage(form), [form])
  const err = (key: string) => (submitted ? built.errors[key] : undefined)

  function set<K extends keyof PackageForm>(key: K, value: PackageForm[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }
  function setRow(i: number, patch: Partial<PlanRow>) {
    setForm(f => ({ ...f, deliverables: f.deliverables.map((r, j) => (j === i ? { ...r, ...patch } : r)) }))
  }
  function moveRow(i: number, delta: number) {
    setForm(f => {
      const to = i + delta
      if (to < 0 || to >= f.deliverables.length) return f
      const rows = f.deliverables.slice()
      const [item] = rows.splice(i, 1)
      rows.splice(to, 0, item)
      return { ...f, deliverables: rows }
    })
  }
  function removeRow(i: number) {
    setForm(f => ({ ...f, deliverables: f.deliverables.filter((_, j) => j !== i) }))
  }
  function addRow() {
    setForm(f => (f.deliverables.length >= MAX_PACKAGE_DELIVERABLES ? f : { ...f, deliverables: [...f.deliverables, emptyPlanRow()] }))
  }

  async function reloadLatest() {
    if (!loaded || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const fresh = await reload(loaded.id)
      if (!fresh) {
        setMsg({ tone: 'err', text: 'ไม่พบแพ็กเกจนี้แล้ว (อาจถูกลบจากเครื่องอื่น) — ปิดป็อปอัปแล้วโหลดหน้าใหม่' })
        return
      }
      // ใช้เวอร์ชันล่าสุดเป็นตัวล็อก แต่คงค่าที่ผู้ใช้กำลังแก้ไว้ — กดบันทึกอีกครั้ง = ใช้ค่าบนจอนี้
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
      const out = await saveRecord<WedPackage>({
        sb: supabase,
        fn: 'wed_save_package',
        args: {
          p_package: editing
            ? { id: editing.id, updated_at: editing.updated_at, ...payload }
            : { client_id: clientId, sort_order: nextSort, ...payload },
        },
        parse: parseWedPackage,
        wasUnsure: unsureRef.current,
        reload: editing ? () => reload(editing.id) : undefined,
        matches: editing ? p => packageMatches(p, payload) : undefined,
      })
      if (out.status === 'ok') {
        unsureRef.current = false
        if (!editing) onDraft(null)
        // ได้แพ็กเกจที่บันทึกไว้จากการกดครั้งก่อนคืนมา และค่าไม่ตรงกับที่กรอกตอนนี้ → ค้างป็อปอัปไว้ให้กดบันทึกทับ
        if (!editing && out.already && !packageMatches(out.value, payload)) {
          setLoaded(out.value)
          setMsg({
            tone: 'warn',
            text: 'แพ็กเกจนี้ถูกบันทึกไว้แล้วจากการกดครั้งก่อน (ค่าตามครั้งนั้น) — ตรวจข้อมูลบนจอแล้วกดบันทึกอีกครั้งเพื่อแก้เป็นค่าล่าสุด',
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
    // ร่างใหม่ที่ยังไม่รู้ผล → เก็บค่าล่าสุดบนจอไว้กับรหัสเดิม
    if (!loaded && unsureRef.current) onDraft({ clientId, form })
    onClose()
  }

  const title = loaded ? `แก้ไขแพ็กเกจ` : 'เพิ่มแพ็กเกจ'
  const rows = form.deliverables

  return (
    <DialogShell
      title={title}
      subtitle={loaded ? loaded.name : 'ราคา ชั่วโมงทำงาน ทีมงาน และรายการงานที่ลูกค้าจะได้รับ'}
      icon={<Package {...ICON_SM} />}
      busy={busy}
      wide
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
              {busy ? 'กำลังบันทึก...' : 'บันทึกแพ็กเกจ'}
            </button>
          </div>
        </>
      )}
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={e => { e.preventDefault(); void save() }}
      >
        <div className="min-w-0">
          <label htmlFor="wp-name" className="field-label">ชื่อแพ็กเกจ *</label>
          <input
            id="wp-name"
            className="input"
            maxLength={PACKAGE_LIMITS.name}
            autoComplete="off"
            placeholder="เช่น Full Day Photo + Video"
            value={form.name}
            disabled={busy}
            aria-invalid={err('name') ? true : undefined}
            aria-describedby={err('name') ? 'wp-name-err' : undefined}
            onChange={e => set('name', e.target.value)}
          />
          {err('name') && <p id="wp-name-err" role="alert" className="mt-1 text-sm text-red-700">{err('name')}</p>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="min-w-0">
            <label htmlFor="wp-price" className="field-label">ราคา (บาท)</label>
            <input
              id="wp-price"
              className="input text-right tabular-nums"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={form.price}
              disabled={busy}
              aria-invalid={err('price') ? true : undefined}
              aria-describedby={err('price') ? 'wp-price-err' : undefined}
              onChange={e => set('price', e.target.value)}
              onFocus={e => e.currentTarget.select()}
            />
            {err('price') && <p id="wp-price-err" role="alert" className="mt-1 text-sm text-red-700">{err('price')}</p>}
          </div>
          <div className="min-w-0">
            <label htmlFor="wp-hours" className="field-label">ชั่วโมงทำงาน</label>
            <input
              id="wp-hours"
              className="input text-right tabular-nums"
              inputMode="decimal"
              autoComplete="off"
              placeholder="เช่น 8 หรือ 4.5"
              value={form.hours}
              disabled={busy}
              aria-invalid={err('hours') ? true : undefined}
              aria-describedby="wp-hours-hint"
              onChange={e => set('hours', e.target.value)}
              onFocus={e => e.currentTarget.select()}
            />
            {err('hours')
              ? <p id="wp-hours-hint" role="alert" className="mt-1 text-sm text-red-700">{err('hours')}</p>
              : <p id="wp-hours-hint" className="field-hint">เกินจากนี้คิดค่าล่วงเวลา</p>}
          </div>
          <div className="min-w-0">
            <label htmlFor="wp-crew" className="field-label">จำนวนทีมงาน (คน)</label>
            <input
              id="wp-crew"
              className="input text-right tabular-nums"
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              value={form.crew_size}
              disabled={busy}
              aria-invalid={err('crew_size') ? true : undefined}
              aria-describedby="wp-crew-hint"
              onChange={e => set('crew_size', e.target.value)}
              onFocus={e => e.currentTarget.select()}
            />
            {err('crew_size')
              ? <p id="wp-crew-hint" role="alert" className="mt-1 text-sm text-red-700">{err('crew_size')}</p>
              : <p id="wp-crew-hint" className="field-hint">0–{MAX_CREW_SIZE} คน</p>}
          </div>
        </div>

        <div className="min-w-0">
          <label htmlFor="wp-desc" className="field-label">รายละเอียดแพ็กเกจ</label>
          <textarea
            id="wp-desc"
            className="input"
            rows={4}
            maxLength={PACKAGE_LIMITS.description}
            placeholder={'เช่น ช่างภาพ 2 + ช่างวิดีโอ 1 ตั้งแต่พิธีเช้าถึงงานเลี้ยง\nรวมภาพพรีวิวภายใน 24 ชม.'}
            value={form.description}
            disabled={busy}
            aria-invalid={err('description') ? true : undefined}
            aria-describedby="wp-desc-hint"
            onChange={e => set('description', e.target.value)}
          />
          {err('description')
            ? <p id="wp-desc-hint" role="alert" className="mt-1 text-sm text-red-700">{err('description')}</p>
            : <p id="wp-desc-hint" className="field-hint">แสดงบนใบเสนอราคา/ใบยืนยันการจอง · ขึ้นบรรทัดใหม่ได้</p>}
        </div>

        <fieldset className="space-y-2">
          <legend className="field-label">งานที่ลูกค้าจะได้รับ (ส่งงาน)</legend>
          <p className="field-hint">นับวันส่งจากวันงานวันสุดท้าย — งานที่ยืนยันแล้วจะได้รายการส่งงานพร้อมวันครบกำหนดอัตโนมัติ</p>
          <datalist id="wp-common-names">
            {COMMON_DELIVERABLES.map(n => <option key={n} value={n} />)}
          </datalist>
          <datalist id="wp-common-units">
            {COMMON_UNITS.map(u => <option key={u} value={u} />)}
          </datalist>
          {rows.length === 0 ? (
            <p className="panel p-3 text-sm text-gray-500">ยังไม่มีรายการ — เพิ่มอย่างน้อย 1 รายการเพื่อให้ติดตามการส่งงานได้</p>
          ) : (
            <ol className="space-y-2" aria-label="รายการงานที่ส่ง">
              {rows.map((r, i) => {
                const base = `wp-row-${r.key}`
                const e = (f: 'name' | 'qty' | 'unit' | 'due_days') => (submitted ? built.errors[planErrorKey(i, f)] : undefined)
                const rowErr = e('name') ?? e('qty') ?? e('unit') ?? e('due_days')
                return (
                  <li key={r.key} className={clsx('panel space-y-2 p-3', rowErr && 'border-red-200')}>
                    <div className="flex items-end gap-2">
                      <div className="min-w-0 flex-1">
                        <label htmlFor={`${base}-name`} className="text-xs font-medium text-gray-600">รายการที่ {i + 1}</label>
                        <input
                          id={`${base}-name`}
                          className="input"
                          list="wp-common-names"
                          maxLength={PACKAGE_LIMITS.item_name}
                          autoComplete="off"
                          placeholder="เช่น วิดีโอไฮไลต์"
                          value={r.name}
                          disabled={busy}
                          aria-invalid={e('name') ? true : undefined}
                          onChange={ev => setRow(i, { name: ev.target.value })}
                        />
                      </div>
                      <div className="flex shrink-0 items-center">
                        <button
                          type="button"
                          onClick={() => moveRow(i, -1)}
                          disabled={busy || i === 0}
                          className="btn-icon btn-icon-plain"
                          aria-label={`เลื่อนรายการที่ ${i + 1} ขึ้น`}
                        >
                          <ArrowUp {...ICON_SM} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveRow(i, 1)}
                          disabled={busy || i === rows.length - 1}
                          className="btn-icon btn-icon-plain"
                          aria-label={`เลื่อนรายการที่ ${i + 1} ลง`}
                        >
                          <ArrowDown {...ICON_SM} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeRow(i)}
                          disabled={busy}
                          className="btn-icon btn-icon-danger"
                          aria-label={`ลบรายการที่ ${i + 1}`}
                        >
                          <Trash2 {...ICON_SM} />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="min-w-0">
                        <label htmlFor={`${base}-qty`} className="text-xs font-medium text-gray-600">จำนวน</label>
                        <input
                          id={`${base}-qty`}
                          className="input text-right tabular-nums"
                          inputMode="numeric"
                          autoComplete="off"
                          value={r.qty}
                          disabled={busy}
                          aria-invalid={e('qty') ? true : undefined}
                          onChange={ev => setRow(i, { qty: ev.target.value })}
                          onFocus={ev => ev.currentTarget.select()}
                        />
                      </div>
                      <div className="min-w-0">
                        <label htmlFor={`${base}-unit`} className="text-xs font-medium text-gray-600">หน่วย</label>
                        <input
                          id={`${base}-unit`}
                          className="input"
                          list="wp-common-units"
                          maxLength={PACKAGE_LIMITS.item_unit}
                          autoComplete="off"
                          placeholder="ภาพ"
                          value={r.unit}
                          disabled={busy}
                          aria-invalid={e('unit') ? true : undefined}
                          onChange={ev => setRow(i, { unit: ev.target.value })}
                        />
                      </div>
                      <div className="min-w-0">
                        <label htmlFor={`${base}-due`} className="text-xs font-medium text-gray-600">ส่งภายใน (วัน)</label>
                        <input
                          id={`${base}-due`}
                          className="input text-right tabular-nums"
                          inputMode="numeric"
                          autoComplete="off"
                          value={r.due_days}
                          disabled={busy}
                          aria-invalid={e('due_days') ? true : undefined}
                          onChange={ev => setRow(i, { due_days: ev.target.value })}
                          onFocus={ev => ev.currentTarget.select()}
                        />
                      </div>
                    </div>
                    {rowErr && <p role="alert" className="text-sm text-red-700">{rowErr}</p>}
                  </li>
                )
              })}
            </ol>
          )}
          {submitted && built.errors.deliverables && <p role="alert" className="text-sm text-red-700">{built.errors.deliverables}</p>}
          <button
            type="button"
            onClick={addRow}
            disabled={busy || rows.length >= MAX_PACKAGE_DELIVERABLES}
            className="btn-dashed w-full"
          >
            <Plus {...ICON_SM} />
            {rows.length >= MAX_PACKAGE_DELIVERABLES ? `ครบ ${MAX_PACKAGE_DELIVERABLES} รายการแล้ว` : 'เพิ่มรายการงานที่ส่ง'}
          </button>
        </fieldset>

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
              <span className="block text-xs text-gray-500">ปิด = ไม่แสดงเป็นตัวเลือกตอนสร้างงานใหม่ (งานเดิมที่ใช้แพ็กเกจนี้ไม่เปลี่ยน)</span>
            </span>
            <span aria-hidden="true" className={clsx('switch switch-leaf', form.is_active && 'switch-on')}>
              <span className="switch-knob" />
            </span>
          </button>
        </div>
        {/* Enter ในช่องกรอก = บันทึก (ปุ่มจริงอยู่ท้ายป็อปอัป) */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">บันทึก</button>
      </form>
    </DialogShell>
  )
}
