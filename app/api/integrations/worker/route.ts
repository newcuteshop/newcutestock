// /api/integrations/worker — ตัวทำงานเบื้องหลังของระบบเชื่อมต่อ (ต่ออายุ token → event → ดึงออเดอร์ → ส่งสต๊อก)
// POST  : pg_cron + pg_net (supabase-cron-integrations.sql) ส่ง Authorization: Bearer <INTEGRATIONS_WORKER_SECRET>
//         body {source:'pg_cron', mode:'tick'|'daily'}
// GET   : Vercel Cron (ถ้าตั้งใน vercel.json) ส่ง Authorization: Bearer <CRON_SECRET> → บังคับ mode=daily เสมอ
// อย่างอื่น → 401 ไม่บอกรายละเอียด; คำตอบไม่มีความลับ (มีแต่ตัวเลขสรุป)
import { runWorker } from '@/lib/integrations/worker'
import { timingSafeEqualStr } from '@/lib/integrations/crypto'
import { logError } from '@/lib/integrations/redact'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: NO_STORE })
}

function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? ''
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h)
  return m ? m[1] : null
}

function authorized(req: Request, secret: string | undefined, minLength: number): boolean {
  const token = bearer(req)
  if (!secret || secret.length < minLength || !token) return false
  return timingSafeEqualStr(token, secret)
}

async function run(mode: 'tick' | 'daily'): Promise<Response> {
  try {
    const summary = await runWorker({ mode })
    return json({ ok: true, summary }, 200)
  } catch (e) {
    logError('worker_route', e)
    return json({ ok: false }, 500)
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req, process.env.INTEGRATIONS_WORKER_SECRET, 32)) {
    if (!process.env.INTEGRATIONS_WORKER_SECRET || process.env.INTEGRATIONS_WORKER_SECRET.length < 32) {
      logError('worker_route', 'INTEGRATIONS_WORKER_SECRET is missing or shorter than 32 characters')
    }
    return json({ ok: false }, 401)
  }
  let mode: 'tick' | 'daily' = 'tick'
  try {
    const text = await req.text()
    if (text && text.length <= 4096) {
      const body = JSON.parse(text) as { mode?: unknown }
      if (body && body.mode === 'daily') mode = 'daily'
    }
  } catch {
    // body ผิดรูปแบบ → ใช้ tick
  }
  return run(mode)
}

export async function GET(req: Request): Promise<Response> {
  if (!authorized(req, process.env.CRON_SECRET, 16)) return json({ ok: false }, 401)
  return run('daily')
}
