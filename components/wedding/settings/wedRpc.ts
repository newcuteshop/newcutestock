// ===== ตัวช่วยเขียนข้อมูลของหน้าตั้งค่า / แพ็กเกจ / บริการเสริม / ทีมงาน (ร้าน b.oncloud) =====
// ใช้ฝั่งเบราว์เซอร์ (เรียกจากปุ่ม/เอฟเฟกต์) — หลักเดียวกับหน้ารายละเอียดการจองร้านเช่า (components/rental/booking/rpc.ts):
//   - กดซ้ำไม่ได้ระหว่างรอ (busyRef ของแต่ละหน้า/ป็อปอัป)
//   - สร้างใหม่ส่ง client_id เดิมทุกครั้งที่ลองซ้ำ → ฐานข้อมูลคืนรายการเดิม (already_saved) ไม่สร้างซ้ำ
//   - แก้ไขส่ง updated_at ที่โหลดมา → เครื่องอื่นแก้ก่อน = ถูกปฏิเสธ (ไม่เขียนทับ)
//   - "ไม่รู้ผล" (เน็ตหลุด/หมดเวลา) → โหลดข้อมูลจริงก่อน ถ้าตรงกับที่ส่งไปแล้ว = ถือว่าสำเร็จ ไม่ต้องกดซ้ำ
import { isMigrationMissing } from '@/lib/migration'
import type { BrowserSupabase } from '@/lib/products'
import { FIX07_MISSING_MSG } from '@/lib/wedding'
import { callRpc, rejectedAfterDuplicateCheck } from '@/components/rental/booking/rpc'
import { rentalErrorText } from '@/components/rental/money/moneyRows'

export { callRpc } from '@/components/rental/booking/rpc'

/** ข้อความผิดพลาดภาษาไทย (ยังไม่รัน fix-07 → บอกชื่อไฟล์ที่ต้องรัน / ข้อความสิทธิ์ไทยจาก RPC ใช้ตามเดิม) */
export function wedErrorText(err: unknown): string {
  return rentalErrorText(err, FIX07_MISSING_MSG)
}

/** ฐานข้อมูลยังไม่มีระบบร้าน b.oncloud (ยังไม่ได้รัน supabase-fix-07-wedding.sql) */
export function wedMissing(err: unknown): boolean {
  return isMigrationMissing(err)
}

/** ถูกปฏิเสธเพราะเครื่องอื่นแก้รายการนี้ก่อน (ตัวล็อก updated_at ของ wed_save_package / addon / crew) */
export function isVersionConflictText(message: string): boolean {
  return /ถูกแก้ไขจากเครื่องอื่น/.test(message)
}

/** รายการถูกลบไปแล้วจากเครื่องอื่น */
export function isGoneText(message: string): boolean {
  return /ไม่พบ.*(อาจถูกลบไปแล้ว)/.test(message)
}

export const UNSURE_SAVE_MSG =
  'ไม่แน่ใจว่าบันทึกแล้วหรือยัง (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — กดบันทึกอีกครั้งได้เลย ระบบไม่บันทึกซ้ำ'

export type SaveOutcome<T> =
  | { status: 'ok'; value: T; already: boolean; verified: boolean }
  | { status: 'rejected'; message: string; conflict: boolean; gone: boolean; definite: boolean }
  | { status: 'unsure'; message: string }

/**
 * บันทึก 1 รายการผ่าน RPC ที่คืน json ของรายการนั้น (+ already_saved)
 * - wasUnsure = ครั้งก่อนจบแบบไม่รู้ผล: ครั้งนี้ชนเวอร์ชัน อาจเป็นเพราะครั้งก่อนบันทึกสำเร็จไปแล้ว → โหลดล่าสุดมาเทียบ
 * - reload + matches (ไม่บังคับ) = โหลดรายการล่าสุด แล้วดูว่าตรงกับที่ส่งไปทุกช่องหรือไม่
 */
export async function saveRecord<T>(opts: {
  sb: BrowserSupabase
  fn: string
  args: Record<string, unknown>
  parse: (data: unknown) => T | null
  wasUnsure: boolean
  reload?: () => Promise<T | null>
  matches?: (fresh: T) => boolean
}): Promise<SaveOutcome<T>> {
  const res = await callRpc(opts.sb, opts.fn, opts.args)

  async function verify(): Promise<T | null> {
    if (!opts.reload || !opts.matches) return null
    try {
      const fresh = await opts.reload()
      return fresh && opts.matches(fresh) ? fresh : null
    } catch {
      return null
    }
  }

  if (res.ok) {
    const value = opts.parse(res.data)
    if (value) {
      const already = !!res.data && typeof res.data === 'object' && (res.data as { already_saved?: unknown }).already_saved === true
      return { status: 'ok', value, already, verified: false }
    }
    // ตอบกลับสำเร็จแต่อ่านไม่ได้ (ไม่ควรเกิด) → ดูข้อมูลจริงแทน
    const fresh = await verify()
    if (fresh) return { status: 'ok', value: fresh, already: false, verified: true }
    return { status: 'unsure', message: 'บันทึกแล้วแต่อ่านผลไม่ได้ — โหลดหน้าใหม่เพื่อดูข้อมูลล่าสุด' }
  }

  if (res.answered) {
    const message = wedErrorText(res.error)
    const conflict = isVersionConflictText(message)
    if (conflict && opts.wasUnsure) {
      const fresh = await verify()
      if (fresh) return { status: 'ok', value: fresh, already: true, verified: true }
    }
    return { status: 'rejected', message, conflict, gone: isGoneText(message), definite: rejectedAfterDuplicateCheck(res.error) }
  }

  // ไม่รู้ผล → ดูข้อมูลจริงก่อน
  const fresh = await verify()
  if (fresh) return { status: 'ok', value: fresh, already: false, verified: true }
  return { status: 'unsure', message: UNSURE_SAVE_MSG }
}

/** ค่า updated_at ของรายการจาก JSON ดิบ (ตัวอ่านใน lib/wedding ไม่เก็บช่องนี้ของทีมงาน) ; ไม่มี → null */
export function rawUpdatedAt(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const v = (raw as { updated_at?: unknown }).updated_at
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/** {id: updated_at} จากรายการ JSON ดิบ (wed_list_crew) */
export function rawVersionMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  const arr = Array.isArray(raw) ? raw : []
  for (const r of arr) {
    if (!r || typeof r !== 'object') continue
    const id = (r as { id?: unknown }).id
    const ts = rawUpdatedAt(r)
    if (typeof id === 'string' && id && ts) out[id] = ts
  }
  return out
}

/** คัดลอกข้อความ (ส่ง LINE) — ใช้ clipboard API ก่อน ไม่ได้ → textarea ชั่วคราว ; สำเร็จ = true */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // ลองวิธีสำรองด้านล่าง
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '0'
    ta.style.opacity = '0'
    ta.style.fontSize = '16px' // iOS ไม่ซูมหน้า
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
