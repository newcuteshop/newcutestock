'use client'
import { useEffect, useState } from 'react'
import clsx from 'clsx'

// วาด QR code จากข้อความ (เช่น payload พร้อมเพย์จาก lib/promptpay.ts หรือลิงก์หน้าจอง/สถานะการจอง)
// - สร้างเป็นรูป PNG (data URL) ในเบราว์เซอร์ด้วยแพ็กเกจ qrcode → ใช้ <img> ธรรมดา: พิมพ์ผ่าน PrintPortal ได้ บันทึกรูปได้
//   (canvas ที่ถูกคัดลอกไปหน้าพิมพ์จะว่าง แต่ <img> ไม่ว่าง)
// - โหลดแพ็กเกจตอนต้องใช้ครั้งแรก (dynamic import) — หน้าที่ไม่มี QR ไม่ต้องโหลด
// - text ว่าง (เช่น promptPayPayload คืน '' เพราะรหัสพร้อมเพย์ไม่ถูกต้อง) → ไม่แสดงอะไร
// - ความละเอียดภาพ = 3 เท่าของขนาดที่แสดง (คมทั้งจอ Retina และตอนพิมพ์) ไม่เกิน 1024px
// - onDataUrl: ได้ data URL ทุกครั้งที่สร้างเสร็จ (null = สร้างไม่ได้/ข้อความว่าง) — ใช้ทำปุ่ม "บันทึกรูป QR"

export type QrImageProps = {
  text: string
  /** ขนาดที่แสดง (px) ค่าเริ่มต้น 200 */
  size?: number
  /** คำอธิบายใต้ QR (เช่น "สแกนจ่าย ฿1,500.00") — ใช้เป็นข้อความแทนรูปด้วย */
  label?: string
  className?: string
  onDataUrl?: (dataUrl: string | null) => void
}

type QrModule = { toDataURL: (text: string, options?: Record<string, unknown>) => Promise<string> }
let qrModule: Promise<QrModule> | null = null

function loadQr(): Promise<QrModule> {
  if (!qrModule) {
    qrModule = import('qrcode').then(m => {
      const mod = m as unknown as QrModule & { default?: QrModule }
      return typeof mod.toDataURL === 'function' ? mod : (mod.default as QrModule)
    })
    // โหลดไม่สำเร็จ (เน็ตหลุด) → ครั้งหน้าลองโหลดใหม่
    qrModule.catch(() => { qrModule = null })
  }
  return qrModule
}

/** สร้าง data URL ของ QR (ใช้นอก component ได้ เช่น ใส่ในเอกสารพิมพ์) — เรียกได้เฉพาะในเบราว์เซอร์ */
export async function makeQrDataUrl(text: string, size = 200): Promise<string> {
  const qr = await loadQr()
  const px = Math.min(1024, Math.max(96, Math.round(size * 3)))
  return qr.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: px,
    color: { dark: '#000000', light: '#FFFFFF' },
  })
}

export default function QrImage({ text, size = 200, label, className, onDataUrl }: QrImageProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    const value = typeof text === 'string' ? text : ''
    setFailed(false)
    if (!value) {
      setUrl(null)
      onDataUrl?.(null)
      return
    }
    setUrl(null)
    makeQrDataUrl(value, size)
      .then(u => {
        if (!alive) return
        setUrl(u)
        onDataUrl?.(u)
      })
      .catch(() => {
        if (!alive) return
        setFailed(true)
        onDataUrl?.(null)
      })
    return () => {
      alive = false
    }
    // onDataUrl ไม่อยู่ใน deps: ผู้เรียกมักส่งฟังก์ชันใหม่ทุก render — สร้าง QR ใหม่เฉพาะเมื่อข้อความ/ขนาดเปลี่ยน
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, size])

  if (!text) return null

  return (
    <figure className={clsx('inline-flex flex-col items-center gap-2', className)}>
      <span
        className="inline-grid place-items-center overflow-hidden rounded-lg border border-gray-200 bg-white"
        style={{ width: size, height: size, maxWidth: '100%' }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label ? `คิวอาร์โค้ด: ${label}` : 'คิวอาร์โค้ด'} width={size} height={size} className="block h-full w-full" />
        ) : failed ? (
          <span role="alert" className="px-3 text-center text-xs text-gray-500">สร้างคิวอาร์โค้ดไม่สำเร็จ ลองโหลดหน้าใหม่</span>
        ) : (
          <span role="status" className="skeleton block h-full w-full">
            <span className="sr-only">กำลังสร้างคิวอาร์โค้ด...</span>
          </span>
        )}
      </span>
      {label && (
        <figcaption aria-hidden="true" className="max-w-full break-words text-center text-sm font-medium text-gray-700">
          {label}
        </figcaption>
      )}
    </figure>
  )
}
