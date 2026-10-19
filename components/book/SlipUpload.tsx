'use client'
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ImagePlus, Loader2, RefreshCw, Upload, X, XCircle } from 'lucide-react'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht } from '@/lib/format'
import { parseMoneyInput } from '@/lib/money'
import { compressImage, newUuid, type CompressedImage } from '@/lib/products'
import { MAX_RENTAL_MONEY, type PublicBooking } from '@/lib/rental'

// ส่งสลิปโอนเงิน (หน้าสถานะการจอง) → POST /api/book/slip
// - ย่อรูปในเครื่องก่อน (ขอบยาวสุด 1600px WebP/JPEG แบบเดียวกับรูปสินค้า) → ไฟล์เล็ก ส่งเร็วบนเน็ตมือถือ
//   และไม่ชนเพดานขนาดคำขอของเซิร์ฟเวอร์ (~4.5 MB)
// - upload_id สุ่มต่อ 1 รูป ใช้ซ้ำทุกครั้งที่กดส่งรูปเดิม → เซิร์ฟเวอร์ไม่บันทึกซ้ำ (ชื่อไฟล์เดียวกัน)
// - กดซ้ำระหว่างส่งไม่ได้ · เน็ตหลุด/ไม่ได้คำตอบ = "ไม่แน่ใจ" → โหลดสถานะการจองใหม่ก่อน: ถ้ามีรายการเพิ่มแล้ว = สำเร็จ
//   ไม่งั้นให้กดส่งอีกครั้ง (ปลอดภัย ไม่ซ้ำ)
// - กฎเบราว์เซอร์ในแอป LINE: ไม่ใส่ capture (ให้ลูกค้าเลือกรูปจากอัลบั้มได้) ไม่ใช้ window.confirm

const MAX_SEND_BYTES = 4 * 1024 * 1024
const MAX_NOTE = 200
const SEND_TIMEOUT_MS = 60000

type Result = { kind: 'ok' | 'err' | 'unsure' | 'checking'; message: string }

