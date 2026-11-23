// ===== แปลงกล่อง HTML บนหน้าเว็บเป็นรูป PNG + แชร์ / บันทึก / คัดลอกรูป (ใช้ฝั่งเบราว์เซอร์เท่านั้น) =====
// ใช้ส่งเอกสารการจอง/ตารางงานเป็น "รูป" ให้ลูกค้า/ทีมงานทาง LINE (ร้าน b.oncloud) — ไม่ต้องสร้าง PDF
// - ใช้แพ็กเกจ html-to-image (โหลดตอนกดครั้งแรกด้วย dynamic import — หน้าที่ไม่ส่งรูปไม่ต้องโหลด และไม่หลุดเข้าฝั่งเซิร์ฟเวอร์)
//   วิธีทำงานของแพ็กเกจ: โคลนกล่อง + คัดลอกสไตล์ที่คำนวณแล้ว (สีจากตัวแปร CSS ของร้านจึงติดมาครบ) → ใส่ใน SVG foreignObject → วาดลง canvas
// - ฟอนต์: รูปใน SVG มองไม่เห็นฟอนต์ของหน้าเว็บ → ต้องฝังไฟล์ฟอนต์ (base64) ลงในรูป
//   สร้างชุด CSS ฟอนต์ครั้งเดียวต่อหน้า แล้วใช้ซ้ำทุกรูป (ไม่ดาวน์โหลด/แปลงใหม่ทุกครั้ง)
//   ตัดชุดอักษรที่ไม่ใช้ (ซีริลลิก/เวียดนาม ฯลฯ) ออก เหลือไทย + ละติน — รูปเล็กลงและวาดเร็วขึ้น
// - Safari/iPhone (WebKit) วาดรูปใน SVG ครั้งแรกมักออกมาว่าง (ถอดรหัสรูปไม่ทัน) → วาดอุ่นเครื่องหนึ่งรอบก่อน แล้วค่อยวาดจริง
//   และถ้าวาดพลาด/ได้ไฟล์ว่าง → ลองใหม่อีกครั้งเดียว
// - จำกัดขนาด canvas ไม่ให้เกินเพดานของ iPhone (~16.7 ล้านพิกเซล) — เอกสารยาวมากจะลดความละเอียดลงเองแทนการได้รูปว่าง
// - ขนาดตัวอักษรในรูปเท่าบนจอเป๊ะ (ปิดการลด 0.1px ของแพ็กเกจที่ทำให้มีช่องว่างแทรกระหว่างบรรทัด — ดู holdExactFontSize)
// - เบราว์เซอร์ในแอป LINE/Facebook: แชร์ไฟล์/ดาวน์โหลดอาจทำไม่ได้ → ผู้เรียกแสดงรูปให้กดค้างบันทึกเอง (ดูผลลัพธ์ของ shareOrDownload)
//   ไฟล์นี้ไม่เปิดแท็บใหม่ (target=_blank) และไม่ใช้ window.confirm ตามกติกาของเบราว์เซอร์ในแอป LINE

type HtmlToImage = typeof import('html-to-image')
type RenderOptions = NonNullable<Parameters<HtmlToImage['toBlob']>[1]>

const FONT_WAIT_MS = 3000
const IMAGE_WAIT_MS = 6000
// เพดานพื้นที่ canvas ของ iPhone/iPad (Safari ปฏิเสธ canvas ที่ใหญ่กว่านี้แบบเงียบๆ = ได้รูปว่าง)
const MAX_CANVAS_PIXELS = 16_000_000
// เพดานความยาวด้านเดียวของ canvas ในเบราว์เซอร์ส่วนใหญ่
const MAX_CANVAS_EDGE = 16_000
// PNG ที่เล็กกว่านี้ = รูปว่าง (พื้นขาวล้วน) เกือบแน่นอน — เอกสารจริงมีตัวอักษรเต็มหน้า
const MIN_REAL_PNG_BYTES = 4000

