// ===== โลโก้ร้าน b.oncloud: ย่อรูป → อัปโหลดเข้าถัง wedding-public ('logo/<uuid>.<ext>') → ลบไฟล์เก่า =====
// ใช้ฝั่งเบราว์เซอร์เท่านั้น (canvas) · ถังรับรูปไม่เกิน 2 MB และอัปโหลด/ลบได้เฉพาะผู้จัดการ (นโยบายใน supabase-fix-07-wedding.sql)
// ต่างจากรูปสินค้า (lib/products compressImage) ตรงที่ "เก็บพื้นโปร่งใส" ไว้: โลโก้ไปวางบนหัวเอกสาร/หน้าลิงก์ลูกค้าที่พื้นไม่ใช่สีขาวล้วน
//   ขอบยาวสุด 800px (หัวเอกสารกว้าง 1080px ใช้โลโก้ไม่เกิน ~200px — 800 คมพอแม้พิมพ์ A4)
//   WebP 0.9 (เก็บพื้นโปร่งใส) → Safari/iOS ทำ WebP ไม่ได้ = PNG → ยังเกิน 2 MB = JPEG พื้นขาว → ยังเกิน = ย่อขอบลงอีก
import { isNetworkError, newUuid, storageThaiError, type BrowserSupabase } from '@/lib/products'
import { WED_LOGO_MAX_BYTES, WEDDING_PUBLIC_BUCKET } from '@/lib/wedding'

export const LOGO_MAX_EDGE = 800
const MAX_SOURCE_BYTES = 25 * 1024 * 1024
const MSG_DECODE = 'เปิดไฟล์รูปนี้ไม่ได้ — ลองเลือกรูปอื่น (รองรับ JPG, PNG, WEBP)'
const MSG_ENCODE = 'ย่อรูปไม่สำเร็จ (หน่วยความจำเครื่องอาจไม่พอ) — ลองใหม่หรือเลือกรูปที่เล็กลง'

export interface LogoImage {
  blob: Blob
  width: number
  height: number
  contentType: string
  ext: 'webp' | 'png' | 'jpg'
}

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

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error(MSG_ENCODE))), type, quality)
    } catch {
      reject(new Error(MSG_ENCODE))
    }
  })
}

function extOf(type: string): LogoImage['ext'] | null {
  if (type === 'image/webp') return 'webp'
  if (type === 'image/png') return 'png'
  if (type === 'image/jpeg') return 'jpg'
  return null
}

/** ย่อรูปโลโก้ที่เลือก (เรียกได้เฉพาะในเบราว์เซอร์) — ไม่ใช่รูป/เปิดไม่ได้/ใหญ่เกิน → throw Error ข้อความไทย */
export async function prepareLogo(file: Blob): Promise<LogoImage> {
  if (file.type && !file.type.startsWith('image/')) throw new Error('ไฟล์นี้ไม่ใช่รูปภาพ')
  if (file.size > MAX_SOURCE_BYTES) throw new Error('ไฟล์รูปใหญ่เกินไป (เกิน 25 MB) — ลองเลือกรูปที่เล็กลง')
  const img = await loadImage(file)
  const srcW = img.naturalWidth
  const srcH = img.naturalHeight
  if (!srcW || !srcH) throw new Error(MSG_DECODE)

  let edge = Math.min(LOGO_MAX_EDGE, Math.max(srcW, srcH))
  for (let attempt = 0; attempt < 4; attempt++) {
    const scale = edge / Math.max(srcW, srcH)
    const w = Math.max(1, Math.round(srcW * scale))
    const h = Math.max(1, Math.round(srcH * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error(MSG_ENCODE)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    try {
      // 1) WebP (เก็บพื้นโปร่งใส) — Safari คืน PNG มาเงียบๆ แทน ก็ใช้ PNG นั้นได้เลย
      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      const first = await toBlob(canvas, 'image/webp', 0.9)
      const firstExt = extOf(first.type)
      if (firstExt && first.size <= WED_LOGO_MAX_BYTES) return { blob: first, width: w, height: h, contentType: first.type, ext: firstExt }
      // 2) JPEG พื้นขาว (เล็กกว่าเสมอ แต่เสียพื้นโปร่งใส)
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      const jpg = await toBlob(canvas, 'image/jpeg', 0.86)
      if (jpg.type === 'image/jpeg' && jpg.size <= WED_LOGO_MAX_BYTES) return { blob: jpg, width: w, height: h, contentType: 'image/jpeg', ext: 'jpg' }
    } finally {
      // คืนหน่วยความจำ canvas ทันที (iPhone/iPad มีเพดานรวมของ canvas)
      canvas.width = 0
      canvas.height = 0
    }
    edge = Math.max(64, Math.round(edge * 0.75))
  }
  throw new Error('รูปโลโก้ใหญ่เกิน 2 MB — ลองเลือกรูปที่เล็กลง')
}

function logoStorageError(err: unknown): string {
  return storageThaiError(err)
    .replace('รูปใหญ่เกิน 5 MB', 'รูปใหญ่เกิน 2 MB')
    .replace('ไม่มีสิทธิ์อัปโหลดรูปสินค้า', 'ไม่มีสิทธิ์อัปโหลดโลโก้ (เฉพาะผู้จัดการร้าน)')
    .replace('อัปโหลดรูปไม่สำเร็จ', 'อัปโหลดโลโก้ไม่สำเร็จ')
}

function isDuplicate(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { statusCode?: unknown; status?: unknown; message?: unknown }
  const status = Number(e.statusCode ?? e.status)
  return status === 409 || /already exists|duplicate/i.test(typeof e.message === 'string' ? e.message : '')
}

/** อัปโหลดโลโก้ (ชื่อใหม่ทุกครั้ง ห้ามทับ — ไฟล์เดิมยังอยู่จนกว่าตั้งค่าจะชี้ไฟล์ใหม่สำเร็จ) → path 'logo/<uuid>.<ext>' */
export async function uploadLogoFile(supabase: BrowserSupabase, img: LogoImage): Promise<string> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const path = `logo/${newUuid()}.${img.ext}`
    let error: unknown = null
    try {
      const res = await supabase.storage.from(WEDDING_PUBLIC_BUCKET).upload(path, img.blob, {
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
    if (!isDuplicate(error)) break
  }
  throw new Error(isNetworkError(lastErr) ? 'อัปโหลดโลโก้ไม่สำเร็จ (อินเทอร์เน็ตขัดข้อง) — ลองใหม่อีกครั้ง' : logoStorageError(lastErr))
}

/** ลบไฟล์โลโก้ที่ไม่ใช้แล้ว (ทำหลังบันทึกตั้งค่าสำเร็จเท่านั้น) — ไม่สำเร็จก็แค่เหลือไฟล์ค้าง ไม่ขวางการทำงาน */
export async function removeLogoFiles(supabase: BrowserSupabase, paths: (string | null | undefined)[]): Promise<void> {
  const clean = paths.filter((p): p is string => typeof p === 'string' && /^logo\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(p))
  if (clean.length === 0) return
  try {
    await supabase.storage.from(WEDDING_PUBLIC_BUCKET).remove(clean)
  } catch {
    /* ไฟล์ค้างไม่มีผลเสีย */
  }
}
