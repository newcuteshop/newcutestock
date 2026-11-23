// ===== หน้าติดตามงานของคู่บ่าวสาว: โหลดข้อมูลฝั่งเซิร์ฟเวอร์ (server component เท่านั้น) =====
// ห่อด้วย cache() ของ React → generateMetadata กับ page ในคำขอเดียวกันยิงฐานข้อมูลครั้งเดียว (ข้ามคำขอไม่แชร์ — ข้อมูลต้องสด)
import { cache } from 'react'
import { createPortalClient, fetchWeddingPortal } from '@/components/wedding/portal/api'

export const getWeddingPortal = cache((token: string) => fetchWeddingPortal(token, createPortalClientSafe()))

// env ยังไม่ได้ตั้ง → createClient throw → ส่ง null ให้ fetchWeddingPortal (มันสร้างเองแล้วจับ error = ได้ ok:false)
function createPortalClientSafe() {
  try {
    return createPortalClient()
  } catch {
    return null
  }
}
