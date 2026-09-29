// ===== สินค้าแบบ "แบบสินค้า" (product_groups) — 1 แบบ = 1 การ์ด, แต่ละไซส์ = 1 SKU (products) =====
// ใช้ร่วมกันทั้งหน้ารายการสินค้า (การ์ด) และหน้าฟอร์มเพิ่ม/แก้ไขสินค้า
// สัญญากับฐานข้อมูล: supabase-fix-02.sql (CONTRACT.md) — RPC save_product_group / get_product_group / ... และถังรูป product-images
//
// ไฟล์นี้ import ได้ทั้งฝั่ง server และ client: ฟังก์ชันที่ใช้ canvas/document (ย่อรูป) ทำงานเฉพาะตอนถูกเรียกในเบราว์เซอร์เท่านั้น

import { thaiError } from '@/lib/format'
import type { createClient as createBrowserSupabase } from '@/lib/supabase/client'

// ===== ชนิดข้อมูลที่หน้ารายการสินค้า (การ์ด) ใช้ =====
export type ProductVariant = {
  id: string
  size: string | null
  sku: string
  barcode: string | null
  cost_price: number
  sell_price: number
  min_stock: number
  stock_qty: number
  is_active: boolean
  has_history?: boolean
}

export type ProductImage = {
  id: string
  path: string
  sort_order: number
  width: number | null
  height: number | null
}

export type ProductGroupCard = {
  id: string
  name: string
  category_id: string | null
  color: string | null
  has_sizes: boolean
  is_active: boolean
  updated_at: string
  variants: ProductVariant[]
  cover_path: string | null
}

// ===== JSON จาก RPC (CONTRACT §2) =====
export interface VariantJson {
  id: string
  size: string | null
  sku: string
  barcode: string | null
  cost_price: number
  sell_price: number
  min_stock: number
  stock_qty: number
  is_active: boolean
  has_history: boolean // เคยขาย / เคยรับ-จ่ายสต๊อก / สต๊อกไม่เป็น 0 → เอาออกแล้วจะถูกเก็บเป็น "ไซส์ที่เลิกใช้"
}

export interface ProductImageJson {
  id: string
  path: string
  sort_order: number
  width: number | null
  height: number | null
}

export interface ProductGroupJson {
  id: string
  name: string
  category_id: string | null
  color: string | null
  description: string | null
  has_sizes: boolean
  is_active: boolean
  has_sales: boolean
  created_at: string
  // เวอร์ชันของแบบสินค้า — เก็บเป็นสตริงตามที่ได้รับทุกตัวอักษร ห้ามแปลงเป็น Date (มิลลิวินาทีจะหาย ทำให้บันทึกไม่ผ่าน)
  updated_at: string
  variants: VariantJson[]
  archived_variants: VariantJson[]
  images: ProductImageJson[]
}

export interface SaveResultJson extends ProductGroupJson {
  already_saved: boolean
}

export interface AddedImageJson extends ProductImageJson {
  group_id: string
  bytes: number | null
  created_at: string
}

export interface DeletedGroupJson {
  deleted: true
  id: string
  image_paths: string[]
}

export interface GroupInput {
  id?: string | null
  updated_at?: string
  client_id?: string | null
  name: string
  category_id?: string | null
  color?: string | null
  description?: string | null
  has_sizes: boolean
  is_active?: boolean
}

export interface VariantInput {
  id?: string | null
  size?: string | null
  sku: string
  barcode?: string | null
  sell_price: number | string
  cost_price?: number | string | null
  min_stock?: number | string | null
  is_active?: boolean
  opening_qty?: number | null
}

export type BrowserSupabase = ReturnType<typeof createBrowserSupabase>

// ===== ค่าคงที่ (ตรงกับข้อบังคับในฐานข้อมูล) =====
export const PRODUCT_IMAGE_BUCKET = 'product-images'
export const MAX_NAME = 200
export const MAX_COLOR = 100
export const MAX_DESCRIPTION = 2000
export const MAX_SIZE_LEN = 20
export const MAX_CODE_LEN = 64
export const MAX_SIZES = 50
export const MAX_MONEY = 99999999.99
export const MAX_MIN_STOCK = 1000000
export const MAX_OPENING_QTY = 100000
export const MAX_IMAGE_BYTES = 5242880 // 5 MB (ถังรูปรับได้ไม่เกินนี้)
export const MAX_IMAGE_EDGE = 1600

