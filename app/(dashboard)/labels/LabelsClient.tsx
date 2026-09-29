'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Check, CheckCircle2, Download, Eraser, Info, Loader2, Minus, Plus, Printer,
  ScanBarcode, Search, SearchX, Tag, X, XCircle,
} from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { baht, bangkokDateKey, productLabel, thaiError, variantText } from '@/lib/format'
import { findByCode, isPrintableAscii } from '@/lib/barcode'

export interface LabelProduct {
  id: string
  name: string
  sku: string
  barcode: string | null
  size: string | null
  color: string | null
  sell_price: number
}

interface LabelRow {
  product: LabelProduct
  qty: string // เก็บข้อความดิบระหว่างพิมพ์ — ลบจนว่างได้โดยแถวไม่หาย
}

interface LabelWarning {
  id: string
  label: string
  code: string
  message: string
}

interface Notice {
  type: 'ok' | 'error' | 'info'
  text: string
}

type SizeKey = 'sm' | 'md' | 'lg'

// หน่วยทั้งหมดเป็นมิลลิเมตร
interface SizeCfg {
  title: string
  w: number
  h: number
  cols: number
  rows: number
  pad: number // ขอบในสติกเกอร์
  gap: number // ระยะห่างระหว่างบล็อก (ชื่อ / ไซส์-สี / บาร์โค้ด / รหัส / ราคา)
  nameFs: number // ขนาดตัวอักษร
  variantFs: number
  codeFs: number
  priceFs: number
  barMin: number // ความสูงบาร์โค้ด
  barMax: number
}

const SIZES: Record<SizeKey, SizeCfg> = {
  sm: {
    title: 'เล็ก (38×25 mm) — A4 / 55 ดวง',
    w: 38, h: 25, cols: 5, rows: 11,
    pad: 1, gap: 0.35,
    nameFs: 2.5, variantFs: 2.1, codeFs: 1.9, priceFs: 3.2,
    barMin: 4, barMax: 9,
  },
  md: {
    title: 'กลาง (50×30 mm) — A4 / 36 ดวง',
    w: 50, h: 30, cols: 4, rows: 9,
    pad: 1.3, gap: 0.45,
    nameFs: 2.9, variantFs: 2.4, codeFs: 2.1, priceFs: 3.8,
    barMin: 5, barMax: 11,
  },
  lg: {
    title: 'ใหญ่ (70×40 mm) — A4 / 12 ดวง',
    w: 70, h: 40, cols: 2, rows: 6,
    pad: 2, gap: 0.6,
    nameFs: 3.8, variantFs: 3.1, codeFs: 2.6, priceFs: 5,
    barMin: 6, barMax: 15,
  },
}
const SIZE_KEYS: SizeKey[] = ['sm', 'md', 'lg']

const PAGE_W = 210 // A4 (mm)
const PAGE_H = 297
const PX_PER_MM = 12 // ความละเอียดภาพสติกเกอร์
const MIN_QTY = 1
const MAX_QTY = 500
const QUIET_MODULES = 10 // พื้นที่ว่างซ้าย/ขวาของบาร์โค้ด (หน่วย = ความกว้างแท่งเล็กสุด)
const MIN_GOOD_MODULE_PX = 2 // แท่งบางกว่า 2px (≈0.17 mm) เครื่องสแกนส่วนใหญ่อ่านไม่ติด
const MAX_MODULE_PX = 6 // แท่งกว้างสุด ≈0.5 mm (รหัสสั้นมากจะได้ไม่ยืดเต็มสติกเกอร์)
const LIST_LIMIT = 200
const YIELD_EVERY = 20
const THAI_LINE = 1.25 // ความสูงบรรทัด (เท่าของขนาดตัวอักษร) — ภาษาไทยมีสระบน/ล่าง
const LATIN_LINE = 1.15
const TOO_LONG = 'รหัสยาวเกินไปสำหรับสติกเกอร์ขนาดนี้'
// ข้อความตัวอย่างสำหรับสั่งโหลดฟอนต์ — ต้องมีอักษรไทย ไม่งั้นเบราว์เซอร์โหลดแค่ชุดตัวอักษรละติน
const FONT_SAMPLE = 'กขคงจฉชซญฎฐณดตถทธนบปผพฟภมยรลวศษสหฬอฮะาำิีึืุูเแโใไ่้๊๋็์฿ ABCXYZabcxyz0123456789·…'
const THAI_CHAR_RE = /[฀-๿]/
// สระบน/ล่าง วรรณยุกต์ — ต้องติดกับพยัญชนะตัวหน้า ห้ามตัดแยกบรรทัด
const THAI_MARK_RE = /[ัิ-ฺ็-๎]/

