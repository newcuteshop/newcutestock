import { createClient } from '@/lib/supabase/server'
import StockClient from './StockClient'

export default async function StockPage() {
  const supabase = createClient()

  const [{ data: products }, { data: movements }] = await Promise.all([
    supabase.from('products').select('id, name, sku, stock_qty').eq('is_active', true).order('name'),
    supabase.from('stock_movements')
      .select('*, products(name, sku)')
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">รับ-จ่ายสต๊อก</h1>
        <p className="text-gray-500 text-sm mt-1">บันทึกการเคลื่อนไหวของสินค้า</p>
      </div>
      <StockClient products={products ?? []} movements={movements ?? []} />
    </div>
  )
}
