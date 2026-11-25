'use client'
// ===== หน้าชุดเช่า (เพิ่มใหม่ / ดู-แก้ไข) — แบบชุด + ราคา + รูป + ชิ้นจริง + ปฏิทินว่าง + ประวัติการเช่า =====
// บันทึกผ่าน rpc rental_save_item ครั้งเดียวทั้งแบบและชิ้น (supabase-fix-05-rental.sql):
// - แก้ไข: ส่ง updated_at ของข้อมูลที่โหลดมาเสมอ → เครื่องอื่นแก้ก่อน = บันทึกไม่ผ่าน ให้กด "โหลดข้อมูลล่าสุด" (สิ่งที่พิมพ์ไว้ไม่หาย)
// - เพิ่มใหม่: ส่ง client_id (สุ่มครั้งเดียวต่อฟอร์ม) → กดซ้ำ/เน็ตหลุดแล้วลองใหม่ ไม่เกิดชุดซ้ำ
// - รูป: เลือกได้ตั้งแต่ยังไม่บันทึก แล้วอัปโหลดทันทีหลังบันทึกชุดใหม่สำเร็จ (รูปไม่เปลี่ยนเวอร์ชันของชุด)
// - เปิด/ปิดให้เช่า และ "ซักแล้ว" ของชิ้น ทำทันทีด้วย RPC แยก (ไม่ต้องกดบันทึกฟอร์ม)
// สิทธิ์: ผู้จัดการร้านเช่า (rental_manage / admin) แก้ได้ทุกอย่าง · พนักงานร้านเช่าดูได้ + กด "ซักแล้ว" ได้
// (ฐานข้อมูลตรวจสิทธิ์ซ้ำทุกคำสั่งเสมอ)

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, Coins, EyeOff, History, Info, Loader2, Lock, PauseCircle,
  PlayCircle, Plus, RefreshCw, Save, Settings2, Shirt, Sparkles, Tags, Trash2, X, XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht, thaiError } from '@/lib/format'
import { cleanText, isNetworkError, newUuid, wait } from '@/lib/products'
import {
  linePrice, parseDeletedImagePaths, parseRentalCategory, parseRentalItem,
  type RentalCategory, type RentalItem, type RentalSettings,
} from '@/lib/rental'
import { removeRentalImageFiles } from '@/lib/rentalImages'
import ConfirmDialog from '@/components/integrations/ConfirmDialog'
import ItemGallery from './ItemGallery'
import UnitsEditor, { type FieldError } from './UnitsEditor'
import UnitTagsDialog from './UnitTagsDialog'
import ItemCalendar from './ItemCalendar'
import ItemHistory from './ItemHistory'
import { useRentalItemImages } from './useRentalItemImages'
import { rentPriceText } from './itemList'
import {
  type ItemFormState, type ItemFormUnit, type SaveItemPayload,
  MAX_BUFFER_DAYS, MAX_ITEM_CODE, MAX_ITEM_COLOR, MAX_ITEM_DESCRIPTION, MAX_ITEM_NAME, MAX_TAGS, MAX_TAG_LEN,
  emptyItemForm, formFromItem, formPrices, formSignature, isItemVersionConflict, itemMatchesPayload, itemNeedsReload,
  locateServerError, newUnitRow, rebaseItemForm, sortUnits, suggestNextCode, unitFromServer, validateItemForm,
} from './itemFormModel'

export type ItemTab = 'info' | 'calendar' | 'history'

type Msg = {
  kind: 'ok' | 'err' | 'warn' | 'info'
  text: string
  details?: string[]
  validation?: boolean
  afterCreate?: boolean
  goToId?: string
}

const ALERT_CLASS: Record<Msg['kind'], string> = { ok: 'alert-ok', err: 'alert-err', warn: 'alert-warn', info: 'alert-info' }

function MsgIcon({ kind }: { kind: Msg['kind'] }) {
  if (kind === 'ok') return <CheckCircle2 {...ICON_SM} />
  if (kind === 'err') return <XCircle {...ICON_SM} />
  if (kind === 'warn') return <AlertTriangle {...ICON_SM} />
  return <Info {...ICON_SM} />
}

