'use client'
// การส่งสต๊อกของช่องทาง
// - ยังไม่เคยส่ง: ตาราง "ก่อน/หลัง" + ยืนยันแบบเข้ม (ติ๊กยืนยัน) → "ส่งสต๊อกครั้งแรก" (ทับสต๊อกบนแพลตฟอร์ม)
// - ส่งแล้ว: "ซิงก์ตอนนี้" + "ลองส่งงานที่ล้มเหลวใหม่"
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  AlertTriangle, ArrowDown, ArrowUp, Check, Equal, HelpCircle, Loader2, RefreshCw, RotateCcw, Send, Upload, X,
} from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { formatThaiDateTime } from '@/lib/format'
import { PLATFORM_META } from '@/lib/integrations/platforms'
import type { ChannelJson, InitialPushPreview, InitialPushPreviewRow } from '@/lib/integrations/types'
import { retryFailed, runInitialPush, syncNow } from '@/app/(dashboard)/settings/integrations/actions'
import { FlashMessage, type Flash } from './bits'
import ConfirmDialog from './ConfirmDialog'
import { qty, relativeThai } from './format'
import { callAction, useRunner } from './useAction'

type Change = 'increase' | 'decrease' | 'same' | 'unknown'
function changeOf(r: InitialPushPreviewRow): Change {
  if (r.platform_qty === null || r.platform_qty === undefined) return 'unknown'
  if (r.push_qty > r.platform_qty) return 'increase'
  if (r.push_qty < r.platform_qty) return 'decrease'
  return 'same'
}
const CHANGE_LABEL: Record<Change, string> = { increase: 'เพิ่ม', decrease: 'ลด', same: 'เท่าเดิม', unknown: 'ไม่ทราบ' }

