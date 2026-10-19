// ===== แถวชุดเช่าสำหรับหน้ารายการ (อ่านตาราง rental_items ตรงผ่าน RLS — พนักงานร้านเช่าอ่านได้) =====
// ใช้ได้ทั้ง server (page.tsx) และ client (ItemsClient / UnitTagsDialog) — ไม่มี import ฝั่งเซิร์ฟเวอร์

import { num, round2 } from '@/lib/money'
import { baht } from '@/lib/format'
import { RENTAL_UNIT_STATUSES, type RentalUnitStatus } from '@/lib/rental'
import type { TagGroup } from './UnitTagsDialog'

/** คอลัมน์ที่หน้ารายการดึง: ข้อมูลการ์ด + ชิ้นทั้งหมด (นับพร้อม/ทั้งหมด, ค้นหารหัสชิ้น, พิมพ์ป้าย) + รูปปก 1 รูป */
export const ITEM_LIST_COLUMNS =
  'id, code, name, category_id, color, base_price, base_days, extra_day_price, security_deposit, ' +
  'is_accessory, is_public, is_active, tags, created_at, ' +
  'rental_units ( id, unit_code, size, status, needs_cleaning ), ' +
  'rental_item_images ( path, sort_order )'

export interface ItemListUnit {
  id: string
  unit_code: string
  size: string | null
  status: RentalUnitStatus
  needs_cleaning: boolean
}

export interface ItemListRow {
  id: string
  code: string
  name: string
  category_id: string | null
  color: string | null
  base_price: number
  base_days: number
  extra_day_price: number
  security_deposit: number
  is_accessory: boolean
  is_public: boolean
  is_active: boolean
  tags: string[]
  created_at: string
  cover_path: string | null
  units: ItemListUnit[]
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v)
}

function strOrNull(v: unknown): string | null {
  const s = str(v)
  return s.trim() === '' ? null : s
}

export function toItemListRow(raw: unknown): ItemListRow | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = str(o.id)
  if (!id) return null
  const units: ItemListUnit[] = []
  for (const u of Array.isArray(o.rental_units) ? o.rental_units : []) {
    if (!u || typeof u !== 'object') continue
    const x = u as Record<string, unknown>
    const uid = str(x.id)
    if (!uid) continue
    const status = str(x.status)
    units.push({
      id: uid,
      unit_code: str(x.unit_code),
      size: strOrNull(x.size),
      status: (RENTAL_UNIT_STATUSES as readonly string[]).includes(status) ? (status as RentalUnitStatus) : 'available',
      needs_cleaning: x.needs_cleaning === true,
    })
  }
  units.sort((a, b) => (a.unit_code.toLowerCase() < b.unit_code.toLowerCase() ? -1 : 1))
  // รูปปก = sort_order น้อยสุด (หน้าเพจขอมาแค่รูปเดียว แต่เรียงซ้ำกันพลาด)
  const imgs = (Array.isArray(o.rental_item_images) ? o.rental_item_images : [])
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
    .map(i => ({ path: str(i.path), sort: num(i.sort_order) }))
    .filter(i => i.path)
    .sort((a, b) => a.sort - b.sort)
  const tags = Array.isArray(o.tags) ? o.tags.map(str).filter(t => t.trim() !== '') : []
  return {
    id,
    code: str(o.code),
    name: str(o.name),
    category_id: strOrNull(o.category_id),
    color: strOrNull(o.color),
    base_price: round2(num(o.base_price)),
    base_days: Math.max(1, Math.trunc(num(o.base_days)) || 1),
    extra_day_price: round2(num(o.extra_day_price)),
    security_deposit: round2(num(o.security_deposit)),
    is_accessory: o.is_accessory === true,
    is_public: o.is_public !== false,
    is_active: o.is_active !== false,
    tags,
    created_at: str(o.created_at),
    cover_path: imgs[0]?.path ?? null,
    units,
  }
}

/** ข้อความราคาเช่าสั้นๆ เช่น '฿1,500 / 3 วัน' */
export function rentPriceText(basePrice: number, baseDays: number): string {
  return `${baht(basePrice)} / ${baseDays} วัน`
}

/** ชุดในหน้ารายการ → กลุ่มสำหรับเลือกพิมพ์ป้าย */
export function tagGroupOf(row: Pick<ItemListRow, 'id' | 'code' | 'name' | 'base_price' | 'base_days' | 'units'>): TagGroup {
  return {
    item_id: row.id,
    item_code: row.code,
    item_name: row.name,
    price_text: rentPriceText(row.base_price, row.base_days),
    units: row.units.map(u => ({ id: u.id, unit_code: u.unit_code, size: u.size, status: u.status })),
  }
}
