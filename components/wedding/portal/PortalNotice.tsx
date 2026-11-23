// ===== การ์ดแจ้งสถานะเต็มหน้าของหน้าติดตามงาน (ใช้ได้ทั้ง server และ client component) =====
//   notFound  = ลิงก์ผิด / ร้านเปลี่ยนลิงก์ใหม่แล้ว (โทเคนเดิมใช้ไม่ได้)
//   disabled  = ร้านปิดลิงก์ติดตามงานชั่วคราว (wed_settings.portal_enabled = false) → ปุ่มติดต่อร้าน
//   cancelled = งานถูกยกเลิก (ข้อมูลย่อ: เลขที่งาน + ชื่อคู่บ่าวสาว)
//   notReady  = ฐานข้อมูลยังไม่มีระบบนี้ (ยังไม่รัน fix-07) → ข้อความสุภาพ + บรรทัดเล็กบอกผู้ดูแล
//   error     = เชื่อมต่อไม่ได้ → ปุ่ม "ลองอีกครั้ง" (ลิงก์ธรรมดา ทำงานได้แม้ JavaScript ยังไม่โหลด)
// ไม่มีลิงก์ไปหน้าหลังร้าน / หน้าเข้าสู่ระบบ (ลูกค้าไม่มีบัญชี)
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { AlertTriangle, CalendarX2, Link2Off, RefreshCw, WifiOff } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import ContactButtons from '@/components/book/ContactButtons'
import { FIX07_MISSING_MSG, type WedPublicShop } from '@/lib/wedding'

export type PortalNoticeKind = 'notFound' | 'disabled' | 'cancelled' | 'notReady' | 'error'

export default function PortalNotice({
  kind, shop, title, message, retryHref, children,
}: {
  kind: PortalNoticeKind
  shop?: WedPublicShop | null
  title?: string
  message?: string | null
  retryHref?: string
  children?: ReactNode
}) {
  const Icon = kind === 'error' ? WifiOff : kind === 'cancelled' ? CalendarX2 : kind === 'notFound' ? Link2Off : AlertTriangle
  const heading =
    title ??
    (kind === 'notFound'
      ? 'ไม่พบงานนี้'
      : kind === 'disabled'
        ? 'ขณะนี้ร้านปิดหน้าติดตามงานชั่วคราว'
        : kind === 'cancelled'
          ? 'งานนี้ยกเลิกแล้ว'
          : kind === 'notReady'
            ? 'ระบบติดตามงานยังไม่เปิดใช้งาน'
            : 'เชื่อมต่อระบบไม่ได้ชั่วคราว')
  const body =
    message ??
    (kind === 'notFound'
      ? 'ลิงก์อาจไม่ครบหรือร้านเปลี่ยนลิงก์ใหม่แล้ว — ตรวจสอบลิงก์ล่าสุดที่ได้รับ หรือติดต่อร้านพร้อมแจ้งชื่อคู่บ่าวสาว'
      : kind === 'disabled'
        ? 'สอบถามสถานะงาน ตารางคิว และยอดชำระกับร้านได้โดยตรงตามช่องทางด้านล่าง'
        : kind === 'cancelled'
          ? 'หากมีข้อสงสัยเรื่องการยกเลิกหรือการคืนเงิน กรุณาติดต่อร้าน'
          : kind === 'notReady'
            ? 'ติดต่อร้านเพื่อสอบถามสถานะงานได้โดยตรง'
            : 'ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง')
  const contact = shop ? { phone: shop.phone, line_id: shop.line_id, line_url: shop.line_url } : null

  return (
    <section className="card mx-auto w-full max-w-lg" aria-labelledby="portal-notice-title">
      <div className="empty-state">
        <span className={clsx('icon-bubble icon-bubble-lg', kind === 'disabled' ? '' : 'icon-bubble-warn')} aria-hidden="true">
          <Icon size={28} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <h1 id="portal-notice-title" className="empty-state-title max-w-md">{heading}</h1>
        <p className="max-w-sm whitespace-pre-line break-words text-sm text-gray-600">{body}</p>
        {children}
        {kind === 'error' && retryHref && (
          <a href={retryHref} className="btn-secondary mt-2">
            <RefreshCw {...ICON_SM} />
            ลองอีกครั้ง
          </a>
        )}
        {contact && <ContactButtons contact={contact} className="mt-3 w-full justify-center" />}
        {kind === 'notReady' && (
          // คำแนะนำสำหรับผู้ดูแลร้าน (ลูกค้าอ่านข้ามได้)
          <p className="mt-4 max-w-sm break-words text-xs text-gray-400">ผู้ดูแลร้าน: {FIX07_MISSING_MSG}</p>
        )}
      </div>
    </section>
  )
}
