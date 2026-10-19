// ===== ตัวช่วยเรียกฐานข้อมูลของหน้าร้านเช่าชุด (ภาพรวมวันนี้ / ปฏิทิน / ลูกค้า) — ใช้ฝั่ง client =====
// - ทุกคำขอมีเวลาจำกัด: เซิร์ฟเวอร์เงียบเกินกำหนด → ยกเลิกเอง แล้วบอกเป็นภาษาไทย (ไม่ค้างหมุนตลอดไป)
// - ข้อความ error: ยังไม่รันไฟล์ fix-05 → บอกชื่อไฟล์ที่ต้องรัน ; ข้อความไทยจาก RPC (P0001 / 42501) ใช้ตามเดิม
import { thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { FIX05_MISSING_MSG } from '@/lib/rental'
import type { BrowserSupabase } from '@/lib/products'

export const LOAD_TIMEOUT_MS = 20000
export const WRITE_TIMEOUT_MS = 30000
export const LOAD_TIMEOUT_MSG = 'เซิร์ฟเวอร์ตอบช้าเกินไป — กดปุ่มโหลดใหม่อีกครั้ง'

const THAI_RE = /[฀-๿]/

/** ข้อความ error ภาษาไทยสำหรับหน้าร้านเช่า */
export function rentalErrorText(err: unknown): string {
  if (isMigrationMissing(err)) return FIX05_MISSING_MSG
  const e = err && typeof err === 'object' ? (err as { code?: unknown; message?: unknown }) : null
  // 42501 จาก RPC ของเรามีข้อความไทยบอกว่าขาดสิทธิ์อะไร (ชัดกว่าข้อความกลาง "ไม่มีสิทธิ์ทำรายการนี้")
  if (e && e.code === '42501' && typeof e.message === 'string' && THAI_RE.test(e.message)) return e.message.trim()
  return thaiError(err)
}

/** error มาจากเซิร์ฟเวอร์จริง (มีรหัส Postgres/PostgREST) — ไม่ใช่เน็ตหลุด/หมดเวลา */
export function serverAnswered(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  if (typeof code !== 'string') return false
  return /^PGRST\d+$/.test(code) || /^(?!E)[0-9A-Z]{5}$/.test(code)
}

export interface RpcOutcome {
  data: unknown
  error: unknown
  /** ยกเลิกเพราะหมดเวลา (ไม่รู้ว่าเซิร์ฟเวอร์ทำเสร็จหรือยัง) */
  timedOut: boolean
}

/**
 * เรียก RPC พร้อมเวลาจำกัด — ไม่ throw: error ทุกแบบอยู่ใน .error (หมดเวลา = Error ข้อความไทย + timedOut true)
 * ใช้ได้ทั้งอ่าน (LOAD_TIMEOUT_MS) และเขียน (WRITE_TIMEOUT_MS)
 */
export async function rpcWithTimeout(
  supabase: BrowserSupabase,
  fn: string,
  args?: Record<string, unknown>,
  timeoutMs: number = LOAD_TIMEOUT_MS,
): Promise<RpcOutcome> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = setTimeout(() => ctrl?.abort(), timeoutMs)
  try {
    let req = supabase.rpc(fn, args ?? {})
    if (ctrl) req = req.abortSignal(ctrl.signal)
    const res = await req
    if (res.error) {
      if (ctrl?.signal.aborted) return { data: null, error: new Error(LOAD_TIMEOUT_MSG), timedOut: true }
      return { data: null, error: res.error, timedOut: false }
    }
    return { data: res.data as unknown, error: null, timedOut: false }
  } catch (err) {
    if (ctrl?.signal.aborted) return { data: null, error: new Error(LOAD_TIMEOUT_MSG), timedOut: true }
    return { data: null, error: err, timedOut: false }
  } finally {
    clearTimeout(timer)
  }
}

/** UUID มาตรฐาน (id ในลิงก์/URL) */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** ลิงก์หน้ารายละเอียดการจอง (RUI-3) */
export function bookingHref(bookingId: string): string {
  return `/rental/bookings/${encodeURIComponent(bookingId)}`
}

/** ลิงก์หน้ารายละเอียดลูกค้า */
export function customerHref(customerId: string): string {
  return `/rental/customers/${encodeURIComponent(customerId)}`
}

/** ลิงก์โทรออก (เฉพาะตัวเลข) ; ไม่มีเบอร์ → '' */
export function telHref(phone: string | null | undefined): string {
  const d = String(phone ?? '').replace(/[๐-๙]/g, ch => String(ch.charCodeAt(0) - 0x0e50)).replace(/\D/g, '')
  return d ? `tel:${d}` : ''
}
