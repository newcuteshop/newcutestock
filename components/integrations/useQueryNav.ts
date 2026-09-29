'use client'
// เปลี่ยนตัวกรอง/ค้นหาผ่าน URL (?tab=&filter=&q=) ให้หน้าเซิร์ฟเวอร์โหลดข้อมูลชุดใหม่ — กดย้อนกลับได้ แชร์ลิงก์ได้
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'

export function buildHref(basePath: string, params: Record<string, string | null | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') sp.set(k, v)
  }
  const qs = sp.toString()
  return qs ? `${basePath}?${qs}` : basePath
}

export function useQueryNav(basePath: string, current: Record<string, string | null | undefined>) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  function go(patch: Record<string, string | null | undefined>) {
    const href = buildHref(basePath, { ...current, ...patch })
    startTransition(() => router.push(href, { scroll: false }))
  }
  return { go, pending }
}
