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
    <div className="flex h-[100dvh] overflow-hidden bg-gray-50">
      {/* เดสก์ท็อป/iPad แนวนอน (md+) */}
      <Sidebar {...nav} />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* มือถือ: แถบบน + ลิ้นชักเมนู */}
        <MobileNav {...nav} />

        <main className="flex-1 overflow-y-auto pb-safe pl-safe pr-safe md:pl-0">
          {/* คอม: ใช้ความกว้างเต็มจอ (ไม่บีบเป็นคอลัมน์แคบกลางจอ) — มือถือ/iPad ระยะขอบเท่าเดิม */}
          <div className="w-full p-3 sm:p-4 md:p-6 xl:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