// ไซส์ที่กดเพิ่มได้ทันที (ปุ่มลัด)
export const COMMON_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', 'Free size'] as const

// ===== รูปสินค้า: ลิงก์สาธารณะ =====
/** ลิงก์รูปในถัง product-images (ถังเป็น public) — path = '<group_id>/<ไฟล์>' */
export function productImageUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
  const encoded = String(path ?? '')
    .split('/')
    .filter(part => part !== '')
    .map(part => encodeURIComponent(part))
    .join('/')
  return `${base}/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/${encoded}`
}

// ===== ข้อความ =====
// ตัดช่องว่าง + อักขระที่มองไม่เห็นหัวท้าย (NBSP, zero-width, BOM, ช่องว่างเต็มความกว้าง, ตัวคุมทิศทาง) — ตรงกับที่ฐานข้อมูลตัด
const EDGE_JUNK = /^[\s\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]+|[\s\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]+$/g

/** ทำความสะอาดข้อความก่อนบันทึก/เทียบซ้ำ (NFC + ตัดของที่มองไม่เห็นหัวท้าย) */
export function cleanText(s: string | null | undefined): string {
  if (s === null || s === undefined) return ''
  return String(s).normalize('NFC').replace(EDGE_JUNK, '')
}

// อักขระที่มองไม่เห็น "กลางคำ" ในไซส์ (ติดมาตอนก๊อปวาง) — ฐานข้อมูลปฏิเสธไซส์ใหม่/ที่แก้ที่มีตัวพวกนี้
const INVISIBLE_INSIDE = /[\x01-\x1f\x7f-\x9f\xa0\xad\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff]/

export function hasInvisibleChars(s: string): boolean {
  return INVISIBLE_INSIDE.test(s)
}

/** ตัวอักษร ASCII ที่พิมพ์ได้ล้วน (เว้นวรรค .. ~) — กติกาเดียวกับ SKU/บาร์โค้ดในฐานข้อมูล */
export function isPrintableCode(s: string): boolean {
  return /^[\x20-\x7E]+$/.test(s)
}

// ===== ลำดับไซส์ (เหมือน product_size_rank ในฐานข้อมูล) =====
// (ไม่มีไซส์) → XXS XS S M L XL 2XL 3XL 4XL 5XL → ไซส์อื่น (เลขนำหน้าน้อยไปมาก แล้วตามตัวอักษร) → Free/ฟรีไซส์ ท้ายสุด
const SIZE_RANK: Record<string, number> = {
  '': 0,
  XXS: 5, '2XS': 5,
  XS: 10,
  S: 20,
  M: 30,
  L: 40,
  XL: 50,
  '2XL': 60, XXL: 60,
  '3XL': 70, XXXL: 70,
  '4XL': 80, XXXXL: 80,
  '5XL': 90, XXXXXL: 90,
  F: 1000, FS: 1000, FREE: 1000, FREESIZE: 1000,
  'ฟรีไซส์': 1000, 'ฟรีไซซ์': 1000, 'ฟรีไซด์': 1000,
}

export function sizeRank(size: string | null | undefined): number {
  const key = String(size ?? '').replace(/\s+/g, '').toUpperCase()
  return Object.prototype.hasOwnProperty.call(SIZE_RANK, key) ? SIZE_RANK[key] : 500
}

function leadingNumber(size: string | null | undefined): number | null {
  const m = /^[0-9]{1,6}(?:\.[0-9]{1,3})?/.exec(String(size ?? '').trim())
  return m ? Number(m[0]) : null
}

/** เทียบไซส์ตามลำดับของระบบ (ใช้กับ Array.sort) */
export function compareSizes(a: string | null | undefined, b: string | null | undefined): number {
  const ra = sizeRank(a)
  const rb = sizeRank(b)
  if (ra !== rb) return ra - rb
  const na = leadingNumber(a)
  const nb = leadingNumber(b)
  if (na !== nb) {
    if (na === null) return 1 // ไม่มีเลขนำหน้าไปท้าย
    if (nb === null) return -1
    return na - nb
  }
  const la = String(a ?? '').toLowerCase()
  const lb = String(b ?? '').toLowerCase()
  return la < lb ? -1 : la > lb ? 1 : 0
}

