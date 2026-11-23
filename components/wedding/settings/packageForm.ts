// ===== ฟอร์มแพ็กเกจ / บริการเสริม ↔ wed_save_package / wed_save_addon (ตรวจตามกติกาเดียวกับ supabase-fix-07-wedding.sql) =====
// pure functions ล้วน (ไม่มี React)
// ราคา/ชั่วโมง/รายการงานที่ส่งของแพ็กเกจ = ค่าตั้งต้นตอนเลือกแพ็กเกจในฟอร์มงาน — งานที่จองไปแล้วจำค่า ณ ตอนจองไว้เอง (แก้ที่นี่ไม่กระทบงานเดิม)
import { parseMoneyInput, round2 } from '@/lib/money'
import {
  MAX_PACKAGE_DELIVERABLES, MAX_WED_MONEY,
  type WedAddon, type WedDeliverablePlanItem, type WedPackage,
} from '@/lib/wedding'
import { asciiDigits, clean } from './settingsForm'

export const PACKAGE_LIMITS = { name: 100, description: 3000, item_name: 120, item_unit: 30 } as const
export const ADDON_LIMITS = { name: 100, unit: 30, description: 1000 } as const
export const MAX_PACKAGE_HOURS = 999.9
export const MAX_CREW_SIZE = 20
export const MAX_DUE_DAYS = 365
export const MAX_ITEM_QTY = 100000

/** ชื่องานที่ส่งที่ใช้บ่อย (กดเลือกได้ พิมพ์เองก็ได้) */
export const COMMON_DELIVERABLES = [
  'ภาพถ่ายแต่งสี (คัดแล้ว)', 'ไฟล์ภาพทั้งหมด', 'ภาพพรีวิววันงาน', 'วิดีโอไฮไลต์', 'วิดีโอเต็มพิธี',
  'คลิปสั้น Reels / TikTok', 'อัลบั้มภาพ', 'ภาพพิมพ์ใส่กรอบ',
] as const
/** หน่วยที่ใช้บ่อย */
export const COMMON_UNITS = ['ภาพ', 'ไฟล์', 'คลิป', 'ชุด', 'เล่ม', 'ลิงก์', 'ชิ้น', 'ชั่วโมง', 'ครั้ง'] as const

let rowSeq = 0
export function newRowKey(prefix = 'row'): string {
  rowSeq += 1
  return `${prefix}-${rowSeq}`
}

// ---------------------------------------------------------------------------
// ตัวช่วยอ่านช่องกรอก
// ---------------------------------------------------------------------------
function intText(v: string, label: string, min: number, max: number, fallback: number | null): { value: number | null; error: string | null } {
  const t = clean(asciiDigits(v))
  if (t === null) return fallback === null ? { value: null, error: `กรุณาใส่${label}` } : { value: fallback, error: null }
  if (!/^\d+$/.test(t)) return { value: null, error: `${label}ต้องเป็นจำนวนเต็ม ${min} ถึง ${max.toLocaleString('en-US')}` }
  const n = Number(t)
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    return { value: null, error: `${label}ต้องเป็นจำนวนเต็ม ${min} ถึง ${max.toLocaleString('en-US')}` }
  }
  return { value: n, error: null }
}

function moneyText(v: string, label: string): { value: number | null; error: string | null } {
  if (clean(v) === null) return { value: 0, error: null }
  const n = parseMoneyInput(v)
  if (n === null) return { value: null, error: `${label}: รูปแบบจำนวนเงินไม่ถูกต้อง` }
  if (n < 0) return { value: null, error: `${label}ต้องไม่ติดลบ` }
  if (n > MAX_WED_MONEY) return { value: null, error: `${label}สูงเกินไป (สูงสุด 99,999,999.99)` }
  return { value: n, error: null }
}

function plainNum(n: number): string {
  return String(Math.round(n * 100) / 100)
}

// ---------------------------------------------------------------------------
// แพ็กเกจ
// ---------------------------------------------------------------------------
export interface PlanRow {
  key: string
  name: string
  qty: string
  unit: string
  due_days: string
}

export interface PackageForm {
  name: string
  price: string
  hours: string
  crew_size: string
  description: string
  deliverables: PlanRow[]
  is_active: boolean
}

export function emptyPlanRow(): PlanRow {
  return { key: newRowKey('plan'), name: '', qty: '1', unit: '', due_days: '30' }
}

export function emptyPackageForm(): PackageForm {
  return { name: '', price: '', hours: '', crew_size: '', description: '', deliverables: [emptyPlanRow()], is_active: true }
}

