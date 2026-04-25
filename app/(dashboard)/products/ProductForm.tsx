'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Category { id: string; name: string }
interface ProductFormProps {
  categories: Category[]
  product?: {
    id: string; name: string; sku: string; barcode?: string
    category_id?: string; size?: string; color?: string
    cost_price: number; sell_price: number; min_stock: number
  }
}

export default function ProductForm({ categories, product }: ProductFormProps) {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    category_id: product?.category_id ?? '',
    size: product?.size ?? '',
    color: product?.color ?? '',
    cost_price: product?.cost_price ?? 0,
    sell_price: product?.sell_price ?? 0,
    min_stock: product?.min_stock ?? 5,
  })

  function set(field: string, value: string | number) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const payload = {
      ...form,
      cost_price: Number(form.cost_price),
      sell_price: Number(form.sell_price),
      min_stock: Number(form.min_stock),
      category_id: form.category_id || null,
      barcode: form.barcode || null,
    }

    const { error } = product?.id
      ? await supabase.from('products').update(payload).eq('id', product.id)
      : await supabase.from('products').insert(payload)

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/products')
      router.refresh()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card p-6 space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อสินค้า *</label>
          <input className="input" required value={form.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">SKU *</label>
          <input className="input" required value={form.sku} onChange={e => set('sku', e.target.value)} placeholder="เช่น SHIRT-001" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">บาร์โค้ด</label>
          <input className="input" value={form.barcode} onChange={e => set('barcode', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">หมวดหมู่</label>
          <select className="input" value={form.category_id} onChange={e => set('category_id', e.target.value)}>
            <option value="">-- เลือกหมวดหมู่ --</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">ไซส์</label>
          <input className="input" value={form.size} onChange={e => set('size', e.target.value)} placeholder="S, M, L, XL..." />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">สี</label>
          <input className="input" value={form.color} onChange={e => set('color', e.target.value)} placeholder="ขาว, ดำ, แดง..." />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">ราคาทุน (฿)</label>
          <input className="input" type="number" min="0" value={form.cost_price} onChange={e => set('cost_price', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">ราคาขาย (฿)</label>
          <input className="input" type="number" min="0" value={form.sell_price} onChange={e => set('sell_price', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">จำนวนขั้นต่ำ (แจ้งเตือน)</label>
          <input className="input" type="number" min="0" value={form.min_stock} onChange={e => set('min_stock', e.target.value)} />
        </div>
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <div className="flex gap-3">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? 'กำลังบันทึก...' : product ? 'บันทึกการแก้ไข' : 'เพิ่มสินค้า'}
        </button>
        <button type="button" onClick={() => router.back()} className="btn-secondary">
          ยกเลิก
        </button>
      </div>
    </form>
  )
}
