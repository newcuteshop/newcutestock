'use client'
// การ์ดแชร์ลิงก์จองออนไลน์: ลิงก์เต็ม (โดเมนที่เปิดอยู่ + /book) · คัดลอก · QR · บันทึกรูป QR · พิมพ์โปสเตอร์ A4
// ลิงก์สร้างจาก window.location.origin หลัง mount (เซิร์ฟเวอร์ไม่รู้โดเมนจริง — กัน hydration ไม่ตรง)
// ข้อมูลบนโปสเตอร์ใช้ "ค่าที่บันทึกแล้ว" (ไม่ใช่ค่าที่กำลังพิมพ์ค้าง) — โปสเตอร์ต้องตรงกับหน้าจองจริง
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Copy, Download, ExternalLink, Globe, Loader2, Printer } from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { PUBLIC_BOOK_PATH } from '@/lib/rental'
import QrImage, { makeQrDataUrl } from '@/components/rental/QrImage'
import PrintPortal from '@/components/pos/PrintPortal'
import BookingPoster from './BookingPoster'

// คัดลอกข้อความ: Clipboard API (ต้องเป็น https/localhost) → สำรองด้วย textarea + execCommand (เบราว์เซอร์เก่า/ในแอป)
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // ไม่มีสิทธิ์ใช้คลิปบอร์ด → ลองวิธีสำรอง
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

export default function ShareBookingCard({
  shopName,
  tagline,
  phone,
  lineId,
  openingHours,
  onlineEnabled,
}: {
  shopName: string
  tagline: string | null
  phone: string | null
  lineId: string | null
  openingHours: string | null
  /** ค่าที่บันทึกแล้ว — ปิดรับจองอยู่ = หน้าจองแสดงข้อความปิดรับ (ลิงก์ยังเปิดได้) */
  onlineEnabled: boolean
}) {
  const [url, setUrl] = useState('')
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [posterQr, setPosterQr] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [printError, setPrintError] = useState('')
  const copyTimerRef = useRef<number | null>(null)

  useEffect(() => {
    setUrl(window.location.origin.replace(/\/+$/, '') + PUBLIC_BOOK_PATH)
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
    }
  }, [])

  async function handleCopy() {
    if (!url) return
    const ok = await copyText(url)
    setCopied(ok ? 'ok' : 'fail')
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
    copyTimerRef.current = window.setTimeout(() => setCopied(null), ok ? 2500 : 6000)
  }

  // โปสเตอร์ใช้ QR ความละเอียดสูง (ขนาดพิมพ์ 95 มม.) สร้างให้เสร็จก่อนเปิดหน้าต่างพิมพ์
  async function handlePoster() {
    if (!url || preparing || printing) return
    setPreparing(true)
    setPrintError('')
    try {
      const dataUrl = await makeQrDataUrl(url, 340)
      setPosterQr(dataUrl)
      setPrinting(true)
    } catch {
      setPrintError('สร้างคิวอาร์โค้ดไม่สำเร็จ ลองโหลดหน้าใหม่แล้วพิมพ์อีกครั้ง')
    } finally {
      setPreparing(false)
    }
  }

  return (
    <section id="rs-share" className="card scroll-mt-4 min-w-0" aria-labelledby="rs-share-title">
      <div className="card-header">
        <h2 id="rs-share-title" className="section-title">
          <Globe {...ICON} />
          ลิงก์จองออนไลน์สำหรับลูกค้า
        </h2>
      </div>
      <div className="space-y-4 p-4 sm:p-5">
        {!onlineEnabled && (
          <div role="status" className="alert-warn">
            <AlertTriangle {...ICON_SM} />
            <p className="min-w-0 break-words">
              ตอนนี้ปิดรับจองออนไลน์อยู่ — ลูกค้าที่เปิดลิงก์จะเห็นข้อความปิดรับจองพร้อมช่องทางติดต่อร้าน
            </p>
          </div>
        )}

        <div>
          <label htmlFor="rs-share-url" className="field-label">ลิงก์หน้าจอง (ส่งทาง LINE / Facebook / ใส่ในโปรไฟล์ร้าน)</label>
          <div className="flex items-center gap-2">
            <input
              id="rs-share-url"
              className="input min-w-0 flex-1 font-mono text-sm"
              readOnly
              value={url}
              placeholder="กำลังสร้างลิงก์..."
              onFocus={e => e.currentTarget.select()}
            />
            <button type="button" onClick={() => void handleCopy()} disabled={!url} className="btn-secondary shrink-0 px-4">
              {copied === 'ok' ? <Check {...ICON_SM} /> : <Copy {...ICON_SM} />}
              {copied === 'ok' ? 'คัดลอกแล้ว' : 'คัดลอก'}
            </button>
          </div>
          <p className="mt-1 text-sm" aria-live="polite">
            {copied === 'fail' && <span className="text-red-700">คัดลอกอัตโนมัติไม่ได้ — กดค้างที่ลิงก์แล้วเลือก &quot;คัดลอก&quot;</span>}
          </p>
        </div>

        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          {url ? (
            <QrImage text={url} size={168} label="สแกนเพื่อเปิดหน้าจอง" onDataUrl={setQrUrl} />
          ) : (
            <span className="skeleton block h-[168px] w-[168px] rounded-lg" aria-hidden="true" />
          )}
          <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto">
            {qrUrl ? (
              <a href={qrUrl} download="qr-booking.png" className="btn-secondary w-full sm:w-auto">
                <Download {...ICON_SM} />
                บันทึกรูป QR
              </a>
            ) : (
              <button type="button" disabled className="btn-secondary w-full sm:w-auto">
                <Download {...ICON_SM} />
                บันทึกรูป QR
              </button>
            )}
            <button
              type="button"
              onClick={() => void handlePoster()}
              disabled={!url || preparing || printing}
              className="btn-secondary w-full sm:w-auto"
            >
              {preparing ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Printer {...ICON_SM} />}
              พิมพ์โปสเตอร์ QR (A4)
            </button>
            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer" className="btn-ghost w-full sm:w-auto">
                <ExternalLink {...ICON_SM} />
                เปิดหน้าจองดู
              </a>
            )}
            {printError && <p role="alert" className="text-sm text-red-700">{printError}</p>}
          </div>
        </div>
        <p className="field-hint">
          โปสเตอร์ใช้ชื่อร้าน คำโปรย เบอร์โทร LINE และเวลาเปิดร้านที่บันทึกไว้ — แก้ข้อมูลร้านแล้วกดบันทึกก่อนพิมพ์
        </p>
      </div>

      <PrintPortal open={printing} paper="a4" onDone={() => setPrinting(false)}>
        {posterQr && (
          <BookingPoster
            shopName={shopName}
            tagline={tagline}
            url={url}
            qrDataUrl={posterQr}
            phone={phone}
            lineId={lineId}
            openingHours={openingHours}
          />
        )}
      </PrintPortal>
    </section>
  )
}
