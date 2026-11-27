'use client'
// ส่วน "ลูกค้า / คู่บ่าวสาว" ของฟอร์มงาน — ค้นลูกค้าในระบบ (เบอร์/ชื่อ/ชื่อคู่/LINE/IG) หรือกรอกลูกค้าใหม่
// (ระบบสร้างลูกค้าให้ตอนบันทึกงาน) + ชื่อคู่บ่าวสาวที่แสดงบนเอกสาร + ช่องทางที่ลูกค้าติดต่อมา
// ลูกค้าใหม่ที่เบอร์ซ้ำกับลูกค้าเดิม → เสนอให้ใช้ลูกค้าเดิม (ไม่สร้างลูกค้าซ้ำ — ประวัติงานของลูกค้าจะรวมอยู่ที่เดียว)
// ลูกค้าใหม่ (27/11/2569 กรอกเร็ว): หน้าแรกเหลือ ชื่อผู้ติดต่อ เบอร์
//   ชื่อคู่ เบอร์สำรอง LINE Facebook IG อีเมล ที่อยู่ หมายเหตุ → กล่อง "ข้อมูลเพิ่มเติม (ไม่บังคับ)" (ข้อมูล/ตัวตรวจเหมือนเดิม)
// ชื่อช่องทาง (27/11/2569 "ถ้าเลือกช่องทางไหน ต้องมีให้ใส่ชื่อช่องทางนั้นด้วย"): ช่องเดียวใต้ปุ่ม "ลูกค้าติดต่อมาทาง"
//   ป้ายเปลี่ยนตามช่องทาง (ชื่อ Facebook / ชื่อ Instagram / LINE ID / ...) → ขึ้นในใบยืนยันการจอง "FB: ชื่อ"
//   ไม่บังคับ ; เติมให้เองจากข้อมูลลูกค้า + กติกาเปลี่ยนช่องทาง = syncSourceDetail (model.ts, ฟอร์มหลักเรียกทุกครั้งที่ patch)
//   ลูกค้าใหม่ + Facebook/IG/LINE: ชื่อที่พิมพ์เติมให้ลูกค้าเองตอนบันทึก (ช่อง LINE/Facebook ของลูกค้าจึงย้ายเข้ากล่องพับ)
import { useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'
import { Contact, Heart, Phone, Search, SearchX, UserCheck, UserPlus, UserRound, X, XCircle } from 'lucide-react'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import type { BrowserSupabase } from '@/lib/products'
import {
  FIX07_MISSING_MSG, MAX_SOURCE_DETAIL, WED_SOURCES, WED_SOURCE_DETAIL_LABELS, WED_SOURCE_LABELS, formatPhone, phoneDigits,
  type WedSource,
} from '@/lib/wedding'
import { recentCustomers, searchCustomers } from './search'
import {
  EMPTY_CUSTOMER_DRAFT, MAX_COUPLE, MAX_CUST_ADDRESS, MAX_CUST_EMAIL, MAX_CUST_FB, MAX_CUST_IG, MAX_CUST_LINE, MAX_CUST_NAME,
  MAX_CUST_NOTE, CUSTOMER_EXTRA_FIELDS, coupleSuggestion, customerExtraFilled, type CustomerCheck, type CustomerDraft,
  type CustomerLite, type WedDraft,
} from './model'
import { Field, FormSection, MoreFields, fieldAria } from './fields'

const DEBOUNCE_MS = 300
const RECENT_LIMIT = 8

// ตัวอย่างในช่องชื่อช่องทาง (ตามช่องทางที่เลือก)
const SOURCE_DETAIL_PLACEHOLDERS: Readonly<Record<WedSource, string>> = {
  instagram: 'เช่น @username',
  facebook: 'เช่น Phodjanee Dicharoen',
  tiktok: 'เช่น @username',
  line: 'เช่น mewjay',
  referral: 'เช่น คุณแพร (ลูกค้าเก่า)',
  walkin: 'เช่น มาดูชุดที่ร้าน',
  website: 'เช่น https://...',
  other: 'เช่น งานแต่งแฟร์ / ป้ายหน้าร้าน',
}
// ชื่อบัญชี/ลิงก์ — ไม่ให้แป้นพิมพ์มือถือขึ้นตัวใหญ่/แก้คำให้เอง
const HANDLE_SOURCES: readonly WedSource[] = ['instagram', 'tiktok', 'line', 'website']

export default function CustomerSection({
  supabase,
  draft,
  patch,
  check,
  coupleError,
  sourceDetailError,
  dupes,
  dupLookupFailed,
  showErrors,
  reveal = 0,
  disabled,
}: {
  supabase: BrowserSupabase
  draft: WedDraft
  patch: (p: Partial<WedDraft>) => void
  check: CustomerCheck
  coupleError?: string | null
  /** ชื่อช่องทางยาวเกิน (ไม่บังคับกรอก) */
  sourceDetailError?: string | null
  /** ลูกค้าใหม่: ลูกค้าในระบบที่ใช้เบอร์เดียวกัน (ฟอร์มหลักเป็นคนค้น) */
  dupes: readonly CustomerLite[]
  dupLookupFailed: boolean
  showErrors: boolean
  /** เลขที่เปลี่ยนเมื่อกดแถบลัด/กดบันทึกแล้วยังไม่ครบ → เปิดกล่องพับที่มีช่องผิด */
  reveal?: number
  disabled?: boolean
}) {
  const uid = useId()
  const ids = {
    search: `${uid}-search`, name: `${uid}-name`, partner: `${uid}-partner`, phone: `${uid}-phone`, phone2: `${uid}-phone2`,
    line: `${uid}-line`, ig: `${uid}-ig`, fb: `${uid}-fb`, email: `${uid}-email`, address: `${uid}-address`,
    note: `${uid}-note`, couple: `${uid}-couple`, srcDetail: `${uid}-src-detail`,
  }
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerLite[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [touched, setTouched] = useState<Partial<Record<keyof CustomerDraft, boolean>>>({})
  const reqRef = useRef(0)

  const selected = draft.customerMode === 'existing' ? draft.customer : null
  const nc = draft.newCustomer
  // กล่องพับของลูกค้าใหม่: จำนวนช่องที่มีค่า + มีช่องผิดข้างในไหม
  const extraFilled = customerExtraFilled(nc)
  const extraProblem = CUSTOMER_EXTRA_FIELDS.some(k => !!check.errors[k])

  // ค้นลูกค้า (คำค้นว่าง = ลูกค้าที่แก้ไขล่าสุด)
  useEffect(() => {
    if (draft.customerMode !== 'existing' || selected) return
    const reqId = ++reqRef.current
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const t = setTimeout(async () => {
      setSearching(true)
      setSearchError('')
      try {
        const list = query.trim() === ''
          ? await recentCustomers(supabase, RECENT_LIMIT, ctrl?.signal)
          : await searchCustomers(supabase, query, 20, ctrl?.signal)
        if (reqId !== reqRef.current) return
        setResults(list)
      } catch (err) {
        if (reqId !== reqRef.current) return
        if (ctrl?.signal.aborted) return
        setResults([])
        setSearchError(isMigrationMissing(err) ? FIX07_MISSING_MSG : thaiError(err))
      } finally {
        if (reqId === reqRef.current) setSearching(false)
      }
    }, query.trim() === '' ? 0 : DEBOUNCE_MS)
    return () => {
      clearTimeout(t)
      ctrl?.abort()
    }
  }, [supabase, query, draft.customerMode, selected])

  // ชื่อคู่บ่าวสาวที่เสนอ (จากลูกค้าที่เลือก/ลูกค้าใหม่)
  const suggestion = selected
    ? coupleSuggestion(selected.name, selected.partner_name)
    : draft.customerMode === 'new' ? coupleSuggestion(nc.name, nc.partner_name) : ''
  const showSuggestion = suggestion !== '' && suggestion !== draft.coupleNames.trim()

  function choose(c: CustomerLite) {
    const p: Partial<WedDraft> = { customerMode: 'existing', customer: c }
    // ชื่อคู่บ่าวสาวยังว่าง → เติมให้จากลูกค้า (แก้ได้)
    if (!draft.coupleNames.trim()) p.coupleNames = coupleSuggestion(c.name, c.partner_name)
    // ช่องทางของลูกค้าเดิม → ใช้เป็นช่องทางของงานนี้ (เปลี่ยนได้)
    //   ยกเว้นพิมพ์ชื่อช่องทางไว้ก่อนเลือกลูกค้า → ฟอร์มคงช่องทางที่เลือกไว้ (syncSourceDetail ใน model.ts)
    if (c.source) p.source = c.source
    patch(p)
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

  function startNew() {
    // พิมพ์เบอร์ค้นไว้ → ใส่ช่องเบอร์ให้ ; พิมพ์ชื่อไว้ → ใส่ช่องชื่อให้
    const q = query.trim()
    const digits = phoneDigits(q)
    const next = /^[0-9๐-๙ ()+.-]+$/.test(q) && digits.length >= 9
      ? { ...nc, phone: digits }
      : q && !/\d/.test(q) ? { ...nc, name: q.slice(0, MAX_CUST_NAME) } : nc
    patch({ customerMode: 'new', newCustomer: next })
  }

  return (
    <FormSection
      section="customer"
      title="ลูกค้า / คู่บ่าวสาว"
      icon={<Heart {...ICON} />}
    >
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
          <div className="panel flex items-start gap-3 p-3" aria-label="ลูกค้าที่เลือก">
            <span className="icon-bubble shrink-0"><UserRound {...ICON} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-gray-900 break-words">
                {selected.name}
                {selected.partner_name && <span className="font-normal text-gray-600"> &amp; {selected.partner_name}</span>}
              </p>
              <p className="text-sm text-gray-600 tabular-nums">
                {selected.phone ? formatPhone(selected.phone) : 'ไม่มีเบอร์โทร'}
                {selected.phone2 && <span className="text-gray-500"> · {formatPhone(selected.phone2)}</span>}
              </p>
              {(selected.line_id || selected.instagram) && (
                <p className="text-xs text-gray-500 break-words">
                  {selected.line_id && <>LINE {selected.line_id}</>}
                  {selected.line_id && selected.instagram && ' · '}
                  {selected.instagram && <>IG {selected.instagram}</>}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => patch({ customer: null })}
              disabled={disabled}
              className="btn-secondary shrink-0 px-3 text-sm"
            >
              เปลี่ยน
            </button>
          </div>
        ) : (
          <div className="panel overflow-hidden" aria-busy={searching}>
            <div className="space-y-2 border-b border-gray-200 p-3">
              <label htmlFor={ids.search} className="field-label">ค้นหาลูกค้า</label>
              <div className="input-icon">
                <Search {...ICON_SM} />
                <input
                  id={ids.search}
                  type="search"
                  className="input pl-11"
                  placeholder="เบอร์โทร ชื่อ ชื่อคู่ LINE หรือ IG"
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
              <div className="p-3">
                <div role="alert" className="alert-err">
                  <XCircle {...ICON_SM} />
                  <p className="min-w-0 break-words">{searchError}</p>
                </div>
              </div>
            ) : searching && results.length === 0 ? (
              <div className="p-3 space-y-2" role="status">
                <span className="sr-only">กำลังค้นหาลูกค้า...</span>
                {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-14 rounded-lg" />)}
              </div>
            ) : results.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
                <SearchX size={28} strokeWidth={1.75} aria-hidden="true" className="text-gray-400" />
                <p className="text-sm font-medium text-gray-700">{query.trim() ? 'ไม่พบลูกค้าที่ตรงกับคำค้น' : 'ยังไม่มีลูกค้าในระบบ'}</p>
                <button type="button" className="btn-primary px-4" onClick={startNew} disabled={disabled}>
                  <UserPlus {...ICON_SM} />
                  เพิ่มเป็นลูกค้าใหม่
                </button>
              </div>
            ) : (
              <>
                {query.trim() === '' && <p className="px-3 pt-3 text-xs font-medium text-gray-500">ลูกค้าล่าสุด</p>}
                <ul className={clsx('divide-y divide-gray-200', searching && 'opacity-60')}>
                  {results.map(c => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => choose(c)}
                        disabled={disabled}
                        className="flex w-full min-h-[56px] items-center gap-3 px-3 py-2.5 text-left active:bg-gray-100 [@media(hover:hover)]:hover:bg-gray-100"
                      >
                        <span className="icon-bubble icon-bubble-sm shrink-0"><Contact {...ICON_XS} /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-gray-900 break-words">
                            {c.name}
                            {c.partner_name && <span className="font-normal text-gray-600"> &amp; {c.partner_name}</span>}
                          </span>
                          <span className="block text-xs text-gray-500 tabular-nums break-words">
                            {c.phone ? formatPhone(c.phone) : 'ไม่มีเบอร์โทร'}
                            {c.line_id && <> · LINE {c.line_id}</>}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )
      ) : (
        <div className="space-y-4" aria-label="ข้อมูลลูกค้าใหม่">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id={ids.name} label="ชื่อผู้ติดต่อหลัก *" error={fieldError('name')}>
              <input
                id={ids.name}
                className="input"
                value={nc.name}
                maxLength={MAX_CUST_NAME}
                autoComplete="off"
                placeholder="เช่น มิว ศิริพร"
                disabled={disabled}
                {...fieldAria(ids.name, fieldError('name'))}
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
                  {...fieldAria(ids.phone, fieldError('phone'))}
                  onChange={e => setField('phone', e.target.value)}
                  onBlur={() => blur('phone')}
                />
              </div>
            </Field>
          </div>

          {dupLookupFailed && (
            <p className="text-xs text-gray-500" role="status">ตรวจเบอร์ซ้ำกับลูกค้าในระบบไม่สำเร็จ (เน็ตหลุด?) — บันทึกได้ตามปกติ</p>
          )}
          {dupes.length > 0 && (
            <div className="alert-info" role="status">
              <UserCheck {...ICON_SM} />
              <div className="min-w-0 space-y-2">
                <p>มีลูกค้าเบอร์นี้ในระบบแล้ว — ใช้ข้อมูลเดิมแทนการสร้างลูกค้าใหม่ได้ (ประวัติงานจะรวมอยู่ที่เดียวกัน)</p>
                <ul className="space-y-1.5">
                  {dupes.map(c => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 font-medium text-gray-900 break-words">
                        {c.name}{c.partner_name ? ` & ${c.partner_name}` : ''}
                      </span>
                      <button type="button" className="btn-secondary min-h-[40px] px-3 text-sm" onClick={() => choose(c)} disabled={disabled}>
                        ใช้ลูกค้าคนนี้
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <MoreFields
            contents="ชื่อคู่ เบอร์สำรอง LINE Facebook Instagram อีเมล ที่อยู่ หมายเหตุลูกค้า"
            filled={extraFilled}
            initialOpen={extraFilled > 0}
            problem={extraProblem}
            signal={reveal}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id={ids.partner} label="ชื่อคู่ (เจ้าบ่าว/เจ้าสาว)" error={fieldError('partner_name')}>
                <input
                  id={ids.partner}
                  className="input"
                  value={nc.partner_name}
                  maxLength={MAX_CUST_NAME}
                  autoComplete="off"
                  placeholder="เช่น เจ ธนพล"
                  disabled={disabled}
                  {...fieldAria(ids.partner, fieldError('partner_name'))}
                  onChange={e => setField('partner_name', e.target.value)}
                  onBlur={() => blur('partner_name')}
                />
              </Field>
              <Field id={ids.phone2} label="เบอร์โทรสำรอง" error={fieldError('phone2')}>
                <input
                  id={ids.phone2}
                  type="tel"
                  inputMode="tel"
                  className="input tabular-nums"
                  value={nc.phone2}
                  maxLength={20}
                  autoComplete="off"
                  disabled={disabled}
                  {...fieldAria(ids.phone2, fieldError('phone2'))}
                  onChange={e => setField('phone2', e.target.value)}
                  onBlur={() => blur('phone2')}
                />
              </Field>
              <Field id={ids.line} label="LINE ID" error={fieldError('line_id')}>
                <input
                  id={ids.line}
                  className="input"
                  value={nc.line_id}
                  maxLength={MAX_CUST_LINE}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={disabled}
                  {...fieldAria(ids.line, fieldError('line_id'))}
                  onChange={e => setField('line_id', e.target.value)}
                  onBlur={() => blur('line_id')}
                />
              </Field>
              <Field id={ids.fb} label="Facebook" error={fieldError('facebook')}>
                <input
                  id={ids.fb}
                  className="input"
                  value={nc.facebook}
                  maxLength={MAX_CUST_FB}
                  autoComplete="off"
                  placeholder="ชื่อหรือลิงก์ Facebook"
                  disabled={disabled}
                  {...fieldAria(ids.fb, fieldError('facebook'))}
                  onChange={e => setField('facebook', e.target.value)}
                  onBlur={() => blur('facebook')}
                />
              </Field>
              <Field id={ids.ig} label="Instagram" error={fieldError('instagram')}>
                <input
                  id={ids.ig}
                  className="input"
                  value={nc.instagram}
                  maxLength={MAX_CUST_IG}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={disabled}
                  {...fieldAria(ids.ig, fieldError('instagram'))}
                  onChange={e => setField('instagram', e.target.value)}
                  onBlur={() => blur('instagram')}
                />
              </Field>
              <Field id={ids.email} label="อีเมล" error={fieldError('email')}>
                <input
                  id={ids.email}
                  type="email"
                  inputMode="email"
                  className="input"
                  value={nc.email}
                  maxLength={MAX_CUST_EMAIL}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={disabled}
                  {...fieldAria(ids.email, fieldError('email'))}
                  onChange={e => setField('email', e.target.value)}
                  onBlur={() => blur('email')}
                />
              </Field>
              <Field id={ids.address} label="ที่อยู่" error={fieldError('address')} className="sm:col-span-2">
                <textarea
                  id={ids.address}
                  className="input"
                  rows={2}
                  value={nc.address}
                  maxLength={MAX_CUST_ADDRESS}
                  disabled={disabled}
                  {...fieldAria(ids.address, fieldError('address'))}
                  onChange={e => setField('address', e.target.value)}
                  onBlur={() => blur('address')}
                />
              </Field>
              <Field id={ids.note} label="หมายเหตุลูกค้า" error={fieldError('note')} className="sm:col-span-2">
                <textarea
                  id={ids.note}
                  className="input"
                  rows={2}
                  value={nc.note}
                  maxLength={MAX_CUST_NOTE}
                  placeholder="เช่น ติดต่อสะดวกช่วงเย็น / ลูกค้าแนะนำจากคุณ..."
                  disabled={disabled}
                  {...fieldAria(ids.note, fieldError('note'))}
                  onChange={e => setField('note', e.target.value)}
                  onBlur={() => blur('note')}
                />
              </Field>
            </div>
          </MoreFields>
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
        </div>
      )}

      <hr className="divider !my-0" />

      {/* ===== ชื่อคู่บ่าวสาว (แสดงบนเอกสารทุกใบ) ===== */}
      <Field
        id={ids.couple}
        label="ชื่อคู่บ่าวสาว *"
        error={showErrors || draft.coupleNames !== '' ? coupleError : null}
        hint="แสดงบนใบยืนยันการจอง ใบเสร็จ และหน้าติดตามงานของลูกค้า"
      >
        <input
          id={ids.couple}
          className="input text-base font-semibold"
          value={draft.coupleNames}
          maxLength={MAX_COUPLE}
          autoComplete="off"
          placeholder="เช่น คุณมิว & คุณเจ"
          disabled={disabled}
          {...fieldAria(ids.couple, showErrors || draft.coupleNames !== '' ? coupleError : null, true)}
          onChange={e => patch({ coupleNames: e.target.value })}
        />
      </Field>
      {showSuggestion && (
        <button
          type="button"
          className="chip-toggle -mt-2"
          disabled={disabled}
          onClick={() => patch({ coupleNames: suggestion })}
        >
          ใช้ชื่อ &quot;{suggestion}&quot;
        </button>
      )}

      <div>
        <p className="field-label">ลูกค้าติดต่อมาทาง</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="ช่องทางที่ลูกค้าติดต่อ">
          {WED_SOURCES.map(s => (
            <button
              key={s}
              type="button"
              className="chip-toggle"
              aria-pressed={draft.source === s}
              disabled={disabled}
              onClick={() => patch({ source: s })}
            >
              {WED_SOURCE_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* ===== ชื่อช่องทาง (ป้ายตามปุ่มที่เลือก) — ไม่บังคับ ขึ้นในใบยืนยันการจอง ===== */}
      <Field
        id={ids.srcDetail}
        label={WED_SOURCE_DETAIL_LABELS[draft.source]}
        error={showErrors || draft.sourceDetail !== '' ? sourceDetailError : null}
        hint={'ไม่บังคับ · ขึ้นในใบยืนยันการจองช่อง "ช่องทางติดต่อ"'}
        className="-mt-2"
      >
        <input
          id={ids.srcDetail}
          className="input"
          value={draft.sourceDetail}
          maxLength={MAX_SOURCE_DETAIL}
          autoComplete="off"
          placeholder={SOURCE_DETAIL_PLACEHOLDERS[draft.source]}
          inputMode={draft.source === 'website' ? 'url' : undefined}
          autoCapitalize={HANDLE_SOURCES.includes(draft.source) ? 'none' : undefined}
          spellCheck={HANDLE_SOURCES.includes(draft.source) ? false : undefined}
          disabled={disabled}
          {...fieldAria(ids.srcDetail, showErrors || draft.sourceDetail !== '' ? sourceDetailError : null, true)}
          onChange={e => patch({ sourceDetail: e.target.value })}
        />
      </Field>
    </FormSection>
  )
}
