'use client'
// ตัวอย่าง QR พร้อมเพย์จากค่าที่กำลังกรอก (ยังไม่ต้องบันทึก) — ให้บอสลองสแกนด้วยแอปธนาคารว่าเงินเข้าบัญชีถูกคน
// QR ตัวอย่างไม่ระบุยอด ; ลูกค้าได้ QR ที่ล็อกยอด "ที่ต้องจ่ายตอนนี้" บนใบแจ้งชำระเงินและลิงก์ติดตามงานเอง
// รูปแบบเดียวกับหน้าตั้งค่าร้านเช่า (components/rental/settings/PromptPayPreview) แต่ข้อความของร้าน b.oncloud
import { QrCode } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { formatPromptPayId, promptPayPayload } from '@/lib/promptpay'
import QrImage from '@/components/rental/QrImage'
import { clean, promptPayDigits } from './settingsForm'

export default function PromptPayPreview({ promptpayId, promptpayName }: { promptpayId: string; promptpayName: string }) {
  const digits = promptPayDigits(promptpayId)
  const payload = digits ? promptPayPayload(digits) : ''
  const name = clean(promptpayName)

  if (clean(promptpayId) === null) {
    return (
      <div className="panel flex items-start gap-2 p-3 text-sm text-gray-600">
        <QrCode {...ICON_SM} className="mt-0.5 shrink-0 text-gray-400" />
        <p className="min-w-0">ใส่เบอร์มือถือหรือเลขผู้เสียภาษีที่ผูกพร้อมเพย์ไว้ แล้วจะเห็นตัวอย่าง QR ตรงนี้</p>
      </div>
    )
  }
  if (!payload || !digits) {
    return (
      <div className="panel flex items-start gap-2 p-3 text-sm text-gray-600">
        <QrCode {...ICON_SM} className="mt-0.5 shrink-0 text-gray-400" />
        <p className="min-w-0">รหัสพร้อมเพย์ยังไม่ครบ — มือถือ 10 หลัก (ขึ้นต้น 0) หรือเลขผู้เสียภาษี 13 หลัก</p>
      </div>
    )
  }
  return (
    <div className="panel flex flex-col items-center gap-3 p-3 sm:flex-row sm:items-start">
      <QrImage text={payload} size={150} label="ตัวอย่าง QR (ไม่ระบุยอด)" />
      <div className="min-w-0 space-y-1 text-sm">
        <p className="font-semibold text-gray-900">พร้อมเพย์ <span className="tabular-nums">{formatPromptPayId(digits)}</span></p>
        {name && <p className="text-gray-700 break-words">ชื่อบัญชี {name}</p>}
        <p className="text-xs text-gray-500">
          ลองสแกนด้วยแอปธนาคาร ต้องขึ้นชื่อบัญชีของร้านถูกต้อง — บนใบแจ้งชำระเงินและลิงก์ติดตามงาน
          ลูกค้าจะได้ QR ที่ระบุยอดที่ต้องจ่ายตอนนั้นให้อัตโนมัติ
        </p>
      </div>
    </div>
  )
}
