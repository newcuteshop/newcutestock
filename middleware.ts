import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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
          pending.set(name, { name, value, options })
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

  // ถ้า login แล้วและเข้า /login → redirect ไป dashboard
  if (isLoggedIn && isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.search = ''
    return applyPending(NextResponse.redirect(url))
  }

  return response
}

export const config = {
  // ไม่ต้องตรวจ login กับไฟล์ static และ cron (Vercel Cron ไม่มี cookie ผู้ใช้)
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|ico|webp)$).*)',
  ],
}
