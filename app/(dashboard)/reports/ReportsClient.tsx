'use client'
import { useMemo } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  AlertTriangle, BarChart3, Coins, CreditCard, PackageCheck, ReceiptText, Undo2, Wallet, type LucideIcon,
} from 'lucide-react'
import { baht, bangkokDateKey, productLabel } from '@/lib/format'
import { num, round2 } from '@/lib/money'
import { ICON } from '@/components/theme/icons'
import { PAYMENT_METHOD_LABELS } from '@/lib/integrations/labels'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

// วันในกราฟ (key = 'YYYY-MM-DD' เวลาไทย, label คำนวณจากเซิร์ฟเวอร์แล้ว)
export interface ReportDay { key: string; label: string }
export interface ReportSale { id: string; net_amount: number; created_at: string; payment_method: string }
// การคืนสินค้า (sale_returns) — นับตาม "วันที่คืน" และหักจาก "วิธีคืนเงิน" (เงินออกจากร้านวันนั้นด้วยช่องทางนั้น)
export interface ReportRefund { refund_amount: number; refund_method: string; created_at: string }
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

// สีช่องทางชำระ (ธีมทางการ โรสโกลด์ชมพู + เทา) — ต่างกันที่ความเข้มด้วย ไม่พึ่งสีอย่างเดียว:
// เงินสด = โรสโกลด์เข้ม (brand-600), โอน = โรสโกลด์อ่อน (brand-400), บัตร = เทาเข้ม (gray-700), แพลตฟอร์ม = เทาอ่อน (gray-300)
const PAYMENT_METHODS: { key: string; label: string; color: string }[] = [
  { key: 'cash',     label: 'เงินสด',     color: '#C14E67' },
  { key: 'transfer', label: 'โอนเงิน',    color: '#F0ADB9' },
  { key: 'credit',   label: 'บัตรเครดิต', color: '#463E41' },
  { key: 'marketplace', label: PAYMENT_METHOD_LABELS.marketplace, color: '#D5D2D3' },
]