const MSG_RENDER_FAIL = 'สร้างรูปไม่สำเร็จ ลองใหม่อีกครั้ง (ถ้ายังไม่ได้ ให้โหลดหน้านี้ใหม่)'

let libPromise: Promise<HtmlToImage> | null = null

function loadLib(): Promise<HtmlToImage> {
  if (!libPromise) {
    libPromise = import('html-to-image')
    // โหลดไม่สำเร็จ (เน็ตหลุด) → ครั้งหน้าลองโหลดใหม่
    libPromise.catch(() => { libPromise = null })
  }
  return libPromise
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

function nextFrame(): Promise<void> {
  return new Promise(resolve => {
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => resolve())
    else window.setTimeout(resolve, 16)
  })
}

/** รอฟอนต์ของหน้าโหลดครบ (ไม่เกิน 3 วินาที) — ฟอนต์ไทยจาก next/font โหลดแบบ swap */
export async function waitForFonts(): Promise<void> {
  if (typeof document === 'undefined') return
  const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts
  if (!fonts || !fonts.ready) return
  await Promise.race([fonts.ready.then(() => undefined, () => undefined), delay(FONT_WAIT_MS)])
}

/** รอรูปทุกรูปในกล่องโหลดเสร็จ (รูปเสีย/ช้าเกินก็ไปต่อ) */
export async function waitForImages(root: HTMLElement, timeoutMs = IMAGE_WAIT_MS): Promise<void> {
  const pending = Array.from(root.querySelectorAll('img')).filter(img => !img.complete)
  if (pending.length === 0) return
  const all = Promise.all(
    pending.map(img => new Promise<void>(resolve => {
      img.addEventListener('load', () => resolve(), { once: true })
      img.addEventListener('error', () => resolve(), { once: true })
    })),
  ).then(() => undefined)
  await Promise.race([all, delay(timeoutMs)])
}

/** เบราว์เซอร์ตระกูล WebKit (Safari ทุกตัว + ทุกเบราว์เซอร์บน iPhone/iPad) */
export function isWebKit(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const iOS = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1)
  if (iOS) return true
  return /AppleWebKit/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/.test(ua)
}

/** เบราว์เซอร์ในแอป (LINE / Facebook / Instagram) — แชร์ไฟล์/ดาวน์โหลดมักใช้ไม่ได้ */
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  return /\bLine\/|FBAN|FBAV|FB_IAB|Instagram/i.test(navigator.userAgent || '')
}

// ---------------------------------------------------------------------------
// ฟอนต์ที่ฝังในรูป
// ---------------------------------------------------------------------------
let fontCssPromise: Promise<string | null> | null = null

// เก็บเฉพาะ @font-face ของชุดอักษรไทย/ละตินพื้นฐาน: ช่วง unicode-range มีไทย (U+E01 / U+0E01)
// หรือเริ่มที่ U+0 (ละติน 'U+0-FF' / 'U+0000-00FF' — เบราว์เซอร์เขียนแบบตัดเลขศูนย์นำหน้าก็มี)
// ไม่มี unicode-range = เก็บ · ตัดแล้วไม่เหลือเลย (รูปแบบไม่คาดคิด) → ใช้ทั้งชุดเดิม
function keepThaiLatin(css: string): string {
  const blocks = css.split(/(?=@font-face)/)
  const kept = blocks.filter(block => {
    const m = /unicode-range\s*:\s*([^;}]+)/i.exec(block)
    if (!m) return true
    const range = m[1].toUpperCase()
    return /U\+0?E[0-9A-F]{2}\b/.test(range) || /U\+0{1,4}-/.test(range)
  })
  const out = kept.join('').trim()
  return out || css
}

async function fontEmbedCss(lib: HtmlToImage, node: HTMLElement): Promise<string | null> {
  if (!fontCssPromise) {
    fontCssPromise = lib
      .getFontEmbedCSS(node)
      .then(css => (css && css.trim() ? keepThaiLatin(css) : null))
      .catch(() => null)
    // ได้ null (ดึงไฟล์ฟอนต์ไม่ได้) → รอบหน้าลองใหม่
    fontCssPromise.then(css => { if (css === null) fontCssPromise = null }, () => { fontCssPromise = null })
  }
  return fontCssPromise
}

