// ===== ปฏิทินงาน ร้าน b.oncloud: สี/ไอคอนตามสถานะและประเภทคิว + ตัวกรอง (pure — ใช้ได้ทั้ง server page และ client) =====
// สีบอกสถานะต้องมีข้อความ/ไอคอนคู่เสมอ (ป้ายอธิบายใต้ตาราง + aria-label ของช่องวัน) ไม่พึ่งสีอย่างเดียว
// ชื่อคลาสเขียนเต็มทุกตัว (Tailwind ตัดคลาสที่ประกอบจากตัวแปรทิ้ง)
import { CircleDot, Camera, Gem, Sunrise, Wine, type LucideIcon } from 'lucide-react'
import {
  SESSION_TYPE_LABELS, WED_SESSION_TYPES, isCountingStatus,
  type WedBookingStatus, type WedSessionMini, type WedSessionType,
} from '@/lib/wedding'

/** ไอคอนประจำประเภทคิว (ชิปในช่องวัน / รายการ / ป้ายอธิบาย) */
export const SESSION_TYPE_ICON: Readonly<Record<WedSessionType, LucideIcon>> = {
  engagement: Gem,
  ceremony: Sunrise,
  reception: Wine,
  prewedding: Camera,
  other: CircleDot,
}

/** กลุ่มสีของสถานะงานในปฏิทิน */
export type CalTone = 'inquiry' | 'hold' | 'confirmed' | 'done'

export function calTone(status: WedBookingStatus): CalTone {
  if (status === 'inquiry') return 'inquiry'
  if (status === 'hold') return 'hold'
  if (status === 'confirmed') return 'confirmed'
  // ถ่ายเสร็จ/ส่งแล้ว/ปิดงาน (และค่าแปลกที่ไม่ควรมาถึงปฏิทิน: เลื่อน/ยกเลิก) = สีจาง
  return 'done'
}

/** ชิปคิวในช่องวัน (จอกว้าง): สอบถาม = เส้นประ · ล็อกคิว = ขอบอำพัน · ยืนยัน = พื้นทอง · ถ่ายแล้วขึ้นไป = พื้นเทาจาง */
export const TONE_CHIP: Readonly<Record<CalTone, string>> = {
  inquiry: 'border border-dashed border-gray-400 bg-white text-gray-700',
  hold: 'border border-amber-400 bg-amber-50 text-amber-900',
  confirmed: 'border border-brand-500 bg-brand-400 text-gray-900',
  done: 'border border-gray-200 bg-gray-150 text-gray-600',
}

/** จุดสีในตารางเดือนแบบย่อ (มือถือ) — สีเส้น/พื้นทุกตัว ≥ 3:1 บนขาว */
export const TONE_DOT: Readonly<Record<CalTone, string>> = {
  inquiry: 'border border-dashed border-gray-500 bg-white',
  hold: 'border border-amber-600 bg-amber-300',
  confirmed: 'border border-brand-700 bg-brand-600',
  done: 'border border-gray-400 bg-gray-300',
}

/** แถบซ้ายของการ์ดคิว (รายละเอียดวัน / วาระมือถือ) — เส้นทึบทุกแบบ (การ์ดมีเส้นรอบทึบ) ป้ายสถานะข้างในบอกความหมายอีกชั้น */
export const TONE_BAR: Readonly<Record<CalTone, string>> = {
  inquiry: 'border-l-4 border-l-gray-400',
  hold: 'border-l-4 border-l-amber-500',
  confirmed: 'border-l-4 border-l-brand-600',
  done: 'border-l-4 border-l-gray-200',
}

export const TONE_LABEL: Readonly<Record<CalTone, string>> = {
  inquiry: 'สอบถาม (ยังไม่ล็อกคิว)',
  hold: 'ล็อกคิว รอมัดจำ',
  confirmed: 'ยืนยันแล้ว',
  done: 'ถ่ายแล้ว / ส่งงาน / ปิดงาน',
}

export const CAL_TONES: readonly CalTone[] = ['inquiry', 'hold', 'confirmed', 'done'] as const

// ---------------------------------------------------------------------------
// ตัวกรอง
// ---------------------------------------------------------------------------
export type TypeFilter = 'all' | WedSessionType

export const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'ทุกประเภท' },
  ...WED_SESSION_TYPES.map(t => ({ value: t as TypeFilter, label: SESSION_TYPE_LABELS[t] })),
]

