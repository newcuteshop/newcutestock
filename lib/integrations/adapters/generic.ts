// lib/integrations/adapters/generic.ts — "ช่องทางอื่น (ฟีด / CSV)" ไม่มี API ให้เชื่อม
// ใช้ได้เฉพาะลิงก์ฟีดสินค้า / ส่งออก CSV สต๊อก / นำเข้า CSV ออเดอร์ (ทำใน server action + route ของฟีด)
import type { AdapterContext, ChannelAdapter } from '../types'

async function testConnection(_ctx: AdapterContext) {
  return { ok: true, message: 'ช่องทางนี้ไม่ต้องเชื่อม API' }
}

const adapter: ChannelAdapter = {
  platform: 'generic',
  testConnection,
}

export default adapter