/** เรียงไซส์ตามลำดับของระบบ (คืน array ใหม่ ไม่แก้ของเดิม; ไซส์ที่เท่ากันคงลำดับเดิม) */
export function sortVariantsBySize<T extends { size: string | null }>(v: T[]): T[] {
  return v
    .map((item, index) => ({ item, index }))
    .sort((x, y) => compareSizes(x.item.size, y.item.size) || x.index - y.index)
    .map(x => x.item)
}

/** ช่วงราคาขาย (ราคาต่ำสุด-สูงสุดของทุกไซส์ที่ส่งมา) — ไม่มีไซส์ = 0-0 */
export function priceRange(v: ProductVariant[]): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < v.length; i++) {
    const n = Number(v[i].sell_price)
    if (!Number.isFinite(n)) continue
    if (n < min) min = n
    if (n > max) max = n
  }
  if (min === Infinity) return { min: 0, max: 0 }
  return { min, max }
}

/** คีย์เทียบไซส์ซ้ำ (ไม่สนตัวพิมพ์เล็ก/ใหญ่ + ตัดของที่มองไม่เห็นหัวท้าย) — ไม่มีไซส์ = '' */
export function sizeKey(size: string | null | undefined): string {
  return cleanText(size).toLowerCase()
}

// ===== SKU อัตโนมัติ: SKU ตั้งต้น + '-' + ไซส์ =====
/** ส่วนไซส์ใน SKU: ตัวพิมพ์ใหญ่ ตัดช่องว่าง เหลือเฉพาะ A-Z 0-9 . _ - (ฟรีไซส์ = FREE) */
export function skuSizePart(size: string | null | undefined): string {
  const s = cleanText(size)
  if (!s) return ''
  if (sizeRank(s) === 1000) return 'FREE'
  return s.toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9._-]/g, '')
}

/** SKU ที่แนะนำของไซส์นี้ เช่น ('SHIRT-001', 'M') → 'SHIRT-001-M' ; ไม่มี SKU ตั้งต้น/ไซส์เป็นภาษาไทยล้วน → '' */
export function suggestSku(base: string, size: string | null | undefined): string {
  const b = cleanText(base)
  const part = skuSizePart(size)
  if (!b || !part) return ''
  return `${b}-${part}`.slice(0, MAX_CODE_LEN)
}

// ===== ข้อผิดพลาด =====
const CONFLICT_MARK = 'ถูกแก้ไขจากเครื่องอื่นหลังจากที่คุณเปิดหน้านี้'

/** บันทึกไม่ผ่านเพราะมีเครื่องอื่นแก้สินค้านี้หลังจากเปิดฟอร์ม (เช็กเวอร์ชัน updated_at) */
export function isVersionConflict(message: string): boolean {
  return message.includes(CONFLICT_MARK)
}

/** ข้อความจากฐานข้อมูลที่บอกให้โหลดข้อมูลใหม่ (ข้อมูลในฟอร์มเก่าแล้ว) */
export function needsReload(message: string): boolean {
  return isVersionConflict(message) || message.includes('โหลดหน้าใหม่')
}

function errorParts(err: unknown): { code: string; message: string; status: number } {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; message?: unknown; status?: unknown; statusCode?: unknown }
    const code = e.code === null || e.code === undefined ? '' : String(e.code)
    const message = typeof e.message === 'string' ? e.message : ''
    let status = Number(e.status)
    if (!Number.isFinite(status) || status <= 0) status = Number(e.statusCode)
    return { code, message, status: Number.isFinite(status) ? status : 0 }
  }
  return { code: '', message: typeof err === 'string' ? err : '', status: 0 }
}

