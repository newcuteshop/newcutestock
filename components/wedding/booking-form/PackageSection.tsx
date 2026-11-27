'use client'
// ส่วน "แพ็กเกจ + งานที่ส่ง + บริการเสริม" ของฟอร์มงาน
// - แพ็กเกจจากรายการ (การ์ด) หรือ "กำหนดเอง" — งานเก็บชื่อ/ราคา/ชั่วโมง/รายละเอียด ณ ตอนเลือก (แก้แพ็กเกจทีหลังไม่กระทบงานเดิม)
//   เลือกจากรายการแล้ว "ปรับเฉพาะงานนี้" ได้ (เช่น ลดราคาแพ็กเกจให้คู่นี้) โดยไม่แตะแพ็กเกจในรายการ
// - งานที่ส่ง (รูป/วิดีโอ/คลิปสั้น + จำนวน + ส่งภายในกี่วันหลังวันงานสุดท้าย): ตั้งตามแพ็กเกจ แก้ได้จนกว่าจะยืนยันงาน
//   (ยืนยันแล้วระบบสร้างรายการส่งงานจากแผนนี้ — หลังจากนั้นแก้ที่หน้างาน)
// - บริการเสริม: เลือกจากรายการ หรือพิมพ์เอง ; ยอดต่อแถวจากฐานข้อมูล (wed_quote)
// 27/11/2569 กรอกเร็ว (ตามใบยืนยันการจองของร้าน: ชื่อ/ราคา/รายละเอียดแพ็กเกจ): หน้าแรกเหลือ เลือกแพ็กเกจ / กำหนดเอง (ชื่อ ราคา รายละเอียด)
//   + บริการเสริม ; จำนวนชั่วโมงถ่าย + งานที่ส่ง → กล่อง "ข้อมูลเพิ่มเติม (ไม่บังคับ)" (ข้อมูล/ตัวตรวจ/payload เหมือนเดิม)
//   งานที่ส่งที่ระบบเติมตามแพ็กเกจไม่เปิดกล่องเอง (ป้ายบอกจำนวนรายการ) — เปิดเองเมื่อแก้ไม่ตรงแพ็กเกจ / มีช่องผิด
import { useId } from 'react'
import clsx from 'clsx'
import { Clapperboard, Gift, Info, Package, Pencil, Plus, Trash2 } from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { baht } from '@/lib/format'
import {
  MAX_PACKAGE_DELIVERABLES, type WedAddon, type WedDeliverablePlanItem, type WedPackage, type WedQuote,
} from '@/lib/wedding'
import {
  MAX_ADDON_NAME, MAX_ADDON_UNIT, MAX_ADDONS, MAX_PKG_DESC, MAX_PKG_NAME, MAX_PLAN_NAME, MAX_PLAN_UNIT, checkMoney,
  planMatchesDefaults, visiblePackages, type AddonDraft, type CoreCheck, type PlanItemDraft, type WedDraft,
} from './model'
import { Field, FormSection, MoneyInput, MoreFields, SwitchRow, fieldAria } from './fields'

function hoursText(h: number): string {
  return h > 0 ? `${h.toLocaleString('th-TH', { maximumFractionDigits: 1 })} ชม.` : ''
}

