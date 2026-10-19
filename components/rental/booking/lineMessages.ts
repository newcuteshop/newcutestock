// ===== ข้อความสำเร็จรูปสำหรับส่ง LINE ลูกค้า (คัดลอกไปวางเอง — ระบบไม่ได้ส่งให้อัตโนมัติ) =====
// ใช้ชื่อร้านจาก rental_settings เสมอ · ไม่มีอีโมจิ · ยอดเงินจากการจองล่าสุดบนหน้าจอ
import { baht, formatThaiDate, formatThaiDayLong } from '@/lib/format'
import { sizeLabel, type RentalBooking, type RentalSettings } from '@/lib/rental'
import { depositOutstanding } from './rpc'

export type LineTemplate = 'confirm' | 'payment' | 'pickup' | 'return' | 'thanks'

export const LINE_TEMPLATES: readonly { key: LineTemplate; label: string }[] = [
  { key: 'confirm', label: 'ยืนยันการจอง' },
  { key: 'payment', label: 'แจ้งชำระเงิน' },
  { key: 'pickup', label: 'เตือนวันรับชุด' },
  { key: 'return', label: 'เตือนวันคืนชุด' },
  { key: 'thanks', label: 'ขอบคุณ' },
]

/** แม่แบบที่เหมาะกับสถานะตอนนี้ (เลือกให้ก่อนเมื่อเปิดหน้าต่าง) */
export function suggestedTemplate(b: RentalBooking): LineTemplate {
  switch (b.status) {
    case 'pending': return b.money.deposit_met ? 'confirm' : 'payment'
    case 'confirmed': return b.money.due > 0.005 && !b.money.deposit_met ? 'payment' : 'pickup'
    case 'picked_up': return 'return'
    default: return 'thanks'
  }
}

function itemLines(b: RentalBooking): string[] {
  return b.lines.map(l => `- ${l.item_name} (${l.item_code}) ไซส์ ${sizeLabel(l.size)} ${baht(l.rent_price)}`)
}

function periodLines(b: RentalBooking): string[] {
  const out = [
    `รับชุด: ${formatThaiDayLong(b.pickup_date)}${b.pickup_time ? ` เวลา ${b.pickup_time}` : ''}`,
    `คืนชุด: ${formatThaiDayLong(b.return_date)} (รวม ${b.days} วัน)`,
  ]
  if (b.event_date) out.push(`วันงาน: ${formatThaiDate(b.event_date)}`)
  if (b.fitting_date) out.push(`นัดลองชุด: ${formatThaiDate(b.fitting_date)}${b.fitting_time ? ` เวลา ${b.fitting_time}` : ''}`)
  if (b.delivery_method === 'delivery') out.push(`จัดส่งชุดที่: ${b.delivery_address ?? '-'}`)
  return out
}

function payInfoLines(s: RentalSettings): string[] {
  const out: string[] = []
  if (s.promptpay_id) out.push(`พร้อมเพย์: ${s.promptpay_id}${s.promptpay_name ? ` (${s.promptpay_name})` : ''}`)
  for (const a of s.bank_accounts) {
    out.push(`${a.bank} เลขที่บัญชี ${a.account_no}${a.account_name ? ` ชื่อบัญชี ${a.account_name}` : ''}`)
  }
  return out
}

