// lib/integrations/errors.ts — ชนิด error ที่ adapter / worker / route ใช้ร่วมกัน (ฝั่งเซิร์ฟเวอร์เท่านั้น)
// ข้อความใน PlatformError / DbError เป็นภาษาไทยที่ "ปลอดภัย" (ไม่มีคีย์ โทเคน ลายเซ็น URL เต็ม หรือข้อมูลผู้ซื้อ)

export type PlatformErrorKind =
  | 'auth'         // คีย์/โทเคนใช้ไม่ได้ (401/403) — แอดมินต้องแก้คีย์
  | 'reauth'       // ต้องให้ร้านกด "เชื่อมต่อร้าน" ใหม่ (refresh token ใช้ไม่ได้/การอนุญาตหมดอายุ)
  | 'rate_limit'   // 429 / โดนจำกัดความถี่
  | 'network'      // เชื่อมต่อไม่ได้
  | 'timeout'
  | 'server'       // 5xx
  | 'not_found'    // รหัสบนแพลตฟอร์มไม่มีแล้ว (ห้ามเดา/ยิงซ้ำ)
  | 'validation'   // แพลตฟอร์มปฏิเสธข้อมูล (แก้ที่ข้อมูล ไม่ใช่รอ)
  | 'blocked'      // ถูกกันโดยเราเอง (host ไม่อยู่ใน allowlist, redirect)
  | 'config'       // ยังไม่ได้ตั้งค่า (คีย์/ENV)
  | 'unsupported'  // รอบนี้ยังไม่รองรับ

const PERMANENT: ReadonlySet<PlatformErrorKind> = new Set<PlatformErrorKind>(['not_found', 'validation', 'blocked', 'config', 'unsupported'])

export class PlatformError extends Error {
  readonly kind: PlatformErrorKind
  readonly status?: number
  readonly retryAfterSeconds?: number
  readonly permanent: boolean
  readonly platformCode?: string

  constructor(
    kind: PlatformErrorKind,
    message: string,
    opts: { status?: number; retryAfterSeconds?: number; permanent?: boolean; platformCode?: string } = {},
  ) {
    super(message)
    this.name = 'PlatformError'
    this.kind = kind
    this.status = opts.status
    this.retryAfterSeconds = opts.retryAfterSeconds
    this.permanent = opts.permanent ?? PERMANENT.has(kind)
    this.platformCode = opts.platformCode
  }
}

export function isPlatformError(e: unknown): e is PlatformError {
  return e instanceof Error && e.name === 'PlatformError' && typeof (e as PlatformError).kind === 'string'
}

/** error จากฐานข้อมูล (RPC) — message เป็นภาษาไทยจากฐานข้อมูล / code = SQLSTATE */
export class DbError extends Error {
  readonly code: string
  readonly retryable: boolean
  constructor(message: string, code: string, retryable: boolean) {
    super(message)
    this.name = 'DbError'
    this.code = code
    this.retryable = retryable
  }
}

export function isDbError(e: unknown): e is DbError {
  return e instanceof Error && e.name === 'DbError' && typeof (e as DbError).code === 'string'
}

/** error ที่ควรลองใหม่ภายหลัง (เครือข่าย / 5xx / 429 / deadlock) */
export function isRetryable(e: unknown): boolean {
  if (isPlatformError(e)) return !e.permanent
  if (isDbError(e)) return e.retryable
  return true
}

/** status_reason ของช่องทางตาม error (CONTRACT §2.3) */
export function statusReasonFor(e: unknown): string {
  if (isPlatformError(e)) {
    if (e.kind === 'auth') return 'credentials_invalid'
    if (e.kind === 'reauth') return 'needs_reauth'
    if (e.kind === 'rate_limit') return 'rate_limited'
    if (e.kind === 'config') return 'awaiting_credentials'
  }
  return 'platform_error'
}
