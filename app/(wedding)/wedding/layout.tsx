import Sidebar, { type NavBadges, type NavProps } from '@/components/layout/Sidebar'
import MobileNav from '@/components/layout/MobileNav'
import EntryGate from '@/components/auth/EntryGate'
import ShopThemeSync from '@/components/theme/ShopThemeSync'
import ShopTabIcon from '@/components/theme/ShopTabIcon'
import { createClient } from '@/lib/supabase/server'
import { canSwitchShop, requireWedding, shopAccess } from '@/lib/auth/permissions'
import { NOSCRIPT_LOCK_HTML } from '@/lib/auth/entry-gate'
import { loadWeddingBadges, loadWeddingBrand } from '@/lib/weddingServer'
import type { WedBadges } from '@/lib/wedding'

// layout ของหลังร้าน b.oncloud คอนเทนต์งานแต่ง (/wedding/*) — โครงเดียวกับ app/(rental)/rental/layout.tsx
// (ประตูเข้าระบบ + เมนูข้าง + แถบบนมือถือ)
// - ไม่ได้เข้าสู่ระบบ → /login ; ไม่มีสิทธิ์ร้านนี้ (admin / wedding / wedding_manage) → /select (requireWedding)
// - ชื่อร้าน + โลโก้ร้านอ่านจาก wed_settings (shop_name, logo_path) ในคำขอเดียว — ห้าม hardcode ; ยังไม่ได้ตั้ง = ชื่อเริ่มต้น + สัญลักษณ์ก้อนเมฆ
//   ไม่แคชข้ามคำขอ: อัปโหลด/ลบโลโก้ในหน้าตั้งค่า → router.refresh() → เมนู/ไอคอนแท็บเปลี่ยนทันที
// - มีโลโก้ = ไอคอนแท็บเบราว์เซอร์เป็นโลโก้ร้าน (ShopTabIcon ฝั่ง client อย่างเดียว) ; ไอคอนแอป/manifest คงชุดเดิมทุกร้าน
//   ไม่ใช้ generateMetadata ของ layout นี้: Next.js คำนวณ metadata ทั้งต้นไม้ใหม่ทุกครั้งที่เปลี่ยนหน้าในแอป
//   (= อ่าน wed_settings เพิ่มทุกการคลิกเมนู) ทั้งที่ layout เองไม่ render ใหม่ — ShopTabIcon เพิ่มลิงก์โลโก้เองอยู่แล้ว
// - ตัวเลขบนเมนูจาก wed_badges() — อ่านไม่ได้ (ยังไม่รัน fix-07 ฯลฯ) = ไม่แสดงตัวเลข
//   layout ไม่ render ใหม่ตอนเปลี่ยนหน้าในแอป → หน้าที่ทำให้ตัวเลขเปลี่ยน (ติดตามลูกค้า/ส่งงาน/รับเงินงวด) เรียก router.refresh()
// - ทั้งหน้าอยู่ในธีม #13 ทองแชมเปญ (data-shop="wedding")

// ตัวเลขของ wed_badges → คีย์ตัวเลขบนเมนู: งาน/การจอง = ติดตามลูกค้าถึงกำหนด + ล็อกคิวจะหมดใน 24 ชม.
function navBadges(b: WedBadges | null): NavBadges | undefined {
  if (!b) return undefined
  return {
    wed_bookings: b.followups + b.holds_expiring,
    wed_deliverables: b.deliverables_overdue,
    wed_installments: b.installments_overdue,
  }
}

export default async function WeddingLayout({ children }: { children: React.ReactNode }) {
  const session = await requireWedding()
  const access = shopAccess(session)

  const supabase = createClient()
  const [brand, badges] = await Promise.all([loadWeddingBrand(supabase), loadWeddingBadges(supabase)])

  // ส่งเฉพาะข้อมูลที่เมนูต้องใช้ไปฝั่ง client (ไม่ส่ง object user ทั้งก้อน)
  const nav: NavProps = {
    email: session.user.email ?? '',
    fullName: session.fullName,
    role: session.role,
    permissions: session.permissions,
    shop: 'wedding',
    shopName: brand.shopName,
    shopLogoUrl: brand.logoUrl,
    canSwitchShop: canSwitchShop(access),
    badges: navBadges(badges),
  }

  return (
    <>
      <noscript dangerouslySetInnerHTML={{ __html: NOSCRIPT_LOCK_HTML }} />
      {/* ไม่ใส่พื้นหลัง: ใช้พื้นของ body · .app-shell = ตัวห่อหน้าระบบ (NOSCRIPT ซ่อนตัวนี้เมื่อปิด JavaScript)
          data-shop="wedding" = ทุกอย่างในกรอบนี้ได้ธีมทองแชมเปญจาก HTML เซิร์ฟเวอร์เลย (ป็อปอัปที่ portal ไป body ใช้ของ <html>) */}
      <div data-shop="wedding" className="app-shell flex h-[100dvh] overflow-hidden">
        {/* หน้าต่างใหม่ที่ยังไม่ได้เข้าสู่ระบบเอง → ออกจากระบบ + ไปหน้าเข้าสู่ระบบ (อยู่ใน layout = ไม่ mount ใหม่ตอนเปลี่ยนหน้า) */}
        <EntryGate />
        {/* ร้าน b.oncloud = ธีม #13 ทองแชมเปญ — เปลี่ยนหน้ามาจาก /select หรือร้านอื่น → สลับสี <html> ก่อนวาด */}
        <ShopThemeSync shop="wedding" />
        {/* มีโลโก้ร้าน → ไอคอนแท็บเป็นโลโก้ (ปิด favicon ของแอปชั่วคราวระหว่างอยู่ในร้านนี้) */}
        {brand.logoUrl && <ShopTabIcon href={brand.logoUrl} />}

        {/* เดสก์ท็อป/iPad แนวนอน (md+) */}
        <Sidebar {...nav} />

        <div className="flex-1 min-w-0 flex flex-col">
          {/* มือถือ: แถบบน + ลิ้นชักเมนู */}
          <MobileNav {...nav} />

          {/* โปร่งใสเสมอ (ห้ามใส่ bg-*) · overscroll-y-contain = เลื่อนสุดแล้วไม่ลากทั้งหน้า
              relative = กรอบอ้างอิงของ position:absolute ข้างใน (เช่น .sr-only) — ไม่งั้นหลุดไปอ้างอิง <body> ทำให้ทั้งหน้าเลื่อนได้ */}
          <main className="relative flex-1 overflow-y-auto overscroll-y-contain pb-safe pl-safe pr-safe md:pl-0">
            {/* ขอบซ้าย-ขวาเท่ากับหลังร้านอื่น (px-3 / sm:px-4 / md:p-6 / xl:p-8) */}
            <div className="w-full px-3 pt-4 pb-3 sm:px-4 sm:pt-5 sm:pb-4 md:p-6 xl:p-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </>
  )
}
