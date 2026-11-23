'use client'
// กำหนดการ / ฤกษ์ ของคิวงาน (สูงสุด 40 แถว: เวลา + รายละเอียด) — แถวว่างทั้งสองช่องไม่ถูกส่ง
// มีกำหนดการตัวอย่างตามประเภทคิว (ใส่ให้เมื่อยังไม่มีแถวเลย — แก้/ลบได้ทุกแถว)
import { useId } from 'react'
import { ArrowDownUp, Plus, Trash2 } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { MAX_RUN_SHEET_ROWS, type WedSessionType } from '@/lib/wedding'
import { MAX_RUN_TEXT, newRunRow, timeValue, type RunRowDraft } from './model'

// กำหนดการตัวอย่าง (เวลาฤกษ์ทั่วไป — บอสแก้ตามงานจริง)
const TEMPLATES: Partial<Record<WedSessionType, readonly [string, string][]>> = {
  engagement: [
    ['08:09', 'ขบวนขันหมากเดินทางถึง'],
    ['08:39', 'แห่ขันหมาก / กั้นประตู'],
    ['09:09', 'พิธีสู่ขอ นับสินสอด'],
    ['09:39', 'สวมแหวนหมั้น'],
    ['10:09', 'ถ่ายภาพหมู่ครอบครัว'],
  ],
  ceremony: [
    ['07:00', 'พิธีสงฆ์ / ตักบาตร'],
    ['08:09', 'แห่ขันหมาก'],
    ['09:09', 'พิธีสู่ขอ สวมแหวน'],
    ['10:09', 'พิธีหลั่งน้ำพระพุทธมนต์'],
    ['11:00', 'ถ่ายภาพหมู่ / ส่งตัว'],
  ],
  reception: [
    ['17:30', 'ทีมถ่ายบรรยากาศหน้างาน / ซุ้มถ่ายรูป'],
    ['18:00', 'ต้อนรับแขก'],
    ['19:00', 'บ่าวสาวขึ้นเวที / พิธีการ'],
    ['19:30', 'ตัดเค้ก / ดื่มอวยพร'],
    ['20:30', 'โยนช่อดอกไม้ / ถ่ายภาพหมู่'],
  ],
  prewedding: [
    ['06:00', 'แต่งหน้า-ทำผม'],
    ['07:00', 'ถ่ายช่วงเช้า (แสงอ่อน)'],
    ['16:00', 'ถ่ายช่วงเย็น / พระอาทิตย์ตก'],
  ],
}

export default function RunSheetEditor({
  rows,
  sessionType,
  errors,
  onChange,
  mk,
  disabled,
}: {
  rows: RunRowDraft[]
  sessionType: WedSessionType
  errors: Record<string, string>
  onChange: (rows: RunRowDraft[]) => void
  mk: () => string
  disabled?: boolean
}) {
  const uid = useId()
  const full = rows.length >= MAX_RUN_SHEET_ROWS
  const template = TEMPLATES[sessionType]

  function set(key: string, p: Partial<RunRowDraft>) {
    onChange(rows.map(r => (r.key === key ? { ...r, ...p } : r)))
  }

  function add() {
    if (full) return
    onChange([...rows, newRunRow(mk())])
  }

  function remove(key: string) {
    onChange(rows.filter(r => r.key !== key))
  }

  // เรียงตามเวลา (แถวไม่มีเวลาไว้ท้าย ลำดับเดิมคงไว้)
  function sortByTime() {
    const withIdx = rows.map((r, i) => ({ r, i, t: timeValue(r.time) }))
    withIdx.sort((a, b) => {
      const ta = typeof a.t === 'string' ? a.t : '99:99'
      const tb = typeof b.t === 'string' ? b.t : '99:99'
      return ta === tb ? a.i - b.i : ta.localeCompare(tb)
    })
    onChange(withIdx.map(x => x.r))
  }

  function useTemplate() {
    if (!template) return
    onChange(template.map(([time, text]) => ({ key: mk(), time, text })))
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">ยังไม่มีกำหนดการ — ใส่ฤกษ์/ลำดับพิธีให้ทีมงานและลูกค้าเห็นตรงกัน</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((r, i) => {
            const err = errors[r.key]
            const timeId = `${uid}-t${i}`
            const textId = `${uid}-x${i}`
            return (
              <li key={r.key} className="space-y-1 rounded-lg border border-gray-150 p-2 sm:border-0 sm:p-0">
                {/* มือถือ: เวลา + ปุ่มลบ บรรทัดแรก รายละเอียดเต็มความกว้างบรรทัดถัดไป (ข้อความฤกษ์ยาว) ; จอกว้าง: แถวเดียว */}
                <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
                  <label htmlFor={timeId} className="sr-only">เวลาแถวที่ {i + 1}</label>
                  <input
                    id={timeId}
                    type="time"
                    step={60}
                    className="input w-[8.5rem] shrink-0 appearance-none px-2 tabular-nums [&::-webkit-date-and-time-value]:text-left"
                    value={r.time}
                    disabled={disabled}
                    aria-invalid={err ? true : undefined}
                    onChange={e => set(r.key, { time: e.target.value })}
                  />
                  <label htmlFor={textId} className="sr-only">รายละเอียดแถวที่ {i + 1}</label>
                  <input
                    id={textId}
                    className="input order-last min-w-0 basis-full sm:order-none sm:basis-auto sm:flex-1"
                    value={r.text}
                    maxLength={MAX_RUN_TEXT}
                    placeholder="เช่น แห่ขันหมาก"
                    disabled={disabled}
                    aria-invalid={err ? true : undefined}
                    aria-describedby={err ? `${textId}-err` : undefined}
                    onChange={e => set(r.key, { text: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn-icon btn-icon-plain ml-auto shrink-0 sm:ml-0"
                    onClick={() => remove(r.key)}
                    disabled={disabled}
                    aria-label={`ลบกำหนดการแถวที่ ${i + 1}`}
                  >
                    <Trash2 {...ICON_SM} />
                  </button>
                </div>
                {err && <p id={`${textId}-err`} role="alert" className="text-sm font-medium text-red-700">{err}</p>}
              </li>
            )
          })}
        </ol>
      )}
      {errors._all && <p role="alert" className="text-sm font-medium text-red-700">{errors._all}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-dashed px-3 text-sm" onClick={add} disabled={disabled || full}>
          <Plus {...ICON_SM} />
          เพิ่มแถว
        </button>
        {rows.length > 1 && (
          <button type="button" className="btn-ghost px-3 text-sm" onClick={sortByTime} disabled={disabled}>
            <ArrowDownUp {...ICON_SM} />
            เรียงตามเวลา
          </button>
        )}
        {rows.length === 0 && template && (
          <button type="button" className="btn-ghost px-3 text-sm" onClick={useTemplate} disabled={disabled}>
            ใส่กำหนดการตัวอย่าง
          </button>
        )}
        {full && <span className="self-center text-xs text-gray-500">ครบ {MAX_RUN_SHEET_ROWS} แถวแล้ว</span>}
      </div>
    </div>
  )
}
