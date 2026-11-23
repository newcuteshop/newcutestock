import { redirect } from 'next/navigation'
import Sidebar, { type NavProps } from '@/components/layout/Sidebar'
import MobileNav from '@/components/layout/MobileNav'
import EntryGate from '@/components/auth/EntryGate'
import ShopThemeSync from '@/components/theme/ShopThemeSync'
import { createClient } from '@/lib/supabase/server'
import { canSwitchShop, getSession, shopAccess } from '@/lib/auth/permissions'
import { NOSCRIPT_LOCK_HTML } from '@/lib/auth/entry-gate'
import { loadRentalBadges, loadRentalShopName } from '@/lib/rental'

// layout ของหลังร้านร้านเช่าชุด (/rental/*) — โครงเดียวกับ app/(dashboard)/layout.tsx (ประตูเข้าระบบ + เมนูข้าง + แถบบนมือถือ)
// - ไม่ได้เข้าสู่ระบบ → /login ; ไม่มีสิทธิ์ร้านเช่า (admin / rental / rental_manage) → /select
// - ชื่อร้านอ่านจาก rental_settings.shop_name (ชื่อจริงยังไม่ได้ตั้ง — ห้าม hardcode)
// - ตัวเลขบนเมนู (คำขอจองออนไลน์รอยืนยัน / สลิปรอตรวจ) จาก rental_badges() — อ่านไม่ได้ (ยังไม่รัน fix-05 ฯลฯ) = ไม่แสดงตัวเลข
//   layout ไม่ render ใหม่ตอนเปลี่ยนหน้าในแอป → หน้าที่ทำให้ตัวเลขเปลี่ยน (ยืนยันการจอง/ตรวจสลิป) เรียก router.refresh() เพื่ออัปเดต
export default async function RentalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')
  const access = shopAccess(session)
  if (!access.rental) redirect('/select')

  const supabase = createClient()
  const [shopName, badges] = await Promise.all([loadRentalShopName(supabase), loadRentalBadges(supabase)])

  // ส่งเฉพาะข้อมูลที่เมนูต้องใช้ไปฝั่ง client (ไม่ส่ง object user ทั้งก้อน)
  const nav: NavProps = {
    email: session.user.email ?? '',
    fullName: session.fullName,
    role: session.role,
    permissions: session.permissions,
    shop: 'rental',
    shopName,
    canSwitchShop: canSwitchShop(access),
    badges: badges ?? undefined,
  }

  return (
    <>
      <noscript dangerouslySetInnerHTML={{ __html: NOSCRIPT_LOCK_HTML }} />
      {/* ไม่ใส่พื้นหลัง: ใช้พื้นเทาอ่อนของ body · .app-shell = ตัวห่อหน้าระบบ (NOSCRIPT ซ่อนตัวนี้เมื่อปิด JavaScript)
          data-shop="rental" = ทุกอย่างในกรอบนี้ได้ธีมฟ้าใสจาก HTML เซิร์ฟเวอร์เลย ไม่ต้องรอ <html data-shop> (ป็อปอัปที่ portal ไป body ยังใช้ของ <html>) */}
      <div data-shop="rental" className="app-shell flex h-[100dvh] overflow-hidden">
        {/* หน้าต่างใหม่ที่ยังไม่ได้เข้าสู่ระบบเอง → ออกจากระบบ + ไปหน้าเข้าสู่ระบบ (อยู่ใน layout = ไม่ mount ใหม่ตอนเปลี่ยนหน้า) */}
        <EntryGate />
        {/* ร้านเช่าชุด = ธีม #18 ฟ้าใส (บอสเลือก 22/10/2569) — เปลี่ยนหน้ามาจาก /select → สลับสีก่อนวาด */}
        <ShopThemeSync shop="rental" />

        {/* เดสก์ท็อป/iPad แนวนอน (md+) */}
        <Sidebar {...nav} />

        <div className="flex-1 min-w-0 flex flex-col">
          {/* มือถือ: แถบบน + ลิ้นชักเมนู */}
          <MobileNav {...nav} />

          {/* โปร่งใสเสมอ (ห้ามใส่ bg-*) · overscroll-y-contain = เลื่อนสุดแล้วไม่ลากทั้งหน้า
              relative = กรอบอ้างอิงของ position:absolute ข้างใน (เช่น .sr-only) — ไม่งั้นหลุดไปอ้างอิง <body> ทำให้ทั้งหน้าเลื่อนได้ */}
          <main className="relative flex-1 overflow-y-auto overscroll-y-contain pb-safe pl-safe pr-safe md:pl-0">
            {/* ขอบซ้าย-ขวาเท่ากับหลังร้าน NEWCUTE (px-3 / sm:px-4 / md:p-6 / xl:p-8) */}
            <div className="w-full px-3 pt-4 pb-3 sm:px-4 sm:pt-5 sm:pb-4 md:p-6 xl:p-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </>
  )
}
