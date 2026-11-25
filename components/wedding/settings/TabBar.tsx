'use client'
// แถบแท็บของหน้าตั้งค่า/ทีมงาน (role=tablist) — ปุ่มหน้าตาเดียวกับ .chip-toggle, มือถือขึ้นบรรทัดใหม่ได้ ไม่เลื่อนข้าง
// ลูกศรซ้าย/ขวา/Home/End สลับแท็บ (แบบแผน tablist มาตรฐาน) · dot = มีที่แก้ค้าง (จุดสีส้ม + ข้อความสำหรับโปรแกรมอ่านจอ)
// แผงเนื้อหาของแท็บต้องมี id = `${idPrefix}-panel-${key}` + role="tabpanel" + aria-labelledby = `${idPrefix}-tab-${key}`
import type { KeyboardEvent } from 'react'
import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'

// แท็บที่เลือก = สีเดียวกับ .chip-toggle[aria-pressed='true'] (แท็บใช้ aria-selected ตามบทบาท tab จึงใส่สีตรงนี้แทน)
const ACTIVE_TAB_STYLE = {
  color: 'rgb(var(--c-on-primary))',
  backgroundColor: 'rgb(var(--c-brand-400))',
  borderColor: 'rgb(var(--c-brand-400))',
} as const

export interface TabDef<K extends string> {
  key: K
  label: string
  icon: LucideIcon
  dot?: boolean
  count?: number | null
}

export function tabPanelProps(idPrefix: string, key: string) {
  return { id: `${idPrefix}-panel-${key}`, role: 'tabpanel' as const, 'aria-labelledby': `${idPrefix}-tab-${key}` }
}

export default function TabBar<K extends string>({
  tabs,
  value,
  onChange,
  idPrefix,
  label,
}: {
  tabs: readonly TabDef<K>[]
  value: K
  onChange: (key: K) => void
  idPrefix: string
  label: string
}) {
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const i = tabs.findIndex(t => t.key === value)
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    if (next < 0) return
    e.preventDefault()
    const key = tabs[next].key
    onChange(key)
    document.getElementById(`${idPrefix}-tab-${key}`)?.focus()
  }

  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-2" onKeyDown={onKey}>
      {tabs.map(t => {
        const Icon = t.icon
        const active = t.key === value
        return (
          <button
            key={t.key}
            id={`${idPrefix}-tab-${t.key}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={active ? `${idPrefix}-panel-${t.key}` : undefined}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.key)}
            className={clsx('chip-toggle lift-hover lift-tab', active && 'font-semibold')}
            style={active ? ACTIVE_TAB_STYLE : undefined}
          >
            <Icon {...ICON_SM} />
            {t.label}
            {typeof t.count === 'number' && <span className="tabular-nums">({t.count.toLocaleString('en-US')})</span>}
            {t.dot && (
              <>
                <span className="text-amber-800" aria-hidden="true">•</span>
                <span className="sr-only"> (ยังไม่บันทึก)</span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}
