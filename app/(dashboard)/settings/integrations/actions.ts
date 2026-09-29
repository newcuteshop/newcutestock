'use server'
// server actions ของหน้า "ตั้งค่าการเชื่อมต่อ" (CONTRACT-INTEGRATIONS.md §3.10)
// กติกา: ทุกฟังก์ชันตรวจ Admin ก่อน (บทบาท admin เท่านั้น — พนักงานที่มีสิทธิ์ครบก็ไม่ได้) และตรวจค่าที่รับจาก browser ทุกตัว
//        ไม่คืนความลับเด็ดขาด (มีแค่คำใบ้ '•••• 1a2b') / ไม่โยน error ถึงหน้าเว็บ — คืน { ok:false, error } ภาษาไทยเสมอ
//        RPC ของหน้าตั้งค่าเรียกด้วย session ผู้ใช้ (ฐานข้อมูลตรวจ is_admin() ซ้ำ) / RPC ฝั่งเซิร์ฟเวอร์เรียกด้วย service role
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { getAdminSessionOrError, type AppSession } from '@/lib/auth/permissions'
import type {
  ActionResult, AutoMatchResult, ChannelEnvironment, ChannelJson, ChannelOptionsInput, ChannelStateAction, ChannelStatus,
  ExportStockRow, ListingJson, OrderJson, Platform, ResolveOrderAction, SetMappingResult,
} from '@/lib/integrations/types'
import { isPlatform, PLATFORM_META } from '@/lib/integrations/platforms'
import * as store from '@/lib/integrations/store'
import { getAdapter } from '@/lib/integrations/registry'
import { runWorker } from '@/lib/integrations/worker'
import { getKeyring, IntegrationConfigError, randomToken, sha256Hex } from '@/lib/integrations/crypto'
import { AUTH_REDIRECT_HOSTS } from '@/lib/integrations/http'
import { callbackUrl, requireAppBaseUrl } from '@/lib/integrations/env'
import { ORDERS_CSV_MAX_BYTES, parseOrdersCsv, stockRowsToCsv } from '@/lib/integrations/csv'
import { isDbError, isPlatformError } from '@/lib/integrations/errors'
import { logError } from '@/lib/integrations/redact'
import type { TestResult } from '@/lib/integrations/adapters/common'
import { bangkokDateKey } from '@/lib/format'

// ---------------------------------------------------------------------------
// ตัวช่วย (ไม่ export — ไฟล์ 'use server' export ได้เฉพาะฟังก์ชัน async)
// ---------------------------------------------------------------------------
const GENERIC_ERROR = 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'
const NOT_ADMIN = 'เมนูนี้ใช้ได้เฉพาะผู้ดูแลระบบ (Admin) — กรุณาเข้าสู่ระบบด้วยบัญชี Admin'
const THAI_RE = /[\u0E00-\u0E7F]/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

class ActionFail extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActionFail'
  }
}

function fail(message: string): never {
  throw new ActionFail(message)
}

function toThai(e: unknown): string {
  if (e instanceof Error && (e.name === 'ActionFail' || e.name === 'IntegrationConfigError')) return e.message
  if (isPlatformError(e)) return e.message
  if (isDbError(e)) {
    if (e.code === '23505') return 'ข้อมูลซ้ำกับช่องทางอื่นในระบบ (เช่น ร้าน/Catalog นี้เชื่อมกับอีกช่องทางอยู่แล้ว)'
    if ((e.code === 'P0001' || e.code === '42501' || e.code === '') && THAI_RE.test(e.message)) return e.message.slice(0, 500)
    if (THAI_RE.test(e.message)) return e.message.slice(0, 500)
    logError('action_db', e)
    return e.retryable ? 'เชื่อมต่อฐานข้อมูลไม่ได้ชั่วคราว กรุณาลองใหม่' : GENERIC_ERROR
  }
  logError('action', e)
  return GENERIC_ERROR
}

async function withAdmin<T extends object>(fn: (session: AppSession) => Promise<T>): Promise<ActionResult<T>> {
  const session = await getAdminSessionOrError()
  if (!session) return { ok: false, error: NOT_ADMIN }
  try {
    const result = await fn(session)
    return { ok: true, ...result }
  } catch (e) {
    return { ok: false, error: toThai(e) }
  }
}

