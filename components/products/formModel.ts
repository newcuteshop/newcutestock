// ===== โมเดลของฟอร์มสินค้า (ฟังก์ชันล้วน ไม่มี React) =====
// สถานะฟอร์ม, แปลงจาก/เป็น JSON ของ RPC, ตรวจข้อมูลก่อนบันทึก, สร้าง payload ของ save_product_group,
// และรวมข้อมูลเมื่อบันทึกชนกับเครื่องอื่น (CONTRACT §3.1, §5.3)

import { normalizeScannedCode } from '@/lib/barcode'
import { baht } from '@/lib/format'
import {
  type GroupInput, type ProductGroupJson, type VariantInput, type VariantJson,
  MAX_CODE_LEN, MAX_COLOR, MAX_DESCRIPTION, MAX_MIN_STOCK, MAX_MONEY, MAX_NAME, MAX_OPENING_QTY,
  MAX_SIZE_LEN, MAX_SIZES,
  cleanText, compareSizes, hasInvisibleChars, isPrintableCode, newUuid, sizeKey, skuSizePart, suggestSku,
} from '@/lib/products'

// ===== สถานะฟอร์ม =====
export type RowState = {
  key: string          // คีย์ในหน้าจอ (ไซส์เดิม = id, ไซส์ใหม่ = สุ่ม)
  id: string | null    // null = SKU ใหม่
  size: string
  sku: string
  skuAuto: boolean     // SKU ยังเป็นค่าที่ระบบตั้งให้ (SKU ตั้งต้น-ไซส์) — ผู้ใช้พิมพ์เองแล้ว = false
  barcode: string
  cost: string
  sell: string
  min: string
  active: boolean      // เปิดขายไซส์นี้
  opening: string      // ยอดยกมา (เฉพาะไซส์ใหม่)
  stock: number        // สต๊อกปัจจุบัน (ไซส์เดิม)
  hasHistory: boolean  // เคยขาย/รับ-จ่าย/มีสต๊อก → เอาออกแล้วเก็บเป็น "ไซส์ที่เลิกใช้"
  restored: boolean    // นำกลับมาจากไซส์ที่เลิกใช้
}

export type FormState = {
  name: string
  categoryId: string
  color: string
  description: string
  hasSizes: boolean
  baseSku: string      // ตัวช่วยตั้ง SKU ของไซส์ใหม่ (ไม่ได้บันทึกลงฐานข้อมูล)
  rows: RowState[]     // แบบไม่มีไซส์: มี 1 แถวเสมอ
}

export const DEFAULT_MIN_STOCK = '5'

export function newRowKey(): string {
  return 'n' + newUuid().replace(/-/g, '')
}

function numStr(n: number): string {
  return Number.isFinite(n) ? String(n) : '0'
}

export function newRow(patch: Partial<RowState> = {}): RowState {
  return {
    key: newRowKey(),
    id: null,
    size: '',
    sku: '',
    skuAuto: true,
    barcode: '',
    cost: '',
    sell: '',
    min: DEFAULT_MIN_STOCK,
    active: true,
    opening: '',
    stock: 0,
    hasHistory: false,
    restored: false,
    ...patch,
  }
}

export function rowFromVariant(v: VariantJson, restored = false): RowState {
  return {
    key: v.id,
    id: v.id,
    size: v.size ?? '',
    sku: v.sku,
    skuAuto: false,
    barcode: v.barcode ?? '',
    cost: numStr(v.cost_price),
    sell: numStr(v.sell_price),
    min: numStr(v.min_stock),
    active: restored ? true : v.is_active,
    opening: '',
    stock: v.stock_qty,
    hasHistory: v.has_history,
    restored,
  }
}

export function emptyForm(): FormState {
  return {
    name: '',
    categoryId: '',
    color: '',
    description: '',
    hasSizes: false,
    baseSku: '',
    rows: [newRow()],
  }
}

/** SKU ตั้งต้นจากไซส์เดิม: 'SHIRT-01-M', 'SHIRT-01-L' → 'SHIRT-01' ; ไม่มีไซส์ = SKU ของรายการนั้น */
export function deriveBaseSku(json: ProductGroupJson): string {
  if (!json.has_sizes) return json.variants[0]?.sku ?? ''
  const bases: string[] = []
  for (const v of json.variants) {
    const part = skuSizePart(v.size)
    if (!part) continue
    const suffix = '-' + part
    if (v.sku.length > suffix.length && v.sku.toUpperCase().endsWith(suffix.toUpperCase())) {
      bases.push(v.sku.slice(0, v.sku.length - suffix.length))
    }
  }
  // SKU เดิมไม่ได้ตั้งแบบ ตั้งต้น-ไซส์ (เช่น สินค้าจากระบบเก่า) → ใช้ SKU ของไซส์แรกเป็นตั้งต้น
  if (bases.length === 0) return json.variants[0]?.sku ?? ''
  return bases[0]
}

