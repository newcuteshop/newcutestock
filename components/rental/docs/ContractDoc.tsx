// สัญญาเช่าชุด A4 — 2 ฉบับในการพิมพ์ครั้งเดียว: ฉบับร้าน (เลขบัตรเต็ม) + ฉบับลูกค้า (เลขบัตรปิดเหลือ 4 ตัวท้าย)
// แต่ละฉบับขึ้นหน้าใหม่ · มี QR ลิงก์สถานะการจองให้ลูกค้าสแกนดูยอด/แนบสลิปเอง (สร้าง data URL ไว้ก่อนสั่งพิมพ์)
// ใช้คู่ PrintPortal paper="a4"
import { formatThaiDate, formatThaiDayLong } from '@/lib/format'
import {
  DELIVERY_METHOD_LABELS, METHOD_LABELS, PAYMENT_KIND_LABELS, formatPhone, maskIdCard, sizeLabel,
  type RentalBooking, type RentalSettings,
} from '@/lib/rental'
import { A4Style, DocHeader, KV, PrintedAt, SignatureBlock, amount, termsList } from './docKit'

export default function ContractDoc({
  booking,
  settings,
  qrDataUrl,
}: {
  booking: RentalBooking
  settings: RentalSettings
  qrDataUrl: string | null
}) {
  return (
    <div className="receipt rdoc">
      <A4Style />
      <ContractCopy booking={booking} settings={settings} qrDataUrl={qrDataUrl} copy="shop" />
      <ContractCopy booking={booking} settings={settings} qrDataUrl={qrDataUrl} copy="customer" />
    </div>
  )
}

