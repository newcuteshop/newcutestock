'use client'
// ===== ฟอร์มสินค้า (เพิ่ม / แก้ไข) — 1 แบบสินค้า = หลายไซส์ได้ แต่ละไซส์มี SKU ของตัวเอง + รูปไม่จำกัด =====
// บันทึกผ่าน RPC save_product_group ครั้งเดียวทั้งแบบ (CONTRACT §3.1):
// - แก้ไข: ส่ง updated_at ของข้อมูลที่โหลดมาเสมอ → เครื่องอื่นแก้ก่อน = บันทึกไม่ผ่าน ให้กด "โหลดข้อมูลล่าสุด"
// - เพิ่มใหม่: ส่ง client_id (สุ่มครั้งเดียวต่อฟอร์ม) → กดซ้ำ/เน็ตหลุดแล้วลองใหม่ ไม่สร้างสินค้าซ้ำ
// รูปสินค้า: เลือกได้ตั้งแต่ยังไม่บันทึก แล้วอัปโหลดให้ทันทีหลังบันทึกสินค้าใหม่สำเร็จ

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Coins, Info, Loader2, Lock, PauseCircle, PlayCircle, Plus,
  RefreshCw, Ruler, Save, Shirt, Trash2, X, XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { productLabel, thaiError } from '@/lib/format'
import { sameCode } from '@/lib/barcode'
import {
  type ProductGroupJson,
  MAX_DESCRIPTION, MAX_SIZES, MAX_SIZE_LEN,
  cleanText, hasInvisibleChars, isNetworkError, isPrintableCode, isVersionConflict, needsReload, newUuid,
  parseGroupJson, parseSaveResult, removeProductImageFiles, sizeKey, suggestSku, wait,
} from '@/lib/products'
import BarcodeScanner from '@/components/BarcodeScanner'
import { ICON, ICON_SM } from '@/components/theme/icons'
import {
  type FormState, type RowState, type SavePayload,
  barcodeValue, emptyForm, formFromJson, formSignature, locateServerError, matchesPayload, mergeAfterConflict,
  newRow, rebaseAfterActivation, rowForNewSize, rowFromVariant, setRowSize, sortRows, applyBaseSku,
  validateForm, withActivation,
} from '@/components/products/formModel'
import { type FieldError, SingleVariantFields } from '@/components/products/VariantFields'
import SizeEditor, { type SizeEditorActions, RemovedAndArchived } from '@/components/products/SizeEditor'
import ProductGallery from '@/components/products/ProductGallery'
import { useProductImages } from '@/components/products/useProductImages'

interface Category { id: string; name: string }

interface ProductFormProps {
  categories: Category[]
  canStock: boolean                       // มีสิทธิ์รับ-จ่ายสต๊อก → ใส่ยอดยกมาของไซส์ใหม่ได้
  initial?: ProductGroupJson | null       // null = เพิ่มสินค้าใหม่
  savedNotice?: 'new' | 'again' | null    // มาจากการบันทึกสินค้าใหม่ (หน้าเพิ่มสินค้า → หน้าแก้ไข)
}

type Msg = {
  kind: 'ok' | 'err' | 'warn' | 'info'
  text: string
  details?: string[]
  validation?: boolean   // ข้อผิดพลาดจากการตรวจในเครื่อง (หายเองเมื่อแก้ช่อง)
  afterCreate?: boolean  // แสดงลิงก์ "เพิ่มสินค้าอีก / กลับไปรายการสินค้า"
  goToId?: string        // บันทึกสินค้าใหม่แล้วแต่อัปโหลดรูปไม่ครบ → ลิงก์ไปหน้าแก้ไข
}

const ALERT_CLASS: Record<Msg['kind'], string> = {
  ok: 'alert-ok',
  err: 'alert-err',
  warn: 'alert-warn',
  info: 'alert-info',
}

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

