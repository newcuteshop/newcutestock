import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import clsx from 'clsx'
import { ArrowRight, Check, Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getSession, shopAccess, shopCount, singleShopHome, type ShopAccess } from '@/lib/auth/permissions'
import { displayLogin } from '@/lib/auth/credentials'
import { loadRentalShopName } from '@/lib/rental'
import { WEDDING_SHOP_KIND } from '@/lib/wedding'
import { loadWeddingShopName } from '@/lib/weddingServer'
import BrandMark from '@/components/theme/BrandMark'
import RentalMark from '@/components/theme/RentalMark'
import WeddingMark from '@/components/theme/WeddingMark'
import { ICON, ICON_SM } from '@/components/theme/icons'
import LogoutButton from './LogoutButton'

export const metadata: Metadata = { title: 'เลือกร้าน' }
// สิทธิ์ของผู้ใช้เปลี่ยนได้ตลอด (และหน้านี้ redirect ตามสิทธิ์) — ห้ามแคช
export const dynamic = 'force-dynamic'

// โลโก้ร้านในการ์ด (ทับขนาด lg 64px ของโลโก้ด้วย !): มือถือ 72px · แท็บเล็ต 96px
// จอใหญ่แนวนอน (wide:) ตามความสูงจอ: จอเตี้ยหดเร็วกว่า (30dvh − 5.5rem) → 600px = 92 · 657px ≈ 109 · 768px ≈ 142 · 900px = 182 · 1080px = 236 · 1440px = 336
// (ค่าที่ลบออก = จอเตี้ยในเบราว์เซอร์จริง เช่น 1280×600 ยังอยู่ในจอเดียว ส่วนจอสูงได้โลโก้ใหญ่เต็มที่)
const MARK_CLS =
  '!h-[72px] !w-[72px] sm:!h-24 sm:!w-24 wide:!h-[clamp(4.5rem,calc(30dvh_-_5.5rem),21rem)] wide:!w-[clamp(4.5rem,calc(30dvh_-_5.5rem),21rem)]'

// ช่องของการ์ดแต่ละใบ: มือถือ = flex (การ์ดยืดเต็มช่อง) · จอใหญ่ = subgrid กิน 4 แถวร่วมของ <ul>
const SHOP_LI = 'flex min-w-0 wide:row-span-4 wide:grid wide:grid-rows-subgrid'

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
    // จอใหญ่แนวนอน (wide:) ขอบบน/ล่างแคบลง ให้การ์ดได้ความสูงจอมากที่สุด
    <main className="min-h-screen min-h-[100dvh] flex items-center justify-center px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] wide:pt-[max(clamp(1rem,3dvh,2rem),env(safe-area-inset-top))] wide:pb-[max(1rem,env(safe-area-inset-bottom))]">
      {picker ?? <NoAccess who={who} />}
    </main>
  )
}