function contactLine(s: RentalSettings): string {
  const parts = [s.phone ? `โทร ${s.phone}` : '', s.line_id ? `LINE ${s.line_id}` : ''].filter(Boolean)
  return parts.length ? `ติดต่อร้าน: ${parts.join(' · ')}` : ''
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

/** สร้างข้อความตามแม่แบบ ; statusUrl = ลิงก์เต็มหน้าสถานะการจอง (ว่าง = ไม่ใส่) */
export function buildLineMessage(
  tpl: LineTemplate,
  b: RentalBooking,
  s: RentalSettings,
  statusUrl: string,
): string {
  const m = b.money
  const name = b.customer.name ? `คุณ${b.customer.name}` : 'ลูกค้า'
  const link = statusUrl ? `ดูสถานะการจอง / แนบสลิป: ${statusUrl}` : ''
  switch (tpl) {
    case 'confirm':
      return join([
        [s.shop_name, `ยืนยันการจองชุด เลขที่ ${b.booking_no}`],
        `เรียน ${name}`,
        periodLines(b),
        ['รายการชุด:', ...itemLines(b)],
        [
          `ค่าเช่ารวม ${baht(m.rent_total)}`,
          m.discount > 0 ? `ส่วนลด -${baht(m.discount)}` : '',
          m.delivery_fee > 0 ? `ค่าจัดส่ง ${baht(m.delivery_fee)}` : '',
          `ยอดรวม ${baht(m.grand_total)}`,
          `ชำระแล้ว ${baht(m.paid)}`,
          m.due > 0.005 ? `คงเหลือชำระ ${baht(m.due)}` : 'ชำระครบแล้ว',
          m.security_required > 0 ? `เงินประกันชุด ${baht(m.security_required)} (วางในวันรับชุด ได้คืนเมื่อคืนชุดครบสภาพดี)` : '',
        ],
        link,
        contactLine(s),
      ])
    case 'payment': {
      const deposit = depositOutstanding(b)
      const amountLine = deposit > 0.005 && deposit < m.due - 0.005
        ? [`มัดจำที่ต้องชำระเพื่อยืนยันการจอง ${baht(deposit)}`, `ยอดคงเหลือทั้งหมด ${baht(m.due)}`]
        : [`ยอดที่ต้องชำระ ${baht(Math.max(0, m.due))}`]
      const expiry = b.status === 'pending' && b.expires_at
        ? `กรุณาชำระภายใน ${formatThaiDate(b.expires_at)} เวลา ${timeOf(b.expires_at)} น. (ระบบถือชุดไว้ให้ถึงเวลานี้)`
        : ''
      const pay = payInfoLines(s)
      return join([
        [s.shop_name, `แจ้งชำระเงิน การจองเลขที่ ${b.booking_no}`],
        `เรียน ${name}`,
        amountLine,
        expiry,
        pay.length ? ['ช่องทางชำระเงิน:', ...pay] : '',
        'โอนแล้วรบกวนแนบสลิปผ่านลิงก์ด้านล่าง หรือส่งสลิปทาง LINE นี้ได้เลย',
        link,
        contactLine(s),
      ])
    }
    case 'pickup':
      return join([
        [s.shop_name, `แจ้งเตือนวันรับชุด การจองเลขที่ ${b.booking_no}`],
        `เรียน ${name}`,
        periodLines(b),
        ['รายการชุด:', ...itemLines(b)],
        [
          m.due > 0.005 ? `ยอดคงเหลือที่ต้องชำระวันรับชุด ${baht(m.due)}` : 'ชำระค่าเช่าครบแล้ว',
          m.security_required - m.security_held > 0.005
            ? `เงินประกันชุดที่ต้องวาง ${baht(m.security_required - m.security_held)} (ได้คืนเมื่อคืนชุดครบสภาพดี)`
            : '',
          'กรุณานำบัตรประชาชนตัวจริงมาในวันรับชุด',
        ],
        s.address && b.delivery_method === 'pickup' ? `ที่อยู่ร้าน: ${s.address}` : '',
        s.opening_hours ? `เวลาเปิดร้าน: ${s.opening_hours}` : '',
        link,
        contactLine(s),
      ])
    case 'return': {
      const perDay = s.late_fee_mode === 'per_day_item'
        ? b.lines.reduce((sum, l) => sum + l.extra_day_price, 0)
        : s.late_fee_mode === 'fixed_per_day' ? s.late_fee_fixed : 0
      return join([
        [s.shop_name, `แจ้งเตือนวันคืนชุด การจองเลขที่ ${b.booking_no}`],
        `เรียน ${name}`,
        `กำหนดคืนชุด: ${formatThaiDayLong(b.return_date)}`,
        ['รายการที่ต้องคืน:', ...b.lines.map(l => `- ${l.item_name} ไซส์ ${sizeLabel(l.size)} [${l.unit_code}]`)],
        [
          perDay > 0 ? `คืนช้ากว่ากำหนดมีค่าปรับ ${baht(perDay)} ต่อวัน` : '',
          'ไม่ต้องซักหรือรีดชุดเอง ร้านดูแลทำความสะอาดให้',
          m.due > 0.005 ? `ยอดคงเหลือที่ต้องชำระ ${baht(m.due)}` : '',
        ],
        s.address ? `ที่อยู่ร้าน: ${s.address}` : '',
        contactLine(s),
      ])
    }
    case 'thanks': {
      const secOut = b.payments
        .filter(p => p.kind === 'security_out' && p.status === 'confirmed' && !p.voided_at)
        .reduce((sum, p) => sum + p.amount, 0)
      // ยกเลิก/หมดเวลา/ไม่มารับ ไม่ได้รับชุดคืน → ไม่พูดถึงการคืนชุด
      const gotBack = b.status === 'returned' || b.status === 'completed'
      return join([
        [s.shop_name, `ขอบคุณที่ใช้บริการ การจองเลขที่ ${b.booking_no}`],
        `เรียน ${name}`,
        [
          gotBack ? 'ร้านได้รับชุดคืนเรียบร้อยแล้ว' : '',
          secOut > 0.005 ? `คืนเงินประกันให้แล้ว ${baht(secOut)}` : '',
          b.money.security_held > 0.005 ? `เงินประกันคงเหลือที่ร้านจะคืนให้ ${baht(b.money.security_held)}` : '',
          b.money.due > 0.005 ? `ยอดคงเหลือที่ต้องชำระ ${baht(b.money.due)}` : '',
        ],
        'หวังว่าจะได้ดูแลอีกในโอกาสหน้า',
        contactLine(s),
      ])
    }
  }
}

// เวลา HH:mm ตามเวลาไทยจาก ISO
const timeFmt = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false, numberingSystem: 'latn',
})
function timeOf(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '-'
  return timeFmt.format(d).replace(/^24:/, '00:')
}
