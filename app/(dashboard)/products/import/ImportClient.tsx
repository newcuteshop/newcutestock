'use client'
// ===== นำเข้าสินค้าจากไฟล์ CSV =====
// 1) ดาวน์โหลดไฟล์ตัวอย่าง / ดูชื่อคอลัมน์ที่รับได้
// 2) เลือกไฟล์ → อ่านในเครื่อง (จับคู่หัวตารางกับชื่อเรียกหลายแบบ, ข้ามแถวว่าง, จำเลขแถวในไฟล์ไว้บอกผู้ใช้)
// 3) ส่งทุกแถวให้ RPC import_products แบบ dry run → เซิร์ฟเวอร์ตรวจกับข้อมูลจริงทั้งหมด แล้วบอกทีละแถวว่าจะ สร้าง/เพิ่มไซส์/อัปเดต/ไม่เปลี่ยน/ผิด
// 4) ไม่มีแถวผิดเลย → กดนำเข้า = ส่งชุดเดิมด้วย client_id เดิม (p_dry_run false) — ทั้งไฟล์สำเร็จพร้อมกันหรือไม่บันทึกเลย
// client_id สร้างใหม่ทุกครั้งที่เลือกไฟล์ → เน็ตหลุดระหว่างบันทึกแล้วกดซ้ำ ระบบคืนผลเดิม ไม่สร้างสินค้าซ้ำ
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, FileDown, FileSpreadsheet, FileUp, Info,
  Loader2, RefreshCw, Upload, XCircle,
} from 'lucide-react'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { baht, thaiError } from '@/lib/format'
import { downloadCsv, looksMisencoded, parseCsvRecords, unguardCell, type CsvRow } from '@/lib/csvCore'
import { FIX04_MISSING_MSG, isMigrationMissing } from '@/lib/migration'
import { newUuid } from '@/lib/products'
import {
  IMPORT_FIELDS, parseImportResult,
  type ImportAction, type ImportChange, type ImportField, type ImportResult, type ImportRowInput, type ImportRowResult,
} from '@/lib/pos'
import ConfirmDialog from '@/components/integrations/ConfirmDialog'
import { PRODUCT_CSV_HEADER } from '@/components/products/ProductCsvButtons'

// ---------------------------------------------------------------------------
// ค่าคงที่
// ---------------------------------------------------------------------------
const MAX_BYTES = 2 * 1024 * 1024   // 2 MB
const MAX_ROWS = 2000               // ตรงกับเพดานของ import_products
const SHOW_STEP = 100               // แสดงผลการตรวจทีละ 100 แถว (ไฟล์ 2,000 แถววาดทีเดียวมือถือหน่วง)
const CHECK_TIMEOUT_MS = 90000
const IMPORT_TIMEOUT_MS = 180000
const THAI_RE = /[฀-๿]/

const FIELD_LABEL: Record<ImportField, string> = {
  name: 'ชื่อสินค้า',
  category: 'หมวดหมู่',
  color: 'สี',
  size: 'ไซส์',
  sku: 'SKU',
  barcode: 'บาร์โค้ด',
  cost_price: 'ราคาทุน',
  sell_price: 'ราคาขาย',
  stock: 'สต๊อก',
  min_stock: 'ขั้นต่ำ',
}

// ชื่อหัวตารางที่รับได้ (เทียบหลังตัดช่องว่างและทำเป็นตัวพิมพ์เล็ก) — ตัวแรกของแต่ละช่อง = ชื่อในไฟล์ตัวอย่าง
const FIELD_ALIASES: Record<ImportField, readonly string[]> = {
  name: ['ชื่อสินค้า', 'ชื่อ', 'name', 'product', 'product_name'],
  category: ['หมวดหมู่', 'หมวด', 'category'],
  color: ['สี', 'color', 'colour'],
  size: ['ไซส์', 'ขนาด', 'size'],
  sku: ['SKU', 'รหัสสินค้า', 'รหัส'],
  barcode: ['บาร์โค้ด', 'barcode'],
  cost_price: ['ราคาทุน', 'ต้นทุน', 'ทุน', 'cost', 'cost_price'],
  sell_price: ['ราคาขาย', 'ราคา', 'price', 'sell_price'],
  stock: ['สต๊อก', 'สต็อก', 'จำนวน', 'คงเหลือ', 'stock', 'qty', 'stock_qty'],
  min_stock: ['ขั้นต่ำ', 'แจ้งเตือนขั้นต่ำ', 'min_stock', 'min'],
}
// คอลัมน์ที่รู้จักแต่ไม่ใช้ (ไฟล์ส่งออกจากหน้าสินค้ามีคอลัมน์ สถานะ) — ข้ามเงียบๆ ไม่ต้องเตือน
const IGNORED_HEADERS = ['สถานะ', 'status']

// คำอธิบายแต่ละคอลัมน์ในขั้นที่ 1
const COLUMN_HELP: readonly { field: ImportField; note: string; required?: boolean }[] = [
  { field: 'sku', note: 'จำเป็นทุกแถว ใช้จับคู่สินค้า: SKU ที่มีอยู่แล้ว = อัปเดต / SKU ใหม่ = สร้างสินค้าใหม่', required: true },
  { field: 'name', note: 'จำเป็นสำหรับสินค้าใหม่ แถวที่ชื่อและสีเหมือนกันจะรวมเป็นแบบเดียวกันหลายไซส์' },
  { field: 'sell_price', note: 'จำเป็นสำหรับสินค้าใหม่' },
  { field: 'category', note: 'ยังไม่มีในระบบ = สร้างหมวดหมู่ใหม่ให้' },
  { field: 'color', note: '' },
  { field: 'size', note: 'เว้นว่างได้ถ้าแบบนั้นไม่มีไซส์ (มีได้ 1 แถว)' },
  { field: 'barcode', note: 'ไม่บังคับ ห้ามซ้ำกับ SKU/บาร์โค้ดของสินค้าอื่น' },
  { field: 'cost_price', note: 'ว่าง = 0 สำหรับสินค้าใหม่' },
  { field: 'stock', note: 'ยอดยกมาของสินค้าใหม่เท่านั้น (สินค้าเดิมปรับที่หน้ารับ-จ่ายสต๊อก หรือตรวจนับ)' },
  { field: 'min_stock', note: 'จำนวนขั้นต่ำก่อนแจ้งเตือนสต๊อกใกล้หมด' },
]

