// ===== ใบยืนยันการจอง (แบบฟอร์มกระดาษของร้าน b.oncloud) =====
// เรียงจากบนลงล่างตามฟอร์มจริงของร้าน: โลโก้กลางหน้า → ชื่อร้าน/ชื่อเอกสาร + เลขที่/วันที่/สถานะ → ชื่อผู้ติดต่อ
//   → ข้อมูลลูกค้า | วันงาน สถานที่ เวลา → กล่องรายการบริการที่จอง → เงื่อนไข (กล่องเขียว) | สรุปยอด → ช่องลงชื่อ 2 ฝั่ง
// ใช้ทั้ง mode 'image' (1080px) และ 'print' (A4) — ขนาดตัวอักษร = calc(var(--wdoc-u) * N) แบบเดียวกับ docKit (N = px บนรูป 1080)
// สีตายตัวชุดเดียวทุกร้าน (ดำ/เทา + เขียวสถานะ/เงื่อนไข/รับชำระ + แดงส่วนลด/ยอดคงเหลือ) — คอนทราสต์ตัวอักษร ≥ 4.5:1 บนพื้นขาว
// คลาส .wdoc-cf-* เป็นของเอกสารนี้อย่างเดียว ไม่แตะชิ้นส่วนร่วมใน docKit ที่เอกสารแบบอื่นใช้อยู่
import type { ReactNode } from 'react'
import { bangkokDateKey } from '@/lib/format'
import { formatPhone, sessionTimeText, type WedBooking, type WedSession, type WedSettings } from '@/lib/wedding'
import { StatusBanner, type DocAssets } from './docKit'
import { activeSessions, pricesShown, type DocOptions } from './docKinds'

