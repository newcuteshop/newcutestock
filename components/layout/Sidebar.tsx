'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  ArrowDownUp,
  ArrowLeftRight,
  BarChart3,
  Calculator,
  CalendarDays,
  Clapperboard,
  ClipboardCheck,
  ClipboardList,
  Contact,
  Crown,
  History,
  LayoutDashboard,
  LogOut,
  Package,
  PlugZap,
  ReceiptText,
  ScanBarcode,
  Settings,
  Shirt,
  Store,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { countAccessibleShops, type Permissions } from '@/types'
import { displayLogin } from '@/lib/auth/credentials'
import { clearEnteredThisWindow } from '@/lib/auth/entry-gate'
import { DEFAULT_RENTAL_SHOP_NAME } from '@/lib/rental'
import { DEFAULT_WEDDING_SHOP_NAME } from '@/lib/wedding'
import BrandMark from '@/components/theme/BrandMark'
import RentalMark from '@/components/theme/RentalMark'
import WeddingMark from '@/components/theme/WeddingMark'
import { ICON, ICON_SM } from '@/components/theme/icons'

// ร้านที่เมนูชุดนี้เป็นของ — NEWCUTE (ขายเสื้อผ้า), ร้านเช่าชุด (/rental/*) หรือร้าน b.oncloud คอนเทนต์งานแต่ง (/wedding/*)
export type ShopKey = 'newcute' | 'rental' | 'wedding'

// ตัวเลขแจ้งเตือนบนเมนู — ไม่มี/0 = ไม่แสดง
// ร้านเช่า: จาก rental_badges() ที่ layout ร้านเช่าโหลด
// ร้าน b.oncloud: จาก wed_badges() ที่ layout /wedding โหลด — wed_bookings = ลูกค้าถึงวันติดตาม + ล็อกคิวจะหมดใน 24 ชม.,
//   wed_deliverables = ชิ้นงานเลยกำหนดส่ง, wed_installments = งวดชำระเลยกำหนด
export type NavBadgeKey = 'pending_online' | 'slips' | 'overdue' | 'wed_bookings' | 'wed_deliverables' | 'wed_installments'
export type NavBadges = Partial<Record<NavBadgeKey, number>>

// adminOnly = แสดงเฉพาะบทบาท admin (พนักงานที่มีทุกสิทธิ์ก็ไม่เห็น) ; group 'settings' = อยู่ใต้หัวข้อ "ตั้งค่า"
// badge = คีย์ตัวเลขแจ้งเตือนที่แสดงท้ายเมนู
export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  perm: keyof Permissions | null
  adminOnly?: boolean
  group?: 'settings'
  badge?: NavBadgeKey
}

// เมนูย่อยที่ path ซ้อนกัน (/stock กับ /stock/count, /sales กับ /sales/bills) — เมนูที่ตรงยาวที่สุดเท่านั้นที่ถูกเลือก (activeNavHref)
// ประวัติบิล/ปิดยอดใช้สิทธิ์ sales (ปุ่มยกเลิกบิล/คืนสินค้าข้างในต้องมีสิทธิ์ refunds เพิ่ม)
export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',    label: 'ภาพรวม',               icon: LayoutDashboard, perm: null },
  { href: '/products',     label: 'สินค้า',                 icon: Shirt,           perm: 'products' },
  { href: '/stock',        label: 'รับ-จ่ายสต๊อก',         icon: ArrowDownUp,     perm: 'stock' },
  { href: '/stock/count',  label: 'ตรวจนับสต๊อก',          icon: ClipboardCheck,  perm: 'stock' },
  { href: '/sales',        label: 'บันทึกการขาย',           icon: ReceiptText,     perm: 'sales' },
  { href: '/sales/bills',  label: 'ประวัติบิล / คืนสินค้า', icon: History,         perm: 'sales' },
  { href: '/sales/close',  label: 'ปิดยอดประจำวัน',         icon: Calculator,      perm: 'sales' },
  { href: '/labels',       label: 'พิมพ์บาร์โค้ด',         icon: ScanBarcode,     perm: 'labels' },
  { href: '/reports',      label: 'รายงาน',                 icon: BarChart3,       perm: 'reports' },
  { href: '/users',        label: 'จัดการผู้ใช้',          icon: Users,           perm: 'users' },
  { href: '/settings/integrations', label: 'ตั้งค่าการเชื่อมต่อ', icon: PlugZap, perm: null, adminOnly: true, group: 'settings' },
  { href: '/settings/shop', label: 'ข้อมูลร้าน / ใบเสร็จ', icon: Store, perm: null, adminOnly: true, group: 'settings' },
]

