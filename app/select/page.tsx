import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Fragment } from 'react'
import { ChevronRight, Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getSession, shopAccess, shopCount, singleShopHome, type ShopAccess } from '@/lib/auth/permissions'
import { displayLogin } from '@/lib/auth/credentials'
import { loadRentalShopName } from '@/lib/rental'
import { WEDDING_SHOP_KIND } from '@/lib/wedding'
import { loadWeddingShopName } from '@/lib/weddingServer'
import BrandMark from '@/components/theme/BrandMark'
import RentalMark from '@/components/theme/RentalMark'
import WeddingMark from '@/components/theme/WeddingMark'
import { ICON } from '@/components/theme/icons'
import LogoutButton from './LogoutButton'

export const metadata: Metadata = { title: 'เลือกร้าน' }
// สิทธิ์ของผู้ใช้เปลี่ยนได้ตลอด (และหน้านี้ redirect ตามสิทธิ์) — ห้ามแคช
export const dynamic = 'force-dynamic'

// หน้าเลือกร้านหลังเข้าสู่ระบบ (ระบบมี 3 ร้าน: NEWCUTE / ร้านเช่าชุด / ร้าน b.oncloud คอนเทนต์งานแต่ง):
// - เข้าได้ตั้งแต่ 2 ร้าน → การ์ดเฉพาะร้านที่เข้าได้ (ชื่อร้านเช่า/b.oncloud จากการตั้งค่าของร้านนั้น ห้าม hardcode)
// - เข้าได้ร้านเดียว → พาเข้าร้านนั้นทันที (/dashboard, /rental หรือ /wedding)
// - ยังไม่มีสิทธิ์ร้านไหนเลย → การ์ดแจ้ง "ยังไม่ได้รับสิทธิ์" + ปุ่มออกจากระบบ
export default async function SelectShopPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const access = shopAccess(session)
  const home = singleShopHome(access)
  if (home) redirect(home)

  const who = session.fullName || displayLogin(session.user.email ?? '')

  let picker: React.ReactNode = null
  if (shopCount(access) >= 2) {
    // โหลดชื่อเฉพาะร้านที่เข้าได้ (อ่านไม่ได้ = ชื่อเริ่มต้น ไม่ทำให้หน้านี้พัง)
    const supabase = createClient()
    const [rentalName, weddingName] = await Promise.all([
      access.rental ? loadRentalShopName(supabase) : Promise.resolve(''),
      access.wedding ? loadWeddingShopName(supabase) : Promise.resolve(''),
    ])
    picker = <ShopPicker who={who} access={access} rentalName={rentalName} weddingName={weddingName} />
  }

  return (
    // ขอบบน/ล่างเผื่อรอยบากและแถบ home (แบบเดียวกับหน้าเข้าสู่ระบบ) · ไม่มีพื้นหลังเอง ใช้พื้นเทาอ่อนของ body
    <main className="min-h-screen min-h-[100dvh] flex items-center justify-center px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      {picker ?? <NoAccess who={who} />}
    </main>
  )
}

function ShopPicker({
  who, access, rentalName, weddingName,
}: {
  who: string
  access: ShopAccess
  rentalName: string
  weddingName: string
}) {
  // 3 ร้าน → จอใหญ่ (lg) วาง 3 คอลัมน์ในกล่องกว้างขึ้น ; 2 ร้าน → กว้าง/2 คอลัมน์เท่าเดิม
  const three = shopCount(access) >= 3
  return (
    <div className={three ? 'w-full max-w-3xl lg:max-w-5xl' : 'w-full max-w-3xl'}>
      <div className="mb-5 sm:mb-6 text-center">
        <h1 className="page-title">เลือกร้านที่ต้องการจัดการ</h1>
        <p className="page-subtitle break-words">สวัสดี {who} — เปลี่ยนร้านได้ภายหลังจากเมนู &quot;เปลี่ยนร้าน&quot;</p>
      </div>

      <ul
        className={three ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4' : 'grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4'}
        aria-label="ร้านที่เข้าได้"
      >
        {access.newcute && (
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
        )}
        {/* data-shop="rental" = การ์ดนี้ใช้สีร้านเช่า (ฟ้าใส ธีม #18) ทั้งโลโก้/ตัวเน้น/เส้นขอบ ส่วนการ์ด NEWCUTE ยังโรสโกลด์ — เห็นทันทีว่าคนละร้าน */}
        {access.rental && (
          <li className="min-w-0" data-shop="rental">
            <ShopCard
              href="/rental"
              mark={<RentalMark size="lg" />}
              name={rentalName}
              kind="ร้านเช่าชุด"
              detail="การจอง · รับ-คืนชุด · ปฏิทินชุด · การเงิน"
            />
          </li>
        )}
        {/* data-shop="wedding" = การ์ดร้าน b.oncloud ใช้สีทองแชมเปญ (ธีม #13) ของร้านนั้นเอง */}
        {access.wedding && (
          <li className="min-w-0" data-shop="wedding">
            <ShopCard
              href="/wedding"
              mark={<WeddingMark size="lg" />}
              name={weddingName}
              kind={WEDDING_SHOP_KIND}
              detail="ปฏิทินงาน · การจอง · ทีมงาน · ส่งงาน"
            />
          </li>
        )}
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
    // ชื่อร้านหนา 800 แบบชื่อแอปในหน้ารวมแอปกลุ่ม (กติกาเดียวกับ .page-title / ชื่อร้านในเมนู)
    <Link
      href={href}
      className="card card-hover flex h-full min-h-[44px] items-center gap-4 p-4 sm:flex-col sm:items-center sm:gap-3 sm:p-6 sm:text-center"
    >
      {mark}
      <span className="min-w-0 flex-1 sm:flex-none">
        <span className={`block break-words text-lg sm:text-xl font-extrabold leading-tight text-gray-900 ${latin ? 'tracking-wide' : ''}`}>
          {name}
        </span>
        <span className="mt-0.5 block text-sm font-medium text-brand-700">{kind}</span>
        {/* รายการคั่นด้วย " · " — ห่อทีละคำ: ขึ้นบรรทัดใหม่ได้เฉพาะที่ตัวคั่น (ไม่ตัดกลางคำ เช่น "ส่ง/งาน") */}
        <span className="mt-1 block text-xs sm:text-sm text-gray-500">
          {detail.split(' · ').map((part, i) => (
            <Fragment key={part}>
              {i > 0 && ' · '}
              <span className="whitespace-nowrap">{part}</span>
            </Fragment>
          ))}
        </span>
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
          บัญชี {who} ยังไม่ได้รับสิทธิ์ใช้งานร้านใดในระบบ กรุณาติดต่อผู้ดูแลระบบเพื่อกำหนดสิทธิ์
        </p>
        <div className="mt-4">
          <LogoutButton variant="secondary" />
        </div>
      </div>
    </div>
  )
}
