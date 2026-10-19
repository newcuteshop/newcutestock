// ===== หน้าจองออนไลน์: รายการจอง (ตะกร้า) ของลูกค้า =====
// เก็บในเครื่องลูกค้า localStorage คีย์ 'book-cart-v1' (ปิดแอป LINE แล้วเปิดลิงก์ใหม่ รายการยังอยู่)
// - อ่านกลับมาทุกครั้งต้องตรวจรูปร่างใหม่ (ข้อมูลในเครื่องแก้ได้ / รุ่นเก่า) — แถวที่ผิดรูปถูกตัดทิ้ง
// - เบราว์เซอร์ที่ใช้ storage ไม่ได้ (โหมดส่วนตัว / ปิดไว้) → เก็บในหน่วยความจำแทน (เปลี่ยนหน้าในเว็บยังอยู่ ปิดแท็บแล้วหาย)
// - ทุกชุดในคำขอเดียวกันใช้ "วันรับ–วันคืน" เดียวกัน (การจอง 1 ใบมีช่วงวันเดียว) → วันที่เก็บที่ตัวตะกร้า ไม่ใช่ที่แต่ละแถว
// - client_id = รหัสคำขอสำหรับส่งซ้ำ: สร้างตอนกดส่งครั้งแรก เก็บไว้จนส่งสำเร็จ (เน็ตหลุดแล้วกดใหม่ → ไม่เกิดคำขอซ้ำ)
//   ไม่ล้างเมื่อลูกค้าแก้ตะกร้า: ถ้าครั้งก่อนบันทึกไม่สำเร็จแน่ชัด รหัสเดิมก็ยังใหม่สำหรับฐานข้อมูล
//   แต่ถ้าครั้งก่อน "เน็ตหลุดแต่บันทึกไปแล้ว" รหัสเดิมทำให้ได้คำขอเดิมกลับมา แทนการจองซ้อนเป็นใบที่สอง
//   client_sigs = ลายเซ็น (ชุด/วัน/เบอร์) ที่เคยส่งด้วยรหัสนี้ → ได้คำขอเดิมกลับมาทั้งที่ตะกร้าเปลี่ยนแล้ว
//   = คำขอนั้นอาจไม่มีชุดที่เพิ่มทีหลัง → ห้ามล้างตะกร้า (หน้าส่งคำขอบอกลูกค้าแทน)
// ราคาในตะกร้าใช้แสดงประมาณการเท่านั้น — ราคา/มัดจำจริงฐานข้อมูลคำนวณเองตอนส่งคำขอ
// ใช้ในคอมโพเนนต์ฝั่งเบราว์เซอร์เท่านั้น (ฝั่งเซิร์ฟเวอร์ได้ตะกร้าว่างเสมอ)
import { useSyncExternalStore } from 'react'
import { isDayKey } from '@/lib/format'
import { num, round2 } from '@/lib/money'
import { newUuid } from '@/lib/products'
import { MAX_PUBLIC_LINES, MAX_RENTAL_DAYS, MAX_RENTAL_MONEY, type RentalSize } from '@/lib/rental'

export const CART_KEY = 'book-cart-v1'

export interface CartLine {
  /** รหัสแถวในตะกร้า (ชุดเดียวกันไซส์เดียวกันจองได้หลายตัว เช่น ชุดเพื่อนเจ้าสาว) */
  key: string
  item_id: string
  code: string
  name: string
  size: RentalSize
  cover_path: string | null
  base_price: number
  base_days: number
  extra_day_price: number
  security_deposit: number
}

export interface BookCart {
  v: 1
  pickup: string | null
  ret: string | null
  lines: CartLine[]
  client_id: string | null
  client_sigs: string[]
}

const MAX_SIGS = 5
const EMPTY: BookCart = Object.freeze({ v: 1, pickup: null, ret: null, lines: [], client_id: null, client_sigs: [] }) as BookCart

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s && s.length <= max ? s : null
}

function moneyIn(v: unknown): number {
  const n = round2(num(v))
  return n < 0 || n > MAX_RENTAL_MONEY ? 0 : n
}

function lineOf(raw: unknown): CartLine | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const itemId = typeof o.item_id === 'string' && UUID_RE.test(o.item_id) ? o.item_id.toLowerCase() : null
  const code = str(o.code, 60)
  const name = str(o.name, 200)
  if (!itemId || !code || !name) return null
  // ไซส์: null/ว่าง = ฟรีไซส์ · ยาวเกิน 20 = ผิดรูป
  let size: RentalSize = null
  if (typeof o.size === 'string' && o.size.trim()) {
    if (o.size.trim().length > 20) return null
    size = o.size.trim()
  } else if (o.size !== null && o.size !== undefined && o.size !== '') {
    return null
  }
  const baseDays = Math.trunc(num(o.base_days))
  return {
    key: typeof o.key === 'string' && o.key.length <= 64 && o.key ? o.key : newUuid(),
    item_id: itemId,
    code,
    name,
    size,
    cover_path: str(o.cover_path, 300),
    base_price: moneyIn(o.base_price),
    base_days: baseDays >= 1 && baseDays <= MAX_RENTAL_DAYS ? baseDays : 1,
    extra_day_price: moneyIn(o.extra_day_price),
    security_deposit: moneyIn(o.security_deposit),
  }
}

