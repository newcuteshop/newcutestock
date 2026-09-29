// หัวหน้ารายละเอียดช่องทาง: ลิงก์กลับ + ชื่อร้าน + สถานะ + แท็บ (ลิงก์ ?tab=) — ไม่มี hook ใช้ได้จาก server component
import Link from 'next/link'
import clsx from 'clsx'
import { ArrowLeft, CheckCircle2, History, Link2, Settings2, ShoppingBag, XCircle, type LucideIcon } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { PLATFORM_META } from '@/lib/integrations/platforms'
import type { ChannelJson } from '@/lib/integrations/types'
import { ChannelStatusPill, EnvPill, PlatformBadge } from './bits'

export type ChannelTab = 'settings' | 'mapping' | 'orders' | 'log'
export const CHANNEL_TABS: readonly ChannelTab[] = ['settings', 'mapping', 'orders', 'log'] as const

const TABS: { value: ChannelTab; label: string; short: string; icon: LucideIcon }[] = [
  { value: 'settings', label: 'ตั้งค่า', short: 'ตั้งค่า', icon: Settings2 },
  { value: 'mapping', label: 'จับคู่สินค้า', short: 'จับคู่สินค้า', icon: Link2 },
  { value: 'orders', label: 'ออเดอร์', short: 'ออเดอร์', icon: ShoppingBag },
  { value: 'log', label: 'บันทึกการซิงก์', short: 'บันทึก', icon: History },
]

export default function ChannelHeader({
  channel, tab, connectedNotice = false, errorText = null,
}: {
  channel: ChannelJson
  tab: ChannelTab
  connectedNotice?: boolean
  errorText?: string | null
}) {
  const meta = PLATFORM_META[channel.platform]
  const basePath = `/settings/integrations/${channel.id}`
  // ชื่อร้านเป็นค่าเริ่มต้น (= ชื่อแพลตฟอร์ม) → ไม่แสดงชื่อแพลตฟอร์มซ้ำ
  const subtitle = [channel.display_name !== meta.label ? meta.label : null, channel.external_shop_name].filter(Boolean).join(' · ')
  const counts = channel.counts
  const badge: Partial<Record<ChannelTab, number>> = {
    mapping: (counts?.unmapped ?? 0) + (counts?.conflict ?? 0),
    orders: counts?.orders_attention ?? 0,
  }

  return (
    <>
      <div className="space-y-1">
        <Link href="/settings/integrations" className="link -ml-1 px-1 text-sm">
          <ArrowLeft {...ICON_SM} />
          ตั้งค่าการเชื่อมต่อ
        </Link>
        <div className="page-header">
          <div className="flex min-w-0 items-center gap-3">
            <PlatformBadge platform={channel.platform} />
            <div className="min-w-0">
              <h1 className="page-title break-words">{channel.display_name}</h1>
              {subtitle && <p className="page-subtitle break-words">{subtitle}</p>}
            </div>
          </div>
          <div className="page-actions">
            {channel.environment === 'sandbox' && <EnvPill />}
            <ChannelStatusPill status={channel.status} />
          </div>
        </div>
      </div>

      {connectedNotice && (
        <div role="status" className="alert-ok">
          <CheckCircle2 {...ICON_SM} />
          <p className="min-w-0">เชื่อมต่อร้านสำเร็จ</p>
        </div>
      )}
      {errorText && (
        <div role="alert" className="alert-err">
          <XCircle {...ICON_SM} />
          <p className="min-w-0">{errorText}</p>
        </div>
      )}

      {/* แท็บ = ลิงก์ (สถานะอยู่ใน URL) — มือถือ 2×2 ปุ่มใหญ่ */}
      <nav aria-label="เมนูของช่องทาง">
        <ul className="grid grid-cols-2 gap-1 rounded-[26px] border-2 border-blush-line bg-white p-1 sm:inline-flex sm:rounded-full">
          {TABS.map(t => {
            const active = t.value === tab
            const Icon = t.icon
            const n = badge[t.value] ?? 0
            return (
              <li key={t.value}>
                <Link
                  href={t.value === 'settings' ? basePath : `${basePath}?tab=${t.value}`}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(
                    'flex min-h-[44px] items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-[transform,background-color] duration-200 active:scale-[0.97]',
                    active ? 'bg-brand-600 text-white' : 'text-brand-800 hover:bg-gray-50',
                  )}
                >
                  <Icon size={16} strokeWidth={2} aria-hidden="true" />
                  <span className="sm:hidden">{t.short}</span>
                  <span className="hidden sm:inline">{t.label}</span>
                  {n > 0 && (
                    <span
                      className={clsx(
                        'inline-grid min-w-[1.5rem] place-items-center rounded-full px-1.5 text-xs font-bold tabular-nums leading-5',
                        active ? 'bg-white text-brand-700' : 'bg-red-600 text-white',
                      )}
                    >
                      <span className="sr-only">ต้องจัดการ </span>
                      {n > 99 ? '99+' : n}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </>
  )
}