// เมนูร้านเช่าชุด — layout ร้านเช่า (app/(rental)/rental/layout.tsx) กันคนไม่มีสิทธิ์ร้านเช่าออกไปแล้ว
// จึงใช้ perm null กับเมนูพนักงาน (rental หรือ rental_manage เข้าได้ทั้งคู่) ; เมนูผู้จัดการใช้ 'rental_manage'
// (admin ได้ ADMIN_PERMISSIONS ที่ rental_manage = true อยู่แล้ว)
export const RENTAL_NAV_ITEMS: NavItem[] = [
  { href: '/rental',           label: 'ภาพรวมวันนี้',        icon: LayoutDashboard, perm: null },
  // ป้ายสั้น: เมนูที่เลือกอยู่ (ตัวหนา) + ตัวเลขแจ้งเตือนต้องอยู่บรรทัดเดียวในเมนูกว้าง 15rem (ชื่อเต็มอยู่ที่หัวหน้า)
  { href: '/rental/bookings',  label: 'การจอง/สัญญา',       icon: ClipboardList,   perm: null, badge: 'pending_online' },
  { href: '/rental/calendar',  label: 'ปฏิทิน',              icon: CalendarDays,    perm: null },
  { href: '/rental/items',     label: 'ชุดเช่า',              icon: Shirt,           perm: null },
  { href: '/rental/customers', label: 'ลูกค้า',               icon: Contact,         perm: null },
  { href: '/rental/payments',  label: 'การเงิน',              icon: Wallet,          perm: null, badge: 'slips' },
  { href: '/rental/reports',   label: 'รายงาน',               icon: BarChart3,       perm: 'rental_manage' },
  { href: '/rental/settings',  label: 'ตั้งค่าร้านเช่า',      icon: Settings,        perm: 'rental_manage', group: 'settings' },
]

// เมนูร้าน b.oncloud (คอนเทนต์งานแต่ง) — layout /wedding (app/(wedding)/wedding/layout.tsx) กันคนไม่มีสิทธิ์ร้านนี้ออกไปแล้ว
// จึงใช้ perm null กับเมนูพนักงาน (wedding หรือ wedding_manage) ; เมนูผู้จัดการใช้ 'wedding_manage' (admin ได้ true อยู่แล้ว)
// ป้ายสั้นให้เมนูที่เลือก (ตัวหนา) + ตัวเลขแจ้งเตือนอยู่บรรทัดเดียวในเมนูกว้าง 15rem
export const WEDDING_NAV_ITEMS: NavItem[] = [
  { href: '/wedding',              label: 'ภาพรวม',          icon: LayoutDashboard, perm: null },
  { href: '/wedding/calendar',     label: 'ปฏิทินงาน',       icon: CalendarDays,    perm: null },
  { href: '/wedding/bookings',     label: 'งาน/การจอง',      icon: ClipboardList,   perm: null, badge: 'wed_bookings' },
  { href: '/wedding/deliverables', label: 'ส่งงาน/ตัดต่อ',   icon: Clapperboard,    perm: null, badge: 'wed_deliverables' },
  { href: '/wedding/customers',    label: 'ลูกค้า',           icon: Contact,         perm: null },
  { href: '/wedding/crew',         label: 'ทีมงาน',           icon: Users,           perm: null },
  { href: '/wedding/payments',     label: 'การเงิน',          icon: Wallet,          perm: null, badge: 'wed_installments' },
  { href: '/wedding/packages',     label: 'แพ็กเกจ',          icon: Package,         perm: 'wedding_manage' },
  { href: '/wedding/reports',      label: 'รายงาน',           icon: BarChart3,       perm: 'wedding_manage' },
  { href: '/wedding/settings',     label: 'ตั้งค่าร้าน',      icon: Settings,        perm: 'wedding_manage', group: 'settings' },
]

