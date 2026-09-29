'use server'
import type { AuthError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { thaiError } from '@/lib/format'
import { checkRawPassword, loginToEmail, toAuthPassword, utf8Length } from '@/lib/auth/credentials'

// รหัสผ่านเดิม (ตั้งก่อนมีระบบชื่อผู้ใช้) Supabase บังคับอย่างน้อย 6 "ไบต์" (อักษรไทย 1 ตัว = 3 ไบต์)
// — สั้นกว่านี้ไม่มีทางเป็นรหัสเดิม ไม่ต้องลองแบบเดิม
const LEGACY_MIN_PASSWORD_BYTES = 6

// Supabase ตอบว่า "อีเมลหรือรหัสผ่านผิด" (ไม่ใช่เน็ตหลุด / ถูกจำกัดความถี่ / ยังไม่ยืนยันอีเมล)
function isInvalidCredentials(err: AuthError): boolean {
  if (err.code === 'invalid_credentials') return true
  return err.status === 400 && /invalid login credentials/i.test(err.message ?? '')
}

export async function loginAction(
  login: string,
  password: string
): Promise<{ success?: boolean; error?: string }> {
  // ชื่อผู้ใช้ตัดช่องว่าง + แปลงเป็นตัวเล็กให้ (มือถือชอบเติมเว้นวรรค/ตัวใหญ่ให้เอง) — รหัสผ่านไม่ตัด
  const resolved = loginToEmail(String(login ?? ''))
  if ('error' in resolved) return { error: resolved.error }
  const raw = String(password ?? '')
  const legacyPossible = utf8Length(raw) >= LEGACY_MIN_PASSWORD_BYTES
  // รหัสยาวเกินแบบใหม่แต่ยาวพอเป็นรหัสเดิมได้ → ยังให้ลองแบบเดิม
  const pwError = checkRawPassword(raw)
  if (pwError && !legacyPossible) return { error: pwError }

  try {
    const supabase = createClient()
    const email = resolved.email
    let error: AuthError | null = null

    // 1) รหัสผ่านแบบใหม่ (มี prefix — ดู lib/auth/credentials.ts)
    if (!pwError) {
      error = (await supabase.auth.signInWithPassword({ email, password: toAuthPassword(raw) })).error
    }
    // 2) รหัสผ่านเดิมที่ตั้งก่อนเปลี่ยนระบบ (ไม่มี prefix) — ลองอีกครั้งเฉพาะกรณี "รหัสผิด" และยาว 6 ไบต์ขึ้นไป
    //    (ถ้ามี pwError แปลว่ายาวเกินแบบใหม่ ซึ่งผ่านเช็คความยาวขั้นต่ำด้านบนมาแล้ว)
    if (pwError || (error && isInvalidCredentials(error) && legacyPossible)) {
      error = (await supabase.auth.signInWithPassword({ email, password: raw })).error
    }

    if (error) {
      // กดผิดหลายครั้งติดกัน → Supabase จำกัดความถี่
      if (error.status === 429) return { error: 'ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' }
      return { error: thaiError(error) }
    }
    return { success: true }
  } catch (e: unknown) {
    return { error: thaiError(e) }
  }
}
