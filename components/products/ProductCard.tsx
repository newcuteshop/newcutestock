'use client'
import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ImageOff, Loader2, PauseCircle, Shirt } from 'lucide-react'
import { baht } from '@/lib/format'
import { priceRange, productImageUrl, type ProductGroupCard } from '@/lib/products'
import { ICON_SM } from '@/components/theme/icons'

// ===== การ์ดสินค้า 1 ใบ = 1 แบบ (product_group) =====
// ทั้งการ์ด (รูป + รายละเอียด) เป็นลิงก์ไปหน้าแก้ไข /products/<group_id>
// สวิตช์ "เปิดขาย" อยู่นอกลิงก์ (ห้ามมีปุ่มซ้อนในลิงก์) — เปิด/ปิดทั้งแบบผ่าน set_product_group_active

const MAX_SIZE_CHIPS = 12

type Props = {
  group: ProductGroupCard
  categoryName: string | null
  /** มีสิทธิ์ "จัดการสินค้า" → เห็นสวิตช์เปิด/ปิดขาย */
  canManage: boolean
  /** กำลังบันทึกสถานะของการ์ดนี้ */
  busy: boolean
  onToggle: (group: ProductGroupCard) => void
  /** ไซส์ที่ตรงกับรหัสที่ค้นหา (SKU/บาร์โค้ด) → ขีดกรอบให้เห็น */
  highlightIds?: ReadonlySet<string> | null
}

