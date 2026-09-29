// lib/integrations/registry.ts — เลือก adapter ตามแพลตฟอร์ม (ฝั่งเซิร์ฟเวอร์เท่านั้น)
import type { ChannelAdapter, Platform } from './types'
import line from './adapters/line'
import meta from './adapters/meta'
import shopee from './adapters/shopee'
import lazada from './adapters/lazada'
import tiktok from './adapters/tiktok'
import generic from './adapters/generic'

const ADAPTERS: Record<Platform, ChannelAdapter> = { line, meta, shopee, lazada, tiktok, generic }

export function getAdapter(platform: Platform): ChannelAdapter {
  const a = ADAPTERS[platform]
  if (!a) throw new Error('unknown platform')
  return a
}
