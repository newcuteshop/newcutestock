'use client'
// การ์ดรายการส่งงาน 1 ชิ้นบนกระดาน: ชื่องาน · คู่บ่าวสาว + เลขที่งาน · กำหนดส่ง (เลยกำหนดเป็นสีแดง) · ผู้ตัดต่อ · ลิงก์ส่งงาน
// ปุ่ม: ขั้นถัดไป (รอตัด → กำลังตัด → รอตรวจ → ส่งแล้ว) · เลือกสถานะเอง (ย้อนขั้นได้) · แก้ไขทั้งหมด
// การ์ดไม่เขียนข้อมูลเอง — ส่งเหตุการณ์ให้กระดาน (DeliverablesBoardClient) ซึ่งกันกดซ้ำและจัดการผลลัพธ์
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { AlertTriangle, ArrowRight, Check, Copy, ExternalLink, Loader2, Pencil, UserRound } from 'lucide-react'
import { ICON_XS } from '@/components/theme/icons'
import { formatThaiDate } from '@/lib/format'
import {
  DELIVERABLE_STATUS_CHIP, DELIVERABLE_STATUS_LABELS, WED_DELIVERABLE_STATUSES, WED_STATUS_CHIP,
  type WedDeliverableBoardItem, type WedDeliverableStatus,
} from '@/lib/wedding'
import { fmtCount, wedBookingHref } from '@/components/wedding/money/wedRpc'
import { NEXT_STEP, daysLate, daysLeft } from './boardModel'

function DueText({ item, today }: { item: WedDeliverableBoardItem; today: string }) {
  if (!item.due_date) return <span className="text-gray-500">ไม่กำหนดวันส่ง</span>
  if (item.status === 'delivered') {
    return <span className="text-gray-600">กำหนด {formatThaiDate(item.due_date)}</span>
  }
  const late = daysLate(item, today)
  if (late > 0) {
    return (
      <span className="inline-flex items-start gap-1 font-medium text-red-700">
        <AlertTriangle size={14} strokeWidth={1.9} aria-hidden="true" className="mt-px shrink-0" />
        <span className="min-w-0">กำหนด {formatThaiDate(item.due_date)} · เลยมา {fmtCount(late)} วัน</span>
      </span>
    )
  }
  const left = daysLeft(item, today)
  return (
    <span className={clsx(left !== null && left <= 3 ? 'font-medium text-amber-800' : 'text-gray-600')}>
      กำหนด {formatThaiDate(item.due_date)}
      {left === 0 ? ' · วันนี้' : left !== null ? ` · อีก ${fmtCount(left)} วัน` : ''}
    </span>
  )
}

