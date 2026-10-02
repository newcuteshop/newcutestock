'use client'
// แท็บ "ออเดอร์": ออเดอร์จากช่องทางนี้ + ที่ต้องดูแล (ขายเกิน / จับคู่ไม่ได้ / รอยืนยันรับของคืน / สถานะไม่รู้จัก)
// ขายเกิน = แถบแดง (ระบบตัดเท่าที่มี และส่ง 0 ไปทุกช่องทางแล้ว) ; คืนสต๊อกจากการคืนของต้องให้แอดมินยืนยันจำนวนที่ได้รับจริง
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  AlertTriangle, BellOff, Loader2, Minus, PackageX, Plus, ReceiptText, RefreshCw, ShoppingBag, Undo2,
} from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { baht, formatThaiDateTime, thaiError } from '@/lib/format'
import type {
  ChannelJson, OrderJson, OrderLineJson, OrderListFilter, OrderPage, ResolveOrderAction,
} from '@/lib/integrations/types'
import { confirmReturn, resolveOrder } from '@/app/(dashboard)/settings/integrations/actions'
import { AttentionPill, FlashMessage, OrderStatusPill, type Flash } from './bits'
import ConfirmDialog from './ConfirmDialog'
import { qty } from './format'
import { callAction, useRunner } from './useAction'
import { useQueryNav } from './useQueryNav'

const PAGE = 50

const FILTERS: { value: OrderListFilter; label: string }[] = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'attention', label: 'ต้องดูแล' },
  { value: 'oversold', label: 'ขายเกิน' },
  { value: 'unmapped', label: 'จับคู่ไม่ได้' },
  { value: 'return', label: 'รอยืนยันรับคืน' },
  { value: 'shadow', label: 'โหมดทดลอง' },
  { value: 'open', label: 'ยังไม่จบ' },
]

function filterCount(channel: ChannelJson, f: OrderListFilter): number | null {
  const c = channel.counts
  if (!c) return null
  if (f === 'attention') return c.orders_attention
  if (f === 'oversold') return c.oversold_orders
  if (f === 'unmapped') return c.unmapped_orders
  if (f === 'return') return c.return_to_confirm
  return null
}

const SOURCE_LABEL: Record<string, string> = {
  webhook: 'webhook', poll: 'ดึงอัตโนมัติ', csv: 'CSV', manual: 'บันทึกเอง', admin: 'แอดมิน',
}

const RESOLVE_DONE: Record<ResolveOrderAction, string> = {
  reprocess: 'ประมวลผลใหม่แล้ว',
  waive_owed: 'ยกเลิกยอดค้างส่งแล้ว — ไม่ตัดชิ้นที่ขายเกิน',
  track_stock: 'เปลี่ยนเป็นตัดสต๊อกจริงแล้ว',
  dismiss: 'ปิดการแจ้งเตือนแล้ว',
}

function returnish(o: OrderJson): boolean {
  return o.attention_reasons.includes('return_to_confirm')
    || o.status === 'return_requested' || o.status === 'returned'
    || ((o.status === 'cancelled' || o.status === 'expired') && !!o.shipped_at)
}