const CF_CSS = `
.wdoc-cf { color: #1F2328; }
.wdoc-cf-keep { break-inside: avoid; page-break-inside: avoid; }
.wdoc-cf-logo { display: flex; justify-content: center; }
.wdoc-cf-logo span { display: inline-flex; align-items: center; justify-content: center; padding: calc(var(--wdoc-u) * 10) calc(var(--wdoc-u) * 20); background: #F7F7F5; border: 1px solid #E8E8E4; border-radius: calc(var(--wdoc-u) * 14); }
.wdoc-cf-logo img { display: block; width: auto; height: calc(var(--wdoc-u) * 92); max-width: calc(var(--wdoc-u) * 320); object-fit: contain; }
.wdoc-cf-rule { height: 0; margin: calc(var(--wdoc-u) * 24) 0; border-top: 1px solid #D9DCE0; }
.wdoc-cf-head { display: flex; align-items: flex-end; justify-content: space-between; gap: calc(var(--wdoc-u) * 28); }
.wdoc-cf-head > div:first-child { min-width: 0; flex: 1 1 auto; }
.wdoc-cf-shop { font-size: calc(var(--wdoc-u) * 17); font-weight: 600; line-height: 1.4; letter-spacing: 0.14em; text-transform: uppercase; color: #6B7280; }
.wdoc-cf-title { margin-top: calc(var(--wdoc-u) * 4); font-size: calc(var(--wdoc-u) * 52); font-weight: 700; line-height: 1.2; color: #111827; }
.wdoc-cf-meta { flex: none; max-width: 48%; text-align: right; }
.wdoc-cf-meta p { display: flex; align-items: baseline; justify-content: flex-end; gap: calc(var(--wdoc-u) * 14); font-size: calc(var(--wdoc-u) * 20); line-height: 1.6; }
.wdoc-cf-meta b { font-weight: 700; color: #111827; }
.wdoc-cf-lbl { font-size: calc(var(--wdoc-u) * 18); font-weight: 400; line-height: 1.5; color: #6B7280; }
.wdoc-cf-banner { margin-top: calc(var(--wdoc-u) * 18); }
.wdoc-cf-sec { margin-top: calc(var(--wdoc-u) * 26); }
.wdoc-cf-h { font-size: calc(var(--wdoc-u) * 23); font-weight: 700; line-height: 1.4; color: #111827; }
.wdoc-cf-sub { margin-top: calc(var(--wdoc-u) * 2); font-size: calc(var(--wdoc-u) * 21); line-height: 1.5; color: #6B7280; }
.wdoc-cf-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: calc(var(--wdoc-u) * 44); }
.wdoc-cf-col { display: flex; flex-direction: column; gap: calc(var(--wdoc-u) * 14); min-width: 0; }
.wdoc-cf-f { min-width: 0; }
.wdoc-cf-f .wdoc-cf-lbl { display: block; }
.wdoc-cf-v { font-size: calc(var(--wdoc-u) * 21); line-height: 1.45; color: #111827; }
.wdoc-cf-v.wdoc-cf-b { font-weight: 700; }
.wdoc-cf-vs { font-size: calc(var(--wdoc-u) * 18); line-height: 1.45; color: #6B7280; white-space: pre-line; }
.wdoc-cf-sess + .wdoc-cf-sess { margin-top: calc(var(--wdoc-u) * 8); }
.wdoc-cf-nowrap { white-space: nowrap; }
.wdoc-cf-box { margin-top: calc(var(--wdoc-u) * 12); padding: calc(var(--wdoc-u) * 18) calc(var(--wdoc-u) * 24); border: 1px solid #D5D9DE; border-radius: calc(var(--wdoc-u) * 12); background: #FFFFFF; }
.wdoc-cf-line { display: flex; align-items: baseline; justify-content: space-between; gap: calc(var(--wdoc-u) * 24); font-size: calc(var(--wdoc-u) * 21); line-height: 1.45; color: #111827; }
.wdoc-cf-line + .wdoc-cf-line { margin-top: calc(var(--wdoc-u) * 8); }
.wdoc-cf-line > span { min-width: 0; }
.wdoc-cf-line > b { flex: none; white-space: nowrap; font-weight: 700; color: #111827; }
.wdoc-cf-pkg { font-weight: 700; }
.wdoc-cf-qty { color: #6B7280; }
.wdoc-cf-desc { margin-top: calc(var(--wdoc-u) * 6); font-size: calc(var(--wdoc-u) * 19); line-height: 1.6; color: #4B5563; white-space: pre-line; }
.wdoc-cf-div { height: 0; margin: calc(var(--wdoc-u) * 14) 0; border-top: 1px solid #E3E6EA; }
.wdoc-cf-bottom { display: grid; grid-template-columns: 1fr 1fr; column-gap: calc(var(--wdoc-u) * 44); align-items: start; }
.wdoc-cf-bottom.wdoc-cf-one { grid-template-columns: 1fr; }
.wdoc-cf-terms { min-width: 0; padding: calc(var(--wdoc-u) * 16) calc(var(--wdoc-u) * 22); border: 1px solid #CDE5D5; border-radius: calc(var(--wdoc-u) * 12); background: #F1F8F3; }
.wdoc-cf-terms-h { margin-bottom: calc(var(--wdoc-u) * 6); font-size: calc(var(--wdoc-u) * 21); font-weight: 700; color: #1B6E3E; }
.wdoc-cf-terms p { font-size: calc(var(--wdoc-u) * 18); line-height: 1.6; color: #374151; }
.wdoc-cf-sum { min-width: 0; }
.wdoc-cf-row { display: flex; align-items: baseline; justify-content: space-between; gap: calc(var(--wdoc-u) * 20); padding: calc(var(--wdoc-u) * 4) 0; font-size: calc(var(--wdoc-u) * 20); line-height: 1.45; }
.wdoc-cf-row > span { min-width: 0; color: #4B5563; }
.wdoc-cf-row > b { flex: none; white-space: nowrap; font-weight: 700; color: #111827; }
.wdoc-cf-row small { display: block; font-size: calc(var(--wdoc-u) * 16); color: #6B7280; }
.wdoc-cf-sum-rule { height: 0; margin: calc(var(--wdoc-u) * 8) 0; border-top: 1px solid #D9DCE0; }
.wdoc-cf-net > span { font-weight: 700; color: #111827; }
.wdoc-cf-net > b { font-size: calc(var(--wdoc-u) * 38); line-height: 1.2; }
.wdoc-cf .wdoc-cf-ok { color: #1B6E3E; }
.wdoc-cf .wdoc-cf-bad { color: #B42318; }
.wdoc-cf .wdoc-cf-warn { color: #8A4B0B; }
.wdoc-cf-sign { display: grid; grid-template-columns: 1fr 1fr; column-gap: calc(var(--wdoc-u) * 72); padding-top: calc(var(--wdoc-u) * 76); text-align: center; }
.wdoc-print .wdoc-cf-sign { padding-top: calc(var(--wdoc-u) * 64); }
.wdoc-cf-sign > div { min-width: 0; padding-top: calc(var(--wdoc-u) * 10); border-top: 1px solid #9CA3AF; }
.wdoc-cf-sign-role { font-size: calc(var(--wdoc-u) * 20); font-weight: 700; line-height: 1.45; color: #111827; }
.wdoc-cf-sign-sub { margin-top: calc(var(--wdoc-u) * 2); font-size: calc(var(--wdoc-u) * 18); line-height: 1.45; color: #6B7280; }
`

