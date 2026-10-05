'use client'
// ป็อปอัปคืนสินค้า / คืนเงิน (return_sale_items) — คืนบางชิ้นหรือทั้งบิลก็ได้ คืนของบิลวันไหนก็ได้
// ยอดคืนเงินจริงเซิร์ฟเวอร์คำนวณเอง (เฉลี่ยส่วนลดของบิลตามสัดส่วน) — หน้าจอแสดงแค่ยอดประมาณด้วยสูตรเดียวกัน
// client_id สร้างตอนเปิดป็อปอัป แล้วใช้ซ้ำทุกครั้งที่กดยืนยัน → เน็ตหลุดแล้วกดใหม่ ระบบไม่คืนซ้ำ (ได้ใบคืนเดิมกลับมา)
// ไม่รู้ผล (เน็ตหลุด/หมดเวลา) แล้วปิดป็อปอัป → รหัสเดิม + รายการเดิมถูกจำไว้ (pendingReturns) เปิดใหม่ได้คืนมา ไม่สุ่มรหัสใหม่
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  AlertTriangle, CheckCircle2, CornerUpLeft, Info, ListChecks, Loader2, Minus, Plus, Printer, X, XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { baht, productLabel, thaiError } from '@/lib/format'
import { FIX04_MISSING_MSG, isMigrationMissing } from '@/lib/migration'
import { newUuid } from '@/lib/products'
import {
  REFUND_METHOD_OPTIONS, estimateRefund, isRefundMethod, parseReturnResult,
  type RefundMethod, type ReturnResult, type SaleDetail, type ShopSettings,
} from '@/lib/pos'
import { PAYMENT_METHOD_LABELS } from '@/lib/integrations/labels'
import PrintPortal from '@/components/pos/PrintPortal'
import Receipt from '@/components/pos/Receipt'

const MAX_REASON = 200
const RPC_TIMEOUT_MS = 30000
const QUICK_REASONS = ['ไซส์ไม่พอดี', 'สินค้ามีตำหนิ', 'ลูกค้าเปลี่ยนใจ'] as const
const UNSURE_MSG = 'ไม่แน่ใจว่าบันทึกการคืนสินค้าแล้วหรือยัง (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — กดยืนยันอีกครั้งได้ ระบบจะไม่คืนซ้ำ'
const PARTIAL_MSG = 'ระบบตอบกลับไม่ครบ — กดยืนยันอีกครั้งเพื่อตรวจสอบ (ระบบจะไม่คืนซ้ำ)'
const RESUME_MSG = 'การคืนสินค้าครั้งก่อนของบิลนี้ยังไม่ทราบผล (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — กด "ยืนยันคืนสินค้า" อีกครั้งเพื่อตรวจสอบ ถ้าบันทึกไปแล้วจะได้ใบคืนเดิม ระบบจะไม่คืนซ้ำ'

/** ผลที่แจ้งหน้ารายละเอียดบิล: uncertain = ไม่รู้ว่าบันทึกหรือยัง · rejected = เซิร์ฟเวอร์ปฏิเสธ (ข้อมูลบิลบนจออาจเก่า) */
export type DialogSettle = 'uncertain' | 'rejected'

// การคืนที่กดยืนยันไปแล้วแต่ "ไม่รู้ผล" ต่อบิล (key = sale id) — อยู่นอกอายุของป็อปอัป
// ปิดแล้วเปิดใหม่ (หรือปิดหน้ารายละเอียดบิลแล้วเปิดใหม่) ต้องได้รหัสคำขอเดิม + รายการเดิม
// ไม่งั้นได้ client_id ใหม่ → เซิร์ฟเวอร์มองเป็นการคืนครั้งใหม่ → คืนเงิน/บวกสต๊อกซ้ำ (บิลที่ยังเหลือของให้คืนได้)
// ล้างเมื่อรู้ผลแน่นอนเท่านั้น: บันทึกสำเร็จ (รวม already_saved) หรือเซิร์ฟเวอร์ปฏิเสธหลังตรวจรหัสซ้ำแล้ว
interface PendingReturn {
  clientId: string
  qty: Record<string, number>
  reason: string
  method: RefundMethod
  restock: boolean
}
const pendingReturns = new Map<string, PendingReturn>()

function clearPending(saleId: string, clientId: string) {
  if (pendingReturns.get(saleId)?.clientId === clientId) pendingReturns.delete(saleId)
}

// error มาจากเซิร์ฟเวอร์จริง (มีรหัส Postgres/PostgREST) — ไม่ใช่เน็ตหลุด/หมดเวลา
function serverAnswered(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  if (typeof code !== 'string') return false
  return /^PGRST\d+$/.test(code) || /^(?!E)[0-9A-Z]{5}$/.test(code)
}

