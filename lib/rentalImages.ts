// ===== รูปชุดเช่า: ย่อรูป → อัปโหลดขึ้นถัง rental-images → ลงทะเบียนกับชุด (rpc rental_add_item_image) =====
// ใช้ฝั่งเบราว์เซอร์เท่านั้น (ย่อรูปด้วย canvas) — ใช้วิธีเดียวกับรูปสินค้า NEWCUTE (lib/products.ts compressImage):
// ขอบยาวสุด 1600px, WebP 0.8 (Safari/iOS ทำ WebP ไม่ได้ → JPEG 0.82), ไม่เกิน 5 MB
// ถัง rental-images เป็น public read; อัปโหลด/ลบได้เฉพาะผู้จัดการร้านเช่า (rental_manager) — นโยบายอยู่ใน supabase-fix-05-rental.sql
//
// ใช้: const img = await uploadRentalItemImage(supabase, itemId, file)   ← ย่อ + อัปโหลด + ลงทะเบียน (คืนรูปที่บันทึกแล้ว)
//      const paths = await deleteRentalItemImage(supabase, imageId)    ← ลบแถวรูป แล้วลบไฟล์ในถัง

import { thaiError } from '@/lib/format'
import {
  compressImage, isNetworkError, newUuid, storageThaiError, wait,
  type BrowserSupabase, type CompressedImage,
} from '@/lib/products'
import { RENTAL_IMAGE_BUCKET, parseDeletedImagePaths, parseRentalItem, parseRentalItemImage, type RentalItemImage } from '@/lib/rental'

export type { CompressedImage } from '@/lib/products'

// ข้อความของรูปสินค้า → ข้อความของรูปชุด
function rentalStorageError(err: unknown): string {
  return storageThaiError(err).replace('รูปสินค้า', 'รูปชุด')
}

function isStorageDuplicate(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { statusCode?: unknown; status?: unknown; message?: unknown }
  const status = Number(e.statusCode ?? e.status)
  const message = typeof e.message === 'string' ? e.message : ''
  return status === 409 || /already exists|duplicate/i.test(message)
}

/** ย่อรูปที่ผู้ใช้เลือก (เรียกได้เฉพาะในเบราว์เซอร์) — ไม่ใช่รูป/เปิดไม่ได้/ใหญ่เกิน → throw Error ข้อความไทย */
export function prepareRentalImage(file: Blob): Promise<CompressedImage> {
  return compressImage(file)
}

/** อัปโหลดไฟล์ขึ้นถัง rental-images (ชื่อใหม่ทุกครั้ง ห้ามทับ) → คืน path '<item_id>/<uuid>.<ext>' */
export async function uploadRentalImageFile(supabase: BrowserSupabase, itemId: string, img: CompressedImage): Promise<string> {
  const id = itemId.toLowerCase()
  let lastErr: unknown = null
  // ชื่อไฟล์ชนกัน (409) → สุ่มชื่อใหม่แล้วลองอีกครั้งเดียว
  for (let attempt = 0; attempt < 2; attempt++) {
    const path = `${id}/${newUuid()}.${img.ext}`
    let error: unknown = null
    try {
      const res = await supabase.storage.from(RENTAL_IMAGE_BUCKET).upload(path, img.blob, {
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
    if (!isStorageDuplicate(error)) break
  }
  throw new Error(rentalStorageError(lastErr))
}

/** ลบไฟล์ในถัง rental-images (ทำหลัง RPC สำเร็จเท่านั้น) — ไม่สำเร็จก็แค่เหลือไฟล์ค้าง ไม่ขวางการทำงาน */
export async function removeRentalImageFiles(supabase: BrowserSupabase, paths: string[]): Promise<void> {
  const clean = paths.filter(p => typeof p === 'string' && p !== '')
  for (let i = 0; i < clean.length; i += 1000) {
    try {
      await supabase.storage.from(RENTAL_IMAGE_BUCKET).remove(clean.slice(i, i + 1000))
    } catch {
      /* ไฟล์ค้างไม่มีผลเสีย */
    }
  }
}

// ผลของ rental_add_item_image อาจเป็นรูปเดี่ยว หรือข้อมูลชุดทั้งก้อน (rental_item_json) — หาแถวของ path นี้
function pickAddedImage(data: unknown, path: string, img: CompressedImage): RentalItemImage {
  const item = parseRentalItem(data)
  if (item) {
    const found = item.images.find(i => i.path === path)
    if (found) return found
  }
  const single = parseRentalItemImage(data)
  if (single) return single
  // ฐานข้อมูลตอบสำเร็จแต่รูปร่างไม่คุ้น → ใช้ข้อมูลที่รู้อยู่แล้ว (id ว่าง = โหลดหน้าใหม่จะได้ id จริง)
  return { id: '', path, sort_order: 0, width: img.width, height: img.height }
}

/** ลงทะเบียนรูปที่อัปโหลดแล้วกับชุด (ส่ง path เดิมซ้ำได้ปลอดภัย) — ไม่สำเร็จเพราะเหตุอื่นที่ไม่ใช่เน็ต = ลบไฟล์ทิ้ง */
export async function registerRentalImage(
  supabase: BrowserSupabase,
  itemId: string,
  path: string,
  img: CompressedImage,
): Promise<RentalItemImage> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await wait(attempt * 1000)
    const { data, error } = await supabase.rpc('rental_add_item_image', {
      p_item_id: itemId.toLowerCase(),
      p_path: path,
      p_width: img.width,
      p_height: img.height,
    })
    if (!error) return pickAddedImage(data, path, img)
    lastErr = error
    if (!isNetworkError(error)) break
  }
  // เน็ตหลุด = อาจบันทึกไปแล้ว → ไม่ลบไฟล์ / เหตุอื่น = ไม่ได้บันทึกแน่นอน → ลบไฟล์ทิ้ง
  if (!isNetworkError(lastErr)) void removeRentalImageFiles(supabase, [path])
  throw new Error(thaiError(lastErr))
}

/** ย่อ + อัปโหลด + ลงทะเบียนรูป 1 ไฟล์ — throw Error ข้อความไทยเมื่อไม่สำเร็จ */
export async function uploadRentalItemImage(supabase: BrowserSupabase, itemId: string, file: Blob): Promise<RentalItemImage> {
  const img = await prepareRentalImage(file)
  const path = await uploadRentalImageFile(supabase, itemId, img)
  return registerRentalImage(supabase, itemId, path, img)
}

/** ลบรูปออกจากชุด (rpc rental_delete_item_image) แล้วลบไฟล์ในถัง → คืน path ที่ลบ ; throw Error ข้อความไทยเมื่อ RPC ไม่สำเร็จ */
export async function deleteRentalItemImage(supabase: BrowserSupabase, imageId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('rental_delete_item_image', { p_image_id: imageId })
  if (error) throw new Error(thaiError(error))
  const paths = parseDeletedImagePaths(data)
  await removeRentalImageFiles(supabase, paths)
  return paths
}
