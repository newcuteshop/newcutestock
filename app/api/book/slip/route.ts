// POST /api/book/slip — ลูกค้าส่งสลิปโอนเงินจากหน้าสถานะการจอง /book/status/<token> (ไม่ต้องเข้าสู่ระบบ)
// รับ multipart/form-data: token (64 ตัวฐาน 16), amount (ยอดที่ลูกค้าแจ้ง), note (ไม่บังคับ ≤ 200),
//                          upload_id (uuid ที่เครื่องลูกค้าสุ่มต่อ 1 รูป — ส่งซ้ำได้ไม่บันทึกซ้ำ), file (jpg/png/webp ≤ 5 MB)
// ขั้นตอน: ตรวจรูปแบบทั้งหมด → จำกัดจำนวนครั้งต่อ IP (rental_rate_hit — เกิน = 429) → หา booking จากโทเคน (service role)
//          → สถานะต้องเป็น รอยืนยัน/จองแล้ว → ไฟล์ชื่อเดิมเคยบันทึกเป็นรายการเงินแล้ว = ตอบสำเร็จเลย (เน็ตหลุดแล้วกดซ้ำ)
//          → นับสลิปแบบเดียวกับ RPC: ที่ยังนับ (รอตรวจ/อนุมัติ ไม่ถูกยกเลิก) ไม่เกิน 5 และที่เคยส่งทั้งหมดไม่เกิน 10
//          → อัปโหลดเข้าถังส่วนตัว rental-slips/<booking_id>/<upload_id>.<ext> → rpc rental_public_add_slip (service role เท่านั้น)
//          → RPC ไม่สำเร็จแน่ชัด = ลบไฟล์ทิ้ง
// ตอบ JSON ภาษาไทยเสมอ { ok, message?, already_saved? } · ไม่ log โทเคน/ข้อมูลลูกค้า (log แค่รหัสข้อผิดพลาด)
// middleware ข้ามเส้นทางนี้ (api/book/) — ยืนยันตัวตนด้วยโทเคนการจองเอง
import { createAdminClient } from '@/lib/supabase/admin'
import { isMigrationMissing } from '@/lib/migration'
import { MAX_RENTAL_MONEY, MAX_SLIPS_PER_BOOKING, MAX_SLIP_UPLOADS_PER_BOOKING, RENTAL_SLIP_BUCKET, isBookingToken } from '@/lib/rental'
import { RATE_LIMIT_MSG, SLIP_RATE_RULES, isRateLimited } from '../_lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_FILE_BYTES = 5 * 1024 * 1024
// ทั้งคำขอ (ไฟล์ + ช่องอื่น + ขอบเขต multipart) — เกินนี้ไม่อ่าน body เลย
const MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024
const MAX_NOTE = 200
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const MSG_GENERIC = 'ส่งสลิปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
const MSG_NOT_READY = 'ระบบรับสลิปออนไลน์ยังไม่พร้อมใช้งาน กรุณาส่งสลิปให้ร้านทาง LINE หรือโทรแจ้งร้าน'

function reply(status: number, body: { ok: boolean; message?: string; already_saved?: boolean; unsure?: boolean }): Response {
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

function fail(status: number, message: string): Response {
  return reply(status, { ok: false, message })
}

// log เฉพาะขั้นตอน + รหัส/ข้อความข้อผิดพลาดของระบบ (ไม่มีโทเคน ชื่อ เบอร์ หรือเนื้อไฟล์)
function logFailure(step: string, err: unknown) {
  const e = err && typeof err === 'object' ? (err as { code?: unknown; message?: unknown; statusCode?: unknown }) : null
  const code = e?.code ?? e?.statusCode ?? ''
  const message = typeof e?.message === 'string' ? e.message.slice(0, 200) : String(err).slice(0, 200)
  console.error(`[api/book/slip] ${step} failed`, String(code), message)
}

// ตรวจชนิดไฟล์จากไบต์หัวไฟล์จริง (ไม่เชื่อชนิดที่เบราว์เซอร์แจ้งมา)
function sniffImage(b: Uint8Array): { type: 'image/jpeg' | 'image/png' | 'image/webp'; ext: 'jpg' | 'png' | 'webp' } | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' }
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return { type: 'image/png', ext: 'png' }
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return { type: 'image/webp', ext: 'webp' }
  }
  return null
}

