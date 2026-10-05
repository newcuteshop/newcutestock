'use client'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import {
  AlertCircle, AlertTriangle, Banknote, CalendarCheck, Check, CheckCircle2, ChevronLeft, ChevronRight, History,
  Info, ListChecks, Loader2, Minus, Plus, Printer, ReceiptText, RefreshCw, Store, TrendingUp, Undo2, Wallet, X,
  type LucideIcon,
} from 'lucide-react'
import { ICON, ICON_SM, ICON_XS } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import {
  addDaysToKey, baht, bangkokTodayKey, formatThaiDate, formatThaiDateTime, formatThaiDayLong, formatThaiTime,
  isDayKey, thaiError,
} from '@/lib/format'
import { normalizeScannedCode } from '@/lib/barcode'
import { parseMoneyInput, round2 } from '@/lib/money'
import { FIX04_MISSING_MSG, isMigrationMissing } from '@/lib/migration'
import { PAYMENT_METHOD_LABELS, saleChannelLabel } from '@/lib/integrations/labels'
import {
  cashDetailTotal, DENOMINATIONS, parseDaySummary, REFUND_METHOD_OPTIONS,
  type CashDetail, type DayClosing, type DaySummary, type DenominationKey, type ShopSettings,
} from '@/lib/pos'
import ConfirmDialog from '@/components/integrations/ConfirmDialog'
import PrintPortal from '@/components/pos/PrintPortal'
import DaySummaryPrint, { cashDiffText, type DayCashDraft } from '@/components/pos/DaySummaryPrint'

// เพดานเดียวกับ close_day (numeric(10,2))
const MAX_MONEY = 99999999.99
// จำนวนแบงก์/เหรียญต่อชนิด (close_day รับ 0-100,000)
const MAX_COUNT = 100000
// กลับมาที่แท็บหลังจากนี้ (มิลลิวินาที) → โหลดยอดของวันที่เปิดอยู่ใหม่เงียบๆ (อาจมีบิล/คืนสินค้าจากเครื่องอื่นเพิ่ม)
const STALE_MS = 60000
const UNSURE_MSG =
  'ไม่แน่ใจว่าบันทึกปิดยอดสำเร็จหรือไม่ (เน็ตหลุดระหว่างส่ง) — ระบบกำลังโหลดสถานะล่าสุด ดูแถบสถานะด้านบนว่า "ปิดยอดแล้ว" หรือยัง ก่อนกดอีกครั้ง'

type Toast = { ok: boolean; text: string } | null
type DetailText = Record<DenominationKey, string>

const EMPTY_DETAIL = DENOMINATIONS.reduce((acc, d) => {
  acc[d.key] = ''
  return acc
}, {} as DetailText)

function fmtInt(n: number): string {
  return n.toLocaleString('en-US')
}

// ตัวเลขเงิน → ข้อความในช่องกรอก (1000 → "1000", 1234.5 → "1234.5")
function moneyText(n: number): string {
  return String(round2(n))
}

function detailToText(detail: CashDetail | null): DetailText {
  const out = { ...EMPTY_DETAIL }
  if (!detail) return out
  for (const d of DENOMINATIONS) {
    const n = detail[d.key]
    if (typeof n === 'number' && n > 0) out[d.key] = String(n)
  }
  return out
}

// ค่าฟอร์มจากการปิดยอดที่บันทึกไว้ (ปิดยอดใหม่ = แก้จากค่าเดิม) ; ยังไม่ปิดยอด = ฟอร์มว่าง
function formFromClosing(c: DayClosing | null): {
  opening: string; counted: string; useDetail: boolean; detail: DetailText; note: string
} {
  if (!c) return { opening: '', counted: '', useDetail: false, detail: { ...EMPTY_DETAIL }, note: '' }
  return {
    opening: c.opening_cash > 0 ? moneyText(c.opening_cash) : '',
    counted: moneyText(c.counted_cash),
    useDetail: !!c.cash_detail,
    detail: detailToText(c.cash_detail),
    note: c.note ?? '',
  }
}

// คีย์ "ชุดค่าที่ควรเติมในฟอร์ม" = วัน + ครั้งที่ปิดยอด (เปลี่ยนวัน / ปิดยอดใหม่ = เติมใหม่)
function prefillKeyOf(s: DaySummary): string {
  return `${s.day}|${s.closing ? `${s.closing.revision}|${s.closing.closed_at}` : '-'}`
}

// ช่องจำนวนแบงก์/เหรียญ: เลขไทย / คีย์บอร์ดค้างภาษาไทย → ตัวเลข, ตัดอย่างอื่นทิ้ง, ไม่เกิน MAX_COUNT
function cleanCountText(raw: string): string {
  let t = raw.replace(/[๐-๙]/g, d => String(d.charCodeAt(0) - 0x0e50))
  if (/[฀-๿]/.test(t)) t = normalizeScannedCode(t)
  t = t.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  if (t === '') return ''
  return String(Math.min(Number(t), MAX_COUNT))
}

function countOf(text: string): number {
  const n = Number(text)
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, MAX_COUNT) : 0
}

// ตรวจช่องจำนวนเงินที่พิมพ์ (ว่าง = null ไม่ใช่ error)
function moneyProblem(text: string): { value: number | null; problem: string } {
  if (text.trim() === '') return { value: null, problem: '' }
  const v = parseMoneyInput(text)
  if (v === null) return { value: null, problem: 'รูปแบบจำนวนเงินไม่ถูกต้อง (ใส่เฉพาะตัวเลข เช่น 1500 หรือ 1,500.50)' }
  if (v < 0) return { value: null, problem: 'จำนวนเงินต้องไม่ติดลบ' }
  if (v > MAX_MONEY) return { value: null, problem: 'จำนวนเงินมากเกินไป' }
  return { value: v, problem: '' }
}

// สีตัวเลขส่วนต่าง: ตรง = เขียว, เกิน = อำพัน, ขาด = แดง
function diffTextClass(diff: number): string {
  const d = round2(diff)
  if (d === 0) return 'text-green-700'
  return d > 0 ? 'text-amber-700' : 'text-red-700'
}

