'use client'
// รายการเงิน · ค่าใช้จ่ายเพิ่ม · รายการส่งงาน · ประวัติงาน ของหน้ารายละเอียดงาน
// ปุ่มในแถวเรียก callback ของหน้าแม่ (ใบเสร็จ/ยกเลิก/แก้/ลบ) — สิทธิ์ยกเลิกหน้าแม่ตัดสิน (เซิร์ฟเวอร์ตรวจซ้ำเสมอ)
// สลิปโอนเงินอยู่ในถังส่วนตัว → ขอลิงก์ชั่วคราวทีละหลายไฟล์ แล้วขอใหม่เมื่อลิงก์ใกล้หมดอายุ
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, Ban, Clapperboard, ExternalLink, FileImage, History, ImageOff, Loader2, Pencil,
  Plus, Receipt, ReceiptText, Trash2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht, formatThaiDate, formatThaiDateTime } from '@/lib/format'
import {
  DELIVERABLE_STATUS_CHIP, DELIVERABLE_STATUS_LABELS, WED_CHARGE_KIND_LABELS, WED_DELIVERABLE_STATUSES, WED_METHOD_LABELS,
  WED_PAYMENT_KIND_LABELS, WED_PURPOSE_LABELS,
  type WedBooking, type WedCharge, type WedDeliverable, type WedDeliverableStatus, type WedPayment,
} from '@/lib/wedding'
import DialogShell from '@/components/rental/booking/DialogShell'
import { describeLog } from './logs'
import { isFreshSlipUrl, signWeddingSlips, type SignedSlipUrl } from './slipUrls'

