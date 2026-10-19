'use client'
// รายการบัญชีธนาคารที่แสดงให้ลูกค้าโอนเงิน (หน้าสถานะการจอง/ข้อความ LINE) — ไม่เกิน 5 บัญชี
// แถวที่ว่างทุกช่องไม่ถูกบันทึก · เรียงลำดับได้ (บัญชีแรก = บัญชีหลักที่ลูกค้าเห็นก่อน)
import { ArrowDown, ArrowUp, Landmark, Plus, Trash2 } from 'lucide-react'
import { ICON_SM, ICON_XS } from '@/components/theme/icons'
import { BANK_FIELD_MAX, bankErrorKey, MAX_BANK_ACCOUNTS, newBankKey, type BankRow } from './settingsForm'

// ธนาคารที่ใช้บ่อย (กดเติมชื่อได้ — พิมพ์เองก็ได้)
const COMMON_BANKS = ['กสิกรไทย', 'ไทยพาณิชย์', 'กรุงเทพ', 'กรุงไทย', 'กรุงศรีอยุธยา', 'ทหารไทยธนชาต (ttb)', 'ออมสิน']

export default function BankAccountsEditor({
  rows,
  onChange,
  errors,
  showErrors,
  disabled,
}: {
  rows: BankRow[]
  onChange: (rows: BankRow[]) => void
  errors: Record<string, string>
  showErrors: boolean
  disabled: boolean
}) {
  function update(index: number, patch: Partial<BankRow>) {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function remove(index: number) {
    onChange(rows.filter((_, i) => i !== index))
  }

  function move(index: number, delta: number) {
    const to = index + delta
    if (to < 0 || to >= rows.length) return
    const next = rows.slice()
    const [item] = next.splice(index, 1)
    next.splice(to, 0, item)
    onChange(next)
  }

  function add() {
    if (rows.length >= MAX_BANK_ACCOUNTS) return
    onChange([...rows, { key: newBankKey(), bank: '', account_no: '', account_name: '' }])
  }

  const err = (i: number, f: 'bank' | 'account_no' | 'account_name') => (showErrors ? errors[bankErrorKey(i, f)] : undefined)

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="panel p-3 text-sm text-gray-500">ยังไม่มีบัญชีธนาคาร — ลูกค้าจะเห็นเฉพาะพร้อมเพย์ (ถ้าตั้งไว้)</p>
      ) : (
        <ol className="space-y-3" aria-label="บัญชีธนาคาร">
          {rows.map((r, i) => {
            const idBase = `rs-bank-${r.key}`
            const listId = `${idBase}-banks`
            return (
              <li key={r.key} className="panel space-y-3 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-gray-900">
                    <Landmark {...ICON_XS} className="text-brand-600" />
                    <span className="whitespace-nowrap">บัญชีที่ {i + 1}</span>{i === 0 && <span className="chip whitespace-nowrap">บัญชีหลัก</span>}
                  </p>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={disabled || i === 0}
                      className="btn-icon btn-icon-plain"
                      aria-label={`เลื่อนบัญชีที่ ${i + 1} ขึ้น`}
                    >
                      <ArrowUp {...ICON_SM} />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={disabled || i === rows.length - 1}
                      className="btn-icon btn-icon-plain"
                      aria-label={`เลื่อนบัญชีที่ ${i + 1} ลง`}
                    >
                      <ArrowDown {...ICON_SM} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      disabled={disabled}
                      className="btn-icon btn-icon-danger"
                      aria-label={`ลบบัญชีที่ ${i + 1}`}
                    >
                      <Trash2 {...ICON_SM} />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="min-w-0">
                    <label htmlFor={`${idBase}-bank`} className="field-label">ธนาคาร</label>
                    <input
                      id={`${idBase}-bank`}
                      className="input"
                      list={listId}
                      maxLength={BANK_FIELD_MAX}
                      autoComplete="off"
                      placeholder="เช่น กสิกรไทย"
                      value={r.bank}
                      disabled={disabled}
                      aria-invalid={err(i, 'bank') ? true : undefined}
                      onChange={e => update(i, { bank: e.target.value })}
                    />
                    <datalist id={listId}>
                      {COMMON_BANKS.map(b => <option key={b} value={b} />)}
                    </datalist>
                    {err(i, 'bank') && <p role="alert" className="mt-1 text-sm text-red-700">{err(i, 'bank')}</p>}
                  </div>
                  <div className="min-w-0">
                    <label htmlFor={`${idBase}-no`} className="field-label">เลขบัญชี</label>
                    <input
                      id={`${idBase}-no`}
                      className="input tabular-nums"
                      inputMode="numeric"
                      maxLength={BANK_FIELD_MAX}
                      autoComplete="off"
                      placeholder="เช่น 123-4-56789-0"
                      value={r.account_no}
                      disabled={disabled}
                      aria-invalid={err(i, 'account_no') ? true : undefined}
                      onChange={e => update(i, { account_no: e.target.value })}
                    />
                    {err(i, 'account_no') && <p role="alert" className="mt-1 text-sm text-red-700">{err(i, 'account_no')}</p>}
                  </div>
                  <div className="min-w-0">
                    <label htmlFor={`${idBase}-name`} className="field-label">ชื่อบัญชี</label>
                    <input
                      id={`${idBase}-name`}
                      className="input"
                      maxLength={BANK_FIELD_MAX}
                      autoComplete="off"
                      placeholder="ชื่อเจ้าของบัญชี"
                      value={r.account_name}
                      disabled={disabled}
                      aria-invalid={err(i, 'account_name') ? true : undefined}
                      onChange={e => update(i, { account_name: e.target.value })}
                    />
                    {err(i, 'account_name') && <p role="alert" className="mt-1 text-sm text-red-700">{err(i, 'account_name')}</p>}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {showErrors && errors.bank_accounts && <p role="alert" className="text-sm text-red-700">{errors.bank_accounts}</p>}
      <button
        type="button"
        onClick={add}
        disabled={disabled || rows.length >= MAX_BANK_ACCOUNTS}
        className="btn-dashed w-full"
      >
        <Plus {...ICON_SM} />
        {rows.length >= MAX_BANK_ACCOUNTS ? `ครบ ${MAX_BANK_ACCOUNTS} บัญชีแล้ว` : 'เพิ่มบัญชีธนาคาร'}
      </button>
    </div>
  )
}
