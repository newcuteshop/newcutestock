// ===== ชิ้นส่วนร่วมของเอกสารพิมพ์ร้านเช่าชุด (สัญญาเช่า / ใบส่งมอบชุด / ใบสรุปการคืนชุด / ใบเสร็จ A4) =====
// พิมพ์ผ่าน components/pos/PrintPortal (paper 'a4' หรือ '80') — ไม่มี hook/สถานะ วาดจากข้อมูลที่ส่งมาอย่างเดียว
// กล่องนอกสุดใช้คลาส .receipt (globals.css บังคับตัวอักษรดำ ไม่มีพื้นหลัง/เงา — เครื่องพิมพ์ขาวดำอ่านชัด)
// สไตล์เฉพาะเอกสาร A4 อยู่ใน <A4Style/> (แท็ก <style> ที่อยู่ในกล่องพิมพ์ — มีอยู่เฉพาะตอนสั่งพิมพ์ ไม่กระทบหน้าจอ)
//   - @page A4 ขอบ 12 มม. (แทนขอบ 4 มม. ของใบเสร็จความร้อน) — ประกาศทีหลังจึงชนะกฎใน globals.css
// ชื่อร้าน/ที่อยู่/เบอร์อ่านจาก rental_settings เสมอ (ชื่อร้านจริงยังไม่ได้ตั้ง ห้าม hardcode)
import type { ReactNode } from 'react'
import { formatThaiDateTime } from '@/lib/format'
import type { RentalSettings } from '@/lib/rental'

const A4_CSS = `
@page { size: A4; margin: 10mm 12mm 11mm; }
.receipt.rdoc { width: 100%; max-width: 186mm; font-size: 11.5px; line-height: 1.45; }
.rdoc-page + .rdoc-page { break-before: page; page-break-before: always; }
.rdoc-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 8px; }
.rdoc-head-left { min-width: 0; flex: 1 1 auto; }
.rdoc-head-right { flex: none; display: flex; align-items: flex-start; gap: 8px; text-align: right; max-width: 100mm; }
.rdoc-shop { font-size: 17px; font-weight: 700; line-height: 1.3; }
.rdoc-title { font-size: 16px; font-weight: 700; line-height: 1.3; }
.rdoc-copy { display: inline-block; border: 1.5px solid #000; padding: 0 8px; font-weight: 700; margin-top: 3px; }
.rdoc-section { margin-top: 7px; }
.rdoc-keep { break-inside: avoid; page-break-inside: avoid; }
.rdoc-h2 { font-size: 12.5px; font-weight: 700; margin: 0 0 3px; }
.rdoc-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 18px; row-gap: 1px; }
.rdoc-kv { display: flex; gap: 6px; min-width: 0; }
.rdoc-kv > span:first-child { flex: none; min-width: 24mm; }
.rdoc-kv > span:last-child { min-width: 0; font-weight: 600; }
.rdoc-table { width: 100%; border-collapse: collapse; }
.rdoc-table th, .rdoc-table td { border: 1px solid #000; padding: 2px 5px; vertical-align: top; text-align: left; }
.rdoc-table th { font-weight: 700; }
.rdoc-table .num { text-align: right; white-space: nowrap; }
.rdoc-table .center { text-align: center; white-space: nowrap; }
.rdoc-table tr { break-inside: avoid; page-break-inside: avoid; }
.rdoc-sum { width: 64%; margin-left: auto; border-collapse: collapse; }
.rdoc-sum td { padding: 0 5px; }
.rdoc-sum td.rdoc-sum-head { text-align: left; font-weight: 700; }
.rdoc-sum td:last-child { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.rdoc-sum .total td { border-top: 1px solid #000; font-weight: 700; font-size: 13.5px; }
.rdoc-sum .strong td { font-weight: 700; }
.rdoc-terms { margin: 2px 0 0; padding-left: 20px; font-size: 10.5px; line-height: 1.4; list-style: decimal outside; }
.rdoc-terms li { margin: 0; white-space: pre-line; }
.rdoc-sign { display: grid; gap: 14px; margin-top: 18px; text-align: center; break-inside: avoid; page-break-inside: avoid; }
.rdoc-sign-2 { grid-template-columns: repeat(2, 1fr); }
.rdoc-sign-3 { grid-template-columns: repeat(3, 1fr); }
.rdoc-sign-line { border-bottom: 1px dotted #000; height: 24px; margin: 0 6px 3px; }
.rdoc-small { font-size: 10.5px; }
.rdoc-muted { font-size: 10.5px; }
.rdoc-foot { margin-top: 6px; font-size: 10px; text-align: right; }
.rdoc-box { border: 1px solid #000; padding: 4px 8px; }
.rdoc-check { display: inline-block; width: 11px; height: 11px; border: 1px solid #000; vertical-align: -1px; margin-right: 4px; }
.rdoc-banner { margin: 6px 0; padding: 3px 6px; border: 2px solid #000; text-align: center; font-size: 15px; font-weight: 700; }
.rdoc-qr { flex: none; display: flex; flex-direction: column; align-items: center; gap: 1px; font-size: 9px; text-align: center; }
.rdoc-qr img { width: 20mm; height: 20mm; display: block; }
`