// props ที่ layout ส่งให้ทั้งเมนูเดสก์ท็อป (Sidebar) และมือถือ (MobileNav)
export type NavProps = {
  email: string // อีเมลใน Auth — แสดงผลผ่าน displayLogin() (max@newcute.com → max)
  fullName: string | null
  role: 'admin' | 'staff'
  permissions: Permissions
  // ----- ร้าน (ไม่ส่ง = NEWCUTE แบบเดิมทุกอย่าง) -----
  shop?: ShopKey
  shopName?: string        // ชื่อร้านจากการตั้งค่า: rental_settings.shop_name / wed_settings.shop_name (ร้าน NEWCUTE ไม่ใช้)
  canSwitchShop?: boolean  // เข้าได้ตั้งแต่ 2 ร้าน → แสดงลิงก์ "เปลี่ยนร้าน" (/select)
  badges?: NavBadges
}

// role ไม่ส่งมา = ถือเป็นพนักงาน (ซ่อนเมนูแอดมิน — fail closed) ; shop ไม่ส่งมา = เมนู NEWCUTE
export function visibleNavItems(permissions: Permissions, role: NavProps['role'] = 'staff', shop: ShopKey = 'newcute'): NavItem[] {
  const list = shop === 'rental' ? RENTAL_NAV_ITEMS : shop === 'wedding' ? WEDDING_NAV_ITEMS : NAV_ITEMS
  return list.filter(item => (!item.adminOnly || role === 'admin') && (!item.perm || permissions[item.perm]))
}

// หน้าแรกของแต่ละร้าน (ลิงก์โลโก้บนแถบมือถือ)
export function shopHomeHref(shop: ShopKey = 'newcute'): string {
  return shop === 'rental' ? '/rental' : shop === 'wedding' ? '/wedding' : '/dashboard'
}

// ตัวเลขแจ้งเตือนที่ใช้ได้ (จำนวนเต็มบวก) — อื่นๆ = ไม่แสดง
function badgeCount(badges: NavBadges | undefined, key: NavBadgeKey | undefined): number {
  if (!badges || !key) return 0
  const n = badges[key]
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

// เมนูหลัก + กลุ่ม "ตั้งค่า" (หัวข้อเล็กคั่น) — ใช้ทั้งเมนูข้างและลิ้นชักมือถือ
export function NavLinks({
  items, pathname, className, onNavigate, badges,
}: {
  items: NavItem[]
  pathname: string | null
  className?: string
  onNavigate?: () => void
  badges?: NavBadges
}) {
  const main = items.filter(item => !item.group)
  const settings = items.filter(item => item.group === 'settings')
  const activeHref = activeNavHref(items, pathname)
  const link = (item: NavItem) => {
    const Icon = item.icon
    const count = badgeCount(badges, item.badge)
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        aria-current={item.href === activeHref ? 'page' : undefined}
        className={className ? `nav-item ${className}` : 'nav-item'}
      >
        <Icon {...ICON} />
        <span>{item.label}</span>
        {count > 0 && (
          // ตัวเลขรอดำเนินการ (คำขอจองออนไลน์ / สลิปรอตรวจ) — ชิดขวา, โปรแกรมอ่านจอได้ยินเป็นคำ
          // bg-side-badge = สีของร้าน: NEWCUTE brand-600 เดิม · ร้านเช่า แดง #BF2B2B ตามตัวอย่างธีม #18 ที่บอสเลือก (ตัวอักษรขาวผ่านทั้งคู่)
          <span className="ml-auto inline-flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded-full bg-side-badge px-1.5 text-xs font-semibold tabular-nums text-white">
            <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
            <span className="sr-only">{`(รอดำเนินการ ${count} รายการ)`}</span>
          </span>
        )}
      </Link>
    )
  }
  return (
    <>
      {main.map(link)}
      {settings.length > 0 && (
        <div role="group" aria-label="ตั้งค่า" className="space-y-1 pt-4">
          <p aria-hidden="true" className="section-kicker px-3 pb-1">ตั้งค่า</p>
          {settings.map(link)}
        </div>
      )}
    </>
  )
}

