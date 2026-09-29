import { redirect } from 'next/navigation'

// เปิดลิงก์หน้าแรกของระบบ → หน้าเข้าสู่ระบบเสมอ (ต้องเข้าสู่ระบบเองทุกครั้ง — ดู lib/auth/entry-gate.ts)
export default function Home() {
  redirect('/login')
}
