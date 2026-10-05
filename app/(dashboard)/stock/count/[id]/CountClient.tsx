'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import BarcodeScanner, { type ScanFeedback } from '@/components/BarcodeScanner'
import ConfirmDialog from '@/components/integrations/ConfirmDialog'
import { baht, formatThaiDateTime, productLabel, thaiError, variantText } from '@/lib/format'
import { codeCandidates, findByCode, normalizeScannedCode } from '@/lib/barcode'
import { newUuid, sizeRank } from '@/lib/products'
import { FIX04_MISSING_MSG, isMigrationMissing } from '@/lib/migration'
import {
  computeCountTotals, countLineBlocksApply, countLineProblem, parseSetCountItemResult, parseStockCount, recalcCountItem,
  type CountLineProblem, type StockCount, type StockCountItem,
} from '@/lib/pos'
import { CountStatusChip, scopeText } from '../StockCountsClient'
import {
  AlertCircle, AlertTriangle, ArrowLeft, Ban, Camera, CheckCircle2, ClipboardCheck, Info, Loader2, Minus, Pencil,
  Plus, RotateCcw, Save, ScanBarcode, Search, SearchX, Trash2, Undo2, WifiOff, X,
} from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'

/** สินค้าที่นับได้ (page.tsx ดึงจากตาราง products: เปิดขาย + ไม่ใช่ไซส์ที่เลิกใช้) */
export interface CountProduct {
  id: string
  group_id: string | null
  name: string
  sku: string
  barcode: string | null
  size: string | null
  color: string | null
  category_id: string | null
  stock_qty: number
  cost_price: number
}

type CountMeta = Omit<StockCount, 'items' | 'totals' | 'already_applied'>
// fix = บรรทัดที่ต้องแก้ก่อนปรับยอด (ต้องนับใหม่ / ไซส์ที่เลิกใช้) — แสดงเฉพาะตอนมีรายการแบบนี้
type Tab = 'counted' | 'pending' | 'diff' | 'fix'

// คำสั่งแก้บรรทัด 1 คำสั่ง: add = บวก/ลบเพิ่ม (สแกน +1, ย้อน −1) / set = ตั้งจำนวน (null = เอาออกจากรายการนับ)
// id = รหัสคำสั่ง (p_op_id) สร้างตอนสร้างคำสั่ง — เน็ตหลุด/ตอบช้าแล้วไม่รู้ผล → ส่งซ้ำด้วยรหัสเดิม
//      เซิร์ฟเวอร์จำรหัสที่บันทึกแล้ว ส่งซ้ำจึงไม่บวกเบิ้ล และคำสั่งไม่หาย (นับครบพอดี 1 ครั้ง)
interface Op {
  id: string
  mode: 'add' | 'set'
  qty: number | null
  sending: boolean
  sent: boolean     // เคยส่งแล้ว (อาจบันทึกไปแล้ว) → ห้ามแก้จำนวน/รวมกับคำสั่งอื่น ต้องส่งซ้ำแบบเดิมเป๊ะ
  tries: number     // ส่งไปกี่ครั้งในรอบลองอัตโนมัติรอบนี้
  retryAt: number   // ส่งซ้ำได้หลังเวลานี้ (ms)
  stalled: boolean  // ลองอัตโนมัติครบแล้วยังไม่รู้ผล → รอเน็ตกลับมา / กดลองอีกครั้ง (ยังอยู่ในคิว ไม่ทิ้ง)
}

// สถานะการนับทั้งหมดเก็บใน ref (อ่าน/แก้ได้ทันทีจาก callback ของกล้อง/คำตอบเซิร์ฟเวอร์) แล้วสร้าง view ใหม่ลง state ทุกครั้งที่เปลี่ยน
interface Store {
  server: Map<string, StockCountItem>   // บรรทัดตามที่เซิร์ฟเวอร์ยืนยันล่าสุด
  queues: Map<string, Op[]>             // คำสั่งที่ยังไม่ได้คำตอบ แยกต่อสินค้า (ส่งทีละคำสั่งตามลำดับ)
  lastWrite: Map<string, number>        // เวลาที่ได้คำตอบบันทึกล่าสุดของสินค้านั้น — กันผลดึงยอดที่ส่งไปก่อนหน้ามาทับ
  info: Map<string, CountProduct>       // ข้อมูลสินค้าที่รู้จัก (จาก props + บรรทัดที่เคยเห็น)
  inFlight: number
  closed: boolean                       // รอบนี้ปรับยอด/ยกเลิกแล้ว → ไม่ส่งคำสั่งใดๆ อีก
}

interface View {
  items: StockCountItem[]   // บรรทัดที่แสดง = เซิร์ฟเวอร์ + คำสั่งที่ยังรอผล (optimistic) เรียงชื่อ → ไซส์ → SKU
  pendingIds: Set<string>   // สินค้าที่ยังมีคำสั่งรอผล
  queued: number            // จำนวนคำสั่งที่ยังไม่ได้บันทึก
  stalledIds: string[]      // สินค้าที่ส่งซ้ำอัตโนมัติครบแล้วยังไม่สำเร็จ (รอเน็ต/กดลองอีกครั้ง)
}

// แถวที่สแกนล่าสุด — existedBefore = ก่อนสแกนครั้งแรกของชุดนี้มีบรรทัดอยู่แล้วหรือไม่
// (ย้อนการสแกนชิ้นแรกของสินค้าที่ยังไม่เคยนับ = เอาบรรทัดออก ไม่ใช่เหลือ "นับได้ 0" ซึ่งจะปรับสต๊อกเป็น 0)
interface LastScan {
  pid: string
  existedBefore: boolean
}

type Editing = { pid: string; where: 'list' | 'panel' }
type Msg = { kind: 'ok' | 'err' | 'warn'; text: string }

const SERVER_MAX = 1000000       // เพดานของฐานข้อมูล
const MAX_COUNT = 100000         // เพดานในช่องกรอก — กันเลขบาร์โค้ดที่สแกนหลุดเข้าช่องจำนวนกลายเป็นยอดมหาศาล
const MAX_IN_FLIGHT = 4          // ส่งพร้อมกันได้ไม่เกินนี้ (คนละสินค้า)
const REQUEST_TIMEOUT_MS = 20000
const ACTION_TIMEOUT_MS = 45000  // ปรับยอดทั้งรอบอาจนาน (ล็อกสินค้าทุกตัว)
const POLL_MS = 15000            // หลายเครื่องช่วยกันนับ → ดึงยอดล่าสุดทุก 15 วินาทีขณะเปิดหน้านี้อยู่
const STALE_MS = 10000           // หน้าจากแคชของเบราว์เซอร์เก่ากว่านี้ → ดึงยอดใหม่ทันทีตอนเปิด
const PAGE_ROWS = 100            // แสดงรายการทีละ 100 แถว (สินค้าหลายพันรายการบนมือถือ)

// ส่งซ้ำอัตโนมัติเมื่อไม่รู้ผล (เน็ตหลุด/หมดเวลา): รอ 1 → 3 → 7 → 15 วินาที (รวมส่ง 5 ครั้ง) แล้วพักรอเน็ตกลับมา/กดลองอีกครั้ง
const RETRY_DELAYS_MS = [1000, 3000, 7000, 15000]
const MAX_TRIES = RETRY_DELAYS_MS.length + 1
const APPLY_UNSURE_MSG = 'ไม่แน่ใจว่าปรับยอดสำเร็จหรือไม่ (เน็ตหลุด/ตอบช้า) — ระบบกำลังตรวจสถานะล่าสุด ถ้ารอบนี้ยังขึ้นว่า "กำลังนับ" กดปรับยอดอีกครั้งได้เลย ระบบไม่ปรับซ้ำ'
const CANCEL_UNSURE_MSG = 'ไม่แน่ใจว่ายกเลิกรอบสำเร็จหรือไม่ (เน็ตหลุด/ตอบช้า) — ระบบกำลังตรวจสถานะล่าสุด กดยกเลิกอีกครั้งได้อย่างปลอดภัย'
const BAD_RESULT = 'ข้อมูลที่ได้กลับมาไม่ถูกต้อง'
// ข้อความของบรรทัดที่ต้องแก้ก่อนปรับยอด (กติกาฝั่งเซิร์ฟเวอร์: apply_stock_count ไม่ยอมถ้ายังมีบรรทัดแบบนี้ที่ทำให้สต๊อกเปลี่ยน)
const RECOUNT_MSG = 'ถูกปรับยอดจากรอบนับอื่น กรุณานับใหม่'
const ARCHIVED_MSG = 'ไซส์นี้ถูกเอาออกจากสินค้าระหว่างนับ — นับต่อไม่ได้ ให้ลบออกจากรายการนับ'
// สแกน +1 / ย้อน −1 กับบรรทัดที่ต้องนับใหม่ไม่ได้ (จะจำสต๊อกตอนนี้ใหม่ทั้งที่ยอดเดิมนับก่อนการปรับยอดนั้น → หักซ้ำแบบเงียบๆ)
const RECOUNT_SCAN_MSG = 'ต้องนับใหม่ — กรอกจำนวนที่นับได้ทั้งหมด'

const collator = new Intl.Collator('th')

type Sortable = { name: string; size: string | null; sku: string }

// ลำดับเดียวกับเซิร์ฟเวอร์: ชื่อ → ลำดับไซส์ → ไซส์ → SKU
function compareByProduct(a: Sortable, b: Sortable): number {
  const n = collator.compare(a.name, b.name)
  if (n) return n
  const r = sizeRank(a.size) - sizeRank(b.size)
  if (r) return r
  const s = collator.compare((a.size ?? '').toLowerCase(), (b.size ?? '').toLowerCase())
  if (s) return s
  return a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0
}

function int(n: number): string {
  return n.toLocaleString('en-US')
}

// +5 / -3 / 0
function signed(n: number): string {
  if (n > 0) return '+' + int(n)
  if (n < 0) return '-' + int(Math.abs(n))
  return '0'
}

function signedBaht(n: number): string {
  return n > 0 ? `+${baht(n)}` : baht(n)
}

function diffColor(n: number): string {
  if (n > 0) return 'text-green-700'
  if (n < 0) return 'text-red-700'
  return 'text-gray-400'
}

function clampCount(n: number): number {
  return Math.min(SERVER_MAX, Math.max(0, Math.trunc(n)))
}

function newOp(mode: 'add' | 'set', qty: number | null): Op {
  return { id: newUuid(), mode, qty, sending: false, sent: false, tries: 0, retryAt: 0, stalled: false }
}

// เลื่อนให้เห็นทั้งกล่อง (ช่องกรอก + ปุ่มบันทึก) เหนือแถบสรุปที่ติดขอบล่าง — ความสูงแถบเปลี่ยนได้ จึงวัดทุกครั้ง
function revealAboveBottomBar(el: HTMLElement | null) {
  if (!el) return
  const bar = document.getElementById('cnt-bottom-bar')
  const barH = bar ? bar.getBoundingClientRect().height : 0
  el.style.scrollMarginBottom = `${Math.ceil(barH) + 12}px`
  el.style.scrollMarginTop = '12px'
  el.scrollIntoView({ block: 'nearest' })
}

// แปลงเลขไทย ๐-๙ และตัวอักษรที่พิมพ์ตอนคีย์บอร์ดค้างภาษาไทย (ๅ/-ภถุึคตจ) กลับเป็นตัวเลข
function toAsciiDigits(text: string): string {
  const thaiDigits = text.replace(/[๐-๙]/g, d => String(d.charCodeAt(0) - 0x0e50))
  return /[฀-๿]/.test(thaiDigits) ? normalizeScannedCode(thaiDigits) : thaiDigits
}

function parseQty(text: string): number | null {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return Number.isSafeInteger(n) ? n : null
}

