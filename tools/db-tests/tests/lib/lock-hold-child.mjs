// ตัวช่วยของ tests/80-pos-lock-order.mjs ข้อ (ฉ) — รันเป็นโปรเซสแยก (ตัวทดสอบหลักฆ่าทิ้งถ้าค้าง)
//   ฉากวน deadlock ระหว่าง "ออเดอร์แพลตฟอร์มที่บันทึกบรรทัดสินค้าแล้ว" กับงานหน้าร้าน ทีละขา:
//   อีกรายการที่ยังไม่ commit ถือล็อกไว้ (prepare transaction) แล้วเรียกฟังก์ชันจริงในชื่อผู้ใช้ (แบบ PostgREST)
//   SQL ที่ถูกต้อง = จบทันที / SQL ที่ยังวนได้ = ฟังก์ชันต้องรอรายการที่ค้างอยู่ → ค้างตลอด
//   (PGlite มีการเชื่อมต่อเดียว ไม่มีใครมาปล่อยล็อก และตั้ง lock_timeout ไม่ได้) → ตัวทดสอบหลักฆ่าโปรเซสเมื่อหมดเวลา
//   แล้วรายงานว่าค้างที่ขาไหน
//
//   ใช้: node lock-hold-child.mjs <ขา|all> [old]
//     ขา = sale | count | void | return | move | order (all = ทุกขาเรียงกันในฐานเดียว)
//     old = โหลด SQL ถึง fix-07 เท่านั้น (ฟังก์ชันแบบก่อน fix-08) — ใช้ยืนยันว่าตัวตรวจจับ SQL เดิมได้จริง
//   พิมพ์ทีละบรรทัด: START <ขา> / DONE <ขา> / ALL-DONE (ข้อผิดพลาดพิมพ์ ERROR <ข้อความ> แล้วจบด้วยรหัส 1)
//   ใช้ SQL_DIR ตัวเดียวกับตัวทดสอบหลัก (ส่งต่อทาง env)
import { createDb } from '../../run.mjs';

const LEGS = ['sale', 'count', 'void', 'return', 'move', 'order'];
const ADMIN = 'a0000000-0000-4000-8000-00000000000a';
const CASHIER = 'a0000000-0000-4000-8000-00000000000c';
const GROUP = 'b0000000-0000-4000-8000-000000000001';
const pid = (n) => `c0000000-0000-4000-8000-00000000000${n}`;
const clientId = (n) => `e0000000-0000-4000-8000-00000000000${n}`;
const line = (k, n, q) => ({ line_key: k, sku_id: `SKU-P${n}`, item_id: `ITEM-${n}`, sku: `LK-${n}`, name: `สินค้า ${n}`, qty: q, unit_price: 100 });
const order = (ext, lines) => ({ external_order_id: ext, status: 'paid', raw_status: 'PAID', currency: 'THB', lines });
const say = (s) => process.stdout.write(s + '\n');

const which = process.argv[2] ?? 'all';
const old = process.argv[3] === 'old';
const ctx = await createDb({ preparedTransactions: 4, ...(old ? { upTo: 'supabase-fix-07-wedding.sql' } : {}) });
const db = ctx.db;