function uuid(v: unknown, label = 'รหัส'): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) fail(`${label}ไม่ถูกต้อง`)
  return v.toLowerCase()
}

function intIn(v: unknown, min: number, max: number, label: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) fail(`${label}ต้องเป็นจำนวนเต็ม ${min}–${max}`)
  return v
}

/** เรียก RPC ของหน้าตั้งค่าด้วย session ผู้ใช้ (ฐานข้อมูลตรวจ Admin + บันทึกผู้ทำรายการ) */
async function sessionRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const supabase = createClient()
  const { data, error, status } = await supabase.rpc(name, args) as unknown as { data: unknown; error: { message?: unknown; code?: unknown } | null; status?: number }
  if (error) throw store.toDbError(error, status)
  return data as T
}

function getChannel(channelId: string): Promise<ChannelJson> {
  return sessionRpc<ChannelJson>('get_integration_channel', { p_channel_id: channelId })
}

function revalidate(channelId?: string | null): void {
  try {
    revalidatePath('/settings/integrations')
    if (channelId) revalidatePath('/settings/integrations/' + channelId)
  } catch {
    // นอก request ของ Next (ทดสอบ) — ข้าม
  }
}

function requireEncKey(): void {
  getKeyring()
}

function label(p: Platform): string {
  return PLATFORM_META[p].label
}

function stripChannel(r: object, extraKeys: string[]): ChannelJson {
  const out: Record<string, unknown> = { ...(r as Record<string, unknown>) }
  for (const k of extraKeys) delete out[k]
  return out as unknown as ChannelJson
}

const OPTION_RULES: Record<string, (v: unknown) => boolean> = {
  push_stock: v => typeof v === 'boolean',
  pull_orders: v => typeof v === 'boolean',
  shadow_mode: v => typeof v === 'boolean',
  stock_buffer: v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1000,
  zero_at_or_below: v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1000,
  poll_seconds: v => typeof v === 'number' && Number.isInteger(v) && v >= 60 && v <= 86400,
  deduct_on: v => v === 'created' || v === 'paid',
  restock_returns: v => v === 'manual' || v === 'auto',
}

// ---------------------------------------------------------------------------
// ช่องทาง
// ---------------------------------------------------------------------------
export async function createChannel(platform: Platform, displayName?: string, environment?: ChannelEnvironment): Promise<ActionResult<{ channel: ChannelJson }>> {
  return withAdmin(async () => {
    if (!isPlatform(platform)) fail('แพลตฟอร์มไม่ถูกต้อง')
    const env = environment ?? 'production'
    if (env !== 'production' && env !== 'sandbox') fail('สภาพแวดล้อมไม่ถูกต้อง')
    if (env === 'sandbox' && !PLATFORM_META[platform].supportsSandbox) fail(`${label(platform)} ไม่มีโหมดทดสอบ (sandbox)`)
    let name: string | null = null
    if (displayName !== undefined && displayName !== null) {
      if (typeof displayName !== 'string') fail('ชื่อช่องทางไม่ถูกต้อง')
      name = displayName.trim() || null
      if (name && name.length > 100) fail('ชื่อช่องทางยาวเกิน 100 ตัวอักษร')
    }
    const channel = await sessionRpc<ChannelJson>('create_integration_channel', { p_platform: platform, p_display_name: name, p_environment: env })
    revalidate(channel.id)
    return { channel }
  })
}

