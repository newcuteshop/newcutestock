// lib/integrations/adapters/lazada.ts — Lazada Open Platform (LazOP, แอป Seller In-house APP) ประเทศไทย
// รอบนี้: phase 'auth_only' — เชื่อมร้าน (OAuth) / ต่ออายุ token / ลายเซ็น / ทดสอบร้าน ใช้งานได้
//   ส่งสต๊อก (sellable/update) + ดึงออเดอร์ เขียนตามสเปกแต่ "ยังไม่เคยทดสอบกับร้านจริง" (UNTESTED LIVE) และถูกกันไว้ที่ worker
//   ข้อที่ยังไม่ยืนยัน: 1 บรรทัดออเดอร์ = 1 ชิ้น (นับแถวต่อ SkuId), webhook ต้องใช้ใบรับรอง OV/EV (Vercel เป็น DV)
// สเปก: specs/lazada.json + CONTRACT-INTEGRATIONS.md §3.4
// ฝั่งเซิร์ฟเวอร์เท่านั้น
import type {
  AdapterContext, ChannelAdapter, ConnectResult, EventAction, InboundEventInput, InboundEventJob, NormalizedOrder,
  NormalizedOrderLine, OrderStatus, OutboxJob, PushResult, TokenSet,
} from '../types'
import { hmacSha256, sha256Hex, timingSafeEqualStr } from '../crypto'
import { PlatformError } from '../errors'
import { readJson } from '../http'
import {
  aggregateLines, asArr, asObj, httpError, isBatchLevel, pushFail, pushOk, testFail, toInt, toIso, toNum, toStr,
  type TestResult,
} from './common'

const LABEL = 'Lazada'
export const LAZADA_UNTESTED_LIVE = true

// ---------------------------------------------------------------------------
// ลายเซ็น (pure — ค่าทดสอบทางการ: secret 'helloworld' → 4190D323…FAB4A)
//   พารามิเตอร์ทั้งหมด (ยกเว้น sign และค่าว่าง) เรียงตามชื่อ (byte order) ต่อ key+value, นำหน้าด้วย apiPath (ไม่มี /rest)
//   HMAC-SHA256(app_secret) เป็น hex ตัวใหญ่
// ---------------------------------------------------------------------------
export function lazadaSign(secret: string, apiPath: string, params: Record<string, string | number | null | undefined>): string {
  const keys = Object.keys(params)
    .filter(k => k !== 'sign' && params[k] !== null && params[k] !== undefined && String(params[k]) !== '')
    .sort((a, b) => (Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))))
  const base = apiPath + keys.map(k => k + String(params[k])).join('')
  return hmacSha256(secret, base, 'hex').toUpperCase()
}

/** webhook: Authorization = hex(HMAC-SHA256(app_secret, app_key + raw body)) — เทียบไม่สนตัวพิมพ์ */
export function lazadaWebhookSignature(appKey: string, appSecret: string, rawBody: string): string {
  return hmacSha256(appSecret, appKey + rawBody, 'hex')
}
export function verifyLazadaPush(appKey: string, appSecret: string, rawBody: string, authorization: string | null): boolean {
  if (!appKey || !appSecret || !authorization) return false
  return timingSafeEqualStr(lazadaWebhookSignature(appKey, appSecret, rawBody), authorization.trim().toLowerCase())
}

// ---------------------------------------------------------------------------
// สถานะ (CONTRACT §3.4)
// ---------------------------------------------------------------------------
export function mapLazadaStatus(raw: unknown): OrderStatus {
  switch (String(raw ?? '').toLowerCase()) {
    case 'unpaid': return 'unpaid'
    case 'pending': return 'paid'
    case 'packed': case 'repacked': case 'ready_to_ship': case 'topack': case 'toship': case 'ready_to_ship_pending': return 'ready_to_ship'
    case 'shipped': case 'shipping': return 'shipped'
    case 'delivered': case 'confirmed': return 'completed'
    case 'is_cancel_pending': case 'cancel_pending': return 'cancel_pending'
    case 'canceled': case 'cancelled': case 'failed': return 'cancelled'
    case 'returned': return 'returned'
    default: return 'unknown'
  }
}