export default function OrdersTab({
  channel, page, filter, loadError,
}: {
  channel: ChannelJson
  page: OrderPage | null
  filter: OrderListFilter
  loadError: string | null
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const basePath = `/settings/integrations/${channel.id}`
  const nav = useQueryNav(basePath, { tab: 'orders', filter: filter === 'all' ? null : filter })
  const { busy, run } = useRunner()

  const [rows, setRows] = useState<OrderJson[]>(page?.rows ?? [])
  const [nextBefore, setNextBefore] = useState<string | null>(page?.next_before ?? null)
  const [topFlash, setTopFlash] = useState<Flash | null>(loadError ? { ok: false, text: loadError } : null)
  const [orderFlash, setOrderFlash] = useState<Record<string, Flash>>({})
  const [loadingMore, setLoadingMore] = useState(false)
  const [confirm, setConfirm] = useState<{ order: OrderJson; action: 'waive_owed' | 'track_stock' } | null>(null)

  useEffect(() => {
    setRows(page?.rows ?? [])
    setNextBefore(page?.next_before ?? null)
  }, [page])

  function flashOrder(id: string, f: Flash | null) {
    setOrderFlash(prev => {
      const n = { ...prev }
      if (f) n[id] = f
      else delete n[id]
      return n
    })
  }
  function patchOrder(o: OrderJson) {
    setRows(prev => prev.map(r => (r.id === o.id ? o : r)))
  }

  async function doResolve(o: OrderJson, action: ResolveOrderAction) {
    flashOrder(o.id, null)
    await run(`${action}:${o.id}`, async () => {
      const res = await callAction(() => resolveOrder(o.id, action))
      setConfirm(null)
      if (!res.ok) { flashOrder(o.id, { ok: false, text: res.error }); return }
      if (res.order && typeof res.order === 'object') patchOrder(res.order)
      const extra = [
        res.deducted ? `ตัดสต๊อก ${qty(res.deducted)} ชิ้น` : '',
        res.restocked ? `คืนสต๊อก ${qty(res.restocked)} ชิ้น` : '',
      ].filter(Boolean).join(' · ')
      flashOrder(o.id, { ok: true, text: extra ? `${RESOLVE_DONE[action]} · ${extra}` : RESOLVE_DONE[action] })
      router.refresh()
    })
  }

  async function doReturn(o: OrderJson, line: OrderLineJson, total: number) {
    flashOrder(o.id, null)
    await run(`return:${line.id}`, async () => {
      const res = await callAction(() => confirmReturn(line.id, total))
      if (!res.ok) { flashOrder(o.id, { ok: false, text: res.error }); return }
      if (res.order && typeof res.order === 'object') patchOrder(res.order)
      flashOrder(o.id, { ok: true, text: `บันทึกรับของคืนแล้ว · คืนสต๊อก ${qty(res.restocked)} ชิ้น` })
      router.refresh()
    })
  }

  async function loadMore() {
    if (!nextBefore || loadingMore) return
    setLoadingMore(true)
    try {
      const { data, error } = await supabase.rpc('list_channel_orders', {
        p_channel_id: channel.id, p_filter: filter, p_limit: PAGE, p_before: nextBefore,
      })
      if (error) throw error
      const pg = data as OrderPage | null
      if (pg && Array.isArray(pg.rows)) {
        setRows(prev => {
          const seen = new Set(prev.map(r => r.id))
          return [...prev, ...pg.rows.filter(r => !seen.has(r.id))]
        })
        setNextBefore(pg.next_before ?? null)
      }
    } catch (e) {
      setTopFlash({ ok: false, text: thaiError(e) })
    } finally {
      setLoadingMore(false)
    }
  }

  const oversoldCount = channel.counts?.oversold_orders ?? 0

  return (
    <div className="space-y-4 sm:space-y-6">
      {oversoldCount > 0 && (
        <div role="alert" className="alert-err">
          <PackageX size={18} strokeWidth={1.9} aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold">ขายเกิน {qty(oversoldCount)} ออเดอร์</p>
            <p>
              สต๊อกไม่พอตอนออเดอร์เข้า ระบบตัดเท่าที่มีและส่ง 0 ของสินค้านั้นไปทุกช่องทางแล้ว — หาของมาเติมแล้วกด
              &quot;ประมวลผลใหม่&quot; หรือถ้ายกเลิกกับลูกค้าแล้วกด &quot;ไม่ต้องตัดชิ้นที่ขายเกิน&quot;
            </p>
          </div>
        </div>
      )}

      <div className="-mx-1 flex gap-2 overflow-x-auto scrollbar-none px-1 pb-1 md:flex-wrap md:overflow-visible" role="group" aria-label="ตัวกรองออเดอร์">
        {FILTERS.map(f => {
          const n = filterCount(channel, f.value)
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => nav.go({ filter: f.value === 'all' ? null : f.value })}
              className="chip-toggle shrink-0"
            >
              {f.label}
              {n !== null && n > 0 && <span className="tabular-nums opacity-80">{qty(n)}</span>}
            </button>
          )
        })}
        {nav.pending && <Loader2 {...ICON_SM} className="animate-spin self-center text-brand-600" />}
      </div>

      <FlashMessage flash={topFlash} />

      {rows.length === 0 ? (
        <div className="card empty-state">
          <span className="icon-bubble icon-bubble-lg"><ShoppingBag size={28} strokeWidth={1.75} aria-hidden="true" /></span>
          <p className="empty-state-title">{filter === 'all' ? 'ยังไม่มีออเดอร์จากช่องทางนี้' : 'ไม่มีออเดอร์ตามตัวกรองนี้'}</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:gap-4 xl:grid-cols-2">
          {rows.map(o => (
            <OrderCard
              key={o.id}
              o={o}
              busy={busy}
              flash={orderFlash[o.id] ?? null}
              onResolve={action => {
                if (action === 'waive_owed' || action === 'track_stock') setConfirm({ order: o, action })
                else void doResolve(o, action)
              }}
              onReturn={(line, total) => doReturn(o, line, total)}
            />
          ))}
        </ul>
      )}

      {nextBefore && rows.length > 0 && (
        <button type="button" onClick={loadMore} disabled={loadingMore} className="btn-secondary w-full">
          {loadingMore ? <Loader2 {...ICON_SM} className="animate-spin" /> : <RefreshCw {...ICON_SM} />}
          โหลดเพิ่ม
        </button>
      )}

      <ConfirmDialog
        open={confirm?.action === 'waive_owed'}
        title={`ไม่ตัดชิ้นที่ขายเกินของออเดอร์ #${confirm?.order.external_order_id ?? ''}?`}
        tone="danger"
        confirmLabel="ไม่ต้องตัดชิ้นที่ขายเกิน"
        busy={!!confirm && busy === `waive_owed:${confirm.order.id}`}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { if (confirm) void doResolve(confirm.order, 'waive_owed') }}
      >
        <p>ใช้เมื่อยกเลิก/คืนเงินชิ้นที่ขาดกับลูกค้าแล้ว — ยอดค้างส่งของออเดอร์นี้จะหายไป และสต๊อกกลับไปส่งตามจำนวนจริงอีกครั้ง</p>
        <p>ถ้าจะหาของมาส่งลูกค้า ให้รับสินค้าเข้าสต๊อกก่อน แล้วกด &quot;ประมวลผลใหม่&quot; แทน</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm?.action === 'track_stock'}
        title={`ตัดสต๊อกจริงสำหรับออเดอร์ #${confirm?.order.external_order_id ?? ''}?`}
        confirmLabel="ตัดสต๊อกจริง"
        busy={!!confirm && busy === `track_stock:${confirm.order.id}`}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { if (confirm) void doResolve(confirm.order, 'track_stock') }}
      >
        <p>ออเดอร์นี้เข้ามาตอนเปิดโหมดทดลอง (ยังไม่ตัดสต๊อก) — กดแล้วจะตัดสต๊อกตามออเดอร์ทันทีและสร้างบิลขาย</p>
      </ConfirmDialog>
    </div>
  )
}

