'use client'
// ===== ช่องกรอกของแต่ละ SKU =====
// SingleVariantFields = สินค้าไม่มีไซส์ (SKU/ราคาชุดเดียว)
// SizeRow = 1 ไซส์ในตารางไซส์: มือถือ/iPad เป็นการ์ดซ้อนกัน, จอคอมกว้างตั้งแต่ 1400px เป็นแถวตาราง (1366 ยังเป็นการ์ด — ช่องบาร์โค้ด 13 หลักจะถูกตัด) — ใช้ช่องกรอกชุดเดียวกัน (ไม่มี id ซ้ำ)

import type { ReactNode } from 'react'
import { AlertTriangle, Camera, History, Package, Trash2 } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { baht } from '@/lib/format'
import { cleanText, MAX_SIZE_LEN } from '@/lib/products'
import { type RowState, barcodeValue, fieldId, parseCount, parseMoney } from './formModel'

export type FieldError = { id: string; message: string } | null

// คอลัมน์ของตารางไซส์บนจอกว้าง ≥ 1400px (หัวตาราง + ทุกแถวใช้ชุดเดียวกัน · เขียนคลาสเต็มให้ Tailwind หาเจอ)
export const SIZE_GRID_TABLE =
  'min-[1400px]:grid-cols-[6rem_minmax(8rem,1.3fr)_minmax(10rem,1.5fr)_minmax(5.5rem,0.8fr)_minmax(5.5rem,0.8fr)_minmax(4.5rem,0.6fr)_minmax(5.5rem,0.7fr)_8.5rem_2.75rem]'

function errOf(fe: FieldError, id: string): string {
  return fe && fe.id === id ? fe.message : ''
}

function Field({
  id, label, required, hint, error, className = '', tableMode = false, children,
}: {
  id: string
  label: string
  required?: boolean
  hint?: ReactNode
  error?: string
  className?: string
  tableMode?: boolean
  children: ReactNode
}) {
  return (
    <div className={`relative min-w-0 ${className}`}>
      <label htmlFor={id} className={`block text-sm font-medium text-gray-700 mb-1 ${tableMode ? 'min-[1400px]:sr-only' : ''}`}>
        {label}{required ? ' *' : ''}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} className="mt-1 text-xs font-medium text-red-700 break-words">{error}</p>
      ) : hint ? (
        <div className={`mt-1 text-xs text-gray-500 ${tableMode ? 'min-[1400px]:hidden' : ''}`}>{hint}</div>
      ) : null}
    </div>
  )
}

