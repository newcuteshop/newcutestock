// ===== หน้าจองออนไลน์สาธารณะ (/book): ตัวเชื่อมฐานข้อมูลแบบไม่ต้องเข้าสู่ระบบ =====
// ใช้ได้ทั้ง server component และ client (ไม่มี import ฝั่งเซิร์ฟเวอร์ ไม่แตะ window ตอนโหลดไฟล์)
// - ใช้คีย์สาธารณะ (anon) ล้วน ไม่อ่าน/เขียนคุกกี้ ไม่เก็บ session → ลูกค้าที่เปิดจาก LINE / เบราว์เซอร์ที่ปิดคุกกี้ใช้ได้
//   (ถ้าพนักงานที่ล็อกอินอยู่เปิดหน้านี้ ก็ยังเรียกในนามผู้ไม่ได้เข้าสู่ระบบ — เห็นข้อมูลเท่าลูกค้าเท่านั้น)
// - ทุกคำขอไม่ใช้แคช (ข้อมูลวันว่าง/สถานะการจองต้องสดเสมอ) และหมดเวลาใน 20 วินาที (เน็ตมือถือค้าง ไม่ให้ปุ่มหมุนไม่จบ)
// - ทุกฟังก์ชันไม่ throw: คืน { ok: true, data } หรือ { ok: false, message ภาษาไทย, missing, unsure }
//   missing = ฐานข้อมูลยังไม่ได้รัน supabase-fix-06-rental-online.sql · unsure = เน็ตหลุดกลางทาง (คำขออาจสำเร็จไปแล้ว)
// สัญญากับฐานข้อมูล: RPC rental_public_* ใน supabase-fix-06-rental-online.sql (SPEC-RENTAL §4.2)
// ยกเว้นการเขียน: ส่งคำขอจอง = /api/book/request · ส่งสลิป = /api/book/slip (service role ฝั่งเซิร์ฟเวอร์ + จำกัดครั้งต่อ IP)
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { isNetworkError } from '@/lib/products'
import {
  parsePublicAvailability, parsePublicBooking, parsePublicCatalog, parsePublicInfo, parsePublicItem,
  parsePublicRequestResult,
  type PublicAvailability, type PublicBooking, type PublicCatalog, type PublicInfo, type PublicItem,
  type PublicRequestResult, type RentalSize,
} from '@/lib/rental'

export type PublicClient = SupabaseClient

/** ข้อความให้ลูกค้าเห็นเมื่อระบบจองออนไลน์ยังไม่พร้อม (ไม่บอกชื่อไฟล์ SQL กับลูกค้า — หน้าแสดงคำแนะนำผู้ดูแลแยกเป็นตัวเล็ก) */
export const PUBLIC_NOT_READY_MSG = 'ระบบจองออนไลน์ยังไม่พร้อมใช้งาน กรุณาติดต่อร้านโดยตรง'
const MSG_NETWORK = 'เชื่อมต่อระบบไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง'
const MSG_BAD_REPLY = 'ระบบตอบกลับไม่ครบ กรุณาลองใหม่อีกครั้ง'

const TIMEOUT_MS = 20000

export interface ApiFail {
  ok: false
  message: string
  /** ฐานข้อมูลยังไม่มีระบบจองออนไลน์ (fix-06) หรือยังไม่เปิดสิทธิ์ให้ผู้ไม่ได้เข้าสู่ระบบ */
  missing: boolean
  /** ไม่ได้คำตอบจากเซิร์ฟเวอร์ (เน็ตหลุด/หมดเวลา) — คำขอที่เขียนข้อมูลอาจสำเร็จไปแล้ว */
  unsure: boolean
  /** ถูกจำกัดจำนวนครั้ง (429) — ไม่ได้ส่งถึงฐานข้อมูลเลย: ผลของคำขอครั้งก่อน (ถ้ามี) ยังเหมือนเดิม */
  rateLimited?: boolean
}
export type ApiResult<T> = { ok: true; data: T } | ApiFail

// fetch ที่ไม่ใช้แคช (ทั้งแคชเบราว์เซอร์และ Data Cache ของ Next.js ฝั่งเซิร์ฟเวอร์) + ตัดที่ 20 วินาที
function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const outer = init?.signal
  if (outer) {
    if (outer.aborted) ctrl.abort()
    else outer.addEventListener('abort', () => ctrl.abort(), { once: true })
  }
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  return fetch(input, { ...init, signal: ctrl.signal, cache: 'no-store' }).finally(() => clearTimeout(timer))
}

/** สร้างตัวเชื่อมแบบผู้ไม่ได้เข้าสู่ระบบ (ไม่มี session/คุกกี้) — ยังไม่ได้ตั้งค่า env → throw (ฟังก์ชันด้านล่างจับให้แล้ว) */
export function createPublicClient(): PublicClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: timedFetch },
  })
}

let browserClient: PublicClient | null = null

