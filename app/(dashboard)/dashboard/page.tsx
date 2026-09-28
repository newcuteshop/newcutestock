import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/permissions'
import { baht, bangkokDayStartISO, productLabel } from '@/lib/format'
import { fetchAllRows } from '@/lib/fetchAllRows'

type ProductRow = {
  id: string
  name: string
  sku: string
  size: string | null
  color: string | null
  stock_qty: number
  min_stock: number
  cost_price: number
}
type SaleRow = { net_amount: number }

type StatCard = {
  label: string
  value: string
  sub?: string
  icon: string
  color: string
  href: string | null
}

type QuickAction = { href: string; label: string; icon: string; primary: boolean }

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function StatCardView({ card }: { card: StatCard }) {
  const body = (
    <>
      <div className={`inline-flex w-9 h-9 sm:w-10 sm:h-10 rounded-xl items-center justify-center text-lg sm:text-xl mb-2 sm:mb-3 ${card.color}`}>
        <span aria-hidden="true">{card.icon}</span>
      </div>
      <p className="text-lg sm:text-2xl font-bold text-gray-900 break-words leading-tight">{card.value}</p>
      <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
        {card.label}
        {card.sub && <span className="text-gray-400"> · {card.sub}</span>}
      </p>
    </>
  )
  return card.href
    ? <Link href={card.href} className="card p-3 sm:p-5 block hover:shadow-md transition-shadow">{body}</Link>
    : <div className="card p-3 sm:p-5">{body}</div>
}

