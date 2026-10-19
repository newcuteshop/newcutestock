'use client'
import { useEffect, useState } from 'react'
import { CheckCircle2, Download, Info, Landmark, QrCode, Upload, Wallet } from 'lucide-react'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht } from '@/lib/format'
import { round2 } from '@/lib/money'
import { formatPromptPayId, isValidPromptPayId, parsePromptPayId, promptPayPayload } from '@/lib/promptpay'
import type { PublicBooking } from '@/lib/rental'
import QrImage from '@/components/rental/QrImage'
import CopyButton from '@/components/book/CopyButton'
import SlipUpload from '@/components/book/SlipUpload'

// ชำระเงินออนไลน์ (หน้าสถานะการจอง — แสดงเมื่อ can_upload_slip):
// 1) เลือกยอด: มัดจำที่ยังขาด / ยอดค้างทั้งหมด (หักยอดสลิปที่รอตรวจออกก่อน — ลูกค้าไม่ต้องโอนซ้ำ)
// 2) QR พร้อมเพย์ระบุยอด (lib/promptpay) + ปุ่ม "บันทึกรูป QR" (รูปมีชื่อร้าน/ยอด/เลขที่การจอง ไว้เปิดสแกนจากแอปธนาคาร)
// 3) บัญชีธนาคารของร้าน + ปุ่มคัดลอกเลขบัญชี
// 4) ส่งสลิป (SlipUpload)
// เงินประกันชุดไม่อยู่ในยอดนี้ — ชำระที่ร้านวันรับชุด
// มัดจำครบแล้ว (รวมสลิปที่รอตรวจ) → บอกว่าขั้นมัดจำเสร็จแล้ว ยอดที่เหลือ "ไม่บังคับ" (จ่ายที่ร้านวันรับชุดได้)
// ซ่อน QR/บัญชีไว้จนลูกค้ากดเลือกโอนล่วงหน้าเอง และไม่เติมยอดในฟอร์มสลิป (กันลูกค้าโอนซ้ำโดยไม่จำเป็น)

type AmountOption = { key: 'deposit' | 'full'; label: string; amount: number }

function amountOptions(b: PublicBooking): AmountOption[] {
  const m = b.money
  const pending = m.pending_review_total
  const depositLeft = round2(Math.max(0, m.deposit_required - m.paid - pending))
  const dueLeft = round2(Math.max(0, m.due - pending))
  const out: AmountOption[] = []
  if (depositLeft > 0 && depositLeft < dueLeft - 0.005) out.push({ key: 'deposit', label: 'ชำระมัดจำ', amount: depositLeft })
  if (dueLeft > 0) out.push({ key: 'full', label: out.length > 0 ? 'ชำระเต็มจำนวน' : 'ยอดที่ต้องชำระ', amount: dueLeft })
  return out
}

/** มัดจำครบแล้ว (ชำระแล้ว + สลิปรอตรวจ) แต่ยังมียอดคงเหลือ */
function depositCovered(b: PublicBooking): boolean {
  const m = b.money
  if (m.deposit_required <= 0.005) return false
  const dueLeft = round2(Math.max(0, m.due - m.pending_review_total))
  return dueLeft > 0.005 && round2(m.deposit_required - m.paid - m.pending_review_total) <= 0.005
}

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

/** รูป QR สำหรับบันทึก: ชื่อร้าน + QR + ยอด + พร้อมเพย์ + เลขที่การจอง บนพื้นขาว (PNG data URL) */
async function composeQrImage(qrUrl: string, lines: { shop: string; amount: string; target: string; bookingNo: string }): Promise<string> {
  const qr = await loadImage(qrUrl)
  const W = 720
  const H = 1000
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  try {
    // ใช้ฟอนต์เดียวกับหน้าเว็บ (ภาษาไทยไม่เป็นสี่เหลี่ยม)
    if (document.fonts?.ready) await document.fonts.ready
    const family = getComputedStyle(document.body).fontFamily || 'sans-serif'
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, W, H)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#201B1D'
    centerText(ctx, lines.shop, 84, 40, 600, family, W - 80)
    ctx.fillStyle = '#675F62'
    centerText(ctx, 'สแกนจ่ายด้วยแอปธนาคาร (พร้อมเพย์)', 134, 28, 400, family, W - 80)
    ctx.drawImage(qr, 110, 170, 500, 500)
    ctx.fillStyle = '#201B1D'
    centerText(ctx, lines.amount, 750, 56, 700, family, W - 80)
    ctx.fillStyle = '#463E41'
    centerText(ctx, lines.target, 812, 28, 400, family, W - 80)
    centerText(ctx, `เลขที่การจอง ${lines.bookingNo}`, 860, 28, 400, family, W - 80)
    ctx.fillStyle = '#776E71'
    centerText(ctx, 'โอนแล้วกรุณาส่งสลิปในหน้าสถานะการจอง', 930, 24, 400, family, W - 80)
    return canvas.toDataURL('image/png')
  } finally {
    // คืนหน่วยความจำ canvas (iPhone มีเพดานรวม)
    canvas.width = 0
    canvas.height = 0
  }
}

