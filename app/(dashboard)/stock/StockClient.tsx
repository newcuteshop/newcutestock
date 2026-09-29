'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import BarcodeScanner from '@/components/BarcodeScanner'
import { productLabel, variantText, thaiError, formatThaiDateTime } from '@/lib/format'
import { codeCandidates, findByCode, normalizeScannedCode } from '@/lib/barcode'

export type MoveType = 'in' | 'out' | 'adjust' | 'return'

export interface StockProduct {
  id: string
  name: string
  sku: string
  barcode: string | null
  size: string | null
  color: string | null
  stock_qty: number
}

export interface StockMovementRow {
  id: string
  type: string
  qty: number
  qty_before: number | null
  qty_after: number | null
  note: string | null
  created_at: string
  products: { name: string; sku: string; size: string | null; color: string | null } | null
}

// ผลลัพธ์จาก RPC move_stock
interface MoveResult {
  id: string
  product_id: string
  type: MoveType
  qty: number
  qty_before: number
  qty_after: number
  note: string | null
  created_at: string
}

const TYPES: { value: MoveType; label: string; icon: string; active: string; hint: string }[] = [
  { value: 'in', label: 'รับเข้า', icon: '📥', active: 'bg-green-600 border-green-600 text-white', hint: 'เพิ่มสต๊อก เช่น รับของจากซัพพลายเออร์' },
  { value: 'out', label: 'จ่ายออก', icon: '📤', active: 'bg-red-600 border-red-600 text-white', hint: 'ตัดสต๊อก เช่น ของเสีย ของแถม (การขายให้บันทึกที่หน้าขาย)' },
  { value: 'adjust', label: 'ปรับยอด', icon: '🔧', active: 'bg-blue-600 border-blue-600 text-white', hint: 'ตั้งยอดคงเหลือให้ตรงกับจำนวนที่นับได้จริง' },
  { value: 'return', label: 'รับคืน', icon: '↩️', active: 'bg-amber-500 border-amber-500 text-white', hint: 'ลูกค้าคืนสินค้า เพิ่มกลับเข้าสต๊อก' },
]

const TYPE_LABELS: Record<string, string> = {
  in: 'รับเข้า', out: 'จ่ายออก', adjust: 'ปรับยอด', return: 'รับคืน'
}
const TYPE_BADGE: Record<string, string> = {
  in: 'badge-in', out: 'badge-out', adjust: 'badge-adjust', return: 'badge-return'
}

const MAX_RESULTS = 8
// กันเลขบาร์โค้ดที่สแกนหลุดเข้าช่องจำนวน (เช่น EAN 13 หลัก) กลายเป็นยอดมหาศาล
const MAX_QTY = 99999
// move_stock ไม่มีรหัสกันบันทึกซ้ำ → ไม่รู้ผลต้องให้ไปดูประวัติก่อน และล้างจำนวนกันกดบันทึกซ้ำโดยไม่ตั้งใจ
const UNSURE_MSG = 'ไม่แน่ใจว่าบันทึกสำเร็จหรือไม่ (เน็ตหลุดระหว่างส่ง) — ดูรายการบนสุดใน "ประวัติการเคลื่อนไหว" ก่อน ถ้ายังไม่มีค่อยกรอกจำนวนแล้วกดบันทึกอีกครั้ง'

function num(n: number): string {
  return n.toLocaleString('en-US')
}

// +5 / -3 / 0
function signed(n: number): string {
  if (n > 0) return '+' + num(n)
  if (n < 0) return '-' + num(Math.abs(n))
  return '0'
}

function changeColor(n: number | null): string {
  if (n === null || n === 0) return 'text-gray-400'
  return n > 0 ? 'text-green-600' : 'text-red-600'
}

function toNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

// แปลงเลขไทย ๐-๙ และตัวอักษรที่พิมพ์ตอนคีย์บอร์ดค้างภาษาไทย (ๅ/-ภถุึคตจ) กลับเป็นตัวเลข
function toAsciiDigits(text: string): string {
  const thaiDigits = text.replace(/[๐-๙]/g, d => String(d.charCodeAt(0) - 0x0e50))
  return /[฀-๿]/.test(thaiDigits) ? normalizeScannedCode(thaiDigits) : thaiDigits
}

