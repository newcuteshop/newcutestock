// lib/integrations/platforms.ts — ข้อมูลแพลตฟอร์มที่หน้าจอและเซิร์ฟเวอร์ใช้ร่วมกัน (ไม่มีความลับ ใช้ใน 'use client' ได้)
// ห้าม import node:crypto / supabase admin / adapter ในไฟล์นี้
import type {
  AttentionReason, ChannelStatus, OrderStatus, Platform, SyncLogKind,
} from './types'

/** ช่องกรอกคีย์ในหน้าตั้งค่า — name = ชื่อแถวใน integration_credentials (a-z0-9_) */
export interface CredentialField {
  name: string
  label: string
  secret: boolean          // true = ช่องเขียนอย่างเดียว แสดงแค่ '•••• 1a2b' / false = แสดงค่าเต็มเป็นคำใบ้ได้
  required: boolean
  placeholder?: string
  help?: string
  /** ตรวจรูปแบบฝั่งเซิร์ฟเวอร์ก่อนเข้ารหัส (source ของ RegExp) */
  pattern?: string
  /** คัดลอกค่า (ไม่ลับ) ไปไว้ใน integration_channels.settings ด้วยคีย์นี้ */
  settingsKey?: string
}

export interface PlatformCapabilities {
  pushStock: boolean       // ส่งสต๊อกผ่าน API ได้ในรอบนี้
  pullOrders: boolean      // รับ/ดึงออเดอร์ผ่าน API ได้ในรอบนี้
  webhook: boolean         // มี route รับ webhook ที่ใช้งานจริง
  oauth: boolean           // เชื่อมร้านด้วยปุ่ม "เชื่อมต่อร้าน" (OAuth)
  catalog: boolean         // ดึงรายการสินค้าจากแพลตฟอร์มมาจับคู่ได้
  feed: boolean            // มีลิงก์ฟีดสินค้า
  csvImport: boolean       // นำเข้า CSV ออเดอร์ได้ (ทุกช่องทาง)
  csvExport: boolean       // ส่งออก CSV สต๊อกได้ (ทุกช่องทาง)
}

export interface PlatformMeta {
  platform: Platform
  label: string
  shortLabel: string
  /** อักษรย่อบนการ์ด (ไม่ใช้โลโก้แบรนด์) */
  badge: string
  authKind: 'api_key' | 'system_token' | 'oauth' | 'none'
  credentialFields: CredentialField[]
  capabilities: PlatformCapabilities
  /** รอบนี้ทำครบแค่ไหน — 'full' = ใช้งานจริงได้, 'auth_only' = เชื่อมร้าน/ต่อ token/ลายเซ็นได้ แต่ยังไม่ส่งสต๊อก/ดึงออเดอร์ (รออนุมัติ API) */
  phase: 'full' | 'auth_only' | 'fallback'
  supportsSandbox: boolean
  webhookPath: string | null      // ต่อท้าย APP_BASE_URL
  callbackPath: string | null
  developerUrl: string | null
  /** ขั้นตอนที่บอสต้องทำเอง (แสดงเป็นเช็กลิสต์) */
  setupSteps: string[]
}

const ALL_CSV = { csvImport: true, csvExport: true }

