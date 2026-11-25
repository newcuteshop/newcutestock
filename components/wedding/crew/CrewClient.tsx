'use client'
// หน้าทีมงานร้าน b.oncloud: รายชื่อ (ทุกคนในร้านเห็น) · ตารางงานรายคน (ทุกคน) · ค่าตัวทีมงาน (เฉพาะผู้จัดการ)
// พนักงานทั่วไปอ่านทีมผ่าน wed_list_crew เท่านั้น (ฐานข้อมูลไม่ส่งค่าตัวมาให้) — เพิ่ม/แก้ทีมงาน = ผู้จัดการ (wed_save_crew)
// แท็บ/ทีมงาน/เดือนที่ดูอยู่เขียนลง URL (?tab=schedule&crew=<id>&month=YYYY-MM) — ลิงก์จากปฏิทิน/งานเปิดตรงตารางของคนนั้นได้
import { useCallback, useMemo, useState } from 'react'
import clsx from 'clsx'
import { AlertCircle, CalendarDays, Pencil, Phone, Plus, Search, UserPlus, Users, Wallet, X } from 'lucide-react'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { baht } from '@/lib/format'
import {
  CREW_ROLE_LABELS, crewDisplayName, crewRoleLabel, formatPhone, parseCrewList, WED_CREW_ROLES,
  type WedCrew, type WedCrewRole,
} from '@/lib/wedding'
import PageToast, { useToast } from '@/components/wedding/settings/PageToast'
import TabBar, { tabPanelProps } from '@/components/wedding/settings/TabBar'
import { callRpc, rawVersionMap, wedErrorText } from '@/components/wedding/settings/wedRpc'
import CrewAvatar from './CrewAvatar'
import CrewEditorDialog, { type CrewDraft, type CrewWithVersion } from './CrewEditorDialog'
import CrewPayouts from './CrewPayouts'
import CrewSchedule from './CrewSchedule'
import { crewSearchText, isMonthKey, monthOf, pickFreeColor } from './crewModel'

export type CrewTab = 'list' | 'schedule' | 'payouts'
type StatusFilter = 'active' | 'inactive' | 'all'

function sortCrew(list: WedCrew[]): WedCrew[] {
  return list.slice().sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name, 'th'))
}

