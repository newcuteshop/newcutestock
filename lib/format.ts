// ===== ตัวช่วยจัดรูปแบบข้อความ / เงิน / วันเวลา =====
// pure functions ล้วน (ไม่แตะ window/document) — ใช้ได้ทั้ง server component, server action และ client

type VariantLike = { size?: string | null; color?: string | null }

/** ไซส์ · สี เช่น 'M · ขาว' | 'M' | 'ขาว' | '' */
export function variantText(p: VariantLike): string {
  const parts: string[] = []
  const size = p.size == null ? '' : String(p.size).trim()
  const color = p.color == null ? '' : String(p.color).trim()
  if (size) parts.push(size)
  if (color) parts.push(color)
  return parts.join(' · ')
}

/** ชื่อสินค้าพร้อมตัวเลือก เช่น 'เสื้อยืด · M · ขาว' */
export function productLabel(p: { name: string } & VariantLike): string {
  const name = p.name == null ? '' : String(p.name).trim()
  const variant = variantText(p)
  if (!variant) return name
  return name ? `${name} · ${variant}` : variant
}

// ===== เงิน =====
const bahtFormatter = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 })

/** '฿1,234' / '฿1,234.5' / '-฿50' ; null หรือ NaN -> '฿0' */
export function baht(n: number | null | undefined): string {
  if (n === null || n === undefined) return '฿0'
  const v = Number(n) // กันกรณีฐานข้อมูลส่ง numeric มาเป็นสตริง
  if (!Number.isFinite(v)) return '฿0'
  const text = bahtFormatter.format(Math.abs(v))
  if (text === '0') return '฿0'
  return v < 0 ? `-฿${text}` : `฿${text}`
}

// ===== ข้อผิดพลาด -> ข้อความภาษาไทย =====
const MSG_GENERIC = 'เกิดข้อผิดพลาด'
const MSG_DUPLICATE = 'ข้อมูลซ้ำ: SKU หรือบาร์โค้ดนี้มีอยู่แล้ว'
const MSG_FK = 'ลบไม่ได้ เพราะมีประวัติการขายอ้างอิงอยู่ — ให้กด "ปิดใช้งาน" แทน'
const MSG_NO_PERMISSION = 'ไม่มีสิทธิ์ทำรายการนี้'
const MSG_NETWORK = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'
const MSG_LOGIN = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'
const MSG_SESSION = 'หมดเวลาเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่'
// 23514 = ไม่ผ่าน check constraint (แบบ NOT VALID ถูกตรวจทุกครั้งที่แก้แถว แม้แก้แค่ชื่อหรือเปิด/ปิดใช้งาน)
const MSG_NEGATIVE_STOCK = 'สต๊อกสินค้านี้ติดลบค้างจากระบบเก่า — ไปที่เมนู รับ-จ่ายสต๊อก กด "ปรับยอด" ให้ตรงกับของจริงก่อน แล้วค่อยแก้ไขหรือปิดใช้งานสินค้า'
const MSG_NEGATIVE_VALUE = 'บันทึกไม่ได้: ราคาทุน ราคาขาย และสต๊อกขั้นต่ำต้องไม่ติดลบ — ถ้าสินค้านี้มีค่าติดลบค้างจากระบบเก่า ให้แก้ค่านั้นในหน้าแก้ไขสินค้าก่อน'
const MSG_CHECK = 'ข้อมูลไม่ถูกต้อง: มีค่าที่ไม่ผ่านเงื่อนไขของระบบ'

const THAI_RE = /[฀-๿]/

const NETWORK_RE = /failed to fetch|fetch failed|networkerror|network request failed|network error|(?:^|typeerror:\s*)load failed|econnrefused|econnreset|enotfound|etimedout|err_internet_disconnected/i
const SESSION_RE = /jwt expired|invalid jwt|refresh token not found|invalid refresh token|auth session missing/i

