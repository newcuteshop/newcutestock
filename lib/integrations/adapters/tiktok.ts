// lib/integrations/adapters/tiktok.ts — TikTok Shop Partner API (Custom App ของร้านเอง) ตลาด TH
// รอบนี้: phase 'auth_only' — เชื่อมร้าน (OAuth) / ต่ออายุ token / ลายเซ็น / ทดสอบร้าน ใช้งานได้
//   ส่งสต๊อก + ดึงออเดอร์ เขียนตามสเปกแต่ "ยังไม่เคยทดสอบกับร้านจริง" (UNTESTED LIVE) และถูกกันไว้ที่ worker
//   ข้อที่ยังไม่ยืนยัน: ส่งจำนวน 0 ผ่าน API ได้หรือไม่ (เอกสารบอกช่วง 1–99,999), body '{}' ของ POST ที่ไม่มีตัวกรองต้องเซ็นด้วยไหม
// สเปก: specs/tiktok.json + CONTRACT-INTEGRATIONS.md §3.4
// ฝั่งเซิร์ฟเวอร์เท่านั้น
import type {
  AdapterContext, ChannelAdapter, ConnectResult, EventAction, InboundEventInput, InboundEventJob, NormalizedOrder,
  NormalizedOrderLine, OrderStatus, OutboxJob, PushResult, TokenSet,
} from '../types'
import { hmacSha256, timingSafeEqualStr } from '../crypto'
import { PlatformError } from '../errors'
import { readJson } from '../http'
import {
  aggregateLines, asArr, asObj, httpError, isBatchLevel, pushFail, pushOk, testFail, toInt, toIso, toNum, toStr,
  type TestResult,
} from './common'

const LABEL = 'TikTok Shop'
export const TIKTOK_UNTESTED_LIVE = true

// ---------------------------------------------------------------------------
// ลายเซ็น (pure — ค่าทดสอบทางการ: secret e59af819cc, GET /authorization/202309/shops?app_key=29a39d&timestamp=1623812664
//   → b596b73e…582dc8)  คีย์ query ทั้งหมดยกเว้น sign / access_token เรียงชื่อ ต่อ key+value (ค่าที่ decode แล้ว)
//   นำหน้าด้วย path และต่อท้ายด้วย body ดิบ (ถ้าไม่ใช่ multipart) แล้วครอบ secret + … + secret, HMAC-SHA256(secret) hex ตัวเล็ก
// ---------------------------------------------------------------------------
export function tiktokSign(secret: string, path: string, query: Record<string, string | number | null | undefined>, body?: string | null): string {
  const keys = Object.keys(query)
    .filter(k => k !== 'sign' && k !== 'access_token' && query[k] !== null && query[k] !== undefined)
    .sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')))
  const base = path + keys.map(k => k + String(query[k])).join('') + (body ?? '')
  return hmacSha256(secret, secret + base + secret, 'hex')
}

/** webhook: Authorization = hex(HMAC-SHA256(app_secret, app_key + raw body)) (ไม่มีคำว่า Bearer) */
export function tiktokWebhookSignature(appKey: string, appSecret: string, rawBody: string): string {
  return hmacSha256(appSecret, appKey + rawBody, 'hex')
}
export function verifyTiktokPush(appKey: string, appSecret: string, rawBody: string, authorization: string | null): boolean {
  if (!appKey || !appSecret || !authorization) return false
  return timingSafeEqualStr(tiktokWebhookSignature(appKey, appSecret, rawBody), authorization.trim().toLowerCase())
}

// ---------------------------------------------------------------------------
// สถานะ (CONTRACT §3.4) — webhook ใช้ 'CANCEL' ส่วน API ใช้ 'CANCELLED'
// ---------------------------------------------------------------------------
export function mapTiktokStatus(raw: unknown): OrderStatus {
  switch (String(raw ?? '').toUpperCase()) {
    case 'UNPAID': case 'ON_HOLD': return 'unpaid'
    case 'AWAITING_SHIPMENT': case 'AWAITING_COLLECTION': case 'PARTIALLY_SHIPPING': return 'ready_to_ship'
    case 'IN_TRANSIT': return 'shipped'
    case 'DELIVERED': case 'COMPLETED': return 'completed'
    case 'CANCELLATION_REQUEST_PENDING': return 'cancel_pending'
    case 'CANCELLED': case 'CANCEL': return 'cancelled'
    case 'RETURN_OR_REFUND_REQUEST_PENDING': return 'return_requested'
    default: return 'unknown'
  }
}