export default function PaymentPanel({
  booking, token, onCheck,
}: {
  booking: PublicBooking
  token: string
  onCheck: () => Promise<PublicBooking | null>
}) {
  const options = amountOptions(booking)
  const [choice, setChoice] = useState<'deposit' | 'full'>(options[0]?.key ?? 'full')
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const depositDone = depositCovered(booking)
  // มัดจำครบแล้ว: ลูกค้ากดเลือกโอนยอดคงเหลือล่วงหน้าเองเท่านั้น
  const [payRest, setPayRest] = useState(false)
  const showPay = !depositDone || payRest

  // ตัวเลือกที่เลือกไว้หายไป (เช่น จ่ายมัดจำครบแล้ว) → ใช้ตัวเลือกแรกที่เหลือ
  const selected = options.find(o => o.key === choice) ?? options[0] ?? null
  useEffect(() => {
    if (selected && selected.key !== choice) setChoice(selected.key)
  }, [selected, choice])

  const amount = selected?.amount ?? 0
  const pi = booking.payment_info
  const ppId = pi.promptpay_id && isValidPromptPayId(pi.promptpay_id) ? pi.promptpay_id : null
  const payload = ppId && amount > 0 ? promptPayPayload(ppId, amount) : ''
  const target = ppId ? `พร้อมเพย์ ${formatPromptPayId(ppId)}${pi.promptpay_name ? ` · ${pi.promptpay_name}` : ''}` : ''
  const hasBank = pi.bank_accounts.length > 0
  const pendingReview = booking.money.pending_review_total

  async function saveQr() {
    if (!qrUrl || saving) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const url = await composeQrImage(qrUrl, {
        shop: booking.shop_name,
        amount: baht(amount),
        target,
        bookingNo: booking.booking_no,
      })
      const a = document.createElement('a')
      a.href = url
      a.download = `qr-${booking.booking_no.replace(/[^A-Za-z0-9._-]/g, '')}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setSaveMsg('ถ้าไม่พบรูปในเครื่อง (เช่น เปิดจากแอป LINE) ให้กดค้างที่รูป QR แล้วเลือก "บันทึกรูปภาพ" แทน')
    } catch {
      setSaveMsg('บันทึกรูปจากปุ่มไม่ได้ในเบราว์เซอร์นี้ — กดค้างที่รูป QR แล้วเลือก "บันทึกรูปภาพ" แทน')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card space-y-5 p-4 sm:p-5" aria-labelledby="pay-title">
      <h2 id="pay-title" className="section-title">
        <Wallet {...ICON_SM} />
        ชำระเงินและส่งสลิป
      </h2>

      {pendingReview > 0 && !depositDone && (
        <div className="alert-info">
          <Info {...ICON_SM} />
          <p className="min-w-0">มีสลิปรอร้านตรวจสอบ {baht(pendingReview)} — ยอดด้านล่างหักส่วนนี้ออกแล้ว</p>
        </div>
      )}

      {depositDone && (
        <div className="alert-ok" role="status">
          <CheckCircle2 {...ICON_SM} />
          <div className="min-w-0 space-y-2">
            <p className="font-semibold">
              {pendingReview > 0 ? 'ส่งสลิปมัดจำครบแล้ว — รอร้านตรวจสอบ ไม่ต้องโอนเพิ่มตอนนี้' : 'ชำระมัดจำครบแล้ว'}
            </p>
            <p>
              ยอดคงเหลือ <span className="money">{baht(amount)}</span> ชำระที่ร้านวันรับชุดได้
              {payRest ? '' : ' หรือถ้าต้องการโอนล่วงหน้า กดปุ่มด้านล่าง'}
            </p>
            {!payRest && (
              <button type="button" className="btn-secondary px-4 text-sm" onClick={() => setPayRest(true)}>
                โอนยอดคงเหลือล่วงหน้า (ไม่บังคับ)
              </button>
            )}
          </div>
        </div>
      )}

      {!showPay ? null : options.length === 0 ? (
        <p className="text-sm text-gray-600">ตอนนี้ไม่มียอดค้างชำระออนไลน์ ส่วนที่เหลือ (ถ้ามี) ชำระที่ร้านวันรับชุด</p>
      ) : (
        <>
          {options.length > 1 && (
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="ยอดที่จะชำระ">
              {options.map(o => (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={selected?.key === o.key}
                  className="choice"
                  onClick={() => setChoice(o.key)}
                >
                  <span>{o.label}</span>
                  <span className="money text-base">{baht(o.amount)}</span>
                </button>
              ))}
            </div>
          )}
          <p className="text-sm text-gray-700">
            {depositDone ? 'ยอดคงเหลือ (โอนล่วงหน้า)' : 'ยอดที่ต้องโอน'} <span className="money text-xl text-gray-900">{baht(amount)}</span>
          </p>

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
                <button type="button" className="btn-secondary" onClick={saveQr} disabled={!qrUrl || saving}>
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
              <p className="min-w-0">ร้านยังไม่ได้ตั้งช่องทางรับโอน กรุณาติดต่อร้านเพื่อสอบถามวิธีชำระเงิน</p>
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
                      <p className="text-sm font-semibold text-gray-900 break-words">{acc.bank || 'บัญชีธนาคาร'}</p>
                      <p className="text-lg font-semibold tabular-nums tracking-wide text-gray-900 break-all">{acc.account_no}</p>
                      {acc.account_name && <p className="text-sm text-gray-600 break-words">ชื่อบัญชี {acc.account_name}</p>}
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
        </>
      )}

      <div className="space-y-3 border-t border-gray-200 pt-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Upload {...ICON_XS} />
          ส่งสลิปการโอน
        </h3>
        <SlipUpload token={token} suggestedAmount={showPay ? amount : 0} slipsCount={booking.slips_count} onCheck={onCheck} />
      </div>
    </section>
  )
}
