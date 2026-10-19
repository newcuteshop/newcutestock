import Link from 'next/link'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isRentalManager, requireRental } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { isMigrationMissing } from '@/lib/migration'
import { FIX05_MISSING_MSG, loadRentalShopName, parseRentalCategories } from '@/lib/rental'
import { ICON } from '@/components/theme/icons'
import MigrationNotice from '@/components/pos/MigrationNotice'
import { ITEM_LIST_COLUMNS, toItemListRow, type ItemListRow } from '@/components/rental/items/itemList'
import ItemsClient from './ItemsClient'

// /rental/items — ชุดเช่าทั้งหมด (พนักงานร้านเช่าดูได้ · เพิ่ม/แก้ได้เฉพาะผู้จัดการร้านเช่า)
// อ่านตาราง rental_items ตรง (RLS) พร้อมชิ้นทั้งหมดและรูปปก 1 รูป · เกิน 1,000 แบบดึงทีละหน้า (fetchAllRows)
export default async function RentalItemsPage() {
  const session = await requireRental()
  const canManage = isRentalManager(session)
  const supabase = createClient()

  let rows: unknown[]
  try {
    rows = await fetchAllRows<unknown>((from, to) => supabase
      .from('rental_items')
      .select(ITEM_LIST_COLUMNS)
      // รูปปก = sort_order น้อยสุด เอามารูปเดียว
      .order('sort_order', { referencedTable: 'rental_item_images', ascending: true })
      .order('created_at', { referencedTable: 'rental_item_images', ascending: true })
      .limit(1, { referencedTable: 'rental_item_images' })
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to))
  } catch (e) {
    // ยังไม่ได้รัน supabase-fix-05-rental.sql → ไม่มีตาราง
    if (isMigrationMissing(e)) {
      return <MigrationNotice title="ชุดเช่า" subtitle="แบบชุด ชิ้นจริง ราคา และป้ายแขวน" message={FIX05_MISSING_MSG} />
    }
    throw e instanceof Error ? e : new Error(thaiError(e))
  }

  const [catRes, shopName] = await Promise.all([
    supabase.from('rental_categories').select('id, name, sort_order, is_active, created_at')
      .order('sort_order').order('name'),
    loadRentalShopName(supabase),
  ])
  if (catRes.error && !isMigrationMissing(catRes.error)) throw new Error(thaiError(catRes.error))

  const items = rows.map(toItemListRow).filter((r): r is ItemListRow => r !== null)
  const categories = parseRentalCategories(catRes.data ?? [])

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">ชุดเช่า</h1>
          <p className="page-subtitle">แบบชุด ชิ้นจริงแต่ละตัว ราคา รูป และป้ายแขวนบาร์โค้ด</p>
        </div>
        {canManage && (
          <div className="page-actions">
            <Link href="/rental/items/new" className="btn-primary w-full sm:w-auto">
              <Plus {...ICON} />
              เพิ่มชุด
            </Link>
          </div>
        )}
      </div>
      <ItemsClient items={items} categories={categories} shopName={shopName} />
    </div>
  )
}