/** เน็ตหลุด / ต่อเซิร์ฟเวอร์ไม่ได้ (ไม่ได้คำตอบจากฐานข้อมูล — คำขออาจสำเร็จไปแล้วหรือไม่ก็ได้) */
export function isNetworkError(err: unknown): boolean {
  const { code, message } = errorParts(err)
  if (code && code !== 'ECONNRESET' && code !== 'ETIMEDOUT') return false
  return /failed to fetch|fetch failed|networkerror|network request failed|network error|load failed|timed? ?out|econnreset|etimedout|err_internet_disconnected|err_network/i.test(message)
}

/** ข้อผิดพลาดจาก Storage (ภาษาอังกฤษ) → ภาษาไทย (CONTRACT §4) */
export function storageThaiError(err: unknown): string {
  const { message, status } = errorParts(err)
  const text = message.toLowerCase()
  if (status === 413 || /maximum allowed size|too large|payload too large|exceeded the maximum/.test(text)) {
    return 'รูปใหญ่เกิน 5 MB — ลองเลือกรูปที่เล็กลง'
  }
  if (/mime type|not supported|invalid_mime/.test(text)) return 'รองรับเฉพาะรูป JPG, PNG หรือ WEBP'
  if (/jwt|token.*expired|expired.*token/.test(text)) return 'หมดเวลาเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่'
  if (status === 403 || /row-level security|row level security|unauthorized|not authorized|permission/.test(text)) {
    return 'ไม่มีสิทธิ์อัปโหลดรูปสินค้า'
  }
  if (status === 409 || /already exists|duplicate/.test(text)) return 'อัปโหลดซ้ำ กรุณาลองใหม่'
  return 'อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่'
}

function isStorageDuplicate(err: unknown): boolean {
  const { message, status } = errorParts(err)
  return status === 409 || /already exists|duplicate/i.test(message)
}

// ===== ตรวจรูปร่าง JSON ที่ได้จาก RPC (กันหน้าพังถ้าฐานข้อมูลยังไม่ได้อัปเดต) =====
function toNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function toVariant(v: unknown): VariantJson | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.sku !== 'string') return null
  return {
    id: o.id,
    size: typeof o.size === 'string' ? o.size : null,
    sku: o.sku,
    barcode: typeof o.barcode === 'string' ? o.barcode : null,
    cost_price: toNum(o.cost_price),
    sell_price: toNum(o.sell_price),
    min_stock: toNum(o.min_stock),
    stock_qty: toNum(o.stock_qty),
    is_active: o.is_active === true,
    has_history: o.has_history === true,
  }
}

function toImage(v: unknown): ProductImageJson | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.path !== 'string') return null
  const w = Number(o.width)
  const h = Number(o.height)
  return {
    id: o.id,
    path: o.path,
    sort_order: toNum(o.sort_order),
    width: Number.isFinite(w) && w > 0 ? w : null,
    height: Number.isFinite(h) && h > 0 ? h : null,
  }
}

function list<T>(v: unknown, map: (x: unknown) => T | null): T[] {
  if (!Array.isArray(v)) return []
  const out: T[] = []
  for (let i = 0; i < v.length; i++) {
    const m = map(v[i])
    if (m) out.push(m)
  }
  return out
}

/** แปลงผลของ get_product_group / save_product_group / set_product_group_active เป็นชนิดที่ใช้ได้ (ผิดรูป = null) */
export function parseGroupJson(data: unknown): ProductGroupJson | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const o = data as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.updated_at !== 'string') return null
  return {
    id: o.id,
    name: typeof o.name === 'string' ? o.name : '',
    category_id: typeof o.category_id === 'string' ? o.category_id : null,
    color: typeof o.color === 'string' ? o.color : null,
    description: typeof o.description === 'string' ? o.description : null,
    has_sizes: o.has_sizes === true,
    is_active: o.is_active === true,
    has_sales: o.has_sales === true,
    created_at: typeof o.created_at === 'string' ? o.created_at : '',
    updated_at: o.updated_at,
    variants: list(o.variants, toVariant),
    archived_variants: list(o.archived_variants, toVariant),
    images: list(o.images, toImage).sort((a, b) => a.sort_order - b.sort_order),
  }
}

export function parseSaveResult(data: unknown): SaveResultJson | null {
  const g = parseGroupJson(data)
  if (!g) return null
  const already = !!data && typeof data === 'object' && (data as { already_saved?: unknown }).already_saved === true
  return { ...g, already_saved: already }
}

