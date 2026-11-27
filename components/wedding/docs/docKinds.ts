// ===== ชนิดเอกสารของร้าน b.oncloud ที่ส่งเป็นรูปให้ลูกค้า/ทีมงาน (DocumentCenter) =====
// ไฟล์นี้ไม่มี JSX/hook — ใช้ได้ทั้ง server และ client
import { bangkokTodayKey } from '@/lib/format'
import { sessionsByDate, type WedBooking, type WedPayment, type WedSession } from '@/lib/wedding'

/**
 * confirmation    = ใบยืนยันการจอง (แบบฟอร์มของร้าน: ลูกค้า วันงาน รายการบริการ เงื่อนไข สรุปยอด ช่องลงชื่อ)
 * quote           = ใบเสนอราคา
 * payment_request = ใบแจ้งชำระเงิน (ยอดที่ต้องชำระตอนนี้ + QR พร้อมเพย์ + บัญชีธนาคาร)
 * receipt         = ใบเสร็จรับเงิน / ใบคืนเงิน (เลือกรายการเงิน)
 * schedule        = ตารางคิววันงาน (เลือกคิว — แบบคู่บ่าวสาว / แบบทีมงาน)
 * delivery        = สรุปการส่งงาน (ชิ้นงาน + ลิงก์)
 */
export type DocKind = 'confirmation' | 'quote' | 'payment_request' | 'receipt' | 'schedule' | 'delivery'

export const DOC_KINDS: readonly DocKind[] = ['confirmation', 'quote', 'payment_request', 'receipt', 'schedule', 'delivery'] as const

export const DOC_KIND_LABELS: Readonly<Record<DocKind, string>> = {
  confirmation: 'ใบยืนยันการจอง',
  quote: 'ใบเสนอราคา',
  payment_request: 'ใบแจ้งชำระเงิน',
  receipt: 'ใบเสร็จรับเงิน',
  schedule: 'ตารางคิววันงาน',
  delivery: 'สรุปการส่งงาน',
}

/** คำอธิบายสั้นใต้ชื่อเอกสารในตัวเลือก */
export const DOC_KIND_HINTS: Readonly<Record<DocKind, string>> = {
  confirmation: 'วันงาน รายการบริการ ยอดเงิน เงื่อนไข ช่องลงชื่อ',
  quote: 'ราคาแพ็กเกจและบริการเสริม',
  payment_request: 'ยอดที่ต้องชำระ + QR พร้อมเพย์',
  receipt: 'รายการรับเงิน/คืนเงิน 1 รายการ',
  schedule: 'เวลา สถานที่ กำหนดการวันงาน',
  delivery: 'ชิ้นงานและลิงก์ส่งงาน',
}

/** คำในชื่อไฟล์รูป (ละตินล้วน — ชื่อไฟล์ภาษาไทยบันทึก/แชร์ไม่ได้ในบางเครื่อง) */
export const DOC_FILE_SLUG: Readonly<Record<DocKind, string>> = {
  confirmation: 'confirmation',
  quote: 'quotation',
  payment_request: 'payment-request',
  receipt: 'receipt',
  schedule: 'schedule',
  delivery: 'delivery',
}

export function isDocKind(v: unknown): v is DocKind {
  return typeof v === 'string' && (DOC_KINDS as readonly string[]).includes(v)
}

/** ตัวเลือกบนเอกสาร */
export interface DocOptions {
  /** แสดงราคา/ยอดเงิน (ใช้กับใบยืนยัน / ตารางคิวแบบคู่บ่าวสาว / สรุปส่งงาน — เอกสารเงินแสดงเสมอ ตารางทีมงานไม่แสดงเสมอ) */
  showPrices: boolean
  /** แสดงเงื่อนไข (ใบยืนยัน / ใบเสนอราคา / ใบแจ้งชำระ) */
  showTerms: boolean
  /** ตารางคิวแบบทีมงาน: แสดงทีม + เวลาทีมถึงงาน + เบอร์ติดต่อ ซ่อนเงินทั้งหมด */
  forCrew: boolean
  /** ใบเสร็จ: รายการเงินที่เลือก */
  paymentId: string | null
  /** ตารางคิว: คิวที่เลือก (null = ทุกคิว) */
  sessionId: string | null
}

