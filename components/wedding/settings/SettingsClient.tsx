'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  AlertCircle, Clock, FileText, Link2, Loader2, MessageCircle, RotateCcw, Save, ScrollText, Store, StickyNote, Wallet,
  type LucideIcon,
} from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { baht, formatThaiDateTime } from '@/lib/format'
import { parseMoneyInput } from '@/lib/money'
import { parseWeddingSettings, termsLines, type WedSettings } from '@/lib/wedding'
import BankAccountsEditor from '@/components/rental/settings/BankAccountsEditor'
import PageToast, { useToast } from './PageToast'
import TabBar, { tabPanelProps } from './TabBar'
import LogoUploader from './LogoUploader'
import PromptPayPreview from './PromptPayPreview'
import TermsPreview from './TermsPreview'
import { callRpc, wedErrorText } from './wedRpc'
import {
  asciiDigits, buildSection, clean, depositFor, MAX_BALANCE_DUE_DAYS, MAX_HOLD_HOURS, MAX_JOBS_PER_DAY, mergeSection,
  NO_FLAGS, SECTION_KEYS, SECTION_LABELS, sectionDirty, TEXT_LIMITS, toForm, type SectionKey, type WedSettingsForm,
} from './settingsForm'

// ตั้งค่าร้าน b.oncloud (เฉพาะผู้จัดการ): แบ่งเป็นแท็บ บันทึกทีละแท็บ — wed_save_settings แก้เฉพาะคีย์ที่ส่งไป
// แท็บที่แก้ค้างไว้แต่ยังไม่กดบันทึก ไม่ถูกทับเมื่อบันทึกแท็บอื่น (สลับแท็บแล้วค่าที่พิมพ์ไว้ยังอยู่) · มีที่แก้ค้าง → เตือนก่อนปิดหน้า
// บันทึกซ้ำปลอดภัย (ทับค่าเดิมทั้งแท็บ) → เน็ตหลุดระหว่างบันทึก กดบันทึกอีกครั้งได้เลย
// แท็บที่เปิดอยู่จำไว้ใน # ของ URL (เช่น /wedding/settings#payment) — ลิงก์จากหน้าอื่นเปิดตรงแท็บได้

const TABS: readonly { key: SectionKey; icon: LucideIcon }[] = [
  { key: 'shop', icon: Store },
  { key: 'contact', icon: MessageCircle },
  { key: 'payment', icon: Wallet },
  { key: 'policy', icon: ScrollText },
  { key: 'terms', icon: FileText },
  { key: 'docs', icon: StickyNote },
  { key: 'portal', icon: Link2 },
]

function isSectionKey(v: string): v is SectionKey {
  return (SECTION_KEYS as readonly string[]).includes(v)
}

function FieldError({ id, text }: { id: string; text?: string }) {
  if (!text) return null
  return <p id={id} role="alert" className="mt-1 text-sm text-red-700">{text}</p>
}

// ตัวอย่างมัดจำจากค่าที่กรอก (กติกาเดียวกับ wed_recalc: ปัดขึ้นเป็นบาท ไม่ต่ำกว่ามัดจำขั้นต่ำ ไม่เกินยอดงาน)
function depositExample(pctText: string, minText: string): string | null {
  const pct = parseMoneyInput(asciiDigits(pctText).replace(/%/g, ''))
  const min = clean(minText) === null ? 0 : parseMoneyInput(minText)
  if (pct === null || pct < 0 || pct > 100 || min === null || min < 0) return null
  const total = 30000
  return `ตัวอย่าง: งาน ${baht(total)} → มัดจำ ${baht(depositFor(total, pct, min))}`
}

// สถานะของฟอร์มที่ช่องกรอก/การ์ดใช้ร่วมกัน — ช่องกรอกเป็น component นอกตัวหลัก (ชนิดคงที่ทุก render)
// ไม่งั้น React สร้าง component ใหม่ทุกครั้งที่พิมพ์ ช่องจะหลุดโฟกัสหลังพิมพ์ทุกตัวอักษร
interface SettingsCtx {
  form: WedSettingsForm
  busy: boolean
  saving: SectionKey | null
  dirty: Record<SectionKey, boolean>
  sectionError: Partial<Record<SectionKey, string>>
  update: <K extends keyof WedSettingsForm>(key: K, value: WedSettingsForm[K]) => void
  errOf: (section: SectionKey, key: keyof WedSettingsForm) => string | undefined
  saveSection: (section: SectionKey) => void
  resetSection: (section: SectionKey) => void
}

