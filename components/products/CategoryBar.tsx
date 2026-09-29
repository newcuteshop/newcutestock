'use client'
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { AlertTriangle, Check, CheckCircle2, Info, Loader2, Pencil, Plus, Tag, Trash2, X, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { thaiError } from '@/lib/format'
import { ICON, ICON_SM } from '@/components/theme/icons'

// ===== แถบหมวดหมู่หน้าสินค้า: ชิปกรอง + เพิ่ม / เปลี่ยนชื่อ / ลบหมวดหมู่ =====
// เขียนตาราง categories ตรงๆ (RLS ให้เฉพาะผู้มีสิทธิ์ "จัดการสินค้า") — ตาม CONTRACT §5.1
// หลัง update/delete ต้อง .select() เสมอ: RLS ไม่ให้ทำ = ไม่มี error แต่ได้ 0 แถว

export interface CategoryOption { id: string; name: string }

/** ค่าตัวกรองพิเศษ: สินค้าที่ไม่มีหมวดหมู่ (category_id = null) — '' = ทั้งหมด */
export const NO_CATEGORY = '__none__'

/** จำนวนแบบสินค้า (การ์ด) ต่อหมวด */
export type CategoryCounts = { all: number; none: number; byId: Record<string, number> }

type Msg = { ok: boolean; text: string }

const NAME_MAX = 100
const MSG_NAME_EMPTY = 'กรุณากรอกชื่อหมวดหมู่'
const MSG_NAME_RULE = 'ชื่อหมวดหมู่ต้องไม่ว่าง และยาวไม่เกิน 100 ตัวอักษร'
const MSG_NAME_DUP = 'มีหมวดหมู่ชื่อนี้แล้ว'
const MSG_NO_PERMISSION = 'ไม่มีสิทธิ์ทำรายการนี้'
const MSG_DELETE_NEGATIVE = 'ลบหมวดหมู่ไม่ได้: มีสินค้าในหมวดนี้ที่ราคาหรือจำนวนขั้นต่ำติดลบค้างจากระบบเก่า — แก้ราคาสินค้านั้นก่อน'
const MSG_GONE = 'ไม่มีสิทธิ์ทำรายการนี้ หรือหมวดหมู่นี้ถูกลบไปแล้วจากเครื่องอื่น — โหลดรายการหมวดหมู่ใหม่ให้แล้ว'

// ตัดช่องว่าง + อักขระที่มองไม่เห็นหัวท้าย (NBSP, zero-width, BOM, ช่องว่างแบบจีน, bidi) ให้ตรงกับที่ฐานข้อมูลเก็บจริง
function cleanText(s: string): string {
  return s.normalize('NFC').replace(/^[\s\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]+|[\s\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]+$/g, '')
}

function errCode(err: unknown): string {
  if (!err || typeof err !== 'object') return ''
  const code = (err as { code?: unknown }).code
  return code === null || code === undefined ? '' : String(code)
}

// ข้อผิดพลาดตอนเพิ่ม/เปลี่ยนชื่อ (แยกตามการกระทำ — ห้ามใช้ข้อความเรื่องชื่อกับการลบ)
function nameErrorText(err: unknown): string {
  const code = errCode(err)
  if (code === '23505') return MSG_NAME_DUP
  if (code === '23514') return MSG_NAME_RULE
  if (code === '42501') return MSG_NO_PERMISSION
  return thaiError(err)
}

// ข้อผิดพลาดตอนลบ: P0001 = ข้อความไทยจาก trigger (บอกชื่อสินค้าที่ต้องแก้) ใช้ตามเดิม
function deleteErrorText(err: unknown): string {
  const code = errCode(err)
  if (code === 'P0001') return thaiError(err)
  if (code === '23514') return MSG_DELETE_NEGATIVE
  if (code === '42501') return MSG_NO_PERMISSION
  return thaiError(err)
}

function nameKey(s: string): string {
  return cleanText(s).toLowerCase()
}

// ใส่หมวดหมู่เข้าตำแหน่งตามตัวอักษร โดยไม่สลับลำดับรายการอื่นที่ได้มาจากฐานข้อมูล
function placeSorted(list: CategoryOption[], item: CategoryOption): CategoryOption[] {
  const rest = list.filter(c => c.id !== item.id)
  const i = rest.findIndex(c => c.name.localeCompare(item.name, 'th') > 0)
  return i < 0 ? [...rest, item] : [...rest.slice(0, i), item, ...rest.slice(i)]
}

type BarProps = {
  categories: CategoryOption[]
  counts: CategoryCounts
  /** '' = ทั้งหมด, NO_CATEGORY = ไม่มีหมวดหมู่, หรือ id หมวดหมู่ */
  selected: string
  onSelect: (value: string) => void
  /** มีสิทธิ์ "จัดการสินค้า" → เห็นปุ่มเพิ่ม/จัดการหมวดหมู่ */
  canManage: boolean
  onCategoriesChange: (next: CategoryOption[]) => void
  /** ลบหมวดหมู่สำเร็จ → สินค้าในหมวดนั้นกลายเป็น "ไม่มีหมวดหมู่" (ฐานข้อมูลตั้ง category_id = null ให้เอง) */
  onCategoryDeleted: (id: string) => void
}

export default function CategoryBar({
  categories, counts, selected, onSelect, canManage, onCategoriesChange, onCategoryDeleted,
}: BarProps) {
  const [sheet, setSheet] = useState<null | 'add' | 'manage'>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  const showNone = counts.none > 0 || selected === NO_CATEGORY

  // มือถือ (แถวชิปเลื่อนข้าง): เลื่อนชิปที่เลือกอยู่ให้อยู่ในกรอบ — เลื่อนเฉพาะในแถว ไม่ลากทั้งหน้า
  useEffect(() => {
    const row = rowRef.current
    if (!row || row.scrollWidth <= row.clientWidth) return
    const chip = row.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!chip) return
    const start = chip.offsetLeft - 16
    const end = chip.offsetLeft + chip.offsetWidth + 16
    if (start < row.scrollLeft) row.scrollLeft = Math.max(0, start)
    else if (end > row.scrollLeft + row.clientWidth) row.scrollLeft = end - row.clientWidth
  }, [selected, categories.length, showNone])

  function openSheet(mode: 'add' | 'manage', e: MouseEvent<HTMLButtonElement>) {
    triggerRef.current = e.currentTarget
    setSheet(mode)
  }

  function closeSheet() {
    setSheet(null)
    // คืนโฟกัสให้ปุ่มที่เปิด (ผู้ใช้คีย์บอร์ด/โปรแกรมอ่านจอไม่หลงตำแหน่ง)
    const el = triggerRef.current
    if (el) setTimeout(() => el.focus(), 0)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="section-kicker flex items-center gap-1.5">
          <Tag {...ICON_SM} />
          หมวดหมู่
        </h2>
        {canManage && (
          <div className="flex items-center gap-1 -mr-2">
            <button
              type="button"
              onClick={e => openSheet('add', e)}
              className="btn-ghost px-3 text-sm"
              aria-label="เพิ่มหมวดหมู่"
              aria-haspopup="dialog"
            >
              <Plus {...ICON_SM} />
              <span>เพิ่ม<span className="hidden sm:inline">หมวดหมู่</span></span>
            </button>
            <button
              type="button"
              onClick={e => openSheet('manage', e)}
              className="btn-ghost px-3 text-sm"
              aria-label="จัดการหมวดหมู่ (เปลี่ยนชื่อ / ลบ)"
              aria-haspopup="dialog"
            >
              <Pencil {...ICON_SM} />
              <span>จัดการ<span className="hidden sm:inline">หมวดหมู่</span></span>
            </button>
          </div>
        )}
      </div>

      {/* มือถือ: ชิปเรียงแถวเดียวเลื่อนข้าง (ชิดขอบการ์ด) · sm+: ขึ้นบรรทัดใหม่ได้ ไม่ต้องเลื่อน */}
      <div
        ref={rowRef}
        role="group"
        aria-label="กรองตามหมวดหมู่"
        className="relative -mx-4 flex gap-2 overflow-x-auto overscroll-x-contain scrollbar-none px-4 py-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
      >
        <FilterChip label="ทั้งหมด" count={counts.all} pressed={selected === ''} onClick={() => onSelect('')} />
        {categories.map(c => (
          <FilterChip
            key={c.id}
            label={c.name}
            count={counts.byId[c.id] ?? 0}
            pressed={selected === c.id}
            onClick={() => onSelect(c.id)}
          />
        ))}
        {showNone && (
          <FilterChip
            label="ไม่มีหมวดหมู่"
            count={counts.none}
            pressed={selected === NO_CATEGORY}
            onClick={() => onSelect(NO_CATEGORY)}
            dashed
          />
        )}
      </div>

      {canManage && categories.length === 0 && (
        <p className="text-xs text-gray-500">ยังไม่มีหมวดหมู่ — กด &quot;เพิ่มหมวดหมู่&quot; เพื่อแยกสินค้าเป็นกลุ่ม เช่น เสื้อ กางเกง กระเป๋า</p>
      )}

      {sheet && (
        <CategorySheet
          initialMode={sheet}
          categories={categories}
          counts={counts}
          selected={selected}
          onSelect={onSelect}
          onClose={closeSheet}
          onCategoriesChange={onCategoriesChange}
          onCategoryDeleted={onCategoryDeleted}
        />
      )}
    </div>
  )
}

