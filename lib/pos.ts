// ===== ชนิดข้อมูล + ตัวอ่าน JSON ของ RPC ระบบ POS ชุดใหม่ (supabase-fix-04-pos.sql) =====
// ใช้ได้ทั้ง server และ client (ไม่มี import ฝั่งเซิร์ฟเวอร์)
// ตัวอ่าน (parse*) ไม่ throw เด็ดขาด: ค่าแปลก/หายไป → ค่าปลอดภัย (ตัวเลข = 0 ผ่าน num, ข้อความ = '' หรือ null, สิทธิ์ = false)
// ฐานข้อมูลอาจส่ง numeric มาเป็นสตริง และบิลเก่าก่อน fix-04 ไม่มีคีย์ใหม่ → ทุกช่องต้องผ่านตัวอ่านก่อนใช้เสมอ
import type { PaymentMethod, SaleChannel } from '@/lib/integrations/types'
import { PAYMENT_METHOD_LABELS, SALE_CHANNEL_LABELS } from '@/lib/integrations/labels'
import type { StockMovementType } from '@/types'
import { num, round2 } from '@/lib/money'

// ---------------------------------------------------------------------------
// ตัวช่วยอ่านค่า (ภายในไฟล์)
// ---------------------------------------------------------------------------
type Obj = Record<string, unknown>

function asObj(v: unknown): Obj | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function has(o: Obj, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key) && o[key] !== undefined
}

function text(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return ''
}

// ข้อความว่าง/ช่องว่างล้วน = null
function textOrNull(v: unknown): string | null {
  const s = text(v)
  return s.trim() === '' ? null : s
}

function bool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true' || v === 't') return true
  if (v === 'false' || v === 'f') return false
  return fallback
}

function int(v: unknown): number {
  return Math.trunc(num(v))
}

function intOrNull(v: unknown): number | null {
  return v === null || v === undefined || v === '' ? null : int(v)
}

function money(v: unknown): number {
  return round2(num(v))
}

function moneyOrNull(v: unknown): number | null {
  return v === null || v === undefined || v === '' ? null : round2(num(v))
}

function textList(v: unknown): string[] {
  const out: string[] = []
  const a = asArr(v)
  for (let i = 0; i < a.length; i++) {
    const s = textOrNull(a[i])
    if (s !== null) out.push(s)
  }
  return out
}

// ---------------------------------------------------------------------------
// วิธีชำระ / วิธีคืนเงิน / ช่องทาง
// ---------------------------------------------------------------------------
/** วิธีคืนเงิน (บิลแพลตฟอร์ม 'marketplace' คืนเงินผ่านระบบนี้ไม่ได้) */
export type RefundMethod = 'cash' | 'transfer' | 'credit'
export const REFUND_METHODS: readonly RefundMethod[] = ['cash', 'transfer', 'credit'] as const
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'transfer', 'credit', 'marketplace'] as const

/** ตัวเลือกวิธีคืนเงิน (ชื่อไทยชุดเดียวกับวิธีชำระ) */
export const REFUND_METHOD_OPTIONS: readonly { value: RefundMethod; label: string }[] = REFUND_METHODS.map(m => ({
  value: m,
  label: PAYMENT_METHOD_LABELS[m],
}))

export function isRefundMethod(v: unknown): v is RefundMethod {
  return typeof v === 'string' && (REFUND_METHODS as readonly string[]).includes(v)
}

// ค่าที่ไม่รู้จัก → 'cash' (ฐานข้อมูลบังคับค่าด้วย check constraint อยู่แล้ว กรณีนี้เกิดได้แค่ข้อมูลเสีย)
function paymentMethodOf(v: unknown): PaymentMethod {
  return typeof v === 'string' && (PAYMENT_METHODS as readonly string[]).includes(v) ? (v as PaymentMethod) : 'cash'
}

function refundMethodOf(v: unknown): RefundMethod {
  return isRefundMethod(v) ? v : 'cash'
}

// ว่าง → 'store' (หน้าร้าน) ; ไม่รู้จัก → 'generic' (ช่องทางอื่น) ไม่ให้บิลแพลตฟอร์มกลายเป็นหน้าร้าน
function saleChannelOf(v: unknown): SaleChannel {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) return 'store'
  return Object.prototype.hasOwnProperty.call(SALE_CHANNEL_LABELS, s) ? (s as SaleChannel) : 'generic'
}

// ---------------------------------------------------------------------------
// บิล: get_sale_detail / void_sale / return_sale_items
// ---------------------------------------------------------------------------
export interface SaleDetailItem {
  product_id: string
  name: string
  sku: string
  barcode: string | null
  size: string | null
  color: string | null
  qty: number              // จำนวนที่ขาย
  unit_price: number
  subtotal: number
  stock_after: number | null // สต๊อกปัจจุบันของสินค้านี้ (ไม่ใช่ ณ ตอนขาย)
  returned_qty: number     // คืนไปแล้วรวมทุกครั้ง
  returnable_qty: number   // คืนได้อีก (บิลยกเลิก/บิลแพลตฟอร์ม = 0 ; ไม่มีคีย์ = 0 แบบปลอดภัย)
}

export interface SaleReturnItem {
  product_id: string
  name: string
  sku: string
  size: string | null
  color: string | null
  qty: number
  unit_price: number
  refund_amount: number
}

export interface SaleReturn {
  id: string
  return_no: string        // 'R-YYYYMMDD-NNN'
  created_at: string
  refund_amount: number    // ยอดคืนจริงที่เซิร์ฟเวอร์คำนวณ (เฉลี่ยส่วนลดของบิลแล้ว)
  refund_method: RefundMethod
  restock: boolean         // false = ของเสีย ไม่บวกสต๊อก
  reason: string
  created_by_name: string | null
  sale_id: string | null   // มีเฉพาะในผลของ return_sale_items (ใน get_sale_detail.returns ไม่มี = null)
  sale_no: string | null
  items: SaleReturnItem[]
}

