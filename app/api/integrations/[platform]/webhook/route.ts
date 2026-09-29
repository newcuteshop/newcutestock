// /api/integrations/<platform>/webhook — รับ webhook จาก LINE SHOPPING / Shopee / Lazada / TikTok Shop
// 1) อ่าน body ดิบครั้งเดียว (≤ 1 MB) → 2) ตรวจลายเซ็นกับคีย์ของทุกช่องทางของแพลตฟอร์มนั้น (≤ 5) แบบเวลาคงที่ ก่อน JSON.parse
// 3) เก็บ event (กันซ้ำด้วยรหัส event) → 4) ตอบ 200 ว่างทันที แล้วประมวลผลต่อเบื้องหลัง (หรือรอบ cron ถัดไป)
// ลายเซ็นผิด → 401 (นับใน sync log ไม่เก็บ body) / ฐานข้อมูลล่ม → 503 (แพลตฟอร์มส่งซ้ำ + ดึงออเดอร์ตามรอบจะเก็บตก)
// ไม่มีการกันด้วย IP (LINE ห้าม) — เชื่อลายเซ็นอย่างเดียว
import type { Platform } from '@/lib/integrations/types'
import { isPlatform } from '@/lib/integrations/platforms'
import { getAdapter } from '@/lib/integrations/registry'
import { listChannelsLite, loadCredentials, log, recordEvent, type ChannelLite } from '@/lib/integrations/store'
import { isDbError } from '@/lib/integrations/errors'
import { logError, redact } from '@/lib/integrations/redact'
import { runInBackground } from '@/lib/integrations/background'
import { runWorker } from '@/lib/integrations/worker'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MAX_BODY = 1024 * 1024
const MAX_CANDIDATES = 5
const LIVE_STATUSES = new Set(['connected', 'error', 'paused'])
const STATUS_ORDER: Record<string, number> = { connected: 0, error: 1, paused: 2, pending_approval: 3, disconnected: 4 }

/** บันทึกลายเซ็นผิดได้ไม่เกิน 1 แถวต่อแพลตฟอร์มต่อนาที (กันคนยิงถล่มจนตาราง log บวม) */
const badSigLoggedAt = new Map<string, number>()

function empty(status: number): Response {
  // Shopee ต้องการ 200 ที่ body ว่างจริงๆ — ทุกแพลตฟอร์มใช้แบบเดียวกัน
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } })
}

async function noteBadSignature(platform: Platform, candidates: ChannelLite[]): Promise<void> {
  const now = Date.now()
  const last = badSigLoggedAt.get(platform) ?? 0
  if (now - last < 60000) return
  badSigLoggedAt.set(platform, now)
  const channelId = candidates.length === 1 ? candidates[0].id : null
  await log(channelId, 'webhook', false, `ได้รับ webhook ที่ลายเซ็นไม่ถูกต้อง (${platform}) — ไม่ได้บันทึกข้อมูล`,
    { candidates: candidates.length })
}

export async function POST(req: Request, { params }: { params: { platform: string } }): Promise<Response> {
  const platform = params.platform
  if (!isPlatform(platform) || platform === 'meta' || platform === 'generic') return empty(404)
  const adapter = getAdapter(platform)
  if (!adapter.verifyWebhook || !adapter.parseWebhook) return empty(404)

  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY) return empty(413)
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return empty(400)
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY) return empty(413)

  let candidates: ChannelLite[]
  try {
    candidates = (await listChannelsLite())
      .filter(c => c.platform === platform)
      .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9))
      .slice(0, MAX_CANDIDATES)
  } catch (e) {
    logError('webhook_channels', e)
    return empty(503)
  }

  let matched: ChannelLite | null = null
  for (const c of candidates) {
    let creds: Record<string, string>
    try {
      creds = await loadCredentials(c.id)
    } catch (e) {
      if (isDbError(e) && e.retryable) { logError('webhook_credentials', e); return empty(503) }
      logError('webhook_credentials', e) // เช่น INTEGRATIONS_ENC_KEY ผิด — ลองช่องทางอื่นต่อ
      continue
    }
    let ok = false
    try {
      ok = adapter.verifyWebhook({ rawBody: raw, headers: req.headers, url: req.url }, creds)
    } catch {
      ok = false
    }
    if (ok) { matched = c; break }
  }
  if (!matched) {
    await noteBadSignature(platform, candidates)
    return empty(401)
  }

  let events
  try {
    events = adapter.parseWebhook(raw, req.headers)
  } catch (e) {
    await log(matched.id, 'webhook', false, 'webhook ลายเซ็นถูกต้องแต่รูปแบบข้อมูลอ่านไม่ได้', null)
    logError('webhook_parse', e)
    return empty(400)
  }

  // ช่องทางยังไม่ได้เชื่อมต่อ (เช่น แพลตฟอร์มกดปุ่ม Verify ตอนตั้งค่า Push URL) → ตอบ 200 แต่ไม่เก็บอะไร
  if (!LIVE_STATUSES.has(matched.status)) return empty(200)

  let fresh = 0
  for (const ev of events.slice(0, 50)) {
    try {
      const r = await recordEvent(matched.id, { ...ev, payload: redact(ev.payload) })
      if (!r.duplicate) fresh++
    } catch (e) {
      logError('record_inbound_event', e)
      if (isDbError(e) && e.retryable) return empty(503)
      await log(matched.id, 'webhook', false, `เก็บ webhook ไม่ได้: ${isDbError(e) ? e.message.slice(0, 200) : 'ข้อมูลไม่ถูกต้อง'}`,
        { event_id: ev.event_id, event_type: ev.event_type })
    }
  }

  if (fresh > 0) {
    const channelId = matched.id
    runInBackground(() => runWorker({ mode: 'channel', channelId, budgetMs: 8000 }))
  }
  return empty(200)
}
