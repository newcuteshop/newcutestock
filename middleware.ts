import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { sessionCookieOptions } from '@/lib/supabase/cookies'

type PendingCookie = { name: string; value: string; options: CookieOptions }

export async function middleware(request: NextRequest) {
  // เก็บทุก cookie ที่ Supabase ตั้ง/ลบระหว่าง request นี้
  // session ถูกแบ่งเป็นหลายชิ้น (sb-xxx-auth-token.0, .1, ...) — ถ้าไม่เก็บไว้ครบ
  // ชิ้นก่อนหน้าจะหายตอนสร้าง response ใหม่ แล้วผู้ใช้จะหลุดออกจากระบบ
  const pending = new Map<string, PendingCookie>()

  function applyPending(res: NextResponse): NextResponse {
    pending.forEach(({ name, value, options }) => {
      res.cookies.set({ name, value, ...options })
    })
    return res
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          // อัปเดต request ด้วย เพื่อให้ server component เห็น session ใหม่ทันที
          request.cookies.set(name, value)
          // คุกกี้ session (ไม่มีวันหมดอายุ) → ปิดเบราว์เซอร์/แอปแล้วต้องเข้าสู่ระบบใหม่
          pending.set(name, { name, value, options: sessionCookieOptions(options) })
          response = applyPending(NextResponse.next({ request }))
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.delete(name)
          pending.set(name, { name, value: '', options: { ...options, maxAge: 0 } })
          response = applyPending(NextResponse.next({ request }))
        },
      },
    }
  )

  // getUser() ตรวจ token กับ Supabase และต่ออายุ session ถ้าใกล้หมด (จะเรียก set/remove ด้านบน)
  let isLoggedIn = false
  try {
    const { data: { user } } = await supabase.auth.getUser()
    isLoggedIn = !!user
  } catch {
    // เชื่อมต่อ Supabase ไม่ได้ → ถือว่ายังไม่ login (fail-closed)
    isLoggedIn = false
  }

  const isLoginPage = request.nextUrl.pathname.startsWith('/login')

  // ถ้ายังไม่ login และพยายามเข้าหน้าอื่น → redirect ไป login
  if (!isLoggedIn && !isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return applyPending(NextResponse.redirect(url))
  }

  // login อยู่แล้วแต่เปิด /login → ไม่พาไป dashboard อีกต่อไป: หน้าเข้าสู่ระบบต้องโชว์ฟอร์มเสมอ
  // (หน้านั้นออกจากระบบเดิมให้เอง — ต้องเข้าสู่ระบบใหม่ทุกครั้งที่เปิดลิงก์ ดู lib/auth/entry-gate.ts)

  return response
}

export const config = {
  // ไม่ต้องตรวจ login กับไฟล์ static และ cron (Vercel Cron ไม่มี cookie ผู้ใช้)
  // /api/integrations/* (webhook / OAuth callback / worker) และ /api/feed/* ยืนยันตัวตนเอง (ลายเซ็น / state / Bearer / โทเคนฟีด)
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|api/cron|api/integrations/|api/feed/|.*\\.(?:svg|png|jpg|jpeg|gif|ico|webp|webmanifest)$).*)',
  ],
}
