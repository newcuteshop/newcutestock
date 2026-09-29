'use client'
import { useEffect } from 'react'
import { signOutAction } from '@/lib/auth/sign-out-action'
import { hasEnteredThisWindow, lockEntryGate, unlockEntryGate } from '@/lib/auth/entry-gate'

// ประตูเข้าระบบของหน้าในระบบ (วางใน app/(dashboard)/layout.tsx — อยู่ใน layout จึงไม่ mount ใหม่ตอนเปลี่ยนหน้าในแอป)
// - หน้าต่างนี้เข้าสู่ระบบเองแล้ว (มีธงใน sessionStorage) → เปิดหน้าจอ ใช้งานต่อได้ (รวมถึงกด F5)
// - หน้าต่างใหม่ / แท็บใหม่ / เปิดแอปใหม่ → หน้าจอถูกล็อกไว้ตั้งแต่ก่อนวาด (สคริปต์ใน <head>) แล้วที่นี่
//   เพิกถอน session เดิม (ไม่ใช่แค่ซ่อน) และพาไปหน้าเข้าสู่ระบบ
// ดูภาพรวมที่ lib/auth/entry-gate.ts

// รอออกจากระบบไม่เกินเท่านี้ (เน็ตช้า/หลุด) แล้วไปหน้าเข้าสู่ระบบเลย — หน้านั้นออกจากระบบซ้ำให้อีกรอบ
const SIGN_OUT_WAIT_MS = 5000

function leaveToLogin() {
  lockEntryGate()
  let left = false
  const go = () => {
    if (left) return
    left = true
    // replace = ไม่ทิ้งหน้านี้ไว้ในประวัติให้กด Back กลับมา
    window.location.replace('/login')
  }
  const timer = window.setTimeout(go, SIGN_OUT_WAIT_MS)
  signOutAction()
    .catch(() => undefined)
    .finally(() => {
      window.clearTimeout(timer)
      go()
    })
}

function checkEntry() {
  if (hasEnteredThisWindow()) unlockEntryGate()
  else leaveToLogin()
}

export default function EntryGate() {
  useEffect(() => {
    checkEntry()

    // กลับมาจาก back/forward cache (หน้าเดิมในหน่วยความจำ ไม่ได้โหลดใหม่ เช่น กด Back หลังออกจากระบบ) → ตรวจซ้ำ
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) checkEntry()
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  return null
}
