import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/permissions'
import { bangkokDateKey, bangkokDayStartISO } from '@/lib/format'
import { fetchAllRows } from '@/lib/fetchAllRows'
import ReportsClient, { type ReportDay, type ReportProduct, type ReportSale } from './ReportsClient'

const DAY_MS = 24 * 60 * 60 * 1000
const RANGE_DAYS = 30
const CHART_DAYS = 14
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

// 'YYYY-MM-DD' → '28 ก.ย.' (หรือ '28 ก.ย. 2569' ถ้า withYear) — ทำบนเซิร์ฟเวอร์ ให้ข้อความตรงกันทั้ง server/browser
function dayLabel(key: string, withYear = false): string {
  const [y, m, d] = key.split('-').map(Number)
  const text = `${d} ${TH_MONTHS[m - 1] ?? ''}`
  return withYear ? `${text} ${y + 543}` : text
}

export default async function ReportsPage() {
  await requirePermission('reports')
  const supabase = createClient()

  // นับวันตามปฏิทินไทย: วันนี้ + ย้อนหลัง 29 วัน (เวลาไทยไม่มี DST ลบทีละ 24 ชม. ได้ตรง)
  const todayStartMs = new Date(bangkokDayStartISO()).getTime()
  const rangeStartMs = todayStartMs - (RANGE_DAYS - 1) * DAY_MS
  const sinceISO = new Date(rangeStartMs).toISOString()

  const days: ReportDay[] = []
  for (let i = CHART_DAYS - 1; i >= 0; i--) {
    const key = bangkokDateKey(new Date(todayStartMs - i * DAY_MS))
    days.push({ key, label: dayLabel(key) })
  }
  const rangeLabel = `${dayLabel(bangkokDateKey(new Date(rangeStartMs)), true)} – ${dayLabel(bangkokDateKey(new Date(todayStartMs)), true)}`

  const [sales, products] = await Promise.all([
    fetchAllRows<ReportSale>((from, to) => supabase
      .from('sales')
      .select('id, net_amount, created_at, payment_method')
      .gte('created_at', sinceISO)
      .order('created_at')
      .order('id')
      .range(from, to)),
    fetchAllRows<ReportProduct>((from, to) => supabase
      .from('products')
      .select('id, name, sku, size, color, stock_qty, cost_price, min_stock')
      .eq('is_active', true)
      .order('stock_qty')
      .order('id')
      .range(from, to)),
  ])

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">รายงาน</h1>
          <p className="page-subtitle">สรุปข้อมูลย้อนหลัง {RANGE_DAYS} วัน ({rangeLabel})</p>
        </div>
      </div>
      <ReportsClient days={days} rangeDays={RANGE_DAYS} sales={sales} products={products} />
    </div>
  )
}
