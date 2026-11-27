// ===== ประวัติงาน (wed_logs) → ข้อความไทย =====
// detail ของแต่ละ action ตรงกับที่ supabase-fix-07-wedding.sql จดไว้ (ไม่มีค่าตัวทีมงานใน detail — พนักงานอ่านได้)
// ค่าแปลก/หายไป = ข้ามบรรทัดนั้น (ไม่ throw)
import {
  WED_BOOKING_STATUSES, WED_STATUS_LABELS, deliverableStatusLabel, wedChargeKindLabel, wedMethodLabel, wedPurposeLabel,
  wedSourceLabel, type WedLog,
} from '@/lib/wedding'

const LOG_LABELS: Record<string, string> = {
  create: 'สร้างงาน',
  update: 'แก้ไขงาน',
  hold: 'ล็อกคิว รอมัดจำ',
  extend_hold: 'ต่อเวลาล็อกคิว',
  release_hold: 'ปล่อยคิว (กลับเป็นสอบถาม)',
  hold_expired: 'หมดเวลาล็อกคิว (กลับเป็นสอบถามอัตโนมัติ)',
  confirm: 'ยืนยันงาน',
  mark_shot: 'บันทึกถ่ายเสร็จ',
  mark_delivered: 'บันทึกส่งงานแล้ว',
  auto_delivered: 'ส่งงานครบทุกรายการ (เปลี่ยนเป็น "ส่งงานแล้ว" อัตโนมัติ)',
  auto_back_to_production: 'มีรายการส่งงานกลับมาค้าง (กลับเป็น "รอส่งงาน" อัตโนมัติ)',
  complete: 'ปิดงาน',
  reopen: 'เปิดงานใหม่',
  postpone: 'เลื่อนงาน',
  resume: 'กลับมาจัดงาน',
  cancel: 'ยกเลิกงาน',
  followup: 'ตั้งวันติดตามลูกค้า',
  rotate_token: 'เปลี่ยนลิงก์ติดตามงานของลูกค้า (ลิงก์เดิมใช้ไม่ได้แล้ว)',
  installments_set: 'แก้งวดชำระ',
  installments_reset: 'กลับไปใช้งวดมาตรฐาน',
  installments_absorb: 'ปรับยอดงวดตามยอดสุทธิใหม่ (อัตโนมัติ)',
  installments_rebuild: 'สร้างงวดชำระใหม่ตามยอดสุทธิ (อัตโนมัติ)',
  policy_update: 'เปลี่ยนวันชำระยอดคงเหลือเป็นวันงาน',
  payment: 'รับชำระ',
  refund: 'คืนเงิน',
  payment_void: 'ยกเลิกรายการเงิน',
  charge_add: 'เพิ่มค่าใช้จ่าย',
  charge_void: 'ยกเลิกค่าใช้จ่าย',
  deliverable_add: 'เพิ่มรายการส่งงาน',
  deliverable_update: 'แก้รายการส่งงาน',
  deliverable_delete: 'ลบรายการส่งงาน',
  crew_paid: 'จ่ายค่าตัวทีมงานแล้ว',
  crew_unpaid: 'ยกเลิกสถานะจ่ายค่าตัวทีมงาน',
}

type Detail = Record<string, unknown> | null

function dText(d: Detail, k: string): string {
  if (!d) return ''
  const v = d[k]
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return ''
}

function dNum(d: Detail, k: string): number | null {
  if (!d) return null
  const v = d[k]
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function dBool(d: Detail, k: string): boolean {
  if (!d) return false
  const v = d[k]
  return v === true || v === 'true'
}

// [เดิม, ใหม่] (update จดคู่ค่าเฉพาะช่องที่เปลี่ยน)
function dPair(d: Detail, k: string): [unknown, unknown] | null {
  const v = d ? d[k] : null
  return Array.isArray(v) && v.length === 2 ? [v[0], v[1]] : null
}

// มัดจำกำหนดเอง (deposit_override): null = คิดอัตโนมัติ ; ค่าแปลก = undefined (ข้ามบรรทัด)
function depositText(v: unknown, fmtMoney: (n: number) => string): string | undefined {
  if (v === null || v === undefined) return 'อัตโนมัติ'
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 ? fmtMoney(n) : undefined
}

// รายการวันที่ (array ของ 'YYYY-MM-DD')
function dDates(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x)).map(x => x.slice(0, 10))
}

