'use client'
// แท็บ "บันทึกการซิงก์": ประวัติการส่งสต๊อก/ดึงออเดอร์/webhook/ทดสอบ ฯลฯ (ข้อความไทย + รายละเอียดที่ตัดความลับแล้ว)
import { useEffect, useId, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { CheckCircle2, History, Loader2, RefreshCw, RotateCcw, XCircle } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { formatThaiDateTime, thaiError } from '@/lib/format'
import { displayLogin } from '@/lib/auth/credentials'
import { SYNC_LOG_KIND_LABELS } from '@/lib/integrations/platforms'
import type { ChannelJson, SyncLogKind, SyncLogPage, SyncLogRow } from '@/lib/integrations/types'
import { retryFailed } from '@/app/(dashboard)/settings/integrations/actions'
import { FlashMessage, type Flash } from './bits'
import { qty } from './format'
import { callAction, useRunner } from './useAction'
import { useQueryNav } from './useQueryNav'

const PAGE = 100
const KINDS = Object.keys(SYNC_LOG_KIND_LABELS) as SyncLogKind[]

export default function SyncLogTab({
  channel, page, kind, onlyErrors, loadError,
}: {
  channel: ChannelJson
  page: SyncLogPage | null
  kind: SyncLogKind | null
  onlyErrors: boolean
  loadError: string | null
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const selectId = useId()
  const basePath = `/settings/integrations/${channel.id}`
  const nav = useQueryNav(basePath, { tab: 'log', kind: kind ?? null, errors: onlyErrors ? '1' : null })
  const { busy, run } = useRunner()

  const [rows, setRows] = useState<SyncLogRow[]>(page?.rows ?? [])
  const [nextBefore, setNextBefore] = useState<number | null>(page?.next_before_id ?? null)
  const [flash, setFlash] = useState<Flash | null>(loadError ? { ok: false, text: loadError } : null)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    setRows(page?.rows ?? [])
    setNextBefore(page?.next_before_id ?? null)
  }, [page])

  async function loadMore() {
    if (nextBefore === null || loadingMore) return
    setLoadingMore(true)
    try {
      const { data, error } = await supabase.rpc('list_sync_log', {
        p_channel_id: channel.id, p_kind: kind, p_only_errors: onlyErrors, p_limit: PAGE, p_before_id: nextBefore,
      })
      if (error) throw error
      const pg = data as SyncLogPage | null
      if (pg && Array.isArray(pg.rows)) {
        setRows(prev => {
          const seen = new Set(prev.map(r => r.id))
          return [...prev, ...pg.rows.filter(r => !seen.has(r.id))]
        })
        setNextBefore(pg.next_before_id ?? null)
      }
    } catch (e) {
      setFlash({ ok: false, text: thaiError(e) })
    } finally {
      setLoadingMore(false)
    }
  }

  async function onRetry() {
    setFlash(null)
    await run('retry', async () => {
      const res = await callAction(() => retryFailed(channel.id))
      if (!res.ok) { setFlash({ ok: false, text: res.error }); return }
      setFlash({ ok: true, text: `ส่งงานที่ล้มเหลวเข้าคิวใหม่ ${qty(res.requeued)} รายการ` })
      router.refresh()
    })
  }

  const failed = (channel.counts?.outbox_failed ?? 0) + (channel.counts?.outbox_dead ?? 0)

  return (
    <div className="space-y-4 sm:space-y-6">
      <section className="card p-4 sm:p-5 space-y-3" aria-label="ตัวกรองบันทึก">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="sm:w-64">
            <label htmlFor={selectId} className="block text-sm font-medium text-gray-700 mb-1">ประเภท</label>
            <select
              id={selectId}
              className="input"
              value={kind ?? ''}
              onChange={e => nav.go({ kind: e.target.value || null })}
            >
              <option value="">ทั้งหมด</option>
              {KINDS.map(k => <option key={k} value={k}>{SYNC_LOG_KIND_LABELS[k]}</option>)}
            </select>
          </div>
          <button
            type="button"
            aria-pressed={onlyErrors}
            onClick={() => nav.go({ errors: onlyErrors ? null : '1' })}
            className="chip-toggle self-start sm:self-auto"
          >
            <XCircle size={16} strokeWidth={2} aria-hidden="true" />
            เฉพาะที่ล้มเหลว
          </button>
          {nav.pending && <Loader2 {...ICON_SM} className="animate-spin text-brand-600 self-center" />}
          {failed > 0 && (
            <button type="button" onClick={onRetry} disabled={busy !== null} className="btn-secondary w-full sm:w-auto sm:ml-auto px-5">
              {busy === 'retry' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <RotateCcw {...ICON_SM} />}
              ลองส่งงานที่ล้มเหลวใหม่ ({qty(failed)})
            </button>
          )}
        </div>
        <FlashMessage flash={flash} />
      </section>

      {rows.length === 0 ? (
        <div className="card empty-state">
          <span className="icon-bubble icon-bubble-lg"><History size={30} strokeWidth={1.8} aria-hidden="true" /></span>
          <p className="empty-state-title">ยังไม่มีบันทึก{kind || onlyErrors ? 'ตามตัวกรองนี้' : ''}</p>
        </div>
      ) : (
        <ul className="card divide-y divide-blush-hair overflow-hidden">
          {rows.map(r => <LogRow key={r.id} r={r} />)}
        </ul>
      )}

      {nextBefore !== null && rows.length > 0 && (
        <button type="button" onClick={loadMore} disabled={loadingMore} className="btn-secondary w-full">
          {loadingMore ? <Loader2 {...ICON_SM} className="animate-spin" /> : <RefreshCw {...ICON_SM} />}
          โหลดเพิ่ม
        </button>
      )}
    </div>
  )
}

