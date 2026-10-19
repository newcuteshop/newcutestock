// ===== ฟอร์มชุดเช่า (แบบชุด + ชิ้นจริง): สถานะฟอร์ม / ตรวจข้อมูล / สร้างข้อมูลส่ง rental_save_item =====
// pure functions ล้วน (ไม่มี React / ไม่แตะ window) — ItemEditor.tsx เรียกใช้
//
// กติกาฝั่งฐานข้อมูล (supabase-fix-05-rental.sql rental_save_item) ที่ฟอร์มนี้ตรวจซ้ำก่อนส่ง เพื่อบอกผู้ใช้ทันที:
//   รหัสชุด ASCII ไม่มีช่องว่าง 1-30 ตัว (ไม่ซ้ำ) · ชื่อ 1-150 · สี ≤60 · รายละเอียด ≤3000 · แท็ก ≤20 อัน อันละ ≤30
//   เงินทุกช่อง 0..99,999,999.99 · วันเช่าพื้นฐาน 1-60 · วันกันก่อน/หลัง 0-14 หรือว่าง (= ตามตั้งค่าร้าน)
//   ชิ้น ≤200 ชิ้น · รหัสชิ้น ASCII ไม่มีช่องว่าง 1-40 ตัว (ว่าง = ระบบตั้งให้ '<รหัสชุด>-NN') · ไซส์ ≤20 · หมายเหตุ ≤500
//
// ชิ้นเดิมส่งเฉพาะช่องที่ผู้ใช้แก้ (id + ช่องที่เปลี่ยน) — ช่องที่ไม่ส่ง ฐานข้อมูลคงค่าปัจจุบันไว้
//   เหตุผล: สถานะชิ้นเปลี่ยนได้จากที่อื่นโดยไม่ทำให้เวอร์ชันของแบบชุดเปลี่ยน (รับคืนชุดที่หาย → เลิกใช้, ผู้จัดการตั้งส่งซ่อม)
//   ถ้าส่งค่าทั้งแถวจากฟอร์มที่เปิดค้างไว้ จะไปทับสถานะล่าสุดนั้นโดยไม่รู้ตัว
// ชิ้นที่หายไปจากรายการ = ลบ (ฐานข้อมูลยอมเฉพาะชิ้นที่ไม่เคยถูกจอง)

import { parseMoneyInput, round2 } from '@/lib/money'
import { cleanText, compareSizes, hasInvisibleChars } from '@/lib/products'
import {
  MAX_RENTAL_DAYS, MAX_RENTAL_MONEY,
  type RentalItem, type RentalSettings, type RentalUnit, type RentalUnitStatus,
} from '@/lib/rental'

export const MAX_ITEM_CODE = 30
export const MAX_ITEM_NAME = 150
export const MAX_ITEM_COLOR = 60
export const MAX_ITEM_DESCRIPTION = 3000
export const MAX_TAGS = 20
export const MAX_TAG_LEN = 30
export const MAX_UNITS = 200
export const MAX_UNIT_CODE = 40
export const MAX_UNIT_SIZE = 20
export const MAX_UNIT_NOTE = 500
export const MAX_BUFFER_DAYS = 14
export const MAX_ITEM_IMAGES = 20
export const MAX_QUICK_ADD = 50

/** ไซส์ที่ใช้บ่อย (ปุ่มลัดตอนเพิ่มชิ้น) — '' = ฟรีไซส์ */
export const QUICK_SIZES: readonly string[] = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '']

// รหัส: ASCII พิมพ์ได้ ไม่มีช่องว่าง (ตรงกับ check ในฐานข้อมูล ^[!-~]{1,n}$)
const CODE_RE = /^[!-~]+$/

export interface ItemFormUnit {
  key: string
  id: string | null
  code: string          // ชิ้นใหม่: '' = ให้ระบบตั้งรหัสอัตโนมัติ
  size: string          // '' = ฟรีไซส์
  status: RentalUnitStatus
  note: string
  // ข้อมูลจากฐานข้อมูล (อ่านอย่างเดียว)
  needsCleaning: boolean
  hasHistory: boolean
  nextBooking: { booking_no: string; pickup_date: string } | null
}

