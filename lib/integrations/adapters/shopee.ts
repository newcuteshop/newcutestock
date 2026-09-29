// lib/integrations/adapters/shopee.ts — Shopee Open Platform v2 (แอป Seller In-house System)
// รอบนี้: phase 'auth_only' — เชื่อมร้าน (OAuth) / ต่ออายุ token / ลายเซ็น / ทดสอบร้าน ใช้งานได้
//   ส่งสต๊อก + ดึงออเดอร์ เขียนตามสเปกแล้วแต่ "ยังไม่เคยทดสอบกับร้านจริง" (UNTESTED LIVE) และถูกกันไว้:
//   worker จะเรียกเฉพาะเมื่อ PLATFORM_META.shopee.capabilities เปิด + ช่องทางสถานะ connected
// สเปก: specs/shopee.json + CONTRACT-INTEGRATIONS.md §3.4
// ฝั่งเซิร์ฟเวอร์เท่านั้น
import type {
  AdapterContext, ChannelAdapter, ConnectResult, EventAction, InboundEventInput, InboundEventJob, NormalizedOrder,
  NormalizedOrderLine, OrderStatus, OutboxJob, PushResult, TokenSet,
} from '../types'
import { hmacSha256, sha256Hex, timingSafeEqualStr } from '../crypto'
import { PlatformError } from '../errors'
import { readJson } from '../http'
import { shopeePushUrl } from '../env'
import {
  aggregateLines, asArr, asObj, httpError, isBatchLevel, pushFail, pushOk, qs, testFail, toInt, toIso, toNum, toStr,
  type TestResult,
} from './common'

const LABEL = 'Shopee'
export const SHOPEE_UNTESTED_LIVE = true

// ---------------------------------------------------------------------------
// ลายเซ็น (pure — ทดสอบด้วยค่าตัวอย่างใน CONTRACT §3.4) — key = partner_key แบบข้อความ UTF-8 (ห้าม hex-decode)
// ---------------------------------------------------------------------------
export function shopeeSign(partnerKey: string, base: string): string {
  return hmacSha256(partnerKey, base, 'hex')
}
export function shopeePublicBase(partnerId: string | number, path: string, timestamp: number): string {
  return `${partnerId}${path}${timestamp}`
}
export function shopeeShopBase(partnerId: string | number, path: string, timestamp: number, accessToken: string, shopId: string | number): string {
  return `${partnerId}${path}${timestamp}${accessToken}${shopId}`
}
export function shopeePushBase(callbackUrl: string, rawBody: string): string {
  return `${callbackUrl}|${rawBody}`
}
export function verifyShopeePush(partnerKey: string, callbackUrl: string, rawBody: string, authorization: string | null): boolean {
  if (!partnerKey || !authorization) return false
  return timingSafeEqualStr(shopeeSign(partnerKey, shopeePushBase(callbackUrl, rawBody)), authorization.trim().toLowerCase())
}

// ---------------------------------------------------------------------------
// สถานะ (CONTRACT §3.4)
// ---------------------------------------------------------------------------
export function mapShopeeStatus(raw: unknown): OrderStatus {
  switch (String(raw ?? '').toUpperCase()) {
    case 'UNPAID': return 'unpaid'
    case 'PENDING': return 'paid'
    case 'READY_TO_SHIP': case 'PROCESSED': case 'RETRY_SHIP': return 'ready_to_ship'
    case 'SHIPPED': case 'TO_CONFIRM_RECEIVE': return 'shipped'
    case 'COMPLETED': return 'completed'
    case 'IN_CANCEL': return 'cancel_pending'
    case 'CANCELLED': return 'cancelled'
    case 'TO_RETURN': return 'return_requested'
    default: return 'unknown'
  }
}

// ---------------------------------------------------------------------------
// เรียก API
// ---------------------------------------------------------------------------
function partner(ctx: AdapterContext): { id: string; key: string } {
  const id = ctx.creds.partner_id ?? toStr(ctx.channel.settings?.partner_id)
  const key = ctx.creds.partner_key
  if (!id || !/^[0-9]{1,20}$/.test(id) || !key) throw new PlatformError('config', 'ยังไม่ได้ใส่ Partner ID / Partner Key ของ Shopee')
  return { id, key }
}

