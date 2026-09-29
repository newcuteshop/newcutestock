'use server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { thaiError } from '@/lib/format'
import { checkRawPassword, loginToEmail, toAuthPassword } from '@/lib/auth/credentials'
import { type Permissions, ADMIN_PERMISSIONS, NO_PERMISSIONS, PERMISSION_LABELS } from '@/types'

// =========================================
// กติกาความปลอดภัย (ตรวจฝั่ง server ทุกครั้ง — ห้ามเชื่อค่าจาก browser)
// - ผู้เรียกต้องเป็น admin หรือมีสิทธิ์ permissions.users
// - ผู้เรียกที่ไม่ใช่ admin: สร้าง/ตั้งใครเป็น admin ไม่ได้, ให้สิทธิ์ "จัดการผู้ใช้" ไม่ได้,
//   ให้สิทธิ์ที่ตัวเองไม่มีไม่ได้, แก้/ลบ/ตั้งรหัสผ่านให้บัญชี admin หรือบัญชีที่มีสิทธิ์ "จัดการผู้ใช้"
//   หรือมีสิทธิ์ที่ตัวเองไม่มีไม่ได้ (กันสร้างบัญชีสำรองสิทธิ์สูงกว่า / ยึดบัญชีคนอื่น),
//   แก้บทบาท/สิทธิ์ของตัวเองไม่ได้ (แก้ได้แค่ชื่อ ชื่อผู้ใช้ รหัสผ่าน)
// - ห้ามลด/ลบ admin คนสุดท้าย (ฐานข้อมูลกันซ้ำอีกชั้นด้วย trigger keep_last_admin), ห้ามลบบัญชีตัวเอง
// ชื่อผู้ใช้/รหัสผ่านแปลงก่อนส่งให้ Supabase Auth เสมอ (ชื่อ → อีเมล @newcute.com, รหัส → 'newcute:' + รหัส)
// ดูเหตุผลใน lib/auth/credentials.ts
// =========================================

type Role = 'admin' | 'staff'
type ActionResult = { success?: boolean; error?: string }
type AdminClient = ReturnType<typeof createAdminClient>

interface Caller { id: string; role: Role; permissions: Permissions }
interface TargetProfile {
  id: string
  email: string | null
  role: Role
  rawPermissions: Record<string, unknown>
}

const PERM_KEYS = Object.keys(ADMIN_PERMISSIONS) as (keyof Permissions)[]
const MAX_NAME = 100

// error ที่เราตั้งใจส่งข้อความไทยกลับไปตรงๆ (เช็คด้วย name — ไม่พึ่ง instanceof ของ subclass Error)
const ACTION_ERROR = 'ActionError'

function fail(message: string): never {
  const err = new Error(message)
  err.name = ACTION_ERROR
  throw err
}

