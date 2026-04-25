'use client'
import { useMemo } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import { format, eachDayOfInterval, subDays } from 'date-fns'
import { th } from 'date-fns/locale'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler)

interface Sale { net_amount: number; created_at: string; payment_method: string }
interface Product { name: string; stock_qty: number; cost_price: number; sell_price: number; min_stock: number }
interface Movement { type: string; qty: number; created_at: string }

export default function ReportsClient({ sales, products, movements }: {
  sales: Sale[]; products: Product[]; movements: Movement[]
}) {
  const totalRevenue = sales.reduce((s, x) => s + x.net_amount, 0)
  const totalStockValue = products.reduce((s, p) => s + p.stock_qty * p.cost_price, 0)
  const lowStockCount = products.filter(p => p.stock_qty <= p.min_stock).length

  // Revenue by day (last 14 days)
  const last14Days = eachDayOfInterval({ start: subDays(new Date(), 13), end: new Date() })
  const revenueByDay = last14Days.map(day => {
    const dayStr = format(day, 'yyyy-MM-dd')
    return sales.filter(s => s.created_at.startsWith(dayStr)).reduce((s, x) => s + x.net_amount, 0)
  })

  // Payment methods
  const paymentCounts = { cash: 0, transfer: 0, credit: 0 }
  sales.forEach(s => { paymentCounts[s.payment_method as keyof typeof paymentCounts]++ })

  // Low stock products
  const lowStockProducts = products.filter(p => p.stock_qty <= p.min_stock).slice(0, 10)

  const chartOptions = {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true, grid: { color: '#f3f4f6' } }, x: { grid: { display: false } } }
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'รายรับ 30 วัน', value: `฿${totalRevenue.toLocaleString()}`, icon: '💰', color: 'text-green-600' },
          { label: 'มูลค่าสต๊อก', value: `฿${totalStockValue.toLocaleString()}`, icon: '📦', color: 'text-blue-600' },
          { label: 'สต๊อกใกล้หมด', value: `${lowStockCount} รายการ`, icon: '⚠️', color: 'text-orange-600' },
        ].map(c => (
          <div key={c.label} className="card p-5">
            <p className="text-2xl mb-1">{c.icon}</p>
            <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
            <p className="text-sm text-gray-500 mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Revenue Chart */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-900 mb-4">ยอดขาย 14 วันล่าสุด</h2>
        <Bar
          data={{
            labels: last14Days.map(d => format(d, 'd MMM', { locale: th })),
            datasets: [{
              data: revenueByDay,
              backgroundColor: 'rgba(14, 165, 233, 0.8)',
              borderRadius: 6,
              label: 'ยอดขาย (฿)'
            }]
          }}
          options={{ ...chartOptions, plugins: { legend: { display: false }, tooltip: {
            callbacks: { label: ctx => `฿${(ctx.raw as number).toLocaleString()}` }
          }}}}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payment Method */}
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-4">ช่องทางชำระเงิน</h2>
          <div className="flex items-center justify-center">
            <div className="w-48">
              <Doughnut
                data={{
                  labels: ['เงินสด', 'โอนเงิน', 'บัตรเครดิต'],
                  datasets: [{
                    data: [paymentCounts.cash, paymentCounts.transfer, paymentCounts.credit],
                    backgroundColor: ['#22c55e', '#0ea5e9', '#a855f7'],
                    borderWidth: 0,
                  }]
                }}
                options={{ plugins: { legend: { position: 'bottom' } } }}
              />
            </div>
          </div>
        </div>

        {/* Low Stock Table */}
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">⚠️ สต๊อกใกล้หมด</h2>
          </div>
          {lowStockProducts.length === 0
            ? <p className="text-center py-8 text-gray-400">สต๊อกปกติทุกรายการ 👍</p>
            : <table className="w-full text-sm">
                <thead className="bg-gray-50"><tr>
                  <th className="text-left px-4 py-2 font-semibold text-gray-600">สินค้า</th>
                  <th className="text-right px-4 py-2 font-semibold text-gray-600">คงเหลือ</th>
                  <th className="text-right px-4 py-2 font-semibold text-gray-600">ขั้นต่ำ</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {lowStockProducts.map((p, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-900">{p.name}</td>
                      <td className="px-4 py-2 text-right font-bold text-red-500">{p.stock_qty}</td>
                      <td className="px-4 py-2 text-right text-gray-400">{p.min_stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
          }
        </div>
      </div>
    </div>
  )
}
