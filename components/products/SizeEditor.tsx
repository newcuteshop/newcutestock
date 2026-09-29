'use client'
// ===== ตารางไซส์ (เมื่อติ๊ก "สินค้านี้มีไซส์") =====
// ปุ่มลัดไซส์ยอดนิยม + พิมพ์ไซส์เอง, SKU ตั้งต้น (ไซส์ใหม่ได้ SKU = ตั้งต้น-ไซส์), ใช้ราคาเดียวกันทุกไซส์,
// รายการที่จะเอาออกเมื่อบันทึก (เอากลับได้) และไซส์ที่เลิกใช้ (นำกลับมาใช้ได้)

import { useState } from 'react'
import { ArchiveRestore, Check, Coins, History, Plus, Ruler, Trash2, Undo2, X } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { baht } from '@/lib/format'
import { type VariantJson, COMMON_SIZES, cleanText, sizeKey, suggestSku, MAX_SIZE_LEN } from '@/lib/products'
import { type FormState, type RowState } from './formModel'
import { type FieldError, SIZE_GRID_TABLE, SizeRow } from './VariantFields'

export type SizeEditorActions = {
  changeRow: (key: string, patch: Partial<RowState>) => void
  changeSize: (key: string, size: string) => void
  blurSize: (key: string) => void // ตัดช่องว่าง/อักขระที่มองไม่เห็นหัวท้ายไซส์
  changeBaseSku: (base: string) => void
  addSize: (size: string) => { ok: boolean; message: string } // ok = เพิ่ม/นำกลับสำเร็จ, message = ข้อความแจ้งผล
  removeRow: (key: string) => void
  undoRemove: (id: string) => void
  restoreArchived: (id: string) => void
  applyAll: (v: { cost: string; sell: string; min: string }) => void
  scan: (key: string) => void
}

