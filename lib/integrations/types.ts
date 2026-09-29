// lib/integrations/types.ts — ชนิดข้อมูลของระบบเชื่อมต่อ (ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และหน้าเว็บ — ห้าม import โมดูลฝั่งเซิร์ฟเวอร์ในไฟล์นี้)
// ตรงกับ JSON ที่ฟังก์ชันใน supabase-fix-03-integrations.sql คืน (ดู CONTRACT-INTEGRATIONS.md §2)
// เวลา (timestamptz) มาเป็นข้อความ ISO 8601 เสมอ; ตัวเลขเงินมาเป็น number

// ---------------------------------------------------------------------------
// ค่าคงที่ร่วม
// ---------------------------------------------------------------------------
export type Platform = 'line' | 'meta' | 'shopee' | 'lazada' | 'tiktok' | 'generic'
export const PLATFORMS: readonly Platform[] = ['line', 'meta', 'shopee', 'lazada', 'tiktok', 'generic'] as const

export type ChannelStatus = 'disconnected' | 'pending_approval' | 'connected' | 'error' | 'paused'
export type ChannelEnvironment = 'sandbox' | 'production'
export type ChannelStateAction = 'mark_pending_approval' | 'unmark_pending_approval' | 'pause' | 'resume'

/** สถานะกลางของออเดอร์ (adapter แปลงจากสถานะของแต่ละแพลตฟอร์ม — ไม่รู้จัก = 'unknown') */
export type OrderStatus =
  | 'unpaid' | 'paid' | 'ready_to_ship' | 'shipped' | 'completed' | 'cancel_pending'
  | 'cancelled' | 'return_requested' | 'returned' | 'expired' | 'unknown'

export type MappingStatus = 'mapped' | 'unmapped' | 'conflict' | 'ignored' | 'gone'
export type MatchSource = 'auto' | 'manual'
export type AttentionReason = 'unmapped_sku' | 'oversold' | 'unknown_status' | 'return_to_confirm'
export type StockTracking = 'live' | 'shadow'
export type OrderSource = 'webhook' | 'poll' | 'csv' | 'manual'
export type OrderListFilter = 'all' | 'attention' | 'oversold' | 'unmapped' | 'return' | 'shadow' | 'open'
export type ListingFilter = 'all' | 'mapped' | 'unmapped' | 'conflict' | 'ignored' | 'gone' | 'errors' | 'todo'
export type ResolveOrderAction = 'reprocess' | 'waive_owed' | 'track_stock' | 'dismiss'

export type SyncLogKind =
  | 'push_stock' | 'pull_orders' | 'webhook' | 'order' | 'catalog' | 'refresh_token' | 'test'
  | 'oauth' | 'reconcile' | 'feed' | 'csv' | 'admin' | 'worker'

export type OutboxStatus = 'pending' | 'processing' | 'done' | 'failed' | 'dead' | 'skipped'
export type OutboxReason =
  | 'stock_change' | 'listing_change' | 'options_change' | 'resync' | 'initial_push' | 'oversold' | 'retry'

/** sales.channel — ช่องทางของบิล */
export type SaleChannel = ManualSaleChannel | Platform
/** ช่องทางที่หน้าขายเลือกได้ (ส่งเป็น p_channel ของ record_sale) */
export type ManualSaleChannel = 'store' | 'facebook' | 'instagram' | 'line_chat' | 'other_chat'
export const MANUAL_SALE_CHANNELS: readonly ManualSaleChannel[] = ['store', 'facebook', 'instagram', 'line_chat', 'other_chat'] as const
/** sales.payment_method ('marketplace' = ลูกค้าจ่ายผ่านแพลตฟอร์ม — ใช้กับบิลจากออเดอร์แพลตฟอร์มเท่านั้น) */
export type PaymentMethod = 'cash' | 'transfer' | 'credit' | 'marketplace'

