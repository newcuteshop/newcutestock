'use client'
// ช่องกรอกที่ใช้ซ้ำในฟอร์มงาน (ป้าย + ข้อความผิด/คำแนะนำ + ช่องเงิน/วัน/เวลา + การ์ดส่วนของฟอร์ม)
// ช่องกรอกทุกช่องใช้คลาส .input (มือถือ 16px ไม่ซูม, สูง ≥ 44px) — ข้อความผิดผูกกับช่องด้วย aria-describedby
import type { ReactNode } from 'react'
import clsx from 'clsx'
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

/** การ์ดส่วนของฟอร์ม (มี id ให้แถบลัดเลื่อนมาถึง) */
export function FormSection({
  section, title, icon, children, actions, className, describe,
}: {
  section: SectionId
  title: ReactNode
  icon: ReactNode
  children: ReactNode
  actions?: ReactNode
  className?: string
  describe?: ReactNode
}) {
  const id = sectionDomId(section)
  return (
    <section id={id} className={clsx('card scroll-mt-4', className)} aria-labelledby={`${id}-title`}>
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
      <div className="p-4 sm:p-5 space-y-4">{children}</div>
    </section>
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
