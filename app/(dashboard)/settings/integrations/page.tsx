import { AlertTriangle, ShieldCheck, XCircle } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import type { ChannelJson, IntegrationAlerts } from '@/lib/integrations/types'
import IntegrationsOverview from '@/components/integrations/IntegrationsOverview'
import { firstParam } from '@/components/integrations/format'
import { encKeyConfigured, migrationMissing } from '@/components/integrations/serverChecks'

// ข้อมูลสดทุกครั้ง (สถานะช่องทาง/งานค้าง) — โหลดครั้งเดียวต่อการเปิดหน้า ไม่มี poll
export const dynamic = 'force-dynamic'
// server action ของหน้านี้ (ซิงก์ตอนนี้ / ส่งสต๊อกครั้งแรก / จับคู่อัตโนมัติ / นำเข้า CSV) ทำงานในฟังก์ชันของหน้านี้
// และใช้เวลาได้ถึง ~45 วินาที — ขยายเพดาน ไม่ให้ถูกตัดกลางทาง (นำเข้าครึ่งเดียว / lease ค้างจนหมดเวลา)
export const maxDuration = 60

// ?error= จาก OAuth callback (ลิงก์หมดอายุ ฯลฯ) — รหัสสั้นเท่านั้น ไม่ใช่ข้อความจากแพลตฟอร์ม
const ERROR_TEXT: Record<string, string> = {
  state: 'ลิงก์เชื่อมต่อหมดอายุหรือถูกใช้แล้ว กรุณากดเชื่อมต่อใหม่',
  denied: 'ร้านไม่ได้กดอนุญาต',
  exchange: 'เชื่อมต่อไม่สำเร็จ ดูบันทึกการซิงก์',
  shop: 'เชื่อมต่อไม่สำเร็จ ดูบันทึกการซิงก์',
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  await requireAdmin()
  const supabase = createClient()
  const [chRes, alRes] = await Promise.all([
    supabase.rpc('list_integration_channels'),
    supabase.rpc('integration_alerts'),
  ])

  const errorCode = firstParam(searchParams.error)
  const errorText = ERROR_TEXT[errorCode] ?? null

  // ยังไม่ได้รัน supabase-fix-03-integrations.sql → บอกตรงๆ แทนหน้าพัง
  if (chRes.error && migrationMissing(chRes.error)) {
    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="page-header">
          <div className="min-w-0">
            <h1 className="page-title">ตั้งค่าการเชื่อมต่อ</h1>
          </div>
        </div>
        <div role="alert" className="alert-warn">
          <AlertTriangle {...ICON_SM} />
          <p className="min-w-0">
            ฐานข้อมูลยังไม่มีระบบเชื่อมต่อ — รันไฟล์ supabase-fix-03-integrations.sql ใน Supabase SQL Editor ก่อน แล้วโหลดหน้านี้ใหม่
          </p>
        </div>
      </div>
    )
  }
  if (chRes.error) throw new Error(thaiError(chRes.error))

  const channels = (Array.isArray(chRes.data) ? chRes.data : []) as ChannelJson[]
  const alerts = !alRes.error && alRes.data && typeof alRes.data === 'object' ? (alRes.data as IntegrationAlerts) : null
  const encOk = encKeyConfigured()

  return (
    <IntegrationsOverview channels={channels} alerts={alerts} nowMs={Date.now()}>
      {!encOk && (
        <div role="alert" className="alert-err">
          <ShieldCheck {...ICON_SM} />
          <p className="min-w-0">
            ยังไม่ได้ตั้งค่า INTEGRATIONS_ENC_KEY บน Vercel — บันทึกคีย์ของแพลตฟอร์มไม่ได้จนกว่าจะตั้งค่าและ Redeploy
            (ส่วนอื่นของแอปใช้งานได้ตามปกติ)
          </p>
        </div>
      )}
      {errorText && (
        <div role="alert" className="alert-err">
          <XCircle {...ICON_SM} />
          <p className="min-w-0">{errorText}</p>
        </div>
      )}
    </IntegrationsOverview>
  )
}