// บอสสั่ง 24/11/2569: หน้าเลือกร้าน "ใหญ่เกือบเต็มจอ เห็นเด่นชัด" + ชี้เมาส์ที่การ์ดแล้วยกลอย/แถบแสงวิ่ง (.lift-hover ใน app/globals.css)
// - จอใหญ่แนวนอน (wide: = กว้าง ≥ 1024px และกว้าง:สูง ≥ 5:4 — tailwind.config.ts): กว้าง 92vw สูงเต็มจอ (self-stretch)
//   หัวเรื่อง / การ์ดยืดเต็มพื้นที่ที่เหลือ / ปุ่มออกจากระบบ · ขนาดตัวอักษร/โลโก้ใช้ clamp() กับ dvh → ขยายตามความสูงจอ
//   (จอเตี้ยในเบราว์เซอร์จริง เช่น 1366×657, 1280×600 ถึงจอสูง 2560×1440 อยู่ในจอเดียวไม่ต้องเลื่อน)
//   การ์ดทุกใบใช้แถวร่วมกัน (subgrid): โลโก้ / ชื่อร้าน / งานหลัก / ปุ่ม อยู่ระดับเดียวกันทุกใบ แม้ชื่อร้านยาว 2 บรรทัด
//   ที่ว่างที่เหลืออยู่ใต้รายการงานหลัก (ปุ่ม "เข้าสู่ร้าน" ชิดล่างการ์ด)
// - แท็บเล็ต/มือถือ และจอแนวตั้ง (เช่น iPad Pro แนวตั้ง): การ์ดเรียงลงคอลัมน์เดียว ใหญ่ตามธรรมชาติ เลื่อนหน้าได้ตามปกติ
function ShopPicker({
  who, access, rentalName, weddingName,
}: {
  who: string
  access: ShopAccess
  rentalName: string
  weddingName: string
}) {
  // 3 ร้าน → จอใหญ่ 3 คอลัมน์ ; 2 ร้าน → 2 คอลัมน์ (กว้างรวม 92vw เท่ากัน)
  const cols = shopCount(access) >= 3 ? 3 : 2
  return (
    // จอกว้างพิเศษ (เช่น 3440×1440) กว้างไม่เกิน 2 เท่าของความสูงจอ — การ์ดไม่แบนเกินไป
    <div className="flex w-full max-w-2xl flex-col wide:w-[92vw] wide:max-w-[200dvh] wide:self-stretch">
      <div className="mb-5 text-center sm:mb-6 wide:mb-[clamp(0.75rem,3dvh,2rem)]">
        {/* ชื่อหน้าหนา 800 (.page-title) ขยายใหญ่: มือถือ 26px · แท็บเล็ต 32px · จอใหญ่ 30-88px ตามความสูงจอ (768px ≈ 42 · 900px = 51 · 1440px ≈ 89) */}
        <h1 className="page-title text-[26px] leading-[1.3] sm:text-[32px] wide:text-[length:clamp(1.75rem,calc(7dvh_-_0.75rem),5.5rem)]">เลือกร้านที่ต้องการจัดการ</h1>
        {/* ชื่อเมนู "เปลี่ยนร้าน" ในเครื่องหมายคำพูดไม่ถูกตัดขึ้นบรรทัดใหม่กลางคำ (มือถือ) */}
        <p className="page-subtitle mt-2 break-words text-base sm:text-lg wide:text-[length:clamp(1.0625rem,2.3dvh,2.125rem)]">
          สวัสดี {who} — เปลี่ยนร้านได้ภายหลังจากเมนู <span className="whitespace-nowrap">&quot;เปลี่ยนร้าน&quot;</span>
        </p>
      </div>

      {/* จอใหญ่: 4 แถวร่วมของการ์ดทุกใบ (โลโก้ / ชื่อร้าน / งานหลัก ยืดรับที่ว่าง / ปุ่ม) — ระยะห่างแนวตั้งตามความสูงจอ
          <ul> เป็น container (cqi = 1% ของความกว้างแถวการ์ด) ให้ชื่อร้านย่อตามความกว้างการ์ด — ใส่ที่การ์ดเองไม่ได้ (ทำให้ subgrid ใช้ไม่ได้) */}
      <ul
        className={clsx(
          'grid grid-cols-1 gap-4 sm:gap-5 wide:flex-1 wide:grid-rows-[auto_auto_1fr_auto] wide:gap-x-[clamp(1rem,1.8vw,2rem)] wide:gap-y-[clamp(0.5rem,calc(3.2dvh_-_0.5rem),2.5rem)] wide:[container-type:inline-size]',
          cols === 3 ? 'wide:grid-cols-3' : 'wide:grid-cols-2',
        )}
        aria-label="ร้านที่เข้าได้"
      >
        {/* li เป็น flex → การ์ด (ลิงก์) ยืดสูงเต็มแถว การ์ดทุกใบสูงเท่ากัน (จอใหญ่: li/การ์ดเป็น subgrid กิน 4 แถวร่วม)
            data-shop บน li = การ์ดใบนั้นใช้สีของร้านตัวเองทั้งใบ (แถบบน/โลโก้/ปุ่ม/เส้น/เงา/แถบแสง):
            NEWCUTE โรสโกลด์ · ร้านเช่าฟ้าใส (ธีม #18) · b.oncloud ทองแชมเปญ (ธีม #13) — เห็นทันทีว่าคนละร้าน */}
        {access.newcute && (
          <li className={SHOP_LI} data-shop="newcute">
            <ShopCard
              href="/dashboard"
              cols={cols}
              mark={<BrandMark size="lg" className={MARK_CLS} />}
              name="NEWCUTE"
              kind="ร้านขายเสื้อผ้า"
              detail="สต๊อกสินค้า · บันทึกการขาย · รายงาน"
              latin
            />
          </li>
        )}
        {access.rental && (
          <li className={SHOP_LI} data-shop="rental">
            <ShopCard
              href="/rental"
              cols={cols}
              mark={<RentalMark size="lg" className={MARK_CLS} />}
              name={rentalName}
              kind="ร้านเช่าชุด"
              detail="การจอง · รับ-คืนชุด · ปฏิทินชุด · การเงิน"
            />
          </li>
        )}
        {access.wedding && (
          <li className={SHOP_LI} data-shop="wedding">
            <ShopCard
              href="/wedding"
              cols={cols}
              mark={<WeddingMark size="lg" className={MARK_CLS} />}
              name={weddingName}
              kind={WEDDING_SHOP_KIND}
              detail="ปฏิทินงาน · การจอง · ทีมงาน · ส่งงาน"
            />
          </li>
        )}
      </ul>

      <div className="mt-5 flex justify-center sm:mt-6 wide:mt-[clamp(0.25rem,calc(2.5dvh_-_0.5rem),1.25rem)]">
        {/* จอใหญ่: ปุ่มออกจากระบบใหญ่ขึ้นให้เข้าสัดส่วนหน้า (ตัวอักษร 18-26px สูง 44-64px ตามความสูงจอ) */}
        <LogoutButton className="wide:min-h-[clamp(2.75rem,5.4dvh,4rem)] wide:px-5 wide:text-[length:clamp(1.125rem,2dvh,1.625rem)] wide:[&>svg]:h-[1.05em] wide:[&>svg]:w-[1.05em]" />
      </div>
    </div>
  )
}

