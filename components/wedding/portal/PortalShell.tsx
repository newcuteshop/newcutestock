// ===== โครงหน้าติดตามงานของคู่บ่าวสาว: แถบบน (โลโก้/ชื่อร้าน/ปุ่มติดต่อ) + เนื้อหา + ท้ายหน้า (ข้อมูลร้าน) =====
// ใช้ได้ทั้ง server และ client component (ไม่มี state) — ข้อมูลร้านมาจาก wed_public_booking.shop (ห้าม hardcode ชื่อร้าน)
// ไม่รู้ข้อมูลร้าน (ลิงก์ผิด/ระบบยังไม่พร้อม) → แถบบนแสดงสัญลักษณ์ร้าน + "ติดตามงาน" อย่างเดียว
// กติกาเบราว์เซอร์ในแอป LINE: ลิงก์ทุกตัวเปิดในหน้าเดิม (ไม่มี target=_blank) และไม่ส่ง referrer (URL มีโทเคน)
import type { ReactNode } from 'react'
import { AtSign, Facebook, Instagram, Mail, Music2 } from 'lucide-react'
import { ICON_XS } from '@/components/theme/icons'
import WeddingMark from '@/components/theme/WeddingMark'
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

export function ShopLogo({ shop, size = 'sm' }: { shop: WedPublicShop | null; size?: 'sm' | 'md' }) {
  const src = shop ? weddingImageUrl(shop.logo_url_path) : ''
  const box = size === 'md' ? 'h-12 w-12' : 'h-9 w-9 sm:h-10 sm:w-10'
  if (!src) return <WeddingMark size="md" className={box} />
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={`${box} shrink-0 rounded-lg border border-gray-200 bg-white object-contain`} />
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
              <span className="block truncate text-[15px] font-semibold leading-tight text-gray-900 sm:text-base">
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