export default function ProductForm({ categories: initialCategories, canStock, initial = null, savedNotice = null }: ProductFormProps) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  // รหัสคำขอของฟอร์มเพิ่มสินค้าใหม่: สุ่มครั้งเดียวตอนเปิดฟอร์ม ใช้ซ้ำทุกครั้งที่กดบันทึก (กันสร้างสินค้าซ้ำ)
  const [clientId] = useState(() => newUuid())
  const [categories, setCategories] = useState<Category[]>(initialCategories)
  const [loaded, setLoaded] = useState<ProductGroupJson | null>(initial)
  const [form, setForm] = useState<FormState>(() => (initial ? formFromJson(initial) : emptyForm()))
  const [toggleStash, setToggleStash] = useState<RowState[]>([])
  const [chooser, setChooser] = useState(false)
  const [rowHints, setRowHints] = useState<Record<string, string>>({})
  const [fieldError, setFieldError] = useState<FieldError>(null)
  const [focusReq, setFocusReq] = useState<{ id: string; n: number } | null>(null)
  const [scanKey, setScanKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [gone, setGone] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(() => {
    if (!initial || !savedNotice) return null
    return savedNotice === 'again'
      ? { kind: 'info', text: 'บันทึกสินค้านี้ไปแล้ว — แสดงข้อมูลที่บันทึกไว้', afterCreate: true }
      : { kind: 'ok', text: `เพิ่มสินค้า "${productLabel({ name: initial.name, color: initial.color })}" เรียบร้อย`, afterCreate: true }
  })
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const gallery = useProductImages({ groupId: loaded?.id ?? null, initialImages: initial?.images ?? [] })

  const busy = saving || toggling || deleting || reloading || finishing
  const groupActive = loaded ? loaded.is_active : true
  const baseSignature = useMemo(() => formSignature(loaded ? formFromJson(loaded) : emptyForm()), [loaded])
  const dirty = formSignature(form) !== baseSignature

  const rowIds = new Set(form.rows.map(r => r.id).filter((x): x is string => !!x))
  const pendingRemovals = loaded ? loaded.variants.filter(v => !rowIds.has(v.id)) : []
  const archived = loaded ? loaded.archived_variants.filter(v => !rowIds.has(v.id)) : []
  const allVariants = loaded ? [...loaded.variants, ...loaded.archived_variants] : []
  const canDelete = !!loaded && !loaded.has_sales && allVariants.every(v => v.stock_qty === 0)
  const categoryKnown = !form.categoryId || categories.some(c => c.id === form.categoryId)

  // ----- ข้อความแจ้งผล -----
  function showMsg(next: Msg | null, autoHideMs = 0) {
    if (msgTimer.current) clearTimeout(msgTimer.current)
    msgTimer.current = null
    setMsg(next)
    if (next && autoHideMs > 0) msgTimer.current = setTimeout(() => setMsg(m => (m === next ? null : m)), autoHideMs)
  }
  useEffect(() => () => { if (msgTimer.current) clearTimeout(msgTimer.current) }, [])

  // มาจากหน้าเพิ่มสินค้า (?saved=new) → เอาพารามิเตอร์ออกจากลิงก์ (รีเฟรชแล้วไม่ขึ้นข้อความซ้ำ)
  // ใช้ router.replace ให้ตัวนำทางของ Next รู้ลิงก์ใหม่ด้วย (ฟอร์มไม่ถูกสร้างใหม่ ข้อมูลที่พิมพ์ไม่หาย)
  const strippedRef = useRef(false)
  useEffect(() => {
    if (!savedNotice || !initial || strippedRef.current) return
    strippedRef.current = true
    router.replace(`/products/${initial.id}`, { scroll: false })
  }, [savedNotice, initial, router])

  // ปิด/รีเฟรชแท็บระหว่างมีข้อมูลที่ยังไม่บันทึก หรือรูปกำลังอัปโหลด → ถามก่อน
  const pendingNewImages = !loaded && gallery.queue.length > 0
  const guardLeave = dirty || gallery.processing || pendingNewImages || finishing
  useEffect(() => {
    if (!guardLeave) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [guardLeave])

  // เลื่อนไปที่ช่องที่ผิด + โฟกัส
  useEffect(() => {
    if (!focusReq) return
    const el = document.getElementById(focusReq.id)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    try { el.focus({ preventScroll: true }) } catch { /* ignore */ }
  }, [focusReq])

  function showFieldError(id: string, message: string) {
    setFieldError({ id, message })
    setFocusReq({ id, n: Date.now() })
  }

  // ทุกการแก้ฟอร์มผ่านตรงนี้: ข้อผิดพลาดจากการตรวจในเครื่องหายเมื่อเริ่มแก้
  function update(fn: (f: FormState) => FormState) {
    setForm(fn)
    if (fieldError) setFieldError(null)
    if (msg?.validation) showMsg(null)
  }

  function setField<K extends 'name' | 'categoryId' | 'color' | 'description'>(k: K, v: string) {
    update(f => ({ ...f, [k]: v }))
  }

  function clearHint(key: string) {
    if (rowHints[key]) setRowHints(h => { const n = { ...h }; delete n[key]; return n })
  }

  // ----- ไซส์ -----
  function changeRow(key: string, patch: Partial<RowState>) {
    update(f => ({ ...f, rows: f.rows.map(r => (r.key === key ? { ...r, ...patch } : r)) }))
    clearHint(key)
  }

  function addSize(raw: string): { ok: boolean; message: string } {
    const size = cleanText(raw)
    if (!size) return { ok: false, message: 'พิมพ์ไซส์ก่อน แล้วกดเพิ่ม' }
    if (size.length > MAX_SIZE_LEN) return { ok: false, message: `ไซส์ยาวเกินไป (สูงสุด ${MAX_SIZE_LEN} ตัวอักษร)` }
    if (hasInvisibleChars(size)) return { ok: false, message: 'ไซส์มีอักขระพิเศษที่มองไม่เห็นปนอยู่ (มักติดมาตอนก๊อปวาง) — ลบแล้วพิมพ์ใหม่' }
    const k = sizeKey(size)
    const same = form.rows.find(r => sizeKey(r.size) === k)
    if (same) {
      setFocusReq({ id: `pf-${same.key}-sku`, n: Date.now() })
      return { ok: true, message: `มีไซส์ ${cleanText(same.size)} อยู่แล้ว` }
    }
    // เพิ่งกดเอาไซส์นี้ออก → เอากลับ (ไม่เพิ่มซ้ำ)
    const removed = pendingRemovals.find(v => sizeKey(v.size) === k)
    if (removed) {
      undoRemove(removed.id)
      return { ok: true, message: `เอาไซส์ ${cleanText(removed.size)} กลับมาแล้ว` }
    }
    // เคยมีแล้วแต่เลิกใช้ → นำไซส์เดิมกลับมา (ประวัติขาย/สต๊อกอยู่ครบ)
    const arch = archived.find(v => sizeKey(v.size) === k)
    if (arch) {
      restoreArchived(arch.id)
      return { ok: true, message: `ไซส์ ${cleanText(arch.size)} เคยมีอยู่แล้ว — นำไซส์เดิมกลับมาใช้ (SKU ${arch.sku} ประวัติยังอยู่ครบ)` }
    }
    if (form.rows.length >= MAX_SIZES) return { ok: false, message: 'สินค้าหนึ่งแบบมีได้ไม่เกิน 50 ไซส์' }
    // แถวที่ยังไม่มีไซส์ (เช่น รายการเดิมตอนเพิ่งติ๊ก "มีไซส์") → ใส่ไซส์ให้แถวนั้นก่อน
    const blank = form.rows.find(r => !cleanText(r.size))
    if (blank) {
      update(f => {
        const next = setRowSize(f, blank.key, size)
        return { ...next, rows: sortRows(next.rows) }
      })
      clearHint(blank.key)
      return { ok: true, message: blank.id ? `กำหนดไซส์ ${size} ให้รายการเดิม (SKU ${cleanText(blank.sku)}) แล้ว` : '' }
    }
    update(f => ({ ...f, rows: sortRows([...f.rows, rowForNewSize(f, size)]) }))
    return { ok: true, message: '' }
  }

  function removeRow(key: string) {
    const row = form.rows.find(r => r.key === key)
    if (!row) return
    if (row.id && row.stock !== 0) {
      setRowHints(h => ({ ...h, [key]: `ยังมีสต๊อก ${row.stock} ชิ้น — ปรับยอดเป็น 0 ที่เมนูรับ-จ่ายสต๊อกก่อน หรือปิดขายเฉพาะไซส์นี้` }))
      return
    }
    // รายการเดิมที่ไม่มีไซส์และมีประวัติ (ตอนเปลี่ยนเป็นแบบมีไซส์) ต้องกำหนดไซส์ให้ เอาออกไม่ได้
    const old = row.id ? loaded?.variants.find(v => v.id === row.id) : undefined
    if (old && old.size === null && old.has_history && form.hasSizes) {
      setRowHints(h => ({ ...h, [key]: `รายการเดิม (SKU ${old.sku}) เคยขายหรือรับ-จ่ายสต๊อกแล้ว — กำหนดไซส์ให้รายการนี้แทนการเอาออก` }))
      return
    }
    update(f => ({ ...f, rows: f.rows.filter(r => r.key !== key) }))
    clearHint(key)
  }

  function undoRemove(id: string) {
    const v = loaded?.variants.find(x => x.id === id)
    if (!v || rowIds.has(id)) return
    const stashed = toggleStash.find(r => r.id === id)
    update(f => ({ ...f, rows: sortRows([...f.rows, stashed ?? rowFromVariant(v)]) }))
    if (stashed) setToggleStash(s => s.filter(r => r.id !== id))
  }

  function restoreArchived(id: string) {
    const v = loaded?.archived_variants.find(x => x.id === id)
    if (!v || rowIds.has(id) || !form.hasSizes) return
    update(f => ({ ...f, rows: sortRows([...f.rows, rowFromVariant(v, true)]) }))
  }

  const sizeActions: SizeEditorActions = {
    changeRow,
    changeSize: (key, size) => { update(f => setRowSize(f, key, size)); clearHint(key) },
    blurSize: key => {
      const row = form.rows.find(r => r.key === key)
      if (!row) return
      const c = cleanText(row.size)
      if (c !== row.size) update(f => setRowSize(f, key, c))
    },
    changeBaseSku: base => update(f => applyBaseSku(f, base)),
    addSize,
    removeRow,
    undoRemove,
    restoreArchived,
    applyAll: v => update(f => ({
      ...f,
      rows: f.rows.map(r => ({
        ...r,
        cost: v.cost.trim() ? v.cost.trim() : r.cost,
        sell: v.sell.trim() ? v.sell.trim() : r.sell,
        min: v.min.trim() ? v.min.trim() : r.min,
      })),
    })),
    scan: key => setScanKey(key),
  }

  // ----- ติ๊ก / เอาติ๊ก "สินค้านี้มีไซส์" (รายการเดิมไม่หาย: id เดิมไปต่อเสมอ) -----
  function switchToSizes() {
    update(f => {
      const kept = f.rows[0] ?? newRow()
      const base = cleanText(f.baseSku) ? f.baseSku : cleanText(kept.sku)
      let keptRow = kept
      if (kept.id === null) {
        // สินค้าใหม่: SKU ที่พิมพ์ไว้กลายเป็น SKU ตั้งต้น แล้ว SKU ของแถวนี้ = ตั้งต้น-ไซส์ เมื่อเลือกไซส์
        const auto = kept.skuAuto || cleanText(kept.sku) === cleanText(base)
        keptRow = { ...kept, skuAuto: auto, sku: auto && cleanText(kept.size) ? suggestSku(base, kept.size) : kept.sku }
      }
      const rest = toggleStash.filter(r => r.key !== kept.key)
      return { ...f, hasSizes: true, baseSku: base, rows: sortRows([keptRow, ...rest]) }
    })
    setToggleStash([])
    setChooser(false)
  }

  // รายการที่เลือกเก็บไว้ตอนเปลี่ยนเป็นไม่มีไซส์ (ไซส์อื่นที่ยังมีสต๊อก = เปลี่ยนไม่ได้)
  const chooserCandidates: RowState[] = form.rows.length > 0 ? form.rows : pendingRemovals.map(v => rowFromVariant(v))
  const stockRows = chooserCandidates.filter(r => r.id && r.stock !== 0)

  function keepAsSingle(key: string | null) {
    const candidates = chooserCandidates
    const kept = candidates.find(c => c.key === key) ?? candidates[0] ?? newRow({ sku: cleanText(form.baseSku) })
    const others = candidates.filter(c => c.key !== kept.key)
    if (others.some(o => o.id && o.stock !== 0)) return
    const base = cleanText(form.baseSku)
    const keptRow = kept.id === null && kept.skuAuto && base ? { ...kept, sku: base } : kept
    update(f => ({ ...f, hasSizes: false, rows: [keptRow] }))
    setToggleStash(others)
    setChooser(false)
  }

  function onToggleSizes(checked: boolean) {
    if (checked) { switchToSizes(); return }
    if (chooserCandidates.length <= 1) { keepAsSingle(chooserCandidates[0]?.key ?? null); return }
    setChooser(true)
  }

  // ----- สแกนบาร์โค้ดใส่แถว -----
  function handleScan(code: string) {
    if (!code) return { ok: false, message: 'อ่านบาร์โค้ดไม่ได้ ลองใหม่อีกครั้ง' }
    if (!isPrintableCode(code)) return { ok: false, message: 'บาร์โค้ดนี้มีตัวอักษรที่ใช้ไม่ได้' }
    const key = scanKey
    if (!key) return { ok: false, message: 'ไม่พบช่องบาร์โค้ด' }
    const clash = form.rows.find(r => r.key !== key && (sameCode(barcodeValue(r.barcode), code) || sameCode(cleanText(r.sku), code)))
    if (clash) {
      return { ok: false, message: form.hasSizes ? `รหัสนี้ใช้กับไซส์ ${cleanText(clash.size) || '-'} แล้ว` : 'รหัสนี้ใช้แล้ว' }
    }
    changeRow(key, { barcode: code })
    return { ok: true, message: `ได้บาร์โค้ด ${code}` }
  }

  // ----- โหลดข้อมูลจากฐานข้อมูล -----
  async function fetchGroup(id: string): Promise<ProductGroupJson | null> {
    const { data, error } = await supabase.rpc('get_product_group', { p_group_id: id })
    if (error) throw error
    if (data === null || data === undefined) return null
    const g = parseGroupJson(data)
    if (!g) throw new Error('ข้อมูลสินค้าไม่ถูกต้อง กรุณาโหลดหน้าใหม่')
    return g
  }

  function categoryName(id: string | null, list: Category[] = categories): string {
    if (!id) return 'ไม่มีหมวดหมู่'
    return list.find(c => c.id === id)?.name ?? 'หมวดหมู่ที่ถูกลบ'
  }

  // ----- บันทึก -----
  async function saveWithRetry(payload: SavePayload) {
    let lastErr: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await wait(attempt === 1 ? 800 : 2000)
      const { data, error } = await supabase.rpc('save_product_group', payload)
      if (!error) {
        const result = parseSaveResult(data)
        if (!result) throw new Error('ข้อมูลที่ได้กลับมาไม่ถูกต้อง กรุณาโหลดหน้าใหม่')
        return result
      }
      lastErr = error
      // บันทึกชน: ครั้งก่อนอาจสำเร็จแล้วแต่คำตอบหายระหว่างทาง (เน็ตหลุด/เบราว์เซอร์ส่งซ้ำเอง)
      // → ข้อมูลล่าสุดในฐานข้อมูลตรงกับที่ส่งไปทุกช่อง = ถือว่าบันทึกสำเร็จ
      if (payload.p_group.id && isVersionConflict(thaiError(error))) {
        try {
          const fresh = await fetchGroup(payload.p_group.id)
          if (fresh && matchesPayload(fresh, payload)) return { ...fresh, already_saved: false }
        } catch { /* ใช้ข้อผิดพลาดเดิม */ }
      }
      // สร้างใหม่: client_id เดิมทุกครั้ง → ลองซ้ำได้ปลอดภัย · ลองซ้ำเฉพาะตอนเน็ตหลุด
      if (!isNetworkError(error)) break
    }
    throw lastErr
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // กัน submit ที่ bubble มาจากฟอร์มอื่น (เช่น ช่องพิมพ์รหัสในหน้าต่างสแกน)
    if (e.target !== e.currentTarget) return
    if (busy || gone) return
    if (chooser) {
      showMsg({ kind: 'warn', text: 'เลือกก่อนว่าจะเก็บไซส์ไหนไว้ (หรือกด "คงแบบมีไซส์")', validation: true })
      setFocusReq({ id: 'pf-chooser', n: Date.now() })
      return
    }
    setConflict(false)
    setFieldError(null)

    const res = validateForm(form, { loaded, clientId, canStock, archived })
    if (!res.ok) {
      showFieldError(res.fieldId, res.message)
      showMsg({ kind: 'err', text: res.message, validation: true })
      return
    }
    showMsg(null)
    setSaving(true)
    const wasNew = !loaded
    let result: Awaited<ReturnType<typeof saveWithRetry>>
    try {
      result = await saveWithRetry(res.payload)
    } catch (err: unknown) {
      const text = thaiError(err)
      if (needsReload(text)) setConflict(true)
      const fid = locateServerError(text, form)
      if (fid) showFieldError(fid, text)
      showMsg({ kind: 'err', text })
      setSaving(false)
      return
    }

    // สำเร็จ: ใช้ข้อมูลที่ฐานข้อมูลคืนมาทั้งหมด (updated_at ใหม่, id ของไซส์ใหม่, ค่าที่ทำความสะอาดแล้ว)
    setLoaded(result)
    setForm(formFromJson(result))
    setToggleStash([])
    setChooser(false)
    setRowHints({})
    setSaving(false)

    if (!wasNew) {
      showMsg({ kind: 'ok', text: 'บันทึกการแก้ไขเรียบร้อย' }, 5000)
      router.refresh()
      return
    }

    // สินค้าใหม่: อัปโหลดรูปที่เลือกรอไว้ก่อน แล้วค่อยไปหน้าแก้ไขสินค้านี้
    // already_saved = ครั้งก่อนบันทึกไปแล้ว (คำตอบหาย) — ถ้าข้อมูลที่บันทึกไว้ตรงกับที่เพิ่งส่งทุกช่อง ถือเป็นการบันทึกปกติ
    const again = result.already_saved && !matchesPayload(result, res.payload)
    setFinishing(true)
    if (gallery.queue.length > 0) {
      showMsg({ kind: 'info', text: 'บันทึกสินค้าแล้ว — กำลังอัปโหลดรูป อย่าเพิ่งปิดหน้านี้' })
    }
    // เรียกเสมอ (รูปที่เลือกเพิ่มระหว่างรอบันทึกก็อัปโหลดด้วย) — ไม่มีรูปรอ = จบทันที
    const failed = (await gallery.uploadPending(result.id)).failed
    if (failed > 0) {
      setFinishing(false)
      showMsg({
        kind: 'warn',
        text: `บันทึกสินค้าแล้ว แต่อัปโหลดรูปไม่สำเร็จ ${failed} รูป — กด "ลองอัปโหลดใหม่" ที่รูปนั้น หรือเพิ่มรูปภายหลังในหน้าแก้ไขสินค้า`,
        goToId: result.id,
      })
      router.refresh()
      return
    }
    router.replace(`/products/${result.id}?saved=${again ? 'again' : 'new'}`)
    router.refresh()
  }

  // ----- บันทึกชนกับเครื่องอื่น: โหลดข้อมูลล่าสุด แล้วรวมกับที่ผู้ใช้พิมพ์ไว้ -----
  async function reloadLatest() {
    if (reloading) return
    setReloading(true)
    try {
      let cats = categories
      const catRes = await supabase.from('categories').select('id, name').order('name')
      if (!catRes.error && Array.isArray(catRes.data)) {
        cats = catRes.data as Category[]
        setCategories(cats)
      }
      if (!loaded) {
        const lost = !!form.categoryId && !cats.some(c => c.id === form.categoryId)
        if (lost) update(f => ({ ...f, categoryId: '' }))
        setConflict(false)
        showMsg({
          kind: 'info',
          text: lost ? 'หมวดหมู่ที่เลือกไว้ถูกลบแล้ว — เลือกหมวดหมู่ใหม่แล้วกดบันทึกอีกครั้ง' : 'โหลดหมวดหมู่ล่าสุดแล้ว — ตรวจสอบแล้วกดบันทึกอีกครั้ง',
        })
        return
      }
      const fresh = await fetchGroup(loaded.id)
      if (!fresh) {
        setGone(true)
        setConflict(false)
        showMsg({ kind: 'err', text: 'สินค้านี้ถูกลบไปแล้วจากเครื่องอื่น' })
        return
      }
      const { form: merged, changes } = mergeAfterConflict(loaded, fresh, form, { categoryName: id => categoryName(id, cats) })
      if (merged.categoryId && !cats.some(c => c.id === merged.categoryId)) {
        merged.categoryId = ''
        changes.push('หมวดหมู่ที่เลือกไว้ถูกลบแล้ว — เปลี่ยนเป็นไม่มีหมวดหมู่ (เลือกใหม่ได้)')
      }
      setLoaded(fresh)
      setForm(merged)
      setToggleStash([])
      setChooser(false)
      setRowHints({})
      setFieldError(null)
      gallery.replaceImages(fresh.images)
      setConflict(false)
      showMsg({
        kind: 'warn',
        text: 'โหลดข้อมูลล่าสุดแล้ว — ตรวจสอบแล้วกดบันทึกอีกครั้ง (สิ่งที่คุณแก้ไว้ยังอยู่ในฟอร์ม)',
        details: changes.length > 0 ? changes.slice(0, 15) : ['ไม่พบความแตกต่างของข้อมูลสินค้า'],
      })
    } catch (e: unknown) {
      showMsg({ kind: 'err', text: thaiError(e) })
    } finally {
      setReloading(false)
    }
  }

  // ----- เปิดขาย / ปิดใช้งานทั้งสินค้า -----
  async function toggleActive() {
    if (!loaded || busy || gone) return
    const next = !loaded.is_active
    setToggling(true)
    showMsg(null)
    try {
      const { data, error } = await supabase.rpc('set_product_group_active', { p_group_id: loaded.id, p_active: next })
      if (error) throw error
      const fresh = parseGroupJson(data)
      if (!fresh) throw new Error('ข้อมูลที่ได้กลับมาไม่ถูกต้อง กรุณาโหลดหน้าใหม่')
      // เวอร์ชันใหม่ (updated_at) ต้องเข้าฟอร์มทันที ไม่งั้นบันทึกครั้งถัดไปจะถูกปฏิเสธ
      // + ถ้าระหว่างนี้เครื่องอื่นแก้อย่างอื่นด้วย ให้รวมเข้าฟอร์มแล้วบอกผู้ใช้
      const { form: merged, changes } = mergeAfterConflict(
        withActivation(loaded, fresh), fresh, rebaseAfterActivation(form, fresh), { categoryName: id => categoryName(id) },
      )
      setLoaded(fresh)
      setForm(merged)
      gallery.replaceImages(fresh.images)
      const text = next ? 'เปิดขายสินค้านี้แล้ว (ทุกไซส์ที่ยังใช้อยู่)' : 'ปิดใช้งานสินค้านี้แล้ว — ไม่แสดงในหน้าขาย ประวัติยังอยู่ครบ'
      if (changes.length > 0) {
        showMsg({ kind: 'warn', text: `${text} · ระหว่างนี้มีการแก้ไขจากเครื่องอื่น ตรวจสอบก่อนบันทึก`, details: changes.slice(0, 15) })
      } else {
        showMsg({ kind: 'ok', text }, 5000)
      }
      router.refresh()
    } catch (e: unknown) {
      showMsg({ kind: 'err', text: thaiError(e) })
    } finally {
      setToggling(false)
    }
  }

  // ----- ลบทั้งสินค้า (เฉพาะที่ไม่เคยขายและไม่มีสต๊อกเหลือ) -----
  async function handleDelete() {
    if (!loaded || busy || !canDelete) return
    const label = productLabel({ name: loaded.name, color: loaded.color })
    const skuCount = allVariants.length
    const imgCount = gallery.images.length
    if (!confirm(
      `ยืนยันลบสินค้า "${label}"?\n\n` +
      `* ลบทุกไซส์ (${skuCount} SKU) และรูปทั้งหมด (${imgCount} รูป) ถาวร กู้คืนไม่ได้\n` +
      '* ลบได้เพราะยังไม่เคยขายและไม่มีสต๊อกเหลือ',
    )) return
    setDeleting(true)
    showMsg(null)
    try {
      const { data, error } = await supabase.rpc('delete_product_group', { p_group_id: loaded.id })
      if (error) throw error
      const raw = data && typeof data === 'object' ? (data as { image_paths?: unknown }).image_paths : null
      const paths = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : []
      // ลบไฟล์รูปหลังลบข้อมูลสำเร็จ (ไม่สำเร็จก็แค่มีไฟล์ค้าง)
      void removeProductImageFiles(supabase, paths)
      router.push('/products')
      router.refresh()
    } catch (e: unknown) {
      showMsg({ kind: 'err', text: thaiError(e) })
      setDeleting(false)
    }
  }

  const title = loaded ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่'
  const subtitle = loaded
    ? productLabel({ name: loaded.name, color: loaded.color })
    : 'กรอกข้อมูลสินค้า เพิ่มรูป และกำหนดไซส์'
  const single = form.rows[0]

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <Link href="/products" className="link text-sm">
            <ArrowLeft {...ICON_SM} />
            กลับไปรายการสินค้า
          </Link>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle break-words">{subtitle}</p>
        </div>
        {loaded && !groupActive && (
          <div className="page-actions">
            <span className="chip-outline">
              <PauseCircle size={14} strokeWidth={2} aria-hidden="true" />
              ปิดใช้งานอยู่
            </span>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4 sm:space-y-6">
        <div className="grid gap-4 sm:gap-6 lg:grid-cols-2 lg:items-start">
          {/* ระหว่างบันทึก/ก่อนพาไปหน้าแก้ไข ห้ามเลือกรูปเพิ่ม (กันรูปที่เลือกช่วงรอยต่อหายไปตอนเปลี่ยนหน้า) */}
          <ProductGallery
            api={gallery}
            groupId={loaded?.id ?? null}
            productName={form.name}
            disabled={deleting || gone || saving || finishing}
          />

          {/* ข้อมูลสินค้า */}
          <section className="card p-4 sm:p-5 space-y-4 min-w-0" aria-labelledby="pf-sec-info">
            <h2 id="pf-sec-info" className="section-title">
              <Shirt {...ICON} />
              ข้อมูลสินค้า
            </h2>
            <div>
              <label htmlFor="pf-name" className="field-label">ชื่อสินค้า *</label>
              <input
                id="pf-name" className="input" maxLength={220} value={form.name} disabled={busy || gone}
                autoComplete="off" enterKeyHint="next"
                placeholder="เช่น เสื้อยืดคอกลม ลายดอกไม้"
                onChange={e => setField('name', e.target.value)}
                aria-invalid={fieldError?.id === 'pf-name' ? true : undefined}
                aria-describedby={fieldError?.id === 'pf-name' ? 'pf-name-err' : undefined}
              />
              {fieldError?.id === 'pf-name' && <p id="pf-name-err" className="field-hint font-medium text-red-700">{fieldError.message}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor="pf-category" className="field-label">หมวดหมู่</label>
                <select
                  id="pf-category" className="input" value={form.categoryId} disabled={busy || gone}
                  onChange={e => setField('categoryId', e.target.value)}
                  aria-invalid={fieldError?.id === 'pf-category' ? true : undefined}
                >
                  <option value="">-- ไม่มีหมวดหมู่ --</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  {!categoryKnown && <option value={form.categoryId}>(หมวดหมู่ที่ถูกลบแล้ว)</option>}
                </select>
                <p className="field-hint">เพิ่ม/แก้ชื่อหมวดหมู่ได้ที่หน้ารายการสินค้า</p>
              </div>
              <div className="min-w-0">
                <label htmlFor="pf-color" className="field-label">สี</label>
                <input
                  id="pf-color" className="input" maxLength={120} value={form.color} autoComplete="off" disabled={busy || gone}
                  placeholder="ขาว, ดำ, ชมพู..."
                  onChange={e => setField('color', e.target.value)}
                  aria-invalid={fieldError?.id === 'pf-color' ? true : undefined}
                />
                <p className="field-hint">คนละสี = เพิ่มเป็นสินค้าใหม่อีกการ์ด</p>
              </div>
            </div>
            <div>
              <label htmlFor="pf-desc" className="field-label">รายละเอียด (ไม่บังคับ)</label>
              <textarea
                id="pf-desc" className="input" rows={3} maxLength={MAX_DESCRIPTION + 50} value={form.description} disabled={busy || gone}
                placeholder="เนื้อผ้า ขนาดอก/ยาว วิธีดูแล ฯลฯ"
                onChange={e => setField('description', e.target.value)}
                aria-invalid={fieldError?.id === 'pf-desc' ? true : undefined}
              />
              <p className={`field-hint text-right tabular-nums ${form.description.length > MAX_DESCRIPTION ? 'text-red-700 font-medium' : 'text-gray-500'}`}>
                {form.description.length.toLocaleString('th-TH')}/{MAX_DESCRIPTION.toLocaleString('th-TH')}
              </p>
            </div>
          </section>
        </div>

        {/* ไซส์ ราคา สต๊อก */}
        <section className="card p-4 sm:p-5 space-y-4 min-w-0" aria-labelledby="pf-sec-price">
          <h2 id="pf-sec-price" className="section-title">
            {form.hasSizes ? <Ruler {...ICON} /> : <Coins {...ICON} />}
            {form.hasSizes ? 'ไซส์ ราคา และสต๊อก' : 'ราคาและสต๊อก'}
          </h2>

          <label htmlFor="pf-has-sizes" className="panel flex min-h-[52px] cursor-pointer items-start gap-3 px-3.5 py-3">
            <input
              id="pf-has-sizes"
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
              checked={form.hasSizes || chooser}
              disabled={busy}
              onChange={e => onToggleSizes(e.target.checked)}
            />
            <span className="min-w-0">
              <span className="block font-semibold text-gray-900">สินค้านี้มีไซส์</span>
              <span className="block text-xs text-gray-500">
                ติ๊กเมื่อมีหลายไซส์ (S, M, L …) — แต่ละไซส์มี SKU ราคา และสต๊อกแยกกัน · ไม่ติ๊ก = SKU และราคาชุดเดียว
              </span>
            </span>
          </label>
          {fieldError?.id === 'pf-has-sizes' && <p className="-mt-2 text-xs leading-relaxed font-medium text-red-700">{fieldError.message}</p>}

          {/* เปลี่ยนเป็นไม่มีไซส์: เลือกว่าจะเก็บรายการไหนไว้ */}
          {chooser && (
            <div id="pf-chooser" tabIndex={-1} className="alert-warn flex-col items-stretch gap-3" role="group" aria-labelledby="pf-chooser-title">
              <div>
                <p id="pf-chooser-title" className="font-semibold">เปลี่ยนเป็นสินค้าไม่มีไซส์: เลือกไซส์ที่จะใช้ต่อ</p>
                <p className="text-xs">
                  ไซส์ที่เลือกจะกลายเป็นสินค้าชิ้นเดียว (SKU เดิม) · ไซส์อื่นที่ยังไม่มีประวัติจะถูกลบ ส่วนที่มีประวัติจะเก็บไว้ใน &quot;ไซส์ที่เลิกใช้&quot;
                </p>
              </div>
              {stockRows.length > 1 ? (
                <p className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-medium">
                  ไซส์ {stockRows.map(r => cleanText(r.size) || '-').join(', ')} ยังมีสต๊อก — เปลี่ยนเป็นไม่มีไซส์ได้เมื่อเหลือสต๊อกไม่เกิน 1 ไซส์ (ปรับยอดที่เมนูรับ-จ่ายสต๊อกก่อน)
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {chooserCandidates.map(c => {
                    const allowed = stockRows.length === 0 || stockRows[0].key === c.key
                    return (
                      <button
                        key={c.key}
                        type="button"
                        className="btn-secondary px-4"
                        disabled={!allowed || busy}
                        onClick={() => keepAsSingle(c.key)}
                      >
                        <span className="font-semibold">{cleanText(c.size) || '-'}</span>
                        <span className="font-mono text-xs">{cleanText(c.sku) || 'ไม่มี SKU'}</span>
                        {c.id && c.stock !== 0 && <span className="text-xs">(สต๊อก {c.stock})</span>}
                      </button>
                    )
                  })}
                </div>
              )}
              <button type="button" className="btn-ghost self-start px-4" onClick={() => setChooser(false)}>
                คงแบบมีไซส์
              </button>
            </div>
          )}

          {form.hasSizes ? (
            <SizeEditor
              form={form}
              canStock={canStock}
              groupActive={groupActive}
              disabled={busy || gone}
              fieldError={fieldError}
              rowHints={rowHints}
              actions={sizeActions}
            />
          ) : single ? (
            <SingleVariantFields
              row={single}
              isNew={single.id === null}
              canStock={canStock}
              disabled={busy || gone}
              fieldError={fieldError}
              onChange={patch => changeRow(single.key, patch)}
              onScan={() => setScanKey(single.key)}
            />
          ) : null}

          {!canStock && form.rows.some(r => r.id === null) && (
            <div className="alert-info">
              <Info {...ICON_SM} />
              <p className="min-w-0">สต๊อกเริ่มต้นของ{form.hasSizes ? 'ไซส์ใหม่' : 'สินค้าใหม่'}เป็น 0 — ผู้มีสิทธิ์รับ-จ่ายสต๊อกรับสินค้าเข้าได้ที่หน้า รับ-จ่ายสต๊อก</p>
            </div>
          )}

          <RemovedAndArchived
            hasSizes={form.hasSizes}
            disabled={busy || gone}
            pendingRemovals={pendingRemovals}
            archived={archived}
            onUndo={undoRemove}
            onRestore={restoreArchived}
          />
        </section>

        {/* สถานะการขาย + ลบ (เฉพาะสินค้าที่บันทึกแล้ว) */}
        {loaded && (
          <section className="card p-4 sm:p-5 space-y-3 min-w-0" aria-labelledby="pf-sec-status">
            <h2 id="pf-sec-status" className="section-title">
              {/* เปิดขาย = ไอคอนเขียว / ปิดใช้งาน = ไอคอนเทา (ชนะสีโรสโกลด์อัตโนมัติของ .section-title) */}
              {groupActive ? <PlayCircle {...ICON} className="!text-green-700" /> : <PauseCircle {...ICON} className="!text-gray-500" />}
              สถานะการขาย
            </h2>
            <p className="text-sm text-gray-600">
              {groupActive
                ? `เปิดขายอยู่ — ขายได้ที่หน้าบันทึกการขาย${form.hasSizes ? ' (ปิดขายรายไซส์ได้ที่ตารางไซส์)' : ''}`
                : 'ปิดใช้งานอยู่ — ไม่แสดงในหน้าขาย ประวัติการขายและสต๊อกยังอยู่ครบ'}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button type="button" onClick={toggleActive} disabled={busy || gone} className="btn-secondary w-full sm:w-auto">
                {toggling
                  ? <><Loader2 {...ICON_SM} className="animate-spin" />กำลังบันทึก...</>
                  : groupActive
                    ? <><PauseCircle {...ICON_SM} />ปิดใช้งานสินค้านี้</>
                    : <><PlayCircle {...ICON_SM} />เปิดขายสินค้านี้</>}
              </button>
              {canDelete ? (
                <button type="button" onClick={handleDelete} disabled={busy || gone} className="btn-danger-soft w-full sm:w-auto sm:ml-auto">
                  {deleting
                    ? <><Loader2 {...ICON_SM} className="animate-spin" />กำลังลบ...</>
                    : <><Trash2 {...ICON_SM} />ลบสินค้านี้</>}
                </button>
              ) : (
                <p className="flex items-center gap-1.5 text-xs text-gray-500 sm:ml-auto">
                  <Lock size={14} strokeWidth={2} aria-hidden="true" />
                  {loaded.has_sales ? 'เคยขายแล้ว ลบไม่ได้' : 'ยังมีสต๊อก ลบไม่ได้'} — ใช้ &quot;ปิดใช้งาน&quot; แทน
                </p>
              )}
            </div>
          </section>
        )}

        {/* แถบบันทึก: ติดขอบล่างจอ กดบันทึกได้ตลอดไม่ต้องเลื่อนหา */}
        <div className="sticky bottom-0 z-20 -mx-3 sm:-mx-4 md:mx-0 bottom-bar px-3 pt-3 pb-3 sm:px-5 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-[env(safe-area-inset-bottom)] after:bg-white">
          {msg && (
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
                    <button type="button" onClick={reloadLatest} disabled={reloading} className="btn-secondary w-full sm:w-auto">
                      {reloading
                        ? <><Loader2 {...ICON_SM} className="animate-spin" />กำลังโหลด...</>
                        : <><RefreshCw {...ICON_SM} />โหลดข้อมูลล่าสุด</>}
                    </button>
                  )}
                  {gone && (
                    <Link href="/products" className="btn-secondary w-full sm:w-auto">
                      <ArrowLeft {...ICON_SM} />
                      กลับไปรายการสินค้า
                    </Link>
                  )}
                  {msg.afterCreate && (
                    <div className="flex flex-wrap gap-x-2 gap-y-1">
                      <Link href="/products/new" className="btn-secondary px-4 text-sm">
                        <Plus {...ICON_SM} />
                        เพิ่มสินค้าอีก
                      </Link>
                      <Link href="/products" className="btn-ghost px-3 text-sm">
                        กลับไปรายการสินค้า
                      </Link>
                    </div>
                  )}
                  {msg.goToId && (
                    <Link href={`/products/${msg.goToId}`} className="btn-secondary w-full sm:w-auto">
                      ไปหน้าแก้ไขสินค้านี้
                    </Link>
                  )}
                </div>
                {!conflict && !gone && (
                  <button type="button" onClick={() => showMsg(null)} className="btn-icon btn-icon-plain -my-2 -mr-2" aria-label="ปิดข้อความ">
                    <X {...ICON_SM} />
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 sm:gap-3">
            <button type="submit" disabled={busy || gone} className="btn-primary flex-1 sm:flex-none sm:min-w-[13rem]">
              {saving
                ? <><Loader2 {...ICON_SM} className="animate-spin" />กำลังบันทึก...</>
                : finishing
                  ? <><Loader2 {...ICON_SM} className="animate-spin" />กำลังอัปโหลดรูป...</>
                  : loaded
                    ? <><Save {...ICON_SM} />บันทึกการแก้ไข</>
                    : <><Plus {...ICON_SM} />เพิ่มสินค้า</>}
            </button>
            <Link href="/products" className="btn-secondary shrink-0 px-4">
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
      </form>

      {/* อยู่นอก <form> — หน้าต่างสแกนมีฟอร์มของตัวเอง ห้ามซ้อนกัน */}
      {scanKey && (
        <BarcodeScanner
          title="สแกนบาร์โค้ดสินค้า"
          onScan={handleScan}
          onClose={() => setScanKey(null)}
          closeOnSuccess
        />
      )}
    </div>
  )
}
