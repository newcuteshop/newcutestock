import type { MetadataRoute } from 'next'

// ไฟล์ติดตั้งแอป (/manifest.webmanifest) — ไอคอนแบบ 06 "ถุงช้อปปิ้งโบว์" บนพื้นนมชมพู
// Next.js ใส่ <link rel="manifest"> ให้เอง · ไฟล์รูปอยู่ใน public/icons (middleware ไม่ตรวจ login กับไฟล์พวกนี้)
// สีพื้น/สีแถบ = สีนมชมพูเดียวกับ body (globals.css) และ themeColor (app/layout.tsx) → หน้าจอเปิดแอปไม่กระพริบสี
const MILK = '#FFF3F5'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NEWCUTE',
    short_name: 'NEWCUTE',
    description: 'ระบบสต๊อกสินค้าเสื้อผ้า NEWCUTE',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: MILK,
    theme_color: MILK,
    lang: 'th',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-256.png', sizes: '256x256', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-384.png', sizes: '384x384', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // ภาพเต็มขอบ ถุงอยู่ในวงปลอดภัย 80% → Android ตัดเป็นวงกลม/หยดน้ำได้โดยไม่แหว่ง
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
