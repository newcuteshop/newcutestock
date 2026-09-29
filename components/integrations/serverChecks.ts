// ตัวช่วยฝั่งเซิร์ฟเวอร์ของหน้า "ตั้งค่าการเชื่อมต่อ" — import จาก server component เท่านั้น (ใช้ process.env / Buffer)
// ไม่อ่านค่าความลับออกมาใช้ ตรวจแค่ว่าตั้งค่าไว้ถูกรูปแบบหรือไม่

// ใช้ตัวตรวจตัวเดียวกับที่เซิร์ฟเวอร์ใช้จริง (ไม่ก๊อปโค้ด — หน้าจอกับการบันทึก/ลายเซ็นต้องตัดสินตรงกันเสมอ)
//   encKeyConfigured: INTEGRATIONS_ENC_KEY (base64 32 ไบต์) + INTEGRATIONS_ENC_KEY_VERSION ถูกรูปแบบ (ไม่ throw)
//   appBaseUrl: APP_BASE_URL ไม่มี / ท้าย (ไม่มีค่า/ผิดรูปแบบ = null)
//   shopeePushUrl: URL ที่ Shopee ใช้เซ็นลายเซ็น push (SHOPEE_PUSH_URL หรือ APP_BASE_URL + path)
export { encKeyConfigured } from '@/lib/integrations/crypto'
export { appBaseUrl, shopeePushUrl } from '@/lib/integrations/env'

/** error จาก RPC ที่แปลว่ายังไม่ได้รัน supabase-fix-03-integrations.sql (ไม่มีฟังก์ชันในฐานข้อมูล) */
export function migrationMissing(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: unknown; message?: unknown }
  const code = typeof e.code === 'string' ? e.code : ''
  const msg = typeof e.message === 'string' ? e.message : ''
  return code === 'PGRST202' || code === '42883' || /could not find the function/i.test(msg)
}

/** error "ไม่พบช่องทางนี้" จาก get_integration_channel → notFound() */
export function channelNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: unknown; message?: unknown }
  const msg = typeof e.message === 'string' ? e.message : ''
  return /ไม่พบช่องทาง/.test(msg) || e.code === '22P02'
}
