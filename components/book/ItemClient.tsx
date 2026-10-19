'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, Info, Plus, Ruler, ShoppingBag, X } from 'lucide-react'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { baht } from '@/lib/format'
import {
  linePrice, rentalDays, sizeKey, sizeLabel, type PublicInfo, type PublicItem, type RentalSize,
} from '@/lib/rental'
import ConfirmDialog from '@/components/integrations/ConfirmDialog'
import { fetchAvailability } from '@/components/book/api'
import { addCartLine, getCart, useBookCart } from '@/components/book/cart'
import { itemHref } from '@/components/book/catalogQuery'
import {
  addMonths, earliestPickup, eachDay, monthInfo, monthKeyOf, rangeProblem, shortDay,
} from '@/components/book/dates'
import AvailabilityCalendar, { freeOnDay, type AvailMap } from '@/components/book/AvailabilityCalendar'
import Gallery from '@/components/book/Gallery'
import ItemCard from '@/components/book/ItemCard'

// หน้าชุด 1 แบบ (ฝั่งเบราว์เซอร์): รูป · รายละเอียด/ราคา · เลือกไซส์ · ปฏิทินวันว่าง 2 เดือน + เลือกวันรับ–คืน · เพิ่มในรายการจอง
// - ช่วงวันเริ่มต้น: จาก URL (?from&to ที่พกมาจากหน้าแรก) ไม่มีก็ใช้วันของรายการจองที่มีอยู่
// - ทุกชุดในคำขอเดียวกันใช้วันรับ–คืนเดียวกัน: เลือกวันต่างจากรายการเดิม → ถามก่อนว่าจะเปลี่ยนวันของทั้งรายการไหม
// - วันว่างโหลดทีละ 2 เดือน (เดือนที่ดู + เดือนถัดไป) สะสมไว้ ไม่โหลดซ้ำ
// - ราคาที่แสดงเป็นประมาณการจากราคาของชุด — ร้านคำนวณยอดจริงตอนรับคำขอ

type Props = {
  item: PublicItem
  info: PublicInfo
  todayKey: string
  initialFrom: string | null
  initialTo: string | null
}

const MONTHS_AHEAD = 12

