import { notFound } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/permissions'
import { thaiError } from '@/lib/format'
import { PLATFORM_META, SYNC_LOG_KIND_LABELS, platformUrls } from '@/lib/integrations/platforms'
import type {
  ChannelJson, InitialPushPreview, ListingFilter, ListingPage, OrderListFilter, OrderPage, SyncLogKind, SyncLogPage,
} from '@/lib/integrations/types'
import { getFeedUrl } from '@/app/(dashboard)/settings/integrations/actions'
import ChannelHeader, { CHANNEL_TABS, type ChannelTab } from '@/components/integrations/ChannelHeader'
import { firstParam, isUuid } from '@/components/integrations/format'
import { appBaseUrl, channelNotFound, encKeyConfigured, migrationMissing, shopeePushUrl } from '@/components/integrations/serverChecks'
import SettingsTab from '@/components/integrations/SettingsTab'
import MappingTab from '@/components/integrations/MappingTab'
import OrdersTab from '@/components/integrations/OrdersTab'
import SyncLogTab from '@/components/integrations/SyncLogTab'

export const dynamic = 'force-dynamic'
// server action ของหน้านี้ (ซิงก์ตอนนี้ / ส่งสต๊อกครั้งแรก / จับคู่อัตโนมัติ / นำเข้า CSV) ทำงานในฟังก์ชันของหน้านี้
// และใช้เวลาได้ถึง ~45 วินาที — ขยายเพดาน ไม่ให้ถูกตัดกลางทาง (นำเข้าครึ่งเดียว / lease ค้างจนหมดเวลา)
export const maxDuration = 60

const LISTING_FILTERS: ListingFilter[] = ['all', 'mapped', 'unmapped', 'conflict', 'ignored', 'gone', 'errors', 'todo']
const ORDER_FILTERS: OrderListFilter[] = ['all', 'attention', 'oversold', 'unmapped', 'return', 'shadow', 'open']

// ?error= จาก OAuth callback — รหัสสั้นเท่านั้น
const ERROR_TEXT: Record<string, string> = {
  state: 'ลิงก์เชื่อมต่อหมดอายุหรือถูกใช้แล้ว กรุณากดเชื่อมต่อใหม่',
  denied: 'ร้านไม่ได้กดอนุญาต',
  exchange: 'เชื่อมต่อไม่สำเร็จ ดูบันทึกการซิงก์',
  shop: 'เชื่อมต่อไม่สำเร็จ ดูบันทึกการซิงก์',
}

function pick<T extends string>(v: string, list: readonly T[], fallback: T): T {
  return (list as readonly string[]).includes(v) ? (v as T) : fallback
}

