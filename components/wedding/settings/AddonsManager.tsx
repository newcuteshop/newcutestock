'use client'
// บริการเสริม (เฉพาะผู้จัดการ): รายการ + เพิ่ม/แก้ (ป็อปอัป) / เรียงลำดับ / ปิด-เปิดใช้ / ลบ
// เขียนผ่าน wed_save_addon และ wed_delete_addon เท่านั้น · อ่านจากตาราง wed_addons
// ลบรายการที่เคยใช้ในงานแล้ว = ฐานข้อมูลปิดใช้งานแทน (งานเดิมจำชื่อ/ราคาไว้เอง) · ทำได้ทีละรายการ ผิดพลาด → โหลดใหม่
import { useCallback, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { AlertCircle, ArrowDown, ArrowUp, Eye, EyeOff, Loader2, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { baht } from '@/lib/format'
import { parseSoftDeleteResult, parseWedAddon, parseWedAddons, type WedAddon } from '@/lib/wedding'
import ConfirmDialog from '@/components/integrations/ConfirmDialog'
import AddonEditorDialog, { type AddonDraft } from './AddonEditorDialog'
import { ADDON_COLUMNS, nextSortOrder } from './packageForm'
import { callRpc, isGoneText, wedErrorText } from './wedRpc'


function sortAddons(list: WedAddon[]): WedAddon[] {
  return list.slice().sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'th'))
}

