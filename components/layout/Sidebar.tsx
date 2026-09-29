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
import MotionToggle from '@/components/theme/MotionToggle'
import { ICON, ICON_SM } from '@/components/theme/icons'

export type NavItem = { href: string; label: string; icon: LucideIcon; perm: keyof Permissions | null }

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',  label: 'ภาพรวม',         icon: LayoutDashboard, perm: null },
  { href: '/products',   label: 'สินค้า',           icon: Shirt,           perm: 'products' },
  { href: '/stock',      label: 'รับ-จ่ายสต๊อก',   icon: ArrowDownUp,     perm: 'stock' },
  { href: '/sales',      label: 'บันทึกการขาย',     icon: ReceiptText,     perm: 'sales' },
  { href: '/labels',     label: 'พิมพ์บาร์โค้ด',   icon: ScanBarcode,     perm: 'labels' },
  { href: '/reports',    label: 'รายงาน',           icon: BarChart3,       perm: 'reports' },
  { href: '/users',      label: 'จัดการผู้ใช้',    icon: Users,           perm: 'users' },
]

// props ที่ layout ส่งให้ทั้งเมนูเดสก์ท็อป (Sidebar) และมือถือ (MobileNav)
export type NavProps = {
  email: string // อีเมลใน Auth — แสดงผลผ่าน displayLogin() (max@newcute.com → max)
  fullName: string | null
  role: 'admin' | 'staff'
  permissions: Permissions
}

export function visibleNavItems(permissions: Permissions): NavItem[] {
  return NAV_ITEMS.filter(item => !item.perm || permissions[item.perm])
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
      <span className="icon-bubble icon-bubble-sm font-display font-bold text-berry" aria-hidden="true">
        {initial || <UserRound {...ICON_SM} />}
      </span>
      <div className="min-w-0 flex-1 leading-normal">
        <p className="text-sm font-bold text-gray-900 truncate" title={fullName || login}>{fullName || login}</p>
        <p className="flex items-center gap-1 min-w-0 text-xs text-gray-500">
          <RoleIcon
            size={14}
            strokeWidth={2}
            aria-hidden="true"
            className={role === 'admin' ? 'text-amber-600' : 'text-brand-700'}
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
  const items = visibleNavItems(permissions)
  const login = displayLogin(email)

  return (
    // พื้นบลัช + ขอบขวาหยักวาดใน .surface-sidebar::before — ขอบขวาเว้น >= 24px ให้พ้นลอนหยัก 12px
    <aside className="surface-sidebar hidden md:flex w-60 shrink-0 flex-col pt-safe pb-safe pl-safe">
      {/* Logo */}
      <div className="flex items-center gap-3 pl-5 pr-7 pt-6 pb-4 shrink-0">
        <BrandMark />
        <div className="min-w-0">
          <p className="font-display text-lg font-bold leading-tight tracking-wide text-gray-900">NEWCUTE</p>
          <p className="truncate text-xs text-gray-500">ระบบสต๊อกสินค้าเสื้อผ้า</p>
        </div>
      </div>

      {/* Nav — เมนูที่เลือกอยู่ (aria-current) เป็นแคปซูลลูกกวาดเองจาก .nav-item */}
      <nav aria-label="เมนูหลัก" className="flex-1 overflow-y-auto overscroll-y-contain pl-3 pr-6 py-2 space-y-1">
        {items.map(item => {
          const active = isActivePath(pathname, item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className="nav-item"
            >
              <Icon {...ICON} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* สวิตช์เอฟเฟกต์ + ผู้ใช้ + ออกจากระบบ */}
      <div className="shrink-0 pl-3 pr-6 pt-2 pb-4 space-y-2">
        <MotionToggle />
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
