'use client'
// ปุ่มส่งออก CSV (เปิดด้วย Excel) ของร้านเช่าชุด — ช่วงวันที่เดียวกับที่เลือกดูอยู่ในหน้ารายงาน
//   kind 'bookings' → rental_export_bookings(p_from, p_to, p_offset, p_limit)  (การจองตามวันรับชุด)
//   kind 'payments' → rental_export_payments(p_from, p_to, p_offset, p_limit)
//     (รายการเงินตามวันที่เงินเข้า/ออกจริง = confirmed_at — สลิปนับวันอนุมัติ ; ยังไม่ยืนยัน = วันที่แจ้ง · เวลาไทย ทุกสถานะ)
// ดึงทีละ 1,000 แถวด้วย p_offset/p_limit (ห้ามใช้ .range() คู่กัน — แถวจะเลื่อนซ้ำสองชั้น) จนได้หน้าที่ไม่เต็ม
//   (PostgREST ของ Supabase ตัดทุกคำขอไว้ที่ 1,000 แถว รวมผลของ RPC — ขอเกินนี้จะได้แค่ 1,000 แล้วดูเหมือนหน้าสุดท้าย)
// คอลัมน์: ลำดับคงที่ตามชุดคอลัมน์ที่ supabase-fix-06-rental-online.sql ประกาศไว้ (อย่าสลับ — ร้านอาจทำสูตร Excel อ้างคอลัมน์ไว้)
//   สถานะ/ช่องทาง/ประเภท/วิธีชำระใช้ป้ายไทยจากฐานข้อมูล (*_label) — ไม่มีป้ายมาค่อยแปลรหัสด้วยป้ายชุดเดียวกับหน้าจอ
//   ไม่มีคอลัมน์รหัสภายใน (id / โทเคนลิงก์สถานะ / path สลิป) · วันที่แบบ พ.ศ. · เงินเป็นตัวเลขล้วน (Excel ใช้ SUM ได้)
// กดหนึ่งครั้ง = ดาวน์โหลด 1 ไฟล์ (เบราว์เซอร์ยอมให้ดาวน์โหลดอัตโนมัติได้ 1 ไฟล์ต่อการกด)
import { useRef, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { fetchAllRows, PAGE_SIZE } from '@/lib/fetchAllRows'
import { downloadCsv, excelTextCell, toCsv, type CsvCell, type CsvRow } from '@/lib/csvCore'
import { formatThaiDate, formatThaiDateTime } from '@/lib/format'
import { num, round2 } from '@/lib/money'
import {
  FIX06_MISSING_MSG, METHOD_LABELS, PAYMENT_KIND_LABELS, PAYMENT_STATUS_LABELS, SOURCE_LABELS, STATUS_LABELS,
} from '@/lib/rental'
import { rentalErrorText } from './moneyRows'

export type RentalExportKind = 'bookings' | 'payments'

const RPC: Record<RentalExportKind, string> = {
  bookings: 'rental_export_bookings',
  payments: 'rental_export_payments',
}

const FILE_BASE: Record<RentalExportKind, string> = {
  bookings: 'rental-bookings',
  payments: 'rental-payments',
}

// รอคำตอบต่อ 1 หน้า (1,000 แถว) ไม่เกินนี้ — เน็ตค้างแล้วปุ่มหมุนค้างตลอดไป
const PAGE_TIMEOUT_MS = 60000
const TIMEOUT_MSG = 'ดึงข้อมูลนานเกินไป — ตรวจอินเทอร์เน็ต หรือเลือกช่วงวันที่ให้สั้นลง แล้วลองใหม่'

type Row = Record<string, unknown>
type ColType = 'text' | 'code' | 'money' | 'int' | 'date' | 'datetime' | 'bool'

interface Col {
  header: string
  /** คอลัมน์จาก RPC */
  key: string
  type: ColType
  /** ค่าแสดงแทน (เช่น ป้ายสถานะ) — คืน null = ใช้ค่าของ key ตาม type */
  pick?: (r: Row) => string | null
}

function label(map: Readonly<Record<string, string>>, v: unknown): string | null {
  if (typeof v !== 'string' || v === '') return null
  return Object.prototype.hasOwnProperty.call(map, v) ? map[v] : v
}

function labelOr(r: Row, labelKey: string, codeKey: string, map: Readonly<Record<string, string>>): string | null {
  const l = r[labelKey]
  if (typeof l === 'string' && l.trim() !== '') return l
  return label(map, r[codeKey])
}

const PAYMENT_STATE_LABELS: Readonly<Record<string, string>> = { ...PAYMENT_STATUS_LABELS, voided: 'ยกเลิกแล้ว' }

export const EXPORT_COLUMNS: Readonly<Record<RentalExportKind, readonly Col[]>> = {
  bookings: [
    { header: 'เลขที่การจอง', key: 'booking_no', type: 'code' },
    { header: 'สถานะ', key: 'status', type: 'text', pick: r => labelOr(r, 'status_label', 'status', STATUS_LABELS) },
    { header: 'ช่องทาง', key: 'source', type: 'text', pick: r => labelOr(r, 'source_label', 'source', SOURCE_LABELS) },
    { header: 'วันเวลาที่สร้าง', key: 'created_at', type: 'datetime' },
    { header: 'ลูกค้า', key: 'customer_name', type: 'text' },
    { header: 'เบอร์โทร', key: 'customer_phone', type: 'code' },
    { header: 'วันรับชุด', key: 'pickup_date', type: 'date' },
    { header: 'วันคืนชุด', key: 'return_date', type: 'date' },
    { header: 'จำนวนวัน', key: 'days', type: 'int' },
    { header: 'วันที่คืนจริง', key: 'returned_on', type: 'date' },
    { header: 'วันงาน', key: 'event_date', type: 'date' },
    { header: 'ชุดที่เช่า', key: 'items', type: 'text' },
    { header: 'จำนวนชิ้น', key: 'items_count', type: 'int' },
    { header: 'ค่าเช่า', key: 'rent_total', type: 'money' },
    { header: 'ส่วนลด', key: 'discount', type: 'money' },
    { header: 'ค่าจัดส่ง', key: 'delivery_fee', type: 'money' },
    { header: 'ค่าปรับ/ค่าใช้จ่ายเพิ่ม', key: 'charges_total', type: 'money' },
    { header: 'ยอดรวม', key: 'grand_total', type: 'money' },
    { header: 'ชำระแล้ว', key: 'paid', type: 'money' },
    { header: 'ค้างชำระ (ติดลบ = รับเกิน)', key: 'due', type: 'money' },
    { header: 'เงินประกันที่ต้องวาง', key: 'security_required', type: 'money' },
    { header: 'เงินประกันที่ถืออยู่', key: 'security_held', type: 'money' },
    { header: 'มัดจำที่ต้องจ่าย', key: 'deposit_required', type: 'money' },
    { header: 'เหตุผลยกเลิก', key: 'cancel_reason', type: 'text' },
    { header: 'หมายเหตุร้าน', key: 'note', type: 'text' },
    { header: 'ผู้สร้าง', key: 'created_by_name', type: 'text' },
  ],
  payments: [
    { header: 'เลขที่ใบเสร็จ', key: 'receipt_no', type: 'code' },
    { header: 'วันเวลาที่บันทึก/แจ้ง', key: 'created_at', type: 'datetime' },
    { header: 'เลขที่การจอง', key: 'booking_no', type: 'code' },
    { header: 'ลูกค้า', key: 'customer_name', type: 'text' },
    { header: 'ประเภท', key: 'kind', type: 'text', pick: r => labelOr(r, 'kind_label', 'kind', PAYMENT_KIND_LABELS) },
    { header: 'วิธีชำระ', key: 'method', type: 'text', pick: r => labelOr(r, 'method_label', 'method', METHOD_LABELS) },
    { header: 'จำนวนเงิน', key: 'amount', type: 'money' },
    { header: 'สถานะ', key: 'status', type: 'text', pick: r => labelOr(r, 'status_label', 'status', PAYMENT_STATE_LABELS) },
    { header: 'เงินเข้า(+)/ออก(-) จริง', key: 'cash_effect', type: 'money' },
    { header: 'ผลต่อรายรับ', key: 'income_effect', type: 'money' },
    { header: 'มีสลิป', key: 'has_slip', type: 'bool' },
    { header: 'หมายเหตุ', key: 'note', type: 'text' },
    { header: 'ผู้บันทึก', key: 'created_by_name', type: 'text' },
    { header: 'ตรวจสลิปเมื่อ', key: 'reviewed_at', type: 'datetime' },
    { header: 'ยกเลิกรายการเมื่อ', key: 'voided_at', type: 'datetime' },
    { header: 'เหตุผลยกเลิกรายการ', key: 'void_reason', type: 'text' },
    // คอลัมน์สุดท้ายเสมอ (เพิ่มทีหลัง — คอลัมน์เดิมไม่เลื่อน) : ว่าง = ยังไม่ยืนยัน (สลิปรอตรวจ/ไม่อนุมัติ)
    { header: 'วันที่เงินเข้า/ออก', key: 'confirmed_at', type: 'datetime' },
  ],
}

function toCell(col: Col, r: Row): CsvCell {
  const picked = col.pick ? col.pick(r) : null
  if (picked !== null) return picked
  const v = r[col.key]
  if (v === null || v === undefined || v === '') return null
  switch (col.type) {
    case 'money':
      return round2(num(v))
    case 'int': {
      const n = Math.trunc(num(v))
      return Number.isFinite(n) ? n : null
    }
    case 'bool':
      return v === true || v === 'true' ? 'ใช่' : 'ไม่'
    case 'date':
      return formatThaiDate(String(v))
    case 'datetime':
      return formatThaiDateTime(String(v))
    case 'code':
      // เลขที่เอกสาร/เบอร์โทร — Excel ชอบตัด 0 หน้า/แปลงเป็นวันที่ → เก็บเป็นข้อความ
      return excelTextCell(String(v))
    default:
      return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : JSON.stringify(v)
  }
}

/** แถวจาก RPC → ข้อความ CSV (มี BOM) ; แถวที่อ่านไม่ได้ถูกข้าม */
export function rentalExportCsv(kind: RentalExportKind, rows: readonly unknown[]): string {
  const cols = EXPORT_COLUMNS[kind]
  const out: CsvRow[] = [cols.map(c => c.header)]
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const r = raw as Row
    out.push(cols.map(c => toCell(c, r)))
  }
  return toCsv(out, { bom: true })
}

