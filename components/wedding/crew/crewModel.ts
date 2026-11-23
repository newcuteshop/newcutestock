// ===== ทีมงานร้าน b.oncloud: ฟอร์ม ↔ wed_save_crew + ตัวช่วยเดือน/ข้อความส่ง LINE =====
// pure functions ล้วน (ไม่มี React) · กติกาตรวจตรงกับ supabase-fix-07-wedding.sql (wed_save_crew / wed_json_phone)
// ค่าตัว (default_fee / fee) เป็นข้อมูลเฉพาะผู้จัดการ — พนักงานไม่ได้รับจากฐานข้อมูลเลย (null) และหน้าจอไม่แสดง
import { parseMoneyInput, round2 } from '@/lib/money'
import { addDaysToKey, baht, formatThaiDate, isDayKey } from '@/lib/format'
import {
  callTimeText, CREW_COLORS, crewDisplayName, crewRoleLabel, DEFAULT_CREW_COLOR, MAX_WED_MONEY, sessionTimeText,
  thaiDayName, thaiMonthYear, WED_CREW_ROLES,
  type WedCrew, type WedCrewPayout, type WedCrewRole, type WedCrewScheduleItem,
} from '@/lib/wedding'
import { asciiDigits, clean } from '@/components/wedding/settings/settingsForm'

export const CREW_LIMITS = { name: 100, nickname: 50, line_id: 50, note: 1000 } as const

export interface CrewForm {
  name: string
  nickname: string
  role: WedCrewRole
  phone: string
  line_id: string
  default_fee: string
  color: string
  is_active: boolean
  note: string
}

export interface CrewPayload {
  name: string
  nickname: string | null
  role: WedCrewRole
  phone: string | null
  line_id: string | null
  default_fee: number
  color: string
  is_active: boolean
  note: string | null
}

/** สีแรกที่ทีมงานที่ยังใช้งานอยู่ยังไม่ใช้ (ทุกสีถูกใช้แล้ว → สีที่ถูกใช้น้อยที่สุด) */
export function pickFreeColor(crew: readonly WedCrew[]): string {
  const used = new Map<string, number>()
  for (const c of crew) if (c.is_active) used.set(c.color.toUpperCase(), (used.get(c.color.toUpperCase()) ?? 0) + 1)
  const free = CREW_COLORS.find(c => !used.has(c.toUpperCase()))
  if (free) return free
  let best = DEFAULT_CREW_COLOR
  let min = Infinity
  for (const c of CREW_COLORS) {
    const n = used.get(c.toUpperCase()) ?? 0
    if (n < min) {
      min = n
      best = c
    }
  }
  return best
}

export function emptyCrewForm(color: string): CrewForm {
  return { name: '', nickname: '', role: 'photo', phone: '', line_id: '', default_fee: '', color, is_active: true, note: '' }
}

export function crewToForm(c: WedCrew): CrewForm {
  return {
    name: c.name,
    nickname: c.nickname ?? '',
    role: c.role,
    phone: c.phone ?? '',
    line_id: c.line_id ?? '',
    default_fee: c.default_fee === null ? '' : String(round2(c.default_fee)),
    color: c.color,
    is_active: c.is_active,
    note: c.note ?? '',
  }
}

