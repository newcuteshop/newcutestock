import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  AlertTriangle, ArrowDownToLine, ArrowRight, ChevronRight, Coins, Lock, Package, Plus, ReceiptText, ShoppingBag,
  type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/permissions'
import { baht, bangkokDayStartISO, productLabel } from '@/lib/format'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { ICON, ICON_SM } from '@/components/theme/icons'

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
  // หน่วยตัวเล็กต่อท้ายตัวเลข (เช่น "รายการ") — แยกไว้เพื่อให้ตัวเลขเด่น ข้อความรวมยังเหมือนเดิม
  unit?: string
  sub?: string
  icon: LucideIcon
  // คลาสฟองไอคอน (สีตามความหมาย) + จังหวะแสงวาวกระโดด (รวมทั้งจอไม่เกิน 4 ฟอง)
  bubble: string
  // การ์ดเด่นหนึ่งใบ (ยอดขายวันนี้)
  hot?: boolean
  href: string | null
}

type QuickAction = { href: string; label: string; icon: LucideIcon; variant: 'btn-primary' | 'btn-soft' | 'btn-dashed' }

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// wide = การ์ดใบสุดท้ายเมื่อจำนวนเป็นเลขคี่ → มือถือ/iPad กินเต็มแถว (ไม่เหลือช่องว่างครึ่งแถว)
function StatCardView({ card, wide }: { card: StatCard; wide: boolean }) {
  const Icon = card.icon
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={`stat-label min-w-0 pt-1 ${card.hot ? 'text-gray-600' : ''}`}>{card.label}</span>
        <span className={`icon-bubble ${card.bubble}`}><Icon {...ICON} /></span>
      </div>
      <p className="stat-value">
        {/* ตัวเลขห้ามแยกบรรทัดกลางจำนวน (อ่านเป็นยอดอื่นได้) — หน่วย/บิลขึ้นบรรทัดใหม่ได้
            แต่ "· 7 บิล" ต้องไปทั้งก้อน (การ์ดครึ่งจอมือถือเคยเหลือ "บิล" ตกบรรทัดเดียว) */}
        <span className="whitespace-nowrap">{card.value}</span>
        {card.unit && <span className={`stat-sub font-sans font-normal ${card.hot ? 'text-gray-600' : ''}`}> {card.unit}</span>}
        {card.sub && <span className={`stat-sub font-sans font-normal ${card.hot ? 'text-gray-600' : ''}`}> <span className="whitespace-nowrap">· {card.sub}</span></span>}
      </p>
    </>
  )
  const cls = `stat-card ${card.hot ? 'stat-card-hot' : ''} ${wide ? 'col-span-2 lg:col-span-1' : ''}`
  return card.href
    ? <Link href={card.href} className={`${cls} card-hover`}>{body}</Link>
    : <div className={cls}>{body}</div>
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
        <div className="page-header">
          <div className="min-w-0">
            <h1 className="page-title">ภาพรวม</h1>
            <p className="page-subtitle">ข้อมูลสรุปของวันนี้</p>
          </div>
        </div>
        <div className="card empty-state">
          <span className="icon-bubble icon-bubble-lg icon-bubble-warn"><Lock size={30} strokeWidth={1.8} aria-hidden="true" /></span>
          <p className="empty-state-title max-w-md">
            บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งานเมนูใดๆ กรุณาติดต่อผู้ดูแลระบบเพื่อกำหนดสิทธิ์
          </p>
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

  // กดรายการสต๊อกใกล้หมด → หน้าแก้ไขสินค้า (ลิงก์ใช้รหัส "แบบ" = group_id ไม่ใช่รหัสไซส์)
  // ดึงแยกเฉพาะ 5 รายการที่โชว์ และอ่านไม่ได้ก็แค่ไม่มีลิงก์ — หน้าภาพรวมต้องไม่พังเพราะส่วนนี้
  const groupIdOf = new Map<string, string>()
  if (permissions.products && lowStockTop.length > 0) {
    const { data } = await supabase
      .from('products')
      .select('id, group_id')
      .in('id', lowStockTop.map(p => p.id))
    for (const row of (Array.isArray(data) ? data : []) as { id: string; group_id: string | null }[]) {
      if (row.group_id) groupIdOf.set(row.id, row.group_id)
    }
  }
  const todayRevenue = round2(todaySales.reduce((s, x) => s + num(x.net_amount), 0))
  const todayBills = todaySales.length

  const statCards: StatCard[] = [
    {
      label: 'สินค้าทั้งหมด',
      value: totalProducts.toLocaleString('en-US'),
      unit: 'รายการ',
      icon: Package,
      bubble: 'hop',
      href: permissions.products ? '/products' : null,
    },
  ]
  // มูลค่าสต๊อก (ราคาทุน) เห็นเฉพาะ admin หรือผู้มีสิทธิ์ดูรายงาน
  if (canSeeStockValue) {
    statCards.push({
      label: 'มูลค่าสต๊อก (ทุน)',
      value: baht(totalStockValue),
      icon: Coins,
      bubble: '',
      href: permissions.reports ? '/reports' : null,
    })
  }
  statCards.push(
    {
      label: 'สต๊อกใกล้หมด',
      value: lowStock.length.toLocaleString('en-US'),
      unit: 'รายการ',
      icon: AlertTriangle,
      bubble: 'icon-bubble-warn hop hop-2',
      href: permissions.stock ? '/stock' : permissions.reports ? '/reports' : null,
    },
    {
      label: 'ยอดขายวันนี้',
      value: baht(todayRevenue),
      sub: `${todayBills.toLocaleString('en-US')} บิล`,
      icon: ShoppingBag,
      bubble: 'icon-bubble-strong hop hop-3',
      hot: true,
      href: permissions.sales ? '/sales' : permissions.reports ? '/reports' : null,
    },
  )

  // ปุ่มหลัก (ลูกกวาด) มีได้อันเดียว — รับสินค้าเข้า = ปุ่มบลัช, เพิ่มสินค้าใหม่ = ปุ่มเส้นประ
  const quickActions: QuickAction[] = []
  if (permissions.sales) quickActions.push({ href: '/sales', label: 'บันทึกการขาย', icon: ReceiptText, variant: 'btn-primary' })
  if (permissions.stock) quickActions.push({ href: '/stock?action=in', label: 'รับสินค้าเข้า', icon: ArrowDownToLine, variant: 'btn-soft' })
  if (permissions.products) quickActions.push({ href: '/products/new', label: 'เพิ่มสินค้าใหม่', icon: Plus, variant: 'btn-dashed' })

  const lowStockHref = permissions.stock ? '/stock' : permissions.reports ? '/reports' : null
  // คอมจอกว้าง (xl+): ทำรายการด่วน (1 ส่วน) กับ สต๊อกใกล้หมด (2 ส่วน) วางข้างกัน — มีแค่อย่างเดียวให้เต็มแถว
  const sideBySide = quickActions.length > 0 && lowStockTop.length > 0

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">ภาพรวม</h1>
          <p className="page-subtitle">ข้อมูลสรุปของวันนี้</p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className={`grid grid-cols-2 gap-3 sm:gap-4 xl:gap-6 ${statCards.length >= 4 ? 'xl:grid-cols-4' : 'lg:grid-cols-3'}`}>
        {statCards.map((card, i) => (
          <StatCardView key={card.label} card={card} wide={statCards.length % 2 === 1 && i === statCards.length - 1} />
        ))}
      </div>

      {(quickActions.length > 0 || lowStockTop.length > 0) && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6 items-start">
          {/* Quick Actions */}
          {quickActions.length > 0 && (
            <div className={`card p-4 sm:p-5 ${sideBySide ? '' : 'xl:col-span-3'}`}>
              <h2 className="section-kicker mb-3">ทำรายการด่วน</h2>
              <div className={`grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:gap-3 ${sideBySide ? 'xl:grid' : ''}`}>
                {quickActions.map(a => {
                  const Icon = a.icon
                  return (
                    <Link key={a.href} href={a.href} className={a.variant}>
                      <Icon {...ICON} />
                      {a.label}
                    </Link>
                  )
                })}
              </div>
            </div>
          )}

          {/* Low Stock Warning */}
          {lowStockTop.length > 0 && (
            <div className={`card p-4 sm:p-5 ${sideBySide ? 'xl:col-span-2' : 'xl:col-span-3'}`}>
              <h2 className="section-title flex-wrap mb-1 sm:mb-2">
                <AlertTriangle {...ICON} className="text-amber-600" />
                สินค้าสต๊อกใกล้หมด
                <span className="font-sans text-sm font-normal text-gray-500">({lowStock.length.toLocaleString('en-US')} รายการ)</span>
              </h2>
              <div className="divide-y divide-brand-100">
                {lowStockTop.map(item => {
                  const qty = num(item.stock_qty)
                  const groupId = groupIdOf.get(item.id)
                  const body = (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 text-sm break-words">{productLabel(item)}</p>
                        <p className="text-xs text-gray-400 truncate">SKU: {item.sku}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-display font-bold tabular-nums text-red-600">{qty <= 0 ? 'หมด' : `${qty.toLocaleString('en-US')} ชิ้น`}</p>
                        <p className="text-xs text-gray-400">ขั้นต่ำ: {num(item.min_stock).toLocaleString('en-US')}</p>
                      </div>
                    </>
                  )
                  return groupId ? (
                    <Link
                      key={item.id}
                      href={`/products/${groupId}`}
                      prefetch={false}
                      className="-mx-2 flex min-h-[44px] items-center justify-between gap-3 rounded-2xl px-2 py-3 transition-colors active:bg-blush-soft [@media(hover:hover)]:hover:bg-gray-50"
                    >
                      {body}
                      <ChevronRight {...ICON_SM} className="text-brand-700" />
                    </Link>
                  ) : (
                    <div key={item.id} className="flex items-center justify-between gap-3 py-3">
                      {body}
                    </div>
                  )
                })}
              </div>
              {lowStockHref && (
                <Link href={lowStockHref} className="link text-sm">
                  ดูทั้งหมด
                  <ArrowRight {...ICON_SM} />
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
