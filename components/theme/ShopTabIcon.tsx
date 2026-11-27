'use client'
import { useEffect } from 'react'

// ไอคอนแท็บเบราว์เซอร์ = โลโก้ร้าน b.oncloud ขณะอยู่ในหน้าของร้านนี้ (หลังร้าน /wedding/** และหน้าติดตามงาน /wedding-status/<token>)
// ทำไมต้องมีตัวนี้: Next.js ใส่ /favicon.ico ของแอป (app/favicon.ico) เสมอ และ Chrome เลือกไฟล์ .ico ที่มีรูป 16x16 พอดี
//   ก่อนรูปโลโก้ (ขนาดไม่พอดี) → แท็บยังเป็นไอคอน NEWCUTE ทั้งที่ <head> มีลิงก์โลโก้แล้ว
// วิธี: ระหว่างอยู่ในหน้าร้านนี้ ปิดลิงก์ไอคอนอื่นของแอปชั่วคราว (เปลี่ยน rel — ไม่ลบโหนดที่ React ดูแล) แล้วคืนค่าเดิมตอนออกจากหน้าร้าน
//   ไม่มีลิงก์โลโก้ใน <head> → เพิ่มลิงก์ของตัวเอง แล้วเอาออกตอนออก
//   เฝ้า <head> ตลอด (MutationObserver): Next.js ใส่แท็กไอคอนของหน้าใหม่ซ้ำได้หลังเปลี่ยนหน้าในร้าน (บางครั้งหลัง effect นี้ทำงานไปแล้ว
//   → /favicon.ico กลับมาเป็น icon แท็บเป็น NEWCUTE) → ปิดลิงก์ที่เพิ่มมาใหม่ทันทีก่อนเบราว์เซอร์วาด
//   โลโก้โหลดไม่ได้ (ไฟล์ถูกลบ/ลิงก์เสีย) → กลับด้าน: ปิดลิงก์โลโก้ เปิดไอคอนแอปคืน (แท็บเป็นไอคอนแอป ไม่ใช่ไอคอนว่างของเบราว์เซอร์)
// ไม่ส่งลิงก์ (ร้านยังไม่มีโลโก้) = ไม่ทำอะไร (ไอคอนแอปเดิม)
const OFF_REL = 'x-shop-icon-off'

function isIconLink(link: HTMLLinkElement): boolean {
  const rel = link.rel.trim().toLowerCase()
  return rel === 'icon' || rel === 'shortcut icon'
}

export default function ShopTabIcon({ href }: { href: string }) {
  useEffect(() => {
    if (!href || typeof document === 'undefined') return
    let ours: string
    try {
      ours = new URL(href, window.location.href).href
    } catch {
      return
    }
    const head = document.head
    // ลิงก์ที่เราปิด → rel เดิม (คืนค่าตอนออก/ตอนโลโก้เสีย)
    const disabled = new Map<HTMLLinkElement, string>()
    let added: HTMLLinkElement | null = null
    let broken = false

    const turnOff = (link: HTMLLinkElement) => {
      if (!disabled.has(link)) disabled.set(link, link.rel)
      link.rel = OFF_REL
    }
    // ทำซ้ำได้ไม่เปลี่ยนผล (เรียกจาก observer ทุกครั้งที่ <head> เปลี่ยน รวมถึงการเปลี่ยนของเราเอง — รอบสองไม่มีอะไรให้แก้ จึงไม่วนไม่จบ)
    const apply = () => {
      if (broken) {
        // โลโก้เสีย: เปิดไอคอนแอปที่เราปิดไว้คืน + ปิดลิงก์โลโก้ (ของ metadata) + เอาลิงก์ของเราออก
        disabled.forEach((rel, link) => {
          if (link.href !== ours && link.rel === OFF_REL) {
            link.rel = rel
            disabled.delete(link)
          }
        })
        if (added) {
          added.remove()
          added = null
        }
        head.querySelectorAll<HTMLLinkElement>('link').forEach(link => {
          if (isIconLink(link) && link.href === ours) turnOff(link)
        })
        return
      }
      let hasOurs = false
      head.querySelectorAll<HTMLLinkElement>('link').forEach(link => {
        if (!isIconLink(link)) return
        if (link.href === ours) hasOurs = true
        else turnOff(link)
      })
      if (!hasOurs) {
        added?.remove()
        added = document.createElement('link')
        added.rel = 'icon'
        added.href = ours
        head.appendChild(added)
      }
    }

    apply()
    const observer = new MutationObserver(apply)
    observer.observe(head, { childList: true, subtree: true, attributes: true, attributeFilter: ['rel', 'href'] })

    // ตรวจว่าโลโก้โหลดได้จริง (ลิงก์เสีย = ใช้ไอคอนแอปตามเดิม)
    const probe = new Image()
    probe.onerror = () => {
      broken = true
      apply()
    }
    probe.src = ours

    return () => {
      probe.onerror = null
      observer.disconnect()
      disabled.forEach((rel, link) => {
        if (link.rel === OFF_REL) link.rel = rel
      })
      disabled.clear()
      added?.remove()
    }
  }, [href])

  return null
}