export async function saveCredentials(channelId: string, fields: Record<string, string>): Promise<ActionResult<{ hints: Record<string, string> }>> {
  return withAdmin(async (session) => {
    const id = uuid(channelId, 'รหัสช่องทาง')
    const channel = await getChannel(id)
    const meta = PLATFORM_META[channel.platform]
    if (meta.credentialFields.length === 0) fail('ช่องทางนี้ไม่ต้องใส่คีย์')
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) fail('ข้อมูลที่ส่งมาไม่ถูกต้อง')
    const known = new Map(meta.credentialFields.map(f => [f.name, f]))
    const updates: Record<string, string> = {}
    for (const [name, raw] of Object.entries(fields)) {
      const f = known.get(name)
      if (!f) fail(`ไม่รู้จักช่อง "${String(name).replace(/[^a-z0-9_]/gi, '').slice(0, 40)}"`)
      if (raw === null || raw === undefined) continue
      if (typeof raw !== 'string') fail(`${f.label} ต้องเป็นข้อความ`)
      const v = raw.trim()
      if (v === '') continue // ว่าง = ใช้ค่าเดิม
      if (v.length > 2048) fail(`${f.label} ยาวเกินไป`)
      if (f.pattern && !new RegExp(f.pattern).test(v)) fail(`รูปแบบ ${f.label} ไม่ถูกต้อง`)
      updates[name] = v
    }
    if (Object.keys(updates).length === 0) fail('ยังไม่ได้กรอกค่าใหม่ (ช่องที่เว้นว่างจะใช้ค่าเดิม)')
    const existing = new Set((channel.credentials ?? []).map(c => c.name))
    const missing = meta.credentialFields.filter(f => f.required && !existing.has(f.name) && !(f.name in updates))
    if (missing.length) fail(`ยังไม่ได้กรอก ${missing.map(f => f.label).join(', ')}`)

    requireEncKey()
    const saved = await store.saveCredentialValues(id, updates, { platform: channel.platform, actor: session.user.id })
    if (!saved.ok) fail(GENERIC_ERROR)

    // ค่าที่ไม่ลับบางช่องคัดลอกไป settings ของช่องทางด้วย (เช่น catalog_id, partner_id, app_key, service_id)
    const settingsMerge: Record<string, unknown> = {}
    for (const f of meta.credentialFields) {
      if (!f.secret && f.settingsKey && f.name in updates) settingsMerge[f.settingsKey] = updates[f.name]
    }
    const patch: Record<string, unknown> = {}
    if (Object.keys(settingsMerge).length) patch.settings_merge = settingsMerge
    if (channel.platform === 'meta' && updates.catalog_id) patch.external_shop_id = updates.catalog_id
    if (Object.keys(patch).length) await store.updateChannel(id, patch)

    const names = Object.keys(updates)
    await store.log(id, 'admin', true, `บันทึกคีย์ ${names.join(', ')}`, { names }, session.user.id)
    revalidate(id)
    return { hints: saved.hints }
  })
}

export async function testConnection(channelId: string): Promise<ActionResult<{ message: string; shopName?: string; status: ChannelStatus; testOk: boolean }>> {
  return withAdmin(async (session) => {
    const id = uuid(channelId, 'รหัสช่องทาง')
    const channel = await getChannel(id)
    const platform = channel.platform
    const meta = PLATFORM_META[platform]
    const adapter = getAdapter(platform)
    const t0 = Date.now()
    let res: TestResult
    try {
      if (platform !== 'generic') requireEncKey()
      const ctx = await store.buildContext(id, platform === 'generic' ? { channel, creds: {} } : { channel })
      res = await adapter.testConnection(ctx) as TestResult
    } catch (e) {
      if (e instanceof IntegrationConfigError) throw e
      res = { ok: false, message: toThai(e), reason: 'platform_error' }
    }

    const isOauth = meta.authKind === 'oauth'
    let status: ChannelStatus = channel.status
    const patch: Record<string, unknown> = { last_test_ok: res.ok }
    if (res.ok) {
      patch.last_error = null
      patch.consecutive_failures = 0
      if (res.shop_id) patch.external_shop_id = res.shop_id
      if (res.shop_name) patch.external_shop_name = res.shop_name
      if (res.settings) {
        const clean = Object.fromEntries(Object.entries(res.settings).filter(([, v]) => v !== null && v !== undefined && v !== ''))
        if (Object.keys(clean).length) patch.settings_merge = clean
      }
      if (platform !== 'generic' && channel.status !== 'paused') {
        if (!isOauth || channel.status === 'error') status = 'connected'
      }
      if (status !== channel.status || status === 'connected') { patch.status = status; patch.status_reason = null }
    } else {
      patch.last_error = res.message
      const reason = res.reason ?? 'platform_error'
      const canFlip = channel.status === 'connected' || channel.status === 'error' || (!isOauth && channel.status === 'disconnected')
      // เปลี่ยนเป็น "มีปัญหา" เฉพาะเมื่อคีย์/สิทธิ์ใช้ไม่ได้จริง — ล้มชั่วคราว (เน็ต/หมดเวลา/5xx/ยิงถี่เกิน) คงสถานะเดิมไว้
      // (worker ส่งสต๊อก/ดึงออเดอร์เฉพาะช่องทาง "เชื่อมต่อแล้ว" และมีหน่วง+พักเองเมื่อแพลตฟอร์มล่ม — ถ้าพลิกเป็น error
      //  เพราะกดทดสอบตอนแพลตฟอร์มสะดุดครั้งเดียว การซิงก์จะหยุดจนกว่าจะมีคนกดทดสอบอีกครั้ง)
      const hard = reason === 'credentials_invalid' || reason === 'needs_reauth' || reason === 'auth_expired'
      if (hard && canFlip) {
        status = 'error'
        patch.status = 'error'
        patch.status_reason = reason
      }
    }
    await store.updateChannel(id, patch)
    await store.log(id, 'test', res.ok, res.message.slice(0, 500), null, session.user.id, Date.now() - t0)
    revalidate(id)
    return { message: res.message, ...(res.shop_name ? { shopName: res.shop_name } : {}), status, testOk: res.ok }
  })
}

