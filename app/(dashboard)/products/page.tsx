import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import { fetchAllRows } from '@/lib/fetchAllRows'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { ICON } from '@/components/theme/icons'
import ProductsClient, { type ProductRow, type CategoryOption } from './ProductsClient'

export default async function ProductsPage() {
  await requirePermission('products')
  const supabase = createClient()

  // สินค้าเกิน 1,000 รายการต้องดึงทีละหน้า ไม่งั้นรายการขาดหายเงียบ ๆ
  const [products, categoriesRes] = await Promise.all([
    fetchAllRows<ProductRow>((from, to) => supabase
      .from('products')
      .select('*, categories(name)')
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to)),
    supabase.from('categories').select('id, name').order('name'),
  ])
  if (categoriesRes.error) throw new Error(thaiError(categoriesRes.error))

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">สินค้า</h1>
          <p className="page-subtitle">จัดการข้อมูลสินค้าทั้งหมด</p>
        </div>
        <div className="page-actions">
          <Link href="/products/new" className="btn-primary w-full sm:w-auto">
            <Plus {...ICON} />
            เพิ่มสินค้า
          </Link>
        </div>
      </div>
      <ProductsClient
        initialProducts={products}
        categories={(categoriesRes.data ?? []) as CategoryOption[]}
      />
    </div>
  )
}
