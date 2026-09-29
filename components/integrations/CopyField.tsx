'use client'
// ช่องข้อความอ่านอย่างเดียว + ปุ่มคัดลอก (URL webhook / callback / โดเมน / ลิงก์ฟีด)
import { useEffect, useId, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'

export default function CopyField({ label, value, help }: { label: string; value: string; help?: string }) {
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const id = useId()

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  async function copy() {
    let ok = false
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value)
        ok = true
      }
    } catch { ok = false }
    if (!ok) {
      // สำรอง: เลือกข้อความแล้วใช้คำสั่งคัดลอกของเบราว์เซอร์ (http ธรรมดา / เบราว์เซอร์เก่า)
      const el = inputRef.current
      if (el) {
        el.focus()
        el.select()
        try { ok = document.execCommand('copy') } catch { ok = false }
      }
    }
    if (ok) {
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          id={id}
          type="text"
          readOnly
          value={value}
          onFocus={e => e.currentTarget.select()}
          className="input min-w-0 flex-1 font-mono md:text-sm"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? `คัดลอก${label}แล้ว` : `คัดลอก${label}`}
          className="btn-icon shrink-0"
        >
          {copied ? <Check {...ICON_SM} className="text-green-700" /> : <Copy {...ICON_SM} />}
        </button>
      </div>
      <p className="text-xs mt-1 min-h-[1rem] text-gray-500" aria-live="polite">
        {copied ? 'คัดลอกแล้ว' : help ?? ''}
      </p>
    </div>
  )
}
