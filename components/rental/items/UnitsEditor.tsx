'use client'
// ===== ตารางชิ้นจริงของชุด (1 แถว = ชุด 1 ตัวที่แขวนอยู่ในร้าน มีรหัส/บาร์โค้ดของตัวเอง) =====
// - เพิ่มด่วน: เลือกไซส์ + จำนวน → เพิ่มทีละหลายชิ้น (รหัสชิ้นว่าง = ระบบตั้งให้ '<รหัสชุด>-NN' ตอนบันทึก)
// - แก้รหัส/ไซส์/สถานะ/หมายเหตุสภาพ ได้ทุกชิ้น · ชิ้นที่เคยถูกจองลบไม่ได้ (ให้ตั้งเป็น "เลิกใช้" แทน)
// - ปุ่ม "ซักแล้ว พร้อมให้เช่า" ทำงานทันที (rental_mark_unit_clean — พนักงานกดได้ ไม่ต้องกดบันทึกฟอร์ม)
// - การแก้ไขอื่นทั้งหมดบันทึกพร้อมข้อมูลชุดด้วยปุ่ม "บันทึก" ของฟอร์ม
// มือถือ = แถวเป็นกล่องซ้อนช่อง · จอกว้าง = แถวเดียว 5 ช่อง (ไม่มีตารางกว้างที่ต้องเลื่อนข้าง)

import { useId, useState } from 'react'
import clsx from 'clsx'
import {
  CalendarClock, Droplets, Info, Layers, Loader2, Lock, Minus, Plus, Sparkles, Trash2, Undo2,
} from 'lucide-react'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { formatThaiDate } from '@/lib/format'
import { cleanText } from '@/lib/products'
import { RENTAL_UNIT_STATUSES, sizeLabel, type RentalUnitStatus } from '@/lib/rental'
import {
  type ItemFormUnit, MAX_QUICK_ADD, MAX_UNITS, MAX_UNIT_CODE, MAX_UNIT_NOTE, MAX_UNIT_SIZE, QUICK_SIZES, autoCodeHint, sizeSummary,
} from './itemFormModel'

export type FieldError = { id: string; message: string } | null

// ป้ายสั้นในช่องเลือกสถานะ (ป้ายเต็มอยู่ใน lib/rental UNIT_STATUS_LABELS)
const STATUS_OPTIONS: Record<RentalUnitStatus, string> = {
  available: 'พร้อมให้เช่า',
  maintenance: 'ส่งซ่อม',
  retired: 'เลิกใช้',
}