export function isTypeFilter(v: unknown): v is TypeFilter {
  return v === 'all' || (typeof v === 'string' && (WED_SESSION_TYPES as readonly string[]).includes(v))
}

export interface CalFilters {
  /** ทีมงาน 1 คน (ฐานข้อมูลกรองให้ที่ wed_calendar) ; null = ทุกคน */
  crewId: string | null
  /** รวมงานที่ยังสอบถาม (ฐานข้อมูลกรองให้) */
  includeInquiries: boolean
  /** ประเภทคิว (กรองในหน้าเว็บ) */
  type: TypeFilter
}

export const DEFAULT_FILTERS: CalFilters = { crewId: null, includeInquiries: false, type: 'all' }

/** คิวผ่านตัวกรองไหม — ใช้กับรายละเอียดวัน (wed_day ส่งทุกคิวมา รวมงานสอบถาม) ให้ตรงกับที่ตารางเดือนแสดง */
export function sessionPasses(
  s: Pick<WedSessionMini, 'status' | 'session_type' | 'crew'>,
  f: CalFilters,
): boolean {
  if (!f.includeInquiries && s.status === 'inquiry') return false
  if (s.status !== 'inquiry' && !isCountingStatus(s.status)) return false
  if (f.type !== 'all' && s.session_type !== f.type) return false
  if (f.crewId && !s.crew.some(c => c.crew_id === f.crewId)) return false
  return true
}

export function filtersActive(f: CalFilters): boolean {
  return f.crewId !== null || f.includeInquiries || f.type !== 'all'
}

/** เวลาที่ใช้เรียง/แสดงก่อนในชิป: เวลาเริ่มงาน (ไม่มี → เวลาทีมถึง) */
export function chipTime(s: Pick<WedSessionMini, 'start_time' | 'call_time'>): string {
  return s.start_time ?? s.call_time ?? ''
}

/**
 * ข้อความคู่คิวที่ทีมงานชนกัน: 'ช่างภาพเอ: WD-… คุณมิว & คุณเจ (09:00–12:00 น.) ชนกับ WD-… คุณบี & คุณซี (10:00–14:00 น.)'
 * ฝั่ง "คิวนี้" หาจากรายการคิวที่มีอยู่ในหน้า (this_session_id) — หาไม่เจอ = บอกแค่ฝั่งอีกงาน
 * เวลาทั้งสองฝั่งใช้ฐานเดียวกับ wed_busy_text ของฐานข้อมูล: เริ่ม = เวลาทีมถึง (ไม่มี → เวลาเริ่มงาน) ถึงเวลาเลิก
 * (การชนคิดจากเวลาทีมถึง — ใช้เวลาเริ่มงานฝั่งเดียวจะดูเหมือนชนน้อยกว่าจริง และไม่ตรงกับข้อความฝั่งอีกงาน)
 */
export function conflictPairText(
  c: { crew_name: string; this_session_id: string | null; other_booking_no: string; other_couple: string; other_time: string },
  lookup: (sessionId: string) => Pick<WedSessionMini, 'booking_no' | 'couple_names' | 'start_time' | 'end_time' | 'call_time'> | null | undefined,
): string {
  const who = c.crew_name || 'ทีมงาน'
  const other = [c.other_booking_no, c.other_couple].filter(Boolean).join(' ') || 'งานอื่น'
  const otherTime = c.other_time ? ` (${c.other_time})` : ''
  const self = c.this_session_id ? lookup(c.this_session_id) : null
  if (!self) return `${who} ติดงาน ${other}${otherTime} ในวันเดียวกัน`
  const selfText = [self.booking_no, self.couple_names].filter(Boolean).join(' ')
  const a = self.call_time ?? self.start_time
  const b = self.end_time
  const selfTime = a && b ? ` (${a}–${b} น.)` : a ? ` (ตั้งแต่ ${a} น.)` : b ? ` (ถึง ${b} น.)` : ' (ทั้งวัน)'
  return `${who}: ${selfText}${selfTime} ชนกับ ${other}${otherTime}`
}

const MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

/** ชื่อเดือนแบบสั้น + ปี พ.ศ. ('2026-11' → 'พ.ย. 2569') — หัวปฏิทินบนจอแคบ (ชื่อเต็มโดนตัดจนไม่เห็นปี) */
export function monthLabelShort(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(monthKey ?? '').trim())
  if (!m) return '-'
  const name = MONTHS_SHORT[Number(m[2]) - 1]
  return name ? `${name} ${Number(m[1]) + 543}` : '-'
}
