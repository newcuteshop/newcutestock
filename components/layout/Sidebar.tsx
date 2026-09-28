'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Permissions } from '@/types'
import clsx from 'clsx'

export type NavItem = { href: string; label: string; icon: string; perm: keyof Permissions | null }

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',  label: 'ภาพรวม',         icon: '📊', perm: null },
  { href: '/products',   label: 'สินค้า',           icon: '👕', perm: 'products' },
  { href: '/stock',      label: 'รับ-จ่ายสต๊อก',   icon: '📦', perm: 'stock' },
  { href: '/sales',      label: 'บันทึกการขาย',     icon: '🛒', perm: 'sales' },
  { href: '/labels',     label: 'พิมพ์บาร์โค้ด',   icon: '🏷️', perm: 'labels' },
  { href: '/reports',    label: 'รายงาน',           icon: '📈', perm: 'reports' },
  { href: '/users',      label: 'จัดการผู้ใช้',    icon: '👥', perm: 'users' },
]

// props ที่ layout ส่งให้ทั้งเมนูเดสก์ท็อป (Sidebar) และมือถือ (MobileNav)
export type NavProps = {
  email: string
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

export function roleLabel(role: 'admin' | 'staff'): string {
  return role === 'admin' ? '👑 ผู้ดูแลระบบ' : '👤 พนักงาน'
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

// ออกจากระบบ: ล้าง session ในเครื่องนี้ แล้วโหลดหน้า /login ใหม่ทั้งหน้า
export function useLogout() {
  const [loggingOut, setLoggingOut] = useState(false)

  async function logout() {
    if (loggingOut) return
    setLoggingOut(true)
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

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col bg-white border-r border-gray-100 pt-safe pb-safe pl-safe">
      {/* Logo */}
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-600 rounded-xl flex items-center justify-center shrink-0">
            <span className="text-lg">👕</span>
          </div>
          <div className="min-w-0">
            <p className="font-bold text-gray-900 text-sm leading-tight">Stock App</p>
            <p className="text-xs text-gray-400">ระบบสต๊อกเสื้อผ้า</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav aria-label="เมนูหลัก" className="flex-1 overflow-y-auto p-3 space-y-1">
        {items.map(item => {
          const active = isActivePath(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                active
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              )}
            >
              <span className="text-base w-5 text-center" aria-hidden="true">{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* User */}
      <div className="p-3 border-t border-gray-100">
        <div className="px-3 py-2 mb-1 min-w-0">
          {fullName && <p className="text-sm font-medium text-gray-800 truncate">{fullName}</p>}
          <p className="text-xs text-gray-500 truncate" title={email}>{email}</p>
          <p className="text-xs text-gray-400 mt-0.5">{roleLabel(role)}</p>
        </div>
        <button
          type="button"
          onClick={logout}
          disabled={loggingOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
        >
          <span className="text-base w-5 text-center" aria-hidden="true">🚪</span>
          {loggingOut ? 'กำลังออกจากระบบ...' : 'ออกจากระบบ'}
        </button>
      </div>
    </aside>
  )
}