export const PLATFORM_META: Record<Platform, PlatformMeta> = {
  line: {
    platform: 'line',
    label: 'LINE SHOPPING',
    shortLabel: 'LINE',
    badge: 'L',
    authKind: 'api_key',
    credentialFields: [
      { name: 'api_key', label: 'API Key', secret: true, required: true, help: 'OA Plus > Settings > API keys > Generate (บัญชี Admin)', pattern: '^\\S{16,512}$' },
      { name: 'webhook_secret', label: 'Webhook Secret key', secret: true, required: true, help: 'E-Commerce > Shop settings > Open API settings > Edit webhook', pattern: '^\\S{8,512}$' },
    ],
    capabilities: { pushStock: true, pullOrders: true, webhook: true, oauth: false, catalog: true, feed: false, ...ALL_CSV },
    phase: 'full',
    supportsSandbox: false,
    webhookPath: '/api/integrations/line/webhook',
    callbackPath: null,
    developerUrl: 'https://oaplus.line.biz',
    setupSteps: [
      'เปิด LINE SHOPPING (MyShop) ใน LINE OA ถ้ายังไม่เปิด',
      'บัญชี Admin: Settings > API keys > Generate แล้วคัดลอก API Key มาใส่ในหน้านี้',
      'E-Commerce > Shop settings > Open API settings > Create Webhook ใส่ URL รับ webhook จากหน้านี้',
      'กด Edit webhook เพื่อดู Secret key แล้วคัดลอกมาใส่ในหน้านี้',
      'กด "ทดสอบการเชื่อมต่อ" → "ดึงรายการสินค้า" → ตรวจการจับคู่ → "ส่งสต๊อกครั้งแรก"',
    ],
  },
  meta: {
    platform: 'meta',
    label: 'Facebook / Instagram',
    shortLabel: 'Facebook/IG',
    badge: 'f',
    authKind: 'system_token',
    credentialFields: [
      { name: 'catalog_id', label: 'Catalog ID', secret: false, required: true, pattern: '^[0-9]{5,30}$', settingsKey: 'catalog_id' },
      { name: 'system_user_token', label: 'System User Token', secret: true, required: true, pattern: '^\\S{20,1024}$', help: 'Business Settings > System users > Generate new token (catalog_management, business_management)' },
      { name: 'app_secret', label: 'App Secret (ไม่บังคับ)', secret: true, required: false, pattern: '^[0-9a-f]{32}$', help: 'ใส่เมื่อเปิด "Require App Secret" ในแอป' },
      { name: 'business_id', label: 'Business ID (ไม่บังคับ)', secret: false, required: false, pattern: '^[0-9]{5,30}$', settingsKey: 'business_id' },
    ],
    capabilities: { pushStock: true, pullOrders: false, webhook: false, oauth: false, catalog: true, feed: true, ...ALL_CSV },
    phase: 'full',
    supportsSandbox: false,
    webhookPath: null,
    callbackPath: null,
    developerUrl: 'https://business.facebook.com/commerce',
    setupSteps: [
      'Meta Business Suite: ให้ธุรกิจเป็นเจ้าของ Page + IG + Catalog (Commerce Manager > สร้าง Catalog แบบ E-commerce สกุล THB)',
      'แนะนำ: สร้าง Catalog ทดสอบแยกอีก 1 อัน (NEWCUTE-TEST) แล้วลองกับอันนั้นก่อน',
      'developers.facebook.com: สร้าง App ประเภท Business ผูกกับธุรกิจเดียวกัน',
      'Business Settings > System users: สร้าง system user → Assign asset Catalog (Manage) → Add app → Generate token',
      'ใส่ Catalog ID + Token ในหน้านี้ แล้วกด "ทดสอบการเชื่อมต่อ"',
      'Facebook/IG ในไทยไม่มีระบบออเดอร์ให้ดึง — ขายผ่านแชตให้บันทึกที่หน้าขาย (เลือกช่องทาง Facebook/Instagram)',
    ],
  },
  shopee: {
    platform: 'shopee',
    label: 'Shopee',
    shortLabel: 'Shopee',
    badge: 'S',
    authKind: 'oauth',
    credentialFields: [
      { name: 'partner_id', label: 'Partner ID', secret: false, required: true, pattern: '^[0-9]{1,20}$', settingsKey: 'partner_id' },
      { name: 'partner_key', label: 'Partner Key', secret: true, required: true, pattern: '^\\S{16,256}$' },
    ],
    capabilities: { pushStock: false, pullOrders: false, webhook: false, oauth: true, catalog: false, feed: false, ...ALL_CSV },
    phase: 'auth_only',
    supportsSandbox: true,
    webhookPath: '/api/integrations/shopee/webhook',
    callbackPath: '/api/integrations/shopee/callback',
    developerUrl: 'https://open.shopee.com',
    setupSteps: [
      'สมัคร open.shopee.com ประเภท "Shopee Seller" (ไทย: เฉพาะ Mall หรือ Managed Seller) — รอรีวิว ~3 วันทำการ',
      'ระหว่างรอ กด "รออนุมัติ API" ในหน้านี้ และใช้ นำเข้า CSV ออเดอร์ / ส่งออก CSV สต๊อก ไปก่อน',
      'ผ่านแล้ว: สร้าง App แบบ Seller In-house System → ได้ Test Partner ID + Test Key (Sandbox)',
      'ประกาศ Redirect URL Domain = โดเมนของแอป และตั้ง Push URL = URL รับ webhook จากหน้านี้',
      'ใส่ Partner ID + Partner Key แล้วกด "เชื่อมต่อร้าน" (ร้านทดสอบ OTP 123456) → Go Live แล้วเปลี่ยนเป็นคีย์จริง',
    ],
  },
  lazada: {
    platform: 'lazada',
    label: 'Lazada',
    shortLabel: 'Lazada',
    badge: 'Lz',
    authKind: 'oauth',
    credentialFields: [
      { name: 'app_key', label: 'App Key', secret: false, required: true, pattern: '^[0-9]{3,20}$', settingsKey: 'app_key' },
      { name: 'app_secret', label: 'App Secret', secret: true, required: true, pattern: '^\\S{16,256}$' },
    ],
    capabilities: { pushStock: false, pullOrders: false, webhook: false, oauth: true, catalog: false, feed: false, ...ALL_CSV },
    phase: 'auth_only',
    supportsSandbox: false,
    webhookPath: '/api/integrations/lazada/webhook',
    callbackPath: '/api/integrations/lazada/callback',
    developerUrl: 'https://open.lazada.com',
    setupSteps: [
      'สมัคร open.lazada.com บทบาท Software Developer ประเภท "Enterprise/Personal Self-Developed"',
      'App Console > Create App หมวด "Seller In-house APP" → Callback URL = URL callback จากหน้านี้',
      'ใส่ร้านใน Authorized Seller Whitelist (กรอกเองในเว็บ Lazada เท่านั้น)',
      'ใส่ App Key + App Secret แล้วกด "เชื่อมต่อร้าน" (เลือก Thailand, ใช้หน้าต่างไม่ระบุตัวตนถ้าล็อกอินร้านอื่นอยู่)',
      'สถานะ Testing: token อยู่ได้ ~1 วัน — ต้องกดเชื่อมต่อใหม่ทุกวันจนกว่าจะ Apply Online',
    ],
  },
  tiktok: {
    platform: 'tiktok',
    label: 'TikTok Shop',
    shortLabel: 'TikTok',
    badge: 'T',
    authKind: 'oauth',
    credentialFields: [
      { name: 'app_key', label: 'App Key', secret: false, required: true, pattern: '^[0-9a-z]{4,64}$', settingsKey: 'app_key' },
      { name: 'app_secret', label: 'App Secret', secret: true, required: true, pattern: '^\\S{8,256}$' },
      { name: 'service_id', label: 'Service ID', secret: false, required: true, pattern: '^[0-9]{4,30}$', settingsKey: 'service_id' },
    ],
    capabilities: { pushStock: false, pullOrders: false, webhook: false, oauth: true, catalog: false, feed: false, ...ALL_CSV },
    phase: 'auth_only',
    supportsSandbox: false,
    webhookPath: '/api/integrations/tiktok/webhook',
    callbackPath: '/api/integrations/tiktok/callback',
    developerUrl: 'https://partner.tiktokshop.com',
    setupSteps: [
      'ตรวจว่าร้านมี Account Manager (ถ้าไม่มี เปิดตั๋วใน Seller Center ขอพิจารณา)',
      'partner.tiktokshop.com ด้วยบัญชีเจ้าของร้าน → TikTok Shop Seller → ตลาด TH → แบบรีวิวความปลอดภัย',
      'สร้าง Custom App: Redirect URL = URL callback จากหน้านี้, Webhook URL = URL รับ webhook จากหน้านี้',
      'ใส่ App Key + App Secret + Service ID แล้วกด "เชื่อมต่อร้าน" (ทดสอบกับ Development Shop ก่อน)',
    ],
  },
  generic: {
    platform: 'generic',
    label: 'ช่องทางอื่น (ฟีด / CSV)',
    shortLabel: 'อื่นๆ',
    badge: '+',
    authKind: 'none',
    credentialFields: [],
    capabilities: { pushStock: false, pullOrders: false, webhook: false, oauth: false, catalog: false, feed: true, ...ALL_CSV },
    phase: 'fallback',
    supportsSandbox: false,
    webhookPath: null,
    callbackPath: null,
    developerUrl: null,
    setupSteps: [
      'ลิงก์ฟีดสินค้า: ให้แพลตฟอร์มที่รับฟีด (Google Merchant Center ฯลฯ) มาดึงเองตามรอบ',
      'ส่งออก CSV สต๊อก: อัปโหลดใน Seller Center ของแพลตฟอร์มที่ไม่มี API',
      'นำเข้า CSV ออเดอร์: ตัดสต๊อกจากไฟล์ออเดอร์ (เลขออเดอร์เดิมนำเข้าซ้ำไม่ตัดซ้ำ)',
    ],
  },
}

