// ===== หน้าจองออนไลน์: โหลดข้อมูลฝั่งเซิร์ฟเวอร์ (ใช้ใน server component เท่านั้น) =====
// ห่อด้วย cache() ของ React → ในคำขอเดียวกัน layout / generateMetadata / page เรียกซ้ำได้ แต่ยิงฐานข้อมูลครั้งเดียว
// (ข้ามคำขอไม่แชร์ — ข้อมูลร้าน/วันว่าง/สถานะการจองต้องสดทุกครั้งที่เปิดหน้า)
import { cache } from 'react'
import {
  createPublicClient, fetchCatalog, fetchPublicBooking, fetchPublicInfo, fetchPublicItem, type CatalogQuery,
} from '@/components/book/api'

export const getPublicInfo = cache(() => fetchPublicInfo(createPublicClientSafe()))

export const getPublicItem = cache((code: string) => fetchPublicItem(code, createPublicClientSafe()))

export const getPublicBooking = cache((token: string) => fetchPublicBooking(token, createPublicClientSafe()))

export function getCatalog(q: CatalogQuery) {
  return fetchCatalog(q, createPublicClientSafe())
}

// env ยังไม่ได้ตั้ง → createClient throw → ส่ง undefined ให้ฟังก์ชันด้านใน (มันสร้างเองแล้วจับ error ให้ = ได้ ok:false)
function createPublicClientSafe() {
  try {
    return createPublicClient()
  } catch {
    return undefined
  }
}
