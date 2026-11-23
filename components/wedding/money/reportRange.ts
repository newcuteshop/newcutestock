// ===== ช่วงวันที่ของหน้ารายงานร้าน b.oncloud (pure — ใช้ได้ทั้ง server page และ client) =====
// wed_report / wed_export_* รับช่วงไม่เกิน 366 วัน (pos_check_range) — เลือกวันอนาคตได้ (ดูงานที่จองล่วงหน้า/ค่าตัวทีมที่ต้องจ่าย)
import { daysBetweenKeys, isDayKey } from '@/lib/format'
import { addMonths, monthRange } from './paymentRows'

export const REPORT_MAX_DAYS = 366

export type ReportPresetKey = 'month' | 'prevMonth' | 'nextMonth' | 'quarter' | 'year' | 'prevYear'

export const REPORT_PRESETS: readonly { key: ReportPresetKey; label: string }[] = [
  { key: 'month', label: 'เดือนนี้' },
  { key: 'prevMonth', label: 'เดือนก่อน' },
  { key: 'nextMonth', label: 'เดือนหน้า' },
  { key: 'quarter', label: '3 เดือนล่าสุด' },
  { key: 'year', label: 'ปีนี้' },
  { key: 'prevYear', label: 'ปีที่แล้ว' },
]

export function presetRange(key: ReportPresetKey, today: string): { from: string; to: string } {
  const thisMonth = today.slice(0, 7)
  const y = Number(today.slice(0, 4))
  switch (key) {
    case 'prevMonth':
      return monthRange(addMonths(thisMonth, -1))
    case 'nextMonth':
      return monthRange(addMonths(thisMonth, 1))
    case 'quarter':
      return { from: monthRange(addMonths(thisMonth, -2)).from, to: monthRange(thisMonth).to }
    case 'year':
      return { from: `${y}-01-01`, to: `${y}-12-31` }
    case 'prevYear':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }
    case 'month':
    default:
      return monthRange(thisMonth)
  }
}

export function matchPreset(from: string, to: string, today: string): ReportPresetKey | null {
  for (const p of REPORT_PRESETS) {
    const r = presetRange(p.key, today)
    if (r.from === from && r.to === to) return p.key
  }
  return null
}

/** ช่วงวันที่ใช้ไม่ได้เพราะอะไร (ข้อความไทย) ; ใช้ได้ → null */
export function reportRangeProblem(from: string, to: string): string | null {
  if (!isDayKey(from)) return 'กรุณาเลือกวันที่เริ่มต้น'
  if (!isDayKey(to)) return 'กรุณาเลือกวันที่สิ้นสุด'
  if (from > to) return 'วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด'
  const days = daysBetweenKeys(from, to) + 1
  if (days > REPORT_MAX_DAYS) return `เลือกช่วงได้ไม่เกิน 1 ปี — ตอนนี้เลือกไว้ ${Math.trunc(days).toLocaleString('en-US')} วัน`
  return null
}
