'use client'
// หน้าแพ็กเกจ & บริการเสริม (เฉพาะผู้จัดการร้าน b.oncloud) — ห่อ 2 ส่วน + โทสต์ร่วมของหน้า
import Link from 'next/link'
import { Settings } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import type { WedAddon, WedPackage } from '@/lib/wedding'
import PageToast, { useToast } from './PageToast'
import PackagesManager from './PackagesManager'
import AddonsManager from './AddonsManager'

export default function PackagesClient({
  packages,
  addons,
  addonsError,
}: {
  packages: WedPackage[]
  addons: WedAddon[]
  addonsError: string | null
}) {
  const [toast, setToast] = useToast()
  const message = (text: string) => setToast({ ok: true, text })

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">แพ็กเกจ &amp; บริการเสริม</h1>
          <p className="page-subtitle">ราคา ชั่วโมงทำงาน ทีมงาน และงานที่ลูกค้าจะได้รับ — ใช้เป็นค่าตั้งต้นตอนสร้างงาน</p>
        </div>
        <div className="page-actions">
          <Link href="/wedding/settings#policy" className="btn-secondary w-full sm:w-auto">
            <Settings {...ICON_SM} />
            นโยบายมัดจำ / ค่าล่วงเวลา
          </Link>
        </div>
      </div>

      <PackagesManager initial={packages} onMessage={message} />
      <AddonsManager initial={addons} loadError={addonsError} onMessage={message} />

      <PageToast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}
