'use client'
// ป็อปอัปเลือกช่วงวันที่ (ตั้งแต่ – ถึง) สำหรับส่งออกไฟล์ CSV — ใช้ร่วมกันหลายหน้า (ประวัติสต๊อก / รายงานขาย)
// ค่าที่ส่งออกไปเป็น day key 'YYYY-MM-DD' (ปี ค.ศ.) ตามปฏิทินเวลาไทย ตรงกับพารามิเตอร์ p_from / p_to ของ RPC ส่งออก
// ช่องวันที่ของเบราว์เซอร์อาจแสดงปี ค.ศ. ตามภาษาเครื่อง → ใต้ช่องแสดงวันที่ พ.ศ. ให้อ่านตรงกันเสมอ
// ป็อปอัปไม่ปิดตัวเอง: ผู้เรียกปิด (open=false) เมื่อดาวน์โหลดสำเร็จ / แสดง error ผ่าน prop error แล้วค้างไว้ให้แก้ช่วงวันที่
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { AlertCircle, CalendarRange, Download, Loader2, X } from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { addDaysToKey, bangkokTodayKey, daysBetweenKeys, formatThaiDate, isDayKey, thaiError } from '@/lib/format'

export interface DateRangeDialogProps {
  open: boolean
  title: string
  onClose: () => void
  /** กดยืนยันเมื่อช่วงวันที่ถูกต้องแล้ว (fromKey <= toKey, ไม่เกิน maxDays วัน, ไม่เกินวันนี้) */
  onConfirm: (fromKey: string, toKey: string) => Promise<void> | void
  busy?: boolean
  error?: string | null
  /** จำนวนวันสูงสุดที่เลือกได้ (นับรวมวันแรกและวันสุดท้าย) — ค่าเริ่มต้น 366 = 1 ปี ตรงกับที่ฐานข้อมูลยอม */
  maxDays?: number
  // ----- ไม่บังคับ (ส่วนเสริม) -----
  /** คำอธิบายสั้นใต้หัวเรื่อง เช่น ไฟล์จะมีคอลัมน์อะไรบ้าง */
  description?: string
  /** ข้อความบนปุ่มยืนยัน (ค่าเริ่มต้น 'ดาวน์โหลด CSV') */
  confirmLabel?: string
  /** ความคืบหน้าระหว่างทำงาน เช่น 'ดึงข้อมูลแล้ว 2,000 รายการ...' (อ่านออกเสียงให้โปรแกรมอ่านจอ) */
  progress?: string | null
}

type PresetKey = 'today' | '7d' | 'month' | 'prevMonth'

const PRESETS: readonly { key: PresetKey; label: string }[] = [
  { key: 'today', label: 'วันนี้' },
  { key: '7d', label: '7 วัน' },
  { key: 'month', label: 'เดือนนี้' },
  { key: 'prevMonth', label: 'เดือนก่อน' },
]

const DEFAULT_PRESET: PresetKey = 'month'

// วันแรกของเดือนจาก day key ('2026-10-05' → '2026-10-01')
function monthStart(dayKey: string): string {
  return `${dayKey.slice(0, 8)}01`
}

/** ช่วงวันที่ของปุ่มลัด (คิดจาก "วันนี้" ตามเวลาไทย) */
function presetRange(key: PresetKey, today: string): { from: string; to: string } {
  switch (key) {
    case 'today':
      return { from: today, to: today }
    case '7d':
      // 7 วันรวมวันนี้ = ย้อนหลัง 6 วัน
      return { from: addDaysToKey(today, -6), to: today }
    case 'prevMonth': {
      const lastOfPrev = addDaysToKey(monthStart(today), -1)
      return { from: monthStart(lastOfPrev), to: lastOfPrev }
    }
    case 'month':
    default:
      return { from: monthStart(today), to: today }
  }
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US')
}

// ตรวจช่วงวันที่ → ข้อความภาษาไทย หรือ null เมื่อถูกต้อง (เทียบ day key แบบสตริงได้เพราะเป็น YYYY-MM-DD)
function rangeProblem(from: string, to: string, today: string, maxDays: number): string | null {
  if (!isDayKey(from)) return 'กรุณาเลือกวันที่เริ่มต้น'
  if (!isDayKey(to)) return 'กรุณาเลือกวันที่สิ้นสุด'
  if (from > to) return 'วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด'
  if (to > today) return 'เลือกได้ถึงวันนี้เท่านั้น'
  const days = daysBetweenKeys(from, to) + 1
  if (days > maxDays) {
    const cap = maxDays === 366 ? ' (สูงสุด 1 ปี)' : ''
    return `เลือกช่วงได้ไม่เกิน ${fmtInt(maxDays)} วัน${cap} — ตอนนี้เลือกไว้ ${fmtInt(days)} วัน`
  }
  return null
}

