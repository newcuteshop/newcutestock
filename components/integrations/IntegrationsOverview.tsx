'use client'
// หน้ารวม "ตั้งค่าการเชื่อมต่อ": 1 การ์ดต่อแพลตฟอร์ม (ยังไม่ตั้งค่า = การ์ดเริ่มตั้งค่า / มีร้านแล้ว = การ์ดต่อร้าน)
// โหลดครั้งเดียว + ปุ่มรีเฟรช (ไม่มีตัวจับเวลา poll)
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  AlertTriangle, ChevronDown, Clock, Hourglass, Loader2, LogIn, PackageX, Plus, RefreshCw, Settings2, Unplug,
} from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { PLATFORM_META } from '@/lib/integrations/platforms'
import { PLATFORMS, type ChannelEnvironment, type ChannelJson, type IntegrationAlerts, type Platform } from '@/lib/integrations/types'
import {
  connectOAuthUrl, createChannel, disconnect, syncNow,
} from '@/app/(dashboard)/settings/integrations/actions'
import { ChannelStatusPill, EnvPill, FlashMessage, MiniStat, PlatformBadge, type Flash } from './bits'
import ConfirmDialog from './ConfirmDialog'
import { daysUntil, qty, relativeThai } from './format'
import { callAction, useRunner } from './useAction'
import { safeAuthUrl } from './authUrl'

function detailHref(id: string, tab?: string, filter?: string) {
  const sp = new URLSearchParams()
  if (tab) sp.set('tab', tab)
  if (filter) sp.set('filter', filter)
  const qs = sp.toString()
  return `/settings/integrations/${id}${qs ? `?${qs}` : ''}`
}

// ช่องทางแรกที่ต้องดูแล → ลิงก์แท็บออเดอร์ตามตัวกรอง
function firstAttention(channels: ChannelJson[]): { href: string } | null {
  const order: { key: 'oversold_orders' | 'unmapped_orders' | 'return_to_confirm' | 'orders_attention'; filter: string }[] = [
    { key: 'oversold_orders', filter: 'oversold' },
    { key: 'unmapped_orders', filter: 'unmapped' },
    { key: 'return_to_confirm', filter: 'return' },
    { key: 'orders_attention', filter: 'attention' },
  ]
  for (const o of order) {
    const c = channels.find(ch => (ch.counts?.[o.key] ?? 0) > 0)
    if (c) return { href: detailHref(c.id, 'orders', o.filter) }
  }
  const err = channels.find(ch => ch.status === 'error' || (ch.counts?.outbox_dead ?? 0) > 0)
  if (err) return { href: detailHref(err.id, err.status === 'error' ? 'settings' : 'log') }
  return null
}