// error มาจากเซิร์ฟเวอร์จริง (มีรหัสของ Postgres/PostgREST) = ฐานข้อมูลยกเลิกรายการนี้แล้ว ไม่ได้บันทึกแน่นอน
// ไม่มีรหัส = เน็ตหลุด/หมดเวลา/เกตเวย์ตอบหน้า HTML → อาจบันทึกไปแล้วก็ได้
function serverAnswered(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  if (typeof code !== 'string') return false
  return /^PGRST\d+$/.test(code) || /^(?!E)[0-9A-Z]{5}$/.test(code)
}

function negativeBaseText(before: number): string {
  return `สต๊อกในระบบติดลบอยู่ (${num(before)} ชิ้น) — ใช้ "ปรับยอด" ให้ตรงกับของที่นับได้จริงก่อน`
}

function parseQty(text: string): number | null {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return Number.isSafeInteger(n) ? n : null
}

export default function StockClient({ products, movements, initialType }: {
  products: StockProduct[]; movements: StockMovementRow[]; initialType: MoveType
}) {
  const router = useRouter()
  const [productId, setProductId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [pickMsg, setPickMsg] = useState('')
  const [type, setType] = useState<MoveType>(initialType)
  const [qtyText, setQtyText] = useState(initialType === 'adjust' ? '' : '1')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [lastSavedId, setLastSavedId] = useState<string | null>(null)
  const [showScanner, setShowScanner] = useState(false)
  const savingRef = useRef(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const qtyRef = useRef<HTMLInputElement>(null)

  // อ่านจาก props ตรงๆ — router.refresh() แล้วยอดคงเหลือใหม่ขึ้นทันที
  const selected = productId ? products.find(p => p.id === productId) : undefined

  // เปลี่ยน ?action= ขณะอยู่หน้านี้ (เช่นกดจากเมนู) → เปลี่ยนประเภทตาม
  const prevInitialType = useRef(initialType)
  useEffect(() => {
    if (prevInitialType.current === initialType) return
    prevInitialType.current = initialType
    setType(initialType)
    setQtyText(initialType === 'adjust' ? '' : '1')
  }, [initialType])

  // กลับมาที่แอป/แท็บนี้ หรือเน็ตกลับมา → ดึงยอดล่าสุด (อาจมีคนอื่นขายหรือรับของไปแล้ว)
  // ออฟไลน์อยู่ห้าม refresh: Next 14 จะโหลดทั้งหน้าใหม่ กลายเป็นหน้า "ไม่มีอินเทอร์เน็ต" ฟอร์มที่กรอกไว้หายหมด
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'visible' && navigator.onLine !== false) router.refresh()
    }
    function onOnline() {
      router.refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
    }
  }, [router])

  // ===== ค้นหาสินค้า =====
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    const tokens = q.split(/\s+/).filter(Boolean)
    const codes = codeCandidates(search).map(c => c.toLowerCase())
    const filtered = products.filter(p => {
      const hay = `${p.name} ${p.sku} ${p.barcode ?? ''} ${variantText(p)}`.toLowerCase()
      if (tokens.every(t => hay.includes(t))) return true
      // พิมพ์/สแกนตอนคีย์บอร์ดเป็นภาษาไทย → ลองเทียบกับ SKU/บาร์โค้ดที่แปลงกลับแล้ว
      const sku = p.sku.toLowerCase()
      const bc = (p.barcode ?? '').toLowerCase()
      return codes.some(c => sku.includes(c) || (bc !== '' && bc.includes(c)))
    })
    // รหัสตรงเป๊ะขึ้นก่อน
    const exact = findByCode(products, search)
    return exact ? [exact, ...filtered.filter(p => p.id !== exact.id)] : filtered
  }, [products, search])

  function selectProduct(p: StockProduct) {
    setProductId(p.id)
    setSearch('')
    setPickMsg('')
    setError('')
    // เลือกแล้วไปกรอกจำนวนต่อได้เลย
    setTimeout(() => {
      qtyRef.current?.focus()
      qtyRef.current?.select()
    }, 0)
  }

  function changeProduct() {
    setProductId(null)
    setSearch('')
    setPickMsg('')
    setError('')
    setSuccess('')
    setTimeout(() => searchRef.current?.focus(), 0)
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    if (!search.trim()) return
    // เครื่องสแกน USB พิมพ์รหัสแล้วกด Enter
    const exact = findByCode(products, search)
    if (exact) { selectProduct(exact); return }
    if (matches.length === 1) { selectProduct(matches[0]); return }
    setPickMsg(matches.length === 0
      ? `ไม่พบสินค้า: ${search.trim()}`
      : `พบ ${num(matches.length)} รายการ — แตะเลือกสินค้าจากรายการด้านล่าง`)
  }

  function handleScan(code: string): { ok: boolean; message: string } {
    const p = findByCode(products, code)
    if (!p) return { ok: false, message: `ไม่พบสินค้า: ${code}` }
    selectProduct(p)
    return { ok: true, message: `เลือก: ${productLabel(p)}` }
  }

  // ===== ประเภท / จำนวน =====
  function changeType(t: MoveType) {
    if (t === type) return
    setType(t)
    setError('')
    // ปรับยอดต้องกรอกยอดนับจริงเอง กันกดบันทึกด้วยค่าเดิมแล้วสต๊อกกลายเป็น 1
    if (t === 'adjust') setQtyText('')
    else if (type === 'adjust' || parseQty(qtyText) === null || parseQty(qtyText) === 0) setQtyText('1')
  }

  function handleQtyChange(value: string) {
    const conv = toAsciiDigits(value)
    setQtyText(/^\d*$/.test(conv) ? conv : value)
    setError('')
  }

  const minQty = type === 'adjust' ? 0 : 1
  const qty = parseQty(qtyText)
  const qtyEmpty = qtyText.trim() === ''
  const qtyProblem = qtyEmpty ? ''
    : qty === null ? 'กรอกเป็นตัวเลขจำนวนเต็มเท่านั้น'
    : qty < minQty ? 'จำนวนต้องมากกว่า 0'
    : qty > MAX_QTY ? `จำนวนมากผิดปกติ (เกิน ${num(MAX_QTY)}) ตรวจสอบอีกครั้ง`
    : ''
  const qtyOk = qty !== null && !qtyProblem

  function stepQty(delta: number) {
    const base = qty ?? (type === 'adjust' ? (selected?.stock_qty ?? 0) : 0)
    const next = Math.min(MAX_QTY, Math.max(minQty, base + delta))
    setQtyText(String(next))
    setError('')
  }

  // ยอดหลังทำรายการ (พรีวิว) — เซิร์ฟเวอร์คำนวณจริงอีกครั้งตอนบันทึก
  const before = selected?.stock_qty ?? 0
  const after: number | null = !selected || !qtyOk || qty === null ? null
    : type === 'in' || type === 'return' ? before + qty
    : type === 'out' ? before - qty
    : qty
  const insufficient = after !== null && after < 0
  // สต๊อกติดลบค้างจากระบบเก่า → ต้องปรับยอดก่อน (บอกแค่ "สต๊อกไม่พอ มี -5 ชิ้น" ผู้ใช้ไม่รู้ต้องทำอะไร)
  const negativeBase = before < 0 && type !== 'adjust'
  const canSubmit = !!selected && qtyOk && after !== null && !insufficient && !saving
  const typeInfo = TYPES.find(t => t.value === type) ?? TYPES[0]

  // ===== บันทึก =====
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (savingRef.current) return
    if (!selected) { setError('กรุณาเลือกสินค้าก่อน'); return }
    if (qty === null || !qtyOk) {
      setError(qtyProblem || (type === 'adjust' ? 'กรุณากรอกยอดที่นับได้จริง' : 'กรุณากรอกจำนวน'))
      return
    }
    if (after === null || after < 0) {
      setError(negativeBase ? negativeBaseText(before) : `สต๊อกไม่พอ มีอยู่ ${num(before)} ชิ้น`)
      return
    }

    const product = selected
    const moveType = type
    const expectedBefore = before
    const expectedAfter = after
    savingRef.current = true
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const supabase = createClient()
      const { data, error: rpcError } = await supabase.rpc('move_stock', {
        p_product_id: product.id,
        p_type: moveType,
        p_qty: qty,
        p_note: note.trim() || null,
      })
      if (rpcError) {
        if (serverAnswered(rpcError)) {
          setError(thaiError(rpcError))
          // ยอดในเครื่องอาจเก่า (เช่นสต๊อกไม่พอเพราะเพิ่งขายไป) → ดึงยอดล่าสุด
          if (navigator.onLine !== false) router.refresh()
        } else {
          // อาจบันทึกไปแล้ว — ห้ามปล่อยฟอร์มเดิมให้กดซ้ำ (จะได้ +N / -N สองรอบ)
          setError(UNSURE_MSG)
          setQtyText('')
          // ให้ประวัติ/ยอดคงเหลือเป็นของล่าสุด จะได้ดูได้ว่ารายการเข้าไปแล้วหรือยัง (ออฟไลน์อยู่ รอ event online แทน)
          if (navigator.onLine !== false) router.refresh()
        }
        return
      }

      const res = (data ?? null) as Partial<MoveResult> | null
      const qb = toNum(res?.qty_before) ?? expectedBefore
      const qa = toNum(res?.qty_after) ?? expectedAfter
      const label = TYPE_LABELS[res?.type ?? moveType] ?? TYPE_LABELS[moveType]
      setSuccess(`บันทึกแล้ว: ${label} ${signed(qa - qb)} ชิ้น — ${productLabel(product)} (${num(qb)} → ${num(qa)})`)
      setLastSavedId(typeof res?.id === 'string' ? res.id : null)
      setQtyText(moveType === 'adjust' ? '' : '1')
      setNote('')
      if (navigator.onLine !== false) router.refresh()
    } catch (err) {
      // ไม่รู้ว่าคำขอไปถึงเซิร์ฟเวอร์หรือยัง → ปฏิบัติแบบเดียวกับเน็ตหลุด
      const answered = serverAnswered(err)
      setError(answered ? thaiError(err) : UNSURE_MSG)
      if (!answered) setQtyText('')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const visible = matches.slice(0, MAX_RESULTS)

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:items-start">
      {/* lg+: ฟอร์มกว้างคงที่ด้านซ้าย + ประวัติยืดเต็มที่เหลือ / มือถือ-iPad แนวตั้ง: เรียงลงมาเหมือนเดิม */}
      {showScanner && (
        <BarcodeScanner
          title="สแกนเลือกสินค้า"
          closeOnSuccess
          onScan={handleScan}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* ฟอร์มบันทึก */}
      <section className="lg:w-[420px] lg:shrink-0 min-w-0 card p-4 sm:p-5 space-y-5">
        <h2 className="font-semibold text-gray-900">บันทึกการเคลื่อนไหว</h2>

        {/* 1) เลือกสินค้า */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-700">สินค้า</span>
            <button type="button" onClick={() => setShowScanner(true)}
              className="min-h-[40px] px-3 rounded-lg bg-brand-50 text-brand-700 hover:bg-brand-100 text-sm font-medium">
              📷 สแกน
            </button>
          </div>

          {selected ? (
            <div className="rounded-xl border border-brand-200 bg-brand-50 p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 break-words">{productLabel(selected)}</p>
                <p className="text-xs text-gray-500 break-all">
                  SKU {selected.sku}{selected.barcode ? ` · ${selected.barcode}` : ''}
                </p>
                <p className="text-sm text-gray-700 mt-0.5">
                  คงเหลือ <span className={`font-bold ${selected.stock_qty <= 0 ? 'text-red-600' : 'text-gray-900'}`}>{num(selected.stock_qty)}</span> ชิ้น
                </p>
              </div>
              <button type="button" onClick={changeProduct} className="btn-secondary min-h-[40px] shrink-0">
                เปลี่ยน
              </button>
            </div>
          ) : (
            <>
              <input
                ref={searchRef}
                className="input"
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-label="ค้นหาสินค้า"
                placeholder="🔍 ชื่อ / SKU / บาร์โค้ด / ไซส์ / สี"
                value={search}
                onChange={e => { setSearch(e.target.value); setPickMsg('') }}
                onKeyDown={handleSearchKeyDown}
              />
              {pickMsg && <p className="text-sm text-red-600" role="alert">{pickMsg}</p>}

              {products.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">
                  ยังไม่มีสินค้าที่เปิดใช้งาน — เพิ่มสินค้าที่เมนูจัดการสินค้าก่อน
                </p>
              ) : matches.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">ไม่พบสินค้าที่ตรงกับ “{search.trim()}”</p>
              ) : (
                <div className="rounded-lg border border-gray-100 divide-y divide-gray-100 overflow-hidden">
                  {visible.map(p => (
                    <button key={p.id} type="button" onClick={() => selectProduct(p)}
                      className="w-full min-h-[48px] px-3 py-2 flex items-center gap-3 text-left hover:bg-gray-50 active:bg-brand-50">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 break-words">{productLabel(p)}</p>
                        <p className="text-xs text-gray-400 truncate">{p.sku}</p>
                      </div>
                      <span className={`text-xs whitespace-nowrap shrink-0 ${p.stock_qty <= 0 ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                        คงเหลือ {num(p.stock_qty)}
                      </span>
                    </button>
                  ))}
                  {matches.length > visible.length && (
                    <p className="px-3 py-2 text-xs text-gray-400 bg-gray-50">
                      แสดง {visible.length} จาก {num(matches.length)} รายการ — พิมพ์เพิ่มเพื่อค้นหาให้แคบลง
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* 2) ประเภทรายการ */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-gray-700 mb-2">ประเภท</legend>
            <div className="grid grid-cols-4 gap-2">
              {TYPES.map(t => (
                <button key={t.value} type="button" aria-pressed={type === t.value}
                  onClick={() => changeType(t.value)}
                  className={`min-h-[56px] rounded-lg border px-1 py-2 flex flex-col items-center justify-center gap-0.5 text-sm font-medium transition-colors ${
                    type === t.value ? t.active : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}>
                  <span aria-hidden="true">{t.icon}</span>
                  <span className="whitespace-nowrap">{t.label}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500">{typeInfo.hint}</p>
          </fieldset>

          {/* 3) จำนวน */}
          <div>
            <label htmlFor="stock-qty" className="block text-sm font-medium text-gray-700 mb-1">
              {type === 'adjust' ? 'ยอดนับจริง (ทั้งหมด)' : 'จำนวน'}
            </label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => stepQty(-1)} aria-label="ลดจำนวน"
                className="w-11 h-11 shrink-0 rounded-lg bg-gray-100 text-gray-700 text-xl font-bold hover:bg-gray-200">−</button>
              <input
                id="stock-qty"
                ref={qtyRef}
                className="input min-w-0 text-center text-lg font-semibold"
                type="text"
                inputMode="numeric"
                enterKeyHint="done"
                autoComplete="off"
                placeholder={type === 'adjust' ? 'นับได้กี่ชิ้น' : '1'}
                value={qtyText}
                onChange={e => handleQtyChange(e.target.value)}
              />
              <button type="button" onClick={() => stepQty(1)} aria-label="เพิ่มจำนวน"
                className="w-11 h-11 shrink-0 rounded-lg bg-gray-100 text-gray-700 text-xl font-bold hover:bg-gray-200">+</button>
            </div>
            {qtyProblem ? (
              <p className="text-sm text-red-600 mt-1">{qtyProblem}</p>
            ) : qtyEmpty ? (
              <p className="text-xs text-gray-400 mt-1">
                {type === 'adjust' ? 'กรอกจำนวนที่นับได้จริงทั้งหมด (0 ได้)' : 'กรอกจำนวนชิ้น'}
              </p>
            ) : null}
          </div>

          {/* ตัวอย่างผลลัพธ์ */}
          {selected && (
            <div className={`rounded-lg p-3 text-sm ${insufficient ? 'bg-red-50' : 'bg-gray-50'}`}>
              {after === null ? (
                <p className="text-gray-600">คงเหลือ <span className="font-semibold text-gray-900">{num(before)}</span> ชิ้น</p>
              ) : (
                <p className="text-gray-600">
                  คงเหลือ <span className="font-semibold text-gray-900">{num(before)}</span>
                  {' → '}
                  <span className={`font-bold ${insufficient ? 'text-red-600' : 'text-brand-700'}`}>{num(after)}</span>
                  {' '}
                  <span className={`font-medium ${changeColor(after - before)}`}>({signed(after - before)})</span>
                  {type === 'adjust' && after === before && (
                    <span className="text-gray-400"> — ยอดตรงกับระบบ</span>
                  )}
                </p>
              )}
              {insufficient && (
                <p className="text-red-600 font-medium mt-1">
                  {negativeBase
                    ? `⚠️ ${negativeBaseText(before)}`
                    : `⚠️ สต๊อกไม่พอ มีอยู่ ${num(before)} ชิ้น จ่ายออกได้ไม่เกิน ${num(before)} ชิ้น`}
                </p>
              )}
            </div>
          )}

          {/* 4) หมายเหตุ */}
          <div>
            <label htmlFor="stock-note" className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
            <input id="stock-note" className="input" value={note} maxLength={200}
              onChange={e => setNote(e.target.value)} placeholder="ระบุเหตุผล / เลขที่บิล..." />
          </div>

          {error && (
            <p className="bg-red-50 text-red-700 text-sm rounded-lg p-3" role="alert">{error}</p>
          )}
          {success && (
            <p className="bg-green-50 text-green-700 text-sm rounded-lg p-3 break-words" role="status">✅ {success}</p>
          )}

          <button type="submit" disabled={!canSubmit} className="btn-primary w-full min-h-[48px] text-base">
            {saving ? 'กำลังบันทึก...' : !selected ? 'เลือกสินค้าก่อน' : `บันทึก${typeInfo.label}`}
          </button>
        </form>
      </section>

      {/* ประวัติ */}
      <section className="lg:flex-1 min-w-0 card overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-baseline justify-between gap-2">
          <h2 className="font-semibold text-gray-900">ประวัติการเคลื่อนไหว</h2>
          <span className="text-xs text-gray-400">ล่าสุด {num(movements.length)} รายการ</span>
        </div>
        {movements.length === 0 ? (
          <p className="text-center py-10 text-gray-400">ยังไม่มีรายการ</p>
        ) : (
          <>
            {/* มือถือ / iPad / คอมทั่วไป: รายการเรียงลงมา */}
            <ul className="2xl:hidden divide-y divide-gray-50 lg:max-h-[640px] lg:overflow-y-auto">
              {movements.map(m => {
                const qb = toNum(m.qty_before)
                const qa = toNum(m.qty_after)
                const change = qb !== null && qa !== null ? qa - qb : null
                return (
                  <li key={m.id} className={`px-4 py-3 ${m.id === lastSavedId ? 'bg-green-50' : ''}`}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={TYPE_BADGE[m.type] ?? 'badge-adjust'}>{TYPE_LABELS[m.type] ?? m.type}</span>
                          <span className="text-xs text-gray-400">{formatThaiDateTime(m.created_at)}</span>
                        </div>
                        <p className="text-sm font-medium text-gray-900 break-words">
                          {m.products ? productLabel(m.products) : '(ไม่พบสินค้า)'}
                        </p>
                        {m.note && <p className="text-xs text-gray-500 break-words">{m.note}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-base font-bold ${changeColor(change)}`}>
                          {change === null ? '–' : signed(change)}
                        </p>
                        <p className="text-xs text-gray-400 whitespace-nowrap">
                          {qb === null ? '?' : num(qb)} → {qa === null ? '?' : num(qa)}
                        </p>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>

            {/* จอกว้างมาก (2xl+): ตารางแยกคอลัมน์ เวลา / ประเภท / สินค้า / หมายเหตุ / จำนวน / คงเหลือ */}
            <div className="hidden 2xl:block max-h-[640px] overflow-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">เวลา</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">ประเภท</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">สินค้า</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">หมายเหตุ</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">จำนวน</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">คงเหลือ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {movements.map(m => {
                    const qb = toNum(m.qty_before)
                    const qa = toNum(m.qty_after)
                    const change = qb !== null && qa !== null ? qa - qb : null
                    return (
                      <tr key={m.id} className={m.id === lastSavedId ? 'bg-green-50' : 'hover:bg-gray-50'}>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatThaiDateTime(m.created_at)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={TYPE_BADGE[m.type] ?? 'badge-adjust'}>{TYPE_LABELS[m.type] ?? m.type}</span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900 break-words">
                            {m.products ? productLabel(m.products) : '(ไม่พบสินค้า)'}
                          </p>
                          {m.products && <p className="text-xs text-gray-400 break-all">SKU {m.products.sku}</p>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 break-words">{m.note || '-'}</td>
                        <td className={`px-4 py-3 text-right text-base font-bold whitespace-nowrap ${changeColor(change)}`}>
                          {change === null ? '–' : signed(change)}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-gray-400 whitespace-nowrap">
                          {qb === null ? '?' : num(qb)} → {qa === null ? '?' : num(qa)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
