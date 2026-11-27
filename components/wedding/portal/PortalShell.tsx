// ===== โครงหน้าติดตามงานของคู่บ่าวสาว: แถบบน (โลโก้/ชื่อร้าน/ปุ่มติดต่อ) + เนื้อหา + ท้ายหน้า (ข้อมูลร้าน) =====
// ใช้ได้ทั้ง server และ client component (ไม่มี state) — ข้อมูลร้านมาจาก wed_public_booking.shop (ห้าม hardcode ชื่อร้าน)
// ไม่รู้ข้อมูลร้าน (ลิงก์ผิด/ระบบยังไม่พร้อม) → แถบบนแสดงสัญลักษณ์ร้าน + "ติดตามงาน" อย่างเดียว
// กติกาเบราว์เซอร์ในแอป LINE: ลิงก์ทุกตัวเปิดในหน้าเดิม (ไม่มี target=_blank) และไม่ส่ง referrer (URL มีโทเคน)
import type { ReactNode } from 'react'
import { AtSign, Facebook, Instagram, Mail, Music2 } from 'lucide-react'
import { ICON_XS } from '@/components/theme/icons'
import WeddingMark from '@/components/theme/WeddingMark'
import WeddingLogo from '@/components/theme/WeddingLogo'
import ContactButtons from '@/components/book/ContactButtons'
import { safeHttpUrl, weddingImageUrl, type WedPublicShop } from '@/lib/wedding'

// ลิงก์โซเชียลจากค่าที่ร้านกรอก: เป็นลิงก์ http(s) อยู่แล้ว → ใช้ตามนั้น ; เป็นชื่อบัญชี → สร้างลิงก์ของแพลตฟอร์ม ; อื่นๆ → null
function handleOf(v: string | null): string | null {
  const s = String(v ?? '').trim().replace(/^@+/, '')
  return s && /^[A-Za-z0-9._-]{1,60}$/.test(s) ? s : null
}

export function instagramHref(v: string | null): string | null {
  const direct = safeHttpUrl(v)
  if (direct) return direct
  const h = handleOf(v)
  return h ? `https://www.instagram.com/${encodeURIComponent(h)}` : null
}

export function tiktokHref(v: string | null): string | null {
  const direct = safeHttpUrl(v)
  if (direct) return direct
  const h = handleOf(v)
  return h ? `https://www.tiktok.com/@${encodeURIComponent(h)}` : null
}

export function facebookHref(v: string | null): string | null {
  return safeHttpUrl(v)
}

// ชื่อบัญชีสำหรับแสดง: ร้านกรอกเป็นลิงก์เต็ม → เอาส่วนแรกของ path (instagram.com/<ชื่อ> · tiktok.com/@<ชื่อ>) ; กรอกเป็นชื่อ → ตามนั้น
function handleLabel(v: string | null): string {
  const s = String(v ?? '').trim()
  const url = safeHttpUrl(s)
  if (!url) return s.replace(/^@+/, '')
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean)[0] ?? ''
    return decodeURIComponent(seg).replace(/^@+/, '')
  } catch {
    return ''
  }
}

function emailHref(v: string | null): string | null {
  const s = String(v ?? '').trim()
  return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(s) && s.length <= 200 ? `mailto:${s}` : null
}

// โลโก้ร้าน: แบบเดียวกับหัวเอกสาร/เมนูหลังร้าน — รูปตามสัดส่วนจริง มุมมน ไม่มีกรอบ/พื้น/เงา (ไม่เป็นกล่องซ้อนกล่อง)
// แถบบน: สูงไม่เกิน 36px (sm: 40px) กว้างไม่เกิน 40px (จอ < 390px) · 52px (390–639px) · 76px (sm ขึ้นไป)
//   จอ 375: ชื่อร้าน "b.oncloud.wedding content" ที่ 14px/800 กว้าง ~190px — โลโก้กว้าง 52px เหลือช่องชื่อ 181px ถูกตัด "…"
//   → กว้าง 40px เหลือ ~193px ชื่อเต็มเหมือนก่อนมีโลโก้ ; จอ 390+ ช่องชื่อกว้างขึ้น 15px จึงให้โลโก้ 52px ได้
//   ห้ามใช้ min-[390px]: — tailwind.config.ts มี screens แบบ raw (wide) ทำให้ Tailwind ไม่สร้างคลาส min-[*]/max-[*] เลย
//   → ใช้ variant @media แบบกำหนดเองที่มีขอบบน (max-width 639px) ไม่ไปทับค่า sm: (เขียนชื่อคลาสเต็มตรงๆ — Tailwind หาคลาสจากข้อความในไฟล์)
//   (ชื่อร้านด้านล่างจึงยัง 14px ทุกจอที่เล็กกว่า 640px — min-[390px]:text-[15px] เดิมไม่เคยถูกสร้างด้วยเหตุเดียวกัน ; ถ้าแก้ให้เป็น 15px
//    ที่จอ 390 ชื่อกว้าง ~204px จะเกินช่อง ~196px ข้างโลโก้ 52px — ต้องลดโลโก้ช่วงนั้นตาม)
// ท้ายหน้า: สูง ≤ 48px กว้าง ≤ 96px
// จองที่ให้รูปไว้ก่อน (slot) → ชื่อร้านไม่กระโดดตอนรูปโหลดเสร็จ (เน็ตช้าในแอป LINE)
// ไม่มีโลโก้ / โหลดรูปไม่ได้ → สัญลักษณ์ก้อนเมฆเดิม (ไม่มีรูปแตก)
export function ShopLogo({ shop, size = 'sm' }: { shop: WedPublicShop | null; size?: 'sm' | 'md' }) {
  const src = shop ? weddingImageUrl(shop.logo_url_path) : ''
  const box = size === 'md' ? 'h-12 w-12' : 'h-9 w-9 sm:h-10 sm:w-10'
  const logo = size === 'md'
    ? 'max-h-12 max-w-[96px] rounded-lg'
    : 'max-h-9 max-w-10 rounded-md [@media(min-width:390px)_and_(max-width:639px)]:max-w-[52px] sm:max-h-10 sm:max-w-[76px] sm:rounded-lg'
  const slot = size === 'md'
    ? 'h-12 w-24'
    : 'h-9 w-10 [@media(min-width:390px)_and_(max-width:639px)]:w-[52px] sm:h-10 sm:w-[76px]'
  return <WeddingLogo src={src} className={logo} slot={slot} fallback={<WeddingMark size="md" className={box} />} />
}

