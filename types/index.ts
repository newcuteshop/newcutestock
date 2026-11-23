import type { PaymentMethod, SaleChannel } from '@/lib/integrations/types'

// ===== สินค้า =====
// ตรงกับตาราง products ใน supabase-schema.sql (select('*') คืนทุกคอลัมน์ ค่าว่างเป็น null)
// ตั้งแต่ supabase-fix-02.sql: 1 แถว = 1 SKU (1 ไซส์) ของ "แบบสินค้า" (product_groups)
// name / color / category_id ถูกคัดลอกมาจากแบบสินค้าอัตโนมัติ — แก้ผ่าน RPC save_product_group เท่านั้น
export interface Product {
  id: string
  group_id: string      // แบบสินค้า (product_groups.id) ที่ SKU นี้สังกัด — ลิงก์หน้าแก้ไขใช้ /products/<group_id>
  is_archived: boolean  // ไซส์ที่เลิกใช้ (เก็บไว้เพราะมีประวัติ) — ปิดขายเสมอ ไม่ต้องแสดงในตัวเลือกสินค้า
  name: string
  sku: string
  barcode: string | null
  category_id: string | null
  size: string | null
  color: string | null
  cost_price: number
  sell_price: number
  stock_qty: number
  min_stock: number     // จำนวนขั้นต่ำก่อนแจ้งเตือน
  image_url: string | null   // คอลัมน์เก่า ไม่ใช้แล้ว — รูปอยู่ในตาราง product_images (ต่อแบบสินค้า)
  is_active: boolean
  created_at: string
  updated_at: string
}

// ชนิดข้อมูลของแบบสินค้า/ไซส์/รูป จาก RPC (CONTRACT §2) — ตัวจริงอยู่ที่ lib/products.ts
export type {
  ProductGroupJson, SaveResultJson, VariantJson, ProductImageJson, AddedImageJson, DeletedGroupJson,
  GroupInput, VariantInput,
} from '@/lib/products'

// ===== การเคลื่อนไหวสต๊อก =====
export type StockMovementType = 'in' | 'out' | 'adjust' | 'return'

export interface StockMovement {
  id: string
  product_id: string
  product?: Product
  type: StockMovementType
  qty: number
  qty_before: number
  qty_after: number
  note?: string
  ref_id?: string       // อ้างอิง sale_id หรือ PO เลขที่
  created_by: string
  created_at: string
}

// ===== การขาย =====
export interface Sale {
  id: string
  sale_no: string
  items: SaleItem[]
  total_amount: number
  discount: number
  net_amount: number
  payment_method: PaymentMethod   // 'marketplace' = บิลจากออเดอร์แพลตฟอร์ม (ลูกค้าจ่ายผ่านแพลตฟอร์ม)
  note?: string
  client_id?: string | null   // กันบันทึกบิลซ้ำ (record_sale idempotent)
  created_by: string | null   // บิลจากออเดอร์แพลตฟอร์ม = null (ระบบสร้าง)
  created_at: string
  // ----- จาก supabase-fix-03-integrations.sql -----
  channel?: SaleChannel             // ช่องทางขาย ('store' = หน้าร้าน)
  channel_id?: string | null        // ช่องทางที่เชื่อมต่อ (บิลจากออเดอร์แพลตฟอร์ม)
  external_order_id?: string | null // เลขออเดอร์บนแพลตฟอร์ม
  voided_at?: string | null         // ออเดอร์ยกเลิกก่อนส่ง = ยกเลิกทั้งใบ (คืนสต๊อกแล้ว ไม่นับยอด)
  // ----- จาก supabase-fix-04-pos.sql (ยังไม่รัน = ไม่มีคีย์เหล่านี้ จึงเป็น optional ทั้งหมด) -----
  cash_received?: number | null     // เงินที่รับมาจากลูกค้า (เฉพาะเงินสดที่กรอก; ไม่กรอก/โอน/บัตร = null)
  change_amount?: number | null     // เงินทอน = cash_received - net_amount
  voided_by?: string | null         // ผู้กดยกเลิกบิล (บิลยกเลิกจากแพลตฟอร์ม = null)
  void_reason?: string | null       // เหตุผลที่ยกเลิกบิล
  refunded_amount?: number          // ยอดคืนเงินสะสมของบิลนี้ (คืนสินค้าได้หลายครั้ง) — 0 = ยังไม่เคยคืน
  created_by_name?: string | null   // ชื่อพนักงานขาย ณ ตอนบันทึก (บิลเก่าก่อน fix-04 = null)
}

export interface SaleItem {
  id: string
  sale_id: string
  product_id: string
  product?: Product
  qty: number
  unit_price: number
  unit_cost?: number | null   // ต้นทุน ณ ตอนขาย (record_sale เป็นคนเติม)
  subtotal: number
}

// ===== หมวดหมู่ =====
export interface Category {
  id: string
  name: string
  created_at: string
}

// ===== ผู้ใช้งาน =====
export interface Permissions {
  products: boolean
  stock: boolean
  sales: boolean
  labels: boolean
  reports: boolean
  users: boolean
  refunds: boolean   // ยกเลิกบิล / คืนสินค้า (ต้องมี sales ด้วยจึงจะเข้าหน้าประวัติบิลได้)
  // ----- ร้านเช่าชุด (supabase-fix-05-rental.sql) — rental_manage ครอบ rental เสมอ (เช็กด้วย lib/auth/permissions.ts) -----
  rental: boolean          // จอง / รับ-คืนชุด / รับเงิน
  rental_manage: boolean   // จัดการชุด / ราคา / ตั้งค่า / รายงาน
  // ----- ร้าน b.oncloud คอนเทนต์งานแต่ง (supabase-fix-07-wedding.sql) — wedding_manage ครอบ wedding เสมอ (เช็กด้วย lib/auth/permissions.ts) -----
  wedding: boolean          // งาน / ปฏิทิน / รับเงิน
  wedding_manage: boolean   // แพ็กเกจ / ทีมงาน / ตั้งค่า / รายงาน (เห็นค่าจ้างทีมและกำไร)
}

