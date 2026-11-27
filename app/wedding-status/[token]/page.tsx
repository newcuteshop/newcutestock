import type { Metadata } from 'next'
import { DEFAULT_WEDDING_SHOP_NAME, weddingImageUrl, type WedPublicBooking } from '@/lib/wedding'
import { weddingTabIcons } from '@/lib/weddingServer'
import ShopTabIcon from '@/components/theme/ShopTabIcon'
import { getWeddingPortal } from '@/components/wedding/portal/server'
import PortalShell from '@/components/wedding/portal/PortalShell'
import PortalNotice from '@/components/wedding/portal/PortalNotice'
import PortalClient from '@/components/wedding/portal/PortalClient'

// /wedding-status/<token> — หน้าติดตามงานของคู่บ่าวสาว (ลิงก์ส่วนตัว ใครมีลิงก์ดูได้ — ชื่อ/เบอร์ถูกปิดบางส่วนจากฐานข้อมูล)
// - โทเคนผิดรูปแบบ → การ์ด "ไม่พบงานนี้" ทันที (ไม่ยิงฐานข้อมูล · ไม่ใช้ notFound() เพราะหน้า 404 รากมีประตูเข้าระบบ)
// - ร้านปิดลิงก์ / งานยกเลิก / ลิงก์ถูกเปลี่ยน → การ์ดแจ้งพร้อมปุ่มติดต่อร้าน (PortalClient จัดการทุกสถานะ รวมถึงตอนกดอัปเดต)
// - ข้อมูลต้องสดทุกครั้งที่เปิด → ไม่แคชหน้า
export const dynamic = 'force-dynamic'

type PageProps = { params: { token: string } }

function cleanToken(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase()
}

// ลิงก์โลโก้ร้านจากข้อมูลงานของโทเคน (ไม่พบงาน = ไม่รู้ร้าน → '' = ไอคอนแอปเดิม)
function shopLogoOf(data: WedPublicBooking): string {
  return data.state !== 'not_found' ? weddingImageUrl(data.shop.logo_url_path) : ''
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const r = await getWeddingPortal(cleanToken(params.token))
  const name = r.ok && r.data.state !== 'not_found' ? r.data.shop.name : DEFAULT_WEDDING_SHOP_NAME
  const couple = r.ok && r.data.state === 'ok' && r.data.couple_names ? r.data.couple_names : ''
  // ไอคอนแท็บ = โลโก้ร้าน (ร้านยังไม่มีโลโก้ = ไอคอนแอปเดิม)
  const icons = r.ok ? weddingTabIcons(shopLogoOf(r.data)) : undefined
  return {
    ...(icons ? { icons } : {}),
    title: { absolute: couple ? `ติดตามงาน ${couple} · ${name}` : `ติดตามงาน · ${name}` },
    description: `ติดตามตารางคิว ผลงาน และยอดชำระกับ ${name}`,
    applicationName: name,
    appleWebApp: { capable: true, title: name, statusBarStyle: 'default' },
    robots: { index: false, follow: false, nocache: true },
    referrer: 'no-referrer',
  }
}

export default async function WeddingStatusPage({ params }: PageProps) {
  const token = cleanToken(params.token)
  const r = await getWeddingPortal(token)
  if (!r.ok) {
    return (
      <PortalShell shop={null}>
        {r.missing ? (
          <PortalNotice kind="notReady" />
        ) : (
          <PortalNotice kind="error" retryHref={`/wedding-status/${encodeURIComponent(token)}`} message={r.message} />
        )}
      </PortalShell>
    )
  }
  const logo = shopLogoOf(r.data)
  return (
    <>
      {logo && <ShopTabIcon href={logo} />}
      <PortalClient key={token} token={token} initial={r.data} />
    </>
  )
}