export default function PortalShell({ shop, children }: { shop: WedPublicShop | null; children: ReactNode }) {
  const contact = shop ? { phone: shop.phone, line_id: shop.line_id, line_url: shop.line_url } : null
  return (
    <>
      <header className="surface-topbar sticky top-0 pt-safe">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-4 sm:h-16 sm:px-6">
          <div className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2.5">
            <ShopLogo shop={shop} />
            <span className="min-w-0">
              {/* ชื่อร้านหนา 800 (กติกาเดียวกับชื่อหน้า/ชื่อร้านในเมนูหลังร้าน — ฟอนต์ Prompt)
                  จอแคบกว่า 390px ใช้ 14px: "b.oncloud.wedding content" ที่ 15px/800 กว้าง 204px เกินช่อง ~197px ของจอ 375 → ถูกตัด "…" */}
              <span
                className="block truncate text-[14px] font-extrabold leading-tight text-gray-900 min-[390px]:text-[15px] sm:text-base"
                title={shop?.name || undefined}
              >
                {shop?.name || 'ติดตามงาน'}
              </span>
              <span className="block truncate text-xs text-gray-500">ติดตามงานของคู่บ่าวสาว</span>
            </span>
          </div>
          {contact && <ContactButtons contact={contact} compact />}
        </div>
      </header>
      <main id="portal-main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 sm:px-6 sm:py-8">
        {children}
      </main>
      <PortalFooter shop={shop} />
    </>
  )
}

function PortalFooter({ shop }: { shop: WedPublicShop | null }) {
  if (!shop) return <footer className="pb-safe" />
  const ig = instagramHref(shop.instagram)
  const fb = facebookHref(shop.facebook)
  const tt = tiktokHref(shop.tiktok)
  const mail = emailHref(shop.email)
  const socials: { key: string; href: string; label: string; icon: ReactNode }[] = []
  if (ig) socials.push({ key: 'ig', href: ig, label: `Instagram ${handleLabel(shop.instagram)}`.trim(), icon: <Instagram {...ICON_XS} /> })
  if (fb) socials.push({ key: 'fb', href: fb, label: 'Facebook', icon: <Facebook {...ICON_XS} /> })
  if (tt) socials.push({ key: 'tt', href: tt, label: `TikTok ${handleLabel(shop.tiktok)}`.trim(), icon: <Music2 {...ICON_XS} /> })
  if (mail) socials.push({ key: 'mail', href: mail, label: shop.email ?? 'อีเมล', icon: <Mail {...ICON_XS} /> })
  return (
    <footer className="mt-6 border-t border-gray-200 bg-white pb-safe">
      <div className="mx-auto max-w-3xl space-y-3 px-4 py-6 sm:px-6">
        <div className="flex items-center gap-3">
          <ShopLogo shop={shop} size="md" />
          <div className="min-w-0">
            <p className="break-words text-base font-semibold text-gray-900">{shop.name}</p>
            {shop.tagline && <p className="break-words text-sm text-gray-600">{shop.tagline}</p>}
          </div>
        </div>
        <ContactButtons contact={{ phone: shop.phone, line_id: shop.line_id, line_url: shop.line_url }} />
        {socials.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {socials.map(s => (
              <li key={s.key} className="min-w-0">
                <a href={s.href} rel="noreferrer" referrerPolicy="no-referrer" className="link inline-flex min-h-[44px] items-center gap-1.5 break-all text-sm">
                  {s.icon}
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        )}
        {!socials.length && shop.instagram && (
          <p className="flex items-center gap-1.5 text-sm text-gray-600">
            <AtSign {...ICON_XS} />
            {shop.instagram}
          </p>
        )}
      </div>
    </footer>
  )
}