// ===== uuid (รหัสคำขอ / ชื่อไฟล์รูป) — ตัวพิมพ์เล็กเสมอ =====
export function newUuid(): string {
  const c = typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().toLowerCase()
  const b = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const hex: string[] = []
  for (let i = 0; i < 16; i++) hex.push((b[i] + 0x100).toString(16).slice(1))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
}

// ===== ย่อรูปฝั่งเครื่อง (CONTRACT §4) =====
// ขอบยาวสุด 1600px, พื้นขาว (PNG โปร่งใสไม่กลายเป็นดำ), WebP 0.8 → ถ้าเบราว์เซอร์ทำ WebP ไม่ได้ (Safari/iOS คืน PNG มาเงียบๆ)
// ใช้ JPEG 0.82 แทน · เกิน 5 MB → ย่อลงอีก (ขอบ ×0.8, คุณภาพ −0.1 ไม่ต่ำกว่า 0.6) สูงสุด 3 ครั้ง

export type CompressedImage = {
  blob: Blob
  width: number
  height: number
  contentType: string
  ext: 'webp' | 'jpg' | 'png'
}

const MSG_DECODE = 'เปิดไฟล์รูปนี้ไม่ได้ — ลองเลือกรูปอื่น (รองรับ JPG, PNG, WEBP)'
const MSG_ENCODE = 'ย่อรูปไม่สำเร็จ (หน่วยความจำเครื่องอาจไม่พอ) — ลองใหม่หรือเลือกรูปที่เล็กลง'
const MSG_TOO_BIG = 'รูปใหญ่เกิน 5 MB — ลองเลือกรูปที่เล็กลง'

// จำไว้ว่าเบราว์เซอร์นี้เข้ารหัส WebP ได้ไหม (ไม่ต้องลองซ้ำทุกรูป)
let webpEncodeOk: boolean | null = null

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(MSG_DECODE))
    }
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error(MSG_ENCODE))), type, quality)
    } catch {
      reject(new Error(MSG_ENCODE))
    }
  })
}

async function encodeCanvas(canvas: HTMLCanvasElement, qWebp: number, qJpeg: number): Promise<Blob> {
  if (webpEncodeOk !== false) {
    const webp = await canvasToBlob(canvas, 'image/webp', qWebp)
    if (webp.type === 'image/webp') {
      webpEncodeOk = true
      return webp
    }
    webpEncodeOk = false // Safari/iOS: ได้ PNG มาแทน → ใช้ JPEG
  }
  return canvasToBlob(canvas, 'image/jpeg', qJpeg)
}

function extOf(type: string): CompressedImage['ext'] | null {
  if (type === 'image/webp') return 'webp'
  if (type === 'image/jpeg') return 'jpg'
  if (type === 'image/png') return 'png'
  return null
}

/** ย่อ + แปลงรูปที่เลือกให้พร้อมอัปโหลด (เรียกได้เฉพาะในเบราว์เซอร์) */
export async function compressImage(file: Blob): Promise<CompressedImage> {
  if (file.type && !file.type.startsWith('image/')) throw new Error('ไฟล์นี้ไม่ใช่รูปภาพ')
  const img = await loadImage(file)
  const srcW = img.naturalWidth
  const srcH = img.naturalHeight
  if (!srcW || !srcH) throw new Error(MSG_DECODE)

  let edge = Math.min(MAX_IMAGE_EDGE, Math.max(srcW, srcH))
  let qWebp = 0.8
  let qJpeg = 0.82
  for (let attempt = 0; attempt < 4; attempt++) {
    const scale = edge / Math.max(srcW, srcH)
    const w = Math.max(1, Math.round(srcW * scale))
    const h = Math.max(1, Math.round(srcH * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error(MSG_ENCODE)
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, w, h)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, w, h)
    let blob: Blob
    try {
      blob = await encodeCanvas(canvas, qWebp, qJpeg)
    } finally {
      // คืนหน่วยความจำ canvas ทันที (iPhone/iPad มีเพดานรวมของ canvas)
      canvas.width = 0
      canvas.height = 0
    }
    const ext = extOf(blob.type)
    if (!ext) throw new Error('รองรับเฉพาะรูป JPG, PNG หรือ WEBP')
    if (blob.size <= MAX_IMAGE_BYTES) return { blob, width: w, height: h, contentType: blob.type, ext }
    edge = Math.max(1, Math.round(edge * 0.8))
    qWebp = Math.max(0.6, Math.round((qWebp - 0.1) * 100) / 100)
    qJpeg = Math.max(0.6, Math.round((qJpeg - 0.1) * 100) / 100)
  }
  throw new Error(MSG_TOO_BIG)
}

