'use server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import type { Permissions } from '@/types'

// ตรวจว่าผู้ใช้ปัจจุบันเป็น admin
async function requireAdmin() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('ไม่ได้เข้าสู่ระบบ')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, permissions')
    .eq('id', user.id)
    .single()

  if (!profile || (profile.role !== 'admin' && !profile.permissions?.users)) {
    throw new Error('ไม่มีสิทธิ์จัดการผู้ใช้')
  }
  return user
}

export async function createUserAction(input: {
  email: string
  password: string
  fullName: string
  role: 'admin' | 'staff'
  permissions: Permissions
}) {
  try {
    await requireAdmin()
    const admin = createAdminClient()
    const { data, error } = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: {
        full_name: input.fullName,
        role: input.role,
        permissions: input.permissions,
      },
    })
    if (error) return { error: error.message }

    // sync user_profile (เผื่อ trigger ไม่ได้กำหนดครบ)
    if (data.user) {
      await admin.from('user_profiles').upsert({
        id: data.user.id,
        email: input.email,
        full_name: input.fullName,
        role: input.role,
        permissions: input.permissions,
      })
    }
    revalidatePath('/users')
    return { success: true }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }
  }
}

export async function updateUserAction(input: {
  id: string
  fullName: string
  role: 'admin' | 'staff'
  permissions: Permissions
  password?: string
}) {
  try {
    await requireAdmin()
    const admin = createAdminClient()

    await admin.from('user_profiles').update({
      full_name: input.fullName,
      role: input.role,
      permissions: input.permissions,
    }).eq('id', input.id)

    if (input.password) {
      const { error } = await admin.auth.admin.updateUserById(input.id, {
        password: input.password,
      })
      if (error) return { error: error.message }
    }
    revalidatePath('/users')
    return { success: true }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }
  }
}

export async function deleteUserAction(id: string) {
  try {
    const me = await requireAdmin()
    if (me.id === id) return { error: 'ไม่สามารถลบบัญชีตัวเองได้' }
    const admin = createAdminClient()
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) return { error: error.message }
    revalidatePath('/users')
    return { success: true }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }
  }
}
