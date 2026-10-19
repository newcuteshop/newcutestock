'use client'
// ===== ป้ายแขวนชิ้นชุด (A4) — พิมพ์ผ่าน components/pos/PrintPortal.tsx (paper 'a4') =====
// 1 แผ่น A4 = 9 ป้าย (3 × 3) ขนาด 64 × 92 มม. มีเส้นประรอบป้ายไว้ตัด + วงกลมตำแหน่งเจาะรูร้อยเชือก
// ในป้าย: ชื่อร้าน (จาก rental_settings — ห้าม hardcode) · รหัส+ชื่อชุด · ไซส์ตัวใหญ่ · ค่าเช่า (เลือกได้)
//          · บาร์โค้ด CODE128 ของรหัสชิ้น (สแกนตอนรับ-คืนชุด) · QR เล็ก (เลือกได้: รหัสชิ้น หรือ ลิงก์หน้าจองออนไลน์ของชุด)
//
// ขั้นตอน: prepareUnitTags() สร้างรูปบาร์โค้ด/QR เป็น data URL ก่อน (ต้องโหลด jsbarcode / qrcode แบบ async)
//          → ส่งผลให้ <UnitTagsPrint> วาดแบบ synchronous ใน PrintPortal (PrintPortal รอรูปโหลดเสร็จก่อนสั่งพิมพ์)
// บาร์โค้ดเป็น SVG (เส้นคมทุกความละเอียดเครื่องพิมพ์) · ใช้ style หน่วย มม. ตรงๆ เพราะ globals.css ไม่มีคลาสสำหรับป้ายนี้
// สีดำล้วนบนขาว (เครื่องพิมพ์ขาวดำ/ประหยัดหมึก) · ฟอนต์เดียวกับระบบ (รองรับภาษาไทย)

import type { CSSProperties } from 'react'
import { makeQrDataUrl } from '@/components/rental/QrImage'
import { sizeLabel, type RentalSize } from '@/lib/rental'

export type TagQrMode = 'none' | 'unit' | 'link'

export interface UnitTag {
  unit_id: string
  unit_code: string
  item_code: string
  item_name: string
  size: RentalSize
  /** ข้อความค่าเช่า เช่น "฿1,500 / 3 วัน" (null = ไม่แสดง) */
  price_text: string | null
}

export interface PreparedUnitTag extends UnitTag {
  barcode: string | null   // data URL ของ SVG ; null = สร้างไม่ได้
  qr: string | null        // data URL ของ PNG ; null = ไม่มี QR
}

export const TAGS_PER_PAGE = 9
const TAG_W = 64   // มม.
const TAG_H = 92
const GAP = 4
const BARCODE_W = 54
// เส้นบาร์โค้ดที่บางกว่านี้ (มม.ต่อ 1 โมดูล) สแกนยากกับเครื่องสแกนทั่วไป
const MIN_MODULE_MM = 0.19
const QUIET_MODULES = 10

type JsBarcodeFn = (element: unknown, data: string, options?: Record<string, unknown>) => void

let barcodeModule: Promise<JsBarcodeFn> | null = null
function loadJsBarcode(): Promise<JsBarcodeFn> {
  if (!barcodeModule) {
    barcodeModule = import('jsbarcode').then(m => {
      // CommonJS (export =) → ได้ทั้งแบบมี default และแบบฟังก์ชันตรง แล้วแต่ bundler
      const mod = m as unknown as { default?: unknown }
      return (typeof mod.default === 'function' ? mod.default : m) as unknown as JsBarcodeFn
    })
    barcodeModule.catch(() => { barcodeModule = null })
  }
  return barcodeModule
}