/** แปลง error ทุกแบบ (PostgrestError, AuthError, Error, string, null) เป็นข้อความภาษาไทยที่ผู้ใช้อ่านเข้าใจ */
export function thaiError(err: unknown): string {
  if (err === null || err === undefined) return MSG_GENERIC

  let code = ''
  let message = ''
  let details = ''
  let name = ''

  if (typeof err === 'string') {
    message = err
  } else if (typeof err === 'object') {
    const e = err as { code?: unknown; message?: unknown; details?: unknown; name?: unknown; error_description?: unknown }
    code = e.code === null || e.code === undefined ? '' : String(e.code)
    if (typeof e.message === 'string') message = e.message
    else if (typeof e.error_description === 'string') message = e.error_description
    if (typeof e.details === 'string') details = e.details
    if (typeof e.name === 'string') name = e.name
  } else {
    message = String(err)
  }

  const text = `${message} ${details}`

  // ตัดสินจากรหัส Postgres ก่อน
  if (code === '23505') return MSG_DUPLICATE
  if (code === '23503') return MSG_FK
  if (code === '42501') return MSG_NO_PERMISSION
  if (code === 'P0001') return message.trim() || MSG_GENERIC // ข้อความไทยจาก RPC ใช้ตามเดิม
  if (code === '23514') {
    if (THAI_RE.test(message)) return message.trim() // ข้อความไทยจาก trigger ในฐานข้อมูล
    if (/stock_qty/i.test(text)) return MSG_NEGATIVE_STOCK
    if (/price|min_stock/i.test(text)) return MSG_NEGATIVE_VALUE
    return MSG_CHECK
  }

  if (/permission denied|row-level security|row level security/i.test(text)) return MSG_NO_PERMISSION
  if (name === 'AuthRetryableFetchError' || NETWORK_RE.test(text)) return MSG_NETWORK
  if (/invalid login credentials/i.test(text)) return MSG_LOGIN
  if (SESSION_RE.test(text)) return MSG_SESSION

  return message.trim() || MSG_GENERIC
}

// ===== วันเวลา (โซน Asia/Bangkok) =====
const TZ = 'Asia/Bangkok'

// ใช้ formatToParts แล้วประกอบเอง เพื่อให้ server (Node) กับ browser ได้ผลเหมือนกันทุกตัวอักษร
const thaiDateTimeFormatter = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  numberingSystem: 'latn',
})

const ymdFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  calendar: 'gregory',
  numberingSystem: 'latn',
})

function toDate(v: string | Date | null | undefined): Date | null {
  if (v === null || v === undefined || v === '') return null
  const d = v instanceof Date ? new Date(v.getTime()) : new Date(v)
  return isNaN(d.getTime()) ? null : d
}

function partsOf(formatter: Intl.DateTimeFormat, d: Date): Record<string, string> {
  const out: Record<string, string> = {}
  const parts = formatter.formatToParts(d)
  for (let i = 0; i < parts.length; i++) out[parts[i].type] = parts[i].value
  return out
}

// เผื่อ engine คืนเลขไทย ๐-๙ มา
function asciiDigits(s: string | undefined): string {
  if (!s) return ''
  return s.replace(/[๐-๙]/g, ch => String(ch.charCodeAt(0) - 0x0e50)).replace(/\D/g, '')
}

function pad2(s: string | undefined): string {
  const d = asciiDigits(s)
  return d.length >= 2 ? d.slice(-2) : ('00' + d).slice(-2)
}

/** 'YYYY-MM-DD' (ค.ศ.) ของเวลานั้นตามปฏิทินเวลาไทย ; ค่าไม่ถูกต้อง -> '' */
export function bangkokDateKey(iso: string | Date): string {
  const d = toDate(iso)
  if (!d) return ''
  const p = partsOf(ymdFormatter, d)
  const year = asciiDigits(p.year)
  if (!year) return ''
  return `${('0000' + year).slice(-4)}-${pad2(p.month)}-${pad2(p.day)}`
}

/** เวลาเริ่มวัน (00:00 น. เวลาไทย) ของวันนั้น เช่น '2026-09-28T00:00:00+07:00' */
export function bangkokDayStartISO(date?: Date): string {
  const d = toDate(date ?? null) ?? new Date()
  return `${bangkokDateKey(d)}T00:00:00+07:00`
}

/** 'dd/MM/yyyy HH:mm' เวลาไทย ปี พ.ศ. ; ค่าไม่ถูกต้อง -> '-' */
export function formatThaiDateTime(iso: string | Date | null | undefined): string {
  const d = toDate(iso)
  if (!d) return '-'
  const p = partsOf(thaiDateTimeFormatter, d)
  let year = parseInt(asciiDigits(p.year), 10)
  if (!Number.isFinite(year)) return '-'
  if (year < 2400) year += 543 // engine ที่ไม่มีปฏิทินพุทธจะคืนปี ค.ศ.
  let hour = pad2(p.hour)
  if (hour === '24') hour = '00'
  return `${pad2(p.day)}/${pad2(p.month)}/${year} ${hour}:${pad2(p.minute)}`
}
