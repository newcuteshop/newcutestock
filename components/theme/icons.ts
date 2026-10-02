// ค่าตั้งต้นของไอคอน lucide-react ให้เหมือนกันทั้งระบบ (เส้น 1.75 บางเรียบ ซ่อนจากโปรแกรมอ่านจอ)
// ใช้: import { ICON } from '@/components/theme/icons' แล้ว <ShoppingCart {...ICON} />
// ICON 20px = เมนู/ปุ่ม · ICON_SM 18px = ในปุ่ม/ช่องกรอก/กล่องข้อความ · ICON_XS 16px = ป้าย/แถวตาราง · ICON_LG 22px = ปุ่มไอคอนบนแถบ
// ไอคอนที่สื่อความหมายเอง (ไม่มีข้อความข้างๆ) ให้ใส่ aria-label ที่ "ปุ่ม" ไม่ใช่ที่ไอคอน

export const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true } as const
export const ICON_SM = { size: 18, strokeWidth: 1.75, 'aria-hidden': true } as const
export const ICON_XS = { size: 16, strokeWidth: 1.9, 'aria-hidden': true } as const
export const ICON_LG = { size: 22, strokeWidth: 1.75, 'aria-hidden': true } as const
