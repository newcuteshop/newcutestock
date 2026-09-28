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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">จัดการผู้ใช้</h1>
        <p className="text-gray-500 text-sm mt-1">เพิ่ม / แก้ไข / ลบ และกำหนดสิทธิ์ผู้ใช้</p>
      </div>
      {serviceKeyMissing && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ⚠️ ยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY บน Vercel (Settings → Environment Variables) —
          ดูรายชื่อได้ แต่จะเพิ่ม/แก้ไข/ลบผู้ใช้ไม่ได้จนกว่าจะตั้งค่าและ Redeploy
        </div>
      )}
      <UsersClient
        users={(users ?? []) as UserProfile[]}
        currentUserId={user.id}
        currentRole={role === 'admin' ? 'admin' : 'staff'}
        currentPermissions={permissions}
      />
    </div>
  )
}
