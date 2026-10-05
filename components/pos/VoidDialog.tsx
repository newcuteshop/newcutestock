'use client'
// ป็อปอัปยกเลิกบิลทั้งใบ (void_sale) — คืนสต๊อกทุกรายการ และบิลนี้ไม่ถูกนับในยอดขายอีก
// เซิร์ฟเวอร์ตรวจสิทธิ์/เงื่อนไขทั้งหมดเอง (บิลวันก่อน พนักงานยกเลิกไม่ได้, บิลที่มีคืนสินค้าแล้วยกเลิกไม่ได้ ฯลฯ)
// กดซ้ำ/เน็ตหลุดแล้วกดใหม่ปลอดภัย: บิลที่ยกเลิกไปแล้ว เซิร์ฟเวอร์ตอบ already_voided กลับมาเฉยๆ ไม่คืนสต๊อกซ้ำ
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Ban, Loader2, PackageCheck, X, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON_SM } from '@/components/theme/icons'
import { baht, productLabel, thaiError } from '@/lib/format'
import { FIX04_MISSING_MSG, isMigrationMissing } from '@/lib/migration'
import { parseVoidResult, type SaleDetail, type VoidResult } from '@/lib/pos'
import { PAYMENT_METHOD_LABELS } from '@/lib/integrations/labels'

const MAX_REASON = 200
const RPC_TIMEOUT_MS = 30000
const QUICK_REASONS = ['ลูกค้าเปลี่ยนใจ', 'คีย์ผิด', 'ทดลองระบบ'] as const
const UNSURE_MSG = 'ไม่แน่ใจว่ายกเลิกบิลสำเร็จหรือยัง (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — กดยืนยันอีกครั้งได้ ระบบจะไม่คืนสต๊อกซ้ำ'
const PARTIAL_MSG = 'ระบบตอบกลับไม่ครบ — ปิดหน้าต่างนี้แล้วเปิดบิลใหม่เพื่อตรวจสอบสถานะ'

// error มาจากเซิร์ฟเวอร์จริง (มีรหัส Postgres/PostgREST) — ไม่ใช่เน็ตหลุด/หมดเวลา
function serverAnswered(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  if (typeof code !== 'string') return false
  return /^PGRST\d+$/.test(code) || /^(?!E)[0-9A-Z]{5}$/.test(code)
}

// ข้อความสิทธิ์ภาษาไทยจาก RPC ของเรา (42501) บอกชัดกว่าข้อความกลางของ thaiError
function errorText(err: unknown): string {
  if (isMigrationMissing(err)) return FIX04_MISSING_MSG
  const e = err && typeof err === 'object' ? (err as { code?: unknown; message?: unknown }) : null
  if (e && e.code === '42501' && typeof e.message === 'string' && /[฀-๿]/.test(e.message)) return e.message.trim()
  return thaiError(err)
}

