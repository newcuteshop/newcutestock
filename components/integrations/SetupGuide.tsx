'use client'
// "วิธีขอ API" — เช็กลิสต์ขั้นตอนที่บอสต้องทำเองในเว็บของแพลตฟอร์ม + URL ให้กดคัดลอกไปกรอก
// ติ๊กขั้นตอนเก็บไว้ในเครื่องนี้เท่านั้น (localStorage) — เป็นตัวช่วยจำ ไม่มีผลกับระบบ
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Check, ExternalLink, ListChecks } from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { PLATFORM_META } from '@/lib/integrations/platforms'
import type { Platform } from '@/lib/integrations/types'
import CopyField from './CopyField'

const STORE_PREFIX = 'newcute-integ-steps-'

export default function SetupGuide({
  channelId, platform, urls,
}: {
  channelId: string
  platform: Platform
  urls: { webhook: string | null; callback: string | null; domain: string } | null
}) {
  const meta = PLATFORM_META[platform]
  const steps = meta.setupSteps
  const [done, setDone] = useState<boolean[]>(() => steps.map(() => false))

  // อ่านหลัง mount (กัน hydration ไม่ตรง) — ข้อมูลเสีย/ถูกบล็อก = เริ่มใหม่ว่างๆ
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORE_PREFIX + channelId)
      if (!raw) return
      const arr: unknown = JSON.parse(raw)
      if (Array.isArray(arr)) setDone(steps.map((_, i) => arr[i] === true))
    } catch { /* ไม่เป็นไร */ }
  }, [channelId, steps])

  function toggle(i: number) {
    setDone(prev => {
      const next = prev.map((v, j) => (j === i ? !v : v))
      try { window.localStorage.setItem(STORE_PREFIX + channelId, JSON.stringify(next)) } catch { /* ไม่เป็นไร */ }
      return next
    })
  }

  const doneCount = done.filter(Boolean).length
  const showDomain = meta.authKind === 'oauth' && !!urls

  return (
    <section className="card p-4 sm:p-5 space-y-4" aria-labelledby="setup-guide-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="setup-guide-title" className="section-title">
          <ListChecks {...ICON} className="text-brand-600" />
          วิธีขอ API / ขั้นตอนสมัคร
        </h2>
        {steps.length > 0 && (
          <span className="chip tabular-nums">ทำแล้ว {doneCount}/{steps.length}</span>
        )}
      </div>

      {steps.length > 0 && (
        <ol className="space-y-2">
          {steps.map((step, i) => (
            <li key={i}>
              <button
                type="button"
                role="checkbox"
                aria-checked={done[i]}
                onClick={() => toggle(i)}
                className={clsx(
                  'flex w-full min-h-[44px] items-start gap-3 rounded-2xl border px-3 py-2.5 text-left text-sm leading-relaxed transition-colors active:scale-[0.99]',
                  done[i] ? 'border-green-200 bg-green-50 text-green-900' : 'border-blush-hair bg-gray-50 text-gray-800',
                )}
              >
                <span
                  aria-hidden="true"
                  className={clsx(
                    'mt-0.5 inline-grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 font-display text-xs font-bold',
                    done[i] ? 'border-green-600 bg-green-600 text-white' : 'border-strawberry bg-white text-brand-700',
                  )}
                >
                  {done[i] ? <Check size={14} strokeWidth={2.6} aria-hidden="true" /> : i + 1}
                </span>
                <span className={clsx('min-w-0 break-words', done[i] && 'line-through decoration-green-700/40')}>{step}</span>
              </button>
            </li>
          ))}
        </ol>
      )}

      {meta.developerUrl && (
        <a
          href={meta.developerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary w-full sm:w-auto"
        >
          <ExternalLink {...ICON_SM} />
          เปิดหน้านักพัฒนาของ {meta.shortLabel}
        </a>
      )}

      {urls && (urls.webhook || urls.callback || showDomain) && (
        <div className="space-y-3 pt-1">
          <p className="section-kicker">ค่าที่ต้องกรอกในเว็บของแพลตฟอร์ม</p>
          {urls.webhook && (
            <CopyField label="URL รับ webhook" value={urls.webhook} help="ห้ามต่อท้ายด้วย ? หรือข้อความอื่น" />
          )}
          {urls.callback && (
            <CopyField label="URL callback (Redirect URL)" value={urls.callback} />
          )}
          {showDomain && <CopyField label="โดเมนของแอป" value={urls.domain} />}
        </div>
      )}
    </section>
  )
}
