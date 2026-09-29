'use client'
import { useMemo } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  AlertTriangle, BarChart3, Coins, CreditCard, PackageCheck, ReceiptText, Wallet, type LucideIcon,
} from 'lucide-react'
import { baht, bangkokDateKey, productLabel } from '@/lib/format'
import { ICON } from '@/components/theme/icons'
import { PAYMENT_METHOD_LABELS } from '@/lib/integrations/labels'

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

// สีช่องทางชำระ (ธีมสตรอว์เบอร์รีมิลค์) — ต่างกันที่ความเข้มด้วย ไม่พึ่งสีอย่างเดียว: เงินสด = กุหลาบ, โอน = ชมพูอ่อน, บัตร = เบอร์รีเข้ม
const PAYMENT_METHODS: { key: string; label: string; color: string }[] = [
  { key: 'cash',     label: 'เงินสด',     color: '#B23A5E' },
  { key: 'transfer', label: 'โอนเงิน',    color: '#F4A7BB' },
  { key: 'credit',   label: 'บัตรเครดิต', color: '#5C2336' },
  { key: 'marketplace', label: PAYMENT_METHOD_LABELS.marketplace, color: '#D9738F' },
]

// สีกราฟแท่ง / เส้นตาราง / ตัวเลขแกน / กล่องทิป
const CHART = {
  bar: 'rgba(178, 58, 94, 0.85)',
  barHover: '#9A2F52',
  grid: '#FBE9EE',
  tick: '#704453',
  tooltipBg: '#5C2336',
}

type SummaryCard = {
  label: string
  value: string
  unit: string
  sub: string
  icon: LucideIcon
  bubble: string
  hot: boolean
  wide: boolean
}