// ---------------------------------------------------------------------------
// ตัวช่วยข้อความ (เฉพาะใบนี้ — เอกสารอื่นใช้ docMoney ทศนิยม 2 ตำแหน่งตามเดิม)
// ---------------------------------------------------------------------------
const moneyWhole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const moneyCents = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** เงินแบบฟอร์มร้าน: '฿5,900' (บาทเต็มไม่มี .00) · มีสตางค์ '฿5,900.50' · ติดลบ '-฿500' */
/** จำนวนในรายละเอียดแพ็กเกจ: 4 → "4", 4.5 → "4.5", 1500 → "1,500" */
function qtyText(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n)
}

export function cfMoney(n: number | null | undefined): string {
  const v = Number(n)
  if (!Number.isFinite(v)) return '฿0'
  const cents = Math.round(Math.abs(v) * 100)
  const t = cents % 100 === 0 ? moneyWhole.format(cents / 100) : moneyCents.format(cents / 100)
  return v < 0 && cents > 0 ? `-฿${t}` : `฿${t}`
}

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

/** day key 'YYYY-MM-DD' หรือเวลา ISO (คิดเป็นวันตามเวลาไทย) → ปี/เดือน/วัน ; ไม่ถูกต้อง → null */
function ymd(v: string | null | undefined): { y: number; m: number; d: number } | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const key = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : bangkokDateKey(s)
  const mm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '')
  if (!mm) return null
  const y = Number(mm[1])
  const m = Number(mm[2])
  const d = Number(mm[3])
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return { y, m, d }
}

/** '21 พ.ย. 2569' ; ไม่มีวัน → fallback */
function dayText(v: string | null | undefined, fallback = 'ยังไม่กำหนด'): string {
  const p = ymd(v)
  return p ? `${p.d} ${MONTHS[p.m - 1]} ${p.y + 543}` : fallback
}

/** '21 พ.ย.69' (ช่องลงชื่อ — แบบที่ร้านเขียนบนฟอร์ม) ; ไม่มีวัน → '' */
function dayTextShort(v: string | null | undefined): string {
  const p = ymd(v)
  return p ? `${p.d} ${MONTHS[p.m - 1]}${String(p.y + 543).slice(-2)}` : ''
}

