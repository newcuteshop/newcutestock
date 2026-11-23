// ===== สรุปการเงินของร้าน b.oncloud สำหรับพิมพ์ (กระดาษใบเสร็จ 80 มม. ผ่าน components/pos/PrintPortal.tsx) =====
// ใช้คลาส .receipt* ใน globals.css (ตัวอักษรดำล้วน ไม่มีพื้นหลัง — เครื่องพิมพ์ความร้อนพิมพ์ได้แต่สีดำ)
// ไม่มี hook/สถานะ → ใช้ได้ทั้ง server และ client ; ชื่อร้านมาจาก wed_settings.shop_name เสมอ (ห้าม hardcode)
// ยอดเงิน: นับเฉพาะรายการที่ไม่ถูกยกเลิก (กติกาเดียวกับหน้าจอ — moneyTotals)
// ดูรายวัน = แสดงทุกรายการ · ดูทั้งเดือน = แสดงยอดรายวัน (รายการเต็มยาวเกินกระดาษ — ดูในหน้าจอ/ส่งออก Excel แทน)
import type { ReactNode } from 'react'
import { baht, formatThaiDate, formatThaiDateTime, formatThaiDayLong, formatThaiTime } from '@/lib/format'
import {
  WED_METHOD_LABELS, WED_PAYMENT_KIND_LABELS, WED_PAYMENT_METHODS, WED_PAYMENT_PURPOSES, WED_PURPOSE_LABELS,
  thaiMonthYear, type WedPaymentRow,
} from '@/lib/wedding'
import { fmtCount } from './wedRpc'
import { signedAmount, type PeriodMode, type WedMoneyTotals } from './paymentRows'

function Row({ label, value, className }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <div className={className ? `receipt-row ${className}` : 'receipt-row'}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

// ช่องลงชื่อ (เส้นประยาวเต็มที่เหลือ)
function SignLine({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginTop: 20 }}>
      <span style={{ flex: 'none' }}>{label}</span>
      <span style={{ flex: '1 1 auto', borderBottom: '1px dotted #000000', height: '1em' }} />
    </div>
  )
}

export default function WedPaymentsPrint({
  shopName,
  mode,
  periodKey,
  rows,
  totals,
  printedAt,
}: {
  shopName: string
  mode: PeriodMode
  /** วัน 'YYYY-MM-DD' หรือเดือน 'YYYY-MM' */
  periodKey: string
  /** รายการเงินทั้งหมดของช่วง (รวมที่ยกเลิก — ใบพิมพ์แยกให้เอง) */
  rows: readonly WedPaymentRow[]
  totals: WedMoneyTotals
  printedAt: string | Date
}) {
  // เรียงตามเวลาบันทึก (เก่า → ใหม่) อ่านง่ายบนกระดาษ
  const ordered = [...rows].sort((a, b) =>
    (a.paid_on ?? '').localeCompare(b.paid_on ?? '') || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
  const counted = ordered.filter(p => !p.voided_at)
  const voided = ordered.filter(p => !!p.voided_at)
  const methods = WED_PAYMENT_METHODS.filter(m => totals.by_method[m].count > 0 || m === 'cash')
  const purposes = WED_PAYMENT_PURPOSES.filter(p => totals.by_purpose[p].count > 0)

  return (
    <div className="receipt">
      <p className="receipt-shop">{shopName}</p>
      <hr className="receipt-sep" />
      <p className="receipt-title">{mode === 'day' ? 'สรุปการเงินประจำวัน' : 'สรุปการเงินประจำเดือน'}</p>
      <p className="receipt-center receipt-bold">{mode === 'day' ? formatThaiDayLong(periodKey) : thaiMonthYear(periodKey)}</p>
      <p className="receipt-center receipt-small">พิมพ์เมื่อ {formatThaiDateTime(printedAt)}</p>

      <hr className="receipt-sep" />
      <Row label="จำนวนรายการเงิน" value={`${fmtCount(totals.count)} รายการ`} />
      <Row label={`รับชำระ (${fmtCount(totals.payments.count)})`} value={baht(totals.payments.amount)} />
      <Row label={`คืนเงิน (${fmtCount(totals.refunds.count)})`} value={totals.refunds.amount > 0 ? `-${baht(totals.refunds.amount)}` : baht(0)} />
      <Row label="รับสุทธิ" value={baht(totals.net)} className="receipt-total" />

      <hr className="receipt-sep" />
      <p className="receipt-bold">แยกตามวิธีชำระ (รับ − คืน)</p>
      {methods.map(m => (
        <Row key={m} label={`${WED_METHOD_LABELS[m]} (${fmtCount(totals.by_method[m].count)})`} value={baht(totals.by_method[m].net)} />
      ))}
      <Row
        label={mode === 'day' ? 'เงินสดที่ควรเพิ่มในลิ้นชัก' : 'เงินสดสุทธิทั้งเดือน'}
        value={baht(totals.by_method.cash.net)}
        className="receipt-bold"
      />

      {purposes.length > 0 && (
        <>
          <hr className="receipt-sep" />
          <p className="receipt-bold">รับชำระแยกตามรายการ</p>
          {purposes.map(p => (
            <Row key={p} label={`${WED_PURPOSE_LABELS[p]} (${fmtCount(totals.by_purpose[p].count)})`} value={baht(totals.by_purpose[p].amount)} />
          ))}
        </>
      )}

      {mode === 'month' && totals.by_day.length > 0 && (
        <>
          <hr className="receipt-sep" />
          <p className="receipt-bold">ยอดรายวัน</p>
          {totals.by_day.map(d => (
            <Row key={d.day} label={`${formatThaiDate(d.day)} (${fmtCount(d.count)})`} value={baht(d.net)} />
          ))}
        </>
      )}

      {mode === 'day' && counted.length > 0 && (
        <>
          <hr className="receipt-sep" />
          <p className="receipt-bold">รายการ</p>
          {counted.map(p => (
            <div key={p.id} className="receipt-item">
              <Row label={`${formatThaiTime(p.created_at)} ${p.receipt_no ?? ''}`} value={baht(signedAmount(p))} />
              <p className="receipt-small">
                {WED_PAYMENT_KIND_LABELS[p.kind]}
                {p.purpose ? ` (${WED_PURPOSE_LABELS[p.purpose]})` : ''} · {WED_METHOD_LABELS[p.method]}
                {p.booking_no ? ` · ${p.booking_no}` : ''}
                {p.couple_names ? ` · ${p.couple_names}` : ''}
              </p>
            </div>
          ))}
        </>
      )}

      {voided.length > 0 && (
        <>
          <hr className="receipt-sep" />
          <Row label={`รายการที่ยกเลิก (${fmtCount(totals.voided.count)})`} value={baht(totals.voided.amount)} />
          <p className="receipt-small">ไม่นับรวมในยอดด้านบน</p>
          {mode === 'day' && voided.map(p => (
            <p key={p.id} className="receipt-small">
              {p.receipt_no ?? '-'} {WED_PAYMENT_KIND_LABELS[p.kind]} {baht(p.amount)}
              {p.void_reason ? ` — ${p.void_reason}` : ''}
            </p>
          ))}
        </>
      )}

      <SignLine label="ผู้สรุปยอด" />
      <SignLine label="ผู้ตรวจสอบ" />
      <hr className="receipt-sep" />
      <p className="receipt-center receipt-small">{shopName}</p>
    </div>
  )
}
