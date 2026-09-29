'use client'
// ฟอร์มคีย์ของช่องทาง — ความลับเป็นช่องเขียนอย่างเดียว (password) โชว์แค่คำใบ้ที่บันทึกไว้ '•••• 1a2b'
// เว้นว่าง = ใช้ค่าเดิม ; ค่าที่พิมพ์ไม่เคยถูกส่งกลับมาที่หน้าเว็บอีก (เซิร์ฟเวอร์เข้ารหัสแล้วเก็บ)
import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { Eye, EyeOff, KeyRound, Loader2, LogIn, Save, ShieldCheck } from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { formatThaiDateTime } from '@/lib/format'
import { CHANNEL_STATUS_LABELS, PLATFORM_META, type CredentialField } from '@/lib/integrations/platforms'
import type { ChannelJson } from '@/lib/integrations/types'
import {
  connectOAuthUrl, saveCredentials, testConnection,
} from '@/app/(dashboard)/settings/integrations/actions'
import { FlashMessage, type Flash } from './bits'
import { callAction, useRunner } from './useAction'
import { safeAuthUrl } from './authUrl'

function testable(channel: ChannelJson, savedAll: boolean): { ok: boolean; why: string } {
  const meta = PLATFORM_META[channel.platform]
  if (meta.authKind === 'none') return { ok: false, why: '' }
  if (!savedAll) return { ok: false, why: 'บันทึกคีย์ที่บังคับให้ครบก่อน' }
  if (meta.authKind === 'oauth' && !['connected', 'error', 'paused'].includes(channel.status)) {
    return { ok: false, why: 'กด "เชื่อมต่อด้วยบัญชีร้าน" ก่อน แล้วจึงทดสอบได้' }
  }
  return { ok: true, why: '' }
}

