import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isRentalManager, requireRental } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import {
  FIX05_MISSING_MSG, loadRentalShopName, parseRentalBooking, parseRentalSettings, type RentalSettings,
} from '@/lib/rental'
import MigrationNotice from '@/components/pos/MigrationNotice'
import BookingDetailClient from '@/components/rental/booking/BookingDetailClient'

export const metadata: Metadata = { title: 'รายละเอียดการจอง' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// rental_get_booking ไม่พบ → raise 'ไม่พบการจองนี้ ...' (P0001)
function isBookingNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const message = (err as { message?: unknown }).message
  return typeof message === 'string' && message.includes('ไม่พบการจองนี้')
}

// /rental/bookings/<id> — รายละเอียดการจอง/สัญญาเช่า: ปุ่มทำงานตามสถานะ + รับ-คืนเงิน + เอกสารพิมพ์
// พนักงานร้านเช่า (rental) ใช้ได้ทุกปุ่ม ยกเว้นยกเลิกรายการเงินของวันก่อน (ผู้จัดการ rental_manage เท่านั้น — เซิร์ฟเวอร์ตรวจซ้ำ)
export default async function RentalBookingPage({ params }: { params: { id: string } }) {
  const session = await requireRental()

  // id ไม่ใช่ uuid → ไม่มีการจองนี้แน่นอน (ไม่ต้องยิง DB ให้ได้ error 22P02)
  if (!UUID_RE.test(params.id)) notFound()
  const id = params.id.toLowerCase()

  const supabase = createClient()
  const [bookingRes, settingsRes] = await Promise.all([
    supabase.rpc('rental_get_booking', { p_booking_id: id }),
    supabase.rpc('rental_get_settings'),
  ])
  if (bookingRes.error) {
    if (isMigrationMissing(bookingRes.error)) {
      return <MigrationNotice title="รายละเอียดการจอง" subtitle="สัญญาเช่า รับ-คืนชุด และรับเงิน" message={FIX05_MISSING_MSG} />
    }
    if (isBookingNotFound(bookingRes.error)) notFound()
    throw new Error(thaiError(bookingRes.error))
  }
  const booking = parseRentalBooking(bookingRes.data)
  if (!booking) notFound()

  // ตั้งค่าร้าน (หัวเอกสาร/ข้อตกลง/พร้อมเพย์) อ่านไม่ได้ → ค่าเริ่มต้น + ชื่อร้านจากตาราง (หน้าไม่พังเพราะเรื่องนี้)
  let settings: RentalSettings
  if (settingsRes.error) {
    settings = { ...parseRentalSettings(null), shop_name: await loadRentalShopName(supabase) }
  } else {
    settings = parseRentalSettings(settingsRes.data)
  }

  return (
    <BookingDetailClient
      key={booking.id}
      initialBooking={booking}
      settings={settings}
      canManage={isRentalManager(session)}
    />
  )
}