export default function VoidDialog({
  open,
  sale,
  onClose,
  onDone,
  onSettled,
}: {
  open: boolean
  sale: SaleDetail
  onClose(): void
  onDone(result: VoidResult): void
  // ไม่รู้ผล (uncertain) / ถูกปฏิเสธ (rejected) → หน้ารายละเอียดบิลโหลดบิลใหม่ ไม่โชว์สถานะเก่าค้างไว้
  onSettled?(kind: 'uncertain' | 'rejected'): void
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const titleId = useId()
  const reasonId = useId()
  const warnId = useId()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  // เปิดใหม่ทุกครั้ง = เริ่มใหม่ (เหตุผลเดิมไม่ค้างไปบิลอื่น)
  useEffect(() => {
    if (!open) return
    setReason('')
    setError('')
    setBusy(false)
    busyRef.current = false
    panelRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busyRef.current) {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const cleanReason = reason.trim()
  const reasonOk = cleanReason.length >= 1 && cleanReason.length <= MAX_REASON
  const backQty = sale.items.reduce((s, it) => s + it.qty, 0)
  // บิลของวันก่อน (แอดมินยกเลิก): เซิร์ฟเวอร์ส่งคำเตือนมา — ยอดวันนั้นลด ต้องปิดยอดใหม่ และไม่หักลิ้นชักวันนี้
  // ข้อความ "คืนเงินลูกค้าด้วยตัวเอง" ด้านบนจึงไม่ใช้กับกรณีนี้ (ถ้าจะคืนเงินลูกค้าวันนี้ ต้องใช้ "คืนสินค้า" ตามคำเตือน)
  const pastDayWarning = sale.void_warning

  async function handleConfirm() {
    if (busyRef.current || !reasonOk) return
    busyRef.current = true
    setBusy(true)
    setError('')
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = setTimeout(() => ctrl?.abort(), RPC_TIMEOUT_MS)
    let answered = false
    try {
      let req = supabase.rpc('void_sale', { p_sale_id: sale.id, p_reason: cleanReason })
      if (ctrl) req = req.abortSignal(ctrl.signal)
      const { data, error: rpcError } = await req
      if (rpcError) throw rpcError
      answered = true
      const result = parseVoidResult(data)
      if (!result || !result.sale) {
        setError(PARTIAL_MSG)
        onSettled?.('uncertain')
        return
      }
      onDone(result)
    } catch (err) {
      if (serverAnswered(err)) {
        answered = true
        setError(errorText(err))
        // เช่น เครื่องอื่นคืนสินค้า/ยกเลิกบิลนี้ไปก่อน → บิลบนจอเก่าแล้ว
        onSettled?.('rejected')
      } else {
        // เน็ตหลุด/หมดเวลา → ไม่รู้ผล แต่กดซ้ำได้ปลอดภัย (ยกเลิกไปแล้ว เซิร์ฟเวอร์ตอบ already_voided)
        setError(UNSURE_MSG)
        onSettled?.('uncertain')
      }
    } finally {
      clearTimeout(timer)
      busyRef.current = false
      setBusy(false)
      // สต๊อก/รายการขายในหน้าเปลี่ยนแล้ว → โหลดข้อมูลหน้าใหม่ (ออฟไลน์ห้าม refresh: Next จะโหลดทั้งหน้าเป็นหน้าเน็ตหลุด)
      if (answered && navigator.onLine !== false) router.refresh()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center scrim p-3 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="sheet w-full max-w-md max-h-[90dvh] overflow-y-auto overscroll-contain p-5 space-y-4 pb-[calc(1.25rem_+_env(safe-area-inset-bottom))] sm:pb-5 animate-pop-in outline-none"
      >
        <div className="flex items-start gap-3">
          <span className="icon-bubble icon-bubble-err shrink-0" aria-hidden="true">
            <Ban {...ICON_SM} />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <h3 id={titleId} className="text-lg font-semibold leading-snug text-gray-900">ยกเลิกบิล</h3>
            <p className="font-mono text-sm text-gray-600 break-all">{sale.sale_no}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="ปิด" className="btn-icon btn-icon-plain -mr-2 -mt-1 shrink-0">
            <X {...ICON_SM} />
          </button>
        </div>

        <div className="alert-warn">
          <AlertTriangle {...ICON_SM} />
          <p className="min-w-0">
            บิลนี้จะไม่ถูกนับในยอดขาย และสินค้าทุกรายการจะกลับเข้าสต๊อก
            {!pastDayWarning && (
              <>
                {' '}— คืนเงินลูกค้า{' '}
                <b className="tabular-nums">{baht(sale.net_amount)}</b>{' '}
                ({(PAYMENT_METHOD_LABELS as Record<string, string>)[sale.payment_method] ?? sale.payment_method}) ด้วยตัวเอง
              </>
            )}
          </p>
        </div>

        <div>
          <p className="field-label flex items-center gap-1.5">
            <PackageCheck {...ICON_SM} className="text-brand-600" />
            สินค้าที่จะคืนเข้าสต๊อก ({backQty} ชิ้น)
          </p>
          <ul className="panel divide-y divide-gray-200 px-3.5 text-sm max-h-48 overflow-y-auto overscroll-contain">
            {sale.items.map((it, i) => (
              <li key={`${it.product_id}-${i}`} className="flex items-start justify-between gap-3 py-2">
                <span className="min-w-0 break-words text-gray-900">{productLabel(it)}</span>
                <span className="shrink-0 font-semibold tabular-nums text-gray-900">+{it.qty}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <label htmlFor={reasonId} className="field-label">เหตุผลที่ยกเลิก *</label>
          <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="เหตุผลที่ใช้บ่อย">
            {QUICK_REASONS.map(r => (
              <button
                key={r}
                type="button"
                className="chip-toggle"
                aria-pressed={cleanReason === r}
                disabled={busy}
                onClick={() => setReason(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <input
            id={reasonId}
            className="input"
            value={reason}
            maxLength={MAX_REASON}
            disabled={busy}
            placeholder="พิมพ์เหตุผล หรือเลือกจากด้านบน"
            autoComplete="off"
            aria-invalid={reason !== '' && !reasonOk}
            onChange={e => setReason(e.target.value)}
            // Enter = ปิดคีย์บอร์ดเฉยๆ ไม่ยกเลิกบิลทันที (ต้องกดปุ่มยืนยันเอง กันพลาด)
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.blur() } }}
          />
          <p className="field-hint">ไม่เกิน {MAX_REASON} ตัวอักษร — บันทึกไว้ในประวัติบิล</p>
        </div>

        {/* บิลวันก่อน: เตือนไว้ติดปุ่มยืนยัน ให้เห็นก่อนกดเสมอ (ปุ่มยืนยันอ้างถึงข้อความนี้ให้โปรแกรมอ่านจออ่านด้วย) */}
        {pastDayWarning && (
          <div id={warnId} className="alert-warn">
            <AlertTriangle {...ICON_SM} />
            <p className="min-w-0 break-words">{pastDayWarning}</p>
          </div>
        )}

        <div aria-live="polite">
          {error && (
            <div role="alert" className="alert-err">
              <XCircle {...ICON_SM} />
              <p className="min-w-0 break-words">{error}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={busy} className="btn-secondary w-full sm:w-auto px-5">
            ไม่ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || !reasonOk}
            aria-describedby={pastDayWarning ? warnId : undefined}
            className="btn-danger w-full sm:w-auto px-5"
          >
            {busy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Ban {...ICON_SM} />}
            {busy ? 'กำลังยกเลิก...' : 'ยืนยันยกเลิกบิล'}
          </button>
        </div>
      </div>
    </div>
  )
}
