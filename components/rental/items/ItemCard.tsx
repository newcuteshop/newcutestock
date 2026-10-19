'use client'
// ===== การ์ดชุดเช่า 1 ใบ = 1 แบบชุด (ทั้งการ์ดเป็นลิงก์ไปหน้าชุด /rental/items/<id>) =====
// รูปปก 4:5 · รหัส + ชื่อ · ค่าเช่า/จำนวนวัน · ค่าประกัน · ชิ้นพร้อมให้เช่า/ทั้งหมด + ไซส์
// ป้ายสถานะ (ข้อความ + สี ไม่พึ่งสีอย่างเดียว): ปิดให้เช่า · ไม่แสดงออนไลน์ · เครื่องประดับ · รอซัก · ส่งซ่อม

import Link from 'next/link'
import clsx from 'clsx'
import { Droplets, EyeOff, Gem, PauseCircle, Wrench } from 'lucide-react'
import { baht } from '@/lib/format'
import { sizeLabel } from '@/lib/rental'
import RentalImage from '@/components/rental/RentalImage'
import { sizeSummary } from './itemFormModel'
import type { ItemListRow } from './itemList'

const MAX_SIZE_CHIPS = 8

export default function ItemCard({
  item, categoryName, highlightUnit,
}: {
  item: ItemListRow
  categoryName: string | null
  /** รหัสชิ้นที่ตรงกับคำค้น (สแกนป้าย) → แสดงบนการ์ด */
  highlightUnit?: string | null
}) {
  const active = item.units.filter(u => u.status !== 'retired')
  const ready = active.filter(u => u.status === 'available' && !u.needs_cleaning).length
  const cleaning = active.filter(u => u.needs_cleaning).length
  const maintenance = active.filter(u => u.status === 'maintenance').length
  const sizes = sizeSummary(item.units)
  const chips = sizes.slice(0, MAX_SIZE_CHIPS)
  const hidden = Math.max(0, sizes.length - MAX_SIZE_CHIPS)

  return (
    <article
      className={clsx(
        'card card-hover relative flex w-full min-w-0 flex-col overflow-hidden',
        !item.is_active && 'border-dashed border-gray-300',
      )}
    >
      <Link
        href={`/rental/items/${item.id}`}
        prefetch={false}
        className="flex min-w-0 flex-1 flex-col rounded-[inherit] focus-visible:outline-offset-[-3px]"
      >
        <div className="relative">
          <RentalImage
            path={item.cover_path}
            alt=""
            showFallbackText
            className="aspect-[4/5] w-full border-b border-gray-150"
            imgClassName={item.is_active ? undefined : 'opacity-60 grayscale'}
          />
          <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap items-start justify-between gap-1">
            <div className="flex flex-col items-start gap-1">
              {!item.is_active && (
                <span className="inline-flex h-6 items-center gap-1 rounded-full border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700">
                  <PauseCircle size={14} strokeWidth={2} aria-hidden="true" />
                  ปิดให้เช่า
                </span>
              )}
              {item.is_accessory && (
                <span className="inline-flex h-6 items-center gap-1 rounded-full border border-gray-200 bg-white px-2 text-xs font-medium text-gray-700">
                  <Gem size={13} strokeWidth={2} aria-hidden="true" />
                  เครื่องประดับ
                </span>
              )}
            </div>
            {!item.is_public && (
              <span className="inline-flex h-6 items-center gap-1 rounded-full border border-gray-200 bg-white px-2 text-xs font-medium text-gray-700">
                <EyeOff size={13} strokeWidth={2} aria-hidden="true" />
                ไม่แสดงออนไลน์
              </span>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
          <p className="font-mono text-xs text-gray-500 truncate">{item.code}</p>
          <p className="text-sm font-semibold leading-snug text-gray-900 line-clamp-2 break-words sm:text-[15px]">{item.name}</p>
          {(categoryName || item.color) && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              {categoryName && (
                <span className="chip h-6 max-w-full px-2">
                  <span className="min-w-0 truncate">{categoryName}</span>
                </span>
              )}
              {item.color && <span className="min-w-0 truncate text-xs text-gray-500">สี {item.color}</span>}
            </div>
          )}

          <p className="leading-tight">
            <span className="money whitespace-nowrap text-[15px] text-gray-900 sm:text-base">{baht(item.base_price)}</span>
            <span className="text-xs text-gray-500"> / {item.base_days} วัน</span>
          </p>
          <p className="text-xs text-gray-500 tabular-nums">
            {item.extra_day_price > 0 && <>วันต่อไป +{baht(item.extra_day_price)}/วัน · </>}
            ประกัน {baht(item.security_deposit)}
          </p>

          <p className="text-xs text-gray-600 tabular-nums">
            พร้อมให้เช่า{' '}
            <span className={clsx('font-semibold', ready === 0 ? 'text-red-700' : 'text-gray-900')}>{ready}</span>
            /{active.length} ชิ้น
          </p>

          {(cleaning > 0 || maintenance > 0 || highlightUnit) && (
            <div className="flex flex-wrap gap-1">
              {highlightUnit && <span className="chip-strong font-mono">{highlightUnit}</span>}
              {cleaning > 0 && (
                <span className="badge-return">
                  <Droplets size={12} strokeWidth={2} aria-hidden="true" />
                  รอซัก {cleaning}
                </span>
              )}
              {maintenance > 0 && (
                <span className="badge-adjust">
                  <Wrench size={12} strokeWidth={2} aria-hidden="true" />
                  ส่งซ่อม {maintenance}
                </span>
              )}
            </div>
          )}

          {chips.length > 0 && (
            <ul className="mt-auto flex flex-wrap gap-1 pt-1" aria-label="ชิ้นพร้อมให้เช่าตามไซส์">
              {chips.map(s => (
                <li
                  key={s.size || '-free'}
                  className={clsx(
                    'inline-flex h-6 max-w-full items-center gap-1 rounded-full px-2 text-xs leading-none',
                    s.ready === 0 ? 'border border-dashed border-gray-300 bg-white text-gray-500' : 'border border-gray-200 bg-gray-100 text-gray-700',
                  )}
                  title={`ไซส์ ${sizeLabel(s.size)} พร้อม ${s.ready} จาก ${s.total} ชิ้น`}
                >
                  <span className="min-w-0 truncate font-medium">{sizeLabel(s.size)}</span>
                  <span className="font-semibold tabular-nums">{s.ready}</span>
                </li>
              ))}
              {hidden > 0 && (
                <li className="inline-flex h-6 items-center rounded-full border border-gray-200 bg-white px-2 text-xs font-medium text-gray-600 tabular-nums">
                  +{hidden}
                </li>
              )}
            </ul>
          )}
          {active.length === 0 && (
            <p className="mt-auto pt-1 text-xs font-medium text-amber-800">ยังไม่มีชิ้นชุด — จองไม่ได้</p>
          )}
        </div>
      </Link>
    </article>
  )
}