export interface SaleDetail {
  id: string
  sale_no: string
  total_amount: number
  discount: number
  net_amount: number
  payment_method: PaymentMethod
  channel: SaleChannel
  note: string | null
  created_at: string
  voided_at: string | null
  void_reason: string | null
  voided_by_name: string | null
  refunded_amount: number   // คืนเงินแล้วรวมทุกครั้ง
  cash_received: number | null
  change_amount: number | null
  cashier_name: string | null
  channel_id: string | null
  external_order_id: string | null
  items: SaleDetailItem[]
  returns: SaleReturn[]     // เก่าสุดก่อน
  is_platform: boolean      // บิลจากออเดอร์แพลตฟอร์ม (ยกเลิก/คืนที่นี่ไม่ได้)
  can_void: boolean
  void_block: string | null   // เหตุผลภาษาไทยเมื่อ can_void = false
  // คำเตือนก่อนยกเลิกบิลของวันก่อน (แอดมินเท่านั้นที่ยกเลิกได้): ยอดของวันนั้นลดลง ต้องปิดยอดวันนั้นใหม่
  // และไม่หักจากลิ้นชักวันนี้ — มีค่าเฉพาะเมื่อ can_void = true และบิลไม่ใช่ของวันนี้ ; อื่นๆ / ฐานข้อมูลรุ่นเก่า = null
  void_warning: string | null
  can_return: boolean
  return_block: string | null // เหตุผลภาษาไทยเมื่อ can_return = false
}

export interface VoidResult {
  already_voided: boolean   // true = บิลถูกยกเลิกไปก่อนแล้ว (กดซ้ำ/อีกเครื่องยกเลิกไปแล้ว) ไม่ได้ทำอะไรเพิ่ม
  sale: SaleDetail | null
}

export interface ReturnResult {
  already_saved: boolean    // true = client_id นี้บันทึกไปแล้ว (ส่งซ้ำ) — ได้ใบคืนเดิมกลับมา ไม่ได้คืนซ้ำ
  return: SaleReturn | null
  sale: SaleDetail | null
}

function parseSaleDetailItem(raw: unknown): SaleDetailItem | null {
  const o = asObj(raw)
  if (!o) return null
  const qty = int(o.qty)
  const unitPrice = money(o.unit_price)
  return {
    product_id: text(o.product_id),
    name: text(o.name),
    sku: text(o.sku),
    barcode: textOrNull(o.barcode),
    size: textOrNull(o.size),
    color: textOrNull(o.color),
    qty,
    unit_price: unitPrice,
    subtotal: has(o, 'subtotal') && o.subtotal !== null ? money(o.subtotal) : round2(unitPrice * qty),
    stock_after: intOrNull(o.stock_after),
    returned_qty: Math.max(0, int(o.returned_qty)),
    returnable_qty: Math.max(0, int(o.returnable_qty)),
  }
}

function parseSaleReturnItem(raw: unknown): SaleReturnItem | null {
  const o = asObj(raw)
  if (!o) return null
  return {
    product_id: text(o.product_id),
    name: text(o.name),
    sku: text(o.sku),
    size: textOrNull(o.size),
    color: textOrNull(o.color),
    qty: int(o.qty),
    unit_price: money(o.unit_price),
    refund_amount: money(o.refund_amount),
  }
}

function itemsOf<T>(v: unknown, parse: (raw: unknown) => T | null): T[] {
  const out: T[] = []
  const a = asArr(v)
  for (let i = 0; i < a.length; i++) {
    const item = parse(a[i])
    if (item !== null) out.push(item)
  }
  return out
}

/** ใบคืนสินค้า 1 ใบ (ทั้งใน get_sale_detail.returns และผลของ return_sale_items) ; ไม่ใช่ object หรือไม่มี id/เลขที่ → null */
export function parseSaleReturn(raw: unknown): SaleReturn | null {
  const o = asObj(raw)
  if (!o) return null
  const id = text(o.id)
  const returnNo = text(o.return_no)
  if (!id && !returnNo) return null
  return {
    id,
    return_no: returnNo,
    created_at: text(o.created_at),
    refund_amount: money(o.refund_amount),
    refund_method: refundMethodOf(o.refund_method),
    restock: bool(o.restock, true),
    reason: text(o.reason),
    created_by_name: textOrNull(o.created_by_name),
    sale_id: textOrNull(o.sale_id),
    sale_no: textOrNull(o.sale_no),
    items: itemsOf(o.items, parseSaleReturnItem),
  }
}

/**
 * ผลของ get_sale_detail (และ .sale ในผล void_sale / return_sale_items) ; ไม่ใช่ object หรือไม่มี id → null
 * ใช้กับผลของ record_sale ได้ด้วย (คีย์ที่ไม่มี = ค่าปลอดภัย: ยกเลิก/คืนไม่ได้, คืนได้ 0 ชิ้น)
 */
export function parseSaleDetail(raw: unknown): SaleDetail | null {
  const o = asObj(raw)
  if (!o) return null
  const id = text(o.id)
  if (!id) return null
  const channelId = textOrNull(o.channel_id)
  return {
    id,
    sale_no: text(o.sale_no),
    total_amount: money(o.total_amount),
    discount: money(o.discount),
    net_amount: money(o.net_amount),
    payment_method: paymentMethodOf(o.payment_method),
    channel: saleChannelOf(o.channel),
    note: textOrNull(o.note),
    created_at: text(o.created_at),
    voided_at: textOrNull(o.voided_at),
    void_reason: textOrNull(o.void_reason),
    voided_by_name: textOrNull(o.voided_by_name),
    refunded_amount: money(o.refunded_amount),
    cash_received: moneyOrNull(o.cash_received),
    change_amount: moneyOrNull(o.change_amount),
    cashier_name: textOrNull(o.cashier_name),
    channel_id: channelId,
    external_order_id: textOrNull(o.external_order_id),
    items: itemsOf(o.items, parseSaleDetailItem),
    returns: itemsOf(o.returns, parseSaleReturn),
    is_platform: has(o, 'is_platform') ? bool(o.is_platform) : channelId !== null,
    can_void: bool(o.can_void),
    void_block: textOrNull(o.void_block),
    void_warning: textOrNull(o.void_warning),
    can_return: bool(o.can_return),
    return_block: textOrNull(o.return_block),
  }
}

/** ผลของ void_sale ; ไม่ใช่ object → null */
export function parseVoidResult(raw: unknown): VoidResult | null {
  const o = asObj(raw)
  if (!o) return null
  return { already_voided: bool(o.already_voided), sale: parseSaleDetail(o.sale) }
}

/** ผลของ return_sale_items ; ไม่ใช่ object → null */
export function parseReturnResult(raw: unknown): ReturnResult | null {
  const o = asObj(raw)
  if (!o) return null
  return { already_saved: bool(o.already_saved), return: parseSaleReturn(o.return), sale: parseSaleDetail(o.sale) }
}