const SettingsContext = createContext<SettingsCtx | null>(null)

function useSettingsCtx(): SettingsCtx {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('ฟอร์มตั้งค่าร้านต้องอยู่ใน SettingsClient')
  return ctx
}

function SectionCard({ section, icon: Icon, title, description, children }: {
  section: SectionKey; icon: LucideIcon; title: string; description?: string; children: ReactNode
}) {
  const { saving, busy, dirty, sectionError, saveSection, resetSection } = useSettingsCtx()
  const err = sectionError[section]
  const isSaving = saving === section
  return (
    <section {...tabPanelProps('ws', section)} className="card min-w-0">
      <div className="card-header flex-wrap gap-2">
        <div className="min-w-0">
          <h2 className="section-title">
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
function TextField({ section, name, label, placeholder, hint, rows, inputMode, type = 'text', required, counter }: {
  section: SectionKey
  name: keyof typeof TEXT_LIMITS & keyof WedSettingsForm
  label: string
  placeholder?: string
  hint?: string
  rows?: number
  inputMode?: 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal'
  type?: 'text' | 'tel' | 'url' | 'email'
  required?: boolean
  /** แสดงจำนวนตัวอักษร / เพดาน ใต้ช่อง */
  counter?: boolean
}) {
  const { form, busy, update, errOf } = useSettingsCtx()
  const id = `ws-${name}`
  const err = errOf(section, name)
  const value = form[name] as string
  const max = TEXT_LIMITS[name]
  const common = {
    id,
    className: 'input',
    maxLength: max,
    value,
    disabled: busy,
    placeholder,
    'aria-invalid': err ? true : undefined,
    'aria-describedby': err || hint || counter ? `${id}-hint` : undefined,
  }
  const hintText = counter
    ? `${hint ? `${hint} · ` : ''}${value.length.toLocaleString('en-US')}/${max.toLocaleString('en-US')} ตัวอักษร`
    : hint
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
      {err ? <FieldError id={`${id}-hint`} text={err} /> : hintText ? <p id={`${id}-hint`} className="field-hint">{hintText}</p> : null}
    </div>
  )
}

// ช่องตัวเลข (จำนวนเต็ม/เงิน) พร้อมหน่วยท้ายช่อง
function NumberField({ section, name, label, unit, hint, decimal }: {
  section: SectionKey
  name: keyof WedSettingsForm
  label: string
  unit: string
  hint?: string
  decimal?: boolean
}) {
  const { form, busy, update, errOf } = useSettingsCtx()
  const id = `ws-${name}`
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
          onChange={e => update(name, e.target.value as WedSettingsForm[typeof name])}
          onFocus={e => e.currentTarget.select()}
        />
        <span className="w-16 shrink-0 text-sm text-gray-600">{unit}</span>
      </div>
      {err ? <FieldError id={`${id}-hint`} text={err} /> : hint ? <p id={`${id}-hint`} className="field-hint">{hint}</p> : null}
    </div>
  )
}

