'use client'
// แท็บ "จับคู่สินค้า": รายการบนแพลตฟอร์ม (1 แถว = 1 ไซส์) ↔ สินค้าในแอป
// จับคู่อัตโนมัติด้วย SKU (ตรงตัว ไม่สนตัวพิมพ์เล็ก-ใหญ่) + เลือกเองได้ + ปิดการซิงก์รายตัว + กันสต๊อกรายตัว
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  AlertTriangle, DownloadCloud, EyeOff, Link2, Link2Off, Loader2, RefreshCw, ScanSearch, Search, SearchX, Shirt,
} from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { productLabel, thaiError } from '@/lib/format'
import { PLATFORM_META } from '@/lib/integrations/platforms'
import type {
  ChannelJson, InitialPushPreview, ListingFilter, ListingJson, ListingPage,
} from '@/lib/integrations/types'
import {
  autoMatch, resolveOrder, setListingOptions, setMapping,
} from '@/app/(dashboard)/settings/integrations/actions'
import { FlashMessage, MappingPill, type Flash } from './bits'
import ProductPicker, { type PickedProduct } from './ProductPicker'
import StockPushPanel from './StockPushPanel'
import { qty, relativeThai } from './format'
import { callAction, useRunner } from './useAction'
import { useQueryNav } from './useQueryNav'

const PAGE = 100

const FILTERS: { value: ListingFilter; label: string }[] = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'todo', label: 'ต้องจัดการ' },
  { value: 'unmapped', label: 'ยังไม่จับคู่' },
  { value: 'mapped', label: 'จับคู่แล้ว' },
  { value: 'conflict', label: 'SKU ซ้ำ' },
  { value: 'ignored', label: 'ไม่ซิงก์' },
  { value: 'gone', label: 'หายจากแพลตฟอร์ม' },
  { value: 'errors', label: 'ส่งไม่สำเร็จ' },
]

function filterCount(channel: ChannelJson, f: ListingFilter): number | null {
  const c = channel.counts
  if (!c) return null
  switch (f) {
    case 'all': return c.listings
    case 'todo': return c.unmapped + c.conflict
    case 'unmapped': return c.unmapped
    case 'mapped': return c.mapped
    case 'conflict': return c.conflict
    case 'ignored': return c.ignored
    case 'gone': return c.gone
    case 'errors': return c.push_errors
    default: return null
  }
}