function FilterChip({ label, count, pressed, onClick, dashed = false }: {
  label: string; count: number; pressed: boolean; onClick: () => void; dashed?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`chip-toggle group shrink-0 max-w-[15rem] ${dashed && !pressed ? 'border-dashed' : ''}`}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="tabular-nums text-xs font-bold text-gray-500 group-aria-pressed:text-white">
        {count.toLocaleString('en-US')}
      </span>
    </button>
  )
}

// ===== ป็อปอัปจัดการหมวดหมู่ (มือถือ = ชีตล่าง / คอม = กลางจอ) =====
function CategorySheet({
  initialMode, categories, counts, selected, onSelect, onClose, onCategoriesChange, onCategoryDeleted,
}: {
  initialMode: 'add' | 'manage'
  categories: CategoryOption[]
  counts: CategoryCounts
  selected: string
  onSelect: (value: string) => void
  onClose: () => void
  onCategoriesChange: (next: CategoryOption[]) => void
  onCategoryDeleted: (id: string) => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [addName, setAddName] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState<Msg | null>(null)
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const addInputRef = useRef<HTMLInputElement>(null)

  const busy = adding || busyId !== null

  // เปิดมาเพื่อ "เพิ่ม" → โฟกัสช่องชื่อเลย (มือถือเด้งคีย์บอร์ด) / "จัดการ" → โฟกัสกล่องป็อปอัป (ไม่เด้งคีย์บอร์ด)
  useEffect(() => {
    if (initialMode === 'add') addInputRef.current?.focus()
    else panelRef.current?.focus()
  }, [initialMode])

  useEffect(() => () => { if (msgTimer.current) clearTimeout(msgTimer.current) }, [])

  // Esc = ปิด (ยกเว้นกำลังบันทึก) — Esc ในช่องแก้ชื่อจะยกเลิกการแก้ชื่อแทน (หยุดไม่ให้ถึงตรงนี้)
  // Tab = วนโฟกัสอยู่ในป็อปอัป (iPad + คีย์บอร์ด ไม่หลุดไปหน้าหลังฉากมืด) — แบบเดียวกับ MobileNav
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        if (!busy) onClose()
        return
      }
      const panel = panelRef.current
      if (e.key !== 'Tab' || !panel) return
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ))
      if (focusables.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      // โฟกัสอยู่ที่ตัวกล่องเอง (เปิดโหมดจัดการ) หรือหลุดออกนอกกล่อง → ดึงกลับเข้ามา
      const outside = !active || active === panel || !panel.contains(active)
      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  function showMsg(next: Msg | null) {
    if (msgTimer.current) clearTimeout(msgTimer.current)
    setMsg(next)
    // สำเร็จ = หายเอง / ผิดพลาด = ค้างไว้จนทำรายการใหม่
    if (next?.ok) msgTimer.current = setTimeout(() => setMsg(null), 3500)
  }

  // ตรวจชื่อก่อนส่ง (ฐานข้อมูลตรวจซ้ำอีกชั้น — แต่ดัชนีกันชื่อซ้ำแบบไม่สนตัวพิมพ์อาจถูกข้ามตอนติดตั้ง จึงเช็คที่นี่ด้วย)
  function nameProblem(raw: string, exceptId?: string): string | null {
    const name = cleanText(raw)
    if (!name) return MSG_NAME_EMPTY
    if (Array.from(name).length > NAME_MAX) return MSG_NAME_RULE
    const key = name.toLowerCase()
    if (categories.some(c => c.id !== exceptId && nameKey(c.name) === key)) return MSG_NAME_DUP
    return null
  }

  // โหลดรายการหมวดหมู่ใหม่ (หลังชื่อซ้ำ / 0 แถว — อาจมีเครื่องอื่นแก้ไปแล้ว)
  async function reloadCategories() {
    const { data, error } = await supabase.from('categories').select('id, name').order('name')
    if (!error && Array.isArray(data)) onCategoriesChange(data as CategoryOption[])
  }

  async function addCategory(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const problem = nameProblem(addName)
    if (problem) {
      showMsg({ ok: false, text: problem })
      addInputRef.current?.focus()
      return
    }
    setAdding(true)
    showMsg(null)
    try {
      const { data, error } = await supabase
        .from('categories')
        .insert({ name: cleanText(addName) })
        .select('id, name')
        .single()
      if (error) throw error
      const created = data as CategoryOption
      onCategoriesChange(placeSorted(categories, created))
      setAddName('')
      showMsg({ ok: true, text: `เพิ่มหมวดหมู่ "${created.name}" แล้ว` })
    } catch (err: unknown) {
      showMsg({ ok: false, text: nameErrorText(err) })
      if (errCode(err) === '23505') void reloadCategories()
    } finally {
      setAdding(false)
      // เพิ่มต่อได้ทันที ไม่ต้องแตะช่องใหม่
      addInputRef.current?.focus()
    }
  }

  function startRename(c: CategoryOption) {
    setConfirmId(null)
    setEditingId(c.id)
    setEditName(c.name)
    showMsg(null)
  }

  function cancelRename() {
    setEditingId(null)
    setEditName('')
  }

  async function saveRename(e: FormEvent, c: CategoryOption) {
    e.preventDefault()
    if (busy) return
    const name = cleanText(editName)
    if (name === c.name) {
      cancelRename()
      return
    }
    const problem = nameProblem(editName, c.id)
    if (problem) {
      showMsg({ ok: false, text: problem })
      return
    }
    setBusyId(c.id)
    showMsg(null)
    try {
      const { data, error } = await supabase
        .from('categories')
        .update({ name })
        .eq('id', c.id)
        .select('id, name')
      if (error) throw error
      const rows = (data ?? []) as CategoryOption[]
      if (rows.length === 0) {
        showMsg({ ok: false, text: MSG_GONE })
        cancelRename()
        void reloadCategories()
        return
      }
      // ใช้ชื่อที่ฐานข้อมูลเก็บจริง (ตัดช่องว่าง/อักขระพิเศษแล้ว)
      onCategoriesChange(placeSorted(categories, rows[0]))
      cancelRename()
      showMsg({ ok: true, text: `เปลี่ยนชื่อ "${c.name}" เป็น "${rows[0].name}" แล้ว` })
    } catch (err: unknown) {
      showMsg({ ok: false, text: nameErrorText(err) })
      if (errCode(err) === '23505') void reloadCategories()
    } finally {
      setBusyId(null)
    }
  }

  async function deleteCategory(c: CategoryOption) {
    if (busy) return
    const n = counts.byId[c.id] ?? 0
    setBusyId(c.id)
    showMsg(null)
    try {
      const { data, error } = await supabase
        .from('categories')
        .delete()
        .eq('id', c.id)
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) {
        setConfirmId(null)
        showMsg({ ok: false, text: MSG_GONE })
        void reloadCategories()
        return
      }
      onCategoriesChange(categories.filter(x => x.id !== c.id))
      onCategoryDeleted(c.id)
      if (selected === c.id) onSelect('')
      setConfirmId(null)
      showMsg({
        ok: true,
        text: n > 0
          ? `ลบหมวดหมู่ "${c.name}" แล้ว — สินค้า ${n.toLocaleString('en-US')} แบบย้ายไปอยู่ "ไม่มีหมวดหมู่" (ตัวสินค้าไม่ถูกลบ)`
          : `ลบหมวดหมู่ "${c.name}" แล้ว`,
      })
    } catch (err: unknown) {
      showMsg({ ok: false, text: deleteErrorText(err) })
    } finally {
      setBusyId(null)
    }
  }

  function onRenameKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      // Esc ในช่องแก้ชื่อ = ยกเลิกการแก้ชื่อ (ไม่ปิดป็อปอัปทั้งอัน)
      e.stopPropagation()
      e.preventDefault()
      cancelRename()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 !mt-0 flex items-end sm:items-center justify-center scrim sm:p-4"
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-sheet-title"
        tabIndex={-1}
        className="sheet w-full max-w-lg max-h-[90dvh] overflow-y-auto overscroll-contain rounded-b-none border-b-0 sm:rounded-4xl sm:border-b-2 animate-fade-up focus:outline-none"
      >
        {/* หัวป็อปอัป (ติดด้านบนเวลาเลื่อน) */}
        <div className="sticky top-0 z-10 bg-white border-b border-blush-hair px-5 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="icon-bubble icon-bubble-strong"><Tag {...ICON} /></span>
            <h3 id="category-sheet-title" className="font-bold text-gray-900 text-lg leading-snug">จัดการหมวดหมู่</h3>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="btn-icon btn-icon-plain -mr-2" aria-label="ปิด">
            <X {...ICON} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* เพิ่มหมวดหมู่ใหม่ */}
          <form onSubmit={addCategory} className="space-y-1" noValidate>
            <label htmlFor="category-add-name" className="block text-sm font-medium text-gray-700 mb-1">เพิ่มหมวดหมู่ใหม่</label>
            <div className="flex gap-2">
              <input
                id="category-add-name"
                ref={addInputRef}
                className="input flex-1 min-w-0"
                maxLength={NAME_MAX}
                autoComplete="off"
                enterKeyHint="done"
                placeholder="เช่น เสื้อ, กางเกง, กระเป๋า"
                value={addName}
                onChange={e => setAddName(e.target.value)}
              />
              <button type="submit" className="btn-primary shrink-0 px-4" disabled={busy || !cleanText(addName)}>
                {adding ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Plus {...ICON_SM} />}
                {adding ? 'กำลังเพิ่ม...' : 'เพิ่ม'}
              </button>
            </div>
          </form>

          {msg && (
            <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'alert-ok' : 'alert-err'}>
              {msg.ok ? <CheckCircle2 {...ICON_SM} /> : <XCircle {...ICON_SM} />}
              <span className="min-w-0 break-words">{msg.text}</span>
            </p>
          )}

          <div className="wave-divider decor" aria-hidden="true" />

          <div className="space-y-2">
            <p className="flex items-start gap-1.5 text-xs text-gray-500">
              <Info {...ICON_SM} />
              <span className="min-w-0">ลบหมวดหมู่แล้ว สินค้าในหมวดนั้นจะย้ายไปอยู่ &quot;ไม่มีหมวดหมู่&quot; — ตัวสินค้าไม่ถูกลบ</span>
            </p>

            {categories.length === 0 ? (
              <p className="panel px-4 py-3 text-sm text-gray-500 text-center">ยังไม่มีหมวดหมู่</p>
            ) : (
              <ul className="space-y-2" aria-label="รายการหมวดหมู่">
                {categories.map(c => {
                  const n = counts.byId[c.id] ?? 0
                  const rowBusy = busyId === c.id

                  if (editingId === c.id) {
                    return (
                      <li key={c.id} className="panel p-2">
                        <form onSubmit={e => saveRename(e, c)} className="flex items-center gap-2" noValidate>
                          <label htmlFor={`category-rename-${c.id}`} className="sr-only">ชื่อใหม่ของหมวดหมู่ {c.name}</label>
                          <input
                            id={`category-rename-${c.id}`}
                            className="input flex-1 min-w-0 bg-white"
                            maxLength={NAME_MAX}
                            autoComplete="off"
                            enterKeyHint="done"
                            autoFocus
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            onKeyDown={onRenameKeyDown}
                            disabled={rowBusy}
                          />
                          <button
                            type="submit"
                            className="btn-icon"
                            disabled={busy || !cleanText(editName)}
                            aria-label={`บันทึกชื่อใหม่ของหมวดหมู่ ${c.name}`}
                          >
                            {rowBusy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Check {...ICON} />}
                          </button>
                          <button
                            type="button"
                            className="btn-icon btn-icon-plain"
                            onClick={cancelRename}
                            disabled={rowBusy}
                            aria-label="ยกเลิกการเปลี่ยนชื่อ"
                          >
                            <X {...ICON} />
                          </button>
                        </form>
                      </li>
                    )
                  }

                  if (confirmId === c.id) {
                    return (
                      <li key={c.id} className="rounded-2xl border border-red-200 bg-red-50 p-3 space-y-3">
                        <p className="flex items-start gap-2 text-sm text-red-800">
                          <AlertTriangle {...ICON_SM} className="mt-0.5" />
                          <span className="min-w-0 break-words">
                            ลบหมวดหมู่ <b>&quot;{c.name}&quot;</b>?{' '}
                            {n > 0
                              ? <>สินค้า {n.toLocaleString('en-US')} แบบในหมวดนี้จะย้ายไปอยู่ &quot;ไม่มีหมวดหมู่&quot; (ตัวสินค้าไม่ถูกลบ)</>
                              : <>หมวดนี้ยังไม่มีสินค้า</>}
                          </span>
                        </p>
                        <div className="flex gap-2">
                          <button type="button" className="btn-danger flex-1" onClick={() => deleteCategory(c)} disabled={busy}>
                            {rowBusy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Trash2 {...ICON_SM} />}
                            {rowBusy ? 'กำลังลบ...' : 'ลบหมวดหมู่'}
                          </button>
                          <button type="button" className="btn-secondary" onClick={() => setConfirmId(null)} disabled={rowBusy}>
                            ยกเลิก
                          </button>
                        </div>
                      </li>
                    )
                  }

                  return (
                    <li key={c.id} className="panel flex items-center gap-2 py-1.5 pl-4 pr-1.5 min-h-[56px]">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 break-words leading-snug">{c.name}</p>
                        <p className="text-xs text-gray-500 tabular-nums">{n.toLocaleString('en-US')} แบบ</p>
                      </div>
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => startRename(c)}
                        disabled={busy}
                        aria-label={`เปลี่ยนชื่อหมวดหมู่ ${c.name}`}
                      >
                        <Pencil {...ICON_SM} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon btn-icon-danger"
                        onClick={() => { cancelRename(); setConfirmId(c.id); showMsg(null) }}
                        disabled={busy}
                        aria-label={`ลบหมวดหมู่ ${c.name}`}
                      >
                        <Trash2 {...ICON_SM} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        {/* ท้ายป็อปอัป (ติดด้านล่าง + เว้นขอบล่างของ iPhone) */}
        <div
          className="sticky bottom-0 z-10 bg-white border-t border-blush-hair px-5 pt-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <button type="button" onClick={onClose} disabled={busy} className="btn-secondary w-full">เสร็จ</button>
        </div>
      </div>
    </div>
  )
}
