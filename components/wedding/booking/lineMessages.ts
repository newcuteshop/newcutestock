// ===== ข้อความสำเร็จรูปสำหรับส่ง LINE คู่บ่าวสาว (คัดลอกไปวางเอง — ระบบไม่ได้ส่งให้อัตโนมัติ) =====
// ใช้ชื่อร้านจาก wed_settings เสมอ · ไม่มีอีโมจิ · ยอดเงินจากข้อมูลงานล่าสุดบนหน้าจอ
// ลิงก์ติดตามงานใส่ให้เฉพาะเมื่อร้านเปิดใช้ (portal_enabled)
import { baht, formatThaiDate, formatThaiDayLong } from '@/lib/format'
import { formatPromptPayId, isValidPromptPayId } from '@/lib/promptpay'
import {
  amountDueNow, formatPhone, sessionTimeText, sessionsByDate, normTime,
  type WedBooking, type WedSession, type WedSettings,
} from '@/lib/wedding'
import { EPS } from './rpc'

export type LineTemplate = 'confirm' | 'payment' | 'reminder' | 'delivery' | 'thanks'

export const LINE_TEMPLATES: readonly { key: LineTemplate; label: string }[] = [
  { key: 'confirm', label: 'ยืนยันการจอง' },
  { key: 'payment', label: 'แจ้งชำระเงิน' },
  { key: 'reminder', label: 'เตือนก่อนวันงาน' },
  { key: 'delivery', label: 'ส่งงาน' },
  { key: 'thanks', label: 'ขอบคุณ' },
]

/** คิวที่ยังไม่ยกเลิกและมีวันที่ เรียงตามวัน/เวลา */
export function datedSessions(b: WedBooking): WedSession[] {
  return sessionsByDate(b.sessions.filter(s => s.status !== 'cancelled' && s.date))
}

/** คิวถัดไป (วันนี้หรืออนาคต) สำหรับข้อความเตือน ; ไม่มี → คิวแรก */
export function nextSession(b: WedBooking, todayKey: string): WedSession | null {
  const list = datedSessions(b)
  return list.find(s => (s.date ?? '') >= todayKey) ?? list[0] ?? null
}

/** แม่แบบที่เหมาะกับสถานะตอนนี้ */
export function suggestedTemplate(b: WedBooking): LineTemplate {
  switch (b.status) {
    case 'inquiry':
    case 'hold':
      return b.money.deposit_met ? 'confirm' : 'payment'
    case 'confirmed':
      return b.money.due > EPS && !b.money.deposit_met ? 'payment' : 'reminder'
    case 'in_production':
    case 'delivered':
      return b.deliverables.some(d => d.status === 'delivered') ? 'delivery' : 'thanks'
    default:
      return 'thanks'
  }
}

function coupleTitle(b: WedBooking): string {
  return b.couple_names.trim() || (b.customer.name ? `คุณ${b.customer.name}` : 'ลูกค้า')
}

// ประเภทคิว + ชื่อคิว (ชื่อซ้ำกับประเภท = ไม่ต่อท้ายซ้ำ)
function sessionName(s: WedSession): string {
  const title = (s.title ?? '').trim()
  return title && title !== s.type_label ? `${s.type_label} (${title})` : s.type_label
}

function sessionLine(s: WedSession): string[] {
  const head = `${formatThaiDayLong(s.date)} · ${sessionName(s)}`
  const out = [`- ${head}`, `  เวลา ${sessionTimeText(s)}`]
  if (s.venue_name) out.push(`  สถานที่: ${s.venue_name}`)
  return out
}

function packageLines(b: WedBooking): string[] {
  const out: string[] = []
  if (b.package.name) out.push(`แพ็กเกจ: ${b.package.name}${b.package.hours > 0 ? ` (${b.package.hours} ชั่วโมง)` : ''}`)
  for (const a of b.addons) out.push(`- ${a.name}${Math.abs(a.qty - 1) > 0.001 ? ` x${a.qty}` : ''}`)
  return out
}