export function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false
  return pathname === href || pathname.startsWith(href + '/')
}

// เมนูที่ถูกเลือก = เมนูที่ path ตรงและ href ยาวที่สุด (อยู่หน้า /sales/bills → "ประวัติบิล" ไม่ใช่ "บันทึกการขาย" ด้วย)
export function activeNavHref(items: NavItem[], pathname: string | null): string | null {
  let best: string | null = null
  for (const item of items) {
    if (isActivePath(pathname, item.href) && (best === null || item.href.length > best.length)) best = item.href
  }
  return best
}

// โลโก้ + ชื่อร้าน + คำอธิบาย (เมนูข้าง / ลิ้นชัก / แถบบนมือถือ)
// NEWCUTE = หน้าตาเดิมทุกอย่าง ; ร้านเช่า = RentalMark + ชื่อร้านจากการตั้งค่า (ชื่อยาว → ตัดด้วย …)
// ร้าน b.oncloud = WeddingMark (เมฆ บนทองแชมเปญ) + ชื่อร้านจาก wed_settings.shop_name
// สีตัวอักษร text-side-ink / text-side-muted = ตัวแปรแถบเมนูของร้าน (NEWCUTE = gray-900 / gray-500 เท่าเดิม · ร้านเช่า = ธีม #18 ฟ้าใส)
// compact = แถบบนมือถือ (โลโก้ 32px ชื่อ text-base) ; ปกติ = เมนูข้าง/ลิ้นชัก (โลโก้ 40px ชื่อ text-lg)
// ชื่อร้าน = font-extrabold (800) ทุกร้าน ตามกติกาหัวเรื่องของฟอนต์ Prompt (ชื่อหน้า + ชื่อร้าน 800 — ดู .page-title ใน app/globals.css)
export function ShopBrand({
  shop = 'newcute', shopName, compact = false,
}: {
  shop?: ShopKey
  shopName?: string
  compact?: boolean
}) {
  const title = compact ? 'text-base' : 'text-lg'
  if (shop === 'wedding') {
    const name = (shopName ?? '').trim() || DEFAULT_WEDDING_SHOP_NAME
    // ชื่อร้านนี้ยาว ("b.oncloud.wedding content" ~233px ที่ text-lg) แต่ช่องข้อความในเมนูข้าง/ลิ้นชักกว้างแค่ ~155px
    // → เมนูข้าง/ลิ้นชัก: text-base + ขึ้นบรรทัดใหม่ได้ 2 บรรทัด (เกินนั้นค่อย …) ให้เห็นชื่อเต็ม ; แถบบนมือถือคงบรรทัดเดียว
    // เฉพาะร้านนี้ — NEWCUTE / ร้านเช่า ใช้ขนาดเดิมทุกพิกเซล
    // (line-clamp-2 ตั้ง display:-webkit-box เอง — ห้ามใส่ block ซ้อน ไม่งั้นการตัด 2 บรรทัดไม่ทำงาน)
    const nameCls = compact ? `block truncate ${title}` : 'line-clamp-2 break-words text-base'
    return (
      <>
        <WeddingMark size={compact ? 'sm' : 'md'} />
        <span className="block min-w-0">
          <span className={`${nameCls} font-extrabold leading-tight text-side-ink`} title={name}>{name}</span>
          <span className="block truncate text-xs text-side-muted">ระบบคอนเทนต์งานแต่ง</span>
        </span>
      </>
    )
  }
  if (shop === 'rental') {
    const name = (shopName ?? '').trim() || DEFAULT_RENTAL_SHOP_NAME
    return (
      <>
        <RentalMark size={compact ? 'sm' : 'md'} />
        <span className="block min-w-0">
          <span className={`block truncate ${title} font-extrabold leading-tight text-side-ink`} title={name}>{name}</span>
          <span className="block truncate text-xs text-side-muted">ระบบร้านเช่าชุด</span>
        </span>
      </>
    )
  }
  return (
    <>
      <BrandMark size={compact ? 'sm' : 'md'} />
      <span className="block min-w-0">
        <span className={`block ${title} font-extrabold leading-tight tracking-wide text-side-ink`}>NEWCUTE</span>
        <span className="block truncate text-xs text-side-muted">ระบบสต๊อกสินค้าเสื้อผ้า</span>
      </span>
    </>
  )
}

