'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'

// โลโก้ที่ร้าน b.oncloud อัปโหลดไว้ (ตั้งค่าร้าน → โลโก้ร้าน) — ใช้แทนสัญลักษณ์ก้อนเมฆ (WeddingMark) ทุกจุดเมื่อมีโลโก้
// แสดงรูปตามสัดส่วนจริง: ขนาดคุมด้วย max-h-* / max-w-* ใน className (กว้าง/สูง auto) → กล่องพอดีรูปเสมอ
//   มุมมน (rounded-* ใน className) ตัดที่ตัวรูปจริง — โลโก้ที่มีพื้นในตัว (เช่น JPG พื้นเทาอ่อน) ดูเป็นแผ่นโลโก้มุมมนที่ตั้งใจ
//   ไม่มีกรอบ/พื้น/เงา (ไม่เป็น "กล่องซ้อนกล่อง" แบบเดิม)
// ไม่มีลิงก์ / โหลดรูปไม่ได้ → fallback (สัญลักษณ์เดิมของร้าน) — ไม่มีวันเห็นรูปแตก
//   รูปที่พังก่อน React เริ่มทำงาน (onError ไม่ถูกเรียก) → ตรวจ complete + naturalWidth ตอน mount อีกชั้น
// slot (ไม่บังคับ) = กล่องจองที่ให้รูป (สูง/กว้างตายตัว) — <img> ไม่รู้ขนาดจนกว่าโหลดเสร็จ (กว้าง/สูง 0 ตอนแรก) ทำให้ชื่อร้าน/เมนู
//   ที่อยู่ถัดไปกระโดดตอนรูปโหลดเสร็จ (โหลดหน้าใหม่ทุกครั้ง) → ใส่ h-* (และ w-* ถ้าวางข้างชื่อ) ให้ตรงกับ max-h/max-w ของรูป
//   รูปชิดซ้าย กลางแนวตั้งในกล่อง (ปรับ justify-* ได้ผ่าน slot) ; ไม่มีโลโก้/โหลดไม่ได้ = ไม่มีกล่องนี้ (fallback ตามเดิม)
// children (ไม่บังคับ) = ห่อรูปด้วยโครงอื่นเฉพาะตอนแสดงโลโก้ (เช่น เมนูข้างวางโลโก้เหนือชื่อร้าน) — ใช้ได้จาก client component เท่านั้น
//   (ฟังก์ชันส่งข้ามจาก server component ไม่ได้ ; หน้าเซิร์ฟเวอร์ใช้แค่ src/className/fallback)
export default function WeddingLogo({
  src,
  className,
  slot,
  alt = '',
  fallback = null,
  children,
}: {
  src: string | null | undefined
  className?: string
  slot?: string
  alt?: string
  fallback?: ReactNode
  children?: (img: ReactNode) => ReactNode
}) {
  const ref = useRef<HTMLImageElement>(null)
  const url = String(src ?? '').trim()
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    const img = ref.current
    if (url && img && img.complete && img.naturalWidth === 0) setFailed(url)
  }, [url])

  if (!url || failed === url) return <>{fallback}</>
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- รูปจาก storage สาธารณะของร้าน (ขนาดตามรูปจริง)
    <img
      ref={ref}
      src={url}
      alt={alt}
      decoding="async"
      onError={() => setFailed(url)}
      className={clsx('block h-auto w-auto shrink-0 object-contain', className)}
    />
  )
  const shown = slot ? <span className={clsx('flex shrink-0 items-center', slot)}>{img}</span> : img
  return <>{children ? children(shown) : shown}</>
}
