import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import { fetchAllRows } from '@/lib/fetchAllRows'
import StockClient, { type MoveType, type StockProduct, type StockMovementRow } from './StockClient'

// ?action=in|out|adjust|return เลือกประเภทรายการให้ตั้งแต่เปิดหน้า (ค่าเริ่มต้น = รับเข้า)
function parseAction(raw: string | string[] | undefined): MoveType {
  const v = Array.isArray(raw) ? raw[0] : raw
  return v === 'out' || v === 'adjust' || v === 'return' ? v : 'in'
}

export default async function StockPage({ searchParams }: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  await requirePermission('stock')
  const supabase = createClient()
  const initialType = parseAction(searchParams?.action)

  // สินค้าเกิน 1,000 รายการ (หลายไซส์/สี) ต้องดึงทีละหน้า ไม่งั้นสแกนตัวที่เกินแล้วขึ้น "ไม่พบสินค้า"
  const [products, movementsRes] = await Promise.all([
    fetchAllRows<StockProduct>((from, to) => supabase.from('products')
      .select('id, name, sku, barcode, size, color, stock_qty')
      .eq('is_active', true)
      .order('name')
      .order('id')
      .range(from, to)),
    supabase.from('stock_movements')
      .select('id, type, qty, qty_before, qty_after, note, created_at, products(name, sku, size, color)')
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  if (movementsRes.error) throw new Error(thaiError(movementsRes.error))

  const movements = (movementsRes.data ?? []) as unknown as StockMovementRow[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">รับ-จ่ายสต๊อก</h1>
        <p className="text-gray-500 text-sm mt-1">บันทึกการเคลื่อนไหวของสินค้า</p>
      </div>
      <StockClient products={products} movements={movements} initialType={initialType} />
    </div>
  )
}
