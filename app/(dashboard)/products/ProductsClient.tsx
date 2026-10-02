'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { Camera, Check, ChevronDown, RotateCcw, Search, SearchX, Shirt, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { thaiError } from '@/lib/format'
import { codeCandidates, findByCode, sameCode } from '@/lib/barcode'
import { sortVariantsBySize, type ProductGroupCard, type ProductVariant } from '@/lib/products'
import { ICON, ICON_SM } from '@/components/theme/icons'
import CategoryBar, { NO_CATEGORY, type CategoryCounts, type CategoryOption } from '@/components/products/CategoryBar'
import ProductCard from '@/components/products/ProductCard'
import type { ScanFeedback } from '@/components/BarcodeScanner'

// กล้องสแกนโหลดเฉพาะตอนกดปุ่ม (ไลบรารีกล้องใหญ่ ไม่ให้หน้ารายการช้า)
const BarcodeScanner = dynamic(() => import('@/components/BarcodeScanner'), { ssr: false })

type Msg = { ok: boolean; text: string }

// แสดงทีละ 60 แบบ (หารลงตัวทั้ง 2/3/4/5/6 คอลัมน์ แถวสุดท้ายเต็มเสมอ) แล้วกด "แสดงเพิ่ม"
const PAGE_STEP = 60
// จำตัวกรองไว้ระหว่างเปิดแท็บนี้ (กดเข้าไปแก้สินค้าแล้วย้อนกลับมา ยังอยู่หมวดเดิม/คำค้นเดิม)
const STORE_KEY = 'newcute:products-list'