/** สไตล์เอกสาร A4 — วางเป็นลูกตัวแรกของกล่อง .receipt.rdoc */
export function A4Style() {
  return <style dangerouslySetInnerHTML={{ __html: A4_CSS }} />
}

// ตัวเลขเงินบนเอกสาร: ทศนิยม 2 ตำแหน่งเสมอ มีคอมมา (แบบเดียวกับใบเสร็จ NEWCUTE) — หน้าจอใช้ baht() ตามเดิม
const amountFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function amount(n: number | null | undefined): string {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0.00'
  const text = amountFormatter.format(Math.abs(v))
  return v < 0 && text !== '0.00' ? `-${text}` : text
}

/** หัวเอกสาร: ข้อมูลร้าน (ซ้าย) + ชื่อเอกสาร/เลขที่ (ขวา) */
export function DocHeader({ settings, right }: { settings: RentalSettings; right: ReactNode }) {
  const contact = [
    settings.phone ? `โทร ${settings.phone}` : '',
    settings.line_id ? `LINE ${settings.line_id}` : '',
  ].filter(Boolean).join(' · ')
  return (
    <div className="rdoc-head">
      <div className="rdoc-head-left">
        <div className="rdoc-shop">{settings.shop_name}</div>
        {settings.tagline && <div className="rdoc-small">{settings.tagline}</div>}
        {settings.address && <div className="rdoc-small" style={{ whiteSpace: 'pre-line' }}>{settings.address}</div>}
        {contact && <div className="rdoc-small">{contact}</div>}
      </div>
      <div className="rdoc-head-right">{right}</div>
    </div>
  )
}

/** แถว ป้าย : ค่า */
export function KV({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rdoc-kv">
      <span>{label}</span>
      <span>{value === '' || value === null || value === undefined ? '-' : value}</span>
    </div>
  )
}

/** ช่องลงชื่อ (ผู้เช่า / ผู้ให้เช่า / พยาน …) พร้อมวันที่ */
export function SignatureBlock({ roles, names }: { roles: string[]; names?: (string | null | undefined)[] }) {
  return (
    <div className={roles.length >= 3 ? 'rdoc-sign rdoc-sign-3' : 'rdoc-sign rdoc-sign-2'}>
      {roles.map((role, i) => {
        const name = names?.[i]?.trim()
        return (
          <div key={role}>
            <div className="rdoc-sign-line" />
            <div>({name ? ` ${name} ` : ' ........................................ '})</div>
            <div style={{ fontWeight: 700 }}>{role}</div>
            <div className="rdoc-small">วันที่ ........ / ........ / ............</div>
          </div>
        )
      })}
    </div>
  )
}

/** บรรทัดท้ายเอกสาร: เวลาที่พิมพ์ */
export function PrintedAt({ extra }: { extra?: string }) {
  return (
    <div className="rdoc-foot">
      {extra ? `${extra} · ` : ''}พิมพ์ {formatThaiDateTime(new Date())}
    </div>
  )
}

/**
 * ข้อตกลงการเช่า (terms_text) → รายการข้อ
 * บรรทัดที่ขึ้นต้นด้วยเลขข้อ (1. / 1) / ๑.) ตัดเลขออก (วาดเป็นรายการเลขเรียงใหม่) ;
 * บรรทัดที่ขึ้นต้นด้วย - • * หรือย่อหน้า = ต่อท้ายข้อก่อนหน้า
 */
export function termsList(text: string | null | undefined): string[] {
  const out: string[] = []
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  for (const raw of lines) {
    if (raw.trim() === '') continue
    const continuation = /^(\s+|\s*[-•*]\s)/.test(raw) && out.length > 0
    const clean = raw.trim().replace(/^(?:\d+|[๐-๙]+)\s*[.)]\s*/, '')
    if (continuation) out[out.length - 1] = `${out[out.length - 1]}\n${clean}`
    else out.push(clean)
  }
  return out
}
