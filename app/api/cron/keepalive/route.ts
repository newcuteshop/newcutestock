import { createClient } from '@supabase/supabase-js'

// Supabase แพ็กเกจฟรีจะหยุดโปรเจกต์อัตโนมัติถ้าไม่มีการใช้งาน 7 วัน
// (เคยโดนหยุดไป 5 เดือน) — Vercel Cron เรียก route นี้วันละครั้ง (ดู vercel.json)
// เพื่อให้ฐานข้อมูลมีความเคลื่อนไหวเสมอ
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const at = new Date().toISOString()

  // ถ้าตั้ง CRON_SECRET ไว้ Vercel จะส่ง header นี้มาให้เองตอนเรียก cron
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ ok: false, at }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    console.error('[keepalive] missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY')
    return Response.json({ ok: false, at }, { status: 500 })
  }

  try {
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    // query เบาๆ 1 ครั้ง — anon ถูก RLS กันไว้จะได้ [] กลับมา แต่ก็นับเป็นการใช้งานแล้ว
    const { error } = await supabase.from('categories').select('id').limit(1)
    if (error) console.error('[keepalive] supabase error:', error.message)
    return Response.json({ ok: !error, at }, { status: error ? 500 : 200 })
  } catch (e) {
    console.error('[keepalive] failed:', e instanceof Error ? e.message : e)
    return Response.json({ ok: false, at }, { status: 500 })
  }
}