// แสดงลิงก์ "เปลี่ยนร้าน" ไหม: layout บอกมา (canSwitchShop) หรือสิทธิ์ของผู้ใช้เข้าได้ตั้งแต่ 2 ร้าน
// (layout NEWCUTE/ร้านเช่าเดิมคิดแค่ 2 ร้าน — คนที่มีสิทธิ์ร้าน b.oncloud ด้วยต้องเห็นลิงก์นี้ในทุกเมนู ; คนเดิมที่ไม่มีสิทธิ์ b.oncloud ได้ผลเท่าเดิม)
export function showSwitchShop(p: Pick<NavProps, 'canSwitchShop' | 'role' | 'permissions'>): boolean {
  return p.canSwitchShop === true || countAccessibleShops(p.role, p.permissions) >= 2
}

// ลิงก์ "เปลี่ยนร้าน" กลับหน้าเลือกร้าน — แสดงเฉพาะคนที่เข้าได้ตั้งแต่ 2 ร้าน (showSwitchShop)
export function SwitchShopLink({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  return (
    <Link href="/select" onClick={onNavigate} className={className ? `nav-item w-full ${className}` : 'nav-item w-full'}>
      <ArrowLeftRight {...ICON} />
      <span>เปลี่ยนร้าน</span>
    </Link>
  )
}

// ไอคอนบทบาทแสดงแยกใน UserPill (มงกุฎ = ผู้ดูแลระบบ, คน = พนักงาน)
export function roleLabel(role: 'admin' | 'staff'): string {
  return role === 'admin' ? 'ผู้ดูแลระบบ' : 'พนักงาน'
}

// ตัวอักษรแรกของชื่อสำหรับฟองโปรไฟล์ — ข้ามสระหน้า (เ แ โ ใ ไ) ให้ได้พยัญชนะ
function initialOf(name: string): string {
  const s = name.trim().replace(/^[เแโใไ]+/, '')
  return (Array.from(s)[0] ?? '').toUpperCase()
}

// กล่องผู้ใช้ท้ายเมนู (ใช้ทั้งเมนูข้างและลิ้นชักมือถือ): ฟองตัวอักษรแรก + ชื่อ + บทบาท
export function UserPill({ fullName, login, role }: { fullName: string | null; login: string; role: NavProps['role'] }) {
  const initial = initialOf(fullName || login)
  const RoleIcon = role === 'admin' ? Crown : UserRound
  return (
    <div className="user-pill">
      {/* bg-side-avatar: NEWCUTE = brand-50 เดิม · ร้านเช่า = ฟ้า #CBE8F4 (brand-50 เท่ากับสีกล่องผู้ใช้พอดี ฟองจะหายไป) */}
      <span className="icon-bubble icon-bubble-sm rounded-full bg-side-avatar text-sm font-semibold text-gray-900" aria-hidden="true">
        {initial || <UserRound {...ICON_SM} />}
      </span>
      <div className="min-w-0 flex-1 leading-normal">
        <p className="text-sm font-semibold text-gray-900 truncate" title={fullName || login}>{fullName || login}</p>
        <p className="flex items-center gap-1 min-w-0 text-xs text-gray-500">
          <RoleIcon
            size={14}
            strokeWidth={2}
            aria-hidden="true"
            className={role === 'admin' ? 'text-amber-600' : 'text-brand-600'}
          />
          <span className="shrink-0">{roleLabel(role)}</span>
          {/* มีชื่อจริง → ชื่อผู้ใช้ย้ายมาบรรทัดนี้ */}
          {fullName && <span className="min-w-0 truncate" title={login}>· {login}</span>}
        </p>
      </div>
    </div>
  )
}

// ลบคุกกี้ session ของ Supabase ในเครื่อง (สำรองไว้กรณี signOut เรียกเซิร์ฟเวอร์ไม่สำเร็จ)
function clearSupabaseCookies() {
  try {
    document.cookie.split(';').forEach(part => {
      const name = part.split('=')[0]?.trim()
      if (name && name.startsWith('sb-')) {
        document.cookie = `${name}=; Max-Age=0; path=/`
      }
    })
  } catch {
    // ไม่เป็นไร
  }
}

// ออกจากระบบ: ล้าง session ในเครื่องนี้ แล้วโหลดหน้า /login ใหม่ทั้งหน้า (MobileNav และหน้าเลือกร้านใช้ตัวเดียวกันนี้)
export function useLogout() {
  const [loggingOut, setLoggingOut] = useState(false)

  async function logout() {
    if (loggingOut) return
    setLoggingOut(true)
    // ลืมการเข้าสู่ระบบของหน้าต่างนี้ด้วย (ธงประตูเข้าระบบ — lib/auth/entry-gate.ts)
    clearEnteredThisWindow()
    try {
      const { error } = await createClient().auth.signOut({ scope: 'local' })
      if (error) clearSupabaseCookies()
    } catch {
      clearSupabaseCookies()
    }
    window.location.href = '/login'
  }

  return { loggingOut, logout }
}

export default function Sidebar({
  email, fullName, role, permissions, shop = 'newcute', shopName, canSwitchShop = false, badges,
}: NavProps) {
  const pathname = usePathname()
  const { loggingOut, logout } = useLogout()
  const items = visibleNavItems(permissions, role, shop)
  const login = displayLogin(email)

  return (
    // พื้นตามร้าน + เส้นขวาบาง 1px (.surface-sidebar) — NEWCUTE ขาว · ร้านเช่าฟ้าจาง (ธีม #18 แถบเมนูสีตามธีม 22/10/2569)
    <aside className="surface-sidebar hidden md:flex w-60 shrink-0 flex-col pt-safe pb-safe pl-safe">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 pt-5 pb-4 shrink-0">
        <ShopBrand shop={shop} shopName={shopName} />
      </div>

      {/* Nav — เมนูที่เลือกอยู่ (aria-current) = พื้นเน้นอ่อน + ตัวอักษรเน้นเข้มของร้าน (มาจาก .nav-item เอง → --c-side-active*) */}
      <nav aria-label="เมนูหลัก" className="flex-1 overflow-y-auto overscroll-y-contain px-3 py-2 space-y-1">
        <NavLinks items={items} pathname={pathname} badges={badges} />
      </nav>

      {/* ผู้ใช้ + เปลี่ยนร้าน + ออกจากระบบ (คั่นจากเมนูด้วยเส้นบาง) */}
      <div className="shrink-0 border-t border-side-sep px-3 pt-3 pb-4 space-y-2">
        <UserPill fullName={fullName} login={login} role={role} />
        {showSwitchShop({ canSwitchShop, role, permissions }) && <SwitchShopLink />}
        <button
          type="button"
          onClick={logout}
          disabled={loggingOut}
          className="nav-item w-full text-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <LogOut {...ICON} />
          {loggingOut ? 'กำลังออกจากระบบ...' : 'ออกจากระบบ'}
        </button>
      </div>
    </aside>
  )
}
