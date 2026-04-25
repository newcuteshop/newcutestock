'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { th } from 'date-fns/locale'

interface Product { id: string; name: string; sku: string; stock_qty: number }
interface Movement {
  id: string; type: string; qty: number; qty_before: number; qty_after: number
  note?: string; created_at: string; products?: { name: string; sku: string }
}

const TYPE_LABELS: Record<string, string> = {
  in: 'รับเข้า', out: 'จ่ายออก', adjust: 'ปรับยอด', return: 'รับคืน'
}
const TYPE_BADGE: Record<string, string> = {
  in: 'badge-in', out: 'badge-out', adjust: 'badge-adjust', return: 'badge-return'
}

export default function StockClient({ products, movements: initialMovements }: {
  products: Product[]; movements: Movement[]
}) {
  const [movements, setMovements] = useState(initialMovements)
  const [form, setForm] = useState({ product_id: '', type: 'in', qty: 1, note: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()
  const router = useRouter()

  const selectedProduct = products.find(p => p.id === form.product_id)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedProduct) return
    setLoading(true)
    setError('')

    const qty = Number(form.qty)
    const qty_before = selectedProduct.stock_qty
    let qty_after = qty_before

    if (form.type === 'in' || form.type === 'return') qty_after = qty_before + qty
    else if (form.type === 'out') qty_after = qty_before - qty
    else if (form.type === 'adjust') qty_after = qty

    if (qty_after < 0) { setError('สต๊อกไม่เพียงพอ'); setLoading(false); return }

    const { error: err } = await supabase.from('stock_movements').insert({
      product_id: form.product_id, type: form.type, qty, qty_before, qty_after, note: form.note || null
    })

    if (!err) {
      await supabase.from('products').update({ stock_qty: qty_after }).eq('id', form.product_id)
      setForm({ product_id: '', type: 'in', qty: 1, note: '' })
      router.refresh()
    } else {
      setError(err.message)
    }
    setLoading(false)
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Form */}
      <div className="card p-5 space-y-4 h-fit">
        <h2 className="font-semibold text-gray-900">บันทึกการเคลื่อนไหว</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">สินค้า *</label>
            <select className="input" required value={form.product_id}
              onChange={e => setForm(f => ({ ...f, product_id: e.target.value }))}>
              <option value="">-- เลือกสินค้า --</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.sku}) — คงเหลือ {p.stock_qty}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ประเภท *</label>
            <select className="input" value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
              <option value="in">📥 รับเข้า</option>
              <option value="out">📤 จ่ายออก</option>
              <option value="adjust">🔧 ปรับยอด</option>
              <option value="return">↩️ รับคืน</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {form.type === 'adjust' ? 'ยอดที่ถูกต้อง' : 'จำนวน'} *
            </label>
            <input className="input" type="number" min="0" required value={form.qty}
              onChange={e => setForm(f => ({ ...f, qty: Number(e.target.value) }))} />
          </div>
          {selectedProduct && (
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <p className="text-gray-500">สต๊อกปัจจุบัน: <span className="font-semibold text-gray-900">{selectedProduct.stock_qty}</span></p>
              <p className="text-gray-500">หลังทำรายการ: <span className="font-semibold text-brand-600">
                {form.type === 'in' || form.type === 'return'
                  ? selectedProduct.stock_qty + Number(form.qty)
                  : form.type === 'out'
                  ? selectedProduct.stock_qty - Number(form.qty)
                  : Number(form.qty)}
              </span></p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
            <input className="input" value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="ระบุเหตุผล..." />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'กำลังบันทึก...' : 'บันทึกรายการ'}
          </button>
        </form>
      </div>

      {/* History */}
      <div className="lg:col-span-2 card overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">ประวัติการเคลื่อนไหว</h2>
        </div>
        <div className="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
          {movements.length === 0 && (
            <p className="text-center py-10 text-gray-400">ยังไม่มีรายการ</p>
          )}
          {movements.map(m => (
            <div key={m.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <span className={TYPE_BADGE[m.type]}>{TYPE_LABELS[m.type]}</span>
                <div>
                  <p className="text-sm font-medium text-gray-900">{m.products?.name}</p>
                  <p className="text-xs text-gray-400">{m.note || m.products?.sku}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-900">
                  {m.type === 'out' ? '-' : '+'}{m.qty} ชิ้น
                </p>
                <p className="text-xs text-gray-400">
                  {m.qty_before} → {m.qty_after} |{' '}
                  {format(new Date(m.created_at), 'dd MMM yy HH:mm', { locale: th })}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
