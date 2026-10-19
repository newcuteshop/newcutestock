'use client'
// หน้าปฏิทินร้านเช่าชุด: 2 แท็บ
//   ตารางงาน  = วันไหนลูกค้ามารับ/คืน/ลองชุด (rental_schedule)
//   ปฏิทินชุด = ชิ้นจริงของชุด 1 แบบ ว่าง/ถูกจองวันไหน (rental_item_calendar)
// สถานะ (แท็บ / เดือน / ชุด) เขียนลง URL (?tab=items&month=2026-10&item=<id>) → โหลดหน้าใหม่/ส่งลิงก์ต่อแล้วเปิดตรงที่เดิม
//   หน้าอื่นลิงก์มาได้ เช่น หน้าชุด → /rental/calendar?tab=items&item=<id>
import { useCallback, useState } from 'react'
import clsx from 'clsx'
import { CalendarDays, GanttChartSquare, type LucideIcon } from 'lucide-react'
import { ICON_XS } from '@/components/theme/icons'
import ScheduleView from './ScheduleView'
import ItemTimeline from './ItemTimeline'
import { monthOfDay } from './dates'

export type CalendarTab = 'schedule' | 'items'

const TABS: { value: CalendarTab; label: string; icon: LucideIcon }[] = [
  { value: 'schedule', label: 'ตารางงาน', icon: CalendarDays },
  { value: 'items', label: 'ปฏิทินชุด', icon: GanttChartSquare },
]

export default function CalendarClient({
  today,
  initialTab,
  initialMonth,
  initialItemId,
}: {
  today: string
  initialTab: CalendarTab
  initialMonth: string
  initialItemId: string | null
}) {
  const [tab, setTab] = useState<CalendarTab>(initialTab)
  const [month, setMonth] = useState(initialMonth)
  const [itemId, setItemId] = useState<string | null>(initialItemId)
  const [visited, setVisited] = useState<Record<CalendarTab, boolean>>({ schedule: initialTab === 'schedule', items: initialTab === 'items' })

  // ค่าเริ่มต้น (แท็บตารางงาน / เดือนนี้ / ไม่เลือกชุด) ไม่ใส่ใน URL ให้ลิงก์สั้น
  const syncUrl = useCallback((next: { tab: CalendarTab; month: string; itemId: string | null }) => {
    try {
      const url = new URL(window.location.href)
      if (next.tab === 'schedule') url.searchParams.delete('tab')
      else url.searchParams.set('tab', next.tab)
      if (next.month === monthOfDay(today)) url.searchParams.delete('month')
      else url.searchParams.set('month', next.month)
      if (next.itemId) url.searchParams.set('item', next.itemId)
      else url.searchParams.delete('item')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    } catch {
      // เบราว์เซอร์ไม่ยอมแก้ URL — ไม่เป็นไร
    }
  }, [today])

  function changeTab(t: CalendarTab) {
    setTab(t)
    setVisited(v => (v[t] ? v : { ...v, [t]: true }))
    syncUrl({ tab: t, month, itemId })
  }

  function changeMonth(m: string) {
    setMonth(m)
    syncUrl({ tab, month: m, itemId })
  }

  function changeItem(id: string | null) {
    setItemId(id)
    syncUrl({ tab, month, itemId: id })
  }

  // ลูกศรซ้าย-ขวาเลื่อนแท็บ (รูปแบบ tablist มาตรฐาน)
  function onTabKey(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const i = TABS.findIndex(t => t.value === tab)
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
    changeTab(next.value)
    document.getElementById(`calendar-tab-${next.value}`)?.focus()
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="มุมมองปฏิทิน" className="grid grid-cols-2 gap-1 rounded-xl border border-gray-200 bg-white p-1 sm:inline-grid">
        {TABS.map(t => {
          const active = t.value === tab
          const Icon = t.icon
          return (
            <button
              key={t.value}
              id={`calendar-tab-${t.value}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`calendar-panel-${t.value}`}
              tabIndex={active ? 0 : -1}
              onClick={() => changeTab(t.value)}
              onKeyDown={onTabKey}
              className={clsx(
                'flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-4 text-sm whitespace-nowrap transition-colors duration-150',
                active
                  ? 'bg-brand-100 font-semibold text-brand-700'
                  : 'font-medium text-gray-700 active:bg-gray-150 [@media(hover:hover)]:hover:bg-gray-100 [@media(hover:hover)]:hover:text-gray-900',
              )}
            >
              <Icon {...ICON_XS} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* แท็บที่เคยเปิดแล้วคงไว้ (ซ่อน) — สลับกลับไปไม่ต้องโหลด/เลือกตัวกรองใหม่ ; แท็บที่ยังไม่เคยเปิดยังไม่โหลดข้อมูล */}
      <div id="calendar-panel-schedule" role="tabpanel" aria-labelledby="calendar-tab-schedule" hidden={tab !== 'schedule'}>
        {visited.schedule && <ScheduleView month={month} today={today} onMonthChange={changeMonth} />}
      </div>
      <div id="calendar-panel-items" role="tabpanel" aria-labelledby="calendar-tab-items" hidden={tab !== 'items'}>
        {visited.items && (
          <ItemTimeline month={month} today={today} itemId={itemId} onItemChange={changeItem} onMonthChange={changeMonth} />
        )}
      </div>
    </div>
  )
}