// ---------------------------------------------------------------------------
// เรียก API
// ---------------------------------------------------------------------------
function app(ctx: AdapterContext): { key: string; secret: string } {
  const key = ctx.creds.app_key ?? toStr(ctx.channel.settings?.app_key)
  const secret = ctx.creds.app_secret
  if (!key || !/^[0-9]{3,20}$/.test(key) || !secret) throw new PlatformError('config', 'ยังไม่ได้ใส่ App Key / App Secret ของ Lazada')
  return { key, secret }
}

export async function lazadaCall(ctx: AdapterContext, hostKey: 'api' | 'auth', apiPath: string, business: Record<string, string>,
  opts: { method?: 'GET' | 'POST'; withToken?: boolean } = {}): Promise<Record<string, unknown>> {
  const a = app(ctx)
  const params: Record<string, string> = {
    ...business,
    app_key: a.key,
    timestamp: String(ctx.now().getTime()),
    sign_method: 'sha256',
  }
  if (opts.withToken ?? hostKey === 'api') {
    const token = ctx.creds.access_token
    if (!token) throw new PlatformError('config', 'ยังไม่ได้เชื่อมต่อร้าน Lazada (กด "เชื่อมต่อร้าน")')
    params.access_token = token
  }
  params.sign = lazadaSign(a.secret, apiPath, params)
  const method = opts.method ?? 'GET'
  const base = ctx.apiBase(hostKey) + apiPath
  const form = new URLSearchParams(params).toString()
  const res = method === 'GET'
    ? await ctx.fetch(`${base}?${form}`, { method, headers: { Accept: 'application/json' } })
    : await ctx.fetch(base, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: form })
  const d = asObj(await readJson(res))
  const code = toStr(d.code)
  if (!res.ok && (code === null || code === '0')) throw httpError(LABEL, res, toStr(d.message), toStr(d.request_id))
  if (code !== null && code !== '0') {
    const msg = toStr(d.message) ?? code
    const tail = toStr(d.request_id) ? ` (request id ${String(d.request_id).slice(0, 60)})` : ''
    if (code === 'IllegalRefreshToken' || code === 'InvalidCode' || code === 'IllegalAccessToken' || code === 'AUTH_TYPE_UNSUPPORTED') {
      throw new PlatformError(code === 'IllegalAccessToken' ? 'auth' : 'reauth', `Lazada ปฏิเสธการอนุญาต (${code}) — กด "เชื่อมต่อร้าน" ใหม่${tail}`, { platformCode: code })
    }
    if (/ApiCallLimit|AppApiCallLimit|SellerCallLimit|E901|E1002/i.test(code)) {
      throw new PlatformError('rate_limit', `Lazada จำกัดความถี่ (${code})${tail}`, { retryAfterSeconds: /AppApiCallLimit/i.test(code) ? 3600 : 60, platformCode: code })
    }
    if (/ServiceTimeout|ISP|SYSTEM/i.test(code) || toStr(d.type) === 'ISP' || toStr(d.type) === 'SYSTEM') {
      throw new PlatformError('server', `Lazada ขัดข้องชั่วคราว (${code})${tail}`, { platformCode: code })
    }
    if (/IncompleteSignature|InvalidApiPath|IllegalAppKey|InvalidAppKey/i.test(code)) {
      throw new PlatformError('auth', `Lazada ไม่รับคีย์/ลายเซ็น (${code})${tail}`, { platformCode: code })
    }
    throw new PlatformError('validation', `Lazada ไม่รับคำขอ (${code}: ${String(msg).slice(0, 120)})${tail}`, { platformCode: code })
  }
  return d
}

function buildAuthUrl(ctx: AdapterContext, state: string, redirectUri: string): string {
  const a = app(ctx)
  const q = new URLSearchParams({ response_type: 'code', force_auth: 'true', redirect_uri: redirectUri, client_id: a.key, state })
  return `https://auth.lazada.com/oauth/authorize?${q.toString()}`
}