// สีกราฟ: แท่งโรสโกลด์ชุดเดียว (brand-400 / ชี้ = brand-500), เส้นตารางเทาอ่อน, ตัวเลขแกนเทา, กล่องทิปสีหมึก
const CHART = {
  bar: '#F0ADB9',
  barHover: '#E694A4',
  grid: '#EFEDEE',
  tick: '#675F62',
  tooltipBg: '#201B1D',
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

// next/font ตั้งชื่อฟอนต์แบบสุ่ม (__Prompt_xxxx) ไว้ในตัวแปร CSS บน <body> — canvas ต้องใช้ชื่อจริง จึงอ่านจากตัวแปรนั้น
function themeFont(cssVar: '--font-sans' | '--font-display', fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const family = getComputedStyle(document.body).getPropertyValue(cssVar).trim()
  return family ? `${family}, ${fallback}` : fallback
}

const LOW_STOCK_LIMIT = 10

export default function ReportsClient({ days, rangeDays, sales, refunds, refundsReady, products }: {
  days: ReportDay[]
  rangeDays: number
  sales: ReportSale[]
  refunds: ReportRefund[]
  // false = ฐานข้อมูลยังไม่ได้รัน supabase-fix-04-pos.sql (ยังไม่มีระบบคืนสินค้า) → ไม่แสดงการ์ดคืนสินค้า
  refundsReady: boolean
  products: ReportProduct[]
}) {
  const report = useMemo(() => {
    // ยอดขายรายวัน — จัดกลุ่มตามวันที่เวลาไทย (ไม่ใช่ตัด string UTC)
    const dayIndex = new Map<string, number>()
    days.forEach((d, i) => { dayIndex.set(d.key, i) })
    const revenueByDay = days.map(() => 0)
    const refundByDay = days.map(() => 0)

    // ช่องทางชำระเงิน — รวมเป็นบาท (หักเงินคืนแล้ว) + นับจำนวนบิล + ยอดคืนแยกไว้แสดงประกอบ
    const payments = PAYMENT_METHODS.map(m => ({ ...m, amount: 0, count: 0, refund: 0 }))

    let totalSales = 0
    for (const s of sales) {
      const amount = num(s.net_amount)
      totalSales += amount
      const i = dayIndex.get(bangkokDateKey(s.created_at))
      if (i !== undefined) revenueByDay[i] += amount
      const p = payments.find(x => x.key === s.payment_method)
      if (p) {
        p.amount += amount
        p.count += 1
      }
    }

    // คืนสินค้า: หักออกจากรายรับของ "วันที่คืน" (บิลอาจขายก่อนช่วงรายงาน — เงินออกจากร้านวันที่คืน)
    //   บิลที่ยกเลิกไม่อยู่ในยอดขายอยู่แล้ว และระบบไม่ยอมให้คืนสินค้าของบิลที่ยกเลิก → ไม่หักซ้ำ
    let totalRefund = 0
    for (const r of refunds) {
      const amount = num(r.refund_amount)
      totalRefund += amount
      const i = dayIndex.get(bangkokDateKey(r.created_at))
      if (i !== undefined) {
        revenueByDay[i] -= amount
        refundByDay[i] += amount
      }
      const p = payments.find(x => x.key === r.refund_method)
      if (p) {
        p.amount -= amount
        p.refund += amount
      }
    }

    const totalStockValue = products.reduce((sum, p) => sum + Math.max(0, num(p.stock_qty)) * num(p.cost_price), 0)
    const lowStock = products
      .filter(p => num(p.stock_qty) <= num(p.min_stock))
      .sort((a, b) => num(a.stock_qty) - num(b.stock_qty))

    const roundedPayments = payments.map(p => ({ ...p, amount: round2(p.amount), refund: round2(p.refund) }))
    return {
      totalRevenue: round2(totalSales - totalRefund),
      totalRefund: round2(totalRefund),
      refundCount: refunds.length,
      billCount: sales.length,
      totalStockValue: round2(totalStockValue),
      revenueByDay: revenueByDay.map(round2),
      refundByDay: refundByDay.map(round2),
      payments: roundedPayments,
      // กราฟโดนัทแสดงสัดส่วนได้เฉพาะค่าบวก (ช่องทางที่คืนเงินมากกว่าขายในช่วงนี้ = 0 ในกราฟ แต่ตัวเลขจริงยังแสดงในรายการ)
      chartTotal: round2(roundedPayments.reduce((sum, p) => sum + Math.max(0, p.amount), 0)),
      lowStock,
    }
  }, [days, sales, refunds, products])

  const { payments, chartTotal, lowStock } = report
  const lowStockShown = lowStock.slice(0, LOW_STOCK_LIMIT)
  const hasActivity = sales.length > 0 || refunds.length > 0

  // การ์ดสรุป: กล่องไอคอนตามความหมาย (การ์ดเด่นมีใบเดียว = รายรับ)
  //   จอแคบ (2 คอลัมน์): รายรับเต็มแถว แล้วการ์ดที่เหลือ — ถ้าเหลือเป็นเลขคี่ ใบสุดท้ายเต็มแถว (ไม่เหลือช่องว่างครึ่งแถว)
  const summaryCards: SummaryCard[] = [
    { label: `รายรับ ${rangeDays} วัน`, value: baht(report.totalRevenue), unit: '', sub: `${report.billCount.toLocaleString('en-US')} บิล`, icon: Wallet, bubble: 'icon-bubble-strong', hot: true, wide: true },
  ]
  if (refundsReady) {
    summaryCards.push({ label: 'คืนสินค้า', value: baht(report.totalRefund), unit: '', sub: `${report.refundCount.toLocaleString('en-US')} ครั้ง`, icon: Undo2, bubble: '', hot: false, wide: false })
  }
  summaryCards.push(
    { label: 'มูลค่าสต๊อก (ทุน)', value: baht(report.totalStockValue), unit: '', sub: '', icon: Coins, bubble: '', hot: false, wide: false },
    { label: 'สต๊อกใกล้หมด', value: lowStock.length.toLocaleString('en-US'), unit: 'รายการ', sub: '', icon: AlertTriangle, bubble: 'icon-bubble-warn', hot: false, wide: false },
  )
  if ((summaryCards.length - 1) % 2 === 1) summaryCards[summaryCards.length - 1].wide = true
  // 4 ใบ: lg = 2×2, xl ขึ้นไป = แถวเดียว 4 ใบ ; 3 ใบ (ฐานข้อมูลก่อน fix-04) = แบบเดิม lg แถวเดียว 3 ใบ
  const cardGridCols = summaryCards.length >= 4 ? 'xl:grid-cols-4' : 'lg:grid-cols-3'

  // ฟอนต์ของกราฟอ่านตอนวาด (ฝั่งเบราว์เซอร์) — ฝั่งเซิร์ฟเวอร์ใช้ชื่อสำรอง (canvas ไม่ถูกเรนเดอร์บนเซิร์ฟเวอร์อยู่แล้ว)
  //   ฟอนต์เดียวทั้งระบบ (Prompt) — หัวทิปใช้น้ำหนัก 600 แทนฟอนต์หัวเรื่องแยก
  const bodyFont = themeFont('--font-sans', 'Prompt, sans-serif')
  const tooltipTheme = {
    backgroundColor: CHART.tooltipBg,
    titleColor: '#FFFFFF',
    bodyColor: '#FFFFFF',
    titleFont: { family: bodyFont, size: 13, weight: 600 },
    bodyFont: { family: bodyFont, size: 13 },
    padding: 10,
    cornerRadius: 8,
    boxPadding: 4,
    displayColors: false,
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Summary */}
      <div className={`grid grid-cols-2 ${cardGridCols} gap-3 sm:gap-4 xl:gap-6`}>
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
                {c.unit && <span className="stat-sub"> {c.unit}</span>}
                {c.sub && <span className={`stat-sub ${c.hot ? 'text-gray-600' : ''}`}> <span className="whitespace-nowrap">· {c.sub}</span></span>}
              </p>
            </div>
          )
        })}
      </div>

      {/* lg: กราฟยอดขายเต็มแถว + ช่องทางชำระ/สต๊อกใกล้หมดคู่กัน
          xl+: กราฟยอดขาย (2 ส่วน) + ช่องทางชำระ (1 ส่วน) แถวเดียวกัน แล้วสต๊อกใกล้หมดเต็มแถวด้านล่าง */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
        {/* Revenue Chart */}
        <section className="card lg:col-span-2 min-w-0">
          <div className="card-header">
            <h2 className="section-title">
              <BarChart3 {...ICON} />
              ยอดขาย {days.length} วันล่าสุด
            </h2>
          </div>
          <div className="relative m-4 h-56 sm:m-5 sm:h-72">
            <Bar
              data={{
                labels: days.map(d => d.label),
                datasets: [{
                  label: 'ยอดขาย (บาท)',
                  data: report.revenueByDay,
                  backgroundColor: CHART.bar,
                  hoverBackgroundColor: CHART.barHover,
                  // มุมบนมนเล็กน้อย ฐานแท่งตรง (แบบกราฟธุรกิจทั่วไป)
                  borderRadius: 4,
                  borderSkipped: 'start',
                  maxBarThickness: 40,
                }],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    ...tooltipTheme,
                    callbacks: {
                      label: ctx => ` ${baht(num(ctx.raw))}`,
                      // วันที่มีคืนสินค้า บอกยอดที่หักไปด้วย (แท่งกราฟเป็นยอดหลังหักคืนแล้ว)
                      afterLabel: ctx => {
                        const refund = report.refundByDay[ctx.dataIndex] ?? 0
                        return refund > 0 ? ` หักคืนสินค้า ${baht(refund)}` : ''
                      },
                    },
                  },
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
        </section>

        {/* Payment Method — ยอดเงิน (บาท) แยกตามช่องทาง */}
        <section className="card min-w-0">
          <div className="card-header">
            <h2 className="section-title">
              <CreditCard {...ICON} />
              ช่องทางชำระเงิน ({rangeDays} วัน)
            </h2>
          </div>
          {!hasActivity
            ? (
              <div className="empty-state py-8">
                <span className="icon-bubble icon-bubble-lg"><ReceiptText size={28} strokeWidth={1.75} aria-hidden="true" /></span>
                <p className="empty-state-title">ยังไม่มีการขายในช่วงนี้</p>
              </div>
            )
            : (
              <div className="flex flex-col sm:flex-row lg:flex-col items-center gap-4 p-4 sm:gap-6 sm:p-5">
                {/* ทุกช่องทางติดลบ/เป็นศูนย์ (เช่น มีแต่คืนสินค้าของบิลเก่า) → ไม่มีสัดส่วนให้วาด แสดงแค่รายการตัวเลข */}
                {chartTotal > 0 && (
                  <div className="relative w-40 h-40 sm:w-48 sm:h-48 shrink-0">
                    <Doughnut
                      data={{
                        labels: payments.map(p => p.label),
                        datasets: [{
                          data: payments.map(p => Math.max(0, p.amount)),
                          backgroundColor: payments.map(p => p.color),
                          borderColor: '#FFFFFF',
                          borderWidth: 2,
                          hoverOffset: 4,
                        }],
                      }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        cutout: '64%',
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
                              afterLabel: ctx => {
                                const p = payments[ctx.dataIndex]
                                return p && p.refund > 0 ? ` หักคืนสินค้า ${baht(p.refund)}` : ''
                              },
                            },
                          },
                        },
                      }}
                    />
                  </div>
                )}
                {/* Legend: ยอดบาท (หักคืนแล้ว) + จำนวนบิล + ยอดคืน + สัดส่วน */}
                <ul className="w-full space-y-2">
                  {payments.map(p => (
                    <li key={p.key} className="panel flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="w-3 h-3 rounded-full shrink-0 ring-2 ring-white" style={{ backgroundColor: p.color }} aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-gray-700 font-medium">{p.label}</span>
                            <span className="text-gray-500 text-xs whitespace-nowrap tabular-nums">{p.count.toLocaleString('en-US')} บิล</span>
                          </span>
                          {p.refund > 0 && (
                            <span className="block text-gray-500 text-xs whitespace-nowrap tabular-nums">หักคืน {baht(p.refund)}</span>
                          )}
                        </span>
                      </span>
                      <span className="text-right whitespace-nowrap">
                        <span className={`font-semibold tabular-nums ${p.amount < 0 ? 'text-red-700' : 'text-gray-900'}`}>{baht(p.amount)}</span>
                        {chartTotal > 0 && (
                          <span className="text-gray-500 text-xs ml-1 tabular-nums">
                            {((Math.max(0, p.amount) / chartTotal) * 100).toFixed(0)}%
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          }
        </section>

        {/* Low Stock Table */}
        <section className="card overflow-hidden xl:col-span-3">
          <div className="card-header flex-wrap">
            <h2 className="section-title">
              {/* ไอคอนเตือนสีอำพัน (ชนะสีโรสโกลด์อัตโนมัติของ .section-title) */}
              <AlertTriangle {...ICON} className="!text-amber-600" />
              สต๊อกใกล้หมด
            </h2>
            {lowStock.length > LOW_STOCK_LIMIT && (
              <span className="chip">แสดง {LOW_STOCK_LIMIT} จาก {lowStock.length.toLocaleString('en-US')} รายการ</span>
            )}
          </div>
          {lowStockShown.length === 0
            ? (
              <div className="empty-state">
                <span className="icon-bubble icon-bubble-lg icon-bubble-ok"><PackageCheck size={28} strokeWidth={1.75} aria-hidden="true" /></span>
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
                            <p className="text-xs text-gray-500 xl:hidden">SKU: {p.sku}</p>
                          </td>
                          <td className="hidden xl:table-cell px-4 xl:px-6 py-2.5 text-xs text-gray-500 font-mono break-all">{p.sku}</td>
                          <td className="px-4 xl:px-6 py-2.5 text-right font-semibold tabular-nums text-red-700 whitespace-nowrap">
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
        </section>
      </div>
    </div>
  )
}
