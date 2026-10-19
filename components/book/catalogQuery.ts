// ===== หน้าจองออนไลน์: ตัวกรองแคตตาล็อก กับ query string ของ /book =====
// ?cat=<หมวด>&q=<คำค้น>&from=<วันรับ>&to=<วันคืน>&size=<ไซส์>&acc=1 — ลิงก์ที่แชร์ต่อได้ เปิดแล้วเห็นตัวกรองเดิม
// ใช้ทั้งหน้าเซิร์ฟเวอร์ (อ่านค่าครั้งแรก) และฝั่งเบราว์เซอร์ (อัปเดต URL ตอนเปลี่ยนตัวกรอง) — ค่าที่อ่านไม่ได้ถูกตัดทิ้งเงียบๆ
import { isDayKey } from '@/lib/format'
import type { CatalogQuery } from '@/components/book/api'
import { rangeProblem } from '@/components/book/dates'

export type SearchParamsRecord = Record<string, string | string[] | undefined>

function first(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : ''
  return typeof v === 'string' ? v : ''
}

const MAX_SEARCH = 100

/** อ่านตัวกรองจาก query string — หมวดต้องมีจริง, ช่วงวันต้องผ่านเงื่อนไขจองออนไลน์ (ไม่ผ่าน = ไม่ใช้วัน) */
export function readCatalogQuery(
  sp: SearchParamsRecord,
  opts: { categoryIds: string[]; todayKey: string; leadDays: number; maxDays: number },
): CatalogQuery {
  const cat = first(sp.cat).trim()
  const from = first(sp.from).trim()
  const to = first(sp.to).trim()
  const datesOk = isDayKey(from) && isDayKey(to) && rangeProblem(from, to, opts.todayKey, opts.leadDays, opts.maxDays) === null
  const size = first(sp.size).trim()
  return {
    categoryId: cat && opts.categoryIds.includes(cat) ? cat : null,
    search: first(sp.q).trim().slice(0, MAX_SEARCH),
    pickup: datesOk ? from : null,
    ret: datesOk ? to : null,
    size: size && size.length <= 20 ? size : null,
    accessories: first(sp.acc) === '1',
  }
}

/** query string ของตัวกรอง (ไม่มี '?' นำหน้า ; ไม่มีตัวกรอง = '') */
export function catalogQueryString(q: CatalogQuery): string {
  const p = new URLSearchParams()
  if (q.categoryId) p.set('cat', q.categoryId)
  if (q.search.trim()) p.set('q', q.search.trim())
  if (q.pickup && q.ret) {
    p.set('from', q.pickup)
    p.set('to', q.ret)
  }
  if (q.size) p.set('size', q.size)
  if (q.accessories) p.set('acc', '1')
  return p.toString()
}

/** ลิงก์หน้าชุด พร้อมพกช่วงวันที่เลือกไว้ไปด้วย (หน้าชุดเลือกวันนั้นให้อัตโนมัติ) */
export function itemHref(code: string, pickup: string | null, ret: string | null): string {
  const base = `/book/item/${encodeURIComponent(code)}`
  if (pickup && ret && isDayKey(pickup) && isDayKey(ret)) return `${base}?from=${pickup}&to=${ret}`
  return base
}
