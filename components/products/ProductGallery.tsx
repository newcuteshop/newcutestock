'use client'
// ===== แกลเลอรีรูปสินค้า =====
// - ภาพใหญ่เลื่อนข้างได้ (มือถือปัดนิ้ว / คอมกดลูกศร หรือปุ่มลูกศรบนคีย์บอร์ด) + แถบรูปย่อด้านล่าง
// - รูปแรก = รูปปก · ตั้งเป็นรูปปก / ย้ายซ้าย-ขวา / ลบ ทำกับรูปที่กำลังดูอยู่
// - เพิ่มได้ไม่จำกัด เลือกทีละหลายรูป หรือถ่ายจากกล้องมือถือ · แสดงความคืบหน้าทีละรูป
// - สินค้าใหม่ (ยังไม่บันทึก): รูปที่เลือกรอไว้ จะอัปโหลดให้ทันทีหลังกดบันทึกสินค้า

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, ImageOff, ImagePlus, Loader2, MoveLeft, MoveRight,
  RotateCcw, Shirt, Star, Trash2, X, XCircle,
} from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { formatBytes, productImageUrl } from '@/lib/products'
import { type ProductImagesApi, type QueueItem, QUEUE_PROGRESS } from './useProductImages'

type Slide =
  | { kind: 'image'; key: string; id: string; src: string; index: number }
  | { kind: 'queued'; key: string; item: QueueItem; src: string; index: number }