/** ฟอร์ม → payload ของ wed_save_crew (ยังไม่ใส่ id/client_id/updated_at) + error รายช่อง */
export function buildCrew(f: CrewForm): { payload: CrewPayload; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const name = clean(f.name)
  if (name === null) errors.name = 'กรุณาใส่ชื่อทีมงาน'
  else if (name.length > CREW_LIMITS.name) errors.name = `ชื่อยาวเกินไป (สูงสุด ${CREW_LIMITS.name} ตัวอักษร)`
  const nickname = clean(f.nickname)
  if (nickname !== null && nickname.length > CREW_LIMITS.nickname) errors.nickname = `ชื่อเล่นยาวเกินไป (สูงสุด ${CREW_LIMITS.nickname} ตัวอักษร)`

  let phone: string | null = null
  const phoneText = clean(asciiDigits(f.phone))
  if (phoneText !== null) {
    if (!/^[0-9 ()+.-]+$/.test(phoneText)) errors.phone = 'เบอร์โทรใส่ได้เฉพาะตัวเลข'
    else {
      phone = phoneText.replace(/\D/g, '')
      if (!/^\d{9,15}$/.test(phone)) errors.phone = 'เบอร์โทรต้องเป็นตัวเลข 9–15 หลัก'
    }
  }
  const line = clean(f.line_id)
  if (line !== null && line.length > CREW_LIMITS.line_id) errors.line_id = `LINE ID ยาวเกินไป (สูงสุด ${CREW_LIMITS.line_id} ตัวอักษร)`

  let fee = 0
  if (clean(f.default_fee) !== null) {
    const n = parseMoneyInput(f.default_fee)
    if (n === null) errors.default_fee = 'ค่าตัว: รูปแบบจำนวนเงินไม่ถูกต้อง'
    else if (n < 0) errors.default_fee = 'ค่าตัวต้องไม่ติดลบ'
    else if (n > MAX_WED_MONEY) errors.default_fee = 'ค่าตัวสูงเกินไป'
    else fee = n
  }
  const note = clean(f.note)
  if (note !== null && note.length > CREW_LIMITS.note) errors.note = `หมายเหตุยาวเกินไป (สูงสุด ${CREW_LIMITS.note.toLocaleString('en-US')} ตัวอักษร)`
  const role = (WED_CREW_ROLES as readonly string[]).includes(f.role) ? f.role : 'other'
  const color = /^#[0-9A-Fa-f]{6}$/.test(f.color) ? f.color.toUpperCase() : DEFAULT_CREW_COLOR

  return {
    payload: {
      name: name ?? '',
      nickname,
      role,
      phone,
      line_id: line,
      default_fee: fee,
      color,
      is_active: f.is_active,
      note,
    },
    errors,
  }
}

/** ข้อมูลจากฐานข้อมูลตรงกับ payload ที่ส่งไปหรือไม่ (ใช้ตรวจตอนไม่รู้ผล) — default_fee เทียบเมื่อฐานข้อมูลส่งมา */
export function crewMatches(c: WedCrew, p: CrewPayload): boolean {
  return c.name === p.name && (c.nickname ?? null) === p.nickname && c.role === p.role && (c.phone ?? null) === p.phone &&
    (c.line_id ?? null) === p.line_id && c.color.toUpperCase() === p.color.toUpperCase() && c.is_active === p.is_active &&
    (c.note ?? null) === p.note && (c.default_fee === null || round2(c.default_fee) === round2(p.default_fee))
}

/** อักษรย่อบนวงกลมสี: ตัวแรกของชื่อเล่น (หรือชื่อ) — สระหน้า (เ แ โ ใ ไ) เอาพยัญชนะตัวถัดไปด้วย */
export function crewInitial(c: { name: string; nickname?: string | null }): string {
  const src = ((c.nickname ?? '').trim() || (c.name ?? '').trim())
  if (!src) return '?'
  const chars = Array.from(src)
  const first = chars[0]
  if (/[เแโใไ]/.test(first) && chars.length > 1) return first + chars[1]
  return /[a-z]/i.test(first) ? first.toUpperCase() : first
}

/** ชื่อที่ใช้ค้นหา (ชื่อ ชื่อเล่น เบอร์ LINE หน้าที่) ตัวเล็กหมด */
export function crewSearchText(c: WedCrew): string {
  return [c.name, c.nickname, c.phone, c.line_id, crewRoleLabel(c.role)].filter(Boolean).join(' ').toLowerCase()
}

// ---------------------------------------------------------------------------
// เดือน 'YYYY-MM'
// ---------------------------------------------------------------------------
export function isMonthKey(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
}

export function monthOf(day: string): string {
  return day.slice(0, 7)
}

/** วันแรก-วันสุดท้ายของเดือน */
export function monthRange(month: string): { from: string; to: string } {
  const from = `${month}-01`
  const nextFirst = addMonths(month, 1) + '-01'
  return { from, to: addDaysToKey(nextFirst, -1) }
}

