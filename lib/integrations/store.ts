// lib/integrations/store.ts — เข้าถึงฐานข้อมูลของระบบเชื่อมต่อด้วย service role (ฝั่งเซิร์ฟเวอร์เท่านั้น)
// ห่อ RPC ฝั่งเซิร์ฟเวอร์ของ supabase-fix-03-integrations.sql (CONTRACT §2.5) + ถอด/เข้ารหัสความลับ
// เรียกได้เฉพาะหลังยืนยันผู้เรียกแล้ว (admin session / ลายเซ็น webhook / worker bearer / OAuth state)
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  AdapterContext, CancelOrderResult, ChannelJson, FeedItems, InboundEventJob, NormalizedListing, NormalizedOrder, OrderSource,
  OutboxJob, Platform, RecordOrderResult, SyncLogKind, TokenSet, UpsertListingsResult,
} from './types'
import { PLATFORM_META } from './platforms'
import { credentialAad, decryptSecret, encryptSecret, IntegrationConfigError, maskHint } from './crypto'
import { DbError } from './errors'
import { apiBase, platformFetch } from './http'
import { logError } from './redact'

type AdminClient = ReturnType<typeof createAdminClient>
let clientFactory: () => AdminClient = () => createAdminClient()
let cachedClient: AdminClient | null = null

/** ใช้ในการทดสอบเท่านั้น: เปลี่ยนตัวสร้าง client (เช่น client ปลอมที่คุยกับ PGlite) */
export function setAdminClientFactory(factory: (() => AdminClient) | null): void {
  clientFactory = factory ?? (() => createAdminClient())
  cachedClient = null
}

function client(): AdminClient {
  if (!cachedClient) cachedClient = clientFactory()
  return cachedClient
}

const RETRYABLE_CODES = new Set(['40P01', '40001', '55P03', '57014', '53300', '53400', '57P01', '57P03', 'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'])

export function toDbError(err: { message?: unknown; code?: unknown } | null | undefined, status?: number): DbError {
  const code = err && err.code !== undefined && err.code !== null ? String(err.code) : ''
  const message = err && typeof err.message === 'string' && err.message.trim() ? err.message.trim() : 'ฐานข้อมูลไม่ตอบสนอง'
  const retryable = code === '' || RETRYABLE_CODES.has(code) || code.startsWith('08') || (status !== undefined && status >= 500 && !/^(P0001|42501|22|23)/.test(code))
  return new DbError(message, code, retryable)
}

/** เรียก RPC ด้วย service role — error → DbError (message ภาษาไทยจากฐานข้อมูล, code = SQLSTATE) */
export async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  let out: { data: unknown; error: { message?: unknown; code?: unknown } | null; status?: number }
  try {
    out = await client().rpc(name, args) as unknown as typeof out
  } catch (e) {
    throw toDbError({ message: e instanceof Error ? e.message : String(e), code: '' })
  }
  if (out.error) throw toDbError(out.error, out.status)
  return out.data as T
}

// ---------------------------------------------------------------------------
// ช่องทาง
// ---------------------------------------------------------------------------
export async function loadChannel(channelId: string): Promise<ChannelJson> {
  return rpc<ChannelJson>('get_integration_channel', { p_channel_id: channelId })
}

/** แถวช่องทางแบบย่อ (อ่านตารางตรงด้วย service role — ไม่นับตัวเลข) ใช้ใน worker / webhook */
export interface ChannelLite {
  id: string
  platform: Platform
  environment: 'sandbox' | 'production'
  status: ChannelJson['status']
  status_reason: string | null
  options: Record<string, unknown>
  settings: Record<string, unknown>
  external_shop_id: string | null
  paused_until: string | null
  next_token_check_at: string | null
  last_orders_sync_at: string | null
  orders_cursor: string | null
  last_stock_push_at: string | null
  auth_expires_at: string | null
  refresh_expires_at: string | null
  created_at: string
}

const LITE_COLUMNS = 'id, platform, environment, status, status_reason, options, settings, external_shop_id, paused_until, ' +
  'next_token_check_at, last_orders_sync_at, orders_cursor, last_stock_push_at, auth_expires_at, refresh_expires_at, created_at'

export async function listChannelsLite(): Promise<ChannelLite[]> {
  let res: { data: unknown; error: { message?: unknown; code?: unknown } | null; status?: number }
  try {
    res = await client().from('integration_channels').select(LITE_COLUMNS) as unknown as typeof res
  } catch (e) {
    throw toDbError({ message: e instanceof Error ? e.message : String(e), code: '' })
  }
  if (res.error) throw toDbError(res.error, res.status)
  return (Array.isArray(res.data) ? res.data : []) as ChannelLite[]
}