// ---------------------------------------------------------------------------
// เรียก API
// ---------------------------------------------------------------------------
function app(ctx: AdapterContext): { key: string; secret: string } {
  const key = ctx.creds.app_key ?? toStr(ctx.channel.settings?.app_key)
  const secret = ctx.creds.app_secret
  if (!key || !/^[0-9a-z]{4,64}$/.test(key) || !secret) throw new PlatformError('config', 'ยังไม่ได้ใส่ App Key / App Secret ของ TikTok Shop')
  return { key, secret }
}

function checkEnvelope(res: Response, d: Record<string, unknown>): Record<string, unknown> {
  const code = toInt(d.code)
  const reqId = toStr(d.request_id)
  const tail = reqId ? ` (request id ${reqId.slice(0, 60)})` : ''
  if (res.status === 429 || code === 36009002) throw new PlatformError('rate_limit', `TikTok Shop จำกัดความถี่${tail}`, { retryAfterSeconds: 60, platformCode: String(code ?? 429) })
  if (!res.ok && (code === null || code === 0)) throw httpError(LABEL, res, toStr(d.message), reqId)
  if (code !== null && code !== 0) {
    const msg = toStr(d.message) ?? String(code)
    if (code === 105002 || code === 105001 || code === 36004004 || code === 36004005) {
      throw new PlatformError('reauth', `TikTok Shop ปฏิเสธโทเคน/รหัสอนุญาต (${code}) — กด "เชื่อมต่อร้าน" ใหม่${tail}`, { platformCode: String(code) })
    }
    if (res.status === 401 || res.status === 403 || code === 106001 || code === 36009003) {
      throw new PlatformError('auth', `TikTok Shop ไม่รับคีย์/ลายเซ็น (${code})${tail}`, { platformCode: String(code) })
    }
    if (res.status >= 500) throw new PlatformError('server', `TikTok Shop ขัดข้องชั่วคราว (${code})${tail}`, { platformCode: String(code) })
    throw new PlatformError('validation', `TikTok Shop ไม่รับคำขอ (${code}: ${msg.slice(0, 120)})${tail}`, { platformCode: String(code) })
  }
  return d
}

/** เรียก API ธุรกิจ (มีลายเซ็น + x-tts-access-token) */
export async function tiktokCall(ctx: AdapterContext, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string,
  query: Record<string, string> = {}, bodyObj?: unknown, opts: { shopCipher?: boolean; token?: string } = {}): Promise<Record<string, unknown>> {
  const a = app(ctx)
  const token = opts.token ?? ctx.creds.access_token
  if (!token) throw new PlatformError('config', 'ยังไม่ได้เชื่อมต่อร้าน TikTok Shop (กด "เชื่อมต่อร้าน")')
  const q: Record<string, string> = { ...query, app_key: a.key, timestamp: String(Math.floor(ctx.now().getTime() / 1000)) }
  if (opts.shopCipher ?? true) {
    const cipher = toStr(ctx.channel.settings?.shop_cipher)
    if (!cipher) throw new PlatformError('config', 'ยังไม่มี shop_cipher ของร้าน — กด "เชื่อมต่อร้าน" ใหม่')
    q.shop_cipher = cipher
  }
  const body = bodyObj === undefined ? undefined : JSON.stringify(bodyObj)
  q.sign = tiktokSign(a.secret, path, q, body)
  const url = `${ctx.apiBase('api')}${path}?${new URLSearchParams(q).toString()}`
  const res = await ctx.fetch(url, {
    method,
    headers: { 'x-tts-access-token': token, 'content-type': 'application/json', Accept: 'application/json' },
    body,
  })
  return checkEnvelope(res, asObj(await readJson(res)))
}

