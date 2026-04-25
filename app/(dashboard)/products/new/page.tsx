import { createClient } from '@/lib/supabase/server'
import ProductForm from '../ProductForm'

export default async function NewProductPage() {
  const supabase = createClient()
  const { data: categories } = await supabase.from('categories').select('*').order('name')
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">เพิ่มสินค้าใหม่</h1>
        <p className="text-gray-500 text-sm mt-1">กรอกข้อมูลสินค้า</p>
      </div>
      <ProductForm categories={categories ?? []} />
    </div>
  )
}
