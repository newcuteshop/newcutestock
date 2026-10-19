'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { CalendarDays, Info, Loader2, Search, SearchX, Send, Shirt, Wallet, X } from 'lucide-react'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { addDaysToKey, isDayKey } from '@/lib/format'
import { rentalDays, sizeLabel, type PublicCatalogItem, type PublicInfo } from '@/lib/rental'
import { fetchCatalog, type CatalogQuery } from '@/components/book/api'
import { catalogQueryString, itemHref } from '@/components/book/catalogQuery'
import { earliestPickup, latestReturn, rangeProblem, shortDay } from '@/components/book/dates'
import ItemCard from '@/components/book/ItemCard'
import RecentBookings from '@/components/book/RecentBookings'

// หน้าแรกจองชุดออนไลน์ (ฝั่งเบราว์เซอร์): ตัวกรอง + รายการชุด
// - รอบแรกใช้ข้อมูลที่เซิร์ฟเวอร์โหลดมาแล้ว · เปลี่ยนตัวกรอง → เรียก rental_public_catalog ใหม่ (คำตอบเก่าที่มาช้ากว่าถูกทิ้ง)
// - ตัวกรองถูกเขียนลง URL (history.replaceState — ไม่โหลดหน้าใหม่) → กดย้อนกลับจากหน้าชุดแล้วยังเห็นตัวกรองเดิม / แชร์ลิงก์ได้
// - เลือกวันรับ–คืนแล้ว: การ์ดบอกว่าว่างไหม + ราคาของช่วงนั้น · ชุดที่ว่างขึ้นก่อน · ลิงก์ไปหน้าชุดพกวันไปด้วย

const SEARCH_DEBOUNCE_MS = 350
// วันที่: พิมพ์ทีละช่อง (วัน/เดือน/ปี) ผ่านวันที่ถูกรูปแบบระหว่างทางหลายวัน → รอหยุดเปลี่ยนครู่หนึ่งค่อยโหลด
const DATE_DEBOUNCE_MS = 300

type Props = {
  info: PublicInfo
  todayKey: string
  initialQuery: CatalogQuery
  initialItems: PublicCatalogItem[] | null
  initialError: string | null
}

// ไซส์ทั้งหมดที่เจอในผลลัพธ์ (ไม่รวมฟรีไซส์ — กรองด้วยไซส์ว่างไม่ได้) เรียงตามที่ฐานข้อมูลส่งมา
function collectSizes(items: PublicCatalogItem[] | null): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const it of items ?? []) {
    for (const s of it.sizes) {
      if (!s) continue
      const k = s.trim().toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      out.push(s.trim())
    }
  }
  return out
}