export interface ItemFormState {
  code: string
  name: string
  categoryId: string
  color: string
  description: string
  tags: string[]
  basePrice: string
  baseDays: string
  extraDayPrice: string
  securityDeposit: string
  replacementCost: string
  bufferBefore: string   // '' = ตามตั้งค่าร้าน
  bufferAfter: string
  isAccessory: boolean
  isPublic: boolean
  isActive: boolean      // ใช้ตอนสร้างใหม่เท่านั้น (ชุดที่มีแล้วเปิด/ปิดด้วยปุ่มแยก rental_set_item_active)
  units: ItemFormUnit[]
}

export type SaveItemPayload = { p_item: Record<string, unknown>; p_units: Record<string, unknown>[] }

export type ValidateResult =
  | { ok: true; payload: SaveItemPayload; warnings: string[] }
  | { ok: false; fieldId: string; message: string }

let keySeq = 0
export function newUnitKey(): string {
  keySeq += 1
  return `u${Date.now().toString(36)}${keySeq}`
}

function moneyText(n: number): string {
  return String(round2(n))
}

export function unitFromServer(u: RentalUnit): ItemFormUnit {
  return {
    key: `id-${u.id}`,
    id: u.id,
    code: u.unit_code,
    size: u.size ?? '',
    status: u.status,
    note: u.condition_note ?? '',
    needsCleaning: u.needs_cleaning,
    hasHistory: u.has_history,
    nextBooking: u.next_booking,
  }
}

export function newUnitRow(size: string, code = ''): ItemFormUnit {
  return {
    key: newUnitKey(),
    id: null,
    code,
    size,
    status: 'available',
    note: '',
    needsCleaning: false,
    hasHistory: false,
    nextBooking: null,
  }
}

export function emptyItemForm(settings: Pick<RentalSettings, 'default_base_days'>): ItemFormState {
  return {
    code: '',
    name: '',
    categoryId: '',
    color: '',
    description: '',
    tags: [],
    basePrice: '',
    baseDays: String(settings.default_base_days || 3),
    extraDayPrice: '0',
    securityDeposit: '0',
    replacementCost: '0',
    bufferBefore: '',
    bufferAfter: '',
    isAccessory: false,
    isPublic: true,
    isActive: true,
    units: [],
  }
}

export function formFromItem(item: RentalItem): ItemFormState {
  return {
    code: item.code,
    name: item.name,
    categoryId: item.category_id ?? '',
    color: item.color ?? '',
    description: item.description ?? '',
    tags: item.tags.slice(),
    basePrice: moneyText(item.base_price),
    baseDays: String(item.base_days),
    extraDayPrice: moneyText(item.extra_day_price),
    securityDeposit: moneyText(item.security_deposit),
    replacementCost: moneyText(item.replacement_cost),
    bufferBefore: item.buffer_before_days === null ? '' : String(item.buffer_before_days),
    bufferAfter: item.buffer_after_days === null ? '' : String(item.buffer_after_days),
    isAccessory: item.is_accessory,
    isPublic: item.is_public,
    isActive: item.is_active,
    units: sortUnits(item.units.map(unitFromServer)),
  }
}

/** เรียงชิ้นตามไซส์ (ลำดับเดียวกับฐานข้อมูล) แล้วตามรหัส — ชิ้นใหม่ที่ยังไม่มีรหัสต่อท้ายไซส์เดียวกัน */
export function sortUnits(units: ItemFormUnit[]): ItemFormUnit[] {
  return units
    .map((u, i) => ({ u, i }))
    .sort((a, b) => {
      // ฟรีไซส์ ('') ไปท้าย เหมือน product_size_rank (ว่าง = 0 ในตารางสินค้า แต่ชิ้นชุดเช่า null = ฟรีไซส์)
      const fa = cleanText(a.u.size) === '' ? 1 : 0
      const fb = cleanText(b.u.size) === '' ? 1 : 0
      if (fa !== fb) return fa - fb
      const s = compareSizes(cleanText(a.u.size), cleanText(b.u.size))
      if (s !== 0) return s
      const ca = cleanText(a.u.code)
      const cb = cleanText(b.u.code)
      if (!ca !== !cb) return ca ? -1 : 1
      if (ca !== cb) return ca.toLowerCase() < cb.toLowerCase() ? -1 : 1
      return a.i - b.i
    })
    .map(x => x.u)
}

