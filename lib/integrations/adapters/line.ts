// lib/integrations/adapters/line.ts — LINE SHOPPING (MyShop Open API) — ใช้งานจริงเต็มรูปแบบในรอบนี้
// สเปก: specs/line.json + CONTRACT-INTEGRATIONS.md §3.4
//   base https://developers-oaplus.line.biz/myshop/v1, header X-API-KEY, User-Agent NEWCUTE-stock
//   ส่งสต๊อก: GET /products?ids=<productId> (อ่าน reserved + readyToShip ล่าสุด) แล้ว PATCH /products/{id}/variant
//             { id: variantId, onHandNumber: qty + reserved + readyToShip } — ห้ามใช้ increase/decrease/adjust
//   webhook: x-myshop-signature = base64(HMAC-SHA256(webhook secret, raw body)) — ไม่มี event สำหรับ EXPIRED (ต้องดึงเอง)
// ฝั่งเซิร์ฟเวอร์เท่านั้น
import type {
  AdapterContext, ChannelAdapter, EventAction, InboundEventInput, InboundEventJob, NormalizedListing, NormalizedOrder,
  NormalizedOrderLine, OrderStatus, OutboxJob, PushResult,
} from '../types'
import { hmacSha256, timingSafeEqualStr } from '../crypto'
import { PlatformError } from '../errors'
import { readJson } from '../http'
import {
  aggregateLines, asArr, asObj, httpError, isBatchLevel, pushFail, pushOk, qs, testFail, toInt, toIso, toNum, toStr,
  type TestResult,
} from './common'

const LABEL = 'LINE SHOPPING'
const USER_AGENT = 'NEWCUTE-stock'
/** onHandNumber ต้อง < 100,000 */
const MAX_ON_HAND = 99999

// ---------------------------------------------------------------------------
// ลายเซ็น webhook (pure — ทดสอบด้วยค่าตัวอย่างใน CONTRACT §3.4)
// ---------------------------------------------------------------------------
export function lineWebhookSignature(secret: string, rawBody: string): string {
  return hmacSha256(secret, rawBody, 'base64')
}

export function verifyLineSignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!secret || !header) return false
  return timingSafeEqualStr(lineWebhookSignature(secret, rawBody), header.trim())
}

// ---------------------------------------------------------------------------
// แปลงสถานะ (CONTRACT §3.4 ตารางสถานะ)
// ---------------------------------------------------------------------------
const SHIPPED_STATES = new Set(['SHIPPED_ALL', 'ON_DELIVERY'])

export function mapLineStatus(orderStatus: unknown, paymentStatus: unknown, shipmentStatus: unknown): { status: OrderStatus; was_shipped: boolean } {
  const os = String(orderStatus ?? '').toUpperCase()
  const ps = String(paymentStatus ?? '').toUpperCase()
  const ss = String(shipmentStatus ?? '').toUpperCase()
  if (os === 'CANCELED' || os === 'CANCELLED') return { status: 'cancelled', was_shipped: SHIPPED_STATES.has(ss) }
  if (os === 'EXPIRED') return { status: 'expired', was_shipped: false }
  if (os === 'COMPLETED') return { status: 'completed', was_shipped: true }
  if (os === 'FINALIZED' || os === '') {
    if (ss === 'SHIPPED_ALL') return { status: 'completed', was_shipped: true }
    if (ss === 'ON_DELIVERY') return { status: 'shipped', was_shipped: true }
    if (ss === 'SHIPMENT_READY') return { status: 'ready_to_ship', was_shipped: false }
    if (ps === 'PAID') return { status: 'paid', was_shipped: false }
    if (ps === 'NO_PAYMENT' || ps === 'PENDING') return { status: 'unpaid', was_shipped: false }
  }
  return { status: 'unknown', was_shipped: SHIPPED_STATES.has(ss) }
}

