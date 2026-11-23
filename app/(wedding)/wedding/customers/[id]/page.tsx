import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireWedding } from '@/lib/auth/permissions'
import { isMigrationMissing } from '@/lib/migration'
import { FIX07_MISSING_MSG, parseWedCustomerDetail } from '@/lib/wedding'
import MigrationNotice from '@/components/pos/MigrationNotice'
import CustomerDetailClient from '@/components/wedding/customers/CustomerDetailClient'
import { UUID_RE, wedErrorText } from '@/components/wedding/money/wedRpc'
import { weddingPageMetadata } from '@/components/wedding/money/pageMeta'

export function generateMetadata() {
  return weddingPageMetadata('ลูกค้า')
}

// ยอดค้าง/ประวัติงานต้องสดเสมอ — ห้ามแคช
export const dynamic = 'force-dynamic'

// wed_get_customer ไม่พบลูกค้า → raise 'ไม่พบข้อมูลลูกค้านี้ ...' (P0001)
function isCustomerNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const message = (err as { message?: unknown }).message
  return typeof message === 'string' && message.includes('ไม่พบข้อมูลลูกค้า')
}

// /wedding/customers/<id> — รายละเอียดลูกค้า + แก้ไข + ประวัติงาน (?saved=new|again = ข้อความหลังเพิ่มลูกค้า)
export default async function WeddingCustomerPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams?: { saved?: string | string[] }
}) {
  await requireWedding()
  // id ไม่ใช่ uuid → ไม่มีลูกค้านี้แน่นอน (ไม่ต้องยิง DB ให้ได้ error 22P02)
  if (!UUID_RE.test(params.id)) notFound()
  const id = params.id.toLowerCase()

  const supabase = createClient()
  const { data, error } = await supabase.rpc('wed_get_customer', { p_id: id })
  if (error) {
    if (isMigrationMissing(error)) return <MigrationNotice title="ลูกค้า" subtitle="รายละเอียดลูกค้า" message={FIX07_MISSING_MSG} />
    if (isCustomerNotFound(error)) notFound()
    throw new Error(wedErrorText(error))
  }
  const customer = parseWedCustomerDetail(data)
  if (!customer) notFound()

  const saved = typeof searchParams?.saved === 'string' ? searchParams.saved : ''
  const savedNotice = saved === 'new' || saved === 'again' ? saved : null

  return <CustomerDetailClient key={customer.id} initial={customer} savedNotice={savedNotice} />
}
