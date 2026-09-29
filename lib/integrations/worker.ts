// lib/integrations/worker.ts — งานเบื้องหลังของระบบเชื่อมต่อ (ฝั่งเซิร์ฟเวอร์เท่านั้น)
// ลำดับในหนึ่งรอบ (CONTRACT §3.6): 1) ต่ออายุ token → 2) event ขาเข้า (webhook) → 3) ดึงออเดอร์ตามรอบ → 4) ส่งสต๊อกจากคิว
//   ออเดอร์ก่อนสต๊อกเสมอ (claim_outbox ไม่จ่ายงานของช่องทางที่ยังมี event ค้าง) — กันส่งค่าสต๊อกเก่าไปทับการตัดของแพลตฟอร์ม
// มีงบเวลา (ค่าเริ่มต้น 24 วินาที) — เกินแล้วหยุดรับงานใหม่ งานที่จองไว้แต่ไม่ได้ทำจะหลุด lease กลับเข้าคิวเอง
import { randomUUID } from 'node:crypto'
import type {
  AdapterContext, ChannelAdapter, InboundEventJob, NormalizedOrder, OutboxJob, Platform, PushResult,
} from './types'
import { PLATFORM_META } from './platforms'
import * as store from './store'
import type { ChannelLite } from './store'
import { getAdapter } from './registry'
import { isDbError, isPlatformError, PlatformError } from './errors'
import { logError, safeError } from './redact'
import { productImageBase, productImageUrl } from './env'
import { failKindOf, pushFail } from './adapters/common'
import type { MetaPushJob } from './adapters/meta'

export interface WorkerSummary {
  tokens: number
  events: { done: number; ignored: number; failed: number }
  polled: { channels: number; orders: number }
  pushed: { ok: number; failed: number }
  housekeeping?: Record<string, number>
  stoppedEarly: boolean
}

export interface RunWorkerOptions {
  mode: 'tick' | 'daily' | 'channel'
  channelId?: string
  budgetMs?: number
  workerId?: string
  /** ดึงออเดอร์ทันทีแม้ยังไม่ถึงรอบ (ปุ่ม "ซิงก์ตอนนี้") */
  forcePoll?: boolean
}

/** ฟังก์ชันที่ worker ใช้ (เปลี่ยนเป็นของปลอมได้ตอนทดสอบ) */
export interface WorkerDeps {
  listChannelsLite: typeof store.listChannelsLite
  loadChannel: typeof store.loadChannel
  loadCredentialRows: typeof store.loadCredentialRows
  buildContext: typeof store.buildContext
  saveTokens: typeof store.saveTokens
  updateChannel: typeof store.updateChannel
  log: typeof store.log
  lease: typeof store.lease
  release: typeof store.release
  claimEvents: typeof store.claimEvents
  completeEvent: typeof store.completeEvent
  failEvent: typeof store.failEvent
  recordOrder: typeof store.recordOrder
  cancelOrder: typeof store.cancelOrder
  knownOrders: typeof store.knownOrders
  claimOutbox: typeof store.claimOutbox
  completeOutbox: typeof store.completeOutbox
  failOutbox: typeof store.failOutbox
  productPushInfo: typeof store.productPushInfo
  housekeeping: typeof store.housekeeping
  getAdapter: (p: Platform) => ChannelAdapter
  now: () => Date
}

const DEFAULT_DEPS: WorkerDeps = {
  listChannelsLite: store.listChannelsLite,
  loadChannel: store.loadChannel,
  loadCredentialRows: store.loadCredentialRows,
  buildContext: store.buildContext,
  saveTokens: store.saveTokens,
  updateChannel: store.updateChannel,
  log: store.log,
  lease: store.lease,
  release: store.release,
  claimEvents: store.claimEvents,
  completeEvent: store.completeEvent,
  failEvent: store.failEvent,
  recordOrder: store.recordOrder,
  cancelOrder: store.cancelOrder,
  knownOrders: store.knownOrders,
  claimOutbox: store.claimOutbox,
  completeOutbox: store.completeOutbox,
  failOutbox: store.failOutbox,
  productPushInfo: store.productPushInfo,
  housekeeping: store.housekeeping,
  getAdapter,
  now: () => new Date(),
}

