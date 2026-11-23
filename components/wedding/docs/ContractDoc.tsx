// ===== สัญญาจ้างบริการถ่ายทำงานแต่งงาน (กระดาษ A4) — ร้าน b.oncloud =====
// 2 ฉบับในการพิมพ์ครั้งเดียว: ฉบับลูกค้า + ฉบับผู้ให้บริการ (แต่ละฉบับขึ้นหน้าใหม่) · เงื่อนไขครบทุกข้อจาก wed_settings.terms_text
// ใช้คู่ components/pos/PrintPortal paper="a4" · ใช้ชิ้นส่วน/สไตล์ A4 ชุดเดียวกับเอกสารร้านเช่า (components/rental/docs/docKit)
//   กล่อง .receipt = ตัวอักษรดำล้วน ไม่มีพื้นหลัง (เครื่องพิมพ์ขาวดำอ่านชัด)
// ไม่มีค่าจ้างทีมงาน/ต้นทุน · QR ลิงก์ติดตามงานสร้างเป็น data URL ไว้ก่อนสั่งพิมพ์ (ไม่มี = ไม่แสดง)
import { formatThaiDate } from '@/lib/format'
import { formatPromptPayId, isValidPromptPayId } from '@/lib/promptpay'
import {
  INSTALLMENT_STATUS_LABELS, formatPhone, sessionTimeText, termsLines,
  type WedBooking, type WedSettings,
} from '@/lib/wedding'
// เงื่อนไขแยกข้อด้วย termsLines (lib/wedding) ตัวเดียวกับตัวอย่างในหน้าตั้งค่าร้าน/รูปเอกสาร/ลิงก์ลูกค้า — สัญญาที่พิมพ์ตรงกับที่บอสเห็นตอนตั้งค่า
import { A4Style, KV, PrintedAt, SignatureBlock, amount } from '@/components/rental/docs/docKit'
import { activeSessions, finalDueDate } from './docKinds'

export default function ContractDoc({
  booking,
  settings,
  qrDataUrl,
}: {
  booking: WedBooking
  settings: WedSettings
  qrDataUrl: string | null
}) {
  return (
    <div className="receipt rdoc" data-shop="wedding">
      <A4Style />
      <ContractCopy booking={booking} settings={settings} qrDataUrl={qrDataUrl} copy="customer" />
      <ContractCopy booking={booking} settings={settings} qrDataUrl={qrDataUrl} copy="shop" />
    </div>
  )
}

