'use client'
import { useState } from 'react'
import { loginAction } from './actions'
import { thaiError } from '@/lib/format'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading) return

    // อ่านค่าจากฟอร์มตรงๆ ด้วย — กันกรณีเบราว์เซอร์ autofill แล้วไม่ยิง onChange
    const fd = new FormData(e.currentTarget)
    const em = (String(fd.get('email') ?? '') || email).trim()
    const pw = String(fd.get('password') ?? '') || password
    if (!em || !pw) {
      setError('กรุณากรอกอีเมลและรหัสผ่าน')
      return
    }

    setLoading(true)
    setError('')
    try {
      const result = await loginAction(em, pw)
      if (result?.error) {
        setError(result.error)
        setLoading(false)
      } else {
        // โหลดหน้าใหม่ทั้งหน้า เพื่อให้ cookie session ใหม่ถูกใช้ทันที
        window.location.href = '/dashboard'
      }
    } catch (err: unknown) {
      // เรียก server action ไม่ได้ (เน็ตหลุด ฯลฯ)
      setError(thaiError(err))
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen min-h-[100dvh] bg-gradient-to-br from-brand-50 to-brand-100 flex items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6 sm:p-8">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-brand-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-2xl">👕</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Stock App</h1>
          <p className="text-gray-500 text-sm mt-1">ระบบสต๊อกสินค้าเสื้อผ้า</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4" noValidate>
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1">อีเมล</label>
            <input
              id="login-email" name="email"
              type="email" inputMode="email" autoComplete="username"
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              value={email} onChange={e => { setEmail(e.target.value); setError('') }}
              className="input" placeholder="your@email.com" required
            />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1">รหัสผ่าน</label>
            <div className="relative">
              <input
                id="login-password" name="password"
                type={showPassword ? 'text' : 'password'} autoComplete="current-password"
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={password} onChange={e => { setPassword(e.target.value); setError('') }}
                className="input pr-16" placeholder="••••••••" required
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                className="absolute inset-y-0 right-0 px-3 min-w-[44px] text-xs font-medium text-gray-500 hover:text-gray-700"
                aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
              >
                {showPassword ? 'ซ่อน' : 'แสดง'}
              </button>
            </div>
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-600">
              <span aria-hidden>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full min-h-[44px]"
          >
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </div>
    </div>
  )
}