export function packageToForm(p: WedPackage): PackageForm {
  return {
    name: p.name,
    price: plainNum(p.price),
    hours: p.hours > 0 ? String(p.hours) : '',
    crew_size: p.crew_size > 0 ? String(p.crew_size) : '',
    description: p.description ?? '',
    deliverables: p.deliverables.map(d => ({
      key: newRowKey('plan'), name: d.name, qty: String(d.qty), unit: d.unit, due_days: String(d.due_days),
    })),
    is_active: p.is_active,
  }
}

function planRowBlank(r: PlanRow): boolean {
  return clean(r.name) === null && clean(r.unit) === null
}

/** คีย์ error ของช่องในแถวงานที่ส่ง */
export function planErrorKey(index: number, field: 'name' | 'qty' | 'unit' | 'due_days'): string {
  return `deliverables.${index}.${field}`
}

export interface PackagePayload {
  name: string
  description: string | null
  price: number
  hours: number
  crew_size: number
  deliverables: WedDeliverablePlanItem[]
  is_active: boolean
}

/** ฟอร์ม → payload ของ wed_save_package (ยังไม่ใส่ id/client_id/updated_at/sort_order) + error รายช่อง */
export function buildPackage(f: PackageForm): { payload: PackagePayload; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const name = clean(f.name)
  if (name === null) errors.name = 'กรุณาใส่ชื่อแพ็กเกจ'
  else if (name.length > PACKAGE_LIMITS.name) errors.name = `ชื่อแพ็กเกจยาวเกินไป (สูงสุด ${PACKAGE_LIMITS.name} ตัวอักษร)`

  const price = moneyText(f.price, 'ราคาแพ็กเกจ')
  if (price.error) errors.price = price.error

  let hours = 0
  const hoursText = clean(asciiDigits(f.hours))
  if (hoursText !== null) {
    if (!/^\d{1,3}(\.\d)?$/.test(hoursText)) {
      errors.hours = 'ชั่วโมงทำงานต้องเป็นตัวเลข 0 ถึง 999.9 (ทศนิยม 1 ตำแหน่ง)'
    } else {
      hours = Number(hoursText)
      if (hours > MAX_PACKAGE_HOURS) errors.hours = 'ชั่วโมงทำงานต้องเป็นตัวเลข 0 ถึง 999.9 (ทศนิยม 1 ตำแหน่ง)'
    }
  }

  const crew = intText(f.crew_size, 'จำนวนทีมงาน', 0, MAX_CREW_SIZE, 0)
  if (crew.error) errors.crew_size = crew.error

  const description = clean(f.description)
  if (description !== null && description.length > PACKAGE_LIMITS.description) {
    errors.description = `รายละเอียดยาวเกินไป (สูงสุด ${PACKAGE_LIMITS.description.toLocaleString('en-US')} ตัวอักษร)`
  }

  const items: WedDeliverablePlanItem[] = []
  const rows = f.deliverables.filter(r => !planRowBlank(r))
  if (rows.length > MAX_PACKAGE_DELIVERABLES) errors.deliverables = `ใส่รายการงานที่ส่งได้ไม่เกิน ${MAX_PACKAGE_DELIVERABLES} รายการ`
  f.deliverables.forEach((r, i) => {
    if (planRowBlank(r)) return
    const n = clean(r.name)
    if (n === null) errors[planErrorKey(i, 'name')] = 'กรุณาใส่ชื่องานที่ส่ง'
    else if (n.length > PACKAGE_LIMITS.item_name) errors[planErrorKey(i, 'name')] = `ยาวเกินไป (สูงสุด ${PACKAGE_LIMITS.item_name} ตัวอักษร)`
    const qty = intText(r.qty, 'จำนวน', 1, MAX_ITEM_QTY, 1)
    if (qty.error) errors[planErrorKey(i, 'qty')] = qty.error
    const unit = clean(r.unit)
    if (unit !== null && unit.length > PACKAGE_LIMITS.item_unit) errors[planErrorKey(i, 'unit')] = `หน่วยยาวเกินไป (สูงสุด ${PACKAGE_LIMITS.item_unit} ตัวอักษร)`
    const due = intText(r.due_days, 'ส่งภายใน (วัน)', 0, MAX_DUE_DAYS, 30)
    if (due.error) errors[planErrorKey(i, 'due_days')] = due.error
    items.push({ name: n ?? '', qty: qty.value ?? 1, unit: unit ?? '', due_days: due.value ?? 30 })
  })

  return {
    payload: {
      name: name ?? '',
      description,
      price: price.value ?? 0,
      hours,
      crew_size: crew.value ?? 0,
      deliverables: items,
      is_active: f.is_active,
    },
    errors,
  }
}

