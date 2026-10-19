import Link from 'next/link'
import RentalMark from '@/components/theme/RentalMark'
import ContactButtons, { type ContactInfo } from '@/components/book/ContactButtons'
import CartButton from '@/components/book/CartButton'

// แถบบนของหน้าจองออนไลน์ (ไม่มีเมนูระบบหลังร้าน ไม่มีปุ่มเข้าสู่ระบบ)
// ซ้าย: โลโก้ + ชื่อร้าน (จากตั้งค่าร้าน — ห้าม hardcode) · ขวา: โทร / LINE / รายการจอง
// ติดบนจอตอนเลื่อน · เผื่อรอยบากด้านบน (pt-safe)
export default function BookHeader({
  shopName, contact, showCart,
}: {
  shopName: string
  contact: ContactInfo | null
  /** false = ซ่อนปุ่มรายการจอง (ร้านปิดรับจองออนไลน์ / ระบบยังไม่พร้อม) */
  showCart: boolean
}) {
  return (
    <header className="surface-topbar sticky top-0 pt-safe">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:h-16 sm:px-6">
        <Link href="/book" className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2.5" aria-label={`${shopName} — หน้าแรกจองชุดออนไลน์`}>
          <RentalMark size="sm" className="sm:h-10 sm:w-10" />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold leading-tight text-gray-900 sm:text-base">{shopName}</span>
            <span className="block truncate text-xs text-gray-500">จองชุดออนไลน์</span>
          </span>
        </Link>
        {contact && <ContactButtons contact={contact} compact />}
        {showCart && <CartButton />}
      </div>
    </header>
  )
}