function tokensFrom(ctx: AdapterContext, d: Record<string, unknown>): TokenSet {
  const access = toStr(d.access_token)
  const refresh = toStr(d.refresh_token)
  if (!access || !refresh) throw new PlatformError('auth', 'Lazada ไม่ส่งโทเคนกลับมา')
  const now = ctx.now().getTime()
  const expiresIn = toInt(d.expires_in)
  const refreshIn = toInt(d.refresh_expires_in)
  const refreshAt = refreshIn !== null ? new Date(now + refreshIn * 1000) : null
  return {
    access_token: access,
    refresh_token: refresh,
    access_expires_at: expiresIn !== null ? new Date(now + expiresIn * 1000) : null,
    refresh_expires_at: refreshAt,
    // refresh token ของ Lazada ต่ออายุไม่ได้ — หมดเมื่อไรต้องให้ร้านกดเชื่อมต่อใหม่
    auth_expires_at: refreshAt,
  }
}

async function sellerInfo(ctx: AdapterContext): Promise<{ id: string | null; name: string | null; shortCode: string | null }> {
  const d = await lazadaCall(ctx, 'api', '/seller/get', {})
  const s = asObj(d.data)
  return { id: toStr(s.seller_id), name: toStr(s.name), shortCode: toStr(s.short_code) }
}

async function exchangeCode(ctx: AdapterContext, query: URLSearchParams): Promise<ConnectResult> {
  const code = toStr(query.get('code'))
  if (!code) throw new PlatformError('validation', 'ไม่ได้รับรหัสอนุญาตจาก Lazada')
  const d = await lazadaCall(ctx, 'auth', '/auth/token/create', { code }, { withToken: false })
  const tokens = tokensFrom(ctx, d)
  const info = asObj(asArr(d.country_user_info)[0] ?? asArr(d.country_user_info_list)[0])
  const result: ConnectResult = {
    ...tokens,
    shop_id: toStr(info.seller_id) ?? undefined,
    settings: { seller_id: toStr(info.seller_id), short_code: toStr(info.short_code), country: toStr(d.country) ?? toStr(info.country) },
  }
  try {
    const seller = await sellerInfo({ ...ctx, creds: { ...ctx.creds, access_token: tokens.access_token } })
    if (seller.name) result.shop_name = seller.name
    if (seller.id) result.shop_id = seller.id
    result.settings = { ...result.settings, seller_id: seller.id ?? result.shop_id ?? null, short_code: seller.shortCode ?? (result.settings?.short_code ?? null) }
  } catch { /* อ่านชื่อร้านทีหลังได้ */ }
  return result
}

async function refreshToken(ctx: AdapterContext): Promise<TokenSet> {
  const refresh = ctx.creds.refresh_token
  if (!refresh) throw new PlatformError('reauth', 'ไม่มีโทเคนของร้าน Lazada — กด "เชื่อมต่อร้าน" ใหม่')
  const d = await lazadaCall(ctx, 'auth', '/auth/token/refresh', { refresh_token: refresh }, { withToken: false })
  return tokensFrom(ctx, d)
}

