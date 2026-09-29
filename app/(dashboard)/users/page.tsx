import { AlertTriangle } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import type { UserProfile } from '@/types'
import UsersClient from './UsersClient'

export default async function UsersPage() {
  const { user, role, permissions } = await requirePermission('users')

  const supabase = createClient()
  const { data: users, error } = await supabase
    .from('user_profiles')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw new Error(thaiError(error))

  // เพิ่ม/แก้/ลบผู้ใช้ต้องใช้ service role key — ถ้ายังไม่ได้ตั้งค่า เตือนไว้ก่อนเลย
  const serviceKeyMissing = !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL

  // หัวข้อส่งเข้า UsersClient เพื่อให้อยู่แถวเดียวกับปุ่ม "เพิ่มผู้ใช้" บนคอม (มือถือเรียง หัวข้อ → คำเตือน → ปุ่ม เหมือนเดิม)
  return (
    <UsersClient
      users={(users ?? []) as UserProfile[]}
      currentUserId={user.id}
      currentRole={role === 'admin' ? 'admin' : 'staff'}
      currentPermissions={permissions}
      header={
        <>
          <h1 className="page-title">จัดการผู้ใช้</h1>
          <p className="page-subtitle">เพิ่ม / แก้ไข / ลบ และกำหนดสิทธิ์ผู้ใช้</p>
        </>
      }
    >
      {serviceKeyMissing && (
        <div role="alert" className="alert-warn">
          <AlertTriangle {...ICON_SM} />
          <span className="min-w-0 break-words">
            ยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY บน Vercel (Settings → Environment Variables) —
            ดูรายชื่อได้ แต่จะเพิ่ม/แก้ไข/ลบผู้ใช้ไม่ได้จนกว่าจะตั้งค่าและ Redeploy
          </span>
        </div>
      )}
    </UsersClient>
  )
}