function invalidProps(id: string, error: string) {
  return error ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-err` } : {}
}

// ช่องบาร์โค้ด + ปุ่มสแกนด้วยกล้อง (เครื่องสแกนกด Enter ท้ายรหัส → ไม่ส่งฟอร์ม)
function BarcodeInput({
  id, value, error, disabled, onChange, onScan,
}: {
  id: string
  value: string
  error: string
  disabled?: boolean
  onChange: (v: string) => void
  onScan: () => void
}) {
  return (
    <div className="flex gap-2">
      <input
        id={id}
        className="input flex-1 min-w-0 font-mono"
        value={value}
        disabled={disabled}
        autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off"
        enterKeyHint="next"
        placeholder="สแกนหรือพิมพ์"
        maxLength={80}
        onChange={e => onChange(e.target.value)}
        onBlur={() => { const v = barcodeValue(value); if (v !== value) onChange(v) }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            const v = barcodeValue(value)
            if (v !== value) onChange(v)
          }
        }}
        {...invalidProps(id, error)}
      />
      <button type="button" onClick={onScan} disabled={disabled} className="btn-icon" aria-label="สแกนบาร์โค้ดด้วยกล้อง">
        <Camera {...ICON_SM} />
      </button>
    </div>
  )
}

function convertedHint(raw: string): ReactNode {
  const v = barcodeValue(raw)
  if (!v || v === raw.trim()) return null
  return <span className="text-amber-700 break-all">จะบันทึกเป็น: <span className="font-mono">{v}</span></span>
}

function profitHint(row: RowState): ReactNode {
  const sell = parseMoney(row.sell)
  const cost = parseMoney(row.cost) ?? 0
  if (sell === null || Number.isNaN(sell) || Number.isNaN(cost)) return null
  if (sell < cost) {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-amber-700">
        <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
        ต่ำกว่าราคาทุน
      </span>
    )
  }
  if (cost > 0) return <span>กำไร {baht(Math.round((sell - cost) * 100) / 100)}</span>
  return null
}

function StockBox({ row }: { row: RowState }) {
  const min = parseCount(row.min)
  const low = row.stock <= (min === null || Number.isNaN(min) ? 0 : min)
  return (
    <div
      className={`panel flex min-h-[44px] items-center gap-1.5 px-3.5 text-sm tabular-nums ${low ? 'text-red-700 font-semibold' : 'text-gray-900'}`}
      aria-label={`คงเหลือ ${row.stock} ชิ้น`}
    >
      <Package size={16} strokeWidth={1.9} aria-hidden="true" className={low ? 'text-red-600' : 'text-brand-600'} />
      <span className="font-display font-bold">{row.stock}</span>
      <span className="text-xs font-normal text-gray-500">ชิ้น</span>
    </div>
  )
}

// ===== สินค้าไม่มีไซส์ =====
export function SingleVariantFields({
  row, isNew, canStock, disabled, fieldError, onChange, onScan,
}: {
  row: RowState
  isNew: boolean
  canStock: boolean
  disabled: boolean
  fieldError: FieldError
  onChange: (patch: Partial<RowState>) => void
  onScan: () => void
}) {
  const ids = {
    sku: fieldId(row.key, 'sku'),
    barcode: fieldId(row.key, 'barcode'),
    cost: fieldId(row.key, 'cost'),
    sell: fieldId(row.key, 'sell'),
    min: fieldId(row.key, 'min'),
    opening: fieldId(row.key, 'opening'),
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <Field id={ids.sku} label="SKU" required error={errOf(fieldError, ids.sku)}
        hint="ภาษาอังกฤษ ตัวเลข หรือสัญลักษณ์ (เช่น - _ /)">
        <input
          id={ids.sku} className="input font-mono" value={row.sku} disabled={disabled}
          autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off"
          placeholder="เช่น SHIRT-001" maxLength={80}
          onChange={e => onChange({ sku: e.target.value, skuAuto: false })}
          {...invalidProps(ids.sku, errOf(fieldError, ids.sku))}
        />
      </Field>
      <Field id={ids.barcode} label="บาร์โค้ด" error={errOf(fieldError, ids.barcode)}
        hint={convertedHint(row.barcode) ?? 'ไม่บังคับ — ไม่มีบาร์โค้ด สติกเกอร์จะใช้ SKU แทน'}>
        <BarcodeInput id={ids.barcode} value={row.barcode} error={errOf(fieldError, ids.barcode)} disabled={disabled}
          onChange={v => onChange({ barcode: v })} onScan={onScan} />
      </Field>
      <Field id={ids.cost} label="ราคาทุน (฿)" error={errOf(fieldError, ids.cost)}>
        <input id={ids.cost} className="input tabular-nums" inputMode="decimal" autoComplete="off" placeholder="0"
          value={row.cost} disabled={disabled} onChange={e => onChange({ cost: e.target.value })}
          {...invalidProps(ids.cost, errOf(fieldError, ids.cost))} />
      </Field>
      <Field id={ids.sell} label="ราคาขาย (฿)" required error={errOf(fieldError, ids.sell)} hint={profitHint(row)}>
        <input id={ids.sell} className="input tabular-nums" inputMode="decimal" autoComplete="off"
          value={row.sell} disabled={disabled} onChange={e => onChange({ sell: e.target.value })}
          {...invalidProps(ids.sell, errOf(fieldError, ids.sell))} />
      </Field>
      <Field id={ids.min} label="จำนวนขั้นต่ำ (แจ้งเตือน)" error={errOf(fieldError, ids.min)} hint="เหลือเท่านี้หรือน้อยกว่า = ขึ้นเตือนของใกล้หมด">
        <input id={ids.min} className="input tabular-nums" inputMode="numeric" autoComplete="off"
          value={row.min} disabled={disabled} onChange={e => onChange({ min: e.target.value })}
          {...invalidProps(ids.min, errOf(fieldError, ids.min))} />
      </Field>
      {isNew ? (
        canStock ? (
          <Field id={ids.opening} label="ยอดยกมา (ชิ้น)" error={errOf(fieldError, ids.opening)}
            hint="สต๊อกเริ่มต้น บันทึกเป็นรับเข้า &quot;ยอดยกมา&quot; (เว้นว่าง = 0)">
            <input id={ids.opening} className="input tabular-nums" inputMode="numeric" autoComplete="off" placeholder="0"
              value={row.opening} disabled={disabled} onChange={e => onChange({ opening: e.target.value })}
              {...invalidProps(ids.opening, errOf(fieldError, ids.opening))} />
          </Field>
        ) : null
      ) : (
        <div className="min-w-0">
          <p className="block text-sm font-medium text-gray-700 mb-1">สต๊อกปัจจุบัน</p>
          <StockBox row={row} />
          <p className="mt-1 text-xs text-gray-500">ปรับยอดได้ที่เมนู รับ-จ่ายสต๊อก</p>
        </div>
      )}
    </div>
  )
}

// ===== 1 แถวในตารางไซส์ =====
export function SizeRow({
  row, canStock, groupActive, disabled, fieldError, hint,
  onChange, onSizeChange, onSizeBlur, onRemove, onScan,
}: {
  row: RowState
  canStock: boolean
  groupActive: boolean
  disabled: boolean
  fieldError: FieldError
  hint: string
  onChange: (patch: Partial<RowState>) => void
  onSizeChange: (size: string) => void
  onSizeBlur: () => void
  onRemove: () => void
  onScan: () => void
}) {
  const ids = {
    size: fieldId(row.key, 'size'),
    sku: fieldId(row.key, 'sku'),
    barcode: fieldId(row.key, 'barcode'),
    cost: fieldId(row.key, 'cost'),
    sell: fieldId(row.key, 'sell'),
    min: fieldId(row.key, 'min'),
    opening: fieldId(row.key, 'opening'),
  }
  const isNew = row.id === null
  const stockLocked = !isNew && row.stock !== 0
  const sizeText = cleanText(row.size)
  const skuText = cleanText(row.sku)
  const on = row.active && groupActive
  const removeLabel = stockLocked
    ? `เอาไซส์ ${sizeText || ''} ออกไม่ได้ — ยังมีสต๊อก ${row.stock} ชิ้น`
    : `เอาไซส์ ${sizeText || 'นี้'} ออก`

  const removeButton = (extra: string) => (
    <button
      type="button"
      onClick={onRemove}
      disabled={disabled}
      aria-disabled={stockLocked ? true : undefined}
      className={`btn-icon btn-icon-danger ${stockLocked ? 'opacity-45' : ''} ${extra}`}
      aria-label={removeLabel}
      title={removeLabel}
    >
      <Trash2 {...ICON_SM} />
    </button>
  )

  return (
    <li className={`relative panel p-3 sm:p-4 grid grid-cols-6 gap-x-3 gap-y-3 min-[1400px]:gap-x-2 min-[1400px]:gap-y-1 min-[1400px]:items-start min-[1400px]:rounded-none min-[1400px]:border-0 min-[1400px]:border-t min-[1400px]:border-blush-hair min-[1400px]:bg-transparent min-[1400px]:px-3 min-[1400px]:py-2.5 ${SIZE_GRID_TABLE}`}>
      {/* ไซส์ — ใช้ฟอนต์เนื้อหา (ตัว M ของฟอนต์หัวเรื่อง Kodchasan ดูเหมือน m ตัวเล็ก) */}
      <Field id={ids.size} label="ไซส์" required tableMode error={errOf(fieldError, ids.size)} className="col-span-2 min-[1400px]:col-span-1">
        <input
          id={ids.size}
          className="input px-3 text-center font-sans font-bold"
          value={row.size}
          disabled={disabled}
          maxLength={MAX_SIZE_LEN + 10}
          autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off"
          placeholder="เช่น M"
          onChange={e => onSizeChange(e.target.value)}
          onBlur={onSizeBlur}
          {...invalidProps(ids.size, errOf(fieldError, ids.size))}
        />
      </Field>

      {/* หัวการ์ดบนมือถือ: SKU ของไซส์นี้ (ตัวอักษรความกว้างเท่ากัน อ่านง่าย) + ปุ่มเอาออก */}
      <div className="col-span-4 flex items-end justify-end gap-2 min-w-0 min-[1400px]:hidden">
        <div className="min-w-0 flex-1 pb-2 text-right">
          <span className={`chip max-w-full font-mono ${skuText ? '' : 'text-gray-500'}`}>
            <span className="truncate">{skuText || 'ยังไม่มี SKU'}</span>
          </span>
        </div>
        {removeButton('')}
      </div>

      {/* SKU */}
      <Field id={ids.sku} label="SKU" required tableMode error={errOf(fieldError, ids.sku)}
        className="col-span-6 sm:col-span-3 lg:col-span-6 min-[1400px]:col-span-1"
        hint={isNew && row.skuAuto && skuText ? 'ตั้งให้อัตโนมัติ — แก้ได้' : undefined}>
        <input
          id={ids.sku}
          className="input font-mono"
          value={row.sku}
          disabled={disabled}
          maxLength={80}
          autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off"
          placeholder="SKU ของไซส์นี้"
          onChange={e => onChange({ sku: e.target.value, skuAuto: false })}
          {...invalidProps(ids.sku, errOf(fieldError, ids.sku))}
        />
      </Field>

      {/* บาร์โค้ด */}
      <Field id={ids.barcode} label="บาร์โค้ด" tableMode error={errOf(fieldError, ids.barcode)}
        className="col-span-6 sm:col-span-3 lg:col-span-6 min-[1400px]:col-span-1" hint={convertedHint(row.barcode)}>
        <BarcodeInput id={ids.barcode} value={row.barcode} error={errOf(fieldError, ids.barcode)} disabled={disabled}
          onChange={v => onChange({ barcode: v })} onScan={onScan} />
      </Field>

      {/* ราคาทุน / ราคาขาย */}
      <Field id={ids.cost} label="ทุน (฿)" tableMode error={errOf(fieldError, ids.cost)} className="col-span-3 min-[1400px]:col-span-1">
        <input id={ids.cost} className="input px-3 tabular-nums" inputMode="decimal" autoComplete="off" placeholder="0"
          value={row.cost} disabled={disabled} onChange={e => onChange({ cost: e.target.value })}
          {...invalidProps(ids.cost, errOf(fieldError, ids.cost))} />
      </Field>
      <Field id={ids.sell} label="ขาย (฿)" required tableMode error={errOf(fieldError, ids.sell)}
        className="col-span-3 min-[1400px]:col-span-1" hint={profitHint(row)}>
        <input id={ids.sell} className="input px-3 tabular-nums" inputMode="decimal" autoComplete="off"
          value={row.sell} disabled={disabled} onChange={e => onChange({ sell: e.target.value })}
          {...invalidProps(ids.sell, errOf(fieldError, ids.sell))} />
      </Field>

      {/* ขั้นต่ำ */}
      <Field id={ids.min} label="ขั้นต่ำ" tableMode error={errOf(fieldError, ids.min)} className="col-span-3 min-[1400px]:col-span-1">
        <input id={ids.min} className="input px-3 tabular-nums" inputMode="numeric" autoComplete="off"
          value={row.min} disabled={disabled} onChange={e => onChange({ min: e.target.value })}
          {...invalidProps(ids.min, errOf(fieldError, ids.min))} />
      </Field>

      {/* ยอดยกมา (ไซส์ใหม่) / คงเหลือ (ไซส์เดิม) */}
      {isNew ? (
        canStock ? (
          <Field id={ids.opening} label="ยอดยกมา" tableMode error={errOf(fieldError, ids.opening)} className="col-span-3 min-[1400px]:col-span-1">
            <input id={ids.opening} className="input px-3 tabular-nums" inputMode="numeric" autoComplete="off" placeholder="0"
              value={row.opening} disabled={disabled} onChange={e => onChange({ opening: e.target.value })}
              {...invalidProps(ids.opening, errOf(fieldError, ids.opening))} />
          </Field>
        ) : (
          <div className="col-span-3 min-[1400px]:col-span-1 min-w-0">
            <p className="block text-sm font-medium text-gray-700 mb-1 min-[1400px]:sr-only">คงเหลือ</p>
            <div className="panel flex min-h-[44px] items-center px-3.5 text-sm text-gray-500">ใหม่ · 0</div>
          </div>
        )
      ) : (
        <div className="col-span-3 min-[1400px]:col-span-1 min-w-0">
          <p className="block text-sm font-medium text-gray-700 mb-1 min-[1400px]:sr-only">คงเหลือ</p>
          <StockBox row={row} />
        </div>
      )}

      {/* เปิด/ปิดขายเฉพาะไซส์นี้ */}
      <div className="col-span-6 min-[1400px]:col-span-1 min-w-0">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={disabled || !groupActive}
          onClick={() => onChange({ active: !row.active })}
          title={groupActive ? undefined : 'สินค้านี้ปิดใช้งานทั้งแบบอยู่ — เปิดขายสินค้าก่อน'}
          className={`inline-flex w-full items-center justify-center gap-2 min-h-[44px] rounded-full border-2 px-3 text-sm font-semibold leading-tight whitespace-nowrap select-none transition-[transform,background-color,border-color,color] duration-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 ${
            on ? 'border-green-200 bg-green-50 text-green-800' : 'border-blush-line bg-white text-gray-600'
          }`}
        >
          <span aria-hidden="true" className={`switch switch-sm switch-leaf ${on ? 'switch-on' : 'bg-gray-100'}`}>
            <span className="switch-knob" />
          </span>
          {on ? 'เปิดขาย' : 'ปิดขาย'}
        </button>
      </div>

      {/* ปุ่มเอาออก (จอกว้าง = คอลัมน์สุดท้าย) */}
      <div className="hidden min-[1400px]:flex min-[1400px]:col-span-1 items-start justify-end">
        {removeButton('')}
      </div>

      {/* คำอธิบายเพิ่ม: มีประวัติ / สต๊อกค้าง / ข้อความหลังกดเอาออก */}
      {(hint || (row.hasHistory && !isNew && !stockLocked) || row.restored) && (
        <div className="col-span-6 min-[1400px]:col-span-full flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
          {row.restored && (
            <span className="inline-flex items-center gap-1 font-medium text-brand-700">
              <History size={14} strokeWidth={2} aria-hidden="true" />
              นำกลับมาจากไซส์ที่เลิกใช้ (ประวัติเดิมอยู่ครบ)
            </span>
          )}
          {row.hasHistory && !isNew && !row.restored && !stockLocked && (
            <span className="inline-flex items-center gap-1">
              <History size={14} strokeWidth={2} aria-hidden="true" />
              มีประวัติ — ถ้าเอาออกจะเก็บไว้ใน &quot;ไซส์ที่เลิกใช้&quot;
            </span>
          )}
          {hint && (
            <span role="status" className="inline-flex items-start gap-1 font-medium text-amber-800 break-words">
              <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" className="mt-0.5" />
              {hint}
            </span>
          )}
        </div>
      )}
    </li>
  )
}
