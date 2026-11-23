// fix-08: กัน deadlock ระหว่างออเดอร์แพลตฟอร์มกับงานหน้าร้าน
//   - channel_order_apply ล็อกสินค้าเรียงตาม id ก่อนเขียนบิล
//   - record_sale / void_sale / return_sale_items / apply_stock_count / move_stock / channel_order_apply
//     ล็อกสินค้าแบบ for no key update (ไม่ชนกับ key share ที่ FK ของบรรทัดออเดอร์ใส่ไว้)
//   (ก) ผลเหมือนเดิมทุกอย่าง — รันฉากเดียวกันบนฐานที่ยังไม่รัน fix-08 กับฐานที่รันแล้ว เทียบสถานะทุกตาราง + ค่าที่คืนทุกขั้น
//       ฉากหลัก (ออเดอร์แพลตฟอร์ม + ขายหน้าร้าน) และฉากเพิ่ม (ยกเลิกบิล/คืนสินค้า/ตรวจนับ/รับ-จ่ายสต๊อก + เส้นทางอื่นของออเดอร์)
//   (ข) ลำดับ/แบบการล็อกตอนรันจริง — trigger ทดสอบอ่านบิตล็อกของแถวสินค้าด้วย pageinspect:
//       ทุกครั้งที่สร้าง/แก้บิลหรือรายการในบิลของออเดอร์แพลตฟอร์ม แถวสินค้าต้องถูกรายการตัวเองล็อกแบบ exclusive แล้ว
//       และทุกครั้งที่แก้สต๊อก แถวสินค้าต้องถูกล็อกไว้ก่อนแบบ no key update
//       (ฐานที่ยังไม่รัน fix-08 ต้องถูกจับได้ — ยืนยันว่าตัวตรวจใช้ได้จริง)
//   (ค) รันซ้ำ 2 รอบได้ / ยังไม่ได้รัน fix-04 = หยุดพร้อมข้อความไทย / ตารางสรุปท้ายไฟล์จับของผิดได้
//   (ฉ) รอล็อกจริงระหว่างสองรายการ — อีกรายการถือล็อกค้างไว้ด้วย prepare transaction (โปรเซสแยก tests/lib/lock-hold-child.mjs)
//       แล้วเรียกฟังก์ชันจริง: ต้องไม่รอ (SQL เดิมรอ = ขาของวง deadlock) — PGlite มีการเชื่อมต่อเดียว
//       จึงตรวจได้ทีละขาของวง (ไม่มีตัวตรวจ deadlock ให้เห็น 40P01 จริง)
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageinspect } from '@electric-sql/pglite/contrib/pageinspect';
import { createDb, loadSqlFile, eq, ok, expectErr, REPO } from '../run.mjs';

export const noDefaultDb = true; // ทุกข้อสร้างฐานข้อมูลเอง (ต้องใช้ทั้งฐานเดิมและฐานที่รัน fix-08)

const FIX03 = 'supabase-fix-03-integrations.sql';
const FIX07 = 'supabase-fix-07-wedding.sql';
const FIX08 = 'supabase-fix-08-lock-order.sql';
const SQL_DIR = process.env.SQL_DIR ? path.resolve(process.env.SQL_DIR) : REPO;

// id คงที่ — สองฐานข้อมูลได้ค่าเดียวกัน เทียบผลกันตรงๆ ได้
const ADMIN = 'a0000000-0000-4000-8000-00000000000a';
const CASHIER = 'a0000000-0000-4000-8000-00000000000c';
const GROUP = 'b0000000-0000-4000-8000-000000000001';
const pid = (n) => `c0000000-0000-4000-8000-00000000000${n}`;
const clientId = (n) => `e0000000-0000-4000-8000-00000000000${n}`;
// สินค้า LK-1 … LK-6 (id เรียงตามเลข) — LK-4 สต๊อก 0 (ขายเกิน), LK-6 ไม่มีรายการบนแพลตฟอร์ม (ใช้ย้ายรายการ)
const PRODUCTS = [1, 2, 3, 4, 5, 6].map((n) => ({ n, id: pid(n), sku: `LK-${n}`, stock: n === 4 ? 0 : 10 }));

const T0 = Date.parse('2026-11-01T03:00:00Z');
const ts = (min) => new Date(T0 + min * 60000).toISOString();
const line = (key, n, qty, extra = {}) => ({
  line_key: key, sku_id: `SKU-P${n}`, item_id: `ITEM-${n}`, sku: `LK-${n}`, name: `สินค้าทดสอบ ${n}`,
  qty, unit_price: 100 * n + 9, ...extra,
});
const order = (ext, status, minute, lines, extra = {}) => ({
  external_order_id: ext, status, raw_status: status.toUpperCase(), created_at: ts(0), updated_at: ts(minute),
  currency: 'THB', lines, ...extra,
});