function LogRow({ r }: { r: SyncLogRow }) {
  const hasDetail = !!r.detail && typeof r.detail === 'object' && Object.keys(r.detail).length > 0
  let detailText = ''
  if (hasDetail) {
    try { detailText = JSON.stringify(r.detail, null, 2) } catch { detailText = '' }
  }
  // actor_name = ชื่อจริง หรืออีเมลเมื่อไม่มีชื่อ (max@newcute.com → max)
  const actor = r.actor_name ? (r.actor_name.includes('@') ? displayLogin(r.actor_name) : r.actor_name) : null
  return (
    <li className="px-4 py-3 space-y-1.5">
      <div className="flex items-start gap-2.5">
        {r.ok
          ? <CheckCircle2 size={18} strokeWidth={1.9} aria-hidden="true" className="mt-0.5 shrink-0 text-green-700" />
          : <XCircle size={18} strokeWidth={1.9} aria-hidden="true" className="mt-0.5 shrink-0 text-red-700" />}
        <div className="min-w-0 flex-1">
          <p className={clsx('text-sm break-words', r.ok ? 'text-gray-900' : 'font-medium text-red-800')}>
            <span className="sr-only">{r.ok ? 'สำเร็จ: ' : 'ล้มเหลว: '}</span>
            {r.summary}
          </p>
          <p className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-gray-500">
            <span>{formatThaiDateTime(r.created_at)}</span>
            <span className="font-semibold text-brand-700">{SYNC_LOG_KIND_LABELS[r.kind] ?? r.kind}</span>
            {actor && <span>โดย {actor}</span>}
            {r.duration_ms !== null && r.duration_ms !== undefined && <span className="tabular-nums">{qty(r.duration_ms)} ms</span>}
          </p>
        </div>
      </div>
      {hasDetail && detailText && (
        <details className="group pl-7">
          <summary className="inline-flex min-h-[44px] cursor-pointer select-none items-center text-xs font-semibold text-brand-700">
            รายละเอียด
          </summary>
          <pre className="panel mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all p-3 text-xs leading-relaxed text-gray-700">
            {detailText}
          </pre>
        </details>
      )}
    </li>
  )
}
