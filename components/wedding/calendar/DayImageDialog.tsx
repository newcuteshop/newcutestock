'use client'
// ป็อปอัป "รูปตารางงานประจำวัน" (ส่งเข้ากลุ่ม LINE ทีมงาน): ตัวเลือก → รูปตัวอย่างย่อให้พอดีจอ → แชร์ / บันทึกรูป / คัดลอกรูป
// - สร้างรูปไว้ล่วงหน้าทุกครั้งที่ตัวเลือกเปลี่ยน (หน่วง 0.4 วิ) แล้วปุ่มใช้รูปที่พร้อมแล้ว:
//   Safari/LINE ยอมให้แชร์/คัดลอกเฉพาะ "ระหว่างที่ผู้ใช้กด" — ถ้ารอสร้างรูปหลังกดนานเกินไป เบราว์เซอร์จะปฏิเสธ
// - ตัวแปลงรูปใช้ lib/exportImage (html-to-image โหลดตอนสร้างรูปครั้งแรก ไม่ถ่วงหน้าปฏิทิน · จำกัดขนาด canvas ตามเพดาน iPhone ให้เอง)
// - ชื่อร้าน/โลโก้อ่านจาก wed_get_settings ตอนเปิด (อ่านไม่ได้ = ชื่อเริ่มต้น + โลโก้เมฆ)
//   โลโก้แปลงเป็น data URL ก่อน (imageUrlToDataUrl) → รูปไม่หายตอนแปลง และ canvas ไม่ติดข้อจำกัดข้ามโดเมน
// - เบราว์เซอร์ในแอป LINE: แชร์/ดาวน์โหลดมักไม่บันทึกจริง → แสดงรูป PNG จริงให้กดค้างบันทึกเอง
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Copy, Download, ImageDown, Loader2, RefreshCw, Share2 } from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import DialogShell, { DialogMessage } from '@/components/rental/booking/DialogShell'
import { createClient } from '@/lib/supabase/client'
import { formatThaiDayLong } from '@/lib/format'
import {
  blobToDataUrl, copyImage, downloadBlob, imageUrlToDataUrl, isInAppBrowser, renderNodeToPng, shareOrDownload,
} from '@/lib/exportImage'
import {
  DEFAULT_WEDDING_SETTINGS, parseWeddingSettings, weddingLogoUrl, type WedDaySession, type WedSettings,
} from '@/lib/wedding'
import DayScheduleImage, { DAY_IMAGE_WIDTH, dayImageShop, type DayImageOptions } from './DayScheduleImage'
import { rpcWithTimeout } from './rpc'

const RENDER_DELAY_MS = 400

type RenderState =
  | { kind: 'idle' }
  | { kind: 'rendering' }
  | { kind: 'ready'; blob: Blob }
  | { kind: 'error'; message: string }

const THAI_RE = /[฀-๿]/

function Toggle({ label, hint, on, onToggle }: { label: string; hint?: string; on: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="flex w-full min-h-[44px] items-center justify-between gap-3 rounded-lg px-1 text-left text-sm text-gray-900"
    >
      <span className="min-w-0">
        <span className="block font-medium break-words">{label}</span>
        {hint && <span className="block text-xs text-gray-500 break-words">{hint}</span>}
      </span>
      <span aria-hidden="true" className={clsx('switch', on && 'switch-on')}>
        <span className="switch-knob" />
      </span>
    </button>
  )
}

