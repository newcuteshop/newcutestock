import type { Metadata, Viewport } from 'next'
import { Sarabun } from 'next/font/google'
import './globals.css'

const sarabun = Sarabun({
  subsets: ['thai', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-sans',
})

export const metadata: Metadata = {
  title: 'Stock App — ระบบสต๊อกสินค้าเสื้อผ้า',
  description: 'ระบบจัดการสต๊อกสินค้าเสื้อผ้า',
  applicationName: 'Stock App',
  // ระบบหลังร้าน ไม่ให้ search engine เก็บ
  robots: { index: false, follow: false },
  // กัน iOS เปลี่ยนเลข SKU/บาร์โค้ดเป็นลิงก์โทรศัพท์
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0284c7',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className={`${sarabun.variable} font-sans bg-gray-50 text-gray-900 antialiased`}>
        {children}
      </body>
    </html>
  )
}
