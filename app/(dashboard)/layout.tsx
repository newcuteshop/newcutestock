import { redirect } from 'next/navigation'
import Sidebar, { type NavProps } from '@/components/layout/Sidebar'
import MobileNav from '@/components/layout/MobileNav'
import { getSession } from '@/lib/auth/permissions'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')

  // ส่งเฉพาะข้อมูลที่เมนูต้องใช้ไปฝั่ง client (ไม่ส่ง object user ทั้งก้อน)
  const nav: NavProps = {
    email: session.user.email ?? '',
    fullName: session.fullName,
    role: session.role,
    permissions: session.permissions,
  }

  return (
    // ไม่ใส่พื้นหลัง: ให้พื้นนมชมพู + กลีบกุหลาบของ body (app/layout.tsx) มองเห็นผ่านช่องว่างระหว่างการ์ด
    // .app-shell = บอก globals.css ว่าเป็นหน้าระบบ (ซ่อนกลีบแถบหัวเรื่องเมื่อจอแคบ ไม่ให้ทับหัวเรื่อง)
    <div className="app-shell flex h-[100dvh] overflow-hidden">
      {/* เดสก์ท็อป/iPad แนวนอน (md+) */}
      <Sidebar {...nav} />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* มือถือ: แถบบน + ลิ้นชักเมนู */}
        <MobileNav {...nav} />

        {/* โปร่งใสเสมอ (ห้ามใส่ bg-*) · overscroll-y-contain = เลื่อนสุดแล้วไม่ลากทั้งหน้า */}
        <main className="flex-1 overflow-y-auto overscroll-y-contain pb-safe pl-safe pr-safe md:pl-0">
          {/* คอม: ใช้ความกว้างเต็มจอ (ไม่บีบเป็นคอลัมน์แคบกลางจอ)
              มือถือ: ขอบบนเผื่อขอบหยักของแถบบนที่ห้อยลงมา 11px ไม่ให้ชิดหัวเรื่อง */}
          <div className="w-full px-3 pt-6 pb-3 sm:px-4 sm:pt-7 sm:pb-4 md:p-6 xl:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
