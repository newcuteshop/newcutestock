'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  AlertCircle, Check, Clock, FileText, Globe, Loader2, RotateCcw, Save, ScrollText, Store, Wallet, X,
  type LucideIcon,
} from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { baht, formatThaiDateTime } from '@/lib/format'
import { parseMoneyInput, round2 } from '@/lib/money'
import {
  LATE_FEE_MODE_LABELS, parseRentalSettings, RENTAL_LATE_FEE_MODES, type RentalCategory, type RentalSettings,
} from '@/lib/rental'
import { rentalErrorText } from '@/components/rental/money/moneyRows'
import BankAccountsEditor from '@/components/rental/settings/BankAccountsEditor'
import CategoriesManager from '@/components/rental/settings/CategoriesManager'
import PromptPayPreview from '@/components/rental/settings/PromptPayPreview'
import ShareBookingCard from '@/components/rental/settings/ShareBookingCard'
import TermsPreview from '@/components/rental/settings/TermsPreview'
import {
  asciiDigits, buildSection, clean, MAX_BUFFER_DAYS, MAX_HOLD_HOURS, mergeSection, SECTION_LABELS,
  sectionDirty, TEXT_LIMITS, toForm, type SectionKey, type SettingsForm,
} from '@/components/rental/settings/settingsForm'

// ตั้งค่าร้านเช่าชุด (เฉพาะผู้จัดการร้านเช่า): บันทึกทีละหมวด — rental_save_settings แก้เฉพาะคีย์ที่ส่งไป
// หมวดที่แก้ค้างไว้แต่ยังไม่กดบันทึก ไม่ถูกทับเมื่อบันทึกหมวดอื่น · มีที่แก้ค้าง → เตือนก่อนปิดแท็บ
// บันทึกซ้ำปลอดภัย (ทับค่าเดิมทั้งหมวด) → เน็ตหลุดระหว่างบันทึก กดบันทึกอีกครั้งได้เลย

type Toast = { ok: boolean; text: string } | null

const SECTION_ORDER: readonly { key: SectionKey | 'categories'; anchor: string; label: string }[] = [
  { key: 'shop', anchor: 'rs-shop', label: 'ข้อมูลร้าน' },
  { key: 'payment', anchor: 'rs-payment', label: 'ช่องทางรับเงิน' },
  { key: 'policy', anchor: 'rs-policy', label: 'นโยบายการเช่า' },
  { key: 'online', anchor: 'rs-online', label: 'จองออนไลน์' },
  { key: 'terms', anchor: 'rs-terms', label: 'ข้อตกลงในสัญญา' },
  { key: 'categories', anchor: 'rs-categories', label: 'หมวดชุด' },
]

const NO_FLAGS: Record<SectionKey, boolean> = { shop: false, payment: false, policy: false, online: false, terms: false }

function FieldError({ id, text }: { id: string; text?: string }) {
  if (!text) return null
  return <p id={id} role="alert" className="mt-1 text-sm text-red-700">{text}</p>
}

// ตัวอย่างมัดจำจากค่าที่กรอก (กติกาเดียวกับ rental_recalc: ปัดขึ้นเป็นบาท แล้วไม่ต่ำกว่ามัดจำขั้นต่ำ)
function depositExample(pctText: string, minText: string): string | null {
  const pct = parseMoneyInput(asciiDigits(pctText).replace(/%/g, ''))
  const min = clean(minText) === null ? 0 : parseMoneyInput(minText)
  if (pct === null || pct < 0 || pct > 100 || min === null || min < 0) return null
  const rent = 1000
  const dep = Math.min(rent, Math.max(min, Math.ceil(round2((rent * pct) / 100))))
  return `ตัวอย่าง: ค่าเช่า ${baht(rent)} → มัดจำจอง ${baht(dep)}`
}


// สถานะของฟอร์มที่ช่องกรอก/การ์ดหมวดใช้ร่วมกัน — ช่องกรอกเป็น component นอกตัวหลัก (ชนิดคงที่ทุก render)
// ไม่งั้น React สร้าง component ใหม่ทุกครั้งที่พิมพ์ ช่องจะหลุดโฟกัสหลังพิมพ์ทุกตัวอักษร
interface SettingsCtx {
  form: SettingsForm
  busy: boolean
  saving: SectionKey | null
  dirty: Record<SectionKey, boolean>
  sectionError: Partial<Record<SectionKey, string>>
  update: <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => void
  errOf: (section: SectionKey, key: keyof SettingsForm) => string | undefined
  saveSection: (section: SectionKey) => void
  resetSection: (section: SectionKey) => void
}

