'use client'
import { useState } from 'react'

interface Product {
  id: string; name: string; sku: string
  barcode?: string; sell_price: number
}

interface LabelRow {
  product: Product; qty: number
}

export default function LabelsClient({ products }: { products: Product[] }) {
  const [rows, setRows] = useState<LabelRow[]>([])
  const [search, setSearch] = useState('')
  const [size, setSize] = useState<'sm' | 'md' | 'lg'>('md')
  const [showPrice, setShowPrice] = useState(true)
  const [generating, setGenerating] = useState(false)

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.sku.toLowerCase().includes(search.toLowerCase())
  )

  function addRow(p: Product) {
    setRows(rs => {
      const exists = rs.find(r => r.product.id === p.id)
      if (exists) return rs.map(r => r.product.id === p.id ? { ...r, qty: r.qty + 1 } : r)
      return [...rs, { product: p, qty: 1 }]
    })
  }

  function setQty(id: string, qty: number) {
    if (qty <= 0) setRows(rs => rs.filter(r => r.product.id !== id))
    else setRows(rs => rs.map(r => r.product.id === id ? { ...r, qty } : r))
  }

  async function generatePDF() {
    if (rows.length === 0) return
    setGenerating(true)
    try {
      const [{ default: jsPDF }, { default: JsBarcode }] = await Promise.all([
        import('jspdf'),
        import('jsbarcode'),
      ])

      // ขนาดสติกเกอร์ (mm)
      const sizes = {
        sm: { w: 38, h: 25, cols: 5, rows: 11 },
        md: { w: 50, h: 30, cols: 4, rows: 9 },
        lg: { w: 70, h: 40, cols: 2, rows: 6 },
      }
      const cfg = sizes[size]

      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      const pageW = 210, pageH = 297
      const marginX = (pageW - cfg.cols * cfg.w) / 2
      const marginY = (pageH - cfg.rows * cfg.h) / 2

      // ขยายเป็นรายชิ้นตามจำนวน
      const items: Product[] = []
      for (const r of rows) {
        for (let i = 0; i < r.qty; i++) items.push(r.product)
      }

      let i = 0
      for (const p of items) {
        const col = i % cfg.cols
        const row = Math.floor((i % (cfg.cols * cfg.rows)) / cfg.cols)
        const x = marginX + col * cfg.w
        const y = marginY + row * cfg.h

        if (i > 0 && i % (cfg.cols * cfg.rows) === 0) doc.addPage()

        // กรอบ
        doc.setDrawColor(220).rect(x + 1, y + 1, cfg.w - 2, cfg.h - 2)

        // ชื่อสินค้า
        doc.setFontSize(size === 'sm' ? 6 : size === 'md' ? 7 : 9)
        const nameLines = doc.splitTextToSize(p.name, cfg.w - 4)
        doc.text(nameLines.slice(0, 2), x + cfg.w / 2, y + 4, { align: 'center' })

        // บาร์โค้ด → canvas → image
        const canvas = document.createElement('canvas')
        const code = p.barcode || p.sku
        try {
          JsBarcode(canvas, code, {
            format: 'CODE128',
            width: 2,
            height: size === 'sm' ? 30 : size === 'md' ? 40 : 60,
            displayValue: false,
            margin: 0,
          })
          const dataUrl = canvas.toDataURL('image/png')
          const bcW = cfg.w - 6
          const bcH = size === 'sm' ? 8 : size === 'md' ? 10 : 14
          doc.addImage(dataUrl, 'PNG', x + 3, y + 8, bcW, bcH)
        } catch {}

        // SKU/Code
        doc.setFontSize(size === 'sm' ? 5 : 6)
        doc.text(code, x + cfg.w / 2, y + (size === 'sm' ? 19 : size === 'md' ? 22 : 28), { align: 'center' })

        // ราคา
        if (showPrice) {
          doc.setFontSize(size === 'sm' ? 8 : size === 'md' ? 10 : 12)
          doc.setFont('helvetica', 'bold')
          doc.text(`${p.sell_price.toLocaleString()} THB`,
            x + cfg.w / 2,
            y + cfg.h - 2,
            { align: 'center' })
          doc.setFont('helvetica', 'normal')
        }

        i++
      }

      doc.save(`labels-${new Date().toISOString().slice(0, 10)}.pdf`)
    } finally {
      setGenerating(false)
    }
  }

  const totalLabels = rows.reduce((s, r) => s + r.qty, 0)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Product list */}
      <div className="lg:col-span-2 space-y-4">
        <div className="card p-4">
          <input className="input" placeholder="🔍 ค้นหาสินค้า..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="card overflow-hidden">
          <div className="max-h-[500px] overflow-y-auto divide-y divide-gray-50">
            {filtered.map(p => (
              <button key={p.id} onClick={() => addRow(p)}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 text-sm">{p.name}</p>
                  <p className="text-xs text-gray-400">{p.barcode || p.sku} | ฿{p.sell_price.toLocaleString()}</p>
                </div>
                <span className="text-brand-600 text-sm">+ เพิ่ม</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="text-center py-10 text-gray-400 text-sm">ไม่พบสินค้า</p>
            )}
          </div>
        </div>
      </div>

      {/* Selection */}
      <div className="card p-5 space-y-4 h-fit">
        <h2 className="font-semibold text-gray-900">รายการสติกเกอร์ ({totalLabels})</h2>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">ขนาด</label>
          <select className="input" value={size} onChange={e => setSize(e.target.value as 'sm' | 'md' | 'lg')}>
            <option value="sm">เล็ก (38×25 mm) — A4 / 55 ดวง</option>
            <option value="md">กลาง (50×30 mm) — A4 / 36 ดวง</option>
            <option value="lg">ใหญ่ (70×40 mm) — A4 / 12 ดวง</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showPrice} onChange={e => setShowPrice(e.target.checked)} />
          แสดงราคา
        </label>

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {rows.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-4">ยังไม่มี — กดสินค้าเพื่อเพิ่ม</p>
          )}
          {rows.map(r => (
            <div key={r.product.id} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
              <p className="text-xs flex-1 truncate">{r.product.name}</p>
              <button onClick={() => setQty(r.product.id, r.qty - 1)}
                className="w-6 h-6 rounded bg-white text-gray-700 text-sm font-bold">-</button>
              <input type="number" min="0" value={r.qty}
                onChange={e => setQty(r.product.id, Number(e.target.value))}
                className="w-12 text-center text-sm border border-gray-200 rounded px-1 py-0.5" />
              <button onClick={() => setQty(r.product.id, r.qty + 1)}
                className="w-6 h-6 rounded bg-white text-gray-700 text-sm font-bold">+</button>
            </div>
          ))}
        </div>

        <button onClick={generatePDF} disabled={rows.length === 0 || generating}
          className="btn-primary w-full">
          {generating ? 'กำลังสร้าง PDF...' : `📄 ดาวน์โหลด PDF (${totalLabels} ดวง)`}
        </button>
        <button onClick={() => setRows([])} className="btn-secondary w-full text-sm">
          ล้างรายการ
        </button>
      </div>
    </div>
  )
}
