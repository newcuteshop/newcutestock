import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight, Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getSession, shopAccess } from '@/lib/auth/permissions'
import { displayLogin } from '@/lib/auth/credentials'
import { loadRentalShopName } from '@/lib/rental'
import BrandMark from '@/components/theme/BrandMark'
import RentalMark from '@/components/theme/RentalMark'
import { ICON } from '@/components/theme/icons'
import LogoutButton from './LogoutButton'

export const metadata: Metadata = { title: 'เลือกร้าน' }
// สิทธิ์ของผู้ใช้เปลี่ยนได้ตลอด (และหน้านี้ redirect ตามสิทธิ์) — ห้ามแคช
export const dynamic = 'force-dynamic'

// หน้าเลือกร้านหลังเข้าสู่ระบบ:
// - เข้าได้ทั้ง 2 ร้าน → การ์ด 2 ใบ (NEWCUTE / ร้านเช่าชุด — ชื่อร้านจาก rental_settings.shop_name)
// - เข้าได้ร้านเดียว → พาเข้าร้านนั้นทันที (/dashboard หรือ /rental)
// - ยังไม่มีสิทธิ์ร้านไหนเลย → การ์ดแจ้ง "ยังไม่ได้รับสิทธิ์" + ปุ่มออกจากระบบ
export default async function SelectShopPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const access = shopAccess(session)
  if (access.newcute && !access.rental) redirect('/dashboard')
  if (access.rental && !access.newcute) redirect('/rental')

  const who = session.fullName || displayLogin(session.user.email ?? '')

  return (
    // ขอบบน/ล่างเผื่อรอยบากและแถบ home (แบบเดียวกับหน้าเข้าสู่ระบบ) · ไม่มีพื้นหลังเอง ใช้พื้นเทาอ่อนของ body
    <main className="min-h-screen min-h-[100dvh] flex items-center justify-center px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      {access.newcute && access.rental ? (
        <ShopPicker who={who} rentalName={await loadRentalShopName(createClient())} />
      ) : (
        <NoAccess who={who} />
      )}
    </main>
  )
}

function ShopPicker({ who, rentalName }: { who: string; rentalName: string }) {
  return (
    <div className="w-full max-w-3xl">
      <div className="mb-5 sm:mb-6 text-center">
        <h1 className="page-title">เลือกร้านที่ต้องการจัดการ</h1>
        <p className="page-subtitle break-words">สวัสดี {who} — เปลี่ยนร้านได้ภายหลังจากเมนู &quot;เปลี่ยนร้าน&quot;</p>
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4" aria-label="ร้านที่เข้าได้">
        <li className="min-w-0">
          <ShopCard
            href="/dashboard"
            mark={<BrandMark size="lg" />}
            name="NEWCUTE"
            kind="ร้านขายเสื้อผ้า"
            detail="สต๊อกสินค้า · บันทึกการขาย · รายงาน"
            latin
          />
        </li>
        <li className="min-w-0">
          <ShopCard
            href="/rental"
            mark={<RentalMark size="lg" />}
            name={rentalName}
            kind="ร้านเช่าชุด"
            detail="การจอง · รับ-คืนชุด · ปฏิทินชุด · การเงิน"
          />
        </li>
      </ul>

      <div className="mt-5 sm:mt-6 flex justify-center">
        <LogoutButton />
      </div>
    </div>
  )
}

function ShopCard({
  href, mark, name, kind, detail, latin = false,
}: {
  href: string
  mark: React.ReactNode
  name: string
  kind: string
  detail: string
  latin?: boolean // ชื่อภาษาอังกฤษตัวใหญ่ → เว้นช่องไฟตัวอักษรแบบโลโก้ NEWCUTE
}) {
  return (
    // ทั้งการ์ดเป็นลิงก์เดียว (พื้นที่แตะใหญ่) — ชื่อร้านเป็นชื่อของลิงก์ให้โปรแกรมอ่านจอ
    <Link
      href={href}
      className="card card-hover flex h-full min-h-[44px] items-center gap-4 p-4 sm:flex-col sm:items-center sm:gap-3 sm:p-6 sm:text-center"
    >
      {mark}
      <span className="min-w-0 flex-1 sm:flex-none">
        <span className={`block break-words text-lg sm:text-xl font-semibold leading-tight text-gray-900 ${latin ? 'tracking-wide' : ''}`}>
          {name}
        </span>
        <span className="mt-0.5 block text-sm font-medium text-brand-700">{kind}</span>
        <span className="mt-1 block text-xs sm:text-sm text-gray-500">{detail}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-700 sm:mt-1" aria-hidden="true">
        <span className="hidden sm:inline">เข้าสู่ร้าน</span>
        <ChevronRight {...ICON} />
      </span>
    </Link>
  )
}

function NoAccess({ who }: { who: string }) {
  return (
    <div className="card w-full max-w-md">
      <div className="empty-state">
        <span className="icon-bubble icon-bubble-lg icon-bubble-warn">
          <Lock size={28} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <h1 className="empty-state-title max-w-md">ยังไม่ได้รับสิทธิ์ใช้งานร้านใด</h1>
        <p className="mt-1 max-w-sm text-sm text-gray-600 break-words">
          บัญชี {who} ยังไม่ได้รับสิทธิ์ใช้งานร้าน NEWCUTE หรือร้านเช่าชุด กรุณาติดต่อผู้ดูแลระบบเพื่อกำหนดสิทธิ์
        </p>
        <div className="mt-4">
          <LogoutButton variant="secondary" />
        </div>
      </div>
    </div>
  )
}
