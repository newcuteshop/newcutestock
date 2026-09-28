import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import ProductForm from '../ProductForm'

export default async function NewProductPage() {
  await requirePermission('products')

  const supabase = createClient()
  const { data: categories, error } = await supabase.from('categories').select('*').order('name')
  if (error) throw new Error(thaiError(error))

  return (
    <div className="space-y-4 sm:space-y-6 max-w-2xl">
      <div>
        <Link
          href="/products"
          className="inline-flex items-center gap-1 min-h-[40px] text-sm text-brand-600 hover:underline"
        >
          ← กลับไปรายการสินค้า
        </Link>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">เพิ่มสินค้าใหม่</h1>
        <p className="text-gray-500 text-sm mt-1">กรอกข้อมูลสินค้า</p>
      </div>
      <ProductForm categories={categories ?? []} />
    </div>
  )
}
