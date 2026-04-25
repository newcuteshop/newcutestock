import { createClient } from '@/lib/supabase/server'
import ReportsClient from './ReportsClient'

export default async function ReportsPage() {
  const supabase = createClient()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: sales }, { data: products }, { data: movements }] = await Promise.all([
    supabase.from('sales').select('net_amount, created_at, payment_method').gte('created_at', thirtyDaysAgo).order('created_at'),
    supabase.from('products').select('name, stock_qty, cost_price, sell_price, min_stock').eq('is_active', true).order('stock_qty'),
    supabase.from('stock_movements').select('type, qty, created_at').gte('created_at', thirtyDaysAgo),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">รายงาน</h1>
        <p className="text-gray-500 text-sm mt-1">สรุปข้อมูลย้อนหลัง 30 วัน</p>
      </div>
      <ReportsClient sales={sales ?? []} products={products ?? []} movements={movements ?? []} />
    </div>
  )
}