// ---------------------------------------------------------------------------
// ช่องทาง (integration_channel_json)
// ---------------------------------------------------------------------------
export interface ChannelOptions {
  push_stock: boolean
  pull_orders: boolean
  stock_buffer: number          // 0..1000
  zero_at_or_below: number      // 0..1000
  deduct_on: 'created' | 'paid'
  restock_returns: 'manual' | 'auto'
  shadow_mode: boolean
  poll_seconds: number          // 60..86400 (lazada ค่าเริ่มต้น 300, อื่นๆ 900)
  initial_push_done: boolean    // อ่านอย่างเดียว (ตั้งด้วย mark_initial_push)
  initial_push_at: string | null
}
/** ส่งให้ save_channel_options — เฉพาะคีย์ที่จะแก้ (ห้ามส่ง initial_push_*) */
export type ChannelOptionsInput = Partial<Omit<ChannelOptions, 'initial_push_done' | 'initial_push_at'>>

export interface ChannelCredentialHint {
  name: string                  // ชื่อความลับ เช่น 'api_key' (ไม่มีค่า)
  hint: string | null           // เช่น '•••• 1a2b' หรือค่าที่ไม่ลับทั้งตัว เช่น partner_id
  updated_at: string
}

export interface ChannelCounts {
  listings: number
  mapped: number
  unmapped: number
  conflict: number
  ignored: number
  gone: number
  push_errors: number
  outbox_pending: number
  outbox_failed: number
  outbox_dead: number
  orders_total: number
  orders_today: number          // วันนี้ตามเวลาไทย
  orders_attention: number
  oversold_orders: number
  unmapped_orders: number
  return_to_confirm: number
}

export interface ChannelJson {
  id: string
  platform: Platform
  platform_label: string
  display_name: string
  environment: ChannelEnvironment
  status: ChannelStatus
  status_reason: string | null
  options: ChannelOptions
  settings: Record<string, unknown>   // ค่าที่ไม่ลับ เช่น catalog_id, shop_cipher, partner_id
  db_capabilities: { push_stock: boolean; pull_orders: boolean }
  external_shop_id: string | null
  external_shop_name: string | null
  token_expires_at: string | null
  refresh_expires_at: string | null
  auth_expires_at: string | null
  last_sync_at: string | null
  last_orders_sync_at: string | null
  last_stock_push_at: string | null
  last_catalog_sync_at: string | null
  last_test_at: string | null
  last_test_ok: boolean | null
  last_error: string | null
  last_error_at: string | null
  consecutive_failures: number
  paused_until: string | null
  has_feed_token: boolean
  feed_token_rotated_at: string | null
  created_at: string
  updated_at: string
  credentials: ChannelCredentialHint[]
  counts?: ChannelCounts        // มีเมื่อได้จาก list/get/create/save/set_state/disconnect
}

// ---------------------------------------------------------------------------
// รายการบนแพลตฟอร์ม (integration_listing_json)
// ---------------------------------------------------------------------------
export interface ListingProduct {
  id: string
  group_id: string
  sku: string
  name: string
  size: string | null
  color: string | null
  label: string                 // 'เสื้อยืด A · M · ชมพู'
  stock_qty: number
  is_active: boolean
  is_archived: boolean
}

export interface ListingJson {
  id: string
  channel_id: string
  external_item_id: string
  external_sku_id: string
  external_sku: string | null
  external_inventory_id: string | null
  external_name: string | null
  external_variant_name: string | null
  external_status: string | null
  platform_qty: number | null
  platform_reserved: number | null
  platform_qty_at: string | null
  mapping_status: MappingStatus
  match_source: MatchSource | null
  push_enabled: boolean
  buffer_override: number | null
  last_seen_at: string | null
  last_pushed_qty: number | null
  last_pushed_at: string | null
  last_error: string | null
  last_error_at: string | null
  updated_at: string
  product: ListingProduct | null
  owed_qty: number | null       // ชิ้นที่ค้างส่งจากการขายเกิน (ทุกช่องทาง)
  push_qty: number | null       // จำนวนที่จะส่งตอนนี้ (สูตรเดียวกับ worker)
}