export const DEFAULT_PERMISSIONS: Permissions = {
  products: true,
  stock: true,
  sales: true,
  labels: true,
  reports: true,
  users: false,
  refunds: false, // ยกเลิกบิล/คืนเงินกระทบยอดเงิน — ผู้ใช้ใหม่ไม่ได้สิทธิ์นี้จนกว่าจะเปิดให้เอง
  // ร้านเช่าชุดเป็นอีกร้าน — ผู้ใช้ใหม่ยังไม่เห็นร้านนี้จนกว่าจะเปิดสิทธิ์ให้เอง
  rental: false,
  rental_manage: false,
  // ร้าน b.oncloud เป็นอีกร้าน — ผู้ใช้ใหม่ยังไม่เห็นร้านนี้จนกว่าจะเปิดสิทธิ์ให้เอง
  wedding: false,
  wedding_manage: false,
}

export const ADMIN_PERMISSIONS: Permissions = {
  products: true,
  stock: true,
  sales: true,
  labels: true,
  reports: true,
  users: true,
  refunds: true,
  rental: true,
  rental_manage: true,
  wedding: true,
  wedding_manage: true,
}

// ไม่มีสิทธิ์อะไรเลย — ใช้เป็นค่าเริ่มต้นแบบ fail-closed (หาโปรไฟล์ไม่เจอ / อ่านไม่ได้)
export const NO_PERMISSIONS: Permissions = {
  products: false,
  stock: false,
  sales: false,
  labels: false,
  reports: false,
  users: false,
  refunds: false,
  rental: false,
  rental_manage: false,
  wedding: false,
  wedding_manage: false,
}

export const PERMISSION_LABELS: Record<keyof Permissions, string> = {
  products: 'จัดการสินค้า',
  stock: 'รับ-จ่ายสต๊อก',
  sales: 'บันทึกการขาย',
  labels: 'พิมพ์บาร์โค้ด',
  reports: 'ดูรายงาน',
  users: 'จัดการผู้ใช้',
  refunds: 'ยกเลิกบิล / คืนสินค้า',
  rental: 'ร้านเช่าชุด: จอง/รับ-คืนชุด/รับเงิน',
  rental_manage: 'ร้านเช่าชุด: จัดการชุด/ราคา/ตั้งค่า/รายงาน',
  wedding: 'b.oncloud: งาน/ปฏิทิน/รับเงิน',
  wedding_manage: 'b.oncloud: แพ็กเกจ/ทีม/ตั้งค่า/รายงาน',
}

// กลุ่มสวิตช์สิทธิ์ในหน้าจัดการผู้ใช้ (แยกตามร้าน) — ทุกคีย์ของ Permissions ต้องอยู่ในกลุ่มใดกลุ่มหนึ่งพอดี 1 ครั้ง
// คีย์สิทธิ์ที่นับว่า "เข้าร้านนั้นได้" (ใช้ทั้ง lib/auth/permissions.ts shopAccess และเมนูฝั่งเบราว์เซอร์ — ที่เดียว ห้ามเขียนซ้ำ)
// NEWCUTE รวม users (จัดการผู้ใช้อยู่ในหน้าระบบของ NEWCUTE) · admin เข้าได้ทุกร้านเสมอ (ไม่ต้องดูคีย์)
export const SHOP_PERMISSION_KEYS: Readonly<Record<'newcute' | 'rental' | 'wedding', readonly (keyof Permissions)[]>> = {
  newcute: ['products', 'stock', 'sales', 'refunds', 'labels', 'reports', 'users'],
  rental: ['rental', 'rental_manage'],
  wedding: ['wedding', 'wedding_manage'],
}

/** จำนวนร้านที่บทบาท/สิทธิ์ชุดนี้เข้าได้ (0–3) — ฟังก์ชันล้วน ใช้ได้ทั้ง server และ client */
export function countAccessibleShops(role: 'admin' | 'staff' | null | undefined, permissions: Partial<Permissions> | null | undefined): number {
  if (role === 'admin') return 3
  const p = permissions ?? {}
  return (Object.keys(SHOP_PERMISSION_KEYS) as (keyof typeof SHOP_PERMISSION_KEYS)[])
    .filter(shop => SHOP_PERMISSION_KEYS[shop].some(k => p[k] === true)).length
}

export const PERMISSION_GROUPS: readonly { title: string; keys: readonly (keyof Permissions)[] }[] = [
  { title: 'ร้าน NEWCUTE', keys: ['products', 'stock', 'sales', 'refunds', 'labels', 'reports'] },
  { title: 'ร้านเช่าชุด', keys: ['rental', 'rental_manage'] },
  { title: 'b.oncloud (คอนเทนต์งานแต่ง)', keys: ['wedding', 'wedding_manage'] },
  { title: 'ระบบ', keys: ['users'] },
]

export interface UserProfile {
  id: string
  email: string
  full_name?: string
  role: 'admin' | 'staff'
  permissions: Permissions
  created_at: string
}

// ===== Dashboard Summary =====
export interface DashboardStats {
  total_products: number
  total_stock_value: number
  low_stock_count: number
  today_sales: number
  today_revenue: number
  monthly_revenue: number
}