function fileName(kind: RentalExportKind, fromKey: string, toKey: string): string {
  const a = fromKey.replace(/-/g, '')
  const b = toKey.replace(/-/g, '')
  return `${FILE_BASE[kind]}-${a}${b && b !== a ? `-${b}` : ''}.csv`
}

export default function RentalExportButton({
  kind,
  label: buttonLabel,
  fromKey,
  toKey,
  disabled = false,
  onResult,
  className = '',
}: {
  kind: RentalExportKind
  label: string
  fromKey: string
  toKey: string
  disabled?: boolean
  /** ผลลัพธ์ให้หน้าแสดง: ok = ดาวน์โหลดแล้ว (count แถว) / error = ข้อความไทย */
  onResult: (r: { ok: true; count: number } | { ok: false; error: string }) => void
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(0)
  const busyRef = useRef(false)

  async function run() {
    if (busyRef.current || disabled) return
    busyRef.current = true
    setBusy(true)
    setLoaded(0)
    const supabase = createClient()
    // error ตัวจริงจาก RPC (มีรหัส) — fetchAllRows โยนแค่ข้อความที่แปลแล้ว
    let rawError: unknown = null
    let timedOut = false
    try {
      const rows = await fetchAllRows<unknown>(async (from, to) => {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
        const timer = setTimeout(() => { timedOut = true; ctrl?.abort() }, PAGE_TIMEOUT_MS)
        try {
          let req = supabase.rpc(RPC[kind], { p_from: fromKey, p_to: toKey, p_offset: from, p_limit: to - from + 1 })
          if (ctrl) req = req.abortSignal(ctrl.signal)
          const res = await req
          if (res.error) rawError = rawError ?? res.error
          else if (Array.isArray(res.data) && (from > 0 || res.data.length >= PAGE_SIZE)) setLoaded(from + res.data.length)
          return res
        } finally {
          clearTimeout(timer)
        }
      })
      if (rows.length === 0) {
        onResult({ ok: false, error: `ไม่มีข้อมูลในช่วง ${formatThaiDate(fromKey)} – ${formatThaiDate(toKey)}` })
        return
      }
      downloadCsv(fileName(kind, fromKey, toKey), rentalExportCsv(kind, rows))
      onResult({ ok: true, count: rows.length })
    } catch (err) {
      onResult({ ok: false, error: timedOut ? TIMEOUT_MSG : rentalErrorText(rawError ?? err, FIX06_MISSING_MSG) })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={disabled || busy}
      className={`btn-secondary w-full sm:w-auto ${className}`}
      aria-live="polite"
    >
      {busy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Download {...ICON_SM} />}
      {busy ? `กำลังดึงข้อมูล${loaded > 0 ? ` ${loaded.toLocaleString('en-US')} แถว` : ''}...` : buttonLabel}
    </button>
  )
}
