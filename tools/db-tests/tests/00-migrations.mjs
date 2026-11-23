// ทุกไฟล์ SQL โหลดได้บนฐานข้อมูลใหม่ + fix-07 รันซ้ำได้ + ของเดิม (ขายหน้าร้าน/ร้านเช่าชุด) ยังทำงานหลังรัน fix-07
import { createDb, loadSqlFile, eq, ok, money, expectErr, uuid } from '../run.mjs';
import { makeUsers, seed, payload, create, pay, bkkToday, addDays } from './lib/wed.js';

export async function setup(ctx, st) {
  st.u = await makeUsers(ctx);
}

export function register(test) {
  test('ตารางสรุปท้าย fix-07 ถูกต้องทุกข้อ', async (ctx) => {
    const res = ctx.loadResults['supabase-fix-07-wedding.sql'];
    const rows = res[res.length - 1].rows;
    const m = Object.fromEntries(rows.map((r) => [r['รายการ'], r['ค่า']]));
    eq(m['ตารางของ b.oncloud'], '14 / 14');
    eq(m['ทุกตารางเปิด RLS'], 'ถูกต้อง');
    ok(/^(\d+) \/ \1$/.test(m['ฟังก์ชันของหน้าจอ (เรียกได้ / ทั้งหมด)']), 'ฟังก์ชันของหน้าจอเรียกได้ไม่ครบ');
    eq(m['ลิงก์ติดตามงานของลูกค้า (ลูกค้าเรียกได้ / ทั้งหมด)'], '1 / 1');
    eq(m['ตัวช่วยภายในที่เรียกตรงจาก API ได้ (ต้องเป็น 0)'], '0');
    eq(m['ตาราง b.oncloud ที่ลูกค้า (anon) อ่านตรงได้ (ต้องเป็น 0)'], '0');
    eq(m['พนักงาน b.oncloud อย่างเดียวอ่านข้อมูล NEWCUTE ไม่ได้ (is_member ไม่มีคีย์ wedding)'], 'ถูกต้อง');
    eq(m['ถังไฟล์ wedding-public / wedding-files'], '2 / 2');
    eq(m['ชื่อร้าน'], 'b.oncloud.wedding content');
  });

  test('รัน fix-07 ซ้ำ: ข้อมูลเดิมอยู่ครบ ตั้งค่าที่แก้ไว้ไม่ถูกรีเซ็ต ฟังก์ชันยังใช้ได้', async (ctx, st) => {
    const d = await seed(ctx, st.u);
    await st.u.mgr.rpc('wed_save_settings', { p_settings: { shop_name: 'บีออนคลาวด์ ทดสอบ', max_jobs_per_day: 3 } });
    const today = await bkkToday(ctx);
    const b = await create(st.u.staff, payload(d, addDays(today, 20)));
    await pay(st.u.staff, b.id, 1000);
    const before = await ctx.pg.one(`select count(*)::int as n from public.wed_payments`);
    await loadSqlFile(ctx, 'supabase-fix-07-wedding.sql');
    await loadSqlFile(ctx, 'supabase-fix-07-wedding.sql');
    const s = await st.u.staff.rpc('wed_get_settings');
    eq(s.shop_name, 'บีออนคลาวด์ ทดสอบ');
    eq(s.max_jobs_per_day, 3);
    const again = await st.u.staff.rpc('wed_get_booking', { p_booking_id: b.id });
    money(again.money.paid, 1000);
    eq((await ctx.pg.one(`select count(*)::int as n from public.wed_payments`)).n, before.n);
    eq((await ctx.pg.one(`select count(*)::int as n from storage.buckets where id like 'wedding-%'`)).n, 2);
    // นโยบาย storage ไม่ซ้อน (drop + create ทุกครั้ง)
    eq((await ctx.pg.one(`select count(*)::int as n from pg_policies where schemaname = 'storage' and policyname like 'wedding_%'`)).n, 6);
  });

  test('ยังไม่ได้รัน fix-05 → fix-07 หยุดทันทีพร้อมข้อความไทย และไม่สร้างอะไรเลย', async () => {
    const ctx2 = await createDb({ upTo: 'supabase-fix-04-pos.sql' });
    try {
      await expectErr(() => loadSqlFile(ctx2, 'supabase-fix-07-wedding.sql'), 'ต้องรัน supabase-fix-01.sql ถึง supabase-fix-05-rental.sql');
      const r = await ctx2.pg.one(`select to_regclass('public.wed_settings') is null as none,
                                          to_regprocedure('public.wed_staff()') is null as nofn`);
      eq(r, { none: true, nofn: true });
    } finally {
      await ctx2.db.close();
    }
  });

  test('ขายหน้าร้าน NEWCUTE (record_sale เงินสด) ยังใช้ได้หลังรัน fix-07', async (ctx, st) => {
    const g = await ctx.pg.one(`insert into public.product_groups (name) values ('เสื้อทดสอบ') returning id`);
    const p = await ctx.pg.one(`insert into public.products (name, sku, sell_price, cost_price, stock_qty, group_id)
                                values ('เสื้อทดสอบ', 'TST-001', 250, 100, 10, $1) returning id`, [g.id]);
    const sale = await st.u.newcute.rpc('record_sale', {
      p_client_id: uuid(), p_items: [{ product_id: p.id, qty: 2 }], p_discount: 0, p_payment_method: 'cash',
      p_note: null, p_channel: 'store', p_cash_received: 1000,
    });
    ok(sale.sale_no, 'ไม่ได้เลขบิล');
    money(sale.net_amount ?? sale.total_amount, 500);
    eq((await ctx.pg.one(`select stock_qty from public.products where id = $1`, [p.id])).stock_qty, 8);
    // พนักงาน b.oncloud อย่างเดียวไม่เห็นยอดขาย/สินค้า NEWCUTE
    eq((await st.u.staff.all(`select id from public.sales`)).length, 0);
    eq((await st.u.staff.one(`select public.is_member() as m`)).m, false);
    eq((await st.u.newcute.one(`select public.is_member() as m`)).m, true);
    eq((await st.u.newcute.one(`select public.wed_staff() as m`)).m, false);
  });

  test('ร้านเช่าชุด: สร้างการจอง + รับเงิน ยังใช้ได้หลังรัน fix-07', async (ctx, st) => {
    const item = await st.u.rental.rpc('rental_save_item', {
      p_item: { client_id: uuid(), code: 'DRS-01', name: 'ชุดไทยทดสอบ', base_price: 1500, base_days: 3, security_deposit: 1000 },
      p_units: [{ size: 'M' }],
    });
    const today = await bkkToday(ctx);
    const r = await st.u.rental.rpc('rental_create_booking', {
      p_client_id: uuid(),
      p_payload: {
        customer: { name: 'ลูกค้าเช่า', phone: '0899999999' }, pickup_date: addDays(today, 5), return_date: addDays(today, 7),
        lines: [{ item_id: item.id }], payments: [{ kind: 'payment', method: 'cash', amount: 500 }],
      },
    });
    eq(r.already_saved, false);
    money(r.booking.money.paid, 500);
    ok(/^RT-\d{8}-\d{3}$/.test(r.booking.booking_no), 'เลขการจองร้านเช่าผิดรูปแบบ');
    // พนักงานร้านเช่าไม่เห็นข้อมูล b.oncloud
    await expectErr(() => st.u.rental.rpc('wed_get_settings'), 'ไม่มีสิทธิ์ใช้งานระบบ b.oncloud', { code: '42501' });
  });
}
