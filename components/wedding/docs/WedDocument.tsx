// ===== เอกสาร 6 แบบของร้าน b.oncloud (ส่งเป็นรูป PNG หรือพิมพ์ A4) =====
// ใบยืนยันการจอง · ใบเสนอราคา · ใบแจ้งชำระเงิน · ใบเสร็จรับเงิน · ตารางคิววันงาน (คู่บ่าวสาว/ทีมงาน) · สรุปการส่งงาน
// ทุกแบบวาดจากงานแบบเต็ม (wed_get_booking) + ตั้งค่าร้าน + รูปที่เตรียมไว้ (โลโก้/QR เป็น data URL) — ไม่มี hook/สถานะ
// mode 'image' = กว้าง 1080px สำหรับแปลงเป็นรูป · mode 'print' = A4 (ใช้คู่ PrintPortal paper="a4" + WedA4PageStyle)
// ความเป็นส่วนตัว: ค่าจ้างทีมงาน/ต้นทุน/กำไรไม่อยู่ในเอกสารใดเลย · ตารางสำหรับทีมไม่มีเงินและไม่มีลิงก์หน้าติดตามงานของลูกค้า
import { forwardRef } from 'react'
import { formatThaiDate, formatThaiDateTime } from '@/lib/format'
import { formatPromptPayId, isValidPromptPayId } from '@/lib/promptpay'
import {
  WED_RECEIPT_TITLES, formatPhone, sessionTimeText, wedDepositPercentOfAmount, wedMethodLabel, wedPurposeLabel,
  type WedBooking, type WedSettings,
} from '@/lib/wedding'
import {
  BankList, CancelledMoneyRows, CoupleHero, DocFooter, DocHeader, NoteBlock, PackageBlock, PaymentChannels, PaymentStatusBlock,
  PriceBreakdown, SectionTitle, SessionsBlock, StatusBanner, TermsBlock, WedDocFrame,
  DeliverablesList, deliverableStatusText, deliverableTone, docDayLong, docDueNow, docMoney, shortUrl,
  type DocAssets, type DocMode,
} from './docKit'
import { ConfirmationForm } from './ConfirmationForm'
import { DOC_KIND_LABELS, activeSessions, finalDueDate, pricesShown, type DocKind, type DocOptions } from './docKinds'

export interface WedDocProps {
  booking: WedBooking
  settings: WedSettings
  options: DocOptions
  assets: DocAssets
  /** วันที่ออกเอกสาร (day key ตามเวลาไทย) */
  issuedOn: string
  mode: DocMode
}

/** เอกสารตามชนิด — ref = กล่องนอกสุด (ส่งให้ renderNodeToPng) */
const WedDocument = forwardRef<HTMLDivElement, WedDocProps & { kind: DocKind }>(function WedDocument(props, ref) {
  const { kind, mode } = props
  return (
    <WedDocFrame ref={ref} mode={mode} label={mode === 'image' ? `ตัวอย่าง${DOC_KIND_LABELS[kind]}` : undefined}>
      {kind === 'confirmation' && <ConfirmationDoc {...props} />}
      {kind === 'quote' && <QuoteDoc {...props} />}
      {kind === 'payment_request' && <PaymentRequestDoc {...props} />}
      {kind === 'receipt' && <ReceiptDoc {...props} />}
      {kind === 'schedule' && <ScheduleDoc {...props} />}
      {kind === 'delivery' && <DeliveryDoc {...props} />}
    </WedDocFrame>
  )
})

export default WedDocument

// ---------------------------------------------------------------------------
// ส่วนประกอบเล็ก
// ---------------------------------------------------------------------------
function DocMeta({ booking: b, issuedOn, label = 'เลขที่งาน' }: { booking: WedBooking; issuedOn: string; label?: string }) {
  return (
    <>
      <p>{label} <b>{b.booking_no || '-'}</b></p>
      <p>วันที่ออกเอกสาร {formatThaiDate(issuedOn)}</p>
    </>
  )
}

function eventRangeText(b: WedBooking): string {
  if (!b.first_date) return 'ยังไม่กำหนดวันงาน'
  if (!b.last_date || b.last_date === b.first_date) return docDayLong(b.first_date)
  return `${formatThaiDate(b.first_date)} – ${formatThaiDate(b.last_date)}`
}

