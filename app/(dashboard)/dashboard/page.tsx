import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

async function getStats() {
  const supabase = createClient()
  const today = new Date().toISOString().split('T')[0]

  const [products, lowStock, todaySales] = await Promise.all([
    supabase.from('products').select('id, stock_qty, cost_price').eq('is_active', true),
    supabase.from('products').select('id').eq('is_active', true).filter('stock_qty', 'lte', 'min_stock'),
    supabase.from('sales').select('net_amount').gte('created_at', today),
  ])

  const totalProducts = products.data?.length ?? 0
  const totalStockValue = products.data?.reduce((s, p) => s + p.stock_qty * p.cost_price, 0) ?? 0
  const lowStockCount = lowStock.data?.length ?? 0
  const todayRevenue = todaySales.data?.reduce((s, p) => s + p.net_amount, 0) ?? 0
  const todaySalesCount = todaySales.data?.length ?? 0

  return { totalProducts, totalStockValue, lowStockCount, todayRevenue, todaySalesCount }
}

async function getLowStockProducts() {
  const supabase = createClient()
  const { data } = await supabase
    .from('products')
    .select('id, name, sku, stock_qty, min_stock')
    .eq('is_active', true)
    .filter('stock_qty', 'lte', 'min_stock')
    .order('stock_qty', { ascending: true })
    .limit(5)
  return data ?? []
}

export default async function DashboardPage() {
  const [stats, lowStockItems] = await Promise.all([getStats(), getLowStockProducts()])

  const statCards = [
    { label: 'สินค้าทั้งหมด',    value: `${stats.totalProducts} รายการ`, icon: '👕', color: 'bg-blue-50 text-blue-700',   href: '/products' },
    { label: 'มูลค่าสต๊อก',      value: `฿${stats.totalStockValue.toLocaleString()}`, icon: '💰', color: 'bg-green-50 text-green-700', href: '/reports' },
    { label: 'สต๊อกใกล้หมด',     value: `${stats.lowStockCount} รายการ`, icon: '⚠️', color: 'bg-orange-50 text-orange-700', href: '/stock' },
    { label: 'ยอดขายวันนี้',      value: `฿${stats.todayRevenue.toLocaleString()}`, icon: '🛒', color: 'bg-purple-50 text-purple-700', href: '/sales' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">ภาพรวม</h1>
        <p className="text-gray-500 text-sm mt-1">ข้อมูลสรุปของวันนี้</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(card => (
          <Link key={card.label} href={card.href} className="card p-5 hover:shadow-md transition-shadow block">
            <div className={`inline-flex w-10 h-10 rounded-xl items-center justify-center text-xl mb-3 ${card.color}`}>
              {card.icon}
            </div>
            <p className="text-2xl font-bold text-gray-900">{card.value}</p>
            <p className="text-sm text-gray-500 mt-0.5">{card.label}</p>
          </Link>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-900 mb-4">ทำรายการด่วน</h2>
        <div className="flex flex-wrap gap-3">
          <Link href="/sales" className="btn-primary flex items-center gap-2">
            <span>🛒</span> บันทึกการขาย
          </Link>
          <Link href="/stock?action=in" className="btn-secondary flex items-center gap-2">
            <span>📦</span> รับสินค้าเข้า
          </Link>
          <Link href="/products/new" className="btn-secondary flex items-center gap-2">
            <span>➕</span> เพิ่มสินค้าใหม่
          </Link>
        </div>
      </div>

      {/* Low Stock Warning */}
      {lowStockItems.length > 0 && (
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span>⚠️</span> สินค้าสต๊อกใกล้หมด
          </h2>
          <div className="divide-y divide-gray-50">
            {lowStockItems.map(item => (
              <div key={item.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium text-gray-900 text-sm">{item.name}</p>
                  <p className="text-xs text-gray-400">SKU: {item.sku}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-red-500">{item.stock_qty} ชิ้น</p>
                  <p className="text-xs text-gray-400">ขั้นต่ำ: {item.min_stock}</p>
                </div>
              </div>
            ))}
          </div>
          <Link href="/stock" className="text-brand-600 text-sm font-medium hover:underline mt-2 block">
            ดูทั้งหมด →
          </Link>
        </div>
      )}
    </div>
  )
}