export default function CredentialsForm({ channel, encKeyOk }: { channel: ChannelJson; encKeyOk: boolean }) {
  const router = useRouter()
  const meta = PLATFORM_META[channel.platform]
  const fields = meta.credentialFields
  const formId = useId()
  const { busy, run } = useRunner()
  const [values, setValues] = useState<Record<string, string>>({})
  const [show, setShow] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [flash, setFlash] = useState<Flash | null>(null)

  const hintOf = (name: string) => channel.credentials.find(c => c.name === name) ?? null
  const savedAll = fields.filter(f => f.required).every(f => hintOf(f.name) !== null)
  const typedAny = fields.some(f => (values[f.name] ?? '').trim() !== '')
  const test = testable(channel, savedAll)
  const oauthReady = meta.authKind === 'oauth' && savedAll && encKeyOk && channel.status !== 'paused'

  function validate(): Record<string, string> | null {
    const errs: Record<string, string> = {}
    const out: Record<string, string> = {}
    for (const f of fields) {
      const v = (values[f.name] ?? '').trim()
      if (!v) {
        if (f.required && !hintOf(f.name)) errs[f.name] = `กรอก${f.label}`
        continue
      }
      if (f.pattern) {
        let re: RegExp | null = null
        try { re = new RegExp(f.pattern) } catch { re = null }
        if (re && !re.test(v)) { errs[f.name] = `${f.label} รูปแบบไม่ถูกต้อง — ตรวจว่าคัดลอกมาครบ ไม่มีช่องว่าง`; continue }
      }
      out[f.name] = v
    }
    setErrors(errs)
    if (Object.keys(errs).length > 0) return null
    return out
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    setFlash(null)
    const out = validate()
    if (!out) return
    if (Object.keys(out).length === 0) { setFlash({ ok: false, text: 'ยังไม่ได้กรอกคีย์ใหม่ (เว้นว่าง = ใช้ค่าเดิม)' }); return }
    await run('save', async () => {
      const res = await callAction(() => saveCredentials(channel.id, out))
      if (!res.ok) { setFlash({ ok: false, text: res.error }); return }
      setValues({})
      setShow({})
      setFlash({
        ok: true,
        text: meta.authKind === 'oauth'
          ? 'บันทึกคีย์แล้ว — กด "เชื่อมต่อด้วยบัญชีร้าน" ต่อได้เลย'
          : 'บันทึกคีย์แล้ว — กด "ทดสอบการเชื่อมต่อ" เพื่อตรวจว่าคีย์ใช้ได้',
      })
      router.refresh()
    })
  }

  async function onTest() {
    setFlash(null)
    await run('test', async () => {
      const res = await callAction(() => testConnection(channel.id))
      if (!res.ok) { setFlash({ ok: false, text: res.error }); router.refresh(); return }
      // testOk = ผลทดสอบจริง (สถานะอาจยังไม่เปลี่ยน เช่น หยุดชั่วคราวอยู่ หรือ marketplace ที่ต้องเชื่อมร้านก่อน)
      const good = 'testOk' in res && typeof res.testOk === 'boolean' ? res.testOk : res.status === 'connected'
      const shop = res.shopName ? ` · ร้าน ${res.shopName}` : ''
      setFlash({
        ok: good,
        text: `${res.message || (good ? 'เชื่อมต่อได้' : 'เชื่อมต่อไม่ได้')}${shop} (สถานะ: ${CHANNEL_STATUS_LABELS[res.status] ?? res.status})`,
      })
      router.refresh()
    })
  }

  async function onConnect() {
    setFlash(null)
    await run('oauth', async () => {
      const res = await callAction(() => connectOAuthUrl(channel.id))
      if (!res.ok) { setFlash({ ok: false, text: res.error }); return }
      const url = safeAuthUrl(res.url)
      if (!url) { setFlash({ ok: false, text: 'ลิงก์เชื่อมต่อร้านไม่ถูกต้อง กรุณาลองใหม่' }); return }
      window.location.assign(url)
      // ค้างสถานะกำลังโหลดไว้จนเบราว์เซอร์เปลี่ยนหน้า
      await new Promise(resolve => setTimeout(resolve, 8000))
    })
  }

  if (fields.length === 0) return null

  return (
    <section className="card p-4 sm:p-5 space-y-4" aria-labelledby={`${formId}-title`}>
      <h2 id={`${formId}-title`} className="section-title">
        <KeyRound {...ICON} className="text-brand-600" />
        คีย์การเชื่อมต่อ
      </h2>

      {!encKeyOk && (
        <div role="alert" className="alert-err">
          <ShieldCheck size={18} strokeWidth={1.9} aria-hidden="true" />
          <p className="min-w-0">ยังไม่ได้ตั้งค่า INTEGRATIONS_ENC_KEY บน Vercel — บันทึกคีย์ไม่ได้จนกว่าจะตั้งค่าและ Redeploy</p>
        </div>
      )}

      {meta.phase === 'auth_only' && (
        <div className="alert-info">
          <ShieldCheck size={18} strokeWidth={1.9} aria-hidden="true" />
          <p className="min-w-0">
            รอบนี้ {meta.label}: เชื่อมร้านและต่ออายุ token ได้ แต่ยังไม่ส่งสต๊อก/ดึงออเดอร์อัตโนมัติ (รออนุมัติ API)
            — ระหว่างนี้ใช้ ส่งออก CSV สต๊อก / นำเข้า CSV ออเดอร์ ด้านล่างไปก่อน
          </p>
        </div>
      )}

      <form id={formId} onSubmit={onSave} className="space-y-4" autoComplete="off" noValidate>
        {fields.map(f => (
          <CredentialInput
            key={f.name}
            field={f}
            hint={hintOf(f.name)}
            value={values[f.name] ?? ''}
            shown={!!show[f.name]}
            error={errors[f.name]}
            disabled={!encKeyOk || busy !== null}
            onChange={v => {
              setValues(prev => ({ ...prev, [f.name]: v }))
              if (errors[f.name]) setErrors(prev => { const n = { ...prev }; delete n[f.name]; return n })
            }}
            onToggleShow={() => setShow(prev => ({ ...prev, [f.name]: !prev[f.name] }))}
          />
        ))}

        <FlashMessage flash={flash} />

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="submit"
            disabled={!encKeyOk || busy !== null || !typedAny}
            className={clsx(meta.authKind === 'oauth' && savedAll ? 'btn-secondary' : 'btn-primary', 'w-full sm:w-auto px-5')}
          >
            {busy === 'save' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Save {...ICON_SM} />}
            บันทึกคีย์
          </button>

          {meta.authKind === 'oauth' && (
            <button
              type="button"
              onClick={onConnect}
              disabled={!oauthReady || busy !== null}
              className={clsx(savedAll ? 'btn-primary' : 'btn-secondary', 'w-full sm:w-auto px-5')}
            >
              {busy === 'oauth' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <LogIn {...ICON_SM} />}
              {channel.status === 'connected' || channel.status === 'error' ? 'เชื่อมต่อด้วยบัญชีร้านอีกครั้ง' : 'เชื่อมต่อด้วยบัญชีร้าน'}
            </button>
          )}

          {meta.authKind !== 'none' && (
            <button
              type="button"
              onClick={onTest}
              disabled={!test.ok || busy !== null}
              className="btn-secondary w-full sm:w-auto px-5"
            >
              {busy === 'test' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <ShieldCheck {...ICON_SM} />}
              ทดสอบการเชื่อมต่อ
            </button>
          )}
        </div>
        {meta.authKind === 'oauth' && !savedAll && (
          <p className="text-xs text-gray-500">ปุ่ม &quot;เชื่อมต่อด้วยบัญชีร้าน&quot; ใช้ได้หลังบันทึกคีย์ของแอปครบ</p>
        )}
        {meta.authKind === 'oauth' && channel.status === 'paused' && (
          <p className="text-xs text-gray-500">ช่องทางนี้หยุดชั่วคราวอยู่ — กด &quot;ทำงานต่อ&quot; ด้านล่างก่อนเชื่อมต่อร้าน</p>
        )}
        {!test.ok && test.why && meta.authKind !== 'oauth' && (
          <p className="text-xs text-gray-500">{test.why}</p>
        )}
      </form>
    </section>
  )
}

