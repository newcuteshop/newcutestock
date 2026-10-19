'use client'
// ฟอร์มเพิ่ม/แก้ไขลูกค้าร้านเช่าชุด (rental_save_customer)
// - เพิ่มใหม่: client_id สร้างครั้งเดียวต่อฟอร์ม ใช้ซ้ำทุกครั้งที่กดบันทึก → เน็ตหลุดแล้วกดใหม่ ระบบไม่สร้างลูกค้าซ้ำ
//   ไม่รู้ผล → ตรวจในฐานข้อมูลก่อนว่ามีลูกค้ารหัสคำขอนี้แล้วหรือยัง (มีแล้ว = บันทึกสำเร็จ) แล้วจึงให้กดซ้ำ
// - แก้ไข: ส่ง updated_at ไปกันเขียนทับข้อมูลที่เครื่องอื่นเพิ่งแก้ ; ไม่รู้ผล → โหลดลูกค้าใหม่มาเทียบก่อน
// - บัญชีดำ: เฉพาะผู้จัดการร้านเช่า (rental_manage) ตั้ง/ยกเลิกได้ — พนักงานเห็นสถานะอย่างเดียว
// - เบอร์ซ้ำไม่ห้าม (ลูกค้าครอบครัวเดียวกันใช้เบอร์เดียวกันได้) แต่เตือนให้เห็นว่ามีในระบบแล้ว
import { useId, useMemo, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { AlertTriangle, Ban, CheckCircle2, Info, Loader2, RefreshCw, Save, ShieldAlert, X, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { newUuid } from '@/lib/products'
import { SOURCE_LABELS, parseCustomer, phoneDigits, type RentalCustomer } from '@/lib/rental'
import { WRITE_TIMEOUT_MS, customerHref, rentalErrorText, rpcWithTimeout, serverAnswered } from '@/components/rental/calendar/rpc'
import {
  LIMITS, STAFF_SOURCES, buildPayload, emptyFields, fieldsFromCustomer, matchesPayload, normalizeIdCard, thaiIdChecksumOk,
  validateFields, type CustomerFieldKey, type CustomerFields,
} from './customerModel'

const UNSURE_MSG = 'ไม่แน่ใจว่าบันทึกแล้วหรือยัง (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — กดบันทึกอีกครั้งได้ ระบบจะไม่สร้างซ้ำ'
const CONFLICT_RE = /ถูกแก้ไขจากเครื่องอื่น/

interface DupHit { id: string; name: string }

export default function CustomerForm({
  mode,
  initial = null,
  canManage,
  onSaved,
  onCancel,
}: {
  mode: 'new' | 'edit'
  initial?: RentalCustomer | null
  canManage: boolean
  /** บันทึกสำเร็จ (already_saved = ข้อมูลนี้ถูกบันทึกไว้ก่อนแล้วจากการกดครั้งก่อน) */
  onSaved: (c: RentalCustomer, info: { already_saved: boolean }) => void
  onCancel?: () => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const uid = useId()
  const [f, setF] = useState<CustomerFields>(() => (initial ? fieldsFromCustomer(initial) : emptyFields()))
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(initial?.updated_at ?? '')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [info, setInfo] = useState('')
  const [dups, setDups] = useState<DupHit[]>([])
  const busyRef = useRef(false)
  const clientIdRef = useRef('')
  const dupReqRef = useRef(0)

  const errors = validateFields(f, { canManage })
  const shownErrors = tried ? errors : {}
  const idNorm = normalizeIdCard(f.id_card_no)
  const idWarn = idNorm && !errors.id_card_no && !thaiIdChecksumOk(idNorm)
    ? 'เลขบัตรประชาชน 13 หลักนี้ตรวจหลักสุดท้ายไม่ผ่าน — ตรวจสอบอีกครั้ง (ถ้าเป็นเลขพาสปอร์ต/เอกสารอื่นบันทึกได้ตามปกติ)'
    : ''

  // เปลี่ยนค่า → ล้างข้อความผลการบันทึกเดิม
  function set<K extends CustomerFieldKey>(key: K, value: CustomerFields[K]) {
    if (busyRef.current) return
    setF(prev => ({ ...prev, [key]: value }))
    setInfo('')
    if (!conflict) setError('')
  }

  // ตรวจเบอร์ซ้ำ (เตือนเท่านั้น) — หลังออกจากช่องเบอร์
  async function checkDuplicatePhone() {
    const d = phoneDigits(f.phone)
    const req = ++dupReqRef.current
    if (d.length < 9 || d.length > 15) {
      setDups([])
      return
    }
    if (mode === 'edit' && initial && phoneDigits(initial.phone) === d) {
      setDups([])
      return
    }
    try {
      const { data, error: e } = await supabase.from('rental_customers').select('id, name').eq('phone', d).limit(5)
      if (req !== dupReqRef.current || e) return
      const hits: DupHit[] = []
      for (const r of (Array.isArray(data) ? data : []) as { id?: unknown; name?: unknown }[]) {
        const id = typeof r.id === 'string' ? r.id : ''
        if (id && id !== initial?.id) hits.push({ id, name: typeof r.name === 'string' ? r.name : '' })
      }
      setDups(hits)
    } catch {
      // ตรวจไม่ได้ (เน็ตหลุด) — ไม่เป็นไร แค่ไม่เตือน
    }
  }

  // โหลดข้อมูลล่าสุดของลูกค้า (ใช้ตอนชนกับเครื่องอื่น / ไม่รู้ผลการแก้ไข)
  async function fetchLatest(id: string): Promise<RentalCustomer | null> {
    const res = await rpcWithTimeout(supabase, 'rental_get_customer', { p_id: id })
    if (res.error) return null
    return parseCustomer(res.data)
  }

  async function reloadLatest() {
    if (!initial || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    const latest = await fetchLatest(initial.id)
    busyRef.current = false
    setBusy(false)
    if (!latest) {
      setError('โหลดข้อมูลล่าสุดไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่')
      return
    }
    setF(fieldsFromCustomer(latest))
    setBaseUpdatedAt(latest.updated_at)
    setConflict(false)
    setError('')
    setTried(false)
    setInfo('โหลดข้อมูลล่าสุดแล้ว — แก้ไขอีกครั้งแล้วกดบันทึก')
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busyRef.current) return
    setTried(true)
    if (Object.keys(errors).length > 0) {
      setError('กรุณาแก้ช่องที่มีข้อความสีแดงก่อนบันทึก')
      // โฟกัสช่องแรกที่ผิด
      const first = (Object.keys(errors) as CustomerFieldKey[])[0]
      document.getElementById(`${uid}-${first}`)?.focus()
      return
    }
    if (mode === 'new' && !clientIdRef.current) clientIdRef.current = newUuid()
    const payload = buildPayload(f, {
      mode,
      canManage,
      clientId: clientIdRef.current,
      id: initial?.id,
      updatedAt: baseUpdatedAt || undefined,
    })
    busyRef.current = true
    setBusy(true)
    setError('')
    setInfo('')
    try {
      const res = await rpcWithTimeout(supabase, 'rental_save_customer', { p_customer: payload }, WRITE_TIMEOUT_MS)
      if (!res.error) {
        const saved = parseCustomer(res.data)
        if (!saved) {
          setError('ระบบตอบกลับไม่ครบ — กดบันทึกอีกครั้งเพื่อตรวจสอบ (ระบบจะไม่สร้างซ้ำ)')
          return
        }
        const already = !!(res.data && typeof res.data === 'object' && (res.data as { already_saved?: unknown }).already_saved === true)
        clientIdRef.current = ''
        setBaseUpdatedAt(saved.updated_at)
        setConflict(false)
        onSaved(saved, { already_saved: already })
        return
      }
      if (!res.timedOut && serverAnswered(res.error)) {
        const msg = rentalErrorText(res.error)
        setConflict(CONFLICT_RE.test(msg))
        setError(msg)
        return
      }
      // ===== ไม่รู้ผล (เน็ตหลุด/หมดเวลา) → ตรวจในฐานข้อมูลก่อนให้กดซ้ำ =====
      if (mode === 'new') {
        const cid = clientIdRef.current
        const { data, error: qe } = await supabase.from('rental_customers').select('id').eq('client_id', cid).maybeSingle()
        const foundId = !qe && data && typeof (data as { id?: unknown }).id === 'string' ? (data as { id: string }).id : ''
        if (foundId) {
          const latest = await fetchLatest(foundId)
          if (latest) {
            clientIdRef.current = ''
            onSaved(latest, { already_saved: true })
            return
          }
        }
        setError(UNSURE_MSG)
        return
      }
      if (initial) {
        const latest = await fetchLatest(initial.id)
        if (latest && matchesPayload(latest, payload)) {
          setBaseUpdatedAt(latest.updated_at)
          onSaved(latest, { already_saved: true })
          return
        }
        if (latest && latest.updated_at !== baseUpdatedAt) {
          // มีคนอื่นแก้หลังจากเราเปิดฟอร์ม (และไม่ใช่ค่าของเรา) → ห้ามเขียนทับเงียบๆ
          setConflict(true)
          setError('ข้อมูลลูกค้านี้ถูกแก้ไขจากเครื่องอื่นระหว่างบันทึก — โหลดข้อมูลล่าสุดก่อน แล้วแก้ไขอีกครั้ง')
          return
        }
        setError(latest ? 'ยังไม่ได้บันทึก (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — กดบันทึกอีกครั้ง' : 'ไม่แน่ใจว่าบันทึกแล้วหรือยัง (เน็ตหลุด) — ตรวจสอบอินเทอร์เน็ตแล้วกดบันทึกอีกครั้ง')
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const fid = (k: CustomerFieldKey) => `${uid}-${k}`
  const errId = (k: CustomerFieldKey) => `${uid}-${k}-err`
  const fieldError = (k: CustomerFieldKey) => shownErrors[k]
    ? <p id={errId(k)} className="mt-1 text-xs font-medium text-red-700">{shownErrors[k]}</p>
    : null
  const describe = (k: CustomerFieldKey, hint?: string) => [shownErrors[k] ? errId(k) : '', hint ?? ''].filter(Boolean).join(' ') || undefined

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-busy={busy}>
      {/* ===== ข้อมูลติดต่อ ===== */}
      <section className="card p-4 sm:p-5 space-y-4" aria-labelledby={`${uid}-contact`}>
        <h2 id={`${uid}-contact`} className="section-title">ข้อมูลติดต่อ</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label htmlFor={fid('name')} className="field-label">ชื่อ-นามสกุล <span className="text-red-700">*</span></label>
            <input
              id={fid('name')}
              className="input"
              value={f.name}
              onChange={e => set('name', e.target.value)}
              maxLength={LIMITS.name + 20}
              autoComplete="off"
              aria-invalid={!!shownErrors.name}
              aria-describedby={describe('name')}
              required
            />
            {fieldError('name')}
          </div>
          <div>
            <label htmlFor={fid('phone')} className="field-label">เบอร์โทร <span className="text-red-700">*</span></label>
            <input
              id={fid('phone')}
              className="input tabular-nums"
              type="tel"
              inputMode="tel"
              value={f.phone}
              onChange={e => { set('phone', e.target.value); setDups([]) }}
              onBlur={() => void checkDuplicatePhone()}
              maxLength={24}
              autoComplete="off"
              placeholder="เช่น 0812345678"
              aria-invalid={!!shownErrors.phone}
              aria-describedby={describe('phone', dups.length > 0 ? `${uid}-dups` : undefined)}
              required
            />
            {fieldError('phone')}
            {dups.length > 0 && (
              <div id={`${uid}-dups`} className="alert-warn mt-2" role="status">
                <Info {...ICON_SM} />
                <div className="min-w-0">
                  <p>เบอร์นี้มีในระบบแล้ว (บันทึกซ้ำได้ถ้าเป็นคนละคน):</p>
                  <ul className="mt-1 space-y-0.5">
                    {dups.map(d => (
                      <li key={d.id}>
                        <Link href={customerHref(d.id)} className="font-medium text-brand-700 underline underline-offset-4 break-words">
                          {d.name || 'ลูกค้า'}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
          <div>
            <label htmlFor={fid('phone2')} className="field-label">เบอร์โทรสำรอง</label>
            <input
              id={fid('phone2')}
              className="input tabular-nums"
              type="tel"
              inputMode="tel"
              value={f.phone2}
              onChange={e => set('phone2', e.target.value)}
              maxLength={24}
              autoComplete="off"
              aria-invalid={!!shownErrors.phone2}
              aria-describedby={describe('phone2')}
            />
            {fieldError('phone2')}
          </div>
          <div>
            <label htmlFor={fid('line_id')} className="field-label">LINE ID</label>
            <input
              id={fid('line_id')}
              className="input"
              value={f.line_id}
              onChange={e => set('line_id', e.target.value)}
              maxLength={LIMITS.line_id + 10}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={!!shownErrors.line_id}
              aria-describedby={describe('line_id')}
            />
            {fieldError('line_id')}
          </div>
          <div>
            <label htmlFor={fid('email')} className="field-label">อีเมล</label>
            <input
              id={fid('email')}
              className="input"
              type="email"
              inputMode="email"
              value={f.email}
              onChange={e => set('email', e.target.value)}
              maxLength={LIMITS.email + 10}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={!!shownErrors.email}
              aria-describedby={describe('email')}
            />
            {fieldError('email')}
          </div>
        </div>
      </section>

      {/* ===== ยืนยันตัวตน ===== */}
      <section className="card p-4 sm:p-5 space-y-4" aria-labelledby={`${uid}-identity`}>
        <div>
          <h2 id={`${uid}-identity`} className="section-title">ข้อมูลยืนยันตัวตน</h2>
          <p className="field-hint">ใช้ทำสัญญาเช่า — เลขบัตรเต็มแสดงเฉพาะหน้ารายละเอียดลูกค้าและสัญญาฉบับร้าน (รายการอื่นแสดงแค่ 4 ตัวท้าย)</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor={fid('id_card_no')} className="field-label">เลขบัตรประชาชน / พาสปอร์ต</label>
            <input
              id={fid('id_card_no')}
              className="input font-mono tabular-nums"
              value={f.id_card_no}
              onChange={e => set('id_card_no', e.target.value)}
              maxLength={LIMITS.id_card_no + 12}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={!!shownErrors.id_card_no}
              aria-describedby={describe('id_card_no', idWarn ? `${uid}-idwarn` : undefined)}
            />
            {fieldError('id_card_no')}
            {idWarn && <p id={`${uid}-idwarn`} className="mt-1 text-xs font-medium text-amber-800">{idWarn}</p>}
          </div>
          <div className="md:col-span-2">
            <label htmlFor={fid('address')} className="field-label">ที่อยู่</label>
            <textarea
              id={fid('address')}
              className="input"
              rows={3}
              value={f.address}
              onChange={e => set('address', e.target.value)}
              maxLength={LIMITS.address + 20}
              aria-invalid={!!shownErrors.address}
              aria-describedby={describe('address')}
            />
            {fieldError('address')}
          </div>
        </div>
      </section>

      {/* ===== อื่นๆ ===== */}
      <section className="card p-4 sm:p-5 space-y-4" aria-labelledby={`${uid}-other`}>
        <h2 id={`${uid}-other`} className="section-title">อื่นๆ</h2>
        {mode === 'new' && (
          <fieldset>
            <legend className="field-label">ลูกค้ารู้จักร้าน / ติดต่อมาทาง</legend>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {STAFF_SOURCES.map(s => (
                <button
                  key={s}
                  type="button"
                  className="choice"
                  aria-pressed={f.source === s}
                  onClick={() => set('source', s)}
                >
                  {SOURCE_LABELS[s]}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <div>
          <label htmlFor={fid('note')} className="field-label">หมายเหตุ (เห็นเฉพาะพนักงาน)</label>
          <textarea
            id={fid('note')}
            className="input"
            rows={3}
            value={f.note}
            onChange={e => set('note', e.target.value)}
            maxLength={LIMITS.note + 20}
            placeholder="เช่น ขนาดตัว ชอบชุดสีอะไร ข้อควรระวัง"
            aria-invalid={!!shownErrors.note}
            aria-describedby={describe('note')}
          />
          {fieldError('note')}
        </div>
      </section>

      {/* ===== บัญชีดำ ===== */}
      <section className={clsx('card p-4 sm:p-5 space-y-3', f.is_blacklisted && 'border-red-200')} aria-labelledby={`${uid}-bl`}>
        <h2 id={`${uid}-bl`} className="section-title">
          <ShieldAlert size={20} strokeWidth={1.75} aria-hidden="true" className={f.is_blacklisted ? '!text-red-700' : undefined} />
          บัญชีดำ
        </h2>
        {canManage ? (
          <>
            <button
              type="button"
              role="switch"
              aria-checked={f.is_blacklisted}
              onClick={() => set('is_blacklisted', !f.is_blacklisted)}
              className="panel flex w-full items-center justify-between gap-3 px-3 py-2.5 min-h-[52px] text-left"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-900">ติดบัญชีดำ (ไม่ให้เช่า)</span>
                <span className="block text-xs text-gray-600">การจองใหม่ของลูกค้านี้ต้องกดยืนยันแบบบังคับ · คำขอจองออนไลน์จะถูกแจ้งเตือน</span>
              </span>
              <span className={clsx('switch', f.is_blacklisted && 'switch-on')} aria-hidden="true"><span className="switch-knob" /></span>
            </button>
            {f.is_blacklisted && (
              <div>
                <label htmlFor={fid('blacklist_reason')} className="field-label">เหตุผล <span className="text-red-700">*</span></label>
                <input
                  id={fid('blacklist_reason')}
                  className="input"
                  value={f.blacklist_reason}
                  onChange={e => set('blacklist_reason', e.target.value)}
                  maxLength={LIMITS.blacklist_reason + 20}
                  placeholder="เช่น คืนชุดช้าหลายครั้ง / ชุดเสียหายไม่ชดใช้"
                  aria-invalid={!!shownErrors.blacklist_reason}
                  aria-describedby={describe('blacklist_reason')}
                />
                {fieldError('blacklist_reason')}
              </div>
            )}
          </>
        ) : (
          <div className={f.is_blacklisted ? 'alert-err' : 'alert-info'}>
            {f.is_blacklisted ? <Ban {...ICON_SM} /> : <Info {...ICON_SM} />}
            <p className="min-w-0 break-words">
              {f.is_blacklisted
                ? `ลูกค้านี้ติดบัญชีดำ${f.blacklist_reason ? `: ${f.blacklist_reason}` : ''}`
                : 'ไม่ติดบัญชีดำ'}
              {' '}— เฉพาะผู้จัดการร้านเช่าชุดเท่านั้นที่ตั้ง/ยกเลิกบัญชีดำได้
            </p>
          </div>
        )}
      </section>

      {/* ===== ผล + ปุ่ม ===== */}
      <div aria-live="polite" className="space-y-2">
        {error && (
          <div role="alert" className={conflict ? 'alert-warn' : 'alert-err'}>
            {conflict ? <AlertTriangle {...ICON_SM} /> : <XCircle {...ICON_SM} />}
            <div className="min-w-0 space-y-2">
              <p className="break-words">{error}</p>
              {conflict && mode === 'edit' && (
                <button type="button" onClick={() => void reloadLatest()} disabled={busy} className="btn-secondary px-4 text-sm">
                  <RefreshCw {...ICON_SM} />
                  โหลดข้อมูลล่าสุด (ค่าที่แก้ไว้จะหาย)
                </button>
              )}
            </div>
          </div>
        )}
        {info && (
          <p className="alert-ok"><CheckCircle2 {...ICON_SM} /><span className="min-w-0">{info}</span></p>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary w-full sm:w-auto px-5">
            <X {...ICON_XS} />
            ยกเลิก
          </button>
        )}
        <button type="submit" disabled={busy} className="btn-primary w-full sm:w-auto px-6">
          {busy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Save {...ICON_SM} />}
          {busy ? 'กำลังบันทึก...' : mode === 'new' ? 'บันทึกลูกค้าใหม่' : 'บันทึกการแก้ไข'}
        </button>
      </div>
    </form>
  )
}