function OrderCard({
  o, busy, flash, onResolve, onReturn,
}: {
  o: OrderJson
  busy: string | null
  flash: Flash | null
  onResolve: (action: ResolveOrderAction) => void
  onReturn: (line: OrderLineJson, total: number) => void
}) {
  const locked = busy !== null
  const oversold = o.lines.reduce((s, l) => s + (l.qty_oversold ?? 0), 0)
  const shadow = o.stock_tracking === 'shadow'
  const showReturns = returnish(o) && !shadow
  const at = o.platform_created_at ?? o.created_at

  return (
    <li className={clsx('card p-4 space-y-3', o.has_oversold && 'border-red-300')}>
      <div className="space-y-0.5">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 font-semibold text-gray-900 [overflow-wrap:anywhere]">#{o.external_order_id}</p>
          <span className="shrink-0"><OrderStatusPill status={o.status} /></span>
        </div>
        <p className="text-xs text-gray-500 break-words">
          {formatThaiDateTime(at)}
          {o.last_source && <> · {SOURCE_LABEL[o.last_source] ?? o.last_source}</>}
          {o.raw_status && <> · <span className="font-mono [overflow-wrap:anywhere]">{o.raw_status}</span></>}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {o.attention_reasons.map(r => <AttentionPill key={r} reason={r} />)}
        {shadow && <span className="chip-outline text-amber-800">โหมดทดลอง (ยังไม่ตัดสต๊อก)</span>}
        {o.sale_no && (
          <span className={clsx('chip-outline', o.sale_voided_at && 'line-through')}>
            <ReceiptText size={14} strokeWidth={2} aria-hidden="true" />
            บิล {o.sale_no}
          </span>
        )}
        {o.sale_voided_at && <span className="chip-outline text-gray-600">บิลถูกยกเลิก</span>}
        {o.items_total !== null && <span className="chip-outline tabular-nums">{baht(o.items_total)}</span>}
      </div>

      {o.has_oversold && oversold > 0 && (
        <div role="alert" className="alert-err">
          <PackageX size={18} strokeWidth={1.9} aria-hidden="true" />
          <p className="min-w-0">
            ขายเกิน {qty(oversold)} ชิ้น — สต๊อกไม่พอ ระบบตัดเท่าที่มี และส่ง 0 ไปทุกช่องทางแล้ว
          </p>
        </div>
      )}

      <ul className="panel divide-y divide-gray-200 px-3">
        {o.lines.map(line => (
          <OrderLine
            key={line.id}
            line={line}
            showReturn={showReturns}
            busy={busy}
            onReturn={total => onReturn(line, total)}
          />
        ))}
      </ul>

      <FlashMessage flash={flash} />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap [&>button]:w-full sm:[&>button]:w-auto">
        {(o.has_unmapped || o.has_oversold || o.attention_reasons.includes('unmapped_sku')) && (
          <button type="button" onClick={() => onResolve('reprocess')} disabled={locked} className="btn-soft px-4">
            {busy === `reprocess:${o.id}` ? <Loader2 {...ICON_SM} className="animate-spin" /> : <RefreshCw {...ICON_SM} />}
            ประมวลผลใหม่
          </button>
        )}
        {o.has_oversold && (
          <button type="button" onClick={() => onResolve('waive_owed')} disabled={locked} className="btn-secondary px-4">
            <PackageX {...ICON_SM} />
            ไม่ต้องตัดชิ้นที่ขายเกิน
          </button>
        )}
        {shadow && (
          <button type="button" onClick={() => onResolve('track_stock')} disabled={locked} className="btn-secondary px-4">
            <ShoppingBag {...ICON_SM} />
            ตัดสต๊อกจริง
          </button>
        )}
        {o.needs_attention && (
          <button type="button" onClick={() => onResolve('dismiss')} disabled={locked} className="btn-ghost px-4">
            {busy === `dismiss:${o.id}` ? <Loader2 {...ICON_SM} className="animate-spin" /> : <BellOff {...ICON_SM} />}
            ปิดการแจ้งเตือน
          </button>
        )}
      </div>
      {o.attention_reasons.includes('unknown_status') && (
        <p className="flex items-start gap-1.5 text-xs text-amber-800">
          <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" className="mt-0.5" />
          <span className="min-w-0">สถานะจากแพลตฟอร์มที่ระบบไม่รู้จัก ({o.raw_status ?? '-'}) — ไม่ได้แตะสต๊อก ตรวจที่หน้าร้านของแพลตฟอร์ม</span>
        </p>
      )}
    </li>
  )
}

