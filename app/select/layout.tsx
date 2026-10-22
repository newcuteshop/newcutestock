import { redirect } from 'next/navigation'
import EntryGate from '@/components/auth/EntryGate'
import ShopThemeSync from '@/components/theme/ShopThemeSync'
import { getSession } from '@/lib/auth/permissions'
import { NOSCRIPT_LOCK_HTML } from '@/lib/auth/entry-gate'

// หน้าเลือกร้าน (/select) เป็นหน้าในระบบ (ต้องเข้าสู่ระบบ) แต่ยังไม่อยู่ในร้านไหน → ไม่มีเมนูข้าง
// มีประตูเข้าระบบเหมือน layout ร้าน: หน้าต่างใหม่ที่ยังไม่ได้เข้าสู่ระบบเอง → ออกจากระบบ + ไปหน้าเข้าสู่ระบบ
export default async function SelectLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <>
      <noscript dangerouslySetInnerHTML={{ __html: NOSCRIPT_LOCK_HTML }} />
      {/* .app-shell = ตัวห่อหน้าระบบ (NOSCRIPT_LOCK_HTML ซ่อนตัวนี้เมื่อปิด JavaScript) · พื้นเทาอ่อนมาจาก body */}
      <div className="app-shell min-h-screen min-h-[100dvh]">
        <EntryGate />
        {/* หน้าเลือกร้านเป็นของระบบ NEWCUTE (โรสโกลด์) — การ์ดร้านเช่าในหน้านี้ใส่ data-shop="rental" ของมันเอง */}
        <ShopThemeSync shop="newcute" />
        {children}
      </div>
    </>
  )
}