async function testConnection(ctx: AdapterContext): Promise<TestResult> {
  try {
    app(ctx)
    if (!ctx.creds.access_token) {
      return { ok: false, message: 'บันทึกคีย์แล้ว — ขั้นต่อไปกด "เชื่อมต่อร้าน"', reason: 'awaiting_credentials' }
    }
    const s = await sellerInfo(ctx)
    return {
      ok: true,
      message: `เชื่อมต่อร้าน Lazada${s.name ? ' "' + s.name + '"' : ''} สำเร็จ`,
      shop_id: s.id ?? undefined,
      shop_name: s.name ?? undefined,
      settings: { seller_id: s.id, short_code: s.shortCode },
    }
  } catch (e) {
    return testFail(e, 'เชื่อมต่อ Lazada ไม่สำเร็จ')
  }
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// ----- UNTESTED LIVE: ส่งสต๊อก /product/stock/sellable/update (≤ 20 SKU ต่อครั้ง ทีละคำขอ) -----
async function pushStock(ctx: AdapterContext, jobs: OutboxJob[]): Promise<PushResult[]> {
  const results: PushResult[] = []
  let batchError: unknown = null
  for (let i = 0; i < jobs.length; i += 20) {
    const list = jobs.slice(i, i + 20)
    if (batchError) { for (const job of list) results.push(pushFail(job, batchError)); continue }
    const skus = list.map(job =>
      `<Sku><ItemId>${xmlEscape(job.listing.external_item_id)}</ItemId><SkuId>${xmlEscape(job.listing.external_sku_id)}</SkuId>` +
      (job.listing.external_sku ? `<SellerSku>${xmlEscape(job.listing.external_sku)}</SellerSku>` : '') +
      `<SellableQuantity>${Math.max(0, Math.trunc(job.qty))}</SellableQuantity></Sku>`).join('')
    const payload = `<Request><Product><Skus>${skus}</Skus></Product></Request>`
    try {
      const d = await lazadaCall(ctx, 'api', '/product/stock/sellable/update', { payload }, { method: 'POST' })
      const failed = new Map<string, string>()
      for (const det of asArr(d.detail)) {
        const o = asObj(det)
        const id = toStr(o.seller_sku) ?? toStr(o.sku_id) ?? toStr(o.field)
        if (id) failed.set(id, toStr(o.message) ?? 'ไม่ทราบสาเหตุ')
      }
      for (const job of list) {
        const reason = failed.get(job.listing.external_sku_id) ?? (job.listing.external_sku ? failed.get(job.listing.external_sku) : undefined)
        results.push(reason ? pushFail(job, `Lazada ไม่รับสต๊อก: ${reason.slice(0, 160)}`, { permanent: true }) : pushOk(job, job.qty, job.qty))
      }
    } catch (e) {
      if (isBatchLevel(e)) batchError = e
      for (const job of list) results.push(pushFail(job, e))
    }
  }
  return results
}

/** บรรทัดออเดอร์ Lazada (1 แถว = 1 ชิ้น — รวมตาม sku_id) */
export function lazadaLines(items: unknown[]): NormalizedOrderLine[] {
  return aggregateLines(items.map(raw => {
    const it = asObj(raw)
    const st = String(it.status ?? '').toLowerCase()
    const cancelled = st === 'canceled' || st === 'cancelled' || st === 'failed'
    const returned = st === 'returned'
    return {
      sku_id: toStr(it.sku_id) ?? undefined,
      item_id: toStr(it.product_id) ?? undefined,
      sku: toStr(it.sku),
      name: toStr(it.name)?.slice(0, 500) ?? null,
      qty: 1,
      qty_cancelled: cancelled ? 1 : 0,
      qty_returned: returned ? 1 : 0,
      unit_price: toNum(it.paid_price) ?? toNum(it.item_price),
    }
  }))
}

function orderStatusOf(o: Record<string, unknown>): { status: OrderStatus; raw: string | null } {
  const statuses = asArr(o.statuses).map(s => toStr(s)).filter((s): s is string => !!s)
  const mapped = statuses.map(mapLazadaStatus)
  if (mapped.length === 0) return { status: 'unknown', raw: null }
  // หลายสถานะในออเดอร์เดียว (ยกเลิกบางชิ้น): ใช้สถานะที่ยังไม่ยกเลิกก่อน
  const live = mapped.filter(s => s !== 'cancelled')
  return { status: live[0] ?? mapped[0], raw: statuses.join(',').slice(0, 100) }
}

// ----- UNTESTED LIVE: ดึงออเดอร์ /orders/get (update_after + sort updated_at ASC) แล้ว /orders/items/get -----
async function fetchOrders(ctx: AdapterContext, q: { since: Date; until: Date; cursor?: string }) {
  const offset = q.cursor && /^[0-9]{1,6}$/.test(q.cursor) ? Number(q.cursor) : 0
  const d = await lazadaCall(ctx, 'api', '/orders/get', {
    update_after: q.since.toISOString().replace(/\.\d{3}Z$/, '+00:00'),
    update_before: q.until.toISOString().replace(/\.\d{3}Z$/, '+00:00'),
    sort_by: 'updated_at', sort_direction: 'ASC', limit: '100', offset: String(offset),
  })
  const data = asObj(d.data)
  const list = asArr(data.orders).map(asObj)
  const orders = await ordersWithItems(ctx, list)
  const total = toInt(data.countTotal) ?? toInt(data.count) ?? 0
  const next = offset + list.length < total && list.length > 0 ? String(offset + list.length) : undefined
  return { orders, next }
}

async function ordersWithItems(ctx: AdapterContext, list: Record<string, unknown>[]): Promise<NormalizedOrder[]> {
  const out: NormalizedOrder[] = []
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50)
    const ids = chunk.map(o => toStr(o.order_id)).filter((x): x is string => !!x && /^[0-9]{1,30}$/.test(x))
    if (!ids.length) continue
    const d = await lazadaCall(ctx, 'api', '/orders/items/get', { order_ids: `[${ids.join(',')}]` })
    const items = new Map<string, unknown[]>()
    for (const raw of asArr(d.data)) {
      const o = asObj(raw)
      const id = toStr(o.order_id)
      if (id) items.set(id, asArr(o.order_items))
    }
    for (const o of chunk) {
      const id = toStr(o.order_id)
      if (!id) continue
      const st = orderStatusOf(o)
      out.push({
        external_order_id: id,
        status: st.status,
        raw_status: st.raw,
        created_at: toIso(o.created_at),
        updated_at: toIso(o.updated_at),
        currency: 'THB',
        total: toNum(o.price),
        lines: lazadaLines(items.get(id) ?? []),
        raw: { order_id: id, statuses: st.raw },
      })
    }
  }
  return out
}