function statusText(v: string): string {
  return (WED_BOOKING_STATUSES as readonly string[]).includes(v) ? WED_STATUS_LABELS[v as keyof typeof WED_STATUS_LABELS] : v
}

export interface LogView {
  label: string
  lines: string[]
}

/** ประวัติ 1 รายการ → หัวข้อ + รายละเอียด (fmtMoney / fmtDay ส่งเข้ามา เพื่อไม่ผูกกับรูปแบบแสดงผล) */
export function describeLog(
  log: WedLog,
  fmtMoney: (n: number) => string,
  fmtDay: (key: string) => string,
  fmtDateTime: (iso: string) => string,
): LogView {
  const d = log.detail
  const label = LOG_LABELS[log.action] ?? (log.action || 'รายการ')
  const lines: string[] = []
  const days = (v: unknown) => dDates(v).map(fmtDay).join(', ')
  switch (log.action) {
    case 'create': {
      const st = dText(d, 'status')
      if (st) lines.push(`สถานะเริ่มต้น: ${statusText(st)}`)
      const src = dText(d, 'source')
      if (src) lines.push(`ช่องทาง: ${wedSourceLabel(src)}`)
      const ds = d ? days(d.dates) : ''
      if (ds) lines.push(`วันงาน: ${ds}`)
      if (dBool(d, 'capacity_over')) lines.push('บันทึกทั้งที่คิววันนั้นเต็ม (ยืนยันแล้ว)')
      const dep = dNum(d, 'deposit_override')
      if (dep !== null && dep >= 0) lines.push(`มัดจำกำหนดเอง ${fmtMoney(dep)}`)
      break
    }
    case 'update': {
      const dates = dPair(d, 'dates')
      if (dates) {
        const a = days(dates[0])
        const b = days(dates[1])
        if (a !== b) lines.push(`วันงาน ${a || 'ยังไม่ระบุ'} → ${b || 'ยังไม่ระบุ'}`)
      }
      const n = dNum(d, 'sessions')
      if (n !== null) lines.push(`คิวงาน ${n} คิว`)
      if (dBool(d, 'capacity_over')) lines.push('บันทึกทั้งที่คิววันนั้นเต็ม (ยืนยันแล้ว)')
      if (dBool(d, 'customer_changed')) lines.push('เปลี่ยนลูกค้า')
      // ช่องทางที่ติดต่อมา [เดิม, ใหม่] (fix-11 — ประวัติก่อนหน้าไม่มี) ขึ้นก่อนชื่อช่องทาง: "ช่องทาง Facebook → LINE"
      const sp = dPair(d, 'source')
      if (sp && typeof sp[0] === 'string' && typeof sp[1] === 'string' && sp[0] !== sp[1]) {
        lines.push(`ช่องทาง ${wedSourceLabel(sp[0])} → ${wedSourceLabel(sp[1])}`)
      }
      // ชื่อช่องทางติดต่อ [เดิม, ใหม่] (fix-11) — null = ไม่มี
      const sd = dPair(d, 'source_detail')
      if (sd) {
        const t = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : '-')
        if (t(sd[0]) !== t(sd[1])) lines.push(`ชื่อช่องทางติดต่อ ${t(sd[0])} → ${t(sd[1])}`)
      }
      const pkg = dPair(d, 'package')
      if (pkg) lines.push(`แพ็กเกจ ${String(pkg[0] ?? '-')} → ${String(pkg[1] ?? '-')}`)
      const pp = dPair(d, 'package_price')
      if (pp && Number.isFinite(Number(pp[0])) && Number.isFinite(Number(pp[1])) && Number(pp[0]) !== Number(pp[1])) {
        lines.push(`ราคาแพ็กเกจ ${fmtMoney(Number(pp[0]))} → ${fmtMoney(Number(pp[1]))}`)
      }
      for (const [k, name] of [['discount', 'ส่วนลด'], ['travel_fee', 'ค่าเดินทาง']] as const) {
        const p = dPair(d, k)
        if (p && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]))) {
          lines.push(`${name} ${fmtMoney(Number(p[0]))} → ${fmtMoney(Number(p[1]))}`)
        }
      }
      const dp = dPair(d, 'deposit_override')
      if (dp) {
        const a = depositText(dp[0], fmtMoney)
        const b = depositText(dp[1], fmtMoney)
        if (a !== undefined && b !== undefined && a !== b) lines.push(`มัดจำ ${a} → ${b}`)
      }
      const ad = dNum(d, 'addons')
      if (ad !== null) lines.push(`บริการเสริม ${ad} รายการ`)
      break
    }
    case 'hold': {
      const h = dNum(d, 'hours')
      if (h !== null) lines.push(`ล็อกไว้ ${h} ชั่วโมง`)
      if (dBool(d, 'capacity_over')) lines.push('ล็อกทั้งที่คิววันนั้นเต็ม (ยืนยันแล้ว)')
      break
    }
    case 'extend_hold': {
      const h = dNum(d, 'hours')
      if (h !== null) lines.push(`เพิ่ม ${h} ชั่วโมง`)
      const nw = dText(d, 'new')
      if (nw) lines.push(`ล็อกถึง ${fmtDateTime(nw)}`)
      break
    }
    case 'release_hold':
    case 'hold_expired': {
      const t = dText(d, 'hold_until')
      if (t) lines.push(`เดิมล็อกถึง ${fmtDateTime(t)}`)
      break
    }
    case 'confirm': {
      const from = dText(d, 'from')
      if (from) lines.push(`จาก ${statusText(from)}`)
      if (d && 'deposit_met' in d) {
        lines.push(dBool(d, 'deposit_met') ? 'ได้รับมัดจำครบแล้ว' : 'ยืนยันก่อนได้รับมัดจำครบ (กดยืนยันแบบบังคับ)')
      }
      if (dBool(d, 'capacity_over')) lines.push('ยืนยันทั้งที่คิววันนั้นเต็ม')
      const made = dNum(d, 'deliverables_created')
      if (made !== null && made > 0) lines.push(`สร้างรายการส่งงาน ${made} รายการ`)
      break
    }
    case 'mark_shot': {
      const n = dNum(d, 'sessions_done')
      if (n !== null) lines.push(`คิวที่ถ่ายแล้ว ${n} คิว`)
      if (dBool(d, 'forced')) lines.push('บันทึกทั้งที่ยังมีคิวที่ยังไม่ถึงวัน (กดยืนยันแบบบังคับ)')
      break
    }
    case 'mark_delivered': {
      const open = dNum(d, 'open_deliverables')
      if (open !== null && open > 0) lines.push(`ยังมีรายการส่งงานค้าง ${open} รายการ`)
      break
    }
    case 'auto_delivered': {
      const n = dNum(d, 'deliverables')
      if (n !== null) lines.push(`${n} รายการ`)
      break
    }
    case 'auto_back_to_production': {
      const n = dNum(d, 'open')
      if (n !== null) lines.push(`ค้างส่ง ${n} รายการ`)
      break
    }
    case 'complete': {
      const g = dNum(d, 'grand_total')
      if (g !== null) lines.push(`ยอดสุทธิ ${fmtMoney(g)}`)
      const from = dText(d, 'from')
      if (from === 'in_production') lines.push('ปิดงานก่อนบันทึกส่งงาน (กดยืนยันแบบบังคับ)')
      break
    }
    case 'postpone': {
      const from = dText(d, 'from')
      if (from) lines.push(`จาก ${statusText(from)}`)
      const ds = d ? days(d.dates) : ''
      if (ds) lines.push(`วันงานเดิม: ${ds}`)
      break
    }
    case 'resume': {
      const to = dText(d, 'to')
      if (to) lines.push(`กลับเป็น ${statusText(to)}`)
      const ds = d ? days(d.dates) : ''
      if (ds) lines.push(`วันงาน: ${ds}`)
      if (dBool(d, 'capacity_over')) lines.push('ทั้งที่คิววันนั้นเต็ม (ยืนยันแล้ว)')
      break
    }
    case 'cancel': {
      const from = dText(d, 'from')
      if (from) lines.push(`จาก ${statusText(from)}`)
      const paid = dNum(d, 'paid')
      if (paid !== null && paid > 0) lines.push(`มีเงินที่ชำระไว้ ${fmtMoney(paid)}`)
      break
    }
    case 'followup': {
      const day = dText(d, 'date')
      lines.push(day ? `ติดตามวันที่ ${fmtDay(day)}` : 'ล้างวันติดตาม')
      const note = dText(d, 'note')
      if (note) lines.push(note)
      break
    }
    case 'installments_set': {
      const n = dNum(d, 'count')
      const t = dNum(d, 'total')
      if (n !== null) lines.push(`${n} งวด${t !== null ? ` รวม ${fmtMoney(t)}` : ''}`)
      break
    }
    case 'installments_absorb': {
      const seq = dNum(d, 'seq')
      const a = dNum(d, 'old_amount')
      const b = dNum(d, 'new_amount')
      if (seq !== null && a !== null && b !== null) lines.push(`งวดที่ ${seq}: ${fmtMoney(a)} → ${fmtMoney(b)}`)
      break
    }
    case 'installments_rebuild': {
      const g = dNum(d, 'grand_total')
      if (g !== null) lines.push(`ยอดสุทธิใหม่ ${fmtMoney(g)}`)
      break
    }
    case 'policy_update': {
      // supabase-fix-09 (27/11/2569) — ยอดเงินไม่เปลี่ยน เปลี่ยนแค่วันครบกำหนด
      const a = dText(d, 'old_balance_due_date')
      const b = dText(d, 'new_balance_due_date')
      if (a || b) lines.push(`ชำระยอดคงเหลือภายใน ${a ? fmtDay(a) : '-'} → ${b ? fmtDay(b) : '-'}`)
      // งานที่บอสแก้งวดเอง: วันในงวดชำระไม่เปลี่ยน (เปลี่ยนแค่วันครบกำหนดของงาน)
      if (dBool(d, 'installments_kept')) lines.push('งวดชำระที่แก้เองคงวันเดิม')
      break
    }
    case 'payment':
    case 'refund': {
      const parts = [dText(d, 'method') ? wedMethodLabel(dText(d, 'method')) : '', dText(d, 'purpose') ? wedPurposeLabel(dText(d, 'purpose')) : '']
        .filter(Boolean)
      const amount = dNum(d, 'amount')
      lines.push(`${parts.join(' · ')}${amount !== null ? ` ${fmtMoney(amount)}` : ''}`.trim())
      const on = dText(d, 'paid_on')
      if (on) lines.push(`วันที่รับ/จ่ายเงิน ${fmtDay(on)}`)
      const no = dText(d, 'receipt_no')
      if (no) lines.push(`เลขที่ ${no}`)
      break
    }
    case 'payment_void': {
      const kind = dText(d, 'kind')
      const amount = dNum(d, 'amount')
      lines.push([dText(d, 'receipt_no'), kind === 'refund' ? 'คืนเงิน' : kind ? 'รับชำระ' : '', amount !== null ? fmtMoney(amount) : '']
        .filter(Boolean).join(' · '))
      break
    }
    case 'charge_add': {
      const desc = dText(d, 'description')
      const kind = dText(d, 'kind')
      const amount = dNum(d, 'amount')
      lines.push([desc || (kind ? wedChargeKindLabel(kind) : ''), amount !== null ? fmtMoney(amount) : ''].filter(Boolean).join(' '))
      break
    }
    case 'charge_void': {
      const amount = dNum(d, 'amount')
      if (amount !== null) lines.push(`ยอด ${fmtMoney(amount)}`)
      break
    }
    case 'deliverable_add':
    case 'deliverable_update':
    case 'deliverable_delete': {
      const name = dText(d, 'name')
      if (name) lines.push(name)
      const st = dPair(d, 'status')
      if (st && typeof st[1] === 'string') {
        if (st[0] !== st[1] && typeof st[0] === 'string') lines.push(`${deliverableStatusLabel(st[0])} → ${deliverableStatusLabel(st[1])}`)
        else if (log.action === 'deliverable_add') lines.push(deliverableStatusLabel(st[1]))
      }
      break
    }
    case 'crew_paid': {
      const on = dText(d, 'paid_on')
      if (on) lines.push(`วันที่จ่าย ${fmtDay(on)}`)
      break
    }
    default:
      break
  }
  const reason = dText(d, 'reason')
  if (reason) lines.push(`เหตุผล: ${reason}`)
  return { label, lines: lines.filter(l => l.trim() !== '') }
}
