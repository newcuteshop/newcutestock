// "ประตูเข้าระบบ" ต่อหน้าต่าง — เปิดลิงก์ระบบ / แอปที่ติดตั้ง / แท็บหรือหน้าต่างใหม่ ต้องผ่านหน้าเข้าสู่ระบบก่อนทุกครั้ง
// - ธง sessionStorage 'newcute-entered' = '1' ตั้งตอนเข้าสู่ระบบสำเร็จในหน้าต่างนี้ (app/(auth)/login/page.tsx)
//   sessionStorage แยกต่อแท็บ/หน้าต่าง, อยู่รอดการกด F5 และการเปลี่ยนหน้าในแอป, หายเมื่อปิดหน้าต่าง
// - ไม่มีธง = หน้าต่างใหม่ → สคริปต์ใน <head> ล็อกหน้าจอก่อนวาด (html[data-gate="locked"] ซ่อนทุกอย่าง — app/globals.css)
//   แล้ว components/auth/EntryGate.tsx เพิกถอน session เดิม + พาไปหน้าเข้าสู่ระบบ
// - อ่าน/เขียน sessionStorage ไม่ได้ (เบราว์เซอร์บล็อก) = ถือว่ายังไม่ได้เข้าสู่ระบบ (fail closed)
// ไฟล์นี้ไม่มี 'use client' เพราะ app/layout.tsx (server) ต้องใช้ ENTRY_GATE_BOOT_SCRIPT — ฟังก์ชันด้านล่างเรียกได้เฉพาะฝั่งเบราว์เซอร์

export const ENTRY_FLAG_KEY = 'newcute-entered'

// รันใน <head> ก่อนหน้าเว็บแสดงผล (ต่อท้าย MOTION_BOOT_SCRIPT ในสคริปต์เดียวกัน) — ทุกหน้ายกเว้น /login และหน้าจองออนไลน์สาธารณะ
// /book (ลูกค้าเปิดจาก LINE/โซเชียล ไม่มีบัญชี) — เทียบทั้งท่อน: '/book' หรือขึ้นต้น '/book/' เท่านั้น (/booking, /bookx ยังถูกล็อก)
// + หน้าติดตามงานของคู่บ่าวสาว ร้าน b.oncloud: '/wedding-status' หรือขึ้นต้น '/wedding-status/' เท่านั้น
//   (หลังร้าน '/wedding', '/wedding/...' และ '/wedding-statusx' ยังถูกล็อก)
// ต้องตรงกับ isPublicPath ด้านล่าง และ matcher ใน middleware.ts
export const ENTRY_GATE_BOOT_SCRIPT = `(function(){var p=location.pathname,ok=false;if(p==='/login'||p.indexOf('/login/')===0||p==='/book'||p.indexOf('/book/')===0||p==='/wedding-status'||p.indexOf('/wedding-status/')===0)return;try{ok=window.sessionStorage.getItem('${ENTRY_FLAG_KEY}')==='1'}catch(e){}if(!ok)document.documentElement.setAttribute('data-gate','locked')})()`

// เบราว์เซอร์ปิด JavaScript = สคริปต์ประตูเข้าระบบไม่ทำงาน (ไม่ล็อกหน้าจอ ไม่พาไปหน้าเข้าสู่ระบบ)
// → ซ่อนหน้าระบบทั้งหมดแทน (fail closed) แล้วบอกให้เปิด JavaScript — ใช้ใน <noscript> ของ layout หน้าที่ต้องเข้าสู่ระบบ
// (ชุดเดียวกับที่ app/(dashboard)/layout.tsx เขียนไว้เอง) ตัวห่อหน้าต้องมีคลาส .app-shell
export const NOSCRIPT_LOCK_HTML =
  '<style>.app-shell{display:none!important}</style>' +
  '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;text-align:center">' +
  '<p style="margin:0;max-width:22rem;font-size:15px;line-height:1.7;color:#201B1D">' +
  'ต้องเปิด JavaScript ก่อนจึงจะใช้ระบบได้<br><a href="/login" style="color:#A43D56;font-weight:600">ไปหน้าเข้าสู่ระบบ</a>' +
  '</p></div>'

/**
 * หน้าสาธารณะ (ไม่ต้องเข้าสู่ระบบ ไม่มีประตูเข้าระบบ): '/book', '/book/...' และ API '/api/book/...'
 * เทียบทั้งท่อนของ path — '/booking', '/bookx', '/api/book' (ไม่มี / ท้าย) ไม่นับเป็นสาธารณะ
 * + หน้าติดตามงานของคู่บ่าวสาว (ร้าน b.oncloud): '/wedding-status', '/wedding-status/<token>'
 *   ('/wedding', '/wedding/...', '/wedding-statusx' ไม่ใช่สาธารณะ — หลังร้านต้องเข้าสู่ระบบเสมอ)
 * ใช้ได้ทั้ง middleware (edge), server และ client (ไม่มีโค้ดเบราว์เซอร์)
 */
export function isPublicPath(pathname: string | null | undefined): boolean {
  if (typeof pathname !== 'string') return false
  return (
    pathname === '/book' || pathname.startsWith('/book/') || pathname.startsWith('/api/book/') ||
    pathname === '/wedding-status' || pathname.startsWith('/wedding-status/')
  )
}

// หน้าต่างนี้เข้าสู่ระบบเองแล้วหรือยัง
export function hasEnteredThisWindow(): boolean {
  try {
    return window.sessionStorage.getItem(ENTRY_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

// จำว่าหน้าต่างนี้เข้าสู่ระบบแล้ว (คืน false ถ้าเบราว์เซอร์ไม่ให้เขียน)
export function markEnteredThisWindow(): boolean {
  try {
    window.sessionStorage.setItem(ENTRY_FLAG_KEY, '1')
    return window.sessionStorage.getItem(ENTRY_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

// ลืมการเข้าสู่ระบบของหน้าต่างนี้ (หน้าเข้าสู่ระบบ / ออกจากระบบ)
export function clearEnteredThisWindow(): void {
  try {
    window.sessionStorage.removeItem(ENTRY_FLAG_KEY)
  } catch {
    // เบราว์เซอร์บล็อก storage → ไม่มีธงให้ลบอยู่แล้ว
  }
}

// เบราว์เซอร์นี้ใช้ sessionStorage ได้ไหม — ถ้าไม่ได้ เข้าสู่ระบบไปก็จะถูกพากลับหน้าเข้าสู่ระบบวนไป
export function windowStorageWorks(): boolean {
  try {
    const probe = 'newcute-probe'
    window.sessionStorage.setItem(probe, '1')
    const ok = window.sessionStorage.getItem(probe) === '1'
    window.sessionStorage.removeItem(probe)
    return ok
  } catch {
    return false
  }
}

// ปิดหน้าจอทั้งหมด (เหลือแผ่น "กำลังตรวจสอบการเข้าระบบ...")
export function lockEntryGate(): void {
  document.documentElement.setAttribute('data-gate', 'locked')
}

// เปิดหน้าจอ
export function unlockEntryGate(): void {
  document.documentElement.removeAttribute('data-gate')
}
