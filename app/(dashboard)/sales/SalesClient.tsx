'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { th } from 'date-fns/locale'

interface Product { id: string; name: string; sku: string; sell_price: number; stock_qty: number }
interface CartItem extends Product { cart_qty: number }
interface Sale { id: string; sale_no: string; net_amount: number; payment_method: string; created_at: string }

export default function SalesClient({ products, recentSales }: {
  products: Product[]; recentSales: Sale[]
}) {
  const [cart, setCart] = useState<CartItem[]>([])
  const [search, setSearch] = useState('')
  const [discount, setDiscount] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer' | 'credit'>('cash')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase())
  )

  const total = cart.reduce((s, i) => s + i.sell_price * i.cart_qty, 0)
  const net = total - discount

  function addToCart(product: Product) {
    setCart(c => {
      const exists = c.find(i => i.id === product.id)
      if (exists) return c.map(i => i.id === product.id ? { ...i, cart_qty: i.cart_qty + 1 } : i)
      return [...c, { ...product, cart_qty: 1 }]
    })
  }

  function updateQty(id: string, qty: number) {
    if (qty <= 0) setCart(c => c.filter(i => i.id !== id))
    else setCart(c => c.map(i => i.id === id ? { ...i, cart_qty: qty } : i))
  }

  async function handleCheckout() {
    if (cart.length === 0 || net < 0) return
    setLoading(true)

    const { data: sale, error } = await supabase.from('sales').insert({
      total_amount: total, discount, net_amount: net, payment_method: paymentMethod, note: note || null
    }).select().single()

    if (error || !sale) { setLoading(false); return }

    // Insert items + update stock
    await supabase.from('sale_items').insert(
      cart.map(i => ({ sale_id: sale.id, product_id: i.id, qty: i.cart_qty, unit_price: i.sell_price, subtotal: i.sell_price * i.cart_qty }))
    )
    for (const item of cart) {
      const newQty = item.stock_qty - item.cart_qty
      await supabase.from('products').update({ stock_qty: newQty }).eq('id', item.id)
      await supabase.from('stock_movements').insert({
        product_id: item.id, type: 'out', qty: item.cart_qty,
        qty_before: item.stock_qty, qty_after: newQty,
        ref_id: sale.id, note: `ขาย ${sale.sale_no}`
      })
    }

    setCart([]); setDiscount(0); setNote('')
    router.refresh()
    setLoading(false)
    alert(`✅ บันทึกการขายสำเร็จ\nเลขที่: ${sale.sale_no}\nยอดสุทธิ: ฿${net.toLocaleString()}`)
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Product Search */}
      <div className="lg:col-span-3 space-y-4">
        <div className="card p-4">
          <input className="input" placeholder="🔍 ค้นหาสินค้า..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[480px] overflow-y-auto">
          {filtered.map(p => (
            <button key={p.id} onClick={() => addToCart(p)} disabled={p.stock_qty === 0}
              className="card p-3 text-left hover:shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95">
              <p className="font-medium text-gray-900 text-sm line-clamp-2">{p.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{p.sku}</p>
              <p className="text-brand-600 font-bold mt-2">฿{p.sell_price.toLocaleString()}</p>
              <p className="text-xs text-gray-400">คงเหลือ: {p.stock_qty}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Cart */}
      <div className="lg:col-span-2 card p-5 space-y-4 h-fit">
        <h2 className="font-semibold text-gray-900">ตะกร้า ({cart.length} รายการ)</h2>

        {cart.length === 0 && (
          <p className="text-gray-400 text-sm text-center py-6">กดเลือกสินค้าเพื่อเพิ่มในตะกร้า</p>
        )}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {cart.map(item => (
            <div key={item.id} className="flex items-center gap-3 bg-gray-50 rounded-lg p-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                <p className="text-xs text-gray-400">฿{item.sell_price.toLocaleString()} × {item.cart_qty}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => updateQty(item.id, item.cart_qty - 1)}
                  className="w-6 h-6 rounded bg-gray-200 text-gray-700 font-bold text-sm hover:bg-gray-300">-</button>
                <span className="w-8 text-center text-sm font-semibold">{item.cart_qty}</span>
                <button onClick={() => updateQty(item.id, item.cart_qty + 1)}
                  disabled={item.cart_qty >= item.stock_qty}
                  className="w-6 h-6 rounded bg-gray-200 text-gray-700 font-bold text-sm hover:bg-gray-300 disabled:opacity-40">+</button>
              </div>
              <p className="text-sm font-semibold text-gray-900 w-16 text-right">
                ฿{(item.sell_price * item.cart_qty).toLocaleString()}
              </p>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-100 pt-4 space-y-3">
          <div className="flex justify-between text-sm text-gray-600">
            <span>ยอดรวม</span><span className="font-semibold">฿{total.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 shrink-0">ส่วนลด ฿</label>
            <input type="number" min="0" max={total} value={discount}
              onChange={e => setDiscount(Number(e.target.value))}
              className="input text-right" />
          </div>
          <div className="flex justify-between text-base font-bold text-gray-900 bg-gray-50 rounded-lg px-3 py-2">
            <span>ยอดสุทธิ</span><span className="text-brand-700">฿{net.toLocaleString()}</span>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ช่องทางชำระ</label>
            <select className="input" value={paymentMethod}
              onChange={e => setPaymentMethod(e.target.value as 'cash' | 'transfer' | 'credit')}>
              <option value="cash">💵 เงินสด</option>
              <option value="transfer">📱 โอนเงิน</option>
              <option value="credit">💳 บัตรเครดิต</option>
            </select>
          </div>
          <input className="input" placeholder="หมายเหตุ..." value={note} onChange={e => setNote(e.target.value)} />
          <button onClick={handleCheckout} disabled={cart.length === 0 || loading || net < 0}
            className="btn-primary w-full text-base">
            {loading ? 'กำลังบันทึก...' : `✅ ชำระเงิน ฿${net.toLocaleString()}`}
          </button>
          <button onClick={() => { setCart([]); setDiscount(0) }} className="btn-secondary w-full text-sm">
            ล้างตะกร้า
          </button>
        </div>
      </div>

      {/* Recent Sales */}
      <div className="lg:col-span-5 card overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">รายการขายล่าสุด</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50"><tr>
            <th className="text-left px-4 py-3 font-semibold text-gray-600">เลขที่</th>
            <th className="text-left px-4 py-3 font-semibold text-gray-600">ช่องทาง</th>
            <th className="text-right px-4 py-3 font-semibold text-gray-600">ยอดสุทธิ</th>
            <th className="text-right px-4 py-3 font-semibold text-gray-600">เวลา</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {recentSales.length === 0 && (
              <tr><td colSpan={4} className="text-center py-6 text-gray-400">ยังไม่มีรายการ</td></tr>
            )}
            {recentSales.map(s => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-gray-600">{s.sale_no}</td>
                <td className="px-4 py-3 text-gray-600">
                  {s.payment_method === 'cash' ? '💵 เงินสด' : s.payment_method === 'transfer' ? '📱 โอน' : '💳 บัตร'}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900">฿{s.net_amount.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-gray-400 text-xs">
                  {format(new Date(s.created_at), 'dd MMM yy HH:mm', { locale: th })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