export default function SettingsClient({ initial }: { initial: WedSettings }) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [saved, setSaved] = useState<WedSettings>(initial)
  const [form, setForm] = useState<WedSettingsForm>(() => toForm(initial))
  const [tab, setTab] = useState<SectionKey>('shop')
  const [submitted, setSubmitted] = useState<Record<SectionKey, boolean>>({ ...NO_FLAGS })
  const [saving, setSaving] = useState<SectionKey | null>(null)
  const savingRef = useRef<SectionKey | null>(null)
  const [sectionError, setSectionError] = useState<Partial<Record<SectionKey, string>>>({})
  const [toast, setToast] = useToast()

  const savedForm = useMemo(() => toForm(saved), [saved])
  const built = useMemo(() => {
    const out = {} as Record<SectionKey, ReturnType<typeof buildSection>>
    for (const k of SECTION_KEYS) out[k] = buildSection(k, form)
    return out
  }, [form])
  const dirty = {} as Record<SectionKey, boolean>
  for (const k of SECTION_KEYS) dirty[k] = sectionDirty(k, form, savedForm)
  const anyDirty = SECTION_KEYS.some(k => dirty[k])

  // เปิดตรงแท็บจาก # ของ URL (เช่น ลิงก์ "ตั้งค่าพร้อมเพย์" จากหน้าอื่น)
  useEffect(() => {
    function fromHash() {
      const h = window.location.hash.replace(/^#/, '')
      if (isSectionKey(h)) setTab(h)
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    return () => window.removeEventListener('hashchange', fromHash)
  }, [])

  // มีแท็บที่แก้แล้วยังไม่บันทึก → เตือนก่อนปิดแท็บ/รีเฟรช
  useEffect(() => {
    if (!anyDirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [anyDirty])

  const update = useCallback(<K extends keyof WedSettingsForm>(key: K, value: WedSettingsForm[K]) => {
    setForm(f => ({ ...f, [key]: value }))
  }, [])

  function chooseTab(next: SectionKey) {
    setTab(next)
    try {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${next}`)
    } catch {
      // แก้ URL ไม่ได้ ไม่เป็นไร
    }
  }

  // error ของช่อง: แสดงเมื่อกดบันทึกแท็บนั้นแล้ว หรือช่องนั้นถูกแก้ (เปิดหน้ามาไม่ขึ้นแดงทันที)
  function errOf(section: SectionKey, key: keyof WedSettingsForm): string | undefined {
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
      const el = document.getElementById(`ws-${first.split('.')[0]}`) ?? document.getElementById(`ws-panel-${section}`)
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
      const res = await callRpc(supabase, 'wed_save_settings', { p_settings: payload })
      if (!res.ok) {
        setSectionError(e => ({
          ...e,
          [section]: res.answered
            ? wedErrorText(res.error)
            : `${wedErrorText(res.error)} — กดบันทึกอีกครั้งได้ (บันทึกซ้ำไม่เกิดข้อมูลซ้ำ)`,
        }))
        return
      }
      // ค่าที่ฐานข้อมูลบันทึกจริง (ตัดช่องว่าง/จัดรูปแล้ว) เป็นค่าตั้งต้นใหม่ของแท็บนี้ — แท็บอื่นที่แก้ค้างคงไว้
      const next = parseWeddingSettings(res.data)
      setSaved(next)
      setForm(f => mergeSection(f, toForm(next), section))
      setSubmitted(s => ({ ...s, [section]: false }))
      setToast({ ok: true, text: `บันทึก${SECTION_LABELS[section]}แล้ว` })
      // ชื่อร้านอยู่บนเมนูข้าง (layout ฝั่งเซิร์ฟเวอร์) → โหลดใหม่ให้ชื่อใหม่ขึ้นทันที
      if (section === 'shop' && navigator.onLine !== false) router.refresh()
    } finally {
      savingRef.current = null
      setSaving(null)
    }
  }

  const busy = saving !== null
  const deposit = depositExample(form.deposit_percent, form.min_deposit)
  const clauseCount = termsLines(form.terms_text).length
  const shopNameNow = clean(form.shop_name) ?? saved.shop_name

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
            <h1 className="page-title">ตั้งค่าร้าน</h1>
            <p className="page-subtitle">ข้อมูลร้าน โลโก้ ช่องทางติดต่อ การรับเงิน นโยบายมัดจำ เงื่อนไขสัญญา ข้อความบนเอกสาร และลิงก์ลูกค้า</p>
            {saved.updated_at && (
              <p className="mt-1 text-xs tabular-nums text-gray-500">แก้ไขล่าสุด {formatThaiDateTime(saved.updated_at)}</p>
            )}
          </div>
        </div>

        {/* แท็บ (ปุ่มกลุ่มเดียวกัน) — มือถือขึ้นบรรทัดใหม่ได้ ไม่เลื่อนข้าง · จุดสีส้ม = ยังไม่บันทึก */}
        <TabBar
          tabs={TABS.map(t => ({ key: t.key, icon: t.icon, label: SECTION_LABELS[t.key], dot: dirty[t.key] }))}
          value={tab}
          onChange={chooseTab}
          idPrefix="ws"
          label="หมวดการตั้งค่า"
        />

        {/* ===== ข้อมูลร้าน ===== */}
        {tab === 'shop' && (
          <SectionCard
            section="shop"
            icon={Store}
            title="ข้อมูลร้าน"
            description="แสดงบนหัวเอกสารการจอง ใบเสร็จ สัญญาจ้าง และหน้าลิงก์ติดตามงานของลูกค้า"
          >
            <LogoUploader
              settings={saved}
              disabled={busy}
              onSaved={next => {
                setSaved(next)
                // โลโก้อยู่บนเมนูข้าง/แถบบน/ไอคอนแท็บ (layout ฝั่งเซิร์ฟเวอร์อ่านทุกคำขอ) → โหลดใหม่ให้โลโก้ใหม่ขึ้นทันที
                if (navigator.onLine !== false) router.refresh()
              }}
              onMessage={text => setToast({ ok: true, text })}
            />
            <hr className="divider" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-x-4">
              <TextField section="shop" name="shop_name" label="ชื่อร้าน" required placeholder="ชื่อร้านที่ลูกค้าเห็น" />
              <TextField section="shop" name="tagline" label="คำโปรย" placeholder="เช่น Wedding Photo · Video · Content" />
              <TextField section="shop" name="phone" label="เบอร์โทรร้าน" type="tel" inputMode="tel" placeholder="เช่น 081-234-5678" />
              <TextField section="shop" name="email" label="อีเมลร้าน" type="email" inputMode="email" placeholder="เช่น hello@example.com" />
              <div className="sm:col-span-2">
                <TextField
                  section="shop"
                  name="address"
                  label="ที่อยู่ร้าน (ผู้ให้บริการ)"
                  rows={3}
                  hint="ขึ้นบรรทัดใหม่ได้ — พิมพ์บนสัญญาจ้างและใบเสร็จตามบรรทัดที่กรอก"
                />
              </div>
            </div>
          </SectionCard>
        )}

        {/* ===== ช่องทางติดต่อ ===== */}
        {tab === 'contact' && (
          <SectionCard
            section="contact"
            icon={MessageCircle}
            title="ช่องทางติดต่อ"
            description="ปุ่มติดต่อร้านบนหน้าลิงก์ติดตามงาน และช่องทางที่พิมพ์ท้ายเอกสาร"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-x-4">
              <TextField section="contact" name="line_id" label="LINE ID" placeholder="เช่น @boncloud" />
              <TextField
                section="contact"
                name="line_url"
                label="ลิงก์ LINE"
                type="url"
                inputMode="url"
                placeholder="https://lin.ee/..."
                hint={'ปุ่ม "แชท LINE" บนหน้าลิงก์ติดตามงานเปิดลิงก์นี้'}
              />
              <TextField
                section="contact"
                name="instagram"
                label="Instagram"
                placeholder="เช่น @boncloud.wedding หรือลิงก์โปรไฟล์"
                hint="ใส่ชื่อบัญชีหรือลิงก์ก็ได้"
              />
              <TextField
                section="contact"
                name="facebook"
                label="Facebook"
                placeholder="ชื่อเพจ หรือ https://facebook.com/..."
              />
              <TextField
                section="contact"
                name="tiktok"
                label="TikTok"
                placeholder="เช่น @boncloud หรือลิงก์โปรไฟล์"
              />
            </div>
          </SectionCard>
        )}

        {/* ===== การรับเงิน ===== */}
        {tab === 'payment' && (
          <SectionCard
            section="payment"
            icon={Wallet}
            title="การรับเงิน"
            description="ลูกค้าเห็นบนใบแจ้งชำระเงิน (QR พร้อมเพย์พร้อมยอด + บัญชีธนาคาร) ลิงก์ติดตามงาน และข้อความแจ้งชำระทาง LINE"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-x-4">
              <div className="min-w-0">
                <label htmlFor="ws-promptpay_id" className="field-label">พร้อมเพย์ (เบอร์มือถือ / เลขผู้เสียภาษี)</label>
                <input
                  id="ws-promptpay_id"
                  className="input tabular-nums"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={30}
                  placeholder="เช่น 0812345678"
                  value={form.promptpay_id}
                  disabled={busy}
                  aria-invalid={errOf('payment', 'promptpay_id') ? true : undefined}
                  aria-describedby="ws-promptpay_id-hint"
                  onChange={e => update('promptpay_id', asciiDigits(e.target.value))}
                />
                {errOf('payment', 'promptpay_id')
                  ? <FieldError id="ws-promptpay_id-hint" text={errOf('payment', 'promptpay_id')} />
                  : <p id="ws-promptpay_id-hint" className="field-hint">มือถือ 10 หลัก หรือเลข 13 หลัก — เว้นว่าง = ไม่ใช้พร้อมเพย์</p>}
              </div>
              <TextField section="payment" name="promptpay_name" label="ชื่อบัญชีพร้อมเพย์" placeholder="ชื่อที่ขึ้นตอนสแกน" />
            </div>
            <PromptPayPreview promptpayId={form.promptpay_id} promptpayName={form.promptpay_name} />
            <hr className="divider" />
            <div className="space-y-2">
              <h3 className="text-base font-semibold text-gray-900">บัญชีธนาคาร (ไม่เกิน 5 บัญชี)</h3>
              <BankAccountsEditor
                rows={form.bank_accounts}
                onChange={rows => update('bank_accounts', rows)}
                errors={built.payment.errors}
                showErrors={submitted.payment}
                disabled={busy}
              />
            </div>
          </SectionCard>
        )}

        {/* ===== นโยบาย ===== */}
        {tab === 'policy' && (
          <SectionCard
            section="policy"
            icon={ScrollText}
            title="นโยบายมัดจำ คิว และค่าล่วงเวลา"
            description="มัดจำ/วันชำระยอดคงเหลือ ใช้กับงานที่สร้างใหม่หลังบันทึก — งานเดิมจำนโยบาย ณ ตอนจองไว้ ไม่เปลี่ยนตาม"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-x-4">
              <NumberField
                section="policy"
                name="deposit_percent"
                label="มัดจำ (% ของยอดงานหลังส่วนลด)"
                unit="%"
                decimal
                hint={deposit ?? 'ใส่ 0–100'}
              />
              <NumberField
                section="policy"
                name="min_deposit"
                label="มัดจำขั้นต่ำ"
                unit="บาท"
                decimal
                hint="มัดจำไม่ต่ำกว่ายอดนี้ (ไม่เกินยอดสุทธิของงาน) — ไม่มีขั้นต่ำใส่ 0"
              />
              <NumberField
                section="policy"
                name="balance_due_days"
                label="ชำระยอดคงเหลือก่อนวันงาน"
                unit="วัน"
                hint={`0–${MAX_BALANCE_DUE_DAYS} วัน นับจากวันงานวันแรก (0 = ชำระในวันงาน) — ใช้ตั้งวันครบกำหนดงวดสุดท้ายให้อัตโนมัติ`}
              />
              <NumberField
                section="policy"
                name="hold_hours"
                label="ล็อกคิวรอมัดจำได้นาน"
                unit="ชั่วโมง"
                hint={`1–${MAX_HOLD_HOURS} ชม. — หมดเวลาแล้วยังไม่มีเงินเข้า งานกลับเป็น "สอบถาม" คิวว่างให้งานอื่น`}
              />
              <NumberField
                section="policy"
                name="max_jobs_per_day"
                label="รับงานได้สูงสุดต่อวัน"
                unit="งาน"
                hint={`0–${MAX_JOBS_PER_DAY} งาน (0 = ไม่จำกัด) — เกินจำนวนนี้ระบบถามยืนยันก่อนบันทึก และปฏิทินขึ้น "เต็ม"`}
              />
              <NumberField
                section="policy"
                name="overtime_rate"
                label="ค่าล่วงเวลา"
                unit="บาท/ชม."
                decimal
                hint="ใช้คำนวณให้อัตโนมัติตอนเพิ่มค่าล่วงเวลาในงาน (แก้ยอดได้ทุกครั้ง) — ไม่ใช้ใส่ 0"
              />
            </div>
          </SectionCard>
        )}

        {/* ===== เงื่อนไขสัญญา ===== */}
        {tab === 'terms' && (
          <SectionCard
            section="terms"
            icon={FileText}
            title="เงื่อนไขสัญญาจ้าง"
            description="พิมพ์ในสัญญาจ้าง A4 (ฉบับลูกค้าและฉบับผู้ให้บริการ) และแสดงท้ายเอกสาร/หน้าลิงก์ติดตามงานของลูกค้า"
          >
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor="ws-terms_text" className="field-label">เงื่อนไข (1 บรรทัด = 1 ข้อ)</label>
                <textarea
                  id="ws-terms_text"
                  className="input min-h-[320px] leading-relaxed"
                  rows={16}
                  maxLength={TEXT_LIMITS.terms_text}
                  value={form.terms_text}
                  disabled={busy}
                  aria-invalid={errOf('terms', 'terms_text') ? true : undefined}
                  aria-describedby="ws-terms_text-hint"
                  onChange={e => update('terms_text', e.target.value)}
                />
                {errOf('terms', 'terms_text') ? (
                  <FieldError id="ws-terms_text-hint" text={errOf('terms', 'terms_text')} />
                ) : (
                  <p id="ws-terms_text-hint" className="field-hint">
                    ระบบใส่เลขข้อให้เอง (พิมพ์เลขไว้แล้วก็ได้ — เลขจะถูกเรียงใหม่) · บรรทัดว่างไม่นับ ·{' '}
                    <span className="tabular-nums">{clauseCount.toLocaleString('en-US')} ข้อ</span> ·{' '}
                    <span className="tabular-nums">
                      {form.terms_text.length.toLocaleString('en-US')}/{TEXT_LIMITS.terms_text.toLocaleString('en-US')}
                    </span> ตัวอักษร
                  </p>
                )}
              </div>
              <div className="min-w-0 space-y-1">
                <p className="field-label">ตัวอย่างบนสัญญาจ้าง</p>
                <div className="max-h-[460px] overflow-y-auto overscroll-contain">
                  <TermsPreview text={form.terms_text} shopName={shopNameNow} />
                </div>
              </div>
            </div>
          </SectionCard>
        )}

        {/* ===== ข้อความบนเอกสาร ===== */}
        {tab === 'docs' && (
          <SectionCard
            section="docs"
            icon={StickyNote}
            title="ข้อความบนเอกสาร"
            description="ข้อความที่พิมพ์ท้ายรูปเอกสารที่ส่งให้ลูกค้า (ใบยืนยันการจอง ใบเสนอราคา ใบแจ้งชำระเงิน) และท้ายใบเสร็จ"
          >
            <TextField
              section="docs"
              name="booking_note"
              label="ข้อความท้ายเอกสารการจอง"
              rows={4}
              counter
              placeholder="เช่น กรุณาแจ้งกำหนดการและผู้ประสานงานวันงานล่วงหน้าอย่างน้อย 7 วัน / โอนแล้วส่งสลิปทาง LINE"
              hint="ขึ้นบรรทัดใหม่ได้ · เว้นว่าง = ไม่พิมพ์"
            />
            <TextField
              section="docs"
              name="receipt_footer"
              label="ข้อความท้ายใบเสร็จรับเงิน"
              rows={2}
              counter
              placeholder="เช่น ขอบคุณที่ไว้วางใจให้เราดูแลวันสำคัญของคุณ"
              hint="เว้นว่าง = ไม่พิมพ์"
            />
            {(clean(form.booking_note) || clean(form.receipt_footer)) && (
              <div className="space-y-1">
                <p className="field-label">ตัวอย่างท้ายเอกสาร</p>
                <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 text-sm leading-relaxed text-gray-800">
                  {clean(form.booking_note) && (
                    <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
                      <p className="mb-1 text-xs font-semibold text-brand-800">หมายเหตุจากร้าน</p>
                      <p className="whitespace-pre-line break-words">{clean(form.booking_note)}</p>
                    </div>
                  )}
                  {clean(form.receipt_footer) && (
                    <p className="whitespace-pre-line break-words text-center text-gray-600">{clean(form.receipt_footer)}</p>
                  )}
                </div>
              </div>
            )}
          </SectionCard>
        )}

        {/* ===== ลิงก์ลูกค้า ===== */}
        {tab === 'portal' && (
          <SectionCard
            section="portal"
            icon={Link2}
            title="ลิงก์ติดตามงานของคู่บ่าวสาว"
            description="หน้าเว็บของแต่ละงานที่ลูกค้าเปิดดูเองได้โดยไม่ต้องเข้าสู่ระบบ — ส่งลิงก์จากหน้ารายละเอียดงาน"
          >
            <div className="panel p-3">
              <button
                type="button"
                role="switch"
                aria-checked={form.portal_enabled}
                onClick={() => update('portal_enabled', !form.portal_enabled)}
                disabled={busy}
                className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-gray-900">เปิดใช้ลิงก์ติดตามงาน</span>
                  <span className="block text-xs text-gray-500">
                    ปิด = ทุกลิงก์ที่ส่งไปแล้วแสดงข้อความ &quot;ขณะนี้ร้านปิดหน้าติดตามงานชั่วคราว&quot; พร้อมช่องทางติดต่อร้าน (เปิดกลับมาลิงก์เดิมใช้ได้ต่อ)
                  </span>
                </span>
                <span aria-hidden="true" className={clsx('switch', form.portal_enabled && 'switch-on')}>
                  <span className="switch-knob" />
                </span>
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="panel space-y-1.5 p-3 text-sm">
                <p className="font-semibold text-gray-900">ลูกค้าเห็น</p>
                <ul className="list-disc space-y-1 pl-5 text-gray-700">
                  <li>กำหนดการแต่ละคิว เวลา สถานที่ ลิงก์แผนที่ และลำดับพิธี</li>
                  <li>แพ็กเกจ บริการเสริม และรายการงานที่จะได้รับ (ลิงก์ส่งงานเมื่อส่งแล้ว)</li>
                  <li>ยอดชำระ งวด และ QR พร้อมเพย์ของยอดที่ต้องจ่ายตอนนี้</li>
                  <li>ช่องทางติดต่อร้านและเงื่อนไขการให้บริการ</li>
                </ul>
              </div>
              <div className="panel space-y-1.5 p-3 text-sm">
                <p className="font-semibold text-gray-900">ลูกค้าไม่เห็น</p>
                <ul className="list-disc space-y-1 pl-5 text-gray-700">
                  <li>ทีมงาน ค่าตัวทีม และต้นทุน/กำไร</li>
                  <li>หมายเหตุภายในและประวัติการแก้ไข</li>
                  <li>เบอร์โทรเต็ม (แสดงแบบปิดบางหลัก)</li>
                </ul>
              </div>
            </div>
            <p className="field-hint">
              ลิงก์ของแต่ละงานเป็นรหัสสุ่มยาว เดาไม่ได้ — ถ้าส่งผิดคน ให้กด &quot;สร้างลิงก์ใหม่&quot; ในหน้ารายละเอียดงาน ลิงก์เดิมจะใช้ไม่ได้ทันที
            </p>
          </SectionCard>
        )}

        <p className="flex items-start gap-1.5 text-xs text-gray-500">
          <Clock size={14} strokeWidth={1.9} aria-hidden="true" className="mt-px shrink-0" />
          <span className="min-w-0">
            แต่ละแท็บบันทึกแยกกัน — กด &quot;บันทึก&quot; ท้ายแท็บที่แก้ · แท็บที่ยังไม่บันทึกมีจุดสีส้ม · โลโก้บันทึกทันทีที่เลือกรูป
          </span>
        </p>

        <PageToast toast={toast} onClose={() => setToast(null)} />
      </div>
    </SettingsContext.Provider>
  )
}
