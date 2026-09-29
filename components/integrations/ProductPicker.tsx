'use client'
// เลือกสินค้าในแอป (1 ไซส์ = 1 SKU) มาจับคู่กับรายการบนแพลตฟอร์ม
// ค้นด้วยสิทธิ์ของผู้ใช้เอง (RLS) — ไม่แสดงไซส์ที่เลิกใช้ (is_archived)
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Loader2, Search, SearchX, X } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { productLabel, thaiError } from '@/lib/format'
import { qty } from './format'

export interface PickedProduct {
  id: string
  sku: string
  name: string
  size: string | null
  color: string | null
  stock_qty: number
  is_active: boolean
  is_archived: boolean
}

// ตัดอักขระที่ทำให้ตัวกรอง or() ของ PostgREST พัง / เป็น wildcard
function cleanQuery(q: string): string {
  return q.replace(/[,()*%\\"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
}

export default function ProductPicker({
  open, title, initialQuery, busy, onPick, onClose,
}: {
  open: boolean
  title: string
  initialQuery: string
  busy: boolean
  onPick: (p: PickedProduct) => void
  onClose: () => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const titleId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState(initialQuery)
  const [rows, setRows] = useState<PickedProduct[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const seq = useRef(0)

  useEffect(() => {
    if (open) {
      setQ(initialQuery)
      setError('')
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    }
  }, [open, initialQuery])

  useEffect(() => {
    if (!open) return
    const term = cleanQuery(q)
    const my = ++seq.current
    if (!term) { setRows([]); setLoading(false); return }
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const { data, error: err } = await supabase
          .from('products')
          .select('id, sku, name, size, color, stock_qty, is_active, is_archived')
          .eq('is_archived', false)
          .or(`sku.ilike.%${term}%,name.ilike.%${term}%`)
          .order('name')
          .order('sku')
          .limit(20)
        if (my !== seq.current) return
        if (err) { setError(thaiError(err)); setRows([]) } else { setError(''); setRows((data ?? []) as PickedProduct[]) }
      } catch (e) {
        if (my === seq.current) { setError(thaiError(e)); setRows([]) }
      } finally {
        if (my === seq.current) setLoading(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [q, open, supabase])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center scrim p-3 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="sheet w-full max-w-lg max-h-[85dvh] flex flex-col p-4 sm:p-5 gap-3 pb-[calc(1rem_+_env(safe-area-inset-bottom))] sm:pb-5 animate-pop-in"
      >
        <div className="flex items-start gap-2">
          <h3 id={titleId} className="min-w-0 flex-1 pt-2 text-lg font-bold leading-snug text-gray-900 break-words">{title}</h3>
          <button type="button" onClick={onClose} disabled={busy} aria-label="ปิด" className="btn-icon btn-icon-plain -mr-2 -mt-1 shrink-0">
            <X {...ICON_SM} />
          </button>
        </div>
        <div className="input-icon">
          <Search {...ICON_SM} />
          <input
            ref={inputRef}
            type="search"
            className="input pl-11"
            placeholder="ค้นหา SKU หรือชื่อสินค้า"
            value={q}
            onChange={e => setQ(e.target.value)}
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-label="ค้นหาสินค้าในแอป"
          />
        </div>

        <div className="min-h-[120px] flex-1 overflow-y-auto overscroll-contain -mx-1 px-1" aria-live="polite" aria-busy={loading}>
          {error ? (
            <p role="alert" className="alert-err">{error}</p>
          ) : loading ? (
            <p className="flex items-center gap-2 py-6 justify-center text-sm text-gray-500">
              <Loader2 {...ICON_SM} className="animate-spin" /> กำลังค้นหา...
            </p>
          ) : !cleanQuery(q) ? (
            <p className="py-6 text-center text-sm text-gray-500">พิมพ์ SKU หรือชื่อสินค้าเพื่อค้นหา</p>
          ) : rows.length === 0 ? (
            <div className="empty-state py-6">
              <span className="icon-bubble"><SearchX {...ICON_SM} /></span>
              <p>ไม่พบสินค้าที่ตรงกับ &quot;{q.trim()}&quot;</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {rows.map(p => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onPick(p)}
                    disabled={busy}
                    className="panel flex w-full min-h-[52px] items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:border-strawberry active:scale-[0.99] disabled:opacity-60"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-900 break-words">{productLabel(p)}</span>
                      <span className="block text-xs text-gray-500 font-mono break-all">{p.sku}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-xs text-gray-500">คงเหลือ</span>
                      <span className="block font-display font-bold tabular-nums text-gray-900">{qty(p.stock_qty)}</span>
                      {!p.is_active && <span className="block text-xs font-semibold text-amber-800">ปิดขายอยู่</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {busy && (
          <p className="flex items-center gap-2 text-sm text-gray-600"><Loader2 {...ICON_SM} className="animate-spin" /> กำลังบันทึกการจับคู่...</p>
        )}
      </div>
    </div>
  )
}
