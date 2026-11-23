// ===== ชิ้นส่วนร่วมของเอกสารร้าน b.oncloud ที่ส่งเป็นรูป (ใบยืนยัน / ใบเสนอราคา / ใบแจ้งชำระ / ใบเสร็จ / ตารางคิว / สรุปส่งงาน) =====
// เอกสารชุดเดียววาดได้ 2 แบบจากโค้ดเดียวกัน:
//   mode 'image' = กว้าง 1080 CSS px (ขนาดมาตรฐานรูปที่ส่งทาง LINE) ตัวอักษรฐาน 28px — แปลงเป็น PNG ด้วย lib/exportImage
//   mode 'print' = กว้างเต็มกระดาษ A4 (ไม่เกิน 186 มม.) ตัวอักษรฐาน 16px (เนื้อหา ~11-12px เท่าเอกสาร A4 ร้านเช่า) — พิมพ์ผ่าน components/pos/PrintPortal (paper 'a4')
//   ขนาดตัวอักษร = calc(var(--wdoc-u) * N) โดย N = px บนรูป 1080 (เลขเต็มเสมอ) · --wdoc-u = 1px (รูป) / 16px÷28 (A4) → สองแบบสัดส่วนเดียวกัน
//     ทำไมไม่ใช้ em ตรงๆ: html-to-image ปัดขนาดตัวอักษรของสำเนาลงเป็น floor(px) − 0.1 แต่คงความสูงกล่องเดิม — ขนาดเศษ
//     (เช่น 16.8px → 15.9px) ทำให้บรรทัดในรูปสั้นกว่าบนจอ = ช่องว่างแปลกๆ ระหว่างข้อ · lib/exportImage ปิดการปัดนี้แล้ว
//     (holdExactFontSize) แต่เลขเต็มยังคมกว่าและปลอดภัยถ้าวันหนึ่งต้องปิดตัวแก้นั้น
//   ระยะห่าง/ความกว้างอื่นยังเป็น em ได้ (ไม่ถูกปัด)
// สี: ทองแชมเปญจากตัวแปร CSS ของร้าน (กล่องนอกสุดใส่ data-shop="wedding" เสมอ — ป็อปอัป/กล่องพิมพ์ที่อยู่นอก layout ก็ได้สีถูก)
//   สีสถานะ (เขียว/อำพัน/แดง) เป็นค่าตายตัวชุดเดียวกับป้ายใน app/globals.css · คอนทราสต์ตัวอักษร ≥ 4.5:1 ทุกคู่
// ไม่มีเงา ไม่มีไล่สี (ธีมทางการ) · ไม่มี hook — วาดจากข้อมูลที่ส่งมาอย่างเดียว (ใช้ได้ทั้ง server และ client)
// สไตล์อยู่ในแท็ก <style> ของเอกสารเอง (คลาส .wdoc-* ไม่ชนกับคลาสอื่นของแอป) — html-to-image คัดลอกสไตล์ที่คำนวณแล้วไปกับรูป
import { forwardRef, type ReactNode } from 'react'
import { formatThaiDate, formatThaiDateTime } from '@/lib/format'
import { formatPromptPayId, isValidPromptPayId } from '@/lib/promptpay'
import {
  INSTALLMENT_STATUS_LABELS, amountDueNow, crewDisplayName, crewRoleLabel, formatPhone, sessionTimeText, callTimeText,
  deliverableStatusLabel, termsLines, wedDepositPercentOfAmount,
  type WedBankAccount, type WedBooking, type WedDeliverableStatus, type WedInstallmentStatus, type WedSession,
  type WedSettings,
} from '@/lib/wedding'

export type DocMode = 'image' | 'print'

/** รูปและลิงก์ที่เตรียมไว้ก่อนวาด (data URL ทั้งหมด — รูปไม่หายตอนแปลงเป็น PNG/พิมพ์) */
export interface DocAssets {
  /** โลโก้ร้าน (data URL) — null = ใช้สัญลักษณ์ก้อนเมฆแทน */
  logoSrc: string | null
  /** ลิงก์เต็มหน้าติดตามงานของคู่บ่าวสาว — null = ร้านปิดลิงก์ / ยังไม่มีโทเคน */
  portalUrl: string | null
  portalQr: string | null
  /** QR พร้อมเพย์ของยอดที่ต้องชำระตอนนี้ — null = ไม่มีพร้อมเพย์/ไม่มียอด */
  payQr: string | null
}