// ยอดเงิน: ตัวเลขบวก ทศนิยมไม่เกิน 2 ตำแหน่ง (เครื่องลูกค้าส่ง '1500.00') ; ผิดรูป → null
function parseAmount(v: FormDataEntryValue | null): number | null {
  if (typeof v !== 'string') return null
  const t = v.trim().replace(/,/g, '')
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 && n <= MAX_RENTAL_MONEY ? Math.round(n * 100) / 100 : null
}

export async function POST(req: Request): Promise<Response> {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return fail(413, 'รูปสลิปใหญ่เกิน 5 MB กรุณาเลือกรูปที่เล็กลง')
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) {
    return fail(400, 'ข้อมูลที่ส่งมาไม่ถูกต้อง กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง')
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return fail(400, 'อ่านข้อมูลที่ส่งมาไม่ได้ กรุณาลองใหม่อีกครั้ง')
  }

  // ----- ตรวจรูปแบบทั้งหมดก่อนแตะฐานข้อมูล -----
  const tokenRaw = form.get('token')
  const token = typeof tokenRaw === 'string' ? tokenRaw.trim().toLowerCase() : ''
  if (!isBookingToken(token)) return fail(404, 'ไม่พบการจองนี้ กรุณาเปิดลิงก์สถานะการจองอีกครั้ง')

  const amount = parseAmount(form.get('amount'))
  if (amount === null) return fail(400, 'กรุณาระบุยอดเงินที่โอนให้ถูกต้อง (มากกว่า 0 บาท)')

  const noteRaw = form.get('note')
  const note = typeof noteRaw === 'string' ? noteRaw.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim() : ''
  if (note.length > MAX_NOTE) return fail(400, `หมายเหตุยาวเกิน ${MAX_NOTE} ตัวอักษร`)

  const uploadRaw = form.get('upload_id')
  const uploadId = typeof uploadRaw === 'string' && UUID_RE.test(uploadRaw.trim().toLowerCase())
    ? uploadRaw.trim().toLowerCase()
    : crypto.randomUUID().toLowerCase()

  const file = form.get('file')
  if (!file || typeof file === 'string') return fail(400, 'กรุณาแนบรูปสลิป')
  if (file.size <= 0) return fail(400, 'ไฟล์รูปว่างเปล่า กรุณาเลือกรูปใหม่')
  if (file.size > MAX_FILE_BYTES) return fail(413, 'รูปสลิปใหญ่เกิน 5 MB กรุณาเลือกรูปที่เล็กลง')
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return fail(400, 'อ่านไฟล์รูปไม่ได้ กรุณาเลือกรูปใหม่')
  }
  const kind = sniffImage(bytes)
  if (!kind) return fail(415, 'รองรับเฉพาะรูป JPG, PNG หรือ WEBP')

  // ----- ฐานข้อมูล (service role — ข้าม RLS; ใช้เฉพาะในไฟล์นี้ฝั่งเซิร์ฟเวอร์) -----
  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (e) {
    logFailure('config', e)
    return fail(503, MSG_NOT_READY)
  }

  // นับก่อนแตะข้อมูลการจอง — ส่งซ้ำด้วย upload_id เดิมก็นับ (ค่าเผื่อไว้กว้างพอสำหรับการกดซ้ำตอนเน็ตหลุด)
  if (await isRateLimited(admin, 'slip', req, SLIP_RATE_RULES)) return fail(429, RATE_LIMIT_MSG)

  const { data: booking, error: bookingErr } = await admin
    .from('rental_bookings')
    .select('id, status')
    .eq('public_token', token)
    .maybeSingle()
  if (bookingErr) {
    logFailure('find booking', bookingErr)
    return isMigrationMissing(bookingErr) ? fail(503, MSG_NOT_READY) : fail(503, MSG_GENERIC)
  }
  const row = booking as { id?: unknown; status?: unknown } | null
  const bookingId = row && typeof row.id === 'string' ? row.id.toLowerCase() : ''
  if (!bookingId) return fail(404, 'ไม่พบการจองนี้ กรุณาเปิดลิงก์สถานะการจองอีกครั้ง')
  if (row?.status !== 'pending' && row?.status !== 'confirmed') {
    return fail(409, 'การจองนี้ส่งสลิปออนไลน์ไม่ได้แล้ว กรุณาติดต่อร้านโดยตรง')
  }

  const path = `${bookingId}/${uploadId}.${kind.ext}`

  // ส่งซ้ำ (เน็ตหลุดตอนรอคำตอบรอบก่อน) — รูปนี้ถูกบันทึกเป็นรายการรอตรวจแล้ว → ตอบสำเร็จ ไม่บันทึกซ้ำ
  const { data: existing, error: existErr } = await admin
    .from('rental_payments')
    .select('id')
    .eq('booking_id', bookingId)
    .eq('slip_path', path)
    .limit(1)
  if (existErr) {
    logFailure('check duplicate', existErr)
    return fail(503, MSG_GENERIC)
  }
  if (Array.isArray(existing) && existing.length > 0) return reply(200, { ok: true, already_saved: true })

  // นับแบบเดียวกับ rental_public_add_slip → ไม่อัปโหลดไฟล์ทิ้งเปล่าๆ
  //   สลิปที่ยังนับ = รอตรวจ/อนุมัติแล้ว และไม่ถูกยกเลิกรายการ (ไม่อนุมัติ = ไม่นับ ส่งใหม่ได้) < 5
  //   สลิปที่เคยส่งทั้งหมด (ทุกสถานะ รวมที่ยกเลิก/ไม่อนุมัติ) < 10 — กันส่งรูปถล่มด้วยการให้ร้านกดไม่อนุมัติวนไป
  const [active, all] = await Promise.all([
    admin
      .from('rental_payments')
      .select('id', { count: 'exact', head: true })
      .eq('booking_id', bookingId)
      .not('slip_path', 'is', null)
      .is('voided_at', null)
      .in('status', ['pending_review', 'confirmed']),
    admin
      .from('rental_payments')
      .select('id', { count: 'exact', head: true })
      .eq('booking_id', bookingId)
      .not('slip_path', 'is', null),
  ])
  const countErr = active.error ?? all.error
  if (countErr) {
    logFailure('count slips', countErr)
    return fail(503, MSG_GENERIC)
  }
  if ((active.count ?? 0) >= MAX_SLIPS_PER_BOOKING || (all.count ?? 0) >= MAX_SLIP_UPLOADS_PER_BOOKING) {
    return fail(409, `ส่งสลิปได้ไม่เกิน ${MAX_SLIPS_PER_BOOKING} รูปต่อการจอง — กรุณาส่งเพิ่มทาง LINE ของร้าน`)
  }

  // upsert: รอบก่อนอัปโหลดสำเร็จแต่บันทึกรายการไม่สำเร็จ → ไฟล์ชื่อเดิมเขียนทับได้ (เป็นรูปเดิมจากเครื่องเดิม)
  const { error: upErr } = await admin.storage.from(RENTAL_SLIP_BUCKET).upload(path, bytes, {
    contentType: kind.type,
    upsert: true,
  })
  if (upErr) {
    logFailure('upload', upErr)
    return fail(502, 'อัปโหลดรูปสลิปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
  }

  const { error: rpcErr } = await admin.rpc('rental_public_add_slip', {
    p_token: token,
    p_path: path,
    p_amount: amount,
    p_note: note || null,
  })
  if (rpcErr) {
    logFailure('add slip', rpcErr)
    const code = String((rpcErr as { code?: unknown }).code ?? '')
    const message = typeof rpcErr.message === 'string' ? rpcErr.message.trim() : ''
    // ฐานข้อมูลตอบปฏิเสธแน่ชัด = ไม่ได้บันทึก → ลบไฟล์ทิ้ง (เน็ตหลุดระหว่างทาง = อาจบันทึกแล้ว เก็บไฟล์ไว้)
    const definite = code !== '' || /[฀-๿]/.test(message)
    if (definite) {
      const { error: rmErr } = await admin.storage.from(RENTAL_SLIP_BUCKET).remove([path])
      if (rmErr) logFailure('cleanup', rmErr)
    }
    if (isMigrationMissing(rpcErr)) return fail(503, MSG_NOT_READY)
    // ข้อความไทยจาก RPC (เช่น สถานะไม่ให้ส่ง / ครบ 5 รูปแล้ว) ส่งต่อให้ลูกค้าตามเดิม
    if (code === 'P0001' && /[฀-๿]/.test(message)) return fail(409, message)
    // ไม่ได้คำตอบจากฐานข้อมูล (เน็ตระหว่างเซิร์ฟเวอร์กับฐานข้อมูลหลุด) = อาจบันทึกแล้ว → บอกหน้าเว็บว่า "ไม่แน่ใจ"
    // ให้ตรวจจำนวนสลิปก่อน (ไม่งั้นลูกค้าเลือกรูปใหม่ส่งซ้ำ ได้สลิปซ้ำ + กินโควตา 5 รูป)
    if (!definite) return reply(503, { ok: false, unsure: true, message: MSG_GENERIC })
    return fail(400, MSG_GENERIC)
  }

  return reply(200, { ok: true })
}
