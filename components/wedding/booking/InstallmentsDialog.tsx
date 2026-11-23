'use client'
// แก้งวดชำระของงาน (wed_set_installments) — 1 ถึง 12 งวด ยอดรวมทุกงวดต้องเท่ากับยอดสุทธิพอดี (เซิร์ฟเวอร์ตรวจซ้ำ)
// เงินที่รับแล้วไล่ตัดงวดแรกก่อนเสมอ (สถานะงวดคิดใหม่จากยอดชำระสะสม) → แก้งวดที่จ่ายแล้วได้โดยเงินไม่หาย
// หลังแก้เอง: ยอดสุทธิเปลี่ยนภายหลัง (เพิ่มค่าใช้จ่าย/แก้แพ็กเกจ) งวดสุดท้ายที่ยังค้างรับส่วนต่างอัตโนมัติ
// บันทึกซ้ำได้ปลอดภัย (แทนที่ทั้งชุดด้วยค่าเดิม) — ไม่รู้ผลให้ดูจากงวดในข้อมูลล่าสุด
import { useId, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { CalendarClock, Loader2, Plus, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht, formatThaiDate, isDayKey } from '@/lib/format'
import { parseMoneyInput, round2 } from '@/lib/money'
import { INSTALLMENT_STATUS_CHIP, INSTALLMENT_STATUS_LABELS, MAX_WED_MONEY, type WedBooking } from '@/lib/wedding'
import DialogShell, { DialogMessage } from '@/components/rental/booking/DialogShell'
import { EPS, runWedWrite } from './rpc'

const MAX_ROWS = 12
const MAX_LABEL = 60

interface Row {
  key: string
  label: string
  due: string
  amount: string
}

let rowSeq = 0
function rowKey(): string {
  rowSeq += 1
  return `r${rowSeq}`
}

function moneyText(n: number): string {
  return n > 0 ? String(round2(n)) : ''
}

export default function InstallmentsDialog({
  booking,
  onClose,
  onApplied,
  reload,
}: {
  booking: WedBooking
  onClose(): void
  onApplied(b: WedBooking, message: string): void
  reload(): Promise<WedBooking | null>
}) {
  const supabase = useMemo(() => createClient(), [])
  const baseId = useId()
  const total = booking.money.grand_total
  const [rows, setRows] = useState<Row[]>(() => {
    if (booking.installments.length > 0) {
      return booking.installments.map(i => ({ key: rowKey(), label: i.label, due: i.due_date ?? '', amount: moneyText(i.amount) }))
    }
    return [{ key: rowKey(), label: 'ยอดชำระทั้งหมด', due: booking.money.balance_due_date ?? '', amount: moneyText(total) }]
  })
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<{ text: string; tone: 'err' | 'warn' } | null>(null)

  const parsedRows = rows.map(r => ({ ...r, value: parseMoneyInput(r.amount) }))
  const sum = round2(parsedRows.reduce((s, r) => s + (r.value !== null && r.value > 0 ? r.value : 0), 0))
  const diff = round2(total - sum)
  const rowErrors = parsedRows.map(r => {
    if (r.label.trim().length > MAX_LABEL) return `ชื่องวดไม่เกิน ${MAX_LABEL} ตัวอักษร`
    if (r.due !== '' && !isDayKey(r.due)) return 'วันที่ไม่ถูกต้อง'
    if (r.amount.trim() === '') return 'ใส่ยอดงวดนี้'
    if (r.value === null) return 'ยอดต้องเป็นตัวเลข'
    if (r.value <= 0) return 'ยอดต้องมากกว่า 0'
    if (r.value > MAX_WED_MONEY) return 'ยอดสูงเกินไป'
    return ''
  })
  const sumOk = Math.abs(diff) < EPS
  const canSubmit = !busy && rows.length >= 1 && rows.length <= MAX_ROWS && rowErrors.every(e => e === '') && sumOk

  function update(key: string, patch: Partial<Row>) {
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)))
    setError(null)
  }

  function addRow() {
    if (rows.length >= MAX_ROWS) return
    setRows(rs => [...rs, { key: rowKey(), label: `งวดที่ ${rs.length + 1}`, due: '', amount: diff > EPS ? moneyText(diff) : '' }])
  }

  function removeRow(key: string) {
    setRows(rs => (rs.length <= 1 ? rs : rs.filter(r => r.key !== key)))
  }

  // ส่วนต่างทั้งหมดไปที่งวดสุดท้าย (ใช้บ่อย: แก้ยอดงวดแรกแล้วให้งวดสุดท้ายเป็นยอดที่เหลือ)
  function fillLast() {
    setRows(rs => {
      if (rs.length === 0) return rs
      const others = round2(rs.slice(0, -1).reduce((s, r) => {
        const v = parseMoneyInput(r.amount)
        return s + (v !== null && v > 0 ? v : 0)
      }, 0))
      const rest = round2(total - others)
      if (rest <= EPS) return rs
      const last = rs[rs.length - 1]
      return [...rs.slice(0, -1), { ...last, amount: moneyText(rest) }]
    })
  }

  // แบ่งเท่าๆ กันตามจำนวนงวดที่มี (เศษสตางค์ไปที่งวดสุดท้าย)
  function splitEven() {
    setRows(rs => {
      const n = rs.length
      if (n === 0 || total <= EPS) return rs
      const each = Math.floor((total / n) * 100) / 100
      return rs.map((r, i) => ({ ...r, amount: moneyText(i === n - 1 ? round2(total - each * (n - 1)) : each) }))
    })
  }

  async function submit() {
    if (busyRef.current || !canSubmit) return
    const items = parsedRows.map((r, i) => ({
      label: r.label.trim() || `งวดที่ ${i + 1}`,
      due_date: r.due || null,
      amount: r.value ?? 0,
    }))
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await runWedWrite({
        sb: supabase,
        fn: 'wed_set_installments',
        args: { p_booking_id: booking.id, p_items: items },
        reload,
        verify: fresh => fresh.installments_custom
          && fresh.installments.length === items.length
          && fresh.installments.every((x, i) => Math.abs(x.amount - items[i].amount) < EPS && (x.due_date ?? null) === items[i].due_date),
      })
      if (res.status === 'ok') {
        onApplied(res.booking, `บันทึกงวดชำระ ${items.length} งวดแล้ว`)
        onClose()
        return
      }
      setError({ text: res.message, tone: res.status === 'unsure' ? 'warn' : 'err' })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const current = booking.installments
  return (
    <DialogShell
      title="แก้งวดชำระ"
      subtitle={`${booking.booking_no} · ยอดสุทธิ ${baht(total)}`}
      icon={<CalendarClock {...ICON_SM} />}
      busy={busy}
      wide
      onClose={onClose}
      footer={
        <>
          <div
            className={clsx('flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm',
              sumOk ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800')}
            aria-live="polite"
          >
            <span>รวม {rows.length} งวด <span className="money">{baht(sum)}</span></span>
            <span className="font-semibold">
              {sumOk ? 'ตรงกับยอดสุทธิ' : diff > 0 ? `ขาดอีก ${baht(diff)}` : `เกิน ${baht(-diff)}`}
            </span>
          </div>
          {error && <DialogMessage tone={error.tone} text={error.text} />}
          <div className="flex gap-2 sm:justify-end">
            <button type="button" onClick={onClose} disabled={busy} className="btn-secondary px-5">ยกเลิก</button>
            <button type="button" onClick={submit} disabled={!canSubmit} className="btn-primary flex-1 sm:flex-none sm:min-w-[180px]">
              {busy && <Loader2 {...ICON_SM} className="animate-spin" />}
              {busy ? 'กำลังบันทึก...' : 'บันทึกงวดชำระ'}
            </button>
          </div>
        </>
      }
    >
      <p className="text-sm text-gray-700">
        ยอดรวมทุกงวดต้องเท่ากับยอดสุทธิ <span className="money text-gray-900">{baht(total)}</span> · ชำระแล้ว <span className="money text-gray-900">{baht(booking.money.paid)}</span> (ตัดงวดแรกก่อน)
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-soft min-h-[40px] px-3 text-sm" onClick={fillLast} disabled={busy || rows.length === 0}>
          ยอดที่เหลือไว้งวดสุดท้าย
        </button>
        <button type="button" className="btn-soft min-h-[40px] px-3 text-sm" onClick={splitEven} disabled={busy}>
          แบ่งเท่าๆ กัน
        </button>
      </div>

      <ol className="space-y-3">
        {rows.map((r, i) => {
          const cur = current[i]
          const err = rowErrors[i]
          return (
            <li key={r.key} className="panel p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">งวดที่ {i + 1}</p>
                <div className="flex items-center gap-1.5">
                  {cur && <span className={INSTALLMENT_STATUS_CHIP[cur.status]}>{INSTALLMENT_STATUS_LABELS[cur.status]}</span>}
                  <button
                    type="button"
                    className="btn-icon btn-icon-plain"
                    aria-label={`ลบงวดที่ ${i + 1}`}
                    disabled={busy || rows.length <= 1}
                    onClick={() => removeRow(r.key)}
                  >
                    <Trash2 {...ICON_SM} />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_160px_150px]">
                <div>
                  <label htmlFor={`${baseId}-l-${r.key}`} className="sr-only">ชื่องวดที่ {i + 1}</label>
                  <input
                    id={`${baseId}-l-${r.key}`}
                    className="input"
                    value={r.label}
                    maxLength={MAX_LABEL}
                    placeholder="ชื่องวด เช่น มัดจำ / งวดที่ 2"
                    disabled={busy}
                    onChange={e => update(r.key, { label: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor={`${baseId}-d-${r.key}`} className="sr-only">วันครบกำหนดงวดที่ {i + 1}</label>
                  <input
                    id={`${baseId}-d-${r.key}`}
                    type="date"
                    className="input"
                    value={r.due}
                    disabled={busy}
                    onChange={e => update(r.key, { due: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor={`${baseId}-a-${r.key}`} className="sr-only">ยอดงวดที่ {i + 1} (บาท)</label>
                  <input
                    id={`${baseId}-a-${r.key}`}
                    className="input text-right tabular-nums font-semibold"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="ยอด (บาท)"
                    value={r.amount}
                    disabled={busy}
                    aria-invalid={err !== ''}
                    onChange={e => update(r.key, { amount: e.target.value })}
                  />
                </div>
              </div>
              <p className={clsx('text-xs', err ? 'text-red-700 font-medium' : 'text-gray-500')}>
                {err || (r.due ? `ครบกำหนด ${formatThaiDate(r.due)}` : 'ไม่ระบุวันครบกำหนด')}
              </p>
            </li>
          )
        })}
      </ol>
      <button type="button" className="btn-dashed w-full" onClick={addRow} disabled={busy || rows.length >= MAX_ROWS}>
        <Plus {...ICON_XS} />
        เพิ่มงวด{rows.length >= MAX_ROWS ? ` (สูงสุด ${MAX_ROWS} งวด)` : ''}
      </button>
    </DialogShell>
  )
}