/** ช่วงวันงาน: วันเดียว '22 พ.ย. 2569' · เดือนเดียวกัน '21–22 พ.ย. 2569' · ข้ามเดือน '30 พ.ย. – 1 ธ.ค. 2569' */
function dateRangeText(first: string | null, last: string | null): string {
  const a = ymd(first)
  const z = ymd(last)
  if (!a) return 'ยังไม่กำหนด'
  if (!z || (a.y === z.y && a.m === z.m && a.d === z.d)) return dayText(first)
  if (a.y === z.y && a.m === z.m) return `${a.d}–${z.d} ${MONTHS[a.m - 1]} ${a.y + 543}`
  if (a.y === z.y) return `${a.d} ${MONTHS[a.m - 1]} – ${z.d} ${MONTHS[z.m - 1]} ${a.y + 543}`
  return `${dayText(first)} – ${dayText(last)}`
}

// ชื่อบัญชีโซเชียล: กรอกเป็นลิงก์เต็ม → ตัด https:// / www. ให้สั้น (กดในรูปไม่ได้อยู่แล้ว)
function socialShort(v: string | null | undefined): string {
  const s = String(v ?? '').trim()
  if (!/^https?:\/\//i.test(s)) return s
  const t = s.replace(/^https?:\/\/(?:www\.|m\.)?/i, '').replace(/\/$/, '')
  return t.length > 48 ? `${t.slice(0, 47)}…` : t
}

/**
 * ช่องทางติดต่อลูกค้า ตามฟอร์มร้าน = ช่องโซเชียลที่มี (FB → LINE → IG)
 * เบอร์โทรเป็นช่องบังคับของลูกค้า (มีทุกคน) จึงไม่ใส่ซ้ำ — แสดงเบอร์เฉพาะลูกค้าที่ไม่มีช่องโซเชียลเลย จะได้ไม่ว่าง
 */
function contactChannels(b: WedBooking): string[] {
  const c = b.customer
  const social = [
    c.facebook?.trim() ? `FB: ${socialShort(c.facebook)}` : '',
    c.line_id?.trim() ? `LINE: ${c.line_id.trim()}` : '',
    c.instagram?.trim() ? `IG: ${socialShort(c.instagram)}` : '',
  ].filter(Boolean)
  if (social.length > 0) return social
  return [c.phone ? `โทร ${formatPhone(c.phone)}` : '', c.phone2 ? `โทร ${formatPhone(c.phone2)}` : ''].filter(Boolean)
}

/** เวลาแบบฟอร์มร้าน '08:00-12:00' (มีทั้งเริ่ม-จบ) ; แบบอื่นใช้ข้อความกลางของแอปตามเดิม */
function cfTime(s: WedSession): string {
  const t = sessionTimeText(s)
  return t.replace(/^(\d{1,2}:\d{2})–(\d{1,2}:\d{2}) น\.$/, '$1-$2')
}

/**
 * ผู้กดยืนยันงาน = ชื่อผู้ใช้ในประวัติ 'confirm' ครั้งแรก (logs เรียงใหม่ก่อน) ; วันที่ = confirmed_at ของงาน
 * ไม่มีประวัติ/ชื่อเป็น 'ระบบ' → ชื่อว่าง (ไม่เดาชื่อจากคนสร้างงาน)
 */
function confirmerOf(b: WedBooking): { name: string; date: string } {
  let log: WedBooking['logs'][number] | null = null
  for (const l of b.logs) if (l.action === 'confirm') log = l
  const raw = String(log?.actor_name ?? '').trim()
  return { name: raw && raw !== 'ระบบ' ? raw : '', date: dayTextShort(b.confirmed_at ?? log?.created_at ?? null) }
}

/** ข้อความ + สีของ "สถานะ" ที่หัวเอกสาร */
function statusOf(b: WedBooking): { text: string; tone: string } {
  const m = b.money
  if (b.status === 'cancelled') return { text: 'ยกเลิก', tone: 'wdoc-cf-bad' }
  if (b.status === 'postponed') return { text: b.status_label || 'เลื่อนงาน', tone: 'wdoc-cf-warn' }
  if (m.paid > 0.005 && m.due <= 0.005) return { text: 'ชำระครบแล้ว', tone: 'wdoc-cf-ok' }
  if (m.paid > 0.005 && m.deposit_met) return { text: 'มัดจำแล้ว', tone: 'wdoc-cf-ok' }
  if (b.status === 'inquiry' || b.status === 'hold') return { text: b.status_label, tone: 'wdoc-cf-warn' }
  return { text: b.status_label, tone: '' }
}

/** บรรทัดของข้อความหลายบรรทัด (ตามที่พิมพ์ไว้ — ตัดบรรทัดว่าง ไม่ใส่เลขข้อเพิ่ม) */
function textLines(v: string | null | undefined): string[] {
  return String(v ?? '').split(/\r?\n/).map(l => l.trim()).filter(l => l !== '')
}

/** หัวคิว: ประเภท · ชื่อคิว (ชื่อคิวซ้ำกับประเภท เช่น 'งานเลี้ยง' → ไม่ใส่ซ้ำ) */
function sessionHead(s: WedSession): string {
  const type = String(s.type_label ?? '').trim()
  const title = String(s.title ?? '').trim()
  const same = !!type && title.toLowerCase() === type.toLowerCase()
  return [type, same ? '' : title].filter(Boolean).join(' · ') || 'คิวงาน'
}

// ---------------------------------------------------------------------------
// ส่วนของเอกสาร
// ---------------------------------------------------------------------------
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="wdoc-cf-f">
      <span className="wdoc-cf-lbl">{label}</span>
      {children}
    </div>
  )
}

