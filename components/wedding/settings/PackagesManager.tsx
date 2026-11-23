'use client'
// แพ็กเกจของร้าน (เฉพาะผู้จัดการ): การ์ด + เพิ่ม/แก้ (ป็อปอัป) / เรียงลำดับ / ปิด-เปิดใช้ / ลบ
// เขียนผ่าน wed_save_package และ wed_delete_package เท่านั้น · อ่านจากตาราง wed_packages (RLS: พนักงาน b.oncloud อ่านได้)
// ลบแพ็กเกจที่เคยใช้ในงานแล้ว = ฐานข้อมูลปิดใช้งานแทน (งานเดิมจำชื่อ/ราคาไว้เองอยู่แล้ว) — ยังไม่เคยใช้ = ลบจริง
// ทำได้ทีละรายการ (กันกดซ้ำ/สลับลำดับพร้อมกันจนลำดับเพี้ยน) ; ผิดพลาดกลางทาง → โหลดรายการจากฐานข้อมูลใหม่
import { useCallback, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  AlertCircle, ArrowDown, ArrowUp, Clock, Eye, EyeOff, Loader2, Package, Pencil, Plus, Trash2, Users,
} from 'lucide-react'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { baht } from '@/lib/format'
import { parseSoftDeleteResult, parseWedPackage, parseWedPackages, type WedPackage } from '@/lib/wedding'
import ConfirmDialog from '@/components/integrations/ConfirmDialog'
import PackageEditorDialog, { type PackageDraft } from './PackageEditorDialog'
import { nextSortOrder, PACKAGE_COLUMNS, packageFacts, planItemText } from './packageForm'
import { callRpc, isGoneText, wedErrorText } from './wedRpc'


function sortPackages(list: WedPackage[]): WedPackage[] {
  return list.slice().sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'th'))
}

const PLAN_PREVIEW = 4