// ---------------------------------------------------------------------------
// รายการเงิน
// ---------------------------------------------------------------------------
export function PaymentsCard({
  booking,
  canVoid,
  onReceipt,
  onVoid,
  onAdd,
}: {
  booking: WedBooking
  canVoid(p: WedPayment): boolean
  onReceipt(p: WedPayment): void
  onVoid(p: WedPayment): void
  onAdd?: () => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const list = useMemo(
    () => [...booking.payments].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0)),
    [booking.payments],
  )
  const slipKey = list.map(p => p.slip_path ?? '').filter(Boolean).join('|')
  const [urls, setUrls] = useState<Record<string, SignedSlipUrl>>({})
  const [viewing, setViewing] = useState<{ payment: WedPayment; url: string | null; loading: boolean } | null>(null)

  useEffect(() => {
    let alive = true
    const paths = slipKey ? slipKey.split('|') : []
    if (paths.length === 0) return
    void signWeddingSlips(supabase, paths).then(out => { if (alive) setUrls(prev => ({ ...prev, ...out })) })
    return () => { alive = false }
  }, [slipKey, supabase])

  const openSlip = useCallback(async (p: WedPayment) => {
    const path = p.slip_path
    if (!path) return
    const cur = urls[path]
    if (isFreshSlipUrl(cur)) {
      setViewing({ payment: p, url: cur.url, loading: false })
      return
    }
    setViewing({ payment: p, url: null, loading: true })
    const out = await signWeddingSlips(supabase, [path])
    setUrls(prev => ({ ...prev, ...out }))
    setViewing(v => (v && v.payment.id === p.id ? { payment: p, url: out[path]?.url ?? null, loading: false } : v))
  }, [urls, supabase])

  return (
    <section className="card" aria-labelledby="wb-payments">
      <div className="card-header">
        <h2 id="wb-payments" className="section-title">
          <Receipt {...ICON} />
          รายการเงิน
          <span className="chip">{booking.payments.length}</span>
        </h2>
        {onAdd && <button type="button" className="btn-soft min-h-[40px] px-3 text-sm" onClick={onAdd}>บันทึกเงิน</button>}
      </div>
      {list.length === 0 ? (
        <p className="empty-state">ยังไม่มีรายการเงิน</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {list.map(p => {
            const voided = !!p.voided_at
            const out = p.kind === 'refund'
            const thumb = p.slip_path ? urls[p.slip_path]?.url ?? null : null
            return (
              <li key={p.id} className={clsx('px-4 py-3 sm:px-5 space-y-2', voided && 'bg-gray-50')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={out ? 'badge-out' : 'badge-in'}>
                        {out ? <ArrowUpRight {...ICON_XS} /> : <ArrowDownLeft {...ICON_XS} />}
                        {WED_PAYMENT_KIND_LABELS[p.kind]}
                      </span>
                      <span className="chip-outline">{WED_METHOD_LABELS[p.method]}</span>
                      {p.purpose && <span className="chip-outline">{WED_PURPOSE_LABELS[p.purpose]}</span>}
                      {voided && <span className="badge-out">ยกเลิกแล้ว</span>}
                    </div>
                    <p className="text-xs text-gray-600">
                      วันที่ {formatThaiDate(p.paid_on)}
                      {p.receipt_no && <> · <span className="font-mono">{p.receipt_no}</span></>}
                      {p.created_by_name && <> · {p.created_by_name}</>}
                    </p>
                    <p className="text-[11px] text-gray-500">บันทึกเมื่อ {formatThaiDateTime(p.created_at)}</p>
                    {p.note && <p className="text-xs text-gray-700 break-words">หมายเหตุ: {p.note}</p>}
                    {voided && (
                      <p className="text-xs text-red-700 break-words">
                        ยกเลิกเมื่อ {formatThaiDateTime(p.voided_at)}{p.void_reason ? ` — ${p.void_reason}` : ''}
                      </p>
                    )}
                  </div>
                  <span className={clsx('money shrink-0 text-base', voided ? 'text-gray-400 line-through' : out ? 'text-red-700' : 'text-gray-900')}>
                    {out ? '-' : ''}{baht(p.amount)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {p.slip_path && (
                    <button
                      type="button"
                      className="flex h-11 items-center gap-2 rounded-lg border border-gray-200 bg-white pl-1 pr-3 text-sm text-gray-800"
                      onClick={() => void openSlip(p)}
                      aria-label={`ดูสลิป ${p.receipt_no ?? ''}`}
                    >
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt="" className="h-9 w-9 rounded-md object-cover" />
                      ) : (
                        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-gray-100 text-gray-500"><FileImage {...ICON_XS} /></span>
                      )}
                      สลิป
                    </button>
                  )}
                  {!voided && (
                    <button type="button" className="btn-secondary min-h-[44px] px-3 text-sm" onClick={() => onReceipt(p)}>
                      <ReceiptText {...ICON_XS} />
                      {out ? 'ใบคืนเงิน' : 'ใบเสร็จ'}
                    </button>
                  )}
                  {!voided && canVoid(p) && (
                    <button type="button" className="btn-danger-soft min-h-[44px] px-3 text-sm" onClick={() => onVoid(p)}>
                      <Ban {...ICON_XS} />
                      ยกเลิกรายการ
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {viewing && (
        <DialogShell
          title="สลิป / หลักฐานการโอน"
          subtitle={`${viewing.payment.receipt_no ?? ''} · ${baht(viewing.payment.amount)}`}
          icon={<FileImage {...ICON_SM} />}
          wide
          onClose={() => setViewing(null)}
          footer={
            <div className="flex gap-2 sm:justify-end">
              {viewing.url && (
                <a href={viewing.url} target="_blank" rel="noopener noreferrer" className="btn-secondary px-4">
                  <ExternalLink {...ICON_SM} />
                  เปิดรูปเต็ม
                </a>
              )}
              <button type="button" className="btn-primary flex-1 sm:flex-none sm:min-w-[120px]" onClick={() => setViewing(null)}>ปิด</button>
            </div>
          }
        >
          {viewing.loading ? (
            <div className="flex min-h-[200px] items-center justify-center text-gray-500" role="status">
              <Loader2 {...ICON} className="animate-spin" />
              <span className="sr-only">กำลังโหลดสลิป...</span>
            </div>
          ) : viewing.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={viewing.url} alt={`สลิป ${viewing.payment.receipt_no ?? ''}`} className="mx-auto max-h-[70dvh] w-auto rounded-lg border border-gray-200" />
          ) : (
            <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 text-center text-sm text-gray-600">
              <ImageOff {...ICON} />
              เปิดสลิปไม่ได้ (ไฟล์หาย / เน็ตหลุด / ไม่มีสิทธิ์ดู) — ลองใหม่อีกครั้ง
            </div>
          )}
        </DialogShell>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// ค่าใช้จ่ายเพิ่ม
// ---------------------------------------------------------------------------
export function ChargesCard({
  booking,
  canVoid,
  onVoid,
  onAdd,
}: {
  booking: WedBooking
  canVoid: boolean
  onVoid(c: WedCharge): void
  onAdd?: () => void
}) {
  if (booking.charges.length === 0 && !onAdd) return null
  return (
    <section className="card" aria-labelledby="wb-charges">
      <div className="card-header">
        <h2 id="wb-charges" className="section-title">
          <ReceiptText {...ICON} />
          ค่าใช้จ่ายเพิ่ม
        </h2>
        {onAdd && <button type="button" className="btn-soft min-h-[40px] px-3 text-sm" onClick={onAdd}>เพิ่ม</button>}
      </div>
      {booking.charges.length === 0 ? (
        <p className="empty-state">ยังไม่มีค่าใช้จ่ายเพิ่ม (ล่วงเวลา / เดินทางเพิ่ม / บริการเพิ่ม)</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {booking.charges.map(c => {
            const voided = !!c.voided_at
            return (
              <li key={c.id} className={clsx('px-4 py-3 sm:px-5', voided && 'bg-gray-50')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium text-gray-900 break-words">{c.description}</p>
                    <p className="text-xs text-gray-600">
                      {WED_CHARGE_KIND_LABELS[c.kind]} · {formatThaiDateTime(c.created_at)}{c.created_by_name ? ` · ${c.created_by_name}` : ''}
                    </p>
                    {voided && <p className="text-xs text-red-700 break-words">ยกเลิกแล้ว{c.void_reason ? ` — ${c.void_reason}` : ''}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className={clsx('money', voided ? 'text-gray-400 line-through' : 'text-gray-900')}>{baht(c.amount)}</span>
                    {!voided && canVoid && (
                      <button type="button" className="btn-danger-soft min-h-[40px] px-3 text-sm" onClick={() => onVoid(c)}>
                        <Ban {...ICON_XS} />
                        ยกเลิก
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// รายการส่งงาน (เปลี่ยนสถานะในแถวได้ทันที · "ส่งแล้ว" ที่ยังไม่มีลิงก์/หมายเหตุ → เปิดป็อปอัปให้ใส่ก่อน)
// ---------------------------------------------------------------------------
export function DeliverablesCard({
  booking,
  canEdit,
  onAdd,
  onEdit,
  onDelete,
  onQuickStatus,
}: {
  booking: WedBooking
  canEdit: boolean
  onAdd(): void
  onEdit(d: WedDeliverable, presetStatus?: WedDeliverableStatus): void
  onDelete(d: WedDeliverable): void
  /** เปลี่ยนสถานะทันที → ข้อความผิดพลาด หรือ null เมื่อสำเร็จ */
  onQuickStatus(d: WedDeliverable, status: WedDeliverableStatus): Promise<string | null>
}) {
  const selectBase = useId()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null)
  const s = booking.deliverables_summary

  async function change(d: WedDeliverable, next: WedDeliverableStatus) {
    if (busyId || next === d.status) return
    if (next === 'delivered' && !d.link_url && !d.note) {
      onEdit(d, 'delivered')
      return
    }
    setBusyId(d.id)
    setRowError(null)
    try {
      const err = await onQuickStatus(d, next)
      if (err) setRowError({ id: d.id, text: err })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="card" aria-labelledby="wb-deliverables">
      <div className="card-header">
        <h2 id="wb-deliverables" className="section-title">
          <Clapperboard {...ICON} />
          งานที่ต้องส่ง
          {s.total > 0 && <span className="chip">{s.delivered}/{s.total}</span>}
        </h2>
        {canEdit && (
          <button type="button" className="btn-soft min-h-[40px] px-3 text-sm" onClick={onAdd}>
            <Plus {...ICON_XS} />
            เพิ่ม
          </button>
        )}
      </div>
      {booking.deliverables.length === 0 ? (
        <p className="empty-state">
          {booking.deliverables_plan.length > 0 && (booking.status === 'inquiry' || booking.status === 'hold')
            ? 'ระบบจะสร้างรายการส่งงานจากแพ็กเกจให้เมื่อยืนยันงาน'
            : 'ยังไม่มีรายการส่งงาน'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {booking.deliverables.map(d => {
            const busy = busyId === d.id
            return (
              <li key={d.id} className={clsx('px-4 py-3 sm:px-5 space-y-2', d.overdue && 'bg-red-50')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold text-gray-900 break-words">
                      {d.name}{d.qty > 1 || d.unit ? <span className="font-normal text-gray-600"> · {d.qty} {d.unit ?? ''}</span> : null}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={DELIVERABLE_STATUS_CHIP[d.status]}>{DELIVERABLE_STATUS_LABELS[d.status]}</span>
                      {d.overdue && <span className="badge-out"><AlertTriangle {...ICON_XS} />เลยกำหนด</span>}
                      <span className="text-xs text-gray-600">
                        {d.status === 'delivered' && d.delivered_at
                          ? `ส่งเมื่อ ${formatThaiDateTime(d.delivered_at)}`
                          : d.due_date ? `กำหนดส่ง ${formatThaiDate(d.due_date)}` : 'ไม่ระบุกำหนดส่ง'}
                      </span>
                    </div>
                    {d.editor_name && <p className="text-xs text-gray-600">ผู้ตัดต่อ: {d.editor_name}</p>}
                    {d.note && <p className="text-xs text-gray-700 whitespace-pre-line break-words">{d.note}</p>}
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 gap-1">
                      <button type="button" className="btn-icon btn-icon-plain" aria-label={`แก้ ${d.name}`} onClick={() => onEdit(d)} disabled={busy}>
                        <Pencil {...ICON_SM} />
                      </button>
                      <button type="button" className="btn-icon btn-icon-plain" aria-label={`ลบ ${d.name}`} onClick={() => onDelete(d)} disabled={busy}>
                        <Trash2 {...ICON_SM} />
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canEdit && (
                    <div className="flex items-center gap-2">
                      <label htmlFor={`${selectBase}-${d.id}`} className="sr-only">สถานะของ {d.name}</label>
                      <select
                        id={`${selectBase}-${d.id}`}
                        className="input min-h-[44px] w-auto py-1.5 pr-8 text-sm"
                        value={d.status}
                        disabled={busy}
                        onChange={e => void change(d, e.target.value as WedDeliverableStatus)}
                      >
                        {WED_DELIVERABLE_STATUSES.map(st => <option key={st} value={st}>{DELIVERABLE_STATUS_LABELS[st]}</option>)}
                      </select>
                      {busy && <Loader2 {...ICON_SM} className="animate-spin text-gray-500" aria-label="กำลังบันทึก" />}
                    </div>
                  )}
                  {d.link_url && (
                    <a href={d.link_url} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-[44px] px-3 text-sm">
                      <ExternalLink {...ICON_XS} />
                      เปิดลิงก์งาน
                    </a>
                  )}
                </div>
                {rowError?.id === d.id && <p role="alert" className="text-xs font-medium text-red-700 break-words">{rowError.text}</p>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// ประวัติงาน (ใหม่ก่อน) — แสดง 10 รายการแรก กดดูทั้งหมดได้
// ---------------------------------------------------------------------------
const LOG_PREVIEW = 10

export function TimelineCard({ booking }: { booking: WedBooking }) {
  const [all, setAll] = useState(false)
  const logs = all ? booking.logs : booking.logs.slice(0, LOG_PREVIEW)
  return (
    <section className="card" aria-labelledby="wb-logs">
      <div className="card-header">
        <h2 id="wb-logs" className="section-title">
          <History {...ICON} />
          ประวัติงาน
        </h2>
      </div>
      {booking.logs.length === 0 ? (
        <p className="empty-state">ยังไม่มีประวัติ</p>
      ) : (
        <>
          <ol className="px-4 py-3 sm:px-5">
            {logs.map((log, i) => {
              const v = describeLog(log, baht, formatThaiDate, formatThaiDateTime)
              return (
                <li key={`${log.created_at}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < logs.length - 1 && <span aria-hidden="true" className="absolute left-[5px] top-4 bottom-0 w-px bg-gray-200" />}
                  <span
                    aria-hidden="true"
                    className={clsx('relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2', i === 0 ? 'border-brand-600 bg-brand-100' : 'border-gray-300 bg-white')}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">{v.label}</p>
                    {v.lines.map((line, j) => <p key={j} className="text-xs text-gray-700 break-words">{line}</p>)}
                    <p className="text-xs text-gray-500">{formatThaiDateTime(log.created_at)}{log.actor_name ? ` · ${log.actor_name}` : ''}</p>
                  </div>
                </li>
              )
            })}
          </ol>
          {booking.logs.length > LOG_PREVIEW && (
            <div className="border-t border-gray-100 px-4 py-2 sm:px-5">
              <button type="button" className="btn-ghost min-h-[44px] w-full text-sm" onClick={() => setAll(v => !v)} aria-expanded={all}>
                {all ? 'ย่อประวัติ' : `ดูประวัติทั้งหมด (${booking.logs.length} รายการ)`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
