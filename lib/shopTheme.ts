// ธีมสีแยกตามร้าน — บอสเลือกธีม #18 "ฟ้าใส (Sky)" ให้ร้านเช่าชุด (แถบเมนูสีตามธีม) เมื่อ 22/10/2569
// ร้าน NEWCUTE ต้องคงโรสโกลด์ทางการแบบเดิมทุกจุด ห้ามเปลี่ยน
// ร้านที่ 3 b.oncloud (คอนเทนต์งานแต่ง /wedding/*, หน้าติดตามงานคู่บ่าวสาว /wedding-status/*) = ธีม #13 "ทองแชมเปญ (Champagne)" (23/11/2569)
// - สีทั้งหมดของ brand/gray/canvas/ink อยู่ในตัวแปร CSS (app/globals.css) ที่สลับตาม data-shop
//   ':root, [data-shop="newcute"]' = โรสโกลด์ · '[data-shop="rental"]' = ฟ้าใส · '[data-shop="wedding"]' = ทองแชมเปญ
// - <html data-shop> ตั้งจาก SHOP_THEME_BOOT_SCRIPT ใน <head> ก่อนวาดหน้าแรก (โหลดหน้าเต็ม / F5)
//   และจาก components/theme/ShopThemeSync.tsx ตอนเปลี่ยนหน้าในแอป (soft navigation ไม่รันสคริปต์ใน <head> ซ้ำ)
// ไฟล์นี้ไม่มี 'use client' เพราะ app/layout.tsx (server) ใช้ SHOP_THEME_BOOT_SCRIPT — ฟังก์ชัน cssColor เรียกได้ทั้งสองฝั่ง

export type ShopTheme = 'newcute' | 'rental' | 'wedding'

/**
 * ร้านของ path นี้ — '/rental', '/rental/...', '/book', '/book/...' = ร้านเช่าชุด
 * '/wedding', '/wedding/...', '/wedding-status', '/wedding-status/...' = ร้าน b.oncloud ; อื่นๆ = NEWCUTE
 * เทียบทั้งท่อน: '/rentals', '/booking', '/weddingx', '/wedding-statusx' ยังเป็น NEWCUTE (ต้องตรงกับ SHOP_THEME_BOOT_SCRIPT ด้านล่าง)
 */
export function shopThemeForPath(pathname: string | null | undefined): ShopTheme {
  if (typeof pathname !== 'string') return 'newcute'
  const under = (base: string) => pathname === base || pathname.startsWith(base + '/')
  if (under('/rental') || under('/book')) return 'rental'
  if (under('/wedding') || under('/wedding-status')) return 'wedding'
  return 'newcute'
}

// รันใน <head> ก่อนหน้าเว็บแสดงผล (ต่อท้าย ENTRY_GATE_BOOT_SCRIPT ในสคริปต์เดียวกัน) → หน้าร้านเช่า/ร้าน b.oncloud ไม่กระพริบเป็นสีชมพูก่อน
// ห้ามโยน error (ห่อ try) — สคริปต์นี้อยู่ร่วมกับสคริปต์ล็อกหน้าจอ
export const SHOP_THEME_BOOT_SCRIPT = `(function(){try{var p=location.pathname,r=function(b){return p===b||p.indexOf(b+'/')===0};document.documentElement.setAttribute('data-shop',r('/rental')||r('/book')?'rental':r('/wedding')||r('/wedding-status')?'wedding':'newcute')}catch(e){}})()`

/**
 * อ่านสีจากตัวแปร CSS ของธีม (ค่าเป็นเลข R G B คั่นช่องว่าง เช่น '--c-brand-400') เป็น 'rgb(r, g, b)' / 'rgba(r, g, b, a)'
 * ใช้กับของที่วาดเองบน canvas (Chart.js, รูป QR) ซึ่งใช้คลาส Tailwind ไม่ได้ — อ่านตอนวาดจึงได้สีของร้านที่เปิดอยู่
 * ฝั่งเซิร์ฟเวอร์ / อ่านไม่ได้ → fallback
 */
export function cssColor(name: string, fallback: string, alpha?: number, el?: Element | null): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback
  try {
    const raw = getComputedStyle(el ?? document.documentElement).getPropertyValue(name).trim()
    if (!/^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/.test(raw)) return fallback
    // แบบมีจุลภาค (rgb(r, g, b)) — canvas/Chart.js ในเบราว์เซอร์เก่าอ่านได้แน่นอนกว่าแบบคั่นช่องว่าง
    const [r, g, b] = raw.split(/\s+/)
    return alpha === undefined ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`
  } catch {
    return fallback
  }
}
