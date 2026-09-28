import { thaiError } from '@/lib/format'

// PostgREST (Supabase) ส่งกลับได้สูงสุด 1,000 แถวต่อครั้ง และตัดทิ้งเงียบ ๆ ไม่แจ้ง error
// → ดึงทีละหน้าจนได้หน้าที่ไม่เต็ม (query ต้องเรียงลำดับแบบไม่ซ้ำ เช่นปิดท้ายด้วย .order('id') กันแถวหาย/ซ้ำข้ามหน้า)
export const PAGE_SIZE = 1000

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(thaiError(error))
    const chunk = (Array.isArray(data) ? data : []) as T[]
    rows.push(...chunk)
    if (chunk.length < PAGE_SIZE) break
  }
  return rows
}
