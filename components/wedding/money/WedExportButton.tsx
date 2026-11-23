'use client'
// ปุ่มส่งออก CSV (เปิดด้วย Excel) ของร้าน b.oncloud — ช่วงวันที่เดียวกับที่เลือกดูอยู่ในหน้ารายงาน (เฉพาะผู้จัดการ)
//   'bookings'  → wed_export_bookings(p_from, p_to, p_offset, p_limit)   งานตามวันงานแรก
//   'payments'  → wed_export_payments(...)                               รายการเงินตามวันที่รับ/คืนจริง (รวมที่ยกเลิก)
//   'crew_fees' → wed_export_crew_fees(...)                              ค่าตัวทีมตามวันคิวงาน
// ดึงทีละ 1,000 แถวด้วย p_offset/p_limit (ห้ามใช้ .range() คู่กัน — แถวจะเลื่อนซ้ำสองชั้น) จนได้หน้าที่ไม่เต็ม
//   (PostgREST ของ Supabase ตัดทุกคำขอไว้ที่ 1,000 แถว รวมผลของ RPC)
// คอลัมน์: ลำดับคงที่ (อย่าสลับ — ร้านอาจทำสูตร Excel อ้างคอลัมน์ไว้ ; เพิ่มคอลัมน์ใหม่ต่อท้ายเท่านั้น)
//   ป้ายไทยจากฐานข้อมูล (*_label) · วันที่แบบ พ.ศ. · เงินเป็นตัวเลขล้วน (Excel ใช้ SUM ได้) · เลขที่/เบอร์เก็บเป็นข้อความ
// กดหนึ่งครั้ง = ดาวน์โหลด 1 ไฟล์
import { useRef, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { fetchAllRows, PAGE_SIZE } from '@/lib/fetchAllRows'
import { downloadCsv, excelTextCell, toCsv, type CsvCell, type CsvRow } from '@/lib/csvCore'
import { formatThaiDate, formatThaiDateTime } from '@/lib/format'
import {
  WED_EXPORT_PAGE_SIZE, parseExportBookings, parseExportCrewFees, parseExportPayments,
  type WedExportBookingRow, type WedExportCrewFeeRow, type WedExportPaymentRow,
} from '@/lib/wedding'
import { wedErrorText } from './wedRpc'

export type WedExportKind = 'bookings' | 'payments' | 'crew_fees'

const RPC: Record<WedExportKind, string> = {
  bookings: 'wed_export_bookings',
  payments: 'wed_export_payments',
  crew_fees: 'wed_export_crew_fees',
}

const FILE_BASE: Record<WedExportKind, string> = {
  bookings: 'wedding-bookings',
  payments: 'wedding-payments',
  crew_fees: 'wedding-crew-fees',
}

// รอคำตอบต่อ 1 หน้า (1,000 แถว) ไม่เกินนี้ — เน็ตค้างแล้วปุ่มหมุนค้างตลอดไป
const PAGE_TIMEOUT_MS = 60000
const TIMEOUT_MSG = 'ดึงข้อมูลนานเกินไป — ตรวจอินเทอร์เน็ต หรือเลือกช่วงวันที่ให้สั้นลง แล้วลองใหม่'

const date = (v: string | null) => (v ? formatThaiDate(v) : null)
const datetime = (v: string | null) => (v ? formatThaiDateTime(v) : null)
const code = (v: string | null) => (v ? excelTextCell(v) : null)
const text = (v: string | null) => (v && v.trim() !== '' ? v : null)

interface Col<T> { header: string; cell: (r: T) => CsvCell }

const BOOKING_COLS: readonly Col<WedExportBookingRow>[] = [
  { header: 'เลขที่งาน', cell: r => code(r.booking_no) },
  { header: 'สถานะ', cell: r => text(r.status_label) },
  { header: 'ช่องทาง', cell: r => text(r.source_label) },
  { header: 'วันเวลาที่สร้าง', cell: r => datetime(r.created_at) },
  { header: 'คู่บ่าวสาว', cell: r => text(r.couple_names) },
  { header: 'ลูกค้า (ผู้ติดต่อ)', cell: r => text(r.customer_name) },
  { header: 'เบอร์โทร', cell: r => code(r.customer_phone) },
  { header: 'วันงานแรก', cell: r => date(r.first_date) },
  { header: 'วันงานสุดท้าย', cell: r => date(r.last_date) },
  { header: 'จำนวนคิว', cell: r => r.sessions_count },
  { header: 'คิวงาน', cell: r => text(r.sessions) },
  { header: 'แพ็กเกจ', cell: r => text(r.package_name) },
  { header: 'ราคาแพ็กเกจ', cell: r => r.package_price },
  { header: 'บริการเสริม', cell: r => text(r.addons) },
  { header: 'ค่าบริการเสริม', cell: r => r.addons_total },
  { header: 'ค่าเดินทาง', cell: r => r.travel_fee },
  { header: 'ส่วนลด', cell: r => r.discount },
  { header: 'ยอดหลังส่วนลด', cell: r => r.base_total },
  { header: 'ค่าใช้จ่ายเพิ่ม', cell: r => r.charges_total },
  { header: 'ยอดสุทธิ', cell: r => r.grand_total },
  { header: 'ชำระแล้ว', cell: r => r.paid },
  { header: 'ค้างชำระ (ติดลบ = รับเกิน)', cell: r => r.due },
  { header: 'มัดจำที่ต้องจ่าย', cell: r => r.deposit_required },
  { header: 'ค่าตัวทีมงาน', cell: r => r.crew_cost_total },
  { header: 'กำไรขั้นต้น', cell: r => r.profit },
  { header: 'เหตุผลยกเลิก', cell: r => text(r.cancel_reason) },
  { header: 'หมายเหตุร้าน', cell: r => text(r.note) },
  { header: 'ผู้สร้าง', cell: r => text(r.created_by_name) },
]

const PAYMENT_COLS: readonly Col<WedExportPaymentRow>[] = [
  { header: 'เลขที่ใบเสร็จ', cell: r => code(r.receipt_no) },
  { header: 'วันที่รับ/คืนเงิน', cell: r => date(r.paid_on) },
  { header: 'วันเวลาที่บันทึก', cell: r => datetime(r.created_at) },
  { header: 'เลขที่งาน', cell: r => code(r.booking_no) },
  { header: 'คู่บ่าวสาว', cell: r => text(r.couple_names) },
  { header: 'ลูกค้า (ผู้ติดต่อ)', cell: r => text(r.customer_name) },
  { header: 'ประเภท', cell: r => text(r.kind_label) },
  { header: 'วิธีชำระ', cell: r => text(r.method_label) },
  { header: 'รายการ', cell: r => text(r.purpose_label) },
  { header: 'จำนวนเงิน', cell: r => r.amount },
  { header: 'ผลต่อรายรับ (+รับ / -คืน / 0 ยกเลิก)', cell: r => r.income_effect },
  { header: 'สถานะ', cell: r => text(r.status_label) },
  { header: 'มีสลิป', cell: r => (r.has_slip ? 'ใช่' : 'ไม่') },
  { header: 'หมายเหตุ', cell: r => text(r.note) },
  { header: 'ผู้บันทึก', cell: r => text(r.created_by_name) },
  { header: 'ยกเลิกรายการเมื่อ', cell: r => datetime(r.voided_at) },
  { header: 'เหตุผลยกเลิกรายการ', cell: r => text(r.void_reason) },
]

const CREW_FEE_COLS: readonly Col<WedExportCrewFeeRow>[] = [
  { header: 'วันคิวงาน', cell: r => date(r.date) },
  { header: 'เลขที่งาน', cell: r => code(r.booking_no) },
  { header: 'คู่บ่าวสาว', cell: r => text(r.couple_names) },
  { header: 'สถานะงาน', cell: r => text(r.booking_status_label) },
  { header: 'ประเภทคิว', cell: r => text(r.type_label) },
  { header: 'ชื่อคิว', cell: r => text(r.session_title) },
  { header: 'ทีมงาน', cell: r => text(r.crew_name) },
  { header: 'ชื่อเล่น', cell: r => text(r.crew_nickname) },
  { header: 'หน้าที่', cell: r => text(r.role_label) },
  { header: 'ค่าตัว', cell: r => r.fee },
  { header: 'จ่ายแล้ว', cell: r => (r.paid ? 'ใช่' : 'ยังไม่จ่าย') },
  { header: 'วันที่จ่าย', cell: r => date(r.fee_paid_on) },
]

function buildCsv<T>(cols: readonly Col<T>[], rows: readonly T[]): string {
  const out: CsvRow[] = [cols.map(c => c.header)]
  for (const r of rows) out.push(cols.map(c => c.cell(r)))
  return toCsv(out, { bom: true })
}

/** แถวจาก RPC → ข้อความ CSV (มี BOM) ; แถวที่อ่านไม่ได้ถูกข้าม */
export function wedExportCsv(kind: WedExportKind, raw: readonly unknown[]): { csv: string; count: number } {
  if (kind === 'bookings') {
    const rows = parseExportBookings(raw)
    return { csv: buildCsv(BOOKING_COLS, rows), count: rows.length }
  }
  if (kind === 'payments') {
    const rows = parseExportPayments(raw)
    return { csv: buildCsv(PAYMENT_COLS, rows), count: rows.length }
  }
  const rows = parseExportCrewFees(raw)
  return { csv: buildCsv(CREW_FEE_COLS, rows), count: rows.length }
}

function fileName(kind: WedExportKind, fromKey: string, toKey: string): string {
  const a = fromKey.replace(/-/g, '')
  const b = toKey.replace(/-/g, '')
  return `${FILE_BASE[kind]}-${a}${b && b !== a ? `-${b}` : ''}.csv`
}

export default function WedExportButton({
  kind,
  label,
  fromKey,
  toKey,
  disabled = false,
  onResult,
}: {
  kind: WedExportKind
  label: string
  fromKey: string
  toKey: string
  disabled?: boolean
  /** ผลลัพธ์ให้หน้าแสดง: ok = ดาวน์โหลดแล้ว (count แถว) / error = ข้อความไทย */
  onResult: (r: { ok: true; count: number } | { ok: false; error: string }) => void
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
      // fetchAllRows แบ่งหน้าละ PAGE_SIZE (= WED_EXPORT_PAGE_SIZE 1,000) — ส่งเป็น p_offset/p_limit ให้ RPC เอง
      const rows = await fetchAllRows<unknown>(async (from, to) => {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
        const timer = setTimeout(() => { timedOut = true; ctrl?.abort() }, PAGE_TIMEOUT_MS)
        try {
          const limit = Math.min(WED_EXPORT_PAGE_SIZE, to - from + 1)
          let req = supabase.rpc(RPC[kind], { p_from: fromKey, p_to: toKey, p_offset: from, p_limit: limit })
          if (ctrl) req = req.abortSignal(ctrl.signal)
          const res = await req
          if (res.error) rawError = rawError ?? res.error
          else if (Array.isArray(res.data) && (from > 0 || res.data.length >= PAGE_SIZE)) setLoaded(from + res.data.length)
          return res
        } finally {
          clearTimeout(timer)
        }
      })
      const { csv, count } = wedExportCsv(kind, rows)
      if (count === 0) {
        onResult({ ok: false, error: `ไม่มีข้อมูลในช่วง ${formatThaiDate(fromKey)} – ${formatThaiDate(toKey)}` })
        return
      }
      downloadCsv(fileName(kind, fromKey, toKey), csv)
      onResult({ ok: true, count })
    } catch (err) {
      onResult({ ok: false, error: timedOut ? TIMEOUT_MSG : wedErrorText(rawError ?? err) })
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
      className="btn-secondary w-full sm:w-auto"
      aria-live="polite"
    >
      {busy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Download {...ICON_SM} />}
      {busy ? `กำลังดึงข้อมูล${loaded > 0 ? ` ${loaded.toLocaleString('en-US')} แถว` : ''}...` : label}
    </button>
  )
}
