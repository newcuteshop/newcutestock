'use client'
// ป็อปอัปเพิ่ม/แก้ทีมงาน (เฉพาะผู้จัดการ) — wed_save_crew
// - เพิ่มใหม่: ส่ง client_id (สุ่มครั้งเดียวต่อร่าง) → กดซ้ำ/เน็ตหลุดแล้วลองใหม่ ไม่เกิดคนซ้ำ · ไม่รู้ผลแล้วปิด = หน้าเก็บร่าง+รหัสเดิมไว้
// - แก้ไข: ส่ง updated_at ที่โหลดมา → เครื่องอื่นแก้ก่อน = บันทึกไม่ผ่าน ให้กด "โหลดข้อมูลล่าสุด" (ค่าที่แก้ไว้ไม่หาย)
// ค่าตัวเริ่มต้น = ค่าตั้งต้นตอนใส่คนนี้ลงคิวงาน (แก้รายคิวได้) — เปลี่ยนแล้วไม่กระทบคิวที่ใส่ไปแล้ว
// ปิดใช้งาน = ไม่แสดงเป็นตัวเลือกตอนจัดทีมในงานใหม่ แต่ประวัติคิว/ค่าตัวเดิมยังอยู่ครบ (ไม่มีการลบทีมงาน)
import { useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Check, Loader2, RefreshCw, Save, UserRound } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { newUuid } from '@/lib/products'
import { CREW_COLORS, CREW_ROLE_LABELS, parseWedCrew, WED_CREW_ROLES, type WedCrew } from '@/lib/wedding'
import DialogShell, { DialogMessage } from '@/components/rental/booking/DialogShell'
import { rawUpdatedAt, saveRecord } from '@/components/wedding/settings/wedRpc'
import CrewAvatar from './CrewAvatar'
import { buildCrew, CREW_LIMITS, crewMatches, crewToForm, emptyCrewForm, type CrewForm } from './crewModel'

export interface CrewDraft {
  clientId: string
  form: CrewForm
}

/** ทีมงาน + เวลาแก้ไขล่าสุด (ตัวล็อกกันเขียนทับ — ตัวอ่าน WedCrew ไม่เก็บช่องนี้) */
export interface CrewWithVersion {
  crew: WedCrew
  updatedAt: string | null
}

type Msg = { tone: 'err' | 'warn' | 'ok' | 'info'; text: string } | null

// ชื่อสีตามลำดับ CREW_COLORS (lib/wedding) — ใช้เป็นชื่อปุ่มสำหรับโปรแกรมอ่านจอ
const COLOR_NAMES = ['น้ำตาลทอง', 'แดง', 'ส้มอิฐ', 'เขียว', 'ฟ้าเข้ม', 'น้ำเงิน', 'ม่วง', 'แดงไวน์', 'เขียวมะกอก', 'เทาเข้ม']

// อ่านผลของ wed_save_crew → ทีมงาน + updated_at
function parseSaved(data: unknown): CrewWithVersion | null {
  const crew = parseWedCrew(data)
  return crew ? { crew, updatedAt: rawUpdatedAt(data) } : null
}