export default function MappingTab({
  channel, page, filter, q, preview, nowMs, loadError,
}: {
  channel: ChannelJson
  page: ListingPage | null
  filter: ListingFilter
  q: string
  preview: InitialPushPreview | null
  nowMs: number
  loadError: string | null
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const meta = PLATFORM_META[channel.platform]
  const basePath = `/settings/integrations/${channel.id}`
  const nav = useQueryNav(basePath, { tab: 'mapping', filter: filter === 'all' ? null : filter, q: q || null })
  const { busy, run } = useRunner()

  const [rows, setRows] = useState<ListingJson[]>(page?.rows ?? [])
  const [total, setTotal] = useState(page?.total ?? 0)
  const [search, setSearch] = useState(q)
  const [topFlash, setTopFlash] = useState<Flash | null>(loadError ? { ok: false, text: loadError } : null)
  const [rowFlash, setRowFlash] = useState<Record<string, Flash>>({})
  const [affected, setAffected] = useState<Record<string, string[]>>({})
  const [bufferDraft, setBufferDraft] = useState<Record<string, string>>({})
  const [pickerFor, setPickerFor] = useState<ListingJson | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  // หน้าโหลดข้อมูลใหม่ (router.refresh / เปลี่ยนตัวกรอง) → ใช้ชุดใหม่
  useEffect(() => {
    setRows(page?.rows ?? [])
    setTotal(page?.total ?? 0)
  }, [page])
  useEffect(() => { setSearch(q) }, [q])

  function patchRow(l: ListingJson) {
    setRows(prev => prev.map(r => (r.id === l.id ? { ...r, ...l } : r)))
  }
  function flashRow(id: string, f: Flash | null) {
    setRowFlash(prev => {
      const n = { ...prev }
      if (f) n[id] = f
      else delete n[id]
      return n
    })
  }

  async function onAutoMatch(refetch: boolean) {
    setTopFlash(null)
    await run(refetch ? 'refetch' : 'automatch', async () => {
      const res = await callAction(() => autoMatch(channel.id, { refetch }))
      if (!res.ok) { setTopFlash({ ok: false, text: res.error }); router.refresh(); return }
      const parts = [
        refetch ? `ดึงมา ${qty(res.fetched)} รายการ` : null,
        `จับคู่แล้ว ${qty(res.mapped)}`,
        `ยังไม่จับคู่ ${qty(res.unmapped)}`,
        res.conflict ? `SKU ซ้ำ ${qty(res.conflict)}` : null,
        res.gone ? `หายจากแพลตฟอร์ม ${qty(res.gone)}` : null,
        `(เปลี่ยน ${qty(res.changed)} รายการ)`,
      ].filter(Boolean)
      setTopFlash({ ok: true, text: parts.join(' · ') })
      router.refresh()
    })
  }

  async function doMapping(l: ListingJson, productId: string | null, ignore: boolean, doneText: string) {
    flashRow(l.id, null)
    await run(`map:${l.id}`, async () => {
      const res = await callAction(() => setMapping(l.id, productId, ignore))
      if (!res.ok) { flashRow(l.id, { ok: false, text: res.error }); return }
      patchRow(res.listing)
      const ids = Array.isArray(res.affectedOrderIds) ? res.affectedOrderIds : []
      setAffected(prev => {
        const n = { ...prev }
        if (ids.length > 0) n[l.id] = ids
        else delete n[l.id]
        return n
      })
      flashRow(l.id, { ok: true, text: doneText })
      setPickerFor(null)
      router.refresh()
    })
  }

  async function onPick(p: PickedProduct) {
    if (!pickerFor) return
    await doMapping(pickerFor, p.id, false, `จับคู่กับ ${productLabel(p)} แล้ว`)
  }

  async function onTogglePush(l: ListingJson) {
    flashRow(l.id, null)
    await run(`push:${l.id}`, async () => {
      const res = await callAction(() => setListingOptions(l.id, { pushEnabled: !l.push_enabled }))
      if (!res.ok) { flashRow(l.id, { ok: false, text: res.error }); return }
      patchRow(res.listing)
      router.refresh()
    })
  }

  async function onSaveBuffer(l: ListingJson) {
    const raw = (bufferDraft[l.id] ?? '').trim()
    let value: number | null = null
    if (raw !== '') {
      if (!/^\d+$/.test(raw) || Number(raw) > 1000) { flashRow(l.id, { ok: false, text: 'กันสต๊อกรายตัวต้องเป็น 0–1000 (เว้นว่าง = ใช้ค่าของช่องทาง)' }); return }
      value = Number(raw)
    }
    flashRow(l.id, null)
    await run(`buf:${l.id}`, async () => {
      const res = await callAction(() => setListingOptions(l.id, { bufferOverride: value }))
      if (!res.ok) { flashRow(l.id, { ok: false, text: res.error }); return }
      patchRow(res.listing)
      setBufferDraft(prev => { const n = { ...prev }; delete n[l.id]; return n })
      flashRow(l.id, { ok: true, text: value === null ? 'ใช้ค่ากันสต๊อกของช่องทางแล้ว' : `กันสต๊อกรายการนี้ ${value} ชิ้นแล้ว` })
      router.refresh()
    })
  }

  async function onReprocess(l: ListingJson) {
    const ids = affected[l.id] ?? []
    if (ids.length === 0) return
    flashRow(l.id, null)
    await run(`reproc:${l.id}`, async () => {
      let deducted = 0
      let failed = 0
      let lastError = ''
      for (const id of ids) {
        const res = await callAction(() => resolveOrder(id, 'reprocess'))
        if (res.ok) deducted += res.deducted
        else { failed++; lastError = res.error }
      }
      setAffected(prev => { const n = { ...prev }; delete n[l.id]; return n })
      flashRow(l.id, failed > 0
        ? { ok: false, text: `ประมวลผลไม่สำเร็จ ${failed} ออเดอร์: ${lastError}` }
        : { ok: true, text: `ประมวลผลออเดอร์ที่ค้าง ${ids.length} รายการแล้ว · ตัดสต๊อก ${qty(deducted)} ชิ้น` })
      router.refresh()
    })
  }

  async function loadMore() {
    if (loadingMore) return
    setLoadingMore(true)
    try {
      const { data, error } = await supabase.rpc('list_channel_listings', {
        p_channel_id: channel.id, p_filter: filter, p_search: q || null, p_limit: PAGE, p_offset: rows.length,
      })
      if (error) throw error
      const pg = data as ListingPage | null
      if (pg && Array.isArray(pg.rows)) {
        setRows(prev => {
          const seen = new Set(prev.map(r => r.id))
          return [...prev, ...pg.rows.filter(r => !seen.has(r.id))]
        })
        setTotal(pg.total)
      }
    } catch (e) {
      setTopFlash({ ok: false, text: thaiError(e) })
    } finally {
      setLoadingMore(false)
    }
  }

  const canPush = meta.capabilities.pushStock
  const primaryRefetch = meta.capabilities.catalog

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* ยังไม่เคยส่งสต๊อก = กล่อง "ส่งสต๊อกครั้งแรก" (ก่อน/หลัง) อยู่บนสุด */}
      {canPush && !channel.options.initial_push_done && (
        <StockPushPanel channel={channel} preview={preview} nowMs={nowMs} />
      )}

      <section className="card p-4 sm:p-5 space-y-4" aria-labelledby="mapping-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="mapping-title" className="section-title">
            <Link2 {...ICON} className="text-brand-600" />
            จับคู่สินค้า
          </h2>
          {channel.last_catalog_sync_at && (
            <span className="text-xs text-gray-500">ดึงรายการล่าสุด {relativeThai(channel.last_catalog_sync_at, nowMs)}</span>
          )}
        </div>
        <p className="text-sm text-gray-600">
          ระบบจับคู่ให้เองเมื่อ SKU บนแพลตฟอร์มตรงกับ SKU ในแอปทุกตัวอักษร (ไม่สนตัวพิมพ์เล็ก-ใหญ่) —
          ที่ไม่ตรงให้กด &quot;เลือกสินค้า&quot; เอง การจับคู่ที่เลือกเองจะไม่ถูกเปลี่ยนอัตโนมัติ
        </p>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {primaryRefetch && (
            <button type="button" onClick={() => onAutoMatch(true)} disabled={busy !== null} className="btn-primary w-full sm:w-auto px-5">
              {busy === 'refetch' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <DownloadCloud {...ICON_SM} />}
              ดึงรายการจากแพลตฟอร์ม
            </button>
          )}
          <button
            type="button"
            onClick={() => onAutoMatch(false)}
            disabled={busy !== null}
            className={clsx(primaryRefetch ? 'btn-secondary' : 'btn-primary', 'w-full sm:w-auto px-5')}
          >
            {busy === 'automatch' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <ScanSearch {...ICON_SM} />}
            จับคู่อัตโนมัติด้วย SKU
          </button>
        </div>
        {canPush && channel.options.initial_push_done && (
          <StockPushPanel channel={channel} preview={null} nowMs={nowMs} variant="toolbar" />
        )}
        {primaryRefetch && channel.platform === 'line' && (
          <p className="text-xs text-gray-500">LINE ไม่อนุญาตให้ดึงรายการทั้งหมดบ่อยๆ — กดเฉพาะตอนเพิ่ม/แก้สินค้าบน LINE SHOPPING</p>
        )}
        <FlashMessage flash={topFlash} />

        {/* ตัวกรอง */}
        <div className="-mx-1 flex gap-2 overflow-x-auto scrollbar-none px-1 pb-1 md:flex-wrap md:overflow-visible" role="group" aria-label="ตัวกรองรายการ">
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
                {n !== null && <span className="tabular-nums opacity-80">{qty(n)}</span>}
              </button>
            )
          })}
        </div>

        <form
          role="search"
          onSubmit={e => { e.preventDefault(); nav.go({ q: search.trim() || null }) }}
          className="flex items-center gap-2"
        >
          <div className="input-icon flex-1 min-w-0">
            <Search {...ICON_SM} />
            <input
              type="search"
              className="input pl-11"
              placeholder="ค้นหา SKU หรือชื่อ"
              value={search}
              onChange={e => setSearch(e.target.value)}
              enterKeyHint="search"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-label="ค้นหารายการ"
            />
          </div>
          <button type="submit" className="btn-secondary shrink-0 px-4" disabled={nav.pending}>
            {nav.pending ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Search {...ICON_SM} />}
            ค้นหา
          </button>
        </form>
      </section>

      {rows.length === 0 ? (
        <div className="card empty-state">
          <span className="icon-bubble icon-bubble-lg">
            {q || filter !== 'all' ? <SearchX size={28} strokeWidth={1.75} aria-hidden="true" /> : <Shirt size={28} strokeWidth={1.75} aria-hidden="true" />}
          </span>
          <p className="empty-state-title">
            {q || filter !== 'all' ? 'ไม่พบรายการตามตัวกรองนี้' : 'ยังไม่มีรายการจากแพลตฟอร์ม'}
          </p>
          {!q && filter === 'all' && (
            <p>
              {primaryRefetch
                ? 'กด "ดึงรายการจากแพลตฟอร์ม" เพื่อโหลดสินค้าบนแพลตฟอร์มมาจับคู่'
                : 'รายการจะขึ้นเองเมื่อนำเข้า CSV ออเดอร์ที่มี SKU (แท็บตั้งค่า > ทางสำรอง)'}
            </p>
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-600" aria-live="polite">แสดง {qty(rows.length)} จาก {qty(total)} รายการ</p>
          <ul className="grid gap-3 sm:gap-4 xl:grid-cols-2">
            {rows.map(l => (
              <ListingCard
                key={l.id}
                l={l}
                channel={channel}
                nowMs={nowMs}
                busy={busy}
                flash={rowFlash[l.id] ?? null}
                affectedCount={(affected[l.id] ?? []).length}
                bufferDraft={bufferDraft[l.id]}
                onBufferDraft={v => setBufferDraft(prev => ({ ...prev, [l.id]: v }))}
                onPick={() => { flashRow(l.id, null); setPickerFor(l) }}
                onUnmap={() => doMapping(l, null, false, 'ยกเลิกการจับคู่แล้ว')}
                onIgnore={() => doMapping(l, null, true, 'ตั้งเป็น "ไม่ซิงก์" แล้ว — รายการนี้จะไม่ถูกส่งสต๊อก')}
                onUnignore={() => doMapping(l, null, false, 'เลิก "ไม่ซิงก์" แล้ว — กดจับคู่อัตโนมัติหรือเลือกสินค้าต่อได้')}
                onTogglePush={() => onTogglePush(l)}
                onSaveBuffer={() => onSaveBuffer(l)}
                onReprocess={() => onReprocess(l)}
              />
            ))}
          </ul>
          {rows.length < total && (
            <button type="button" onClick={loadMore} disabled={loadingMore} className="btn-secondary w-full">
              {loadingMore ? <Loader2 {...ICON_SM} className="animate-spin" /> : <RefreshCw {...ICON_SM} />}
              โหลดเพิ่ม ({qty(total - rows.length)} รายการ)
            </button>
          )}
        </>
      )}

      <ProductPicker
        open={pickerFor !== null}
        title={pickerFor ? `เลือกสินค้าในแอปให้ ${pickerFor.external_name ?? pickerFor.external_sku ?? 'รายการนี้'}${pickerFor.external_variant_name ? ` · ${pickerFor.external_variant_name}` : ''}` : ''}
        initialQuery={pickerFor?.external_sku ?? ''}
        busy={pickerFor !== null && busy === `map:${pickerFor.id}`}
        onPick={onPick}
        onClose={() => setPickerFor(null)}
      />
    </div>
  )
}

