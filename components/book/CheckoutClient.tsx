'use client'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  AlertTriangle, CalendarDays, CheckCircle2, ClipboardList, FileText, Loader2, Send, ShoppingBag, Trash2,
  UserRound, XCircle,
} from 'lucide-react'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { addDaysToKey, baht, isDayKey } from '@/lib/format'
import { round2 } from '@/lib/money'
import {
  bookingStatusPath, linePrice, MAX_PUBLIC_LINES, phoneDigits, rentalDays, sizeKey, sizeLabel, type PublicInfo,
} from '@/lib/rental'
import { fetchAvailability, isClientIdTaken, submitPublicRequest, type ApiFail } from '@/components/book/api'
import {
  beginCartSend, clearCart, rememberBooking, removeCartLine, resetCartClientId, setCartDates, useBookCart,
  type CartLine,
} from '@/components/book/cart'
import { itemHref } from '@/components/book/catalogQuery'
import { earliestPickup, eachDay, latestReturn, rangeProblem, shortDay } from '@/components/book/dates'
import RentalImage from '@/components/rental/RentalImage'
import TermsDialog from '@/components/book/TermsDialog'
import RecentBookings from '@/components/book/RecentBookings'

// หน้าส่งคำขอจอง /book/checkout (ฝั่งเบราว์เซอร์)
// 1) รายการชุดในตะกร้า + วันรับ–คืน (แก้วันได้ที่นี่ ใช้กับทุกชุด) + ตรวจวันว่างของแต่ละชุด/ไซส์ซ้ำก่อนส่ง
// 2) ประมาณการค่าเช่า / มัดจำ / ค่าประกัน (ยอดจริงฐานข้อมูลคำนวณเอง)
// 3) ข้อมูลผู้จอง + ยินยอม PDPA + ยอมรับเงื่อนไข (อ่านเงื่อนไขในป็อปอัป) + ช่องดักบอท website (ซ่อน)
// 4) ส่งผ่าน POST /api/book/request (จำกัดครั้งต่อ IP → rental_public_request ด้วย service role) พร้อม client_id ที่เก็บในตะกร้าจนกว่าจะสำเร็จ → กดซ้ำ/เน็ตหลุดแล้วส่งใหม่ ไม่เกิดคำขอซ้อน
//    สำเร็จ → ล้างตะกร้า จำลิงก์สถานะไว้ในเครื่อง แล้วไปหน้าสถานะการจอง (?new=1 ใหม่ / ?new=2 เคยส่งไว้แล้ว)

type Props = { info: PublicInfo; todayKey: string }

type Draft = {
  name: string
  phone: string
  line_id: string
  event_date: string
  note: string
  consent: boolean
  accept: boolean
  website: string
}

const EMPTY_DRAFT: Draft = { name: '', phone: '', line_id: '', event_date: '', note: '', consent: false, accept: false, website: '' }
// ข้อมูลที่กรอกค้างไว้ อยู่ในหน่วยความจำของหน้า (ไปเลือกชุดเพิ่มแล้วกลับมายังอยู่) — ไม่เก็บลงเครื่อง (ข้อมูลส่วนบุคคล)
let draftMemory: Draft = EMPTY_DRAFT

type FieldKey = 'name' | 'phone' | 'line_id' | 'event_date' | 'note' | 'consent' | 'accept'
const FIELD_ORDER: FieldKey[] = ['name', 'phone', 'line_id', 'event_date', 'note', 'consent', 'accept']

// เบอร์ที่ส่งให้ฐานข้อมูล: ตัวเลขล้วน และ +66 / 66 นำหน้า → 0 (แปลงแบบเดียวกับฐานข้อมูล ตรวจฝั่งนี้จะได้ไม่ค้านกัน)
function normalizePhone(raw: string): string {
  const d = phoneDigits(raw)
  return /^66\d{8,9}$/.test(d) ? `0${d.slice(2)}` : d
}

// วันงานล่วงหน้าได้ไม่เกิน 2 ปี (เท่ากับที่ฐานข้อมูลรับ)
const MAX_EVENT_AHEAD_DAYS = 730

