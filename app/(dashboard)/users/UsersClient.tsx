'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { th } from 'date-fns/locale'
import {
  type Permissions,
  type UserProfile,
  DEFAULT_PERMISSIONS,
  ADMIN_PERMISSIONS,
  PERMISSION_LABELS,
} from '@/types'
import { createUserAction, updateUserAction, deleteUserAction } from './actions'

type UserForm = {
  id?: string
  email: string
  password: string
  fullName: string
  role: 'admin' | 'staff'
  permissions: Permissions
}

const EMPTY: UserForm = {
  email: '',
  password: '',
  fullName: '',
  role: 'staff',
  permissions: { ...DEFAULT_PERMISSIONS },
}

export default function UsersClient({
  users, currentUserId
}: { users: UserProfile[]; currentUserId: string }) {
  const [editing, setEditing] = useState<UserForm | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const router = useRouter()
  const isSelf = editing?.id === currentUserId

  function openCreate() {
    setEditing({ ...EMPTY, permissions: { ...DEFAULT_PERMISSIONS } })
    setError('')
  }

  function openEdit(u: UserProfile) {
    setEditing({
      id: u.id,
      email: u.email ?? '',
      password: '',
      fullName: u.full_name ?? '',
      role: u.role,
      permissions: { ...DEFAULT_PERMISSIONS, ...(u.permissions ?? {}) },
    })
    setError('')
  }

  function close() { setEditing(null); setError('') }

  async function handleSave() {
    if (!editing) return

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
    const result = editing.id
      ? await updateUserAction({
          id: editing.id,
          email: editing.email || undefined,
          fullName: editing.fullName,
          role: editing.role,
          permissions: editing.permissions,
          password: editing.password || undefined,
        })
      : await createUserAction({
          email: editing.email,
          password: editing.password,
          fullName: editing.fullName,
          role: editing.role,
          permissions: editing.permissions,
        })
    if (result.error) { setError(result.error); setLoading(false); return }
    setSuccess('✅ บันทึกเรียบร้อย')
    setLoading(false)
    setTimeout(() => {
      setEditing(null)
      setSuccess('')
      router.refresh()
    }, 700)
  }

  async function handleDelete(u: UserProfile) {
    if (!confirm(`ลบผู้ใช้ ${u.email}?`)) return
    const result = await deleteUserAction(u.id)
    if (result.error) { alert(result.error); return }
    router.refresh()
  }

  function setRole(role: 'admin' | 'staff') {
    if (!editing) return
    setEditing({
      ...editing,
      role,
      permissions: role === 'admin' ? { ...ADMIN_PERMISSIONS } : { ...editing.permissions },
    })
  }

  function togglePerm(key: keyof Permissions) {
    if (!editing) return
    setEditing({
      ...editing,
      permissions: { ...editing.permissions, [key]: !editing.permissions[key] },
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <span>➕</span> เพิ่มผู้ใช้
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">อีเมล</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">ชื่อ</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">สิทธิ์</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">สร้างเมื่อ</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {users.length === 0 && (
              <tr><td colSpan={5} className="text-center py-10 text-gray-400">ไม่มีผู้ใช้</td></tr>
            )}
            {users.map(u => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {u.email}
                  {u.id === currentUserId && <span className="ml-2 text-xs text-brand-600">(คุณ)</span>}
                </td>
                <td className="px-4 py-3 text-gray-600">{u.full_name || '-'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    u.role === 'admin'
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-gray-100 text-gray-700'
                  }`}>
                    {u.role === 'admin' ? '👑 Admin' : '👤 Staff'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">
                  {format(new Date(u.created_at), 'dd MMM yy', { locale: th })}
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button onClick={() => openEdit(u)}
                    className="text-brand-600 hover:underline text-xs font-medium">แก้ไข</button>
                  {u.id !== currentUserId && (
                    <button onClick={() => handleDelete(u)}
                      className="text-red-500 hover:underline text-xs font-medium">ลบ</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900 text-lg">
                  {editing.id ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้ใหม่'}
                </h3>
                {isSelf && (
                  <p className="text-xs text-brand-600 mt-0.5">📝 คุณกำลังแก้ไขบัญชีตัวเอง</p>
                )}
              </div>
              <button onClick={close} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">อีเมล *</label>
                <input className="input" type="email" value={editing.email}
                  onChange={e => setEditing({ ...editing, email: e.target.value })} />
                {editing.id && (
                  <p className="text-xs text-gray-400 mt-1">⚠️ เปลี่ยนอีเมลแล้วจะใช้อีเมลใหม่ในการ login</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อ-นามสกุล</label>
                <input className="input" value={editing.fullName}
                  onChange={e => setEditing({ ...editing, fullName: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  รหัสผ่าน {editing.id && <span className="text-gray-400 text-xs">(เว้นว่างถ้าไม่เปลี่ยน)</span>}
                </label>
                <input className="input" type="password" placeholder="อย่างน้อย 6 ตัว"
                  value={editing.password}
                  onChange={e => setEditing({ ...editing, password: e.target.value })} />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">บทบาท</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setRole('staff')}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                      editing.role === 'staff'
                        ? 'bg-brand-50 text-brand-700 border-brand-300'
                        : 'bg-white text-gray-600 border-gray-200'
                    }`}>👤 Staff</button>
                  <button type="button" onClick={() => setRole('admin')}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                      editing.role === 'admin'
                        ? 'bg-purple-50 text-purple-700 border-purple-300'
                        : 'bg-white text-gray-600 border-gray-200'
                    }`}>👑 Admin</button>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-3">
                <label className="block text-sm font-medium text-gray-700 mb-2">สิทธิ์การใช้งาน</label>
                <div className="space-y-2">
                  {(Object.keys(PERMISSION_LABELS) as (keyof Permissions)[]).map(key => (
                    <label key={key} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                      <span className="text-sm text-gray-700">{PERMISSION_LABELS[key]}</span>
                      <input
                        type="checkbox"
                        checked={editing.permissions[key]}
                        onChange={() => togglePerm(key)}
                        className="w-5 h-5 accent-brand-600"
                      />
                    </label>
                  ))}
                </div>
              </div>

              {error && <p className="text-red-500 text-sm bg-red-50 rounded-lg p-2">{error}</p>}
              {success && <p className="text-green-600 text-sm bg-green-50 rounded-lg p-2 font-medium">{success}</p>}

              <div className="flex gap-2 pt-3 border-t border-gray-100 sticky bottom-0 bg-white">
                <button onClick={handleSave} disabled={loading || !!success} className="btn-primary flex-1">
                  {loading ? 'กำลังบันทึก...' : success ? '✅ สำเร็จ' : (editing.id ? 'บันทึก' : 'เพิ่มผู้ใช้')}
                </button>
                <button onClick={close} className="btn-secondary">ยกเลิก</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
