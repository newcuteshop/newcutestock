'use client'
// ทางสำรองที่ใช้ได้ทุกช่องทาง: ส่งออก CSV สต๊อก, นำเข้า CSV ออเดอร์ (ตรวจไฟล์ก่อนส่ง), ลิงก์ฟีดสินค้า (Meta/ช่องทางอื่น)
import { useId, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, Download, FileSpreadsheet, Loader2, PackageX, RefreshCw, Rss, Upload, XCircle,
} from 'lucide-react'
import { ICON, ICON_SM } from '@/components/theme/icons'
import { formatThaiDateTime } from '@/lib/format'
import { PLATFORM_META } from '@/lib/integrations/platforms'
import type { ChannelJson } from '@/lib/integrations/types'
import {
  disableFeed, exportStockCsv, importOrdersCsv, rotateFeedToken,
} from '@/app/(dashboard)/settings/integrations/actions'
import { FlashMessage, type Flash } from './bits'
import ConfirmDialog from './ConfirmDialog'
import CopyField from './CopyField'
import { CSV_MAX_BYTES, previewOrdersCsv, sampleOrdersCsv, type CsvPreview } from './csvPreview'
import { qty } from './format'
import { callAction, useRunner } from './useAction'

function safeFilename(name: string, fallback: string): string {
  const clean = String(name ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120)
  return clean || fallback
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export default function FallbackTools({
  channel, feed, feedError,
}: {
  channel: ChannelJson
  feed: { url: string | null; googleUrl: string | null } | null
  feedError: string | null
}) {
  const meta = PLATFORM_META[channel.platform]
  return (
    <section className="card p-4 sm:p-5 space-y-5" aria-labelledby={`tools-${channel.id}`}>
      <div>
        <h2 id={`tools-${channel.id}`} className="section-title">
          <FileSpreadsheet {...ICON} className="text-brand-600" />
          ทางสำรอง: ไฟล์ CSV{meta.capabilities.feed ? ' และลิงก์ฟีด' : ''}
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          ใช้ได้ทุกช่องทาง — ระหว่างรออนุมัติ API หรือกับแพลตฟอร์มที่ไม่มี API
        </p>
      </div>
      {meta.capabilities.csvExport && <StockExport channel={channel} />}
      {meta.capabilities.csvImport && <OrdersImport channel={channel} />}
      {meta.capabilities.feed && <FeedBox channel={channel} initial={feed} loadError={feedError} />}
    </section>
  )
}

// ---------- ส่งออก CSV สต๊อก ----------
function StockExport({ channel }: { channel: ChannelJson }) {
  const { busy, run } = useRunner()
  const [flash, setFlash] = useState<Flash | null>(null)

  async function onExport() {
    setFlash(null)
    await run('export', async () => {
      const res = await callAction(() => exportStockCsv(channel.id))
      if (!res.ok) { setFlash({ ok: false, text: res.error }); return }
      downloadText(safeFilename(res.filename, 'newcute-stock.csv'), res.csv, 'text/csv;charset=utf-8')
      setFlash({ ok: true, text: 'ดาวน์โหลดไฟล์แล้ว — เปิดด้วย Excel แล้วคัดลอกคอลัมน์ available ไปใส่ใน Seller Center' })
    })
  }

  return (
    <div className="panel p-3 sm:p-4 space-y-2">
      <p className="font-semibold text-gray-900">ส่งออก CSV สต๊อก</p>
      <p className="text-sm text-gray-600">
        จำนวนที่ขายได้ของทุกไซส์ (หักกันสต๊อก {qty(channel.options.stock_buffer)} ชิ้นและของที่ค้างส่ง) สำหรับอัปโหลดในเว็บของแพลตฟอร์ม
      </p>
      <FlashMessage flash={flash} />
      <button type="button" onClick={onExport} disabled={busy !== null} className="btn-secondary w-full sm:w-auto px-5">
        {busy === 'export' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <Download {...ICON_SM} />}
        ส่งออก CSV สต๊อก
      </button>
    </div>
  )
}

// ---------- นำเข้า CSV ออเดอร์ ----------
type ImportResult = {
  orders: number; created: number; unchanged: number; deducted: number; oversold: number
  errors: { row: number; orderId?: string; message: string }[]
}

function OrdersImport({ channel }: { channel: ChannelJson }) {
  const router = useRouter()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const { busy, run } = useRunner()
  const [file, setFile] = useState<{ name: string; text: string; preview: CsvPreview } | null>(null)
  const [readError, setReadError] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [flash, setFlash] = useState<Flash | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''   // เลือกไฟล์เดิมซ้ำได้
    setResult(null)
    setFlash(null)
    setReadError('')
    setFile(null)
    if (!f) return
    if (f.size > CSV_MAX_BYTES) { setReadError('ไฟล์ใหญ่เกิน 1 MB — แบ่งเป็นหลายไฟล์'); return }
    try {
      const text = await f.text()
      setFile({ name: f.name, text, preview: previewOrdersCsv(text, f.size) })
    } catch {
      setReadError('อ่านไฟล์ไม่ได้ กรุณาเลือกไฟล์ใหม่')
    }
  }

  async function doImport() {
    if (!file) return
    await run('import', async () => {
      const res = await callAction(() => importOrdersCsv(channel.id, file.text))
      setConfirmOpen(false)
      if (!res.ok) { setFlash({ ok: false, text: res.error }); return }
      setResult({
        orders: res.orders, created: res.created, unchanged: res.unchanged, deducted: res.deducted,
        oversold: res.oversold, errors: Array.isArray(res.errors) ? res.errors : [],
      })
      setFile(null)
      router.refresh()
    })
  }

  const p = file?.preview ?? null
  // มีแถวผิด = เซิร์ฟเวอร์ข้าม "ทั้งออเดอร์" ที่มีแถวนั้น — นำเข้าที่เหลือได้ (ต้องติ๊กยืนยัน) แล้วแก้ไฟล์นำเข้าซ้ำภายหลัง
  const canImport = !!p && !p.fatal && p.orders > 0
  const shadow = channel.options.shadow_mode

  return (
    <div className="panel p-3 sm:p-4 space-y-3">
      <p className="font-semibold text-gray-900">นำเข้า CSV ออเดอร์</p>
      <p className="text-sm text-gray-600">
        ตัดสต๊อกจากไฟล์ออเดอร์ที่ดาวน์โหลดจาก Seller Center — หัวตารางต้องมี
        <span className="font-mono text-xs"> order_id, sku, qty</span> (ไม่บังคับ:
        <span className="font-mono text-xs"> unit_price, status, order_date, qty_cancelled</span>{' '}
        หรือชื่อไทย เลขออเดอร์ / รหัสสินค้า / จำนวน) · สถานะว่าง = สำเร็จ · เลขออเดอร์เดิมนำเข้าซ้ำไม่ตัดสต๊อกซ้ำ
      </p>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy !== null}
          aria-controls={inputId}
          className="btn-secondary w-full sm:w-auto px-5"
        >
          <Upload {...ICON_SM} />
          เลือกไฟล์ CSV
        </button>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={onPick}
        />
        <button
          type="button"
          onClick={() => downloadText('newcute-orders-template.csv', sampleOrdersCsv(), 'text/csv;charset=utf-8')}
          className="btn-ghost w-full sm:w-auto px-4"
        >
          <Download {...ICON_SM} />
          ไฟล์ตัวอย่าง
        </button>
      </div>

      {readError && (
        <div role="alert" className="alert-err"><XCircle size={18} strokeWidth={1.9} aria-hidden="true" /><p className="min-w-0">{readError}</p></div>
      )}

      {file && p && (
        <div className="space-y-3">
          <p className="text-sm text-gray-700 break-all">
            ไฟล์: <span className="font-medium">{file.name}</span>
          </p>
          {p.warnings.map(w => (
            <div key={w} className="alert-warn"><AlertTriangle size={18} strokeWidth={1.9} aria-hidden="true" /><p className="min-w-0">{w}</p></div>
          ))}
          {p.fatal ? (
            <div role="alert" className="alert-err"><XCircle size={18} strokeWidth={1.9} aria-hidden="true" /><p className="min-w-0">{p.fatal}</p></div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <span className="chip tabular-nums">{qty(p.orders)} ออเดอร์</span>
                <span className="chip-outline tabular-nums">{qty(p.rows.length)} แถว</span>
                <span className="chip-outline tabular-nums">{qty(p.units)} ชิ้น</span>
                {p.errors.length > 0 && <span className="chip-outline tabular-nums text-red-700">มีปัญหา {qty(p.errors.length)} แถว</span>}
                {p.badOrders > 0 && <span className="chip-outline tabular-nums text-red-700">ข้าม {qty(p.badOrders)} ออเดอร์</span>}
              </div>
              {p.errors.length > 0 && (
                <div role="alert" className="alert-err">
                  <XCircle size={18} strokeWidth={1.9} aria-hidden="true" />
                  <div className="min-w-0 space-y-1">
                    <p className="font-semibold">
                      {p.orders > 0
                        ? `ออเดอร์ที่มีแถวผิด ${qty(p.badOrders)} ออเดอร์จะไม่ถูกนำเข้า — แก้ไฟล์แล้วนำเข้าอีกครั้งได้ (ออเดอร์ที่นำเข้าแล้วไม่ตัดซ้ำ)`
                        : 'แก้แถวที่มีปัญหาในไฟล์ก่อน แล้วเลือกไฟล์ใหม่'}
                    </p>
                    <ul className="space-y-0.5">
                      {p.errors.slice(0, 15).map(er => (
                        <li key={er.row} className="break-words">แถว {er.row}: {er.message}</li>
                      ))}
                      {p.errors.length > 15 && <li>และอีก {qty(p.errors.length - 15)} แถว</li>}
                    </ul>
                  </div>
                </div>
              )}
              <PreviewRows preview={p} />
            </>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => { setFlash(null); setConfirmOpen(true) }}
              disabled={!canImport || busy !== null}
              className="btn-primary w-full sm:w-auto px-5"
            >
              <Upload {...ICON_SM} />
              นำเข้า {p && !p.fatal ? `${qty(p.orders)} ออเดอร์` : ''}
            </button>
            <button type="button" onClick={() => setFile(null)} disabled={busy !== null} className="btn-ghost w-full sm:w-auto px-4">
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      <FlashMessage flash={flash} />

      {result && (
        <div className="space-y-2" role="status">
          <div className={result.errors.length ? 'alert-warn' : 'alert-ok'}>
            <FileSpreadsheet size={18} strokeWidth={1.9} aria-hidden="true" />
            <p className="min-w-0">
              นำเข้าแล้ว {qty(result.orders)} ออเดอร์ (ใหม่ {qty(result.created)} · ซ้ำไม่เปลี่ยน {qty(result.unchanged)})
              · ตัดสต๊อก {qty(result.deducted)} ชิ้น
              {result.errors.length > 0 && ` · มีปัญหา ${qty(result.errors.length)} รายการ (ดูด้านล่าง)`}
            </p>
          </div>
          {result.oversold > 0 && (
            <div role="alert" className="alert-err">
              <PackageX size={18} strokeWidth={1.9} aria-hidden="true" />
              <p className="min-w-0">
                ขายเกิน {qty(result.oversold)} ออเดอร์ — สต๊อกไม่พอ ระบบตัดเท่าที่มีและส่ง 0 ไปทุกช่องทางแล้ว{' '}
                <Link href={`/settings/integrations/${channel.id}?tab=orders&filter=oversold`} className="font-semibold underline">
                  ดูออเดอร์ที่ขายเกิน
                </Link>
              </p>
            </div>
          )}
          {result.errors.length > 0 && (
            <ul className="panel p-3 space-y-0.5 text-sm text-red-800">
              {result.errors.slice(0, 20).map((er, i) => (
                <li key={`${er.row}-${i}`} className="break-words">
                  {/* row 0 = ปัญหาระดับออเดอร์ (ไม่ใช่แถวในไฟล์) */}
                  {er.row > 0 ? `แถว ${er.row}` : 'ออเดอร์'}
                  {er.orderId ? (er.row > 0 ? ` (ออเดอร์ ${er.orderId})` : ` ${er.orderId}`) : ''}: {er.message}
                </li>
              ))}
              {result.errors.length > 20 && <li>และอีก {qty(result.errors.length - 20)} แถว</li>}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`นำเข้า ${qty(p?.orders ?? 0)} ออเดอร์เข้า ${channel.display_name}?`}
        confirmLabel={shadow ? 'นำเข้า' : 'นำเข้าและตัดสต๊อก'}
        busy={busy === 'import'}
        requireAck={p && p.badOrders > 0 ? `เข้าใจว่า ${qty(p.badOrders)} ออเดอร์ที่มีแถวผิดจะไม่ถูกนำเข้า` : undefined}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={doImport}
      >
        <p>
          {qty(p?.units ?? 0)} ชิ้น ({qty(p?.lines ?? 0)} รายการสินค้า) —{' '}
          {shadow
            ? 'ช่องทางนี้อยู่ในโหมดทดลอง: บันทึกออเดอร์อย่างเดียว ยังไม่ตัดสต๊อก'
            : 'จะตัดสต๊อกทันที (ออเดอร์ที่ยกเลิกไม่ตัด) และสร้างบิลขายในแอป'}
        </p>
        <p>เลขออเดอร์ที่เคยนำเข้าแล้วจะไม่ถูกตัดซ้ำ — SKU ที่ไม่มีในแอปจะรอให้จับคู่ในแท็บ &quot;จับคู่สินค้า&quot;</p>
      </ConfirmDialog>
    </div>
  )
}

function PreviewRows({ preview }: { preview: CsvPreview }) {
  const rows = preview.rows.slice(0, 10)
  return (
    <div className="card overflow-hidden">
      <div className="table-wrap">
        <table className="table-soft min-w-[560px]">
          <caption className="sr-only">ตัวอย่าง 10 แถวแรกของไฟล์</caption>
          <thead>
            <tr>
              <th>แถว</th>
              <th>order_id</th>
              <th>sku</th>
              <th className="text-right">qty</th>
              <th>status</th>
              <th>order_date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.row} className={r.problem ? 'bg-red-50' : undefined}>
                <td className="tabular-nums text-gray-500">{r.row}</td>
                <td className="font-mono text-xs break-all max-w-[160px]">{r.order_id || '-'}</td>
                <td className="font-mono text-xs break-all max-w-[140px]">{r.sku || '-'}</td>
                <td className="text-right tabular-nums">{r.qty || '-'}</td>
                <td className="text-xs">{r.status || 'completed'}</td>
                <td className="text-xs whitespace-nowrap">{r.order_date || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview.rows.length > rows.length && (
        <p className="px-4 py-2 text-xs text-gray-500">แสดง 10 จาก {qty(preview.rows.length)} แถว</p>
      )}
    </div>
  )
}

// ---------- ลิงก์ฟีดสินค้า ----------
function FeedBox({
  channel, initial, loadError,
}: {
  channel: ChannelJson
  initial: { url: string | null; googleUrl: string | null } | null
  loadError: string | null
}) {
  const router = useRouter()
  const { busy, run } = useRunner()
  const [feed, setFeed] = useState(initial)
  const [flash, setFlash] = useState<Flash | null>(loadError ? { ok: false, text: loadError } : null)
  const [confirm, setConfirm] = useState<'rotate' | 'disable' | null>(null)
  const hasLink = !!feed?.url

  async function doRotate() {
    await run('rotate', async () => {
      const res = await callAction(() => rotateFeedToken(channel.id))
      setConfirm(null)
      if (!res.ok) { setFlash({ ok: false, text: res.error }); return }
      setFeed({ url: res.url, googleUrl: res.googleUrl })
      setFlash({ ok: true, text: hasLink ? 'สร้างลิงก์ใหม่แล้ว — ลิงก์เดิมใช้ไม่ได้แล้ว อย่าลืมเปลี่ยนในแพลตฟอร์มที่ดึงฟีด' : 'สร้างลิงก์ฟีดแล้ว' })
      router.refresh()
    })
  }

  async function doDisable() {
    await run('disable', async () => {
      const res = await callAction(() => disableFeed(channel.id))
      setConfirm(null)
      if (!res.ok) { setFlash({ ok: false, text: res.error }); return }
      setFeed({ url: null, googleUrl: null })
      setFlash({ ok: true, text: 'ปิดลิงก์ฟีดแล้ว' })
      router.refresh()
    })
  }

  return (
    <div className="panel p-3 sm:p-4 space-y-3">
      <p className="inline-flex items-center gap-2 font-semibold text-gray-900">
        <Rss {...ICON_SM} className="text-brand-600" />
        ลิงก์ฟีดสินค้า
      </p>
      <p className="text-sm text-gray-600">
        ให้ Meta Commerce Manager / Google Merchant Center มาดึงรายการสินค้าเองตามรอบ (ชื่อ ราคา รูป ไซส์ มี/หมด) —
        ไม่มีต้นทุนหรือข้อมูลภายใน ใครได้ลิงก์ก็เปิดได้ อย่าแชร์ต่อ
      </p>
      {channel.platform === 'meta' && (
        <div className="alert-warn">
          <AlertTriangle size={18} strokeWidth={1.9} aria-hidden="true" />
          <p className="min-w-0">Meta บังคับให้มีลิงก์หน้าสินค้าสาธารณะ (คอลัมน์ link) — หน้าสินค้าสาธารณะยังไม่ได้ทำ รอบอสตัดสินใจ</p>
        </div>
      )}

      {hasLink && feed?.url ? (
        <div className="space-y-2">
          <CopyField label="ลิงก์ฟีด Meta (CSV)" value={feed.url} />
          {feed.googleUrl && <CopyField label="ลิงก์ฟีด Google (TSV)" value={feed.googleUrl} />}
          {channel.feed_token_rotated_at && (
            <p className="text-xs text-gray-500">สร้างเมื่อ {formatThaiDateTime(channel.feed_token_rotated_at)}</p>
          )}
        </div>
      ) : channel.has_feed_token ? (
        <p className="text-sm text-amber-800">มีลิงก์ฟีดเปิดอยู่แต่แสดงลิงก์ไม่ได้ — กด &quot;สร้างลิงก์ใหม่&quot; เพื่อออกลิงก์ใหม่</p>
      ) : (
        <p className="text-sm text-gray-600">ยังไม่มีลิงก์ฟีด</p>
      )}

      <FlashMessage flash={flash} />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={() => { setFlash(null); if (hasLink || channel.has_feed_token) setConfirm('rotate'); else void doRotate() }}
          disabled={busy !== null}
          className="btn-secondary w-full sm:w-auto px-5"
        >
          {busy === 'rotate' ? <Loader2 {...ICON_SM} className="animate-spin" /> : <RefreshCw {...ICON_SM} />}
          {hasLink || channel.has_feed_token ? 'สร้างลิงก์ใหม่' : 'สร้างลิงก์ฟีด'}
        </button>
        {(hasLink || channel.has_feed_token) && (
          <button type="button" onClick={() => { setFlash(null); setConfirm('disable') }} disabled={busy !== null} className="btn-danger-soft w-full sm:w-auto px-5">
            ปิดลิงก์ฟีด
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirm === 'rotate'}
        title="สร้างลิงก์ฟีดใหม่?"
        tone="danger"
        confirmLabel="สร้างลิงก์ใหม่"
        busy={busy === 'rotate'}
        onCancel={() => setConfirm(null)}
        onConfirm={doRotate}
      >
        <p>ลิงก์เดิมจะใช้ไม่ได้ทันที — ต้องเอาลิงก์ใหม่ไปเปลี่ยนใน Commerce Manager / Merchant Center เอง ไม่งั้นแพลตฟอร์มจะดึงสินค้าไม่ได้</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'disable'}
        title="ปิดลิงก์ฟีด?"
        tone="danger"
        confirmLabel="ปิดลิงก์ฟีด"
        busy={busy === 'disable'}
        onCancel={() => setConfirm(null)}
        onConfirm={doDisable}
      >
        <p>แพลตฟอร์มที่ดึงฟีดอยู่จะดึงไม่ได้ทันที (บางแพลตฟอร์มอาจซ่อนสินค้าทั้งหมด) — เปิดใหม่ได้โดยสร้างลิงก์ใหม่</p>
      </ConfirmDialog>
    </div>
  )
}
