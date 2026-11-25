'use client'
// กระดานงานตัดต่อ/ส่งงานของทุกงาน (wed_deliverables_board) — จอกว้าง = คอลัมน์ตามสถานะ · มือถือ = กลุ่มเรียงลงมา (มาร์กอัปชุดเดียวกัน)
// ขอบเขต (ฐานข้อมูลกรอง): ยังไม่ส่ง / เลยกำหนด / ส่งแล้ว / ทั้งหมด + ช่วงกำหนดส่ง · ตัวกรองในเครื่อง: ผู้ตัดต่อ + คำค้น
// เปลี่ยนสถานะ/ลิงก์ผ่าน wed_save_deliverable ทีละรายการ — การ์ดที่กำลังบันทึกกดซ้ำไม่ได้ · ไม่รู้ผล → อ่านแถวจริงก่อน (deliverableWrites)
// ส่งครบทุกชิ้นของงานที่ถ่ายเสร็จแล้ว → ฐานข้อมูลเปลี่ยนสถานะงานเป็น "ส่งงานแล้ว" เอง (บอกผู้ใช้ในโทสต์)
// ตัวเลขบนเมนู (เลยกำหนด) อยู่ใน layout ฝั่งเซิร์ฟเวอร์ → router.refresh() หลังบันทึกสำเร็จ
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { AlertTriangle, Clapperboard, Inbox, RefreshCw, Search, X, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { bangkokTodayKey, formatThaiDate, isDayKey } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import {
  DELIVERABLE_STATUS_LABELS, FIX07_MISSING_MSG, crewDisplayName, parseCrewList, parseDeliverablesBoard,
  type WedCrew, type WedDeliverableBoardItem, type WedDeliverableStatus,
} from '@/lib/wedding'
import MigrationNotice from '@/components/pos/MigrationNotice'
import { fmtCount, rpcWithTimeout, wedErrorText } from '@/components/wedding/money/wedRpc'
import Toast, { type ToastMsg } from '@/components/wedding/money/Toast'
import {
  BOARD_SCOPES, canDeliverDirectly, columnsFor, inScope, matchesFilters, scopeToFilter,
  type BoardScope, type EditorFilter,
} from './boardModel'
import { saveDeliverable, type DeliverableWriteResult } from './deliverableWrites'
import DeliverableCard from './DeliverableCard'
import DeliverableDialog from './DeliverableDialog'

// wed_deliverables_board คืนไม่เกินนี้ต่อครั้ง (เรียงตามกำหนดส่ง) — ถึงเพดานแล้วแนะนำให้เลือกช่วงวันที่
const BOARD_LIMIT = 1000
// คอลัมน์ "ส่งแล้ว" แสดงทีละเท่านี้ (งานเก่าสะสมเยอะ)
const DELIVERED_PAGE = 30
// กลับมาที่แท็บหลังทิ้งไว้นานกว่านี้ → โหลดใหม่เงียบๆ (มีคนอัปเดตจากเครื่องอื่น)
const STALE_MS = 60000

type DialogState = { item: WedDeliverableBoardItem; mode: 'edit' | 'deliver' } | null

function sortItems(list: WedDeliverableBoardItem[]): WedDeliverableBoardItem[] {
  return [...list].sort((a, b) =>
    (a.due_date ?? '9999-99-99').localeCompare(b.due_date ?? '9999-99-99') ||
    a.booking_no.localeCompare(b.booking_no) || a.sort_order - b.sort_order)
}

// คลาสของกระดาน/รายการในคอลัมน์ตามจำนวนคอลัมน์ (สตริงเต็มให้ Tailwind เห็น)
// 4 คอลัมน์ต้องใช้จอกว้างมาก (เมนูข้าง 15rem กินที่อยู่แล้ว) → จอ lg–xl เป็น 2 คอลัมน์ก่อน
function layoutFor(cols: number): { board: string; list: string } {
  if (cols >= 4) return { board: 'lg:grid-cols-2 2xl:grid-cols-4', list: 'sm:grid-cols-2 lg:grid-cols-1' }
  if (cols === 3) return { board: 'lg:grid-cols-3', list: 'sm:grid-cols-2 lg:grid-cols-1' }
  return { board: '', list: 'sm:grid-cols-2 xl:grid-cols-3' }
}

export default function DeliverablesBoardClient({
  initialScope,
  initialFrom,
  initialTo,
  today: initialToday,
}: {
  initialScope: BoardScope
  initialFrom: string
  initialTo: string
  today: string
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [today, setToday] = useState(initialToday)
  const [scope, setScope] = useState<BoardScope>(initialScope)
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [editor, setEditor] = useState<EditorFilter>('any')
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<WedDeliverableBoardItem[]>([])
  const [loadedKey, setLoadedKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [crew, setCrew] = useState<WedCrew[]>([])
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set())
  const busyRef = useRef<Set<string>>(new Set())
  const [dialog, setDialog] = useState<DialogState>(null)
  const [deliveredShown, setDeliveredShown] = useState(DELIVERED_PAGE)
  const [toast, setToast] = useState<ToastMsg>(null)
  const reqRef = useRef(0)
  const loadedAtRef = useRef(0)
  const queryRef = useRef({ scope: initialScope, from: initialFrom, to: initialTo })

  const rangeProblem = from && to && isDayKey(from) && isDayKey(to) && to < from
    ? 'วันที่สิ้นสุดต้องไม่อยู่ก่อนวันที่เริ่มต้น'
    : ''

  // ---------- โหลดกระดาน ----------
  const load = useCallback(async (q: { scope: BoardScope; from: string; to: string }, silent = false) => {
    const id = ++reqRef.current
    queryRef.current = q
    if (!silent) {
      setLoading(true)
      setError('')
    }
    const res = await rpcWithTimeout(supabase, 'wed_deliverables_board', {
      p_status: scopeToFilter(q.scope),
      p_from: isDayKey(q.from) ? q.from : null,
      p_to: isDayKey(q.to) ? q.to : null,
    })
    if (id !== reqRef.current) return
    setLoading(false)
    if (res.error) {
      if (isMigrationMissing(res.error)) {
        setMissing(true)
        return
      }
      if (!silent) {
        setItems([])
        setLoadedKey('')
        setError(wedErrorText(res.error))
      }
      return
    }
    setMissing(false)
    setError('')
    setItems(parseDeliverablesBoard(res.data))
    setLoadedKey(`${q.scope}|${q.from}|${q.to}`)
    loadedAtRef.current = Date.now()
  }, [supabase])

  // รายชื่อทีม (ตัวกรองผู้ตัดต่อ + สีประจำตัว) — อ่านไม่ได้ก็แค่ใช้ชื่อจากรายการ
  useEffect(() => {
    let alive = true
    void rpcWithTimeout(supabase, 'wed_list_crew').then(res => {
      if (alive && !res.error) setCrew(parseCrewList(res.data))
    })
    return () => { alive = false }
  }, [supabase])

  // โหลดครั้งแรกครั้งเดียว (queryRef = ค่าจาก URL) — router.refresh() หลังบันทึกส่ง props ใหม่มา แต่ไม่ต้องโหลดกระดานซ้ำ
  useEffect(() => {
    void load(queryRef.current)
  }, [load])

  // เขียนตัวกรองลง URL (?status= &from= &to=) — โหลดหน้าใหม่แล้วยังอยู่ที่เดิม ; ค่าเริ่มต้น (ยังไม่ส่ง) ไม่ใส่
  const syncUrl = useCallback((q: { scope: BoardScope; from: string; to: string }) => {
    try {
      const url = new URL(window.location.href)
      if (q.scope === 'open') url.searchParams.delete('status')
      else url.searchParams.set('status', q.scope)
      if (isDayKey(q.from)) url.searchParams.set('from', q.from)
      else url.searchParams.delete('from')
      if (isDayKey(q.to)) url.searchParams.set('to', q.to)
      else url.searchParams.delete('to')
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    } catch {
      // แก้ URL ไม่ได้ ไม่เป็นไร
    }
  }, [])

  function apply(next: { scope: BoardScope; from: string; to: string }) {
    if (next.from && next.to && isDayKey(next.from) && isDayKey(next.to) && next.to < next.from) return
    setDeliveredShown(DELIVERED_PAGE)
    syncUrl(next)
    void load(next)
  }

  function chooseScope(s: BoardScope) {
    setScope(s)
    apply({ scope: s, from, to })
  }

  // กลับมาที่แท็บ: อัปเดต "วันนี้" (นับวันเลยกำหนด) + โหลดใหม่เงียบๆ เมื่อทิ้งไว้นาน (ไม่ทำระหว่างเปิดป็อปอัป)
  const dialogOpenRef = useRef(false)
  dialogOpenRef.current = dialog !== null
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      setToday(bangkokTodayKey())
      if (dialogOpenRef.current || busyRef.current.size > 0) return
      if (Date.now() - loadedAtRef.current > STALE_MS) void load(queryRef.current, true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  const closeToast = useCallback(() => setToast(null), [])

  // ---------- ผลการบันทึก ----------
  const setBusy = useCallback((id: string, on: boolean) => {
    if (on) busyRef.current.add(id)
    else busyRef.current.delete(id)
    setBusyIds(new Set(busyRef.current))
  }, [])

  // รวมผลจากฐานข้อมูลเข้ากับการ์ดเดิม (ข้อมูลงาน/คู่บ่าวสาวคงเดิม) แล้วเอาออกถ้าไม่อยู่ในขอบเขตที่ดูอยู่
  const applySaved = useCallback((
    old: WedDeliverableBoardItem,
    r: Extract<DeliverableWriteResult, { status: 'ok' }>,
  ) => {
    if (!r.deliverable) {
      // ยืนยันผลจากการอ่านแถวจริง (ไม่มีข้อมูลชุดใหม่) → โหลดกระดานใหม่เงียบๆ
      void load(queryRef.current, true)
      setToast({ ok: true, text: `บันทึก "${old.name}" แล้ว` })
      return
    }
    const merged: WedDeliverableBoardItem = {
      ...old,
      ...r.deliverable,
      booking_id: old.booking_id,
      booking_no: old.booking_no,
      couple_names: old.couple_names,
      last_session_date: old.last_session_date,
      booking_status: r.booking?.status ?? old.booking_status,
      booking_status_label: r.booking?.status_label ?? old.booking_status_label,
    }
    const stays = inScope(merged, queryRef.current.scope)
    setItems(prev => sortItems(stays
      ? prev.map(x => (x.id === merged.id ? merged : x))
      : prev.filter(x => x.id !== merged.id)))
    const statusText = merged.status !== old.status ? ` → ${DELIVERABLE_STATUS_LABELS[merged.status]}` : ''
    const bookingDone = r.booking?.status === 'delivered' && old.booking_status !== 'delivered'
      ? ` · งาน ${old.booking_no} ส่งครบทุกชิ้นแล้ว (สถานะงาน: ส่งงานแล้ว)`
      : ''
    setToast({ ok: true, text: `บันทึก "${merged.name}"${statusText} แล้ว${bookingDone}` })
    if (navigator.onLine !== false) router.refresh()
  }, [load, router])

  // ---------- เปลี่ยนสถานะจากการ์ด ----------
  async function move(item: WedDeliverableBoardItem, next: WedDeliverableStatus) {
    if (busyRef.current.has(item.id) || next === item.status) return
    // ส่งแล้วต้องมีลิงก์/หมายเหตุ → เปิดป็อปอัปให้ใส่ลิงก์ก่อน
    if (next === 'delivered' && !canDeliverDirectly(item)) {
      setDialog({ item, mode: 'deliver' })
      return
    }
    setBusy(item.id, true)
    try {
      const r = await saveDeliverable(supabase, item.booking_id, { id: item.id, status: next })
      if (r.status === 'ok') {
        applySaved(item, r)
      } else {
        setToast({ ok: false, text: r.message })
        // สถานะอาจเปลี่ยนจากอีกเครื่อง → ดึงของจริงมาแสดง
        void load(queryRef.current, true)
      }
    } finally {
      setBusy(item.id, false)
    }
  }

  function handleDialogSaved(r: Extract<DeliverableWriteResult, { status: 'ok' }>) {
    const old = dialog?.item
    setDialog(null)
    if (old) applySaved(old, r)
  }

  function handleDialogDeleted() {
    const old = dialog?.item
    setDialog(null)
    if (!old) return
    setItems(prev => prev.filter(x => x.id !== old.id))
    setToast({ ok: true, text: `ลบ "${old.name}" ออกจากรายการส่งงานแล้ว` })
    if (navigator.onLine !== false) router.refresh()
  }

  // ---------- คำนวณ ----------
  const crewById = useMemo(() => {
    const m = new Map<string, WedCrew>()
    for (const c of crew) m.set(c.id, c)
    return m
  }, [crew])

  // ผู้ตัดต่อในตัวกรอง: ทีมที่ใช้งานอยู่ + คนที่มีงานบนกระดาน (แม้ปิดใช้งานแล้ว/อ่านรายชื่อทีมไม่ได้)
  const editorOptions = useMemo(() => {
    const opts = new Map<string, string>()
    for (const c of crew) if (c.is_active) opts.set(c.id, crewDisplayName(c))
    for (const it of items) {
      if (it.editor_crew_id && !opts.has(it.editor_crew_id)) opts.set(it.editor_crew_id, it.editor_name || 'ผู้ตัดต่อ')
    }
    return Array.from(opts.entries()).sort((a, b) => a[1].localeCompare(b[1], 'th'))
  }, [crew, items])

  const loadedScope = (loadedKey.split('|')[0] || scope) as BoardScope
  const visible = items.filter(it => matchesFilters(it, { editor, search }))
  const cols = columnsFor(loadedScope)
  const layout = layoutFor(cols.length)
  const overdueCount = visible.filter(it => it.overdue && it.status !== 'delivered').length
  const filtersOn = editor !== 'any' || search.trim() !== ''
  const stale = loading && loadedKey !== ''

  if (missing) return <MigrationNotice message={FIX07_MISSING_MSG} />

  return (
    <div className="space-y-4">
      {/* ===== ตัวกรอง ===== */}
      <section className="card space-y-3 p-4 sm:p-5" aria-label="ตัวกรองกระดานส่งงาน">
        <div className="flex items-start gap-2">
          <div className="lift-scroll flex min-w-0 flex-1 gap-2 overflow-x-auto scrollbar-none sm:flex-wrap" role="group" aria-label="ขอบเขตรายการ">
            {BOARD_SCOPES.map(s => (
              <button
                key={s.key}
                type="button"
                className="chip-toggle lift-hover lift-tab"
                aria-pressed={scope === s.key}
                onClick={() => chooseScope(s.key)}
              >
                {s.key === 'overdue' && <AlertTriangle {...ICON_XS} />}
                {s.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void load(queryRef.current)}
            disabled={loading}
            className="btn-icon btn-icon-plain shrink-0"
            aria-label="โหลดกระดานใหม่"
          >
            <RefreshCw {...ICON_SM} className={loading ? 'animate-spin' : undefined} />
          </button>
        </div>

        {/* ช่องวันที่กว้างอย่างน้อย 9.5rem (จอ lg ที่มีเมนูข้าง ไม่ให้วันที่ถูกตัด) */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(9.5rem,1fr)_minmax(9.5rem,1fr)] lg:items-end">
          <div className="col-span-2 lg:col-span-1">
            <label htmlFor="deliv-search" className="field-label">ค้นหา</label>
            <div className="input-icon">
              <Search {...ICON_SM} />
              <input
                id="deliv-search"
                type="search"
                className="input pl-11"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="ชื่องาน / คู่บ่าวสาว / เลขที่งาน"
                autoComplete="off"
                enterKeyHint="search"
                maxLength={60}
              />
            </div>
          </div>
          <div className="col-span-2 lg:col-span-1">
            <label htmlFor="deliv-editor" className="field-label">ผู้ตัดต่อ</label>
            <select id="deliv-editor" className="input" value={editor} onChange={e => setEditor(e.target.value)}>
              <option value="any">ทุกคน</option>
              <option value="none">ยังไม่มอบหมาย</option>
              {editorOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor="deliv-from" className="field-label">กำหนดส่งตั้งแต่</label>
            <input
              id="deliv-from"
              type="date"
              className="input tabular-nums"
              value={from}
              onChange={e => { setFrom(e.target.value); apply({ scope, from: e.target.value, to }) }}
              aria-invalid={!!rangeProblem}
            />
          </div>
          <div className="min-w-0">
            <label htmlFor="deliv-to" className="field-label">ถึง</label>
            <input
              id="deliv-to"
              type="date"
              className="input tabular-nums"
              value={to}
              onChange={e => { setTo(e.target.value); apply({ scope, from, to: e.target.value }) }}
              aria-invalid={!!rangeProblem}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-xs text-gray-500" aria-live="polite">
            {rangeProblem
              ? <span className="font-medium text-red-700">{rangeProblem}</span>
              : isDayKey(from) || isDayKey(to)
                ? `กำหนดส่ง ${isDayKey(from) ? formatThaiDate(from) : 'ทั้งหมด'} – ${isDayKey(to) ? formatThaiDate(to) : 'ไม่จำกัด'} (รายการไม่มีกำหนดส่งไม่แสดง)`
                : 'ทุกกำหนดส่ง (รวมรายการที่ยังไม่กำหนดวัน)'}
          </p>
          {(from || to || filtersOn) && (
            <button
              type="button"
              onClick={() => {
                setFrom('')
                setTo('')
                setEditor('any')
                setSearch('')
                apply({ scope, from: '', to: '' })
              }}
              className="btn-ghost px-3 text-sm"
            >
              <X {...ICON_XS} />
              ล้างตัวกรอง
            </button>
          )}
        </div>
      </section>

      {/* ===== กระดาน ===== */}
      {error && loadedKey === '' ? (
        <div role="alert" className="alert-err">
          <XCircle {...ICON_SM} />
          <div className="min-w-0 space-y-2">
            <p className="break-words">{error}</p>
            <button type="button" onClick={() => void load(queryRef.current)} className="btn-secondary bg-white px-4 text-sm">
              <RefreshCw {...ICON_SM} />
              ลองอีกครั้ง
            </button>
          </div>
        </div>
      ) : loading && loadedKey === '' ? (
        <div className={clsx('grid gap-4', layoutFor(columnsFor(scope).length).board)} role="status">
          <span className="sr-only">กำลังโหลดกระดานส่งงาน...</span>
          {columnsFor(scope).map(s => (
            <div key={s} className="panel space-y-3 p-3">
              <div className="skeleton h-5 w-24" />
              {[0, 1, 2].map(i => <div key={i} className="skeleton h-32 rounded-xl" />)}
            </div>
          ))}
        </div>
      ) : (
        <div aria-busy={loading} className={clsx('space-y-3', stale && 'opacity-60')}>
          <div className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
            <span className="section-title !text-base">
              <Clapperboard {...ICON} />
              {fmtCount(visible.length)} รายการ
            </span>
            {filtersOn && items.length !== visible.length && (
              <span className="text-gray-500">(จาก {fmtCount(items.length)} ตามตัวกรอง)</span>
            )}
            {overdueCount > 0 && loadedScope !== 'overdue' && (
              <button type="button" onClick={() => chooseScope('overdue')} className="btn-danger-soft px-3 text-sm">
                <AlertTriangle size={12} strokeWidth={1.9} aria-hidden="true" />
                เลยกำหนด {fmtCount(overdueCount)} รายการ
              </button>
            )}
          </div>

          {items.length >= BOARD_LIMIT && (
            <p className="alert-warn text-sm">
              <AlertTriangle {...ICON_SM} />
              <span className="min-w-0">แสดง {fmtCount(BOARD_LIMIT)} รายการแรกตามกำหนดส่ง — เลือกช่วงกำหนดส่งให้แคบลงเพื่อดูรายการที่เหลือ</span>
            </p>
          )}

          {visible.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <span className="icon-bubble icon-bubble-lg"><Inbox size={28} strokeWidth={1.75} aria-hidden="true" /></span>
                <p className="empty-state-title">
                  {filtersOn ? 'ไม่มีรายการตามตัวกรอง'
                    : loadedScope === 'overdue' ? 'ไม่มีงานที่เลยกำหนดส่ง'
                      : loadedScope === 'open' ? 'ไม่มีงานค้างส่ง'
                        : 'ยังไม่มีรายการส่งงาน'}
                </p>
                <p className="max-w-sm text-sm text-gray-500">
                  รายการส่งงานถูกสร้างจากแพ็กเกจเมื่อยืนยันงาน — เพิ่ม/แก้รายการของแต่ละงานได้ที่หน้ารายละเอียดงาน
                </p>
              </div>
            </div>
          ) : (
            <div className={clsx('grid items-start gap-4', layout.board)}>
              {cols.map(status => {
                const group = visible.filter(it => it.status === status)
                const capped = status === 'delivered' ? group.slice(0, deliveredShown) : group
                const headId = `deliv-col-${status}`
                return (
                  <section key={status} className="panel min-w-0 space-y-3 p-3" aria-labelledby={headId}>
                    <div className="flex items-center justify-between gap-2 px-1">
                      <h2 id={headId} className="text-sm font-semibold text-gray-900">{DELIVERABLE_STATUS_LABELS[status]}</h2>
                      <span className="chip tabular-nums">{fmtCount(group.length)}</span>
                    </div>
                    {group.length === 0 ? (
                      <p className="px-1 pb-1 text-xs text-gray-500">ไม่มีรายการ</p>
                    ) : (
                      <div className={clsx('grid gap-3', layout.list)}>
                        {capped.map(it => (
                          <DeliverableCard
                            key={it.id}
                            item={it}
                            today={today}
                            editorColor={it.editor_crew_id ? crewById.get(it.editor_crew_id)?.color ?? null : null}
                            busy={busyIds.has(it.id)}
                            disabled={stale}
                            onMove={next => void move(it, next)}
                            onEdit={() => setDialog({ item: it, mode: 'edit' })}
                          />
                        ))}
                      </div>
                    )}
                    {capped.length < group.length && (
                      <button
                        type="button"
                        onClick={() => setDeliveredShown(n => n + DELIVERED_PAGE)}
                        className="btn-secondary w-full"
                      >
                        แสดงเพิ่มอีก {fmtCount(Math.min(DELIVERED_PAGE, group.length - capped.length))} รายการ
                      </button>
                    )}
                  </section>
                )
              })}
            </div>
          )}
        </div>
      )}

      {dialog && (
        <DeliverableDialog
          key={`${dialog.item.id}-${dialog.mode}`}
          item={dialog.item}
          mode={dialog.mode}
          crew={crew}
          supabase={supabase}
          onClose={() => setDialog(null)}
          onSaved={handleDialogSaved}
          onDeleted={handleDialogDeleted}
        />
      )}

      <Toast toast={toast} onClose={closeToast} />
    </div>
  )
}
