'use client'
// ฟอร์มงาน/การจองร้าน b.oncloud — ใช้ทั้ง "สร้างงาน" (/wedding/bookings/new) และ "แก้ไขงาน" (/wedding/bookings/<id>/edit)
// หน้าเดียวแบ่งเป็นส่วน (ลูกค้า → คิวงาน → แพ็กเกจ → ยอดเงิน → สถานะ/รับเงิน → อื่นๆ) + แถบสรุปข้างจอ/แถบล่าง (ไม่ใช่ wizard)
//
// เงิน/คิวเต็ม/ทีมชนคิว ฐานข้อมูลคำนวณทั้งหมด (wed_quote ดูล่วงหน้า / wed_create_booking / wed_update_booking บันทึกจริง)
// กันบันทึกซ้ำ (แบบเดียวกับฟอร์มการจองร้านเช่าชุด):
//   - สร้างใหม่: client_id สุ่มครั้งเดียวต่อการจอง เก็บใน sessionStorage พร้อมฟอร์มที่กรอกค้าง (รีเฟรชหน้าแล้วไม่หาย)
//     ก่อนส่งตั้งธง "กำลังส่ง" → เน็ตหลุด/ปิดหน้ากลางทาง กลับมากดใหม่ ระบบตรวจก่อนว่างานรหัสนี้บันทึกไปแล้วหรือยัง
//     (บันทึกแล้ว = พาไปหน้างานนั้น ไม่สร้างซ้ำ ไม่รับเงินซ้ำ) ; ฐานข้อมูลเทียบลายนิ้วมือข้อมูล (payload_matches)
//     + หน้าจอเก็บลายเซ็นข้อมูลที่ส่งด้วยรหัสนั้น: พบงานของรหัสนี้แต่ฟอร์มถูกเปลี่ยนหลังส่ง = ไม่ถือว่าบันทึกแล้ว
//     แท็บที่ทำซ้ำมาขณะแท็บเดิมยังถือคำขอที่ไม่รู้ผล → แท็บเดิมตอบผ่าน BroadcastChannel แท็บใหม่เปลี่ยนรหัส
//   - แก้ไข: ล็อกเวอร์ชันด้วย updated_at + payload.client_id (ข้อมูลชุดเดิม = รหัสเดิม → ฐานข้อมูลคืนผลเดิม ไม่ชนล็อกของตัวเอง)
//     ไม่รู้ผล/ชนล็อก → โหลดงานล่าสุดมาเทียบ ตรงกับที่ส่ง = บันทึกแล้ว ไม่ใช่ "เครื่องอื่นแก้"
// คิวเต็ม (hint wed_capacity) / ยืนยันงานก่อนได้มัดจำ (hint wed_deposit) → กล่องยืนยัน แล้วส่งใหม่พร้อม force
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import clsx from 'clsx'
import {
  AlertTriangle, CalendarDays, CheckCircle2, ClipboardList, ExternalLink, Info, Loader2, Package, RefreshCw, RotateCcw, Save,
  UserRound, Users, XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht, formatThaiDate, isDayKey, thaiError } from '@/lib/format'
import { isMigrationMissing } from '@/lib/migration'
import { newUuid } from '@/lib/products'
import {
  FIX07_MISSING_MSG, SESSION_TYPE_SHORT, WED_METHOD_LABELS, WED_STATUS_CHIP, crewConflictText, formatPhone, isCountingStatus,
  parseWedBooking, parseWedCreateBookingResult, parseWedQuote, phoneDigits, sessionTimeText, thaiDayName, wedForceHint,
  type WedAddon, type WedBooking, type WedCrew, type WedPackage, type WedQuote,
} from '@/lib/wedding'
import ConfirmDialog from '@/components/integrations/ConfirmDialog'
import { customersByPhone } from './search'
import {
  DRAFT_MAX_AGE_MS, DRAFT_STORAGE_KEY, MAX_HOLD_HOURS, MAX_SENT_SIGS, SECTIONS, bookingMatchesEdit, checkCore,
  checkCustomerDraft, clampHold, coupleSuggestion, createPayloadOf, draftFromBooking, draftHasContent, emptyDraft,
  holdHoursValue, newDatesOf, parseStoredDraft, planEditable, requestSig, planPayment, quotePayloadOf, sectionDomId,
  updateBodyOf,
  type CoreCtx, type CustomerLite, type FormMode, type PaymentPlan, type SectionId, type SessionDraft, type StoredDraft,
  type WedDraft,
} from './model'
import CustomerSection from './CustomerSection'
import SessionsEditor from './SessionsEditor'
import PackageSection from './PackageSection'
import MoneySection, { DEPOSIT_OVERRIDE_UNSUPPORTED } from './MoneySection'
import StatusSection from './StatusSection'
import OtherSection from './OtherSection'
import QuoteSummary from './QuoteSummary'
import type { SessionHints } from './SessionCard'

export interface FormSettings {
  hold_hours: number
  max_jobs_per_day: number
  balance_due_days: number
}

export interface FormCatalog {
  packages: WedPackage[]
  addons: WedAddon[]
  crew: WedCrew[]
  /** โหลดแพ็กเกจ/บริการเสริมไม่ได้ ('' = ได้) */
  catalogError: string
  /** โหลดรายชื่อทีมงานไม่ได้ ('' = ได้) */
  crewError: string
}

export interface FormPrefill {
  date?: string | null
  customer?: CustomerLite | null
}

const QUOTE_DEBOUNCE_MS = 400
const RPC_TIMEOUT_MS = 30000
const UNSURE_MSG = 'ไม่แน่ใจว่าบันทึกงานแล้วหรือยัง (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — กดบันทึกอีกครั้งได้ ระบบจะตรวจก่อนและไม่สร้างงานซ้ำ'
const PARTIAL_MSG = 'ระบบตอบกลับไม่ครบ — กดบันทึกอีกครั้งเพื่อตรวจสอบ (ระบบจะไม่สร้างงานซ้ำ)'
const UNSURE_EDIT_MSG = 'ไม่แน่ใจว่าบันทึกการแก้ไขแล้วหรือยัง (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — กดบันทึกอีกครั้งได้ ระบบไม่บันทึกทับซ้อน'
const CONFLICT_MARK = 'ถูกแก้ไขจากเครื่องอื่น'
const OTHER_SAVED_MSG = 'พบงานที่บันทึกด้วยคำขอครั้งก่อนแล้ว แต่ข้อมูลในฟอร์มถูกเปลี่ยนหลังจากส่งครั้งนั้น — ฟอร์มนี้ยังไม่ได้บันทึก ' +
  'ตรวจงานนั้นก่อน (ปุ่มด้านบน) ถ้าไม่ใช่งานในฟอร์มนี้ กดบันทึกอีกครั้งเพื่อสร้างงานใหม่'
