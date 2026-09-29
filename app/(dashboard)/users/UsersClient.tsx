'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  type Permissions,
  type UserProfile,
  DEFAULT_PERMISSIONS,
  ADMIN_PERMISSIONS,
  NO_PERMISSIONS,
  PERMISSION_LABELS,
} from '@/types'
import { formatThaiDateTime, thaiError } from '@/lib/format'
import { checkRawPassword, displayLogin, loginToEmail } from '@/lib/auth/credentials'
import { createUserAction, updateUserAction, deleteUserAction } from './actions'

type Role = 'admin' | 'staff'

type UserForm = {
  id?: string
  login: string // ชื่อผู้ใช้ (หรืออีเมลเต็ม) ตามที่พิมพ์ — server แปลงเป็นอีเมลเอง
  password: string
  fullName: string
  role: Role
  permissions: Permissions
}

type Msg = { ok: boolean; text: string }

const PERM_KEYS = Object.keys(PERMISSION_LABELS) as (keyof Permissions)[]

// สิทธิ์ที่บันทึกไว้จริง (fail-closed: ไม่ใช่ true = ไม่มีสิทธิ์)
function storedPermissions(u: UserProfile): Permissions {
  const src = (u.permissions ?? {}) as Partial<Record<keyof Permissions, unknown>>
  const out: Permissions = { ...NO_PERMISSIONS }
  for (const key of PERM_KEYS) out[key] = src[key] === true
  return out
}

// ผู้ใช้ที่ไม่ใช่ admin ให้ได้เฉพาะสิทธิ์ที่ตัวเองมี และให้ "จัดการผู้ใช้" ไม่ได้ (server บังคับเหมือนกัน)
function grantable(callerIsAdmin: boolean, callerPerms: Permissions, key: keyof Permissions): boolean {
  return callerIsAdmin || (key !== 'users' && callerPerms[key])
}

function newForm(callerIsAdmin: boolean, callerPerms: Permissions): UserForm {
  const permissions: Permissions = { ...DEFAULT_PERMISSIONS }
  for (const key of PERM_KEYS) permissions[key] = permissions[key] && grantable(callerIsAdmin, callerPerms, key)
  return { login: '', password: '', fullName: '', role: 'staff', permissions }
}

// บัญชีที่ต้องใช้อีเมลเต็มตอน login (อีเมลโดเมนอื่น ไม่ใช่ชื่อผู้ใช้ @newcute.com)
function isExternalEmail(email: string | null | undefined): boolean {
  return displayLogin(email).includes('@')
}