/** ตัวเลือก "แสดงราคา" ใช้กับเอกสารนี้ไหม (false = เอกสารกำหนดเอง) */
export function pricesToggleApplies(kind: DocKind, forCrew: boolean): boolean {
  return kind === 'confirmation' || kind === 'delivery' || (kind === 'schedule' && !forCrew)
}

/** ราคาบนเอกสารนี้แสดงจริงไหม (หลังรวมกฎของชนิดเอกสาร) */
export function pricesShown(kind: DocKind, o: Pick<DocOptions, 'showPrices' | 'forCrew'>): boolean {
  if (kind === 'quote' || kind === 'payment_request' || kind === 'receipt') return true
  if (kind === 'schedule' && o.forCrew) return false
  return o.showPrices
}

/** ตัวเลือก "แสดงเงื่อนไข" ใช้กับเอกสารนี้ไหม */
export function termsToggleApplies(kind: DocKind): boolean {
  return kind === 'confirmation' || kind === 'quote' || kind === 'payment_request'
}

/** คิวที่ยังไม่ยกเลิก เรียงตามวัน/เวลา */
export function activeSessions(b: WedBooking): WedSession[] {
  return sessionsByDate(b.sessions.filter(s => s.status !== 'cancelled'))
}

/** คิวเริ่มต้นของตารางคิว: คิวถัดไปที่ยังไม่ถึง (วันนี้หรือหลังจากนี้) → ไม่มีก็คิวแรก ; ไม่มีคิวเลย → null (ทุกคิว) */
export function defaultSessionId(b: WedBooking, today = bangkokTodayKey()): string | null {
  const list = activeSessions(b)
  if (list.length <= 1) return list[0]?.id ?? null
  const upcoming = list.find(s => s.date && s.date >= today)
  return (upcoming ?? list[0]).id
}

/**
 * วันครบกำหนดชำระยอดสุดท้าย: งวดสุดท้ายของแผนงวด (บอสแก้แผนงวดเองได้ — balance_due_date ของงานอาจไม่ตรงกับแผนแล้ว)
 * ไม่มีแผนงวด → balance_due_date · ใช้ได้ทั้งงานเต็ม (wed_get_booking) และหน้าติดตามงาน (wed_public_booking)
 */
export function finalDueDate(b: {
  installments: readonly { due_date: string | null }[]
  money: { balance_due_date: string | null }
}): string | null {
  const last = b.installments.length > 0 ? b.installments[b.installments.length - 1] : null
  return last?.due_date ?? b.money.balance_due_date ?? null
}

/** รายการเงินที่ทำใบเสร็จได้ (ล่าสุดก่อน — ยกเลิกแล้วอยู่ท้าย) */
export function receiptPayments(b: WedBooking): WedPayment[] {
  return [...b.payments].sort((a, c) => {
    const va = a.voided_at ? 1 : 0
    const vc = c.voided_at ? 1 : 0
    if (va !== vc) return va - vc
    return (c.created_at || '').localeCompare(a.created_at || '')
  })
}

/** ใบเสร็จเริ่มต้น: ตามที่ขอมา (ถ้ามีจริง) → รายการล่าสุดที่ไม่ถูกยกเลิก → รายการล่าสุด */
export function defaultPaymentId(b: WedBooking, wanted?: string | null): string | null {
  if (wanted && b.payments.some(p => p.id === wanted)) return wanted
  return receiptPayments(b)[0]?.id ?? null
}

/** ชื่อไฟล์รูปของเอกสาร เช่น 'WD-20261123-001-receipt-WR-20261123-002' (ยังไม่มีนามสกุล) */
export function docFileBase(b: WedBooking, kind: DocKind, extra?: string | null): string {
  const parts = [b.booking_no || 'booking', DOC_FILE_SLUG[kind]]
  if (extra) parts.push(extra)
  return parts.join('-')
}