function DateRangeDialog({
  open,
  title,
  onClose,
  onConfirm,
  busy = false,
  error = null,
  maxDays = 366,
  description,
  confirmLabel = 'ดาวน์โหลด CSV',
  progress = null,
}: DateRangeDialogProps) {
  const limit = Number.isFinite(maxDays) && maxDays >= 1 ? Math.floor(maxDays) : 366
  const [today, setToday] = useState(() => bangkokTodayKey())
  const [from, setFrom] = useState(() => presetRange(DEFAULT_PRESET, bangkokTodayKey()).from)
  const [to, setTo] = useState(() => presetRange(DEFAULT_PRESET, bangkokTodayKey()).to)
  // error จาก onConfirm ที่ throw ออกมาเอง (ปกติผู้เรียกจัดการ error ผ่าน prop error)
  const [localError, setLocalError] = useState<string | null>(null)
  const submittingRef = useRef(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descId = useId()
  const fromId = useId()
  const toId = useId()
  const fromHintId = useId()
  const toHintId = useId()
  const problemId = useId()

  // เปิดใหม่: อัปเดต "วันนี้" (เผื่อเปิดหน้าค้างข้ามวัน) · ช่วงเดิมเกินวันนี้/ผิดรูปแบบ → กลับไปค่าเริ่มต้น
  // จำโฟกัสเดิมไว้คืนตอนปิด แล้วย้ายโฟกัสเข้าป็อปอัป (ไม่โฟกัสช่องวันที่ — มือถือจะเด้งปฏิทินขึ้นมาเอง)
  useEffect(() => {
    if (!open) return
    const now = bangkokTodayKey()
    setToday(now)
    setLocalError(null)
    setFrom(prevFrom => {
      const keep = isDayKey(prevFrom) && prevFrom <= now
      return keep ? prevFrom : presetRange(DEFAULT_PRESET, now).from
    })
    setTo(prevTo => {
      const keep = isDayKey(prevTo) && prevTo <= now
      return keep ? prevTo : presetRange(DEFAULT_PRESET, now).to
    })
    returnFocusRef.current = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
    const raf = requestAnimationFrame(() => panelRef.current?.focus())
    return () => {
      cancelAnimationFrame(raf)
      const el = returnFocusRef.current
      returnFocusRef.current = null
      // คืนโฟกัสให้ปุ่มที่เปิดป็อปอัป (ถ้ายังอยู่ในหน้า)
      if (el && typeof el.focus === 'function' && document.contains(el)) {
        try { el.focus() } catch { /* ignore */ }
      }
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  const problem = rangeProblem(from, to, today, limit)
  const days = isDayKey(from) && isDayKey(to) && from <= to ? daysBetweenKeys(from, to) + 1 : 0
  const shownError = error || localError
  const canConfirm = !busy && problem === null

  function applyPreset(key: PresetKey) {
    const r = presetRange(key, today)
    setFrom(r.from)
    setTo(r.to)
    setLocalError(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy || submittingRef.current || problem !== null) return
    submittingRef.current = true
    setLocalError(null)
    try {
      await onConfirm(from, to)
    } catch (err) {
      setLocalError(thaiError(err))
    } finally {
      submittingRef.current = false
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 !mt-0 flex items-end sm:items-center justify-center scrim sm:p-4"
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className="sheet w-full max-w-lg max-h-[90dvh] overflow-y-auto overscroll-contain rounded-b-none border-b-0 sm:rounded-4xl sm:border-b animate-fade-up focus:outline-none"
      >
        <form onSubmit={handleSubmit} noValidate>
          {/* หัว (ติดด้านบนเวลาเลื่อน) */}
          <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="icon-bubble"><CalendarRange {...ICON} /></span>
              <div className="min-w-0">
                <h3 id={titleId} className="text-lg font-semibold leading-snug text-gray-900 break-words">{title}</h3>
                {description && <p id={descId} className="text-xs text-gray-500 mt-0.5 break-words">{description}</p>}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="btn-icon btn-icon-plain -mr-2"
              aria-label="ปิด"
            >
              <X {...ICON} />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            {/* ปุ่มลัด — ปุ่มที่ตรงกับช่วงที่เลือกอยู่จะถูกไฮไลต์ */}
            <fieldset>
              <legend className="field-label">เลือกเร็ว</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PRESETS.map(p => {
                  const r = presetRange(p.key, today)
                  const active = r.from === from && r.to === to
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => applyPreset(p.key)}
                      disabled={busy}
                      aria-pressed={active}
                      className="chip-toggle w-full"
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>
            </fieldset>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor={fromId} className="field-label">ตั้งแต่วันที่</label>
                <input
                  id={fromId}
                  type="date"
                  className="input block min-w-0 appearance-none tabular-nums [&::-webkit-date-and-time-value]:text-left"
                  value={from}
                  max={today}
                  placeholder="YYYY-MM-DD"
                  disabled={busy}
                  required
                  aria-invalid={problem !== null && (!isDayKey(from) || from > to) ? true : undefined}
                  aria-describedby={`${fromHintId}${problem ? ` ${problemId}` : ''}`}
                  onChange={e => { setFrom(e.target.value); setLocalError(null) }}
                />
                <p id={fromHintId} className="field-hint tabular-nums">
                  {isDayKey(from) ? `พ.ศ. ${formatThaiDate(from)}` : 'ยังไม่ได้เลือกวันที่'}
                </p>
              </div>
              <div className="min-w-0">
                <label htmlFor={toId} className="field-label">ถึงวันที่</label>
                <input
                  id={toId}
                  type="date"
                  className="input block min-w-0 appearance-none tabular-nums [&::-webkit-date-and-time-value]:text-left"
                  value={to}
                  min={isDayKey(from) ? from : undefined}
                  max={today}
                  placeholder="YYYY-MM-DD"
                  disabled={busy}
                  required
                  aria-invalid={problem !== null && (!isDayKey(to) || to > today || from > to) ? true : undefined}
                  aria-describedby={`${toHintId}${problem ? ` ${problemId}` : ''}`}
                  onChange={e => { setTo(e.target.value); setLocalError(null) }}
                />
                <p id={toHintId} className="field-hint tabular-nums">
                  {isDayKey(to) ? `พ.ศ. ${formatThaiDate(to)}` : 'ยังไม่ได้เลือกวันที่'}
                </p>
              </div>
            </div>

            <div aria-live="polite" className="space-y-2">
              {problem ? (
                <p id={problemId} className="flex items-start gap-1.5 text-sm text-red-700">
                  <AlertCircle {...ICON_SM} className="mt-px shrink-0" />
                  <span className="min-w-0 break-words">{problem}</span>
                </p>
              ) : (
                <p className="text-sm text-gray-600 tabular-nums">
                  รวม <span className="font-semibold text-gray-900">{fmtInt(days)}</span> วัน
                  {' · '}เลือกได้สูงสุด {fmtInt(limit)} วัน
                </p>
              )}
              {/* ช่วงที่รวมวันนี้: ไฟล์ดึงทีละ 1,000 แถว ถ้ามีขาย/คืน/ปรับสต๊อกเข้ามาระหว่างดึง ตัวเลขของวันนี้อาจขยับ
                  (ข้อมูลวันก่อนๆ นิ่งแล้ว) → บอกไว้ก่อน ให้ส่งออกตอนร้านว่างหรือหลังปิดร้านถ้าต้องการยอดที่ตรงเป๊ะ */}
              {!problem && to === today && (
                <p className="field-hint">
                  ช่วงนี้รวมวันนี้ — ยอดของวันนี้ยังเปลี่ยนได้ระหว่างส่งออก (ถ้ามีการขาย/คืนสินค้า/ปรับสต๊อกเข้ามาพอดี)
                  ถ้าต้องการตัวเลขที่นิ่ง ให้ส่งออกหลังปิดร้าน
                </p>
              )}
              {busy && progress && (
                <p className="flex items-center gap-2 text-sm text-gray-700">
                  <Loader2 {...ICON_SM} className="animate-spin shrink-0" />
                  <span className="min-w-0 break-words">{progress}</span>
                </p>
              )}
            </div>
          </div>

          {/* ท้าย (ติดด้านล่าง — ปุ่มและข้อความผิดพลาดมองเห็นเสมอ) */}
          <div
            className="sticky bottom-0 z-10 bg-white border-t border-gray-200 px-5 pt-3 space-y-2"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            {shownError && (
              <div role="alert" className="alert-err">
                <AlertCircle {...ICON_SM} />
                <p className="min-w-0 break-words">{shownError}</p>
              </div>
            )}
            <div className="flex gap-2 sm:justify-end">
              <button type="button" onClick={onClose} disabled={busy} className="btn-secondary">
                ยกเลิก
              </button>
              <button type="submit" disabled={!canConfirm} className="btn-primary flex-1 sm:flex-none sm:min-w-[180px]">
                {busy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Download {...ICON_SM} />}
                {busy ? 'กำลังเตรียมไฟล์...' : confirmLabel}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

export default DateRangeDialog
export { DateRangeDialog }
