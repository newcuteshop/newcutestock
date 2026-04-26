'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

interface Product {
  id: string; name: string; sku: string; barcode?: string
  stock_qty: number; min_stock: number; sell_price: number
  cost_price: number; is_active: boolean; size?: string; color?: string
  categories?: { name: string }
}
interface Category { id: string; name: string }

const PAGE_SIZE = 20

export default function ProductsClient({
  initialProducts, categories
}: { initialProducts: Product[]; categories: Category[] }) {
  const [products, setProducts] = useState(initialProducts)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [page, setPage] = useState(1)
  const supabase = createClient()

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return products.filter(p => {
      const matchSearch = !q ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode ?? '').toLowerCase().includes(q)
      const matchCat = !categoryFilter || p.categories?.name === categoryFilter
      return matchSearch && matchCat
    })
  }, [products, search, categoryFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  async function toggleActive(id: string, current: boolean) {
    setProducts(ps => ps.map(p => p.id === id ? { ...p, is_active: !current } : p))
    await supabase.from('products').update({ is_active: !current }).eq('id', id)
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="card p-4 flex flex-wrap gap-3">
        <input
          className="input flex-1 min-w-48"
          placeholder="🔍 ค้นหาชื่อสินค้า, SKU, บาร์โค้ด..."
          value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
        />
        <select
          className="input w-48"
          value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1) }}
        >
          <option value="">ทุกหมวดหมู่</option>
          {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
        <span className="text-sm text-gray-400 self-center">
          แสดง {pageItems.length} / {filtered.length} รายการ
        </span>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">สินค้า</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">หมวดหมู่</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-600">ราคาขาย</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-600">สต๊อก</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-600">สถานะ</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {pageItems.length === 0 && (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">ไม่พบสินค้า</td></tr>
            )}
            {pageItems.map(p => (
              <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">{p.name}</p>
                  <p className="text-xs text-gray-400">SKU: {p.sku} {p.size && `| ${p.size}`} {p.color && `| ${p.color}`}</p>
                </td>
                <td className="px-4 py-3 text-gray-600">{p.categories?.name ?? '-'}</td>
                <td className="px-4 py-3 text-right font-medium">฿{p.sell_price.toLocaleString()}</td>
                <td className="px-4 py-3 text-right">
                  <span className={p.stock_qty <= p.min_stock ? 'text-red-500 font-bold' : 'text-gray-900'}>
                    {p.stock_qty}
                  </span>
                  <span className="text-gray-400 text-xs"> ชิ้น</span>
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => toggleActive(p.id, p.is_active)}
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      p.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {p.is_active ? 'ใช้งาน' : 'ปิดใช้'}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/products/${p.id}`} className="text-brand-600 hover:underline text-xs font-medium">
                    แก้ไข
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
            <p className="text-xs text-gray-500">
              หน้า {currentPage} / {totalPages}
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 text-xs rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40"
              >
                ← ก่อนหน้า
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 text-xs rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40"
              >
                ถัดไป →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
