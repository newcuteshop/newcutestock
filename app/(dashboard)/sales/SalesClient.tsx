'use client'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import BarcodeScanner from '@/components/BarcodeScanner'
import { baht, formatThaiDateTime, productLabel, thaiError, variantText } from '@/lib/format'
import { codeCandidates, findByCode, normalizeScannedCode } from '@/lib/barcode'
import {
  AlertTriangle, Banknote, Camera, Check, CheckCircle2, CreditCard, History, Info, Loader2, Minus, Plus,
  Receipt, Search, SearchCheck, SearchX, Shirt, ShoppingBag, ShoppingCart, Smartphone, Trash2, Wallet, X,
  XCircle, type LucideIcon,
} from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { MANUAL_SALE_CHANNEL_OPTIONS, PAYMENT_METHOD_LABELS, SALE_CHANNEL_LABELS, saleChannelLabel } from '@/lib/integrations/labels'
import type { ManualSaleChannel } from '@/lib/integrations/types'

export interface PosProduct {
  id: string
  name: string
  sku: string
  barcode: string | null
  size: string | null
  color: string | null
  sell_price: number
  stock_qty: number
}

export interface RecentSale {
  id: string
  sale_no: string
  net_amount: number
  payment_method: string
  created_at: string
  channel?: string | null      // ช่องทางขาย ('store' = หน้าร้าน)
  voided_at?: string | null    // บิลออเดอร์แพลตฟอร์มที่ถูกยกเลิกก่อนส่ง (คืนสต๊อกแล้ว ไม่นับยอด)
}

type PaymentMethod = 'cash' | 'transfer' | 'credit'
interface CartLine { id: string; qty: number }
interface ScanResult { ok: boolean; message: string }
interface SentItem { product_id: string; qty: number }
// บิลที่กดชำระไปแล้วแต่ไม่รู้ผล (เน็ตหลุด/หมดเวลา/ตอบกลับไม่ครบ) — อาจบันทึกไปแล้วก็ได้
// เก็บแยกจากข้อความ error และจำลงเครื่อง: กดชำระซ้ำด้วยรหัสบิลเดิมได้เสมอ จนกว่าจะรู้ผลแน่นอน
interface PendingCheckout {
  clientId: string
  items: SentItem[]
  discount: number
}
interface SavedCart {
  lines: CartLine[]
  discount: number
  paymentMethod: PaymentMethod
  note: string
  clientId: string
  pending: PendingCheckout | null
}

// ผลจาก RPC record_sale (ยอดเงินทุกตัวมาจากฝั่งเซิร์ฟเวอร์)
interface SavedSaleItem {
  product_id: string
  name: string
  sku: string
  size: string | null
  color: string | null
  qty: number
  unit_price: number
  subtotal: number
  stock_after: number
}
interface SavedSale {
  id: string
  sale_no: string
  total_amount: number
  discount: number
  net_amount: number
  payment_method: string
  note: string | null
  created_at: string
  already_saved: boolean
  items: SavedSaleItem[]
  channel: string   // ช่องทางขายของบิล ('store' = หน้าร้าน) — ไม่มีในผลเก่า = ''
}
interface SuccessInfo {
  sale: SavedSale
  shownNet: number | null  // ยอดที่หน้าจอแสดงตอนกดชำระ (null = กดตรวจบิลค้าง ไม่ได้แสดงยอด)
  cartMismatch: boolean  // บิลที่บันทึกไว้แล้วไม่ตรงกับตะกร้าตอนกดล่าสุด
}

interface CartView {
  id: string
  qty: number
  product: PosProduct | null
  label: string
  problem: string   // ไม่ว่าง = บรรทัดนี้จะไม่ถูกคิดเงิน
  lineTotal: number
}

const STORAGE_KEY = 'newcute-pos-v1'
const MAX_CARDS = 200
const CHECKOUT_TIMEOUT_MS = 30000
const EMPTY_CART: SavedCart = { lines: [], discount: 0, paymentMethod: 'cash', note: '', clientId: '', pending: null }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIMEOUT_MSG = 'เซิร์ฟเวอร์ตอบช้าเกินไป — บิลอาจบันทึกไปแล้วหรือยังก็ได้ กด "ชำระเงิน" อีกครั้งได้เลย ระบบจะไม่ตัดสต๊อกซ้ำ'
const UNSURE_MSG = 'ไม่แน่ใจว่าบิลบันทึกแล้วหรือยัง (เน็ตหลุดระหว่างส่ง) — กด "ชำระเงิน" อีกครั้งเพื่อตรวจสอบ ระบบจะไม่ตัดสต๊อกซ้ำ'
const PARTIAL_MSG = 'ระบบตอบกลับไม่ครบ — บิลอาจบันทึกแล้ว ดูใน "รายการขายล่าสุด" ก่อน หรือกดชำระเงินอีกครั้ง (ระบบจะไม่ตัดสต๊อกซ้ำ)'
// ช่องทางขายที่เลือกล่าสุด — จำแยกจากตะกร้า (ไม่แตะรูปแบบตะกร้า/บิลค้างตรวจเดิม)
const CHANNEL_STORAGE_KEY = 'newcute-pos-channel-v1'

function isManualSaleChannel(v: unknown): v is ManualSaleChannel {
  return MANUAL_SALE_CHANNEL_OPTIONS.some(o => o.value === v)
}

const PAYMENT_OPTIONS: { value: PaymentMethod; label: string; icon: LucideIcon }[] = [
  { value: 'cash', label: 'เงินสด', icon: Banknote },
  { value: 'transfer', label: 'โอนเงิน', icon: Smartphone },
  { value: 'credit', label: 'บัตรเครดิต', icon: CreditCard },
]
const PAYMENT_LABELS: Record<string, string> = PAYMENT_METHOD_LABELS
// ไอคอนช่องทางชำระ (ช่องทางที่ไม่รู้จักแสดงแค่ข้อความ)
const PAYMENT_ICONS: Partial<Record<string, LucideIcon>> = {
  cash: Banknote,
  transfer: Smartphone,
  credit: CreditCard,
  marketplace: ShoppingBag,
}

// ช่องทางชำระ = ไอคอน + ชื่อ (ใช้ในตารางขายล่าสุด และหน้าต่างบิลสำเร็จ)
function PaymentText({ method, size = 18 }: { method: string; size?: number }) {
  const Icon = PAYMENT_ICONS[method]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {Icon && <Icon size={size} strokeWidth={1.9} aria-hidden="true" className="text-brand-600" />}
      {PAYMENT_LABELS[method] ?? method}
    </span>
  )
}

