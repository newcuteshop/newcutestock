'use client'
// รูป "ตารางงานประจำวัน" สำหรับส่งเข้ากลุ่ม LINE ทีมงาน — กว้าง 1080px (CSS) สูงตามเนื้อหา พื้นขาว สีเน้นทองแชมเปญของร้าน (data-shop="wedding")
// ทุกคิวของวัน เรียงตามเวลา: ทีมถึง (ตัวใหญ่) · เวลางาน · ประเภท · คู่บ่าวสาว · สถานที่ (+ ลิงก์แผนที่เป็นข้อความ) · ผู้ติดต่อ · ทีมงาน · การแต่งกาย · หมายเหตุ · กำหนดการ
// ไม่ใส่ค่าตัวทีมงานเด็ดขาด (รูปส่งเข้ากลุ่ม ทุกคนเห็นของกันและกัน) · ยอดเงินของงานใส่เมื่อเลือก "แสดงยอดเงิน" เท่านั้น
// ตัวอักษรขนาดใหญ่ (โทรศัพท์ย่อรูปลง ~1/3) · ไม่มีเงา/ไล่สี (ธีมทางการ)
import { forwardRef } from 'react'
import WeddingMark from '@/components/theme/WeddingMark'
import { baht, formatThaiDateTime, formatThaiDayLong } from '@/lib/format'
import {
  crewRoleLabel, formatPhone, normTime, sessionTimeText, type WedDaySession, type WedSettings,
} from '@/lib/wedding'
import { crewShortName } from './CrewChips'

export const DAY_IMAGE_WIDTH = 1080

export interface DayImageOptions {
  showMoney: boolean
  showContacts: boolean
  showRunSheet: boolean
}

export interface DayImageShop {
  name: string
  tagline: string | null
  phone: string | null
  line_id: string | null
  /** ลิงก์โลโก้ (weddingLogoUrl) ; '' = ใช้โลโก้เมฆของระบบ */
  logoUrl: string
}

export function dayImageShop(s: WedSettings, logoUrl: string): DayImageShop {
  return { name: s.shop_name, tagline: s.tagline, phone: s.phone, line_id: s.line_id, logoUrl }
}

