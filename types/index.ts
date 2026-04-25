// ===== สินค้า =====
export interface Product {
  id: string
  name: string
  sku: string
  barcode?: string
  category: string
  size?: string
  color?: string
  cost_price: number
  sell_price: number
  stock_qty: number
  min_stock: number     // จำนวนขั้นต่ำก่อนแจ้งเตือน
  image_url?: string
  is_active: boolean
  created_at: string
  updated_at: string
}

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
  payment_method: 'cash' | 'transfer' | 'credit'
  note?: string
  created_by: string
  created_at: string
}

export interface SaleItem {
  id: string
  sale_id: string
  product_id: string
  product?: Product
  qty: number
  unit_price: number
  subtotal: number
}

// ===== หมวดหมู่ =====
export interface Category {
  id: string
  name: string
  created_at: string
}

// ===== ผู้ใช้งาน =====
export interface UserProfile {
  id: string
  email: string
  full_name?: string
  role: 'admin' | 'staff'
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