function payInfoLines(s: WedSettings): string[] {
  const out: string[] = []
  if (s.promptpay_id && isValidPromptPayId(s.promptpay_id)) {
    out.push(`พร้อมเพย์: ${formatPromptPayId(s.promptpay_id)}${s.promptpay_name ? ` (${s.promptpay_name})` : ''}`)
  }
  for (const a of s.bank_accounts) {
    out.push(`${a.bank} เลขที่บัญชี ${a.account_no}${a.account_name ? ` ชื่อบัญชี ${a.account_name}` : ''}`)
  }
  return out
}

function contactLine(s: WedSettings): string {
  const parts = [s.phone ? `โทร ${formatPhone(s.phone)}` : '', s.line_id ? `LINE ${s.line_id}` : ''].filter(Boolean)
  return parts.length ? `ติดต่อทีมงาน: ${parts.join(' · ')}` : ''
}

function join(blocks: (string | string[] | null | undefined | false)[]): string {
  const out: string[] = []
  for (const blk of blocks) {
    if (!blk) continue
    const lines = Array.isArray(blk) ? blk : [blk]
    const clean = lines.filter(l => l.trim() !== '')
    if (clean.length) out.push(clean.join('\n'))
  }
  return out.join('\n\n')
}

/**
 * สร้างข้อความตามแม่แบบ
 * portalUrl = ลิงก์เต็มหน้าติดตามงาน ('' = ไม่ใส่) · session = คิวที่ใช้กับข้อความเตือนก่อนวันงาน
 */
