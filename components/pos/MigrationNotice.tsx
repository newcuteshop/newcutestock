import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { FIX04_MISSING_MSG } from '@/lib/migration'

// แจ้ง "ฐานข้อมูลยังไม่มีระบบนี้" แทนหน้าพัง — ใช้ในหน้า server ที่ต้องพึ่ง supabase-fix-04-pos.sql
// (ไม่มี hook/สถานะ จึงใช้ได้ทั้ง server component และ client component)
//   มี title → แสดงเป็นทั้งหน้า (หัวเรื่องหน้า + กล่องเตือน) เช่น  if (isMigrationMissing(error)) return <MigrationNotice title="ปิดยอดประจำวัน" />
//   ไม่มี title → แสดงแค่กล่องเตือน (วางในส่วนหนึ่งของหน้า)
export default function MigrationNotice({
  title,
  subtitle,
  message = FIX04_MISSING_MSG,
  actions,
}: {
  title?: string
  subtitle?: string
  message?: string
  actions?: ReactNode // ปุ่ม/ลิงก์เสริมใต้ข้อความ (ถ้ามี)
}) {
  const alert = (
    <div role="alert" className="alert-warn">
      <AlertTriangle {...ICON_SM} />
      <div className="min-w-0 space-y-2">
        <p className="min-w-0 break-words">{message}</p>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
  if (!title) return alert
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
      </div>
      {alert}
    </div>
  )
}