export default async function DashboardPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  const { permissions, role } = session
  const isAdmin = role === 'admin'
  const canSeeStockValue = isAdmin || permissions.reports

  // บัญชีที่ยังไม่มีสิทธิ์ใดๆ ฐานข้อมูลไม่ให้อ่านข้อมูลร้านอยู่แล้ว (is_member) — ไม่ต้องดึง/ไม่โชว์การ์ดตัวเลข 0 ที่ชวนเข้าใจผิด
  const hasAnyPermission = isAdmin || Object.values(permissions).some(Boolean)
  if (!hasAnyPermission) {
    return (
      <div className="space-y-4 sm:space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">ภาพรวม</h1>
          <p className="text-gray-500 text-sm mt-1">ข้อมูลสรุปของวันนี้</p>
        </div>
        <div className="card p-4 border-orange-200 bg-orange-50 text-sm text-orange-800">
          บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งานเมนูใดๆ กรุณาติดต่อผู้ดูแลระบบเพื่อกำหนดสิทธิ์
        </div>
      </div>
    )
  }

  const supabase = createClient()
  // เริ่มวันตามเวลาไทย (ไม่ใช่ UTC) — ยอดขายวันนี้ตั้งแต่ 00:00 น. เวลาไทย
  const todayStart = bangkokDayStartISO()

  const [products, todaySales] = await Promise.all([
    fetchAllRows<ProductRow>((from, to) => supabase
      .from('products')
      .select('id, name, sku, size, color, stock_qty, min_stock, cost_price')
      .eq('is_active', true)
      .order('id')
      .range(from, to)),
    fetchAllRows<SaleRow>((from, to) => supabase
      .from('sales')
      .select('net_amount')
      .gte('created_at', todayStart)
      .order('created_at')
      .order('id')
      .range(from, to)),
  ])

  // คำนวณใน JS — PostgREST เทียบคอลัมน์กับคอลัมน์ (stock_qty <= min_stock) ไม่ได้
  const totalProducts = products.length
  const totalStockValue = round2(products.reduce((s, p) => s + Math.max(0, num(p.stock_qty)) * num(p.cost_price), 0))
  const lowStock = products
    .filter(p => num(p.stock_qty) <= num(p.min_stock))
    .sort((a, b) => num(a.stock_qty) - num(b.stock_qty))
  const lowStockTop = lowStock.slice(0, 5)
  const todayRevenue = round2(todaySales.reduce((s, x) => s + num(x.net_amount), 0))
  const todayBills = todaySales.length

  const statCards: StatCard[] = [
    {
      label: 'สินค้าทั้งหมด',
      value: `${totalProducts.toLocaleString('en-US')} รายการ`,
      icon: '👕',
      color: 'bg-blue-50 text-blue-700',
      href: permissions.products ? '/products' : null,
    },
  ]
  // มูลค่าสต๊อก (ราคาทุน) เห็นเฉพาะ admin หรือผู้มีสิทธิ์ดูรายงาน
  if (canSeeStockValue) {
    statCards.push({
      label: 'มูลค่าสต๊อก (ทุน)',
      value: baht(totalStockValue),
      icon: '💰',
      color: 'bg-green-50 text-green-700',
      href: permissions.reports ? '/reports' : null,
    })
  }
  statCards.push(
    {
      label: 'สต๊อกใกล้หมด',
      value: `${lowStock.length.toLocaleString('en-US')} รายการ`,
      icon: '⚠️',
      color: 'bg-orange-50 text-orange-700',
      href: permissions.stock ? '/stock' : permissions.reports ? '/reports' : null,
    },
    {
      label: 'ยอดขายวันนี้',
      value: baht(todayRevenue),
      sub: `${todayBills.toLocaleString('en-US')} บิล`,
      icon: '🛒',
      color: 'bg-purple-50 text-purple-700',
      href: permissions.sales ? '/sales' : permissions.reports ? '/reports' : null,
    },
  )

  const quickActions: QuickAction[] = []
  if (permissions.sales) quickActions.push({ href: '/sales', label: 'บันทึกการขาย', icon: '🛒', primary: true })
  if (permissions.stock) quickActions.push({ href: '/stock?action=in', label: 'รับสินค้าเข้า', icon: '📦', primary: false })
  if (permissions.products) quickActions.push({ href: '/products/new', label: 'เพิ่มสินค้าใหม่', icon: '➕', primary: false })

  const lowStockHref = permissions.stock ? '/stock' : permissions.reports ? '/reports' : null

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">ภาพรวม</h1>
        <p className="text-gray-500 text-sm mt-1">ข้อมูลสรุปของวันนี้</p>
      </div>

      {/* Stat Cards */}
      <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${statCards.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        {statCards.map(card => <StatCardView key={card.label} card={card} />)}
      </div>

      {/* Quick Actions */}
      {quickActions.length > 0 && (
        <div className="card p-4 sm:p-5">
          <h2 className="font-semibold text-gray-900 mb-3 sm:mb-4">ทำรายการด่วน</h2>
          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:gap-3">
            {quickActions.map(a => (
              <Link key={a.href} href={a.href} className={a.primary ? 'btn-primary' : 'btn-secondary'}>
                <span aria-hidden="true">{a.icon}</span> {a.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Low Stock Warning */}
      {lowStockTop.length > 0 && (
        <div className="card p-4 sm:p-5">
          <h2 className="font-semibold text-gray-900 mb-2 sm:mb-4 flex items-center gap-2">
            <span aria-hidden="true">⚠️</span> สินค้าสต๊อกใกล้หมด
            <span className="text-sm font-normal text-gray-400">({lowStock.length.toLocaleString('en-US')} รายการ)</span>
          </h2>
          <div className="divide-y divide-gray-50">
            {lowStockTop.map(item => {
              const qty = num(item.stock_qty)
              return (
                <div key={item.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 text-sm break-words">{productLabel(item)}</p>
                    <p className="text-xs text-gray-400 truncate">SKU: {item.sku}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-red-500">{qty <= 0 ? 'หมด' : `${qty.toLocaleString('en-US')} ชิ้น`}</p>
                    <p className="text-xs text-gray-400">ขั้นต่ำ: {num(item.min_stock).toLocaleString('en-US')}</p>
                  </div>
                </div>
              )
            })}
          </div>
          {lowStockHref && (
            <Link
              href={lowStockHref}
              className="inline-flex items-center min-h-[40px] text-brand-600 text-sm font-medium hover:underline mt-1"
            >
              ดูทั้งหมด →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
