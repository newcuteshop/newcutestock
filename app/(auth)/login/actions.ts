'use server'
import { createClient } from '@/lib/supabase/server'
import { thaiError } from '@/lib/format'

export async function loginAction(
  email: string,
  password: string
): Promise<{ success?: boolean; error?: string }> {
  // ตัดช่องว่างหน้า-หลังอีเมล (มือถือชอบเติมเว้นวรรคท้ายคำให้เอง) — รหัสผ่านไม่ตัด
  const cleanEmail = String(email ?? '').trim()
  const pass = String(password ?? '')
  if (!cleanEmail || !pass) return { error: 'กรุณากรอกอีเมลและรหัสผ่าน' }

  try {
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password: pass })
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