function validate(d: Draft, todayKey: string): Partial<Record<FieldKey, string>> {
  const e: Partial<Record<FieldKey, string>> = {}
  const name = d.name.trim()
  if (!name) e.name = 'กรุณากรอกชื่อ-นามสกุล'
  else if (name.length > 100) e.name = 'ชื่อยาวเกิน 100 ตัวอักษร'
  const digits = normalizePhone(d.phone)
  if (!digits) e.phone = 'กรุณากรอกเบอร์โทรศัพท์มือถือ'
  else if (!/^0\d{8,9}$/.test(digits)) e.phone = 'เบอร์โทรไม่ถูกต้อง — กรอกเบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 0'
  if (d.line_id.trim().length > 50) e.line_id = 'LINE ID ยาวเกิน 50 ตัวอักษร'
  const ev = d.event_date.trim()
  if (ev && !isDayKey(ev)) e.event_date = 'วันที่ไม่ถูกต้อง'
  else if (ev && ev < todayKey) e.event_date = 'วันงานต้องไม่ก่อนวันนี้'
  else if (ev && ev > addDaysToKey(todayKey, MAX_EVENT_AHEAD_DAYS)) e.event_date = 'วันงานต้องไม่เกิน 2 ปีข้างหน้า'
  if (d.note.trim().length > 500) e.note = 'หมายเหตุยาวเกิน 500 ตัวอักษร'
  if (!d.consent) e.consent = 'กรุณายินยอมให้ร้านใช้ข้อมูลเพื่อติดต่อเรื่องการจอง'
  if (!d.accept) e.accept = 'กรุณาอ่านและยอมรับเงื่อนไขการเช่าชุด'
  return e
}

// gone = ชุดถูกปิดจากหน้าจองออนไลน์แล้ว · unknown = ตรวจไม่ได้ (เน็ต/ระบบ) ไม่บล็อกการส่ง (ฐานข้อมูลตรวจซ้ำเองตอนส่ง)
type LineCheck = { state: 'checking' | 'ok' | 'full' | 'short' | 'gone' | 'unknown'; free: number | null }

