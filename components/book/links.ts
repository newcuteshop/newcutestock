// ===== หน้าจองออนไลน์: ลิงก์ติดต่อร้าน (โทร / LINE / Facebook) =====
// ค่ามาจากตั้งค่าร้านเช่า (พนักงานกรอก) แต่ยังกรองซ้ำ: ยอมรับเฉพาะ http(s) → กันลิงก์ javascript: / data: หลุดมาเป็นปุ่ม
// ฟังก์ชันล้วน ใช้ได้ทั้ง server และ client
import { phoneDigits } from '@/lib/rental'

/** URL ที่ปลอดภัยสำหรับใส่ใน href (http/https เท่านั้น) ; อย่างอื่น → null */
export function safeHttpUrl(url: string | null | undefined): string | null {
  const s = typeof url === 'string' ? url.trim() : ''
  if (!s) return null
  try {
    const u = new URL(s)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

/** ลิงก์โทรออก 'tel:0812345678' ; เบอร์สั้นผิดรูป → null */
export function telHref(phone: string | null | undefined): string | null {
  const d = phoneDigits(phone)
  return d.length >= 9 && d.length <= 15 ? `tel:${d}` : null
}

/**
 * ลิงก์แชท LINE: ใช้ line_url ที่ร้านตั้งไว้ก่อน ; ไม่มี → สร้างจาก LINE ID
 *   บัญชีทางการ (@xxx) → https://line.me/R/ti/p/%40xxx · บัญชีส่วนตัว → https://line.me/ti/p/~id
 */
export function lineHref(lineUrl: string | null | undefined, lineId: string | null | undefined): string | null {
  const direct = safeHttpUrl(lineUrl)
  if (direct) return direct
  const id = typeof lineId === 'string' ? lineId.trim() : ''
  if (!id || id.length > 50 || /\s/.test(id)) return null
  if (id.startsWith('@')) return `https://line.me/R/ti/p/${encodeURIComponent(id)}`
  return `https://line.me/ti/p/~${encodeURIComponent(id)}`
}