export async function saveOptions(channelId: string, options: ChannelOptionsInput, displayName?: string): Promise<ActionResult<{ channel: ChannelJson; enqueued: number }>> {
  return withAdmin(async () => {
    const id = uuid(channelId, 'รหัสช่องทาง')
    if (!options || typeof options !== 'object' || Array.isArray(options)) fail('ตัวเลือกไม่ถูกต้อง')
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(options)) {
      if (v === undefined) continue
      const rule = OPTION_RULES[k]
      if (!rule) fail(`ไม่รู้จักตัวเลือก "${String(k).replace(/[^a-z_]/gi, '').slice(0, 40)}"`)
      if (!rule(v)) fail(`ค่าของตัวเลือก ${k} ไม่ถูกต้อง`)
      clean[k] = v
    }
    let name: string | null = null
    if (displayName !== undefined && displayName !== null) {
      if (typeof displayName !== 'string') fail('ชื่อช่องทางไม่ถูกต้อง')
      name = displayName.trim() || null
      if (name && name.length > 100) fail('ชื่อช่องทางยาวเกิน 100 ตัวอักษร')
    }
    const channel = await getChannel(id)
    const caps = PLATFORM_META[channel.platform].capabilities
    if (clean.push_stock === true && !caps.pushStock) fail(`ยังไม่รองรับการส่งสต๊อกไป ${label(channel.platform)} ในรอบนี้ (รออนุมัติ API)`)
    if (clean.pull_orders === true && !caps.pullOrders) fail(`ยังไม่รองรับการดึงออเดอร์จาก ${label(channel.platform)} ในรอบนี้`)
    const res = await sessionRpc<ChannelJson & { enqueued?: number }>('save_channel_options', {
      p_channel_id: id, p_options: clean, p_display_name: name,
    })
    revalidate(id)
    return { channel: stripChannel(res, ['enqueued']), enqueued: Number(res.enqueued ?? 0) }
  })
}

const STATE_ACTIONS: ReadonlySet<string> = new Set(['mark_pending_approval', 'unmark_pending_approval', 'pause', 'resume'])

export async function setChannelState(channelId: string, action: ChannelStateAction): Promise<ActionResult<{ channel: ChannelJson }>> {
  return withAdmin(async () => {
    const id = uuid(channelId, 'รหัสช่องทาง')
    if (typeof action !== 'string' || !STATE_ACTIONS.has(action)) fail('คำสั่งไม่ถูกต้อง')
    const channel = await sessionRpc<ChannelJson>('set_channel_state', { p_channel_id: id, p_action: action })
    revalidate(id)
    return { channel }
  })
}

