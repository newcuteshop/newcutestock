// ===== ตรวจว่า "ฐานข้อมูลยังไม่ได้รันไฟล์อัปเดต" (ใช้ได้ทั้ง server และ client — ไม่มี import ฝั่งเซิร์ฟเวอร์) =====
// ระบบ POS ชุดใหม่ (ยกเลิกบิล/คืนสินค้า/ปิดยอด/ตรวจนับ/นำเข้า-ส่งออก) อยู่ใน supabase-fix-04-pos.sql
// ร้านที่ยังไม่ได้รันไฟล์นั้น หน้าเดิมต้องยังใช้ได้ และหน้าใหม่ต้องบอกว่าต้องรันไฟล์อะไร แทนที่จะพังเป็นหน้า error

/** ข้อความมาตรฐานเมื่อยังไม่ได้รัน supabase-fix-04-pos.sql (ใช้ใน MigrationNotice / ข้อความ error ของปุ่มส่งออก ฯลฯ) */
export const FIX04_MISSING_MSG =
  'ฐานข้อมูลยังไม่มีระบบนี้ — รันไฟล์ supabase-fix-04-pos.sql ใน Supabase SQL Editor ก่อน แล้วโหลดหน้านี้ใหม่'

// PGRST202 = ไม่พบฟังก์ชัน (หรือชุดพารามิเตอร์) ใน schema cache · PGRST205 = ไม่พบตาราง
// 42883 = undefined_function · 42P01 = undefined_table · 42703 = undefined_column
const MISSING_CODES = new Set(['PGRST202', 'PGRST205', '42883', '42P01', '42703'])
const MISSING_RE = /could not find the (function|table)|does not exist|schema cache/i

/**
 * error นี้แปลว่า "ฐานข้อมูลยังไม่มีฟังก์ชัน/ตาราง/คอลัมน์ที่ต้องใช้" หรือไม่
 * รับได้ทั้ง PostgrestError ({code, message}), Error (เช่นที่ fetchAllRows โยนมา — เหลือแค่ข้อความ) และสตริง
 * หมายเหตุ: เรียก RPC ด้วยพารามิเตอร์ที่ฐานข้อมูลเวอร์ชันเก่าไม่รู้จัก (เช่น p_cash_received) ก็ได้ PGRST202 → true เช่นกัน
 */
export function isMigrationMissing(err: unknown): boolean {
  if (err === null || err === undefined) return false
  let code = ''
  let message = ''
  if (typeof err === 'string') {
    message = err
  } else if (typeof err === 'object') {
    const e = err as { code?: unknown; message?: unknown }
    code = e.code === null || e.code === undefined ? '' : String(e.code).trim()
    message = typeof e.message === 'string' ? e.message : ''
  } else {
    return false
  }
  if (MISSING_CODES.has(code)) return true
  // ข้อความภาษาไทยจาก RPC ของเราเอง (P0001) / สิทธิ์ไม่พอ (42501) ไม่ใช่ "ยังไม่ได้รันไฟล์" แม้ข้อความจะบังเอิญคล้าย
  if (code === 'P0001' || code === '42501') return false
  return MISSING_RE.test(message)
}
