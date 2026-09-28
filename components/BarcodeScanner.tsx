'use client'
import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Html5Qrcode } from 'html5-qrcode'
import { normalizeScannedCode } from '@/lib/barcode'
import { thaiError } from '@/lib/format'

// ผลลัพธ์ที่ onScan ส่งกลับมาให้แสดงในหน้าต่างสแกน (ส่ง void ได้ถ้าไม่ต้องการแสดงอะไร)
export interface ScanFeedback { ok: boolean; message: string }

interface BarcodeScannerProps {
  onScan: (code: string) => ScanFeedback | void
  onClose: () => void
  title?: string
  closeOnSuccess?: boolean
}

type FeedbackState = { kind: 'ok' | 'error' | 'info'; message: string }

const SAME_CODE_MS = 2000 // รหัสเดิมจากกล้อง ต้องหายจากภาพครบ 2 วิ ถึงนับซ้ำ
const FEEDBACK_MS = 2500 // ข้อความผลสแกนหายเองหลัง 2.5 วิ

const MSG_PERMISSION = 'ไม่ได้รับอนุญาตให้ใช้กล้อง — เปิดสิทธิ์กล้องในการตั้งค่าเบราว์เซอร์ หรือพิมพ์รหัสด้านล่าง'
const MSG_NO_CAMERA = 'ไม่พบกล้องในเครื่องนี้ — พิมพ์รหัสหรือใช้เครื่องสแกนด้านล่าง'
const MSG_HTTPS = 'ต้องเปิดผ่าน https เพื่อใช้กล้อง'
const MSG_BUSY = 'กล้องถูกแอปอื่นใช้งานอยู่ — ปิดแอปนั้นแล้วลองใหม่ หรือพิมพ์รหัสด้านล่าง'
const MSG_UNSUPPORTED = 'เบราว์เซอร์นี้เปิดกล้องไม่ได้ — พิมพ์รหัสหรือใช้เครื่องสแกนด้านล่าง'
const MSG_CAMERA_FAILED = 'เปิดกล้องไม่ได้ — พิมพ์รหัสหรือใช้เครื่องสแกนด้านล่าง'

function isScanFeedback(v: unknown): v is ScanFeedback {
  return typeof v === 'object' && v !== null && typeof (v as { ok?: unknown }).ok === 'boolean'
}

// html5-qrcode ส่ง error มาเป็นสตริง เช่น 'Error getting userMedia, error = NotAllowedError: Permission denied'
function cameraErrorText(e: unknown): string {
  let text = ''
  if (typeof e === 'string') {
    text = e
  } else if (e && typeof e === 'object') {
    const o = e as { name?: unknown; message?: unknown }
    text = `${typeof o.name === 'string' ? o.name : ''}: ${typeof o.message === 'string' ? o.message : ''}`
  } else {
    text = String(e ?? '')
  }

  if (/NotAllowed|Permission|denied|SecurityError/i.test(text)) return MSG_PERMISSION
  if (/NotFound|DevicesNotFound|device not found|Overconstrained|no camera/i.test(text)) return MSG_NO_CAMERA
  if (/NotReadable|TrackStart|Could not start|in use/i.test(text)) return MSG_BUSY
  if (/secure context|https/i.test(text)) return MSG_HTTPS
  if (/not supported|mediaDevices/i.test(text)) {
    return typeof window !== 'undefined' && window.isSecureContext === false ? MSG_HTTPS : MSG_UNSUPPORTED
  }
  return MSG_CAMERA_FAILED
}