export default function CheckoutClient({ info, todayKey }: Props) {
  const router = useRouter()
  const cart = useBookCart()
  const [hydrated, setHydrated] = useState(false)
  const [draft, setDraftState] = useState<Draft>(draftMemory)
  const [showErrors, setShowErrors] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [submitError, setSubmitError] = useState<ApiFail | null>(null)
  // ส่งครั้งล่าสุดที่ถึงปลายทาง "ไม่รู้ผล" (คำขออาจถึงร้านแล้ว) — ครั้งถัดไปถูกจำกัดจำนวนครั้งก็ยังต้องเตือนต่อ
  const unsureRef = useRef(false)
  const [done, setDone] = useState<{ path: string; bookingNo: string } | null>(null)
  // ได้คำขอที่ส่งไว้ก่อนหน้ากลับมา แต่ตะกร้าถูกแก้หลังจากนั้น → คำขอนั้นอาจไม่มีชุด/วันที่ในตะกร้าตอนนี้ (ไม่ล้างตะกร้า)
  const [prevRequest, setPrevRequest] = useState<{ path: string; bookingNo: string } | null>(null)
  const [checks, setChecks] = useState<Record<string, LineCheck>>({})
  const checkSeq = useRef(0)
  // เพิ่มค่า = สั่งตรวจวันว่างใหม่ (หลังส่งคำขอไม่ผ่าน เช่น ชุดเพิ่งถูกคนอื่นจองไป)
  const [recheck, setRecheck] = useState(0)

  useEffect(() => setHydrated(true), [])

  function setDraft(patch: Partial<Draft>) {
    setDraftState(prev => {
      const next = { ...prev, ...patch }
      draftMemory = next
      return next
    })
  }

  const lead = info.online_min_lead_days
  const maxDays = info.online_max_days
  const earliest = earliestPickup(todayKey, lead)
  const pickup = cart.pickup
  const ret = cart.ret
  const dateProblem = cart.lines.length > 0 ? rangeProblem(pickup, ret, todayKey, lead, maxDays) : null
  const datesOk = !!pickup && !!ret && dateProblem === null
  const days = datesOk ? rentalDays(pickup as string, ret as string) : 0

  // ตรวจวันว่างของทุกชุดในช่วงวันที่เลือก (ชุดเดียวกันไซส์เดียวกันหลายตัว → ต้องว่างพอทุกตัว)
  const lineSig = cart.lines.map(l => `${l.key}:${l.item_id}:${sizeKey(l.size)}`).join('|')
  useEffect(() => {
    if (!datesOk || cart.lines.length === 0) {
      setChecks({})
      return
    }
    const my = ++checkSeq.current
    const lines = cart.lines
    const ids = Array.from(new Set(lines.map(l => l.item_id)))
    setChecks(Object.fromEntries(lines.map(l => [l.key, { state: 'checking', free: null } as LineCheck])))
    void Promise.all(ids.map(id => fetchAvailability(id, pickup as string, ret as string))).then(results => {
      if (my !== checkSeq.current) return
      const rangeDays = eachDay(pickup as string, ret as string)
      const out: Record<string, LineCheck> = {}
      const needBy: Record<string, number> = {}
      for (const l of lines) {
        const k = `${l.item_id}|${sizeKey(l.size)}`
        needBy[k] = (needBy[k] ?? 0) + 1
      }
      lines.forEach(l => {
        const r = results[ids.indexOf(l.item_id)]
        if (!r || !r.ok) {
          // ชุดถูกปิด/เอาออกจากหน้าจองออนไลน์หลังลูกค้าใส่ตะกร้า → ต้องลบออกก่อนส่ง (ฐานข้อมูลไม่รับอยู่แล้ว แต่ไม่บอกว่าชุดไหน)
          const gone = !!r && !r.ok && !r.unsure && !r.missing && /ไม่พบชุด/.test(r.message)
          out[l.key] = { state: gone ? 'gone' : 'unknown', free: null }
          return
        }
        const byDay: Record<string, Record<string, number>> = {}
        for (const d of r.data.days) {
          const m: Record<string, number> = {}
          for (const s of d.sizes) m[sizeKey(s.size)] = (m[sizeKey(s.size)] ?? 0) + s.free
          byDay[d.day] = m
        }
        let min: number | null = null
        for (const d of rangeDays) {
          if (!byDay[d]) continue
          const f = byDay[d][sizeKey(l.size)] ?? 0
          min = min === null ? f : Math.min(min, f)
        }
        const need = needBy[`${l.item_id}|${sizeKey(l.size)}`] ?? 1
        out[l.key] = min === null ? { state: 'unknown', free: null } : min === 0 ? { state: 'full', free: 0 } : min < need ? { state: 'short', free: min } : { state: 'ok', free: min }
      })
      setChecks(out)
    })
    // lineSig แทนรายการทั้งก้อน (ตะกร้าเป็น object ใหม่ทุกครั้งที่อ่านจากเครื่อง)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineSig, pickup, ret, datesOk, recheck])

  const prices = useMemo(() => cart.lines.map(l => (days > 0 ? linePrice(l.base_price, l.base_days, l.extra_day_price, days) : 0)), [cart.lines, days])
  const rentTotal = round2(prices.reduce((a, b) => a + b, 0))
  const securityTotal = round2(cart.lines.reduce((a, l) => a + l.security_deposit, 0))
  const depositEst =
    rentTotal > 0
      ? Math.min(rentTotal, Math.max(info.min_booking_deposit, Math.ceil(round2((rentTotal * info.booking_deposit_percent) / 100))))
      : 0

  const errors = validate(draft, todayKey)
  const blockedLines = cart.lines.filter(l => {
    const st = checks[l.key]?.state
    return st === 'full' || st === 'short' || st === 'gone'
  })
  const stillChecking = cart.lines.some(l => checks[l.key]?.state === 'checking')

  function err(k: FieldKey): string | undefined {
    return showErrors ? errors[k] : undefined
  }

  function onPickupChange(v: string) {
    if (!isDayKey(v)) {
      setCartDates(null, null)
      return
    }
    // วันคืนเดิมใช้ต่อได้ถ้ายังไม่ก่อนวันรับและไม่เกินจำนวนวันสูงสุด ; ไม่งั้นตั้งตามจำนวนวันเช่ามาตรฐาน
    const maxRet = latestReturn(v, maxDays)
    let r = ret && isDayKey(ret) && ret >= v && ret <= maxRet ? ret : addDaysToKey(v, Math.max(1, info.default_base_days) - 1)
    if (r > maxRet) r = maxRet
    setCartDates(v, r)
  }

  function onReturnChange(v: string) {
    if (!pickup || !isDayKey(v) || v < pickup) return
    setCartDates(pickup, v)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busyRef.current || done) return
    setShowErrors(true)
    setSubmitError(null)
    const errs = validate(draft, todayKey)
    const firstBad = FIELD_ORDER.find(k => errs[k])
    if (firstBad) {
      document.getElementById(`co-${firstBad}`)?.focus()
      return
    }
    if (cart.lines.length === 0 || !datesOk || blockedLines.length > 0) return

    busyRef.current = true
    setBusy(true)
    setPrevRequest(null)
    const reqLines = cart.lines.map(l => ({ item_id: l.item_id, size: l.size }))
    const phone = normalizePhone(draft.phone)
    const { clientId, retryOfSame } = beginCartSend(JSON.stringify([reqLines, pickup, ret, phone]))
    const res = await submitPublicRequest(clientId, {
      lines: reqLines,
      pickup_date: pickup as string,
      return_date: ret as string,
      name: draft.name.trim(),
      phone,
      line_id: draft.line_id.trim() || null,
      note: draft.note.trim() || null,
      event_date: draft.event_date.trim() || null,
      consent: draft.consent,
      accept_terms: draft.accept,
      website: draft.website,
    })
    if (res.ok) {
      const path = `${bookingStatusPath(res.data.token)}?new=${res.data.already_saved ? '2' : '1'}`
      rememberBooking(res.data.booking_no, res.data.token)
      if (res.data.already_saved && !retryOfSame) {
        // คำขอเดิม (ส่งตอนเน็ตหลุด) บันทึกแล้ว แต่ตะกร้าเปลี่ยนไปหลังจากนั้น → เก็บตะกร้าไว้ ใช้รหัสใหม่ครั้งหน้า
        resetCartClientId()
        unsureRef.current = false
        setPrevRequest({ path, bookingNo: res.data.booking_no })
        busyRef.current = false
        setBusy(false)
        return
      }
      setDone({ path, bookingNo: res.data.booking_no })
      clearCart()
      draftMemory = EMPTY_DRAFT
      router.replace(path)
      return
    }
    // รหัสคำขอผูกกับการจองอื่นแล้ว (ส่งสำเร็จไปแล้วด้วยเบอร์อื่น) → ครั้งหน้าใช้รหัสใหม่ ไม่งั้นกดส่งไม่ผ่านตลอด
    if (!res.unsure && isClientIdTaken(res.message)) resetCartClientId()
    // ปฏิเสธแน่ชัด (เช่น ชุดเพิ่งถูกจองไป) → ตรวจวันว่างของทุกชุดใหม่ ให้เห็นว่าชุดไหนต้องเปลี่ยน
    if (!res.unsure) setRecheck(t => t + 1)
    busyRef.current = false
    setBusy(false)
    // ถูกจำกัดจำนวนครั้ง (429) = ครั้งนี้ไม่ถึงฐานข้อมูล → ถ้าครั้งก่อน "ไม่แน่ใจ" ยังต้องบอกลูกค้าว่าคำขอเดิมอาจถึงร้านแล้ว
    //   (รหัสคำขอยังเดิม — รอแล้วกดส่งอีกครั้งได้คำขอเดิม ไม่ซ้ำ)
    if (res.rateLimited && unsureRef.current) {
      setSubmitError({ ...res, unsure: true })
      return
    }
    unsureRef.current = res.unsure
    setSubmitError(res)
  }

  // ===== ส่งสำเร็จ — รอเปลี่ยนหน้า (มีลิงก์สำรองถ้าหน้าไม่เปลี่ยนเอง) =====
  if (done) {
    return (
      <section className="card mx-auto max-w-lg" aria-live="polite">
        <div className="empty-state">
          <span className="icon-bubble icon-bubble-lg icon-bubble-ok" aria-hidden="true">
            <CheckCircle2 size={28} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <h1 className="empty-state-title">ส่งคำขอจองแล้ว เลขที่ {done.bookingNo}</h1>
          <p className="flex items-center gap-1.5">
            <Loader2 {...ICON_XS} className="animate-spin" />
            กำลังไปหน้าสถานะการจอง...
          </p>
          <Link href={done.path} replace className="btn-primary mt-2">
            ไปหน้าสถานะการจอง
          </Link>
        </div>
      </section>
    )
  }

  if (!hydrated) {
    return (
      <div className="space-y-4" role="status">
        <span className="sr-only">กำลังโหลดรายการจอง...</span>
        <div className="skeleton h-8 w-48" />
        <div className="card h-40 p-4"><div className="skeleton h-full w-full" /></div>
      </div>
    )
  }

  if (cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-lg space-y-5">
        <section className="card">
          <div className="empty-state">
            <span className="icon-bubble icon-bubble-lg" aria-hidden="true">
              <ShoppingBag size={28} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <h1 className="empty-state-title">ยังไม่มีชุดในรายการจอง</h1>
            <p className="max-w-sm">เลือกชุดและวันรับ–คืนที่ต้องการ แล้วกด &quot;เพิ่มในรายการจอง&quot;</p>
            <Link href="/book" className="btn-primary mt-2">
              เลือกชุด
            </Link>
          </div>
        </section>
        <RecentBookings />
      </div>
    )
  }

  const canSubmit = !busy && datesOk && blockedLines.length === 0

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">ส่งคำขอจองชุด</h1>
          <p className="page-subtitle">ตรวจสอบรายการ กรอกข้อมูลผู้จอง แล้วกดส่งคำขอ — ร้านจะยืนยันหลังได้รับมัดจำ</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
        <div className="min-w-0 space-y-5">
          {/* ===== วันรับ–คืน ===== */}
          <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="co-dates-title">
            <h2 id="co-dates-title" className="section-title">
              <CalendarDays {...ICON_SM} />
              วันรับชุด – วันคืนชุด
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:max-w-md">
              <div className="min-w-0">
                <label htmlFor="co-pickup" className="text-xs font-medium text-gray-500">วันรับชุด</label>
                <input
                  id="co-pickup"
                  type="date"
                  className="input mt-1"
                  min={earliest}
                  value={pickup ?? ''}
                  onChange={e => onPickupChange(e.target.value)}
                  aria-invalid={dateProblem !== null ? true : undefined}
                />
                <p className="mt-1 text-xs text-gray-500">{shortDay(pickup)}</p>
              </div>
              <div className="min-w-0">
                <label htmlFor="co-return" className="text-xs font-medium text-gray-500">วันคืนชุด</label>
                <input
                  id="co-return"
                  type="date"
                  className="input mt-1"
                  min={pickup ?? earliest}
                  max={pickup ? latestReturn(pickup, maxDays) : undefined}
                  value={ret ?? ''}
                  onChange={e => onReturnChange(e.target.value)}
                  aria-invalid={dateProblem !== null ? true : undefined}
                />
                <p className="mt-1 text-xs text-gray-500">{shortDay(ret)}</p>
              </div>
            </div>
            <div aria-live="polite">
              {dateProblem ? (
                <p className="flex items-start gap-2 text-sm text-amber-800">
                  <AlertTriangle {...ICON_XS} className="mt-0.5" />
                  <span>{dateProblem}</span>
                </p>
              ) : (
                <p className="text-sm text-gray-700">
                  เช่า <span className="font-semibold">{days} วัน</span> — ทุกชุดในคำขอนี้รับและคืนวันเดียวกัน
                </p>
              )}
            </div>
          </section>

          {/* ===== รายการชุด ===== */}
          <section className="card" aria-labelledby="co-lines-title">
            <div className="card-header">
              <h2 id="co-lines-title" className="section-title">
                <ClipboardList {...ICON_SM} />
                รายการชุด ({cart.lines.length})
              </h2>
              {cart.lines.length < MAX_PUBLIC_LINES && (
                <Link href={pickup && ret && datesOk ? `/book?from=${pickup}&to=${ret}` : '/book'} className="link text-sm">
                  เลือกชุดเพิ่ม
                </Link>
              )}
            </div>
            <ul className="divide-y divide-gray-150">
              {cart.lines.map((l, i) => (
                <CartRow
                  key={l.key}
                  line={l}
                  price={prices[i]}
                  days={days}
                  check={checks[l.key]}
                  href={itemHref(l.code, datesOk ? pickup : null, datesOk ? ret : null)}
                  onRemove={() => removeCartLine(l.key)}
                  disabled={busy}
                />
              ))}
            </ul>
            {blockedLines.length > 0 && (
              <div className="border-t border-gray-200 p-4">
                <div role="alert" className="alert-warn">
                  <AlertTriangle {...ICON_SM} />
                  <p className="min-w-0">
                    มี {blockedLines.length} ชุดที่จองในช่วงวันที่เลือกไม่ได้ — ลบชุดนั้นออก หรือเปลี่ยนวันรับ–คืน แล้วส่งคำขออีกครั้ง
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* ===== ข้อมูลผู้จอง ===== */}
          <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="co-customer-title">
            <h2 id="co-customer-title" className="section-title">
              <UserRound {...ICON_SM} />
              ข้อมูลผู้จอง
            </h2>
            <Field id="co-name" label="ชื่อ-นามสกุล" required error={err('name')}>
              <input
                id="co-name"
                className="input"
                autoComplete="name"
                maxLength={100}
                value={draft.name}
                onChange={e => setDraft({ name: e.target.value })}
                aria-invalid={err('name') ? true : undefined}
                aria-describedby={err('name') ? 'co-name-err' : undefined}
                disabled={busy}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="co-phone" label="เบอร์โทรศัพท์มือถือ" required error={err('phone')} hint="ร้านจะติดต่อกลับทางเบอร์นี้">
                <input
                  id="co-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  className="input"
                  maxLength={20}
                  placeholder="08x-xxx-xxxx"
                  value={draft.phone}
                  onChange={e => setDraft({ phone: e.target.value })}
                  aria-invalid={err('phone') ? true : undefined}
                  aria-describedby={err('phone') ? 'co-phone-err' : 'co-phone-hint'}
                  disabled={busy}
                />
              </Field>
              <Field id="co-line_id" label="LINE ID (ถ้ามี)" error={err('line_id')}>
                <input
                  id="co-line_id"
                  className="input"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={50}
                  value={draft.line_id}
                  onChange={e => setDraft({ line_id: e.target.value })}
                  aria-invalid={err('line_id') ? true : undefined}
                  aria-describedby={err('line_id') ? 'co-line_id-err' : undefined}
                  disabled={busy}
                />
              </Field>
            </div>
            <Field id="co-event_date" label="วันที่ใช้ชุด / วันงาน (ถ้ามี)" error={err('event_date')}>
              <input
                id="co-event_date"
                type="date"
                className="input sm:max-w-xs"
                min={todayKey}
                max={addDaysToKey(todayKey, MAX_EVENT_AHEAD_DAYS)}
                value={draft.event_date}
                onChange={e => setDraft({ event_date: e.target.value })}
                aria-invalid={err('event_date') ? true : undefined}
                aria-describedby={err('event_date') ? 'co-event_date-err' : undefined}
                disabled={busy}
              />
            </Field>
            <Field id="co-note" label="ข้อความถึงร้าน (ถ้ามี)" error={err('note')} hint={`${draft.note.length}/500 · เช่น ส่วนสูง/รอบอก ขอลองชุดก่อน`}>
              <textarea
                id="co-note"
                className="input"
                rows={3}
                maxLength={500}
                value={draft.note}
                onChange={e => setDraft({ note: e.target.value })}
                aria-invalid={err('note') ? true : undefined}
                aria-describedby={err('note') ? 'co-note-err' : 'co-note-hint'}
                disabled={busy}
              />
            </Field>

            {/* ช่องดักบอท (ส่งเป็น payload.website): คนมองไม่เห็นและกดไปไม่ถึง บอทกรอกทุกช่อง → ฐานข้อมูลปฏิเสธ
                ชื่อช่องไม่ใช่ website/url เพื่อไม่ให้ระบบเติมข้อมูลอัตโนมัติของเบราว์เซอร์กรอกให้ลูกค้าจริงโดยไม่ตั้งใจ */}
            <div className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
              <label htmlFor="co-hp-extra">ช่องนี้ไม่ต้องกรอก</label>
              <input
                id="co-hp-extra"
                name="hp_extra"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={draft.website}
                onChange={e => setDraft({ website: e.target.value })}
              />
            </div>
          </section>
        </div>

        {/* ===== สรุป + ยินยอม + ส่ง ===== */}
        <div className="min-w-0 space-y-5 lg:sticky lg:top-24">
          <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="co-sum-title">
            <h2 id="co-sum-title" className="section-title">สรุปยอด (ประมาณการ)</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-gray-600">ค่าเช่า {cart.lines.length} ชุด{days > 0 ? ` · ${days} วัน` : ''}</dt>
                <dd className="money text-gray-900">{baht(rentTotal)}</dd>
              </div>
              {info.booking_deposit_percent > 0 || info.min_booking_deposit > 0 ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-gray-600">
                    มัดจำเพื่อยืนยันการจอง
                    <span className="block text-xs text-gray-500">
                      {info.booking_deposit_percent}% ของค่าเช่า{info.min_booking_deposit > 0 ? ` (ขั้นต่ำ ${baht(info.min_booking_deposit)})` : ''}
                    </span>
                  </dt>
                  <dd className="money text-base text-gray-900">{baht(depositEst)}</dd>
                </div>
              ) : null}
              {securityTotal > 0 && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-gray-600">
                    ค่าประกันชุด
                    <span className="block text-xs text-gray-500">ชำระวันรับชุด ได้คืนเมื่อคืนชุดครบสภาพดี</span>
                  </dt>
                  <dd className="money text-gray-900">{baht(securityTotal)}</dd>
                </div>
              )}
            </dl>
            <p className="field-hint mt-0">
              ยอดจริง (รวมส่วนลด/ค่าจัดส่ง ถ้ามี) จะแสดงในหน้าสถานะการจองหลังส่งคำขอ พร้อมช่องทางชำระมัดจำและส่งสลิป
            </p>
          </section>

          <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="co-consent-title">
            <h2 id="co-consent-title" className="sr-only">การยินยอมและเงื่อนไข</h2>
            <CheckRow
              id="co-consent"
              checked={draft.consent}
              onChange={v => setDraft({ consent: v })}
              error={err('consent')}
              disabled={busy}
            >
              ยินยอมให้ร้านเก็บและใช้ชื่อ เบอร์โทร และ LINE ID เพื่อติดต่อเรื่องการจองนี้เท่านั้น ตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล (PDPA)
            </CheckRow>
            <CheckRow
              id="co-accept"
              checked={draft.accept}
              onChange={v => setDraft({ accept: v })}
              error={err('accept')}
              disabled={busy}
            >
              อ่านและยอมรับเงื่อนไขการเช่าชุดของร้านแล้ว
            </CheckRow>
            <button type="button" className="btn-ghost -ml-2 px-2 text-sm" onClick={() => setTermsOpen(true)}>
              <FileText {...ICON_XS} />
              อ่านเงื่อนไขการเช่า
            </button>

            {prevRequest && (
              <div role="alert" className="alert-warn">
                <AlertTriangle {...ICON_SM} />
                <div className="min-w-0 space-y-2">
                  <p>
                    คำขอที่ส่งไว้ก่อนหน้านี้ (เลขที่ {prevRequest.bookingNo}) บันทึกแล้ว แต่รายการในตะกร้าถูกแก้หลังจากนั้น —
                    คำขอนั้นอาจไม่มีชุดหรือวันที่ที่แก้ไว้ รายการในตะกร้าตอนนี้ยังไม่ได้ส่ง
                  </p>
                  <p>ดูคำขอเดิมก่อน ถ้าต้องการจองรายการในตะกร้านี้เพิ่ม กด &quot;ส่งคำขอจอง&quot; อีกครั้ง</p>
                  <Link href={prevRequest.path} className="btn-secondary px-4 text-sm">ดูคำขอเดิม</Link>
                </div>
              </div>
            )}
            {submitError && (
              <div role="alert" className={submitError.unsure ? 'alert-warn' : 'alert-err'}>
                {submitError.unsure ? <AlertTriangle {...ICON_SM} /> : <XCircle {...ICON_SM} />}
                <p className="min-w-0">
                  {submitError.unsure && submitError.rateLimited
                    ? `${submitError.message} — คำขอครั้งก่อนยังไม่ทราบผลและอาจถึงร้านแล้ว รอสักครู่แล้วกด "ส่งคำขอจองอีกครั้ง" ระบบจะไม่สร้างคำขอซ้ำ`
                    : submitError.unsure
                    ? 'ไม่แน่ใจว่าส่งคำขอสำเร็จหรือไม่ (สัญญาณอินเทอร์เน็ตไม่เสถียร) — กด "ส่งคำขอจอง" อีกครั้งได้เลย ระบบจะไม่สร้างคำขอซ้ำ'
                    : submitError.message}
                </p>
              </div>
            )}
            {showErrors && Object.keys(errors).length > 0 && !submitError && (
              <p className="text-sm text-red-700" role="alert">กรุณากรอกข้อมูลให้ครบถ้วนก่อนส่งคำขอ</p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={!canSubmit} aria-busy={busy}>
              {busy ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Send {...ICON_SM} />}
              {busy ? 'กำลังส่งคำขอ...' : submitError?.unsure ? 'ส่งคำขอจองอีกครั้ง' : 'ส่งคำขอจอง'}
            </button>
            {stillChecking && <p className="text-center text-xs text-gray-500">กำลังตรวจวันว่างของชุด...</p>}
            <p className="text-center text-xs text-gray-500">
              ส่งคำขอแล้วยังไม่ถือว่าจองสำเร็จ ร้านจะยืนยันหลังตรวจสอบคิวและได้รับมัดจำ
            </p>
          </section>
        </div>
      </div>

      <TermsDialog
        open={termsOpen}
        shopName={info.shop_name}
        termsText={info.terms_text}
        onClose={() => setTermsOpen(false)}
        onAccept={() => {
          setDraft({ accept: true })
          setTermsOpen(false)
        }}
      />
    </form>
  )
}

