// ===== ลิงก์ดูรูปสลิป (ถัง rental-slips เป็นแบบส่วนตัว — ต้องขอลิงก์ชั่วคราวทุกครั้ง) =====
// ลิงก์มีอายุ 10 นาที (ตามสเปก) → เก็บเวลาที่ขอไว้ แล้วขอใหม่เมื่อเกิน 8 นาที (เผื่อเวลาที่ภาพยังโหลดไม่เสร็จ)
// สิทธิ์อ่านถัง = พนักงานร้านเช่า (นโยบาย storage ใน supabase-fix-05-rental.sql)
import { RENTAL_SLIP_BUCKET } from '@/lib/rental'
import type { BrowserSupabase } from '@/lib/products'

/** อายุลิงก์ (วินาที) */
export const SLIP_URL_TTL_SEC = 600
/** ขอใหม่เมื่อลิงก์เก่ากว่านี้ (มิลลิวินาที) */
export const SLIP_URL_REFRESH_MS = 8 * 60 * 1000

export interface SignedSlipUrl {
  url: string | null   // null = ขอลิงก์ไม่สำเร็จ (ไฟล์หาย/สิทธิ์ไม่พอ/เน็ตหลุด)
  at: number           // เวลาที่ขอ (Date.now())
}

/** ลิงก์ยังใช้ได้ไหม (มีลิงก์ และยังไม่เก่าเกินเวลาที่กำหนด) */
export function isFreshSlipUrl(s: SignedSlipUrl | undefined, now = Date.now()): boolean {
  return !!s && !!s.url && now - s.at < SLIP_URL_REFRESH_MS
}

/**
 * ขอลิงก์ชั่วคราวของหลายไฟล์ในครั้งเดียว → { path: {url, at} } (ไม่ throw — ไฟล์ที่ขอไม่ได้ได้ url = null)
 * path ว่าง/ซ้ำถูกตัดทิ้ง
 */
export async function signSlipUrls(supabase: BrowserSupabase, paths: readonly string[]): Promise<Record<string, SignedSlipUrl>> {
  const unique = Array.from(new Set(paths.filter(p => typeof p === 'string' && p.trim() !== '')))
  const out: Record<string, SignedSlipUrl> = {}
  if (unique.length === 0) return out
  const at = Date.now()
  try {
    const { data, error } = await supabase.storage.from(RENTAL_SLIP_BUCKET).createSignedUrls(unique, SLIP_URL_TTL_SEC)
    if (error || !Array.isArray(data)) {
      for (const p of unique) out[p] = { url: null, at }
      return out
    }
    for (const p of unique) out[p] = { url: null, at }
    for (const item of data) {
      if (item && typeof item.path === 'string' && typeof item.signedUrl === 'string' && item.signedUrl && !item.error) {
        out[item.path] = { url: item.signedUrl, at }
      }
    }
    return out
  } catch {
    for (const p of unique) out[p] = { url: null, at }
    return out
  }
}