async function user(id, role, perms) {
  await ctx.pg.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}'::jsonb)`, [id, `u${id.slice(-4)}@test.local`]);
  await ctx.pg.query(`update public.user_profiles set role = $2, permissions = coalesce(permissions, '{}'::jsonb) || $3::jsonb
                       where id = $1`, [id, role, JSON.stringify(perms)]);
  return ctx.asUser(id);
}
// รายการค้าง: รันคำสั่งในชื่อผู้ใช้ (เหมือน PostgREST) แล้ว prepare ไว้ยังไม่ commit — ล็อกทั้งหมดยังถืออยู่
async function hold(uid, sql, params) {
  await db.exec('begin');
  await db.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
                         set_config('role', 'authenticated', true)`, [uid]);
  await db.query(sql, params);
  await db.exec(`prepare transaction 'zz_hold'`);
}
// ออเดอร์ที่บันทึกบรรทัดสินค้าแล้ว แต่ยังไม่ถึง channel_order_apply = สิ่งที่ record_channel_order ถือไว้ระหว่างทาง
// (FK ของบรรทัดใส่ key share ที่แถวสินค้า ตามลำดับบรรทัดที่แพลตฟอร์มส่งมา)
let held = 0;
async function holdOrderLines(cid, prods) {
  held += 1;
  await db.exec('begin');
  const o = (await db.query(`insert into public.channel_orders (channel_id, external_order_id, status) values ($1, $2, 'paid')
                             returning id`, [cid, `HOLD-${held}`])).rows[0].id;
  let i = 0;
  for (const n of prods) {
    i += 1;
    await db.query(`insert into public.channel_order_lines (order_id, line_key, qty, product_id) values ($1, $2, 1, $3)`,
      [o, `L${i}`, pid(n)]);
  }
  await db.exec(`prepare transaction 'zz_hold'`);
}
const release = () => db.exec(`rollback prepared 'zz_hold'`);

try {
  const admin = await user(ADMIN, 'admin', {});
  const cashier = await user(CASHIER, 'staff', { sales: true, stock: true, refunds: true });
  await ctx.pg.query(`insert into public.product_groups (id, name) values ($1, 'เสื้อทดสอบล็อก')`, [GROUP]);
  for (const n of [1, 2, 3]) {
    await ctx.pg.query(`insert into public.products (id, name, sku, size, sell_price, cost_price, stock_qty, group_id)
                        values ($1, 'เสื้อทดสอบล็อก', $2, $3, 100, 40, 20, $4)`, [pid(n), `LK-${n}`, `S${n}`, GROUP]);
  }
  const cid = (await admin.rpc('create_integration_channel', { p_platform: 'shopee', p_display_name: 'Shopee ทดสอบ' })).id;
  await ctx.service.rpc('server_update_channel', { p_channel_id: cid, p_patch: { status: 'connected' } });
  await admin.rpc('save_channel_options', { p_channel_id: cid, p_options: { push_stock: true, deduct_on: 'paid' } });
  await ctx.service.rpc('upsert_channel_listings', {
    p_channel_id: cid,
    p_rows: [1, 2, 3].map((n) => ({ sku_id: `SKU-P${n}`, item_id: `ITEM-${n}`, sku: `LK-${n}`, name: `สินค้า ${n}` })),
  });
  await admin.rpc('mark_initial_push', { p_channel_id: cid });
  await ctx.pg.query(`update public.stock_sync_outbox set status = 'done', done_at = now() where status = 'pending'`);
  const sale = (n) => cashier.rpc('record_sale', {
    p_client_id: clientId(n), p_items: [{ product_id: pid(1), qty: 1 }, { product_id: pid(2), qty: 1 }],
    p_discount: 0, p_payment_method: 'transfer', p_note: null, p_channel: 'store', p_cash_received: null });

  // ทุกขา (ยกเว้น order): ออเดอร์ค้างถือ key share ของ LK-2 อยู่ → งานหน้าร้านที่แตะ LK-1 + LK-2 ต้องไม่รอ
  //   (SQL เดิมล็อก LK-1 แบบ for update ได้ แล้วรอ LK-2 = ขาหนึ่งของวง)
  const legs = {
    async sale() {
      await holdOrderLines(cid, [2]);
      await sale(1);
      await release();
    },
    async count() {
      const sc = await cashier.rpc('create_stock_count', { p_client_id: clientId(2), p_name: 'นับระหว่างออเดอร์' });
      await cashier.rpc('set_stock_count_item', { p_count_id: sc.id, p_product_id: pid(1), p_qty: 17 });
      await cashier.rpc('set_stock_count_item', { p_count_id: sc.id, p_product_id: pid(2), p_qty: 18 });
      await holdOrderLines(cid, [2]);
      await cashier.rpc('apply_stock_count', { p_count_id: sc.id });
      await release();
    },
    async void() {
      const s = await sale(3);
      await holdOrderLines(cid, [2]);
      await cashier.rpc('void_sale', { p_sale_id: s.id, p_reason: 'ทดสอบยกเลิกระหว่างออเดอร์' });
      await release();
    },
    async return() {
      const s = await sale(4);
      await holdOrderLines(cid, [2]);
      await cashier.rpc('return_sale_items', {
        p_client_id: clientId(5), p_sale_id: s.id,
        p_items: [{ product_id: pid(1), qty: 1 }, { product_id: pid(2), qty: 1 }],
        p_reason: 'ทดสอบคืนระหว่างออเดอร์', p_refund_method: 'cash', p_restock: true });
      await release();
    },
    async move() {
      await holdOrderLines(cid, [2]);
      await cashier.rpc('move_stock', { p_product_id: pid(2), p_type: 'in', p_qty: 1, p_note: 'รับเข้าระหว่างออเดอร์' });
      await release();
    },
    // ขาอีกด้าน: ขายหน้าร้านค้าง (ล็อก LK-1, LK-2 แล้ว) → ออเดอร์ใหม่ลำดับบรรทัด LK-2, LK-1 ต้องบันทึกบรรทัดได้ไม่รอ
    //   (SQL เดิม: บรรทัด LK-2 ได้ key share แล้วรอ LK-1 ที่ขายหน้าร้านล็อกแบบ for update = อีกขาของวง)
    //   ช่องทางโหมดทดลอง = ไม่ตัดสต๊อก จึงไม่ต้องรอล็อกสินค้าที่ขายหน้าร้านถืออยู่ตอน apply (การรอแบบนั้นถูกต้อง ไม่ใช่วง)
    async order() {
      await admin.rpc('save_channel_options', { p_channel_id: cid, p_options: { shadow_mode: true } });
      await hold(CASHIER, `select public.record_sale(p_client_id => $1, p_items => $2::jsonb, p_payment_method => 'transfer')`,
        [clientId(6), JSON.stringify([{ product_id: pid(1), qty: 1 }, { product_id: pid(2), qty: 1 }])]);
      await ctx.service.rpc('record_channel_order', {
        p_channel_id: cid, p_order: order('ORD-Y', [line('B', 2, 1), line('A', 1, 1)]), p_source: 'webhook' });
      await release();
    },
  };

  for (const leg of which === 'all' ? LEGS : [which]) {
    if (!legs[leg]) throw new Error(`ไม่รู้จักขา ${leg}`);
    say(`START ${leg}`);
    await legs[leg]();
    say(`DONE ${leg}`);
  }
  const left = await ctx.pg.one(`select count(*)::int as n from pg_prepared_xacts`);
  if (left.n !== 0) throw new Error(`ยังมีรายการค้าง ${left.n} รายการ`);
  say('ALL-DONE');
} catch (e) {
  say(`ERROR ${String(e?.message ?? e).replace(/\s+/g, ' ')}`);
  process.exitCode = 1;
}
await db.close();