/** วันงาน / สถานที่ / เวลา — คิวเดียวแสดงตรงๆ ; หลายคิวแสดงช่วงวัน + รายการต่อคิว (ย่อ) */
function EventFields({ booking: b }: { booking: WedBooking }) {
  const list = activeSessions(b)
  if (list.length === 0) {
    return (
      <>
        <Field label="วันที่งาน"><p className="wdoc-cf-v">ยังไม่กำหนด</p></Field>
        <Field label="สถานที่"><p className="wdoc-cf-v">ยังไม่กำหนด</p></Field>
        <Field label="เวลาให้บริการ"><p className="wdoc-cf-v">ยังไม่กำหนด</p></Field>
      </>
    )
  }
  if (list.length === 1) {
    const s = list[0]
    return (
      <>
        <Field label="วันที่งาน"><p className="wdoc-cf-v">{dayText(s.date)}</p></Field>
        <Field label="สถานที่">
          <p className="wdoc-cf-v">{s.venue_name || 'ยังไม่ระบุ'}</p>
          {s.venue_address && <p className="wdoc-cf-vs">{s.venue_address}</p>}
        </Field>
        <Field label="เวลาให้บริการ"><p className="wdoc-cf-v">{cfTime(s)}</p></Field>
      </>
    )
  }
  const dated = list.filter(s => !!s.date)
  return (
    <>
      <Field label="วันที่งาน">
        <p className="wdoc-cf-v">
          {dated.length > 0 ? dateRangeText(dated[0].date, dated[dated.length - 1].date) : 'ยังไม่กำหนด'}
          {` (${list.length} คิว)`}
        </p>
      </Field>
      <Field label="สถานที่ / เวลาให้บริการ">
        {list.map(s => (
          <div key={s.id} className="wdoc-cf-sess">
            {/* วันที่ไม่ตัดกลางคำ (ไม่ให้ปี พ.ศ. ตกบรรทัดเดี่ยว) */}
            <p className="wdoc-cf-v wdoc-cf-b">
              {sessionHead(s)} · <span className="wdoc-cf-nowrap">{dayText(s.date, 'ยังไม่กำหนดวัน')}</span>
            </p>
            <p className="wdoc-cf-v">{cfTime(s)} · {s.venue_name || 'ยังไม่ระบุสถานที่'}</p>
            {s.venue_address && <p className="wdoc-cf-vs">{s.venue_address}</p>}
          </div>
        ))}
      </Field>
    </>
  )
}

