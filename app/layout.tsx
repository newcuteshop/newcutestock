import type { Metadata, Viewport } from 'next'
import { Prompt } from 'next/font/google'
import EntryGateCover from '@/components/auth/EntryGateCover'
import { ENTRY_GATE_BOOT_SCRIPT } from '@/lib/auth/entry-gate'
import { SHOP_THEME_BOOT_SCRIPT } from '@/lib/shopTheme'
import './globals.css'

// สคริปต์ใน <head> รันก่อนหน้าเว็บแสดงผล: ล็อกหน้าจอถ้าหน้าต่างนี้ยังไม่ได้เข้าสู่ระบบเอง (ดู lib/auth/entry-gate.ts)
// (สวิตช์ "เอฟเฟกต์เคลื่อนไหว" เลิกแล้ว — ธีมทางการไม่มีแอนิเมชันตกแต่งให้ปิด จึงไม่มีสคริปต์ตั้ง data-motion อีก)
// + ตั้ง <html data-shop> (newcute / rental) ก่อนวาด → ร้านเช่าชุดเป็นธีมฟ้าใส (#18 ที่บอสเลือก 22/10/2569) ตั้งแต่เฟรมแรก
//   NEWCUTE ได้โรสโกลด์เดิม (ดู lib/shopTheme.ts และตัวแปรสีใน app/globals.css)
const BOOT_SCRIPT = ENTRY_GATE_BOOT_SCRIPT + ';' + SHOP_THEME_BOOT_SCRIPT

// ฟอนต์เดียวทั้งระบบ (ทุกร้าน): Prompt — บอสสั่ง 23/11/2569 ให้เหมือนหน้ารวมแอปของกลุ่ม (naiwansookgroup.vercel.app/apps)
//   ไทยแบบไม่มีหัว ทรงกลมเรขาคณิต ดูมีสีสันมีชีวิตชีวากว่า IBM Plex Sans Thai เดิม · สี/ธีม/ระยะห่างของแต่ละร้านคงเดิมทั้งหมด
// น้ำหนัก: 400 เนื้อหา · 500 ป้าย/เมนู · 600 หัวการ์ด/หัวส่วน/ปุ่ม/ตัวเลขเด่น · 700 เอกสาร/ใบเสร็จ/font-bold
//   · 800 ชื่อหน้า (.page-title ใน globals.css) + ชื่อร้าน (เมนูข้าง/แถบบนมือถือ, หน้าเข้าสู่ระบบ, การ์ดเลือกร้าน) แบบหัวเรื่องหนาของหน้ารวมแอป
// ตัวเลขของ Prompt กว้างไม่เท่ากัน (ฟอนต์ไม่มี tnum — วัดแล้ว '1' แคบกว่า '0' เกือบครึ่ง) → คลาส tabular-nums ไม่มีผลกับฟอนต์นี้
// ตัวแปร --font-sans (tailwind: font-sans และ font-display ชี้ตัวเดียวกัน · กราฟอ่านชื่อฟอนต์จริงจากตัวแปรนี้ ส่วนสติกเกอร์/รูป QR อ่าน font-family ของ body)
const prompt = Prompt({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-sans',
})

// ไอคอนแอป: app/favicon.ico, app/icon.svg, app/apple-icon.png + app/manifest.ts (Next.js ใส่แท็ก <link> ให้เอง ห้ามเขียนซ้ำ)
export const metadata: Metadata = {
  // ตอนนี้ยังไม่มีหน้าไหนตั้ง title เอง → ทุกหน้าใช้ default · ถ้าหน้าไหนตั้งเพิ่มจะได้ "ชื่อหน้า · NEWCUTE"
  title: {
    default: 'NEWCUTE · ระบบสต๊อกสินค้าเสื้อผ้า',
    template: '%s · NEWCUTE',
  },
  description: 'ระบบจัดการสต๊อกสินค้าเสื้อผ้า',
  applicationName: 'NEWCUTE',
  // เพิ่มลงหน้าจอโฮม iPhone/iPad: ชื่อใต้ไอคอน + แถบสถานะสีปกติ (ตัวอักษรเข้มบนพื้นขาว)
  appleWebApp: {
    capable: true,
    title: 'NEWCUTE',
    statusBarStyle: 'default',
  },
  // ระบบหลังร้าน ไม่ให้ search engine เก็บ
  robots: { index: false, follow: false },
  // กัน iOS เปลี่ยนเลข SKU/บาร์โค้ดเป็นลิงก์โทรศัพท์
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // สีแถบเบราว์เซอร์มือถือ = สีขาวของแถบบน (.surface-topbar)
  themeColor: '#FFFFFF',
  // ธีมนี้มีแบบสว่างแบบเดียว — กันเบราว์เซอร์บังคับโหมดมืดให้ช่องกรอก
  colorScheme: 'light',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-gate / data-shop ถูกตั้งจากสคริปต์ด้านล่างก่อน React เริ่มทำงาน → ไม่ต้องเตือนว่าแอตทริบิวต์ไม่ตรง
    <html lang="th" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      {/* พื้นหลัง (NEWCUTE เทาอ่อน #F7F6F6 / ร้านเช่า ฟ้าจาง #F5F9FB) อยู่ใน globals.css (body → --c-canvas) */}
      <body className={`${prompt.variable} font-sans text-gray-900 antialiased`}>
        {/* แผ่นปิดตอนล็อกหน้าจอ (ต้องเป็นลูกชั้นแรกของ body) — ปกติซ่อน */}
        <EntryGateCover />
        {children}
      </body>
    </html>
  )
}
