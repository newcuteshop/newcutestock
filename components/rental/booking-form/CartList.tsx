'use client'
import { useId } from 'react'
import clsx from 'clsx'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht } from '@/lib/format'
import { sizeLabel, type FindUnitsItem } from '@/lib/rental'
import RentalImage from '@/components/rental/RentalImage'
import { unitsHeldByOthers, type CartLine, type LineQuote } from './model'

// รายการชุดที่เลือก (ตะกร้า) — แต่ละบรรทัดเปลี่ยนชิ้นจริงได้ (ชิ้นที่ว่างของชุดเดียวกัน ไซส์ไหนก็ได้) หรือเอาออก
// compact = แสดงอย่างเดียว (แถบสรุปข้างจอ/ขั้นสรุป) ไม่มีช่องเลือกชิ้น/ปุ่มลบ
// มือถือ: ปุ่มลบอยู่ข้างชื่อ ราคาอยู่บรรทัดถัดไป ช่องเลือกชิ้นกว้างเต็มคอลัมน์ (3 คอลัมน์บีบชื่อชุดจนอ่านยากที่ 375px)
export default function CartList({
  lines,
  quoteOf,
  quoteLoading,
  availability,
  onRemove,
  onSetUnit,
  compact = false,
  disabled = false,
}: {
  lines: readonly CartLine[]
  quoteOf: (key: string) => LineQuote | null
  quoteLoading?: boolean
  availability?: ReadonlyMap<string, FindUnitsItem>
  onRemove?: (key: string) => void
  onSetUnit?: (key: string, unit: { unit_id: string; unit_code: string; size: string | null } | null) => void
  compact?: boolean
  disabled?: boolean
}) {
  const baseId = useId()
  if (lines.length === 0) return null

  return (
    <ul className={clsx('divide-y divide-gray-150', !compact && 'rounded-lg border border-gray-200')}>
      {lines.map((l, idx) => {
        const q = quoteOf(l.key)
        const unavailable = q !== null && !q.available
        const shownUnit = l.unit_code ?? q?.unit_code ?? null
        const selectId = `${baseId}-unit-${idx}`
        // ตัวเลือกชิ้น: ชิ้นที่ว่างของชุดนี้ทุกไซส์ (ไม่รวมชิ้นที่บรรทัดอื่นถืออยู่)
        const info = availability?.get(l.item_id)
        const held = unitsHeldByOthers(lines, l.key)
        const options: { id: string; code: string; label: string; size: string | null }[] = []
        if (info) {
          for (const s of info.sizes) {
            for (const u of s.free_units) {
              if (held.has(u.unit_id)) continue
              options.push({
                id: u.unit_id,
                code: u.unit_code,
                size: s.size,
                label: `${u.unit_code} · ${sizeLabel(s.size)}${u.needs_cleaning ? ' · รอซัก/เตรียม' : ''}`,
              })
            }
          }
        }
        // ชิ้นที่ระบุไว้แต่ไม่อยู่ในรายการว่าง (มีคนจองตัดหน้า / ข้อมูลความว่างยังโหลดไม่เสร็จ) — ยังต้องแสดงในช่องเลือก
        if (l.unit_id && !options.some(o => o.id === l.unit_id)) {
          const suffix = info ? ' (ไม่ว่างแล้ว)' : ''
          options.unshift({
            id: l.unit_id,
            code: l.unit_code ?? '',
            size: l.size,
            label: `${l.unit_code ?? 'ชิ้นที่เลือก'} · ${sizeLabel(l.size)}${suffix}`,
          })
        }
        // บรรทัดเดิม: ฐานข้อมูลใช้ชิ้นเดิมก่อนถ้ายังว่าง (ไม่ว่าง = เลือกชิ้นอื่นไซส์เดียวกันให้)
        const autoLabel = l.current_unit_code ? `ใช้ชิ้นเดิม ${l.current_unit_code}` : 'ระบบเลือกชิ้นที่ว่างให้'
        const name = (
          <p className="min-w-0 text-sm font-medium text-gray-900 break-words">
            <span className="font-mono text-xs text-gray-500">{l.item_code}</span>{' '}
            {l.item_name}
          </p>
        )
        const price = q ? (
          <span className={clsx('money text-sm', unavailable ? 'text-gray-400 line-through' : 'text-gray-900')}>{baht(q.rent_price)}</span>
        ) : quoteLoading ? (
          <Loader2 {...ICON_XS} className="animate-spin text-gray-400" />
        ) : (
          <span className="text-xs text-gray-400">-</span>
        )

        return (
          <li key={l.key} className={clsx('flex items-start gap-3', compact ? 'py-2.5' : 'p-3')}>
            <RentalImage
              path={l.cover_path}
              alt=""
              className={clsx('shrink-0 rounded-lg border border-gray-200', compact ? 'h-11 w-11' : 'h-12 w-12 sm:h-14 sm:w-14')}
            />
            <div className="min-w-0 flex-1 space-y-1.5">
              {compact ? (
                <div className="flex items-start justify-between gap-2">
                  {name}
                  <span className="shrink-0">{price}</span>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-1">
                  {name}
                  {onRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(l.key)}
                      disabled={disabled}
                      className="btn-icon btn-icon-plain -mr-2 -mt-2 shrink-0"
                      aria-label={`เอา ${l.item_code} ${l.item_name} ไซส์ ${sizeLabel(l.size)} ออก`}
                    >
                      <Trash2 {...ICON_SM} />
                    </button>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-xs text-gray-600">
                  ไซส์ <span className="font-medium text-gray-800">{sizeLabel(l.size)}</span>
                  {compact && shownUnit && <span className="text-gray-500"> · ชิ้น <span className="font-mono">{shownUnit}</span></span>}
                  {l.is_accessory && <span className="text-gray-500"> · เครื่องประดับ</span>}
                  {q && q.deposit > 0 && <span className="text-gray-500 tabular-nums"> · ประกัน {baht(q.deposit)}</span>}
                </p>
                {!compact && <span className="ml-auto">{price}</span>}
              </div>

              {!compact && onSetUnit && (
                <div>
                  <label htmlFor={selectId} className="sr-only">ชิ้นของ {l.item_code} ไซส์ {sizeLabel(l.size)}</label>
                  <select
                    id={selectId}
                    className="input py-1"
                    value={l.unit_id ?? ''}
                    disabled={disabled}
                    onChange={e => {
                      const v = e.target.value
                      if (!v) {
                        onSetUnit(l.key, null)
                        return
                      }
                      const opt = options.find(o => o.id === v)
                      onSetUnit(l.key, { unit_id: v, unit_code: opt ? opt.code : '', size: opt ? opt.size : l.size })
                    }}
                  >
                    <option value="">{autoLabel}</option>
                    {options.map(o => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                  {!l.unit_id && shownUnit && q?.available && (
                    <p className="mt-1 text-xs text-gray-500">ระบบจะใช้ชิ้น <span className="font-mono text-gray-700">{shownUnit}</span></p>
                  )}
                </div>
              )}

              {unavailable && (
                <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-red-700">
                  <AlertTriangle {...ICON_XS} className="mt-px shrink-0" />
                  <span className="min-w-0 break-words">{q?.conflict || 'ชุดนี้ไม่ว่างในช่วงวันที่เลือก'}</span>
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
