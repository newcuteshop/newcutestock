// /api/integrations/<shopee|lazada|tiktok>/callback — ปลายทาง OAuth หลังร้านกด "อนุญาต" ในหน้าของแพลตฟอร์ม
// ไม่ใช้ session/คุกกี้: เชื่อ state ที่สุ่มจาก server action เท่านั้น (เก็บแค่ sha256, ใช้ได้ครั้งเดียว, 10 นาที)
// ไม่เอาข้อความ error ของแพลตฟอร์มใส่ URL — พากลับหน้าตั้งค่าพร้อมรหัสสั้น ?error=state|denied|exchange|shop / ?connected=1
import type { ChannelJson, ConnectResult, Platform } from '@/lib/integrations/types'
import { isPlatform, PLATFORM_META } from '@/lib/integrations/platforms'
import { getAdapter } from '@/lib/integrations/registry'
import {
  buildContext, consumeOAuthState, loadChannel, log, requestResync, saveTokens, updateChannel,
} from '@/lib/integrations/store'
import { sha256Hex } from '@/lib/integrations/crypto'
import { appBaseUrl, callbackUrl } from '@/lib/integrations/env'
import { isDbError, isPlatformError, statusReasonFor } from '@/lib/integrations/errors'
import { logError } from '@/lib/integrations/redact'
import type { TestResult } from '@/lib/integrations/adapters/common'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const OAUTH_PLATFORMS: ReadonlySet<Platform> = new Set<Platform>(['shopee', 'lazada', 'tiktok'])

function cleanSettings(s: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!s) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s)) if (v !== null && v !== undefined && v !== '') out[k] = v
  return Object.keys(out).length ? out : undefined
}

export async function GET(req: Request, { params }: { params: { platform: string } }): Promise<Response> {
  const platform = params.platform
  const origin = appBaseUrl() ?? new URL(req.url).origin
  const go = (path: string) => new Response(null, {
    status: 303,
    headers: { Location: origin + path, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })
  if (!isPlatform(platform) || !OAUTH_PLATFORMS.has(platform)) return new Response(null, { status: 404 })

  const q = new URL(req.url).searchParams
  const state = q.get('state') ?? ''
  if (!state || state.length > 200 || !/^[A-Za-z0-9_-]+$/.test(state)) return go('/settings/integrations?error=state')

  let consumed: Awaited<ReturnType<typeof consumeOAuthState>>
  try {
    consumed = await consumeOAuthState(sha256Hex(state))
  } catch (e) {
    logError('oauth_state', e)
    return go('/settings/integrations?error=state')
  }
  if (!consumed || consumed.platform !== platform) return go('/settings/integrations?error=state')

  const channelId = consumed.channel_id
  const actor = consumed.created_by ?? null
  const detail = `/settings/integrations/${encodeURIComponent(channelId)}`
  const label = PLATFORM_META[platform].label

  const code = q.get('code')
  if (q.get('error') || !code) {
    await log(channelId, 'oauth', false, `ร้านไม่ได้กดอนุญาตให้เชื่อมต่อ ${label}`, null, actor)
    return go(`${detail}?error=denied`)
  }

  const adapter = getAdapter(platform)
  const t0 = Date.now()
  let result: ConnectResult
  try {
    if (!adapter.exchangeCode) throw new Error('exchangeCode missing')
    const ctx = await buildContext(channelId)
    result = await adapter.exchangeCode(ctx, q, callbackUrl(platform))
    await saveTokens(channelId, result)
  } catch (e) {
    logError('oauth_exchange', e)
    const msg = isPlatformError(e) ? e.message : 'แลกรหัสอนุญาตเป็นโทเคนไม่สำเร็จ'
    await log(channelId, 'oauth', false, `เชื่อมต่อร้าน ${label} ไม่สำเร็จ: ${msg}`.slice(0, 500), null, actor, Date.now() - t0)
    return go(`${detail}?error=exchange`)
  }

  // ข้อมูลร้าน (ต้องมี external_shop_id ก่อนทดสอบ เพราะ API ของร้านใช้รหัสร้านเซ็นคำขอ)
  let channel: ChannelJson
  try {
    const patch: Record<string, unknown> = {}
    if (result.shop_id) patch.external_shop_id = result.shop_id
    if (result.shop_name) patch.external_shop_name = result.shop_name
    const settings = cleanSettings(result.settings)
    if (settings) patch.settings_merge = settings
    channel = Object.keys(patch).length ? await updateChannel(channelId, patch) : await loadChannel(channelId)
  } catch (e) {
    logError('oauth_shop', e)
    const dup = isDbError(e) && e.code === '23505'
    await log(channelId, 'oauth', false, dup ? `ร้าน ${label} นี้เชื่อมกับช่องทางอื่นในระบบอยู่แล้ว` : `บันทึกข้อมูลร้าน ${label} ไม่สำเร็จ`, null, actor)
    return go(`${detail}?error=shop`)
  }

  let test: TestResult
  try {
    test = await adapter.testConnection(await buildContext(channelId, { channel })) as TestResult
  } catch (e) {
    test = { ok: false, message: isPlatformError(e) ? e.message : 'ทดสอบร้านไม่สำเร็จ', reason: statusReasonFor(e) }
  }
  if (!test.ok) {
    try {
      await updateChannel(channelId, { status: 'error', status_reason: test.reason ?? 'platform_error', last_error: test.message, last_test_ok: false })
    } catch (e) {
      logError('oauth_test_status', e)
    }
    await log(channelId, 'oauth', false, `ได้โทเคนแล้วแต่ทดสอบร้านไม่ผ่าน: ${test.message}`.slice(0, 500), null, actor, Date.now() - t0)
    return go(`${detail}?error=shop`)
  }

  try {
    const patch: Record<string, unknown> = {
      status: 'connected', status_reason: null, last_error: null, consecutive_failures: 0, last_test_ok: true,
    }
    if (test.shop_name && !result.shop_name) patch.external_shop_name = test.shop_name
    const settings = cleanSettings(test.settings)
    if (settings) patch.settings_merge = settings
    channel = await updateChannel(channelId, patch)
  } catch (e) {
    logError('oauth_connected', e)
    return go(`${detail}?error=shop`)
  }

  const name = channel.external_shop_name ?? result.shop_name ?? ''
  await log(channelId, 'oauth', true, `เชื่อมต่อร้าน ${label}${name ? ' "' + name + '"' : ''} สำเร็จ`, { shop_id: channel.external_shop_id }, actor, Date.now() - t0)

  // เคยส่งสต๊อกครั้งแรกไปแล้ว (เชื่อมใหม่หลังหลุด) → ส่งสต๊อกทั้งหมดซ้ำให้ตรงกัน
  if (channel.options?.initial_push_done && channel.options?.push_stock) {
    try {
      await requestResync(channelId)
    } catch (e) {
      logError('oauth_resync', e)
    }
  }
  return go(`${detail}?connected=1`)
}