// สร้างบาร์โค้ด CODE128 เป็น SVG data URL (เรียกได้เฉพาะในเบราว์เซอร์) → {url, thin}
function barcodeSvg(JsBarcode: JsBarcodeFn, code: string): { url: string; thin: boolean } {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  JsBarcode(svg, code, {
    format: 'CODE128',
    width: 1,
    height: 40,
    displayValue: false,
    margin: 0,
    marginLeft: QUIET_MODULES,
    marginRight: QUIET_MODULES,
    background: '#ffffff',
    lineColor: '#000000',
  })
  // ยืดให้เต็มกล่องรูปในป้าย (สัดส่วนแนวนอนของทุกเส้นเท่ากัน สแกนได้ปกติ)
  svg.setAttribute('preserveAspectRatio', 'none')
  const modules = parseFloat(svg.getAttribute('width') ?? '0')
  const thin = !(modules > 0) || BARCODE_W / modules < MIN_MODULE_MM
  const xml = new XMLSerializer().serializeToString(svg)
  return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`, thin }
}

/**
 * เตรียมรูปบาร์โค้ด/QR ของป้ายทั้งหมด (เรียกได้เฉพาะในเบราว์เซอร์)
 * linkBase = origin ของเว็บ (เช่น window.location.origin) ใช้กับ QR แบบลิงก์หน้าจองออนไลน์ '/book/item/<รหัสชุด>'
 * คืนป้ายที่พร้อมพิมพ์ + ข้อความเตือน (รหัสยาวจนเส้นบาง / สร้างบาร์โค้ดไม่ได้)
 */
export async function prepareUnitTags(
  tags: readonly UnitTag[],
  opts: { qr: TagQrMode; linkBase?: string },
): Promise<{ tags: PreparedUnitTag[]; problems: string[] }> {
  const JsBarcode = await loadJsBarcode()
  const problems: string[] = []
  const thinCodes: string[] = []
  const qrCache = new Map<string, Promise<string | null>>()
  const qrFor = (text: string): Promise<string | null> => {
    let p = qrCache.get(text)
    if (!p) {
      p = makeQrDataUrl(text, 64).catch(() => null)
      qrCache.set(text, p)
    }
    return p
  }
  const out: PreparedUnitTag[] = []
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i]
    let barcode: string | null = null
    try {
      const b = barcodeSvg(JsBarcode, t.unit_code)
      barcode = b.url
      if (b.thin) thinCodes.push(t.unit_code)
    } catch {
      problems.push(`สร้างบาร์โค้ดของรหัส ${t.unit_code} ไม่ได้ (ป้ายนี้จะมีแต่ตัวอักษร)`)
    }
    let qr: string | null = null
    if (opts.qr === 'unit') qr = await qrFor(t.unit_code)
    else if (opts.qr === 'link' && opts.linkBase) {
      qr = await qrFor(`${opts.linkBase.replace(/\/+$/, '')}/book/item/${encodeURIComponent(t.item_code)}`)
    }
    out.push({ ...t, barcode, qr })
    // พักให้หน้าจอตอบสนองทุก 30 ป้าย (ป้ายเยอะ)
    if (i % 30 === 29) await new Promise(r => setTimeout(r, 0))
  }
  if (thinCodes.length > 0) {
    const sample = thinCodes.slice(0, 3).join(', ')
    problems.push(`รหัสชิ้นยาว เส้นบาร์โค้ดบางมาก อาจสแกนยาก: ${sample}${thinCodes.length > 3 ? ` และอีก ${thinCodes.length - 3} รหัส` : ''}`)
  }
  return { tags: out, problems }
}

const S: Record<string, CSSProperties> = {
  page: {
    display: 'grid',
    gridTemplateColumns: `repeat(3, ${TAG_W}mm)`,
    gridAutoRows: `${TAG_H}mm`,
    columnGap: `${GAP}mm`,
    rowGap: `${GAP}mm`,
    justifyContent: 'center',
    alignContent: 'start',
    width: '100%',
    color: '#000',
    background: '#fff',
  },
  tag: {
    position: 'relative',
    boxSizing: 'border-box',
    width: `${TAG_W}mm`,
    height: `${TAG_H}mm`,
    padding: '9mm 4mm 3mm',
    border: '0.3mm dashed #777',
    borderRadius: '3mm',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: '1.2mm',
    overflow: 'hidden',
    breakInside: 'avoid',
    pageBreakInside: 'avoid',
    fontSize: '9pt',
    lineHeight: 1.25,
  },
  hole: {
    position: 'absolute',
    top: '2.5mm',
    left: '50%',
    width: '4.5mm',
    height: '4.5mm',
    marginLeft: '-2.25mm',
    border: '0.3mm solid #000',
    borderRadius: '50%',
  },
  shop: {
    textAlign: 'center',
    fontSize: '8pt',
    fontWeight: 600,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    borderBottom: '0.2mm solid #000',
    paddingBottom: '1mm',
  },
  itemCode: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: '8.5pt',
  },
  itemName: {
    fontSize: '10pt',
    fontWeight: 700,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    overflowWrap: 'anywhere',
    minHeight: '8.5mm',
  },
  middle: {
    display: 'flex',
    alignItems: 'center',
    gap: '2mm',
    minHeight: '17mm',
  },
  sizeBox: {
    flex: '1 1 auto',
    minWidth: 0,
    border: '0.4mm solid #000',
    borderRadius: '1.5mm',
    padding: '0.8mm 1.5mm',
    textAlign: 'center',
  },
  sizeLabel: { fontSize: '7.5pt' },
  sizeValue: {
    fontSize: '20pt',
    fontWeight: 700,
    lineHeight: 1.1,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  qr: { width: '16mm', height: '16mm', flex: 'none', display: 'block' },
  price: { fontSize: '8.5pt', textAlign: 'center' },
  barcode: {
    display: 'block',
    width: `${BARCODE_W}mm`,
    height: '13mm',
    margin: 'auto auto 0',
  },
  unitCode: {
    textAlign: 'center',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: '11pt',
    fontWeight: 700,
    letterSpacing: '0.04em',
    overflowWrap: 'anywhere',
  },
}

function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** เนื้อหาที่พิมพ์ (วางใน <PrintPortal paper="a4">) — ต้องได้ป้ายจาก prepareUnitTags ก่อน */
export default function UnitTagsPrint({
  shopName, tags, showPrice = true,
}: {
  shopName: string
  tags: readonly PreparedUnitTag[]
  showPrice?: boolean
}) {
  const pages = chunk(tags, TAGS_PER_PAGE)
  return (
    <div>
      {pages.map((page, pi) => (
        <div
          key={pi}
          style={{ ...S.page, pageBreakAfter: pi < pages.length - 1 ? 'always' : 'auto', breakAfter: pi < pages.length - 1 ? 'page' : 'auto' }}
        >
          {page.map(t => (
            <div key={t.unit_id} style={S.tag}>
              <span style={S.hole} aria-hidden="true" />
              <div style={S.shop}>{shopName}</div>
              <div style={S.itemCode}>{t.item_code}</div>
              <div style={S.itemName}>{t.item_name}</div>
              <div style={S.middle}>
                <div style={S.sizeBox}>
                  <div style={S.sizeLabel}>ไซส์</div>
                  <div style={S.sizeValue}>{sizeLabel(t.size)}</div>
                </div>
                {t.qr && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.qr} alt="" style={S.qr} />
                )}
              </div>
              {showPrice && t.price_text && <div style={S.price}>ค่าเช่า {t.price_text}</div>}
              {t.barcode && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.barcode} alt="" style={S.barcode} />
              )}
              <div style={{ ...S.unitCode, marginTop: t.barcode ? 0 : 'auto' }}>{t.unit_code}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