const DOC_CSS = `
.wdoc { box-sizing: border-box; background: #FFFFFF; color: rgb(var(--c-ink)); font-family: inherit; line-height: 1.5; text-align: left; overflow-wrap: anywhere; word-break: break-word; font-variant-numeric: tabular-nums; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.wdoc *, .wdoc *::before, .wdoc *::after { box-sizing: border-box; }
.wdoc p, .wdoc h1, .wdoc h2, .wdoc h3, .wdoc ul, .wdoc ol, .wdoc figure { margin: 0; }
.wdoc-img { --wdoc-u: 1px; width: 1080px; font-size: 28px; padding: 56px 60px 52px; }
.wdoc-print { --wdoc-u: calc(16px / 28); width: 100%; max-width: 186mm; margin: 0 auto; font-size: 16px; padding: 0; }
.wdoc-keep { break-inside: avoid; page-break-inside: avoid; }
.wdoc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.9em; padding-bottom: 0.7em; border-bottom: 0.12em solid rgb(var(--c-brand-400)); }
.wdoc-brand { display: flex; align-items: center; gap: 0.6em; min-width: 0; flex: 1 1 auto; }
.wdoc-logo { flex: none; display: block; width: 2.9em; height: 2.9em; border-radius: 0.55em; object-fit: contain; background: #FFFFFF; border: 1px solid rgb(var(--c-gray-200)); }
.wdoc-mark { flex: none; display: block; width: 2.9em; height: 2.9em; border-radius: 22%; background: rgb(var(--c-brand-400)); color: rgb(var(--c-brand-900)); overflow: hidden; }
.wdoc-mark svg { display: block; width: 100%; height: 100%; }
.wdoc-shop { font-size: calc(var(--wdoc-u) * 31); font-weight: 700; line-height: 1.25; color: rgb(var(--c-gray-900)); }
.wdoc-tagline { font-size: calc(var(--wdoc-u) * 20); line-height: 1.35; color: rgb(var(--c-gray-600)); }
.wdoc-contact { font-size: calc(var(--wdoc-u) * 18); line-height: 1.45; color: rgb(var(--c-gray-600)); margin-top: 0.1em; }
.wdoc-docbox { flex: none; max-width: 44%; text-align: right; }
.wdoc-title { font-size: calc(var(--wdoc-u) * 31); font-weight: 700; line-height: 1.25; color: rgb(var(--c-brand-800)); }
.wdoc-meta { font-size: calc(var(--wdoc-u) * 18); line-height: 1.5; color: rgb(var(--c-gray-600)); }
.wdoc-meta b { font-weight: 600; color: rgb(var(--c-gray-900)); }
.wdoc-hero { margin-top: 0.9em; padding: 0.75em 0.9em 0.8em; text-align: center; background: rgb(var(--c-brand-50)); border: 1px solid rgb(var(--c-brand-200)); border-radius: 0.55em; }
.wdoc-kicker { font-size: calc(var(--wdoc-u) * 18); font-weight: 600; letter-spacing: 0.03em; color: rgb(var(--c-brand-700)); }
.wdoc-couple { margin-top: 0.05em; font-size: calc(var(--wdoc-u) * 50); font-weight: 700; line-height: 1.25; color: rgb(var(--c-brand-900)); }
.wdoc-hero-sub { margin-top: 0.25em; font-size: calc(var(--wdoc-u) * 20); color: rgb(var(--c-gray-700)); }
.wdoc-banner { margin-top: 0.7em; padding: 0.35em 0.7em; text-align: center; font-size: calc(var(--wdoc-u) * 23); font-weight: 700; border-radius: 0.45em; border: 0.08em solid; }
.wdoc-banner-bad { color: #841E1E; background: #FFF1F1; border-color: #BF2B2B; }
.wdoc-banner-warn { color: #6E4010; background: #FEF6E7; border-color: #9C5B0F; }
.wdoc-sec { margin-top: 1em; }
.wdoc-h2 { display: flex; align-items: baseline; justify-content: space-between; gap: 0.6em; margin-bottom: 0.45em; padding-bottom: 0.22em; border-bottom: 1px solid rgb(var(--c-brand-200)); font-size: calc(var(--wdoc-u) * 24); font-weight: 700; color: rgb(var(--c-brand-800)); }
.wdoc-h2 small { font-size: calc(var(--wdoc-u) * 19); font-weight: 500; color: rgb(var(--c-gray-600)); }
.wdoc-text { font-size: calc(var(--wdoc-u) * 21); color: rgb(var(--c-gray-800)); }
.wdoc-small { font-size: calc(var(--wdoc-u) * 18); color: rgb(var(--c-gray-600)); }
.wdoc-pre { white-space: pre-line; }
.wdoc-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.2em 1.2em; }
.wdoc-kv { display: flex; gap: 0.5em; min-width: 0; font-size: calc(var(--wdoc-u) * 20); line-height: 1.5; }
.wdoc-kv > span:first-child { flex: none; min-width: 5.4em; color: rgb(var(--c-gray-600)); }
.wdoc-kv > span:last-child { min-width: 0; font-weight: 600; color: rgb(var(--c-gray-900)); }
.wdoc-sessions { display: flex; flex-direction: column; gap: 0.5em; }
.wdoc-session { display: flex; gap: 0.7em; padding: 0.55em 0.7em; border: 1px solid rgb(var(--c-gray-200)); border-radius: 0.5em; background: #FFFFFF; break-inside: avoid; page-break-inside: avoid; }
.wdoc-date { flex: none; align-self: flex-start; width: 3.5em; padding: 0.3em 0.15em; text-align: center; line-height: 1.15; border-radius: 0.4em; background: rgb(var(--c-brand-100)); color: rgb(var(--c-brand-900)); }
.wdoc-date-d { display: block; font-size: calc(var(--wdoc-u) * 36); font-weight: 700; }
.wdoc-date-m { display: block; font-size: calc(var(--wdoc-u) * 17); font-weight: 600; }
.wdoc-date-w { display: block; font-size: calc(var(--wdoc-u) * 15); color: rgb(var(--c-brand-800)); }
.wdoc-date-none { display: block; font-size: calc(var(--wdoc-u) * 17); font-weight: 600; padding: 0.6em 0; }
.wdoc-sbody { min-width: 0; flex: 1 1 auto; }
.wdoc-stitle { font-size: calc(var(--wdoc-u) * 22); font-weight: 700; line-height: 1.35; color: rgb(var(--c-gray-900)); }
.wdoc-sline { font-size: calc(var(--wdoc-u) * 19); line-height: 1.5; color: rgb(var(--c-gray-700)); }
.wdoc-sline b { font-weight: 600; color: rgb(var(--c-gray-900)); }
.wdoc-call { display: inline-block; margin-top: 0.15em; padding: 0.05em 0.55em; border-radius: 0.3em; font-size: calc(var(--wdoc-u) * 20); font-weight: 700; color: rgb(var(--c-brand-900)); background: rgb(var(--c-brand-100)); border: 1px solid rgb(var(--c-brand-500)); }
.wdoc-st { display: inline-block; padding: 0 0.55em; border: 1px solid; border-radius: 999px; font-size: calc(var(--wdoc-u) * 16); font-weight: 600; line-height: 1.5; white-space: nowrap; vertical-align: 0.05em; }
.wdoc-st-ok { color: #1C5236; background: #DCF1E3; border-color: #2A7D50; }
.wdoc-st-warn { color: #6E4010; background: #FDEBCD; border-color: #9C5B0F; }
.wdoc-st-bad { color: #841E1E; background: #FFE1E1; border-color: #BF2B2B; }
.wdoc-st-plain { color: rgb(var(--c-gray-700)); background: rgb(var(--c-gray-100)); border-color: rgb(var(--c-gray-300)); }
.wdoc-st-brand { color: rgb(var(--c-brand-900)); background: rgb(var(--c-brand-100)); border-color: rgb(var(--c-brand-500)); }
.wdoc-rows { font-size: calc(var(--wdoc-u) * 21); }
.wdoc-row { display: flex; align-items: baseline; justify-content: space-between; gap: 1em; padding: 0.22em 0; }
.wdoc-row + .wdoc-row { border-top: 1px dashed rgb(var(--c-gray-200)); }
.wdoc-row > span:first-child { min-width: 0; color: rgb(var(--c-gray-700)); }
.wdoc-row > span:last-child { flex: none; text-align: right; white-space: nowrap; font-weight: 600; color: rgb(var(--c-gray-900)); }
.wdoc-row-sub { display: block; font-size: calc(var(--wdoc-u) * 17); color: rgb(var(--c-gray-500)); }
.wdoc-row.wdoc-total { margin-top: 0.15em; padding-top: 0.35em; border-top: 0.09em solid rgb(var(--c-gray-800)); font-size: calc(var(--wdoc-u) * 24); }
.wdoc-row.wdoc-total > span { font-weight: 700; color: rgb(var(--c-gray-900)); }
.wdoc-row.wdoc-strong > span { font-weight: 700; color: rgb(var(--c-gray-900)); }
.wdoc-row.wdoc-minus > span:last-child { color: #A12222; }
.wdoc-table { width: 100%; border-collapse: collapse; font-size: calc(var(--wdoc-u) * 19); }
.wdoc-table th { padding: 0.35em 0.5em; text-align: left; font-weight: 600; color: rgb(var(--c-gray-700)); background: rgb(var(--c-gray-100)); border-bottom: 1px solid rgb(var(--c-gray-300)); }
.wdoc-table td { padding: 0.38em 0.5em; vertical-align: top; color: rgb(var(--c-gray-800)); border-bottom: 1px solid rgb(var(--c-gray-200)); }
.wdoc-table .num { text-align: right; white-space: nowrap; }
.wdoc-table .nowrap { white-space: nowrap; }
.wdoc-table .center { text-align: center; }
.wdoc-table tr { break-inside: avoid; page-break-inside: avoid; }
.wdoc-table tfoot td { font-weight: 700; color: rgb(var(--c-gray-900)); border-bottom: 0; border-top: 0.09em solid rgb(var(--c-gray-800)); }
.wdoc-list { padding-left: 1.25em; list-style: disc outside; font-size: calc(var(--wdoc-u) * 20); line-height: 1.5; color: rgb(var(--c-gray-800)); }
.wdoc-list li + li { margin-top: 0.1em; }
.wdoc-list b { font-weight: 600; color: rgb(var(--c-gray-900)); }
.wdoc-terms { padding-left: 1.6em; list-style: decimal outside; font-size: calc(var(--wdoc-u) * 17); line-height: 1.5; color: rgb(var(--c-gray-700)); }
.wdoc-terms li { white-space: pre-line; }
.wdoc-terms li + li { margin-top: 0.1em; }
.wdoc-note { padding: 0.5em 0.75em; border-left: 0.18em solid rgb(var(--c-brand-500)); border-radius: 0 0.35em 0.35em 0; background: rgb(var(--c-gray-50)); font-size: calc(var(--wdoc-u) * 19); line-height: 1.5; white-space: pre-line; color: rgb(var(--c-gray-800)); }
.wdoc-box { padding: 0.6em 0.75em; border: 1px solid rgb(var(--c-gray-200)); border-radius: 0.5em; background: #FFFFFF; }
.wdoc-pay { display: flex; align-items: center; gap: 1em; padding: 0.8em 0.9em; border: 0.08em solid rgb(var(--c-brand-500)); border-radius: 0.6em; background: rgb(var(--c-brand-50)); }
.wdoc-pay-main { min-width: 0; flex: 1 1 auto; }
.wdoc-pay-label { font-size: calc(var(--wdoc-u) * 20); font-weight: 600; color: rgb(var(--c-brand-800)); }
.wdoc-pay-amount { font-size: calc(var(--wdoc-u) * 58); font-weight: 700; line-height: 1.15; white-space: nowrap; color: rgb(var(--c-gray-900)); }
.wdoc-pay-sub { font-size: calc(var(--wdoc-u) * 19); line-height: 1.5; color: rgb(var(--c-gray-700)); }
.wdoc-pay-sub b { font-weight: 600; color: rgb(var(--c-gray-900)); }
.wdoc-qr { flex: none; text-align: center; }
.wdoc-qr img { display: block; width: 8em; height: 8em; margin: 0 auto; background: #FFFFFF; border: 1px solid rgb(var(--c-gray-200)); border-radius: 0.3em; }
.wdoc-qr-lg img { width: 10.5em; height: 10.5em; }
.wdoc-qr span { display: block; margin-top: 0.25em; font-size: calc(var(--wdoc-u) * 16); line-height: 1.35; color: rgb(var(--c-gray-600)); }
.wdoc-banks { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5em; }
.wdoc-bank { min-width: 0; padding: 0.45em 0.65em; border: 1px solid rgb(var(--c-gray-200)); border-radius: 0.45em; background: #FFFFFF; }
.wdoc-bank-name { font-size: calc(var(--wdoc-u) * 18); font-weight: 600; color: rgb(var(--c-gray-600)); }
.wdoc-bank-no { font-size: calc(var(--wdoc-u) * 26); font-weight: 700; letter-spacing: 0.02em; color: rgb(var(--c-gray-900)); }
.wdoc-bank-acc { font-size: calc(var(--wdoc-u) * 18); color: rgb(var(--c-gray-700)); }
.wdoc-crewlist { display: flex; flex-wrap: wrap; gap: 0.3em; margin-top: 0.3em; }
.wdoc-crew { display: inline-flex; align-items: center; gap: 0.35em; padding: 0.06em 0.6em 0.06em 0.35em; border: 1px solid rgb(var(--c-gray-200)); border-radius: 999px; background: #FFFFFF; font-size: calc(var(--wdoc-u) * 18); color: rgb(var(--c-gray-800)); }
.wdoc-crew i { display: inline-block; width: 0.8em; height: 0.8em; border-radius: 999px; }
.wdoc-crew b { font-weight: 600; color: rgb(var(--c-gray-900)); }
.wdoc-foot { display: flex; align-items: center; justify-content: space-between; gap: 0.9em; margin-top: 1.2em; padding-top: 0.7em; border-top: 1px solid rgb(var(--c-gray-200)); }
.wdoc-foot-text { min-width: 0; flex: 1 1 auto; font-size: calc(var(--wdoc-u) * 17); line-height: 1.5; color: rgb(var(--c-gray-600)); }
.wdoc-foot-text b { font-weight: 600; color: rgb(var(--c-gray-800)); }
.wdoc-foot-url { color: rgb(var(--c-brand-700)); word-break: break-all; }
.wdoc-foot .wdoc-qr img { width: 4.6em; height: 4.6em; }
.wdoc-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5em; margin-top: 1.6em; text-align: center; font-size: calc(var(--wdoc-u) * 19); color: rgb(var(--c-gray-800)); break-inside: avoid; page-break-inside: avoid; }
.wdoc-sign-line { height: 2.2em; margin: 0 0.6em 0.3em; border-bottom: 1px dotted rgb(var(--c-gray-700)); }
`