export function formFromJson(json: ProductGroupJson): FormState {
  const rows = json.variants.map(v => rowFromVariant(v))
  return {
    name: json.name,
    categoryId: json.category_id ?? '',
    color: json.color ?? '',
    description: json.description ?? '',
    hasSizes: json.has_sizes,
    baseSku: deriveBaseSku(json),
    rows: rows.length > 0 ? rows : [newRow()],
  }
}

/** ค่าที่ใช้เทียบว่าฟอร์มถูกแก้หรือยัง (ไม่รวมคีย์หน้าจอ/ตัวช่วย) */
export function formSignature(f: FormState): string {
  return JSON.stringify({
    n: f.name, c: f.categoryId, co: f.color, d: f.description, h: f.hasSizes,
    r: f.rows.map(r => [r.id, f.hasSizes ? r.size : '', r.sku, r.barcode, r.cost, r.sell, r.min, f.hasSizes ? r.active : true, r.opening]),
  })
}

// ===== แก้ไขฟอร์ม (คืนสถานะใหม่เสมอ) =====

/** เรียงแถวตามลำดับไซส์ของระบบ (แถวที่ยังไม่กรอกไซส์อยู่บนสุด) */
export function sortRows(rows: RowState[]): RowState[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => compareSizes(cleanText(a.row.size), cleanText(b.row.size)) || a.index - b.index)
    .map(x => x.row)
}

/** เปลี่ยน SKU ตั้งต้น → SKU ของไซส์ใหม่ที่ระบบตั้งให้เปลี่ยนตาม (SKU ของไซส์เดิมไม่แตะเด็ดขาด) */
export function applyBaseSku(form: FormState, base: string): FormState {
  return {
    ...form,
    baseSku: base,
    rows: form.rows.map(r => (r.id === null && r.skuAuto ? { ...r, sku: suggestSku(base, r.size) } : r)),
  }
}

export function setRowSize(form: FormState, key: string, size: string): FormState {
  return {
    ...form,
    rows: form.rows.map(r => {
      if (r.key !== key) return r
      const next = { ...r, size }
      if (r.id === null && r.skuAuto) next.sku = suggestSku(form.baseSku, size)
      return next
    }),
  }
}

/** ค่าตั้งต้นของไซส์ใหม่: คัดลอกราคา/ขั้นต่ำจากแถวล่าสุด (ไม่ต้องพิมพ์ซ้ำทุกไซส์) */
export function rowForNewSize(form: FormState, size: string): RowState {
  const last = form.rows[form.rows.length - 1]
  return newRow({
    size,
    sku: suggestSku(form.baseSku, size),
    cost: last ? last.cost : '',
    sell: last ? last.sell : '',
    min: last ? last.min : DEFAULT_MIN_STOCK,
  })
}

// ===== ตรวจข้อมูล + สร้าง payload =====
export type ValidateContext = {
  loaded: ProductGroupJson | null
  clientId: string
  canStock: boolean
  archived: VariantJson[]   // ไซส์ที่เลิกใช้ (ที่ยังไม่ได้นำกลับมา)
}

export type SavePayload = { p_group: GroupInput; p_variants: VariantInput[] }

export type ValidateResult =
  | { ok: true; payload: SavePayload }
  | { ok: false; message: string; fieldId: string }

export function fieldId(rowKey: string, field: 'size' | 'sku' | 'barcode' | 'cost' | 'sell' | 'min' | 'opening'): string {
  return `pf-${rowKey}-${field}`
}

// '' = ไม่ได้กรอก (null), NaN = ไม่ใช่ตัวเลข
export function parseMoney(raw: string): number | null {
  const s = String(raw ?? '').trim().replace(/,/g, '')
  if (!s) return null
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return NaN
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN
}

// '' = ไม่ได้กรอก (null), NaN = ไม่ใช่จำนวนเต็มบวก
export function parseCount(raw: string): number | null {
  const s = String(raw ?? '').trim().replace(/,/g, '')
  if (!s) return null
  if (!/^\d+$/.test(s)) return NaN
  return Number(s)
}

/** บาร์โค้ดที่จะบันทึกจริง (สแกนตอนคีย์บอร์ดเป็นภาษาไทย → แปลงกลับเป็นรหัสอังกฤษ) */
export function barcodeValue(raw: string): string {
  return cleanText(normalizeScannedCode(raw))
}

