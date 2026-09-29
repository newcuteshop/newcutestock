import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/permissions'
import { productLabel, thaiError } from '@/lib/format'
import { ICON_SM } from '@/components/theme/icons'
import ProductForm from '../ProductForm'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function EditProductPage({ params }: { params: { id: string } }) {
  await requirePermission('products')

  // id ไม่ใช่ uuid → ไม่มีสินค้านี้แน่นอน (ไม่ต้องยิง DB ให้ได้ error 22P02)
  if (!UUID_RE.test(params.id)) notFound()

  const supabase = createClient()
  const [productRes, categoriesRes] = await Promise.all([
    supabase.from('products').select('*').eq('id', params.id).maybeSingle(),
    supabase.from('categories').select('*').order('name'),
  ])

  // ไม่พบ = data เป็น null (maybeSingle ไม่ถือเป็น error) — error อื่นให้ขึ้นหน้า error
  if (productRes.error) throw new Error(thaiError(productRes.error))
  if (categoriesRes.error) throw new Error(thaiError(categoriesRes.error))

  const product = productRes.data
  if (!product) notFound()

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="min-w-0">
        <Link href="/products" className="link text-sm">
          <ArrowLeft {...ICON_SM} />
          กลับไปรายการสินค้า
        </Link>
        <h1 className="page-title">แก้ไขสินค้า</h1>
        <p className="page-subtitle break-words">{productLabel(product)}</p>
      </div>
      <ProductForm categories={categoriesRes.data ?? []} product={product} />
    </div>
  )
}
