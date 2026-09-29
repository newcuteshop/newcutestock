import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth/permissions'

// /settings → หน้าตั้งค่าการเชื่อมต่อ (ตอนนี้มีหน้าเดียว) — เฉพาะแอดมิน
export default async function SettingsIndex() {
  await requireAdmin()
  redirect('/settings/integrations')
}
