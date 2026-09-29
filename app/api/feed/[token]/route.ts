// /api/feed/<token> — ลิงก์ฟีดสินค้าสาธารณะให้ Meta / Google Merchant Center มาดึงเอง
//   ?format=meta (ค่าเริ่มต้น, CSV) | google (TSV) | meta-xml / google-xml (RSS 2.0 namespace g:)
// โทเคน = สุ่ม 32 ไบต์ base64url (43 ตัว) ค้นด้วย sha256 เท่านั้น — มีแต่ข้อมูลแค็ตตาล็อกสาธารณะ (ไม่มีต้นทุน/สต๊อกจริง)
// โทเคนผิด/ถูกหมุนแล้ว → 404, ฐานข้อมูลล่ม → 503 (ห้ามตอบไฟล์ว่าง 200 — Meta จะลบสินค้าทั้ง Catalog)
import type { FeedItems } from '@/lib/integrations/types'
import { feedItems } from '@/lib/integrations/store'
import { sha256Hex } from '@/lib/integrations/crypto'
import { buildGoogleFeed, buildMetaFeed, buildRssFeed } from '@/lib/integrations/feed'
import { feedLinkTemplate, productImageBase } from '@/lib/integrations/env'
import { logError } from '@/lib/integrations/redact'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
const FORMATS = new Set(['meta', 'google', 'meta-xml', 'google-xml'])

function plain(status: number, text: string): Response {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })
}

export async function GET(req: Request, { params }: { params: { token: string } }): Promise<Response> {
  const token = params.token
  if (!TOKEN_RE.test(token ?? '')) return plain(404, 'not found')
  const format = new URL(req.url).searchParams.get('format') ?? 'meta'
  if (!FORMATS.has(format)) return plain(400, 'unknown format')

  let items: FeedItems | null
  try {
    items = await feedItems(sha256Hex(token))
  } catch (e) {
    logError('feed', e)
    return plain(503, 'temporarily unavailable')
  }
  if (!items || typeof items !== 'object' || !Array.isArray(items.items)) return plain(404, 'not found')

  const opts = { imageBase: productImageBase(), linkTemplate: feedLinkTemplate(), brand: 'NEWCUTE' }
  let body: string
  let type: string
  let ext: string
  if (format === 'google') { body = buildGoogleFeed(items, opts); type = 'text/tab-separated-values; charset=utf-8'; ext = 'tsv' }
  else if (format === 'meta-xml') { body = buildRssFeed(items, opts, 'meta'); type = 'application/xml; charset=utf-8'; ext = 'xml' }
  else if (format === 'google-xml') { body = buildRssFeed(items, opts, 'google'); type = 'application/xml; charset=utf-8'; ext = 'xml' }
  else { body = buildMetaFeed(items, opts); type = 'text/csv; charset=utf-8'; ext = 'csv' }

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      'Content-Disposition': `inline; filename="newcute-feed.${ext}"`,
      'X-Robots-Tag': 'noindex',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
