'use client'
// ===== รูปชุดเช่า: คิวอัปโหลด + ลบ + เรียงลำดับ (แบบเดียวกับรูปสินค้า components/products/useProductImages.ts) =====
// - อัปโหลดทีละรูปตามลำดับที่เลือก ย่อรูปในเครื่องก่อนส่งเสมอ (lib/rentalImages.ts)
// - คำสั่งที่แก้รายการรูปในฐานข้อมูล (เพิ่ม/ลบ/เรียง) เข้าคิวเดียวกันทีละคำสั่ง ไม่ให้ชนกันเอง
// - ชุดใหม่ที่ยังไม่บันทึก: เลือกรูปรอไว้ได้ แล้วอัปโหลดทันทีหลังบันทึกชุดสำเร็จ (uploadPending)
// - รูปไม่ทำให้ updated_at ของชุดเปลี่ยน → ฟอร์มที่เปิดอยู่บันทึกต่อได้ตามปกติ
// - ฐานข้อมูลรับได้ไม่เกิน 20 รูปต่อชุด → เลือกเกินจะตัดส่วนเกินออกพร้อมบอกผู้ใช้

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { thaiError } from '@/lib/format'
import { parseRentalItem, type RentalItemImage } from '@/lib/rental'
import {
  deleteRentalItemImage, prepareRentalImage, registerRentalImage, uploadRentalImageFile,
} from '@/lib/rentalImages'
import { MAX_ITEM_IMAGES } from './itemFormModel'

export type QueueStatus = 'pending' | 'compressing' | 'uploading' | 'saving' | 'error'

export type QueueItem = {
  key: string
  file: File
  name: string
  previewUrl: string
  status: QueueStatus
  error: string
  bytes: number
  /** ไฟล์ขึ้นถังแล้วแต่ไม่รู้ว่าลงทะเบียนกับชุดสำเร็จไหม (เน็ตหลุดตอนบันทึกรูป) — ลองใหม่จะเช็กก่อน ไม่ให้เกิดรูปซ้ำ */
  path: string | null
}

export const QUEUE_PROGRESS: Record<QueueStatus, number> = {
  pending: 0,
  compressing: 0.12,
  uploading: 0.4,
  saving: 0.88,
  error: 0,
}

let keySeq = 0
function nextKey(): string {
  keySeq += 1
  return `rq${Date.now().toString(36)}${keySeq}`
}

function sortImages(list: RentalItemImage[]): RentalItemImage[] {
  return list
    .map((img, i) => ({ img, i }))
    .sort((a, b) => a.img.sort_order - b.img.sort_order || a.i - b.i)
    .map(x => x.img)
}

export type UploadSummary = { done: number; failed: number }

