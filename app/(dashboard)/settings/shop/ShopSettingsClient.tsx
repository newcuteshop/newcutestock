'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  AlertCircle, Check, Loader2, Printer, ReceiptText, RotateCcw, Save, Store, X,
} from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { bangkokDateKey, formatThaiDateTime, thaiError } from '@/lib/format'
import { FIX04_MISSING_MSG, isMigrationMissing } from '@/lib/migration'
import { parseShopSettings, type ReceiptPaper, type ShopSettings } from '@/lib/pos'
import PrintPortal from '@/components/pos/PrintPortal'
import Receipt, { type ReceiptSale } from '@/components/pos/Receipt'

// ความยาวสูงสุดตรงกับ save_shop_settings (ฐานข้อมูลตรวจซ้ำเสมอ)
const LIMITS = {
  shop_name: 100,
  branch_name: 100,
  address: 300,
  phone: 50,
  tax_id: 20,
  receipt_footer: 300,
} as const

type TextField = keyof typeof LIMITS

interface Form {
  shop_name: string
  branch_name: string
  address: string
  phone: string
  tax_id: string
  receipt_footer: string
  receipt_paper: ReceiptPaper
  show_cashier: boolean
}

type Toast = { ok: boolean; text: string } | null

const PAPER_OPTIONS: { value: ReceiptPaper; label: string; hint: string }[] = [
  { value: '58', label: '58 มม.', hint: 'พิมพ์ได้กว้าง 48 มม.' },
  { value: '80', label: '80 มม.', hint: 'พิมพ์ได้กว้าง 72 มม.' },
]

// สินค้าตัวอย่างในใบเสร็จตัวอย่าง/ทดสอบพิมพ์ (ไม่ใช่ข้อมูลจริง)
const SAMPLE_ITEMS = [
  { name: 'เสื้อยืดคอกลม', size: 'M', color: 'ขาว', qty: 1, price: 290 },
  { name: 'กางเกงยีนส์ขายาว', size: 'L', color: null, qty: 2, price: 450 },
]
const SAMPLE_TOTAL = SAMPLE_ITEMS.reduce((s, it) => s + it.qty * it.price, 0)
const SAMPLE_RECEIVED = Math.ceil(SAMPLE_TOTAL / 100) * 100

function toForm(s: ShopSettings): Form {
  return {
    shop_name: s.shop_name,
    branch_name: s.branch_name ?? '',
    address: s.address ?? '',
    phone: s.phone ?? '',
    tax_id: s.tax_id ?? '',
    receipt_footer: s.receipt_footer ?? '',
    receipt_paper: s.receipt_paper,
    show_cashier: s.show_cashier,
  }
}

// ตัดช่องว่างหัวท้ายแบบเดียวกับฐานข้อมูล (รวม NBSP / zero-width จากการคัดลอก) ; ว่าง = null
function isEdgeSpace(ch: string): boolean {
  const code = ch.charCodeAt(0)
  // zero-width / ตัวกำหนดทิศทาง / ตัวคั่นบรรทัด / BOM ที่ติดมากับการคัดลอก + ช่องว่างทั่วไป
  return (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202f) ||
    (code >= 0x205f && code <= 0x2064) || code === 0xfeff || ch.trim() === ''
}

function clean(v: string): string | null {
  let start = 0
  let end = v.length
  while (start < end && isEdgeSpace(v[start])) start++
  while (end > start && isEdgeSpace(v[end - 1])) end--
  const t = v.slice(start, end)
  return t === '' ? null : t
}

// เลขไทย ๐-๙ → 0-9 (เลขผู้เสียภาษี/เบอร์โทรที่พิมพ์ตอนคีย์บอร์ดเป็นภาษาไทย)
function asciiDigits(v: string): string {
  return v.replace(/[๐-๙]/g, d => String(d.charCodeAt(0) - 0x0e50))
}

// ค่าที่จะส่งให้ save_shop_settings (และใช้เทียบว่าแก้ไขหรือยัง)
function toPayload(f: Form) {
  return {
    shop_name: clean(f.shop_name) ?? '',
    branch_name: clean(f.branch_name),
    address: clean(f.address),
    phone: clean(f.phone),
    tax_id: clean(asciiDigits(f.tax_id)),
    receipt_footer: clean(f.receipt_footer),
    receipt_paper: f.receipt_paper,
    show_cashier: f.show_cashier,
  }
}