export default function StockPushPanel({
  channel, preview, nowMs, compact = false, variant = 'card',
}: {
  channel: ChannelJson
  preview: InitialPushPreview | null
  nowMs: number
  compact?: boolean
  /** 'toolbar' = ส่งครั้งแรกแล้ว แสดงแค่ปุ่มซิงก์/ลองใหม่ (ใช้ในแท็บจับคู่สินค้า) ; ยังไม่เคยส่ง = การ์ดเต็มเสมอ */
  variant?: 'card' | 'toolbar'
}) {
  const router = useRouter()
  const meta = PLATFORM_META[channel.platform]
  const { busy, run } = useRunner()
  const [flash, setFlash] = useState<Flash | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)

  if (!meta.capabilities.pushStock) return null

  const counts = channel.counts
  const failed = (counts?.outbox_failed ?? 0) + (counts?.outbox_dead ?? 0)
  const done = channel.options.initial_push_done
  const connected = channel.status === 'connected'
  const mappedCount = counts?.mapped ?? 0
  const pushableCount = preview?.rows.length ?? mappedCount
  const pre = [
    { ok: connected, label: 'เชื่อมต่อแล้ว (ทดสอบการเชื่อมต่อผ่าน)' },
    { ok: channel.options.push_stock, label: 'เปิด "ส่งสต๊อกไปแพลตฟอร์ม" ในตัวเลือกแล้ว' },
    { ok: pushableCount > 0, label: 'จับคู่สินค้าแล้วอย่างน้อย 1 รายการ (และเปิดส่งสต๊อกรายการนั้น)' },
  ]
  const ready = pre.every(p => p.ok)
  const canSync = done && ['connected', 'error'].includes(channel.status)

  async function doInitial() {
    await run('initial', async () => {
      const res = await callAction(() => runInitialPush(channel.id))
      setConfirmOpen(false)
      if (!res.ok) { setFlash({ ok: false, text: res.error }); router.refresh(); return }
      const rest = res.enqueued - res.pushed - res.failed
      setFlash({
        ok: res.failed === 0,
        text: `ส่งสต๊อกครั้งแรกแล้ว: สำเร็จ ${qty(res.pushed)} รายการ`
          + (res.failed > 0 ? ` · ล้มเหลว ${qty(res.failed)} (ดูบันทึกการซิงก์)` : '')
          + (rest > 0 ? ` · ที่เหลือ ${qty(rest)} รายการระบบจะส่งต่อเอง` : ''),
      })
      router.refresh()
    })
  }

  async function doSync() {
    setFlash(null)
    await run('sync', async () => {
      const res = await callAction(() => syncNow(channel.id))
      if (!res.ok) { setFlash({ ok: false, text: res.error }); router.refresh(); return }
      setFlash({
        ok: res.failed === 0,
        text: res.message || `ส่งสต๊อก ${qty(res.pushed)} รายการ${res.failed ? ` · ล้มเหลว ${qty(res.failed)}` : ''} · ดึงออเดอร์ ${qty(res.ordersPulled)} รายการ`,
      })
      router.refresh()
    })
  }

  async function doRetry() {
    setFlash(null)
    await run('retry', async () => {
      const res = await callAction(() => retryFailed(channel.id))
      if (!res.ok) { setFlash({ ok: false, text: res.error }); return }
      setFlash({ ok: true, text: `ส่งงานที่ล้มเหลวเข้าคิวใหม่ ${qty(res.requeued)} รายการ — ระบบจะส่งในรอบถัดไป` })
      router.refresh()
    })
  }

  const rows = preview?.rows ?? []
  const summary = preview?.summary
  const shownRows = showAll ? rows : rows.slice(0, compact ? 5 : 20)

  if (done && variant === 'toolbar') {
    return (
      <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button type="button" onClick={doSync} disabled={!canSync || busy !== null} className="btn-secondary w-full sm:w-auto px-5">
            {busy === 'sync' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <RefreshCw {...ICON_SM} />}
            ซิงก์ตอนนี้
          </button>
          {failed > 0 && (
            <button type="button" onClick={doRetry} disabled={busy !== null} className="btn-secondary w-full sm:w-auto px-5">
              {busy === 'retry' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <RotateCcw {...ICON_SM} />}
              ลองส่งงานที่ล้มเหลวใหม่ ({qty(failed)})
            </button>
          )}
        </div>
        <FlashMessage flash={flash} />
      </div>
    )
  }

  return (
    <section className="card p-4 sm:p-5 space-y-4" aria-labelledby={`push-${channel.id}`}>
      <h2 id={`push-${channel.id}`} className="section-title">
        <Upload {...ICON} className="text-brand-600" />
        ส่งสต๊อกไป {meta.label}
      </h2>

      {!done ? (
        <>
          <div className="alert-warn">
            <AlertTriangle size={18} strokeWidth={1.9} aria-hidden="true" />
            <div className="min-w-0 space-y-1">
              <p className="font-semibold">ยังไม่เคยส่งสต๊อกไปช่องทางนี้</p>
              <p>
                ตอนกด &quot;ส่งสต๊อกครั้งแรก&quot; สต๊อกบนแพลตฟอร์มจะถูกแทนที่ด้วยสต๊อกในแอปทั้งหมด —
                นับสต๊อกจริงในแอปให้ตรงก่อน หลังจากนั้นระบบจะส่งให้เองทุกครั้งที่สต๊อกเปลี่ยน
              </p>
            </div>
          </div>

          <ul className="space-y-1.5" aria-label="เงื่อนไขก่อนส่งสต๊อกครั้งแรก">
            {pre.map(p => (
              <li key={p.label} className="flex items-start gap-2 text-sm">
                <span
                  aria-hidden="true"
                  className={clsx(
                    'mt-0.5 inline-grid h-5 w-5 shrink-0 place-items-center rounded-full',
                    p.ok ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500',
                  )}
                >
                  {p.ok ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}
                </span>
                <span className={clsx('min-w-0', p.ok ? 'text-gray-900' : 'text-gray-600')}>
                  {p.label}
                  <span className="sr-only">{p.ok ? ' (ผ่าน)' : ' (ยังไม่ผ่าน)'}</span>
                </span>
              </li>
            ))}
          </ul>

          {summary && summary.total > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="สรุปการเปลี่ยนแปลง">
              <span className="chip tabular-nums">ทั้งหมด {qty(summary.total)}</span>
              <span className="chip-outline tabular-nums text-green-800">เพิ่ม {qty(summary.increase)}</span>
              <span className="chip-outline tabular-nums text-red-700">ลด {qty(summary.decrease)}</span>
              <span className="chip-outline tabular-nums">เท่าเดิม {qty(summary.same)}</span>
              <span className="chip-outline tabular-nums">ไม่ทราบ {qty(summary.unknown)}</span>
            </div>
          )}

          {rows.length > 0 && (
            <PreviewTable rows={shownRows} />
          )}
          {rows.length > shownRows.length && (
            <button type="button" onClick={() => setShowAll(true)} className="btn-ghost w-full">
              ดูทั้งหมด {qty(rows.length)} รายการ
            </button>
          )}

          <FlashMessage flash={flash} />

          <button
            type="button"
            onClick={() => { setFlash(null); setConfirmOpen(true) }}
            disabled={!ready || busy !== null}
            className="btn-primary w-full sm:w-auto px-6"
          >
            <Send {...ICON_SM} />
            ส่งสต๊อกครั้งแรก
          </button>
          {!ready && <p className="text-xs text-gray-500">ทำเงื่อนไขด้านบนให้ครบก่อนจึงกดได้</p>}

          <ConfirmDialog
            open={confirmOpen}
            title={`ส่งสต๊อกครั้งแรกไป ${channel.display_name}?`}
            tone="danger"
            wide
            confirmLabel="ส่งสต๊อกครั้งแรก"
            busy={busy === 'initial'}
            requireAck="นับสต๊อกในแอปตรงกับของจริงแล้ว และเข้าใจว่าสต๊อกบนแพลตฟอร์มจะถูกแทนที่ทันที"
            onCancel={() => setConfirmOpen(false)}
            onConfirm={doInitial}
          >
            <p>
              สต๊อกของสินค้าที่จับคู่ไว้ {qty(pushableCount)} รายการ บน {meta.label} จะถูก<b>แทนที่</b>ด้วยจำนวนในแอป
              (หักกันสต๊อก {qty(channel.options.stock_buffer)} ชิ้น) — ย้อนกลับอัตโนมัติไม่ได้
            </p>
            {summary && (
              <p>
                เพิ่ม {qty(summary.increase)} · <span className="font-semibold text-red-700">ลด {qty(summary.decrease)}</span> ·
                เท่าเดิม {qty(summary.same)} · ไม่ทราบสต๊อกเดิม {qty(summary.unknown)}
              </p>
            )}
            {summary && summary.decrease > 0 && (
              <p className="alert-warn">
                <AlertTriangle size={18} strokeWidth={1.9} aria-hidden="true" />
                <span className="min-w-0">มี {qty(summary.decrease)} รายการที่สต๊อกบนแพลตฟอร์มจะลดลง ตรวจตาราง &quot;ก่อน/หลัง&quot; ให้แน่ใจก่อน</span>
              </p>
            )}
          </ConfirmDialog>
        </>
      ) : (
        <>
          <p className="text-sm text-gray-600">
            ส่งสต๊อกครั้งแรกแล้วเมื่อ {formatThaiDateTime(channel.options.initial_push_at)} — ระบบส่งให้เองทุกครั้งที่สต๊อกเปลี่ยน
            {channel.last_stock_push_at && <> · ส่งล่าสุด {relativeThai(channel.last_stock_push_at, nowMs)}</>}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <Box label="รอส่ง" value={qty(counts?.outbox_pending ?? 0)} />
            <Box label="ล้มเหลว" value={qty(failed)} bad={failed > 0} />
            <Box label="จับคู่แล้ว" value={`${qty(counts?.mapped ?? 0)}/${qty(counts?.listings ?? 0)}`} />
          </div>
          {!channel.options.push_stock && (
            <p className="alert-warn">
              <AlertTriangle size={18} strokeWidth={1.9} aria-hidden="true" />
              <span className="min-w-0">ปิด &quot;ส่งสต๊อกไปแพลตฟอร์ม&quot; อยู่ — สต๊อกจะไม่ถูกส่งจนกว่าจะเปิดในตัวเลือก</span>
            </p>
          )}
          <FlashMessage flash={flash} />
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button type="button" onClick={doSync} disabled={!canSync || busy !== null} className="btn-soft w-full sm:w-auto px-5">
              {busy === 'sync' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <RefreshCw {...ICON_SM} />}
              ซิงก์ตอนนี้
            </button>
            {failed > 0 && (
              <button type="button" onClick={doRetry} disabled={busy !== null} className="btn-secondary w-full sm:w-auto px-5">
                {busy === 'retry' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <RotateCcw {...ICON_SM} />}
                ลองส่งงานที่ล้มเหลวใหม่ ({qty(failed)})
              </button>
            )}
          </div>
          {!canSync && (
            <p className="text-xs text-gray-500">ซิงก์ได้เมื่อสถานะเป็น &quot;เชื่อมต่อแล้ว&quot; หรือ &quot;มีข้อผิดพลาด&quot;</p>
          )}
        </>
      )}
    </section>
  )
}