// เซิร์ฟเวอร์ปฏิเสธ "หลัง" ตรวจรหัสคำขอซ้ำแล้ว = รหัสนี้ไม่เคยถูกบันทึกแน่นอน (ทิ้งรหัสได้)
// สิทธิ์/การเข้าสู่ระบบ/รหัสคำขอหาย ถูกตรวจ "ก่อน" ; error ชั่วคราวของฐานข้อมูล (หมดเวลา/ล็อกชน/การเชื่อมต่อ/ทรัพยากร)
// อาจเกิดขณะคำขอครั้งก่อนยังทำงานค้างอยู่ → สรุปไม่ได้ ต้องเก็บรหัสเดิมไว้
function rejectedAfterDuplicateCheck(err: unknown): boolean {
  if (!serverAnswered(err)) return false
  const e = err as { code?: unknown; message?: unknown }
  const code = String(e.code)
  const message = typeof e.message === 'string' ? e.message : ''
  if (code === '42501' || code.startsWith('PGRST')) return false
  if (/^(08|40|53|55|57|58|XX)/.test(code)) return false
  if (code === 'P0001' && /เข้าสู่ระบบ|ไม่มีสิทธิ์|ข้อมูลไม่ครบ/.test(message)) return false
  return true
}

// ข้อความสิทธิ์ภาษาไทยจาก RPC ของเรา (42501) บอกชัดกว่าข้อความกลางของ thaiError
function errorText(err: unknown): string {
  if (isMigrationMissing(err)) return FIX04_MISSING_MSG
  const e = err && typeof err === 'object' ? (err as { code?: unknown; message?: unknown }) : null
  if (e && e.code === '42501' && typeof e.message === 'string' && /[฀-๿]/.test(e.message)) return e.message.trim()
  return thaiError(err)
}

function methodLabel(m: string): string {
  return (PAYMENT_METHOD_LABELS as Record<string, string>)[m] ?? m
}