const ACTION_META: Record<ImportAction, { label: string; className: string }> = {
  create: { label: 'สินค้าใหม่', className: 'badge-in' },
  add_size: { label: 'เพิ่มไซส์', className: 'badge-in' },
  update: { label: 'อัปเดต', className: 'badge-return' },
  unchanged: { label: 'ไม่เปลี่ยน', className: 'chip' },
  error: { label: 'ผิดพลาด', className: 'badge-out' },
}

const CHANGE_LABEL: Record<ImportChange['field'], string> = {
  sell_price: 'ราคาขาย',
  cost_price: 'ราคาทุน',
  barcode: 'บาร์โค้ด',
  min_stock: 'ขั้นต่ำ',
}

// ไฟล์ตัวอย่าง: หัวตารางเดียวกับไฟล์ส่งออก + สินค้าไม่มีไซส์ 1 แถว + แบบเดียวกัน 2 ไซส์
const TEMPLATE_ROWS: readonly CsvRow[] = [
  PRODUCT_CSV_HEADER,
  ['กระเป๋าผ้าแคนวาส', 'กระเป๋า', 'ครีม', '', 'BAG-CANVAS-01', '', 80, 190, 10, 3, 'เปิดขาย'],
  ['เสื้อยืดคอกลม', 'เสื้อ', 'ขาว', 'M', 'TS-WHITE-M', '', 120, 290, 5, 2, 'เปิดขาย'],
  ['เสื้อยืดคอกลม', 'เสื้อ', 'ขาว', 'L', 'TS-WHITE-L', '', 120, 290, 5, 2, 'เปิดขาย'],
]

// ---------------------------------------------------------------------------
// อ่านไฟล์
// ---------------------------------------------------------------------------
type Encoding = 'utf8' | 'utf16' | 'thai-windows' | 'misencoded'

// หัวตาราง → คีย์เทียบ: ตัดช่องว่าง/ขีดล่าง/ขีด, ตัวพิมพ์เล็ก ('Product Name' = 'product_name' = 'productname')
function normHeader(s: string): string {
  return unguardCell(String(s ?? ''))
    .normalize('NFC')
    .replace(/[\s ​-‍⁠﻿_-]+/g, '')
    .replace(/\*+$/, '')          // 'SKU*' (เครื่องหมายช่องจำเป็น)
    .replace(/\([^)]*\)$/, '')    // 'ราคาขาย(บาท)'
    .toLowerCase()
}

const ALIAS_TO_FIELD = new Map<string, ImportField>()
for (const field of IMPORT_FIELDS) {
  for (const alias of FIELD_ALIASES[field]) ALIAS_TO_FIELD.set(normHeader(alias), field)
}
const IGNORED_SET = new Set(IGNORED_HEADERS.map(normHeader))

/**
 * ถอดรหัสไฟล์เป็นข้อความ:
 * UTF-8 (มี/ไม่มี BOM) → ใช้เลย · UTF-16 (Excel "Unicode Text") → ถอดตาม BOM
 * ไม่ใช่ UTF-8 และอักขระเสียเยอะ → ลองแบบภาษาไทยของ Windows (Excel "CSV (Comma delimited)" ในเครื่องภาษาไทยบันทึกแบบนี้)
 * ยังไม่ได้ → ใช้ UTF-8 แบบหลวม แล้วเตือนว่าภาษาไทยจะเพี้ยน
 */
async function readFileText(f: File): Promise<{ text: string; encoding: Encoding }> {
  const buf = new Uint8Array(await f.arrayBuffer())
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(buf), encoding: 'utf16' }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(buf), encoding: 'utf16' }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf8' }
  } catch { /* ไม่ใช่ UTF-8 ล้วน */ }
  const loose = new TextDecoder('utf-8').decode(buf)
  if (!looksMisencoded(loose)) return { text: loose, encoding: 'utf8' }
  try {
    const thai = new TextDecoder('windows-874').decode(buf)
    if (THAI_RE.test(thai)) return { text: thai, encoding: 'thai-windows' }
  } catch { /* เบราว์เซอร์ไม่รองรับ windows-874 */ }
  return { text: loose, encoding: 'misencoded' }
}

// ไฟล์ Excel ตัวจริง (.xlsx = zip 'PK', .xls = OLE) ที่ถูกเลือกมาแทน CSV
function isExcelBinary(head: Uint8Array): boolean {
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return true
  return head.length >= 4 && head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0
}

// Excel แปลงรหัสตัวเลขยาวเป็นเลขยกกำลัง (8851234567890 → 8.85123E+12) แล้วบันทึกลงไฟล์แบบนั้น = รหัสเสียไปแล้ว
const SCIENTIFIC_RE = /^[+-]?\d+(?:[.,]\d+)?e[+-]?\d+$/i

interface MappedColumn { field: ImportField; header: string }

interface Prepared {
  rows: ImportRowInput[]
  mapped: MappedColumn[]
  ignored: string[]
  problems: string[]   // ปัญหาที่ต้องแก้ไฟล์ก่อน (ไม่ส่งไปตรวจ)
}

function cellValue(raw: string | undefined): string | null {
  const t = unguardCell(String(raw ?? '').trim()).trim()
  return t === '' ? null : t
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US')
}

