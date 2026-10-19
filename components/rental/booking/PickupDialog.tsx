'use client'
// ลูกค้ารับชุด (rental_pickup) — เช็กลิสต์ก่อนส่งมอบ: ตรวจบัตร · ชิ้นพร้อมเช่า (สลับชิ้นได้) · ยอดเงิน/เงินประกัน
// มีข้อควรระวัง (ค้างชำระ / ประกันไม่ครบ / ชิ้นยังไม่พร้อม / ยังไม่ถึงวันรับ) → ต้องติ๊ก "รับชุดทั้งที่มีข้อควรระวัง" + เหตุผล
// ชิ้นที่ยังอยู่กับลูกค้าการจองอื่น (actions.pickup_blockers) = รับไม่ได้เด็ดขาด ไม่มีช่องบังคับ — สลับบรรทัดนั้นไปชิ้นอื่น หรือรับคืนการจองนั้นก่อน
// ตัวเลือกสลับชิ้น = ชิ้นของชุดเดียวกัน (ไซส์ไหนก็ได้) ที่ว่างช่วงวันนี้ จาก rental_find_units (ไม่นับการจองนี้เอง)
// รับชุดซ้ำเมื่อรับไปแล้ว = เซิร์ฟเวอร์คืนข้อมูลเดิม (กดซ้ำปลอดภัย) · ไม่รู้ผล → โหลดใหม่ สถานะเป็นกำลังเช่า = สำเร็จ
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, Loader2, PackageCheck, Printer, Wallet } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht, formatThaiDate } from '@/lib/format'
import {
  UNIT_STATUS_LABELS, parseFindUnits, sizeLabel,
  type RentalBooking, type RentalBookingLine, type RentalPaymentKind,
} from '@/lib/rental'
import RentalImage from '@/components/rental/RentalImage'
import DialogShell, { DialogMessage } from './DialogShell'
import { bookingFlags, callRpc, runBookingWrite, securityShort, statusAtLeast, todayKeySafe } from './rpc'

type UnitOption = { unit_id: string; unit_code: string; size: string | null; needs_cleaning: boolean }

// สิ่งที่ติ๊ก/เลือกไว้ในป็อปอัปรับชุด — เก็บไว้ตอนกระโดดไปรับเงิน (ป็อปอัปนี้ถูกปิด) แล้วคืนให้ตอนกลับมา
interface PickupDraft {
  idChecked: boolean
  swaps: Record<string, string>
  force: boolean
  forceReason: string
  note: string
}
const pickupDrafts = new Map<string, PickupDraft>()

function lineReady(l: RentalBookingLine): string {
  if (l.unit_status !== 'available') return UNIT_STATUS_LABELS[l.unit_status]
  if (l.unit_needs_cleaning) return 'ยังไม่ได้ซัก/เตรียม'
  return ''
}