/** ลายเซ็นของฟอร์ม (เทียบว่ามีการแก้ไขที่ยังไม่บันทึกไหม) — ไม่รวมช่องอ่านอย่างเดียวของชิ้น */
export function formSignature(f: ItemFormState): string {
  return JSON.stringify({
    c: cleanText(f.code), n: cleanText(f.name), cat: f.categoryId, col: cleanText(f.color), d: cleanText(f.description),
    t: f.tags.map(cleanText),
    bp: parseMoneyInput(f.basePrice), bd: cleanText(f.baseDays), ex: parseMoneyInput(f.extraDayPrice),
    sd: parseMoneyInput(f.securityDeposit), rc: parseMoneyInput(f.replacementCost),
    bb: cleanText(f.bufferBefore), ba: cleanText(f.bufferAfter),
    acc: f.isAccessory, pub: f.isPublic, act: f.isActive,
    u: f.units.map(u => [u.id, cleanText(u.code), cleanText(u.size), u.status, cleanText(u.note)]),
  })
}

/** ราคาเช่าตามจำนวนวัน (ตัวอย่างบนจอ) จากค่าที่พิมพ์ในฟอร์ม — อ่านไม่ได้ = null */
export function formPrices(f: ItemFormState): { base: number; baseDays: number; extra: number } | null {
  const base = parseMoneyInput(f.basePrice)
  const days = parseInt(cleanText(f.baseDays), 10)
  const extra = parseMoneyInput(f.extraDayPrice || '0')
  if (base === null || base < 0 || !Number.isFinite(days) || days < 1 || days > MAX_RENTAL_DAYS) return null
  return { base, baseDays: days, extra: extra !== null && extra >= 0 ? extra : 0 }
}

// ----- รหัสชุดถัดไป (ปุ่มลัด) -----
/**
 * เดารหัสชุดถัดไปจากรหัสที่มีอยู่: หา prefix ตัวอักษร + เลข ที่ใช้มากที่สุด แล้วบวกเลขท้ายสุด + 1 (คงจำนวนหลัก)
 * เช่น ['D001','D002','A010'] → 'D003' ; ไม่มีรหัสรูปแบบนี้เลย → 'D001'
 */
export function suggestNextCode(existing: readonly string[]): string {
  const groups = new Map<string, { count: number; max: number; width: number; prefix: string }>()
  for (const raw of existing) {
    const m = /^([A-Za-z]{1,10})(\d{1,8})$/.exec(cleanText(raw))
    if (!m) continue
    const key = m[1].toUpperCase()
    const n = parseInt(m[2], 10)
    const g = groups.get(key) ?? { count: 0, max: 0, width: m[2].length, prefix: m[1] }
    g.count += 1
    if (n >= g.max) {
      g.max = n
      g.width = Math.max(g.width, m[2].length)
    }
    groups.set(key, g)
  }
  let best: { count: number; max: number; width: number; prefix: string } | null = null
  for (const g of Array.from(groups.values())) {
    if (!best || g.count > best.count) best = g
  }
  const taken = new Set(existing.map(c => cleanText(c).toLowerCase()))
  if (!best) {
    for (let n = 1; n < 100000; n++) {
      const c = `D${String(n).padStart(3, '0')}`
      if (!taken.has(c.toLowerCase())) return c
    }
    return 'D001'
  }
  for (let n = best.max + 1; n < best.max + 100000; n++) {
    const c = `${best.prefix}${String(n).padStart(best.width, '0')}`
    if (!taken.has(c.toLowerCase())) return c.slice(0, MAX_ITEM_CODE)
  }
  return `${best.prefix}${best.max + 1}`
}