// error มีรหัสของ Postgres/PostgREST = เซิร์ฟเวอร์ตอบจริง (บันทึก/ไม่บันทึกแน่นอน) ; ไม่มีรหัส = เน็ตหลุด/หมดเวลา (ไม่แน่ใจ)
function serverAnswered(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  if (typeof code !== 'string') return false
  return /^PGRST\d+$/.test(code) || /^(?!E)[0-9A-Z]{5}$/.test(code)
}

function SummaryLine({ label, value, strong, className }: {
  label: ReactNode; value: ReactNode; strong?: boolean; className?: string
}) {
  return (
    <div className={clsx('flex items-baseline justify-between gap-3', className)}>
      <span className={clsx('min-w-0', strong ? 'font-semibold text-gray-900' : 'text-gray-600')}>{label}</span>
      <span className={clsx('shrink-0 whitespace-nowrap tabular-nums', strong ? 'money text-base text-gray-900' : 'font-medium text-gray-900')}>
        {value}
      </span>
    </div>
  )
}

function StatCard({ label, value, unit, sub, icon: Icon, hot }: {
  label: string; value: string; unit?: string; sub?: string; icon: LucideIcon; hot?: boolean
}) {
  return (
    <div className={clsx('stat-card', hot && 'stat-card-hot')}>
      <div className="flex items-start justify-between gap-2">
        <span className={clsx('stat-label min-w-0 pt-1', hot && 'text-gray-600')}>{label}</span>
        <span className={clsx('icon-bubble', hot && 'icon-bubble-strong')}><Icon {...ICON} /></span>
      </div>
      <p className="stat-value">
        <span className="whitespace-nowrap">{value}</span>
        {unit && <span className="stat-sub"> {unit}</span>}
        {sub && <span className={clsx('stat-sub', hot && 'text-gray-600')}> <span className="whitespace-nowrap">· {sub}</span></span>}
      </p>
    </div>
  )
}