export default function ItemClient({ item, info, todayKey, initialFrom, initialTo }: Props) {
  const cart = useBookCart()
  const lead = info.online_min_lead_days
  const maxDays = info.online_max_days
  const earliest = earliestPickup(todayKey, lead)
  const minMonth = monthKeyOf(todayKey)
  const maxMonth = addMonths(minMonth, MONTHS_AHEAD)

  const [size, setSize] = useState<RentalSize | undefined>(item.sizes.length === 1 ? item.sizes[0] : undefined)
  const [from, setFrom] = useState<string | null>(initialFrom)
  const [to, setTo] = useState<string | null>(initialTo)
  const [monthKey, setMonthKey] = useState(monthKeyOf(initialFrom ?? earliest) || minMonth)
  const [avail, setAvail] = useState<AvailMap>({})
  const [availLoading, setAvailLoading] = useState(false)
  const [availError, setAvailError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const fetched = useRef(new Set<string>())
  const seq = useRef(0)

  const [actionError, setActionError] = useState<string | null>(null)
  const [added, setAdded] = useState<{ count: number; size: RentalSize } | null>(null)
  const [confirmDates, setConfirmDates] = useState(false)
  const adoptedCartDates = useRef(initialFrom !== null)

  // ไม่ได้พกวันมาจาก URL → ใช้วันของรายการจองเดิม (ครั้งเดียว ตอนอ่านตะกร้าจากเครื่องได้แล้ว)
  useEffect(() => {
    if (adoptedCartDates.current) return
    if (!cart.pickup || !cart.ret) return
    adoptedCartDates.current = true
    if (rangeProblem(cart.pickup, cart.ret, todayKey, lead, maxDays) !== null) return
    setFrom(cart.pickup)
    setTo(cart.ret)
    setMonthKey(monthKeyOf(cart.pickup))
  }, [cart.pickup, cart.ret, todayKey, lead, maxDays])

  // โหลดวันว่างของ 2 เดือนที่กำลังดู (ไม่ย้อนก่อนวันนี้ — ฐานข้อมูลไม่รับ)
  useEffect(() => {
    const first = monthInfo(monthKey)
    const second = monthInfo(addMonths(monthKey, 1))
    if (!first || !second) return
    const winFrom = first.first < todayKey ? todayKey : first.first
    const winTo = second.last
    if (winTo < winFrom) return
    const key = `${winFrom}|${winTo}`
    if (fetched.current.has(key)) return
    const my = ++seq.current
    setAvailLoading(true)
    setAvailError(null)
    void fetchAvailability(item.id, winFrom, winTo).then(r => {
      if (my !== seq.current) return
      setAvailLoading(false)
      if (!r.ok) {
        setAvailError(r.message)
        return
      }
      fetched.current.add(key)
      setAvail(prev => {
        const next: AvailMap = { ...prev }
        for (const d of r.data.days) {
          const bySize: Record<string, number> = {}
          for (const s of d.sizes) bySize[sizeKey(s.size)] = (bySize[sizeKey(s.size)] ?? 0) + s.free
          next[d.day] = bySize
        }
        return next
      })
    })
  }, [monthKey, item.id, todayKey, reloadTick])

  const selectedKey = size === undefined ? null : sizeKey(size)
  const days = from && to ? rentalDays(from, to) : 0
  const price = days > 0 ? linePrice(item.base_price, item.base_days, item.extra_day_price, days) : 0

  // ชุดเดียวกันไซส์เดียวกันที่อยู่ในรายการจองแล้ว (วันเดียวกัน) → ต้องว่างพอสำหรับตัวที่จะเพิ่มด้วย
  const sameInCart = cart.lines.filter(l => l.item_id === item.id && size !== undefined && sizeKey(l.size) === selectedKey).length
  const cartSameDates = cart.pickup === from && cart.ret === to
  const needed = 1 + (cartSameDates ? sameInCart : 0)

  const rangeIssue = useMemo(() => {
    if (!from || !to) return null
    const p = rangeProblem(from, to, todayKey, lead, maxDays)
    if (p) return p
    if (size === undefined) return null
    let shortest: number | null = null
    for (const d of eachDay(from, to)) {
      const f = freeOnDay(avail, d, selectedKey)
      if (f === null) continue
      shortest = shortest === null ? f : Math.min(shortest, f)
    }
    if (shortest === null) return null
    if (shortest === 0) return `ไซส์ ${sizeLabel(size)} ไม่ว่างบางวันในช่วงนี้ — ลองเลือกวันอื่นหรือไซส์อื่น`
    if (shortest < needed) {
      return `ไซส์ ${sizeLabel(size)} ว่างแค่ ${shortest} ตัวในช่วงนี้ (มีในรายการจองแล้ว ${needed - 1} ตัว)`
    }
    return null
  }, [from, to, todayKey, lead, maxDays, size, avail, selectedKey, needed])

  const pick = useCallback((day: string) => {
    setActionError(null)
    setAdded(null)
    if (!from || to || day < from) {
      setFrom(day)
      setTo(null)
      return
    }
    setTo(day)
  }, [from, to])

  function clearRange() {
    setFrom(null)
    setTo(null)
    setAdded(null)
  }

  function onAdd() {
    setActionError(null)
    if (size === undefined) {
      setActionError('กรุณาเลือกไซส์ก่อน')
      return
    }
    if (!from || !to) {
      setActionError('กรุณาเลือกวันรับชุดและวันคืนชุดในปฏิทิน')
      return
    }
    if (rangeIssue) {
      setActionError(rangeIssue)
      return
    }
    const cur = getCart()
    if (cur.lines.length > 0 && (cur.pickup !== from || cur.ret !== to)) {
      setConfirmDates(true)
      return
    }
    doAdd()
  }

  function doAdd() {
    setConfirmDates(false)
    if (size === undefined || !from || !to) return
    const r = addCartLine(
      {
        item_id: item.id,
        code: item.code,
        name: item.name,
        size,
        cover_path: item.images[0]?.path ?? null,
        base_price: item.base_price,
        base_days: item.base_days,
        extra_day_price: item.extra_day_price,
        security_deposit: item.security_deposit,
      },
      from,
      to,
    )
    if (!r.ok) {
      setActionError(r.message)
      return
    }
    setAdded({ count: r.count, size })
  }

  const cur = cart
  const hint = !from
    ? 'แตะวันรับชุดในปฏิทิน'
    : !to
      ? 'แตะวันคืนชุด (แตะวันเดียวกันถ้าเช่า 1 วัน)'
      : null

  return (
    <div className="space-y-6">
      <Link href={from && to ? `/book?from=${from}&to=${to}` : '/book'} className="link -my-2">
        <ArrowLeft {...ICON_XS} />
        ดูชุดทั้งหมด
      </Link>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-8">
        {/* ===== รูป ===== */}
        <div className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <Gallery images={item.images} name={item.name} />
        </div>

        {/* ===== รายละเอียด + จอง ===== */}
        <div className="min-w-0 space-y-5">
          <section className="space-y-2" aria-labelledby="item-title">
            {item.category_name && <p className="text-sm text-gray-500">{item.category_name}</p>}
            <h1 id="item-title" className="page-title break-words">{item.name}</h1>
            <p className="text-sm text-gray-500">
              รหัส {item.code}
              {item.color ? ` · สี${item.color}` : ''}
            </p>

            <dl className="panel mt-3 divide-y divide-gray-150 text-sm">
              <div className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                <dt className="text-gray-600">ค่าเช่า {item.base_days} วันแรก</dt>
                <dd className="money text-lg text-gray-900">{baht(item.base_price)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                <dt className="text-gray-600">วันต่อไป</dt>
                <dd className="money text-gray-900">{item.extra_day_price > 0 ? `${baht(item.extra_day_price)} / วัน` : 'ไม่คิดเพิ่ม'}</dd>
              </div>
              {item.security_deposit > 0 && (
                <div className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                  <dt className="text-gray-600">
                    ค่าประกันชุด
                    <span className="block text-xs text-gray-500">ชำระวันรับชุด ได้คืนเมื่อคืนชุดครบสภาพดี</span>
                  </dt>
                  <dd className="money text-gray-900">{baht(item.security_deposit)}</dd>
                </div>
              )}
              {info.booking_deposit_percent > 0 && (
                <div className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                  <dt className="text-gray-600">มัดจำเพื่อยืนยันการจอง</dt>
                  <dd className="text-gray-900">{info.booking_deposit_percent}% ของค่าเช่า</dd>
                </div>
              )}
            </dl>

            {item.description && (
              <p className="whitespace-pre-line break-words pt-2 text-sm leading-relaxed text-gray-700">{item.description}</p>
            )}
          </section>

          {/* ไซส์ */}
          <section className="space-y-2" aria-labelledby="item-size-title">
            <h2 id="item-size-title" className="section-title">
              <Ruler {...ICON_SM} />
              เลือกไซส์
            </h2>
            {item.sizes.length === 0 ? (
              <p className="text-sm text-gray-500">ชุดนี้ยังไม่มีตัวที่พร้อมให้เช่า สอบถามร้านได้โดยตรง</p>
            ) : (
              <div className="flex flex-wrap gap-2" role="group" aria-label="ไซส์">
                {item.sizes.map(s => (
                  <button
                    key={sizeKey(s) || 'free'}
                    type="button"
                    className="chip-toggle min-w-[3.5rem]"
                    aria-pressed={size !== undefined && sizeKey(size) === sizeKey(s)}
                    onClick={() => {
                      setSize(s)
                      setActionError(null)
                      setAdded(null)
                    }}
                  >
                    {sizeLabel(s)}
                  </button>
                ))}
              </div>
            )}
            {size === undefined && item.sizes.length > 1 && (
              <p className="field-hint">ยังไม่เลือกไซส์ — ปฏิทินแสดงวันที่มีไซส์ใดไซส์หนึ่งว่าง</p>
            )}
          </section>

          {/* ปฏิทิน */}
          <section className="card space-y-3 p-3 sm:p-5" aria-labelledby="item-cal-title">
            <h2 id="item-cal-title" className="section-title">
              <CalendarDays {...ICON_SM} />
              เลือกวันรับชุด – วันคืนชุด
            </h2>
            <p className="field-hint mt-0">
              รับชุดได้ตั้งแต่ {shortDay(earliest)} · จองออนไลน์ได้ครั้งละไม่เกิน {maxDays} วัน
              {size !== undefined ? ` · แสดงวันว่างของไซส์ ${sizeLabel(size)}` : ''}
            </p>
            <AvailabilityCalendar
              monthKey={monthKey}
              onMonthChange={setMonthKey}
              minMonth={minMonth}
              maxMonth={maxMonth}
              earliest={earliest}
              todayKey={todayKey}
              sizeKeyValue={selectedKey}
              sizeName={size === undefined ? null : sizeLabel(size)}
              avail={avail}
              loading={availLoading}
              error={availError}
              onRetry={() => setReloadTick(t => t + 1)}
              from={from}
              to={to}
              maxDays={maxDays}
              onPick={pick}
            />

            <div className="panel space-y-2 p-3.5" aria-live="polite">
              {hint && <p className="text-sm text-gray-600">{hint}</p>}
              {from && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-gray-900">
                    <span className="text-gray-500">รับชุด</span> <span className="font-semibold">{shortDay(from)}</span>
                    {to && (
                      <>
                        {' '}<span className="text-gray-500">คืนชุด</span> <span className="font-semibold">{shortDay(to)}</span>
                        <span className="text-gray-500"> · {days} วัน</span>
                      </>
                    )}
                  </p>
                  <button type="button" onClick={clearRange} className="btn-ghost min-h-[44px] px-2 text-sm">
                    <X {...ICON_XS} />
                    ล้างวันที่
                  </button>
                </div>
              )}
              {from && to && !rangeIssue && (
                <p className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-gray-600">ค่าเช่า {days} วัน (ประมาณ)</span>
                  <span className="money text-lg text-gray-900">{baht(price)}</span>
                </p>
              )}
              {rangeIssue && (
                <p className="flex items-start gap-2 text-sm text-amber-800">
                  <AlertTriangle {...ICON_XS} className="mt-0.5" />
                  <span className="min-w-0">{rangeIssue}</span>
                </p>
              )}
            </div>

            {actionError && (
              <div role="alert" className="alert-err">
                <Info {...ICON_SM} />
                <p className="min-w-0">{actionError}</p>
              </div>
            )}

            {added ? (
              <div className="alert-ok" role="status">
                <CheckCircle2 {...ICON_SM} />
                <div className="min-w-0 space-y-3">
                  <p>
                    เพิ่ม {item.name} ไซส์ {sizeLabel(added.size)} ในรายการจองแล้ว (รวม {added.count} ชุด)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Link href="/book/checkout" className="btn-primary">
                      <ShoppingBag {...ICON_SM} />
                      ดูรายการจอง / ส่งคำขอ
                    </Link>
                    <Link href={from && to ? `/book?from=${from}&to=${to}` : '/book'} className="btn-secondary">
                      เลือกชุดอื่นเพิ่ม
                    </Link>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={onAdd}
                disabled={item.sizes.length === 0}
                className="btn-primary w-full"
              >
                <Plus {...ICON_SM} />
                เพิ่มในรายการจอง{from && to && !rangeIssue ? ` · ${baht(price)}` : ''}
              </button>
            )}
            {cur.lines.length > 0 && !added && (
              <p className="text-center text-sm text-gray-600">
                มีในรายการจองแล้ว {cur.lines.length} ชุด
                {cur.pickup && cur.ret ? ` (${shortDay(cur.pickup)} – ${shortDay(cur.ret)})` : ''} ·{' '}
                <Link href="/book/checkout" className="font-medium text-brand-700 underline-offset-4 hover:underline">
                  ดูรายการจอง
                </Link>
              </p>
            )}
          </section>
        </div>
      </div>

      {item.accessories.length > 0 && (
        <section className="space-y-3" aria-labelledby="item-acc-title">
          <h2 id="item-acc-title" className="section-title">เครื่องประดับ / อุปกรณ์เสริมที่เช่าคู่กันได้</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {item.accessories.map(a => (
              <li key={a.id || a.code} className="min-w-0">
                <ItemCard item={a} href={itemHref(a.code, from && to ? from : null, from && to ? to : null)} compact />
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={confirmDates}
        title="เปลี่ยนวันของรายการจองทั้งหมด?"
        confirmLabel="เปลี่ยนวันและเพิ่มชุดนี้"
        onConfirm={doAdd}
        onCancel={() => setConfirmDates(false)}
      >
        <p>
          ทุกชุดในคำขอจองเดียวกันต้องรับและคืนวันเดียวกัน รายการจองเดิมของคุณคือ{' '}
          <span className="font-semibold">{shortDay(cur.pickup)} – {shortDay(cur.ret)}</span>
        </p>
        <p>
          ถ้ากดยืนยัน ทุกชุดในรายการจะเปลี่ยนเป็น{' '}
          <span className="font-semibold">{shortDay(from)} – {shortDay(to)}</span> (ชุดเดิมอาจไม่ว่างในวันใหม่ ร้านจะแจ้งให้ทราบ)
        </p>
      </ConfirmDialog>
    </div>
  )
}