/** ตัวอย่างรหัสชิ้นอัตโนมัติ ('<รหัสชุด>-NN') ไว้แสดงเป็น placeholder */
export function autoCodeHint(itemCode: string): string {
  const c = cleanText(itemCode)
  return c ? `อัตโนมัติ (${c}-01, ${c}-02 …)` : 'อัตโนมัติ'
}

// ----- ตรวจข้อมูล + สร้าง payload -----
function err(fieldId: string, message: string): ValidateResult {
  return { ok: false, fieldId, message }
}

function readMoney(raw: string, required: boolean): number | null | 'bad' {
  const t = cleanText(raw)
  if (!t) return required ? 'bad' : null
  const n = parseMoneyInput(t)
  if (n === null || n < 0 || n > MAX_RENTAL_MONEY) return 'bad'
  return n
}

function readInt(raw: string, min: number, max: number): number | null | 'bad' {
  const t = cleanText(raw)
  if (!t) return null
  if (!/^\d{1,4}$/.test(t)) return 'bad'
  const n = parseInt(t, 10)
  return n < min || n > max ? 'bad' : n
}

export function validateItemForm(
  form: ItemFormState,
  ctx: { loaded: RentalItem | null; clientId: string; otherCodes: readonly string[] },
): ValidateResult {
  const warnings: string[] = []
  const code = cleanText(form.code)
  if (!code) return err('ri-code', 'กรุณาใส่รหัสชุด')
  if (code.length > MAX_ITEM_CODE) return err('ri-code', `รหัสชุดยาวเกินไป (สูงสุด ${MAX_ITEM_CODE} ตัวอักษร)`)
  if (!CODE_RE.test(code)) return err('ri-code', 'รหัสชุดใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข และเครื่องหมาย (ห้ามมีช่องว่าง/ภาษาไทย)')
  const lower = code.toLowerCase()
  if (ctx.otherCodes.some(c => cleanText(c).toLowerCase() === lower)) return err('ri-code', `รหัสชุด ${code} ซ้ำกับชุดอื่น`)

  const name = cleanText(form.name)
  if (!name) return err('ri-name', 'กรุณาใส่ชื่อชุด')
  if (name.length > MAX_ITEM_NAME) return err('ri-name', `ชื่อชุดยาวเกินไป (สูงสุด ${MAX_ITEM_NAME} ตัวอักษร)`)
  const color = cleanText(form.color)
  if (color.length > MAX_ITEM_COLOR) return err('ri-color', `สียาวเกินไป (สูงสุด ${MAX_ITEM_COLOR} ตัวอักษร)`)
  const description = cleanText(form.description)
  if (description.length > MAX_ITEM_DESCRIPTION) {
    return err('ri-desc', `รายละเอียดยาวเกินไป (สูงสุด ${MAX_ITEM_DESCRIPTION.toLocaleString('en-US')} ตัวอักษร)`)
  }
  const tags: string[] = []
  for (const t of form.tags) {
    const c = cleanText(t)
    if (!c) continue
    if (c.length > MAX_TAG_LEN) return err('ri-tags', `แท็ก "${c}" ยาวเกินไป (สูงสุด ${MAX_TAG_LEN} ตัวอักษร)`)
    if (!tags.some(x => x.toLowerCase() === c.toLowerCase())) tags.push(c)
  }
  if (tags.length > MAX_TAGS) return err('ri-tags', `ใส่แท็กได้ไม่เกิน ${MAX_TAGS} แท็ก`)

  const basePrice = readMoney(form.basePrice, true)
  if (basePrice === 'bad' || basePrice === null) return err('ri-base-price', 'กรุณาใส่ค่าเช่าเป็นตัวเลข (0 ขึ้นไป)')
  const baseDays = readInt(form.baseDays, 1, MAX_RENTAL_DAYS)
  if (baseDays === 'bad' || baseDays === null) return err('ri-base-days', `จำนวนวันที่รวมในค่าเช่าต้องเป็น 1-${MAX_RENTAL_DAYS} วัน`)
  const extra = readMoney(form.extraDayPrice, false)
  if (extra === 'bad') return err('ri-extra', 'ค่าเช่าวันเพิ่มต้องเป็นตัวเลข 0 ขึ้นไป')
  const deposit = readMoney(form.securityDeposit, false)
  if (deposit === 'bad') return err('ri-deposit', 'ค่าประกันชุดต้องเป็นตัวเลข 0 ขึ้นไป')
  const replace = readMoney(form.replacementCost, false)
  if (replace === 'bad') return err('ri-replace', 'ค่าชดเชยกรณีสูญหายต้องเป็นตัวเลข 0 ขึ้นไป')
  const bufBefore = readInt(form.bufferBefore, 0, MAX_BUFFER_DAYS)
  if (bufBefore === 'bad') return err('ri-buf-before', `วันเตรียมชุดก่อนรับต้องเป็น 0-${MAX_BUFFER_DAYS} วัน`)
  const bufAfter = readInt(form.bufferAfter, 0, MAX_BUFFER_DAYS)
  if (bufAfter === 'bad') return err('ri-buf-after', `วันซัก/ตรวจชุดหลังคืนต้องเป็น 0-${MAX_BUFFER_DAYS} วัน`)

  const p_item: Record<string, unknown> = {
    code,
    name,
    category_id: form.categoryId || null,
    description: description || null,
    color: color || null,
    base_price: basePrice,
    base_days: baseDays,
    extra_day_price: extra ?? 0,
    security_deposit: deposit ?? 0,
    replacement_cost: replace ?? 0,
    buffer_before_days: bufBefore,
    buffer_after_days: bufAfter,
    is_accessory: form.isAccessory,
    is_public: form.isPublic,
    tags,
  }
  if (ctx.loaded) {
    p_item.id = ctx.loaded.id
    p_item.updated_at = ctx.loaded.updated_at
  } else {
    p_item.client_id = ctx.clientId
    p_item.is_active = form.isActive
  }

  // ----- ชิ้น -----
  if (form.units.length > MAX_UNITS) return err('ri-units', `ชุดหนึ่งแบบมีได้ไม่เกิน ${MAX_UNITS} ชิ้น`)
  const loadedUnits = new Map((ctx.loaded?.units ?? []).map(u => [u.id, u]))
  const seenCodes = new Map<string, ItemFormUnit>()
  const p_units: Record<string, unknown>[] = []
  for (const u of form.units) {
    const ucode = cleanText(u.code)
    const size = cleanText(u.size)
    const note = cleanText(u.note)
    if (ucode) {
      if (ucode.length > MAX_UNIT_CODE) return err(`ru-${u.key}-code`, `รหัสชิ้นยาวเกินไป (สูงสุด ${MAX_UNIT_CODE} ตัวอักษร)`)
      if (!CODE_RE.test(ucode)) {
        return err(`ru-${u.key}-code`, `รหัสชิ้น "${ucode}" ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข และเครื่องหมาย (ห้ามมีช่องว่าง)`)
      }
      const k = ucode.toLowerCase()
      if (seenCodes.has(k)) return err(`ru-${u.key}-code`, `รหัสชิ้น ${ucode} ซ้ำกันในรายการ`)
      seenCodes.set(k, u)
    } else if (u.id) {
      return err(`ru-${u.key}-code`, 'รหัสชิ้นเดิมเว้นว่างไม่ได้ (พิมพ์รหัสเดิมกลับ หรือเปลี่ยนเป็นรหัสใหม่)')
    }
    if (size.length > MAX_UNIT_SIZE) return err(`ru-${u.key}-size`, `ไซส์ยาวเกินไป (สูงสุด ${MAX_UNIT_SIZE} ตัวอักษร)`)
    if (size && hasInvisibleChars(size)) {
      return err(`ru-${u.key}-size`, 'ไซส์มีอักขระพิเศษที่มองไม่เห็นปนอยู่ (มักติดมาตอนก๊อปวาง) — ลบแล้วพิมพ์ใหม่')
    }
    if (note.length > MAX_UNIT_NOTE) return err(`ru-${u.key}-note`, `หมายเหตุสภาพชิ้นยาวเกินไป (สูงสุด ${MAX_UNIT_NOTE} ตัวอักษร)`)

    if (!u.id) {
      const row: Record<string, unknown> = { size: size || null, status: u.status, condition_note: note || null }
      if (ucode) row.unit_code = ucode
      p_units.push(row)
      continue
    }
    // ชิ้นเดิม: ส่งเฉพาะช่องที่เปลี่ยน (ดูหัวไฟล์)
    const orig = loadedUnits.get(u.id)
    const row: Record<string, unknown> = { id: u.id }
    if (!orig || ucode !== orig.unit_code) row.unit_code = ucode
    if (!orig || size !== cleanText(orig.size ?? '')) row.size = size || null
    if (!orig || u.status !== orig.status) row.status = u.status
    if (!orig || note !== cleanText(orig.condition_note ?? '')) row.condition_note = note || null
    p_units.push(row)
    if (orig && orig.status === 'available' && u.status !== 'available' && orig.next_booking) {
      warnings.push(
        `ชิ้น ${ucode} มีการจอง ${orig.next_booking.booking_no} รออยู่ — เปิดการจองนั้นแล้วสลับชิ้นให้ลูกค้า`,
      )
    }
  }
  // ชิ้นใหม่ที่ไม่ใส่รหัส: ระบบตั้งเป็น '<รหัสชุด>-NN' ให้ (เลขถัดไปที่ยังว่าง)
  return { ok: true, payload: { p_item, p_units }, warnings }
}

