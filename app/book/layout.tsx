import type { Metadata } from 'next'
import { bangkokTodayKey } from '@/lib/format'
import { DEFAULT_RENTAL_SHOP_NAME } from '@/lib/rental'
import { getPublicInfo } from '@/components/book/server'
import BookHeader from '@/components/book/BookHeader'
import BookFooter from '@/components/book/BookFooter'

// หน้าจองชุดออนไลน์สาธารณะ /book/** — ลูกค้าเปิดจาก LINE/โซเชียล ไม่ต้องมีบัญชี
// - ไม่มีประตูเข้าระบบ (EntryGate) ไม่มีเมนูหลังร้าน: middleware ข้ามเส้นทางนี้ และสคริปต์ล็อกหน้าจอใน <head> ข้าม /book แล้ว
//   (lib/auth/entry-gate.ts) — ห้ามใส่ EntryGate ในหน้าใต้โฟลเดอร์นี้เด็ดขาด ไม่งั้นลูกค้าถูกพาไปหน้าเข้าสู่ระบบ
// - ชื่อร้านมาจากตั้งค่าร้านเช่า (rental_public_info) — ยังไม่ตั้งชื่อ = 'ร้านเช่าชุด'
// - ข้อมูลร้าน/วันว่างต้องสดเสมอ → ไม่แคชหน้า
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const r = await getPublicInfo()
  const name = r.ok ? r.data.shop_name : DEFAULT_RENTAL_SHOP_NAME
  const description =
    (r.ok && r.data.tagline?.trim()) || `จองชุดเช่าออนไลน์กับ ${name} — ดูวันว่างของชุด เลือกไซส์ และส่งคำขอจองได้ทันที`
  return {
    // แทนชื่อระบบหลังร้าน (NEWCUTE) ทั้งหมด — ลูกค้าเห็นแต่ชื่อร้านเช่า
    title: { default: `จองชุดออนไลน์ · ${name}`, template: `%s · ${name}` },
    description,
    applicationName: name,
    appleWebApp: { capable: true, title: name, statusBarStyle: 'default' },
    // หน้าแคตตาล็อก/หน้าชุดให้ค้นหาเจอได้ (หน้าสถานะการจอง/ส่งคำขอปิดเองในหน้าของมัน)
    robots: { index: true, follow: true },
    openGraph: { type: 'website', siteName: name, title: `จองชุดออนไลน์ · ${name}`, description, locale: 'th_TH' },
  }
}

export default async function BookLayout({ children }: { children: React.ReactNode }) {
  const r = await getPublicInfo()
  const info = r.ok ? r.data : null
  const contact = info ? { phone: info.phone, line_id: info.line_id, line_url: info.line_url } : null
  const year = Number(bangkokTodayKey().slice(0, 4)) || new Date().getFullYear()

  return (
    <div className="flex min-h-screen min-h-[100dvh] flex-col">
      <a
        href="#book-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold"
      >
        ข้ามไปเนื้อหา
      </a>
      <BookHeader
        shopName={info?.shop_name ?? DEFAULT_RENTAL_SHOP_NAME}
        contact={contact}
        showCart={!!info && info.online_enabled}
      />
      <main id="book-main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 sm:px-6 sm:py-8">
        {children}
      </main>
      <BookFooter info={info} year={year} />
    </div>
  )
}