export default function UnitsEditor({
  units, removed, itemCode, readOnly, disabled, fieldError, cleaning, cleanError,
  onChange, onAdd, onRemove, onUndoRemove, onMarkClean,
}: {
  units: ItemFormUnit[]
  /** ชิ้นเดิมที่ผู้ใช้กดเอาออก (จะลบตอนบันทึก) */
  removed: ItemFormUnit[]
  itemCode: string
  readOnly: boolean
  disabled: boolean
  fieldError: FieldError
  /** id ชิ้นที่กำลังบันทึก "ซักแล้ว" */
  cleaning: Record<string, boolean>
  cleanError: string
  onChange(key: string, patch: Partial<ItemFormUnit>): void
  onAdd(size: string, count: number): void
  onRemove(key: string): void
  onUndoRemove(id: string): void
  onMarkClean(unitId: string): void
}) {
  const listId = useId()
  const [quickSize, setQuickSize] = useState('')
  const [quickCount, setQuickCount] = useState(1)
  const [quickMsg, setQuickMsg] = useState('')

  const summary = sizeSummary(units.map(u => ({ size: u.size, status: u.status, needs_cleaning: u.needsCleaning })))
  const counts = {
    // "พร้อม" = พร้อมให้เช่าจริง (ไม่นับชิ้นที่รอซัก) — ตรงกับตัวเลขของแต่ละไซส์ด้านล่าง
    available: units.filter(u => u.status === 'available' && !u.needsCleaning).length,
    maintenance: units.filter(u => u.status === 'maintenance').length,
    retired: units.filter(u => u.status === 'retired').length,
    cleaning: units.filter(u => u.needsCleaning && u.status !== 'retired').length,
  }
  const existingSizes = Array.from(new Set(units.map(u => cleanText(u.size)).filter(Boolean)))
  const sizeChoices = Array.from(new Set([...QUICK_SIZES.filter(Boolean), ...existingSizes]))
  const room = Math.max(0, MAX_UNITS - units.length)

  function addQuick() {
    const size = cleanText(quickSize)
    if (size.length > MAX_UNIT_SIZE) {
      setQuickMsg(`ไซส์ยาวเกินไป (สูงสุด ${MAX_UNIT_SIZE} ตัวอักษร)`)
      return
    }
    const n = Math.min(quickCount, room)
    if (n <= 0) {
      setQuickMsg(`ชุดหนึ่งแบบมีได้ไม่เกิน ${MAX_UNITS} ชิ้น`)
      return
    }
    onAdd(size, n)
    setQuickMsg(`เพิ่มไซส์ ${sizeLabel(size)} ${n} ชิ้นแล้ว — กดบันทึกเพื่อสร้างรหัสชิ้น`)
    setQuickCount(1)
  }

  return (
    <section className="card p-4 sm:p-5 space-y-4 min-w-0" aria-labelledby="ri-sec-units" id="ri-units" tabIndex={-1}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="ri-sec-units" className="section-title">
            <Layers {...ICON} />
            ชิ้นชุด (ตัวจริงในร้าน)
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            1 แถว = ชุด 1 ตัว มีรหัสชิ้นสำหรับพิมพ์ป้ายบาร์โค้ด · ลูกค้าจองตามไซส์ ระบบเลือกชิ้นที่ว่างให้เอง
          </p>
        </div>
        <p className="text-xs text-gray-600 tabular-nums" aria-live="polite">
          ทั้งหมด {units.length} ชิ้น · พร้อม {counts.available}
          {counts.cleaning > 0 && ` · รอซัก ${counts.cleaning}`}
          {counts.maintenance > 0 && ` · ส่งซ่อม ${counts.maintenance}`}
          {counts.retired > 0 && ` · เลิกใช้ ${counts.retired}`}
        </p>
      </div>

      {summary.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="จำนวนชิ้นตามไซส์">
          {summary.map(s => (
            <li key={s.size || '-free'} className="chip-outline">
              <span className="font-semibold">{sizeLabel(s.size)}</span>
              <span className="tabular-nums text-gray-600">พร้อม {s.ready}/{s.total}</span>
            </li>
          ))}
          {counts.cleaning > 0 && (
            <li className="badge-return">
              <Droplets size={14} strokeWidth={2} aria-hidden="true" />
              รอซัก {counts.cleaning} ชิ้น
            </li>
          )}
        </ul>
      )}

      {/* เพิ่มด่วน */}
      {!readOnly && (
        <div className="panel p-3 sm:p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-900">เพิ่มชิ้นด่วน</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="เลือกไซส์">
            {sizeChoices.map(s => (
              <button
                key={s}
                type="button"
                className="chip-toggle px-3"
                aria-pressed={cleanText(quickSize).toLowerCase() === s.toLowerCase()}
                disabled={disabled}
                onClick={() => { setQuickSize(s); setQuickMsg('') }}
              >
                {s}
              </button>
            ))}
            <button
              type="button"
              className="chip-toggle px-3"
              aria-pressed={cleanText(quickSize) === ''}
              disabled={disabled}
              onClick={() => { setQuickSize(''); setQuickMsg('') }}
            >
              ฟรีไซส์
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
            <div className="min-w-0">
              <label htmlFor="ri-quick-size" className="field-label">ไซส์ (เว้นว่าง = ฟรีไซส์)</label>
              <input
                id="ri-quick-size"
                className="input"
                list={`${listId}-sizes`}
                maxLength={MAX_UNIT_SIZE + 5}
                value={quickSize}
                disabled={disabled}
                autoComplete="off"
                placeholder="เช่น M, 38, ฟรีไซส์"
                onChange={e => { setQuickSize(e.target.value); setQuickMsg('') }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addQuick() } }}
              />
            </div>
            <div>
              <span className="field-label" id="ri-quick-count-label">จำนวน</span>
              <div className="flex items-center gap-1.5" role="group" aria-labelledby="ri-quick-count-label">
                <button
                  type="button"
                  className="btn-icon"
                  aria-label="ลดจำนวน"
                  disabled={disabled || quickCount <= 1}
                  onClick={() => setQuickCount(c => Math.max(1, c - 1))}
                >
                  <Minus {...ICON_SM} />
                </button>
                <input
                  className="input w-16 text-center tabular-nums"
                  inputMode="numeric"
                  aria-label="จำนวนชิ้นที่จะเพิ่ม"
                  value={String(quickCount)}
                  disabled={disabled}
                  onChange={e => {
                    const n = parseInt(e.target.value.replace(/\D/g, ''), 10)
                    setQuickCount(Number.isFinite(n) ? Math.min(MAX_QUICK_ADD, Math.max(1, n)) : 1)
                  }}
                  // Enter ในช่องจำนวน = เพิ่มชิ้น (ไม่ใช่กดบันทึกทั้งฟอร์ม)
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addQuick() } }}
                />
                <button
                  type="button"
                  className="btn-icon"
                  aria-label="เพิ่มจำนวน"
                  disabled={disabled || quickCount >= MAX_QUICK_ADD}
                  onClick={() => setQuickCount(c => Math.min(MAX_QUICK_ADD, c + 1))}
                >
                  <Plus {...ICON_SM} />
                </button>
              </div>
            </div>
            <button type="button" className="btn-secondary w-full sm:w-auto" disabled={disabled || room === 0} onClick={addQuick}>
              <Plus {...ICON_SM} />
              เพิ่ม {quickCount} ชิ้น
            </button>
          </div>
          {quickMsg && <p className="text-xs text-gray-600" role="status">{quickMsg}</p>}
        </div>
      )}

      <datalist id={`${listId}-sizes`}>
        {sizeChoices.map(s => <option key={s} value={s} />)}
        <option value="ฟรีไซส์" />
      </datalist>

      {fieldError?.id === 'ri-units' && (
        <p className="text-sm font-medium text-red-700" role="alert">{fieldError.message}</p>
      )}

      {units.length === 0 ? (
        <div className="empty-state rounded-lg border border-dashed border-gray-300 py-8">
          <span className="icon-bubble"><Layers {...ICON} /></span>
          <p className="empty-state-title">ยังไม่มีชิ้นชุด</p>
          <p>{readOnly ? 'ผู้จัดการร้านเช่าเพิ่มชิ้นชุดได้ที่หน้านี้' : 'เพิ่มชิ้นด้วย "เพิ่มชิ้นด่วน" ด้านบน — ยังไม่มีชิ้น ลูกค้าจองชุดนี้ไม่ได้'}</p>
        </div>
      ) : (
        <ul className="space-y-2" aria-label="รายการชิ้นชุด">
          {units.map(u => (
            <UnitRow
              key={u.key}
              unit={u}
              listId={`${listId}-sizes`}
              itemCode={itemCode}
              readOnly={readOnly}
              disabled={disabled}
              fieldError={fieldError}
              cleaning={!!(u.id && cleaning[u.id])}
              onChange={patch => onChange(u.key, patch)}
              onRemove={() => onRemove(u.key)}
              onMarkClean={() => { if (u.id) onMarkClean(u.id) }}
            />
          ))}
        </ul>
      )}

      {cleanError && (
        <p role="alert" className="text-sm font-medium text-red-700">{cleanError}</p>
      )}

      {removed.length > 0 && (
        <div className="alert-warn">
          <Trash2 {...ICON_SM} />
          <div className="min-w-0 flex-1 space-y-2">
            <p>ชิ้นที่จะถูกลบเมื่อกดบันทึก ({removed.length} ชิ้น)</p>
            <ul className="flex flex-wrap gap-2">
              {removed.map(u => (
                <li key={u.key}>
                  <button
                    type="button"
                    className="btn-secondary md:min-h-[36px] px-3 text-sm"
                    disabled={disabled}
                    onClick={() => { if (u.id) onUndoRemove(u.id) }}
                  >
                    <Undo2 {...ICON_XS} />
                    <span className="font-mono break-all">{u.code}</span>
                    <span className="text-gray-500">({sizeLabel(u.size)})</span>
                    เอากลับ
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}

function UnitRow({
  unit: u, listId, itemCode, readOnly, disabled, fieldError, cleaning, onChange, onRemove, onMarkClean,
}: {
  unit: ItemFormUnit
  listId: string
  itemCode: string
  readOnly: boolean
  disabled: boolean
  fieldError: FieldError
  cleaning: boolean
  onChange(patch: Partial<ItemFormUnit>): void
  onRemove(): void
  onMarkClean(): void
}) {
  const codeId = `ru-${u.key}-code`
  const sizeId = `ru-${u.key}-size`
  const statusId = `ru-${u.key}-status`
  const noteId = `ru-${u.key}-note`
  const errFor = (id: string) => (fieldError?.id === id ? fieldError.message : null)
  const retired = u.status === 'retired'
  const blockedRemove = u.hasHistory
  const label = cleanText(u.code) || 'ชิ้นใหม่'
  const removeButton = (
    <button
      type="button"
      className="btn-icon btn-icon-danger"
      disabled={disabled || blockedRemove}
      onClick={onRemove}
      aria-label={blockedRemove ? `ชิ้น ${label} มีประวัติการเช่า ลบไม่ได้` : `เอาชิ้น ${label} ออก`}
      title={blockedRemove ? 'มีประวัติการเช่า ลบไม่ได้ — ตั้งสถานะเป็นเลิกใช้แทน' : 'เอาชิ้นนี้ออก'}
    >
      {blockedRemove ? <Lock {...ICON_SM} /> : <Trash2 {...ICON_SM} />}
    </button>
  )

  return (
    <li
      className={clsx(
        'panel p-3 space-y-2',
        retired && 'opacity-70',
        u.id === null && 'border-dashed border-brand-300 bg-white',
      )}
      aria-label={`ชิ้น ${label} ไซส์ ${sizeLabel(u.size)}`}
    >
      <div className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] md:items-start">
        <div className="col-span-2 min-w-0 md:col-span-1">
          <label htmlFor={codeId} className="field-label">รหัสชิ้น</label>
          <div className="flex gap-2">
            <input
              id={codeId}
              className="input font-mono"
              maxLength={MAX_UNIT_CODE + 5}
              value={u.code}
              disabled={disabled || readOnly}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              placeholder={u.id ? 'รหัสชิ้น' : autoCodeHint(itemCode)}
              aria-invalid={errFor(codeId) ? true : undefined}
              onChange={e => onChange({ code: e.target.value })}
            />
            {/* มือถือ: ปุ่มเอาออกอยู่ข้างรหัสชิ้น (จอกว้างอยู่ท้ายแถว) */}
            {!readOnly && <span className="md:hidden">{removeButton}</span>}
          </div>
        </div>
        <div className="min-w-0">
          <label htmlFor={sizeId} className="field-label">ไซส์</label>
          <input
            id={sizeId}
            className="input"
            list={listId}
            maxLength={MAX_UNIT_SIZE + 5}
            value={u.size}
            disabled={disabled || readOnly}
            autoComplete="off"
            placeholder="ฟรีไซส์"
            aria-invalid={errFor(sizeId) ? true : undefined}
            onChange={e => onChange({ size: e.target.value === 'ฟรีไซส์' ? '' : e.target.value })}
          />
        </div>
        <div className="min-w-0">
          <label htmlFor={statusId} className="field-label">สถานะ</label>
          <select
            id={statusId}
            className="input"
            value={u.status}
            disabled={disabled || readOnly}
            onChange={e => onChange({ status: e.target.value as RentalUnitStatus })}
          >
            {RENTAL_UNIT_STATUSES.map(s => <option key={s} value={s}>{STATUS_OPTIONS[s]}</option>)}
          </select>
        </div>
        <div className="col-span-2 min-w-0 md:col-span-1">
          <label htmlFor={noteId} className="field-label">หมายเหตุสภาพ</label>
          <input
            id={noteId}
            className="input"
            maxLength={MAX_UNIT_NOTE + 20}
            value={u.note}
            disabled={disabled || readOnly}
            autoComplete="off"
            placeholder="สภาพชิ้น เช่น กระดุมหลุด 1 เม็ด"
            aria-invalid={errFor(noteId) ? true : undefined}
            onChange={e => onChange({ note: e.target.value })}
          />
        </div>
        {!readOnly && <div className="hidden md:flex md:pt-[1.625rem]">{removeButton}</div>}
      </div>

      {[codeId, sizeId, noteId].map(id => errFor(id) && (
        <p key={id} className="text-xs font-medium text-red-700" role="alert">{errFor(id)}</p>
      ))}

      {(u.id === null || u.needsCleaning || u.nextBooking || u.hasHistory || u.status !== 'available') && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {u.id === null && <span className="chip-strong">ชิ้นใหม่ (ยังไม่บันทึก)</span>}
          {u.status === 'maintenance' && (
            <span className="badge-adjust">ไม่พร้อมให้เช่า — จองใหม่ไม่ได้</span>
          )}
          {retired && <span className="badge-adjust">เลิกใช้แล้ว</span>}
          {u.hasHistory && !retired && (
            <span className="chip" title="ชิ้นนี้เคยถูกจองแล้ว ลบไม่ได้">
              <Lock size={12} strokeWidth={2} aria-hidden="true" />
              มีประวัติเช่า
            </span>
          )}
          {u.nextBooking && (
            <span className="chip-outline max-w-full">
              <CalendarClock size={14} strokeWidth={2} aria-hidden="true" className="shrink-0" />
              <span className="min-w-0 truncate">
                จองถัดไป {u.nextBooking.booking_no} · รับ {formatThaiDate(u.nextBooking.pickup_date)}
              </span>
            </span>
          )}
          {u.needsCleaning && (
            <>
              <span className="badge-return">
                <Droplets size={14} strokeWidth={2} aria-hidden="true" />
                รอซัก / ตรวจสภาพ
              </span>
              {u.id && (
                <button
                  type="button"
                  className="btn-soft md:min-h-[36px] px-3 text-sm"
                  disabled={cleaning}
                  onClick={onMarkClean}
                >
                  {cleaning ? <Loader2 {...ICON_XS} className="animate-spin" /> : <Sparkles {...ICON_XS} />}
                  ซักแล้ว พร้อมให้เช่า
                </button>
              )}
            </>
          )}
          {u.id && u.status !== 'available' && u.nextBooking && (
            <span className="inline-flex items-center gap-1 text-amber-800">
              <Info size={14} strokeWidth={2} aria-hidden="true" />
              มีลูกค้าจองชิ้นนี้อยู่ — สลับชิ้นในหน้าการจอง
            </span>
          )}
        </div>
      )}
    </li>
  )
}