export default function CrewClient({
  initialCrew,
  initialVersions,
  manager,
  today,
  initialTab,
  initialCrewId,
  initialMonth,
}: {
  initialCrew: WedCrew[]
  initialVersions: Record<string, string>
  manager: boolean
  today: string
  initialTab: CrewTab
  initialCrewId: string | null
  initialMonth: string | null
}) {
  const supabase = useMemo(() => createClient(), [])
  const [crew, setCrew] = useState<WedCrew[]>(() => sortCrew(initialCrew))
  const [versions, setVersions] = useState<Record<string, string>>(initialVersions)
  const [tab, setTab] = useState<CrewTab>(() => (initialTab === 'payouts' && !manager ? 'list' : initialTab))
  const [scheduleCrewId, setScheduleCrewId] = useState<string | null>(() =>
    initialCrewId && initialCrew.some(c => c.id === initialCrewId) ? initialCrewId : null)
  const [month, setMonth] = useState<string>(() => (initialMonth && isMonthKey(initialMonth) ? initialMonth : monthOf(today)))
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('active')
  const [role, setRole] = useState<WedCrewRole | ''>('')
  const [editor, setEditor] = useState<{ target: CrewWithVersion | null } | null>(null)
  const [draft, setDraft] = useState<CrewDraft | null>(null)
  const [listError, setListError] = useState('')
  const [toast, setToast] = useToast()

  // เขียนแท็บ/คน/เดือนลง URL (ไม่โหลดหน้าใหม่)
  const syncUrl = useCallback((t: CrewTab, crewId: string | null, m: string) => {
    try {
      const url = new URL(window.location.href)
      url.search = ''
      if (t !== 'list') url.searchParams.set('tab', t)
      if (t === 'schedule' && crewId) url.searchParams.set('crew', crewId)
      if (t === 'schedule' && m !== monthOf(today)) url.searchParams.set('month', m)
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    } catch {
      // แก้ URL ไม่ได้ ไม่เป็นไร
    }
  }, [today])

  function chooseTab(t: CrewTab) {
    setTab(t)
    syncUrl(t, scheduleCrewId, month)
  }

  function openSchedule(c: WedCrew) {
    setScheduleCrewId(c.id)
    setTab('schedule')
    syncUrl('schedule', c.id, month)
  }

  const reload = useCallback(async (): Promise<{ list: WedCrew[]; versions: Record<string, string> } | null> => {
    const res = await callRpc(supabase, 'wed_list_crew', {})
    if (!res.ok) {
      setListError(wedErrorText(res.error))
      return null
    }
    const list = sortCrew(parseCrewList(res.data))
    const v = rawVersionMap(res.data)
    setCrew(list)
    setVersions(v)
    setListError('')
    return { list, versions: v }
  }, [supabase])

  const reloadOne = useCallback(async (id: string): Promise<CrewWithVersion | null> => {
    const r = await reload()
    if (!r) throw new Error('โหลดรายชื่อทีมงานไม่สำเร็จ')
    const c = r.list.find(x => x.id === id)
    return c ? { crew: c, updatedAt: r.versions[id] ?? null } : null
  }, [reload])

  function onSaved(saved: CrewWithVersion, info: { created: boolean; keepOpen: boolean }) {
    setCrew(prev => sortCrew([...prev.filter(c => c.id !== saved.crew.id), saved.crew]))
    if (saved.updatedAt) setVersions(v => ({ ...v, [saved.crew.id]: saved.updatedAt as string }))
    if (info.keepOpen) return
    setEditor(null)
    setToast({ ok: true, text: info.created ? `เพิ่มทีมงาน ${crewDisplayName(saved.crew)} แล้ว` : `บันทึกข้อมูล ${crewDisplayName(saved.crew)} แล้ว` })
  }

  function closeEditor() {
    setEditor(null)
    if (draft) void reload()
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return crew.filter(c => {
      if (status === 'active' && !c.is_active) return false
      if (status === 'inactive' && c.is_active) return false
      if (role && c.role !== role) return false
      if (q && !crewSearchText(c).includes(q)) return false
      return true
    })
  }, [crew, query, status, role])

  const activeCount = crew.filter(c => c.is_active).length
  const tabs = [
    { key: 'list' as const, label: 'รายชื่อทีมงาน', icon: Users, count: activeCount },
    { key: 'schedule' as const, label: 'ตารางงานรายคน', icon: CalendarDays },
    ...(manager ? [{ key: 'payouts' as const, label: 'ค่าตัวทีมงาน', icon: Wallet }] : []),
  ]

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">ทีมงาน</h1>
          <p className="page-subtitle">
            {manager
              ? 'รายชื่อ หน้าที่ สีประจำตัว ตารางงานรายเดือน และค่าตัวทีมงาน'
              : 'รายชื่อ ช่องทางติดต่อ และตารางงานรายเดือนของทีม'}
          </p>
        </div>
        {manager && (
          <div className="page-actions">
            <button
              type="button"
              onClick={() => setEditor({ target: null })}
              className="btn-primary w-full sm:w-auto"
            >
              <UserPlus {...ICON_SM} />
              {draft ? 'เพิ่มทีมงาน (ร่างค้าง)' : 'เพิ่มทีมงาน'}
            </button>
          </div>
        )}
      </div>

      <TabBar tabs={tabs} value={tab} onChange={chooseTab} idPrefix="wcr" label="หมวดทีมงาน" />

      {tab === 'list' && (
        <div {...tabPanelProps('wcr', 'list')} className="space-y-4">
          <div className="card space-y-3 p-4 sm:p-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_14rem]">
              <div className="relative min-w-0">
                <label htmlFor="wcr-q" className="sr-only">ค้นหาทีมงาน</label>
                <Search {...ICON_SM} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  id="wcr-q"
                  type="search"
                  className="input pl-10 pr-10"
                  placeholder="ค้นหาชื่อ ชื่อเล่น เบอร์ หรือ LINE"
                  autoComplete="off"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="btn-icon btn-icon-plain absolute right-0 top-1/2 -translate-y-1/2"
                    aria-label="ล้างคำค้นหา"
                  >
                    <X {...ICON_SM} />
                  </button>
                )}
              </div>
              <div className="min-w-0">
                <label htmlFor="wcr-role" className="sr-only">หน้าที่</label>
                <select id="wcr-role" className="input" value={role} onChange={e => setRole(e.target.value as WedCrewRole | '')}>
                  <option value="">ทุกหน้าที่</option>
                  {WED_CREW_ROLES.map(r => <option key={r} value={r}>{CREW_ROLE_LABELS[r]}</option>)}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="สถานะทีมงาน">
              {([['active', 'ใช้งานอยู่'], ['inactive', 'ปิดใช้งาน'], ['all', 'ทั้งหมด']] as const).map(([k, label]) => (
                <button key={k} type="button" className="chip-toggle lift-hover lift-tab" aria-pressed={status === k} onClick={() => setStatus(k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {listError && (
            <div role="alert" className="alert-err">
              <AlertCircle {...ICON_SM} />
              <p className="min-w-0 break-words">{listError}</p>
            </div>
          )}

          {crew.length === 0 ? (
            <div className="empty-state card">
              <Users size={28} strokeWidth={1.6} aria-hidden="true" className="text-gray-400" />
              <p className="empty-state-title">ยังไม่มีทีมงาน</p>
              <p>{manager ? 'เพิ่มช่างภาพ ช่างวิดีโอ และผู้ช่วย เพื่อจัดทีมลงคิวงานและดูตารางงานรายคน' : 'ผู้จัดการร้านเป็นผู้เพิ่มรายชื่อทีมงาน'}</p>
              {manager && (
                <button type="button" onClick={() => setEditor({ target: null })} className="btn-primary mt-2 px-4">
                  <Plus {...ICON_SM} />
                  เพิ่มทีมงานคนแรก
                </button>
              )}
            </div>
          ) : filtered.length === 0 ? (
            <p className="panel p-3 text-sm text-gray-500">ไม่พบทีมงานตามที่ค้นหา</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3" aria-label="รายชื่อทีมงาน">
              {filtered.map(c => {
                const tel = c.phone ? c.phone.replace(/\D/g, '') : ''
                return (
                  <li
                    key={c.id}
                    className={clsx('flex min-w-0 flex-col rounded-lg border bg-white', c.is_active ? 'border-gray-200' : 'border-dashed border-gray-300 bg-gray-50')}
                  >
                    <div className="flex flex-1 items-start gap-3 p-4">
                      <CrewAvatar crew={c} size="lg" />
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className={clsx('font-semibold break-words', c.is_active ? 'text-gray-900' : 'text-gray-600')}>{crewDisplayName(c)}</p>
                        <div className="flex flex-wrap gap-1.5">
                          <span className="chip">{crewRoleLabel(c.role)}</span>
                          {!c.is_active && <span className="chip-outline">ปิดใช้งาน</span>}
                        </div>
                        {tel && (
                          <a href={`tel:${tel}`} className="link min-h-[36px] text-sm tabular-nums">
                            <Phone {...ICON_XS} />
                            {formatPhone(c.phone ?? '')}
                          </a>
                        )}
                        {c.line_id && <p className="text-sm text-gray-700 break-words">LINE: {c.line_id}</p>}
                        {manager && c.default_fee !== null && (
                          <p className="text-sm text-gray-700">ค่าตัวเริ่มต้น <span className="money">{baht(c.default_fee)}</span> / คิว</p>
                        )}
                        {c.note && <p className="line-clamp-2 whitespace-pre-line break-words text-xs text-gray-500">{c.note}</p>}
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2 border-t border-gray-150 px-3 py-2">
                      <button type="button" onClick={() => openSchedule(c)} className="btn-secondary px-3">
                        <CalendarDays {...ICON_SM} />
                        ตารางงาน
                      </button>
                      {manager && (
                        <button
                          type="button"
                          onClick={() => setEditor({ target: { crew: c, updatedAt: versions[c.id] ?? null } })}
                          className="btn-secondary px-3"
                        >
                          <Pencil {...ICON_SM} />
                          แก้ไข
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {tab === 'schedule' && (
        <div {...tabPanelProps('wcr', 'schedule')}>
          <CrewSchedule
            crew={crew}
            crewId={scheduleCrewId}
            month={month}
            manager={manager}
            today={today}
            onChange={(id, m) => {
              setScheduleCrewId(id)
              setMonth(m)
              syncUrl('schedule', id, m)
            }}
            onMessage={setToast}
          />
        </div>
      )}

      {tab === 'payouts' && manager && (
        <div {...tabPanelProps('wcr', 'payouts')}>
          <CrewPayouts today={today} onMessage={setToast} />
        </div>
      )}

      {editor && manager && (
        <CrewEditorDialog
          key={editor.target?.crew.id ?? 'new'}
          initial={editor.target}
          draft={editor.target ? null : draft}
          defaultColor={pickFreeColor(crew)}
          onClose={closeEditor}
          onDraft={setDraft}
          reload={reloadOne}
          onSaved={onSaved}
        />
      )}

      <PageToast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}