export async function syncNow(channelId: string): Promise<ActionResult<{ enqueued: number; pushed: number; failed: number; ordersPulled: number; message: string }>> {
  return withAdmin(async (session) => {
    const id = uuid(channelId, 'รหัสช่องทาง')
    const channel = await getChannel(id)
    if (channel.platform === 'generic') fail('ช่องทางนี้ไม่มีการซิงก์ผ่าน API (ใช้ลิงก์ฟีด / CSV)')
    requireEncKey()
    const caps = PLATFORM_META[channel.platform].capabilities
    let enqueued = 0
    if (caps.pushStock && channel.options.push_stock && channel.options.initial_push_done
      && (channel.status === 'connected' || channel.status === 'error' || channel.status === 'paused')) {
      const r = await sessionRpc<{ enqueued: number }>('request_channel_resync', { p_channel_id: id })
      enqueued = Number(r?.enqueued ?? 0)
    }
    await store.log(id, 'admin', true, 'กด "ซิงก์ตอนนี้"', { enqueued }, session.user.id)
    const s = await runWorker({ mode: 'channel', channelId: id, budgetMs: 20000, forcePoll: true })
    const parts: string[] = []
    if (channel.status !== 'connected') parts.push(`ช่องทางยังไม่พร้อม (สถานะ ${channel.status}) — งานรอในคิว`)
    parts.push(`ส่งสต๊อกสำเร็จ ${s.pushed.ok} รายการ`)
    if (s.pushed.failed) parts.push(`ล้มเหลว ${s.pushed.failed}`)
    if (caps.pullOrders && channel.options.pull_orders) parts.push(`ดึงออเดอร์ ${s.polled.orders} รายการ`)
    if (s.stoppedEarly) parts.push('ยังมีงานค้าง ระบบจะทำต่อเอง')
    revalidate(id)
    return { enqueued, pushed: s.pushed.ok, failed: s.pushed.failed, ordersPulled: s.polled.orders, message: parts.join(' · ') }
  })
}

export async function runInitialPush(channelId: string): Promise<ActionResult<{ enqueued: number; pushed: number; failed: number }>> {
  return withAdmin(async () => {
    const id = uuid(channelId, 'รหัสช่องทาง')
    requireEncKey()
    const r = await sessionRpc<{ already_done: boolean; enqueued: number; channel: ChannelJson }>('mark_initial_push', { p_channel_id: id })
    const s = await runWorker({ mode: 'channel', channelId: id, budgetMs: 20000 })
    revalidate(id)
    return { enqueued: Number(r?.enqueued ?? 0), pushed: s.pushed.ok, failed: s.pushed.failed }
  })
}

// ---------------------------------------------------------------------------
// จับคู่สินค้า
// ---------------------------------------------------------------------------
export async function autoMatch(channelId: string, opts?: { refetch?: boolean }): Promise<ActionResult<AutoMatchResult & { fetched: number }>> {
  return withAdmin(async (session) => {
    const id = uuid(channelId, 'รหัสช่องทาง')
    const channel = await getChannel(id)
    const caps = PLATFORM_META[channel.platform].capabilities
    const refetch = typeof opts?.refetch === 'boolean' ? opts.refetch : caps.catalog
    let fetched = 0
    if (refetch) {
      if (!caps.catalog) fail(`ยังดึงรายการสินค้าจาก ${label(channel.platform)} ไม่ได้ในรอบนี้`)
      if (channel.status !== 'connected' && channel.status !== 'error' && channel.status !== 'paused') {
        fail('กด "ทดสอบการเชื่อมต่อ" ให้ผ่านก่อน แล้วค่อยดึงรายการสินค้า')
      }
      requireEncKey()
      const adapter = getAdapter(channel.platform)
      if (!adapter.fetchCatalog) fail('ช่องทางนี้ดึงรายการสินค้าไม่ได้')
      const workerId = 'admin-' + randomUUID()
      if (!(await store.lease(id, workerId, 120))) fail('กำลังซิงก์ช่องทางนี้อยู่ — รอสักครู่แล้วลองใหม่')
      // เผื่อเวลาเครื่องไม่ตรงกับฐานข้อมูล 1 นาที (last_seen_at ใช้เวลาของฐานข้อมูล)
      const startedAt = new Date(Date.now() - 60 * 1000)
      const t0 = Date.now()
      let complete = false
      try {
        const ctx = await store.buildContext(id, { channel })
        let cursor: string | undefined
        for (let page = 0; page < 200; page++) {
          if (Date.now() - t0 > 45000) break
          const { rows, next } = await adapter.fetchCatalog(ctx, cursor)
          for (let i = 0; i < rows.length; i += 500) {
            const chunk = rows.slice(i, i + 500)
            await store.upsertListings(id, chunk)
            fetched += chunk.length
          }
          if (!next || next === cursor) { complete = true; break }
          cursor = next
        }
        let gone = 0
        if (complete && fetched > 0) gone = await store.markGone(id, startedAt)
        await store.log(id, 'catalog', true,
          `ดึงรายการสินค้า ${fetched} รายการ${gone ? ` · หายจากแพลตฟอร์ม ${gone}` : ''}${complete ? '' : ' (ยังไม่ครบ — กดดึงอีกครั้ง)'}`,
          { fetched, complete, gone }, session.user.id, Date.now() - t0)
      } catch (e) {
        await store.log(id, 'catalog', false, `ดึงรายการสินค้าไม่สำเร็จ: ${toThai(e)}`.slice(0, 500), { fetched }, session.user.id, Date.now() - t0)
        throw e
      } finally {
        await store.release(id, workerId)
      }
    }
    const result = await sessionRpc<AutoMatchResult>('auto_match_channel_listings', { p_channel_id: id })
    revalidate(id)
    return { ...result, fetched }
  })
}