/** ตรวจ/ทำความสะอาดตะกร้าที่อ่านจากเครื่อง — ผิดรูปทั้งก้อน = ตะกร้าว่าง */
export function validateCart(raw: unknown): BookCart {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY
  const o = raw as Record<string, unknown>
  if (o.v !== 1) return EMPTY
  const lines: CartLine[] = []
  const seen = new Set<string>()
  if (Array.isArray(o.lines)) {
    for (const r of o.lines) {
      if (lines.length >= MAX_PUBLIC_LINES) break
      const l = lineOf(r)
      if (!l || seen.has(l.key)) continue
      seen.add(l.key)
      lines.push(l)
    }
  }
  let pickup = isDayKey(o.pickup) ? o.pickup : null
  let ret = isDayKey(o.ret) ? o.ret : null
  if (!pickup || !ret || ret < pickup) {
    pickup = null
    ret = null
  }
  const clientId = typeof o.client_id === 'string' && UUID_RE.test(o.client_id) ? o.client_id.toLowerCase() : null
  const sigs = clientId && Array.isArray(o.client_sigs)
    ? (o.client_sigs as unknown[]).filter((x): x is string => typeof x === 'string' && x.length <= 2000).slice(-MAX_SIGS)
    : []
  return { v: 1, pickup, ret, lines, client_id: clientId, client_sigs: sigs }
}

// ---------------------------------------------------------------------------
// ที่เก็บกลาง (ทุกคอมโพเนนต์ในหน้าเห็นตะกร้าเดียวกัน)
// ---------------------------------------------------------------------------
let state: BookCart = EMPTY
let loaded = false
const listeners = new Set<() => void>()

function readStorage(): BookCart {
  try {
    const text = window.localStorage.getItem(CART_KEY)
    if (!text) return EMPTY
    return validateCart(JSON.parse(text))
  } catch {
    return EMPTY
  }
}

function ensureLoaded() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  state = readStorage()
  // แท็บอื่นแก้ตะกร้า → หน้านี้เห็นตาม
  window.addEventListener('storage', e => {
    if (e.key !== CART_KEY) return
    state = readStorage()
    emit()
  })
}

function emit() {
  listeners.forEach(fn => fn())
}

function commit(next: BookCart) {
  state = next
  try {
    if (next.lines.length === 0 && !next.pickup && !next.client_id) window.localStorage.removeItem(CART_KEY)
    else window.localStorage.setItem(CART_KEY, JSON.stringify(next))
  } catch {
    // เก็บลงเครื่องไม่ได้ → ใช้ในหน่วยความจำต่อ (ปิดแท็บแล้วหาย)
  }
  emit()
}