/** token/get และ token/refresh (ไม่เซ็น — URL มี app_secret จึงห้าม log URL นี้เด็ดขาด) */
async function tokenCall(ctx: AdapterContext, path: '/api/v2/token/get' | '/api/v2/token/refresh', params: Record<string, string>): Promise<Record<string, unknown>> {
  const a = app(ctx)
  const q = new URLSearchParams({ app_key: a.key, app_secret: a.secret, ...params })
  // ไม่ลองซ้ำอัตโนมัติ: รหัสอนุญาต/refresh token ใช้ได้ครั้งเดียว
  const init: RequestInit & { timeoutMs?: number; retries?: number } = { method: 'GET', headers: { Accept: 'application/json' }, retries: 0 }
  const res = await ctx.fetch(`${ctx.apiBase('auth')}${path}?${q.toString()}`, init)
  return asObj(checkEnvelope(res, asObj(await readJson(res))).data)
}

function tokensFrom(d: Record<string, unknown>): TokenSet {
  const access = toStr(d.access_token)
  const refresh = toStr(d.refresh_token)
  if (!access || !refresh) throw new PlatformError('auth', 'TikTok Shop ไม่ส่งโทเคนกลับมา')
  // access_token_expire_in / refresh_token_expire_in เป็นเวลา epoch (วินาที) ไม่ใช่ระยะเวลา
  const accessAt = toIso(d.access_token_expire_in)
  const refreshAt = toIso(d.refresh_token_expire_in)
  return {
    access_token: access,
    refresh_token: refresh,
    access_expires_at: accessAt ? new Date(accessAt) : null,
    refresh_expires_at: refreshAt ? new Date(refreshAt) : null,
    auth_expires_at: refreshAt ? new Date(refreshAt) : null,
  }
}

function buildAuthUrl(ctx: AdapterContext, state: string): string {
  const serviceId = ctx.creds.service_id ?? toStr(ctx.channel.settings?.service_id)
  if (!serviceId || !/^[0-9]{4,30}$/.test(serviceId)) throw new PlatformError('config', 'ยังไม่ได้ใส่ Service ID ของ TikTok Shop')
  return `https://services.tiktokshop.com/open/authorize?${new URLSearchParams({ service_id: serviceId, state }).toString()}`
}

interface TiktokShop { id: string; name: string | null; region: string | null; cipher: string | null; seller_type: string | null }

async function authorizedShops(ctx: AdapterContext, token?: string): Promise<TiktokShop[]> {
  const d = await tiktokCall(ctx, 'GET', '/authorization/202309/shops', {}, undefined, { shopCipher: false, token })
  return asArr(asObj(d.data).shops).map(asObj).map(s => ({
    id: toStr(s.id) ?? '',
    name: toStr(s.name),
    region: toStr(s.region),
    cipher: toStr(s.cipher),
    seller_type: toStr(s.seller_type),
  })).filter(s => s.id)
}

function pickShop(shops: TiktokShop[], preferId?: string | null): TiktokShop | null {
  return shops.find(s => preferId && s.id === preferId) ?? shops.find(s => s.region === 'TH') ?? shops[0] ?? null
}

async function exchangeCode(ctx: AdapterContext, query: URLSearchParams): Promise<ConnectResult> {
  const code = toStr(query.get('code'))
  if (!code) throw new PlatformError('validation', 'ไม่ได้รับรหัสอนุญาตจาก TikTok Shop')
  const d = await tokenCall(ctx, '/api/v2/token/get', { auth_code: code, grant_type: 'authorized_code' })
  const tokens = tokensFrom(d)
  const shop = pickShop(await authorizedShops(ctx, tokens.access_token))
  if (!shop || !shop.cipher) throw new PlatformError('validation', 'ไม่พบร้านที่อนุญาตในบัญชีนี้')
  return {
    ...tokens,
    shop_id: shop.id,
    shop_name: shop.name ?? toStr(d.seller_name) ?? undefined,
    settings: { shop_cipher: shop.cipher, region: shop.region, seller_type: shop.seller_type },
  }
}

async function refreshToken(ctx: AdapterContext): Promise<TokenSet> {
  const refresh = ctx.creds.refresh_token
  if (!refresh) throw new PlatformError('reauth', 'ไม่มีโทเคนของร้าน TikTok Shop — กด "เชื่อมต่อร้าน" ใหม่')
  const d = await tokenCall(ctx, '/api/v2/token/refresh', { refresh_token: refresh, grant_type: 'refresh_token' })
  return tokensFrom(d)
}

