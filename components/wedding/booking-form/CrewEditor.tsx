'use client'
// ทีมงานในคิว — เลือกจากรายชื่อทีมงาน (wed_list_crew) + หน้าที่ในคิวนี้ + ค่าตัว (เฉพาะผู้จัดการ)
// ทีมชนคิว (คิวอื่นวันเดียวกันเวลาทับกัน) = เตือนเด่นๆ แต่บันทึกได้ (ข้อมูลจาก wed_quote — ฐานข้อมูลตรวจ)
// ค่าตัวที่จ่ายแล้ว: ล็อกช่อง + ห้ามเอาออกจากคิว (ฐานข้อมูลก็ปฏิเสธ — ยอดจ่ายทีมต้องตรงกับที่จ่ายจริง)
import { useId } from 'react'
import { AlertTriangle, Copy, Lock, Trash2 } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { formatThaiDate } from '@/lib/format'
import {
  CREW_ROLE_LABELS, WED_CREW_ROLES, crewConflictText, crewDisplayName, type WedCrew, type WedCrewConflict, type WedCrewRole,
} from '@/lib/wedding'
import { MAX_CREW_PER_SESSION, newCrewDraft, type CrewDraft } from './model'
import { MoneyInput } from './fields'

export default function CrewEditor({
  crew,
  crewList,
  crewError,
  errors,
  conflicts,
  manager,
  copyFrom,
  onChange,
  mk,
  disabled,
}: {
  crew: CrewDraft[]
  crewList: readonly WedCrew[]
  crewError: string
  errors: Record<string, string>
  conflicts: readonly WedCrewConflict[]
  manager: boolean
  /** ทีมของคิวแรก (คัดลอกมาคิวนี้ได้) — null = ไม่มี/คิวนี้คือคิวแรก */
  copyFrom: { label: string; crew: CrewDraft[] } | null
  onChange: (crew: CrewDraft[]) => void
  mk: () => string
  disabled?: boolean
}) {
  const uid = useId()
  const inSession = new Set(crew.map(c => c.crew_id))
  const options = crewList.filter(c => c.is_active && !inSession.has(c.id))
  const full = crew.length >= MAX_CREW_PER_SESSION

  function set(key: string, p: Partial<CrewDraft>) {
    onChange(crew.map(c => (c.key === key ? { ...c, ...p } : c)))
  }

  function add(id: string) {
    const c = crewList.find(x => x.id === id)
    if (!c || inSession.has(id) || full) return
    onChange([...crew, newCrewDraft(mk(), c, manager)])
  }

  function copy() {
    if (!copyFrom) return
    const next = [...crew]
    for (const c of copyFrom.crew) {
      if (next.length >= MAX_CREW_PER_SESSION) break
      if (next.some(x => x.crew_id === c.crew_id)) continue
      const src = crewList.find(x => x.id === c.crew_id)
      // ทีมที่ปิดใช้งานแล้วเพิ่มลงคิวใหม่ไม่ได้ (ฐานข้อมูลปฏิเสธ)
      if (src && !src.is_active) continue
      next.push({ ...c, key: mk(), fee_paid_on: null, fee: manager ? c.fee : '' })
    }
    onChange(next)
  }

  const byCrew = new Map<string, WedCrewConflict[]>()
  for (const c of conflicts) {
    const list = byCrew.get(c.crew_id) ?? []
    list.push(c)
    byCrew.set(c.crew_id, list)
  }

  return (
    <div className="space-y-2">
      {crew.length === 0 ? (
        <p className="text-sm text-gray-500">ยังไม่ได้จัดทีมงาน — จัดทีมทีหลังได้</p>
      ) : (
        <ul className="space-y-2">
          {crew.map((c, i) => {
            const roleId = `${uid}-role${i}`
            const feeId = `${uid}-fee${i}`
            const cf = byCrew.get(c.crew_id) ?? []
            const err = errors[c.key]
            const paid = !!c.fee_paid_on
            const src = crewList.find(x => x.id === c.crew_id)
            const defaultFee = src?.default_fee ?? null
            return (
              <li key={c.key} className={cf.length > 0 ? 'panel border-red-300 p-2.5 space-y-2' : 'panel p-2.5 space-y-2'}>
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                  <p className="min-w-0 flex-1 text-sm font-semibold text-gray-900 break-words">
                    {crewDisplayName({ name: src?.name ?? c.name, nickname: src?.nickname ?? c.nickname })}
                    {src && !src.is_active && <span className="chip-outline ml-1.5 align-middle">ปิดใช้งาน</span>}
                  </p>
                  <button
                    type="button"
                    className="btn-icon btn-icon-plain shrink-0"
                    onClick={() => onChange(crew.filter(x => x.key !== c.key))}
                    disabled={disabled || paid}
                    aria-label={paid ? 'จ่ายค่าตัวแล้ว นำออกจากคิวไม่ได้' : `เอา ${c.nickname || c.name} ออกจากคิว`}
                    title={paid ? 'จ่ายค่าตัวแล้ว นำออกจากคิวไม่ได้' : undefined}
                  >
                    {paid ? <Lock {...ICON_SM} /> : <Trash2 {...ICON_SM} />}
                  </button>
                </div>
                <div className={manager ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1 gap-2'}>
                  <div className="min-w-0">
                    <label htmlFor={roleId} className="sr-only">หน้าที่ในคิวนี้</label>
                    <select
                      id={roleId}
                      className="input"
                      value={c.role}
                      disabled={disabled}
                      onChange={e => {
                        const v = e.target.value
                        if ((WED_CREW_ROLES as readonly string[]).includes(v)) set(c.key, { role: v as WedCrewRole })
                      }}
                    >
                      {WED_CREW_ROLES.map(r => <option key={r} value={r}>{CREW_ROLE_LABELS[r]}</option>)}
                    </select>
                  </div>
                  {manager && (
                    <div className="min-w-0">
                      <label htmlFor={feeId} className="sr-only">ค่าตัวคิวนี้ (บาท)</label>
                      <MoneyInput
                        id={feeId}
                        value={c.fee}
                        onChange={v => set(c.key, { fee: v })}
                        disabled={disabled || paid}
                        error={err}
                        placeholder={defaultFee !== null ? `ค่าตัว ${defaultFee}` : 'ค่าตัว'}
                      />
                    </div>
                  )}
                </div>
                {paid && manager && (
                  <p className="text-xs text-gray-500">จ่ายค่าตัวแล้ว {formatThaiDate(c.fee_paid_on)} — แก้ค่าตัวไม่ได้</p>
                )}
                {err && <p id={`${feeId}-err`} role="alert" className="text-sm font-medium text-red-700">{err}</p>}
                {cf.map((x, j) => (
                  <p key={j} role="alert" className="flex items-start gap-1.5 text-sm font-medium text-red-700">
                    <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
                    <span className="min-w-0 break-words">{crewConflictText(x)}</span>
                  </p>
                ))}
              </li>
            )
          })}
        </ul>
      )}
      {errors._all && <p role="alert" className="text-sm font-medium text-red-700">{errors._all}</p>}

      {crewError ? (
        <p className="text-sm text-red-700" role="alert">{crewError}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 basis-56">
            <label htmlFor={`${uid}-add`} className="sr-only">เพิ่มทีมงานลงคิวนี้</label>
            <select
              id={`${uid}-add`}
              className="input"
              value=""
              disabled={disabled || full || options.length === 0}
              onChange={e => add(e.target.value)}
            >
              <option value="">
                {crewList.length === 0 ? 'ยังไม่มีรายชื่อทีมงาน (เพิ่มที่เมนูทีมงาน)' : options.length === 0 ? 'เลือกทีมงานครบทุกคนแล้ว' : '+ เพิ่มทีมงานลงคิวนี้'}
              </option>
              {options.map(c => (
                <option key={c.id} value={c.id}>
                  {crewDisplayName(c)} · {CREW_ROLE_LABELS[c.role]}
                </option>
              ))}
            </select>
          </div>
          {copyFrom && copyFrom.crew.length > 0 && (
            <button type="button" className="btn-ghost px-3 text-sm" onClick={copy} disabled={disabled || full}>
              <Copy {...ICON_SM} />
              ใช้ทีมเดียวกับ{copyFrom.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
