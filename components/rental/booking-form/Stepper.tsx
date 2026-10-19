'use client'
import clsx from 'clsx'
import { Check } from 'lucide-react'
import { STEPS, type WizardStep } from './model'

// แถบขั้นตอนของฟอร์มการจอง
// มือถือ: "ขั้นที่ 2 จาก 4 · เลือกชุด" + แถบความคืบหน้า 4 ช่อง (ไม่มีที่พอสำหรับชื่อทุกขั้น)
// จอกว้าง: ชื่อทุกขั้นเรียงกัน — ขั้นที่ไปได้กดข้ามได้ (สร้างใหม่: ย้อนกลับได้ทุกขั้น ไปข้างหน้าได้เฉพาะขั้นที่ผ่านแล้ว)
export default function Stepper({
  step,
  canGo,
  onGo,
}: {
  step: WizardStep
  canGo: (n: WizardStep) => boolean
  onGo: (n: WizardStep) => void
}) {
  const current = STEPS.find(s => s.n === step) ?? STEPS[0]
  return (
    <nav aria-label="ขั้นตอนการจอง" className="card px-4 py-3 sm:px-5">
      {/* มือถือ */}
      <div className="md:hidden space-y-2">
        <p className="text-sm text-gray-600">
          ขั้นที่ <span className="font-semibold text-gray-900 tabular-nums">{step}</span> จาก {STEPS.length}
          <span className="text-gray-300"> · </span>
          <span className="font-semibold text-gray-900">{current.label}</span>
        </p>
        <div className="grid grid-cols-4 gap-1.5" aria-hidden="true">
          {STEPS.map(s => (
            <span key={s.n} className={clsx('h-1.5 rounded-full', s.n <= step ? 'bg-brand-600' : 'bg-gray-200')} />
          ))}
        </div>
      </div>

      {/* จอกว้าง */}
      <ol className="hidden md:flex items-center gap-2">
        {STEPS.map((s, i) => {
          const done = s.n < step
          const active = s.n === step
          const enabled = !active && canGo(s.n)
          return (
            <li key={s.n} className="flex min-w-0 flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => onGo(s.n)}
                disabled={!enabled}
                aria-current={active ? 'step' : undefined}
                className={clsx(
                  'flex min-h-[44px] min-w-0 items-center gap-2 rounded-lg px-2 text-left text-sm',
                  enabled && '[@media(hover:hover)]:hover:bg-gray-50',
                  !enabled && !active && 'cursor-default',
                )}
              >
                <span
                  className={clsx(
                    'grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-semibold tabular-nums',
                    active && 'border-brand-600 bg-brand-600 text-white',
                    done && !active && 'border-brand-600 bg-brand-50 text-brand-700',
                    !done && !active && 'border-gray-300 bg-white text-gray-500',
                  )}
                  aria-hidden="true"
                >
                  {done ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : s.n}
                </span>
                <span className={clsx('truncate', active ? 'font-semibold text-gray-900' : 'text-gray-600')}>{s.label}</span>
              </button>
              {i < STEPS.length - 1 && <span className="h-px min-w-[12px] flex-1 bg-gray-200" aria-hidden="true" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
