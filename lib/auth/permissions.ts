import { cache } from 'react'
import { redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { type Permissions, ADMIN_PERMISSIONS, NO_PERMISSIONS } from '@/types'

export type AppSession = {
  user: User
  role: 'admin' | 'staff'
  permissions: Permissions
  fullName: string | null
}

const PERMISSION_KEYS = Object.keys(NO_PERMISSIONS) as (keyof Permissions)[]

// อ่านสิทธิ์จาก JSON ที่เก็บใน user_profiles.permissions
// fail-closed: เริ่มจากไม่มีสิทธิ์เลย แล้วเปิดเฉพาะคีย์ที่รู้จักและเป็น boolean จริงๆ
function parseStoredPermissions(raw: unknown): Permissions {
  const result: Permissions = { ...NO_PERMISSIONS }
  let value: unknown = raw
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { value = null }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  const obj = value as Record<string, unknown>
  for (const key of PERMISSION_KEYS) {
    const v = obj[key]
    if (typeof v === 'boolean') result[key] = v
  }
  return result
}

// ข้อมูลผู้ใช้ปัจจุบัน + สิทธิ์ — ห่อด้วย cache() ให้ layout และ page ใน request เดียวกันใช้ผลร่วมกัน (ยิง DB ครั้งเดียว)
export const getSession = cache(async (): Promise<AppSession | null> => {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('role, permissions, full_name')
    .eq('id', user.id)
    .maybeSingle()

  // ไม่มีโปรไฟล์ / อ่านไม่ได้ → ถือเป็นพนักงานที่ไม่มีสิทธิ์ใดๆ (ไม่เดาให้สิทธิ์)
  if (error || !profile) {
    return { user, role: 'staff', permissions: { ...NO_PERMISSIONS }, fullName: null }
  }

  const role: 'admin' | 'staff' = profile.role === 'admin' ? 'admin' : 'staff'
  const fullName = typeof profile.full_name === 'string' && profile.full_name.trim()
    ? profile.full_name.trim()
    : null
  const permissions: Permissions = role === 'admin'
    ? { ...ADMIN_PERMISSIONS }
    : parseStoredPermissions(profile.permissions)

  return { user, role, permissions, fullName }
})

// ใช้บนหน้า server component: ไม่ได้ login → /login, ไม่มีสิทธิ์ → /dashboard
export async function requirePermission(perm: keyof Permissions): Promise<AppSession> {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!session.permissions[perm]) redirect('/dashboard')
  return session
}

// เมนูที่ใช้ได้เฉพาะบทบาท admin (เช่น "ตั้งค่าการเชื่อมต่อ" ที่จัดการคีย์ร้าน) — พนักงานที่มีสิทธิ์ครบทุกช่องก็เข้าไม่ได้
// ใช้บนหน้า server component: ไม่ได้ login → /login, ไม่ใช่ admin → /dashboard
export async function requireAdmin(): Promise<AppSession> {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin') redirect('/dashboard')
  return session
}

// ใช้ใน server action (ห้าม redirect กลางคำขอของ action): admin → session, อื่นๆ/อ่านไม่ได้ → null
export async function getAdminSessionOrError(): Promise<AppSession | null> {
  try {
    const session = await getSession()
    return session && session.role === 'admin' ? session : null
  } catch {
    return null
  }
}
