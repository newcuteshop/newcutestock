// แท็บของหน้ารายการงาน (/wedding/bookings?tab=...) — ไฟล์ธรรมดา (ไม่ใช่ 'use client') ให้หน้า server อ่านค่าได้
// 1 แท็บ = 1 สถานะของงาน (ลำดับตามวงจรงาน: สอบถาม → ล็อกคิว → ยืนยัน → ถ่ายเสร็จรอส่ง → ส่งแล้ว → ปิดงาน ; เลื่อน/ยกเลิก ท้ายสุด)
// counted = แสดงจำนวนบนแท็บ (งานที่ยังต้องดูแล) ; ปิดงาน/ยกเลิก ไม่นับ (มีแต่เพิ่มขึ้นเรื่อยๆ)
// sort 'asc' = วันงานใกล้สุดก่อน (งานที่ต้องทำต่อ) · 'desc' = วันงานล่าสุดก่อน (ประวัติ)
import { WED_STATUS_SHORT, type WedBookingStatus } from '@/lib/wedding'

export type BookingTab = WedBookingStatus

export const BOOKING_TABS: readonly { key: BookingTab; label: string; counted: boolean; sort: 'asc' | 'desc' }[] = [
  { key: 'inquiry', label: WED_STATUS_SHORT.inquiry, counted: true, sort: 'asc' },
  { key: 'hold', label: WED_STATUS_SHORT.hold, counted: true, sort: 'asc' },
  { key: 'confirmed', label: WED_STATUS_SHORT.confirmed, counted: true, sort: 'asc' },
  { key: 'in_production', label: WED_STATUS_SHORT.in_production, counted: true, sort: 'asc' },
  { key: 'delivered', label: WED_STATUS_SHORT.delivered, counted: true, sort: 'asc' },
  { key: 'completed', label: WED_STATUS_SHORT.completed, counted: false, sort: 'desc' },
  { key: 'postponed', label: WED_STATUS_SHORT.postponed, counted: true, sort: 'asc' },
  { key: 'cancelled', label: WED_STATUS_SHORT.cancelled, counted: false, sort: 'desc' },
]

export function isBookingTab(v: unknown): v is BookingTab {
  return typeof v === 'string' && BOOKING_TABS.some(t => t.key === v)
}

/** การเรียงรายการ: auto = ตามแท็บ */
export type BookingSort = 'auto' | 'event_asc' | 'event_desc' | 'created_desc'
export const BOOKING_SORTS: readonly { value: BookingSort; label: string }[] = [
  { value: 'auto', label: 'ตามสถานะ' },
  { value: 'event_asc', label: 'วันงานใกล้สุดก่อน' },
  { value: 'event_desc', label: 'วันงานล่าสุดก่อน' },
  { value: 'created_desc', label: 'สร้างล่าสุดก่อน' },
]

export function isBookingSort(v: unknown): v is BookingSort {
  return typeof v === 'string' && BOOKING_SORTS.some(s => s.value === v)
}
