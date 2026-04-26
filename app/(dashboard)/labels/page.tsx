import { createClient } from '@/lib/supabase/server'
import LabelsClient from './LabelsClient'

export default async function LabelsPage() {
  const supabase = createClient()
  const { data: products } = await supabase
    .from('products')
    .select('id, name, sku, barcode, sell_price')
    .eq('is_active', true)
    .order('name')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">พิมพ์สติกเกอร์บาร์โค้ด</h1>
        <p className="text-gray-500 text-sm mt-1">สร้าง PDF สติกเกอร์ติดสินค้า</p>
      </div>
      <LabelsClient products={products ?? []} />
    </div>
  )
}
