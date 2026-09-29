// ตรวจลิงก์หน้าอนุญาตของแพลตฟอร์มก่อนพาเบราว์เซอร์ไป (กันพาออกไปเว็บอื่น แม้เซิร์ฟเวอร์ตรวจมาแล้วอีกชั้น)
// ตรงกับ AUTH_REDIRECT_HOSTS ใน lib/integrations/http.ts (ไฟล์นั้นเป็นฝั่งเซิร์ฟเวอร์ import ในหน้าเว็บไม่ได้)
const AUTH_HOSTS = ['open.shopee.com', 'open.sandbox.test-stable.shopee.com', 'auth.lazada.com', 'services.tiktokshop.com']
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]']

/** URL ที่ปลอดภัย (https + โฮสต์ที่รู้จัก) หรือ null ; loopback ยอมเฉพาะตอนหน้าเว็บเปิดจากเครื่องทดสอบ */
export function safeAuthUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (u.protocol === 'https:' && AUTH_HOSTS.includes(u.hostname)) return u.toString()
    if (typeof window !== 'undefined' && LOOPBACK.includes(window.location.hostname) && LOOPBACK.includes(u.hostname)) {
      return u.toString()
    }
  } catch { /* URL เสีย */ }
  return null
}
