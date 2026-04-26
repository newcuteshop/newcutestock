import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/permissions'
import SalesClient from './SalesClient'

export default async function SalesPage() {
  await requirePermission('sales')
  const supabase = createClient()
  const [{ data: products }, { data: recentSales }] = await Promise.all([
    supabase.from('products').select('id, name, sku, barcode, sell_price, stock_qty').eq('is_active', true).order('name'),
    supabase.from('sales').select('*, sale_items(*, products(name))').order('created_at', { ascending: false }).limit(20),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">บันทึกการขาย</h1>
        <p className="text-gray-500 text-sm mt-1">POS — บันทึกรายการขายสินค้า</p>
      </div>
      <SalesClient products={products ?? []} recentSales={recentSales ?? []} />
    </div>
  )
}
