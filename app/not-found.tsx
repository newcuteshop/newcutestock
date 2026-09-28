import Link from 'next/link'

// ที่อยู่เว็บที่ไม่มีอยู่จริง — แทนหน้า 404 ภาษาอังกฤษของ Next.js
export default function NotFound() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-4">
      <div className="card w-full max-w-md p-5 sm:p-6 text-center">
        <div className="text-4xl mb-3" aria-hidden="true">🔍</div>
        <h1 className="text-lg sm:text-xl font-bold text-gray-900">ไม่พบหน้านี้</h1>
        <p className="text-sm text-gray-600 mt-2">ลิงก์อาจพิมพ์ผิด หรือหน้านี้ถูกย้ายไปแล้ว</p>
        <Link href="/dashboard" className="btn-primary mt-5 w-full sm:w-auto">
          กลับหน้าภาพรวม
        </Link>
      </div>
    </div>
  )
}