const RESET_UNSURE_MSG = 'ยังตรวจไม่ได้ว่าการบันทึกครั้งก่อนสำเร็จหรือไม่ (เน็ตหลุด?) — ล้างฟอร์มไม่ได้จนกว่าจะตรวจได้ รอสักครู่แล้วลองใหม่'
// ช่องสื่อสารระหว่างแท็บ: แท็บที่ "ทำซ้ำ" ได้ sessionStorage (รหัสคำขอ) ชุดเดียวกันมา → ถามว่ามีแท็บอื่นถือรหัสนี้อยู่ไหม
const TAB_CHANNEL = 'wedding-booking-cid'
const TAB_ASK_MS = 400
const LOOKUP_TIMEOUT_MS = 10000

/** ถามแท็บอื่นที่เปิดอยู่ว่าใช้รหัสคำขอนี้อยู่หรือไม่ (ไม่รองรับ BroadcastChannel = ถือว่าไม่มี)
 *  ข้อความพก tabId ของผู้ถาม/ผู้ตอบ — ตัวรับของหน้านี้ไม่ตอบคำถามของตัวเอง */
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

// เซิร์ฟเวอร์ปฏิเสธแน่นอน = ทั้งคำขอไม่ได้บันทึกอะไร (wed_create_booking ทำในทรานแซกชันเดียว)
// ยกเว้น: error ชั่วคราวของฐานข้อมูล และ "กำลังบันทึกจากอีกเครื่อง" (คำขอรหัสเดียวกันอีกอันบันทึกไปแล้ว)
function definitelyNotSaved(err: unknown): boolean {
  if (!serverAnswered(err)) return false
  const e = err as { code?: unknown; message?: unknown }
  const code = String(e.code)
  const message = typeof e.message === 'string' ? e.message : ''
  if (/^(08|40|53|55|57|58|XX)/.test(code)) return false
  if (message.includes('กำลังบันทึกจากอีกเครื่อง')) return false
  return true
}

// ข้อความไทยจาก RPC ของเรา (รวมสิทธิ์ 42501) บอกชัดกว่าข้อความกลางของ thaiError
function errText(err: unknown): string {
  if (isMigrationMissing(err)) return FIX07_MISSING_MSG
  const e = err && typeof err === 'object' ? (err as { code?: unknown; message?: unknown }) : null
  if (e && (e.code === '42501' || e.code === 'P0001') && typeof e.message === 'string' && /[฀-๿]/.test(e.message)) return e.message.trim()
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
  /** คีย์คิวงานตามลำดับตอนถาม (จับคู่ this_index ของการชนกันกับการ์ดคิว แม้เลื่อนลำดับหลังถาม) */
  keys: string[]
  data: WedQuote | null
  loading: boolean
  error: string
}

type ForceKind = 'capacity' | 'deposit'
interface ForceDialogState {
  reasons: { kind: ForceKind; text: string }[]
  payment: PaymentPlan | null
}

