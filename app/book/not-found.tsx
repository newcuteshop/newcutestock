import NoticeCard from '@/components/book/NoticeCard'

// ไม่พบชุด / ลิงก์สถานะการจองผิด / ที่อยู่ใต้ /book ที่ไม่มีอยู่จริง (ดู app/book/[...rest]/page.tsx)
// ต้องมีหน้านี้ของตัวเอง: หน้า 404 ของระบบหลังร้าน (app/not-found.tsx) มีประตูเข้าระบบ จะพาลูกค้าไปหน้าเข้าสู่ระบบ
export default function BookNotFound() {
  return <NoticeCard kind="notFound" />
}