export default function IntegrationsOverview({
  channels, alerts, nowMs, children,
}: {
  channels: ChannelJson[]
  alerts: IntegrationAlerts | null
  nowMs: number
  children?: React.ReactNode   // ข้อความแจ้งจากเซิร์ฟเวอร์ (ใต้หัวเรื่อง)
}) {
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()
  const { busy, run } = useRunner()
  const [flash, setFlash] = useState<Flash | null>(null)
  const [cardFlash, setCardFlash] = useState<Record<string, Flash>>({})
  const [confirmDisconnect, setConfirmDisconnect] = useState<ChannelJson | null>(null)
  const [confirmAdd, setConfirmAdd] = useState<{ platform: Platform; env: ChannelEnvironment } | null>(null)

  function setCard(id: string, f: Flash | null) {
    setCardFlash(prev => {
      const n = { ...prev }
      if (f) n[id] = f
      else delete n[id]
      return n
    })
  }

  async function create(platform: Platform, env: ChannelEnvironment = 'production') {
    setFlash(null)
    await run(`create:${platform}:${env}`, async () => {
      const res = await callAction(() => createChannel(platform, undefined, env))
      setConfirmAdd(null)
      if (!res.ok) { setFlash({ ok: false, text: res.error }); return }
      router.push(`/settings/integrations/${res.channel.id}`)
      await new Promise(resolve => setTimeout(resolve, 4000)) // ค้างปุ่มไว้ระหว่างเปลี่ยนหน้า
    })
  }

  async function doSync(c: ChannelJson) {
    setCard(c.id, null)
    await run(`sync:${c.id}`, async () => {
      const res = await callAction(() => syncNow(c.id))
      if (!res.ok) { setCard(c.id, { ok: false, text: res.error }); router.refresh(); return }
      setCard(c.id, {
        ok: res.failed === 0,
        text: res.message || `ส่งสต๊อก ${qty(res.pushed)} รายการ${res.failed ? ` · ล้มเหลว ${qty(res.failed)}` : ''} · ดึงออเดอร์ ${qty(res.ordersPulled)}`,
      })
      router.refresh()
    })
  }

  async function doConnect(c: ChannelJson) {
    setCard(c.id, null)
    await run(`oauth:${c.id}`, async () => {
      const res = await callAction(() => connectOAuthUrl(c.id))
      if (!res.ok) { setCard(c.id, { ok: false, text: res.error }); return }
      const url = safeAuthUrl(res.url)
      if (!url) { setCard(c.id, { ok: false, text: 'ลิงก์เชื่อมต่อร้านไม่ถูกต้อง กรุณาลองใหม่' }); return }
      window.location.assign(url)
      await new Promise(resolve => setTimeout(resolve, 8000))
    })
  }

  async function doDisconnect() {
    const c = confirmDisconnect
    if (!c) return
    await run(`disconnect:${c.id}`, async () => {
      const res = await callAction(() => disconnect(c.id))
      setConfirmDisconnect(null)
      if (!res.ok) { setCard(c.id, { ok: false, text: res.error }); return }
      setCard(c.id, { ok: true, text: 'ตัดการเชื่อมต่อแล้ว — คีย์ถูกลบ ประวัติออเดอร์ยังอยู่' })
      router.refresh()
    })
  }

  const a = alerts
  const redTotal = a ? a.oversold_orders + a.unmapped_orders + a.return_to_confirm + a.channels_error + a.outbox_dead : 0
  const attention = redTotal > 0 ? firstAttention(channels) : null
  const byPlatform = (p: Platform) => channels.filter(c => c.platform === p)

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">ตั้งค่าการเชื่อมต่อ</h1>
          <p className="page-subtitle">
            เชื่อมสต๊อกในแอปกับ LINE SHOPPING, Facebook/Instagram, Shopee, Lazada, TikTok Shop และช่องทางอื่น — แอปเป็นตัวหลักของสต๊อก
          </p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            onClick={() => startRefresh(() => router.refresh())}
            disabled={refreshing}
            className="btn-secondary w-full sm:w-auto px-5"
          >
            <RefreshCw {...ICON_SM} className={refreshing ? 'animate-spin' : undefined} />
            รีเฟรช
          </button>
        </div>
      </div>

      {children}

      {a && redTotal > 0 && (
        <div role="alert" className="alert-err">
          <PackageX size={18} strokeWidth={1.9} aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">
              {[
                a.oversold_orders > 0 ? `ขายเกิน ${qty(a.oversold_orders)} รายการ` : null,
                a.unmapped_orders > 0 ? `จับคู่ไม่ได้ ${qty(a.unmapped_orders)}` : null,
                a.return_to_confirm > 0 ? `รอยืนยันรับของคืน ${qty(a.return_to_confirm)}` : null,
                a.channels_error > 0 ? `ช่องทางมีข้อผิดพลาด ${qty(a.channels_error)}` : null,
                a.outbox_dead > 0 ? `ส่งสต๊อกไม่สำเร็จ ${qty(a.outbox_dead)}` : null,
              ].filter(Boolean).join(' · ')}
            </p>
            {attention && (
              <Link href={attention.href} className="inline-flex min-h-[44px] items-center font-semibold underline underline-offset-4">
                ดูรายการ
              </Link>
            )}
          </div>
        </div>
      )}
      {a && a.auth_expiring > 0 && (
        <div role="status" className="alert-warn">
          <Clock size={18} strokeWidth={1.9} aria-hidden="true" />
          <p className="min-w-0">การอนุญาตร้านจะหมดอายุภายใน 14 วัน {qty(a.auth_expiring)} ช่องทาง — เข้าไปกด &quot;เชื่อมต่อด้วยบัญชีร้าน&quot; อีกครั้ง</p>
        </div>
      )}
      <FlashMessage flash={flash} />

      <ul className="grid gap-3 sm:gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {PLATFORMS.flatMap(p => {
          const list = byPlatform(p)
          if (list.length === 0) {
            return [
              <EmptyPlatformCard
                key={p}
                platform={p}
                busy={busy}
                onCreate={env => create(p, env)}
              />,
            ]
          }
          return list.map((c, i) => (
            <ChannelCard
              key={c.id}
              c={c}
              nowMs={nowMs}
              busy={busy}
              flash={cardFlash[c.id] ?? null}
              isLast={i === list.length - 1}
              onSync={() => doSync(c)}
              onConnect={() => doConnect(c)}
              onDisconnect={() => { setCard(c.id, null); setConfirmDisconnect(c) }}
              onAdd={env => setConfirmAdd({ platform: p, env })}
            />
          ))
        })}
      </ul>

      <ConfirmDialog
        open={confirmDisconnect !== null}
        title={`ตัดการเชื่อมต่อ ${confirmDisconnect?.display_name ?? ''}?`}
        tone="danger"
        confirmLabel="ตัดการเชื่อมต่อ"
        busy={!!confirmDisconnect && busy === `disconnect:${confirmDisconnect.id}`}
        onCancel={() => setConfirmDisconnect(null)}
        onConfirm={doDisconnect}
      >
        <ul className="list-disc space-y-1 pl-5">
          <li>ลบคีย์/โทเคนทั้งหมดของช่องทางนี้ (และปิดลิงก์ฟีดถ้ามี)</li>
          <li>หยุดส่งสต๊อกและหยุดรับออเดอร์ทันที</li>
          <li>ถ้าเชื่อมใหม่ ต้องกด &quot;ส่งสต๊อกครั้งแรก&quot; ยืนยันใหม่อีกครั้ง</li>
          <li>ประวัติออเดอร์ บิลขาย และการจับคู่สินค้ายังอยู่ครบ</li>
        </ul>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmAdd !== null}
        title={confirmAdd
          ? `เพิ่ม${confirmAdd.env === 'sandbox' ? 'ร้านทดสอบ (Sandbox)' : 'อีกร้าน'}ของ ${PLATFORM_META[confirmAdd.platform].label}?`
          : ''}
        confirmLabel="เพิ่ม"
        busy={!!confirmAdd && busy === `create:${confirmAdd.platform}:${confirmAdd.env}`}
        onCancel={() => setConfirmAdd(null)}
        onConfirm={() => { if (confirmAdd) void create(confirmAdd.platform, confirmAdd.env) }}
      >
        {confirmAdd?.env === 'sandbox'
          ? <p>ร้านทดสอบใช้คีย์ทดสอบ (Test Partner ID/Key) แยกจากร้านจริง — ใช้ลองเชื่อมต่อก่อนขึ้นระบบจริง</p>
          : <p>ใช้เมื่อมี<b>ร้านที่ 2</b> บนแพลตฟอร์มนี้เท่านั้น — ห้ามเพิ่มร้านเดิมซ้ำ เพราะออเดอร์จะถูกตัดสต๊อกซ้ำ 2 รอบ</p>}
      </ConfirmDialog>
    </div>
  )
}

