'use client'
// ส่วน "ยอดเงิน" ของฟอร์มงาน: ค่าเดินทาง ส่วนลด (+ เหตุผล) มัดจำ (พิมพ์เองได้ — ว่าง = อัตโนมัติ)
// วันครบกำหนดชำระยอดคงเหลือ (กำหนดเองได้)
// + สรุปยอดจากฐานข้อมูล (มือถือแสดงในส่วนนี้ — จอกว้างอยู่ที่แถบสรุปข้างจอ)
import type { ReactNode } from 'react'
import { useId } from 'react'
import { Wallet } from 'lucide-react'
import { ICON } from '@/components/theme/icons'
import { baht, formatThaiDate } from '@/lib/format'
import {
  balanceDueShortNotice, wedDepositCap, type WedBooking, type WedBookingStatus, type WedMoney, type WedQuote,
} from '@/lib/wedding'
import { MAX_DISCOUNT_NOTE, checkMoney, type CoreCheck, type WedDraft } from './model'
import { DateField, Field, FormSection, MoneyInput, fieldAria } from './fields'

/** ข้อความเมื่อฐานข้อมูลยังไม่รองรับมัดจำกำหนดเอง (ยังไม่ได้รัน fix-07 รุ่นล่าสุด) — BookingForm ใช้กันบันทึก */
export const DEPOSIT_OVERRIDE_UNSUPPORTED = 'ฐานข้อมูลยังไม่รองรับมัดจำกำหนดเอง — ให้ผู้ดูแลรัน supabase-fix-07-wedding.sql ใหม่ (หรือเว้นว่างให้คิดอัตโนมัติ)'

const pctText = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 2 })

/** สถานะที่ผ่านการยืนยันงานแล้ว (ไม่นับเลื่อน/ยกเลิก) */
const CONFIRMED_STATUSES: readonly WedBookingStatus[] = ['confirmed', 'in_production', 'delivered', 'completed']

/** โฟกัสช่องในฟอร์ม (ช่องยังอยู่ในหน้าเสมอ — ปุ่มที่กดเป็นตัวที่หายไป) */
function focusField(id: string) {
  document.getElementById(id)?.focus()
}

/** นโยบายมัดจำอัตโนมัติของงานนี้: '30% ของยอดงาน (ขั้นต่ำ ฿1,000)'
 *  (บอกว่า "ถ้าเว้นว่าง" จะคิดอย่างไร — อ่าน deposit_percent ตรงได้ เพราะไม่ได้อ้างว่ามัดจำตอนนี้เป็น %) */
function autoPolicyText(m: WedMoney | null): string {
  if (!m || m.deposit_percent === null) return 'ตามนโยบายร้าน'
  const min = m.min_deposit !== null && m.min_deposit > 0 ? ` (ขั้นต่ำ ${baht(m.min_deposit)})` : ''
  return `${pctText(m.deposit_percent)}% ของยอดงาน${min}`
}

/** ช่องมัดจำว่าง: ตัวอย่างยอดอัตโนมัติจาก wed_quote — 'อัตโนมัติ ฿2,070 (30%)' */
function autoPlaceholder(m: WedMoney | null): string {
  // ยังไม่มียอดงาน (ฟอร์มใหม่ยังไม่เลือกแพ็กเกจ) — ไม่โชว์ "อัตโนมัติ ฿0" ให้เข้าใจผิดว่าไม่เก็บมัดจำ
  if (!m || m.deposit_source !== 'auto' || m.grand_total <= 0.005) return 'อัตโนมัติ'
  const dep = m.deposit_required
  // ยอดอัตโนมัติชนเพดาน (ยอดสุทธิ) / ใช้มัดจำขั้นต่ำ = ไม่ใช่ N% แล้ว → บอกตามจริง
  let tag = ''
  if (dep > 0.005) {
    if (dep >= m.grand_total - 0.005) tag = ' (เต็มจำนวน)'
    else if (m.min_deposit !== null && m.min_deposit > 0 && Math.abs(dep - m.min_deposit) < 0.005) tag = ' (ขั้นต่ำ)'
    else if (m.deposit_percent !== null && m.deposit_percent > 0) tag = ` (${pctText(m.deposit_percent)}%)`
  }
  return `อัตโนมัติ ${baht(dep)}${tag}`
}