// ค่าจากฟอร์ม → ShopSettings สำหรับตัวอย่าง/ทดสอบพิมพ์ (ยังไม่ต้องบันทึก)
function toPreview(f: Form, updatedAt: string | null): ShopSettings {
  const p = toPayload(f)
  return { ...p, shop_name: p.shop_name || 'ชื่อร้าน', updated_at: updatedAt }
}

function validate(f: Form): Partial<Record<TextField, string>> {
  const p = toPayload(f)
  const out: Partial<Record<TextField, string>> = {}
  if (!p.shop_name) out.shop_name = 'กรุณาใส่ชื่อร้าน'
  for (const key of Object.keys(LIMITS) as TextField[]) {
    const v = p[key]
    if (!out[key] && v && v.length > LIMITS[key]) out[key] = `ยาวเกินไป (สูงสุด ${LIMITS[key]} ตัวอักษร)`
  }
  if (!out.tax_id && p.tax_id && !/^[0-9 -]*$/.test(p.tax_id)) out.tax_id = 'เลขผู้เสียภาษีใส่ได้เฉพาะตัวเลข'
  return out
}

// ใบเสร็จตัวอย่าง = ใบเสร็จจริง (components/pos/Receipt) ป้อนบิลตัวอย่าง 2 รายการ — ตัวเลข/การตัดบรรทัดตรงกับที่พิมพ์ขายจริง
// (ทดสอบพิมพ์มีไว้ดูว่ากระดาษ 58/80 มม. ตัดบรรทัดอย่างไร ถ้าวาดคนละแบบจะดูไม่ออก)
// test = พิมพ์ทดสอบ → มีป้าย "ทดสอบการพิมพ์" กันนำไปใช้เป็นใบเสร็จจริง
function ReceiptSample({ shop, at, test = false }: { shop: ShopSettings; at: string | Date; test?: boolean }) {
  const dayKey = bangkokDateKey(at).replace(/-/g, '')
  const sale: ReceiptSale = {
    sale_no: `S-${dayKey || '00000000'}-001`,
    created_at: typeof at === 'string' ? at : at.toISOString(),
    channel: 'store',
    payment_method: 'cash',
    total_amount: SAMPLE_TOTAL,
    discount: 0,
    net_amount: SAMPLE_TOTAL,
    cash_received: SAMPLE_RECEIVED,
    change_amount: SAMPLE_RECEIVED - SAMPLE_TOTAL,
    cashier_name: 'ชื่อพนักงาน',
    items: SAMPLE_ITEMS.map(it => ({
      name: it.name, size: it.size, color: it.color, qty: it.qty, unit_price: it.price, subtotal: it.qty * it.price,
    })),
  }
  return <Receipt shop={shop} sale={sale} test={test} printedAt={at} />
}

function FieldError({ id, text }: { id: string; text?: string }) {
  if (!text) return null
  return <p id={id} role="alert" className="mt-1 text-sm text-red-700">{text}</p>
}

