'use client'
// ปุ่มเปลี่ยนสถานะช่องทาง: รออนุมัติ API / หยุดชั่วคราว / ทำงานต่อ / ตัดการเชื่อมต่อ
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Hourglass, Loader2, PauseCircle, PlayCircle, Unplug } from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { PLATFORM_META } from '@/lib/integrations/platforms'
import type { ChannelJson, ChannelStateAction } from '@/lib/integrations/types'
import { disconnect, setChannelState } from '@/app/(dashboard)/settings/integrations/actions'
import { FlashMessage, type Flash } from './bits'
import ConfirmDialog from './ConfirmDialog'
import { callAction, useRunner } from './useAction'

const STATE_DONE: Record<ChannelStateAction, string> = {
  mark_pending_approval: 'ตั้งสถานะ "รออนุมัติ API" แล้ว',
  unmark_pending_approval: 'ยกเลิกสถานะรออนุมัติแล้ว',
  pause: 'หยุดชั่วคราวแล้ว — ระบบจะไม่ส่งสต๊อก/ดึงออเดอร์จนกว่าจะกด "ทำงานต่อ"',
  resume: 'ทำงานต่อแล้ว',
}

function useStateAction(channel: ChannelJson) {
  const router = useRouter()
  const { busy, run } = useRunner()
  const [flash, setFlash] = useState<Flash | null>(null)
  async function act(action: ChannelStateAction) {
    setFlash(null)
    await run(action, async () => {
      const res = await callAction(() => setChannelState(channel.id, action))
      if (!res.ok) { setFlash({ ok: false, text: res.error }); return }
      setFlash({ ok: true, text: STATE_DONE[action] })
      router.refresh()
    })
  }
  return { busy, run, flash, setFlash, act, router }
}

/** แพลตฟอร์มที่ยังรออนุมัติ API (Shopee/Lazada/TikTok): ปุ่ม "รออนุมัติ API" / "ยกเลิกสถานะรออนุมัติ" */
export function ApprovalControls({ channel }: { channel: ChannelJson }) {
  const meta = PLATFORM_META[channel.platform]
  const { busy, flash, act } = useStateAction(channel)
  if (meta.phase !== 'auth_only') return null
  const pending = channel.status === 'pending_approval'
  if (!pending && channel.status !== 'disconnected') return null

  return (
    <section className="card p-4 sm:p-5 space-y-3" aria-labelledby={`approval-${channel.id}`}>
      <h2 id={`approval-${channel.id}`} className="section-title">
        <Hourglass {...ICON} className="text-brand-600" />
        สถานะการสมัคร API
      </h2>
      <p className="text-sm text-gray-600">
        {pending
          ? `ตั้งไว้ว่า "รออนุมัติ API" จาก ${meta.label} — ได้คีย์แล้วให้ใส่ในช่องคีย์ด้านบน แล้วกด "เชื่อมต่อด้วยบัญชีร้าน"`
          : `ส่งใบสมัครนักพัฒนากับ ${meta.label} แล้ว? กด "รออนุมัติ API" เพื่อจำสถานะไว้ (ระหว่างรอใช้ CSV ไปก่อน)`}
      </p>
      <FlashMessage flash={flash} />
      <button
        type="button"
        onClick={() => act(pending ? 'unmark_pending_approval' : 'mark_pending_approval')}
        disabled={busy !== null}
        className="btn-secondary w-full sm:w-auto px-5"
      >
        {busy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Hourglass {...ICON_SM} />}
        {pending ? 'ยกเลิกสถานะรออนุมัติ' : 'รออนุมัติ API'}
      </button>
    </section>
  )
}

/** โซนอันตราย: หยุดชั่วคราว / ทำงานต่อ / ตัดการเชื่อมต่อ */
export function DangerZone({ channel }: { channel: ChannelJson }) {
  const meta = PLATFORM_META[channel.platform]
  const { busy, run, flash, setFlash, act, router } = useStateAction(channel)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const canPause = channel.status === 'connected' || channel.status === 'error'
  const canResume = channel.status === 'paused' || (meta.phase === 'fallback' && channel.status === 'disconnected')
  const hasSomething = channel.status !== 'disconnected' || channel.credentials.length > 0 || channel.has_feed_token

  async function doDisconnect() {
    setFlash(null)
    await run('disconnect', async () => {
      const res = await callAction(() => disconnect(channel.id))
      setConfirmOpen(false)
      if (!res.ok) { setFlash({ ok: false, text: res.error }); return }
      setFlash({ ok: true, text: 'ตัดการเชื่อมต่อแล้ว — คีย์ถูกลบ ประวัติออเดอร์ยังอยู่' })
      router.refresh()
    })
  }

  return (
    <section className="card p-4 sm:p-5 space-y-3 border-red-200" aria-labelledby={`danger-${channel.id}`}>
      <h2 id={`danger-${channel.id}`} className="section-title text-red-800">
        <Unplug {...ICON} className="text-red-700" />
        หยุด / ตัดการเชื่อมต่อ
      </h2>
      <FlashMessage flash={flash} />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {canPause && (
          <button type="button" onClick={() => act('pause')} disabled={busy !== null} className="btn-secondary w-full sm:w-auto px-5">
            {busy === 'pause' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <PauseCircle {...ICON_SM} />}
            หยุดชั่วคราว
          </button>
        )}
        {canResume && (
          <button type="button" onClick={() => act('resume')} disabled={busy !== null} className="btn-soft w-full sm:w-auto px-5">
            {busy === 'resume' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <PlayCircle {...ICON_SM} />}
            {meta.phase === 'fallback' && channel.status === 'disconnected' ? 'เปิดใช้งาน' : 'ทำงานต่อ'}
          </button>
        )}
        {hasSomething && (
          <button type="button" onClick={() => { setFlash(null); setConfirmOpen(true) }} disabled={busy !== null} className="btn-danger-soft w-full sm:w-auto px-5">
            <Unplug {...ICON_SM} />
            ตัดการเชื่อมต่อ
          </button>
        )}
      </div>
      {channel.status === 'paused' && (
        <p className="text-xs text-gray-500">หยุดชั่วคราวอยู่: สต๊อกที่เปลี่ยนระหว่างนี้จะถูกเก็บในคิว แล้วส่งเมื่อกด &quot;ทำงานต่อ&quot;</p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`ตัดการเชื่อมต่อ ${channel.display_name}?`}
        tone="danger"
        confirmLabel="ตัดการเชื่อมต่อ"
        busy={busy === 'disconnect'}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={doDisconnect}
      >
        <ul className="list-disc space-y-1 pl-5">
          <li>ลบคีย์/โทเคนทั้งหมดของช่องทางนี้{meta.capabilities.feed ? ' และปิดลิงก์ฟีด' : ''}</li>
          <li>หยุดส่งสต๊อกและหยุดรับออเดอร์ทันที (งานที่ค้างในคิวถูกยกเลิก)</li>
          <li>ถ้าเชื่อมใหม่ ต้องกด &quot;ส่งสต๊อกครั้งแรก&quot; ยืนยันใหม่อีกครั้ง</li>
          <li>ประวัติออเดอร์ บิลขาย และการจับคู่สินค้ายังอยู่ครบ</li>
          {meta.authKind === 'oauth' && <li>การอนุญาตในเว็บของ {meta.label} ยังอยู่ — ยกเลิกเองที่หน้าร้านของแพลตฟอร์มได้</li>}
        </ul>
      </ConfirmDialog>
    </section>
  )
}