const DayScheduleImage = forwardRef<HTMLDivElement, {
  day: string
  sessions: readonly WedDaySession[]
  shop: DayImageShop
  options: DayImageOptions
  /** เวลาที่สร้างรูป (ISO) — ส่งจากผู้เรียก ให้รูปตัวอย่างกับรูปจริงตรงกัน */
  createdAt: string
  /** โลโก้โหลดไม่ได้ → ใช้โลโก้เมฆแทน */
  logoFailed: boolean
  onLogoLoad?(): void
  onLogoError?(): void
}>(function DayScheduleImage({ day, sessions, shop, options, createdAt, logoFailed, onLogoLoad, onLogoError }, ref) {
  const jobs = new Set(sessions.map(s => s.booking_id)).size
  const contacts = [shop.phone ? `โทร ${formatPhone(shop.phone)}` : '', shop.line_id ? `LINE ${shop.line_id}` : '']
    .filter(Boolean).join(' · ')

  return (
    <div
      ref={ref}
      data-shop="wedding"
      className="bg-white font-sans text-gray-900"
      style={{ width: DAY_IMAGE_WIDTH }}
    >
      {/* ===== หัวรูป ===== */}
      <div className="flex items-center gap-6 border-b-[6px] border-brand-400 px-14 pb-9 pt-14">
        {shop.logoUrl && !logoFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- รูปจาก storage ต้องเป็น <img> ธรรมดาให้ตัวแปลงรูปฝังได้
          <img
            src={shop.logoUrl}
            alt=""
            crossOrigin="anonymous"
            onLoad={onLogoLoad}
            onError={onLogoError}
            className="h-24 w-24 shrink-0 rounded-[22%] object-cover"
          />
        ) : (
          <WeddingMark size="lg" className="!h-24 !w-24" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[34px] font-semibold leading-tight break-words">{shop.name}</p>
          {shop.tagline && <p className="mt-1 text-[22px] leading-snug text-gray-500 break-words">{shop.tagline}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[24px] font-semibold text-brand-700">ตารางงานประจำวัน</p>
          <p className="text-[34px] font-bold leading-tight">{formatThaiDayLong(day)}</p>
          <p className="text-[22px] text-gray-600 tabular-nums">
            {jobs.toLocaleString('th-TH')} งาน · {sessions.length.toLocaleString('th-TH')} คิว
          </p>
        </div>
      </div>

      {/* ===== คิวงาน ===== */}
      <div className="space-y-8 px-14 py-10">
        {sessions.length === 0 && (
          <p className="rounded-[24px] border-2 border-gray-200 px-8 py-16 text-center text-[30px] text-gray-500">ไม่มีคิวงานในวันนี้</p>
        )}
        {sessions.map((s, idx) => {
          const call = normTime(s.call_time)
          const customer = [s.customer.name, s.customer.partner_name].filter(Boolean).join(' & ')
          return (
            <div key={s.session_id} className="overflow-hidden rounded-[24px] border-2 border-gray-200">
              <div className="flex">
                {/* ช่องเวลา */}
                <div className="w-[240px] shrink-0 border-r-2 border-brand-200 bg-brand-50 px-6 py-8 text-center">
                  <p className="text-[22px] font-semibold text-brand-800">คิวที่ {idx + 1}</p>
                  <p className="mt-3 text-[22px] text-gray-700">ทีมถึง</p>
                  {call
                    ? <p className="text-[52px] font-bold leading-none tabular-nums">{call}</p>
                    : <p className="text-[26px] font-semibold leading-snug text-gray-500">ยังไม่ระบุ</p>}
                  <p className="mt-4 text-[22px] text-gray-700">เวลางาน</p>
                  <p className="text-[26px] font-semibold leading-snug tabular-nums">{sessionTimeText(s, 'ไม่ระบุ')}</p>
                </div>

                {/* รายละเอียด */}
                <div className="min-w-0 flex-1 space-y-5 px-8 py-8">
                  <div>
                    <p className="text-[24px] font-semibold text-brand-700 break-words">
                      {s.type_label}{s.title ? ` · ${s.title}` : ''}
                      {s.status === 'inquiry' && <span className="text-red-700"> · ยังไม่ยืนยัน (สอบถาม)</span>}
                      {s.status === 'hold' && <span className="text-amber-800"> · ล็อกคิว รอมัดจำ</span>}
                    </p>
                    <p className="mt-1 text-[40px] font-bold leading-tight break-words">{s.couple_names || '-'}</p>
                    <p className="text-[20px] text-gray-500">เลขที่งาน {s.booking_no}</p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-[20px] font-semibold text-gray-500">สถานที่</p>
                    <p className="text-[28px] font-semibold leading-snug break-words">{s.venue_name || 'ยังไม่ระบุสถานที่'}</p>
                    {s.venue_address && <p className="text-[22px] leading-snug text-gray-700 whitespace-pre-line break-words">{s.venue_address}</p>}
                    {s.map_url && <p className="text-[18px] leading-snug text-brand-700 break-all">แผนที่: {s.map_url}</p>}
                  </div>

                  {options.showContacts && (customer || s.coordinator_name || s.venue_contact) && (
                    <div className="space-y-1">
                      <p className="text-[20px] font-semibold text-gray-500">ผู้ติดต่อ</p>
                      {customer && (
                        <p className="text-[24px] leading-snug break-words">
                          ลูกค้า: {customer}
                          {s.customer.phone && <span className="tabular-nums"> · {formatPhone(s.customer.phone)}</span>}
                        </p>
                      )}
                      {(s.coordinator_name || s.coordinator_phone) && (
                        <p className="text-[24px] leading-snug break-words">
                          ผู้ประสานงาน: {s.coordinator_name || '-'}
                          {s.coordinator_phone && <span className="tabular-nums"> · {formatPhone(s.coordinator_phone)}</span>}
                        </p>
                      )}
                      {s.venue_contact && <p className="text-[24px] leading-snug break-words">ติดต่อสถานที่: {s.venue_contact}</p>}
                    </div>
                  )}

                  <div className="space-y-2">
                    <p className="text-[20px] font-semibold text-gray-500">ทีมงาน ({s.crew.length.toLocaleString('th-TH')} คน)</p>
                    {s.crew.length === 0 ? (
                      <p className="text-[24px] font-semibold text-amber-800">ยังไม่ได้จัดทีมงาน</p>
                    ) : (
                      <div className="flex flex-wrap gap-3">
                        {s.crew.map(c => (
                          <span key={c.crew_id} className="inline-flex items-center gap-3 rounded-full border-2 border-gray-200 py-2 pl-4 pr-5 text-[24px]">
                            <span className="h-5 w-5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                            <span className="font-semibold">{crewShortName(c)}</span>
                            <span className="text-gray-500">{crewRoleLabel(c.role)}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {s.dress_code && (
                    <div className="space-y-1">
                      <p className="text-[20px] font-semibold text-gray-500">การแต่งกาย</p>
                      <p className="text-[24px] leading-snug whitespace-pre-line break-words">{s.dress_code}</p>
                    </div>
                  )}

                  {s.notes && (
                    <div className="space-y-1">
                      <p className="text-[20px] font-semibold text-gray-500">หมายเหตุ</p>
                      <p className="text-[24px] leading-snug whitespace-pre-line break-words">{s.notes}</p>
                    </div>
                  )}

                  {options.showRunSheet && s.run_sheet.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[20px] font-semibold text-gray-500">กำหนดการ</p>
                      <div className="overflow-hidden rounded-[16px] border-2 border-gray-150">
                        {s.run_sheet.map((r, i) => (
                          <div key={i} className={i > 0 ? 'flex gap-5 border-t-2 border-gray-150 px-5 py-3' : 'flex gap-5 px-5 py-3'}>
                            <span className="w-[110px] shrink-0 text-[24px] font-semibold tabular-nums">{r.time ? `${r.time} น.` : '-'}</span>
                            <span className="min-w-0 flex-1 text-[24px] leading-snug break-words">{r.text || '-'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {options.showMoney && s.money.grand_total > 0.005 && (
                    <div className="flex flex-wrap gap-x-8 gap-y-1 rounded-[16px] bg-gray-50 px-5 py-4 text-[24px] tabular-nums">
                      <span>ยอดสุทธิ <b>{baht(s.money.grand_total)}</b></span>
                      <span>ชำระแล้ว <b>{baht(s.money.paid)}</b></span>
                      <span className={s.money.due > 0.005 ? 'text-red-700' : 'text-green-800'}>
                        {s.money.due > 0.005 ? <>ค้างชำระ <b>{baht(s.money.due)}</b></> : <b>ชำระครบแล้ว</b>}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ===== ท้ายรูป ===== */}
      <div className="flex items-center justify-between gap-6 border-t-2 border-gray-150 px-14 pb-12 pt-6 text-[20px] text-gray-500">
        <span className="min-w-0 break-words">{contacts || shop.name}</span>
        <span className="shrink-0 tabular-nums">สร้างเมื่อ {formatThaiDateTime(createdAt)}</span>
      </div>
    </div>
  )
})

export default DayScheduleImage
