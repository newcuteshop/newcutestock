import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isWeddingManager, requireWedding } from '@/lib/auth/permissions'
import { bangkokTodayKey, isDayKey } from '@/lib/format'
import { FIX07_MISSING_MSG } from '@/lib/wedding'
import { loadWeddingSettings, loadWeddingShopName } from '@/lib/weddingServer'
import { ICON_SM } from '@/components/theme/icons'
import MigrationNotice from '@/components/pos/MigrationNotice'
import BookingForm from '@/components/wedding/booking-form/BookingForm'
import { loadFormCatalog, loadPrefillCustomer } from '@/components/wedding/booking-form/catalog'

const TITLE = 'สร้างงาน'
const SUBTITLE = 'ลูกค้า → คิวงาน (วัน เวลา สถานที่ ทีมงาน) → แพ็กเกจ → ยอดเงิน → สถานะและรับมัดจำ'

export async function generateMetadata(): Promise<Metadata> {
  const shop = await loadWeddingShopName(createClient())
  return { title: { absolute: `${TITLE} · ${shop}` } }
}

function first(v: string | string[] | undefined): string {
  return typeof v === 'string' ? v.trim() : Array.isArray(v) && typeof v[0] === 'string' ? v[0].trim() : ''
}

// /wedding/bookings/new — ฟอร์มสร้างงาน (การจอง) สำหรับพนักงานร้าน b.oncloud
// ลิงก์จากหน้าอื่นเติมค่าให้ได้: ?date=YYYY-MM-DD (ปฏิทิน → สร้างงานวันนี้) · ?customer=<รหัสลูกค้า uuid> (หน้าลูกค้า)
// ค่าที่ผิดรูปแบบถูกข้ามเงียบๆ
export default async function NewWeddingBookingPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const session = await requireWedding()
  const manager = isWeddingManager(session)
  const supabase = createClient()
  const today = bangkokTodayKey()
  const date = first(searchParams.date)
  const customerId = first(searchParams.customer)

  const [settingsRes, catalog, customer] = await Promise.all([
    loadWeddingSettings(supabase),
    loadFormCatalog(supabase),
    loadPrefillCustomer(supabase, customerId),
  ])

  // ยังไม่ได้รัน supabase-fix-07-wedding.sql → บอกตรงๆ แทนหน้าพัง
  if (settingsRes.missing) {
    return <MigrationNotice title={TITLE} subtitle={SUBTITLE} message={FIX07_MISSING_MSG} />
  }
  // อ่านตั้งค่าไม่ได้ด้วยเหตุอื่น (เน็ต/สิทธิ์) → ใช้ค่าเริ่มต้น (ทุกการบันทึกฐานข้อมูลตรวจซ้ำเองอยู่แล้ว)
  const s = settingsRes.settings

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">{TITLE}</h1>
          <p className="page-subtitle">{SUBTITLE}</p>
        </div>
        <div className="page-actions">
          <Link href="/wedding/bookings" className="btn-secondary">
            <ArrowLeft {...ICON_SM} />
            รายการงาน
          </Link>
        </div>
      </div>
      <BookingForm
        mode="create"
        today={today}
        manager={manager}
        settings={{ hold_hours: s.hold_hours, max_jobs_per_day: s.max_jobs_per_day, balance_due_days: s.balance_due_days }}
        catalog={catalog}
        prefill={{ date: isDayKey(date) ? date : null, customer }}
      />
    </div>
  )
}
