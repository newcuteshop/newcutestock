'use client'
// ค่าตัวทีมงาน (เฉพาะผู้จัดการ) — wed_crew_payouts(p_from, p_to) ตามวันคิวงาน (งานที่กันคิว ไม่นับคิวที่ยกเลิก) แยกรายคน
// ติ๊กเลือกรายการที่ค้างจ่าย → "บันทึกจ่ายแล้ว" (wed_mark_crew_paid ครั้งละไม่เกิน 500 รายการ) · รายการที่จ่ายแล้ว "ยกเลิกการจ่าย" ได้
// บันทึกจ่ายซ้ำปลอดภัย (ตั้งวันที่จ่ายค่าเดิม = ไม่เปลี่ยนอะไร) → ไม่รู้ผล (เน็ตหลุด) = โหลดรายการใหม่แล้วกดซ้ำได้เลย
// ประวัติงานจดแค่ว่าใคร/คิวไหน/วันที่จ่าย ไม่จดจำนวนเงิน (พนักงานอ่านประวัติงานได้)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import {
  AlertCircle, AlertTriangle, Banknote, CalendarRange, CheckCircle2, ChevronDown, ChevronUp, Copy, Loader2, RefreshCw,
  Undo2, Wallet,
} from 'lucide-react'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { addDaysToKey, baht, bangkokTodayKey, daysBetweenKeys, formatThaiDate, formatThaiDayLong, isDayKey } from '@/lib/format'
import { round2 } from '@/lib/money'
import {
  crewDisplayName, crewRoleLabel, parseCrewPayouts, parseMarkCrewPaidResult, WED_STATUS_SHORT,
  type WedCrewPayout, type WedCrewPayoutLine, type WedCrewPayouts,
} from '@/lib/wedding'
import ConfirmDialog from '@/components/integrations/ConfirmDialog'
import type { ToastValue } from '@/components/wedding/settings/PageToast'
import { callRpc, copyText, wedErrorText } from '@/components/wedding/settings/wedRpc'
import CrewAvatar from './CrewAvatar'
import { addMonths, lineKey, monthOf, monthRange, payoutLineText, shortDay } from './crewModel'

const MAX_DAYS = 366
const MARK_CHUNK = 500

type PresetKey = 'month' | 'prevMonth' | 'nextMonth' | '30d'
const PRESETS: readonly { key: PresetKey; label: string }[] = [
  { key: 'prevMonth', label: 'เดือนก่อน' },
  { key: 'month', label: 'เดือนนี้' },
  { key: 'nextMonth', label: 'เดือนหน้า' },
  { key: '30d', label: '30 วันล่าสุด' },
]

type Filter = 'all' | 'unpaid' | 'paid'
const FILTERS: readonly { key: Filter; label: string }[] = [
  { key: 'unpaid', label: 'ค้างจ่าย' },
  { key: 'paid', label: 'จ่ายแล้ว' },
  { key: 'all', label: 'ทั้งหมด' },
]

function presetRange(key: PresetKey, today: string): { from: string; to: string } {
  const m = monthOf(today)
  switch (key) {
    case 'prevMonth':
      return monthRange(addMonths(m, -1))
    case 'nextMonth':
      return monthRange(addMonths(m, 1))
    case '30d':
      return { from: addDaysToKey(today, -29), to: today }
    case 'month':
    default:
      return monthRange(m)
  }
}

function rangeProblem(from: string, to: string): string | null {
  if (!isDayKey(from)) return 'กรุณาเลือกวันที่เริ่มต้น'
  if (!isDayKey(to)) return 'กรุณาเลือกวันที่สิ้นสุด'
  if (from > to) return 'วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด'
  const days = daysBetweenKeys(from, to) + 1
  if (days > MAX_DAYS) return `เลือกช่วงได้ไม่เกิน 1 ปี — ตอนนี้เลือกไว้ ${days.toLocaleString('en-US')} วัน`
  return null
}

