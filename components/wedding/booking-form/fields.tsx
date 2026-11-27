'use client'
// ช่องกรอกที่ใช้ซ้ำในฟอร์มงาน (ป้าย + ข้อความผิด/คำแนะนำ + ช่องเงิน/วัน/เวลา + การ์ดส่วนของฟอร์ม)
// ช่องกรอกทุกช่องใช้คลาส .input (มือถือ 16px ไม่ซูม, สูง ≥ 44px) — ข้อความผิดผูกกับช่องด้วย aria-describedby
// + กล่องพับ "ข้อมูลเพิ่มเติม (ไม่บังคับ)" (MoreFields / useDisclosure) — ฟอร์มสร้างงานโชว์เฉพาะช่องที่ต้องกรอกจริง
//   ช่องที่ไม่จำเป็นพับไว้ แต่ข้อมูล/ตัวตรวจ/การบันทึกยังเหมือนเดิมทุกอย่าง (ช่องที่พับไว้ยังอยู่ในหน้า แค่ซ่อน)
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'
import { formatThaiDate, isDayKey } from '@/lib/format'
import { thaiDayName } from '@/lib/wedding'
import { sectionDomId, type SectionId } from './model'

export function Field({
  id, label, error, hint, children, className,
}: {
  id: string
  label: ReactNode
  error?: string | null
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={clsx('min-w-0', className)}>
      <label htmlFor={id} className="field-label">{label}</label>
      {children}
      {error ? (
        <p id={`${id}-err`} role="alert" className="mt-1 text-sm font-medium text-red-700 break-words">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="field-hint break-words">{hint}</p>
      ) : null}
    </div>
  )
}

/** aria สำหรับช่องที่อยู่ใน Field (ผูกข้อความผิด/คำแนะนำ) */
export function fieldAria(id: string, error?: string | null, hasHint?: boolean): {
  'aria-invalid'?: true
  'aria-describedby'?: string
} {
  if (error) return { 'aria-invalid': true, 'aria-describedby': `${id}-err` }
  return hasHint ? { 'aria-describedby': `${id}-hint` } : {}
}

