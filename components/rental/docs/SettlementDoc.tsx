// ใบสรุปการคืนชุด (A4) — สภาพชุดที่คืน, ค่าปรับ/ค่าเสียหาย, เงินประกันที่หัก/คืน, ยอดคงเหลือ + ลงชื่อทั้งสองฝ่าย
// ยอดเงินประกันแยกจากรายการเงินที่ยืนยันแล้ว (ไม่นับรายการที่ยกเลิก/สลิปที่ยังไม่อนุมัติ)
import { formatThaiDate, formatThaiDateTime } from '@/lib/format'
import { round2, sumBy } from '@/lib/money'
import {
  CHARGE_KIND_LABELS, CONDITION_LABELS, LINE_STATUS_LABELS, formatPhone, sizeLabel,
  type RentalBooking, type RentalSettings,
} from '@/lib/rental'
import { A4Style, DocHeader, KV, PrintedAt, SignatureBlock, amount } from './docKit'

export default function SettlementDoc({ booking: b, settings }: { booking: RentalBooking; settings: RentalSettings }) {
  const m = b.money
  const live = b.payments.filter(p => p.status === 'confirmed' && !p.voided_at)
  const secIn = sumBy(live.filter(p => p.kind === 'security_in'), p => p.amount)
  const secApply = sumBy(live.filter(p => p.kind === 'security_apply'), p => p.amount)
  const secOut = sumBy(live.filter(p => p.kind === 'security_out'), p => p.amount)
  const charges = b.charges.filter(ch => !ch.voided_at)
  const settled = Math.abs(m.due) < 0.005 && m.security_held < 0.005

  return (
    <div className="receipt rdoc">
      <A4Style />
      <div className="rdoc-page">
        <DocHeader
          settings={settings}
          right={
            // ห่อเป็นก้อนเดียว — ช่องขวาของหัวกระดาษเป็น flex แถว (เผื่อ QR) ; ส่ง fragment = หัวเรื่อง/เลขที่ถูกบีบเป็นคอลัมน์แคบๆ ตัดคำกลางเลขที่
            <div>
              <div className="rdoc-title">ใบสรุปการคืนชุด</div>
              <div style={{ marginTop: 3 }}>การจอง <strong>{b.booking_no}</strong></div>
              <div className="rdoc-small">
                {b.returned_at ? `รับคืนเมื่อ ${formatThaiDateTime(b.returned_at)}` : 'ยังไม่ได้บันทึกรับคืน'}
              </div>
            </div>
          }
        />

        <div className="rdoc-section rdoc-grid">
          <KV label="ลูกค้า" value={b.customer.name} />
          <KV label="โทรศัพท์" value={formatPhone(b.customer.phone)} />
          <KV label="วันรับชุด" value={formatThaiDate(b.pickup_date)} />
          <KV label="กำหนดคืน" value={formatThaiDate(b.return_date)} />
          <KV label="วันที่คืนจริง" value={b.returned_on ? formatThaiDate(b.returned_on) : '-'} />
          <KV label="คืนช้า" value={b.late.late_days > 0 ? `${b.late.late_days} วัน` : 'ไม่ช้า'} />
        </div>

        <div className="rdoc-section">
          <div className="rdoc-h2">สภาพชุดที่คืน</div>
          <table className="rdoc-table">
            <thead>
              <tr>
                <th className="center">ลำดับ</th>
                <th style={{ whiteSpace: 'nowrap' }}>รหัสชิ้น</th>
                <th>รายการ</th>
                <th className="center">ไซส์</th>
                <th>สภาพ</th>
                <th>หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {b.lines.map((l, i) => (
                <tr key={l.id}>
                  <td className="center">{i + 1}</td>
                  <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{l.unit_code}</td>
                  <td>{l.item_name}</td>
                  <td className="center">{sizeLabel(l.size)}</td>
                  <td>{l.return_condition ? CONDITION_LABELS[l.return_condition] : LINE_STATUS_LABELS[l.status]}</td>
                  <td>{l.return_note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rdoc-section rdoc-keep">
          <div className="rdoc-h2">ค่าปรับ / ค่าใช้จ่ายเพิ่มเติม</div>
          {charges.length === 0 ? (
            <div className="rdoc-small">ไม่มี</div>
          ) : (
            <table className="rdoc-table">
              <thead>
                <tr>
                  <th>ประเภท</th>
                  <th>รายละเอียด</th>
                  <th className="num">จำนวนเงิน</th>
                </tr>
              </thead>
              <tbody>
                {charges.map(ch => (
                  <tr key={ch.id}>
                    <td>{CHARGE_KIND_LABELS[ch.kind]}</td>
                    <td>{ch.description}</td>
                    <td className="num">{amount(ch.amount)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={2} style={{ textAlign: 'right', fontWeight: 700 }}>รวม</td>
                  <td className="num" style={{ fontWeight: 700 }}>{amount(m.charges_total)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        <div className="rdoc-section rdoc-keep" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <table className="rdoc-sum" style={{ width: '50%', flex: '1 1 0', margin: 0 }}>
            <tbody>
              <tr><td colSpan={2} className="rdoc-sum-head">ค่าเช่าและค่าใช้จ่าย</td></tr>
              <tr><td>ค่าเช่ารวม</td><td>{amount(m.rent_total)}</td></tr>
              {m.discount > 0 && <tr><td>ส่วนลด</td><td>-{amount(m.discount)}</td></tr>}
              {m.delivery_fee > 0 && <tr><td>ค่าจัดส่ง</td><td>{amount(m.delivery_fee)}</td></tr>}
              <tr><td>ค่าปรับ / ค่าใช้จ่าย</td><td>{amount(m.charges_total)}</td></tr>
              <tr className="total"><td>ยอดรวมทั้งสิ้น</td><td>{amount(m.grand_total)}</td></tr>
              <tr><td>ชำระแล้ว (รวมหักเงินประกัน)</td><td>{amount(m.paid)}</td></tr>
              <tr className="strong"><td>{m.due < 0 ? 'ชำระเกิน (ร้านต้องคืน)' : 'คงเหลือต้องชำระ'}</td><td>{amount(Math.abs(m.due))}</td></tr>
            </tbody>
          </table>
          <table className="rdoc-sum" style={{ width: '46%', flex: 'none', margin: 0 }}>
            <tbody>
              <tr><td colSpan={2} className="rdoc-sum-head">เงินประกันชุด</td></tr>
              <tr><td>รับไว้</td><td>{amount(secIn)}</td></tr>
              <tr><td>หักเป็นค่าเช่า/ค่าปรับ</td><td>{secApply > 0 ? '-' : ''}{amount(secApply)}</td></tr>
              <tr><td>คืนให้ลูกค้าแล้ว</td><td>{secOut > 0 ? '-' : ''}{amount(secOut)}</td></tr>
              <tr className="total"><td>ร้านยังถืออยู่</td><td>{amount(round2(m.security_held))}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="rdoc-small" style={{ textAlign: 'right' }}>จำนวนเงินเป็นบาท</div>

        <div className="rdoc-section rdoc-box rdoc-keep" style={{ fontWeight: 700 }}>
          {settled
            ? 'สรุป: ชำระครบ และเคลียร์เงินประกันเรียบร้อยแล้ว'
            : [
                m.due > 0.005 ? `ลูกค้าต้องชำระเพิ่ม ${amount(m.due)} บาท` : '',
                m.due < -0.005 ? `ร้านต้องคืนเงินที่รับเกิน ${amount(-m.due)} บาท` : '',
                m.security_held >= 0.005 ? `ร้านต้องคืน/หักเงินประกันอีก ${amount(m.security_held)} บาท` : '',
              ].filter(Boolean).join(' · ')}
        </div>

        <SignatureBlock roles={['ลูกค้า', 'พนักงานรับคืน']} names={[b.customer.name]} />
        <PrintedAt extra={b.booking_no} />
      </div>
    </div>
  )
}
