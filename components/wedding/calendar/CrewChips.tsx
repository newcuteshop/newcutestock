// ป้ายทีมงานในคิว: จุดสีประจำตัว + ชื่อเล่น (หรือชื่อ) + หน้าที่ — สีเป็นแค่ตัวช่วยจำ มีชื่อกำกับเสมอ
// ค่าตัว (fee) ฐานข้อมูลส่งมาเฉพาะผู้จัดการ → null = ไม่แสดง (ไม่ใช่ 0) · ใช้ได้ทั้ง server และ client component
import clsx from 'clsx'
import { Users } from 'lucide-react'
import { ICON_XS } from '@/components/theme/icons'
import { baht } from '@/lib/format'
import { crewRoleLabel, type WedSessionCrew } from '@/lib/wedding'

type CrewLike = Pick<WedSessionCrew, 'crew_id' | 'name' | 'nickname' | 'role' | 'color'> & { fee?: number | null }

export function crewShortName(c: { name: string; nickname?: string | null }): string {
  return (c.nickname ?? '').trim() || (c.name ?? '').trim() || 'ทีมงาน'
}

export default function CrewChips({
  crew,
  showFee = false,
  emptyText = 'ยังไม่ได้จัดทีมงาน',
  conflictIds,
  className,
}: {
  crew: readonly CrewLike[]
  /** แสดงค่าตัวต่อคิว (เฉพาะเมื่อฐานข้อมูลส่งมา = ผู้จัดการ) */
  showFee?: boolean
  emptyText?: string
  /** ทีมงานที่ชนคิว → ขอบแดง + คำว่า "ชนคิว" */
  conflictIds?: ReadonlySet<string>
  className?: string
}) {
  if (crew.length === 0) {
    return (
      <p className={clsx('inline-flex items-center gap-1.5 text-xs font-medium text-amber-800', className)}>
        <Users {...ICON_XS} />
        {emptyText}
      </p>
    )
  }
  return (
    <ul className={clsx('flex flex-wrap gap-1.5', className)} aria-label="ทีมงาน">
      {crew.map(c => {
        const clash = conflictIds?.has(c.crew_id) ?? false
        return (
          <li
            key={c.crew_id}
            className={clsx(
              'inline-flex min-h-[28px] max-w-full items-center gap-1.5 rounded-full border bg-white py-0.5 pl-2 pr-2.5 text-xs',
              clash ? 'border-red-300 text-red-800' : 'border-gray-200 text-gray-800',
            )}
          >
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
            <span className="min-w-0 truncate font-medium">{crewShortName(c)}</span>
            <span className={clsx('shrink-0', clash ? 'text-red-700' : 'text-gray-500')}>{crewRoleLabel(c.role)}</span>
            {showFee && typeof c.fee === 'number' && (
              <span className="shrink-0 tabular-nums text-gray-600">· {baht(c.fee)}</span>
            )}
            {clash && <span className="shrink-0 font-semibold text-red-700">· ชนคิว</span>}
          </li>
        )
      })}
    </ul>
  )
}