export function buildLineMessage(
  tpl: LineTemplate,
  b: WedBooking,
  s: WedSettings,
  portalUrl: string,
  session: WedSession | null,
): string {
  const m = b.money
  const who = coupleTitle(b)
  const link = portalUrl ? `ดูรายละเอียดงาน / ยอดชำระ / สแกนจ่าย: ${portalUrl}` : ''
  switch (tpl) {
    case 'confirm':
      return join([
        [s.shop_name, `ยืนยันการจอง เลขที่ ${b.booking_no}`],
        `เรียน ${who}`,
        datedSessions(b).length ? ['กำหนดการ:', ...datedSessions(b).flatMap(sessionLine)] : 'วันงาน: รอยืนยันวันที่',
        packageLines(b),
        [
          `ยอดสุทธิ ${baht(m.grand_total)}`,
          m.discount > 0 ? `(รวมส่วนลด ${baht(m.discount)})` : '',
          `ชำระแล้ว ${baht(m.paid)}`,
          m.due > EPS ? `คงเหลือ ${baht(m.due)}` : 'ชำระครบแล้ว',
          m.deposit_met ? '' : `มัดจำเพื่อยืนยันคิว ${baht(m.deposit_required)} (ขาดอีก ${baht(m.deposit_due)})`,
          b.next_due && m.due > EPS
            ? `งวดถัดไป: ${b.next_due.label} ${baht(b.next_due.amount)}${b.next_due.due_date ? ` ภายใน ${formatThaiDate(b.next_due.due_date)}` : ''}`
            : '',
        ],
        s.booking_note ?? '',
        link,
        contactLine(s),
      ])
    case 'payment': {
      const now = amountDueNow(b)
      const nd = b.next_due
      const pay = payInfoLines(s)
      return join([
        [s.shop_name, `แจ้งชำระเงิน งานเลขที่ ${b.booking_no}`],
        `เรียน ${who}`,
        now > EPS
          ? [
              `ยอดที่ต้องชำระตอนนี้ ${baht(now)}${nd?.label ? ` (${nd.label})` : ''}`,
              nd?.due_date ? `กรุณาชำระภายใน ${formatThaiDayLong(nd.due_date)}${nd.overdue ? ' (เลยกำหนดแล้ว)' : ''}` : '',
              now < m.due - EPS ? `ยอดคงเหลือทั้งหมด ${baht(m.due)}` : '',
            ]
          : 'ขณะนี้ไม่มียอดค้างชำระ',
        b.status === 'hold' && b.hold_until ? `ทีมงานล็อกคิววันงานไว้ให้ถึง ${formatThaiDate(b.hold_until)} — ชำระมัดจำเพื่อยืนยันคิว` : '',
        pay.length ? ['ช่องทางชำระเงิน:', ...pay] : '',
        'ชำระแล้วรบกวนส่งสลิปทาง LINE นี้ได้เลย',
        link,
        contactLine(s),
      ])
    }
    case 'reminder': {
      const ss = session
      if (!ss) {
        return join([[s.shop_name, `งานเลขที่ ${b.booking_no}`], `เรียน ${who}`, 'ยังไม่มีคิวงานที่ระบุวันที่', contactLine(s)])
      }
      const call = normTime(ss.call_time)
      return join([
        [s.shop_name, `แจ้งเตือนก่อนวันงาน งานเลขที่ ${b.booking_no}`],
        `เรียน ${who}`,
        [
          sessionName(ss),
          `วันที่ ${formatThaiDayLong(ss.date)}`,
          `เวลางาน ${sessionTimeText(ss)}`,
          call ? `ทีมงานจะถึงสถานที่เวลา ${call} น.` : '',
        ],
        [
          ss.venue_name ? `สถานที่: ${ss.venue_name}` : '',
          ss.venue_address ?? '',
          ss.map_url ? `แผนที่: ${ss.map_url}` : '',
        ],
        ss.run_sheet.length
          ? ['กำหนดการ / ฤกษ์:', ...ss.run_sheet.map(r => `- ${r.time ? `${r.time} น. ` : ''}${r.text}`)]
          : '',
        b.coordinator_name ? `ผู้ประสานงานฝั่งลูกค้า: ${b.coordinator_name}${b.coordinator_phone ? ` โทร ${formatPhone(b.coordinator_phone)}` : ''}` : '',
        m.due > EPS ? `ยอดคงเหลือที่ต้องชำระ ${baht(m.due)}${m.balance_due_date ? ` (ภายใน ${formatThaiDate(m.balance_due_date)})` : ''}` : '',
        'หากมีการเปลี่ยนแปลงเวลาหรือสถานที่ รบกวนแจ้งทีมงานล่วงหน้า',
        contactLine(s),
      ])
    }
    case 'delivery': {
      const done = b.deliverables.filter(d => d.status === 'delivered')
      const left = b.deliverables.filter(d => d.status !== 'delivered')
      return join([
        [s.shop_name, `ส่งงาน งานเลขที่ ${b.booking_no}`],
        `เรียน ${who}`,
        done.length
          ? ['งานที่ส่งแล้ว:', ...done.flatMap(d => [
              `- ${d.name}${d.qty > 1 ? ` ${d.qty}${d.unit ? ` ${d.unit}` : ''}` : ''}`,
              d.link_url ? `  ${d.link_url}` : d.note ? `  ${d.note}` : '',
            ])]
          : 'ทีมงานกำลังตัดต่องานให้อยู่',
        left.length
          ? ['งานที่กำลังตามมา:', ...left.map(d => `- ${d.name}${d.due_date ? ` (กำหนด ${formatThaiDate(d.due_date)})` : ''}`)]
          : '',
        done.length ? 'รบกวนดาวน์โหลดเก็บไว้ภายในเวลาที่กำหนด หากเปิดลิงก์ไม่ได้แจ้งทีมงานได้เลย' : '',
        m.due > EPS ? `ยอดคงเหลือที่ต้องชำระ ${baht(m.due)}` : '',
        link,
        contactLine(s),
      ])
    }
    case 'thanks':
      return join([
        [s.shop_name, `ขอบคุณที่ไว้วางใจ งานเลขที่ ${b.booking_no}`],
        `เรียน ${who}`,
        'ขอบคุณที่ให้ทีมงานได้เป็นส่วนหนึ่งในวันสำคัญ ขอให้มีความสุขมากๆ',
        m.due > EPS ? `ยอดคงเหลือที่ต้องชำระ ${baht(m.due)}` : '',
        [
          'ถ้าประทับใจ รบกวนรีวิวหรือแนะนำเพื่อนให้ทีมงานด้วยนะ',
          s.instagram ? `Instagram: ${s.instagram}` : '',
          s.facebook ? `Facebook: ${s.facebook}` : '',
          s.tiktok ? `TikTok: ${s.tiktok}` : '',
        ],
        contactLine(s),
      ])
  }
}
