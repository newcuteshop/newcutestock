'use client'
// ===== ชำระเงินในหน้าติดตามงาน: ยอดที่ต้องชำระตอนนี้ (งวดถัดไป) + QR พร้อมเพย์ระบุยอด + บัญชีธนาคาร =====
// - ยอด = งวดถัดไปที่ยังค้าง (next_due) แต่ไม่เกินยอดค้างทั้งงาน (amountDueNow — กติกาเดียวกับใบแจ้งชำระเงิน)
// - "บันทึกรูป QR": วาดรูปใหม่บนพื้นขาว (ชื่อร้าน + QR + ยอด + เลขที่งาน) ไว้เปิดสแกนจากแอปธนาคาร
//   เบราว์เซอร์ในแอป LINE ดาวน์โหลดไม่ได้ → บอกให้กดค้างที่รูป QR แล้วบันทึกแทน
// - ไม่มีช่องส่งสลิป (ร้านนี้รับสลิปทาง LINE) → ปุ่มแชท LINE ของร้าน
import { useState } from 'react'
import { Download, Info, Landmark, MessageCircle, QrCode, Wallet } from 'lucide-react'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht, formatThaiDate } from '@/lib/format'
import { cssColor } from '@/lib/shopTheme'
import { formatPromptPayId, isValidPromptPayId, parsePromptPayId, promptPayPayload } from '@/lib/promptpay'
import { amountDueNow, type WedPublicBooking } from '@/lib/wedding'
import QrImage from '@/components/rental/QrImage'
import CopyButton from '@/components/book/CopyButton'
import { lineHref } from '@/components/book/links'
import { downloadBlob, isInAppBrowser, safeFileName } from '@/lib/exportImage'

function digitsOnly(s: string): string {
  const d = s.replace(/\D/g, '')
  return d || s
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('load'))
    img.src = src
  })
}

// วาดข้อความกลางภาพ ย่อขนาดตัวอักษรลงจนพอดีความกว้าง
function centerText(ctx: CanvasRenderingContext2D, text: string, y: number, size: number, weight: number, family: string, maxWidth: number) {
  let s = size
  ctx.font = `${weight} ${s}px ${family}`
  while (s > 14 && ctx.measureText(text).width > maxWidth) {
    s -= 2
    ctx.font = `${weight} ${s}px ${family}`
  }
  ctx.fillText(text, ctx.canvas.width / 2, y)
}

/** รูป QR สำหรับบันทึก (PNG Blob) */
async function composeQrImage(qrUrl: string, lines: { shop: string; amount: string; target: string; bookingNo: string; label: string }): Promise<Blob> {
  const qr = await loadImage(qrUrl)
  const W = 720
  const H = 1040
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  try {
    // ใช้ฟอนต์เดียวกับหน้าเว็บ (ภาษาไทยไม่เป็นสี่เหลี่ยม)
    if (document.fonts?.ready) await document.fonts.ready
    const family = getComputedStyle(document.body).fontFamily || 'sans-serif'
    // สีจากตัวแปร CSS ของร้าน (ทองแชมเปญ) — fallback = ค่าของธีม #13
    const ink = cssColor('--c-ink', '#24211C')
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, W, H)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = ink
    centerText(ctx, lines.shop, 84, 40, 600, family, W - 80)
    ctx.fillStyle = cssColor('--c-gray-500', '#625C54')
    centerText(ctx, 'สแกนจ่ายด้วยแอปธนาคาร (พร้อมเพย์)', 134, 28, 400, family, W - 80)
    ctx.drawImage(qr, 110, 170, 500, 500)
    ctx.fillStyle = ink
    centerText(ctx, lines.amount, 752, 56, 700, family, W - 80)
    ctx.fillStyle = cssColor('--c-gray-700', '#423D36')
    centerText(ctx, lines.label, 806, 28, 400, family, W - 80)
    centerText(ctx, lines.target, 852, 28, 400, family, W - 80)
    centerText(ctx, `เลขที่งาน ${lines.bookingNo}`, 898, 28, 400, family, W - 80)
    ctx.fillStyle = cssColor('--c-gray-400', '#6E675C')
    centerText(ctx, 'โอนแล้วกรุณาส่งสลิปให้ร้านทาง LINE', 966, 24, 400, family, W - 80)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(b => resolve(b), 'image/png'))
    if (!blob) throw new Error('blob')
    return blob
  } finally {
    // คืนหน่วยความจำ canvas (iPhone มีเพดานรวม)
    canvas.width = 0
    canvas.height = 0
  }
}

