'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  ArrowDownUp,
  BarChart3,
  Crown,
  LayoutDashboard,
  LogOut,
  PlugZap,
  ReceiptText,
  ScanBarcode,
  Shirt,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Permissions } from '@/types'
import { displayLogin } from '@/lib/auth/credentials'
import { clearEnteredThisWindow } from '@/lib/auth/entry-gate'
import BrandMark from '@/components/theme/BrandMark'
import { ICON, ICON_SM } from '@/components/theme/icons'

// adminOnly = แสดงเฉพาะบทบาท admin (พนักงานที่มีทุกสิทธิ์ก็ไม่เห็น) ; group 'settings' = อยู่ใต้หัวข้อ "ตั้งค่า"
export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  perm: keyof Permissions | null
  adminOnly?: boolean
  group?: 'settings'
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',  label: 'ภาพรวม',         icon: LayoutDashboard, perm: null },
  { href: '/products',   label: 'สินค้า',           icon: Shirt,           perm: 'products' },
  { href: '/stock',      label: 'รับ-จ่ายสต๊อก',   icon: ArrowDownUp,     perm: 'stock' },
  { href: '/sales',      label: 'บันทึกการขาย',     icon: ReceiptText,     perm: 'sales' },
  { href: '/labels',     label: 'พิมพ์บาร์โค้ด',   icon: ScanBarcode,     perm: 'labels' },
  { href: '/reports',    label: 'รายงาน',           icon: BarChart3,       perm: 'reports' },
  { href: '/users',      label: 'จัดการผู้ใช้',    icon: Users,           perm: 'users' },
  { href: '/settings/integrations', label: 'ตั้งค่าการเชื่อมต่อ', icon: PlugZap, perm: null, adminOnly: true, group: 'settings' },
]

// props ที่ layout ส่งให้ทั้งเมนูเดสก์ท็อป (Sidebar) และมือถือ (MobileNav)
export type NavProps = {
  email: string // อีเมลใน Auth — แสดงผลผ่าน displayLogin() (max@newcute.com → max)
  fullName: string | null
  role: 'admin' | 'staff'
  permissions: Permissions
}

// role ไม่ส่งมา = ถือเป็นพนักงาน (ซ่อนเมนูแอดมิน — fail closed)
export function visibleNavItems(permissions: Permissions, role: NavProps['role'] = 'staff'): NavItem[] {
  return NAV_ITEMS.filter(item => (!item.adminOnly || role === 'admin') && (!item.perm || permissions[item.perm]))
}

// เมนูหลัก + กลุ่ม "ตั้งค่า" (หัวข้อเล็กคั่น) — ใช้ทั้งเมนูข้างและลิ้นชักมือถือ
export function NavLinks({
  items, pathname, className, onNavigate,
}: {
  items: NavItem[]
  pathname: string | null
  className?: string
  onNavigate?: () => void
}) {
  const main = items.filter(item => !item.group)
  const settings = items.filter(item => item.group === 'settings')
  const link = (item: NavItem) => {
    const Icon = item.icon
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        aria-current={isActivePath(pathname, item.href) ? 'page' : undefined}
        className={className ? `nav-item ${className}` : 'nav-item'}
      >
        <Icon {...ICON} />
        <span>{item.label}</span>
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
      <span className="icon-bubble icon-bubble-sm rounded-full text-sm font-semibold text-gray-900" aria-hidden="true">
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

// ออกจากระบบ: ล้าง session ในเครื่องนี้ แล้วโหลดหน้า /login ใหม่ทั้งหน้า (MobileNav ใช้ตัวเดียวกันนี้)
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

export default function Sidebar({ email, fullName, role, permissions }: NavProps) {
  const pathname = usePathname()
  const { loggingOut, logout } = useLogout()
  const items = visibleNavItems(permissions, role)
  const login = displayLogin(email)

  return (
    // พื้นขาว + เส้นขวาบาง 1px (.surface-sidebar)
    <aside className="surface-sidebar hidden md:flex w-60 shrink-0 flex-col pt-safe pb-safe pl-safe">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 pt-5 pb-4 shrink-0">
        <BrandMark />
        <div className="min-w-0">
          <p className="text-lg font-semibold leading-tight tracking-wide text-gray-900">NEWCUTE</p>
          <p className="truncate text-xs text-gray-500">ระบบสต๊อกสินค้าเสื้อผ้า</p>
        </div>
      </div>

      {/* Nav — เมนูที่เลือกอยู่ (aria-current) = พื้นโรสโกลด์อ่อน + ตัวอักษรโรสโกลด์เข้ม (มาจาก .nav-item เอง) */}
      <nav aria-label="เมนูหลัก" className="flex-1 overflow-y-auto overscroll-y-contain px-3 py-2 space-y-1">
        <NavLinks items={items} pathname={pathname} />
      </nav>

      {/* ผู้ใช้ + ออกจากระบบ (คั่นจากเมนูด้วยเส้นบาง) */}
      <div className="shrink-0 border-t border-gray-150 px-3 pt-3 pb-4 space-y-2">
        <UserPill fullName={fullName} login={login} role={role} />
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
