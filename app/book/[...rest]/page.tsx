import { notFound } from 'next/navigation'

// ที่อยู่ใต้ /book ที่ไม่มีหน้า (เช่น /book/item ไม่มีรหัส, /book/abc) → 404 ของหน้าจองออนไลน์ (app/book/not-found.tsx)
// ไม่งั้น Next.js ใช้ 404 ของทั้งแอป (app/not-found.tsx) ซึ่งมีประตูเข้าระบบ → ลูกค้าถูกพาไปหน้าเข้าสู่ระบบ
export default function BookCatchAll() {
  notFound()
}