// ---------------------------------------------------------------------------
// ขนาดตัวอักษรในรูปให้เท่าบนจอเป๊ะ
// ---------------------------------------------------------------------------
// html-to-image 1.11.x (ทาง Chrome/Android/Firefox) คัดลอกขนาดตัวอักษรของทุกกล่องเป็น floor(px) − 0.1 แต่คงความสูงกล่องเดิม
// → ตัวอักษรในรูปเล็กกว่าบนจอนิดเดียว บรรทัดที่บนจอขึ้นบรรทัดใหม่แบบเฉียดๆ กลับพอดีบรรทัดเดียวในรูป = มีช่องว่างเปล่าแทรก
//   (เห็นบ่อยในรายการเงื่อนไขยาวๆ) · Safari/iPhone ใช้อีกทางของแพ็กเกจที่ไม่ลดขนาดอยู่แล้ว
// แก้: ระหว่างสร้างรูปเท่านั้น getComputedStyle ของกล่องในเอกสารที่กำลังแปลงรายงาน font-size เป็นหน่วย pt (ค่าเท่าเดิม 1px = 0.75pt)
//   → แพ็กเกจไม่เข้าเงื่อนไข "ลงท้าย px" จึงคัดลอกขนาดจริง · กล่องอื่นของหน้า/ผู้เรียกอื่นได้ค่าปกติ · คืนค่าเดิมทันทีเมื่อเสร็จ
const exactRoots = new Set<HTMLElement>()
let realGetComputedStyle: typeof window.getComputedStyle | null = null

function inExactRoot(el: unknown): boolean {
  if (typeof Element === 'undefined' || !(el instanceof Element)) return false
  for (const root of Array.from(exactRoots)) if (root === el || root.contains(el)) return true
  return false
}

function exactFontStyle(cs: CSSStyleDeclaration): CSSStyleDeclaration {
  return new Proxy(cs, {
    get(target, prop) {
      if (prop === 'getPropertyValue') {
        return (name: string) => {
          const v = target.getPropertyValue(name)
          if (name === 'font-size') {
            const m = /^(\d+(?:\.\d+)?)px$/.exec(v.trim())
            if (m) return `${Math.round(Number(m[1]) * 0.75 * 10000) / 10000}pt`
          }
          return v
        }
      }
      const v: unknown = Reflect.get(target, prop, target)
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
    },
  })
}

/** เปิดโหมดขนาดตัวอักษรเป๊ะให้กล่อง root — คืนฟังก์ชันปิด (ต้องเรียกเสมอ แม้สร้างรูปพลาด) */
function holdExactFontSize(root: HTMLElement): () => void {
  exactRoots.add(root)
  if (!realGetComputedStyle) {
    const real = window.getComputedStyle
    realGetComputedStyle = real
    window.getComputedStyle = function (el: Element, pseudo?: string | null) {
      const cs = real.call(window, el, pseudo)
      return inExactRoot(el) ? exactFontStyle(cs) : cs
    } as typeof window.getComputedStyle
  }
  return () => {
    exactRoots.delete(root)
    if (exactRoots.size === 0 && realGetComputedStyle) {
      window.getComputedStyle = realGetComputedStyle
      realGetComputedStyle = null
    }
  }
}

// ความละเอียดที่ใช้จริง: ตามที่ขอ แต่ไม่ให้ canvas เกินเพดานพื้นที่/ความยาวด้าน
function safePixelRatio(wanted: number, width: number, height: number): number {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  let r = Number.isFinite(wanted) && wanted > 0 ? wanted : 1
  r = Math.min(r, Math.sqrt(MAX_CANVAS_PIXELS / (w * h)))
  r = Math.min(r, MAX_CANVAS_EDGE / w, MAX_CANVAS_EDGE / h)
  return Math.max(0.25, Math.round(r * 100) / 100)
}

