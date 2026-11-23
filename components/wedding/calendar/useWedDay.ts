'use client'
// โหลดรายละเอียดวันเดียว (wed_day) ของวันที่เลือกในปฏิทิน — ใช้ร่วมกันระหว่างแผงขวา (จอกว้าง) และชีตล่าง (มือถือ/แท็บเล็ต)
// - จำผลของวันที่เคยเปิดแล้ว (กลับไปวันเดิมไม่ต้องรอ) · ข้อมูลเก่ากว่า 1 นาที → แสดงของเดิมก่อนแล้วโหลดใหม่เงียบๆ
// - คำขอที่ช้ากว่าคำขอล่าสุดไม่เขียนทับ (กดเปลี่ยนวันเร็วๆ ไม่ได้ข้อมูลผิดวัน)
// - clearAll() = ล้างที่จำไว้ทั้งหมด (ปุ่มโหลดใหม่ของปฏิทิน)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isMigrationMissing } from '@/lib/migration'
import { parseWedDay, type WedDay } from '@/lib/wedding'
import { rpcWithTimeout, wedErrorText } from './rpc'

const FRESH_MS = 60000

export interface WedDayState {
  /** วันที่ของข้อมูลที่แสดง (อาจยังเป็นวันก่อนหน้าระหว่างโหลด — ผู้ใช้เช็ก data.day === day เอง) */
  data: WedDay | null
  loading: boolean
  error: string
  missing: boolean
}

export function useWedDay(day: string | null): WedDayState & { reload(): void; clearAll(): void } {
  const supabase = useMemo(() => createClient(), [])
  const cacheRef = useRef(new Map<string, { data: WedDay; at: number }>())
  const reqRef = useRef(0)
  const [state, setState] = useState<WedDayState>({ data: null, loading: false, error: '', missing: false })

  const fetchDay = useCallback(async (d: string, silent: boolean) => {
    const id = ++reqRef.current
    if (!silent) setState(s => ({ ...s, loading: true, error: '' }))
    const res = await rpcWithTimeout(supabase, 'wed_day', { p_day: d })
    if (id !== reqRef.current) return
    if (res.error) {
      const missing = isMigrationMissing(res.error)
      // โหลดเงียบไม่สำเร็จ → คงข้อมูลเดิมไว้ ไม่ขึ้นกล่องแดง
      setState(s => (silent && !missing ? { ...s, loading: false } : { ...s, loading: false, error: wedErrorText(res.error), missing }))
      return
    }
    const parsed = parseWedDay(res.data)
    const data: WedDay = parsed.day ? parsed : { ...parsed, day: d }
    cacheRef.current.set(d, { data, at: Date.now() })
    setState({ data, loading: false, error: '', missing: false })
  }, [supabase])

  useEffect(() => {
    if (!day) return
    const hit = cacheRef.current.get(day)
    if (hit) {
      reqRef.current++ // คำขอวันก่อนหน้าที่ค้างอยู่ไม่ต้องเขียนทับ
      setState({ data: hit.data, loading: false, error: '', missing: false })
      if (Date.now() - hit.at > FRESH_MS) void fetchDay(day, true)
      return
    }
    void fetchDay(day, false)
  }, [day, fetchDay])

  const reload = useCallback(() => {
    if (!day) return
    cacheRef.current.delete(day)
    void fetchDay(day, false)
  }, [day, fetchDay])

  const clearAll = useCallback(() => {
    cacheRef.current.clear()
  }, [])

  return { ...state, reload, clearAll }
}
