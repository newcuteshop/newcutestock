'use client'
// รายละเอียดบิล (get_sale_detail) — ใช้ทั้งหน้าขาย (รายการขายล่าสุด) และหน้าประวัติบิล
// แสดงรายการ/ยอด/การคืนสินค้า/การยกเลิก + ปุ่มพิมพ์ใบเสร็จซ้ำ, ยกเลิกบิล, คืนสินค้า
// ปุ่มยกเลิก/คืนแสดงตามที่เซิร์ฟเวอร์บอก (can_void / can_return คิดจากสิทธิ์ของผู้ใช้ + สถานะบิลแล้ว) — เซิร์ฟเวอร์ตรวจซ้ำตอนกดเสมอ
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  Ban, CheckCircle2, CornerUpLeft, Info, Loader2, Printer, Receipt as ReceiptIcon, RefreshCw, X, XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht, formatThaiDateTime, productLabel, thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { round2 } from '@/lib/money'
import {
  billStatus, parseSaleDetail, type ReturnResult, type SaleDetail, type SaleReturn, type ShopSettings, type VoidResult,
} from '@/lib/pos'
import { PAYMENT_METHOD_LABELS, saleChannelLabel } from '@/lib/integrations/labels'
import MigrationNotice from '@/components/pos/MigrationNotice'
import PrintPortal from '@/components/pos/PrintPortal'
import Receipt from '@/components/pos/Receipt'
import VoidDialog from '@/components/pos/VoidDialog'
import ReturnDialog, { type DialogSettle } from '@/components/pos/ReturnDialog'

const LOAD_TIMEOUT_MS = 20000
const LOAD_TIMEOUT_MSG = 'เซิร์ฟเวอร์ตอบช้าเกินไป — กด "ลองใหม่"'

type PrintJob = { kind: 'sale' } | { kind: 'return'; ret: SaleReturn }

function methodLabel(m: string): string {
  return (PAYMENT_METHOD_LABELS as Record<string, string>)[m] ?? m
}

