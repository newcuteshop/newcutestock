import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireRental } from '@/lib/auth/permissions'
import { bangkokTodayKey, isDayKey } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { DEFAULT_RENTAL_SHOP_NAME, FIX05_MISSING_MSG, parseRentalSettings } from '@/lib/rental'
import MigrationNotice from '@/components/pos/MigrationNotice'
import PaymentsClient from './PaymentsClient'

export const metadata: Metadata = { title: 'การเงิน' }
// ตัวเลขเงินต้องสดเสมอ (สลิปใหม่/รายการจากเครื่องอื่น) — ห้ามแคช
export const dynamic = 'force-dynamic'

const TITLE = 'การเงิน'
const SUBTITLE = 'รายการรับ-จ่ายเงินประจำวัน ตรวจสลิปโอนเงินจากลูกค้า และพิมพ์สรุปยอด'

// หน้าการเงินร้านเช่าชุด — พนักงานร้านเช่าทุกคนเข้าได้ (รับเงิน/ตรวจสลิปเป็นงานหน้าร้าน)
// ?day=YYYY-MM-DD (วันอนาคต/ค่าเสีย = วันนี้) · ?tab=slips = เปิดแท็บสลิปรอตรวจ (ลิงก์จากภาพรวมวันนี้/ตัวเลขบนเมนู)
// ตรวจว่ามีระบบร้านเช่าในฐานข้อมูลด้วย rental_get_settings (ใช้ชื่อร้านบนใบสรุปยอดด้วย)
export default async function RentalPaymentsPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  await requireRental()
  const supabase = createClient()

  const { data, error } = await supabase.rpc('rental_get_settings')
  if (error && isMigrationMissing(error)) {
    return <MigrationNotice title={TITLE} subtitle={SUBTITLE} message={FIX05_MISSING_MSG} />
  }
  // อ่านตั้งค่าไม่ได้ด้วยเหตุอื่น (เน็ตหลุดชั่วคราว) → ใช้ชื่อร้านเริ่มต้น หน้ายังใช้งานได้
  const shopName = error ? DEFAULT_RENTAL_SHOP_NAME : parseRentalSettings(data).shop_name

  const today = bangkokTodayKey()
  const rawDay = typeof searchParams?.day === 'string' ? searchParams.day.trim() : ''
  const initialDay = isDayKey(rawDay) && rawDay <= today ? rawDay : today
  const initialTab = searchParams?.tab === 'slips' ? 'slips' : 'day'

  return <PaymentsClient shopName={shopName} initialDay={initialDay} today={today} initialTab={initialTab} />
}
