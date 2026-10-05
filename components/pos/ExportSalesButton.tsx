'use client'
// ปุ่ม "ส่งออกยอดขาย (Excel)" ในหน้ารายงาน
// เลือกช่วงวันที่ (DateRangeDialog) → ดึง "บิลขาย" + "รายการสินค้าที่ขาย" จาก RPC ส่งออก (supabase-fix-04-pos.sql)
// ทีละ 1,000 แถว (fetchAllRows + p_offset/p_limit ให้ฐานข้อมูลตัดหน้าเอง) → สร้างไฟล์ CSV 2 ไฟล์ (มี BOM ให้ Excel อ่านภาษาไทยถูก)
//
// ทำไมส่ง p_offset/p_limit แทน .range(): .range() ตัดหน้าหลังฟังก์ชันคืนผลทั้งช่วงวันที่แล้ว → ทุกหน้าต้องคำนวณทั้งปีใหม่
//   (ส่งออกช่วงยาวช้าแบบยกกำลังสอง หน้าท้ายๆ อาจเกินเวลา) ; p_offset/p_limit ให้ฟังก์ชันคำนวณเฉพาะแถวของหน้านั้น
//   ห้ามใช้ .range() คู่กันเด็ดขาด — แถวจะถูกเลื่อนซ้ำสองชั้น (ข้ามข้อมูลไปเงียบๆ)
// ทำไมหน้าละ 1,000 (ไม่ใหญ่กว่านี้): PostgREST ของ Supabase ตัดผลทุกคำขอไว้ที่ 1,000 แถว (Max rows) รวมผลของ RPC ด้วย
//   ถ้าขอ 5,000 จะได้กลับมาแค่ 1,000 แล้วดูเหมือน "หน้าสุดท้าย" → ไฟล์ขาดข้อมูลโดยไม่มีใครรู้
//
// ทำไมไฟล์ที่ 2 ต้องกดเอง: เบราว์เซอร์ (Chrome) ยอมให้ดาวน์โหลดอัตโนมัติได้ 1 ไฟล์ต่อการกดหนึ่งครั้ง
//   ไฟล์ที่ 2 ที่ตามมาเองจะเด้งถาม "อนุญาตให้ดาวน์โหลดหลายไฟล์" — ถ้าเผลอกด "บล็อก" จะดาวน์โหลดไม่ได้อีกเลยจนกว่าจะไปแก้ตั้งค่า
//   → ไฟล์แรก (บิลขาย) ดาวน์โหลดทันที แล้วแสดงหน้าต่างผลลัพธ์ให้กดไฟล์ที่ 2 (และกดซ้ำได้ทั้งคู่)
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Download, FileSpreadsheet, X } from 'lucide-react'
import DateRangeDialog from '@/components/pos/DateRangeDialog'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { csvFilename, downloadCsv, toCsv, type CsvRow } from '@/lib/csvCore'
import { formatThaiDate, formatThaiDateTime } from '@/lib/format'
import { exportErrorText } from '@/lib/exportError'
import {
  parseExportSaleItemRow, parseExportSaleRow, type ExportSaleItemRow, type ExportSaleRow,
} from '@/lib/pos'
import { PAYMENT_METHOD_LABELS, saleChannelLabel } from '@/lib/integrations/labels'

// ฐานข้อมูลรับช่วงได้ไม่เกิน 1 ปี (366 วันรวมปีอธิกสุรทิน)
const MAX_DAYS = 366

// หัวตาราง (ลำดับคอลัมน์ตามที่ตกลงไว้ — อย่าสลับ เพราะร้านอาจทำสูตร Excel อ้างคอลัมน์ไว้แล้ว)
const SALES_HEADER: CsvRow = [
  'เลขที่บิล', 'วันเวลา', 'ช่องทาง', 'วิธีชำระ', 'ยอดรวม', 'ส่วนลด', 'ยอดสุทธิ', 'คืนเงิน',
  'รับเงิน', 'เงินทอน', 'สถานะ', 'พนักงาน', 'หมายเหตุ', 'เหตุผลยกเลิก',
]
const ITEMS_HEADER: CsvRow = [
  'เลขที่บิล', 'วันเวลา', 'SKU', 'สินค้า', 'ไซส์', 'สี', 'จำนวน', 'ราคา/ชิ้น', 'รวม', 'ต้นทุน/ชิ้น', 'คืนแล้ว', 'สถานะบิล',
]