export default function DayImageDialog({
  day,
  sessions,
  onClose,
}: {
  day: string
  /** ทุกคิวของวัน (wed_day / wed_today.today_sessions) — งานสอบถามเลือกใส่ได้ในป็อปอัปนี้ */
  sessions: readonly WedDaySession[]
  onClose(): void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [settings, setSettings] = useState<WedSettings | null>(null)
  // โลโก้: undefined = กำลังโหลด · null = ไม่มี/โหลดไม่ได้ (ใช้โลโก้เมฆ) · string = data URL
  const [logoSrc, setLogoSrc] = useState<string | null | undefined>(undefined)
  const [options, setOptions] = useState<DayImageOptions>({ showMoney: false, showContacts: true, showRunSheet: true })
  const [withInquiries, setWithInquiries] = useState(false)
  const [render, setRender] = useState<RenderState>({ kind: 'idle' })
  const [pngUrl, setPngUrl] = useState('')
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err' | 'info'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [createdAt] = useState(() => new Date().toISOString())
  const [inApp] = useState(() => isInAppBrowser())
  const nodeRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const genRef = useRef(0)
  const [box, setBox] = useState({ width: 0, height: 0 })

  const hasInquiries = sessions.some(s => s.status === 'inquiry')
  const shown = useMemo(
    () => sessions.filter(s => withInquiries || s.status !== 'inquiry'),
    [sessions, withInquiries],
  )

  // ชื่อร้าน + โลโก้ (data URL)
  useEffect(() => {
    let alive = true
    void (async () => {
      const res = await rpcWithTimeout(supabase, 'wed_get_settings')
      if (!alive) return
      const s = res.error ? { ...DEFAULT_WEDDING_SETTINGS, bank_accounts: [] } : parseWeddingSettings(res.data)
      setSettings(s)
      const url = weddingLogoUrl(s)
      const data = url ? await imageUrlToDataUrl(url) : null
      if (alive) setLogoSrc(data)
    })()
    return () => { alive = false }
  }, [supabase])

  // ย่อรูปตัวอย่างให้พอดีกล่อง (วัดความกว้างกล่อง + ความสูงจริงของรูป)
  useEffect(() => {
    const boxEl = boxRef.current
    const node = nodeRef.current
    if (!boxEl || !node || typeof ResizeObserver === 'undefined') return
    const measure = () => setBox({ width: boxEl.clientWidth, height: node.offsetHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(boxEl)
    ro.observe(node)
    return () => ro.disconnect()
  }, [settings, logoSrc])

  const doRender = useCallback(async () => {
    const node = nodeRef.current
    if (!node) return
    const gen = ++genRef.current
    setRender({ kind: 'rendering' })
    try {
      // ความละเอียด 2 เท่า (คมบนจอมือถือ) — lib/exportImage ลดลงเองถ้ารูปยาวเกินเพดาน canvas
      const blob = await renderNodeToPng(node, { pixelRatio: 2, backgroundColor: '#FFFFFF' })
      if (gen !== genRef.current) return
      setRender({ kind: 'ready', blob })
    } catch (err) {
      if (gen !== genRef.current) return
      console.error(err)
      const m = err instanceof Error && THAI_RE.test(err.message) ? err.message : 'สร้างรูปไม่สำเร็จ — กดสร้างรูปใหม่อีกครั้ง'
      setRender({ kind: 'error', message: m })
    }
  }, [])

  // สร้างรูปใหม่เมื่อข้อมูล/ตัวเลือกเปลี่ยน (รอชื่อร้านและโลโก้ให้เรียบร้อยก่อน)
  useEffect(() => {
    if (!settings || logoSrc === undefined) return
    genRef.current++ // ผลของรอบก่อนที่ยังค้างอยู่ ไม่ต้องใช้
    setRender({ kind: 'idle' })
    setMsg(null)
    const t = window.setTimeout(() => { void doRender() }, RENDER_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [settings, logoSrc, options, shown, doRender])

  // ในแอป LINE: เตรียมรูป PNG จริง (data URL) ให้กดค้างบันทึก — ลิงก์ blob: บันทึกจากเมนูกดค้างไม่ได้ในบางเครื่อง
  useEffect(() => {
    if (!inApp || render.kind !== 'ready') {
      setPngUrl('')
      return
    }
    let alive = true
    blobToDataUrl(render.blob).then(u => { if (alive) setPngUrl(u) }, () => { if (alive) setPngUrl('') })
    return () => { alive = false }
  }, [inApp, render])

  const filename = `schedule-${day}.png`
  const ready = render.kind === 'ready' ? render.blob : null

  async function onShare() {
    if (!ready || busy) return
    setBusy(true)
    setMsg(null)
    const result = await shareOrDownload(ready, filename, undefined, { fallbackDownload: true })
    setBusy(false)
    if (result === 'shared') setMsg({ tone: 'ok', text: 'ส่งรูปเรียบร้อย' })
    else if (result === 'downloaded') {
      setMsg({
        tone: 'info',
        text: inApp
          ? 'เบราว์เซอร์ในแอปนี้อาจไม่บันทึกไฟล์ให้ — กดค้างที่รูปด้านบนเพื่อบันทึก แล้วส่งเข้ากลุ่ม LINE'
          : 'เครื่องนี้แชร์รูปตรงไม่ได้ — บันทึกรูปลงเครื่องแล้ว ส่งเข้ากลุ่ม LINE จากอัลบั้มรูป/โฟลเดอร์ดาวน์โหลดได้เลย',
      })
    } else if (result === 'blocked') setMsg({ tone: 'info', text: 'เบราว์เซอร์ยังไม่เปิดหน้าแชร์ — กด "แชร์" อีกครั้ง' })
    else if (result === 'failed') setMsg({ tone: 'err', text: 'แชร์และบันทึกรูปไม่ได้ในเบราว์เซอร์นี้ — กดค้างที่รูปตัวอย่างเพื่อบันทึกเอง' })
    // cancelled = ผู้ใช้ปิดหน้าต่างแชร์เอง ไม่ต้องแจ้ง
  }

  function onDownload() {
    if (!ready) return
    setMsg(downloadBlob(ready, filename)
      ? {
        tone: 'ok',
        text: inApp
          ? 'สั่งบันทึกรูปแล้ว — ถ้าไม่พบไฟล์ ให้กดค้างที่รูปด้านบนเพื่อบันทึก'
          : 'บันทึกรูปแล้ว (ดูในโฟลเดอร์ดาวน์โหลด/อัลบั้มรูป)',
      }
      : { tone: 'err', text: 'บันทึกรูปไม่สำเร็จ — กดค้างที่รูปตัวอย่างเพื่อบันทึกเอง หรือใช้ปุ่มแชร์' })
  }

  async function onCopy() {
    if (!ready || busy) return
    setBusy(true)
    setMsg(null)
    const result = await copyImage(ready)
    setBusy(false)
    setMsg(result === 'copied'
      ? { tone: 'ok', text: 'คัดลอกรูปแล้ว — วางในแชท LINE ได้เลย' }
      : { tone: 'err', text: 'เบราว์เซอร์นี้คัดลอกรูปไม่ได้ — ใช้ปุ่ม "แชร์" หรือ "บันทึกรูป" แทน' })
  }

  const scale = box.width > 0 ? Math.min(1, box.width / DAY_IMAGE_WIDTH) : 0.3
  const shop = dayImageShop(settings ?? { ...DEFAULT_WEDDING_SETTINGS, bank_accounts: [] }, logoSrc ?? '')
  const rendering = render.kind === 'rendering' || render.kind === 'idle'

  return (
    <DialogShell
      title="รูปตารางงานประจำวัน"
      subtitle={`${formatThaiDayLong(day)} · สำหรับส่งเข้ากลุ่ม LINE ทีมงาน`}
      icon={<ImageDown {...ICON} />}
      wide
      busy={busy}
      onClose={onClose}
      footer={(
        <>
          {msg && <DialogMessage tone={msg.tone} text={msg.text} />}
          {render.kind === 'error' && <DialogMessage tone="err" text={render.message} />}
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={() => void onShare()} disabled={!ready || busy} className="btn-primary px-2 text-sm">
              {busy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Share2 {...ICON_SM} />}
              แชร์
            </button>
            <button type="button" onClick={onDownload} disabled={!ready || busy} className="btn-secondary px-2 text-sm">
              <Download {...ICON_SM} />
              บันทึกรูป
            </button>
            <button type="button" onClick={() => void onCopy()} disabled={!ready || busy} className="btn-secondary px-2 text-sm">
              <Copy {...ICON_SM} />
              คัดลอกรูป
            </button>
          </div>
          <div className="flex min-h-[28px] items-center justify-center text-xs text-gray-500" aria-live="polite">
            {render.kind === 'error' ? (
              <button type="button" onClick={() => void doRender()} className="btn-ghost px-2 text-xs">
                <RefreshCw {...ICON_SM} />
                สร้างรูปใหม่
              </button>
            ) : rendering ? 'กำลังสร้างรูป...' : 'รูปพร้อมส่งแล้ว'}
          </div>
        </>
      )}
    >
      <div className="panel space-y-0.5 px-3 py-1.5">
        <Toggle
          label="แสดงยอดเงิน"
          hint="ยอดสุทธิ / ชำระแล้ว / ค้างชำระ ของแต่ละงาน (ค่าตัวทีมงานไม่แสดงในรูปเสมอ)"
          on={options.showMoney}
          onToggle={() => setOptions(o => ({ ...o, showMoney: !o.showMoney }))}
        />
        <Toggle
          label="แสดงเบอร์ติดต่อ"
          hint="ลูกค้า ผู้ประสานงาน และผู้ติดต่อสถานที่"
          on={options.showContacts}
          onToggle={() => setOptions(o => ({ ...o, showContacts: !o.showContacts }))}
        />
        <Toggle
          label="แสดงกำหนดการ"
          on={options.showRunSheet}
          onToggle={() => setOptions(o => ({ ...o, showRunSheet: !o.showRunSheet }))}
        />
        {hasInquiries && (
          <Toggle
            label="รวมงานที่ยังสอบถาม"
            hint={'งานที่ยังไม่ล็อกคิว จะมีป้าย "ยังไม่ยืนยัน" ในรูป'}
            on={withInquiries}
            onToggle={() => setWithInquiries(v => !v)}
          />
        )}
      </div>

      {inApp && pngUrl && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-700">ในแอป LINE: กดค้างที่รูปนี้เพื่อบันทึก แล้วส่งเข้ากลุ่มทีมงาน</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- รูปที่สร้างในเครื่อง (data URL) */}
          <img src={pngUrl} alt={`รูปตารางงาน${formatThaiDayLong(day)}`} className="w-full rounded-lg border border-gray-200" />
        </div>
      )}

      {/* รูปตัวอย่าง (ย่อตามความกว้างกล่อง) — ตัวที่ถูกแปลงเป็นรูปคือกล่องขนาดจริงข้างใน (ต้องอยู่ในหน้าและมีขนาดจริง)
          ในแอป LINE เมื่อมีรูปจริงแล้ว: พับกล่องเหลือสูง 0 (ห้ามใช้ sr-only — white-space: nowrap จะสืบทอดเข้าไปทำให้ข้อความในรูปไม่ตัดบรรทัด) */}
      <div ref={boxRef} className={clsx('w-full', inApp && pngUrl && 'h-0 overflow-hidden')} aria-hidden={inApp && pngUrl ? true : undefined}>
        <div
          className={clsx('relative overflow-hidden rounded-lg border border-gray-200 bg-white transition-opacity', rendering && 'opacity-80')}
          style={{ height: box.height > 0 ? Math.ceil(box.height * scale) : 240 }}
          role="img"
          aria-label={`รูปตัวอย่างตารางงาน${formatThaiDayLong(day)}`}
        >
          <div style={{ width: DAY_IMAGE_WIDTH, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            {settings && logoSrc !== undefined ? (
              <DayScheduleImage
                ref={nodeRef}
                day={day}
                sessions={shown}
                shop={shop}
                options={options}
                createdAt={createdAt}
                logoFailed={!logoSrc}
              />
            ) : (
              <div className="p-10"><div className="skeleton h-40 w-full" /></div>
            )}
          </div>
          {rendering && settings && (
            <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-xs text-gray-700">
              <Loader2 size={14} strokeWidth={1.9} aria-hidden="true" className="animate-spin" />
              กำลังสร้างรูป
            </span>
          )}
        </div>
      </div>
    </DialogShell>
  )
}
