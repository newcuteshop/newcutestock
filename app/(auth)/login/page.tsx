'use client'
import { useEffect, useState } from 'react'
import { AlertCircle, ArrowRight, Eye, EyeOff, Heart, Loader2, Lock, UserRound } from 'lucide-react'
import { loginAction } from './actions'
import { thaiError } from '@/lib/format'
import { loginToEmail } from '@/lib/auth/credentials'
import BrandMark from '@/components/theme/BrandMark'
import { ICON_SM } from '@/components/theme/icons'

// ไอคอนในฟองบลัชที่หัวช่องกรอก (ตกแต่ง — ชื่อช่องอยู่ใน <label>)
const FIELD_ICON = { size: 17, strokeWidth: 2, 'aria-hidden': true } as const

export default function LoginPage() {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // หน้านี้ prerender เป็น HTML นิ่ง — ก่อน JS โหลดเสร็จ ห้ามกดส่งฟอร์ม
  // (ไม่งั้นเบราว์เซอร์ส่งฟอร์มเองแบบ GET แล้วรหัสผ่านไปโผล่ใน URL / ประวัติ / log)
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading) return

    // อ่านค่าจากฟอร์มตรงๆ ด้วย — กันกรณีเบราว์เซอร์ autofill แล้วไม่ยิง onChange
    const fd = new FormData(e.currentTarget)
    const name = (String(fd.get('username') ?? '') || login).trim()
    const pw = String(fd.get('password') ?? '') || password
    if (!name || !pw) {
      setError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน')
      return
    }
    // เช็ครูปแบบชื่อผู้ใช้ก่อนส่ง (เซิร์ฟเวอร์ตรวจซ้ำอีกชั้น)
    const resolved = loginToEmail(name)
    if ('error' in resolved) {
      setError(resolved.error)
      return
    }

    setLoading(true)
    setError('')
    try {
      const result = await loginAction(name, pw)
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
    // ไม่ใส่พื้นหลัง: พื้นนมชมพู + กลีบกุหลาบมาจาก body · ขอบบน/ล่างเผื่อรอยบากและแถบ home
    <div className="relative min-h-screen min-h-[100dvh] flex items-center justify-center px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      {/* ฟองนมลอยที่มุมว่าง (อยู่ก่อนการ์ดใน DOM → การ์ดทับเสมอ ไม่บังตัวหนังสือ) */}
      <span className="milk-bubble bob decor absolute left-[7%] top-[6%] h-[46px] w-[46px]" aria-hidden="true" />
      <span className="milk-bubble bob-3 decor absolute right-[8%] bottom-[7%] h-[30px] w-[30px]" aria-hidden="true" />

      <div className="card card-milk relative w-full max-w-sm overflow-hidden border-2 rounded-4xl sm:rounded-5xl">
        {/* กันสาดลายทาง ขอบล่างหยัก */}
        <div className="awning decor" aria-hidden="true" />

        <div className="px-6 pt-4 pb-6 sm:px-8 sm:pb-8">
          <div className="flex flex-col items-center text-center mb-6">
            <BrandMark size="lg" ring />
            <h1 className="mt-3 font-display text-[28px] font-bold leading-tight tracking-wide text-gray-900">NEWCUTE</h1>
            <p className="text-gray-500 text-sm mt-1">ระบบสต๊อกสินค้าเสื้อผ้า</p>
          </div>

          <form method="post" onSubmit={handleLogin} className="space-y-4" noValidate>
            <div>
              <label htmlFor="login-username" className="block pl-3 mb-1.5 font-display text-sm font-semibold text-gray-700">ชื่อผู้ใช้</label>
              <div className="relative">
                <span className="icon-bubble icon-bubble-sm absolute left-[7px] top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true">
                  <UserRound {...FIELD_ICON} />
                </span>
                <input
                  id="login-username" name="username"
                  type="text" autoComplete="username"
                  autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  value={login} onChange={e => { setLogin(e.target.value); setError('') }}
                  className="input min-h-[48px] pl-12" placeholder="เช่น max" aria-describedby="login-username-hint" required
                />
              </div>
              <p id="login-username-hint" className="pl-3 text-xs text-gray-500 mt-1">ใช้อีเมลเดิมก็ได้</p>
            </div>
            <div>
              <label htmlFor="login-password" className="block pl-3 mb-1.5 font-display text-sm font-semibold text-gray-700">รหัสผ่าน</label>
              <div className="relative">
                <span className="icon-bubble icon-bubble-sm absolute left-[7px] top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true">
                  <Lock {...FIELD_ICON} />
                </span>
                <input
                  id="login-password" name="password"
                  type={showPassword ? 'text' : 'password'} autoComplete="current-password"
                  autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  value={password} onChange={e => { setPassword(e.target.value); setError('') }}
                  className="input min-h-[48px] pl-12 pr-24" placeholder="••••••••" required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 min-h-[44px] min-w-[44px] px-3 rounded-full text-sm font-semibold text-brand-700 transition-colors active:bg-blush-hair"
                  aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                >
                  {showPassword ? <EyeOff {...ICON_SM} /> : <Eye {...ICON_SM} />}
                  {showPassword ? 'ซ่อน' : 'แสดง'}
                </button>
              </div>
            </div>

            {error && (
              <div role="alert" className="alert-err">
                <AlertCircle {...ICON_SM} />
                <span className="min-w-0 break-words">{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !hydrated}
              className="btn-primary w-full min-h-[54px] text-base"
            >
              {loading && <Loader2 {...ICON_SM} className="animate-spin" />}
              {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
              {!loading && <ArrowRight {...ICON_SM} />}
            </button>
          </form>

          {/* ลายเซ็นร้าน (ตกแต่ง) */}
          <div className="decor mt-6 flex items-center justify-center gap-2" aria-hidden="true">
            <Heart size={12} fill="#F4A7BB" stroke="none" aria-hidden="true" />
            <span className="font-display text-xs font-bold tracking-[0.3em] text-gray-900">NEWCUTE</span>
            <Heart size={12} fill="#F4A7BB" stroke="none" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  )
}
