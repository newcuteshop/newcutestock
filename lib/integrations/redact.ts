// lib/integrations/redact.ts — ตัดความลับ/ข้อมูลผู้ซื้อออกก่อน log หรือส่งเข้าฐานข้อมูล (กฎเดียวกับ SQL integration_strip)
// ฝั่งเซิร์ฟเวอร์เท่านั้น — ทุกการ log ของระบบเชื่อมต่อต้องผ่าน logError() ในไฟล์นี้

/** ชื่อคีย์ที่เป็นความลับ → แทนค่าด้วย '[REDACTED]' (ตรงกับ integration_strip ใน supabase-fix-03-integrations.sql) */
export const SECRET_KEY_RE =
  /^(access_?token|refresh_?token|id_?token|token|.*[_-]token|.*token[_-].*|secret|.*[_-]secret|app_?secret|client_?secret|partner_?key|api_?key|x-api-key|sign|signature|x-myshop-signature|x-hub-signature(-256)?|authorization|proxy-authorization|password|passwd|cookie|set-cookie|appsecret_proof|auth_?code|x-tts-access-token)$/i

/** ชื่อคีย์ที่เป็นข้อมูลส่วนบุคคลของผู้ซื้อ → ลบทั้งคีย์ */
export const PII_KEY_RE =
  /(address|phone|mobile|e_?mail|recipient|receiver|buyer_?(name|user_?name|email|message|note)|customer_?(name|phone|email|first|last)|first_?name|last_?name|full_?name|tax_?id|id_?card|citizen|remark_?buyer|remark_?recipient|message_?to_?seller|note_?to_?seller|billing)/i
const PII_EXACT_RE = /^(buyer|customer|consignee|shipping|delivery_?info)$/i

const MAX_DEPTH = 20

function redactValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value
  if (depth > MAX_DEPTH) return '[DEPTH]'
  if (Array.isArray(value)) return value.map(v => redactValue(v, depth + 1))
  if (typeof value === 'object') {
    if (value instanceof Date) return value.toISOString()
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) out[k] = '[REDACTED]'
      else if (PII_EXACT_RE.test(k) || PII_KEY_RE.test(k)) continue
      else out[k] = redactValue(v, depth + 1)
    }
    return out
  }
  // ค่าที่เป็นข้อความ: ซ่อนเฉพาะค่าลับใน URL (ไม่แตะรหัสอื่นๆ ที่ worker ต้องใช้ประมวลผล)
  if (typeof value === 'string') return /https?:\/\//i.test(value) ? value.replace(/https?:\/\/[^\s"'<>]+/gi, m => redactUrl(m)) : value
  return value
}

/** สำเนาลึก: คีย์ลับ → '[REDACTED]', คีย์ข้อมูลผู้ซื้อ → ลบ, ค่าลับใน query ของ URL → '***' */
export function redact<T>(value: T): T {
  return redactValue(value, 0) as T
}

const URL_SECRET_PARAMS = new Set([
  'sign', 'signature', 'access_token', 'refresh_token', 'app_secret', 'client_secret', 'partner_key', 'code', 'auth_code',
  'state', 'api_key', 'appsecret_proof', 'token', 'secret', 'resend_code',
])

/** ซ่อนค่าลับใน query string ของ URL (ใช้ก่อน log URL ทุกครั้ง) */
export function redactUrl(url: string): string {
  const text = String(url ?? '')
  try {
    const u = new URL(text)
    const keys = Array.from(u.searchParams.keys())
    for (const k of keys) {
      if (URL_SECRET_PARAMS.has(k.toLowerCase()) || SECRET_KEY_RE.test(k)) u.searchParams.set(k, '***')
    }
    u.username = ''
    u.password = ''
    return u.toString()
  } catch {
    return text.replace(/([?&](?:sign|signature|access_token|refresh_token|app_secret|client_secret|partner_key|code|auth_code|state|api_key|appsecret_proof|token|secret)=)[^&#\s]*/gi, '$1***')
  }
}

/** ซ่อนสิ่งที่ดูเหมือนความลับในข้อความอิสระ (ข้อความ error, URL ที่ติดมา) */
export function redactText(s: string): string {
  let t = String(s ?? '')
  t = t.replace(/https?:\/\/[^\s"'<>]+/gi, m => redactUrl(m))
  t = t.replace(/((?:access_token|refresh_token|app_secret|client_secret|partner_key|api_key|appsecret_proof|auth_code|x-api-key|x-tts-access-token|authorization|sign|secret|password)["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s"'&,;}]+/gi, '$1***')
  t = t.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer ***')
  // โทเคนยาวๆ ที่หลุดมาเดี่ยวๆ (เช่น TTP_xxx, EAAxxx) — ตัวเลขล้วน (เลขออเดอร์) ไม่ถูกแตะ
  t = t.replace(/\b(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{40,}\b/g, '***')
  return t
}

/** ข้อความ error ที่ปลอดภัย: ไม่มี stack, ซ่อนความลับ, ≤ 300 ตัวอักษร */
export function safeError(e: unknown): string {
  let msg = ''
  if (e instanceof Error) msg = e.message
  else if (typeof e === 'string') msg = e
  else if (e && typeof e === 'object') {
    const o = e as { message?: unknown; error?: unknown }
    if (typeof o.message === 'string') msg = o.message
    else if (typeof o.error === 'string') msg = o.error
    else {
      try { msg = JSON.stringify(redact(e)) } catch { msg = 'unknown error' }
    }
  } else if (e !== undefined && e !== null) msg = String(e)
  msg = redactText(msg).replace(/\s+/g, ' ').trim()
  return (msg || 'unknown error').slice(0, 300)
}

/** console.error ผ่านการตัดความลับเท่านั้น (ห้ามใช้ console.* ตรงๆ กับข้อมูลแพลตฟอร์ม) */
export function logError(tag: string, e: unknown, detail?: unknown): void {
  let extra = ''
  if (detail !== undefined) {
    try { extra = ' ' + JSON.stringify(redact(detail)).slice(0, 2000) } catch { extra = '' }
  }
  console.error(`[integrations] ${String(tag).slice(0, 80)}: ${safeError(e)}${extra}`)
}
