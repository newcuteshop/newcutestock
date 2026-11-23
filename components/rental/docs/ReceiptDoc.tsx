// ใบเสร็จของรายการเงิน 1 รายการ (รับชำระ / รับเงินประกัน / คืนเงิน / คืนเงินประกัน / หักเงินประกัน)
// paper '80' = ใบเสร็จเครื่องพิมพ์ความร้อน (คลาส .receipt-* ใน globals.css แบบเดียวกับใบเสร็จ NEWCUTE)
// paper 'a4' = เอกสาร A4 มีหัวร้าน ตาราง และช่องลงชื่อ 2 ฝ่าย
// ยอดสรุปท้ายใบ (ยอดรวม/ชำระแล้ว/คงเหลือ/เงินประกันที่ถือ) = ยอด ณ เวลาที่พิมพ์ (พิมพ์ซ้ำภายหลังจะเห็นยอดล่าสุด)
import { formatThaiDate, formatThaiDateTime } from '@/lib/format'
import {
  METHOD_LABELS, PAYMENT_KIND_LABELS, PAYMENT_STATUS_LABELS, RECEIPT_TITLES, formatPhone, sizeLabel,
  type RentalBooking, type RentalPayment, type RentalSettings,
} from '@/lib/rental'
import { A4Style, DocHeader, KV, PrintedAt, SignatureBlock, amount } from './docKit'

// เงินออกจากร้าน → ลูกค้าเป็นผู้รับเงิน
function isOut(p: RentalPayment): boolean {
  return p.kind === 'refund' || p.kind === 'security_out'
}

export default function ReceiptDoc({
  booking,
  payment,
  settings,
  paper,
}: {
  booking: RentalBooking
  payment: RentalPayment
  settings: RentalSettings
  paper: '80' | 'a4'
}) {
  return paper === 'a4'
    ? <ReceiptA4 booking={booking} payment={payment} settings={settings} />
    : <Receipt80 booking={booking} payment={payment} settings={settings} />
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className ? `receipt-row ${className}` : 'receipt-row'}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

function Receipt80({ booking: b, payment: p, settings }: { booking: RentalBooking; payment: RentalPayment; settings: RentalSettings }) {
  const m = b.money
  const notConfirmed = p.status !== 'confirmed'
  return (
    <div className="receipt">
      <p className="receipt-shop">{settings.shop_name}</p>
      {settings.address && <p className="receipt-center receipt-small whitespace-pre-line">{settings.address}</p>}
      {settings.phone && <p className="receipt-center receipt-small">โทร {settings.phone}</p>}
      {settings.line_id && <p className="receipt-center receipt-small">LINE {settings.line_id}</p>}
      <hr className="receipt-sep" />
      <p className="receipt-title">{RECEIPT_TITLES[p.kind]}</p>
      {p.voided_at && <div className="receipt-banner">ยกเลิกแล้ว</div>}
      {notConfirmed && <div className="receipt-banner">{PAYMENT_STATUS_LABELS[p.status]}</div>}
      <Row label="เลขที่" value={p.receipt_no ?? '-'} />
      <Row label="วันที่" value={formatThaiDateTime(p.created_at)} />
      <Row label="การจอง" value={b.booking_no} />
      {/* receipt-row-wrap = ชื่อยาวขึ้นบรรทัดใหม่ได้ (ไม่ล้นขอบกระดาษ/ไม่บีบป้ายซ้าย) */}
      <Row label="ลูกค้า" value={b.customer.name || '-'} className="receipt-row-wrap" />
      {b.customer.phone && <Row label="โทร" value={formatPhone(b.customer.phone)} />}
      {p.created_by_name && <Row label="พนักงาน" value={p.created_by_name} className="receipt-row-wrap" />}
      <hr className="receipt-sep" />
      <div className="receipt-item">
        <div>{PAYMENT_KIND_LABELS[p.kind]}</div>
        <div className="receipt-small">
          {`รับชุด ${formatThaiDate(b.pickup_date)} – คืน ${formatThaiDate(b.return_date)} (${b.days} วัน)`}
        </div>
      </div>
      {b.lines.map(l => (
        <div key={l.id} className="receipt-small">{`- ${l.item_name} ${sizeLabel(l.size)} [${l.unit_code}]`}</div>
      ))}
      <hr className="receipt-sep" />
      <Row label={isOut(p) ? 'จ่ายคืนลูกค้า' : p.kind === 'security_apply' ? 'หักจากเงินประกัน' : 'รับเงิน'} value={amount(p.amount)} className="receipt-total" />
      <Row label="วิธี" value={METHOD_LABELS[p.method]} />
      {p.note && <p className="receipt-small">{`หมายเหตุ: ${p.note}`}</p>}
      {p.voided_at && p.void_reason && <p className="receipt-small">{`เหตุผลที่ยกเลิก: ${p.void_reason}`}</p>}
      <hr className="receipt-sep" />
      <p className="receipt-small receipt-bold">ยอด ณ เวลาที่พิมพ์</p>
      <Row label="ยอดรวมการเช่า" value={amount(m.grand_total)} />
      <Row label="ชำระแล้ว" value={amount(m.paid)} />
      <Row label={m.due < 0 ? 'ชำระเกิน (ร้านต้องคืน)' : 'คงเหลือ'} value={amount(Math.abs(m.due))} className="receipt-bold" />
      {(m.security_required > 0 || m.security_held > 0) && (
        <Row label="เงินประกันที่ร้านถือ" value={amount(m.security_held)} />
      )}
      <p className="receipt-right receipt-small">จำนวนเงินเป็นบาท</p>
      <p style={{ marginTop: 18 }}>
        {isOut(p) ? 'ผู้รับเงินคืน' : 'ผู้รับเงิน'} ........................................
      </p>
      <hr className="receipt-sep" />
      {settings.receipt_footer && <p className="receipt-center whitespace-pre-line">{settings.receipt_footer}</p>}
      <p className="receipt-center receipt-small" style={{ marginTop: 6 }}>
        {`พิมพ์ ${formatThaiDateTime(new Date())}`}
      </p>
    </div>
  )
}