// ===== helpers =====
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function toNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function toStrOrNull(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

function isPaymentMethod(v: unknown): v is PaymentMethod {
  return v === 'cash' || v === 'transfer' || v === 'credit'
}

// UUID v4 สำหรับ client_id (กันบันทึกบิลซ้ำเวลากดซ้ำ/เน็ตหลุดแล้วกดใหม่)
function newClientId(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined
  try {
    if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  } catch { /* randomUUID ใช้ไม่ได้บน http ธรรมดา — ใช้วิธีสำรอง */ }
  const bytes = new Uint8Array(16)
  let filled = false
  try {
    if (c && typeof c.getRandomValues === 'function') { c.getRandomValues(bytes); filled = true }
  } catch { filled = false }
  if (!filled) for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function parsePending(v: unknown): PendingCheckout | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.clientId !== 'string' || !UUID_RE.test(o.clientId) || !Array.isArray(o.items)) return null
  const items: SentItem[] = []
  for (const item of o.items) {
    if (!item || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    const qty = Math.floor(Number(it.qty))
    if (typeof it.product_id !== 'string' || !UUID_RE.test(it.product_id) || !Number.isFinite(qty) || qty < 1) continue
    items.push({ product_id: it.product_id, qty })
  }
  if (items.length === 0) return null
  const discount = Number(o.discount)
  return { clientId: o.clientId, items, discount: Number.isFinite(discount) && discount > 0 ? round2(discount) : 0 }
}

// error นี้มาจากเซิร์ฟเวอร์จริง (มีรหัสของ Postgres/PostgREST) — ไม่ใช่เน็ตหลุด/หมดเวลา/เกตเวย์ตอบเป็นหน้า HTML
function serverAnswered(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  if (typeof code !== 'string') return false
  // SQLSTATE 5 ตัว (ไม่มีกลุ่มไหนขึ้นต้นด้วย E — กันสับสนกับรหัสเครือข่ายอย่าง EPIPE) หรือรหัสของ PostgREST
  return /^PGRST\d+$/.test(code) || /^(?!E)[0-9A-Z]{5}$/.test(code)
}

// เซิร์ฟเวอร์ปฏิเสธ "หลัง" ตรวจรหัสบิลซ้ำแล้ว = บิลรหัสนี้ไม่มีในระบบแน่นอน
// error เรื่องสิทธิ์/การเข้าสู่ระบบเกิด "ก่อน" ตรวจ → ยังบอกไม่ได้ว่าครั้งก่อนบันทึกไปหรือยัง
function rejectedAfterDuplicateCheck(err: unknown): boolean {
  if (!serverAnswered(err)) return false
  const e = err as { code?: unknown; message?: unknown }
  const code = String(e.code)
  const message = typeof e.message === 'string' ? e.message : ''
  if (code === '42501' || code.startsWith('PGRST')) return false
  if (code === 'P0001' && /เข้าสู่ระบบ|ไม่มีสิทธิ์|รหัสบิล/.test(message)) return false
  return true
}

// อ่านตะกร้าที่จำไว้ — ข้อมูลเสีย/รูปแบบไม่ตรง ให้ทิ้งไปเฉย ๆ
function parseSavedCart(raw: string | null): SavedCart | null {
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object') return null
    const o = v as Record<string, unknown>
    const qtyById: Record<string, number> = {}
    const order: string[] = []
    if (Array.isArray(o.lines)) {
      for (const item of o.lines) {
        if (!item || typeof item !== 'object') continue
        const it = item as Record<string, unknown>
        const id = typeof it.id === 'string' ? it.id : ''
        const qty = Math.floor(Number(it.qty))
        if (!id || !Number.isFinite(qty) || qty < 1) continue
        if (qtyById[id] === undefined) { order.push(id); qtyById[id] = 0 }
        qtyById[id] += qty
      }
    }
    const discount = Number(o.discount)
    const pending = parsePending(o.pending)
    return {
      lines: order.map(id => ({ id, qty: qtyById[id] })),
      discount: Number.isFinite(discount) && discount > 0 ? round2(discount) : 0,
      paymentMethod: isPaymentMethod(o.paymentMethod) ? o.paymentMethod : 'cash',
      note: typeof o.note === 'string' ? o.note.slice(0, 200) : '',
      // มีบิลค้างตรวจ → ต้องใช้รหัสบิลของบิลนั้นเสมอ
      clientId: pending
        ? pending.clientId
        : typeof o.clientId === 'string' && UUID_RE.test(o.clientId) ? o.clientId : '',
      pending,
    }
  } catch {
    return null
  }
}

function parseSavedSale(data: unknown): SavedSale | null {
  const d: unknown = Array.isArray(data) ? data[0] : data
  if (!d || typeof d !== 'object') return null
  const o = d as Record<string, unknown>
  if (o.sale_no == null || o.sale_no === '') return null
  const items: SavedSaleItem[] = Array.isArray(o.items)
    ? o.items
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map(x => ({
          product_id: toStr(x.product_id),
          name: toStr(x.name),
          sku: toStr(x.sku),
          size: toStrOrNull(x.size),
          color: toStrOrNull(x.color),
          qty: toNum(x.qty),
          unit_price: toNum(x.unit_price),
          subtotal: toNum(x.subtotal),
          stock_after: toNum(x.stock_after),
        }))
    : []
  return {
    id: toStr(o.id),
    sale_no: toStr(o.sale_no),
    total_amount: toNum(o.total_amount),
    discount: toNum(o.discount),
    net_amount: toNum(o.net_amount),
    payment_method: toStr(o.payment_method),
    note: toStrOrNull(o.note),
    created_at: toStr(o.created_at),
    already_saved: o.already_saved === true,
    items,
    channel: toStr(o.channel),
  }
}

function sameItems(a: SentItem[], b: SentItem[]): boolean {
  const sum = (list: SentItem[]) => {
    const m: Record<string, number> = {}
    list.forEach(i => { m[i.product_id] = (m[i.product_id] ?? 0) + i.qty })
    return m
  }
  const ma = sum(a)
  const mb = sum(b)
  const ka = Object.keys(ma)
  return ka.length === Object.keys(mb).length && ka.every(k => ma[k] === mb[k])
}

// ช่องตัวเลขที่พิมพ์ได้ลื่น (ลบจนว่างระหว่างพิมพ์ได้) แต่ค่าที่ส่งออกไปถูกจำกัดช่วงเสมอ
function NumberField({
  id, value, onChange, min, max, decimals = false, emptyZero = false, disabled, className, ariaLabel, placeholder,
}: {
  id?: string
  value: number
  onChange: (n: number) => void
  min: number
  max: number
  decimals?: boolean
  emptyZero?: boolean   // แสดงช่องว่างแทน 0 (ใช้กับส่วนลด)
  disabled?: boolean
  className?: string
  ariaLabel: string
  placeholder?: string
}) {
  const show = useCallback((n: number) => (emptyZero && n === 0 ? '' : String(n)), [emptyZero])
  const [text, setText] = useState(() => show(value))

  // ค่าเปลี่ยนจากภายนอก (กด +/−, ล้างตะกร้า, กู้ตะกร้า) → อัปเดตช่อง ถ้าไม่ตรงกับที่พิมพ์ค้างอยู่
  useEffect(() => {
    setText(t => {
      const typed = t.trim() === '' ? (emptyZero ? 0 : NaN) : Number(t)
      return typed === value ? t : show(value)
    })
  }, [value, emptyZero, show])

  function clamp(n: number): number {
    const r = decimals ? round2(n) : Math.floor(n)
    return Math.min(Math.max(r, min), Math.max(min, max))
  }

  function handleChange(raw: string) {
    const cleaned = decimals ? raw.replace(/[^\d.]/g, '') : raw.replace(/\D/g, '')
    if (cleaned === '') {
      setText('')
      if (emptyZero && value !== 0) onChange(clamp(0))
      return
    }
    const n = Number(cleaned)
    if (!Number.isFinite(n)) { setText(cleaned); return }
    const c = clamp(n)
    setText(c === n ? cleaned : show(c))
    if (c !== value) onChange(c)
  }

  return (
    <input
      id={id}
      type="text"
      inputMode={decimals ? 'decimal' : 'numeric'}
      pattern={decimals ? undefined : '[0-9]*'}
      autoComplete="off"
      aria-label={ariaLabel}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      value={text}
      onChange={e => handleChange(e.target.value)}
      onFocus={e => e.currentTarget.select()}
      onBlur={() => setText(show(value))}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
    />
  )
}

