// ===== สรุปยอดประจำวัน สำหรับพิมพ์ (ใช้คู่ components/pos/PrintPortal.tsx) =====
// เนื้อหาเป็นแบบใบเสร็จแคบ (คลาส .receipt* ใน globals.css) — กว้างตามกระดาษที่ PrintPortal ส่ง data-paper มา (58/80 มม./A4)
// ไม่มี hook/สถานะ → ใช้ได้ทั้งใน client และ server component
// ส่วนเงินสด:
//   ปิดยอดแล้ว → ใช้ตัวเลขที่บันทึกไว้ (เงินทอนตั้งต้น/ควรมี/นับได้/ส่วนต่าง ณ ตอนปิดยอด) เป็นฉบับทางการ
//   ยังไม่ปิดยอด → ใช้ค่าในฟอร์มที่กรอกค้างไว้ (draft) พร้อมระบุว่า "ฉบับร่าง ยังไม่ได้บันทึก"
// ใช้ชื่อคลาสตรงๆ เสมอ (ห้ามประกอบชื่อคลาสจากตัวแปร — Tailwind ตัดคลาสที่หาไม่เจอทิ้ง)
import type { ReactNode } from 'react'
import { baht, formatThaiDateTime, formatThaiDayLong, formatThaiTime } from '@/lib/format'
import { round2 } from '@/lib/money'
import { PAYMENT_METHOD_LABELS, saleChannelLabel } from '@/lib/integrations/labels'
import {
  DENOMINATIONS, REFUND_METHOD_OPTIONS, type CashDetail, type DaySummary, type ShopSettings,
} from '@/lib/pos'

/** ค่าเงินสดจากฟอร์มที่ยังไม่ได้บันทึกปิดยอด */
export interface DayCashDraft {
  opening: number
  counted: number | null // ยังไม่ได้กรอกยอดที่นับ = null
  detail: CashDetail | null
  note: string | null
}

function count(n: number): string {
  return n.toLocaleString('en-US')
}

// ส่วนต่างเงินสด: 0 = ตรงพอดี, บวก = เกิน, ลบ = ขาด
export function cashDiffText(diff: number): string {
  const d = round2(diff)
  if (d === 0) return 'ตรงพอดี'
  return d > 0 ? `เกิน ${baht(d)}` : `ขาด ${baht(Math.abs(d))}`
}

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