// วิธีชำระที่ไม่รู้จัก (ข้อมูลเก่า/เสีย) → เขียนค่าเดิมลงไฟล์ ไม่ทิ้งเป็นช่องว่าง
function paymentLabel(method: string): string {
  return (PAYMENT_METHOD_LABELS as Record<string, string>)[method] ?? method
}

// เงินเป็น number เสมอ (toCsv เขียนเป็นตัวเลขล้วน → Excel รวมยอดด้วย SUM ได้) ; ค่าว่างจริง (null) = ช่องว่าง
function salesCsv(rows: readonly ExportSaleRow[]): string {
  const out: CsvRow[] = [SALES_HEADER]
  for (const r of rows) {
    out.push([
      r.sale_no,
      formatThaiDateTime(r.created_at),
      saleChannelLabel(r.channel),
      paymentLabel(r.payment_method),
      r.total_amount,
      r.discount,
      r.net_amount,
      r.refunded_amount,
      r.cash_received,
      r.change_amount,
      r.status,
      r.cashier_name,
      r.note,
      r.void_reason,
    ])
  }
  return toCsv(out, { bom: true })
}

function itemsCsv(rows: readonly ExportSaleItemRow[]): string {
  const out: CsvRow[] = [ITEMS_HEADER]
  for (const r of rows) {
    out.push([
      r.sale_no,
      formatThaiDateTime(r.created_at),
      r.sku,
      r.product_name,
      r.size,
      r.color,
      r.qty,
      r.unit_price,
      r.subtotal,
      r.unit_cost,
      r.returned_qty,
      r.bill_status,
    ])
  }
  return toCsv(out, { bom: true })
}

type FileKey = 'sales' | 'items'
type ExportFile = {
  key: FileKey
  label: string
  unit: string
  count: number
  filename: string
  csv: string
  downloaded: boolean
}
type ExportResult = { fromKey: string; toKey: string; files: ExportFile[] }