async function fixedUser(ctx, id, name, role, perms) {
  await ctx.pg.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)`,
    [id, `u${id.slice(-4)}@test.local`, JSON.stringify({ full_name: name })]);
  await ctx.pg.query(`update public.user_profiles set role = $2, full_name = $3,
                              permissions = coalesce(permissions, '{}'::jsonb) || $4::jsonb where id = $1`,
    [id, role, name, JSON.stringify(perms)]);
  return ctx.asUser(id);
}

// ข้อมูลตั้งต้นผ่าน RPC จริง: ผู้ใช้ 2 คน, สินค้า 6 ตัว, ช่องทาง Shopee (เชื่อมต่อ + ส่งสต๊อก + ตัดเมื่อจ่ายแล้ว),
// รายการบนแพลตฟอร์ม 5 รายการ (จับคู่อัตโนมัติด้วย SKU), ส่งสต๊อกครั้งแรกเสร็จแล้ว
async function seed(ctx) {
  const admin = await fixedUser(ctx, ADMIN, 'แอดมินทดสอบ', 'admin', {});
  const cashier = await fixedUser(ctx, CASHIER, 'พนักงานขายทดสอบ', 'staff', { sales: true, products: true, stock: true });
  await ctx.pg.query(`insert into public.product_groups (id, name) values ($1, 'เสื้อทดสอบล็อก')`, [GROUP]);
  for (const p of PRODUCTS) {
    await ctx.pg.query(`insert into public.products (id, name, sku, size, sell_price, cost_price, stock_qty, group_id)
                        values ($1, 'เสื้อทดสอบล็อก', $2, $3, $4, $5, $6, $7)`,
      [p.id, p.sku, `S${p.n}`, 100 * p.n, 40 * p.n, p.stock, GROUP]);
  }
  const ch = await admin.rpc('create_integration_channel', { p_platform: 'shopee', p_display_name: 'Shopee ทดสอบ' });
  const cid = ch.id;
  await ctx.service.rpc('server_update_channel', { p_channel_id: cid, p_patch: { status: 'connected' } });
  await admin.rpc('save_channel_options', { p_channel_id: cid, p_options: { push_stock: true, deduct_on: 'paid' } });
  await ctx.service.rpc('upsert_channel_listings', {
    p_channel_id: cid,
    p_rows: [1, 2, 3, 4, 5].map((n) => ({ sku_id: `SKU-P${n}`, item_id: `ITEM-${n}`, sku: `LK-${n}`, name: `สินค้าทดสอบ ${n}` })),
  });
  await admin.rpc('mark_initial_push', { p_channel_id: cid });
  // worker ส่งสต๊อกครั้งแรกเสร็จ → การแก้สต๊อกหลังจากนี้สร้างงานใหม่ในคิว (ทาง insert ที่ FK ไปหาช่องทาง)
  await ctx.pg.query(`update public.stock_sync_outbox set status = 'done', done_at = now() where status = 'pending'`);
  return { admin, cashier, cid };
}

// ฉากทดสอบ: ขั้นละ 1 รายการ (หรือ 2 สำหรับการกระทำของแอดมินที่ต่อกัน) — คืน [{ name, ret, snap }]
async function runScenario(ctx) {
  const { admin, cashier, cid } = await seed(ctx);
  const rco = (o) => ctx.service.rpc('record_channel_order', { p_channel_id: cid, p_order: o, p_source: 'webhook' });
  const orderId = async (ext) => (await ctx.pg.one(`select id from public.channel_orders where external_order_id = $1`, [ext])).id;
  const ord1 = [line('L1', 3, 2), line('L2', 1, 1), line('L3', 2, 3)]; // ลำดับบรรทัด LK-3, LK-1, LK-2 (ไม่ตรงลำดับ id)

  const steps = [
    ['ขายหน้าร้านก่อน (LK-2, LK-1)', () => cashier.rpc('record_sale', {
      p_client_id: clientId(1), p_items: [{ product_id: pid(2), qty: 1 }, { product_id: pid(1), qty: 2 }],
      p_discount: 0, p_payment_method: 'cash', p_note: null, p_channel: 'store', p_cash_received: 1000 })],
    ['ORD-1 ใหม่ จ่ายแล้ว 3 สินค้า (บิลแรก)', () => rco(order('ORD-1', 'paid', 1, ord1))],
    ['ORD-1 ส่งซ้ำเหมือนเดิม', () => rco(order('ORD-1', 'paid', 1, ord1))],
    ['ORD-1 เปลี่ยนจำนวน (เพิ่ม LK-1, ยกเลิก LK-2 1 ชิ้น)', () => rco(order('ORD-1', 'paid', 2,
      [line('L1', 3, 2), line('L2', 1, 2), line('L3', 2, 3, { qty_cancelled: 1 })]))],
    ['ORD-2 ขายเกิน LK-4 (สต๊อก 0) + LK-5', () => rco(order('ORD-2', 'paid', 3, [line('A', 4, 2), line('B', 5, 1)]))],
    ['ย้ายรายการ SKU-P4 ไป LK-6 แล้วประมวลผล ORD-2 ใหม่', async () => {
      const lst = await ctx.pg.one(`select id from public.channel_listings where external_sku_id = 'SKU-P4'`);
      const m = await admin.rpc('set_listing_mapping', { p_listing_id: lst.id, p_product_id: pid(6), p_ignore: false });
      const r = await admin.rpc('resolve_channel_order', { p_order_id: await orderId('ORD-2'), p_action: 'reprocess' });
      return { mapping: m, resolve: r };
    }],
    ['ORD-3 มีบรรทัดที่จับคู่ไม่ได้', () => rco(order('ORD-3', 'paid', 4, [
      { line_key: 'X', sku_id: 'SKU-NONE', item_id: 'ITEM-NONE', sku: 'NOPE-1', name: 'ไม่มีในร้าน', qty: 1, unit_price: 55 },
      line('Y', 5, 1)]))],
    ['ORD-4 ยังไม่จ่าย (ตัดเมื่อจ่ายแล้ว) — ไม่มีบิล', () => rco(order('ORD-4', 'unpaid', 5, [line('K1', 3, 1), line('K2', 1, 1)]))],
    ['ORD-4 จ่ายแล้ว — บิลแรกตอนอัปเดตออเดอร์เดิม', () => rco(order('ORD-4', 'paid', 6, [line('K1', 3, 1), line('K2', 1, 1)]))],
    ['ยกเลิก ORD-1 ก่อนส่งของ — ยกเลิกบิล + คืนสต๊อก', () => ctx.service.rpc('cancel_channel_order', {
      p_channel_id: cid, p_external_order_id: 'ORD-1', p_status: 'cancelled', p_raw_status: 'CANCELLED',
      p_was_shipped: false, p_updated_at: ts(7) })],
    ['ORD-5 ส่งของแล้ว (เห็นครั้งแรก)', () => rco(order('ORD-5', 'shipped', 8, [line('S1', 2, 2), line('S2', 1, 1)],
      { shipped_at: ts(8) }))],
    ['ORD-5 คืนของ 1 ชิ้น + แอดมินยืนยันรับคืน', async () => {
      const r = await rco(order('ORD-5', 'returned', 9, [line('S1', 2, 2, { qty_returned: 1 }), line('S2', 1, 1)],
        { shipped_at: ts(8) }));
      const l = await ctx.pg.one(`select l.id from public.channel_order_lines as l join public.channel_orders as o on o.id = l.order_id
                                   where o.external_order_id = 'ORD-5' and l.line_key = 'S1'`);
      const c = await admin.rpc('confirm_return_restock', { p_line_id: l.id, p_qty_received: 1 });
      return { record: r, confirm: c };
    }],
    ['ขายหน้าร้านหลัง (LK-6, LK-3)', () => cashier.rpc('record_sale', {
      p_client_id: clientId(2), p_items: [{ product_id: pid(6), qty: 1 }, { product_id: pid(3), qty: 1 }],
      p_discount: 0, p_payment_method: 'transfer', p_note: 'หลังออเดอร์', p_channel: 'store', p_cash_received: null })],
  ];

  return runSteps(ctx, steps);
}

async function runSteps(ctx, steps) {
  const out = [];
  for (const [name, fn] of steps) {
    const ret = await fn();
    const map = await labels(ctx);
    out.push({ name, ret: norm(ret, map), snap: norm(await snapshot(ctx), map) });
  }
  return out;
}

// ฉากเพิ่ม (ฐานใหม่อีกก้อน): งานหน้าร้านทุกฟังก์ชันที่ fix-08 สร้างใหม่ + เส้นทางของ channel_order_apply ที่ฉากหลักไม่ผ่าน
//   (มีแต่บรรทัดที่จับคู่ไม่ได้ = ไม่ล็อกอะไร, หมดอายุก่อน/หลังส่งของ, คืนสต๊อกอัตโนมัติ, ยกเว้นส่วนที่ขาด,
//    บิลมีอยู่แต่ออเดอร์ไม่ได้จำ sale_id ไว้ + ย้ายรายการ (ต้องล็อกสินค้าในบิลเดิมผ่านเลขออเดอร์), โหมดทดลอง → เริ่มตัดสต๊อก,
//    ยกเลิกออเดอร์ที่ไม่มีในระบบ, สถานะที่ไม่รู้จัก)
async function runExtraScenario(ctx) {
  const { admin, cashier, cid } = await seed(ctx);
  const rco = (o) => ctx.service.rpc('record_channel_order', { p_channel_id: cid, p_order: o, p_source: 'webhook' });
  const orderId = async (ext) => (await ctx.pg.one(`select id from public.channel_orders where external_order_id = $1`, [ext])).id;
  const saleIdOf = async (n) => (await ctx.pg.one(`select id from public.sales where client_id = $1`, [clientId(n)])).id;
  const listingOf = async (sku) => (await ctx.pg.one(`select id from public.channel_listings where external_sku_id = $1`, [sku])).id;
  const unmapped = { line_key: 'X', sku_id: 'SKU-NONE', item_id: 'ITEM-NONE', sku: 'NOPE-1', name: 'ไม่มีในร้าน', qty: 1, unit_price: 55 };

  const steps = [
    ['ขายหน้าร้าน 3 สินค้า (LK-3, LK-1, LK-2)', () => cashier.rpc('record_sale', {
      p_client_id: clientId(3), p_items: [{ product_id: pid(3), qty: 2 }, { product_id: pid(1), qty: 2 }, { product_id: pid(2), qty: 1 }],
      p_discount: 20, p_payment_method: 'cash', p_note: null, p_channel: 'store', p_cash_received: 2000 })],
    ['ขายหน้าร้านอีกบิล (LK-5, LK-2)', () => cashier.rpc('record_sale', {
      p_client_id: clientId(4), p_items: [{ product_id: pid(5), qty: 1 }, { product_id: pid(2), qty: 2 }],
      p_discount: 0, p_payment_method: 'transfer', p_note: 'บิลที่จะยกเลิก', p_channel: 'store', p_cash_received: null })],
    ['ยกเลิกบิลหน้าร้าน (คืนสต๊อก LK-5, LK-2)', async () => admin.rpc('void_sale', {
      p_sale_id: await saleIdOf(4), p_reason: 'ลูกค้าเปลี่ยนใจ' })],
    ['ยกเลิกบิลเดิมซ้ำ (ไม่คืนสต๊อกซ้ำ)', async () => admin.rpc('void_sale', {
      p_sale_id: await saleIdOf(4), p_reason: 'กดซ้ำ' })],
    ['คืนสินค้าบางส่วน (LK-1 คืนสต๊อก)', async () => admin.rpc('return_sale_items', {
      p_client_id: clientId(5), p_sale_id: await saleIdOf(3), p_items: [{ product_id: pid(1), qty: 1 }],
      p_reason: 'ไซส์ไม่พอดี', p_refund_method: 'cash', p_restock: true })],
    ['คืนของมีตำหนิ (LK-3 + LK-2 ไม่คืนสต๊อก)', async () => admin.rpc('return_sale_items', {
      p_client_id: clientId(6), p_sale_id: await saleIdOf(3), p_items: [{ product_id: pid(3), qty: 1 }, { product_id: pid(2), qty: 1 }],
      p_reason: 'ของมีตำหนิ', p_refund_method: 'transfer', p_restock: false })],
    ['ตรวจนับ LK-5, LK-2 แล้วปรับยอด', async () => {
      const sc = await admin.rpc('create_stock_count', { p_client_id: clientId(7), p_name: 'นับกลางวัน' });
      const a = await admin.rpc('set_stock_count_item', { p_count_id: sc.id, p_product_id: pid(5), p_qty: 7 });
      const b = await admin.rpc('set_stock_count_item', { p_count_id: sc.id, p_product_id: pid(2), p_qty: 12 });
      return { create: sc, a, b, apply: await admin.rpc('apply_stock_count', { p_count_id: sc.id }) };
    }],
    ['รับเข้า / จ่ายออก / ปรับยอด LK-6', async () => [
      await cashier.rpc('move_stock', { p_product_id: pid(6), p_type: 'in', p_qty: 3, p_note: 'รับของเข้า' }),
      await cashier.rpc('move_stock', { p_product_id: pid(6), p_type: 'out', p_qty: 1, p_note: 'ของแถม' }),
      await cashier.rpc('move_stock', { p_product_id: pid(6), p_type: 'adjust', p_qty: 9, p_note: 'นับใหม่' }),
    ]],
    ['ORD-U1 มีแต่บรรทัดที่จับคู่ไม่ได้', () => rco(order('ORD-U1', 'paid', 10, [unmapped]))],
    ['ORD-E1 หมดอายุก่อนส่งของ (ไม่มีบิล)', () => rco(order('ORD-E1', 'expired', 11, [line('A', 1, 1)]))],
    ['ORD-E2 ส่งของแล้ว → หมดอายุหลังส่งของ', async () => ({
      shipped: await rco(order('ORD-E2', 'shipped', 12, [line('A', 2, 2)], { shipped_at: ts(12) })),
      expired: await rco(order('ORD-E2', 'expired', 13, [line('A', 2, 2)], { shipped_at: ts(12), was_shipped: true })),
    })],
    ['ตั้งคืนสต๊อกอัตโนมัติ + ORD-E2 คืนของถึงร้าน', async () => ({
      options: await admin.rpc('save_channel_options', { p_channel_id: cid, p_options: { restock_returns: 'auto' } }),
      returned: await rco(order('ORD-E2', 'returned', 14, [line('A', 2, 2, { qty_returned: 2 })],
        { shipped_at: ts(12), was_shipped: true })),
    })],
    ['ORD-W1 ขายเกิน LK-4 แล้วยกเว้นส่วนที่ขาด', async () => ({
      record: await rco(order('ORD-W1', 'paid', 15, [line('A', 4, 3), line('B', 1, 1)])),
      waive: await admin.rpc('resolve_channel_order', { p_order_id: await orderId('ORD-W1'), p_action: 'waive_owed' }),
    })],
    // บิลมี LK-1 + LK-4 (ขายเกิน) → ล้าง sale_id ของออเดอร์ → ย้าย SKU-P4 ไป LK-6 แล้วประมวลผลใหม่:
    //   LK-4 อยู่ในบิลเดิมเท่านั้น (ไม่อยู่ในบรรทัดแล้ว) และหาบิลได้ทางเลขออเดอร์อย่างเดียว → ต้องถูกล็อกก่อนลบรายการในบิล
    ['ORD-C1 บิลมีอยู่แต่ออเดอร์ไม่ได้จำ sale_id + ย้ายรายการ SKU-P4 ไป LK-6 + ประมวลผลใหม่', async () => {
      const first = await rco(order('ORD-C1', 'paid', 16, [line('A', 1, 1), line('B', 4, 2)]));
      await ctx.pg.query(`update public.channel_orders set sale_id = null where external_order_id = 'ORD-C1'`);
      const m = await admin.rpc('set_listing_mapping', { p_listing_id: await listingOf('SKU-P4'), p_product_id: pid(6), p_ignore: false });
      // affected_order_ids เรียงตาม id สุ่ม (jsonb_agg distinct) → เทียบเป็นเลขออเดอร์เรียงแล้วแทน
      const affected = (await ctx.pg.one(`select coalesce(jsonb_agg(o.external_order_id order by o.external_order_id), '[]'::jsonb) as a
                                            from public.channel_orders as o
                                           where o.id::text in (select jsonb_array_elements_text($1::jsonb))`,
        [JSON.stringify(m.affected_order_ids)])).a;
      const r = await admin.rpc('resolve_channel_order', { p_order_id: await orderId('ORD-C1'), p_action: 'reprocess' });
      return { first, mapping: { ...m, affected_order_ids: affected }, resolve: r };
    }],
    ['ORD-C1 ส่งซ้ำเปลี่ยนจำนวน', () => rco(order('ORD-C1', 'paid', 17,
      [line('A', 1, 2), line('B', 4, 2, { qty_cancelled: 1 })]))],
    ['ORD-SH1 โหมดทดลอง แล้วเริ่มตัดสต๊อก', async () => {
      await admin.rpc('save_channel_options', { p_channel_id: cid, p_options: { shadow_mode: true } });
      const shadow = await rco(order('ORD-SH1', 'paid', 18, [line('A', 5, 1), line('B', 1, 1)]));
      await admin.rpc('save_channel_options', { p_channel_id: cid, p_options: { shadow_mode: false } });
      return { shadow, track: await admin.rpc('resolve_channel_order', { p_order_id: await orderId('ORD-SH1'), p_action: 'track_stock' }) };
    }],
    ['ยกเลิกออเดอร์ที่ไม่มีในระบบ', () => ctx.service.rpc('cancel_channel_order', {
      p_channel_id: cid, p_external_order_id: 'ORD-NONE', p_status: 'cancelled', p_raw_status: null,
      p_was_shipped: null, p_updated_at: null })],
    ['ORD-K1 สถานะที่ไม่รู้จัก', () => rco(order('ORD-K1', 'unknown', 19, [line('A', 1, 1)]))],
  ];
  return runSteps(ctx, steps);
}

// id → ชื่อที่เหมือนกันทั้งสองฐาน (สินค้า = SKU, บิล = เลขบิล, ออเดอร์ = เลขออเดอร์ ...)
async function labels(ctx) {
  const rows = await ctx.pg.all(`
    select p.id::text as id, 'P:' || p.sku as label from public.products as p
    union all select g.id::text, 'G:' || g.name from public.product_groups as g
    union all select u.id::text, 'U:' || u.email from auth.users as u
    union all select c.id::text, 'C:' || c.display_name from public.integration_channels as c
    union all select o.id::text, 'O:' || o.external_order_id from public.channel_orders as o
    union all select l.id::text, 'L:' || o.external_order_id || '/' || l.line_key
                from public.channel_order_lines as l join public.channel_orders as o on o.id = l.order_id
    union all select cl.id::text, 'LS:' || cl.external_sku_id from public.channel_listings as cl
    union all select s.id::text, 'S:' || s.sale_no from public.sales as s
    union all select si.id::text, 'SI:' || s.sale_no || '/' || p.sku
                from public.sale_items as si join public.sales as s on s.id = si.sale_id
                join public.products as p on p.id = si.product_id
    union all select m.id::text, 'M:' || p.sku || '/' || m.qty_before || '>' || m.qty_after
                from public.stock_movements as m join public.products as p on p.id = m.product_id
    union all select r.id::text, 'R:' || r.return_no from public.sale_returns as r
    union all select ri.id::text, 'RI:' || r.return_no || '/' || p.sku
                from public.sale_return_items as ri join public.sale_returns as r on r.id = ri.return_id
                join public.products as p on p.id = ri.product_id
    union all select sc.id::text, 'SC:' || sc.name from public.stock_counts as sc`);
  return new Map(rows.map((r) => [r.id, r.label]));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TS_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
function norm(v, map) {
  if (Array.isArray(v)) return v.map((x) => norm(x, map));
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = {};
    for (const k of Object.keys(v)) o[k] = norm(v[k], map);
    return o;
  }
  if (v instanceof Date) return 'TS';
  if (typeof v === 'string') {
    if (UUID_RE.test(v)) return map.get(v.toLowerCase()) ?? 'UUID?';
    if (TS_RE.test(v)) return 'TS';
  }
  return v;
}

// สถานะทุกตารางที่ออเดอร์/บิล/สต๊อกแตะ (ไม่เอา id สุ่ม/เวลา — ใช้ SKU/เลขบิล/เลขออเดอร์แทน)
async function snapshot(ctx) {
  const r = await ctx.pg.one(`
    select jsonb_build_object(
      'products', (select jsonb_agg(jsonb_build_array(p.sku, p.stock_qty, p.is_active) order by p.sku)
                     from public.products as p),
      'sales', (select jsonb_agg(jsonb_build_array(s.sale_no, s.channel, s.payment_method, s.total_amount, s.discount,
                                                   s.net_amount, s.note, s.external_order_id, s.voided_at is not null,
                                                   s.cash_received, s.change_amount, s.refunded_amount, s.created_by_name,
                                                   s.created_by::text, s.client_id::text) order by s.sale_no)
                  from public.sales as s),
      'sale_items', (select jsonb_agg(jsonb_build_array(s.sale_no, p.sku, si.qty, si.unit_price, si.unit_cost, si.subtotal)
                                      order by s.sale_no, p.sku)
                       from public.sale_items as si
                       join public.sales as s on s.id = si.sale_id
                       join public.products as p on p.id = si.product_id),
      'stock_movements', (select jsonb_agg(jsonb_build_array(p.sku, m.type, m.qty, m.qty_before, m.qty_after, m.note,
                                                             coalesce('S:' || s.sale_no, 'O:' || o.external_order_id, m.ref_id::text),
                                                             m.created_by::text)
                                           order by p.sku, m.qty_before, m.qty_after, m.type, m.note)
                            from public.stock_movements as m
                            join public.products as p on p.id = m.product_id
                            left join public.sales as s on s.id = m.ref_id
                            left join public.channel_orders as o on o.id = m.ref_id),
      'orders', (select jsonb_agg(jsonb_build_array(o.external_order_id, o.status, o.raw_status, o.stock_tracking, s.sale_no,
                                                    o.stock_applied, o.has_oversold, o.has_unmapped, o.attention_reasons,
                                                    o.dismissed_reasons, o.needs_attention, o.shipped_at is not null,
                                                    o.resolved_at is not null, o.last_source, o.items_total)
                                 order by o.external_order_id)
                   from public.channel_orders as o left join public.sales as s on s.id = o.sale_id),
      'lines', (select jsonb_agg(jsonb_build_array(o.external_order_id, l.line_key, p.sku, cl.external_sku_id, l.qty,
                                                   l.qty_cancelled, l.platform_qty_returned, l.qty_returned_received,
                                                   l.qty_waived, l.qty_deducted, l.qty_restocked, l.qty_oversold, l.unit_price)
                                order by o.external_order_id, l.line_key)
                  from public.channel_order_lines as l
                  join public.channel_orders as o on o.id = l.order_id
                  left join public.products as p on p.id = l.product_id
                  left join public.channel_listings as cl on cl.id = l.listing_id),
      'listings', (select jsonb_agg(jsonb_build_array(cl.external_sku_id, p.sku, cl.mapping_status, cl.match_source,
                                                      cl.push_enabled) order by cl.external_sku_id)
                     from public.channel_listings as cl left join public.products as p on p.id = cl.product_id),
      'outbox', (select jsonb_agg(jsonb_build_array(p.sku, x.reason, x.status) order by x.id)
                   from public.stock_sync_outbox as x join public.products as p on p.id = x.product_id),
      'returns', (select jsonb_agg(jsonb_build_array(r.return_no, s.sale_no, r.refund_amount, r.refund_method, r.restock,
                                                     r.reason, r.created_by_name) order by r.return_no)
                    from public.sale_returns as r join public.sales as s on s.id = r.sale_id),
      'return_items', (select jsonb_agg(jsonb_build_array(r.return_no, p.sku, ri.qty, ri.unit_price, ri.unit_cost,
                                                          ri.refund_amount) order by r.return_no, p.sku)
                         from public.sale_return_items as ri
                         join public.sale_returns as r on r.id = ri.return_id
                         join public.products as p on p.id = ri.product_id),
      'counts', (select jsonb_agg(jsonb_build_array(sc.name, sc.status, sc.summary, sc.applied_by_name) order by sc.name)
                   from public.stock_counts as sc),
      'count_items', (select jsonb_agg(jsonb_build_array(sc.name, p.sku, ci.counted_qty, ci.system_qty_at_count,
                                                         ci.applied_before, ci.applied_after) order by sc.name, p.sku)
                        from public.stock_count_items as ci
                        join public.stock_counts as sc on sc.id = ci.count_id
                        join public.products as p on p.id = ci.product_id),
      'sale_counters', (select jsonb_agg(c.n order by c.day) from public.sale_counters as c),
      'sync_log', (select jsonb_agg(jsonb_build_array(g.kind, g.ok, g.summary, g.detail, g.actor::text) order by g.id)
                     from public.integration_sync_log as g)
    ) as snap`);
  return r.snap;
}

const stockOf = (snap, sku) => snap.products.find((p) => p[0] === sku)[1];
const orderOf = (snap, ext) => snap.orders.find((o) => o[0] === ext);
const itemsOf = (snap, saleNo) => snap.sale_items.filter((i) => i[0] === saleNo).map((i) => [i[1], i[2]]);

// ----- ตัวตรวจลำดับการล็อก (pageinspect): แถวสินค้าถูกรายการตัวเองล็อกแบบไหนอยู่ ณ ตอนนี้ -----
//   t_infomask: 0x0080 = ล็อกอย่างเดียว (ไม่ใช่การแก้แถว), 0x1000 = หลายรายการถือร่วมกัน (multixact),
//               0x0040 = exclusive, 0x0010 = key share (ทั้งสอง = share) ; t_infomask2 0x2000 = for update (แตะคีย์)
const PROBE_SQL = `
create extension if not exists pageinspect;
create table public.zz_lock_probe (
  seq bigserial primary key,
  at text not null,
  op text not null,
  product_id uuid,
  sale_no_set boolean,
  mode text not null,
  xid text,
  fn text
);
create or replace function public.zz_lock_mode(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_ctid text;
  r record;
  v_me text;
begin
  select trim(both '()' from p.ctid::text) into v_ctid from public.products as p where p.id = p_id;
  if v_ctid is null then
    return 'missing';
  end if;
  select h.t_xmax::text as xmax, h.t_infomask as im, h.t_infomask2 as im2 into r
    from heap_page_items(get_raw_page('public.products', split_part(v_ctid, ',', 1)::integer)) as h
   where h.lp = split_part(v_ctid, ',', 2)::integer;
  v_me := (pg_current_xact_id()::text::bigint % 4294967296)::text;
  if r.xmax is distinct from v_me or (r.im & 128) = 0 or (r.im & 4096) <> 0 then
    return 'none';
  end if;
  return case r.im & 80
           when 64 then case when (r.im2 & 8192) <> 0 then 'update' else 'no_key_update' end
           when 80 then 'share'
           when 16 then 'key_share'
           else 'other'
         end;
end;
$f$;
create or replace function public.zz_probe_sales()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  if new.channel_id is not null then
    insert into public.zz_lock_probe (at, op, product_id, sale_no_set, mode)
    select 'sales', tg_op, x.pid, tg_op = 'INSERT' and new.sale_no is not null, public.zz_lock_mode(x.pid)
      from (select distinct l.product_id as pid
              from public.channel_order_lines as l
              join public.channel_orders as o on o.id = l.order_id
             where o.channel_id = new.channel_id and o.external_order_id = new.external_order_id
               and l.product_id is not null) as x;
  end if;
  return new;
end;
$f$;
create trigger a_zz_lock_probe before insert or update on public.sales
  for each row execute function public.zz_probe_sales();
create or replace function public.zz_probe_sale_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_sale uuid := case when tg_op = 'DELETE' then old.sale_id else new.sale_id end;
  v_pid uuid := case when tg_op = 'DELETE' then old.product_id else new.product_id end;
begin
  if exists (select 1 from public.sales as s where s.id = v_sale and s.channel_id is not null) then
    insert into public.zz_lock_probe (at, op, product_id, sale_no_set, mode)
    values ('sale_items', tg_op, v_pid, null, public.zz_lock_mode(v_pid));
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$f$;
create trigger a_zz_lock_probe before insert or update or delete on public.sale_items
  for each row execute function public.zz_probe_sale_items();
-- ทุกครั้งที่แก้สต๊อก (ทุกฟังก์ชัน): แถวสินค้าที่กำลังจะถูกแก้ถูกรายการตัวเองล็อกไว้แบบไหน + ฟังก์ชันที่ผู้ใช้เรียก
--   (แก้แถวเดิมซ้ำในรายการเดียวกัน แถวใหม่จะเหลือแค่ key share ที่ส่งต่อมา — ตัวทดสอบดูเฉพาะครั้งแรกของแต่ละรายการ)
create or replace function public.zz_probe_products()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  insert into public.zz_lock_probe (at, op, product_id, sale_no_set, mode, xid, fn)
  values ('products', tg_op, old.id, null, public.zz_lock_mode(old.id), pg_current_xact_id()::text,
          coalesce(substring(current_query() from 'public\\.([a-z_]+)\\('), '?'));
  return new;
end;
$f$;
create trigger a_zz_lock_probe before update of stock_qty on public.products
  for each row execute function public.zz_probe_products();
`;
const EXCLUSIVE = new Set(['no_key_update', 'update']);

async function probeRows(ctx) {
  return ctx.pg.all(`select z.at, z.op, p.sku, z.mode, z.sale_no_set
                       from public.zz_lock_probe as z left join public.products as p on p.id = z.product_id
                      where z.at in ('sales', 'sale_items')
                      order by z.seq`);
}
// การแก้สต๊อกครั้งแรกของสินค้าแต่ละตัวในแต่ละรายการ → [{ fn, sku, mode }]
async function stockProbeRows(ctx) {
  return ctx.pg.all(`select distinct on (z.xid, z.product_id) z.fn, p.sku, z.mode
                       from public.zz_lock_probe as z join public.products as p on p.id = z.product_id
                      where z.at = 'products'
                      order by z.xid, z.product_id, z.seq`);
}
// ฟังก์ชันที่ผู้ใช้/worker เรียกแล้วไปแก้สต๊อก (ตรงๆ หรือผ่าน channel_order_apply)
const STOCK_FNS = ['record_sale', 'void_sale', 'return_sale_items', 'apply_stock_count', 'move_stock',
  'record_channel_order', 'cancel_channel_order', 'resolve_channel_order', 'confirm_return_restock'];
const POS_FNS = ['record_sale', 'void_sale', 'return_sale_items', 'apply_stock_count', 'move_stock'];

// ตารางสรุปท้าย fix-08 (คำสั่งสุดท้ายของไฟล์ — อ่านอย่างเดียว) → { รายการ: ค่า }
function summaryOf(results) {
  const rows = results[results.length - 1].rows;
  return Object.fromEntries(rows.map((r) => [r['รายการ'], r['ค่า']]));
}
async function runSummaryOnly(ctx) {
  const text = await readFile(path.join(SQL_DIR, FIX08), 'utf8');
  return summaryOf(await ctx.db.exec(text.slice(text.lastIndexOf('commit;') + 'commit;'.length)));
}
const ALL_OK = {
  'channel_order_apply มีแบบเดียว': 'ถูกต้อง',
  'ล็อกสินค้าก่อนเขียนบิล/รายการในบิล (เรียงตาม id)': 'ถูกต้อง',
  'channel_order_apply เรียกตรงไม่ได้ (public / anon / authenticated / service_role)': 'ถูกต้อง',
  'channel_order_apply เป็น security definer + search_path = public': 'ถูกต้อง',
  'ฟังก์ชันที่เรียก channel_order_apply ยังอยู่ครบ 4 ตัว': 'ถูกต้อง',
  'ขาย/ยกเลิกบิล/คืนสินค้า/ปรับยอดตรวจนับ/รับ-จ่ายสต๊อก ล็อกสินค้าแบบ no key update': 'ถูกต้อง',
  'ฟังก์ชันในแถว 6 เป็น security definer + search_path = public, ผู้ล็อกอินเรียกได้, anon เรียกไม่ได้': 'ถูกต้อง',
};
const ROW_APPLY_LOCK = 'ล็อกสินค้าก่อนเขียนบิล/รายการในบิล (เรียงตาม id)';
const ROW_CALLERS = 'ฟังก์ชันที่เรียก channel_order_apply ยังอยู่ครบ 4 ตัว';
const ROW_POS_LOCK = 'ขาย/ยกเลิกบิล/คืนสินค้า/ปรับยอดตรวจนับ/รับ-จ่ายสต๊อก ล็อกสินค้าแบบ no key update';
const ROW_POS_ACL = 'ฟังก์ชันในแถว 6 เป็น security definer + search_path = public, ผู้ล็อกอินเรียกได้, anon เรียกไม่ได้';

// เนื้อฟังก์ชันจากไฟล์ต้นฉบับ (แบบก่อน fix-08) — จำลองการรันไฟล์นั้นซ้ำหลัง fix-08
async function originalFnSql(file, name) {
  const text = await readFile(path.join(REPO, file), 'utf8');
  const head = `create or replace function public.${name}(`;
  const start = text.lastIndexOf(head);
  const end = text.indexOf('\n$$;', start);
  ok(start >= 0 && end > start, `หา ${name} ใน ${file} ไม่เจอ`);
  return text.slice(start, end + 4);
}

// เนื้อ channel_order_apply ของ fix-03 (แบบเดิม) — จำลองการรัน fix-03 ซ้ำหลัง fix-08
async function oldApplySql() {
  const text = await readFile(path.join(REPO, FIX03), 'utf8');
  const start = text.indexOf('create or replace function public.channel_order_apply(');
  const end = text.indexOf('\n$$;', start);
  ok(start > 0 && end > start, 'หา channel_order_apply ใน fix-03 ไม่เจอ');
  return text.slice(start, end + 4);
}

export function register(test) {
  test('(ก) ผลเหมือนเดิมทุกขั้น: บิล/รายการในบิล/ประวัติสต๊อก/สต๊อก/ออเดอร์/คิวส่งสต๊อก/บันทึก + ค่าที่คืน (ฐานเดิม vs fix-08)', async () => {
    const before = await createDb({ upTo: FIX07 });
    const after = await createDb();
    try {
      const a = await runScenario(before);
      const b = await runScenario(after);
      eq(b.length, a.length, 'จำนวนขั้น');
      for (let i = 0; i < a.length; i += 1) {
        eq(b[i].ret, a[i].ret, `ค่าที่คืน ขั้น "${a[i].name}"`);
        eq(b[i].snap, a[i].snap, `สถานะ ขั้น "${a[i].name}"`);
      }

      // ฉากทดสอบทำงานตามที่ตั้งใจจริง (ไม่ใช่เทียบความว่างเปล่ากัน)
      const s = Object.fromEntries(b.map((x) => [x.name, x.snap]));
      const s2 = s['ORD-1 ใหม่ จ่ายแล้ว 3 สินค้า (บิลแรก)'];
      const bill1 = orderOf(s2, 'ORD-1')[4];
      ok(bill1, 'ORD-1 ไม่มีบิล');
      eq(itemsOf(s2, bill1), [['LK-1', 1], ['LK-2', 3], ['LK-3', 2]], 'รายการในบิล ORD-1');
      eq([stockOf(s2, 'LK-1'), stockOf(s2, 'LK-2'), stockOf(s2, 'LK-3')], [7, 6, 8], 'สต๊อกหลัง ORD-1');
      eq(s['ORD-1 ส่งซ้ำเหมือนเดิม'], s2, 'ส่งซ้ำต้องไม่เปลี่ยนอะไร');
      eq(b[2].ret.deducted, 0, 'ส่งซ้ำไม่ตัดสต๊อก');
      eq(b[2].ret.restocked, 0, 'ส่งซ้ำไม่คืนสต๊อก');
      const s4 = s['ORD-1 เปลี่ยนจำนวน (เพิ่ม LK-1, ยกเลิก LK-2 1 ชิ้น)'];
      eq(itemsOf(s4, bill1), [['LK-1', 2], ['LK-2', 2], ['LK-3', 2]], 'รายการในบิลหลังเปลี่ยนจำนวน');
      eq([stockOf(s4, 'LK-1'), stockOf(s4, 'LK-2')], [6, 7], 'สต๊อกหลังเปลี่ยนจำนวน');
      const s5 = s['ORD-2 ขายเกิน LK-4 (สต๊อก 0) + LK-5'];
      eq(orderOf(s5, 'ORD-2')[6], true, 'ORD-2 ขายเกิน');
      const s6 = s['ย้ายรายการ SKU-P4 ไป LK-6 แล้วประมวลผล ORD-2 ใหม่'];
      const bill2 = orderOf(s6, 'ORD-2')[4];
      eq(itemsOf(s6, bill2), [['LK-5', 1], ['LK-6', 2]], 'บิล ORD-2 หลังย้ายรายการ (LK-4 ออก LK-6 เข้า)');
      eq([stockOf(s6, 'LK-4'), stockOf(s6, 'LK-6'), orderOf(s6, 'ORD-2')[6]], [0, 8, false], 'ย้ายรายการแล้วตัดสต๊อก LK-6');
      const s7 = s['ORD-3 มีบรรทัดที่จับคู่ไม่ได้'];
      eq([orderOf(s7, 'ORD-3')[7], itemsOf(s7, orderOf(s7, 'ORD-3')[4])], [true, [['LK-5', 1]]], 'ORD-3 บรรทัดที่จับคู่ไม่ได้');
      eq(orderOf(s['ORD-4 ยังไม่จ่าย (ตัดเมื่อจ่ายแล้ว) — ไม่มีบิล'], 'ORD-4')[4], null, 'ORD-4 ยังไม่จ่ายต้องไม่มีบิล');
      const s9 = s['ORD-4 จ่ายแล้ว — บิลแรกตอนอัปเดตออเดอร์เดิม'];
      eq(itemsOf(s9, orderOf(s9, 'ORD-4')[4]), [['LK-1', 1], ['LK-3', 1]], 'บิล ORD-4');
      const s10 = s['ยกเลิก ORD-1 ก่อนส่งของ — ยกเลิกบิล + คืนสต๊อก'];
      ok(s10.sales.find((x) => x[0] === bill1)[8] === true, 'บิล ORD-1 ต้องถูกยกเลิก');
      eq([stockOf(s10, 'LK-1'), stockOf(s10, 'LK-2'), stockOf(s10, 'LK-3')], [7, 9, 9], 'คืนสต๊อกหลังยกเลิก ORD-1');
      const fin = b[b.length - 1].snap;
      eq(fin.products.map((p) => [p[0], p[1]]),
        [['LK-1', 6], ['LK-2', 8], ['LK-3', 8], ['LK-4', 0], ['LK-5', 8], ['LK-6', 7]], 'สต๊อกสุดท้าย');
      ok(fin.outbox.some((x) => x[1] === 'stock_change' && x[2] === 'pending'), 'ต้องมีงานส่งสต๊อกใหม่จากการแก้สต๊อก');
    } finally {
      await before.db.close();
      await after.db.close();
    }
  });

  test('(ก) ฉากเพิ่มผลเหมือนเดิมทุกขั้น: ยกเลิกบิล/คืนสินค้า/ตรวจนับ/รับ-จ่ายสต๊อก + เส้นทางอื่นของออเดอร์ (ฐานเดิม vs fix-08)', async () => {
    const before = await createDb({ upTo: FIX07 });
    const after = await createDb();
    try {
      const a = await runExtraScenario(before);
      const b = await runExtraScenario(after);
      eq(b.length, a.length, 'จำนวนขั้น');
      for (let i = 0; i < a.length; i += 1) {
        eq(b[i].ret, a[i].ret, `ค่าที่คืน ขั้น "${a[i].name}"`);
        eq(b[i].snap, a[i].snap, `สถานะ ขั้น "${a[i].name}"`);
      }

      // ฉากทำงานตามที่ตั้งใจจริง
      const s = Object.fromEntries(b.map((x) => [x.name, x.snap]));
      const r = Object.fromEntries(b.map((x) => [x.name, x.ret]));
      const fin = b[b.length - 1].snap;
      const saleOf = (snap, no) => snap.sales.find((x) => x[0] === no);
      const billA = b[0].ret.sale_no;
      const billB = b[1].ret.sale_no;
      ok(billA && billB && billA !== billB, 'บิลหน้าร้าน 2 ใบ');
      const sVoid = s['ยกเลิกบิลหน้าร้าน (คืนสต๊อก LK-5, LK-2)'];
      eq([saleOf(sVoid, billB)[8], stockOf(sVoid, 'LK-5'), stockOf(sVoid, 'LK-2')], [true, 10, 9], 'ยกเลิกบิลแล้วคืนสต๊อก');
      eq(r['ยกเลิกบิลเดิมซ้ำ (ไม่คืนสต๊อกซ้ำ)'].already_voided, true, 'ยกเลิกซ้ำ = บิลเดิม');
      eq(s['ยกเลิกบิลเดิมซ้ำ (ไม่คืนสต๊อกซ้ำ)'].products, sVoid.products, 'ยกเลิกซ้ำต้องไม่คืนสต๊อกซ้ำ');
      eq(stockOf(s['คืนสินค้าบางส่วน (LK-1 คืนสต๊อก)'], 'LK-1'), 9, 'คืนสินค้าแล้วคืนสต๊อก');
      const sBad = s['คืนของมีตำหนิ (LK-3 + LK-2 ไม่คืนสต๊อก)'];
      eq([stockOf(sBad, 'LK-3'), stockOf(sBad, 'LK-2')], [8, 9], 'คืนของมีตำหนิไม่คืนสต๊อก');
      eq(fin.returns.map((r) => [r[1], r[4]]), [[billA, true], [billA, false]], 'ใบคืนสินค้า 2 ใบ');
      const sCount = s['ตรวจนับ LK-5, LK-2 แล้วปรับยอด'];
      eq([sCount.counts[0][1], stockOf(sCount, 'LK-5'), stockOf(sCount, 'LK-2')], ['applied', 7, 12], 'ปรับยอดตรวจนับ');
      eq(stockOf(s['รับเข้า / จ่ายออก / ปรับยอด LK-6'], 'LK-6'), 9, 'รับเข้า 3 จ่ายออก 1 ปรับยอดเป็น 9');
      eq([orderOf(fin, 'ORD-U1')[4], orderOf(fin, 'ORD-U1')[7]], [null, true], 'ORD-U1 จับคู่ไม่ได้ทั้งออเดอร์ = ไม่มีบิล');
      eq(orderOf(fin, 'ORD-E1')[4], null, 'ORD-E1 หมดอายุก่อนส่งของ = ไม่มีบิล');
      const sExp = s['ORD-E2 ส่งของแล้ว → หมดอายุหลังส่งของ'];
      eq(stockOf(sExp, 'LK-2'), 10, 'หมดอายุหลังส่งของ = ยังไม่คืนสต๊อก');
      eq(stockOf(s['ตั้งคืนสต๊อกอัตโนมัติ + ORD-E2 คืนของถึงร้าน'], 'LK-2'), 12, 'คืนสต๊อกอัตโนมัติเมื่อของถึงร้าน');
      const sC1 = s['ORD-C1 บิลมีอยู่แต่ออเดอร์ไม่ได้จำ sale_id + ย้ายรายการ SKU-P4 ไป LK-6 + ประมวลผลใหม่'];
      const billC1 = orderOf(sC1, 'ORD-C1')[4];
      ok(billC1, 'ORD-C1 ต้องได้บิลเดิมกลับมา');
      eq(itemsOf(sC1, billC1), [['LK-1', 1], ['LK-6', 2]], 'บิล ORD-C1 หลังย้ายรายการ (LK-4 ออก LK-6 เข้า)');
      eq(sC1.sales.filter((x) => x[7] === 'ORD-C1').length, 1, 'ORD-C1 ต้องมีบิลเดียว');
      eq(itemsOf(fin, billC1), [['LK-1', 2], ['LK-6', 1]], 'บิล ORD-C1 หลังเปลี่ยนจำนวน');
      ok(orderOf(fin, 'ORD-SH1')[4], 'ORD-SH1 เริ่มตัดสต๊อกแล้วต้องมีบิล');
      eq(r['ยกเลิกออเดอร์ที่ไม่มีในระบบ'].found, false, 'ยกเลิกออเดอร์ที่ไม่มีในระบบ');
      eq(orderOf(fin, 'ORD-K1')[8], ['unknown_status'], 'ORD-K1 สถานะที่ไม่รู้จักรอแอดมินดู');
      eq(fin.products.map((p) => [p[0], p[1]]),
        [['LK-1', 5], ['LK-2', 12], ['LK-3', 8], ['LK-4', 0], ['LK-5', 6], ['LK-6', 8]], 'สต๊อกสุดท้าย');
    } finally {
      await before.db.close();
      await after.db.close();
    }
  });

  test('(ข) ลำดับการล็อกตอนรันจริง: ล็อกสินค้าก่อนสร้าง/แก้บิลและรายการในบิล + ล็อกแบบ no key update ก่อนแก้สต๊อกทุกฟังก์ชัน — ฐานเดิมถูกจับได้', async () => {
    const dbs = [];
    const open = async (opts) => {
      const c = await createDb({ ...opts, extensions: { pageinspect } });
      dbs.push(c);
      await c.db.exec(PROBE_SQL);
      return c;
    };
    try {
      const after = await open({});
      const afterX = await open({});
      const before = await open({ upTo: FIX07 });
      const beforeX = await open({ upTo: FIX07 });
      await runScenario(after);
      await runExtraScenario(afterX);
      await runScenario(before);
      await runExtraScenario(beforeX);
      const gotX = await probeRows(afterX);
      const got = [...await probeRows(after), ...gotX];
      const old = [...await probeRows(before), ...await probeRows(beforeX)];

      // ตัวตรวจใช้ได้จริง: SQL เดิม (fix-03) สร้างบิล/รายการในบิลก่อนล็อกสินค้า ต้องถูกจับได้
      ok(old.some((r) => r.at === 'sales' && r.op === 'INSERT' && !EXCLUSIVE.has(r.mode)),
        'ตัวตรวจไม่เห็นปัญหาของ SQL เดิม (สร้างบิลก่อนล็อกสินค้า) — ตัวตรวจใช้ไม่ได้');
      ok(old.some((r) => r.at === 'sale_items' && !EXCLUSIVE.has(r.mode)),
        'ตัวตรวจไม่เห็นปัญหาของ SQL เดิม (เขียนรายการในบิลก่อนล็อกสินค้า) — ตัวตรวจใช้ไม่ได้');

      // ครอบคลุมทุกจุดที่เขียนบิลของออเดอร์แพลตฟอร์ม
      for (const [at, op] of [['sales', 'INSERT'], ['sales', 'UPDATE'], ['sale_items', 'INSERT'],
        ['sale_items', 'UPDATE'], ['sale_items', 'DELETE']]) {
        ok(got.some((r) => r.at === at && r.op === op), `ฉากทดสอบไม่ผ่านจุด ${at} ${op}`);
      }
      eq(got.filter((r) => !EXCLUSIVE.has(r.mode)), [], 'แถวสินค้าที่ยังไม่ถูกล็อกตอนเขียนบิล/รายการในบิล');
      eq(got.filter((r) => r.op === 'INSERT' && r.at === 'sales' && r.sale_no_set !== false), [],
        'ตัวตรวจต้องทำงานก่อน trigger เลขบิล (ก่อนแตะ sale_counters)');
      ok(got.every((r) => r.mode === 'no_key_update'), 'ล็อกของ channel_order_apply ต้องเป็นแบบ no key update');
      // บิลที่ออเดอร์ไม่ได้จำ sale_id (หาเจอทางเลขออเดอร์เท่านั้น): สินค้าที่อยู่ในบิลเดิมแต่ไม่อยู่ในบรรทัดแล้วต้องถูกล็อกด้วย
      ok(gotX.some((r) => r.at === 'sale_items' && r.op === 'DELETE' && r.sku === 'LK-4'),
        'ฉากเพิ่มไม่ผ่านจุดลบรายการในบิลที่หาเจอทางเลขออเดอร์ (ORD-C1)');

      // ทุกครั้งที่แก้สต๊อก: แถวสินค้าถูกล็อกไว้ก่อนแบบ no key update (ไม่ใช่ for update ที่ชนกับ key share ของบรรทัดออเดอร์)
      const stock = [...await stockProbeRows(after), ...await stockProbeRows(afterX)];
      const stockOld = [...await stockProbeRows(before), ...await stockProbeRows(beforeX)];
      for (const fn of STOCK_FNS) {
        ok(stock.some((r) => r.fn === fn), `ฉากทดสอบไม่ผ่านการแก้สต๊อกของ ${fn}`);
        ok(stockOld.some((r) => r.fn === fn && r.mode === 'update'),
          `ตัวตรวจไม่เห็นล็อกแบบ for update ของ ${fn} ในฐานเดิม — ตัวตรวจใช้ไม่ได้`);
      }
      eq(stock.filter((r) => r.mode !== 'no_key_update'), [], 'การแก้สต๊อกที่แถวสินค้าไม่ได้ล็อกไว้ก่อนแบบ no key update');
    } finally {
      for (const c of dbs) await c.db.close();
    }
  });

  test('(ค) รัน fix-08 ซ้ำ 2 รอบได้: ตารางสรุปถูกต้องทุกข้อ ฟังก์ชันมีแบบเดียว สิทธิ์ไม่เปลี่ยน ออเดอร์ยังตัดสต๊อกได้', async () => {
    const ctx = await createDb();
    try {
      eq(summaryOf(ctx.loadResults[FIX08]), ALL_OK, 'ตารางสรุปตอนรันครั้งแรก');
      await loadSqlFile(ctx, FIX08);
      eq(summaryOf(await loadSqlFile(ctx, FIX08)), ALL_OK, 'ตารางสรุปตอนรันครั้งที่ 3');
      const f = await ctx.pg.all(`
        select has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
               has_function_privilege('service_role', p.oid, 'EXECUTE') as svc,
               p.prosecdef as secdef, p.proconfig as config,
               pg_get_function_result(p.oid) as result,
               pg_get_function_identity_arguments(p.oid) as args
          from pg_proc as p
         where p.pronamespace = 'public'::regnamespace and p.proname = 'channel_order_apply'`);
      eq(f, [{ anon: false, auth: false, svc: false, secdef: true, config: ['search_path=public'], result: 'jsonb',
               args: 'p_order_id uuid, p_actor uuid' }], 'channel_order_apply มีแบบเดียว + สิทธิ์/ชนิดเหมือนเดิม');
      // เรียกตรงไม่ได้แม้เป็นเซิร์ฟเวอร์ (ใช้ผ่าน record_channel_order ฯลฯ เท่านั้น)
      await expectErr(() => ctx.service.rpc('channel_order_apply', { p_order_id: ADMIN, p_actor: null }), 'permission denied',
        { code: '42501' });
      const steps = await runScenario(ctx);
      eq(steps[steps.length - 1].snap.products.map((p) => p[1]), [6, 8, 8, 0, 8, 7], 'สต๊อกสุดท้ายหลังรัน fix-08 ซ้ำ');
    } finally {
      await ctx.db.close();
    }
  });

  test('(ค) ฟังก์ชันหน้าร้านที่สร้างใหม่: เนื้อเหมือนต้นฉบับทุกตัวอักษรยกเว้นคำล็อก สิทธิ์/ชนิด/ตั้งค่าเหมือนเดิม (ฐานเดิม vs fix-08 รัน 2 รอบ)', async () => {
    const before = await createDb({ upTo: FIX07 });
    const after = await createDb();
    try {
      await loadSqlFile(after, FIX08);
      const q = `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args,
                        pg_get_function_result(p.oid) as result, p.prosrc as src, p.prosecdef as secdef,
                        p.proconfig as config, p.provolatile as volatile, p.proacl::text as acl,
                        has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
                        has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
                        has_function_privilege('service_role', p.oid, 'EXECUTE') as svc
                   from pg_proc as p
                  where p.pronamespace = 'public'::regnamespace and p.proname = any ($1::text[])
                  order by 1, 2`;
      const a = await before.pg.all(q, [POS_FNS]);
      const b = await after.pg.all(q, [POS_FNS]);
      eq(b.map((x) => x.name), [...POS_FNS].sort(), 'ฟังก์ชันละแบบเดียว');
      eq(b.map((x) => x.name), a.map((x) => x.name), 'ชื่อฟังก์ชัน');
      const lf = (s) => s.replace(/\r\n/g, '\n');
      for (let i = 0; i < a.length; i += 1) {
        const { src: sa, ...ma } = a[i];
        const { src: sb, ...mb } = b[i];
        eq(mb, ma, `${a[i].name}: สิทธิ์/ชนิด/ตั้งค่าต้องเหมือนเดิม`);
        eq(mb.anon, false, `${a[i].name}: anon ต้องเรียกไม่ได้`);
        eq(mb.auth, true, `${a[i].name}: ผู้ล็อกอินต้องเรียกได้`);
        const back = lf(sb).replace(/(order by p\.id|where p\.id = p_product_id)(\s+)for no key update;/g, '$1$2for update;');
        ok(back !== lf(sb), `${a[i].name}: ต้องมีจุดล็อกแบบ no key update`);
        eq(back, lf(sa), `${a[i].name}: เนื้อฟังก์ชันต้องเหมือนต้นฉบับทุกตัวอักษร ยกเว้นคำล็อกสินค้า`);
        eq((lf(sb).match(/for no key update;/g) ?? []).length, 1, `${a[i].name}: จุดล็อกสินค้าต้องมีจุดเดียว`);
      }
    } finally {
      await before.db.close();
      await after.db.close();
    }
  });

  test('(ค) ยังไม่ได้รัน fix-04 → fix-08 หยุดทันทีพร้อมข้อความไทย และไม่แก้ฟังก์ชัน', async () => {
    const ctx = await createDb({ upTo: FIX03 });
    try {
      const def = async () => (await ctx.pg.one(`select p.prosrc from pg_proc as p
                                                  where p.pronamespace = 'public'::regnamespace
                                                    and p.proname = 'channel_order_apply'`)).prosrc;
      const was = await def();
      await expectErr(() => loadSqlFile(ctx, FIX08), 'ต้องรัน supabase-fix-01.sql ถึง supabase-fix-04-pos.sql');
      eq(await def(), was, 'channel_order_apply ต้องเหมือนเดิม');
      ok(!was.includes('for no key update'), 'ฐานที่ยังไม่รัน fix-08 ต้องเป็นแบบเดิม');
    } finally {
      await ctx.db.close();
    }
  });

  test('(ค) ตารางสรุปจับได้: รัน fix-03 ซ้ำจนกลับเป็นแบบเดิม / สิทธิ์หลุด → รัน fix-08 ซ้ำแล้วถูกต้อง', async () => {
    const ctx = await createDb();
    try {
      await ctx.db.exec(await oldApplySql());
      await ctx.db.exec('grant execute on function public.channel_order_apply(uuid, uuid) to anon');
      const bad = await runSummaryOnly(ctx);
      eq(bad['ล็อกสินค้าก่อนเขียนบิล/รายการในบิล (เรียงตาม id)'], 'ยังเป็นแบบเดิม — รันไฟล์นี้ซ้ำ');
      eq(bad['channel_order_apply เรียกตรงไม่ได้ (public / anon / authenticated / service_role)'], 'ผิด — รันไฟล์นี้ซ้ำ');
      eq(bad['channel_order_apply มีแบบเดียว'], 'ถูกต้อง');
      eq(bad[ROW_POS_LOCK], 'ถูกต้อง', 'ฟังก์ชันหน้าร้านยังไม่ถูกแตะ');
      eq(summaryOf(await loadSqlFile(ctx, FIX08)), ALL_OK, 'รัน fix-08 ซ้ำแล้วต้องถูกต้องทุกข้อ');
    } finally {
      await ctx.db.close();
    }
  });

  test('(ค) ตารางสรุปจับได้: รัน fix-04 / fix-01 ซ้ำ (ฟังก์ชันหน้าร้านกลับเป็นแบบเดิม) / สิทธิ์หลุด / ฟังก์ชันหาย / มีหลายแบบ', async () => {
    const ctx = await createDb();
    try {
      // owner รัน fix-04 ซ้ำทั้งไฟล์ + move_stock ของ fix-01 กลับมา + มีคนเปิดสิทธิ์ anon ให้ void_sale
      await loadSqlFile(ctx, 'supabase-fix-04-pos.sql');
      await ctx.db.exec(await originalFnSql('supabase-fix-01.sql', 'move_stock'));
      await ctx.db.exec('grant execute on function public.void_sale(uuid, text) to anon');
      const bad = await runSummaryOnly(ctx);
      eq(bad[ROW_POS_LOCK],
        'ยังเป็นแบบเดิม (record_sale, void_sale, return_sale_items, apply_stock_count, move_stock) — รันไฟล์นี้ซ้ำ');
      eq(bad[ROW_POS_ACL], 'ผิด (void_sale) — รันไฟล์นี้ซ้ำ');
      eq(bad[ROW_APPLY_LOCK], 'ถูกต้อง', 'fix-04 ไม่ได้แตะ channel_order_apply');
      eq(summaryOf(await loadSqlFile(ctx, FIX08)), ALL_OK, 'รัน fix-08 ซ้ำแล้วต้องถูกต้องทุกข้อ');

      // channel_order_apply มี 2 แบบ
      await ctx.db.exec(`create function public.channel_order_apply(p uuid) returns jsonb language sql as $f$ select null::jsonb $f$`);
      const dup = await runSummaryOnly(ctx);
      eq(dup['channel_order_apply มีแบบเดียว'], 'มี 2 แบบ — ตรวจฐานข้อมูล');
      eq(dup[ROW_APPLY_LOCK], 'มีหลายแบบ — ดูแถว 1');
      await ctx.db.exec('drop function public.channel_order_apply(uuid)');

      // ฟังก์ชันที่เรียก channel_order_apply หาย / ฟังก์ชันหน้าร้านหาย
      await ctx.db.exec('drop function public.resolve_channel_order(uuid, text)');
      await ctx.db.exec('drop function public.move_stock(uuid, text, integer, text)');
      const gone = await runSummaryOnly(ctx);
      eq(gone[ROW_CALLERS], 'ขาด 1 ตัว — รัน supabase-fix-03-integrations.sql แล้วรันไฟล์นี้ซ้ำ');
      eq(gone[ROW_POS_LOCK], 'ไม่มีฟังก์ชัน move_stock — รัน supabase-fix-01.sql ถึง supabase-fix-04-pos.sql แล้วรันไฟล์นี้ซ้ำ');
      eq(gone[ROW_POS_ACL], 'ไม่มีฟังก์ชัน — ดูแถว 6');
    } finally {
      await ctx.db.close();
    }
  });

  test('(ฉ) รายการอื่นถือล็อกค้างจริง: งานหน้าร้าน (ขาย/ปรับยอดตรวจนับ/ยกเลิกบิล/คืนสินค้า/รับ-จ่ายสต๊อก) กับออเดอร์ที่บันทึกบรรทัดแล้ว ไม่รอกันเป็นวง — SQL เดิมรอ (ตัวตรวจจับได้)', async () => {
    const now = await runChild(['all'], { stuckMs: 20000 });
    const stuckAt = now.started.find((x) => !now.done.includes(x));
    eq(now.error, null, 'ตัวช่วยทดสอบพัง');
    eq(now.done, LEGS, `ค้างที่ขา ${stuckAt ?? '-'} (ต้องไม่รอรายการที่ถือล็อกค้างอยู่ = ขาของวง deadlock)`);
    ok(now.allDone, 'ตัวช่วยทดสอบไม่จบครบ');

    // ตัวตรวจใช้ได้จริง: SQL ก่อน fix-08 ต้องรอ (ค้าง) ทุกขา
    const old = await Promise.all(LEGS.map((leg) => runChild([leg, 'old'], { stuckMs: 3000 })));
    LEGS.forEach((leg, i) => {
      eq(old[i].error, null, `ตัวช่วยทดสอบพัง (SQL เดิม ขา ${leg})`);
      eq([old[i].started, old[i].done, old[i].killed], [[leg], [], true],
        `SQL เดิมไม่รอที่ขา ${leg} — ตัวตรวจใช้ไม่ได้`);
    });
  });
}

// ----- ตัวช่วยข้อ (ฉ): รัน tests/lib/lock-hold-child.mjs เป็นโปรเซสแยก -----
const CHILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib', 'lock-hold-child.mjs');
const LEGS = ['sale', 'count', 'void', 'return', 'move', 'order'];

// stuckMs = ขาใดเริ่มแล้วไม่จบภายในเวลานี้ = ค้าง (รอล็อกของรายการที่ค้างอยู่ ซึ่งไม่มีวันปล่อย) → ฆ่าโปรเซสทิ้ง
function runChild(args, { stuckMs, totalMs = 120000 }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CHILD, ...args], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const lines = [];
    let buf = '';
    let errText = '';
    let killed = false;
    let stuck = null;
    const kill = () => {
      if (!killed) {
        killed = true;
        child.kill();
      }
    };
    const total = setTimeout(kill, totalMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        const s = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!s) continue;
        lines.push(s);
        clearTimeout(stuck);
        if (s.startsWith('START ')) stuck = setTimeout(kill, stuckMs);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { errText += d; });
    child.on('close', () => {
      clearTimeout(total);
      clearTimeout(stuck);
      const allDone = lines.includes('ALL-DONE');
      const errLine = lines.find((s) => s.startsWith('ERROR '));
      resolve({
        started: lines.filter((s) => s.startsWith('START ')).map((s) => s.slice(6)),
        done: lines.filter((s) => s.startsWith('DONE ')).map((s) => s.slice(5)),
        allDone,
        killed,
        error: errLine ? errLine.slice(6) : !allDone && !killed && errText.trim() ? errText.trim().split('\n')[0] : null,
      });
    });
  });
}