export default async function ChannelPage({
  params, searchParams,
}: {
  params: { channelId: string }
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  await requireAdmin()
  const channelId = params.channelId
  if (!isUuid(channelId)) notFound()

  const supabase = createClient()
  const { data, error } = await supabase.rpc('get_integration_channel', { p_channel_id: channelId })
  if (error) {
    if (channelNotFound(error)) notFound()
    if (migrationMissing(error)) throw new Error('ฐานข้อมูลยังไม่มีระบบเชื่อมต่อ — รันไฟล์ supabase-fix-03-integrations.sql ก่อน')
    throw new Error(thaiError(error))
  }
  const channel = data as ChannelJson | null
  if (!channel || typeof channel !== 'object' || !channel.id) notFound()

  const meta = PLATFORM_META[channel.platform]
  const tab = pick<ChannelTab>(firstParam(searchParams.tab), CHANNEL_TABS, 'settings')
  const nowMs = Date.now()
  const connectedNotice = firstParam(searchParams.connected) === '1'
  const errorText = ERROR_TEXT[firstParam(searchParams.error)] ?? null
  const needPreview = meta.capabilities.pushStock && !channel.options.initial_push_done

  async function loadPreview(): Promise<InitialPushPreview | null> {
    if (!needPreview) return null
    const r = await supabase.rpc('get_initial_push_preview', { p_channel_id: channel!.id })
    return r.error || !r.data ? null : (r.data as InitialPushPreview)
  }

  let content: React.ReactNode
  if (tab === 'settings') {
    const base = appBaseUrl()
    const urls = base ? platformUrls(channel.platform, base) : null
    // Shopee เซ็นลายเซ็น push ด้วย URL ที่ลงทะเบียนไว้ตรงตัว — แสดงค่าเดียวกับที่ webhook ใช้ตรวจลายเซ็น (env.shopeePushUrl)
    if (urls && channel.platform === 'shopee') urls.webhook = shopeePushUrl() ?? urls.webhook
    let feed: { url: string | null; googleUrl: string | null } | null = { url: null, googleUrl: null }
    let feedError: string | null = null
    if (meta.capabilities.feed && channel.has_feed_token) {
      try {
        const r = await getFeedUrl(channel.id)
        if (r.ok) feed = { url: r.url, googleUrl: r.googleUrl }
        else { feed = null; feedError = r.error }
      } catch {
        feed = null
        feedError = 'โหลดลิงก์ฟีดไม่ได้ กรุณาลองใหม่'
      }
    }
    const preview = await loadPreview()
    content = (
      <>
        {!base && (meta.webhookPath || meta.callbackPath || meta.capabilities.feed) && (
          <div role="alert" className="alert-warn">
            <AlertTriangle {...ICON_SM} />
            <p className="min-w-0">ยังไม่ได้ตั้งค่า APP_BASE_URL บน Vercel — แสดง URL webhook/callback/ฟีดไม่ได้</p>
          </div>
        )}
        <SettingsTab
          channel={channel}
          urls={urls}
          feed={feed}
          feedError={feedError}
          preview={preview}
          encKeyOk={encKeyConfigured()}
          nowMs={nowMs}
        />
      </>
    )
  } else if (tab === 'mapping') {
    const filter = pick<ListingFilter>(firstParam(searchParams.filter), LISTING_FILTERS, 'all')
    const q = firstParam(searchParams.q).trim().slice(0, 100)
    const [lr, preview] = await Promise.all([
      supabase.rpc('list_channel_listings', {
        p_channel_id: channel.id, p_filter: filter, p_search: q || null, p_limit: 100, p_offset: 0,
      }),
      loadPreview(),
    ])
    content = (
      <MappingTab
        key={`${filter}|${q}`}
        channel={channel}
        page={lr.error ? null : (lr.data as ListingPage)}
        filter={filter}
        q={q}
        preview={preview}
        nowMs={nowMs}
        loadError={lr.error ? thaiError(lr.error) : null}
      />
    )
  } else if (tab === 'orders') {
    const filter = pick<OrderListFilter>(firstParam(searchParams.filter), ORDER_FILTERS, 'all')
    const r = await supabase.rpc('list_channel_orders', {
      p_channel_id: channel.id, p_filter: filter, p_limit: 50, p_before: null,
    })
    content = (
      <OrdersTab
        key={filter}
        channel={channel}
        page={r.error ? null : (r.data as OrderPage)}
        filter={filter}
        loadError={r.error ? thaiError(r.error) : null}
      />
    )
  } else {
    const kindRaw = firstParam(searchParams.kind)
    const kind = Object.prototype.hasOwnProperty.call(SYNC_LOG_KIND_LABELS, kindRaw) ? (kindRaw as SyncLogKind) : null
    const onlyErrors = firstParam(searchParams.errors) === '1'
    const r = await supabase.rpc('list_sync_log', {
      p_channel_id: channel.id, p_kind: kind, p_only_errors: onlyErrors, p_limit: 100, p_before_id: null,
    })
    content = (
      <SyncLogTab
        key={`${kind ?? ''}|${onlyErrors ? 1 : 0}`}
        channel={channel}
        page={r.error ? null : (r.data as SyncLogPage)}
        kind={kind}
        onlyErrors={onlyErrors}
        loadError={r.error ? thaiError(r.error) : null}
      />
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <ChannelHeader channel={channel} tab={tab} connectedNotice={connectedNotice} errorText={errorText} />
      {content}
    </div>
  )
}