export function useRentalItemImages(opts: { itemId: string | null; initialImages: RentalItemImage[] }) {
  const supabase = useMemo(() => createClient(), [])
  const [images, setImagesState] = useState<RentalItemImage[]>(() => sortImages(opts.initialImages))
  const [queue, setQueueState] = useState<QueueItem[]>([])
  const [deleting, setDeleting] = useState<Record<string, boolean>>({})
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const imagesRef = useRef(images)
  const queueRef = useRef(queue)
  const itemIdRef = useRef<string | null>(opts.itemId)
  const chainRef = useRef<Promise<unknown>>(Promise.resolve())
  const loopRef = useRef<Promise<void> | null>(null)
  const orderDirtyRef = useRef(false)
  const mountedRef = useRef(true)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { itemIdRef.current = opts.itemId }, [opts.itemId])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
      for (const q of queueRef.current) URL.revokeObjectURL(q.previewUrl)
    }
  }, [])

  const setImages = useCallback((next: RentalItemImage[] | ((prev: RentalItemImage[]) => RentalItemImage[])) => {
    const value = typeof next === 'function' ? next(imagesRef.current) : next
    imagesRef.current = value
    if (mountedRef.current) setImagesState(value)
  }, [])

  const setQueue = useCallback((next: (prev: QueueItem[]) => QueueItem[]) => {
    const value = next(queueRef.current)
    queueRef.current = value
    if (mountedRef.current) setQueueState(value)
  }, [])

  const patchItem = useCallback((key: string, patch: Partial<QueueItem>) => {
    setQueue(prev => prev.map(q => (q.key === key ? { ...q, ...patch } : q)))
  }, [setQueue])

  const dropItem = useCallback((key: string) => {
    setQueue(prev => {
      const item = prev.find(q => q.key === key)
      if (item) URL.revokeObjectURL(item.previewUrl)
      return prev.filter(q => q.key !== key)
    })
  }, [setQueue])

  const showNotice = useCallback((text: string) => {
    if (!mountedRef.current) return
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    setNotice(text)
    noticeTimer.current = setTimeout(() => setNotice(''), 3000)
  }, [])

  // คำสั่งแก้รายการรูปในฐานข้อมูล: ทีละคำสั่งตามลำดับ (คำสั่งก่อนหน้าพังก็ยังทำคำสั่งถัดไป)
  const enqueue = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const run = chainRef.current.catch(() => undefined).then(fn)
    chainRef.current = run.catch(() => undefined)
    return run
  }, [])

  /** โหลดรายการรูปล่าสุด (หลังเรียงรูปไม่ผ่าน / รูปถูกลบจากเครื่องอื่น) → คืนรายการ (โหลดไม่ได้ = null) */
  const reloadImages = useCallback(async (): Promise<RentalItemImage[] | null> => {
    const id = itemIdRef.current
    if (!id) return null
    try {
      const { data, error: err } = await supabase.rpc('rental_get_item', { p_item_id: id })
      if (err) return null
      const item = parseRentalItem(data)
      if (!item) return null
      const list = sortImages(item.images)
      setImages(list)
      return list
    } catch {
      return null
    }
  }, [supabase, setImages])

  const processItem = useCallback(async (item: QueueItem, itemId: string) => {
    // ครั้งก่อนไฟล์ขึ้นถังแล้วแต่คำตอบตอนบันทึกรูปหาย → ดูรายการรูปจริงก่อน มีแล้ว = สำเร็จ (ไม่อัปโหลดซ้ำเป็นรูปที่สอง)
    if (item.path) {
      patchItem(item.key, { status: 'saving', error: '' })
      const list = await reloadImages()
      if (list && list.some(i => i.path === item.path)) {
        dropItem(item.key)
        return true
      }
    }
    patchItem(item.key, { status: 'compressing', error: '', path: null })
    let uploaded: string | null = null
    try {
      const img = await prepareRentalImage(item.file)
      patchItem(item.key, { status: 'uploading', bytes: img.blob.size })
      const path = await uploadRentalImageFile(supabase, itemId, img)
      uploaded = path
      patchItem(item.key, { status: 'saving' })
      const added = await enqueue(() => registerRentalImage(supabase, itemId, path, img))
      // id ว่าง = ฐานข้อมูลตอบรูปแบบที่ไม่คุ้น → โหลดรายการจริงมาแทน
      if (!added.id) await reloadImages()
      else setImages(prev => sortImages([...prev.filter(i => i.id !== added.id && i.path !== added.path), added]))
      dropItem(item.key)
      return true
    } catch (e) {
      patchItem(item.key, { status: 'error', error: e instanceof Error ? e.message : thaiError(e), path: uploaded })
      return false
    }
  }, [supabase, enqueue, patchItem, dropItem, setImages, reloadImages])

  const runQueue = useCallback((): Promise<void> => {
    if (loopRef.current) return loopRef.current
    const loop = (async () => {
      if (mountedRef.current) setProcessing(true)
      let done = 0
      try {
        for (;;) {
          const id = itemIdRef.current
          if (!id || !mountedRef.current) break
          const item = queueRef.current.find(q => q.status === 'pending')
          if (!item) break
          if (await processItem(item, id)) done += 1
        }
      } finally {
        loopRef.current = null
        if (mountedRef.current) setProcessing(false)
        if (done > 0) showNotice(`เพิ่มรูปแล้ว ${done} รูป`)
      }
    })()
    loopRef.current = loop
    return loop
  }, [processItem, showNotice])

  /** เลือกไฟล์รูป (หลายรูปได้) — มีชุดแล้วอัปโหลดทันที, ชุดใหม่ = รอจนกดบันทึก */
  const addFiles = useCallback((files: FileList | File[] | null) => {
    if (!files) return
    const list = Array.from(files)
    const room = Math.max(0, MAX_ITEM_IMAGES - imagesRef.current.length - queueRef.current.length)
    const accepted: QueueItem[] = []
    let skippedType = 0
    let skippedRoom = 0
    for (const file of list) {
      if (file.type && !file.type.startsWith('image/')) { skippedType += 1; continue }
      if (accepted.length >= room) { skippedRoom += 1; continue }
      accepted.push({
        key: nextKey(),
        file,
        name: file.name || 'รูปภาพ',
        previewUrl: URL.createObjectURL(file),
        status: 'pending',
        error: '',
        bytes: 0,
        path: null,
      })
    }
    const notes: string[] = []
    if (skippedType > 0) notes.push(`ข้ามไฟล์ที่ไม่ใช่รูปภาพ ${skippedType} ไฟล์`)
    if (skippedRoom > 0) notes.push(`ชุดหนึ่งแบบมีรูปได้ไม่เกิน ${MAX_ITEM_IMAGES} รูป — ไม่ได้เพิ่ม ${skippedRoom} รูป`)
    setError(notes.join(' · '))
    if (accepted.length === 0) return
    setQueue(prev => [...prev, ...accepted])
    if (itemIdRef.current) void runQueue()
  }, [setQueue, runQueue])

  /** หลังสร้างชุดใหม่สำเร็จ: อัปโหลดรูปที่เลือกรอไว้ทั้งหมด */
  const uploadPending = useCallback(async (itemId: string): Promise<UploadSummary> => {
    itemIdRef.current = itemId
    const before = queueRef.current.filter(q => q.status === 'pending').length
    await runQueue()
    const failed = queueRef.current.filter(q => q.status === 'error').length
    return { done: Math.max(0, before - failed), failed }
  }, [runQueue])

  const retryItem = useCallback((key: string) => {
    patchItem(key, { status: 'pending', error: '' })
    if (itemIdRef.current) void runQueue()
  }, [patchItem, runQueue])

  const removeItem = useCallback((key: string) => {
    const item = queueRef.current.find(q => q.key === key)
    if (!item || (item.status !== 'pending' && item.status !== 'error')) return
    dropItem(key)
    // รูปที่ไม่แน่ใจว่าบันทึกไปแล้วหรือยัง → โหลดรายการจริง (ถ้าบันทึกไปแล้วจะโผล่ในแกลเลอรี ลบได้ตามปกติ)
    if (item.path) void reloadImages()
  }, [dropItem, reloadImages])

  // ลบรูป: RPC ก่อน แล้วค่อยลบไฟล์ (deleteRentalItemImage ทำทั้งสองขั้น)
  const deleteImage = useCallback(async (id: string): Promise<boolean> => {
    setDeleting(d => ({ ...d, [id]: true }))
    setError('')
    try {
      await enqueue(() => deleteRentalItemImage(supabase, id))
      setImages(prev => prev.filter(i => i.id !== id))
      showNotice('ลบรูปแล้ว')
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : thaiError(e)
      if (mountedRef.current) setError(msg)
      if (msg.includes('ไม่พบรูปนี้')) void reloadImages()
      return false
    } finally {
      if (mountedRef.current) setDeleting(d => { const n = { ...d }; delete n[id]; return n })
    }
  }, [supabase, enqueue, setImages, showNotice, reloadImages])

  // เรียงรูป: เปลี่ยนบนจอก่อน แล้วส่งลำดับล่าสุดไปบันทึก (กดติดกันหลายครั้ง = ส่งครั้งเดียว)
  const syncOrder = useCallback(() => {
    orderDirtyRef.current = true
    enqueue(async () => {
      if (!orderDirtyRef.current) return
      orderDirtyRef.current = false
      const id = itemIdRef.current
      if (!id) return
      const ids = imagesRef.current.map(i => i.id).filter(Boolean)
      const { error: err } = await supabase.rpc('rental_reorder_item_images', { p_item_id: id, p_ids: ids })
      if (err) throw err
    }).catch(async e => {
      if (mountedRef.current) setError(`เรียงรูปไม่สำเร็จ: ${thaiError(e)}`)
      await reloadImages()
    })
  }, [supabase, enqueue, reloadImages])

  const reorderTo = useCallback((next: RentalItemImage[]) => {
    setError('')
    setImages(next.map((img, i) => ({ ...img, sort_order: i + 1 })))
    syncOrder()
  }, [setImages, syncOrder])

  /** เลื่อนรูป: -1 = ไปทางซ้าย (ก่อน), +1 = ไปทางขวา (หลัง) → คืนตำแหน่งใหม่ */
  const moveImage = useCallback((id: string, dir: -1 | 1): number => {
    const list = imagesRef.current.slice()
    const i = list.findIndex(x => x.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return i
    const tmp = list[i]
    list[i] = list[j]
    list[j] = tmp
    reorderTo(list)
    return j
  }, [reorderTo])

  /** ตั้งเป็นรูปปก = ย้ายไปไว้หน้าสุด */
  const setCover = useCallback((id: string) => {
    const list = imagesRef.current.slice()
    const i = list.findIndex(x => x.id === id)
    if (i <= 0) return
    const [img] = list.splice(i, 1)
    list.unshift(img)
    reorderTo(list)
    showNotice('ตั้งเป็นรูปปกแล้ว')
  }, [reorderTo, showNotice])

  /** ใช้รายการรูปจากฐานข้อมูล (หลังโหลดข้อมูลชุดใหม่) */
  const replaceImages = useCallback((list: RentalItemImage[]) => {
    setImages(sortImages(list))
  }, [setImages])

  const busyQueue = queue.some(q => q.status === 'compressing' || q.status === 'uploading' || q.status === 'saving')

  return {
    images,
    queue,
    deleting,
    processing: processing || busyQueue,
    pendingCount: queue.filter(q => q.status === 'pending').length,
    failedCount: queue.filter(q => q.status === 'error').length,
    error,
    notice,
    clearError: () => setError(''),
    addFiles,
    uploadPending,
    retryItem,
    removeItem,
    deleteImage,
    moveImage,
    setCover,
    replaceImages,
  }
}

export type RentalItemImagesApi = ReturnType<typeof useRentalItemImages>