export interface ListingPage { total: number; offset: number; limit: number; rows: ListingJson[] }

export interface UnmatchedListing extends ListingJson {
  channel_name: string
  platform: Platform
  open_order_lines: number
  open_units: number
  candidates: { id: string; sku: string; label: string; is_active: boolean; stock_qty: number }[]
}

export interface SetMappingResult extends ListingJson { affected_order_ids: string[] }

export interface AutoMatchResult {
  changed: number
  total: number
  mapped: number
  unmapped: number
  conflict: number
  ignored: number
  gone: number
}
export interface UpsertListingsResult extends AutoMatchResult { received: number }

// ---------------------------------------------------------------------------
// ออเดอร์ (integration_order_json)
// ---------------------------------------------------------------------------
export interface OrderLineJson {
  id: string
  line_key: string
  external_item_id: string | null
  external_sku_id: string | null
  external_sku: string | null
  external_name: string | null
  listing_id: string | null
  product: { id: string; group_id: string; sku: string; label: string; stock_qty: number } | null
  qty: number
  qty_cancelled: number
  platform_qty_returned: number
  qty_returned_received: number
  qty_waived: number
  qty_deducted: number
  qty_restocked: number
  held: number                  // qty_deducted - qty_restocked
  qty_oversold: number
  unit_price: number | null
  max_return_receivable: number // เพดานของ confirm_return_restock (ค่าสัมบูรณ์)
}

export interface OrderJson {
  id: string
  channel_id: string
  platform: Platform
  platform_label: string
  channel_name: string
  external_order_id: string
  status: OrderStatus
  raw_status: string | null
  stock_tracking: StockTracking
  platform_created_at: string | null
  platform_updated_at: string | null
  shipped_at: string | null
  sale_id: string | null
  sale_no: string | null
  sale_voided_at: string | null
  currency: string
  items_total: number | null
  stock_applied: boolean
  has_oversold: boolean
  has_unmapped: boolean
  needs_attention: boolean
  attention_reasons: AttentionReason[]
  dismissed_reasons: AttentionReason[]
  resolved_at: string | null
  last_source: OrderSource | 'admin' | null
  created_at: string
  updated_at: string
  lines: OrderLineJson[]
}

export interface OrderPage { rows: OrderJson[]; next_before: string | null }

/** ผลของ record_channel_order */
export interface RecordOrderResult extends OrderJson {
  created: boolean
  stale: boolean                // snapshot เก่ากว่าที่เคยเห็น — ไม่ได้แก้อะไร
  changed: boolean
  deducted: number              // ตัดสต๊อกในครั้งนี้
  restocked: number             // คืนสต๊อกในครั้งนี้
  shadow_would_deduct: number
  applied_lines?: { line_key: string; product_id: string; deducted_now: number; restocked_now: number; held: number; oversold: number }[]
}
/** ผลของ cancel_channel_order */
export type CancelOrderResult =
  | { found: false; external_order_id: string }
  | (OrderJson & { found: true; stale: boolean; deducted: number; restocked: number })

// ---------------------------------------------------------------------------
// คิวส่งสต๊อก / event ขาเข้า (worker)
// ---------------------------------------------------------------------------
export interface OutboxJob {
  id: number
  channel_id: string
  platform: Platform
  product_id: string
  sku: string                   // SKU ในแอป
  qty: number                   // จำนวนที่ต้องส่ง (ค่าสัมบูรณ์ "ที่ผู้ซื้อซื้อได้")
  stock_qty: number
  owed_qty: number
  reason: OutboxReason
  attempts: number
  listing: {
    id: string
    external_item_id: string
    external_sku_id: string
    external_sku: string | null
    external_inventory_id: string | null
    extra: Record<string, unknown>
    platform_qty: number | null
    platform_reserved: number | null
    last_pushed_qty: number | null
  }
}

