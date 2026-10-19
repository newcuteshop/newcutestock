'use client'
import { Loader2, LogOut } from 'lucide-react'
import { useLogout } from '@/components/layout/Sidebar'
import { ICON_SM } from '@/components/theme/icons'

// ปุ่มออกจากระบบของหน้าเลือกร้าน (ใช้ตัวออกจากระบบเดียวกับเมนูข้าง — ล้างธงประตูเข้าระบบ + session ในเครื่องนี้)
export default function LogoutButton({ variant = 'ghost' }: { variant?: 'ghost' | 'secondary' }) {
  const { loggingOut, logout } = useLogout()
  return (
    <button
      type="button"
      onClick={logout}
      disabled={loggingOut}
      className={variant === 'secondary' ? 'btn-secondary' : 'btn-ghost text-red-700'}
    >
      {loggingOut ? <Loader2 {...ICON_SM} className="animate-spin" /> : <LogOut {...ICON_SM} />}
      {loggingOut ? 'กำลังออกจากระบบ...' : 'ออกจากระบบ'}
    </button>
  )
}
