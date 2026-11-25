'use client'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Gem, Loader2, RefreshCw, Search, SearchX, Shirt, X, XCircle } from 'lucide-react'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht, thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import type { BrowserSupabase } from '@/lib/products'
import {
  FIX05_MISSING_MSG, parseFindUnits, sizeKey, sizeLabel,
  type FindUnitsItem, type FindUnitsSize, type RentalCategory,
} from '@/lib/rental'
import RentalImage from '@/components/rental/RentalImage'
import { countInCart, type CartLine } from './model'

// ขั้นที่ 2: เลือกชุดจากชิ้นที่ว่างจริงในช่วงวันที่เลือก (rental_find_units — คิดวันเตรียม/ซักชุดของแต่ละแบบให้แล้ว)
// กดปุ่มไซส์ = เพิ่ม 1 ชิ้นของไซส์นั้นลงตะกร้า (กดซ้ำได้จนครบจำนวนชิ้นที่ว่าง)
// ตัวเลข "ว่าง" หักชิ้นที่อยู่ในตะกร้าแล้ว — ฐานข้อมูลยังตรวจซ้ำตอนบันทึกเสมอ (สองเครื่องจองชิ้นเดียวกันพร้อมกันไม่ได้)

const SEARCH_DEBOUNCE_MS = 300
const RPC_TIMEOUT_MS = 20000
const SHOW_STEP = 40

