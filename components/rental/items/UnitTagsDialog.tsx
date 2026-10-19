'use client'
// ===== เลือกชิ้นชุดที่จะพิมพ์ป้ายแขวน (A4) =====
// ใช้ได้ทั้งหน้าชุด 1 แบบ (เปิดมาเลือกทุกชิ้นของชุดนั้น) และหน้ารายการชุด (หลายแบบตามตัวกรองที่เลือกอยู่)
// ค่าเริ่มต้น: เลือกทุกชิ้นที่ยังไม่เลิกใช้ · ตัวเลือก: แสดงค่าเช่า, QR (ไม่มี / รหัสชิ้น / ลิงก์หน้าจองออนไลน์)
// กดพิมพ์ → สร้างบาร์โค้ด/QR → PrintPortal (A4) → หน้าต่างพิมพ์ของเบราว์เซอร์

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { AlertTriangle, Loader2, Printer, Search, Tags, X, XCircle } from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { thaiError } from '@/lib/format'
import { sizeLabel, type RentalSize, type RentalUnitStatus } from '@/lib/rental'
import PrintPortal from '@/components/pos/PrintPortal'
import UnitTagsPrint, {
  TAGS_PER_PAGE, prepareUnitTags, type PreparedUnitTag, type TagQrMode, type UnitTag,
} from '@/components/rental/UnitTagsPrint'

export interface TagGroupUnit {
  id: string
  unit_code: string
  size: RentalSize
  status: RentalUnitStatus
}

export interface TagGroup {
  item_id: string
  item_code: string
  item_name: string
  price_text: string | null
  units: TagGroupUnit[]
}

const QR_OPTIONS: { value: TagQrMode; label: string; hint: string }[] = [
  { value: 'none', label: 'ไม่มี QR', hint: 'ป้ายเรียบ มีแต่บาร์โค้ด' },
  { value: 'unit', label: 'QR รหัสชิ้น', hint: 'สแกนด้วยกล้องมือถือในระบบได้' },
  { value: 'link', label: 'QR หน้าจองออนไลน์', hint: 'ลูกค้าสแกนดูชุดนี้/วันว่างได้เอง (เฉพาะชุดที่เปิดให้เช่าและแสดงบนหน้าจองออนไลน์)' },
]

const STATUS_SHORT: Record<RentalUnitStatus, string> = {
  available: '',
  maintenance: 'ส่งซ่อม',
  retired: 'เลิกใช้',
}