async function testConnection(ctx: AdapterContext): Promise<TestResult> {
  try {
    app(ctx)
    if (!ctx.creds.access_token) {
      return { ok: false, message: 'บันทึกคีย์แล้ว — ขั้นต่อไปกด "เชื่อมต่อร้าน"', reason: 'awaiting_credentials' }
    }
    const shop = pickShop(await authorizedShops(ctx), toStr(ctx.channel.external_shop_id))
    if (!shop) return { ok: false, message: 'ไม่พบร้านที่อนุญาตในบัญชีนี้', reason: 'needs_reauth' }
    return {
      ok: true,
      message: `เชื่อมต่อร้าน TikTok Shop${shop.name ? ' "' + shop.name + '"' : ''} สำเร็จ`,
      shop_id: shop.id,
      shop_name: shop.name ?? undefined,
      settings: { shop_cipher: shop.cipher, region: shop.region, seller_type: shop.seller_type },
    }
  } catch (e) {
    return testFail(e, 'เชื่อมต่อ TikTok Shop ไม่สำเร็จ')
  }
}

// ----- UNTESTED LIVE: ส่งสต๊อก (1 สินค้าต่อครั้ง ≤ 100 SKU; ต้องใส่ทุกคลังของ SKU) -----
async function pushStock(ctx: AdapterContext, jobs: OutboxJob[]): Promise<PushResult[]> {
  const results: PushResult[] = []
  const groups = new Map<string, OutboxJob[]>()
  for (const job of jobs) {
    const list = groups.get(job.listing.external_item_id) ?? []
    list.push(job)
    groups.set(job.listing.external_item_id, list)
  }
  let batchError: unknown = null
  for (const [productId, all] of Array.from(groups.entries())) {
    for (let i = 0; i < all.length; i += 100) {
      const list = all.slice(i, i + 100)
      if (batchError) { for (const job of list) results.push(pushFail(job, batchError)); continue }
      if (!/^[0-9]{1,30}$/.test(productId)) { for (const job of list) results.push(pushFail(job, 'รหัสสินค้า TikTok ไม่ถูกต้อง', { permanent: true })); continue }
      const skus = list.map(job => {
        const warehouses = asArr(asObj(job.listing.extra).warehouse_ids).map(w => toStr(w)).filter((w): w is string => !!w)
        const qty = Math.max(0, Math.trunc(job.qty))
        return {
          id: job.listing.external_sku_id,
          inventory: warehouses.length ? warehouses.map(w => ({ warehouse_id: w, quantity: qty })) : [{ quantity: qty }],
        }
      })
      try {
        const d = await tiktokCall(ctx, 'POST', `/product/202309/products/${productId}/inventory/update`, {}, { skus })
        const failed = new Map<string, string>()
        for (const er of asArr(asObj(d.data).errors)) {
          const o = asObj(er)
          const sku = toStr(asObj(o.detail).sku_id)
          if (sku) failed.set(sku, toStr(o.message) ?? String(toInt(o.code) ?? ''))
        }
        for (const job of list) {
          const reason = failed.get(job.listing.external_sku_id)
          results.push(reason ? pushFail(job, `TikTok Shop ไม่รับสต๊อก: ${reason.slice(0, 160)}`, { permanent: true }) : pushOk(job, job.qty, job.qty))
        }
      } catch (e) {
        if (isBatchLevel(e)) batchError = e
        for (const job of list) results.push(pushFail(job, e))
      }
    }
  }
  return results
}

/** รายการสินค้า TikTok (1 บรรทัด = 1 ชิ้น) → รวมตาม sku_id */
export function tiktokLines(items: unknown[]): NormalizedOrderLine[] {
  return aggregateLines(items.map(raw => {
    const it = asObj(raw)
    const display = String(it.display_status ?? '').toUpperCase()
    return {
      sku_id: toStr(it.sku_id) ?? undefined,
      item_id: toStr(it.product_id) ?? undefined,
      sku: toStr(it.seller_sku),
      name: toStr(it.product_name)?.slice(0, 500) ?? null,
      qty: 1,
      qty_cancelled: display === 'CANCELLED' || display === 'CANCEL' ? 1 : 0,
      qty_returned: 0,
      unit_price: toNum(it.sale_price) ?? toNum(it.original_price),
    }
  }))
}

