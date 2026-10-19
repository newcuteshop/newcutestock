// POST /api/book/request — ส่งคำขอจองออนไลน์จากหน้า /book/checkout (ไม่ต้องเข้าสู่ระบบ)
// รับ JSON { client_id: uuid, payload: {...} } (payload ตามสัญญาของ rental_public_request ใน supabase-fix-06-rental-online.sql)
// ขั้นตอน: ตรวจขนาด/รูปแบบ → จำกัดจำนวนครั้งต่อ IP (rental_rate_hit — เกิน = 429) → rpc rental_public_request (service role เท่านั้น)
//   ฐานข้อมูลไม่ให้ anon เรียก rental_public_request ตรงแล้ว (กันสคริปต์ยิงคำขอถือชุดทั้งร้านโดยไม่ผ่านตัวจำกัด)
//   client_id เดิมส่งซ้ำได้ปลอดภัย: RPC คืนคำขอเดิม (already_saved = true)
// ตอบ JSON ภาษาไทยเสมอ: { ok: true, data } | { ok: false, message, missing?, unsure?, rate_limited? }
//   missing = ระบบจองออนไลน์ยังไม่พร้อม (ยังไม่ได้รัน fix-06 / ยังไม่ตั้ง env) · unsure = ไม่ได้คำตอบจากฐานข้อมูล (อาจบันทึกแล้ว)
//   rate_limited = 429 ไม่ได้ส่งถึงฐานข้อมูล (หน้าจอคงคำเตือน "ไม่แน่ใจ" ของครั้งก่อนไว้)
// ไม่ log ข้อมูลลูกค้า (log แค่รหัสข้อผิดพลาด) · middleware ข้ามเส้นทางนี้ (api/book/)
import { createAdminClient } from '@/lib/supabase/admin'
import { isMigrationMissing } from '@/lib/migration'
import { REQUEST_RATE_RULES, RATE_LIMIT_MSG, isRateLimited } from '../_lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// คำขอจริงมีไม่เกิน 10 บรรทัด + ช่องข้อความสั้นๆ — เกินนี้ไม่อ่าน
const MAX_BODY_BYTES = 32 * 1024
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const MSG_GENERIC = 'ส่งคำขอจองไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
const MSG_NOT_READY = 'ระบบจองออนไลน์ยังไม่พร้อมใช้งาน กรุณาติดต่อร้านโดยตรง'
const MSG_BAD_INPUT = 'ข้อมูลการจองไม่ถูกต้อง กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง'

type Body =
  | { ok: true; data: unknown }
  | { ok: false; message: string; missing?: boolean; unsure?: boolean; rate_limited?: boolean }

function reply(status: number, body: Body): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function logFailure(step: string, err: unknown) {
  const e = err && typeof err === 'object' ? (err as { code?: unknown; message?: unknown }) : null
  const code = e?.code ?? ''
  const message = typeof e?.message === 'string' ? e.message.slice(0, 200) : String(err).slice(0, 200)
  console.error(`[api/book/request] ${step} failed`, String(code), message)
}

const THAI = /[฀-๿]/

export async function POST(req: Request): Promise<Response> {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return reply(413, { ok: false, message: MSG_BAD_INPUT })
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return reply(400, { ok: false, message: MSG_BAD_INPUT })
  }

  let body: unknown
  try {
    const text = await req.text()
    if (text.length > MAX_BODY_BYTES) return reply(413, { ok: false, message: MSG_BAD_INPUT })
    body = JSON.parse(text)
  } catch {
    return reply(400, { ok: false, message: MSG_BAD_INPUT })
  }
  const o = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  const clientId = typeof o?.client_id === 'string' ? o.client_id.trim().toLowerCase() : ''
  const payload = o?.payload
  if (!UUID_RE.test(clientId)) return reply(400, { ok: false, message: 'รหัสคำขอไม่ถูกต้อง กรุณาโหลดหน้าใหม่' })
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return reply(400, { ok: false, message: MSG_BAD_INPUT })

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (e) {
    logFailure('config', e)
    return reply(503, { ok: false, message: MSG_NOT_READY, missing: true })
  }

  if (await isRateLimited(admin, 'req', req, REQUEST_RATE_RULES)) return reply(429, { ok: false, message: RATE_LIMIT_MSG, rate_limited: true })

  let data: unknown
  let rpcErr: unknown = null
  try {
    const res = await admin.rpc('rental_public_request', { p_client_id: clientId, p_payload: payload })
    data = res.data
    rpcErr = res.error
  } catch (e) {
    rpcErr = e
  }
  if (rpcErr) {
    logFailure('request', rpcErr)
    if (isMigrationMissing(rpcErr)) return reply(503, { ok: false, message: MSG_NOT_READY, missing: true })
    const e = rpcErr && typeof rpcErr === 'object' ? (rpcErr as { code?: unknown; message?: unknown }) : null
    const code = e && e.code !== null && e.code !== undefined ? String(e.code) : ''
    const message = typeof e?.message === 'string' ? e.message.trim() : ''
    // ไม่มีรหัส = ไม่ได้คำตอบจากฐานข้อมูล (เน็ตระหว่างเซิร์ฟเวอร์กับฐานข้อมูลหลุด) → อาจบันทึกแล้ว ให้หน้าเว็บส่งซ้ำด้วยรหัสเดิม
    if (!code) return reply(503, { ok: false, message: MSG_GENERIC, unsure: true })
    // ข้อความไทยจาก RPC (ชุดไม่ว่าง / เบอร์นี้จองเกินกำหนด / รหัสคำขอถูกใช้แล้ว ฯลฯ) ส่งต่อตามเดิม
    if (THAI.test(message)) return reply(409, { ok: false, message })
    // 42501 ไม่มีข้อความไทย = ยังไม่ได้ให้สิทธิ์ service role (ไฟล์ SQL ยังไม่ครบ)
    if (code === '42501') return reply(503, { ok: false, message: MSG_NOT_READY, missing: true })
    // error ชั่วคราวของฐานข้อมูล (ล็อกชน/หมดเวลา/การเชื่อมต่อ) — ไม่แน่ชัดว่าบันทึกแล้ว
    if (/^(08|40|53|57|58|XX)/.test(code)) return reply(503, { ok: false, message: MSG_GENERIC, unsure: true })
    return reply(400, { ok: false, message: MSG_GENERIC })
  }
  return reply(200, { ok: true, data })
}
