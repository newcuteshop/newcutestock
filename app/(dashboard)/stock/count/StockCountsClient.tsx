'use client'
import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { baht, bangkokTodayKey, formatThaiDate, formatThaiDateTime, thaiError } from '@/lib/format'
import { newUuid } from '@/lib/products'
import { FIX04_MISSING_MSG, isMigrationMissing } from '@/lib/migration'
import { parseStockCount, type StockCountStatus, type StockCountSummary } from '@/lib/pos'
import {
  AlertCircle, Ban, CheckCircle2, ChevronRight, ClipboardCheck, ClipboardList, History, Info, Loader2, Plus, X,
  type LucideIcon,
} from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'

/** แถวรอบตรวจนับในหน้ารายการ (page.tsx อ่านจากตาราง stock_counts) */
export interface CountRow {
  id: string
  name: string
  note: string | null
  status: StockCountStatus
  category_id: string | null
  category_name: string | null // null + มี category_id = หมวดถูกลบไปแล้ว
  created_at: string
  created_by_name: string | null
  applied_at: string | null
  applied_by_name: string | null
  cancelled_at: string | null
  lines: number | null // จำนวนรายการที่นับแล้ว (null = ไม่ทราบ)
  summary: StockCountSummary | null // ผลการปรับยอด (มีเฉพาะรอบที่ปรับแล้ว)
}

// ===== ป้ายสถานะรอบนับ (ใช้ร่วมกับหน้ารอบนับ [id]) — ไอคอน + ข้อความ ไม่พึ่งสีอย่างเดียว =====
const STATUS_INFO: Record<StockCountStatus, { label: string; className: string; icon: LucideIcon }> = {
  open: { label: 'กำลังนับ', className: 'badge-return', icon: ClipboardList },
  applied: { label: 'ปรับยอดแล้ว', className: 'badge-in', icon: CheckCircle2 },
  cancelled: { label: 'ยกเลิกแล้ว', className: 'badge-adjust', icon: Ban },
}

export function CountStatusChip({ status }: { status: StockCountStatus }) {
  const info = STATUS_INFO[status] ?? STATUS_INFO.open
  const Icon = info.icon
  return (
    <span className={`${info.className} shrink-0`}>
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      {info.label}
    </span>
  )
}

/** ขอบเขตของรอบนับ: หมวดที่เลือก / ทุกหมวด */
export function scopeText(categoryId: string | null, categoryName: string | null): string {
  if (!categoryId) return 'ทุกหมวดหมู่'
  return categoryName ? `หมวด ${categoryName}` : 'หมวดที่ถูกลบไปแล้ว'
}

function int(n: number): string {
  return n.toLocaleString('en-US')
}

// มูลค่าส่วนต่าง: +฿120 / -฿80 / ฿0
function signedBaht(n: number): string {
  return n > 0 ? `+${baht(n)}` : baht(n)
}

function moneyColor(n: number): string {
  if (n > 0) return 'text-green-700'
  if (n < 0) return 'text-red-700'
  return 'text-gray-500'
}

// error มาจากเซิร์ฟเวอร์จริง (มีรหัส Postgres/PostgREST) = ไม่ได้บันทึกแน่นอน ; ไม่มีรหัส = เน็ตหลุด/หมดเวลา (อาจบันทึกแล้ว)
function serverAnswered(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  if (typeof code !== 'string') return false
  return /^PGRST\d+$/.test(code) || /^(?!E)[0-9A-Z]{5}$/.test(code)
}

const MAX_NAME = 100
const MAX_NOTE = 500
const CREATE_UNSURE_MSG = 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ — กด "เริ่มนับ" อีกครั้งได้เลย ระบบจะไม่สร้างรอบซ้ำ'

type Category = { id: string; name: string }

