'use client'
// ฟอร์มการจองร้านเช่าชุด — ใช้ทั้ง "สร้างการจอง" (/rental/bookings/new) และ "แก้ไขการจอง" (/rental/bookings/<id>/edit)
// 4 ขั้น: วันรับ-คืน → เลือกชุด (ชิ้นที่ว่างจริง) → ลูกค้า → สรุปยอด (+ รับมัดจำ/เงินประกันพร้อมบันทึก)
//
// เงิน/ราคาทั้งหมดฐานข้อมูลคำนวณ (rental_quote ดูล่วงหน้า / rental_create_booking / rental_update_booking บันทึกจริง)
// กันบันทึกซ้ำ:
//   - สร้างใหม่: client_id สุ่มครั้งเดียวต่อการจอง เก็บใน sessionStorage พร้อมฟอร์มที่กรอกค้าง (รีเฟรชหน้าแล้วไม่หาย)
//     ก่อนส่งตั้งธง "กำลังส่ง" ไว้ → เน็ตหลุด/ปิดหน้ากลางทาง กลับมากดใหม่ ระบบตรวจก่อนว่าการจองรหัสนี้บันทึกไปแล้วหรือยัง
//     (บันทึกแล้ว = พาไปหน้าการจองนั้น ไม่สร้างซ้ำ ไม่รับเงินซ้ำ) — ฐานข้อมูลก็คืนการจองเดิมเมื่อได้ client_id ซ้ำอยู่แล้ว
//     แต่ฐานข้อมูลไม่ดูข้อมูลที่ส่ง → เก็บลายเซ็นข้อมูลที่ส่งด้วยรหัสนั้นไว้: พบการจองของรหัสนี้แต่ฟอร์มถูกเปลี่ยน/ล้างหลังส่ง
//     = ไม่ถือว่าบันทึกแล้ว (แสดงการจองนั้น + ใช้รหัสใหม่) ; เปิดหน้าใหม่โดยไม่มีคำขอค้าง = รหัสใหม่เสมอ ;
//     แท็บที่ทำซ้ำมาขณะแท็บเดิมยังถือคำขอที่ไม่รู้ผล → แท็บเดิมตอบผ่าน BroadcastChannel แท็บใหม่เปลี่ยนรหัส
//   - แก้ไข: ล็อกเวอร์ชันด้วย updated_at — เครื่องอื่นแก้ก่อน = บันทึกไม่ได้ ต้องโหลดข้อมูลล่าสุด (ส่งซ้ำก็ไม่ทับซ้อน)
//     กดซ้ำหลังไม่รู้ผลแล้วชนล็อกของตัวเอง → เทียบการจองล่าสุดกับที่ส่ง ตรงกัน = บันทึกแล้ว ไม่ใช่ "เครื่องอื่นแก้"
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import clsx from 'clsx'
import {
  AlertTriangle, ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, ExternalLink, Info, Loader2, RefreshCw, RotateCcw,
  Save, ShoppingBag, UserRound, XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { baht, formatThaiDate, isDayKey, thaiError } from '@/lib/format'
import { round2 } from '@/lib/money'
import { isMigrationMissing } from '@/lib/migration'
import { newUuid } from '@/lib/products'
import {
  FIX05_MISSING_MSG, MAX_BOOKING_LINES, METHOD_LABELS, PAYMENT_KIND_LABELS, formatPhone, parseBookingResult, phoneDigits,
  parseCreateBookingResult, parseFindUnits, parseQuote, parseRentalBooking, sizeLabel,
  type FindUnitsItem, type FindUnitsSize, type RentalBooking, type RentalCategory, type RentalQuote,
} from '@/lib/rental'
import ConfirmDialog from '@/components/integrations/ConfirmDialog'
import Stepper from './Stepper'
import DatesStep from './DatesStep'
import ItemsStep from './ItemsStep'
import CustomerStep from './CustomerStep'
import SummaryStep from './SummaryStep'
import { CUSTOMER_LITE_COLUMNS, toCustomerLite } from './search'
import CartList from './CartList'
import MoneySummary from './MoneySummary'
import {
  DRAFT_MAX_AGE_MS, DRAFT_STORAGE_KEY, MAX_SENT_SIGS, bookingMatchesEdit, checkCustomerDraft, checkDates, chooseUnit,
  customerPayload, draftFromBooking, draftHasContent, emptyDraft, headPayload, holdHoursValue, isUuid, linesPayload,
  mapLineQuotes, newCartLine, orderedLines, parseStoredDraft, payloadSig, planPayments, type CustomerLite, type LineQuote, type StoredDraft, type WizardDraft, type WizardMode, type WizardStep,
} from './model'

export interface WizardSettings {
  default_base_days: number
  online_hold_hours: number
}

export interface WizardPrefill {
  pickup?: string | null
  ret?: string | null
  itemId?: string | null
  customer?: CustomerLite | null
}

const QUOTE_DEBOUNCE_MS = 350
const RPC_TIMEOUT_MS = 30000
const UNSURE_MSG = 'ไม่แน่ใจว่าบันทึกการจองแล้วหรือยัง (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — กดบันทึกอีกครั้งได้ ระบบจะตรวจก่อนและไม่สร้างการจองซ้ำ'
const PARTIAL_MSG = 'ระบบตอบกลับไม่ครบ — กดบันทึกอีกครั้งเพื่อตรวจสอบ (ระบบจะไม่สร้างการจองซ้ำ)'
const UNSURE_EDIT_MSG = 'ไม่แน่ใจว่าบันทึกการแก้ไขแล้วหรือยัง (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — กดบันทึกอีกครั้งได้ ระบบไม่บันทึกทับซ้อน'
const CONFLICT_MARK = 'ถูกแก้ไขจากเครื่องอื่น'
const OTHER_SAVED_MSG = 'พบการจองที่บันทึกด้วยคำขอครั้งก่อนแล้ว แต่ข้อมูลในฟอร์มถูกเปลี่ยนหลังจากส่งครั้งนั้น — ฟอร์มนี้ยังไม่ได้บันทึก ' +
  'ตรวจการจองนั้นก่อน (ปุ่มด้านบน) ถ้าไม่ใช่รายการในฟอร์มนี้ กดบันทึกอีกครั้งเพื่อสร้างการจองใหม่'
const RESET_UNSURE_MSG = 'ยังตรวจไม่ได้ว่าการบันทึกครั้งก่อนสำเร็จหรือไม่ (เน็ตหลุด?) — ล้างฟอร์มไม่ได้จนกว่าจะตรวจได้ รอสักครู่แล้วลองใหม่'
// ช่องสื่อสารระหว่างแท็บ: แท็บที่ "ทำซ้ำ" ได้ sessionStorage (รหัสคำขอ) ชุดเดียวกันมา → ถามว่ามีแท็บอื่นถือรหัสนี้อยู่ไหม
const TAB_CHANNEL = 'rental-booking-cid'
const TAB_ASK_MS = 400
// ค้นการจองจากรหัสคำขอ / เบอร์โทรซ้ำ — เกินนี้ถือว่าตรวจไม่ได้
const LOOKUP_TIMEOUT_MS = 10000

/** ถามแท็บอื่นที่เปิดอยู่ว่าใช้รหัสคำขอนี้อยู่หรือไม่ (ไม่รองรับ BroadcastChannel = ถือว่าไม่มี)
 *  BroadcastChannel ส่งถึงทุกอ็อบเจกต์ชื่อเดียวกัน รวมตัวรับของหน้านี้เอง → ข้อความพก tabId ของผู้ถาม/ผู้ตอบ
 *  ตัวรับของหน้านี้ไม่ตอบคำถามของตัวเอง และคำตอบจาก tabId เดียวกันไม่นับ */
function otherTabOwns(cid: string, tabId: string): Promise<boolean> {
  return new Promise(resolve => {
    let ch: BroadcastChannel | null = null
    try {
      ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(TAB_CHANNEL) : null
    } catch {
      ch = null
    }
    if (!ch) {
      resolve(false)
      return
    }
    const c = ch
    const t = setTimeout(() => {
      c.close()
      resolve(false)
    }, TAB_ASK_MS)
    c.onmessage = (e: MessageEvent) => {
      const m = e.data as { type?: unknown; cid?: unknown; from?: unknown } | null
      if (m && m.type === 'mine' && m.cid === cid && typeof m.from === 'string' && m.from !== tabId) {
        clearTimeout(t)
        c.close()
        resolve(true)
      }
    }
    try {
      c.postMessage({ type: 'who', cid, from: tabId })
    } catch {
      clearTimeout(t)
      c.close()
      resolve(false)
    }
  })
}

// error มาจากเซิร์ฟเวอร์จริง (มีรหัส Postgres/PostgREST) — ไม่ใช่เน็ตหลุด/หมดเวลา
function serverAnswered(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  if (typeof code !== 'string') return false
  return /^PGRST\d+$/.test(code) || /^(?!E)[0-9A-Z]{5}$/.test(code)
}

// เซิร์ฟเวอร์ปฏิเสธแน่นอน = ทั้งคำขอไม่ได้บันทึกอะไร (rental_create_booking ทำในทรานแซกชันเดียว)
// ยกเว้น: error ชั่วคราวของฐานข้อมูล (หมดเวลา/ล็อกชน/การเชื่อมต่อ) และ "กำลังบันทึกจากอีกเครื่อง" (คำขอรหัสเดียวกันอีกอันบันทึกไปแล้ว)
function definitelyNotSaved(err: unknown): boolean {
  if (!serverAnswered(err)) return false
  const e = err as { code?: unknown; message?: unknown }
  const code = String(e.code)
  const message = typeof e.message === 'string' ? e.message : ''
  if (/^(08|40|53|55|57|58|XX)/.test(code)) return false
  if (message.includes('กำลังบันทึกจากอีกเครื่อง')) return false
  return true
}

// ฐานข้อมูลปฏิเสธลูกค้าใหม่ที่เบอร์ตรงกับลูกค้าบัญชีดำ (rental_create_booking / rental_update_booking ไม่ได้ส่ง force)
const BLACK_PHONE_RE = /^เบอร์โทรนี้เป็นของลูกค้า.*บัญชีดำ.*ต้องกดยืนยัน/

// ข้อความไทยจาก RPC ของเรา (รวมสิทธิ์ 42501) บอกชัดกว่าข้อความกลางของ thaiError
function errText(err: unknown): string {
  if (isMigrationMissing(err)) return FIX05_MISSING_MSG
  const e = err && typeof err === 'object' ? (err as { code?: unknown; message?: unknown }) : null
  if (e && e.code === '42501' && typeof e.message === 'string' && /[฀-๿]/.test(e.message)) return e.message.trim()
  return thaiError(err)
}

function readStorage(): string | null {
  try {
    return window.sessionStorage.getItem(DRAFT_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStorage(v: StoredDraft | null) {
  try {
    if (v) window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(v))
    else window.sessionStorage.removeItem(DRAFT_STORAGE_KEY)
  } catch {
    // เก็บไม่ได้ (โหมดส่วนตัว/พื้นที่เต็ม) — ยังใช้งานได้ แค่รีเฟรชแล้วฟอร์มหาย
  }
}

interface QuoteState {
  sig: string
  keys: string[]
  data: RentalQuote | null
  loading: boolean
  error: string
}

interface AvailState {
  sig: string
  map: Map<string, FindUnitsItem>
  fetched: Set<string>
}

export default function BookingWizard({
  mode,
  today,
  settings,
  categories,
  booking,
  prefill,
}: {
  mode: WizardMode
  today: string
  settings: WizardSettings
  categories: readonly RentalCategory[]
  booking?: RentalBooking | null
  prefill?: WizardPrefill
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const create = mode === 'create'
  const bookingId = !create && booking ? booking.id : null
  const holdDefault = Math.min(168, Math.max(1, settings.online_hold_hours || 24))
  const hasPrefill = !!(prefill && (prefill.pickup || prefill.itemId || prefill.customer))

  const [draft, setDraft] = useState<WizardDraft>(() => {
    if (!create && booking) return draftFromBooking(booking, holdDefault)
    const d = emptyDraft(holdDefault)
    if (prefill) {
      if (isDayKey(prefill.pickup)) {
        d.pickup = prefill.pickup
        d.ret = isDayKey(prefill.ret) && prefill.ret >= prefill.pickup ? prefill.ret : ''
      }
      if (prefill.customer) {
        d.customerMode = 'existing'
        d.customer = prefill.customer
      }
    }
    return d
  })
  const [maxStep, setMaxStep] = useState<WizardStep>(create ? 1 : 4)
  const [tried, setTried] = useState<Partial<Record<WizardStep, boolean>>>({})
  const [ack, setAck] = useState(false)
  const [focusItemId, setFocusItemId] = useState<string | null>(prefill?.itemId && isUuid(prefill.itemId) ? prefill.itemId : null)
  const [quote, setQuote] = useState<QuoteState>({ sig: '', keys: [], data: null, loading: false, error: '' })
  const [avail, setAvail] = useState<AvailState>({ sig: '', map: new Map(), fetched: new Set() })
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [done, setDone] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [changedElsewhere, setChangedElsewhere] = useState(false)
  const [payConfirm, setPayConfirm] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [restored, setRestored] = useState(false)
  // kind: 'restored' = การจองที่กดบันทึกครั้งก่อน (ตอนเน็ตหลุด) สำเร็จแล้ว ; 'other' = พบการจองของคำขอนี้ แต่ฟอร์มตอนนี้เป็นข้อมูลอื่น
  const [prevSaved, setPrevSaved] = useState<{ id: string; booking_no: string; kind: 'restored' | 'other' } | null>(null)
  const [dupTab, setDupTab] = useState(false)
  const [hydrated, setHydrated] = useState(!create)
  const [linesMsg, setLinesMsg] = useState('')
  const cidRef = useRef('')
  // รหัสของฟอร์มที่เปิดอยู่นี้ (ต่อการเปิดหน้า) — แยกคำถาม/คำตอบระหว่างแท็บออกจากของตัวเอง
  const tabIdRef = useRef('')
  if (!tabIdRef.current) tabIdRef.current = newUuid()
  const inflightRef = useRef(false)
  const sigsRef = useRef<string[]>([])
  // แก้ไขการจอง: รหัสคำขอ + ลายเซ็นข้อมูลที่ส่งด้วยรหัสนั้น (ยังไม่รู้ผล)
  const editReqRef = useRef<{ id: string; sig: string } | null>(null)
  const quoteReqRef = useRef(0)
  const availReqRef = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft

  const step = draft.step
  const patch = useCallback((p: Partial<WizardDraft>) => {
    setDraft(d => ({ ...d, ...p }))
    setSubmitError('')
  }, [])

  // ===== เก็บ/กู้ฟอร์มที่กรอกค้าง + รหัสคำขอ (สร้างใหม่เท่านั้น) =====
  const persist = useCallback((d: WizardDraft) => {
    if (!create || !cidRef.current) return
    writeStorage({ v: 1, cid: cidRef.current, inflight: inflightRef.current, sigs: sigsRef.current, savedAt: Date.now(), draft: d })
  }, [create])

  // เปลี่ยนเป็นรหัสคำขอใหม่ (ใช้ได้เฉพาะตอนรู้ผลของรหัสเดิมแน่นอนแล้ว / รหัสเดิมเป็นของแท็บอื่น)
  const newRequestId = useCallback(() => {
    cidRef.current = newUuid()
    inflightRef.current = false
    sigsRef.current = []
  }, [])

  // แท็บนี้ถือรหัสคำขอที่ยังไม่รู้ผล → ตอบแท็บที่ถูกทำซ้ำว่า "รหัสนี้ของฉัน" (แท็บนั้นจะเปลี่ยนเป็นรหัสใหม่ ไม่ใช้รหัสร่วมกัน)
  useEffect(() => {
    if (!create || typeof BroadcastChannel === 'undefined') return
    let ch: BroadcastChannel
    try {
      ch = new BroadcastChannel(TAB_CHANNEL)
    } catch {
      return
    }
    ch.onmessage = (e: MessageEvent) => {
      const m = e.data as { type?: unknown; cid?: unknown; from?: unknown } | null
      // คำถามจากฟอร์มนี้เอง (ตอนเปิดหน้า) ห้ามตอบ — ไม่งั้นหน้าเดียวก็คิดว่า "มีแท็บอื่นถือรหัสนี้" แล้วข้ามการตรวจว่าบันทึกไปแล้วหรือยัง
      if (
        m && m.type === 'who' && typeof m.cid === 'string' && m.cid === cidRef.current
        && typeof m.from === 'string' && m.from !== tabIdRef.current
      ) {
        try {
          ch.postMessage({ type: 'mine', cid: m.cid, from: tabIdRef.current })
        } catch {
          // ส่งไม่ได้ — แท็บนั้นยังมีการตรวจลายเซ็นข้อมูลกันพลาดอีกชั้น
        }
      }
    }
    return () => ch.close()
  }, [create])

  // ค้นการจองจากรหัสคำขอ (ตรวจว่าครั้งก่อนที่ไม่รู้ผลบันทึกไปแล้วหรือยัง) — error → throw
  const findByClientId = useCallback(async (cid: string): Promise<{ id: string; booking_no: string } | null> => {
    // ค้างนาน = ตรวจไม่ได้ (throw) — ไม่ให้ปุ่มบันทึกรอไม่รู้จบ
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = setTimeout(() => ctrl?.abort(), LOOKUP_TIMEOUT_MS)
    let res
    try {
      let req = supabase
        .from('rental_bookings')
        .select('id, booking_no')
        .eq('client_id', cid)
      if (ctrl) req = req.abortSignal(ctrl.signal)
      res = await req.maybeSingle()
    } finally {
      clearTimeout(timer)
    }
    const { data, error } = res
    if (error) throw error
    if (!data || typeof data !== 'object') return null
    const row = data as { id?: unknown; booking_no?: unknown }
    return typeof row.id === 'string' ? { id: row.id, booking_no: typeof row.booking_no === 'string' ? row.booking_no : '' } : null
  }, [supabase])

  useEffect(() => {
    if (!create) return
    const stored = parseStoredDraft(readStorage(), holdDefault)
    // ไม่มีคำขอที่ค้างไม่รู้ผล = ยังไม่เคยส่งอะไรด้วยรหัสนี้ → เปิดหน้าใหม่ใช้รหัสใหม่เสมอ
    // (แท็บที่ "ทำซ้ำ" ได้ sessionStorage ชุดเดียวกันมา — ห้ามใช้รหัสร่วมกับแท็บเดิม ไม่งั้นการจองที่สองถูกมองว่า "บันทึกแล้ว")
    const pending = stored?.inflight ? stored : null
    if (pending) {
      cidRef.current = pending.cid
      inflightRef.current = true
      sigsRef.current = pending.sigs
    } else {
      newRequestId()
    }
    let restoredNow = false
    if (stored?.draft && !hasPrefill && draftHasContent(stored.draft) && Date.now() - stored.savedAt < DRAFT_MAX_AGE_MS) {
      const d = stored.draft
      setDraft(d)
      setMaxStep(d.step)
      setRestored(true)
      restoredNow = true
    }
    if (!pending) {
      setHydrated(true)
      return
    }
    // ครั้งก่อนกดบันทึกแล้วไม่รู้ผล → (1) แท็บอื่นที่ยังเปิดอยู่ถือรหัสนี้ไหม (แท็บนี้ถูกทำซ้ำมา) (2) ดูว่าบันทึกไปแล้วหรือยัง
    // ปุ่มบันทึกรอจนถามแท็บอื่นเสร็จ (ไม่เกิน TAB_ASK_MS)
    void (async () => {
      const ownedElsewhere = await otherTabOwns(pending.cid, tabIdRef.current)
      if (!ownedElsewhere) setHydrated(true)
      // ตรวจว่าคำขอนั้นบันทึกไปแล้วหรือยังเสมอ (แม้แท็บอื่นถือรหัสอยู่) — บันทึกแล้ว = ขึ้นแถบ "บันทึกแล้ว" ไม่ชวนกดบันทึกซ้ำ
      let found: { id: string; booking_no: string } | null = null
      try {
        found = await findByClientId(pending.cid)
      } catch {
        // ตรวจไม่ได้ตอนนี้ — แท็บนี้เอง: ธง "กำลังส่ง" ยังอยู่ กดบันทึกครั้งถัดไประบบจะตรวจอีกครั้งก่อนส่ง
        found = null
      }
      if (ownedElsewhere && !found) {
        // แท็บเดิมยังจัดการคำขอนั้นอยู่ → แท็บนี้ใช้รหัสใหม่ บันทึกที่นี่ = การจองอีกรายการ
        newRequestId()
        setDupTab(true)
        persist(draftRef.current)
        setHydrated(true)
        return
      }
      setHydrated(true)
      if (found && cidRef.current === pending.cid) {
        setPrevSaved({ ...found, kind: 'restored' })
        newRequestId()
        if (restoredNow) {
          // ฟอร์มที่กู้มา = ข้อมูลของการจองที่บันทึกไปแล้ว → ล้างทิ้ง (ไม่ให้กดบันทึกซ้ำเป็นการจองที่สอง)
          setDraft(emptyDraft(holdDefault))
          setMaxStep(1)
          setRestored(false)
          writeStorage(null)
        } else {
          // เปิดฟอร์มใหม่จากลิงก์ (มีค่าเติมไว้) → เก็บสิ่งที่กรอกไว้ แค่เปลี่ยนเป็นรหัสคำขอใหม่
          persist(draftRef.current)
        }
      }
    })()
    // อ่าน sessionStorage ครั้งเดียวตอนเปิดหน้า
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!create || !hydrated || done) return
    const t = setTimeout(() => persist(draft), 250)
    return () => clearTimeout(t)
  }, [create, hydrated, done, draft, persist])

  // ===== ค่าที่คำนวณจากฟอร์ม =====
  const pickupChanged = create || !booking || draft.pickup !== booking.pickup_date
  const datesCheck = useMemo(() => checkDates(draft, today, pickupChanged), [draft, today, pickupChanged])
  const head = useMemo(() => headPayload(draft), [draft])
  const ordered = useMemo(() => orderedLines(draft.lines), [draft.lines])
  const quotePayload = useMemo(() => {
    const p: Record<string, unknown> = { ...head.payload, lines: linesPayload(draft.lines) }
    if (bookingId) p.booking_id = bookingId
    return p
  }, [head, draft.lines, bookingId])
  const quoteSig = useMemo(() => JSON.stringify(quotePayload), [quotePayload])
  const quoteKeys = useMemo(() => ordered.map(l => l.key).join(','), [ordered])
  const canQuote = datesCheck.ok && draft.lines.length > 0 && head.ok
  // กด "คำนวณใหม่" (หลังคำนวณไม่สำเร็จ) → ถามซ้ำด้วยข้อมูลเดิม
  const [quoteRetry, setQuoteRetry] = useState(0)

  // ===== ราคาล่วงหน้า (rental_quote) — รอหยุดแก้ก่อนค่อยถาม =====
  // ไม่มีอะไรให้คิดราคา (ยังไม่มีชุด/วันผิด) → ล้างยอดเก่าทิ้ง ; แค่ช่องเงินผิดชั่วคราว → เก็บยอดเก่าไว้ (แสดงจางๆ ว่ายังไม่สด)
  const quoteClear = !datesCheck.ok || draft.lines.length === 0
  useEffect(() => {
    if (!canQuote) {
      quoteReqRef.current++
      setQuote(q => (quoteClear
        ? { sig: '', keys: [], data: null, loading: false, error: '' }
        : q.loading ? { ...q, loading: false } : q))
      return
    }
    const reqId = ++quoteReqRef.current
    setQuote(q => ({ ...q, loading: true }))
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const t = setTimeout(async () => {
      const timer = setTimeout(() => ctrl?.abort(), RPC_TIMEOUT_MS)
      try {
        let req = supabase.rpc('rental_quote', { p_payload: JSON.parse(quoteSig) as Record<string, unknown> })
        if (ctrl) req = req.abortSignal(ctrl.signal)
        const { data, error } = await req
        if (reqId !== quoteReqRef.current) return
        if (error) throw error
        setQuote({
          sig: quoteSig,
          keys: quoteKeys ? quoteKeys.split(',') : [],
          data: parseQuote(data),
          loading: false,
          error: '',
        })
      } catch (err) {
        if (reqId !== quoteReqRef.current) return
        setQuote({
          sig: quoteSig,
          keys: [],
          data: null,
          loading: false,
          error: ctrl?.signal.aborted ? 'คำนวณยอดไม่สำเร็จ (เซิร์ฟเวอร์ตอบช้า) — แก้ข้อมูลเล็กน้อยหรือกดคำนวณใหม่' : errText(err),
        })
      } finally {
        clearTimeout(timer)
      }
    }, QUOTE_DEBOUNCE_MS)
    return () => {
      clearTimeout(t)
      ctrl?.abort()
    }
  }, [supabase, canQuote, quoteClear, quoteSig, quoteKeys, quoteRetry])

  const quoteFresh = quote.sig === quoteSig && quote.data !== null && !quote.loading
  // ราคา/สถานะต่อบรรทัด (quote.lines เรียงตามลำดับที่ส่ง = quote.keys) — รวมการจับบรรทัดฟรีไซส์ที่จะได้ชิ้นผิดไซส์
  const lineQuotes = useMemo(() => mapLineQuotes(quote.data, quote.keys, draft.lines), [quote, draft.lines])
  const quoteOf = useCallback((key: string): LineQuote | null => lineQuotes.get(key) ?? null, [lineQuotes])
  const unavailableCount = quoteFresh ? Array.from(lineQuotes.values()).filter(l => !l.available).length : 0
  const discountTooBig = quoteFresh && quote.data !== null && head.discount > quote.data.rent_total + 0.005

  // ===== ชิ้นที่ว่างของชุดในตะกร้า (ใช้เป็นตัวเลือก "เปลี่ยนชิ้น") — ล้างเมื่อเปลี่ยนวัน =====
  const datesKey = datesCheck.ok ? `${draft.pickup}|${draft.ret}` : ''
  const datesKeyRef = useRef(datesKey)
  datesKeyRef.current = datesKey
  const cartItemIds = useMemo(() => Array.from(new Set(draft.lines.map(l => l.item_id))).sort().join(','), [draft.lines])

  const mergeAvail = useCallback((sig: string, items: readonly FindUnitsItem[], asked: readonly string[]) => {
    setAvail(prev => {
      const base = prev.sig === sig ? prev : { sig, map: new Map<string, FindUnitsItem>(), fetched: new Set<string>() }
      const map = new Map(base.map)
      const fetched = new Set(base.fetched)
      for (const it of items) {
        map.set(it.item_id, it)
        fetched.add(it.item_id)
      }
      for (const id of asked) fetched.add(id)
      return { sig, map, fetched }
    })
  }, [])

  useEffect(() => {
    if (!datesKey || !cartItemIds) return
    const have = avail.sig === datesKey ? avail.fetched : new Set<string>()
    const missing = cartItemIds.split(',').filter(id => !have.has(id))
    if (missing.length === 0) return
    const reqId = ++availReqRef.current
    const [p, r] = datesKey.split('|')
    const t = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc('rental_find_units', {
          p_pickup: p,
          p_return: r,
          p_item_ids: missing,
          p_search: null,
          p_category_id: null,
          p_exclude_booking: bookingId,
        })
        if (reqId !== availReqRef.current || error) return
        mergeAvail(datesKey, parseFindUnits(data).items, missing)
      } catch {
        // โหลดตัวเลือกชิ้นไม่ได้ = เลือกชิ้นเองไม่ได้ชั่วคราว (ระบบยังเลือกชิ้นที่ว่างให้อัตโนมัติ)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [supabase, datesKey, cartItemIds, avail.sig, avail.fetched, bookingId, mergeAvail])

  const onSeen = useCallback((items: readonly FindUnitsItem[]) => {
    const sig = datesKeyRef.current
    if (sig) mergeAvail(sig, items, [])
  }, [mergeAvail])

  const availMap = avail.sig === datesKey ? avail.map : undefined

  // ===== ตะกร้า =====
  const addLine = useCallback((item: FindUnitsItem, s: FindUnitsSize) => {
    setSubmitError('')
    setDraft(d => {
      const line = newCartLine(d.lines, item, s, newUuid())
      return line ? { ...d, lines: [...d.lines, line] } : d
    })
    setLinesMsg(`เพิ่ม ${item.code} ไซส์ ${sizeLabel(s.size)} แล้ว`)
  }, [])

  const removeLine = useCallback((key: string) => {
    setSubmitError('')
    const l = draftRef.current.lines.find(x => x.key === key)
    if (l) setLinesMsg(`เอา ${l.item_code} ไซส์ ${sizeLabel(l.size)} ออกแล้ว`)
    setDraft(d => ({ ...d, lines: d.lines.filter(x => x.key !== key) }))
  }, [])

  const setUnit = useCallback((key: string, u: { unit_id: string; unit_code: string; size: string | null } | null) => {
    setSubmitError('')
    setDraft(d => ({
      ...d,
      lines: d.lines.map(l => (l.key === key ? chooseUnit(l, u) : l)),
    }))
  }, [])

  // ===== ลูกค้า =====
  const cust = draft.customerMode === 'existing' ? draft.customer : null
  // ลูกค้าใหม่: ค้นลูกค้าในระบบที่ใช้เบอร์เดียวกัน (ทำที่ฟอร์มหลัก ไม่ขึ้นกับว่าขั้นลูกค้าเปิดอยู่)
  // เบอร์ตรงกับลูกค้าบัญชีดำ = ต้องยืนยันเหมือนเลือกลูกค้าคนนั้นเอง (ไม่งั้นแค่กด "ลูกค้าใหม่" ก็จองให้คนในบัญชีดำได้)
  const ncDigits = draft.customerMode === 'new' ? phoneDigits(draft.newCustomer.phone) : ''
  const dupWanted = ncDigits.length >= 9 && ncDigits.length <= 15 ? ncDigits : ''
  const [dupState, setDupState] = useState<{ digits: string; list: CustomerLite[]; failed: boolean }>({ digits: '', list: [], failed: false })
  // กดตรวจเบอร์ซ้ำ (ครั้งก่อนตรวจไม่สำเร็จ) → เพิ่มค่านี้ให้ค้นใหม่
  const [dupRetry, setDupRetry] = useState(0)
  // ฐานข้อมูลปฏิเสธเพราะเบอร์ตรงกับลูกค้าบัญชีดำ (หน้าจอหาไม่เจอ/ตรวจไม่ได้) → เปิดช่องติ๊กยืนยันของเบอร์นั้น
  const [serverBlack, setServerBlack] = useState<{ digits: string; message: string } | null>(null)
  const dupReqRef = useRef(0)
  useEffect(() => {
    setAck(false)
    if (!dupWanted) return
    const reqId = ++dupReqRef.current
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    let timer: ReturnType<typeof setTimeout> | undefined
    const t = setTimeout(async () => {
      let list: CustomerLite[] = []
      let failed = false
      timer = setTimeout(() => ctrl?.abort(), LOOKUP_TIMEOUT_MS)
      try {
        // บัญชีดำขึ้นก่อน — มีลูกค้าเบอร์เดียวกันหลายคน คนในบัญชีดำต้องไม่หลุดจาก 3 รายการแรก
        let req = supabase
          .from('rental_customers')
          .select(CUSTOMER_LITE_COLUMNS)
          .or(`phone.eq.${dupWanted},phone2.eq.${dupWanted}`)
          .order('is_blacklisted', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(3)
        if (ctrl) req = req.abortSignal(ctrl.signal)
        const { data, error } = await req
        if (error) throw error
        for (const r of (data ?? []) as unknown[]) {
          const c = toCustomerLite(r)
          if (c) list.push(c)
        }
      } catch {
        // ตรวจเบอร์ไม่ได้ = ไม่รู้ (ไม่ขวาง — ฐานข้อมูลตรวจบัญชีดำซ้ำตอนบันทึก) ; ให้กดตรวจใหม่ได้
        list = []
        failed = true
      } finally {
        clearTimeout(timer)
      }
      if (reqId === dupReqRef.current) setDupState({ digits: dupWanted, list, failed })
    }, 300)
    return () => {
      clearTimeout(t)
      clearTimeout(timer)
      ctrl?.abort()
    }
  }, [supabase, dupWanted, dupRetry])
  const dupes = dupWanted && dupState.digits === dupWanted ? dupState.list : []
  const dupLookupFailed = !!dupWanted && dupState.digits === dupWanted && dupState.failed
  const retryDupLookup = useCallback(() => {
    setDupState(s => ({ ...s, digits: '' }))
    setDupRetry(n => n + 1)
  }, [])
  // ยังตรวจเบอร์นี้ไม่เสร็จ → ยังบันทึก/ไปต่อไม่ได้ (รอไม่ถึงวินาที) กันกดผ่านก่อนรู้ว่าเป็นบัญชีดำ
  const dupPending = !!dupWanted && dupState.digits !== dupWanted
  const serverBlackMsg = draft.customerMode === 'new' && serverBlack && serverBlack.digits === dupWanted ? serverBlack.message : null
  const blackDupe = dupes.some(c => c.is_blacklisted) || serverBlackMsg !== null
  const needsAck = draft.customerMode === 'new'
    ? blackDupe
    : !!cust && cust.is_blacklisted && (create || !booking || cust.id !== booking.customer.id)
  const newCustCheck = useMemo(() => checkCustomerDraft(draft.newCustomer), [draft.newCustomer])
  const customerOk = draft.customerMode === 'existing'
    ? cust !== null && (!needsAck || ack)
    : newCustCheck.ok && !dupPending && (!needsAck || ack)

  // ===== ความพร้อมของแต่ละขั้น =====
  const holdProblem = create && draft.status === 'pending' && holdHoursValue(draft.holdHours) === null
    ? `ใส่จำนวนชั่วโมง 1 ถึง 168`
    : null
  const plan = useMemo(
    () => (create ? planPayments(draft, quoteFresh ? quote.data : null) : { ok: true, problem: null, rentAmount: 0, securityAmount: 0, payments: [] }),
    [create, draft, quoteFresh, quote.data],
  )
  const stepOk = (n: WizardStep): boolean => {
    if (n === 1) return datesCheck.ok
    if (n === 2) return draft.lines.length > 0 && draft.lines.length <= MAX_BOOKING_LINES && unavailableCount === 0
    if (n === 3) return customerOk
    return head.ok && quoteFresh && unavailableCount === 0 && !discountTooBig && holdProblem === null && plan.ok
  }
  const canSubmit = !busy && !done && stepOk(1) && stepOk(2) && stepOk(3) && stepOk(4) && hydrated

  const scrollTop = useCallback(() => {
    requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: 'start' }))
  }, [])

  const goStep = useCallback((n: WizardStep) => {
    setDraft(d => ({ ...d, step: n }))
    setMaxStep(m => (n > m ? n : m))
    scrollTop()
  }, [scrollTop])

  function canGo(n: WizardStep): boolean {
    if (busy || done) return false
    if (!create) return true
    if (n > maxStep) return false
    for (let i = 1 as WizardStep; i < n; i = (i + 1) as WizardStep) {
      if (!stepOk(i)) return false
    }
    return true
  }

  function next() {
    if (step >= 4) return
    if (!stepOk(step)) {
      setTried(t => ({ ...t, [step]: true }))
      return
    }
    goStep((step + 1) as WizardStep)
  }

  function back() {
    if (step <= 1) return
    goStep((step - 1) as WizardStep)
  }

  // ===== บันทึก =====
  function customerPart(): Record<string, unknown> {
    if (draft.customerMode === 'existing' && cust) return { customer_id: cust.id }
    return { customer: customerPayload(draft.newCustomer) }
  }

  // เบอร์ลูกค้าใหม่ตรงกับบัญชีดำ (ฐานข้อมูลบอก) → ต้องติ๊กยืนยันใหม่ก่อนส่งซ้ำ (ส่ง force)
  function noteServerBlacklist(msg: string) {
    if (draft.customerMode !== 'new' || !dupWanted || !BLACK_PHONE_RE.test(msg)) return
    setServerBlack({ digits: dupWanted, message: msg })
    setAck(false)
  }

  function showError(msg: string) {
    setSubmitError(msg)
    requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: 'nearest' }))
  }

  function finish(id: string) {
    setDone(true)
    if (create) writeStorage(null)
    router.replace(`/rental/bookings/${id}`)
    // หน้าการจองอาจถูกจำไว้ในเครื่อง (เปิดดูก่อนกดแก้ไข) → โหลดใหม่ให้เห็นข้อมูลล่าสุด + ตัวเลขบนเมนู
    router.refresh()
  }

  // พบการจองของรหัสคำขอนี้ แต่ข้อมูลไม่ใช่ฟอร์มตอนนี้ → แสดงการจองนั้น + ใช้รหัสใหม่ ให้ผู้ใช้ตรวจแล้วกดบันทึกเองอีกครั้ง
  function otherSaved(b: { id: string; booking_no: string }) {
    setPrevSaved({ ...b, kind: 'other' })
    newRequestId()
    persist(draftRef.current)
    showError(OTHER_SAVED_MSG)
    requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: 'start' }))
  }

  async function doCreate() {
    if (busyRef.current || done) return
    busyRef.current = true
    setBusy(true)
    setSubmitError('')
    const cid = cidRef.current
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = setTimeout(() => ctrl?.abort(), RPC_TIMEOUT_MS)
    let finished = false
    try {
      const payload: Record<string, unknown> = {
        ...head.payload,
        ...customerPart(),
        lines: linesPayload(draft.lines),
        source: draft.source,
        status: draft.status,
      }
      if (draft.status === 'pending') payload.hold_hours = holdHoursValue(draft.holdHours)
      if (needsAck && ack) payload.force = true
      if (plan.payments.length > 0) payload.payments = plan.payments
      const sig = payloadSig(payload)
      // ส่งซ้ำ "ข้อมูลเดิมทุกครั้ง" เท่านั้นที่ถือว่าการจองของรหัสนี้เป็นของฟอร์มนี้
      // (ฐานข้อมูลคืนการจองเดิมเมื่อได้ client_id ซ้ำโดยไม่ดูข้อมูล — ฟอร์มถูกเปลี่ยน/ล้างหลังส่ง = อาจเป็นการจองอื่น)
      const sentBefore = sigsRef.current
      const retryOfSame = sentBefore.length > 0 && sentBefore.every(s => s === sig)
      // ครั้งก่อนไม่รู้ผล → ตรวจก่อนว่าการจองรหัสนี้บันทึกไปแล้วหรือยัง (บันทึกแล้ว = ไม่ส่งซ้ำ)
      if (inflightRef.current) {
        let found: { id: string; booking_no: string } | null
        try {
          found = await findByClientId(cid)
        } catch {
          // ตรวจไม่ได้ = ยังไม่รู้ผลของครั้งก่อน → ห้ามส่งใหม่ (ธง "กำลังส่ง" คงไว้)
          showError('ตรวจสอบการบันทึกครั้งก่อนไม่สำเร็จ (เน็ตหลุด?) — รอสักครู่แล้วกดบันทึกอีกครั้ง ระบบจะไม่สร้างการจองซ้ำ')
          return
        }
        if (found) {
          if (retryOfSame) {
            finished = true
            finish(found.id)
          } else {
            otherSaved(found)
          }
          return
        }
        // ไม่พบ = ครั้งก่อนไม่ได้บันทึก → ส่งด้วยรหัสเดิม (ถ้าคำขอเก่ายังค้างอยู่ในระบบ ฐานข้อมูลบันทึกได้แค่รายการเดียว)
      }
      if (!sentBefore.includes(sig)) sigsRef.current = [...sentBefore, sig].slice(-MAX_SENT_SIGS)
      // ตั้งธง "กำลังส่ง" ก่อนส่งจริง (ปิดหน้า/เน็ตหลุดกลางทาง → เปิดใหม่ระบบตรวจรหัสนี้ก่อน)
      inflightRef.current = true
      persist(draftRef.current)
      let req = supabase.rpc('rental_create_booking', { p_client_id: cid, p_payload: payload })
      if (ctrl) req = req.abortSignal(ctrl.signal)
      const { data, error } = await req
      if (error) throw error
      const res = parseCreateBookingResult(data)
      if (!res) {
        showError(PARTIAL_MSG)
        return
      }
      // รหัสนี้มีการจองอยู่แล้ว: ฐานข้อมูลเทียบลายนิ้วมือของข้อมูลที่บันทึกไว้ (payload_matches) — เชื่อฐานข้อมูลก่อน
      //   ไม่รู้ (null = การจองเก่าก่อนมีลายนิ้วมือ) → ใช้การตรวจฝั่งหน้าจอ (ส่งข้อมูลเดิมทุกครั้งหรือไม่)
      //   ไม่ตรง (ฟอร์มถูกเปลี่ยนหลังส่ง / แท็บที่ทำซ้ำมา) → ห้ามถือว่าบันทึกแล้ว
      if (res.already_saved && !(res.payload_matches ?? retryOfSame)) {
        otherSaved({ id: res.booking.id, booking_no: res.booking.booking_no })
        return
      }
      finished = true
      finish(res.booking.id)
    } catch (err) {
      if (definitelyNotSaved(err)) {
        // ปฏิเสธแน่นอน = ไม่ได้บันทึกอะไร (รหัสเดิมใช้ต่อได้ แก้ข้อมูลแล้วกดใหม่ได้เลย)
        inflightRef.current = false
        sigsRef.current = []
        persist(draftRef.current)
        noteServerBlacklist(errText(err))
        showError(errText(err))
      } else if (serverAnswered(err)) {
        showError(errText(err))
      } else {
        showError(UNSURE_MSG)
      }
    } finally {
      clearTimeout(timer)
      if (!finished) {
        busyRef.current = false
        setBusy(false)
      }
    }
  }

  async function doUpdate() {
    if (busyRef.current || done || !booking) return
    busyRef.current = true
    setBusy(true)
    setSubmitError('')
    setChangedElsewhere(false)
    setConflict(false)
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = setTimeout(() => ctrl?.abort(), RPC_TIMEOUT_MS)
    let finished = false
    let sentPayload: Record<string, unknown> = {}
    try {
      const body: Record<string, unknown> = {
        ...head.payload,
        ...customerPart(),
        lines: linesPayload(draft.lines),
      }
      if (needsAck && ack) body.force = true
      // รหัสคำขอแก้ไข: ข้อมูลชุดเดิม = รหัสเดิม (ส่งซ้ำหลังเน็ตหลุด ฐานข้อมูลคืนผลเดิม ไม่ชนล็อกเวอร์ชันของตัวเอง)
      //   ข้อมูลเปลี่ยน = รหัสใหม่ ; ได้คำตอบจากฐานข้อมูลแล้ว (สำเร็จ/ปฏิเสธ) = ล้าง
      const sig = payloadSig(body)
      if (!editReqRef.current || editReqRef.current.sig !== sig) editReqRef.current = { id: newUuid(), sig }
      const payload: Record<string, unknown> = { ...body, client_id: editReqRef.current.id }
      sentPayload = payload
      let req = supabase.rpc('rental_update_booking', {
        p_booking_id: booking.id,
        p_updated_at: booking.updated_at,
        p_payload: payload,
      })
      if (ctrl) req = req.abortSignal(ctrl.signal)
      const { data, error } = await req
      if (error) throw error
      // บันทึกแล้ว (อ่านผลไม่ได้ก็ไม่เป็นไร — หน้ารายละเอียดโหลดข้อมูลจริงอีกครั้ง)
      parseBookingResult(data)
      finished = true
      finish(booking.id)
    } catch (err) {
      // ไม่รู้ผล หรือชนล็อกเวอร์ชัน → ดูการจองล่าสุดก่อน: เวอร์ชันเปลี่ยนและตรงกับที่เราส่งทุกช่อง = การบันทึกของเราเองผ่านไปแล้ว
      // (กดซ้ำหลังเน็ตหลุด จะชนล็อกเวอร์ชันของตัวเอง — ไม่ใช่ "เครื่องอื่นแก้")
      const answered = serverAnswered(err)
      // ฐานข้อมูลตอบแล้ว = รหัสนี้ไม่ได้บันทึกอะไร (ตรวจรหัสก่อนสถานะ/เวอร์ชัน) → ครั้งถัดไปใช้รหัสใหม่
      if (answered) editReqRef.current = null
      const msg = answered ? errText(err) : UNSURE_EDIT_MSG
      if (answered) noteServerBlacklist(msg)
      const isConflict = answered && msg.includes(CONFLICT_MARK)
      if (!answered || isConflict) {
        let latest: RentalBooking | null = null
        try {
          const { data, error } = await supabase.rpc('rental_get_booking', { p_booking_id: booking.id })
          if (!error) latest = parseRentalBooking(data)
        } catch {
          latest = null
        }
        if (latest && latest.updated_at !== booking.updated_at && bookingMatchesEdit(latest, sentPayload)) {
          finished = true
          finish(booking.id)
          return
        }
        if (latest && latest.updated_at !== booking.updated_at) {
          // เปลี่ยนไปเป็นข้อมูลอื่น = เครื่องอื่นแก้ → ให้ไปดูการจองล่าสุดก่อน (ไม่บันทึกทับ)
          if (isConflict) setConflict(true)
          setChangedElsewhere(true)
          showError(isConflict ? msg : 'ข้อมูลการจองเปลี่ยนไปแล้ว (อาจแก้จากเครื่องอื่น) — เปิดดูการจองล่าสุดก่อนแก้ต่อ')
          return
        }
        if (isConflict) setConflict(true)
        // ตรวจไม่ได้/ยังไม่เปลี่ยน — ส่งซ้ำได้อย่างปลอดภัย (ล็อกเวอร์ชันกันบันทึกทับ)
      }
      showError(msg)
    } finally {
      clearTimeout(timer)
      if (!finished) {
        busyRef.current = false
        setBusy(false)
      }
    }
  }

  function submit() {
    if (!canSubmit) {
      setTried(t => ({ ...t, 1: true, 2: true, 3: true, 4: true }))
      // พาไปขั้นแรกที่ยังไม่ครบ
      for (const n of [1, 2, 3] as WizardStep[]) {
        if (!stepOk(n)) {
          goStep(n)
          return
        }
      }
      return
    }
    if (create) {
      if (plan.payments.length > 0) {
        setPayConfirm(true)
        return
      }
      void doCreate()
    } else {
      void doUpdate()
    }
  }

  async function resetDraft() {
    if (busyRef.current || done) return
    if (inflightRef.current) {
      // ยังมีคำขอที่ไม่รู้ผล → ต้องรู้ก่อนว่าบันทึกไปแล้วหรือยัง (ห้ามเปลี่ยนรหัสคำขอทั้งที่ยังไม่รู้ผล)
      busyRef.current = true
      setBusy(true)
      const cid = cidRef.current
      let found: { id: string; booking_no: string } | null = null
      try {
        found = await findByClientId(cid)
      } catch {
        busyRef.current = false
        setBusy(false)
        setResetConfirm(false)
        showError(RESET_UNSURE_MSG)
        return
      }
      busyRef.current = false
      setBusy(false)
      if (found && cidRef.current === cid) {
        setPrevSaved({ ...found, kind: 'restored' })
        newRequestId()
      }
      // ไม่พบ = ยังไม่ได้บันทึก → คงรหัสเดิม + ลายเซ็นเดิมไว้ (ถ้าคำขอเก่าเพิ่งบันทึกทีหลัง ฟอร์มใหม่จะไม่ถูกมองว่าเป็นการจองนั้น)
    } else {
      newRequestId()
    }
    const d = emptyDraft(holdDefault)
    setDraft(d)
    setMaxStep(1)
    setTried({})
    setAck(false)
    setRestored(false)
    setDupTab(false)
    setFocusItemId(null)
    setSubmitError('')
    setResetConfirm(false)
    persist(d)
    scrollTop()
  }

  // ===== แสดงผล =====
  const q = quote.data
  // แก้ไข: ก่อนคำนวณใหม่เสร็จ ใช้ยอดเดิมของการจอง (ไม่ให้แถบล่างว่าง)
  const grandShown = q ? q.grand_total : !create && booking ? booking.money.grand_total : null
  const days = datesCheck.ok ? datesCheck.days : 0
  const nextLabel = step === 1 ? 'เลือกชุด' : step === 2 ? 'ข้อมูลลูกค้า' : 'สรุปยอด'
  const tryStep = tried[step] === true

  const cartNode = (
    <CartList
      lines={draft.lines}
      quoteOf={quoteOf}
      quoteLoading={quote.loading}
      availability={availMap}
      onRemove={removeLine}
      onSetUnit={setUnit}
      disabled={busy || done}
    />
  )

  const moneyNode = (
    <MoneySummary
      quote={q}
      loading={quote.loading || (q !== null && !quoteFresh)}
      error={quote.sig === quoteSig ? quote.error : ''}
      securityOverridden={draft.securityOverrideOn}
      paid={!create && booking ? booking.money.paid : undefined}
      securityHeld={!create && booking ? booking.money.security_held : undefined}
      payNow={create ? plan.rentAmount : undefined}
      securityNow={create ? plan.securityAmount : undefined}
    />
  )

  const quoteErrorBox = quote.error && quote.sig === quoteSig && (
    <div role="alert" className="alert-err">
      <XCircle {...ICON_SM} />
      <div className="min-w-0 space-y-2">
        <p className="break-words">{quote.error}</p>
        <button type="button" className="btn-secondary px-4 text-sm" onClick={() => setQuoteRetry(n => n + 1)}>
          <RefreshCw {...ICON_SM} />
          คำนวณใหม่
        </button>
      </div>
    </div>
  )

  return (
    <div ref={rootRef} className="space-y-4 scroll-mt-4">
      {/* ===== ประกาศด้านบน ===== */}
      {prevSaved && (
        <div className="alert-ok" role="status">
          <CheckCircle2 {...ICON_SM} />
          <div className="min-w-0 space-y-2">
            {prevSaved.kind === 'restored' ? (
              <p>การจองที่กดบันทึกไว้ครั้งก่อน (ตอนเน็ตหลุด) บันทึกสำเร็จแล้ว — เลขที่ <b className="font-mono">{prevSaved.booking_no}</b></p>
            ) : (
              <p>
                มีการจองที่บันทึกด้วยคำขอครั้งก่อนแล้ว — เลขที่ <b className="font-mono">{prevSaved.booking_no}</b>
                {' '}(ฟอร์มด้านล่างยังไม่ได้บันทึก)
              </p>
            )}
            <Link href={`/rental/bookings/${prevSaved.id}`} className="btn-secondary px-4 text-sm">
              <ExternalLink {...ICON_SM} />
              เปิดการจองนั้น
            </Link>
          </div>
        </div>
      )}
      {dupTab && !prevSaved && (
        <div className="alert-warn" role="status">
          <AlertTriangle {...ICON_SM} />
          <div className="min-w-0 flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0">
              แท็บนี้เปิดซ้ำมาจากแท็บที่กำลังบันทึกการจองนี้อยู่ — ดูผลที่แท็บเดิม ถ้ากดบันทึกที่แท็บนี้จะเป็นการจองใหม่อีกรายการ
            </p>
            <button type="button" className="btn-ghost px-3 text-sm" onClick={() => setResetConfirm(true)} disabled={busy}>
              <RotateCcw {...ICON_SM} />
              ล้างและเริ่มใหม่
            </button>
          </div>
        </div>
      )}
      {restored && !prevSaved && !dupTab && (
        <div className="alert-info" role="status">
          <Info {...ICON_SM} />
          <div className="min-w-0 flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0">กู้ข้อมูลที่กรอกค้างไว้ในแท็บนี้กลับมาแล้ว</p>
            <button type="button" className="btn-ghost px-3 text-sm" onClick={() => setResetConfirm(true)} disabled={busy}>
              <RotateCcw {...ICON_SM} />
              ล้างและเริ่มใหม่
            </button>
          </div>
        </div>
      )}
      {!create && booking && booking.status === 'pending' && (
        <div className="alert-warn" role="note">
          <AlertTriangle {...ICON_SM} />
          <p className="min-w-0">การจองนี้ยังรอยืนยัน{booking.expires_at ? ' — ถ้าหมดเวลาถือคิวก่อนยืนยัน ระบบจะปล่อยชุดคืนอัตโนมัติ' : ''}</p>
        </div>
      )}

      <Stepper step={step} canGo={canGo} onGo={goStep} />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* ===== เนื้อหาของขั้น ===== */}
        <div className="min-w-0 space-y-4">
          {step === 1 && (
            <DatesStep
              draft={draft}
              patch={patch}
              today={today}
              defaultDays={settings.default_base_days}
              check={tryStep || draft.pickup || draft.ret ? datesCheck : { ...datesCheck, problem: null }}
              disabled={busy || done}
            />
          )}

          {step === 2 && datesCheck.ok && (
            <>
              <section className="card overflow-hidden" aria-labelledby="bw-cart-title">
                <div className="card-header flex-wrap">
                  <h2 id="bw-cart-title" className="section-title">
                    <ShoppingBag {...ICON} />
                    ชุดที่เลือก
                    <span className="chip tabular-nums">{draft.lines.length}</span>
                  </h2>
                  <p className="text-xs text-gray-500">
                    {formatThaiDate(draft.pickup)} – {formatThaiDate(draft.ret)} · {days} วัน
                  </p>
                </div>
                <div className="p-3 sm:p-4 space-y-3">
                  {draft.lines.length === 0 ? (
                    <p className={clsx('text-sm', tryStep ? 'font-medium text-red-700' : 'text-gray-500')} role={tryStep ? 'alert' : undefined}>
                      {tryStep ? 'กรุณาเลือกชุดอย่างน้อย 1 รายการ' : 'ยังไม่ได้เลือกชุด — กดปุ่มไซส์ของชุดด้านล่างเพื่อเพิ่ม'}
                    </p>
                  ) : (
                    cartNode
                  )}
                  {unavailableCount > 0 && (
                    <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-red-700">
                      <AlertTriangle {...ICON_SM} className="mt-px shrink-0" />
                      <span className="min-w-0">มีชุดที่ไม่ว่าง {unavailableCount} รายการ — เปลี่ยนชิ้น/ไซส์ เอาออก หรือเปลี่ยนวันก่อนไปต่อ</span>
                    </p>
                  )}
                  {quoteErrorBox}
                </div>
              </section>
              <p className="sr-only" aria-live="polite">{linesMsg}</p>
              <ItemsStep
                supabase={supabase}
                pickup={draft.pickup}
                ret={draft.ret}
                days={days}
                bookingId={bookingId}
                categories={categories}
                lines={draft.lines}
                focusItemId={focusItemId}
                onClearFocus={() => setFocusItemId(null)}
                onAdd={addLine}
                onSeen={onSeen}
                full={draft.lines.length >= MAX_BOOKING_LINES}
                disabled={busy || done}
              />
            </>
          )}
          {step === 2 && !datesCheck.ok && (
            <div className="alert-warn" role="alert">
              <CalendarDays {...ICON_SM} />
              <div className="min-w-0 space-y-2">
                <p>{datesCheck.problem ?? 'กรุณาเลือกวันรับและวันคืนชุดก่อน'}</p>
                <button type="button" className="btn-secondary px-4 text-sm" onClick={() => goStep(1)}>ไปเลือกวัน</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <CustomerStep
              supabase={supabase}
              draft={draft}
              patch={patch}
              needsAck={needsAck}
              ack={ack}
              onAck={setAck}
              dupes={dupes}
              blacklistNotice={serverBlackMsg}
              lookupFailed={dupLookupFailed}
              onRetryLookup={retryDupLookup}
              showErrors={tryStep}
              disabled={busy || done}
            />
          )}

          {step === 4 && (
            <>
              {quoteErrorBox}
              {unavailableCount > 0 && (
                <div role="alert" className="alert-err">
                  <AlertTriangle {...ICON_SM} />
                  <div className="min-w-0 space-y-2">
                    <p>มีชุดที่ไม่ว่างในช่วงวันที่เลือก {unavailableCount} รายการ</p>
                    <button type="button" className="btn-secondary px-4 text-sm" onClick={() => goStep(2)}>ไปแก้รายการชุด</button>
                  </div>
                </div>
              )}
              <SummaryStep
                mode={mode}
                draft={draft}
                patch={patch}
                quote={q}
                cart={<div className="py-1">{draft.lines.length > 0 ? (
                  <CartList lines={draft.lines} quoteOf={quoteOf} quoteLoading={quote.loading} compact />
                ) : <p className="py-3 text-sm text-gray-500">ยังไม่ได้เลือกชุด</p>}</div>}
                money={moneyNode}
                plan={plan}
                holdProblem={holdProblem}
                onEditItems={() => goStep(2)}
                disabled={busy || done}
              />
            </>
          )}

          {/* ===== ผลการบันทึก ===== */}
          <div ref={errorRef} className="scroll-mb-40 space-y-2">
            {submitError && (
              <div role="alert" className="alert-err">
                <XCircle {...ICON_SM} />
                <div className="min-w-0 space-y-2">
                  <p className="break-words">{submitError}</p>
                  {serverBlackMsg && needsAck && (
                    <label className="flex min-h-[44px] cursor-pointer items-start gap-3 select-none">
                      <input
                        type="checkbox"
                        checked={ack}
                        disabled={busy || done}
                        onChange={e => setAck(e.target.checked)}
                        className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
                      />
                      <span className="min-w-0 text-sm font-medium text-gray-900">
                        ยืนยันจองให้ลูกค้าเบอร์นี้ (ระบบบันทึกไว้ในประวัติการจอง) แล้วกดบันทึกอีกครั้ง
                      </span>
                    </label>
                  )}
                  {conflict && (
                    <button type="button" className="btn-secondary px-4 text-sm" onClick={() => router.refresh()}>
                      <RefreshCw {...ICON_SM} />
                      โหลดข้อมูลล่าสุด (ข้อมูลที่แก้ไว้จะหายไป)
                    </button>
                  )}
                  {changedElsewhere && booking && (
                    <Link href={`/rental/bookings/${booking.id}`} className="btn-secondary px-4 text-sm">
                      <ExternalLink {...ICON_SM} />
                      ข้อมูลการจองเปลี่ยนแล้ว — เปิดดูการจอง
                    </Link>
                  )}
                </div>
              </div>
            )}
            {done && (
              <p className="flex items-center gap-2 text-sm text-gray-600" role="status">
                <Loader2 {...ICON_SM} className="animate-spin" />
                บันทึกแล้ว กำลังเปิดหน้าการจอง...
              </p>
            )}
          </div>
        </div>

        {/* ===== แถบสรุปข้างจอ (จอกว้าง) ===== */}
        <aside className="hidden lg:block lg:sticky lg:top-6 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto overscroll-contain" aria-label="สรุปการจอง">
          <div className="card p-4 xl:p-5 space-y-4">
            <h2 className="section-title">
              <ShoppingBag {...ICON} />
              สรุปการจอง
            </h2>
            <div className="space-y-1 text-sm">
              <p className="flex items-center gap-2 text-gray-600">
                <CalendarDays {...ICON_SM} className="shrink-0 text-brand-600" />
                {datesCheck.ok ? (
                  <span className="min-w-0 tabular-nums">
                    {formatThaiDate(draft.pickup)} – {formatThaiDate(draft.ret)} <span className="text-gray-500">({days} วัน)</span>
                  </span>
                ) : (
                  <span className="text-gray-400">ยังไม่ได้เลือกวัน</span>
                )}
              </p>
              <p className="flex items-center gap-2 text-gray-600">
                <UserRound {...ICON_SM} className="shrink-0 text-brand-600" />
                {draft.customerMode === 'existing' && cust ? (
                  <span className="min-w-0 break-words">
                    {cust.name}
                    {cust.phone && <span className="text-gray-500 tabular-nums"> · {formatPhone(cust.phone)}</span>}
                    {cust.is_blacklisted && <span className="badge-out ml-1">บัญชีดำ</span>}
                  </span>
                ) : draft.customerMode === 'new' && draft.newCustomer.name.trim() ? (
                  <span className="min-w-0 break-words">{draft.newCustomer.name.trim()} <span className="chip ml-1">ลูกค้าใหม่</span></span>
                ) : (
                  <span className="text-gray-400">ยังไม่ได้เลือกลูกค้า</span>
                )}
              </p>
            </div>
            {draft.lines.length > 0 ? (
              <CartList lines={draft.lines} quoteOf={quoteOf} quoteLoading={quote.loading} compact />
            ) : (
              <p className="text-sm text-gray-400">ยังไม่ได้เลือกชุด</p>
            )}
            <hr className="divider !my-0" />
            {moneyNode}
          </div>
        </aside>
      </div>

      {/* ===== แถบล่าง: ยอดรวม + ปุ่มย้อนกลับ/ถัดไป/บันทึก ===== */}
      <div className="sticky bottom-0 z-20 -mx-3 sm:-mx-4 md:mx-0 bottom-bar px-3 pt-3 pb-3 sm:px-5 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-[env(safe-area-inset-bottom)] after:bg-white">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="min-w-0 flex-1" aria-live="polite">
            <p className="text-[11px] sm:text-xs text-gray-500">
              {draft.lines.length > 0 ? `${draft.lines.length} ชุด${days > 0 ? ` · ${days} วัน` : ''}` : 'ยังไม่ได้เลือกชุด'}
            </p>
            <p className="flex items-center gap-1.5 money text-base sm:text-lg text-gray-900">
              {grandShown !== null && draft.lines.length > 0 ? baht(grandShown) : '-'}
              {quote.loading && <Loader2 size={14} strokeWidth={2} aria-hidden="true" className="animate-spin text-gray-400" />}
            </p>
          </div>
          {step > 1 && (
            <button type="button" onClick={back} disabled={busy || done} className="btn-secondary shrink-0 px-3 sm:px-4">
              <ArrowLeft {...ICON_SM} />
              <span className="hidden sm:inline">ย้อนกลับ</span>
              <span className="sr-only sm:hidden">ย้อนกลับ</span>
            </button>
          )}
          {step < 4 ? (
            <button type="button" onClick={next} disabled={busy || done} className="btn-primary shrink-0 min-h-[48px] px-4 sm:px-6">
              {nextLabel}
              <ArrowRight {...ICON_SM} />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={busy || done || !hydrated}
              aria-disabled={!canSubmit}
              className="btn-primary shrink-0 min-h-[48px] px-4 sm:px-6"
            >
              {busy || done ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Save {...ICON_SM} />}
              {busy ? 'กำลังบันทึก...' : create ? 'บันทึกการจอง' : 'บันทึกการแก้ไข'}
            </button>
          )}
        </div>
        {step === 4 && !canSubmit && !busy && !done && (tried[4] || submitError === '') && (
          <SubmitHint
            reasons={[
              !stepOk(1) ? 'วันรับ-คืนชุดยังไม่ถูกต้อง' : '',
              draft.lines.length === 0 ? 'ยังไม่ได้เลือกชุด' : '',
              unavailableCount > 0 ? 'มีชุดที่ไม่ว่าง' : '',
              !customerOk ? (needsAck && !ack ? 'ต้องติ๊กยืนยันลูกค้าบัญชีดำ' : dupPending && newCustCheck.ok ? 'กำลังตรวจเบอร์โทรลูกค้า' : 'ข้อมูลลูกค้ายังไม่ครบ') : '',
              head.problem ?? '',
              discountTooBig ? 'ส่วนลดเกินค่าเช่ารวม' : '',
              holdProblem ?? '',
              create && !plan.ok && plan.problem ? plan.problem : '',
              canQuote && !quoteFresh && !quote.error ? 'กำลังคำนวณยอดเงิน...' : '',
            ].filter(Boolean)}
          />
        )}
      </div>

      {/* ===== ยืนยันรับเงินพร้อมบันทึก ===== */}
      <ConfirmDialog
        open={payConfirm}
        title="ยืนยันบันทึกการจองและรับเงิน"
        confirmLabel={busy ? 'กำลังบันทึก...' : 'บันทึกและรับเงิน'}
        busy={busy}
        onCancel={() => setPayConfirm(false)}
        onConfirm={() => {
          setPayConfirm(false)
          void doCreate()
        }}
      >
        <p>ตรวจสอบจำนวนเงินที่รับจากลูกค้าก่อนบันทึก — ระบบจะออกใบเสร็จแยกตามรายการ</p>
        <ul className="panel divide-y divide-gray-200 px-3.5">
          {plan.payments.map((p, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                {p.kind === 'security_in' ? PAYMENT_KIND_LABELS.security_in : 'ค่าเช่า / มัดจำ'}
                <span className="block text-xs text-gray-500">{METHOD_LABELS[p.method]}</span>
              </span>
              <span className="money text-gray-900">{baht(p.amount)}</span>
            </li>
          ))}
        </ul>
        <p className="flex items-center justify-between gap-3 font-semibold text-gray-900">
          <span>รวมรับครั้งนี้</span>
          <span className="money text-lg">{baht(round2(plan.rentAmount + plan.securityAmount))}</span>
        </p>
      </ConfirmDialog>

      {/* ===== ล้างฟอร์ม ===== */}
      <ConfirmDialog
        open={resetConfirm}
        title="ล้างข้อมูลที่กรอกไว้ทั้งหมด?"
        confirmLabel="ล้างและเริ่มใหม่"
        tone="danger"
        busy={busy}
        onCancel={() => setResetConfirm(false)}
        onConfirm={() => void resetDraft()}
      >
        <p>วันที่ ชุดที่เลือก ข้อมูลลูกค้า และยอดเงินที่กรอกไว้ในฟอร์มนี้จะหายไป (ยังไม่มีอะไรถูกบันทึกลงระบบ)</p>
      </ConfirmDialog>
    </div>
  )
}

function SubmitHint({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null
  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-amber-800" role="status">
      <Info size={14} strokeWidth={2} aria-hidden="true" className="mt-px shrink-0" />
      <span className="min-w-0">ยังบันทึกไม่ได้: {reasons.join(' · ')}</span>
    </p>
  )
}
