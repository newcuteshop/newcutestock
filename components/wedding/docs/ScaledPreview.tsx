'use client'
// ===== กรอบตัวอย่างเอกสารแบบย่อให้พอดีความกว้าง (เอกสารจริงกว้าง 1080px) =====
// เอกสารข้างในวาดขนาดจริงเสมอ (ไม่ย่อ layout) แล้วย่อเฉพาะภาพด้วย transform: scale
//   → กล่องเอกสารข้างในคือกล่องเดียวกับที่ส่งให้ renderNodeToPng (รูปที่ได้ = ที่เห็นทุกประการ)
//   transform ไม่เปลี่ยนขนาด layout ของลูก: กรอบนอกตั้งความสูง = ความสูงจริง × สัดส่วน และ overflow hidden (ไม่มีแถบเลื่อนข้าง)
// ขนาดตามกรอบ (ResizeObserver) — หมุนจอ/ย่อหน้าต่างแล้วตามทัน
import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'

export default function ScaledPreview({
  docWidth = 1080,
  maxScale = 1,
  className,
  label,
  children,
}: {
  docWidth?: number
  maxScale?: number
  className?: string
  /** ชื่อกรอบสำหรับโปรแกรมอ่านจอ */
  label?: string
  children: ReactNode
}) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ scale: number; height: number; left: number }>({ scale: 0, height: 0, left: 0 })

  useEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return
    const update = () => {
      const w = outer.clientWidth
      if (w <= 0) return
      const scale = Math.min(maxScale, w / docWidth)
      const height = Math.ceil(inner.offsetHeight * scale)
      const left = Math.max(0, Math.floor((w - docWidth * scale) / 2))
      setBox(prev => (prev.scale === scale && prev.height === height && prev.left === left ? prev : { scale, height, left }))
    }
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      const t = window.setInterval(update, 1000)
      return () => {
        window.removeEventListener('resize', update)
        window.clearInterval(t)
      }
    }
    const ro = new ResizeObserver(() => update())
    ro.observe(outer)
    ro.observe(inner)
    return () => ro.disconnect()
  }, [docWidth, maxScale])

  return (
    <div
      ref={outerRef}
      className={clsx('relative w-full overflow-hidden', className)}
      style={{ height: box.height || 240 }}
      role={label ? 'region' : undefined}
      aria-label={label}
    >
      <div
        ref={innerRef}
        className="absolute top-0"
        style={{
          left: box.left,
          width: docWidth,
          transform: `scale(${box.scale || 0.3})`,
          transformOrigin: 'top left',
          // ก่อนวัดขนาดเสร็จ ไม่ให้เห็นเอกสารขนาดผิดแวบหนึ่ง — ใช้ opacity ที่กรอบนี้ (ไม่สืบทอด) ไม่ใช้ visibility
          // (visibility สืบทอดถึงกล่องเอกสาร → รูปที่สร้างช่วงนั้นจะว่าง)
          opacity: box.scale ? 1 : 0,
        }}
      >
        {children}
      </div>
    </div>
  )
}
