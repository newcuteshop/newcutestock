'use client'
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Check, Copy } from 'lucide-react'
import { ICON_XS } from '@/components/theme/icons'

// ปุ่มคัดลอกข้อความ (เลขบัญชี / เลขพร้อมเพย์ / ลิงก์สถานะการจอง)
// เบราว์เซอร์ในแอป LINE/Facebook บางรุ่นไม่มี navigator.clipboard → ใช้วิธีเลือกข้อความแล้ว execCommand('copy') แทน
// ผลลัพธ์ประกาศผ่าน aria-live (โปรแกรมอ่านจอได้ยิน) · คัดลอกไม่ได้จริงๆ → บอกให้กดค้างที่ข้อความแทน

export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // ไม่ได้รับอนุญาต → ลองวิธีสำรอง
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.left = '0'
    ta.style.opacity = '0'
    // 16px กัน iOS ซูมหน้าตอนโฟกัสช่องชั่วคราว
    ta.style.fontSize = '16px'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export default function CopyButton({
  text, label = 'คัดลอก', ariaLabel, className,
}: {
  text: string
  label?: string
  /** ชื่อปุ่มสำหรับโปรแกรมอ่านจอ เช่น "คัดลอกเลขบัญชี 123-4-56789-0" */
  ariaLabel?: string
  className?: string
}) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const timer = useRef<number | null>(null)

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  async function onClick() {
    const ok = await copyText(text)
    setState(ok ? 'ok' : 'fail')
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), ok ? 2000 : 5000)
  }

  return (
    <span className={clsx('inline-flex flex-col items-end', className)}>
      <button type="button" onClick={onClick} className="btn-soft px-3 text-sm" aria-label={ariaLabel ?? label}>
        {state === 'ok' ? <Check {...ICON_XS} /> : <Copy {...ICON_XS} />}
        <span>{state === 'ok' ? 'คัดลอกแล้ว' : label}</span>
      </button>
      <span aria-live="polite" className={clsx('text-right text-xs', state === 'fail' ? 'mt-1 text-red-700' : 'sr-only')}>
        {state === 'ok' ? 'คัดลอกแล้ว' : state === 'fail' ? 'คัดลอกไม่ได้ — กดค้างที่ข้อความเพื่อคัดลอกเอง' : ''}
      </span>
    </span>
  )
}
