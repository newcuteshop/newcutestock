// ใบเสร็จรับเงิน / ใบคืนสินค้า สำหรับสั่งพิมพ์ (ใช้คู่กับ components/pos/PrintPortal.tsx)
// ไม่มี hook/สถานะ — วาดจากข้อมูลที่ส่งมาอย่างเดียว ใช้ได้ทั้งหน้าขาย (บิลที่เพิ่งบันทึก) และหน้าประวัติบิล (พิมพ์ซ้ำ)
// สไตล์ทั้งหมดอยู่ใน app/globals.css (.receipt*) — ความกว้างตามกระดาษมาจาก data-paper ที่ PrintPortal ใส่ให้ <body>
// ห้ามประกอบชื่อคลาสจากตัวแปร (Tailwind ตัดคลาสที่ไม่เจอในโค้ดทิ้ง) → เขียนชื่อคลาส .receipt-* ตรงๆ ทุกที่
import { formatThaiDateTime, productLabel } from '@/lib/format'
import { PAYMENT_METHOD_LABELS, saleChannelLabel } from '@/lib/integrations/labels'
import type { SaleReturn, ShopSettings } from '@/lib/pos'

export interface ReceiptSaleItem {
  name: string
  size: string | null
  color: string | null
  qty: number
  unit_price: number
  subtotal: number
  returned_qty?: number
}

/** ข้อมูลบิลที่ใบเสร็จต้องใช้ — SaleDetail (lib/pos) และผลบันทึกการขายในหน้า POS ใช้ได้ทั้งคู่ */
export interface ReceiptSale {
  sale_no: string
  created_at: string
  channel?: string | null
  payment_method: string
  total_amount: number
  discount: number
  net_amount: number
  cash_received?: number | null
  change_amount?: number | null
  refunded_amount?: number | null
  voided_at?: string | null
  cashier_name?: string | null
  items: readonly ReceiptSaleItem[]
}

export default function Receipt({
  shop,
  sale,
  variant = 'sale',
  returnInfo,
  reprint = false,
  test = false,
  printedAt,
}: {
  shop: ShopSettings
  sale: ReceiptSale
  variant?: 'sale' | 'return'
  returnInfo?: SaleReturn | null
  reprint?: boolean
  // ใบตัวอย่าง/ทดสอบพิมพ์ของหน้าตั้งค่าร้าน: ใช้ใบเสร็จตัวนี้ตัวเดียวกัน (ตัดบรรทัด/ตัวเลขตรงกับของจริง) + ป้าย "ทดสอบการพิมพ์"
  test?: boolean
  // เวลาที่พิมพ์ในบรรทัดท้าย (ไม่ส่ง = ตอนนี้) — ตัวอย่างบนจอส่งเวลาจากเซิร์ฟเวอร์มา กันข้อความ server/client ไม่ตรงกัน
  printedAt?: string | Date
}) {
  const isReturn = variant === 'return' && !!returnInfo
  return (
    <div className="receipt">
      <ShopHeader shop={shop} />
      <hr className="receipt-sep" />
      {isReturn && returnInfo
        ? <ReturnBody shop={shop} sale={sale} ret={returnInfo} reprint={reprint} />
        : <SaleBody shop={shop} sale={sale} reprint={reprint} test={test} />}
      <hr className="receipt-sep" />
      {shop.receipt_footer && (
        <p className="receipt-center whitespace-pre-line">{shop.receipt_footer}</p>
      )}
      {/* บรรทัดท้าย: ชื่อระบบ + เวลาที่พิมพ์จริง (พิมพ์ซ้ำจะเห็นว่าพิมพ์ทีหลัง) */}
      <p className="receipt-center receipt-small" style={{ marginTop: 6 }}>
        NEWCUTE · พิมพ์ {formatThaiDateTime(printedAt ?? new Date())}
      </p>
      {test && <p className="receipt-center receipt-small">ใบทดสอบ ไม่ใช่ใบเสร็จจริง</p>}
    </div>
  )
}

function ShopHeader({ shop }: { shop: ShopSettings }) {
  return (
    <>
      <p className="receipt-shop">{shop.shop_name}</p>
      {shop.branch_name && <p className="receipt-center">{shop.branch_name}</p>}
      {shop.address && <p className="receipt-center receipt-small whitespace-pre-line">{shop.address}</p>}
      {shop.phone && <p className="receipt-center receipt-small">โทร {shop.phone}</p>}
      {shop.tax_id && <p className="receipt-center receipt-small">เลขประจำตัวผู้เสียภาษี {shop.tax_id}</p>}
    </>
  )
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className ? `receipt-row ${className}` : 'receipt-row'}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

