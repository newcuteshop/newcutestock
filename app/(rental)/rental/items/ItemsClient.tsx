'use client'
// ===== รายการชุดเช่า: ค้นหา / กรองหมวด / กรองสถานะ / การ์ด / พิมพ์ป้ายแขวนหลายชุด =====
// ค้นหาได้ทั้ง รหัสชุด ชื่อ สี แท็ก และ "รหัสชิ้น" (สแกนบาร์โค้ดป้ายแขวนด้วยกล้อง/เครื่องสแกน → เจอชุดของชิ้นนั้น)
// ตัวกรองจำไว้ระหว่างเปิดแท็บนี้ (เข้าไปดูชุดแล้วกดย้อนกลับ ยังอยู่ตัวกรองเดิม)

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { Camera, ChevronDown, RotateCcw, Search, SearchX, Shirt, Tags } from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { codeCandidates, sameCode } from '@/lib/barcode'
import type { RentalCategory } from '@/lib/rental'
import ItemCard from '@/components/rental/items/ItemCard'
import UnitTagsDialog from '@/components/rental/items/UnitTagsDialog'
import { tagGroupOf, type ItemListRow } from '@/components/rental/items/itemList'
import type { ScanFeedback } from '@/components/BarcodeScanner'

const BarcodeScanner = dynamic(() => import('@/components/BarcodeScanner'), { ssr: false })

const PAGE_STEP = 60
const STORE_KEY = 'rental:items-list'
const NO_CATEGORY = '__none__'

type StatusFilter = 'all' | 'active' | 'inactive' | 'hidden' | 'attention' | 'outfits' | 'accessories'

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'active', label: 'เปิดให้เช่า' },
  { value: 'inactive', label: 'ปิดให้เช่า' },
  { value: 'hidden', label: 'ไม่แสดงออนไลน์' },
  { value: 'attention', label: 'รอซัก / ส่งซ่อม' },
  { value: 'outfits', label: 'เฉพาะชุด' },
  { value: 'accessories', label: 'เครื่องประดับ' },
]

function matchesStatus(i: ItemListRow, f: StatusFilter): boolean {
  switch (f) {
    case 'all': return true
    case 'active': return i.is_active
    case 'inactive': return !i.is_active
    case 'hidden': return !i.is_public
    case 'attention': return i.units.some(u => u.status !== 'retired' && (u.needs_cleaning || u.status === 'maintenance'))
    case 'outfits': return !i.is_accessory
    case 'accessories': return i.is_accessory
  }
}

