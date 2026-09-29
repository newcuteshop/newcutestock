// lib/integrations/adapters/meta.ts — Facebook / Instagram (Meta Commerce catalog, Graph API) — ส่งสต๊อกเท่านั้น
// สเปก: specs/meta.json + CONTRACT-INTEGRATIONS.md §3.4
//   token = system_user_token (ส่งใน Authorization: Bearer), appsecret_proof = hex HMAC-SHA256(app_secret, token) เมื่อใส่ app_secret
//   ส่งสต๊อก: POST /{catalog_id}/items_batch (item_type=PRODUCT_ITEM, allow_upsert=false, requests=[{method:'UPDATE', data:{...}}])
//   แล้วตรวจผล GET /{catalog_id}/check_batch_request_status (สูงสุด 3 ครั้ง ห่าง 2 วินาที) — ไม่มี webhook/ออเดอร์ในไทย
// ฝั่งเซิร์ฟเวอร์เท่านั้น
import type { AdapterContext, ChannelAdapter, NormalizedListing, OutboxJob, PushResult } from '../types'
import { hmacSha256 } from '../crypto'
import { PlatformError } from '../errors'
import { readJson, retryAfterSeconds, sleep } from '../http'
import { redactText } from '../redact'
import { asArr, asObj, pushFail, pushOk, testFail, toInt, toStr, type TestResult } from './common'

const LABEL = 'Meta'

/** ข้อมูลสินค้าที่ worker แนบมากับงาน (ราคา + รูป) — ไม่มี = ส่งเฉพาะสต๊อก */
export interface MetaProductInfo { price: number | null; image_urls: string[] }
export type MetaPushJob = OutboxJob & { meta_product?: MetaProductInfo }

/** จังหวะตรวจผล batch (ทดสอบแก้ให้เร็วขึ้นได้) */
export const metaTiming = { pollMs: 2000, polls: 3 }

/** เพดานคำขอต่อ items_batch (Meta รับ ≤ 5000 แนะนำ ≤ 3000) */
export const META_BATCH_MAX = 3000

// ---------------------------------------------------------------------------
// appsecret_proof (pure — ทดสอบด้วยค่าตัวอย่างใน CONTRACT §3.4)
// ---------------------------------------------------------------------------
export function metaAppSecretProof(appSecret: string, accessToken: string): string {
  return hmacSha256(appSecret, accessToken, 'hex')
}

function token(ctx: AdapterContext): string {
  const t = ctx.creds.system_user_token
  if (!t) throw new PlatformError('config', 'ยังไม่ได้ใส่ System User Token ของ Meta')
  return t
}

function catalogId(ctx: AdapterContext): string {
  const id = ctx.creds.catalog_id ?? toStr(ctx.channel.settings?.catalog_id)
  if (!id) throw new PlatformError('config', 'ยังไม่ได้ใส่ Catalog ID')
  if (!/^[0-9]{5,30}$/.test(id)) throw new PlatformError('config', 'Catalog ID ต้องเป็นตัวเลข')
  return id
}

function graphUrl(ctx: AdapterContext, path: string, params: Record<string, string> = {}): string {
  const u = new URL(ctx.apiBase('graph') + path)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  const secret = ctx.creds.app_secret
  if (secret) u.searchParams.set('appsecret_proof', metaAppSecretProof(secret, token(ctx)))
  return u.toString()
}

const THROTTLE_CODES = new Set([4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80009, 80014])

/** แปลง error ของ Graph API เป็น PlatformError (ข้อความไทย + ข้อความสั้นของ Meta ที่ไม่มีความลับ) */
export function metaError(res: Response, body: unknown): PlatformError {
  const err = asObj(asObj(body).error)
  const code = toInt(err.code)
  const sub = toInt(err.error_subcode)
  const msg = toStr(err.message)
  const short = msg ? ': ' + redactText(msg).replace(/\s+/g, ' ').slice(0, 160) : ''
  const trace = toStr(err.fbtrace_id) ? ` (fbtrace ${String(err.fbtrace_id).slice(0, 40)})` : ''
  if (code === 190) return new PlatformError('auth', `Token ของ Meta ไม่ถูกต้องหรือหมดอายุ${trace}`, { status: res.status, platformCode: '190' })
  if (code !== null && THROTTLE_CODES.has(code)) {
    return new PlatformError('rate_limit', `Meta จำกัดความถี่การเรียก (code ${code}) — ระบบจะลองใหม่เอง`,
      { status: res.status, retryAfterSeconds: Math.max(60, retryAfterSeconds(res) ?? 60), platformCode: String(code) })
  }
  if (code === 10 || (code !== null && code >= 200 && code < 300)) {
    return new PlatformError('auth', `Token ไม่มีสิทธิ์จัดการ Catalog นี้ (code ${code})${trace}`, { status: res.status, platformCode: String(code) })
  }
  if (code === 100 && sub === 33) return new PlatformError('not_found', `ไม่พบ Catalog นี้ หรือ Token ไม่มีสิทธิ์เข้าถึง${trace}`, { status: res.status, platformCode: '100' })
  if (res.status === 401 || res.status === 403) return new PlatformError('auth', `Meta ปฏิเสธ Token (HTTP ${res.status})${trace}`, { status: res.status })
  if (res.status >= 500 || code === 1 || code === 2) return new PlatformError('server', `Meta ขัดข้องชั่วคราว${trace}`, { status: res.status })
  return new PlatformError('validation', `Meta ไม่รับคำขอ${code !== null ? ' (code ' + code + ')' : ''}${short}${trace}`, { status: res.status, platformCode: code === null ? undefined : String(code) })
}

