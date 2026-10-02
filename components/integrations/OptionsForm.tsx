'use client'
// ตัวเลือกของช่องทาง (ChannelOptionsInput) — ส่งเฉพาะค่าที่แก้ (partial update ตาม save_channel_options)
// ตัวเลือกที่แพลตฟอร์มทำไม่ได้ในรอบนี้ (capabilities) ปิดไว้พร้อมบอกเหตุผล
import { useEffect, useId, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { Loader2, Save, SlidersHorizontal } from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { PLATFORM_META } from '@/lib/integrations/platforms'
import type { ChannelJson, ChannelOptionsInput } from '@/lib/integrations/types'
import { saveOptions } from '@/app/(dashboard)/settings/integrations/actions'
import { FlashMessage, type Flash } from './bits'
import { callAction, useRunner } from './useAction'

type Form = {
  display_name: string
  push_stock: boolean
  pull_orders: boolean
  shadow_mode: boolean
  stock_buffer: string
  zero_at_or_below: string
  deduct_on: 'created' | 'paid'
  restock_returns: 'manual' | 'auto'
  poll_minutes: string
}

function fromChannel(c: ChannelJson): Form {
  return {
    display_name: c.display_name,
    push_stock: c.options.push_stock,
    pull_orders: c.options.pull_orders,
    shadow_mode: c.options.shadow_mode,
    stock_buffer: String(c.options.stock_buffer ?? 0),
    zero_at_or_below: String(c.options.zero_at_or_below ?? 0),
    deduct_on: c.options.deduct_on === 'paid' ? 'paid' : 'created',
    restock_returns: c.options.restock_returns === 'auto' ? 'auto' : 'manual',
    poll_minutes: String(Math.max(1, Math.round((c.options.poll_seconds ?? 900) / 60))),
  }
}

// เหตุผลที่ปิดตัวเลือก (ข้อความไทยสั้นๆ)
function pushReason(c: ChannelJson): string {
  const meta = PLATFORM_META[c.platform]
  if (meta.capabilities.pushStock && c.db_capabilities.push_stock) return ''
  if (meta.phase === 'fallback') return 'ช่องทางนี้ไม่มี API ส่งสต๊อก — ใช้ "ส่งออก CSV สต๊อก" หรือลิงก์ฟีดแทน'
  if (meta.phase === 'auth_only') return 'รออนุมัติ API — เปิดส่งสต๊อกได้ในรอบถัดไป'
  return 'แพลตฟอร์มนี้ส่งสต๊อกผ่าน API ไม่ได้'
}
function pullReason(c: ChannelJson): string {
  const meta = PLATFORM_META[c.platform]
  if (meta.capabilities.pullOrders && c.db_capabilities.pull_orders) return ''
  if (c.platform === 'meta') return 'Facebook/IG ในไทยไม่มีระบบออเดอร์ให้ดึง — ขายผ่านแชตให้บันทึกที่หน้าขาย'
  if (meta.phase === 'fallback') return 'ช่องทางนี้ไม่มี API ออเดอร์ — ใช้ "นำเข้า CSV ออเดอร์" แทน'
  if (meta.phase === 'auth_only') return 'รออนุมัติ API — เปิดดึงออเดอร์ได้ในรอบถัดไป'
  return 'แพลตฟอร์มนี้ดึงออเดอร์ผ่าน API ไม่ได้'
}

function intIn(text: string, min: number, max: number): number | null {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n >= min && n <= max ? n : null
}

export default function OptionsForm({ channel }: { channel: ChannelJson }) {
  const router = useRouter()
  const formId = useId()
  // โหลดข้อมูลใหม่จากส่วนอื่นของหน้า (เช่น บันทึกคีย์) ไม่ล้างค่าที่กำลังแก้ — รีเซ็ตเฉพาะเมื่อค่าบนเซิร์ฟเวอร์เปลี่ยนจริง
  const serverKey = JSON.stringify([channel.options, channel.display_name])
  const initial = useMemo(() => fromChannel(channel), [serverKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const [form, setForm] = useState<Form>(initial)
  const [flash, setFlash] = useState<Flash | null>(null)
  const { busy, run } = useRunner()

  useEffect(() => { setForm(initial) }, [initial])

  const pushOff = pushReason(channel)
  const pullOff = pullReason(channel)
  const ordersRelevant = !pullOff || PLATFORM_META[channel.platform].capabilities.csvImport

  const buffer = intIn(form.stock_buffer, 0, 1000)
  const zero = intIn(form.zero_at_or_below, 0, 1000)
  const pollMin = intIn(form.poll_minutes, 1, 1440)
  const nameTrim = form.display_name.trim()
  const nameOk = nameTrim.length >= 1 && nameTrim.length <= 100

  function diff(): { opts: ChannelOptionsInput; name?: string } {
    const opts: ChannelOptionsInput = {}
    const o = channel.options
    if (form.push_stock !== o.push_stock) opts.push_stock = form.push_stock
    if (form.pull_orders !== o.pull_orders) opts.pull_orders = form.pull_orders
    if (form.shadow_mode !== o.shadow_mode) opts.shadow_mode = form.shadow_mode
    if (buffer !== null && buffer !== o.stock_buffer) opts.stock_buffer = buffer
    if (zero !== null && zero !== o.zero_at_or_below) opts.zero_at_or_below = zero
    if (form.deduct_on !== o.deduct_on) opts.deduct_on = form.deduct_on
    if (form.restock_returns !== o.restock_returns) opts.restock_returns = form.restock_returns
    if (pollMin !== null && pollMin * 60 !== o.poll_seconds) opts.poll_seconds = pollMin * 60
    const name = nameOk && nameTrim !== channel.display_name ? nameTrim : undefined
    return { opts, name }
  }
  const { opts, name } = diff()
  const dirty = Object.keys(opts).length > 0 || name !== undefined
  const invalid = buffer === null || zero === null || (!pullOff && pollMin === null) || !nameOk

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    setFlash(null)
    if (invalid) { setFlash({ ok: false, text: 'ตรวจตัวเลขที่กรอกอีกครั้ง (กันสต๊อก 0–1000, รอบดึงออเดอร์ 1–1440 นาที)' }); return }
    if (!dirty) return
    await run('save', async () => {
      const res = await callAction(() => saveOptions(channel.id, opts, name))
      if (!res.ok) { setFlash({ ok: false, text: res.error }); return }
      const q = res.enqueued > 0 ? ` · เข้าคิวส่งสต๊อกใหม่ ${res.enqueued} รายการ` : ''
      setFlash({ ok: true, text: `บันทึกตัวเลือกแล้ว${q}` })
      router.refresh()
    })
  }

  const disabled = busy !== null

  return (
    <section className="card p-4 sm:p-5 space-y-4" aria-labelledby={`${formId}-title`}>
      <h2 id={`${formId}-title`} className="section-title">
        <SlidersHorizontal {...ICON} className="text-brand-600" />
        ตัวเลือกการซิงก์
      </h2>

      <form onSubmit={onSave} className="space-y-4" noValidate>
        <div>
          <label htmlFor={`${formId}-name`} className="field-label">ชื่อที่แสดง</label>
          <input
            id={`${formId}-name`}
            className="input"
            value={form.display_name}
            maxLength={100}
            disabled={disabled}
            aria-invalid={!nameOk ? true : undefined}
            onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <SwitchRow
            label="ส่งสต๊อกไปแพลตฟอร์ม"
            on={form.push_stock}
            disabled={disabled || (!!pushOff && !form.push_stock)}
            reason={pushOff}
            hint={!pushOff && !channel.options.initial_push_done ? 'ยังไม่ส่งจริงจนกว่าจะกด "ส่งสต๊อกครั้งแรก"' : ''}
            onToggle={() => setForm(f => ({ ...f, push_stock: !f.push_stock }))}
          />
          <SwitchRow
            label="ดึงออเดอร์มาตัดสต๊อก"
            on={form.pull_orders}
            disabled={disabled || (!!pullOff && !form.pull_orders)}
            reason={pullOff}
            onToggle={() => setForm(f => ({ ...f, pull_orders: !f.pull_orders }))}
          />
          {ordersRelevant && (
            <SwitchRow
              label="โหมดทดลอง (บันทึกออเดอร์แต่ยังไม่ตัดสต๊อก)"
              on={form.shadow_mode}
              disabled={disabled}
              hint="ใช้ช่วงแรกเพื่อตรวจว่าออเดอร์เข้าถูก — เปลี่ยนเป็นตัดจริงรายออเดอร์ได้ภายหลัง"
              onToggle={() => setForm(f => ({ ...f, shadow_mode: !f.shadow_mode }))}
            />
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <NumberRow
            id={`${formId}-buffer`}
            label="กันสต๊อกไว้ (ชิ้น)"
            value={form.stock_buffer}
            invalid={buffer === null}
            disabled={disabled}
            help="ส่งไปแพลตฟอร์ม = สต๊อก − จำนวนนี้ (ไม่ต่ำกว่า 0) กันขายเกินตอนขายหลายช่องทางพร้อมกัน"
            onChange={v => setForm(f => ({ ...f, stock_buffer: v }))}
          />
          <NumberRow
            id={`${formId}-zero`}
            label="ส่ง 0 เมื่อเหลือไม่เกิน (ชิ้น)"
            value={form.zero_at_or_below}
            invalid={zero === null}
            disabled={disabled}
            help="0 = ปิด ; เช่น 1 = เหลือชิ้นเดียวให้ขึ้นว่าหมดบนแพลตฟอร์มนี้"
            onChange={v => setForm(f => ({ ...f, zero_at_or_below: v }))}
          />
        </div>

        {ordersRelevant && (
          <div className="grid gap-4 sm:grid-cols-2">
            <ChoiceRow
              label="ตัดสต๊อกเมื่อ"
              value={form.deduct_on}
              disabled={disabled}
              options={[
                { value: 'created', label: 'มีออเดอร์เข้า' },
                { value: 'paid', label: 'ลูกค้าจ่ายเงินแล้ว' },
              ]}
              help="แนะนำ: มีออเดอร์เข้า (กันขายเกินระหว่างรอจ่าย)"
              onChange={v => setForm(f => ({ ...f, deduct_on: v as Form['deduct_on'] }))}
            />
            <ChoiceRow
              label="คืนสต๊อกเมื่อลูกค้าคืนของ"
              value={form.restock_returns}
              disabled={disabled}
              options={[
                { value: 'manual', label: 'แอดมินยืนยัน' },
                { value: 'auto', label: 'อัตโนมัติ' },
              ]}
              help="แนะนำ: แอดมินยืนยัน (นับของที่กลับมาจริงก่อน)"
              onChange={v => setForm(f => ({ ...f, restock_returns: v as Form['restock_returns'] }))}
            />
          </div>
        )}

        {!pullOff && (
          <div className="sm:max-w-xs">
            <NumberRow
              id={`${formId}-poll`}
              label="ดึงออเดอร์ซ้ำทุก (นาที)"
              value={form.poll_minutes}
              invalid={pollMin === null}
              disabled={disabled}
              help="ดึงซ้ำกันพลาด webhook — 1 ถึง 1440 นาที"
              onChange={v => setForm(f => ({ ...f, poll_minutes: v }))}
            />
          </div>
        )}

        <FlashMessage flash={flash} />

        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="submit" disabled={disabled || !dirty || invalid} className="btn-primary w-full sm:w-auto px-5">
            {busy === 'save' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Save {...ICON_SM} />}
            บันทึกตัวเลือก
          </button>
          {dirty && (
            <button type="button" onClick={() => { setForm(initial); setFlash(null) }} disabled={disabled} className="btn-ghost w-full sm:w-auto px-5">
              ยกเลิกการแก้ไข
            </button>
          )}
        </div>
      </form>
    </section>
  )
}

function SwitchRow({
  label, on, disabled, reason, hint, onToggle,
}: {
  label: string; on: boolean; disabled: boolean; reason?: string; hint?: string; onToggle: () => void
}) {
  const note = reason || hint || ''
  return (
    <div className="panel p-3 space-y-1.5">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={onToggle}
        disabled={disabled}
        className="flex w-full min-h-[44px] items-center justify-between gap-3 text-left text-sm font-semibold text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="min-w-0 break-words">{label}</span>
        <span aria-hidden="true" className={clsx('switch', on && 'switch-on')}>
          <span className="switch-knob" />
        </span>
      </button>
      {note && <p className={clsx('text-xs break-words', reason ? 'text-amber-800' : 'text-gray-500')}>{note}</p>}
    </div>
  )
}

function NumberRow({
  id, label, value, invalid, disabled, help, onChange,
}: {
  id: string; label: string; value: string; invalid: boolean; disabled: boolean; help?: string; onChange: (v: string) => void
}) {
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        className="input tabular-nums"
        value={value}
        disabled={disabled}
        aria-invalid={invalid ? true : undefined}
        onChange={e => onChange(e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
      />
      {help && <p className="field-hint">{help}</p>}
    </div>
  )
}

function ChoiceRow({
  label, value, options, disabled, help, onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  disabled: boolean
  help?: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <p className="field-label">{label}</p>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={label}>
        {options.map(o => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            disabled={disabled}
            className="choice"
          >
            {o.label}
          </button>
        ))}
      </div>
      {help && <p className="field-hint">{help}</p>}
    </div>
  )
}
