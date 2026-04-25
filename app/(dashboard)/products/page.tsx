import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import ProductsClient from './ProductsClient'

export default async function ProductsPage() {
  const supabase = createClient()
  const { data: products } = await supabase
    .from('products')
    .select('*, categories(name)')
    .order('created_at', { ascending: false })

  const { data: categories } = await supabase.from('categories').select('*').order('name')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">สินค้า</h1>
          <p className="text-gray-500 text-sm mt-1">จัดการข้อมูลสินค้าทั้งหมด</p>
        </div>
        <Link href="/products/new" className="btn-primary flex items-center gap-2">
          <span>➕</span> เพิ่มสินค้า
        </Link>
      </div>
      <ProductsClient initialProducts={products ?? []} categories={categories ?? []} />
    </div>
  )
}
