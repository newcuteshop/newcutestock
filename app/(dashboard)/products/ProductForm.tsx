'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { baht, productLabel, thaiError, variantText } from '@/lib/format'
import { isPrintableAscii, normalizeScannedCode } from '@/lib/barcode'
import BarcodeScanner from '@/components/BarcodeScanner'
import {
  AlertTriangle, ArrowRight, Camera, Check, CheckCircle2, Coins, Eye, Info, Loader2, Package, PauseCircle,
  Plus, Save, Shirt, Trash2, XCircle,
} from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'

interface Category { id: string; name: string }
interface ProductFormProps {
  categories: Category[]
  product?: {
    id: string; name: string; sku: string; barcode?: string | null
    category_id?: string | null; size?: string | null; color?: string | null
    cost_price: number; sell_price: number; min_stock: number
    stock_qty?: number | null
    is_active?: boolean | null
  }
}

type FormState = {
  name: string; sku: string; barcode: string; category_id: string
  size: string; color: string
  cost_price: string; sell_price: string; min_stock: string
}

// ห้ามมี stock_qty — สต๊อกเปลี่ยนได้ผ่าน RPC move_stock / record_sale เท่านั้น
type ProductPayload = {
  name: string; sku: string; barcode: string | null; category_id: string | null
  size: string | null; color: string | null
  cost_price: number; sell_price: number; min_stock: number
}

const MAX_MONEY = 99999999.99 // numeric(10,2)
const MAX_MIN_STOCK = 1000000

// '' = ไม่ได้กรอก, NaN = ไม่ใช่ตัวเลข
function parseMoney(raw: string): number | null {
  const s = raw.trim().replace(/,/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN
}

function errorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) return String((err as { code: unknown }).code ?? '')
  return ''
}

function validate(form: FormState): { payload: ProductPayload } | { error: string } {
  const name = form.name.trim()
  if (!name) return { error: 'กรุณากรอกชื่อสินค้า' }
  if (name.length > 200) return { error: 'ชื่อสินค้ายาวเกินไป (สูงสุด 200 ตัวอักษร)' }

  const sku = form.sku.trim()
  if (!sku) return { error: 'กรุณากรอก SKU' }
  if (!isPrintableAscii(sku)) return { error: 'SKU ต้องเป็นตัวอักษรอังกฤษ ตัวเลข หรือสัญลักษณ์ เท่านั้น' }

  // สแกนเข้าช่องนี้ตอนคีย์บอร์ดเป็นภาษาไทย → แปลงกลับเป็นรหัสภาษาอังกฤษให้
  const barcode = normalizeScannedCode(form.barcode)
  if (barcode && !isPrintableAscii(barcode)) {
    return { error: 'บาร์โค้ดต้องเป็นตัวอักษรอังกฤษ ตัวเลข หรือสัญลักษณ์ เท่านั้น' }
  }

  const sell = parseMoney(form.sell_price)
  if (sell === null) return { error: 'กรุณากรอกราคาขาย' }
  if (Number.isNaN(sell) || sell < 0) return { error: 'ราคาขายต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป' }
  if (sell > MAX_MONEY) return { error: 'ราคาขายสูงเกินไป' }

  const cost = parseMoney(form.cost_price) ?? 0
  if (Number.isNaN(cost) || cost < 0) return { error: 'ราคาทุนต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป' }
  if (cost > MAX_MONEY) return { error: 'ราคาทุนสูงเกินไป' }

  const minRaw = form.min_stock.trim()
  if (minRaw && !/^\d+$/.test(minRaw)) return { error: 'จำนวนขั้นต่ำต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป' }
  const minStock = minRaw ? Number(minRaw) : 0
  if (minStock > MAX_MIN_STOCK) return { error: 'จำนวนขั้นต่ำสูงเกินไป' }

  return {
    payload: {
      name,
      sku,
      barcode: barcode || null,
      category_id: form.category_id || null,
      size: form.size.trim() || null,
      color: form.color.trim() || null,
      cost_price: cost,
      sell_price: sell,
      min_stock: minStock,
    },
  }
}