export default function BillDetailDialog({
  saleId,
  open,
  onClose,
  canRefund,
  shop,
  onChanged,
}: {
  saleId: string | null
  open: boolean
  onClose(): void
  canRefund: boolean
  shop: ShopSettings
  onChanged?(sale: SaleDetail): void
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const titleId = useId()
  const [detail, setDetail] = useState<SaleDetail | null>(null)
  // ป็อปอัปยกเลิก/คืน "ไม่รู้ผล" → ปิดป็อปอัปนั้นเมื่อไรให้โหลดบิลใหม่ (อาจบันทึกไปแล้ว ยอดคืนได้/สถานะบนจอเก่า)
  const staleRef = useRef(false)
  // การโหลดรอบถัดไปมาจากผลไม่แน่นอน → โหลดเสร็จแล้ว refresh ข้อมูลหน้าด้วย (สต๊อก/รายการบิลอาจเปลี่ยน
  // แต่ป็อปอัปย่อยไม่ได้ refresh ให้ เพราะไม่ได้คำตอบจากเซิร์ฟเวอร์)
  const syncAfterLoadRef = useRef(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [notice, setNotice] = useState('')
  const [voidOpen, setVoidOpen] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [printJob, setPrintJob] = useState<PrintJob | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged

  // เปิด: จำปุ่มที่กดเปิดไว้ (ปิดแล้วคืนโฟกัสให้) + โฟกัสที่ป็อปอัป
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement
    returnFocusRef.current = prev instanceof HTMLElement ? prev : null
    panelRef.current?.focus()
    return () => {
      const el = returnFocusRef.current
      returnFocusRef.current = null
      if (el && el.isConnected) {
        try { el.focus({ preventScroll: true }) } catch { /* ignore */ }
      }
    }
  }, [open])

  // เปิด/เปลี่ยนบิล = เริ่มใหม่หมด (ข้อความแจ้ง/ป็อปอัปยกเลิก-คืนของบิลก่อนไม่ค้าง)
  useEffect(() => {
    if (!open || !saleId) return
    setDetail(null)
    setNotice('')
    setVoidOpen(false)
    setReturnOpen(false)
    setPrintJob(null)
    staleRef.current = false
    syncAfterLoadRef.current = false
  }, [open, saleId])

  // โหลดรายละเอียดบิลทุกครั้งที่เปิด / เปลี่ยนบิล / กดลองใหม่
  // โหลดซ้ำบิลเดิม (ลองใหม่/อัปเดตหลังคืนสินค้า) ไม่ล้างข้อมูลเดิมระหว่างรอ — ป็อปอัปคืนสินค้าที่เปิดอยู่ไม่หายไป
  useEffect(() => {
    if (!open || !saleId) return
    let cancelled = false
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; ctrl?.abort() }, LOAD_TIMEOUT_MS)
    setError('')
    setMissing(false)
    setLoading(true)
    void (async () => {
      try {
        let req = supabase.rpc('get_sale_detail', { p_sale_id: saleId })
        if (ctrl) req = req.abortSignal(ctrl.signal)
        const { data, error: rpcError } = await req
        if (cancelled) return
        if (rpcError) throw rpcError
        const parsed = parseSaleDetail(data)
        if (!parsed) throw new Error('อ่านข้อมูลบิลไม่ได้ — กด "ลองใหม่"')
        setDetail(parsed)
        // รายการบิลด้านหลังใช้สถานะล่าสุดจากเซิร์ฟเวอร์ (เช่นเครื่องอื่นยกเลิก/คืนไปแล้ว)
        onChangedRef.current?.(parsed)
        if (syncAfterLoadRef.current) {
          syncAfterLoadRef.current = false
          // ผลก่อนหน้าไม่แน่นอน → ป็อปอัปย่อยไม่ได้ refresh หน้า: โหลดสต๊อก/รายการขายใหม่ที่นี่
          if (navigator.onLine !== false) router.refresh()
        }
      } catch (err) {
        if (cancelled) return
        if (isMigrationMissing(err)) setMissing(true)
        else setError(timedOut ? LOAD_TIMEOUT_MSG : thaiError(err))
      } finally {
        clearTimeout(timer)
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      clearTimeout(timer)
      ctrl?.abort()
    }
  }, [open, saleId, reloadKey, supabase, router])

  // Esc ปิด (ยกเว้นตอนป็อปอัปยกเลิก/คืนเปิดทับอยู่ — ป็อปอัปนั้นปิดตัวเองก่อน)
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || voidOpen || returnOpen) return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, voidOpen, returnOpen, onClose])

  const handleVoided = useCallback((r: VoidResult) => {
    setVoidOpen(false)
    if (r.sale) {
      staleRef.current = false   // ได้สถานะจริงจากเซิร์ฟเวอร์แล้ว ไม่ต้องโหลดซ้ำตอนปิด
      setDetail(r.sale)
      onChangedRef.current?.(r.sale)
    }
    setNotice(r.already_voided ? 'บิลนี้ถูกยกเลิกไปก่อนแล้ว — ไม่ได้คืนสต๊อกซ้ำ' : 'ยกเลิกบิลแล้ว — สินค้าทุกรายการกลับเข้าสต๊อกเรียบร้อย')
  }, [])

  const handleReturned = useCallback((r: ReturnResult) => {
    // ป็อปอัปคืนสินค้ายังเปิดอยู่ (แสดงผล + ปุ่มพิมพ์ใบคืน) — อัปเดตบิลด้านหลังให้ตรงทันที
    if (r.sale) {
      staleRef.current = false   // ได้สถานะจริงจากเซิร์ฟเวอร์แล้ว ไม่ต้องโหลดซ้ำตอนปิด
      setDetail(r.sale)
      onChangedRef.current?.(r.sale)
    } else {
      setReloadKey(k => k + 1)
    }
    if (r.return) {
      setNotice(r.already_saved
        ? `รายการคืน ${r.return.return_no} บันทึกไว้แล้วก่อนหน้า — ไม่ได้คืนซ้ำ`
        : `บันทึกคืนสินค้า ${r.return.return_no} แล้ว — คืนเงินลูกค้า ${baht(r.return.refund_amount)}`)
    }
  }, [])

  // ยกเลิก/คืน ไม่รู้ผล → จำไว้ โหลดบิลใหม่ตอนปิดป็อปอัปนั้น (ระหว่างที่ป็อปอัปเปิดอยู่ ห้ามเปลี่ยนจำนวนที่คืนได้ใต้มือผู้ใช้
  // ที่กำลังจะกดยืนยันซ้ำเพื่อตรวจผล) ; ถูกปฏิเสธ (เช่นเครื่องอื่นคืน/ยกเลิกไปก่อน) → โหลดใหม่ทันที ให้ตัวเลขในป็อปอัปตรงของจริง
  const handleSettled = useCallback((kind: DialogSettle) => {
    if (kind === 'rejected') {
      // เซิร์ฟเวอร์ตอบแล้ว ป็อปอัปย่อย refresh หน้าให้เองแล้ว — ที่นี่โหลดแค่รายละเอียดบิล
      setReloadKey(k => k + 1)
    } else {
      staleRef.current = true
    }
  }, [])

  const reloadIfStale = useCallback(() => {
    if (!staleRef.current) return
    staleRef.current = false
    syncAfterLoadRef.current = true
    setReloadKey(k => k + 1)
  }, [])

  const closeVoid = useCallback(() => {
    setVoidOpen(false)
    reloadIfStale()
  }, [reloadIfStale])
  const closeReturn = useCallback(() => {
    setReturnOpen(false)
    reloadIfStale()
  }, [reloadIfStale])

  if (!open || !saleId) return null

  const showVoid = !!detail && canRefund && detail.can_void
  const showReturn = !!detail && canRefund && detail.can_return

  return (
    <div
      className="fixed inset-0 z-50 !mt-0 flex items-end sm:items-center justify-center scrim sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="sheet flex w-full max-w-2xl flex-col h-[94dvh] sm:h-auto sm:max-h-[90dvh] overflow-hidden rounded-b-none border-b-0 sm:rounded-4xl sm:border-b animate-fade-up outline-none"
      >
        {/* หัว (อยู่กับที่) */}
        <div className="shrink-0 flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="icon-bubble shrink-0"><ReceiptIcon {...ICON} /></span>
            <div className="min-w-0">
              <h3 id={titleId} className="text-lg font-semibold leading-snug text-gray-900">
                รายละเอียดบิล
              </h3>
              <p className="font-mono text-xs text-gray-600 break-all">{detail?.sale_no ?? ' '}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="ปิด" className="btn-icon btn-icon-plain -mr-2 shrink-0">
            <X {...ICON} />
          </button>
        </div>

        {/* เนื้อหา (เลื่อนได้) */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-4" aria-busy={loading}>
          {loading && !detail && (
            <div className="space-y-3" role="status">
              <span className="sr-only">กำลังโหลดบิล...</span>
              <div className="skeleton h-5 w-40" />
              <div className="skeleton h-4 w-56 max-w-full" />
              <div className="skeleton h-24 rounded-lg" />
              <div className="skeleton h-16 rounded-lg" />
            </div>
          )}

          {missing && <MigrationNotice />}

          {error && (
            <div role="alert" className="alert-err">
              <XCircle {...ICON_SM} />
              <div className="min-w-0 space-y-2">
                <p className="break-words">{error}</p>
                <button type="button" onClick={() => setReloadKey(k => k + 1)} className="btn-secondary px-4 text-sm">
                  <RefreshCw {...ICON_SM} />
                  ลองใหม่
                </button>
              </div>
            </div>
          )}

          {detail && (
            <BillDetailBody
              detail={detail}
              notice={notice}
              canRefund={canRefund}
              printBusy={printJob !== null}
              onPrintReturn={r => setPrintJob({ kind: 'return', ret: r })}
            />
          )}
        </div>

        {/* ท้าย (อยู่กับที่): ปุ่มทำรายการ */}
        {detail && (
          <div
            className="shrink-0 border-t border-gray-200 bg-white px-5 pt-3 flex flex-wrap gap-2 sm:justify-end"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            <button
              type="button"
              onClick={() => setPrintJob({ kind: 'sale' })}
              disabled={printJob !== null}
              className="btn-secondary flex-1 sm:flex-none px-4"
            >
              {printJob ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Printer {...ICON_SM} />}
              พิมพ์ใบเสร็จ
            </button>
            {showReturn && (
              <button type="button" onClick={() => setReturnOpen(true)} className="btn-secondary flex-1 sm:flex-none px-4">
                <CornerUpLeft {...ICON_SM} />
                คืนสินค้า
              </button>
            )}
            {showVoid && (
              <button type="button" onClick={() => setVoidOpen(true)} className="btn-danger-soft flex-1 sm:flex-none px-4">
                <Ban {...ICON_SM} />
                ยกเลิกบิล
              </button>
            )}
          </div>
        )}
      </div>

      {detail && (
        <>
          <VoidDialog open={voidOpen} sale={detail} onClose={closeVoid} onDone={handleVoided} onSettled={handleSettled} />
          <ReturnDialog
            open={returnOpen}
            sale={detail}
            shop={shop}
            onClose={closeReturn}
            onDone={handleReturned}
            onSettled={handleSettled}
          />
          <PrintPortal open={printJob !== null} paper={shop.receipt_paper} onDone={() => setPrintJob(null)}>
            {printJob?.kind === 'return'
              ? <Receipt shop={shop} sale={detail} variant="return" returnInfo={printJob.ret} reprint />
              : <Receipt shop={shop} sale={detail} reprint />}
          </PrintPortal>
        </>
      )}
    </div>
  )
}