function ReceiptA4({ booking: b, payment: p, settings }: { booking: RentalBooking; payment: RentalPayment; settings: RentalSettings }) {
  const m = b.money
  const out = isOut(p)
  return (
    <div className="receipt rdoc">
      <A4Style />
      <div className="rdoc-page">
        <DocHeader
          settings={settings}
          right={
            // ห่อเป็นก้อนเดียว — ช่องขวาของหัวกระดาษเป็น flex แถว (เผื่อ QR) ; ส่ง fragment = หัวเรื่อง/เลขที่ถูกบีบเป็นคอลัมน์แคบๆ ตัดคำกลางเลขที่
            <div>
              <div className="rdoc-title">{RECEIPT_TITLES[p.kind]}</div>
              <div style={{ marginTop: 3 }}>เลขที่ <strong>{p.receipt_no ?? '-'}</strong></div>
              <div className="rdoc-small">วันที่ {formatThaiDateTime(p.created_at)}</div>
              <div className="rdoc-small">อ้างอิงการจอง {b.booking_no}</div>
            </div>
          }
        />
        {p.voided_at && <div className="rdoc-banner">ยกเลิกแล้ว{p.void_reason ? ` — ${p.void_reason}` : ''}</div>}
        {p.status !== 'confirmed' && <div className="rdoc-banner">{PAYMENT_STATUS_LABELS[p.status]}</div>}

        <div className="rdoc-section rdoc-grid">
          <KV label={out ? 'จ่ายให้' : 'ได้รับเงินจาก'} value={b.customer.name} />
          <KV label="โทรศัพท์" value={b.customer.phone ? formatPhone(b.customer.phone) : ''} />
          <KV label="ระยะเวลาเช่า" value={`${formatThaiDate(b.pickup_date)} – ${formatThaiDate(b.return_date)} (${b.days} วัน)`} />
          <KV label="พนักงาน" value={p.created_by_name ?? ''} />
        </div>

        <div className="rdoc-section">
          <table className="rdoc-table">
            <thead>
              <tr>
                <th>รายการ</th>
                <th className="center">วิธี</th>
                <th className="num">จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <div style={{ fontWeight: 700 }}>{PAYMENT_KIND_LABELS[p.kind]}</div>
                  <div className="rdoc-small">
                    {b.lines.map(l => `${l.item_name} ${sizeLabel(l.size)} [${l.unit_code}]`).join(', ')}
                  </div>
                  {p.note && <div className="rdoc-small">หมายเหตุ: {p.note}</div>}
                </td>
                <td className="center">{METHOD_LABELS[p.method]}</td>
                <td className="num" style={{ fontWeight: 700, fontSize: 14 }}>{amount(p.amount)}</td>
              </tr>
            </tbody>
          </table>
          <div className="rdoc-small" style={{ textAlign: 'right' }}>จำนวนเงินเป็นบาท</div>
        </div>

        <div className="rdoc-section rdoc-keep">
          <table className="rdoc-sum">
            <tbody>
              <tr><td colSpan={2} className="rdoc-sum-head">ยอดของการจอง ณ เวลาที่พิมพ์</td></tr>
              <tr><td>ยอดรวมการเช่า</td><td>{amount(m.grand_total)}</td></tr>
              <tr><td>ชำระแล้ว</td><td>{amount(m.paid)}</td></tr>
              <tr className="strong"><td>{m.due < 0 ? 'ชำระเกิน (ร้านต้องคืน)' : 'คงเหลือต้องชำระ'}</td><td>{amount(Math.abs(m.due))}</td></tr>
              {(m.security_required > 0 || m.security_held > 0) && (
                <tr><td>เงินประกันที่ร้านถือ</td><td>{amount(m.security_held)}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <SignatureBlock
          roles={out ? ['ผู้รับเงินคืน', 'ผู้จ่ายเงิน (ร้าน)'] : ['ผู้จ่ายเงิน', 'ผู้รับเงิน (ร้าน)']}
          names={out ? [b.customer.name] : [b.customer.name, p.created_by_name]}
        />
        {settings.receipt_footer && (
          <div className="rdoc-section" style={{ textAlign: 'center', whiteSpace: 'pre-line' }}>{settings.receipt_footer}</div>
        )}
        <PrintedAt />
      </div>
    </div>
  )
}
