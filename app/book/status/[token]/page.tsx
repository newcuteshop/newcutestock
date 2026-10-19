import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isBookingToken } from '@/lib/rental'
import { getPublicBooking, getPublicInfo } from '@/components/book/server'
import type { SearchParamsRecord } from '@/components/book/catalogQuery'
import NoticeCard from '@/components/book/NoticeCard'
import StatusClient from '@/components/book/StatusClient'

// /book/status/<token> — หน้าสถานะการจองของลูกค้า (ลิงก์ส่วนตัว ใครมีลิงก์ดูได้ — ชื่อ/เบอร์ถูกปิดบางส่วนจากฐานข้อมูล)
// - โทเคนผิดรูปแบบ → 404 ทันที (ไม่ยิงฐานข้อมูล)
// - ไม่ให้ search engine เก็บ และไม่ส่งที่อยู่หน้านี้ (มีโทเคน) เป็น referrer ให้เว็บอื่น
// - ใช้ได้แม้ร้านปิดรับจองออนไลน์แล้ว (การจองเดิมยังต้องดูสถานะ/ส่งสลิปได้)
// ?new=1 = เพิ่งส่งคำขอ · ?new=2 = ส่งซ้ำแล้วได้คำขอเดิม (หน้าลบพารามิเตอร์นี้ออกจาก URL เองหลังเปิด)
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'สถานะการจอง',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

type PageProps = { params: { token: string }; searchParams: SearchParamsRecord }

export default async function BookStatusPage({ params, searchParams }: PageProps) {
  const token = String(params.token ?? '').trim().toLowerCase()
  if (!isBookingToken(token)) notFound()

  const r = await getPublicBooking(token)
  if (!r.ok) {
    return r.missing ? <NoticeCard kind="notReady" /> : <NoticeCard kind="error" retryHref={`/book/status/${token}`} />
  }
  if (!r.data) {
    const infoRes = await getPublicInfo()
    const contact = infoRes.ok
      ? { phone: infoRes.data.phone, line_id: infoRes.data.line_id, line_url: infoRes.data.line_url }
      : null
    return (
      <NoticeCard
        kind="notFound"
        title="ไม่พบการจองนี้"
        message="ลิงก์อาจไม่ครบหรือไม่ถูกต้อง — ตรวจสอบลิงก์ที่ได้รับ หรือติดต่อร้านพร้อมเลขที่การจอง"
        contact={contact}
      />
    )
  }

  const raw = Array.isArray(searchParams.new) ? searchParams.new[0] : searchParams.new
  const justCreated = raw === '1' ? 1 : raw === '2' ? 2 : 0

  return <StatusClient key={token} token={token} initial={r.data} justCreated={justCreated} />
}