/** หาช่องในฟอร์มที่ข้อความผิดพลาดจากฐานข้อมูลพูดถึง (เพื่อเลื่อนไปโฟกัส) ; ไม่รู้ = null */
export function locateServerError(text: string, form: ItemFormState): string | null {
  const unitCode = /รหัสชิ้น\s+"?([!-~]+?)"?\s/.exec(text + ' ')
  if (unitCode) {
    const k = unitCode[1].toLowerCase()
    const u = form.units.find(x => cleanText(x.code).toLowerCase() === k)
    if (u) return `ru-${u.key}-code`
  }
  if (text.includes('รหัสชุด')) return 'ri-code'
  if (text.includes('ชื่อชุด')) return 'ri-name'
  if (text.includes('หมวด')) return 'ri-category'
  if (text.includes('รายละเอียดชุด')) return 'ri-desc'
  if (text.includes('แท็ก')) return 'ri-tags'
  if (text.includes('ค่าเช่าวันเพิ่ม')) return 'ri-extra'
  if (text.includes('ค่าประกันชุด')) return 'ri-deposit'
  if (text.includes('ค่าชดเชย')) return 'ri-replace'
  if (text.includes('จำนวนวันเช่าพื้นฐาน')) return 'ri-base-days'
  if (text.includes('ค่าเช่า')) return 'ri-base-price'
  if (text.includes('วันเตรียมชุด')) return 'ri-buf-before'
  if (text.includes('วันซัก')) return 'ri-buf-after'
  if (/^สี|\sสี/.test(text)) return 'ri-color'
  return null
}