/** ข้อความ CSV → แถวที่จะส่งให้ import_products (+ ปัญหาที่ตรวจได้ในเครื่อง) */
function prepareRows(text: string): Prepared {
  const out: Prepared = { rows: [], mapped: [], ignored: [], problems: [] }
  const records = parseCsvRecords(text)
  if (records.length === 0) {
    out.problems.push('ไฟล์ว่าง — ไม่มีหัวตารางและข้อมูลสินค้า')
    return out
  }

  // หัวตาราง = แถวแรกที่มีข้อมูล
  const colOf = new Map<ImportField, number>()
  const headerCells = records[0].cells
  for (let i = 0; i < headerCells.length; i++) {
    const shown = unguardCell(headerCells[i].trim())
    const key = normHeader(headerCells[i])
    if (!key || IGNORED_SET.has(key)) continue
    const field = ALIAS_TO_FIELD.get(key)
    if (!field) {
      out.ignored.push(shown)
      continue
    }
    const dup = colOf.get(field)
    if (dup !== undefined) {
      out.problems.push(
        `คอลัมน์ "${unguardCell(headerCells[dup].trim())}" และ "${shown}" เป็นข้อมูลเดียวกัน (${FIELD_LABEL[field]}) — ลบออกให้เหลือคอลัมน์เดียว`,
      )
      continue
    }
    colOf.set(field, i)
    out.mapped.push({ field, header: shown })
  }
  if (!colOf.has('sku')) {
    out.problems.push('ไม่พบคอลัมน์ SKU ในแถวแรกของไฟล์ — แถวแรกต้องเป็นหัวตาราง และต้องมีคอลัมน์ SKU (หรือ รหัสสินค้า) ดูไฟล์ตัวอย่างประกอบ')
  }
  if (out.problems.length > 0) return out

  const sciIssues: string[] = []
  for (let r = 1; r < records.length; r++) {
    const rec = records[r]
    const row: ImportRowInput = {
      row: rec.line,
      name: null, category: null, color: null, size: null, sku: null, barcode: null,
      cost_price: null, sell_price: null, stock: null, min_stock: null,
    }
    let any = false
    colOf.forEach((idx, field) => {
      const v = cellValue(rec.cells[idx])
      row[field] = v
      if (v !== null) any = true
    })
    // แถวที่ช่องที่ใช้ว่างหมด (เช่นมีแค่คอลัมน์สถานะ หรือ ,,,, ท้ายไฟล์) = ข้าม
    if (!any) continue
    for (const f of ['sku', 'barcode'] as const) {
      const v = row[f]
      if (v !== null && SCIENTIFIC_RE.test(v)) {
        sciIssues.push(`แถว ${fmtInt(rec.line)}: ${FIELD_LABEL[f]} "${v}" ถูก Excel แปลงเป็นเลขยกกำลังจนรหัสเสีย`)
      }
    }
    out.rows.push(row)
  }

  if (out.rows.length === 0) {
    out.problems.push('ไม่มีข้อมูลสินค้าใต้หัวตาราง')
  } else if (out.rows.length > MAX_ROWS) {
    out.problems.push(`ไฟล์มี ${fmtInt(out.rows.length)} แถว — นำเข้าได้ครั้งละไม่เกิน ${fmtInt(MAX_ROWS)} แถว แบ่งเป็นหลายไฟล์แล้วนำเข้าทีละไฟล์`)
  }
  if (sciIssues.length > 0) {
    const shown = sciIssues.slice(0, 15)
    if (sciIssues.length > shown.length) shown.push(`และอีก ${fmtInt(sciIssues.length - shown.length)} แถว`)
    out.problems.push(
      'ใน Excel ให้คลิกขวาที่คอลัมน์ SKU/บาร์โค้ด → จัดรูปแบบเซลล์ → ข้อความ แล้วพิมพ์รหัสเต็มใหม่ก่อนบันทึก',
      ...shown,
    )
  }
  return out
}

// ---------------------------------------------------------------------------
// error ของ RPC
// ---------------------------------------------------------------------------
// เซิร์ฟเวอร์ตอบกลับจริง (มีรหัส SQLSTATE/PostgREST) — ไม่มีรหัส = เน็ตหลุด/หมดเวลา ไม่รู้ว่าบันทึกไปหรือยัง
function serverAnswered(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  if (typeof code !== 'string') return false
  return /^PGRST\d+$/.test(code) || /^(?!E)[0-9A-Z]{5}$/.test(code)
}

function rpcErrorText(err: unknown): string {
  if (isMigrationMissing(err)) return FIX04_MISSING_MSG
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; message?: unknown }
    // สิทธิ์ไม่พอพร้อมเหตุผลภาษาไทยจาก RPC → ใช้ข้อความนั้นตรงๆ
    if (String(e.code ?? '') === '42501' && typeof e.message === 'string' && THAI_RE.test(e.message)) return e.message.trim()
  }
  return thaiError(err)
}

// ค่าของการเปลี่ยนแปลง: ราคาแสดงเป็นบาท, ว่าง = (ว่าง)
function changeValue(field: ImportChange['field'], v: string | null): string {
  if (v === null) return '(ว่าง)'
  if (field === 'sell_price' || field === 'cost_price') {
    const n = Number(v)
    return Number.isFinite(n) ? baht(n) : v
  }
  return v
}

type Busy = 'read' | 'check' | 'import' | null
type Filter = 'all' | 'error' | 'change'
type Notice = { tone: 'err' | 'warn'; text: string; recheck?: boolean; productsLink?: boolean }

interface Picked {
  name: string
  bytes: number
  clientId: string
  encoding: Encoding
  rows: ImportRowInput[]
  mapped: MappedColumn[]
  ignored: string[]
}

const isChange = (a: ImportAction) => a === 'create' || a === 'add_size' || a === 'update'

