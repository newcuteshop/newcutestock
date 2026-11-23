'use client'
// ===== ศูนย์ส่งเอกสารของงาน (ร้าน b.oncloud) — ป็อปอัปจากหน้ารายละเอียดงาน (ปุ่ม "ส่งเอกสาร") =====
// เลือกเอกสาร 6 แบบ → ดูตัวอย่างขนาดย่อ (เอกสารจริงกว้าง 1080px) → แชร์รูปเข้า LINE / บันทึกรูป / คัดลอกรูป
// + พิมพ์ A4 (เอกสารที่เลือก) และพิมพ์สัญญาจ้าง A4 (2 ฉบับ) ผ่าน PrintPortal ของระบบ
// ใช้ได้ 2 แบบ:
//   - ควบคุมจากภายนอก: ส่ง onClose (และ open ถ้าต้องการ) → แสดงป็อปอัปทันที ผู้เรียกปิดเอง
//       {docOpen && <DocumentCenter booking={b} settings={s} initialDoc="receipt" paymentId={p.id} onClose={() => setDocOpen(false)} />}
//   - ไม่ส่ง onClose → แสดงปุ่ม "ส่งเอกสาร" ให้กดเปิดเอง
// ไม่มีการเขียนข้อมูลลงฐานข้อมูลเลย (อ่านจากงานที่ส่งมาอย่างเดียว) · ค่าจ้างทีม/ต้นทุน/กำไรไม่อยู่ในเอกสารใด
// มือถือ: ชีตเต็มจอ ตัวเลือกด้านบน ตัวอย่างด้านล่าง ปุ่มส่งรูปติดท้าย · จอใหญ่: ตัวเลือกซ้าย ตัวอย่างขวา
// กติกาเบราว์เซอร์ในแอป LINE: ไม่เปิดแท็บใหม่ ไม่ใช้ window.confirm — บันทึกไม่ได้ = แสดงรูปให้กดค้างบันทึก
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  AlertTriangle, CalendarClock, Clapperboard, FileCheck2, FileSignature, FileText, Info, Loader2, Printer, QrCode,
  Receipt, Send, X,
} from 'lucide-react'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { bangkokTodayKey, formatThaiDate } from '@/lib/format'
import { isValidPromptPayId } from '@/lib/promptpay'
import {
  WED_RECEIPT_TITLES, sessionTimeText, wedMethodLabel,
  type WedBooking, type WedSettings,
} from '@/lib/wedding'
import PrintPortal from '@/components/pos/PrintPortal'
import { makeQrDataUrl } from '@/components/rental/QrImage'
import ContractDoc from './ContractDoc'
import WedDocument from './WedDocument'
import ScaledPreview from './ScaledPreview'
import ImageExportBar, { ExportMessageBox, ExportResultView } from './ImageExportBar'
import { WedA4PageStyle, docDueNow, docMoney } from './docKit'
import {
  DOC_KINDS, DOC_KIND_HINTS, DOC_KIND_LABELS, activeSessions, defaultPaymentId, defaultSessionId, docFileBase,
  isDocKind, pricesToggleApplies, receiptPayments, termsToggleApplies,
  type DocKind, type DocOptions,
} from './docKinds'
import { portalUrlOf, useDocAssets } from './useDocAssets'
import { useImageExport } from './useImageExport'

export type { DocKind } from './docKinds'

export interface DocumentCenterProps {
  booking: WedBooking
  settings: WedSettings
  /** เอกสารที่เปิดค้างไว้ตอนเริ่ม (ไม่ส่ง = ใบยืนยันการจอง ; ส่ง paymentId มา = ใบเสร็จ) */
  initialDoc?: DocKind
  /** ใบเสร็จของรายการเงินนี้ */
  paymentId?: string
  /** ตารางคิวของคิวนี้ (ไม่ส่ง = คิวถัดไปที่ยังไม่ถึง) */
  sessionId?: string
  /** ปิดป็อปอัป — ส่งมา = ผู้เรียกควบคุมการเปิด/ปิดเอง ; ไม่ส่ง = แสดงปุ่ม "ส่งเอกสาร" ให้กดเปิด */
  onClose?: () => void
  /** ใช้คู่ onClose: false = ไม่แสดงป็อปอัป (ค่าเริ่มต้น true) */
  open?: boolean
  /** คลาสของปุ่ม "ส่งเอกสาร" (เฉพาะแบบไม่ส่ง onClose) */
  triggerClassName?: string
}