/** บันทึกไม่ผ่านเพราะเครื่องอื่นแก้ชุดนี้หลังจากเปิดฟอร์ม */
export function isItemVersionConflict(message: string): boolean {
  return message.includes('ถูกแก้ไขจากเครื่องอื่น')
}

/** ข้อมูลในฟอร์มเก่าแล้ว ต้องโหลดใหม่ */
export function itemNeedsReload(message: string): boolean {
  return isItemVersionConflict(message) || message.includes('โหลดหน้าใหม่')
}

// ----- รวมการแก้ไขของผู้ใช้เข้ากับข้อมูลล่าสุด (หลังบันทึกชนกับเครื่องอื่น) -----
const SCALAR_KEYS = [
  'code', 'name', 'categoryId', 'color', 'description', 'basePrice', 'baseDays', 'extraDayPrice', 'securityDeposit',
  'replacementCost', 'bufferBefore', 'bufferAfter', 'isAccessory', 'isPublic',
] as const

const FIELD_LABELS: Record<(typeof SCALAR_KEYS)[number] | 'tags', string> = {
  code: 'รหัสชุด', name: 'ชื่อชุด', categoryId: 'หมวด', color: 'สี', description: 'รายละเอียด', basePrice: 'ค่าเช่า',
  baseDays: 'จำนวนวันที่รวมในค่าเช่า', extraDayPrice: 'ค่าเช่าวันเพิ่ม', securityDeposit: 'ค่าประกันชุด',
  replacementCost: 'ค่าชดเชยกรณีสูญหาย', bufferBefore: 'วันเตรียมชุดก่อนรับ', bufferAfter: 'วันซัก/ตรวจหลังคืน',
  isAccessory: 'ประเภทเครื่องประดับ', isPublic: 'การแสดงบนหน้าจองออนไลน์', tags: 'แท็ก',
}