// เนื้อหารายละเอียดบิล (ไม่มีสถานะในตัว — แยกออกมาให้ทดสอบ/วาดซ้ำได้ง่าย)
export function BillDetailBody({
  detail,
  notice,
  canRefund,
  printBusy,
  onPrintReturn,
}: {
  detail: SaleDetail
  notice: string
  canRefund: boolean
  printBusy: boolean
  onPrintReturn(ret: SaleReturn): void
}) {
  const status = billStatus(detail)
  const refunded = detail.refunded_amount
  // เหตุผลที่ยกเลิก/คืนไม่ได้ (เฉพาะคนที่มีสิทธิ์ — คนไม่มีสิทธิ์ไม่ต้องเห็น) ไม่แสดงข้อความซ้ำกัน
  const blockHints = canRefund
    ? Array.from(new Set([
        !detail.can_void ? detail.void_block : null,
        !detail.can_return ? detail.return_block : null,
      ].filter((s): s is string => !!s && !detail.voided_at)))
    : []
  return (
    <>
      {/* ข้อมูลบิล */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={status.chipClass}>{status.label}</span>
          {detail.is_platform && <span className="chip-outline">ออเดอร์แพลตฟอร์ม</span>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-gray-500">วันที่</dt>
          <dd className="text-gray-900 tabular-nums">{formatThaiDateTime(detail.created_at)}</dd>
          <dt className="text-gray-500">ชำระโดย</dt>
          <dd className="text-gray-900">{methodLabel(detail.payment_method)}</dd>
          {detail.channel !== 'store' && (
            <>
              <dt className="text-gray-500">ช่องทาง</dt>
              <dd className="text-gray-900 break-words">
                {saleChannelLabel(detail.channel)}
                {detail.external_order_id ? ` · ${detail.external_order_id}` : ''}
              </dd>
            </>
          )}
          {detail.cashier_name && (
            <>
              <dt className="text-gray-500">พนักงาน</dt>
              <dd className="text-gray-900 break-words">{detail.cashier_name}</dd>
            </>
          )}
          {detail.note && (
            <>
              <dt className="text-gray-500">หมายเหตุ</dt>
              <dd className="text-gray-900 break-words">{detail.note}</dd>
            </>
          )}
        </dl>
      </div>

      {detail.voided_at && (
        <div className="alert-err">
          <Ban {...ICON_SM} />
          <div className="min-w-0 space-y-0.5">
            <p className="font-semibold">บิลนี้ถูกยกเลิกแล้ว — ไม่นับในยอดขาย</p>
            <p className="text-sm break-words">
              {formatThaiDateTime(detail.voided_at)}
              {detail.voided_by_name ? ` · โดย ${detail.voided_by_name}` : detail.is_platform ? ' · ยกเลิกจากออเดอร์แพลตฟอร์ม' : ''}
            </p>
            {detail.void_reason && <p className="text-sm break-words">เหตุผล: {detail.void_reason}</p>}
          </div>
        </div>
      )}

      <div aria-live="polite">
        {notice && (
          <div role="status" className="alert-ok">
            <CheckCircle2 {...ICON_SM} />
            <p className="min-w-0 break-words">{notice}</p>
          </div>
        )}
      </div>

      {/* รายการสินค้า */}
      <ul className="panel divide-y divide-gray-200 px-3.5 text-sm">
        {detail.items.map((it, i) => (
          <li key={`${it.product_id}-${i}`} className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-gray-900 break-words">{productLabel(it)}</p>
              <p className="text-xs text-gray-500 break-all">SKU {it.sku}</p>
              <p className="text-xs text-gray-500 tabular-nums">{baht(it.unit_price)} × {it.qty}</p>
              {it.returned_qty > 0 && (
                <span className="badge-return mt-1">คืนแล้ว {it.returned_qty}</span>
              )}
            </div>
            <p className={clsx('font-semibold whitespace-nowrap tabular-nums', detail.voided_at ? 'text-gray-400 line-through' : 'text-gray-900')}>
              {baht(it.subtotal)}
            </p>
          </li>
        ))}
        {detail.items.length === 0 && <li className="py-3 text-gray-500">ไม่มีรายการสินค้า</li>}
      </ul>

      {/* ยอดเงิน */}
      <div className="space-y-1 text-sm">
        <div className="flex justify-between text-gray-600">
          <span>รวม</span><span className="tabular-nums">{baht(detail.total_amount)}</span>
        </div>
        {detail.discount > 0 && (
          <div className="flex justify-between text-gray-600">
            <span>ส่วนลด</span><span className="tabular-nums">-{baht(detail.discount)}</span>
          </div>
        )}
        <div className="flex justify-between items-center gap-3 pt-1">
          <span className="text-base font-semibold text-gray-900">ยอดสุทธิ</span>
          <span className={clsx('money text-2xl', detail.voided_at ? 'text-gray-400 line-through' : 'text-brand-700')}>
            {baht(detail.net_amount)}
          </span>
        </div>
        {detail.cash_received !== null && (
          <>
            <div className="flex justify-between text-gray-600">
              <span>รับเงิน</span><span className="tabular-nums">{baht(detail.cash_received)}</span>
            </div>
            {detail.change_amount !== null && (
              <div className="flex justify-between text-gray-600">
                <span>เงินทอน</span><span className="tabular-nums">{baht(detail.change_amount)}</span>
              </div>
            )}
          </>
        )}
        {refunded > 0 && (
          <>
            <div className="flex justify-between text-amber-800">
              <span>คืนเงินแล้ว</span><span className="tabular-nums">-{baht(refunded)}</span>
            </div>
            <div className="flex justify-between font-semibold text-gray-900">
              <span>คงเหลือสุทธิ</span>
              <span className="tabular-nums">{baht(Math.max(0, round2(detail.net_amount - refunded)))}</span>
            </div>
          </>
        )}
      </div>

      {/* ประวัติการคืนสินค้า (เก่าสุดก่อน) */}
      {detail.returns.length > 0 && (
        <div className="space-y-2">
          <h4 className="section-title text-base">
            <CornerUpLeft {...ICON_SM} />
            การคืนสินค้า ({detail.returns.length})
          </h4>
          <ul className="space-y-2">
            {detail.returns.map(r => (
              <li key={r.id || r.return_no} className="panel p-3 space-y-1.5 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-gray-700 break-all">{r.return_no}</p>
                    <p className="text-xs text-gray-500 tabular-nums">
                      {formatThaiDateTime(r.created_at)}{r.created_by_name ? ` · ${r.created_by_name}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="money text-base text-gray-900">{baht(r.refund_amount)}</p>
                    <p className="text-xs text-gray-500">คืนเป็น{methodLabel(r.refund_method)}</p>
                  </div>
                </div>
                <ul className="text-xs text-gray-600 space-y-0.5">
                  {r.items.map((it, i) => (
                    <li key={`${it.product_id}-${i}`} className="flex justify-between gap-3">
                      <span className="min-w-0 break-words">{productLabel(it)} × {it.qty}</span>
                      <span className="shrink-0 tabular-nums">{baht(it.refund_amount)}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-gray-600 break-words">
                  เหตุผล: {r.reason || '-'} · {r.restock ? 'คืนเข้าสต๊อก' : 'ไม่คืนเข้าสต๊อก'}
                </p>
                <button
                  type="button"
                  onClick={() => onPrintReturn(r)}
                  disabled={printBusy}
                  className="btn-ghost -ml-3 px-3 text-sm"
                >
                  <Printer {...ICON_XS} />
                  พิมพ์ใบคืนสินค้า
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {blockHints.length > 0 && (
        <div className="space-y-1">
          {blockHints.map(h => (
            <p key={h} className="flex items-start gap-1.5 text-xs text-gray-500">
              <Info {...ICON_XS} className="mt-px shrink-0" />
              <span className="min-w-0 break-words">{h}</span>
            </p>
          ))}
        </div>
      )}
    </>
  )
}