export async function setMapping(listingId: string, productId: string | null, ignore?: boolean): Promise<ActionResult<{ listing: ListingJson; affectedOrderIds: string[] }>> {
  return withAdmin(async () => {
    const lid = uuid(listingId, 'รหัสรายการ')
    const pid = productId === null || productId === undefined || productId === '' ? null : uuid(productId, 'รหัสสินค้า')
    if (ignore !== undefined && typeof ignore !== 'boolean') fail('ค่าไม่ถูกต้อง')
    const r = await sessionRpc<SetMappingResult>('set_listing_mapping', { p_listing_id: lid, p_product_id: pid, p_ignore: ignore === true })
    const { affected_order_ids, ...listing } = r
    revalidate(listing.channel_id)
    return { listing: listing as ListingJson, affectedOrderIds: Array.isArray(affected_order_ids) ? affected_order_ids : [] }
  })
}

export async function setListingOptions(listingId: string, opts: { pushEnabled?: boolean; bufferOverride?: number | null }): Promise<ActionResult<{ listing: ListingJson }>> {
  return withAdmin(async () => {
    const lid = uuid(listingId, 'รหัสรายการ')
    if (!opts || typeof opts !== 'object') fail('ค่าไม่ถูกต้อง')
    const args: Record<string, unknown> = { p_listing_id: lid, p_push_enabled: null, p_buffer_override: null, p_clear_buffer_override: false }
    if (opts.pushEnabled !== undefined) {
      if (typeof opts.pushEnabled !== 'boolean') fail('ค่าเปิด/ปิดส่งสต๊อกไม่ถูกต้อง')
      args.p_push_enabled = opts.pushEnabled
    }
    if (opts.bufferOverride === null) args.p_clear_buffer_override = true
    else if (opts.bufferOverride !== undefined) args.p_buffer_override = intIn(opts.bufferOverride, 0, 1000, 'จำนวนกันสต๊อก')
    const listing = await sessionRpc<ListingJson>('set_listing_options', args)
    revalidate(listing.channel_id)
    return { listing }
  })
}

// ---------------------------------------------------------------------------
// ออเดอร์
// ---------------------------------------------------------------------------
export async function confirmReturn(lineId: string, qtyReceived: number): Promise<ActionResult<{ order: OrderJson; restocked: number }>> {
  return withAdmin(async () => {
    const id = uuid(lineId, 'รหัสบรรทัดสินค้า')
    const qty = intIn(qtyReceived, 0, 100000, 'จำนวนที่รับคืน')
    const r = await sessionRpc<OrderJson & { restocked?: number }>('confirm_return_restock', { p_line_id: id, p_qty_received: qty })
    const { restocked, ...order } = r
    revalidate(order.channel_id)
    return { order: order as OrderJson, restocked: Number(restocked ?? 0) }
  })
}

const RESOLVE_ACTIONS: ReadonlySet<string> = new Set(['reprocess', 'waive_owed', 'track_stock', 'dismiss'])

export async function resolveOrder(orderId: string, action: ResolveOrderAction): Promise<ActionResult<{ order: OrderJson; deducted: number; restocked: number }>> {
  return withAdmin(async () => {
    const id = uuid(orderId, 'รหัสออเดอร์')
    if (typeof action !== 'string' || !RESOLVE_ACTIONS.has(action)) fail('คำสั่งไม่ถูกต้อง')
    const r = await sessionRpc<OrderJson & { deducted?: number; restocked?: number }>('resolve_channel_order', { p_order_id: id, p_action: action })
    const { deducted, restocked, ...order } = r
    revalidate(order.channel_id)
    return { order: order as OrderJson, deducted: Number(deducted ?? 0), restocked: Number(restocked ?? 0) }
  })
}