/** สไตล์ของเอกสาร — วางเป็นลูกตัวแรกของกล่อง .wdoc */
export function WedDocStyle() {
  return <style dangerouslySetInnerHTML={{ __html: DOC_CSS }} />
}

/** สไตล์กระดาษ A4 ตอนพิมพ์ (ใส่เฉพาะในกล่อง PrintPortal — ประกาศทีหลังจึงชนะขอบ 4 มม. ของใบเสร็จใน globals.css) */
export function WedA4PageStyle() {
  return <style dangerouslySetInnerHTML={{ __html: '@page { size: A4; margin: 10mm 12mm 11mm; }' }} />
}

/** กล่องนอกสุดของเอกสาร (ธีมทองแชมเปญ + สไตล์) — ref = กล่องที่ส่งให้ renderNodeToPng */
export const WedDocFrame = forwardRef<HTMLDivElement, { mode: DocMode; label?: string; children: ReactNode }>(
  function WedDocFrame({ mode, label, children }, ref) {
    return (
      <div
        ref={ref}
        data-shop="wedding"
        className={mode === 'image' ? 'wdoc wdoc-img' : 'wdoc wdoc-print'}
        role={label ? 'document' : undefined}
        aria-label={label}
      >
        <WedDocStyle />
        {children}
      </div>
    )
  },
)

