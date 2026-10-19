'use client'
// หน้าเพิ่มลูกค้าใหม่ — บันทึกสำเร็จแล้วไปหน้ารายละเอียดลูกค้า (replace: กดย้อนกลับไม่กลับมาฟอร์มเดิมที่บันทึกไปแล้ว)
import { useRouter } from 'next/navigation'
import CustomerForm from './CustomerForm'
import { customerHref } from '@/components/rental/calendar/rpc'

export default function NewCustomerClient({ canManage }: { canManage: boolean }) {
  const router = useRouter()
  return (
    <CustomerForm
      mode="new"
      canManage={canManage}
      onSaved={(c, info) => router.replace(`${customerHref(c.id)}?saved=${info.already_saved ? 'again' : 'new'}`)}
      onCancel={() => router.push('/rental/customers')}
    />
  )
}
