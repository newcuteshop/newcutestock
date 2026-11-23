'use client'
// หน้าเพิ่มลูกค้าใหม่ — บันทึกสำเร็จแล้วไปหน้ารายละเอียดลูกค้า (replace: กดย้อนกลับไม่กลับมาฟอร์มเดิมที่บันทึกไปแล้ว)
import { useRouter } from 'next/navigation'
import CustomerForm from './CustomerForm'
import { wedCustomerHref } from '@/components/wedding/money/wedRpc'

export default function NewCustomerClient() {
  const router = useRouter()
  return (
    <CustomerForm
      mode="new"
      onSaved={(c, info) => router.replace(`${wedCustomerHref(c.id)}?saved=${info.already_saved ? 'again' : 'new'}`)}
      onCancel={() => router.push('/wedding/customers')}
    />
  )
}
