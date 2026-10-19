// ใบส่งมอบชุด (A4) — ใช้ตอนลูกค้ารับชุด: ตรวจรหัสชิ้น + สภาพ + อุปกรณ์ครบ แล้วลงชื่อทั้งสองฝ่าย
// ช่องสภาพเป็นกล่องว่างให้ติ๊ก/เขียนด้วยมือ (กระดาษเป็นหลักฐานถ้ามีข้อโต้แย้งตอนคืน)
import { formatThaiDate, formatThaiDateTime, formatThaiDayLong } from '@/lib/format'
import {
  DELIVERY_METHOD_LABELS, LATE_FEE_MODE_LABELS, formatPhone, maskIdCard, sizeLabel,
  type RentalBooking, type RentalSettings,
} from '@/lib/rental'
import { A4Style, DocHeader, KV, PrintedAt, SignatureBlock, amount } from './docKit'

export default function PickupDoc({ booking: b, settings }: { booking: RentalBooking; settings: RentalSettings }) {
  const m = b.money
  const c = b.customer
  // ค่าปรับคืนช้าต่อวัน ตามแบบที่ร้านตั้ง (แจ้งลูกค้าในใบนี้)
  const perDay = settings.late_fee_mode === 'per_day_item'
    ? b.lines.reduce((s, l) => s + l.extra_day_price, 0)
    : settings.late_fee_mode === 'fixed_per_day' ? settings.late_fee_fixed : 0
  return (
    <div className="receipt rdoc">
      <A4Style />
      <div className="rdoc-page">
        <DocHeader
          settings={settings}
          right={
            // ห่อเป็นก้อนเดียว — ช่องขวาของหัวกระดาษเป็น flex แถว (เผื่อ QR) ; ส่ง fragment = หัวเรื่อง/เลขที่ถูกบีบเป็นคอลัมน์แคบๆ ตัดคำกลางเลขที่
            <div>
              <div className="rdoc-title">ใบส่งมอบชุด</div>
              <div style={{ marginTop: 3 }}>การจอง <strong>{b.booking_no}</strong></div>
              <div className="rdoc-small">
                {b.picked_up_at ? `รับชุดเมื่อ ${formatThaiDateTime(b.picked_up_at)}` : `นัดรับ ${formatThaiDate(b.pickup_date)}${b.pickup_time ? ` ${b.pickup_time}` : ''}`}
              </div>
            </div>
          }
        />

        <div className="rdoc-section rdoc-grid">
          <KV label="ผู้รับชุด" value={c.name} />
          <KV label="โทรศัพท์" value={formatPhone(c.phone)} />
          <KV label="เลขบัตร" value={c.id_card_no ? maskIdCard(c.id_card_no) : ''} />
          <KV label="ตรวจบัตรแล้ว" value={b.id_checked ? 'ตรวจแล้ว' : '[  ] ตรวจแล้ว'} />
          <KV label="กำหนดคืนชุด" value={formatThaiDayLong(b.return_date)} />
          <KV label="จำนวนวันเช่า" value={`${b.days} วัน`} />
          <KV
            label="การรับชุด"
            value={`${DELIVERY_METHOD_LABELS[b.delivery_method]}${b.delivery_method === 'delivery' && b.delivery_address ? ` — ${b.delivery_address}` : ''}`}
          />
          <KV label="วันงาน" value={b.event_date ? formatThaiDate(b.event_date) : ''} />
        </div>

        <div className="rdoc-section">
          <div className="rdoc-h2">รายการชุดที่ส่งมอบ (ตรวจด้วยกันทั้งสองฝ่าย)</div>
          <table className="rdoc-table">
            <thead>
              <tr>
                <th className="center">ลำดับ</th>
                <th style={{ whiteSpace: 'nowrap' }}>รหัสชิ้น</th>
                <th>รายการ</th>
                <th className="center">ไซส์</th>
                <th style={{ width: '38%' }}>สภาพตอนส่งมอบ</th>
                <th className="center">ครบ</th>
              </tr>
            </thead>
            <tbody>
              {b.lines.map((l, i) => (
                <tr key={l.id}>
                  <td className="center">{i + 1}</td>
                  <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{l.unit_code}</td>
                  <td>{l.item_name}<div className="rdoc-small">{l.item_code}</div></td>
                  <td className="center">{sizeLabel(l.size)}</td>
                  <td>
                    <span className="rdoc-check" />ปกติ{'  '}
                    <span className="rdoc-check" style={{ marginLeft: 8 }} />มีตำหนิ ......................................
                  </td>
                  <td className="center"><span className="rdoc-check" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rdoc-section rdoc-keep" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div className="rdoc-box" style={{ flex: '1 1 0', minWidth: 0 }}>
            <div className="rdoc-h2">ข้อควรทราบ</div>
            <div className="rdoc-small">- กรุณาคืนชุดภายใน{formatThaiDayLong(b.return_date)}</div>
            <div className="rdoc-small">
              - {settings.late_fee_mode === 'none'
                ? 'คืนช้ากว่ากำหนดกรุณาแจ้งร้านล่วงหน้า'
                : `คืนช้าคิดค่าปรับ ${amount(perDay)} บาทต่อวัน (${LATE_FEE_MODE_LABELS[settings.late_fee_mode]})`}
            </div>
            <div className="rdoc-small">- ห้ามซัก รีด หรือดัดแปลงชุดเอง ชุดเสียหาย/สูญหายคิดค่าใช้จ่ายตามข้อตกลง</div>
          </div>
          <table className="rdoc-sum" style={{ width: '44%', flex: 'none' }}>
            <tbody>
              <tr><td>ยอดรวมการเช่า</td><td>{amount(m.grand_total)}</td></tr>
              <tr><td>ชำระแล้ว</td><td>{amount(m.paid)}</td></tr>
              <tr className="strong"><td>{m.due < 0 ? 'ชำระเกิน' : 'คงเหลือ'}</td><td>{amount(Math.abs(m.due))}</td></tr>
              <tr><td>เงินประกันที่ต้องวาง</td><td>{amount(m.security_required)}</td></tr>
              <tr className="strong"><td>เงินประกันที่ร้านรับไว้</td><td>{amount(m.security_held)}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="rdoc-section rdoc-small">หมายเหตุ ..........................................................................................................................................................</div>

        <SignatureBlock roles={['ผู้รับชุด (ลูกค้า)', 'ผู้ส่งมอบ (พนักงาน)']} names={[c.name]} />
        <PrintedAt extra={b.booking_no} />
      </div>
    </div>
  )
}
