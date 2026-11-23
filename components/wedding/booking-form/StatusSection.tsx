'use client'
// ส่วน "สถานะงาน + รับเงิน" ของฟอร์ม
// สร้างใหม่: เลือกสถานะเริ่มต้น (สอบถาม / ล็อกคิวรอมัดจำ / ยืนยันงาน) + รับเงินพร้อมบันทึก (มัดจำ/เต็มจำนวน/ระบุเอง)
// แก้ไข: บอกสถานะปัจจุบัน — เปลี่ยนสถานะ (ล็อกคิว ยืนยัน เลื่อน ยกเลิก) และรับเงินทำที่หน้างาน
import { useId } from 'react'
import clsx from 'clsx'
import { AlertTriangle, Banknote, Hourglass, Info } from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { baht, formatThaiDateTime } from '@/lib/format'
import {
  WED_METHOD_LABELS, WED_PAYMENT_METHODS, WED_STATUS_CHIP, type WedBooking, type WedQuote,
} from '@/lib/wedding'
import { MAX_HOLD_HOURS, MAX_PAY_NOTE, type CreateStatus, type PaymentPlan, type WedDraft } from './model'
import { Field, FormSection, MoneyInput, fieldAria } from './fields'

const STATUS_CHOICES: readonly { value: CreateStatus; title: string; sub: string }[] = [
  { value: 'inquiry', title: 'สอบถาม', sub: 'ยังไม่กันคิว — บันทึกไว้ติดตามลูกค้า' },
  { value: 'hold', title: 'ล็อกคิว รอมัดจำ', sub: 'กันวันไว้ชั่วคราว หมดเวลาแล้วกลับเป็นสอบถาม' },
  { value: 'confirmed', title: 'ยืนยันงาน', sub: 'กันคิว + สร้างรายการงานที่ต้องส่ง' },
]