// ขนาดชื่อร้านบนจอใหญ่: ค่าที่เล็กกว่าระหว่าง "ตามความสูงจอ (dvh)" กับ "ตามความกว้างการ์ด"
// ความกว้างการ์ด = ~32% (3 คอลัมน์) / ~49% (2 คอลัมน์) ของ <ul> → 11% ของการ์ด ≈ 3.52cqi / 5.39cqi · 8% ≈ 2.56cqi / 3.92cqi
const NAME_SIZE = {
  3: {
    short: 'text-[26px] sm:text-[34px] wide:text-[length:clamp(1.75rem,min(5.4dvh,3.52cqi),5rem)]',
    long: 'text-[20px] sm:text-[28px] wide:text-[length:clamp(1.5rem,min(4.4dvh,2.56cqi),4.25rem)]',
  },
  2: {
    short: 'text-[26px] sm:text-[34px] wide:text-[length:clamp(1.75rem,min(5.4dvh,5.39cqi),5rem)]',
    long: 'text-[20px] sm:text-[28px] wide:text-[length:clamp(1.5rem,min(4.4dvh,3.92cqi),4.25rem)]',
  },
} as const

function ShopCard({
  href, cols, mark, name, kind, detail, latin = false,
}: {
  href: string
  cols: 2 | 3
  mark: React.ReactNode
  name: string
  kind: string
  detail: string
  latin?: boolean // ชื่อภาษาอังกฤษตัวใหญ่ → เว้นช่องไฟตัวอักษรแบบโลโก้ NEWCUTE
}) {
  // ชื่อร้านยาว (เช่น "b.oncloud.wedding content" ค่าเริ่มต้นของร้าน b.oncloud) → ตัวเล็กลงหนึ่งขั้น ไม่ให้คำยาวถูกตัดกลางคำ
  // จอใหญ่: ขนาดตามความสูงจอ (dvh) และความกว้างการ์ด (cqi ของ <ul>) เลือกค่าที่เล็กกว่า — NAME_SIZE ด้านบน
  const long = Array.from(name).length > 14
  const nameSize = NAME_SIZE[cols][long ? 'long' : 'short']
  // ชื่อร้านเช่าค่าเริ่มต้น "ร้านเช่าชุด" ตรงกับประเภทร้าน → ไม่แสดงประเภทซ้ำใต้ชื่อ
  const showKind = kind.trim() !== name.trim()
  const parts = detail.split(' · ')
  return (
    // ทั้งการ์ดเป็นลิงก์เดียว (พื้นที่แตะใหญ่) — ชื่อร้านเป็นชื่อของลิงก์ให้โปรแกรมอ่านจอ
    // .shop-card = การ์ดขาว มุม 16px แถบสีร้านด้านบน 6px · .lift-hover .lift-card = ชี้เมาส์แล้วยก 4px + เงา + แถบแสงวิ่งผ่าน
    // จอใหญ่: การ์ดเป็น subgrid 4 แถว (กล่องห่อด้านในเป็น display: contents) → โลโก้/ชื่อ/รายการ/ปุ่ม เรียงกลางการ์ด ตรงแถวกันทุกใบ
    <Link
      href={href}
      className="shop-card lift-hover lift-card wide:row-span-4 wide:grid wide:grid-rows-subgrid wide:justify-items-center wide:px-[clamp(1.25rem,2.2vw,3.5rem)] wide:pb-[clamp(1.25rem,3dvh,2.75rem)] wide:pt-[clamp(1.25rem,3.5dvh,3.25rem)] wide:text-center"
    >
      {/* เนื้อหา: มือถือ/แท็บเล็ต = โลโก้ซ้าย ชื่อขวา รายการ 2 คอลัมน์ · จอใหญ่ = เรียงกลางการ์ดจากบนลงล่าง */}
      <span className="flex flex-1 flex-col gap-4 px-5 pb-4 pt-6 sm:gap-5 sm:px-7 sm:pb-5 sm:pt-8 wide:contents">
        <span className="flex items-center gap-4 sm:gap-5 wide:contents">
          {mark}
          <span className="min-w-0 flex-1 wide:w-full">
            {/* ชื่อร้านหนา 800 แบบชื่อแอปในหน้ารวมแอปกลุ่ม (กติกาเดียวกับ .page-title / ชื่อร้านในเมนู) */}
            <span className={clsx('block break-words font-extrabold leading-[1.2] text-gray-900', nameSize, latin && 'tracking-wide')}>
              {name}
            </span>
            {showKind && (
              <span className="mt-1 block text-base font-medium text-brand-700 sm:text-[19px] wide:mt-[clamp(0.25rem,0.8dvh,0.625rem)] wide:text-[length:clamp(1.0625rem,2.45dvh,2.25rem)]">
                {kind}
              </span>
            )}
          </span>
        </span>
        {/* งานหลักของร้าน — แต่ละข้อไม่ตัดกลางคำ (เช่น "ส่ง/งาน") · โปรแกรมอ่านจอได้ยินคั่นด้วยจุลภาค
            มือถือ/แท็บเล็ต 2 คอลัมน์ (ไม่มีข้อเดียวหล่นไปบรรทัดใหม่) · จอใหญ่ เรียงลงพร้อมเครื่องหมายถูก ชิดบนของแถว */}
        <span className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[15px] leading-snug text-gray-600 sm:text-[17px] wide:flex wide:flex-col wide:items-start wide:self-start wide:gap-y-[clamp(0.125rem,calc(1.6dvh_-_0.375rem),0.875rem)] wide:text-[length:clamp(1rem,2dvh,2rem)]">
          {parts.map((part, i) => (
            <span key={part} className="inline-flex min-w-0 items-center gap-2 whitespace-nowrap">
              {/* ไอคอนโตตามตัวอักษรบนจอใหญ่ (จอสูงตัวอักษรถึง 32px ไอคอน 18px คงที่จะดูเล็กไป) */}
              <Check {...ICON_SM} className="shrink-0 text-brand-600 wide:h-[1.05em] wide:w-[1.05em]" />
              {part}
              {i < parts.length - 1 && <span className="sr-only">, </span>}
            </span>
          ))}
        </span>
      </span>
      {/* ปุ่ม "เข้าสู่ร้าน" สีของร้าน เต็มความกว้าง (ตกแต่ง — ทั้งการ์ดเป็นลิงก์อยู่แล้ว จึงซ่อนจากโปรแกรมอ่านจอ) */}
      <span
        className="shop-card-cta mx-5 mb-5 min-h-[52px] text-[17px] sm:mx-7 sm:mb-7 sm:min-h-14 sm:text-lg wide:m-0 wide:w-full wide:min-h-[clamp(3.5rem,7.1dvh,6.5rem)] wide:text-[length:clamp(1.125rem,2.4dvh,2.25rem)]"
        aria-hidden="true"
      >
        เข้าสู่ร้าน
        <ArrowRight {...ICON} className="wide:h-[1.1em] wide:w-[1.1em]" />
      </span>
    </Link>
  )
}

