import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import { DEFAULT_PERMISSIONS, ADMIN_PERMISSIONS, type Permissions } from '@/types'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, permissions')
    .eq('id', user.id)
    .single()

  const role: 'admin' | 'staff' = profile?.role === 'admin' ? 'admin' : 'staff'
  const permissions: Permissions = {
    ...(role === 'admin' ? ADMIN_PERMISSIONS : DEFAULT_PERMISSIONS),
    ...(profile?.permissions ?? {}),
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar user={user} permissions={permissions} role={role} />
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
