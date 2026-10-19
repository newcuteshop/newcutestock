import type { Metadata } from 'next'
import { bangkokTodayKey } from '@/lib/format'
import { getPublicInfo } from '@/components/book/server'
import NoticeCard from '@/components/book/NoticeCard'
import CheckoutClient from '@/components/book/CheckoutClient'

// /book/checkout — รายการจอง + ข้อมูลผู้จอง + ส่งคำขอจอง (ตะกร้าอยู่ในเครื่องลูกค้า ไม่มีข้อมูลฝั่งเซิร์ฟเวอร์)
// ไม่ให้ search engine เก็บหน้านี้
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'ส่งคำขอจอง',
  robots: { index: false, follow: false },
}

export default async function BookCheckoutPage() {
  const infoRes = await getPublicInfo()
  if (!infoRes.ok) {
    return infoRes.missing ? <NoticeCard kind="notReady" /> : <NoticeCard kind="error" retryHref="/book/checkout" />
  }
  const info = infoRes.data
  if (!info.online_enabled) {
    const contact = { phone: info.phone, line_id: info.line_id, line_url: info.line_url, facebook_url: info.facebook_url }
    return <NoticeCard kind="closed" message={info.online_notice} contact={contact} />
  }
  return <CheckoutClient info={info} todayKey={info.today ?? bangkokTodayKey()} />
}