export default function DaySummaryPrint({
  shop,
  summary,
  draft = null,
  printedAt,
}: {
  shop: ShopSettings
  summary: DaySummary
  draft?: DayCashDraft | null
  printedAt: string | Date
}) {
  const closing = summary.closing
  // ตัวเลขเงินสดที่ใช้คำนวณ "ควรมี" — ปิดยอดแล้วใช้ snapshot ตอนปิด เพื่อให้บวกลบบนกระดาษตรงกับยอดที่บันทึก
  const base = closing?.summary ?? summary
  const cash = closing
    ? {
      opening: closing.opening_cash,
      cashSales: base.cash_sales,
      cashRefunds: base.cash_refunds,
      expected: closing.expected_cash,
      counted: closing.counted_cash as number | null,
      diff: closing.cash_diff as number | null,
      detail: closing.cash_detail,
      note: closing.note,
    }
    : draft
      ? (() => {
        const expected = round2(draft.opening + summary.cash_sales - summary.cash_refunds)
        return {
          opening: draft.opening,
          cashSales: summary.cash_sales,
          cashRefunds: summary.cash_refunds,
          expected,
          counted: draft.counted,
          diff: draft.counted === null ? null : round2(draft.counted - expected),
          detail: draft.detail,
          note: draft.note,
        }
      })()
      : null

  const methods = (['cash', 'transfer', 'credit', 'marketplace'] as const).filter(
    m => m !== 'marketplace' || summary.by_method.marketplace.count > 0 || summary.by_method.marketplace.amount !== 0,
  )
  const detailRows = cash?.detail
    ? DENOMINATIONS.filter(d => (cash.detail?.[d.key] ?? 0) > 0).map(d => ({ d, n: cash.detail?.[d.key] ?? 0 }))
    : []
  // แสดงช่องทางขายเมื่อมีมากกว่าหน้าร้านอย่างเดียว (ร้านที่ขายหน้าร้านล้วนไม่ต้องเห็นซ้ำ)
  const showChannels = summary.by_channel.length > 1 || (summary.by_channel.length === 1 && summary.by_channel[0].channel !== 'store')

  return (
    <div className="receipt">
      <p className="receipt-shop">{shop.shop_name}</p>
      {shop.branch_name && <p className="receipt-center">{shop.branch_name}</p>}
      <hr className="receipt-sep" />
      <p className="receipt-title">สรุปยอดประจำวัน</p>
      <p className="receipt-center receipt-bold">{formatThaiDayLong(summary.day)}</p>
      <p className="receipt-center receipt-small">พิมพ์เมื่อ {formatThaiDateTime(printedAt)}</p>
      {summary.first_bill_at && (
        <p className="receipt-center receipt-small">
          บิลแรก {formatThaiTime(summary.first_bill_at)} · บิลสุดท้าย {formatThaiTime(summary.last_bill_at)}
        </p>
      )}

      <hr className="receipt-sep" />
      <Row label="จำนวนบิล" value={`${count(summary.bills)} บิล`} />
      <Row label="จำนวนชิ้นที่ขาย" value={`${count(summary.items_qty)} ชิ้น`} />
      <Row label="ยอดก่อนส่วนลด" value={baht(summary.gross)} />
      {summary.discount > 0 && <Row label="ส่วนลด" value={`-${baht(summary.discount)}`} />}
      <Row label="ยอดขายสุทธิ" value={baht(summary.net)} className="receipt-bold" />
      {summary.refunds.count > 0 && (
        <Row label={`คืนเงิน (${count(summary.refunds.count)} ครั้ง)`} value={`-${baht(summary.refunds.amount)}`} />
      )}
      <Row label="ยอดหลังหักคืน" value={baht(summary.net_after_refunds)} className="receipt-total" />

      <hr className="receipt-sep" />
      <p className="receipt-bold">แยกตามวิธีชำระ</p>
      {methods.map(m => (
        <Row
          key={m}
          label={`${PAYMENT_METHOD_LABELS[m]} (${count(summary.by_method[m].count)} บิล)`}
          value={baht(summary.by_method[m].amount)}
        />
      ))}

      {summary.refunds.count > 0 && (
        <>
          <hr className="receipt-sep" />
          <p className="receipt-bold">คืนเงินแยกตามวิธี</p>
          {REFUND_METHOD_OPTIONS.filter(o => summary.refunds.by_method[o.value] !== 0).map(o => (
            <Row key={o.value} label={o.label} value={baht(summary.refunds.by_method[o.value])} />
          ))}
        </>
      )}

      {summary.voided.count > 0 && (
        <>
          <hr className="receipt-sep" />
          <Row label={`บิลที่ยกเลิก (${count(summary.voided.count)} บิล)`} value={baht(summary.voided.amount)} />
          <p className="receipt-small">ไม่นับรวมในยอดขาย</p>
        </>
      )}

      {showChannels && (
        <>
          <hr className="receipt-sep" />
          <p className="receipt-bold">แยกตามช่องทางขาย</p>
          {summary.by_channel.map(c => (
            <Row key={c.channel} label={`${saleChannelLabel(c.channel)} (${count(c.count)})`} value={baht(c.amount)} />
          ))}
        </>
      )}

      <hr className="receipt-sep" />
      <p className="receipt-bold">เงินสดในลิ้นชัก</p>
      {cash ? (
        <>
          <Row label="เงินทอนตั้งต้น" value={baht(cash.opening)} />
          <Row label="+ ขายเงินสด" value={baht(cash.cashSales)} />
          <Row label="- คืนเงินสด" value={baht(cash.cashRefunds)} />
          <Row label="ยอดที่ควรมี" value={baht(cash.expected)} className="receipt-bold" />
          <Row label="นับได้จริง" value={cash.counted === null ? '-' : baht(cash.counted)} />
          {cash.diff !== null && <Row label="ส่วนต่าง" value={cashDiffText(cash.diff)} className="receipt-bold" />}
          {detailRows.length > 0 && (
            <>
              <p className="receipt-small" style={{ marginTop: 4 }}>นับแยกแบงก์/เหรียญ</p>
              {detailRows.map(({ d, n }) => (
                <Row
                  key={d.key}
                  className="receipt-small"
                  label={`${d.label} x ${count(n)}`}
                  value={baht(round2(d.value * n))}
                />
              ))}
            </>
          )}
          {cash.note && <p className="receipt-small" style={{ marginTop: 4 }}>หมายเหตุ: {cash.note}</p>}
        </>
      ) : (
        <>
          <Row label="ขายเงินสด" value={baht(summary.cash_sales)} />
          <Row label="คืนเงินสด" value={baht(summary.cash_refunds)} />
        </>
      )}

      <hr className="receipt-sep" />
      {closing ? (
        <>
          <p>
            ปิดยอดครั้งที่ {count(closing.revision)}
            {closing.closed_by_name ? ` โดย ${closing.closed_by_name}` : ''}
          </p>
          <p className="receipt-small">เวลา {formatThaiDateTime(closing.closed_at)}</p>
          {summary.changed_since_close && (
            <p className="receipt-banner" style={{ fontSize: '1em' }}>ตัวเลขเปลี่ยนหลังปิดยอด ควรปิดยอดใหม่</p>
          )}
        </>
      ) : (
        <p className="receipt-banner" style={{ fontSize: '1em' }}>ฉบับร่าง ยังไม่ได้บันทึกปิดยอด</p>
      )}

      <SignLine label="ผู้ปิดยอด" />
      <SignLine label="ผู้ตรวจสอบ" />
      <hr className="receipt-sep" />
      <p className="receipt-center receipt-small">NEWCUTE</p>
    </div>
  )
}