export default function ShopSettingsClient({
  title,
  subtitle,
  initial,
  sampleAt,
}: {
  title: string
  subtitle: string
  initial: ShopSettings
  sampleAt: string // เวลาตัวอย่างบนจอ (มาจากเซิร์ฟเวอร์ — render ฝั่ง server/client ตรงกัน)
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [saved, setSaved] = useState<ShopSettings>(initial)
  const [form, setForm] = useState<Form>(() => toForm(initial))
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<Toast>(null)
  const [printing, setPrinting] = useState(false)
  const [printAt, setPrintAt] = useState('')

  const errors = validate(form)
  const hasErrors = Object.keys(errors).length > 0
  const dirty = JSON.stringify(toPayload(form)) !== JSON.stringify(toPayload(toForm(saved)))
  const preview = toPreview(form, saved.updated_at)
  // ชื่อร้านว่าง: เตือนเมื่อผู้ใช้ลบเอง หรือกดบันทึกแล้ว (เปิดหน้ามาไม่ขึ้นแดงทันที)
  const showError = (key: TextField): string | undefined => {
    const msg = errors[key]
    if (!msg) return undefined
    if (key === 'shop_name' && !submitted && form.shop_name === saved.shop_name) return undefined
    return msg
  }

  // มีการแก้ไขที่ยังไม่บันทึก → เตือนก่อนปิดแท็บ/รีเฟรช
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // โทสต์สำเร็จหายเองใน 4 วินาที
  useEffect(() => {
    if (!toast || !toast.ok) return
    const t = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(t)
  }, [toast])

  const update = useCallback(<K extends keyof Form>(key: K, value: Form[K]) => {
    setForm(f => ({ ...f, [key]: value }))
    setError('')
  }, [])

  function resetForm() {
    setForm(toForm(saved))
    setSubmitted(false)
    setError('')
  }

  async function handleSave() {
    if (savingRef.current) return
    setSubmitted(true)
    if (hasErrors) {
      setError('ข้อมูลบางช่องไม่ถูกต้อง ตรวจช่องที่ขึ้นสีแดงก่อนบันทึก')
      const first = (Object.keys(LIMITS) as TextField[]).find(k => errors[k])
      const el = first ? document.getElementById(`shop-${first}`) : null
      if (el) {
        // เลื่อนช่องที่ผิดมากลางจอ — ไม่ให้ไปจมอยู่ใต้แถบปุ่มบันทึกที่ติดล่างจอ
        el.focus({ preventScroll: true })
        el.scrollIntoView({ block: 'center' })
      }
      return
    }
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      const { data, error: rpcError } = await supabase.rpc('save_shop_settings', { p_settings: toPayload(form) })
      if (rpcError) {
        setError(isMigrationMissing(rpcError) ? FIX04_MISSING_MSG : thaiError(rpcError))
        return
      }
      // ใช้ค่าที่ฐานข้อมูลบันทึกจริง (ตัดช่องว่างแล้ว) เป็นค่าตั้งต้นใหม่ของฟอร์ม
      const next = parseShopSettings(data)
      setSaved(next)
      setForm(toForm(next))
      setSubmitted(false)
      setToast({ ok: true, text: 'บันทึกข้อมูลร้านแล้ว ใบเสร็จใบถัดไปจะใช้ข้อมูลนี้' })
      if (navigator.onLine !== false) router.refresh()
    } catch (err) {
      // บันทึกซ้ำได้ปลอดภัย (ทับค่าเดิมทั้งชุด) — กดบันทึกอีกครั้งได้เลย
      setError(thaiError(err))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  function startTestPrint() {
    if (printing) return
    setPrintAt(new Date().toISOString())
    setPrinting(true)
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{subtitle}</p>
          {saved.updated_at && (
            <p className="mt-1 text-xs tabular-nums text-gray-500">แก้ไขล่าสุด {formatThaiDateTime(saved.updated_at)}</p>
          )}
        </div>
        <div className="page-actions">
          <button type="button" onClick={startTestPrint} className="btn-secondary w-full sm:w-auto">
            <Printer {...ICON_SM} />
            ทดสอบพิมพ์
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:gap-6 lg:flex-row lg:items-start">
        {/* ===== ฟอร์ม ===== */}
        <form
          noValidate
          onSubmit={e => { e.preventDefault(); void handleSave() }}
          className="card min-w-0 lg:flex-1"
          aria-labelledby="shop-form-title"
        >
          <div className="card-header">
            <h2 id="shop-form-title" className="section-title">
              <Store {...ICON} />
              ข้อมูลร้าน
            </h2>
          </div>

          <div className="space-y-4 px-4 py-4 sm:px-5 sm:py-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-x-4">
              <div>
                <label htmlFor="shop-shop_name" className="field-label">ชื่อร้าน *</label>
                <input
                  id="shop-shop_name"
                  className="input"
                  maxLength={LIMITS.shop_name}
                  autoComplete="off"
                  value={form.shop_name}
                  disabled={saving}
                  aria-invalid={showError('shop_name') ? true : undefined}
                  aria-describedby={showError('shop_name') ? 'shop-shop_name-err' : undefined}
                  onChange={e => update('shop_name', e.target.value)}
                />
                <FieldError id="shop-shop_name-err" text={showError('shop_name')} />
              </div>
              <div>
                <label htmlFor="shop-branch_name" className="field-label">ชื่อสาขา</label>
                <input
                  id="shop-branch_name"
                  className="input"
                  maxLength={LIMITS.branch_name}
                  autoComplete="off"
                  placeholder="เช่น สาขาสยาม (เว้นว่างได้)"
                  value={form.branch_name}
                  disabled={saving}
                  aria-invalid={showError('branch_name') ? true : undefined}
                  onChange={e => update('branch_name', e.target.value)}
                />
                <FieldError id="shop-branch_name-err" text={showError('branch_name')} />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="shop-address" className="field-label">ที่อยู่</label>
                <textarea
                  id="shop-address"
                  className="input"
                  rows={3}
                  maxLength={LIMITS.address}
                  value={form.address}
                  disabled={saving}
                  aria-invalid={showError('address') ? true : undefined}
                  aria-describedby="shop-address-hint"
                  onChange={e => update('address', e.target.value)}
                />
                {showError('address')
                  ? <FieldError id="shop-address-hint" text={showError('address')} />
                  : <p id="shop-address-hint" className="field-hint">ขึ้นบรรทัดใหม่ได้ ใบเสร็จจะพิมพ์ตามบรรทัดที่กรอก</p>}
              </div>
              <div>
                <label htmlFor="shop-phone" className="field-label">เบอร์โทร</label>
                <input
                  id="shop-phone"
                  className="input tabular-nums"
                  type="tel"
                  inputMode="tel"
                  maxLength={LIMITS.phone}
                  autoComplete="off"
                  placeholder="เช่น 081-234-5678"
                  value={form.phone}
                  disabled={saving}
                  aria-invalid={showError('phone') ? true : undefined}
                  onChange={e => update('phone', e.target.value)}
                />
                <FieldError id="shop-phone-err" text={showError('phone')} />
              </div>
              <div>
                <label htmlFor="shop-tax_id" className="field-label">เลขประจำตัวผู้เสียภาษี</label>
                <input
                  id="shop-tax_id"
                  className="input tabular-nums"
                  inputMode="numeric"
                  maxLength={LIMITS.tax_id}
                  autoComplete="off"
                  placeholder="13 หลัก (เว้นว่างได้)"
                  value={form.tax_id}
                  disabled={saving}
                  aria-invalid={showError('tax_id') ? true : undefined}
                  aria-describedby="shop-tax_id-hint"
                  onChange={e => update('tax_id', asciiDigits(e.target.value))}
                />
                {showError('tax_id')
                  ? <FieldError id="shop-tax_id-hint" text={showError('tax_id')} />
                  : <p id="shop-tax_id-hint" className="field-hint">ใส่ได้เฉพาะตัวเลข เว้นวรรค และขีด — ไม่มีให้เว้นว่าง</p>}
              </div>
            </div>

            <hr className="divider" />

            <div className="space-y-4">
              <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900">
                <ReceiptText {...ICON_SM} className="text-brand-600" />
                รูปแบบใบเสร็จ
              </h3>

              <fieldset>
                <legend className="field-label">ขนาดกระดาษใบเสร็จ</legend>
                <div className="grid grid-cols-2 gap-2">
                  {PAPER_OPTIONS.map(o => (
                    <button
                      key={o.value}
                      type="button"
                      aria-pressed={form.receipt_paper === o.value}
                      onClick={() => update('receipt_paper', o.value)}
                      disabled={saving}
                      className="choice min-h-[60px]"
                    >
                      <span className="text-base">{o.label}</span>
                      <span className="text-xs font-normal">{o.hint}</span>
                    </button>
                  ))}
                </div>
                <p className="field-hint">
                  ส่วนใหญ่เครื่องพิมพ์ใบเสร็จเป็น 80 มม. — เครื่องพิมพ์ทั่วไป (A4) เลือก 80 มม. ได้ ใบเสร็จจะอยู่กลางหน้ากระดาษ
                </p>
              </fieldset>

              <div className="panel p-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.show_cashier}
                  onClick={() => update('show_cashier', !form.show_cashier)}
                  disabled={saving}
                  className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-gray-900">แสดงชื่อพนักงานขายในใบเสร็จ</span>
                    <span className="block text-xs text-gray-500">พิมพ์ชื่อผู้บันทึกบิลใต้วันที่</span>
                  </span>
                  <span aria-hidden="true" className={clsx('switch', form.show_cashier && 'switch-on')}>
                    <span className="switch-knob" />
                  </span>
                </button>
              </div>

              <div>
                <label htmlFor="shop-receipt_footer" className="field-label">ข้อความท้ายใบเสร็จ</label>
                <textarea
                  id="shop-receipt_footer"
                  className="input"
                  rows={2}
                  maxLength={LIMITS.receipt_footer}
                  placeholder="เช่น ขอบคุณที่อุดหนุนค่ะ / เปลี่ยนสินค้าได้ภายใน 7 วัน พร้อมใบเสร็จ"
                  value={form.receipt_footer}
                  disabled={saving}
                  aria-invalid={showError('receipt_footer') ? true : undefined}
                  aria-describedby="shop-receipt_footer-hint"
                  onChange={e => update('receipt_footer', e.target.value)}
                />
                {showError('receipt_footer')
                  ? <FieldError id="shop-receipt_footer-hint" text={showError('receipt_footer')} />
                  : <p id="shop-receipt_footer-hint" className="field-hint">เว้นว่าง = ไม่พิมพ์ข้อความท้ายใบเสร็จ</p>}
              </div>
            </div>
          </div>

          {/* มือถือ: ข้อความผิดพลาดเต็ม + ปุ่มยกเลิกการแก้ไข อยู่ในเนื้อหาปกติท้ายฟอร์ม (ไม่ติดล่างจอ)
              แถบติดล่างเหลือแค่ปุ่มบันทึก + สถานะ 1 บรรทัด — เดิมแถบสูงราว 30% ของจอและบังช่องที่ต้องแก้ */}
          {(error || dirty) && (
            <div className="space-y-2 px-4 pb-3 sm:hidden">
              {error && (
                <div role="alert" className="alert-err">
                  <AlertCircle {...ICON_SM} />
                  <p className="min-w-0 break-words">{error}</p>
                </div>
              )}
              {dirty && (
                <button type="button" onClick={resetForm} disabled={saving} className="btn-secondary w-full">
                  <RotateCcw {...ICON_SM} />
                  ยกเลิกการแก้ไข
                </button>
              )}
            </div>
          )}

          {/* ปุ่มบันทึก — ติดล่างจอเวลาเลื่อนฟอร์มยาวบนมือถือ */}
          <div
            className="sticky bottom-0 z-10 rounded-b-xl border-t border-gray-200 bg-white px-4 pt-3 sm:px-5"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            {error && (
              <div role="alert" className="alert-err mb-2 hidden sm:flex">
                <AlertCircle {...ICON_SM} />
                <p className="min-w-0 break-words">{error}</p>
              </div>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              {/* มือถือ: ข้อความผิดพลาดย่อ 1 บรรทัด (ข้อความเต็มอยู่ท้ายฟอร์ม เหนือแถบนี้) */}
              {error && (
                <span className="truncate text-center text-xs font-medium text-red-700 sm:hidden" aria-hidden="true">
                  {error}
                </span>
              )}
              {dirty && !saving && (
                <span
                  className={clsx('text-center text-xs text-amber-700 sm:mr-auto sm:text-left', error && 'hidden sm:inline')}
                  aria-live="polite"
                >
                  มีการแก้ไขที่ยังไม่ได้บันทึก
                </span>
              )}
              {dirty && (
                <button type="button" onClick={resetForm} disabled={saving} className="btn-secondary hidden sm:inline-flex sm:w-auto">
                  <RotateCcw {...ICON_SM} />
                  ยกเลิกการแก้ไข
                </button>
              )}
              <button type="submit" disabled={saving || !dirty} className="btn-primary w-full sm:w-auto sm:min-w-[160px]">
                {saving ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Save {...ICON_SM} />}
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </form>

        {/* ===== ตัวอย่างใบเสร็จ (อัปเดตตามที่กรอก ยังไม่ต้องบันทึก) ===== */}
        <section className="card min-w-0 lg:sticky lg:top-4 lg:w-[360px] lg:shrink-0" aria-labelledby="shop-preview-title">
          <div className="card-header">
            <h2 id="shop-preview-title" className="section-title">
              <ReceiptText {...ICON} />
              ตัวอย่างใบเสร็จ
            </h2>
            <span className="chip tabular-nums">{form.receipt_paper} มม.</span>
          </div>
          <div className="space-y-3 p-4 sm:p-5">
            <div className="panel overflow-x-auto px-3 py-4" data-paper={form.receipt_paper}>
              <div className="mx-auto w-fit max-w-full rounded-md border border-gray-200 bg-white px-3 py-4">
                <ReceiptSample shop={preview} at={sampleAt} />
              </div>
            </div>
            <p className="text-xs text-gray-500">
              ตัวอย่างบนจอ ขนาดตัวอักษรจริงขึ้นกับเครื่องพิมพ์ — กด &quot;ทดสอบพิมพ์&quot; เพื่อลองพิมพ์ตามค่าที่กรอกอยู่ (ยังไม่ต้องบันทึก)
            </p>
            <button type="button" onClick={startTestPrint} className="btn-secondary w-full">
              <Printer {...ICON_SM} />
              ทดสอบพิมพ์
            </button>
          </div>
        </section>
      </div>

      <PrintPortal open={printing} paper={form.receipt_paper} onDone={() => setPrinting(false)}>
        <ReceiptSample shop={preview} at={printAt || sampleAt} test />
      </PrintPortal>

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
  )
}