export default function ExportSalesButton({ className = '' }: { className?: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState({ sales: 0, items: 0 })
  const [result, setResult] = useState<ExportResult | null>(null)
  // กันกดยืนยันซ้ำระหว่างรอ (state อัปเดตไม่ทันในคลิกติดกัน)
  const busyRef = useRef(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const pendingRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descId = useId()

  function openDialog() {
    setError(null)
    setResult(null)
    setDialogOpen(true)
  }

  // ป็อปอัปเลือกวันที่คืนโฟกัสให้ปุ่มเปิดเอง
  const closeDialog = useCallback(() => {
    if (busyRef.current) return
    setDialogOpen(false)
    setError(null)
  }, [])

  // ปิดหน้าต่างผลลัพธ์แล้วคืนโฟกัสให้ปุ่มเดิม (ผู้ใช้คีย์บอร์ด/โปรแกรมอ่านจอไม่หลงตำแหน่ง)
  const closeResult = useCallback(() => {
    setResult(null)
    window.setTimeout(() => triggerRef.current?.focus(), 0)
  }, [])

  function download(key: FileKey) {
    if (!result) return
    const file = result.files.find(f => f.key === key)
    if (!file) return
    downloadCsv(file.filename, file.csv)
    setResult(r => (r ? { ...r, files: r.files.map(f => (f.key === key ? { ...f, downloaded: true } : f)) } : r))
  }

  async function handleConfirm(fromKey: string, toKey: string) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    setProgress({ sales: 0, items: 0 })
    // error ตัวจริงจาก RPC (มีรหัส + ข้อความไทยของฟังก์ชัน) — fetchAllRows โยนแค่ข้อความที่แปลแล้ว
    let rawError: unknown = null
    try {
      // RPC เรียงลำดับคงที่ไว้แล้ว (เวลา, เลขบิล, ...) → ตัดหน้าด้วย offset ได้โดยแถวไม่หาย/ไม่ซ้ำ
      // fetchAllRows ขอทีละ PAGE_SIZE (1,000) และหยุดเมื่อได้หน้าที่ไม่เต็ม
      const pageParams = (from: number, to: number) => ({ p_from: fromKey, p_to: toKey, p_offset: from, p_limit: to - from + 1 })
      const [rawSales, rawItems] = await Promise.all([
        fetchAllRows<unknown>(async (from, to) => {
          const res = await supabase.rpc('export_sales_rows', pageParams(from, to))
          if (res.error) rawError = rawError ?? res.error
          else if (Array.isArray(res.data)) {
            const loaded = from + res.data.length
            setProgress(p => ({ ...p, sales: loaded }))
          }
          return res
        }),
        fetchAllRows<unknown>(async (from, to) => {
          const res = await supabase.rpc('export_sale_item_rows', pageParams(from, to))
          if (res.error) rawError = rawError ?? res.error
          else if (Array.isArray(res.data)) {
            const loaded = from + res.data.length
            setProgress(p => ({ ...p, items: loaded }))
          }
          return res
        }),
      ])
      const sales = rawSales.map(parseExportSaleRow)
      const items = rawItems.map(parseExportSaleItemRow)
      if (sales.length === 0) {
        // ไม่สร้างไฟล์เปล่า — ให้เลือกช่วงวันที่ใหม่ในหน้าต่างเดิม
        setError(`ไม่มีบิลขายในช่วง ${formatThaiDate(fromKey)} – ${formatThaiDate(toKey)}`)
        return
      }
      const files: ExportFile[] = [
        {
          key: 'sales',
          label: 'บิลขาย',
          unit: 'บิล',
          count: sales.length,
          filename: csvFilename('sales', fromKey, toKey),
          csv: salesCsv(sales),
          downloaded: false,
        },
        {
          key: 'items',
          label: 'รายการสินค้าที่ขาย',
          unit: 'รายการ',
          count: items.length,
          filename: csvFilename('sale-items', fromKey, toKey),
          csv: itemsCsv(items),
          downloaded: false,
        },
      ]
      // ไฟล์แรกดาวน์โหลดทันที (ต่อจากการกดยืนยัน) — ไฟล์ที่ 2 ให้กดในหน้าต่างผลลัพธ์ (เหตุผลอยู่หัวไฟล์)
      downloadCsv(files[0].filename, files[0].csv)
      files[0].downloaded = true
      setDialogOpen(false)
      setResult({ fromKey, toKey, files })
    } catch (e) {
      // ใช้ error ตัวจริงจาก RPC ถ้ามี (กติกาเดียวกับปุ่มส่งออกประวัติสต๊อก): ยังไม่ได้รัน fix-04 / สิทธิ์ไม่พอพร้อมเหตุผลภาษาไทย
      setError(exportErrorText(rawError ?? e))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  // หน้าต่างผลลัพธ์: Esc ปิด + โฟกัสปุ่มไฟล์ที่ยังไม่ได้ดาวน์โหลด (ไม่มี = ปุ่มปิด)
  const resultOpen = result !== null
  useEffect(() => {
    if (!resultOpen) return
    const t = window.setTimeout(() => (pendingRef.current ?? closeRef.current)?.focus(), 0)
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeResult()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [resultOpen, closeResult])

  const firstPending = result?.files.find(f => !f.downloaded)?.key ?? null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openDialog}
        className={`btn-secondary w-full sm:w-auto ${className}`}
      >
        <Download {...ICON} />
        ส่งออกยอดขาย (Excel)
      </button>

      <DateRangeDialog
        open={dialogOpen}
        title="ส่งออกยอดขาย (Excel)"
        description="ได้ 2 ไฟล์: บิลขาย (1 แถวต่อบิล) และรายการสินค้าที่ขาย (1 แถวต่อสินค้าในบิล)"
        confirmLabel="ส่งออกไฟล์"
        onClose={closeDialog}
        onConfirm={handleConfirm}
        busy={busy}
        error={error}
        maxDays={MAX_DAYS}
        // ช่วงยาวหลายเดือนต้องดึงหลายรอบ (รอบละ 1,000 แถว) — บอกความคืบหน้าให้รู้ว่าไม่ได้ค้าง
        progress={`กำลังดึงข้อมูล… บิล ${progress.sales.toLocaleString('en-US')} · รายการสินค้า ${progress.items.toLocaleString('en-US')}`}
      />

      {result && (
        <div
          className="fixed inset-0 z-50 !mt-0 flex items-end sm:items-center justify-center scrim p-3 sm:p-4"
          onClick={e => { if (e.target === e.currentTarget) closeResult() }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            className="sheet w-full max-w-md max-h-[90dvh] overflow-y-auto overscroll-contain p-5 space-y-4 pb-[calc(1.25rem_+_env(safe-area-inset-bottom))] sm:pb-5 animate-pop-in"
          >
            <div className="flex items-start gap-3">
              <span className="icon-bubble icon-bubble-ok shrink-0" aria-hidden="true">
                <CheckCircle2 {...ICON_SM} />
              </span>
              <div className="min-w-0 flex-1 pt-1">
                <h3 id={titleId} className="text-lg font-semibold leading-snug text-gray-900">ไฟล์ยอดขายพร้อมแล้ว</h3>
                <p id={descId} className="mt-0.5 text-sm text-gray-500">
                  ช่วงวันที่ {formatThaiDate(result.fromKey)}
                  {result.toKey !== result.fromKey && <> – {formatThaiDate(result.toKey)}</>}
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={closeResult}
                aria-label="ปิด"
                className="btn-icon btn-icon-plain -mr-2 -mt-1 shrink-0"
              >
                <X {...ICON_SM} />
              </button>
            </div>

            <ul className="space-y-2" aria-live="polite">
              {result.files.map((f, i) => (
                <li key={f.key} className="panel flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="icon-bubble icon-bubble-sm shrink-0" aria-hidden="true">
                      <FileSpreadsheet {...ICON_XS} />
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900">ไฟล์ที่ {i + 1}: {f.label}</p>
                      <p className="text-xs text-gray-500 tabular-nums">
                        {f.count.toLocaleString('en-US')} {f.unit}
                        {f.downloaded && <span className="text-green-700"> · ดาวน์โหลดแล้ว</span>}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500 break-all">{f.filename}</p>
                    </div>
                  </div>
                  <button
                    ref={f.key === firstPending ? pendingRef : undefined}
                    type="button"
                    onClick={() => download(f.key)}
                    className={`${f.downloaded ? 'btn-secondary' : 'btn-primary'} w-full shrink-0 sm:w-auto`}
                    aria-label={`${f.downloaded ? 'ดาวน์โหลดอีกครั้ง' : 'ดาวน์โหลด'} ไฟล์${f.label}`}
                  >
                    <Download {...ICON_SM} />
                    {f.downloaded ? 'ดาวน์โหลดอีกครั้ง' : 'ดาวน์โหลด'}
                  </button>
                </li>
              ))}
            </ul>

            <p className="field-hint">
              ไฟล์ CSV ภาษาไทย (UTF-8) เปิดด้วย Excel ได้ทันที — ยอดเงินเป็นตัวเลขล้วน รวมยอดด้วยสูตร SUM ได้
              · ยอดสุทธิของบิลยังไม่หักเงินคืน ดูยอดคืนที่คอลัมน์ &quot;คืนเงิน&quot;
            </p>

            <div className="flex justify-end">
              <button type="button" onClick={closeResult} className="btn-secondary w-full sm:w-auto">
                เสร็จสิ้น
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
