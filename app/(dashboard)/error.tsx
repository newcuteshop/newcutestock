'use client'
import { useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Home, Loader2, RefreshCw } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'

// ข้อความจากระบบเราเป็นภาษาไทย (thaiError) — ข้อความอังกฤษ/ข้อความที่ Next ซ่อนใน production ไม่โชว์ให้ผู้ใช้
const THAI_CHARS = /[฀-๿]/

export default function DashboardError({
  error, reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    console.error(error)
  }, [error])

  const message = typeof error?.message === 'string' && THAI_CHARS.test(error.message)
    ? error.message
    : ''

  // โหลดข้อมูลฝั่งเซิร์ฟเวอร์ใหม่ แล้ว render หน้านี้อีกครั้ง
  function retry() {
    startTransition(() => {
      router.refresh()
      reset()
    })
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div role="alert" className="card w-full max-w-md p-5 sm:p-6 flex flex-col items-center text-center">
        <span className="icon-bubble icon-bubble-lg icon-bubble-err mb-3" aria-hidden="true">
          <AlertTriangle size={30} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <h1 className="font-display text-lg sm:text-xl font-bold text-gray-900">เกิดข้อผิดพลาด</h1>
        <p className="text-sm text-gray-600 mt-2 break-words">
          {message || 'ไม่สามารถแสดงหน้านี้ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง'}
        </p>
        {error?.digest && (
          <p className="text-xs text-gray-400 mt-2 break-all">รหัสอ้างอิง: {error.digest}</p>
        )}
        <div className="mt-5 w-full flex flex-col sm:flex-row gap-2 sm:justify-center">
          <button type="button" onClick={retry} disabled={pending} className="btn-primary">
            {pending ? <Loader2 {...ICON_SM} className="animate-spin" /> : <RefreshCw {...ICON_SM} />}
            {pending ? 'กำลังโหลด...' : 'ลองใหม่'}
          </button>
          {/* โหลดหน้าใหม่ทั้งหน้า (ไม่ใช้ Link) เผื่อ error อยู่ที่หน้า /dashboard เอง — Link ไป URL เดิมจะไม่ล้างหน้า error */}
          <button type="button" onClick={() => window.location.assign('/dashboard')} className="btn-secondary">
            <Home {...ICON_SM} />
            กลับหน้าแรก
          </button>
        </div>
      </div>
    </div>
  )
}
