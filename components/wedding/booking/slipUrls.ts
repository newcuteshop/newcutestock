// ===== สลิปโอนเงินของงาน b.oncloud (ถัง wedding-files แบบส่วนตัว) =====
// อัปโหลด: ย่อรูปฝั่งเครื่องแบบเดียวกับรูปสินค้า (compressImage) → '<booking_id>/<uuid>.<ext>' (นโยบาย storage ของ fix-07 บังคับรูปแบบนี้)
//   ไฟล์ใหม่ทุกครั้ง (ห้ามทับ) แล้วค่อยส่ง path ให้ wed_add_payment (p_slip_path)
// ดู: ขอลิงก์ชั่วคราวทีละหลายไฟล์ (อายุ 10 นาที ขอใหม่เมื่อเกิน 8 นาที) — สิทธิ์อ่าน = พนักงาน b.oncloud
import { WEDDING_FILES_BUCKET } from '@/lib/wedding'
import { compressImage, newUuid, storageThaiError, type BrowserSupabase } from '@/lib/products'

export const SLIP_URL_TTL_SEC = 600
export const SLIP_URL_REFRESH_MS = 8 * 60 * 1000

export interface SignedSlipUrl {
  url: string | null   // null = ขอลิงก์ไม่สำเร็จ (ไฟล์หาย/สิทธิ์ไม่พอ/เน็ตหลุด)
  at: number
}

export function isFreshSlipUrl(s: SignedSlipUrl | undefined, now = Date.now()): boolean {
  return !!s && !!s.url && now - s.at < SLIP_URL_REFRESH_MS
}

/** ขอลิงก์ชั่วคราวของหลายไฟล์ในครั้งเดียว → { path: {url, at} } (ไม่ throw) */
export async function signWeddingSlips(supabase: BrowserSupabase, paths: readonly string[]): Promise<Record<string, SignedSlipUrl>> {
  const unique = Array.from(new Set(paths.filter(p => typeof p === 'string' && p.trim() !== '')))
  const out: Record<string, SignedSlipUrl> = {}
  if (unique.length === 0) return out
  const at = Date.now()
  for (const p of unique) out[p] = { url: null, at }
  try {
    const { data, error } = await supabase.storage.from(WEDDING_FILES_BUCKET).createSignedUrls(unique, SLIP_URL_TTL_SEC)
    if (error || !Array.isArray(data)) return out
    for (const item of data) {
      if (item && typeof item.path === 'string' && typeof item.signedUrl === 'string' && item.signedUrl && !item.error) {
        out[item.path] = { url: item.signedUrl, at }
      }
    }
    return out
  } catch {
    return out
  }
}

function isDuplicate(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { statusCode?: unknown; status?: unknown; message?: unknown }
  const status = Number(e.statusCode ?? e.status)
  return status === 409 || (typeof e.message === 'string' && /already exists|duplicate/i.test(e.message))
}

/**
 * ย่อรูปสลิปแล้วอัปโหลดเข้าถัง wedding-files → path '<booking_id>/<uuid>.<ext>'
 * ผิดพลาด → throw Error ข้อความไทย (ผู้เรียกแสดงในป็อปอัป)
 */
export async function uploadWeddingSlip(supabase: BrowserSupabase, bookingId: string, file: Blob): Promise<string> {
  const img = await compressImage(file)
  const bid = bookingId.toLowerCase()
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const path = `${bid}/${newUuid()}.${img.ext}`
    let error: unknown = null
    try {
      const res = await supabase.storage.from(WEDDING_FILES_BUCKET).upload(path, img.blob, {
        contentType: img.contentType,
        cacheControl: '3600',
        upsert: false,
      })
      error = res.error
    } catch (e) {
      error = e
    }
    if (!error) return path
    lastErr = error
    if (!isDuplicate(error)) break
  }
  throw new Error(storageThaiError(lastErr))
}