function Coordinator({ booking: b, showPhone = true }: { booking: WedBooking; showPhone?: boolean }) {
  if (!b.coordinator_name && !b.coordinator_phone) return null
  return (
    <div className="wdoc-kv">
      <span>ผู้ประสานงาน</span>
      <span>
        {b.coordinator_name || '-'}
        {showPhone && b.coordinator_phone ? ` · โทร ${formatPhone(b.coordinator_phone)}` : ''}
      </span>
    </div>
  )
}

/** ยอดค้างย่อ (ตารางคิว / สรุปส่งงานเมื่อเปิดแสดงราคา) */
function DueReminder({ booking: b }: { booking: WedBooking }) {
  const m = b.money
  // งานยกเลิกไม่มีการเรียกเก็บเงินอีก
  if (b.status === 'cancelled' || m.due <= 0.005) return null
  const nd = b.next_due
  return (
    <div className="wdoc-sec wdoc-keep">
      <SectionTitle>ยอดที่ต้องชำระ</SectionTitle>
      <div className="wdoc-rows">
        {nd && (
          <div className="wdoc-row wdoc-strong">
            <span>
              {nd.label || 'งวดถัดไป'}
              {nd.due_date ? <span className="wdoc-row-sub">{nd.overdue ? 'เลยกำหนด' : 'ชำระภายใน'} {formatThaiDate(nd.due_date)}</span> : null}
            </span>
            <span>{docMoney(docDueNow(b))}</span>
          </div>
        )}
        <div className="wdoc-row">
          <span>คงเหลือทั้งหมด</span>
          <span>{docMoney(m.due)}</span>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ใบยืนยันการจอง
// ---------------------------------------------------------------------------
// แบบฟอร์มกระดาษของร้าน (โลโก้ · ข้อมูลลูกค้า/วันงาน · กล่องรายการบริการ · เงื่อนไข | สรุปยอด · ช่องลงชื่อ) อยู่ใน ConfirmationForm.tsx
function ConfirmationDoc({ booking, settings, options, assets, issuedOn }: WedDocProps) {
  return <ConfirmationForm booking={booking} settings={settings} options={options} assets={assets} issuedOn={issuedOn} />
}

// ---------------------------------------------------------------------------
// ใบเสนอราคา
// ---------------------------------------------------------------------------
function QuoteDoc({ booking: b, settings, options, assets, issuedOn }: WedDocProps) {
  const m = b.money
  // มัดจำกำหนดเอง / ใช้มัดจำขั้นต่ำ / เต็มยอด = ไม่เขียน "(N% ของยอดบริการ)"
  const depositPct = wedDepositPercentOfAmount(m)
  const balanceDue = finalDueDate(b)
  return (
    <>
      <DocHeader
        settings={settings}
        logoSrc={assets.logoSrc}
        title="ใบเสนอราคา"
        showAddress
        meta={
          <>
            <DocMeta booking={b} issuedOn={issuedOn} label="เลขที่อ้างอิง" />
            {b.status === 'hold' && b.hold_until && <p>ยืนราคาและคิวถึง {formatThaiDateTime(b.hold_until)} น.</p>}
          </>
        }
      />
      <CoupleHero kicker="เสนอราคาบริการถ่ายทำงานแต่งงาน" couple={b.couple_names} sub={b.customer.name ? `เรียน ${b.customer.name}` : undefined} />
      {b.status === 'cancelled' && <StatusBanner booking={b} />}

      <SessionsBlock sessions={activeSessions(b)} variant="brief" title="รายละเอียดงาน" />
      <PackageBlock booking={b} showDescription />
      <PriceBreakdown booking={b} title="รายการและราคา" />

      <div className="wdoc-sec wdoc-keep">
        <SectionTitle>เงื่อนไขการชำระเงิน</SectionTitle>
        <div className="wdoc-rows">
          {m.deposit_required > 0 && (
            <div className="wdoc-row">
              <span>
                มัดจำเพื่อล็อกคิว
                {depositPct !== null && depositPct > 0 ? ` (${depositPct}% ของยอดบริการ)` : ''}
              </span>
              <span>{docMoney(m.deposit_required)}</span>
            </div>
          )}
          <div className="wdoc-row">
            <span>
              ยอดคงเหลือ
              {balanceDue ? <span className="wdoc-row-sub">ชำระภายใน {formatThaiDate(balanceDue)}</span> : null}
            </span>
            <span>{docMoney(Math.max(0, m.grand_total - Math.max(m.deposit_required, 0)))}</span>
          </div>
          {m.paid > 0.005 && (
            <div className="wdoc-row">
              <span>ชำระแล้ว</span>
              <span>{docMoney(m.paid)}</span>
            </div>
          )}
        </div>
        {b.installments.length > 2 && <PaymentStatusInstallments booking={b} />}
      </div>

      <PaymentChannels settings={settings} />
      {options.showTerms && <TermsBlock settings={settings} />}
      <NoteBlock text={settings.booking_note} />
      <DocFooter assets={assets} />
    </>
  )
}

// แผนงวด (ใช้ในใบเสนอราคาเมื่อแบ่งจ่ายมากกว่า มัดจำ + ยอดคงเหลือ)
function PaymentStatusInstallments({ booking: b }: { booking: WedBooking }) {
  return (
    <table className="wdoc-table" style={{ marginTop: '0.45em' }}>
      <thead>
        <tr>
          <th>งวด</th>
          <th className="nowrap">กำหนดชำระ</th>
          <th className="num">จำนวน</th>
        </tr>
      </thead>
      <tbody>
        {b.installments.map(i => (
          <tr key={i.id || i.seq}>
            <td>{i.label || `งวดที่ ${i.seq}`}</td>
            <td className="nowrap">{i.due_date ? formatThaiDate(i.due_date) : '-'}</td>
            <td className="num">{docMoney(i.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// ใบแจ้งชำระเงิน
// ---------------------------------------------------------------------------
function PaymentRequestDoc({ booking: b, settings, options, assets, issuedOn }: WedDocProps) {
  const amount = docDueNow(b)
  const cancelled = b.status === 'cancelled'
  const nd = b.next_due
  const pp = settings.promptpay_id && isValidPromptPayId(settings.promptpay_id) ? settings.promptpay_id : null
  const label = amount > 0 ? (nd?.label ? `ยอดที่ต้องชำระ · ${nd.label}` : 'ยอดที่ต้องชำระ') : cancelled ? 'งานยกเลิกแล้ว' : 'ไม่มียอดค้างชำระ'
  return (
    <>
      <DocHeader settings={settings} logoSrc={assets.logoSrc} title="ใบแจ้งชำระเงิน" meta={<DocMeta booking={b} issuedOn={issuedOn} />} />
      <CoupleHero kicker="แจ้งยอดชำระค่าบริการ" couple={b.couple_names} sub={`วันงาน ${eventRangeText(b)}`} />
      {b.status === 'cancelled' && <StatusBanner booking={b} />}

      <div className="wdoc-sec">
        <div className="wdoc-pay wdoc-keep">
          <div className="wdoc-pay-main">
            <p className="wdoc-pay-label">{label}</p>
            <p className="wdoc-pay-amount">{docMoney(amount)}</p>
            {amount > 0 && nd?.due_date && (
              <p className="wdoc-pay-sub">
                {nd.overdue ? 'เลยกำหนดชำระตั้งแต่' : 'กรุณาชำระภายใน'} <b>{formatThaiDate(nd.due_date)}</b>
              </p>
            )}
            {amount > 0 && pp && (
              <p className="wdoc-pay-sub">
                พร้อมเพย์ <b>{formatPromptPayId(pp)}</b>
                {settings.promptpay_name ? ` · ${settings.promptpay_name}` : ''}
              </p>
            )}
            {amount > 0 ? (
              <p className="wdoc-pay-sub">โอนแล้วกรุณาส่งสลิปให้ร้านทาง LINE พร้อมแจ้งเลขที่งาน <b>{b.booking_no}</b></p>
            ) : cancelled ? (
              <p className="wdoc-pay-sub">ไม่มียอดที่ต้องชำระ — สอบถามเรื่องเงินที่ชำระแล้วได้ที่ร้าน</p>
            ) : (
              <p className="wdoc-pay-sub">งานนี้ชำระครบแล้ว ขอบคุณที่ใช้บริการ</p>
            )}
          </div>
          {amount > 0 && assets.payQr && (
            <div className="wdoc-qr wdoc-qr-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assets.payQr} alt={`คิวอาร์โค้ดพร้อมเพย์ ยอด ${docMoney(amount)}`} />
              <span>สแกนจ่ายด้วยแอปธนาคาร</span>
            </div>
          )}
        </div>
      </div>

      {amount > 0 && settings.bank_accounts.length > 0 && (
        <div className="wdoc-sec wdoc-keep">
          <SectionTitle>{pp ? 'หรือโอนเข้าบัญชีธนาคาร' : 'โอนเข้าบัญชีธนาคาร'}</SectionTitle>
          <BankList accounts={settings.bank_accounts} />
        </div>
      )}

      <PaymentStatusBlock booking={b} title="สรุปยอดของงาน" />
      {options.showTerms && <TermsBlock settings={settings} />}
      <NoteBlock text={settings.booking_note} />
      <DocFooter assets={assets} />
    </>
  )
}

// ---------------------------------------------------------------------------
// ใบเสร็จรับเงิน / ใบคืนเงิน
// ---------------------------------------------------------------------------
function ReceiptDoc({ booking: b, settings, options, assets, mode }: WedDocProps) {
  const p = b.payments.find(x => x.id === options.paymentId) ?? null
  if (!p) {
    return (
      <>
        <DocHeader settings={settings} logoSrc={assets.logoSrc} title="ใบเสร็จรับเงิน" meta={<p>เลขที่งาน <b>{b.booking_no}</b></p>} />
        <div className="wdoc-sec">
          <p className="wdoc-text">ยังไม่มีรายการชำระเงินของงานนี้</p>
        </div>
      </>
    )
  }
  const refund = p.kind === 'refund'
  const m = b.money
  const purpose = p.purpose ? wedPurposeLabel(p.purpose) : refund ? 'คืนเงิน' : 'ชำระค่าบริการ'
  return (
    <>
      <DocHeader
        settings={settings}
        logoSrc={assets.logoSrc}
        title={WED_RECEIPT_TITLES[p.kind]}
        showAddress
        meta={
          <>
            <p>เลขที่ <b>{p.receipt_no ?? '-'}</b></p>
            <p>วันที่ {formatThaiDate(p.paid_on ?? p.created_at)}</p>
            <p>อ้างอิงงาน {b.booking_no}</p>
          </>
        }
      />
      {p.voided_at && (
        <div className="wdoc-banner wdoc-banner-bad">รายการนี้ถูกยกเลิกแล้ว{p.void_reason ? ` — ${p.void_reason}` : ''}</div>
      )}
      <CoupleHero
        kicker={refund ? 'จ่ายคืนให้' : 'ได้รับเงินจาก'}
        couple={b.customer.name || b.couple_names}
        sub={`งาน ${b.couple_names} · วันงาน ${eventRangeText(b)}`}
      />

      <div className="wdoc-sec">
        <div className="wdoc-pay wdoc-keep">
          <div className="wdoc-pay-main">
            <p className="wdoc-pay-label">{refund ? 'จำนวนเงินที่คืน' : 'จำนวนเงินที่ได้รับ'}</p>
            <p className="wdoc-pay-amount">{docMoney(p.amount)}</p>
            <p className="wdoc-pay-sub">
              รายการ <b>{purpose}</b> · {refund ? 'คืนโดย' : 'ชำระโดย'} <b>{wedMethodLabel(p.method)}</b>
            </p>
            {p.note && <p className="wdoc-pay-sub wdoc-pre">หมายเหตุ: {p.note}</p>}
          </div>
        </div>
      </div>

      <div className="wdoc-sec wdoc-keep">
        <div className="wdoc-grid2">
          <div className="wdoc-kv"><span>แพ็กเกจ</span><span>{b.package.name || 'แพ็กเกจกำหนดเอง'}</span></div>
          <div className="wdoc-kv"><span>เลขที่งาน</span><span>{b.booking_no}</span></div>
          <div className="wdoc-kv"><span>โทรศัพท์</span><span>{b.customer.phone ? formatPhone(b.customer.phone) : '-'}</span></div>
          <div className="wdoc-kv"><span>ผู้รับเงิน</span><span>{p.created_by_name || '-'}</span></div>
        </div>
      </div>

      <div className="wdoc-sec wdoc-keep">
        <SectionTitle aside="ยอด ณ วันที่ออกเอกสาร">ยอดของงาน</SectionTitle>
        {b.status === 'cancelled' ? (
          <CancelledMoneyRows booking={b} />
        ) : (
          <div className="wdoc-rows">
            <div className="wdoc-row"><span>ยอดสุทธิ</span><span>{docMoney(m.grand_total)}</span></div>
            <div className="wdoc-row"><span>ชำระแล้วทั้งหมด</span><span>{docMoney(m.paid)}</span></div>
            <div className="wdoc-row wdoc-strong">
              <span>{m.due < -0.005 ? 'ชำระเกิน (ร้านคืนให้)' : 'คงเหลือต้องชำระ'}</span>
              <span>{docMoney(Math.abs(m.due))}</span>
            </div>
          </div>
        )}
      </div>

      {mode === 'print' && (
        <div className="wdoc-sign">
          {[refund ? 'ผู้รับเงินคืน' : 'ผู้ชำระเงิน', refund ? 'ผู้จ่ายเงิน (ร้าน)' : 'ผู้รับเงิน (ร้าน)'].map((role, i) => (
            <div key={role}>
              <div className="wdoc-sign-line" />
              <p>({i === 0 ? ` ${b.customer.name || '........................................'} ` : ` ${p.created_by_name || '........................................'} `})</p>
              <p style={{ fontWeight: 700 }}>{role}</p>
            </div>
          ))}
        </div>
      )}
      <NoteBlock text={settings.receipt_footer} />
      <DocFooter assets={assets} />
    </>
  )
}

// ---------------------------------------------------------------------------
// ตารางคิววันงาน
// ---------------------------------------------------------------------------
function ScheduleDoc({ booking: b, settings, options, assets, issuedOn }: WedDocProps) {
  const all = activeSessions(b)
  const picked = options.sessionId ? all.filter(s => s.id === options.sessionId) : []
  const sessions = picked.length > 0 ? picked : all
  const crew = options.forCrew
  const prices = pricesShown('schedule', options)
  const one = sessions.length === 1 ? sessions[0] : null
  const sub = one
    ? `${docDayLong(one.date)} · ${sessionTimeText(one)}`
    : sessions.length > 1
      ? `${sessions.length} คิว · ${eventRangeText(b)}`
      : 'ยังไม่ได้กำหนดคิวงาน'
  const c = b.customer
  return (
    <>
      <DocHeader
        settings={settings}
        logoSrc={assets.logoSrc}
        title={crew ? 'ตารางคิวงาน (ทีมงาน)' : 'ตารางคิววันงาน'}
        meta={<DocMeta booking={b} issuedOn={issuedOn} />}
      />
      <CoupleHero kicker={crew ? 'คิวงานของ' : 'กำหนดการวันสำคัญของ'} couple={b.couple_names} sub={sub} />
      {(b.status === 'cancelled' || b.status === 'postponed') && <StatusBanner booking={b} />}

      {crew && (
        <div className="wdoc-sec wdoc-keep">
          <SectionTitle>ข้อมูลติดต่อและงานที่ต้องถ่าย</SectionTitle>
          <div className="wdoc-grid2">
            <div className="wdoc-kv"><span>ลูกค้า</span><span>{c.name || '-'}{c.partner_name ? ` & ${c.partner_name}` : ''}</span></div>
            <div className="wdoc-kv"><span>โทร</span><span>{c.phone ? formatPhone(c.phone) : '-'}{c.line_id ? ` · LINE ${c.line_id}` : ''}</span></div>
            <div className="wdoc-kv"><span>แพ็กเกจ</span><span>{b.package.name || 'แพ็กเกจกำหนดเอง'}{b.package.hours > 0 ? ` · ${b.package.hours} ชม.` : ''}</span></div>
            <div className="wdoc-kv"><span>เลขที่งาน</span><span>{b.booking_no}</span></div>
          </div>
          <Coordinator booking={b} />
          {b.mood_link && <div className="wdoc-kv"><span>มู้ดบอร์ด</span><span>{shortUrl(b.mood_link, 70)}</span></div>}
          {(b.deliverables.length > 0 || b.deliverables_plan.length > 0) && (
            <div style={{ marginTop: '0.35em' }}>
              <DeliverablesList booking={b} />
            </div>
          )}
        </div>
      )}

      <SessionsBlock sessions={sessions} variant={crew ? 'crew' : 'couple'} title="กำหนดการ" />

      {!crew && (b.coordinator_name || b.coordinator_phone) && (
        <div className="wdoc-sec wdoc-keep">
          <SectionTitle>ผู้ประสานงาน</SectionTitle>
          <Coordinator booking={b} />
        </div>
      )}
      {crew && <NoteBlock title="ความต้องการของลูกค้า" text={b.customer_note} />}
      {crew && <NoteBlock title="หมายเหตุภายใน" text={b.note} />}
      {!crew && prices && <DueReminder booking={b} />}
      {!crew && <NoteBlock text={settings.booking_note} />}
      {crew ? (
        <DocFooter assets={{ ...assets, portalUrl: null, portalQr: null }} extra={<p><b>เอกสารภายในสำหรับทีมงาน</b> — มีข้อมูลติดต่อลูกค้า ห้ามส่งต่อนอกทีม</p>} />
      ) : (
        <DocFooter assets={assets} />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// สรุปการส่งงาน
// ---------------------------------------------------------------------------
function DeliveryDoc({ booking: b, settings, options, assets, issuedOn }: WedDocProps) {
  const prices = pricesShown('delivery', options)
  const list = b.deliverables
  const delivered = list.filter(d => d.status === 'delivered').length
  return (
    <>
      <DocHeader settings={settings} logoSrc={assets.logoSrc} title="สรุปการส่งงาน" meta={<DocMeta booking={b} issuedOn={issuedOn} />} />
      <CoupleHero
        kicker="ส่งมอบผลงานให้"
        couple={b.couple_names}
        sub={list.length > 0 ? `ส่งแล้ว ${delivered} จาก ${list.length} รายการ · วันงาน ${eventRangeText(b)}` : `วันงาน ${eventRangeText(b)}`}
      />

      {list.length > 0 ? (
        <div className="wdoc-sec">
          <SectionTitle aside={`${delivered}/${list.length} รายการ`}>รายการผลงาน</SectionTitle>
          <div className="wdoc-sessions">
            {list.map(d => (
              <div key={d.id} className="wdoc-box wdoc-keep">
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.6em' }}>
                  <p className="wdoc-stitle" style={{ minWidth: 0 }}>
                    {d.name}
                    {d.qty > 1 || d.unit ? <span style={{ fontWeight: 500 }}> · {d.qty}{d.unit ? ` ${d.unit}` : ''}</span> : null}
                  </p>
                  <span className={deliverableTone(d.status, d.overdue)} style={{ flex: 'none' }}>
                    {deliverableStatusText(d.status, d.overdue)}
                  </span>
                </div>
                <p className="wdoc-sline">
                  {d.status === 'delivered'
                    ? `ส่งแล้วเมื่อ ${formatThaiDate(d.delivered_at)}`
                    : d.due_date ? `กำหนดส่งภายใน ${formatThaiDate(d.due_date)}` : 'รอกำหนดวันส่ง'}
                </p>
                {d.status === 'delivered' && d.link_url && (
                  <p className="wdoc-sline" style={{ wordBreak: 'break-all' }}>ลิงก์: <b>{shortUrl(d.link_url, 90)}</b></p>
                )}
                {d.note && <p className="wdoc-sline wdoc-pre">{d.note}</p>}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="wdoc-sec">
          <SectionTitle>รายการที่จะได้รับ</SectionTitle>
          {b.deliverables_plan.length > 0 ? <DeliverablesList booking={b} /> : <p className="wdoc-text">ยังไม่มีรายการผลงาน</p>}
          <p className="wdoc-small" style={{ marginTop: '0.35em' }}>ทีมงานจะแจ้งลิงก์ผลงานทันทีที่ส่งงานแต่ละรายการ</p>
        </div>
      )}

      {prices && <DueReminder booking={b} />}
      <NoteBlock text={settings.booking_note} />
      <DocFooter
        assets={assets}
        extra={assets.portalUrl && delivered > 0 ? <p>กดเปิดลิงก์ผลงานได้จากหน้าติดตามงาน (สแกน QR)</p> : undefined}
      />
    </>
  )
}
