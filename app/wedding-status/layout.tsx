import type { Metadata } from 'next'
import ShopThemeSync from '@/components/theme/ShopThemeSync'

// หน้าติดตามงานของคู่บ่าวสาว /wedding-status/** (ร้าน b.oncloud) — ลูกค้าเปิดจากลิงก์ที่ร้านส่งทาง LINE ไม่ต้องมีบัญชี
// - ไม่มีประตูเข้าระบบ (EntryGate) ไม่มีเมนูหลังร้าน: middleware ข้ามเส้นทางนี้ และสคริปต์ล็อกหน้าจอใน <head> ข้าม /wedding-status แล้ว
//   (lib/auth/entry-gate.ts) — ห้ามใส่ EntryGate / เรียก notFound() ของราก (หน้า 404 รากมีประตูเข้าระบบ) ในหน้าใต้โฟลเดอร์นี้
// - แถบบน/ท้ายหน้าอยู่ในแต่ละหน้า (PortalShell) เพราะข้อมูลร้านมากับข้อมูลงานของโทเคน (layout ไม่รู้โทเคน)
// - ไม่ให้ search engine เก็บ และไม่ส่งที่อยู่หน้านี้ (มีโทเคน) เป็น referrer ให้เว็บอื่น
// - ชื่อแท็บไม่มีคำว่า NEWCUTE (หน้าแต่ละหน้าตั้งชื่อเต็มเองด้วย absolute)
export const metadata: Metadata = {
  title: { absolute: 'ติดตามงาน', template: '%s' },
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default function WeddingStatusLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-shop="wedding" ใน HTML จากเซิร์ฟเวอร์เลย: ลูกค้าที่ปิด/บล็อก JavaScript ก็ยังเห็นธีมทองแชมเปญ
    <div data-shop="wedding" className="flex min-h-screen min-h-[100dvh] flex-col bg-canvas">
      {/* ร้าน b.oncloud = ธีม #13 ทองแชมเปญ · <html data-shop> สำหรับ body/ป็อปอัปที่ portal ไปนอกกล่องนี้ */}
      <ShopThemeSync shop="wedding" />
      <a
        href="#portal-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold"
      >
        ข้ามไปเนื้อหา
      </a>
      {children}
    </div>
  )
}