/** สถานะจากชื่อ event ของ webhook (ชื่อ event ชัดกว่าฟิลด์สถานะใน payload) */
export function mapLineEvent(eventName: unknown, p: Record<string, unknown>): { status: OrderStatus; was_shipped: boolean } {
  const name = String(eventName ?? '').toUpperCase()
  const ss = String(p.shipmentStatus ?? '').toUpperCase()
  if (name === 'ORDER.PENDING_PAYMENT') return { status: 'unpaid', was_shipped: false }
  if (name === 'ORDER.READY_TO_SHIP') return { status: 'ready_to_ship', was_shipped: false }
  if (name === 'ORDER.CANCELED' || name === 'ORDER.CANCELLED') return { status: 'cancelled', was_shipped: SHIPPED_STATES.has(ss) }
  if (name === 'ORDER.COMPLETED') return { status: 'completed', was_shipped: true }
  return mapLineStatus(p.orderStatus, p.paymentStatus, p.shipmentStatus)
}

function rawStatusOf(p: Record<string, unknown>, eventName?: unknown): string | null {
  const parts = [p.orderStatus, p.paymentStatus, p.shipmentStatus].map(v => toStr(v)).filter((v): v is string => !!v)
  if (parts.length) return parts.join('/').slice(0, 100)
  return toStr(eventName)?.slice(0, 100) ?? null
}

/** รายการสินค้าในออเดอร์ (webhook / รายละเอียดออเดอร์) → บรรทัดกลาง รวมตาม variantId */
export function lineOrderLines(items: unknown): NormalizedOrderLine[] {
  const lines: NormalizedOrderLine[] = []
  for (const raw of asArr(items)) {
    const it = asObj(raw)
    const variantId = toStr(it.variantId)
    const sku = toStr(it.sku)
    if (!variantId && !sku) continue
    const discounted = toNum(it.discountedPrice)
    const price = toNum(it.price)
    lines.push({
      sku_id: variantId ?? undefined,
      item_id: toStr(it.productId) ?? undefined,
      sku,
      name: toStr(it.name)?.slice(0, 500) ?? null,
      qty: Math.max(0, toInt(it.quantity) ?? 0),
      unit_price: discounted !== null && discounted > 0 ? discounted : price,
    })
  }
  return aggregateLines(lines)
}

/** ออเดอร์ LINE (webhook body หรือ GET /orders/{orderNo}) → NormalizedOrder */
export function lineToOrder(p: Record<string, unknown>, eventName?: unknown): NormalizedOrder | null {
  const ext = toStr(p.orderNumber)
  if (!ext) return null
  const event = asObj(p.event)
  const mapped = eventName ? mapLineEvent(eventName, p) : mapLineStatus(p.orderStatus, p.paymentStatus, p.shipmentStatus)
  return {
    external_order_id: ext,
    status: mapped.status,
    raw_status: rawStatusOf(p, eventName),
    created_at: toIso(p.checkoutAt),
    updated_at: toIso(event.timestamp) ?? toIso(p.lastUpdatedAt),
    was_shipped: mapped.was_shipped,
    currency: 'THB',
    total: toNum(p.totalPrice),
    lines: lineOrderLines(p.orderItems),
    raw: {
      orderNumber: ext,
      orderStatus: toStr(p.orderStatus),
      paymentStatus: toStr(p.paymentStatus),
      paymentMethod: toStr(p.paymentMethod),
      shipmentStatus: toStr(p.shipmentStatus),
      event: toStr(event.name) ?? toStr(eventName),
    },
  }
}

// ---------------------------------------------------------------------------
// เรียก API
// ---------------------------------------------------------------------------
function apiKey(ctx: AdapterContext): string {
  const key = ctx.creds.api_key
  if (!key) throw new PlatformError('config', 'ยังไม่ได้ใส่ API Key ของ LINE SHOPPING')
  return key
}