function Box({ label, value, bad = false }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="panel px-3 py-2 min-w-0">
      <p className="text-xs text-gray-500 truncate">{label}</p>
      <p className={clsx('font-display text-base font-bold tabular-nums truncate', bad ? 'text-red-700' : 'text-gray-900')}>{value}</p>
    </div>
  )
}

const CHANGE_ICON = { increase: ArrowUp, decrease: ArrowDown, same: Equal, unknown: HelpCircle } as const

function PreviewTable({ rows }: { rows: InitialPushPreviewRow[] }) {
  return (
    <>
      {/* มือถือ: รายการ "ก่อน → หลัง" (ไม่ต้องเลื่อนข้าง) */}
      <ul className="panel divide-y divide-blush-hair px-3 sm:hidden" aria-label="สต๊อกบนแพลตฟอร์มตอนนี้ เทียบกับจำนวนที่จะส่ง">
        {rows.map(r => {
          const ch = changeOf(r)
          const Icon = CHANGE_ICON[ch]
          return (
            <li key={r.listing_id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 break-words">{r.product.label}</p>
                <p className="text-xs font-mono text-gray-500 break-all">{r.product.sku}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-display font-bold tabular-nums text-gray-900">
                  <span className="text-gray-500">{r.platform_qty === null ? '?' : qty(r.platform_qty)}</span>
                  <span aria-hidden="true"> → </span>
                  <span className="sr-only"> เป็น </span>
                  {qty(r.push_qty)}
                </p>
                <p
                  className={clsx(
                    'inline-flex items-center gap-1 text-xs font-semibold',
                    ch === 'decrease' ? 'text-red-700' : ch === 'increase' ? 'text-green-800' : 'text-gray-600',
                  )}
                >
                  <Icon size={12} strokeWidth={2.4} aria-hidden="true" />
                  {CHANGE_LABEL[ch]}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
      <div className="card overflow-hidden hidden sm:block">
      <div className="table-wrap">
        <table className="table-soft min-w-[400px]">
          <caption className="sr-only">สต๊อกบนแพลตฟอร์มตอนนี้ เทียบกับจำนวนที่จะส่ง</caption>
          <thead>
            <tr>
              <th>สินค้า</th>
              <th className="text-right">บนแพลตฟอร์ม (ก่อน)</th>
              <th className="text-right">จะส่ง (หลัง)</th>
              <th>เปลี่ยน</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const ch = changeOf(r)
              const Icon = CHANGE_ICON[ch]
              return (
                <tr key={r.listing_id}>
                  <td className="max-w-[220px] !px-3">
                    <p className="font-medium text-gray-900 break-words">{r.product.label}</p>
                    <p className="text-xs text-gray-500 font-mono break-all">{r.product.sku}{r.external_sku && r.external_sku !== r.product.sku ? ` · ${r.external_sku}` : ''}</p>
                  </td>
                  <td className="text-right tabular-nums whitespace-nowrap">{r.platform_qty === null ? '-' : qty(r.platform_qty)}</td>
                  <td className="text-right tabular-nums whitespace-nowrap font-semibold text-gray-900">{qty(r.push_qty)}</td>
                  <td className="whitespace-nowrap">
                    <span
                      className={clsx(
                        'inline-flex items-center gap-1 text-xs font-semibold',
                        ch === 'decrease' ? 'text-red-700' : ch === 'increase' ? 'text-green-800' : 'text-gray-600',
                      )}
                    >
                      <Icon size={14} strokeWidth={2.2} aria-hidden="true" />
                      {CHANGE_LABEL[ch]}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
    </>
  )
}