function CredentialInput({
  field, hint, value, shown, error, disabled, onChange, onToggleShow,
}: {
  field: CredentialField
  hint: { hint: string | null; updated_at: string } | null
  value: string
  shown: boolean
  error?: string
  disabled: boolean
  onChange: (v: string) => void
  onToggleShow: () => void
}) {
  const id = useId()
  const helpId = `${id}-help`
  // ค่าที่บันทึกไว้แสดงเป็นคำใบ้เท่านั้น (ความลับ = 4 ตัวท้าย) — ช่องว่างเสมอ พิมพ์ใหม่ = แทนค่าเดิม
  const stored = hint
    ? `ตั้งค่าแล้ว${hint.hint ? ` ${hint.hint}` : ''} · แก้ไขล่าสุด ${formatThaiDateTime(hint.updated_at)} · เว้นว่าง = ใช้ค่าเดิม`
    : ''
  const placeholder = hint
    ? (field.secret ? `ตั้งค่าแล้ว ${hint.hint ?? '••••'}` : `${hint.hint ?? ''}`)
    : field.placeholder ?? (field.required ? 'ยังไม่ได้ตั้งค่า' : 'ไม่บังคับ')

  return (
    <div>
      <label htmlFor={id} className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-gray-700 mb-1">
        {field.label}
        {field.required && !hint && <span className="text-xs font-semibold text-red-700">จำเป็น</span>}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          name={`cred_${field.name}`}
          type={field.secret && !shown ? 'password' : 'text'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={field.secret ? 'new-password' : 'off'}
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode={field.pattern?.startsWith('^[0-9]') ? 'numeric' : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={helpId}
          className={clsx('input min-w-0 flex-1', value && 'font-mono')}
        />
        {field.secret && (
          <button
            type="button"
            onClick={onToggleShow}
            disabled={disabled || !value}
            aria-label={shown ? `ซ่อน${field.label}` : `แสดง${field.label}ที่พิมพ์`}
            className="btn-icon shrink-0"
          >
            {shown ? <EyeOff {...ICON_SM} /> : <Eye {...ICON_SM} />}
          </button>
        )}
      </div>
      <div id={helpId} className="mt-1 space-y-0.5">
        {error && <p className="text-xs font-medium text-red-700">{error}</p>}
        {stored && <p className="text-xs text-green-800 break-words">{stored}</p>}
        {field.help && <p className="text-xs text-gray-500 break-words">{field.help}</p>}
      </div>
    </div>
  )
}