function ContractCopy({
  booking: b,
  settings,
  qrDataUrl,
  copy,
}: {
  booking: RentalBooking
  settings: RentalSettings
  qrDataUrl: string | null
  copy: 'shop' | 'customer'
}) {
  const m = b.money
  const c = b.customer
  const idText = c.id_card_no ? (copy === 'shop' ? c.id_card_no : maskIdCard(c.id_card_no)) : ''
  const phones = [formatPhone(c.phone), c.phone2 ? formatPhone(c.phone2) : ''].filter(Boolean).join(' / ')
  const payments = b.payments.filter(p => p.status === 'confirmed' && !p.voided_at)
  const terms = termsList(settings.terms_text)
  const ended = b.status === 'cancelled' || b.status === 'expired' || b.status === 'no_show'
  const depositTotal = b.lines.reduce((s, l) => s + l.deposit, 0)

  return (
    <div className="rdoc-page">
      <DocHeader
        settings={settings}
        right={
          <>
            <div>
              <div className="rdoc-title">สัญญาเช่าชุด</div>
              <div className="rdoc-copy">{copy === 'shop' ? 'ฉบับร้าน' : 'ฉบับลูกค้า'}</div>
              <div style={{ marginTop: 3 }}>เลขที่ <strong>{b.booking_no}</strong></div>
              <div className="rdoc-small">วันที่ทำสัญญา {formatThaiDate(b.created_at)}</div>
            </div>
            {/* QR อยู่ข้างหัวเรื่อง (ไม่ซ้อนลงมา) — ประหยัดความสูงให้สัญญาจบในหน้าเดียว */}
            {qrDataUrl && (
              <div className="rdoc-qr">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt="คิวอาร์โค้ดสถานะการจอง" />
                <span>สแกนดูสถานะ</span>
              </div>
            )}
          </>
        }
      />

      {ended && <div className="rdoc-banner">{b.status_label}</div>}

      <div className="rdoc-section rdoc-keep">
        <div className="rdoc-h2">ผู้เช่า</div>
        <div className="rdoc-grid">
          <KV label="ชื่อ-นามสกุล" value={c.name} />
          <KV label="โทรศัพท์" value={phones} />
          <KV label="เลขบัตร/พาสปอร์ต" value={idText} />
          <KV label="LINE" value={c.line_id ?? ''} />
        </div>
        {c.address && <KV label="ที่อยู่" value={<span style={{ whiteSpace: 'pre-line' }}>{c.address}</span>} />}
      </div>

      <div className="rdoc-section rdoc-keep">
        <div className="rdoc-h2">ระยะเวลาเช่า</div>
        <div className="rdoc-grid">
          <KV label="วันรับชุด" value={`${formatThaiDayLong(b.pickup_date)}${b.pickup_time ? ` เวลา ${b.pickup_time}` : ''}`} />
          <KV label="วันคืนชุด" value={formatThaiDayLong(b.return_date)} />
          <KV label="จำนวนวันเช่า" value={`${b.days} วัน`} />
          <KV label="วันงาน" value={b.event_date ? formatThaiDate(b.event_date) : ''} />
          {b.fitting_date && (
            <KV label="นัดลองชุด" value={`${formatThaiDate(b.fitting_date)}${b.fitting_time ? ` เวลา ${b.fitting_time}` : ''}`} />
          )}
          <KV
            label="การรับชุด"
            value={`${DELIVERY_METHOD_LABELS[b.delivery_method]}${b.delivery_method === 'delivery' && b.delivery_address ? ` — ${b.delivery_address}` : ''}`}
          />
        </div>
      </div>

      <div className="rdoc-section">
        <div className="rdoc-h2">รายการชุดที่เช่า</div>
        <table className="rdoc-table">
          <thead>
            <tr>
              <th className="center">ลำดับ</th>
              <th>รหัสชุด</th>
              <th>รายการ</th>
              <th className="center">ไซส์</th>
              <th>รหัสชิ้น</th>
              <th className="num">ค่าเช่า</th>
              <th className="num">เงินประกัน</th>
            </tr>
          </thead>
          <tbody>
            {b.lines.map((l, i) => (
              <tr key={l.id}>
                <td className="center">{i + 1}</td>
                <td>{l.item_code}</td>
                <td>{l.item_name}{l.is_accessory ? ' (อุปกรณ์เสริม)' : ''}</td>
                <td className="center">{sizeLabel(l.size)}</td>
                <td>{l.unit_code}</td>
                <td className="num">{amount(l.rent_price)}</td>
                <td className="num">{amount(l.deposit)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={5} style={{ textAlign: 'right', fontWeight: 700 }}>รวม {b.lines.length} รายการ</td>
              <td className="num" style={{ fontWeight: 700 }}>{amount(m.rent_total)}</td>
              <td className="num" style={{ fontWeight: 700 }}>{amount(depositTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="rdoc-section rdoc-keep" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 0', minWidth: 0 }}>
          <div className="rdoc-h2">การชำระเงินถึงวันที่พิมพ์</div>
          {payments.length === 0 ? (
            <div className="rdoc-small">ยังไม่มีรายการชำระเงิน</div>
          ) : (
            <table className="rdoc-table rdoc-small">
              <thead>
                <tr>
                  <th>วันที่</th>
                  <th>เลขที่ใบเสร็จ</th>
                  <th>รายการ</th>
                  <th className="num">จำนวนเงิน</th>
                </tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id}>
                    <td>{formatThaiDate(p.created_at)}</td>
                    <td>{p.receipt_no ?? '-'}</td>
                    <td>{PAYMENT_KIND_LABELS[p.kind]}{p.method !== 'none' ? ` (${METHOD_LABELS[p.method]})` : ''}</td>
                    <td className="num">{p.kind === 'refund' || p.kind === 'security_out' ? '-' : ''}{amount(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <table className="rdoc-sum" style={{ width: '46%', flex: 'none' }}>
          <tbody>
            <tr><td>ค่าเช่ารวม</td><td>{amount(m.rent_total)}</td></tr>
            {m.discount > 0 && <tr><td>ส่วนลด{m.discount_note ? ` (${m.discount_note})` : ''}</td><td>-{amount(m.discount)}</td></tr>}
            {m.delivery_fee > 0 && <tr><td>ค่าจัดส่ง</td><td>{amount(m.delivery_fee)}</td></tr>}
            {m.charges_total > 0 && <tr><td>ค่าปรับ / ค่าใช้จ่ายอื่น</td><td>{amount(m.charges_total)}</td></tr>}
            <tr className="total"><td>ยอดรวมทั้งสิ้น</td><td>{amount(m.grand_total)}</td></tr>
            <tr><td>ชำระแล้ว</td><td>{amount(m.paid)}</td></tr>
            <tr className="strong">
              <td>{m.due < 0 ? 'ชำระเกิน (ร้านต้องคืน)' : 'คงเหลือต้องชำระ'}</td>
              <td>{amount(Math.abs(m.due))}</td>
            </tr>
            <tr><td>มัดจำจองที่ต้องชำระ</td><td>{amount(m.deposit_required)}</td></tr>
            <tr><td>เงินประกันชุดที่ต้องวาง</td><td>{amount(m.security_required)}</td></tr>
            <tr><td>เงินประกันที่ร้านรับไว้</td><td>{amount(m.security_held)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="rdoc-small" style={{ textAlign: 'right' }}>จำนวนเงินเป็นบาท</div>

      {b.customer_note && (
        <div className="rdoc-section rdoc-keep">
          <KV label="หมายเหตุ" value={<span style={{ whiteSpace: 'pre-line' }}>{b.customer_note}</span>} />
        </div>
      )}

      {terms.length > 0 && (
        <div className="rdoc-section">
          <div className="rdoc-h2">ข้อตกลงการเช่า</div>
          <ol className="rdoc-terms">
            {terms.map((t, i) => <li key={i}>{t}</li>)}
          </ol>
        </div>
      )}

      <SignatureBlock roles={['ผู้เช่า', 'ผู้ให้เช่า', 'พยาน']} names={[c.name]} />
      <PrintedAt extra={`${b.booking_no} · ${copy === 'shop' ? 'ฉบับร้าน' : 'ฉบับลูกค้า'}`} />
    </div>
  )
}