function lineVisible(l: WedCrewPayoutLine, f: Filter): boolean {
  if (f === 'unpaid') return l.fee_paid_on === null
  if (f === 'paid') return l.fee_paid_on !== null
  return true
}

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Wallet; tone?: 'warn' | 'ok' }) {
  return (
    <div className="stat-card">
      <div className="flex items-start justify-between gap-2">
        <span className="stat-label min-w-0 pt-1">{label}</span>
        <span className={clsx('icon-bubble', tone === 'warn' && 'icon-bubble-warn', tone === 'ok' && 'icon-bubble-ok')}>
          <Icon {...ICON} />
        </span>
      </div>
      <p className="stat-value"><span className="whitespace-nowrap">{value}</span></p>
    </div>
  )
}

export default function CrewPayouts({ today: initialToday, onMessage }: { today: string; onMessage: (t: ToastValue) => void }) {
  const supabase = useMemo(() => createClient(), [])
  const [today, setToday] = useState(initialToday)
  const initialRange = useMemo(() => presetRange('month', initialToday), [initialToday])
  const [range, setRange] = useState(initialRange)
  const [draftFrom, setDraftFrom] = useState(initialRange.from)
  const [draftTo, setDraftTo] = useState(initialRange.to)
  const [data, setData] = useState<{ from: string; to: string; value: WedCrewPayouts } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('unpaid')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [paidOn, setPaidOn] = useState(initialToday)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [saveMsg, setSaveMsg] = useState<{ tone: 'err' | 'warn'; text: string } | null>(null)
  const [unpayTarget, setUnpayTarget] = useState<{ crew: WedCrewPayout; line: WedCrewPayoutLine } | null>(null)
  const reqRef = useRef(0)

  const load = useCallback(async (from: string, to: string): Promise<boolean> => {
    const id = ++reqRef.current
    setRange({ from, to })
    setLoading(true)
    setError('')
    const res = await callRpc(supabase, 'wed_crew_payouts', { p_from: from, p_to: to })
    if (id !== reqRef.current) return false
    setLoading(false)
    if (!res.ok) {
      setError(wedErrorText(res.error))
      return false
    }
    const value = parseCrewPayouts(res.data)
    setData({ from, to, value })
    // ตัดรายการที่เลือกไว้ซึ่งไม่ค้างจ่ายแล้ว/ไม่อยู่ในช่วงใหม่
    const unpaid = new Set<string>()
    for (const c of value.crew) for (const l of c.lines) if (l.fee_paid_on === null) unpaid.add(lineKey(l.session_id, c.crew_id))
    setSelected(prev => new Set(Array.from(prev).filter(k => unpaid.has(k))))
    return true
  }, [supabase])

  useEffect(() => {
    void load(initialRange.from, initialRange.to)
  }, [load, initialRange])

  // ทิ้งหน้าไว้ข้ามเที่ยงคืน → "วันนี้" ของปุ่มลัด/วันที่จ่ายเลื่อนตาม
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') setToday(bangkokTodayKey())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  function apply(from: string, to: string) {
    setDraftFrom(from)
    setDraftTo(to)
    if (rangeProblem(from, to)) return
    setSaveMsg(null)
    void load(from, to)
  }

  // ระหว่างโหลดช่วงใหม่ แสดงของเดิมแบบจาง (aria-busy) แทนหน้าว่าง
  const shown = data?.value ?? null
  const draftProblem = rangeProblem(draftFrom, draftTo)
  const activePreset = PRESETS.find(p => {
    const r = presetRange(p.key, today)
    return r.from === range.from && r.to === range.to
  })?.key ?? null

  // รายการที่เลือก (เฉพาะที่ยังค้างจ่าย) + ยอดรวม
  const selection = useMemo(() => {
    const items: { session_id: string; crew_id: string; fee: number }[] = []
    if (shown) {
      for (const c of shown.crew) {
        for (const l of c.lines) {
          if (l.fee_paid_on === null && selected.has(lineKey(l.session_id, c.crew_id))) {
            items.push({ session_id: l.session_id, crew_id: c.crew_id, fee: l.fee })
          }
        }
      }
    }
    return { items, total: round2(items.reduce((s, x) => s + x.fee, 0)) }
  }, [shown, selected])

  function toggleLine(key: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function unpaidKeys(c: WedCrewPayout): string[] {
    return c.lines.filter(l => l.fee_paid_on === null).map(l => lineKey(l.session_id, c.crew_id))
  }

  function toggleCrew(c: WedCrewPayout, on: boolean) {
    const keys = unpaidKeys(c)
    setSelected(prev => {
      const next = new Set(prev)
      for (const k of keys) {
        if (on) next.add(k)
        else next.delete(k)
      }
      return next
    })
  }

  function selectAllUnpaid() {
    if (!shown) return
    const all = new Set<string>()
    for (const c of shown.crew) for (const k of unpaidKeys(c)) all.add(k)
    setSelected(all)
  }

  // ส่งรายการเป็นชุด (ไม่เกิน 500 ต่อครั้ง) — ชุดก่อนหน้าที่สำเร็จแล้วไม่ย้อนกลับ (บันทึกซ้ำได้ ไม่เพี้ยน)
  async function markItems(items: { session_id: string; crew_id: string; paid_on: string | null }[]): Promise<
    { ok: true; updated: number } | { ok: false; message: string; unsure: boolean }
  > {
    let updated = 0
    for (let i = 0; i < items.length; i += MARK_CHUNK) {
      const res = await callRpc(supabase, 'wed_mark_crew_paid', { p_items: items.slice(i, i + MARK_CHUNK) })
      if (!res.ok) return { ok: false, message: wedErrorText(res.error), unsure: !res.answered }
      updated += parseMarkCrewPaidResult(res.data).updated
    }
    return { ok: true, updated }
  }

  async function markPaid() {
    if (savingRef.current || selection.items.length === 0) return
    const t = bangkokTodayKey()
    if (!isDayKey(paidOn)) {
      setSaveMsg({ tone: 'err', text: 'กรุณาเลือกวันที่จ่ายค่าตัว' })
      return
    }
    if (paidOn > t) {
      setSaveMsg({ tone: 'err', text: 'วันที่จ่ายค่าตัวต้องไม่เป็นวันในอนาคต' })
      return
    }
    savingRef.current = true
    setSaving(true)
    setSaveMsg(null)
    const count = selection.items.length
    const total = selection.total
    try {
      const r = await markItems(selection.items.map(x => ({ session_id: x.session_id, crew_id: x.crew_id, paid_on: paidOn })))
      const reloaded = await load(range.from, range.to)
      if (r.ok) {
        setSelected(new Set())
        onMessage({ ok: true, text: `บันทึกจ่ายค่าตัวแล้ว ${count.toLocaleString('en-US')} รายการ ${baht(total)} (วันที่ ${formatThaiDate(paidOn)})` })
        return
      }
      setSaveMsg({
        tone: r.unsure ? 'warn' : 'err',
        text: r.unsure
          ? `ไม่แน่ใจว่าบันทึกครบหรือยัง (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — ${reloaded ? 'โหลดรายการล่าสุดแล้ว ' : ''}ตรวจรายการที่ยังค้างแล้วกดบันทึกอีกครั้งได้ ระบบไม่บันทึกซ้ำ`
          : r.message,
      })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  async function confirmUnpay() {
    const target = unpayTarget
    if (!target || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setSaveMsg(null)
    try {
      const r = await markItems([{ session_id: target.line.session_id, crew_id: target.crew.crew_id, paid_on: null }])
      await load(range.from, range.to)
      setUnpayTarget(null)
      if (r.ok) {
        onMessage({ ok: true, text: `ยกเลิกการจ่ายค่าตัวของ ${crewDisplayName(target.crew)} (${shortDay(target.line.date)}) แล้ว` })
      } else {
        setSaveMsg({ tone: r.unsure ? 'warn' : 'err', text: r.unsure ? 'ไม่แน่ใจว่ายกเลิกแล้วหรือยัง — ดูสถานะล่าสุดในรายการ แล้วลองอีกครั้งได้' : r.message })
      }
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  async function copyCrew(c: WedCrewPayout) {
    if (!shown) return
    const ok = await copyText(payoutLineText(c, data?.from ?? range.from, data?.to ?? range.to))
    onMessage(ok
      ? { ok: true, text: `คัดลอกสรุปค่าตัวของ ${crewDisplayName(c)} แล้ว` }
      : { ok: false, text: 'คัดลอกไม่สำเร็จ — เบราว์เซอร์นี้ไม่อนุญาตให้คัดลอกอัตโนมัติ' })
  }

  const visibleCrew = shown
    ? shown.crew.filter(c => filter === 'all' || c.lines.some(l => lineVisible(l, filter)))
    : []
  const totals = shown?.totals ?? null
  const viewFrom = data?.from ?? range.from
  const viewTo = data?.to ?? range.to
  const rangeText = `${formatThaiDate(viewFrom)}${viewTo !== viewFrom ? ` – ${formatThaiDate(viewTo)}` : ''}`

  return (
    <div className="space-y-4">
      {/* ===== ช่วงวันที่ ===== */}
      <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="wcp-range-title">
        <h2 id="wcp-range-title" className="section-title">
          <CalendarRange {...ICON} />
          ช่วงวันที่ของคิวงาน
        </h2>
        <div className="flex flex-wrap gap-2" role="group" aria-label="ช่วงวันที่ลัด">
          {PRESETS.map(p => (
            <button
              key={p.key}
              type="button"
              className="chip-toggle"
              aria-pressed={activePreset === p.key}
              onClick={() => {
                const t = bangkokTodayKey()
                setToday(t)
                const r = presetRange(p.key, t)
                apply(r.from, r.to)
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={e => { e.preventDefault(); apply(draftFrom, draftTo) }}
          noValidate
        >
          <div className="min-w-0">
            <label htmlFor="wcp-from" className="field-label">ตั้งแต่วันที่</label>
            <input
              id="wcp-from"
              type="date"
              className="input tabular-nums"
              value={draftFrom}
              onChange={e => setDraftFrom(e.target.value)}
              aria-describedby="wcp-from-be"
            />
            <p id="wcp-from-be" className="field-hint">{isDayKey(draftFrom) ? formatThaiDayLong(draftFrom) : '-'}</p>
          </div>
          <div className="min-w-0">
            <label htmlFor="wcp-to" className="field-label">ถึงวันที่</label>
            <input
              id="wcp-to"
              type="date"
              className="input tabular-nums"
              value={draftTo}
              onChange={e => setDraftTo(e.target.value)}
              aria-describedby="wcp-to-be"
            />
            <p id="wcp-to-be" className="field-hint">{isDayKey(draftTo) ? formatThaiDayLong(draftTo) : '-'}</p>
          </div>
          <div className="sm:pb-6">
            <button type="submit" disabled={!!draftProblem || loading} className="btn-primary w-full sm:w-auto">
              {loading ? <RefreshCw {...ICON_SM} className="animate-spin" /> : <Banknote {...ICON_SM} />}
              {draftFrom !== range.from || draftTo !== range.to ? 'ดูค่าตัว' : 'โหลดใหม่'}
            </button>
          </div>
        </form>
        {draftProblem && (draftFrom !== '' || draftTo !== '') && (
          <p role="alert" className="text-sm text-red-700">{draftProblem}</p>
        )}
      </section>

      {error && !shown ? (
        <div role="alert" className="alert-err">
          <AlertCircle {...ICON_SM} />
          <div className="min-w-0 space-y-2">
            <p className="break-words">{error}</p>
            <button type="button" onClick={() => void load(range.from, range.to)} className="btn-secondary bg-white px-4 text-sm">
              <RefreshCw {...ICON_SM} />
              ลองอีกครั้ง
            </button>
          </div>
        </div>
      ) : !shown || !totals ? (
        <div className="space-y-3" role="status">
          <span className="sr-only">กำลังโหลดค่าตัวทีมงาน...</span>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="stat-card">
                <div className="skeleton h-4 w-20" />
                <div className="skeleton h-7 w-24" />
              </div>
            ))}
          </div>
          {[0, 1].map(i => <div key={i} className="skeleton h-28 rounded-lg" />)}
        </div>
      ) : (
        <div className={clsx('space-y-4', loading && 'opacity-60')} aria-busy={loading}>
          <p className="text-sm text-gray-600">คิวงานวันที่ {rangeText}</p>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard label="ค่าตัวรวม" value={baht(totals.fees)} icon={Wallet} />
            <StatCard label="ค้างจ่าย" value={baht(totals.unpaid)} icon={AlertTriangle} tone={totals.unpaid > 0 ? 'warn' : undefined} />
            <StatCard label="จ่ายแล้ว" value={baht(totals.paid)} icon={CheckCircle2} tone="ok" />
            <StatCard label="จำนวนคิว" value={`${totals.sessions.toLocaleString('en-US')} คิว`} icon={CalendarRange} />
          </div>

          {error && (
            <div role="alert" className="alert-err">
              <AlertCircle {...ICON_SM} />
              <p className="min-w-0 break-words">{error}</p>
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2" role="group" aria-label="กรองรายการ">
              {FILTERS.map(f => (
                <button
                  key={f.key}
                  type="button"
                  className="chip-toggle"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {totals.unpaid > 0 && (
              <button type="button" onClick={selectAllUnpaid} disabled={saving} className="btn-secondary w-full sm:w-auto">
                เลือกที่ค้างจ่ายทั้งหมด
              </button>
            )}
          </div>

          {visibleCrew.length === 0 ? (
            <div className="empty-state card">
              <Wallet size={28} strokeWidth={1.6} aria-hidden="true" className="text-gray-400" />
              <p className="empty-state-title">
                {shown.crew.length === 0 ? 'ไม่มีคิวงานของทีมในช่วงนี้' : filter === 'unpaid' ? 'จ่ายค่าตัวครบทุกคนแล้ว' : 'ไม่มีรายการ'}
              </p>
              <p>ค่าตัวนับจากคิวงานของงานที่ล็อกคิว/ยืนยันแล้วขึ้นไป (ไม่นับคิวที่ยกเลิก)</p>
            </div>
          ) : (
            <ul className="space-y-3" aria-label="ค่าตัวแยกรายคน">
              {visibleCrew.map(c => {
                const keys = unpaidKeys(c)
                const picked = keys.filter(k => selected.has(k)).length
                const allPicked = keys.length > 0 && picked === keys.length
                const isCollapsed = collapsed[c.crew_id] === true
                const lines = c.lines.filter(l => lineVisible(l, filter))
                const panelId = `wcp-lines-${c.crew_id}`
                return (
                  <li key={c.crew_id} className="card min-w-0">
                    <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                      <CrewAvatar crew={c} />
                      <div className="min-w-[9rem] flex-1">
                        <p className="font-semibold text-gray-900 break-words">{crewDisplayName(c)}</p>
                        <p className="text-sm text-gray-600">
                          {crewRoleLabel(c.role)} · {c.sessions.toLocaleString('en-US')} คิว
                          {!c.is_active && ' · ปิดใช้งานแล้ว'}
                        </p>
                      </div>
                      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        <div>
                          <dt className="text-xs text-gray-500">รวม</dt>
                          <dd className="money text-gray-900">{baht(c.fees)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-gray-500">ค้างจ่าย</dt>
                          <dd className={clsx('money', c.unpaid > 0 ? 'text-amber-800' : 'text-gray-900')}>{baht(c.unpaid)}</dd>
                        </div>
                      </dl>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 border-t border-gray-150 px-4 py-2 sm:px-5">
                      {keys.length > 0 && (
                        <label className="inline-flex min-h-[44px] cursor-pointer select-none items-center gap-2 text-sm font-medium text-gray-800">
                          <input
                            type="checkbox"
                            className="h-5 w-5 shrink-0 accent-brand-600"
                            checked={allPicked}
                            ref={el => { if (el) el.indeterminate = picked > 0 && !allPicked }}
                            disabled={saving}
                            onChange={e => toggleCrew(c, e.target.checked)}
                          />
                          เลือกที่ค้างจ่าย ({keys.length.toLocaleString('en-US')})
                        </label>
                      )}
                      <div className="ml-auto flex items-center gap-1">
                        <button type="button" onClick={() => void copyCrew(c)} className="btn-icon btn-icon-plain" aria-label={`คัดลอกสรุปค่าตัวของ ${crewDisplayName(c)}`} title="คัดลอกสรุป (ส่ง LINE)">
                          <Copy {...ICON_SM} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setCollapsed(s => ({ ...s, [c.crew_id]: !isCollapsed }))}
                          className="btn-icon btn-icon-plain"
                          aria-expanded={!isCollapsed}
                          aria-controls={panelId}
                          aria-label={isCollapsed ? `แสดงรายการของ ${crewDisplayName(c)}` : `ซ่อนรายการของ ${crewDisplayName(c)}`}
                        >
                          {isCollapsed ? <ChevronDown {...ICON_SM} /> : <ChevronUp {...ICON_SM} />}
                        </button>
                      </div>
                    </div>
                    {!isCollapsed && (
                      <ul id={panelId} className="divide-y divide-gray-150 border-t border-gray-150">
                        {lines.map(l => {
                          const key = lineKey(l.session_id, c.crew_id)
                          const paid = l.fee_paid_on !== null
                          const inputId = `wcp-${key.replace(/[^a-z0-9]/gi, '')}`
                          return (
                            <li key={key} className={clsx('flex items-start gap-3 px-4 py-2.5 sm:px-5', paid && 'bg-gray-50')}>
                              {paid ? (
                                <span className="grid h-11 w-6 shrink-0 place-items-center text-green-700" aria-hidden="true">
                                  <CheckCircle2 {...ICON_SM} />
                                </span>
                              ) : (
                                <span className="grid h-11 w-6 shrink-0 place-items-center">
                                  <input
                                    id={inputId}
                                    type="checkbox"
                                    className="h-5 w-5 accent-brand-600"
                                    checked={selected.has(key)}
                                    disabled={saving}
                                    onChange={() => toggleLine(key)}
                                    aria-label={`เลือก ${shortDay(l.date)} ${l.couple_names || l.booking_no} ${baht(l.fee)}`}
                                  />
                                </span>
                              )}
                              <div className="min-w-0 flex-1 py-1">
                                <p className="text-sm font-medium text-gray-900 break-words">
                                  {shortDay(l.date)} · {l.type_label} · {l.couple_names || l.booking_no}
                                </p>
                                <p className="text-xs text-gray-600 break-words">
                                  {crewRoleLabel(l.role)}
                                  {l.booking_no && (
                                    <>
                                      {' · '}
                                      <Link href={`/wedding/bookings/${l.booking_id}`} className="relative font-medium text-brand-700 underline-offset-4 hover:underline after:absolute after:-inset-y-3 after:inset-x-0 after:content-['']">
                                        {l.booking_no}
                                      </Link>
                                    </>
                                  )}
                                  {' · '}{WED_STATUS_SHORT[l.booking_status]}
                                  {l.session_status === 'done' ? ' · ถ่ายแล้ว' : l.session_status === 'cancelled' ? ' · คิวยกเลิก' : ''}
                                </p>
                              </div>
                              <div className="shrink-0 py-1 text-right">
                                <p className="money text-sm text-gray-900">{baht(l.fee)}</p>
                                {paid ? (
                                  <button
                                    type="button"
                                    onClick={() => { setSaveMsg(null); setUnpayTarget({ crew: c, line: l }) }}
                                    disabled={saving}
                                    className="inline-flex min-h-[36px] items-center gap-1 text-xs text-gray-600 underline-offset-4 hover:underline"
                                    aria-label={`จ่ายแล้ว ${formatThaiDate(l.fee_paid_on)} — ยกเลิกการจ่าย`}
                                  >
                                    <Undo2 {...ICON_XS} />
                                    จ่าย {formatThaiDate(l.fee_paid_on)}
                                  </button>
                                ) : (
                                  <p className="text-xs text-amber-800">ค้างจ่าย</p>
                                )}
                              </div>
                            </li>
                          )
                        })}
                        {lines.length === 0 && <li className="px-4 py-3 text-sm text-gray-500 sm:px-5">ไม่มีรายการตามตัวกรองนี้</li>}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {saveMsg && (
            <div role="alert" className={saveMsg.tone === 'err' ? 'alert-err' : 'alert-warn'}>
              {saveMsg.tone === 'err' ? <AlertCircle {...ICON_SM} /> : <AlertTriangle {...ICON_SM} />}
              <p className="min-w-0 break-words">{saveMsg.text}</p>
            </div>
          )}

          {/* แถบบันทึกจ่าย (ติดล่างจอเมื่อเลือกรายการ) */}
          {selection.items.length > 0 && (
            <div className="sticky bottom-3 z-10 card p-3 sm:p-4" role="region" aria-label="บันทึกจ่ายค่าตัว">
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900">
                    เลือก {selection.items.length.toLocaleString('en-US')} รายการ · <span className="money">{baht(selection.total)}</span>
                  </p>
                  <button type="button" onClick={() => setSelected(new Set())} disabled={saving} className="link min-h-[36px] text-sm">
                    ล้างที่เลือก
                  </button>
                </div>
                <div className="min-w-0 md:w-48">
                  <label htmlFor="wcp-paid-on" className="field-label">วันที่จ่าย</label>
                  <input
                    id="wcp-paid-on"
                    type="date"
                    className="input tabular-nums"
                    value={paidOn}
                    max={today}
                    disabled={saving}
                    onChange={e => setPaidOn(e.target.value)}
                  />
                </div>
                <button type="button" onClick={() => void markPaid()} disabled={saving} className="btn-primary w-full md:w-auto md:min-w-[180px]">
                  {saving ? <Loader2 {...ICON_SM} className="animate-spin" /> : <CheckCircle2 {...ICON_SM} />}
                  {saving ? 'กำลังบันทึก...' : 'บันทึกจ่ายแล้ว'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={unpayTarget !== null}
        title="ยกเลิกการจ่ายค่าตัว"
        confirmLabel="ยกเลิกการจ่าย"
        tone="danger"
        busy={saving}
        onConfirm={() => void confirmUnpay()}
        onCancel={() => { if (!savingRef.current) setUnpayTarget(null) }}
      >
        {unpayTarget && (
          <p>
            {crewDisplayName(unpayTarget.crew)} · {shortDay(unpayTarget.line.date)} · {unpayTarget.line.couple_names || unpayTarget.line.booking_no}
            {' '}<span className="money">{baht(unpayTarget.line.fee)}</span> — กลับเป็น &quot;ค้างจ่าย&quot; (ใช้เมื่อบันทึกจ่ายผิดรายการ)
          </p>
        )}
      </ConfirmDialog>
    </div>
  )
}
