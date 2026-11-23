import { cache } from 'react'
import { redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { type Permissions, ADMIN_PERMISSIONS, NO_PERMISSIONS, SHOP_PERMISSION_KEYS } from '@/types'

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

// ===== ร้านเช่าชุด + ร้าน b.oncloud + ตัวเลือกร้าน (/select) =====
// ระบบมี 3 ร้านในฐานข้อมูล/ผู้ใช้ชุดเดียวกัน — สิทธิ์แยกตามร้าน (types/index.ts PERMISSION_GROUPS)
// rental_manage ครอบ rental เสมอ (ตรงกับ rental_staff() ในฐานข้อมูล = has_perm('rental') หรือ has_perm('rental_manage'))
// wedding_manage ครอบ wedding เสมอ (ตรงกับ wed_staff() ในฐานข้อมูล = has_perm('wedding') หรือ has_perm('wedding_manage'))

type PermSource = Pick<AppSession, 'role' | 'permissions'>

// คีย์ที่นับว่า "เข้าร้าน NEWCUTE ได้" (users = จัดการผู้ใช้ อยู่ในหน้าระบบของ NEWCUTE)
// (รายการเดียวกับ SHOP_PERMISSION_KEYS.newcute ใน types/index.ts — เมนูฝั่งเบราว์เซอร์ใช้ชุดเดียวกัน)
const NEWCUTE_KEYS: readonly (keyof Permissions)[] = SHOP_PERMISSION_KEYS.newcute

/** พนักงานร้านเช่าชุด (จอง/รับ-คืน/รับเงิน) — admin หรือ rental หรือ rental_manage */
export function isRentalStaff(s: PermSource | null | undefined): boolean {
  if (!s) return false
  return s.role === 'admin' || s.permissions.rental === true || s.permissions.rental_manage === true
}

/** ผู้จัดการร้านเช่าชุด (จัดการชุด/ราคา/ตั้งค่า/รายงาน) — admin หรือ rental_manage */
export function isRentalManager(s: PermSource | null | undefined): boolean {
  if (!s) return false
  return s.role === 'admin' || s.permissions.rental_manage === true
}

/** พนักงานร้าน b.oncloud (งาน/ปฏิทิน/รับเงิน) — admin หรือ wedding หรือ wedding_manage */
export function isWeddingStaff(s: PermSource | null | undefined): boolean {
  if (!s) return false
  return s.role === 'admin' || s.permissions.wedding === true || s.permissions.wedding_manage === true
}

/** ผู้จัดการร้าน b.oncloud (แพ็กเกจ/ทีมงาน/ค่าจ้างทีม/กำไร/ตั้งค่า/รายงาน) — admin หรือ wedding_manage */
export function isWeddingManager(s: PermSource | null | undefined): boolean {
  if (!s) return false
  return s.role === 'admin' || s.permissions.wedding_manage === true
}

/** ร้านที่ผู้ใช้เข้าได้ (ผลของ shopAccess) */
export type ShopAccess = { newcute: boolean; rental: boolean; wedding: boolean }

/** ผู้ใช้นี้เข้าร้านไหนได้บ้าง — ใช้ตัดสินใจหน้า /select และการแสดงลิงก์ "เปลี่ยนร้าน" */
export function shopAccess(s: PermSource | null | undefined): ShopAccess {
  if (!s) return { newcute: false, rental: false, wedding: false }
  const admin = s.role === 'admin'
  return {
    newcute: admin || NEWCUTE_KEYS.some(k => s.permissions[k] === true),
    rental: isRentalStaff(s),
    wedding: isWeddingStaff(s),
  }
}

/** จำนวนร้านที่เข้าได้ (0–3) */
export function shopCount(access: ShopAccess): number {
  return (access.newcute ? 1 : 0) + (access.rental ? 1 : 0) + (access.wedding ? 1 : 0)
}

/** แสดงลิงก์ "เปลี่ยนร้าน" (/select) ในเมนูไหม — เข้าได้ตั้งแต่ 2 ร้านขึ้นไป */
export function canSwitchShop(access: ShopAccess): boolean {
  return shopCount(access) >= 2
}

/**
 * หน้าแรกของร้านเดียวที่เข้าได้ ('/dashboard' | '/rental' | '/wedding') — เข้าได้ 0 หรือหลายร้าน → null
 * ใช้ในหน้า /select (ร้านเดียว = พาเข้าร้านนั้นทันที) และ layout ของร้านที่ผู้ใช้ไม่มีสิทธิ์ (พาไปร้านที่เป็นของเขา)
 */
export function singleShopHome(access: ShopAccess): '/dashboard' | '/rental' | '/wedding' | null {
  if (shopCount(access) !== 1) return null
  if (access.newcute) return '/dashboard'
  if (access.rental) return '/rental'
  return '/wedding'
}

// ใช้บนหน้า server component ของร้านเช่าชุด: ไม่ได้ login → /login, ไม่มีสิทธิ์ร้านเช่าชุด → /select
export async function requireRental(): Promise<AppSession> {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!isRentalStaff(session)) redirect('/select')
  return session
}

// หน้าเฉพาะผู้จัดการร้านเช่าชุด (ตั้งค่า/รายงาน/จัดการชุด): ไม่ได้ login → /login, ไม่มีสิทธิ์ร้านเช่าชุด → /select,
// เป็นพนักงานร้านเช่าแต่ไม่ใช่ผู้จัดการ → /rental (หน้าภาพรวมร้านเช่า)
export async function requireRentalManager(): Promise<AppSession> {
  const session = await requireRental()
  if (!isRentalManager(session)) redirect('/rental')
  return session
}

// ใช้บนหน้า server component ของร้าน b.oncloud: ไม่ได้ login → /login, ไม่มีสิทธิ์ร้าน b.oncloud → /select
export async function requireWedding(): Promise<AppSession> {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!isWeddingStaff(session)) redirect('/select')
  return session
}

// หน้าเฉพาะผู้จัดการร้าน b.oncloud (แพ็กเกจ/ทีมงาน-ค่าจ้าง/ตั้งค่า/รายงาน): ไม่ได้ login → /login,
// ไม่มีสิทธิ์ร้าน b.oncloud → /select, เป็นพนักงานแต่ไม่ใช่ผู้จัดการ → /wedding (หน้าภาพรวม)
export async function requireWeddingManager(): Promise<AppSession> {
  const session = await requireWedding()
  if (!isWeddingManager(session)) redirect('/wedding')
  return session
}
