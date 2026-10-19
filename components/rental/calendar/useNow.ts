'use client'
// เวลาปัจจุบันที่อัปเดตเองทุก intervalMs (นับถอยหลังเวลาถือจองออนไลน์) — หยุดนับตอนแท็บถูกซ่อน กลับมาแล้วอัปเดตทันที
// รอบแรก (render ฝั่งเซิร์ฟเวอร์ + hydrate) คืน null → ยังไม่แสดงเวลาที่เหลือ กันข้อความไม่ตรงกันระหว่างเซิร์ฟเวอร์กับเครื่อง
import { useEffect, useState } from 'react'

export function useNow(intervalMs = 30000): number | null {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (timer === null) timer = setInterval(() => setNow(Date.now()), Math.max(1000, intervalMs))
    }
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now())
        start()
      } else {
        stop()
      }
    }
    start()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs])
  return now
}

/**
 * ข้อความเวลาที่เหลือก่อนหมดเวลาถือจอง: 'เหลือ 5 ชม. 12 นาที' / 'เหลือ 1 วัน 3 ชม.' / 'หมดเวลาแล้ว'
 * tone: 'ok' > 3 ชม. · 'warn' ≤ 3 ชม. · 'over' หมดแล้ว · null = ไม่มีเวลาหมดอายุ/อ่านไม่ได้
 */
export function holdRemaining(expiresAt: string | null | undefined, now: number | null): { text: string; tone: 'ok' | 'warn' | 'over' } | null {
  if (!expiresAt || now === null) return null
  const t = new Date(expiresAt).getTime()
  if (!Number.isFinite(t)) return null
  const ms = t - now
  if (ms <= 0) return { text: 'หมดเวลาถือจองแล้ว', tone: 'over' }
  const totalMin = Math.max(1, Math.floor(ms / 60000))
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins = totalMin % 60
  let text: string
  if (days > 0) text = hours > 0 ? `${days} วัน ${hours} ชม.` : `${days} วัน`
  else if (hours > 0) text = mins > 0 ? `${hours} ชม. ${mins} นาที` : `${hours} ชม.`
  else text = `${mins} นาที`
  return { text: `เหลือเวลาถือจอง ${text}`, tone: totalMin <= 180 ? 'warn' : 'ok' }
}
