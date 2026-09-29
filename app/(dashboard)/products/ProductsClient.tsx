'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, ChevronLeft, ChevronRight, Pencil, Search, SearchX, X, XCircle } from 'lucide-react'
import { baht, productLabel, thaiError, variantText } from '@/lib/format'
import { codeCandidates, sameCode } from '@/lib/barcode'
import { ICON, ICON_SM } from '@/components/theme/icons'

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
      showMsg({ ok: true, text: `${next ? 'เปิดใช้งาน' : 'ปิดใช้งาน'} "${productLabel(p)}" แล้ว` })
    } catch (err: unknown) {
      setProducts(ps => ps.map(x => x.id === p.id ? { ...x, is_active: p.is_active } : x))
      showMsg({ ok: false, text: `เปลี่ยนสถานะ "${productLabel(p)}" ไม่สำเร็จ: ${thaiError(err)}` })
    } finally {
      setBusyId(null)
    }
  }

  function stockClass(p: ProductRow) {
    return p.stock_qty <= p.min_stock ? 'text-red-600 font-bold' : 'text-gray-900 font-semibold'
  }

  // ปุ่มสถานะแบบสวิตช์แคปซูล: รางเขียว = ใช้งาน / รางเทา = ปิดใช้ (มีข้อความบอกสถานะเสมอ ไม่พึ่งสีอย่างเดียว)
  function statusButton(p: ProductRow, extra = '') {
    return (
      <button
        type="button"
        onClick={() => toggleActive(p)}
        disabled={busyId !== null}
        title={p.is_active ? 'กดเพื่อปิดใช้งาน' : 'กดเพื่อเปิดใช้งาน'}
        className={`inline-flex items-center justify-center gap-2 min-h-[44px] rounded-full border-2 text-sm font-semibold leading-tight select-none transition-[transform,background-color,border-color,color] duration-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 ${
          p.is_active ? 'border-green-200 bg-green-50 text-green-800' : 'border-blush-line bg-white text-gray-600'
        } ${extra}`}
      >
        {/* ราง + ปุ่มกลม (.switch ใน globals.css) — เปิด = เขียว, ปิด = รางเทาอ่อน */}
        <span aria-hidden="true" className={`switch switch-sm switch-leaf ${p.is_active ? 'switch-on' : 'bg-gray-100'}`}>
          <span className="switch-knob" />
        </span>
        {busyId === p.id ? 'กำลังบันทึก...' : p.is_active ? 'ใช้งาน' : 'ปิดใช้'}
      </button>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="card p-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:flex-nowrap lg:gap-4">
        <div className="input-icon w-full sm:flex-1 sm:min-w-48">
          <Search {...ICON_SM} />
          <input
            className="input pl-11"
            type="search"
            enterKeyHint="search"
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            placeholder="ค้นหาชื่อสินค้า, SKU, บาร์โค้ด..."
            value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
        </div>
        <select
          className="input w-full sm:w-48 lg:w-60 xl:w-72"
          value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1) }}
        >
          <option value="">ทุกหมวดหมู่</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="text-sm text-gray-500 tabular-nums lg:whitespace-nowrap">
          แสดง {pageItems.length} / {filtered.length} รายการ
        </span>
      </div>

      {msg && (
        <div
          role={msg.ok ? 'status' : 'alert'}
          className={msg.ok ? 'alert-ok' : 'alert-err'}
        >
          {msg.ok ? <CheckCircle2 {...ICON_SM} /> : <XCircle {...ICON_SM} />}
          <span className="flex-1 min-w-0 break-words">{msg.text}</span>
          <button onClick={() => setMsg(null)} className="btn-icon btn-icon-plain -my-2 -mr-2 text-current" aria-label="ปิดข้อความ">
            <X {...ICON_SM} />
          </button>
        </div>
      )}

      {/* มือถือ/iPad แนวตั้ง (มีเมนูข้างแล้วเหลือที่แคบ): การ์ดเรียงลงมา — มือถือแนวนอนวาง 2 คอลัมน์ */}
      <div className="lg:hidden grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-1">
        {pageItems.length === 0 && (
          <div className="card empty-state sm:col-span-2 md:col-span-1">
            <span className="icon-bubble icon-bubble-lg"><SearchX size={30} strokeWidth={1.8} aria-hidden="true" /></span>
            <p className="empty-state-title">ไม่พบสินค้า</p>
          </div>
        )}
        {pageItems.map(p => {
          const variant = variantText(p)
          return (
            <div key={p.id} className={`card p-4 ${p.is_active ? '' : 'card-milk border-dashed border-gray-300'}`}>
              <div className="flex gap-3">
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="font-display font-semibold text-gray-900 leading-snug break-words">{p.name}</p>
                  {variant && <span className="chip max-w-full"><span className="truncate">{variant}</span></span>}
                  <p className="text-xs text-gray-400 break-all">
                    SKU: {p.sku}{p.barcode ? ` · ${p.barcode}` : ''}
                  </p>
                  <p className="text-xs text-gray-500">{p.categories?.name ?? 'ไม่มีหมวดหมู่'}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="money text-lg leading-tight text-brand-600">{baht(p.sell_price)}</p>
                  <p className="text-sm mt-1 tabular-nums">
                    <span className={stockClass(p)}>{p.stock_qty}</span>
                    <span className="text-gray-400 text-xs"> ชิ้น</span>
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-3 pt-3 border-t border-brand-100">
                {statusButton(p, 'flex-1 min-w-0 px-3')}
                <Link href={`/products/${p.id}`} className="btn-secondary flex-1 min-w-0 px-3">
                  <Pencil {...ICON_SM} />
                  แก้ไข
                </Link>
              </div>
            </div>
          )
        })}
      </div>

      {/* คอม/iPad แนวนอน: ตาราง */}
      <div className="card overflow-hidden hidden lg:block">
        <div className="table-wrap">
          <table className="table-soft min-w-[640px]">
            <thead>
              <tr>
                <th className="px-4 xl:px-6">สินค้า</th>
                {/* จอกว้างมาก (2xl+): แยกคอลัมน์รหัส และโชว์จำนวนขั้นต่ำ */}
                <th className="hidden 2xl:table-cell px-4 xl:px-6">SKU / บาร์โค้ด</th>
                <th className="px-4 xl:px-6">หมวดหมู่</th>
                <th className="text-right px-4 xl:px-6">ราคาขาย</th>
                <th className="text-right px-4 xl:px-6">สต๊อก</th>
                <th className="hidden 2xl:table-cell text-right px-4 xl:px-6 whitespace-nowrap">ขั้นต่ำ</th>
                <th className="text-center px-4 xl:px-6">สถานะ</th>
                <th className="px-4 xl:px-6"></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-0">
                    <div className="empty-state">
                      <span className="icon-bubble icon-bubble-lg"><SearchX size={30} strokeWidth={1.8} aria-hidden="true" /></span>
                      <p className="empty-state-title">ไม่พบสินค้า</p>
                    </div>
                  </td>
                </tr>
              )}
              {pageItems.map(p => {
                const variant = variantText(p)
                return (
                  <tr key={p.id} className={p.is_active ? '' : 'text-gray-400'}>
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
                    <td className="px-4 xl:px-6 py-3 text-right font-display font-semibold text-brand-600 tabular-nums whitespace-nowrap">{baht(p.sell_price)}</td>
                    <td className="px-4 xl:px-6 py-3 text-right tabular-nums whitespace-nowrap">
                      <span className={stockClass(p)}>{p.stock_qty}</span>
                      <span className="text-gray-400 text-xs"> ชิ้น</span>
                    </td>
                    <td className="hidden 2xl:table-cell px-4 xl:px-6 py-3 text-right text-gray-500 tabular-nums whitespace-nowrap">{p.min_stock}</td>
                    <td className="px-4 xl:px-6 py-3 text-center">
                      {statusButton(p, 'px-3 whitespace-nowrap')}
                    </td>
                    <td className="px-4 xl:px-6 py-3 text-right">
                      <Link href={`/products/${p.id}`} className="btn-ghost px-3 text-sm">
                        <Pencil {...ICON_SM} />
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
        <div className="card flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <p className="text-sm text-gray-500 tabular-nums">
            หน้า {currentPage} / {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="btn-secondary gap-1 px-3 sm:px-4"
            >
              <ChevronLeft {...ICON} />
              ก่อนหน้า
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="btn-secondary gap-1 px-3 sm:px-4"
            >
              ถัดไป
              <ChevronRight {...ICON} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
