'use client'
import clsx from 'clsx'
import { Loader2, LogOut } from 'lucide-react'
import { useLogout } from '@/components/layout/Sidebar'
import { ICON_SM } from '@/components/theme/icons'

// ปุ่มออกจากระบบของหน้าเลือกร้าน (ใช้ตัวออกจากระบบเดียวกับเมนูข้าง — ล้างธงประตูเข้าระบบ + session ในเครื่องนี้)
// className = ขนาดเพิ่มตามที่วาง (หน้าเลือกร้านจอใหญ่ขยายปุ่มให้เข้าสัดส่วนการ์ด)
export default function LogoutButton({ variant = 'ghost', className }: { variant?: 'ghost' | 'secondary'; className?: string }) {
  const { loggingOut, logout } = useLogout()
  return (
    <button
      type="button"
      onClick={logout}
      disabled={loggingOut}
      className={clsx(variant === 'secondary' ? 'btn-secondary' : 'btn-ghost text-red-700', className)}
    >
      {loggingOut ? <Loader2 {...ICON_SM} className="animate-spin" /> : <LogOut {...ICON_SM} />}
      {loggingOut ? 'กำลังออกจากระบบ...' : 'ออกจากระบบ'}
    </button>
  )
}
