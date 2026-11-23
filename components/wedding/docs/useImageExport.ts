'use client'
// ===== hook ส่งกล่อง HTML เป็นรูป: แชร์ (แผ่นแชร์ของเครื่อง → LINE) / บันทึกรูป / คัดลอกรูป =====
// ใช้ใน DocumentCenter (เอกสารการจอง) และใช้ซ้ำได้กับรูปอื่นของร้าน b.oncloud (เช่น รูปตารางงานวันนี้ในปฏิทิน)
// - สร้างรูปเตรียมไว้เองหลังเนื้อหานิ่ง ~0.9 วินาที (autoPrepare) → กด "แชร์" แล้วแผ่นแชร์เปิดทันที
//   (เบราว์เซอร์ยอมเปิดแผ่นแชร์เฉพาะช่วงสั้นๆ หลังการกด — ถ้าต้องรอสร้างรูปนาน Safari จะปฏิเสธ)
// - รูปผูกกับ signature ของเนื้อหา: เปลี่ยนตัวเลือก/ข้อมูล = รูปเดิมใช้ไม่ได้ สร้างใหม่ ; รูปที่สร้างเสร็จหลังเนื้อหาเปลี่ยน = ทิ้ง
// - กันกดซ้ำ (busyRef) · ข้อความผลลัพธ์ภาษาไทยสำหรับแสดงใน aria-live
// - เบราว์เซอร์ในแอป LINE/ดาวน์โหลดไม่ได้ → result = data URL ของรูป ให้หน้าแสดงรูปให้กดค้างบันทึกเอง
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  blobToDataUrl, canCopyImage, canShareFiles, copyImage, downloadBlob, isInAppBrowser, isWebKit, renderNodeToPng,
  safeFileName, shareOrDownload,
} from '@/lib/exportImage'

export type ExportTone = 'ok' | 'info' | 'warn' | 'err'
export interface ExportMessage {
  tone: ExportTone
  text: string
}

export interface ImageExportOptions {
  /** กล่องที่จะแปลงเป็นรูป (อ่านตอนสร้างรูปทุกครั้ง) */
  getNode: () => HTMLElement | null
  /** ชื่อไฟล์ (ไม่ต้องมี .png — ระบบแปลงเป็นตัวอักษรละตินที่ปลอดภัยให้) */
  fileBase: string
  /** ลายเซ็นของเนื้อหาในกล่อง — เปลี่ยนเมื่อไร รูปเดิมใช้ไม่ได้ */
  signature: string
  /** เนื้อหาพร้อมแปลงเป็นรูปแล้ว (โลโก้/QR โหลดเสร็จ) */
  ready: boolean
  /** สร้างรูปเตรียมไว้อัตโนมัติ (ค่าเริ่มต้น true) */
  autoPrepare?: boolean
  /** ความละเอียดรูป (ค่าเริ่มต้น 1.5 — กว้าง 1080 CSS px → ไฟล์ 1620 px) */
  pixelRatio?: number
}

export interface ImageExport {
  /** กำลังสร้างรูป (เบื้องหลังหรือจากการกด) */
  preparing: boolean
  /** กำลังทำงานจากการกดปุ่ม (ปุ่มอื่นรอ) */
  busy: boolean
  /** ปุ่มที่กำลังทำงาน */
  action: 'share' | 'download' | 'copy' | null
  /** มีรูปของเนื้อหาปัจจุบันพร้อมแล้ว */
  hasImage: boolean
  message: ExportMessage | null
  clearMessage(): void
  /** รูปให้กดค้างบันทึก (data URL) — null = ไม่ต้องแสดง */
  result: string | null
  clearResult(): void
  /** แชร์ไฟล์ได้ / คัดลอกรูปได้ (ตรวจหลัง mount — ก่อนนั้น false) */
  canShare: boolean
  canCopy: boolean
  share(): Promise<void>
  download(): Promise<void>
  copy(): Promise<void>
  /** รูปของเนื้อหาปัจจุบัน (สร้างใหม่ถ้ายังไม่มี) — throw ข้อความไทยเมื่อสร้างไม่ได้ */
  getBlob(): Promise<Blob>
}

const PREPARE_DELAY_MS = 900

function errorText(err: unknown): string {
  return err instanceof Error && /[฀-๿]/.test(err.message) ? err.message : 'สร้างรูปไม่สำเร็จ ลองใหม่อีกครั้ง'
}

