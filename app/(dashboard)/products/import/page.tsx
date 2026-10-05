import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/permissions'
import { isMigrationMissing } from '@/lib/migration'
import MigrationNotice from '@/components/pos/MigrationNotice'
import { ICON_SM } from '@/components/theme/icons'
import ImportClient from './ImportClient'

// นำเข้าสินค้าจากไฟล์ CSV (Excel) — ตรวจทุกแถวกับฐานข้อมูลก่อน (RPC import_products แบบ dry run) แล้วค่อยบันทึกทั้งไฟล์ในครั้งเดียว
export default async function ProductImportPage() {
  const session = await requirePermission('products')
  const supabase = createClient()

  // ฐานข้อมูลยังไม่ได้รัน supabase-fix-04-pos.sql (ไม่มีตาราง product_imports / RPC import_products)
  // → บอกตั้งแต่เปิดหน้า แทนที่จะให้เลือกไฟล์แล้วค่อยพัง · error อื่น (เช่นเน็ตสะดุด) ปล่อยให้หน้าทำงานต่อ ตอนตรวจไฟล์จะแจ้งเอง
  const probe = await supabase.from('product_imports').select('id').limit(1)
  const missing = !!probe.error && isMigrationMissing(probe.error)

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <Link href="/products" className="link text-sm">
            <ArrowLeft {...ICON_SM} />
            กลับไปรายการสินค้า
          </Link>
          <h1 className="page-title">นำเข้าสินค้าจากไฟล์ Excel</h1>
          <p className="page-subtitle">
            เพิ่มสินค้าใหม่ หรืออัปเดตราคา บาร์โค้ด และจำนวนขั้นต่ำของสินค้าที่มีอยู่ ทีละหลายรายการด้วยไฟล์ CSV
          </p>
        </div>
      </div>
      {missing ? (
        <MigrationNotice
          actions={
            <Link href="/products" className="btn-secondary w-full sm:w-auto">
              <ArrowLeft {...ICON_SM} />
              กลับไปรายการสินค้า
            </Link>
          }
        />
      ) : (
        <ImportClient canStock={session.permissions.stock} />
      )}
    </div>
  )
}
