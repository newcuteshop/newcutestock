// แท็บ "ตั้งค่า" ของช่องทาง — ประกอบจากส่วนย่อย (ไม่มี hook: render ได้จาก server component)
// มือถือเรียงลงมา: สถานะ → วิธีขอ API (ถ้ายังไม่เชื่อม) → คีย์ → ตัวเลือก → ส่งสต๊อก → ทางสำรอง → วิธีขอ API (ถ้าเชื่อมแล้ว) → ตัดการเชื่อมต่อ
// จอกว้าง (xl): ซ้าย = ตั้งค่า, ขวา = การทำงาน
import { AlertTriangle, Store } from 'lucide-react'
import { ICON } from '@/components/theme/icons'
import { formatThaiDateTime } from '@/lib/format'
import { PLATFORM_META } from '@/lib/integrations/platforms'
import type { ChannelJson, InitialPushPreview } from '@/lib/integrations/types'
import { ApprovalControls, DangerZone } from './ChannelControls'
import CredentialsForm from './CredentialsForm'
import FallbackTools from './FallbackTools'
import OptionsForm from './OptionsForm'
import SetupGuide from './SetupGuide'
import StockPushPanel from './StockPushPanel'
import { daysUntil, isPast, relativeThai, statusReasonText } from './format'

export default function SettingsTab({
  channel, urls, feed, feedError, preview, encKeyOk, nowMs,
}: {
  channel: ChannelJson
  urls: { webhook: string | null; callback: string | null; domain: string } | null
  feed: { url: string | null; googleUrl: string | null } | null
  feedError: string | null
  preview: InitialPushPreview | null
  encKeyOk: boolean
  nowMs: number
}) {
  const connected = channel.status === 'connected'
  const guide = <SetupGuide channelId={channel.id} platform={channel.platform} urls={urls} />
  const hasGuide = PLATFORM_META[channel.platform].setupSteps.length > 0 || !!urls

  return (
    <div className="grid gap-4 sm:gap-6 xl:grid-cols-2 xl:items-start">
      <div className="space-y-4 sm:space-y-6 min-w-0">
        <StatusCard channel={channel} nowMs={nowMs} />
        {!connected && hasGuide && guide}
        <ApprovalControls channel={channel} />
        <CredentialsForm channel={channel} encKeyOk={encKeyOk} />
        <OptionsForm channel={channel} />
      </div>
      <div className="space-y-4 sm:space-y-6 min-w-0">
        <StockPushPanel channel={channel} preview={preview} nowMs={nowMs} compact />
        <FallbackTools channel={channel} feed={feed} feedError={feedError} />
        {connected && hasGuide && guide}
        <DangerZone channel={channel} />
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <dt className="shrink-0 text-sm text-gray-500">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-gray-900 break-words">{children}</dd>
    </div>
  )
}

function StatusCard({ channel, nowMs }: { channel: ChannelJson; nowMs: number }) {
  const meta = PLATFORM_META[channel.platform]
  const authDays = daysUntil(channel.auth_expires_at, nowMs)
  const reason = statusReasonText(channel.status_reason)
  const pausedUntil = channel.paused_until && !isPast(channel.paused_until, nowMs) ? channel.paused_until : null

  return (
    <section className="card p-4 sm:p-5 space-y-3" aria-labelledby={`status-${channel.id}`}>
      {/* ป้ายสถานะอยู่ที่หัวหน้าแล้ว (ChannelHeader) — การ์ดนี้แสดงรายละเอียด */}
      <h2 id={`status-${channel.id}`} className="section-title">
        <Store {...ICON} className="text-brand-600" />
        สถานะการเชื่อมต่อ
      </h2>
      {reason && channel.status !== 'connected' && (
        <p className="text-sm text-gray-700">{reason}</p>
      )}
      {meta.phase === 'auth_only' && (
        <p className="text-sm text-amber-800">
          รออนุมัติ API จากแพลตฟอร์ม — รอบนี้เชื่อมร้านได้ แต่ยังไม่ส่งสต๊อก/ดึงออเดอร์อัตโนมัติ
        </p>
      )}

      <dl className="divide-y divide-blush-hair">
        <Row label="ร้าน">
          {channel.external_shop_name || channel.external_shop_id
            ? <>{channel.external_shop_name ?? ''}{channel.external_shop_id ? <span className="block text-xs font-mono text-gray-500 break-all">{channel.external_shop_id}</span> : null}</>
            : <span className="text-gray-500">ยังไม่ทราบ</span>}
        </Row>
        <Row label="ทดสอบล่าสุด">
          {channel.last_test_at
            ? <span className={channel.last_test_ok ? 'text-green-800' : 'text-red-700'}>
                {channel.last_test_ok ? 'ผ่าน' : 'ไม่ผ่าน'} · {relativeThai(channel.last_test_at, nowMs)}
              </span>
            : <span className="text-gray-500">ยังไม่เคยทดสอบ</span>}
        </Row>
        <Row label="ซิงก์ล่าสุด">{channel.last_sync_at ? relativeThai(channel.last_sync_at, nowMs) : <span className="text-gray-500">ยังไม่เคย</span>}</Row>
        {channel.token_expires_at && (
          <Row label="โทเคนหมดอายุ">
            {formatThaiDateTime(channel.token_expires_at)}
            <span className="block text-xs text-gray-500">ระบบต่ออายุให้เอง</span>
          </Row>
        )}
        {channel.auth_expires_at && (
          <Row label="การอนุญาตร้านหมดอายุ">
            <span className={authDays !== null && authDays < 14 ? 'font-semibold text-red-700' : undefined}>
              {formatThaiDateTime(channel.auth_expires_at)}
            </span>
            {authDays !== null && authDays < 14 && (
              <span className="block text-xs text-red-700">
                {authDays < 0 ? 'หมดอายุแล้ว — กดเชื่อมต่อด้วยบัญชีร้านใหม่' : `เหลือ ${authDays} วัน — กดเชื่อมต่อด้วยบัญชีร้านอีกครั้งก่อนหมด`}
              </span>
            )}
          </Row>
        )}
        {pausedUntil && (
          <Row label="พักอัตโนมัติถึง">{formatThaiDateTime(pausedUntil)}</Row>
        )}
      </dl>

      {channel.last_error && (
        <div role="alert" className="alert-err">
          <AlertTriangle size={18} strokeWidth={1.9} aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold">ข้อผิดพลาดล่าสุด{channel.last_error_at ? ` · ${relativeThai(channel.last_error_at, nowMs)}` : ''}</p>
            <p className="break-words">{channel.last_error}</p>
            {channel.consecutive_failures > 1 && (
              <p className="mt-1 text-xs">ล้มเหลวติดกัน {channel.consecutive_failures} รอบ</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