export type PushResult =
  | { id: number; ok: true; pushed_qty: number; platform_qty?: number }
  | { id: number; ok: false; error: string; permanent: boolean; retry_after_seconds?: number }

export interface InboundEventJob {
  id: number
  channel_id: string
  platform: Platform
  event_id: string
  event_type: string | null
  external_order_id: string | null
  payload: unknown
  attempts: number
  received_at: string
}

// ---------------------------------------------------------------------------
// รูปแบบกลางที่ adapter ส่งเข้า RPC
// ---------------------------------------------------------------------------
/** 1 แถว = 1 ตัวเลือก (ไซส์) บนแพลตฟอร์ม → upsert_channel_listings */
export interface NormalizedListing {
  sku_id: string                // รหัสตัวเลือกที่ไม่ซ้ำในช่องทาง (Shopee '<item_id>:<model_id>', Lazada SkuId, TikTok sku_id, LINE variantId, Meta retailer_id)
  item_id?: string              // รหัสสินค้า (listing) บนแพลตฟอร์ม
  sku?: string | null           // SKU ของร้านบนแพลตฟอร์ม (ใช้จับคู่อัตโนมัติ)
  inventory_id?: string | null  // LINE inventoryId
  name?: string | null
  variant_name?: string | null
  status?: string | null
  qty?: number | null           // สต๊อกที่ผู้ซื้อซื้อได้บนแพลตฟอร์มตอนนี้ (ใช้แสดงตาราง ก่อน/หลัง)
  reserved?: number | null
  extra?: Record<string, unknown> // ค่าที่ไม่ลับที่ต้องใช้ตอนส่งสต๊อก เช่น { warehouse_ids: [...] }
}

export interface NormalizedOrderLine {
  line_key?: string             // ไม่ใส่ = sku_id หรือ 'sku:<sku ตัวเล็ก>' — ต้องไม่ซ้ำในออเดอร์
  sku_id?: string               // ต้องเป็นรูปแบบเดียวกับ NormalizedListing.sku_id
  item_id?: string
  sku?: string | null
  name?: string | null
  qty: number                   // จำนวนรวมของตัวเลือกนี้ในออเดอร์ (แพลตฟอร์มที่ 1 บรรทัด = 1 ชิ้น ต้องรวมเอง)
  qty_cancelled?: number        // ชิ้นที่ยกเลิกแล้ว (ยกเลิกบางชิ้น)
  qty_returned?: number         // ชิ้นที่แพลตฟอร์มแจ้งว่าคืนถึงร้านแล้ว (คืนเงินอย่างเดียว = 0)
  unit_price?: number | null    // ราคาที่ผู้ซื้อจ่ายต่อชิ้น (หลังส่วนลดรายชิ้นถ้ามี)
}

export interface NormalizedOrder {
  external_order_id: string
  status: OrderStatus
  raw_status?: string | null
  created_at?: string | null    // ISO 8601 พร้อมโซนเวลา
  updated_at?: string | null    // ใช้กันข้อมูลเก่าทับข้อมูลใหม่ — ส่งเสมอถ้ามี
  shipped_at?: string | null
  was_shipped?: boolean         // true = ของออกจากร้านแล้ว (ยกเลิกหลังส่ง → รอแอดมินยืนยันรับคืน)
  currency?: string
  total?: number | null
  lines: NormalizedOrderLine[]  // ส่งทุกบรรทัดเสมอ
  raw?: Record<string, unknown> // snapshot ที่ตัดข้อมูลผู้ซื้อ/ความลับแล้ว (redact()) ≤ 64 KB
}