// ผลจาก RPC set_product_group_active (ProductGroupJson ใน CONTRACT §2 — ใช้เฉพาะช่องที่การ์ดต้องใช้)
type VariantJson = {
  id: string; size: string | null; sku: string; barcode: string | null
  cost_price: number | string | null; sell_price: number | string | null
  min_stock: number | string | null; stock_qty: number | string | null
  is_active: boolean | null; has_history?: boolean
}
type GroupJson = {
  name?: string; category_id?: string | null; color?: string | null
  has_sizes?: boolean; is_active?: boolean; updated_at?: string
  variants?: VariantJson[]; images?: { path: string }[]
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function variantFromJson(v: VariantJson): ProductVariant {
  return {
    id: v.id,
    size: v.size,
    sku: v.sku,
    barcode: v.barcode,
    cost_price: num(v.cost_price),
    sell_price: num(v.sell_price),
    min_stock: num(v.min_stock),
    stock_qty: num(v.stock_qty),
    is_active: v.is_active === true,
    has_history: v.has_history === true,
  }
}

// อัปเดตการ์ดจากผลของ RPC (ค่าล่าสุดจากฐานข้อมูล รวม updated_at ใหม่ และสถานะทุกไซส์)
function mergeGroupJson(card: ProductGroupCard, json: GroupJson, active: boolean): ProductGroupCard {
  return {
    ...card,
    name: typeof json.name === 'string' ? json.name : card.name,
    category_id: json.category_id !== undefined ? json.category_id : card.category_id,
    color: json.color !== undefined ? json.color : card.color,
    has_sizes: typeof json.has_sizes === 'boolean' ? json.has_sizes : card.has_sizes,
    is_active: typeof json.is_active === 'boolean' ? json.is_active : active,
    updated_at: typeof json.updated_at === 'string' ? json.updated_at : card.updated_at,
    variants: Array.isArray(json.variants) ? sortVariantsBySize(json.variants.map(variantFromJson)) : card.variants,
    cover_path: Array.isArray(json.images) ? (json.images[0]?.path ?? null) : card.cover_path,
  }
}

export default function ProductsClient({
  initialGroups, categories, canManage,
}: { initialGroups: ProductGroupCard[]; categories: CategoryOption[]; canManage: boolean }) {
  const [groups, setGroups] = useState<ProductGroupCard[]>(initialGroups)
  const [cats, setCats] = useState<CategoryOption[]>(categories)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [shown, setShown] = useState(PAGE_STEP)
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set())
  const [msg, setMsg] = useState<Msg | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [restored, setRestored] = useState(false)
  const busyRef = useRef<Set<string>>(new Set())
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  // ข้อมูลจาก server เปลี่ยน (router.refresh) → ใช้ชุดใหม่
  useEffect(() => { setGroups(initialGroups) }, [initialGroups])
  useEffect(() => { setCats(categories) }, [categories])
  useEffect(() => () => { if (msgTimer.current) clearTimeout(msgTimer.current) }, [])

  // คืนค่าตัวกรองที่จำไว้ (อ่านหลัง mount เท่านั้น — ตอน render ฝั่งเซิร์ฟเวอร์ไม่มี sessionStorage)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as { q?: unknown; cat?: unknown }
        if (typeof saved.q === 'string') setSearch(saved.q)
        if (typeof saved.cat === 'string') setCatFilter(saved.cat)
      }
    } catch {
      // โหมดส่วนตัว / ปิดการเก็บข้อมูล → เริ่มใหม่ทุกครั้ง
    }
    setRestored(true)
  }, [])

  useEffect(() => {
    if (!restored) return
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ q: search, cat: catFilter }))
    } catch {
      // เก็บไม่ได้ก็ไม่เป็นไร
    }
  }, [restored, search, catFilter])

  const catNames = useMemo(() => new Map(cats.map(c => [c.id, c.name])), [cats])

  // ตัวกรองที่จำไว้แต่หมวดนั้นถูกลบไปแล้ว → กลับไป "ทั้งหมด"
  const activeCat = catFilter === '' || catFilter === NO_CATEGORY || catNames.has(catFilter) ? catFilter : ''

  // หมวดหมู่ที่ถูกลบจากเครื่องอื่น (ไม่อยู่ในรายการแล้ว) นับเป็น "ไม่มีหมวดหมู่" เหมือนที่ฐานข้อมูลทำ
  const counts = useMemo<CategoryCounts>(() => {
    const byId: Record<string, number> = {}
    let none = 0
    for (const g of groups) {
      const c = g.category_id && catNames.has(g.category_id) ? g.category_id : null
      if (c) byId[c] = (byId[c] ?? 0) + 1
      else none++
    }
    return { all: groups.length, none, byId }
  }, [groups, catNames])

  // ดัชนีค้นหา: ชื่อ + สี ของแบบ, SKU/บาร์โค้ดของทุกไซส์ (ตัวพิมพ์เล็ก)
  const index = useMemo(() => groups.map(g => ({
    g,
    text: `${g.name} ${g.color ?? ''}`.toLowerCase(),
    codes: g.variants.map(v => ({ id: v.id, sku: v.sku.toLowerCase(), barcode: (v.barcode ?? '').toLowerCase() })),
  })), [groups])

  const { filtered, hits } = useMemo(() => {
    const raw = search.trim()
    const q = raw.toLowerCase()
    // รหัสที่แปลงจากแป้นพิมพ์ไทย (สแกนเนอร์ USB ตอนคีย์บอร์ดเป็นภาษาไทย) — ไม่รวมคำค้นเดิม
    const converted = raw
      ? codeCandidates(raw).map(c => c.toLowerCase()).filter(c => c && c !== q)
      : []
    const out: ProductGroupCard[] = []
    const hitMap = new Map<string, Set<string>>()

    for (const item of index) {
      const g = item.g
      const cat = g.category_id && catNames.has(g.category_id) ? g.category_id : null
      if (activeCat === NO_CATEGORY ? cat !== null : activeCat !== '' && cat !== activeCat) continue
      if (!q) {
        out.push(g)
        continue
      }
      const nameHit = item.text.includes(q)
      const codeHits = new Set<string>()
      for (const c of item.codes) {
        const direct = c.sku.includes(q) || (c.barcode !== '' && c.barcode.includes(q))
        // รหัสที่แปลงแล้ว: ตรงทั้งรหัส หรือ (ยาว ≥ 4 ตัว) เป็นส่วนหนึ่งของรหัส — กันผลมั่วตอนพิมพ์ชื่อภาษาไทยสั้นๆ
        const viaConverted = converted.some(k =>
          sameCode(k, c.sku) || sameCode(k, c.barcode) ||
          (k.length >= 4 && (c.sku.includes(k) || (c.barcode !== '' && c.barcode.includes(k))))
        )
        if (direct || viaConverted) codeHits.add(c.id)
      }
      if (nameHit || codeHits.size > 0) {
        out.push(g)
        // ขีดกรอบไซส์ที่รหัสตรง (คำค้นสั้นกว่า 3 ตัวตรงเกือบทุกไซส์ ไม่ขีด)
        if (codeHits.size > 0 && (q.length >= 3 || converted.length > 0)) hitMap.set(g.id, codeHits)
      }
    }
    return { filtered: out, hits: hitMap }
  }, [index, search, activeCat, catNames])

  const visible = filtered.slice(0, shown)
  const hasFilter = search.trim() !== '' || activeCat !== ''

  function changeSearch(value: string) {
    setSearch(value)
    setShown(PAGE_STEP)
  }

  function changeCategory(value: string) {
    setCatFilter(value)
    setShown(PAGE_STEP)
  }

  function clearFilters() {
    setSearch('')
    setCatFilter('')
    setShown(PAGE_STEP)
  }

  function showMsg(next: Msg) {
    if (msgTimer.current) clearTimeout(msgTimer.current)
    setMsg(next)
    // ข้อความสำเร็จหายเอง / ข้อความผิดพลาดค้างไว้จนกว่าจะปิด
    if (next.ok) msgTimer.current = setTimeout(() => setMsg(null), 3000)
  }

  function markBusy(id: string, on: boolean) {
    if (on) busyRef.current.add(id)
    else busyRef.current.delete(id)
    setBusyIds(new Set(busyRef.current))
  }

  // เปิด/ปิดขายทั้งแบบ (ทุกไซส์) — CONTRACT §3.2 / §8: เขียนตรงตาราง products ไม่ได้แล้ว ต้องผ่าน RPC
  async function toggleActive(g: ProductGroupCard) {
    if (busyRef.current.has(g.id)) return
    const next = !g.is_active

    // ปิดทั้งแบบแล้วเปิดใหม่ = ทุกไซส์กลับมาเปิดขาย รวมไซส์ที่ปิดแยกไว้ → บอกก่อน (ปิดแล้วระบบจำไม่ได้ว่าไซส์ไหนเคยปิดไว้)
    if (!next && g.has_sizes) {
      const offSizes = g.variants.filter(v => !v.is_active).map(v => v.size ?? '-')
      if (offSizes.length > 0) {
        const list = offSizes.join(', ')
        const ok = window.confirm(
          `ปิดใช้งาน "${g.name}" ทุกไซส์?\n\nตอนนี้ไซส์ ${list} ปิดขายแยกไว้อยู่ — ถ้าภายหลังกดเปิดขายแบบนี้อีกครั้ง ทุกไซส์จะกลับมาเปิดขายพร้อมกัน รวมไซส์ ${list} ด้วย`
        )
        if (!ok) return
      }
    }

    markBusy(g.id, true)
    // optimistic: เปลี่ยนบนจอก่อน ถ้าบันทึกไม่ผ่านค่อยย้อนกลับ
    setGroups(gs => gs.map(x => x.id === g.id ? { ...x, is_active: next } : x))
    try {
      const { data, error } = await supabase.rpc('set_product_group_active', { p_group_id: g.id, p_active: next })
      if (error) throw error
      if (!data || typeof data !== 'object') throw new Error('ไม่พบสินค้านี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่')
      const json = data as GroupJson
      setGroups(gs => gs.map(x => x.id === g.id ? mergeGroupJson(x, json, next) : x))
      const scope = g.has_sizes ? ' (ทุกไซส์)' : ''
      showMsg({ ok: true, text: `${next ? 'เปิดขาย' : 'ปิดใช้งาน'} "${g.name}" แล้ว${scope}` })
      // updated_at ของแบบนี้เปลี่ยนแล้ว → ล้างหน้าที่ Next จำไว้ (หน้าแก้ไขที่เพิ่งเปิดดู)
      // ไม่งั้นกดเข้าไปแก้ภายใน 30 วิ จะได้ฟอร์มเก่า แล้วบันทึกไม่ผ่านว่า "ถูกแก้ไขจากเครื่องอื่น"
      router.refresh()
    } catch (err: unknown) {
      setGroups(gs => gs.map(x => x.id === g.id ? { ...x, is_active: g.is_active } : x))
      showMsg({ ok: false, text: `เปลี่ยนสถานะ "${g.name}" ไม่สำเร็จ: ${thaiError(err)}` })
    } finally {
      markBusy(g.id, false)
    }
  }

  // ลบหมวดหมู่แล้ว ฐานข้อมูลตั้ง category_id = null ให้สินค้าในหมวด → ทำบนจอให้ตรงกันทันที
  // (ทุกแบบในหมวดนั้นได้ updated_at ใหม่ด้วย → ล้างหน้าที่จำไว้ กันบันทึกชนแบบหลอกๆ)
  function handleCategoryDeleted(id: string) {
    setGroups(gs => gs.map(g => g.category_id === id ? { ...g, category_id: null } : g))
    router.refresh()
  }

  // เพิ่ม/เปลี่ยนชื่อ/ลบหมวดหมู่ → ล้างหน้าที่จำไว้ด้วย (หน้าเพิ่ม/แก้ไขสินค้าจะได้รายการหมวดหมู่ล่าสุด)
  function handleCategoriesChange(next: CategoryOption[]) {
    setCats(next)
    router.refresh()
  }

  // สแกนบาร์โค้ด/SKU → ค้นหาด้วยรหัสนั้น (ล้างตัวกรองหมวดหมู่ ไม่ให้ผลที่เจอถูกซ่อน)
  function handleScan(code: string): ScanFeedback {
    const all = groups.flatMap(g => g.variants.map(v => ({ sku: v.sku, barcode: v.barcode, name: g.name, size: v.size })))
    const hit = findByCode(all, code)
    if (!hit) return { ok: false, message: `ไม่พบสินค้ารหัส ${code}` }
    setSearch(code)
    setCatFilter('')
    setShown(PAGE_STEP)
    return { ok: true, message: `พบ "${hit.name}${hit.size ? ` · ${hit.size}` : ''}"` }
  }

  return (
    <div className="space-y-4">
      {/* ค้นหา + หมวดหมู่ */}
      <section className="card p-4 sm:p-5 space-y-4" aria-label="ค้นหาและกรองสินค้า">
        <div className="flex gap-2">
          <div className="input-icon flex-1 min-w-0">
            <Search {...ICON_SM} />
            <input
              className="input pl-11"
              type="search"
              enterKeyHint="search"
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              aria-label="ค้นหาสินค้า"
              placeholder="ค้นหาชื่อสินค้า, SKU, บาร์โค้ด..."
              value={search}
              onChange={e => changeSearch(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={() => setScanOpen(true)}
            className="btn-icon"
            aria-label="สแกนบาร์โค้ดเพื่อค้นหาสินค้า"
            title="สแกนบาร์โค้ด"
          >
            <Camera {...ICON} />
          </button>
        </div>

        <CategoryBar
          categories={cats}
          counts={counts}
          selected={activeCat}
          onSelect={changeCategory}
          canManage={canManage}
          onCategoriesChange={handleCategoriesChange}
          onCategoryDeleted={handleCategoryDeleted}
        />

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-gray-150 pt-3">
          <p className="text-sm text-gray-600 tabular-nums" aria-live="polite">
            {hasFilter
              ? `พบ ${filtered.length.toLocaleString('en-US')} แบบ จากทั้งหมด ${groups.length.toLocaleString('en-US')} แบบ`
              : `ทั้งหมด ${groups.length.toLocaleString('en-US')} แบบ`}
          </p>
          {hasFilter && (
            <button type="button" onClick={clearFilters} className="btn-ghost -mr-2 px-3 text-sm">
              <RotateCcw {...ICON_SM} />
              ล้างตัวกรอง
            </button>
          )}
        </div>
      </section>

      {groups.length === 0 ? (
        <div className="card empty-state">
          <span className="icon-bubble icon-bubble-lg"><Shirt size={28} strokeWidth={1.75} aria-hidden="true" /></span>
          <p className="empty-state-title">ยังไม่มีสินค้า</p>
          {canManage && <p>กดปุ่ม &quot;เพิ่มสินค้า&quot; ด้านบนเพื่อเริ่มเพิ่มสินค้าแบบแรก</p>}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card empty-state">
          <span className="icon-bubble icon-bubble-lg"><SearchX size={28} strokeWidth={1.75} aria-hidden="true" /></span>
          <p className="empty-state-title break-words">
            {search.trim() ? `ไม่พบสินค้าที่ตรงกับ "${search.trim()}"` : 'ยังไม่มีสินค้าในหมวดนี้'}
          </p>
          <button type="button" onClick={clearFilters} className="btn-secondary mt-2">
            <RotateCcw {...ICON_SM} />
            ล้างตัวกรอง
          </button>
        </div>
      ) : (
        <>
          {/* การ์ด 1 ใบ = 1 แบบ: มือถือ 2 · จอเล็ก 3 · iPad แนวนอน 4 · คอม 5-6 คอลัมน์
              (เมนูข้างกินที่ 240px ตั้งแต่ md → ใช้ 4 คอลัมน์ตั้งแต่ lg ไม่ใช่ md การ์ดจะได้ไม่แคบเกิน) */}
          <ul
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 min-[1152px]:grid-cols-5 xl:grid-cols-6"
            aria-label="รายการสินค้า"
          >
            {visible.map(g => {
              const catId = g.category_id && catNames.has(g.category_id) ? g.category_id : null
              return (
                <li key={g.id} className="flex min-w-0">
                  <ProductCard
                    group={g}
                    categoryName={catId ? catNames.get(catId) ?? null : null}
                    canManage={canManage}
                    busy={busyIds.has(g.id)}
                    onToggle={toggleActive}
                    highlightIds={hits.get(g.id) ?? null}
                  />
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

      {/* ผลการเปิด/ปิดขาย: โทสต์ลอยล่างจอ (การ์ดที่กดอาจอยู่ไกลจากหัวหน้า — ข้อความบนสุดจะมองไม่เห็น)
          สำเร็จ = หายเอง / ผิดพลาด = ค้างจนกดปิด */}
      {msg && (
        <div
          role={msg.ok ? 'status' : 'alert'}
          className="pointer-events-none fixed inset-x-4 z-40 flex justify-center bottom-[calc(1rem_+_env(safe-area-inset-bottom))] md:left-[calc(15rem_+_1rem)] lg:bottom-6"
        >
          <div className={`${msg.ok ? 'toast-ok' : 'toast-err'} pointer-events-auto`}>
            <span className="toast-icon">
              {msg.ok
                ? <Check size={18} strokeWidth={2.4} aria-hidden="true" />
                : <X size={18} strokeWidth={2.4} aria-hidden="true" />}
            </span>
            <span className="min-w-0 break-words">{msg.text}</span>
            {!msg.ok && (
              <button type="button" onClick={() => setMsg(null)} className="btn-icon btn-icon-plain -my-1 -mr-3 text-current" aria-label="ปิดข้อความ">
                <X {...ICON_SM} />
              </button>
            )}
          </div>
        </div>
      )}

      {scanOpen && (
        <BarcodeScanner
          title="สแกนเพื่อค้นหาสินค้า"
          closeOnSuccess
          onScan={handleScan}
          onClose={() => setScanOpen(false)}
        />
      )}
    </div>
  )
}
