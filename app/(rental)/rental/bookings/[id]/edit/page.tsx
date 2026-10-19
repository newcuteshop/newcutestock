import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requireRental } from '@/lib/auth/permissions'
import { bangkokTodayKey, thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import {
  FIX05_MISSING_MSG, STATUS_CHIP, parseRentalBooking, parseRentalCategories, parseRentalSettings,
} from '@/lib/rental'
import { ICON_SM } from '@/components/theme/icons'
import MigrationNotice from '@/components/pos/MigrationNotice'
import BookingWizard from '@/components/rental/booking-form/BookingWizard'
import { isUuid } from '@/components/rental/booking-form/model'

export const metadata: Metadata = { title: 'แก้ไขการจอง' }

// rental_get_booking ไม่พบ → raise 'ไม่พบการจองนี้ ...' (P0001)
function isBookingNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const message = (err as { message?: unknown }).message
  return typeof message === 'string' && message.includes('ไม่พบการจอง')
}

// /rental/bookings/<id>/edit — แก้การจองที่ยังไม่รับชุด (รอยืนยัน / จองแล้ว): วัน ชุด ลูกค้า ส่วนลด การจัดส่ง เงินประกัน หมายเหตุ
// ฟอร์มผูกกับเวอร์ชันของการจอง (updated_at) — key เปลี่ยนเมื่อโหลดข้อมูลล่าสุด → ฟอร์มเริ่มใหม่จากข้อมูลใหม่
export default async function EditBookingPage({ params }: { params: { id: string } }) {
  await requireRental()
  if (!isUuid(params.id)) notFound()
  const id = params.id.toLowerCase()
  const supabase = createClient()

  const [bookingRes, settingsRes, catsRes] = await Promise.all([
    supabase.rpc('rental_get_booking', { p_booking_id: id }),
    supabase.rpc('rental_get_settings'),
    supabase
      .from('rental_categories')
      .select('id, name, sort_order, is_active, created_at')
      .eq('is_active', true)
      .order('sort_order')
      .order('name'),
  ])

  if (bookingRes.error) {
    if (isMigrationMissing(bookingRes.error)) {
      return <MigrationNotice title="แก้ไขการจอง" message={FIX05_MISSING_MSG} />
    }
    if (isBookingNotFound(bookingRes.error)) notFound()
    throw new Error(thaiError(bookingRes.error))
  }
  const booking = parseRentalBooking(bookingRes.data)
  if (!booking) notFound()

  const settings = parseRentalSettings(settingsRes.error ? null : settingsRes.data)
  const categories = catsRes.error ? [] : parseRentalCategories(catsRes.data)
  const editable = booking.actions.can_edit && (booking.status === 'pending' || booking.status === 'confirmed')
  const detailHref = `/rental/bookings/${booking.id}`

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">
            แก้ไขการจอง <span className="font-mono text-[0.85em] break-all">{booking.booking_no}</span>
          </h1>
          <p className="page-subtitle flex flex-wrap items-center gap-2">
            <span className={STATUS_CHIP[booking.status]}>{booking.status_label}</span>
            <span className="min-w-0 break-words">{booking.customer.name}</span>
          </p>
        </div>
        <div className="page-actions">
          <Link href={detailHref} className="btn-secondary">
            <ArrowLeft {...ICON_SM} />
            กลับหน้าการจอง
          </Link>
        </div>
      </div>

      {editable ? (
        <BookingWizard
          key={booking.updated_at}
          mode="edit"
          today={bangkokTodayKey()}
          settings={{ default_base_days: settings.default_base_days, online_hold_hours: settings.online_hold_hours }}
          categories={categories}
          booking={booking}
        />
      ) : (
        <div role="alert" className="alert-warn">
          <AlertTriangle {...ICON_SM} />
          <div className="min-w-0 space-y-2">
            <p>
              การจองสถานะ &quot;{booking.status_label}&quot; แก้ไขไม่ได้ — แก้ได้เฉพาะการจองที่ยังไม่รับชุด (รอยืนยัน / จองแล้ว)
              ถ้าลูกค้าขอเปลี่ยนวันคืนหลังรับชุดแล้ว ให้ใช้ &quot;ขยายวันคืน&quot; ที่หน้าการจอง
            </p>
            <Link href={detailHref} className="btn-secondary px-4 text-sm">กลับหน้าการจอง</Link>
          </div>
        </div>
      )}
    </div>
  )
}
