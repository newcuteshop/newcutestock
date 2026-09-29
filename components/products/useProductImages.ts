'use client'
// ===== รูปสินค้า: คิวอัปโหลด + ลบ + เรียงลำดับ (CONTRACT §3.5-3.7, §4) =====
// - อัปโหลดทีละรูปตามลำดับที่เลือก (รูปแรกที่เลือก = อยู่ก่อน) ย่อรูปในเครื่องก่อนส่งเสมอ
// - คำสั่งที่แก้รายการรูปในฐานข้อมูล (เพิ่ม/ลบ/เรียง) เข้าคิวเดียวกันทีละคำสั่ง ไม่ให้ชนกันเอง
// - สินค้าใหม่ที่ยังไม่บันทึก: เลือกรูปรอไว้ได้ แล้วอัปโหลดทันทีหลังบันทึกสินค้าสำเร็จ (uploadPending)
// - รูปไม่ทำให้ updated_at ของสินค้าเปลี่ยน → ฟอร์มที่เปิดอยู่บันทึกต่อได้ตามปกติ

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { thaiError } from '@/lib/format'
import {
  type ProductImageJson,
  compressImage, parseGroupJson, registerImage, removeProductImageFiles, uploadImageFile,
} from '@/lib/products'

export type QueueStatus = 'pending' | 'compressing' | 'uploading' | 'saving' | 'error'

export type QueueItem = {
  key: string
  file: File
  name: string
  previewUrl: string
  status: QueueStatus
  error: string
  bytes: number // ขนาดหลังย่อ (0 = ยังไม่ได้ย่อ)
}

// สัดส่วนความคืบหน้าของแต่ละขั้น (ย่อรูป → อัปโหลด → บันทึก)
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
  return `q${Date.now().toString(36)}${keySeq}`
}

function sortImages(list: ProductImageJson[]): ProductImageJson[] {
  return list
    .map((img, i) => ({ img, i }))
    .sort((a, b) => a.img.sort_order - b.img.sort_order || a.i - b.i)
    .map(x => x.img)
}

export type UploadSummary = { done: number; failed: number }