/** กล่องรายการบริการที่จอง: แพ็กเกจ + รายละเอียด | เส้นคั่น | บริการเสริม ค่าเดินทาง ค่าใช้จ่ายเพิ่ม */
function ServiceBox({ booking: b, prices }: { booking: WedBooking; prices: boolean }) {
  const m = b.money
  const p = b.package
  const desc = String(p.description ?? '').replace(/\s+$/, '').replace(/^\s*\n/, '')
  // แพ็กเกจไม่มีรายละเอียด → สร้างรายการจากข้อมูลที่มี (ชั่วโมงถ่าย + งานที่ส่งให้ลูกค้าพร้อมกำหนดส่ง) แบบเดียวกับฟอร์มร้าน
  //   (บอส 27/11/2569: เดิมขึ้นแค่ "ถ่ายทำ 4 ชั่วโมง" ดูไม่ครบ — รายละเอียดเต็มพิมพ์ได้ที่ ตั้งค่า → แพ็กเกจ → รายละเอียด)
  const autoLines = desc ? [] : [
    ...(p.hours > 0 ? [`-ถ่าย ${qtyText(p.hours)} ชม.`] : []),
    ...b.deliverables_plan.map(d =>
      `-${d.name}${d.qty > 0 ? ` ${qtyText(d.qty)}${d.unit ? ` ${d.unit}` : ''}` : ''}`
      + (d.due_days > 0 ? ` ส่งงานภายใน ${qtyText(d.due_days)} วัน` : '')),
  ]
  const charges = prices ? b.charges.filter(c => !c.voided_at) : []
  const travel = prices && m.travel_fee > 0.005
  const hasExtra = b.addons.length > 0 || travel || charges.length > 0
  return (
    <div className="wdoc-cf-box">
      <div className="wdoc-cf-line">
        <span className="wdoc-cf-pkg">{p.name || 'แพ็กเกจกำหนดเอง'}</span>
        {prices && <b>{cfMoney(m.package_price)}</b>}
      </div>
      {desc ? (
        <p className="wdoc-cf-desc">{desc}</p>
      ) : autoLines.length > 0 ? (
        <p className="wdoc-cf-desc">{autoLines.join('\n')}</p>
      ) : null}
      {hasExtra && <div className="wdoc-cf-div" />}
      {b.addons.map(a => (
        <div key={a.id || a.name} className="wdoc-cf-line">
          <span>
            {a.name}
            {/* จำนวนไม่ใช่ 1 (รวมเศษ เช่น 0.5) ต้องแสดงเสมอ — ไม่งั้นดูเหมือนเต็มหน่วยตอนซ่อนราคา */}
            {Math.abs(a.qty - 1) > 0.001 ? <span className="wdoc-cf-qty">{` × ${a.qty}${a.unit ? ` ${a.unit}` : ''}`}</span> : null}
          </span>
          {prices && <b>{cfMoney(a.amount)}</b>}
        </div>
      ))}
      {travel && (
        <div className="wdoc-cf-line">
          <span>ค่าเดินทาง</span>
          <b>{cfMoney(m.travel_fee)}</b>
        </div>
      )}
      {charges.map(c => (
        <div key={c.id} className="wdoc-cf-line">
          <span>{c.description || 'ค่าใช้จ่ายเพิ่มเติม'}</span>
          <b>{cfMoney(c.amount)}</b>
        </div>
      ))}
    </div>
  )
}

