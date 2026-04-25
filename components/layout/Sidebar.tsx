'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import clsx from 'clsx'

const navItems = [
  { href: '/dashboard',  label: 'ภาพรวม',         icon: '📊' },
  { href: '/products',   label: 'สินค้า',           icon: '👕' },
  { href: '/stock',      label: 'รับ-จ่ายสต๊อก',   icon: '📦' },
  { href: '/sales',      label: 'บันทึกการขาย',     icon: '🛒' },
  { href: '/reports',    label: 'รายงาน',           icon: '📈' },
]

export default function Sidebar({ user }: { user: User }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="w-60 bg-white border-r border-gray-100 flex flex-col shrink-0">
      {/* Logo */}
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-600 rounded-xl flex items-center justify-center">
            <span className="text-lg">👕</span>
          </div>
          <div>
            <p className="font-bold text-gray-900 text-sm leading-tight">Stock App</p>
            <p className="text-xs text-gray-400">ระบบสต๊อกเสื้อผ้า</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
              pathname === item.href || pathname.startsWith(item.href + '/')
                ? 'bg-brand-50 text-brand-700'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            )}
          >
            <span className="text-base w-5 text-center">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      {/* User */}
      <div className="p-3 border-t border-gray-100">
        <div className="px-3 py-2 mb-1">
          <p className="text-xs text-gray-500 truncate">{user.email}</p>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-red-500 hover:bg-red-50 transition-colors"
        >
          <span className="text-base w-5 text-center">🚪</span>
          ออกจากระบบ
        </button>
      </div>
    </aside>
  )
}