export default function PickupDialog({
  booking,
  onClose,
  onApplied,
  reload,
  onRequestPayment,
  onPrintPickup,
}: {
  booking: RentalBooking
  onClose(): void
  onApplied(b: RentalBooking, message: string): void
  reload(): Promise<RentalBooking | null>
  onRequestPayment(kind: RentalPaymentKind): void
  onPrintPickup(b: RentalBooking): void
}) {
  const supabase = useMemo(() => createClient(), [])
  const idCheckId = useId()
  const forceId = useId()
  const reasonId = useId()
  const noteId = useId()
  // อ่านครั้งเดียวตอนเปิด (แล้วลบทิ้ง — ปิดป็อปอัปแบบปกติ = เริ่มใหม่)
  const [draft0] = useState<PickupDraft | null>(() => {
    const d = pickupDrafts.get(booking.id) ?? null
    pickupDrafts.delete(booking.id)
    return d
  })
  const [idChecked, setIdChecked] = useState(draft0?.idChecked ?? false)
  const [swaps, setSwaps] = useState<Record<string, string>>(draft0?.swaps ?? {})
  const [options, setOptions] = useState<Record<string, UnitOption[]> | null>(null)
  const [optionsError, setOptionsError] = useState('')
  const [force, setForce] = useState(draft0?.force ?? false)
  const [forceReason, setForceReason] = useState(draft0?.forceReason ?? '')
  const [note, setNote] = useState(draft0?.note ?? '')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<{ text: string; tone: 'err' | 'warn' } | null>(null)
  const [done, setDone] = useState<RentalBooking | null>(null)
  // ข้อควรระวังที่เซิร์ฟเวอร์พบแต่หน้าจอไม่เห็น (เช่น มีคนเปลี่ยนสถานะชิ้นระหว่างเปิดป็อปอัป) → ต้องบังคับรับเหมือนกัน
  const [serverWarnings, setServerWarnings] = useState<string[]>([])

  const lines = useMemo(() => booking.lines.filter(l => l.status === 'booked'), [booking.lines])

  // ชิ้นว่างของชุดเดียวกันสำหรับสลับ (โหลดครั้งเดียวตอนเปิด — โหลดไม่ได้ก็ยังรับชุดได้ตามชิ้นเดิม)
  useEffect(() => {
    let alive = true
    const itemIds = Array.from(new Set(lines.map(l => l.item_id).filter(Boolean)))
    if (itemIds.length === 0) {
      setOptions({})
      return
    }
    void (async () => {
      const res = await callRpc(supabase, 'rental_find_units', {
        p_pickup: booking.pickup_date,
        p_return: booking.return_date,
        p_item_ids: itemIds,
        p_exclude_booking: booking.id,
      }, 20000)
      if (!alive) return
      if (!res.ok) {
        setOptions({})
        setOptionsError('โหลดรายการชิ้นสำหรับสลับไม่สำเร็จ — รับชุดตามชิ้นเดิมได้ตามปกติ')
        return
      }
      const found = parseFindUnits(res.data)
      const map: Record<string, UnitOption[]> = {}
      for (const it of found.items) {
        const arr: UnitOption[] = []
        for (const sz of it.sizes) {
          for (const u of sz.free_units) arr.push({ unit_id: u.unit_id, unit_code: u.unit_code, size: sz.size, needs_cleaning: u.needs_cleaning })
        }
        arr.sort((a, b) => a.unit_code.localeCompare(b.unit_code))
        map[it.item_id] = arr
      }
      setOptions(map)
    })()
    return () => { alive = false }
    // โหลดครั้งเดียวต่อการเปิด
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ชิ้นที่ "จะส่งมอบจริง" ของแต่ละบรรทัด (หลังสลับ) → ใช้คิดข้อควรระวังเรื่องชิ้นยังไม่พร้อม
  const chosen = useMemo(() => {
    return lines.map(l => {
      const swapTo = swaps[l.id]
      if (!swapTo || swapTo === l.unit_id) return { line: l, code: l.unit_code, size: l.size, problem: lineReady(l) }
      const opt = options?.[l.item_id]?.find(o => o.unit_id === swapTo)
      return {
        line: l,
        code: opt?.unit_code ?? l.unit_code,
        size: opt?.size ?? l.size,
        problem: opt?.needs_cleaning ? 'ยังไม่ได้ซัก/เตรียม' : '',
      }
    })
  }, [lines, swaps, options])

  // ข้อควรระวัง (กฎเดียวกับเซิร์ฟเวอร์ — เซิร์ฟเวอร์ตรวจซ้ำหลังสลับชิ้น)
  const m = booking.money
  const today = todayKeySafe()
  const secShort = securityShort(booking)
  const warnings: string[] = []
  if (m.due > 0.005) warnings.push(`ยังค้างชำระ ${baht(m.due)}`)
  if (secShort > 0.005) warnings.push(`ยังรับเงินประกันไม่ครบ (ขาด ${baht(secShort)})`)
  const notReady = chosen.filter(c => c.problem).map(c => `${c.code} (${c.problem})`)
  if (notReady.length) warnings.push(`ชิ้นยังไม่พร้อม: ${notReady.join(', ')}`)
  if (today && today < booking.pickup_date) warnings.push(`ยังไม่ถึงวันรับชุด (${formatThaiDate(booking.pickup_date)})`)
  // ข้อห้ามจากเซิร์ฟเวอร์ (ข้อความขึ้นต้น 'ชิ้น <รหัส> ') — บรรทัดของรหัสนั้นถูกสลับไปชิ้นอื่นแล้ว = ถือว่าแก้แล้ว (เซิร์ฟเวอร์ตรวจซ้ำหลังสลับ)
  //   หาบรรทัดเจ้าของไม่เจอ (ข้อความรูปแบบอื่น) → ถ้ามีการสลับชิ้นใดๆ ให้เซิร์ฟเวอร์ตัดสิน ไม่งั้นยังห้าม
  const blockerList = booking.actions.pickup_blockers
  const swappedAny = lines.some(l => swaps[l.id] && swaps[l.id] !== l.unit_id)
  const activeBlockers = blockerList.filter(msg => {
    const owners = lines.filter(l => l.unit_code && msg.startsWith(`ชิ้น ${l.unit_code} `))
    if (owners.length === 0) return !swappedAny
    return owners.some(l => !swaps[l.id] || swaps[l.id] === l.unit_id)
  })
  // บรรทัดที่ข้อห้ามยังมีผล (ชิ้นเดิม ยังไม่สลับ) — ใช้แสดงสถานะรายบรรทัดให้ตรงกับกล่องแดงด้านล่าง
  const lineStillOut = (l: (typeof lines)[number]) =>
    !!l.unit_code
    && (!swaps[l.id] || swaps[l.id] === l.unit_id)
    && activeBlockers.some(msg => msg.startsWith(`ชิ้น ${l.unit_code} `))
  for (const w of serverWarnings) if (!warnings.includes(w) && !blockerList.includes(w)) warnings.push(w)
  const needForce = warnings.length > 0
  const cleanReason = forceReason.trim()
  const canSubmit = !busy && activeBlockers.length === 0
    && (!needForce || (force && cleanReason.length >= 1 && cleanReason.length <= 200)) && note.trim().length <= 500
  const flags = bookingFlags(booking)
  // รอยืนยัน: รับเงินประกันได้หลังยืนยันการจองเท่านั้น → เสนอปุ่มยืนยันก่อน (ป็อปอัปนี้เปิดค้างไว้)
  const confirmFirst = booking.status === 'pending' && flags.confirm && secShort > 0.005 && !flags.securityIn

  function goPayment(kind: RentalPaymentKind) {
    pickupDrafts.set(booking.id, { idChecked, swaps, force, forceReason, note })
    onRequestPayment(kind)
  }

  async function confirmBooking() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await runBookingWrite({
        sb: supabase,
        fn: 'rental_confirm_booking',
        args: { p_booking_id: booking.id },
        reload,
        verify: fresh => statusAtLeast(fresh.status, 'confirmed'),
      })
      if (res.status === 'ok') onApplied(res.booking, 'ยืนยันการจองแล้ว — รับเงินประกันได้แล้ว')
      else setError({ text: res.message, tone: res.status === 'unsure' ? 'warn' : 'err' })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function submit() {
    if (busyRef.current || !canSubmit) return
    const unitSwaps = lines
      .filter(l => swaps[l.id] && swaps[l.id] !== l.unit_id)
      .map(l => ({ line_id: l.id, unit_id: swaps[l.id] }))
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await runBookingWrite({
        sb: supabase,
        fn: 'rental_pickup',
        args: {
          p_booking_id: booking.id,
          p_payload: {
            id_checked: idChecked,
            note: note.trim() || null,
            force: needForce ? force : false,
            force_reason: needForce && force ? cleanReason : null,
            unit_swaps: unitSwaps,
          },
        },
        reload,
        verify: fresh => statusAtLeast(fresh.status, 'picked_up'),
      })
      if (res.status === 'ok') {
        onApplied(res.booking, 'บันทึกลูกค้ารับชุดแล้ว')
        setDone(res.booking)
      } else {
        // 'รับชุดไม่ได้: A / B — ถ้าต้องการให้รับ ให้กดยืนยันแบบบังคับ...' → เปิดช่องบังคับพร้อมรายการจากเซิร์ฟเวอร์
        if (res.status === 'rejected' && !needForce && res.message.includes('บังคับ')) {
          const m = /รับชุดไม่ได้:\s*(.+?)\s+—/.exec(res.message)
          setServerWarnings(m ? m[1].split(' / ').map(x => x.trim()).filter(Boolean) : ['เซิร์ฟเวอร์พบข้อควรระวังก่อนรับชุด'])
        }
        setError({ text: res.message, tone: res.status === 'unsure' ? 'warn' : 'err' })
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  if (done) {
    return (
      <DialogShell
        title="ลูกค้ารับชุดแล้ว"
        subtitle={`การจอง ${done.booking_no}`}
        icon={<CheckCircle2 {...ICON_SM} />}
        tone="ok"
        onClose={onClose}
        footer={
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary px-4" onClick={() => onPrintPickup(done)}>
              <Printer {...ICON_SM} />
              พิมพ์ใบส่งมอบชุด
            </button>
            <button type="button" className="btn-primary flex-1 min-w-[140px]" onClick={onClose} autoFocus>เสร็จสิ้น</button>
          </div>
        }
      >
        <div aria-live="polite" className="space-y-3 text-sm text-gray-700">
          <p>กำหนดคืนชุด <span className="font-semibold text-gray-900">{formatThaiDate(done.return_date)}</span></p>
          <ul className="panel divide-y divide-gray-200 px-3.5">
            {done.lines.map(l => (
              <li key={l.id} className="flex justify-between gap-3 py-2">
                <span className="min-w-0 break-words text-gray-900">{l.item_name} · {sizeLabel(l.size)}</span>
                <span className="shrink-0 font-mono text-xs text-gray-700">{l.unit_code}</span>
              </li>
            ))}
          </ul>
        </div>
      </DialogShell>
    )
  }

  return (
    <DialogShell
      title="ลูกค้ารับชุด"
      subtitle={`การจอง ${booking.booking_no} · ${booking.customer.name}`}
      icon={<PackageCheck {...ICON_SM} />}
      busy={busy}
      wide
      onClose={onClose}
      footer={
        <>
          {error && <DialogMessage tone={error.tone} text={error.text} />}
          <div className="flex gap-2 sm:justify-end">
            <button type="button" onClick={onClose} disabled={busy} className="btn-secondary px-5">ยกเลิก</button>
            <button type="button" onClick={submit} disabled={!canSubmit} className={clsx(needForce ? 'btn-danger' : 'btn-primary', 'flex-1 sm:flex-none sm:min-w-[200px]')}>
              {busy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <PackageCheck {...ICON_SM} />}
              {busy ? 'กำลังบันทึก...' : needForce ? 'ยืนยันรับชุด (บังคับ)' : 'ยืนยันลูกค้ารับชุด'}
            </button>
          </div>
        </>
      }
    >
      {booking.status === 'pending' && (
        <DialogMessage tone="info" text="การจองนี้ยังรอยืนยัน — บันทึกรับชุดแล้วระบบยืนยันการจองให้อัตโนมัติ" />
      )}

      <label htmlFor={idCheckId} className="panel flex items-start gap-3 p-3 min-h-[44px] cursor-pointer select-none">
        <input
          id={idCheckId}
          type="checkbox"
          checked={idChecked}
          disabled={busy}
          onChange={e => setIdChecked(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
        />
        <span className="min-w-0 text-sm">
          <span className="font-medium text-gray-900">ตรวจบัตรประชาชน / พาสปอร์ตตัวจริงแล้ว</span>
          <span className="block text-xs text-gray-500">ชื่อตรงกับผู้เช่า: {booking.customer.name}</span>
        </span>
      </label>

      <div>
        <p className="field-label">ชิ้นชุดที่ส่งมอบ</p>
        <ul className="space-y-2">
          {lines.map(l => {
            const c = chosen.find(x => x.line.id === l.id)
            const opts = options?.[l.item_id] ?? []
            // ชิ้นเดิมต้องอยู่ในตัวเลือกเสมอ (แม้ไม่อยู่ในผลค้นหา เช่น ยังไม่ได้ซัก/ส่งซ่อม)
            const all = opts.some(o => o.unit_id === l.unit_id)
              ? opts
              : [{ unit_id: l.unit_id, unit_code: l.unit_code, size: l.size, needs_cleaning: l.unit_needs_cleaning }, ...opts]
            const selectId = `swap-${l.id}`
            // ชิ้นเดิมของบรรทัดนี้ยังอยู่กับลูกค้าการจองอื่น (ข้อห้ามจากเซิร์ฟเวอร์ ยังไม่ได้สลับ) → ห้ามขึ้น "พร้อมส่งมอบ"
            const stillOut = lineStillOut(l)
            return (
              <li key={l.id} className="panel p-3 space-y-2">
                <div className="flex items-start gap-3">
                  <RentalImage path={l.cover_path} alt="" className="h-14 w-12 shrink-0 rounded-lg border border-gray-200" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 break-words">{l.item_name}</p>
                    <p className="text-xs text-gray-500">{l.item_code} · จองไซส์ {sizeLabel(l.size)}</p>
                    {stillOut ? (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-red-700">
                        <AlertTriangle {...ICON_XS} />
                        {l.unit_code}: ยังอยู่กับลูกค้าการจองอื่น
                      </p>
                    ) : c?.problem ? (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-800">
                        <AlertTriangle {...ICON_XS} />
                        {c.code}: {c.problem}
                      </p>
                    ) : (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-green-800">
                        <CheckCircle2 {...ICON_XS} />
                        {c?.code ?? l.unit_code} พร้อมส่งมอบ
                      </p>
                    )}
                  </div>
                </div>
                <div>
                  <label htmlFor={selectId} className="sr-only">ชิ้นที่ส่งมอบของ {l.item_name}</label>
                  <select
                    id={selectId}
                    className="input"
                    value={swaps[l.id] ?? l.unit_id}
                    disabled={busy || options === null}
                    onChange={e => setSwaps(prev => ({ ...prev, [l.id]: e.target.value }))}
                  >
                    {all.map(o => (
                      <option key={o.unit_id} value={o.unit_id}>
                        {o.unit_code} · {sizeLabel(o.size)}{o.unit_id === l.unit_id ? ' (เดิม)' : ''}{o.needs_cleaning ? ' · ยังไม่ซัก' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            )
          })}
        </ul>
        {options === null && <p className="field-hint">กำลังโหลดชิ้นที่สลับได้...</p>}
        {optionsError && <p className="field-hint text-amber-800">{optionsError}</p>}
      </div>

      {activeBlockers.length > 0 && (
        <div role="alert" className="alert-err">
          <AlertTriangle {...ICON_SM} />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">ยังส่งมอบไม่ได้ (กดบังคับก็ไม่ได้)</p>
            <ul className="list-disc pl-4 space-y-0.5">
              {activeBlockers.map(w => <li key={w}>{w}</li>)}
            </ul>
            <p>สลับบรรทัดนั้นไปชิ้นอื่นที่ว่างด้านบน หรือบันทึกรับคืนการจองที่ยังไม่คืนก่อน แล้วเปิดหน้านี้ใหม่</p>
          </div>
        </div>
      )}

      {needForce ? (
        <div className="space-y-3">
          <div role="alert" className="alert-warn">
            <AlertTriangle {...ICON_SM} />
            <div className="min-w-0 space-y-1">
              <p className="font-semibold">ข้อควรระวังก่อนส่งมอบ</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {warnings.map(w => <li key={w}>{w}</li>)}
              </ul>
              {(flags.pay || flags.securityIn || confirmFirst) && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {flags.pay && m.due > 0.005 && (
                    <button type="button" className="btn-secondary min-h-[40px] px-3 text-sm" disabled={busy} onClick={() => goPayment('payment')}>
                      <Wallet {...ICON_XS} />
                      รับชำระก่อน
                    </button>
                  )}
                  {flags.securityIn && secShort > 0.005 && (
                    <button type="button" className="btn-secondary min-h-[40px] px-3 text-sm" disabled={busy} onClick={() => goPayment('security_in')}>
                      <Wallet {...ICON_XS} />
                      รับเงินประกันก่อน
                    </button>
                  )}
                  {confirmFirst && (
                    <button type="button" className="btn-secondary min-h-[40px] px-3 text-sm" disabled={busy} onClick={() => void confirmBooking()}>
                      <CheckCircle2 {...ICON_XS} />
                      ยืนยันการจองก่อน (แล้วรับเงินประกันได้)
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          <label htmlFor={forceId} className="panel flex items-start gap-3 p-3 min-h-[44px] cursor-pointer select-none">
            <input
              id={forceId}
              type="checkbox"
              checked={force}
              disabled={busy}
              onChange={e => setForce(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
            />
            <span className="min-w-0 text-sm font-medium text-gray-900">รับชุดทั้งที่มีข้อควรระวัง (บันทึกเหตุผลไว้ในประวัติ)</span>
          </label>
          {force && (
            <div>
              <label htmlFor={reasonId} className="field-label">เหตุผล *</label>
              <input
                id={reasonId}
                className="input"
                value={forceReason}
                maxLength={200}
                disabled={busy}
                autoComplete="off"
                placeholder="เช่น ลูกค้าโอนส่วนที่เหลือคืนนี้ / ผู้จัดการอนุมัติ"
                onChange={e => setForceReason(e.target.value)}
              />
            </div>
          )}
        </div>
      ) : activeBlockers.length === 0 ? (
        <DialogMessage tone="ok" text="ยอดเงินและเงินประกันครบ ชิ้นชุดพร้อมส่งมอบ" />
      ) : null}

      <div>
        <label htmlFor={noteId} className="field-label">หมายเหตุการรับชุด</label>
        <input
          id={noteId}
          className="input"
          value={note}
          maxLength={500}
          disabled={busy}
          autoComplete="off"
          placeholder="เช่น มีรอยเล็กที่ชายกระโปรง ลูกค้ารับทราบ"
          onChange={e => setNote(e.target.value)}
        />
      </div>
    </DialogShell>
  )
}
