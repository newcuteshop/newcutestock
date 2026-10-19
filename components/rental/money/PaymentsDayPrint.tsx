// ===== สรุปการเงินประจำวันของร้านเช่าชุด สำหรับพิมพ์ (กระดาษใบเสร็จ 80 มม. ผ่าน components/pos/PrintPortal.tsx) =====
// ใช้คลาส .receipt* ใน globals.css (ตัวอักษรดำล้วน ไม่มีพื้นหลัง — เครื่องพิมพ์ความร้อนพิมพ์ได้แต่สีดำ)
// ไม่มี hook/สถานะ → ใช้ได้ทั้ง server และ client ; ชื่อร้านมาจาก rental_settings.shop_name เสมอ (ห้าม hardcode)
// ยอดเงิน: นับเฉพาะรายการที่ยืนยันแล้วและไม่ถูกยกเลิก (กติกาเดียวกับหน้าจอ — dayMoneyTotals)
import type { ReactNode } from 'react'
import { baht, formatThaiDateTime, formatThaiDayLong, formatThaiTime } from '@/lib/format'
import {
  METHOD_LABELS, PAYMENT_KIND_LABELS, RENTAL_CASH_METHODS, RENTAL_PAYMENT_KINDS,
} from '@/lib/rental'
import { fmtCount, isCountedPayment, signedAmount, type DayMoneyTotals, type PaymentRow } from './moneyRows'

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

function signedBaht(n: number): string {
  return n < 0 ? `-${baht(Math.abs(n))}` : baht(n)
}

export default function PaymentsDayPrint({
  shopName,
  day,
  rows,
  totals,
  pendingSlips,
  printedAt,
}: {
  shopName: string
  day: string
  /** รายการเงินทั้งหมดของวัน (รวมที่ยกเลิก/รอตรวจ — ใบพิมพ์แยกให้เอง) */
  rows: readonly PaymentRow[]
  totals: DayMoneyTotals
  /** จำนวนสลิปที่ยังรอตรวจทั้งหมด (ทุกวัน) */
  pendingSlips: number
  printedAt: string | Date
}) {
  // เรียงตามเวลา (เก่า → ใหม่) อ่านง่ายบนกระดาษ
  const ordered = [...rows].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
  const counted = ordered.filter(isCountedPayment)
  const voided = ordered.filter(p => !!p.voided_at)
  const methods = RENTAL_CASH_METHODS.filter(m => totals.by_method[m].count > 0 || m === 'cash')
  const kinds = RENTAL_PAYMENT_KINDS.filter(k => totals.by_kind[k].count > 0)

  return (
    <div className="receipt">
      <p className="receipt-shop">{shopName}</p>
      <hr className="receipt-sep" />
      <p className="receipt-title">สรุปการเงินประจำวัน</p>
      <p className="receipt-center receipt-bold">{formatThaiDayLong(day)}</p>
      <p className="receipt-center receipt-small">พิมพ์เมื่อ {formatThaiDateTime(printedAt)}</p>

      <hr className="receipt-sep" />
      <Row label="จำนวนรายการเงิน" value={`${fmtCount(totals.count)} รายการ`} />
      <Row label="เงินเข้า" value={baht(totals.cash_in)} />
      <Row label="เงินออก" value={totals.cash_out > 0 ? `-${baht(totals.cash_out)}` : baht(0)} />
      <Row label="เงินเข้าสุทธิ" value={signedBaht(totals.net)} className="receipt-total" />
      <Row label="รายได้ค่าเช่าสุทธิ" value={signedBaht(totals.rent_income)} className="receipt-bold" />
      <p className="receipt-small">รายได้ค่าเช่า = รับชำระ − คืนเงินค่าเช่า + หักเงินประกัน (ไม่รวมเงินประกันที่รับ/คืน)</p>

      <hr className="receipt-sep" />
      <p className="receipt-bold">แยกตามวิธีชำระ (เข้า − ออก)</p>
      {methods.map(m => (
        <Row
          key={m}
          label={`${METHOD_LABELS[m]} (${fmtCount(totals.by_method[m].count)})`}
          value={signedBaht(totals.by_method[m].net)}
        />
      ))}
      <Row label="เงินสดที่ควรเพิ่มในลิ้นชัก" value={signedBaht(totals.by_method.cash.net)} className="receipt-bold" />

      {kinds.length > 0 && (
        <>
          <hr className="receipt-sep" />
          <p className="receipt-bold">แยกตามประเภท</p>
          {kinds.map(k => (
            <Row
              key={k}
              label={`${PAYMENT_KIND_LABELS[k]} (${fmtCount(totals.by_kind[k].count)})`}
              value={baht(totals.by_kind[k].amount)}
            />
          ))}
        </>
      )}

      {counted.length > 0 && (
        <>
          <hr className="receipt-sep" />
          <p className="receipt-bold">รายการ</p>
          {counted.map(p => (
            <div key={p.id} className="receipt-item">
              <Row
                label={`${formatThaiTime(p.created_at)} ${p.receipt_no ?? ''}`}
                value={signedBaht(signedAmount(p))}
              />
              <p className="receipt-small">
                {PAYMENT_KIND_LABELS[p.kind]} · {METHOD_LABELS[p.method]}
                {p.booking ? ` · ${p.booking.booking_no}` : ''}
                {p.booking?.customer_name ? ` · ${p.booking.customer_name}` : ''}
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
          {voided.map(p => (
            <p key={p.id} className="receipt-small">
              {p.receipt_no ?? '-'} {PAYMENT_KIND_LABELS[p.kind]} {baht(p.amount)}
              {p.void_reason ? ` — ${p.void_reason}` : ''}
            </p>
          ))}
        </>
      )}

      {(totals.pending.count > 0 || pendingSlips > 0) && (
        <>
          <hr className="receipt-sep" />
          {totals.pending.count > 0 && (
            <Row label={`สลิปที่ลูกค้าแจ้ง ยังรอตรวจ (${fmtCount(totals.pending.count)})`} value={baht(totals.pending.amount)} />
          )}
          {pendingSlips > 0 && <p className="receipt-small">สลิปรอตรวจทั้งหมด {fmtCount(pendingSlips)} ใบ — ยังไม่นับเป็นเงินเข้า</p>}
        </>
      )}

      <SignLine label="ผู้สรุปยอด" />
      <SignLine label="ผู้ตรวจสอบ" />
      <hr className="receipt-sep" />
      <p className="receipt-center receipt-small">{shopName}</p>
    </div>
  )
}
