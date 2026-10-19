import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isRentalManager, requireRental } from '@/lib/auth/permissions'
import { isMigrationMissing } from '@/lib/migration'
import { FIX05_MISSING_MSG, parseCustomer } from '@/lib/rental'
import MigrationNotice from '@/components/pos/MigrationNotice'
import CustomerDetailClient from '@/components/rental/customers/CustomerDetailClient'
import { UUID_RE, rentalErrorText } from '@/components/rental/calendar/rpc'

// rental_get_customer ไม่พบลูกค้า → raise 'ไม่พบข้อมูลลูกค้านี้ ...' (P0001)
function isCustomerNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const message = (err as { message?: unknown }).message
  return typeof message === 'string' && message.includes('ไม่พบข้อมูลลูกค้า')
}

// /rental/customers/<id> — รายละเอียดลูกค้า + แก้ไข + ประวัติการจอง (?saved=new|again = ข้อความหลังเพิ่มลูกค้า)
export default async function RentalCustomerPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams?: { saved?: string | string[] }
}) {
  const session = await requireRental()
  // id ไม่ใช่ uuid → ไม่มีลูกค้านี้แน่นอน (ไม่ต้องยิง DB ให้ได้ error 22P02)
  if (!UUID_RE.test(params.id)) notFound()
  const id = params.id.toLowerCase()

  const supabase = createClient()
  const { data, error } = await supabase.rpc('rental_get_customer', { p_id: id })
  if (error) {
    if (isMigrationMissing(error)) return <MigrationNotice title="ลูกค้า" subtitle="รายละเอียดลูกค้าร้านเช่าชุด" message={FIX05_MISSING_MSG} />
    if (isCustomerNotFound(error)) notFound()
    throw new Error(rentalErrorText(error))
  }
  const customer = parseCustomer(data)
  if (!customer) notFound()

  const saved = typeof searchParams?.saved === 'string' ? searchParams.saved : ''
  const savedNotice = saved === 'new' || saved === 'again' ? saved : null

  return (
    <CustomerDetailClient
      key={customer.id}
      initial={customer}
      canManage={isRentalManager(session)}
      savedNotice={savedNotice}
    />
  )
}