export interface RenderPngOptions {
  /** ความละเอียด (1 = ขนาดตาม CSS px) ค่าเริ่มต้น 1 — ระบบลดลงเองถ้าเอกสารใหญ่เกินเพดาน canvas */
  pixelRatio?: number
  /** สีพื้นรูป (ค่าเริ่มต้นขาว) */
  backgroundColor?: string
  /** false = ปล่อยให้ html-to-image ลดขนาดตัวอักษร 0.1px ตามเดิม (ค่าเริ่มต้น: ขนาดเท่าบนจอเป๊ะ — ดู holdExactFontSize) */
  exactFontSize?: boolean
}

/**
 * วาดกล่อง HTML (ต้องอยู่ในหน้าเว็บและมีขนาดจริง — ซ่อนด้วย display:none ไม่ได้) เป็นไฟล์ PNG
 * รอฟอนต์ + รูปในกล่องก่อน · WebKit วาดอุ่นเครื่องหนึ่งรอบ · พลาด/ได้รูปว่าง → ลองใหม่อีกครั้ง
 * ไม่สำเร็จ → throw Error ข้อความภาษาไทย
 */
export async function renderNodeToPng(node: HTMLElement, opts: RenderPngOptions = {}): Promise<Blob> {
  if (typeof window === 'undefined') throw new Error(MSG_RENDER_FAIL)
  if (!node || !node.isConnected) throw new Error(MSG_RENDER_FAIL)

  let lib: HtmlToImage
  try {
    lib = await loadLib()
  } catch {
    throw new Error('โหลดตัวสร้างรูปไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่')
  }

  await waitForFonts()
  await waitForImages(node)
  await nextFrame()

  const width = node.offsetWidth
  const height = node.offsetHeight
  if (width < 1 || height < 1) throw new Error(MSG_RENDER_FAIL)

  const fontCss = await fontEmbedCss(lib, node)
  const options: RenderOptions = {
    pixelRatio: safePixelRatio(opts.pixelRatio ?? 1, width, height),
    backgroundColor: opts.backgroundColor ?? '#FFFFFF',
    // ขนาดตามกล่องจริง (ไม่ใช่ขนาดที่ย่อแสดงในตัวอย่าง)
    width,
    height,
    // ให้แพ็กเกจลดขนาดเองถ้ายังเกินเพดานด้านยาว
    skipAutoScale: false,
    ...(fontCss ? { fontEmbedCSS: fontCss } : { skipFonts: true }),
  }
  const webkit = isWebKit()

  async function attempt(): Promise<Blob | null> {
    if (webkit) {
      // รอบอุ่นเครื่อง: ให้ WebKit ถอดรหัสรูป/ฟอนต์ใน SVG ไว้ก่อน (ผลทิ้ง) — รอบจริงถัดไปจึงไม่ว่าง
      try {
        const warm = await lib.toCanvas(node, options)
        warm.width = 0
        warm.height = 0
      } catch {
        // รอบอุ่นเครื่องพลาดไม่เป็นไร ไปวาดรอบจริงต่อ
      }
    }
    return lib.toBlob(node, options)
  }

  for (let i = 0; i < 2; i++) {
    const release = opts.exactFontSize === false ? () => {} : holdExactFontSize(node)
    try {
      const blob = await attempt()
      if (blob && blob.size >= MIN_REAL_PNG_BYTES) return blob
      // ได้ไฟล์ว่าง/เล็กผิดปกติ: รอบแรก → ลองใหม่ · รอบสอง → ใช้ที่ได้ถ้ามี (เอกสารสั้นมากอาจเล็กจริง)
      if (i === 1 && blob && blob.size > 0) return blob
    } catch {
      if (i === 1) break
    } finally {
      release()
    }
    await delay(250)
  }
  throw new Error(MSG_RENDER_FAIL)
}