export default function CatalogClient({ info, todayKey, initialQuery, initialItems, initialError }: Props) {
  const [query, setQuery] = useState<CatalogQuery>(initialQuery)
  const [searchText, setSearchText] = useState(initialQuery.search)
  const [fromDraft, setFromDraft] = useState(initialQuery.pickup ?? '')
  const [toDraft, setToDraft] = useState(initialQuery.ret ?? '')
  const [items, setItems] = useState<PublicCatalogItem[] | null>(initialItems)
  const [error, setError] = useState<string | null>(initialError)
  const [loading, setLoading] = useState(false)
  const [sizeOptions, setSizeOptions] = useState<string[]>(() => collectSizes(initialItems))
  const seq = useRef(0)
  // กด "ลองอีกครั้ง" = โหลดตัวกรองเดิมซ้ำ (ตัวกรองไม่เปลี่ยน — ใช้ตัวนับแทน)
  const [reloadTick, setReloadTick] = useState(0)
  // ตัวกรองที่โหลดล่าสุด (เริ่มที่ค่าที่เซิร์ฟเวอร์โหลดมาแล้ว) — ค่าเดิม = ไม่โหลดซ้ำ ไม่ว่า object ใหม่หรือเก่า
  const loadedRef = useRef({ qs: catalogQueryString(initialQuery), tick: 0 })
  const queryRef = useRef(query)
  queryRef.current = query

  const lead = info.online_min_lead_days
  const maxDays = info.online_max_days
  const earliest = earliestPickup(todayKey, lead)
  const datesTouched = fromDraft !== '' || toDraft !== ''
  const dateProblem = datesTouched ? rangeProblem(fromDraft || null, toDraft || null, todayKey, lead, maxDays) : null

  // ช่องวันที่ครบและถูกเงื่อนไข → ใช้กรอง ; ล้าง/ไม่ครบ/ผิดเงื่อนไข → ไม่กรองตามวัน
  //   (รอหยุดเปลี่ยนครู่หนึ่ง — พิมพ์วันด้วยแป้นพิมพ์ไม่ยิงคำขอทุกวันที่ผ่าน)
  useEffect(() => {
    const ok = fromDraft !== '' && toDraft !== '' && dateProblem === null
    const pickup = ok ? fromDraft : null
    const ret = ok ? toDraft : null
    const t = window.setTimeout(() => {
      setQuery(q => (q.pickup === pickup && q.ret === ret ? q : { ...q, pickup, ret }))
    }, DATE_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [fromDraft, toDraft, dateProblem])

  // พิมพ์ค้นหา → รอหยุดพิมพ์ครู่หนึ่งค่อยค้น (ไม่ยิงทุกตัวอักษร)
  useEffect(() => {
    const t = window.setTimeout(() => {
      const s = searchText.trim().slice(0, 100)
      setQuery(q => (q.search === s ? q : { ...q, search: s }))
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [searchText])

  // ตัวกรองเปลี่ยน → โหลดรายการใหม่ + อัปเดต URL (ค่าที่เซิร์ฟเวอร์โหลดให้แล้วไม่โหลดซ้ำ)
  // ผูกกับ "ค่า" ของตัวกรอง (query string) ไม่ใช่ตัว object — object ใหม่ที่ค่าเท่าเดิมต้องไม่ยิงคำขอใหม่
  // (เคยวนยิงไม่หยุดเมื่อค่าวันที่ถูกตั้งด้วยสคริปต์/ระบบกรอกอัตโนมัติ จนเบราว์เซอร์ตัดคำขอ)
  const qs = catalogQueryString(query)
  useEffect(() => {
    const last = loadedRef.current
    if (last.qs === qs && last.tick === reloadTick) return
    loadedRef.current = { qs, tick: reloadTick }
    const q = queryRef.current
    const my = ++seq.current
    setLoading(true)
    void fetchCatalog(q).then(r => {
      if (my !== seq.current) return
      setLoading(false)
      if (r.ok) {
        setItems(r.data.items)
        setError(null)
        // ตัวเลือกไซส์มาจากผลที่ "ยังไม่กรองไซส์" — กรองไซส์อยู่แล้วตัวเลือกอื่นต้องไม่หายไป
        if (!q.size) setSizeOptions(collectSizes(r.data.items))
      } else {
        setError(r.message)
      }
    })
    const target = qs ? `/book?${qs}` : '/book'
    try {
      // URL ตรงอยู่แล้ว = ไม่แตะ history (Next.js ฟังการเปลี่ยน URL — เรียกซ้ำโดยไม่จำเป็นทำให้เราเตอร์ทำงานซ้ำ)
      if (window.location.pathname + window.location.search !== target) {
        // state = null: ให้ Next.js เติมสถานะของเราเตอร์เองและรับรู้ URL ใหม่ (ส่งสถานะเดิมที่มี __NA ไป = เราเตอร์ไม่รู้ แล้วเขียน URL เก่าทับ)
        window.history.replaceState(null, '', target)
      }
    } catch {
      // บางเบราว์เซอร์ในแอปจำกัดการแก้ URL — ไม่กระทบการใช้งาน
    }
  }, [qs, reloadTick])

  function onFromChange(v: string) {
    setFromDraft(v)
    // เลือกวันรับแล้ว ช่องวันคืนยังว่าง/อยู่ก่อนวันรับ/เกินจำนวนวันสูงสุด → เติมวันคืนตามจำนวนวันเช่ามาตรฐานของร้าน
    if (isDayKey(v)) {
      const maxRet = latestReturn(v, maxDays)
      if (!isDayKey(toDraft) || toDraft < v || toDraft > maxRet) {
        const suggested = addDaysToKey(v, Math.max(1, info.default_base_days) - 1)
        setToDraft(suggested > maxRet ? maxRet : suggested)
      }
    }
  }

  function clearDates() {
    setFromDraft('')
    setToDraft('')
  }

  function clearFilters() {
    clearDates()
    setSearchText('')
    setQuery(q => ({ ...q, categoryId: null, search: '', size: null, accessories: false }))
  }

  const hasDates = !!query.pickup && !!query.ret
  const days = hasDates ? rentalDays(query.pickup as string, query.ret as string) : 0
  const shown = useMemo(() => {
    const list = items ?? []
    if (!hasDates) return list
    // เลือกวันแล้ว: ชุดที่ว่างขึ้นก่อน (เรียงคงลำดับเดิมภายในกลุ่ม)
    return [...list].sort((a, b) => Number(b.available === true) - Number(a.available === true))
  }, [items, hasDates])
  const availableCount = hasDates ? shown.filter(i => i.available === true).length : 0
  const filtered = !!query.categoryId || !!query.search || !!query.size || query.accessories || hasDates

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* ===== แนะนำร้าน + ขั้นตอน ===== */}
      <section className="card p-4 sm:p-6" aria-labelledby="book-hero-title">
        <h1 id="book-hero-title" className="page-title break-words">{info.shop_name}</h1>
        <p className="page-subtitle break-words">{info.tagline || 'เลือกชุด ดูวันว่าง แล้วส่งคำขอจองออนไลน์ได้ทันที'}</p>
        {info.online_notice && (
          <div className="alert-info mt-3">
            <Info {...ICON_SM} />
            <p className="min-w-0 whitespace-pre-line break-words">{info.online_notice}</p>
          </div>
        )}
        <ol className="mt-4 grid grid-cols-3 gap-2 text-center" aria-label="ขั้นตอนการจอง">
          {[
            { icon: Shirt, title: 'เลือกชุดและวัน', sub: `จองล่วงหน้า ${lead > 0 ? `${lead} วันขึ้นไป` : 'ได้ตั้งแต่วันนี้'}` },
            { icon: Send, title: 'ส่งคำขอจอง', sub: 'ร้านตรวจสอบคิวให้' },
            {
              icon: Wallet,
              title: 'ชำระมัดจำ',
              sub: info.booking_deposit_percent > 0 ? `${info.booking_deposit_percent}% ของค่าเช่า` : 'แล้วส่งสลิป',
            },
          ].map((s, i) => (
            <li key={s.title} className="panel flex min-w-0 flex-col items-center gap-1 px-1.5 py-2.5">
              <span className="icon-bubble icon-bubble-sm" aria-hidden="true">
                <s.icon {...ICON_XS} />
              </span>
              <span className="text-xs font-semibold text-gray-900 sm:text-sm">
                <span className="sr-only">ขั้นที่ {i + 1}: </span>
                {s.title}
              </span>
              <span className="text-[11px] leading-snug text-gray-500 sm:text-xs">{s.sub}</span>
            </li>
          ))}
        </ol>
      </section>

      <RecentBookings />

      {/* ===== ตัวกรอง ===== */}
      <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="book-filter-title">
        <h2 id="book-filter-title" className="section-title">
          <CalendarDays {...ICON_SM} />
          ค้นหาชุดว่าง
        </h2>

        <fieldset className="space-y-2">
          <legend className="field-label">วันรับชุด – วันคืนชุด (ไม่บังคับ)</legend>
          <div className="grid grid-cols-2 gap-2 sm:max-w-md">
            <div className="min-w-0">
              <label htmlFor="book-from" className="text-xs font-medium text-gray-500">วันรับชุด</label>
              <input
                id="book-from"
                type="date"
                className="input mt-1"
                min={earliest}
                value={fromDraft}
                onChange={e => onFromChange(e.target.value)}
                aria-invalid={dateProblem !== null && fromDraft !== '' ? true : undefined}
              />
              <p className="mt-1 text-xs text-gray-500">{fromDraft ? shortDay(fromDraft) : 'ยังไม่เลือก'}</p>
            </div>
            <div className="min-w-0">
              <label htmlFor="book-to" className="text-xs font-medium text-gray-500">วันคืนชุด</label>
              <input
                id="book-to"
                type="date"
                className="input mt-1"
                min={fromDraft || earliest}
                max={isDayKey(fromDraft) ? latestReturn(fromDraft, maxDays) : undefined}
                value={toDraft}
                onChange={e => setToDraft(e.target.value)}
                aria-invalid={dateProblem !== null && toDraft !== '' ? true : undefined}
              />
              <p className="mt-1 text-xs text-gray-500">{toDraft ? shortDay(toDraft) : 'ยังไม่เลือก'}</p>
            </div>
          </div>
          <div aria-live="polite" className="text-sm">
            {datesTouched && dateProblem && <p className="text-amber-800">{dateProblem}</p>}
            {hasDates && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-gray-700">
                <span>
                  เช่า <span className="font-semibold">{days} วัน</span> ({shortDay(query.pickup)} – {shortDay(query.ret)})
                </span>
                <button type="button" onClick={clearDates} className="btn-ghost min-h-[44px] px-2 text-sm">
                  <X {...ICON_XS} />
                  ล้างวันที่
                </button>
              </p>
            )}
          </div>
          <p className="field-hint">
            รับชุดได้ตั้งแต่ {shortDay(earliest)} · จองออนไลน์ได้ครั้งละไม่เกิน {maxDays} วัน (นับวันรับและวันคืนรวมกัน)
          </p>
        </fieldset>

        <div>
          <label htmlFor="book-search" className="field-label">ค้นหาชื่อหรือรหัสชุด</label>
          <div className="input-icon">
            <Search {...ICON_SM} />
            <input
              id="book-search"
              type="search"
              inputMode="search"
              enterKeyHint="search"
              className="input pl-11"
              placeholder="เช่น ชุดไทย, ราตรี, A012"
              maxLength={100}
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
            />
          </div>
        </div>

        {info.categories.length > 0 && (
          <div>
            <p className="field-label" id="book-cat-label">หมวดหมู่</p>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-labelledby="book-cat-label">
              <button
                type="button"
                className="chip-toggle"
                aria-pressed={query.categoryId === null}
                onClick={() => setQuery(q => ({ ...q, categoryId: null }))}
              >
                ทั้งหมด
              </button>
              {info.categories.map(c => (
                <button
                  key={c.id}
                  type="button"
                  className="chip-toggle"
                  aria-pressed={query.categoryId === c.id}
                  onClick={() => setQuery(q => ({ ...q, categoryId: q.categoryId === c.id ? null : c.id }))}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          {(sizeOptions.length > 0 || query.size) && (
            <div className="min-w-[10rem] flex-1 sm:flex-none">
              <label htmlFor="book-size" className="field-label">ไซส์</label>
              <select
                id="book-size"
                className="input"
                value={query.size ?? ''}
                onChange={e => setQuery(q => ({ ...q, size: e.target.value || null }))}
              >
                <option value="">ทุกไซส์</option>
                {query.size && !sizeOptions.some(s => s.toLowerCase() === query.size?.toLowerCase()) && (
                  <option value={query.size}>{sizeLabel(query.size)}</option>
                )}
                {sizeOptions.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          <button
            type="button"
            className="chip-toggle"
            aria-pressed={query.accessories}
            onClick={() => setQuery(q => ({ ...q, accessories: !q.accessories }))}
          >
            แสดงเครื่องประดับ / อุปกรณ์เสริม
          </button>
        </div>
      </section>

      {/* ===== รายการชุด ===== */}
      <section aria-labelledby="book-list-title" aria-busy={loading}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="book-list-title" className="section-title">
            ชุดให้เช่า
            {items && (
              <span className="text-sm font-normal text-gray-500">
                {hasDates ? `ว่าง ${availableCount} จาก ${shown.length} ชุด` : `${shown.length} ชุด`}
              </span>
            )}
          </h2>
          {loading && (
            <span className="inline-flex items-center gap-1.5 text-sm text-gray-500" role="status">
              <Loader2 {...ICON_XS} className="animate-spin" />
              กำลังโหลด...
            </span>
          )}
        </div>

        {error && (
          <div role="alert" className="alert-err mb-3">
            <Info {...ICON_SM} />
            <div className="min-w-0 space-y-2">
              <p>โหลดรายการชุดไม่สำเร็จ: {error}</p>
              {/* ตัวกรองเดิม แต่สั่งโหลดซ้ำ */}
              <button type="button" className="btn-secondary" onClick={() => setReloadTick(n => n + 1)} disabled={loading}>
                ลองอีกครั้ง
              </button>
            </div>
          </div>
        )}

        {items && shown.length === 0 && !loading ? (
          <div className="card">
            <div className="empty-state">
              <span className="icon-bubble icon-bubble-lg" aria-hidden="true">
                <SearchX size={28} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <p className="empty-state-title">ไม่พบชุดที่ตรงกับเงื่อนไข</p>
              <p className="max-w-sm">ลองเปลี่ยนคำค้น หมวดหมู่ ไซส์ หรือช่วงวันที่</p>
              {filtered && (
                <button type="button" onClick={clearFilters} className="btn-secondary mt-2">
                  ล้างตัวกรองทั้งหมด
                </button>
              )}
            </div>
          </div>
        ) : (
          <ul className={clsx('grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4', loading && 'opacity-60')}>
            {shown.map(it => (
              <li key={it.id || it.code} className="min-w-0">
                <ItemCard item={it} href={itemHref(it.code, query.pickup, query.ret)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