/** ตัวเชื่อมฝั่งเบราว์เซอร์ (สร้างครั้งเดียวต่อหน้า) — ฝั่งเซิร์ฟเวอร์สร้างใหม่ทุกครั้ง (ไม่แชร์ข้ามคำขอ) */
export function publicClient(): PublicClient {
  if (typeof window === 'undefined') return createPublicClient()
  if (!browserClient) browserClient = createPublicClient()
  return browserClient
}

function errorText(err: unknown): { code: string; message: string; name: string } {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; message?: unknown; name?: unknown }
    return {
      code: e.code === null || e.code === undefined ? '' : String(e.code),
      message: typeof e.message === 'string' ? e.message : '',
      name: typeof e.name === 'string' ? e.name : '',
    }
  }
  return { code: '', message: typeof err === 'string' ? err : '', name: '' }
}

/** เน็ตหลุด / หมดเวลา (ไม่ได้คำตอบจากฐานข้อมูล) */
export function isUnsureError(err: unknown): boolean {
  if (isNetworkError(err)) return true
  const { code, message, name } = errorText(err)
  if (code) return false
  return name === 'AbortError' || /abort/i.test(message)
}

export function toFail(err: unknown): ApiFail {
  const { code, message } = errorText(err)
  if (isMigrationMissing(err)) return { ok: false, message: PUBLIC_NOT_READY_MSG, missing: true, unsure: false }
  // 42501 จากหน้าสาธารณะ = ยังไม่ได้ให้สิทธิ์ anon เรียกฟังก์ชัน (ไฟล์ SQL ยังไม่ครบ) — ไม่ใช่ความผิดของลูกค้า
  if (code === '42501' && !/[฀-๿]/.test(message)) {
    return { ok: false, message: PUBLIC_NOT_READY_MSG, missing: true, unsure: false }
  }
  if (isUnsureError(err)) return { ok: false, message: MSG_NETWORK, missing: false, unsure: true }
  return { ok: false, message: thaiError(err), missing: false, unsure: false }
}

// ข้อความ "ไม่พบ..." จาก RPC (P0001) — ใช้แยกกรณีลิงก์ผิด/ชุดถูกปิด ออกจากข้อผิดพลาดอื่น
function isNotFound(err: unknown): boolean {
  const { code, message } = errorText(err)
  return (code === 'P0001' || code === 'P0002') && /ไม่พบ/.test(message)
}

async function rpc(sb: PublicClient | null, fn: string, args?: Record<string, unknown>): Promise<{ ok: true; raw: unknown } | (ApiFail & { notFound: boolean })> {
  try {
    const client = sb ?? publicClient()
    const { data, error } = args ? await client.rpc(fn, args) : await client.rpc(fn)
    if (error) return { ...toFail(error), notFound: isNotFound(error) }
    return { ok: true, raw: data }
  } catch (e) {
    // env ยังไม่ได้ตั้ง (createClient throw) หรือ fetch throw ตรงๆ
    const f = toFail(e)
    return { ...f, notFound: false }
  }
}

function strip(r: ApiFail & { notFound?: boolean }): ApiFail {
  return { ok: false, message: r.message, missing: r.missing, unsure: r.unsure }
}

// ---------------------------------------------------------------------------
// อ่านข้อมูล
// ---------------------------------------------------------------------------
/** ข้อมูลร้าน + เงื่อนไขการจอง (rental_public_info) */
export async function fetchPublicInfo(sb?: PublicClient): Promise<ApiResult<PublicInfo>> {
  const r = await rpc(sb ?? null, 'rental_public_info')
  if (!r.ok) return strip(r)
  return { ok: true, data: parsePublicInfo(r.raw) }
}

export interface CatalogQuery {
  categoryId: string | null
  search: string
  pickup: string | null
  ret: string | null
  size: string | null
  accessories: boolean
}

/** รายการชุดบนหน้าเว็บ (rental_public_catalog) — ส่งวันรับ/คืนมาด้วย = ได้ available + rent_price ของช่วงนั้น */
export async function fetchCatalog(q: CatalogQuery, sb?: PublicClient): Promise<ApiResult<PublicCatalog>> {
  const hasDates = !!q.pickup && !!q.ret
  const r = await rpc(sb ?? null, 'rental_public_catalog', {
    p_category_id: q.categoryId || null,
    p_search: q.search.trim() || null,
    p_pickup: hasDates ? q.pickup : null,
    p_return: hasDates ? q.ret : null,
    p_size: q.size || null,
    p_include_accessories: q.accessories,
  })
  if (!r.ok) return strip(r)
  return { ok: true, data: parsePublicCatalog(r.raw) }
}

/** ชุด 1 แบบตามรหัส (rental_public_item) — data = null เมื่อไม่พบ/ปิดไม่ให้จองออนไลน์ */
export async function fetchPublicItem(code: string, sb?: PublicClient): Promise<ApiResult<PublicItem | null>> {
  const r = await rpc(sb ?? null, 'rental_public_item', { p_code: code })
  if (!r.ok) return r.notFound ? { ok: true, data: null } : strip(r)
  return { ok: true, data: parsePublicItem(r.raw) }
}

