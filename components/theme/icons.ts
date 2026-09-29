// ค่าตั้งต้นของไอคอน lucide-react ให้เหมือนกันทั้งระบบ (ขนาด 18-22px, เส้น ~1.8, ซ่อนจากโปรแกรมอ่านจอ)
// ใช้: import { ICON } from '@/components/theme/icons' แล้ว <ShoppingCart {...ICON} />
// ไอคอนที่สื่อความหมายเอง (ไม่มีข้อความข้างๆ) ให้ใส่ aria-label ที่ "ปุ่ม" ไม่ใช่ที่ไอคอน

export const ICON = { size: 20, strokeWidth: 1.8, 'aria-hidden': true } as const
export const ICON_SM = { size: 18, strokeWidth: 1.9, 'aria-hidden': true } as const
export const ICON_LG = { size: 22, strokeWidth: 1.8, 'aria-hidden': true } as const