// error มาจากเซิร์ฟเวอร์จริง (มีรหัส Postgres/PostgREST) = ไม่ได้บันทึกแน่นอน
// ไม่มีรหัส = เน็ตหลุด/หมดเวลา/อ่านผลไม่ได้ → อาจบันทึกไปแล้วก็ได้ (ห้ามส่งซ้ำแบบบวกเพิ่ม)
function serverAnswered(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  if (typeof code !== 'string') return false
  return /^PGRST\d+$/.test(code) || /^(?!E)[0-9A-Z]{5}$/.test(code)
}

function infoFromItem(it: StockCountItem): CountProduct {
  return {
    id: it.product_id,
    group_id: it.group_id,
    name: it.name,
    sku: it.sku,
    barcode: it.barcode,
    size: it.size,
    color: it.color,
    category_id: it.category_id,
    stock_qty: it.current_qty,
    cost_price: it.cost_price,
  }
}

function itemFromInfo(p: CountProduct): StockCountItem {
  return {
    product_id: p.id,
    group_id: p.group_id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    size: p.size,
    color: p.color,
    category_id: p.category_id,
    is_active: true,
    is_archived: false,
    recount_needed: false,
    cost_price: p.cost_price,
    counted_qty: 0,
    system_qty_at_count: p.stock_qty,
    current_qty: p.stock_qty,
    expected_after: p.stock_qty,
    diff: 0,
    applied_before: null,
    applied_after: null,
    updated_at: null,
  }
}

// ผลของคำสั่งต่อบรรทัด (กติกาเดียวกับ set_stock_count_item) — ใช้แสดงผลทันทีก่อนเซิร์ฟเวอร์ตอบ
function applyOp(cur: StockCountItem | null, op: Op, info: CountProduct | undefined): StockCountItem | null {
  if (op.mode === 'set' && op.qty === null) return null
  const base = cur ?? (info ? itemFromInfo(info) : null)
  if (!base) return cur
  const counted = op.mode === 'set'
    ? clampCount(op.qty ?? 0)
    : clampCount((cur ? cur.counted_qty : 0) + (op.qty ?? 0))
  // ทุกครั้งที่แก้บรรทัด เซิร์ฟเวอร์จำ "สต๊อกในระบบ ณ ตอนนี้" ใหม่ → ยอดหลังปรับ = จำนวนที่นับ
  // และการปรับยอดจากรอบอื่นก่อนหน้านี้ไม่นับซ้ำแล้ว → ธง "ต้องนับใหม่" หายไปด้วย
  return recalcCountItem({ ...base, counted_qty: counted, system_qty_at_count: base.current_qty, recount_needed: false })
}

function displayItemOf(s: Store, pid: string): StockCountItem | null {
  let cur = s.server.get(pid) ?? null
  const q = s.queues.get(pid)
  if (q) {
    const info = s.info.get(pid)
    for (let i = 0; i < q.length; i++) cur = applyOp(cur, q[i], info)
  }
  return cur
}

function buildView(s: Store): View {
  const ids = new Set<string>()
  s.server.forEach((_, pid) => ids.add(pid))
  const pendingIds = new Set<string>()
  const stalledIds: string[] = []
  let queued = 0
  s.queues.forEach((q, pid) => {
    if (q.length === 0) return
    ids.add(pid)
    pendingIds.add(pid)
    queued += q.length
    if (q.some(o => o.stalled)) stalledIds.push(pid)
  })
  const items: StockCountItem[] = []
  ids.forEach(pid => {
    const it = displayItemOf(s, pid)
    if (it) items.push(it)
  })
  items.sort(compareByProduct)
  return { items, pendingIds, queued, stalledIds }
}

function initStore(c: StockCount, products: CountProduct[]): Store {
  const info = new Map<string, CountProduct>()
  for (let i = 0; i < products.length; i++) info.set(products[i].id, products[i])
  const server = new Map<string, StockCountItem>()
  for (let i = 0; i < c.items.length; i++) {
    const it = c.items[i]
    server.set(it.product_id, it)
    info.set(it.product_id, infoFromItem(it))
  }
  return { server, queues: new Map(), lastWrite: new Map(), info, inFlight: 0, closed: c.status !== 'open' }
}

function metaOf(c: StockCount): CountMeta {
  return {
    id: c.id,
    name: c.name,
    note: c.note,
    category_id: c.category_id,
    category_name: c.category_name,
    status: c.status,
    created_at: c.created_at,
    created_by_name: c.created_by_name,
    applied_at: c.applied_at,
    applied_by_name: c.applied_by_name,
    cancelled_at: c.cancelled_at,
    summary: c.summary,
  }
}

type Searchable = { name: string; sku: string; barcode: string | null; size: string | null; color: string | null }

function matchesSearch(p: Searchable, tokens: string[], codes: string[]): boolean {
  const hay = `${p.name} ${p.sku} ${p.barcode ?? ''} ${variantText(p)}`.toLowerCase()
  if (tokens.every(t => hay.includes(t))) return true
  // พิมพ์/สแกนตอนคีย์บอร์ดเป็นภาษาไทย → ลองเทียบกับ SKU/บาร์โค้ดที่แปลงกลับแล้ว
  const sku = p.sku.toLowerCase()
  const bc = (p.barcode ?? '').toLowerCase()
  return codes.some(c => sku.includes(c) || (bc !== '' && bc.includes(c)))
}

// แถวในรายการ: บรรทัดที่นับแล้ว หรือสินค้าที่ยังไม่นับ
interface RowEntry {
  pid: string
  name: string
  variant: string
  sku: string
  barcode: string | null
  item: StockCountItem | null
  stock: number // สต๊อกในระบบที่แสดง (รอบเปิด: ตอนนี้ / ปรับแล้ว: ก่อนปรับ)
}