const SettingsContext = createContext<SettingsCtx | null>(null)

function useSettingsCtx(): SettingsCtx {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('ฟอร์มตั้งค่าร้านเช่าต้องอยู่ใน SettingsClient')
  return ctx
}

function SectionCard({ section, icon: Icon, title, description, children }: {
  section: SectionKey; icon: LucideIcon; title: string; description?: string; children: ReactNode
}) {
  const { saving, busy, dirty, sectionError, saveSection, resetSection } = useSettingsCtx()
  const err = sectionError[section]
  const isSaving = saving === section
  return (
    <section id={`rs-${section}`} tabIndex={-1} className="card scroll-mt-4 min-w-0 outline-none" aria-labelledby={`rs-${section}-title`}>
      <div className="card-header flex-wrap gap-2">
        <div className="min-w-0">
          <h2 id={`rs-${section}-title`} className="section-title">
            <Icon {...ICON} />
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-gray-500">{description}</p>}
        </div>
        {dirty[section] && !isSaving && <span className="chip-outline text-amber-800">ยังไม่บันทึก</span>}
      </div>
      <div className="space-y-4 p-4 sm:p-5">{children}</div>
      <div className="space-y-2 border-t border-gray-150 px-4 py-3 sm:px-5">
        {err && (
          <div role="alert" className="alert-err">
            <AlertCircle {...ICON_SM} />
            <p className="min-w-0 break-words">{err}</p>
          </div>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {dirty[section] && (
            <button type="button" onClick={() => resetSection(section)} disabled={busy} className="btn-secondary w-full sm:w-auto">
              <RotateCcw {...ICON_SM} />
              ยกเลิกการแก้ไข
            </button>
          )}
          <button
            type="button"
            onClick={() => saveSection(section)}
            disabled={busy || !dirty[section]}
            className="btn-primary w-full sm:w-auto sm:min-w-[160px]"
          >
            {isSaving ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Save {...ICON_SM} />}
            {isSaving ? 'กำลังบันทึก...' : `บันทึก${SECTION_LABELS[section]}`}
          </button>
        </div>
      </div>
    </section>
  )
}

// ช่องข้อความทั่วไป
function TextField({ section, name, label, placeholder, hint, rows, inputMode, type = 'text', required }: {
  section: SectionKey
  name: keyof typeof TEXT_LIMITS & keyof SettingsForm
  label: string
  placeholder?: string
  hint?: string
  rows?: number
  inputMode?: 'text' | 'tel' | 'url' | 'numeric' | 'decimal'
  type?: 'text' | 'tel' | 'url'
  required?: boolean
}) {
  const { form, busy, update, errOf } = useSettingsCtx()
  const id = `rs-${name}`
  const err = errOf(section, name)
  const value = form[name] as string
  const common = {
    id,
    className: 'input',
    maxLength: TEXT_LIMITS[name],
    value,
    disabled: busy,
    placeholder,
    'aria-invalid': err ? true : undefined,
    'aria-describedby': err || hint ? `${id}-hint` : undefined,
  }
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="field-label">{label}{required ? ' *' : ''}</label>
      {rows ? (
        <textarea {...common} rows={rows} onChange={e => update(name, e.target.value)} />
      ) : (
        <input
          {...common}
          type={type}
          inputMode={inputMode}
          autoComplete="off"
          onChange={e => update(name, e.target.value)}
        />
      )}
      {err ? <FieldError id={`${id}-hint`} text={err} /> : hint ? <p id={`${id}-hint`} className="field-hint">{hint}</p> : null}
    </div>
  )
}

// ช่องตัวเลข (จำนวนเต็ม/เงิน) พร้อมหน่วยท้ายช่อง
function NumberField({ section, name, label, unit, hint, decimal }: {
  section: SectionKey
  name: keyof SettingsForm
  label: string
  unit: string
  hint?: string
  decimal?: boolean
}) {
  const { form, busy, update, errOf } = useSettingsCtx()
  const id = `rs-${name}`
  const err = errOf(section, name)
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="field-label">{label}</label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="text"
          inputMode={decimal ? 'decimal' : 'numeric'}
          autoComplete="off"
          className="input min-w-0 flex-1 text-right tabular-nums"
          value={form[name] as string}
          disabled={busy}
          aria-invalid={err ? true : undefined}
          aria-describedby={err || hint ? `${id}-hint` : undefined}
          onChange={e => update(name, e.target.value as SettingsForm[typeof name])}
          onFocus={e => e.currentTarget.select()}
        />
        <span className="w-14 shrink-0 text-sm text-gray-600">{unit}</span>
      </div>
      {err ? <FieldError id={`${id}-hint`} text={err} /> : hint ? <p id={`${id}-hint`} className="field-hint">{hint}</p> : null}
    </div>
  )
}