export default function ReturnDialog({
  open,
  sale,
  shop,
  onClose,
  onDone,
  onSettled,
}: {
  open: boolean
  sale: SaleDetail
  shop: ShopSettings
  onClose(): void
  onDone(result: ReturnResult): void
  onSettled?(kind: DialogSettle): void   // ไม่รู้ผล / ถูกปฏิเสธ → หน้ารายละเอียดบิลโหลดบิลใหม่ (ไม่ใช้ยอดคืนได้ที่ค้างอยู่)
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const titleId = useId()
  const reasonId = useId()
  const [qty, setQty] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [method, setMethod] = useState<RefundMethod>('cash')
  const [restock, setRestock] = useState(true)
  const [clientId, setClientId] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ReturnResult | null>(null)
  const [printing, setPrinting] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // เปิดใหม่ = เริ่มรายการคืนใหม่ (รหัสคำขอใหม่) ; วิธีคืนเงินตั้งต้น = วิธีที่ลูกค้าจ่ายมา
  // ยกเว้นบิลนี้มีการคืนที่ยังไม่รู้ผลค้างอยู่ → กลับไปที่รายการเดิม + รหัสคำขอเดิม (กดยืนยันซ้ำ = ตรวจผล ไม่คืนซ้ำ)
  useEffect(() => {
    if (!open) return
    const pend = pendingReturns.get(sale.id)
    if (pend) {
      setQty({ ...pend.qty })
      setReason(pend.reason)
      setMethod(pend.method)
      setRestock(pend.restock)
      setClientId(pend.clientId)
      setError(RESUME_MSG)
    } else {
      setQty({})
      setReason('')
      setMethod(isRefundMethod(sale.payment_method) ? sale.payment_method : 'cash')
      setRestock(true)
      setClientId(newUuid())
      setError('')
    }
    setBusy(false)
    busyRef.current = false
    setResult(null)
    setPrinting(false)
    panelRef.current?.focus()
    // เปิดครั้งเดียวต่อบิล — ไม่รีเซ็ตเมื่อข้อมูลบิลถูกอัปเดตระหว่างเปิดอยู่
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busyRef.current) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const items = sale.items
  const picked = items.reduce((s, it) => s + Math.min(it.returnable_qty, Math.max(0, qty[it.product_id] ?? 0)), 0)
  const estimate = useMemo(() => estimateRefund(sale, qty), [sale, qty])

  if (!open) return null

  const cleanReason = reason.trim()
  const reasonOk = cleanReason.length >= 1 && cleanReason.length <= MAX_REASON
  const allMax = items.every(it => (qty[it.product_id] ?? 0) >= it.returnable_qty)
  const canSubmit = !busy && picked > 0 && reasonOk && !!clientId

  function setLine(productId: string, n: number, max: number) {
    if (busyRef.current) return
    const v = Math.min(Math.max(0, Math.floor(n)), Math.max(0, max))
    setQty(prev => ({ ...prev, [productId]: v }))
    setError('')
  }

  function pickAll() {
    if (busyRef.current) return
    const next: Record<string, number> = {}
    items.forEach(it => { next[it.product_id] = it.returnable_qty })
    setQty(next)
    setError('')
  }

  async function handleConfirm() {
    if (busyRef.current || !canSubmit) return
    const sent = items
      .map(it => ({ product_id: it.product_id, qty: Math.min(it.returnable_qty, Math.max(0, qty[it.product_id] ?? 0)) }))
      .filter(it => it.qty > 0)
    if (sent.length === 0) return
    const saleId = sale.id
    const cid = clientId
    // มีคำขอรหัสเดียวกันที่ยังไม่รู้ผลค้างอยู่ก่อนกดครั้งนี้ไหม (ถ้ามี error ที่เกิดก่อนตรวจรหัสซ้ำ = ยังสรุปไม่ได้)
    const hadPending = pendingReturns.get(saleId)?.clientId === cid
    // จำไว้ก่อนส่ง (นอกป็อปอัป) — ปิดป็อปอัป/เปลี่ยนหน้ากลางทาง เปิดใหม่ก็ยังได้รหัสเดิม ไม่คืนซ้ำ
    pendingReturns.set(saleId, {
      clientId: cid,
      qty: Object.fromEntries(sent.map(s => [s.product_id, s.qty])),
      reason: cleanReason,
      method,
      restock,
    })
    busyRef.current = true
    setBusy(true)
    setError('')
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = setTimeout(() => ctrl?.abort(), RPC_TIMEOUT_MS)
    let answered = false
    try {
      let req = supabase.rpc('return_sale_items', {
        p_client_id: cid,
        p_sale_id: saleId,
        p_items: sent,
        p_reason: cleanReason,
        p_refund_method: method,
        p_restock: restock,
      })
      if (ctrl) req = req.abortSignal(ctrl.signal)
      const { data, error: rpcError } = await req
      if (rpcError) throw rpcError
      answered = true
      const parsed = parseReturnResult(data)
      if (!parsed || !parsed.return) {
        // ตอบกลับแต่อ่านผลไม่ได้ — อาจบันทึกแล้ว: เก็บรหัสเดิมไว้ กดซ้ำได้ใบคืนเดิม
        setError(PARTIAL_MSG)
        onSettled?.('uncertain')
        return
      }
      clearPending(saleId, cid)
      setResult(parsed)
      onDone(parsed)
    } catch (err) {
      if (serverAnswered(err)) {
        answered = true
        const definite = rejectedAfterDuplicateCheck(err)
        // ปฏิเสธจริงหลังตรวจรหัสซ้ำ / ครั้งแรกโดนปฏิเสธตั้งแต่ด่านสิทธิ์ (ยังไม่มีคำขอเก่าค้าง) = รหัสนี้ไม่เคยบันทึก
        if (definite || !hadPending) clearPending(saleId, cid)
        setError(errorText(err))
        if (definite) onSettled?.('rejected')
        else if (hadPending) onSettled?.('uncertain')
      } else {
        // เน็ตหลุด/หมดเวลา → ไม่รู้ผล: เก็บรหัสคำขอเดิมไว้ กดซ้ำแล้วได้ใบคืนเดิมถ้าบันทึกไปแล้ว
        setError(UNSURE_MSG)
        onSettled?.('uncertain')
      }
    } finally {
      clearTimeout(timer)
      busyRef.current = false
      setBusy(false)
      if (answered && navigator.onLine !== false) router.refresh()
    }
  }

  const ret = result?.return ?? null
  const printSale = result?.sale ?? sale

  return (
    <div
      className="fixed inset-0 z-[60] !mt-0 flex items-end sm:items-center justify-center scrim sm:p-4"
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="sheet flex w-full max-w-lg flex-col max-h-[94dvh] sm:max-h-[90dvh] overflow-hidden rounded-b-none border-b-0 sm:rounded-4xl sm:border-b animate-fade-up outline-none"
      >
        {/* หัว (อยู่กับที่) */}
        <div className="shrink-0 flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="icon-bubble shrink-0"><CornerUpLeft {...ICON} /></span>
            <div className="min-w-0">
              <h3 id={titleId} className="text-lg font-semibold leading-snug text-gray-900">คืนสินค้า / คืนเงิน</h3>
              <p className="font-mono text-xs text-gray-600 break-all">บิล {sale.sale_no}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="ปิด" className="btn-icon btn-icon-plain -mr-2 shrink-0">
            <X {...ICON} />
          </button>
        </div>

        {ret ? (
          // ===== บันทึกสำเร็จ =====
          <>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-5 space-y-4" aria-live="polite">
              <div className="text-center">
                <span className="icon-bubble icon-bubble-lg icon-bubble-strong">
                  {result?.already_saved
                    ? <Info size={28} strokeWidth={1.75} aria-hidden="true" />
                    : <CheckCircle2 size={28} strokeWidth={1.75} aria-hidden="true" />}
                </span>
                <p className="mt-3 text-lg font-semibold text-gray-900">
                  {result?.already_saved ? 'รายการคืนนี้บันทึกไว้แล้ว' : 'บันทึกการคืนสินค้าแล้ว'}
                </p>
                <p className="mt-1 font-mono text-sm text-gray-600">เลขที่ {ret.return_no}</p>
              </div>
              {result?.already_saved && (
                <div className="alert-warn">
                  <Info {...ICON_SM} />
                  <p className="min-w-0">ระบบได้รับคำขอนี้ไปแล้วก่อนหน้า — ไม่ได้คืนสินค้า/คืนเงินซ้ำ</p>
                </div>
              )}
              <div className="panel px-4 py-3 space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-gray-900">คืนเงินลูกค้า</span>
                  <span className="money text-2xl text-brand-700">{baht(ret.refund_amount)}</span>
                </div>
                <div className="flex justify-between gap-3 text-sm text-gray-600">
                  <span>วิธีคืนเงิน</span>
                  <span>{methodLabel(ret.refund_method)}</span>
                </div>
                <div className="flex justify-between gap-3 text-sm text-gray-600">
                  <span>สต๊อก</span>
                  <span>{ret.restock ? 'คืนเข้าสต๊อกแล้ว' : 'ไม่คืนเข้าสต๊อก'}</span>
                </div>
              </div>
              <ul className="panel divide-y divide-gray-200 px-3.5 text-sm">
                {ret.items.map((it, i) => (
                  <li key={`${it.product_id}-${i}`} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="text-gray-900 break-words">{productLabel(it)}</p>
                      <p className="text-xs text-gray-500 tabular-nums">คืน {it.qty} ชิ้น</p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums text-gray-900">{baht(it.refund_amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div
              className="shrink-0 border-t border-gray-200 px-5 pt-3 flex gap-2"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            >
              <button type="button" onClick={() => setPrinting(true)} disabled={printing} className="btn-secondary px-4">
                <Printer {...ICON_SM} />
                พิมพ์ใบคืนสินค้า
              </button>
              <button type="button" onClick={onClose} autoFocus className="btn-primary flex-1">
                เสร็จสิ้น
              </button>
            </div>
            <PrintPortal open={printing} paper={shop.receipt_paper} onDone={() => setPrinting(false)}>
              <Receipt shop={shop} sale={printSale} variant="return" returnInfo={ret} />
            </PrintPortal>
          </>
        ) : (
          // ===== ฟอร์มคืนสินค้า =====
          <>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-4">
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="field-label mb-0">เลือกสินค้าที่คืน</p>
                  <div className="flex gap-1">
                    {picked > 0 && (
                      <button type="button" onClick={() => setQty({})} disabled={busy} className="btn-ghost px-3 text-sm">
                        ล้าง
                      </button>
                    )}
                    <button type="button" onClick={pickAll} disabled={busy || allMax} className="btn-secondary px-3 text-sm">
                      <ListChecks {...ICON_SM} />
                      คืนทั้งหมด
                    </button>
                  </div>
                </div>
                <ul className="space-y-2">
                  {items.map(it => {
                    const max = it.returnable_qty
                    const v = Math.min(max, Math.max(0, qty[it.product_id] ?? 0))
                    const label = productLabel(it)
                    return (
                      <li key={it.product_id} className={clsx('p-3 rounded-lg border', v > 0 ? 'border-brand-600 bg-brand-50' : 'panel border-transparent', max <= 0 && 'opacity-60')}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 break-words">{label}</p>
                            <p className="text-xs text-gray-500 tabular-nums">
                              {baht(it.unit_price)} / ชิ้น · ซื้อ {it.qty}
                              {it.returned_qty > 0 ? ` · คืนแล้ว ${it.returned_qty}` : ''}
                            </p>
                          </div>
                          {max <= 0 && <span className="chip shrink-0">คืนครบแล้ว</span>}
                        </div>
                        {max > 0 && (
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="text-xs text-gray-500">คืนได้อีก {max} ชิ้น</span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setLine(it.product_id, v - 1, max)}
                                disabled={busy || v <= 0}
                                aria-label={`ลดจำนวนคืน ${label}`}
                                className="btn-icon"
                              >
                                <Minus {...ICON_SM} />
                              </button>
                              <span className="w-10 text-center text-base font-semibold tabular-nums text-gray-900" aria-live="polite" aria-label={`คืน ${label} ${v} ชิ้น`}>
                                {v}
                              </span>
                              <button
                                type="button"
                                onClick={() => setLine(it.product_id, v + 1, max)}
                                disabled={busy || v >= max}
                                aria-label={`เพิ่มจำนวนคืน ${label}`}
                                className="btn-icon"
                              >
                                <Plus {...ICON_SM} />
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>

              <div>
                <label htmlFor={reasonId} className="field-label">เหตุผลการคืน *</label>
                <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="เหตุผลที่ใช้บ่อย">
                  {QUICK_REASONS.map(r => (
                    <button key={r} type="button" className="chip-toggle" aria-pressed={cleanReason === r} disabled={busy} onClick={() => setReason(r)}>
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
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                />
              </div>

              <div>
                <p className="field-label">คืนเงินโดย</p>
                <div className="grid grid-cols-3 gap-2" role="group" aria-label="วิธีคืนเงิน">
                  {REFUND_METHOD_OPTIONS.map(opt => (
                    <button key={opt.value} type="button" className="choice px-1" aria-pressed={method === opt.value} disabled={busy} onClick={() => setMethod(opt.value)}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel p-3 space-y-1.5">
                <button
                  type="button"
                  role="switch"
                  aria-checked={restock}
                  onClick={() => setRestock(r => !r)}
                  disabled={busy}
                  className="flex w-full min-h-[44px] items-center justify-between gap-3 text-left text-sm font-semibold text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="min-w-0">คืนเข้าสต๊อก</span>
                  <span aria-hidden="true" className={clsx('switch', restock && 'switch-on')}>
                    <span className="switch-knob" />
                  </span>
                </button>
                <p className={clsx('text-xs', restock ? 'text-gray-500' : 'text-amber-800')}>
                  {restock ? 'สินค้าที่คืนจะถูกบวกกลับเข้าสต๊อกขายได้ตามปกติ' : 'สินค้าเสีย/ขายต่อไม่ได้ จะไม่บวกสต๊อก'}
                </p>
              </div>
            </div>

            {/* ท้าย (อยู่กับที่): ยอดประมาณ + ข้อผิดพลาด + ปุ่มยืนยัน */}
            <div
              className="shrink-0 border-t border-gray-200 bg-white px-5 pt-3 space-y-2"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            >
              <div className="flex items-baseline justify-between gap-3" aria-live="polite">
                <span className="text-sm text-gray-600">
                  {picked > 0 ? `คืน ${picked} ชิ้น · ประมาณ` : 'ยังไม่ได้เลือกสินค้า'}
                </span>
                {picked > 0 && <span className="money text-xl text-brand-700">{baht(estimate)}</span>}
              </div>
              {picked > 0 && (
                <p className="text-xs text-gray-500">ระบบคำนวณยอดจริงตามส่วนลดของบิล</p>
              )}
              {sale.payment_method !== method && picked > 0 && (
                <p className="flex items-start gap-1.5 text-xs font-medium text-amber-800">
                  <AlertTriangle {...ICON_SM} className="-mt-px" />
                  <span className="min-w-0">บิลนี้ชำระด้วย{methodLabel(sale.payment_method)} แต่คืนเงินเป็น{methodLabel(method)}</span>
                </p>
              )}
              {error && (
                <div role="alert" className="alert-err">
                  <XCircle {...ICON_SM} />
                  <p className="min-w-0 break-words">{error}</p>
                </div>
              )}
              <div className="flex gap-2 sm:justify-end">
                <button type="button" onClick={onClose} disabled={busy} className="btn-secondary px-5">ยกเลิก</button>
                <button type="button" onClick={handleConfirm} disabled={!canSubmit} className="btn-primary flex-1 sm:flex-none sm:min-w-[180px]">
                  {busy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <CornerUpLeft {...ICON_SM} />}
                  {busy ? 'กำลังบันทึก...' : 'ยืนยันคืนสินค้า'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