function prefersReducedMotion(): boolean {
  try {
    if (document.documentElement.dataset.motion === 'off') return true
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// short = ป้ายบนมือถือ (ไม่มีไอคอน) ให้ 3 แท็บพอดีจอ 375px ไม่ต้องเลื่อนข้างหา
const TABS: { value: ItemTab; label: string; short: string; icon: typeof Shirt }[] = [
  { value: 'info', label: 'ข้อมูลและชิ้นชุด', short: 'ข้อมูลชุด', icon: Shirt },
  { value: 'calendar', label: 'ปฏิทินว่าง', short: 'ปฏิทินว่าง', icon: CalendarDays },
  { value: 'history', label: 'ประวัติการเช่า', short: 'ประวัติการเช่า', icon: History },
]

export default function ItemEditor({
  initial = null, categories: initialCategories, settings, otherCodes, canManage, shopName,
  savedNotice = null, initialTab = 'info',
}: {
  initial?: RentalItem | null
  categories: RentalCategory[]
  settings: RentalSettings
  /** รหัสของชุดอื่นทั้งหมด (เช็กรหัสซ้ำ + แนะนำรหัสถัดไป) */
  otherCodes: string[]
  canManage: boolean
  shopName: string
  savedNotice?: 'new' | 'again' | null
  initialTab?: ItemTab
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const readOnly = !canManage
  const [clientId] = useState(() => newUuid())
  const [cats, setCats] = useState<RentalCategory[]>(initialCategories)
  const [loaded, setLoaded] = useState<RentalItem | null>(initial)
  const [form, setForm] = useState<ItemFormState>(() => (initial ? formFromItem(initial) : emptyItemForm(settings)))
  const [tab, setTab] = useState<ItemTab>(initial ? initialTab : 'info')
  const [fieldError, setFieldError] = useState<FieldError>(null)
  const [focusReq, setFocusReq] = useState<{ id: string; n: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [gone, setGone] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [cleaning, setCleaning] = useState<Record<string, boolean>>({})
  const [cleanError, setCleanError] = useState('')
  const [newCat, setNewCat] = useState<{ open: boolean; name: string; busy: boolean; error: string }>({ open: false, name: '', busy: false, error: '' })
  const [msg, setMsg] = useState<Msg | null>(() => {
    if (!initial || !savedNotice) return null
    return savedNotice === 'again'
      ? { kind: 'info', text: 'บันทึกชุดนี้ไปแล้ว — แสดงข้อมูลที่บันทึกไว้', afterCreate: true }
      : { kind: 'ok', text: `เพิ่มชุด "${initial.code} ${initial.name}" เรียบร้อย`, afterCreate: true }
  })
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const busyRef = useRef(false)
  const catBusyRef = useRef(false)
  // การบันทึกครั้งล่าสุดจบด้วยเน็ตหลุด (ไม่รู้ว่าฐานข้อมูลบันทึกไปแล้วหรือยัง) → กดบันทึกครั้งถัดไปแล้วชนเวอร์ชัน
  // ให้เทียบข้อมูลล่าสุดกับที่ส่งก่อน ตรงกันทุกช่อง = บันทึกสำเร็จไปแล้ว (ไม่ขึ้นว่าเครื่องอื่นแก้)
  const unsureSaveRef = useRef(false)

  const gallery = useRentalItemImages({ itemId: loaded?.id ?? null, initialImages: initial?.images ?? [] })

  const busy = saving || toggling || deleting || reloading || finishing
  const baseForm = useMemo(() => (loaded ? formFromItem(loaded) : emptyItemForm(settings)), [loaded, settings])
  const dirty = !readOnly && formSignature(form) !== formSignature(baseForm)
  const itemActive = loaded ? loaded.is_active : form.isActive

  const formIds = new Set(form.units.map(u => u.id).filter((x): x is string => !!x))
  const removedUnits: ItemFormUnit[] = loaded ? loaded.units.filter(u => !formIds.has(u.id)).map(unitFromServer) : []
  const canDelete = !!loaded && loaded.stats.bookings_total === 0 && !loaded.units.some(u => u.has_history)
  const categoryKnown = !form.categoryId || cats.some(c => c.id === form.categoryId)
  const prices = formPrices(form)

  // ----- ข้อความแจ้งผล -----
  function showMsg(next: Msg | null, autoHideMs = 0) {
    if (msgTimer.current) clearTimeout(msgTimer.current)
    msgTimer.current = null
    setMsg(next)
    if (next && autoHideMs > 0) msgTimer.current = setTimeout(() => setMsg(m => (m === next ? null : m)), autoHideMs)
  }
  useEffect(() => () => { if (msgTimer.current) clearTimeout(msgTimer.current) }, [])

  // มาจากหน้าเพิ่มชุด (?saved=new) → เอาพารามิเตอร์ออกจากลิงก์ (รีเฟรชแล้วไม่ขึ้นข้อความซ้ำ)
  const strippedRef = useRef(false)
  useEffect(() => {
    if (!savedNotice || !initial || strippedRef.current) return
    strippedRef.current = true
    router.replace(`/rental/items/${initial.id}`, { scroll: false })
  }, [savedNotice, initial, router])

  // ปิด/รีเฟรชแท็บระหว่างมีข้อมูลที่ยังไม่บันทึก หรือรูปกำลังอัปโหลด → ถามก่อน
  const guardLeave = dirty || gallery.processing || (!loaded && gallery.queue.length > 0) || finishing
  useEffect(() => {
    if (!guardLeave) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [guardLeave])

  useEffect(() => {
    if (!focusReq) return
    const el = document.getElementById(focusReq.id)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    try { el.focus({ preventScroll: true }) } catch { /* ignore */ }
  }, [focusReq])

  function showFieldError(id: string, message: string) {
    setTab('info')
    setFieldError({ id, message })
    setFocusReq({ id, n: Date.now() })
  }

  function update(fn: (f: ItemFormState) => ItemFormState) {
    setForm(fn)
    if (fieldError) setFieldError(null)
    if (msg?.validation) showMsg(null)
  }

  function setField<K extends keyof ItemFormState>(k: K, v: ItemFormState[K]) {
    update(f => ({ ...f, [k]: v }))
  }

  // ----- แท็ก -----
  function addTag(raw: string) {
    const parts = raw.split(/[,\n]/).map(cleanText).filter(Boolean)
    if (parts.length === 0) return
    update(f => {
      const next = f.tags.slice()
      for (const p of parts) {
        if (next.length >= MAX_TAGS) break
        if (!next.some(t => t.toLowerCase() === p.toLowerCase())) next.push(p.slice(0, MAX_TAG_LEN))
      }
      return { ...f, tags: next }
    })
    setTagInput('')
  }

  // ----- ชิ้น -----
  function changeUnit(key: string, patch: Partial<ItemFormUnit>) {
    update(f => ({ ...f, units: f.units.map(u => (u.key === key ? { ...u, ...patch } : u)) }))
  }

  function addUnits(size: string, count: number) {
    update(f => ({ ...f, units: sortUnits([...f.units, ...Array.from({ length: count }, () => newUnitRow(size))]) }))
  }

  function removeUnit(key: string) {
    const u = form.units.find(x => x.key === key)
    if (!u || u.hasHistory) return
    update(f => ({ ...f, units: f.units.filter(x => x.key !== key) }))
  }

  function undoRemove(id: string) {
    const u = loaded?.units.find(x => x.id === id)
    if (!u || formIds.has(id)) return
    update(f => ({ ...f, units: sortUnits([...f.units, unitFromServer(u)]) }))
  }

  // ซักแล้ว พร้อมให้เช่า (ทำทันที) — ไม่ยุ่งกับฟอร์ม: แค่ปลดป้าย "รอซัก" ทั้งในข้อมูลที่โหลดและในฟอร์ม
  async function markClean(unitId: string) {
    if (cleaning[unitId]) return
    setCleaning(c => ({ ...c, [unitId]: true }))
    setCleanError('')
    try {
      const { error } = await supabase.rpc('rental_mark_unit_clean', { p_unit_id: unitId })
      if (error) throw error
      setLoaded(l => (l ? { ...l, units: l.units.map(u => (u.id === unitId ? { ...u, needs_cleaning: false } : u)) } : l))
      setForm(f => ({ ...f, units: f.units.map(u => (u.id === unitId ? { ...u, needsCleaning: false } : u)) }))
      router.refresh()
    } catch (e) {
      setCleanError(`บันทึก "ซักแล้ว" ไม่สำเร็จ: ${thaiError(e)}`)
    } finally {
      setCleaning(c => { const n = { ...c }; delete n[unitId]; return n })
    }
  }

  // ----- หมวด: เพิ่มด่วนจากฟอร์ม (ผู้จัดการ) -----
  async function addCategory() {
    if (catBusyRef.current) return
    const name = cleanText(newCat.name)
    if (!name) { setNewCat(s => ({ ...s, error: 'พิมพ์ชื่อหมวดก่อน' })); return }
    if (name.length > 60) { setNewCat(s => ({ ...s, error: 'ชื่อหมวดยาวเกินไป (สูงสุด 60 ตัวอักษร)' })); return }
    const same = cats.find(c => c.name.trim().toLowerCase() === name.toLowerCase())
    if (same) {
      setField('categoryId', same.id)
      setNewCat({ open: false, name: '', busy: false, error: '' })
      return
    }
    catBusyRef.current = true
    setNewCat(s => ({ ...s, busy: true, error: '' }))
    try {
      const { data, error } = await supabase.rpc('rental_save_category', { p_id: null, p_name: name, p_sort: 0, p_active: true })
      if (error) throw error
      const cat = parseRentalCategory(data)
      if (!cat) throw new Error('ข้อมูลที่ได้กลับมาไม่ถูกต้อง กรุณาโหลดหน้าใหม่')
      setCats(list => [...list.filter(c => c.id !== cat.id), cat])
      setField('categoryId', cat.id)
      setNewCat({ open: false, name: '', busy: false, error: '' })
      router.refresh()
    } catch (e) {
      const text = thaiError(e)
      // ชื่อซ้ำ = มีหมวดนี้แล้ว (เครื่องอื่นเพิ่มไว้ หรือกดครั้งก่อนสำเร็จแต่คำตอบหายระหว่างทาง) → โหลดหมวดล่าสุดแล้วเลือกหมวดนั้นให้เลย
      if (text.includes('อยู่แล้ว')) {
        try {
          const { data: rows } = await supabase.from('rental_categories').select('id, name, sort_order, is_active, created_at')
            .order('sort_order').order('name')
          const list = Array.isArray(rows) ? rows.map(parseRentalCategory).filter((c): c is RentalCategory => c !== null) : []
          const found = list.find(c => cleanText(c.name).toLowerCase() === name.toLowerCase())
          if (found) {
            setCats(list)
            setField('categoryId', found.id)
            setNewCat({ open: false, name: '', busy: false, error: '' })
            return
          }
        } catch { /* โหลดไม่ได้ → แสดงข้อความเดิม */ }
      }
      setNewCat(s => ({ ...s, busy: false, error: text }))
    } finally {
      catBusyRef.current = false
    }
  }

  // ----- โหลดข้อมูลจากฐานข้อมูล -----
  async function fetchItem(id: string): Promise<RentalItem | null> {
    const { data, error } = await supabase.rpc('rental_get_item', { p_item_id: id })
    if (error) {
      if (thaiError(error).includes('ไม่พบชุดนี้')) return null
      throw error
    }
    const item = parseRentalItem(data)
    if (!item) throw new Error('ข้อมูลชุดไม่ถูกต้อง กรุณาโหลดหน้าใหม่')
    return item
  }

  // ----- บันทึก -----
  async function saveWithRetry(payload: SaveItemPayload): Promise<RentalItem> {
    let lastErr: unknown = null
    // ไม่แน่ใจตั้งแต่ก่อนเริ่ม = กดบันทึกครั้งก่อนจบด้วยเน็ตหลุด (ดู unsureSaveRef)
    let unsure = unsureSaveRef.current
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await wait(attempt === 1 ? 800 : 2000)
      let res: { data: unknown; error: unknown }
      try {
        res = await supabase.rpc('rental_save_item', payload)
      } catch (e) {
        res = { data: null, error: e }
      }
      if (!res.error) {
        unsureSaveRef.current = false
        const item = parseRentalItem(res.data)
        if (!item) throw new Error('ข้อมูลที่ได้กลับมาไม่ถูกต้อง กรุณาโหลดหน้าใหม่')
        return item
      }
      lastErr = res.error
      // ครั้งก่อนเน็ตหลุด (อาจบันทึกไปแล้ว คำตอบหายระหว่างทาง) แล้วครั้งนี้ชนเวอร์ชัน
      // → ข้อมูลล่าสุดตรงกับที่ส่งไปทุกช่อง = ถือว่าบันทึกสำเร็จ
      const id = typeof payload.p_item.id === 'string' ? payload.p_item.id : null
      if (id && unsure && isItemVersionConflict(thaiError(res.error))) {
        try {
          const fresh = await fetchItem(id)
          if (fresh && itemMatchesPayload(fresh, payload)) {
            unsureSaveRef.current = false
            return fresh
          }
        } catch { /* ใช้ข้อผิดพลาดเดิม */ }
      }
      // สร้างใหม่: client_id เดิมทุกครั้ง → ลองซ้ำได้ปลอดภัย · แก้ไข: ลองซ้ำได้เพราะมีตัวล็อกเวอร์ชัน
      if (!isNetworkError(res.error)) {
        unsureSaveRef.current = false
        break
      }
      unsure = true
      unsureSaveRef.current = true
    }
    throw lastErr
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (e.target !== e.currentTarget) return
    if (readOnly || busyRef.current || busy || gone) return
    setConflict(false)
    setFieldError(null)

    const res = validateItemForm(form, { loaded, clientId, otherCodes })
    if (!res.ok) {
      showFieldError(res.fieldId, res.message)
      showMsg({ kind: 'err', text: res.message, validation: true })
      return
    }
    busyRef.current = true
    showMsg(null)
    setSaving(true)
    const wasNew = !loaded
    let result: RentalItem
    try {
      result = await saveWithRetry(res.payload)
    } catch (err: unknown) {
      const text = thaiError(err)
      if (itemNeedsReload(text)) setConflict(true)
      const fid = locateServerError(text, form)
      if (fid) showFieldError(fid, text)
      showMsg({
        kind: 'err',
        text: isNetworkError(err)
          ? `${text} — ${wasNew ? 'กดบันทึกซ้ำได้ ระบบไม่สร้างชุดซ้ำ' : 'ตรวจสอบข้อมูลแล้วกดบันทึกอีกครั้ง'}`
          : text,
      })
      setSaving(false)
      busyRef.current = false
      return
    }

    setLoaded(result)
    setForm(formFromItem(result))
    setSaving(false)

    if (!wasNew) {
      busyRef.current = false
      if (res.warnings.length > 0) showMsg({ kind: 'warn', text: 'บันทึกการแก้ไขแล้ว — มีเรื่องที่ต้องจัดการต่อ', details: res.warnings })
      else showMsg({ kind: 'ok', text: 'บันทึกการแก้ไขเรียบร้อย' }, 5000)
      router.refresh()
      return
    }

    // ชุดใหม่: อัปโหลดรูปที่เลือกรอไว้ก่อน แล้วค่อยไปหน้าของชุดนี้
    const again = result.already_saved && !itemMatchesPayload(result, res.payload)
    setFinishing(true)
    if (gallery.queue.length > 0) showMsg({ kind: 'info', text: 'บันทึกชุดแล้ว — กำลังอัปโหลดรูป อย่าเพิ่งปิดหน้านี้' })
    const failed = (await gallery.uploadPending(result.id)).failed
    busyRef.current = false
    if (failed > 0) {
      setFinishing(false)
      showMsg({
        kind: 'warn',
        text: `บันทึกชุดแล้ว แต่อัปโหลดรูปไม่สำเร็จ ${failed} รูป — กด "ลองอัปโหลดใหม่" ที่รูปนั้น หรือเพิ่มรูปภายหลังในหน้าชุดนี้`,
        goToId: result.id,
      })
      router.refresh()
      return
    }
    router.replace(`/rental/items/${result.id}?saved=${again ? 'again' : 'new'}`)
    router.refresh()
  }

  // ----- บันทึกชนกับเครื่องอื่น: โหลดข้อมูลล่าสุด แล้วรวมกับที่ผู้ใช้แก้ไว้ -----
  async function reloadLatest() {
    if (reloading) return
    setReloading(true)
    try {
      let list = cats
      const catRes = await supabase.from('rental_categories').select('id, name, sort_order, is_active, created_at')
        .order('sort_order').order('name')
      if (!catRes.error && Array.isArray(catRes.data)) {
        list = catRes.data.map(parseRentalCategory).filter((c): c is RentalCategory => c !== null)
        setCats(list)
      }
      if (!loaded) {
        const lost = !!form.categoryId && !list.some(c => c.id === form.categoryId)
        if (lost) update(f => ({ ...f, categoryId: '' }))
        setConflict(false)
        showMsg({ kind: 'info', text: lost ? 'หมวดที่เลือกไว้ถูกลบแล้ว — เลือกหมวดใหม่แล้วกดบันทึกอีกครั้ง' : 'โหลดหมวดล่าสุดแล้ว — ตรวจสอบแล้วกดบันทึกอีกครั้ง' })
        return
      }
      const fresh = await fetchItem(loaded.id)
      if (!fresh) {
        setGone(true)
        setConflict(false)
        showMsg({ kind: 'err', text: 'ชุดนี้ถูกลบไปแล้วจากเครื่องอื่น' })
        return
      }
      const { form: merged, changes } = rebaseItemForm(baseForm, form, fresh)
      if (merged.categoryId && !list.some(c => c.id === merged.categoryId)) {
        merged.categoryId = ''
        changes.push('หมวดที่เลือกไว้ถูกลบแล้ว — เปลี่ยนเป็นไม่มีหมวด (เลือกใหม่ได้)')
      }
      setLoaded(fresh)
      setForm(merged)
      setFieldError(null)
      gallery.replaceImages(fresh.images)
      setConflict(false)
      showMsg({
        kind: 'warn',
        text: 'โหลดข้อมูลล่าสุดแล้ว — ตรวจสอบแล้วกดบันทึกอีกครั้ง (สิ่งที่คุณแก้ไว้ยังอยู่ในฟอร์ม)',
        details: changes.length > 0 ? changes.slice(0, 15) : ['ไม่พบความแตกต่างของข้อมูลชุด'],
      })
    } catch (e: unknown) {
      showMsg({ kind: 'err', text: thaiError(e) })
    } finally {
      setReloading(false)
    }
  }

  // ----- เปิด / ปิดให้เช่า (ทำทันที) -----
  async function toggleActive() {
    if (!loaded || readOnly || busyRef.current || busy || gone) return
    busyRef.current = true
    const next = !loaded.is_active
    setToggling(true)
    showMsg(null)
    try {
      const { data, error } = await supabase.rpc('rental_set_item_active', { p_item_id: loaded.id, p_active: next })
      if (error) throw error
      const fresh = parseRentalItem(data)
      if (!fresh) throw new Error('ข้อมูลที่ได้กลับมาไม่ถูกต้อง กรุณาโหลดหน้าใหม่')
      // เวอร์ชันใหม่ (updated_at) ต้องเข้าฟอร์มทันที ไม่งั้นบันทึกครั้งถัดไปจะชน
      // + ถ้าระหว่างนี้เครื่องอื่นแก้อย่างอื่นด้วย ให้รวมเข้าฟอร์มแล้วบอกผู้ใช้
      const { form: merged, changes } = rebaseItemForm(baseForm, form, fresh)
      setLoaded(fresh)
      setForm(merged)
      gallery.replaceImages(fresh.images)
      const text = next
        ? 'เปิดให้เช่าแล้ว — จองได้ทั้งหน้าร้าน' + (fresh.is_public ? 'และหน้าจองออนไลน์' : '')
        : 'ปิดให้เช่าแล้ว — จองใหม่ไม่ได้ (การจองที่มีอยู่ยังอยู่ครบ)'
      if (changes.length > 0) showMsg({ kind: 'warn', text: `${text} · ระหว่างนี้มีการแก้ไขจากเครื่องอื่น ตรวจสอบก่อนบันทึก`, details: changes.slice(0, 15) })
      else showMsg({ kind: 'ok', text }, 5000)
      router.refresh()
    } catch (e: unknown) {
      showMsg({ kind: 'err', text: thaiError(e) })
    } finally {
      busyRef.current = false
      setToggling(false)
    }
  }

  // ----- ลบชุด (เฉพาะที่ยังไม่เคยถูกจอง) -----
  async function doDelete() {
    if (!loaded || readOnly || busyRef.current || !canDelete) return
    busyRef.current = true
    setDeleting(true)
    showMsg(null)
    try {
      const { data, error } = await supabase.rpc('rental_delete_item', { p_item_id: loaded.id })
      if (error) throw error
      void removeRentalImageFiles(supabase, parseDeletedImagePaths(data))
      setConfirmDelete(false)
      router.push('/rental/items')
      router.refresh()
    } catch (e: unknown) {
      const text = thaiError(e)
      setConfirmDelete(false)
      // กดลบซ้ำหลังเน็ตหลุด (ครั้งแรกลบสำเร็จแล้วแต่คำตอบหาย) หรือเครื่องอื่นลบไปก่อน → ชุดไม่อยู่แล้ว = ผลเหมือนลบสำเร็จ
      if (text.includes('ไม่พบชุดนี้')) {
        router.push('/rental/items')
        router.refresh()
        return
      }
      showMsg({
        kind: 'err',
        text: isNetworkError(e) ? `${text} — ไม่แน่ใจว่าลบสำเร็จหรือยัง กดลบอีกครั้งได้ (ถ้าลบไปแล้วระบบจะพากลับไปรายการชุด)` : text,
      })
      setDeleting(false)
      busyRef.current = false
    }
  }

  // ป้ายแขวน: ใช้ชิ้นที่บันทึกแล้วเท่านั้น (ชิ้นใหม่ยังไม่มีรหัสจริง)
  const tagGroups = loaded
    ? [{
        item_id: loaded.id,
        item_code: loaded.code,
        item_name: loaded.name,
        price_text: rentPriceText(loaded.base_price, loaded.base_days),
        units: loaded.units.map(u => ({ id: u.id, unit_code: u.unit_code, size: u.size, status: u.status })),
      }]
    : []
  const unitCodes = useMemo(() => new Map((loaded?.units ?? []).map(u => [u.id, u.unit_code])), [loaded])
  const activeUnitCount = loaded ? loaded.units.filter(u => u.status !== 'retired').length : 0

  const title = loaded ? `ชุด ${loaded.code}` : 'เพิ่มชุดใหม่'
  const subtitle = loaded ? loaded.name : 'กรอกข้อมูลชุด ราคา เพิ่มรูป และเพิ่มชิ้นจริงตามไซส์'
  const inputDisabled = busy || gone || readOnly
  const suggested = !loaded && !cleanText(form.code) && !readOnly ? suggestNextCode(otherCodes) : ''
  const errText = (id: string) => (fieldError?.id === id ? fieldError.message : null)
  const errProps = (id: string) => ({
    'aria-invalid': fieldError?.id === id ? true : undefined,
    'aria-describedby': fieldError?.id === id ? `${id}-err` : undefined,
  })
  const errLine = (id: string) =>
    errText(id) ? <p id={`${id}-err`} className="field-hint font-medium text-red-700">{errText(id)}</p> : null

  // ตัวอย่างค่าเช่าตามจำนวนวัน
  const samples: { days: number; price: number }[] = []
  if (prices) {
    const set = new Set<number>([1, prices.baseDays, prices.baseDays + 1, prices.baseDays + 2, prices.baseDays + 4])
    for (const d of Array.from(set).sort((a, b) => a - b)) {
      if (d >= 1 && d <= 60) samples.push({ days: d, price: linePrice(prices.base, prices.baseDays, prices.extra, d) })
    }
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <Link href="/rental/items" className="link text-sm">
            <ArrowLeft {...ICON_SM} />
            กลับไปรายการชุด
          </Link>
          <h1 className="page-title break-words">{title}</h1>
          <p className="page-subtitle break-words">{subtitle}</p>
        </div>
        {loaded && (
          <div className="page-actions">
            {!loaded.is_active && (
              <span className="chip-outline">
                <PauseCircle size={14} strokeWidth={2} aria-hidden="true" />
                ปิดให้เช่าอยู่
              </span>
            )}
            {!loaded.is_public && (
              <span className="chip-outline">
                <EyeOff size={14} strokeWidth={2} aria-hidden="true" />
                ไม่แสดงออนไลน์
              </span>
            )}
            <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => setTagsOpen(true)} disabled={loaded.units.length === 0}>
              <Tags {...ICON_SM} />
              พิมพ์ป้ายแขวน
            </button>
          </div>
        )}
      </div>

      {loaded && (
        <div className="lift-scroll -mx-1 flex gap-2 overflow-x-auto overscroll-x-contain scrollbar-none px-1 [--lift-scroll-pb:0.25rem]" role="group" aria-label="ส่วนของหน้าชุด">
          {TABS.map(t => {
            const Icon = t.icon
            return (
              <button
                key={t.value}
                type="button"
                aria-pressed={tab === t.value}
                className="chip-toggle lift-hover lift-tab shrink-0"
                onClick={() => setTab(t.value)}
              >
                <Icon {...ICON_XS} className="hidden sm:block" />
                <span className="sm:hidden">{t.short}</span>
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            )
          })}
        </div>
      )}

      {readOnly && tab === 'info' && (
        <div className="alert-info">
          <Lock {...ICON_SM} />
          <p className="min-w-0">ดูข้อมูลได้อย่างเดียว — เพิ่ม/แก้ไขชุดได้เฉพาะผู้จัดการร้านเช่า · ปุ่ม &quot;ซักแล้ว พร้อมให้เช่า&quot; ที่รายการชิ้นกดได้ตามปกติ</p>
        </div>
      )}

      {/* ปฏิทิน/ประวัติ โหลดเมื่อเปิดแท็บเท่านั้น · ฟอร์มซ่อนไว้ (ไม่ถอด) ระหว่างดูแท็บอื่น สิ่งที่พิมพ์ค้างไว้จึงไม่หาย */}
      {loaded && tab === 'calendar' && <ItemCalendar itemId={loaded.id} />}
      {loaded && tab === 'history' && (
        <ItemHistory itemId={loaded.id} unitCodes={unitCodes} stats={loaded.stats} activeUnits={activeUnitCount} />
      )}

      <form onSubmit={handleSubmit} noValidate className={clsx('space-y-4 sm:space-y-6', tab !== 'info' && 'hidden')}>
        <div className="grid gap-4 sm:gap-6 lg:grid-cols-2 lg:items-start">
          <ItemGallery
            api={gallery}
            itemId={loaded?.id ?? null}
            itemName={form.name}
            disabled={deleting || gone || saving || finishing}
            readOnly={readOnly}
          />

          {/* ข้อมูลชุด */}
          <section className="card p-4 sm:p-5 space-y-4 min-w-0" aria-labelledby="ri-sec-info">
            <h2 id="ri-sec-info" className="section-title">
              <Shirt {...ICON} />
              ข้อมูลชุด
            </h2>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <div className="min-w-0">
                <label htmlFor="ri-code" className="field-label">รหัสชุด *</label>
                <input
                  id="ri-code" className="input font-mono" maxLength={MAX_ITEM_CODE + 10} value={form.code}
                  disabled={inputDisabled} autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                  placeholder="เช่น D001" onChange={e => setField('code', e.target.value)} {...errProps('ri-code')}
                />
                {errLine('ri-code')}
                {suggested && (
                  <button type="button" className="btn-ghost -ml-2 mt-1 md:min-h-[36px] px-2 text-xs" onClick={() => setField('code', suggested)}>
                    ใช้รหัสถัดไป: <span className="font-mono font-semibold">{suggested}</span>
                  </button>
                )}
                {!suggested && !errText('ri-code') && (
                  <p className="field-hint">อังกฤษ/ตัวเลข ไม่มีช่องว่าง · ชิ้นที่ไม่ใส่รหัส ระบบตั้งให้เป็น {cleanText(form.code) || 'รหัสชุด'}-01, -02 …</p>
                )}
              </div>
              <div className="min-w-0">
                <label htmlFor="ri-name" className="field-label">ชื่อชุด *</label>
                <input
                  id="ri-name" className="input" maxLength={MAX_ITEM_NAME + 20} value={form.name} disabled={inputDisabled}
                  autoComplete="off" placeholder="เช่น ชุดไทยจักรพรรดิ สีทอง" onChange={e => setField('name', e.target.value)}
                  {...errProps('ri-name')}
                />
                {errLine('ri-name')}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor="ri-category" className="field-label">หมวด</label>
                <select
                  id="ri-category" className="input" value={form.categoryId} disabled={inputDisabled}
                  onChange={e => setField('categoryId', e.target.value)} {...errProps('ri-category')}
                >
                  <option value="">-- ไม่มีหมวด --</option>
                  {cats.map(c => <option key={c.id} value={c.id}>{c.name}{c.is_active ? '' : ' (ซ่อนอยู่)'}</option>)}
                  {!categoryKnown && <option value={form.categoryId}>(หมวดที่ถูกลบแล้ว)</option>}
                </select>
                {errLine('ri-category')}
                {!readOnly && !newCat.open && (
                  <button
                    type="button" className="btn-ghost -ml-2 mt-1 md:min-h-[36px] px-2 text-xs" disabled={inputDisabled}
                    onClick={() => setNewCat({ open: true, name: '', busy: false, error: '' })}
                  >
                    <Plus {...ICON_XS} />
                    เพิ่มหมวดใหม่
                  </button>
                )}
                {!readOnly && newCat.open && (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex gap-2">
                      <input
                        className="input" aria-label="ชื่อหมวดใหม่" placeholder="ชื่อหมวด เช่น ชุดไทย" maxLength={70}
                        value={newCat.name} disabled={newCat.busy} autoFocus
                        onChange={e => setNewCat(s => ({ ...s, name: e.target.value, error: '' }))}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); void addCategory() }
                          if (e.key === 'Escape') { e.preventDefault(); setNewCat({ open: false, name: '', busy: false, error: '' }) }
                        }}
                      />
                      <button type="button" className="btn-secondary shrink-0 px-3" disabled={newCat.busy} onClick={() => { void addCategory() }}>
                        {newCat.busy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Plus {...ICON_SM} />}
                        เพิ่ม
                      </button>
                      <button type="button" className="btn-icon btn-icon-plain shrink-0" aria-label="ยกเลิกเพิ่มหมวด" disabled={newCat.busy}
                        onClick={() => setNewCat({ open: false, name: '', busy: false, error: '' })}>
                        <X {...ICON_SM} />
                      </button>
                    </div>
                    {newCat.error && <p className="text-xs font-medium text-red-700" role="alert">{newCat.error}</p>}
                    <p className="field-hint !mt-0">จัดลำดับ/ซ่อน/ลบหมวดได้ที่หน้าตั้งค่าร้านเช่า</p>
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <label htmlFor="ri-color" className="field-label">สี</label>
                <input
                  id="ri-color" className="input" maxLength={MAX_ITEM_COLOR + 10} value={form.color} disabled={inputDisabled}
                  autoComplete="off" placeholder="ทอง, ครีม, ชมพูพาสเทล..." onChange={e => setField('color', e.target.value)}
                  {...errProps('ri-color')}
                />
                {errLine('ri-color')}
              </div>
            </div>
            <div>
              <label htmlFor="ri-desc" className="field-label">รายละเอียด (แสดงบนหน้าจองออนไลน์)</label>
              <textarea
                id="ri-desc" className="input" rows={4} maxLength={MAX_ITEM_DESCRIPTION + 50} value={form.description}
                disabled={inputDisabled} placeholder="เนื้อผ้า สัดส่วน (อก/เอว/สะโพก/ความยาว) ของที่มากับชุด ข้อควรระวัง ฯลฯ"
                onChange={e => setField('description', e.target.value)} {...errProps('ri-desc')}
              />
              <p className={clsx('field-hint text-right tabular-nums', form.description.length > MAX_ITEM_DESCRIPTION ? 'font-medium text-red-700' : 'text-gray-500')}>
                {form.description.length.toLocaleString('en-US')}/{MAX_ITEM_DESCRIPTION.toLocaleString('en-US')}
              </p>
              {errLine('ri-desc')}
            </div>
            <div>
              <label htmlFor="ri-tags" className="field-label">แท็ก (ช่วยค้นหา เช่น งานแต่ง, ถ่ายพรีเวดดิ้ง)</label>
              {form.tags.length > 0 && (
                <ul className={clsx('mb-2 flex flex-wrap', readOnly ? 'gap-1.5' : 'gap-3')} aria-label="แท็กที่ใส่แล้ว">
                  {form.tags.map(t => (
                    <li key={t} className="chip max-w-full pr-1">
                      <span className="min-w-0 max-w-[12rem] truncate">{t}</span>
                      {!readOnly && (
                        // ปุ่มเล็กในป้าย แต่พื้นที่แตะจริง 44px (after: ขยายออกรอบปุ่ม 10px — ช่องห่างระหว่างป้าย 12px จึงไม่ทับกัน)
                        <button
                          type="button"
                          className="relative -my-1 grid h-6 w-6 shrink-0 place-items-center rounded-full text-gray-500 after:absolute after:-inset-2.5 [@media(hover:hover)]:hover:bg-gray-200"
                          aria-label={`เอาแท็ก ${t} ออก`}
                          disabled={inputDisabled}
                          onClick={() => update(f => ({ ...f, tags: f.tags.filter(x => x !== t) }))}
                        >
                          <X size={12} strokeWidth={2.4} aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!readOnly && (
                <div className="flex gap-2">
                  <input
                    id="ri-tags" className="input" maxLength={MAX_TAG_LEN * 3} value={tagInput}
                    disabled={inputDisabled || form.tags.length >= MAX_TAGS} autoComplete="off"
                    placeholder={form.tags.length >= MAX_TAGS ? `ครบ ${MAX_TAGS} แท็กแล้ว` : 'พิมพ์แล้วกด Enter หรือคั่นด้วย ,'}
                    onChange={e => {
                      const v = e.target.value
                      if (v.includes(',')) addTag(v)
                      else setTagInput(v)
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput) } }}
                    onBlur={() => { if (cleanText(tagInput)) addTag(tagInput) }}
                    {...errProps('ri-tags')}
                  />
                  <button type="button" className="btn-secondary shrink-0 px-3" disabled={inputDisabled || !cleanText(tagInput)} onClick={() => addTag(tagInput)}>
                    <Plus {...ICON_SM} />
                    เพิ่ม
                  </button>
                </div>
              )}
              {readOnly && form.tags.length === 0 && <p className="text-sm text-gray-500">-</p>}
              {errLine('ri-tags')}
            </div>
          </section>
        </div>

        {/* ราคาและเงินประกัน */}
        <section className="card p-4 sm:p-5 space-y-4 min-w-0" aria-labelledby="ri-sec-price">
          <h2 id="ri-sec-price" className="section-title">
            <Coins {...ICON} />
            ราคาและเงินประกัน
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="min-w-0">
              <label htmlFor="ri-base-price" className="field-label">ค่าเช่า (บาท) *</label>
              <input
                id="ri-base-price" className="input tabular-nums" inputMode="decimal" value={form.basePrice} disabled={inputDisabled}
                autoComplete="off" placeholder="เช่น 1500" onChange={e => setField('basePrice', e.target.value)} {...errProps('ri-base-price')}
              />
              {errLine('ri-base-price')}
            </div>
            <div className="min-w-0">
              <label htmlFor="ri-base-days" className="field-label">ค่าเช่านี้รวมกี่วัน *</label>
              <input
                id="ri-base-days" className="input tabular-nums" inputMode="numeric" value={form.baseDays} disabled={inputDisabled}
                autoComplete="off" onChange={e => setField('baseDays', e.target.value)} {...errProps('ri-base-days')}
              />
              {errLine('ri-base-days')}
              {!errText('ri-base-days') && <p className="field-hint">นับวันรับ–วันคืนรวมกัน (รับศุกร์ คืนอาทิตย์ = 3 วัน)</p>}
            </div>
            <div className="min-w-0">
              <label htmlFor="ri-extra" className="field-label">ค่าเช่าวันเพิ่ม (บาท/วัน)</label>
              <input
                id="ri-extra" className="input tabular-nums" inputMode="decimal" value={form.extraDayPrice} disabled={inputDisabled}
                autoComplete="off" onChange={e => setField('extraDayPrice', e.target.value)} {...errProps('ri-extra')}
              />
              {errLine('ri-extra')}
              {!errText('ri-extra') && <p className="field-hint">ใช้คิดค่าเช่าเกินวัน และค่าปรับคืนช้า (ถ้าตั้งค่าร้านแบบคิดต่อวันต่อชุด)</p>}
            </div>
            <div className="min-w-0">
              <label htmlFor="ri-deposit" className="field-label">ค่าประกันชุด (บาท)</label>
              <input
                id="ri-deposit" className="input tabular-nums" inputMode="decimal" value={form.securityDeposit} disabled={inputDisabled}
                autoComplete="off" onChange={e => setField('securityDeposit', e.target.value)} {...errProps('ri-deposit')}
              />
              {errLine('ri-deposit')}
              {!errText('ri-deposit') && <p className="field-hint">รับตอนลูกค้ารับชุด คืนเมื่อคืนชุดครบสภาพดี</p>}
            </div>
            <div className="min-w-0">
              <label htmlFor="ri-replace" className="field-label">ค่าชดเชยกรณีสูญหาย (บาท)</label>
              <input
                id="ri-replace" className="input tabular-nums" inputMode="decimal" value={form.replacementCost} disabled={inputDisabled}
                autoComplete="off" onChange={e => setField('replacementCost', e.target.value)} {...errProps('ri-replace')}
              />
              {errLine('ri-replace')}
              {!errText('ri-replace') && <p className="field-hint">ระบบแนะนำยอดนี้ตอนบันทึกคืนชุดแบบ &quot;สูญหาย&quot;</p>}
            </div>
          </div>
          {samples.length > 0 && (
            <div className="panel px-3.5 py-3">
              <p className="text-xs font-semibold text-gray-700">ตัวอย่างค่าเช่าตามจำนวนวัน</p>
              <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
                {samples.map(s => (
                  <li key={s.days}>
                    <span className="text-gray-600">{s.days} วัน</span>{' '}
                    <span className="money text-gray-900">{baht(s.price)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* การจองและการแสดงผล */}
        <section className="card p-4 sm:p-5 space-y-4 min-w-0" aria-labelledby="ri-sec-rules">
          <h2 id="ri-sec-rules" className="section-title">
            <Settings2 {...ICON} />
            การจองและการแสดงผล
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor="ri-buf-before" className="field-label">วันเตรียมชุดก่อนลูกค้ารับ</label>
              <select
                id="ri-buf-before" className="input" value={form.bufferBefore} disabled={inputDisabled}
                onChange={e => setField('bufferBefore', e.target.value)} {...errProps('ri-buf-before')}
              >
                <option value="">ตามตั้งค่าร้าน ({settings.buffer_before_days} วัน)</option>
                {Array.from({ length: MAX_BUFFER_DAYS + 1 }, (_, i) => <option key={i} value={String(i)}>{i} วัน</option>)}
              </select>
              {errLine('ri-buf-before')}
            </div>
            <div className="min-w-0">
              <label htmlFor="ri-buf-after" className="field-label">วันซัก/ตรวจชุดหลังลูกค้าคืน</label>
              <select
                id="ri-buf-after" className="input" value={form.bufferAfter} disabled={inputDisabled}
                onChange={e => setField('bufferAfter', e.target.value)} {...errProps('ri-buf-after')}
              >
                <option value="">ตามตั้งค่าร้าน ({settings.buffer_after_days} วัน)</option>
                {Array.from({ length: MAX_BUFFER_DAYS + 1 }, (_, i) => <option key={i} value={String(i)}>{i} วัน</option>)}
              </select>
              {errLine('ri-buf-after')}
            </div>
          </div>
          <p className="text-xs text-gray-500">ช่วงวันเหล่านี้ระบบกันชิ้นไว้ไม่ให้คนอื่นจองซ้อน (เช่น ซักชุดหลังคืน 1 วัน)</p>

          <div className="grid gap-2 sm:grid-cols-2">
            <label htmlFor="ri-public" className={clsx('panel flex min-h-[52px] items-start gap-3 px-3.5 py-3', !inputDisabled && 'cursor-pointer')}>
              <input
                id="ri-public" type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
                checked={form.isPublic} disabled={inputDisabled} onChange={e => setField('isPublic', e.target.checked)}
              />
              <span className="min-w-0">
                <span className="block font-semibold text-gray-900">แสดงในหน้าจองออนไลน์</span>
                <span className="block text-xs text-gray-500">ไม่ติ๊ก = ลูกค้าจองเองไม่ได้ จองได้เฉพาะหน้าร้าน</span>
              </span>
            </label>
            <label htmlFor="ri-accessory" className={clsx('panel flex min-h-[52px] items-start gap-3 px-3.5 py-3', !inputDisabled && 'cursor-pointer')}>
              <input
                id="ri-accessory" type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
                checked={form.isAccessory} disabled={inputDisabled} onChange={e => setField('isAccessory', e.target.checked)}
              />
              <span className="min-w-0">
                <span className="block font-semibold text-gray-900">เป็นเครื่องประดับ / ของเสริม</span>
                <span className="block text-xs text-gray-500">เช่น ต่างหู เข็มขัด ผ้าคลุมไหล่ — แสดงแยกเป็นของเสริมตอนเลือกชุด</span>
              </span>
            </label>
            {!loaded && (
              <label htmlFor="ri-active" className={clsx('panel flex min-h-[52px] items-start gap-3 px-3.5 py-3', !inputDisabled && 'cursor-pointer')}>
                <input
                  id="ri-active" type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
                  checked={form.isActive} disabled={inputDisabled} onChange={e => setField('isActive', e.target.checked)}
                />
                <span className="min-w-0">
                  <span className="block font-semibold text-gray-900">เปิดให้เช่าทันที</span>
                  <span className="block text-xs text-gray-500">ไม่ติ๊ก = บันทึกไว้ก่อน ยังจองไม่ได้</span>
                </span>
              </label>
            )}
          </div>
        </section>

        <UnitsEditor
          units={form.units}
          removed={removedUnits}
          itemCode={form.code}
          readOnly={readOnly}
          disabled={busy || gone}
          fieldError={fieldError}
          cleaning={cleaning}
          cleanError={cleanError}
          onChange={changeUnit}
          onAdd={addUnits}
          onRemove={removeUnit}
          onUndoRemove={undoRemove}
          onMarkClean={id => { void markClean(id) }}
        />

        {/* สถานะการให้เช่า + ลบ (เฉพาะชุดที่บันทึกแล้ว + ผู้จัดการ) */}
        {loaded && !readOnly && (
          <section className="card p-4 sm:p-5 space-y-3 min-w-0" aria-labelledby="ri-sec-status">
            <h2 id="ri-sec-status" className="section-title">
              {itemActive ? <PlayCircle {...ICON} className="!text-green-700" /> : <PauseCircle {...ICON} className="!text-gray-500" />}
              สถานะการให้เช่า
            </h2>
            <p className="text-sm text-gray-600">
              {itemActive
                ? 'เปิดให้เช่าอยู่ — เลือกชุดนี้ตอนจองได้' + (loaded.is_public ? ' และแสดงบนหน้าจองออนไลน์' : ' (ไม่แสดงบนหน้าจองออนไลน์)')
                : 'ปิดให้เช่าอยู่ — จองใหม่ไม่ได้ การจองเดิมและประวัติยังอยู่ครบ'}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button type="button" onClick={() => { void toggleActive() }} disabled={busy || gone} className="btn-secondary w-full sm:w-auto">
                {toggling
                  ? <><Loader2 {...ICON_SM} className="animate-spin" />กำลังบันทึก...</>
                  : itemActive
                    ? <><PauseCircle {...ICON_SM} />ปิดให้เช่าชุดนี้</>
                    : <><PlayCircle {...ICON_SM} />เปิดให้เช่าชุดนี้</>}
              </button>
              {canDelete ? (
                <button type="button" onClick={() => setConfirmDelete(true)} disabled={busy || gone} className="btn-danger-soft w-full sm:w-auto sm:ml-auto">
                  <Trash2 {...ICON_SM} />
                  ลบชุดนี้
                </button>
              ) : (
                <p className="flex items-center gap-1.5 text-xs text-gray-500 sm:ml-auto">
                  <Lock size={14} strokeWidth={2} aria-hidden="true" />
                  มีประวัติการเช่าแล้ว ลบไม่ได้ — ใช้ &quot;ปิดให้เช่า&quot; แทน
                </p>
              )}
            </div>
          </section>
        )}

        {/* แถบบันทึก: ติดขอบล่างจอ (ผู้จัดการเท่านั้น) */}
        {!readOnly && (
          <div className="sticky bottom-0 z-20 -mx-3 sm:-mx-4 md:mx-0 bottom-bar px-3 pt-3 pb-3 sm:px-5 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-[env(safe-area-inset-bottom)] after:bg-white">
            {msg && <MessageBox msg={msg} conflict={conflict} gone={gone} reloading={reloading} onReload={() => { void reloadLatest() }} onClose={() => showMsg(null)} />}
            <div className="flex items-center gap-2 sm:gap-3">
              <button type="submit" disabled={busy || gone} className="btn-primary flex-1 sm:flex-none sm:min-w-[13rem]">
                {saving
                  ? <><Loader2 {...ICON_SM} className="animate-spin" />กำลังบันทึก...</>
                  : finishing
                    ? <><Loader2 {...ICON_SM} className="animate-spin" />กำลังอัปโหลดรูป...</>
                    : loaded
                      ? <><Save {...ICON_SM} />บันทึกการแก้ไข</>
                      : <><Plus {...ICON_SM} />เพิ่มชุด</>}
              </button>
              <Link href="/rental/items" className="btn-secondary shrink-0 px-4">
                {dirty ? 'ยกเลิก' : 'กลับ'}
              </Link>
              {dirty && !busy && (
                <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-gray-500">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-600" />
                  มีการแก้ไขที่ยังไม่บันทึก
                </span>
              )}
            </div>
          </div>
        )}
      </form>

      {/* พนักงาน (ดูอย่างเดียว): ข้อความผลการกด "ซักแล้ว" อยู่ในรายการชิ้นแล้ว — ข้อความอื่น (ถ้ามี) แสดงตรงนี้ */}
      {readOnly && msg && (
        <MessageBox msg={msg} conflict={false} gone={gone} reloading={false} onReload={() => undefined} onClose={() => showMsg(null)} />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={`ลบชุด "${loaded?.code ?? ''} ${loaded?.name ?? ''}"?`}
        confirmLabel="ลบถาวร"
        tone="danger"
        requireAck="เข้าใจแล้ว ลบถาวร กู้คืนไม่ได้"
        busy={deleting}
        onConfirm={() => { void doDelete() }}
        onCancel={() => { if (!deleting) setConfirmDelete(false) }}
      >
        <p>ลบแบบชุด ชิ้นทั้งหมด ({loaded?.units.length ?? 0} ชิ้น) และรูปทั้งหมด ({gallery.images.length} รูป) ถาวร</p>
        <p className="text-gray-500">ลบได้เพราะชุดนี้ยังไม่เคยถูกจอง — ถ้าแค่ไม่อยากให้เช่าแล้ว ใช้ &quot;ปิดให้เช่า&quot; จะดีกว่า</p>
      </ConfirmDialog>

      {loaded && (
        <UnitTagsDialog
          open={tagsOpen}
          onClose={() => setTagsOpen(false)}
          shopName={shopName}
          groups={tagGroups}
          note={dirty ? 'ฟอร์มมีการแก้ไขที่ยังไม่บันทึก — ป้ายใช้ข้อมูลที่บันทึกแล้วเท่านั้น (ชิ้นใหม่/รหัสที่เพิ่งแก้ ต้องกดบันทึกก่อน)' : undefined}
        />
      )}
    </div>
  )
}

function MessageBox({
  msg, conflict, gone, reloading, onReload, onClose,
}: {
  msg: Msg
  conflict: boolean
  gone: boolean
  reloading: boolean
  onReload(): void
  onClose(): void
}) {
  return (
    <div className="mb-3 max-h-[40dvh] overflow-y-auto overscroll-contain">
      <div role={msg.kind === 'err' ? 'alert' : 'status'} className={ALERT_CLASS[msg.kind]}>
        <MsgIcon kind={msg.kind} />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="break-words">{msg.text}</p>
          {msg.details && msg.details.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs">
              {msg.details.map((d, i) => <li key={i} className="break-words">{d}</li>)}
            </ul>
          )}
          {conflict && (
            <button type="button" onClick={onReload} disabled={reloading} className="btn-secondary w-full sm:w-auto">
              {reloading
                ? <><Loader2 {...ICON_SM} className="animate-spin" />กำลังโหลด...</>
                : <><RefreshCw {...ICON_SM} />โหลดข้อมูลล่าสุด</>}
            </button>
          )}
          {gone && (
            <Link href="/rental/items" className="btn-secondary w-full sm:w-auto">
              <ArrowLeft {...ICON_SM} />
              กลับไปรายการชุด
            </Link>
          )}
          {msg.afterCreate && (
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              <Link href="/rental/items/new" className="btn-secondary px-4 text-sm">
                <Plus {...ICON_SM} />
                เพิ่มชุดอีก
              </Link>
              <Link href="/rental/items" className="btn-ghost px-3 text-sm">
                กลับไปรายการชุด
              </Link>
            </div>
          )}
          {msg.goToId && (
            <Link href={`/rental/items/${msg.goToId}`} className="btn-secondary w-full sm:w-auto">
              <Sparkles {...ICON_SM} />
              ไปหน้าชุดนี้
            </Link>
          )}
        </div>
        {!conflict && !gone && (
          <button type="button" onClick={onClose} className="btn-icon btn-icon-plain -my-2 -mr-2" aria-label="ปิดข้อความ">
            <X {...ICON_SM} />
          </button>
        )}
      </div>
    </div>
  )
}