function host(ctx: AdapterContext): string {
  return ctx.apiBase(ctx.channel.environment === 'sandbox' ? 'sandbox' : 'production')
}

function nowSec(ctx: AdapterContext): number {
  return Math.floor(ctx.now().getTime() / 1000)
}

function checkBody(res: Response, data: Record<string, unknown> | null): Record<string, unknown> {
  const d = asObj(data)
  const err = toStr(d.error)
  if (!res.ok && !err) throw httpError(LABEL, res, toStr(d.message), toStr(d.request_id))
  if (err) {
    const msg = toStr(d.message) ?? err
    const reqId = toStr(d.request_id)
    const tail = reqId ? ` (request id ${reqId.slice(0, 60)})` : ''
    if (res.status === 429 || /busy|limit/i.test(err)) throw new PlatformError('rate_limit', `Shopee ไม่ว่าง/จำกัดความถี่ (${err})${tail}`, { retryAfterSeconds: 60, platformCode: err })
    if (/auth|token|sign|partner|permission/i.test(err)) throw new PlatformError('auth', `Shopee ปฏิเสธการยืนยันตัวตน (${err})${tail}`, { platformCode: err })
    if (res.status >= 500) throw new PlatformError('server', `Shopee ขัดข้อง (${err})${tail}`, { platformCode: err })
    throw new PlatformError('validation', `Shopee ไม่รับคำขอ (${err}: ${String(msg).slice(0, 120)})${tail}`, { platformCode: err })
  }
  return d
}

async function publicCall(ctx: AdapterContext, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const p = partner(ctx)
  const ts = nowSec(ctx)
  const sign = shopeeSign(p.key, shopeePublicBase(p.id, path, ts))
  const url = `${host(ctx)}${path}?${qs({ partner_id: p.id, timestamp: ts, sign })}`
  const res = await ctx.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
  return checkBody(res, await readJson(res))
}

function shopAuth(ctx: AdapterContext): { token: string; shopId: string } {
  const token = ctx.creds.access_token
  const shopId = toStr(ctx.channel.external_shop_id)
  if (!token || !shopId) throw new PlatformError('config', 'ยังไม่ได้เชื่อมต่อร้าน Shopee (กด "เชื่อมต่อร้าน")')
  return { token, shopId }
}