function reducedMotion(): boolean {
  try {
    if (document.documentElement.dataset.motion === 'off') return true
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function queueText(item: QueueItem, waitingForSave: boolean): string {
  switch (item.status) {
    case 'pending': return waitingForSave ? 'รอบันทึกสินค้า แล้วจะอัปโหลดให้' : 'รอคิวอัปโหลด'
    case 'compressing': return 'กำลังย่อรูป…'
    case 'uploading': return `กำลังอัปโหลด${item.bytes ? ` ${formatBytes(item.bytes)}` : ''}…`
    case 'saving': return 'กำลังบันทึกรูป…'
    case 'error': return item.error || 'อัปโหลดไม่สำเร็จ'
  }
}

function ProgressBar({ item }: { item: QueueItem }) {
  const p = QUEUE_PROGRESS[item.status]
  const active = item.status === 'compressing' || item.status === 'uploading' || item.status === 'saving'
  return (
    <div
      className={`h-2 w-full overflow-hidden rounded-full ${active ? 'skeleton' : 'bg-gray-100'}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(p * 100)}
      aria-label={`ความคืบหน้า ${item.name}`}
    >
      <div
        className={`h-full w-full origin-left rounded-full transition-transform duration-500 ${item.status === 'error' ? 'bg-red-600' : 'bg-brand-600'}`}
        style={{ transform: `scaleX(${item.status === 'error' ? 1 : p})` }}
      />
    </div>
  )
}

export default function ProductGallery({
  api, groupId, productName, disabled = false,
}: {
  api: ProductImagesApi
  groupId: string | null
  productName: string
  disabled?: boolean
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rafRef = useRef(0)
  const [index, setIndex] = useState(0)
  const [broken, setBroken] = useState<Record<string, boolean>>({})
  const [dragOver, setDragOver] = useState(false)
  // เลื่อนไปรูปที่ต้องการหลังรายการรูปเปลี่ยนแล้ว (ทำหลัง React วาดลำดับใหม่เสร็จ)
  const [pendingScroll, setPendingScroll] = useState<{ i: number; n: number } | null>(null)

  const waitingForSave = !groupId
  const slides: Slide[] = [
    ...api.images.map((img, i) => ({ kind: 'image' as const, key: img.id, id: img.id, src: productImageUrl(img.path), index: i })),
    ...api.queue.map((item, i) => ({ kind: 'queued' as const, key: item.key, item, src: item.previewUrl, index: api.images.length + i })),
  ]
  const count = slides.length
  const current = count > 0 ? slides[Math.min(index, count - 1)] : null
  const alt = (n: number) => `${productName.trim() || 'สินค้า'} รูปที่ ${n}`

  const scrollToIndex = useCallback((i: number, smooth = true) => {
    const el = scrollerRef.current
    if (!el) return
    const target = Math.max(0, i)
    el.scrollTo({ left: target * el.clientWidth, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' })
    setIndex(target)
  }, [])

  // จำนวนรูปลดลง (ลบรูป) → ไม่ให้ตำแหน่งเกินรูปสุดท้าย
  useEffect(() => {
    if (count > 0 && index > count - 1) scrollToIndex(count - 1, false)
  }, [count, index, scrollToIndex])

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
  }, [])

  useEffect(() => {
    if (pendingScroll) scrollToIndex(pendingScroll.i)
  }, [pendingScroll, scrollToIndex])

  function scrollAfterUpdate(i: number) {
    setPendingScroll({ i, n: Date.now() })
  }

  function onScroll() {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      const el = scrollerRef.current
      if (!el || el.clientWidth === 0) return
      const i = Math.round(el.scrollLeft / el.clientWidth)
      setIndex(prev => (prev === i ? prev : i))
    })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowRight') { e.preventDefault(); scrollToIndex(Math.min(count - 1, index + 1)) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); scrollToIndex(Math.max(0, index - 1)) }
  }

  function pickFiles() {
    if (disabled) return
    inputRef.current?.click()
  }

  function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const firstNew = count
    api.addFiles(files)
    // เลื่อนไปดูรูปแรกที่เพิ่งเลือก
    scrollAfterUpdate(firstNew)
  }

  function move(id: string, dir: -1 | 1) {
    scrollAfterUpdate(api.moveImage(id, dir))
  }

  function cover(id: string) {
    api.setCover(id)
    scrollAfterUpdate(0)
  }

  async function remove(id: string, n: number) {
    if (!confirm(`ลบรูปที่ ${n} ออกจากสินค้านี้?`)) return
    await api.deleteImage(id)
  }

  const imageCount = api.images.length
  const busyQueue = api.queue.filter(q => q.status !== 'error').length

  return (
    <section
      className={`card p-4 sm:p-5 space-y-3 min-w-0 ${dragOver ? 'ring-4 ring-strawberry' : ''}`}
      aria-labelledby="pf-sec-images"
      onDragOver={e => { if (disabled) return; e.preventDefault(); setDragOver(true) }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false) }}
      onDrop={e => {
        if (disabled) return
        e.preventDefault()
        setDragOver(false)
        onFiles(e.dataTransfer.files)
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="pf-sec-images" className="section-title">
          <span className="icon-bubble icon-bubble-sm"><ImagePlus {...ICON_SM} /></span>
          รูปสินค้า
        </h2>
        <span className="text-xs text-gray-500 tabular-nums">
          {imageCount} รูป{busyQueue > 0 ? ` · รอ ${busyQueue}` : ''}
        </span>
      </div>

      {current === null ? (
        // ยังไม่มีรูป
        <button
          type="button"
          onClick={pickFiles}
          disabled={disabled}
          className="mx-auto flex h-48 w-full max-w-md flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-strawberry bg-blush-soft px-4 text-center text-sm text-gray-600 transition-colors active:bg-blush disabled:cursor-not-allowed disabled:opacity-60 sm:h-56"
        >
          <span className="icon-bubble icon-bubble-lg"><Shirt size={30} strokeWidth={1.8} aria-hidden="true" /></span>
          <span className="font-display text-base font-semibold text-gray-900">ยังไม่มีรูปสินค้า</span>
          <span>แตะเพื่อเลือกรูป หรือถ่ายรูปจากกล้อง</span>
        </button>
      ) : (
        <div className="mx-auto w-full max-w-md space-y-3">
          {/* ภาพใหญ่: เลื่อนข้างแบบหยุดทีละรูป */}
          <div className="relative">
            <div
              ref={scrollerRef}
              onScroll={onScroll}
              onKeyDown={onKeyDown}
              tabIndex={0}
              role="region"
              aria-roledescription="แกลเลอรี"
              aria-label={`รูปสินค้า ${count} รูป — ใช้ปุ่มลูกศรซ้ายขวาเพื่อเลื่อน`}
              className="flex aspect-square w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-3xl bg-blush-soft scrollbar-none focus-visible:outline-offset-2"
            >
              {slides.map((s, i) => (
                <div
                  key={s.key}
                  className="relative h-full w-full shrink-0 snap-center snap-always"
                  role="group"
                  aria-roledescription="รูป"
                  aria-label={`รูปที่ ${i + 1} จาก ${count}`}
                >
                  {broken[s.key] ? (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-sm text-gray-500">
                      <ImageOff size={32} strokeWidth={1.6} aria-hidden="true" />
                      {s.kind === 'queued' ? <span className="max-w-[80%] truncate">{s.item.name}</span> : 'โหลดรูปไม่ได้'}
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.src}
                      alt={alt(i + 1)}
                      loading={i === 0 ? 'eager' : 'lazy'}
                      decoding="async"
                      draggable={false}
                      onError={() => setBroken(b => ({ ...b, [s.key]: true }))}
                      className={`h-full w-full select-none object-contain ${s.kind === 'queued' ? 'opacity-70' : ''}`}
                    />
                  )}
                  {s.kind === 'image' && s.index === 0 && (
                    <span className="chip-strong absolute left-3 top-3 pointer-events-none">
                      <Star size={14} strokeWidth={2.2} aria-hidden="true" />
                      รูปปก
                    </span>
                  )}
                  {s.kind === 'queued' && (
                    <div className="absolute inset-x-3 bottom-3 rounded-2xl bg-white/95 px-3 py-2 shadow-soft-sm space-y-1.5">
                      <p className={`flex items-center gap-1.5 text-xs font-medium ${s.item.status === 'error' ? 'text-red-700' : 'text-gray-700'}`}>
                        {s.item.status === 'error'
                          ? <AlertCircle size={14} strokeWidth={2} aria-hidden="true" />
                          : s.item.status === 'pending'
                            ? <ImagePlus size={14} strokeWidth={2} aria-hidden="true" />
                            : <Loader2 size={14} strokeWidth={2} aria-hidden="true" className="animate-spin" />}
                        <span className="min-w-0 break-words">{queueText(s.item, waitingForSave)}</span>
                      </p>
                      <ProgressBar item={s.item} />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* ตัวนับ + ลูกศร (มือถือใช้ปัดนิ้ว) */}
            <span className="chip absolute right-3 top-3 pointer-events-none tabular-nums" aria-hidden="true">
              {Math.min(index, count - 1) + 1}/{count}
            </span>
            {count > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => scrollToIndex(Math.max(0, index - 1))}
                  disabled={index <= 0}
                  className="btn-icon absolute left-2 top-[calc(50%-22px)] hidden sm:inline-grid shadow-soft-sm disabled:hidden"
                  aria-label="ดูรูปก่อนหน้า"
                >
                  <ChevronLeft {...ICON} />
                </button>
                <button
                  type="button"
                  onClick={() => scrollToIndex(Math.min(count - 1, index + 1))}
                  disabled={index >= count - 1}
                  className="btn-icon absolute right-2 top-[calc(50%-22px)] hidden sm:inline-grid shadow-soft-sm disabled:hidden"
                  aria-label="ดูรูปถัดไป"
                >
                  <ChevronRight {...ICON} />
                </button>
              </>
            )}
          </div>

          {/* แถบรูปย่อ */}
          {count > 1 && (
            <div className="flex gap-2 overflow-x-auto overscroll-x-contain scrollbar-none py-1" aria-label="รูปย่อ">
              {slides.map((s, i) => {
                const on = i === Math.min(index, count - 1)
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => scrollToIndex(i)}
                    aria-label={`ดูรูปที่ ${i + 1}${s.kind === 'image' && s.index === 0 ? ' (รูปปก)' : ''}`}
                    aria-current={on ? 'true' : undefined}
                    className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border-2 bg-blush-soft transition-colors ${on ? 'border-brand-600' : 'border-transparent'}`}
                  >
                    {broken[s.key] ? (
                      <span className="grid h-full w-full place-items-center text-gray-400"><ImageOff size={18} strokeWidth={1.8} aria-hidden="true" /></span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.src} alt="" loading="lazy" decoding="async" draggable={false}
                        className={`h-full w-full object-cover ${s.kind === 'queued' ? 'opacity-60' : ''}`} />
                    )}
                    {s.kind === 'image' && s.index === 0 && (
                      <span className="absolute left-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-white" aria-hidden="true">
                        <Star size={11} strokeWidth={2.4} />
                      </span>
                    )}
                    {s.kind === 'queued' && (
                      <span className="absolute inset-0 grid place-items-center" aria-hidden="true">
                        {s.item.status === 'error'
                          ? <XCircle size={20} strokeWidth={2} className="text-red-600" />
                          : s.item.status === 'pending'
                            ? null
                            : <Loader2 size={20} strokeWidth={2} className="animate-spin text-brand-700" />}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {/* คำสั่งของรูปที่กำลังดู */}
          {current && current.kind === 'image' && (
            <div className="flex flex-wrap items-center gap-2">
              {current.index === 0 ? (
                <span className="chip">
                  <Star size={14} strokeWidth={2.2} aria-hidden="true" />
                  รูปนี้เป็นรูปปก
                </span>
              ) : (
                <button type="button" className="btn-secondary px-4" disabled={disabled} onClick={() => cover(current.id)}>
                  <Star {...ICON_SM} />
                  ตั้งเป็นรูปปก
                </button>
              )}
              <div className="ml-auto flex items-center gap-2">
                <button type="button" className="btn-icon" disabled={disabled || current.index === 0}
                  onClick={() => move(current.id, -1)} aria-label="ย้ายรูปนี้ไปทางซ้าย (ขึ้นก่อน)">
                  <MoveLeft {...ICON_SM} />
                </button>
                <button type="button" className="btn-icon" disabled={disabled || current.index >= imageCount - 1}
                  onClick={() => move(current.id, 1)} aria-label="ย้ายรูปนี้ไปทางขวา (ขึ้นทีหลัง)">
                  <MoveRight {...ICON_SM} />
                </button>
                <button type="button" className="btn-icon btn-icon-danger" disabled={disabled || !!api.deleting[current.id]}
                  onClick={() => remove(current.id, current.index + 1)} aria-label={`ลบรูปที่ ${current.index + 1}`}>
                  {api.deleting[current.id] ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Trash2 {...ICON_SM} />}
                </button>
              </div>
            </div>
          )}
          {current && current.kind === 'queued' && (current.item.status === 'pending' || current.item.status === 'error') && (
            <div className="flex flex-wrap items-center gap-2">
              {current.item.status === 'error' && groupId && (
                <button type="button" className="btn-secondary px-4" disabled={disabled} onClick={() => api.retryItem(current.item.key)}>
                  <RotateCcw {...ICON_SM} />
                  ลองอัปโหลดใหม่
                </button>
              )}
              <button type="button" className="btn-ghost ml-auto px-4" disabled={disabled} onClick={() => api.removeItem(current.item.key)}>
                <X {...ICON_SM} />
                เอารูปนี้ออก
              </button>
            </div>
          )}
        </div>
      )}

      {/* เพิ่มรูป */}
      <div className="space-y-1.5">
        {count > 0 && (
          <button type="button" onClick={pickFiles} disabled={disabled} className="btn-dashed w-full">
            <ImagePlus {...ICON_SM} />
            เพิ่มรูป
          </button>
        )}
        <p className="text-xs text-gray-500 text-center">
          เลือกได้หลายรูปพร้อมกัน ไม่จำกัดจำนวน · ระบบย่อรูปให้อัตโนมัติ
          {waitingForSave && ' · รูปจะอัปโหลดทันทีหลังกดบันทึกสินค้า'}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={e => {
            onFiles(e.target.files)
            e.target.value = '' // เลือกรูปเดิมซ้ำได้
          }}
        />
      </div>

      {api.error && (
        <div role="alert" className="alert-err">
          <XCircle {...ICON_SM} />
          <p className="min-w-0 flex-1 break-words">{api.error}</p>
          <button type="button" className="btn-icon btn-icon-plain -my-2 -mr-2" onClick={api.clearError} aria-label="ปิดข้อความ">
            <X {...ICON_SM} />
          </button>
        </div>
      )}
      {api.notice && (
        <p role="status" className="flex items-center justify-center gap-1.5 text-xs font-medium text-green-700">
          <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" />
          {api.notice}
        </p>
      )}
    </section>
  )
}
