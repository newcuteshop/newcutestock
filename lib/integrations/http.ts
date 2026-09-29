// lib/integrations/http.ts — ทางออกเครือข่ายทางเดียวของระบบเชื่อมต่อ (กัน SSRF)
// - ยิงได้เฉพาะ host ทางการของแพลตฟอร์ม (allowlist ค่าคงที่) ผ่าน https เท่านั้น — ไม่มี URL ที่ผู้ใช้ส่งมาเลย
// - ไม่ตาม redirect, timeout ต่อคำขอ, จำกัดขนาดคำตอบ 5 MB, คุมความถี่ต่อแพลตฟอร์ม (ภายใน process)
// - ลองใหม่อัตโนมัติ (backoff + jitter) เฉพาะคำขอ GET/HEAD เท่านั้น; 429 ที่ต้องรอนานส่งกลับให้ผู้เรียกตัดสินใจ
// - โหมดทดสอบ: INTEGRATIONS_ALLOW_TEST_HOSTS=1 + INTEGRATIONS_BASE_URL_OVERRIDES='{"line":"http://127.0.0.1:4010"}'
//   ใช้ได้เมื่อ VERCEL_ENV !== 'production' และเฉพาะ host loopback (127.0.0.1 / localhost / ::1)
// ฝั่งเซิร์ฟเวอร์เท่านั้น
import type { Platform } from './types'
import { PlatformError } from './errors'

export const OFFICIAL_HOSTS: Record<Platform, readonly string[]> = {
  line: ['developers-oaplus.line.biz'],
  meta: ['graph.facebook.com'],
  shopee: ['partner.shopeemobile.com', 'openplatform.sandbox.test-stable.shopee.sg'],
  lazada: ['api.lazada.co.th', 'auth.lazada.com'],
  tiktok: ['open-api.tiktokglobalshop.com', 'auth.tiktok-shops.com'],
  generic: [],
}

/** host ที่เบราว์เซอร์ของแอดมินถูกส่งไป (หน้าอนุญาต OAuth) — เราไม่ fetch host เหล่านี้เอง */
export const AUTH_REDIRECT_HOSTS: readonly string[] = [
  'open.shopee.com',
  'open.sandbox.test-stable.shopee.com',
  'auth.lazada.com',
  'services.tiktokshop.com',
]

/** Graph API version ของ Meta (ค่าเดียวทั้งระบบ — v24 หมดอายุ 6 ต.ค. 2026) */
export const META_GRAPH_VERSION = 'v25.0'

const API_BASES: Record<Platform, Readonly<Record<string, string>>> = {
  line: { api: 'https://developers-oaplus.line.biz/myshop/v1' },
  meta: { graph: `https://graph.facebook.com/${META_GRAPH_VERSION}` },
  shopee: { production: 'https://partner.shopeemobile.com', sandbox: 'https://openplatform.sandbox.test-stable.shopee.sg' },
  lazada: { api: 'https://api.lazada.co.th/rest', auth: 'https://auth.lazada.com/rest' },
  tiktok: { api: 'https://open-api.tiktokglobalshop.com', auth: 'https://auth.tiktok-shops.com' },
  generic: {},
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** origin ของ mock server ตอนทดสอบ (null = ใช้ host จริง) */
function testOverrides(): Record<string, string> | null {
  if (process.env.INTEGRATIONS_ALLOW_TEST_HOSTS !== '1') return null
  if (process.env.VERCEL_ENV === 'production') return null
  const raw = process.env.INTEGRATIONS_BASE_URL_OVERRIDES
  if (!raw) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== 'string') continue
    try {
      const u = new URL(v)
      if ((u.protocol === 'http:' || u.protocol === 'https:') && LOOPBACK_HOSTS.has(u.hostname.toLowerCase())) {
        out[k] = u.origin
      }
    } catch { /* ข้าม */ }
  }
  return out
}

function overrideOrigin(platform: Platform, key: string): string | null {
  const o = testOverrides()
  if (!o) return null
  return o[`${platform}:${key}`] ?? o[platform] ?? null
}