/** วันว่างรายไซส์ของชุด (rental_public_availability) — from ต้องไม่ก่อนวันนี้ ช่วงไม่เกิน 120 วัน */
export async function fetchAvailability(itemId: string, from: string, to: string, sb?: PublicClient): Promise<ApiResult<PublicAvailability>> {
  const r = await rpc(sb ?? null, 'rental_public_availability', { p_item_id: itemId, p_from: from, p_to: to })
  if (!r.ok) return strip(r)
  return { ok: true, data: parsePublicAvailability(r.raw) }
}

/** การจองของผู้ถือลิงก์ (rental_public_booking) — data = null เมื่อไม่พบ (โทเคนผิด) */
export async function fetchPublicBooking(token: string, sb?: PublicClient): Promise<ApiResult<PublicBooking | null>> {
  const r = await rpc(sb ?? null, 'rental_public_booking', { p_token: token })
  if (!r.ok) return r.notFound ? { ok: true, data: null } : strip(r)
  return { ok: true, data: parsePublicBooking(r.raw) }
}

// ---------------------------------------------------------------------------
// เขียนข้อมูล
// ---------------------------------------------------------------------------
export interface PublicRequestPayload {
  lines: { item_id: string; size: RentalSize }[]
  pickup_date: string
  return_date: string
  name: string
  phone: string
  line_id: string | null
  note: string | null
  event_date: string | null
  consent: boolean
  accept_terms: boolean
  /** ช่องดักบอท (ซ่อนจากคน) — คนจริงส่งว่างเสมอ */
  website: string
}

/** ข้อความจากฐานข้อมูลเมื่อรหัสคำขอนี้ผูกกับการจองอื่นไปแล้ว (เช่น ส่งสำเร็จด้วยเบอร์หนึ่ง แล้วแก้เบอร์ส่งใหม่) */
export function isClientIdTaken(message: string): boolean {
  return /ถูกใช้ไปแล้ว/.test(message)
}

/**
 * ส่งคำขอจองออนไลน์ — ผ่าน API ของแอป POST /api/book/request (จำกัดจำนวนครั้งต่อ IP แล้วเรียก rental_public_request
 * ด้วย service role · ฐานข้อมูลไม่ให้ anon เรียกตรง) · ใช้ได้ฝั่งเบราว์เซอร์เท่านั้น (path สัมพัทธ์)
 * client_id เดิมส่งซ้ำได้ปลอดภัย (ฐานข้อมูลคืนคำขอเดิม already_saved = true เมื่อเป็นเบอร์เดียวกัน) · payload แบนตามสัญญาใน
 * supabase-fix-06-rental-online.sql: {name, phone, line_id, note, event_date, pickup_date, return_date, lines:[{item_id, size}],
 * consent, accept_terms, website}
 */
export async function submitPublicRequest(clientId: string, payload: PublicRequestPayload): Promise<ApiResult<PublicRequestResult>> {
  let res: Response
  try {
    res = await timedFetch('/api/book/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, payload }),
    })
  } catch {
    // ไม่ได้คำตอบ (เน็ตหลุด/หมดเวลา) — คำขออาจถึงร้านแล้ว: ส่งซ้ำด้วยรหัสเดิมได้คำขอเดิม
    return { ok: false, message: MSG_NETWORK, missing: false, unsure: true }
  }
  type RouteBody = { ok?: unknown; data?: unknown; message?: unknown; missing?: unknown; unsure?: unknown; rate_limited?: unknown }
  let body: RouteBody | null = null
  try {
    const j: unknown = await res.json()
    body = j && typeof j === 'object' && !Array.isArray(j) ? (j as RouteBody) : null
  } catch {
    body = null
  }
  if (!body) {
    // คำตอบไม่ใช่ JSON ของเรา (เกตเวย์/เซิร์ฟเวอร์ล่มกลางทาง) — 5xx = อาจบันทึกแล้ว
    return { ok: false, message: res.status >= 500 ? MSG_NETWORK : MSG_BAD_REPLY, missing: false, unsure: res.status >= 500 }
  }
  if (body.ok === true) {
    const parsed = parsePublicRequestResult(body.data)
    // ได้คำตอบแต่ไม่มีโทเคนที่ถูกรูปแบบ — ถือว่า "ไม่แน่ใจ" (ส่งซ้ำด้วย client_id เดิมจะได้คำขอเดิมกลับมา)
    if (!parsed) return { ok: false, message: MSG_BAD_REPLY, missing: false, unsure: true }
    return { ok: true, data: parsed }
  }
  const missing = body.missing === true
  return {
    ok: false,
    message: missing ? PUBLIC_NOT_READY_MSG : typeof body.message === 'string' && body.message.trim() ? body.message.trim() : MSG_BAD_REPLY,
    missing,
    unsure: body.unsure === true,
    rateLimited: body.rate_limited === true || res.status === 429,
  }
}

/** ลูกค้ายกเลิกคำขอที่ยังรอยืนยัน (rental_public_cancel) */
export async function cancelPublicBooking(token: string, sb?: PublicClient): Promise<ApiResult<true>> {
  const r = await rpc(sb ?? null, 'rental_public_cancel', { p_token: token })
  if (!r.ok) return strip(r)
  return { ok: true, data: true }
}
