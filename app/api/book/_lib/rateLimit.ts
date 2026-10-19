// ตัวจำกัดจำนวนครั้งต่อผู้ส่ง (ต่อ IP) ของ API หน้าจองออนไลน์ — /api/book/request และ /api/book/slip (ฝั่งเซิร์ฟเวอร์เท่านั้น)
// - นับในฐานข้อมูลด้วย rental_rate_hit (service role เท่านั้น · supabase-fix-06-rental-online.sql) → ใช้ได้ข้ามหลายเซิร์ฟเวอร์ของ Vercel
// - ไม่เก็บ IP จริง: ส่งแค่แฮช sha256 (ตัด 32 ตัว) ของ IP + เกลือฝั่งเซิร์ฟเวอร์ ; bucket = '<ชื่อด่าน>:<ช่วง>:<แฮช>'
// - ตัวนับเสีย (ฐานข้อมูลรุ่นเก่ายังไม่มีฟังก์ชัน / เน็ตหลุด) = ปล่อยผ่าน (log ไว้) — ด่านจริงของการจองอยู่ใน RPC อยู่แล้ว
//   (จำกัดชิ้นต่อเบอร์ / ถือชุดที่ยังไม่จ่ายได้ไม่เกินครึ่ง / สลิปไม่เกิน 5) ตัวนับนี้กันสคริปต์ยิงถล่มเป็นชั้นเสริม
// - ค่าเผื่อไว้กว้าง: เน็ตมือถือในไทยหลายเครื่องใช้ IP เดียวกันได้ (CGNAT)
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface RateRule {
  /** ชื่อช่วงสั้นๆ ใน bucket (เช่น 'm' = 10 นาที, 'd' = วัน) */
  tag: string
  limit: number
  windowSeconds: number
}

/** IP ของผู้ส่ง: Vercel ตั้ง x-real-ip / x-forwarded-for (ตัวแรก = เครื่องลูกค้า) ; ไม่มี = 'unknown' (ใช้ถังร่วมกัน) */
export function clientIp(req: Request): string {
  const real = (req.headers.get('x-real-ip') ?? '').trim()
  if (real) return real.slice(0, 64)
  const fwd = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? ''
  return fwd ? fwd.slice(0, 64) : 'unknown'
}

function ipHash(ip: string): string {
  const salt = process.env.RENTAL_RATE_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || 'newcute-rental'
  return createHash('sha256').update(`${salt}|${ip}`).digest('hex').slice(0, 32)
}

/**
 * นับ 1 ครั้งต่อทุกกฎ แล้วคืน true = เกินกฎใดกฎหนึ่งแล้ว (ให้ตอบ 429) / false = ผ่าน
 * นับทุกกฎเสมอ (ไม่หยุดที่กฎแรกที่เกิน) — ยิงต่อเนื่องก็ยังถูกนับในช่วงยาว
 */
export async function isRateLimited(admin: SupabaseClient, gate: string, req: Request, rules: readonly RateRule[]): Promise<boolean> {
  const h = ipHash(clientIp(req))
  let limited = false
  for (const r of rules) {
    try {
      const { data, error } = await admin.rpc('rental_rate_hit', {
        p_bucket: `${gate}:${r.tag}:${h}`,
        p_limit: r.limit,
        p_window_seconds: r.windowSeconds,
      })
      if (error) {
        const e = error as { code?: unknown; message?: unknown }
        console.error(`[api/book/${gate}] rate counter failed`, String(e.code ?? ''), String(e.message ?? '').slice(0, 200))
        continue
      }
      if (data === false) limited = true
    } catch (e) {
      console.error(`[api/book/${gate}] rate counter failed`, String(e).slice(0, 200))
    }
  }
  return limited
}

/** ส่งคำขอจอง: 15 ครั้ง / 10 นาที และ 60 ครั้ง / วัน ต่อ IP (ส่งซ้ำด้วยรหัสเดิมก็นับ) */
export const REQUEST_RATE_RULES: readonly RateRule[] = [
  { tag: 'm', limit: 15, windowSeconds: 600 },
  { tag: 'd', limit: 60, windowSeconds: 86400 },
]

/** ส่งสลิป: 20 ครั้ง / 10 นาที และ 80 ครั้ง / วัน ต่อ IP (ต่อการจองยังจำกัด 5 ใบในฐานข้อมูล) */
export const SLIP_RATE_RULES: readonly RateRule[] = [
  { tag: 'm', limit: 20, windowSeconds: 600 },
  { tag: 'd', limit: 80, windowSeconds: 86400 },
]

export const RATE_LIMIT_MSG = 'ส่งบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่ หรือติดต่อร้านทาง LINE'