// ---------- การ์ดแพลตฟอร์มที่ยังไม่ได้ตั้งค่า ----------
function EmptyPlatformCard({
  platform, busy, onCreate,
}: {
  platform: Platform
  busy: string | null
  onCreate: (env: ChannelEnvironment) => void
}) {
  const meta = PLATFORM_META[platform]
  return (
    <li className="card p-4 sm:p-5 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PlatformBadge platform={platform} />
        <div className="min-w-0 flex-1">
          <p className="text-base sm:text-lg font-semibold leading-tight text-gray-900 break-words">{meta.label}</p>
          <p className="text-xs text-gray-500">ยังไม่ได้ตั้งค่า</p>
        </div>
      </div>
      <PhaseNote platform={platform} />
      <StepsDetails platform={platform} />
      <div className="mt-auto flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" onClick={() => onCreate('production')} disabled={busy !== null} className="btn-soft w-full sm:w-auto px-5">
          {busy === `create:${platform}:production` ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Settings2 {...ICON_SM} />}
          เริ่มตั้งค่า
        </button>
        {meta.supportsSandbox && (
          <button type="button" onClick={() => onCreate('sandbox')} disabled={busy !== null} className="btn-ghost w-full sm:w-auto px-4">
            {busy === `create:${platform}:sandbox` ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Plus {...ICON_SM} />}
            ร้านทดสอบ (Sandbox)
          </button>
        )}
      </div>
    </li>
  )
}

function PhaseNote({ platform }: { platform: Platform }) {
  const meta = PLATFORM_META[platform]
  if (meta.phase === 'auth_only') {
    return (
      <p className="flex items-start gap-1.5 text-sm text-amber-800">
        <Hourglass size={16} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span className="min-w-0">รออนุมัติ API จากแพลตฟอร์ม — รอบนี้เชื่อมร้านได้ ส่งสต๊อก/ดึงออเดอร์อัตโนมัติรอบถัดไป (ใช้ CSV ไปก่อน)</span>
      </p>
    )
  }
  if (meta.phase === 'fallback') {
    return <p className="text-sm text-gray-600">ไม่ต้องใช้ API: ลิงก์ฟีดสินค้า ส่งออก CSV สต๊อก และนำเข้า CSV ออเดอร์</p>
  }
  if (platform === 'meta') {
    return <p className="text-sm text-gray-600">ส่งสต๊อก (มี/หมด + จำนวน) เข้า Catalog — ออเดอร์จากแชตให้บันทึกที่หน้าขาย</p>
  }
  return <p className="text-sm text-gray-600">ส่งสต๊อกอัตโนมัติ + รับออเดอร์มาตัดสต๊อก</p>
}