function ContractCopy({
  booking: b,
  settings: s,
  qrDataUrl,
  copy,
}: {
  booking: WedBooking
  settings: WedSettings
  qrDataUrl: string | null
  copy: 'customer' | 'shop'
}) {
  const m = b.money
  const c = b.customer
  const copyLabel = copy === 'customer' ? 'ฉบับลูกค้า' : 'ฉบับผู้ให้บริการ'
  const sessions = activeSessions(b)
  const charges = b.charges.filter(x => !x.voided_at)
  const terms = termsLines(s.terms_text)
  const phones = [c.phone ? formatPhone(c.phone) : '', c.phone2 ? formatPhone(c.phone2) : ''].filter(Boolean).join(' / ')
  const contact = [s.phone ? `โทร ${formatPhone(s.phone)}` : '', s.line_id ? `LINE ${s.line_id}` : '', s.email ?? '']
    .filter(Boolean).join(' · ')
  const pp = s.promptpay_id && isValidPromptPayId(s.promptpay_id) ? s.promptpay_id : null
  const ended = b.status === 'cancelled' || b.status === 'postponed'
  const signedOn = b.confirmed_at ?? b.created_at
  const balanceDue = finalDueDate(b)

  return (
    <div className="rdoc-page">
      <div className="rdoc-head">
        <div className="rdoc-head-left">
          <div className="rdoc-shop">{s.shop_name}</div>
          {s.tagline && <div className="rdoc-small">{s.tagline}</div>}
          {s.address && <div className="rdoc-small" style={{ whiteSpace: 'pre-line' }}>{s.address}</div>}
          {contact && <div className="rdoc-small">{contact}</div>}
        </div>
        <div className="rdoc-head-right">
          <div>
            <div className="rdoc-title">สัญญาจ้างบริการถ่ายทำงานแต่งงาน</div>
            <div className="rdoc-copy">{copyLabel}</div>
            <div style={{ marginTop: 3 }}>เลขที่สัญญา <strong>{b.booking_no}</strong></div>
            <div className="rdoc-small">วันที่ทำสัญญา {formatThaiDate(signedOn)}</div>
          </div>
          {qrDataUrl && (
            <div className="rdoc-qr">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="คิวอาร์โค้ดหน้าติดตามงาน" />
              <span>สแกนติดตามงาน</span>
            </div>
          )}
        </div>
      </div>

      {ended && <div className="rdoc-banner">{b.status_label}</div>}

      <p className="rdoc-section" style={{ textIndent: '10mm' }}>
        สัญญาฉบับนี้ทำขึ้นระหว่าง <strong>{s.shop_name}</strong> ซึ่งต่อไปในสัญญานี้เรียกว่า &quot;ผู้ให้บริการ&quot; ฝ่ายหนึ่ง
        กับ <strong>{c.name || '........................................'}</strong> ซึ่งต่อไปในสัญญานี้เรียกว่า &quot;ผู้ว่าจ้าง&quot; อีกฝ่ายหนึ่ง
        ทั้งสองฝ่ายตกลงทำสัญญาจ้างบริการถ่ายภาพ วิดีโอ และคอนเทนต์งานแต่งงานของ <strong>{b.couple_names || '-'}</strong> ตามรายละเอียดและเงื่อนไขดังต่อไปนี้
      </p>

      <div className="rdoc-section rdoc-keep">
        <div className="rdoc-h2">ข้อมูลผู้ว่าจ้าง</div>
        <div className="rdoc-grid">
          <KV label="ชื่อ-นามสกุล" value={c.name} />
          <KV label="คู่สมรส" value={c.partner_name ?? ''} />
          <KV label="โทรศัพท์" value={phones} />
          <KV label="LINE" value={c.line_id ?? ''} />
          {c.email && <KV label="อีเมล" value={c.email} />}
          <KV label="ชื่อบนเอกสาร" value={b.couple_names} />
        </div>
        {c.address && <KV label="ที่อยู่" value={<span style={{ whiteSpace: 'pre-line' }}>{c.address}</span>} />}
        {(b.coordinator_name || b.coordinator_phone) && (
          <KV
            label="ผู้ประสานงาน"
            value={`${b.coordinator_name ?? '-'}${b.coordinator_phone ? ` (โทร ${formatPhone(b.coordinator_phone)})` : ''}`}
          />
        )}
      </div>

      <div className="rdoc-section">
        <div className="rdoc-h2">ข้อ 1 วัน เวลา และสถานที่ให้บริการ</div>
        {sessions.length === 0 ? (
          <div className="rdoc-small">ยังไม่ได้กำหนดคิวงาน — ทั้งสองฝ่ายจะตกลงวันเวลาและแจ้งเป็นลายลักษณ์อักษรภายหลัง</div>
        ) : (
          <table className="rdoc-table">
            <thead>
              <tr>
                <th className="center">ลำดับ</th>
                <th>วันที่</th>
                <th>เวลา</th>
                <th>รายการ</th>
                <th>สถานที่</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((x, i) => (
                <tr key={x.id}>
                  <td className="center">{i + 1}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{x.date ? formatThaiDate(x.date) : 'ยังไม่กำหนด'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{sessionTimeText(x, '-')}</td>
                  <td>{[x.type_label, x.title].filter(Boolean).join(' · ')}</td>
                  <td>
                    {x.venue_name || '-'}
                    {x.venue_address && <div className="rdoc-small" style={{ whiteSpace: 'pre-line' }}>{x.venue_address}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rdoc-section rdoc-keep">
        <div className="rdoc-h2">ข้อ 2 แพ็กเกจและผลงานที่ผู้ว่าจ้างจะได้รับ</div>
        <KV
          label="แพ็กเกจ"
          value={`${b.package.name || 'แพ็กเกจกำหนดเอง'}${b.package.hours > 0 ? ` (ถ่ายทำ ${b.package.hours} ชั่วโมง)` : ''}`}
        />
        {b.package.description && <div className="rdoc-small" style={{ whiteSpace: 'pre-line', marginTop: 2 }}>{b.package.description}</div>}
        {(b.deliverables.length > 0 || b.deliverables_plan.length > 0) && (
          <table className="rdoc-table" style={{ marginTop: 4 }}>
            <thead>
              <tr>
                <th>ผลงาน</th>
                <th className="center">จำนวน</th>
                <th>กำหนดส่ง</th>
              </tr>
            </thead>
            <tbody>
              {b.deliverables.length > 0
                ? b.deliverables.map(d => (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td className="center">{d.qty}{d.unit ? ` ${d.unit}` : ''}</td>
                    <td>{d.due_date ? `ภายใน ${formatThaiDate(d.due_date)}` : '-'}</td>
                  </tr>
                ))
                : b.deliverables_plan.map((d, i) => (
                  <tr key={`${d.name}-${i}`}>
                    <td>{d.name}</td>
                    <td className="center">{d.qty}{d.unit ? ` ${d.unit}` : ''}</td>
                    <td>{d.due_days > 0 ? `ภายใน ${d.due_days} วันหลังวันงาน` : 'หลังวันงาน'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
        {b.addons.length > 0 && (
          <KV label="บริการเสริม" value={b.addons.map(a => `${a.name}${Math.abs(a.qty - 1) > 0.001 ? ` × ${a.qty}${a.unit ? ` ${a.unit}` : ''}` : ''}`).join(', ')} />
        )}
      </div>

      <div className="rdoc-section rdoc-keep">
        <div className="rdoc-h2">ข้อ 3 ค่าบริการ</div>
        <table className="rdoc-table">
          <thead>
            <tr>
              <th>รายการ</th>
              <th className="center">จำนวน</th>
              <th className="num">ราคา/หน่วย</th>
              <th className="num">รวม</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{b.package.name || 'แพ็กเกจกำหนดเอง'}</td>
              <td className="center">1</td>
              <td className="num">{amount(m.package_price)}</td>
              <td className="num">{amount(m.package_price)}</td>
            </tr>
            {b.addons.map(a => (
              <tr key={a.id || a.name}>
                <td>{a.name}</td>
                <td className="center">{a.qty}{a.unit ? ` ${a.unit}` : ''}</td>
                <td className="num">{amount(a.unit_price)}</td>
                <td className="num">{amount(a.amount)}</td>
              </tr>
            ))}
            {m.travel_fee > 0 && (
              <tr>
                <td>ค่าเดินทาง</td>
                <td className="center">1</td>
                <td className="num">{amount(m.travel_fee)}</td>
                <td className="num">{amount(m.travel_fee)}</td>
              </tr>
            )}
            {charges.map(x => (
              <tr key={x.id}>
                <td>{x.description || 'ค่าใช้จ่ายเพิ่มเติม'}</td>
                <td className="center">1</td>
                <td className="num">{amount(x.amount)}</td>
                <td className="num">{amount(x.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="rdoc-sum" style={{ marginTop: 3 }}>
          <tbody>
            <tr><td>รวมก่อนส่วนลด</td><td>{amount(m.pre_discount_total + m.charges_total)}</td></tr>
            {m.discount > 0 && <tr><td>ส่วนลด{m.discount_note ? ` (${m.discount_note})` : ''}</td><td>-{amount(m.discount)}</td></tr>}
            <tr className="total"><td>ค่าบริการสุทธิ</td><td>{amount(m.grand_total)}</td></tr>
            <tr><td>ชำระแล้ว ณ วันที่พิมพ์</td><td>{amount(m.paid)}</td></tr>
            {b.status === 'cancelled' ? (
              // งานยกเลิก: ไม่มีการเรียกเก็บอีก (ฐานข้อมูลยังเก็บยอดค้างเดิม — ห้ามพิมพ์เป็นยอดค้าง)
              <tr className="strong"><td>ยกเลิกแล้ว — ไม่มียอดต้องชำระ</td><td>-</td></tr>
            ) : (
              <tr className="strong"><td>{m.due < -0.005 ? 'ชำระเกิน (ผู้ให้บริการคืนให้)' : 'คงเหลือต้องชำระ'}</td><td>{amount(Math.abs(m.due))}</td></tr>
            )}
          </tbody>
        </table>
        <div className="rdoc-small" style={{ textAlign: 'right' }}>จำนวนเงินเป็นบาท</div>
      </div>

      <div className="rdoc-section rdoc-keep">
        <div className="rdoc-h2">ข้อ 4 การชำระเงิน</div>
        {m.deposit_required > 0 && (
          <div>
            ผู้ว่าจ้างชำระเงินมัดจำ <strong>{amount(m.deposit_required)}</strong> บาท
            {m.deposit_percent !== null && m.deposit_percent > 0 ? ` (ร้อยละ ${m.deposit_percent} ของค่าบริการ)` : ''} เพื่อยืนยันคิวงาน
            {balanceDue ? <> และชำระยอดคงเหลือภายในวันที่ <strong>{formatThaiDate(balanceDue)}</strong></> : null}
          </div>
        )}
        {b.installments.length > 0 && (
          <table className="rdoc-table rdoc-small" style={{ marginTop: 3 }}>
            <thead>
              <tr>
                <th>งวด</th>
                <th>กำหนดชำระ</th>
                <th className="num">จำนวนเงิน</th>
                <th className="num">คงเหลือ</th>
                <th className="center">สถานะ ณ วันที่พิมพ์</th>
              </tr>
            </thead>
            <tbody>
              {b.installments.map(i => (
                <tr key={i.id || i.seq}>
                  <td>{i.label || `งวดที่ ${i.seq}`}</td>
                  <td>{i.due_date ? formatThaiDate(i.due_date) : '-'}</td>
                  <td className="num">{amount(i.amount)}</td>
                  <td className="num">{amount(i.amount_remaining)}</td>
                  <td className="center">{i.overdue ? 'เลยกำหนด' : INSTALLMENT_STATUS_LABELS[i.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {(pp || s.bank_accounts.length > 0) && (
          <div className="rdoc-small" style={{ marginTop: 3 }}>
            ช่องทางชำระเงิน:{' '}
            {[
              pp ? `พร้อมเพย์ ${formatPromptPayId(pp)}${s.promptpay_name ? ` (${s.promptpay_name})` : ''}` : '',
              ...s.bank_accounts.map(a => `${a.bank} ${a.account_no}${a.account_name ? ` (${a.account_name})` : ''}`),
            ].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>

      {b.customer_note && (
        <div className="rdoc-section rdoc-keep">
          <KV label="ความต้องการเพิ่มเติม" value={<span style={{ whiteSpace: 'pre-line' }}>{b.customer_note}</span>} />
        </div>
      )}

      <div className="rdoc-section">
        <div className="rdoc-h2">ข้อ 5 ข้อตกลงและเงื่อนไข</div>
        {terms.length > 0 ? (
          <ol className="rdoc-terms">
            {terms.map((t, i) => <li key={i}>{t}</li>)}
          </ol>
        ) : (
          <div className="rdoc-small">ตามที่ทั้งสองฝ่ายตกลงกัน</div>
        )}
      </div>

      <p className="rdoc-section rdoc-keep" style={{ textIndent: '10mm' }}>
        ทั้งสองฝ่ายได้อ่านและเข้าใจข้อความในสัญญานี้โดยตลอดแล้ว เห็นว่าถูกต้องตรงตามเจตนา จึงได้ลงลายมือชื่อไว้เป็นสำคัญต่อหน้าพยาน
        สัญญานี้ทำขึ้นเป็นสองฉบับ มีข้อความถูกต้องตรงกัน ต่างฝ่ายต่างยึดถือไว้ฝ่ายละหนึ่งฉบับ
      </p>

      <SignatureBlock roles={['ผู้ว่าจ้าง', 'ผู้ให้บริการ', 'พยาน']} names={[c.name]} />
      <PrintedAt extra={`${b.booking_no} · ${copyLabel}`} />
    </div>
  )
}
