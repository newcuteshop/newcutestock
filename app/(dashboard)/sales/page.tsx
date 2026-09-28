import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import { fetchAllRows } from '@/lib/fetchAllRows'
import SalesClient, { type PosProduct } from './SalesClient'

export default async function SalesPage() {
  await requirePermission('sales')
  const supabase = createClient()
  // สินค้าเกิน 1,000 รายการ (หลายไซส์/สี) ต้องดึงทีละหน้า ไม่งั้นสแกนตัวที่เกินแล้วขึ้น "ไม่พบสินค้า"
  const [products, salesRes] = await Promise.all([
    fetchAllRows<PosProduct>((from, to) => supabase
      .from('products')
      .select('id, name, sku, barcode, size, color, sell_price, stock_qty')
      .eq('is_active', true)
      .order('name')
      .order('id')
      .range(from, to)),
    supabase
      .from('sales')
      .select('id, sale_no, net_amount, payment_method, created_at')
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  // โหลดไม่ได้ต้องบอกให้ชัด — ห้ามโชว์หน้าขายที่รายการสินค้า/ราคาว่างเปล่าแบบเงียบ ๆ
  // (สินค้าโหลดไม่ได้ fetchAllRows โยน error ภาษาไทยให้เองแล้ว)
  if (salesRes.error) throw new Error(thaiError(salesRes.error))

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">บันทึกการขาย</h1>
        <p className="text-gray-500 text-sm mt-1">POS — แตะสินค้า สแกน หรือพิมพ์รหัสเพื่อเพิ่มลงตะกร้า</p>
      </div>
      <SalesClient products={products} recentSales={salesRes.data ?? []} />
    </div>
  )
}