function subscribe(fn: () => void): () => void {
  ensureLoaded()
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** ตะกร้าปัจจุบัน (ฝั่งเซิร์ฟเวอร์ = ว่าง) */
export function getCart(): BookCart {
  ensureLoaded()
  return state
}

const serverSnapshot = () => EMPTY

/** ใช้ในคอมโพเนนต์: ตะกร้าล่าสุด (render ครั้งแรกตอน hydrate = ว่าง แล้วค่อยเป็นของจริง → ไม่เกิด hydration mismatch) */
export function useBookCart(): BookCart {
  return useSyncExternalStore(subscribe, getCart, serverSnapshot)
}

// ---------------------------------------------------------------------------
// คำสั่งแก้ตะกร้า
// ---------------------------------------------------------------------------
export type AddLineResult = { ok: true; count: number } | { ok: false; message: string }

/** เพิ่มชุด 1 ตัว พร้อมตั้งวันรับ–คืนของทั้งคำขอ (ผู้เรียกถามลูกค้าก่อนแล้วถ้าวันต่างจากเดิม) */
export function addCartLine(line: Omit<CartLine, 'key'>, pickup: string, ret: string): AddLineResult {
  const cur = getCart()
  if (cur.lines.length >= MAX_PUBLIC_LINES) {
    return { ok: false, message: `ส่งคำขอได้ครั้งละไม่เกิน ${MAX_PUBLIC_LINES} ชุด — ส่งคำขอนี้ก่อน แล้วค่อยจองชุดที่เหลือเพิ่ม` }
  }
  const clean = lineOf({ ...line, key: newUuid() })
  if (!clean) return { ok: false, message: 'ข้อมูลชุดไม่ครบ กรุณาโหลดหน้าใหม่' }
  commit({ ...cur, pickup, ret, lines: [...cur.lines, clean] })
  return { ok: true, count: cur.lines.length + 1 }
}

export function removeCartLine(key: string) {
  const cur = getCart()
  const lines = cur.lines.filter(l => l.key !== key)
  commit({ ...cur, lines })
}

export function setCartDates(pickup: string | null, ret: string | null) {
  const cur = getCart()
  if (cur.pickup === pickup && cur.ret === ret) return
  commit({ ...cur, pickup, ret })
}

/** รหัสคำขอสำหรับการกดส่ง (มีอยู่แล้วใช้ตัวเดิม ไม่มีสร้างใหม่แล้วบันทึกลงเครื่องก่อนส่ง) */
export function ensureCartClientId(): string {
  const cur = getCart()
  if (cur.client_id) return cur.client_id
  const id = newUuid()
  commit({ ...cur, client_id: id, client_sigs: [] })
  return id
}

/**
 * เริ่มส่งคำขอ: รหัสคำขอ (เดิม/ใหม่) + จดลายเซ็นของสิ่งที่ส่ง
 * retryOfSame = ทุกครั้งที่เคยส่งด้วยรหัสนี้เป็นข้อมูลชุดเดียวกับครั้งนี้ (ได้คำขอเดิมกลับมา = ของตะกร้านี้จริง)
 */
export function beginCartSend(sig: string): { clientId: string; retryOfSame: boolean } {
  const cur = getCart()
  const clientId = cur.client_id ?? newUuid()
  const before = cur.client_id ? cur.client_sigs : []
  const retryOfSame = before.length > 0 && before.every(s => s === sig)
  const sigs = before.includes(sig) ? before : [...before, sig].slice(-MAX_SIGS)
  commit({ ...cur, client_id: clientId, client_sigs: sigs })
  return { clientId, retryOfSame }
}

/**
 * ทิ้งรหัสคำขอเดิม (ครั้งหน้ากดส่ง = รหัสใหม่) — ใช้เฉพาะเมื่อฐานข้อมูลตอบชัดว่ารหัสนี้ผูกกับการจองอื่นแล้ว
 * (ส่งสำเร็จด้วยเบอร์หนึ่ง แล้วลูกค้าแก้เบอร์) ไม่งั้นรหัสที่ค้างในเครื่องทำให้ส่งไม่ได้ตลอดแม้โหลดหน้าใหม่
 */
export function resetCartClientId() {
  const cur = getCart()
  if (cur.client_id) commit({ ...cur, client_id: null, client_sigs: [] })
}

/** ส่งคำขอสำเร็จ → ล้างตะกร้าทั้งหมด (รวม client_id) */
export function clearCart() {
  commit({ v: 1, pickup: null, ret: null, lines: [], client_id: null, client_sigs: [] })
}

// ---------------------------------------------------------------------------
// การจองล่าสุดของเครื่องนี้ (ลูกค้าเปิดลิงก์จาก LINE แล้วปิดไป ยังกลับมาดูสถานะ/ส่งสลิปได้จากหน้าแรก)
// เก็บเฉพาะเลขที่การจอง + โทเคนลิงก์สถานะ (ไม่มีชื่อ/เบอร์ลูกค้า) ไม่เกิน 5 รายการล่าสุด
// ---------------------------------------------------------------------------
export const RECENT_KEY = 'book-recent-v1'
const MAX_RECENT = 5
const TOKEN_RE = /^[0-9a-f]{64}$/

export interface RecentBooking {
  booking_no: string
  token: string
  saved_at: number
}

function readRecent(): RecentBooking[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    const out: RecentBooking[] = []
    for (const r of raw) {
      if (!r || typeof r !== 'object') continue
      const o = r as Record<string, unknown>
      const no = typeof o.booking_no === 'string' ? o.booking_no.trim().slice(0, 40) : ''
      const token = typeof o.token === 'string' && TOKEN_RE.test(o.token) ? o.token : ''
      const at = typeof o.saved_at === 'number' && Number.isFinite(o.saved_at) ? o.saved_at : 0
      if (no && token && !out.some(x => x.token === token)) out.push({ booking_no: no, token, saved_at: at })
      if (out.length >= MAX_RECENT) break
    }
    return out
  } catch {
    return []
  }
}

/** จำการจองที่เพิ่งส่ง (ใหม่สุดอยู่บน) — เก็บไม่ได้ก็ข้ามไป */
export function rememberBooking(bookingNo: string, token: string) {
  if (typeof window === 'undefined' || !TOKEN_RE.test(token)) return
  try {
    const list = [{ booking_no: bookingNo, token, saved_at: Date.now() }, ...readRecent().filter(r => r.token !== token)].slice(0, MAX_RECENT)
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    // เก็บไม่ได้ — ลูกค้ายังมีลิงก์ในหน้าสถานะ
  }
}

/** ลืมการจอง (เช่น ลิงก์ใช้ไม่ได้แล้ว) */
export function forgetBooking(token: string) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(readRecent().filter(r => r.token !== token)))
  } catch {
    // ไม่เป็นไร
  }
}

/** อ่านรายการการจองล่าสุด (ฝั่งเซิร์ฟเวอร์/ตอน hydrate = ว่าง) */
export function loadRecentBookings(): RecentBooking[] {
  if (typeof window === 'undefined') return []
  return readRecent()
}