// ---------------------------------------------------------------------------
// แชร์ / บันทึก / คัดลอก
// ---------------------------------------------------------------------------
/** ชื่อไฟล์ที่ปลอดภัยทุกเครื่อง (ตัวอักษรละติน/ตัวเลข/ขีด) + นามสกุล .png */
export function safeFileName(base: string, ext = 'png'): string {
  const clean = String(base ?? '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80)
  return `${clean || 'document'}.${ext}`
}

/** แชร์ไฟล์ผ่านแผ่นแชร์ของเครื่องได้ไหม (มือถือส่วนใหญ่ = ได้ ; เดสก์ท็อป/เบราว์เซอร์ในแอปบางตัว = ไม่ได้) */
export function canShareFiles(): boolean {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
    if (typeof File === 'undefined') return false
    const probe = new File([new Uint8Array([137, 80, 78, 71])], 'probe.png', { type: 'image/png' })
    return navigator.canShare({ files: [probe] })
  } catch {
    return false
  }
}

/** คัดลอก "รูป" ลงคลิปบอร์ดได้ไหม (ต้องเป็น https และมี ClipboardItem) */
export function canCopyImage(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    typeof navigator !== 'undefined' &&
    !!navigator.clipboard &&
    typeof navigator.clipboard.write === 'function' &&
    typeof (window as Window & { ClipboardItem?: unknown }).ClipboardItem === 'function'
  )
}

/** ดาวน์โหลดไฟล์ด้วยลิงก์ชั่วคราว (หน้าเดิม ไม่เปิดแท็บใหม่) — คืน false ถ้าเบราว์เซอร์ไม่ยอม */
export function downloadBlob(blob: Blob, filename: string): boolean {
  try {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    // ปล่อยหน่วยความจำทีหลัง (บางเบราว์เซอร์ยังอ่านไฟล์อยู่ครู่หนึ่งหลังคลิก)
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    return true
  } catch {
    return false
  }
}

/** Blob → data URL (ใช้แสดงรูปผลลัพธ์ให้กดค้างบันทึกในแอป LINE — ลิงก์ blob: บันทึกจากเมนูกดค้างไม่ได้ในบางเครื่อง) */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('read')))
    reader.onerror = () => reject(reader.error ?? new Error('read'))
    reader.readAsDataURL(blob)
  })
}

/**
 * โหลดรูปจากลิงก์ (เช่น โลโก้ร้านในถัง wedding-public) มาเป็น data URL ก่อนใส่ในเอกสาร
 * → รูปไม่หายตอนแปลงเป็น PNG และ canvas ไม่ติดข้อจำกัดข้ามโดเมน · โหลดไม่ได้ / ไม่ใช่รูป / ใหญ่เกิน → null
 */
export async function imageUrlToDataUrl(url: string | null | undefined, maxBytes = 3 * 1024 * 1024): Promise<string | null> {
  const src = String(url ?? '').trim()
  if (!src) return null
  if (src.startsWith('data:image/')) return src
  try {
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), 15000)
    let res: Response
    try {
      res = await fetch(src, { mode: 'cors', credentials: 'omit', cache: 'force-cache', signal: ctrl.signal })
    } finally {
      window.clearTimeout(timer)
    }
    if (!res.ok) return null
    const blob = await res.blob()
    if (!blob.type.startsWith('image/') || blob.size === 0 || blob.size > maxBytes) return null
    return await blobToDataUrl(blob)
  } catch {
    return null
  }
}

/**
 * ผลของ shareOrDownload
 *   shared     = ส่งเข้าแผ่นแชร์ของเครื่องแล้ว (ผู้ใช้เลือกแอปต่อเอง เช่น LINE)
 *   cancelled  = ผู้ใช้ปิดแผ่นแชร์เอง (ไม่ใช่ข้อผิดพลาด)
 *   blocked    = เบราว์เซอร์ไม่ยอมเปิดแผ่นแชร์ (เลยเวลาที่นับว่าเป็นการกดของผู้ใช้ — มักเกิดเมื่อสร้างรูปนาน)
 *                ได้ค่านี้เฉพาะเมื่อส่ง { fallbackDownload: false } — ให้ผู้ใช้กดแชร์อีกครั้ง (รูปพร้อมแล้ว รอบนี้เปิดได้ทันที)
 *   downloaded = สั่งดาวน์โหลดไฟล์แล้ว (เบราว์เซอร์ในแอปบางตัวไม่บันทึกจริง → ผู้เรียกควรแสดงรูปให้กดค้างบันทึกด้วย)
 *   failed     = ทำไม่ได้ทั้งสองทาง
 */