export default function UsersClient({
  users, currentUserId, currentRole = 'staff', currentPermissions = NO_PERMISSIONS
}: { users: UserProfile[]; currentUserId: string; currentRole?: Role; currentPermissions?: Permissions }) {
  const [editing, setEditing] = useState<UserForm | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [pageMsg, setPageMsg] = useState<Msg | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const router = useRouter()

  const callerIsAdmin = currentRole === 'admin'
  const isSelf = !!editing?.id && editing.id === currentUserId
  // ผู้ใช้ที่ไม่ใช่ admin แก้บทบาท/สิทธิ์ของตัวเองไม่ได้ (server ก็บังคับเหมือนกัน)
  const rolePermsLocked = isSelf && !callerIsAdmin
  // เปลี่ยนชื่อผู้ใช้ของบัญชีเดิม → เตือนว่าครั้งหน้าต้องใช้ชื่อใหม่
  const originalEmail = editing?.id ? (users.find(u => u.id === editing.id)?.email ?? '') : ''
  const mappedLogin = editing?.id ? loginToEmail(editing.login) : null
  const loginChanged = !!mappedLogin && 'email' in mappedLogin &&
    mappedLogin.email !== originalEmail.trim().toLowerCase()

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  // กด Esc ปิดหน้าต่าง (ยกเว้นระหว่างบันทึก)
  useEffect(() => {
    if (!editing) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !loading) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, loading])

  // ผู้ใช้ที่ไม่ใช่ admin: แก้ตัวเองได้ (ชื่อ/ชื่อผู้ใช้/รหัสผ่าน) และจัดการได้เฉพาะคนที่สิทธิ์ไม่เกินตัวเอง
  // และไม่มีสิทธิ์ "จัดการผู้ใช้" — กันสร้างบัญชีสิทธิ์สูงกว่า / ตั้งรหัสผ่านใหม่ให้คนที่สิทธิ์สูงกว่าแล้วเข้าแทน
  function canManage(u: UserProfile) {
    if (callerIsAdmin || u.id === currentUserId) return true
    if (u.role === 'admin') return false
    const perms = storedPermissions(u)
    return PERM_KEYS.every(k => !perms[k] || grantable(false, currentPermissions, k))
  }

  function lockedReason(u: UserProfile): string {
    return u.role === 'admin' || storedPermissions(u).users ? '🔒 เฉพาะ Admin' : '🔒 มีสิทธิ์ที่คุณไม่มี'
  }

  function openCreate() {
    setEditing(newForm(callerIsAdmin, currentPermissions))
    setError('')
    setSuccess('')
    setShowPassword(false)
    setPageMsg(null)
  }

  function openEdit(u: UserProfile) {
    const perms = storedPermissions(u)
    setEditing({
      id: u.id,
      login: displayLogin(u.email),
      password: '',
      fullName: u.full_name ?? '',
      role: u.role === 'admin' ? 'admin' : 'staff',
      permissions: u.role === 'admin' ? { ...ADMIN_PERMISSIONS } : perms,
    })
    setError('')
    setSuccess('')
    setShowPassword(false)
    setPageMsg(null)
  }

  function close() {
    // ปิดระหว่างรอหลังบันทึกสำเร็จ → ยังต้องโหลดรายชื่อใหม่
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
      router.refresh()
    }
    setEditing(null)
    setError('')
    setSuccess('')
  }

  // ตรวจแบบเดียวกับ server (server ตรวจซ้ำอีกชั้นเสมอ)
  function validate(f: UserForm): string {
    const login = loginToEmail(f.login)
    if ('error' in login) return login.error
    // แก้ไข + เว้นว่างรหัสผ่าน = ไม่เปลี่ยนรหัส
    if (!f.id || f.password) {
      const invalid = checkRawPassword(f.password)
      if (invalid) return invalid
    }
    if (f.fullName.trim().length > 100) return 'ชื่อยาวเกินไป (สูงสุด 100 ตัวอักษร)'
    return ''
  }

  async function handleSave() {
    if (!editing || loading) return

    const invalid = validate(editing)
    if (invalid) { setError(invalid); return }

    // เตือนถ้าจะปิดสิทธิ์ users ของตัวเอง = ล็อคตัวเองออก
    if (editing.id === currentUserId) {
      const losingAdmin = editing.role !== 'admin' && !editing.permissions.users
      if (losingAdmin) {
        if (!confirm('⚠️ คุณกำลังปิดสิทธิ์จัดการผู้ใช้ของตัวเอง\nหลังบันทึก คุณจะเข้าหน้านี้ไม่ได้อีก\n\nยืนยัน?')) return
      }
    }

    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const result = editing.id
        ? await updateUserAction({
            id: editing.id,
            login: editing.login.trim() || undefined,
            fullName: editing.fullName.trim(),
            role: editing.role,
            permissions: editing.permissions,
            password: editing.password || undefined,
          })
        : await createUserAction({
            login: editing.login.trim(),
            password: editing.password,
            fullName: editing.fullName.trim(),
            role: editing.role,
            permissions: editing.permissions,
          })
      if (result.error) { setError(result.error); setLoading(false); return }
    } catch (err: unknown) {
      setError(thaiError(err))
      setLoading(false)
      return
    }

    const saved = loginToEmail(editing.login)
    const label = 'email' in saved ? displayLogin(saved.email) : editing.login.trim()
    const wasCreate = !editing.id
    setSuccess('✅ บันทึกเรียบร้อย')
    setLoading(false)
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      setEditing(null)
      setSuccess('')
      setPageMsg({ ok: true, text: wasCreate ? `✅ เพิ่มผู้ใช้ ${label} แล้ว` : `✅ บันทึกข้อมูล ${label} แล้ว` })
      router.refresh()
    }, 700)
  }

  async function handleDelete(u: UserProfile) {
    if (deletingId) return
    if (!confirm(`ลบผู้ใช้ ${displayLogin(u.email) || u.full_name || ''}?\n\nผู้ใช้นี้จะเข้าสู่ระบบไม่ได้อีก`)) return
    setDeletingId(u.id)
    setPageMsg(null)
    try {
      const result = await deleteUserAction(u.id)
      if (result.error) {
        setPageMsg({ ok: false, text: result.error })
      } else {
        setPageMsg({ ok: true, text: `🗑 ลบผู้ใช้ ${displayLogin(u.email)} แล้ว` })
        router.refresh()
      }
    } catch (err: unknown) {
      setPageMsg({ ok: false, text: thaiError(err) })
    } finally {
      setDeletingId(null)
    }
  }

  function setRole(role: Role) {
    if (!editing || rolePermsLocked) return
    if (role === 'admin' && !callerIsAdmin) return
    setEditing({
      ...editing,
      role,
      permissions:
        role === 'admin'
          ? { ...ADMIN_PERMISSIONS }
          // ลดจาก admin → staff: เริ่มจากสิทธิ์พื้นฐาน (ไม่มี "จัดการผู้ใช้") แล้วค่อยติ๊กเพิ่ม
          : editing.role === 'admin' ? { ...DEFAULT_PERMISSIONS } : { ...editing.permissions },
    })
  }

  function permDisabled(key: keyof Permissions): boolean {
    if (!editing) return true
    if (rolePermsLocked || editing.role === 'admin') return true
    // ผู้ใช้ที่ไม่ใช่ admin: ให้ได้เฉพาะสิทธิ์ที่ตัวเองมี ("จัดการผู้ใช้" ให้ไม่ได้)
    return !grantable(callerIsAdmin, currentPermissions, key)
  }

  function togglePerm(key: keyof Permissions) {
    if (!editing || permDisabled(key)) return
    setEditing({
      ...editing,
      permissions: { ...editing.permissions, [key]: !editing.permissions[key] },
    })
  }

  function permSummary(u: UserProfile): string {
    if (u.role === 'admin') return 'ทุกสิทธิ์'
    const perms = storedPermissions(u)
    const on = PERM_KEYS.filter(k => perms[k]).map(k => PERMISSION_LABELS[k])
    return on.length ? on.join(', ') : 'ไม่มีสิทธิ์ใช้งาน'
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={openCreate} className="btn-primary flex items-center justify-center gap-2 w-full sm:w-auto min-h-[44px] sm:min-h-0">
          <span>➕</span> เพิ่มผู้ใช้
        </button>
      </div>

      {pageMsg && (
        <div
          role={pageMsg.ok ? 'status' : 'alert'}
          className={`flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-sm ${
            pageMsg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}
        >
          <span>{pageMsg.text}</span>
          <button onClick={() => setPageMsg(null)} className="shrink-0 -my-2 -mr-2 min-h-[40px] min-w-[40px] inline-flex items-center justify-center text-current opacity-60 hover:opacity-100" aria-label="ปิดข้อความ">✕</button>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">ชื่อผู้ใช้</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">ชื่อ</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">สิทธิ์</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">สร้างเมื่อ</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.length === 0 && (
                <tr><td colSpan={5} className="text-center py-10 text-gray-400">ไม่มีผู้ใช้</td></tr>
              )}
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900 break-all">
                    {displayLogin(u.email) || '-'}
                    {u.id === currentUserId && <span className="ml-2 text-xs text-brand-600 whitespace-nowrap">(คุณ)</span>}
                    {/* บัญชีอีเมลโดเมนอื่น: ชื่อที่ใช้ login คืออีเมลเต็ม (บัญชี @newcute.com ไม่ต้องโชว์โดเมน) */}
                    {isExternalEmail(u.email) && (
                      <p className="text-xs font-normal text-gray-400 mt-0.5">ใช้อีเมลเต็มเข้าสู่ระบบ</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.full_name || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
                      u.role === 'admin'
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-gray-100 text-gray-700'
                    }`}>
                      {u.role === 'admin' ? '👑 Admin' : '👤 Staff'}
                    </span>
                    <p className="text-xs text-gray-400 mt-1 max-w-[220px]">{permSummary(u)}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                    {formatThaiDateTime(u.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {canManage(u) ? (
                      <div className="inline-flex gap-1">
                        <button onClick={() => openEdit(u)}
                          className="min-h-[40px] px-3 rounded-lg text-brand-600 hover:bg-brand-50 text-xs font-medium">
                          แก้ไข
                        </button>
                        {u.id !== currentUserId && (
                          <button onClick={() => handleDelete(u)} disabled={deletingId !== null}
                            className="min-h-[40px] px-3 rounded-lg text-red-500 hover:bg-red-50 text-xs font-medium disabled:opacity-50">
                            {deletingId === u.id ? 'กำลังลบ...' : 'ลบ'}
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">{lockedReason(u)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {editing && (
        <div
          className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 sm:p-4"
          role="dialog" aria-modal="true" aria-labelledby="user-modal-title"
        >
          <div className="bg-white w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-xl">
            {/* Header (ติดด้านบนเวลาเลื่อน) */}
            <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 id="user-modal-title" className="font-bold text-gray-900 text-lg">
                  {editing.id ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้ใหม่'}
                </h3>
                {isSelf && (
                  <p className="text-xs text-brand-600 mt-0.5">📝 คุณกำลังแก้ไขบัญชีตัวเอง</p>
                )}
              </div>
              <button onClick={close} disabled={loading}
                className="shrink-0 w-10 h-10 -mr-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 text-xl"
                aria-label="ปิด">✕</button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              <div>
                <label htmlFor="user-login" className="block text-sm font-medium text-gray-700 mb-1">ชื่อผู้ใช้ *</label>
                <input id="user-login" className="input" type="text" maxLength={254}
                  autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  placeholder="เช่น max" aria-describedby="user-login-hint"
                  value={editing.login}
                  onChange={e => setEditing({ ...editing, login: e.target.value })} />
                <p id="user-login-hint" className="text-xs text-gray-400 mt-1">a-z, 0-9, จุด, ขีด — หรือใส่อีเมลก็ได้</p>
                {loginChanged && (
                  <p className="text-xs text-amber-600 mt-1">⚠️ เปลี่ยนชื่อผู้ใช้แล้ว ครั้งหน้าต้อง login ด้วยชื่อใหม่</p>
                )}
              </div>
              <div>
                <label htmlFor="user-name" className="block text-sm font-medium text-gray-700 mb-1">ชื่อ-นามสกุล</label>
                <input id="user-name" className="input" maxLength={100} autoComplete="off"
                  value={editing.fullName}
                  onChange={e => setEditing({ ...editing, fullName: e.target.value })} />
              </div>
              <div>
                <label htmlFor="user-password" className="block text-sm font-medium text-gray-700 mb-1">
                  รหัสผ่าน {!editing.id && <span>*</span>}
                </label>
                <div className="relative">
                  <input id="user-password" className="input pr-16"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    placeholder={editing.id ? 'เว้นว่างถ้าไม่เปลี่ยน' : 'ตั้งรหัสผ่าน'}
                    value={editing.password}
                    onChange={e => setEditing({ ...editing, password: e.target.value })} />
                  <button type="button" onClick={() => setShowPassword(s => !s)}
                    className="absolute inset-y-0 right-0 px-3 min-w-[44px] text-xs font-medium text-gray-500 hover:text-gray-700"
                    aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}>
                    {showPassword ? 'ซ่อน' : 'แสดง'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">บทบาท</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setRole('staff')} disabled={rolePermsLocked}
                    className={`flex-1 min-h-[44px] py-2 rounded-lg text-sm font-medium border disabled:cursor-not-allowed ${
                      editing.role === 'staff'
                        ? 'bg-brand-50 text-brand-700 border-brand-300'
                        : 'bg-white text-gray-600 border-gray-200'
                    }`}>👤 Staff</button>
                  <button type="button" onClick={() => setRole('admin')} disabled={rolePermsLocked || !callerIsAdmin}
                    className={`flex-1 min-h-[44px] py-2 rounded-lg text-sm font-medium border disabled:cursor-not-allowed disabled:opacity-50 ${
                      editing.role === 'admin'
                        ? 'bg-purple-50 text-purple-700 border-purple-300'
                        : 'bg-white text-gray-600 border-gray-200'
                    }`}>👑 Admin</button>
                </div>
                {rolePermsLocked ? (
                  <p className="text-xs text-gray-400 mt-1">🔒 แก้บทบาทและสิทธิ์ของตัวเองไม่ได้ — แก้ได้เฉพาะชื่อ ชื่อผู้ใช้ และรหัสผ่าน</p>
                ) : !callerIsAdmin ? (
                  <p className="text-xs text-gray-400 mt-1">เฉพาะ Admin เท่านั้นที่ตั้งผู้ใช้เป็น Admin ได้</p>
                ) : null}
              </div>

              <div className="border-t border-gray-100 pt-3">
                <label className="block text-sm font-medium text-gray-700 mb-2">สิทธิ์การใช้งาน</label>
                {editing.role === 'admin' && (
                  <p className="text-xs text-purple-600 mb-2">👑 Admin ได้ทุกสิทธิ์โดยอัตโนมัติ</p>
                )}
                <div className="space-y-2">
                  {PERM_KEYS.map(key => {
                    const disabled = permDisabled(key)
                    return (
                      <label key={key}
                        className={`flex items-center justify-between gap-3 bg-gray-50 rounded-lg px-3 min-h-[44px] ${
                          disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                        }`}>
                        <span className="text-sm text-gray-700">
                          {PERMISSION_LABELS[key]}
                          {!callerIsAdmin && !rolePermsLocked && editing.role !== 'admin' && disabled && (
                            <span className="text-xs text-gray-400">
                              {key === 'users' ? ' (เฉพาะ Admin ให้ได้)' : ' (คุณไม่มีสิทธิ์นี้ จึงให้คนอื่นไม่ได้)'}
                            </span>
                          )}
                        </span>
                        <input
                          type="checkbox"
                          checked={editing.permissions[key]}
                          disabled={disabled}
                          onChange={() => togglePerm(key)}
                          className="w-5 h-5 accent-brand-600"
                        />
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Footer (ติดด้านล่างเวลาเลื่อน — ปุ่มบันทึกและข้อความผิดพลาดมองเห็นเสมอ) */}
            <div
              className="sticky bottom-0 z-10 bg-white border-t border-gray-100 px-5 pt-3 space-y-2"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            >
              {error && <p role="alert" className="text-red-600 text-sm bg-red-50 rounded-lg p-2">{error}</p>}
              {success && <p role="status" className="text-green-600 text-sm bg-green-50 rounded-lg p-2 font-medium">{success}</p>}
              <div className="flex gap-2">
                <button onClick={handleSave} disabled={loading || !!success} className="btn-primary flex-1 min-h-[44px]">
                  {loading ? 'กำลังบันทึก...' : success ? '✅ สำเร็จ' : (editing.id ? 'บันทึก' : 'เพิ่มผู้ใช้')}
                </button>
                <button onClick={close} disabled={loading} className="btn-secondary min-h-[44px]">ยกเลิก</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