/** ตัวเลือกของช่องทาง (ค่าเริ่มต้นครบ) จากแถวย่อ */
export function liteOptions(c: Pick<ChannelLite, 'platform' | 'options'>): { push_stock: boolean; pull_orders: boolean; poll_seconds: number; initial_push_done: boolean } {
  const o = c.options && typeof c.options === 'object' ? c.options : {}
  const poll = typeof o.poll_seconds === 'number' ? o.poll_seconds : Number(o.poll_seconds)
  return {
    push_stock: o.push_stock === true,
    pull_orders: o.pull_orders === true,
    poll_seconds: Number.isFinite(poll) && poll >= 60 ? poll : c.platform === 'lazada' ? 300 : 900,
    initial_push_done: o.initial_push_done === true,
  }
}

export async function updateChannel(channelId: string, patch: Record<string, unknown>): Promise<ChannelJson> {
  return rpc<ChannelJson>('server_update_channel', { p_channel_id: channelId, p_patch: patch })
}

// ---------------------------------------------------------------------------
// ความลับ
// ---------------------------------------------------------------------------
interface CredentialRow { name: string; ciphertext: string; iv: string; tag: string; key_version: number; hint: string | null; version: number; updated_at: string }

/** ถอดรหัสทุกแถวของช่องทาง (+ version ไว้ทำ compare-and-swap) — ห้ามส่งค่าออกนอกคำขอนี้ */
export async function loadCredentialRows(channelId: string): Promise<{ values: Record<string, string>; versions: Record<string, number> }> {
  const rows = await rpc<CredentialRow[]>('get_integration_credentials', { p_channel_id: channelId })
  const values: Record<string, string> = {}
  const versions: Record<string, number> = {}
  for (const row of Array.isArray(rows) ? rows : []) {
    values[row.name] = decryptSecret(row, credentialAad(channelId, row.name))
    versions[row.name] = Number(row.version)
  }
  return { values, versions }
}

export async function loadCredentials(channelId: string): Promise<Record<string, string>> {
  return (await loadCredentialRows(channelId)).values
}

const CRED_NAME_RE = /^[a-z][a-z0-9_]{0,47}$/

/** ชื่อความลับที่แสดงคำใบ้แบบเต็มได้ (ค่าไม่ลับในแบบฟอร์ม) */
function nonSecretNames(platform?: Platform): Set<string> {
  const out = new Set<string>()
  if (!platform) return out
  for (const f of PLATFORM_META[platform].credentialFields) if (!f.secret) out.add(f.name)
  return out
}

export async function saveCredentialValues(
  channelId: string,
  values: Record<string, string>,
  opts: { secretNames?: string[]; platform?: Platform; expectedVersions?: Record<string, number>; actor?: string | null } = {},
): Promise<{ ok: boolean; hints: Record<string, string>; conflict?: string[]; versions?: Record<string, number> }> {
  const plain = nonSecretNames(opts.platform)
  const secretSet = opts.secretNames ? new Set(opts.secretNames) : null
  const rows: Record<string, unknown>[] = []
  const hints: Record<string, string> = {}
  for (const [name, value] of Object.entries(values)) {
    if (!CRED_NAME_RE.test(name)) throw new IntegrationConfigError('ชื่อคีย์ไม่ถูกต้อง')
    const secret = secretSet ? secretSet.has(name) : !plain.has(name)
    const enc = encryptSecret(String(value), credentialAad(channelId, name))
    const hint = maskHint(String(value), secret)
    hints[name] = hint
    rows.push({ name, ...enc, hint })
  }
  if (rows.length === 0) return { ok: true, hints }
  const res = await rpc<{ ok: boolean; versions?: Record<string, number>; conflict?: string[] }>('save_integration_credentials', {
    p_channel_id: channelId,
    p_rows: rows,
    p_expected_versions: opts.expectedVersions ?? null,
    p_actor: opts.actor ?? null,
  })
  if (!res || res.ok !== true) return { ok: false, hints: {}, conflict: res?.conflict ?? [] }
  return { ok: true, hints, versions: res.versions }
}

export async function deleteCredentials(channelId: string, names: string[] | null): Promise<number> {
  return rpc<number>('delete_integration_credentials', { p_channel_id: channelId, p_names: names })
}

