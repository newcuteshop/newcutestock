'use client'
import { useEffect, useState } from 'react'
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock, UserRound } from 'lucide-react'
import { loginAction } from './actions'
import { thaiError } from '@/lib/format'
import { loginToEmail } from '@/lib/auth/credentials'
import { signOutAction } from '@/lib/auth/sign-out-action'
import {
  clearEnteredThisWindow,
  markEnteredThisWindow,
  unlockEntryGate,
  windowStorageWorks,
} from '@/lib/auth/entry-gate'
import BrandMark from '@/components/theme/BrandMark'
import { ICON_SM } from '@/components/theme/icons'

// รอออกจากระบบเดิมไม่เกินเท่านี้ แล้วเปิดปุ่มเข้าสู่ระบบเลย (กันฟอร์มค้าง)
// ถ้ายังไม่เสร็จ loginAction จะเข้าคิวต่อท้ายเอง (Next.js รัน server action ทีละตัว) → ไม่มีทางลบ session ใหม่
const SIGN_OUT_WAIT_MS = 3000

const STORAGE_BLOCKED =
  'เบราว์เซอร์นี้บล็อกการเก็บข้อมูลของเว็บ จึงเข้าสู่ระบบไม่ได้ — อนุญาตคุกกี้/ข้อมูลเว็บไซต์สำหรับเว็บนี้ แล้วลองใหม่'

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

  // เปิดหน้านี้ = เริ่มใหม่เสมอ: ลืมการเข้าสู่ระบบของหน้าต่างนี้ + เพิกถอน session เดิม (ถ้ามี) — ดู lib/auth/entry-gate.ts
  // ปุ่มเข้าสู่ระบบรอจนออกจากระบบเสร็จ (ไม่เกิน SIGN_OUT_WAIT_MS)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let alive = true
    let round = 0
    let timer = 0

    function reset() {
      const mine = ++round
      // มาจากหน้าที่ถูกล็อกโดยไม่ได้โหลดหน้าใหม่ → เปิดหน้าจอ (หน้านี้ไม่มีข้อมูลร้าน)
      unlockEntryGate()
      clearEnteredThisWindow()
      setReady(false)
      const finish = () => {
        if (!alive || mine !== round) return
        window.clearTimeout(timer)
        setReady(true)
      }
      window.clearTimeout(timer)
      timer = window.setTimeout(finish, SIGN_OUT_WAIT_MS)
      signOutAction()
        .catch(() => undefined)
        .finally(finish)
    }

    reset()

    // กด Back กลับมาหน้านี้จาก back/forward cache (หน้าเดิมในหน่วยความจำ) → เริ่มใหม่อีกรอบ
    function onPageShow(e: PageTransitionEvent) {
      if (!e.persisted) return
      setLoading(false)
      setError('')
      reset()
    }
    window.addEventListener('pageshow', onPageShow)
    return () => {
      alive = false
      window.clearTimeout(timer)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading || !ready) return

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
    // ประตูเข้าระบบจำหน้าต่างด้วย sessionStorage — ถ้าเบราว์เซอร์บล็อก เข้าไปแล้วจะถูกพากลับหน้านี้วนไป → บอกก่อน
    if (!windowStorageWorks()) {
      setError(STORAGE_BLOCKED)
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
        // จำว่าหน้าต่างนี้เข้าสู่ระบบเองแล้ว — ต้องตั้งก่อนเปลี่ยนหน้า ไม่งั้นหน้าระบบจะพากลับมาหน้านี้
        markEnteredThisWindow()
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
    // ไม่ใส่พื้นหลัง: พื้นเทาอ่อนมาจาก body · ขอบบน/ล่างเผื่อรอยบากและแถบ home
    <div className="min-h-screen min-h-[100dvh] flex items-center justify-center px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      {/* การ์ดขาวเรียบ มุม 12px เส้นบาง 1px (.card) */}
      <div className="card w-full max-w-sm">
        <div className="px-6 py-7 sm:px-8 sm:py-8">
          <div className="flex flex-col items-center text-center mb-6">
            <BrandMark size="lg" />
            <h1 className="mt-4 text-2xl font-semibold leading-tight tracking-wide text-gray-900">NEWCUTE</h1>
            <p className="text-gray-500 text-sm mt-1">ระบบสต๊อกสินค้าเสื้อผ้า</p>
          </div>

          <form method="post" onSubmit={handleLogin} className="space-y-4" noValidate>
            <div>
              <label htmlFor="login-username" className="field-label">ชื่อผู้ใช้</label>
              {/* ไอคอนเทานำหน้าช่อง (ตกแต่ง — ชื่อช่องอยู่ใน <label>) */}
              <div className="input-icon">
                <UserRound {...ICON_SM} />
                <input
                  id="login-username" name="username"
                  type="text" autoComplete="username"
                  autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  value={login} onChange={e => { setLogin(e.target.value); setError('') }}
                  className="input min-h-[48px] pl-11" placeholder="เช่น max" aria-describedby="login-username-hint" required
                />
              </div>
              <p id="login-username-hint" className="field-hint">ใช้อีเมลเดิมก็ได้</p>
            </div>
            <div>
              <label htmlFor="login-password" className="field-label">รหัสผ่าน</label>
              <div className="input-icon">
                <Lock {...ICON_SM} />
                <input
                  id="login-password" name="password"
                  type={showPassword ? 'text' : 'password'} autoComplete="current-password"
                  autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  value={password} onChange={e => { setPassword(e.target.value); setError('') }}
                  className="input min-h-[48px] pl-11 pr-24" placeholder="••••••••" required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 min-h-[44px] min-w-[44px] px-3 rounded-lg text-sm font-medium text-brand-700 transition-colors [@media(hover:hover)]:hover:bg-gray-100 active:bg-gray-150"
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
              disabled={loading || !hydrated || !ready}
              className="btn-primary w-full min-h-[48px] text-base"
            >
              {loading && <Loader2 {...ICON_SM} className="animate-spin" />}
              {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
              {!loading && <ArrowRight {...ICON_SM} />}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
