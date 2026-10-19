'use client'
import { useId, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  AlertTriangle, Banknote, ClipboardList, Hourglass, Pencil, ShieldCheck, StickyNote, Store, Tag, Truck, Wallet,
} from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { baht } from '@/lib/format'
import { round2 } from '@/lib/money'
import {
  METHOD_LABELS, RENTAL_CASH_METHODS, SOURCE_LABELS,
  type RentalCashMethod, type RentalQuote,
} from '@/lib/rental'
import {
  MAX_ADDRESS, MAX_DISCOUNT_NOTE, MAX_HOLD_HOURS, MAX_NOTE, MAX_PAY_NOTE, STAFF_SOURCES, checkMoney,
  type PaymentPlan, type WizardDraft, type WizardMode,
} from './model'

// ขั้นที่ 4: สรุป — วิธีรับชุด ส่วนลด เงินประกัน สถานะ/ช่องทาง หมายเหตุ + (สร้างใหม่) รับเงินมัดจำ/เงินประกันพร้อมบันทึก
// ยอดเงินทุกตัวมาจาก rental_quote (คำนวณใหม่อัตโนมัติทุกครั้งที่แก้ช่องในหน้านี้)

function MoneyInput({
  id, value, onChange, disabled, invalid, placeholder, describedBy,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  invalid?: boolean
  placeholder?: string
  describedBy?: string
}) {
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className="input text-right font-semibold tabular-nums"
      placeholder={placeholder ?? '0'}
      value={value}
      disabled={disabled}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
      onChange={e => onChange(e.target.value)}
      onFocus={e => e.currentTarget.select()}
    />
  )
}