function toResultError(e: unknown): ActionResult {
  if (e instanceof Error && e.name === ACTION_ERROR) return { error: e.message }
  return { error: thaiError(e) }
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

// แปลงค่าสิทธิ์จากภายนอกให้เหลือ 6 ช่อง boolean เท่านั้น (ค่าอื่นทิ้งหมด)
function coercePermissions(raw: unknown): Permissions {
  const src = asRecord(raw)
  const out: Permissions = { ...NO_PERMISSIONS }
  for (const key of PERM_KEYS) out[key] = src[key] === true
  return out
}

// สิทธิ์ใน want ที่ผู้เรียกเองไม่มี (เป็นชื่อภาษาไทย) — ว่าง = ไม่เกินสิทธิ์ของผู้เรียก
function extraPerms(want: Permissions, have: Permissions): string[] {
  return PERM_KEYS.filter(k => want[k] && !have[k]).map(k => PERMISSION_LABELS[k])
}

// ผู้เรียกที่ไม่ใช่ admin จัดการบัญชีนี้ได้ไหม: ต้องไม่มีสิทธิ์ "จัดการผู้ใช้" และไม่มีสิทธิ์เกินผู้เรียก
function withinCallerPerms(target: TargetProfile, caller: Caller): boolean {
  const tp = coercePermissions(target.rawPermissions)
  return target.role !== 'admin' && !tp.users && extraPerms(tp, caller.permissions).length === 0
}

function parseRole(raw: unknown): Role {
  if (raw === 'admin' || raw === 'staff') return raw
  return fail('บทบาทไม่ถูกต้อง (ต้องเป็น Admin หรือ Staff)')
}

// ชื่อผู้ใช้ (หรืออีเมล) → อีเมลที่เก็บใน Auth และ user_profiles.email
function parseLogin(raw: unknown): string {
  const result = loginToEmail(String(raw ?? ''))
  if ('error' in result) return fail(result.error)
  return result.email
}

// คืนรหัสผ่านที่ผู้ใช้พิมพ์ (ยังไม่แปลง) — ตอนส่งให้ Supabase ต้องผ่าน toAuthPassword() เสมอ
function parsePassword(raw: unknown): string {
  const password = String(raw ?? '')
  const invalid = checkRawPassword(password)
  if (invalid) fail(invalid)
  return password
}

function parseFullName(raw: unknown): string {
  const name = String(raw ?? '').trim()
  if (name.length > MAX_NAME) fail(`ชื่อยาวเกินไป (สูงสุด ${MAX_NAME} ตัวอักษร)`)
  return name
}

function parseId(raw: unknown): string {
  const id = String(raw ?? '').trim()
  if (!id) fail('ไม่พบผู้ใช้ที่ต้องการ')
  return id
}

// แปล error จาก Supabase Auth (สร้าง/แก้ผู้ใช้) เป็นภาษาไทย
function authErrorThai(err: unknown): string {
  const e = asRecord(err)
  const msg = String(e.message ?? '').toLowerCase()
  const code = String(e.code ?? '')
  if (code === 'email_exists' || code === 'user_already_exists' || msg.includes('already been registered') || msg.includes('already registered')) {
    return 'ชื่อผู้ใช้นี้มีคนใช้แล้ว'
  }
  if (code === 'weak_password' || msg.includes('password should')) {
    return 'รหัสผ่านง่ายเกินไป กรุณาตั้งให้ยาวขึ้นหรือผสมตัวอักษรกับตัวเลข'
  }
  if (code === 'email_address_invalid' || msg.includes('unable to validate email') || msg.includes('invalid email')) {
    return 'ชื่อผู้ใช้หรืออีเมลไม่ถูกต้อง'
  }
  if (code === 'user_not_found' || msg.includes('user not found')) {
    return 'ไม่พบผู้ใช้นี้ (อาจถูกลบไปแล้ว)'
  }
  return thaiError(err)
}

// ผู้เรียก: ยืนยันตัวตนด้วย getUser() (ตรวจกับ Auth server) + อ่านโปรไฟล์ของตัวเอง
async function loadCaller(): Promise<Caller> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) fail('หมดเวลาเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่')

  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('role, permissions')
    .eq('id', user.id)
    .maybeSingle()
  if (error) fail(thaiError(error))

  // fail-closed: ไม่มีโปรไฟล์/ค่าแปลกๆ = staff ไม่มีสิทธิ์
  const p = asRecord(profile)
  const role: Role = p.role === 'admin' ? 'admin' : 'staff'
  const permissions = role === 'admin' ? { ...ADMIN_PERMISSIONS } : coercePermissions(p.permissions)
  if (role !== 'admin' && !permissions.users) fail('คุณไม่มีสิทธิ์จัดการผู้ใช้')

  return { id: user.id, role, permissions }
}

// เป้าหมาย: อ่านด้วย service role (ไม่ติด RLS)
async function loadTarget(admin: AdminClient, id: string): Promise<TargetProfile> {
  const { data, error } = await admin
    .from('user_profiles')
    .select('id, email, role, permissions')
    .eq('id', id)
    .maybeSingle()
  if (error) fail(thaiError(error))
  if (!data) fail('ไม่พบผู้ใช้นี้ (อาจถูกลบไปแล้ว)')

  const d = asRecord(data)
  return {
    id: String(d.id),
    email: typeof d.email === 'string' ? d.email : null,
    role: d.role === 'admin' ? 'admin' : 'staff',
    rawPermissions: asRecord(d.permissions),
  }
}

async function countAdmins(admin: AdminClient): Promise<number> {
  const { count, error } = await admin
    .from('user_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')
  if (error) fail('ตรวจสอบจำนวน Admin ไม่สำเร็จ: ' + thaiError(error))
  return count ?? 0
}

async function ensureNotLastAdmin(admin: AdminClient, action: string) {
  const admins = await countAdmins(admin)
  if (admins <= 1) fail(`ต้องมี Admin อย่างน้อย 1 คน — ${action} Admin คนสุดท้ายไม่ได้`)
}