export function useImageExport(o: ImageExportOptions): ImageExport {
  const { signature, ready, autoPrepare = true } = o
  const pixelRatio = o.pixelRatio ?? 1.5
  const fileName = safeFileName(o.fileBase)

  const getNodeRef = useRef(o.getNode)
  getNodeRef.current = o.getNode
  const sigRef = useRef(signature)
  sigRef.current = signature
  const cacheRef = useRef<{ sig: string; blob: Blob } | null>(null)
  const inflightRef = useRef<{ sig: string; promise: Promise<Blob> } | null>(null)
  const activeRef = useRef(0)
  const busyRef = useRef(false)
  const aliveRef = useRef(true)

  const [preparing, setPreparing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [action, setAction] = useState<ImageExport['action']>(null)
  const [readySig, setReadySig] = useState<string | null>(null)
  const [message, setMessage] = useState<ExportMessage | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [caps, setCaps] = useState({ share: false, copy: false })

  useEffect(() => {
    aliveRef.current = true
    setCaps({ share: canShareFiles(), copy: canCopyImage() })
    return () => {
      aliveRef.current = false
    }
  }, [])

  // สร้างรูปของเนื้อหา sig (ซ้ำกับที่กำลังสร้างอยู่ = รอผลเดียวกัน) — เก็บผลเฉพาะเมื่อเนื้อหายังเป็น sig เดิม
  const generate = useCallback((sig: string): Promise<Blob> => {
    if (cacheRef.current?.sig === sig) return Promise.resolve(cacheRef.current.blob)
    if (inflightRef.current?.sig === sig) return inflightRef.current.promise
    const node = getNodeRef.current()
    if (!node) return Promise.reject(new Error('ยังไม่พร้อมสร้างรูป รอสักครู่แล้วลองใหม่'))
    activeRef.current += 1
    setPreparing(true)
    const promise = renderNodeToPng(node, { pixelRatio, backgroundColor: '#FFFFFF' })
      .then(blob => {
        if (sigRef.current === sig) {
          cacheRef.current = { sig, blob }
          if (aliveRef.current) setReadySig(sig)
        }
        return blob
      })
      .finally(() => {
        if (inflightRef.current?.promise === promise) inflightRef.current = null
        activeRef.current = Math.max(0, activeRef.current - 1)
        if (aliveRef.current && activeRef.current === 0) setPreparing(false)
      })
    inflightRef.current = { sig, promise }
    return promise
  }, [pixelRatio])

  // รูปของเนื้อหาปัจจุบัน: ถ้าเนื้อหาเปลี่ยนระหว่างสร้าง → สร้างใหม่อีกรอบ (ไม่ส่งรูปที่ไม่ตรงกับหน้าจอ)
  const getBlob = useCallback(async (): Promise<Blob> => {
    for (let i = 0; i < 3; i++) {
      const sig = sigRef.current
      const blob = await generate(sig)
      if (sigRef.current === sig) return blob
    }
    throw new Error('เนื้อหาเปลี่ยนระหว่างสร้างรูป ลองกดอีกครั้ง')
  }, [generate])

  // เนื้อหาเปลี่ยน → รูปเดิมใช้ไม่ได้ + ล้างรูปให้กดค้าง ; เนื้อหานิ่ง → สร้างรูปเตรียมไว้
  useEffect(() => {
    if (cacheRef.current && cacheRef.current.sig !== signature) cacheRef.current = null
    setResult(null)
    if (!ready || !autoPrepare) return
    const t = window.setTimeout(() => {
      generate(signature).catch(() => {
        // สร้างเบื้องหลังไม่สำเร็จ: เงียบไว้ — ตอนกดปุ่มจะลองใหม่และแจ้งข้อผิดพลาดเอง
      })
    }, PREPARE_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [signature, ready, autoPrepare, generate])

  // เนื้อหาเปลี่ยน (เปลี่ยนชนิดเอกสาร/คิว/ใบเสร็จ/ตัวเลือก) → ล้างข้อความผลครั้งก่อนด้วย
  // ไม่งั้น "บันทึกรูปแล้ว" ของเอกสารเดิมค้างอยู่ ดูเหมือนเอกสารใหม่บันทึกไปแล้ว (แม้ปุ่มส่งออกจะกดไม่ได้)
  const shownSigRef = useRef(signature)
  useEffect(() => {
    if (shownSigRef.current === signature) return
    shownSigRef.current = signature
    setMessage(null)
  }, [signature])

  const cachedBlob = (): Blob | null => (cacheRef.current?.sig === sigRef.current ? cacheRef.current.blob : null)

  async function showResult(blob: Blob) {
    try {
      const url = await blobToDataUrl(blob)
      if (aliveRef.current) setResult(url)
    } catch {
      // แสดงรูปไม่ได้ ไม่เป็นไร (ข้อความแจ้งแล้ว)
    }
  }

  // ครอบการกดปุ่ม: กันกดซ้ำ + สถานะ busy
  async function run(kind: NonNullable<ImageExport['action']>, fn: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setAction(kind)
    setMessage(null)
    try {
      await fn()
    } catch (err) {
      if (aliveRef.current) setMessage({ tone: 'err', text: errorText(err) })
    } finally {
      busyRef.current = false
      if (aliveRef.current) {
        setBusy(false)
        setAction(null)
      }
    }
  }

  const share = () => run('share', async () => {
    const cached = cachedBlob()
    const blob = cached ?? (await getBlob())
    // รูปที่เพิ่งสร้าง (รอนาน) → เบราว์เซอร์อาจไม่ยอมเปิดแผ่นแชร์ → ให้กดอีกครั้ง แทนการดาวน์โหลดเอง
    const r = await shareOrDownload(blob, fileName, undefined, { fallbackDownload: cached !== null })
    if (!aliveRef.current) return
    if (r === 'shared') setMessage({ tone: 'ok', text: 'แชร์รูปเรียบร้อย' })
    else if (r === 'cancelled') setMessage(null)
    else if (r === 'blocked') setMessage({ tone: 'info', text: 'รูปพร้อมแล้ว — กด "แชร์" อีกครั้งเพื่อเลือก LINE' })
    else if (r === 'downloaded') {
      if (isInAppBrowser()) {
        await showResult(blob)
        setMessage({ tone: 'info', text: 'ถ้าไม่พบรูปในเครื่อง ให้กดค้างที่รูปด้านล่างแล้วเลือก "บันทึกรูปภาพ" หรือ "แชร์"' })
      } else {
        setMessage({ tone: 'ok', text: 'เครื่องนี้แชร์ไฟล์โดยตรงไม่ได้ — บันทึกรูปลงเครื่องแล้ว แนบรูปในแชทได้เลย' })
      }
    } else {
      await showResult(blob)
      setMessage({ tone: 'warn', text: 'แชร์/บันทึกอัตโนมัติไม่ได้ — กดค้างที่รูปด้านล่างแล้วเลือกบันทึกหรือแชร์' })
    }
  })

  const download = () => run('download', async () => {
    const blob = cachedBlob() ?? (await getBlob())
    const ok = downloadBlob(blob, fileName)
    if (!aliveRef.current) return
    if (!ok || isInAppBrowser()) {
      await showResult(blob)
      setMessage({
        tone: ok ? 'info' : 'warn',
        text: ok
          ? 'ถ้าไม่พบรูปในเครื่อง ให้กดค้างที่รูปด้านล่างแล้วเลือก "บันทึกรูปภาพ"'
          : 'บันทึกอัตโนมัติไม่ได้ — กดค้างที่รูปด้านล่างแล้วเลือก "บันทึกรูปภาพ"',
      })
      return
    }
    setMessage({
      tone: 'ok',
      text: isWebKit() && canShareFiles()
        ? 'บันทึกไฟล์แล้ว (แอปไฟล์) — ถ้าต้องการเก็บในแอปรูปภาพ กด "แชร์" แล้วเลือก "บันทึกภาพ"'
        : 'บันทึกรูปแล้ว (ดูในโฟลเดอร์ดาวน์โหลด)',
    })
  })

  const copy = () => run('copy', async () => {
    if (!canCopyImage()) {
      setMessage({ tone: 'warn', text: 'เบราว์เซอร์นี้คัดลอกรูปไม่ได้ — ใช้ปุ่ม "แชร์" หรือ "บันทึกรูป" แทน' })
      return
    }
    // ส่ง Promise ให้ ClipboardItem ทันทีตอนกด (Safari ต้องเริ่มเขียนคลิปบอร์ดภายในการกด แล้วใส่รูปตามมาได้)
    const cached = cachedBlob()
    const r = await copyImage(cached ?? getBlob())
    if (!aliveRef.current) return
    if (r === 'copied') setMessage({ tone: 'ok', text: 'คัดลอกรูปแล้ว — วางในช่องแชท (กด Ctrl+V / กดค้างแล้ววาง) ได้ทันที' })
    else setMessage({ tone: 'warn', text: 'คัดลอกรูปไม่สำเร็จ — ใช้ปุ่ม "แชร์" หรือ "บันทึกรูป" แทน' })
  })

  return {
    preparing,
    busy,
    action,
    hasImage: readySig === signature && cacheRef.current?.sig === signature,
    message,
    clearMessage: () => setMessage(null),
    result,
    clearResult: () => setResult(null),
    canShare: caps.share,
    canCopy: caps.copy,
    share,
    download,
    copy,
    getBlob,
  }
}
