// แท็บของหน้ารายการการจอง (/rental/bookings?tab=...) — ไฟล์ธรรมดา (ไม่ใช่ 'use client') ให้หน้า server อ่านค่าได้
// รอยืนยัน = คำขอจองออนไลน์ + การจองที่พนักงานถือคิวไว้ (สถานะ pending ทั้งคู่ — แถวที่มาจากออนไลน์มีป้าย "ออนไลน์")
// เกินกำหนดคืน = กำลังเช่าและเลยวันคืนแล้ว (แยกแท็บเพราะต้องตามลูกค้าก่อน) ; ยกเลิก = ยกเลิก + หมดเวลาถือคิว + ไม่มารับชุด
import type { RentalBookingStatus } from '@/lib/rental'

export type BookingTab = 'pending' | 'confirmed' | 'active' | 'overdue' | 'returned' | 'completed' | 'cancelled'

export const BOOKING_TABS: readonly { key: BookingTab; label: string; statuses: readonly RentalBookingStatus[]; counted: boolean }[] = [
  { key: 'pending', label: 'รอยืนยัน (ออนไลน์)', statuses: ['pending'], counted: true },
  { key: 'confirmed', label: 'จองแล้ว', statuses: ['confirmed'], counted: true },
  { key: 'active', label: 'กำลังเช่า', statuses: ['picked_up'], counted: true },
  { key: 'overdue', label: 'เกินกำหนดคืน', statuses: ['picked_up'], counted: true },
  { key: 'returned', label: 'คืนแล้วรอปิด', statuses: ['returned'], counted: true },
  { key: 'completed', label: 'เสร็จสิ้น', statuses: ['completed'], counted: false },
  { key: 'cancelled', label: 'ยกเลิก', statuses: ['cancelled', 'expired', 'no_show'], counted: false },
]

export function isBookingTab(v: unknown): v is BookingTab {
  return typeof v === 'string' && BOOKING_TABS.some(t => t.key === v)
}