export function validateForm(form: FormState, ctx: ValidateContext): ValidateResult {
  const fail = (message: string, id: string): ValidateResult => ({ ok: false, message, fieldId: id })

  const name = cleanText(form.name)
  if (!name) return fail('กรุณากรอกชื่อสินค้า', 'pf-name')
  if (name.length > MAX_NAME) return fail('ชื่อสินค้ายาวเกินไป (สูงสุด 200 ตัวอักษร)', 'pf-name')
  const color = cleanText(form.color)
  if (color.length > MAX_COLOR) return fail('ชื่อสียาวเกินไป (สูงสุด 100 ตัวอักษร)', 'pf-color')
  const description = cleanText(form.description)
  if (description.length > MAX_DESCRIPTION) return fail('รายละเอียดสินค้ายาวเกินไป (สูงสุด 2,000 ตัวอักษร)', 'pf-desc')

  const rows = form.hasSizes ? form.rows : form.rows.slice(0, 1)
  if (form.hasSizes) {
    if (rows.length < 1) return fail('กรุณาเพิ่มไซส์อย่างน้อย 1 ไซส์', 'pf-size-new')
    if (rows.length > MAX_SIZES) return fail('สินค้าหนึ่งแบบมีได้ไม่เกิน 50 ไซส์', 'pf-size-new')
  } else if (rows.length !== 1) {
    return fail('สินค้าแบบไม่มีไซส์ต้องมี SKU และราคาชุดเดียว (ถ้ามีหลายไซส์ ให้ติ๊ก "มีไซส์")', 'pf-has-sizes')
  }

  const loadedById = new Map<string, VariantJson>()
  if (ctx.loaded) {
    for (const v of ctx.loaded.variants) loadedById.set(v.id, v)
    for (const v of ctx.loaded.archived_variants) loadedById.set(v.id, v)
  }

  type Norm = { row: RowState; size: string | null; sku: string; barcode: string | null; sell: number; cost: number; min: number; opening: number }
  const norm: Norm[] = []

  for (const row of rows) {
    const old = row.id ? loadedById.get(row.id) : undefined
    let size: string | null = null
    let prefix = ''
    if (form.hasSizes) {
      size = cleanText(row.size)
      if (!size) return fail('กรุณากรอกไซส์ให้ครบทุกแถว', fieldId(row.key, 'size'))
      const sizeChanged = !old || size !== (old.size ?? '')
      if (sizeChanged) {
        if (size.length > MAX_SIZE_LEN) return fail(`ไซส์ "${size}" ยาวเกินไป (สูงสุด 20 ตัวอักษร)`, fieldId(row.key, 'size'))
        if (hasInvisibleChars(size)) {
          return fail(`ไซส์ "${size}" มีอักขระพิเศษที่มองไม่เห็นปนอยู่ (มักติดมาตอนก๊อปวาง) — ลบช่องไซส์แล้วพิมพ์ใหม่`, fieldId(row.key, 'size'))
        }
      }
      prefix = `ไซส์ ${size}: `
    }

    const sku = cleanText(row.sku)
    if (!sku) return fail(`${prefix}กรุณากรอก SKU`, fieldId(row.key, 'sku'))
    if (!old || sku !== old.sku) {
      if (!isPrintableCode(sku)) {
        return fail(`${prefix}SKU "${sku}" ต้องเป็นตัวอักษรภาษาอังกฤษ ตัวเลข หรือสัญลักษณ์เท่านั้น (ห้ามภาษาไทย)`, fieldId(row.key, 'sku'))
      }
      if (sku.length > MAX_CODE_LEN) return fail(`${prefix}SKU ยาวเกินไป (สูงสุด 64 ตัวอักษร)`, fieldId(row.key, 'sku'))
    }

    const barcode = barcodeValue(row.barcode) || null
    if (barcode && (!old || barcode !== (old.barcode ?? ''))) {
      if (!isPrintableCode(barcode)) {
        return fail(`${prefix}บาร์โค้ด "${barcode}" ต้องเป็นตัวอักษรภาษาอังกฤษ ตัวเลข หรือสัญลักษณ์เท่านั้น`, fieldId(row.key, 'barcode'))
      }
      if (barcode.length > MAX_CODE_LEN) return fail(`${prefix}บาร์โค้ดยาวเกินไป (สูงสุด 64 ตัวอักษร)`, fieldId(row.key, 'barcode'))
    }

    const sell = parseMoney(row.sell)
    if (sell === null) return fail(`${prefix}กรุณากรอกราคาขาย`, fieldId(row.key, 'sell'))
    if (Number.isNaN(sell)) return fail(`${prefix}ราคาขายต้องเป็นตัวเลข`, fieldId(row.key, 'sell'))
    if (sell < 0) return fail(`${prefix}ราคาขายต้องไม่ติดลบ`, fieldId(row.key, 'sell'))
    if (sell > MAX_MONEY) return fail(`${prefix}ราคาขายสูงเกินไป`, fieldId(row.key, 'sell'))

    const costRaw = parseMoney(row.cost)
    const cost = costRaw ?? 0
    if (Number.isNaN(cost)) return fail(`${prefix}ราคาทุนต้องเป็นตัวเลข`, fieldId(row.key, 'cost'))
    if (cost < 0) return fail(`${prefix}ราคาทุนต้องไม่ติดลบ`, fieldId(row.key, 'cost'))
    if (cost > MAX_MONEY) return fail(`${prefix}ราคาทุนสูงเกินไป`, fieldId(row.key, 'cost'))

    const minRaw = parseCount(row.min)
    const min = minRaw ?? 0
    if (Number.isNaN(min) || min > MAX_MIN_STOCK) {
      return fail(`${prefix}จำนวนขั้นต่ำต้องเป็นจำนวนเต็ม 0 ถึง 1,000,000`, fieldId(row.key, 'min'))
    }

    let opening = 0
    if (row.id === null && ctx.canStock) {
      const o = parseCount(row.opening)
      if (o !== null && (Number.isNaN(o) || o > MAX_OPENING_QTY)) {
        return fail(`${prefix}ยอดยกมาต้องเป็นจำนวนเต็ม 0 ถึง 100,000 ชิ้น`, fieldId(row.key, 'opening'))
      }
      opening = o ?? 0
    }

    norm.push({ row, size, sku, barcode, sell, cost, min, opening })
  }

  // ไซส์ซ้ำกันเอง (ไม่สนตัวพิมพ์)
  if (form.hasSizes) {
    const seen = new Map<string, Norm>()
    for (const n of norm) {
      const k = sizeKey(n.size)
      if (seen.has(k)) return fail(`ไซส์ "${n.size}" ซ้ำกัน — แต่ละไซส์ต้องไม่ซ้ำกัน`, fieldId(n.row.key, 'size'))
      seen.set(k, n)
    }
  }

  // รหัส (SKU/บาร์โค้ด) ของไซส์หนึ่งห้ามตรงกับรหัสของอีกไซส์ (หน้าขายสแกนแบบไม่สนตัวพิมพ์)
  const codes: { i: number; kind: 'sku' | 'barcode'; code: string }[] = []
  norm.forEach((n, i) => {
    codes.push({ i, kind: 'sku', code: n.sku.toLowerCase() })
    if (n.barcode) codes.push({ i, kind: 'barcode', code: n.barcode.toLowerCase() })
  })
  for (let a = 0; a < codes.length; a++) {
    for (let b = a + 1; b < codes.length; b++) {
      if (codes[a].i === codes[b].i || codes[a].code !== codes[b].code) continue
      const later = norm[codes[b].i]
      const code = codes[b].kind === 'sku' ? later.sku : (later.barcode ?? '')
      if (codes[a].kind === 'sku' && codes[b].kind === 'sku') {
        return fail(`SKU "${code}" ซ้ำกันในสินค้านี้ — แต่ละไซส์ต้องมี SKU ของตัวเอง`, fieldId(later.row.key, 'sku'))
      }
      return fail(`รหัส "${code}" ใช้ซ้ำกันหลายไซส์ในสินค้านี้ — SKU และบาร์โค้ดของแต่ละไซส์ต้องไม่ซ้ำกัน`, fieldId(later.row.key, codes[b].kind))
    }
  }

  // ชนกับไซส์ที่เลิกใช้ของสินค้านี้ → ให้นำไซส์เดิมกลับมาแทนการเพิ่มใหม่
  const sentIds = new Set(norm.map(n => n.row.id).filter((x): x is string => !!x))
  const archived = ctx.archived.filter(a => !sentIds.has(a.id))
  for (const n of norm) {
    for (const a of archived) {
      if (form.hasSizes && n.row.id === null && sizeKey(a.size) === sizeKey(n.size)) {
        return fail(`ไซส์ "${n.size}" มีอยู่แล้วในไซส์ที่เลิกใช้ (SKU "${a.sku}") — กด "นำกลับมาใช้" ที่ไซส์นั้นแทนการเพิ่มใหม่`, fieldId(n.row.key, 'size'))
      }
      const old = n.row.id ? loadedById.get(n.row.id) : undefined
      const skuChanged = !old || n.sku !== old.sku
      if (skuChanged && (sameCode(n.sku, a.sku) || sameCode(n.sku, a.barcode))) {
        return fail(`SKU "${n.sku}" เป็นของไซส์ที่เลิกใช้ (${a.size ?? 'ไม่มีไซส์'}) — ใช้ SKU อื่น หรือนำไซส์นั้นกลับมาใช้`, fieldId(n.row.key, 'sku'))
      }
      const bcChanged = !old || (n.barcode ?? '') !== (old.barcode ?? '')
      if (n.barcode && bcChanged && (sameCode(n.barcode, a.sku) || sameCode(n.barcode, a.barcode))) {
        return fail(`บาร์โค้ด "${n.barcode}" เป็นของไซส์ที่เลิกใช้ (${a.size ?? 'ไม่มีไซส์'}) — ใช้รหัสอื่น หรือนำไซส์นั้นกลับมาใช้`, fieldId(n.row.key, 'barcode'))
      }
    }
  }

  // ไซส์เดิมที่จะเอาออก แต่ยังมีสต๊อก → บันทึกไม่ได้ (ฐานข้อมูลตรวจซ้ำอีกชั้น)
  if (ctx.loaded) {
    for (const v of ctx.loaded.variants) {
      if (sentIds.has(v.id) || v.stock_qty === 0) continue
      return fail(
        `ไซส์ "${v.size ?? 'ไม่มีไซส์'}" (SKU "${v.sku}") ยังมีสต๊อก ${v.stock_qty} ชิ้น เอาออกไม่ได้ — ปรับยอดเป็น 0 ที่เมนูรับ-จ่ายสต๊อกก่อน หรือปิดขายเฉพาะไซส์นี้แทน`,
        'pf-has-sizes',
      )
    }
  }

  const loaded = ctx.loaded
  const p_group: GroupInput = loaded
    ? {
      id: loaded.id,
      updated_at: loaded.updated_at,
      name,
      category_id: form.categoryId || null,
      color: color || null,
      description: description || null,
      has_sizes: form.hasSizes,
      is_active: loaded.is_active,
    }
    : {
      client_id: ctx.clientId,
      name,
      category_id: form.categoryId || null,
      color: color || null,
      description: description || null,
      has_sizes: form.hasSizes,
      is_active: true,
    }

  const p_variants: VariantInput[] = norm.map(n => {
    const v: VariantInput = {
      id: n.row.id,
      size: form.hasSizes ? n.size : null,
      sku: n.sku,
      barcode: n.barcode,
      cost_price: n.cost,
      sell_price: n.sell,
      min_stock: n.min,
      // ไม่มีไซส์: เปิด/ปิดขายคุมที่ปุ่มของทั้งสินค้า
      is_active: form.hasSizes ? n.row.active : true,
    }
    if (n.row.id === null && n.opening > 0) v.opening_qty = n.opening
    return v
  })

  return { ok: true, payload: { p_group, p_variants } }
}

