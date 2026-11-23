// ===== หน้าติดตามงานของคู่บ่าวสาว (/wedding-status/<token>): ตัวเชื่อมฐานข้อมูลแบบไม่ต้องเข้าสู่ระบบ =====
// ใช้ได้ทั้ง server component และ client (ไม่มี import ฝั่งเซิร์ฟเวอร์ ไม่แตะ window ตอนโหลดไฟล์) — แบบเดียวกับ components/book/api.ts
// - คีย์สาธารณะ (anon) ล้วน ไม่อ่าน/เขียนคุกกี้ ไม่เก็บ session → ลูกค้าที่เปิดจาก LINE / เบราว์เซอร์ที่ปิดคุกกี้ใช้ได้
//   (พนักงานที่ล็อกอินอยู่เปิดลิงก์นี้ก็เห็นเท่าลูกค้า — ไม่มีค่าจ้างทีม/หมายเหตุภายใน)
// - ไม่ใช้แคช (สถานะงาน/ยอดเงินต้องสดเสมอ) และหมดเวลาใน 20 วินาที (เน็ตมือถือค้าง ไม่ให้หน้าหมุนไม่จบ)
// - ไม่ throw: คืน { ok: true, data } (data.state = ok / cancelled / disabled / not_found) หรือ { ok: false, ... }
// สัญญากับฐานข้อมูล: wed_public_booking(p_token) ใน supabase-fix-07-wedding.sql
//   โทเคนผิดรูปแบบ/ไม่พบงาน → ฐานข้อมูล raise 'ไม่พบงานนี้ ...' (P0001) → แปลงเป็น state 'not_found' ที่นี่
//   ร้านปิดลิงก์ติดตามงาน → state 'disabled' (มีข้อมูลร้านให้ติดต่อ) · งานยกเลิก → state 'cancelled' (ข้อมูลย่อ)
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { isNetworkError } from '@/lib/products'
import { isWeddingToken, parseWedPublicBooking, type WedPublicBooking } from '@/lib/wedding'

export type PortalClient = SupabaseClient

/** ข้อความให้ลูกค้าเห็นเมื่อระบบยังไม่พร้อม (ไม่บอกชื่อไฟล์ SQL กับลูกค้า — การ์ดแสดงคำแนะนำผู้ดูแลแยกเป็นตัวเล็ก) */
export const PORTAL_NOT_READY_MSG = 'ระบบติดตามงานยังไม่พร้อมใช้งาน กรุณาติดต่อร้านโดยตรง'
const MSG_NETWORK = 'เชื่อมต่อระบบไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง'
const TIMEOUT_MS = 20000

export interface PortalFail {
  ok: false
  message: string
  /** ฐานข้อมูลยังไม่มีระบบร้าน b.oncloud (fix-07) หรือยังไม่เปิดสิทธิ์ให้ผู้ไม่ได้เข้าสู่ระบบ */
  missing: boolean
  /** ไม่ได้คำตอบจากเซิร์ฟเวอร์ (เน็ตหลุด/หมดเวลา) */
  unsure: boolean
}
export type PortalResult = { ok: true; data: WedPublicBooking } | PortalFail

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

/** ตัวเชื่อมแบบผู้ไม่ได้เข้าสู่ระบบ — env ยังไม่ได้ตั้ง → throw (fetchWeddingPortal จับให้แล้ว) */
export function createPortalClient(): PortalClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: timedFetch },
  })
}

let browserClient: PortalClient | null = null

/** ตัวเชื่อมฝั่งเบราว์เซอร์ (สร้างครั้งเดียวต่อหน้า) — ฝั่งเซิร์ฟเวอร์สร้างใหม่ทุกครั้ง (ไม่แชร์ข้ามคำขอ) */
function portalClient(): PortalClient {
  if (typeof window === 'undefined') return createPortalClient()
  if (!browserClient) browserClient = createPortalClient()
  return browserClient
}

function errorParts(err: unknown): { code: string; message: string; name: string } {
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

function toFail(err: unknown): PortalFail {
  const { code, message, name } = errorParts(err)
  if (isMigrationMissing(err)) return { ok: false, message: PORTAL_NOT_READY_MSG, missing: true, unsure: false }
  // 42501 ที่ไม่ใช่ข้อความไทยของเรา = ยังไม่ได้ให้สิทธิ์ anon เรียกฟังก์ชัน (ไฟล์ SQL ยังไม่ครบ)
  if (code === '42501' && !/[฀-๿]/.test(message)) return { ok: false, message: PORTAL_NOT_READY_MSG, missing: true, unsure: false }
  if (isNetworkError(err) || (!code && (name === 'AbortError' || /abort/i.test(message)))) {
    return { ok: false, message: MSG_NETWORK, missing: false, unsure: true }
  }
  return { ok: false, message: thaiError(err), missing: false, unsure: false }
}

// ข้อความ "ไม่พบงานนี้" จาก RPC = ลิงก์ผิด/โทเคนถูกเปลี่ยนแล้ว
function isNotFound(err: unknown): boolean {
  const { code, message } = errorParts(err)
  return (code === 'P0001' || code === 'P0002' || code === '') && /ไม่พบ/.test(message)
}

/**
 * งานของผู้ถือลิงก์ (wed_public_booking) — โทเคนผิดรูปแบบ = not_found ทันที (ไม่ยิงฐานข้อมูล)
 * sb: ส่งตัวเชื่อมมาเอง (ฝั่งเซิร์ฟเวอร์) ; ไม่ส่ง = ตัวเชื่อมของหน้า
 */
export async function fetchWeddingPortal(token: string, sb?: PortalClient | null): Promise<PortalResult> {
  const t = String(token ?? '').trim().toLowerCase()
  if (!isWeddingToken(t)) return { ok: true, data: parseWedPublicBooking(null) }
  try {
    const client = sb ?? portalClient()
    const { data, error } = await client.rpc('wed_public_booking', { p_token: t })
    if (error) {
      if (isNotFound(error)) return { ok: true, data: parseWedPublicBooking(null) }
      return toFail(error)
    }
    return { ok: true, data: parseWedPublicBooking(data) }
  } catch (e) {
    return toFail(e)
  }
}
