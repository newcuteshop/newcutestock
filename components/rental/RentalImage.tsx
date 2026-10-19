'use client'
import { useState } from 'react'
import clsx from 'clsx'
import { ImageOff, Shirt } from 'lucide-react'
import { rentalImageUrl } from '@/lib/rental'

// รูปชุดเช่าจากถัง rental-images (public) + ภาพแทนเมื่อไม่มีรูป/โหลดรูปไม่ได้ (พื้นเทาอ่อนเรียบ + ไอคอนเทา แบบการ์ดสินค้า)
// กล่องนอกกำหนดขนาด/สัดส่วนเอง ผ่าน className (เช่น 'aspect-[4/5] w-full' หรือ 'h-14 w-14 rounded-lg')
// ใช้ได้ทั้งหลังร้านและหน้าจองออนไลน์ (ไม่ต้องเข้าสู่ระบบ)

export type RentalImageProps = {
  path: string | null | undefined
  /** ข้อความแทนรูป — รูปตกแต่งข้างชื่อชุดให้ส่ง '' */
  alt: string
  className?: string
  imgClassName?: string
  /** true = โหลดทันที (รูปหลักบนหน้า) ; ค่าเริ่มต้น lazy */
  eager?: boolean
  /** แสดงข้อความใต้ไอคอนเมื่อไม่มีรูป (กล่องเล็กให้ปิด) */
  showFallbackText?: boolean
}

export default function RentalImage({
  path, alt, className, imgClassName, eager = false, showFallbackText = false,
}: RentalImageProps) {
  // จำ path ที่โหลดไม่ได้ (เปลี่ยน path แล้วลองใหม่เอง ไม่ต้องรีเซ็ต state)
  const [brokenPath, setBrokenPath] = useState<string | null>(null)
  const clean = typeof path === 'string' && path.trim() !== '' ? path : null
  const src = clean && brokenPath !== clean ? rentalImageUrl(clean) : ''
  const broken = clean !== null && brokenPath === clean

  return (
    <div className={clsx('relative overflow-hidden bg-gray-50', className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setBrokenPath(clean)}
          className={clsx('h-full w-full object-cover', imgClassName)}
        />
      ) : (
        <div
          className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-gray-400"
          role={alt ? 'img' : undefined}
          aria-label={alt ? `${alt} (${broken ? 'โหลดรูปไม่ได้' : 'ยังไม่มีรูป'})` : undefined}
          aria-hidden={alt ? undefined : true}
        >
          {broken ? <ImageOff size={24} strokeWidth={1.5} aria-hidden="true" /> : <Shirt size={24} strokeWidth={1.5} aria-hidden="true" />}
          {showFallbackText && (
            <span className="text-xs font-medium text-gray-500">{broken ? 'โหลดรูปไม่ได้' : 'ยังไม่มีรูป'}</span>
          )}
        </div>
      )}
    </div>
  )
}
