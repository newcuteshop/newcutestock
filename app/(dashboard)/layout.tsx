import { redirect } from 'next/navigation'
import Sidebar, { type NavProps } from '@/components/layout/Sidebar'
import MobileNav from '@/components/layout/MobileNav'
import EntryGate from '@/components/auth/EntryGate'
import { getSession } from '@/lib/auth/permissions'

// เบราว์เซอร์ปิด JavaScript = สคริปต์ประตูเข้าระบบไม่ทำงาน (ไม่ล็อกหน้าจอ ไม่พาไปหน้าเข้าสู่ระบบ)
// → ซ่อนหน้าระบบทั้งหมดแทน (fail closed) แล้วบอกให้เปิด JavaScript — ระบบใช้งานไม่ได้อยู่แล้วถ้าไม่มี JavaScript
const NOSCRIPT_LOCK =
  '<style>.app-shell{display:none!important}</style>' +
  '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;text-align:center">' +
  '<p style="margin:0;max-width:22rem;font-size:15px;line-height:1.7;color:#201B1D">' +
  'ต้องเปิด JavaScript ก่อนจึงจะใช้ระบบได้<br><a href="/login" style="color:#A43D56;font-weight:600">ไปหน้าเข้าสู่ระบบ</a>' +
  '</p></div>'

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
    <>
      <noscript dangerouslySetInnerHTML={{ __html: NOSCRIPT_LOCK }} />
      {/* ไม่ใส่พื้นหลัง: ใช้พื้นเทาอ่อนของ body (การ์ดขาววางบนพื้นนี้)
          .app-shell = ตัวห่อหน้าระบบ (NOSCRIPT_LOCK ด้านบนซ่อนตัวนี้เมื่อปิด JavaScript) */}
      <div className="app-shell flex h-[100dvh] overflow-hidden">
        {/* หน้าต่างใหม่ที่ยังไม่ได้เข้าสู่ระบบเอง → ออกจากระบบ + ไปหน้าเข้าสู่ระบบ (อยู่ใน layout = ไม่ mount ใหม่ตอนเปลี่ยนหน้า) */}
        <EntryGate />

        {/* เดสก์ท็อป/iPad แนวนอน (md+) */}
        <Sidebar {...nav} />

        <div className="flex-1 min-w-0 flex flex-col">
          {/* มือถือ: แถบบน + ลิ้นชักเมนู */}
          <MobileNav {...nav} />

          {/* โปร่งใสเสมอ (ห้ามใส่ bg-*) · overscroll-y-contain = เลื่อนสุดแล้วไม่ลากทั้งหน้า */}
          <main className="flex-1 overflow-y-auto overscroll-y-contain pb-safe pl-safe pr-safe md:pl-0">
            {/* คอม: ใช้ความกว้างเต็มจอ (ไม่บีบเป็นคอลัมน์แคบกลางจอ)
                มือถือ: ขอบซ้าย-ขวา px-3 / sm:px-4 ต้องเท่ากับ -mx-3 sm:-mx-4 ของแถบบันทึกใน ProductForm (แถบยืดชนขอบจอ) */}
            <div className="w-full px-3 pt-4 pb-3 sm:px-4 sm:pt-5 sm:pb-4 md:p-6 xl:p-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </>
  )
}