export const CHANNEL_STATUS_LABELS: Record<ChannelStatus, string> = {
  disconnected: 'ยังไม่เชื่อมต่อ',
  pending_approval: 'รออนุมัติ API',
  connected: 'เชื่อมต่อแล้ว',
  error: 'มีข้อผิดพลาด',
  paused: 'หยุดชั่วคราว',
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  unpaid: 'รอชำระเงิน',
  paid: 'ชำระแล้ว',
  ready_to_ship: 'รอส่งของ',
  shipped: 'ส่งแล้ว',
  completed: 'สำเร็จ',
  cancel_pending: 'รอยกเลิก',
  cancelled: 'ยกเลิก',
  return_requested: 'ขอคืนสินค้า',
  returned: 'คืนสินค้าแล้ว',
  expired: 'หมดอายุ',
  unknown: 'สถานะไม่รู้จัก',
}

export const ATTENTION_LABELS: Record<AttentionReason, string> = {
  oversold: 'ขายเกิน',
  unmapped_sku: 'จับคู่สินค้าไม่ได้',
  unknown_status: 'สถานะไม่รู้จัก',
  return_to_confirm: 'รอยืนยันรับของคืน',
}

// ชื่อช่องทางขาย/วิธีชำระ อยู่ในไฟล์เล็ก labels.ts (หน้าขาย POS import ตรงได้) — re-export ไว้ให้โค้ดเดิม
export { SALE_CHANNEL_LABELS, MANUAL_SALE_CHANNEL_OPTIONS, PAYMENT_METHOD_LABELS, saleChannelLabel } from './labels'

