import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { type Permissions, DEFAULT_PERMISSIONS, ADMIN_PERMISSIONS } from '@/types'

export async function requirePermission(perm: keyof Permissions) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, permissions')
    .eq('id', user.id)
    .single()

  const role = profile?.role
  const permissions: Permissions = {
    ...(role === 'admin' ? ADMIN_PERMISSIONS : DEFAULT_PERMISSIONS),
    ...(profile?.permissions ?? {}),
  }

  if (!permissions[perm]) redirect('/dashboard')
  return { user, role, permissions }
}