function tiktokOrder(o: Record<string, unknown>): NormalizedOrder | null {
  const id = toStr(o.id)
  if (!id) return null
  const raw = toStr(o.status)
  return {
    external_order_id: id,
    status: mapTiktokStatus(raw),
    raw_status: raw,
    created_at: toIso(o.create_time),
    updated_at: toIso(o.update_time),
    currency: toStr(asObj(o.payment).currency) ?? 'THB',
    total: toNum(asObj(o.payment).total_amount),
    lines: tiktokLines(asArr(o.line_items)),
    raw: { id, status: raw },
  }
}

// ----- UNTESTED LIVE: ดึงออเดอร์ /order/202309/orders/search (update_time ASC, page_token) -----
async function fetchOrders(ctx: AdapterContext, q: { since: Date; until: Date; cursor?: string }) {
  const query: Record<string, string> = { page_size: '50', sort_field: 'update_time', sort_order: 'ASC' }
  if (q.cursor) query.page_token = q.cursor
  const d = await tiktokCall(ctx, 'POST', '/order/202309/orders/search', query, {
    update_time_ge: Math.floor(q.since.getTime() / 1000),
    update_time_lt: Math.floor(q.until.getTime() / 1000),
  })
  const data = asObj(d.data)
  const orders = asArr(data.orders).map(o => tiktokOrder(asObj(o))).filter((o): o is NormalizedOrder => !!o)
  return { orders, next: toStr(data.next_page_token) ?? undefined }
}

async function fetchOrdersByIds(ctx: AdapterContext, ids: string[]): Promise<NormalizedOrder[]> {
  const out: NormalizedOrder[] = []
  const clean = ids.filter(x => /^[0-9]{1,30}$/.test(x))
  for (let i = 0; i < clean.length; i += 50) {
    const d = await tiktokCall(ctx, 'GET', '/order/202507/orders', { ids: clean.slice(i, i + 50).join(',') })
    for (const raw of asArr(asObj(d.data).orders)) {
      const o = tiktokOrder(asObj(raw))
      if (o) out.push(o)
    }
  }
  return out
}

function verifyWebhook(input: { rawBody: string; headers: Headers; url: string }, secrets: Readonly<Record<string, string>>): boolean {
  return verifyTiktokPush(secrets.app_key ?? '', secrets.app_secret ?? '', input.rawBody, input.headers.get('authorization'))
}

const TYPE_NAMES: Record<number, string> = {
  1: 'ORDER_STATUS_CHANGE', 5: 'PRODUCT_STATUS_CHANGE', 6: 'SELLER_DEAUTHORIZATION', 7: 'UPCOMING_AUTHORIZATION_EXPIRATION',
  11: 'CANCELLATION_STATUS_CHANGE', 12: 'RETURN_STATUS_CHANGE',
}

function parseWebhook(rawBody: string): InboundEventInput[] {
  const body = asObj(JSON.parse(rawBody))
  const id = toStr(body.tts_notification_id)
  const type = toInt(body.type)
  const data = asObj(body.data)
  if (!id) throw new PlatformError('validation', 'webhook ของ TikTok Shop ไม่มี tts_notification_id')
  return [{
    event_id: id.slice(0, 200),
    event_type: type !== null ? (TYPE_NAMES[type] ?? `type_${type}`) : null,
    external_order_id: toStr(data.order_id),
    payload: { type, shop_id: toStr(body.shop_id), timestamp: body.timestamp ?? null, data },
  }]
}

async function eventToActions(_ctx: AdapterContext, ev: InboundEventJob): Promise<EventAction[]> {
  const p = asObj(ev.payload)
  const type = toInt(p.type)
  const data = asObj(p.data)
  const orderId = toStr(data.order_id)
  if ((type === 1 || type === 11 || type === 12) && orderId) return [{ kind: 'fetch_orders', external_order_ids: [orderId] }]
  return [{ kind: 'ignore', note: `webhook TikTok ประเภท ${type ?? '-'} ไม่เกี่ยวกับสต๊อก` }]
}

const adapter: ChannelAdapter = {
  platform: 'tiktok',
  testConnection,
  buildAuthUrl,
  exchangeCode,
  refreshToken,
  pushStock,
  fetchOrders,
  fetchOrdersByIds,
  verifyWebhook,
  parseWebhook,
  eventToActions,
}

export default adapter