export function useProductImages(opts: { groupId: string | null; initialImages: ProductImageJson[] }) {
  const supabase = useMemo(() => createClient(), [])
  const [images, setImagesState] = useState<ProductImageJson[]>(() => sortImages(opts.initialImages))
  const [queue, setQueueState] = useState<QueueItem[]>([])
  const [deleting, setDeleting] = useState<Record<string, boolean>>({})
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const imagesRef = useRef(images)
  const queueRef = useRef(queue)
  const groupIdRef = useRef<string | null>(opts.groupId)
  const chainRef = useRef<Promise<unknown>>(Promise.resolve())
  const loopRef = useRef<Promise<void> | null>(null)
  const orderDirtyRef = useRef(false)
  const mountedRef = useRef(true)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { groupIdRef.current = opts.groupId }, [opts.groupId])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
      // คืนหน่วยความจำรูปตัวอย่างที่ยังค้างในคิว
      for (const q of queueRef.current) URL.revokeObjectURL(q.previewUrl)
    }
  }, [])

  const setImages = useCallback((next: ProductImageJson[] | ((prev: ProductImageJson[]) => ProductImageJson[])) => {
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

  /** โหลดรายการรูปล่าสุดจากฐานข้อมูล (หลังเรียงรูปไม่ผ่าน / รูปถูกลบจากเครื่องอื่น) */
  const reloadImages = useCallback(async () => {
    const gid = groupIdRef.current
    if (!gid) return
    const { data, error: err } = await supabase.rpc('get_product_group', { p_group_id: gid })
    if (err) return
    const g = parseGroupJson(data)
    if (g) setImages(g.images)
  }, [supabase, setImages])

  // ----- อัปโหลดทีละรูปจนคิวหมด -----
  const processItem = useCallback(async (item: QueueItem, gid: string) => {
    patchItem(item.key, { status: 'compressing', error: '' })
    try {
      const img = await compressImage(item.file)
      patchItem(item.key, { status: 'uploading', bytes: img.blob.size })
      const path = await uploadImageFile(supabase, gid, img)
      patchItem(item.key, { status: 'saving' })
      const added = await enqueue(() => registerImage(supabase, gid, path, img))
      setImages(prev => sortImages([...prev.filter(i => i.id !== added.id), {
        id: added.id, path: added.path, sort_order: added.sort_order, width: added.width, height: added.height,
      }]))
      dropItem(item.key)
      return true
    } catch (e) {
      patchItem(item.key, { status: 'error', error: e instanceof Error ? e.message : thaiError(e) })
      return false
    }
  }, [supabase, enqueue, patchItem, dropItem, setImages])

  const runQueue = useCallback((): Promise<void> => {
    if (loopRef.current) return loopRef.current
    const loop = (async () => {
      if (mountedRef.current) setProcessing(true)
      let done = 0
      try {
        for (;;) {
          const gid = groupIdRef.current
          if (!gid || !mountedRef.current) break
          const item = queueRef.current.find(q => q.status === 'pending')
          if (!item) break
          if (await processItem(item, gid)) done += 1
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

  /** เลือกไฟล์รูป (หลายรูปได้) — มีสินค้าแล้วอัปโหลดทันที, สินค้าใหม่ = รอจนกดบันทึก */
  const addFiles = useCallback((files: FileList | File[] | null) => {
    if (!files) return
    const list = Array.from(files)
    const accepted: QueueItem[] = []
    let skipped = 0
    for (const file of list) {
      // บางเครื่องไม่บอกชนิดไฟล์ (type ว่าง) → ลองเปิดดูตอนย่อรูป
      if (file.type && !file.type.startsWith('image/')) { skipped += 1; continue }
      accepted.push({
        key: nextKey(),
        file,
        name: file.name || 'รูปภาพ',
        previewUrl: URL.createObjectURL(file),
        status: 'pending',
        error: '',
        bytes: 0,
      })
    }
    setError(skipped > 0 ? `ข้ามไฟล์ที่ไม่ใช่รูปภาพ ${skipped} ไฟล์` : '')
    if (accepted.length === 0) return
    setQueue(prev => [...prev, ...accepted])
    if (groupIdRef.current) void runQueue()
  }, [setQueue, runQueue])

  /** หลังสร้างสินค้าใหม่สำเร็จ: อัปโหลดรูปที่เลือกรอไว้ทั้งหมด */
  const uploadPending = useCallback(async (gid: string): Promise<UploadSummary> => {
    groupIdRef.current = gid
    const before = queueRef.current.filter(q => q.status === 'pending').length
    await runQueue()
    // ถ้ามีรูปถูกเลือกเพิ่มระหว่างอัปโหลด ลูปเดิมเก็บให้ครบแล้ว — นับเฉพาะที่ยังค้าง/พัง
    const failed = queueRef.current.filter(q => q.status === 'error').length
    return { done: Math.max(0, before - failed), failed }
  }, [runQueue])

  const retryItem = useCallback((key: string) => {
    patchItem(key, { status: 'pending', error: '' })
    if (groupIdRef.current) void runQueue()
  }, [patchItem, runQueue])

  const removeItem = useCallback((key: string) => {
    const item = queueRef.current.find(q => q.key === key)
    if (!item || (item.status !== 'pending' && item.status !== 'error')) return
    dropItem(key)
  }, [dropItem])

  // ----- ลบรูป: RPC ก่อน แล้วค่อยลบไฟล์ -----
  const deleteImage = useCallback(async (id: string): Promise<boolean> => {
    setDeleting(d => ({ ...d, [id]: true }))
    setError('')
    try {
      const path = await enqueue(async () => {
        const { data, error: err } = await supabase.rpc('delete_product_image', { p_image_id: id })
        if (err) throw err
        return typeof data === 'string' ? data : ''
      })
      setImages(prev => prev.filter(i => i.id !== id))
      if (path) void removeProductImageFiles(supabase, [path])
      showNotice('ลบรูปแล้ว')
      return true
    } catch (e) {
      const msg = thaiError(e)
      if (mountedRef.current) setError(msg)
      if (msg.includes('ไม่พบรูปนี้')) void reloadImages()
      return false
    } finally {
      if (mountedRef.current) setDeleting(d => { const n = { ...d }; delete n[id]; return n })
    }
  }, [supabase, enqueue, setImages, showNotice, reloadImages])

  // ----- เรียงรูป: เปลี่ยนบนจอก่อน แล้วส่งลำดับล่าสุดไปบันทึก (กดติดกันหลายครั้ง = ส่งครั้งเดียว) -----
  const syncOrder = useCallback(() => {
    orderDirtyRef.current = true
    enqueue(async () => {
      if (!orderDirtyRef.current) return
      orderDirtyRef.current = false
      const gid = groupIdRef.current
      if (!gid) return
      const ids = imagesRef.current.map(i => i.id)
      const { error: err } = await supabase.rpc('reorder_product_images', { p_group_id: gid, p_ids: ids })
      if (err) throw err
    }).catch(async e => {
      if (mountedRef.current) setError(`เรียงรูปไม่สำเร็จ: ${thaiError(e)}`)
      await reloadImages()
    })
  }, [supabase, enqueue, reloadImages])

  const reorderTo = useCallback((next: ProductImageJson[]) => {
    setError('')
    setImages(next.map((img, i) => ({ ...img, sort_order: i + 1 })))
    syncOrder()
  }, [setImages, syncOrder])

  /** เลื่อนรูป: dir -1 = ไปทางซ้าย (ก่อน), +1 = ไปทางขวา (หลัง) → คืนตำแหน่งใหม่ */
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

  /** ใช้รายการรูปจากฐานข้อมูล (หลังโหลดข้อมูลสินค้าใหม่) */
  const replaceImages = useCallback((list: ProductImageJson[]) => {
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

export type ProductImagesApi = ReturnType<typeof useProductImages>