/** base URL ของ API (ค่าจริง หรือ origin ของ mock + path เดิมตอนทดสอบ) */
export function apiBase(platform: Platform, key: string): string {
  const base = API_BASES[platform]?.[key]
  if (!base) throw new PlatformError('config', 'ไม่รู้จักปลายทาง API ของแพลตฟอร์มนี้')
  const origin = overrideOrigin(platform, key)
  if (!origin) return base
  const path = new URL(base).pathname.replace(/\/+$/, '')
  return origin + path
}

/** origin ของ mock ทั้งหมดของแพลตฟอร์มนี้ (ใช้ตรวจ allowlist ตอนทดสอบ) */
function allowedTestOrigins(platform: Platform): Set<string> {
  const o = testOverrides()
  const out = new Set<string>()
  if (!o) return out
  for (const [k, v] of Object.entries(o)) {
    if (k === platform || k.startsWith(platform + ':')) out.add(v)
  }
  return out
}

/** ตรวจ URL ก่อนยิง: https + host ทางการเท่านั้น (หรือ mock loopback ตอนทดสอบ) */
export function assertAllowedUrl(platform: Platform, url: string): URL {
  let u: URL
  try { u = new URL(url) } catch { throw new PlatformError('blocked', 'ปลายทางไม่ถูกต้อง') }
  if (u.username || u.password) throw new PlatformError('blocked', 'ปลายทางไม่ถูกต้อง')
  const host = u.hostname.toLowerCase()
  if (u.protocol === 'https:' && (OFFICIAL_HOSTS[platform] ?? []).includes(host) && (u.port === '' || u.port === '443')) {
    return u
  }
  if (allowedTestOrigins(platform).has(u.origin)) return u
  throw new PlatformError('blocked', 'ไม่อนุญาตให้เชื่อมต่อปลายทางนี้ (อนุญาตเฉพาะเซิร์ฟเวอร์ทางการของแพลตฟอร์ม)')
}

// ---------------------------------------------------------------------------
// คุมความถี่ (ต่อ process — กันยิงรัวภายในรอบเดียว; โควตาจริงของแพลตฟอร์มคุมที่ worker/คิว)
// ---------------------------------------------------------------------------
const RATE_PER_SEC: Record<Platform, { read: number; write: number }> = {
  line: { read: 5, write: 5 },
  meta: { read: 5, write: 5 },
  shopee: { read: 5, write: 5 },
  lazada: { read: 2, write: 2 },
  tiktok: { read: 3, write: 1 },
  generic: { read: 1, write: 1 },
}
const nextSlot = new Map<string, number>()

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)))
}

async function pace(platform: Platform, method: string): Promise<void> {
  const read = method === 'GET' || method === 'HEAD'
  const rate = read ? RATE_PER_SEC[platform].read : RATE_PER_SEC[platform].write
  const key = platform === 'tiktok' ? `${platform}:${read ? 'r' : 'w'}` : platform
  const now = Date.now()
  const slot = Math.max(nextSlot.get(key) ?? 0, now)
  nextSlot.set(key, slot + Math.ceil(1000 / rate))
  if (slot > now) await sleep(slot - now)
}

/** วินาทีที่แพลตฟอร์มขอให้รอ (Retry-After / RateLimit-Reset) — ไม่มี = null */
export function retryAfterSeconds(res: Response): number | null {
  const candidates = [res.headers.get('retry-after'), res.headers.get('ratelimit-reset'), res.headers.get('x-ratelimit-reset')]
  for (const raw of candidates) {
    if (!raw) continue
    const t = raw.trim()
    if (/^[0-9]+(\.[0-9]+)?$/.test(t)) return Math.min(86400, Math.max(0, Math.ceil(Number(t))))
    const at = Date.parse(t)
    if (!Number.isNaN(at)) return Math.min(86400, Math.max(0, Math.ceil((at - Date.now()) / 1000)))
  }
  return null
}

const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const MAX_INLINE_WAIT_S = 5

export interface PlatformFetchInit extends RequestInit {
  timeoutMs?: number
  /** จำนวนครั้งที่ลองใหม่ (ค่าเริ่มต้น: GET/HEAD = 2, อื่นๆ = 0 — ห้ามลองซ้ำคำขอที่ไม่ idempotent) */
  retries?: number
  maxBytes?: number
}