export default function SlipUpload({
  token, suggestedAmount, slipsCount, onCheck,
}: {
  token: string
  /** ยอดที่แนะนำให้แจ้ง (มัดจำที่เหลือ / ยอดค้าง) — 0 = ไม่เติมให้ */
  suggestedAmount: number
  /** จำนวนสลิปที่บันทึกแล้วของการจองตอนนี้ (slips_count — ใช้ตรวจตอนไม่แน่ใจว่าส่งสำเร็จไหม) */
  slipsCount: number
  /** โหลดสถานะการจองใหม่ → การจองล่าสุด (null = โหลดไม่ได้) */
  onCheck: () => Promise<PublicBooking | null>
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [img, setImg] = useState<CompressedImage | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [uploadId, setUploadId] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [amountText, setAmountText] = useState(suggestedAmount > 0 ? suggestedAmount.toFixed(2) : '')
  const amountEdited = useRef(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [result, setResult] = useState<Result | null>(null)
  // ส่งแล้วไม่รู้ผล → จำรูป + upload_id ไว้: ลูกค้ากด "เอาออก" แล้วเลือกรูปเดิมอีกครั้ง ยังใช้รหัสเดิม (ระบบไม่บันทึกซ้ำ)
  const unsureRef = useRef<{ fileKey: string; uploadId: string } | null>(null)
  const fileKeyRef = useRef('')

  // ยอดแนะนำเปลี่ยน (ลูกค้าเลือกจ่ายมัดจำ/เต็ม หรือสถานะอัปเดต) และลูกค้ายังไม่ได้แก้ช่องเอง → เติมยอดใหม่
  useEffect(() => {
    if (!amountEdited.current) setAmountText(suggestedAmount > 0 ? suggestedAmount.toFixed(2) : '')
  }, [suggestedAmount])

  // คืนหน่วยความจำรูปตัวอย่าง
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  function clearFile() {
    setImg(null)
    setPreview(null)
    setUploadId('')
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    // ล้างค่าในช่อง → เลือกรูปเดิมซ้ำได้
    e.target.value = ''
    if (!f || busyRef.current) return
    setResult(null)
    setPreparing(true)
    try {
      const c = await compressImage(f)
      if (c.blob.size > MAX_SEND_BYTES) throw new Error('รูปสลิปใหญ่เกินไป กรุณาเลือกรูปที่เล็กลง หรือแคปหน้าจอสลิปแทน')
      const fileKey = `${f.name}|${f.size}|${f.lastModified}`
      fileKeyRef.current = fileKey
      setImg(c)
      setPreview(URL.createObjectURL(c.blob))
      setUploadId(unsureRef.current && unsureRef.current.fileKey === fileKey ? unsureRef.current.uploadId : newUuid())
    } catch (err) {
      setResult({ kind: 'err', message: err instanceof Error && err.message ? err.message : 'เปิดไฟล์รูปนี้ไม่ได้ ลองเลือกรูปอื่น' })
    } finally {
      setPreparing(false)
    }
  }

  async function submit() {
    if (busyRef.current) return
    if (!img || !uploadId) {
      setResult({ kind: 'err', message: 'กรุณาเลือกรูปสลิปก่อน' })
      return
    }
    const amount = parseMoneyInput(amountText)
    if (amount === null || amount <= 0 || amount > MAX_RENTAL_MONEY) {
      setResult({ kind: 'err', message: 'กรุณาระบุยอดเงินที่โอนให้ถูกต้อง' })
      return
    }
    if (note.trim().length > MAX_NOTE) {
      setResult({ kind: 'err', message: `หมายเหตุยาวเกิน ${MAX_NOTE} ตัวอักษร` })
      return
    }

    busyRef.current = true
    setBusy(true)
    setResult(null)
    const before = slipsCount

    const fd = new FormData()
    fd.append('token', token)
    fd.append('upload_id', uploadId)
    fd.append('amount', amount.toFixed(2))
    fd.append('note', note.trim())
    fd.append('file', img.blob, `slip.${img.ext}`)

    let outcome: 'ok' | 'err' | 'unsure' = 'unsure'
    let message = ''
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS)
    try {
      const res = await fetch('/api/book/slip', { method: 'POST', body: fd, cache: 'no-store', signal: ctrl.signal })
      let json: unknown = null
      try {
        json = await res.json()
      } catch {
        json = null
      }
      const o = json && typeof json === 'object' ? (json as { ok?: unknown; message?: unknown; unsure?: unknown }) : null
      if (res.ok && o?.ok === true) {
        outcome = 'ok'
      } else if (o?.unsure === true) {
        // เซิร์ฟเวอร์บอกว่าไม่รู้ผล (อาจบันทึกแล้ว) → ตรวจจำนวนสลิปก่อน ไม่ใช่ "ไม่สำเร็จ"
        outcome = 'unsure'
      } else if (o && typeof o.message === 'string' && o.message) {
        outcome = 'err'
        message = o.message
      } else if (res.status === 413) {
        outcome = 'err'
        message = 'รูปสลิปใหญ่เกินไป กรุณาเลือกรูปที่เล็กลง หรือแคปหน้าจอสลิปแทน'
      } else if (res.status >= 500) {
        // หน้าผิดพลาดของเครือข่าย/แพลตฟอร์ม (ไม่ใช่คำตอบของเรา) — ไม่รู้ว่าบันทึกไปถึงไหน
        outcome = 'unsure'
      } else {
        outcome = 'err'
        message = 'ส่งสลิปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
      }
    } catch {
      outcome = 'unsure'
    } finally {
      window.clearTimeout(timer)
    }

    if (outcome === 'unsure') {
      unsureRef.current = { fileKey: fileKeyRef.current, uploadId }
      setResult({ kind: 'checking', message: 'สัญญาณไม่เสถียร กำลังตรวจสอบว่าส่งสลิปสำเร็จหรือไม่...' })
      const b = await onCheck()
      if (b && b.slips_count > before) {
        outcome = 'ok'
      } else {
        setResult({
          kind: 'unsure',
          message: 'ยังไม่พบสลิปนี้ในระบบ — กด "ส่งสลิป" อีกครั้งได้เลย ระบบจะไม่บันทึกซ้ำ',
        })
        busyRef.current = false
        setBusy(false)
        return
      }
    }

    if (outcome === 'ok') {
      unsureRef.current = null
      clearFile()
      setNote('')
      amountEdited.current = false
      setResult({ kind: 'ok', message: 'ส่งสลิปแล้ว — ร้านจะตรวจสอบและยืนยันให้เร็วที่สุด' })
      await onCheck()
    } else {
      setResult({ kind: 'err', message })
    }
    busyRef.current = false
    setBusy(false)
  }

  return (
    <div className="space-y-3">
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFile}
      />

      {preview ? (
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="รูปสลิปที่เลือก" className="h-32 w-24 shrink-0 rounded-lg border border-gray-200 bg-gray-50 object-contain" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm text-gray-700">เลือกรูปสลิปแล้ว ตรวจยอดเงินให้ตรงกับสลิป แล้วกดส่ง</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary px-3 text-sm" onClick={() => fileInput.current?.click()} disabled={busy || preparing}>
                <RefreshCw {...ICON_XS} />
                เปลี่ยนรูป
              </button>
              <button type="button" className="btn-ghost px-3 text-sm" onClick={clearFile} disabled={busy}>
                <X {...ICON_XS} />
                เอาออก
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn-dashed w-full min-h-[64px]"
          onClick={() => fileInput.current?.click()}
          disabled={busy || preparing}
        >
          {preparing ? <Loader2 {...ICON_SM} className="animate-spin" /> : <ImagePlus {...ICON_SM} />}
          {preparing ? 'กำลังเตรียมรูป...' : 'เลือกรูปสลิปจากเครื่อง'}
        </button>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor="slip-amount" className="field-label">ยอดเงินที่โอน (บาท)</label>
          <input
            id="slip-amount"
            className="input"
            inputMode="decimal"
            autoComplete="off"
            value={amountText}
            onChange={e => {
              amountEdited.current = true
              setAmountText(e.target.value)
            }}
            disabled={busy}
          />
          {suggestedAmount > 0 && <p className="field-hint">ยอดที่ต้องชำระตอนนี้ {baht(suggestedAmount)}</p>}
        </div>
        <div className="min-w-0">
          <label htmlFor="slip-note" className="field-label">หมายเหตุ (ถ้ามี)</label>
          <input
            id="slip-note"
            className="input"
            maxLength={MAX_NOTE}
            placeholder="เช่น โอนจากบัญชีชื่อ..."
            value={note}
            onChange={e => setNote(e.target.value)}
            disabled={busy}
          />
        </div>
      </div>

      <div aria-live="polite">
        {result && (
          <div
            role={result.kind === 'err' || result.kind === 'unsure' ? 'alert' : 'status'}
            className={
              result.kind === 'ok' ? 'alert-ok' : result.kind === 'err' ? 'alert-err' : result.kind === 'unsure' ? 'alert-warn' : 'alert-info'
            }
          >
            {result.kind === 'ok' ? (
              <CheckCircle2 {...ICON_SM} />
            ) : result.kind === 'err' ? (
              <XCircle {...ICON_SM} />
            ) : result.kind === 'unsure' ? (
              <AlertTriangle {...ICON_SM} />
            ) : (
              <Loader2 {...ICON_SM} className="animate-spin" />
            )}
            <p className="min-w-0">{result.message}</p>
          </div>
        )}
      </div>

      <button type="button" className="btn-primary w-full" onClick={submit} disabled={busy || preparing || !img} aria-busy={busy}>
        {busy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Upload {...ICON_SM} />}
        {busy ? 'กำลังส่งสลิป...' : 'ส่งสลิป'}
      </button>
    </div>
  )
}