/** ข้อมูลจากฐานข้อมูลตรงกับ payload ที่ส่งไปทุกช่องหรือไม่ (ใช้ตรวจตอนไม่รู้ผล) */
export function packageMatches(p: WedPackage, payload: PackagePayload): boolean {
  if (p.name !== payload.name) return false
  if ((p.description ?? null) !== payload.description) return false
  if (round2(p.price) !== round2(payload.price)) return false
  if (Math.round(p.hours * 10) !== Math.round(payload.hours * 10)) return false
  if (p.crew_size !== payload.crew_size || p.is_active !== payload.is_active) return false
  if (p.deliverables.length !== payload.deliverables.length) return false
  return p.deliverables.every((d, i) => {
    const x = payload.deliverables[i]
    return d.name === x.name && d.qty === x.qty && (d.unit || '') === (x.unit || '') && d.due_days === x.due_days
  })
}

/** ข้อมูลสั้นของแพ็กเกจ (ป้ายบนการ์ด): '8 ชม.' / 'ทีม 3 คน' — ค่า 0 ไม่แสดง */
export function packageFacts(p: Pick<WedPackage, 'hours' | 'crew_size'>): { kind: 'hours' | 'crew'; text: string }[] {
  const out: { kind: 'hours' | 'crew'; text: string }[] = []
  if (p.hours > 0) out.push({ kind: 'hours', text: `${p.hours.toLocaleString('en-US', { maximumFractionDigits: 1 })} ชม.` })
  if (p.crew_size > 0) out.push({ kind: 'crew', text: `ทีม ${p.crew_size.toLocaleString('en-US')} คน` })
  return out
}

/** 'วิดีโอไฮไลต์ 1 คลิป · ส่งภายใน 30 วัน' */
export function planItemText(d: WedDeliverablePlanItem): string {
  const qty = `${d.qty.toLocaleString('en-US')}${d.unit ? ` ${d.unit}` : ''}`
  return `${d.name} ${qty} · ส่งภายใน ${d.due_days.toLocaleString('en-US')} วัน`
}

// ---------------------------------------------------------------------------
// บริการเสริม
// ---------------------------------------------------------------------------
export interface AddonForm {
  name: string
  price: string
  unit: string
  description: string
  is_active: boolean
}

export function emptyAddonForm(): AddonForm {
  return { name: '', price: '', unit: '', description: '', is_active: true }
}

export function addonToForm(a: WedAddon): AddonForm {
  return { name: a.name, price: plainNum(a.price), unit: a.unit ?? '', description: a.description ?? '', is_active: a.is_active }
}

export interface AddonPayload {
  name: string
  price: number
  unit: string | null
  description: string | null
  is_active: boolean
}

export function buildAddon(f: AddonForm): { payload: AddonPayload; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const name = clean(f.name)
  if (name === null) errors.name = 'กรุณาใส่ชื่อบริการเสริม'
  else if (name.length > ADDON_LIMITS.name) errors.name = `ชื่อยาวเกินไป (สูงสุด ${ADDON_LIMITS.name} ตัวอักษร)`
  const price = moneyText(f.price, 'ราคาบริการเสริม')
  if (price.error) errors.price = price.error
  const unit = clean(f.unit)
  if (unit !== null && unit.length > ADDON_LIMITS.unit) errors.unit = `หน่วยยาวเกินไป (สูงสุด ${ADDON_LIMITS.unit} ตัวอักษร)`
  const description = clean(f.description)
  if (description !== null && description.length > ADDON_LIMITS.description) {
    errors.description = `รายละเอียดยาวเกินไป (สูงสุด ${ADDON_LIMITS.description.toLocaleString('en-US')} ตัวอักษร)`
  }
  return {
    payload: { name: name ?? '', price: price.value ?? 0, unit, description, is_active: f.is_active },
    errors,
  }
}

export function addonMatches(a: WedAddon, payload: AddonPayload): boolean {
  return a.name === payload.name && round2(a.price) === round2(payload.price) && (a.unit ?? null) === payload.unit &&
    (a.description ?? null) === payload.description && a.is_active === payload.is_active
}

/** ลำดับถัดไปท้ายรายการ (10, 20, 30, ...) */
export function nextSortOrder(list: readonly { sort_order: number }[]): number {
  return list.length > 0 ? Math.max(...list.map(x => x.sort_order)) + 10 : 10
}

/** คอลัมน์ที่หน้าอ่านจากตาราง (ตรงกับตัวอ่าน parseWedPackage / parseWedAddon) — อยู่ไฟล์นี้ให้ server component import ได้ */
export const PACKAGE_COLUMNS = 'id, name, description, price, hours, crew_size, deliverables, is_active, sort_order, updated_at'
export const ADDON_COLUMNS = 'id, name, price, unit, description, is_active, sort_order, updated_at'
