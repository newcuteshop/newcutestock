'use client'
// ฟอร์มเพิ่ม/แก้ไขลูกค้าร้าน b.oncloud (wed_save_customer) — กลไกเดียวกับฟอร์มลูกค้าร้านเช่า
// - เพิ่มใหม่: client_id สร้างครั้งเดียวต่อฟอร์ม ใช้ซ้ำทุกครั้งที่กดบันทึก → เน็ตหลุดแล้วกดใหม่ ระบบไม่สร้างลูกค้าซ้ำ
//   ไม่รู้ผล → ตรวจในฐานข้อมูลก่อนว่ามีลูกค้ารหัสคำขอนี้แล้วหรือยัง (มีแล้ว = บันทึกสำเร็จ) แล้วจึงให้กดซ้ำ
// - แก้ไข: ส่ง updated_at ไปกันเขียนทับข้อมูลที่เครื่องอื่นเพิ่งแก้ ; ไม่รู้ผล → โหลดลูกค้าใหม่มาเทียบก่อน
// - เบอร์ซ้ำไม่ห้าม (พ่อแม่/ญาติติดต่อแทนได้หลายงาน) แต่เตือนให้เห็นว่ามีในระบบแล้ว
import { useId, useMemo, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, Save, X, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { newUuid } from '@/lib/products'
import { WED_SOURCES, WED_SOURCE_LABELS, parseWedCustomer, phoneDigits, type WedCustomer } from '@/lib/wedding'
import { WRITE_TIMEOUT_MS, rpcWithTimeout, serverAnswered, wedCustomerHref, wedErrorText } from '@/components/wedding/money/wedRpc'
import {
  LIMITS, buildPayload, emptyFields, fieldsFromCustomer, matchesPayload, validateFields,
  type CustomerFieldKey, type CustomerFields,
} from './customerModel'

const UNSURE_MSG = 'ไม่แน่ใจว่าบันทึกแล้วหรือยัง (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — กดบันทึกอีกครั้งได้ ระบบจะไม่สร้างซ้ำ'
const CONFLICT_RE = /ถูกแก้ไขจากเครื่องอื่น/

interface DupHit { id: string; name: string }

export default function CustomerForm({
  mode,
  initial = null,
  onSaved,
  onCancel,
}: {
  mode: 'new' | 'edit'
  initial?: WedCustomer | null
  /** บันทึกสำเร็จ (already_saved = ข้อมูลนี้ถูกบันทึกไว้ก่อนแล้วจากการกดครั้งก่อน) */
  onSaved: (c: WedCustomer, info: { already_saved: boolean }) => void
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

  const errors = validateFields(f)
  const shownErrors = tried ? errors : {}

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
    if (d.length < 9 || d.length > 15 || (mode === 'edit' && initial && phoneDigits(initial.phone) === d)) {
      setDups([])
      return
    }
    try {
      const { data, error: e } = await supabase.from('wed_customers').select('id, name').eq('phone', d).limit(5)
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
  async function fetchLatest(id: string): Promise<WedCustomer | null> {
    const res = await rpcWithTimeout(supabase, 'wed_get_customer', { p_id: id })
    if (res.error) return null
    return parseWedCustomer(res.data)
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
    setBaseUpdatedAt(latest.updated_at ?? '')
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
      const first = (Object.keys(errors) as CustomerFieldKey[])[0]
      document.getElementById(`${uid}-${first}`)?.focus()
      return
    }
    if (mode === 'new' && !clientIdRef.current) clientIdRef.current = newUuid()
    const payload = buildPayload(f, {
      mode,
      clientId: clientIdRef.current,
      id: initial?.id,
      updatedAt: baseUpdatedAt || undefined,
    })
    busyRef.current = true
    setBusy(true)
    setError('')
    setInfo('')
    try {
      const res = await rpcWithTimeout(supabase, 'wed_save_customer', { p_customer: payload }, WRITE_TIMEOUT_MS)
      if (!res.error) {
        const saved = parseWedCustomer(res.data)
        if (!saved) {
          setError('ระบบตอบกลับไม่ครบ — กดบันทึกอีกครั้งเพื่อตรวจสอบ (ระบบจะไม่สร้างซ้ำ)')
          return
        }
        const already = !!(res.data && typeof res.data === 'object' && (res.data as { already_saved?: unknown }).already_saved === true)
        clientIdRef.current = ''
        setBaseUpdatedAt(saved.updated_at ?? '')
        setConflict(false)
        onSaved(saved, { already_saved: already })
        return
      }
      if (!res.timedOut && serverAnswered(res.error)) {
        const msg = wedErrorText(res.error)
        setConflict(CONFLICT_RE.test(msg))
        setError(msg)
        return
      }
      // ===== ไม่รู้ผล (เน็ตหลุด/หมดเวลา) → ตรวจในฐานข้อมูลก่อนให้กดซ้ำ =====
      if (mode === 'new') {
        const cid = clientIdRef.current
        const { data, error: qe } = await supabase.from('wed_customers').select('id').eq('client_id', cid).maybeSingle()
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
          setBaseUpdatedAt(latest.updated_at ?? '')
          onSaved(latest, { already_saved: true })
          return
        }
        if (latest && (latest.updated_at ?? '') !== baseUpdatedAt) {
          // มีคนอื่นแก้หลังจากเราเปิดฟอร์ม (และไม่ใช่ค่าของเรา) → ห้ามเขียนทับเงียบๆ
          setConflict(true)
          setError('ข้อมูลลูกค้านี้ถูกแก้ไขจากเครื่องอื่นระหว่างบันทึก — โหลดข้อมูลล่าสุดก่อน แล้วแก้ไขอีกครั้ง')
          return
        }
        setError(latest ? 'ยังไม่ได้บันทึก (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — กดบันทึกอีกครั้ง' : 'ไม่แน่ใจว่าบันทึกแล้วหรือยัง (เน็ตหลุด) — ตรวจสอบอินเทอร์เน็ตแล้วกดบันทึกอีกครั้ง')
      }
    } catch (err) {
      setError(wedErrorText(err))
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

  // ช่องข้อความบรรทัดเดียว (ใช้ซ้ำหลายช่อง)
  function TextField({ k, label, required, placeholder, max, inputMode, type, autoCapitalize, className }: {
    k: CustomerFieldKey
    label: string
    required?: boolean
    placeholder?: string
    max: number
    inputMode?: 'text' | 'tel' | 'email' | 'url'
    type?: 'text' | 'tel' | 'email'
    autoCapitalize?: 'none' | 'sentences'
    className?: string
  }) {
    return (
      <div className={className}>
        <label htmlFor={fid(k)} className="field-label">
          {label}{required && <span className="text-red-700"> *</span>}
        </label>
        <input
          id={fid(k)}
          className={type === 'tel' ? 'input tabular-nums' : 'input'}
          type={type ?? 'text'}
          inputMode={inputMode}
          value={String(f[k])}
          onChange={e => set(k, e.target.value as CustomerFields[typeof k])}
          maxLength={max}
          autoComplete="off"
          autoCapitalize={autoCapitalize}
          spellCheck={autoCapitalize === 'none' ? false : undefined}
          placeholder={placeholder}
          aria-invalid={!!shownErrors[k]}
          aria-describedby={describe(k)}
          required={required}
        />
        {fieldError(k)}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-busy={busy}>
      {/* ===== ผู้ติดต่อ / คู่บ่าวสาว ===== */}
      <section className="card p-4 sm:p-5 space-y-4" aria-labelledby={`${uid}-who`}>
        <div>
          <h2 id={`${uid}-who`} className="section-title">ผู้ติดต่อและคู่บ่าวสาว</h2>
          <p className="field-hint">ชื่อบนเอกสารการจอง (เช่น คุณมิว &amp; คุณเจ) ตั้งได้ที่ตัวงานแต่ละงาน</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {TextField({ k: 'name', label: 'ชื่อผู้ติดต่อหลัก', required: true, max: LIMITS.name + 20, placeholder: 'เช่น คุณมิว' })}
          {TextField({ k: 'partner_name', label: 'ชื่อคู่ (เจ้าบ่าว/เจ้าสาว)', max: LIMITS.partner_name + 20, placeholder: 'เช่น คุณเจ' })}
        </div>
      </section>

      {/* ===== ช่องทางติดต่อ ===== */}
      <section className="card p-4 sm:p-5 space-y-4" aria-labelledby={`${uid}-contact`}>
        <h2 id={`${uid}-contact`} className="section-title">ช่องทางติดต่อ</h2>
        <div className="grid gap-4 md:grid-cols-2">
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
                        <Link href={wedCustomerHref(d.id)} className="font-medium text-brand-700 underline underline-offset-4 break-words">
                          {d.name || 'ลูกค้า'}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
          {TextField({ k: 'phone2', label: 'เบอร์โทรสำรอง', max: 24, type: 'tel', inputMode: 'tel' })}
          {TextField({ k: 'line_id', label: 'LINE ID', max: LIMITS.line_id + 10, autoCapitalize: 'none' })}
          {TextField({ k: 'instagram', label: 'Instagram', max: LIMITS.instagram + 10, autoCapitalize: 'none', placeholder: 'ชื่อบัญชี หรือลิงก์โปรไฟล์' })}
          {TextField({ k: 'facebook', label: 'Facebook', max: LIMITS.facebook + 10, autoCapitalize: 'none', placeholder: 'ชื่อเพจ/บัญชี หรือลิงก์' })}
          {TextField({ k: 'email', label: 'อีเมล', max: LIMITS.email + 10, type: 'email', inputMode: 'email', autoCapitalize: 'none' })}
          <div className="md:col-span-2">
            <label htmlFor={fid('address')} className="field-label">ที่อยู่ (สำหรับออกเอกสาร)</label>
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

      {/* ===== ช่องทางที่รู้จักร้าน + หมายเหตุ ===== */}
      <section className="card p-4 sm:p-5 space-y-4" aria-labelledby={`${uid}-other`}>
        <h2 id={`${uid}-other`} className="section-title">อื่นๆ</h2>
        <fieldset>
          <legend className="field-label">ลูกค้ารู้จักร้าน / ติดต่อมาทาง</legend>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {WED_SOURCES.map(s => (
              <button
                key={s}
                type="button"
                className="choice"
                aria-pressed={f.source === s}
                onClick={() => set('source', s)}
              >
                {WED_SOURCE_LABELS[s]}
              </button>
            ))}
          </div>
          <p className="field-hint mt-1.5">ใช้ดูในรายงานว่าลูกค้ามาจากช่องทางไหนมากที่สุด</p>
        </fieldset>
        <div>
          <label htmlFor={fid('note')} className="field-label">หมายเหตุ (เห็นเฉพาะทีมงาน)</label>
          <textarea
            id={fid('note')}
            className="input"
            rows={3}
            value={f.note}
            onChange={e => set('note', e.target.value)}
            maxLength={LIMITS.note + 20}
            placeholder="เช่น ชอบโทนภาพแบบไหน ข้อควรระวัง ใครเป็นคนตัดสินใจ"
            aria-invalid={!!shownErrors.note}
            aria-describedby={describe('note')}
          />
          {fieldError('note')}
        </div>
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