export const SYNC_LOG_KIND_LABELS: Record<SyncLogKind, string> = {
  push_stock: 'ส่งสต๊อก',
  pull_orders: 'ดึงออเดอร์',
  webhook: 'webhook',
  order: 'ออเดอร์',
  catalog: 'รายการสินค้า',
  refresh_token: 'ต่ออายุ token',
  test: 'ทดสอบการเชื่อมต่อ',
  oauth: 'เชื่อมต่อร้าน',
  reconcile: 'กระทบยอด',
  feed: 'ลิงก์ฟีด',
  csv: 'CSV',
  admin: 'แอดมิน',
  worker: 'ระบบ',
}

/** URL เต็มสำหรับให้บอสคัดลอกไปกรอกในหน้านักพัฒนาของแพลตฟอร์ม (baseUrl = APP_BASE_URL ไม่มี / ท้าย) */
export function platformUrls(platform: Platform, baseUrl: string): { webhook: string | null; callback: string | null; domain: string } {
  const meta = PLATFORM_META[platform]
  const base = baseUrl.replace(/\/+$/, '')
  let domain = base
  try { domain = new URL(base).host } catch { /* ใช้ค่าเดิม */ }
  return {
    webhook: meta.webhookPath ? base + meta.webhookPath : null,
    callback: meta.callbackPath ? base + meta.callbackPath : null,
    domain,
  }
}

export function isPlatform(v: unknown): v is Platform {
  return typeof v === 'string' && (v === 'line' || v === 'meta' || v === 'shopee' || v === 'lazada' || v === 'tiktok' || v === 'generic')
}
