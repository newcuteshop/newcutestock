'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import RentalImage from '@/components/rental/RentalImage'

// แกลเลอรีรูปชุด: ปัดซ้าย-ขวาด้วยนิ้ว (CSS scroll-snap ของเบราว์เซอร์เอง ไม่มีไลบรารี) + ปุ่มก่อน/ถัดไป + รูปย่อด้านล่าง
// รูปแสดงแบบ "เห็นทั้งชุด" (object-contain บนพื้นเทาอ่อน) — รูปแนวนอนไม่ถูกตัดหัว/ชาย
// เครื่องที่ตั้ง "ลดการเคลื่อนไหว" → เลื่อนไปรูปที่เลือกทันที ไม่เลื่อนแบบนุ่มนวล

type GalleryImage = { path: string; width: number | null; height: number | null }

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export default function Gallery({ images, name }: { images: GalleryImage[]; name: string }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const n = images.length

  const onScroll = useCallback(() => {
    const el = scroller.current
    if (!el || el.clientWidth === 0) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    setIndex(Math.max(0, Math.min(n - 1, i)))
  }, [n])

  // รูปชุดเปลี่ยน (เปลี่ยนหน้าชุด) → กลับไปรูปแรก
  useEffect(() => {
    setIndex(0)
    scroller.current?.scrollTo({ left: 0 })
  }, [images])

  function go(i: number) {
    const el = scroller.current
    if (!el) return
    const target = Math.max(0, Math.min(n - 1, i))
    el.scrollTo({ left: target * el.clientWidth, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    setIndex(target)
  }

  if (n === 0) {
    return <RentalImage path={null} alt={name} className="aspect-[4/5] w-full rounded-xl border border-gray-200" showFallbackText />
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <div
          ref={scroller}
          onScroll={onScroll}
          className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-xl border border-gray-200 bg-gray-50 scrollbar-none"
          aria-roledescription="ชุดรูปภาพ"
          aria-label={`รูปชุด ${name}`}
          tabIndex={0}
          onKeyDown={e => {
            if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1) }
            if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1) }
          }}
        >
          {images.map((im, i) => (
            <div
              key={im.path}
              className="w-full shrink-0 snap-center"
              role="group"
              aria-roledescription="รูป"
              aria-label={`รูปที่ ${i + 1} จาก ${n}`}
            >
              <RentalImage
                path={im.path}
                alt={n > 1 ? `${name} (รูปที่ ${i + 1})` : name}
                className="aspect-[4/5] w-full"
                imgClassName="!object-contain"
                eager={i === 0}
              />
            </div>
          ))}
        </div>
        {n > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(index - 1)}
              disabled={index === 0}
              className="btn-icon absolute left-2 top-1/2 -translate-y-1/2 bg-white/90"
              aria-label="รูปก่อนหน้า"
            >
              <ChevronLeft {...ICON_SM} />
            </button>
            <button
              type="button"
              onClick={() => go(index + 1)}
              disabled={index === n - 1}
              className="btn-icon absolute right-2 top-1/2 -translate-y-1/2 bg-white/90"
              aria-label="รูปถัดไป"
            >
              <ChevronRight {...ICON_SM} />
            </button>
            <span className="chip absolute bottom-2 right-2 bg-white/90" aria-live="polite">
              {index + 1} / {n}
            </span>
          </>
        )}
      </div>
      {n > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" role="group" aria-label="เลือกรูป">
          {images.map((im, i) => (
            <button
              key={im.path}
              type="button"
              onClick={() => go(i)}
              aria-label={`ดูรูปที่ ${i + 1}`}
              aria-current={i === index ? 'true' : undefined}
              className={clsx(
                'h-16 w-14 shrink-0 overflow-hidden rounded-lg border-2',
                i === index ? 'border-brand-600' : 'border-transparent',
              )}
            >
              <RentalImage path={im.path} alt="" className="h-full w-full" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
