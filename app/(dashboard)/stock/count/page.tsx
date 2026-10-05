import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { num } from '@/lib/money'
import { parseStockCount } from '@/lib/pos'
import MigrationNotice from '@/components/pos/MigrationNotice'
import StockCountsClient, { type CountRow } from './StockCountsClient'

// คอลัมน์ของรอบนับที่หน้ารายการใช้ (อ่านตารางตรงผ่าน RLS — ต้องมีสิทธิ์ stock)
const COLUMNS = 'id, name, note, category_id, status, summary, created_at, created_by_name, applied_at, applied_by_name, cancelled_at'
// + จำนวนบรรทัดที่นับแล้วของแต่ละรอบ (นับในฐานข้อมูล ไม่ต้องดึงบรรทัดทั้งหมดมา)
const COLUMNS_WITH_LINES = `${COLUMNS}, stock_count_items(count)`

const OPEN_LIMIT = 50
const HISTORY_LIMIT = 30

type Category = { id: string; name: string }
type QueryResult = { data: unknown; error: unknown }

// จำนวนบรรทัดจากผลแบบ embed: stock_count_items: [{ count: 5 }] ; ไม่มี → null
function embeddedLines(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null
  const arr = (raw as { stock_count_items?: unknown }).stock_count_items
  if (!Array.isArray(arr)) return null
  const first = arr[0] as { count?: unknown } | undefined
  return first && first.count !== undefined ? Math.max(0, Math.trunc(num(first.count))) : 0
}

function toRows(data: unknown, categories: Category[]): CountRow[] {
  const names = new Map(categories.map(c => [c.id, c.name]))
  const out: CountRow[] = []
  for (const raw of Array.isArray(data) ? data : []) {
    // ใช้ตัวอ่านกลางของรอบนับ (ไม่มี items ในแถวตาราง → อ่านเฉพาะหัวรอบ + summary)
    const c = parseStockCount(raw)
    if (!c) continue
    const lines = embeddedLines(raw)
    out.push({
      id: c.id,
      name: c.name,
      note: c.note,
      status: c.status,
      category_id: c.category_id,
      category_name: c.category_id ? names.get(c.category_id) ?? null : null,
      created_at: c.created_at,
      created_by_name: c.created_by_name,
      applied_at: c.applied_at,
      applied_by_name: c.applied_by_name,
      cancelled_at: c.cancelled_at,
      lines: lines ?? (c.summary ? c.summary.lines : null),
      summary: c.summary,
    })
  }
  return out
}

export default async function StockCountsPage() {
  const session = await requirePermission('stock')
  const supabase = createClient()

  const openQuery = (cols: string) => supabase.from('stock_counts').select(cols)
    .eq('status', 'open').order('created_at', { ascending: false }).limit(OPEN_LIMIT)
  const historyQuery = (cols: string) => supabase.from('stock_counts').select(cols)
    .neq('status', 'open').order('created_at', { ascending: false }).limit(HISTORY_LIMIT)

  const [firstOpen, firstHistory, catRes] = await Promise.all([
    openQuery(COLUMNS_WITH_LINES),
    historyQuery(COLUMNS_WITH_LINES),
    supabase.from('categories').select('id, name').order('name'),
  ])
  let openRes: QueryResult = firstOpen
  let historyRes: QueryResult = firstHistory

  if (openRes.error || historyRes.error) {
    // ลองใหม่แบบไม่นับบรรทัด: embed ใช้ไม่ได้ (เช่น PostgREST หา relationship ไม่เจอ — ข้อความมีคำว่า schema cache
    // เหมือนกรณียังไม่ได้รันไฟล์) ไม่ควรทำให้ทั้งหน้าใช้ไม่ได้ — แค่ไม่มีจำนวนบรรทัดของรอบที่ยังไม่ปรับยอด
    const [o2, h2] = await Promise.all([openQuery(COLUMNS), historyQuery(COLUMNS)])
    openRes = o2
    historyRes = h2
  }
  // ยังไม่ได้รัน supabase-fix-04-pos.sql → ไม่มีตาราง stock_counts
  if (isMigrationMissing(openRes.error) || isMigrationMissing(historyRes.error)) {
    return <MigrationNotice title="ตรวจนับสต๊อก" subtitle="นับสินค้าจริงแล้วปรับยอดในระบบให้ตรง" />
  }
  if (openRes.error) throw new Error(thaiError(openRes.error))
  if (historyRes.error) throw new Error(thaiError(historyRes.error))
  if (catRes.error) throw new Error(thaiError(catRes.error))

  const categories: Category[] = (catRes.data ?? [])
    .filter((c): c is Category => !!c && typeof c.id === 'string' && typeof c.name === 'string')
    .map(c => ({ id: c.id, name: c.name }))

  return (
    <StockCountsClient
      openCounts={toRows(openRes.data, categories)}
      history={toRows(historyRes.data, categories)}
      categories={categories}
      showCost={session.role === 'admin' || session.permissions.reports}
    />
  )
}