async function shopCall(ctx: AdapterContext, method: 'GET' | 'POST', path: string, params: Record<string, string | number> = {}, body?: unknown,
  override?: { token: string; shopId: string }): Promise<Record<string, unknown>> {
  const p = partner(ctx)
  const auth = override ?? shopAuth(ctx)
  const ts = nowSec(ctx)
  const sign = shopeeSign(p.key, shopeeShopBase(p.id, path, ts, auth.token, auth.shopId))
  const query = qs({ ...params, partner_id: p.id, timestamp: ts, access_token: auth.token, shop_id: auth.shopId, sign })
  const res = await ctx.fetch(`${host(ctx)}${path}?${query}`, {
    method,
    headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return checkBody(res, await readJson(res))
}

function tokensFrom(ctx: AdapterContext, d: Record<string, unknown>): TokenSet {
  const access = toStr(d.access_token)
  const refresh = toStr(d.refresh_token)
  if (!access || !refresh) throw new PlatformError('auth', 'Shopee ไม่ส่งโทเคนกลับมา')
  const expireIn = toInt(d.expire_in) ?? 14400
  const now = ctx.now().getTime()
  return {
    access_token: access,
    refresh_token: refresh,
    access_expires_at: new Date(now + expireIn * 1000),
    refresh_expires_at: new Date(now + 30 * 86400 * 1000),
  }
}

function buildAuthUrl(ctx: AdapterContext, state: string, redirectUri: string): string {
  const p = partner(ctx)
  const base = ctx.channel.environment === 'sandbox' ? 'https://open.sandbox.test-stable.shopee.com/auth' : 'https://open.shopee.com/auth'
  return `${base}?${qs({ partner_id: p.id, auth_type: 'seller', redirect_uri: redirectUri, response_type: 'code', state })}`
}

async function shopInfo(ctx: AdapterContext, override?: { token: string; shopId: string }): Promise<{ name: string | null; expire: string | null; region: string | null; status: string | null }> {
  const d = await shopCall(ctx, 'GET', '/api/v2/shop/get_shop_info', {}, undefined, override)
  return { name: toStr(d.shop_name), expire: toIso(d.expire_time), region: toStr(d.region), status: toStr(d.status) }
}

async function exchangeCode(ctx: AdapterContext, query: URLSearchParams, _redirectUri: string): Promise<ConnectResult> {
  const code = toStr(query.get('code'))
  const shopId = toStr(query.get('shop_id'))
  if (!code) throw new PlatformError('validation', 'ไม่ได้รับรหัสอนุญาตจาก Shopee')
  if (!shopId || !/^[0-9]{1,20}$/.test(shopId)) {
    throw new PlatformError('unsupported', 'รองรับเฉพาะการอนุญาตแบบร้านเดียว (ไม่รองรับบัญชีหลัก main account)')
  }
  const p = partner(ctx)
  const d = await publicCall(ctx, '/api/v2/auth/token/get', { code, partner_id: Number(p.id), shop_id: Number(shopId) })
  const tokens = tokensFrom(ctx, d)
  const result: ConnectResult = { ...tokens, shop_id: shopId }
  try {
    const info = await shopInfo(ctx, { token: tokens.access_token, shopId })
    if (info.name) result.shop_name = info.name
    if (info.expire) result.auth_expires_at = new Date(info.expire)
    result.settings = { region: info.region, shop_status: info.status }
  } catch { /* ชื่อร้าน/วันหมดอายุการอนุญาตอ่านทีหลังได้ตอนทดสอบ */ }
  return result
}

async function refreshToken(ctx: AdapterContext): Promise<TokenSet> {
  const p = partner(ctx)
  const refresh = ctx.creds.refresh_token
  const shopId = toStr(ctx.channel.external_shop_id)
  if (!refresh || !shopId) throw new PlatformError('reauth', 'ไม่มีโทเคนของร้าน Shopee — กด "เชื่อมต่อร้าน" ใหม่')
  try {
    const d = await publicCall(ctx, '/api/v2/auth/access_token/get', { refresh_token: refresh, partner_id: Number(p.id), shop_id: Number(shopId) })
    return tokensFrom(ctx, d)
  } catch (e) {
    if (e instanceof PlatformError && (e.kind === 'auth' || e.kind === 'validation')) {
      throw new PlatformError('reauth', 'Shopee ไม่รับ refresh token แล้ว — กด "เชื่อมต่อร้าน" ใหม่', { platformCode: e.platformCode })
    }
    throw e
  }
}

async function testConnection(ctx: AdapterContext): Promise<TestResult> {
  try {
    partner(ctx)
    if (!ctx.creds.access_token || !ctx.channel.external_shop_id) {
      return { ok: false, message: 'บันทึกคีย์แล้ว — ขั้นต่อไปกด "เชื่อมต่อร้าน" (ต้องได้รับอนุมัติ API จาก Shopee ก่อน)', reason: 'awaiting_credentials' }
    }
    const info = await shopInfo(ctx)
    return {
      ok: true,
      message: `เชื่อมต่อร้าน Shopee${info.name ? ' "' + info.name + '"' : ''} สำเร็จ`,
      shop_id: toStr(ctx.channel.external_shop_id) ?? undefined,
      shop_name: info.name ?? undefined,
      settings: { region: info.region, shop_status: info.status, auth_expire_time: info.expire },
    }
  } catch (e) {
    return testFail(e, 'เชื่อมต่อ Shopee ไม่สำเร็จ')
  }
}

// ----- UNTESTED LIVE: ส่งสต๊อก (1 item ต่อครั้ง ≤ 50 model) -----
async function pushStock(ctx: AdapterContext, jobs: OutboxJob[]): Promise<PushResult[]> {
  const results: PushResult[] = []
  const groups = new Map<string, OutboxJob[]>()
  for (const job of jobs) {
    const list = groups.get(job.listing.external_item_id) ?? []
    list.push(job)
    groups.set(job.listing.external_item_id, list)
  }
  let batchError: unknown = null
  for (const [itemId, all] of Array.from(groups.entries())) {
    for (let i = 0; i < all.length; i += 50) {
      const list = all.slice(i, i + 50)
      if (batchError) { for (const job of list) results.push(pushFail(job, batchError)); continue }
      if (!/^[0-9]{1,20}$/.test(itemId)) { for (const job of list) results.push(pushFail(job, 'รหัสสินค้า Shopee ไม่ถูกต้อง', { permanent: true })); continue }
      const stockList = list.map(job => {
        const modelId = job.listing.external_sku_id.split(':')[1] ?? '0'
        const location = toStr(asObj(job.listing.extra).location_id)
        return { model_id: Number(modelId), seller_stock: [{ ...(location ? { location_id: location } : {}), stock: Math.max(0, Math.trunc(job.qty)) }] }
      })
      try {
        const d = await shopCall(ctx, 'POST', '/api/v2/product/update_stock', {}, { item_id: Number(itemId), stock_list: stockList })
        const resp = asObj(d.response)
        const failures = new Map<string, string>()
        for (const f of asArr(resp.failure_list)) {
          const o = asObj(f)
          failures.set(String(toInt(o.model_id) ?? ''), toStr(o.failed_reason) ?? 'ไม่ทราบสาเหตุ')
        }
        for (const job of list) {
          const modelId = String(Number(job.listing.external_sku_id.split(':')[1] ?? '0'))
          const reason = failures.get(modelId)
          results.push(reason ? pushFail(job, `Shopee ไม่รับสต๊อก: ${reason.slice(0, 160)}`, { permanent: true }) : pushOk(job, job.qty, job.qty))
        }
      } catch (e) {
        if (isBatchLevel(e)) batchError = e
        for (const job of list) results.push(pushFail(job, e))
      }
    }
  }
  return results
}

function shopeeOrder(o: Record<string, unknown>): NormalizedOrder | null {
  const ext = toStr(o.order_sn)
  if (!ext) return null
  const rawStatus = toStr(o.order_status)
  const lines: NormalizedOrderLine[] = asArr(o.item_list).map(raw => {
    const it = asObj(raw)
    const itemId = toStr(it.item_id) ?? ''
    const modelId = toStr(it.model_id) ?? '0'
    const qty = Math.max(0, toInt(it.model_quantity_purchased) ?? 0)
    const cancelled = Math.max(0, toInt(it.cancelled_qty) ?? 0)
    const returned = Math.max(0, toInt(it.returned_qty) ?? 0)
    return {
      sku_id: `${itemId}:${modelId}`,
      item_id: itemId || undefined,
      sku: toStr(it.model_sku) ?? toStr(it.item_sku),
      name: toStr(it.item_name)?.slice(0, 500) ?? null,
      qty,
      qty_cancelled: Math.min(cancelled, qty),
      qty_returned: Math.min(returned, qty),
      unit_price: toNum(it.model_discounted_price) ?? toNum(it.model_original_price),
    }
  })
  return {
    external_order_id: ext,
    status: mapShopeeStatus(rawStatus),
    raw_status: rawStatus,
    created_at: toIso(o.create_time),
    updated_at: toIso(o.update_time),
    currency: toStr(o.currency) ?? 'THB',
    total: toNum(o.total_amount),
    lines: aggregateLines(lines),
    raw: { order_sn: ext, order_status: rawStatus },
  }
}

// ----- UNTESTED LIVE: ดึงออเดอร์ (ช่วง update_time ≤ 15 วัน, cursor) -----
async function fetchOrders(ctx: AdapterContext, q: { since: Date; until: Date; cursor?: string }) {
  const from = Math.floor(q.since.getTime() / 1000)
  const to = Math.min(Math.floor(q.until.getTime() / 1000), from + 15 * 86400 - 1)
  const d = await shopCall(ctx, 'GET', '/api/v2/order/get_order_list', {
    time_range_field: 'update_time', time_from: from, time_to: to, page_size: 100,
    ...(q.cursor ? { cursor: q.cursor } : {}), response_optional_fields: 'order_status',
  })
  const resp = asObj(d.response)
  const ids = asArr(resp.order_list).map(x => toStr(asObj(x).order_sn)).filter((x): x is string => !!x)
  const orders = ids.length ? await fetchOrdersByIds(ctx, ids) : []
  const more = resp.more === true
  return { orders, next: more ? toStr(resp.next_cursor) ?? undefined : undefined }
}

async function fetchOrdersByIds(ctx: AdapterContext, ids: string[]): Promise<NormalizedOrder[]> {
  const out: NormalizedOrder[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50).filter(x => /^[0-9A-Za-z]{1,64}$/.test(x))
    if (!chunk.length) continue
    const d = await shopCall(ctx, 'GET', '/api/v2/order/get_order_detail', {
      order_sn_list: chunk.join(','),
      response_optional_fields: 'item_list,cancel_by,pay_time,order_status',
    })
    for (const raw of asArr(asObj(d.response).order_list)) {
      const o = shopeeOrder(asObj(raw))
      if (o) out.push(o)
    }
  }
  return out
}

function verifyWebhook(input: { rawBody: string; headers: Headers; url: string }, secrets: Readonly<Record<string, string>>): boolean {
  const url = shopeePushUrl()
  if (!url) return false
  return verifyShopeePush(secrets.partner_key ?? '', url, input.rawBody, input.headers.get('authorization'))
}

const PUSH_NAMES: Record<number, string> = { 1: 'shop_authorization', 2: 'shop_deauthorization', 3: 'order_status_push', 4: 'order_trackingno_push', 8: 'reserved_stock_change_push', 12: 'open_api_authorization_expiry', 29: 'return_updates_push' }

function parseWebhook(rawBody: string): InboundEventInput[] {
  const body = asObj(JSON.parse(rawBody))
  const code = toInt(body.code)
  const shopId = toStr(body.shop_id) ?? '-'
  const data = asObj(body.data)
  const ordersn = toStr(data.ordersn) ?? toStr(data.order_sn)
  let eventId: string
  if (code === 3 && ordersn) eventId = `${shopId}:3:${ordersn}:${toStr(data.status) ?? '-'}:${toStr(data.update_time) ?? '-'}`
  else eventId = `${shopId}:${code ?? '-'}:${toStr(body.timestamp) ?? '-'}:${sha256Hex(rawBody).slice(0, 16)}`
  return [{
    event_id: eventId.slice(0, 200),
    event_type: code !== null ? (PUSH_NAMES[code] ?? `code_${code}`) : null,
    external_order_id: ordersn,
    payload: { code, shop_id: body.shop_id ?? null, timestamp: body.timestamp ?? null, data },
  }]
}

async function eventToActions(_ctx: AdapterContext, ev: InboundEventJob): Promise<EventAction[]> {
  const p = asObj(ev.payload)
  const code = toInt(p.code)
  const data = asObj(p.data)
  const ordersn = toStr(data.ordersn) ?? toStr(data.order_sn)
  if (code === 3 && ordersn) {
    const status = mapShopeeStatus(data.status)
    if (status === 'cancelled') return [{ kind: 'cancel', external_order_id: ordersn, status: 'cancelled', updated_at: toIso(data.update_time) ?? undefined }]
    return [{ kind: 'fetch_orders', external_order_ids: [ordersn] }]
  }
  return [{ kind: 'ignore', note: `push code ${code ?? '-'} ไม่เกี่ยวกับสต๊อก` }]
}

const adapter: ChannelAdapter = {
  platform: 'shopee',
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
