import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import UsersClient from './UsersClient'

export default async function UsersPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('user_profiles')
    .select('role, permissions')
    .eq('id', user.id)
    .single()

  if (!me || (me.role !== 'admin' && !me.permissions?.users)) {
    redirect('/dashboard')
  }

  const { data: users } = await supabase
    .from('user_profiles')
    .select('*')
    .order('created_at', { ascending: true })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">จัดการผู้ใช้</h1>
        <p className="text-gray-500 text-sm mt-1">เพิ่ม / แก้ไข / ลบ และกำหนดสิทธิ์ผู้ใช้</p>
      </div>
      <UsersClient users={users ?? []} currentUserId={user.id} />
    </div>
  )
}
