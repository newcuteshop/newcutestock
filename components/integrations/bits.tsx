// ===== ชิ้นส่วนหน้าตาเล็กๆ ของหน้า "ตั้งค่าการเชื่อมต่อ" =====
// ไม่มี hook / ไม่มี 'use client' → ใช้ได้ทั้ง server component และ client component
import clsx from 'clsx'
import {
  AlertTriangle, CheckCircle2, EyeOff, Hourglass, Link2, Link2Off, PackageX, PauseCircle, Unplug, XCircle,
  type LucideIcon,
} from 'lucide-react'
import {
  ATTENTION_LABELS, CHANNEL_STATUS_LABELS, ORDER_STATUS_LABELS, PLATFORM_META,
} from '@/lib/integrations/platforms'
import type {
  AttentionReason, ChannelStatus, MappingStatus, OrderStatus, Platform,
} from '@/lib/integrations/types'

// ป้ายสถานะ (แคปซูลเล็ก สูง 24px เท่า .chip / .badge-*)
const PILL = 'inline-flex items-center gap-1 h-6 px-2.5 rounded-full border text-xs font-medium leading-none whitespace-nowrap'

// ----- อักษรย่อแพลตฟอร์มในกล่องโรสโกลด์อ่อน (ไม่ใช้โลโก้แบรนด์) -----
export function PlatformBadge({ platform, size = 'md' }: { platform: Platform; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'icon-bubble font-semibold text-gray-900',
        size === 'sm' ? 'icon-bubble-sm text-sm' : 'text-base',
      )}
    >
      {PLATFORM_META[platform].badge}
    </span>
  )
}

// ----- สถานะช่องทาง -----
const STATUS_STYLE: Record<ChannelStatus, { cls: string; icon: LucideIcon }> = {
  connected: { cls: 'border-green-200 bg-green-50 text-green-800', icon: CheckCircle2 },
  pending_approval: { cls: 'border-amber-200 bg-amber-50 text-amber-800', icon: Hourglass },
  error: { cls: 'border-red-200 bg-red-50 text-red-800', icon: AlertTriangle },
  paused: { cls: 'border-gray-300 bg-white text-gray-700', icon: PauseCircle },
  disconnected: { cls: 'border-gray-200 bg-gray-50 text-gray-600', icon: Unplug },
}

export function ChannelStatusPill({ status }: { status: ChannelStatus }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.disconnected
  const Icon = s.icon
  return (
    <span className={clsx(PILL, s.cls)}>
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      {CHANNEL_STATUS_LABELS[status] ?? status}
    </span>
  )
}

export function EnvPill() {
  return <span className={clsx(PILL, 'border-amber-200 bg-amber-50 text-amber-800')}>ร้านทดสอบ (Sandbox)</span>
}

// ----- สถานะการจับคู่ของรายการบนแพลตฟอร์ม -----
const MAPPING_STYLE: Record<MappingStatus, { label: string; cls: string; icon: LucideIcon }> = {
  mapped: { label: 'จับคู่แล้ว', cls: 'border-green-200 bg-green-50 text-green-800', icon: Link2 },
  unmapped: { label: 'ยังไม่จับคู่', cls: 'border-amber-200 bg-amber-50 text-amber-800', icon: Link2Off },
  conflict: { label: 'SKU ซ้ำหลายสินค้า', cls: 'border-red-200 bg-red-50 text-red-800', icon: AlertTriangle },
  ignored: { label: 'ไม่ซิงก์', cls: 'border-gray-200 bg-gray-50 text-gray-600', icon: EyeOff },
  gone: { label: 'หายจากแพลตฟอร์ม', cls: 'border-gray-200 bg-gray-50 text-gray-600', icon: XCircle },
}

export function MappingPill({ status }: { status: MappingStatus }) {
  const s = MAPPING_STYLE[status] ?? MAPPING_STYLE.unmapped
  const Icon = s.icon
  return (
    <span className={clsx(PILL, s.cls)}>
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      {s.label}
    </span>
  )
}

// ----- สถานะออเดอร์ -----
const ORDER_TONE: Partial<Record<OrderStatus, string>> = {
  completed: 'border-green-200 bg-green-50 text-green-800',
  cancelled: 'border-gray-200 bg-gray-50 text-gray-600',
  expired: 'border-gray-200 bg-gray-50 text-gray-600',
  cancel_pending: 'border-amber-200 bg-amber-50 text-amber-800',
  return_requested: 'border-amber-200 bg-amber-50 text-amber-800',
  returned: 'border-amber-200 bg-amber-50 text-amber-800',
  unknown: 'border-red-200 bg-red-50 text-red-800',
}

export function OrderStatusPill({ status }: { status: OrderStatus }) {
  return (
    <span className={clsx(PILL, ORDER_TONE[status] ?? 'border-brand-200 bg-brand-50 text-brand-800')}>
      {ORDER_STATUS_LABELS[status] ?? status}
    </span>
  )
}

export function AttentionPill({ reason }: { reason: AttentionReason }) {
  const oversold = reason === 'oversold'
  return (
    <span
      className={clsx(
        PILL,
        oversold ? 'border-red-600 bg-red-600 text-white' : 'border-amber-200 bg-amber-50 text-amber-800',
      )}
    >
      {oversold ? <PackageX size={14} strokeWidth={2} aria-hidden="true" /> : <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />}
      {ATTENTION_LABELS[reason] ?? reason}
    </span>
  )
}

// ----- ตัวเลขสรุปเล็กๆ ในการ์ด -----
export function MiniStat({ label, value, tone = 'normal' }: { label: string; value: React.ReactNode; tone?: 'normal' | 'bad' | 'warn' }) {
  return (
    <div className="panel px-3 py-2 min-w-0">
      <p className="text-xs text-gray-500 truncate">{label}</p>
      <p
        className={clsx(
          'font-semibold tabular-nums leading-tight text-base truncate',
          tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-gray-900',
        )}
      >
        {value}
      </p>
    </div>
  )
}

// ----- ข้อความผลการทำรายการ (ok = เขียว, ไม่ ok = แดง) -----
export type Flash = { ok: boolean; text: string }

export function FlashMessage({ flash, className }: { flash: Flash | null; className?: string }) {
  if (!flash) return null
  return (
    <div role={flash.ok ? 'status' : 'alert'} className={clsx(flash.ok ? 'alert-ok' : 'alert-err', className)}>
      {flash.ok ? <CheckCircle2 size={18} strokeWidth={1.9} aria-hidden="true" /> : <XCircle size={18} strokeWidth={1.9} aria-hidden="true" />}
      <p className="min-w-0 break-words">{flash.text}</p>
    </div>
  )
}
