// lib/integrations/env.ts — ค่าตั้งระบบเชื่อมต่อจาก ENV (ฝั่งเซิร์ฟเวอร์เท่านั้น)
import type { Platform } from './types'
import { PLATFORM_META } from './platforms'
import { IntegrationConfigError } from './crypto'

/** APP_BASE_URL ไม่มี / ท้าย (null = ยังไม่ได้ตั้ง/ผิดรูปแบบ) */
export function appBaseUrl(): string | null {
  const raw = (process.env.APP_BASE_URL ?? '').trim().replace(/\/+$/, '')
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return u.origin + u.pathname.replace(/\/+$/, '')
  } catch {
    return null
  }
}

export function requireAppBaseUrl(): string {
  const base = appBaseUrl()
  if (!base) throw new IntegrationConfigError('ยังไม่ได้ตั้งค่า APP_BASE_URL บน Vercel (เช่น https://newcutestock.vercel.app)')
  return base
}

export function callbackUrl(platform: Platform): string {
  const path = PLATFORM_META[platform].callbackPath
  if (!path) throw new IntegrationConfigError('ช่องทางนี้ไม่มีการเชื่อมต่อแบบ OAuth')
  return requireAppBaseUrl() + path
}

/** URL ที่ลงทะเบียนเป็น Push URL ของ Shopee — เป็นส่วนหนึ่งของลายเซ็น webhook (ต้องตรงทุกตัวอักษร) */
export function shopeePushUrl(): string | null {
  const explicit = (process.env.SHOPEE_PUSH_URL ?? '').trim()
  if (explicit) return explicit
  const base = appBaseUrl()
  return base ? base + '/api/integrations/shopee/webhook' : null
}

/** ลิงก์หน้าสินค้าในฟีด — {group_id} / {sku} ถูกแทนค่า (หน้าสินค้าสาธารณะยังไม่ได้สร้าง — รอบอสตัดสินใจ) */
export function feedLinkTemplate(): string {
  const explicit = (process.env.FEED_PRODUCT_LINK_TEMPLATE ?? '').trim()
  if (explicit) return explicit
  return (appBaseUrl() ?? '') + '/p/{group_id}'
}

/** ต้นทางรูปสินค้าสาธารณะ (ถัง product-images) ลงท้ายด้วย / */
export function productImageBase(): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
  return `${base}/storage/v1/object/public/product-images/`
}

/** URL สาธารณะของรูป (path = '<group_id>/<ไฟล์>') */
export function productImageUrl(path: string, imageBase = productImageBase()): string {
  const encoded = String(path ?? '')
    .split('/')
    .filter(part => part !== '')
    .map(part => encodeURIComponent(part))
    .join('/')
  return imageBase + encoded
}
