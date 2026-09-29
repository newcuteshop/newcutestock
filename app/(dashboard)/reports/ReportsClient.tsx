'use client'
import { useMemo } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import { baht, bangkokDateKey, productLabel } from '@/lib/format'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

// วันในกราฟ (key = 'YYYY-MM-DD' เวลาไทย, label คำนวณจากเซิร์ฟเวอร์แล้ว)
export interface ReportDay { key: string; label: string }
export interface ReportSale { id: string; net_amount: number; created_at: string; payment_method: string }
export interface ReportProduct {
  id: string
  name: string
  sku: string
  size: string | null
  color: string | null
  stock_qty: number
  cost_price: number
  min_stock: number
}

const PAYMENT_METHODS: { key: string; label: string; color: string }[] = [
  { key: 'cash',     label: 'เงินสด',     color: '#22c55e' },
  { key: 'transfer', label: 'โอนเงิน',    color: '#0ea5e9' },
  { key: 'credit',   label: 'บัตรเครดิต', color: '#a855f7' },
]

const LOW_STOCK_LIMIT = 10

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export default function ReportsClient({ days, rangeDays, sales, products }: {
  days: ReportDay[]
  rangeDays: number
  sales: ReportSale[]
  products: ReportProduct[]
}) {
  const report = useMemo(() => {
    // ยอดขายรายวัน — จัดกลุ่มตามวันที่เวลาไทย (ไม่ใช่ตัด string UTC)
    const dayIndex = new Map<string, number>()
    days.forEach((d, i) => { dayIndex.set(d.key, i) })
    const revenueByDay = days.map(() => 0)

    // ช่องทางชำระเงิน — รวมเป็นบาท + นับจำนวนบิล
    const payments = PAYMENT_METHODS.map(m => ({ ...m, amount: 0, count: 0 }))

    let totalRevenue = 0
    for (const s of sales) {
      const amount = num(s.net_amount)
      totalRevenue += amount
      const i = dayIndex.get(bangkokDateKey(s.created_at))
      if (i !== undefined) revenueByDay[i] += amount
      const p = payments.find(x => x.key === s.payment_method)
      if (p) {
        p.amount += amount
        p.count += 1
      }
    }

    const totalStockValue = products.reduce((sum, p) => sum + Math.max(0, num(p.stock_qty)) * num(p.cost_price), 0)
    const lowStock = products
      .filter(p => num(p.stock_qty) <= num(p.min_stock))
      .sort((a, b) => num(a.stock_qty) - num(b.stock_qty))

    return {
      totalRevenue: round2(totalRevenue),
      billCount: sales.length,
      totalStockValue: round2(totalStockValue),
      revenueByDay: revenueByDay.map(round2),
      payments: payments.map(p => ({ ...p, amount: round2(p.amount) })),
      paymentTotal: round2(payments.reduce((sum, p) => sum + p.amount, 0)),
      lowStock,
    }
  }, [days, sales, products])

  const { payments, paymentTotal, lowStock } = report
  const lowStockShown = lowStock.slice(0, LOW_STOCK_LIMIT)

  const summaryCards = [
    { label: `รายรับ ${rangeDays} วัน`, value: baht(report.totalRevenue), sub: `${report.billCount.toLocaleString('en-US')} บิล`, icon: '💰', color: 'text-green-600', wide: true },
    { label: 'มูลค่าสต๊อก (ทุน)', value: baht(report.totalStockValue), sub: '', icon: '📦', color: 'text-blue-600', wide: false },
    { label: 'สต๊อกใกล้หมด', value: `${lowStock.length.toLocaleString('en-US')} รายการ`, sub: '', icon: '⚠️', color: 'text-orange-600', wide: false },
  ]

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 xl:gap-6">
        {summaryCards.map(c => (
          <div key={c.label} className={`card p-4 sm:p-5 ${c.wide ? 'col-span-2 sm:col-span-1' : ''}`}>
            <p className="text-xl sm:text-2xl mb-1" aria-hidden="true">{c.icon}</p>
            <p className={`text-lg sm:text-2xl font-bold break-words leading-tight ${c.color}`}>{c.value}</p>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
              {c.label}
              {c.sub && <span className="text-gray-400"> · {c.sub}</span>}
            </p>
          </div>
        ))}
      </div>

      {/* lg: กราฟยอดขายเต็มแถว + ช่องทางชำระ/สต๊อกใกล้หมดคู่กัน
          xl+: กราฟยอดขาย (2 ส่วน) + ช่องทางชำระ (1 ส่วน) แถวเดียวกัน แล้วสต๊อกใกล้หมดเต็มแถวด้านล่าง */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
        {/* Revenue Chart */}
        <div className="card p-4 sm:p-5 lg:col-span-2">
          <h2 className="font-semibold text-gray-900 mb-3 sm:mb-4">ยอดขาย {days.length} วันล่าสุด</h2>
          <div className="relative h-56 sm:h-72">
            <Bar
              data={{
                labels: days.map(d => d.label),
                datasets: [{
                  label: 'ยอดขาย (บาท)',
                  data: report.revenueByDay,
                  backgroundColor: 'rgba(14, 165, 233, 0.8)',
                  borderRadius: 6,
                }],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: { callbacks: { label: ctx => ` ${baht(num(ctx.raw))}` } },
                },
                scales: {
                  y: {
                    beginAtZero: true,
                    grid: { color: '#f3f4f6' },
                    ticks: { callback: value => baht(num(value)) },
                  },
                  x: {
                    grid: { display: false },
                    ticks: { maxRotation: 0, autoSkipPadding: 8 },
                  },
                },
              }}
            />
          </div>
        </div>

        {/* Payment Method — ยอดเงิน (บาท) แยกตามช่องทาง */}
        <div className="card p-4 sm:p-5">
          <h2 className="font-semibold text-gray-900 mb-3 sm:mb-4">ช่องทางชำระเงิน ({rangeDays} วัน)</h2>
          {paymentTotal <= 0
            ? <p className="text-center py-8 text-gray-400">ยังไม่มีการขายในช่วงนี้</p>
            : (
              <div className="flex flex-col sm:flex-row lg:flex-col items-center gap-4 sm:gap-6">
                <div className="relative w-40 h-40 sm:w-48 sm:h-48 shrink-0">
                  <Doughnut
                    data={{
                      labels: payments.map(p => p.label),
                      datasets: [{
                        data: payments.map(p => p.amount),
                        backgroundColor: payments.map(p => p.color),
                        borderWidth: 0,
                      }],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      cutout: '60%',
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          callbacks: {
                            label: ctx => {
                              const p = payments[ctx.dataIndex]
                              if (!p) return ''
                              return ` ${p.label}: ${baht(p.amount)} (${p.count.toLocaleString('en-US')} บิล)`
                            },
                          },
                        },
                      },
                    }}
                  />
                </div>
                {/* Legend: ยอดบาท + จำนวนบิล + สัดส่วน */}
                <ul className="w-full space-y-2">
                  {payments.map(p => (
                    <li key={p.key} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} aria-hidden="true" />
                        <span className="text-gray-700">{p.label}</span>
                        <span className="text-gray-400 text-xs whitespace-nowrap">{p.count.toLocaleString('en-US')} บิล</span>
                      </span>
                      <span className="text-right whitespace-nowrap">
                        <span className="font-semibold text-gray-900">{baht(p.amount)}</span>
                        <span className="text-gray-400 text-xs ml-1">
                          {((p.amount / paymentTotal) * 100).toFixed(0)}%
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          }
        </div>

        {/* Low Stock Table */}
        <div className="card overflow-hidden xl:col-span-3">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-2">
            <h2 className="font-semibold text-gray-900">⚠️ สต๊อกใกล้หมด</h2>
            {lowStock.length > LOW_STOCK_LIMIT && (
              <span className="text-xs text-gray-400">แสดง {LOW_STOCK_LIMIT} จาก {lowStock.length.toLocaleString('en-US')} รายการ</span>
            )}
          </div>
          {lowStockShown.length === 0
            ? <p className="text-center py-8 text-gray-400">สต๊อกปกติทุกรายการ 👍</p>
            : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[340px] text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-4 xl:px-6 py-2 font-semibold text-gray-600">สินค้า</th>
                      <th className="hidden xl:table-cell text-left px-4 xl:px-6 py-2 font-semibold text-gray-600">SKU</th>
                      <th className="text-right px-4 xl:px-6 py-2 font-semibold text-gray-600 whitespace-nowrap">คงเหลือ</th>
                      <th className="text-right px-4 xl:px-6 py-2 font-semibold text-gray-600 whitespace-nowrap">ขั้นต่ำ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {lowStockShown.map(p => {
                      const qty = num(p.stock_qty)
                      return (
                        <tr key={p.id} className="hover:bg-gray-50">
                          <td className="px-4 xl:px-6 py-2">
                            <p className="text-gray-900 break-words">{productLabel(p)}</p>
                            <p className="text-xs text-gray-400 xl:hidden">SKU: {p.sku}</p>
                          </td>
                          <td className="hidden xl:table-cell px-4 xl:px-6 py-2 text-xs text-gray-500 font-mono break-all">{p.sku}</td>
                          <td className="px-4 xl:px-6 py-2 text-right font-bold text-red-500 whitespace-nowrap">
                            {qty <= 0 ? 'หมด' : qty.toLocaleString('en-US')}
                          </td>
                          <td className="px-4 xl:px-6 py-2 text-right text-gray-400">{num(p.min_stock).toLocaleString('en-US')}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        </div>
      </div>
    </div>
  )
}
