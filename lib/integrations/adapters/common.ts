// lib/integrations/adapters/common.ts — ตัวช่วยที่ทุก adapter ใช้ร่วมกัน (ฝั่งเซิร์ฟเวอร์เท่านั้น)
import type { NormalizedOrderLine, OutboxJob, PushResult } from '../types'
import { isPlatformError, PlatformError, statusReasonFor } from '../errors'
import { retryAfterSeconds } from '../http'
import { redactText, safeError } from '../redact'

/** ผลทดสอบการเชื่อมต่อ + เหตุผลของสถานะ (reason อ่านโดย server action เพื่อตั้ง status_reason) */
export interface TestResult {
  ok: boolean
  message: string
  shop_id?: string
  shop_name?: string
  settings?: Record<string, unknown>
  reason?: string
}

export function testFail(e: unknown, fallback = 'เชื่อมต่อไม่สำเร็จ'): TestResult {
  const message = isPlatformError(e) ? e.message : fallback
  return { ok: false, message, reason: statusReasonFor(e) }
}

export function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim()
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  return null
}

export function toInt(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null
  if (typeof v === 'string' && /^\s*-?[0-9]+(\.[0-9]+)?\s*$/.test(v)) return Math.trunc(Number(v))
  return null
}

export function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && /^\s*-?[0-9]+(\.[0-9]+)?\s*$/.test(v)) return Number(v)
  return null
}

/** เวลาเป็น ISO 8601 (มีโซน) จาก epoch วินาที/มิลลิวินาที หรือข้อความวันที่ — อ่านไม่ได้ = null */
export function toIso(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  let ms: number
  if (typeof v === 'number' || (typeof v === 'string' && /^\s*[0-9]{9,14}\s*$/.test(v))) {
    const n = Number(v)
    ms = n > 1e12 ? n : n * 1000
  } else if (typeof v === 'string') {
    ms = Date.parse(v)
  } else {
    return null
  }
  if (!Number.isFinite(ms)) return null
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  if (y < 2000 || y > 2200) return null
  return d.toISOString()
}

export function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

const EDGE_JUNK = /^[\s\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]+|[\s\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]+$/g

/** SKU แบบเทียบได้ (NFC + ตัดอักขระที่มองไม่เห็นหัวท้าย + ตัวเล็ก) — ตรงกับ lower(product_clean_text()) ในฐานข้อมูล */
export function normSku(s: string | null | undefined): string {
  if (s === null || s === undefined) return ''
  return String(s).normalize('NFC').replace(EDGE_JUNK, '').toLowerCase()
}

/** รวมบรรทัดสินค้าที่เป็นตัวเลือกเดียวกัน (แพลตฟอร์มที่ 1 บรรทัด = 1 ชิ้น / รายการซ้ำ) — line_key ต้องไม่ซ้ำในออเดอร์ */
export function aggregateLines(lines: NormalizedOrderLine[]): NormalizedOrderLine[] {
  const map = new Map<string, NormalizedOrderLine>()
  for (const l of lines) {
    const key = l.line_key ?? l.sku_id ?? (normSku(l.sku) ? 'sku:' + normSku(l.sku) : '')
    if (!key) continue
    const prev = map.get(key)
    if (!prev) {
      map.set(key, { ...l, qty: l.qty || 0, qty_cancelled: l.qty_cancelled ?? 0, qty_returned: l.qty_returned ?? 0 })
      continue
    }
    prev.qty += l.qty || 0
    prev.qty_cancelled = (prev.qty_cancelled ?? 0) + (l.qty_cancelled ?? 0)
    prev.qty_returned = (prev.qty_returned ?? 0) + (l.qty_returned ?? 0)
    if ((prev.unit_price === null || prev.unit_price === undefined) && l.unit_price !== undefined) prev.unit_price = l.unit_price
    if (!prev.name && l.name) prev.name = l.name
    if (!prev.sku && l.sku) prev.sku = l.sku
    if (!prev.item_id && l.item_id) prev.item_id = l.item_id
  }
  return Array.from(map.values()).map(l => ({
    ...l,
    qty_cancelled: Math.min(l.qty_cancelled ?? 0, l.qty),
    qty_returned: Math.min(l.qty_returned ?? 0, l.qty),
  }))
}

