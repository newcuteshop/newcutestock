import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isWeddingManager, requireWedding } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { FIX07_MISSING_MSG, parseWedBooking } from '@/lib/wedding'
import { loadWeddingSettings, loadWeddingShopName } from '@/lib/weddingServer'
import MigrationNotice from '@/components/pos/MigrationNotice'
import BookingDetailClient from '@/components/wedding/booking/BookingDetailClient'

// ชื่อแท็บไม่ต่อท้าย "NEWCUTE" (แม่แบบของ root layout) — หน้านี้เป็นของร้าน b.oncloud
export const metadata: Metadata = { title: { absolute: 'รายละเอียดงาน' } }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// wed_get_booking ไม่พบ → raise 'ไม่พบงานนี้ (อาจถูกลบไปแล้ว)' (P0001)
function isBookingNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const message = (err as { message?: unknown }).message
  return typeof message === 'string' && message.includes('ไม่พบงานนี้')
}

// /wedding/bookings/<id> — รายละเอียดงาน: ปุ่มเปลี่ยนสถานะ + รับเงิน/งวดชำระ + ส่งงาน + เอกสารส่งลูกค้า
// พนักงาน (wedding) ใช้ได้ทุกปุ่ม ยกเว้น เปิดงานใหม่ / ยกเลิกงานที่ถ่ายแล้ว / ยกเลิกรายการเงินของวันก่อน (ผู้จัดการ — เซิร์ฟเวอร์ตรวจซ้ำ)
// ค่าตัวทีม/ต้นทุน/กำไร ฐานข้อมูลส่งมาเฉพาะผู้จัดการ
export default async function WeddingBookingPage({ params }: { params: { id: string } }) {
  const session = await requireWedding()

  // id ไม่ใช่ uuid → ไม่มีงานนี้แน่นอน (ไม่ต้องยิง DB ให้ได้ error 22P02)
  if (!UUID_RE.test(params.id)) notFound()
  const id = params.id.toLowerCase()

  const supabase = createClient()
  const [bookingRes, settingsRes] = await Promise.all([
    supabase.rpc('wed_get_booking', { p_booking_id: id }),
    loadWeddingSettings(supabase),
  ])
  if (bookingRes.error) {
    if (isMigrationMissing(bookingRes.error)) {
      return <MigrationNotice title="รายละเอียดงาน" subtitle="คิวงาน รับเงิน และส่งงาน" message={FIX07_MISSING_MSG} />
    }
    if (isBookingNotFound(bookingRes.error)) notFound()
    throw new Error(thaiError(bookingRes.error))
  }
  const booking = parseWedBooking(bookingRes.data)
  if (!booking) notFound()

  // ตั้งค่าร้าน (หัวเอกสาร/พร้อมเพย์/เงื่อนไข) อ่านไม่ได้ → ค่าเริ่มต้น + ชื่อร้านจากตาราง (หน้าไม่พังเพราะเรื่องนี้)
  let settings = settingsRes.settings
  if (settingsRes.error) settings = { ...settings, shop_name: await loadWeddingShopName(supabase) }

  return (
    <BookingDetailClient
      key={booking.id}
      initialBooking={booking}
      settings={settings}
      canManage={isWeddingManager(session)}
    />
  )
}