export default function StatusSection({
  create,
  booking,
  draft,
  patch,
  quote,
  plan,
  holdProblem,
  holdDefault,
  depositShort,
  disabled,
}: {
  create: boolean
  booking?: WedBooking | null
  draft: WedDraft
  patch: (p: Partial<WedDraft>) => void
  quote: WedQuote | null
  plan: PaymentPlan
  holdProblem: string | null
  holdDefault: number
  /** ยืนยันงานแต่รับเงินน้อยกว่ามัดจำ (ต้องยืนยันแบบบังคับตอนบันทึก) */
  depositShort: boolean
  disabled?: boolean
}) {
  const uid = useId()

  if (!create) {
    if (!booking) return null
    return (
      <FormSection section="status" title="สถานะงาน" icon={<Hourglass {...ICON} />}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={WED_STATUS_CHIP[booking.status]}>{booking.status_label}</span>
          {booking.status === 'hold' && booking.hold_until && (
            <span className="text-gray-600">ล็อกคิวถึง {formatThaiDateTime(booking.hold_until)}</span>
          )}
        </div>
        <p className="flex items-start gap-1.5 text-sm text-gray-600">
          <Info {...ICON_SM} className="mt-px shrink-0 text-brand-600" />
          <span className="min-w-0">
            เปลี่ยนสถานะ (ล็อกคิว ยืนยัน เลื่อนงาน ยกเลิก) รับเงิน แบ่งงวด และค่าใช้จ่ายเพิ่มเติม ทำได้ที่หน้างานหลังบันทึก
          </span>
        </p>
      </FormSection>
    )
  }

  const q = quote
  const deposit = q ? q.money.deposit_required : 0
  const grand = q ? q.money.grand_total : 0

  return (
    <FormSection section="status" title="สถานะงานและการรับเงิน" icon={<Hourglass {...ICON} />}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label="สถานะเริ่มต้นของงาน">
        {STATUS_CHOICES.map(c => (
          <button
            key={c.value}
            type="button"
            className="choice items-start px-3 text-left"
            aria-pressed={draft.status === c.value}
            disabled={disabled}
            onClick={() => patch({ status: c.value })}
          >
            <span className="font-semibold">{c.title}</span>
            <span className="text-xs font-normal text-gray-500">{c.sub}</span>
          </button>
        ))}
      </div>

      {draft.status === 'hold' && (
        <Field
          id={`${uid}-hold`}
          label="ล็อกคิวไว้ (ชั่วโมง)"
          error={holdProblem}
          hint={`1 ถึง ${MAX_HOLD_HOURS} ชั่วโมง (ค่าเริ่มต้นของร้าน ${holdDefault} ชม.) — มีเงินเข้าแล้วคิวไม่หลุดเอง`}
          className="max-w-xs"
        >
          <input
            id={`${uid}-hold`}
            type="text"
            inputMode="numeric"
            className="input text-right tabular-nums"
            value={draft.holdHours}
            maxLength={3}
            disabled={disabled}
            {...fieldAria(`${uid}-hold`, holdProblem, true)}
            onChange={e => patch({ holdHours: e.target.value })}
          />
        </Field>
      )}
      {draft.status !== 'inquiry' && (
        <p className="flex items-start gap-1.5 text-xs text-gray-600">
          <Info size={14} strokeWidth={2} aria-hidden="true" className="mt-px shrink-0 text-brand-600" />
          <span className="min-w-0">ทุกคิวต้องระบุวันที่ · ถ้าวันนั้นรับงานเต็มแล้ว ระบบจะให้กดยืนยันรับงานเกินก่อนบันทึก</span>
        </p>
      )}
      {draft.status === 'confirmed' && depositShort && (
        <div className="alert-warn" role="status">
          <AlertTriangle {...ICON_SM} />
          <p className="min-w-0">
            ยังไม่ได้รับมัดจำครบ ({baht(deposit)}) — บันทึกเป็น &quot;ยืนยันงาน&quot; ได้ แต่ต้องกดยืนยันอีกครั้ง
            หรือเลือกรับมัดจำด้านล่างพร้อมบันทึก
          </p>
        </div>
      )}

      <hr className="divider !my-0" />

      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Banknote {...ICON_SM} className="text-brand-600" />
          รับเงินพร้อมบันทึกงาน
          <span className="text-xs font-normal text-gray-500">(ไม่บังคับ)</span>
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="รับเงินตอนนี้">
          <button type="button" className="choice px-1" aria-pressed={draft.payMode === 'none'} disabled={disabled} onClick={() => patch({ payMode: 'none' })}>
            ยังไม่รับ
          </button>
          <button
            type="button"
            className="choice px-1"
            aria-pressed={draft.payMode === 'deposit'}
            disabled={disabled || !q || deposit <= 0}
            onClick={() => patch({ payMode: 'deposit' })}
          >
            <span>มัดจำ</span>
            {q && <span className="text-xs font-semibold tabular-nums">{baht(deposit)}</span>}
          </button>
          <button
            type="button"
            className="choice px-1"
            aria-pressed={draft.payMode === 'full'}
            disabled={disabled || !q || grand <= 0}
            onClick={() => patch({ payMode: 'full' })}
          >
            <span>เต็มจำนวน</span>
            {q && <span className="text-xs font-semibold tabular-nums">{baht(grand)}</span>}
          </button>
          <button type="button" className="choice px-1" aria-pressed={draft.payMode === 'custom'} disabled={disabled} onClick={() => patch({ payMode: 'custom' })}>
            ระบุจำนวน
          </button>
        </div>
        {draft.payMode === 'custom' && (
          <Field id={`${uid}-amt`} label="จำนวนเงินที่รับ (บาท)" className="max-w-xs">
            <MoneyInput id={`${uid}-amt`} value={draft.payAmount} onChange={v => patch({ payAmount: v })} disabled={disabled} />
          </Field>
        )}
        {draft.payMode !== 'none' && (
          <>
            <div>
              <p className="field-label">รับเงินโดย</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="วิธีรับเงิน">
                {WED_PAYMENT_METHODS.map(m => (
                  <button
                    key={m}
                    type="button"
                    className="choice px-1"
                    aria-pressed={draft.payMethod === m}
                    disabled={disabled}
                    onClick={() => patch({ payMethod: m })}
                  >
                    {WED_METHOD_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>
            <input
              className="input"
              maxLength={MAX_PAY_NOTE}
              value={draft.payNote}
              placeholder="หมายเหตุ (ถ้ามี) เช่น โอนจากบัญชีคุณ... / เลขท้ายบัญชี"
              aria-label="หมายเหตุการรับเงิน"
              disabled={disabled}
              onChange={e => patch({ payNote: e.target.value })}
            />
            <p className="text-xs text-gray-500">
              บันทึกเป็นวันที่รับเงินวันนี้ — แนบสลิป/รับเงินย้อนหลังได้ที่หน้างานหลังบันทึก
            </p>
          </>
        )}
        {plan.problem && draft.payMode !== 'none' && (
          <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-red-700">
            <AlertTriangle {...ICON_SM} className="mt-px shrink-0" />
            <span className="min-w-0">{plan.problem}</span>
          </p>
        )}
        {plan.ok && plan.amount > 0 && (
          <p className={clsx('text-sm text-gray-600')} aria-live="polite">
            จะออกใบเสร็จรับเงิน <span className="money text-gray-900">{baht(plan.amount)}</span> พร้อมบันทึกงาน
          </p>
        )}
      </div>
    </FormSection>
  )
}
