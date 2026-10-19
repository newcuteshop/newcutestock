'use client'
import { useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  AlertTriangle, Ban, Contact, Phone, Search, SearchX, UserCheck, UserPlus, UserRound, X, XCircle,
} from 'lucide-react'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import type { BrowserSupabase } from '@/lib/products'
import { FIX05_MISSING_MSG, formatPhone, maskIdCard, phoneDigits } from '@/lib/rental'
import { CUSTOMER_LITE_COLUMNS, searchCustomers, toCustomerLite } from './search'
import { EMPTY_CUSTOMER_DRAFT, checkCustomerDraft, type CustomerDraft, type CustomerLite, type WizardDraft } from './model'

// ขั้นที่ 3: ลูกค้า — ค้นจากในระบบ (เบอร์โทร/ชื่อ/LINE) หรือกรอกลูกค้าใหม่ (ระบบสร้างลูกค้าให้ตอนบันทึกการจอง)
// ลูกค้าบัญชีดำ: จองได้แต่ต้องติ๊กยืนยัน (ฐานข้อมูลบังคับเหมือนกัน และบันทึกลงประวัติการจอง)
// กรอกลูกค้าใหม่ด้วยเบอร์ที่มีในระบบแล้ว → เสนอให้ใช้ลูกค้าเดิม (ไม่สร้างลูกค้าซ้ำ)

const DEBOUNCE_MS = 300
const RECENT_LIMIT = 8

