'use server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

// ออกจากระบบฝั่งเซิร์ฟเวอร์ — ใช้ตอนเปิดหน้าต่างใหม่ (components/auth/EntryGate.tsx) และตอนเปิดหน้าเข้าสู่ระบบ
// (ดู lib/auth/entry-gate.ts) · เป็น server action จึงเข้าคิวต่อกับ loginAction เสมอ (Next.js รัน action ทีละตัว)
// → การออกจากระบบที่ค้างอยู่จะไม่มีทางไปลบคุกกี้ของการเข้าสู่ระบบครั้งใหม่
// 1) เพิกถอน session นี้ที่ Supabase — scope 'local' = เฉพาะ session ของเบราว์เซอร์นี้ ไม่เตะเครื่องอื่นของผู้ใช้คนเดียวกัน
// 2) ลบคุกกี้ sb-* ทุกชิ้นเสมอ แม้ข้อ 1 ล้มเหลว (เน็ตหลุด / session หมดอายุ) — และเพราะ removeItem ฝั่งเซิร์ฟเวอร์ของ
//    @supabase/ssr 0.1.0 ไม่รอให้ลบคุกกี้ที่แบ่งชิ้น (.0, .1, ...) เสร็จ
//    (รายชื่อคุกกี้อ่านจาก cookie store ของ Next.js เอง — ไม่ได้เปลี่ยน cookie API ของ Supabase ซึ่งยังเป็น get/set/remove)
export async function signOutAction(): Promise<{ ok: boolean }> {
  let ok = true
  try {
    const { error } = await createClient().auth.signOut({ scope: 'local' })
    if (error) ok = false
  } catch {
    ok = false
  }

  try {
    const store = cookies()
    for (const { name } of store.getAll()) {
      if (name.startsWith('sb-')) store.set({ name, value: '', path: '/', maxAge: 0 })
    }
  } catch {
    ok = false
  }

  return { ok }
}