export default function SizeEditor({
  form, canStock, groupActive, disabled, fieldError, rowHints, actions,
}: {
  form: FormState
  canStock: boolean
  groupActive: boolean
  disabled: boolean
  fieldError: FieldError
  rowHints: Record<string, string>
  actions: SizeEditorActions
}) {
  const [custom, setCustom] = useState('')
  const [sizeMsg, setSizeMsg] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulk, setBulk] = useState({ cost: '', sell: '', min: '' })

  const existing = new Set(form.rows.map(r => sizeKey(r.size)).filter(k => k !== ''))
  const exampleSku = suggestSku(form.baseSku || 'SHIRT01', 'M')

  function add(size: string) {
    setSizeMsg(actions.addSize(size).message)
  }

  function addCustom() {
    const s = cleanText(custom)
    if (!s) { setSizeMsg('พิมพ์ไซส์ก่อน แล้วกดเพิ่ม'); return }
    const res = actions.addSize(s)
    setSizeMsg(res.message)
    if (res.ok) setCustom('')
  }

  function openBulk() {
    const first = form.rows[0]
    setBulk({ cost: first?.cost ?? '', sell: first?.sell ?? '', min: first?.min ?? '' })
    setBulkOpen(true)
  }

  return (
    <div className="space-y-4">
      {/* SKU ตั้งต้น */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor="pf-base-sku" className="block text-sm font-medium text-gray-700 mb-1">SKU ตั้งต้น</label>
          <input
            id="pf-base-sku"
            className="input font-mono"
            value={form.baseSku}
            disabled={disabled}
            maxLength={60}
            autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off"
            placeholder="เช่น SHIRT01"
            onChange={e => actions.changeBaseSku(e.target.value)}
          />
          <p className="mt-1 text-xs text-gray-500">
            ไซส์ใหม่จะได้ SKU อัตโนมัติ เช่น <span className="font-mono text-gray-700">{exampleSku}</span> (แก้เองได้ทุกช่อง · SKU ของไซส์เดิมไม่เปลี่ยน)
          </p>
        </div>
      </div>

      {/* เพิ่มไซส์ */}
      <div className="space-y-2" role="group" aria-labelledby="pf-add-size-label">
        <p id="pf-add-size-label" className="text-sm font-medium text-gray-700">เพิ่มไซส์</p>
        <div className="flex flex-wrap gap-2">
          {COMMON_SIZES.map(s => {
            const has = existing.has(sizeKey(s))
            return (
              <button
                key={s}
                type="button"
                className="chip-toggle"
                aria-pressed={has}
                disabled={disabled}
                onClick={() => add(s)}
                aria-label={has ? `มีไซส์ ${s} แล้ว` : `เพิ่มไซส์ ${s}`}
              >
                {has ? <Check size={16} strokeWidth={2.2} aria-hidden="true" /> : <Plus size={16} strokeWidth={2.2} aria-hidden="true" />}
                {s}
              </button>
            )
          })}
        </div>
        <div className="relative flex gap-2 sm:max-w-md">
          <label htmlFor="pf-size-new" className="sr-only">ไซส์อื่น</label>
          <input
            id="pf-size-new"
            className="input flex-1 min-w-0"
            value={custom}
            disabled={disabled}
            maxLength={MAX_SIZE_LEN + 10}
            autoCorrect="off" spellCheck={false} autoComplete="off"
            enterKeyHint="done"
            placeholder="ไซส์อื่น เช่น 28, 30, 2Y, อก 36"
            onChange={e => setCustom(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); addCustom() }
            }}
            aria-invalid={fieldError?.id === 'pf-size-new' ? true : undefined}
          />
          <button type="button" className="btn-secondary shrink-0 px-4" disabled={disabled} onClick={addCustom}>
            <Plus {...ICON_SM} />
            เพิ่ม
          </button>
        </div>
        {fieldError?.id === 'pf-size-new' && (
          <p className="text-xs font-medium text-red-700">{fieldError.message}</p>
        )}
        {sizeMsg && (
          <p role="status" className="text-xs font-medium text-brand-700 break-words">{sizeMsg}</p>
        )}
      </div>

      {/* ใช้ราคาเดียวกันทุกไซส์ */}
      {form.rows.length > 1 && (
        bulkOpen ? (
          <div className="panel p-3 sm:p-4 space-y-3" role="group" aria-labelledby="pf-bulk-title">
            <div className="flex items-center justify-between gap-2">
              <p id="pf-bulk-title" className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <Coins {...ICON_SM} className="text-brand-600" />
                ใช้ราคาเดียวกันทุกไซส์
              </p>
              <button type="button" className="btn-icon btn-icon-plain" aria-label="ปิด" onClick={() => setBulkOpen(false)}>
                <X {...ICON_SM} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3 sm:max-w-lg">
              <div className="min-w-0">
                <label htmlFor="pf-bulk-cost" className="block text-xs font-medium text-gray-700 mb-1">ทุน (฿)</label>
                <input id="pf-bulk-cost" className="input px-3 tabular-nums" inputMode="decimal" autoComplete="off" placeholder="ไม่เปลี่ยน"
                  value={bulk.cost} onChange={e => setBulk(b => ({ ...b, cost: e.target.value }))} />
              </div>
              <div className="min-w-0">
                <label htmlFor="pf-bulk-sell" className="block text-xs font-medium text-gray-700 mb-1">ขาย (฿)</label>
                <input id="pf-bulk-sell" className="input px-3 tabular-nums" inputMode="decimal" autoComplete="off" placeholder="ไม่เปลี่ยน"
                  value={bulk.sell} onChange={e => setBulk(b => ({ ...b, sell: e.target.value }))} />
              </div>
              <div className="min-w-0">
                <label htmlFor="pf-bulk-min" className="block text-xs font-medium text-gray-700 mb-1">ขั้นต่ำ</label>
                <input id="pf-bulk-min" className="input px-3 tabular-nums" inputMode="numeric" autoComplete="off" placeholder="ไม่เปลี่ยน"
                  value={bulk.min} onChange={e => setBulk(b => ({ ...b, min: e.target.value }))} />
              </div>
            </div>
            <p className="text-xs text-gray-500">ช่องที่เว้นว่างจะไม่เปลี่ยน</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                className="btn-soft w-full sm:w-auto"
                disabled={disabled}
                onClick={() => {
                  actions.applyAll(bulk)
                  setBulkOpen(false)
                  setSizeMsg(`ใช้ราคากับทั้ง ${form.rows.length} ไซส์แล้ว`)
                }}
              >
                <Check {...ICON_SM} />
                ใช้กับทุกไซส์ ({form.rows.length})
              </button>
              <button type="button" className="btn-ghost w-full sm:w-auto" onClick={() => setBulkOpen(false)}>ยกเลิก</button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn-soft w-full sm:w-auto" disabled={disabled} onClick={openBulk}>
            <Coins {...ICON_SM} />
            ใช้ราคาเดียวกันทุกไซส์
          </button>
        )
      )}

      {/* แถวไซส์ */}
      {form.rows.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-gray-500">
          <span className="icon-bubble"><Ruler {...ICON_SM} /></span>
          <p className="font-display font-semibold text-gray-900">ยังไม่มีไซส์</p>
          <p>กดเลือกไซส์ด้านบน หรือพิมพ์ไซส์เองแล้วกดเพิ่ม</p>
        </div>
      ) : (
        <div className="min-[1400px]:rounded-3xl min-[1400px]:border min-[1400px]:border-blush-line min-[1400px]:bg-white min-[1400px]:overflow-hidden">
          {/* หัวตาราง (จอกว้างเท่านั้น) */}
          <div
            aria-hidden="true"
            className={`relative hidden min-[1400px]:grid min-[1400px]:gap-x-2 bg-milk px-3 py-2.5 text-[13px] font-semibold text-gray-600 border-b-2 border-blush-hair ${SIZE_GRID_TABLE}`}
          >
            <span>ไซส์ *</span>
            <span>SKU *</span>
            <span>บาร์โค้ด</span>
            <span>ทุน (฿)</span>
            <span>ขาย (฿) *</span>
            <span>ขั้นต่ำ</span>
            {/* คอลัมน์แคบ: ให้ขึ้นบรรทัดใหม่หลัง "/" ไม่ใช่ตัดคำ "คง|เหลือ" */}
            <span>{canStock ? <>ยอดยกมา / <span className="whitespace-nowrap">คงเหลือ</span></> : 'คงเหลือ'}</span>
            <span>เปิดขาย</span>
            <span className="sr-only">เอาออก</span>
          </div>
          <ul className="grid gap-3 lg:grid-cols-2 min-[1400px]:grid-cols-1 min-[1400px]:gap-0 min-[1400px]:[&>li:first-child]:border-t-0" aria-label="ไซส์ของสินค้านี้">
            {form.rows.map(row => (
              <SizeRow
                key={row.key}
                row={row}
                canStock={canStock}
                groupActive={groupActive}
                disabled={disabled}
                fieldError={fieldError}
                hint={rowHints[row.key] ?? ''}
                onChange={patch => actions.changeRow(row.key, patch)}
                onSizeChange={size => actions.changeSize(row.key, size)}
                onSizeBlur={() => actions.blurSize(row.key)}
                onRemove={() => actions.removeRow(row.key)}
                onScan={() => actions.scan(row.key)}
              />
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-gray-500">
        ทั้งหมด {form.rows.length} ไซส์ · แต่ละไซส์มี SKU ราคา และสต๊อกแยกกัน
        {!groupActive && ' · สินค้านี้ปิดใช้งานทั้งแบบอยู่ (เปิดขายที่ส่วน "สถานะการขาย" ด้านล่าง)'}
      </p>
    </div>
  )
}

// ===== รายการที่จะเอาออกเมื่อบันทึก + ไซส์ที่เลิกใช้ (แสดงทั้งแบบมีไซส์และไม่มีไซส์) =====
export function RemovedAndArchived({
  hasSizes, disabled, pendingRemovals, archived, onUndo, onRestore,
}: {
  hasSizes: boolean
  disabled: boolean
  pendingRemovals: VariantJson[]
  archived: VariantJson[]
  onUndo: (id: string) => void
  onRestore: (id: string) => void
}) {
  if (pendingRemovals.length === 0 && archived.length === 0) return null
  return (
    <div className="space-y-3">
      {/* จะเอาออกเมื่อกดบันทึก */}
      {pendingRemovals.length > 0 && (
        <div className="alert-warn flex-col items-stretch gap-2" role="group" aria-labelledby="pf-removals-title">
          <p id="pf-removals-title" className="flex items-center gap-2 font-semibold">
            <Trash2 {...ICON_SM} />
            จะเอาออกเมื่อกดบันทึก ({pendingRemovals.length})
          </p>
          <ul className="space-y-2">
            {pendingRemovals.map(v => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/70 px-3 py-2">
                <span className="chip">{v.size ?? 'ไม่มีไซส์'}</span>
                <span className="chip-outline font-mono max-w-full"><span className="truncate">{v.sku}</span></span>
                <span className="min-w-0 flex-1 text-xs">
                  {v.stock_qty !== 0
                    ? `ยังมีสต๊อก ${v.stock_qty} ชิ้น — เอาออกไม่ได้ (ปรับยอดเป็น 0 ที่เมนูรับ-จ่ายสต๊อกก่อน)`
                    : v.has_history
                      ? 'มีประวัติ: จะเก็บไว้ใน "ไซส์ที่เลิกใช้" (ปิดขาย ประวัติอยู่ครบ)'
                      : 'ยังไม่มีประวัติ: จะลบออกถาวร'}
                </span>
                {hasSizes && (
                  <button type="button" className="btn-ghost px-3 text-sm" disabled={disabled} onClick={() => onUndo(v.id)}>
                    <Undo2 {...ICON_SM} />
                    เอากลับ
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ไซส์ที่เลิกใช้ */}
      {archived.length > 0 && (
        <details className="panel px-3 py-2 sm:px-4 group">
          <summary className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-semibold text-gray-700 select-none">
            <History {...ICON_SM} className="text-brand-600" />
            ไซส์ที่เลิกใช้ ({archived.length})
            <span className="text-xs font-normal text-gray-500">— เก็บไว้เพราะมีประวัติ ขายไม่ได้</span>
          </summary>
          <ul className="mt-2 space-y-2 pb-2">
            {archived.map(v => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 rounded-2xl bg-white px-3 py-2 border border-blush-hair">
                <span className="chip">{v.size ?? 'ไม่มีไซส์'}</span>
                <span className="chip-outline font-mono max-w-full"><span className="truncate">{v.sku}</span></span>
                <span className="text-xs text-gray-500 tabular-nums">{baht(v.sell_price)} · คงเหลือ {v.stock_qty}</span>
                <button
                  type="button"
                  className="btn-ghost ml-auto px-3 text-sm"
                  disabled={disabled || !hasSizes}
                  onClick={() => onRestore(v.id)}
                >
                  <ArchiveRestore {...ICON_SM} />
                  นำกลับมาใช้
                </button>
              </li>
            ))}
          </ul>
          {!hasSizes && (
            <p className="pb-2 text-xs text-gray-500">ติ๊ก &quot;สินค้านี้มีไซส์&quot; ก่อน จึงนำไซส์กลับมาใช้ได้</p>
          )}
        </details>
      )}
    </div>
  )
}