// ---------------------------------------------------------------------------
// อื่นๆ ที่หน้าจอใช้
// ---------------------------------------------------------------------------
export interface SyncLogRow {
  id: number
  channel_id: string | null
  channel_name: string | null
  platform: Platform | null
  kind: SyncLogKind
  ok: boolean
  summary: string
  detail: Record<string, unknown> | null
  actor: string | null
  actor_name: string | null
  duration_ms: number | null
  created_at: string
}
export interface SyncLogPage { rows: SyncLogRow[]; next_before_id: number | null }

export interface IntegrationAlerts {
  attention_orders: number
  oversold_orders: number
  unmapped_orders: number
  return_to_confirm: number
  unknown_status: number
  channels_error: number
  auth_expiring: number         // การอนุญาตหมดใน 14 วัน
  outbox_dead: number
}

export interface InitialPushPreviewRow {
  listing_id: string
  external_sku: string | null
  external_name: string | null
  external_variant_name: string | null
  product: { id: string; sku: string; label: string }
  stock_qty: number
  platform_qty: number | null
  platform_qty_at: string | null
  push_qty: number
}
export interface InitialPushPreview {
  channel_id: string
  initial_push_done: boolean
  initial_push_at: string | null
  push_stock: boolean
  rows: InitialPushPreviewRow[]
  summary: { total: number; increase: number; decrease: number; same: number; unknown: number }
}

export interface ExportStockRow {
  product_id: string
  sku: string
  barcode: string | null
  name: string
  size: string | null
  color: string | null
  category: string | null
  sell_price: number
  stock_qty: number
  owed_qty: number
  available: number
  is_active: boolean
  external_sku: string | null
  mapping_status: MappingStatus | null
}

export interface FeedItem {
  sku: string
  group_id: string
  title: string
  description: string
  category: string | null
  size: string | null
  color: string | null
  price: number
  quantity: number
  availability: 'in stock' | 'out of stock'
  image_paths: string[]         // path ในถัง product-images (สร้าง URL สาธารณะเอง)
}
export interface FeedItems { channel_id: string; platform: 'meta' | 'generic'; generated_at: string; items: FeedItem[] }

/** รูปแบบผลลัพธ์ของ server action ทุกตัว (ข้อความผิดพลาดเป็นภาษาไทย ไม่มีความลับ) */
export type ActionResult<T extends object = Record<string, never>> = ({ ok: true } & T) | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Adapter (ฝั่งเซิร์ฟเวอร์เท่านั้น — ชนิดข้อมูลอยู่ที่นี่เพื่อให้ทุก adapter ใช้แบบเดียวกัน)
// ---------------------------------------------------------------------------
/** โทเคนที่ได้จาก OAuth / ต่ออายุ — เวลาเป็น Date (store แปลงเป็น ISO เอง) */
export interface TokenSet {
  access_token: string
  refresh_token?: string
  access_expires_at?: Date | null
  refresh_expires_at?: Date | null
  auth_expires_at?: Date | null
}

export interface ConnectResult extends TokenSet {
  shop_id?: string
  shop_name?: string
  /** ค่าที่ไม่ลับ เก็บใน integration_channels.settings (เช่น shop_cipher, seller_id, short_code) */
  settings?: Record<string, unknown>
}

/** สิ่งที่ worker/route ส่งให้ adapter (สร้างโดย lib/integrations/store.ts) */
export interface AdapterContext {
  channel: ChannelJson
  /** ความลับที่ถอดรหัสแล้ว ชื่อตาม CredentialField.name + 'access_token' / 'refresh_token' — ห้าม log/ส่งกลับหน้าเว็บ */
  creds: Readonly<Record<string, string>>
  /** fetch ที่ผ่าน allowlist ของแพลตฟอร์มนี้ + timeout + redaction (lib/integrations/http.ts) */
  fetch: (url: string, init?: RequestInit & { timeoutMs?: number }) => Promise<Response>
  /** base URL ของ API (ค่าจริง หรือ mock server ตอนทดสอบ — lib/integrations/http.ts: apiBase()) */
  apiBase: (key: string) => string
  now: () => Date
}