export default function PackagesManager({
  initial,
  onMessage,
}: {
  initial: WedPackage[]
  onMessage: (text: string) => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [list, setList] = useState<WedPackage[]>(() => sortPackages(initial))
  const [editor, setEditor] = useState<{ pkg: WedPackage | null } | null>(null)
  const [draft, setDraft] = useState<PackageDraft | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<WedPackage | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const reload = useCallback(async () => {
    try {
      const { data, error: qError } = await supabase
        .from('wed_packages')
        .select(PACKAGE_COLUMNS)
        .order('sort_order')
        .order('name')
      if (!qError) setList(sortPackages(parseWedPackages(data)))
    } catch {
      // อ่านไม่ได้ (เน็ตหลุด) — คงรายการบนจอไว้
    }
  }, [supabase])

  const reloadOne = useCallback(async (id: string): Promise<WedPackage | null> => {
    const { data, error: qError } = await supabase.from('wed_packages').select(PACKAGE_COLUMNS).eq('id', id).maybeSingle()
    if (qError) throw qError
    return parseWedPackage(data)
  }, [supabase])

  function upsert(pkg: WedPackage) {
    setList(prev => sortPackages([...prev.filter(p => p.id !== pkg.id), pkg]))
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

  // บันทึกบางช่อง (ลำดับ/เปิด-ปิด) พร้อมตัวล็อก updated_at — คีย์ที่ไม่ส่ง = คงค่าเดิม
  async function patch(p: WedPackage, fields: Record<string, unknown>): Promise<WedPackage> {
    const res = await callRpc(supabase, 'wed_save_package', { p_package: { id: p.id, updated_at: p.updated_at, ...fields } })
    if (!res.ok) throw res.error
    const saved = parseWedPackage(res.data)
    if (!saved) throw new Error('บันทึกแล้วแต่อ่านผลไม่ได้ — โหลดหน้าใหม่')
    return saved
  }

  function toggleActive(p: WedPackage) {
    void run(p.id, async () => {
      const saved = await patch(p, { is_active: !p.is_active })
      upsert(saved)
      onMessage(p.is_active ? `ปิดใช้แพ็กเกจ "${p.name}" แล้ว` : `เปิดใช้แพ็กเกจ "${p.name}" แล้ว`)
    })
  }

  // สลับลำดับ: เรียงเลขลำดับใหม่ทั้งรายการ (10, 20, 30, ...) แล้วบันทึกเฉพาะแพ็กเกจที่เลขเปลี่ยน
  function move(index: number, delta: number) {
    const to = index + delta
    if (to < 0 || to >= list.length) return
    const order = list.slice()
    const [item] = order.splice(index, 1)
    order.splice(to, 0, item)
    const target = order.map((p, i) => ({ ...p, sort_order: (i + 1) * 10 }))
    void run(item.id, async () => {
      const result: WedPackage[] = []
      for (const p of target) {
        const cur = list.find(x => x.id === p.id)
        if (cur && cur.sort_order !== p.sort_order) result.push(await patch(cur, { sort_order: p.sort_order }))
        else result.push(p)
      }
      setList(sortPackages(result))
    })
  }

  function confirmDelete() {
    const p = deleteTarget
    if (!p) return
    void run(p.id, async () => {
      const res = await callRpc(supabase, 'wed_delete_package', { p_id: p.id })
      if (!res.ok) {
        // "ไม่พบแล้ว" = ถูกลบไปแล้ว (กดครั้งก่อนสำเร็จแต่เน็ตหลุดก่อนได้คำตอบ / เครื่องอื่นลบ) → ถือว่าลบสำเร็จ ไม่ต้องให้กดวน
        if (res.answered && isGoneText(wedErrorText(res.error))) {
          setDeleteTarget(null)
          setList(prev => prev.filter(x => x.id !== p.id))
          onMessage(`แพ็กเกจ "${p.name}" ถูกลบไปแล้ว`)
          return
        }
        throw res.error
      }
      const r = parseSoftDeleteResult(res.data)
      setDeleteTarget(null)
      if (r.deactivated) {
        setList(prev => prev.map(x => (x.id === p.id ? { ...x, is_active: false } : x)))
        void reload()
        onMessage(`แพ็กเกจ "${p.name}" เคยใช้ในงานแล้ว จึงปิดใช้งานแทนการลบ (งานเดิมไม่เปลี่ยน)`)
      } else {
        setList(prev => prev.filter(x => x.id !== p.id))
        onMessage(`ลบแพ็กเกจ "${p.name}" แล้ว`)
      }
    })
  }

  function openNew() {
    setError('')
    setEditor({ pkg: null })
  }

  function closeEditor() {
    setEditor(null)
    // ปิดป็อปอัปตอนยังไม่รู้ผล → ดูรายการล่าสุด (ถ้าบันทึกไปแล้วจะเห็นแพ็กเกจใหม่)
    if (draft) void reload()
  }

  const busy = busyId !== null
  const activeCount = list.filter(p => p.is_active).length

  return (
    <section className="card min-w-0" aria-labelledby="wpk-title">
      <div className="card-header flex-wrap gap-2">
        <div className="min-w-0">
          <h2 id="wpk-title" className="section-title">
            <Package {...ICON} />
            แพ็กเกจ
          </h2>
          <p className="mt-0.5 text-sm text-gray-500">
            ราคาตั้งต้นของงาน — เปลี่ยนราคาแล้วไม่กระทบงานที่จองไปแล้ว (งานจำราคา ณ ตอนจอง)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="chip tabular-nums">ใช้งาน {activeCount.toLocaleString('en-US')} / {list.length.toLocaleString('en-US')}</span>
          <button type="button" onClick={openNew} disabled={busy} className="btn-primary px-4">
            <Plus {...ICON_SM} />
            {draft ? 'เพิ่มแพ็กเกจ (ร่างค้าง)' : 'เพิ่มแพ็กเกจ'}
          </button>
        </div>
      </div>
      <div className="space-y-3 p-4 sm:p-5">
        <div aria-live="polite">
          {error && (
            <div role="alert" className="alert-err">
              <AlertCircle {...ICON_SM} />
              <p className="min-w-0 break-words">{error}</p>
            </div>
          )}
        </div>

        {list.length === 0 ? (
          <div className="empty-state rounded-lg border border-dashed border-gray-300">
            <Package size={28} strokeWidth={1.6} aria-hidden="true" className="text-gray-400" />
            <p className="empty-state-title">ยังไม่มีแพ็กเกจ</p>
            <p>สร้างแพ็กเกจแรก เช่น &quot;ครึ่งวัน (พิธีเช้า)&quot; / &quot;เต็มวัน Photo + Video&quot; — ฟอร์มงานจะเติมราคาและงานที่ส่งให้อัตโนมัติ</p>
            <button type="button" onClick={openNew} className="btn-primary mt-2 px-4">
              <Plus {...ICON_SM} />
              เพิ่มแพ็กเกจแรก
            </button>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3" aria-label="รายการแพ็กเกจ">
            {list.map((p, i) => {
              const facts = packageFacts(p)
              const showAll = expanded[p.id] === true
              const plan = showAll ? p.deliverables : p.deliverables.slice(0, PLAN_PREVIEW)
              return (
                <li
                  key={p.id}
                  className={clsx('flex min-w-0 flex-col rounded-lg border bg-white', p.is_active ? 'border-gray-200' : 'border-dashed border-gray-300 bg-gray-50')}
                >
                  <div className="flex-1 space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={clsx('font-semibold break-words', p.is_active ? 'text-gray-900' : 'text-gray-600')}>{p.name}</p>
                        <p className="money text-lg text-brand-700">{baht(p.price)}</p>
                      </div>
                      {!p.is_active && <span className="chip-outline shrink-0">ปิดใช้งาน</span>}
                    </div>
                    {facts.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {facts.map(f => (
                          <span key={f.kind} className="chip">
                            {f.kind === 'hours' ? <Clock {...ICON_XS} /> : <Users {...ICON_XS} />}
                            {f.text}
                          </span>
                        ))}
                      </div>
                    )}
                    {p.description && (
                      <p className="line-clamp-3 whitespace-pre-line break-words text-sm text-gray-600">{p.description}</p>
                    )}
                    {p.deliverables.length > 0 ? (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-gray-600">งานที่ส่ง {p.deliverables.length.toLocaleString('en-US')} รายการ</p>
                        <ul className="space-y-0.5 text-sm text-gray-700">
                          {plan.map((d, j) => (
                            <li key={j} className="flex gap-1.5 break-words">
                              <span aria-hidden="true" className="text-gray-400">•</span>
                              <span className="min-w-0">{planItemText(d)}</span>
                            </li>
                          ))}
                        </ul>
                        {p.deliverables.length > PLAN_PREVIEW && (
                          <button
                            type="button"
                            className="link min-h-[36px] text-sm"
                            aria-expanded={showAll}
                            onClick={() => setExpanded(e => ({ ...e, [p.id]: !showAll }))}
                          >
                            {showAll ? 'ย่อรายการ' : `ดูอีก ${(p.deliverables.length - PLAN_PREVIEW).toLocaleString('en-US')} รายการ`}
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-amber-800">ยังไม่ได้กำหนดงานที่ส่ง — งานที่ใช้แพ็กเกจนี้ต้องเพิ่มรายการส่งงานเอง</p>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-1 border-t border-gray-150 px-2 py-1.5">
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={busy || i === 0}
                        className="btn-icon btn-icon-plain"
                        aria-label={`เลื่อนแพ็กเกจ ${p.name} ขึ้น`}
                      >
                        <ArrowUp {...ICON_SM} />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={busy || i === list.length - 1}
                        className="btn-icon btn-icon-plain"
                        aria-label={`เลื่อนแพ็กเกจ ${p.name} ลง`}
                      >
                        <ArrowDown {...ICON_SM} />
                      </button>
                      {busyId === p.id && <Loader2 {...ICON_SM} className="ml-1 animate-spin text-gray-500" aria-hidden="true" />}
                    </div>
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => toggleActive(p)}
                        disabled={busy}
                        className="btn-icon btn-icon-plain"
                        aria-label={p.is_active ? `ปิดใช้แพ็กเกจ ${p.name}` : `เปิดใช้แพ็กเกจ ${p.name}`}
                        aria-pressed={!p.is_active}
                        title={p.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                      >
                        {p.is_active ? <Eye {...ICON_SM} /> : <EyeOff {...ICON_SM} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setError(''); setDeleteTarget(p) }}
                        disabled={busy}
                        className="btn-icon btn-icon-danger"
                        aria-label={`ลบแพ็กเกจ ${p.name}`}
                      >
                        <Trash2 {...ICON_SM} />
                      </button>
                      <button
                        type="button"
                        onClick={() => { setError(''); setEditor({ pkg: p }) }}
                        disabled={busy}
                        className="btn-secondary ml-1 px-3"
                      >
                        <Pencil {...ICON_SM} />
                        แก้ไข
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <p className="field-hint">ลำดับนี้ใช้เรียงการ์ดแพ็กเกจในฟอร์มสร้างงาน · แพ็กเกจที่ปิดใช้งานไม่แสดงเป็นตัวเลือกในงานใหม่</p>
      </div>

      {editor && (
        <PackageEditorDialog
          key={editor.pkg?.id ?? 'new'}
          initial={editor.pkg}
          draft={editor.pkg ? null : draft}
          nextSort={nextSortOrder(list)}
          onClose={closeEditor}
          onDraft={setDraft}
          reload={reloadOne}
          onSaved={(pkg, info) => {
            upsert(pkg)
            if (info.keepOpen) return
            setEditor(null)
            onMessage(info.created ? `เพิ่มแพ็กเกจ "${pkg.name}" แล้ว` : `บันทึกแพ็กเกจ "${pkg.name}" แล้ว`)
          }}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`ลบแพ็กเกจ "${deleteTarget?.name ?? ''}"`}
        confirmLabel="ลบแพ็กเกจ"
        tone="danger"
        busy={busyId !== null && busyId === deleteTarget?.id}
        onConfirm={confirmDelete}
        onCancel={() => { if (!busyRef.current) setDeleteTarget(null) }}
      >
        <p>ถ้าแพ็กเกจนี้เคยใช้ในงานแล้ว ระบบจะ &quot;ปิดใช้งาน&quot; แทนการลบ — งานเดิมยังจำชื่อ ราคา และรายละเอียด ณ ตอนจองไว้ครบ</p>
        <p>ยังไม่เคยใช้ = ลบออกถาวร</p>
        {/* ลบไม่สำเร็จ: ป็อปอัปยังเปิดอยู่ (ข้อความในการ์ดถูกฉากหลังบัง) → แสดงในป็อปอัปด้วย */}
        {error && <p role="alert" className="text-sm text-red-700 break-words">{error}</p>}
      </ConfirmDialog>
    </section>
  )
}