export default function SalesClient({ products, recentSales }: {
  products: PosProduct[]; recentSales: RecentSale[]
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  // ----- ตะกร้า: เก็บแค่ id + จำนวน — ชื่อ/ราคา/สต๊อก อ่านจาก products ล่าสุดเสมอ -----
  const [lines, setLinesState] = useState<CartLine[]>([])
  const linesRef = useRef<CartLine[]>([])   // ค่าล่าสุดแบบ sync (สแกนรัว ๆ ก่อน re-render ก็นับถูก)
  const [discount, setDiscount] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [note, setNote] = useState('')
  const [clientId, setClientId] = useState('')
  const [pending, setPending] = useState<PendingCheckout | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [saleChannel, setSaleChannel] = useState<ManualSaleChannel>('store')
  const [channelLoaded, setChannelLoaded] = useState(false)

  const [search, setSearch] = useState('')
  const [showScanner, setShowScanner] = useState(false)
  const [notice, setNotice] = useState<ScanResult | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)   // กันกดชำระเบิ้ล (state อัปเดตไม่ทันนิ้ว)
  const [checkoutError, setCheckoutError] = useState('')
  const [success, setSuccess] = useState<SuccessInfo | null>(null)
  const [payButtonVisible, setPayButtonVisible] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)
  const payButtonRef = useRef<HTMLButtonElement>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const knownLabels = useRef<Map<string, string>>(new Map())

  const updateLines = useCallback((fn: (prev: CartLine[]) => CartLine[]) => {
    const next = fn(linesRef.current)
    if (next === linesRef.current) return
    linesRef.current = next
    setLinesState(next)
  }, [])

  const applySaved = useCallback((s: SavedCart) => {
    updateLines(() => s.lines)
    setDiscount(s.discount)
    setPaymentMethod(s.paymentMethod)
    setNote(s.note)
    setClientId(s.clientId)
    setPending(s.pending)
  }, [updateLines])

  // ----- กู้ตะกร้าจาก localStorage ตอน mount (ไม่ทำตอน render กัน hydration mismatch) -----
  useEffect(() => {
    let saved: SavedCart | null = null
    try {
      saved = parseSavedCart(window.localStorage.getItem(STORAGE_KEY))
    } catch {
      saved = null
    }
    if (saved) applySaved(saved)
    setHydrated(true)
    // คอม/เครื่องที่มีเมาส์ (มักต่อเครื่องสแกน USB) → โฟกัสช่องค้นหารอเลย; มือถือไม่โฟกัส กันคีย์บอร์ดเด้ง
    try {
      if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) searchRef.current?.focus()
    } catch { /* ignore */ }
  }, [applySaved])

  // ----- จำตะกร้าทุกครั้งที่เปลี่ยน -----
  useEffect(() => {
    if (!hydrated) return
    try {
      const data: SavedCart = { lines, discount, paymentMethod, note, clientId, pending }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch { /* storage เต็ม/ถูกปิด — ขายต่อได้ปกติ แค่ไม่จำตะกร้า */ }
  }, [hydrated, lines, discount, paymentMethod, note, clientId, pending])

  // ----- ช่องทางขาย: กู้ค่าที่เลือกไว้ตอน mount แล้วจำทุกครั้งที่เปลี่ยน (ค่าเสีย/อ่านไม่ได้ = หน้าร้าน) -----
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CHANNEL_STORAGE_KEY)
      if (isManualSaleChannel(saved)) setSaleChannel(saved)
    } catch { /* storage ถูกปิด — ใช้หน้าร้าน */ }
    setChannelLoaded(true)
  }, [])

  useEffect(() => {
    if (!channelLoaded) return
    try {
      window.localStorage.setItem(CHANNEL_STORAGE_KEY, saleChannel)
    } catch { /* ไม่เป็นไร */ }
  }, [channelLoaded, saleChannel])

  // ----- เปิด POS หลายแท็บ: ใช้ตะกร้าเดียวกัน (ขายในแท็บหนึ่งแล้ว อีกแท็บต้องว่างตาม) -----
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY || savingRef.current) return
      applySaved(parseSavedCart(e.newValue) ?? EMPTY_CART)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [applySaved])

  // ----- client_id สร้างตอนตะกร้ามีสินค้าชิ้นแรก แล้วใช้ซ้ำตอนกดชำระใหม่ -----
  // (แท็บที่ซ่อนอยู่ไม่สร้าง — กันสองแท็บสุ่มรหัสแข่งกันผ่านตะกร้าที่ใช้ร่วมกัน)
  useEffect(() => {
    if (hydrated && lines.length > 0 && !clientId && document.visibilityState === 'visible') setClientId(newClientId())
  }, [hydrated, lines.length, clientId])

  // ----- กลับมาที่แท็บ/เน็ตกลับมา → โหลดราคา+สต๊อกใหม่ ไม่ขายด้วยข้อมูลเก่า -----
  // ออฟไลน์อยู่ห้าม refresh: Next 14 จะโหลดทั้งหน้าใหม่ กลายเป็นหน้า "ไม่มีอินเทอร์เน็ต" ของเบราว์เซอร์
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible' && navigator.onLine !== false) router.refresh()
    }
    function onOnline() {
      router.refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [router])

  // ----- ปุ่มชำระเงินจริงอยู่บนจอแล้ว → ซ่อนแถบล่าง (มือถือ) -----
  useEffect(() => {
    const el = payButtonRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      entries => setPayButtonVisible(entries.some(en => en.isIntersecting)),
      { threshold: 0.5 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
  }, [])

  // ----- เครื่องสแกน USB/บลูทูธ: พิมพ์ตอนโฟกัสไม่อยู่ในช่องกรอก (เช่นเพิ่งแตะการ์ดสินค้า) → ส่งเข้าช่องค้นหา -----
  // ไม่งั้นตัวอักษรหาย และ Enter ท้ายรหัสไปกดปุ่มที่โฟกัสค้างอยู่ (เพิ่มสินค้าตัวก่อนซ้ำ)
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (showScanner || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
        || (el instanceof HTMLElement && el.isContentEditable)) return
      // เว้นวรรคบนปุ่ม = ผู้ใช้คีย์บอร์ดกดปุ่ม ไม่ใช่การสแกน
      if (e.key === ' ' && (el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement)) return
      if (success) setSuccess(null)
      searchRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [showScanner, success])

  // ----- สินค้าจาก props (ห้าม copy ลง state — router.refresh() ต้องอัปเดตราคา/สต๊อกได้) -----
  const catalog = useMemo<PosProduct[]>(() => products.map(p => ({
    ...p,
    barcode: p.barcode ?? null,
    size: p.size ?? null,
    color: p.color ?? null,
    sell_price: toNum(p.sell_price),
    stock_qty: Math.max(0, Math.floor(toNum(p.stock_qty))),
  })), [products])

  const productById = useMemo(() => {
    const m = new Map<string, PosProduct>()
    catalog.forEach(p => m.set(p.id, p))
    return m
  }, [catalog])

  // จำชื่อสินค้าที่เคยเห็น เผื่อสินค้าในตะกร้าถูกปิดใช้งานระหว่างขาย จะได้ยังบอกได้ว่าตัวไหน
  useEffect(() => {
    catalog.forEach(p => knownLabels.current.set(p.id, productLabel(p)))
  }, [catalog])

  // จำนวนในตะกร้าเกินสต๊อกล่าสุด → ลดลงให้เท่าสต๊อก
  // เฉพาะแท็บที่เปิดดูอยู่: แท็บที่ซ่อนมีสต๊อกเก่า ถ้าเขียนกลับจะไปลดจำนวนในแท็บที่ใช้งานจริง (ตะกร้าใช้ร่วมกัน)
  // แท็บที่ซ่อนยังแสดง/คิดเงินไม่เกินสต๊อกผ่าน cartView อยู่แล้ว กลับมาเปิดดูเมื่อไรก็ refresh แล้วมาตรวจใหม่
  useEffect(() => {
    if (document.visibilityState !== 'visible') return
    const over = lines.some(l => {
      const p = productById.get(l.id)
      return !!p && p.stock_qty > 0 && l.qty > p.stock_qty
    })
    if (!over) return
    updateLines(prev => prev.map(l => {
      const p = productById.get(l.id)
      return p && p.stock_qty > 0 && l.qty > p.stock_qty ? { ...l, qty: p.stock_qty } : l
    }))
  }, [lines, productById, updateLines])

  const cartView: CartView[] = lines.map(l => {
    const p = productById.get(l.id) ?? null
    if (!p) {
      return {
        id: l.id, qty: l.qty, product: null, lineTotal: 0,
        label: knownLabels.current.get(l.id) ?? 'สินค้าที่ไม่มีในรายการขายแล้ว',
        problem: 'สินค้านี้ถูกปิดใช้งานหรือถูกลบแล้ว — จะไม่ถูกคิดเงินในบิลนี้ กด ✕ เพื่อเอาออก',
      }
    }
    if (p.stock_qty <= 0) {
      return {
        id: l.id, qty: l.qty, product: p, lineTotal: 0, label: productLabel(p),
        problem: 'สต๊อกหมดแล้ว — จะไม่ถูกคิดเงินในบิลนี้ กด ✕ เพื่อเอาออก',
      }
    }
    const qty = Math.min(l.qty, p.stock_qty)
    return { id: l.id, qty, product: p, label: productLabel(p), problem: '', lineTotal: round2(p.sell_price * qty) }
  })
  const payable = cartView.filter(v => v.product !== null && v.problem === '')
  const excludedCount = cartView.length - payable.length
  const itemCount = payable.reduce((s, v) => s + v.qty, 0)
  const total = round2(payable.reduce((s, v) => s + v.lineTotal, 0))
  const effDiscount = round2(Math.min(Math.max(0, discount), total))
  const net = round2(Math.max(0, total - effDiscount))

  // ส่วนลดต้องไม่เกินยอดรวม (เช่น เอาสินค้าออกหลังใส่ส่วนลด) — เฉพาะแท็บที่เปิดดูอยู่ (เหตุผลเดียวกับด้านบน)
  useEffect(() => {
    if (!hydrated || document.visibilityState !== 'visible') return
    if (discount > total) setDiscount(total)
  }, [hydrated, discount, total])

  const cartQtyById = useMemo(() => {
    const m = new Map<string, number>()
    lines.forEach(l => m.set(l.id, l.qty))
    return m
  }, [lines])

  // ----- ค้นหา: ชื่อ / SKU / บาร์โค้ด / ไซส์ / สี (+ รหัสที่พิมพ์ตอนคีย์บอร์ดเป็นภาษาไทย) -----
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return catalog
    const tokens = q.split(/\s+/)
    const codes = /\s/.test(q)
      ? []
      : codeCandidates(search).map(c => c.toLowerCase()).filter(c => c.length >= 3 && c !== q)
    return catalog.filter(p => {
      const hay = `${p.name} ${p.sku} ${p.barcode ?? ''} ${p.size ?? ''} ${p.color ?? ''}`.toLowerCase()
      if (tokens.every(t => hay.includes(t))) return true
      if (codes.length === 0) return false
      const sku = p.sku.toLowerCase()
      const bc = (p.barcode ?? '').toLowerCase()
      return codes.some(c => sku.includes(c) || (bc !== '' && bc.includes(c)))
    })
  }, [catalog, search])
  const shown = filtered.length > MAX_CARDS ? filtered.slice(0, MAX_CARDS) : filtered

  // ----- actions -----
  function showNotice(r: ScanResult) {
    setNotice(r)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), r.ok ? 2000 : 3500)
  }

  function addProduct(p: PosProduct): ScanResult {
    const label = productLabel(p)
    if (savingRef.current) return { ok: false, message: 'กำลังบันทึกบิล รอสักครู่แล้วค่อยเพิ่มสินค้า' }
    const inCart = linesRef.current.find(l => l.id === p.id)?.qty ?? 0
    if (p.stock_qty <= 0) return { ok: false, message: `สต๊อกหมด: ${label}` }
    if (inCart >= p.stock_qty) {
      return { ok: false, message: `สต๊อกหมด: ${label} (ในตะกร้าครบ ${p.stock_qty} ชิ้นแล้ว)` }
    }
    updateLines(prev => (prev.some(l => l.id === p.id)
      ? prev.map(l => (l.id === p.id ? { ...l, qty: Math.min(l.qty + 1, p.stock_qty) } : l))
      : [...prev, { id: p.id, qty: 1 }]))
    setCheckoutError('')
    return { ok: true, message: `เพิ่ม: ${label} (ในตะกร้า ${inCart + 1})` }
  }

  // BarcodeScanner ส่งรหัสที่ normalize แล้วมาให้ และโชว์ข้อความที่คืนไปในหน้าต่างสแกนเอง
  function handleScan(code: string): ScanResult {
    const p = findByCode(catalog, code)
    if (!p) return { ok: false, message: `ไม่พบสินค้า: ${code}` }
    return addProduct(p)
  }

  // เครื่องสแกน USB พิมพ์รหัสแล้วกด Enter ใส่ช่องค้นหา
  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    const input = e.currentTarget
    const raw = input.value
    if (!raw.trim()) return
    const p = findByCode(catalog, raw)
    if (p) {
      showNotice(addProduct(p))
      setSearch('')
      input.focus()
      return
    }
    if (filtered.length === 0) {
      showNotice({ ok: false, message: `ไม่พบสินค้า: ${normalizeScannedCode(raw) || raw.trim()}` })
      input.select()   // สแกนครั้งถัดไปจะพิมพ์ทับทันที
    }
  }

  function setLineQty(id: string, qty: number) {
    if (savingRef.current) return
    const p = productById.get(id)
    if (!p || p.stock_qty <= 0) return
    const q = Math.min(Math.max(1, Math.floor(qty)), p.stock_qty)
    updateLines(prev => prev.map(l => (l.id === id ? { ...l, qty: q } : l)))
    setCheckoutError('')
  }

  function removeLine(id: string) {
    if (savingRef.current) return
    updateLines(prev => prev.filter(l => l.id !== id))
    setCheckoutError('')
  }

  function clearCart() {
    if (savingRef.current) return
    if (linesRef.current.length > 0 || pending) {
      const msg = pending
        ? 'บิลก่อนหน้าอาจบันทึกไปแล้ว — ควรกด "ชำระเงิน" เพื่อตรวจสอบก่อน (ระบบจะไม่ตัดสต๊อกซ้ำ) หรือดู "รายการขายล่าสุด" ด้านล่าง\nถ้าล้างตะกร้าแล้วสแกนขายใหม่ อาจได้บิลซ้ำ\n\nยืนยันล้างสินค้าทั้งหมดในตะกร้า?'
        : 'ล้างสินค้าทั้งหมดในตะกร้า?'
      if (!window.confirm(msg)) return
    }
    updateLines(() => [])
    setDiscount(0)
    setNote('')
    setClientId(newClientId())
    setPending(null)
    setCheckoutError('')
  }

  function scrollToCart() {
    document.getElementById('cart')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function startNewBill() {
    setSuccess(null)
    try {
      if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) searchRef.current?.focus()
    } catch { /* ignore */ }
  }

  async function handleCheckout() {
    if (savingRef.current) return
    // ตะกร้าคิดเงินไม่ได้ แต่มีบิลค้างตรวจ (เช่นบิลนั้นขายชิ้นสุดท้ายไปแล้ว สต๊อกเลยเป็น 0) → ส่งบิลเดิมไปตรวจ
    const retryPending = payable.length === 0 ? pending : null
    if (payable.length === 0 && !retryPending) return
    savingRef.current = true
    setSaving(true)
    setCheckoutError('')

    const hadPending = pending !== null
    const cid = pending ? pending.clientId : (clientId || newClientId())
    if (cid !== clientId) setClientId(cid)
    const sent: SentItem[] = retryPending ? retryPending.items : payable.map(v => ({ product_id: v.id, qty: v.qty }))
    const sentDiscount = retryPending ? retryPending.discount : effDiscount
    const shownNet = retryPending ? null : net
    const nextPending: PendingCheckout = { clientId: cid, items: sent, discount: sentDiscount }
    setPending(nextPending)
    // จำลงเครื่องทันทีก่อนส่ง (ไม่รอ effect) — แอปถูกปิด/รีโหลดกลางทางก็ยังรู้ว่ามีบิลค้างตรวจ
    try {
      const data: SavedCart = { lines: linesRef.current, discount, paymentMethod, note, clientId: cid, pending: nextPending }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch { /* storage ใช้ไม่ได้ — ยังจำใน state ของหน้านี้ */ }

    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    let timedOut = false
    let answered = false   // เซิร์ฟเวอร์ตอบกลับมาจริง (สำเร็จ หรือปฏิเสธพร้อมรหัส error)
    let partial = false    // ได้คำตอบแต่อ่านผลบิลไม่ได้
    const timer = setTimeout(() => { timedOut = true; ctrl?.abort() }, CHECKOUT_TIMEOUT_MS)

    try {
      // ราคาไม่ส่งไป — เซิร์ฟเวอร์ใช้ราคาในระบบเอง, ล็อกสต๊อก, กันขายเกิน, กันบันทึกซ้ำด้วย client_id
      let req = supabase.rpc('record_sale', {
        p_client_id: cid,
        p_items: sent,
        p_discount: sentDiscount,
        p_payment_method: paymentMethod,
        p_note: note.trim() || null,
        // หน้าร้าน = ไม่ส่ง (ฐานข้อมูลใช้ค่าเริ่มต้น 'store' เอง — ขายหน้าร้านได้แม้ยังไม่ได้รัน fix-03)
        ...(saleChannel !== 'store' ? { p_channel: saleChannel } : {}),
      })
      if (ctrl) req = req.abortSignal(ctrl.signal)
      const { data, error } = await req
      if (error) throw error
      const sale = parseSavedSale(data)
      if (!sale) {
        partial = true
        throw new Error(PARTIAL_MSG)
      }
      answered = true
      setSuccess({
        sale,
        shownNet,
        cartMismatch: sale.already_saved && sale.items.length > 0 && !sameItems(sent, sale.items),
      })
      updateLines(() => [])
      setDiscount(0)
      setNote('')
      setClientId(newClientId())
      setPending(null)
      setCheckoutError('')
      // บิลถัดไปเริ่มที่หน้าร้านเสมอ — ขายทางแชตแล้วลืมเปลี่ยนกลับ บิลหน้าร้านจะถูกนับเป็นช่องทางแชตทั้งวัน
      setSaleChannel('store')
    } catch (err) {
      // เก็บตะกร้า + client_id เดิมไว้ กดชำระซ้ำได้อย่างปลอดภัย
      if (serverAnswered(err)) {
        answered = true
        // เซิร์ฟเวอร์ปฏิเสธบิลนี้จริง = ไม่ได้บันทึก → ไม่มีบิลค้างตรวจแล้ว
        // (ยกเว้นมีบิลค้างจากครั้งก่อน แล้วรอบนี้โดนปฏิเสธเรื่องสิทธิ์/การเข้าสู่ระบบ ซึ่งยังไม่ได้ตรวจบิลเดิมเลย)
        if (!hadPending || rejectedAfterDuplicateCheck(err)) setPending(null)
        setCheckoutError(thaiError(err))
      } else {
        // เน็ตหลุด/หมดเวลา/ตอบกลับไม่ครบ → บิลค้างตรวจ (pending) ยังอยู่
        setCheckoutError(timedOut ? TIMEOUT_MSG : partial ? PARTIAL_MSG : UNSURE_MSG)
      }
    } finally {
      clearTimeout(timer)
      savingRef.current = false
      setSaving(false)
      // โหลดราคา/สต๊อกใหม่เฉพาะตอนเซิร์ฟเวอร์ตอบจริงและยังออนไลน์ (ออฟไลน์แล้ว refresh = ทั้งหน้าหายไป)
      if (answered && navigator.onLine !== false) router.refresh()
    }
  }

  const successSale = success?.sale ?? null
  const priceChanged = !!success && !success.sale.already_saved && success.shownNet !== null
    && Math.abs(success.sale.net_amount - success.shownNet) >= 0.005
  const checkingPending = payable.length === 0 && pending !== null

  return (
    <div className="pb-28 lg:pb-0">
      {/* lg+: พื้นที่สินค้ายืดเต็มที่เหลือ + ตะกร้ากว้างคงที่ด้านขวา / มือถือ-iPad แนวตั้ง: เรียงลงมาเหมือนเดิม */}
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 lg:items-start">
        {/* ===== สินค้า ===== */}
        <section className="lg:flex-1 space-y-3 min-w-0">
          <div className="card p-3 sm:p-4 flex items-center gap-2">
            <div className="input-icon flex-1 min-w-0">
              <Search {...ICON_SM} />
              <input
                ref={searchRef}
                type="text"
                className="input pl-11"
                placeholder="ค้นหาชื่อ / SKU / บาร์โค้ด / ไซส์ / สี"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-label="ค้นหาสินค้า หรือยิงบาร์โค้ดแล้วกด Enter"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowScanner(true)}
              className="btn-secondary whitespace-nowrap shrink-0 px-4"
            >
              <Camera {...ICON_SM} />
              สแกน
            </button>
          </div>

          {catalog.length === 0 ? (
            <div className="card empty-state">
              <span className="icon-bubble icon-bubble-lg"><Shirt size={30} strokeWidth={1.8} aria-hidden="true" /></span>
              <p className="empty-state-title">ยังไม่มีสินค้าที่เปิดขาย — เพิ่มสินค้าที่เมนู &quot;สินค้า&quot; ก่อน</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="card empty-state">
              <span className="icon-bubble icon-bubble-lg"><SearchX size={30} strokeWidth={1.8} aria-hidden="true" /></span>
              <p className="empty-state-title break-words">ไม่พบสินค้าที่ตรงกับ &quot;{search.trim()}&quot;</p>
            </div>
          ) : (
            <>
              {/* จำนวนคอลัมน์เพิ่มตามความกว้างจอ (การ์ดกว้างราว 150-230px)
                  lg+: กล่องเลื่อนในตัว เว้นขอบ 4px ไม่ให้การ์ดที่ลอยขึ้นตอนชี้ถูกตัดขอบ */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 min-[1150px]:grid-cols-3 2xl:grid-cols-4 min-[1800px]:grid-cols-5 min-[2200px]:grid-cols-6 gap-2 sm:gap-3 lg:max-h-[calc(100vh-15rem)] lg:overflow-y-auto lg:overscroll-contain lg:-m-1 lg:p-1">
                {shown.map(p => {
                  const variant = variantText(p)
                  const inCart = cartQtyById.get(p.id) ?? 0
                  const out = p.stock_qty <= 0
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => showNotice(addProduct(p))}
                      disabled={out || saving}
                      title={productLabel(p)}
                      className="card card-hover relative flex min-h-[72px] flex-col items-start p-3 sm:p-3.5 text-left disabled:cursor-not-allowed disabled:bg-gray-50 [&:disabled>*]:opacity-50"
                    >
                      {inCart > 0 && (
                        <span className="chip chip-strong absolute right-2 top-2 min-w-[1.75rem] justify-center px-2 tabular-nums">
                          {inCart}
                        </span>
                      )}
                      <p className={`w-full font-display font-semibold text-gray-900 text-sm sm:text-[15px] leading-snug line-clamp-2 break-words ${inCart > 0 ? 'pr-8' : ''}`}>
                        {p.name}
                      </p>
                      {variant && (
                        <span className="chip mt-1.5 max-w-full">
                          <span className="min-w-0 truncate">{variant}</span>
                        </span>
                      )}
                      <p className="w-full text-xs text-gray-400 mt-1 truncate">{p.sku}</p>
                      <div className="mt-auto flex w-full flex-wrap items-end justify-between gap-x-2 gap-y-0.5 pt-2">
                        <span className="money text-base sm:text-lg leading-tight text-brand-600">{baht(p.sell_price)}</span>
                        <span className={`inline-flex items-center gap-1 text-xs ${out ? 'text-red-700 font-medium' : 'text-gray-400'}`}>
                          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${out ? 'bg-red-500' : 'bg-strawberry'}`} />
                          คงเหลือ {p.stock_qty}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
              {filtered.length > shown.length && (
                <p className="text-xs text-center text-gray-500">
                  แสดง {shown.length} จาก {filtered.length} รายการ — พิมพ์ค้นหาเพื่อกรองให้แคบลง
                </p>
              )}
            </>
          )}
        </section>

        {/* ===== ตะกร้า ===== */}
        <section id="cart" className="lg:w-[380px] xl:w-[420px] lg:shrink-0 lg:sticky lg:top-4 card p-4 sm:p-5 space-y-4 scroll-mt-20 lg:scroll-mt-4" aria-label="ตะกร้าสินค้า">
          <div className="flex items-center justify-between gap-2">
            <h2 className="section-title min-w-0">
              <ShoppingCart {...ICON} className="text-brand-600" />
              <span className="min-w-0">
                ตะกร้า{' '}
                <span className="font-sans font-normal text-gray-500 text-sm">
                  ({lines.length} รายการ{itemCount > 0 ? ` · ${itemCount} ชิ้น` : ''})
                </span>
              </span>
            </h2>
            {lines.length > 0 && (
              <button
                type="button"
                onClick={clearCart}
                disabled={saving}
                className="btn-ghost shrink-0 -mr-2 px-3 text-sm"
              >
                <Trash2 {...ICON_SM} />
                ล้างตะกร้า
              </button>
            )}
          </div>

          {lines.length === 0 ? (
            <div className="empty-state py-6">
              <span className="icon-bubble"><ShoppingBag {...ICON} /></span>
              <p>แตะสินค้า หรือสแกนบาร์โค้ดเพื่อเพิ่มลงตะกร้า</p>
            </div>
          ) : (
            <ul className="space-y-2 lg:max-h-[40vh] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
              {cartView.map(v => (
                <li key={v.id} className={`p-3 ${v.problem ? 'rounded-2xl bg-red-50 border border-red-200' : 'panel'}`}>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium break-words ${v.problem ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                        {v.label}
                      </p>
                      {v.product && !v.problem && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          {baht(v.product.sell_price)} / ชิ้น · คงเหลือ {v.product.stock_qty}
                        </p>
                      )}
                      {v.problem && <p className="text-xs font-medium text-red-700 mt-0.5">{v.problem}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(v.id)}
                      disabled={saving}
                      aria-label={`เอา ${v.label} ออกจากตะกร้า`}
                      className="btn-icon btn-icon-plain btn-icon-danger -mr-1.5 -mt-1.5"
                    >
                      <X {...ICON_SM} />
                    </button>
                  </div>
                  {v.product && !v.problem && (
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setLineQty(v.id, v.qty - 1)}
                          disabled={v.qty <= 1 || saving}
                          aria-label="ลดจำนวน"
                          className="btn-icon"
                        >
                          <Minus {...ICON_SM} />
                        </button>
                        <NumberField
                          value={v.qty}
                          min={1}
                          max={v.product.stock_qty}
                          onChange={n => setLineQty(v.id, n)}
                          disabled={saving}
                          ariaLabel={`จำนวน ${v.label}`}
                          className="input w-[60px] px-1 text-center font-display font-semibold tabular-nums"
                        />
                        <button
                          type="button"
                          onClick={() => setLineQty(v.id, v.qty + 1)}
                          disabled={v.qty >= v.product.stock_qty || saving}
                          aria-label="เพิ่มจำนวน"
                          className="btn-icon"
                        >
                          <Plus {...ICON_SM} />
                        </button>
                      </div>
                      <p className="money text-base text-gray-900 text-right">{baht(v.lineTotal)}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-3">
            <div className="wave-divider decor" aria-hidden="true" />
            <div className="flex justify-between text-sm text-gray-600">
              <span>ยอดรวม</span>
              <span className="font-semibold tabular-nums">{baht(total)}</span>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="pos-discount" className="text-sm text-gray-600 shrink-0">ส่วนลด (บาท)</label>
              <div className="flex-1">
                <NumberField
                  id="pos-discount"
                  value={discount}
                  min={0}
                  max={total}
                  decimals
                  emptyZero
                  onChange={setDiscount}
                  disabled={saving || total <= 0}
                  ariaLabel="ส่วนลด (บาท)"
                  placeholder="0"
                  className="input text-right tabular-nums"
                />
              </div>
            </div>
            <div className="panel flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="font-display font-semibold text-gray-700">ยอดสุทธิ</span>
              <span className="money min-w-0 break-words text-right text-2xl text-brand-700">{baht(net)}</span>
            </div>

            <div>
              <label htmlFor="pos-sale-channel" className="block text-sm font-medium text-gray-700 mb-1.5">ช่องทางขาย</label>
              <select
                id="pos-sale-channel"
                className={`input ${saleChannel !== 'store' ? 'border-brand-600' : ''}`}
                value={saleChannel}
                disabled={saving}
                onChange={e => { if (isManualSaleChannel(e.target.value)) setSaleChannel(e.target.value) }}
                aria-describedby={saleChannel !== 'store' ? 'pos-sale-channel-note' : undefined}
              >
                {MANUAL_SALE_CHANNEL_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              {saleChannel !== 'store' && (
                <p id="pos-sale-channel-note" className="mt-1 text-xs font-medium text-brand-700">
                  บิลนี้บันทึกเป็นการขายทาง {SALE_CHANNEL_LABELS[saleChannel]} — ชำระเสร็จแล้ว บิลถัดไปกลับเป็นหน้าร้านเอง
                </p>
              )}
            </div>

            <div>
              <p className="block text-sm font-medium text-gray-700 mb-1.5">ช่องทางชำระ</p>
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="ช่องทางชำระ">
                {PAYMENT_OPTIONS.map(opt => {
                  const active = paymentMethod === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPaymentMethod(opt.value)}
                      disabled={saving}
                      aria-pressed={active}
                      className="choice px-1"
                    >
                      <opt.icon {...ICON} />
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <input
              className="input"
              placeholder="หมายเหตุ (ถ้ามี)"
              value={note}
              maxLength={200}
              disabled={saving}
              onChange={e => setNote(e.target.value)}
              aria-label="หมายเหตุ"
            />

            {excludedCount > 0 && (
              <p className="flex items-start gap-1.5 text-xs font-medium text-red-700">
                <AlertTriangle {...ICON_SM} className="-mt-px" />
                <span className="min-w-0">มี {excludedCount} รายการที่จะไม่ถูกคิดเงิน (สินค้าหมดหรือถูกปิดใช้งาน)</span>
              </p>
            )}

            {checkoutError && (
              <div role="alert" className="alert-err">
                <XCircle {...ICON_SM} />
                <div className="min-w-0">
                  <p className="font-medium break-words">{checkoutError}</p>
                  <p className="mt-1 text-xs text-red-700">
                    ตะกร้ายังอยู่ครบ — แก้ไขแล้วกดชำระเงินอีกครั้งได้ ถ้าบิลเคยบันทึกไปแล้วระบบจะไม่ตัดสต๊อกซ้ำ
                  </p>
                </div>
              </div>
            )}

            {pending && !saving && (
              <div role="status" className="alert-warn">
                <AlertTriangle {...ICON_SM} />
                <div className="min-w-0">
                  <p className="font-medium">บิลก่อนหน้าอาจบันทึกไปแล้ว — กดชำระเงินเพื่อตรวจสอบ ระบบจะไม่ตัดสต๊อกซ้ำ</p>
                  {checkingPending && (
                    <p className="mt-1 text-xs">
                      สินค้าในตะกร้าขึ้นว่าหมด อาจเป็นเพราะบิลนั้นบันทึกไปแล้ว — กดปุ่มด้านล่างเพื่อดูผล
                    </p>
                  )}
                </div>
              </div>
            )}

            <button
              ref={payButtonRef}
              type="button"
              onClick={handleCheckout}
              disabled={(payable.length === 0 && !pending) || saving}
              className="btn-primary w-full min-h-[56px] text-lg"
            >
              {saving ? (
                <>
                  <Loader2 {...ICON} className="animate-spin" />
                  <span>กำลังบันทึก...</span>
                </>
              ) : checkingPending ? (
                <>
                  <SearchCheck {...ICON} />
                  <span>ตรวจสอบบิลก่อนหน้า</span>
                </>
              ) : (
                <>
                  <CheckCircle2 {...ICON} />
                  <span>{`ชำระเงิน ${baht(net)}`}</span>
                </>
              )}
            </button>
          </div>
        </section>
      </div>

      {/* ===== รายการขายล่าสุด ===== */}
      <section className="card overflow-hidden mt-4 sm:mt-6">
        <div className="px-4 py-3.5 sm:px-5">
          <h2 className="section-title">
            <History {...ICON} className="text-brand-600" />
            รายการขายล่าสุด
          </h2>
        </div>
        <div className="table-wrap">
          <table className="table-soft min-w-[480px]">
            <thead>
              <tr>
                <th>เลขที่</th>
                <th>ช่องทาง</th>
                <th className="text-right">ยอดสุทธิ</th>
                <th className="text-right">เวลา</th>
              </tr>
            </thead>
            <tbody>
              {recentSales.length === 0 && (
                <tr><td colSpan={4} className="text-center py-6 text-gray-400">ยังไม่มีรายการ</td></tr>
              )}
              {recentSales.map(s => {
                const voided = !!s.voided_at
                const channel = s.channel && s.channel !== 'store' ? saleChannelLabel(s.channel) : ''
                return (
                  <tr key={s.id}>
                    <td className={`font-mono text-xs whitespace-nowrap ${voided ? 'text-gray-400' : 'text-gray-600'}`}>
                      {s.sale_no}
                      {voided && (
                        <span className="chip-outline mt-1 flex w-fit font-display" title="ออเดอร์ถูกยกเลิกก่อนส่ง — คืนสต๊อกแล้ว ไม่นับในยอดขาย">
                          ยกเลิก
                        </span>
                      )}
                    </td>
                    <td className="text-gray-600 whitespace-nowrap">
                      {s.payment_method === 'marketplace' ? (
                        // บิลจากออเดอร์แพลตฟอร์ม: ลูกค้าจ่ายผ่านแพลตฟอร์ม — แสดงชื่อแพลตฟอร์มแทน (คอลัมน์ไม่กว้างเกินจอมือถือ)
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={PAYMENT_LABELS.marketplace}>
                          <ShoppingBag size={18} strokeWidth={1.9} aria-hidden="true" className="text-brand-600" />
                          {channel || PAYMENT_LABELS.marketplace}
                        </span>
                      ) : (
                        <>
                          <PaymentText method={s.payment_method} />
                          {channel && <span className="block text-xs text-gray-500">{channel}</span>}
                        </>
                      )}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <span className={voided ? 'money text-gray-400 line-through' : 'money text-gray-900'}>
                        {baht(toNum(s.net_amount))}
                      </span>
                    </td>
                    <td className="text-right text-gray-400 text-xs whitespace-nowrap">
                      {formatThaiDateTime(s.created_at)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===== แถบชำระเงินด้านล่าง (มือถือ/แท็บเล็ต) — ทึบ อยู่เหนือกลีบกุหลาบ ===== */}
      {!payButtonVisible && !success && (
        <div className="lg:hidden fixed inset-x-0 md:left-60 bottom-0 z-30 bottom-bar pb-[env(safe-area-inset-bottom)] pl-safe pr-safe md:pl-0">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <span className="icon-bubble icon-bubble-sm"><ShoppingCart {...ICON_SM} /></span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500">
                {itemCount > 0 ? `ในตะกร้า ${itemCount} ชิ้น` : 'ตะกร้าว่าง'}
              </p>
              <p className="money text-xl text-brand-700 leading-tight truncate">{baht(net)}</p>
            </div>
            <button type="button" onClick={scrollToCart} className="btn-primary min-h-[48px] px-6 text-base shrink-0">
              <Wallet {...ICON_SM} />
              ชำระเงิน
            </button>
          </div>
        </div>
      )}

      {/* ===== ข้อความแจ้งผลการเพิ่มสินค้า ===== */}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-4 z-40 flex justify-center bottom-[calc(5.5rem_+_env(safe-area-inset-bottom))] lg:bottom-6"
        >
          <div className={notice.ok ? 'toast-ok' : 'toast-err'}>
            <span className="toast-icon">
              {notice.ok
                ? <Check size={18} strokeWidth={2.4} aria-hidden="true" />
                : <X size={18} strokeWidth={2.4} aria-hidden="true" />}
            </span>
            <span className="min-w-0 break-words">{notice.message}</span>
          </div>
        </div>
      )}

      {showScanner && (
        <BarcodeScanner
          title="สแกนสินค้าเข้าตะกร้า"
          onScan={handleScan}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* ===== บิลสำเร็จ ===== */}
      {success && successSale && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center scrim p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pos-success-title"
          onKeyDown={e => { if (e.key === 'Escape') startNewBill() }}
        >
          <div className="sheet w-full max-w-md max-h-[90dvh] overflow-y-auto overscroll-contain p-5 space-y-4 pb-[calc(1.25rem_+_env(safe-area-inset-bottom))] sm:pb-5 animate-pop-in">
            <div className="text-center">
              <span className={`icon-bubble icon-bubble-lg ${successSale.already_saved ? '' : 'icon-bubble-strong hop'}`}>
                {successSale.already_saved
                  ? <Info size={30} strokeWidth={1.8} aria-hidden="true" />
                  : <Check size={32} strokeWidth={2.4} aria-hidden="true" />}
              </span>
              <h3 id="pos-success-title" className="mt-3 text-xl font-bold text-gray-900">
                {successSale.already_saved ? 'บิลนี้บันทึกไว้แล้ว' : 'บันทึกการขายสำเร็จ'}
              </h3>
              <p className="mt-1 font-mono text-sm text-gray-600">เลขที่ {successSale.sale_no}</p>
              <p className="mt-0.5 flex flex-wrap items-center justify-center gap-x-1.5 text-xs text-gray-400">
                <span>{formatThaiDateTime(successSale.created_at)}</span>
                <span>·</span>
                <PaymentText method={successSale.payment_method} size={14} />
                {successSale.channel && successSale.channel !== 'store' && (
                  <>
                    <span>·</span>
                    <span>{saleChannelLabel(successSale.channel)}</span>
                  </>
                )}
              </p>
            </div>

            {successSale.already_saved && (
              <div className="alert-warn">
                <Info {...ICON_SM} />
                <p className="min-w-0">บิลนี้บันทึกไว้แล้ว ไม่ได้ตัดสต๊อกซ้ำ</p>
              </div>
            )}
            {success.cartMismatch && (
              <div className="alert-warn">
                <AlertTriangle {...ICON_SM} />
                <p className="min-w-0">
                  รายการในตะกร้าตอนกดล่าสุดไม่ตรงกับบิลที่บันทึกไว้ — ตรวจรายการด้านล่าง ถ้ายังมีสินค้าที่ต้องขายเพิ่ม ให้ขายเป็นบิลใหม่
                </p>
              </div>
            )}
            {priceChanged && (
              <div className="alert-warn">
                <AlertTriangle {...ICON_SM} />
                <p className="min-w-0">
                  ราคาสินค้าในระบบถูกอัปเดตระหว่างขาย — ยอดที่บันทึกจริงคือ <b>{baht(successSale.net_amount)}</b>{' '}
                  (หน้าจอแสดง {baht(success.shownNet)}) กรุณาเก็บเงินตามยอดจริง
                </p>
              </div>
            )}

            {successSale.items.length > 0 && (
              <ul className="panel divide-y divide-blush-hair px-3.5 text-sm">
                {successSale.items.map((it, i) => (
                  <li key={`${it.product_id}-${i}`} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-gray-900 break-words">{productLabel(it)}</p>
                      <p className="text-xs text-gray-400">{baht(it.unit_price)} × {it.qty}</p>
                    </div>
                    <p className="font-semibold text-gray-900 whitespace-nowrap tabular-nums">{baht(it.subtotal)}</p>
                  </li>
                ))}
              </ul>
            )}

            <div className="wave-divider decor" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>ยอดรวม</span><span className="tabular-nums">{baht(successSale.total_amount)}</span>
              </div>
              {successSale.discount > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>ส่วนลด</span><span className="tabular-nums">-{baht(successSale.discount)}</span>
                </div>
              )}
              <div className="flex justify-between items-center gap-3 pt-1">
                <span className="font-display text-base font-bold text-gray-900">ยอดสุทธิ</span>
                <span className="money min-w-0 break-words text-right text-2xl sm:text-3xl text-brand-700">{baht(successSale.net_amount)}</span>
              </div>
            </div>

            <button
              type="button"
              autoFocus
              onClick={startNewBill}
              className="btn-primary w-full min-h-[56px] text-lg"
            >
              <Receipt {...ICON} />
              ขายบิลใหม่
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