function SaleBody({ shop, sale, reprint, test = false }: { shop: ShopSettings; sale: ReceiptSale; reprint: boolean; test?: boolean }) {
  const qty = sale.items.reduce((s, it) => s + (Number.isFinite(it.qty) ? it.qty : 0), 0)
  const refunded = typeof sale.refunded_amount === 'number' ? sale.refunded_amount : 0
  const cash = sale.payment_method === 'cash' && typeof sale.cash_received === 'number' ? sale.cash_received : null
  const change = cash !== null && typeof sale.change_amount === 'number' ? sale.change_amount : null
  const channel = sale.channel && sale.channel !== 'store' ? saleChannelLabel(sale.channel) : ''
  return (
    <>
      <p className="receipt-title">ใบเสร็จรับเงิน{reprint ? ' (พิมพ์ซ้ำ)' : ''}</p>
      {test && <div className="receipt-banner">ทดสอบการพิมพ์</div>}
      {sale.voided_at && <div className="receipt-banner">ยกเลิกแล้ว</div>}
      <Row label="เลขที่" value={sale.sale_no} />
      <Row label="วันที่" value={formatThaiDateTime(sale.created_at)} />
      {shop.show_cashier && sale.cashier_name && <Row label="พนักงาน" value={sale.cashier_name} className="receipt-row-wrap" />}
      {channel && <Row label="ช่องทาง" value={channel} />}
      <hr className="receipt-sep" />
      {sale.items.map((it, i) => (
        <div key={`${it.name}-${i}`} className="receipt-item">
          <div>{productLabel(it)}</div>
          <div className="receipt-row">
            <span>{`${it.qty} x ${amount(it.unit_price)}`}</span>
            <span>{amount(it.subtotal)}</span>
          </div>
          {reprint && typeof it.returned_qty === 'number' && it.returned_qty > 0 && (
            <div className="receipt-small">{`(คืนแล้ว ${it.returned_qty} ชิ้น)`}</div>
          )}
        </div>
      ))}
      <hr className="receipt-sep" />
      <Row label={`รวม ${qty} ชิ้น`} value={amount(sale.total_amount)} />
      {sale.discount > 0 && <Row label="ส่วนลด" value={`-${amount(sale.discount)}`} />}
      <Row label="ยอดสุทธิ" value={amount(sale.net_amount)} className="receipt-total" />
      <Row label="ชำระโดย" value={paymentLabel(sale.payment_method)} />
      {cash !== null && <Row label="รับเงิน" value={amount(cash)} />}
      {change !== null && <Row label="เงินทอน" value={amount(change)} className="receipt-bold" />}
      {reprint && refunded > 0 && (
        <>
          <Row label="คืนเงินแล้ว" value={`-${amount(refunded)}`} />
          <Row label="คงเหลือสุทธิ" value={amount(Math.max(0, sale.net_amount - refunded))} className="receipt-bold" />
        </>
      )}
      <p className="receipt-right receipt-small">จำนวนเงินเป็นบาท</p>
    </>
  )
}

function ReturnBody({ shop, sale, ret, reprint }: { shop: ShopSettings; sale: ReceiptSale; ret: SaleReturn; reprint: boolean }) {
  const qty = ret.items.reduce((s, it) => s + (Number.isFinite(it.qty) ? it.qty : 0), 0)
  return (
    <>
      <p className="receipt-title">ใบคืนสินค้า / คืนเงิน{reprint ? ' (พิมพ์ซ้ำ)' : ''}</p>
      <Row label="เลขที่" value={ret.return_no} />
      <Row label="อ้างอิงบิล" value={ret.sale_no || sale.sale_no} />
      <Row label="วันที่" value={formatThaiDateTime(ret.created_at)} />
      {shop.show_cashier && ret.created_by_name && <Row label="พนักงาน" value={ret.created_by_name} className="receipt-row-wrap" />}
      <hr className="receipt-sep" />
      {ret.items.map((it, i) => (
        <div key={`${it.product_id}-${i}`} className="receipt-item">
          <div>{productLabel(it)}</div>
          <div className="receipt-row">
            <span>{`${it.qty} x ${amount(it.unit_price)}`}</span>
            <span>{amount(it.refund_amount)}</span>
          </div>
        </div>
      ))}
      <hr className="receipt-sep" />
      <Row label="จำนวนที่คืน" value={`${qty} ชิ้น`} />
      <Row label="ยอดคืนเงิน" value={amount(ret.refund_amount)} className="receipt-total" />
      <Row label="คืนเงินโดย" value={paymentLabel(ret.refund_method)} />
      <p className="receipt-right receipt-small">จำนวนเงินเป็นบาท</p>
      {ret.reason && <p style={{ marginTop: 4 }}>{`เหตุผล: ${ret.reason}`}</p>}
      {/* ช่องลงชื่อลูกค้าผู้รับเงินคืน (เก็บใบนี้เป็นหลักฐาน) */}
      <p style={{ marginTop: 18 }}>ผู้รับเงินคืน ........................................</p>
    </>
  )
}

// ===== รูปแบบตัวเลขบนใบเสร็จ: ทศนิยม 2 ตำแหน่งเสมอ มีคอมมา (แบบใบเสร็จทั่วไป) — หน้าจอใช้ baht() ตามเดิม =====
const amountFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function amount(n: number | null | undefined): string {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0.00'
  const text = amountFormatter.format(Math.abs(v))
  return v < 0 && text !== '0.00' ? `-${text}` : text
}

function paymentLabel(method: string): string {
  return (PAYMENT_METHOD_LABELS as Record<string, string>)[method] ?? method
}