export default function ItemsClient({
  items, categories, shopName,
}: {
  items: ItemListRow[]
  categories: RentalCategory[]
  shopName: string
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [shown, setShown] = useState(PAGE_STEP)
  const [restored, setRestored] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as { q?: unknown; cat?: unknown; st?: unknown }
        if (typeof saved.q === 'string') setSearch(saved.q)
        if (typeof saved.cat === 'string') setCatFilter(saved.cat)
        if (typeof saved.st === 'string' && STATUS_FILTERS.some(f => f.value === saved.st)) setStatus(saved.st as StatusFilter)
      }
    } catch {
      // โหมดส่วนตัว / ปิดการเก็บข้อมูล → เริ่มใหม่ทุกครั้ง
    }
    setRestored(true)
  }, [])

  useEffect(() => {
    if (!restored) return
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ q: search, cat: catFilter, st: status }))
    } catch {
      // เก็บไม่ได้ก็ไม่เป็นไร
    }
  }, [restored, search, catFilter, status])

  const catNames = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories])
  const activeCat = catFilter === '' || catFilter === NO_CATEGORY || catNames.has(catFilter) ? catFilter : ''

  // จำนวนต่อหมวด (หมวดที่ถูกลบ = ไม่มีหมวด เหมือนฐานข้อมูล)
  const counts = useMemo(() => {
    const byId = new Map<string, number>()
    let none = 0
    for (const i of items) {
      const c = i.category_id && catNames.has(i.category_id) ? i.category_id : null
      if (c) byId.set(c, (byId.get(c) ?? 0) + 1)
      else none += 1
    }
    return { byId, none }
  }, [items, catNames])

  const { filtered, unitHits } = useMemo(() => {
    const raw = search.trim()
    const q = raw.toLowerCase()
    // รหัสที่แปลงจากแป้นพิมพ์ไทย (เครื่องสแกน USB ตอนคีย์บอร์ดเป็นภาษาไทย)
    const converted = raw ? codeCandidates(raw).map(c => c.toLowerCase()).filter(c => c && c !== q) : []
    const out: ItemListRow[] = []
    const hits = new Map<string, string>()
    for (const i of items) {
      const cat = i.category_id && catNames.has(i.category_id) ? i.category_id : null
      if (activeCat === NO_CATEGORY ? cat !== null : activeCat !== '' && cat !== activeCat) continue
      if (!matchesStatus(i, status)) continue
      if (!q) { out.push(i); continue }
      const text = `${i.code} ${i.name} ${i.color ?? ''} ${i.tags.join(' ')}`.toLowerCase()
      let hit = text.includes(q)
      // รหัสชิ้น: ตรงทั้งรหัส (สแกน) หรือพิมพ์บางส่วนตั้งแต่ 3 ตัว
      const unit = i.units.find(u =>
        sameCode(u.unit_code, raw) || converted.some(k => sameCode(u.unit_code, k)) ||
        (q.length >= 3 && u.unit_code.toLowerCase().includes(q)))
      if (unit) {
        hit = true
        hits.set(i.id, unit.unit_code)
      }
      if (hit) out.push(i)
    }
    return { filtered: out, unitHits: hits }
  }, [items, search, activeCat, status, catNames])

  const visible = filtered.slice(0, shown)
  const hasFilter = search.trim() !== '' || activeCat !== '' || status !== 'all'
  const totals = useMemo(() => {
    let units = 0
    let ready = 0
    for (const i of items) {
      for (const u of i.units) {
        if (u.status === 'retired') continue
        units += 1
        if (u.status === 'available' && !u.needs_cleaning) ready += 1
      }
    }
    return { units, ready }
  }, [items])

  function clearFilters() {
    setSearch('')
    setCatFilter('')
    setStatus('all')
    setShown(PAGE_STEP)
  }

  // สแกนป้ายแขวน → เจอชิ้นเดียว = เปิดหน้าชุดนั้นเลย
  function handleScan(code: string): ScanFeedback {
    const candidates = codeCandidates(code)
    for (const i of items) {
      const u = i.units.find(x => candidates.some(c => sameCode(x.unit_code, c)))
      if (u) {
        router.push(`/rental/items/${i.id}`)
        return { ok: true, message: `พบ ${u.unit_code} · ${i.name}` }
      }
      if (candidates.some(c => sameCode(i.code, c))) {
        router.push(`/rental/items/${i.id}`)
        return { ok: true, message: `พบชุด ${i.code} · ${i.name}` }
      }
    }
    setSearch(code)
    return { ok: false, message: `ไม่พบชิ้นหรือชุดรหัส ${code}` }
  }

  const tagGroups = useMemo(() => filtered.map(tagGroupOf), [filtered])

  return (
    <div className="space-y-4">
      <section className="card p-4 sm:p-5 space-y-4" aria-label="ค้นหาและกรองชุดเช่า">
        <div className="flex gap-2">
          <div className="input-icon flex-1 min-w-0">
            <Search {...ICON_SM} />
            <input
              className="input pl-11"
              type="search"
              enterKeyHint="search"
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              aria-label="ค้นหาชุดเช่า"
              placeholder="ค้นหารหัสชุด ชื่อ สี แท็ก หรือรหัสชิ้น..."
              value={search}
              onChange={e => { setSearch(e.target.value); setShown(PAGE_STEP) }}
            />
          </div>
          <button
            type="button"
            onClick={() => setScanOpen(true)}
            className="btn-icon"
            aria-label="สแกนป้ายชิ้นชุดเพื่อค้นหา"
            title="สแกนป้ายชิ้นชุด"
          >
            <Camera {...ICON} />
          </button>
        </div>

        {/* หมวด */}
        <div className="space-y-1.5">
          <p className="section-kicker">หมวด</p>
          <div className="lift-scroll -mx-1 flex gap-2 overflow-x-auto overscroll-x-contain scrollbar-none px-1 [--lift-scroll-pb:0.25rem]" role="group" aria-label="กรองตามหมวด">
            <button type="button" className="chip-toggle lift-hover lift-tab shrink-0" aria-pressed={activeCat === ''} onClick={() => { setCatFilter(''); setShown(PAGE_STEP) }}>
              ทั้งหมด <span className="tabular-nums text-gray-500">{items.length}</span>
            </button>
            {categories.map(c => (
              <button
                key={c.id}
                type="button"
                className="chip-toggle lift-hover lift-tab shrink-0"
                aria-pressed={activeCat === c.id}
                onClick={() => { setCatFilter(c.id); setShown(PAGE_STEP) }}
              >
                {c.name}{!c.is_active && ' (ซ่อน)'} <span className="tabular-nums text-gray-500">{counts.byId.get(c.id) ?? 0}</span>
              </button>
            ))}
            {counts.none > 0 && (
              <button
                type="button"
                className="chip-toggle lift-hover lift-tab shrink-0"
                aria-pressed={activeCat === NO_CATEGORY}
                onClick={() => { setCatFilter(NO_CATEGORY); setShown(PAGE_STEP) }}
              >
                ไม่มีหมวด <span className="tabular-nums text-gray-500">{counts.none}</span>
              </button>
            )}
          </div>
        </div>

        {/* สถานะ */}
        <div className="space-y-1.5">
          <p className="section-kicker">สถานะ</p>
          <div className="lift-scroll -mx-1 flex gap-2 overflow-x-auto overscroll-x-contain scrollbar-none px-1 [--lift-scroll-pb:0.25rem]" role="group" aria-label="กรองตามสถานะ">
            {STATUS_FILTERS.map(f => (
              <button
                key={f.value}
                type="button"
                className="chip-toggle lift-hover lift-tab shrink-0"
                aria-pressed={status === f.value}
                onClick={() => { setStatus(f.value); setShown(PAGE_STEP) }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-gray-150 pt-3">
          <p className="text-sm text-gray-600 tabular-nums" aria-live="polite">
            {hasFilter
              ? `พบ ${filtered.length.toLocaleString('en-US')} แบบ จากทั้งหมด ${items.length.toLocaleString('en-US')} แบบ`
              : `ทั้งหมด ${items.length.toLocaleString('en-US')} แบบ · ${totals.units.toLocaleString('en-US')} ชิ้น (พร้อมให้เช่า ${totals.ready.toLocaleString('en-US')})`}
          </p>
          <div className="flex flex-wrap gap-2">
            {hasFilter && (
              <button type="button" onClick={clearFilters} className="btn-ghost px-3 text-sm">
                <RotateCcw {...ICON_SM} />
                ล้างตัวกรอง
              </button>
            )}
            <button
              type="button"
              onClick={() => setTagsOpen(true)}
              disabled={filtered.length === 0}
              className="btn-secondary px-3 text-sm"
              title="พิมพ์ป้ายแขวนของชุดที่แสดงอยู่"
            >
              <Tags {...ICON_SM} />
              พิมพ์ป้ายแขวน
            </button>
          </div>
        </div>
      </section>

      {items.length === 0 ? (
        <div className="card empty-state">
          <span className="icon-bubble icon-bubble-lg"><Shirt size={28} strokeWidth={1.75} aria-hidden="true" /></span>
          <p className="empty-state-title">ยังไม่มีชุดเช่า</p>
          <p>กดปุ่ม &quot;เพิ่มชุด&quot; ด้านบนเพื่อเพิ่มชุดแบบแรก (เฉพาะผู้จัดการร้านเช่า)</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card empty-state">
          <span className="icon-bubble icon-bubble-lg"><SearchX size={28} strokeWidth={1.75} aria-hidden="true" /></span>
          <p className="empty-state-title break-words">
            {search.trim() ? `ไม่พบชุดที่ตรงกับ "${search.trim()}"` : 'ไม่มีชุดตามตัวกรองนี้'}
          </p>
          <button type="button" onClick={clearFilters} className="btn-secondary mt-2">
            <RotateCcw {...ICON_SM} />
            ล้างตัวกรอง
          </button>
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4" aria-label="รายการชุดเช่า">
            {visible.map(i => {
              const catId = i.category_id && catNames.has(i.category_id) ? i.category_id : null
              return (
                <li key={i.id} className="flex min-w-0">
                  <ItemCard item={i} categoryName={catId ? catNames.get(catId) ?? null : null} highlightUnit={unitHits.get(i.id) ?? null} />
                </li>
              )
            })}
          </ul>
          {filtered.length > visible.length && (
            <div className="flex flex-col items-center gap-2 pt-1">
              <p className="page-subtitle !mt-0 tabular-nums">
                แสดง {visible.length.toLocaleString('en-US')} จาก {filtered.length.toLocaleString('en-US')} แบบ
              </p>
              <button type="button" onClick={() => setShown(s => s + PAGE_STEP)} className="btn-secondary w-full sm:w-auto">
                <ChevronDown {...ICON} />
                แสดงเพิ่มอีก {Math.min(PAGE_STEP, filtered.length - visible.length).toLocaleString('en-US')} แบบ
              </button>
            </div>
          )}
        </>
      )}

      {scanOpen && (
        <BarcodeScanner
          title="สแกนป้ายชิ้นชุด"
          closeOnSuccess
          onScan={handleScan}
          onClose={() => setScanOpen(false)}
        />
      )}

      <UnitTagsDialog
        open={tagsOpen}
        onClose={() => setTagsOpen(false)}
        shopName={shopName}
        groups={tagGroups}
        title={hasFilter ? 'พิมพ์ป้ายแขวน (ชุดตามตัวกรอง)' : 'พิมพ์ป้ายแขวนชิ้นชุด'}
      />
    </div>
  )
}