async function call(ctx: AdapterContext, method: string, path: string, opts: { query?: string; body?: unknown } = {}): Promise<unknown> {
  const headers: Record<string, string> = { 'X-API-KEY': apiKey(ctx), 'User-Agent': USER_AGENT, Accept: 'application/json' }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const url = ctx.apiBase('api') + path + (opts.query ? '?' + opts.query : '')
  const res = await ctx.fetch(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  const data = await readJson<Record<string, unknown>>(res)
  if (!res.ok) {
    throw httpError(LABEL, res, data ? toStr(data.message) : null, res.headers.get('x-line-oap-request-id'))
  }
  return data
}

async function testConnection(ctx: AdapterContext): Promise<TestResult> {
  if (!ctx.creds.api_key) return { ok: false, message: 'ยังไม่ได้ใส่ API Key ของ LINE SHOPPING', reason: 'awaiting_credentials' }
  try {
    await call(ctx, 'GET', '/products', { query: qs({ perPage: 1 }) })
    const note = ctx.creds.webhook_secret ? '' : ' (ยังไม่ได้ใส่ Webhook Secret — ออเดอร์จะเข้ามาทางการดึงตามรอบเท่านั้น)'
    return { ok: true, message: 'เชื่อมต่อ LINE SHOPPING สำเร็จ' + note }
  } catch (e) {
    return testFail(e, 'เชื่อมต่อ LINE SHOPPING ไม่สำเร็จ')
  }
}

function variantName(v: Record<string, unknown>): string | null {
  const opts = asArr(v.options).map(o => toStr(asObj(o).value)).filter((x): x is string => !!x)
  return opts.length ? opts.join(' / ').slice(0, 200) : null
}

/** 1 หน้า = 100 สินค้า (ทุกไซส์ของสินค้านั้น) — ดึงทั้งร้านเฉพาะเมื่อแอดมินกดเท่านั้น (LINE ห้ามดึงรายการซ้ำๆ ไม่ใส่ตัวกรอง) */
async function fetchCatalog(ctx: AdapterContext, cursor?: string): Promise<{ rows: NormalizedListing[]; next?: string }> {
  const page = cursor && /^[0-9]{1,5}$/.test(cursor) ? Number(cursor) : 1
  const data = asObj(await call(ctx, 'GET', '/products', { query: qs({ page, perPage: 100 }) }))
  const rows: NormalizedListing[] = []
  for (const rawP of asArr(data.data)) {
    const p = asObj(rawP)
    const productId = toStr(p.id)
    if (!productId) continue
    const variants = asArr(p.variants).map(asObj)
    const single = p.hasOnlyDefaultVariant === true || variants.length === 1
    for (const v of variants) {
      const variantId = toStr(v.id)
      if (!variantId) continue
      const reserved = (toInt(v.reservedNumber) ?? 0) + (toInt(v.readyToShipNumber) ?? 0)
      rows.push({
        sku_id: variantId,
        item_id: productId,
        sku: toStr(v.sku) ?? (single ? toStr(p.code) : null),
        inventory_id: toStr(v.inventoryId),
        name: toStr(p.name)?.slice(0, 500) ?? null,
        variant_name: variantName(v),
        status: p.isDisplay === false ? 'HIDDEN' : p.isDisplay === true ? 'DISPLAY' : null,
        qty: toInt(v.availableNumber),
        reserved,
        extra: { product_id: productId, variant_id: variantId },
      })
    }
  }
  const totalPage = toInt(data.totalPage) ?? 1
  return { rows, next: page < totalPage ? String(page + 1) : undefined }
}

function productIdOf(job: OutboxJob): string | null {
  return toStr(asObj(job.listing.extra).product_id) ?? toStr(job.listing.external_item_id)
}

const STALE_MAPPING = 'ไม่พบสินค้านี้บน LINE SHOPPING แล้ว — กด "ดึงรายการจากแพลตฟอร์ม" แล้วตรวจการจับคู่ใหม่'

async function pushStock(ctx: AdapterContext, jobs: OutboxJob[]): Promise<PushResult[]> {
  const results: PushResult[] = []
  const groups = new Map<string, OutboxJob[]>()
  for (const job of jobs) {
    const pid = productIdOf(job)
    if (!pid || !/^[0-9A-Za-z_-]{1,64}$/.test(pid)) {
      results.push(pushFail(job, STALE_MAPPING, { permanent: true }))
      continue
    }
    const list = groups.get(pid) ?? []
    list.push(job)
    groups.set(pid, list)
  }

  let batchError: unknown = null
  for (const [pid, list] of Array.from(groups.entries())) {
    if (batchError) { for (const job of list) results.push(pushFail(job, batchError)); continue }
    // อ่านจำนวนจองล่าสุดก่อนตั้งค่า (onHand รวมของที่ลูกค้าจอง/รอส่งอยู่แล้ว)
    let product: Record<string, unknown> | null = null
    try {
      const data = asObj(await call(ctx, 'GET', '/products', { query: qs({ ids: pid }) }))
      product = asArr(data.data).map(asObj).find(p => toStr(p.id) === pid) ?? null
    } catch (e) {
      if (isBatchLevel(e)) { batchError = e; for (const job of list) results.push(pushFail(job, e)); continue }
      for (const job of list) results.push(pushFail(job, e, { permanent: true, message: STALE_MAPPING }))
      continue
    }
    if (!product) {
      for (const job of list) results.push(pushFail(job, STALE_MAPPING, { permanent: true }))
      continue
    }
    const variants = asArr(product.variants).map(asObj)
    for (const job of list) {
      if (batchError) { results.push(pushFail(job, batchError)); continue }
      const v = variants.find(x => toStr(x.id) === job.listing.external_sku_id)
      if (!v) { results.push(pushFail(job, STALE_MAPPING, { permanent: true })); continue }
      const reserved = Math.max(0, toInt(v.reservedNumber) ?? 0)
      const readyToShip = Math.max(0, toInt(v.readyToShipNumber) ?? 0)
      const want = Math.max(0, Math.trunc(job.qty))
      const onHand = Math.min(MAX_ON_HAND, want + reserved + readyToShip)
      const available = Math.max(0, onHand - reserved - readyToShip)
      const idNum = Number(job.listing.external_sku_id)
      try {
        await call(ctx, 'PATCH', `/products/${encodeURIComponent(pid)}/variant`, {
          body: { id: Number.isSafeInteger(idNum) ? idNum : job.listing.external_sku_id, onHandNumber: onHand },
        })
        results.push(pushOk(job, available, available))
      } catch (e) {
        if (isBatchLevel(e)) batchError = e
        const notFound = e instanceof PlatformError && e.kind === 'not_found'
        results.push(pushFail(job, e, notFound ? { permanent: true, message: STALE_MAPPING } : {}))
      }
    }
  }
  return results
}

/**
 * ดึงออเดอร์ที่อัปเดตในช่วงเวลา (UTC, ช่วงไม่ทับกัน: startAt = endAt ของรอบก่อน) — รายการไม่มีสินค้า
 * worker จะเรียก fetchOrdersByIds เฉพาะออเดอร์ที่ยังไม่มีในระบบ/สถานะเปลี่ยน; ยกเลิก/หมดอายุ → cancels
 */
async function fetchOrders(ctx: AdapterContext, q: { since: Date; until: Date; cursor?: string }) {
  const page = q.cursor && /^[0-9]{1,5}$/.test(q.cursor) ? Number(q.cursor) : 1
  const data = asObj(await call(ctx, 'GET', '/orders', {
    query: qs({
      startAt: q.since.toISOString(), endAt: q.until.toISOString(), perPage: 100, page, sortBy: 'UPDATED_AT', orderBy: 'ASC',
    }),
  }))
  const orders: NormalizedOrder[] = []
  const cancels: Extract<EventAction, { kind: 'cancel' }>[] = []
  for (const raw of asArr(data.data)) {
    const o = asObj(raw)
    const ext = toStr(o.orderNumber)
    if (!ext) continue
    const mapped = mapLineStatus(o.orderStatus, o.paymentStatus, o.shipmentStatus)
    const updated = toIso(o.lastUpdatedAt) ?? undefined
    if (mapped.status === 'cancelled' || mapped.status === 'expired') {
      cancels.push({ kind: 'cancel', external_order_id: ext, status: mapped.status, was_shipped: mapped.was_shipped, updated_at: updated })
      continue
    }
    orders.push({
      external_order_id: ext,
      status: mapped.status,
      raw_status: rawStatusOf(o),
      created_at: toIso(o.checkoutAt),
      updated_at: updated ?? null,
      was_shipped: mapped.was_shipped,
      currency: 'THB',
      total: toNum(o.totalPrice),
      lines: [],
    })
  }
  const totalPage = toInt(data.totalPage) ?? 1
  return { orders, cancels, next: page < totalPage ? String(page + 1) : undefined }
}

async function fetchOrdersByIds(ctx: AdapterContext, ids: string[]): Promise<NormalizedOrder[]> {
  const out: NormalizedOrder[] = []
  for (const id of ids) {
    if (!/^[0-9A-Za-z_-]{1,64}$/.test(id)) continue
    try {
      const p = asObj(await call(ctx, 'GET', `/orders/${encodeURIComponent(id)}`))
      const o = lineToOrder(p)
      if (o) out.push(o)
    } catch (e) {
      // 404 = ไม่มีออเดอร์นี้ (ห้ามยิงซ้ำ — LINE นับเป็นพฤติกรรมต้องห้าม) / อย่างอื่นโยนให้ worker ลองใหม่
      if (e instanceof PlatformError && e.kind === 'not_found') continue
      throw e
    }
  }
  return out
}

function verifyWebhook(input: { rawBody: string; headers: Headers; url: string }, secrets: Readonly<Record<string, string>>): boolean {
  const secret = secrets.webhook_secret
  if (!secret) return false
  return verifyLineSignature(secret, input.rawBody, input.headers.get('x-myshop-signature'))
}

/** เก็บเฉพาะฟิลด์ที่ใช้ตัดสต๊อก (ไม่มีที่อยู่/ชื่อ/เบอร์ของผู้ซื้อ) */
function projectPayload(body: Record<string, unknown>): Record<string, unknown> {
  const event = asObj(body.event)
  return {
    event: { name: toStr(event.name), timestamp: event.timestamp ?? null },
    orderNumber: toStr(body.orderNumber),
    orderStatus: toStr(body.orderStatus),
    paymentStatus: toStr(body.paymentStatus),
    paymentMethod: toStr(body.paymentMethod),
    shipmentStatus: toStr(body.shipmentStatus),
    checkoutAt: body.checkoutAt ?? null,
    lastUpdatedAt: body.lastUpdatedAt ?? null,
    totalPrice: body.totalPrice ?? null,
    orderItems: asArr(body.orderItems).slice(0, 500).map(raw => {
      const it = asObj(raw)
      return {
        productId: it.productId ?? null, variantId: it.variantId ?? null, sku: toStr(it.sku), name: toStr(it.name)?.slice(0, 300) ?? null,
        price: it.price ?? null, discountedPrice: it.discountedPrice ?? null, quantity: it.quantity ?? null,
      }
    }),
  }
}

function parseWebhook(rawBody: string, headers: Headers): InboundEventInput[] {
  const body = asObj(JSON.parse(rawBody))
  const event = asObj(body.event)
  const orderNumber = toStr(body.orderNumber)
  const name = toStr(event.name)
  const ts = event.timestamp === undefined || event.timestamp === null ? '' : String(event.timestamp)
  const reqId = toStr(headers.get('x-request-id'))
  const eventId = (reqId ?? `${orderNumber ?? '-'}:${name ?? '-'}:${ts}`).slice(0, 200)
  return [{ event_id: eventId, event_type: name, external_order_id: orderNumber, payload: projectPayload(body) }]
}

async function eventToActions(_ctx: AdapterContext, ev: InboundEventJob): Promise<EventAction[]> {
  const p = asObj(ev.payload)
  const event = asObj(p.event)
  const name = String(event.name ?? ev.event_type ?? '').toUpperCase()
  if (name.startsWith('ORDER_DETAIL.')) return [{ kind: 'ignore', note: 'แก้ที่อยู่จัดส่ง — ไม่เกี่ยวกับสต๊อก' }]
  const order = lineToOrder(p, name || undefined)
  if (!order) return [{ kind: 'ignore', note: 'ไม่มีเลขออเดอร์' }]
  if (order.lines.length > 0) return [{ kind: 'order', order }]
  if (order.status === 'cancelled' || order.status === 'expired') {
    return [{ kind: 'cancel', external_order_id: order.external_order_id, status: order.status, was_shipped: order.was_shipped, updated_at: order.updated_at ?? undefined }]
  }
  return [{ kind: 'fetch_orders', external_order_ids: [order.external_order_id] }]
}

const adapter: ChannelAdapter = {
  platform: 'line',
  testConnection,
  fetchCatalog,
  pushStock,
  fetchOrders,
  fetchOrdersByIds,
  verifyWebhook,
  parseWebhook,
  eventToActions,
}

export default adapter