export default function CustomerStep({
  supabase,
  draft,
  patch,
  needsAck,
  ack,
  onAck,
  dupes,
  blacklistNotice = null,
  lookupFailed = false,
  onRetryLookup,
  showErrors,
  disabled,
}: {
  supabase: BrowserSupabase
  draft: WizardDraft
  patch: (p: Partial<WizardDraft>) => void
  needsAck: boolean
  /** ลูกค้าใหม่: ลูกค้าในระบบที่ใช้เบอร์เดียวกัน (ฟอร์มหลักเป็นคนค้น — ใช้ตัดสินว่าต้องยืนยันบัญชีดำไหมแม้ไม่ได้เปิดขั้นนี้ค้างไว้) */
  dupes: readonly CustomerLite[]
  /** ฐานข้อมูลบอกว่าเบอร์นี้ตรงกับลูกค้าบัญชีดำ (หน้าจอค้นไม่เจอ/ตรวจไม่ได้) — แสดงพร้อมช่องติ๊กยืนยัน */
  blacklistNotice?: string | null
  /** ค้นลูกค้าเบอร์เดียวกันไม่สำเร็จ (ไม่รู้ว่าซ้ำ/บัญชีดำไหม) */
  lookupFailed?: boolean
  onRetryLookup?: () => void
  ack: boolean
  onAck: (v: boolean) => void
  showErrors: boolean        // กดไปต่อแล้วแต่ยังกรอกไม่ครบ → แสดงข้อผิดพลาดทุกช่อง
  disabled?: boolean
}) {
  const ids = {
    search: useId(), name: useId(), phone: useId(), line: useId(), email: useId(),
    idc: useId(), address: useId(), note: useId(), ack: useId(),
  }
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerLite[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [touched, setTouched] = useState<Partial<Record<keyof CustomerDraft, boolean>>>({})
  const reqRef = useRef(0)

  const selected = draft.customerMode === 'existing' ? draft.customer : null
  const nc = draft.newCustomer
  const check = checkCustomerDraft(nc)

  // ค้นลูกค้า (คำค้นว่าง = ลูกค้าที่แก้ไขล่าสุด)
  useEffect(() => {
    if (draft.customerMode !== 'existing' || selected) return
    const reqId = ++reqRef.current
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const t = setTimeout(async () => {
      setSearching(true)
      setSearchError('')
      try {
        let list: CustomerLite[]
        if (query.trim() === '') {
          let q = supabase
            .from('rental_customers')
            .select(CUSTOMER_LITE_COLUMNS)
            .order('updated_at', { ascending: false })
            .limit(RECENT_LIMIT)
          if (ctrl) q = q.abortSignal(ctrl.signal)
          const { data, error } = await q
          if (error) throw error
          list = []
          for (const r of (data ?? []) as unknown[]) {
            const c = toCustomerLite(r)
            if (c) list.push(c)
          }
        } else {
          list = await searchCustomers(supabase, query, 20, ctrl?.signal)
        }
        if (reqId !== reqRef.current) return
        setResults(list)
      } catch (err) {
        if (reqId !== reqRef.current) return
        if (ctrl?.signal.aborted) return
        setResults([])
        setSearchError(isMigrationMissing(err) ? FIX05_MISSING_MSG : thaiError(err))
      } finally {
        if (reqId === reqRef.current) setSearching(false)
      }
    }, query.trim() === '' ? 0 : DEBOUNCE_MS)
    return () => {
      clearTimeout(t)
      ctrl?.abort()
    }
  }, [supabase, query, draft.customerMode, selected])

  const blackDupe = draft.customerMode === 'new' ? dupes.find(c => c.is_blacklisted) ?? null : null

  function choose(c: CustomerLite) {
    patch({ customerMode: 'existing', customer: c })
    onAck(false)
  }

  function setField(k: keyof CustomerDraft, v: string) {
    patch({ newCustomer: { ...nc, [k]: v } })
  }

  function fieldError(k: keyof CustomerDraft): string | undefined {
    return showErrors || touched[k] ? check.errors[k] : undefined
  }

  function blur(k: keyof CustomerDraft) {
    setTouched(t => ({ ...t, [k]: true }))
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="เลือกลูกค้า">
        <button
          type="button"
          className="choice flex-row gap-2"
          aria-pressed={draft.customerMode === 'existing'}
          disabled={disabled}
          onClick={() => patch({ customerMode: 'existing' })}
        >
          <UserCheck {...ICON_SM} />
          ลูกค้าในระบบ
        </button>
        <button
          type="button"
          className="choice flex-row gap-2"
          aria-pressed={draft.customerMode === 'new'}
          disabled={disabled}
          onClick={() => patch({ customerMode: 'new' })}
        >
          <UserPlus {...ICON_SM} />
          ลูกค้าใหม่
        </button>
      </div>

      {draft.customerMode === 'existing' ? (
        selected ? (
          <section className="card p-4 sm:p-5 space-y-3" aria-label="ลูกค้าที่เลือก">
            <div className="flex items-start gap-3">
              <span className="icon-bubble shrink-0"><UserRound {...ICON} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-gray-900 break-words">{selected.name}</p>
                <p className="text-sm text-gray-600 tabular-nums">
                  {selected.phone ? formatPhone(selected.phone) : 'ไม่มีเบอร์โทร'}
                  {selected.phone2 && <span className="text-gray-400"> · {formatPhone(selected.phone2)}</span>}
                </p>
                {(selected.line_id || selected.id_card_no) && (
                  <p className="text-xs text-gray-500 break-words">
                    {selected.line_id && <>LINE {selected.line_id}</>}
                    {selected.line_id && selected.id_card_no && ' · '}
                    {selected.id_card_no && <>บัตร <span className="font-mono">{maskIdCard(selected.id_card_no)}</span></>}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => { patch({ customer: null }); onAck(false) }}
                disabled={disabled}
                className="btn-secondary shrink-0 px-3 text-sm"
              >
                เปลี่ยน
              </button>
            </div>

            {selected.is_blacklisted && (
              <div role="alert" className="alert-err">
                <Ban {...ICON_SM} />
                <div className="min-w-0 space-y-2">
                  <p className="font-semibold">ลูกค้ารายนี้อยู่ในบัญชีดำ</p>
                  {selected.blacklist_reason && <p className="break-words">เหตุผล: {selected.blacklist_reason}</p>}
                  {needsAck && (
                    <label htmlFor={ids.ack} className="flex min-h-[44px] cursor-pointer items-start gap-3 select-none">
                      <input
                        id={ids.ack}
                        type="checkbox"
                        checked={ack}
                        disabled={disabled}
                        onChange={e => onAck(e.target.checked)}
                        className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
                      />
                      <span className="min-w-0 text-sm font-medium text-gray-900">
                        ยืนยันจองให้ลูกค้ารายนี้ (ระบบบันทึกไว้ในประวัติการจอง)
                      </span>
                    </label>
                  )}
                  {showErrors && needsAck && !ack && (
                    <p className="text-sm font-medium">ต้องติ๊กยืนยันก่อนจึงจะไปต่อได้</p>
                  )}
                </div>
              </div>
            )}
          </section>
        ) : (
          <section className="card overflow-hidden" aria-label="ค้นหาลูกค้า" aria-busy={searching}>
            <div className="space-y-2 border-b border-gray-150 p-3 sm:p-4">
              <label htmlFor={ids.search} className="field-label">ค้นหาลูกค้า</label>
              <div className="input-icon">
                <Search {...ICON_SM} />
                <input
                  id={ids.search}
                  type="search"
                  className="input pl-11"
                  placeholder="เบอร์โทร ชื่อ หรือ LINE ID"
                  value={query}
                  maxLength={60}
                  autoComplete="off"
                  enterKeyHint="search"
                  disabled={disabled}
                  onChange={e => setQuery(e.target.value)}
                />
              </div>
              {showErrors && (
                <p role="alert" className="text-sm font-medium text-red-700">กรุณาเลือกลูกค้า หรือกด &quot;ลูกค้าใหม่&quot; เพื่อกรอกข้อมูล</p>
              )}
            </div>
            {searchError ? (
              <div className="p-4">
                <div role="alert" className="alert-err">
                  <XCircle {...ICON_SM} />
                  <p className="min-w-0 break-words">{searchError}</p>
                </div>
              </div>
            ) : searching && results.length === 0 ? (
              <div className="p-4 space-y-2" role="status">
                <span className="sr-only">กำลังค้นหาลูกค้า...</span>
                {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-14 rounded-lg" />)}
              </div>
            ) : results.length === 0 ? (
              <div className="empty-state">
                <span className="icon-bubble icon-bubble-lg"><SearchX size={28} strokeWidth={1.75} aria-hidden="true" /></span>
                <p className="empty-state-title">{query.trim() ? 'ไม่พบลูกค้าที่ตรงกับคำค้น' : 'ยังไม่มีลูกค้าในระบบ'}</p>
                <button type="button" className="btn-primary px-4" onClick={() => {
                  // พิมพ์เบอร์ค้นไว้ → เอาไปใส่ช่องเบอร์ของลูกค้าใหม่ให้เลย
                  const digits = phoneDigits(query)
                  const patchNew = /^[0-9๐-๙ ()+.-]+$/.test(query.trim()) && digits.length >= 9
                    ? { ...nc, phone: digits }
                    : query.trim() && !/\d/.test(query) ? { ...nc, name: query.trim().slice(0, 100) } : nc
                  patch({ customerMode: 'new', newCustomer: patchNew })
                }}>
                  <UserPlus {...ICON_SM} />
                  เพิ่มเป็นลูกค้าใหม่
                </button>
              </div>
            ) : (
              <>
                {query.trim() === '' && <p className="px-4 pt-3 text-xs font-medium text-gray-500">ลูกค้าล่าสุด</p>}
                <ul className={clsx('divide-y divide-gray-150', searching && 'opacity-60')}>
                  {results.map(c => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => choose(c)}
                        disabled={disabled}
                        className="flex w-full min-h-[56px] items-center gap-3 px-4 py-2.5 text-left active:bg-gray-50 [@media(hover:hover)]:hover:bg-gray-50"
                      >
                        <span className="icon-bubble icon-bubble-sm shrink-0"><Contact {...ICON_XS} /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-gray-900 break-words">{c.name}</span>
                          <span className="block text-xs text-gray-500 tabular-nums">
                            {c.phone ? formatPhone(c.phone) : 'ไม่มีเบอร์โทร'}
                            {c.line_id && <> · LINE {c.line_id}</>}
                          </span>
                        </span>
                        {c.is_blacklisted && <span className="badge-out shrink-0">บัญชีดำ</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )
      ) : (
        <section className="card p-4 sm:p-5 space-y-4" aria-label="ข้อมูลลูกค้าใหม่">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id={ids.name} label="ชื่อ-นามสกุล *" error={fieldError('name')}>
              <input
                id={ids.name}
                className="input"
                value={nc.name}
                maxLength={100}
                autoComplete="off"
                disabled={disabled}
                aria-invalid={fieldError('name') ? true : undefined}
                aria-describedby={fieldError('name') ? `${ids.name}-err` : undefined}
                onChange={e => setField('name', e.target.value)}
                onBlur={() => blur('name')}
              />
            </Field>
            <Field id={ids.phone} label="เบอร์โทร *" error={fieldError('phone')}>
              <div className="input-icon">
                <Phone {...ICON_SM} />
                <input
                  id={ids.phone}
                  type="tel"
                  inputMode="tel"
                  className="input pl-11 tabular-nums"
                  value={nc.phone}
                  maxLength={20}
                  autoComplete="off"
                  placeholder="0812345678"
                  disabled={disabled}
                  aria-invalid={fieldError('phone') ? true : undefined}
                  aria-describedby={fieldError('phone') ? `${ids.phone}-err` : undefined}
                  onChange={e => setField('phone', e.target.value)}
                  onBlur={() => blur('phone')}
                />
              </div>
            </Field>
          </div>

          {lookupFailed && (
            <div className="alert-warn" role="status">
              <AlertTriangle {...ICON_SM} />
              <div className="min-w-0 space-y-2">
                <p>ตรวจเบอร์ซ้ำกับลูกค้าในระบบไม่สำเร็จ (เน็ตหลุด?) — ยังไม่รู้ว่าเบอร์นี้มีในระบบหรืออยู่ในบัญชีดำหรือไม่</p>
                {onRetryLookup && (
                  <button type="button" className="btn-secondary px-3 text-sm" onClick={onRetryLookup} disabled={disabled}>
                    ตรวจเบอร์อีกครั้ง
                  </button>
                )}
              </div>
            </div>
          )}

          {blacklistNotice && !blackDupe && (
            <div className="alert-err" role="alert">
              <Ban {...ICON_SM} />
              <div className="min-w-0 space-y-2">
                <p className="break-words font-semibold">{blacklistNotice}</p>
                {needsAck && (
                  <label htmlFor={ids.ack} className="flex min-h-[44px] cursor-pointer items-start gap-3 select-none">
                    <input
                      id={ids.ack}
                      type="checkbox"
                      checked={ack}
                      disabled={disabled}
                      onChange={e => onAck(e.target.checked)}
                      className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
                    />
                    <span className="min-w-0 text-sm font-medium text-gray-900">
                      ยืนยันจองให้ลูกค้าเบอร์นี้ (ระบบบันทึกไว้ในประวัติการจอง)
                    </span>
                  </label>
                )}
                {showErrors && needsAck && !ack && (
                  <p className="text-sm font-medium">ต้องติ๊กยืนยันก่อนจึงจะไปต่อได้</p>
                )}
              </div>
            </div>
          )}

          {dupes.length > 0 && (
            <div className={blackDupe ? 'alert-err' : 'alert-info'} role={blackDupe ? 'alert' : 'status'}>
              {blackDupe ? <Ban {...ICON_SM} /> : <UserCheck {...ICON_SM} />}
              <div className="min-w-0 space-y-2">
                <p>มีลูกค้าเบอร์นี้ในระบบแล้ว — ใช้ข้อมูลเดิมแทนการสร้างลูกค้าใหม่ได้</p>
                {blackDupe && (
                  <p className="font-semibold">
                    เบอร์นี้เป็นของลูกค้าในบัญชีดำ{blackDupe.blacklist_reason ? ` (เหตุผล: ${blackDupe.blacklist_reason})` : ''} —
                    กรอกเป็นลูกค้าใหม่ก็ยังต้องยืนยันเหมือนกัน
                  </p>
                )}
                <ul className="space-y-1.5">
                  {dupes.map(c => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 font-medium text-gray-900 break-words">{c.name}</span>
                      {c.is_blacklisted && <span className="badge-out">บัญชีดำ</span>}
                      <button type="button" className="btn-secondary min-h-[40px] px-3 text-sm" onClick={() => choose(c)} disabled={disabled}>
                        ใช้ลูกค้าคนนี้
                      </button>
                    </li>
                  ))}
                </ul>
                {blackDupe && needsAck && (
                  <label htmlFor={ids.ack} className="flex min-h-[44px] cursor-pointer items-start gap-3 select-none">
                    <input
                      id={ids.ack}
                      type="checkbox"
                      checked={ack}
                      disabled={disabled}
                      onChange={e => onAck(e.target.checked)}
                      className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
                    />
                    <span className="min-w-0 text-sm font-medium text-gray-900">
                      ยืนยันจองให้ลูกค้าเบอร์นี้ (ระบบบันทึกไว้ในประวัติการจอง)
                    </span>
                  </label>
                )}
                {blackDupe && showErrors && needsAck && !ack && (
                  <p className="text-sm font-medium">ต้องติ๊กยืนยัน หรือกด &quot;ใช้ลูกค้าคนนี้&quot; ก่อนจึงจะไปต่อได้</p>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id={ids.line} label="LINE ID" error={fieldError('line_id')}>
              <input
                id={ids.line}
                className="input"
                value={nc.line_id}
                maxLength={50}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={disabled}
                onChange={e => setField('line_id', e.target.value)}
                onBlur={() => blur('line_id')}
              />
            </Field>
            <Field id={ids.email} label="อีเมล" error={fieldError('email')}>
              <input
                id={ids.email}
                type="email"
                inputMode="email"
                className="input"
                value={nc.email}
                maxLength={100}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={disabled}
                aria-invalid={fieldError('email') ? true : undefined}
                onChange={e => setField('email', e.target.value)}
                onBlur={() => blur('email')}
              />
            </Field>
            <Field
              id={ids.idc}
              label="เลขบัตรประชาชน / พาสปอร์ต"
              error={fieldError('id_card_no')}
              hint="ใช้ในสัญญาเช่า (ฉบับร้านแสดงเต็ม ฉบับลูกค้าปิดเลขไว้)"
            >
              <input
                id={ids.idc}
                className="input font-mono"
                value={nc.id_card_no}
                maxLength={40}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                disabled={disabled}
                aria-invalid={fieldError('id_card_no') ? true : undefined}
                onChange={e => setField('id_card_no', e.target.value)}
                onBlur={() => blur('id_card_no')}
              />
            </Field>
            <Field id={ids.address} label="ที่อยู่" error={fieldError('address')}>
              <textarea
                id={ids.address}
                className="input"
                rows={2}
                value={nc.address}
                maxLength={500}
                disabled={disabled}
                onChange={e => setField('address', e.target.value)}
                onBlur={() => blur('address')}
              />
            </Field>
          </div>
          <Field id={ids.note} label="หมายเหตุลูกค้า" error={fieldError('note')}>
            <textarea
              id={ids.note}
              className="input"
              rows={2}
              value={nc.note}
              maxLength={1000}
              placeholder="เช่น สัดส่วน ความชอบ ข้อควรระวัง"
              disabled={disabled}
              onChange={e => setField('note', e.target.value)}
              onBlur={() => blur('note')}
            />
          </Field>
          {(nc.name || nc.phone) && (
            <button
              type="button"
              className="btn-ghost -ml-2 px-2 text-sm"
              disabled={disabled}
              onClick={() => { patch({ newCustomer: { ...EMPTY_CUSTOMER_DRAFT } }); setTouched({}) }}
            >
              <X {...ICON_SM} />
              ล้างข้อมูลลูกค้าใหม่
            </button>
          )}
        </section>
      )}
    </div>
  )
}

function Field({
  id, label, error, hint, children,
}: {
  id: string
  label: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="field-label">{label}</label>
      {children}
      {error ? (
        <p id={`${id}-err`} role="alert" className="mt-1 text-sm font-medium text-red-700">{error}</p>
      ) : hint ? (
        <p className="field-hint">{hint}</p>
      ) : null}
    </div>
  )
}
