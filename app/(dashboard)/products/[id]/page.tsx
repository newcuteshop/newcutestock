import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import { parseGroupJson } from '@/lib/products'
import ProductForm from '../ProductForm'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// /products/<id> — id = รหัส "แบบสินค้า" (product_groups) · ลิงก์เก่าที่เป็น id ของ SKU จะถูกพาไปแบบสินค้าของมัน
export default async function EditProductPage({
  params, searchParams,
}: {
  params: { id: string }
  searchParams?: { saved?: string | string[] }
}) {
  const session = await requirePermission('products')

  // id ไม่ใช่ uuid → ไม่มีสินค้านี้แน่นอน (ไม่ต้องยิง DB ให้ได้ error 22P02)
  if (!UUID_RE.test(params.id)) notFound()
  const id = params.id.toLowerCase()

  const supabase = createClient()
  const [groupRes, categoriesRes] = await Promise.all([
    supabase.rpc('get_product_group', { p_group_id: id }),
    supabase.from('categories').select('id, name').order('name'),
  ])
  if (groupRes.error) throw new Error(thaiError(groupRes.error))
  if (categoriesRes.error) throw new Error(thaiError(categoriesRes.error))

  const raw: unknown = groupRes.data
  const group = raw === null || raw === undefined ? null : parseGroupJson(raw)
  if (raw !== null && raw !== undefined && !group) throw new Error('ข้อมูลสินค้าไม่ถูกต้อง กรุณาโหลดหน้าใหม่')

  if (!group) {
    // ไม่ใช่แบบสินค้า → ลองเป็น id ของ SKU (ลิงก์เดิมก่อนมีระบบไซส์) แล้วพาไปหน้าแบบสินค้าของ SKU นั้น
    const legacy = await supabase.from('products').select('group_id').eq('id', id).maybeSingle()
    if (legacy.error) throw new Error(thaiError(legacy.error))
    const gid = legacy.data && typeof legacy.data.group_id === 'string' ? legacy.data.group_id : null
    if (gid && gid.toLowerCase() !== id) redirect(`/products/${gid}`)
    notFound()
  }

  const savedParam = typeof searchParams?.saved === 'string' ? searchParams.saved : null
  const savedNotice = savedParam === 'new' || savedParam === 'again' ? savedParam : null

  return (
    <ProductForm
      categories={categoriesRes.data ?? []}
      canStock={session.permissions.stock}
      initial={group}
      savedNotice={savedNotice}
    />
  )
}