/** สรุปยอด: Subtotal − ส่วนลดปิดดีล = ราคารวมสุทธิ · รับชำระแล้ว · ยอดคงเหลือ (ป้าย "Subtotal" ตามฟอร์มกระดาษของร้าน) */
function Totals({ booking: b }: { booking: WedBooking }) {
  const m = b.money
  const cancelled = b.status === 'cancelled'
  const over = m.due < -0.005
  return (
    <div className="wdoc-cf-sum">
      <div className="wdoc-cf-row">
        <span>Subtotal</span>
        <b>{cfMoney(m.pre_discount_total + m.charges_total)}</b>
      </div>
      {/* แสดงทุกครั้งเหมือนฟอร์มกระดาษของร้าน (ไม่มีส่วนลด = ฿0 สีแดงตามฟอร์ม) */}
      <div className="wdoc-cf-row">
        <span>
          ส่วนลดปิดดีล
          {m.discount_note ? <small>{m.discount_note}</small> : null}
        </span>
        <b className="wdoc-cf-bad">{m.discount > 0.005 ? `-${cfMoney(m.discount)}` : cfMoney(0)}</b>
      </div>
      <div className="wdoc-cf-sum-rule" />
      <div className="wdoc-cf-row wdoc-cf-net">
        <span>ราคารวมสุทธิ</span>
        <b>{cfMoney(m.grand_total)}</b>
      </div>
      <div className="wdoc-cf-row">
        <span>รับชำระแล้ว</span>
        <b className="wdoc-cf-ok">{cfMoney(m.paid)}</b>
      </div>
      {cancelled ? (
        // งานยกเลิก: ไม่มีการเรียกเก็บอีก (ฐานข้อมูลยังเก็บยอดค้างเดิมไว้ — ห้ามแสดงเป็นยอดต้องชำระ)
        <div className="wdoc-cf-row">
          <span>ยอดคงเหลือ<small>งานยกเลิกแล้ว</small></span>
          <b>ไม่มียอดต้องชำระ</b>
        </div>
      ) : (
        <div className="wdoc-cf-row">
          <span>{over ? 'ชำระเกิน (ร้านคืนให้)' : 'ยอดคงเหลือ'}</span>
          <b className={m.due > 0.005 ? 'wdoc-cf-bad' : ''}>{cfMoney(Math.abs(m.due) < 0.005 ? 0 : Math.abs(m.due))}</b>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ใบยืนยันการจอง
// ---------------------------------------------------------------------------
export interface ConfirmationFormProps {
  booking: WedBooking
  settings: WedSettings
  options: DocOptions
  assets: DocAssets
  /** วันที่ออกเอกสาร (day key ตามเวลาไทย) */
  issuedOn: string
}

export function ConfirmationForm({ booking: b, settings, options, assets, issuedOn }: ConfirmationFormProps) {
  const prices = pricesShown('confirmation', options)
  const terms = options.showTerms ? textLines(settings.terms_text) : []
  const st = statusOf(b)
  const confirmer = confirmerOf(b)
  const channels = contactChannels(b)
  const c = b.customer
  const couple = b.couple_names || [c.name, c.partner_name].filter(Boolean).join(' / ')
  const showBottom = prices || terms.length > 0
  const blank = '....................'
  return (
    <div className="wdoc-cf">
      <style dangerouslySetInnerHTML={{ __html: CF_CSS }} />

      {/* 1) โลโก้กลางหน้า + เส้นคั่น (ไม่มีโลโก้ = ไม่มีกล่อง) */}
      {assets.logoSrc && (
        <>
          <div className="wdoc-cf-logo">
            <span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assets.logoSrc} alt="" />
            </span>
          </div>
          <div className="wdoc-cf-rule" />
        </>
      )}

      {/* 2) ชื่อร้าน + ชื่อเอกสาร | เลขที่ วันที่ออกเอกสาร สถานะ */}
      <div className="wdoc-cf-head wdoc-cf-keep">
        <div>
          <p className="wdoc-cf-shop">{settings.shop_name}</p>
          <p className="wdoc-cf-title">ใบยืนยันการจอง</p>
        </div>
        <div className="wdoc-cf-meta">
          <p><span className="wdoc-cf-lbl">เลขที่</span><b>{b.booking_no || '-'}</b></p>
          <p><span className="wdoc-cf-lbl">วันที่ออกเอกสาร</span><b>{dayText(issuedOn, '-')}</b></p>
          <p><span className="wdoc-cf-lbl">สถานะ</span><b className={st.tone}>{st.text}</b></p>
        </div>
      </div>
      {(b.status === 'cancelled' || b.status === 'postponed') && (
        <div className="wdoc-cf-banner"><StatusBanner booking={b} /></div>
      )}

      {/* 3) ชื่อผู้ติดต่อ */}
      <div className="wdoc-cf-sec wdoc-cf-keep">
        <p className="wdoc-cf-h">ชื่อผู้ติดต่อ</p>
        <p className="wdoc-cf-sub">{c.name || '-'}</p>
        {(b.coordinator_name || b.coordinator_phone) && (
          <p className="wdoc-cf-vs">
            ผู้ประสานงาน {b.coordinator_name || '-'}
            {b.coordinator_phone ? ` · โทร ${formatPhone(b.coordinator_phone)}` : ''}
          </p>
        )}
      </div>
      <div className="wdoc-cf-rule" />

      {/* 4) ลูกค้า | วันงาน */}
      <div className="wdoc-cf-grid wdoc-cf-keep">
        <div className="wdoc-cf-col">
          <Field label="ลูกค้า"><p className="wdoc-cf-v wdoc-cf-b">{c.name || '-'}</p></Field>
          <Field label="เจ้าบ่าว / เจ้าสาว"><p className="wdoc-cf-v wdoc-cf-b">{couple || '-'}</p></Field>
          <Field label="ช่องทางติดต่อ">
            {channels.length > 0 ? channels.map(t => <p key={t} className="wdoc-cf-v">{t}</p>) : <p className="wdoc-cf-v">-</p>}
          </Field>
        </div>
        <div className="wdoc-cf-col">
          <EventFields booking={b} />
        </div>
      </div>
      <div className="wdoc-cf-rule" />

      {/* 5) รายการบริการที่จอง */}
      <div className="wdoc-cf-keep">
        <p className="wdoc-cf-h">รายการบริการที่จอง</p>
        <ServiceBox booking={b} prices={prices} />
      </div>

      {/* 6) + 7) อยู่ก้อนเดียวกันตอนพิมพ์ A4: รายละเอียดแพ็กเกจยาวจนล้นหน้า → ยกเงื่อนไข/ยอดเงิน/ช่องลงชื่อไปหน้า 2 พร้อมกัน
          (ไม่ให้หน้า 2 มีแต่เส้นลงชื่อลอยๆ และลายเซ็นอยู่หน้าเดียวกับยอดเงินที่ยืนยัน) */}
      <div className="wdoc-cf-keep">
        {/* 6) เงื่อนไข | สรุปยอด */}
        {showBottom && (
          <>
            <div className="wdoc-cf-rule" />
            <div className={`wdoc-cf-bottom${prices ? '' : ' wdoc-cf-one'}`}>
              {terms.length > 0 ? (
                <div className="wdoc-cf-terms">
                  <p className="wdoc-cf-terms-h">เงื่อนไข</p>
                  {terms.map((t, i) => <p key={i}>{t}</p>)}
                </div>
              ) : (
                <div />
              )}
              {prices && <Totals booking={b} />}
            </div>
          </>
        )}

        {/* 7) ช่องลงชื่อ: ผู้ยืนยันการจอง (ร้าน) | ลูกค้า */}
        <div className="wdoc-cf-rule" style={{ marginBottom: 0 }} />
        <div className="wdoc-cf-sign">
          <div>
            <p className="wdoc-cf-sign-role">ชื่อผู้ยืนยันการจอง</p>
            <p className="wdoc-cf-sign-sub">{confirmer.name || blank} / {confirmer.date || blank}</p>
          </div>
          <div>
            <p className="wdoc-cf-sign-role">ลูกค้า</p>
            <p className="wdoc-cf-sign-sub">ลูกค้า / วันที่</p>
          </div>
        </div>
      </div>
    </div>
  )
}