function MethodPicker({
  value, onChange, disabled, label,
}: {
  value: RentalCashMethod
  onChange: (m: RentalCashMethod) => void
  disabled?: boolean
  label: string
}) {
  return (
    <div>
      <p className="field-label">{label}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label={label}>
        {RENTAL_CASH_METHODS.map(m => (
          <button
            key={m}
            type="button"
            className="choice px-1"
            aria-pressed={value === m}
            disabled={disabled}
            onClick={() => onChange(m)}
          >
            {METHOD_LABELS[m]}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function SummaryStep({
  mode,
  draft,
  patch,
  quote,
  cart,
  money,
  plan,
  holdProblem,
  onEditItems,
  disabled,
}: {
  mode: WizardMode
  draft: WizardDraft
  patch: (p: Partial<WizardDraft>) => void
  quote: RentalQuote | null
  cart: ReactNode
  money: ReactNode
  plan: PaymentPlan
  holdProblem: string | null
  onEditItems: () => void
  disabled?: boolean
}) {
  const id = useId()
  const disc = checkMoney(draft.discount, 'ส่วนลด')
  const fee = checkMoney(draft.deliveryFee, 'ค่าจัดส่ง')
  const sec = checkMoney(draft.securityOverride, 'เงินประกัน')
  const discountTooBig = quote !== null && disc.problem === null && disc.value > quote.rent_total + 0.005
  const create = mode === 'create'
  const secAllowed = draft.status === 'confirmed'

  return (
    <div className="space-y-4">
      {/* ===== รายการชุด ===== */}
      <section className="card overflow-hidden" aria-labelledby={`${id}-items`}>
        <div className="card-header">
          <h2 id={`${id}-items`} className="section-title">
            <ClipboardList {...ICON} />
            รายการชุด
          </h2>
          <button type="button" onClick={onEditItems} disabled={disabled} className="btn-ghost px-3 text-sm">
            <Pencil {...ICON_SM} />
            แก้ไข
          </button>
        </div>
        <div className="px-4 sm:px-5">{cart}</div>
      </section>

      {/* ===== วิธีรับชุด ===== */}
      <section className="card p-4 sm:p-5 space-y-3" aria-labelledby={`${id}-delivery`}>
        <h2 id={`${id}-delivery`} className="section-title">
          <Truck {...ICON} />
          การรับชุด
        </h2>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="วิธีรับชุด">
          <button
            type="button"
            className="choice flex-row gap-2"
            aria-pressed={draft.deliveryMethod === 'pickup'}
            disabled={disabled}
            onClick={() => patch({ deliveryMethod: 'pickup' })}
          >
            <Store {...ICON_SM} />
            รับที่ร้าน
          </button>
          <button
            type="button"
            className="choice flex-row gap-2"
            aria-pressed={draft.deliveryMethod === 'delivery'}
            disabled={disabled}
            onClick={() => patch({ deliveryMethod: 'delivery' })}
          >
            <Truck {...ICON_SM} />
            จัดส่ง
          </button>
        </div>
        {draft.deliveryMethod === 'delivery' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
            <div className="min-w-0">
              <label htmlFor={`${id}-addr`} className="field-label">ที่อยู่จัดส่ง</label>
              <textarea
                id={`${id}-addr`}
                className="input"
                rows={2}
                maxLength={MAX_ADDRESS}
                value={draft.deliveryAddress}
                disabled={disabled}
                onChange={e => patch({ deliveryAddress: e.target.value })}
              />
            </div>
            <div className="min-w-0">
              <label htmlFor={`${id}-fee`} className="field-label">ค่าจัดส่ง (บาท)</label>
              <MoneyInput
                id={`${id}-fee`}
                value={draft.deliveryFee}
                onChange={v => patch({ deliveryFee: v })}
                disabled={disabled}
                invalid={fee.problem !== null}
                describedBy={fee.problem ? `${id}-fee-err` : undefined}
              />
              {fee.problem && <p id={`${id}-fee-err`} role="alert" className="mt-1 text-sm text-red-700">{fee.problem}</p>}
            </div>
          </div>
        )}
      </section>

      {/* ===== ส่วนลด + เงินประกัน ===== */}
      <section className="card p-4 sm:p-5 space-y-4" aria-labelledby={`${id}-disc`}>
        <h2 id={`${id}-disc`} className="section-title">
          <Tag {...ICON} />
          ส่วนลดและเงินประกัน
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
          <div className="min-w-0">
            <label htmlFor={`${id}-discount`} className="field-label">ส่วนลด (บาท)</label>
            <MoneyInput
              id={`${id}-discount`}
              value={draft.discount}
              onChange={v => patch({ discount: v })}
              disabled={disabled}
              invalid={disc.problem !== null || discountTooBig}
              describedBy={`${id}-discount-hint`}
            />
            <p id={`${id}-discount-hint`} className={clsx('mt-1 text-sm', disc.problem || discountTooBig ? 'text-red-700' : 'field-hint')}>
              {disc.problem ?? (discountTooBig && quote ? `ส่วนลดต้องไม่เกินค่าเช่ารวม ${baht(quote.rent_total)}` : 'ไม่มีส่วนลดให้เว้นว่าง')}
            </p>
          </div>
          <div className="min-w-0">
            <label htmlFor={`${id}-discnote`} className="field-label">เหตุผลส่วนลด</label>
            <input
              id={`${id}-discnote`}
              className="input"
              maxLength={MAX_DISCOUNT_NOTE}
              value={draft.discountNote}
              placeholder="เช่น ลูกค้าประจำ / โปรโมชั่น"
              disabled={disabled || disc.value <= 0}
              onChange={e => patch({ discountNote: e.target.value })}
            />
          </div>
        </div>

        <div className="panel p-3 space-y-2">
          <button
            type="button"
            role="switch"
            aria-checked={draft.securityOverrideOn}
            disabled={disabled}
            onClick={() => patch({ securityOverrideOn: !draft.securityOverrideOn })}
            className="flex w-full min-h-[44px] items-center justify-between gap-3 text-left text-sm font-semibold text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="min-w-0 flex items-center gap-2">
              <ShieldCheck {...ICON_SM} className="shrink-0 text-brand-600" />
              กำหนดเงินประกันเอง
            </span>
            <span aria-hidden="true" className={clsx('switch', draft.securityOverrideOn && 'switch-on')}>
              <span className="switch-knob" />
            </span>
          </button>
          {draft.securityOverrideOn ? (
            <div className="max-w-[220px]">
              <label htmlFor={`${id}-sec`} className="field-label">เงินประกันทั้งการจอง (บาท)</label>
              <MoneyInput
                id={`${id}-sec`}
                value={draft.securityOverride}
                onChange={v => patch({ securityOverride: v })}
                disabled={disabled}
                invalid={sec.problem !== null || draft.securityOverride.trim() === ''}
              />
              {sec.problem && <p role="alert" className="mt-1 text-sm text-red-700">{sec.problem}</p>}
              <p className="field-hint">ใส่ 0 = ไม่เก็บเงินประกัน</p>
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              ใช้ค่าประกันของแต่ละชุดรวมกัน{quote ? ` (${baht(quote.security_required)})` : ''}
            </p>
          )}
        </div>
      </section>

      {/* ===== สถานะ + ช่องทาง (สร้างใหม่) ===== */}
      {create && (
        <section className="card p-4 sm:p-5 space-y-4" aria-labelledby={`${id}-status`}>
          <h2 id={`${id}-status`} className="section-title">
            <Hourglass {...ICON} />
            สถานะการจอง
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="สถานะเริ่มต้น">
            <button
              type="button"
              className="choice items-start px-3 text-left"
              aria-pressed={draft.status === 'confirmed'}
              disabled={disabled}
              onClick={() => patch({ status: 'confirmed' })}
            >
              <span className="font-semibold">ยืนยันการจองเลย</span>
              <span className="text-xs font-normal text-gray-500">กันชุดไว้ให้ลูกค้าจนถึงวันรับ</span>
            </button>
            <button
              type="button"
              className="choice items-start px-3 text-left"
              aria-pressed={draft.status === 'pending'}
              disabled={disabled}
              onClick={() => patch({ status: 'pending', secOn: false })}
            >
              <span className="font-semibold">ถือคิวไว้ก่อน (รอยืนยัน)</span>
              <span className="text-xs font-normal text-gray-500">หมดเวลาแล้วระบบปล่อยชุดคืนอัตโนมัติ</span>
            </button>
          </div>
          {draft.status === 'pending' && (
            <div className="max-w-[220px]">
              <label htmlFor={`${id}-hold`} className="field-label">ถือคิวไว้ (ชั่วโมง)</label>
              <input
                id={`${id}-hold`}
                type="text"
                inputMode="numeric"
                className="input text-right tabular-nums"
                value={draft.holdHours}
                maxLength={3}
                disabled={disabled}
                aria-invalid={holdProblem ? true : undefined}
                onChange={e => patch({ holdHours: e.target.value })}
              />
              <p className={clsx('mt-1 text-sm', holdProblem ? 'text-red-700' : 'field-hint')}>
                {holdProblem ?? `1 ถึง ${MAX_HOLD_HOURS} ชั่วโมง (7 วัน)`}
              </p>
            </div>
          )}
          <div>
            <p className="field-label">ช่องทางที่ลูกค้าติดต่อ</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="ช่องทางการจอง">
              {STAFF_SOURCES.map(s => (
                <button
                  key={s}
                  type="button"
                  className="chip-toggle"
                  aria-pressed={draft.source === s}
                  disabled={disabled}
                  onClick={() => patch({ source: s })}
                >
                  {SOURCE_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ===== หมายเหตุ ===== */}
      <section className="card p-4 sm:p-5 space-y-2" aria-labelledby={`${id}-note`}>
        <h2 id={`${id}-note`} className="section-title">
          <StickyNote {...ICON} />
          หมายเหตุภายในร้าน
        </h2>
        <textarea
          className="input"
          rows={3}
          maxLength={MAX_NOTE}
          value={draft.note}
          placeholder="เช่น ต้องแก้ความยาวกระโปรง / ลูกค้าขอรับก่อนเที่ยง"
          disabled={disabled}
          aria-labelledby={`${id}-note`}
          onChange={e => patch({ note: e.target.value })}
        />
      </section>

      {/* ===== สรุปยอดเงิน ===== */}
      <section className="card p-4 sm:p-5 space-y-3" aria-labelledby={`${id}-money`}>
        <h2 id={`${id}-money`} className="section-title">
          <Wallet {...ICON} />
          สรุปยอดเงิน
        </h2>
        {money}
      </section>

      {/* ===== รับเงินตอนนี้ (สร้างใหม่) ===== */}
      {create && (
        <section className="card p-4 sm:p-5 space-y-4" aria-labelledby={`${id}-pay`}>
          <h2 id={`${id}-pay`} className="section-title">
            <Banknote {...ICON} />
            รับเงินพร้อมบันทึกการจอง
            <span className="text-sm font-normal text-gray-500">(ไม่บังคับ)</span>
          </h2>

          <div className="space-y-2">
            <p className="field-label">ค่าเช่า / มัดจำ</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="รับค่าเช่า">
              <button type="button" className="choice px-1" aria-pressed={draft.payMode === 'none'} disabled={disabled} onClick={() => patch({ payMode: 'none' })}>
                ยังไม่รับ
              </button>
              <button
                type="button"
                className="choice px-1"
                aria-pressed={draft.payMode === 'deposit'}
                disabled={disabled || !quote || quote.deposit_required <= 0}
                onClick={() => patch({ payMode: 'deposit' })}
              >
                <span>มัดจำ</span>
                {quote && <span className="text-xs font-semibold tabular-nums">{baht(quote.deposit_required)}</span>}
              </button>
              <button
                type="button"
                className="choice px-1"
                aria-pressed={draft.payMode === 'full'}
                disabled={disabled || !quote || quote.grand_total <= 0}
                onClick={() => patch({ payMode: 'full' })}
              >
                <span>เต็มจำนวน</span>
                {quote && <span className="text-xs font-semibold tabular-nums">{baht(quote.grand_total)}</span>}
              </button>
              <button type="button" className="choice px-1" aria-pressed={draft.payMode === 'custom'} disabled={disabled} onClick={() => patch({ payMode: 'custom' })}>
                ระบุจำนวน
              </button>
            </div>
            {draft.payMode === 'custom' && (
              <div className="max-w-[220px]">
                <label htmlFor={`${id}-payamt`} className="field-label">จำนวนเงินที่รับ (บาท)</label>
                <MoneyInput id={`${id}-payamt`} value={draft.payAmount} onChange={v => patch({ payAmount: v })} disabled={disabled} />
              </div>
            )}
            {draft.payMode !== 'none' && (
              <>
                <MethodPicker value={draft.payMethod} onChange={m => patch({ payMethod: m })} disabled={disabled} label="รับค่าเช่าโดย" />
                <input
                  className="input"
                  maxLength={MAX_PAY_NOTE}
                  value={draft.payNote}
                  placeholder="หมายเหตุ (ถ้ามี) เช่น เลขท้ายบัญชี"
                  aria-label="หมายเหตุการรับเงิน"
                  disabled={disabled}
                  onChange={e => patch({ payNote: e.target.value })}
                />
              </>
            )}
          </div>

          <div className="panel p-3 space-y-3">
            <button
              type="button"
              role="switch"
              aria-checked={draft.secOn}
              disabled={disabled || !secAllowed || !quote || quote.security_required <= 0}
              onClick={() => patch({ secOn: !draft.secOn })}
              className="flex w-full min-h-[44px] items-center justify-between gap-3 text-left text-sm font-semibold text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="min-w-0">
                รับเงินประกันตอนนี้
                {quote && quote.security_required > 0 && (
                  <span className="block text-xs font-normal text-gray-500">ต้องเก็บ {baht(quote.security_required)}</span>
                )}
              </span>
              <span aria-hidden="true" className={clsx('switch', draft.secOn && 'switch-on')}>
                <span className="switch-knob" />
              </span>
            </button>
            {!secAllowed && <p className="text-xs text-gray-500">รับเงินประกันได้เมื่อยืนยันการจองแล้ว</p>}
            {secAllowed && quote && quote.security_required <= 0 && <p className="text-xs text-gray-500">การจองนี้ไม่มีเงินประกันที่ต้องเก็บ</p>}
            {draft.secOn && (
              <>
                <div className="max-w-[220px]">
                  <label htmlFor={`${id}-secamt`} className="field-label">จำนวนเงินประกัน (บาท)</label>
                  <MoneyInput
                    id={`${id}-secamt`}
                    value={draft.secAmount}
                    onChange={v => patch({ secAmount: v })}
                    placeholder={quote ? String(quote.security_required) : '0'}
                    disabled={disabled}
                  />
                  <p className="field-hint">เว้นว่าง = รับเต็มจำนวนที่ต้องเก็บ</p>
                </div>
                <MethodPicker value={draft.secMethod} onChange={m => patch({ secMethod: m })} disabled={disabled} label="รับเงินประกันโดย" />
              </>
            )}
          </div>

          {plan.problem && (draft.payMode !== 'none' || draft.secOn) && (
            <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-red-700">
              <AlertTriangle {...ICON_SM} className="mt-px shrink-0" />
              <span className="min-w-0">{plan.problem}</span>
            </p>
          )}
          {plan.ok && plan.payments.length > 0 && (
            <p className="text-sm text-gray-600" aria-live="polite">
              จะออกใบเสร็จ {plan.payments.length} ใบ รวม <span className="money text-gray-900">{baht(round2(plan.rentAmount + plan.securityAmount))}</span>
            </p>
          )}
        </section>
      )}
    </div>
  )
}