export const DEFAULT_BUDGET_MS = 24000
export const MAX_BUDGET_MS = 24000
const OUTBOX_BATCH = 50
// Meta: 1 items_batch ต่อ Catalog ต่อ 60 วินาที (รับได้ถึง 3000 รายการ) → จองทีละ 500 (เพดานของ claim_outbox)
//   ส่งครั้งแรก/ซิงก์ใหม่ 600 ไซส์ = 2 นาที แทน 12 นาที; lease ยาวขึ้นเพราะรอผล batch จาก Meta ด้วย
const META_OUTBOX_BATCH = 500
const META_OUTBOX_LEASE_SECONDS = 120
const EVENT_BATCH = 20
const META_MIN_INTERVAL_MS = 60000
const PAUSE_AFTER_FAILED_RUNS = 3
const PAUSE_MS = 15 * 60 * 1000
const MAX_POLL_WINDOW_MS = 24 * 3600 * 1000

/** เวลาที่ส่ง batch ไป Meta ล่าสุดต่อช่องทาง (กันใน process เดียวกัน — ข้าม process ใช้ last_stock_push_at) */
const metaLastBatch = new Map<string, number>()

const REAUTH_REASONS = new Set(['needs_reauth', 'auth_expired', 'credentials_invalid'])
const BATCH_FAIL_KINDS = new Set(['auth', 'reauth', 'rate_limit', 'network', 'timeout', 'server', 'config', 'blocked'])

function platformLabel(p: Platform): string {
  return PLATFORM_META[p]?.label ?? p
}

function thaiMessage(e: unknown): string {
  if (isPlatformError(e)) return e.message
  if (isDbError(e)) return /[\u0E00-\u0E7F]/.test(e.message) ? e.message.slice(0, 500) : `ฐานข้อมูลผิดพลาด (${e.code || 'network'})`
  return 'ผิดพลาด: ' + safeError(e)
}

/** error ที่ลองใหม่ไม่ช่วย (ข้อมูลผิด) */
function isPermanent(e: unknown): boolean {
  if (isPlatformError(e)) return e.permanent
  if (isDbError(e)) return !e.retryable && (e.code === 'P0001' || e.code.startsWith('22') || e.code.startsWith('23') || e.code === '42501')
  return e instanceof SyntaxError
}