// ---------------------------------------------------------------------------
// ตัวช่วยข้อความ
// ---------------------------------------------------------------------------
const moneyFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** เงินบนเอกสาร: '฿12,500.00' (ทศนิยม 2 ตำแหน่งเสมอแบบใบเสร็จ) ; ติดลบ '-฿50.00' */
export function docMoney(n: number | null | undefined): string {
  const v = Number(n)
  if (!Number.isFinite(v)) return '฿0.00'
  const t = moneyFormatter.format(Math.abs(v))
  return v < 0 && t !== '0.00' ? `-฿${t}` : `฿${t}`
}

const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const THAI_WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']

function dayParts(day: string | null | undefined): { d: number; m: number; y: number; w: number } | null {
  const mm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? '').trim())
  if (!mm) return null
  const y = Number(mm[1])
  const m = Number(mm[2])
  const d = Number(mm[3])
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return { d, m, y, w: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
}

/** 'วันเสาร์ที่ 12 ธ.ค. 2569' ; ไม่มีวัน → 'ยังไม่กำหนดวัน' */
export function docDayLong(day: string | null | undefined): string {
  const p = dayParts(day)
  if (!p) return 'ยังไม่กำหนดวัน'
  return `วัน${THAI_WEEKDAYS[p.w]}ที่ ${p.d} ${THAI_MONTHS_SHORT[p.m - 1]} ${p.y + 543}`
}