export type ShareResult = 'shared' | 'cancelled' | 'blocked' | 'downloaded' | 'failed'

/**
 * แชร์รูปผ่านแผ่นแชร์ของเครื่อง (มือถือ → เลือก LINE ได้) ; แชร์ไฟล์ไม่ได้ → ดาวน์โหลดไฟล์แทน
 * ต้องเรียกจากการกดปุ่มของผู้ใช้โดยตรง (เบราว์เซอร์ไม่ให้เปิดแผ่นแชร์เองถ้ารอนานเกิน — ให้สร้างรูปเตรียมไว้ก่อน)
 * text: ข้อความแนบ (ไม่บังคับ) — แอปแชทบางตัวรับข้อความแล้วทิ้งรูป จึงควรส่งรูปอย่างเดียว
 * opts.fallbackDownload = false: เครื่องแชร์ได้แต่เบราว์เซอร์ไม่ยอมรอบนี้ → คืน 'blocked' (ไม่ดาวน์โหลดแทน)
 */
export async function shareOrDownload(
  blob: Blob,
  filename: string,
  text?: string,
  opts: { fallbackDownload?: boolean } = {},
): Promise<ShareResult> {
  const name = /\.png$/i.test(filename) ? filename : safeFileName(filename)
  if (canShareFiles()) {
    try {
      const file = new File([blob], name, { type: blob.type || 'image/png' })
      const data: ShareData = text ? { files: [file], text } : { files: [file] }
      if (!navigator.canShare || navigator.canShare(data)) {
        await navigator.share(data)
        return 'shared'
      }
    } catch (err) {
      const errName = err && typeof err === 'object' && 'name' in err ? String((err as { name?: unknown }).name) : ''
      // ผู้ใช้กดปิดแผ่นแชร์เอง
      if (errName === 'AbortError') return 'cancelled'
      // NotAllowedError = เลยเวลาที่เบราว์เซอร์นับว่าเป็นการกดของผู้ใช้
      if (errName === 'NotAllowedError' && opts.fallbackDownload === false) return 'blocked'
      // อื่นๆ (แชร์ไม่ได้จริง) → ดาวน์โหลดแทน
    }
  }
  return downloadBlob(blob, name) ? 'downloaded' : 'failed'
}

/** ผลของ copyImage: copied = อยู่ในคลิปบอร์ดแล้ว (วางในแชทได้) · unsupported = เบราว์เซอร์นี้คัดลอกรูปไม่ได้ · failed = ไม่ได้รับอนุญาต/ผิดพลาด */
export type CopyImageResult = 'copied' | 'unsupported' | 'failed'

/**
 * คัดลอกรูป PNG ลงคลิปบอร์ด — ต้องเรียกจากการกดปุ่มของผู้ใช้
 * รับ Promise<Blob> ได้ (Safari ต้องสร้าง ClipboardItem ทันทีตอนกด แล้วค่อยใส่รูปทีหลัง)
 */
export async function copyImage(blob: Blob | Promise<Blob>): Promise<CopyImageResult> {
  if (!canCopyImage()) return 'unsupported'
  const Item = (window as Window & { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
  if (!Item) return 'unsupported'
  try {
    const png: Promise<Blob> = Promise.resolve(blob).then(b => (b.type === 'image/png' ? b : new Blob([b], { type: 'image/png' })))
    let item: ClipboardItem
    try {
      // Safari / Chrome รุ่นใหม่รับ Promise ได้ (ต้องสร้างทันทีตอนกด)
      item = new Item({ 'image/png': png })
    } catch {
      item = new Item({ 'image/png': await png })
    }
    await navigator.clipboard.write([item])
    return 'copied'
  } catch {
    return 'failed'
  }
}
