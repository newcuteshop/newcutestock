import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/permissions'
import { bangkokDateKey, bangkokDayStartISO } from '@/lib/format'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { isMissingSalesColumn } from '@/lib/salesCompat'
import { isMigrationMissing } from '@/lib/migration'
import ExportSalesButton from '@/components/pos/ExportSalesButton'
import ReportsClient, { type ReportDay, type ReportProduct, type ReportRefund, type ReportSale } from './ReportsClient'

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

  // บิลที่ยกเลิก (voided_at — คืนสต๊อกแล้ว: ออเดอร์แพลตฟอร์มที่ยกเลิก หรือยกเลิกบิลหน้าร้าน) ไม่นับเป็นรายรับ
  //   ฐานข้อมูลที่ยังไม่ได้รัน fix-03 ไม่มีคอลัมน์นี้ (และไม่มีบิลยกเลิก) → ดึงแบบเดิม
  const loadSales = (skipVoided: boolean) => fetchAllRows<ReportSale>((from, to) => {
    const q = supabase
      .from('sales')
      .select('id, net_amount, created_at, payment_method')
      .gte('created_at', sinceISO)
    return (skipVoided ? q.is('voided_at', null) : q)
      .order('created_at')
      .order('id')
      .range(from, to)
  })

  // การคืนสินค้าในช่วงเดียวกัน (นับตามวันที่คืน — เงินออกจากร้านวันนั้น) เพื่อหักออกจากรายรับ
  //   ฐานข้อมูลที่ยังไม่ได้รัน supabase-fix-04-pos.sql ไม่มีตารางนี้ (และยังคืนสินค้าไม่ได้) → ถือว่าไม่มีการคืน
  //   error อื่น (เน็ตหลุด ฯลฯ) ให้หน้าพังไปที่ error.tsx ดีกว่าโชว์รายรับที่ยังไม่ได้หักเงินคืน
  const loadRefunds = (): Promise<{ rows: ReportRefund[]; ready: boolean }> => fetchAllRows<ReportRefund>((from, to) => supabase
    .from('sale_returns')
    .select('refund_amount, refund_method, created_at')
    .gte('created_at', sinceISO)
    .order('created_at')
    .order('id')
    .range(from, to))
    .then(
      rows => ({ rows, ready: true }),
      (e: unknown) => {
        if (!isMigrationMissing(e)) throw e
        return { rows: [], ready: false }
      },
    )

  const [sales, { rows: refunds, ready: refundsReady }, products] = await Promise.all([
    loadSales(true).catch((e: unknown) => {
      if (isMissingSalesColumn(e)) return loadSales(false)
      throw e
    }),
    loadRefunds(),
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
          <p className="page-subtitle">
            สรุปข้อมูลย้อนหลัง {RANGE_DAYS} วัน ({rangeLabel})
            {refundsReady && <> · ยอดขายหักบิลที่ยกเลิกและเงินคืนสินค้าแล้ว</>}
          </p>
        </div>
        <div className="page-actions">
          <ExportSalesButton />
        </div>
      </div>
      <ReportsClient
        days={days}
        rangeDays={RANGE_DAYS}
        sales={sales}
        refunds={refunds}
        refundsReady={refundsReady}
        products={products}
      />
    </div>
  )
}