export default function CountClient({ initialCount, products, showCost, loadedAt }: {
  initialCount: StockCount
  products: CountProduct[]
  showCost: boolean   // มูลค่าส่วนต่าง (ราคาทุน) เฉพาะแอดมิน/ผู้มีสิทธิ์ดูรายงาน
  loadedAt: number    // เวลาที่เซิร์ฟเวอร์ดึงข้อมูลหน้านี้ (ms)
}) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const countId = initialCount.id

  const storeRef = useRef<Store | null>(null)
  if (storeRef.current === null) storeRef.current = initStore(initialCount, products)
  const [view, setView] = useState<View>(() => buildView(storeRef.current as Store))
  const [meta, setMeta] = useState<CountMeta>(() => metaOf(initialCount))

  const [tab, setTab] = useState<Tab>('counted')
  const [search, setSearch] = useState('')
  const [searchMsg, setSearchMsg] = useState('')
  const [limitState, setLimitState] = useState<{ key: string; n: number }>({ key: '', n: PAGE_ROWS })
  const [editing, setEditing] = useState<Editing | null>(null)
  const [lastScan, setLastScan] = useState<LastScan | null>(null)
  const [showScanner, setShowScanner] = useState(false)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState('')
  const [announce, setAnnounce] = useState('')
  const [confirm, setConfirm] = useState<'apply' | 'cancel' | null>(null)
  const [action, setAction] = useState<'apply' | 'cancel' | null>(null)
  const [actionMsg, setActionMsg] = useState<Msg | null>(null)
  const actionBusyRef = useRef(false)
  const fetchingRef = useRef(false)
  const fetchAgainRef = useRef(false)
  // คนที่เรียก fetchCount ระหว่างที่กำลังดึงอยู่ → รอรอบดึงถัดไป (ที่เริ่มหลังเรียก) ให้เสร็จก่อนค่อยทำต่อ
  const fetchWaitersRef = useRef<(() => void)[]>([])
  const retryTimersRef = useRef<Set<number>>(new Set())
  const tabRowRef = useRef<HTMLDivElement>(null)

  const isOpen = meta.status === 'open'
  // รอบที่ยกเลิกแล้ว: สต๊อกไม่ถูกปรับ และส่วนต่างที่คิดกับยอดสต๊อกปัจจุบันไม่มีความหมาย (ไม่มีวันถูกใช้)
  // → ไม่แสดงคอลัมน์/แท็บ/ยอดรวมส่วนต่าง เหลือแค่ยอดที่นับได้ (กันอ่านตัวเลขที่ไม่ตรงกันแล้วเข้าใจผิด)
  const showDiff = meta.status !== 'cancelled'

  function store(): Store {
    return storeRef.current as Store
  }

  function refreshView() {
    setView(buildView(store()))
  }

  function labelOf(pid: string): string {
    const info = store().info.get(pid)
    return info ? productLabel(info) : 'สินค้า'
  }

  // ===== ส่งคำสั่งไปเซิร์ฟเวอร์: ทีละคำสั่งต่อสินค้า (ลำดับ +1/−1 ถูกต้องเสมอ) หลายสินค้าส่งพร้อมกันได้ =====
  function pumpAll() {
    const s = store()
    if (s.closed) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setOffline(true)
      return
    }
    const now = Date.now()
    const pids = Array.from(s.queues.keys())
    for (let i = 0; i < pids.length && s.inFlight < MAX_IN_FLIGHT; i++) {
      const q = s.queues.get(pids[i])
      if (!q || q.length === 0) continue
      const head = q[0]
      // ยังรอส่งซ้ำ (หน่วงเวลา) / พักอยู่ → ข้าม (คำสั่งถัดไปของสินค้าเดียวกันต้องรอคำสั่งนี้ก่อนเสมอ)
      if (head.sending || head.stalled || head.retryAt > now) continue
      void sendHead(pids[i])
    }
  }

  function scheduleRetry(delay: number) {
    const id = window.setTimeout(() => {
      retryTimersRef.current.delete(id)
      actionsRef.current.pumpAll()
    }, delay + 50)
    retryTimersRef.current.add(id)
  }

  // คำสั่งที่พักไว้ (ส่งซ้ำอัตโนมัติครบแล้ว) → ให้ลองใหม่อีกรอบ (เน็ตกลับมา / กลับมาที่แท็บ / กดลองอีกครั้ง / คำขออื่นสำเร็จ)
  function resumeStalled(): boolean {
    let any = false
    store().queues.forEach(q => {
      const head = q[0]
      if (head && head.stalled) {
        head.stalled = false
        head.tries = 0
        head.retryAt = 0
        any = true
      }
    })
    return any
  }

  function retryStalled() {
    if (resumeStalled()) refreshView()
    pumpAll()
  }

  function removeOp(pid: string, op: Op) {
    const s = store()
    const q = s.queues.get(pid)
    if (!q) return
    const i = q.indexOf(op)
    if (i >= 0) q.splice(i, 1)
    if (q.length === 0) s.queues.delete(pid)
  }

  async function sendHead(pid: string) {
    const s = store()
    const q = s.queues.get(pid)
    const op = q ? q[0] : undefined
    if (!op || op.sending) return
    op.sending = true
    op.sent = true
    op.tries++
    s.inFlight++
    let resumed = false
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = setTimeout(() => ctrl?.abort(), REQUEST_TIMEOUT_MS)
    try {
      let req = supabase.rpc('set_stock_count_item', {
        p_count_id: countId,
        p_product_id: pid,
        p_qty: op.qty,
        p_mode: op.mode,
        p_op_id: op.id,
      })
      if (ctrl) req = req.abortSignal(ctrl.signal)
      const { data, error: rpcError } = await req
      if (rpcError) throw rpcError
      const res = parseSetCountItemResult(data)
      if (!res) throw new Error(BAD_RESULT) // ไม่มีรหัส → ถือว่าไม่แน่ใจ ส่งซ้ำด้วยรหัสเดิม (เซิร์ฟเวอร์ไม่ทำซ้ำ)
      removeOp(pid, op)
      // เซิร์ฟเวอร์ตอบได้แล้ว → คำสั่งที่พักไว้ของสินค้าอื่นลองส่งใหม่ได้เลย
      resumed = resumeStalled()
      // รอบถูกปิดระหว่างรอคำตอบ → ข้อมูลรอบที่ปิดแล้วใหม่กว่า ไม่ต้องเอาผลนี้ไปทับ
      if (!s.closed) {
        if (res.removed) {
          s.server.delete(pid)
        } else {
          s.server.set(pid, res.item)
          s.info.set(pid, infoFromItem(res.item))
        }
        s.lastWrite.set(pid, Date.now())
      }
    } catch (err) {
      if (serverAnswered(err)) {
        // เซิร์ฟเวอร์ปฏิเสธจริง (ไม่ได้บันทึกแน่นอน) → ทิ้งคำสั่งที่ค้างของสินค้านี้ทั้งหมด (ยอดบนจอกลับไปตามที่บันทึกไว้ล่าสุด)
        removeOp(pid, op)
        s.queues.delete(pid)
        const msg = isMigrationMissing(err) ? FIX04_MISSING_MSG : thaiError(err)
        setError(`บันทึกการนับ "${labelOf(pid)}" ไม่สำเร็จ: ${msg}`)
        // รอบถูกปรับยอด/ยกเลิกจากเครื่องอื่น → ดึงสถานะใหม่ให้หน้าเป็นแบบอ่านอย่างเดียว
        // ต้องนับใหม่ (ถูกปรับยอดจากรอบอื่น) → ดึงธงล่าสุดมาให้แถวขึ้นว่าต้องนับใหม่
        if (/ปิดไปแล้ว|ไม่พบรอบ|ยกเลิกแล้ว|ต้องนับใหม่/.test(msg)) void fetchCount()
      } else {
        // ไม่รู้ผล (เน็ตหลุด/หมดเวลา/อ่านคำตอบไม่ได้) → คงคำสั่งไว้หัวคิว แล้วส่งซ้ำด้วยรหัสเดิม
        // (ถ้าครั้งก่อนเข้าไปแล้ว เซิร์ฟเวอร์ตอบบรรทัดปัจจุบันกลับมาโดยไม่บวกซ้ำ) — ไม่ทิ้ง ไม่ต้องให้คนนับเช็คเอง
        op.sending = false
        if (!s.closed && s.queues.get(pid)?.[0] === op) {
          if (op.tries >= MAX_TRIES) {
            op.stalled = true
          } else {
            const delay = RETRY_DELAYS_MS[Math.min(op.tries, RETRY_DELAYS_MS.length) - 1]
            op.retryAt = Date.now() + delay
            scheduleRetry(delay)
          }
        }
      }
    } finally {
      clearTimeout(timer)
      s.inFlight--
      refreshView()
      if (resumed) setOffline(false)
      pumpAll()
    }
  }

  // ต่อคิวคำสั่งของสินค้า (รวมคำสั่งที่ยังไม่ได้ส่งเข้าด้วยกันเมื่อผลลัพธ์เหมือนเดิม → ยิงน้อยลงตอนสแกนรัวๆ)
  function enqueue(pid: string, mode: 'add' | 'set', qty: number | null): boolean {
    const s = store()
    if (s.closed) return false
    const q = s.queues.get(pid) ?? []
    const last = q.length > 0 ? q[q.length - 1] : null
    // แก้ได้เฉพาะคำสั่งที่ยังไม่เคยส่ง (คำสั่งที่ส่งแล้วอาจบันทึกไปแล้ว ต้องส่งซ้ำแบบเดิมเป๊ะด้วยรหัสเดิม)
    const editable = !!last && !last.sending && !last.sent
    if (mode === 'set') {
      // ตั้งจำนวนใหม่ = ทับคำสั่งที่ยังไม่เคยส่งทั้งหมด (ผลเท่ากัน) — คำสั่งที่ส่งแล้ว/รอส่งซ้ำ ยังต้องรู้ผลก่อน
      const kept = q.filter(o => o.sending || o.sent)
      kept.push(newOp(mode, qty))
      s.queues.set(pid, kept)
    } else {
      const d = qty ?? 0
      if (d === 0) return false
      if (last && editable && last.mode === 'add' && last.qty !== null && Math.sign(last.qty) === Math.sign(d)) {
        // บวกต่อบวก / ลบต่อลบ รวมกันได้ (ผลเท่าเดิมแม้ติดเพดาน 0)
        last.qty = Math.max(-SERVER_MAX, Math.min(SERVER_MAX, last.qty + d))
      } else if (last && editable && last.mode === 'set' && last.qty !== null) {
        last.qty = clampCount(last.qty + d)
      } else {
        q.push(newOp(mode, d))
        s.queues.set(pid, q)
      }
    }
    refreshView()
    pumpAll()
    return true
  }

  // ===== ดึงยอดล่าสุดของทั้งรอบ (หลายเครื่องนับพร้อมกัน / ตรวจผลหลังเน็ตหลุด) =====
  function mergeFetched(fresh: StockCount, startedAt: number) {
    const s = store()
    // รอบที่ปิดแล้วไม่มีทางกลับมาเปิด → ผลดึงที่ส่งไปก่อนกดปรับยอด/ยกเลิกแต่ตอบกลับมาทีหลัง ต้องไม่ทับสถานะปิด
    if (s.closed && fresh.status === 'open') return
    for (let i = 0; i < fresh.items.length; i++) s.info.set(fresh.items[i].product_id, infoFromItem(fresh.items[i]))
    if (fresh.status !== 'open') {
      // รอบปิดแล้ว (เครื่องนี้หรือเครื่องอื่นกดปรับยอด/ยกเลิก) → ใช้ข้อมูลเซิร์ฟเวอร์ทั้งหมด ทิ้งคำสั่งที่ยังไม่ได้ส่ง
      let dropped = 0
      let unknown = 0
      s.queues.forEach(q => {
        for (let i = 0; i < q.length; i++) {
          if (q[i].sending) continue
          if (q[i].sent) unknown++
          else dropped++
        }
      })
      s.queues.clear()
      s.server = new Map(fresh.items.map(it => [it.product_id, it]))
      s.closed = true
      if (dropped + unknown > 0) {
        const head = `รอบนี้${fresh.status === 'applied' ? 'ปรับยอดไปแล้ว' : 'ถูกยกเลิกแล้ว'}`
        const parts: string[] = []
        if (dropped > 0) parts.push(`การนับ ${int(dropped)} รายการที่ยังไม่ได้ส่งถูกทิ้ง`)
        if (unknown > 0) parts.push(`อีก ${int(unknown)} รายการส่งไปแล้วแต่ไม่รู้ว่าทันก่อนปิดรอบหรือไม่ — ยอดในรายการคือยอดที่บันทึกจริง`)
        setError(`${head} — ${parts.join(' · ')}`)
      }
      setEditing(null)
      setShowScanner(false)
      setConfirm(null)
    } else {
      const freshMap = new Map(fresh.items.map(it => [it.product_id, it]))
      const pids = new Set<string>()
      s.server.forEach((_, pid) => pids.add(pid))
      freshMap.forEach((_, pid) => pids.add(pid))
      pids.forEach(pid => {
        // กำลังส่งคำสั่งของสินค้านี้อยู่ / ส่งไปแล้วยังไม่รู้ผล (รอส่งซ้ำ) / เพิ่งได้คำตอบหลังเริ่มดึง → ข้อมูลในเครื่องใหม่กว่า
        // (คำสั่งที่ไม่รู้ผลอาจเข้าไปแล้ว: ถ้าเอายอดเซิร์ฟเวอร์มาบวกคำสั่งนี้ซ้ำบนจอ จะเห็นยอดเบิ้ลจนกว่าส่งซ้ำเสร็จ)
        const q = s.queues.get(pid)
        if (q && q.some(o => o.sending || o.sent)) return
        const w = s.lastWrite.get(pid)
        if (w !== undefined && w >= startedAt) return
        const f = freshMap.get(pid)
        if (f) s.server.set(pid, f)
        else s.server.delete(pid)
      })
    }
    setMeta(metaOf(fresh))
    refreshView()
  }

  // ดึงอยู่แล้ว → ต่อคิวดึงอีกรอบ และ promise ของผู้เรียกจะเสร็จเมื่อรอบที่ต่อคิวนั้นเสร็จ (ได้ข้อมูลที่ขอหลังเรียกจริง)
  async function fetchCount(): Promise<void> {
    if (fetchingRef.current) {
      fetchAgainRef.current = true
      return new Promise<void>(resolve => { fetchWaitersRef.current.push(resolve) })
    }
    fetchingRef.current = true
    const startedAt = Date.now()
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = setTimeout(() => ctrl?.abort(), REQUEST_TIMEOUT_MS)
    try {
      let req = supabase.rpc('get_stock_count', { p_count_id: countId })
      if (ctrl) req = req.abortSignal(ctrl.signal)
      const { data, error: rpcError } = await req
      if (rpcError) {
        // สิทธิ์ถูกถอด/หมดเวลาเข้าสู่ระบบ ต้องบอก — เน็ตหลุดเงียบไว้ รอบถัดไปลองใหม่เอง
        if (serverAnswered(rpcError)) setError(`ดึงยอดล่าสุดไม่สำเร็จ: ${thaiError(rpcError)}`)
        return
      }
      const fresh = parseStockCount(data)
      if (fresh) mergeFetched(fresh, startedAt)
    } catch {
      /* เน็ตหลุด — ดึงใหม่รอบถัดไป */
    } finally {
      clearTimeout(timer)
      fetchingRef.current = false
      if (fetchAgainRef.current) {
        fetchAgainRef.current = false
        const waiters = fetchWaitersRef.current
        fetchWaitersRef.current = []
        void fetchCount().finally(() => { for (let i = 0; i < waiters.length; i++) waiters[i]() })
      }
    }
  }

  // ฟังก์ชันล่าสุดให้ effect เรียก (ใช้แต่ ref/setState จึงไม่ต้องผูกกับ effect)
  const actionsRef = useRef({ fetchCount, pumpAll, retryStalled })
  useEffect(() => {
    actionsRef.current = { fetchCount, pumpAll, retryStalled }
  })

  // ปิดหน้า → ยกเลิกตัวจับเวลาส่งซ้ำที่ค้าง
  useEffect(() => {
    const timers = retryTimersRef.current
    return () => {
      timers.forEach(id => window.clearTimeout(id))
      timers.clear()
    }
  }, [])

  // ดึงยอดทุก 15 วินาทีขณะเปิดหน้าอยู่ + ทันทีที่กลับมาที่แท็บ/เน็ตกลับมา (ส่งคิวที่ค้างต่อ)
  useEffect(() => {
    if (meta.status !== 'open') return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) setOffline(true)
    function poll() {
      if (document.visibilityState === 'visible' && navigator.onLine !== false) void actionsRef.current.fetchCount()
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') {
        actionsRef.current.retryStalled()
        poll()
      }
    }
    function onOnline() {
      setOffline(false)
      actionsRef.current.retryStalled()
      void actionsRef.current.fetchCount()
    }
    function onOffline() {
      setOffline(true)
    }
    const timer = window.setInterval(poll, POLL_MS)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [meta.status])

  // เปิดหน้าจากแคชของเบราว์เซอร์ (กดย้อนกลับมา) → ข้อมูลอาจเก่า ดึงใหม่ทันที
  useEffect(() => {
    if (initialCount.status === 'open' && Math.abs(Date.now() - loadedAt) > STALE_MS) void actionsRef.current.fetchCount()
  }, [initialCount.status, loadedAt])

  // ยังมีการนับที่ยังไม่ได้บันทึก → เตือนก่อนปิด/รีโหลดหน้า
  const hasQueued = view.queued > 0
  useEffect(() => {
    if (!hasQueued) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasQueued])

  // ===== นับ / ย้อน / แก้จำนวน =====
  // บรรทัดของไซส์ที่ถูกเอาออกจากสินค้าระหว่างนับ: เซิร์ฟเวอร์ไม่ให้นับเพิ่ม/แก้จำนวน (ลบออกได้อย่างเดียว)
  // → กันไว้ในเครื่องเลย ไม่ส่งไปให้โดนปฏิเสธเป็น "ไม่พบสินค้านี้" ซึ่งอ่านแล้วไม่รู้ว่าต้องทำอะไร
  function archivedLabel(pid: string): string | null {
    const cur = displayItemOf(store(), pid)
    return cur && cur.is_archived ? labelOf(pid) : null
  }

  // บรรทัดที่ต้องนับใหม่: สแกน +1 / ย้อน −1 ไม่ได้ → เปิดช่องกรอกจำนวนทั้งหมดของสินค้านั้นแทน
  function recountLabel(pid: string): string | null {
    const cur = displayItemOf(store(), pid)
    return cur && cur.recount_needed && !cur.is_archived ? labelOf(pid) : null
  }

  function openRecount(pid: string) {
    setLastScan(prev => (prev && prev.pid === pid ? prev : { pid, existedBefore: true }))
    setEditing({ pid, where: 'panel' })
    setAnnounce(`${labelOf(pid)} ${RECOUNT_SCAN_MSG}`)
  }

  function countOne(pid: string): StockCountItem | null {
    const s = store()
    if (s.closed) return null
    const before = displayItemOf(s, pid)
    if (before && before.is_archived) return null
    if (before && before.recount_needed) {
      openRecount(pid)
      return null
    }
    const existed = before !== null
    if (!enqueue(pid, 'add', 1)) return null
    const after = displayItemOf(s, pid)
    setLastScan(prev => (prev && prev.pid === pid ? prev : { pid, existedBefore: existed }))
    setEditing(prev => (prev && prev.pid === pid ? null : prev))
    setAnnounce(`${labelOf(pid)} นับแล้ว ${int(after ? after.counted_qty : 0)}`)
    return after
  }

  function undoLast() {
    if (!lastScan) return
    const s = store()
    const cur = displayItemOf(s, lastScan.pid)
    if (!cur || cur.counted_qty <= 0 || cur.is_archived) return
    if (cur.recount_needed) {
      openRecount(lastScan.pid)
      return
    }
    if (!lastScan.existedBefore && cur.counted_qty <= 1) enqueue(lastScan.pid, 'set', null)
    else enqueue(lastScan.pid, 'add', -1)
    const after = displayItemOf(s, lastScan.pid)
    setAnnounce(after ? `${labelOf(lastScan.pid)} เหลือ ${int(after.counted_qty)}` : `เอา ${labelOf(lastScan.pid)} ออกจากรายการนับแล้ว`)
  }

  function closeEditor(pid?: string) {
    setEditing(null)
    // คืนโฟกัสให้แถวเดิม (คีย์บอร์ด/โปรแกรมอ่านจอไม่หลงตำแหน่ง)
    if (pid) setTimeout(() => document.getElementById(`cnt-row-${pid}`)?.focus(), 0)
  }

  function saveExact(pid: string, qty: number, where: 'list' | 'panel') {
    const s = store()
    const cur = displayItemOf(s, pid)
    closeEditor(where === 'list' ? pid : undefined)
    if (cur && cur.is_archived) return
    // จำนวนเท่าเดิม → ไม่ส่ง (ส่งไปจะจำ "สต๊อก ณ ตอนนับ" ใหม่ ยอดที่ขายระหว่างนับจะไม่ถูกหักแล้ว)
    // ยกเว้นบรรทัดที่ "ต้องนับใหม่": นับแล้วได้เท่าเดิมก็ต้องส่ง เพื่อให้เซิร์ฟเวอร์จำสต๊อก ณ ตอนนับใหม่ (ไม่งั้นปรับยอดไม่ได้)
    if (cur && cur.counted_qty === qty && !cur.recount_needed) return
    if (enqueue(pid, 'set', qty)) setAnnounce(`${labelOf(pid)} นับได้ ${int(qty)}`)
  }

  function removeLine(pid: string, where: 'list' | 'panel') {
    closeEditor(where === 'list' ? pid : undefined)
    if (enqueue(pid, 'set', null)) setAnnounce(`เอา ${labelOf(pid)} ออกจากรายการนับแล้ว`)
  }

  // ===== สินค้าที่สแกน/ค้นหาได้ = สินค้าที่เปิดขาย + สินค้าที่อยู่ในรอบนับแล้ว (อาจถูกปิดขายไปทีหลัง) =====
  const scanPool = useMemo<CountProduct[]>(() => {
    const ids = new Set(products.map(p => p.id))
    const extra: CountProduct[] = []
    for (let i = 0; i < view.items.length; i++) {
      if (!ids.has(view.items[i].product_id)) extra.push(infoFromItem(view.items[i]))
    }
    return extra.length > 0 ? products.concat(extra) : products
  }, [products, view.items])

  const sortedProducts = useMemo(() => products.slice().sort(compareByProduct), [products])

  const q = search.trim().toLowerCase()
  const searchTokens = useMemo(() => (q ? q.split(/\s+/).filter(Boolean) : []), [q])
  const searchCodes = useMemo(() => (q ? codeCandidates(search).map(c => c.toLowerCase()) : []), [q, search])
  const searchMatches = useMemo(
    () => (q ? scanPool.filter(p => matchesSearch(p, searchTokens, searchCodes)) : []),
    [q, scanPool, searchTokens, searchCodes],
  )

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    const raw = search.trim()
    if (!raw || !isOpen) return
    // เครื่องสแกน USB พิมพ์รหัสแล้วกด Enter → รหัสตรงเป๊ะ (หรือเจอรายการเดียว) = นับเพิ่ม 1
    const target = findByCode(scanPool, raw) ?? (searchMatches.length === 1 ? searchMatches[0] : null)
    const archived = target ? archivedLabel(target.id) : null
    if (archived) {
      setSearchMsg(`"${archived}" ${ARCHIVED_MSG}`)
      e.currentTarget.select()
      return
    }
    const recount = target ? recountLabel(target.id) : null
    if (target && recount) {
      setSearch('')
      setSearchMsg(`"${recount}" ${RECOUNT_SCAN_MSG}`)
      openRecount(target.id)
      return
    }
    if (target) {
      countOne(target.id)
      setSearch('')
      setSearchMsg('')
      return
    }
    setSearchMsg(searchMatches.length === 0
      ? `ไม่พบสินค้า: ${raw}`
      : `พบ ${int(searchMatches.length)} รายการ — แตะสินค้าในรายการด้านล่างเพื่อกรอกจำนวน`)
    // เลือกข้อความไว้ — สแกนครั้งต่อไปจะพิมพ์ทับ ไม่ต่อท้ายรหัสเดิม
    e.currentTarget.select()
  }

  function handleScan(code: string): ScanFeedback {
    if (store().closed) return { ok: false, message: 'รอบนับนี้ปิดไปแล้ว' }
    const p = findByCode(scanPool, code)
    if (!p) return { ok: false, message: `ไม่พบสินค้า: ${code}` }
    const archived = archivedLabel(p.id)
    if (archived) return { ok: false, message: `"${archived}" ${ARCHIVED_MSG}` }
    const recount = recountLabel(p.id)
    if (recount) {
      openRecount(p.id)
      return { ok: false, message: `"${recount}" ${RECOUNT_SCAN_MSG} (ปิดกล้องแล้วกรอกจำนวน)` }
    }
    const after = countOne(p.id)
    return { ok: true, message: `${productLabel(p)} นับแล้ว ${int(after ? after.counted_qty : 1)}` }
  }

  // ===== รายการตามแท็บ =====
  const countedIds = useMemo(() => new Set(view.items.map(it => it.product_id)), [view.items])
  const scopeId = meta.category_id
  const notCounted = useMemo(
    () => sortedProducts.filter(p => (!scopeId || p.category_id === scopeId) && !countedIds.has(p.id)),
    [sortedProducts, scopeId, countedIds],
  )
  const diffItems = useMemo(() => view.items.filter(it => it.diff !== 0), [view.items])
  const totals = useMemo(() => computeCountTotals(view.items), [view.items])
  const changedLines = diffItems.length

  // บรรทัดที่ต้องแก้ก่อนปรับยอด (เฉพาะรอบที่ยังเปิด) — ธงมาจากเซิร์ฟเวอร์ (ดึงยอดทุก 15 วินาที) ; แก้ในเครื่องแล้วหายทันที (optimistic)
  //   blocking = บรรทัดที่เซิร์ฟเวอร์จะปฏิเสธจริง (มีปัญหา และทำให้สต๊อกเปลี่ยน) — บรรทัดที่ยอดตรงอยู่แล้วไม่ขวาง
  const fixItems = useMemo(
    () => (isOpen ? view.items.filter(it => countLineProblem(it) !== null) : []),
    [isOpen, view.items],
  )
  const fixInfo = useMemo(() => {
    const blocking = fixItems.filter(countLineBlocksApply)
    const pick = blocking.length > 0 ? blocking : fixItems
    let recount = 0
    let archived = 0
    for (let i = 0; i < pick.length; i++) {
      if (countLineProblem(pick[i]) === 'archived') archived++
      else recount++
    }
    return { total: fixItems.length, blocking: blocking.length, recount, archived }
  }, [fixItems])

  const activeTab: Tab = (!isOpen && (tab === 'pending' || tab === 'fix')) || (!showDiff && tab === 'diff') ? 'counted' : tab

  const tabLists = useMemo(() => {
    const m = (p: Searchable) => !q || matchesSearch(p, searchTokens, searchCodes)
    return {
      counted: q ? view.items.filter(m) : view.items,
      diff: q ? diffItems.filter(m) : diffItems,
      fix: q ? fixItems.filter(m) : fixItems,
      pending: q ? notCounted.filter(m) : notCounted,
    }
  }, [q, searchTokens, searchCodes, view.items, diffItems, fixItems, notCounted])

  const rows: RowEntry[] = useMemo(() => {
    if (activeTab === 'pending') {
      return tabLists.pending.map(p => ({
        pid: p.id, name: p.name, variant: variantText(p), sku: p.sku, barcode: p.barcode, item: null, stock: p.stock_qty,
      }))
    }
    const list = activeTab === 'diff' ? tabLists.diff : activeTab === 'fix' ? tabLists.fix : tabLists.counted
    return list.map(it => ({
      pid: it.product_id,
      name: it.name,
      variant: variantText(it),
      sku: it.sku,
      barcode: it.barcode,
      item: it,
      stock: meta.status === 'applied' ? it.applied_before ?? it.current_qty : it.current_qty,
    }))
  }, [activeTab, tabLists, meta.status])

  const listKey = `${activeTab}|${q}`
  const limit = limitState.key === listKey ? limitState.n : PAGE_ROWS
  const visibleRows = rows.slice(0, limit)

  const tabs: { key: Tab; label: string; count: number; hidden?: boolean }[] = [
    { key: 'counted', label: 'นับแล้ว', count: q ? tabLists.counted.length : view.items.length },
    { key: 'pending', label: 'ยังไม่นับ', count: q ? tabLists.pending.length : notCounted.length, hidden: !isOpen },
    { key: 'diff', label: 'มีส่วนต่าง', count: q ? tabLists.diff.length : diffItems.length, hidden: !showDiff },
    // แท็บนี้โผล่เมื่อมีรายการต้องแก้ — ถ้ากำลังดูอยู่แล้วแก้ครบ ยังค้างไว้ให้เห็นว่า "แก้ครบแล้ว"
    {
      key: 'fix',
      label: 'ต้องแก้ไข',
      count: q ? tabLists.fix.length : fixItems.length,
      hidden: !isOpen || (fixItems.length === 0 && activeTab !== 'fix'),
    },
  ]

  // แท็บที่เลือกอยู่ต้องเห็นเต็มเสมอ — มือถือแถวแท็บกว้างกว่าจอ (เลื่อนข้าง) แท็บท้าย "ต้องแก้ไข" จะโดนตัดครึ่ง
  // เลื่อนเฉพาะแนวนอนของแถวแท็บ (ไม่ใช้ scrollIntoView ซึ่งจะไปขัดการเลื่อนหน้าของ showFixTab)
  const fixTabShown = isOpen && (fixItems.length > 0 || activeTab === 'fix')
  useEffect(() => {
    const row = tabRowRef.current
    const chip = row ? row.querySelector<HTMLElement>(`[data-tab="${activeTab}"]`) : null
    if (!row || !chip) return
    const r = row.getBoundingClientRect()
    const c = chip.getBoundingClientRect()
    if (c.right > r.right) row.scrollLeft += c.right - r.right + 8
    else if (c.left < r.left) row.scrollLeft -= r.left - c.left + 8
  }, [activeTab, fixTabShown])

  // ไปที่แท็บ "ต้องแก้ไข" แล้วเลื่อนรายการขึ้นมาให้เห็น (ปุ่มอยู่ในแถบล่าง/ข้อความผิดพลาด ซึ่งอาจอยู่ไกลจากรายการ)
  function showFixTab() {
    setTab('fix')
    setTimeout(() => document.getElementById('cnt-list')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0)
  }

  // ===== ปรับยอด / ยกเลิกรอบ =====
  async function runAction(kind: 'apply' | 'cancel') {
    if (actionBusyRef.current) return
    actionBusyRef.current = true
    setAction(kind)
    setActionMsg(null)
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = setTimeout(() => ctrl?.abort(), ACTION_TIMEOUT_MS)
    try {
      let req = supabase.rpc(kind === 'apply' ? 'apply_stock_count' : 'cancel_stock_count', { p_count_id: countId })
      if (ctrl) req = req.abortSignal(ctrl.signal)
      const { data, error: rpcError } = await req
      if (rpcError) throw rpcError
      const fresh = parseStockCount(data)
      if (!fresh) throw new Error(BAD_RESULT)
      setConfirm(null)
      // ข้อความผิดพลาดของการนับก่อนหน้าไม่เกี่ยวแล้ว (รอบปิดแล้ว ยอดบนจอ = ของเซิร์ฟเวอร์)
      setError('')
      mergeFetched(fresh, Date.now())
      if (kind === 'apply') {
        const sm = fresh.summary
        setActionMsg({
          kind: 'ok',
          text: fresh.already_applied
            ? 'รอบนี้ปรับยอดไปแล้วก่อนหน้านี้ — ระบบไม่ได้ปรับซ้ำ'
            : sm
              ? `ปรับยอดสต๊อกแล้ว — เปลี่ยน ${int(sm.changed)} จาก ${int(sm.lines)} รายการ (เพิ่ม +${int(sm.qty_plus)} / ลด -${int(sm.qty_minus)} ชิ้น)`
              : 'ปรับยอดสต๊อกแล้ว',
        })
      } else {
        setActionMsg({ kind: 'ok', text: 'ยกเลิกรอบนี้แล้ว — สต๊อกไม่ถูกปรับ' })
      }
      // ล้างแคชหน้าอื่น (รายการตรวจนับ / รับ-จ่ายสต๊อก) ให้เห็นยอดใหม่
      if (navigator.onLine !== false) router.refresh()
    } catch (err) {
      setConfirm(null)
      const refused = serverAnswered(err)
      let refusedMsg = ''
      if (refused) {
        // เซิร์ฟเวอร์ปฏิเสธพร้อมเหตุผลภาษาไทย (เช่น สินค้า "..." ถูกปรับยอดจากรอบนับอื่น / ไซส์ถูกเอาออก / ราคาติดลบค้าง)
        // → แสดงข้อความนั้นเต็มๆ ขึ้นต้นว่าปรับยอดไม่สำเร็จ ให้รู้ว่ายังไม่มีอะไรเปลี่ยน
        const msg = isMigrationMissing(err) ? FIX04_MISSING_MSG : thaiError(err)
        setActionMsg({
          kind: 'err',
          text: kind === 'apply' ? `ปรับยอดไม่สำเร็จ (สต๊อกยังไม่เปลี่ยน): ${msg}` : `ยกเลิกรอบไม่สำเร็จ: ${msg}`,
        })
        refusedMsg = msg
      } else {
        setActionMsg({ kind: 'warn', text: kind === 'apply' ? APPLY_UNSURE_MSG : CANCEL_UNSURE_MSG })
      }
      // มือถือ: ข้อความนี้อยู่เหนือรายการ (ไม่อยู่ในแถบล่าง) → เลื่อนให้เห็น
      revealActionMsg()
      // สถานะรอบอาจเปลี่ยนไปแล้ว (เครื่องอื่นกด / คำขอเข้าไปแล้วแต่คำตอบหาย) → ดึงสถานะจริง
      // ปรับยอดถูกปฏิเสธ → ธง "ต้องนับใหม่/ไซส์ที่เลิกใช้" ล่าสุดมากับยอดนี้ ถ้ามีรายการต้องแก้ พาไปแท็บนั้นเลย
      // (เซิร์ฟเวอร์บอกชื่อบรรทัดที่ต้องแก้มาในข้อความแล้ว → ไปแท็บนั้นแม้ธงในเครื่องยังไม่อัปเดต)
      const namedFix = kind === 'apply' && /นับสินค้านี้ใหม่|ถูกเอาไซส์ออก/.test(refusedMsg)
      void fetchCount().then(() => {
        if (kind !== 'apply' || !refused || store().closed) return
        if (namedFix || buildView(store()).items.some(it => countLineProblem(it) !== null)) showFixTab()
      })
    } finally {
      clearTimeout(timer)
      actionBusyRef.current = false
      setAction(null)
    }
  }

  // ข้อความผลการปรับยอด/ยกเลิก (ไม่สำเร็จ/ไม่แน่ใจ) บนมือถืออยู่ในเนื้อหาเหนือรายการ → เลื่อนมาให้เห็นถ้ายังไม่อยู่ในจอ
  function revealActionMsg() {
    setTimeout(() => {
      const el = document.getElementById('cnt-action-msg-flow')
      if (el && el.offsetParent !== null) el.scrollIntoView({ block: 'nearest' })
    }, 0)
  }

  function openApply() {
    setActionMsg(null)
    setConfirm('apply')
    // ตัวเลขในป็อปอัปใช้ยอดล่าสุด (อาจมีการขาย/เครื่องอื่นนับเพิ่มระหว่างนี้)
    void fetchCount()
  }

  // ===== แสดงผล =====
  const lastItem = lastScan ? view.items.find(it => it.product_id === lastScan.pid) ?? null : null
  const lastInfo = lastScan ? store().info.get(lastScan.pid) ?? null : null
  const lastPending = lastScan ? view.pendingIds.has(lastScan.pid) : false
  const lastOutOfScope = !!(lastInfo && scopeId && lastInfo.category_id !== scopeId)
  const canUndo = !!lastItem && lastItem.counted_qty > 0 && !lastItem.is_archived
  const lastProblem = lastItem && isOpen ? countLineProblem(lastItem) : null
  const applyDisabled = !isOpen || action !== null || view.queued > 0 || view.items.length === 0
  const sm = meta.summary

  function renderEditor(pid: string, where: 'list' | 'panel') {
    const s = store()
    const cur = displayItemOf(s, pid)
    const info = s.info.get(pid)
    return (
      <QtyEditor
        key={`${pid}-${where}`}
        id={`cnt-edit-${where}-${pid}`}
        exists={cur !== null}
        problem={cur && isOpen ? countLineProblem(cur) : null}
        counted={cur ? cur.counted_qty : 0}
        current={cur ? cur.current_qty : info ? info.stock_qty : 0}
        onSave={qty => saveExact(pid, qty, where)}
        onRemove={() => removeLine(pid, where)}
        onClose={() => closeEditor(where === 'list' ? pid : undefined)}
      />
    )
  }

  // ชื่อสินค้าที่ยังส่งไม่สำเร็จ (แสดงไม่เกิน 3 ชื่อ)
  const stalledNames = view.stalledIds.map(pid => `"${labelOf(pid)}"`)
  const stalledText = stalledNames.length > 3
    ? `${stalledNames.slice(0, 3).join(', ')} และอีก ${int(stalledNames.length - 3)} รายการ`
    : stalledNames.join(', ')

  function renderActionMsg(m: Msg) {
    return (
      <div role={m.kind === 'ok' ? 'status' : 'alert'} className={m.kind === 'ok' ? 'alert-ok' : m.kind === 'warn' ? 'alert-warn' : 'alert-err'}>
        {m.kind === 'ok' ? <CheckCircle2 {...ICON_SM} /> : m.kind === 'warn' ? <AlertTriangle {...ICON_SM} /> : <AlertCircle {...ICON_SM} />}
        <p className="min-w-0 flex-1 break-words">{m.text}</p>
        <button type="button" onClick={() => setActionMsg(null)} className="btn-icon btn-icon-plain -my-2 -mr-2 text-current" aria-label="ปิดข้อความ">
          <X {...ICON_SM} />
        </button>
      </div>
    )
  }

  // inBar = สำเนาในแถบล่าง (จอ sm ขึ้นไป) ใช้ id cnt-fix-warn ให้ปุ่มปรับยอดอ้างถึง (aria-describedby)
  function renderFixWarn(inBar: boolean) {
    return (
      <div id={inBar ? 'cnt-fix-warn' : undefined} className="alert-warn" role={inBar ? 'status' : undefined}>
        <AlertTriangle {...ICON_SM} />
        <p className="min-w-0 flex-1 break-words text-[13px] sm:text-sm">
          {fixInfo.blocking > 0
            ? <>ต้องแก้ <b className="tabular-nums">{int(fixInfo.blocking)}</b> รายการก่อนปรับยอด</>
            : <>มี <b className="tabular-nums">{int(fixInfo.total)}</b> รายการที่ควรตรวจ</>}
          {' '}({[
            fixInfo.recount > 0 ? `นับใหม่ ${int(fixInfo.recount)}` : '',
            fixInfo.archived > 0 ? `ไซส์ที่เลิกใช้ ${int(fixInfo.archived)}` : '',
          ].filter(Boolean).join(' · ')})
          {' '}— {fixInfo.blocking > 0
            ? 'ระบบจะไม่ยอมปรับยอดจนกว่าจะแก้ครบ'
            : 'ยอดตรงกับระบบอยู่แล้ว จึงไม่ขวางการปรับยอด'}
        </p>
        {activeTab !== 'fix' && (
          <button type="button" onClick={showFixTab} className="btn-ghost -my-2 -mr-2 shrink-0 whitespace-nowrap px-3 text-sm">
            ดูรายการ
          </button>
        )}
      </div>
    )
  }

  const searchInput = (
    <div className="input-icon flex-1 min-w-0">
      <Search {...ICON_SM} />
      <input
        className="input pl-11"
        type="search"
        enterKeyHint={isOpen ? 'go' : 'search'}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-label={isOpen ? 'สแกนหรือค้นหาสินค้า' : 'ค้นหาในรายการ'}
        aria-describedby={isOpen ? 'cnt-scan-hint' : undefined}
        // ช่องนี้อยู่ข้างปุ่มกล้อง กว้างแค่ราว 150 px (มือถือ / ช่องซ้ายบนจอใหญ่) — ข้อความยาวถูกตัดกลางสระ
        // รายละเอียดว่าค้นอะไรได้บ้างอยู่ในคำอธิบายใต้ช่อง (cnt-scan-hint)
        placeholder={isOpen ? 'สแกน / ค้นหาสินค้า' : 'ค้นหาชื่อ / SKU / บาร์โค้ด'}
        value={search}
        onChange={e => { setSearch(e.target.value); setSearchMsg('') }}
        onKeyDown={handleSearchKeyDown}
      />
    </div>
  )

  return (
    <div className="space-y-4 sm:space-y-6">
      {showScanner && isOpen && (
        <BarcodeScanner title="สแกนนับสินค้า" onScan={handleScan} onClose={() => setShowScanner(false)} />
      )}

      {/* ===== หัวเรื่อง ===== */}
      <div className="page-header">
        <div className="min-w-0">
          <Link href="/stock/count" className="link text-sm">
            <ArrowLeft {...ICON_SM} />
            กลับไปรายการตรวจนับ
          </Link>
          <h1 className="page-title break-words">{meta.name || 'รอบตรวจนับ'}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500">
            <CountStatusChip status={meta.status} />
            <span className="break-words">{scopeText(meta.category_id, meta.category_name)}</span>
          </div>
          <p className="page-subtitle tabular-nums break-words">
            เริ่ม {formatThaiDateTime(meta.created_at)}{meta.created_by_name ? ` โดย ${meta.created_by_name}` : ''}
          </p>
          {meta.note && <p className="page-subtitle break-words">{meta.note}</p>}
        </div>
        {isOpen && (
          <div className="page-actions">
            <button
              type="button"
              onClick={() => { setActionMsg(null); setConfirm('cancel') }}
              disabled={action !== null}
              className="btn-danger-soft px-4 text-sm"
            >
              <Ban {...ICON_SM} />
              ยกเลิกรอบนี้
            </button>
          </div>
        )}
      </div>

      {/* ===== สถานะรอบ ===== */}
      {meta.status === 'open' && (
        <div className="alert-info">
          <Info {...ICON_SM} />
          <p className="min-w-0">
            นับระหว่างเปิดขายได้ ระบบจะหักลบยอดที่ขายระหว่างนับให้อัตโนมัติ — สต๊อกจะเปลี่ยนเมื่อกด &quot;ปรับยอดสต๊อกตามที่นับ&quot; เท่านั้น
          </p>
        </div>
      )}
      {meta.status === 'applied' && (
        <div className="alert-ok" role="status">
          <CheckCircle2 {...ICON_SM} />
          <p className="min-w-0 break-words">
            ปรับยอดสต๊อกแล้ว เมื่อ {formatThaiDateTime(meta.applied_at)}{meta.applied_by_name ? ` โดย ${meta.applied_by_name}` : ''}
            {sm && (
              <>
                {' '}— เปลี่ยน {int(sm.changed)} จาก {int(sm.lines)} รายการ (เพิ่ม +{int(sm.qty_plus)} / ลด -{int(sm.qty_minus)} ชิ้น)
                {showCost && <> · มูลค่าส่วนต่าง {signedBaht(sm.value_diff)}</>}
              </>
            )}
          </p>
        </div>
      )}
      {meta.status === 'cancelled' && (
        <div className="alert-warn" role="status">
          <AlertTriangle {...ICON_SM} />
          <p className="min-w-0 break-words">
            ยกเลิกรอบนี้แล้ว{meta.cancelled_at ? ` เมื่อ ${formatThaiDateTime(meta.cancelled_at)}` : ''} — สต๊อกไม่ถูกปรับตามยอดที่นับ
          </p>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 lg:items-start">
        {/* ===== ซ้าย (lg+) / บน (มือถือ): สแกน + รายการล่าสุด + สถานะการบันทึก ===== */}
        {isOpen && (
          <section className="lg:w-[380px] lg:shrink-0 min-w-0 space-y-4 lg:sticky lg:top-0" aria-label="สแกนนับสินค้า">
            <div className="card p-4 sm:p-5 space-y-3">
              <h2 className="section-title">
                <ScanBarcode {...ICON} />
                สแกน / ค้นหา
              </h2>
              <div className="flex gap-2">
                {searchInput}
                <button type="button" onClick={() => setShowScanner(true)} className="btn-soft shrink-0 px-4">
                  <Camera {...ICON_SM} />
                  กล้อง
                </button>
              </div>
              {searchMsg && (
                <p className="flex items-start gap-1.5 text-sm text-red-700" role="alert">
                  <AlertCircle {...ICON_SM} className="mt-px" />
                  <span className="min-w-0 break-words">{searchMsg}</span>
                </p>
              )}
              <p id="cnt-scan-hint" className="field-hint">
                ยิงเครื่องสแกน หรือพิมพ์ SKU / บาร์โค้ดแล้วกด Enter = นับเพิ่ม 1 ชิ้น · พิมพ์ชื่อเพื่อค้นหา แล้วแตะสินค้าในรายการเพื่อกรอกจำนวนเอง
              </p>
            </div>

            {lastScan && lastInfo && (
              <div className="card p-4 space-y-3" aria-label="สินค้าที่สแกนล่าสุด">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <p className="section-kicker">สแกนล่าสุด</p>
                    <p className="font-semibold text-gray-900 break-words">{productLabel(lastInfo)}</p>
                    <p className="text-xs text-gray-500 break-all">SKU {lastInfo.sku}{lastInfo.barcode ? ` · ${lastInfo.barcode}` : ''}</p>
                    {lastOutOfScope && <span className="chip-outline mt-1">นอกหมวดของรอบนี้</span>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-500">นับได้</p>
                    <p className="text-3xl font-semibold leading-tight tabular-nums text-gray-900">
                      {lastItem ? int(lastItem.counted_qty) : '–'}
                    </p>
                    {lastPending && (
                      <p className="inline-flex items-center gap-1 text-xs text-gray-500">
                        <Loader2 size={12} strokeWidth={2} aria-hidden="true" className="animate-spin" />
                        กำลังบันทึก
                      </p>
                    )}
                  </div>
                </div>
                <p className="text-sm text-gray-600 tabular-nums">
                  {lastItem ? (
                    <>
                      ในระบบ {int(lastItem.current_qty)} ชิ้น · ส่วนต่าง{' '}
                      <span className={`font-semibold ${diffColor(lastItem.diff)}`}>{signed(lastItem.diff)}</span>
                    </>
                  ) : 'ยังไม่ได้นับ (เอาออกจากรายการแล้ว)'}
                </p>
                {lastProblem && <ProblemNote problem={lastProblem} />}
                {editing && editing.where === 'panel' && editing.pid === lastScan.pid ? (
                  renderEditor(lastScan.pid, 'panel')
                ) : lastProblem === 'archived' ? (
                  <button type="button" onClick={() => removeLine(lastScan.pid, 'panel')} className="btn-danger-soft w-full px-4 text-sm">
                    <Trash2 {...ICON_SM} />
                    ลบออกจากรายการนับ
                  </button>
                ) : lastProblem === 'recount' ? (
                  // ต้องนับใหม่: ไม่มีปุ่ม -1/+1 (บวกเพิ่มจะจำสต๊อกตอนนี้ใหม่ทั้งที่ยอดเดิมนับไว้ก่อนการปรับยอด) → กรอกจำนวนทั้งหมดเท่านั้น
                  <button type="button" onClick={() => setEditing({ pid: lastScan.pid, where: 'panel' })} className="btn-primary w-full px-4 text-sm">
                    <Pencil {...ICON_SM} />
                    นับใหม่ — กรอกจำนวนที่นับได้
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button type="button" onClick={undoLast} disabled={!canUndo}
                      className="btn-secondary flex-1 min-w-0 px-2 text-sm" aria-label="ย้อนการสแกน ลดลง 1 ชิ้น">
                      <Undo2 {...ICON_SM} />
                      -1
                    </button>
                    <button type="button" onClick={() => countOne(lastScan.pid)}
                      className="btn-secondary flex-1 min-w-0 px-2 text-sm" aria-label="นับเพิ่ม 1 ชิ้น">
                      <Plus {...ICON_SM} />
                      1
                    </button>
                    <button type="button" onClick={() => setEditing({ pid: lastScan.pid, where: 'panel' })}
                      className="btn-ghost shrink-0 whitespace-nowrap px-3 text-sm">
                      <Pencil {...ICON_SM} />
                      แก้จำนวน
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* สถานะการบันทึก */}
            <div aria-live="polite" className="space-y-2">
              {offline ? (
                <div className="alert-warn">
                  <WifiOff {...ICON_SM} />
                  <p className="min-w-0">
                    ออฟไลน์อยู่{view.queued > 0 ? ` — การนับ ${int(view.queued)} รายการจะบันทึกเมื่อเน็ตกลับมา อย่าปิดหน้านี้` : ' — รอเน็ตกลับมาก่อนนับต่อ'}
                  </p>
                </div>
              ) : (
                <p className="flex items-center gap-1.5 text-xs text-gray-500 px-1">
                  {view.queued > 0
                    ? <><Loader2 size={14} strokeWidth={2} aria-hidden="true" className="animate-spin" />กำลังบันทึก {int(view.queued)} รายการ...</>
                    : <><CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" className="text-green-600" />บันทึกครบแล้ว · ยอดอัปเดตอัตโนมัติทุก 15 วินาที</>}
                </p>
              )}
            </div>
          </section>
        )}

        {/* ===== รายการ ===== */}
        <section id="cnt-list" className="lg:flex-1 min-w-0 space-y-3 scroll-mt-4" aria-label="รายการตรวจนับ">
          {error && (
            <div className="alert-err" role="alert">
              <AlertCircle {...ICON_SM} />
              <p className="min-w-0 flex-1 break-words">{error}</p>
              <button type="button" onClick={() => setError('')} className="btn-icon btn-icon-plain -my-2 -mr-2 text-current" aria-label="ปิดข้อความ">
                <X {...ICON_SM} />
              </button>
            </div>
          )}
          {view.stalledIds.length > 0 && (
            <div className="alert-warn" role="alert">
              <WifiOff {...ICON_SM} />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="break-words">
                  ยังบันทึกการนับของ {stalledText} ไม่สำเร็จ (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — ยอดยังเก็บไว้ในเครื่องนี้
                  ระบบจะส่งใหม่เองเมื่อเน็ตกลับมา ส่งซ้ำได้โดยไม่นับเบิ้ล · อย่าปิดหน้านี้
                </p>
                <button type="button" onClick={retryStalled} className="btn-secondary px-4 text-sm">
                  <RotateCcw {...ICON_SM} />
                  ลองบันทึกอีกครั้ง
                </button>
              </div>
            </div>
          )}
          {/* มือถือ: ผลการปรับยอด (ไม่สำเร็จ/ไม่แน่ใจ) + รายการที่ต้องแก้ อยู่ตรงนี้แทนแถบล่าง (แถบล่างเหลือแค่ยอดรวม + ปุ่ม) */}
          {actionMsg && actionMsg.kind !== 'ok' && (
            <div id="cnt-action-msg-flow" className="sm:hidden scroll-mt-4">{renderActionMsg(actionMsg)}</div>
          )}
          {isOpen && fixInfo.total > 0 && <div className="sm:hidden">{renderFixWarn(false)}</div>}

          {!isOpen && <div className="flex">{searchInput}</div>}

          <div ref={tabRowRef} className="-mx-1 flex gap-2 overflow-x-auto scrollbar-none px-1 pb-1" role="group" aria-label="มุมมองรายการ">
            {tabs.filter(t => !t.hidden).map(t => (
              <button
                key={t.key}
                data-tab={t.key}
                type="button"
                aria-pressed={activeTab === t.key}
                onClick={() => setTab(t.key)}
                className="chip-toggle shrink-0"
              >
                {t.label}
                <span className="tabular-nums opacity-80">{int(t.count)}</span>
              </button>
            ))}
          </div>

          <div className="card overflow-hidden">
            {/* หัวคอลัมน์ (md+) */}
            <div className={`hidden md:grid ${showDiff ? 'grid-cols-[minmax(0,1fr)_6rem_6rem_6rem]' : 'grid-cols-[minmax(0,1fr)_6rem_6rem]'} gap-x-3 px-5 py-2.5 text-[13px] font-semibold text-gray-600 bg-gray-50 border-b border-gray-200`}>
              <span>สินค้า</span>
              <span className="text-right">{meta.status === 'applied' ? 'ก่อนปรับ' : 'ในระบบ'}</span>
              <span className="text-right">นับได้</span>
              {showDiff && <span className="text-right">ส่วนต่าง</span>}
            </div>

            {rows.length === 0 ? (
              <div className="empty-state">
                <span className="icon-bubble icon-bubble-lg">
                  {q ? <SearchX size={28} strokeWidth={1.75} aria-hidden="true" /> : <ClipboardCheck size={28} strokeWidth={1.75} aria-hidden="true" />}
                </span>
                <p className="empty-state-title break-words">
                  {q ? `ไม่พบสินค้าที่ตรงกับ “${search.trim()}” ในแท็บนี้`
                    : activeTab === 'pending' ? 'นับครบทุกรายการแล้ว'
                      : activeTab === 'diff' ? 'ยังไม่มีรายการที่ยอดต่างจากระบบ'
                        : activeTab === 'fix' ? 'แก้ครบแล้ว ไม่มีรายการที่ขวางการปรับยอด'
                          : isOpen ? 'ยังไม่ได้นับสินค้า' : 'รอบนี้ไม่มีรายการที่นับ'}
                </p>
                {!q && activeTab === 'counted' && isOpen && (
                  <p>สแกนบาร์โค้ด หรือแตะสินค้าในแท็บ &quot;ยังไม่นับ&quot; เพื่อกรอกจำนวน</p>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-gray-150">
                {visibleRows.map(r => {
                  const it = r.item
                  const pending = view.pendingIds.has(r.pid)
                  const expanded = !!editing && editing.where === 'list' && editing.pid === r.pid
                  const highlighted = !!lastScan && lastScan.pid === r.pid
                  // ต้องนับใหม่ / ไซส์ที่เลิกใช้ → ไฮไลต์แถว + บอกว่าต้องทำอะไร (ปรับยอดจะไม่ยอมจนกว่าจะแก้)
                  const problem = it && isOpen ? countLineProblem(it) : null
                  // ยอดในระบบเปลี่ยนหลังนับ (ขาย/รับเข้า) → บอกยอดหลังปรับที่ระบบจะใช้จริง
                  // (บรรทัดที่ต้องนับใหม่ไม่บอก — ยอดนี้ยังใช้ไม่ได้จนกว่าจะนับใหม่)
                  const drift = it && isOpen && !problem ? it.current_qty - it.system_qty_at_count : 0
                  const appliedNote = it && meta.status === 'applied' && it.applied_after !== null && it.applied_after !== it.counted_qty
                  const content = (
                    <>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 break-words">
                          {r.name}
                          {r.variant && <span className="font-normal text-gray-600"> · {r.variant}</span>}
                        </p>
                        <p className="text-xs text-gray-500 break-all">SKU {r.sku}{r.barcode ? ` · ${r.barcode}` : ''}</p>
                        <p className="md:hidden mt-0.5 text-xs text-gray-600 tabular-nums">
                          {meta.status === 'applied' ? 'ก่อนปรับ' : 'ในระบบ'} {int(r.stock)}
                          {/* รอบยกเลิก: ยอดนับได้แสดงตัวใหญ่ด้านขวาแทนส่วนต่างแล้ว */}
                          {it && showDiff && <> · นับได้ <span className="font-semibold text-gray-900">{int(it.counted_qty)}</span></>}
                        </p>
                        {drift !== 0 && it && (
                          <p className="mt-0.5 text-xs text-amber-700 tabular-nums">
                            หลังนับมีขาย/รับเข้า {signed(drift)} · ยอดหลังปรับ {int(it.expected_after)}
                          </p>
                        )}
                        {appliedNote && it && (
                          <p className="mt-0.5 text-xs text-gray-500 tabular-nums">
                            หลังปรับ {int(it.applied_after ?? 0)} (หักยอดที่ขายระหว่างนับแล้ว)
                          </p>
                        )}
                        {problem && <ProblemNote problem={problem} compact />}
                      </div>
                      {/* มือถือ: ส่วนต่างตัวใหญ่ด้านขวา */}
                      <div className="md:hidden text-right shrink-0">
                        {it && !showDiff ? (
                          <>
                            <p className="text-lg font-semibold leading-tight tabular-nums text-gray-900">{int(it.counted_qty)}</p>
                            <p className="text-[11px] text-gray-500">นับได้</p>
                          </>
                        ) : it ? (
                          <>
                            <p className={`text-lg font-semibold leading-tight tabular-nums ${diffColor(it.diff)}`}>{signed(it.diff)}</p>
                            <p className="text-[11px] text-gray-500">ส่วนต่าง</p>
                          </>
                        ) : (
                          <p className="text-xs font-medium text-brand-700 whitespace-nowrap">กรอกจำนวน</p>
                        )}
                        {pending && <Loader2 size={12} strokeWidth={2} aria-label="กำลังบันทึก" className="ml-auto mt-0.5 animate-spin text-gray-400" />}
                      </div>
                      {/* คอม: แยกคอลัมน์ */}
                      <span className="hidden md:block text-right text-sm text-gray-700 tabular-nums">{int(r.stock)}</span>
                      <span className="hidden md:flex items-center justify-end gap-1 text-right text-sm font-semibold text-gray-900 tabular-nums">
                        {pending && <Loader2 size={12} strokeWidth={2} aria-label="กำลังบันทึก" className="animate-spin text-gray-400" />}
                        {it ? int(it.counted_qty) : <span className="font-normal text-gray-400">–</span>}
                      </span>
                      {showDiff && (
                        <span className={`hidden md:block text-right text-sm font-semibold tabular-nums ${it ? diffColor(it.diff) : 'text-gray-400'}`}>
                          {it ? signed(it.diff) : <span className="font-normal">–</span>}
                        </span>
                      )}
                    </>
                  )
                  const gridClass = `w-full grid grid-cols-[minmax(0,1fr)_auto] ${showDiff ? 'md:grid-cols-[minmax(0,1fr)_6rem_6rem_6rem]' : 'md:grid-cols-[minmax(0,1fr)_6rem_6rem]'} gap-x-3 items-center px-4 py-3 sm:px-5 text-left`
                  return (
                    <li key={r.pid} className={problem ? 'bg-amber-50' : highlighted ? 'bg-green-50' : undefined}>
                      {isOpen ? (
                        <button
                          id={`cnt-row-${r.pid}`}
                          type="button"
                          aria-expanded={expanded}
                          aria-controls={expanded ? `cnt-edit-list-${r.pid}` : undefined}
                          onClick={() => setEditing(expanded ? null : { pid: r.pid, where: 'list' })}
                          className={`${gridClass} min-h-[56px] transition-colors [@media(hover:hover)]:hover:bg-gray-50 active:bg-gray-100 focus-visible:-outline-offset-2`}
                        >
                          {content}
                        </button>
                      ) : (
                        <div className={gridClass}>{content}</div>
                      )}
                      {expanded && <div className="px-4 pb-4 sm:px-5">{renderEditor(r.pid, 'list')}</div>}
                      {/* ไซส์ที่เลิกใช้: ปุ่มลบอยู่นอกปุ่มแถว (ปุ่มซ้อนปุ่มไม่ได้) กดได้ทันทีไม่ต้องเปิดช่องกรอก */}
                      {!expanded && problem === 'archived' && (
                        <div className="-mt-1 px-4 pb-3 sm:px-5">
                          <button
                            type="button"
                            onClick={() => removeLine(r.pid, 'list')}
                            className="btn-danger-soft px-4 text-sm"
                            aria-label={`ลบ ${r.name}${r.variant ? ` · ${r.variant}` : ''} ออกจากรายการนับ`}
                          >
                            <Trash2 {...ICON_SM} />
                            ลบออกจากรายการนับ
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {rows.length > visibleRows.length && (
              <div className="border-t border-gray-150 px-4 py-3 sm:px-5 flex flex-wrap items-center justify-between gap-2 bg-gray-50">
                <p className="text-xs text-gray-500">แสดง {int(visibleRows.length)} จาก {int(rows.length)} รายการ</p>
                <button
                  type="button"
                  onClick={() => setLimitState({ key: listKey, n: limit + PAGE_ROWS })}
                  className="btn-secondary px-4 text-sm"
                >
                  แสดงเพิ่ม
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ===== แถบสรุปติดขอบล่าง: ยอดรวม + ปุ่มปรับยอด (กดได้ตลอดไม่ต้องเลื่อนหา) ===== */}
      <div id="cnt-bottom-bar" className="sticky bottom-0 z-20 -mx-3 sm:-mx-4 md:mx-0 bottom-bar px-3 pt-3 pb-3 sm:px-5 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-[env(safe-area-inset-bottom)] after:bg-white">
        {/* ผลการปรับยอด: สำเร็จแสดงในแถบล่างทุกขนาดจอ / ไม่สำเร็จ-ไม่แน่ใจ บนมือถือย้ายไปเหนือรายการ (แถบล่างเคยสูงเกือบครึ่งจอ) */}
        {actionMsg && (
          <div className={`mb-3 ${actionMsg.kind === 'ok' ? '' : 'hidden sm:block'}`}>{renderActionMsg(actionMsg)}</div>
        )}
        {/* รายการที่ต้องแก้ก่อนปรับยอด: บอกจำนวนไว้ติดปุ่ม (จอ sm ขึ้นไป) — กดปรับยอดได้ แต่เซิร์ฟเวอร์จะปฏิเสธพร้อมเหตุผลจนกว่าจะแก้ครบ
            มือถือแสดงเหนือรายการแทน (ไม่งั้นแถบล่างสูงจนบังช่องกรอกจำนวนและปุ่มบันทึก) */}
        {isOpen && fixInfo.total > 0 && <div className="mb-3 hidden sm:block">{renderFixWarn(true)}</div>}
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <dl className={`grid ${!showDiff ? 'grid-cols-2' : showCost ? 'grid-cols-4' : 'grid-cols-3'} gap-2 md:flex md:gap-8 flex-1 min-w-0`}>
            <div className="min-w-0">
              <dt className="text-[11px] sm:text-xs text-gray-500">รายการ</dt>
              <dd className="text-sm sm:text-base font-semibold text-gray-900 tabular-nums">{int(totals.lines)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] sm:text-xs text-gray-500">นับได้รวม</dt>
              <dd className="text-sm sm:text-base font-semibold text-gray-900 tabular-nums">{int(totals.counted_qty)}</dd>
            </div>
            {showDiff && (
              <div className="min-w-0">
                <dt className="text-[11px] sm:text-xs text-gray-500">เพิ่ม / ลด</dt>
                <dd className="text-sm sm:text-base font-semibold tabular-nums whitespace-nowrap">
                  <span className={totals.diff_plus > 0 ? 'text-green-700' : 'text-gray-400'}>+{int(totals.diff_plus)}</span>
                  <span className="text-gray-300"> / </span>
                  <span className={totals.diff_minus > 0 ? 'text-red-700' : 'text-gray-400'}>-{int(totals.diff_minus)}</span>
                </dd>
              </div>
            )}
            {showCost && showDiff && (
              <div className="min-w-0">
                <dt className="text-[11px] sm:text-xs text-gray-500">มูลค่าต่าง</dt>
                <dd className={`text-sm sm:text-base font-semibold tabular-nums truncate ${diffColor(totals.value_diff)}`}>
                  {signedBaht(totals.value_diff)}
                </dd>
              </div>
            )}
          </dl>
          {isOpen && (
            <button
              type="button"
              onClick={openApply}
              disabled={applyDisabled}
              aria-describedby={fixInfo.total > 0 ? 'cnt-fix-warn' : undefined}
              className="btn-primary w-full md:w-auto min-h-[48px] px-6"
            >
              {action === 'apply' || view.queued > 0
                ? <Loader2 {...ICON_SM} className="animate-spin" />
                : <Save {...ICON_SM} />}
              {action === 'apply' ? 'กำลังปรับยอด...' : view.queued > 0 ? 'รอบันทึกการนับให้ครบ...' : 'ปรับยอดสต๊อกตามที่นับ'}
            </button>
          )}
        </div>
      </div>

      {/* ===== ยืนยันปรับยอด ===== */}
      <ConfirmDialog
        open={confirm === 'apply'}
        title="ปรับยอดสต๊อกตามที่นับ?"
        confirmLabel="ยืนยันปรับยอด"
        requireAck="ตรวจสอบแล้ว"
        busy={action === 'apply'}
        onConfirm={() => void runAction('apply')}
        onCancel={() => setConfirm(null)}
      >
        <p>
          ระบบจะแก้สต๊อกของสินค้า {int(totals.lines)} รายการที่นับ ให้ตรงกับจำนวนที่นับได้ — สินค้าที่ไม่ได้นับจะไม่ถูกแตะ
        </p>
        {fixInfo.blocking > 0 && (
          <div className="alert-warn">
            <AlertTriangle {...ICON_SM} />
            <p className="min-w-0 break-words">
              ยังมี {int(fixInfo.blocking)} รายการที่ต้องนับใหม่หรือลบออกจากรายการนับ — ถ้ากดยืนยันตอนนี้ ระบบจะไม่ยอมปรับยอด
              (ดูได้ที่แท็บ &quot;ต้องแก้ไข&quot;)
            </p>
          </div>
        )}
        <dl className="panel p-3 grid grid-cols-2 gap-x-4 gap-y-2 tabular-nums">
          <div>
            <dt className="text-xs text-gray-500">ยอดเปลี่ยน</dt>
            <dd className="font-semibold text-gray-900">{int(changedLines)} รายการ</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">ยอดตรงอยู่แล้ว</dt>
            <dd className="font-semibold text-gray-900">{int(Math.max(0, totals.lines - changedLines))} รายการ</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">เพิ่มขึ้นรวม</dt>
            <dd className="font-semibold text-green-700">+{int(totals.diff_plus)} ชิ้น</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">ลดลงรวม</dt>
            <dd className="font-semibold text-red-700">-{int(totals.diff_minus)} ชิ้น</dd>
          </div>
          {showCost && (
            <div className="col-span-2">
              <dt className="text-xs text-gray-500">มูลค่าส่วนต่าง (ตามราคาทุน)</dt>
              <dd className={`font-semibold ${diffColor(totals.value_diff)}`}>{signedBaht(totals.value_diff)}</dd>
            </div>
          )}
        </dl>
        <p className="text-xs text-gray-500">
          ถ้ามีการขายระหว่างนี้ ระบบหักลบให้อีกครั้งตอนกดยืนยัน ตัวเลขจริงอาจต่างเล็กน้อย · ทำแล้วรอบนี้จะแก้ไขต่อไม่ได้
          (ถ้าผิดให้แก้ทีละรายการที่หน้ารับ-จ่ายสต๊อก)
        </p>
      </ConfirmDialog>

      {/* ===== ยืนยันยกเลิกรอบ ===== */}
      <ConfirmDialog
        open={confirm === 'cancel'}
        title="ยกเลิกรอบตรวจนับนี้?"
        confirmLabel="ยกเลิกรอบนี้"
        tone="danger"
        busy={action === 'cancel'}
        onConfirm={() => void runAction('cancel')}
        onCancel={() => setConfirm(null)}
      >
        <p>
          ยอดที่นับไว้ {int(totals.lines)} รายการจะไม่ถูกนำไปปรับสต๊อก (สต๊อกไม่เปลี่ยน) และรอบนี้จะนับต่อไม่ได้
        </p>
        {view.queued > 0 && (
          <p className="text-amber-700">ยังมีการนับ {int(view.queued)} รายการที่กำลังบันทึก — จะถูกทิ้งด้วย</p>
        )}
      </ConfirmDialog>

      <p className="sr-only" aria-live="polite">{announce}</p>
    </div>
  )
}

// ===== ข้อความใต้ชื่อสินค้าของบรรทัดที่ต้องแก้ก่อนปรับยอด =====
function ProblemNote({ problem, compact = false }: { problem: CountLineProblem; compact?: boolean }) {
  const archived = problem === 'archived'
  return (
    <p className={`${compact ? 'mt-0.5 text-xs' : 'text-sm'} flex items-start gap-1 font-medium ${archived ? 'text-red-700' : 'text-amber-800'}`}>
      {archived
        ? <Ban size={compact ? 12 : 14} strokeWidth={2.2} aria-hidden="true" className="mt-[3px] shrink-0" />
        : <AlertTriangle size={compact ? 12 : 14} strokeWidth={2.2} aria-hidden="true" className="mt-[3px] shrink-0" />}
      <span className="min-w-0 break-words">{archived ? ARCHIVED_MSG : RECOUNT_MSG}</span>
    </p>
  )
}

// ===== ช่องกรอกจำนวนที่นับได้ (แตะแถวสินค้า / ปุ่ม "แก้จำนวน") =====
function QtyEditor({ id, exists, problem, counted, current, onSave, onRemove, onClose }: {
  id: string
  exists: boolean      // มีบรรทัดในรอบนับแล้ว (ลบออกได้)
  problem: CountLineProblem | null // ต้องนับใหม่ / ไซส์ที่เลิกใช้ (ลบออกได้อย่างเดียว)
  counted: number      // จำนวนที่นับไว้ตอนนี้
  current: number      // สต๊อกในระบบตอนนี้
  onSave: (qty: number) => void
  onRemove: () => void
  onClose: () => void
}) {
  // ต้องนับใหม่ → ช่องว่าง ให้กรอกยอดที่นับจริงรอบนี้ (ไม่เติมยอดเก่าให้กดบันทึกผ่านๆ) ; ยอดเก่าบอกไว้ในคำอธิบาย
  const [text, setText] = useState(exists && problem !== 'recount' ? String(counted) : '')
  const inputRef = useRef<HTMLInputElement>(null)
  const removeRef = useRef<HTMLButtonElement>(null)
  const boxRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    // โฟกัสโดยไม่ให้เบราว์เซอร์เลื่อนเอง (มันเลื่อนแค่พอเห็นช่องกรอก ไม่สนแถบล่างที่ติดขอบจอ → ปุ่มบันทึกอยู่หลังแถบ)
    if (inputRef.current) {
      inputRef.current.focus({ preventScroll: true })
      inputRef.current.select()
    } else {
      removeRef.current?.focus({ preventScroll: true })
    }
    let raf = 0
    const reveal = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => revealAboveBottomBar(boxRef.current))
    }
    reveal()
    // คีย์บอร์ดบนจอเปิด/ปิด (พื้นที่เห็นได้เปลี่ยน) → เลื่อนให้เห็นทั้งกล่องอีกครั้ง
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    vv?.addEventListener('resize', reveal)
    return () => {
      cancelAnimationFrame(raf)
      vv?.removeEventListener('resize', reveal)
    }
  }, [])

  const qty = parseQty(text)
  const empty = text.trim() === ''
  const inputProblem = empty ? ''
    : qty === null ? 'กรอกเป็นตัวเลขจำนวนเต็มเท่านั้น'
      : qty > MAX_COUNT ? `จำนวนมากผิดปกติ (เกิน ${int(MAX_COUNT)}) ตรวจสอบอีกครั้ง`
        : ''
  const ok = qty !== null && !inputProblem

  function step(delta: number) {
    const base = qty ?? (exists ? counted : 0)
    setText(String(Math.min(MAX_COUNT, Math.max(0, base + delta))))
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!ok || qty === null) return
    onSave(qty)
  }

  // ไซส์ที่เลิกใช้: เซิร์ฟเวอร์ไม่ให้นับ/แก้จำนวนแล้ว → เหลือแค่ลบออกจากรายการนับ
  if (problem === 'archived') {
    return (
      <div
        id={id}
        ref={el => { boxRef.current = el }}
        role="group"
        aria-label="ไซส์ที่เลิกใช้"
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}
        className="panel p-3 space-y-3"
      >
        <p className="text-sm text-gray-700">
          ไซส์นี้ถูกเอาออกจากสินค้าระหว่างนับ จึงนับต่อหรือแก้จำนวนไม่ได้ — ลบบรรทัดนี้ออกจากรายการนับ
          (หรือเพิ่มไซส์กลับที่หน้าสินค้าก่อน ถ้ายังขายไซส์นี้อยู่)
        </p>
        <div className="flex flex-wrap gap-2">
          <button ref={removeRef} type="button" onClick={onRemove} className="btn-danger-soft flex-1 sm:flex-none px-4">
            <Trash2 {...ICON_SM} />
            ลบออกจากรายการนับ
          </button>
          <button type="button" onClick={onClose} className="btn-ghost px-4">
            ปิด
          </button>
        </div>
      </div>
    )
  }

  return (
    <form
      id={id}
      ref={el => { boxRef.current = el }}
      onSubmit={handleSubmit}
      noValidate
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
      className="panel p-3 space-y-3"
    >
      <div>
        <label htmlFor={`${id}-qty`} className="field-label">จำนวนที่นับได้จริง</label>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => step(-1)} aria-label="ลดจำนวน" className="btn-icon">
            <Minus {...ICON} />
          </button>
          <input
            id={`${id}-qty`}
            ref={inputRef}
            className="input min-w-0 text-center text-lg font-semibold tabular-nums"
            type="text"
            inputMode="numeric"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="นับได้กี่ชิ้น"
            aria-invalid={inputProblem ? true : undefined}
            aria-describedby={`${id}-hint`}
            value={text}
            onChange={e => {
              const conv = toAsciiDigits(e.target.value)
              setText(/^\d*$/.test(conv) ? conv : e.target.value)
            }}
          />
          <button type="button" onClick={() => step(1)} aria-label="เพิ่มจำนวน" className="btn-icon">
            <Plus {...ICON} />
          </button>
        </div>
        <p id={`${id}-hint`} className={`field-hint tabular-nums ${inputProblem ? 'font-medium text-red-700' : ''}`}>
          {inputProblem || (
            <>
              ในระบบตอนนี้ {int(current)} ชิ้น
              {problem === 'recount' && exists && <> · นับครั้งก่อนได้ {int(counted)} ชิ้น</>}
              {ok && qty !== null && <> · ส่วนต่าง <span className={`font-semibold ${diffColor(qty - current)}`}>{signed(qty - current)}</span></>}
              {empty && ' · ไม่มีของเลยให้กรอก 0'}
            </>
          )}
        </p>
        {problem === 'recount' && (
          <p className="mt-1 text-xs font-medium text-amber-800">
            {RECOUNT_MSG} แล้วกดบันทึก (นับได้เท่าเดิมก็กรอกแล้วกดบันทึก) — ไม่งั้นส่วนต่างจะถูกหักซ้ำ ระบบจึงยังไม่ยอมปรับยอด
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!ok} className="btn-primary flex-1 sm:flex-none px-5">
          <Save {...ICON_SM} />
          บันทึก
        </button>
        {exists && (
          <button type="button" onClick={onRemove} className="btn-danger-soft px-4">
            <Trash2 {...ICON_SM} />
            ลบออกจากรายการนับ
          </button>
        )}
        <button type="button" onClick={onClose} className="btn-ghost px-4">
          ปิด
        </button>
      </div>
    </form>
  )
}