export function MoneyInput({
  id, value, onChange, disabled, error, placeholder, describedBy, className,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  error?: string | null
  placeholder?: string
  describedBy?: string
  className?: string
}) {
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={clsx('input text-right font-semibold tabular-nums', className)}
      placeholder={placeholder ?? '0'}
      value={value}
      maxLength={16}
      disabled={disabled}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-err` : describedBy}
      onChange={e => onChange(e.target.value)}
      onFocus={e => e.currentTarget.select()}
    />
  )
}

/** ช่องเลือกวัน + บอกวัน พ.ศ. ใต้ช่อง (ช่อง date ของเบราว์เซอร์แสดง ค.ศ.) */
export function DateField({
  id, label, value, onChange, disabled, error, hint, min, max, className,
}: {
  id: string
  label: ReactNode
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  error?: string | null
  hint?: ReactNode
  min?: string
  max?: string
  className?: string
}) {
  const be = isDayKey(value) ? `วัน${thaiDayName(value)} ${formatThaiDate(value)}` : null
  return (
    <Field id={id} label={label} error={error} hint={be ?? hint} className={className}>
      <input
        id={id}
        type="date"
        className="input block min-w-0 appearance-none tabular-nums [&::-webkit-date-and-time-value]:text-left"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        {...fieldAria(id, error, !!(be ?? hint))}
        onChange={e => onChange(e.target.value)}
      />
    </Field>
  )
}

/** ช่องเวลา 24 ชม. (HH:MM) */
export function TimeField({
  id, label, value, onChange, disabled, error, hint,
}: {
  id: string
  label: ReactNode
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  error?: string | null
  hint?: ReactNode
}) {
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <div className="flex items-center gap-1">
        <input
          id={id}
          type="time"
          step={300}
          className="input min-w-0 flex-1 appearance-none px-2 tabular-nums [&::-webkit-date-and-time-value]:text-left"
          value={value}
          disabled={disabled}
          {...fieldAria(id, error, !!hint)}
          onChange={e => onChange(e.target.value)}
        />
      </div>
    </Field>
  )
}

/** การ์ดส่วนของฟอร์ม (มี id ให้แถบลัดเลื่อนมาถึง)
 *  collapse = ทั้งส่วนพับได้ (หัวการ์ดเป็นปุ่ม aria-expanded ตามแบบ accordion: <h2><button>) — เนื้อหาซ่อนด้วย hidden ไม่ถอดออก */
export function FormSection({
  section, title, icon, children, actions, className, describe, collapse,
}: {
  section: SectionId
  title: ReactNode
  icon: ReactNode
  children: ReactNode
  actions?: ReactNode
  className?: string
  describe?: ReactNode
  collapse?: { open: boolean; onToggle: () => void; badge?: ReactNode }
}) {
  const id = sectionDomId(section)
  const bodyId = `${id}-body`
  return (
    <section id={id} className={clsx('card scroll-mt-4', className)} aria-labelledby={`${id}-title`}>
      {collapse ? (
        <div className={clsx('card-header', !collapse.open && 'border-b-0')}>
          <h2 id={`${id}-title`} className="min-w-0 flex-1">
            <button
              type="button"
              className="flex w-full min-h-[44px] items-center gap-2 text-left"
              aria-expanded={collapse.open}
              aria-controls={bodyId}
              onClick={collapse.onToggle}
            >
              <span className="min-w-0 flex-1">
                <span className="section-title">
                  {icon}
                  {title}
                </span>
                {describe && <span className="mt-0.5 block text-xs font-normal text-gray-500">{describe}</span>}
              </span>
              {collapse.badge}
              <ChevronDown
                size={20}
                strokeWidth={1.9}
                aria-hidden="true"
                className={clsx('shrink-0 text-gray-500 transition-transform', collapse.open && 'rotate-180')}
              />
            </button>
          </h2>
        </div>
      ) : (
        <div className="card-header flex-wrap gap-2">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="section-title">
              {icon}
              {title}
            </h2>
            {describe && <p className="mt-0.5 text-xs text-gray-500">{describe}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {/* div นี้ห้ามใส่คลาสที่ตั้ง display (grid/flex) — ไม่งั้นทับ [hidden] ของ preflight แล้วไม่ซ่อน */}
      <div id={bodyId} hidden={collapse ? !collapse.open : undefined} className="p-4 sm:p-5 space-y-4">{children}</div>
    </section>
  )
}

/**
 * สถานะเปิด/ปิดของกล่องพับ (ข้อมูลไม่หายเมื่อพับ — แค่ซ่อน)
 * - initialOpen: เปิดไว้ตั้งแต่แรกถ้าช่องข้างในมีค่าอยู่แล้ว (แก้ไขงาน / กู้ฟอร์มที่กรอกค้าง)
 *   ประเมินตอน mount เท่านั้น — ฟอร์มหลัก remount ทุกส่วนเมื่อแทนที่ฟอร์มทั้งก้อน (กู้ฟอร์ม/ล้างฟอร์ม)
 *   ค่าที่ระบบเติมให้ระหว่างกรอก (เช่น เลือกแพ็กเกจแล้วได้งานที่ส่งตามแพ็กเกจ) จึงไม่เด้งเปิดกล่อง
 * - problem: มีช่องผิด/คำเตือน (เช่น ทีมชนคิว) ข้างใน → เปิดเองตอนที่เพิ่งเกิด (ผู้ใช้พับเองทีหลังได้ หัวกล่องขึ้นป้าย "ต้องแก้")
 * - signal: เลขที่เปลี่ยนเมื่อกดแถบลัดไปส่วนนี้ / กดบันทึกแล้วยังไม่ครบ → เปิดถ้ามีช่องผิดข้างใน หรือ openOnSignal (ทั้งส่วนพับไว้)
 */
export function useDisclosure(initialOpen: boolean, problem: boolean, signal = 0, openOnSignal = false) {
  const [open, setOpen] = useState(initialOpen || problem)
  useEffect(() => {
    if (problem) setOpen(true)
  }, [problem])
  // จำเลขตอน mount — remount แล้วไม่ถือว่าเป็นการกดใหม่
  const seen = useRef(signal)
  useEffect(() => {
    if (signal === seen.current) return
    seen.current = signal
    if (signal !== 0 && (problem || openOnSignal)) setOpen(true)
    // ตอบสนองเฉพาะตอนเลข signal เปลี่ยน (problem/openOnSignal อ่านค่าล่าสุดของรอบนั้น)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal])
  return [open, setOpen] as const
}

/** ป้ายบนหัวกล่องตอนพับ: มีช่องผิด = "ต้องแก้" (แดง) ; มีข้อมูล = "มีข้อมูล N ช่อง" */
export function FoldBadge({ problem, filled }: { problem: boolean; filled: number }) {
  if (problem) return <span className="badge-out shrink-0">ต้องแก้</span>
  if (filled > 0) return <span className="chip shrink-0 tabular-nums">มีข้อมูล {filled} ช่อง</span>
  return null
}

/**
 * กล่องพับ "ข้อมูลเพิ่มเติม (ไม่บังคับ)" ในส่วนของฟอร์ม — ปุ่ม aria-expanded สูง ≥ 44px กดด้วยคีย์บอร์ดได้
 * contents = บอกว่าข้างในมีช่องอะไร (แสดงตอนพับ) ; filled = จำนวนช่องที่มีค่า (ป้าย "มีข้อมูล N ช่อง")
 */
export function MoreFields({
  label = 'ข้อมูลเพิ่มเติม (ไม่บังคับ)',
  contents,
  filled,
  initialOpen,
  problem,
  signal = 0,
  children,
}: {
  label?: ReactNode
  contents?: ReactNode
  filled: number
  initialOpen: boolean
  problem: boolean
  signal?: number
  children: ReactNode
}) {
  const uid = useId()
  const bodyId = `${uid}-more`
  const [open, setOpen] = useDisclosure(initialOpen, problem, signal)
  return (
    <div className="rounded-lg border border-gray-200">
      <button
        type="button"
        className="flex w-full min-h-[44px] items-center gap-2 rounded-lg px-3 py-2 text-left"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(o => !o)}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-brand-700">{label}</span>
          {!open && contents && <span className="block text-xs text-gray-500 break-words">{contents}</span>}
        </span>
        {!open && <FoldBadge problem={problem} filled={filled} />}
        <ChevronDown
          size={18}
          strokeWidth={1.9}
          aria-hidden="true"
          className={clsx('shrink-0 text-gray-500 transition-transform', open && 'rotate-180')}
        />
      </button>
      {/* ห้ามใส่คลาส display (grid/flex) ที่ div นี้ — ทับ [hidden] */}
      <div id={bodyId} hidden={!open} className="space-y-4 border-t border-gray-200 p-3 sm:p-4">
        {children}
      </div>
    </div>
  )
}

/** สวิตช์เปิด/ปิด (ปุ่มเต็มแถว แตะง่าย) */
export function SwitchRow({
  checked, onChange, disabled, label, sub, icon,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label: ReactNode
  sub?: ReactNode
  icon?: ReactNode
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full min-h-[44px] items-center justify-between gap-3 text-left text-sm font-semibold text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="min-w-0 flex items-center gap-2">
        {icon}
        <span className="min-w-0">
          {label}
          {sub && <span className="block text-xs font-normal text-gray-500">{sub}</span>}
        </span>
      </span>
      <span aria-hidden="true" className={clsx('switch shrink-0', checked && 'switch-on')}>
        <span className="switch-knob" />
      </span>
    </button>
  )
}