export default function MoneySection({
  draft,
  patch,
  check,
  quote,
  booking,
  balanceDueDays,
  summary,
  disabled,
}: {
  draft: WedDraft
  patch: (p: Partial<WedDraft>) => void
  check: CoreCheck
  quote: WedQuote | null
  /** งานที่กำลังแก้ (สร้างใหม่ = null) — ใช้เตือนเรื่องงวดที่แบ่งเอง */
  booking?: WedBooking | null
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

  // มัดจำ: ว่าง = อัตโนมัติ (ตัวอย่างยอดจาก wed_quote) ; พิมพ์เอง = ฐานข้อมูลใช้ไม่เกินยอดหลังส่วนลด (wedDepositCap)
  const qm = quote ? quote.money : null
  const depTyped = draft.depositOverride.trim() !== ''
  const depUnsupported = depTyped && !check.money.depositOverride && !!qm && qm.deposit_source !== 'manual'
  const depErr = check.money.depositOverride ?? (depUnsupported ? DEPOSIT_OVERRIDE_UNSUPPORTED : null)
  const depCap = qm ? wedDepositCap(qm) : null
  const depHint = !depTyped
    ? `เว้นว่าง = คิดอัตโนมัติ ${autoPolicyText(qm)} · ใส่ 0 = ไม่เก็บมัดจำ`
    : qm && depCap && depCap.capped
      ? `เกิน${depCap.label} — ใช้มัดจำเท่า${depCap.label} ${baht(qm.deposit_required)} · เว้นว่าง = คิดอัตโนมัติ`
      : `กำหนดเองสำหรับงานนี้ · เว้นว่าง = คิดอัตโนมัติ ${autoPolicyText(qm)}`
  // แก้งานที่แบ่งงวดเอง: เปลี่ยนมัดจำแล้วงวดชำระไม่เปลี่ยนตาม (ฐานข้อมูลไม่แตะงวดที่แก้เอง) → บอกก่อนบันทึก
  const savedDep = booking ? booking.money.deposit_override : null
  const newDep = check.payload.deposit_override
  const depChanged = typeof newDep === 'number'
    ? savedDep === null || Math.abs(savedDep - newDep) >= 0.005
    : savedDep !== null
  const customPlanNote = !!booking && booking.installments_custom && !depErr && depChanged
    ? 'งานนี้แบ่งงวดชำระเอง — งวดชำระไม่เปลี่ยนตามมัดจำนี้ ถ้าต้องการให้งวดตามมัดจำ กด "งวดมาตรฐาน" ที่การ์ดงวดชำระหลังบันทึก'
    : null
  // งานที่ยืนยันแล้ว: มัดจำใหม่สูงขึ้นจนเกินยอดที่รับแล้ว → หลังบันทึกงานจะขึ้นว่ามัดจำยังขาด (ป้าย/รายการ/ข้อความลูกค้า) → บอกก่อนบันทึก
  //   (ยอดชำระแล้วใน wed_quote ตอนแก้งาน = ยอดจริงของงาน)
  const confirmedShortNote = !!booking && !!qm && !depErr && depChanged && CONFIRMED_STATUSES.includes(booking.status) &&
    qm.deposit_required > booking.money.deposit_required + 0.005 && qm.deposit_required > qm.paid + 0.005
    ? `งานยืนยันแล้ว — มัดจำใหม่มากกว่ายอดที่รับแล้ว (${baht(qm.paid)}) หลังบันทึกงานจะขึ้นว่ามัดจำยังขาด ${baht(qm.deposit_due)}`
    : null

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
        <Field
          id={`${uid}-dep`}
          label="มัดจำ (บาท)"
          error={depErr}
          hint={
            <>
              {depHint}
              {confirmedShortNote && <span className="mt-1 block font-medium text-amber-800">{confirmedShortNote}</span>}
              {customPlanNote && <span className="mt-1 block font-medium text-amber-800">{customPlanNote}</span>}
            </>
          }
          className="sm:col-span-2 sm:max-w-sm"
        >
          <MoneyInput
            id={`${uid}-dep`}
            value={draft.depositOverride}
            onChange={v => patch({ depositOverride: v })}
            disabled={disabled}
            error={depErr}
            placeholder={autoPlaceholder(qm)}
            describedBy={`${uid}-dep-hint`}
          />
        </Field>
        {depTyped && (
          <button
            type="button"
            className="btn-ghost -mt-2 justify-self-start px-2 text-sm"
            disabled={disabled}
            // ปุ่มหายไปหลังกด → ย้ายโฟกัสกลับไปที่ช่องมัดจำ (คีย์บอร์ด/โปรแกรมอ่านหน้าจอไม่หลุดไปต้นหน้า)
            onClick={() => { patch({ depositOverride: '' }); focusField(`${uid}-dep`) }}
          >
            ใช้ค่าอัตโนมัติ
          </button>
        )}
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
            onClick={() => { patch({ balanceDueOverride: '' }); focusField(`${uid}-bal`) }}
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