export default function PortalPayPanel({ booking: b }: { booking: WedPublicBooking }) {
  const amount = amountDueNow(b)
  const nd = b.next_due
  const pi = b.payment_info
  const ppId = pi.promptpay_id && isValidPromptPayId(pi.promptpay_id) ? pi.promptpay_id : null
  const payload = ppId && amount > 0 ? promptPayPayload(ppId, amount) : ''
  const target = ppId ? `พร้อมเพย์ ${formatPromptPayId(ppId)}${pi.promptpay_name ? ` · ${pi.promptpay_name}` : ''}` : ''
  const hasBank = pi.bank_accounts.length > 0
  const line = lineHref(b.shop.line_url, b.shop.line_id)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  if (amount <= 0) return null
  const label = nd?.label ? nd.label : 'ยอดคงเหลือ'

  async function saveQr() {
    if (!qrUrl || saving) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const blob = await composeQrImage(qrUrl, {
        shop: b.shop.name,
        amount: baht(amount),
        target,
        bookingNo: b.booking_no,
        label: nd?.due_date ? `${label} · ชำระภายใน ${formatThaiDate(nd.due_date)}` : label,
      })
      const ok = downloadBlob(blob, safeFileName(`qr-${b.booking_no}`))
      setSaveMsg(
        ok && !isInAppBrowser()
          ? 'บันทึกรูป QR แล้ว — เปิดแอปธนาคาร เลือกสแกนจากรูปภาพ'
          : 'ถ้าไม่พบรูปในเครื่อง (เช่น เปิดจากแอป LINE) ให้กดค้างที่รูป QR แล้วเลือก "บันทึกรูปภาพ" แทน',
      )
    } catch {
      setSaveMsg('บันทึกรูปจากปุ่มไม่ได้ในเบราว์เซอร์นี้ — กดค้างที่รูป QR แล้วเลือก "บันทึกรูปภาพ" แทน')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card space-y-5 p-4 sm:p-5" aria-labelledby="wp-pay-title">
      <h2 id="wp-pay-title" className="section-title">
        <Wallet {...ICON_SM} />
        ชำระเงิน
      </h2>

      <div className="panel space-y-1 p-4">
        <p className="text-sm font-semibold text-brand-800">ยอดที่ต้องชำระตอนนี้ · {label}</p>
        <p className="money text-3xl text-gray-900">{baht(amount)}</p>
        {nd?.due_date && (
          <p className={nd.overdue ? 'text-sm font-semibold text-red-700' : 'text-sm text-gray-700'}>
            {nd.overdue ? 'เลยกำหนดชำระตั้งแต่' : 'กรุณาชำระภายใน'} {formatThaiDate(nd.due_date)}
          </p>
        )}
        {b.money.due > amount + 0.005 && (
          <p className="text-xs text-gray-600">ยอดคงเหลือทั้งงาน {baht(b.money.due)} — แบ่งชำระตามงวดด้านล่าง</p>
        )}
      </div>

      {payload ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-gray-200 p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <QrCode {...ICON_XS} />
            สแกนจ่ายด้วยแอปธนาคาร
          </p>
          <QrImage text={payload} size={220} label={`ยอด ${baht(amount)}`} onDataUrl={setQrUrl} />
          <div className="w-full space-y-1 text-center text-sm text-gray-700">
            <p className="break-words">
              พร้อมเพย์ <span className="font-semibold tabular-nums">{formatPromptPayId(ppId as string)}</span>
            </p>
            {pi.promptpay_name && <p className="break-words">ชื่อบัญชี {pi.promptpay_name}</p>}
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className="btn-secondary" onClick={() => void saveQr()} disabled={!qrUrl || saving}>
              <Download {...ICON_SM} />
              บันทึกรูป QR
            </button>
            <CopyButton
              text={parsePromptPayId(ppId as string)?.display ?? (ppId as string)}
              label="คัดลอกเลขพร้อมเพย์"
              ariaLabel={`คัดลอกเลขพร้อมเพย์ ${formatPromptPayId(ppId as string)}`}
            />
          </div>
          <p className="text-center text-xs text-gray-500" aria-live="polite">
            {saveMsg ?? 'แอปธนาคารจะกรอกยอดให้อัตโนมัติ ตรวจชื่อบัญชีก่อนยืนยันการโอน'}
          </p>
        </div>
      ) : !hasBank ? (
        <div className="alert-warn">
          <Info {...ICON_SM} />
          <p className="min-w-0">ร้านยังไม่ได้แจ้งช่องทางรับโอนในระบบ กรุณาติดต่อร้านเพื่อสอบถามวิธีชำระเงิน</p>
        </div>
      ) : null}

      {hasBank && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <Landmark {...ICON_XS} />
            {payload ? 'หรือโอนเข้าบัญชีธนาคาร' : 'โอนเข้าบัญชีธนาคาร'}
          </p>
          <ul className="space-y-2">
            {pi.bank_accounts.map((acc, i) => (
              <li key={`${acc.bank}-${acc.account_no}-${i}`} className="panel flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-gray-900">{acc.bank || 'บัญชีธนาคาร'}</p>
                  <p className="break-all text-lg font-semibold tabular-nums tracking-wide text-gray-900">{acc.account_no}</p>
                  {acc.account_name && <p className="break-words text-sm text-gray-600">ชื่อบัญชี {acc.account_name}</p>}
                </div>
                {acc.account_no && (
                  <CopyButton
                    text={digitsOnly(acc.account_no)}
                    label="คัดลอกเลขบัญชี"
                    ariaLabel={`คัดลอกเลขบัญชี ${acc.bank} ${acc.account_no}`}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2 border-t border-gray-200 pt-4">
        <p className="text-sm text-gray-700">
          โอนแล้วกรุณาส่งสลิปให้ร้านทาง LINE พร้อมแจ้งเลขที่งาน <span className="font-semibold text-gray-900">{b.booking_no}</span>
        </p>
        {line && (
          <a href={line} rel="noreferrer" referrerPolicy="no-referrer" className="btn-secondary w-full sm:w-auto">
            <MessageCircle {...ICON_SM} />
            ส่งสลิปทาง LINE{b.shop.line_id ? ` ${b.shop.line_id}` : ''}
          </a>
        )}
      </div>
    </section>
  )
}