export default function CrewEditorDialog({
  initial,
  draft,
  defaultColor,
  onClose,
  onSaved,
  onDraft,
  reload,
}: {
  initial: CrewWithVersion | null
  draft: CrewDraft | null
  defaultColor: string
  onClose: () => void
  onSaved: (saved: CrewWithVersion, info: { created: boolean; keepOpen: boolean }) => void
  onDraft: (draft: CrewDraft | null) => void
  reload: (id: string) => Promise<CrewWithVersion | null>
}) {
  const supabase = useMemo(() => createClient(), [])
  const [loaded, setLoaded] = useState<CrewWithVersion | null>(initial)
  const [form, setForm] = useState<CrewForm>(() =>
    initial ? crewToForm(initial.crew) : draft ? draft.form : emptyCrewForm(defaultColor))
  const [clientId] = useState(() => (initial ? '' : draft?.clientId ?? newUuid()))
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const unsureRef = useRef(!initial && draft !== null)
  const [msg, setMsg] = useState<Msg>(
    !initial && draft ? { tone: 'warn', text: 'คำขอครั้งก่อนยังไม่ทราบผล — กดบันทึกอีกครั้งได้เลย ถ้าบันทึกไปแล้วจะได้รายชื่อเดิม ไม่สร้างซ้ำ' } : null,
  )
  const [conflict, setConflict] = useState(false)

  const built = useMemo(() => buildCrew(form), [form])
  const err = (key: string) => (submitted ? built.errors[key] : undefined)

  function set<K extends keyof CrewForm>(key: K, value: CrewForm[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function reloadLatest() {
    if (!loaded || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const fresh = await reload(loaded.crew.id)
      if (!fresh) {
        setMsg({ tone: 'err', text: 'ไม่พบทีมงานคนนี้แล้ว — ปิดป็อปอัปแล้วโหลดหน้าใหม่' })
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
      const out = await saveRecord<CrewWithVersion>({
        sb: supabase,
        fn: 'wed_save_crew',
        args: {
          p_crew: editing
            ? { id: editing.crew.id, ...(editing.updatedAt ? { updated_at: editing.updatedAt } : {}), ...payload }
            : { client_id: clientId, ...payload },
        },
        parse: parseSaved,
        wasUnsure: unsureRef.current,
        reload: editing ? () => reload(editing.crew.id) : undefined,
        matches: editing ? v => crewMatches(v.crew, payload) : undefined,
      })
      if (out.status === 'ok') {
        unsureRef.current = false
        if (!editing) onDraft(null)
        if (!editing && out.already && !crewMatches(out.value.crew, payload)) {
          setLoaded(out.value)
          setMsg({
            tone: 'warn',
            text: 'ทีมงานคนนี้ถูกบันทึกไว้แล้วจากการกดครั้งก่อน (ค่าตามครั้งนั้น) — ตรวจข้อมูลบนจอแล้วกดบันทึกอีกครั้งเพื่อแก้เป็นค่าล่าสุด',
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

  const preview = { name: form.name || 'ทีมงาน', nickname: form.nickname, color: built.payload.color, is_active: form.is_active }

  return (
    <DialogShell
      title={loaded ? 'แก้ไขทีมงาน' : 'เพิ่มทีมงาน'}
      subtitle={loaded ? loaded.crew.name : 'ช่างภาพ ช่างวิดีโอ คอนเทนต์ ผู้ช่วย ตัดต่อ ฯลฯ'}
      icon={<UserRound {...ICON_SM} />}
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
              {busy ? 'กำลังบันทึก...' : 'บันทึกทีมงาน'}
            </button>
          </div>
        </>
      )}
    >
      <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); void save() }}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor="wc-name" className="field-label">ชื่อ-นามสกุล *</label>
            <input
              id="wc-name"
              className="input"
              maxLength={CREW_LIMITS.name}
              autoComplete="off"
              value={form.name}
              disabled={busy}
              aria-invalid={err('name') ? true : undefined}
              aria-describedby={err('name') ? 'wc-name-err' : undefined}
              onChange={e => set('name', e.target.value)}
            />
            {err('name') && <p id="wc-name-err" role="alert" className="mt-1 text-sm text-red-700">{err('name')}</p>}
          </div>
          <div className="min-w-0">
            <label htmlFor="wc-nick" className="field-label">ชื่อเล่น</label>
            <input
              id="wc-nick"
              className="input"
              maxLength={CREW_LIMITS.nickname}
              autoComplete="off"
              placeholder="ชื่อที่ใช้เรียกในตารางงาน"
              value={form.nickname}
              disabled={busy}
              aria-invalid={err('nickname') ? true : undefined}
              aria-describedby={err('nickname') ? 'wc-nick-err' : undefined}
              onChange={e => set('nickname', e.target.value)}
            />
            {err('nickname') && <p id="wc-nick-err" role="alert" className="mt-1 text-sm text-red-700">{err('nickname')}</p>}
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="field-label">หน้าที่หลัก</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="หน้าที่หลัก">
            {WED_CREW_ROLES.map(r => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={form.role === r}
                onClick={() => set('role', r)}
                disabled={busy}
                className="choice min-h-[48px]"
              >
                {CREW_ROLE_LABELS[r]}
              </button>
            ))}
          </div>
          <p className="field-hint">ในแต่ละคิวเลือกหน้าที่ใหม่ได้ (เช่น ช่างภาพมาช่วยถ่ายวิดีโอ)</p>
        </fieldset>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="min-w-0">
            <label htmlFor="wc-phone" className="field-label">เบอร์โทร</label>
            <input
              id="wc-phone"
              className="input tabular-nums"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength={30}
              placeholder="เช่น 081-234-5678"
              value={form.phone}
              disabled={busy}
              aria-invalid={err('phone') ? true : undefined}
              aria-describedby={err('phone') ? 'wc-phone-err' : undefined}
              onChange={e => set('phone', e.target.value)}
            />
            {err('phone') && <p id="wc-phone-err" role="alert" className="mt-1 text-sm text-red-700">{err('phone')}</p>}
          </div>
          <div className="min-w-0">
            <label htmlFor="wc-line" className="field-label">LINE ID</label>
            <input
              id="wc-line"
              className="input"
              maxLength={CREW_LIMITS.line_id}
              autoComplete="off"
              value={form.line_id}
              disabled={busy}
              aria-invalid={err('line_id') ? true : undefined}
              aria-describedby={err('line_id') ? 'wc-line-err' : undefined}
              onChange={e => set('line_id', e.target.value)}
            />
            {err('line_id') && <p id="wc-line-err" role="alert" className="mt-1 text-sm text-red-700">{err('line_id')}</p>}
          </div>
          <div className="min-w-0">
            <label htmlFor="wc-fee" className="field-label">ค่าตัวเริ่มต้นต่อคิว (บาท)</label>
            <input
              id="wc-fee"
              className="input text-right tabular-nums"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={form.default_fee}
              disabled={busy}
              aria-invalid={err('default_fee') ? true : undefined}
              aria-describedby="wc-fee-hint"
              onChange={e => set('default_fee', e.target.value)}
              onFocus={e => e.currentTarget.select()}
            />
            {err('default_fee')
              ? <p id="wc-fee-hint" role="alert" className="mt-1 text-sm text-red-700">{err('default_fee')}</p>
              : <p id="wc-fee-hint" className="field-hint">เห็นเฉพาะผู้จัดการ · แก้รายคิวได้</p>}
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="field-label">สีประจำตัว (ใช้ในปฏิทินและตารางงาน)</legend>
          <div className="flex items-center gap-3">
            <CrewAvatar crew={preview} size="lg" />
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="สีประจำตัว">
              {CREW_COLORS.map((c, i) => {
                const selected = form.color.toUpperCase() === c.toUpperCase()
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`สี${COLOR_NAMES[i] ?? ` ${i + 1}`}`}
                    onClick={() => set('color', c)}
                    disabled={busy}
                    className={clsx(
                      'grid h-11 w-11 place-items-center rounded-full border-2 transition-colors disabled:opacity-50',
                      selected ? 'border-gray-900' : 'border-transparent',
                    )}
                  >
                    <span className="grid h-8 w-8 place-items-center rounded-full text-white" style={{ backgroundColor: c }}>
                      {selected && <Check size={16} strokeWidth={2.6} aria-hidden="true" />}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </fieldset>

        <div className="min-w-0">
          <label htmlFor="wc-note" className="field-label">หมายเหตุ</label>
          <textarea
            id="wc-note"
            className="input"
            rows={2}
            maxLength={CREW_LIMITS.note}
            placeholder="เช่น มีโดรน / รับงานเฉพาะเสาร์-อาทิตย์"
            value={form.note}
            disabled={busy}
            aria-invalid={err('note') ? true : undefined}
            aria-describedby="wc-note-hint"
            onChange={e => set('note', e.target.value)}
          />
          {/* wed_list_crew ส่งหมายเหตุให้พนักงานทุกคน (ต่างจากค่าตัว) → ห้ามชวนให้ใส่ข้อมูลส่วนตัว/เลขบัญชีตรงนี้ */}
          {err('note')
            ? <p id="wc-note-hint" role="alert" className="mt-1 text-sm text-red-700">{err('note')}</p>
            : <p id="wc-note-hint" className="field-hint">พนักงานทุกคนเห็นหมายเหตุนี้ — อย่าใส่เลขบัญชีหรือข้อมูลส่วนตัว</p>}
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
              <span className="block text-sm font-semibold text-gray-900">ยังทำงานกับร้าน (ใช้งานอยู่)</span>
              <span className="block text-xs text-gray-500">ปิด = ไม่แสดงเป็นตัวเลือกตอนจัดทีมในงาน — คิวและค่าตัวเดิมยังอยู่ครบ</span>
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
