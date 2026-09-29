// "ประตูเข้าระบบ" ต่อหน้าต่าง — เปิดลิงก์ระบบ / แอปที่ติดตั้ง / แท็บหรือหน้าต่างใหม่ ต้องผ่านหน้าเข้าสู่ระบบก่อนทุกครั้ง
// - ธง sessionStorage 'newcute-entered' = '1' ตั้งตอนเข้าสู่ระบบสำเร็จในหน้าต่างนี้ (app/(auth)/login/page.tsx)
//   sessionStorage แยกต่อแท็บ/หน้าต่าง, อยู่รอดการกด F5 และการเปลี่ยนหน้าในแอป, หายเมื่อปิดหน้าต่าง
// - ไม่มีธง = หน้าต่างใหม่ → สคริปต์ใน <head> ล็อกหน้าจอก่อนวาด (html[data-gate="locked"] ซ่อนทุกอย่าง — app/globals.css)
//   แล้ว components/auth/EntryGate.tsx เพิกถอน session เดิม + พาไปหน้าเข้าสู่ระบบ
// - อ่าน/เขียน sessionStorage ไม่ได้ (เบราว์เซอร์บล็อก) = ถือว่ายังไม่ได้เข้าสู่ระบบ (fail closed)
// ไฟล์นี้ไม่มี 'use client' เพราะ app/layout.tsx (server) ต้องใช้ ENTRY_GATE_BOOT_SCRIPT — ฟังก์ชันด้านล่างเรียกได้เฉพาะฝั่งเบราว์เซอร์

export const ENTRY_FLAG_KEY = 'newcute-entered'

// รันใน <head> ก่อนหน้าเว็บแสดงผล (ต่อท้าย MOTION_BOOT_SCRIPT ในสคริปต์เดียวกัน) — ทุกหน้ายกเว้น /login
export const ENTRY_GATE_BOOT_SCRIPT = `(function(){var p=location.pathname,ok=false;if(p==='/login'||p.indexOf('/login/')===0)return;try{ok=window.sessionStorage.getItem('${ENTRY_FLAG_KEY}')==='1'}catch(e){}if(!ok)document.documentElement.setAttribute('data-gate','locked')})()`

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