/** เวลาตรวจต่ออายุ token ครั้งถัดไป: ก่อนหมดอายุ (≤ 6 ชม. เหลือ 10 นาที, ยาวกว่านั้น 10% ของที่เหลือ สูงสุด 12 ชม.) และไม่เกิน 24 ชม. */
export function nextTokenCheckAt(accessExpiresAt: Date | null | undefined, now: Date): Date {
  const nowMs = now.getTime()
  const day = nowMs + 24 * 3600 * 1000
  if (!accessExpiresAt || Number.isNaN(accessExpiresAt.getTime())) return new Date(day)
  const remaining = accessExpiresAt.getTime() - nowMs
  const margin = remaining <= 6 * 3600 * 1000 ? 10 * 60 * 1000 : Math.min(12 * 3600 * 1000, Math.max(10 * 60 * 1000, remaining * 0.1))
  const at = Math.min(accessExpiresAt.getTime() - margin, day)
  return new Date(Math.max(at, nowMs + 60 * 1000))
}

/**
 * บันทึกโทเคน (เข้ารหัส) + วันหมดอายุ — expectedRefreshVersion = compare-and-swap บน refresh_token
 * คืน false เมื่อมีงานอื่นต่ออายุไปก่อนแล้ว (ให้อ่านความลับใหม่)
 */
export async function saveTokens(channelId: string, tokens: TokenSet, expectedRefreshVersion?: number, now: Date = new Date()): Promise<boolean> {
  const values: Record<string, string> = { access_token: tokens.access_token }
  if (tokens.refresh_token) values.refresh_token = tokens.refresh_token
  const saved = await saveCredentialValues(channelId, values, {
    secretNames: Object.keys(values),
    expectedVersions: expectedRefreshVersion !== undefined ? { refresh_token: expectedRefreshVersion } : undefined,
  })
  if (!saved.ok) return false
  const patch: Record<string, unknown> = {
    token_expires_at: tokens.access_expires_at ? tokens.access_expires_at.toISOString() : null,
    next_token_check_at: nextTokenCheckAt(tokens.access_expires_at ?? null, now).toISOString(),
  }
  if (tokens.refresh_expires_at !== undefined) patch.refresh_expires_at = tokens.refresh_expires_at ? tokens.refresh_expires_at.toISOString() : null
  if (tokens.auth_expires_at !== undefined && tokens.auth_expires_at !== null) patch.auth_expires_at = tokens.auth_expires_at.toISOString()
  await updateChannel(channelId, patch)
  return true
}

/** context ของ adapter: ช่องทาง + ความลับที่ถอดแล้ว + fetch ที่ผ่าน allowlist */
export async function buildContext(channelId: string, preloaded?: { channel?: ChannelJson; creds?: Record<string, string> }): Promise<AdapterContext> {
  const channel = preloaded?.channel ?? await loadChannel(channelId)
  const creds = preloaded?.creds ?? await loadCredentials(channelId)
  const platform = channel.platform
  return {
    channel,
    creds: Object.freeze({ ...creds }),
    fetch: (url, init) => platformFetch(platform, url, init),
    apiBase: (key) => apiBase(platform, key),
    now: () => new Date(),
  }
}

// ---------------------------------------------------------------------------
// ออเดอร์ / คิว / event / log (ห่อ RPC ตรงตัว)
// ---------------------------------------------------------------------------
export function recordOrder(channelId: string, order: NormalizedOrder, source: OrderSource = 'webhook'): Promise<RecordOrderResult> {
  return rpc<RecordOrderResult>('record_channel_order', { p_channel_id: channelId, p_order: order, p_source: source })
}

export function cancelOrder(channelId: string, externalOrderId: string, opts: { status?: 'cancelled' | 'expired'; rawStatus?: string | null; wasShipped?: boolean | null; updatedAt?: string | null } = {}): Promise<CancelOrderResult> {
  return rpc<CancelOrderResult>('cancel_channel_order', {
    p_channel_id: channelId,
    p_external_order_id: externalOrderId,
    p_status: opts.status ?? 'cancelled',
    p_raw_status: opts.rawStatus ?? null,
    p_was_shipped: opts.wasShipped ?? null,
    p_updated_at: opts.updatedAt ?? null,
  })
}

