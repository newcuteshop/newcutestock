import clsx from 'clsx'
import { Facebook, MessageCircle, Phone } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { formatPhone } from '@/lib/rental'
import { lineHref, safeHttpUrl, telHref } from '@/components/book/links'

// ปุ่มติดต่อร้าน (โทร / แชท LINE / Facebook) — ใช้ได้ทั้ง server และ client component (ไม่มี state)
// กฎเบราว์เซอร์ในแอป LINE: ห้าม target="_blank" (เปิดแท็บใหม่ไม่ได้/หลุดออกจากแอป) → เปิดในหน้าเดิม
// rel="noreferrer" + referrerPolicy: ไม่ส่งที่อยู่หน้านี้ให้เว็บปลายทาง (หน้าสถานะการจองมีโทเคนอยู่ใน URL)
// ไม่มีข้อมูลติดต่อเลย → ไม่แสดงอะไร

export type ContactInfo = {
  phone: string | null
  line_id: string | null
  line_url: string | null
  facebook_url?: string | null
}

export default function ContactButtons({
  contact, compact = false, className,
}: {
  contact: ContactInfo
  /** true = ปุ่มไอคอนล้วน (แถบบน) ; false = ปุ่มมีข้อความ */
  compact?: boolean
  className?: string
}) {
  const tel = telHref(contact.phone)
  const line = lineHref(contact.line_url, contact.line_id)
  const fb = compact ? null : safeHttpUrl(contact.facebook_url)
  if (!tel && !line && !fb) return null

  if (compact) {
    return (
      <div className={clsx('flex items-center gap-1', className)}>
        {tel && (
          <a href={tel} className="btn-icon btn-icon-plain" aria-label={`โทรหาร้าน ${formatPhone(contact.phone)}`}>
            <Phone {...ICON_SM} />
          </a>
        )}
        {line && (
          <a href={line} rel="noreferrer" referrerPolicy="no-referrer" className="btn-icon btn-icon-plain" aria-label="แชทกับร้านทาง LINE">
            <MessageCircle {...ICON_SM} />
          </a>
        )}
      </div>
    )
  }

  return (
    // มือถือ: ปุ่มเต็มแถวเรียงลงมา (เบอร์/LINE ID ยาวไม่ล้นปุ่ม) · จอกว้าง: เรียงในแถวเดียว
    <div className={clsx('grid grid-cols-1 gap-2 sm:flex sm:flex-wrap', className)}>
      {tel && (
        <a href={tel} className="btn-secondary w-full min-w-0 sm:w-auto sm:min-w-[9rem]">
          <Phone {...ICON_SM} />
          <span className="min-w-0 truncate">โทร {formatPhone(contact.phone)}</span>
        </a>
      )}
      {line && (
        <a href={line} rel="noreferrer" referrerPolicy="no-referrer" className="btn-secondary w-full min-w-0 sm:w-auto sm:min-w-[9rem]">
          <MessageCircle {...ICON_SM} />
          <span className="min-w-0 truncate">แชท LINE{contact.line_id ? ` ${contact.line_id}` : ''}</span>
        </a>
      )}
      {fb && (
        <a href={fb} rel="noreferrer" referrerPolicy="no-referrer" className="btn-secondary w-full min-w-0 sm:w-auto sm:min-w-[9rem]">
          <Facebook {...ICON_SM} />
          <span className="whitespace-nowrap">Facebook</span>
        </a>
      )}
    </div>
  )
}
