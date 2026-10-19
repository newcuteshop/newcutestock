import { Clock, MapPin } from 'lucide-react'
import { ICON_XS } from '@/components/theme/icons'
import type { PublicInfo } from '@/lib/rental'
import ContactButtons from '@/components/book/ContactButtons'

// ท้ายหน้าจองออนไลน์: ชื่อร้าน ที่อยู่ เวลาเปิด และช่องทางติดต่อ (ข้อมูลจากตั้งค่าร้าน — ช่องไหนว่างไม่แสดง)
export default function BookFooter({ info, year }: { info: PublicInfo | null; year: number }) {
  const name = info?.shop_name ?? ''
  return (
    <footer className="mt-10 border-t border-gray-200 bg-white pb-safe">
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6 sm:py-8">
        {info && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <p className="text-base font-semibold text-gray-900 break-words">{name}</p>
              {info.tagline && <p className="text-sm text-gray-600 break-words">{info.tagline}</p>}
              {info.address && (
                <p className="flex items-start gap-2 text-sm text-gray-600">
                  <MapPin {...ICON_XS} className="mt-0.5 text-gray-400" />
                  <span className="min-w-0 whitespace-pre-line break-words">{info.address}</span>
                </p>
              )}
              {info.opening_hours && (
                <p className="flex items-start gap-2 text-sm text-gray-600">
                  <Clock {...ICON_XS} className="mt-0.5 text-gray-400" />
                  <span className="min-w-0 whitespace-pre-line break-words">{info.opening_hours}</span>
                </p>
              )}
            </div>
            <ContactButtons
              contact={{ phone: info.phone, line_id: info.line_id, line_url: info.line_url, facebook_url: info.facebook_url }}
              className="content-start sm:justify-end"
            />
          </div>
        )}
        <p className="text-xs text-gray-400">
          © {year + 543} {name} · ระบบจองชุดออนไลน์
        </p>
      </div>
    </footer>
  )
}