function StepsDetails({ platform }: { platform: Platform }) {
  const steps = PLATFORM_META[platform].setupSteps
  if (steps.length === 0) return null
  return (
    <details className="group panel px-3">
      <summary className="flex min-h-[44px] cursor-pointer select-none items-center justify-between gap-2 text-sm font-semibold text-brand-700 [&::-webkit-details-marker]:hidden">
        ขั้นตอนสมัคร ({steps.length} ขั้น)
        <ChevronDown size={18} strokeWidth={1.9} aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <ol className="list-decimal space-y-1.5 pb-3 pl-5 text-sm text-gray-700 leading-relaxed">
        {steps.map((s, i) => <li key={i} className="break-words">{s}</li>)}
      </ol>
    </details>
  )
}

// ---------- การ์ดร้าน (ช่องทางที่สร้างแล้ว) ----------
function ChannelCard({
  c, nowMs, busy, flash, isLast, onSync, onConnect, onDisconnect, onAdd,
}: {
  c: ChannelJson
  nowMs: number
  busy: string | null
  flash: Flash | null
  isLast: boolean
  onSync: () => void
  onConnect: () => void
  onDisconnect: () => void
  onAdd: (env: ChannelEnvironment) => void
}) {
  const meta = PLATFORM_META[c.platform]
  const counts = c.counts
  const failed = (counts?.outbox_failed ?? 0) + (counts?.outbox_dead ?? 0)
  const authDays = daysUntil(c.auth_expires_at, nowMs)
  const savedAll = meta.credentialFields.filter(f => f.required).every(f => c.credentials.some(x => x.name === f.name))
  const canSync = (c.status === 'connected' || c.status === 'error') && c.options.initial_push_done && meta.capabilities.pushStock
  const canOAuth = meta.authKind === 'oauth' && savedAll && ['disconnected', 'pending_approval', 'error'].includes(c.status)
  const needsKeys = meta.authKind !== 'none' && c.status === 'disconnected' && !canOAuth
  const canDisconnect = c.status !== 'disconnected' || c.credentials.length > 0 || c.has_feed_token

  return (
    <li className={clsx('card p-4 sm:p-5 flex flex-col gap-3', (c.status === 'error' || (counts?.oversold_orders ?? 0) > 0) && 'border-red-200')}>
      <div className="flex items-start gap-3">
        <PlatformBadge platform={c.platform} />
        <div className="min-w-0 flex-1">
          <p className="text-base sm:text-lg font-semibold leading-tight text-gray-900 break-words">{c.display_name}</p>
          {(() => {
            // ชื่อร้านซ้ำกับชื่อแพลตฟอร์ม (ค่าเริ่มต้น) → ไม่ต้องแสดงชื่อแพลตฟอร์มซ้ำ
            const parts = [c.display_name !== meta.label ? meta.label : null, c.external_shop_name ?? c.external_shop_id].filter(Boolean)
            return parts.length > 0 ? <p className="text-xs text-gray-500 break-words">{parts.join(' · ')}</p> : null
          })()}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <ChannelStatusPill status={c.status} />
        {c.environment === 'sandbox' && <EnvPill />}
        {c.options.shadow_mode && <span className="chip-outline text-amber-800">โหมดทดลอง</span>}
      </div>

      {(meta.capabilities.pushStock || meta.capabilities.pullOrders) && (
        <p className="text-sm text-gray-700">
          {meta.capabilities.pushStock && <>ส่งสต๊อก <b className={c.options.push_stock ? 'text-green-800' : 'text-gray-500'}>{c.options.push_stock ? 'เปิด' : 'ปิด'}</b></>}
          {meta.capabilities.pushStock && meta.capabilities.pullOrders && ' · '}
          {meta.capabilities.pullOrders && <>ดึงออเดอร์ <b className={c.options.pull_orders ? 'text-green-800' : 'text-gray-500'}>{c.options.pull_orders ? 'เปิด' : 'ปิด'}</b></>}
          {meta.capabilities.pushStock && !c.options.initial_push_done && <span className="block text-xs text-amber-800">ยังไม่ได้กด &quot;ส่งสต๊อกครั้งแรก&quot;</span>}
        </p>
      )}
      {meta.phase === 'auth_only' && <PhaseNote platform={c.platform} />}

      {counts && (
        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="จับคู่แล้ว" value={`${qty(counts.mapped)}/${qty(counts.listings)}`} />
          {meta.capabilities.pushStock && <MiniStat label="งานค้าง" value={qty(counts.outbox_pending)} />}
          {meta.capabilities.pushStock && <MiniStat label="ล้มเหลว" value={qty(failed)} tone={failed > 0 ? 'bad' : 'normal'} />}
          <MiniStat label="ออเดอร์วันนี้" value={qty(counts.orders_today)} />
          <MiniStat label="ต้องดูแล" value={qty(counts.orders_attention)} tone={counts.orders_attention > 0 ? 'bad' : 'normal'} />
        </div>
      )}

      <p className="text-xs text-gray-500">ซิงก์ล่าสุด {c.last_sync_at ? relativeThai(c.last_sync_at, nowMs) : 'ยังไม่เคย'}</p>
      {c.last_error && (
        <p className="flex items-start gap-1.5 text-xs text-red-700" title={c.last_error}>
          <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span className="min-w-0 truncate">{c.last_error}</span>
        </p>
      )}
      {authDays !== null && authDays < 14 && (
        <p className="flex items-start gap-1.5 text-xs font-semibold text-red-700">
          <Clock size={14} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
          {authDays < 0 ? 'การอนุญาตร้านหมดอายุแล้ว — เชื่อมต่อใหม่' : `การอนุญาตร้านหมดใน ${authDays} วัน`}
        </p>
      )}
      {(counts?.oversold_orders ?? 0) > 0 && (
        <Link href={detailHref(c.id, 'orders', 'oversold')} className="alert-err min-h-[44px] items-center font-semibold">
          <PackageX size={18} strokeWidth={1.9} aria-hidden="true" />
          ขายเกิน {qty(counts?.oversold_orders ?? 0)} ออเดอร์ — แตะเพื่อดู
        </Link>
      )}

      <FlashMessage flash={flash} />

      {/* ปุ่มไม่ตัดคำกลางคำ: กว้างตามข้อความ (flex-auto) ขึ้นบรรทัดใหม่ทั้งปุ่มเมื่อไม่พอ แล้วยืดเต็มแถวบนมือถือ */}
      <div className="mt-auto flex flex-wrap gap-2 [&>*]:min-w-[8.5rem] [&>*]:flex-auto [&>*]:whitespace-nowrap sm:[&>*]:flex-none">
        <Link href={detailHref(c.id)} className="btn-soft px-5">
          <Settings2 {...ICON_SM} />
          จัดการ
        </Link>
        {canSync && (
          <button type="button" onClick={onSync} disabled={busy !== null} className="btn-secondary px-5">
            {busy === `sync:${c.id}` ? <Loader2 {...ICON_SM} className="animate-spin" /> : <RefreshCw {...ICON_SM} />}
            ซิงก์ตอนนี้
          </button>
        )}
        {canOAuth && (
          <button type="button" onClick={onConnect} disabled={busy !== null} className="btn-secondary px-5">
            {busy === `oauth:${c.id}` ? <Loader2 {...ICON_SM} className="animate-spin" /> : <LogIn {...ICON_SM} />}
            เชื่อมต่อด้วยบัญชีร้าน
          </button>
        )}
        {needsKeys && (
          <Link href={detailHref(c.id)} className="btn-secondary px-5">
            <LogIn {...ICON_SM} />
            ใส่คีย์เพื่อเชื่อมต่อ
          </Link>
        )}
        {canDisconnect && (
          <button type="button" onClick={onDisconnect} disabled={busy !== null} className="btn-danger-soft px-4">
            <Unplug {...ICON_SM} />
            ตัดการเชื่อมต่อ
          </button>
        )}
      </div>

      <StepsDetails platform={c.platform} />

      {isLast && (
        <div className="flex flex-wrap gap-x-4 border-t border-gray-150 pt-2">
          <button type="button" onClick={() => onAdd('production')} disabled={busy !== null} className="btn-ghost -ml-3 px-3 text-sm">
            <Plus {...ICON_SM} />
            เพิ่มร้านอีก
          </button>
          {meta.supportsSandbox && (
            <button type="button" onClick={() => onAdd('sandbox')} disabled={busy !== null} className="btn-ghost px-3 text-sm">
              <Plus {...ICON_SM} />
              เพิ่มร้านทดสอบ (Sandbox)
            </button>
          )}
        </div>
      )}
    </li>
  )
}
