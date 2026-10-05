import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { isMissingSalesColumn } from '@/lib/salesCompat'
import { isMigrationMissing } from '@/lib/migration'
import { loadShopSettings } from '@/lib/shop'
import SalesClient, { type PosProduct, type RecentSale } from './SalesClient'

// คอลัมน์รายการขายล่าสุดตามรุ่นฐานข้อมูล: fix-04 (ยอดคืนเงิน) → fix-03 (ช่องทาง/ยกเลิก) → ตารางเดิม
// ยังไม่ได้รันไฟล์ไหน หน้าขายต้องยังเปิดได้ตามเดิม (แค่ไม่มีป้ายคืนสินค้า/ยกเลิก)
// sale_returns(id) = รหัสใบคืนของบิล — บิลที่คืนของแต่ยอดคืน 0 บาท (ของแถม/บิลส่วนลดเต็ม) ยังได้ป้าย "คืน" ถูกต้อง
const RECENT_COLUMNS = {
  v4: 'id, sale_no, net_amount, payment_method, created_at, channel, voided_at, refunded_amount, sale_returns(id)',
  v3: 'id, sale_no, net_amount, payment_method, created_at, channel, voided_at',
  v0: 'id, sale_no, net_amount, payment_method, created_at',
} as const

export default async function SalesPage() {
  const session = await requirePermission('sales')
  const supabase = createClient()
  // รายการขายล่าสุด + ช่องทางขาย/บิลยกเลิก/ยอดคืนเงิน
  const recentSales = async (columns: string): Promise<{ data: RecentSale[] | null; error: unknown }> => {
    const r = await supabase
      .from('sales')
      .select(columns)
      .order('created_at', { ascending: false })
      .limit(20)
    return { data: (r.data ?? null) as RecentSale[] | null, error: r.error }
  }
  // fix04 = อ่านคอลัมน์/ตารางของ fix-04 ได้จริง → ฐานข้อมูลมี record_sale แบบรับ p_cash_received แน่นอน
  const loadRecent = async () => {
    const v4 = await recentSales(RECENT_COLUMNS.v4)
    if (!v4.error) return { ...v4, fix04: true }
    if (!isMigrationMissing(v4.error)) return { ...v4, fix04: false }
    const v3 = await recentSales(RECENT_COLUMNS.v3)
    const older = v3.error && isMissingSalesColumn(v3.error) ? await recentSales(RECENT_COLUMNS.v0) : v3
    return { ...older, fix04: false }
  }
  // สินค้าเกิน 1,000 รายการ (หลายไซส์/สี) ต้องดึงทีละหน้า ไม่งั้นสแกนตัวที่เกินแล้วขึ้น "ไม่พบสินค้า"
  // ข้อมูลร้าน (หัวใบเสร็จ) โหลดไม่ได้ = ค่าเริ่มต้น — ไม่ทำให้หน้าขายเปิดไม่ได้
  const [products, salesRes, shopRes] = await Promise.all([
    fetchAllRows<PosProduct>((from, to) => supabase
      .from('products')
      .select('id, name, sku, barcode, size, color, sell_price, stock_qty')
      .eq('is_active', true)
      .order('name')
      .order('id')
      .range(from, to)),
    loadRecent(),
    loadShopSettings(supabase),
  ])

  // โหลดไม่ได้ต้องบอกให้ชัด — ห้ามโชว์หน้าขายที่รายการสินค้า/ราคาว่างเปล่าแบบเงียบ ๆ
  // (สินค้าโหลดไม่ได้ fetchAllRows โยน error ภาษาไทยให้เองแล้ว)
  if (salesRes.error) throw new Error(thaiError(salesRes.error))

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">บันทึกการขาย</h1>
          <p className="page-subtitle">POS — แตะสินค้า สแกน หรือพิมพ์รหัสเพื่อเพิ่มลงตะกร้า</p>
        </div>
      </div>
      <SalesClient
        products={products}
        recentSales={salesRes.data ?? []}
        shop={shopRes.settings}
        canRefund={session.permissions.refunds}
        cashArgReady={salesRes.fix04}
      />
    </div>
  )
}