// ---------------------------------------------------------------------------
// หน้า
// ---------------------------------------------------------------------------
export default function ImportClient({ canStock }: { canStock: boolean }) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const busyRef = useRef<Busy>(null)

  const [busy, setBusyState] = useState<Busy>(null)
  const [fileName, setFileName] = useState('')
  const [problems, setProblems] = useState<string[]>([])
  const [picked, setPicked] = useState<Picked | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [shown, setShown] = useState(SHOW_STEP)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [done, setDone] = useState<ImportResult | null>(null)
  const doneRef = useRef<HTMLHeadingElement>(null)

  function setBusy(b: Busy) {
    busyRef.current = b
    setBusyState(b)
  }

  // นำเข้าเสร็จ: ย้ายโฟกัสไปหัวข้อผลลัพธ์ (โปรแกรมอ่านจอประกาศ + มือถือเห็นผลทันทีไม่ต้องเลื่อนหา)
  useEffect(() => {
    if (!done) return
    doneRef.current?.focus()
    doneRef.current?.scrollIntoView({ block: 'center' })
  }, [done])

  // กำลังบันทึกแล้วปิด/รีโหลดหน้า → เตือนก่อน (ถึงปิดไป เซิร์ฟเวอร์ก็ทำต่อจนจบหรือไม่บันทึกเลย แต่ผู้ใช้จะไม่เห็นผล)
  useEffect(() => {
    if (busy !== 'import') return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [busy])

  function resetAll() {
    setFileName('')
    setProblems([])
    setPicked(null)
    setResult(null)
    setNotice(null)
    setFilter('all')
    setShown(SHOW_STEP)
    setConfirmOpen(false)
    setDone(null)
  }

  function chooseFile() {
    if (busyRef.current) return
    inputRef.current?.click()
  }

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = '' // เลือกไฟล์เดิมซ้ำได้ (แก้ไฟล์แล้วเลือกใหม่)
    if (!f || busyRef.current) return
    resetAll()
    setFileName(f.name)

    if (/\.(xlsx|xlsm|xls)$/i.test(f.name)) {
      setProblems(['ไฟล์นี้เป็นไฟล์ Excel (.xlsx) — ระบบอ่านได้เฉพาะ CSV: ใน Excel กด บันทึกเป็น → เลือกชนิด "CSV UTF-8 (คั่นด้วยจุลภาค)" แล้วเลือกไฟล์นั้นแทน'])
      return
    }
    if (f.size > MAX_BYTES) {
      setProblems([`ไฟล์ใหญ่เกิน 2 MB (${(f.size / 1048576).toFixed(1)} MB) — แบ่งเป็นหลายไฟล์ แล้วนำเข้าทีละไฟล์`])
      return
    }
    if (f.size === 0) {
      setProblems(['ไฟล์ว่าง — ไม่มีหัวตารางและข้อมูลสินค้า'])
      return
    }

    setBusy('read')
    let next: Picked
    try {
      const head = new Uint8Array(await f.slice(0, 4).arrayBuffer())
      if (isExcelBinary(head)) {
        setProblems(['ไฟล์นี้เป็นไฟล์ Excel ไม่ใช่ CSV — ใน Excel กด บันทึกเป็น → เลือกชนิด "CSV UTF-8 (คั่นด้วยจุลภาค)" แล้วเลือกไฟล์นั้นแทน'])
        return
      }
      const { text, encoding } = await readFileText(f)
      const prep = prepareRows(text)
      if (prep.problems.length > 0) {
        setProblems(prep.problems)
        return
      }
      next = {
        name: f.name,
        bytes: f.size,
        clientId: newUuid(),
        encoding,
        rows: prep.rows,
        mapped: prep.mapped,
        ignored: prep.ignored,
      }
    } catch {
      setProblems(['อ่านไฟล์ไม่ได้ กรุณาเลือกไฟล์ใหม่'])
      return
    } finally {
      if (busyRef.current === 'read') setBusy(null)
    }
    setPicked(next)
    await runCheck(next)
  }

  /** ตรวจทั้งไฟล์กับฐานข้อมูล (dry run — ไม่บันทึกอะไร) */
  async function runCheck(p: Picked) {
    if (busyRef.current) return
    setBusy('check')
    setNotice(null)
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; ctrl?.abort() }, CHECK_TIMEOUT_MS)
    try {
      let req = supabase.rpc('import_products', { p_client_id: p.clientId, p_rows: p.rows, p_dry_run: true })
      if (ctrl) req = req.abortSignal(ctrl.signal)
      const { data, error } = await req
      if (error) throw error
      const parsed = parseImportResult(data)
      if (!parsed) throw new Error('อ่านผลการตรวจไฟล์ไม่ได้ ลองกด "ตรวจอีกครั้ง"')
      setResult(parsed)
      setFilter(parsed.summary.errors > 0 ? 'error' : 'all')
      setShown(SHOW_STEP)
    } catch (err) {
      setResult(null)
      setNotice({
        tone: 'err',
        text: timedOut ? 'ตรวจไฟล์นานเกินไป — ตรวจอินเทอร์เน็ต หรือแบ่งไฟล์ให้เล็กลง แล้วกด "ตรวจอีกครั้ง"' : rpcErrorText(err),
        recheck: !isMigrationMissing(err),
      })
    } finally {
      clearTimeout(timer)
      setBusy(null)
    }
  }

  /** บันทึกจริง (client_id เดิมของไฟล์นี้ — กดซ้ำได้ปลอดภัย) */
  async function runImport() {
    if (!picked || busyRef.current) return
    setBusy('import')
    setNotice(null)
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; ctrl?.abort() }, IMPORT_TIMEOUT_MS)
    let answered = false
    try {
      let req = supabase.rpc('import_products', { p_client_id: picked.clientId, p_rows: picked.rows, p_dry_run: false })
      if (ctrl) req = req.abortSignal(ctrl.signal)
      const { data, error } = await req
      if (error) throw error
      answered = true
      const parsed = parseImportResult(data)
      setConfirmOpen(false)
      if (!parsed) {
        // บันทึกแล้วแน่นอน (เซิร์ฟเวอร์ตอบสำเร็จ) แต่อ่านสรุปไม่ได้
        setNotice({ tone: 'warn', text: 'นำเข้าเสร็จแล้ว แต่อ่านสรุปผลไม่ได้ — ตรวจรายการที่หน้าสินค้า', productsLink: true })
        return
      }
      setDone(parsed)
    } catch (err) {
      setConfirmOpen(false)
      if (!timedOut && serverAnswered(err)) {
        answered = true
        // เซิร์ฟเวอร์ปฏิเสธทั้งไฟล์ = ไม่ได้บันทึกอะไรเลย (เช่นข้อมูลในระบบเปลี่ยนหลังตรวจ จนบางแถวผิด)
        setNotice({ tone: 'err', text: `${rpcErrorText(err)} — ยังไม่ได้บันทึกอะไร กด "ตรวจอีกครั้ง" เพื่อดูแถวที่ต้องแก้`, recheck: !isMigrationMissing(err) })
      } else {
        setNotice({
          tone: 'warn',
          text: 'ไม่แน่ใจว่านำเข้าสำเร็จหรือไม่ เพราะการเชื่อมต่อขาดหรือรอนานเกินไประหว่างบันทึก — เปิดหน้าสินค้าตรวจดูก่อน ถ้ายังไม่มีสินค้าจากไฟล์นี้ กด "นำเข้า" อีกครั้งได้อย่างปลอดภัย (ระบบจำรหัสการนำเข้าครั้งนี้ไว้ จะไม่สร้างสินค้าซ้ำ)',
          productsLink: true,
        })
      }
    } finally {
      clearTimeout(timer)
      setBusy(null)
      // ข้อมูลสินค้าเปลี่ยน → ล้างแคชหน้าอื่นในแอป (กลับไปหน้าสินค้าจะเห็นของใหม่)
      if (answered && navigator.onLine !== false) router.refresh()
    }
  }

  // ----- ค่าที่ใช้แสดงผล -----
  const rows = useMemo(() => result?.rows ?? [], [result])
  const errorRows = useMemo(() => rows.filter(r => r.action === 'error').length, [rows])
  const changeRows = useMemo(() => rows.filter(r => isChange(r.action)).length, [rows])
  const filtered = useMemo(
    () => (filter === 'error' ? rows.filter(r => r.action === 'error') : filter === 'change' ? rows.filter(r => isChange(r.action)) : rows),
    [rows, filter],
  )
  const visible = filtered.slice(0, shown)
  const summary = result?.summary ?? null
  const errorCount = summary ? Math.max(summary.errors, errorRows) : 0
  const canImport = !!picked && !!summary && errorCount === 0 && changeRows > 0 && busy === null && !done
  const encodingWarn = picked?.encoding === 'misencoded' || picked?.encoding === 'thai-windows'

  return (
    <div className="space-y-4 sm:space-y-6">
      {!done && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6 lg:items-start">
          {/* ===== ขั้นที่ 1: เตรียมไฟล์ ===== */}
          <section className="card p-4 sm:p-5 space-y-4" aria-labelledby="import-step1">
            <StepTitle n={1} id="import-step1">เตรียมไฟล์</StepTitle>
            <div className="space-y-2 text-sm text-gray-700 leading-relaxed">
              <p>
                ใช้ไฟล์ CSV ที่แถวแรกเป็นหัวตาราง (1 แถว = 1 SKU) — เริ่มจากไฟล์ตัวอย่าง หรือกด <span className="font-medium">ส่งออก Excel</span> ที่หน้าสินค้า
                แก้ใน Excel แล้วนำเข้ากลับได้เลย
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li><span className="font-medium">SKU ที่มีอยู่แล้ว</span> อัปเดตได้เฉพาะ ราคาขาย ราคาทุน บาร์โค้ด และขั้นต่ำ (ช่องว่าง = ไม่เปลี่ยน)</li>
                <li><span className="font-medium">SKU ใหม่</span> = สร้างสินค้าใหม่ ต้องมีชื่อและราคาขาย</li>
                <li>ทุกแถวต้องถูกต้องจึงจะนำเข้าได้ — ระบบบันทึกทั้งไฟล์ในครั้งเดียว</li>
              </ul>
            </div>
            <button
              type="button"
              onClick={() => downloadCsv('newcute-products-template.csv', TEMPLATE_ROWS)}
              className="btn-secondary w-full sm:w-auto"
            >
              <FileDown {...ICON_SM} />
              ดาวน์โหลดไฟล์ตัวอย่าง
            </button>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-900">ชื่อคอลัมน์ที่ใช้ได้</p>
              <ul className="rounded-lg border border-gray-200 divide-y divide-gray-150 text-sm">
                {COLUMN_HELP.map(c => (
                  <li key={c.field} className="px-3.5 py-2.5">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold text-gray-900">{FIELD_LABEL[c.field]}</span>
                      {c.required && <span className="chip-outline">จำเป็น</span>}
                      <span className="text-xs text-gray-500 break-words">
                        หรือ {FIELD_ALIASES[c.field].filter(a => normHeader(a) !== normHeader(FIELD_LABEL[c.field])).join(', ')}
                      </span>
                    </p>
                    {c.note && <p className="text-xs text-gray-600 mt-0.5 break-words">{c.note}</p>}
                  </li>
                ))}
                <li className="px-3.5 py-2.5 text-xs text-gray-500">
                  คอลัมน์ <span className="font-medium text-gray-700">สถานะ</span> และคอลัมน์อื่นที่ไม่รู้จัก ระบบข้ามให้ · ตัวพิมพ์เล็ก/ใหญ่และช่องว่างในหัวตารางไม่มีผล
                </li>
              </ul>
              {!canStock && (
                <p className="flex items-start gap-1.5 text-xs text-amber-800">
                  <AlertTriangle {...ICON_XS} className="mt-px shrink-0" />
                  <span className="min-w-0">บัญชีนี้ไม่มีสิทธิ์รับ-จ่ายสต๊อก — ช่องสต๊อกของสินค้าใหม่ต้องว่างหรือเป็น 0</span>
                </p>
              )}
            </div>

            <div className="alert-info">
              <Info {...ICON_SM} />
              <div className="min-w-0 space-y-1">
                <p>ใน Excel กด <span className="font-semibold">บันทึกเป็น → CSV UTF-8</span> (ภาษาไทยจะไม่เพี้ยน)</p>
                <p>
                  ไฟล์จากปุ่ม &ldquo;ส่งออก Excel&rdquo; เก็บ SKU/บาร์โค้ดเป็นข้อความไว้แล้ว — ถ้าพิมพ์รหัสตัวเลขยาวลงเซลล์ใหม่เอง
                  ให้จัดรูปแบบเซลล์เป็น &ldquo;ข้อความ&rdquo; ก่อนพิมพ์ ไม่งั้น Excel จะตัดเลข 0 ข้างหน้าหรือแปลงเป็น 8.85E+12
                </p>
              </div>
            </div>
          </section>

          {/* ===== ขั้นที่ 2: เลือกไฟล์ ===== */}
          <section className="card p-4 sm:p-5 space-y-4" aria-labelledby="import-step2">
            <StepTitle n={2} id="import-step2">เลือกไฟล์</StepTitle>
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              // มือถือ Android บางรุ่นรายงานไฟล์ CSV เป็นชนิดอื่น → ใส่ชื่อชนิดที่พบบ่อยด้วย ไม่งั้นไฟล์ถูกทำเป็นสีเทาเลือกไม่ได้
              accept=".csv,text/csv,text/comma-separated-values,application/csv"
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={onPick}
            />
            <button
              type="button"
              onClick={chooseFile}
              disabled={busy !== null}
              aria-controls={inputId}
              className="w-full rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 flex flex-col items-center gap-2 text-center transition-colors [@media(hover:hover)]:hover:bg-gray-50 [@media(hover:hover)]:hover:border-gray-400 active:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="icon-bubble">
                {busy === 'read' || busy === 'check' ? <Loader2 {...ICON} className="animate-spin" /> : <FileUp {...ICON} />}
              </span>
              <span className="text-base font-semibold text-gray-900">
                {busy === 'read' ? 'กำลังอ่านไฟล์...' : busy === 'check' ? 'กำลังตรวจข้อมูลกับระบบ...' : fileName ? 'เลือกไฟล์ใหม่' : 'เลือกไฟล์ CSV'}
              </span>
              <span className="text-xs text-gray-500">ไฟล์ .csv ไม่เกิน 2 MB และไม่เกิน {fmtInt(MAX_ROWS)} แถว</span>
            </button>

            <div aria-live="polite" className="space-y-3">
              {fileName && (
                <p className="flex items-start gap-2 text-sm text-gray-700">
                  <FileSpreadsheet {...ICON_SM} className="mt-px shrink-0 text-gray-500" />
                  <span className="min-w-0 break-all">
                    <span className="font-medium text-gray-900">{fileName}</span>
                    {picked && <span className="text-gray-500"> · {fmtInt(picked.rows.length)} แถวข้อมูล</span>}
                  </span>
                </p>
              )}

              {problems.length > 0 && (
                <div role="alert" className="alert-err">
                  <XCircle {...ICON_SM} />
                  <div className="min-w-0 space-y-1">
                    <p className="font-semibold">แก้ไฟล์ก่อน แล้วเลือกไฟล์ใหม่</p>
                    <ul className="space-y-0.5">
                      {problems.map((p, i) => <li key={i} className="break-words">{p}</li>)}
                    </ul>
                  </div>
                </div>
              )}

              {picked?.encoding === 'misencoded' && (
                <div role="alert" className="alert-warn">
                  <AlertTriangle {...ICON_SM} />
                  <p className="min-w-0">
                    ไฟล์ไม่ใช่ UTF-8 ภาษาไทยจะเพี้ยน — ใน Excel กด บันทึกเป็น → CSV UTF-8 แล้วเลือกไฟล์ใหม่ (ตรวจชื่อสินค้าในตารางด้านล่างก่อนนำเข้า)
                  </p>
                </div>
              )}
              {picked?.encoding === 'thai-windows' && (
                <div className="alert-warn">
                  <AlertTriangle {...ICON_SM} />
                  <p className="min-w-0">
                    ไฟล์นี้บันทึกเป็น CSV แบบเก่า (ไม่ใช่ UTF-8) — ระบบแปลงภาษาไทยให้แล้ว ตรวจชื่อสินค้าในตารางด้านล่างว่าอ่านถูกต้อง
                    ครั้งหน้าแนะนำให้บันทึกเป็น CSV UTF-8
                  </p>
                </div>
              )}

              {picked && (
                <div className="space-y-1.5 text-xs text-gray-600">
                  <p className="break-words">
                    <span className="font-medium text-gray-700">อ่านคอลัมน์:</span>{' '}
                    {picked.mapped.map(m => (m.header && normHeader(m.header) !== normHeader(FIELD_LABEL[m.field])
                      ? `${m.header} (${FIELD_LABEL[m.field]})`
                      : FIELD_LABEL[m.field])).join(', ')}
                  </p>
                  {picked.ignored.length > 0 && (
                    <p className="break-words">
                      <span className="font-medium text-gray-700">ไม่ได้ใช้:</span> {picked.ignored.join(', ')}
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {notice && (
        <div role={notice.tone === 'err' ? 'alert' : 'status'} className={notice.tone === 'err' ? 'alert-err' : 'alert-warn'}>
          {notice.tone === 'err' ? <XCircle {...ICON_SM} /> : <AlertTriangle {...ICON_SM} />}
          <div className="min-w-0 space-y-2">
            <p className="break-words">{notice.text}</p>
            {(notice.recheck || notice.productsLink) && picked && (
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {notice.recheck && (
                  <button type="button" onClick={() => runCheck(picked)} disabled={busy !== null} className="btn-secondary w-full sm:w-auto">
                    {busy === 'check' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <RefreshCw {...ICON_SM} />}
                    ตรวจอีกครั้ง
                  </button>
                )}
                {notice.productsLink && (
                  // แท็บใหม่ — หน้านี้ยังจำไฟล์และรหัสการนำเข้าเดิมไว้ กดนำเข้าซ้ำได้โดยไม่สร้างซ้ำ
                  <a href="/products" target="_blank" rel="noopener" className="btn-secondary w-full sm:w-auto">
                    <ArrowRight {...ICON_SM} />
                    เปิดหน้าสินค้า (แท็บใหม่)
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== ขั้นที่ 3: ผลการตรวจ ===== */}
      {!done && picked && summary && (
        <section className="card overflow-hidden" aria-labelledby="import-step3">
          <div className="card-header flex-wrap">
            <StepTitle n={3} id="import-step3">ตรวจสอบก่อนนำเข้า</StepTitle>
            <span className="chip tabular-nums">{fmtInt(summary.rows || rows.length)} แถว</span>
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap gap-2" aria-label="สรุปผลการตรวจ">
              <SummaryChip label="สร้างแบบใหม่" value={summary.create_groups} />
              <SummaryChip label="SKU ใหม่" value={summary.create_skus} />
              <SummaryChip label="เพิ่มไซส์" value={summary.add_sizes} />
              <SummaryChip label="อัปเดต" value={summary.update_skus} />
              <SummaryChip label="ไม่เปลี่ยน" value={summary.unchanged_skus} />
              <span className={`${errorCount > 0 ? 'badge-out' : 'chip'} tabular-nums`}>ผิดพลาด {fmtInt(errorCount)}</span>
              {summary.opening_qty > 0 && <SummaryChip label="สต๊อกยกมารวม" value={summary.opening_qty} unit="ชิ้น" />}
            </div>
            {summary.new_categories.length > 0 && (
              <p className="text-sm text-gray-700 break-words">
                <span className="font-medium">หมวดหมู่ใหม่ที่จะสร้าง:</span> {summary.new_categories.join(', ')}
              </p>
            )}

            {errorCount > 0 ? (
              <div role="alert" className="alert-err">
                <XCircle {...ICON_SM} />
                <p className="min-w-0">
                  พบแถวที่ผิด {fmtInt(errorCount)} แถว — แก้ในไฟล์แล้วกด &ldquo;เลือกไฟล์ใหม่&rdquo; (นำเข้าได้เมื่อไม่มีแถวผิดเลย)
                </p>
              </div>
            ) : changeRows === 0 ? (
              <div role="status" className="alert-info">
                <Info {...ICON_SM} />
                <p className="min-w-0">ทุกแถวตรงกับข้อมูลในระบบแล้ว — ไม่มีอะไรต้องนำเข้า</p>
              </div>
            ) : (
              <div role="status" className="alert-ok">
                <CheckCircle2 {...ICON_SM} />
                <p className="min-w-0">ไฟล์ถูกต้อง พร้อมนำเข้า {fmtInt(changeRows)} รายการ</p>
              </div>
            )}

            {/* ตัวกรอง */}
            <div className="flex flex-wrap gap-2" role="group" aria-label="กรองแถว">
              <FilterButton active={filter === 'all'} onClick={() => { setFilter('all'); setShown(SHOW_STEP) }}>
                ทั้งหมด {fmtInt(rows.length)}
              </FilterButton>
              <FilterButton active={filter === 'error'} onClick={() => { setFilter('error'); setShown(SHOW_STEP) }}>
                ผิดพลาด {fmtInt(errorRows)}
              </FilterButton>
              <FilterButton active={filter === 'change'} onClick={() => { setFilter('change'); setShown(SHOW_STEP) }}>
                จะเปลี่ยน {fmtInt(changeRows)}
              </FilterButton>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="empty-state border-t border-gray-200">
              <p className="empty-state-title">ไม่มีแถวในกลุ่มนี้</p>
            </div>
          ) : (
            <>
              {/* มือถือ: รายการเรียงลงมา */}
              <ul className="md:hidden divide-y divide-gray-150 border-t border-gray-200">
                {visible.map(r => (
                  <li key={`${r.row}-${r.sku ?? ''}`} className={`px-4 py-3 space-y-1.5 ${r.action === 'error' ? 'bg-red-50/40' : ''}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <ActionBadge action={r.action} />
                      <span className="text-xs text-gray-500 tabular-nums">แถว {fmtInt(r.row)}</span>
                    </div>
                    <p className="text-sm font-medium text-gray-900 break-words">{rowLabel(r)}</p>
                    {r.sku && <p className="text-xs text-gray-500 break-all">SKU {r.sku}</p>}
                    <RowDetails r={r} />
                  </li>
                ))}
              </ul>

              {/* แท็บเล็ต/คอม: ตาราง */}
              <div className="hidden md:block table-wrap border-t border-gray-200">
                <table className="table-soft min-w-[720px]">
                  <thead>
                    <tr>
                      <th className="w-16 text-right">แถว</th>
                      <th>SKU</th>
                      <th>สินค้า</th>
                      <th>ผล</th>
                      <th>รายละเอียด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(r => (
                      <tr key={`${r.row}-${r.sku ?? ''}`} className={r.action === 'error' ? 'bg-red-50/40' : ''}>
                        <td className="text-right text-gray-500 tabular-nums align-top">{fmtInt(r.row)}</td>
                        <td className="align-top break-all max-w-[180px]">{r.sku ?? <span className="text-gray-400">-</span>}</td>
                        <td className="align-top break-words max-w-[240px] font-medium text-gray-900">{rowLabel(r)}</td>
                        <td className="align-top whitespace-nowrap"><ActionBadge action={r.action} /></td>
                        <td className="align-top min-w-[220px]">
                          <RowDetails r={r} />
                          {r.errors.length === 0 && r.notes.length === 0 && r.changes.length === 0 && (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {filtered.length > visible.length && (
                <div className="border-t border-gray-200 px-4 py-3 sm:px-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-gray-500">แสดง {fmtInt(visible.length)} จาก {fmtInt(filtered.length)} แถว</p>
                  <button type="button" onClick={() => setShown(s => s + SHOW_STEP)} className="btn-secondary w-full sm:w-auto">
                    <ChevronDown {...ICON_SM} />
                    แสดงเพิ่มอีก {fmtInt(Math.min(SHOW_STEP, filtered.length - visible.length))} แถว
                  </button>
                </div>
              )}
            </>
          )}

          {/* ขั้นที่ 4: นำเข้า */}
          <div className="border-t border-gray-200 px-4 py-4 sm:px-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <p className="text-xs text-gray-500 sm:mr-auto">
              {errorCount > 0
                ? 'แก้แถวที่ผิดในไฟล์ แล้วเลือกไฟล์ใหม่อีกครั้ง'
                : changeRows === 0
                  ? 'ไม่มีรายการที่ต้องบันทึก'
                  : 'ระบบบันทึกทั้งไฟล์ในครั้งเดียว ถ้ามีปัญหาจะไม่บันทึกอะไรเลย'}
            </p>
            <button type="button" onClick={() => runCheck(picked)} disabled={busy !== null} className="btn-ghost w-full sm:w-auto">
              {busy === 'check' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <RefreshCw {...ICON_SM} />}
              ตรวจอีกครั้ง
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={!canImport}
              className="btn-primary w-full sm:w-auto sm:min-w-[200px]"
            >
              {busy === 'import' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Upload {...ICON_SM} />}
              {busy === 'import' ? 'กำลังนำเข้า...' : `นำเข้า ${fmtInt(changeRows)} รายการ`}
            </button>
          </div>
        </section>
      )}

      {/* ===== สำเร็จ ===== */}
      {done && (
        <section className="card p-4 sm:p-6 space-y-4" aria-labelledby="import-done">
          <div className="flex items-start gap-3">
            <span className="icon-bubble icon-bubble-ok shrink-0"><CheckCircle2 {...ICON} /></span>
            <div className="min-w-0">
              <h2 id="import-done" ref={doneRef} tabIndex={-1} className="text-lg font-semibold text-gray-900 focus:outline-none">
                {done.already_saved ? 'ไฟล์นี้นำเข้าไปแล้ว' : 'นำเข้าสินค้าเรียบร้อย'}
              </h2>
              <p className="text-sm text-gray-600 break-all">{picked?.name}</p>
            </div>
          </div>
          {done.already_saved && (
            <div role="status" className="alert-info">
              <Info {...ICON_SM} />
              <p className="min-w-0">ระบบบันทึกไฟล์นี้ไว้ตั้งแต่ครั้งก่อนแล้ว จึงไม่ได้บันทึกซ้ำ — ด้านล่างคือสรุปของครั้งนั้น</p>
            </div>
          )}
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <DoneStat label="สร้างแบบใหม่" value={done.summary.create_groups} unit="แบบ" />
            <DoneStat label="SKU ใหม่" value={done.summary.create_skus} unit="SKU" />
            <DoneStat label="เพิ่มไซส์" value={done.summary.add_sizes} unit="SKU" />
            <DoneStat label="อัปเดต" value={done.summary.update_skus} unit="SKU" />
            {done.summary.opening_qty > 0 && <DoneStat label="สต๊อกยกมา" value={done.summary.opening_qty} unit="ชิ้น" />}
            {done.summary.unchanged_skus > 0 && <DoneStat label="ไม่เปลี่ยน" value={done.summary.unchanged_skus} unit="SKU" />}
          </dl>
          {done.summary.new_categories.length > 0 && (
            <p className="text-sm text-gray-700 break-words">
              <span className="font-medium">หมวดหมู่ใหม่:</span> {done.summary.new_categories.join(', ')}
            </p>
          )}
          {done.summary.opening_qty > 0 && (
            <p className="text-xs text-gray-500">สต๊อกยกมาบันทึกเป็นรายการรับเข้า &ldquo;ยอดยกมา (นำเข้าไฟล์)&rdquo; ดูได้ที่หน้ารับ-จ่ายสต๊อก</p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href="/products" className="btn-primary w-full sm:w-auto">
              ไปหน้าสินค้า
              <ArrowRight {...ICON_SM} />
            </Link>
            <button type="button" onClick={resetAll} className="btn-secondary w-full sm:w-auto">
              <FileUp {...ICON_SM} />
              นำเข้าไฟล์อื่น
            </button>
          </div>
        </section>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`นำเข้าสินค้า ${fmtInt(changeRows)} รายการ?`}
        confirmLabel="นำเข้า"
        busy={busy === 'import'}
        requireAck={encodingWarn ? 'ตรวจแล้วว่าภาษาไทยในตารางอ่านถูกต้อง' : undefined}
        onCancel={() => { if (busyRef.current !== 'import') setConfirmOpen(false) }}
        onConfirm={runImport}
      >
        {summary && (
          <>
            <ul className="space-y-1">
              {summary.create_groups > 0 && (
                <li>สร้างแบบสินค้าใหม่ {fmtInt(summary.create_groups)} แบบ ({fmtInt(summary.create_skus)} SKU)</li>
              )}
              {summary.add_sizes > 0 && <li>เพิ่มไซส์ให้แบบที่มีอยู่ {fmtInt(summary.add_sizes)} SKU</li>}
              {summary.update_skus > 0 && <li>อัปเดตราคา/บาร์โค้ด/ขั้นต่ำ {fmtInt(summary.update_skus)} SKU</li>}
              {summary.new_categories.length > 0 && (
                <li className="break-words">สร้างหมวดหมู่ใหม่: {summary.new_categories.join(', ')}</li>
              )}
              {summary.opening_qty > 0 && (
                <li>รับสต๊อกยกมารวม {fmtInt(summary.opening_qty)} ชิ้น (บันทึกเป็นรายการรับเข้า)</li>
              )}
            </ul>
            <p className="text-gray-500">บันทึกทั้งไฟล์ในครั้งเดียว — ถ้าข้อมูลในระบบเปลี่ยนจนบางแถวใช้ไม่ได้ จะไม่บันทึกอะไรเลย</p>
          </>
        )}
      </ConfirmDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ชิ้นส่วนย่อย
// ---------------------------------------------------------------------------
function rowLabel(r: ImportRowResult): string {
  const name = r.name ?? ''
  const size = r.size ?? ''
  if (name && size) return `${name} · ${size}`
  return name || size || '-'
}

function StepTitle({ n, id, children }: { n: number; id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="section-title">
      <span className="icon-bubble icon-bubble-sm text-sm font-semibold tabular-nums" aria-hidden="true">{n}</span>
      <span className="sr-only">ขั้นที่ {n}: </span>
      {children}
    </h2>
  )
}

function SummaryChip({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <span className={`${value > 0 ? 'chip-outline' : 'chip'} tabular-nums`}>
      {label} <span className="font-semibold text-gray-900">{fmtInt(value)}</span>{unit ? ` ${unit}` : ''}
    </span>
  )
}

function DoneStat({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="panel px-3.5 py-3">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-lg font-semibold text-gray-900 tabular-nums">
        {fmtInt(value)} <span className="text-xs font-normal text-gray-500">{unit}</span>
      </dd>
    </div>
  )
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className="chip-toggle lift-hover lift-tab tabular-nums">
      {children}
    </button>
  )
}

function ActionBadge({ action }: { action: ImportAction }) {
  const meta = ACTION_META[action]
  return <span className={meta.className}>{meta.label}</span>
}

function RowDetails({ r }: { r: ImportRowResult }) {
  if (r.errors.length === 0 && r.notes.length === 0 && r.changes.length === 0) return null
  return (
    <div className="space-y-1">
      {r.errors.map((e, i) => (
        <p key={`e${i}`} className="flex items-start gap-1.5 text-sm text-red-700">
          <AlertCircle {...ICON_XS} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{e}</span>
        </p>
      ))}
      {r.changes.length > 0 && (
        <ul className="space-y-0.5 text-sm text-gray-700">
          {r.changes.map(c => (
            <li key={c.field} className="break-words">
              <span className="text-gray-500">{CHANGE_LABEL[c.field]}:</span>{' '}
              <span className="tabular-nums">{changeValue(c.field, c.from)}</span>
              {' → '}
              <span className="font-semibold text-gray-900 tabular-nums">{changeValue(c.field, c.to)}</span>
            </li>
          ))}
        </ul>
      )}
      {r.notes.map((n, i) => (
        <p key={`n${i}`} className="text-xs text-gray-500 break-words">{n}</p>
      ))}
    </div>
  )
}