async function fetchOrdersByIds(ctx: AdapterContext, ids: string[]): Promise<NormalizedOrder[]> {
  const list: Record<string, unknown>[] = []
  for (const id of ids) {
    if (!/^[0-9]{1,30}$/.test(id)) continue
    try {
      const d = await lazadaCall(ctx, 'api', '/order/get', { order_id: id })
      list.push(asObj(d.data))
    } catch (e) {
      if (e instanceof PlatformError && (e.kind === 'not_found' || e.kind === 'validation')) continue
      throw e
    }
  }
  return ordersWithItems(ctx, list)
}

function verifyWebhook(input: { rawBody: string; headers: Headers; url: string }, secrets: Readonly<Record<string, string>>): boolean {
  return verifyLazadaPush(secrets.app_key ?? '', secrets.app_secret ?? '', input.rawBody, input.headers.get('authorization'))
}

function parseWebhook(rawBody: string): InboundEventInput[] {
  const body = asObj(JSON.parse(rawBody))
  const data = asObj(body.data)
  const type = toInt(body.message_type)
  const orderId = toStr(data.trade_order_id)
  const line = toStr(data.trade_order_line_id)
  const status = toStr(data.order_status)
  const eventId = type === 0 && orderId
    ? `${orderId}:${line ?? '-'}:${status ?? '-'}:${toStr(data.status_update_time) ?? '-'}`
    : `${type ?? '-'}:${toStr(body.timestamp) ?? '-'}:${sha256Hex(rawBody).slice(0, 16)}`
  return [{
    event_id: eventId.slice(0, 200),
    event_type: type === 0 ? 'trade_order' : type !== null ? `message_${type}` : null,
    external_order_id: orderId,
    payload: { seller_id: body.seller_id ?? null, message_type: type, site: body.site ?? null, timestamp: body.timestamp ?? null, data },
  }]
}

async function eventToActions(_ctx: AdapterContext, ev: InboundEventJob): Promise<EventAction[]> {
  const p = asObj(ev.payload)
  const data = asObj(p.data)
  const orderId = toStr(data.trade_order_id)
  if (toInt(p.message_type) === 0 && orderId) return [{ kind: 'fetch_orders', external_order_ids: [orderId] }]
  return [{ kind: 'ignore', note: `ข้อความ Lazada ประเภท ${toStr(p.message_type) ?? '-'} ไม่เกี่ยวกับสต๊อก` }]
}

const adapter: ChannelAdapter = {
  platform: 'lazada',
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
