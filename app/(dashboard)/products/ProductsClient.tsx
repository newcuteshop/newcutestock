'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { baht, productLabel, thaiError, variantText } from '@/lib/format'
import { codeCandidates, sameCode } from '@/lib/barcode'

export interface ProductRow {
  id: string
  name: string
  sku: string
  barcode: string | null
  category_id: string | null
  size: string | null
  color: string | null
  stock_qty: number
  min_stock: number
  sell_price: number
  cost_price: number
  is_active: boolean
  categories: { name: string } | null
}
export interface CategoryOption { id: string; name: string }

type Msg = { ok: boolean; text: string }

const PAGE_SIZE = 20

export default function ProductsClient({
  initialProducts, categories
}: { initialProducts: ProductRow[]; categories: CategoryOption[] }) {
  const [products, setProducts] = useState<ProductRow[]>(initialProducts)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [page, setPage] = useState(1)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState<Msg | null>(null)
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const supabase = useMemo(() => createClient(), [])

  // ข้อมูลจาก server เปลี่ยน (router.refresh) → ใช้ชุดใหม่
  useEffect(() => { setProducts(initialProducts) }, [initialProducts])
  useEffect(() => () => { if (msgTimer.current) clearTimeout(msgTimer.current) }, [])

  const filtered = useMemo(() => {
    const raw = search.trim()
    const q = raw.toLowerCase()
    // รหัสที่แปลงจากแป้นพิมพ์ไทย (สแกนเนอร์ USB ตอนคีย์บอร์ดเป็นภาษาไทย) — ไม่รวมคำค้นเดิม
    const converted = raw
      ? codeCandidates(raw).map(c => c.toLowerCase()).filter(c => c && c !== q)
      : []

    return products.filter(p => {
      const sku = p.sku.toLowerCase()
      const barcode = (p.barcode ?? '').toLowerCase()
      const matchSearch = !q ||
        p.name.toLowerCase().includes(q) ||
        variantText(p).toLowerCase().includes(q) ||
        sku.includes(q) ||
        barcode.includes(q) ||
        // รหัสที่แปลงแล้ว: ตรงทั้งรหัส หรือ (ยาว ≥ 4 ตัว) เป็นส่วนหนึ่งของรหัส — กันผลมั่วตอนพิมพ์ชื่อภาษาไทยสั้นๆ
        converted.some(c =>
          sameCode(c, p.sku) || sameCode(c, p.barcode) ||
          (c.length >= 4 && (sku.includes(c) || barcode.includes(c)))
        )
      const matchCat = !categoryFilter || p.category_id === categoryFilter
      return matchSearch && matchCat
    })
  }, [products, search, categoryFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  function showMsg(next: Msg) {
    if (msgTimer.current) clearTimeout(msgTimer.current)
    setMsg(next)
    // ข้อความสำเร็จหายเอง / ข้อความผิดพลาดค้างไว้จนกว่าจะปิด
    if (next.ok) msgTimer.current = setTimeout(() => setMsg(null), 3000)
  }

  async function toggleActive(p: ProductRow) {
    if (busyId) return
    const next = !p.is_active
    setBusyId(p.id)
    // optimistic: เปลี่ยนบนจอก่อน ถ้าบันทึกไม่ผ่านค่อยย้อนกลับ
    setProducts(ps => ps.map(x => x.id === p.id ? { ...x, is_active: next } : x))
    try {
      const { data, error } = await supabase
        .from('products')
        .update({ is_active: next })
        .eq('id', p.id)
        .select('id')
      if (error) throw error
      // RLS ไม่ให้แก้ = ไม่มี error แต่ไม่มีแถวถูกแก้
      if (!data || data.length === 0) throw new Error('ไม่มีสิทธิ์ทำรายการนี้')
      showMsg({ ok: true, text: `${next ? '✅ เปิดใช้งาน' : '⏸ ปิดใช้งาน'} "${productLabel(p)}" แล้ว` })
    } catch (err: unknown) {
      setProducts(ps => ps.map(x => x.id === p.id ? { ...x, is_active: p.is_active } : x))
      showMsg({ ok: false, text: `เปลี่ยนสถานะ "${productLabel(p)}" ไม่สำเร็จ: ${thaiError(err)}` })
    } finally {
      setBusyId(null)
    }
  }

  function stockClass(p: ProductRow) {
    return p.stock_qty <= p.min_stock ? 'text-red-500 font-bold' : 'text-gray-900'
  }

  function statusButton(p: ProductRow, extra = '') {
    return (
      <button
        type="button"
        onClick={() => toggleActive(p)}
        disabled={busyId !== null}
        title={p.is_active ? 'กดเพื่อปิดใช้งาน' : 'กดเพื่อเปิดใช้งาน'}
        className={`rounded-full text-xs font-medium transition-colors disabled:opacity-60 ${
          p.is_active ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
        } ${extra}`}
      >
        {busyId === p.id ? 'กำลังบันทึก...' : p.is_active ? 'ใช้งาน' : 'ปิดใช้'}
      </button>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="card p-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:flex-nowrap lg:gap-4">
        <input
          className="input w-full sm:flex-1 sm:min-w-48"
          type="search"
          enterKeyHint="search"
          autoCapitalize="none" autoCorrect="off" spellCheck={false}
          placeholder="🔍 ค้นหาชื่อสินค้า, SKU, บาร์โค้ด..."
          value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
        />
        <select
          className="input w-full sm:w-48 lg:w-60 xl:w-72"
          value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1) }}
        >
          <option value="">ทุกหมวดหมู่</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="text-sm text-gray-400 lg:whitespace-nowrap">
          แสดง {pageItems.length} / {filtered.length} รายการ
        </span>
      </div>

      {msg && (
        <div
          role={msg.ok ? 'status' : 'alert'}
          className={`flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-sm ${
            msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}
        >
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="shrink-0 -my-2 -mr-2 min-h-[40px] min-w-[40px] inline-flex items-center justify-center opacity-60 hover:opacity-100" aria-label="ปิดข้อความ">✕</button>
        </div>
      )}

      {/* มือถือ: การ์ดเรียงลงมา */}
      <div className="sm:hidden space-y-2">
        {pageItems.length === 0 && (
          <div className="card text-center py-10 text-gray-400 text-sm">ไม่พบสินค้า</div>
        )}
        {pageItems.map(p => {
          const variant = variantText(p)
          return (
            <div key={p.id} className={`card p-3 ${p.is_active ? '' : 'opacity-70'}`}>
              <div className="flex gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 break-words">{p.name}</p>
                  {variant && <p className="text-xs text-brand-700 font-medium">{variant}</p>}
                  <p className="text-xs text-gray-400 break-all">
                    SKU: {p.sku}{p.barcode ? ` · ${p.barcode}` : ''}
                  </p>
                  <p className="text-xs text-gray-500">{p.categories?.name ?? 'ไม่มีหมวดหมู่'}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold text-gray-900">{baht(p.sell_price)}</p>
                  <p className="text-sm">
                    <span className={stockClass(p)}>{p.stock_qty}</span>
                    <span className="text-gray-400 text-xs"> ชิ้น</span>
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                {statusButton(p, 'flex-1 min-h-[40px] px-3')}
                <Link
                  href={`/products/${p.id}`}
                  className="flex-1 min-h-[40px] inline-flex items-center justify-center rounded-lg border border-brand-200 text-brand-700 text-sm font-medium hover:bg-brand-50"
                >
                  ✏️ แก้ไข
                </Link>
              </div>
            </div>
          )
        })}
      </div>

      {/* แท็บเล็ต/คอม: ตาราง */}
      <div className="card overflow-hidden hidden sm:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 xl:px-6 py-3 font-semibold text-gray-600">สินค้า</th>
                {/* จอกว้างมาก (2xl+): แยกคอลัมน์รหัส และโชว์จำนวนขั้นต่ำ */}
                <th className="hidden 2xl:table-cell text-left px-4 xl:px-6 py-3 font-semibold text-gray-600">SKU / บาร์โค้ด</th>
                <th className="text-left px-4 xl:px-6 py-3 font-semibold text-gray-600">หมวดหมู่</th>
                <th className="text-right px-4 xl:px-6 py-3 font-semibold text-gray-600">ราคาขาย</th>
                <th className="text-right px-4 xl:px-6 py-3 font-semibold text-gray-600">สต๊อก</th>
                <th className="hidden 2xl:table-cell text-right px-4 xl:px-6 py-3 font-semibold text-gray-600 whitespace-nowrap">ขั้นต่ำ</th>
                <th className="text-center px-4 xl:px-6 py-3 font-semibold text-gray-600">สถานะ</th>
                <th className="px-4 xl:px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {pageItems.length === 0 && (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400">ไม่พบสินค้า</td></tr>
              )}
              {pageItems.map(p => {
                const variant = variantText(p)
                return (
                  <tr key={p.id} className={`hover:bg-gray-50 transition-colors ${p.is_active ? '' : 'text-gray-400'}`}>
                    <td className="px-4 xl:px-6 py-3">
                      <p className="font-medium text-gray-900">
                        {p.name}
                        {variant && <span className="ml-1 text-brand-700 font-normal">· {variant}</span>}
                      </p>
                      <p className="text-xs text-gray-400 2xl:hidden">
                        SKU: {p.sku}{p.barcode ? ` · บาร์โค้ด: ${p.barcode}` : ''}
                      </p>
                    </td>
                    <td className="hidden 2xl:table-cell px-4 xl:px-6 py-3 text-xs text-gray-500">
                      <p className="font-mono break-words">{p.sku}</p>
                      {p.barcode && <p className="font-mono text-gray-400 break-words">{p.barcode}</p>}
                    </td>
                    <td className="px-4 xl:px-6 py-3 text-gray-600">{p.categories?.name ?? '-'}</td>
                    <td className="px-4 xl:px-6 py-3 text-right font-medium whitespace-nowrap">{baht(p.sell_price)}</td>
                    <td className="px-4 xl:px-6 py-3 text-right whitespace-nowrap">
                      <span className={stockClass(p)}>{p.stock_qty}</span>
                      <span className="text-gray-400 text-xs"> ชิ้น</span>
                    </td>
                    <td className="hidden 2xl:table-cell px-4 xl:px-6 py-3 text-right text-gray-500 whitespace-nowrap">{p.min_stock}</td>
                    <td className="px-4 xl:px-6 py-3 text-center">
                      {statusButton(p, 'px-3 min-h-[40px]')}
                    </td>
                    <td className="px-4 xl:px-6 py-3 text-right">
                      <Link
                        href={`/products/${p.id}`}
                        className="inline-flex items-center min-h-[40px] px-2 rounded-lg text-brand-600 hover:bg-brand-50 text-xs font-medium"
                      >
                        แก้ไข
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="card flex items-center justify-between gap-2 px-4 py-3">
          <p className="text-xs text-gray-500">
            หน้า {currentPage} / {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="min-h-[40px] px-3 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40"
            >
              ← ก่อนหน้า
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="min-h-[40px] px-3 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40"
            >
              ถัดไป →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
