import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans_Thai } from 'next/font/google'
import EntryGateCover from '@/components/auth/EntryGateCover'
import { ENTRY_GATE_BOOT_SCRIPT } from '@/lib/auth/entry-gate'
import './globals.css'

// สคริปต์ใน <head> รันก่อนหน้าเว็บแสดงผล: ล็อกหน้าจอถ้าหน้าต่างนี้ยังไม่ได้เข้าสู่ระบบเอง (ดู lib/auth/entry-gate.ts)
// (สวิตช์ "เอฟเฟกต์เคลื่อนไหว" เลิกแล้ว — ธีมทางการไม่มีแอนิเมชันตกแต่งให้ปิด จึงไม่มีสคริปต์ตั้ง data-motion อีก)
const BOOT_SCRIPT = ENTRY_GATE_BOOT_SCRIPT

// ฟอนต์เดียวทั้งระบบ: IBM Plex Sans Thai (ไทยแบบไม่มีหัว อ่านง่าย ดูเป็นทางการ + ตัวเลขละตินคมชัด)
// 400 เนื้อหา · 500 ป้าย/เมนู · 600 หัวเรื่อง/ปุ่ม/ตัวเลขเด่น · 700 เผื่อที่ยังใช้ font-bold
// ตัวแปร --font-sans (tailwind: font-sans และ font-display ชี้ตัวเดียวกัน)
const plexThai = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
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
    // data-gate ถูกตั้งจากสคริปต์ด้านล่างก่อน React เริ่มทำงาน → ไม่ต้องเตือนว่าแอตทริบิวต์ไม่ตรง
    <html lang="th" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      {/* พื้นหลังเทาอ่อน (#F7F6F6) อยู่ใน globals.css (body) */}
      <body className={`${plexThai.variable} font-sans text-gray-900 antialiased`}>
        {/* แผ่นปิดตอนล็อกหน้าจอ (ต้องเป็นลูกชั้นแรกของ body) — ปกติซ่อน */}
        <EntryGateCover />
        {children}
      </body>
    </html>
  )
}
