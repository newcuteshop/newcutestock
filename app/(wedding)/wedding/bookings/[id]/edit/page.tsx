import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isWeddingManager, requireWedding } from '@/lib/auth/permissions'
import { bangkokTodayKey, thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { FIX07_MISSING_MSG, WED_STATUS_CHIP, parseWedBooking } from '@/lib/wedding'
import { loadWeddingSettings, loadWeddingShopName } from '@/lib/weddingServer'
import { ICON_SM } from '@/components/theme/icons'
import MigrationNotice from '@/components/pos/MigrationNotice'
import BookingForm from '@/components/wedding/booking-form/BookingForm'
import { loadFormCatalog } from '@/components/wedding/booking-form/catalog'
import { isUuid, rawAddonQtyMap } from '@/components/wedding/booking-form/model'

const TITLE = 'แก้ไขงาน'

export async function generateMetadata(): Promise<Metadata> {
  const shop = await loadWeddingShopName(createClient())
  return { title: { absolute: `${TITLE} · ${shop}` } }
}

// wed_get_booking ไม่พบ → raise 'ไม่พบงานนี้ ...' (P0001)
function isBookingNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const message = (err as { message?: unknown }).message
  return typeof message === 'string' && message.includes('ไม่พบงาน')
}

// /wedding/bookings/<id>/edit — แก้งานที่ยังแก้ได้ (สอบถาม / ล็อกคิว / ยืนยันแล้ว / เลื่อนงาน / ถ่ายเสร็จรอส่ง):
// ลูกค้า ชื่อคู่บ่าวสาว คิวงาน+ทีม แพ็กเกจ บริการเสริม ค่าเดินทาง ส่วนลด ติดตาม หมายเหตุ
// ฟอร์มผูกกับเวอร์ชันของงาน (updated_at) — key เปลี่ยนเมื่อโหลดข้อมูลล่าสุด → ฟอร์มเริ่มใหม่จากข้อมูลใหม่
export default async function EditWeddingBookingPage({ params }: { params: { id: string } }) {
  const session = await requireWedding()
  if (!isUuid(params.id)) notFound()
  const id = params.id.toLowerCase()
  const manager = isWeddingManager(session)
  const supabase = createClient()

  const [bookingRes, settingsRes, catalog] = await Promise.all([
    supabase.rpc('wed_get_booking', { p_booking_id: id }),
    loadWeddingSettings(supabase),
    loadFormCatalog(supabase),
  ])

  if (bookingRes.error) {
    if (isMigrationMissing(bookingRes.error)) {
      return <MigrationNotice title={TITLE} message={FIX07_MISSING_MSG} />
    }
    if (isBookingNotFound(bookingRes.error)) notFound()
    throw new Error(thaiError(bookingRes.error))
  }
  const booking = parseWedBooking(bookingRes.data)
  if (!booking) notFound()

  const s = settingsRes.settings
  const detailHref = `/wedding/bookings/${booking.id}`

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">
            {TITLE} <span className="font-mono text-[0.85em] break-all">{booking.booking_no}</span>
          </h1>
          <p className="page-subtitle flex flex-wrap items-center gap-2">
            <span className={WED_STATUS_CHIP[booking.status]}>{booking.status_label}</span>
            <span className="min-w-0 break-words">{booking.couple_names}</span>
          </p>
        </div>
        <div className="page-actions">
          <Link href={detailHref} className="btn-secondary">
            <ArrowLeft {...ICON_SM} />
            กลับหน้างาน
          </Link>
        </div>
      </div>

      {booking.actions.can_edit ? (
        <BookingForm
          key={booking.updated_at}
          mode="edit"
          today={bangkokTodayKey()}
          manager={manager}
          settings={{ hold_hours: s.hold_hours, max_jobs_per_day: s.max_jobs_per_day, balance_due_days: s.balance_due_days }}
          catalog={catalog}
          booking={booking}
          addonQty={rawAddonQtyMap(bookingRes.data)}
        />
      ) : (
        <div role="alert" className="alert-warn">
          <AlertTriangle {...ICON_SM} />
          <div className="min-w-0 space-y-2">
            <p>
              งานสถานะ &quot;{booking.status_label}&quot; แก้ไขไม่ได้ — แก้ได้เฉพาะงานที่สอบถาม ล็อกคิว ยืนยันแล้ว เลื่อนงาน
              หรือถ่ายเสร็จรอส่งงาน — รับเงิน ค่าใช้จ่ายเพิ่มเติม และรายการส่งงาน ยังจัดการได้ที่หน้างาน
            </p>
            <Link href={detailHref} className="btn-secondary px-4 text-sm">กลับหน้างาน</Link>
          </div>
        </div>
      )}
    </div>
  )
}
