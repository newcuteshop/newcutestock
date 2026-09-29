'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { LogOut, Menu, X } from 'lucide-react'
import { displayLogin } from '@/lib/auth/credentials'
import BrandMark from '@/components/theme/BrandMark'
import MotionToggle from '@/components/theme/MotionToggle'
import { TopbarPetals } from '@/components/theme/PetalLayer'
import { ICON, ICON_LG } from '@/components/theme/icons'
import { NavLinks, useLogout, UserPill, visibleNavItems, type NavProps } from './Sidebar'

const DRAWER_ID = 'mobile-nav-drawer'

// แถบบน + ลิ้นชักเมนูสำหรับมือถือ (ซ่อนตั้งแต่ md ขึ้นไป ซึ่งใช้ Sidebar แทน)
export default function MobileNav({ email, fullName, role, permissions }: NavProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const { loggingOut, logout } = useLogout()
  const items = visibleNavItems(permissions, role)
  const login = displayLogin(email)

  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef(false)

  // ปิดโดยผู้ใช้ (ปุ่มปิด / แตะพื้นหลัง / Esc) → คืนโฟกัสให้ปุ่มเมนู
  function closeDrawer() {
    restoreFocusRef.current = true
    setOpen(false)
  }

  // เปลี่ยนหน้าแล้วปิดลิ้นชักเสมอ
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) {
      if (restoreFocusRef.current) {
        restoreFocusRef.current = false
        menuButtonRef.current?.focus()
      }
      return
    }

    // ล็อกการเลื่อนหน้าข้างหลังขณะเปิดลิ้นชัก
    const { body } = document
    const prevOverflow = body.style.overflow
    body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        restoreFocusRef.current = true
        setOpen(false)
        return
      }
      // วนโฟกัสอยู่ในลิ้นชัก (iPad + คีย์บอร์ด)
      if (e.key !== 'Tab' || !panelRef.current) return
      const focusables = panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    // หมุนจอ/ขยายจนถึงขนาด md → ใช้ Sidebar แทน ปิดลิ้นชัก
    function onResize() {
      if (window.innerWidth >= 768) setOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  return (
    <>
      {/* Top bar — สีนมเดียวกับแถบเบราว์เซอร์ (themeColor) ขอบล่างหยักห้อยลงมา 11px วาดใน .surface-topbar (แตะทะลุได้) */}
      <header className="surface-topbar md:hidden shrink-0 pt-safe pl-safe pr-safe">
        <div className="relative h-14 flex items-center gap-1 px-2">
          {/* กลีบกุหลาบลอยผ่านที่ว่างด้านขวาของแถบ (ตกแต่ง แตะทะลุ) — กล่องเริ่มหลัง 220px จากซ้าย จึงไม่ทับปุ่มเมนู/ชื่อร้าน */}
          <TopbarPetals />
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-label="เปิดเมนู"
            aria-expanded={open}
            aria-controls={DRAWER_ID}
            className="btn-icon btn-icon-plain"
          >
            <Menu {...ICON_LG} />
          </button>
          <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0 min-h-[44px] pr-3 rounded-full">
            <BrandMark size="sm" />
            {/* ชื่อร้าน 2 บรรทัด — จบก่อน 220px จากซ้าย (ที่กลีบกุหลาบเริ่มลอย) แม้จอ 320px */}
            <span className="min-w-0">
              <span className="block font-display text-lg font-bold leading-tight tracking-wide text-gray-900">NEWCUTE</span>
              <span className="block truncate text-xs text-gray-500">ระบบสต๊อกสินค้าเสื้อผ้า</span>
            </span>
          </Link>
        </div>
      </header>

      {/* Drawer */}
      <div
        id={DRAWER_ID}
        className={clsx(
          'md:hidden fixed inset-0 z-50',
          // เปิด: แสดงทันที (โฟกัสปุ่มปิดได้เลย) / ปิด: ค้าง visible 200ms ให้แอนิเมชันเลื่อนออกจบก่อนซ่อน
          open ? 'visible' : 'invisible transition-[visibility] duration-200',
          // ปิดอยู่: พักแสงวิ่งบนเมนูที่เลือกในลิ้นชักที่มองไม่เห็น (ประหยัดแบตมือถือ)
          !open && '[&_*::before]:![animation-play-state:paused] [&_*::after]:![animation-play-state:paused]'
        )}
        aria-hidden={!open}
      >
        {/* Backdrop */}
        <button
          type="button"
          tabIndex={-1}
          aria-label="ปิดเมนู"
          onClick={closeDrawer}
          className={clsx(
            'scrim absolute inset-0 w-full h-full transition-opacity duration-200 motion-reduce:transition-none',
            open ? 'opacity-100' : 'opacity-0'
          )}
        />

        {/* Panel — พื้นบลัช + ขอบขวาหยักแบบเดียวกับเมนูข้าง (ขอบขวาเว้น >= 24px ให้พ้นลอนหยัก) */}
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="เมนูหลัก"
          className={clsx(
            'surface-sidebar absolute inset-y-0 left-0 w-72 max-w-[85vw] flex flex-col pt-safe pb-safe pl-safe',
            'transition-transform duration-200 ease-out motion-reduce:transition-none',
            open ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          {/* Header */}
          <div className="h-16 flex items-center justify-between gap-2 pl-4 pr-6 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <BrandMark />
              <div className="min-w-0">
                <p className="font-display text-lg font-bold leading-tight tracking-wide text-gray-900">NEWCUTE</p>
                <p className="truncate text-xs text-gray-500">ระบบสต๊อกสินค้าเสื้อผ้า</p>
              </div>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closeDrawer}
              aria-label="ปิดเมนู"
              className="btn-icon btn-icon-plain"
            >
              <X {...ICON_LG} />
            </button>
          </div>

          {/* User */}
          <div className="pl-3 pr-6 pt-1 pb-3 shrink-0">
            <UserPill fullName={fullName} login={login} role={role} />
          </div>

          {/* Nav — เมนูที่เลือกอยู่ (aria-current) เป็นแคปซูลลูกกวาดเองจาก .nav-item */}
          <nav aria-label="เมนูหลัก" className="flex-1 overflow-y-auto overscroll-contain pl-3 pr-6 py-1 space-y-1">
            <NavLinks items={items} pathname={pathname} className="text-base" onNavigate={() => setOpen(false)} />
          </nav>

          {/* สวิตช์เอฟเฟกต์ + ออกจากระบบ */}
          <div className="pl-3 pr-6 pt-2 pb-4 space-y-1 shrink-0">
            <MotionToggle />
            <button
              type="button"
              onClick={logout}
              disabled={loggingOut}
              className="nav-item w-full text-base text-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <LogOut {...ICON} />
              {loggingOut ? 'กำลังออกจากระบบ...' : 'ออกจากระบบ'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