/**
 * ประมาณยอดคืนเงินฝั่งหน้าจอ — สูตรเดียวกับเซิร์ฟเวอร์ (ยอดจริงใช้ของเซิร์ฟเวอร์เสมอ):
 *   ต่อรายการ = round2(ราคา/ชิ้น × จำนวน × ยอดสุทธิ / ยอดรวม) (ยอดรวม 0 = 0)
 *   คืนครบทุกชิ้นของบิลหลังครั้งนี้ → ยอดสุทธิ − คืนไปแล้ว (ให้ผลรวมทุกครั้งเท่ายอดสุทธิพอดี)
 *   ไม่เกินยอดสุทธิ − คืนไปแล้ว และไม่ติดลบ
 * qtyByProduct = { product_id: จำนวนที่จะคืนครั้งนี้ } (จำนวนเกิน returnable_qty ถูกตัดลง)
 */
export function estimateRefund(
  sale: {
    total_amount: number
    net_amount: number
    refunded_amount: number
    items: readonly { product_id: string; unit_price: number; returnable_qty: number }[]
  },
  qtyByProduct: Readonly<Record<string, number>>,
): number {
  const total = num(sale.total_amount)
  const net = num(sale.net_amount)
  const remaining = Math.max(0, round2(net - num(sale.refunded_amount)))
  let sum = 0
  let picked = 0
  let allBack = true
  for (let i = 0; i < sale.items.length; i++) {
    const it = sale.items[i]
    const can = Math.max(0, int(it.returnable_qty))
    const q = Math.min(can, Math.max(0, int(qtyByProduct[it.product_id])))
    if (q < can) allBack = false
    if (q <= 0) continue
    picked += q
    sum += total > 0 ? round2((num(it.unit_price) * q * net) / total) : 0
  }
  if (picked === 0) return 0
  let refund = round2(sum)
  if (allBack) refund = remaining
  return Math.max(0, Math.min(refund, remaining))
}

// ---------------------------------------------------------------------------
// สถานะบิล (ป้ายในรายการบิล / รายละเอียดบิล)
// ---------------------------------------------------------------------------
export type BillStatusKey = 'normal' | 'voided' | 'partial' | 'refunded'
export interface BillStatus {
  key: BillStatusKey
  label: string
  chipClass: string // คลาสป้ายใน globals.css
}

// ปกติ = ป้ายเทาเรียบ (ไม่แย่งสายตาในรายการยาว) · ยกเลิก = แดง · คืนบางส่วน = อำพัน · คืนทั้งบิล = เทาเข้ม
export const BILL_STATUS: Readonly<Record<BillStatusKey, { label: string; chipClass: string }>> = {
  normal: { label: 'ปกติ', chipClass: 'chip' },
  voided: { label: 'ยกเลิก', chipClass: 'badge-out' },
  partial: { label: 'คืนบางส่วน', chipClass: 'badge-return' },
  refunded: { label: 'คืนทั้งบิล', chipClass: 'badge-adjust' },
}

/**
 * สถานะของบิล — ใช้ได้ทั้ง SaleDetail (มีรายการสินค้า) และแถวจากตาราง sales ในรายการบิล (ไม่มีรายการสินค้า)
 * ยกเลิก > คืนทั้งบิล > คืนบางส่วน > ปกติ
 *
 * มีรายการสินค้า (รายละเอียดบิล) → ดูจาก "จำนวนชิ้น" กติกาเดียวกับ pos_bill_status ของไฟล์ส่งออก:
 *   คืนทั้งบิล = มีใบคืนอย่างน้อย 1 ใบ และคืนครบทุกชิ้นแล้ว
 *   คืนบางส่วน = มีใบคืน หรือมียอดคืนเงิน แต่ยังเหลือชิ้นที่คืนได้
 *   (ดูจากเงินจะผิด 2 กรณี: บิลมีของแถมราคา 0 → คืนเฉพาะชิ้นที่จ่ายเงินก็ "ครบยอด" ทั้งที่ของแถมยังคืนได้
 *    / บิลยอดสุทธิ 0 → คืนครบทุกชิ้นแต่ยอดคืน 0)
 *   "คืนครบ" ดู returned_qty ≥ qty ก่อน (ไม่มีตัวเลขนี้จึงใช้ returnable_qty = 0) — บิลแพลตฟอร์มมี returnable_qty = 0 เสมอ
 *   เพราะคืนที่ระบบนี้ไม่ได้ ไม่ได้แปลว่าคืนครบ
 *
 * ไม่มีรายการสินค้า (แถวในรายการบิล: voided_at, refunded_amount, net_amount + รหัสใบคืน sale_returns(id)) → ดูจากเงิน + การมีใบคืน:
 *   มีใบคืน (ยอดคืน 0 บาทก็นับ — คืนของแถม/บิลส่วนลดเต็ม) หรือมียอดคืนเงิน = มีคืน
 *   คืนเงินครบยอดสุทธิ = คืนทั้งบิล ; นอกนั้น = คืนบางส่วน (ข้อมูลไม่พอจะรู้ว่าคืนครบทุกชิ้น — เปิดบิลดูสถานะจริงได้)
 * ใบคืนส่งมาได้ทั้ง returns (SaleDetail / แถวที่แปลงแล้ว) และ sale_returns (แถวดิบจาก select ... sale_returns(id))
 */
export function billStatus(sale: {
  voided_at?: string | null
  refunded_amount?: number | string | null
  net_amount?: number | string | null
  returns?: readonly unknown[] | null
  sale_returns?: readonly unknown[] | null
  items?: readonly { qty?: number | null; returned_qty?: number | null; returnable_qty?: number | null }[] | null
}): BillStatus {
  const pick = (key: BillStatusKey): BillStatus => ({ key, ...BILL_STATUS[key] })
  if (sale.voided_at) return pick('voided')
  const refunded = round2(num(sale.refunded_amount))
  const hasReturnRows = (Array.isArray(sale.returns) && sale.returns.length > 0)
    || (Array.isArray(sale.sale_returns) && sale.sale_returns.length > 0)
  const items = Array.isArray(sale.items) && sale.items.length > 0 ? sale.items : null

  if (items) {
    // ไม่ได้ส่งใบคืนมาด้วย แต่มีชิ้นที่คืนไปแล้ว = มีใบคืนแน่นอน
    const hasReturn = hasReturnRows || items.some(i => int(i.returned_qty) > 0)
    const allBack = items.every(i => {
      const qty = int(i.qty)
      const known = qty > 0 && i.returned_qty !== undefined && i.returned_qty !== null
      return known ? int(i.returned_qty) >= qty : int(i.returnable_qty) <= 0
    })
    if (hasReturn && allBack) return pick('refunded')
    if (hasReturn || refunded > 0) return pick('partial')
    return pick('normal')
  }

  if (!hasReturnRows && refunded <= 0) return pick('normal')
  const net = round2(num(sale.net_amount))
  if (net > 0 && refunded >= net - 0.005) return pick('refunded')
  return pick('partial')
}