// ---------------------------------------------------------------------------
// ผลการส่งสต๊อก
// ---------------------------------------------------------------------------
/** ชนิดปัญหาที่ worker อ่านเพิ่มจากผลที่ล้มเหลว (เช่น 'auth' → ตั้งสถานะช่องทางเป็น error) */
export type PushFailKind = 'auth' | 'reauth' | 'rate_limit' | 'network' | 'timeout' | 'server' | 'not_found' | 'validation' | 'blocked' | 'config' | 'unsupported' | 'other'

export function pushOk(job: OutboxJob, pushedQty: number, platformQty?: number, extra?: Record<string, unknown>): PushResult {
  const r: PushResult = { id: job.id, ok: true, pushed_qty: Math.max(0, Math.trunc(pushedQty)) }
  if (platformQty !== undefined && Number.isFinite(platformQty)) r.platform_qty = Math.trunc(platformQty)
  return extra ? Object.assign(r, extra) : r
}

export function pushFail(job: OutboxJob, e: unknown, overrides: { permanent?: boolean; retryAfterSeconds?: number; message?: string } = {}): PushResult {
  const pe = isPlatformError(e) ? e : null
  const message = (overrides.message ?? (pe ? pe.message : typeof e === 'string' ? e : 'ส่งสต๊อกไม่สำเร็จ: ' + safeError(e))).slice(0, 900)
  const permanent = overrides.permanent ?? (pe ? pe.permanent : false)
  let retry = overrides.retryAfterSeconds ?? pe?.retryAfterSeconds
  if (retry === undefined && pe && (pe.kind === 'auth' || pe.kind === 'reauth')) retry = 900
  const r: PushResult = { id: job.id, ok: false, error: message, permanent }
  if (!permanent && retry !== undefined) r.retry_after_seconds = Math.max(0, Math.min(86400, Math.trunc(retry)))
  const kind: PushFailKind = pe ? pe.kind : 'other'
  return Object.assign(r, { kind })
}

/** error ระดับทั้งชุด (คีย์ผิด / โดนจำกัดความถี่ / เครือข่ายล่ม) → งานที่เหลือทั้งหมดล้มเหลวด้วยเหตุเดียวกัน */
export function isBatchLevel(e: unknown): boolean {
  return isPlatformError(e) && ['auth', 'reauth', 'rate_limit', 'network', 'timeout', 'server', 'config', 'blocked'].includes(e.kind)
}

export function failKindOf(r: PushResult): PushFailKind | null {
  if (r.ok) return null
  const k = (r as { kind?: unknown }).kind
  return typeof k === 'string' ? (k as PushFailKind) : 'other'
}

/** แปลงคำตอบ HTTP ที่ไม่สำเร็จเป็น PlatformError (ข้อความภาษาไทยที่ปลอดภัย) */
export function httpError(label: string, res: Response, platformMessage?: string | null, requestId?: string | null): PlatformError {
  const tail = requestId ? ` (request id ${String(requestId).slice(0, 80)})` : ''
  const pm = platformMessage ? ': ' + redactText(String(platformMessage)).replace(/\s+/g, ' ').slice(0, 160) : ''
  const s = res.status
  if (s === 401 || s === 403) return new PlatformError('auth', `${label} ปฏิเสธคีย์/โทเคน (HTTP ${s}) — ตรวจคีย์ในหน้าตั้งค่า${tail}`, { status: s })
  if (s === 404) return new PlatformError('not_found', `${label} ไม่พบข้อมูลนี้ (HTTP 404)${pm}${tail}`, { status: s })
  if (s === 429) {
    return new PlatformError('rate_limit', `${label} จำกัดความถี่การเรียก (HTTP 429) — ระบบจะลองใหม่เอง${tail}`,
      { status: s, retryAfterSeconds: retryAfterSeconds(res) ?? 60 })
  }
  if (s >= 500) return new PlatformError('server', `${label} ขัดข้องชั่วคราว (HTTP ${s})${tail}`, { status: s, retryAfterSeconds: retryAfterSeconds(res) ?? undefined })
  return new PlatformError('validation', `${label} ไม่รับคำขอ (HTTP ${s})${pm}${tail}`, { status: s })
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue
    u.set(k, String(v))
  }
  return u.toString()
}