function ListingCard({
  l, channel, nowMs, busy, flash, affectedCount, bufferDraft,
  onBufferDraft, onPick, onUnmap, onIgnore, onUnignore, onTogglePush, onSaveBuffer, onReprocess,
}: {
  l: ListingJson
  channel: ChannelJson
  nowMs: number
  busy: string | null
  flash: Flash | null
  affectedCount: number
  bufferDraft: string | undefined
  onBufferDraft: (v: string) => void
  onPick: () => void
  onUnmap: () => void
  onIgnore: () => void
  onUnignore: () => void
  onTogglePush: () => void
  onSaveBuffer: () => void
  onReprocess: () => void
}) {
  const meta = PLATFORM_META[channel.platform]
  const mapped = l.mapping_status === 'mapped' && l.product
  const rowBusy = busy !== null && busy.endsWith(`:${l.id}`)
  const locked = busy !== null
  const owed = l.owed_qty ?? 0
  const bufferShown = bufferDraft ?? (l.buffer_override === null ? '' : String(l.buffer_override))
  const bufferDirty = bufferDraft !== undefined && bufferDraft.trim() !== (l.buffer_override === null ? '' : String(l.buffer_override))

  return (
    <li className={clsx('card p-4 space-y-3', l.mapping_status === 'conflict' && 'border-red-200', owed > 0 && 'border-red-300')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-[12rem]">
          <p className="font-medium text-gray-900 break-words">
            {l.external_name || 'ไม่มีชื่อ'}
            {l.external_variant_name && <span className="text-gray-600"> · {l.external_variant_name}</span>}
          </p>
          <p className="text-xs text-gray-500 break-all">
            SKU บนแพลตฟอร์ม: <span className="font-mono text-gray-700">{l.external_sku || '-'}</span>
            {l.match_source && <> · {l.match_source === 'auto' ? 'จับคู่อัตโนมัติ' : 'เลือกเอง'}</>}
          </p>
        </div>
        <MappingPill status={l.mapping_status} />
      </div>

      {/* สินค้าในแอป */}
      <div className={clsx('rounded-lg border px-3 py-2.5', mapped ? 'border-gray-150 bg-gray-50' : 'border-dashed border-brand-400 bg-white')}>
        {mapped && l.product ? (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-gray-500">สินค้าในแอป</p>
              <p className="text-sm font-medium text-gray-900 break-words">{l.product.label || productLabel(l.product)}</p>
              <p className="text-xs font-mono text-gray-500 break-all">{l.product.sku}</p>
            </div>
            {!l.product.is_active && <span className="chip-outline shrink-0 text-amber-800">ปิดขาย (ส่ง 0)</span>}
          </div>
        ) : (
          <p className="text-sm text-gray-600">
            {l.mapping_status === 'conflict'
              ? 'SKU นี้ตรงกับสินค้าในแอปมากกว่า 1 ตัว — เลือกเองว่าคือตัวไหน'
              : l.mapping_status === 'ignored'
                ? 'ไม่ซิงก์รายการนี้ (ไม่ส่งสต๊อก ออเดอร์ที่มีรายการนี้จะรอจับคู่)'
                : l.mapping_status === 'gone'
                  ? 'รายการนี้ไม่มีบนแพลตฟอร์มแล้ว'
                  : 'ยังไม่ได้เลือกสินค้าในแอป'}
          </p>
        )}
      </div>

      {/* ตัวเลข */}
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="panel px-2 py-1.5">
          <dt className="text-xs text-gray-500">บนแพลตฟอร์ม</dt>
          <dd className="font-semibold tabular-nums text-gray-900">{l.platform_qty === null ? '-' : qty(l.platform_qty)}</dd>
        </div>
        <div className="panel px-2 py-1.5">
          <dt className="text-xs text-gray-500">ในแอป</dt>
          <dd className="font-semibold tabular-nums text-gray-900">{l.product ? qty(l.product.stock_qty) : '-'}</dd>
        </div>
        <div className="panel px-2 py-1.5">
          <dt className="text-xs text-gray-500">จะส่ง</dt>
          <dd className="font-semibold tabular-nums text-brand-700">{l.push_qty === null ? '-' : qty(l.push_qty)}</dd>
        </div>
      </dl>
      {owed > 0 && (
        <p className="flex items-start gap-1.5 text-sm font-semibold text-red-700">
          <AlertTriangle {...ICON_SM} className="mt-0.5" />
          <span className="min-w-0">ค้างส่ง {qty(owed)} ชิ้น (ขายเกิน) — ส่ง 0 ไปทุกช่องทางจนกว่าจะเคลียร์ในแท็บออเดอร์</span>
        </p>
      )}

      {/* ผลการส่งล่าสุด */}
      {(l.last_pushed_at || l.last_error) && (
        <div className="text-xs space-y-0.5">
          {l.last_pushed_at && (
            <p className="text-gray-500">ส่งล่าสุด {qty(l.last_pushed_qty)} ชิ้น · {relativeThai(l.last_pushed_at, nowMs)}</p>
          )}
          {l.last_error && (
            <p className="text-red-700 break-words">ส่งไม่สำเร็จ{l.last_error_at ? ` (${relativeThai(l.last_error_at, nowMs)})` : ''}: {l.last_error}</p>
          )}
        </div>
      )}

      <FlashMessage flash={flash} />

      {affectedCount > 0 && (
        <div className="alert-warn">
          <AlertTriangle size={18} strokeWidth={1.9} aria-hidden="true" />
          <div className="min-w-0 space-y-2">
            <p>มีออเดอร์ที่ค้างเพราะรายการนี้ {qty(affectedCount)} รายการ — ประมวลผลใหม่เพื่อตัดสต๊อกตามการจับคู่ล่าสุด</p>
            <button type="button" onClick={onReprocess} disabled={locked} className="btn-soft w-full sm:w-auto px-4">
              {busy === `reproc:${l.id}` ? <Loader2 {...ICON_SM} className="animate-spin" /> : <RefreshCw {...ICON_SM} />}
              ประมวลผลออเดอร์ที่ค้าง {qty(affectedCount)} รายการ
            </button>
          </div>
        </div>
      )}

      {/* ปุ่ม — มือถือ 2 คอลัมน์ ไม่ให้ข้อความปุ่มตัดบรรทัด */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap [&>button]:whitespace-nowrap">
        {l.mapping_status === 'ignored' ? (
          <button type="button" onClick={onUnignore} disabled={locked} className="btn-secondary col-span-2 px-4">
            {rowBusy && busy?.startsWith('map:') ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Link2 {...ICON_SM} />}
            เลิกไม่ซิงก์
          </button>
        ) : (
          <>
            <button type="button" onClick={onPick} disabled={locked} className={clsx(mapped ? 'btn-secondary' : 'btn-soft', 'px-3 sm:px-4')}>
              <Search {...ICON_SM} />
              {mapped ? 'เปลี่ยนสินค้า' : 'เลือกสินค้า'}
            </button>
            {mapped && (
              <button type="button" onClick={onUnmap} disabled={locked} className="btn-ghost px-3 sm:px-4">
                {rowBusy && busy?.startsWith('map:') ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Link2Off {...ICON_SM} />}
                ยกเลิกจับคู่
              </button>
            )}
            <button type="button" onClick={onIgnore} disabled={locked} className="btn-ghost px-3 sm:px-4">
              <EyeOff {...ICON_SM} />
              ไม่ซิงก์
            </button>
          </>
        )}
      </div>

      {/* ส่งสต๊อกรายตัว + กันสต๊อกรายตัว (เฉพาะที่จับคู่แล้ว และแพลตฟอร์มส่งสต๊อกได้) */}
      {mapped && meta.capabilities.pushStock && (
        <div className="grid gap-2 sm:grid-cols-2 border-t border-gray-150 pt-3">
          <button
            type="button"
            role="switch"
            aria-checked={l.push_enabled}
            onClick={onTogglePush}
            disabled={locked}
            className={clsx(
              'flex w-full min-h-[44px] items-center justify-between gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors disabled:opacity-60',
              l.push_enabled ? 'border-green-200 bg-green-50 text-green-800' : 'border-gray-300 bg-white text-gray-700 active:bg-gray-100',
            )}
          >
            <span className="min-w-0 truncate">ส่งสต๊อกรายการนี้</span>
            {busy === `push:${l.id}` ? (
              <Loader2 {...ICON_SM} className="animate-spin" />
            ) : (
              <span aria-hidden="true" className={clsx('switch switch-sm switch-leaf', l.push_enabled && 'switch-on')}>
                <span className="switch-knob" />
              </span>
            )}
          </button>
          <div className="flex items-center gap-2">
            <label htmlFor={`buf-${l.id}`} className="shrink-0 text-sm text-gray-700">กันสต๊อก</label>
            <input
              id={`buf-${l.id}`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="input min-w-0 flex-1 text-center tabular-nums"
              placeholder={`${channel.options.stock_buffer}`}
              value={bufferShown}
              disabled={locked}
              aria-describedby={`buf-help-${l.id}`}
              onChange={e => onBufferDraft(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
            />
            <button type="button" onClick={onSaveBuffer} disabled={locked || !bufferDirty} className="btn-ghost shrink-0 px-3">
              {busy === `buf:${l.id}` ? <Loader2 {...ICON_SM} className="animate-spin" /> : 'บันทึก'}
            </button>
          </div>
          <p id={`buf-help-${l.id}`} className="sm:col-span-2 text-xs text-gray-500">
            เว้นว่าง = ใช้ค่าของช่องทาง ({channel.options.stock_buffer} ชิ้น)
          </p>
        </div>
      )}
    </li>
  )
}