export interface InboundEventInput {
  event_id: string              // กันซ้ำ: LINE x-request-id (สำรอง orderNumber:event.name:event.timestamp), TikTok tts_notification_id, Shopee shop_id:code:ordersn:status:update_time
  event_type: string | null
  external_order_id: string | null
  payload: Record<string, unknown>  // body ที่ parse แล้ว (store จะ redact + ตัดข้อมูลผู้ซื้อก่อนเก็บ)
}

/** ผลการแปลง event → งานที่ worker ต้องทำกับฐานข้อมูล */
export type EventAction =
  | { kind: 'order'; order: NormalizedOrder }                       // → record_channel_order
  | { kind: 'fetch_orders'; external_order_ids: string[] }          // → fetchOrdersByIds แล้ว record_channel_order
  | { kind: 'cancel'; external_order_id: string; status: 'cancelled' | 'expired'; was_shipped?: boolean; updated_at?: string }
  | { kind: 'ignore'; note: string }

export interface ChannelAdapter {
  platform: Platform
  /** ทดสอบคีย์/โทเคน (Shopee get_shop_info, Lazada /seller/get, TikTok /authorization/202309/shops, Meta GET /{catalog_id}, LINE GET /products?perPage=1) */
  testConnection(ctx: AdapterContext): Promise<{ ok: boolean; message: string; shop_id?: string; shop_name?: string; settings?: Record<string, unknown> }>
  /** รายการสินค้าบนแพลตฟอร์มทีละหน้า (สำหรับจับคู่อัตโนมัติ) — cursor ว่าง = หน้าแรก, next ว่าง = หมดแล้ว */
  fetchCatalog?(ctx: AdapterContext, cursor?: string): Promise<{ rows: NormalizedListing[]; next?: string }>
  /** ส่งสต๊อก (ค่าสัมบูรณ์ job.qty = จำนวนที่ผู้ซื้อซื้อได้) — คืนผลทุก job (สำเร็จบางส่วนได้) */
  pushStock?(ctx: AdapterContext, jobs: OutboxJob[]): Promise<PushResult[]>
  /** ดึงออเดอร์ที่อัปเดตในช่วงเวลา (polling กันพลาด) */
  fetchOrders?(ctx: AdapterContext, q: { since: Date; until: Date; cursor?: string }): Promise<{ orders: NormalizedOrder[]; cancels?: Extract<EventAction, { kind: 'cancel' }>[]; next?: string }>
  /** รายละเอียดออเดอร์ตามเลข (หลังได้ webhook ที่ไม่มีรายการสินค้า) */
  fetchOrdersByIds?(ctx: AdapterContext, ids: string[]): Promise<NormalizedOrder[]>
  /** ตรวจลายเซ็น webhook กับ body ดิบ (constant-time) — secrets = ความลับที่ถอดรหัสแล้วของช่องทางที่กำลังลอง */
  verifyWebhook?(input: { rawBody: string; headers: Headers; url: string }, secrets: Readonly<Record<string, string>>): boolean
  /** แตก webhook ที่ตรวจลายเซ็นแล้ว เป็น event (1 body อาจมีหลาย event) */
  parseWebhook?(rawBody: string, headers: Headers): InboundEventInput[]
  /** แปลง event ที่เก็บไว้ เป็นงาน (worker เรียก) */
  eventToActions?(ctx: AdapterContext, ev: InboundEventJob): Promise<EventAction[]>
  /** OAuth (Shopee / Lazada / TikTok) */
  buildAuthUrl?(ctx: AdapterContext, state: string, redirectUri: string): string
  exchangeCode?(ctx: AdapterContext, query: URLSearchParams, redirectUri: string): Promise<ConnectResult>
  refreshToken?(ctx: AdapterContext): Promise<TokenSet>
}
