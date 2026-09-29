// lib/integrations/background.ts — ทำงานต่อหลังตอบกลับแล้ว (waitUntil ของ Vercel) โดยไม่ต้องเพิ่มแพ็กเกจ
// ใช้กลไกเดียวกับ @vercel/functions: globalThis[Symbol.for('@vercel/request-context')].get().waitUntil
// ไม่มี context (รันนอก Vercel / ทดสอบ) = ไม่ทำอะไร — pg_cron/worker จะหยิบงานไปทำในรอบถัดไปเอง
import { logError } from './redact'

const REQUEST_CONTEXT = Symbol.for('@vercel/request-context')

interface VercelRequestContext { waitUntil?: (p: Promise<unknown>) => void }

export function runInBackground(task: () => Promise<unknown>): boolean {
  try {
    const holder = (globalThis as unknown as Record<symbol, { get?: () => VercelRequestContext | undefined } | undefined>)[REQUEST_CONTEXT]
    const ctx = holder?.get?.()
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(task().catch(e => logError('background', e)))
      return true
    }
  } catch (e) {
    logError('background_context', e)
  }
  return false
}
