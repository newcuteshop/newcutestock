import { createBrowserClient, type CookieOptions } from '@supabase/ssr'

// คุกกี้ session ฝั่งเบราว์เซอร์ — เขียนเองแทนค่าเริ่มต้นของ @supabase/ssr 0.1.0 (ซึ่งตั้งอายุคุกกี้ ~400 วัน)
// - ไม่ใส่ Max-Age / Expires → เป็นคุกกี้ session: ปิดเบราว์เซอร์/แอปแล้วหาย ไม่ค้างในดิสก์ (ตอนต่ออายุ token ด้วย)
// - อ่าน/เขียนรูปแบบเดียวกับค่าเริ่มต้นของไลบรารี (แพ็กเกจ cookie): ค่าเข้ารหัส encodeURIComponent, อ่านตัวแรกที่เจอ
// - การแบ่งชิ้น (sb-xxx-auth-token.0, .1, ...) ไลบรารีจัดการเองผ่าน get/set/remove — ต้องมี get ด้วยจึงลบชิ้นได้ครบ
// - ตอน render ฝั่งเซิร์ฟเวอร์ (ไม่มี document) อ่านได้ว่าง / เขียนไม่ทำอะไร

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined
  const all = document.cookie
  if (!all) return undefined
  for (const part of all.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue
    let value = part.slice(eq + 1).trim()
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
  return undefined
}

// maxAge: ไม่ส่ง = คุกกี้ session, 0 = ลบ
function writeCookie(name: string, value: string, options: CookieOptions, maxAge?: number) {
  if (typeof document === 'undefined') return
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path || '/'}`, 'SameSite=Lax']
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`)
  if (window.location.protocol === 'https:') parts.push('Secure')
  document.cookie = parts.join('; ')
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return readCookie(name)
        },
        // ไลบรารีส่ง maxAge ~400 วันมาใน options เสมอ → ไม่ใช้ (เขียนเป็นคุกกี้ session)
        set(name: string, value: string, options: CookieOptions) {
          writeCookie(name, value, options)
        },
        remove(name: string, options: CookieOptions) {
          writeCookie(name, '', options, 0)
        },
      },
    }
  )
}
