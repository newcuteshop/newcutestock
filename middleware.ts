import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ดู cookie ของ Supabase โดยตรง
  const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL?.split('//')[1]?.split('.')[0]
  const cookieName = `sb-${projectRef}-auth-token`
  const hasSession = request.cookies.has(cookieName) || request.cookies.has('sb-access-token')

  // ถ้ายังไม่ login และพยายามเข้า dashboard → redirect ไป login
  if (!hasSession && !pathname.startsWith('/login')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // ถ้า login แล้วและเข้า /login → redirect ไป dashboard
  if (hasSession && pathname.startsWith('/login')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth).*)'],
}
