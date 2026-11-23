'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { LogOut, Menu, X } from 'lucide-react'
import { displayLogin } from '@/lib/auth/credentials'
import { ICON, ICON_LG } from '@/components/theme/icons'
import {
  NavLinks, ShopBrand, shopHomeHref, showSwitchShop, SwitchShopLink, useLogout, UserPill, visibleNavItems, type NavProps,
} from './Sidebar'

const DRAWER_ID = 'mobile-nav-drawer'

// แถบบน + ลิ้นชักเมนูสำหรับมือถือ (ซ่อนตั้งแต่ md ขึ้นไป ซึ่งใช้ Sidebar แทน)
export default function MobileNav({
  email, fullName, role, permissions, shop = 'newcute', shopName, canSwitchShop = false, badges,
}: NavProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const { loggingOut, logout } = useLogout()
  const items = visibleNavItems(permissions, role, shop)
  const login = displayLogin(email)
  // มีตัวเลขแจ้งเตือนบนเมนูที่มองเห็นอยู่ไหม → จุดเล็กบนปุ่มเปิดเมนู (ตัวเลขจริงอยู่ในลิ้นชัก)
  const hasBadge = items.some(item => {
    const n = item.badge ? badges?.[item.badge] : undefined
    return typeof n === 'number' && Number.isFinite(n) && n > 0
  })

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
      {/* Top bar — ขาวเดียวกับแถบเบราว์เซอร์ (themeColor) + เส้นล่างบาง 1px (.surface-topbar) */}
      <header className="surface-topbar md:hidden shrink-0 pt-safe pl-safe pr-safe">
        <div className="h-14 flex items-center gap-1 px-2">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-label={hasBadge ? 'เปิดเมนู (มีรายการรอดำเนินการ)' : 'เปิดเมนู'}
            aria-expanded={open}
            aria-controls={DRAWER_ID}
            className="btn-icon btn-icon-plain relative"
          >
            <Menu {...ICON_LG} />
            {hasBadge && (
              <span aria-hidden="true" className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-brand-600 ring-2 ring-white" />
            )}
          </button>
          <Link href={shopHomeHref(shop)} className="flex items-center gap-2.5 min-w-0 min-h-[44px] pr-3 rounded-lg">
            {/* ชื่อร้าน 2 บรรทัด (บรรทัดล่างตัดด้วย … เมื่อจอแคบ) */}
            <ShopBrand shop={shop} shopName={shopName} compact />
          </Link>
        </div>
      </header>

      {/* Drawer */}
      <div
        id={DRAWER_ID}
        className={clsx(
          'md:hidden fixed inset-0 z-50',
          // เปิด: แสดงทันที (โฟกัสปุ่มปิดได้เลย) / ปิด: ค้าง visible 200ms ให้แอนิเมชันเลื่อนออกจบก่อนซ่อน
          open ? 'visible' : 'invisible transition-[visibility] duration-200'
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

        {/* Panel — พื้น + เส้นขวาบาง แบบเดียวกับเมนูข้าง (.surface-sidebar: NEWCUTE ขาว · ร้านเช่าฟ้าจาง ธีม #18) */}
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
          <div className="h-16 flex items-center justify-between gap-2 pl-4 pr-2 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <ShopBrand shop={shop} shopName={shopName} />
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
          <div className="px-3 pt-1 pb-3 shrink-0">
            <UserPill fullName={fullName} login={login} role={role} />
          </div>

          {/* Nav — เมนูที่เลือกอยู่ (aria-current) = พื้นโรสโกลด์อ่อน + ตัวอักษรโรสโกลด์เข้ม (มาจาก .nav-item เอง) */}
          <nav aria-label="เมนูหลัก" className="flex-1 overflow-y-auto overscroll-contain px-3 py-1 space-y-1">
            <NavLinks items={items} pathname={pathname} className="text-base" onNavigate={() => setOpen(false)} badges={badges} />
          </nav>

          {/* เปลี่ยนร้าน + ออกจากระบบ (คั่นจากเมนูด้วยเส้นบาง) */}
          <div className="shrink-0 border-t border-side-sep px-3 pt-3 pb-4 space-y-1">
            {showSwitchShop({ canSwitchShop, role, permissions }) && <SwitchShopLink className="text-base" onNavigate={() => setOpen(false)} />}
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
