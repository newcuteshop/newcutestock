'use client'
// จัดการหมวดชุดเช่า: เพิ่ม / เปลี่ยนชื่อ / เรียงลำดับ / ซ่อน-แสดง / ลบ
// เขียนผ่าน rental_save_category(p_id, p_name, p_sort, p_active) และ rental_delete_category(p_id) เท่านั้น (เฉพาะผู้จัดการร้านเช่า)
// ลบหมวดแล้ว ชุดในหมวดนั้นไม่ถูกลบ — กลายเป็น "ไม่มีหมวด" (ฐานข้อมูลบอกจำนวนกลับมา)
// ซ่อนหมวด = ไม่แสดงเป็นตัวเลือกบนหน้าจองออนไลน์/ตัวกรอง แต่ชุดในหมวดยังให้เช่าได้ตามปกติ
// ทำได้ทีละรายการ (กันกดซ้ำ/สลับลำดับพร้อมกันจนลำดับเพี้ยน) ; ผิดพลาดกลางทาง → โหลดรายการจากฐานข้อมูลใหม่
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import clsx from 'clsx'
import {
  AlertCircle, ArrowDown, ArrowUp, Check, Eye, EyeOff, Loader2, Pencil, Plus, Tags, Trash2, X,
} from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { parseRentalCategories, parseRentalCategory, type RentalCategory } from '@/lib/rental'
import ConfirmDialog from '@/components/integrations/ConfirmDialog'
import { rentalErrorText } from '@/components/rental/money/moneyRows'

const MAX_NAME = 60

function sortCategories(list: RentalCategory[]): RentalCategory[] {
  return list.slice().sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'th'))
}

function cleanName(v: string): string {
  return v.replace(/^\s+|\s+$/g, '')
}