export default function SettingsClient({
  initial,
  categories,
  categoriesError,
}: {
  initial: RentalSettings
  categories: RentalCategory[]
  categoriesError: string | null
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [saved, setSaved] = useState<RentalSettings>(initial)
  const [form, setForm] = useState<SettingsForm>(() => toForm(initial))
  const [submitted, setSubmitted] = useState<Record<SectionKey, boolean>>(NO_FLAGS)
  const [saving, setSaving] = useState<SectionKey | null>(null)
  const savingRef = useRef<SectionKey | null>(null)
  const [sectionError, setSectionError] = useState<Partial<Record<SectionKey, string>>>({})
  const [toast, setToast] = useState<Toast>(null)

  const savedForm = useMemo(() => toForm(saved), [saved])
  const built = useMemo(() => ({
    shop: buildSection('shop', form),
    payment: buildSection('payment', form),
    policy: buildSection('policy', form),
    online: buildSection('online', form),
    terms: buildSection('terms', form),
  }), [form])
  const dirty: Record<SectionKey, boolean> = {
    shop: sectionDirty('shop', form, savedForm),
    payment: sectionDirty('payment', form, savedForm),
    policy: sectionDirty('policy', form, savedForm),
    online: sectionDirty('online', form, savedForm),
    terms: sectionDirty('terms', form, savedForm),
  }
  const anyDirty = dirty.shop || dirty.payment || dirty.policy || dirty.online || dirty.terms

  // มีหมวดที่แก้แล้วยังไม่บันทึก → เตือนก่อนปิดแท็บ/รีเฟรช
  useEffect(() => {
    if (!anyDirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [anyDirty])

  // โทสต์สำเร็จหายเองใน 4 วินาที
  useEffect(() => {
    if (!toast || !toast.ok) return
    const t = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(t)
  }, [toast])

  const update = useCallback(<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
    setForm(f => ({ ...f, [key]: value }))
  }, [])

  // error ของช่อง: แสดงเมื่อกดบันทึกหมวดนั้นแล้ว หรือช่องนั้นถูกแก้ (เปิดหน้ามาไม่ขึ้นแดงทันที)
  function errOf(section: SectionKey, key: keyof SettingsForm): string | undefined {
    const msg = built[section].errors[key]
    if (!msg) return undefined
    if (submitted[section]) return msg
    const a = form[key]
    const b = savedForm[key]
    const changed = typeof a === 'string' && typeof b === 'string' ? clean(a) !== clean(b) : a !== b
    return changed ? msg : undefined
  }

  function resetSection(section: SectionKey) {
    setForm(f => mergeSection(f, toForm(saved), section))
    setSubmitted(s => ({ ...s, [section]: false }))
    setSectionError(e => ({ ...e, [section]: undefined }))
  }

  async function saveSection(section: SectionKey) {
    if (savingRef.current) return
    setSubmitted(s => ({ ...s, [section]: true }))
    const { payload, errors } = built[section]
    const errorKeys = Object.keys(errors)
    if (errorKeys.length > 0) {
      setSectionError(e => ({ ...e, [section]: 'ข้อมูลบางช่องไม่ถูกต้อง ตรวจช่องที่ขึ้นสีแดงก่อนบันทึก' }))
      // เลื่อนช่องแรกที่ผิดมากลางจอ
      const first = errorKeys[0]
      const el = document.getElementById(`rs-${first.split('.')[0]}`) ?? document.getElementById(`rs-${section}`)
      if (el) {
        el.focus({ preventScroll: true })
        el.scrollIntoView({ block: 'center' })
      }
      return
    }
    savingRef.current = section
    setSaving(section)
    setSectionError(e => ({ ...e, [section]: undefined }))
    try {
      const { data, error } = await supabase.rpc('rental_save_settings', { p_settings: payload })
      if (error) {
        setSectionError(e => ({ ...e, [section]: rentalErrorText(error) }))
        return
      }
      // ค่าที่ฐานข้อมูลบันทึกจริง (ตัดช่องว่าง/จัดรูปแล้ว) เป็นค่าตั้งต้นใหม่ของหมวดนี้ — หมวดอื่นที่แก้ค้างคงไว้
      const next = parseRentalSettings(data)
      setSaved(next)
      setForm(f => mergeSection(f, toForm(next), section))
      setSubmitted(s => ({ ...s, [section]: false }))
      setToast({ ok: true, text: `บันทึก${SECTION_LABELS[section]}แล้ว` })
      // ชื่อร้านอยู่บนเมนูข้าง (layout ฝั่งเซิร์ฟเวอร์) → โหลดใหม่ให้ชื่อใหม่ขึ้นทันที
      if (section === 'shop' && navigator.onLine !== false) router.refresh()
    } catch (err) {
      setSectionError(e => ({ ...e, [section]: `${rentalErrorText(err)} — กดบันทึกอีกครั้งได้ (บันทึกซ้ำไม่เกิดข้อมูลซ้ำ)` }))
    } finally {
      savingRef.current = null
      setSaving(null)
    }
  }

  const busy = saving !== null

  const deposit = depositExample(form.booking_deposit_percent, form.min_booking_deposit)
  const termsLen = form.terms_text.length
  const ctx: SettingsCtx = {
    form,
    busy,
    saving,
    dirty,
    sectionError,
    update,
    errOf,
    saveSection: section => { void saveSection(section) },
    resetSection,
  }

  return (
    <SettingsContext.Provider value={ctx}>
      <div className="space-y-4 sm:space-y-6">
        <div className="page-header">
          <div className="min-w-0">
            <h1 className="page-title">ตั้งค่าร้านเช่า</h1>
            <p className="page-subtitle">ข้อมูลร้าน ช่องทางรับเงิน นโยบายการเช่า การจองออนไลน์ ข้อตกลงในสัญญา และหมวดชุด</p>
            {saved.updated_at && (
              <p className="mt-1 text-xs tabular-nums text-gray-500">แก้ไขล่าสุด {formatThaiDateTime(saved.updated_at)}</p>
            )}
          </div>
        </div>

        {/* ทางลัดไปแต่ละหมวด */}
        <nav aria-label="หมวดการตั้งค่า" className="flex flex-wrap gap-2">
          {SECTION_ORDER.map(s => (
            <a key={s.anchor} href={`#${s.anchor}`} className="chip-toggle">
              {s.label}
              {s.key !== 'categories' && dirty[s.key] && (
                <>
                  <span className="text-amber-700" aria-hidden="true"> •</span>
                  <span className="sr-only"> (ยังไม่บันทึก)</span>
                </>
              )}
            </a>
          ))}
        </nav>

        {/* ===== ข้อมูลร้าน ===== */}
        <SectionCard
          section="shop"
          icon={Store}
          title="ข้อมูลร้าน"
          description="แสดงบนหน้าจองออนไลน์ สัญญาเช่า และใบเสร็จ"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-x-4">
            <TextField section="shop" name="shop_name" label="ชื่อร้าน" required placeholder="ชื่อร้านเช่าชุด" />
            <TextField section="shop" name="tagline" label="คำโปรย" placeholder="เช่น ชุดไทย ชุดราตรี ครบทุกงาน" />
            <div className="sm:col-span-2">
              <TextField section="shop" name="address" label="ที่อยู่ร้าน" rows={2} hint="ขึ้นบรรทัดใหม่ได้ — พิมพ์บนสัญญาเช่าและใบเสร็จตามบรรทัดที่กรอก" />
            </div>
            <TextField section="shop" name="phone" label="เบอร์โทรร้าน" type="tel" inputMode="tel" placeholder="เช่น 081-234-5678" />
            <TextField section="shop" name="opening_hours" label="เวลาเปิดร้าน" placeholder="เช่น ทุกวัน 10:00–19:00 น." />
            <TextField section="shop" name="line_id" label="LINE ID" placeholder="เช่น @shopname" />
            <TextField
              section="shop"
              name="line_url"
              label="ลิงก์ LINE"
              type="url"
              inputMode="url"
              placeholder="https://lin.ee/..."
              hint={'ปุ่ม "แชท LINE" บนหน้าจองออนไลน์จะเปิดลิงก์นี้'}
            />
            <TextField section="shop" name="facebook_url" label="ลิงก์ Facebook" type="url" inputMode="url" placeholder="https://facebook.com/..." />
            <TextField section="shop" name="receipt_footer" label="ข้อความท้ายใบเสร็จ" placeholder="เช่น ขอบคุณที่ใช้บริการค่ะ" hint="เว้นว่าง = ไม่พิมพ์ข้อความท้ายใบเสร็จ" />
          </div>
        </SectionCard>

        {/* ===== ช่องทางรับเงิน ===== */}
        <SectionCard
          section="payment"
          icon={Wallet}
          title="ช่องทางรับเงิน"
          description="ลูกค้าเห็นในหน้าสถานะการจอง (QR พร้อมเพย์พร้อมยอด + บัญชีธนาคาร) และในข้อความแจ้งชำระทาง LINE"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-x-4">
            <div className="min-w-0">
              <label htmlFor="rs-promptpay_id" className="field-label">พร้อมเพย์ (เบอร์มือถือ / เลขผู้เสียภาษี)</label>
              <input
                id="rs-promptpay_id"
                className="input tabular-nums"
                inputMode="numeric"
                autoComplete="off"
                maxLength={30}
                placeholder="เช่น 0812345678"
                value={form.promptpay_id}
                disabled={busy}
                aria-invalid={errOf('payment', 'promptpay_id') ? true : undefined}
                aria-describedby="rs-promptpay_id-hint"
                onChange={e => update('promptpay_id', asciiDigits(e.target.value))}
              />
              {errOf('payment', 'promptpay_id')
                ? <FieldError id="rs-promptpay_id-hint" text={errOf('payment', 'promptpay_id')} />
                : <p id="rs-promptpay_id-hint" className="field-hint">มือถือ 10 หลัก หรือเลข 13 หลัก — เว้นว่าง = ไม่ใช้พร้อมเพย์</p>}
            </div>
            <TextField section="payment" name="promptpay_name" label="ชื่อบัญชีพร้อมเพย์" placeholder="ชื่อที่ขึ้นตอนสแกน" />
          </div>
          <PromptPayPreview promptpayId={form.promptpay_id} promptpayName={form.promptpay_name} />
          <hr className="divider" />
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-gray-900">บัญชีธนาคาร</h3>
            <BankAccountsEditor
              rows={form.bank_accounts}
              onChange={rows => update('bank_accounts', rows)}
              errors={built.payment.errors}
              showErrors={submitted.payment}
              disabled={busy}
            />
          </div>
        </SectionCard>

        {/* ===== นโยบายการเช่า ===== */}
        <SectionCard
          section="policy"
          icon={ScrollText}
          title="นโยบายการเช่า"
          description="ใช้คำนวณมัดจำ วันกันชุด และค่าปรับคืนช้า — มีผลกับการจอง/การคืนชุดหลังบันทึก"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-x-4">
            <NumberField
              section="policy"
              name="booking_deposit_percent"
              label="มัดจำจอง (% ของค่าเช่าหลังส่วนลด)"
              unit="%"
              decimal
              hint={deposit ?? 'ใส่ 0–100'}
            />
            <NumberField
              section="policy"
              name="min_booking_deposit"
              label="มัดจำขั้นต่ำ"
              unit="บาท"
              decimal
              hint="มัดจำจองไม่ต่ำกว่ายอดนี้ (ไม่เกินยอดรวมของการจอง) — ไม่มีขั้นต่ำใส่ 0"
            />
            <NumberField
              section="policy"
              name="default_base_days"
              label="ราคาเช่าเริ่มต้นรวมกี่วัน"
              unit="วัน"
              hint="ค่าตั้งต้นตอนเพิ่มชุดใหม่ (แต่ละชุดแก้ได้) — เกินจากนี้คิดราคาวันเพิ่มของชุด"
            />
            <div className="hidden sm:block" aria-hidden="true" />
            <NumberField
              section="policy"
              name="buffer_before_days"
              label="วันเตรียมชุดก่อนวันรับ"
              unit="วัน"
              hint={`กันชุดไว้ก่อนวันรับ (รีด/ตรวจ/แก้ไซส์) 0–${MAX_BUFFER_DAYS} วัน`}
            />
            <NumberField
              section="policy"
              name="buffer_after_days"
              label="วันซัก/ตรวจชุดหลังวันคืน"
              unit="วัน"
              hint={`กันชุดไว้หลังวันคืน 0–${MAX_BUFFER_DAYS} วัน (ค่าเริ่มต้น 1 วัน) — ชุดที่ตั้งค่าเฉพาะไว้ใช้ค่าของชุดนั้น`}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="field-label">ค่าปรับคืนชุดช้า</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="วิธีคิดค่าปรับคืนช้า">
              {RENTAL_LATE_FEE_MODES.map(m => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={form.late_fee_mode === m}
                  onClick={() => update('late_fee_mode', m)}
                  disabled={busy}
                  className="choice min-h-[56px] text-left"
                >
                  <span className="text-sm">{LATE_FEE_MODE_LABELS[m]}</span>
                </button>
              ))}
            </div>
            {form.late_fee_mode === 'fixed_per_day' && (
              <div className="sm:max-w-xs">
                <NumberField section="policy" name="late_fee_fixed" label="ค่าปรับต่อวัน (ต่อการจอง)" unit="บาท/วัน" decimal />
              </div>
            )}
            <p className="field-hint">
              {form.late_fee_mode === 'per_day_item'
                ? 'ค่าปรับ = จำนวนวันที่คืนช้า × ราคาวันเพิ่มของแต่ละชุด (ระบบเติมให้ตอนรับคืน พนักงานแก้ได้)'
                : form.late_fee_mode === 'fixed_per_day'
                  ? 'ค่าปรับ = จำนวนวันที่คืนช้า × อัตรานี้ ต่อการจอง 1 ครั้ง (ระบบเติมให้ตอนรับคืน พนักงานแก้ได้)'
                  : 'ไม่เติมค่าปรับให้อัตโนมัติ — พนักงานยังเพิ่มค่าปรับเองได้ตอนรับคืน'}
            </p>
          </fieldset>
        </SectionCard>

        {/* ===== จองออนไลน์ ===== */}
        <SectionCard
          section="online"
          icon={Globe}
          title="จองออนไลน์"
          description={'ลูกค้าจองผ่านลิงก์ได้เอง — คำขอจองเข้ามาเป็น "รอยืนยัน" และถือชุดไว้ตามเวลาที่กำหนด'}
        >
          <div className="panel p-3">
            <button
              type="button"
              role="switch"
              aria-checked={form.online_enabled}
              onClick={() => update('online_enabled', !form.online_enabled)}
              disabled={busy}
              className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-900">เปิดรับจองออนไลน์</span>
                <span className="block text-xs text-gray-500">
                  ปิด = หน้าจองแสดงข้อความปิดรับจองพร้อมช่องทางติดต่อร้าน (การจองเดิมและลิงก์สถานะยังใช้ได้)
                </span>
              </span>
              <span aria-hidden="true" className={clsx('switch', form.online_enabled && 'switch-on')}>
                <span className="switch-knob" />
              </span>
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-x-4">
            <NumberField
              section="online"
              name="online_hold_hours"
              label="ถือคำขอจองไว้"
              unit="ชั่วโมง"
              hint={`1–${MAX_HOLD_HOURS} ชม. — ไม่ยืนยันภายในเวลานี้ คำขอหมดอายุ ชุดว่างให้คนอื่น`}
            />
            <NumberField
              section="online"
              name="online_min_lead_days"
              label="ต้องจองล่วงหน้าอย่างน้อย"
              unit="วัน"
              hint="0 = จองรับวันนี้ได้"
            />
            <NumberField
              section="online"
              name="online_max_days"
              label="เช่าออนไลน์ได้นานสุด"
              unit="วัน"
              hint="นานกว่านี้ให้ติดต่อร้าน"
            />
          </div>
          <TextField
            section="online"
            name="online_notice"
            label="ข้อความประกาศบนหน้าจองออนไลน์"
            rows={3}
            placeholder="เช่น ช่วงสงกรานต์ร้านปิด 13–15 เม.ย. / จองแล้วกรุณาโอนมัดจำภายใน 24 ชม."
            hint="เว้นว่าง = ไม่มีประกาศ"
          />
        </SectionCard>

        <ShareBookingCard
          shopName={saved.shop_name}
          tagline={saved.tagline}
          phone={saved.phone}
          lineId={saved.line_id}
          openingHours={saved.opening_hours}
          onlineEnabled={saved.online_enabled}
        />

        {/* ===== ข้อตกลงในสัญญา ===== */}
        <SectionCard
          section="terms"
          icon={FileText}
          title="ข้อตกลงในสัญญาเช่า"
          description="พิมพ์ท้ายสัญญาเช่าทั้งฉบับร้านและฉบับลูกค้า และแสดงให้ลูกค้ากดยอมรับตอนจองออนไลน์"
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor="rs-terms_text" className="field-label">ข้อตกลง (1 บรรทัด = 1 ข้อ)</label>
              <textarea
                id="rs-terms_text"
                className="input min-h-[320px] leading-relaxed"
                rows={14}
                maxLength={TEXT_LIMITS.terms_text}
                value={form.terms_text}
                disabled={busy}
                aria-invalid={errOf('terms', 'terms_text') ? true : undefined}
                aria-describedby="rs-terms_text-hint"
                onChange={e => update('terms_text', e.target.value)}
              />
              {errOf('terms', 'terms_text') ? (
                <FieldError id="rs-terms_text-hint" text={errOf('terms', 'terms_text')} />
              ) : (
                <p id="rs-terms_text-hint" className="field-hint">
                  ระบบใส่เลขข้อให้เอง (พิมพ์เลขไว้แล้วก็ได้ — เลขจะถูกเรียงใหม่) · บรรทัดที่ขึ้นต้นด้วย - หรือเว้นวรรค = รายละเอียดของข้อก่อนหน้า ·{' '}
                  <span className="tabular-nums">{termsLen.toLocaleString('en-US')}/{TEXT_LIMITS.terms_text.toLocaleString('en-US')}</span> ตัวอักษร
                </p>
              )}
            </div>
            <div className="min-w-0 space-y-1">
              <p className="field-label">ตัวอย่างบนสัญญา</p>
              <div className="max-h-[420px] overflow-y-auto overscroll-contain">
                <TermsPreview text={form.terms_text} shopName={clean(form.shop_name) ?? saved.shop_name} />
              </div>
            </div>
          </div>
        </SectionCard>

        {categoriesError ? (
          <section id="rs-categories" className="card scroll-mt-4 p-4 sm:p-5">
            <div role="alert" className="alert-err">
              <AlertCircle {...ICON_SM} />
              <p className="min-w-0 break-words">โหลดหมวดชุดไม่ได้: {categoriesError} — โหลดหน้าใหม่อีกครั้ง</p>
            </div>
          </section>
        ) : (
          <CategoriesManager initial={categories} onMessage={text => setToast({ ok: true, text })} />
        )}

        <p className="flex items-start gap-1.5 text-xs text-gray-500">
          <Clock size={14} strokeWidth={1.9} aria-hidden="true" className="mt-px shrink-0" />
          <span className="min-w-0">
            แต่ละหมวดบันทึกแยกกัน — กด &quot;บันทึก&quot; ท้ายหมวดที่แก้ · หมวดที่ยังไม่บันทึกมีจุดสีส้มที่ทางลัดด้านบน
          </span>
        </p>

        {toast && (
          <div
            role={toast.ok ? 'status' : 'alert'}
            aria-live="polite"
            className="pointer-events-none fixed inset-x-4 z-40 flex justify-center bottom-[calc(1rem_+_env(safe-area-inset-bottom))] md:left-[calc(15rem_+_1rem)] lg:bottom-6"
          >
            <div className={clsx(toast.ok ? 'toast-ok' : 'toast-err', 'pointer-events-auto')}>
              <span className="toast-icon">
                {toast.ok
                  ? <Check size={18} strokeWidth={2.4} aria-hidden="true" />
                  : <X size={18} strokeWidth={2.4} aria-hidden="true" />}
              </span>
              <span className="min-w-0 break-words">{toast.text}</span>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="btn-icon btn-icon-plain -my-1 -mr-3 text-current"
                aria-label="ปิดข้อความ"
              >
                <X {...ICON_SM} />
              </button>
            </div>
          </div>
        )}
      </div>
    </SettingsContext.Provider>
  )
}