export default function ProductForm({ categories, product }: ProductFormProps) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deactivating, setDeactivating] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [canDeactivate, setCanDeactivate] = useState(false)
  const [isActive, setIsActive] = useState(product?.is_active !== false)
  const [showScanner, setShowScanner] = useState(false)

  const [form, setForm] = useState<FormState>(() => ({
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    category_id: product?.category_id ?? '',
    size: product?.size ?? '',
    color: product?.color ?? '',
    cost_price: product ? String(product.cost_price ?? 0) : '',
    sell_price: product ? String(product.sell_price ?? '') : '',
    min_stock: String(product?.min_stock ?? 5),
  }))

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm(f => ({ ...f, [field]: value }))
  }

  const busy = loading || deleting || deactivating
  const normalizedBarcode = normalizeScannedCode(form.barcode)
  const barcodeConverted = !!normalizedBarcode && normalizedBarcode !== form.barcode.trim()
  const sellN = parseMoney(form.sell_price)
  const costN = parseMoney(form.cost_price)
  const sellBelowCost = sellN !== null && costN !== null && !Number.isNaN(sellN) && !Number.isNaN(costN) && sellN < costN

  // ตัวอย่างการ์ดสินค้าในหน้าขาย (แสดงเฉพาะคอมจอกว้าง) — คำนวณจากค่าในฟอร์มล้วน ไม่ดึงข้อมูลเพิ่ม
  const previewName = form.name.trim()
  const previewVariant = variantText(form)
  const previewSku = form.sku.trim()
  const previewSellOk = sellN !== null && !Number.isNaN(sellN) && sellN >= 0
  const previewCost = costN ?? 0 // ช่องทุนว่าง = บันทึกเป็น 0 เหมือน validate()
  const previewStock = typeof product?.stock_qty === 'number' ? product.stock_qty : 0
  const previewCategory = categories.find(c => c.id === form.category_id)?.name ?? ''
  const previewCode = normalizedBarcode || previewSku // สติกเกอร์ใช้บาร์โค้ดก่อน ไม่มีค่อยใช้ SKU
  const previewProfit = previewSellOk && !Number.isNaN(previewCost) && previewCost >= 0
    ? Math.round(((sellN ?? 0) - previewCost) * 100) / 100
    : null
  const previewMargin = previewProfit !== null && sellN !== null && sellN > 0
    ? Math.round((previewProfit / sellN) * 100)
    : null

  function normalizeBarcodeField() {
    setForm(f => ({ ...f, barcode: normalizeScannedCode(f.barcode) }))
  }

  function handleScan(code: string) {
    if (!code) return { ok: false, message: 'อ่านบาร์โค้ดไม่ได้ ลองใหม่อีกครั้ง' }
    if (!isPrintableAscii(code)) return { ok: false, message: 'บาร์โค้ดนี้มีตัวอักษรที่ใช้ไม่ได้' }
    set('barcode', code)
    return { ok: true, message: `ได้บาร์โค้ด ${code}` }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // กัน submit ที่ bubble มาจากฟอร์มอื่น (เช่น ช่องพิมพ์รหัสในหน้าต่างสแกน)
    if (e.target !== e.currentTarget) return
    if (busy || saved) return
    setError('')
    setNotice('')
    setCanDeactivate(false)

    const result = validate(form)
    if ('error' in result) { setError(result.error); return }
    const payload = result.payload
    // แสดงบาร์โค้ดที่แปลงแล้วในช่องด้วย ให้เห็นว่าจะบันทึกค่าอะไร
    setForm(f => ({ ...f, barcode: payload.barcode ?? '' }))

    setLoading(true)
    try {
      if (product?.id) {
        const { data, error } = await supabase
          .from('products')
          .update(payload)
          .eq('id', product.id)
          .select('id')
        if (error) throw error
        // RLS ไม่ให้แก้ = ไม่มี error แต่ไม่มีแถวถูกแก้
        if (!data || data.length === 0) throw new Error('ไม่มีสิทธิ์ทำรายการนี้ หรือสินค้านี้ถูกลบไปแล้ว')
      } else {
        const { error } = await supabase.from('products').insert(payload)
        if (error) throw error
      }
      setSaved(true)
      router.push('/products')
      router.refresh()
    } catch (err: unknown) {
      setError(thaiError(err))
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (!product?.id || busy) return
    const label = productLabel(product)
    if (!confirm(
      `ยืนยันลบสินค้า "${label}"?\n\n` +
      '* ประวัติรับ-จ่ายสต๊อกของสินค้านี้จะถูกลบด้วย\n' +
      '* ถ้าเคยขายไปแล้วจะลบไม่ได้ — ให้ปิดใช้งานแทน'
    )) return

    setDeleting(true)
    setError('')
    setNotice('')
    setCanDeactivate(false)
    try {
      const { data, error } = await supabase
        .from('products')
        .delete()
        .eq('id', product.id)
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) throw new Error('ไม่มีสิทธิ์ทำรายการนี้ หรือสินค้านี้ถูกลบไปแล้ว')
      router.push('/products')
      router.refresh()
    } catch (err: unknown) {
      setError(thaiError(err))
      // มีประวัติการขายอ้างอิง → เสนอปุ่มปิดใช้งานแทน
      if (errorCode(err) === '23503' && isActive) setCanDeactivate(true)
      setDeleting(false)
    }
  }

  async function handleDeactivate() {
    if (!product?.id || busy) return
    setDeactivating(true)
    setError('')
    try {
      const { data, error } = await supabase
        .from('products')
        .update({ is_active: false })
        .eq('id', product.id)
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) throw new Error('ไม่มีสิทธิ์ทำรายการนี้ หรือสินค้านี้ถูกลบไปแล้ว')
      setIsActive(false)
      setCanDeactivate(false)
      setNotice('ปิดใช้งานสินค้านี้แล้ว (ประวัติการขายยังอยู่ครบ)')
      router.refresh()
    } catch (err: unknown) {
      setError(thaiError(err))
    } finally {
      setDeactivating(false)
    }
  }

  return (
    <>
      {/* คอมจอกว้าง (xl+): ฟอร์มเต็มความกว้าง + แผงตัวอย่างด้านขวา / มือถือ-iPad: ฟอร์มอย่างเดียวเหมือนเดิม */}
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_18rem] 2xl:grid-cols-[minmax(0,1fr)_20rem] xl:gap-6 xl:items-start">
        <form onSubmit={handleSubmit} noValidate className="card p-4 sm:p-6 space-y-5 min-w-0">
          {/* ส่วนที่ 1: ข้อมูลสินค้า (ลำดับช่องเหมือนเดิม — กด Tab ไล่ตามเดิม) */}
          <div role="group" aria-labelledby="pf-sec-info" className="space-y-4">
            <h2 id="pf-sec-info" className="section-title">
              <span className="icon-bubble icon-bubble-sm"><Shirt {...ICON_SM} /></span>
              ข้อมูลสินค้า
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="pf-name" className="block text-sm font-medium text-gray-700 mb-1">ชื่อสินค้า *</label>
                <input id="pf-name" className="input" maxLength={200} value={form.name}
                  onChange={e => set('name', e.target.value)} />
              </div>
              <div>
                <label htmlFor="pf-sku" className="block text-sm font-medium text-gray-700 mb-1">SKU *</label>
                <input id="pf-sku" className="input" value={form.sku}
                  autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                  onChange={e => set('sku', e.target.value)} placeholder="เช่น SHIRT-001" />
                <p className="text-xs text-gray-500 mt-1">ภาษาอังกฤษ ตัวเลข หรือสัญลักษณ์ (เช่น - _ /)</p>
              </div>
              <div>
                <label htmlFor="pf-barcode" className="block text-sm font-medium text-gray-700 mb-1">บาร์โค้ด</label>
                <div className="flex gap-2">
                  <input id="pf-barcode" className="input flex-1 min-w-0" value={form.barcode}
                    autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    placeholder="สแกนหรือพิมพ์ (ไม่บังคับ)"
                    onChange={e => set('barcode', e.target.value)}
                    onBlur={normalizeBarcodeField}
                    onKeyDown={e => {
                      // เครื่องสแกนกด Enter ท้ายรหัส — ไม่ให้ส่งฟอร์มทันที
                      if (e.key === 'Enter') { e.preventDefault(); normalizeBarcodeField() }
                    }} />
                  <button type="button" onClick={() => setShowScanner(true)}
                    className="btn-icon" aria-label="สแกนบาร์โค้ดด้วยกล้อง">
                    <Camera {...ICON} />
                  </button>
                </div>
                {barcodeConverted && (
                  <p className="text-xs text-amber-700 mt-1 break-all">จะบันทึกเป็น: <span className="font-mono">{normalizedBarcode}</span></p>
                )}
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="pf-category" className="block text-sm font-medium text-gray-700 mb-1">หมวดหมู่</label>
                <select id="pf-category" className="input" value={form.category_id} onChange={e => set('category_id', e.target.value)}>
                  <option value="">-- เลือกหมวดหมู่ --</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="pf-size" className="block text-sm font-medium text-gray-700 mb-1">ไซส์</label>
                <input id="pf-size" className="input" value={form.size} onChange={e => set('size', e.target.value)} placeholder="S, M, L, XL..." />
              </div>
              <div>
                <label htmlFor="pf-color" className="block text-sm font-medium text-gray-700 mb-1">สี</label>
                <input id="pf-color" className="input" value={form.color} onChange={e => set('color', e.target.value)} placeholder="ขาว, ดำ, แดง..." />
              </div>
            </div>
          </div>

          <div className="divider-dotted" aria-hidden="true" />

          {/* ส่วนที่ 2: ราคาและสต๊อก */}
          <div role="group" aria-labelledby="pf-sec-price" className="space-y-4">
            <h2 id="pf-sec-price" className="section-title">
              <span className="icon-bubble icon-bubble-sm"><Coins {...ICON_SM} /></span>
              ราคาและสต๊อก
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label htmlFor="pf-cost" className="block text-sm font-medium text-gray-700 mb-1">ราคาทุน (฿)</label>
                <input id="pf-cost" className="input tabular-nums" type="number" inputMode="decimal" min="0" step="0.01"
                  placeholder="0" value={form.cost_price} onChange={e => set('cost_price', e.target.value)} />
              </div>
              <div>
                <label htmlFor="pf-sell" className="block text-sm font-medium text-gray-700 mb-1">ราคาขาย (฿) *</label>
                <input id="pf-sell" className="input tabular-nums" type="number" inputMode="decimal" min="0" step="0.01"
                  value={form.sell_price} onChange={e => set('sell_price', e.target.value)} />
                {sellBelowCost && (
                  <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700">
                    <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
                    ราคาขายต่ำกว่าราคาทุน
                  </p>
                )}
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <label htmlFor="pf-min" className="block text-sm font-medium text-gray-700 mb-1">จำนวนขั้นต่ำ (แจ้งเตือน)</label>
                <input id="pf-min" className="input tabular-nums" type="number" inputMode="numeric" min="0" step="1"
                  value={form.min_stock} onChange={e => set('min_stock', e.target.value)} />
              </div>
            </div>

            {/* สต๊อกแก้ในหน้านี้ไม่ได้ — ต้องผ่านหน้า รับ-จ่ายสต๊อก */}
            {!product?.id ? (
              <div className="alert-info">
                <Info {...ICON_SM} />
                <div className="min-w-0">
                  <p>สต๊อกเริ่มต้นเป็น 0 — รับสินค้าเข้าได้ที่หน้า รับ-จ่ายสต๊อก</p>
                  <Link href="/stock?action=in" className="link text-sm">
                    ไปหน้ารับสินค้าเข้า
                    <ArrowRight {...ICON_SM} />
                  </Link>
                  <span className="block text-xs text-brand-700">(บันทึกสินค้านี้ก่อน แล้วค่อยรับเข้า)</span>
                </div>
              </div>
            ) : typeof product.stock_qty === 'number' ? (
              <div className="panel flex items-start gap-2.5 px-3.5 py-2.5 text-sm text-gray-600">
                <Package {...ICON_SM} className="mt-0.5 text-brand-600" />
                {/* ลิงก์แยกบรรทัด พื้นที่แตะ 44px (แบบเดียวกับกล่องตอนเพิ่มสินค้าใหม่) */}
                <div className="min-w-0">
                  <p>
                    สต๊อกปัจจุบัน <span className="font-display font-bold tabular-nums text-gray-900">{product.stock_qty}</span> ชิ้น — ปรับยอดได้ที่หน้า
                  </p>
                  <Link href="/stock" className="link text-sm">
                    รับ-จ่ายสต๊อก
                    <ArrowRight {...ICON_SM} />
                  </Link>
                </div>
              </div>
            ) : null}
          </div>

          {!isActive && product?.id && (
            <div className="panel flex items-start gap-2.5 px-3.5 py-2.5 text-sm text-gray-600">
              <PauseCircle {...ICON_SM} className="mt-0.5 text-gray-500" />
              <p className="min-w-0">สินค้านี้ปิดใช้งานอยู่ — เปิดใช้งานได้ที่หน้ารายการสินค้า</p>
            </div>
          )}

          {error && (
            <div role="alert" className="alert-err">
              <XCircle {...ICON_SM} />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="break-words">{error}</p>
                {canDeactivate && (
                  <button type="button" onClick={handleDeactivate} disabled={busy}
                    className="btn-secondary w-full sm:w-auto">
                    {deactivating
                      ? <><Loader2 {...ICON_SM} className="animate-spin" />กำลังปิดใช้งาน...</>
                      : <><PauseCircle {...ICON_SM} />ปิดใช้งานสินค้านี้แทน</>}
                  </button>
                )}
              </div>
            </div>
          )}
          {notice && (
            <div role="status" className="alert-ok">
              <CheckCircle2 {...ICON_SM} />
              <p className="min-w-0">{notice}</p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-brand-100">
            <button type="submit" disabled={busy || saved} className="btn-primary w-full sm:w-auto">
              {saved
                ? <><Check {...ICON_SM} />บันทึกแล้ว</>
                : loading
                  ? <><Loader2 {...ICON_SM} className="animate-spin" />กำลังบันทึก...</>
                  : product
                    ? <><Save {...ICON_SM} />บันทึกการแก้ไข</>
                    : <><Plus {...ICON_SM} />เพิ่มสินค้า</>}
            </button>
            <Link href="/products" className="btn-secondary w-full sm:w-auto">
              ยกเลิก
            </Link>
            {product?.id && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy || saved}
                className="btn-danger-soft w-full sm:w-auto sm:ml-auto"
              >
                {deleting
                  ? <><Loader2 {...ICON_SM} className="animate-spin" />กำลังลบ...</>
                  : <><Trash2 {...ICON_SM} />ลบสินค้านี้</>}
              </button>
            )}
          </div>
        </form>

        {/* ตัวอย่างการ์ดในหน้าขาย — หน้าตาเดียวกับการ์ดสินค้าในหน้า บันทึกการขาย */}
        <aside aria-label="ตัวอย่างสินค้า" className="hidden xl:block xl:sticky xl:top-0 card p-5 space-y-4 min-w-0">
          <div>
            <h2 className="section-title sm:text-base">
              <Eye {...ICON_SM} className="text-brand-600" />
              ตัวอย่างในหน้าขาย
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">อัปเดตตามที่กรอกทันที</p>
          </div>

          {/* เวทีโชว์การ์ด: พื้นบลัชลายจุดนม ขอบล่างหยักแบบลูกไม้ (เหมือนการ์ดสินค้าในแบบธีม 16) */}
          <div className="scallop-bottom rounded-t-3xl bg-blush-soft dots-bg px-4 pt-4 pb-6 flex justify-center">
            <div className="card relative w-full max-w-[13rem] min-h-[72px] p-3 text-left">
              <p className={`font-display font-semibold text-sm leading-snug line-clamp-2 break-words ${previewName ? 'text-gray-900' : 'text-gray-400'}`}>
                {previewName || 'ชื่อสินค้า'}
              </p>
              {previewVariant && <span className="chip mt-1 max-w-full"><span className="truncate">{previewVariant}</span></span>}
              <p className={`text-xs mt-1 truncate ${previewSku ? 'text-gray-500' : 'text-gray-400'}`}>{previewSku || 'SKU'}</p>
              <div className="mt-2 flex items-end justify-between gap-1">
                <span className={`money text-lg leading-tight ${previewSellOk ? 'text-brand-600' : 'text-gray-400'}`}>
                  {previewSellOk ? baht(sellN) : '฿ —'}
                </span>
                <span className={`inline-flex items-center gap-1 text-xs ${previewStock <= 0 ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                  <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${previewStock <= 0 ? 'bg-red-600' : 'bg-strawberry'}`} />
                  คงเหลือ {previewStock}
                </span>
              </div>
            </div>
          </div>

          <dl className="text-sm divide-y divide-brand-100">
            <div className="flex items-start justify-between gap-3 py-2">
              <dt className="text-gray-500 shrink-0">หมวดหมู่</dt>
              <dd className="text-gray-900 text-right min-w-0 break-words">{previewCategory || '-'}</dd>
            </div>
            <div className="flex items-start justify-between gap-3 py-2">
              <dt className="text-gray-500 shrink-0">รหัสบนสติกเกอร์</dt>
              <dd className="text-gray-900 text-right min-w-0 font-mono break-all">{previewCode || '-'}</dd>
            </div>
            <div className="flex items-start justify-between gap-3 py-2">
              <dt className="text-gray-500 shrink-0">กำไรต่อชิ้น</dt>
              <dd className={`text-right min-w-0 font-display font-semibold tabular-nums ${
                previewProfit === null ? 'text-gray-400' : previewProfit < 0 ? 'text-red-600' : 'text-green-700'
              }`}>
                {previewProfit === null ? '-' : baht(previewProfit)}
                {previewMargin !== null && <span className="font-sans text-xs font-normal text-gray-400"> ({previewMargin}%)</span>}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3 py-2">
              <dt className="text-gray-500 shrink-0">แจ้งเตือนเมื่อเหลือ</dt>
              <dd className="text-gray-900 text-right min-w-0 break-words">{form.min_stock.trim() || '0'} ชิ้น</dd>
            </div>
          </dl>
        </aside>
      </div>

      {/* อยู่นอก <form> — หน้าต่างสแกนมีฟอร์มของตัวเอง ห้ามซ้อนกัน */}
      {showScanner && (
        <BarcodeScanner
          title="สแกนบาร์โค้ดสินค้า"
          onScan={handleScan}
          onClose={() => setShowScanner(false)}
          closeOnSuccess
        />
      )}
    </>
  )
}
