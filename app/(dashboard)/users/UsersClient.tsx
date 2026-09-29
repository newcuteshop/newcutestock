'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, CheckCircle2, Crown, Eye, EyeOff, Loader2, Lock, Pencil, PencilLine, Save, Trash2,
  UserPlus, UserRound, Users, X, XCircle,
} from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
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

// header = หัวข้อหน้า (แสดงแถวเดียวกับปุ่ม "เพิ่มผู้ใช้" บนคอม), children = ข้อความแจ้งเตือนใต้หัวข้อ
export default function UsersClient({
  users, currentUserId, currentRole = 'staff', currentPermissions = NO_PERMISSIONS, header, children,
}: {
  users: UserProfile[]; currentUserId: string; currentRole?: Role; currentPermissions?: Permissions
  header?: ReactNode; children?: ReactNode
}) {
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
    return u.role === 'admin' || storedPermissions(u).users ? 'เฉพาะ Admin' : 'มีสิทธิ์ที่คุณไม่มี'
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
        if (!confirm('คุณกำลังปิดสิทธิ์จัดการผู้ใช้ของตัวเอง\nหลังบันทึก คุณจะเข้าหน้านี้ไม่ได้อีก\n\nยืนยัน?')) return
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
    setSuccess('บันทึกเรียบร้อย')
    setLoading(false)
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      setEditing(null)
      setSuccess('')
      setPageMsg({ ok: true, text: wasCreate ? `เพิ่มผู้ใช้ ${label} แล้ว` : `บันทึกข้อมูล ${label} แล้ว` })
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
        setPageMsg({ ok: true, text: `ลบผู้ใช้ ${displayLogin(u.email)} แล้ว` })
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
    <div className="space-y-4 sm:space-y-6">
      {/* หัวข้อ + ปุ่มเพิ่มผู้ใช้: คอมอยู่แถวเดียวกัน (คำเตือนอยู่แถวถัดไป)
          มือถือเรียงเหมือนเดิม: หัวข้อ → คำเตือน → ปุ่ม ห่างกัน 24px */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:gap-4">
        {header && <div className="order-1 min-w-0">{header}</div>}
        {children && <div className="order-2 sm:order-3 sm:col-span-2">{children}</div>}
        <button onClick={openCreate} className="order-3 sm:order-2 sm:justify-self-end btn-primary w-full sm:w-auto">
          <UserPlus {...ICON_SM} />
          เพิ่มผู้ใช้
        </button>
      </div>

      {pageMsg && (
        <div
          role={pageMsg.ok ? 'status' : 'alert'}
          className={pageMsg.ok ? 'alert-ok' : 'alert-err'}
        >
          {pageMsg.ok ? <CheckCircle2 {...ICON_SM} /> : <XCircle {...ICON_SM} />}
          <span className="flex-1 min-w-0 break-words">{pageMsg.text}</span>
          <button onClick={() => setPageMsg(null)} className="btn-icon btn-icon-plain -my-2 -mr-2 text-current" aria-label="ปิดข้อความ">
            <X {...ICON_SM} />
          </button>
        </div>
      )}

      {/* มือถือ / iPad แนวตั้ง (ต่ำกว่า lg): การ์ดรายคน — ปุ่มแก้ไข/ลบเห็นทันที ไม่ต้องเลื่อนตารางไปทางขวา */}
      <div className="lg:hidden">
        {users.length === 0 ? (
          <div className="card empty-state">
            <span className="icon-bubble icon-bubble-lg">
              <Users size={30} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <p className="empty-state-title">ไม่มีผู้ใช้</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {users.map(u => (
              <li key={u.id} className="card p-4 flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 break-all">
                      {displayLogin(u.email) || '-'}
                      {u.id === currentUserId && <span className="ml-2 text-xs font-semibold text-brand-700 whitespace-nowrap">(คุณ)</span>}
                    </p>
                    {isExternalEmail(u.email) && (
                      <p className="text-xs text-gray-500 mt-0.5">ใช้อีเมลเต็มเข้าสู่ระบบ</p>
                    )}
                    <p className="text-sm text-gray-700 mt-0.5 break-words">{u.full_name || '-'}</p>
                  </div>
                  {u.role === 'admin' ? (
                    <span className="chip shrink-0">
                      <Crown size={14} strokeWidth={2} aria-hidden="true" />
                      Admin
                    </span>
                  ) : (
                    <span className="chip chip-outline shrink-0">
                      <UserRound size={14} strokeWidth={2} aria-hidden="true" />
                      Staff
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-600 mt-2">{permSummary(u)}</p>
                <p className="text-xs text-gray-500 mt-1 tabular-nums">สร้างเมื่อ {formatThaiDateTime(u.created_at)}</p>
                {/* ปุ่มชิดล่างการ์ด (การ์ดสองคอลัมน์สูงไม่เท่ากันก็ยังตรงแนว) */}
                <div className="mt-auto pt-3">
                  <div className="flex gap-2 pt-3 border-t border-brand-100">
                    {canManage(u) ? (
                      <>
                        <button onClick={() => openEdit(u)} className="btn-secondary flex-1 min-w-0 px-3 text-sm">
                          <Pencil {...ICON_SM} />
                          แก้ไข
                        </button>
                        {u.id !== currentUserId && (
                          <button onClick={() => handleDelete(u)} disabled={deletingId !== null}
                            className="btn-danger-soft flex-1 min-w-0 px-3 text-sm">
                            {deletingId === u.id
                              ? <Loader2 {...ICON_SM} className="animate-spin" />
                              : <Trash2 {...ICON_SM} />}
                            {deletingId === u.id ? 'กำลังลบ...' : 'ลบ'}
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 min-h-[44px] text-xs text-gray-500">
                        <Lock {...ICON_SM} />
                        {lockedReason(u)}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* คอม / iPad แนวนอน (lg+): ตาราง */}
      <div className="card overflow-hidden hidden lg:block">
        <div className="table-wrap">
          <table className="table-soft min-w-[640px]">
            <thead>
              <tr>
                <th className="px-4 xl:px-6">ชื่อผู้ใช้</th>
                <th className="px-4 xl:px-6">ชื่อ</th>
                <th className="px-4 xl:px-6">สิทธิ์</th>
                <th className="px-4 xl:px-6">สร้างเมื่อ</th>
                <th className="px-4 xl:px-6"></th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      <span className="icon-bubble icon-bubble-lg">
                        <Users size={30} strokeWidth={1.8} aria-hidden="true" />
                      </span>
                      <p className="empty-state-title">ไม่มีผู้ใช้</p>
                    </div>
                  </td>
                </tr>
              )}
              {users.map(u => (
                <tr key={u.id}>
                  <td className="px-4 xl:px-6 font-semibold text-gray-900 break-all">
                    {displayLogin(u.email) || '-'}
                    {u.id === currentUserId && <span className="ml-2 text-xs font-semibold text-brand-700 whitespace-nowrap">(คุณ)</span>}
                    {/* บัญชีอีเมลโดเมนอื่น: ชื่อที่ใช้ login คืออีเมลเต็ม (บัญชี @newcute.com ไม่ต้องโชว์โดเมน) */}
                    {isExternalEmail(u.email) && (
                      <p className="text-xs font-normal text-gray-500 mt-0.5">ใช้อีเมลเต็มเข้าสู่ระบบ</p>
                    )}
                  </td>
                  <td className="px-4 xl:px-6 text-gray-700">{u.full_name || '-'}</td>
                  <td className="px-4 xl:px-6">
                    {/* Admin = ชิปบลัช + มงกุฎ / Staff = ชิปขอบ + รูปคน */}
                    {u.role === 'admin' ? (
                      <span className="chip">
                        <Crown size={14} strokeWidth={2} aria-hidden="true" />
                        Admin
                      </span>
                    ) : (
                      <span className="chip chip-outline">
                        <UserRound size={14} strokeWidth={2} aria-hidden="true" />
                        Staff
                      </span>
                    )}
                    <p className="text-xs text-gray-500 mt-1.5 max-w-[220px] xl:max-w-md">{permSummary(u)}</p>
                  </td>
                  <td className="px-4 xl:px-6 text-xs text-gray-500 whitespace-nowrap tabular-nums">
                    {formatThaiDateTime(u.created_at)}
                  </td>
                  <td className="px-4 xl:px-6 text-right whitespace-nowrap">
                    {canManage(u) ? (
                      <div className="inline-flex items-center gap-2">
                        <button onClick={() => openEdit(u)} className="btn-ghost px-3 text-sm">
                          <Pencil {...ICON_SM} />
                          แก้ไข
                        </button>
                        {u.id !== currentUserId && (
                          <button onClick={() => handleDelete(u)} disabled={deletingId !== null}
                            className="btn-danger-soft px-3 text-sm">
                            {deletingId === u.id
                              ? <Loader2 {...ICON_SM} className="animate-spin" />
                              : <Trash2 {...ICON_SM} />}
                            {deletingId === u.id ? 'กำลังลบ...' : 'ลบ'}
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                        <Lock {...ICON_SM} />
                        {lockedReason(u)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal — มือถือเป็นชีตล่างมุมบนโค้ง / คอมเป็นป็อปอัปกลางจอ */}
      {editing && (
        <div
          className="fixed inset-0 z-50 !mt-0 flex items-end sm:items-center justify-center scrim sm:p-4"
          role="dialog" aria-modal="true" aria-labelledby="user-modal-title"
        >
          <div className="sheet w-full max-w-lg lg:max-w-2xl max-h-[90dvh] overflow-y-auto overscroll-contain rounded-b-none border-b-0 sm:rounded-4xl sm:border-b-2 animate-fade-up">
            {/* Header (ติดด้านบนเวลาเลื่อน) */}
            <div className="sticky top-0 z-10 bg-white border-b border-blush-hair px-5 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="icon-bubble icon-bubble-strong">
                  {editing.id ? <Pencil {...ICON} /> : <UserPlus {...ICON} />}
                </span>
                <div className="min-w-0">
                  <h3 id="user-modal-title" className="font-bold text-gray-900 text-lg leading-snug">
                    {editing.id ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้ใหม่'}
                  </h3>
                  {isSelf && (
                    <p className="flex items-center gap-1.5 text-xs font-medium text-brand-700 mt-0.5">
                      <PencilLine {...ICON_SM} />
                      <span className="min-w-0">คุณกำลังแก้ไขบัญชีตัวเอง</span>
                    </p>
                  )}
                </div>
              </div>
              <button onClick={close} disabled={loading}
                className="btn-icon btn-icon-plain -mr-2"
                aria-label="ปิด"><X {...ICON} /></button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-4">
              {/* คอม (lg+): ช่องกรอกวาง 2 คอลัมน์ / มือถือ: เรียงลงมา */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-x-4">
                <div>
                  <label htmlFor="user-login" className="block text-sm font-medium text-gray-700 mb-1">ชื่อผู้ใช้ *</label>
                  <input id="user-login" className="input" type="text" maxLength={254}
                    autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    placeholder="เช่น max" aria-describedby="user-login-hint"
                    value={editing.login}
                    onChange={e => setEditing({ ...editing, login: e.target.value })} />
                  <p id="user-login-hint" className="text-xs text-gray-500 mt-1">a-z, 0-9, จุด, ขีด — หรือใส่อีเมลก็ได้</p>
                  {loginChanged && (
                    <p className="flex items-start gap-1.5 text-xs font-medium text-amber-700 mt-1">
                      <AlertTriangle {...ICON_SM} />
                      <span className="min-w-0">เปลี่ยนชื่อผู้ใช้แล้ว ครั้งหน้าต้อง login ด้วยชื่อใหม่</span>
                    </p>
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
                    <input id="user-password" className="input pr-20"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                      placeholder={editing.id ? 'เว้นว่างถ้าไม่เปลี่ยน' : 'ตั้งรหัสผ่าน'}
                      value={editing.password}
                      onChange={e => setEditing({ ...editing, password: e.target.value })} />
                    <button type="button" onClick={() => setShowPassword(s => !s)}
                      className="absolute inset-y-0 right-0 inline-flex items-center gap-1 rounded-full px-3 min-w-[44px] text-xs font-semibold text-brand-700 [@media(hover:hover)]:hover:text-brand-900 active:opacity-70"
                      aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}>
                      {showPassword ? <EyeOff {...ICON_SM} /> : <Eye {...ICON_SM} />}
                      {showPassword ? 'ซ่อน' : 'แสดง'}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">บทบาท</label>
                  {/* ตัวเลือกบทบาท: ที่เลือกอยู่ = แคปซูลสตรอว์เบอร์รี (ถ้ากดไม่ได้ก็ยังเห็นชัดว่าเป็นบทบาทไหน) */}
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setRole('staff')} disabled={rolePermsLocked}
                      aria-pressed={editing.role === 'staff'}
                      className="choice aria-pressed:disabled:opacity-100">
                      <UserRound {...ICON} />
                      Staff
                    </button>
                    <button type="button" onClick={() => setRole('admin')} disabled={rolePermsLocked || !callerIsAdmin}
                      aria-pressed={editing.role === 'admin'}
                      className="choice aria-pressed:disabled:opacity-100">
                      <Crown {...ICON} />
                      Admin
                    </button>
                  </div>
                  {rolePermsLocked ? (
                    <p className="flex items-start gap-1.5 text-xs text-gray-500 mt-1.5">
                      <Lock {...ICON_SM} />
                      <span className="min-w-0">แก้บทบาทและสิทธิ์ของตัวเองไม่ได้ — แก้ได้เฉพาะชื่อ ชื่อผู้ใช้ และรหัสผ่าน</span>
                    </p>
                  ) : !callerIsAdmin ? (
                    <p className="text-xs text-gray-500 mt-1.5">เฉพาะ Admin เท่านั้นที่ตั้งผู้ใช้เป็น Admin ได้</p>
                  ) : null}
                </div>
              </div>

              <div className="space-y-3">
                <div className="wave-divider decor" aria-hidden="true" />
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">สิทธิ์การใช้งาน</label>
                  {editing.role === 'admin' && (
                    <p className="flex items-center gap-1.5 text-xs font-medium text-brand-700 mb-2">
                      <Crown {...ICON_SM} />
                      <span className="min-w-0">Admin ได้ทุกสิทธิ์โดยอัตโนมัติ</span>
                    </p>
                  )}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    {PERM_KEYS.map(key => {
                      const disabled = permDisabled(key)
                      return (
                        <label key={key}
                          className={`panel flex items-center justify-between gap-3 px-4 py-2 min-h-[52px] ${
                            disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                          }`}>
                          <span className="min-w-0 text-sm font-medium text-gray-700">
                            {PERMISSION_LABELS[key]}
                            {!callerIsAdmin && !rolePermsLocked && editing.role !== 'admin' && disabled && (
                              <span className="block text-xs font-normal text-gray-500">
                                {key === 'users' ? ' (เฉพาะ Admin ให้ได้)' : ' (คุณไม่มีสิทธิ์นี้ จึงให้คนอื่นไม่ได้)'}
                              </span>
                            )}
                          </span>
                          {/* สวิตช์เปิด/ปิด: ตัวจริงยังเป็น checkbox (โปรแกรมอ่านจอ/คีย์บอร์ดใช้ได้เหมือนเดิม) ลายสวิตช์เป็นแค่หน้าตา */}
                          <span className="relative inline-flex shrink-0">
                            <input
                              type="checkbox"
                              checked={editing.permissions[key]}
                              disabled={disabled}
                              onChange={() => togglePerm(key)}
                              className="peer sr-only"
                            />
                            <span aria-hidden="true"
                              className="block h-7 w-12 rounded-full border-2 border-blush-line bg-blush transition-colors peer-checked:border-brand-600 peer-checked:bg-brand-600 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-berry" />
                            <span aria-hidden="true"
                              className="pointer-events-none absolute left-1 top-1 h-5 w-5 rounded-full border border-blush-deep bg-white shadow-sm transition-transform peer-checked:translate-x-5 peer-checked:border-white" />
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer (ติดด้านล่างเวลาเลื่อน — ปุ่มบันทึกและข้อความผิดพลาดมองเห็นเสมอ) */}
            <div
              className="sticky bottom-0 z-10 bg-white border-t border-blush-hair px-5 pt-3 space-y-2"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            >
              {error && (
                <p role="alert" className="alert-err">
                  <XCircle {...ICON_SM} />
                  <span className="min-w-0 break-words">{error}</span>
                </p>
              )}
              {success && (
                <p role="status" className="alert-ok font-medium">
                  <CheckCircle2 {...ICON_SM} />
                  <span className="min-w-0">{success}</span>
                </p>
              )}
              <div className="flex gap-2">
                <button onClick={handleSave} disabled={loading || !!success} className="btn-primary flex-1">
                  {loading
                    ? <Loader2 {...ICON_SM} className="animate-spin" />
                    : success
                      ? <CheckCircle2 {...ICON_SM} />
                      : editing.id ? <Save {...ICON_SM} /> : <UserPlus {...ICON_SM} />}
                  {loading ? 'กำลังบันทึก...' : success ? 'สำเร็จ' : (editing.id ? 'บันทึก' : 'เพิ่มผู้ใช้')}
                </button>
                <button onClick={close} disabled={loading} className="btn-secondary">ยกเลิก</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
