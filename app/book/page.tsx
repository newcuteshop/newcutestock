import { bangkokTodayKey } from '@/lib/format'
import { getCatalog, getPublicInfo } from '@/components/book/server'
import { readCatalogQuery, type SearchParamsRecord } from '@/components/book/catalogQuery'
import NoticeCard from '@/components/book/NoticeCard'
import CatalogClient from '@/components/book/CatalogClient'

// /book — หน้าแรกจองชุดออนไลน์: แนะนำร้าน + ตัวกรอง (วันรับ–คืน / หมวด / ค้นหา / ไซส์) + รายการชุด
// โหลดชุดรอบแรกฝั่งเซิร์ฟเวอร์ตามตัวกรองใน URL (แชร์ลิงก์ที่กรองไว้ได้) แล้วฝั่งเบราว์เซอร์โหลดใหม่เองตอนเปลี่ยนตัวกรอง
export const dynamic = 'force-dynamic'

export default async function BookHomePage({ searchParams }: { searchParams: SearchParamsRecord }) {
  const infoRes = await getPublicInfo()
  if (!infoRes.ok) {
    return infoRes.missing ? <NoticeCard kind="notReady" /> : <NoticeCard kind="error" retryHref="/book" />
  }
  const info = infoRes.data
  const contact = { phone: info.phone, line_id: info.line_id, line_url: info.line_url, facebook_url: info.facebook_url }
  if (!info.online_enabled) {
    return <NoticeCard kind="closed" message={info.online_notice} contact={contact} />
  }

  // วันนี้ตามฐานข้อมูล (เวลาไทย) ก่อน — ตรงกับที่ฐานข้อมูลใช้ตรวจวันจองล่วงหน้า ; ไม่ได้ส่งมาค่อยใช้นาฬิกาเซิร์ฟเวอร์
  const todayKey = info.today ?? bangkokTodayKey()
  const query = readCatalogQuery(searchParams, {
    categoryIds: info.categories.map(c => c.id),
    todayKey,
    leadDays: info.online_min_lead_days,
    maxDays: info.online_max_days,
  })
  const cat = await getCatalog(query)

  return (
    <CatalogClient
      info={info}
      todayKey={todayKey}
      initialQuery={query}
      initialItems={cat.ok ? cat.data.items : null}
      initialError={cat.ok ? null : cat.message}
    />
  )
}
