// lib/integrations/labels.ts — ชื่อภาษาไทยของช่องทางขาย/วิธีชำระ (ไฟล์เล็ก ให้หน้าขาย POS / รายงาน import ได้
// โดยไม่ลากข้อมูลตั้งค่าแพลตฟอร์มทั้งหมดใน platforms.ts เข้า bundle ของหน้าที่ใช้บ่อย) — platforms.ts re-export ต่อ
import type { ManualSaleChannel, PaymentMethod, SaleChannel } from './types'

export const SALE_CHANNEL_LABELS: Record<SaleChannel, string> = {
  store: 'หน้าร้าน',
  facebook: 'Facebook',
  instagram: 'Instagram',
  line_chat: 'แชต LINE',
  other_chat: 'แชตอื่นๆ',
  line: 'LINE SHOPPING',
  meta: 'Facebook/IG (แค็ตตาล็อก)',
  shopee: 'Shopee',
  lazada: 'Lazada',
  tiktok: 'TikTok Shop',
  generic: 'ช่องทางอื่น',
}

export const MANUAL_SALE_CHANNEL_OPTIONS: { value: ManualSaleChannel; label: string }[] = [
  { value: 'store', label: 'หน้าร้าน' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'line_chat', label: 'แชต LINE' },
  { value: 'other_chat', label: 'แชตอื่นๆ' },
]

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'เงินสด',
  transfer: 'โอนเงิน',
  credit: 'บัตรเครดิต',
  marketplace: 'ชำระผ่านแพลตฟอร์ม',
}

/** ชื่อช่องทางขายของบิล (ค่าที่ไม่รู้จัก = แสดงค่าเดิม) */
export function saleChannelLabel(channel: string | null | undefined): string {
  if (!channel) return SALE_CHANNEL_LABELS.store
  return (SALE_CHANNEL_LABELS as Record<string, string>)[channel] ?? channel
}