export async function claimOutbox(limit: number, worker: string, channelId: string | null = null, leaseSeconds = 60): Promise<OutboxJob[]> {
  const jobs = await rpc<OutboxJob[]>('claim_outbox', { p_limit: limit, p_worker: worker, p_channel_id: channelId, p_lease_seconds: leaseSeconds })
  return Array.isArray(jobs) ? jobs : []
}

export function completeOutbox(worker: string, results: { id: number; pushed_qty: number; platform_qty?: number }[]): Promise<{ completed: number; lost: number[] }> {
  return rpc('complete_outbox', { p_worker: worker, p_results: results })
}

export function failOutbox(worker: string, failures: { id: number; error: string; permanent?: boolean; retry_after_seconds?: number }[]): Promise<{ retry: number; dead: number; lost: number[] }> {
  return rpc('fail_outbox', { p_worker: worker, p_failures: failures })
}

export function upsertListings(channelId: string, rows: NormalizedListing[]): Promise<UpsertListingsResult> {
  return rpc<UpsertListingsResult>('upsert_channel_listings', { p_channel_id: channelId, p_rows: rows })
}

export function markGone(channelId: string, seenBefore: Date): Promise<number> {
  return rpc<number>('mark_missing_listings_gone', { p_channel_id: channelId, p_seen_before: seenBefore.toISOString() })
}

/** เขียนบันทึกการซิงก์ — ไม่โยน error (บันทึกไม่ได้ต้องไม่ทำให้งานหลักล้ม) */
export async function log(channelId: string | null, kind: SyncLogKind, ok: boolean, summary: string, detail?: Record<string, unknown> | null, actor?: string | null, durationMs?: number | null): Promise<void> {
  try {
    await rpc('log_integration', {
      p_channel_id: channelId,
      p_kind: kind,
      p_ok: ok,
      p_summary: summary.slice(0, 500),
      p_detail: detail ?? null,
      p_actor: actor ?? null,
      p_duration_ms: durationMs === undefined || durationMs === null ? null : Math.max(0, Math.round(durationMs)),
    })
  } catch (e) {
    logError('log_integration', e)
  }
}

export function recordEvent(channelId: string, ev: { event_id: string; event_type: string | null; external_order_id: string | null; payload: Record<string, unknown> | null }): Promise<{ id: number; duplicate: boolean; status: string }> {
  return rpc('record_inbound_event', {
    p_channel_id: channelId,
    p_event_id: ev.event_id,
    p_event_type: ev.event_type,
    p_external_order_id: ev.external_order_id,
    p_payload: ev.payload,
  })
}

export async function claimEvents(limit: number, worker: string, channelId: string | null = null, leaseSeconds = 120): Promise<InboundEventJob[]> {
  const rows = await rpc<InboundEventJob[]>('claim_inbound_events', { p_limit: limit, p_worker: worker, p_channel_id: channelId, p_lease_seconds: leaseSeconds })
  return Array.isArray(rows) ? rows : []
}

export function completeEvent(id: number, worker: string, status: 'done' | 'ignored' = 'done', note: string | null = null): Promise<boolean> {
  return rpc<boolean>('complete_inbound_event', { p_id: id, p_worker: worker, p_status: status, p_note: note })
}

export function failEvent(id: number, worker: string, error: string, permanent = false, retryAfterSeconds: number | null = null): Promise<unknown> {
  return rpc('fail_inbound_event', { p_id: id, p_worker: worker, p_error: error.slice(0, 1000), p_permanent: permanent, p_retry_after_seconds: retryAfterSeconds })
}

export function createOAuthState(channelId: string, stateHash: string, createdBy: string | null): Promise<{ expires_at: string }> {
  return rpc('create_oauth_state', { p_channel_id: channelId, p_state_hash: stateHash, p_created_by: createdBy, p_ttl_seconds: 600 })
}

export function consumeOAuthState(stateHash: string): Promise<{ channel_id: string; platform: Platform; environment: string; created_by: string | null } | null> {
  return rpc('consume_oauth_state', { p_state_hash: stateHash })
}

export function lease(channelId: string, worker: string, seconds = 60): Promise<boolean> {
  return rpc<boolean>('acquire_channel_lease', { p_channel_id: channelId, p_worker: worker, p_seconds: seconds })
}

export async function release(channelId: string, worker: string): Promise<void> {
  try {
    await rpc<boolean>('release_channel_lease', { p_channel_id: channelId, p_worker: worker })
  } catch (e) {
    logError('release_channel_lease', e)
  }
}

