'use client'
// โลโก้ร้าน (หัวเอกสารการจอง/ใบเสร็จ/สัญญาจ้าง + หน้าลิงก์ติดตามงานของลูกค้า)
// บันทึกทันทีที่เลือกรูป (ไม่ต้องกดบันทึกแท็บ): ย่อรูป → อัปโหลดชื่อใหม่ → wed_save_settings({logo_path}) → ลบไฟล์เก่า
//   - บันทึกตั้งค่าไม่ผ่าน (ถูกปฏิเสธแน่นอน) → ลบไฟล์ที่เพิ่งอัปโหลดทิ้ง โลโก้เดิมยังใช้ได้
//   - ไม่รู้ผล (เน็ตหลุด) → อ่านตั้งค่าล่าสุดมาดูว่าชี้ไฟล์ใหม่แล้วหรือยัง (ใช่ = สำเร็จ) · ไม่ลบไฟล์ใดๆ ระหว่างไม่แน่ใจ
// ไม่มีโลโก้ = เอกสารใช้สัญลักษณ์ก้อนเมฆของร้าน (WeddingMark) แทน
import { useMemo, useRef, useState } from 'react'
import { AlertCircle, ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { ICON_SM } from '@/components/theme/icons'
import { createClient } from '@/lib/supabase/client'
import { parseWeddingSettings, weddingLogoUrl, type WedSettings } from '@/lib/wedding'
import WeddingMark from '@/components/theme/WeddingMark'
import ConfirmDialog from '@/components/integrations/ConfirmDialog'
import { callRpc, wedErrorText } from './wedRpc'
import { prepareLogo, removeLogoFiles, uploadLogoFile } from './logoImage'

export default function LogoUploader({
  settings,
  disabled,
  onSaved,
  onMessage,
}: {
  settings: WedSettings
  /** แท็บอื่นกำลังบันทึกอยู่ */
  disabled: boolean
  onSaved: (next: WedSettings) => void
  onMessage: (text: string) => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const inputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null)
  const [error, setError] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [broken, setBroken] = useState<string | null>(null)

  const url = weddingLogoUrl(settings)
  const showImg = url !== '' && broken !== url

  // ตั้งค่าล่าสุดจากฐานข้อมูล (ใช้ตอนไม่รู้ผล)
  async function fetchSettings(): Promise<WedSettings | null> {
    const res = await callRpc(supabase, 'wed_get_settings', {})
    return res.ok ? parseWeddingSettings(res.data) : null
  }

  async function saveLogoPath(path: string | null): Promise<{ ok: true; next: WedSettings } | { ok: false; message: string; definite: boolean }> {
    const res = await callRpc(supabase, 'wed_save_settings', { p_settings: { logo_path: path } })
    if (res.ok) return { ok: true, next: parseWeddingSettings(res.data) }
    if (res.answered) return { ok: false, message: wedErrorText(res.error), definite: true }
    const fresh = await fetchSettings()
    if (fresh && fresh.logo_path === path) return { ok: true, next: fresh }
    return {
      ok: false,
      message: 'ไม่แน่ใจว่าบันทึกโลโก้แล้วหรือยัง (เน็ตหลุด/เซิร์ฟเวอร์ตอบช้า) — โหลดหน้าใหม่เพื่อดูโลโก้ล่าสุด แล้วลองอีกครั้งถ้ายังไม่เปลี่ยน',
      definite: false,
    }
  }

  async function handleFile(file: File | null | undefined) {
    if (!file || busyRef.current) return
    busyRef.current = true
    setBusy('upload')
    setError('')
    const oldPath = settings.logo_path
    let newPath: string | null = null
    try {
      const img = await prepareLogo(file)
      newPath = await uploadLogoFile(supabase, img)
      const r = await saveLogoPath(newPath)
      if (!r.ok) {
        // ถูกปฏิเสธแน่นอน = ไฟล์ใหม่ไม่มีใครใช้ → ลบทิ้ง
        if (r.definite) void removeLogoFiles(supabase, [newPath])
        setError(r.message)
        return
      }
      onSaved(r.next)
      if (oldPath && oldPath !== r.next.logo_path) void removeLogoFiles(supabase, [oldPath])
      onMessage('บันทึกโลโก้ร้านแล้ว')
    } catch (err) {
      setError(err instanceof Error && /[฀-๿]/.test(err.message) ? err.message : wedErrorText(err))
    } finally {
      busyRef.current = false
      setBusy(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleRemove() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy('remove')
    setError('')
    const oldPath = settings.logo_path
    try {
      const r = await saveLogoPath(null)
      if (!r.ok) {
        setError(r.message)
        return
      }
      onSaved(r.next)
      setConfirmRemove(false)
      void removeLogoFiles(supabase, [oldPath])
      onMessage('ลบโลโก้แล้ว — เอกสารจะใช้สัญลักษณ์ของร้านแทน')
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  const locked = disabled || busy !== null

  return (
    <div className="space-y-2">
      <p className="field-label">โลโก้ร้าน</p>
      <div className="panel flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
        <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-lg border border-gray-200 bg-white">
          {busy === 'upload' ? (
            <Loader2 {...ICON_SM} className="animate-spin text-gray-500" />
          ) : showImg ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={`โลโก้ร้าน ${settings.shop_name}`}
              className="h-full w-full object-contain p-1"
              onError={() => setBroken(url)}
            />
          ) : (
            <WeddingMark size="lg" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm text-gray-700">
            {settings.logo_path
              ? showImg ? 'ใช้โลโก้นี้บนเอกสารการจอง ใบเสร็จ สัญญาจ้าง และลิงก์ติดตามงานของลูกค้า' : 'โหลดรูปโลโก้ไม่ได้ — ลองอัปโหลดใหม่'
              : 'ยังไม่มีโลโก้ — เอกสารใช้สัญลักษณ์ก้อนเมฆของร้านแทน'}
          </p>
          <p className="field-hint">รูป JPG / PNG / WEBP — ระบบย่อให้เอง (ขอบยาวสุด 800 px ไม่เกิน 2 MB) · พื้นโปร่งใสใช้ได้ · บันทึกทันทีที่เลือกรูป</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={locked}
              className="btn-secondary w-full sm:w-auto"
            >
              {busy === 'upload' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <ImagePlus {...ICON_SM} />}
              {busy === 'upload' ? 'กำลังอัปโหลด...' : settings.logo_path ? 'เปลี่ยนโลโก้' : 'อัปโหลดโลโก้'}
            </button>
            {settings.logo_path && (
              <button
                type="button"
                onClick={() => { setError(''); setConfirmRemove(true) }}
                disabled={locked}
                className="btn-danger-soft w-full sm:w-auto"
              >
                <Trash2 {...ICON_SM} />
                ลบโลโก้
              </button>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={e => void handleFile(e.target.files?.[0])}
          />
        </div>
      </div>
      <div aria-live="polite">
        {error && (
          <div role="alert" className="alert-err">
            <AlertCircle {...ICON_SM} />
            <p className="min-w-0 break-words">{error}</p>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title="ลบโลโก้ร้าน"
        confirmLabel="ลบโลโก้"
        tone="danger"
        busy={busy === 'remove'}
        onConfirm={() => void handleRemove()}
        onCancel={() => { if (!busyRef.current) setConfirmRemove(false) }}
      >
        <p>เอกสารที่สร้างหลังจากนี้และหน้าลิงก์ติดตามงานจะใช้สัญลักษณ์ก้อนเมฆของร้านแทนโลโก้ — รูปที่ส่งให้ลูกค้าไปแล้วไม่เปลี่ยน</p>
      </ConfirmDialog>
    </div>
  )
}