export default function BookingForm({
  mode,
  today,
  manager,
  settings,
  catalog,
  booking,
  addonQty,
  prefill,
}: {
  mode: FormMode
  today: string
  manager: boolean
  settings: FormSettings
  catalog: FormCatalog
  booking?: WedBooking | null
  /** แก้ไข: จำนวนบริการเสริมจาก JSON ดิบ (rawAddonQtyMap) — จำนวนทศนิยมต้องกลับไปตามเดิม */
  addonQty?: Record<string, number>
  prefill?: FormPrefill
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const create = mode === 'create'
  const holdDefault = clampHold(settings.hold_hours)
  const hasPrefill = !!(prefill && (isDayKey(prefill.date) || prefill.customer))
  const mk = useCallback(() => newUuid(), [])

  const [draft, setDraft] = useState<WedDraft>(() => {
    if (!create && booking) return draftFromBooking(booking, holdDefault, manager, addonQty)
    const d = emptyDraft(holdDefault, prefill && isDayKey(prefill.date) ? prefill.date : '')
    if (prefill?.customer) {
      d.customerMode = 'existing'
      d.customer = prefill.customer
      d.coupleNames = coupleSuggestion(prefill.customer.name, prefill.customer.partner_name)
      if (prefill.customer.source) d.source = prefill.customer.source
    }
    return d
  })
  const [tried, setTried] = useState(false)
  const [quote, setQuote] = useState<QuoteState>({ sig: '', keys: [], data: null, loading: false, error: '' })
  const [quoteRetry, setQuoteRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [done, setDone] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [changedElsewhere, setChangedElsewhere] = useState(false)
  const [forceDialog, setForceDialog] = useState<ForceDialogState | null>(null)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [restored, setRestored] = useState(false)
  // เปิดฟอร์มพร้อมวันที่/ลูกค้าจากลิงก์ (?date= / ?customer=) แต่แท็บนี้มีฟอร์มที่กรอกค้างอยู่ → ให้ผู้ใช้เลือกก่อน
  // ระหว่างรอเลือก ห้ามเขียน sessionStorage (ไม่งั้นฟอร์มว่างจากลิงก์ทับฟอร์มที่กรอกค้างเงียบ ๆ)
  const [draftChoice, setDraftChoice] = useState<WedDraft | null>(null)
  const choiceRef = useRef(false)
  // ฟอร์มตอนนี้คือข้อมูลที่กู้จาก sessionStorage (กู้อัตโนมัติหรือผู้ใช้เลือกกู้) — ถ้าพบว่าคำขอนั้นบันทึกไปแล้วต้องล้างทิ้ง
  const fromStoreRef = useRef(false)
  // 'restored' = งานที่กดบันทึกครั้งก่อน (ตอนเน็ตหลุด) สำเร็จแล้ว ; 'other' = พบงานของคำขอนี้ แต่ฟอร์มตอนนี้เป็นข้อมูลอื่น
  const [prevSaved, setPrevSaved] = useState<{ id: string; booking_no: string; kind: 'restored' | 'other' } | null>(null)
  const [dupTab, setDupTab] = useState(false)
  const [hydrated, setHydrated] = useState(!create)
  const cidRef = useRef('')
  const tabIdRef = useRef('')
  if (!tabIdRef.current) tabIdRef.current = newUuid()
  const inflightRef = useRef(false)
  const sigsRef = useRef<string[]>([])
  // แก้ไขงาน: รหัสคำขอ + ลายเซ็นข้อมูลที่ส่งด้วยรหัสนั้น (ยังไม่รู้ผล)
  const editReqRef = useRef<{ id: string; sig: string } | null>(null)
  const quoteReqRef = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft

  const patch = useCallback((p: Partial<WedDraft>) => {
    setDraft(d => ({ ...d, ...p }))
    setSubmitError('')
  }, [])

  const setSessions = useCallback((fn: (list: SessionDraft[]) => SessionDraft[]) => {
    setDraft(d => ({ ...d, sessions: fn(d.sessions) }))
    setSubmitError('')
  }, [])

  // ===== เก็บ/กู้ฟอร์มที่กรอกค้าง + รหัสคำขอ (สร้างใหม่เท่านั้น) =====
  const persist = useCallback((d: WedDraft) => {
    if (!create || !cidRef.current || choiceRef.current) return
    writeStorage({ v: 1, cid: cidRef.current, inflight: inflightRef.current, sigs: sigsRef.current, savedAt: Date.now(), draft: d })
  }, [create])

  // เปลี่ยนเป็นรหัสคำขอใหม่ (ใช้ได้เฉพาะตอนรู้ผลของรหัสเดิมแน่นอนแล้ว / รหัสเดิมเป็นของแท็บอื่น)
  const newRequestId = useCallback(() => {
    cidRef.current = newUuid()
    inflightRef.current = false
    sigsRef.current = []
  }, [])

  // แท็บนี้ถือรหัสคำขอที่ยังไม่รู้ผล → ตอบแท็บที่ถูกทำซ้ำว่า "รหัสนี้ของฉัน" (แท็บนั้นจะเปลี่ยนเป็นรหัสใหม่)
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
      // คำถามจากฟอร์มนี้เอง (ตอนเปิดหน้า) ห้ามตอบ — ไม่งั้นหน้าเดียวก็คิดว่ามีแท็บอื่นถือรหัสนี้
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

  // ค้นงานจากรหัสคำขอ (ตรวจว่าครั้งก่อนที่ไม่รู้ผลบันทึกไปแล้วหรือยัง) — error/ค้างนาน → throw
  const findByClientId = useCallback(async (cid: string): Promise<{ id: string; booking_no: string } | null> => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = setTimeout(() => ctrl?.abort(), LOOKUP_TIMEOUT_MS)
    let res
    try {
      let req = supabase.from('wed_bookings').select('id, booking_no').eq('client_id', cid)
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
    const pending = stored?.inflight ? stored : null
    if (pending) {
      cidRef.current = pending.cid
      inflightRef.current = true
      sigsRef.current = pending.sigs
    } else {
      newRequestId()
    }
    let restoredNow = false
    const freshDraft = stored?.draft && draftHasContent(stored.draft) && Date.now() - stored.savedAt < DRAFT_MAX_AGE_MS
      ? stored.draft
      : null
    if (freshDraft && !hasPrefill) {
      setDraft(freshDraft)
      setRestored(true)
      restoredNow = true
      fromStoreRef.current = true
    } else if (freshDraft) {
      choiceRef.current = true
      setDraftChoice(freshDraft)
    }
    if (!pending) {
      setHydrated(true)
      return
    }
    // ครั้งก่อนกดบันทึกแล้วไม่รู้ผล → (1) แท็บอื่นที่ยังเปิดอยู่ถือรหัสนี้ไหม (2) บันทึกไปแล้วหรือยัง
    void (async () => {
      const ownedElsewhere = await otherTabOwns(pending.cid, tabIdRef.current)
      if (!ownedElsewhere) setHydrated(true)
      let found: { id: string; booking_no: string } | null = null
      try {
        found = await findByClientId(pending.cid)
      } catch {
        // ตรวจไม่ได้ตอนนี้ — ธง "กำลังส่ง" ยังอยู่ กดบันทึกครั้งถัดไประบบจะตรวจอีกครั้งก่อนส่ง
        found = null
      }
      if (ownedElsewhere && !found) {
        // แท็บเดิมยังจัดการคำขอนั้นอยู่ → แท็บนี้ใช้รหัสใหม่ บันทึกที่นี่ = งานอีกรายการ
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
        // ฟอร์มที่ค้างไว้ = ข้อมูลของงานที่บันทึกไปแล้ว → ไม่ให้เลือกกู้อีก
        if (choiceRef.current) {
          choiceRef.current = false
          setDraftChoice(null)
        }
        if (restoredNow || fromStoreRef.current) {
          // ฟอร์มที่กู้มา = ข้อมูลของงานที่บันทึกไปแล้ว → ล้างทิ้ง (ไม่ให้กดบันทึกซ้ำเป็นงานที่สอง)
          fromStoreRef.current = false
          setDraft(emptyDraft(holdDefault))
          setRestored(false)
          writeStorage(null)
        } else {
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
  const planOpen = planEditable(mode, booking)
  const originalDates = useMemo(
    () => new Map<string, string | null>((booking?.sessions ?? []).map(s => [s.id, s.date])),
    [booking],
  )
  const originalDateList = useMemo(
    () => (booking ? booking.sessions.filter(s => s.status !== 'cancelled' && s.date).map(s => s.date as string) : []),
    [booking],
  )
  // งานที่ไม่ใช่ "สอบถาม"/"เลื่อนงาน" ต้องมีวันที่ทุกคิว (ตรงกับ wed_create_booking / wed_update_booking)
  const requireDates = create ? draft.status !== 'inquiry' : !!booking && booking.status !== 'inquiry' && booking.status !== 'postponed'
  const ctx: CoreCtx = useMemo(() => ({
    mode,
    today,
    requireDates,
    originalDates,
    manager,
    planOpen,
    originalPackageId: booking?.package.id ?? null,
  }), [mode, today, requireDates, originalDates, manager, planOpen, booking])
  const core = useMemo(() => checkCore(draft, ctx), [draft, ctx])
  const custCheck = useMemo(() => checkCustomerDraft(draft.newCustomer), [draft.newCustomer])
  const customerOk = draft.customerMode === 'existing' ? draft.customer !== null : custCheck.ok
  const holdProblem = create && draft.status === 'hold' && holdHoursValue(draft.holdHours) === null
    ? `ใส่จำนวนชั่วโมง 1 ถึง ${MAX_HOLD_HOURS}`
    : null

  const bookingId = booking?.id ?? null
  const quotePayload = useMemo(
    () => quotePayloadOf(core, mode, draft.status, bookingId),
    [core, mode, draft.status, bookingId],
  )
  const quoteSig = useMemo(() => JSON.stringify(quotePayload), [quotePayload])
  const sessionKeys = useMemo(() => draft.sessions.map(s => s.key).join(','), [draft.sessions])
  const canQuote = core.quotable

  // ===== ราคาล่วงหน้า (wed_quote) — รอหยุดแก้ก่อนค่อยถาม ; แค่ช่องผิดชั่วคราว → เก็บยอดเก่าไว้ (แสดงจางๆ) =====
  useEffect(() => {
    if (!canQuote) {
      quoteReqRef.current++
      setQuote(q => (q.loading ? { ...q, loading: false } : q))
      return
    }
    const reqId = ++quoteReqRef.current
    setQuote(q => ({ ...q, loading: true }))
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const t = setTimeout(async () => {
      const timer = setTimeout(() => ctrl?.abort(), RPC_TIMEOUT_MS)
      try {
        let req = supabase.rpc('wed_quote', { p_payload: JSON.parse(quoteSig) as Record<string, unknown> })
        if (ctrl) req = req.abortSignal(ctrl.signal)
        const { data, error } = await req
        if (reqId !== quoteReqRef.current) return
        if (error) throw error
        setQuote({ sig: quoteSig, keys: sessionKeys ? sessionKeys.split(',') : [], data: parseWedQuote(data), loading: false, error: '' })
      } catch (err) {
        if (reqId !== quoteReqRef.current) return
        setQuote(q => ({
          sig: quoteSig,
          keys: q.keys,
          data: null,
          loading: false,
          error: ctrl?.signal.aborted ? 'คำนวณยอดไม่สำเร็จ (เซิร์ฟเวอร์ตอบช้า) — แก้ข้อมูลเล็กน้อยหรือกดคำนวณใหม่' : errText(err),
        }))
      } finally {
        clearTimeout(timer)
      }
    }, QUOTE_DEBOUNCE_MS)
    return () => {
      clearTimeout(t)
      ctrl?.abort()
    }
  }, [supabase, canQuote, quoteSig, sessionKeys, quoteRetry])

  const quoteFresh = quote.sig === quoteSig && quote.data !== null && !quote.loading
  const q = quote.data
  const plan = useMemo<PaymentPlan>(
    () => (create ? planPayment(draft, quoteFresh ? q : null) : { ok: true, problem: null, amount: 0, payments: [] }),
    [create, draft, quoteFresh, q],
  )

  // ===== คิวเต็ม / ทีมชนคิว / มัดจำ =====
  const bookingCounting = create ? !!q?.counts_capacity : !!booking && isCountingStatus(booking.status)
  const newDates = useMemo(() => newDatesOf(draft.sessions, originalDateList), [draft.sessions, originalDateList])
  const capacityForce = !!q && bookingCounting && q.capacity_warnings.some(w => create || newDates.has(w.date))
  const depositShort = create && draft.status === 'confirmed' && !!q && q.money.deposit_required > 0.005 &&
    plan.amount < q.money.deposit_required - 0.005
  const conflictCount = q ? q.crew_conflicts.length : 0

  // คำเตือนของการ์ดคิว: จับคู่ด้วยคีย์คิวตอนถามราคา (ไม่ใช่ลำดับตอนนี้ — เลื่อนคิวแล้วคำเตือนไม่สลับการ์ด)
  const hintsFor = useCallback((_index: number, s: SessionDraft): SessionHints | null => {
    if (!q) return null
    const idx = quote.keys.indexOf(s.key)
    const conflicts = idx >= 0
      ? q.crew_conflicts.filter(c => (c.this_index !== null ? c.this_index === idx + 1 : !!s.id && c.this_session_id === s.id))
      : []
    const cap = isDayKey(s.date) && s.status !== 'cancelled' ? q.capacity_warnings.find(w => w.date === s.date) ?? null : null
    const qs = idx >= 0 ? q.sessions.find(x => x.index === idx + 1) : undefined
    // jobs_that_day (wed_jobs_on) นับทุกงานที่กันคิววันนั้น รวมงานนี้เองถ้าบันทึกวันนั้นไว้แล้ว → หักออกให้เหลือ "งานอื่น"
    let jobs = qs && qs.date === s.date ? qs.jobs_that_day : null
    if (jobs !== null && !create && booking && isCountingStatus(booking.status) && originalDateList.includes(s.date)) {
      jobs = Math.max(0, jobs - 1)
    }
    return {
      conflicts,
      capacity: cap,
      jobsThatDay: jobs,
      capacityLimit: q.capacity || settings.max_jobs_per_day,
      countsCapacity: bookingCounting,
      needsForce: !!cap && bookingCounting && (create || newDates.has(s.date)),
    }
  }, [q, quote.keys, settings.max_jobs_per_day, bookingCounting, create, newDates, booking, originalDateList])

  // ===== ลูกค้าใหม่: ลูกค้าในระบบที่ใช้เบอร์เดียวกัน (เสนอให้ใช้ลูกค้าเดิม — ไม่บังคับ) =====
  const ncDigits = draft.customerMode === 'new' ? phoneDigits(draft.newCustomer.phone) : ''
  const dupWanted = ncDigits.length >= 9 && ncDigits.length <= 15 ? ncDigits : ''
  const [dupState, setDupState] = useState<{ digits: string; list: CustomerLite[]; failed: boolean }>({ digits: '', list: [], failed: false })
  useEffect(() => {
    if (!dupWanted) return
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    let timer: ReturnType<typeof setTimeout> | undefined
    let alive = true
    const t = setTimeout(async () => {
      let list: CustomerLite[] = []
      let failed = false
      timer = setTimeout(() => ctrl?.abort(), LOOKUP_TIMEOUT_MS)
      try {
        list = await customersByPhone(supabase, dupWanted, 3, ctrl?.signal)
      } catch {
        failed = true
      } finally {
        clearTimeout(timer)
      }
      if (alive) setDupState({ digits: dupWanted, list, failed })
    }, 300)
    return () => {
      alive = false
      clearTimeout(t)
      clearTimeout(timer)
      ctrl?.abort()
    }
  }, [supabase, dupWanted])
  const dupes = dupWanted && dupState.digits === dupWanted ? dupState.list : []
  const dupLookupFailed = !!dupWanted && dupState.digits === dupWanted && dupState.failed

  // ===== ความพร้อมก่อนบันทึก =====
  const problems: { section: SectionId; text: string }[] = []
  if (!customerOk) {
    problems.push({ section: 'customer', text: draft.customerMode === 'existing' ? 'ยังไม่ได้เลือกลูกค้า' : 'ข้อมูลลูกค้าใหม่ยังไม่ครบ' })
  }
  problems.push(...core.problems)
  if (holdProblem) problems.push({ section: 'status', text: `ชั่วโมงล็อกคิว: ${holdProblem}` })
  if (create && !plan.ok && plan.problem) problems.push({ section: 'status', text: plan.problem })
  if (quoteFresh && q && !q.discount_ok) problems.push({ section: 'money', text: 'ส่วนลดมากกว่ายอดก่อนส่วนลด' })
  // พิมพ์มัดจำเองแต่ฐานข้อมูลรุ่นเก่าไม่รู้จัก (ผลยังเป็น "อัตโนมัติ") → ห้ามบันทึก ไม่งั้นมัดจำที่พิมพ์หายเงียบ ๆ
  if (quoteFresh && q && draft.depositOverride.trim() !== '' && !core.money.depositOverride && q.money.deposit_source !== 'manual') {
    problems.push({ section: 'money', text: DEPOSIT_OVERRIDE_UNSUPPORTED })
  }
  const problemSections = new Set(problems.map(p => p.section))
  const waitingQuote = core.quotable && !quoteFresh && !quote.error
  const canSubmit = !busy && !done && hydrated && problems.length === 0 && quoteFresh

  const scrollToSection = useCallback((s: SectionId) => {
    requestAnimationFrame(() => {
      document.getElementById(sectionDomId(s))?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
  }, [])

  // ===== บันทึก =====
  function showError(msg: string) {
    setSubmitError(msg)
    requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: 'nearest' }))
  }

  function finish(id: string) {
    setDone(true)
    if (create) writeStorage(null)
    router.replace(`/wedding/bookings/${id}`)
    // หน้างานอาจถูกจำไว้ในเครื่อง (เปิดดูก่อนกดแก้ไข) → โหลดใหม่ให้เห็นข้อมูลล่าสุด + ตัวเลขบนเมนู
    router.refresh()
  }

  // พบงานของรหัสคำขอนี้ แต่ข้อมูลไม่ใช่ฟอร์มตอนนี้ → แสดงงานนั้น + ใช้รหัสใหม่ ให้ผู้ใช้ตรวจแล้วกดบันทึกเองอีกครั้ง
  function otherSaved(b: { id: string; booking_no: string }) {
    setPrevSaved({ ...b, kind: 'other' })
    newRequestId()
    persist(draftRef.current)
    showError(OTHER_SAVED_MSG)
    requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: 'start' }))
  }

  // ฐานข้อมูลบอกว่าต้องกดยืนยันแบบบังคับ (คิวเต็ม / มัดจำไม่ครบ) → เปิดกล่องยืนยัน (ไม่ได้บันทึกอะไร)
  function askForceFromServer(err: unknown): boolean {
    const hint = wedForceHint(err)
    if (hint !== 'capacity' && hint !== 'deposit') return false
    setForceDialog({ reasons: [{ kind: hint, text: errText(err) }], payment: null })
    return true
  }

  async function doCreate(force: boolean) {
    if (busyRef.current || done) return
    // ยังไม่ได้เลือกเรื่องฟอร์มที่กรอกค้าง แต่กดบันทึกฟอร์มตอนนี้ = เลือกใช้ฟอร์มนี้ (ต้องเขียนธง "กำลังส่ง" ลง sessionStorage ได้)
    if (choiceRef.current) {
      choiceRef.current = false
      setDraftChoice(null)
    }
    busyRef.current = true
    setBusy(true)
    setSubmitError('')
    const cid = cidRef.current
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = setTimeout(() => ctrl?.abort(), RPC_TIMEOUT_MS)
    let finished = false
    try {
      const payload = createPayloadOf(draft, core, plan, force)
      // ไม่นับ force (กดยืนยันคำเตือนรอบหลัง ≠ ฟอร์มถูกแก้) — ดู requestSig
      const sig = requestSig(payload)
      // ส่งซ้ำ "ข้อมูลเดิมทุกครั้ง" เท่านั้นที่ถือว่างานของรหัสนี้เป็นของฟอร์มนี้
      const sentBefore = sigsRef.current
      const retryOfSame = sentBefore.length > 0 && sentBefore.every(s => s === sig)
      // ครั้งก่อนไม่รู้ผล → ตรวจก่อนว่างานรหัสนี้บันทึกไปแล้วหรือยัง (บันทึกแล้ว = ไม่ส่งซ้ำ)
      if (inflightRef.current) {
        let found: { id: string; booking_no: string } | null
        try {
          found = await findByClientId(cid)
        } catch {
          showError('ตรวจสอบการบันทึกครั้งก่อนไม่สำเร็จ (เน็ตหลุด?) — รอสักครู่แล้วกดบันทึกอีกครั้ง ระบบจะไม่สร้างงานซ้ำ')
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
      }
      if (!sentBefore.includes(sig)) sigsRef.current = [...sentBefore, sig].slice(-MAX_SENT_SIGS)
      // ตั้งธง "กำลังส่ง" ก่อนส่งจริง (ปิดหน้า/เน็ตหลุดกลางทาง → เปิดใหม่ระบบตรวจรหัสนี้ก่อน)
      inflightRef.current = true
      persist(draftRef.current)
      let req = supabase.rpc('wed_create_booking', { p_client_id: cid, p_payload: payload })
      if (ctrl) req = req.abortSignal(ctrl.signal)
      const { data, error } = await req
      if (error) throw error
      const res = parseWedCreateBookingResult(data)
      if (!res) {
        showError(PARTIAL_MSG)
        return
      }
      // รหัสนี้มีงานอยู่แล้ว: เชื่อลายนิ้วมือของฐานข้อมูลก่อน (null = ไม่รู้ → ใช้การตรวจฝั่งหน้าจอ)
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
        if (!askForceFromServer(err)) showError(errText(err))
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

  async function doUpdate(force: boolean) {
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
      const body = updateBodyOf(draft, core, force)
      // รหัสคำขอแก้ไข: ข้อมูลชุดเดิม = รหัสเดิม (ส่งซ้ำหลังเน็ตหลุด ฐานข้อมูลคืนผลเดิม) ; ข้อมูลเปลี่ยน = รหัสใหม่
      // ไม่นับ force — ฐานข้อมูลก็ไม่นับ (wed_payload_md5) ส่งซ้ำพร้อมยืนยันคำเตือน = คำขอเดิม
      const sig = requestSig(body)
      if (!editReqRef.current || editReqRef.current.sig !== sig) editReqRef.current = { id: newUuid(), sig }
      const payload: Record<string, unknown> = { ...body, client_id: editReqRef.current.id }
      sentPayload = payload
      let req = supabase.rpc('wed_update_booking', {
        p_booking_id: booking.id,
        p_updated_at: booking.updated_at,
        p_payload: payload,
      })
      if (ctrl) req = req.abortSignal(ctrl.signal)
      const { data, error } = await req
      if (error) throw error
      // บันทึกแล้ว (อ่านผลไม่ได้ก็ไม่เป็นไร — หน้ารายละเอียดโหลดข้อมูลจริงอีกครั้ง)
      parseWedCreateBookingResult(data)
      finished = true
      finish(booking.id)
    } catch (err) {
      const answered = serverAnswered(err)
      // ฐานข้อมูลตอบแล้ว = รหัสนี้ไม่ได้บันทึกอะไร → ครั้งถัดไปใช้รหัสใหม่
      if (answered) editReqRef.current = null
      const msg = answered ? errText(err) : UNSURE_EDIT_MSG
      if (answered && askForceFromServer(err)) return
      const isConflict = answered && msg.includes(CONFLICT_MARK)
      if (!answered || isConflict) {
        // ไม่รู้ผล หรือชนล็อกเวอร์ชัน → ดูงานล่าสุดก่อน: เวอร์ชันเปลี่ยนและตรงกับที่เราส่ง = การบันทึกของเราเองผ่านไปแล้ว
        let latest: WedBooking | null = null
        try {
          const { data, error } = await supabase.rpc('wed_get_booking', { p_booking_id: booking.id })
          if (!error) latest = parseWedBooking(data)
        } catch {
          latest = null
        }
        if (latest && latest.updated_at !== booking.updated_at && bookingMatchesEdit(latest, sentPayload)) {
          finished = true
          finish(booking.id)
          return
        }
        if (latest && latest.updated_at !== booking.updated_at) {
          // เปลี่ยนไปเป็นข้อมูลอื่น = เครื่องอื่นแก้ → ให้ไปดูงานล่าสุดก่อน (ไม่บันทึกทับ)
          if (isConflict) setConflict(true)
          setChangedElsewhere(true)
          showError(isConflict ? msg : 'ข้อมูลงานเปลี่ยนไปแล้ว (อาจแก้จากเครื่องอื่น) — เปิดดูงานล่าสุดก่อนแก้ต่อ')
          return
        }
        if (isConflict) setConflict(true)
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

  function save(force: boolean) {
    if (create) void doCreate(force)
    else void doUpdate(force)
  }

  function submit() {
    if (!canSubmit) {
      setTried(true)
      const firstProblem = problems[0]
      if (firstProblem) scrollToSection(firstProblem.section)
      return
    }
    const reasons: ForceDialogState['reasons'] = []
    if (capacityForce && q) {
      const dates = q.capacity_warnings.filter(w => create || newDates.has(w.date))
      for (const w of dates) {
        const others = w.bookings.map(b => [b.booking_no, b.couple_names].filter(Boolean).join(' ')).join(', ')
        reasons.push({
          kind: 'capacity',
          text: `วันที่ ${formatThaiDate(w.date)} รับงานได้ ${q.capacity || settings.max_jobs_per_day} งานต่อวัน${others ? ` — มีงานอยู่แล้ว: ${others}` : ''}`,
        })
      }
    }
    if (depositShort && q) {
      reasons.push({
        kind: 'deposit',
        text: `ยืนยันงานก่อนได้รับมัดจำครบ (มัดจำ ${baht(q.money.deposit_required)}${plan.amount > 0 ? ` รับตอนนี้ ${baht(plan.amount)}` : ' ยังไม่ได้รับ'})`,
      })
    }
    if (reasons.length > 0 || plan.payments.length > 0) {
      setForceDialog({ reasons, payment: plan.payments.length > 0 ? plan : null })
      return
    }
    save(false)
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
    } else {
      newRequestId()
    }
    choiceRef.current = false
    fromStoreRef.current = false
    setDraftChoice(null)
    const d = emptyDraft(holdDefault)
    setDraft(d)
    setTried(false)
    setRestored(false)
    setDupTab(false)
    setSubmitError('')
    setResetConfirm(false)
    persist(d)
    requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: 'start' }))
  }

  // เลือกกู้ฟอร์มที่กรอกค้าง (ทิ้งค่าจากลิงก์) / เริ่มใหม่ด้วยค่าจากลิงก์ (ฟอร์มค้างถูกแทนที่)
  function pickStoredDraft() {
    if (!draftChoice || busyRef.current) return
    choiceRef.current = false
    fromStoreRef.current = true
    setDraft(draftChoice)
    setDraftChoice(null)
    setRestored(true)
    setSubmitError('')
  }

  function pickPrefill() {
    if (busyRef.current) return
    choiceRef.current = false
    setDraftChoice(null)
    persist(draftRef.current)
  }

  // ===== แสดงผล =====
  const grandShown = q ? q.money.grand_total : !create && booking ? booking.money.grand_total : null
  const datedSessions = draft.sessions.filter(s => isDayKey(s.date) && s.status !== 'cancelled')
  const firstDate = datedSessions.map(s => s.date).sort()[0] ?? ''
  const selectedPkg = draft.packageMode === 'catalog' && draft.packageId
    ? catalog.packages.find(p => p.id === draft.packageId)?.name ?? booking?.package.name ?? ''
    : draft.pkgName.trim()

  const summaryNode = (
    <QuoteSummary
      quote={q}
      loading={quote.loading || (q !== null && !quoteFresh)}
      error={quote.sig === quoteSig ? quote.error : ''}
      create={create}
      payNow={create ? plan.amount : undefined}
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

  const disabled = busy || done

  return (
    <div ref={rootRef} className="space-y-4 scroll-mt-4">
      {/* ===== ประกาศด้านบน ===== */}
      {prevSaved && (
        <div className="alert-ok" role="status">
          <CheckCircle2 {...ICON_SM} />
          <div className="min-w-0 space-y-2">
            {prevSaved.kind === 'restored' ? (
              <p>งานที่กดบันทึกไว้ครั้งก่อน (ตอนเน็ตหลุด) บันทึกสำเร็จแล้ว — เลขที่ <b className="font-mono">{prevSaved.booking_no}</b></p>
            ) : (
              <p>
                มีงานที่บันทึกด้วยคำขอครั้งก่อนแล้ว — เลขที่ <b className="font-mono">{prevSaved.booking_no}</b>
                {' '}(ฟอร์มด้านล่างยังไม่ได้บันทึก)
              </p>
            )}
            <Link href={`/wedding/bookings/${prevSaved.id}`} className="btn-secondary px-4 text-sm">
              <ExternalLink {...ICON_SM} />
              เปิดงานนั้น
            </Link>
          </div>
        </div>
      )}
      {dupTab && !prevSaved && (
        <div className="alert-warn" role="status">
          <AlertTriangle {...ICON_SM} />
          <div className="min-w-0 flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0">
              แท็บนี้เปิดซ้ำมาจากแท็บที่กำลังบันทึกงานนี้อยู่ — ดูผลที่แท็บเดิม ถ้ากดบันทึกที่แท็บนี้จะเป็นงานใหม่อีกรายการ
            </p>
            <button type="button" className="btn-ghost px-3 text-sm" onClick={() => setResetConfirm(true)} disabled={busy}>
              <RotateCcw {...ICON_SM} />
              ล้างและเริ่มใหม่
            </button>
          </div>
        </div>
      )}
      {draftChoice && !prevSaved && (
        <div className="alert-info" role="status">
          <Info {...ICON_SM} />
          <div className="min-w-0 space-y-2">
            <p className="min-w-0">
              แท็บนี้มีฟอร์มสร้างงานที่กรอกค้างไว้{draftChoice.coupleNames.trim() ? <> (<b>{draftChoice.coupleNames.trim()}</b>)</> : null}
              {' '}— จะกู้ฟอร์มนั้น หรือเริ่มใหม่ด้วย{prefill && isDayKey(prefill.date) ? `วันที่ ${formatThaiDate(prefill.date)}` : 'ข้อมูลที่เลือกมา'}?
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary px-4 text-sm" onClick={pickStoredDraft} disabled={busy}>
                <RotateCcw {...ICON_SM} />
                กู้ฟอร์มที่กรอกค้าง
              </button>
              <button type="button" className="btn-ghost px-4 text-sm" onClick={pickPrefill} disabled={busy}>
                {prefill && isDayKey(prefill.date) ? 'เริ่มใหม่ด้วยวันที่ที่เลือก' : 'เริ่มใหม่ด้วยข้อมูลที่เลือก'}
              </button>
            </div>
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
      {!create && booking && booking.status === 'hold' && (
        <div className="alert-warn" role="note">
          <AlertTriangle {...ICON_SM} />
          <p className="min-w-0">งานนี้ล็อกคิวรอมัดจำอยู่ — ถ้าหมดเวลาล็อกคิวโดยยังไม่มีเงินเข้า ระบบจะกลับเป็น &quot;สอบถาม&quot; อัตโนมัติ</p>
        </div>
      )}
      {!create && booking && booking.status === 'postponed' && (
        <div className="alert-info" role="note">
          <Info {...ICON_SM} />
          <p className="min-w-0">
            งานนี้เลื่อนอยู่ — ใส่วันงานใหม่ของคิวแล้วบันทึก จากนั้นกด &quot;กลับมาจัดงาน&quot; ที่หน้างาน (ยอดเงินที่รับไว้ยังอยู่ครบ)
          </p>
        </div>
      )}
      {!create && booking && booking.status === 'in_production' && (
        <div className="alert-info" role="note">
          <Info {...ICON_SM} />
          <p className="min-w-0">งานนี้ถ่ายเสร็จแล้ว — แก้ข้อมูลคิว/ยอดเงินได้ ส่วนรายการส่งงานแก้ที่หน้างาน</p>
        </div>
      )}

      {/* ===== แถบลัดไปส่วนต่างๆ (มือถือเลื่อนแนวนอนในกล่องของตัวเอง) ===== */}
      <nav aria-label="ส่วนของฟอร์ม" className="lift-scroll -mx-3 overflow-x-auto px-3 scrollbar-none sm:-mx-4 sm:px-4 md:mx-0 md:px-0">
        <div className="flex gap-2">
          {SECTIONS.map(s => {
            const bad = tried && problemSections.has(s.id)
            return (
              <button
                key={s.id}
                type="button"
                className={clsx('chip-toggle lift-hover lift-tab shrink-0', bad && 'border-red-300 text-red-800')}
                onClick={() => scrollToSection(s.id)}
              >
                {s.label}
                {bad && <span className="sr-only"> (ยังไม่ครบ)</span>}
                {bad && <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      </nav>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* ===== เนื้อหาฟอร์ม ===== */}
        <div className="min-w-0 space-y-4">
          <CustomerSection
            supabase={supabase}
            draft={draft}
            patch={patch}
            check={custCheck}
            coupleError={core.other.couple}
            dupes={dupes}
            dupLookupFailed={dupLookupFailed}
            showErrors={tried}
            disabled={disabled}
          />

          <SessionsEditor
            draft={draft}
            setSessions={setSessions}
            checks={core.sessions}
            hintsFor={hintsFor}
            showErrors={tried}
            manager={manager}
            showStatus={!create}
            crewList={catalog.crew}
            crewError={catalog.crewError}
            sessionsProblem={core.problems.find(p => p.section === 'sessions' && !p.text.startsWith('คิวที่'))?.text ?? null}
            mk={mk}
            disabled={disabled}
          />

          <PackageSection
            draft={draft}
            patch={patch}
            packages={catalog.packages}
            addonCatalog={catalog.addons}
            catalogError={catalog.catalogError}
            check={core}
            planOpen={planOpen}
            lockedPlan={booking?.deliverables_plan ?? []}
            quote={q}
            quoteFresh={quoteFresh}
            originalPackage={booking ? { id: booking.package.id, name: booking.package.name, price: booking.package.price, hours: booking.package.hours } : null}
            mk={mk}
            disabled={disabled}
          />

          <MoneySection
            draft={draft}
            patch={patch}
            check={core}
            quote={quoteFresh ? q : null}
            booking={create ? null : booking}
            balanceDueDays={booking?.money.balance_due_days ?? settings.balance_due_days}
            summary={<div className="space-y-3">{quoteErrorBox}{summaryNode}</div>}
            disabled={disabled}
          />

          <StatusSection
            create={create}
            booking={booking}
            draft={draft}
            patch={patch}
            quote={q}
            plan={plan}
            holdProblem={holdProblem}
            holdDefault={holdDefault}
            depositShort={depositShort}
            disabled={disabled}
          />

          <OtherSection draft={draft} patch={patch} check={core} today={today} disabled={disabled} />

          {/* ===== ผลการบันทึก ===== */}
          <div ref={errorRef} className="scroll-mb-40 space-y-2">
            {submitError && (
              <div role="alert" className="alert-err">
                <XCircle {...ICON_SM} />
                <div className="min-w-0 space-y-2">
                  <p className="break-words">{submitError}</p>
                  {conflict && (
                    <button type="button" className="btn-secondary px-4 text-sm" onClick={() => router.refresh()}>
                      <RefreshCw {...ICON_SM} />
                      โหลดข้อมูลล่าสุด (ข้อมูลที่แก้ไว้จะหายไป)
                    </button>
                  )}
                  {changedElsewhere && booking && (
                    <Link href={`/wedding/bookings/${booking.id}`} className="btn-secondary px-4 text-sm">
                      <ExternalLink {...ICON_SM} />
                      ข้อมูลงานเปลี่ยนแล้ว — เปิดดูงาน
                    </Link>
                  )}
                </div>
              </div>
            )}
            {done && (
              <p className="flex items-center gap-2 text-sm text-gray-600" role="status">
                <Loader2 {...ICON_SM} className="animate-spin" />
                บันทึกแล้ว กำลังเปิดหน้างาน...
              </p>
            )}
          </div>
        </div>

        {/* ===== แถบสรุปข้างจอ (จอกว้าง) ===== */}
        <aside className="hidden lg:block lg:sticky lg:top-6 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto overscroll-contain" aria-label="สรุปงาน">
          <div className="card p-4 xl:p-5 space-y-4">
            <h2 className="section-title">
              <ClipboardList {...ICON} />
              สรุปงาน
              {!create && booking && <span className={WED_STATUS_CHIP[booking.status]}>{booking.status_label}</span>}
            </h2>
            <div className="space-y-1.5 text-sm">
              <p className="text-base font-semibold text-gray-900 break-words">{draft.coupleNames.trim() || <span className="font-normal text-gray-400">ยังไม่ใส่ชื่อคู่บ่าวสาว</span>}</p>
              <p className="flex items-center gap-2 text-gray-600">
                <UserRound {...ICON_SM} className="shrink-0 text-brand-600" />
                {draft.customerMode === 'existing' && draft.customer ? (
                  <span className="min-w-0 break-words">
                    {draft.customer.name}
                    {draft.customer.phone && <span className="text-gray-500 tabular-nums"> · {formatPhone(draft.customer.phone)}</span>}
                  </span>
                ) : draft.customerMode === 'new' && draft.newCustomer.name.trim() ? (
                  <span className="min-w-0 break-words">{draft.newCustomer.name.trim()} <span className="chip ml-1">ลูกค้าใหม่</span></span>
                ) : (
                  <span className="text-gray-400">ยังไม่ได้เลือกลูกค้า</span>
                )}
              </p>
              <p className="flex items-center gap-2 text-gray-600">
                <Package {...ICON_SM} className="shrink-0 text-brand-600" />
                <span className="min-w-0 break-words">{selectedPkg || <span className="text-gray-400">ยังไม่เลือกแพ็กเกจ</span>}</span>
              </p>
            </div>
            <div className="space-y-1.5">
              <p className="flex items-center gap-2 text-xs font-semibold text-gray-700">
                <CalendarDays {...ICON_XS} className="text-brand-600" />
                คิวงาน {draft.sessions.length} คิว
              </p>
              <ul className="space-y-1 text-sm">
                {draft.sessions.map((s, i) => (
                  <li key={s.key} className={clsx('flex items-baseline gap-2', s.status === 'cancelled' && 'text-gray-400 line-through')}>
                    <span className="w-12 shrink-0 text-xs text-gray-500">คิว {i + 1}</span>
                    <span className="min-w-0 break-words">
                      {SESSION_TYPE_SHORT[s.session_type]}
                      {' · '}
                      {isDayKey(s.date) ? `${thaiDayName(s.date, true)} ${formatThaiDate(s.date)}` : 'ยังไม่ระบุวัน'}
                      {(s.start_time || s.end_time) && (
                        <span className="text-gray-500 tabular-nums"> {sessionTimeText({ start_time: s.start_time, end_time: s.end_time }, '')}</span>
                      )}
                      {s.crew.length > 0 && (
                        <span className="text-gray-500"> <Users size={12} strokeWidth={2} aria-hidden="true" className="inline align-[-1px]" /> {s.crew.length}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            {(conflictCount > 0 || capacityForce) && (
              <div className="alert-warn" role="status">
                <AlertTriangle {...ICON_SM} />
                <div className="min-w-0 space-y-1 text-sm">
                  {conflictCount > 0 && q && (
                    <>
                      <p className="font-semibold">ทีมชนคิว {conflictCount} รายการ</p>
                      <ul className="list-disc pl-4 text-xs">
                        {q.crew_conflicts.slice(0, 4).map((c, i) => <li key={i} className="break-words">{crewConflictText(c)}</li>)}
                      </ul>
                    </>
                  )}
                  {capacityForce && <p>มีวันที่รับงานเกินจำนวนต่อวัน — ตอนบันทึกจะให้กดยืนยัน</p>}
                </div>
              </div>
            )}
            {core.warnings.length > 0 && (
              <ul className="space-y-1 text-xs text-gray-600">
                {core.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <Info size={13} strokeWidth={2} aria-hidden="true" className="mt-px shrink-0 text-brand-600" />
                    <span className="min-w-0">{w}</span>
                  </li>
                ))}
              </ul>
            )}
            <hr className="divider !my-0" />
            {quoteErrorBox}
            {summaryNode}
          </div>
        </aside>
      </div>

      {/* ===== แถบล่าง: ยอดสุทธิ + ปุ่มบันทึก ===== */}
      <div className="sticky bottom-0 z-20 -mx-3 sm:-mx-4 md:mx-0 bottom-bar px-3 pt-3 pb-3 sm:px-5 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-[env(safe-area-inset-bottom)] after:bg-white">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="min-w-0 flex-1" aria-live="polite">
            <p className="text-[11px] sm:text-xs text-gray-500 truncate">
              {draft.sessions.length} คิว
              {firstDate ? ` · เริ่ม ${formatThaiDate(firstDate)}` : ''}
              {conflictCount > 0 ? ` · ทีมชนคิว ${conflictCount}` : ''}
            </p>
            <p className="flex items-center gap-1.5 money text-base sm:text-lg text-gray-900">
              {grandShown !== null ? baht(grandShown) : '-'}
              {quote.loading && <Loader2 size={14} strokeWidth={2} aria-hidden="true" className="animate-spin text-gray-400" />}
            </p>
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={busy || done || !hydrated}
            aria-disabled={!canSubmit}
            className="btn-primary shrink-0 min-h-[48px] px-4 sm:px-6"
          >
            {busy || done ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Save {...ICON_SM} />}
            {busy ? 'กำลังบันทึก...' : create ? 'บันทึกงาน' : 'บันทึกการแก้ไข'}
          </button>
        </div>
        {!canSubmit && !busy && !done && (tried || submitError === '') && (problems.length > 0 || waitingQuote || !!quote.error) && (
          <SubmitHint
            reasons={[
              ...problems.slice(0, 4).map(p => p.text),
              problems.length > 4 ? `และอีก ${problems.length - 4} ข้อ` : '',
              waitingQuote ? 'กำลังคำนวณยอดเงิน...' : '',
              quote.error && quote.sig === quoteSig ? 'คำนวณยอดเงินไม่สำเร็จ' : '',
            ].filter(Boolean)}
          />
        )}
      </div>

      {/* ===== ยืนยันก่อนบันทึก: คิวเต็ม / ยืนยันก่อนได้มัดจำ / รับเงินพร้อมบันทึก ===== */}
      <ConfirmDialog
        open={forceDialog !== null}
        title={forceDialog && forceDialog.reasons.length > 0 ? 'ยืนยันบันทึกงานนี้?' : 'ยืนยันบันทึกงานและรับเงิน'}
        confirmLabel={busy ? 'กำลังบันทึก...' : forceDialog && forceDialog.reasons.length > 0 ? 'ยืนยันและบันทึก' : 'บันทึกและรับเงิน'}
        busy={busy}
        requireAck={forceDialog?.reasons.some(r => r.kind === 'capacity') ? 'รับทราบว่าวันนี้รับงานเกินจำนวนที่ตั้งไว้' : undefined}
        onCancel={() => setForceDialog(null)}
        onConfirm={() => {
          const force = !!forceDialog && forceDialog.reasons.length > 0
          setForceDialog(null)
          save(force)
        }}
      >
        {forceDialog && forceDialog.reasons.length > 0 && (
          <ul className="space-y-2">
            {forceDialog.reasons.map((r, i) => (
              <li key={i} className="panel p-3">
                <p className="text-xs font-semibold text-gray-900">{r.kind === 'capacity' ? 'วันนี้รับงานเต็มแล้ว' : 'มัดจำยังไม่ครบ'}</p>
                <p className="break-words">{r.text}</p>
              </li>
            ))}
          </ul>
        )}
        {forceDialog?.payment && forceDialog.payment.payments.length > 0 && (
          <>
            <p>ตรวจจำนวนเงินที่รับจากลูกค้าก่อนบันทึก — ระบบจะออกใบเสร็จรับเงินให้</p>
            <ul className="panel divide-y divide-gray-200 px-3.5">
              {forceDialog.payment.payments.map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    {p.purpose === 'deposit' ? 'มัดจำ' : p.purpose === 'balance' ? 'ชำระเต็มจำนวน' : 'รับชำระ'}
                    <span className="block text-xs text-gray-500">{WED_METHOD_LABELS[p.method]}</span>
                  </span>
                  <span className="money text-gray-900">{baht(p.amount)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
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
        <p>ลูกค้า คิวงาน แพ็กเกจ และยอดเงินที่กรอกไว้ในฟอร์มนี้จะหายไป (ยังไม่มีอะไรถูกบันทึกลงระบบ)</p>
      </ConfirmDialog>
    </div>
  )
}

function SubmitHint({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null
  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-amber-800" role="status">
      <Info size={14} strokeWidth={2} aria-hidden="true" className="mt-px shrink-0" />
      <span className="min-w-0 break-words">ยังบันทึกไม่ได้: {reasons.join(' · ')}</span>
    </p>
  )
}
