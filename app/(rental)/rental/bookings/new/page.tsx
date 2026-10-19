import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requireRental } from '@/lib/auth/permissions'
import { bangkokTodayKey, isDayKey } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import {
  FIX05_MISSING_MSG, parseCustomer, parseRentalCategories, parseRentalSettings,
} from '@/lib/rental'
import { ICON_SM } from '@/components/theme/icons'
import MigrationNotice from '@/components/pos/MigrationNotice'
import BookingWizard from '@/components/rental/booking-form/BookingWizard'
import { customerLiteFromCustomer, isUuid, type CustomerLite } from '@/components/rental/booking-form/model'

export const metadata: Metadata = { title: 'สร้างการจอง' }

const TITLE = 'สร้างการจอง'
const SUBTITLE = 'เลือกวันรับ-คืน → เลือกชุดที่ว่าง → ลูกค้า → สรุปยอดและรับมัดจำ'

function first(v: string | string[] | undefined): string {
  return typeof v === 'string' ? v.trim() : Array.isArray(v) && typeof v[0] === 'string' ? v[0].trim() : ''
}

// /rental/bookings/new — ฟอร์มสร้างการจอง (สัญญาเช่า) สำหรับพนักงานร้านเช่า
// ลิงก์จากหน้าอื่นเติมค่าให้ได้: ?pickup=YYYY-MM-DD&return=YYYY-MM-DD&item=<รหัสชุด uuid>&customer=<รหัสลูกค้า uuid>
//   (เช่น ปฏิทินชุด → จองช่วงที่ว่าง / หน้าลูกค้า → จองให้ลูกค้าคนนี้) — ค่าที่ผิดรูปแบบถูกข้ามเงียบๆ
export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  await requireRental()
  const supabase = createClient()
  const today = bangkokTodayKey()

  const pickup = first(searchParams.pickup)
  const ret = first(searchParams.return)
  const itemId = first(searchParams.item).toLowerCase()
  const customerId = first(searchParams.customer).toLowerCase()

  const [settingsRes, catsRes, custRes] = await Promise.all([
    supabase.rpc('rental_get_settings'),
    supabase
      .from('rental_categories')
      .select('id, name, sort_order, is_active, created_at')
      .eq('is_active', true)
      .order('sort_order')
      .order('name'),
    isUuid(customerId) ? supabase.rpc('rental_get_customer', { p_id: customerId }) : null,
  ])

  // ยังไม่ได้รัน supabase-fix-05-rental.sql → บอกตรงๆ แทนหน้าพัง
  if (settingsRes.error && isMigrationMissing(settingsRes.error)) {
    return <MigrationNotice title={TITLE} subtitle={SUBTITLE} message={FIX05_MISSING_MSG} />
  }
  // อ่านตั้งค่าไม่ได้ด้วยเหตุอื่น (เน็ต/สิทธิ์) → ใช้ค่าเริ่มต้น (ทุกการบันทึกฐานข้อมูลตรวจซ้ำเองอยู่แล้ว)
  const settings = parseRentalSettings(settingsRes.error ? null : settingsRes.data)
  const categories = catsRes.error ? [] : parseRentalCategories(catsRes.data)

  let customer: CustomerLite | null = null
  if (custRes && !custRes.error) {
    const c = parseCustomer(custRes.data)
    if (c) customer = customerLiteFromCustomer(c)
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">{TITLE}</h1>
          <p className="page-subtitle">{SUBTITLE}</p>
        </div>
        <div className="page-actions">
          <Link href="/rental/bookings" className="btn-secondary">
            <ArrowLeft {...ICON_SM} />
            รายการจอง
          </Link>
        </div>
      </div>
      <BookingWizard
        mode="create"
        today={today}
        settings={{ default_base_days: settings.default_base_days, online_hold_hours: settings.online_hold_hours }}
        categories={categories}
        prefill={{
          pickup: isDayKey(pickup) ? pickup : null,
          ret: isDayKey(ret) ? ret : null,
          itemId: isUuid(itemId) ? itemId : null,
          customer,
        }}
      />
    </div>
  )
}
