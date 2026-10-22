'use client'
import { useEffect, useLayoutEffect } from 'react'
import { usePathname } from 'next/navigation'
import { shopThemeForPath, type ShopTheme } from '@/lib/shopTheme'

// ตั้ง <html data-shop> ตามร้านของ layout ที่กำลังแสดง — ใช้ตอนเปลี่ยนหน้าในแอป (soft navigation)
// เช่น /select (NEWCUTE โรสโกลด์) → /rental (ร้านเช่า ฟ้าใส ธีม #18 ที่บอสเลือก 22/10/2569)
// โหลดหน้าเต็ม/F5 ตั้งไว้แล้วตั้งแต่ <head> (SHOP_THEME_BOOT_SCRIPT ใน lib/shopTheme.ts) → ตัวนี้แค่ยืนยันซ้ำ
// useLayoutEffect = ตั้งก่อนเบราว์เซอร์วาดหน้าใหม่ (ไม่เห็นสีร้านเดิมแวบหนึ่ง) · ฝั่งเซิร์ฟเวอร์ใช้ useEffect แทน (กันคำเตือน)
// ไม่ล้างค่าตอนถอด: layout ของหน้าถัดไปตั้งค่าของมันเอง (ล้างแล้วจะกระพริบเป็นค่าเริ่มต้นระหว่างเปลี่ยนหน้า)
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export default function ShopThemeSync({ shop }: { shop: ShopTheme }) {
  useIsoLayoutEffect(() => {
    const root = document.documentElement
    if (root.getAttribute('data-shop') !== shop) root.setAttribute('data-shop', shop)
  }, [shop])
  return null
}

// หน้าที่ไม่อยู่ใต้ layout ของร้านใดร้านหนึ่ง (หน้า 404 ราก app/not-found.tsx) — ธีมตามที่อยู่เว็บ กติกาเดียวกับสคริปต์ใน <head>
// โหลดหน้าเต็ม /rental/พิมพ์ผิด = ฟ้าใส, /foo = โรสโกลด์ · เปลี่ยนหน้าในแอปจากหน้าร้านเช่าไป /foo ก็กลับเป็นโรสโกลด์ (ไม่ค้างสีร้านเดิม)
export function PathShopThemeSync() {
  return <ShopThemeSync shop={shopThemeForPath(usePathname())} />
}