function clampQty(raw: string): number {
  const n = parseInt(raw, 10)
  if (!(n >= MIN_QTY)) return MIN_QTY
  return Math.min(n, MAX_QTY)
}

function codeOf(p: LabelProduct): string {
  return (p.barcode || '').trim() || (p.sku || '').trim()
}

function errorText(e: unknown): string {
  // JsBarcode โยน error เป็นข้อความ (string) ไม่ใช่ Error
  return typeof e === 'string' ? e : thaiError(e)
}

function pause(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

// รอให้หน้าจอวาดเสร็จจริง (ก่อนเด้ง confirm ซึ่งจะบล็อกหน้าจอ)
function nextPaint(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
}

// ===== ตัดคำ / ตัดบรรทัด บน canvas =====

// แยกเป็นกลุ่มตัวอักษร (พยัญชนะ + สระบน/ล่าง + วรรณยุกต์ อยู่ด้วยกัน)
function clusters(s: string): string[] {
  const out: string[] = []
  Array.from(s).forEach(ch => {
    if (out.length > 0 && THAI_MARK_RE.test(ch)) out[out.length - 1] += ch
    else out.push(ch)
  })
  return out
}

let segmenter: Intl.Segmenter | null | undefined

// ตัดคำภาษาไทยด้วย Intl.Segmenter (ถ้าเบราว์เซอร์รองรับ) ไม่งั้นตัดตามช่องว่าง
function splitWords(s: string): string[] {
  if (segmenter === undefined) {
    try {
      segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter('th', { granularity: 'word' })
        : null
    } catch {
      segmenter = null
    }
  }
  if (segmenter) return Array.from(segmenter.segment(s), d => d.segment)
  return s.split(/(\s+)/).filter(Boolean)
}

// ตัดท้ายข้อความให้พอดีความกว้าง แล้วเติม …
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  const cs = clusters(text)
  while (cs.length > 0 && ctx.measureText(cs.join('').trimEnd() + '…').width > maxW) cs.pop()
  return cs.join('').trimEnd() + '…'
}

// ตัดบรรทัดตามความกว้างจริงของตัวอักษร ไม่เกิน maxLines บรรทัด (บรรทัดสุดท้ายเกินจะลงท้ายด้วย …)
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const fits = (s: string) => ctx.measureText(s).width <= maxW

  // คำที่ยาวเกินบรรทัดเดียว → แตกเป็นกลุ่มตัวอักษร
  const tokens: string[] = []
  splitWords(clean).forEach(t => {
    if (fits(t.trim())) tokens.push(t)
    else clusters(t).forEach(c => tokens.push(c))
  })

  const lines: string[] = []
  let line = ''
  for (let i = 0; i < tokens.length; i++) {
    const next = line + tokens[i]
    if (!line.trim() || fits(next.trimEnd())) {
      line = next
      continue
    }
    if (lines.length === maxLines - 1) {
      // บรรทัดสุดท้าย: รวมที่เหลือทั้งหมดแล้วตัดท้ายด้วย …
      lines.push(fitText(ctx, (line + tokens.slice(i).join('')).trim(), maxW))
      return lines
    }
    lines.push(line.trim())
    line = tokens[i].trimStart()
  }
  if (line.trim()) lines.push(line.trim())
  return lines
}

// ===== วาดสติกเกอร์ 1 ดวงลง canvas =====

interface LabelContent {
  name: string
  variant: string
  code: string
  price: string | null
}

type LabelItem =
  | { kind: 'text'; text: string; font: string; px: number; height: number; tight: boolean }
  | { kind: 'bar'; height: number; tight: boolean }

