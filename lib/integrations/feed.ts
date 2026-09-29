// lib/integrations/feed.ts — ไฟล์ฟีดสินค้าสาธารณะ (Meta = CSV, Google Merchant = TSV) — มีเฉพาะข้อมูลแค็ตตาล็อกสาธารณะ
// (ไม่มีต้นทุน ไม่มีสต๊อกจริง — จำนวนเป็น "ที่ขายได้หลังหัก buffer" จาก get_feed_items) ฝั่งเซิร์ฟเวอร์
import type { FeedItem, FeedItems } from './types'
import { toCsv } from './csv'
import { productImageUrl } from './env'

export interface FeedOptions { imageBase: string; linkTemplate: string; brand: string }

const META_HEADER = ['id', 'item_group_id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link',
  'additional_image_link', 'brand', 'size', 'color', 'quantity_to_sell_on_facebook']
const GOOGLE_HEADER = ['id', 'item_group_id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link',
  'additional_image_link', 'brand', 'size', 'color']

/** ข้อความล้วน บรรทัดเดียว ไม่มีอักขระควบคุม */
function plain(s: string | null | undefined, max: number): string {
  return String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function linkFor(item: FeedItem, template: string): string {
  return template.replace(/\{group_id\}/g, encodeURIComponent(item.group_id)).replace(/\{sku\}/g, encodeURIComponent(item.sku))
}

function row(item: FeedItem, opts: FeedOptions, google: boolean): (string | number)[] {
  const images = (item.image_paths ?? []).map(p => productImageUrl(p, opts.imageBase))
  const qty = Math.max(0, Math.trunc(Number(item.quantity) || 0))
  const inStock = qty > 0 && item.availability === 'in stock'
  const price = `${Number(item.price ?? 0).toFixed(2)} THB`
  const title = plain(item.title, 150) || plain(item.sku, 150)
  const description = plain(item.description, 5000) || title
  const out: (string | number)[] = [
    plain(item.sku, 100),
    plain(item.group_id, 100),
    title,
    description,
    google ? (inStock ? 'in_stock' : 'out_of_stock') : (inStock ? 'in stock' : 'out of stock'),
    'new',
    price,
    linkFor(item, opts.linkTemplate),
    images[0] ?? '',
    images.slice(1, 11).join(','),
    plain(opts.brand, 100),
    plain(item.size, 100),
    plain(item.color, 100),
  ]
  if (!google) out.push(qty)
  return out
}

/** ฟีด Meta (CSV ไม่มี BOM) */
export function buildMetaFeed(items: FeedItems, opts: FeedOptions): string {
  return toCsv([META_HEADER, ...items.items.map(i => row(i, opts, false))])
}

/** ฟีด Google Merchant Center (TSV) */
export function buildGoogleFeed(items: FeedItems, opts: FeedOptions): string {
  return toCsv([GOOGLE_HEADER, ...items.items.map(i => row(i, opts, true))], { delimiter: '\t' })
}

/** อักขระที่ XML 1.0 รับได้ (คู่ surrogate ของอีโมจิผ่านได้ทั้งคู่) */
function xmlCharOk(c: number): boolean {
  return c === 0x09 || c === 0x0a || c === 0x0d || (c >= 0x20 && c <= 0xfffd && c !== 0xfffe)
}

function xml(s: string | number): string {
  return String(s)
    .split('').filter(ch => xmlCharOk(ch.charCodeAt(0))).join('')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** ฟีด RSS 2.0 (namespace g:) — target 'meta' ใช้ค่า availability แบบ Meta ('in stock'), 'google' แบบ Google ('in_stock') */
export function buildRssFeed(items: FeedItems, opts: FeedOptions, target: 'meta' | 'google'): string {
  const google = target === 'google'
  const header = google ? GOOGLE_HEADER : META_HEADER
  const entries = items.items.map(i => {
    const values = row(i, opts, google)
    const fields: string[] = []
    header.forEach((name, idx) => {
      const v = values[idx]
      if (v === '' || v === undefined) return
      if (name === 'additional_image_link') {
        for (const url of String(v).split(',').filter(Boolean)) fields.push(`<g:additional_image_link>${xml(url)}</g:additional_image_link>`)
        return
      }
      fields.push(`<g:${name}>${xml(v)}</g:${name}>`)
    })
    return `<item>${fields.join('')}</item>`
  })
  let site = ''
  try { site = new URL(opts.linkTemplate.replace(/\{[^}]*\}/g, 'x')).origin } catch { site = '' }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>' +
    `<title>${xml(plain(opts.brand, 100) || 'NEWCUTE')}</title>${site ? `<link>${xml(site)}</link>` : ''}<description>product feed</description>` +
    entries.join('\n') +
    '</channel></rss>\n'
}