// next/font ตั้งชื่อฟอนต์แบบสุ่ม (__Sarabun_xxxx) ไว้ในตัวแปร CSS บน <body> — canvas ต้องใช้ชื่อจริง จึงอ่านจากตัวแปรนั้น
function themeFont(cssVar: '--font-sans' | '--font-display', fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const family = getComputedStyle(document.body).getPropertyValue(cssVar).trim()
  return family ? `${family}, ${fallback}` : fallback
}

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

  // การ์ดสรุป: ฟองไอคอนตามความหมาย + แสงวาวกระโดดเหลื่อมจังหวะ (รวมโลโก้เมนูไม่เกิน 4 ฟองต่อจอ)
  const summaryCards: SummaryCard[] = [
    { label: `รายรับ ${rangeDays} วัน`, value: baht(report.totalRevenue), unit: '', sub: `${report.billCount.toLocaleString('en-US')} บิล`, icon: Wallet, bubble: 'icon-bubble-strong hop', hot: true, wide: true },
    { label: 'มูลค่าสต๊อก (ทุน)', value: baht(report.totalStockValue), unit: '', sub: '', icon: Coins, bubble: 'hop hop-2', hot: false, wide: false },
    { label: 'สต๊อกใกล้หมด', value: lowStock.length.toLocaleString('en-US'), unit: 'รายการ', sub: '', icon: AlertTriangle, bubble: 'icon-bubble-warn hop hop-3', hot: false, wide: false },
  ]

  // ฟอนต์ของกราฟอ่านตอนวาด (ฝั่งเบราว์เซอร์) — ฝั่งเซิร์ฟเวอร์ใช้ชื่อสำรอง (canvas ไม่ถูกเรนเดอร์บนเซิร์ฟเวอร์อยู่แล้ว)
  const bodyFont = themeFont('--font-sans', 'Sarabun, sans-serif')
  const displayFont = themeFont('--font-display', 'Kodchasan, Sarabun, sans-serif')
  const tooltipTheme = {
    backgroundColor: CHART.tooltipBg,
    titleColor: '#FFFFFF',
    bodyColor: '#FFFFFF',
    titleFont: { family: displayFont, size: 13, weight: 700 },
    bodyFont: { family: bodyFont, size: 13 },
    padding: 10,
    cornerRadius: 14,
    boxPadding: 4,
    displayColors: false,
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 xl:gap-6">
        {summaryCards.map(c => {
          const Icon = c.icon
          return (
            <div key={c.label} className={`stat-card ${c.hot ? 'stat-card-hot' : ''} ${c.wide ? 'col-span-2 lg:col-span-1' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <span className={`stat-label min-w-0 pt-1 ${c.hot ? 'text-gray-600' : ''}`}>{c.label}</span>
                <span className={`icon-bubble ${c.bubble}`}><Icon {...ICON} /></span>
              </div>
              <p className="stat-value">
                {/* ตัวเลขห้ามแยกบรรทัดกลางจำนวน — หน่วย/บิลขึ้นบรรทัดใหม่ได้ แต่ "· 7 บิล" ไปทั้งก้อน */}
                <span className="whitespace-nowrap">{c.value}</span>
                {c.unit && <span className="stat-sub font-sans font-normal"> {c.unit}</span>}
                {c.sub && <span className={`stat-sub font-sans font-normal ${c.hot ? 'text-gray-600' : ''}`}> <span className="whitespace-nowrap">· {c.sub}</span></span>}
              </p>
            </div>
          )
        })}
      </div>

      {/* lg: กราฟยอดขายเต็มแถว + ช่องทางชำระ/สต๊อกใกล้หมดคู่กัน
          xl+: กราฟยอดขาย (2 ส่วน) + ช่องทางชำระ (1 ส่วน) แถวเดียวกัน แล้วสต๊อกใกล้หมดเต็มแถวด้านล่าง */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
        {/* Revenue Chart */}
        <div className="card p-4 sm:p-5 lg:col-span-2 min-w-0">
          <h2 className="section-title mb-3 sm:mb-4">
            <BarChart3 {...ICON} className="text-brand-600" />
            ยอดขาย {days.length} วันล่าสุด
          </h2>
          <div className="relative h-56 sm:h-72">
            <Bar
              data={{
                labels: days.map(d => d.label),
                datasets: [{
                  label: 'ยอดขาย (บาท)',
                  data: report.revenueByDay,
                  backgroundColor: CHART.bar,
                  hoverBackgroundColor: CHART.barHover,
                  borderRadius: 8,
                  borderSkipped: false,
                  maxBarThickness: 40,
                }],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: { ...tooltipTheme, callbacks: { label: ctx => ` ${baht(num(ctx.raw))}` } },
                },
                scales: {
                  y: {
                    beginAtZero: true,
                    border: { display: false },
                    grid: { color: CHART.grid },
                    ticks: { color: CHART.tick, font: { family: bodyFont, size: 12 }, callback: value => baht(num(value)) },
                  },
                  x: {
                    border: { display: false },
                    grid: { display: false },
                    ticks: { color: CHART.tick, font: { family: bodyFont, size: 12 }, maxRotation: 0, autoSkipPadding: 8 },
                  },
                },
              }}
            />
          </div>
        </div>

        {/* Payment Method — ยอดเงิน (บาท) แยกตามช่องทาง */}
        <div className="card p-4 sm:p-5 min-w-0">
          <h2 className="section-title mb-3 sm:mb-4">
            <CreditCard {...ICON} className="text-brand-600" />
            ช่องทางชำระเงิน ({rangeDays} วัน)
          </h2>
          {paymentTotal <= 0
            ? (
              <div className="empty-state py-8">
                <span className="icon-bubble icon-bubble-lg"><ReceiptText size={30} strokeWidth={1.8} aria-hidden="true" /></span>
                <p className="empty-state-title">ยังไม่มีการขายในช่วงนี้</p>
              </div>
            )
            : (
              <div className="flex flex-col sm:flex-row lg:flex-col items-center gap-4 sm:gap-6">
                <div className="relative w-40 h-40 sm:w-48 sm:h-48 shrink-0">
                  <Doughnut
                    data={{
                      labels: payments.map(p => p.label),
                      datasets: [{
                        data: payments.map(p => p.amount),
                        backgroundColor: payments.map(p => p.color),
                        borderColor: '#FFFFFF',
                        borderWidth: 3,
                        hoverOffset: 6,
                      }],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      cutout: '60%',
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          ...tooltipTheme,
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
                    <li key={p.key} className="panel flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="w-3 h-3 rounded-full shrink-0 ring-2 ring-white" style={{ backgroundColor: p.color }} aria-hidden="true" />
                        <span className="text-gray-700 font-medium">{p.label}</span>
                        <span className="text-gray-400 text-xs whitespace-nowrap">{p.count.toLocaleString('en-US')} บิล</span>
                      </span>
                      <span className="text-right whitespace-nowrap">
                        <span className="font-display font-bold tabular-nums text-gray-900">{baht(p.amount)}</span>
                        <span className="text-gray-400 text-xs ml-1 tabular-nums">
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
          <div className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-2">
            <h2 className="section-title">
              <AlertTriangle {...ICON} className="text-amber-600" />
              สต๊อกใกล้หมด
            </h2>
            {lowStock.length > LOW_STOCK_LIMIT && (
              <span className="chip">แสดง {LOW_STOCK_LIMIT} จาก {lowStock.length.toLocaleString('en-US')} รายการ</span>
            )}
          </div>
          {lowStockShown.length === 0
            ? (
              <div className="empty-state pt-2">
                <span className="icon-bubble icon-bubble-lg icon-bubble-ok"><PackageCheck size={30} strokeWidth={1.8} aria-hidden="true" /></span>
                <p className="empty-state-title">สต๊อกปกติทุกรายการ</p>
              </div>
            )
            : (
              <div className="table-wrap">
                <table className="table-soft min-w-[340px]">
                  <thead>
                    <tr>
                      <th className="px-4 xl:px-6">สินค้า</th>
                      <th className="hidden xl:table-cell px-4 xl:px-6">SKU</th>
                      <th className="text-right px-4 xl:px-6 whitespace-nowrap">คงเหลือ</th>
                      <th className="text-right px-4 xl:px-6 whitespace-nowrap">ขั้นต่ำ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStockShown.map(p => {
                      const qty = num(p.stock_qty)
                      return (
                        <tr key={p.id}>
                          <td className="px-4 xl:px-6 py-2.5">
                            <p className="font-medium text-gray-900 break-words">{productLabel(p)}</p>
                            <p className="text-xs text-gray-400 xl:hidden">SKU: {p.sku}</p>
                          </td>
                          <td className="hidden xl:table-cell px-4 xl:px-6 py-2.5 text-xs text-gray-500 font-mono break-all">{p.sku}</td>
                          <td className="px-4 xl:px-6 py-2.5 text-right font-display font-bold tabular-nums text-red-600 whitespace-nowrap">
                            {qty <= 0 ? 'หมด' : qty.toLocaleString('en-US')}
                          </td>
                          <td className="px-4 xl:px-6 py-2.5 text-right tabular-nums text-gray-500">{num(p.min_stock).toLocaleString('en-US')}</td>
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
