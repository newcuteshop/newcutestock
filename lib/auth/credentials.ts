// ===== ชื่อผู้ใช้ / รหัสผ่าน สำหรับเข้าสู่ระบบ =====
// pure functions ล้วน (ไม่แตะ window/document) — ใช้ได้ทั้ง client component, server component และ server action
//
// ทำไมต้องแปลง: Supabase Auth รับแค่ "อีเมล + รหัสผ่าน" และบังคับรหัสผ่านอย่างน้อย 6 ตัว
// แต่ร้านอยากใช้ชื่อสั้นๆ เช่น "max" และรหัสผ่านกี่ตัวก็ได้ (เช่น "max") จึงแปลงก่อนส่งให้ Supabase
//   - ชื่อผู้ใช้ "max"  → อีเมล "max@newcute.com" (บัญชีเดิม max@newcute.com จึงใช้ชื่อ "max" ได้ทันที)
//   - รหัสผ่าน "max"   → "newcute:max" (ยาวเกิน 6 ตัวเสมอ)
// prefix นี้ไม่ใช่ความลับหรือระบบความปลอดภัยเพิ่ม เป็นแค่ตัวแปลงรูปแบบให้ Supabase ยอมรับเท่านั้น
// รหัสผ่านที่ตั้งไว้ก่อนเปลี่ยนระบบ (ไม่มี prefix) ยังเข้าได้ — หน้า login ลองแบบเดิมให้อีกรอบ (ดู app/(auth)/login/actions.ts)
// ตั้งรหัสผ่านตรงใน Supabase Dashboard / SQL ต้องใส่ 'newcute:' นำหน้าเอง (หรือตั้งจากเมนูจัดการผู้ใช้ในแอป)

export const USERNAME_DOMAIN = 'newcute.com'
export const AUTH_PASSWORD_PREFIX = 'newcute:'

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_EMAIL = 254
const MAX_AUTH_PASSWORD_BYTES = 72 // ข้อจำกัดของ bcrypt ที่ Supabase ใช้ (นับเป็นไบต์ ตัวไทย 1 ตัว = 3 ไบต์)

const MSG_EMPTY_LOGIN = 'กรุณากรอกชื่อผู้ใช้'
const MSG_BAD_USERNAME = 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z, 0-9, จุด (.), ขีด (- _) และยาวไม่เกิน 32 ตัว'
const MSG_BAD_EMAIL = 'รูปแบบอีเมลไม่ถูกต้อง'

/** ชื่อผู้ใช้ (หรืออีเมล) ที่พิมพ์มา → อีเมลที่ใช้กับ Supabase Auth ; 'Max ' -> { email: 'max@newcute.com' } */
export function loginToEmail(input: string): { email: string } | { error: string } {
  const login = String(input ?? '').trim().toLowerCase()
  if (!login) return { error: MSG_EMPTY_LOGIN }

  // มี @ = อีเมลเต็ม ใช้ตามนั้น (บัญชีที่ใช้อีเมลอยู่แล้วเข้าได้เหมือนเดิม)
  if (login.includes('@')) {
    if (login.length > MAX_EMAIL || !EMAIL_RE.test(login)) return { error: MSG_BAD_EMAIL }
    return { email: login }
  }

  if (!USERNAME_RE.test(login)) return { error: MSG_BAD_USERNAME }
  return { email: `${login}@${USERNAME_DOMAIN}` }
}

/** อีเมลใน Auth → ข้อความที่แสดง/ให้พิมพ์ตอน login ; 'max@newcute.com' -> 'max', อีเมลโดเมนอื่น -> อีเมลเต็ม */
export function displayLogin(email: string | null | undefined): string {
  if (email === null || email === undefined) return ''
  const full = String(email).trim()
  const lower = full.toLowerCase()
  const suffix = '@' + USERNAME_DOMAIN
  if (lower.endsWith(suffix)) {
    const name = lower.slice(0, -suffix.length)
    // ตัดโดเมนเฉพาะชื่อที่พิมพ์กลับเข้ามาได้จริง (กันแสดงชื่อที่ login ไม่ได้)
    if (USERNAME_RE.test(name)) return name
  }
  return full
}

/** รหัสผ่านที่ผู้ใช้พิมพ์ → รหัสผ่านที่ส่งให้ Supabase (ห้าม trim — เว้นวรรคถือเป็นส่วนหนึ่งของรหัส) */
export function toAuthPassword(raw: string): string {
  return AUTH_PASSWORD_PREFIX + String(raw ?? '')
}

// ความยาวแบบ UTF-8 (จำนวนไบต์) — นับเองให้ได้ผลเหมือนกันทุกที่ ไม่พึ่ง TextEncoder
// Supabase นับความยาวรหัสผ่านเป็นไบต์แบบนี้ (ขั้นต่ำ 6 และเพดาน bcrypt 72)
export function utf8Length(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4 // อีโมจิ/อักษรนอก BMP (surrogate pair)
      i++
    } else n += 3
  }
  return n
}

/** ตรวจรหัสผ่านที่ผู้ใช้พิมพ์ ; null = ใช้ได้ (ขั้นต่ำแค่ 1 ตัว) */
export function checkRawPassword(raw: string): string | null {
  const password = String(raw ?? '')
  if (password === '') return 'กรุณากรอกรหัสผ่าน'
  if (utf8Length(toAuthPassword(password)) > MAX_AUTH_PASSWORD_BYTES) return 'รหัสผ่านยาวเกินไป'
  return null
}
