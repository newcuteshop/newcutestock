'use client'
// เรียก server action ของหน้า "ตั้งค่าการเชื่อมต่อ" อย่างปลอดภัย
// - กันกดซ้ำระหว่างรอ (ref อัปเดตทันที ไม่รอ state)
// - server action โยน error (เน็ตหลุด/เซิร์ฟเวอร์ล่ม) → คืนเป็น { ok:false, error } ภาษาไทยเสมอ ไม่โชว์ข้อความอังกฤษ
import { useCallback, useRef, useState } from 'react'
import { thaiError } from '@/lib/format'
import type { ActionResult } from '@/lib/integrations/types'

const THAI_RE = /[฀-๿]/
export const GENERIC_ERROR = 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'

export async function callAction<T extends object>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    const res = await fn()
    if (!res || typeof res !== 'object' || typeof (res as { ok?: unknown }).ok !== 'boolean') {
      return { ok: false, error: GENERIC_ERROR }
    }
    if (res.ok === false) {
      const msg = typeof res.error === 'string' && res.error.trim() ? res.error.trim() : GENERIC_ERROR
      return { ok: false, error: msg }
    }
    return res
  } catch (e) {
    const msg = thaiError(e)
    return { ok: false, error: THAI_RE.test(msg) ? msg : GENERIC_ERROR }
  }
}

/** busy = ชื่อปุ่มที่กำลังทำงาน (null = ว่าง) ; run() คืน undefined ถ้ามีงานอื่นค้างอยู่ */
export function useRunner() {
  const [busy, setBusy] = useState<string | null>(null)
  const busyRef = useRef(false)

  const run = useCallback(async <R,>(key: string, fn: () => Promise<R>): Promise<R | undefined> => {
    if (busyRef.current) return undefined
    busyRef.current = true
    setBusy(key)
    try {
      return await fn()
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }, [])

  return { busy, run }
}