export default function BarcodeScanner({ onScan, onClose, title, closeOnSuccess }: BarcodeScannerProps) {
  // id คงที่ตลอดอายุ component และไม่มี ':' (html5-qrcode หา element ด้วย getElementById)
  const reactId = useId()
  const scannerIdRef = useRef('bcscan-' + reactId.replace(/[^A-Za-z0-9_-]/g, ''))
  const scannerId = scannerIdRef.current
  const titleId = scannerId + '-title'

  const [cameraError, setCameraError] = useState('')
  const [cameraReady, setCameraReady] = useState(false)
  const [feedback, setFeedback] = useState<FeedbackState | null>(null)
  const [manual, setManual] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)

  // เก็บ callback ล่าสุดไว้ใน ref — กล้องเปิดครั้งเดียวต่อการ mount ไม่ผูกกับ onScan
  const onScanRef = useRef(onScan)
  const onCloseRef = useRef(onClose)
  const closeOnSuccessRef = useRef(Boolean(closeOnSuccess))
  const closingRef = useRef(false)
  const lastCodeRef = useRef('')
  const lastTimeRef = useRef(0)
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    onScanRef.current = onScan
    onCloseRef.current = onClose
    closeOnSuccessRef.current = Boolean(closeOnSuccess)
  })

  function showFeedback(next: FeedbackState) {
    setFeedback(next)
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = setTimeout(() => {
      feedbackTimerRef.current = null
      setFeedback(null)
    }, FEEDBACK_MS)
  }

  // ปิดหน้าต่าง — หลังสั่งปิดแล้วจะไม่ส่งรหัสใดๆ ให้หน้าหลักอีก
  function requestClose() {
    closingRef.current = true
    onCloseRef.current()
  }

  // ส่งรหัสให้หน้าที่เรียกใช้ แล้วแสดงผลที่ได้กลับมา (ใช้แต่ ref + setState จึงเรียกจาก callback ของกล้องได้เสมอ)
  function deliver(code: string) {
    if (!code || closingRef.current) return
    let res: unknown
    try {
      res = onScanRef.current(code)
    } catch (e) {
      showFeedback({ kind: 'error', message: thaiError(e) })
      return
    }
    if (!isScanFeedback(res)) {
      showFeedback({ kind: 'info', message: `อ่านรหัส: ${code}` })
      return
    }
    const message = typeof res.message === 'string' && res.message ? res.message : (res.ok ? 'สำเร็จ' : 'ไม่สำเร็จ')
    showFeedback({ kind: res.ok ? 'ok' : 'error', message })
    if (res.ok) {
      try { navigator.vibrate?.(80) } catch { /* บางเบราว์เซอร์ไม่รองรับ */ }
      if (closeOnSuccessRef.current) requestClose()
    }
  }

  const deliverRef = useRef(deliver)
  const requestCloseRef = useRef(requestClose)
  useEffect(() => {
    deliverRef.current = deliver
    requestCloseRef.current = requestClose
  })

  // ===== กล้อง: เปิดครั้งเดียวต่อการ mount =====
  useEffect(() => {
    let cancelled = false
    let scanner: Html5Qrcode | null = null
    let startPromise: Promise<unknown> | null = null
    let states: { SCANNING: number; PAUSED: number } | null = null

    function onDecoded(decodedText: string) {
      if (cancelled) return
      const code = normalizeScannedCode(decodedText)
      if (!code) return
      const now = Date.now()
      if (code === lastCodeRef.current && now - lastTimeRef.current < SAME_CODE_MS) {
        // ยังเห็นรหัสเดิมอยู่ → ต่อเวลาออกไป ต้องหายจากกล้องครบ 2 วิ ถึงนับเป็นการสแกนใหม่
        // (ไม่งั้นถือกล้องค้างไว้ที่เสื้อตัวเดียว จะถูกเพิ่มเข้าตะกร้าซ้ำทุก 2 วิ)
        lastTimeRef.current = now
        return
      }
      lastCodeRef.current = code
      lastTimeRef.current = now
      deliverRef.current(code)
    }

    async function start() {
      if (window.isSecureContext === false) {
        setCameraError(MSG_HTTPS)
        return
      }
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        setCameraError(MSG_UNSUPPORTED)
        return
      }
      try {
        const mod = await import('html5-qrcode')
        if (cancelled) return
        const F = mod.Html5QrcodeSupportedFormats
        states = { SCANNING: mod.Html5QrcodeScannerState.SCANNING, PAUSED: mod.Html5QrcodeScannerState.PAUSED }
        const instance = new mod.Html5Qrcode(scannerIdRef.current, {
          formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.QR_CODE],
          verbose: false,
        })
        scanner = instance
        const p = instance.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            // กรอบสแกนแนวนอน เหมาะกับบาร์โค้ด 1D (ขั้นต่ำ 50px ตามที่ไลบรารีบังคับ ไม่งั้นมัน throw)
            qrbox: (w: number, h: number) => ({
              width: Math.max(50, Math.floor(Math.min(w * 0.9, 360))),
              height: Math.max(50, Math.floor(Math.min(h * 0.45, 180))),
            }),
          },
          onDecoded,
          () => { /* เฟรมนี้ไม่เจอรหัส — ปกติ */ },
        )
        startPromise = p
        await p
        if (!cancelled) setCameraReady(true)
      } catch (e) {
        if (!cancelled) setCameraError(cameraErrorText(e))
      }
    }

    start().catch(() => { /* จัดการใน start แล้ว */ })

    return () => {
      cancelled = true
      const s = scanner
      if (!s) return
      const stop = () => {
        try {
          const state = s.getState()
          if (states && (state === states.SCANNING || state === states.PAUSED)) {
            s.stop()
              .then(() => { try { s.clear() } catch { /* ignore */ } })
              .catch(() => { /* ignore */ })
          }
        } catch { /* ignore */ }
      }
      // รอให้การเปิดกล้องจบก่อน (สำเร็จหรือล้มเหลวก็ได้) แล้วค่อยปิด — ไม่ throw ออกไปเด็ดขาด
      if (startPromise) startPromise.then(stop, stop).catch(() => { /* ignore */ })
      else stop()
    }
  }, [])

  // ===== ล็อกการเลื่อนหน้าหลัง, Esc ปิด, โฟกัสช่องพิมพ์เฉพาะเครื่องที่มีเมาส์ =====
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        requestCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    try {
      // มือถือไม่โฟกัส เพื่อไม่ให้คีย์บอร์ดเด้งขึ้นมาบังกล้อง
      if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches) {
        inputRef.current?.focus()
      }
    } catch { /* ignore */ }

    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKeyDown)
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current)
        feedbackTimerRef.current = null
      }
    }
  }, [])

  function handleManualSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const code = normalizeScannedCode(manual)
    setManual('')
    if (code) deliver(code) // พิมพ์เอง/เครื่องสแกน USB ไม่หน่วงรหัสซ้ำ
    inputRef.current?.focus()
  }

  const feedbackClass =
    feedback?.kind === 'ok' ? 'bg-green-50 text-green-700 border-green-200'
      : feedback?.kind === 'error' ? 'bg-red-50 text-red-700 border-red-200'
        : 'bg-gray-50 text-gray-700 border-gray-200'

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-xl pb-[env(safe-area-inset-bottom)]"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-gray-100 bg-white pl-4 pr-1 py-1">
          <h3 id={titleId} className="font-bold text-gray-900 truncate">{title ?? '📷 สแกนบาร์โค้ด'}</h3>
          <button
            type="button"
            onClick={() => requestClose()}
            aria-label="ปิด"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 p-4">
          {cameraError && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{cameraError}</div>
          )}

          {/* พื้นที่กล้อง — div ที่มี id ห้ามมีลูกที่ React จัดการ เพราะ html5-qrcode ล้าง innerHTML เอง */}
          <div className={cameraError ? 'hidden' : 'relative flex max-h-[45dvh] min-h-[140px] items-center justify-center overflow-hidden rounded-xl bg-black'}>
            <div id={scannerId} className="w-full" />
            {!cameraReady && !cameraError && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white/80">
                กำลังเปิดกล้อง…
              </div>
            )}
          </div>
          {!cameraError && (
            <p className="text-center text-xs text-gray-500">เล็งบาร์โค้ดให้อยู่ในกรอบ — ระบบจะอ่านให้อัตโนมัติ</p>
          )}

          <div aria-live="polite" className="min-h-[2.75rem]">
            {feedback && (
              <div className={`rounded-lg border px-3 py-2 text-center text-sm font-medium break-words ${feedbackClass}`}>
                {feedback.message}
              </div>
            )}
          </div>

          <div className="border-t border-gray-100 pt-3">
            <form onSubmit={handleManualSubmit} className="flex gap-2">
              <input
                ref={inputRef}
                className="input min-h-[44px] min-w-0 flex-1"
                placeholder="พิมพ์บาร์โค้ด / SKU แล้วกด Enter"
                aria-label="บาร์โค้ดหรือ SKU"
                value={manual}
                onChange={e => setManual(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <button type="submit" className="btn-primary min-h-[44px] whitespace-nowrap">
                ตกลง
              </button>
            </form>
            <p className="mt-2 text-xs text-gray-500">💡 ใช้เครื่องสแกน USB/บลูทูธได้ — ยิงรหัสแล้วเครื่องจะกด Enter ให้เอง</p>
          </div>
        </div>
      </div>
    </div>
  )
}