export default function ProductCard({ group, categoryName, canManage, busy, onToggle, highlightIds }: Props) {
  // จำ path ของรูปที่โหลดไม่ได้ (รูปปกเปลี่ยน = ลองโหลดใหม่)
  const [brokenPath, setBrokenPath] = useState<string | null>(null)
  const imageBroken = !!group.cover_path && brokenPath === group.cover_path
  const variants = group.variants
  const hasVariants = variants.length > 0

  // ราคา: ไซส์ราคาต่างกัน → แสดงเป็นช่วง
  const range = hasVariants ? priceRange(variants) : null
  const totalStock = variants.reduce((s, v) => s + v.stock_qty, 0)

  // สต๊อกต่ำ: นับเฉพาะไซส์ที่เปิดขายอยู่ (แบบที่ปิดใช้งาน = ทุกไซส์ปิด ไม่ต้องเตือน) — เกณฑ์เดียวกับหน้าภาพรวม
  const sellable = group.is_active ? variants.filter(v => v.is_active) : []
  const lowCount = sellable.filter(v => v.stock_qty <= v.min_stock).length
  const soldOut = sellable.length > 0 && sellable.every(v => v.stock_qty <= 0)
  const low = lowCount > 0

  const cover = group.cover_path && !imageBroken ? productImageUrl(group.cover_path) : null
  const single = !group.has_sizes ? variants[0] : undefined
  const chips = group.has_sizes ? variants.slice(0, MAX_SIZE_CHIPS) : []
  const hiddenChips = group.has_sizes ? Math.max(0, variants.length - MAX_SIZE_CHIPS) : 0

  return (
    <article
      className={`card card-hover relative flex w-full min-w-0 flex-col overflow-hidden ${
        group.is_active ? '' : 'border-dashed border-gray-300'
      }`}
    >
      <Link
        href={`/products/${group.id}`}
        // การ์ดเยอะ → ไม่ prefetch ทุกใบที่เห็นบนจอ (ประหยัดเซิร์ฟเวอร์/เน็ตมือถือ)
        prefetch={false}
        className="flex min-w-0 flex-1 flex-col rounded-[inherit] focus-visible:outline-offset-[-3px]"
      >
        {/* รูปปก 4:5 (สัดส่วนรูปเสื้อผ้า) — ไม่มีรูป = พื้นเทาอ่อนเรียบ + ไอคอนเทา */}
        <div className="relative aspect-[4/5] w-full overflow-hidden border-b border-gray-150 bg-gray-50">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setBrokenPath(group.cover_path)}
              className={`h-full w-full object-cover ${group.is_active ? '' : 'opacity-60 grayscale'}`}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2">
              <span className="inline-grid h-14 w-14 place-items-center rounded-xl border border-gray-200 bg-white text-gray-400">
                {group.cover_path
                  ? <ImageOff size={26} strokeWidth={1.5} aria-hidden="true" />
                  : <Shirt size={26} strokeWidth={1.5} aria-hidden="true" />}
              </span>
              <span className="text-xs font-medium text-gray-500">{group.cover_path ? 'โหลดรูปไม่ได้' : 'ยังไม่มีรูป'}</span>
            </div>
          )}

          {/* ป้ายบนรูป: ซ้าย = ปิดใช้งาน / ขวา = สต๊อกต่ำ */}
          {!group.is_active && (
            <span className="absolute left-2 top-2 inline-flex h-6 items-center gap-1 rounded-full border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700">
              <PauseCircle size={14} strokeWidth={2} aria-hidden="true" />
              ปิดใช้งาน
            </span>
          )}
          {soldOut ? (
            <span className="absolute right-2 top-2 inline-flex h-6 items-center rounded-full bg-red-600 px-2 text-xs font-semibold text-white">
              หมด
            </span>
          ) : low ? (
            <span className="absolute right-2 top-2 inline-flex h-6 items-center gap-1 rounded-full border border-red-200 bg-white px-2 text-xs font-semibold text-red-700">
              <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
              ใกล้หมด
            </span>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
          <p className="text-sm font-semibold leading-snug text-gray-900 line-clamp-2 break-words sm:text-[15px]">
            {group.name}
          </p>

          {(categoryName || group.color) && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              {categoryName && (
                <span className="chip h-6 max-w-full px-2">
                  <span className="min-w-0 truncate">{categoryName}</span>
                </span>
              )}
              {group.color && (
                <span className="min-w-0 truncate text-xs text-gray-500">สี {group.color}</span>
              )}
            </div>
          )}

          <p className="money text-[15px] leading-tight text-gray-900 sm:text-base">
            {range
              ? range.min === range.max
                ? <span className="whitespace-nowrap">{baht(range.min)}</span>
                : <><span className="whitespace-nowrap">{baht(range.min)}</span> – <span className="whitespace-nowrap">{baht(range.max)}</span></>
              : '-'}
          </p>

          <p className="text-xs text-gray-500 tabular-nums">
            สต๊อก{' '}
            <span className={low ? 'font-semibold text-red-700' : 'font-semibold text-gray-900'}>
              {totalStock.toLocaleString('en-US')}
            </span>{' '}
            ชิ้น
            {low && !soldOut && group.has_sizes && (
              <span className="text-red-700"> · ต่ำ {lowCount} ไซส์</span>
            )}
          </p>

          {/* ไซส์ + สต๊อกแต่ละไซส์ (เรียงตามลำดับไซส์แล้วจาก page.tsx) */}
          {chips.length > 0 && (
            <ul className="mt-auto flex flex-wrap gap-1 pt-1" aria-label="สต๊อกแต่ละไซส์">
              {chips.map(v => {
                const sizeOff = group.is_active && !v.is_active
                const sizeLow = group.is_active && v.is_active && v.stock_qty <= v.min_stock
                const hit = highlightIds?.has(v.id) ?? false
                const tone = sizeOff
                  ? 'border border-dashed border-gray-300 bg-white text-gray-500'
                  : sizeLow
                    ? 'border border-red-200 bg-red-50 text-red-700'
                    : 'border border-gray-200 bg-gray-100 text-gray-700'
                return (
                  <li
                    key={v.id}
                    title={`SKU ${v.sku}${v.barcode ? ` · บาร์โค้ด ${v.barcode}` : ''}${sizeOff ? ' · ปิดขายไซส์นี้' : ''}`}
                    className={`inline-flex h-6 max-w-full items-center gap-1 rounded-full px-2 text-xs leading-none ${tone} ${
                      hit ? 'ring-2 ring-brand-600 ring-offset-1' : ''
                    }`}
                  >
                    <span className={`min-w-0 truncate font-medium ${sizeOff ? 'line-through' : ''}`}>{v.size ?? '-'}</span>
                    <span className="font-semibold tabular-nums">{v.stock_qty.toLocaleString('en-US')}</span>
                    {sizeOff && <span className="sr-only">(ปิดขาย)</span>}
                  </li>
                )
              })}
              {hiddenChips > 0 && (
                <li className="inline-flex h-6 items-center rounded-full border border-gray-200 bg-white px-2 text-xs font-medium text-gray-600 tabular-nums">
                  +{hiddenChips}
                </li>
              )}
            </ul>
          )}

          {/* ไม่มีไซส์: โชว์ SKU (ตัวอักษรความกว้างเท่ากัน อ่านรหัสง่าย) */}
          {single && (
            <p className="mt-auto pt-1">
              <span
                className={`inline-flex h-6 max-w-full items-center rounded-full border border-gray-200 bg-white px-2 font-mono text-xs text-gray-700 ${
                  highlightIds?.has(single.id) ? 'ring-2 ring-brand-600 ring-offset-1' : ''
                }`}
                title={single.barcode ? `บาร์โค้ด ${single.barcode}` : undefined}
              >
                <span className="min-w-0 truncate">{single.sku}</span>
              </span>
            </p>
          )}
        </div>
      </Link>

      {canManage && (
        <div className="px-3 pb-3">
          {/* สวิตช์เปิดขายทั้งแบบ: รางเขียว = เปิดขาย / รางเทา = ปิดใช้งาน (แถวขาวเรียบ ไม่ย่อตอนกด) */}
          <button
            type="button"
            role="switch"
            aria-checked={group.is_active}
            onClick={() => onToggle(group)}
            disabled={busy}
            title={group.is_active ? 'กดเพื่อปิดใช้งานทั้งแบบ (ทุกไซส์)' : 'กดเพื่อเปิดขายทั้งแบบ'}
            className={`relative z-[1] flex w-full min-h-[44px] items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium leading-tight select-none transition-colors duration-150 active:bg-gray-100 [@media(hover:hover)]:hover:bg-gray-50 disabled:cursor-wait disabled:opacity-70 ${
              group.is_active ? 'text-green-800' : 'text-gray-600'
            }`}
          >
            <span className="min-w-0 truncate">
              เปิดขาย
              <span className="sr-only"> {group.name}</span>
            </span>
            {busy ? (
              <Loader2 {...ICON_SM} className="animate-spin" />
            ) : (
              <span aria-hidden="true" className={`switch switch-sm switch-leaf ${group.is_active ? 'switch-on' : ''}`}>
                <span className="switch-knob" />
              </span>
            )}
          </button>
        </div>
      )}
    </article>
  )
}