export default function StockCountsClient({ openCounts, history, categories, showCost }: {
  openCounts: CountRow[]
  history: CountRow[]
  categories: Category[]
  showCost: boolean // แสดงมูลค่าส่วนต่าง (ตามราคาทุน) เฉพาะแอดมิน/ผู้มีสิทธิ์ดูรายงาน
}) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const busyRef = useRef(false)
  // รหัสคำขอสร้างรอบ: ใช้ซ้ำตอนกดใหม่หลังเน็ตหลุด (เซิร์ฟเวอร์คืนรอบเดิม ไม่สร้างซ้ำ) — เปลี่ยนใหม่เมื่อเปิดฟอร์มรอบถัดไป
  const clientIdRef = useRef('')
  const nameRef = useRef<HTMLInputElement>(null)
  const sheetRef = useRef<HTMLFormElement>(null)
  const titleId = useId()

  function openCreate() {
    setName(`ตรวจนับ ${formatThaiDate(bangkokTodayKey())}`)
    setCategoryId('')
    setNote('')
    setFormError('')
    clientIdRef.current = newUuid()
    setCreating(true)
  }

  function closeCreate() {
    if (busyRef.current) return
    setCreating(false)
  }

  // เปิดฟอร์ม: ล็อกการเลื่อนหน้าหลัง + Esc ปิด + โฟกัสเข้าฟอร์ม (มือถือไม่โฟกัสช่องพิมพ์ กันคีย์บอร์ดเด้งบังฟอร์ม)
  useEffect(() => {
    if (!creating) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busyRef.current) {
        e.preventDefault()
        setCreating(false)
      }
    }
    document.addEventListener('keydown', onKey)
    try {
      if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches) {
        nameRef.current?.focus()
        nameRef.current?.select()
      } else {
        sheetRef.current?.focus()
      }
    } catch { /* ignore */ }
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [creating])

  const nameTrim = name.trim()
  const nameProblem = nameTrim.length > MAX_NAME ? `ชื่อยาวเกิน ${MAX_NAME} ตัวอักษร` : ''
  const noteProblem = note.trim().length > MAX_NOTE ? `หมายเหตุยาวเกิน ${MAX_NOTE} ตัวอักษร` : ''
  const categoryKnown = !categoryId || categories.some(c => c.id === categoryId)

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busyRef.current) return
    if (!nameTrim) { setFormError('กรุณาตั้งชื่อรอบตรวจนับ'); nameRef.current?.focus(); return }
    if (nameProblem || noteProblem) { setFormError(nameProblem || noteProblem); return }

    busyRef.current = true
    setBusy(true)
    setFormError('')
    try {
      const { data, error } = await supabase.rpc('create_stock_count', {
        p_client_id: clientIdRef.current,
        p_name: nameTrim,
        p_note: note.trim() || null,
        p_category_id: categoryId && categoryKnown ? categoryId : null,
      })
      if (error) throw error
      const created = parseStockCount(data)
      if (!created) throw new Error('ข้อมูลรอบตรวจนับไม่ถูกต้อง กรุณาโหลดหน้าใหม่')
      // ล้างแคชหน้ารายการก่อนไป (กดย้อนกลับมาจะเห็นรอบใหม่) แล้วเข้าหน้านับทันที — ปุ่มยังหมุนอยู่ระหว่างเปลี่ยนหน้า
      router.refresh()
      router.push(`/stock/count/${created.id}`)
    } catch (err) {
      busyRef.current = false
      setBusy(false)
      setFormError(
        isMigrationMissing(err) ? FIX04_MISSING_MSG
          : serverAnswered(err) ? thaiError(err)
            : CREATE_UNSURE_MSG,
      )
    }
  }

  const empty = openCounts.length === 0 && history.length === 0

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">ตรวจนับสต๊อก</h1>
          <p className="page-subtitle">นับสินค้าจริงในร้าน แล้วให้ระบบปรับยอดสต๊อกให้ตรงกับของจริง</p>
        </div>
        <div className="page-actions">
          <button type="button" onClick={openCreate} className="btn-primary w-full sm:w-auto">
            <Plus {...ICON_SM} />
            เริ่มรอบตรวจนับใหม่
          </button>
        </div>
      </div>

      {empty ? (
        <div className="card empty-state">
          <span className="icon-bubble icon-bubble-lg"><ClipboardCheck size={28} strokeWidth={1.75} aria-hidden="true" /></span>
          <p className="empty-state-title">ยังไม่มีรอบตรวจนับ</p>
          <p className="max-w-sm">เริ่มรอบใหม่ แล้วสแกนหรือกรอกจำนวนสินค้าที่นับได้จริง เมื่อนับเสร็จกดปรับยอด ระบบจะแก้สต๊อกให้ตรงทุกรายการที่นับ</p>
          <button type="button" onClick={openCreate} className="btn-secondary mt-2">
            <Plus {...ICON_SM} />
            เริ่มรอบตรวจนับใหม่
          </button>
        </div>
      ) : (
        <>
          {/* ===== รอบที่ยังนับไม่เสร็จ (ขึ้นก่อนเสมอ) ===== */}
          {openCounts.length > 0 && (
            <section className="space-y-3" aria-labelledby="open-counts-title">
              <h2 id="open-counts-title" className="section-title">
                <ClipboardList {...ICON} />
                กำลังนับ
                <span className="chip tabular-nums">{int(openCounts.length)} รอบ</span>
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {openCounts.map(c => (
                  <li key={c.id} className="min-w-0">
                    <Link
                      href={`/stock/count/${c.id}`}
                      className="card card-hover h-full p-4 flex flex-col gap-2 focus-visible:outline-offset-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 font-semibold text-gray-900 break-words">{c.name}</p>
                        <CountStatusChip status={c.status} />
                      </div>
                      <p className="text-sm text-gray-600 break-words">{scopeText(c.category_id, c.category_name)}</p>
                      {c.note && <p className="text-xs text-gray-500 break-words line-clamp-2">{c.note}</p>}
                      <p className="text-xs text-gray-500 tabular-nums break-words">
                        เริ่ม {formatThaiDateTime(c.created_at)}{c.created_by_name ? ` โดย ${c.created_by_name}` : ''}
                      </p>
                      <div className="mt-auto pt-3 border-t border-gray-150 flex items-center justify-between gap-2">
                        <span className="text-sm text-gray-700">
                          {c.lines === null ? 'นับต่อจากที่ค้างไว้' : (
                            <>นับแล้ว <span className="font-semibold tabular-nums text-gray-900">{int(c.lines)}</span> รายการ</>
                          )}
                        </span>
                        <span className="inline-flex items-center gap-0.5 text-sm font-semibold text-brand-700 whitespace-nowrap">
                          นับต่อ
                          <ChevronRight {...ICON_SM} />
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ===== ประวัติ (ปรับยอดแล้ว / ยกเลิก) ===== */}
          <section className="card overflow-hidden" aria-labelledby="count-history-title">
            <div className="card-header flex-wrap gap-2">
              <h2 id="count-history-title" className="section-title">
                <History {...ICON} />
                ประวัติการตรวจนับ
              </h2>
              {history.length > 0 && <span className="chip tabular-nums">ล่าสุด {int(history.length)} รอบ</span>}
            </div>
            {history.length === 0 ? (
              <div className="empty-state">
                <span className="icon-bubble icon-bubble-lg"><History size={28} strokeWidth={1.75} aria-hidden="true" /></span>
                <p className="empty-state-title">ยังไม่มีรอบที่ปรับยอดหรือยกเลิก</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-150">
                {history.map(c => {
                  const s = c.summary
                  const when = c.status === 'applied' ? c.applied_at : c.cancelled_at
                  return (
                    <li key={c.id}>
                      <Link
                        href={`/stock/count/${c.id}`}
                        className="flex items-start gap-3 px-4 py-3 sm:px-5 min-h-[56px] transition-colors [@media(hover:hover)]:hover:bg-gray-50 active:bg-gray-100 focus-visible:-outline-offset-2"
                      >
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <CountStatusChip status={c.status} />
                            <span className="text-xs text-gray-500 tabular-nums">{formatThaiDateTime(when ?? c.created_at)}</span>
                          </div>
                          <p className="text-sm font-medium text-gray-900 break-words">{c.name}</p>
                          <p className="text-xs text-gray-500 break-words">
                            {scopeText(c.category_id, c.category_name)}
                            {c.created_by_name ? ` · เริ่มโดย ${c.created_by_name}` : ''}
                            {c.status === 'applied' && c.applied_by_name ? ` · ปรับยอดโดย ${c.applied_by_name}` : ''}
                          </p>
                        </div>
                        <div className="text-right shrink-0 space-y-0.5">
                          {c.status === 'applied' && s ? (
                            <>
                              <p className="text-sm font-semibold text-gray-900 tabular-nums whitespace-nowrap">
                                เปลี่ยน {int(s.changed)}/{int(s.lines)} รายการ
                              </p>
                              <p className="text-xs tabular-nums whitespace-nowrap">
                                <span className={s.qty_plus > 0 ? 'text-green-700 font-medium' : 'text-gray-500'}>+{int(s.qty_plus)}</span>
                                <span className="text-gray-400"> / </span>
                                <span className={s.qty_minus > 0 ? 'text-red-700 font-medium' : 'text-gray-500'}>-{int(s.qty_minus)}</span>
                                <span className="text-gray-500"> ชิ้น</span>
                              </p>
                              {showCost && (
                                <p className={`text-xs tabular-nums whitespace-nowrap ${moneyColor(s.value_diff)}`}>{signedBaht(s.value_diff)}</p>
                              )}
                            </>
                          ) : (
                            <>
                              <p className="text-xs text-gray-500 whitespace-nowrap">ไม่ได้ปรับสต๊อก</p>
                              {c.lines !== null && (
                                <p className="text-xs text-gray-500 tabular-nums whitespace-nowrap">นับไว้ {int(c.lines)} รายการ</p>
                              )}
                            </>
                          )}
                        </div>
                        <ChevronRight {...ICON_SM} className="self-center -mr-1 text-gray-400" />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {/* ===== ฟอร์มเริ่มรอบใหม่ — มือถือเป็นชีตล่าง / คอมเป็นป็อปอัปกลางจอ ===== */}
      {creating && (
        <div
          className="fixed inset-0 z-50 !mt-0 flex items-end sm:items-center justify-center scrim sm:p-4"
          onClick={e => { if (e.target === e.currentTarget) closeCreate() }}
        >
          <form
            ref={sheetRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onSubmit={handleCreate}
            noValidate
            className="sheet w-full max-w-lg max-h-[90dvh] overflow-y-auto overscroll-contain rounded-b-none border-b-0 sm:rounded-4xl sm:border-b animate-fade-up focus:outline-none"
          >
            <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="icon-bubble"><ClipboardCheck {...ICON} /></span>
                <h3 id={titleId} className="text-lg font-semibold leading-snug text-gray-900">เริ่มรอบตรวจนับใหม่</h3>
              </div>
              <button type="button" onClick={closeCreate} disabled={busy} className="btn-icon btn-icon-plain -mr-2" aria-label="ปิด">
                <X {...ICON} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {openCounts.length > 0 && (
                <div className="alert-info">
                  <Info {...ICON_SM} />
                  <p className="min-w-0">
                    มีรอบที่ยังนับไม่เสร็จ {int(openCounts.length)} รอบ — ถ้าจะนับต่อให้กดเลือกรอบนั้นในรายการแทน
                    (หลายเครื่องช่วยกันนับรอบเดียวกันได้)
                  </p>
                </div>
              )}

              <div>
                <label htmlFor="count-name" className="field-label">ชื่อรอบ *</label>
                <input
                  id="count-name" ref={nameRef} className="input" value={name} maxLength={MAX_NAME + 20}
                  autoComplete="off" disabled={busy}
                  aria-invalid={nameProblem ? true : undefined}
                  aria-describedby="count-name-hint"
                  onChange={e => { setName(e.target.value); setFormError('') }}
                />
                <p id="count-name-hint" className={`field-hint ${nameProblem ? 'font-medium text-red-700' : ''}`}>
                  {nameProblem || 'เช่น ตรวจนับสิ้นเดือน, นับชั้นเสื้อยืด'}
                </p>
              </div>

              <div>
                <label htmlFor="count-category" className="field-label">หมวดหมู่ที่จะนับ</label>
                <select
                  id="count-category" className="input" value={categoryId} disabled={busy}
                  aria-describedby="count-category-hint"
                  onChange={e => setCategoryId(e.target.value)}
                >
                  <option value="">ทุกหมวดหมู่</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <p id="count-category-hint" className="field-hint">
                  ใช้จัดรายการ &quot;ยังไม่นับ&quot; ให้เหลือเฉพาะหมวดนี้ — สแกนสินค้าหมวดอื่นก็ยังนับได้
                </p>
              </div>

              <div>
                <label htmlFor="count-note" className="field-label">หมายเหตุ (ไม่บังคับ)</label>
                <textarea
                  id="count-note" className="input" rows={2} value={note} maxLength={MAX_NOTE + 50} disabled={busy}
                  aria-invalid={noteProblem ? true : undefined}
                  placeholder="เช่น นับหลังปิดร้าน, ผู้ช่วยนับ"
                  onChange={e => { setNote(e.target.value); setFormError('') }}
                />
                {noteProblem && <p className="field-hint font-medium text-red-700">{noteProblem}</p>}
              </div>

              <p className="flex items-start gap-1.5 text-xs text-gray-500">
                <Info {...ICON_SM} className="-mt-px text-brand-600" />
                <span className="min-w-0">นับระหว่างเปิดขายได้ ระบบจะหักลบยอดที่ขายระหว่างนับให้อัตโนมัติ สต๊อกจะเปลี่ยนก็ต่อเมื่อกด &quot;ปรับยอดสต๊อก&quot; เท่านั้น</span>
              </p>
            </div>

            <div
              className="sticky bottom-0 z-10 bg-white border-t border-gray-200 px-5 pt-3 space-y-2"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            >
              {formError && (
                <p role="alert" className="alert-err">
                  <AlertCircle {...ICON_SM} />
                  <span className="min-w-0 break-words">{formError}</span>
                </p>
              )}
              <div className="flex gap-2 sm:justify-end">
                <button type="button" onClick={closeCreate} disabled={busy} className="btn-secondary">ยกเลิก</button>
                <button type="submit" disabled={busy || !!nameProblem || !!noteProblem} className="btn-primary flex-1 sm:flex-none sm:min-w-[160px]">
                  {busy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <ClipboardCheck {...ICON_SM} />}
                  {busy ? 'กำลังเริ่ม...' : 'เริ่มนับ'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