export default function ItemsStep({
  supabase,
  pickup,
  ret,
  days,
  bookingId,
  categories,
  lines,
  focusItemId,
  onClearFocus,
  onAdd,
  onSeen,
  full,
  disabled,
}: {
  supabase: BrowserSupabase
  pickup: string
  ret: string
  days: number
  bookingId: string | null
  categories: readonly RentalCategory[]
  lines: readonly CartLine[]
  focusItemId: string | null
  onClearFocus: () => void
  onAdd: (item: FindUnitsItem, size: FindUnitsSize) => void
  onSeen: (items: readonly FindUnitsItem[]) => void
  full: boolean            // ตะกร้าเต็ม (30 รายการ)
  disabled?: boolean
}) {
  const searchId = useId()
  const [searchInput, setSearchInput] = useState('')
  const [term, setTerm] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [onlyFree, setOnlyFree] = useState(true)
  const [items, setItems] = useState<FindUnitsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [show, setShow] = useState(SHOW_STEP)
  const [reload, setReload] = useState(0)
  const reqRef = useRef(0)
  const onSeenRef = useRef(onSeen)
  onSeenRef.current = onSeen

  // พิมพ์ค้นหา → รอหยุดพิมพ์ก่อนค่อยถาม (ไม่ยิงทุกตัวอักษร)
  useEffect(() => {
    const t = setTimeout(() => setTerm(searchInput.trim().slice(0, 100)), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    const reqId = ++reqRef.current
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = setTimeout(() => ctrl?.abort(), RPC_TIMEOUT_MS)
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        let req = supabase.rpc('rental_find_units', {
          p_pickup: pickup,
          p_return: ret,
          p_item_ids: focusItemId ? [focusItemId] : null,
          p_search: term || null,
          p_category_id: categoryId || null,
          p_exclude_booking: bookingId,
        })
        if (ctrl) req = req.abortSignal(ctrl.signal)
        const { data, error: rpcError } = await req
        if (reqId !== reqRef.current) return
        if (rpcError) {
          if (ctrl?.signal.aborted) throw new Error('เซิร์ฟเวอร์ตอบช้าเกินไป — กดโหลดใหม่อีกครั้ง')
          throw rpcError
        }
        const parsed = parseFindUnits(data)
        setItems(parsed.items)
        setShow(SHOW_STEP)
        onSeenRef.current(parsed.items)
      } catch (err) {
        if (reqId !== reqRef.current) return
        setItems([])
        setError(isMigrationMissing(err) ? FIX05_MISSING_MSG : thaiError(err))
      } finally {
        clearTimeout(timer)
        if (reqId === reqRef.current) setLoading(false)
      }
    })()
    return () => {
      clearTimeout(timer)
      ctrl?.abort()
    }
  }, [supabase, pickup, ret, term, categoryId, focusItemId, bookingId, reload])

  const inCartIds = useMemo(() => new Set(lines.map(l => l.item_id)), [lines])
  const visible = useMemo(
    () => (onlyFree ? items.filter(it => inCartIds.has(it.item_id) || it.sizes.some(s => s.free_units.length > 0)) : items),
    [items, onlyFree, inCartIds],
  )
  const hiddenCount = items.length - visible.length
  const outfits = visible.filter(it => !it.is_accessory)
  const accessories = visible.filter(it => it.is_accessory)
  // แสดงทีละชุด (มือถือรายการยาวมากจะหน่วง) — ชุดก่อน เครื่องประดับทีหลัง
  const shownOutfits = outfits.slice(0, show)
  const shownAccessories = accessories.slice(0, Math.max(0, show - outfits.length))
  const moreCount = visible.length - shownOutfits.length - shownAccessories.length
  const focusName = focusItemId ? items.find(it => it.item_id === focusItemId) : undefined

  function renderItem(it: FindUnitsItem) {
    const totalFree = it.sizes.reduce((n, s) => n + s.free_units.length, 0)
    const inCart = lines.filter(l => l.item_id === it.item_id).length
    return (
      <li key={it.item_id} className={clsx('flex items-start gap-3 p-3 sm:p-4', totalFree === 0 && inCart === 0 && 'opacity-70')}>
        <RentalImage path={it.cover_path} alt="" className="h-16 w-16 shrink-0 rounded-lg border border-gray-200 sm:h-20 sm:w-20" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 break-words">
                <span className="font-mono text-xs font-medium text-gray-500">{it.code}</span>{' '}
                {it.name}
              </p>
              <p className="text-xs text-gray-500 break-words">
                {it.category_name ?? 'ไม่มีหมวด'}
                {' · '}
                {baht(it.base_price)} / {it.base_days} วัน
                {it.extra_day_price > 0 && <> · วันเพิ่ม {baht(it.extra_day_price)}</>}
                {it.security_deposit > 0 && <> · ประกัน {baht(it.security_deposit)}</>}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="money text-sm text-gray-900">{baht(it.rent_price)}</p>
              <p className="text-[11px] text-gray-500 tabular-nums">{days} วัน</p>
            </div>
          </div>

          {it.sizes.length === 0 ? (
            <p className="text-xs text-gray-500">ยังไม่มีชิ้นที่พร้อมให้เช่า</p>
          ) : (
            <div className="flex flex-wrap gap-2" role="group" aria-label={`ไซส์ของ ${it.code} ${it.name}`}>
              {it.sizes.map(s => {
                const used = countInCart(lines, it.item_id, s.size)
                const left = Math.max(0, s.free_units.length - used)
                const can = !disabled && !full && left > 0
                return (
                  <button
                    key={sizeKey(s.size)}
                    type="button"
                    className={clsx('chip-toggle px-3', used > 0 && 'border-brand-600')}
                    disabled={!can}
                    onClick={() => onAdd(it, s)}
                    aria-label={`เพิ่ม ${it.code} ไซส์ ${sizeLabel(s.size)} (ว่าง ${left} จาก ${s.total_units} ชิ้น${used > 0 ? ` เลือกแล้ว ${used}` : ''})`}
                  >
                    <span className="font-semibold">{sizeLabel(s.size)}</span>
                    <span className={clsx('text-xs tabular-nums', left > 0 ? 'text-green-700' : 'text-gray-400')}>
                      {left > 0 ? `ว่าง ${left}` : 'เต็ม'}
                    </span>
                    {used > 0 && <span className="chip-strong h-5 px-1.5 tabular-nums">+{used}</span>}
                  </button>
                )
              })}
            </div>
          )}
          {inCart > 0 && <p className="sr-only">เลือกชุดนี้แล้ว {inCart} ชิ้น</p>}
        </div>
      </li>
    )
  }

  return (
    <section className="card overflow-hidden" aria-labelledby={`${searchId}-title`} aria-busy={loading}>
      <div className="card-header flex-wrap">
        <h2 id={`${searchId}-title`} className="section-title">
          <Shirt {...ICON} />
          ชุดที่ว่างช่วงนี้
        </h2>
        <button
          type="button"
          onClick={() => setReload(n => n + 1)}
          disabled={loading}
          className="btn-icon btn-icon-plain"
          aria-label="โหลดรายการชุดใหม่"
        >
          <RefreshCw {...ICON_SM} className={loading ? 'animate-spin' : undefined} />
        </button>
      </div>

      <div className="space-y-3 border-b border-gray-150 p-3 sm:p-4">
        <div className="input-icon">
          <Search {...ICON_SM} />
          <input
            id={searchId}
            type="search"
            className="input pl-11"
            placeholder="ค้นหารหัส / ชื่อชุด / สี / แท็ก"
            value={searchInput}
            maxLength={100}
            autoComplete="off"
            enterKeyHint="search"
            aria-label="ค้นหาชุด"
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setTerm(searchInput.trim().slice(0, 100)) } }}
          />
        </div>

        {focusItemId && (
          <div className="panel flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <p className="min-w-0 text-sm text-gray-700 break-words">
              แสดงเฉพาะชุด {focusName ? <b className="font-mono">{focusName.code}</b> : 'ที่เลือกมา'}
            </p>
            <button type="button" onClick={onClearFocus} className="btn-ghost px-3 text-sm">
              <X {...ICON_SM} />
              ดูชุดทั้งหมด
            </button>
          </div>
        )}

        {categories.length > 0 && (
          <div className="lift-scroll -mx-3 overflow-x-auto px-3 scrollbar-none sm:mx-0 sm:px-0" role="group" aria-label="หมวดชุด">
            <div className="flex gap-2 sm:flex-wrap">
              <button type="button" className="chip-toggle lift-hover lift-tab shrink-0" aria-pressed={categoryId === ''} onClick={() => setCategoryId('')}>
                ทุกหมวด
              </button>
              {categories.map(c => (
                <button
                  key={c.id}
                  type="button"
                  className="chip-toggle lift-hover lift-tab shrink-0"
                  aria-pressed={categoryId === c.id}
                  onClick={() => setCategoryId(prev => (prev === c.id ? '' : c.id))}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          role="switch"
          aria-checked={onlyFree}
          onClick={() => setOnlyFree(v => !v)}
          className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left text-sm font-medium text-gray-800"
        >
          <span className="min-w-0">
            แสดงเฉพาะชุดที่ว่าง
            {onlyFree && hiddenCount > 0 && !loading && (
              <span className="block text-xs font-normal text-gray-500">ซ่อน {hiddenCount} แบบที่ไม่ว่างช่วงนี้</span>
            )}
          </span>
          <span aria-hidden="true" className={clsx('switch', onlyFree && 'switch-on')}>
            <span className="switch-knob" />
          </span>
        </button>
        {full && (
          <p role="status" className="text-sm font-medium text-amber-800">เลือกครบ 30 รายการแล้ว (สูงสุดต่อการจอง)</p>
        )}
      </div>

      {loading && items.length === 0 ? (
        <div className="p-4 space-y-3" role="status">
          <span className="sr-only">กำลังค้นหาชุดที่ว่าง...</span>
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-20 rounded-lg" />)}
        </div>
      ) : error ? (
        <div className="p-4">
          <div role="alert" className="alert-err">
            <XCircle {...ICON_SM} />
            <div className="min-w-0 space-y-2">
              <p className="break-words">{error}</p>
              <button type="button" onClick={() => setReload(n => n + 1)} className="btn-secondary px-4 text-sm">
                <RefreshCw {...ICON_SM} />
                ลองใหม่
              </button>
            </div>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <span className="icon-bubble icon-bubble-lg"><SearchX size={28} strokeWidth={1.75} aria-hidden="true" /></span>
          <p className="empty-state-title">
            {term || categoryId || focusItemId ? 'ไม่พบชุดที่ตรงกับตัวกรอง' : 'ยังไม่มีชุดที่ว่างช่วงวันนี้'}
          </p>
          {onlyFree && hiddenCount > 0 && (
            <button type="button" className="btn-secondary px-4 text-sm" onClick={() => setOnlyFree(false)}>
              แสดงชุดที่ไม่ว่างด้วย
            </button>
          )}
        </div>
      ) : (
        <div className={clsx(loading && 'opacity-60')}>
          {shownOutfits.length > 0 && (
            <ul className="divide-y divide-gray-150">{shownOutfits.map(renderItem)}</ul>
          )}
          {shownAccessories.length > 0 && (
            <>
              <h3 className="flex items-center gap-2 border-y border-gray-150 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-800">
                <Gem {...ICON_XS} className="text-brand-600" />
                เครื่องประดับ / อุปกรณ์เสริม
              </h3>
              <ul className="divide-y divide-gray-150">{shownAccessories.map(renderItem)}</ul>
            </>
          )}
          {moreCount > 0 && (
            <div className="border-t border-gray-150 p-3 text-center">
              <button type="button" className="btn-secondary px-5" onClick={() => setShow(n => n + SHOW_STEP)}>
                แสดงเพิ่ม ({moreCount} แบบ)
              </button>
            </div>
          )}
          {loading && (
            <p className="flex items-center justify-center gap-2 border-t border-gray-150 p-2 text-xs text-gray-500" role="status">
              <Loader2 {...ICON_XS} className="animate-spin" />
              กำลังอัปเดต...
            </p>
          )}
        </div>
      )}
    </section>
  )
}