export default function PackageSection({
  draft,
  patch,
  packages,
  addonCatalog,
  catalogError,
  check,
  planOpen,
  lockedPlan,
  quote,
  quoteFresh,
  originalPackage,
  reveal = 0,
  mk,
  disabled,
}: {
  draft: WedDraft
  patch: (p: Partial<WedDraft>) => void
  packages: readonly WedPackage[]
  addonCatalog: readonly WedAddon[]
  catalogError: string
  check: CoreCheck
  planOpen: boolean
  /** แผนงานที่ส่งของงานที่ยืนยันแล้ว (แสดงอย่างเดียว) */
  lockedPlan: readonly WedDeliverablePlanItem[]
  quote: WedQuote | null
  quoteFresh: boolean
  /** แก้ไข: แพ็กเกจเดิมของงาน (ชื่อ/ราคา ณ ตอนจอง) */
  originalPackage?: { id: string | null; name: string; price: number; hours: number } | null
  /** เลขที่เปลี่ยนเมื่อกดแถบลัด/กดบันทึกแล้วยังไม่ครบ → เปิดกล่องพับที่มีช่องผิด */
  reveal?: number
  mk: () => string
  disabled?: boolean
}) {
  const uid = useId()
  const list = visiblePackages(packages, draft.packageId)
  const selected = draft.packageMode === 'catalog' && draft.packageId ? packages.find(p => p.id === draft.packageId) ?? null : null
  const sameAsOriginal = !!originalPackage && !!originalPackage.id && originalPackage.id === draft.packageId
  const showFields = draft.packageMode === 'custom' || draft.pkgCustomize
  const activeAddons = addonCatalog.filter(a => a.is_active)

  // กล่องพับ "ข้อมูลเพิ่มเติม": จำนวนชั่วโมง (เฉพาะตอนกำหนดเอง/ปรับเฉพาะงานนี้) + งานที่ส่ง
  const planCount = planOpen ? draft.plan.length : lockedPlan.length
  const hoursSet = showFields && draft.pkgHours.trim() !== ''
  // ค่าที่ตรงกับแพ็กเกจที่เลือก = ระบบเติมให้ → ไม่ต้องเปิดกล่องเอง ; ไม่ตรง (แก้เอง / แพ็กเกจกำหนดเอง) = เปิด
  const planCustom = planOpen && draft.plan.length > 0 && !planMatchesDefaults(draft.plan, selected ? selected.deliverables : [])
  const hoursCustom = hoursSet && !(draft.packageMode === 'catalog' && selected && Number(draft.pkgHours.trim()) === selected.hours)
  // ป้าย "มีข้อมูล N ช่อง" นับเฉพาะที่ผู้ใช้กรอก/แก้เอง — งานที่ส่งที่ระบบเติมตามแพ็กเกจไม่นับ (ข้อความพับบอก "(ตามแพ็กเกจ)" อยู่แล้ว)
  // งานที่บันทึกแล้วที่แก้งานที่ส่งไม่ได้ (lockedPlan) = ข้อมูลของงานจริง นับ
  const extraFilled = (planCustom || (!planOpen && lockedPlan.length > 0) ? 1 : 0) + (hoursCustom ? 1 : 0)
  const extraProblem = !!check.pkg.hours || Object.keys(check.plan).length > 0
  const extraContents = [
    planCount > 0 ? `งานที่ส่งให้ลูกค้า ${planCount} รายการ${planOpen && !planCustom && selected ? ' (ตามแพ็กเกจ)' : ''}` : 'งานที่ส่งให้ลูกค้า',
    showFields ? 'จำนวนชั่วโมงถ่าย' : '',
  ].filter(Boolean).join(' · ')

  function pick(p: WedPackage) {
    // แตะการ์ดที่เลือกอยู่แล้วซ้ำ = ไม่ทำอะไร (ไม่ล้างงานที่ส่งที่แก้ไว้)
    if (draft.packageMode === 'catalog' && draft.packageId === p.id) return
    const next: Partial<WedDraft> = {
      packageMode: 'catalog',
      packageId: p.id,
      pkgCustomize: false,
      pkgName: p.name,
      pkgPrice: p.price > 0 ? String(p.price) : '',
      pkgHours: p.hours > 0 ? String(p.hours) : '',
      pkgDescription: p.description ?? '',
    }
    // แผนงานที่ส่งตั้งตามแพ็กเกจใหม่ (ยังแก้ได้เท่านั้น)
    if (planOpen) {
      next.plan = p.deliverables.map(d => ({ key: mk(), name: d.name, qty: String(d.qty), unit: d.unit, due_days: String(d.due_days) }))
    }
    // แก้ไขงาน: กลับมาเลือกแพ็กเกจเดิม → ใช้ชื่อ/ราคาที่งานจำไว้ (ไม่ใช่ราคาปัจจุบันในรายการ)
    if (originalPackage?.id && originalPackage.id === p.id) {
      next.pkgName = originalPackage?.name ?? p.name
      next.pkgPrice = originalPackage && originalPackage.price > 0 ? String(originalPackage.price) : ''
      next.pkgHours = originalPackage && originalPackage.hours > 0 ? String(originalPackage.hours) : ''
    }
    patch(next)
  }

  function setPlan(key: string, p: Partial<PlanItemDraft>) {
    patch({ plan: draft.plan.map(x => (x.key === key ? { ...x, ...p } : x)) })
  }

  function setAddon(key: string, p: Partial<AddonDraft>) {
    patch({ addons: draft.addons.map(x => (x.key === key ? { ...x, ...p } : x)) })
  }

  function addCatalogAddon(id: string) {
    const a = addonCatalog.find(x => x.id === id)
    if (!a || draft.addons.length >= MAX_ADDONS) return
    patch({
      addons: [...draft.addons, {
        key: mk(), id: null, addon_id: a.id, name: a.name, qty: '1', unit_price: String(a.price), unit: a.unit ?? '',
      }],
    })
  }

  function addFreeAddon() {
    if (draft.addons.length >= MAX_ADDONS) return
    patch({ addons: [...draft.addons, { key: mk(), id: null, addon_id: null, name: '', qty: '1', unit_price: '', unit: '' }] })
  }

  // ยอดต่อแถวของบริการเสริมจาก wed_quote (เรียงตามลำดับที่ส่ง)
  const addonAmount = (i: number): number | null => (quote && quoteFresh && quote.addons[i] ? quote.addons[i].amount : null)
  const shownPkg = quote && quoteFresh ? quote.package : null

  return (
    <FormSection
      section="package"
      title="แพ็กเกจและบริการเสริม"
      icon={<Package {...ICON} />}
    >
      {catalogError && (
        <p className="text-sm text-red-700" role="alert">{catalogError}</p>
      )}

      {/* ===== เลือกแพ็กเกจ ===== */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="เลือกแพ็กเกจ">
        {list.map(p => (
          <button
            key={p.id}
            type="button"
            className="choice items-start px-3 py-2.5 text-left"
            aria-pressed={draft.packageMode === 'catalog' && draft.packageId === p.id}
            disabled={disabled}
            onClick={() => pick(p)}
          >
            <span className="flex w-full items-start justify-between gap-2">
              <span className="min-w-0 font-semibold break-words">{p.name}</span>
              <span className="shrink-0 money">{baht(p.price)}</span>
            </span>
            <span className="text-xs font-normal text-gray-500">
              {[hoursText(p.hours), p.crew_size > 0 ? `ทีม ${p.crew_size} คน` : '', p.deliverables.length > 0 ? `งานที่ส่ง ${p.deliverables.length} รายการ` : '',
                !p.is_active ? 'ปิดใช้งานแล้ว' : ''].filter(Boolean).join(' · ') || 'ไม่มีรายละเอียด'}
            </span>
          </button>
        ))}
        {draft.packageMode === 'catalog' && draft.packageId && !selected && originalPackage && (
          <div className="panel px-3 py-2.5 text-sm">
            <p className="font-semibold text-gray-900 break-words">{originalPackage.name || 'แพ็กเกจเดิม'}</p>
            <p className="text-xs text-gray-500">แพ็กเกจเดิมของงานนี้ (ไม่อยู่ในรายการแล้ว) — ราคาตามที่จองไว้ {baht(originalPackage.price)}</p>
          </div>
        )}
        <button
          type="button"
          className="choice items-start px-3 py-2.5 text-left"
          aria-pressed={draft.packageMode === 'custom'}
          disabled={disabled}
          onClick={() => patch({ packageMode: 'custom', packageId: null, pkgCustomize: false })}
        >
          <span className="flex items-center gap-2 font-semibold"><Pencil {...ICON_SM} />กำหนดเอง</span>
          <span className="text-xs font-normal text-gray-500">ตั้งชื่อ/ราคาแพ็กเกจเฉพาะงานนี้ (หรือยังไม่มีแพ็กเกจ)</span>
        </button>
      </div>
      {list.length === 0 && !catalogError && (
        <p className="text-sm text-gray-500">ยังไม่มีแพ็กเกจในระบบ — ผู้จัดการเพิ่มได้ที่เมนูแพ็กเกจ หรือกด &quot;กำหนดเอง&quot;</p>
      )}

      {draft.packageMode === 'catalog' && draft.packageId && (
        <div className="panel p-3 space-y-2">
          {(selected?.description || shownPkg?.description) && !draft.pkgCustomize && (
            <p className="whitespace-pre-line text-sm text-gray-700 break-words">{shownPkg?.description ?? selected?.description}</p>
          )}
          {sameAsOriginal && !draft.pkgCustomize && originalPackage && selected && Math.abs(selected.price - originalPackage.price) > 0.005 && (
            <p className="flex items-start gap-1.5 text-xs text-gray-600">
              <Info size={14} strokeWidth={2} aria-hidden="true" className="mt-px shrink-0" />
              <span className="min-w-0">งานนี้ใช้ราคาตอนจอง {baht(originalPackage.price)} (ราคาในรายการตอนนี้ {baht(selected.price)})</span>
            </p>
          )}
          <SwitchRow
            checked={draft.pkgCustomize}
            onChange={v => patch({ pkgCustomize: v })}
            disabled={disabled}
            label="ปรับชื่อ/ราคา/รายละเอียดเฉพาะงานนี้"
            sub="ไม่แก้แพ็กเกจในรายการ"
          />
        </div>
      )}

      {showFields && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id={`${uid}-pname`} label="ชื่อแพ็กเกจ" error={check.pkg.name} className="sm:col-span-2">
            <input
              id={`${uid}-pname`}
              className="input"
              value={draft.pkgName}
              maxLength={MAX_PKG_NAME}
              placeholder="เช่น ถ่ายภาพ + วิดีโอ งานเช้า-เย็น"
              disabled={disabled}
              {...fieldAria(`${uid}-pname`, check.pkg.name)}
              onChange={e => patch({ pkgName: e.target.value })}
            />
          </Field>
          <Field id={`${uid}-pprice`} label="ราคาแพ็กเกจ (บาท)" error={check.pkg.price}>
            <MoneyInput id={`${uid}-pprice`} value={draft.pkgPrice} onChange={v => patch({ pkgPrice: v })} disabled={disabled} error={check.pkg.price} />
          </Field>
          <Field id={`${uid}-pdesc`} label="รายละเอียดแพ็กเกจ (แสดงบนเอกสาร)" error={check.pkg.description} className="sm:col-span-2">
            <textarea
              id={`${uid}-pdesc`}
              className="input"
              rows={3}
              value={draft.pkgDescription}
              maxLength={MAX_PKG_DESC}
              disabled={disabled}
              {...fieldAria(`${uid}-pdesc`, check.pkg.description)}
              onChange={e => patch({ pkgDescription: e.target.value })}
            />
          </Field>
        </div>
      )}

      <hr className="divider !my-0" />

      {/* ===== บริการเสริม ===== */}
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Gift {...ICON_SM} className="text-brand-600" />
          บริการเสริม
          {draft.addons.length > 0 && <span className="chip h-5 px-1.5 tabular-nums">{draft.addons.length}</span>}
        </p>
        {draft.addons.length > 0 && (
          <ul className="space-y-2">
            {draft.addons.map((a, i) => {
              const e = check.addons[a.key]
              const base = `${uid}-ad${i}`
              const amt = addonAmount(i)
              const q = Number(a.qty)
              const pr = checkMoney(a.unit_price, '').value
              const local = Number.isFinite(q) && q > 0 ? Math.round(q * pr * 100) / 100 : 0
              return (
                <li key={a.key} className="panel p-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <label htmlFor={`${base}-n`} className="sr-only">ชื่อบริการเสริม {i + 1}</label>
                    <input
                      id={`${base}-n`}
                      className="input min-w-0 flex-1"
                      value={a.name}
                      maxLength={MAX_ADDON_NAME}
                      placeholder="เช่น โดรน / ช่างภาพเพิ่ม 1 คน / อัลบั้ม"
                      disabled={disabled}
                      aria-invalid={e ? true : undefined}
                      aria-describedby={e ? `${base}-err` : undefined}
                      onChange={ev => setAddon(a.key, { name: ev.target.value })}
                    />
                    <button
                      type="button"
                      className="btn-icon btn-icon-plain shrink-0"
                      onClick={() => patch({ addons: draft.addons.filter(x => x.key !== a.key) })}
                      disabled={disabled}
                      aria-label={`ลบบริการเสริมรายการที่ ${i + 1}`}
                    >
                      <Trash2 {...ICON_SM} />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="min-w-0">
                      <label htmlFor={`${base}-q`} className="text-xs text-gray-600">จำนวน{a.unit ? ` (${a.unit})` : ''}</label>
                      <input
                        id={`${base}-q`}
                        type="text"
                        inputMode="decimal"
                        className="input text-right tabular-nums"
                        value={a.qty}
                        maxLength={7}
                        disabled={disabled}
                        onChange={ev => setAddon(a.key, { qty: ev.target.value })}
                      />
                    </div>
                    <div className="min-w-0">
                      <label htmlFor={`${base}-p`} className="text-xs text-gray-600">ราคา/หน่วย</label>
                      <MoneyInput id={`${base}-p`} value={a.unit_price} onChange={v => setAddon(a.key, { unit_price: v })} disabled={disabled} />
                    </div>
                    <div className="min-w-0 text-right">
                      <p className="text-xs text-gray-600">รวม</p>
                      <p className={clsx('flex min-h-[44px] items-center justify-end money', amt === null && 'text-gray-500')}>
                        {baht(amt ?? local)}
                      </p>
                    </div>
                  </div>
                  {!a.addon_id && (
                    <div className="max-w-[12rem]">
                      <label htmlFor={`${base}-u`} className="text-xs text-gray-600">หน่วย (ถ้ามี)</label>
                      <input
                        id={`${base}-u`}
                        className="input"
                        value={a.unit}
                        maxLength={MAX_ADDON_UNIT}
                        placeholder="ชั่วโมง/ชุด/เล่ม"
                        disabled={disabled}
                        onChange={ev => setAddon(a.key, { unit: ev.target.value })}
                      />
                    </div>
                  )}
                  {e && <p id={`${base}-err`} role="alert" className="text-sm font-medium text-red-700">{e}</p>}
                </li>
              )
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {activeAddons.length > 0 && (
            <div className="min-w-0 flex-1 basis-56">
              <label htmlFor={`${uid}-addsel`} className="sr-only">เพิ่มบริการเสริมจากรายการ</label>
              <select
                id={`${uid}-addsel`}
                className="input"
                value=""
                disabled={disabled || draft.addons.length >= MAX_ADDONS}
                onChange={e => addCatalogAddon(e.target.value)}
              >
                <option value="">+ เพิ่มจากรายการบริการเสริม</option>
                {activeAddons.map(a => (
                  <option key={a.id} value={a.id}>{a.name} · {baht(a.price)}{a.unit ? ` / ${a.unit}` : ''}</option>
                ))}
              </select>
            </div>
          )}
          <button type="button" className="btn-dashed px-3 text-sm" onClick={addFreeAddon} disabled={disabled || draft.addons.length >= MAX_ADDONS}>
            <Plus {...ICON_SM} />
            พิมพ์รายการเอง
          </button>
        </div>
      </div>

      {/* ===== ข้อมูลเพิ่มเติม (พับไว้): จำนวนชั่วโมง + งานที่ส่ง ===== */}
      <MoreFields
        contents={extraContents}
        filled={extraFilled}
        initialOpen={planCustom || hoursCustom}
        problem={extraProblem}
        signal={reveal}
      >
        {showFields && (
          <Field id={`${uid}-phours`} label="จำนวนชั่วโมงถ่าย" error={check.pkg.hours} hint="ไม่บังคับ ทศนิยม 1 ตำแหน่ง" className="max-w-xs">
            <input
              id={`${uid}-phours`}
              type="text"
              inputMode="decimal"
              className="input text-right tabular-nums"
              value={draft.pkgHours}
              maxLength={6}
              placeholder="0"
              disabled={disabled}
              {...fieldAria(`${uid}-phours`, check.pkg.hours, true)}
              onChange={e => patch({ pkgHours: e.target.value })}
            />
          </Field>
        )}

        {/* ===== งานที่ส่ง ===== */}
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Clapperboard {...ICON_SM} className="text-brand-600" />
            งานที่ส่งให้ลูกค้า
            {(planOpen ? draft.plan.length : lockedPlan.length) > 0 && (
              <span className="chip h-5 px-1.5 tabular-nums">{planOpen ? draft.plan.length : lockedPlan.length}</span>
            )}
          </p>
          {planOpen ? (
            <>
              <p className="text-xs text-gray-500">
                ตั้งตามแพ็กเกจ แก้ได้ — ยืนยันงานแล้วระบบสร้างรายการส่งงาน (กำหนดส่ง = วันงานสุดท้าย + จำนวนวัน)
              </p>
              {draft.plan.length > 0 && (
                <ul className="space-y-2">
                  {draft.plan.map((p, i) => {
                    const e = check.plan[p.key]
                    const base = `${uid}-pl${i}`
                    return (
                      <li key={p.key} className="panel p-2.5 space-y-2">
                        <div className="flex items-center gap-2">
                          <label htmlFor={`${base}-n`} className="sr-only">ชื่องานที่ส่ง {i + 1}</label>
                          <input
                            id={`${base}-n`}
                            className="input min-w-0 flex-1"
                            value={p.name}
                            maxLength={MAX_PLAN_NAME}
                            placeholder="เช่น ภาพถ่ายตกแต่ง / วิดีโอไฮไลต์ / คลิปสั้น"
                            disabled={disabled}
                            aria-invalid={e ? true : undefined}
                            aria-describedby={e ? `${base}-err` : undefined}
                            onChange={ev => setPlan(p.key, { name: ev.target.value })}
                          />
                          <button
                            type="button"
                            className="btn-icon btn-icon-plain shrink-0"
                            onClick={() => patch({ plan: draft.plan.filter(x => x.key !== p.key) })}
                            disabled={disabled}
                            aria-label={`ลบงานที่ส่งรายการที่ ${i + 1}`}
                          >
                            <Trash2 {...ICON_SM} />
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="min-w-0">
                            <label htmlFor={`${base}-q`} className="text-xs text-gray-600">จำนวน</label>
                            <input
                              id={`${base}-q`}
                              type="text"
                              inputMode="numeric"
                              className="input text-right tabular-nums"
                              value={p.qty}
                              maxLength={6}
                              disabled={disabled}
                              onChange={ev => setPlan(p.key, { qty: ev.target.value })}
                            />
                          </div>
                          <div className="min-w-0">
                            <label htmlFor={`${base}-u`} className="text-xs text-gray-600">หน่วย</label>
                            <input
                              id={`${base}-u`}
                              className="input"
                              value={p.unit}
                              maxLength={MAX_PLAN_UNIT}
                              placeholder="ภาพ/คลิป"
                              disabled={disabled}
                              onChange={ev => setPlan(p.key, { unit: ev.target.value })}
                            />
                          </div>
                          <div className="min-w-0">
                            <label htmlFor={`${base}-d`} className="text-xs text-gray-600">ส่งภายใน (วัน)</label>
                            <input
                              id={`${base}-d`}
                              type="text"
                              inputMode="numeric"
                              className="input text-right tabular-nums"
                              value={p.due_days}
                              maxLength={3}
                              placeholder="30"
                              disabled={disabled}
                              onChange={ev => setPlan(p.key, { due_days: ev.target.value })}
                            />
                          </div>
                        </div>
                        {e && <p id={`${base}-err`} role="alert" className="text-sm font-medium text-red-700">{e}</p>}
                      </li>
                    )
                  })}
                </ul>
              )}
              <button
                type="button"
                className="btn-dashed px-3 text-sm"
                disabled={disabled || draft.plan.length >= MAX_PACKAGE_DELIVERABLES}
                onClick={() => patch({ plan: [...draft.plan, { key: mk(), name: '', qty: '1', unit: '', due_days: '30' }] })}
              >
                <Plus {...ICON_SM} />
                เพิ่มงานที่ส่ง
              </button>
            </>
          ) : lockedPlan.length > 0 ? (
            <>
              <ul className="panel divide-y divide-gray-200 px-3 text-sm">
                {lockedPlan.map((p, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 break-words">{p.name}</span>
                    <span className="shrink-0 text-xs text-gray-500 tabular-nums">{p.qty} {p.unit} · {p.due_days} วัน</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-gray-500">ยืนยันงานแล้ว — แก้ชื่อ/กำหนดส่ง/ลิงก์ของงานที่ส่งได้ที่หน้างาน (รายการส่งงาน)</p>
            </>
          ) : (
            <p className="text-xs text-gray-500">ยืนยันงานแล้ว — จัดการรายการส่งงานได้ที่หน้างาน</p>
          )}
        </div>
      </MoreFields>
    </FormSection>
  )
}
