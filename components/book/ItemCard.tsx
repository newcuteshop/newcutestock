import Link from 'next/link'
import clsx from 'clsx'
import { CheckCircle2, XCircle } from 'lucide-react'
import { baht } from '@/lib/format'
import { sizeKey, sizeLabel, type PublicCatalogItem } from '@/lib/rental'
import RentalImage from '@/components/rental/RentalImage'

// การ์ดชุด 1 แบบในแคตตาล็อก (ทั้งการ์ดเป็นลิงก์ไปหน้าชุด) — ใช้ได้ทั้ง server และ client component
// ราคา "฿x / y วัน" = ราคาเริ่มต้นที่รวม y วันแล้ว · ถ้าลูกค้าเลือกวันแล้ว: ป้ายว่าง/ไม่ว่าง + ราคาของช่วงวันนั้น
// ไม่พึ่งสีอย่างเดียว: ป้ายมีไอคอน + ข้อความเสมอ
const MAX_SIZE_CHIPS = 5

export default function ItemCard({
  item, href, headingLevel = 'h3', compact = false,
}: {
  item: PublicCatalogItem
  href: string
  headingLevel?: 'h2' | 'h3'
  /** การ์ดเล็ก (อุปกรณ์เสริมในหน้าชุด) — ไม่แสดงไซส์/ค่าประกัน */
  compact?: boolean
}) {
  const Heading = headingLevel
  const sizes = item.sizes.slice(0, MAX_SIZE_CHIPS)
  const more = item.sizes.length - sizes.length
  return (
    <Link href={href} className="card card-hover flex h-full min-w-0 flex-col overflow-hidden">
      <RentalImage path={item.cover_path} alt={item.name} className="aspect-[3/4] w-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
        {item.category_name && <p className="truncate text-xs text-gray-500">{item.category_name}</p>}
        <Heading className="line-clamp-2 break-words text-sm font-semibold leading-snug text-gray-900">{item.name}</Heading>
        <p className="truncate text-xs text-gray-400">รหัส {item.code}</p>
        <div className="mt-auto space-y-1 pt-1.5">
          <p className="leading-tight">
            <span className="money text-base text-gray-900">{baht(item.base_price)}</span>
            <span className="text-xs text-gray-500"> / {item.base_days} วัน</span>
          </p>
          {!compact && item.extra_day_price > 0 && (
            <p className="text-xs text-gray-500">วันต่อไป {baht(item.extra_day_price)}/วัน</p>
          )}
          {!compact && item.security_deposit > 0 && (
            <p className="text-xs text-gray-500">ค่าประกันชุด {baht(item.security_deposit)}</p>
          )}
          {!compact && sizes.length > 0 && (
            <p className="flex flex-wrap gap-1 pt-0.5" aria-label={`ไซส์: ${item.sizes.map(s => sizeLabel(s)).join(', ')}`}>
              {sizes.map(s => (
                <span key={sizeKey(s) || 'free'} className="chip-outline h-5 px-2 text-[11px]" aria-hidden="true">
                  {sizeLabel(s)}
                </span>
              ))}
              {more > 0 && <span className="chip h-5 px-2 text-[11px]" aria-hidden="true">+{more}</span>}
            </p>
          )}
          {item.available !== null && (
            <p className={clsx(item.available ? 'badge-in' : 'badge-out', 'h-auto min-h-6 w-full justify-start whitespace-normal rounded-md py-1 leading-snug')}>
              {item.available ? <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" /> : <XCircle size={14} strokeWidth={2} aria-hidden="true" />}
              <span className="min-w-0">
                {item.available
                  ? item.rent_price !== null
                    ? `ว่าง · ช่วงนี้ ${baht(item.rent_price)}`
                    : 'ว่างช่วงวันที่เลือก'
                  : 'ไม่ว่างช่วงวันที่เลือก'}
              </span>
            </p>
          )}
        </div>
      </div>
    </Link>
  )
}
