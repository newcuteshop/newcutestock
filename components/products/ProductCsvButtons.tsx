'use client'
// ปุ่มหัวหน้าสินค้า: "ส่งออก Excel" (สร้าง CSV ในเครื่องจากข้อมูลที่หน้าโหลดมาแล้ว ไม่ยิงฐานข้อมูลเพิ่ม)
// และ "นำเข้า Excel" (ไปหน้า /products/import — เฉพาะผู้จัดการสินค้าได้)
// หัวตารางไฟล์ส่งออก = หัวตารางที่หน้านำเข้ารู้จัก → แก้ราคา/บาร์โค้ด/ขั้นต่ำใน Excel แล้วนำเข้ากลับได้ทันที
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, Download, Upload, X } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { compareSizes, type ProductGroupCard } from '@/lib/products'
import { csvFilename, downloadCsv, excelTextCell, type CsvRow } from '@/lib/csvCore'
import { round2, num } from '@/lib/money'
import type { CategoryOption } from '@/components/products/CategoryBar'

/** หัวตารางไฟล์ส่งออกสินค้า (หน้านำเข้าใช้ชุดเดียวกันเป็นไฟล์ตัวอย่าง) */
export const PRODUCT_CSV_HEADER = [
  'ชื่อสินค้า', 'หมวดหมู่', 'สี', 'ไซส์', 'SKU', 'บาร์โค้ด', 'ราคาทุน', 'ราคาขาย', 'สต๊อก', 'ขั้นต่ำ', 'สถานะ',
] as const

// เรียงชื่อภาษาไทย/อังกฤษแบบที่คนอ่าน (ตัวเลขในชื่อเรียงตามค่า: เสื้อ 2 ก่อน เสื้อ 10)
const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' })

type ExportLine = {
  name: string
  category: string
  color: string
  size: string | null
  sku: string
  barcode: string
  cost: number
  sell: number
  stock: number
  min: number
  active: boolean
}

/** แบบสินค้าบนหน้า → แถว CSV (1 แถว = 1 SKU ที่ยังไม่เลิกใช้) เรียง ชื่อ → สี → ไซส์ → SKU */
function buildProductRows(groups: readonly ProductGroupCard[], categories: readonly CategoryOption[]): CsvRow[] {
  const catName = new Map<string, string>()
  for (const c of categories) catName.set(c.id, c.name)

  const lines: ExportLine[] = []
  for (const g of groups) {
    const category = g.category_id ? catName.get(g.category_id) ?? '' : ''
    for (const v of g.variants) {
      lines.push({
        name: g.name,
        category,
        color: g.color ?? '',
        size: v.size,
        sku: v.sku,
        barcode: v.barcode ?? '',
        cost: round2(num(v.cost_price)),
        sell: round2(num(v.sell_price)),
        stock: Math.trunc(num(v.stock_qty)),
        min: Math.trunc(num(v.min_stock)),
        // ปิดขายทั้งแบบ = ทุกไซส์ปิดขาย (ฐานข้อมูลเก็บแบบนี้อยู่แล้ว เผื่อข้อมูลเก่าไม่ตรง)
        active: g.is_active && v.is_active,
      })
    }
  }

  // สีแทรกระหว่างชื่อกับไซส์ ให้ไซส์ของแบบเดียวกัน (ชื่อ+สี) อยู่ติดกัน — ตรงกับวิธีที่หน้านำเข้าจับกลุ่มแบบ
  lines.sort((a, b) =>
    collator.compare(a.name, b.name)
    || collator.compare(a.color, b.color)
    || compareSizes(a.size, b.size)
    || collator.compare(a.sku, b.sku))

  const rows: CsvRow[] = [PRODUCT_CSV_HEADER]
  for (const l of lines) {
    rows.push([
      // SKU/บาร์โค้ดเขียนเป็น ="รหัส" — ไม่งั้น Excel แปลงบาร์โค้ด 13 หลักเป็น 8.85E+12 / ตัด 0 หน้า / แปลงเป็นวันที่
      // แล้วบันทึกกลับแบบนั้น นำเข้ากลับมาจะเปลี่ยนบาร์โค้ดทุกตัวจนสแกนขายไม่ได้ (หน้านำเข้าแกะ ="..." ให้เอง)
      l.name, l.category, l.color, l.size ?? '', excelTextCell(l.sku), excelTextCell(l.barcode),
      l.cost, l.sell, l.stock, l.min,
      l.active ? 'เปิดขาย' : 'ปิดขาย',
    ])
  }
  return rows
}

export default function ProductCsvButtons({
  groups,
  categories,
  canManage,
}: {
  groups: ProductGroupCard[]
  categories: CategoryOption[]
  canManage: boolean
}) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const skuCount = groups.reduce((n, g) => n + g.variants.length, 0)

  function flash(next: { ok: boolean; text: string }) {
    if (timer.current) clearTimeout(timer.current)
    setMsg(next)
    if (next.ok) timer.current = setTimeout(() => setMsg(null), 3500)
  }

  function handleExport() {
    try {
      const rows = buildProductRows(groups, categories)
      if (rows.length <= 1) {
        flash({ ok: false, text: 'ยังไม่มีสินค้าให้ส่งออก' })
        return
      }
      downloadCsv(csvFilename('products'), rows)
      flash({ ok: true, text: `ดาวน์โหลดรายการสินค้าแล้ว ${(rows.length - 1).toLocaleString('en-US')} SKU` })
    } catch {
      flash({ ok: false, text: 'สร้างไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง' })
    }
  }

  return (
    <>
      {/* มือถือ: 2 ปุ่มแบ่งครึ่งแถว (ปุ่มเพิ่มสินค้าเต็มแถวอยู่ถัดไป) · จอใหญ่: เรียงต่อกันชิดขวา */}
      <div className={`${canManage ? 'grid grid-cols-2' : 'grid grid-cols-1'} w-full gap-2 sm:flex sm:w-auto`}>
        <button
          type="button"
          onClick={handleExport}
          disabled={skuCount === 0}
          title={skuCount === 0 ? 'ยังไม่มีสินค้าให้ส่งออก' : 'ดาวน์โหลดรายการสินค้าทุก SKU เป็นไฟล์ CSV (เปิดด้วย Excel ได้)'}
          className="btn-secondary w-full sm:w-auto px-3 sm:px-4"
        >
          <Download {...ICON_SM} />
          ส่งออก Excel
        </button>
        {canManage && (
          <Link href="/products/import" className="btn-secondary w-full sm:w-auto px-3 sm:px-4">
            <Upload {...ICON_SM} />
            นำเข้า Excel
          </Link>
        )}
      </div>

      {msg && (
        <div
          role={msg.ok ? 'status' : 'alert'}
          className="pointer-events-none fixed inset-x-4 z-40 !mt-0 flex justify-center bottom-[calc(1rem_+_env(safe-area-inset-bottom))] md:left-[calc(15rem_+_1rem)] lg:bottom-6"
        >
          <div className={`${msg.ok ? 'toast-ok' : 'toast-err'} pointer-events-auto`}>
            <span className="toast-icon">
              {msg.ok
                ? <Check size={18} strokeWidth={2.4} aria-hidden="true" />
                : <X size={18} strokeWidth={2.4} aria-hidden="true" />}
            </span>
            <span className="min-w-0 break-words">{msg.text}</span>
            {!msg.ok && (
              <button type="button" onClick={() => setMsg(null)} className="btn-icon btn-icon-plain -my-1 -mr-3 text-current" aria-label="ปิดข้อความ">
                <X {...ICON_SM} />
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