function Field({
  id, label, required = false, error, hint, children,
}: {
  id: string
  label: string
  required?: boolean
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="field-label">
        {label}
        {required && <span className="text-red-700" aria-hidden="true"> *</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} className="mt-1 text-xs text-red-700">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="field-hint">{hint}</p>
      ) : null}
    </div>
  )
}

function CheckRow({
  id, checked, onChange, error, disabled, children,
}: {
  id: string
  checked: boolean
  onChange: (v: boolean) => void
  error?: string
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className={clsx('panel flex min-h-[44px] cursor-pointer select-none items-start gap-3 p-3', error && 'border-red-300')}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={e => onChange(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
        />
        <span className="min-w-0 text-sm text-gray-800">{children}</span>
      </label>
      {error && <p id={`${id}-err`} className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  )
}

function CartRow({
  line, price, days, check, href, onRemove, disabled,
}: {
  line: CartLine
  price: number
  days: number
  check: LineCheck | undefined
  href: string
  onRemove: () => void
  disabled: boolean
}) {
  return (
    <li className="flex gap-3 p-3 sm:p-4">
      <Link href={href} className="shrink-0" tabIndex={-1} aria-hidden="true">
        <RentalImage path={line.cover_path} alt="" className="h-20 w-16 rounded-lg border border-gray-200" />
      </Link>
      <div className="min-w-0 flex-1 space-y-1">
        <Link href={href} className="line-clamp-2 break-words text-sm font-semibold text-gray-900 hover:underline">
          {line.name}
        </Link>
        <p className="text-xs text-gray-500">
          รหัส {line.code} · ไซส์ <span className="font-medium text-gray-700">{sizeLabel(line.size)}</span>
        </p>
        <p className="text-xs text-gray-500">
          {days > 0 ? (
            <>
              ค่าเช่า {days} วัน <span className="money text-sm text-gray-900">{baht(price)}</span>
            </>
          ) : (
            <>เลือกวันเพื่อดูราคา</>
          )}
          {line.security_deposit > 0 && <> · ค่าประกัน {baht(line.security_deposit)}</>}
        </p>
        {check && check.state !== 'unknown' && (
          <p
            className={clsx(
              'inline-flex',
              check.state === 'ok' ? 'badge-in' : check.state === 'checking' ? 'badge-adjust' : 'badge-out',
            )}
          >
            {check.state === 'checking' ? (
              <Loader2 size={12} strokeWidth={2} className="animate-spin" aria-hidden="true" />
            ) : check.state === 'ok' ? (
              <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" />
            ) : (
              <XCircle size={14} strokeWidth={2} aria-hidden="true" />
            )}
            {check.state === 'checking'
              ? 'กำลังตรวจวันว่าง'
              : check.state === 'ok'
                ? 'ว่างช่วงวันที่เลือก'
                : check.state === 'full'
                  ? 'ไม่ว่างช่วงวันที่เลือก'
                  : check.state === 'gone'
                    ? 'ชุดนี้ปิดรับจองออนไลน์แล้ว — ลบออกจากรายการ'
                    : `ว่างไม่พอ (ว่าง ${check.free} ตัว)`}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="btn-icon btn-icon-plain btn-icon-danger -mr-2 shrink-0"
        aria-label={`ลบ ${line.name} ไซส์ ${sizeLabel(line.size)} ออกจากรายการ`}
      >
        <Trash2 {...ICON_SM} />
      </button>
    </li>
  )
}