export default function CloseClient({
  title,
  subtitle,
  todayKey: initialTodayKey,
  initialSummary,
  closings,
  closingsError,
  shop,
}: {
  title: string
  subtitle: string
  todayKey: string
  initialSummary: DaySummary
  closings: DayClosing[]
  closingsError: string | null
  shop: ShopSettings
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  // "วันนี้" ตามเวลาไทย — เปิดหน้าค้างข้ามเที่ยงคืนก็เลื่อนตาม (ห้ามเลือกวันอนาคต)
  const [todayKey, setTodayKey] = useState(initialTodayKey)
  const [day, setDay] = useState(isDayKey(initialSummary.day) ? initialSummary.day : initialTodayKey)
  const [summary, setSummary] = useState<DaySummary>(initialSummary)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const dayRef = useRef(day)
  const reqRef = useRef(0)
  const loadedAtRef = useRef(Date.now())

  // ฟอร์มนับเงิน — เริ่มจากการปิดยอดที่บันทึกไว้ (ถ้ามี) ตั้งแต่ render แรก ไม่ให้ช่องว่างแวบก่อนเติมค่า
  const initialForm = useMemo(() => formFromClosing(initialSummary.closing), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [openingText, setOpeningText] = useState(initialForm.opening)
  const [countedText, setCountedText] = useState(initialForm.counted)
  const [useDetail, setUseDetail] = useState(initialForm.useDetail)
  const [detailText, setDetailText] = useState<DetailText>(initialForm.detail)
  const [note, setNote] = useState(initialForm.note)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [saveError, setSaveError] = useState('')
  const [toast, setToast] = useState<Toast>(null)
  const [printing, setPrinting] = useState(false)
  const [printedAt, setPrintedAt] = useState('')

  // ยอดที่แสดง = ยอดของวันที่เลือกเท่านั้น (ระหว่างโหลดวันใหม่ ห้ามโชว์ตัวเลขวันเก่าใต้หัววันใหม่)
  const shown = summary.day === day ? summary : null
  const closing = shown?.closing ?? null
  const isToday = day === todayKey

  // ---------- โหลดยอดของวัน ----------
  const loadDay = useCallback(async (d: string, silent = false) => {
    const id = ++reqRef.current
    dayRef.current = d
    setDay(d)
    if (!silent) {
      setLoading(true)
      setLoadError('')
    }
    try {
      const { data, error } = await supabase.rpc('get_day_summary', { p_day: d })
      if (id !== reqRef.current) return
      if (error) {
        if (!silent) setLoadError(isMigrationMissing(error) ? FIX04_MISSING_MSG : thaiError(error))
        return
      }
      const parsed = parseDaySummary(data)
      if (!parsed) {
        if (!silent) setLoadError('อ่านข้อมูลยอดประจำวันไม่ได้ กรุณาลองใหม่')
        return
      }
      loadedAtRef.current = Date.now()
      setSummary(parsed.day === d ? parsed : { ...parsed, day: d })
    } catch (err) {
      if (id === reqRef.current && !silent) setLoadError(thaiError(err))
    } finally {
      if (id === reqRef.current) setLoading(false)
    }
  }, [supabase])

  // เขียนวันที่เลือกลง URL (?day=) — โหลดหน้าใหม่/router.refresh() แล้วยังอยู่วันเดิม ; วันนี้ = ไม่ใส่
  const syncUrl = useCallback((d: string, today: string) => {
    try {
      const url = new URL(window.location.href)
      if (d === today) url.searchParams.delete('day')
      else url.searchParams.set('day', d)
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    } catch {
      // เบราว์เซอร์ไม่ยอมแก้ URL — ไม่เป็นไร แค่โหลดหน้าใหม่แล้วกลับไปวันนี้
    }
  }, [])

  function changeDay(next: string) {
    if (!isDayKey(next)) return
    const target = next > todayKey ? todayKey : next
    if (target === day && shown && !loadError) {
      setDateInput(day) // เช่น พิมพ์วันอนาคต → ช่องกลับเป็นวันที่เปิดอยู่
      return
    }
    syncUrl(target, todayKey)
    void loadDay(target)
  }
  const changeDayRef = useRef(changeDay)
  changeDayRef.current = changeDay

  // ช่องเลือกวันที่: พิมพ์ปีทีละหลัก เบราว์เซอร์ส่ง "วันที่ถูกต้อง" ระหว่างทางมาด้วย (เช่น ปี 0002)
  // → รอหยุดพิมพ์ครู่หนึ่งก่อนโหลด ; ปุ่มลูกศร/วันนี้/แถวประวัติ เปลี่ยนวันทันทีผ่าน changeDay
  const [dateInput, setDateInput] = useState(day)
  const dateTimerRef = useRef<number | null>(null)
  useEffect(() => {
    setDateInput(day)
  }, [day])
  useEffect(() => () => {
    if (dateTimerRef.current !== null) window.clearTimeout(dateTimerRef.current)
  }, [])

  function onDateInput(v: string) {
    setDateInput(v)
    if (dateTimerRef.current !== null) window.clearTimeout(dateTimerRef.current)
    dateTimerRef.current = window.setTimeout(() => {
      dateTimerRef.current = null
      changeDayRef.current(v)
    }, 500)
  }

  function commitDateInput() {
    if (dateTimerRef.current !== null) {
      window.clearTimeout(dateTimerRef.current)
      dateTimerRef.current = null
      changeDay(dateInput)
    } else if (dateInput !== day) {
      // ลบวันที่ทิ้ง/พิมพ์ไม่ครบแล้วออกจากช่อง → กลับเป็นวันที่เปิดอยู่
      setDateInput(day)
    }
  }

  // ข้อมูลจากเซิร์ฟเวอร์ใหม่ (หลัง router.refresh) → ใช้เฉพาะเมื่อเป็นวันเดียวกับที่เปิดอยู่
  useEffect(() => {
    if (initialSummary.day === dayRef.current) {
      loadedAtRef.current = Date.now()
      setSummary(initialSummary)
    }
  }, [initialSummary])

  // อัปเดต "วันนี้" ทุกนาที + ตอนกลับมาที่แท็บ ; กลับมาหลังทิ้งไว้นาน → โหลดยอดใหม่เงียบๆ
  const busyRef = useRef(false)
  busyRef.current = loading || saving || confirmOpen
  useEffect(() => {
    const tick = () => {
      const t = bangkokTodayKey()
      setTodayKey(k => (t > k ? t : k))
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      tick()
      if (!busyRef.current && Date.now() - loadedAtRef.current > STALE_MS) void loadDay(dayRef.current, true)
    }
    const timer = window.setInterval(tick, 60000)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadDay])

  // ---------- เติมฟอร์มจากการปิดยอดที่บันทึกไว้ (เปลี่ยนวัน / ปิดยอดครั้งใหม่) ----------
  // คีย์ไม่เปลี่ยน (เช่น ข้อมูลเดิมโหลดซ้ำ) = ไม่ทับสิ่งที่กำลังพิมพ์
  const prefillKey = shown ? prefillKeyOf(shown) : ''
  // ค่าที่เติมไปแล้วล่าสุด (render แรกเติมจาก useState ด้านบนแล้ว)
  const appliedKeyRef = useRef(prefillKeyOf(initialSummary))
  useEffect(() => {
    if (!shown || prefillKey === appliedKeyRef.current) return
    appliedKeyRef.current = prefillKey
    const f = formFromClosing(shown.closing)
    setOpeningText(f.opening)
    setCountedText(f.counted)
    setUseDetail(f.useDetail)
    setDetailText(f.detail)
    setNote(f.note)
    setSaveError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillKey])

  // โทสต์สำเร็จหายเองใน 4 วินาที
  useEffect(() => {
    if (!toast || !toast.ok) return
    const t = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(t)
  }, [toast])

  // ---------- คำนวณ ----------
  const openingCheck = moneyProblem(openingText)
  const opening = openingCheck.problem ? null : (openingCheck.value ?? 0)

  const detailCounts: CashDetail = {}
  for (const d of DENOMINATIONS) {
    const n = countOf(detailText[d.key])
    if (n > 0) detailCounts[d.key] = n
  }
  const detailTotal = cashDetailTotal(detailCounts)

  let counted: number | null
  let countedProblem = ''
  if (useDetail) {
    counted = detailTotal
    if (detailTotal > MAX_MONEY) countedProblem = 'ยอดรวมมากเกินไป ตรวจจำนวนแบงก์/เหรียญอีกครั้ง'
  } else {
    const c = moneyProblem(countedText)
    counted = c.value
    countedProblem = c.problem
  }
  const expected = shown ? round2((opening ?? 0) + shown.cash_sales - shown.cash_refunds) : 0
  const diff = shown && counted !== null && !countedProblem ? round2(counted - expected) : null

  const canClose = !!shown && !loading && !saving && opening !== null && counted !== null && !countedProblem
  const closeLabel = closing
    ? `ปิดยอดใหม่ (แก้ไขครั้งที่ ${fmtInt(closing.revision + 1)})`
    : isToday
      ? 'ปิดยอดวันนี้'
      : `ปิดยอดวันที่ ${formatThaiDate(day)}`
  const closeHint = !shown
    ? ''
    : openingCheck.problem || countedProblem
      ? 'แก้ไขช่องที่ไม่ถูกต้องก่อนปิดยอด'
      : counted === null
        ? 'กรอกยอดเงินสดที่นับได้ก่อนปิดยอด'
        : ''

  // ปิดยอดครั้งก่อน (ของวันก่อนหน้า) ที่มีเงินทอนตั้งต้น → ปุ่มลัดใช้ยอดเดิม (ร้านส่วนใหญ่ตั้งเงินทอนเท่าเดิมทุกวัน)
  const lastOpening = useMemo(() => {
    const prev = closings.find(c => c.day < day && c.opening_cash > 0)
    return prev ? prev.opening_cash : null
  }, [closings, day])

  // ---------- นับแยกแบงก์/เหรียญ ----------
  function setDenom(key: DenominationKey, text: string) {
    setDetailText(prev => ({ ...prev, [key]: cleanCountText(text) }))
  }

  function stepDenom(key: DenominationKey, delta: number) {
    setDetailText(prev => {
      const n = Math.min(MAX_COUNT, Math.max(0, countOf(prev[key]) + delta))
      return { ...prev, [key]: n > 0 ? String(n) : '' }
    })
  }

  function toggleDetail() {
    if (useDetail) {
      // ปิดโหมดนับแยก → ยอดที่นับได้คงไว้ตามที่นับแยกมา (ไม่ต้องพิมพ์ใหม่)
      if (detailTotal > 0) setCountedText(moneyText(detailTotal))
      setUseDetail(false)
    } else {
      setUseDetail(true)
    }
    setSaveError('')
  }

  // ---------- ปิดยอด ----------
  const closeConfirm = useCallback(() => {
    if (!savingRef.current) setConfirmOpen(false)
  }, [])

  async function doClose() {
    if (!shown || savingRef.current || opening === null || counted === null || countedProblem) return
    const targetDay = shown.day
    savingRef.current = true
    setSaving(true)
    setSaveError('')
    try {
      const { data, error } = await supabase.rpc('close_day', {
        p_day: targetDay,
        p_opening_cash: opening,
        p_counted_cash: counted,
        // ส่งรายละเอียดแบงก์/เหรียญเฉพาะโหมดนับแยก (close_day ตรวจว่ารวมแล้วเท่ายอดที่นับ)
        p_cash_detail: useDetail ? detailCounts : null,
        p_note: note.trim() || null,
      })
      if (error) {
        setConfirmOpen(false)
        if (!serverAnswered(error)) {
          setSaveError(UNSURE_MSG)
          void loadDay(targetDay, true)
        } else {
          setSaveError(isMigrationMissing(error) ? FIX04_MISSING_MSG : thaiError(error))
        }
        return
      }
      const parsed = parseDaySummary(data)
      setConfirmOpen(false)
      if (parsed && dayRef.current === targetDay) {
        loadedAtRef.current = Date.now()
        setSummary(parsed.day === targetDay ? parsed : { ...parsed, day: targetDay })
      } else if (!parsed) {
        void loadDay(targetDay, true)
      }
      const rev = parsed?.closing?.revision
      setToast({
        ok: true,
        text: `ปิดยอดวันที่ ${formatThaiDate(targetDay)} เรียบร้อย${rev && rev > 1 ? ` (ครั้งที่ ${fmtInt(rev)})` : ''}`,
      })
      // ประวัติการปิดยอดท้ายหน้ามาจากเซิร์ฟเวอร์
      if (navigator.onLine !== false) router.refresh()
    } catch (err) {
      setConfirmOpen(false)
      if (serverAnswered(err)) {
        setSaveError(thaiError(err))
      } else {
        setSaveError(UNSURE_MSG)
        void loadDay(targetDay, true)
      }
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  // ---------- พิมพ์ ----------
  function startPrint() {
    if (!shown || printing) return
    setPrintedAt(new Date().toISOString())
    setPrinting(true)
  }

  const draft: DayCashDraft | null = shown && !closing
    ? {
      opening: opening ?? 0,
      counted: countedProblem ? null : counted,
      detail: useDetail ? detailCounts : null,
      note: note.trim() || null,
    }
    : null

  const methods = shown
    ? (['cash', 'transfer', 'credit', 'marketplace'] as const).filter(
      m => m !== 'marketplace' || shown.by_method.marketplace.count > 0 || shown.by_method.marketplace.amount !== 0,
    )
    : []

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
        <div className="page-actions">
          <button type="button" onClick={startPrint} disabled={!shown || loading} className="btn-secondary w-full sm:w-auto">
            <Printer {...ICON_SM} />
            พิมพ์สรุปยอด
          </button>
        </div>
      </div>

      {/* ===== เลือกวัน ===== */}
      <div className="card p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => changeDay(addDaysToKey(day, -1))}
              disabled={saving}
              className="btn-icon"
              aria-label="วันก่อนหน้า"
            >
              <ChevronLeft {...ICON} />
            </button>
            <label htmlFor="close-day" className="sr-only">เลือกวันที่</label>
            <input
              id="close-day"
              type="date"
              className="input min-w-0 flex-1 tabular-nums sm:w-44 sm:flex-none"
              value={dateInput}
              max={todayKey}
              disabled={saving}
              onChange={e => onDateInput(e.target.value)}
              onBlur={() => commitDateInput()}
            />
            <button
              type="button"
              onClick={() => changeDay(addDaysToKey(day, 1))}
              disabled={saving || day >= todayKey}
              className="btn-icon"
              aria-label="วันถัดไป"
            >
              <ChevronRight {...ICON} />
            </button>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <p className="min-w-0 text-sm font-semibold text-gray-900 sm:text-base">
              {formatThaiDayLong(day)}
              {isToday && <span className="chip ml-2 align-middle">วันนี้</span>}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              {!isToday && (
                <button type="button" onClick={() => changeDay(todayKey)} disabled={saving} className="btn-secondary px-3">
                  วันนี้
                </button>
              )}
              <button
                type="button"
                onClick={() => void loadDay(day)}
                disabled={loading || saving}
                className="btn-icon"
                aria-label="โหลดยอดล่าสุด"
                title="โหลดยอดล่าสุด"
              >
                <RefreshCw {...ICON_SM} className={loading ? 'animate-spin' : undefined} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div aria-busy={loading} className="space-y-4 sm:space-y-6">
        {!shown ? (
          loadError ? (
            <div role="alert" className="alert-err">
              <AlertCircle {...ICON_SM} />
              <div className="min-w-0 space-y-2">
                <p className="break-words">{loadError}</p>
                <button type="button" onClick={() => void loadDay(day)} className="btn-secondary bg-white px-4 text-sm">
                  <RefreshCw {...ICON_SM} />
                  ลองอีกครั้ง
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4" role="status">
              <span className="sr-only">กำลังโหลดยอดของวันที่เลือก...</span>
              <div className="skeleton h-12 rounded-lg" />
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className="stat-card">
                    <div className="skeleton h-4 w-20" />
                    <div className="skeleton h-7 w-24" />
                  </div>
                ))}
              </div>
              <div className="skeleton h-64 rounded-xl" />
            </div>
          )
        ) : (
          <>
            {loadError && (
              <div role="alert" className="alert-err">
                <AlertCircle {...ICON_SM} />
                <p className="min-w-0 break-words">{loadError}</p>
              </div>
            )}

            {/* ===== สถานะการปิดยอด ===== */}
            {!closing ? (
              <div role="status" className="alert-info">
                <Info {...ICON_SM} />
                <p className="min-w-0 break-words">
                  <span className="font-semibold">ยังไม่ปิดยอด</span>
                  {' — '}
                  {isToday
                    ? 'เมื่อปิดร้าน นับเงินสดในลิ้นชัก กรอกด้านล่าง แล้วกด "ปิดยอดวันนี้"'
                    : 'วันนี้ยังไม่มีการบันทึกปิดยอด ปิดยอดย้อนหลังได้จากด้านล่าง'}
                </p>
              </div>
            ) : shown.changed_since_close ? (
              <div role="alert" className="alert-warn">
                <AlertTriangle {...ICON_SM} />
                <div className="min-w-0 break-words">
                  <p className="font-semibold">มีรายการเปลี่ยนหลังปิดยอด กรุณาปิดยอดใหม่</p>
                  <p>
                    ปิดยอดครั้งที่ {fmtInt(closing.revision)} เมื่อ {formatThaiDateTime(closing.closed_at)}
                    {closing.closed_by_name ? ` โดย ${closing.closed_by_name}` : ''} — หลังจากนั้นมีการขาย คืนสินค้า หรือยกเลิกบิลเพิ่ม
                  </p>
                </div>
              </div>
            ) : (
              <div role="status" className="alert-ok">
                <CheckCircle2 {...ICON_SM} />
                <p className="min-w-0 break-words">
                  <span className="font-semibold">ปิดยอดแล้ว</span>
                  {' เวลา '}
                  <span className="tabular-nums">{formatThaiDateTime(closing.closed_at)}</span>
                  {closing.closed_by_name ? ` โดย ${closing.closed_by_name}` : ''}
                  {` (ครั้งที่ ${fmtInt(closing.revision)})`}
                </p>
              </div>
            )}

            {/* ===== การ์ดสรุป ===== */}
            <div className={clsx('grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:gap-6', loading && 'opacity-60')}>
              <StatCard
                label="บิลขาย"
                value={fmtInt(shown.bills)}
                unit="บิล"
                sub={`${fmtInt(shown.items_qty)} ชิ้น`}
                icon={ReceiptText}
              />
              <StatCard
                label="ยอดขายสุทธิ"
                value={baht(shown.net)}
                sub={shown.discount > 0 ? `ส่วนลด ${baht(shown.discount)}` : undefined}
                icon={TrendingUp}
              />
              <StatCard
                label="คืนเงิน"
                value={baht(shown.refunds.amount)}
                sub={`${fmtInt(shown.refunds.count)} ครั้ง`}
                icon={Undo2}
              />
              <StatCard label="ยอดหลังหักคืน" value={baht(shown.net_after_refunds)} icon={Wallet} hot />
            </div>

            <div className="flex flex-col gap-4 sm:gap-6 lg:flex-row lg:items-start">
              {/* ===== นับเงินสด / ปิดยอด (มือถือขึ้นก่อนรายละเอียด — เป็นงานหลักของหน้านี้) ===== */}
              <section
                aria-labelledby="close-cash-title"
                className="card order-first min-w-0 space-y-4 p-4 sm:p-5 lg:order-last lg:w-[400px] lg:shrink-0 xl:w-[440px]"
              >
                <h2 id="close-cash-title" className="section-title">
                  <Banknote {...ICON} />
                  นับเงินสด / ปิดยอด
                </h2>

                {/* เงินทอนตั้งต้น */}
                <div>
                  <label htmlFor="close-opening" className="field-label">เงินทอนตั้งต้น (เงินในลิ้นชักตอนเปิดร้าน)</label>
                  <input
                    id="close-opening"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    className="input text-right text-lg font-semibold tabular-nums"
                    placeholder="0"
                    value={openingText}
                    disabled={saving}
                    aria-invalid={openingCheck.problem ? true : undefined}
                    aria-describedby="close-opening-hint"
                    onChange={e => { setOpeningText(e.target.value); setSaveError('') }}
                    onFocus={e => e.currentTarget.select()}
                  />
                  {openingCheck.problem ? (
                    <p id="close-opening-hint" role="alert" className="mt-1 text-sm text-red-700">{openingCheck.problem}</p>
                  ) : (
                    <p id="close-opening-hint" className="field-hint">ไม่มีเงินทอนตั้งต้นให้เว้นว่าง (นับเป็น ฿0)</p>
                  )}
                  {lastOpening !== null && openingText.trim() === '' && !closing && (
                    <button
                      type="button"
                      onClick={() => setOpeningText(moneyText(lastOpening))}
                      disabled={saving}
                      className="btn-ghost -ml-2 mt-1 min-h-[44px] px-2 text-sm"
                    >
                      ใช้ยอดเดียวกับครั้งก่อน {baht(lastOpening)}
                    </button>
                  )}
                </div>

                {/* ยอดที่ควรมี */}
                <div className="panel space-y-1.5 p-3.5 text-sm">
                  <SummaryLine label="เงินทอนตั้งต้น" value={baht(opening ?? 0)} />
                  <SummaryLine
                    label={`+ ขายเงินสด (${fmtInt(shown.by_method.cash.count)} บิล)`}
                    value={baht(shown.cash_sales)}
                  />
                  <SummaryLine label="− คืนเงินสด" value={baht(shown.cash_refunds)} />
                  <hr className="divider !my-2" />
                  <SummaryLine label="ยอดเงินสดที่ควรมี" value={baht(expected)} strong />
                </div>

                {/* ยอดที่นับได้ */}
                <div className="space-y-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={useDetail}
                    onClick={toggleDetail}
                    disabled={saving}
                    className="panel flex min-h-[52px] w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-sm font-semibold text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="min-w-0">
                      นับแยกแบงก์/เหรียญ
                      <span className="block text-xs font-normal text-gray-500">กรอกจำนวนแต่ละชนิด ระบบรวมยอดให้</span>
                    </span>
                    <span aria-hidden="true" className={clsx('switch', useDetail && 'switch-on')}>
                      <span className="switch-knob" />
                    </span>
                  </button>

                  {useDetail ? (
                    <div className="space-y-3">
                      <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-1" aria-label="จำนวนแบงก์และเหรียญ">
                        {DENOMINATIONS.map(d => {
                          const n = countOf(detailText[d.key])
                          const inputId = `close-denom-${d.key.replace('.', '_')}`
                          return (
                            <li key={d.key} className="flex items-center gap-2 border-b border-gray-150 py-2">
                              <div className="min-w-0 flex-1">
                                <label htmlFor={inputId} className="block text-sm font-medium text-gray-900">{d.label}</label>
                                <p className="text-xs tabular-nums text-gray-500">{n > 0 ? baht(round2(d.value * n)) : '-'}</p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => stepDenom(d.key, -1)}
                                  disabled={saving || n <= 0}
                                  className="btn-icon"
                                  aria-label={`ลดจำนวน ${d.label}`}
                                >
                                  <Minus {...ICON_SM} />
                                </button>
                                <input
                                  id={inputId}
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  autoComplete="off"
                                  className="input w-16 px-1 text-center font-semibold tabular-nums placeholder:font-normal placeholder:text-gray-400"
                                  placeholder="0"
                                  value={detailText[d.key]}
                                  disabled={saving}
                                  onChange={e => { setDenom(d.key, e.target.value); setSaveError('') }}
                                  onFocus={e => e.currentTarget.select()}
                                />
                                <button
                                  type="button"
                                  onClick={() => stepDenom(d.key, 1)}
                                  disabled={saving || n >= MAX_COUNT}
                                  className="btn-icon"
                                  aria-label={`เพิ่มจำนวน ${d.label}`}
                                >
                                  <Plus {...ICON_SM} />
                                </button>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                      <div className="panel flex items-center justify-between gap-3 p-3.5">
                        <span className="text-sm font-semibold text-gray-900">ยอดเงินสดที่นับได้</span>
                        <span className="money whitespace-nowrap text-lg text-gray-900">{baht(detailTotal)}</span>
                      </div>
                      {countedProblem && <p role="alert" className="text-sm text-red-700">{countedProblem}</p>}
                      {detailTotal > 0 && (
                        <button
                          type="button"
                          onClick={() => setDetailText(EMPTY_DETAIL)}
                          disabled={saving}
                          className="btn-ghost -ml-2 min-h-[44px] px-2 text-sm"
                        >
                          ล้างจำนวนทั้งหมด
                        </button>
                      )}
                    </div>
                  ) : (
                    <div>
                      <label htmlFor="close-counted" className="field-label">ยอดเงินสดที่นับได้</label>
                      <input
                        id="close-counted"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        className="input text-right text-lg font-semibold tabular-nums"
                        placeholder="นับได้กี่บาท"
                        value={countedText}
                        disabled={saving}
                        aria-invalid={countedProblem ? true : undefined}
                        aria-describedby="close-counted-hint"
                        onChange={e => { setCountedText(e.target.value); setSaveError('') }}
                        onFocus={e => e.currentTarget.select()}
                      />
                      {countedProblem ? (
                        <p id="close-counted-hint" role="alert" className="mt-1 text-sm text-red-700">{countedProblem}</p>
                      ) : (
                        <p id="close-counted-hint" className="field-hint">รวมเงินทอนตั้งต้นด้วย (นับเงินทั้งหมดในลิ้นชัก)</p>
                      )}
                    </div>
                  )}
                </div>

                {/* ส่วนต่าง */}
                <div aria-live="polite">
                  {diff === null ? (
                    <p className="panel px-3.5 py-3 text-sm text-gray-500">กรอกยอดที่นับได้เพื่อดูส่วนต่างกับยอดที่ควรมี</p>
                  ) : (
                    <div className={diff === 0 ? 'alert-ok' : diff > 0 ? 'alert-warn' : 'alert-err'}>
                      {diff === 0 ? <CheckCircle2 {...ICON_SM} /> : <AlertTriangle {...ICON_SM} />}
                      <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                        <span className="font-medium">ส่วนต่าง</span>
                        <span className="money whitespace-nowrap text-base">{cashDiffText(diff)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* หมายเหตุ */}
                <div>
                  <label htmlFor="close-note" className="field-label">หมายเหตุ</label>
                  <textarea
                    id="close-note"
                    className="input"
                    rows={2}
                    maxLength={500}
                    value={note}
                    disabled={saving}
                    placeholder="เช่น เงินขาดเพราะทอนผิด / นำเงินเข้าธนาคารแล้ว"
                    onChange={e => setNote(e.target.value)}
                  />
                </div>

                {saveError && (
                  <div role="alert" className="alert-err">
                    <AlertCircle {...ICON_SM} />
                    <p className="min-w-0 break-words">{saveError}</p>
                  </div>
                )}

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => { setSaveError(''); setConfirmOpen(true) }}
                    disabled={!canClose}
                    className="btn-primary min-h-[52px] w-full text-base"
                  >
                    {saving ? <Loader2 {...ICON_SM} className="animate-spin" /> : <CalendarCheck {...ICON_SM} />}
                    {saving ? 'กำลังบันทึก...' : closeLabel}
                  </button>
                  {closeHint && <p className="text-center text-xs text-gray-500">{closeHint}</p>}
                  <button type="button" onClick={startPrint} disabled={loading} className="btn-secondary w-full">
                    <Printer {...ICON_SM} />
                    พิมพ์สรุปยอด
                  </button>
                </div>
              </section>

              {/* ===== รายละเอียดยอดขาย ===== */}
              <div className={clsx('min-w-0 space-y-4 sm:space-y-6 lg:flex-1', loading && 'opacity-60')}>
                <section className="card overflow-hidden" aria-labelledby="close-method-title">
                  <div className="card-header">
                    <h2 id="close-method-title" className="section-title">
                      <Wallet {...ICON} />
                      แยกตามวิธีชำระ
                    </h2>
                  </div>
                  <div className="table-wrap">
                    <table className="table-soft">
                      <thead>
                        <tr>
                          <th>วิธีชำระ</th>
                          <th className="text-right">บิล</th>
                          <th className="text-right">ยอดเงิน</th>
                        </tr>
                      </thead>
                      <tbody>
                        {methods.map(m => (
                          <tr key={m}>
                            <td className="font-medium text-gray-900">{PAYMENT_METHOD_LABELS[m]}</td>
                            <td className="text-right tabular-nums text-gray-700">{fmtInt(shown.by_method[m].count)}</td>
                            <td className="money whitespace-nowrap text-right text-gray-900">{baht(shown.by_method[m].amount)}</td>
                          </tr>
                        ))}
                        <tr className="bg-gray-50">
                          <td className="font-semibold text-gray-900">รวม</td>
                          <td className="text-right font-semibold tabular-nums text-gray-900">{fmtInt(shown.bills)}</td>
                          <td className="money whitespace-nowrap text-right text-gray-900">{baht(shown.net)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {shown.by_method.marketplace.count > 0 && (
                    <p className="border-t border-gray-150 px-4 py-2.5 text-xs text-gray-500 sm:px-5">
                      ชำระผ่านแพลตฟอร์ม = ออเดอร์ออนไลน์ เงินไม่เข้าลิ้นชัก
                    </p>
                  )}
                </section>

                <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <section className="card min-w-0" aria-labelledby="close-detail-title">
                    <div className="card-header">
                      <h2 id="close-detail-title" className="section-title">
                        <ListChecks {...ICON} />
                        รายละเอียดอื่น
                      </h2>
                    </div>
                    <div className="space-y-2.5 px-4 py-3.5 text-sm sm:px-5">
                      <SummaryLine label="ยอดก่อนส่วนลด" value={baht(shown.gross)} />
                      <SummaryLine label="ส่วนลดรวม" value={shown.discount > 0 ? `-${baht(shown.discount)}` : baht(0)} />
                      <SummaryLine label="จำนวนชิ้นที่ขาย" value={`${fmtInt(shown.items_qty)} ชิ้น`} />
                      <hr className="divider" />
                      <SummaryLine
                        label={`คืนเงิน (${fmtInt(shown.refunds.count)} ครั้ง)`}
                        value={shown.refunds.amount > 0 ? `-${baht(shown.refunds.amount)}` : baht(0)}
                      />
                      {shown.refunds.count > 0 && (
                        <div className="space-y-1 border-l-2 border-gray-150 pl-3 text-[13px]">
                          {REFUND_METHOD_OPTIONS.map(o => (
                            <SummaryLine key={o.value} label={o.label} value={baht(shown.refunds.by_method[o.value])} />
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-gray-500">นับตามวันที่คืนจริง (รวมบิลของวันก่อน)</p>
                      <hr className="divider" />
                      <SummaryLine
                        label={`บิลที่ยกเลิก (${fmtInt(shown.voided.count)} บิล)`}
                        value={baht(shown.voided.amount)}
                      />
                      <p className="text-xs text-gray-500">ไม่นับรวมในยอดขาย</p>
                      {shown.first_bill_at && (
                        <>
                          <hr className="divider" />
                          <SummaryLine
                            label="เวลาขาย"
                            value={`${formatThaiTime(shown.first_bill_at)} – ${formatThaiTime(shown.last_bill_at)} น.`}
                          />
                        </>
                      )}
                    </div>
                  </section>

                  <section className="card min-w-0" aria-labelledby="close-channel-title">
                    <div className="card-header">
                      <h2 id="close-channel-title" className="section-title">
                        <Store {...ICON} />
                        แยกตามช่องทางขาย
                      </h2>
                    </div>
                    {shown.by_channel.length === 0 ? (
                      <div className="empty-state py-8">
                        <span className="icon-bubble"><ReceiptText {...ICON} /></span>
                        <p className="empty-state-title">ยังไม่มีบิลขาย</p>
                      </div>
                    ) : (
                      <ul className="divide-y divide-gray-150">
                        {shown.by_channel.map(c => (
                          <li key={c.channel} className="flex items-center justify-between gap-3 px-4 py-3 text-sm sm:px-5">
                            <span className="min-w-0 break-words font-medium text-gray-900">
                              {saleChannelLabel(c.channel)}
                              <span className="ml-1.5 font-normal text-gray-500">{fmtInt(c.count)} บิล</span>
                            </span>
                            <span className="money shrink-0 whitespace-nowrap text-gray-900">{baht(c.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ===== ประวัติการปิดยอด ===== */}
      <section className="card overflow-hidden" aria-labelledby="close-history-title">
        <div className="card-header flex-wrap">
          <h2 id="close-history-title" className="section-title">
            <History {...ICON} />
            ประวัติการปิดยอด
          </h2>
          <span className="chip tabular-nums">ล่าสุด {fmtInt(closings.length)} วัน</span>
        </div>
        {closingsError ? (
          <div className="p-4 sm:p-5">
            <div role="alert" className="alert-err">
              <AlertCircle {...ICON_SM} />
              <p className="min-w-0 break-words">{closingsError}</p>
            </div>
          </div>
        ) : closings.length === 0 ? (
          <div className="empty-state">
            <span className="icon-bubble icon-bubble-lg"><History size={28} strokeWidth={1.75} aria-hidden="true" /></span>
            <p className="empty-state-title">ยังไม่เคยปิดยอด</p>
          </div>
        ) : (
          <>
            {/* มือถือ / iPad แนวตั้ง: แถวเรียงลงมา แตะเพื่อเปิดวันนั้น */}
            <ul className="divide-y divide-gray-150 md:hidden">
              {closings.map(c => (
                <li key={c.day}>
                  <button
                    type="button"
                    onClick={() => changeDay(c.day)}
                    disabled={saving}
                    aria-current={c.day === day ? 'date' : undefined}
                    className={clsx(
                      'flex w-full min-h-[56px] items-start gap-3 px-4 py-3 text-left transition-colors active:bg-gray-100 [@media(hover:hover)]:hover:bg-gray-50',
                      c.day === day && 'bg-brand-50',
                    )}
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-sm font-semibold tabular-nums text-gray-900">{formatThaiDate(c.day)}</p>
                      <p className="text-xs tabular-nums text-gray-500">
                        ควรมี {baht(c.expected_cash)} · นับได้ {baht(c.counted_cash)}
                      </p>
                      <p className="text-xs text-gray-500">
                        ครั้งที่ {fmtInt(c.revision)}{c.closed_by_name ? ` · ${c.closed_by_name}` : ''}
                      </p>
                    </div>
                    <span className={clsx('money shrink-0 whitespace-nowrap text-sm', diffTextClass(c.cash_diff))}>
                      {cashDiffText(c.cash_diff)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {/* คอม: ตาราง */}
            <div className="table-wrap hidden md:block">
              <table className="table-soft min-w-[640px]">
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th className="text-right">ควรมี</th>
                    <th className="text-right">นับได้</th>
                    <th className="text-right">ส่วนต่าง</th>
                    <th className="text-right">ครั้งที่</th>
                    <th>ปิดยอดโดย</th>
                    <th><span className="sr-only">เปิดดู</span></th>
                  </tr>
                </thead>
                <tbody>
                  {closings.map(c => (
                    <tr key={c.day} className={c.day === day ? 'bg-brand-50' : undefined}>
                      <td className="whitespace-nowrap font-medium tabular-nums text-gray-900">{formatThaiDate(c.day)}</td>
                      <td className="whitespace-nowrap text-right tabular-nums text-gray-700">{baht(c.expected_cash)}</td>
                      <td className="whitespace-nowrap text-right tabular-nums text-gray-700">{baht(c.counted_cash)}</td>
                      <td className={clsx('money whitespace-nowrap text-right', diffTextClass(c.cash_diff))}>
                        {cashDiffText(c.cash_diff)}
                      </td>
                      <td className="text-right tabular-nums text-gray-700">{fmtInt(c.revision)}</td>
                      <td className="text-gray-700">
                        <p className="break-words">{c.closed_by_name || '-'}</p>
                        <p className="text-xs tabular-nums text-gray-500">{formatThaiDateTime(c.closed_at)}</p>
                      </td>
                      <td className="whitespace-nowrap text-right">
                        {c.day === day ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-700">
                            <Check {...ICON_XS} />
                            เปิดอยู่
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => changeDay(c.day)}
                            disabled={saving}
                            className="btn-ghost min-h-[36px] px-2.5 text-sm"
                            aria-label={`เปิดยอดวันที่ ${formatThaiDate(c.day)}`}
                          >
                            เปิดดู
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* ===== ยืนยันปิดยอด ===== */}
      <ConfirmDialog
        open={confirmOpen && !!shown}
        title={closing
          ? `ปิดยอดใหม่ วันที่ ${formatThaiDate(day)} (ครั้งที่ ${fmtInt(closing.revision + 1)})`
          : `ยืนยันปิดยอดวันที่ ${formatThaiDate(day)}`}
        confirmLabel={saving ? 'กำลังบันทึก...' : 'ยืนยันปิดยอด'}
        busy={saving}
        onConfirm={() => void doClose()}
        onCancel={closeConfirm}
      >
        {shown && (
          <>
            <div className="panel space-y-1.5 p-3.5">
              <SummaryLine label="ยอดขายสุทธิ" value={baht(shown.net)} />
              <SummaryLine label="ยอดหลังหักคืน" value={baht(shown.net_after_refunds)} />
              <hr className="divider !my-2" />
              <SummaryLine label="ยอดเงินสดที่ควรมี" value={baht(expected)} />
              <SummaryLine label="นับได้จริง" value={counted === null ? '-' : baht(counted)} />
              {diff !== null && (
                <SummaryLine
                  label="ส่วนต่าง"
                  value={<span className={diffTextClass(diff)}>{cashDiffText(diff)}</span>}
                  strong
                />
              )}
            </div>
            {diff !== null && diff !== 0 && (
              <p>เงินสด{diff > 0 ? 'เกิน' : 'ขาด'}จากยอดที่ควรมี — นับซ้ำอีกครั้ง หรือใส่เหตุผลในหมายเหตุก่อนยืนยัน</p>
            )}
            {closing && <p className="text-gray-500">ตัวเลขของการปิดยอดครั้งก่อนจะถูกเก็บไว้ในประวัติ</p>}
          </>
        )}
      </ConfirmDialog>

      {/* ===== พิมพ์สรุปยอด (ใช้ขนาดกระดาษใบเสร็จของร้าน) ===== */}
      <PrintPortal open={printing} paper={shop.receipt_paper} onDone={() => setPrinting(false)}>
        {shown && <DaySummaryPrint shop={shop} summary={shown} draft={draft} printedAt={printedAt || new Date()} />}
      </PrintPortal>

      {/* ===== โทสต์ผลการปิดยอด ===== */}
      {toast && (
        <div
          role={toast.ok ? 'status' : 'alert'}
          aria-live="polite"
          className="pointer-events-none fixed inset-x-4 z-40 flex justify-center bottom-[calc(1rem_+_env(safe-area-inset-bottom))] md:left-[calc(15rem_+_1rem)] lg:bottom-6"
        >
          <div className={clsx(toast.ok ? 'toast-ok' : 'toast-err', 'pointer-events-auto')}>
            <span className="toast-icon">
              {toast.ok
                ? <Check size={18} strokeWidth={2.4} aria-hidden="true" />
                : <X size={18} strokeWidth={2.4} aria-hidden="true" />}
            </span>
            <span className="min-w-0 break-words">{toast.text}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="btn-icon btn-icon-plain -my-1 -mr-3 text-current"
              aria-label="ปิดข้อความ"
            >
              <X {...ICON_SM} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
