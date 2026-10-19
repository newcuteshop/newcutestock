'use client'
import Link from 'next/link'
import { ShoppingBag } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { useBookCart } from '@/components/book/cart'

// ปุ่ม "รายการจอง" บนแถบบน + ตัวเลขจำนวนชุดในรายการ (อ่านจากตะกร้าในเครื่องลูกค้า)
// ตอน hydrate ครั้งแรกตะกร้า = ว่าง (ตรงกับที่เซิร์ฟเวอร์วาด) แล้วค่อยแสดงตัวเลขจริง
export default function CartButton() {
  const cart = useBookCart()
  const n = cart.lines.length
  return (
    <Link
      href="/book/checkout"
      className="relative inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-800"
      aria-label={n > 0 ? `รายการจองของฉัน ${n} ชุด` : 'รายการจองของฉัน (ยังว่าง)'}
    >
      <ShoppingBag {...ICON_SM} />
      <span className="hidden sm:inline">รายการจอง</span>
      {n > 0 && (
        <span className="chip-strong h-5 min-w-[1.25rem] justify-center px-1.5 text-[11px]" aria-hidden="true">
          {n}
        </span>
      )}
    </Link>
  )
}
