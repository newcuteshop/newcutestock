// lib/integrations/crypto.ts — เข้ารหัสคีย์/โทเคนของร้านก่อนเก็บ (AES-256-GCM) + ตัวช่วย HMAC / สุ่ม / เทียบแบบเวลาคงที่
// ฝั่งเซิร์ฟเวอร์เท่านั้น (ใช้ node:crypto) — ห้าม import ในไฟล์ 'use client'
//
// กุญแจ: env INTEGRATIONS_ENC_KEY = base64 ของไบต์สุ่ม 32 ไบต์ (สร้างด้วย: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
//   INTEGRATIONS_ENC_KEY_VERSION (ค่าเริ่มต้น 1) ถูกเขียนลง key_version ของทุกแถว
//   เปลี่ยนกุญแจ: ย้ายกุญแจเดิมไปไว้ที่ INTEGRATIONS_ENC_KEY_PREVIOUS (+ _PREVIOUS_VERSION) แล้วใส่กุญแจใหม่ + เลขรุ่นใหม่
//   → ถอดรหัสแถวเก่าได้ และทุกครั้งที่บันทึกใหม่จะเข้ารหัสด้วยกุญแจใหม่เสมอ
// ทุกค่าผูกกับ AAD "<channel_id>:<name>" — ย้ายแถวไปช่องทาง/ชื่ออื่นจะถอดรหัสไม่ผ่าน
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const ENC_KEY_MISSING_MESSAGE = 'ยังไม่ได้ตั้งค่า INTEGRATIONS_ENC_KEY บน Vercel'

/** ข้อผิดพลาดเรื่องการตั้งค่า (ข้อความภาษาไทย แสดงให้แอดมินเห็นได้) */
export class IntegrationConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntegrationConfigError'
  }
}

interface KeyEntry { version: number; key: Buffer }
export interface Keyring { current: KeyEntry; previous?: KeyEntry }

function parseKey(raw: string | undefined): Buffer | null {
  if (!raw) return null
  const text = raw.trim()
  if (!text) return null
  // รับได้ทั้ง base64 และ base64url
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(text)) return null
  const buf = Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  return buf.length === 32 ? buf : null
}

function parseVersion(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined || raw.trim() === '') return fallback
  if (!/^[0-9]{1,5}$/.test(raw.trim())) return null
  const n = Number(raw.trim())
  return n >= 1 && n <= 32767 ? n : null
}

/** กุญแจปัจจุบัน (+ กุญแจเก่าระหว่างเปลี่ยนกุญแจ) — ไม่ได้ตั้ง/ผิดรูปแบบ = โยนข้อความภาษาไทย */
export function getKeyring(): Keyring {
  const key = parseKey(process.env.INTEGRATIONS_ENC_KEY)
  const version = parseVersion(process.env.INTEGRATIONS_ENC_KEY_VERSION, 1)
  if (!key || version === null) throw new IntegrationConfigError(ENC_KEY_MISSING_MESSAGE)
  const ring: Keyring = { current: { version, key } }
  const prevKey = parseKey(process.env.INTEGRATIONS_ENC_KEY_PREVIOUS)
  if (prevKey) {
    const prevVersion = parseVersion(process.env.INTEGRATIONS_ENC_KEY_PREVIOUS_VERSION, version - 1)
    if (prevVersion !== null && prevVersion >= 1 && prevVersion !== version) {
      ring.previous = { version: prevVersion, key: prevKey }
    }
  }
  return ring
}

/** ตั้งค่ากุญแจไว้ถูกต้องไหม (ไม่โยน error — ให้หน้าตั้งค่าแสดงคำเตือน) */
export function encKeyConfigured(): boolean {
  try {
    getKeyring()
    return true
  } catch {
    return false
  }
}

export function credentialAad(channelId: string, name: string): string {
  return `${channelId}:${name}`
}

export interface EncryptedSecret { ciphertext: string; iv: string; tag: string; key_version: number }

export function encryptSecret(plain: string, aad: string): EncryptedSecret {
  const { current } = getKeyring()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', current.key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(String(plain), 'utf8')), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    key_version: current.version,
  }
}

const DECRYPT_FAILED = 'ถอดรหัสคีย์ที่บันทึกไว้ไม่สำเร็จ (กุญแจ INTEGRATIONS_ENC_KEY ไม่ตรง หรือข้อมูลถูกแก้ไข) — กรุณาบันทึกคีย์ใหม่'

export function decryptSecret(
  row: { ciphertext: string; iv: string; tag: string; key_version: number },
  aad: string,
): string {
  const ring = getKeyring()
  const version = Number(row.key_version)
  const entry = ring.current.version === version ? ring.current
    : ring.previous && ring.previous.version === version ? ring.previous
    : null
  if (!entry) throw new IntegrationConfigError(DECRYPT_FAILED)
  const iv = Buffer.from(String(row.iv ?? ''), 'base64')
  const tag = Buffer.from(String(row.tag ?? ''), 'base64')
  if (iv.length !== 12 || tag.length !== 16) throw new IntegrationConfigError(DECRYPT_FAILED)
  try {
    const decipher = createDecipheriv('aes-256-gcm', entry.key, iv)
    decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(Buffer.from(String(row.ciphertext ?? ''), 'base64')), decipher.final()])
    return plain.toString('utf8')
  } catch {
    throw new IntegrationConfigError(DECRYPT_FAILED)
  }
}

/** คำใบ้ที่แอดมินเห็น: ค่าลับ = '•••• ' + 4 ตัวท้าย (สั้นกว่า 8 ตัว = '••••'), ค่าไม่ลับ = ค่าเต็ม (≤ 80 ตัว) */
export function maskHint(value: string, secret: boolean): string {
  const v = String(value ?? '')
  if (secret) return v.length < 8 ? '••••' : '•••• ' + v.slice(-4)
  return v.slice(0, 80)
}

/** โทเคนสุ่ม base64url (ค่าเริ่มต้น 32 ไบต์ = 43 ตัวอักษร) */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

export function hmacSha256(key: string | Buffer, msg: string | Buffer, enc: 'hex' | 'base64'): string {
  const h = createHmac('sha256', typeof key === 'string' ? Buffer.from(key, 'utf8') : key)
  h.update(typeof msg === 'string' ? Buffer.from(msg, 'utf8') : msg)
  return h.digest(enc)
}

/** เทียบข้อความแบบเวลาคงที่ (ความยาวต่างกันก็ไม่รั่วเวลา — เทียบ sha256 ของทั้งสองฝั่ง) */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = createHash('sha256').update(String(a ?? ''), 'utf8').digest()
  const hb = createHash('sha256').update(String(b ?? ''), 'utf8').digest()
  const same = timingSafeEqual(ha, hb)
  return same && String(a ?? '').length === String(b ?? '').length
}
