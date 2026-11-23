'use client'
// ส่วน "ยอดเงิน" ของฟอร์มงาน: ค่าเดินทาง ส่วนลด (+ เหตุผล) วันครบกำหนดชำระยอดคงเหลือ (กำหนดเองได้)
// + สรุปยอดจากฐานข้อมูล (มือถือแสดงในส่วนนี้ — จอกว้างอยู่ที่แถบสรุปข้างจอ)
import type { ReactNode } from 'react'
import { useId } from 'react'
import { Wallet } from 'lucide-react'
import { ICON } from '@/components/theme/icons'
import { baht, formatThaiDate } from '@/lib/format'
import { balanceDueShortNotice, type WedQuote } from '@/lib/wedding'
import { MAX_DISCOUNT_NOTE, checkMoney, type CoreCheck, type WedDraft } from './model'
import { DateField, Field, FormSection, MoneyInput, fieldAria } from './fields'

export default function MoneySection({
  draft,
  patch,
  check,
  quote,
  balanceDueDays,
  summary,
  disabled,
}: {
  draft: WedDraft
  patch: (p: Partial<WedDraft>) => void
  check: CoreCheck
  quote: WedQuote | null
  balanceDueDays: number
  /** สรุปยอด (แสดงเฉพาะจอเล็ก) */
  summary: ReactNode
  disabled?: boolean
}) {
  const uid = useId()
  const disc = checkMoney(draft.discount, 'ส่วนลด')
  const discountTooBig = !!quote && !quote.discount_ok
  const discountErr = check.money.discount ?? (discountTooBig && quote ? `ส่วนลดต้องไม่เกิน ${baht(quote.money.pre_discount_total)}` : null)
  // วันครบกำหนดตามนโยบาย (วันงานแรก − จำนวนวัน) — มาจาก wed_quote เมื่อไม่ได้กำหนดเอง
  const policyDate = quote && !draft.balanceDueOverride ? quote.money.balance_due_date : null
  // งานกระชั้นชิด: ฐานข้อมูลเลื่อนวันชำระไม่ให้ก่อนวันจอง → ไม่ใช่ "ก่อนวันงานแรก N วัน" แล้ว
  const firstDate = quote?.sessions.filter(s => s.status !== 'cancelled' && s.date).map(s => s.date as string).sort()[0] ?? null
  const shortNotice = balanceDueShortNotice(policyDate, firstDate, balanceDueDays)

  return (
    <FormSection section="money" title="ค่าเดินทาง ส่วนลด และการชำระ" icon={<Wallet {...ICON} />}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id={`${uid}-travel`} label="ค่าเดินทาง (บาท)" error={check.money.travelFee} hint="งานนอกพื้นที่ / ค่าที่พักทีม (ไม่มีให้เว้นว่าง)">
          <MoneyInput
            id={`${uid}-travel`}
            value={draft.travelFee}
            onChange={v => patch({ travelFee: v })}
            disabled={disabled}
            error={check.money.travelFee}
            describedBy={`${uid}-travel-hint`}
          />
        </Field>
        <Field id={`${uid}-disc`} label="ส่วนลด (บาท)" error={discountErr} hint="ไม่มีส่วนลดให้เว้นว่าง">
          <MoneyInput
            id={`${uid}-disc`}
            value={draft.discount}
            onChange={v => patch({ discount: v })}
            disabled={disabled}
            error={discountErr}
            describedBy={`${uid}-disc-hint`}
          />
        </Field>
        <Field id={`${uid}-dnote`} label="เหตุผลส่วนลด" error={check.money.discountNote} className="sm:col-span-2">
          <input
            id={`${uid}-dnote`}
            className="input"
            maxLength={MAX_DISCOUNT_NOTE}
            value={draft.discountNote}
            placeholder="เช่น โปรจองล่วงหน้า / ลูกค้าแนะนำ"
            disabled={disabled || disc.value <= 0}
            {...fieldAria(`${uid}-dnote`, check.money.discountNote)}
            onChange={e => patch({ discountNote: e.target.value })}
          />
        </Field>
        <DateField
          id={`${uid}-bal`}
          label="ครบกำหนดชำระยอดคงเหลือ (กำหนดเอง)"
          value={draft.balanceDueOverride}
          onChange={v => patch({ balanceDueOverride: v })}
          disabled={disabled}
          error={check.money.balanceDueOverride}
          hint={policyDate
            ? `เว้นว่าง = ${formatThaiDate(policyDate)} (${shortNotice ? 'งานกระชั้นชิด — ภายในวันที่จอง' : `ก่อนวันงานแรก ${balanceDueDays} วัน`})`
            : `เว้นว่าง = ก่อนวันงานแรก ${balanceDueDays} วัน`}
          className="sm:col-span-2 sm:max-w-sm"
        />
        {draft.balanceDueOverride && (
          <button
            type="button"
            className="btn-ghost -mt-2 justify-self-start px-2 text-sm"
            disabled={disabled}
            onClick={() => patch({ balanceDueOverride: '' })}
          >
            ใช้ตามนโยบายร้าน
          </button>
        )}
      </div>

      <div className="lg:hidden">
        <hr className="divider !mt-0" />
        {summary}
      </div>
    </FormSection>
  )
}
