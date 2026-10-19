'use client'
import clsx from 'clsx'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht } from '@/lib/format'
import { round2 } from '@/lib/money'
import type { RentalQuote } from '@/lib/rental'

// สรุปยอดเงินของการจอง (จาก rental_quote — ฐานข้อมูลคำนวณ) ใช้ทั้งขั้นสรุปและแถบสรุปข้างจอ
// แก้ไขการจอง: แสดงยอดที่ชำระแล้ว + ยอดค้างโดยประมาณหลังแก้ (ยอดจริงคำนวณใหม่ตอนบันทึก)
// สร้างใหม่: แสดงยอดที่จะรับตอนนี้ + ยอดค้างหลังรับ

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

export default function MoneySummary({
  quote,
  loading,
  error,
  securityOverridden,
  paid,
  securityHeld,
  payNow,
  securityNow,
}: {
  quote: RentalQuote | null
  loading: boolean
  error: string
  securityOverridden: boolean
  paid?: number            // แก้ไข: ชำระแล้ว
  securityHeld?: number    // แก้ไข: ถือเงินประกันแล้ว
  payNow?: number          // สร้างใหม่: รับค่าเช่า/มัดจำตอนนี้
  securityNow?: number     // สร้างใหม่: รับเงินประกันตอนนี้
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
        {loading ? 'กำลังคำนวณยอดเงิน...' : 'เลือกวันและชุดเพื่อดูยอดเงิน'}
      </p>
    )
  }

  const dueAfterEdit = paid !== undefined ? round2(quote.grand_total - paid) : null
  const dueAfterPay = payNow !== undefined ? round2(quote.grand_total - payNow) : null

  return (
    <div className={clsx('space-y-3', loading && 'opacity-60')} aria-live="polite">
      <dl className="space-y-1.5 text-sm">
        <Row label={`ค่าเช่า (${quote.days} วัน)`} value={baht(quote.rent_total)} />
        {quote.discount > 0 && <Row label="ส่วนลด" value={`-${baht(quote.discount)}`} tone="green" />}
        {quote.delivery_fee > 0 && <Row label="ค่าจัดส่ง" value={baht(quote.delivery_fee)} />}
        <Row label="ยอดรวมค่าเช่า" value={baht(quote.grand_total)} strong />
        {paid !== undefined && (
          <>
            <Row label="ชำระแล้ว" value={baht(paid)} />
            {dueAfterEdit !== null && dueAfterEdit > 0.005 && (
              <Row label="ค้างชำระหลังแก้ไข (ประมาณ)" value={baht(dueAfterEdit)} tone="red" />
            )}
            {dueAfterEdit !== null && dueAfterEdit < -0.005 && (
              <Row label="รับเงินเกิน (ต้องคืนลูกค้า)" value={baht(-dueAfterEdit)} tone="red" />
            )}
          </>
        )}
        {payNow !== undefined && payNow > 0 && (
          <>
            <Row label="รับค่าเช่าตอนนี้" value={baht(payNow)} tone="green" />
            {dueAfterPay !== null && <Row label="ค้างชำระหลังรับเงิน" value={baht(Math.max(0, dueAfterPay))} tone={dueAfterPay > 0.005 ? 'red' : 'muted'} />}
          </>
        )}
      </dl>
      <hr className="divider !my-0" />
      <dl className="space-y-1.5 text-sm">
        <Row
          label="เงินประกันชุด"
          value={baht(quote.security_required)}
          hint={securityOverridden ? 'กำหนดเอง' : 'คืนลูกค้าเมื่อคืนชุดครบและสภาพดี'}
        />
        {securityHeld !== undefined && securityHeld > 0 && <Row label="ถือเงินประกันแล้ว" value={baht(securityHeld)} />}
        {securityNow !== undefined && securityNow > 0 && <Row label="รับเงินประกันตอนนี้" value={baht(securityNow)} tone="green" />}
        <Row label="มัดจำขั้นต่ำเพื่อยืนยันการจอง" value={baht(quote.deposit_required)} />
      </dl>
    </div>
  )
}