/** ลิงก์แบบสั้นสำหรับพิมพ์บนรูป (กดในรูปไม่ได้ — ตัด https:// และย่อเหลือ ~56 ตัวอักษร) */
export function shortUrl(url: string | null | undefined, max = 56): string {
  const s = String(url ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '')
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

// ชื่อบัญชีโซเชียลบนรูป: ร้านกรอกเป็นลิงก์เต็ม → ตัด https:// / www. ให้สั้น (กดในรูปไม่ได้อยู่แล้ว) ; กรอกเป็นชื่อบัญชี → ตามนั้น
function socialText(v: string | null | undefined): string {
  const s = String(v ?? '').trim()
  if (!/^https?:\/\//i.test(s)) return s
  return shortUrl(s.replace(/^https?:\/\/(?:www\.|m\.)?/i, ''), 40)
}

/** ช่องทางติดต่อร้านในบรรทัดเดียว (ป้ายกับค่าคั่นด้วยช่องว่างไม่ตัดบรรทัด — "IG" ไม่หลุดไปอยู่คนละบรรทัดกับชื่อบัญชี) */
export function shopContactLine(s: WedSettings): string {
  const nb = '\u00A0'
  return [
    s.phone ? `โทร${nb}${formatPhone(s.phone)}` : '',
    s.line_id ? `LINE${nb}${s.line_id}` : '',
    s.instagram ? `IG${nb}${socialText(s.instagram)}` : '',
    s.facebook ? `FB${nb}${socialText(s.facebook)}` : '',
    s.tiktok ? `TikTok${nb}${socialText(s.tiktok)}` : '',
  ].filter(Boolean).join(' · ')
}

// ---------------------------------------------------------------------------
// หัวเอกสาร / ชื่อคู่บ่าวสาว / ท้ายเอกสาร
// ---------------------------------------------------------------------------
/** สัญลักษณ์ก้อนเมฆ (แทนโลโก้เมื่อร้านยังไม่อัปโหลด) — เส้นเดียวกับ components/theme/WeddingMark */
export function CloudMark() {
  return (
    <span className="wdoc-mark" aria-hidden="true">
      <svg viewBox="0 0 64 64" focusable="false">
        <path
          d="M19 45H46.5C51.2 45 55 41.4 55 36.8C55 32.4 51.6 28.9 47.3 28.6C46.2 22.2 40.6 17.5 34 17.5C27.8 17.5 22.6 21.6 21.1 27.4C15.4 27.8 11 32.3 11 37.4C11 41.6 14.6 45 19 45Z"
          fill="none"
          stroke="currentColor"
          strokeWidth={3.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

export function DocHeader({
  settings,
  logoSrc,
  title,
  meta,
  showAddress = false,
}: {
  settings: WedSettings
  logoSrc: string | null
  title: string
  meta: ReactNode
  showAddress?: boolean
}) {
  const contact = shopContactLine(settings)
  return (
    <div className="wdoc-head">
      <div className="wdoc-brand">
        {logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="wdoc-logo" src={logoSrc} alt="" />
        ) : (
          <CloudMark />
        )}
        <div style={{ minWidth: 0 }}>
          <p className="wdoc-shop">{settings.shop_name}</p>
          {settings.tagline && <p className="wdoc-tagline">{settings.tagline}</p>}
          {contact && <p className="wdoc-contact">{contact}</p>}
          {showAddress && settings.address && <p className="wdoc-contact wdoc-pre">{settings.address}</p>}
        </div>
      </div>
      <div className="wdoc-docbox">
        <p className="wdoc-title">{title}</p>
        <div className="wdoc-meta">{meta}</div>
      </div>
    </div>
  )
}

/** กล่องชื่อคู่บ่าวสาว (ตัวใหญ่) */
export function CoupleHero({ kicker, couple, sub, children }: { kicker?: string; couple: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="wdoc-hero wdoc-keep">
      {kicker && <p className="wdoc-kicker">{kicker}</p>}
      <p className="wdoc-couple">{couple || '-'}</p>
      {sub && <p className="wdoc-hero-sub">{sub}</p>}
      {children}
    </div>
  )
}

/** ป้ายสถานะงานที่ต้องเตือน (ยกเลิก / เลื่อน / ยังไม่ยืนยัน) — null = ไม่ต้องมีป้าย */
export function StatusBanner({ booking: b }: { booking: WedBooking }) {
  if (b.status === 'cancelled') {
    return <div className="wdoc-banner wdoc-banner-bad">งานนี้ยกเลิกแล้ว{b.cancel_reason ? ` — ${b.cancel_reason}` : ''}</div>
  }
  if (b.status === 'postponed') {
    return <div className="wdoc-banner wdoc-banner-warn">เลื่อนงาน — รอกำหนดวันใหม่{b.postpone_reason ? ` (${b.postpone_reason})` : ''}</div>
  }
  if (b.status === 'inquiry') {
    return <div className="wdoc-banner wdoc-banner-warn">สถานะ: สอบถาม — ยังไม่ได้ล็อกคิว</div>
  }
  if (b.status === 'hold') {
    return (
      <div className="wdoc-banner wdoc-banner-warn">
        ล็อกคิวรอมัดจำ{b.hold_until ? ` ถึง ${formatThaiDateTime(b.hold_until)} น.` : ''} — ชำระมัดจำเพื่อยืนยันคิว
      </div>
    )
  }
  return null
}

/** หัวข้อของแต่ละส่วน */
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <h2 className="wdoc-h2">
      <span>{children}</span>
      {aside ? <small>{aside}</small> : null}
    </h2>
  )
}

/** ท้ายเอกสาร: ลิงก์ติดตามงาน + QR ของลิงก์ + ข้อความท้าย */
export function DocFooter({ assets, extra }: { assets: DocAssets; extra?: ReactNode }) {
  const hasPortal = !!assets.portalUrl
  if (!hasPortal && !extra) return null
  return (
    <div className="wdoc-foot wdoc-keep">
      <div className="wdoc-foot-text">
        {extra}
        {hasPortal && (
          <p>
            <b>ติดตามงาน ตารางคิว ยอดชำระ และลิงก์ส่งงานได้ที่</b>
            <br />
            <span className="wdoc-foot-url">{assets.portalUrl}</span>
          </p>
        )}
      </div>
      {hasPortal && assets.portalQr && (
        <div className="wdoc-qr">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assets.portalQr} alt="คิวอาร์โค้ดหน้าติดตามงาน" />
          <span>สแกนดูงาน</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// คิวงาน
// ---------------------------------------------------------------------------
function DateBox({ day }: { day: string | null }) {
  const p = dayParts(day)
  if (!p) {
    return (
      <div className="wdoc-date">
        <span className="wdoc-date-none">ยังไม่กำหนดวัน</span>
      </div>
    )
  }
  return (
    <div className="wdoc-date">
      <span className="wdoc-date-w">{THAI_WEEKDAYS[p.w]}</span>
      <span className="wdoc-date-d">{p.d}</span>
      <span className="wdoc-date-m">{THAI_MONTHS_SHORT[p.m - 1]} {p.y + 543}</span>
    </div>
  )
}

export type SessionVariant = 'brief' | 'couple' | 'crew'

/**
 * การ์ดคิวงาน
 *   brief  = วัน เวลา ประเภท สถานที่ + ลิงก์แผนที่ (ใบเสนอราคา)
 *   couple = + ที่อยู่ กำหนดการ (ใบยืนยันการจอง / ตารางคิวสำหรับคู่บ่าวสาว)
 *   crew   = + เวลาทีมถึงงาน ผู้ติดต่อหน้างาน การแต่งกาย หมายเหตุ ทีมงาน (ตารางคิวสำหรับทีม — ไม่มีค่าจ้าง)
 */
export function SessionCard({ session: s, variant }: { session: WedSession; variant: SessionVariant }) {
  const head = [s.type_label, s.title].filter(Boolean).join(' · ')
  const detailed = variant !== 'brief'
  return (
    <div className="wdoc-session">
      <DateBox day={s.date} />
      <div className="wdoc-sbody">
        <p className="wdoc-stitle">
          {head || 'คิวงาน'}
          {s.status === 'done' && <span className="wdoc-st wdoc-st-ok" style={{ marginLeft: '0.5em' }}>ถ่ายแล้ว</span>}
        </p>
        <p className="wdoc-sline">
          <b>{sessionTimeText(s)}</b>
        </p>
        {variant === 'crew' && s.call_time && <p className="wdoc-call">{callTimeText(s.call_time)}</p>}
        {s.venue_name && (
          <p className="wdoc-sline">
            สถานที่ <b>{s.venue_name}</b>
          </p>
        )}
        {detailed && s.venue_address && <p className="wdoc-sline wdoc-pre">{s.venue_address}</p>}
        {s.map_url && <p className="wdoc-sline">แผนที่: {shortUrl(s.map_url)}</p>}
        {variant === 'crew' && s.venue_contact && <p className="wdoc-sline">ติดต่อหน้างาน: <b>{s.venue_contact}</b></p>}
        {variant === 'crew' && s.dress_code && <p className="wdoc-sline">การแต่งกาย/ธีมงาน: <b>{s.dress_code}</b></p>}
        {variant === 'crew' && s.notes && <p className="wdoc-sline wdoc-pre">หมายเหตุ: {s.notes}</p>}
        {variant === 'crew' && (
          s.crew.length > 0 ? (
            <div className="wdoc-crewlist">
              {s.crew.map(c => (
                <span key={c.crew_id} className="wdoc-crew">
                  <i style={{ background: c.color }} />
                  <b>{crewDisplayName(c)}</b>
                  <span>{crewRoleLabel(c.role)}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="wdoc-sline">ทีมงาน: ยังไม่ได้จัดทีม</p>
          )
        )}
        {detailed && s.run_sheet.length > 0 && <RunSheet rows={s.run_sheet} />}
      </div>
    </div>
  )
}

function RunSheet({ rows }: { rows: WedSession['run_sheet'] }) {
  return (
    <table className="wdoc-table" style={{ marginTop: '0.45em' }}>
      <thead>
        <tr>
          <th className="nowrap" style={{ width: '5.5em' }}>เวลา</th>
          <th>กำหนดการ / ฤกษ์</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="nowrap">{r.time ? `${r.time} น.` : '-'}</td>
            <td className="wdoc-pre">{r.text || '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function SessionsBlock({ sessions, variant, title = 'คิวงาน' }: { sessions: WedSession[]; variant: SessionVariant; title?: string }) {
  return (
    <div className="wdoc-sec">
      <SectionTitle aside={sessions.length > 1 ? `${sessions.length} คิว` : undefined}>{title}</SectionTitle>
      {sessions.length === 0 ? (
        <p className="wdoc-text">ยังไม่ได้กำหนดคิวงาน</p>
      ) : (
        <div className="wdoc-sessions">
          {sessions.map(s => <SessionCard key={s.id} session={s} variant={variant} />)}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// แพ็กเกจ / ชิ้นงาน / บริการเสริม
// ---------------------------------------------------------------------------
function dueDaysText(days: number): string {
  return days > 0 ? `ภายใน ${days} วันหลังวันงาน` : 'หลังวันงาน'
}

/** ชิ้นงานที่จะได้รับ: รายการส่งงานจริง (หลังยืนยัน) หรือแผนจากแพ็กเกจ */
export function DeliverablesList({ booking: b }: { booking: WedBooking }) {
  if (b.deliverables.length > 0) {
    return (
      <ul className="wdoc-list">
        {b.deliverables.map(d => (
          <li key={d.id}>
            <b>{d.name}</b>
            {d.qty > 1 || d.unit ? ` ${d.qty}${d.unit ? ` ${d.unit}` : ''}` : ''}
            {d.due_date ? ` — ส่งภายใน ${formatThaiDate(d.due_date)}` : ''}
          </li>
        ))}
      </ul>
    )
  }
  if (b.deliverables_plan.length > 0) {
    return (
      <ul className="wdoc-list">
        {b.deliverables_plan.map((d, i) => (
          <li key={`${d.name}-${i}`}>
            <b>{d.name}</b>
            {d.qty > 1 || d.unit ? ` ${d.qty}${d.unit ? ` ${d.unit}` : ''}` : ''} — {dueDaysText(d.due_days)}
          </li>
        ))}
      </ul>
    )
  }
  return null
}

/** แพ็กเกจ + บริการเสริม + ชิ้นงาน (ราคาแยกอยู่ในตารางเงิน) */
export function PackageBlock({ booking: b, showDescription = false }: { booking: WedBooking; showDescription?: boolean }) {
  const p = b.package
  const hasDeliverables = b.deliverables.length > 0 || b.deliverables_plan.length > 0
  return (
    <div className="wdoc-sec wdoc-keep">
      <SectionTitle>แพ็กเกจและสิ่งที่จะได้รับ</SectionTitle>
      <p className="wdoc-text">
        <b style={{ fontWeight: 700, color: 'rgb(var(--c-gray-900))' }}>{p.name || 'แพ็กเกจกำหนดเอง'}</b>
        {p.hours > 0 ? ` · ถ่ายทำ ${p.hours} ชั่วโมง` : ''}
      </p>
      {showDescription && p.description && <p className="wdoc-small wdoc-pre" style={{ marginTop: '0.2em' }}>{p.description}</p>}
      {hasDeliverables && (
        <div style={{ marginTop: '0.35em' }}>
          <DeliverablesList booking={b} />
        </div>
      )}
      {b.addons.length > 0 && (
        <div style={{ marginTop: '0.4em' }}>
          <p className="wdoc-small" style={{ fontWeight: 600 }}>บริการเสริม</p>
          <ul className="wdoc-list">
            {b.addons.map(a => (
              <li key={a.id || a.name}>
                {a.name}
                {/* จำนวนไม่ใช่ 1 (รวมเศษ เช่น 0.5 ครึ่งคิว) ต้องแสดงเสมอ — ไม่งั้นดูเหมือนเต็มหน่วยตอนซ่อนราคา */}
                {Math.abs(a.qty - 1) > 0.001 ? ` × ${a.qty}${a.unit ? ` ${a.unit}` : ''}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// เงิน
// ---------------------------------------------------------------------------
/**
 * ยอดที่ต้องชำระตอนนี้บนเอกสาร (ใบแจ้งชำระ / QR พร้อมเพย์ / ยอดค้างย่อ)
 * งานยกเลิกแล้ว = 0 เสมอ: ฐานข้อมูลยังเก็บยอดค้างเดิมไว้ (due) แต่ห้ามเรียกเก็บเงินงานที่ยกเลิก — มีแต่คืนเงิน
 */
export function docDueNow(b: WedBooking): number {
  return b.status === 'cancelled' ? 0 : amountDueNow(b)
}

/** รายละเอียดราคา: แพ็กเกจ + บริการเสริม + ค่าเดินทาง + ค่าใช้จ่ายเพิ่ม − ส่วนลด = ยอดสุทธิ */
export function PriceBreakdown({ booking: b, title = 'รายละเอียดราคา' }: { booking: WedBooking; title?: string }) {
  const m = b.money
  const charges = b.charges.filter(c => !c.voided_at)
  return (
    <div className="wdoc-sec wdoc-keep">
      <SectionTitle>{title}</SectionTitle>
      <table className="wdoc-table">
        <thead>
          <tr>
            <th>รายการ</th>
            <th className="num">จำนวน</th>
            <th className="num">ราคา/หน่วย</th>
            <th className="num">รวม</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              {b.package.name || 'แพ็กเกจกำหนดเอง'}
              {b.package.hours > 0 ? <span className="wdoc-row-sub">ถ่ายทำ {b.package.hours} ชั่วโมง</span> : null}
            </td>
            <td className="num">1</td>
            <td className="num">{docMoney(m.package_price)}</td>
            <td className="num">{docMoney(m.package_price)}</td>
          </tr>
          {b.addons.map(a => (
            <tr key={a.id || a.name}>
              <td>{a.name}</td>
              <td className="num">{a.qty}{a.unit ? ` ${a.unit}` : ''}</td>
              <td className="num">{docMoney(a.unit_price)}</td>
              <td className="num">{docMoney(a.amount)}</td>
            </tr>
          ))}
          {m.travel_fee > 0 && (
            <tr>
              <td>ค่าเดินทาง</td>
              <td className="num">1</td>
              <td className="num">{docMoney(m.travel_fee)}</td>
              <td className="num">{docMoney(m.travel_fee)}</td>
            </tr>
          )}
          {charges.map(c => (
            <tr key={c.id}>
              <td>{c.description || 'ค่าใช้จ่ายเพิ่มเติม'}</td>
              <td className="num">1</td>
              <td className="num">{docMoney(c.amount)}</td>
              <td className="num">{docMoney(c.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="wdoc-rows" style={{ marginTop: '0.35em', marginLeft: 'auto', width: '62%' }}>
        <div className="wdoc-row">
          <span>รวมก่อนส่วนลด</span>
          <span>{docMoney(m.pre_discount_total + m.charges_total)}</span>
        </div>
        {m.discount > 0 && (
          <div className="wdoc-row wdoc-minus">
            <span>ส่วนลด{m.discount_note ? ` (${m.discount_note})` : ''}</span>
            <span>-{docMoney(m.discount)}</span>
          </div>
        )}
        <div className="wdoc-row wdoc-total">
          <span>ยอดสุทธิ</span>
          <span>{docMoney(m.grand_total)}</span>
        </div>
      </div>
    </div>
  )
}

function installmentTone(s: WedInstallmentStatus, overdue: boolean): string {
  if (s === 'paid') return 'wdoc-st wdoc-st-ok'
  if (overdue) return 'wdoc-st wdoc-st-bad'
  if (s === 'partial' || s === 'due') return 'wdoc-st wdoc-st-warn'
  return 'wdoc-st wdoc-st-plain'
}

/** ตารางงวดชำระ (สถานะคิดจากยอดที่ชำระสะสม — จากฐานข้อมูล) */
export function InstallmentsTable({ booking: b }: { booking: WedBooking }) {
  if (b.installments.length === 0) return null
  return (
    <table className="wdoc-table" style={{ marginTop: '0.45em' }}>
      <thead>
        <tr>
          <th>งวด</th>
          <th className="nowrap">กำหนดชำระ</th>
          <th className="num">จำนวน</th>
          <th className="num">คงเหลือ</th>
          <th className="center">สถานะ</th>
        </tr>
      </thead>
      <tbody>
        {b.installments.map(i => (
          <tr key={i.id || i.seq}>
            <td>{i.label || `งวดที่ ${i.seq}`}</td>
            <td className="nowrap">{i.due_date ? formatThaiDate(i.due_date) : '-'}</td>
            <td className="num">{docMoney(i.amount)}</td>
            <td className="num">{docMoney(i.amount_remaining)}</td>
            <td className="center">
              <span className={installmentTone(i.status, i.overdue)}>{i.overdue ? 'เลยกำหนด' : INSTALLMENT_STATUS_LABELS[i.status]}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** สถานะการชำระ: ยอดสุทธิ ชำระแล้ว คงเหลือ มัดจำ + งวดชำระ */
export function PaymentStatusBlock({ booking: b, title = 'สถานะการชำระเงิน' }: { booking: WedBooking; title?: string }) {
  const m = b.money
  // มัดจำกำหนดเอง / ใช้มัดจำขั้นต่ำ / เต็มยอด = ไม่เขียน "(N%)"
  const depositPct = wedDepositPercentOfAmount(m)
  // งานยกเลิก: ไม่แสดงยอดค้าง/มัดจำ/งวด (ไม่มีการเรียกเก็บอีก) — แสดงยอดที่ชำระสุทธิหลังหักเงินคืน
  if (b.status === 'cancelled') {
    return (
      <div className="wdoc-sec wdoc-keep">
        <SectionTitle>{title}</SectionTitle>
        <CancelledMoneyRows booking={b} />
      </div>
    )
  }
  return (
    <div className="wdoc-sec wdoc-keep">
      <SectionTitle>{title}</SectionTitle>
      <div className="wdoc-rows">
        <div className="wdoc-row">
          <span>ยอดสุทธิ</span>
          <span>{docMoney(m.grand_total)}</span>
        </div>
        <div className="wdoc-row">
          <span>ชำระแล้ว</span>
          <span>{docMoney(m.paid)}</span>
        </div>
        <div className="wdoc-row wdoc-strong">
          <span>{m.due < -0.005 ? 'ชำระเกิน (ร้านคืนให้)' : 'คงเหลือต้องชำระ'}</span>
          <span>{docMoney(Math.abs(m.due))}</span>
        </div>
        {m.deposit_required > 0 && (
          <div className="wdoc-row">
            <span>
              มัดจำยืนยันคิว
              {depositPct !== null && depositPct > 0 ? ` (${depositPct}%)` : ''}
            </span>
            <span>
              {docMoney(m.deposit_required)}{' '}
              <span className={m.deposit_met ? 'wdoc-st wdoc-st-ok' : 'wdoc-st wdoc-st-warn'}>
                {m.deposit_met ? 'ชำระแล้ว' : `ขาด ${docMoney(m.deposit_due)}`}
              </span>
            </span>
          </div>
        )}
        {/* มีแผนงวด = ตารางงวดด้านล่างบอกวันครบกำหนดแล้ว (และ balance_due_date อาจไม่ตรงกับแผนที่แก้เอง) */}
        {m.due > 0.005 && b.installments.length === 0 && m.balance_due_date && (
          <div className="wdoc-row">
            <span>ชำระยอดคงเหลือภายใน</span>
            <span>{formatThaiDate(m.balance_due_date)}</span>
          </div>
        )}
      </div>
      <InstallmentsTable booking={b} />
    </div>
  )
}

/** ยอดเงินของงานที่ยกเลิกแล้ว: ยอดตามที่ตกลงไว้ + ชำระแล้วสุทธิ + "ไม่มียอดต้องชำระ" */
export function CancelledMoneyRows({ booking: b }: { booking: WedBooking }) {
  const m = b.money
  return (
    <div className="wdoc-rows">
      <div className="wdoc-row">
        <span>ยอดตามที่ตกลงไว้</span>
        <span>{docMoney(m.grand_total)}</span>
      </div>
      <div className="wdoc-row">
        <span>ชำระแล้วสุทธิ (หลังหักเงินคืน)</span>
        <span>{docMoney(m.paid)}</span>
      </div>
      <div className="wdoc-row wdoc-strong">
        <span>งานยกเลิกแล้ว</span>
        <span>ไม่มียอดต้องชำระ</span>
      </div>
    </div>
  )
}

/** รายการเงินที่ได้รับแล้ว (ไม่รวมที่ยกเลิก) */
export function PaymentsReceived({ booking: b }: { booking: WedBooking }) {
  const list = b.payments.filter(p => !p.voided_at)
  if (list.length === 0) return null
  return (
    <table className="wdoc-table" style={{ marginTop: '0.45em' }}>
      <thead>
        <tr>
          <th className="nowrap">วันที่</th>
          <th>เลขที่ใบเสร็จ</th>
          <th className="num">จำนวนเงิน</th>
        </tr>
      </thead>
      <tbody>
        {list.map(p => (
          <tr key={p.id}>
            <td className="nowrap">{formatThaiDate(p.paid_on ?? p.created_at)}</td>
            <td>{p.receipt_no ?? '-'}{p.kind === 'refund' ? ' (คืนเงิน)' : ''}</td>
            <td className="num">{p.kind === 'refund' ? '-' : ''}{docMoney(p.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** บัญชีธนาคารของร้าน */
export function BankList({ accounts }: { accounts: WedBankAccount[] }) {
  if (accounts.length === 0) return null
  return (
    <div className="wdoc-banks">
      {accounts.map((a, i) => (
        <div key={`${a.account_no}-${i}`} className="wdoc-bank">
          <p className="wdoc-bank-name">{a.bank || 'บัญชีธนาคาร'}</p>
          <p className="wdoc-bank-no">{a.account_no || '-'}</p>
          {a.account_name && <p className="wdoc-bank-acc">ชื่อบัญชี {a.account_name}</p>}
        </div>
      ))}
    </div>
  )
}

/** ช่องทางชำระเงินแบบย่อ (พร้อมเพย์ + บัญชีธนาคาร) — ใบเสนอราคา/ใบยืนยัน */
export function PaymentChannels({ settings }: { settings: WedSettings }) {
  const pp = settings.promptpay_id && isValidPromptPayId(settings.promptpay_id) ? settings.promptpay_id : null
  if (!pp && settings.bank_accounts.length === 0) return null
  return (
    <div className="wdoc-sec wdoc-keep">
      <SectionTitle>ช่องทางชำระเงิน</SectionTitle>
      {pp && (
        <p className="wdoc-text" style={{ marginBottom: '0.35em' }}>
          พร้อมเพย์ <b style={{ fontWeight: 700 }}>{formatPromptPayId(pp)}</b>
          {settings.promptpay_name ? ` · ${settings.promptpay_name}` : ''}
        </p>
      )}
      <BankList accounts={settings.bank_accounts} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// เงื่อนไข / หมายเหตุ
// ---------------------------------------------------------------------------
export function TermsBlock({ settings, title = 'เงื่อนไขการให้บริการ' }: { settings: WedSettings; title?: string }) {
  const lines = termsLines(settings.terms_text)
  if (lines.length === 0) return null
  return (
    <div className="wdoc-sec">
      <SectionTitle>{title}</SectionTitle>
      <ol className="wdoc-terms">
        {lines.map((t, i) => <li key={i}>{t}</li>)}
      </ol>
    </div>
  )
}

export function NoteBlock({ text, title }: { text: string | null | undefined; title?: string }) {
  const t = String(text ?? '').trim()
  if (!t) return null
  return (
    <div className="wdoc-sec wdoc-keep">
      {title && <SectionTitle>{title}</SectionTitle>}
      <p className="wdoc-note">{t}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// สถานะชิ้นงาน
// ---------------------------------------------------------------------------
export function deliverableTone(s: WedDeliverableStatus, overdue: boolean): string {
  if (s === 'delivered') return 'wdoc-st wdoc-st-ok'
  if (overdue) return 'wdoc-st wdoc-st-bad'
  if (s === 'review') return 'wdoc-st wdoc-st-brand'
  if (s === 'editing') return 'wdoc-st wdoc-st-warn'
  return 'wdoc-st wdoc-st-plain'
}

export function deliverableStatusText(s: WedDeliverableStatus, overdue: boolean): string {
  return s !== 'delivered' && overdue ? `${deliverableStatusLabel(s)} (เลยกำหนด)` : deliverableStatusLabel(s)
}