export async function runWorker(opts: RunWorkerOptions, depsIn: Partial<WorkerDeps> = {}): Promise<WorkerSummary> {
  const d: WorkerDeps = { ...DEFAULT_DEPS, ...depsIn }
  const started = Date.now()
  const budget = Math.max(1000, Math.min(MAX_BUDGET_MS, opts.budgetMs ?? DEFAULT_BUDGET_MS))
  const deadline = started + budget
  const left = () => deadline - Date.now()
  const worker = (opts.workerId ?? 'vercel-' + randomUUID()).slice(0, 100)
  const summary: WorkerSummary = {
    tokens: 0,
    events: { done: 0, ignored: 0, failed: 0 },
    polled: { channels: 0, orders: 0 },
    pushed: { ok: 0, failed: 0 },
    stoppedEarly: false,
  }
  if (opts.mode === 'channel' && !opts.channelId) throw new Error('channelId required')
  const only = opts.mode === 'channel' ? opts.channelId! : null

  let channels = await d.listChannelsLite()
  if (only) channels = channels.filter(c => c.id === only)
  const byId = new Map(channels.map(c => [c.id, c]))

  // context ต่อช่องทาง (โหลดครั้งเดียวต่อรอบ — ถอดความลับเฉพาะช่องทางที่มีงานจริง)
  const ctxCache = new Map<string, Promise<AdapterContext>>()
  const getCtx = (id: string): Promise<AdapterContext> => {
    let p = ctxCache.get(id)
    if (!p) {
      p = d.buildContext(id)
      p.catch(() => ctxCache.delete(id))
      ctxCache.set(id, p)
    }
    return p
  }

  // ผลต่อช่องทางในรอบนี้ (ใช้พักช่องทางที่ล้มเหลวติดกัน 3 รอบ)
  const runOk = new Set<string>()
  const runFailed = new Set<string>()

  if (opts.mode === 'daily') {
    try {
      summary.housekeeping = await d.housekeeping()
    } catch (e) {
      logError('housekeeping', e)
    }
  }

  // ---------------------------------------------------------------- 1) token
  for (const c of channels) {
    if (left() < 3000) { summary.stoppedEarly = true; break }
    if (c.status !== 'connected' && c.status !== 'error') continue
    const adapter = d.getAdapter(c.platform)
    const dueAt = c.next_token_check_at ? Date.parse(c.next_token_check_at) : NaN
    const due = opts.mode === 'daily' ? true : Number.isFinite(dueAt) && dueAt <= d.now().getTime()
    if (!due) continue
    if (!adapter.refreshToken) {
      if (c.next_token_check_at) {
        try { await d.updateChannel(c.id, { next_token_check_at: null }) } catch (e) { logError('token_check_clear', e) }
      }
      continue
    }
    if (opts.mode === 'daily' && !c.next_token_check_at && c.status === 'error') continue
    const refreshed = await refreshChannelToken(c, adapter)
    if (refreshed) {
      summary.tokens++
      ctxCache.delete(c.id)
    }
  }

  // ---------------------------------------------------------------- 2) event ขาเข้า
  for (;;) {
    if (left() < 2500) { summary.stoppedEarly = true; break }
    let evs: InboundEventJob[]
    try {
      evs = await d.claimEvents(EVENT_BATCH, worker, only, 120)
    } catch (e) {
      logError('claim_inbound_events', e)
      break
    }
    if (!evs.length) break
    for (const ev of evs) {
      if (left() < 800) { summary.stoppedEarly = true; break }
      await processEvent(ev)
    }
    if (evs.length < EVENT_BATCH || summary.stoppedEarly) break
  }

  // ---------------------------------------------------------------- 3) ดึงออเดอร์ตามรอบ
  for (const c of channels) {
    if (left() < 4000) { summary.stoppedEarly = true; break }
    if (c.status !== 'connected') continue
    if (isPausedNow(c)) continue
    const caps = PLATFORM_META[c.platform].capabilities
    const adapter = d.getAdapter(c.platform)
    const opt = store.liteOptions(c)
    if (!caps.pullOrders || !opt.pull_orders || !adapter.fetchOrders) continue
    const last = c.last_orders_sync_at ? Date.parse(c.last_orders_sync_at) : NaN
    const due = opts.forcePoll || !Number.isFinite(last) || last + opt.poll_seconds * 1000 <= d.now().getTime()
    if (!due) continue
    await pollChannel(c, adapter)
  }

  // ---------------------------------------------------------------- 4) ส่งสต๊อกจากคิว
  for (const c of channels) {
    if (left() < 3000) { summary.stoppedEarly = true; break }
    if (c.status !== 'connected' || isPausedNow(c)) continue
    await pushChannel(c)
  }

  // ---------------------------------------------------------------- พักช่องทางที่ล้มเหลวติดกัน
  for (const c of channels) {
    const prev = Number(c.settings?.worker_failed_runs ?? 0) || 0
    try {
      if (runOk.has(c.id)) {
        if (prev > 0) await d.updateChannel(c.id, { settings_merge: { worker_failed_runs: 0 } })
      } else if (runFailed.has(c.id)) {
        const n = prev + 1
        if (n >= PAUSE_AFTER_FAILED_RUNS) {
          const until = new Date(d.now().getTime() + PAUSE_MS)
          await d.updateChannel(c.id, { paused_until: until.toISOString(), settings_merge: { worker_failed_runs: 0 } })
          await d.log(c.id, 'worker', false, `ล้มเหลวติดกัน ${n} รอบ — พักการเชื่อมต่อ ${platformLabel(c.platform)} 15 นาทีแล้วลองใหม่เอง`,
            { paused_until: until.toISOString() })
        } else {
          await d.updateChannel(c.id, { settings_merge: { worker_failed_runs: n } })
        }
      }
    } catch (e) {
      logError('failed_runs', e)
    }
  }

  return summary

  // ===================================================================
  function isPausedNow(c: ChannelLite): boolean {
    if (!c.paused_until) return false
    const t = Date.parse(c.paused_until)
    return Number.isFinite(t) && t > d.now().getTime()
  }

  async function refreshChannelToken(c: ChannelLite, adapter: ChannelAdapter): Promise<boolean> {
    let leased = false
    const t0 = Date.now()
    try {
      leased = await d.lease(c.id, worker, 60)
      if (!leased) return false
      const channel = await d.loadChannel(c.id)
      const { values, versions } = await d.loadCredentialRows(c.id)
      if (!values.refresh_token) {
        await d.updateChannel(c.id, { next_token_check_at: null })
        return false
      }
      if (channel.auth_expires_at && Date.parse(channel.auth_expires_at) <= d.now().getTime()) {
        await d.updateChannel(c.id, {
          status: 'error', status_reason: 'auth_expired', next_token_check_at: null,
          last_error: `การอนุญาตของร้าน ${platformLabel(c.platform)} หมดอายุแล้ว — กด "เชื่อมต่อร้าน" ใหม่`,
        })
        await d.log(c.id, 'refresh_token', false, 'การอนุญาตของร้านหมดอายุ ต้องเชื่อมต่อร้านใหม่')
        return false
      }
      const ctx = await d.buildContext(c.id, { channel, creds: values })
      const tokens = await adapter.refreshToken!(ctx)
      const saved = await d.saveTokens(c.id, tokens, versions.refresh_token ?? 0, d.now())
      if (!saved) return false // มีงานอื่นต่ออายุไปก่อนแล้ว
      if (channel.status === 'error' && channel.status_reason && REAUTH_REASONS.has(channel.status_reason)) {
        await d.updateChannel(c.id, { status: 'connected', status_reason: null, last_error: null })
      }
      await d.log(c.id, 'refresh_token', true, `ต่ออายุ token ${platformLabel(c.platform)} สำเร็จ`,
        { access_expires_at: tokens.access_expires_at ? tokens.access_expires_at.toISOString() : null }, null, Date.now() - t0)
      return true
    } catch (e) {
      const msg = thaiMessage(e)
      try {
        if (isPlatformError(e) && e.kind === 'reauth') {
          await d.updateChannel(c.id, { status: 'error', status_reason: 'needs_reauth', last_error: msg, next_token_check_at: null })
        } else if (isPlatformError(e) && e.kind === 'auth') {
          await d.updateChannel(c.id, { status: 'error', status_reason: 'credentials_invalid', last_error: msg,
            next_token_check_at: new Date(d.now().getTime() + 3600 * 1000).toISOString() })
        } else {
          await d.updateChannel(c.id, { last_error: msg, next_token_check_at: new Date(d.now().getTime() + 15 * 60 * 1000).toISOString() })
        }
      } catch (e2) {
        logError('refresh_token_update', e2)
      }
      await d.log(c.id, 'refresh_token', false, `ต่ออายุ token ไม่สำเร็จ: ${msg}`.slice(0, 500), null, null, Date.now() - t0)
      return false
    } finally {
      if (leased) await d.release(c.id, worker)
    }
  }

  async function processEvent(ev: InboundEventJob): Promise<void> {
    const c = byId.get(ev.channel_id)
    const done = async (status: 'done' | 'ignored', note: string | null) => {
      try {
        await d.completeEvent(ev.id, worker, status, note)
      } catch (e) {
        logError('complete_inbound_event', e)
      }
      if (status === 'done') summary.events.done++
      else summary.events.ignored++
    }
    if (!c) return done('ignored', 'ไม่พบช่องทางนี้')
    if (c.status === 'disconnected' || c.status === 'pending_approval') return done('ignored', 'ช่องทางไม่ได้เชื่อมต่ออยู่')
    const caps = PLATFORM_META[c.platform].capabilities
    if (!caps.pullOrders) return done('ignored', `ยังไม่รองรับออเดอร์ ${platformLabel(c.platform)} ในรอบนี้`)
    if (!store.liteOptions(c).pull_orders) return done('ignored', 'ช่องทางปิด "ดึงออเดอร์" อยู่')
    const adapter = d.getAdapter(c.platform)
    if (!adapter.eventToActions) return done('ignored', 'ช่องทางนี้ไม่รับ event')
    try {
      const ctx = await getCtx(c.id)
      const actions = await adapter.eventToActions(ctx, ev)
      let work = 0
      let note: string | null = null
      for (const a of actions) {
        if (a.kind === 'ignore') { note = note ?? a.note; continue }
        work++
        if (a.kind === 'order') {
          await d.recordOrder(c.id, a.order, 'webhook')
        } else if (a.kind === 'cancel') {
          await d.cancelOrder(c.id, a.external_order_id, { status: a.status, wasShipped: a.was_shipped ?? null, updatedAt: a.updated_at ?? null })
        } else if (a.kind === 'fetch_orders') {
          // ต้องเรียก API ของแพลตฟอร์ม → รอจนกว่าช่องทางจะพร้อม
          if (isPausedNow(c)) {
            const secs = Math.ceil((Date.parse(c.paused_until!) - d.now().getTime()) / 1000)
            throw new PlatformError('rate_limit', 'ช่องทางพักชั่วคราว — จะดึงออเดอร์เมื่อพ้นเวลาพัก', { retryAfterSeconds: Math.max(30, secs) })
          }
          if (c.status === 'paused') throw new PlatformError('rate_limit', 'ช่องทางหยุดชั่วคราวอยู่ — จะดึงออเดอร์เมื่อกดทำงานต่อ', { retryAfterSeconds: 900 })
          if (!adapter.fetchOrdersByIds) { note = note ?? 'ช่องทางนี้ดึงรายละเอียดออเดอร์ไม่ได้'; work--; continue }
          const orders = await adapter.fetchOrdersByIds(ctx, a.external_order_ids)
          for (const o of orders) await d.recordOrder(c.id, o, 'webhook')
        }
      }
      await done(work > 0 ? 'done' : 'ignored', work > 0 ? null : note)
    } catch (e) {
      const permanent = isPermanent(e)
      const retry = isPlatformError(e) ? e.retryAfterSeconds ?? null : null
      try {
        await d.failEvent(ev.id, worker, thaiMessage(e), permanent, retry)
      } catch (e2) {
        logError('fail_inbound_event', e2)
      }
      summary.events.failed++
      if (isPlatformError(e) && BATCH_FAIL_KINDS.has(e.kind)) runFailed.add(c.id)
    }
  }

  async function pollChannel(c: ChannelLite, adapter: ChannelAdapter): Promise<void> {
    let leased = false
    const t0 = Date.now()
    const nowIso = () => d.now().toISOString()
    let recorded = 0
    let cancelled = 0
    let deducted = 0
    try {
      leased = await d.lease(c.id, worker, 60)
      if (!leased) return
      const ctx = await getCtx(c.id)
      const now = d.now().getTime()
      const isLine = c.platform === 'line'
      const cursor = c.orders_cursor ? Date.parse(c.orders_cursor) : NaN
      // LINE: ช่วงเวลาไม่ทับกัน (startAt = endAt รอบก่อน), endAt = ตอนนี้ − 2 นาที / อื่นๆ: ทับกัน 10 นาทีกันพลาด
      let since = Number.isFinite(cursor) ? (isLine ? cursor : cursor - 10 * 60 * 1000) : now - 10 * 60 * 1000
      let until = isLine ? now - 2 * 60 * 1000 : now
      if (since < now - 30 * 86400 * 1000) since = now - 30 * 86400 * 1000
      if (until - since > MAX_POLL_WINDOW_MS) until = since + MAX_POLL_WINDOW_MS
      if (until <= since) {
        await d.updateChannel(c.id, { last_orders_sync_at: nowIso() })
        return
      }
      let pageCursor: string | undefined
      let complete = false
      for (let pages = 0; pages < 20; pages++) {
        if (left() < 3000) { summary.stoppedEarly = true; break }
        const res = await adapter.fetchOrders!(ctx, { since: new Date(since), until: new Date(until), cursor: pageCursor })
        const full: NormalizedOrder[] = res.orders.filter(o => o.lines.length > 0)
        const bare = res.orders.filter(o => o.lines.length === 0)
        if (bare.length && adapter.fetchOrdersByIds) {
          const known = await d.knownOrders(c.id, bare.map(o => o.external_order_id))
          const need = bare.filter(o => {
            const k = known.get(o.external_order_id)
            return !k || k.status !== o.status || (!!o.raw_status && k.raw_status !== o.raw_status)
          })
          if (need.length) full.push(...await adapter.fetchOrdersByIds(ctx, need.map(o => o.external_order_id)))
        }
        for (const o of full) {
          const r = await d.recordOrder(c.id, o, 'poll')
          recorded++
          deducted += Number(r?.deducted ?? 0)
        }
        for (const x of res.cancels ?? []) {
          const r = await d.cancelOrder(c.id, x.external_order_id, { status: x.status, wasShipped: x.was_shipped ?? null, updatedAt: x.updated_at ?? null })
          if (r && (r as { found?: boolean }).found) cancelled++
        }
        if (!res.next) { complete = true; break }
        pageCursor = res.next
      }
      const patch: Record<string, unknown> = { last_sync_at: nowIso() }
      if (complete) {
        patch.orders_cursor = new Date(until).toISOString()
        patch.last_orders_sync_at = nowIso()
      } else {
        // ยังไม่ครบทุกหน้า (หมดงบเวลา) → รอบหน้าทำต่อในอีกราว 1 นาที
        const opt = store.liteOptions(c)
        patch.last_orders_sync_at = new Date(d.now().getTime() - opt.poll_seconds * 1000 + 60 * 1000).toISOString()
      }
      await d.updateChannel(c.id, patch)
      summary.polled.channels++
      summary.polled.orders += recorded
      runOk.add(c.id)
      if (recorded > 0 || cancelled > 0) {
        await d.log(c.id, 'pull_orders', true,
          `ดึงออเดอร์ ${platformLabel(c.platform)} ${recorded} รายการ${cancelled ? ` · ยกเลิก/หมดอายุ ${cancelled}` : ''}${deducted ? ` · ตัดสต๊อก ${deducted} ชิ้น` : ''}`,
          { since: new Date(since).toISOString(), until: new Date(until).toISOString(), complete, orders: recorded, cancels: cancelled }, null, Date.now() - t0)
      }
    } catch (e) {
      const msg = thaiMessage(e)
      try {
        const patch: Record<string, unknown> = { last_orders_sync_at: nowIso(), last_error: msg }
        if (isPlatformError(e) && (e.kind === 'auth' || e.kind === 'reauth')) {
          patch.status = 'error'
          patch.status_reason = e.kind === 'auth' ? 'credentials_invalid' : 'needs_reauth'
        }
        await d.updateChannel(c.id, patch)
      } catch (e2) {
        logError('poll_update', e2)
      }
      await d.log(c.id, 'pull_orders', false, `ดึงออเดอร์ไม่สำเร็จ: ${msg}`.slice(0, 500), { orders: recorded }, null, Date.now() - t0)
      if (!isPlatformError(e) || BATCH_FAIL_KINDS.has(e.kind)) runFailed.add(c.id)
    } finally {
      if (leased) await d.release(c.id, worker)
    }
  }

  async function enrichMeta(jobs: OutboxJob[]): Promise<void> {
    const base = productImageBase()
    const imagesOk = /^https:\/\//i.test(base)
    try {
      const info = await d.productPushInfo(jobs.map(j => j.product_id))
      for (const job of jobs as MetaPushJob[]) {
        const i = info.get(job.product_id)
        if (!i) continue
        job.meta_product = { price: i.price, image_urls: imagesOk ? i.image_paths.map(p => productImageUrl(p, base)) : [] }
      }
    } catch (e) {
      logError('meta_product_info', e) // ส่งเฉพาะสต๊อกไปก่อน
    }
  }

  async function pushChannel(c: ChannelLite): Promise<void> {
    const caps = PLATFORM_META[c.platform].capabilities
    const adapter = d.getAdapter(c.platform)
    const isMeta = c.platform === 'meta'
    if (isMeta) {
      const lastDb = c.last_stock_push_at ? Date.parse(c.last_stock_push_at) : NaN
      const lastMem = metaLastBatch.get(c.id) ?? NaN
      const last = Math.max(Number.isFinite(lastDb) ? lastDb : 0, Number.isFinite(lastMem) ? lastMem : 0)
      if (last && d.now().getTime() - last < META_MIN_INTERVAL_MS) return // 1 batch ต่อ Catalog ต่อ 60 วินาที
    }
    const t0 = Date.now()
    let ok = 0
    let failed = 0
    let dead = 0
    const errors: string[] = []
    const handles: string[] = []
    let batchFail = false
    const batchSize = isMeta ? META_OUTBOX_BATCH : OUTBOX_BATCH
    for (let round = 0; round < 10; round++) {
      if (left() < 3000) { summary.stoppedEarly = true; break }
      let jobs: OutboxJob[]
      try {
        jobs = await d.claimOutbox(batchSize, worker, c.id, isMeta ? META_OUTBOX_LEASE_SECONDS : 60)
      } catch (e) {
        logError('claim_outbox', e)
        break
      }
      if (!jobs.length) break
      let results: PushResult[]
      if (!caps.pushStock || !adapter.pushStock) {
        const why = new PlatformError('unsupported', `ยังไม่รองรับการส่งสต๊อกไป ${platformLabel(c.platform)} ในรอบนี้ (รออนุมัติ API)`)
        results = jobs.map(job => pushFail(job, why))
      } else {
        let ctx: AdapterContext | null = null
        try {
          ctx = await getCtx(c.id)
        } catch (e) {
          results = jobs.map(job => pushFail(job, e, { permanent: false, retryAfterSeconds: 300, message: thaiMessage(e) }))
        }
        if (ctx) {
          if (isMeta) {
            await enrichMeta(jobs)
            metaLastBatch.set(c.id, d.now().getTime())
          }
          try {
            results = await adapter.pushStock(ctx, jobs)
          } catch (e) {
            results = jobs.map(job => pushFail(job, e))
          }
        }
      }
      const byId = new Map<number, PushResult>()
      for (const r of results!) if (r && typeof r.id === 'number') byId.set(r.id, r)
      const oks: { id: number; pushed_qty: number; platform_qty?: number }[] = []
      const fails: { id: number; error: string; permanent?: boolean; retry_after_seconds?: number }[] = []
      let authKind: string | null = null
      let authMsg = ''
      for (const job of jobs) {
        const r = byId.get(job.id) ?? pushFail(job, 'ไม่ได้รับผลการส่งจากแพลตฟอร์ม — ลองใหม่', { retryAfterSeconds: 60 })
        if (r.ok) {
          oks.push({ id: r.id, pushed_qty: r.pushed_qty, ...(r.platform_qty !== undefined ? { platform_qty: r.platform_qty } : {}) })
          const h = (r as { meta_handle?: unknown }).meta_handle
          if (typeof h === 'string' && !handles.includes(h)) handles.push(h)
        } else {
          fails.push({ id: r.id, error: r.error, permanent: r.permanent, ...(r.retry_after_seconds !== undefined ? { retry_after_seconds: r.retry_after_seconds } : {}) })
          if (errors.length < 5 && !errors.includes(r.error)) errors.push(r.error)
          const kind = failKindOf(r)
          if (kind && BATCH_FAIL_KINDS.has(kind)) batchFail = true
          if ((kind === 'auth' || kind === 'reauth') && !authKind) { authKind = kind; authMsg = r.error }
          if (r.permanent) dead++
        }
      }
      try {
        if (oks.length) await d.completeOutbox(worker, oks)
        if (fails.length) await d.failOutbox(worker, fails)
      } catch (e) {
        logError('complete_fail_outbox', e) // งานจะหลุด lease แล้วกลับเข้าคิวเอง
      }
      ok += oks.length
      failed += fails.length
      if (authKind) {
        try {
          await d.updateChannel(c.id, { status: 'error', status_reason: authKind === 'reauth' ? 'needs_reauth' : 'credentials_invalid', last_error: authMsg })
        } catch (e) {
          logError('status_error', e)
        }
        break
      }
      if (isMeta) break
      if (jobs.length < batchSize) break
    }
    summary.pushed.ok += ok
    summary.pushed.failed += failed
    if (ok > 0) runOk.add(c.id)
    else if (batchFail) runFailed.add(c.id)
    if (ok + failed > 0) {
      await d.log(c.id, 'push_stock', failed === 0,
        `ส่งสต๊อก ${platformLabel(c.platform)} สำเร็จ ${ok} รายการ${failed ? ` · ล้มเหลว ${failed}` : ''}${dead ? ` (ไม่ลองใหม่ ${dead})` : ''}`,
        { ok, failed, permanent: dead, errors, ...(handles.length ? { meta_batch_handles: handles } : {}) }, null, Date.now() - t0)
    }
  }
}
