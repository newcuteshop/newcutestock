import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { sortVariantsBySize, type ProductGroupCard, type ProductVariant } from '@/lib/products'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { ICON } from '@/components/theme/icons'
import type { CategoryOption } from '@/components/products/CategoryBar'
import ProductsClient from './ProductsClient'

// แถวจาก product_groups + ไซส์ปัจจุบัน (products ที่ไม่ถูกเก็บเข้าคลัง) + รูปปก 1 รูป — CONTRACT §5.2
type VariantRow = {
  id: string
  size: string | null
  sku: string
  barcode: string | null
  cost_price: number | string | null
  sell_price: number | string | null
  min_stock: number | string | null
  stock_qty: number | string | null
  is_active: boolean | null
}
type GroupRow = {
  id: string
  name: string
  category_id: string | null
  color: string | null
  has_sizes: boolean
  is_active: boolean
  updated_at: string
  products: VariantRow[] | null
  product_images: { path: string }[] | null
}

// ตัวเลขจากฐานข้อมูล (numeric อาจมาเป็นสตริง) → number เสมอ
function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function toVariant(v: VariantRow): ProductVariant {
  return {
    id: v.id,
    size: v.size,
    sku: v.sku,
    barcode: v.barcode,
    cost_price: num(v.cost_price),
    sell_price: num(v.sell_price),
    min_stock: num(v.min_stock),
    stock_qty: num(v.stock_qty),
    is_active: v.is_active === true,
  }
}

function toCard(g: GroupRow): ProductGroupCard {
  return {
    id: g.id,
    name: g.name,
    category_id: g.category_id,
    color: g.color,
    has_sizes: g.has_sizes === true,
    is_active: g.is_active === true,
    // เวอร์ชันของแบบ — เก็บเป็นสตริงตามที่ได้มา ห้ามแปลงเป็น Date (CONTRACT §2)
    updated_at: g.updated_at,
    variants: sortVariantsBySize((g.products ?? []).map(toVariant)),
    cover_path: g.product_images?.[0]?.path ?? null,
  }
}

export default async function ProductsPage() {
  const session = await requirePermission('products')
  const supabase = createClient()

  // 1 การ์ด = 1 แบบ (product_groups) · แบบเกิน 1,000 รายการต้องดึงทีละหน้า ไม่งั้นรายการขาดหายเงียบ ๆ
  // (ลำดับต้องปิดท้ายด้วยคอลัมน์ไม่ซ้ำ .order('id') กันแถวหาย/ซ้ำข้ามหน้า)
  const [rows, categoriesRes] = await Promise.all([
    fetchAllRows<GroupRow>((from, to) => supabase
      .from('product_groups')
      .select(`id, name, category_id, color, has_sizes, is_active, updated_at,
               products ( id, size, sku, barcode, cost_price, sell_price, min_stock, stock_qty, is_active, is_archived ),
               product_images ( path, sort_order )`)
      // เฉพาะไซส์ปัจจุบัน (ไซส์ที่เลิกใช้ถูกเก็บเข้าคลัง ไม่โชว์บนการ์ด)
      .eq('products.is_archived', false)
      // รูปปก = sort_order น้อยสุด (เสมอกันใช้ created_at แล้ว id) เอามาแค่รูปเดียว
      .order('sort_order', { referencedTable: 'product_images', ascending: true })
      .order('created_at', { referencedTable: 'product_images', ascending: true })
      .order('id', { referencedTable: 'product_images', ascending: true })
      .limit(1, { referencedTable: 'product_images' })
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to)),
    supabase.from('categories').select('id, name').order('name'),
  ])
  if (categoriesRes.error) throw new Error(thaiError(categoriesRes.error))

  const groups = rows.map(toCard)

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
        initialGroups={groups}
        categories={(categoriesRes.data ?? []) as CategoryOption[]}
        canManage={session.permissions.products}
      />
    </div>
  )
}