/** เลื่อนเดือน n เดือน ('2026-12' + 1 → '2027-01') */
export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7)) - 1 + Math.trunc(n)
  const yy = y + Math.floor(m / 12)
  const mm = ((m % 12) + 12) % 12
  return `${String(yy).padStart(4, '0')}-${String(mm + 1).padStart(2, '0')}`
}

/** 'ส. 5 ธ.ค.' แบบสั้นสำหรับรายการ/ข้อความ LINE */
const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
export function shortDay(day: string | null): string {
  if (!day || !isDayKey(day)) return 'ไม่ระบุวัน'
  const m = Number(day.slice(5, 7))
  return `${thaiDayName(day, true)}. ${Number(day.slice(8, 10))} ${THAI_MONTHS_SHORT[m - 1] ?? ''}`
}

/** เวลาของคิวสำหรับข้อความ: 'ทีมถึง 08:00 น. · 09:00–12:00 น.' */
export function scheduleTimeText(s: Pick<WedCrewScheduleItem, 'call_time' | 'start_time' | 'end_time'>): string {
  const call = callTimeText(s.call_time)
  const range = sessionTimeText(s, '')
  return [call, range].filter(Boolean).join(' · ') || 'ไม่ระบุเวลา'
}

/** ข้อความตารางงานทั้งเดือนของทีมงาน 1 คน (คัดลอกส่ง LINE) — showFee = ผู้จัดการ */
export function scheduleLineText(crew: WedCrew, month: string, items: readonly WedCrewScheduleItem[], showFee: boolean): string {
  const lines: string[] = [`ตารางงาน ${crewDisplayName(crew)} — ${thaiMonthYear(month)}`]
  if (items.length === 0) {
    lines.push('ยังไม่มีคิวงานในเดือนนี้')
    return lines.join('\n')
  }
  let lastDay: string | null | undefined
  for (const s of items) {
    if (s.date !== lastDay) {
      lines.push('')
      lines.push(shortDay(s.date))
      lastDay = s.date
    }
    const parts = [scheduleTimeText(s), s.type_label + (s.title ? ` (${s.title})` : ''), s.couple_names || s.booking_no]
    if (s.venue_name) parts.push(s.venue_name)
    parts.push(`หน้าที่ ${crewRoleLabel(s.role)}`)
    if (showFee && s.fee !== null) parts.push(`ค่าตัว ${baht(s.fee)}${s.fee_paid_on ? ' (จ่ายแล้ว)' : ''}`)
    lines.push(`- ${parts.join(' · ')}`)
    if (s.map_url) lines.push(`  แผนที่: ${s.map_url}`)
  }
  lines.push('')
  lines.push(`รวม ${items.length.toLocaleString('en-US')} คิว · ${new Set(items.map(i => i.date).filter(Boolean)).size.toLocaleString('en-US')} วัน`)
  return lines.join('\n')
}

/** ข้อความสรุปค่าตัวของทีมงาน 1 คนในช่วงวันที่ (คัดลอกส่ง LINE) */
export function payoutLineText(p: WedCrewPayout, from: string, to: string): string {
  const lines: string[] = [
    `สรุปค่าตัว ${crewDisplayName(p)} — ${formatThaiDate(from)}${to !== from ? ` ถึง ${formatThaiDate(to)}` : ''}`,
  ]
  for (const l of p.lines) {
    const status = l.fee_paid_on ? `จ่ายแล้ว ${formatThaiDate(l.fee_paid_on)}` : 'ค้างจ่าย'
    lines.push(`- ${shortDay(l.date)} · ${l.type_label} · ${l.couple_names || l.booking_no} · ${baht(l.fee)} (${status})`)
  }
  lines.push('')
  lines.push(`รวม ${p.sessions.toLocaleString('en-US')} คิว ${baht(p.fees)} · จ่ายแล้ว ${baht(p.paid)} · ค้างจ่าย ${baht(p.unpaid)}`)
  return lines.join('\n')
}

/** คีย์ของรายการค่าตัว (คิว + ทีมงาน) */
export function lineKey(sessionId: string, crewId: string): string {
  return `${sessionId}|${crewId}`
}
