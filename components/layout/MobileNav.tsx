'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { isActivePath, roleLabel, useLogout, visibleNavItems, type NavProps } from './Sidebar'

const DRAWER_ID = 'mobile-nav-drawer'

// แถบบน + ลิ้นชักเมนูสำหรับมือถือ (ซ่อนตั้งแต่ md ขึ้นไป ซึ่งใช้ Sidebar แทน)
export default function MobileNav({ email, fullName, role, permissions }: NavProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const { loggingOut, logout } = useLogout()
  const items = visibleNavItems(permissions)

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
      {/* Top bar */}
      <header className="md:hidden shrink-0 bg-white border-b border-gray-100 pt-safe pl-safe pr-safe">
        <div className="h-14 flex items-center gap-2 px-2">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-label="เปิดเมนู"
            aria-expanded={open}
            aria-controls={DRAWER_ID}
            className="h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 active:bg-gray-200 transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <Link href="/dashboard" className="flex items-center gap-2 min-w-0 min-h-[44px]">
            <span className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center shrink-0" aria-hidden="true">
              <span className="text-base">👕</span>
            </span>
            <span className="font-bold text-gray-900 truncate">Stock App</span>
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
            'absolute inset-0 w-full h-full bg-gray-900/40 transition-opacity duration-200 motion-reduce:transition-none',
            open ? 'opacity-100' : 'opacity-0'
          )}
        />

        {/* Panel */}
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="เมนูหลัก"
          className={clsx(
            'absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl flex flex-col pt-safe pb-safe pl-safe',
            'transition-transform duration-200 ease-out motion-reduce:transition-none',
            open ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          {/* Header */}
          <div className="h-14 flex items-center justify-between gap-2 pl-4 pr-2 border-b border-gray-100 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center shrink-0" aria-hidden="true">
                <span className="text-base">👕</span>
              </span>
              <div className="min-w-0">
                <p className="font-bold text-gray-900 text-sm leading-tight">Stock App</p>
                <p className="text-xs text-gray-400">ระบบสต๊อกเสื้อผ้า</p>
              </div>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closeDrawer}
              aria-label="ปิดเมนู"
              className="h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 active:bg-gray-200 transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          {/* User */}
          <div className="px-4 py-3 border-b border-gray-100 min-w-0 shrink-0">
            {fullName && <p className="text-sm font-medium text-gray-800 truncate">{fullName}</p>}
            <p className="text-xs text-gray-500 truncate">{email}</p>
            <p className="text-xs text-gray-400 mt-0.5">{roleLabel(role)}</p>
          </div>

          {/* Nav */}
          <nav aria-label="เมนูหลัก" className="flex-1 overflow-y-auto overscroll-contain p-3 space-y-1">
            {items.map(item => {
              const active = isActivePath(pathname, item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(
                    'flex items-center gap-3 px-3 min-h-[44px] rounded-lg text-base font-medium transition-colors',
                    active
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-gray-700 hover:bg-gray-50 active:bg-gray-100'
                  )}
                >
                  <span className="text-lg w-6 text-center" aria-hidden="true">{item.icon}</span>
                  {item.label}
                </Link>
              )
            })}
          </nav>

          {/* Logout */}
          <div className="p-3 border-t border-gray-100 shrink-0">
            <button
              type="button"
              onClick={logout}
              disabled={loggingOut}
              className="w-full flex items-center gap-3 px-3 min-h-[44px] rounded-lg text-base text-red-500 hover:bg-red-50 active:bg-red-100 transition-colors disabled:opacity-50"
            >
              <span className="text-lg w-6 text-center" aria-hidden="true">🚪</span>
              {loggingOut ? 'กำลังออกจากระบบ...' : 'ออกจากระบบ'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
