'use client'
// ===== เตรียมรูป/ลิงก์ของเอกสาร (โลโก้ร้าน + QR ลิงก์ติดตามงาน + QR พร้อมเพย์ของยอดที่ต้องชำระตอนนี้) =====
// ทุกอย่างเป็น data URL ก่อนวาด → รูป PNG/งานพิมพ์ไม่มีกรอบว่าง และ canvas ไม่ติดข้อจำกัดข้ามโดเมน
// ลิงก์เต็มสร้างจาก window.location.origin หลัง mount (เซิร์ฟเวอร์ไม่รู้โดเมนจริง)
// โหลดไม่ได้ (เน็ตหลุด/ไม่มีโลโก้) = ใช้ทางเลือกสำรอง: โลโก้ → ก้อนเมฆ, QR → ไม่แสดง — ready เป็น true เสมอเมื่อพยายามครบ
import { useEffect, useState } from 'react'
import { promptPayPayload, isValidPromptPayId } from '@/lib/promptpay'
import { weddingLogoUrl, type WedBooking, type WedSettings } from '@/lib/wedding'
import { imageUrlToDataUrl } from '@/lib/exportImage'
import { makeQrDataUrl } from '@/components/rental/QrImage'
import { docDueNow, type DocAssets } from './docKit'

/** ลิงก์เต็มของหน้าติดตามงาน (ฝั่งเบราว์เซอร์) — ร้านปิดลิงก์ / ไม่มีโทเคน → null */
export function portalUrlOf(b: WedBooking, s: WedSettings): string | null {
  if (typeof window === 'undefined' || !s.portal_enabled || !b.public_url_path) return null
  return window.location.origin.replace(/\/+$/, '') + b.public_url_path
}

/** ข้อความ QR พร้อมเพย์ของยอดที่ต้องชำระตอนนี้ ('' = ไม่มีพร้อมเพย์/ไม่มียอด/งานยกเลิก) */
export function payPayloadOf(b: WedBooking, s: WedSettings): string {
  const amount = docDueNow(b)
  if (amount <= 0 || !s.promptpay_id || !isValidPromptPayId(s.promptpay_id)) return ''
  return promptPayPayload(s.promptpay_id, amount)
}

export function useDocAssets(active: boolean, booking: WedBooking, settings: WedSettings): { assets: DocAssets; ready: boolean } {
  const logoUrl = weddingLogoUrl(settings)
  const payload = payPayloadOf(booking, settings)
  const [portalUrl, setPortalUrl] = useState<string | null>(null)
  const [logo, setLogo] = useState<{ key: string; src: string | null } | null>(null)
  const [portalQr, setPortalQr] = useState<{ key: string; src: string | null } | null>(null)
  const [payQr, setPayQr] = useState<{ key: string; src: string | null } | null>(null)

  useEffect(() => {
    setPortalUrl(portalUrlOf(booking, settings))
  }, [booking, settings])

  // โลโก้: โหลดครั้งเดียวต่อที่อยู่รูป
  useEffect(() => {
    if (!active) return
    if (logo?.key === logoUrl) return
    let alive = true
    if (!logoUrl) {
      setLogo({ key: '', src: null })
      return
    }
    void imageUrlToDataUrl(logoUrl).then(src => {
      if (alive) setLogo({ key: logoUrl, src })
    })
    return () => {
      alive = false
    }
  }, [active, logoUrl, logo?.key])

  useEffect(() => {
    if (!active) return
    const key = portalUrl ?? ''
    if (portalQr?.key === key) return
    let alive = true
    if (!key) {
      setPortalQr({ key: '', src: null })
      return
    }
    makeQrDataUrl(key, 120)
      .then(src => { if (alive) setPortalQr({ key, src }) })
      .catch(() => { if (alive) setPortalQr({ key, src: null }) })
    return () => {
      alive = false
    }
  }, [active, portalUrl, portalQr?.key])

  useEffect(() => {
    if (!active) return
    if (payQr?.key === payload) return
    let alive = true
    if (!payload) {
      setPayQr({ key: '', src: null })
      return
    }
    // QR เงินต้องคมพอให้แอปธนาคารสแกนจากรูปที่ถูกบีบอัดในแชทได้ (ขนาดแสดงใหญ่สุด ~300px → สร้าง ~900px)
    makeQrDataUrl(payload, 300)
      .then(src => { if (alive) setPayQr({ key: payload, src }) })
      .catch(() => { if (alive) setPayQr({ key: payload, src: null }) })
    return () => {
      alive = false
    }
  }, [active, payload, payQr?.key])

  const ready =
    logo !== null && logo.key === (logoUrl || '') &&
    portalQr !== null && portalQr.key === (portalUrl ?? '') &&
    payQr !== null && payQr.key === payload

  return {
    assets: {
      logoSrc: logo && logo.key === (logoUrl || '') ? logo.src : null,
      portalUrl,
      portalQr: portalQr && portalQr.key === (portalUrl ?? '') ? portalQr.src : null,
      payQr: payQr && payQr.key === payload ? payQr.src : null,
    },
    ready,
  }
}
