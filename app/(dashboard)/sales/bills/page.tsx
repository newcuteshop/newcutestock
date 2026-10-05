import Link from 'next/link'
import { ShoppingCart } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/permissions'
import { bangkokTodayKey, isDayKey } from '@/lib/format'
import { loadShopSettings } from '@/lib/shop'
import { ICON_SM } from '@/components/theme/icons'
import BillsClient from './BillsClient'

// ประวัติบิล: ดูบิลรายวัน / ค้นหาเลขที่บิล / พิมพ์ใบเสร็จซ้ำ / ยกเลิกบิล / คืนสินค้า
// เข้าหน้าได้ด้วยสิทธิ์ "บันทึกการขาย" — ปุ่มยกเลิก/คืนสินค้าต้องมีสิทธิ์ "ยกเลิกบิล / คืนสินค้า" เพิ่ม (เซิร์ฟเวอร์ตรวจซ้ำ)
// รายการบิลดึงจากตาราง sales ตรงๆ ฝั่งหน้าเว็บ (RLS) — เปลี่ยนวัน/ค้นหา/โหลดเพิ่มไม่ต้องโหลดทั้งหน้าใหม่
export default async function BillsPage({ searchParams }: { searchParams?: { day?: string | string[] } }) {
  const session = await requirePermission('sales')
  const supabase = createClient()
  const { settings } = await loadShopSettings(supabase)
  const today = bangkokTodayKey()
  // ?day=YYYY-MM-DD (เช่น ลิงก์จากหน้าปิดยอด) — ค่าเสีย/วันในอนาคต = วันนี้
  const raw = typeof searchParams?.day === 'string' ? searchParams.day.trim() : ''
  const initialDay = isDayKey(raw) && raw <= today ? raw : today

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">ประวัติบิล / คืนสินค้า</h1>
          <p className="page-subtitle">ค้นหาบิล ดูรายละเอียด พิมพ์ใบเสร็จซ้ำ ยกเลิกบิล และคืนสินค้า</p>
        </div>
        <div className="page-actions">
          <Link href="/sales" className="btn-secondary">
            <ShoppingCart {...ICON_SM} />
            ไปหน้าขาย
          </Link>
        </div>
      </div>
      <BillsClient
        initialDay={initialDay}
        today={today}
        shop={settings}
        canRefund={session.permissions.refunds}
      />
    </div>
  )
}