export async function retryFailed(channelId: string): Promise<ActionResult<{ requeued: number }>> {
  return withAdmin(async () => {
    const id = uuid(channelId, 'รหัสช่องทาง')
    const r = await sessionRpc<{ requeued: number; skipped?: number }>('retry_failed_outbox', { p_channel_id: id })
    revalidate(id)
    return { requeued: Number(r?.requeued ?? 0) }
  })
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
export async function exportStockCsv(channelId: string | null): Promise<ActionResult<{ filename: string; csv: string }>> {
  return withAdmin(async () => {
    let id: string | null = null
    let tag = 'all'
    if (channelId !== null && channelId !== undefined && channelId !== '') {
      id = uuid(channelId, 'รหัสช่องทาง')
      const channel = await getChannel(id)
      tag = channel.platform
    }
    const rows = await sessionRpc<ExportStockRow[]>('get_export_stock_rows', { p_channel_id: id })
    const csv = stockRowsToCsv(Array.isArray(rows) ? rows : [])
    const date = bangkokDateKey(new Date()).replace(/-/g, '') || new Date().toISOString().slice(0, 10).replace(/-/g, '')
    return { filename: `newcute-stock-${tag}-${date}.csv`, csv }
  })
}

export async function importOrdersCsv(channelId: string, csvText: string): Promise<ActionResult<{
  orders: number; created: number; unchanged: number; deducted: number; oversold: number
  errors: { row: number; orderId?: string; message: string }[]
}>> {
  return withAdmin(async (session) => {
    const id = uuid(channelId, 'รหัสช่องทาง')
    if (typeof csvText !== 'string') fail('ไฟล์ไม่ถูกต้อง')
    if (Buffer.byteLength(csvText, 'utf8') > ORDERS_CSV_MAX_BYTES) fail('ไฟล์ใหญ่เกิน 1 MB — แบ่งไฟล์ก่อนนำเข้า')
    const channel = await getChannel(id)
    const parsed = parseOrdersCsv(csvText)
    const errors: { row: number; orderId?: string; message: string }[] = parsed.errors.map(e => ({ row: e.row, ...(e.orderId ? { orderId: e.orderId } : {}), message: e.message }))
    let processed = 0
    let created = 0
    let unchanged = 0
    let deducted = 0
    let oversold = 0
    const t0 = Date.now()
    for (const order of parsed.orders) {
      if (Date.now() - t0 > 45000) {
        errors.push({ row: 0, orderId: order.external_order_id, message: 'หมดเวลา — นำเข้าไฟล์เดิมอีกครั้งเพื่อทำต่อ (ออเดอร์ที่นำเข้าแล้วจะไม่ถูกตัดซ้ำ)' })
        continue
      }
      try {
        const r = await store.recordOrder(id, order, 'csv')
        processed++
        if (r.created) created++
        else if (!r.changed) unchanged++
        deducted += Number(r.deducted ?? 0)
        if (r.has_oversold) oversold++
      } catch (e) {
        errors.push({ row: 0, orderId: order.external_order_id, message: toThai(e) })
      }
    }
    await store.log(id, 'csv', errors.length === 0,
      `นำเข้า CSV ออเดอร์ ${processed} รายการ (ใหม่ ${created}, ซ้ำ ${unchanged}) ตัดสต๊อก ${deducted} ชิ้น${oversold ? ` · ขายเกิน ${oversold} ออเดอร์` : ''}${errors.length ? ` · ผิดพลาด ${errors.length}` : ''}`,
      { orders: processed, created, unchanged, deducted, oversold, errors: errors.length, platform: channel.platform }, session.user.id, Date.now() - t0)
    revalidate(id)
    return { orders: processed, created, unchanged, deducted, oversold, errors: errors.slice(0, 500) }
  })
}

// ---------------------------------------------------------------------------
// ลิงก์ฟีด
// ---------------------------------------------------------------------------
function feedUrls(base: string, token: string): { url: string; googleUrl: string } {
  const url = `${base}/api/feed/${token}`
  return { url, googleUrl: `${url}?format=google` }
}

async function feedChannel(id: string): Promise<ChannelJson> {
  const channel = await getChannel(id)
  if (!PLATFORM_META[channel.platform].capabilities.feed) fail('ลิงก์ฟีดใช้ได้เฉพาะช่องทาง Facebook/Instagram หรือช่องทางอื่น')
  return channel
}

export async function getFeedUrl(channelId: string): Promise<ActionResult<{ url: string | null; googleUrl: string | null }>> {
  return withAdmin(async () => {
    const id = uuid(channelId, 'รหัสช่องทาง')
    const channel = await feedChannel(id)
    if (!channel.has_feed_token) return { url: null, googleUrl: null }
    requireEncKey()
    const base = requireAppBaseUrl()
    const creds = await store.loadCredentials(id)
    const token = creds.feed_token
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return { url: null, googleUrl: null }
    return feedUrls(base, token)
  })
}

export async function rotateFeedToken(channelId: string): Promise<ActionResult<{ url: string; googleUrl: string }>> {
  return withAdmin(async (session) => {
    const id = uuid(channelId, 'รหัสช่องทาง')
    await feedChannel(id)
    requireEncKey()
    const base = requireAppBaseUrl()
    const token = randomToken()
    const saved = await store.saveCredentialValues(id, { feed_token: token }, { secretNames: ['feed_token'], actor: session.user.id })
    if (!saved.ok) fail(GENERIC_ERROR)
    await store.setFeedToken(id, sha256Hex(token))
    revalidate(id)
    return feedUrls(base, token)
  })
}

export async function disableFeed(channelId: string): Promise<ActionResult<Record<never, never>>> {
  return withAdmin(async () => {
    const id = uuid(channelId, 'รหัสช่องทาง')
    await feedChannel(id)
    await store.setFeedToken(id, null)
    await store.deleteCredentials(id, ['feed_token'])
    revalidate(id)
    return {}
  })
}

// ---------------------------------------------------------------------------
// OAuth / ตัดการเชื่อมต่อ
// ---------------------------------------------------------------------------
export async function connectOAuthUrl(channelId: string): Promise<ActionResult<{ url: string }>> {
  return withAdmin(async (session) => {
    const id = uuid(channelId, 'รหัสช่องทาง')
    const channel = await getChannel(id)
    const meta = PLATFORM_META[channel.platform]
    if (!meta.capabilities.oauth) fail('ช่องทางนี้ไม่ได้เชื่อมต่อด้วยปุ่ม "เชื่อมต่อร้าน"')
    if (channel.status === 'paused') fail('ช่องทางหยุดชั่วคราวอยู่ — กด "ทำงานต่อ" ก่อน')
    requireEncKey()
    const redirectUri = callbackUrl(channel.platform)
    const have = new Set((channel.credentials ?? []).map(c => c.name))
    const missing = meta.credentialFields.filter(f => f.required && !have.has(f.name))
    if (missing.length) fail(`บันทึก ${missing.map(f => f.label).join(', ')} ก่อน แล้วค่อยกดเชื่อมต่อร้าน`)
    const adapter = getAdapter(channel.platform)
    if (!adapter.buildAuthUrl) fail('ช่องทางนี้เชื่อมต่อร้านไม่ได้')
    const ctx = await store.buildContext(id, { channel })
    const state = randomToken()
    await store.createOAuthState(id, sha256Hex(state), session.user.id)
    const url = adapter.buildAuthUrl(ctx, state, redirectUri)
    let parsed: URL
    try { parsed = new URL(url) } catch { fail(GENERIC_ERROR) }
    if (parsed.protocol !== 'https:' || !AUTH_REDIRECT_HOSTS.includes(parsed.hostname)) fail(GENERIC_ERROR)
    await store.log(id, 'oauth', true, `เริ่มเชื่อมต่อร้าน ${label(channel.platform)} (ไปหน้าอนุญาตของแพลตฟอร์ม)`, null, session.user.id)
    return { url }
  })
}

export async function disconnect(channelId: string): Promise<ActionResult<{ channel: ChannelJson }>> {
  return withAdmin(async () => {
    const id = uuid(channelId, 'รหัสช่องทาง')
    const channel = await sessionRpc<ChannelJson>('disconnect_channel', { p_channel_id: id })
    revalidate(id)
    return { channel }
  })
}