// =========================================
// สร้างผู้ใช้
// =========================================
export async function createUserAction(input: {
  login: string // ชื่อผู้ใช้ หรืออีเมลเต็ม
  password: string
  fullName: string
  role: 'admin' | 'staff'
  permissions: Permissions
}): Promise<ActionResult> {
  try {
    const caller = await loadCaller()
    const src = asRecord(input)
    const email = parseLogin(src.login)
    const password = parsePassword(src.password)
    const fullName = parseFullName(src.fullName)
    const role = parseRole(src.role)
    const permissions = role === 'admin' ? { ...ADMIN_PERMISSIONS } : coercePermissions(src.permissions)

    if (caller.role !== 'admin') {
      if (role === 'admin') fail('เฉพาะ Admin เท่านั้นที่สร้างผู้ใช้ระดับ Admin ได้')
      if (permissions.users) fail('เฉพาะ Admin เท่านั้นที่ให้สิทธิ์ "จัดการผู้ใช้" ได้')
      const extra = extraPerms(permissions, caller.permissions)
      if (extra.length) fail(`ให้สิทธิ์ที่คุณเองไม่มีไม่ได้: ${extra.join(', ')}`)
    }

    const admin = createAdminClient()
    // ไม่ใส่ role/permissions ใน user_metadata (ผู้ใช้แก้ metadata ตัวเองได้) — กำหนดผ่าน user_profiles อย่างเดียว
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: toAuthPassword(password),
      email_confirm: true, // อีเมล @newcute.com ไม่มีกล่องจดหมายจริง — ยืนยันให้เลย ใช้ได้ทันที
      user_metadata: { full_name: fullName },
    })
    if (error) return { error: authErrorThai(error) }
    const newUser = data.user
    if (!newUser) return { error: 'สร้างผู้ใช้ไม่สำเร็จ กรุณาลองใหม่' }

    // เขียนโปรไฟล์ทับค่าที่ trigger ใส่ไว้ (role/permissions ต้องเป็นค่าที่ตรวจแล้วเท่านั้น)
    const { error: profileError } = await admin
      .from('user_profiles')
      .upsert(
        { id: newUser.id, email, full_name: fullName || null, role, permissions },
        { onConflict: 'id' }
      )
    if (profileError) {
      // กันบัญชีค้างครึ่งๆ กลางๆ: ลบ auth user ที่เพิ่งสร้างทิ้ง
      const { error: rollbackError } = await admin.auth.admin.deleteUser(newUser.id)
      const detail = thaiError(profileError)
      if (rollbackError) {
        return { error: `สร้างผู้ใช้ไม่สำเร็จ (${detail}) และลบบัญชีที่สร้างค้างไว้ไม่ได้ — กรุณาลบบัญชี ${email} ที่ Supabase → Authentication → Users เอง` }
      }
      return { error: `สร้างผู้ใช้ไม่สำเร็จ: ${detail}` }
    }

    revalidatePath('/users')
    return { success: true }
  } catch (e: unknown) {
    return toResultError(e)
  }
}

