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
}

export const DEFAULT_PERMISSIONS: Permissions = {
  products: true,
  stock: true,
  sales: true,
  labels: true,
  reports: true,
  users: false,
}

export const ADMIN_PERMISSIONS: Permissions = {
  products: true,
  stock: true,
  sales: true,
  labels: true,
  reports: true,
  users: true,
}

// ไม่มีสิทธิ์อะไรเลย — ใช้เป็นค่าเริ่มต้นแบบ fail-closed (หาโปรไฟล์ไม่เจอ / อ่านไม่ได้)
export const NO_PERMISSIONS: Permissions = {
  products: false,
  stock: false,
  sales: false,
  labels: false,
  reports: false,
  users: false,
}

export const PERMISSION_LABELS: Record<keyof Permissions, string> = {
  products: 'จัดการสินค้า',
  stock: 'รับ-จ่ายสต๊อก',
  sales: 'บันทึกการขาย',
  labels: 'พิมพ์บาร์โค้ด',
  reports: 'ดูรายงาน',
  users: 'จัดการผู้ใช้',
}

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
