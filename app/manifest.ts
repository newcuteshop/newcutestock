import type { MetadataRoute } from 'next'

// ไฟล์ติดตั้งแอป (/manifest.webmanifest) — ไอคอนแบบ 06 "ถุงช้อปปิ้งโบว์"
// Next.js ใส่ <link rel="manifest"> ให้เอง · ไฟล์รูปอยู่ใน public/icons (middleware ไม่ตรวจ login กับไฟล์พวกนี้)
// สีพื้นหน้าเปิดแอป = สีพื้น body (globals.css) · สีแถบ = สีขาวของแถบบนและ themeColor (app/layout.tsx) → เปิดแอปแล้วไม่กระพริบสี
// (ไอคอนแอปไม่เปลี่ยน — เจ้าของเลือกไว้แล้ว)
const CANVAS = '#F7F6F6'
const BAR = '#FFFFFF'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NEWCUTE',
    short_name: 'NEWCUTE',
    description: 'ระบบสต๊อกสินค้าเสื้อผ้า NEWCUTE',
    // รหัสประจำแอป = start_url เดิม ('/dashboard') — ต้องคงไว้ ไม่งั้นเครื่องที่ติดตั้งแอปไว้แล้วจะมองเป็นแอปใหม่
    // (ไม่รับการอัปเดต start_url และอาจชวนติดตั้งซ้ำ)
    id: '/dashboard',
    // เปิดแอปทุกครั้ง → หน้าเข้าสู่ระบบ (ต้องเข้าสู่ระบบเองทุกครั้ง — ดู lib/auth/entry-gate.ts)
    start_url: '/login',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: CANVAS,
    theme_color: BAR,
    lang: 'th',
    icons: [
      // มุมโค้งมน + มุมโปร่งใส (Windows/เดสก์ท็อปไม่ตัดมุมให้เอง) · เปลี่ยนชื่อไฟล์เมื่อแก้รูป เพื่อให้เครื่องที่ติดตั้งไว้ดึงรูปใหม่
      { src: '/icons/icon-round-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-round-256.png', sizes: '256x256', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-round-384.png', sizes: '384x384', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-round-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // ภาพเต็มขอบ ถุงอยู่ในวงปลอดภัย 80% → Android ตัดเป็นวงกลม/หยดน้ำได้โดยไม่แหว่ง
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
