import type { CookieOptions } from '@supabase/ssr'

// คุกกี้ session ล้วน: ตัดอายุ (maxAge / expires) ออก → เบราว์เซอร์ไม่เก็บลงดิสก์ ปิดเบราว์เซอร์/แอปแล้วหายเอง
// (@supabase/ssr 0.1.0 ส่ง maxAge ยาวมาก ~400 วันมากับทุกครั้งที่ตั้งคุกกี้)
// ใช้กับ set() เท่านั้น — ห้ามใช้กับ remove() เพราะการลบคุกกี้ต้องใช้ maxAge: 0
export function sessionCookieOptions(options: CookieOptions): CookieOptions {
  const rest: CookieOptions = { ...options }
  delete rest.maxAge
  delete rest.expires
  return rest
}
