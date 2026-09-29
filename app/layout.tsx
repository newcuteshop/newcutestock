import type { Metadata, Viewport } from 'next'
import { Kodchasan, Sarabun } from 'next/font/google'
import PetalLayer from '@/components/theme/PetalLayer'
import { MOTION_BOOT_SCRIPT } from '@/components/theme/motion'
import EntryGateCover from '@/components/auth/EntryGateCover'
import { ENTRY_GATE_BOOT_SCRIPT } from '@/lib/auth/entry-gate'
import './globals.css'

// สคริปต์ใน <head> รันก่อนหน้าเว็บแสดงผล: ตั้งค่าเอฟเฟกต์ + ล็อกหน้าจอถ้าหน้าต่างนี้ยังไม่ได้เข้าสู่ระบบเอง (ดู lib/auth/entry-gate.ts)
const BOOT_SCRIPT = `${MOTION_BOOT_SCRIPT};${ENTRY_GATE_BOOT_SCRIPT}`

// เนื้อหา: Sarabun (ไม่มีหน้าไหนใช้น้ำหนัก 300 จึงไม่โหลด)
const sarabun = Sarabun({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
})

// หัวเรื่อง / ปุ่ม / ตัวเลขเด่น: Kodchasan (คลาส font-display, h1-h3 ใช้อัตโนมัติ)
// ทุกที่ที่ใช้ Kodchasan เป็นตัวหนา 600/700 → โหลดแค่ 2 น้ำหนัก (มือถือโหลดฟอนต์น้อยลง)
const kodchasan = Kodchasan({
  subsets: ['thai', 'latin'],
  weight: ['600', '700'],
  variable: '--font-display',
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
  // เพิ่มลงหน้าจอโฮม iPhone/iPad: ชื่อใต้ไอคอน + แถบสถานะสีปกติ (ตัวอักษรเข้มบนพื้นนม)
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
  // สีแถบเบราว์เซอร์มือถือ = สีนมชมพูของแถบบน
  themeColor: '#FFF3F5',
  // ธีมนี้มีแบบสว่างแบบเดียว — กันเบราว์เซอร์บังคับโหมดมืดให้ช่องกรอก
  colorScheme: 'light',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-motion / data-gate ถูกตั้งจากสคริปต์ด้านล่างก่อน React เริ่มทำงาน → ไม่ต้องเตือนว่าแอตทริบิวต์ไม่ตรง
    <html lang="th" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      {/* พื้นหลังนมชมพูอยู่ใน globals.css (body) — ห้ามใส่ bg-* ที่ body/html ไม่งั้นบังกลีบกุหลาบ */}
      <body className={`${sarabun.variable} ${kodchasan.variable} font-sans text-gray-900 antialiased`}>
        {/* แผ่นปิดตอนล็อกหน้าจอ (ต้องเป็นลูกชั้นแรกของ body) — ปกติซ่อน */}
        <EntryGateCover />
        <PetalLayer />
        {children}
      </body>
    </html>
  )
}