export function feedItems(tokenHash: string): Promise<FeedItems | null> {
  return rpc<FeedItems | null>('get_feed_items', { p_token_hash: tokenHash })
}

export function setFeedToken(channelId: string, tokenHash: string | null): Promise<ChannelJson> {
  return rpc<ChannelJson>('set_feed_token', { p_channel_id: channelId, p_token_hash: tokenHash })
}

export function workDue(): Promise<boolean> {
  return rpc<boolean>('integration_work_due')
}

export function housekeeping(): Promise<Record<string, number>> {
  return rpc<Record<string, number>>('integration_housekeeping')
}

/** เข้าคิวส่งสต๊อกทุกรายการใหม่ (admin RPC — service role เรียกได้) */
export function requestResync(channelId: string): Promise<{ enqueued: number }> {
  return rpc<{ enqueued: number }>('request_channel_resync', { p_channel_id: channelId })
}

// ---------------------------------------------------------------------------
// อ่านตารางตรง (service role) — เท่าที่ worker ต้องใช้
// ---------------------------------------------------------------------------
/** สถานะที่ระบบรู้แล้วของออเดอร์ (ใช้ตัดสินว่าต้องดึงรายละเอียดออเดอร์ซ้ำไหม) */
export async function knownOrders(channelId: string, externalIds: string[]): Promise<Map<string, { status: string; raw_status: string | null }>> {
  const out = new Map<string, { status: string; raw_status: string | null }>()
  const ids = Array.from(new Set(externalIds)).filter(Boolean)
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const res = await client().from('channel_orders').select('external_order_id, status, raw_status')
      .eq('channel_id', channelId).in('external_order_id', chunk) as unknown as { data: unknown; error: { message?: unknown; code?: unknown } | null; status?: number }
    if (res.error) throw toDbError(res.error, res.status)
    for (const r of (Array.isArray(res.data) ? res.data : []) as { external_order_id: string; status: string; raw_status: string | null }[]) {
      out.set(r.external_order_id, { status: r.status, raw_status: r.raw_status })
    }
  }
  return out
}

/** ราคา + path รูป ของสินค้า (ส่งให้ Meta พร้อมสต๊อก) */
// รหัสใน .in() ไปอยู่ใน URL ของ GET — แบ่งทีละ 100 (Meta ส่งได้ถึง 500 รายการต่อรอบ = URL ยาวเกินที่ gateway รับ)
const IN_CHUNK = 100
function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export async function productPushInfo(productIds: string[]): Promise<Map<string, { price: number | null; image_paths: string[] }>> {
  const out = new Map<string, { price: number | null; image_paths: string[] }>()
  const ids = Array.from(new Set(productIds)).filter(Boolean)
  if (!ids.length) return out
  const products: { id: string; sell_price: number | string | null; group_id: string | null }[] = []
  for (const part of chunks(ids, IN_CHUNK)) {
    const p = await client().from('products').select('id, sell_price, group_id').in('id', part) as unknown as { data: unknown; error: { message?: unknown; code?: unknown } | null; status?: number }
    if (p.error) throw toDbError(p.error, p.status)
    products.push(...(Array.isArray(p.data) ? p.data : []) as { id: string; sell_price: number | string | null; group_id: string | null }[])
  }
  const groupIds = Array.from(new Set(products.map(x => x.group_id).filter((x): x is string => !!x)))
  const images = new Map<string, { path: string; sort_order: number; created_at: string }[]>()
  for (const part of chunks(groupIds, IN_CHUNK)) {
    const im = await client().from('product_images').select('group_id, path, sort_order, created_at').in('group_id', part) as unknown as { data: unknown; error: { message?: unknown; code?: unknown } | null; status?: number }
    if (im.error) throw toDbError(im.error, im.status)
    for (const r of (Array.isArray(im.data) ? im.data : []) as { group_id: string; path: string; sort_order: number; created_at: string }[]) {
      const list = images.get(r.group_id) ?? []
      list.push(r)
      images.set(r.group_id, list)
    }
  }
  for (const prod of products) {
    const list = (prod.group_id ? images.get(prod.group_id) ?? [] : [])
      .slice()
      .sort((a, b) => (a.sort_order - b.sort_order) || String(a.created_at).localeCompare(String(b.created_at)))
    const price = prod.sell_price === null || prod.sell_price === undefined ? null : Number(prod.sell_price)
    out.set(prod.id, { price: price !== null && Number.isFinite(price) ? price : null, image_paths: list.map(x => x.path) })
  }
  return out
}
