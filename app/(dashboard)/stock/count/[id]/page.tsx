import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { isMigrationMissing } from '@/lib/migration'
import { num } from '@/lib/money'
import { parseStockCount } from '@/lib/pos'
import MigrationNotice from '@/components/pos/MigrationNotice'
import CountClient, { type CountProduct } from './CountClient'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// get_stock_count ไม่พบรอบ → raise 'ไม่พบรอบตรวจนับนี้' (P0001)
function isCountNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const message = (err as { message?: unknown }).message
  return typeof message === 'string' && message.includes('ไม่พบรอบตรวจนับ')
}

function toProduct(raw: unknown): CountProduct | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) return null
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
  return {
    id: r.id,
    group_id: str(r.group_id),
    name: typeof r.name === 'string' ? r.name : '',
    sku: typeof r.sku === 'string' ? r.sku : '',
    barcode: str(r.barcode),
    size: str(r.size),
    color: str(r.color),
    category_id: str(r.category_id),
    stock_qty: Math.trunc(num(r.stock_qty)),
    cost_price: num(r.cost_price),
  }
}

// /stock/count/<id> — หน้านับสินค้าของรอบนั้น (สแกน/กรอกจำนวน → ปรับยอด)
export default async function StockCountPage({ params }: { params: { id: string } }) {
  const session = await requirePermission('stock')

  // id ไม่ใช่ uuid → ไม่มีรอบนี้แน่นอน (ไม่ต้องยิง DB ให้ได้ error 22P02)
  if (!UUID_RE.test(params.id)) notFound()
  const id = params.id.toLowerCase()

  const supabase = createClient()
  const countRes = await supabase.rpc('get_stock_count', { p_count_id: id })
  if (countRes.error) {
    if (isMigrationMissing(countRes.error)) {
      return <MigrationNotice title="ตรวจนับสต๊อก" subtitle="นับสินค้าจริงแล้วปรับยอดในระบบให้ตรง" />
    }
    if (isCountNotFound(countRes.error)) notFound()
    throw new Error(thaiError(countRes.error))
  }
  const count = parseStockCount(countRes.data)
  if (!count) notFound()

  // สินค้าที่นับได้ทั้งหมด (สแกน/ค้นหา + รายการ "ยังไม่นับ") — เกิน 1,000 SKU ต้องดึงทีละหน้า
  // รอบที่ปรับยอด/ยกเลิกแล้วเป็นหน้าอ่านอย่างเดียว ใช้แค่บรรทัดของรอบ → ไม่ต้องดึงสินค้าทั้งร้าน
  const rows = count.status !== 'open' ? [] : await fetchAllRows<unknown>((from, to) => supabase.from('products')
    .select('id, group_id, name, sku, barcode, size, color, category_id, stock_qty, cost_price')
    .eq('is_active', true)
    .eq('is_archived', false)
    .order('name')
    .order('id')
    .range(from, to))
  const products: CountProduct[] = []
  for (const r of rows) {
    const p = toProduct(r)
    if (p) products.push(p)
  }

  return (
    <CountClient
      initialCount={count}
      products={products}
      showCost={session.role === 'admin' || session.permissions.reports}
      loadedAt={Date.now()}
    />
  )
}