function sameCode(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

// ===== ข้อผิดพลาดจากฐานข้อมูล → ช่องที่เกี่ยวข้อง (ให้ช่องนั้นขึ้นกรอบแดง) =====
export function locateServerError(message: string, form: FormState): string | null {
  const rows = form.hasSizes ? form.rows : form.rows.slice(0, 1)
  const bySize = (size: string) => rows.find(r => sizeKey(r.size) === sizeKey(size))
  const m = /^ไซส์ (.+?): (SKU|บาร์โค้ด|กรุณากรอก SKU|กรุณากรอกราคาขาย|ราคาขาย|ราคาทุน|จำนวนขั้นต่ำ|ยอดยกมา|ใส่ยอดยกมา)/.exec(message)
  if (m) {
    const row = bySize(m[1])
    if (row) {
      const f = m[2]
      if (f.includes('SKU')) return fieldId(row.key, 'sku')
      if (f === 'บาร์โค้ด') return fieldId(row.key, 'barcode')
      if (f.includes('ราคาขาย')) return fieldId(row.key, 'sell')
      if (f === 'ราคาทุน') return fieldId(row.key, 'cost')
      if (f === 'จำนวนขั้นต่ำ') return fieldId(row.key, 'min')
      return fieldId(row.key, 'opening')
    }
  }
  const dupSku = /^SKU "(.+?)" ซ้ำ/.exec(message)
  if (dupSku) {
    const row = rows.find(r => sameCode(cleanText(r.sku), dupSku[1]))
    if (row) return fieldId(row.key, 'sku')
  }
  const dupBc = /^บาร์โค้ด "(.+?)" ซ้ำ/.exec(message)
  if (dupBc) {
    const row = rows.find(r => sameCode(barcodeValue(r.barcode), dupBc[1]))
    if (row) return fieldId(row.key, 'barcode')
  }
  const sizeMsg = /^ไซส์ "(.+?)" (ยาวเกินไป|ซ้ำกัน|มีอักขระ|มีอยู่แล้ว)/.exec(message)
  if (sizeMsg) {
    const row = bySize(sizeMsg[1])
    if (row) return fieldId(row.key, 'size')
  }
  if (message.startsWith('กรุณากรอกชื่อสินค้า') || message.startsWith('ชื่อสินค้า')) return 'pf-name'
  if (message.startsWith('ชื่อสี')) return 'pf-color'
  if (message.startsWith('รายละเอียดสินค้า')) return 'pf-desc'
  if (message.includes('หมวดหมู่')) return 'pf-category'
  return null
}

// ===== บันทึกหลุด (ไม่ได้คำตอบ) แล้วลองใหม่: ข้อมูลล่าสุดในฐานข้อมูลตรงกับที่เราส่งไปหรือไม่ =====
export function matchesPayload(fresh: ProductGroupJson, payload: SavePayload): boolean {
  const g = payload.p_group
  if (fresh.name !== g.name) return false
  if ((fresh.category_id ?? null) !== (g.category_id ?? null)) return false
  if ((fresh.color ?? null) !== (g.color ?? null)) return false
  if ((fresh.description ?? null) !== (g.description ?? null)) return false
  if (fresh.has_sizes !== g.has_sizes) return false
  if (typeof g.is_active === 'boolean' && fresh.is_active !== g.is_active) return false
  if (fresh.variants.length !== payload.p_variants.length) return false
  const used = new Set<string>()
  for (const p of payload.p_variants) {
    const v = p.id
      ? fresh.variants.find(x => x.id === p.id)
      : fresh.variants.find(x => !used.has(x.id) && sizeKey(x.size) === sizeKey(p.size ?? null) && sameCode(x.sku, p.sku))
    if (!v) return false
    used.add(v.id)
    if (sizeKey(v.size) !== sizeKey(p.size ?? null)) return false
    if (v.sku !== p.sku) return false
    if ((v.barcode ?? null) !== (p.barcode ?? null)) return false
    if (Number(v.sell_price) !== Number(p.sell_price)) return false
    if (Number(v.cost_price) !== Number(p.cost_price ?? 0)) return false
    if (Number(v.min_stock) !== Number(p.min_stock ?? 0)) return false
    // สินค้าปิดใช้งานทั้งแบบ = ทุกไซส์ปิดเสมอ (ไม่ต้องเทียบรายไซส์)
    if (fresh.is_active && v.is_active !== (p.is_active !== false)) return false
  }
  return true
}

// ===== บันทึกชนกับเครื่องอื่น: รวมข้อมูลล่าสุดกับสิ่งที่ผู้ใช้พิมพ์ไว้ =====
// ช่องที่ผู้ใช้แก้ (ต่างจากตอนโหลด) = ใช้ของผู้ใช้ / ช่องที่ไม่ได้แก้ = ใช้ค่าล่าสุดจากฐานข้อมูล
// จับคู่แถวด้วย id ของไซส์ · ไซส์ใหม่ที่ยังไม่มี id เก็บไว้ตามเดิม
export type MergeResult = { form: FormState; changes: string[] }

type LabelCtx = { categoryName: (id: string | null) => string }

function q(s: string | null | undefined): string {
  const t = cleanText(s)
  return t ? `"${t}"` : '(ว่าง)'
}

function sizeLabel(size: string | null | undefined): string {
  const s = cleanText(size)
  return s || 'ไม่มีไซส์'
}

function variantDiffs(base: VariantJson, fresh: VariantJson): string[] {
  const out: string[] = []
  const label = `ไซส์ ${sizeLabel(fresh.size)}`
  if ((base.size ?? '') !== (fresh.size ?? '')) out.push(`${label}: เปลี่ยนชื่อไซส์จาก ${q(base.size)}`)
  if (base.sku !== fresh.sku) out.push(`${label}: SKU ${base.sku} → ${fresh.sku}`)
  if ((base.barcode ?? '') !== (fresh.barcode ?? '')) out.push(`${label}: บาร์โค้ด ${base.barcode || '-'} → ${fresh.barcode || '-'}`)
  if (Number(base.sell_price) !== Number(fresh.sell_price)) out.push(`${label}: ราคาขาย ${baht(base.sell_price)} → ${baht(fresh.sell_price)}`)
  if (Number(base.cost_price) !== Number(fresh.cost_price)) out.push(`${label}: ราคาทุน ${baht(base.cost_price)} → ${baht(fresh.cost_price)}`)
  if (Number(base.min_stock) !== Number(fresh.min_stock)) out.push(`${label}: จำนวนขั้นต่ำ ${base.min_stock} → ${fresh.min_stock}`)
  if (base.is_active !== fresh.is_active) out.push(`${label}: ${fresh.is_active ? 'เปิดขาย' : 'ปิดขาย'}`)
  // สต๊อกเปลี่ยน (ขาย/รับ-จ่าย) ไม่นับเป็นการแก้ไขสินค้า — ช่องคงเหลือแสดงค่าล่าสุดอยู่แล้ว
  return out
}

function mergeRow(local: RowState, base: VariantJson | undefined, fresh: VariantJson): RowState {
  const b = base ? rowFromVariant(base) : null
  const f = rowFromVariant(fresh)
  const pick = <K extends keyof RowState>(k: K): RowState[K] => (b && local[k] === b[k] ? f[k] : local[k])
  return {
    ...local,
    id: fresh.id,
    size: pick('size'),
    sku: pick('sku'),
    barcode: pick('barcode'),
    cost: pick('cost'),
    sell: pick('sell'),
    min: pick('min'),
    active: pick('active'),
    skuAuto: false,
    opening: '',
    stock: fresh.stock_qty,
    hasHistory: fresh.has_history,
  }
}

export function mergeAfterConflict(base: ProductGroupJson, fresh: ProductGroupJson, form: FormState, ctx: LabelCtx): MergeResult {
  const changes: string[] = []
  const baseForm = formFromJson(base)
  const freshForm = formFromJson(fresh)

  // ----- หัวสินค้า -----
  const pickText = (k: 'name' | 'categoryId' | 'color' | 'description'): string =>
    form[k] !== baseForm[k] ? form[k] : freshForm[k]
  if (base.name !== fresh.name) {
    changes.push(`ชื่อสินค้า: ${q(base.name)} → ${q(fresh.name)}${form.name !== baseForm.name ? ' (ใช้ชื่อที่คุณแก้ไว้)' : ''}`)
  }
  if ((base.category_id ?? null) !== (fresh.category_id ?? null)) {
    changes.push(`หมวดหมู่: ${ctx.categoryName(base.category_id)} → ${ctx.categoryName(fresh.category_id)}${form.categoryId !== baseForm.categoryId ? ' (ใช้ที่คุณเลือกไว้)' : ''}`)
  }
  if ((base.color ?? '') !== (fresh.color ?? '')) {
    changes.push(`สี: ${q(base.color)} → ${q(fresh.color)}${form.color !== baseForm.color ? ' (ใช้ที่คุณแก้ไว้)' : ''}`)
  }
  if ((base.description ?? '') !== (fresh.description ?? '')) changes.push('รายละเอียดสินค้าถูกแก้ไข')
  if (base.is_active !== fresh.is_active) changes.push(`สถานะ: ${fresh.is_active ? 'เปิดขาย' : 'ปิดใช้งาน'}ทั้งสินค้า`)

  const userToggled = form.hasSizes !== base.has_sizes
  const hasSizes = userToggled ? form.hasSizes : fresh.has_sizes
  if (base.has_sizes !== fresh.has_sizes) {
    changes.push(`เปลี่ยนเป็นสินค้าแบบ${fresh.has_sizes ? 'มีไซส์' : 'ไม่มีไซส์'}${userToggled ? ' (ใช้แบบที่คุณเลือกไว้)' : ''}`)
  }

  // ----- ไซส์ -----
  const baseById = new Map(base.variants.map(v => [v.id, v] as const))
  const baseArchivedById = new Map(base.archived_variants.map(v => [v.id, v] as const))
  const freshById = new Map(fresh.variants.map(v => [v.id, v] as const))
  const freshArchivedById = new Map(fresh.archived_variants.map(v => [v.id, v] as const))
  const matched = new Set<string>()
  const rows: RowState[] = []

  for (const r of form.rows) {
    if (r.id) {
      const fv = freshById.get(r.id)
      if (fv) {
        const bv = baseById.get(r.id) ?? baseArchivedById.get(r.id)
        if (bv) changes.push(...variantDiffs(bv, fv))
        rows.push(mergeRow(r, bv, fv))
        matched.add(fv.id)
        continue
      }
      const fa = freshArchivedById.get(r.id)
      if (fa) {
        if (baseArchivedById.has(r.id)) {
          // ผู้ใช้กำลังนำไซส์ที่เลิกใช้กลับมา (ยังเลิกใช้อยู่ในฐานข้อมูล) → เก็บไว้
          rows.push({ ...r, stock: fa.stock_qty, hasHistory: fa.has_history })
          matched.add(fa.id)
        } else {
          changes.push(`ไซส์ ${sizeLabel(fa.size)} (SKU ${fa.sku}) ถูกเอาออกจากเครื่องอื่น — เก็บไว้ในไซส์ที่เลิกใช้`)
        }
        continue
      }
      changes.push(`ไซส์ ${sizeLabel(r.size)} (SKU ${r.sku}) ถูกลบจากเครื่องอื่นแล้ว`)
      continue
    }
    // แถวใหม่ของผู้ใช้: ถ้าเครื่องอื่นเพิ่งเพิ่มไซส์เดียวกันไว้ → ใช้แถวนั้น (มี id แล้ว) แต่คงค่าที่ผู้ใช้กรอก
    const twin = fresh.variants.find(v =>
      !matched.has(v.id) && !baseById.has(v.id) && sizeKey(v.size) === sizeKey(hasSizes ? r.size : null))
    if (twin) {
      matched.add(twin.id)
      changes.push(`ไซส์ ${sizeLabel(twin.size)} ถูกเพิ่มจากเครื่องอื่นแล้ว (SKU ${twin.sku}) — แสดงค่าที่คุณกรอกไว้แทน`)
      rows.push({ ...r, key: twin.id, id: twin.id, skuAuto: false, opening: '', stock: twin.stock_qty, hasHistory: twin.has_history })
      continue
    }
    rows.push(r)
  }

  // ไซส์ที่เครื่องอื่นเพิ่ม/นำกลับมา (ไม่มีในข้อมูลตอนโหลด)
  const addedElsewhere: VariantJson[] = []
  for (const v of fresh.variants) {
    if (matched.has(v.id) || baseById.has(v.id)) continue
    addedElsewhere.push(v)
  }

  let finalRows = rows
  if (hasSizes) {
    for (const v of addedElsewhere) {
      changes.push(`ไซส์ ${sizeLabel(v.size)} (SKU ${v.sku}) ถูก${baseArchivedById.has(v.id) ? 'นำกลับมาใช้' : 'เพิ่ม'}จากเครื่องอื่น`)
      finalRows.push(rowFromVariant(v))
    }
  } else {
    for (const v of addedElsewhere) {
      changes.push(`ไซส์ ${sizeLabel(v.size)} (SKU ${v.sku}) ถูกเพิ่มจากเครื่องอื่น${userToggled ? ' — จะถูกเอาออกเมื่อบันทึก เพราะคุณเปลี่ยนเป็นไม่มีไซส์' : ''}`)
    }
    if (!userToggled) {
      // เครื่องอื่นเปลี่ยนเป็นไม่มีไซส์ (หรือเป็นอยู่แล้ว) → เหลือรายการเดียวตามฐานข้อมูล
      const keepId = fresh.variants[0]?.id
      const kept = finalRows.find(r => r.id === keepId) ?? (fresh.variants[0] ? rowFromVariant(fresh.variants[0]) : finalRows[0])
      finalRows = kept ? [kept] : [newRow()]
    } else if (finalRows.length !== 1) {
      finalRows = finalRows.slice(0, 1)
      if (finalRows.length === 0) finalRows = [newRow()]
    }
  }
  if (finalRows.length === 0) finalRows = hasSizes ? [] : [newRow()]

  const merged: FormState = {
    name: pickText('name'),
    categoryId: pickText('categoryId'),
    color: pickText('color'),
    description: pickText('description'),
    hasSizes,
    baseSku: form.baseSku || freshForm.baseSku,
    rows: hasSizes ? sortRows(finalRows) : finalRows,
  }

  // ไม่ซ้ำ + ไม่ยาวเกินไป
  const unique = Array.from(new Set(changes))
  return { form: merged, changes: unique }
}

/** ข้อมูลตอนโหลด + ผลของปุ่มเปิด/ปิดขายทั้งสินค้า — ใช้หาว่าระหว่างนี้เครื่องอื่นแก้อย่างอื่นด้วยหรือไม่ */
export function withActivation(base: ProductGroupJson, fresh: ProductGroupJson): ProductGroupJson {
  const act = new Map<string, boolean>()
  for (const v of fresh.variants) act.set(v.id, v.is_active)
  for (const v of fresh.archived_variants) act.set(v.id, v.is_active)
  return {
    ...base,
    is_active: fresh.is_active,
    variants: base.variants.map(v => ({ ...v, is_active: act.get(v.id) ?? v.is_active })),
  }
}

/** หลังเปิด/ปิดขายทั้งสินค้า: เอาสถานะเปิดขายรายไซส์ + สต๊อกจากฐานข้อมูล ส่วนช่องอื่นคงที่ผู้ใช้พิมพ์ไว้ */
export function rebaseAfterActivation(form: FormState, fresh: ProductGroupJson): FormState {
  const byId = new Map(fresh.variants.map(v => [v.id, v] as const))
  return {
    ...form,
    rows: form.rows.map(r => {
      const v = r.id ? byId.get(r.id) : undefined
      return v ? { ...r, active: v.is_active, stock: v.stock_qty, hasHistory: v.has_history } : r
    }),
  }
}