async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    try { await res.body?.cancel() } catch { /* ignore */ }
    throw new PlatformError('validation', 'คำตอบจากแพลตฟอร์มใหญ่เกินกำหนด', { status: res.status, permanent: false })
  }
  if (!res.body) return new Uint8Array(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.byteLength
      if (total > maxBytes) {
        try { await reader.cancel() } catch { /* ignore */ }
        throw new PlatformError('validation', 'คำตอบจากแพลตฟอร์มใหญ่เกินกำหนด', { status: res.status, permanent: false })
      }
      chunks.push(value)
    }
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.byteLength }
  return out
}

async function fetchOnce(url: URL, init: PlatformFetchInit, method: string): Promise<Response> {
  const { timeoutMs, retries: _r, maxBytes, ...rest } = init
  void _r
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs ?? DEFAULT_TIMEOUT_MS))
  try {
    let res: Response
    try {
      res = await fetch(url, { ...rest, method, redirect: 'manual', signal: controller.signal, cache: 'no-store' })
    } catch (e) {
      if (controller.signal.aborted) throw new PlatformError('timeout', 'แพลตฟอร์มตอบช้าเกินกำหนด')
      void e
      throw new PlatformError('network', 'เชื่อมต่อเซิร์ฟเวอร์ของแพลตฟอร์มไม่ได้')
    }
    if ((res.status >= 300 && res.status < 400) || res.type === 'opaqueredirect') {
      try { await res.body?.cancel() } catch { /* ignore */ }
      throw new PlatformError('blocked', 'แพลตฟอร์มตอบกลับเป็นการเปลี่ยนเส้นทาง (ระบบไม่ตาม redirect)', { status: res.status })
    }
    let body: Uint8Array
    try {
      body = await readLimited(res, maxBytes ?? DEFAULT_MAX_BYTES)
    } catch (e) {
      if (controller.signal.aborted) throw new PlatformError('timeout', 'แพลตฟอร์มตอบช้าเกินกำหนด')
      throw e
    }
    const nullBody = res.status === 204 || res.status === 205 || res.status === 304
    return new Response(nullBody ? null : (body as unknown as BodyInit), { status: res.status, statusText: res.statusText, headers: res.headers })
  } finally {
    clearTimeout(timer)
  }
}

function backoffMs(attempt: number): number {
  return Math.min(4000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250)
}

/**
 * fetch ที่ผ่าน allowlist ของแพลตฟอร์ม — คืน Response (อ่าน body ได้ครั้งเดียวตามปกติ) หรือโยน PlatformError
 * (blocked / timeout / network) — ผู้เรียกจัดการ status code เอง (401/404/429/5xx)
 */
export async function platformFetch(platform: Platform, url: string, init: PlatformFetchInit = {}): Promise<Response> {
  const target = assertAllowedUrl(platform, url)
  const method = String(init.method ?? 'GET').toUpperCase()
  const idempotent = method === 'GET' || method === 'HEAD'
  const retries = Math.max(0, Math.min(5, init.retries ?? (idempotent ? 2 : 0)))
  for (let attempt = 0; ; attempt++) {
    await pace(platform, method)
    let res: Response
    try {
      res = await fetchOnce(target, init, method)
    } catch (e) {
      const retryable = e instanceof PlatformError && (e.kind === 'network' || e.kind === 'timeout')
      if (retryable && attempt < retries) { await sleep(backoffMs(attempt)); continue }
      throw e
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const ra = retryAfterSeconds(res)
      if (res.status === 429 && ra !== null && ra > MAX_INLINE_WAIT_S) return res
      await sleep(ra !== null ? ra * 1000 : backoffMs(attempt))
      continue
    }
    return res
  }
}

/** อ่าน JSON จาก Response โดยไม่โยน error (อ่านไม่ได้ = null) */
export async function readJson<T = unknown>(res: Response): Promise<T | null> {
  let text = ''
  try { text = await res.text() } catch { return null }
  if (!text) return null
  try { return JSON.parse(text) as T } catch { return null }
}