// ---------------------------------------------------------------------------
// ข้อมูลร้าน / ใบเสร็จ: get_shop_settings / save_shop_settings
// ---------------------------------------------------------------------------
export type ReceiptPaper = '58' | '80'
/** ขนาดกระดาษตอนสั่งพิมพ์ (a4 = เครื่องพิมพ์ทั่วไป เช่น สรุปยอด) */
export type PrintPaper = ReceiptPaper | 'a4'

export interface ShopSettings {
  shop_name: string
  branch_name: string | null
  address: string | null
  phone: string | null
  tax_id: string | null
  receipt_footer: string | null // null = ไม่พิมพ์ข้อความท้ายใบเสร็จ
  receipt_paper: ReceiptPaper
  show_cashier: boolean
  updated_at: string | null
}

export const DEFAULT_SHOP_SETTINGS: Readonly<ShopSettings> = {
  shop_name: 'NEWCUTE',
  branch_name: null,
  address: null,
  phone: null,
  tax_id: null,
  receipt_footer: 'ขอบคุณที่อุดหนุนค่ะ',
  receipt_paper: '80',
  show_cashier: true,
  updated_at: null,
}

/**
 * ผลของ get_shop_settings / save_shop_settings — คืนค่าเสมอ (ไม่ใช่ object = ค่าเริ่มต้น)
 * คีย์ไม่มีมาเลย = ค่าเริ่มต้น ; คีย์มีแต่เป็น null = ร้านตั้งให้ว่างเอง (เช่นไม่เอาข้อความท้ายใบเสร็จ)
 */
export function parseShopSettings(raw: unknown): ShopSettings {
  const o = asObj(raw)
  if (!o) return { ...DEFAULT_SHOP_SETTINGS }
  const opt = (key: keyof ShopSettings, fallback: string | null): string | null =>
    has(o, key) ? textOrNull(o[key]) : fallback
  const paper = text(o.receipt_paper).trim()
  return {
    shop_name: textOrNull(o.shop_name)?.trim() || DEFAULT_SHOP_SETTINGS.shop_name,
    branch_name: opt('branch_name', DEFAULT_SHOP_SETTINGS.branch_name),
    address: opt('address', DEFAULT_SHOP_SETTINGS.address),
    phone: opt('phone', DEFAULT_SHOP_SETTINGS.phone),
    tax_id: opt('tax_id', DEFAULT_SHOP_SETTINGS.tax_id),
    receipt_footer: opt('receipt_footer', DEFAULT_SHOP_SETTINGS.receipt_footer),
    receipt_paper: paper === '58' || paper === '80' ? paper : DEFAULT_SHOP_SETTINGS.receipt_paper,
    show_cashier: bool(o.show_cashier, DEFAULT_SHOP_SETTINGS.show_cashier),
    updated_at: textOrNull(o.updated_at),
  }
}

// ---------------------------------------------------------------------------
// ปิดยอดประจำวัน: get_day_summary / close_day / ตาราง daily_closings
// ---------------------------------------------------------------------------
export interface MethodTotal {
  count: number
  amount: number
}

export interface ChannelTotal {
  channel: string // ค่า sales.channel (แสดงผลด้วย saleChannelLabel)
  count: number
  amount: number
}

export interface DayRefunds {
  count: number
  amount: number
  by_method: Record<RefundMethod, number>
}

/** ตัวเลขสรุปของวัน (ไม่รวมข้อมูลการปิดยอด) — เก็บเป็น snapshot ใน daily_closings.summary ด้วย */
export interface DaySummarySnapshot {
  day: string                 // 'YYYY-MM-DD'
  is_today: boolean
  bills: number               // บิลที่ไม่ถูกยกเลิก
  gross: number
  discount: number
  net: number
  items_qty: number
  by_method: Record<PaymentMethod, MethodTotal> // มีครบ 4 คีย์เสมอ
  by_channel: ChannelTotal[]  // มากไปน้อยตามยอด
  voided: MethodTotal         // บิลของวันนี้ที่ถูกยกเลิก (amount = ยอดสุทธิรวม)
  refunds: DayRefunds         // ใบคืนที่ทำในวันนี้ (ของบิลวันไหนก็ได้)
  net_after_refunds: number
  cash_sales: number
  cash_refunds: number
  first_bill_at: string | null
  last_bill_at: string | null
}

/** จำนวนแบงก์/เหรียญที่นับได้ต่อชนิด: { '1000': 2, '500': 1, ... } */
export type CashDetail = Partial<Record<DenominationKey, number>>

export interface DayClosing {
  day: string
  opening_cash: number   // เงินทอนตั้งต้นในลิ้นชัก
  counted_cash: number   // เงินสดที่นับได้จริง
  expected_cash: number  // opening + cash_sales − cash_refunds (ณ ตอนปิดยอด)
  cash_diff: number      // counted − expected (บวก = เกิน, ลบ = ขาด)
  cash_detail: CashDetail | null
  note: string | null
  revision: number       // ปิดยอดครั้งที่ (ปิดใหม่ = +1)
  closed_by_name: string | null
  closed_at: string
  summary: DaySummarySnapshot | null // ตัวเลข ณ ตอนปิดยอด (แถวที่ select จากตารางโดยไม่เอาคอลัมน์นี้ = null)
}

export interface DaySummary extends DaySummarySnapshot {
  closing: DayClosing | null
  changed_since_close: boolean // ปิดยอดแล้วแต่ตัวเลขเปลี่ยน (มีขาย/คืน/ยกเลิกเพิ่ม) → ควรปิดยอดใหม่
}