export default function UnitTagsDialog({
  open, onClose, shopName, groups, title = 'พิมพ์ป้ายแขวนชิ้นชุด', note,
}: {
  open: boolean
  onClose(): void
  shopName: string
  groups: readonly TagGroup[]
  title?: string
  /** ข้อความเตือนบนสุด (เช่น ฟอร์มยังไม่บันทึก) */
  note?: string
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [qrMode, setQrMode] = useState<TagQrMode>('none')
  const [showPrice, setShowPrice] = useState(true)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [problems, setProblems] = useState<string[]>([])
  const [prepared, setPrepared] = useState<PreparedUnitTag[] | null>(null)
  const [printing, setPrinting] = useState(false)
  const busyRef = useRef(false)

  // เปิดใหม่ทุกครั้ง: เลือกทุกชิ้นที่ยังใช้งาน
  useEffect(() => {
    if (!open) return
    const all = new Set<string>()
    for (const g of groups) for (const u of g.units) if (u.status !== 'retired') all.add(u.id)
    setSelected(all)
    setSearch('')
    setError('')
    setProblems([])
    setPrepared(null)
    // groups เปลี่ยนระหว่างเปิดอยู่ (หน้า refresh) ไม่ต้องรีเซ็ตการเลือกของผู้ใช้
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busyRef.current && !printing) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, printing])

  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return groups
    return groups
      .map(g => {
        const head = `${g.item_code} ${g.item_name}`.toLowerCase().includes(q)
        return head ? g : { ...g, units: g.units.filter(u => u.unit_code.toLowerCase().includes(q)) }
      })
      .filter(g => g.units.length > 0)
  }, [groups, search])

  const tags: UnitTag[] = useMemo(() => {
    const out: UnitTag[] = []
    for (const g of groups) {
      for (const u of g.units) {
        if (!selected.has(u.id)) continue
        out.push({
          unit_id: u.id, unit_code: u.unit_code, item_code: g.item_code, item_name: g.item_name,
          size: u.size, price_text: g.price_text,
        })
      }
    }
    return out
  }, [groups, selected])

  if (!open) return null

  const pages = Math.ceil(tags.length / TAGS_PER_PAGE)
  const totalUnits = groups.reduce((s, g) => s + g.units.length, 0)

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setPrepared(null)
  }

  function setGroup(g: TagGroup, on: boolean) {
    setSelected(prev => {
      const next = new Set(prev)
      for (const u of g.units) {
        if (on) next.add(u.id)
        else next.delete(u.id)
      }
      return next
    })
    setPrepared(null)
  }

  function setAll(on: boolean) {
    setSelected(() => {
      if (!on) return new Set()
      const next = new Set<string>()
      for (const g of visibleGroups) for (const u of g.units) if (u.status !== 'retired') next.add(u.id)
      return next
    })
    setPrepared(null)
  }

  async function print() {
    if (busyRef.current || tags.length === 0) return
    busyRef.current = true
    setBusy(true)
    setError('')
    setProblems([])
    try {
      const res = await prepareUnitTags(tags, { qr: qrMode, linkBase: window.location.origin })
      setProblems(res.problems)
      setPrepared(res.tags)
      setPrinting(true)
    } catch (e) {
      setError(`เตรียมป้ายไม่สำเร็จ: ${typeof e === 'string' ? e : thaiError(e)} — ลองใหม่อีกครั้ง`)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 !mt-0 flex items-end sm:items-center justify-center scrim sm:p-4"
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="sheet flex w-full max-w-2xl flex-col h-[94dvh] sm:h-auto sm:max-h-[90dvh] overflow-hidden rounded-b-none border-b-0 sm:rounded-4xl sm:border-b animate-fade-up outline-none"
      >
        <div className="shrink-0 flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="icon-bubble shrink-0"><Tags {...ICON} /></span>
            <div className="min-w-0">
              <h3 id={titleId} className="text-lg font-semibold leading-snug text-gray-900">{title}</h3>
              <p className="text-xs text-gray-600">กระดาษ A4 · แผ่นละ {TAGS_PER_PAGE} ป้าย (64 × 92 มม.) · ตัดตามเส้นประ เจาะรูตรงวงกลม</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="ปิด" className="btn-icon btn-icon-plain -mr-2 shrink-0">
            <X {...ICON} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-4">
          {note && (
            <div className="alert-warn">
              <AlertTriangle {...ICON_SM} />
              <p className="min-w-0">{note}</p>
            </div>
          )}
          {/* ตัวเลือกป้าย */}
          <fieldset className="space-y-2">
            <legend className="field-label">QR บนป้าย</legend>
            <div className="grid grid-cols-3 gap-2">
              {QR_OPTIONS.map(o => (
                <button
                  key={o.value}
                  type="button"
                  className="choice"
                  aria-pressed={qrMode === o.value}
                  onClick={() => { setQrMode(o.value); setPrepared(null) }}
                  disabled={busy}
                >
                  <span>{o.label}</span>
                </button>
              ))}
            </div>
            <p className="field-hint">{QR_OPTIONS.find(o => o.value === qrMode)?.hint}</p>
          </fieldset>

          <label className="panel flex min-h-[48px] cursor-pointer items-center gap-3 px-3.5 py-2.5">
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0 accent-brand-600"
              checked={showPrice}
              disabled={busy}
              onChange={e => setShowPrice(e.target.checked)}
            />
            <span className="text-sm font-medium text-gray-900">แสดงค่าเช่าบนป้าย</span>
          </label>

          {/* เลือกชิ้น */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-gray-900" aria-live="polite">
                เลือกแล้ว {tags.length} จาก {totalUnits} ชิ้น
              </p>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost md:min-h-[40px] px-3 text-sm" disabled={busy} onClick={() => setAll(true)}>
                  เลือกทั้งหมด
                </button>
                <button type="button" className="btn-ghost md:min-h-[40px] px-3 text-sm" disabled={busy} onClick={() => setAll(false)}>
                  ไม่เลือกเลย
                </button>
              </div>
            </div>
            {groups.length > 3 && (
              <div className="input-icon">
                <Search {...ICON_SM} />
                <input
                  className="input pl-11"
                  type="search"
                  aria-label="ค้นหาชุดหรือรหัสชิ้น"
                  placeholder="ค้นหารหัสชุด ชื่อชุด หรือรหัสชิ้น"
                  value={search}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            )}
            {visibleGroups.length === 0 ? (
              <p className="empty-state py-6">ไม่มีชิ้นชุดให้เลือก{search.trim() ? ' ตามคำค้นนี้' : ' (เพิ่มชิ้นแล้วกดบันทึกก่อน)'}</p>
            ) : (
              <ul className="space-y-2">
                {visibleGroups.map(g => {
                  const on = g.units.filter(u => selected.has(u.id)).length
                  return (
                    <li key={g.item_id} className="panel p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 text-sm">
                          <span className="font-mono text-xs text-gray-600">{g.item_code}</span>{' '}
                          <span className="font-semibold text-gray-900 break-words">{g.item_name}</span>
                        </p>
                        <button
                          type="button"
                          className="btn-ghost -my-1 md:min-h-[36px] shrink-0 px-2 text-xs"
                          disabled={busy}
                          onClick={() => setGroup(g, on < g.units.length)}
                        >
                          {on < g.units.length ? 'เลือกทั้งชุด' : 'ไม่เลือกชุดนี้'}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {g.units.map(u => {
                          const checked = selected.has(u.id)
                          return (
                            <label
                              key={u.id}
                              className={clsx(
                                'inline-flex min-h-[44px] md:min-h-[36px] cursor-pointer select-none items-center gap-2 rounded-lg border px-2.5 text-sm',
                                checked ? 'border-brand-500 bg-brand-50' : 'border-gray-300 bg-white',
                                u.status === 'retired' && 'opacity-70',
                              )}
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-brand-600"
                                checked={checked}
                                disabled={busy}
                                onChange={() => toggle(u.id)}
                              />
                              <span className="font-mono">{u.unit_code}</span>
                              <span className="text-gray-600">{sizeLabel(u.size)}</span>
                              {STATUS_SHORT[u.status] && <span className="text-xs text-gray-500">({STATUS_SHORT[u.status]})</span>}
                            </label>
                          )
                        })}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {problems.length > 0 && (
            <div className="alert-warn" role="status">
              <AlertTriangle {...ICON_SM} />
              <ul className="min-w-0 space-y-1">
                {problems.map((p, i) => <li key={i} className="break-words">{p}</li>)}
              </ul>
            </div>
          )}
          {error && (
            <div role="alert" className="alert-err">
              <XCircle {...ICON_SM} />
              <p className="min-w-0 break-words">{error}</p>
            </div>
          )}
        </div>

        <div
          className="shrink-0 border-t border-gray-200 bg-white px-5 pt-3 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <button type="button" onClick={onClose} disabled={busy} className="btn-secondary w-full sm:w-auto px-5">
            ปิด
          </button>
          <button
            type="button"
            onClick={() => { void print() }}
            disabled={busy || printing || tags.length === 0}
            className="btn-primary w-full sm:w-auto px-5"
          >
            {busy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Printer {...ICON_SM} />}
            {busy ? 'กำลังเตรียมป้าย...' : `พิมพ์ ${tags.length} ป้าย${pages > 0 ? ` (${pages} แผ่น)` : ''}`}
          </button>
        </div>
      </div>

      <PrintPortal open={printing && prepared !== null} paper="a4" onDone={() => setPrinting(false)}>
        {prepared && <UnitTagsPrint shopName={shopName} tags={prepared} showPrice={showPrice} />}
      </PrintPortal>
    </div>
  )
}