// =========================================
// แก้ไขผู้ใช้
// =========================================
export async function updateUserAction(input: {
  id: string
  login?: string // ชื่อผู้ใช้ หรืออีเมลเต็ม (ไม่ส่ง = ไม่เปลี่ยน)
  fullName: string
  role: 'admin' | 'staff'
  permissions: Permissions
  password?: string
}): Promise<ActionResult> {
  try {
    const caller = await loadCaller()
    const src = asRecord(input)
    const id = parseId(src.id)
    const fullName = parseFullName(src.fullName)
    const requestedRole = parseRole(src.role)
    const rawLogin = String(src.login ?? '').trim()
    const email = rawLogin ? parseLogin(rawLogin) : null
    const rawPassword = typeof src.password === 'string' ? src.password : ''
    const password = rawPassword ? parsePassword(rawPassword) : null

    const admin = createAdminClient()
    const target = await loadTarget(admin, id)
    const isSelf = target.id === caller.id

    // ---- คำนวณบทบาท/สิทธิ์ที่จะบันทึก (null = ไม่แตะของเดิม) ----
    let rolePerms: { role: Role; permissions: Permissions } | null = {
      role: requestedRole,
      permissions: requestedRole === 'admin' ? { ...ADMIN_PERMISSIONS } : coercePermissions(src.permissions),
    }

    if (caller.role !== 'admin') {
      if (target.role === 'admin') fail('เฉพาะ Admin เท่านั้นที่แก้ไขบัญชี Admin ได้')
      if (isSelf) {
        // แก้ตัวเองได้แค่ชื่อ/ชื่อผู้ใช้/รหัสผ่าน — บทบาทและสิทธิ์คงเดิม (ไม่เขียนทับ)
        if (requestedRole !== target.role) fail('คุณเปลี่ยนบทบาทของตัวเองไม่ได้')
        rolePerms = null
      } else {
        // บัญชีที่มีสิทธิ์ "จัดการผู้ใช้" หรือมีสิทธิ์ที่ผู้เรียกไม่มี → แตะไม่ได้เลย (รวมถึงชื่อผู้ใช้/รหัสผ่าน)
        if (!withinCallerPerms(target, caller)) {
          fail('แก้ไขได้เฉพาะผู้ใช้ที่มีสิทธิ์ไม่เกินของคุณ และไม่มีสิทธิ์ "จัดการผู้ใช้"')
        }
        if (requestedRole === 'admin') fail('เฉพาะ Admin เท่านั้นที่ตั้งผู้ใช้เป็น Admin ได้')
        if (rolePerms.permissions.users) fail('เฉพาะ Admin เท่านั้นที่ให้สิทธิ์ "จัดการผู้ใช้" ได้')
        const extra = extraPerms(rolePerms.permissions, caller.permissions)
        if (extra.length) fail(`ให้สิทธิ์ที่คุณเองไม่มีไม่ได้: ${extra.join(', ')}`)
      }
    }

    // ห้ามลด admin คนสุดท้ายลงเป็น staff
    if (rolePerms && target.role === 'admin' && rolePerms.role !== 'admin') {
      await ensureNotLastAdmin(admin, 'เปลี่ยนบทบาทของ')
    }

    // ---- อัพเดตชื่อผู้ใช้ (อีเมล)/รหัสผ่านใน Auth ----
    const emailChanged = !!email && email !== (target.email ?? '').toLowerCase()
    const authPayload: { email?: string; password?: string; email_confirm?: boolean } = {}
    if (emailChanged && email) {
      authPayload.email = email
      authPayload.email_confirm = true // เปลี่ยนโดยผู้ดูแล ไม่ต้องรอยืนยันทางอีเมล
    }
    if (password) authPayload.password = toAuthPassword(password)
    if (authPayload.email || authPayload.password) {
      const { error } = await admin.auth.admin.updateUserById(target.id, authPayload)
      if (error) return { error: authErrorThai(error) }
    }

    // ---- อัพเดตโปรไฟล์ ----
    const profilePatch: Record<string, unknown> = { full_name: fullName || null }
    if (emailChanged && email) profilePatch.email = email
    if (rolePerms) {
      profilePatch.role = rolePerms.role
      profilePatch.permissions = rolePerms.permissions
    }
    const { error: profileError } = await admin
      .from('user_profiles')
      .update(profilePatch)
      .eq('id', target.id)
    if (profileError) {
      const prefix = authPayload.email || authPayload.password
        ? 'เปลี่ยนชื่อผู้ใช้/รหัสผ่านแล้ว แต่บันทึกข้อมูลโปรไฟล์ไม่สำเร็จ: '
        : 'บันทึกไม่สำเร็จ: '
      return { error: prefix + thaiError(profileError) }
    }

    revalidatePath('/users')
    return { success: true }
  } catch (e: unknown) {
    return toResultError(e)
  }
}

// =========================================
// ลบผู้ใช้
// =========================================
export async function deleteUserAction(id: string): Promise<ActionResult> {
  try {
    const caller = await loadCaller()
    const targetId = parseId(id)
    if (targetId === caller.id) fail('ไม่สามารถลบบัญชีตัวเองได้')

    const admin = createAdminClient()
    const target = await loadTarget(admin, targetId)

    if (caller.role !== 'admin') {
      if (target.role === 'admin') fail('เฉพาะ Admin เท่านั้นที่ลบบัญชี Admin ได้')
      if (!withinCallerPerms(target, caller)) {
        fail('ลบได้เฉพาะผู้ใช้ที่มีสิทธิ์ไม่เกินของคุณ และไม่มีสิทธิ์ "จัดการผู้ใช้"')
      }
    }
    if (target.role === 'admin') await ensureNotLastAdmin(admin, 'ลบ')

    const { error } = await admin.auth.admin.deleteUser(target.id)
    if (error) {
      if (/database error/i.test(error.message ?? '')) {
        // Admin: trigger keep_last_admin ไม่ยอม (มีคนลด/ลบ Admin อีกคนไปพร้อมกัน)
        if (target.role === 'admin') {
          return { error: 'ต้องมี Admin อย่างน้อย 1 คน — ลบ Admin คนนี้ไม่ได้ (โหลดหน้าใหม่แล้วตรวจรายชื่อ Admin อีกครั้ง)' }
        }
        // sales / stock_movements.created_by อ้างถึงผู้ใช้นี้อยู่ (ยังไม่ได้รัน supabase-fix-01.sql) → Auth ลบไม่ได้
        return {
          error: 'ลบผู้ใช้นี้ไม่ได้ เพราะมีประวัติการขายหรือรับ-จ่ายสต๊อกที่ผู้ใช้นี้บันทึกไว้ — ให้ปิดสิทธิ์ทั้งหมดและเปลี่ยนรหัสผ่านแทน',
        }
      }
      return { error: authErrorThai(error) }
    }

    revalidatePath('/users')
    return { success: true }
  } catch (e: unknown) {
    return toResultError(e)
  }
}
