// ===== ข้อความ error ของปุ่มส่งออกไฟล์ (ใช้ร่วมกัน: ส่งออกยอดขาย / ส่งออกประวัติสต๊อก) =====
// fetchAllRows โยน Error ที่แปลข้อความแล้ว (เหลือแค่ข้อความ ไม่มีรหัส) → ผู้เรียกเก็บ error ตัวจริงจาก RPC (มีรหัส) ไว้แยก
// แล้วส่งตัวนั้นมาที่นี่ เพื่อตัดสินให้แม่น และไม่เสียข้อความภาษาไทยที่ RPC บอกมาเอง
import { thaiError } from '@/lib/format'
import { FIX04_MISSING_MSG, isMigrationMissing } from '@/lib/migration'

const THAI_RE = /[฀-๿]/

/** error ของปุ่มส่งออก → ข้อความไทย (raw = error ตัวจริงจาก RPC ถ้ามี ไม่งั้น error ที่จับได้) */
export function exportErrorText(raw: unknown): string {
  if (isMigrationMissing(raw)) return FIX04_MISSING_MSG
  if (raw && typeof raw === 'object') {
    const e = raw as { code?: unknown; message?: unknown }
    // สิทธิ์ไม่พอ (42501) ที่ RPC บอกเหตุผลเป็นภาษาไทยมาเอง (เช่น "ไม่มีสิทธิ์ส่งออกรายงานขาย") → ใช้ข้อความนั้น
    // (thaiError จะเหลือแค่ "ไม่มีสิทธิ์ทำรายการนี้" ซึ่งไม่บอกว่าขาดสิทธิ์อะไร)
    if (String(e.code ?? '') === '42501' && typeof e.message === 'string' && THAI_RE.test(e.message)) return e.message.trim()
  }
  return thaiError(raw)
}