export default function AddonsManager({
  initial,
  loadError,
  onMessage,
}: {
  initial: WedAddon[]
  /** โหลดรายการตอนเปิดหน้าไม่ได้ (แสดงข้อความ + ปุ่มลองใหม่) */
  loadError: string | null
  onMessage: (text: string) => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [list, setList] = useState<WedAddon[]>(() => sortAddons(initial))
  const [listError, setListError] = useState<string | null>(loadError)
  const [editor, setEditor] = useState<{ addon: WedAddon | null } | null>(null)
  const [draft, setDraft] = useState<AddonDraft | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<WedAddon | null>(null)

  const reload = useCallback(async (): Promise<boolean> => {
    try {
      const { data, error: qError } = await supabase
        .from('wed_addons')
        .select(ADDON_COLUMNS)
        .order('sort_order')
        .order('name')
      if (qError) return false
      setList(sortAddons(parseWedAddons(data)))
      setListError(null)
      return true
    } catch {
      return false
    }
  }, [supabase])

  const reloadOne = useCallback(async (id: string): Promise<WedAddon | null> => {
    const { data, error: qError } = await supabase.from('wed_addons').select(ADDON_COLUMNS).eq('id', id).maybeSingle()
    if (qError) throw qError
    return parseWedAddon(data)
  }, [supabase])

  function upsert(a: WedAddon) {
    setList(prev => sortAddons([...prev.filter(x => x.id !== a.id), a]))
  }

  async function run(id: string, task: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusyId(id)
    setError('')
    try {
      await task()
    } catch (err) {
      setError(wedErrorText(err))
      void reload()
    } finally {
      busyRef.current = false
      setBusyId(null)
    }
  }

  async function patch(a: WedAddon, fields: Record<string, unknown>): Promise<WedAddon> {
    const res = await callRpc(supabase, 'wed_save_addon', { p_addon: { id: a.id, updated_at: a.updated_at, ...fields } })
    if (!res.ok) throw res.error
    const saved = parseWedAddon(res.data)
    if (!saved) throw new Error('บันทึกแล้วแต่อ่านผลไม่ได้ — โหลดหน้าใหม่')
    return saved
  }

  function toggleActive(a: WedAddon) {
    void run(a.id, async () => {
      upsert(await patch(a, { is_active: !a.is_active }))
      onMessage(a.is_active ? `ปิดใช้ "${a.name}" แล้ว` : `เปิดใช้ "${a.name}" แล้ว`)
    })
  }

  function move(index: number, delta: number) {
    const to = index + delta
    if (to < 0 || to >= list.length) return
    const order = list.slice()
    const [item] = order.splice(index, 1)
    order.splice(to, 0, item)
    const target = order.map((a, i) => ({ ...a, sort_order: (i + 1) * 10 }))
    void run(item.id, async () => {
      const result: WedAddon[] = []
      for (const a of target) {
        const cur = list.find(x => x.id === a.id)
        if (cur && cur.sort_order !== a.sort_order) result.push(await patch(cur, { sort_order: a.sort_order }))
        else result.push(a)
      }
      setList(sortAddons(result))
    })
  }

  function confirmDelete() {
    const a = deleteTarget
    if (!a) return
    void run(a.id, async () => {
      const res = await callRpc(supabase, 'wed_delete_addon', { p_id: a.id })
      if (!res.ok) {
        // "ไม่พบแล้ว" = ถูกลบไปแล้ว (กดครั้งก่อนสำเร็จแต่เน็ตหลุดก่อนได้คำตอบ / เครื่องอื่นลบ) → ถือว่าลบสำเร็จ
        if (res.answered && isGoneText(wedErrorText(res.error))) {
          setDeleteTarget(null)
          setList(prev => prev.filter(x => x.id !== a.id))
          onMessage(`"${a.name}" ถูกลบไปแล้ว`)
          return
        }
        throw res.error
      }
      const r = parseSoftDeleteResult(res.data)
      setDeleteTarget(null)
      if (r.deactivated) {
        setList(prev => prev.map(x => (x.id === a.id ? { ...x, is_active: false } : x)))
        void reload()
        onMessage(`"${a.name}" เคยใช้ในงานแล้ว จึงปิดใช้งานแทนการลบ (งานเดิมไม่เปลี่ยน)`)
      } else {
        setList(prev => prev.filter(x => x.id !== a.id))
        onMessage(`ลบ "${a.name}" แล้ว`)
      }
    })
  }

  function closeEditor() {
    setEditor(null)
    if (draft) void reload()
  }

  const busy = busyId !== null

  return (
    <section className="card min-w-0" aria-labelledby="wad-title">
      <div className="card-header flex-wrap gap-2">
        <div className="min-w-0">
          <h2 id="wad-title" className="section-title">
            <Sparkles {...ICON} />
            บริการเสริม
          </h2>
          <p className="mt-0.5 text-sm text-gray-500">ตัวเลือกเพิ่มจากแพ็กเกจ (ราคาต่อหน่วย × จำนวน) — เลือกได้ในฟอร์มงาน</p>
        </div>
        <button
          type="button"
          onClick={() => { setError(''); setEditor({ addon: null }) }}
          disabled={busy || listError !== null}
          className="btn-primary px-4"
        >
          <Plus {...ICON_SM} />
          {draft ? 'เพิ่มบริการเสริม (ร่างค้าง)' : 'เพิ่มบริการเสริม'}
        </button>
      </div>
      <div className="space-y-3 p-4 sm:p-5">
        <div aria-live="polite" className="space-y-2">
          {listError && (
            <div role="alert" className="alert-err">
              <AlertCircle {...ICON_SM} />
              <div className="min-w-0 space-y-2">
                <p className="break-words">โหลดบริการเสริมไม่ได้: {listError}</p>
                <button
                  type="button"
                  onClick={() => void reload()}
                  className="btn-secondary bg-white px-4 text-sm"
                >
                  ลองอีกครั้ง
                </button>
              </div>
            </div>
          )}
          {error && (
            <div role="alert" className="alert-err">
              <AlertCircle {...ICON_SM} />
              <p className="min-w-0 break-words">{error}</p>
            </div>
          )}
        </div>

        {listError ? null : list.length === 0 ? (
          <p className="panel p-3 text-sm text-gray-500">
            ยังไม่มีบริการเสริม — เช่น โดรน / ช่างภาพเพิ่ม 1 คน / ชั่วโมงเพิ่ม / อัลบั้มภาพ / ไฟล์ดิบทั้งหมด
          </p>
        ) : (
          <ul className="divide-y divide-gray-150 rounded-lg border border-gray-200" aria-label="รายการบริการเสริม">
            {list.map((a, i) => (
              <li key={a.id} className={clsx('flex flex-wrap items-center gap-2 px-3 py-2', !a.is_active && 'bg-gray-50')}>
                <div className="min-w-[10rem] flex-1 py-1">
                  <p className={clsx('text-sm font-medium break-words', a.is_active ? 'text-gray-900' : 'text-gray-500')}>
                    {a.name}
                    {!a.is_active && <span className="ml-2 chip-outline align-middle">ปิดใช้งาน</span>}
                  </p>
                  <p className="text-sm text-gray-700">
                    <span className="money">{baht(a.price)}</span>
                    {a.unit && <span className="text-gray-500"> / {a.unit}</span>}
                  </p>
                  {a.description && <p className="line-clamp-2 whitespace-pre-line break-words text-xs text-gray-500">{a.description}</p>}
                </div>
                <div className="ml-auto flex shrink-0 items-center">
                  {busyId === a.id && <Loader2 {...ICON_SM} className="mr-1 animate-spin text-gray-500" aria-hidden="true" />}
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={busy || i === 0}
                    className="btn-icon btn-icon-plain"
                    aria-label={`เลื่อน ${a.name} ขึ้น`}
                  >
                    <ArrowUp {...ICON_SM} />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={busy || i === list.length - 1}
                    className="btn-icon btn-icon-plain"
                    aria-label={`เลื่อน ${a.name} ลง`}
                  >
                    <ArrowDown {...ICON_SM} />
                  </button>
                  <button
                    type="button"
                    onClick={() => { setError(''); setEditor({ addon: a }) }}
                    disabled={busy}
                    className="btn-icon btn-icon-plain"
                    aria-label={`แก้ไข ${a.name}`}
                  >
                    <Pencil {...ICON_SM} />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleActive(a)}
                    disabled={busy}
                    className="btn-icon btn-icon-plain"
                    aria-label={a.is_active ? `ปิดใช้ ${a.name}` : `เปิดใช้ ${a.name}`}
                    aria-pressed={!a.is_active}
                    title={a.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                  >
                    {a.is_active ? <Eye {...ICON_SM} /> : <EyeOff {...ICON_SM} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setError(''); setDeleteTarget(a) }}
                    disabled={busy}
                    className="btn-icon btn-icon-danger"
                    aria-label={`ลบ ${a.name}`}
                  >
                    <Trash2 {...ICON_SM} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editor && (
        <AddonEditorDialog
          key={editor.addon?.id ?? 'new'}
          initial={editor.addon}
          draft={editor.addon ? null : draft}
          nextSort={nextSortOrder(list)}
          onClose={closeEditor}
          onDraft={setDraft}
          reload={reloadOne}
          onSaved={(addon, info) => {
            upsert(addon)
            if (info.keepOpen) return
            setEditor(null)
            onMessage(info.created ? `เพิ่ม "${addon.name}" แล้ว` : `บันทึก "${addon.name}" แล้ว`)
          }}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`ลบบริการเสริม "${deleteTarget?.name ?? ''}"`}
        confirmLabel="ลบ"
        tone="danger"
        busy={busyId !== null && busyId === deleteTarget?.id}
        onConfirm={confirmDelete}
        onCancel={() => { if (!busyRef.current) setDeleteTarget(null) }}
      >
        <p>ถ้าเคยใช้ในงานแล้ว ระบบจะ &quot;ปิดใช้งาน&quot; แทนการลบ — งานเดิมยังจำชื่อและราคาไว้ครบ · ยังไม่เคยใช้ = ลบออกถาวร</p>
        {/* ลบไม่สำเร็จ: ป็อปอัปยังเปิดอยู่ (ข้อความในการ์ดถูกฉากหลังบัง) → แสดงในป็อปอัปด้วย */}
        {error && <p role="alert" className="text-sm text-red-700 break-words">{error}</p>}
      </ConfirmDialog>
    </section>
  )
}