function drawLabel(
  ctx: CanvasRenderingContext2D,
  family: string,
  cfg: SizeCfg,
  content: LabelContent,
  makeBar: ((heightPx: number) => HTMLCanvasElement | null) | null,
): void {
  const W = ctx.canvas.width
  const H = ctx.canvas.height
  const pad = cfg.pad * PX_PER_MM
  const inner = H - pad * 2
  const maxW = W - pad * 2
  const gap = cfg.gap * PX_PER_MM
  const fontOf = (weight: number, px: number) => `${weight} ${px}px ${family}`

  const textItem = (value: string, weight: number, sizeMm: number, lineFactor: number, tight = false): LabelItem => {
    const px = Math.round(sizeMm * PX_PER_MM)
    const font = fontOf(weight, px)
    ctx.font = font
    return { kind: 'text', text: fitText(ctx, value, maxW), font, px, height: Math.round(px * lineFactor), tight }
  }

  // บน: ชื่อสินค้า (ตัวหนา ไม่เกิน 2 บรรทัด) + ไซส์ · สี
  const head: LabelItem[] = []
  ctx.font = fontOf(700, Math.round(cfg.nameFs * PX_PER_MM))
  wrapText(ctx, content.name, maxW, 2).forEach((t, i) => {
    head.push(textItem(t, 700, cfg.nameFs, THAI_LINE, i > 0))
  })
  if (content.variant) head.push(textItem(content.variant, 400, cfg.variantFs, THAI_LINE))

  // ล่าง: รหัส (ตัวเล็ก) + ราคา (ตัวหนา)
  const tail: LabelItem[] = []
  if (content.code) {
    tail.push(textItem(content.code, 400, cfg.codeFs, THAI_CHAR_RE.test(content.code) ? THAI_LINE : LATIN_LINE))
  }
  if (content.price) tail.push(textItem(content.price, 700, cfg.priceFs, LATIN_LINE))

  const heightOf = (items: LabelItem[]) =>
    items.reduce((s, it, i) => s + it.height + (i > 0 && !it.tight ? gap : 0), 0)

  // กลาง: บาร์โค้ด — ได้พื้นที่ที่เหลือ (อยู่ในช่วง barMin..barMax)
  let items: LabelItem[] = head.concat(tail)
  let bar: HTMLCanvasElement | null = null
  if (makeBar) {
    const slot: LabelItem = { kind: 'bar', height: 0, tight: false }
    const withBar = head.concat([slot], tail)
    const free = inner - heightOf(withBar)
    const barH = Math.round(Math.min(cfg.barMax * PX_PER_MM, Math.max(cfg.barMin * PX_PER_MM, free)))
    bar = makeBar(barH)
    if (bar) {
      slot.height = bar.height
      items = withBar
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#000000'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.imageSmoothingEnabled = false

  // จัดทุกบล็อกให้อยู่กึ่งกลางแนวตั้ง
  let y = pad + Math.max(0, (inner - heightOf(items)) / 2)
  items.forEach((it, i) => {
    if (i > 0 && !it.tight) y += gap
    if (it.kind === 'bar') {
      // วาดขนาดจริง ไม่ย่อ/ขยาย — แท่งบาร์โค้ดจึงคมทุกเส้น
      if (bar) ctx.drawImage(bar, Math.round((W - bar.width) / 2), Math.round(y))
    } else {
      ctx.font = it.font
      ctx.fillText(it.text, W / 2, y + it.height / 2 + it.px * 0.36)
    }
    y += it.height
  })
}

async function loadFonts(family: string): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  try {
    await Promise.all([
      document.fonts.load('700 32px ' + family, FONT_SAMPLE),
      document.fonts.load('400 24px ' + family, FONT_SAMPLE),
    ])
    await document.fonts.ready
  } catch {
    // โหลดฟอนต์ไม่สำเร็จ → canvas ใช้ฟอนต์ไทยของเครื่องแทน (ยังอ่านออก แค่หน้าตาต่างไปเล็กน้อย)
  }
}

export default function LabelsClient({ products }: { products: LabelProduct[] }) {
  const [rows, setRows] = useState<LabelRow[]>([])
  const [search, setSearch] = useState('')
  const [searchMsg, setSearchMsg] = useState<Notice | null>(null)
  const [size, setSize] = useState<SizeKey>('md')
  const [showPrice, setShowPrice] = useState(true)
  const [border, setBorder] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [warnings, setWarnings] = useState<LabelWarning[]>([])
  const [notice, setNotice] = useState<Notice | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // เครื่องสแกน USB/บลูทูธ: พิมพ์ตอนโฟกัสไม่อยู่ในช่องกรอก (เช่นเพิ่งแตะรายการสินค้า) → ส่งเข้าช่องค้นหา
  // ไม่งั้นตัวอักษรหาย และ Enter ท้ายรหัสไปกดปุ่มสินค้าที่แตะล่าสุดซ้ำ
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
        || (el instanceof HTMLElement && el.isContentEditable)) return
      // เว้นวรรคบนปุ่ม = ผู้ใช้คีย์บอร์ดกดปุ่ม ไม่ใช่การสแกน
      if (e.key === ' ' && (el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement)) return
      searchRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // ข้อความสำหรับค้นหา: ชื่อ ไซส์ สี SKU บาร์โค้ด
  const index = useMemo(() => products.map(p => ({
    p,
    text: [p.name, p.size, p.color, p.sku, p.barcode].filter(Boolean).join(' ').toLowerCase(),
  })), [products])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    const terms = q.split(/\s+/)
    const list = index.filter(x => terms.every(t => x.text.includes(t))).map(x => x.p)
    // ยิงบาร์โค้ดตอนคีย์บอร์ดเป็นภาษาไทย → หาด้วยรหัสที่แปลงกลับแล้ว
    const hit = findByCode(products, search)
    if (hit && list.indexOf(hit) === -1) list.unshift(hit)
    return list
  }, [index, products, search])

  const shown = filtered.slice(0, LIST_LIMIT)

  const selected = useMemo(() => {
    const m: Record<string, number> = {}
    rows.forEach(r => { m[r.product.id] = clampQty(r.qty) })
    return m
  }, [rows])

  const cfg = SIZES[size]
  const perPage = cfg.cols * cfg.rows
  const totalLabels = rows.reduce((s, r) => s + clampQty(r.qty), 0)
  const pages = Math.ceil(totalLabels / perPage)

  function addRow(p: LabelProduct) {
    setRows(rs => {
      const idx = rs.findIndex(r => r.product.id === p.id)
      if (idx >= 0) {
        return rs.map((r, i) => i === idx ? { ...r, qty: String(Math.min(MAX_QTY, clampQty(r.qty) + 1)) } : r)
      }
      return [...rs, { product: p, qty: '1' }]
    })
  }

  function onSearchEnter() {
    const raw = search.trim()
    if (!raw) return
    const hit = findByCode(products, raw) ?? (filtered.length === 1 ? filtered[0] : undefined)
    if (hit) {
      addRow(hit)
      setSearch('')
      setSearchMsg({ type: 'ok', text: `เพิ่ม "${productLabel(hit)}" แล้ว (รวม ${(selected[hit.id] ?? 0) + 1} ดวง)` })
    } else if (filtered.length === 0) {
      setSearchMsg({ type: 'error', text: `ไม่พบสินค้า "${raw}"` })
    } else {
      setSearchMsg({ type: 'info', text: `พบ ${filtered.length} รายการ — แตะเลือกสินค้าที่ต้องการ` })
    }
  }

  function setQtyRaw(id: string, raw: string) {
    const v = raw.replace(/[^0-9]/g, '').slice(0, 3)
    setRows(rs => rs.map(r => r.product.id === id ? { ...r, qty: v } : r))
  }

  function commitQty(id: string) {
    setRows(rs => rs.map(r => r.product.id === id ? { ...r, qty: String(clampQty(r.qty)) } : r))
  }

  function stepQty(id: string, delta: number) {
    setRows(rs => rs.map(r => {
      if (r.product.id !== id) return r
      const n = Math.min(MAX_QTY, Math.max(MIN_QTY, clampQty(r.qty) + delta))
      return { ...r, qty: String(n) }
    }))
  }

  function removeRow(id: string) {
    setRows(rs => rs.filter(r => r.product.id !== id))
  }

  function clearAll() {
    if (rows.length === 0) return
    if (!confirm('ล้างรายการสติกเกอร์ทั้งหมด?')) return
    setRows([])
    setWarnings([])
    setNotice(null)
  }

  async function generatePDF() {
    if (rows.length === 0 || generating) return
    const list = rows.map(r => ({ product: r.product, qty: clampQty(r.qty) }))
    const total = list.reduce((s, r) => s + r.qty, 0)
    const sizeCfg = SIZES[size]
    const withPrice = showPrice
    const withBorder = border

    setRows(rs => rs.map(r => ({ ...r, qty: String(clampQty(r.qty)) })))
    setGenerating(true)
    setWarnings([])
    setNotice(null)
    setProgress({ done: 0, total })

    try {
      await pause()
      const [{ default: jsPDF }, { default: JsBarcode }] = await Promise.all([
        import('jspdf'),
        import('jsbarcode'),
      ])

      // ใช้ฟอนต์ Sarabun ของหน้าเว็บวาดลง canvas — ฟอนต์ในตัว jsPDF ไม่มีอักษรไทย
      const family = getComputedStyle(document.body).fontFamily || 'sans-serif'
      await loadFonts(family)

      const W = Math.round(sizeCfg.w * PX_PER_MM)
      const H = Math.round(sizeCfg.h * PX_PER_MM)
      const barAvailW = W - Math.round(sizeCfg.pad * PX_PER_MM) * 2
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('เบราว์เซอร์นี้วาดสติกเกอร์ไม่ได้ (ไม่รองรับ canvas) — ลองเปิดด้วย Chrome หรือ Safari')

      // วางแผนบาร์โค้ด CODE128: หาจำนวนแท่ง (module) ก่อน แล้วเลือกความกว้างแท่งเป็นจำนวนเต็มพิกเซล
      const planBarcode = (code: string): { moduleW: number; problem: string | null } => {
        if (!code) return { moduleW: 0, problem: 'ไม่มีรหัสสินค้า/บาร์โค้ด — สติกเกอร์จะไม่มีบาร์โค้ด' }
        if (!isPrintableAscii(code)) {
          return {
            moduleW: 0,
            problem: 'รหัสมีอักขระที่ทำเป็นบาร์โค้ดไม่ได้ (ใช้ได้เฉพาะตัวอังกฤษ ตัวเลข และเครื่องหมายบนแป้นพิมพ์) — สติกเกอร์จะไม่มีบาร์โค้ด',
          }
        }
        try {
          const probe = document.createElement('canvas')
          JsBarcode(probe, code, { format: 'CODE128', width: 1, height: 1, displayValue: false, margin: 0 })
          const modules = probe.width
          if (!(modules > 0)) return { moduleW: 0, problem: 'สร้างบาร์โค้ดไม่สำเร็จ' }
          const fit = Math.floor(barAvailW / (modules + QUIET_MODULES * 2))
          if (fit < 1) {
            if (modules > W) {
              return { moduleW: 0, problem: `${TOO_LONG} — ยาวเกินพื้นที่สติกเกอร์ จึงไม่พิมพ์บาร์โค้ด (เลือกขนาดใหญ่ขึ้นหรือใช้รหัสที่สั้นลง)` }
            }
            return { moduleW: 1, problem: `${TOO_LONG} — เส้นบาร์โค้ดบางมาก อาจสแกนไม่ติด (เลือกขนาดใหญ่ขึ้นหรือใช้รหัสที่สั้นลง)` }
          }
          if (fit < MIN_GOOD_MODULE_PX) {
            return { moduleW: fit, problem: `${TOO_LONG} — เส้นบาร์โค้ดบางมาก อาจสแกนไม่ติด (เลือกขนาดใหญ่ขึ้นหรือใช้รหัสที่สั้นลง)` }
          }
          return { moduleW: Math.min(fit, MAX_MODULE_PX), problem: null }
        } catch (e) {
          return { moduleW: 0, problem: 'สร้างบาร์โค้ดไม่สำเร็จ: ' + errorText(e) }
        }
      }

      const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
      const labelsPerPage = sizeCfg.cols * sizeCfg.rows
      const marginX = (PAGE_W - sizeCfg.cols * sizeCfg.w) / 2
      const marginY = (PAGE_H - sizeCfg.rows * sizeCfg.h) / 2
      const found: LabelWarning[] = []
      let done = 0

      for (let r = 0; r < list.length; r++) {
        const p = list[r].product
        const code = codeOf(p)
        const plan = planBarcode(code)
        let problem = plan.problem

        const makeBar = plan.moduleW > 0
          ? (heightPx: number): HTMLCanvasElement | null => {
              try {
                const bc = document.createElement('canvas')
                JsBarcode(bc, code, {
                  format: 'CODE128',
                  width: plan.moduleW,
                  height: heightPx,
                  displayValue: false,
                  margin: 0,
                  background: '#ffffff',
                  lineColor: '#000000',
                })
                return bc
              } catch (e) {
                problem = 'สร้างบาร์โค้ดไม่สำเร็จ: ' + errorText(e)
                return null
              }
            }
          : null

        // สินค้าเดียวกันหน้าตาเหมือนกันทุกดวง → วาดครั้งเดียวแล้ววางซ้ำ (jsPDF เก็บรูปซ้ำไว้ชุดเดียว)
        drawLabel(ctx, family, sizeCfg, {
          name: p.name,
          variant: variantText(p),
          code,
          price: withPrice ? baht(Number(p.sell_price)) : null,
        }, makeBar)
        if (problem) found.push({ id: p.id, label: productLabel(p), code, message: problem })
        const image = canvas.toDataURL('image/png')

        for (let k = 0; k < list[r].qty; k++) {
          if (done > 0 && done % labelsPerPage === 0) doc.addPage()
          const slot = done % labelsPerPage
          const x = marginX + (slot % sizeCfg.cols) * sizeCfg.w
          const y = marginY + Math.floor(slot / sizeCfg.cols) * sizeCfg.h
          doc.addImage(image, 'PNG', x, y, sizeCfg.w, sizeCfg.h, undefined, 'FAST')
          if (withBorder) {
            doc.setDrawColor(160, 160, 160)
            doc.setLineWidth(0.1)
            doc.rect(x, y, sizeCfg.w, sizeCfg.h, 'S')
          }
          done++
          if (done % YIELD_EVERY === 0) {
            setProgress({ done, total })
            await pause()
          }
        }
      }
      setProgress({ done, total })

      if (found.length > 0) {
        setWarnings(found)
        await pause()
        await nextPaint()
        const ok = confirm(
          `มี ${found.length} รายการที่มีปัญหา (ดูรายละเอียดในหน้าจอ) — สติกเกอร์ของรายการเหล่านี้อาจไม่มีบาร์โค้ดหรือสแกนไม่ติด\n\nต้องการสร้าง PDF ต่อหรือไม่`
        )
        if (!ok) {
          setNotice({ type: 'info', text: 'ยกเลิกแล้ว ยังไม่ได้สร้างไฟล์ PDF — แก้รหัสสินค้าที่มีปัญหา หรือเลือกขนาดสติกเกอร์ที่ใหญ่ขึ้นแล้วลองใหม่' })
          return
        }
      }

      doc.save(`labels-${bangkokDateKey(new Date())}.pdf`)
      const pageCount = Math.ceil(total / labelsPerPage)
      setNotice({
        type: 'ok',
        text: `สร้าง PDF แล้ว ${total.toLocaleString('en-US')} ดวง (${pageCount} หน้า A4)` +
          (found.length > 0 ? ` — มี ${found.length} รายการที่มีปัญหา ดูด้านล่าง` : ''),
      })
    } catch (e) {
      setNotice({ type: 'error', text: 'สร้าง PDF ไม่สำเร็จ: ' + errorText(e) })
    } finally {
      setGenerating(false)
      setProgress(null)
    }
  }

  // กล่องข้อความตามธีม: สำเร็จ = เขียว, ผิดพลาด = แดง, แจ้งให้ทราบ = นมชมพู
  const noticeClass = (n: Notice) =>
    n.type === 'ok' ? 'alert-ok'
      : n.type === 'error' ? 'alert-err'
        : 'alert-info'

  const noticeIcon = (n: Notice) =>
    n.type === 'ok' ? <CheckCircle2 {...ICON_SM} />
      : n.type === 'error' ? <XCircle {...ICON_SM} />
        : <Info {...ICON_SM} />

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 lg:items-start">
      {/* รายการสินค้า — lg+: ยืดเต็มที่เหลือ (แผงรายการสติกเกอร์กว้างคงที่ด้านขวา) */}
      <div className="lg:flex-1 space-y-3 sm:space-y-4 min-w-0">
        <div className="card p-4 sm:p-5 space-y-2.5">
          <div className="input-icon">
            <Search {...ICON_SM} />
            <input
              ref={searchRef}
              type="search"
              className="input pl-11"
              placeholder="ค้นหาชื่อ / SKU / บาร์โค้ด / ไซส์ / สี"
              autoComplete="off"
              aria-label="ค้นหาสินค้า หรือยิงบาร์โค้ดแล้วกด Enter"
              value={search}
              onChange={e => { setSearch(e.target.value); setSearchMsg(null) }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onSearchEnter()
                }
              }}
            />
          </div>
          {searchMsg ? (
            <p className={noticeClass(searchMsg)}
              role={searchMsg.type === 'error' ? 'alert' : 'status'}>
              {noticeIcon(searchMsg)}
              <span className="min-w-0 break-words">{searchMsg.text}</span>
            </p>
          ) : (
            <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-gray-500">
              <ScanBarcode {...ICON_SM} />
              <span className="min-w-0">แตะสินค้าเพื่อเพิ่ม — หรือยิงบาร์โค้ดใส่ช่องค้นหาแล้วกด Enter</span>
            </p>
          )}
        </div>

        <div className="card overflow-hidden">
          {/* จอกว้างมาก (2xl+): รายการสินค้า 2 คอลัมน์ */}
          <div className="max-h-[55vh] lg:max-h-[600px] overflow-y-auto divide-y divide-blush-hair 2xl:divide-y-0 2xl:grid 2xl:grid-cols-2 2xl:content-start">
            {shown.map(p => {
              const picked = selected[p.id]
              return (
                <button key={p.id} type="button" onClick={() => addRow(p)}
                  className="w-full text-left px-4 sm:px-5 py-3 min-h-[60px] [@media(hover:hover)]:hover:bg-milk active:bg-blush-hair focus-visible:outline-offset-[-3px] transition-colors flex items-center gap-3 2xl:!border-b 2xl:border-blush-hair 2xl:odd:border-r">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{productLabel(p)}</p>
                    <p className="text-xs text-gray-500 truncate mt-0.5">
                      {codeOf(p) || 'ไม่มีรหัส'} · {baht(Number(p.sell_price))}
                    </p>
                  </div>
                  {picked ? (
                    <span className="chip shrink-0">
                      <Check size={14} strokeWidth={2.4} aria-hidden="true" />
                      {picked} ดวง
                    </span>
                  ) : null}
                  <span className="chip chip-outline shrink-0">
                    <Plus size={14} strokeWidth={2.4} aria-hidden="true" />
                    เพิ่ม
                  </span>
                </button>
              )
            })}
            {filtered.length === 0 && (
              <div className="empty-state 2xl:col-span-2">
                <span className="icon-bubble icon-bubble-lg">
                  {products.length === 0
                    ? <Tag size={30} strokeWidth={1.8} aria-hidden="true" />
                    : <SearchX size={30} strokeWidth={1.8} aria-hidden="true" />}
                </span>
                <p className="empty-state-title">
                  {products.length === 0 ? 'ยังไม่มีสินค้าที่เปิดใช้งาน' : 'ไม่พบสินค้า'}
                </p>
              </div>
            )}
            {filtered.length > shown.length && (
              <p className="text-center px-4 py-3 text-xs text-gray-500 2xl:col-span-2">
                แสดง {shown.length} จาก {filtered.length} รายการ — พิมพ์ค้นหาเพื่อกรองให้แคบลง
              </p>
            )}
          </div>
        </div>
      </div>

      {/* รายการที่เลือก + ตั้งค่า */}
      <div className="card p-4 sm:p-5 space-y-4 h-fit min-w-0 lg:w-[380px] lg:shrink-0 lg:sticky lg:top-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title min-w-0">
            <span className="icon-bubble icon-bubble-sm"><Tag {...ICON_SM} /></span>
            รายการสติกเกอร์
          </h2>
          <span className="chip tabular-nums">{totalLabels.toLocaleString('en-US')} ดวง · {pages} หน้า</span>
        </div>

        <div>
          <label htmlFor="label-size" className="block text-sm font-medium text-gray-700 mb-1">ขนาด</label>
          <select id="label-size" className="input" value={size} disabled={generating}
            onChange={e => { setSize(e.target.value as SizeKey); setWarnings([]) }}>
            {SIZE_KEYS.map(k => (
              <option key={k} value={k}>{SIZES[k].title}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
          <label className="panel flex items-center gap-3 min-h-[48px] px-4 py-2 text-sm font-medium text-gray-700 cursor-pointer">
            <input type="checkbox" className="w-5 h-5 shrink-0 accent-brand-600" checked={showPrice} disabled={generating}
              onChange={e => setShowPrice(e.target.checked)} />
            แสดงราคา
          </label>
          <label className="panel flex items-center gap-3 min-h-[48px] px-4 py-2 text-sm font-medium text-gray-700 cursor-pointer">
            <input type="checkbox" className="w-5 h-5 shrink-0 accent-brand-600" checked={border} disabled={generating}
              onChange={e => setBorder(e.target.checked)} />
            เส้นขอบ (สำหรับตัดเอง)
          </label>
        </div>

        <div className="space-y-2 lg:max-h-80 lg:overflow-y-auto">
          {rows.length === 0 && (
            <div className="panel empty-state py-6">
              <span className="icon-bubble"><Tag {...ICON} /></span>
              <p>ยังไม่มี — แตะสินค้าเพื่อเพิ่ม</p>
            </div>
          )}
          {rows.map(r => {
            const p = r.product
            const label = productLabel(p)
            return (
              <div key={p.id} className="panel p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0 pt-1 pl-1">
                    <p className="text-sm font-semibold text-gray-900 truncate">{label}</p>
                    <p className="text-xs text-gray-500 truncate">{codeOf(p) || 'ไม่มีรหัส'} · {baht(Number(p.sell_price))}</p>
                  </div>
                  <button type="button" onClick={() => removeRow(p.id)} disabled={generating}
                    aria-label={`ลบ ${label}`} title="ลบออกจากรายการ"
                    className="btn-icon btn-icon-plain btn-icon-danger -mr-1 -mt-1">
                    <X {...ICON_SM} />
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-2 pl-1">
                  <span className="text-xs text-gray-500">จำนวน</span>
                  <button type="button" onClick={() => stepQty(p.id, -1)} disabled={generating}
                    aria-label={`ลดจำนวน ${label}`}
                    className="btn-icon">
                    <Minus {...ICON_SM} />
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    aria-label={`จำนวน ${label}`}
                    className="input w-16 text-center px-1 font-display font-bold tabular-nums"
                    value={r.qty}
                    disabled={generating}
                    onChange={e => setQtyRaw(p.id, e.target.value)}
                    onBlur={() => commitQty(p.id)}
                    onFocus={e => e.target.select()}
                  />
                  <button type="button" onClick={() => stepQty(p.id, 1)} disabled={generating}
                    aria-label={`เพิ่มจำนวน ${label}`}
                    className="btn-icon">
                    <Plus {...ICON_SM} />
                  </button>
                  <span className="text-xs text-gray-500" title={`ได้ ${MIN_QTY}-${MAX_QTY} ดวงต่อรายการ`}>ดวง</span>
                </div>
              </div>
            )
          })}
        </div>

        <div className="space-y-2.5">
          <button type="button" onClick={generatePDF} disabled={rows.length === 0 || generating}
            className="btn-primary w-full min-h-[52px]">
            {generating
              ? <Loader2 {...ICON_SM} className="animate-spin" />
              : <Download {...ICON_SM} />}
            <span className="min-w-0">
              {generating
                ? `กำลังสร้าง... ${progress ? `${progress.done.toLocaleString('en-US')}/${progress.total.toLocaleString('en-US')}` : ''}`
                : `ดาวน์โหลด PDF (${totalLabels.toLocaleString('en-US')} ดวง)`}
            </span>
          </button>
          {generating && progress && progress.total > 0 && (
            <div className="h-2 bg-blush-hair rounded-full overflow-hidden">
              {/* ไม่ใส่ transition ที่ความกว้าง (ขยับเป็นช่วงๆ ทุก 20 ดวงอยู่แล้ว) — ไม่ต้องวาดใหม่ทุกเฟรม */}
              <div className="h-full bg-brand-600 rounded-full"
                style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
            </div>
          )}
          <p className="alert-info py-2 text-xs">
            <Printer {...ICON_SM} />
            <span className="min-w-0">
              สั่งพิมพ์แบบ &quot;ขนาดจริง / Actual size (100%)&quot; ไม่ใช่ &quot;พอดีหน้า&quot;
            </span>
          </p>
        </div>

        {notice && (
          <p className={noticeClass(notice)}
            role={notice.type === 'error' ? 'alert' : 'status'}>
            {noticeIcon(notice)}
            <span className="min-w-0 break-words">{notice.text}</span>
          </p>
        )}

        {warnings.length > 0 && (
          <div className="alert-warn" role="alert">
            <AlertTriangle {...ICON_SM} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-amber-800">มี {warnings.length} รายการที่มีปัญหา</p>
              <ul className="mt-2 space-y-2 max-h-60 overflow-y-auto">
                {warnings.map(w => (
                  <li key={w.id} className="text-amber-900">
                    <p className="font-medium break-words">
                      {w.label} <span className="text-xs font-normal text-amber-700 break-all">({w.code || 'ไม่มีรหัส'})</span>
                    </p>
                    <p className="text-xs">{w.message}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <button type="button" onClick={clearAll} disabled={rows.length === 0 || generating}
          className="btn-secondary w-full">
          <Eraser {...ICON_SM} />
          ล้างรายการ
        </button>
      </div>
    </div>
  )
}
