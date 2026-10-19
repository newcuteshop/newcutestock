// ===== QR พร้อมเพย์ (Thai QR Payment / EMVCo Merchant-Presented QR) =====
// สร้างข้อความ (payload) ที่นำไปวาดเป็น QR ให้ลูกค้าสแกนจ่ายด้วยแอปธนาคารไทย — ฟังก์ชันล้วน ใช้ได้ทั้ง server และ client
// โครงสร้าง (แต่ละช่อง = รหัส 2 หลัก + ความยาว 2 หลัก + ค่า):
//   00 '01'               รูปแบบ payload
//   01 '11' | '12'        11 = QR ใช้ซ้ำได้ (ไม่ระบุยอด) · 12 = QR ครั้งเดียว (ระบุยอด) — แอปธนาคารล็อกยอดให้
//   29 [00 AID A000000677010111, 01 มือถือ 0066xxxxxxxxx | 02 เลขผู้เสียภาษี 13 หลัก | 03 e-wallet 15 หลัก]
//   58 'TH' · 53 '764' (บาท) · 54 ยอดเงิน 2 ตำแหน่ง (ถ้ามี)
//   63 CRC16-CCITT (poly 0x1021, เริ่ม 0xFFFF) คำนวณรวม '6304' ท้ายข้อความ เป็นเลขฐาน 16 ตัวใหญ่ 4 หลัก
// ทดสอบกับค่าอ้างอิงที่รู้คำตอบแล้ว (เทียบกับไลบรารี promptpay-qr ที่ใช้กันแพร่หลาย) — ดูรายงานของงานนี้

import { round2 } from '@/lib/money'

const AID_PROMPTPAY = 'A000000677010111'
// ยอดสูงสุดตามคอลัมน์เงินของระบบ numeric(10,2)
const MAX_AMOUNT = 99999999.99

export type PromptPayTargetType = 'mobile' | 'tax_id' | 'ewallet'

export interface PromptPayTarget {
  type: PromptPayTargetType
  /** ตัวเลขล้วนแบบที่ผู้ใช้กรอก (มือถือ = 0xxxxxxxxx 10 หลัก) */
  display: string
  /** ค่าที่ใส่ใน QR (มือถือ = 0066 + 9 หลัก รวม 13 หลัก) */
  value: string
}

/**
 * อ่านรหัสพร้อมเพย์ (ตัดขีด/ช่องว่าง/เครื่องหมาย +) → ชนิดและค่าที่ใช้ใน QR ; รูปแบบไม่ถูกต้อง → null (ไม่ throw)
 * รับได้: มือถือ 10 หลักขึ้นต้น 0 ('081-234-5678'), มือถือแบบรหัสประเทศ ('+66 81 234 5678' / '66812345678'),
 *         เลขประจำตัวผู้เสียภาษี/บัตรประชาชน 13 หลัก, e-wallet ID 15 หลัก
 */
export function parsePromptPayId(id: string | null | undefined): PromptPayTarget | null {
  if (typeof id !== 'string') return null
  // เลขไทย ๐-๙ → 0-9 แล้วเหลือแต่ตัวเลข
  const digits = id.replace(/[๐-๙]/g, ch => String(ch.charCodeAt(0) - 0x0e50)).replace(/\D/g, '')
  if (/^0\d{9}$/.test(digits)) {
    return { type: 'mobile', display: digits, value: '0066' + digits.slice(1) }
  }
  if (/^66\d{9}$/.test(digits)) {
    return { type: 'mobile', display: '0' + digits.slice(2), value: '00' + digits }
  }
  if (/^\d{13}$/.test(digits)) return { type: 'tax_id', display: digits, value: digits }
  if (/^\d{15}$/.test(digits)) return { type: 'ewallet', display: digits, value: digits }
  return null
}

/** รหัสพร้อมเพย์ใช้ได้ไหม (มือถือ 10 หลัก / เลขผู้เสียภาษี 13 หลัก / e-wallet 15 หลัก) */
export function isValidPromptPayId(id: string | null | undefined): boolean {
  return parsePromptPayId(id) !== null
}

// ช่อง EMV: รหัส + ความยาว 2 หลัก + ค่า
function field(tag: string, value: string): string {
  return tag + ('0' + value.length).slice(-2) + value
}

/** CRC16-CCITT (FALSE): poly 0x1021, ค่าเริ่ม 0xFFFF, ไม่กลับบิต — คืนเลขฐาน 16 ตัวใหญ่ 4 หลัก */
export function crc16ccitt(data: string): string {
  let crc = 0xffff
  for (let i = 0; i < data.length; i++) {
    // payload เป็น ASCII ล้วน (ตัวเลข/ตัวอักษรละติน) — ใช้รหัสตัวอักษร 8 บิต
    crc ^= (data.charCodeAt(i) & 0xff) << 8
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return ('000' + crc.toString(16).toUpperCase()).slice(-4)
}

/**
 * ข้อความ QR พร้อมเพย์
 * - id = เบอร์มือถือ / เลขผู้เสียภาษี 13 หลัก / e-wallet 15 หลัก (รูปแบบไม่ถูกต้อง → คืน '' ไม่ throw — ผู้เรียกไม่ต้องวาด QR)
 * - amount = ยอดเงินบาท (ปัด 2 ตำแหน่ง) ; ไม่ส่ง / 0 / ติดลบ / ไม่ใช่ตัวเลข → QR ไม่ระบุยอด (ลูกค้ากรอกเอง)
 *   ยอดเกิน 99,999,999.99 → คืน '' (ระบบรับยอดขนาดนั้นไม่ได้อยู่แล้ว)
 */
export function promptPayPayload(id: string, amount?: number): string {
  const target = parsePromptPayId(id)
  if (!target) return ''
  const amt = typeof amount === 'number' && Number.isFinite(amount) ? round2(amount) : 0
  if (amt > MAX_AMOUNT) return ''
  const hasAmount = amt > 0
  const tagByType: Record<PromptPayTargetType, string> = { mobile: '01', tax_id: '02', ewallet: '03' }
  const merchant = field('00', AID_PROMPTPAY) + field(tagByType[target.type], target.value)
  let data =
    field('00', '01') +
    field('01', hasAmount ? '12' : '11') +
    field('29', merchant) +
    field('58', 'TH') +
    field('53', '764') +
    (hasAmount ? field('54', amt.toFixed(2)) : '')
  data += '6304'
  return data + crc16ccitt(data)
}

/** แสดงรหัสพร้อมเพย์แบบอ่านง่าย: มือถือ 081-234-5678 · เลขผู้เสียภาษี 1-2345-67890-12-3 · อื่นๆ ตามเดิม ; ไม่ถูกต้อง → ข้อความเดิม */
export function formatPromptPayId(id: string | null | undefined): string {
  const t = parsePromptPayId(id)
  if (!t) return typeof id === 'string' ? id : ''
  const d = t.display
  if (t.type === 'mobile') return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
  if (t.type === 'tax_id') return `${d.slice(0, 1)}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d.slice(12)}`
  return d
}
