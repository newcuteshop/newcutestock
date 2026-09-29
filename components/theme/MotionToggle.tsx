'use client'
import { useEffect, useId, useState } from 'react'
import { Sparkles } from 'lucide-react'
import clsx from 'clsx'
import { MOTION_STORAGE_KEY } from './motion'

// สวิตช์ "เอฟเฟกต์เคลื่อนไหว เปิด/ปิด" — จำค่าในเครื่องนี้ (localStorage) แล้วตั้ง <html data-motion="on|off">
// ปิดแล้ว globals.css หยุดแอนิเมชันทั้งหมด (แสงบนปุ่ม, ฟองนม, กลีบกุหลาบ) — ประหยัดแบตบนมือถือ
// app/layout.tsx อ่านค่าเดียวกันก่อนหน้าเว็บแสดงผล (กันเอฟเฟกต์วิ่งแวบแรกตอนผู้ใช้ปิดไว้)

const MOTION_EVENT = 'newcute-motion-change'

type Motion = 'on' | 'off'

function readMotion(): Motion {
  try {
    return window.localStorage.getItem(MOTION_STORAGE_KEY) === 'off' ? 'off' : 'on'
  } catch {
    return 'on'
  }
}

function applyMotion(value: Motion) {
  document.documentElement.dataset.motion = value
}

export default function MotionToggle({ className }: { className?: string }) {
  const [motion, setMotion] = useState<Motion>('on')
  const labelId = useId()

  useEffect(() => {
    const initial = readMotion()
    setMotion(initial)
    applyMotion(initial)

    // มีสวิตช์หลายตัวบนจอ (เมนูข้าง + ลิ้นชักมือถือ) หรือเปิดหลายแท็บ → ให้ตรงกันทุกตัว
    function onChange(e: Event) {
      const value = (e as CustomEvent<Motion>).detail
      if (value === 'on' || value === 'off') setMotion(value)
    }
    function onStorage(e: StorageEvent) {
      if (e.key !== MOTION_STORAGE_KEY) return
      const value: Motion = e.newValue === 'off' ? 'off' : 'on'
      setMotion(value)
      applyMotion(value)
    }
    window.addEventListener(MOTION_EVENT, onChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(MOTION_EVENT, onChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  function toggle() {
    const next: Motion = motion === 'on' ? 'off' : 'on'
    setMotion(next)
    applyMotion(next)
    try {
      window.localStorage.setItem(MOTION_STORAGE_KEY, next)
    } catch {
      // เก็บค่าไม่ได้ (โหมดส่วนตัว ฯลฯ) — ใช้ได้เฉพาะรอบนี้
    }
    window.dispatchEvent(new CustomEvent<Motion>(MOTION_EVENT, { detail: next }))
  }

  const on = motion === 'on'

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelId}
      onClick={toggle}
      className={clsx('nav-item w-full gap-2 text-left text-sm', className)}
    >
      <Sparkles size={20} strokeWidth={1.8} aria-hidden="true" />
      {/* ข้อความยาว ~130px แต่ที่ว่างมีแค่ ~111px (ลิ้นชักมือถือ 288px) / ~63px (เมนูข้างคอม 240px)
          → ขึ้น 2 บรรทัดทั้งสองที่ ตั้งระยะบรรทัดให้ชิด ยังอยู่ในความสูง 44px (ไม่ลด padding ให้ไอคอนตรงกับเมนูอื่น) */}
      <span id={labelId} className="flex-1 min-w-0 leading-tight">เอฟเฟกต์เคลื่อนไหว</span>
      <span className="text-xs font-semibold text-gray-600" aria-hidden="true">{on ? 'เปิด' : 'ปิด'}</span>
      {/* ราง + ปุ่มกลม (.switch ใน globals.css) */}
      <span aria-hidden="true" className={clsx('switch', on && 'switch-on')}>
        <span className="switch-knob" />
      </span>
    </button>
  )
}