const KIND_ICONS: Record<DocKind, typeof FileText> = {
  confirmation: FileCheck2,
  quote: FileText,
  payment_request: QrCode,
  receipt: Receipt,
  schedule: CalendarClock,
  delivery: Clapperboard,
}

export default function DocumentCenter(props: DocumentCenterProps) {
  const controlled = typeof props.onClose === 'function'
  const [selfOpen, setSelfOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  if (controlled) {
    if (props.open === false) return null
    return <DocumentCenterDialog {...props} onClose={props.onClose as () => void} />
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={props.triggerClassName ?? 'btn-secondary'}
        onClick={() => setSelfOpen(true)}
        aria-haspopup="dialog"
      >
        <Send {...ICON_SM} />
        ส่งเอกสาร
      </button>
      {selfOpen && (
        <DocumentCenterDialog
          {...props}
          onClose={() => {
            setSelfOpen(false)
            // คืนโฟกัสให้ปุ่มที่เปิด (ผู้ใช้คีย์บอร์ด/โปรแกรมอ่านจอไม่หลงตำแหน่ง)
            window.setTimeout(() => triggerRef.current?.focus(), 0)
          }}
        />
      )}
    </>
  )
}

type PrintJob = { doc: 'document' } | { doc: 'contract'; qr: string | null }

function DocumentCenterDialog({
  booking: b,
  settings,
  initialDoc,
  paymentId,
  sessionId,
  onClose,
}: DocumentCenterProps & { onClose: () => void }) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // กำลังแชร์/บันทึก/คัดลอกรูปอยู่ → ไม่ปิด (Esc / แตะพื้นหลัง / ปุ่มปิด) แบบเดียวกับ ConfirmDialog
  const busyRef = useRef(false)
  const requestClose = () => {
    if (!busyRef.current) closeRef.current()
  }

  const startKind: DocKind = isDocKind(initialDoc) ? initialDoc : paymentId ? 'receipt' : 'confirmation'
  const [kind, setKind] = useState<DocKind>(startKind)
  const [payId, setPayId] = useState<string | null>(() => defaultPaymentId(b, paymentId))
  const [sessId, setSessId] = useState<string | null>(() => (sessionId && b.sessions.some(s => s.id === sessionId) ? sessionId : defaultSessionId(b)))
  const [forCrew, setForCrew] = useState(false)
  const [showPrices, setShowPrices] = useState(true)
  // เงื่อนไขยาว — ใบแจ้งชำระปิดไว้ก่อน (รูปสั้น อ่านยอดง่าย) ; ใบยืนยัน/ใบเสนอราคาเปิดไว้
  const [termsByKind, setTermsByKind] = useState<Record<'confirmation' | 'quote' | 'payment_request', boolean>>({
    confirmation: true,
    quote: true,
    payment_request: false,
  })
  const [print, setPrint] = useState<PrintJob | null>(null)
  const [preparingContract, setPreparingContract] = useState(false)
  const [issuedOn, setIssuedOn] = useState<string>('')

  useEffect(() => {
    // วันที่ออกเอกสารตามเวลาไทยของเครื่องผู้ใช้ (ตั้งหลัง mount — กัน hydration ไม่ตรง)
    setIssuedOn(bangkokTodayKey())
    panelRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (!busyRef.current) closeRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // งานถูกโหลดใหม่ (รับเงิน/แก้ไข) แล้วรายการที่เลือกหายไป → เลือกใหม่
  useEffect(() => {
    if (payId && !b.payments.some(p => p.id === payId)) setPayId(defaultPaymentId(b, null))
    if (!payId && b.payments.length > 0) setPayId(defaultPaymentId(b, null))
    if (sessId && !activeSessions(b).some(s => s.id === sessId)) setSessId(defaultSessionId(b))
  }, [b, payId, sessId])

  const payments = useMemo(() => receiptPayments(b), [b])
  const sessions = useMemo(() => activeSessions(b), [b])
  const showTerms = kind === 'confirmation' || kind === 'quote' || kind === 'payment_request' ? termsByKind[kind] : false
  const options: DocOptions = { showPrices, showTerms, forCrew, paymentId: payId, sessionId: sessId }
  const { assets, ready: assetsReady } = useDocAssets(true, b, settings)

  const selectedPayment = payments.find(p => p.id === payId) ?? null
  const needsPayment = kind === 'receipt' && !selectedPayment
  const dueNow = docDueNow(b)
  const ppOk = !!settings.promptpay_id && isValidPromptPayId(settings.promptpay_id)

  const fileExtra = kind === 'receipt' ? selectedPayment?.receipt_no ?? null : kind === 'schedule' && forCrew ? 'crew' : null
  const signature = JSON.stringify([
    kind, payId, sessId, forCrew, showPrices, showTerms, issuedOn,
    b.id, b.updated_at, b.money.grand_total, b.money.paid, b.payments.length, b.deliverables.length,
    assets.logoSrc ? assets.logoSrc.length : 0, assets.portalQr ? 1 : 0, assets.payQr ? assets.payQr.length : 0,
  ])
  const exp = useImageExport({
    getNode: () => docRef.current,
    fileBase: docFileBase(b, kind, fileExtra),
    signature,
    ready: assetsReady && !!issuedOn && !needsPayment,
  })
  busyRef.current = exp.busy

  async function printContract() {
    if (print || preparingContract) return
    setPreparingContract(true)
    let qr: string | null = null
    try {
      const url = portalUrlOf(b, settings)
      if (url) qr = await makeQrDataUrl(url, 90)
    } catch {
      qr = null // สร้าง QR ไม่ได้ก็พิมพ์สัญญาได้ (ไม่มี QR)
    } finally {
      setPreparingContract(false)
    }
    setPrint({ doc: 'contract', qr })
  }

  const docLabel = kind === 'receipt' && selectedPayment ? WED_RECEIPT_TITLES[selectedPayment.kind] : DOC_KIND_LABELS[kind]
  const notices = kindNotices(kind, b, settings, { dueNow, ppOk, forCrew })

  return (
    <div
      className="fixed inset-0 z-[60] !mt-0 flex items-end justify-center scrim sm:items-center sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) requestClose() }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="sheet flex h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-b-none border-b-0 outline-none animate-fade-up sm:h-[90dvh] sm:rounded-4xl sm:border-b"
      >
        {/* หัว */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="icon-bubble shrink-0" aria-hidden="true">
              <Send {...ICON} />
            </span>
            <div className="min-w-0">
              <h3 id={titleId} className="text-lg font-semibold leading-snug text-gray-900">ส่งเอกสาร</h3>
              <p className="truncate text-xs text-gray-600">
                {b.booking_no} · {b.couple_names || '-'}
              </p>
            </div>
          </div>
          <button type="button" onClick={requestClose} disabled={exp.busy} aria-label="ปิด" className="btn-icon btn-icon-plain -mr-2 shrink-0">
            <X {...ICON} />
          </button>
        </div>

        {/* เนื้อหา: มือถือเลื่อนทั้งก้อน · จอใหญ่ซ้าย-ขวาเลื่อนแยกกัน */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
          {/* ตัวเลือก */}
          <div className="space-y-4 border-b border-gray-200 p-4 sm:p-5 lg:overflow-y-auto lg:overscroll-contain lg:border-b-0 lg:border-r">
            <fieldset>
              <legend className="field-label">เลือกเอกสาร</legend>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="ชนิดเอกสาร">
                {DOC_KINDS.map(k => {
                  const Icon = KIND_ICONS[k]
                  return (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={kind === k}
                      className="choice min-w-0 items-start px-3 text-left"
                      onClick={() => setKind(k)}
                    >
                      <span className="flex w-full min-w-0 items-center gap-1.5">
                        <Icon {...ICON_XS} className="shrink-0" />
                        <span className="min-w-0 truncate">{DOC_KIND_LABELS[k]}</span>
                      </span>
                      <span className="block w-full truncate text-xs font-normal text-gray-500">{DOC_KIND_HINTS[k]}</span>
                    </button>
                  )
                })}
              </div>
            </fieldset>

            {kind === 'receipt' && (
              <div>
                <label htmlFor={`${titleId}-pay`} className="field-label">รายการเงิน</label>
                {payments.length === 0 ? (
                  <p className="text-sm text-gray-600">ยังไม่มีรายการชำระเงินของงานนี้ — บันทึกรับเงินก่อน แล้วค่อยออกใบเสร็จ</p>
                ) : (
                  <select
                    id={`${titleId}-pay`}
                    className="input"
                    value={payId ?? ''}
                    onChange={e => setPayId(e.target.value || null)}
                  >
                    {payments.map(p => (
                      <option key={p.id} value={p.id}>
                        {[
                          p.receipt_no ?? 'ไม่มีเลขที่',
                          formatThaiDate(p.paid_on ?? p.created_at),
                          `${p.kind === 'refund' ? 'คืน ' : ''}${docMoney(p.amount)}`,
                          wedMethodLabel(p.method),
                          p.voided_at ? 'ยกเลิกแล้ว' : '',
                        ].filter(Boolean).join(' · ')}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {kind === 'schedule' && (
              <div className="space-y-3">
                <div>
                  <label htmlFor={`${titleId}-sess`} className="field-label">คิวงาน</label>
                  {sessions.length === 0 ? (
                    <p className="text-sm text-gray-600">งานนี้ยังไม่มีคิวงาน</p>
                  ) : (
                    <select
                      id={`${titleId}-sess`}
                      className="input"
                      value={sessId ?? ''}
                      onChange={e => setSessId(e.target.value || null)}
                    >
                      {sessions.length > 1 && <option value="">ทุกคิว ({sessions.length} คิว)</option>}
                      {sessions.map(s => (
                        <option key={s.id} value={s.id}>
                          {[s.date ? formatThaiDate(s.date) : 'ยังไม่กำหนดวัน', s.type_label, s.title, sessionTimeText(s, '')]
                            .filter(Boolean).join(' · ')}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <ToggleRow
                  label="สำหรับทีมงาน"
                  hint={forCrew ? 'แสดงทีม เวลาทีมถึงงาน เบอร์ลูกค้า หมายเหตุภายใน — ไม่มียอดเงิน' : 'แบบคู่บ่าวสาว: เวลา สถานที่ กำหนดการ'}
                  checked={forCrew}
                  onChange={setForCrew}
                />
              </div>
            )}

            {(pricesToggleApplies(kind, forCrew) || termsToggleApplies(kind)) && (
              <div className="space-y-2">
                {pricesToggleApplies(kind, forCrew) && (
                  <ToggleRow label="แสดงราคา" hint="ยอดเงิน งวดชำระ และรายการที่ชำระแล้ว" checked={showPrices} onChange={setShowPrices} />
                )}
                {termsToggleApplies(kind) && (
                  <ToggleRow
                    label="แสดงเงื่อนไข"
                    hint="เงื่อนไขการให้บริการจากหน้าตั้งค่าร้าน"
                    checked={showTerms}
                    onChange={v => {
                      if (kind === 'confirmation' || kind === 'quote' || kind === 'payment_request') {
                        const k = kind
                        setTermsByKind(prev => ({ ...prev, [k]: v }))
                      }
                    }}
                  />
                )}
              </div>
            )}

            {notices.length > 0 && (
              <div className="space-y-2">
                {notices.map(n => (
                  <div key={n.text} className={n.tone === 'warn' ? 'alert-warn' : 'alert-info'}>
                    {n.tone === 'warn' ? <AlertTriangle {...ICON_SM} /> : <Info {...ICON_SM} />}
                    <p className="min-w-0 break-words">{n.text}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2 border-t border-gray-200 pt-4">
              <p className="field-label">พิมพ์ลงกระดาษ A4</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="btn-secondary min-w-0 px-2"
                  onClick={() => setPrint({ doc: 'document' })}
                  disabled={!!print || needsPayment || !issuedOn}
                >
                  <Printer {...ICON_SM} />
                  <span className="truncate">พิมพ์ A4</span>
                </button>
                <button
                  type="button"
                  className="btn-secondary min-w-0 px-2"
                  onClick={() => void printContract()}
                  disabled={!!print || preparingContract}
                >
                  {preparingContract ? <Loader2 {...ICON_SM} className="animate-spin" /> : <FileSignature {...ICON_SM} />}
                  <span className="truncate">สัญญาจ้าง A4</span>
                </button>
              </div>
              <p className="field-hint">สัญญาจ้างพิมพ์ 2 ฉบับ (ลูกค้า / ผู้ให้บริการ) พร้อมเงื่อนไขครบทุกข้อและช่องลงชื่อ</p>
            </div>
          </div>

          {/* ตัวอย่างเอกสาร */}
          <div className="space-y-3 bg-gray-100 p-3 sm:p-5 lg:overflow-y-auto lg:overscroll-contain">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-semibold text-gray-900">ตัวอย่าง{docLabel}</p>
              <p className="shrink-0 text-xs text-gray-600" aria-live="polite">
                {exp.preparing ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 {...ICON_XS} className="animate-spin" />
                    กำลังเตรียมรูป...
                  </span>
                ) : exp.hasImage ? 'รูปพร้อมส่ง' : ''}
              </p>
            </div>
            <ExportResultView exp={exp} alt={`รูป${docLabel} ${b.booking_no}`} />
            {issuedOn ? (
              <ScaledPreview className="rounded-lg border border-gray-200 bg-white">
                <WedDocument
                  ref={docRef}
                  kind={kind}
                  mode="image"
                  booking={b}
                  settings={settings}
                  options={options}
                  assets={assets}
                  issuedOn={issuedOn}
                />
              </ScaledPreview>
            ) : (
              <div className="skeleton h-64 w-full rounded-lg" aria-hidden="true" />
            )}
          </div>
        </div>

        {/* ท้าย: ส่งรูป */}
        <div
          className="shrink-0 space-y-2 border-t border-gray-200 bg-white px-4 pt-3 sm:px-5"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <ExportMessageBox message={exp.message} />
          <ImageExportBar exp={exp} disabled={needsPayment || !issuedOn} className="lg:ml-auto lg:max-w-xl" />
        </div>
      </div>

      <PrintPortal open={print !== null} paper="a4" onDone={() => setPrint(null)}>
        {print?.doc === 'document' && issuedOn && (
          <div data-shop="wedding">
            <WedA4PageStyle />
            <WedDocument kind={kind} mode="print" booking={b} settings={settings} options={options} assets={assets} issuedOn={issuedOn} />
          </div>
        )}
        {print?.doc === 'contract' && <ContractDoc booking={b} settings={settings} qrDataUrl={print.qr} />}
      </PrintPortal>
    </div>
  )
}

/** แถวสวิตช์เปิด/ปิด (ทั้งแถวกดได้ สูง ≥ 44px) */
function ToggleRow({
  label, hint, checked, onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="panel flex w-full min-h-[44px] items-center justify-between gap-3 px-3 py-2 text-left"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-gray-900">{label}</span>
        {hint && <span className="block text-xs text-gray-600">{hint}</span>}
      </span>
      <span aria-hidden="true" className={clsx('switch', checked && 'switch-on')}>
        <span className="switch-knob" />
      </span>
    </button>
  )
}

// คำแนะนำ/คำเตือนของเอกสารที่เลือก (ข้อมูลที่ขาดซึ่งทำให้เอกสารไม่ครบ)
function kindNotices(
  kind: DocKind,
  b: WedBooking,
  s: WedSettings,
  x: { dueNow: number; ppOk: boolean; forCrew: boolean },
): { tone: 'info' | 'warn'; text: string }[] {
  const out: { tone: 'info' | 'warn'; text: string }[] = []
  if (kind === 'payment_request') {
    if (b.status === 'cancelled') out.push({ tone: 'warn', text: 'งานนี้ยกเลิกแล้ว — ใบแจ้งชำระจะไม่มียอดต้องชำระและไม่มี QR' })
    else if (x.dueNow <= 0) out.push({ tone: 'info', text: 'งานนี้ไม่มียอดค้างชำระ — ใบแจ้งชำระจะแสดงว่าชำระครบแล้ว' })
    else if (!x.ppOk && s.bank_accounts.length === 0) {
      out.push({ tone: 'warn', text: 'ร้านยังไม่ได้ตั้งพร้อมเพย์หรือบัญชีธนาคาร — ตั้งได้ที่หน้าตั้งค่าร้าน (การรับเงิน)' })
    } else if (!x.ppOk) {
      out.push({ tone: 'info', text: 'ยังไม่ได้ตั้งพร้อมเพย์ จึงไม่มี QR — เอกสารแสดงบัญชีธนาคารแทน' })
    }
  }
  if (kind === 'schedule' && x.forCrew) {
    out.push({ tone: 'info', text: 'ตารางสำหรับทีมมีเบอร์ลูกค้าและหมายเหตุภายใน — ส่งเฉพาะกลุ่มทีมงาน' })
  }
  if (kind === 'delivery' && b.deliverables.length === 0) {
    out.push({ tone: 'info', text: 'ยังไม่มีรายการส่งงาน (สร้างเมื่อยืนยันงาน) — เอกสารแสดงรายการที่จะได้รับจากแพ็กเกจ' })
  }
  if ((kind === 'confirmation' || kind === 'quote') && b.status === 'cancelled') {
    out.push({ tone: 'warn', text: 'งานนี้ยกเลิกแล้ว — เอกสารมีป้าย "ยกเลิกแล้ว"' })
  }
  if (!s.portal_enabled && kind !== 'schedule') {
    out.push({ tone: 'info', text: 'ร้านปิดลิงก์ติดตามงานอยู่ — เอกสารจึงไม่มี QR หน้าติดตามงาน' })
  }
  return out
}