function parseMethodTotal(raw: unknown): MethodTotal {
  const o = asObj(raw)
  return o ? { count: int(o.count), amount: money(o.amount) } : { count: 0, amount: 0 }
}

function parseSnapshot(o: Obj): DaySummarySnapshot {
  const bm = asObj(o.by_method) ?? {}
  const byMethod = {} as Record<PaymentMethod, MethodTotal>
  for (let i = 0; i < PAYMENT_METHODS.length; i++) byMethod[PAYMENT_METHODS[i]] = parseMethodTotal(bm[PAYMENT_METHODS[i]])

  const rf = asObj(o.refunds) ?? {}
  const rfm = asObj(rf.by_method) ?? {}
  const refunds: DayRefunds = {
    count: int(rf.count),
    amount: money(rf.amount),
    by_method: { cash: money(rfm.cash), transfer: money(rfm.transfer), credit: money(rfm.credit) },
  }

  const byChannel: ChannelTotal[] = []
  const ch = asArr(o.by_channel)
  for (let i = 0; i < ch.length; i++) {
    const c = asObj(ch[i])
    if (c) byChannel.push({ channel: text(c.channel) || 'store', count: int(c.count), amount: money(c.amount) })
  }

  const net = money(o.net)
  return {
    day: text(o.day),
    is_today: bool(o.is_today),
    bills: int(o.bills),
    gross: money(o.gross),
    discount: money(o.discount),
    net,
    items_qty: int(o.items_qty),
    by_method: byMethod,
    by_channel: byChannel,
    voided: parseMethodTotal(o.voided),
    refunds,
    net_after_refunds: has(o, 'net_after_refunds') ? money(o.net_after_refunds) : round2(net - refunds.amount),
    cash_sales: has(o, 'cash_sales') ? money(o.cash_sales) : byMethod.cash.amount,
    cash_refunds: has(o, 'cash_refunds') ? money(o.cash_refunds) : refunds.by_method.cash,
    first_bill_at: textOrNull(o.first_bill_at),
    last_bill_at: textOrNull(o.last_bill_at),
  }
}

/** จำนวนเงินรวมจากการนับแบงก์/เหรียญ (ปัด 2 ตำแหน่ง) */
export function cashDetailTotal(detail: CashDetail | Readonly<Record<string, number>> | null | undefined): number {
  if (!detail) return 0
  let total = 0
  for (let i = 0; i < DENOMINATIONS.length; i++) {
    const d = DENOMINATIONS[i]
    const count = Math.max(0, int((detail as Record<string, unknown>)[d.key]))
    total += d.value * count
  }
  return round2(total)
}

function parseCashDetail(raw: unknown): CashDetail | null {
  const o = asObj(raw)
  if (!o) return null
  const out: CashDetail = {}
  let any = false
  for (let i = 0; i < DENOMINATIONS.length; i++) {
    const k = DENOMINATIONS[i].key
    if (!has(o, k)) continue
    out[k] = Math.max(0, int(o[k]))
    any = true
  }
  return any ? out : null
}

/** การปิดยอด 1 วัน (คีย์ closing ของ get_day_summary หรือแถวที่ select จากตาราง daily_closings) ; ไม่มี day → null */
export function parseDayClosing(raw: unknown): DayClosing | null {
  const o = asObj(raw)
  if (!o) return null
  const day = text(o.day).slice(0, 10)
  if (!day) return null
  const counted = money(o.counted_cash)
  const expected = money(o.expected_cash)
  const summary = asObj(o.summary)
  return {
    day,
    opening_cash: money(o.opening_cash),
    counted_cash: counted,
    expected_cash: expected,
    cash_diff: has(o, 'cash_diff') ? money(o.cash_diff) : round2(counted - expected),
    cash_detail: parseCashDetail(o.cash_detail),
    note: textOrNull(o.note),
    revision: Math.max(1, int(o.revision) || 1),
    closed_by_name: textOrNull(o.closed_by_name),
    closed_at: text(o.closed_at),
    summary: summary ? parseSnapshot(summary) : null,
  }
}

/** ผลของ get_day_summary / close_day ; ไม่ใช่ object → null */
export function parseDaySummary(raw: unknown): DaySummary | null {
  const o = asObj(raw)
  if (!o) return null
  return {
    ...parseSnapshot(o),
    closing: parseDayClosing(o.closing),
    changed_since_close: bool(o.changed_since_close),
  }
}

// ---------------------------------------------------------------------------
// แบงก์/เหรียญ สำหรับนับเงินสด (คีย์ตรงกับ cash_detail ของ close_day)
// ---------------------------------------------------------------------------
export type DenominationKey = '1000' | '500' | '100' | '50' | '20' | '10' | '5' | '2' | '1' | '0.5' | '0.25'
export interface Denomination {
  key: DenominationKey // คีย์ใน cash_detail
  value: number        // มูลค่า (บาท)
  label: string        // ชื่อที่แสดง
  kind: 'note' | 'coin'
}

/** มากไปน้อย: แบงก์ 1,000 … เหรียญ 25 สต. */
export const DENOMINATIONS: readonly Denomination[] = [
  { key: '1000', value: 1000, label: 'แบงก์ 1,000', kind: 'note' },
  { key: '500', value: 500, label: 'แบงก์ 500', kind: 'note' },
  { key: '100', value: 100, label: 'แบงก์ 100', kind: 'note' },
  { key: '50', value: 50, label: 'แบงก์ 50', kind: 'note' },
  { key: '20', value: 20, label: 'แบงก์ 20', kind: 'note' },
  { key: '10', value: 10, label: 'เหรียญ 10', kind: 'coin' },
  { key: '5', value: 5, label: 'เหรียญ 5', kind: 'coin' },
  { key: '2', value: 2, label: 'เหรียญ 2', kind: 'coin' },
  { key: '1', value: 1, label: 'เหรียญ 1', kind: 'coin' },
  { key: '0.5', value: 0.5, label: 'เหรียญ 50 สต.', kind: 'coin' },
  { key: '0.25', value: 0.25, label: 'เหรียญ 25 สต.', kind: 'coin' },
] as const

// ---------------------------------------------------------------------------
// ตรวจนับสต๊อก: create/get/set_item/apply/cancel_stock_count
// ---------------------------------------------------------------------------
export type StockCountStatus = 'open' | 'applied' | 'cancelled'