// ===== อัปโหลด / ลงทะเบียน / ลบไฟล์รูป =====

/** อัปโหลดไฟล์ขึ้นถัง product-images (ชื่อใหม่ทุกครั้ง ห้ามทับ) → คืน path '<group_id>/<uuid>.<ext>' */
export async function uploadImageFile(supabase: BrowserSupabase, groupId: string, img: CompressedImage): Promise<string> {
  const gid = groupId.toLowerCase()
  let lastErr: unknown = null
  // ชื่อไฟล์ชนกัน (409) → สุ่มชื่อใหม่แล้วลองอีกครั้งเดียว
  for (let attempt = 0; attempt < 2; attempt++) {
    const path = `${gid}/${newUuid()}.${img.ext}`
    let error: unknown = null
    try {
      const res = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, img.blob, {
        contentType: img.contentType,
        cacheControl: '31536000',
        upsert: false,
      })
      error = res.error
    } catch (e) {
      error = e
    }
    if (!error) return path
    lastErr = error
    if (!isStorageDuplicate(error)) break
  }
  throw new Error(storageThaiError(lastErr))
}

/** ลงทะเบียนรูปที่อัปโหลดแล้วกับสินค้า (ส่ง path เดิมซ้ำได้ปลอดภัย) — ไม่สำเร็จเพราะเหตุอื่นที่ไม่ใช่เน็ต = ลบไฟล์ทิ้ง */
export async function registerImage(
  supabase: BrowserSupabase,
  groupId: string,
  path: string,
  img: CompressedImage,
): Promise<AddedImageJson> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await wait(attempt * 1000)
    const { data, error } = await supabase.rpc('add_product_image', {
      p_group_id: groupId.toLowerCase(),
      p_path: path,
      p_width: img.width,
      p_height: img.height,
      p_bytes: img.blob.size,
    })
    if (!error) {
      const parsed = toImage(data)
      if (!parsed) throw new Error('บันทึกรูปไม่สำเร็จ กรุณาโหลดหน้าใหม่')
      const o = data as Record<string, unknown>
      return {
        ...parsed,
        group_id: typeof o.group_id === 'string' ? o.group_id : groupId,
        bytes: typeof o.bytes === 'number' ? o.bytes : null,
        created_at: typeof o.created_at === 'string' ? o.created_at : '',
      }
    }
    lastErr = error
    if (!isNetworkError(error)) break
  }
  // เน็ตหลุด = อาจบันทึกไปแล้ว → ไม่ลบไฟล์ (ไฟล์ที่ไม่มีแถวอ้างอิงไม่มีผลเสีย) / เหตุอื่น = ไม่ได้บันทึกแน่นอน → ลบไฟล์ทิ้ง
  if (!isNetworkError(lastErr)) void removeProductImageFiles(supabase, [path])
  throw new Error(thaiError(lastErr))
}

/** ลบไฟล์รูปในถัง (ทำหลัง RPC สำเร็จเท่านั้น) — ไม่สำเร็จก็แค่เหลือไฟล์ค้าง ไม่ขวางการทำงาน */
export async function removeProductImageFiles(supabase: BrowserSupabase, paths: string[]): Promise<void> {
  const clean = paths.filter(p => typeof p === 'string' && p !== '')
  for (let i = 0; i < clean.length; i += 1000) {
    try {
      await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove(clean.slice(i, i + 1000))
    } catch {
      /* ไฟล์ค้างไม่มีผลเสีย */
    }
  }
}

export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** ขนาดไฟล์อ่านง่าย เช่น 320 KB / 1.2 MB */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 KB'
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(Math.round((n / (1024 * 1024)) * 10) / 10).toString()} MB`
}