function sameScalar(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return cleanText(a) === cleanText(b)
  return a === b
}

/**
 * ข้อมูลในฐานข้อมูลเปลี่ยนระหว่างที่ผู้ใช้แก้ฟอร์ม → เอาข้อมูลล่าสุดเป็นฐาน แล้วทับด้วย "เฉพาะช่องที่ผู้ใช้แก้"
 * oldBase = ฟอร์มจากข้อมูลที่โหลดตอนแรก, current = ฟอร์มตอนนี้, fresh = ข้อมูลล่าสุด
 * คืนฟอร์มใหม่ + รายการสิ่งที่เครื่องอื่นเปลี่ยน (บอกผู้ใช้)
 */
export function rebaseItemForm(
  oldBase: ItemFormState,
  current: ItemFormState,
  fresh: RentalItem,
): { form: ItemFormState; changes: string[] } {
  const freshBase = formFromItem(fresh)
  const out: ItemFormState = { ...freshBase, isActive: fresh.is_active }
  const changes: string[] = []
  const o = out as unknown as Record<string, unknown>
  const cur = current as unknown as Record<string, unknown>
  const ob = oldBase as unknown as Record<string, unknown>
  const fb = freshBase as unknown as Record<string, unknown>
  for (const k of SCALAR_KEYS) {
    const userChanged = !sameScalar(cur[k], ob[k])
    const otherChanged = !sameScalar(fb[k], ob[k])
    if (userChanged) o[k] = cur[k]
    if (otherChanged) changes.push(`${FIELD_LABELS[k]}ถูกแก้จากเครื่องอื่น${userChanged ? ' (ใช้ค่าที่คุณพิมพ์ไว้)' : ''}`)
  }
  const tagsSig = (t: string[]) => t.map(cleanText).join('\n')
  if (tagsSig(current.tags) !== tagsSig(oldBase.tags)) out.tags = current.tags.slice()
  if (tagsSig(freshBase.tags) !== tagsSig(oldBase.tags)) changes.push('แท็กถูกแก้จากเครื่องอื่น')

  // ชิ้น
  const oldById = new Map(oldBase.units.filter(u => u.id).map(u => [u.id as string, u]))
  const curById = new Map(current.units.filter(u => u.id).map(u => [u.id as string, u]))
  const units: ItemFormUnit[] = []
  for (const fu of freshBase.units) {
    const id = fu.id as string
    const ou = oldById.get(id)
    const cu = curById.get(id)
    if (!ou) {
      units.push(fu)
      changes.push(`มีชิ้นใหม่ ${fu.code} ถูกเพิ่มจากเครื่องอื่น`)
      continue
    }
    if (!cu) continue // ผู้ใช้กดเอาชิ้นนี้ออก → คงการเอาออกไว้
    const merged: ItemFormUnit = { ...fu }
    if (!sameScalar(cu.code, ou.code)) merged.code = cu.code
    if (!sameScalar(cu.size, ou.size)) merged.size = cu.size
    if (cu.status !== ou.status) merged.status = cu.status
    if (!sameScalar(cu.note, ou.note)) merged.note = cu.note
    if (fu.status !== ou.status) changes.push(`สถานะชิ้น ${fu.code} ถูกเปลี่ยนจากเครื่องอื่น`)
    units.push(merged)
  }
  for (const ou of oldBase.units) {
    if (ou.id && !freshBase.units.some(f => f.id === ou.id)) changes.push(`ชิ้น ${ou.code} ถูกลบจากเครื่องอื่นแล้ว`)
  }
  for (const cu of current.units) if (!cu.id) units.push(cu)
  out.units = sortUnits(units)
  return { form: out, changes }
}