async function graph(ctx: AdapterContext, method: 'GET' | 'POST', path: string, params: Record<string, string> = {}, form?: Record<string, string>): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token(ctx)}`, Accept: 'application/json' }
  let body: string | undefined
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    body = new URLSearchParams(form).toString()
  }
  const res = await ctx.fetch(graphUrl(ctx, path, params), { method, headers, body, timeoutMs: form ? 20000 : 10000 })
  const data = await readJson<Record<string, unknown>>(res)
  if (!res.ok || (data && data.error)) throw metaError(res, data)
  return asObj(data)
}

async function testConnection(ctx: AdapterContext): Promise<TestResult> {
  try {
    const id = catalogId(ctx)
    const data = await graph(ctx, 'GET', `/${id}`, { fields: 'id,name,product_count' })
    const name = toStr(data.name)
    const count = toInt(data.product_count)
    return {
      ok: true,
      message: `เชื่อมต่อ Catalog${name ? ' "' + name + '"' : ''} สำเร็จ${count !== null ? ` (สินค้า ${count} รายการ)` : ''}`,
      shop_id: id,
      shop_name: name ?? undefined,
    }
  } catch (e) {
    return testFail(e, 'เชื่อมต่อ Meta ไม่สำเร็จ')
  }
}

async function fetchCatalog(ctx: AdapterContext, cursor?: string): Promise<{ rows: NormalizedListing[]; next?: string }> {
  const id = catalogId(ctx)
  const params: Record<string, string> = { fields: 'id,retailer_id,name,availability,quantity_to_sell_on_facebook', limit: '500' }
  if (cursor) params.after = cursor
  const data = await graph(ctx, 'GET', `/${id}/products`, params)
  const rows: NormalizedListing[] = []
  for (const raw of asArr(data.data)) {
    const p = asObj(raw)
    const retailer = toStr(p.retailer_id)
    if (!retailer) continue
    rows.push({
      sku_id: retailer.slice(0, 200),
      item_id: toStr(p.id) ?? retailer,
      sku: retailer,
      name: toStr(p.name)?.slice(0, 500) ?? null,
      status: toStr(p.availability),
      qty: toInt(p.quantity_to_sell_on_facebook),
    })
  }
  const paging = asObj(data.paging)
  const after = toStr(asObj(paging.cursors).after)
  return { rows, next: paging.next && after ? after : undefined }
}

/** ข้อมูล UPDATE ของ 1 งาน (ไม่มี allow_upsert — SKU ที่ไม่มีใน Catalog จะถูกปฏิเสธแทนการสร้างสินค้าครึ่งๆ กลางๆ) */
export function metaItemData(job: MetaPushJob): Record<string, unknown> {
  const qty = Math.max(0, Math.trunc(job.qty))
  const data: Record<string, unknown> = {
    id: job.listing.external_sku_id,
    availability: qty > 0 ? 'in stock' : 'out of stock',
    quantity_to_sell_on_facebook: qty,
  }
  const info = job.meta_product
  if (info && info.price !== null && Number.isFinite(info.price) && info.price > 0) data.price = `${info.price.toFixed(2)} THB`
  if (info && info.image_urls.length > 0) data.image = info.image_urls.slice(0, 21).map(url => ({ url }))
  return data
}

const NOT_IN_CATALOG = 'สินค้านี้ยังไม่มีใน Catalog — สร้างสินค้าใน Commerce Manager (หรือผ่านลิงก์ฟีด) แล้วดึงรายการใหม่'

function itemFailure(job: OutboxJob, message: string | null): PushResult {
  const m = (message ?? '').toLowerCase()
  if (!m || /not\s*found|does not exist|no product|cannot find|unknown (item|product)|retailer.?id/.test(m)) {
    return pushFail(job, NOT_IN_CATALOG, { permanent: true })
  }
  return pushFail(job, `Meta ไม่รับข้อมูลสินค้า: ${redactText(message ?? '').replace(/\s+/g, ' ').slice(0, 200)}`, { permanent: true })
}

async function pushBatch(ctx: AdapterContext, catalog: string, jobs: MetaPushJob[]): Promise<PushResult[]> {
  const requests = jobs.map(job => ({ method: 'UPDATE', data: metaItemData(job) }))
  let data: Record<string, unknown>
  try {
    data = await graph(ctx, 'POST', `/${catalog}/items_batch`, {}, {
      item_type: 'PRODUCT_ITEM',
      allow_upsert: 'false',
      requests: JSON.stringify(requests),
    })
  } catch (e) {
    return jobs.map(job => pushFail(job, e))
  }

  const byRetailer = new Map<string, MetaPushJob[]>()
  for (const job of jobs) {
    const list = byRetailer.get(job.listing.external_sku_id) ?? []
    list.push(job)
    byRetailer.set(job.listing.external_sku_id, list)
  }
  const failed = new Map<number, PushResult>()

  // ตรวจรูปแบบทันที (validation_status)
  for (const raw of asArr(data.validation_status)) {
    const v = asObj(raw)
    const retailer = toStr(v.retailer_id)
    const errors = asArr(v.errors).map(x => toStr(asObj(x).message)).filter((x): x is string => !!x)
    if (!retailer || errors.length === 0) continue
    for (const job of byRetailer.get(retailer) ?? []) failed.set(job.id, itemFailure(job, errors[0]))
  }

  const handle = toStr(asArr(data.handles)[0])
  let finalStatus: string | null = handle ? 'dispatched' : 'no_handle'
  if (handle) {
    for (let i = 0; i < metaTiming.polls; i++) {
      await sleep(metaTiming.pollMs)
      let st: Record<string, unknown>
      try {
        st = await graph(ctx, 'GET', `/${catalog}/check_batch_request_status`, {
          handle,
          load_ids_of_invalid_requests: 'true',
          fields: 'handle,status,errors,errors_total_count,warnings,ids_of_invalid_requests',
        })
      } catch {
        break // ตรวจผลไม่ได้ — ถือว่าส่งแล้ว (บันทึก handle ไว้ใน log) รอบหน้าค่อยส่งใหม่ตามคิว
      }
      const row = asObj(asArr(st.data)[0] ?? st)
      finalStatus = toStr(row.status) ?? finalStatus
      if (finalStatus !== 'finished') continue
      const messages = new Map<string, string>()
      for (const rawErr of asArr(row.errors)) {
        const er = asObj(rawErr)
        const id = toStr(er.id) ?? toStr(er.retailer_id)
        const msg = toStr(er.message)
        if (id && msg && !messages.has(id)) messages.set(id, msg)
      }
      const invalid = new Set<string>(asArr(row.ids_of_invalid_requests).map(x => toStr(x)).filter((x): x is string => !!x))
      for (const id of Array.from(messages.keys())) invalid.add(id)
      for (const id of Array.from(invalid)) {
        for (const job of byRetailer.get(id) ?? []) {
          if (!failed.has(job.id)) failed.set(job.id, itemFailure(job, messages.get(id) ?? null))
        }
      }
      break
    }
  }
  const extra = { meta_handle: handle, meta_status: finalStatus }
  return jobs.map(job => failed.get(job.id) ?? pushOk(job, job.qty, job.qty, extra))
}

/** ส่งทุกงานของช่องทางใน items_batch เดียว (≤ 3000) — worker คุม "1 batch ต่อ Catalog ต่อ 60 วินาที" */
async function pushStock(ctx: AdapterContext, jobs: OutboxJob[]): Promise<PushResult[]> {
  let catalog: string
  try {
    catalog = catalogId(ctx)
    token(ctx)
  } catch (e) {
    return jobs.map(job => pushFail(job, e))
  }
  const results: PushResult[] = []
  for (let i = 0; i < jobs.length; i += META_BATCH_MAX) {
    results.push(...await pushBatch(ctx, catalog, jobs.slice(i, i + META_BATCH_MAX) as MetaPushJob[]))
  }
  return results
}

const adapter: ChannelAdapter = {
  platform: 'meta',
  testConnection,
  fetchCatalog,
  pushStock,
}

export default adapter