export default function CategoriesManager({
  initial,
  onMessage,
}: {
  initial: RentalCategory[]
  /** ข้อความสำเร็จ (โทสต์ของหน้า) */
  onMessage: (text: string) => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [list, setList] = useState<RentalCategory[]>(() => sortCategories(initial))
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null) // 'new' = กำลังเพิ่ม
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<RentalCategory | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId) editInputRef.current?.focus()
  }, [editingId])

  // โหลดรายการจากฐานข้อมูลใหม่ (หลังผิดพลาดกลางทาง ให้จอตรงกับข้อมูลจริง)
  const reload = useCallback(async () => {
    try {
      const { data, error: qError } = await supabase
        .from('rental_categories')
        .select('id, name, sort_order, is_active, created_at')
        .order('sort_order')
        .order('name')
      if (!qError) setList(sortCategories(parseRentalCategories(data)))
    } catch {
      // อ่านไม่ได้ (เน็ตหลุด) — คงรายการบนจอไว้ ข้อความ error แสดงอยู่แล้ว
    }
  }, [supabase])

  async function save(cat: { id: string | null; name: string; sort: number; active: boolean }): Promise<RentalCategory | null> {
    const { data, error: rpcError } = await supabase.rpc('rental_save_category', {
      p_id: cat.id,
      p_name: cat.name,
      p_sort: cat.sort,
      p_active: cat.active,
    })
    if (rpcError) throw rpcError
    return parseRentalCategory(data)
  }

  async function run(id: string, task: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusyId(id)
    setError('')
    try {
      await task()
    } catch (err) {
      setError(rentalErrorText(err))
      void reload()
    } finally {
      busyRef.current = false
      setBusyId(null)
    }
  }

  function handleAdd(e: FormEvent) {
    e.preventDefault()
    const name = cleanName(newName)
    if (!name) {
      setError('กรุณาใส่ชื่อหมวด')
      return
    }
    if (name.length > MAX_NAME) {
      setError(`ชื่อหมวดยาวเกินไป (สูงสุด ${MAX_NAME} ตัวอักษร)`)
      return
    }
    if (list.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      setError(`มีหมวดชื่อ "${name}" อยู่แล้ว`)
      return
    }
    const sort = list.length > 0 ? Math.max(...list.map(c => c.sort_order)) + 10 : 10
    void run('new', async () => {
      const saved = await save({ id: null, name, sort, active: true })
      if (saved) setList(prev => sortCategories([...prev.filter(c => c.id !== saved.id), saved]))
      else await reload()
      setNewName('')
      onMessage(`เพิ่มหมวด "${name}" แล้ว`)
    })
  }

  function startEdit(c: RentalCategory) {
    setEditingId(c.id)
    setEditName(c.name)
    setError('')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditName('')
  }

  function commitEdit(c: RentalCategory) {
    const name = cleanName(editName)
    if (!name) {
      setError('กรุณาใส่ชื่อหมวด')
      return
    }
    if (name.length > MAX_NAME) {
      setError(`ชื่อหมวดยาวเกินไป (สูงสุด ${MAX_NAME} ตัวอักษร)`)
      return
    }
    if (name === c.name) {
      cancelEdit()
      return
    }
    void run(c.id, async () => {
      const saved = await save({ id: c.id, name, sort: c.sort_order, active: c.is_active })
      setList(prev => sortCategories(prev.map(x => (x.id === c.id ? saved ?? { ...x, name } : x))))
      cancelEdit()
      onMessage(`เปลี่ยนชื่อหมวดเป็น "${name}" แล้ว`)
    })
  }

  function toggleActive(c: RentalCategory) {
    void run(c.id, async () => {
      const saved = await save({ id: c.id, name: c.name, sort: c.sort_order, active: !c.is_active })
      setList(prev => sortCategories(prev.map(x => (x.id === c.id ? saved ?? { ...x, is_active: !c.is_active } : x))))
      onMessage(c.is_active ? `ซ่อนหมวด "${c.name}" แล้ว` : `แสดงหมวด "${c.name}" แล้ว`)
    })
  }

  // สลับลำดับ: เรียงเลขลำดับใหม่ทั้งรายการ (10, 20, 30, ...) แล้วบันทึกเฉพาะหมวดที่เลขเปลี่ยน
  // (หมวดเก่าอาจมีเลขลำดับซ้ำกัน เช่น 0 ทั้งหมด — สลับแค่ 2 ตัวจะไม่เปลี่ยนอะไร)
  function move(index: number, delta: number) {
    const to = index + delta
    if (to < 0 || to >= list.length) return
    const order = list.slice()
    const [item] = order.splice(index, 1)
    order.splice(to, 0, item)
    const target = order.map((c, i) => ({ ...c, sort_order: (i + 1) * 10 }))
    const changed = target.filter(c => list.find(x => x.id === c.id)?.sort_order !== c.sort_order)
    void run(item.id, async () => {
      for (const c of changed) {
        await save({ id: c.id, name: c.name, sort: c.sort_order, active: c.is_active })
      }
      setList(target)
    })
  }

  function confirmDelete() {
    const c = deleteTarget
    if (!c) return
    void run(c.id, async () => {
      const { data, error: rpcError } = await supabase.rpc('rental_delete_category', { p_id: c.id })
      if (rpcError) throw rpcError
      const items = data && typeof data === 'object' ? Number((data as { items_uncategorized?: unknown }).items_uncategorized) || 0 : 0
      setList(prev => prev.filter(x => x.id !== c.id))
      setDeleteTarget(null)
      onMessage(items > 0 ? `ลบหมวด "${c.name}" แล้ว — ชุด ${items.toLocaleString('en-US')} แบบกลายเป็นไม่มีหมวด` : `ลบหมวด "${c.name}" แล้ว`)
    })
  }

  const busy = busyId !== null

  return (
    <section id="rs-categories" className="card scroll-mt-4 min-w-0" aria-labelledby="rs-categories-title">
      <div className="card-header flex-wrap gap-2">
        <h2 id="rs-categories-title" className="section-title">
          <Tags {...ICON} />
          หมวดชุด
        </h2>
        <span className="chip tabular-nums">{list.length.toLocaleString('en-US')} หมวด</span>
      </div>
      <div className="space-y-4 p-4 sm:p-5">
        <form onSubmit={handleAdd} className="flex items-start gap-2" noValidate>
          <div className="min-w-0 flex-1">
            <label htmlFor="rs-cat-new" className="sr-only">ชื่อหมวดใหม่</label>
            <input
              id="rs-cat-new"
              className="input"
              maxLength={MAX_NAME}
              autoComplete="off"
              placeholder="ชื่อหมวดใหม่ เช่น ชุดไทย / ชุดราตรี / สูท"
              value={newName}
              disabled={busy}
              onChange={e => { setNewName(e.target.value); setError('') }}
            />
          </div>
          <button type="submit" disabled={busy || cleanName(newName) === ''} className="btn-primary shrink-0 px-4">
            {busyId === 'new' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Plus {...ICON_SM} />}
            เพิ่ม
          </button>
        </form>

        <div aria-live="polite">
          {error && (
            <div role="alert" className="alert-err">
              <AlertCircle {...ICON_SM} />
              <p className="min-w-0 break-words">{error}</p>
            </div>
          )}
        </div>

        {list.length === 0 ? (
          <p className="panel p-3 text-sm text-gray-500">ยังไม่มีหมวด — หมวดช่วยให้ลูกค้าเลือกชุดบนหน้าจองออนไลน์ได้ง่ายขึ้น</p>
        ) : (
          <ul className="divide-y divide-gray-150 rounded-lg border border-gray-200" aria-label="รายการหมวด">
            {list.map((c, i) => (
              <li key={c.id} className={clsx('flex flex-wrap items-center gap-2 px-3 py-2', !c.is_active && 'bg-gray-50')}>
                {editingId === c.id ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-2"
                    onSubmit={e => { e.preventDefault(); commitEdit(c) }}
                    noValidate
                  >
                    <label htmlFor={`rs-cat-edit-${c.id}`} className="sr-only">ชื่อหมวด</label>
                    <input
                      ref={editInputRef}
                      id={`rs-cat-edit-${c.id}`}
                      className="input min-w-0 flex-1"
                      maxLength={MAX_NAME}
                      autoComplete="off"
                      value={editName}
                      disabled={busy}
                      onChange={e => { setEditName(e.target.value); setError('') }}
                      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); cancelEdit() } }}
                    />
                    <button type="submit" disabled={busy} className="btn-icon" aria-label="บันทึกชื่อหมวด">
                      {busyId === c.id ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Check {...ICON_SM} />}
                    </button>
                    <button type="button" onClick={cancelEdit} disabled={busy} className="btn-icon btn-icon-plain" aria-label="ยกเลิกการแก้ชื่อ">
                      <X {...ICON_SM} />
                    </button>
                  </form>
                ) : (
                  <>
                    {/* ชื่อกว้างอย่างน้อย 10rem — จอแคบ ปุ่มจัดการขึ้นบรรทัดใหม่ชิดขวา (ชื่อไม่ถูกบีบจนอ่านไม่ออก) */}
                    <div className="min-w-[10rem] flex-1">
                      <p className={clsx('text-sm font-medium break-words', c.is_active ? 'text-gray-900' : 'text-gray-500')}>{c.name}</p>
                      {!c.is_active && <p className="text-xs text-gray-500">ซ่อนอยู่ — ไม่แสดงบนหน้าจองออนไลน์</p>}
                    </div>
                    <div className="ml-auto flex shrink-0 items-center">
                      {busyId === c.id && <Loader2 {...ICON_SM} className="mr-1 animate-spin text-gray-500" aria-hidden="true" />}
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={busy || i === 0}
                        className="btn-icon btn-icon-plain"
                        aria-label={`เลื่อนหมวด ${c.name} ขึ้น`}
                      >
                        <ArrowUp {...ICON_SM} />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={busy || i === list.length - 1}
                        className="btn-icon btn-icon-plain"
                        aria-label={`เลื่อนหมวด ${c.name} ลง`}
                      >
                        <ArrowDown {...ICON_SM} />
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(c)}
                        disabled={busy}
                        className="btn-icon btn-icon-plain"
                        aria-label={`เปลี่ยนชื่อหมวด ${c.name}`}
                      >
                        <Pencil {...ICON_SM} />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleActive(c)}
                        disabled={busy}
                        className="btn-icon btn-icon-plain"
                        aria-label={c.is_active ? `ซ่อนหมวด ${c.name}` : `แสดงหมวด ${c.name}`}
                        aria-pressed={!c.is_active}
                        title={c.is_active ? 'ซ่อนหมวด' : 'แสดงหมวด'}
                      >
                        {c.is_active ? <Eye {...ICON_SM} /> : <EyeOff {...ICON_SM} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setError(''); setDeleteTarget(c) }}
                        disabled={busy}
                        className="btn-icon btn-icon-danger"
                        aria-label={`ลบหมวด ${c.name}`}
                      >
                        <Trash2 {...ICON_SM} />
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="field-hint">ลำดับนี้ใช้เรียงหมวดบนหน้าจองออนไลน์และตัวกรองในหน้าชุดเช่า</p>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`ลบหมวด "${deleteTarget?.name ?? ''}"`}
        confirmLabel="ลบหมวด"
        tone="danger"
        busy={busyId !== null && busyId === deleteTarget?.id}
        onConfirm={confirmDelete}
        onCancel={() => { if (!busyRef.current) setDeleteTarget(null) }}
      >
        <p>ชุดที่อยู่ในหมวดนี้จะไม่ถูกลบ แต่จะกลายเป็น &quot;ไม่มีหมวด&quot; — ถ้าแค่ไม่อยากให้ลูกค้าเห็นหมวดนี้ ใช้ปุ่มซ่อนแทนได้</p>
      </ConfirmDialog>
    </section>
  )
}
