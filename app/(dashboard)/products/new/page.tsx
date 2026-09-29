import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import ProductForm from '../ProductForm'

export default async function NewProductPage() {
  const session = await requirePermission('products')

  const supabase = createClient()
  const { data: categories, error } = await supabase.from('categories').select('id, name').order('name')
  if (error) throw new Error(thaiError(error))

  // หัวเรื่อง/ปุ่มกลับอยู่ในฟอร์ม (หลังบันทึกสินค้าใหม่ ฟอร์มเปลี่ยนเป็นโหมดแก้ไขได้ทันที)
  return <ProductForm categories={categories ?? []} canStock={session.permissions.stock} />
}
