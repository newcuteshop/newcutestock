'use client'
// สรุปยอดเงินของงาน (จาก wed_quote — ฐานข้อมูลคำนวณ) ใช้ทั้งในฟอร์ม (มือถือ) และแถบสรุปข้างจอ (จอกว้าง)
// แก้ไข: แสดงยอดที่ชำระแล้ว + ยอดค้างหลังแก้ (ยอดจริงคำนวณใหม่ตอนบันทึก)
// สร้างใหม่: แสดงยอดที่รับตอนนี้ + แผนชำระเริ่มต้น (มัดจำ + ยอดคงเหลือ) — แก้งวดได้ที่หน้างานหลังบันทึก
// ต้นทุนทีมงาน/กำไร: ฐานข้อมูลส่งมาเฉพาะผู้จัดการ (null = ซ่อน)
import clsx from 'clsx'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht, formatThaiDate } from '@/lib/format'
import { round2 } from '@/lib/money'
import type { WedQuote } from '@/lib/wedding'

function Row({ label, value, strong, tone, hint }: {
  label: string
  value: string
  strong?: boolean
  tone?: 'red' | 'green' | 'muted'
  hint?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={clsx('min-w-0', strong ? 'font-semibold text-gray-900' : 'text-gray-600')}>
        {label}
        {hint && <span className="block text-xs font-normal text-gray-500">{hint}</span>}
      </dt>
      <dd
        className={clsx(
          'shrink-0 tabular-nums whitespace-nowrap',
          strong ? 'money text-lg' : 'font-medium',
          tone === 'red' && 'text-red-700',
          tone === 'green' && 'text-green-700',
          tone === 'muted' && 'text-gray-500',
          !tone && 'text-gray-900',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

export default function QuoteSummary({
  quote,
  loading,
  error,
  create,
  payNow,
  emptyText = 'กรอกคิวงานและแพ็กเกจเพื่อดูยอดเงิน',
}: {
  quote: WedQuote | null
  loading: boolean
  error: string
  create: boolean
  payNow?: number
  emptyText?: string
}) {
  if (!quote) {
    if (error) {
      return (
        <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-red-700">
          <AlertTriangle {...ICON_SM} className="mt-px shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </p>
      )
    }
    return (
      <p className="flex items-center gap-2 text-sm text-gray-500" role="status">
        {loading && <Loader2 {...ICON_XS} className="animate-spin" />}
        {loading ? 'กำลังคำนวณยอดเงิน...' : emptyText}
      </p>
    )
  }

  const m = quote.money
  const due = round2(m.grand_total - m.paid)
  const afterPay = payNow !== undefined ? round2(m.grand_total - payNow) : null
  const depositHint = m.deposit_percent !== null
    ? `${m.deposit_percent.toLocaleString('th-TH', { maximumFractionDigits: 2 })}% ของยอดงาน${m.min_deposit && m.min_deposit > 0 ? ` (ขั้นต่ำ ${baht(m.min_deposit)})` : ''}`
    : undefined
  const rest = round2(Math.max(0, m.grand_total - m.deposit_required))

  return (
    <div className={clsx('space-y-3', loading && 'opacity-60')} aria-live="polite">
      <dl className="space-y-1.5 text-sm">
        <Row label={quote.package.name ? `แพ็กเกจ: ${quote.package.name}` : 'แพ็กเกจ'} value={baht(m.package_price)} />
        {m.addons_total > 0 && <Row label="บริการเสริม" value={baht(m.addons_total)} />}
        {m.travel_fee > 0 && <Row label="ค่าเดินทาง" value={baht(m.travel_fee)} />}
        {m.discount > 0 && <Row label="ส่วนลด" value={`-${baht(m.discount)}`} tone={quote.discount_ok ? 'green' : 'red'} />}
        {m.charges_total > 0 && <Row label="ค่าใช้จ่ายเพิ่มเติม (บันทึกไว้แล้ว)" value={baht(m.charges_total)} />}
        <Row label="ยอดสุทธิ" value={baht(m.grand_total)} strong />
        {!quote.discount_ok && (
          <p role="alert" className="text-sm font-medium text-red-700">ส่วนลดมากกว่ายอดก่อนส่วนลด ({baht(m.pre_discount_total)})</p>
        )}
        {!create && (
          <>
            <Row label="ชำระแล้ว" value={baht(m.paid)} />
            {due > 0.005 && <Row label="ค้างชำระหลังแก้ไข (ประมาณ)" value={baht(due)} tone="red" />}
            {due < -0.005 && <Row label="รับเงินเกิน (ต้องคืนลูกค้า)" value={baht(-due)} tone="red" />}
          </>
        )}
        {payNow !== undefined && payNow > 0 && (
          <>
            <Row label="รับเงินตอนนี้" value={baht(payNow)} tone="green" />
            {afterPay !== null && <Row label="ค้างชำระหลังรับเงิน" value={baht(Math.max(0, afterPay))} tone={afterPay > 0.005 ? 'red' : 'muted'} />}
          </>
        )}
      </dl>
      <hr className="divider !my-0" />
      <dl className="space-y-1.5 text-sm">
        <Row label="มัดจำเพื่อยืนยันงาน" value={baht(m.deposit_required)} hint={depositHint} />
        {m.balance_due_date && (
          <Row label="กำหนดชำระยอดคงเหลือ" value={formatThaiDate(m.balance_due_date)} />
        )}
        {m.crew_cost_total !== null && (
          <>
            <Row label="ต้นทุนค่าตัวทีมงาน" value={baht(m.crew_cost_total)} hint="เห็นเฉพาะผู้จัดการ" />
            {m.profit !== null && (
              <Row label="กำไรโดยประมาณ" value={baht(m.profit)} tone={m.profit < 0 ? 'red' : 'green'} />
            )}
          </>
        )}
      </dl>
      {create && m.grand_total > 0 && (
        <div className="panel p-3 space-y-1.5 text-sm">
          <p className="text-xs font-semibold text-gray-700">แผนชำระเริ่มต้น</p>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 text-gray-600">งวดที่ 1 มัดจำ <span className="text-xs text-gray-500">(วันจอง)</span></span>
            <span className="shrink-0 font-medium tabular-nums text-gray-900">{baht(m.deposit_required)}</span>
          </div>
          {rest > 0.005 && (
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-gray-600">
                งวดที่ 2 ยอดคงเหลือ
                <span className="text-xs text-gray-500"> ({m.balance_due_date ? formatThaiDate(m.balance_due_date) : 'ก่อนวันงาน'})</span>
              </span>
              <span className="shrink-0 font-medium tabular-nums text-gray-900">{baht(rest)}</span>
            </div>
          )}
          <p className="text-xs text-gray-500">แบ่งงวดเพิ่ม/เปลี่ยนวันได้ที่หน้างานหลังบันทึก</p>
        </div>
      )}
    </div>
  )
}
