import type { ReactNode } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { AlertTriangle, RefreshCw, Store, WifiOff } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { FIX06_MISSING_MSG } from '@/lib/rental'
import ContactButtons, { type ContactInfo } from '@/components/book/ContactButtons'

// การ์ดแจ้งเตือนเต็มหน้าของหน้าจองออนไลน์ (ใช้ได้ทั้ง server และ client component)
//   closed   = ร้านปิดรับจองออนไลน์ชั่วคราว (online_enabled = false) → ข้อความร้าน + ปุ่มติดต่อ
//   notReady = ฐานข้อมูลยังไม่มีระบบจองออนไลน์ (ยังไม่รัน fix-06) → ลูกค้าเห็นข้อความสุภาพ + บรรทัดเล็กบอกผู้ดูแลว่าต้องรันไฟล์ไหน
//   error    = เชื่อมต่อไม่ได้/ข้อผิดพลาดอื่น → ปุ่มโหลดใหม่ (ลิงก์ธรรมดา ไม่ต้องใช้ JavaScript)
//   notFound = ลิงก์ผิด/ชุดถูกปิด
export type NoticeKind = 'closed' | 'notReady' | 'error' | 'notFound'

export default function NoticeCard({
  kind, title, message, contact, retryHref, children, className,
}: {
  kind: NoticeKind
  title?: string
  message?: string | null
  contact?: ContactInfo | null
  /** ลิงก์ "ลองอีกครั้ง" (หน้าเดิม) — เฉพาะ kind = error */
  retryHref?: string
  children?: ReactNode
  className?: string
}) {
  const Icon = kind === 'error' ? WifiOff : kind === 'closed' ? Store : AlertTriangle
  const heading =
    title ??
    (kind === 'closed'
      ? 'ขณะนี้ปิดรับจองออนไลน์ชั่วคราว'
      : kind === 'notReady'
        ? 'ระบบจองออนไลน์ยังไม่เปิดใช้งาน'
        : kind === 'notFound'
          ? 'ไม่พบหน้าที่ต้องการ'
          : 'เชื่อมต่อระบบไม่ได้ชั่วคราว')
  const body =
    message ??
    (kind === 'closed'
      ? 'ติดต่อร้านเพื่อสอบถามหรือจองชุดได้ตามช่องทางด้านล่าง'
      : kind === 'notReady'
        ? 'ติดต่อร้านเพื่อจองชุดได้ตามช่องทางด้านล่าง'
        : kind === 'notFound'
          ? 'ลิงก์อาจไม่ถูกต้อง หรือรายการนี้ไม่เปิดให้จองออนไลน์แล้ว'
          : 'ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง')

  return (
    <section className={clsx('card mx-auto w-full max-w-lg', className)} aria-labelledby="book-notice-title">
      <div className="empty-state">
        <span className={clsx('icon-bubble icon-bubble-lg', kind === 'closed' ? '' : 'icon-bubble-warn')} aria-hidden="true">
          <Icon size={28} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <h1 id="book-notice-title" className="empty-state-title max-w-md">{heading}</h1>
        <p className="max-w-sm whitespace-pre-line break-words text-sm text-gray-600">{body}</p>
        {children}
        {kind === 'error' && retryHref && (
          <a href={retryHref} className="btn-secondary mt-2">
            <RefreshCw {...ICON_SM} />
            ลองอีกครั้ง
          </a>
        )}
        {kind === 'notFound' && (
          <Link href="/book" className="btn-primary mt-2">
            ดูชุดทั้งหมด
          </Link>
        )}
        {contact && <ContactButtons contact={contact} className="mt-3 w-full justify-center" />}
        {kind === 'notReady' && (
          // คำแนะนำสำหรับผู้ดูแลร้าน (ลูกค้าอ่านข้ามได้)
          <p className="mt-4 max-w-sm break-words text-xs text-gray-400">ผู้ดูแลร้าน: {FIX06_MISSING_MSG}</p>
        )}
      </div>
    </section>
  )
}