export interface StockCountItem {
  product_id: string
  group_id: string | null
  name: string
  sku: string
  barcode: string | null
  size: string | null
  color: string | null
  category_id: string | null
  is_active: boolean
  // ไซส์นี้ถูกเอาออกจากสินค้า (เลิกใช้) ระหว่างนับ — นับต่อไม่ได้ ลบออกจากรายการนับได้อย่างเดียว
  // ปรับยอดจะไม่ยอมถ้าบรรทัดนี้ทำให้สต๊อกเปลี่ยน (ห้ามใส่สต๊อกให้ไซส์ที่เลิกใช้)
  is_archived: boolean
  // สินค้านี้ถูกปรับยอดจากรอบนับอื่นหลังนับบรรทัดนี้ครั้งล่าสุด (เฉพาะรอบที่ยังเปิด) — ต้องนับใหม่
  // ไม่งั้นส่วนต่างถูกหักซ้ำสองครั้ง ; ปรับยอดจะไม่ยอมถ้าบรรทัดนี้ทำให้สต๊อกเปลี่ยน ; บันทึกจำนวนใหม่ (เท่าเดิมก็ได้) = หายเอง
  recount_needed: boolean
  cost_price: number
  counted_qty: number          // จำนวนที่นับได้
  system_qty_at_count: number  // สต๊อกในระบบตอนแก้บรรทัดนี้ครั้งล่าสุด
  current_qty: number          // สต๊อกในระบบตอนนี้
  expected_after: number       // ยอดหลังปรับ (รอบเปิด: max(0, current + counted − system_qty_at_count) ; ปรับแล้ว: applied_after)
  diff: number                 // expected_after − current (รอบเปิด) ; applied_after − applied_before (ปรับแล้ว)
  applied_before: number | null
  applied_after: number | null
  updated_at: string | null
}

export interface StockCountTotals {
  lines: number
  counted_qty: number
  diff_plus: number   // รวมส่วนต่างที่เป็นบวก
  diff_minus: number  // รวมส่วนต่างที่เป็นลบ — ฝั่ง TS เป็นขนาด (>= 0) เสมอ ตัวอ่านใส่ Math.abs ให้
  value_diff: number  // Σ diff × ราคาทุน (มีเครื่องหมาย)
}

export interface StockCountSummary {
  lines: number
  changed: number
  unchanged: number
  qty_plus: number
  qty_minus: number   // ขนาด (>= 0) เสมอ
  value_diff: number
}

export interface StockCount {
  id: string
  name: string
  note: string | null
  category_id: string | null
  category_name: string | null
  status: StockCountStatus
  created_at: string
  created_by_name: string | null
  applied_at: string | null
  applied_by_name: string | null
  cancelled_at: string | null
  summary: StockCountSummary | null // มีหลังปรับยอดแล้ว
  items: StockCountItem[]
  totals: StockCountTotals
  already_applied: boolean // ผลของ apply_stock_count: true = ปรับไปแล้วก่อนหน้า (กดซ้ำ) ; ผลอื่น = false
}

/**
 * ผลของ set_stock_count_item: แก้/เพิ่มบรรทัด หรือลบบรรทัดออกจากรายการนับ
 * replayed = ส่งรหัสคำสั่ง (p_op_id) เดิมซ้ำ และเซิร์ฟเวอร์บันทึกคำสั่งนั้นไปแล้วก่อนหน้า → ไม่ทำซ้ำ (item = บรรทัดปัจจุบัน)
 */
export type SetCountItemResult =
  | { removed: false; item: StockCountItem; replayed: boolean }
  | { removed: true; product_id: string; replayed: boolean }

function countStatusOf(v: unknown): StockCountStatus {
  return v === 'applied' || v === 'cancelled' ? v : 'open'
}

/** บรรทัดตรวจนับ 1 บรรทัด ; ไม่ใช่ object หรือไม่มี product_id → null */
export function parseStockCountItem(raw: unknown): StockCountItem | null {
  const o = asObj(raw)
  if (!o) return null
  const productId = text(o.product_id)
  if (!productId) return null
  const counted = Math.max(0, int(o.counted_qty))
  const system = int(o.system_qty_at_count)
  const current = int(o.current_qty)
  const appliedBefore = intOrNull(o.applied_before)
  const appliedAfter = intOrNull(o.applied_after)
  // ไม่มีคีย์ expected_after/diff (ไม่ควรเกิด) → คำนวณแบบรอบเปิด
  const expected = has(o, 'expected_after') && o.expected_after !== null
    ? int(o.expected_after)
    : Math.max(0, current + counted - system)
  return {
    product_id: productId,
    group_id: textOrNull(o.group_id),
    name: text(o.name),
    sku: text(o.sku),
    barcode: textOrNull(o.barcode),
    size: textOrNull(o.size),
    color: textOrNull(o.color),
    category_id: textOrNull(o.category_id),
    is_active: bool(o.is_active, true),
    // ฐานข้อมูลก่อนแก้รอบนี้ไม่มี 2 คีย์นี้ = false (ไม่เตือน — เซิร์ฟเวอร์รุ่นนั้นก็ไม่ปฏิเสธ)
    is_archived: bool(o.is_archived),
    recount_needed: bool(o.recount_needed),
    cost_price: money(o.cost_price),
    counted_qty: counted,
    system_qty_at_count: system,
    current_qty: current,
    expected_after: expected,
    diff: has(o, 'diff') && o.diff !== null ? int(o.diff) : expected - current,
    applied_before: appliedBefore,
    applied_after: appliedAfter,
    updated_at: textOrNull(o.updated_at),
  }
}

/** ผลของ set_stock_count_item ; ไม่ใช่ object → null */
export function parseSetCountItemResult(raw: unknown): SetCountItemResult | null {
  const o = asObj(raw)
  if (!o) return null
  const replayed = bool(o.replayed)
  if (bool(o.removed)) {
    const productId = text(o.product_id)
    return productId ? { removed: true, product_id: productId, replayed } : null
  }
  const item = parseStockCountItem(o)
  return item ? { removed: false, item, replayed } : null
}

/**
 * คำนวณยอดหลังปรับ/ส่วนต่างของบรรทัดใหม่ (ใช้ตอนแก้แบบ optimistic ก่อนเซิร์ฟเวอร์ตอบ) — กติกาเดียวกับเซิร์ฟเวอร์
 * รอบเปิด: expected_after = max(0, current + counted − system_qty_at_count), diff = expected_after − current
 * รอบที่ปรับแล้ว: ใช้ applied_before/after ที่บันทึกไว้
 */
