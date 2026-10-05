'use client'
// ปุ่ม "ส่งออก Excel" หน้ารับ-จ่ายสต๊อก: เลือกช่วงวันที่ → ดึงประวัติการเคลื่อนไหวสต๊อกทั้งหมดในช่วงนั้น → ดาวน์โหลด CSV
// ข้อมูลมาจาก RPC export_stock_movement_rows (supabase-fix-04-pos.sql) — เรียงตามเวลาแบบคงที่ จึงดึงทีละหน้าได้ไม่หาย/ไม่ซ้ำ
// ตัดหน้าด้วย p_offset/p_limit ในฟังก์ชัน (ฐานข้อมูลคำนวณชื่อผู้ทำรายการเฉพาะแถวของหน้านั้น) — ห้ามใช้ .range() คู่กัน (เลื่อนซ้ำสองชั้น)
// หน้าละ 1,000 แถว = เพดาน Max rows ของ PostgREST (ขอมากกว่านี้จะถูกตัดเหลือ 1,000 แล้วดูเหมือนหน้าสุดท้าย ข้อมูลขาด)
// ยังไม่ได้รัน fix-04 → แจ้งในป็อปอัปว่าต้องรันไฟล์อะไร (หน้ารับ-จ่ายสต๊อกเดิมยังใช้ได้ตามปกติ)
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { fetchAllRows, PAGE_SIZE } from '@/lib/fetchAllRows'
import { formatThaiDateTime } from '@/lib/format'
import { csvFilename, downloadCsv, type CsvRow } from '@/lib/csvCore'
import { exportErrorText } from '@/lib/exportError'
import { movementTypeLabel, parseExportMovementRow } from '@/lib/pos'
import DateRangeDialog from '@/components/pos/DateRangeDialog'

const HEADER: CsvRow = ['วันเวลา', 'ประเภท', 'SKU', 'สินค้า', 'ไซส์', 'สี', 'เปลี่ยน', 'ก่อน', 'หลัง', 'หมายเหตุ', 'ผู้ทำรายการ']

// รอคำตอบต่อ 1 หน้า (1,000 แถว) ไม่เกินนี้ — เน็ตค้างแล้วปุ่มหมุนค้างตลอดไปจะปิดป็อปอัปไม่ได้
const PAGE_TIMEOUT_MS = 60000
const TIMEOUT_MSG = 'ดึงข้อมูลนานเกินไป — ตรวจอินเทอร์เน็ต หรือเลือกช่วงวันที่ให้สั้นลง แล้วลองใหม่'

function fmtInt(n: number): string {
  return n.toLocaleString('en-US')
}

export default function ExportMovementsButton({ className = '' }: { className?: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const busyRef = useRef(false)

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  function openDialog() {
    setError(null)
    setProgress(null)
    setOpen(true)
  }

  function closeDialog() {
    if (busyRef.current) return
    setOpen(false)
    setError(null)
    setProgress(null)
  }

  function showToast(text: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(text)
    toastTimer.current = setTimeout(() => setToast(null), 3500)
  }

  async function handleExport(fromKey: string, toKey: string) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    setProgress('กำลังดึงข้อมูล...')
    let rawError: unknown = null
    let timedOut = false
    try {
      const raw = await fetchAllRows<unknown>(async (from, to) => {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
        const timer = setTimeout(() => { timedOut = true; ctrl?.abort() }, PAGE_TIMEOUT_MS)
        try {
          let req = supabase.rpc('export_stock_movement_rows', {
            p_from: fromKey,
            p_to: toKey,
            p_offset: from,
            p_limit: to - from + 1,
          })
          if (ctrl) req = req.abortSignal(ctrl.signal)
          const res = await req
          if (res.error) rawError = res.error
          else {
            const got = Array.isArray(res.data) ? res.data.length : 0
            // แสดงเฉพาะเมื่อมีหลายหน้า (ไฟล์เล็กเสร็จในพริบตา ไม่ต้องกะพริบตัวเลข)
            if (from > 0 || got >= PAGE_SIZE) setProgress(`ดึงข้อมูลแล้ว ${fmtInt(from + got)} รายการ...`)
          }
          return res
        } finally {
          clearTimeout(timer)
        }
      })

      if (raw.length === 0) {
        setError('ไม่มีรายการเคลื่อนไหวสต๊อกในช่วงวันที่นี้ — ลองเลือกช่วงอื่น')
        return
      }

      setProgress(`กำลังสร้างไฟล์ ${fmtInt(raw.length)} รายการ...`)
      const rows: CsvRow[] = [HEADER]
      for (let i = 0; i < raw.length; i++) {
        const m = parseExportMovementRow(raw[i])
        rows.push([
          formatThaiDateTime(m.created_at),
          movementTypeLabel(m.type),
          m.sku,
          m.product_name,
          m.size ?? '',
          m.color ?? '',
          // ตัวเลขส่งเป็น number → เขียนลงไฟล์ตรงๆ Excel คำนวณต่อได้
          m.qty_change,
          m.qty_before,
          m.qty_after,
          m.note ?? '',
          m.created_by_name ?? '',
        ])
      }
      downloadCsv(csvFilename('stock-movements', fromKey, toKey), rows)
      setOpen(false)
      setProgress(null)
      showToast(`ดาวน์โหลดประวัติสต๊อกแล้ว ${fmtInt(raw.length)} รายการ`)
    } catch (err) {
      setError(timedOut ? TIMEOUT_MSG : exportErrorText(rawError ?? err))
    } finally {
      busyRef.current = false
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <>
      <button type="button" onClick={openDialog} className={`btn-secondary w-full sm:w-auto ${className}`}>
        <Download {...ICON_SM} />
        ส่งออก Excel
      </button>

      <DateRangeDialog
        open={open}
        title="ส่งออกประวัติสต๊อก"
        description="ไฟล์ CSV เปิดด้วย Excel ได้ — วันเวลา ประเภท สินค้า จำนวนที่เปลี่ยน ยอดก่อน/หลัง หมายเหตุ และผู้ทำรายการ"
        onClose={closeDialog}
        onConfirm={handleExport}
        busy={busy}
        error={error}
        progress={progress}
        maxDays={366}
      />

      {/* ดาวน์โหลดสำเร็จ: โทสต์ลอยล่างจอ หายเอง (แบบเดียวกับหน้าสินค้า) */}
      {toast && (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-4 z-40 !mt-0 flex justify-center bottom-[calc(1rem_+_env(safe-area-inset-bottom))] md:left-[calc(15rem_+_1rem)] lg:bottom-6"
        >
          <div className="toast-ok pointer-events-auto">
            <span className="toast-icon"><Check size={18} strokeWidth={2.4} aria-hidden="true" /></span>
            <span className="min-w-0 break-words">{toast}</span>
          </div>
        </div>
      )}
    </>
  )
}
