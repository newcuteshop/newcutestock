// ===== ตัวช่วยเรื่องเงิน (ใช้ร่วมทุกหน้า: ขาย / คืนสินค้า / ปิดยอด / รายงาน) =====
// pure functions ล้วน — ใช้ได้ทั้ง server component, server action และ client
// เงินในฐานข้อมูลเป็น numeric(10,2) → ฝั่ง TS ต้องปัด 2 ตำแหน่งด้วย round2 เสมอก่อนเทียบ/รวม/ส่งต่อ
// (PostgREST ส่ง numeric มาเป็น number แต่บางเส้นทาง/ข้อมูลเก่าอาจเป็นสตริงหรือ null → ผ่าน num ก่อนทุกครั้ง)
import { normalizeScannedCode } from '@/lib/barcode'

/** ตัวเลขที่เชื่อได้: number/สตริงตัวเลขที่จำกัดค่าได้ → ค่านั้น ; อย่างอื่น (null, NaN, Infinity, ข้อความ) → 0 */
export function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const t = v.trim()
    if (!t) return 0
    const n = Number(t)
    return Number.isFinite(n) ? n : 0
  }
  if (typeof v === 'bigint') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/**
 * ปัดเงินเป็น 2 ตำแหน่งแบบเดียวกับ round(x, 2) ของ Postgres (ครึ่งปัดออกจากศูนย์)
 * ใช้สตริงเลขยกกำลังแทน x*100 เพราะเศษฐานสองทำให้ 1.005*100 = 100.49999… แล้วปัดลงผิด
 * ค่าที่ไม่ใช่ตัวเลขจำกัด → 0 ; ไม่คืน -0
 */
export function round2(n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0
  const abs = Math.abs(n)
  let cents = Math.round(Number(abs + 'e2'))
  // ค่าเล็ก/ใหญ่มากที่ String() เป็นรูปยกกำลังอยู่แล้ว (เช่น 1e-7) → ต่อ 'e2' ไม่ได้ ใช้คูณตรงแทน
  if (!Number.isFinite(cents)) cents = Math.round(abs * 100)
  if (cents === 0) return 0
  const out = cents / 100 // จำนวนเต็ม / 100 = ค่าทศนิยมที่ใกล้ที่สุดเสมอ
  return n < 0 ? -out : out
}

/** เทียบเงินว่าเท่ากัน (ต่างกันไม่ถึงครึ่งสตางค์ = เท่ากัน) */
export function sameMoney(a: unknown, b: unknown): boolean {
  return Math.abs(round2(num(a)) - round2(num(b))) < 0.005
}

/**
 * รวมค่าจากรายการ (แต่ละค่าผ่าน num) แล้วปัด 2 ตำแหน่งตอนท้าย — ใช้กับยอดเงิน
 * ใช้กับจำนวนชิ้นได้ด้วย (จำนวนเต็มปัด 2 ตำแหน่งแล้วไม่เปลี่ยน)
 * ตัวอย่าง: sumBy(bills, b => b.net_amount)
 */
export function sumBy<T>(items: readonly T[] | null | undefined, pick: (item: T, index: number) => unknown): number {
  if (!items || items.length === 0) return 0
  let total = 0
  for (let i = 0; i < items.length; i++) total += num(pick(items[i], i))
  return round2(total)
}

// เลขไทย ๐-๙ → 0-9
function thaiDigitsToAscii(s: string): string {
  return s.replace(/[๐-๙]/g, ch => String(ch.charCodeAt(0) - 0x0e50))
}

const THAI_CHAR_RE = /[฀-๿]/
const PLAIN_NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/

/**
 * อ่านจำนวนเงินที่ผู้ใช้พิมพ์ → number (ปัด 2 ตำแหน่ง) ; ช่องว่าง หรืออ่านไม่ได้ → null
 * รับได้: '1,234.50', '฿120', ' 120 ', '120 บาท', '100.-', เลขไทย '๑๒๐',
 *        และตัวอักษรที่ออกมาตอนคีย์บอร์ดค้างภาษาไทย (เช่น 'ๅ/-' = '123') — แปลงกลับตามแป้นเกษมณีแบบเดียวกับช่องสแกนบาร์โค้ด
 * ไม่ได้ตัดค่าติดลบทิ้ง (บางช่องอาจยอมให้ติดลบ) — ช่องเงินรับ/เงินนับต้องตรวจ >= 0 เอง
 * แยก "ว่าง" กับ "พิมพ์ผิด" ได้ด้วย s.trim() === '' (ว่าง) เทียบกับผลเป็น null (พิมพ์ผิด)
 */
export function parseMoneyInput(s: string | null | undefined): number | null {
  if (s === null || s === undefined) return null
  let t = thaiDigitsToAscii(String(s))
  // ตัดสัญลักษณ์/หน่วยเงิน และช่องว่างทุกชนิด (รวม NBSP / zero-width จากการคัดลอก)
  t = t.replace(/฿|บาท/g, '').replace(/[\s ​-‍⁠﻿]+/g, '')
  if (!t) return null
  // ยังมีอักษรไทยเหลือ = พิมพ์ตอนคีย์บอร์ดเป็นภาษาไทย → แปลงกลับเป็นแป้น US ('ๅ' → '1', 'ใ' → '.', 'ม' → ',')
  if (THAI_CHAR_RE.test(t)) t = normalizeScannedCode(t).replace(/\s+/g, '')
  t = t.replace(/,/g, '')
  // '100.-' (แบบเขียนราคาของไทย) = 100
  t = t.replace(/\.-$/, '')
  if (!PLAIN_NUMBER_RE.test(t)) return null
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  return round2(n)
}
