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
import ShopThemeSync from '@/components/theme/ShopThemeSync'
import { ICON, ICON_SM } from '@/components/theme/icons'

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
        // ไปหน้าเลือกร้านก่อน (/select) — มีสิทธิ์ร้านเดียว หน้านั้นพาเข้าร้านนั้นให้เองทันที
        window.location.href = '/select'
      }
    } catch (err: unknown) {
      // เรียก server action ไม่ได้ (เน็ตหลุด ฯลฯ)
      setError(thaiError(err))
      setLoading(false)
    }
  }

  return (
    // ไม่ใส่พื้นหลัง: พื้นเทาอ่อนมาจาก body · ขอบบน/ล่างเผื่อรอยบากและแถบ home (จอใหญ่ขอบแคบลง ให้การ์ดสูงเกือบเต็มจอ)
    <div className="min-h-screen min-h-[100dvh] flex items-center justify-center px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] wide:pt-[max(1rem,env(safe-area-inset-top))] wide:pb-[max(1rem,env(safe-area-inset-bottom))]">
      {/* หน้าเข้าสู่ระบบเป็นของ NEWCUTE (โรสโกลด์) เสมอ — แม้มาจากหน้าร้านเช่า */}
      <ShopThemeSync shop="newcute" />
      {/* บอสสั่ง 24/11/2569: ใหญ่เกือบเต็มจอ เห็นเด่นชัด — การ์ดขาว มุม 16px เส้นบาง 1px (ตัวการ์ดไม่ยกลอย มีแต่ปุ่มเข้าสู่ระบบ)
          มือถือ: การ์ดเต็มกว้าง แบรนด์ด้านบน ฟอร์มด้านล่าง · แท็บเล็ต (md): การ์ดกว้าง ~90vw คอลัมน์เดียว
          จอใหญ่แนวนอน (wide: = กว้าง ≥ 1024px และกว้าง:สูง ≥ 5:4 — tailwind.config.ts): สูง 84dvh แบ่ง 2 ฝั่ง
          ซ้ายแบรนด์ (พื้นโรสโกลด์อ่อน brand-50) / ขวาฟอร์ม · กว้าง 92vw แต่ไม่เกิน 1.6 เท่าความสูงจอ (ไม่ต่ำกว่า 1200px)
          → สัดส่วนการ์ดเท่ากันทุกจอ (1366×768 ≈ 1229px · 1440×900 ≈ 1325px · 1920×1080 ≈ 1728px · 2560×1440 ≈ 2304px)
          ตัวอักษร/โลโก้/ช่องกรอกขยายตามความสูงจอ (dvh) ต่อถึงจอสูง ไม่ปล่อยการ์ดใหญ่โล่ง
          จอแนวตั้ง (เช่น iPad Pro แนวตั้ง) ใช้แบบแท็บเล็ตคอลัมน์เดียว */}
      <div className="card w-full max-w-[30rem] overflow-hidden rounded-4xl md:max-w-[min(90vw,46rem)] wide:grid wide:min-h-[84dvh] wide:w-[min(92vw,max(75rem,160dvh))] wide:max-w-none wide:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="flex flex-col items-center justify-center border-b border-brand-100 bg-brand-50 px-6 py-8 text-center md:py-12 wide:border-b-0 wide:border-r wide:px-[clamp(2rem,4vw,5rem)] wide:py-[clamp(2rem,6dvh,5rem)]">
          {/* โลโก้: มือถือ 80px · แท็บเล็ต 128px · จอใหญ่ 144-368px ตามความสูงจอ (26dvh — ทับขนาด lg 64px ด้วย !) */}
          <BrandMark size="lg" className="!h-20 !w-20 md:!h-32 md:!w-32 wide:!h-[clamp(9rem,26dvh,23rem)] wide:!w-[clamp(9rem,26dvh,23rem)]" />
          {/* ชื่อร้านหนา 800 (กติกาเดียวกับ .page-title / ชื่อร้านในเมนู — ฟอนต์ Prompt) · จอใหญ่ 48-136px (9dvh) */}
          <h1 className="mt-5 text-[40px] font-extrabold leading-[1.1] tracking-wide text-gray-900 md:mt-6 md:text-[56px] wide:mt-[clamp(1.25rem,4dvh,3.75rem)] wide:text-[length:clamp(3rem,9dvh,8.5rem)]">
            NEWCUTE
          </h1>
          <p className="mt-2 text-[17px] text-gray-600 md:mt-3 md:text-xl wide:text-[length:clamp(1.25rem,3dvh,2.75rem)]">ระบบสต๊อกสินค้าเสื้อผ้า</p>
        </div>

        <div className="flex flex-col justify-center px-5 py-7 sm:px-8 md:px-14 md:py-12 wide:px-[clamp(2.5rem,5vw,6rem)] wide:py-[clamp(2rem,6dvh,5rem)]">
          <div className="mx-auto w-full max-w-[30rem] wide:max-w-[clamp(30rem,52dvh,48rem)]">
            <h2 className="text-2xl font-semibold leading-tight text-gray-900 md:text-[28px] wide:text-[length:clamp(1.75rem,4.4dvh,4rem)]">เข้าสู่ระบบ</h2>
            <p className="mt-1.5 text-base text-gray-500 md:text-lg wide:text-[length:clamp(1.125rem,2.2dvh,2rem)]">กรอกชื่อผู้ใช้และรหัสผ่านเพื่อเข้าใช้งาน</p>

            {/* ช่องกรอกใหญ่: สูง 56px (มือถือ) / 60px (แท็บเล็ต) / 64-104px (จอใหญ่ ตามความสูงจอ) ตัวอักษร 18-32px (เกิน 16px → iPhone ไม่ซูมเอง) */}
            <form method="post" onSubmit={handleLogin} className="mt-6 space-y-5 md:mt-8 md:space-y-6 wide:mt-[clamp(2rem,4dvh,3.5rem)] wide:space-y-[clamp(1.5rem,2.8dvh,2.75rem)]" noValidate>
              <div>
                <label htmlFor="login-username" className="field-label mb-2 text-base md:text-lg wide:text-[length:clamp(1.125rem,2.2dvh,2rem)]">ชื่อผู้ใช้</label>
                {/* ไอคอนเทานำหน้าช่อง (ตกแต่ง — ชื่อช่องอยู่ใน <label>) */}
                <div className="input-icon [&>svg]:left-4">
                  <UserRound {...ICON} />
                  <input
                    id="login-username" name="username"
                    type="text" autoComplete="username"
                    autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    value={login} onChange={e => { setLogin(e.target.value); setError('') }}
                    className="input min-h-[56px] pl-12 text-lg md:min-h-[60px] wide:min-h-[clamp(4rem,7.2dvh,6.5rem)] wide:text-[length:clamp(1.125rem,2.2dvh,2rem)]" placeholder="เช่น max" aria-describedby="login-username-hint" required
                  />
                </div>
                <p id="login-username-hint" className="field-hint mt-1.5 text-sm md:text-[15px] wide:text-[length:clamp(0.9375rem,1.7dvh,1.5rem)]">ใช้อีเมลเดิมก็ได้</p>
              </div>
              <div>
                <label htmlFor="login-password" className="field-label mb-2 text-base md:text-lg wide:text-[length:clamp(1.125rem,2.2dvh,2rem)]">รหัสผ่าน</label>
                <div className="input-icon [&>svg]:left-4">
                  <Lock {...ICON} />
                  <input
                    id="login-password" name="password"
                    type={showPassword ? 'text' : 'password'} autoComplete="current-password"
                    autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    value={password} onChange={e => { setPassword(e.target.value); setError('') }}
                    className="input min-h-[56px] pl-12 pr-28 text-lg md:min-h-[60px] wide:min-h-[clamp(4rem,7.2dvh,6.5rem)] wide:text-[length:clamp(1.125rem,2.2dvh,2rem)]" placeholder="••••••••" required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(s => !s)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 min-h-[44px] min-w-[44px] px-3 rounded-lg text-base font-medium text-brand-700 transition-colors md:min-h-[48px] [@media(hover:hover)]:hover:bg-gray-100 active:bg-gray-150 wide:text-[length:clamp(1rem,1.8dvh,1.5rem)]"
                    aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                  >
                    {showPassword ? <EyeOff {...ICON} /> : <Eye {...ICON} />}
                    {showPassword ? 'ซ่อน' : 'แสดง'}
                  </button>
                </div>
              </div>

              {error && (
                <div role="alert" className="alert-err text-base">
                  <AlertCircle {...ICON_SM} />
                  <span className="min-w-0 break-words">{error}</span>
                </div>
              )}

              {/* ปุ่มเข้าสู่ระบบ: ชี้เมาส์แล้วยกลอย + แถบแสงวิ่งผ่าน (.lift-hover — ปุ่มที่ยังกดไม่ได้ไม่ยก) */}
              <button
                type="submit"
                disabled={loading || !hydrated || !ready}
                className="btn-primary lift-hover w-full min-h-[56px] rounded-xl text-lg md:min-h-[60px] wide:min-h-[clamp(4rem,7.2dvh,6.5rem)] wide:text-[length:clamp(1.125rem,2.2dvh,2rem)]"
              >
                {loading && <Loader2 {...ICON} className="animate-spin" />}
                {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
                {!loading && <ArrowRight {...ICON} />}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