// ยังไม่มีสิทธิ์ร้านใดเลย — การ์ดแจ้งใหญ่ขึ้นให้เข้ากับหน้าเลือกร้าน (จอตั้งแต่แท็บเล็ต: หัวข้อ 28px ไอคอน 80px ปุ่มสูง 48px)
function NoAccess({ who }: { who: string }) {
  return (
    <div className="card w-full max-w-md sm:max-w-xl md:max-w-2xl">
      <div className="empty-state py-12 sm:px-8 md:py-16">
        <span className="icon-bubble icon-bubble-lg icon-bubble-warn md:!h-20 md:!w-20 md:!rounded-2xl">
          <Lock size={28} strokeWidth={1.75} aria-hidden="true" className="md:h-10 md:w-10" />
        </span>
        <h1 className="empty-state-title mt-2 max-w-xl text-xl sm:text-2xl md:text-[28px] md:leading-snug">ยังไม่ได้รับสิทธิ์ใช้งานร้านใด</h1>
        <p className="mt-1 max-w-lg break-words text-base text-gray-600 md:text-lg">
          บัญชี {who} ยังไม่ได้รับสิทธิ์ใช้งานร้านใดในระบบ กรุณาติดต่อผู้ดูแลระบบเพื่อกำหนดสิทธิ์
        </p>
        <div className="mt-5 md:mt-6">
          <LogoutButton variant="secondary" className="md:min-h-12 md:px-6 md:text-lg" />
        </div>
      </div>
    </div>
  )
}
