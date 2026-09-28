import { createClient } from '@supabase/supabase-js'

// ⚠️ SERVER-ONLY — ใช้ service role key (ข้าม RLS ได้ทั้งหมด)
// เรียกได้เฉพาะใน server action / server component / route handler เท่านั้น
// ห้าม import ในไฟล์ 'use client' เด็ดขาด (key นี้ต้องไม่หลุดไปถึง browser)
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  // ยังไม่ได้ตั้งค่า env → แจ้งเป็นภาษาไทยว่าต้องไปตั้งที่ไหน (แทน error งงๆ จาก supabase-js)
  if (!url || !serviceRoleKey) {
    throw new Error(
      'ยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY บน Vercel (Settings → Environment Variables) — หน้าจัดการผู้ใช้จึงใช้งานไม่ได้'
    )
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