/** ข้อมูลชุดสองชุดเหมือนกันไหม (ไม่นับ is_active / updated_at / รูป / สถิติ) — ใช้ตัดสินหลังกดเปิด/ปิดให้เช่า */
export function sameItemContent(a: RentalItem, b: RentalItem): boolean {
  const fa = formFromItem(a)
  const fbb = formFromItem(b)
  fa.isActive = fbb.isActive
  return formSignature(fa) === formSignature(fbb)
}

/** ข้อมูลล่าสุดในฐานข้อมูลตรงกับที่เพิ่งส่งบันทึกไหม (คำตอบหายระหว่างทาง แต่บันทึกสำเร็จแล้ว) */
export function itemMatchesPayload(item: RentalItem, payload: SaveItemPayload): boolean {
  const p = payload.p_item
  const eqText = (a: unknown, b: string | null) => cleanText(typeof a === 'string' ? a : '') === cleanText(b ?? '')
  if (!eqText(p.code, item.code) || !eqText(p.name, item.name)) return false
  if ((p.category_id ?? null) !== (item.category_id ?? null)) return false
  if (!eqText(p.color, item.color) || !eqText(p.description, item.description)) return false
  if (round2(Number(p.base_price)) !== item.base_price || Number(p.base_days) !== item.base_days) return false
  if (round2(Number(p.extra_day_price)) !== item.extra_day_price) return false
  if (round2(Number(p.security_deposit)) !== item.security_deposit) return false
  if (round2(Number(p.replacement_cost)) !== item.replacement_cost) return false
  if ((p.buffer_before_days ?? null) !== item.buffer_before_days) return false
  if ((p.buffer_after_days ?? null) !== item.buffer_after_days) return false
  if (p.is_accessory !== item.is_accessory || p.is_public !== item.is_public) return false
  // ชิ้น: จำนวน + ชิ้นเดิมที่แก้ต้องตรงตามที่ส่ง
  if (payload.p_units.length !== item.units.length) return false
  for (const row of payload.p_units) {
    if (typeof row.id !== 'string') continue
    const u = item.units.find(x => x.id === row.id)
    if (!u) return false
    if ('unit_code' in row && !eqText(row.unit_code, u.unit_code)) return false
    if ('size' in row && !eqText(row.size, u.size)) return false
    if ('status' in row && row.status !== u.status) return false
  }
  return true
}

/** สรุปจำนวนชิ้นตามไซส์ (เฉพาะชิ้นที่ยังไม่เลิกใช้) → [{size, total, ready}] เรียงตามไซส์ */
export function sizeSummary(
  units: readonly { size: string | null; status: RentalUnitStatus; needs_cleaning?: boolean }[],
): { size: string; total: number; ready: number }[] {
  const map = new Map<string, { size: string; total: number; ready: number }>()
  for (const u of units) {
    if (u.status === 'retired') continue
    const size = cleanText(u.size ?? '')
    const k = size.toLowerCase()
    const row = map.get(k) ?? { size, total: 0, ready: 0 }
    row.total += 1
    if (u.status === 'available' && !u.needs_cleaning) row.ready += 1
    map.set(k, row)
  }
  return Array.from(map.values()).sort((a, b) => {
    const fa = a.size === '' ? 1 : 0
    const fb = b.size === '' ? 1 : 0
    if (fa !== fb) return fa - fb
    return compareSizes(a.size, b.size)
  })
}