export function recalcCountItem(item: StockCountItem, status: StockCountStatus = 'open'): StockCountItem {
  if (status === 'applied' && item.applied_after !== null) {
    const before = item.applied_before ?? item.applied_after
    return { ...item, expected_after: item.applied_after, diff: item.applied_after - before }
  }
  const expected = Math.max(0, item.current_qty + item.counted_qty - item.system_qty_at_count)
  return { ...item, expected_after: expected, diff: expected - item.current_qty }
}

/** ปัญหาของบรรทัดที่ต้องแก้ก่อนปรับยอด: 'archived' = ไซส์ถูกเอาออกจากสินค้า (ลบบรรทัดออก) / 'recount' = ต้องนับใหม่ / null = ไม่มี */
export type CountLineProblem = 'archived' | 'recount'

export function countLineProblem(item: Pick<StockCountItem, 'is_archived' | 'recount_needed'>): CountLineProblem | null {
  if (item.is_archived) return 'archived'
  if (item.recount_needed) return 'recount'
  return null
}

/**
 * apply_stock_count จะปฏิเสธเพราะบรรทัดนี้ไหม — กติกาเดียวกับเซิร์ฟเวอร์: มีปัญหา และทำให้สต๊อกเปลี่ยน (ยอดหลังปรับ ≠ สต๊อกตอนนี้)
 * บรรทัดที่มีปัญหาแต่ยอดตรงอยู่แล้ว (ส่วนต่าง 0) ไม่ขวาง เพราะปรับยอดไม่แตะสต๊อกของสินค้านั้น
 */
export function countLineBlocksApply(item: Pick<StockCountItem, 'is_archived' | 'recount_needed' | 'diff'>): boolean {
  return countLineProblem(item) !== null && item.diff !== 0
}

/** รวมยอดท้ายรายการนับ (ใช้ตอนแก้แบบ optimistic) — diff_minus เป็นขนาด (>= 0) */
export function computeCountTotals(items: readonly StockCountItem[]): StockCountTotals {
  let counted = 0
  let plus = 0
  let minus = 0
  let value = 0
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    counted += it.counted_qty
    if (it.diff > 0) plus += it.diff
    else if (it.diff < 0) minus += -it.diff
    value += it.diff * it.cost_price
  }
  return { lines: items.length, counted_qty: counted, diff_plus: plus, diff_minus: minus, value_diff: round2(value) }
}

function parseCountSummary(raw: unknown): StockCountSummary | null {
  const o = asObj(raw)
  if (!o) return null
  return {
    lines: int(o.lines),
    changed: int(o.changed),
    unchanged: int(o.unchanged),
    qty_plus: Math.abs(int(o.qty_plus)),
    qty_minus: Math.abs(int(o.qty_minus)),
    value_diff: money(o.value_diff),
  }
}

/** ผลของ get_stock_count / create / apply / cancel ; ไม่ใช่ object หรือไม่มี id → null */
export function parseStockCount(raw: unknown): StockCount | null {
  const o = asObj(raw)
  if (!o) return null
  const id = text(o.id)
  if (!id) return null
  const items = itemsOf(o.items, parseStockCountItem)
  const t = asObj(o.totals)
  const totals: StockCountTotals = t
    ? {
        lines: int(t.lines),
        counted_qty: int(t.counted_qty),
        diff_plus: Math.abs(int(t.diff_plus)),
        diff_minus: Math.abs(int(t.diff_minus)),
        value_diff: money(t.value_diff),
      }
    : computeCountTotals(items)
  return {
    id,
    name: text(o.name),
    note: textOrNull(o.note),
    category_id: textOrNull(o.category_id),
    category_name: textOrNull(o.category_name),
    status: countStatusOf(o.status),
    created_at: text(o.created_at),
    created_by_name: textOrNull(o.created_by_name),
    applied_at: textOrNull(o.applied_at),
    applied_by_name: textOrNull(o.applied_by_name),
    cancelled_at: textOrNull(o.cancelled_at),
    summary: parseCountSummary(o.summary),
    items,
    totals,
    already_applied: bool(o.already_applied),
  }
}

// ---------------------------------------------------------------------------
// นำเข้าสินค้าจากไฟล์: import_products
// ---------------------------------------------------------------------------
/** คอลัมน์ที่ส่งให้ import_products (ค่าในช่องเป็นข้อความดิบจากไฟล์ หรือ null เมื่อว่าง) */
export const IMPORT_FIELDS = [
  'name', 'category', 'color', 'size', 'sku', 'barcode', 'cost_price', 'sell_price', 'stock', 'min_stock',
] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]
/** 1 แถวที่ส่งเข้า p_rows — row = เลขบรรทัดในไฟล์ (หัวตาราง = 1) */
export type ImportRowInput = { row: number } & Record<ImportField, string | null>

export type ImportAction = 'create' | 'add_size' | 'update' | 'unchanged' | 'error'
export type ImportChangeField = 'sell_price' | 'cost_price' | 'barcode' | 'min_stock'

export interface ImportChange {
  field: ImportChangeField
  from: string | null
  to: string | null
}

export interface ImportRowResult {
  row: number
  sku: string | null
  name: string | null
  size: string | null
  action: ImportAction
  errors: string[]
  notes: string[]
  changes: ImportChange[]
}

export interface ImportSummary {
  rows: number
  errors: number          // จำนวนแถวที่ผิด (0 = นำเข้าได้)
  create_groups: number
  create_skus: number
  add_sizes: number
  update_skus: number
  unchanged_skus: number
  opening_qty: number     // สต๊อกยกมารวมของสินค้าใหม่
  new_categories: string[]
}

export interface ImportResult {
  dry_run: boolean
  already_saved: boolean  // true = ไฟล์นี้ (client_id เดิม) นำเข้าไปแล้ว — ได้สรุปเดิมกลับมา (rows อาจว่าง)
  summary: ImportSummary
  rows: ImportRowResult[]
}

const IMPORT_ACTIONS: readonly ImportAction[] = ['create', 'add_size', 'update', 'unchanged', 'error']
const IMPORT_CHANGE_FIELDS: readonly ImportChangeField[] = ['sell_price', 'cost_price', 'barcode', 'min_stock']

