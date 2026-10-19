import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { baht, bangkokTodayKey, isDayKey } from '@/lib/format'
import { rentalImageUrl } from '@/lib/rental'
import { getPublicInfo, getPublicItem } from '@/components/book/server'
import type { SearchParamsRecord } from '@/components/book/catalogQuery'
import { rangeProblem } from '@/components/book/dates'
import NoticeCard from '@/components/book/NoticeCard'
import ItemClient from '@/components/book/ItemClient'

// /book/item/<รหัสชุด> — หน้าชุด 1 แบบ: รูป รายละเอียด ราคา ไซส์ ปฏิทินวันว่าง และเพิ่มในรายการจอง
// ?from=YYYY-MM-DD&to=YYYY-MM-DD (พกมาจากหน้าแรก) = เลือกช่วงวันนั้นไว้ให้ (ไม่ผ่านเงื่อนไขจองออนไลน์ = ไม่ใช้)
// ชุดที่ไม่มี / ปิดใช้งาน / ไม่เปิดให้จองออนไลน์ → 404 ของหน้าจองออนไลน์ (app/book/not-found.tsx)
export const dynamic = 'force-dynamic'

type PageProps = { params: { code: string }; searchParams: SearchParamsRecord }

// รหัสชุดจาก URL (บางสภาพแวดล้อมส่ง params มาแบบยังเข้ารหัส %xx อยู่)
function codeOf(raw: string): string {
  const s = typeof raw === 'string' ? raw : ''
  if (!/%[0-9a-f]{2}/i.test(s)) return s.trim()
  try {
    return decodeURIComponent(s).trim()
  } catch {
    return s.trim()
  }
}

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '')
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const code = codeOf(params.code)
  if (!code || code.length > 60) return { title: 'ไม่พบชุด', robots: { index: false, follow: false } }
  const r = await getPublicItem(code)
  if (!r.ok || !r.data) return { title: 'ไม่พบชุด', robots: { index: false, follow: false } }
  const it = r.data
  const description =
    it.description?.replace(/\s+/g, ' ').trim().slice(0, 160) ||
    `${it.name} ให้เช่า ${baht(it.base_price)} / ${it.base_days} วัน — ดูวันว่างและจองออนไลน์`
  const cover = it.images[0]?.path
  return {
    title: it.name,
    description,
    openGraph: {
      title: it.name,
      description,
      images: cover ? [{ url: rentalImageUrl(cover), alt: it.name }] : undefined,
    },
  }
}

export default async function BookItemPage({ params, searchParams }: PageProps) {
  const code = codeOf(params.code)
  if (!code || code.length > 60) notFound()

  const infoRes = await getPublicInfo()
  if (!infoRes.ok) {
    return infoRes.missing ? <NoticeCard kind="notReady" /> : <NoticeCard kind="error" retryHref={`/book/item/${encodeURIComponent(code)}`} />
  }
  const info = infoRes.data
  if (!info.online_enabled) {
    const contact = { phone: info.phone, line_id: info.line_id, line_url: info.line_url, facebook_url: info.facebook_url }
    return <NoticeCard kind="closed" message={info.online_notice} contact={contact} />
  }

  const r = await getPublicItem(code)
  if (!r.ok) {
    return r.missing ? <NoticeCard kind="notReady" /> : <NoticeCard kind="error" retryHref={`/book/item/${encodeURIComponent(code)}`} />
  }
  if (!r.data) notFound()

  // วันนี้ตามฐานข้อมูล (เวลาไทย) ก่อน — ตรงกับที่ฐานข้อมูลใช้ตรวจวันจองล่วงหน้า ; ไม่ได้ส่งมาค่อยใช้นาฬิกาเซิร์ฟเวอร์
  const todayKey = info.today ?? bangkokTodayKey()
  const from = first(searchParams.from).trim()
  const to = first(searchParams.to).trim()
  const ok = isDayKey(from) && isDayKey(to) && rangeProblem(from, to, todayKey, info.online_min_lead_days, info.online_max_days) === null

  // key = id ชุด: เปลี่ยนไปหน้าชุดอื่นต้องเริ่มสถานะใหม่หมด (ไซส์/วันว่าง/วันที่เลือกของชุดก่อนไม่ติดมา)
  return (
    <ItemClient
      key={r.data.id}
      item={r.data}
      info={info}
      todayKey={todayKey}
      initialFrom={ok ? from : null}
      initialTo={ok ? to : null}
    />
  )
}