function OrderLine({
  line, showReturn, busy, onReturn,
}: {
  line: OrderLineJson
  showReturn: boolean
  busy: string | null
  onReturn: (total: number) => void
}) {
  const received = line.qty_returned_received ?? 0
  const max = line.max_return_receivable ?? 0
  const [total, setTotal] = useState(received)
  useEffect(() => { setTotal(received) }, [received])
  const canReturn = showReturn && !!line.product && max > received
  const label = line.product?.label ?? line.external_name ?? line.external_sku ?? 'ไม่ทราบสินค้า'
  const sku = line.product?.sku ?? line.external_sku

  return (
    <li className="py-2.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 break-words">{label}</p>
          <p className="text-xs text-gray-500 font-mono break-all">
            {sku ?? '-'}
            {!line.product && <span className="font-sans font-semibold text-amber-800"> · ยังไม่จับคู่</span>}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold tabular-nums text-gray-900">× {qty(line.qty)}</p>
          {line.unit_price !== null && <p className="text-xs text-gray-500 tabular-nums">{baht(line.unit_price)}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <span className="text-gray-600">ตัดแล้ว <b className="tabular-nums text-gray-900">{qty(line.held)}</b></span>
        {line.qty_oversold > 0 && <span className="font-semibold text-red-700">ขายเกิน <b className="tabular-nums">{qty(line.qty_oversold)}</b></span>}
        {line.qty_cancelled > 0 && <span className="text-gray-600">ยกเลิก <b className="tabular-nums">{qty(line.qty_cancelled)}</b></span>}
        {line.qty_waived > 0 && <span className="text-gray-600">ไม่ตัด <b className="tabular-nums">{qty(line.qty_waived)}</b></span>}
        {(received > 0 || line.platform_qty_returned > 0) && (
          <span className="text-amber-800">
            คืนแล้ว <b className="tabular-nums">{qty(received)}</b>
            {line.platform_qty_returned > 0 && <> / แพลตฟอร์มแจ้ง {qty(line.platform_qty_returned)}</>}
          </span>
        )}
      </div>
      {canReturn && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-amber-800">
            <Undo2 size={16} strokeWidth={2} aria-hidden="true" />
            รับของคืนแล้ว (รวม)
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTotal(t => Math.max(received, t - 1))}
              disabled={total <= received || busy !== null}
              aria-label="ลดจำนวนที่รับคืน"
              className="btn-icon"
            >
              <Minus {...ICON_SM} />
            </button>
            <span className="w-10 text-center text-lg font-semibold tabular-nums text-gray-900" aria-live="polite">{total}</span>
            <button
              type="button"
              onClick={() => setTotal(t => Math.min(max, t + 1))}
              disabled={total >= max || busy !== null}
              aria-label="เพิ่มจำนวนที่รับคืน"
              className="btn-icon"
            >
              <Plus {...ICON_SM} />
            </button>
            <span className="text-xs text-amber-800">จาก {qty(max)}</span>
          </div>
          <button
            type="button"
            onClick={() => onReturn(total)}
            disabled={total <= received || busy !== null}
            className="btn-soft px-4 ml-auto"
          >
            {busy === `return:${line.id}` ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Undo2 {...ICON_SM} />}
            ยืนยันรับคืน {total > received ? `+${total - received}` : ''}
          </button>
        </div>
      )}
    </li>
  )
}