export default function DeliverableCard({
  item,
  today,
  editorColor,
  busy,
  disabled,
  onMove,
  onEdit,
}: {
  item: WedDeliverableBoardItem
  today: string
  /** สีประจำตัวผู้ตัดต่อ (จาก wed_list_crew) ; ไม่รู้ = ไม่แสดงจุดสี */
  editorColor: string | null
  /** การ์ดนี้กำลังบันทึก */
  busy: boolean
  /** กระดานกำลังบันทึกรายการอื่น/โหลดใหม่ — ปิดปุ่มชั่วคราว */
  disabled: boolean
  onMove(to: WedDeliverableStatus): void
  onEdit(): void
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  const next = NEXT_STEP[item.status]
  const late = daysLate(item, today) > 0
  const off = busy || disabled
  const title = `${item.name}${item.qty > 1 || item.unit ? ` ${fmtCount(item.qty)}${item.unit ? ` ${item.unit}` : ''}` : ''}`

  async function copyLink() {
    if (!item.link_url) return
    try {
      await navigator.clipboard.writeText(item.link_url)
      setCopied(true)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <article
      className={clsx('card min-w-0 space-y-2.5 p-3 sm:p-4', late && 'border-red-200')}
      aria-label={`${title} — ${item.couple_names}`}
      aria-busy={busy}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 text-sm font-semibold text-gray-900 break-words">{title}</h3>
        <span className={clsx(DELIVERABLE_STATUS_CHIP[item.status], 'shrink-0')}>{DELIVERABLE_STATUS_LABELS[item.status]}</span>
      </div>

      <div className="space-y-1 text-xs">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="text-sm text-gray-800 break-words">{item.couple_names || '-'}</span>
          {item.booking_status !== 'confirmed' && item.booking_status !== 'in_production' && (
            <span className={WED_STATUS_CHIP[item.booking_status]}>{item.booking_status_label}</span>
          )}
        </p>
        <Link
          href={wedBookingHref(item.booking_id)}
          prefetch={false}
          className="-my-1.5 inline-flex min-h-[44px] items-center font-mono text-brand-700 underline-offset-4 [@media(hover:hover)]:hover:underline"
        >
          {item.booking_no || 'เปิดงาน'}
        </Link>
        <p className="tabular-nums"><DueText item={item} today={today} /></p>
        <p className="flex items-center gap-1.5 text-gray-600">
          {item.editor_crew_id && editorColor ? (
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: editorColor }} aria-hidden="true" />
          ) : (
            <UserRound size={14} strokeWidth={1.9} aria-hidden="true" className="shrink-0" />
          )}
          <span className="min-w-0 break-words">
            {item.editor_crew_id ? `ผู้ตัดต่อ: ${item.editor_name || '-'}` : 'ยังไม่มอบหมายผู้ตัดต่อ'}
          </span>
        </p>
        {item.note && <p className="text-gray-600 break-words whitespace-pre-line">หมายเหตุ: {item.note}</p>}
      </div>

      {item.link_url && (
        <div className="flex flex-wrap items-center gap-1">
          <a
            href={item.link_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost px-2.5 text-xs"
          >
            <ExternalLink {...ICON_XS} />
            เปิดลิงก์ส่งงาน
          </a>
          <button type="button" onClick={() => void copyLink()} className="btn-ghost px-2.5 text-xs" aria-label="คัดลอกลิงก์ส่งงาน">
            {copied ? <Check {...ICON_XS} /> : <Copy {...ICON_XS} />}
            <span aria-live="polite">{copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}</span>
          </button>
        </div>
      )}

      {/* แถวปุ่ม: การ์ดกว้างพอ (มือถือเต็มจอ) = แถวเดียว · การ์ดแคบ (กระดานหลายคอลัมน์) = ปุ่มขั้นถัดไปเต็มแถว
          แล้วช่องสถานะ + ปุ่มแก้ไขขึ้นแถวใหม่ (ไม่บีบปุ่มจนเหลือ "ส..." อ่านไม่ออก) */}
      <div className="flex flex-wrap items-center gap-2 border-t border-gray-150 pt-2.5">
        {next ? (
          <button
            type="button"
            onClick={() => onMove(next.to)}
            disabled={off}
            className="btn-soft min-w-0 flex-[2_1_7.5rem] px-3 text-sm"
          >
            {busy ? <Loader2 {...ICON_XS} className="animate-spin" /> : <ArrowRight {...ICON_XS} />}
            <span className="truncate">{busy ? 'กำลังบันทึก...' : next.label}</span>
          </button>
        ) : (
          <span className="min-w-0 flex-[2_1_7.5rem] text-xs text-gray-500">
            {busy ? 'กำลังบันทึก...' : 'ส่งงานแล้ว'}
          </span>
        )}
        <label className="sr-only" htmlFor={`deliv-status-${item.id}`}>เปลี่ยนสถานะ {item.name}</label>
        <select
          id={`deliv-status-${item.id}`}
          className="input min-w-0 flex-[1_1_7.5rem] !pl-3"
          value={item.status}
          disabled={off}
          onChange={e => {
            const to = e.target.value as WedDeliverableStatus
            if (to !== item.status) onMove(to)
          }}
        >
          {WED_DELIVERABLE_STATUSES.map(s => (
            <option key={s} value={s}>{DELIVERABLE_STATUS_LABELS[s]}</option>
          ))}
        </select>
        <button type="button" onClick={onEdit} disabled={off} className="btn-icon shrink-0" aria-label={`แก้ไข ${item.name}`}>
          <Pencil {...ICON_XS} />
        </button>
      </div>
    </article>
  )
}
