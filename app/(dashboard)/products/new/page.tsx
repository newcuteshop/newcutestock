import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import { ICON_SM } from '@/components/theme/icons'
import ProductForm from '../ProductForm'

export default async function NewProductPage() {
  await requirePermission('products')

  const supabase = createClient()
  const { data: categories, error } = await supabase.from('categories').select('*').order('name')
  if (error) throw new Error(thaiError(error))

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <Link href="/products" className="link text-sm">
          <ArrowLeft {...ICON_SM} />
          กลับไปรายการสินค้า
        </Link>
        <h1 className="page-title">เพิ่มสินค้าใหม่</h1>
        <p className="page-subtitle">กรอกข้อมูลสินค้า</p>
      </div>
      <ProductForm categories={categories ?? []} />
    </div>
  )
}
