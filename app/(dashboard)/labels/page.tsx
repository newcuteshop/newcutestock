import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import LabelsClient, { type LabelProduct } from './LabelsClient'

// PostgREST คืนได้สูงสุด 1,000 แถวต่อครั้ง → ดึงเป็นหน้า ๆ กันสินค้าหายเงียบ ๆ เมื่อมีหลายไซส์/สี
const PAGE_SIZE = 1000
const MAX_PAGES = 20

export default async function LabelsPage() {
  await requirePermission('labels')
  const supabase = createClient()

  const products: LabelProduct[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE
    const { data, error } = await supabase
      .from('products')
      .select('id, name, sku, barcode, size, color, sell_price')
      .eq('is_active', true)
      .order('name')
      .order('id')
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw new Error(thaiError(error))
    const batch = data ?? []
    products.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">พิมพ์สติกเกอร์บาร์โค้ด</h1>
          <p className="page-subtitle">สร้าง PDF สติกเกอร์ติดสินค้า (พิมพ์ชื่อภาษาไทยได้ครบ)</p>
        </div>
      </div>
      <LabelsClient products={products} />
    </div>
  )
}