function parseImportRow(raw: unknown): ImportRowResult | null {
  const o = asObj(raw)
  if (!o) return null
  const errors = textList(o.errors)
  const action = typeof o.action === 'string' && (IMPORT_ACTIONS as readonly string[]).includes(o.action)
    ? (o.action as ImportAction)
    : 'error'
  const changes: ImportChange[] = []
  const ch = asArr(o.changes)
  for (let i = 0; i < ch.length; i++) {
    const c = asObj(ch[i])
    if (!c || typeof c.field !== 'string' || !(IMPORT_CHANGE_FIELDS as readonly string[]).includes(c.field)) continue
    changes.push({ field: c.field as ImportChangeField, from: textOrNull(c.from), to: textOrNull(c.to) })
  }
  return {
    row: int(o.row),
    sku: textOrNull(o.sku),
    name: textOrNull(o.name),
    size: textOrNull(o.size),
    // มีข้อความผิดพลาด = แถวผิดเสมอ (กันกรณี action ไม่ตรงกับ errors)
    action: errors.length > 0 ? 'error' : action,
    errors,
    notes: textList(o.notes),
    changes,
  }
}

/** ผลของ import_products ; ไม่ใช่ object → null */
export function parseImportResult(raw: unknown): ImportResult | null {
  const o = asObj(raw)
  if (!o) return null
  const rows = itemsOf(o.rows, parseImportRow)
  // สรุปปกติอยู่ใต้คีย์ summary ; เผื่อกรณีส่งซ้ำแล้วได้สรุปเดิมแบบแบนมา → อ่านจากตัวบนสุดแทน
  const s = asObj(o.summary) ?? o
  return {
    dry_run: bool(o.dry_run),
    already_saved: bool(o.already_saved),
    summary: {
      rows: int(s.rows) || rows.length,
      errors: has(s, 'errors') ? int(s.errors) : rows.filter(r => r.action === 'error').length,
      create_groups: int(s.create_groups),
      create_skus: int(s.create_skus),
      add_sizes: int(s.add_sizes),
      update_skus: int(s.update_skus),
      unchanged_skus: int(s.unchanged_skus),
      opening_qty: int(s.opening_qty),
      new_categories: textList(s.new_categories),
    },
    rows,
  }
}

// ---------------------------------------------------------------------------
// ส่งออก CSV: export_sales_rows / export_sale_item_rows / export_stock_movement_rows (1 แถวต่อ 1 ผลลัพธ์)
// ---------------------------------------------------------------------------
export interface ExportSaleRow {
  sale_no: string
  created_at: string
  channel: string
  payment_method: string
  total_amount: number
  discount: number
  net_amount: number
  refunded_amount: number
  cash_received: number | null
  change_amount: number | null
  status: string         // 'ปกติ' | 'ยกเลิก' | 'คืนบางส่วน' | 'คืนทั้งบิล' (ข้อความไทยจากเซิร์ฟเวอร์)
  cashier_name: string | null
  note: string | null
  void_reason: string | null
}

export interface ExportSaleItemRow {
  sale_no: string
  created_at: string
  sku: string
  product_name: string
  size: string | null
  color: string | null
  qty: number
  unit_price: number
  subtotal: number
  unit_cost: number | null
  returned_qty: number
  bill_status: string
}

export interface ExportMovementRow {
  created_at: string
  type: string           // StockMovementType ('in' | 'out' | 'adjust' | 'return') — ชื่อไทยใช้ MOVEMENT_TYPE_LABELS
  sku: string
  product_name: string
  size: string | null
  color: string | null
  qty_change: number     // มีเครื่องหมาย (หลัง − ก่อน)
  qty_before: number
  qty_after: number
  note: string | null
  created_by_name: string | null
}

export function parseExportSaleRow(raw: unknown): ExportSaleRow {
  const o = asObj(raw) ?? {}
  return {
    sale_no: text(o.sale_no),
    created_at: text(o.created_at),
    channel: text(o.channel),
    payment_method: text(o.payment_method),
    total_amount: money(o.total_amount),
    discount: money(o.discount),
    net_amount: money(o.net_amount),
    refunded_amount: money(o.refunded_amount),
    cash_received: moneyOrNull(o.cash_received),
    change_amount: moneyOrNull(o.change_amount),
    status: text(o.status),
    cashier_name: textOrNull(o.cashier_name),
    note: textOrNull(o.note),
    void_reason: textOrNull(o.void_reason),
  }
}

export function parseExportSaleItemRow(raw: unknown): ExportSaleItemRow {
  const o = asObj(raw) ?? {}
  return {
    sale_no: text(o.sale_no),
    created_at: text(o.created_at),
    sku: text(o.sku),
    product_name: text(o.product_name),
    size: textOrNull(o.size),
    color: textOrNull(o.color),
    qty: int(o.qty),
    unit_price: money(o.unit_price),
    subtotal: money(o.subtotal),
    unit_cost: moneyOrNull(o.unit_cost),
    returned_qty: int(o.returned_qty),
    bill_status: text(o.bill_status),
  }
}

export function parseExportMovementRow(raw: unknown): ExportMovementRow {
  const o = asObj(raw) ?? {}
  const before = int(o.qty_before)
  const after = int(o.qty_after)
  return {
    created_at: text(o.created_at),
    type: text(o.type),
    sku: text(o.sku),
    product_name: text(o.product_name),
    size: textOrNull(o.size),
    color: textOrNull(o.color),
    qty_change: has(o, 'qty_change') && o.qty_change !== null ? int(o.qty_change) : after - before,
    qty_before: before,
    qty_after: after,
    note: textOrNull(o.note),
    created_by_name: textOrNull(o.created_by_name),
  }
}

/** ชื่อไทยของประเภทการเคลื่อนไหวสต๊อก (ไฟล์ส่งออก) — ค่าที่ไม่รู้จักให้แสดงค่าเดิม */
export const MOVEMENT_TYPE_LABELS: Readonly<Record<StockMovementType, string>> = {
  in: 'รับเข้า',
  out: 'จ่ายออก/ขาย',
  adjust: 'ปรับยอด',
  return: 'รับคืน',
}

export function movementTypeLabel(type: string | null | undefined): string {
  const t = String(type ?? '')
  return Object.prototype.hasOwnProperty.call(MOVEMENT_TYPE_LABELS, t) ? MOVEMENT_TYPE_LABELS[t as StockMovementType] : t
}
