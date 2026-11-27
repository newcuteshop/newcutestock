// supabase-fix-11 (27/11/2569): ชื่อช่องทางติดต่อต่องาน (wed_bookings.source_detail) — "เลือกช่องทางไหน ต้องใส่ชื่อช่องทางนั้นได้"
//   สร้าง/แก้/ดูงาน (ตัดช่องว่าง, ว่าง = null, เกิน 200 = แจ้งเตือนไทย, แก้งานไม่ส่งคีย์ = คงเดิม), ประวัติ [เดิม, ใหม่],
//   ส่งรหัสคำขอเดิมซ้ำยังได้งานเดิม, ยอดเงินเหมือนก่อนรัน fix-11 ทุกตัว, เนื้อฟังก์ชัน = fix-07 + บรรทัด source_detail เท่านั้น,
//   รันซ้ำได้ / รัน fix-07 ซ้ำแล้วตารางตรวจผลจับได้, ตรวจของที่ต้องมีก่อน, anon เรียกไม่ได้
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createDb, loadSqlFile, eq, ok, expectErr, uuid, REPO } from '../run.mjs';
import { makeUsers, seed, payload, create, pay, bkkToday, addDays } from './lib/wed.js';

const FIX07 = 'supabase-fix-07-wedding.sql';
const FIX10 = 'supabase-fix-10-wedding-package-detail.sql';
const FIX11 = 'supabase-fix-11-wedding-source-detail.sql';
const FNS = ['wed_read_head', 'wed_booking_json', 'wed_create_booking', 'wed_update_booking'];

export async function setup(ctx, st) {
  st.u = await makeUsers(ctx);
  st.d = await seed(ctx, st.u);
  st.today = await bkkToday(ctx);
  // ไม่จำกัดคิวต่อวัน — ไฟล์นี้ทดสอบชื่อช่องทาง ไม่ใช่คิวเต็ม
  await st.u.mgr.rpc('wed_save_settings', { p_settings: { max_jobs_per_day: 0 } });
}

const upd = (user, b, p) => user.rpc('wed_update_booking', { p_booking_id: b.id, p_updated_at: b.updated_at, p_payload: p });
const checkRows = (res) => res.at(-1).rows.map((r) => [r['ลำดับ'], r['ผล']]);
const ALL_OK = [1, 2, 3, 4, 5, 6, 7].map((n) => [n, 'ถูกต้อง']);

// เนื้อฟังก์ชัน (create or replace ... $$;) จากไฟล์ SQL
async function fnBlock(file, name) {
  const text = (await readFile(path.join(REPO, file), 'utf8')).replace(/\r\n/g, '\n');
  const head = `create or replace function public.${name}(`;
  const start = text.indexOf(head);
  ok(start >= 0 && text.indexOf(head, start + 1) < 0, `หา ${name} ใน ${file} ไม่เจอ หรือมีมากกว่า 1 ที่`);
  const end = text.indexOf('\n$$;', start);
  return text.slice(start, end + 4);
}

// ยอดเงิน/งวดของงาน (ไม่นับรหัส/เวลา) — ใช้เทียบ "ก่อน fix-11" กับ "หลัง fix-11"
const moneyOf = (b) => ({ money: b.money, installments: b.installments.map((i) => [i.seq, i.label, i.due_date, i.amount, i.paid_amount, i.amount_remaining, i.status]) });

export function register(test) {
  test('fix-11: ตารางตรวจผลท้ายไฟล์ถูกต้องทุกแถว (รันพร้อมไฟล์อื่นตามลำดับ)', async (ctx) => {
    eq(checkRows(ctx.loadResults[FIX11]), ALL_OK);
  });

  test('สร้างงาน: ตัดช่องว่างหัวท้าย / ช่องว่างล้วนหรือไม่ส่ง = ไม่มี / ดูงาน (wed_get_booking) เห็นค่าเดียวกัน', async (ctx, st) => {
    const day = addDays(st.today, 20);
    const a = await create(st.u.staff, payload(st.d, day, { source: 'facebook', source_detail: '  Phodjanee Dicharoen  ' }));
    eq([a.source, a.source_detail], ['facebook', 'Phodjanee Dicharoen']);
    const g = await st.u.staff.rpc('wed_get_booking', { p_booking_id: a.id });
    eq([g.source, g.source_detail], ['facebook', 'Phodjanee Dicharoen']);
    eq((await ctx.pg.one(`select source_detail from public.wed_bookings where id = $1`, [a.id])).source_detail, 'Phodjanee Dicharoen');
    const blank = await create(st.u.staff, payload(st.d, day, { source: 'line', source_detail: '   ' }));
    eq(blank.source_detail, null);
    const none = await create(st.u.staff, payload(st.d, day, { source: 'walkin' }));
    eq(none.source_detail, null);
    const nul = await create(st.u.staff, payload(st.d, day, { source: 'referral', source_detail: null }));
    eq(nul.source_detail, null);
    // 200 ตัวอักษร (ภาษาไทย) ได้ / 201 ไม่ได้ / ไม่ใช่ข้อความ ไม่ได้
    const long = 'ก'.repeat(200);
    eq((await create(st.u.staff, payload(st.d, day, { source_detail: long }))).source_detail, long);
    const n0 = (await ctx.pg.one(`select count(*)::int as n from public.wed_bookings`)).n;
    await expectErr(() => create(st.u.staff, payload(st.d, day, { source_detail: long + 'ข' })), 'ชื่อช่องทางติดต่อยาวเกินไป (สูงสุด 200 ตัวอักษร)');
    await expectErr(() => create(st.u.staff, payload(st.d, day, { source_detail: { name: 'x' } })), 'ชื่อช่องทางติดต่อไม่ถูกต้อง');
    eq((await ctx.pg.one(`select count(*)::int as n from public.wed_bookings`)).n, n0, 'ค่าผิดต้องไม่สร้างงาน');
    // ฐานข้อมูลกันค่าว่างเอง (เผื่อมีใครเขียนตรง)
    await expectErr(() => ctx.pg.query(`update public.wed_bookings set source_detail = '' where id = $1`, [a.id]), 'wed_bookings_source_detail_check');
  });

  test('แก้งาน: เปลี่ยนชื่อ / ไม่ส่งคีย์ = คงเดิม / ช่องว่างหรือ null = ล้าง / เกิน 200 = ไม่แก้อะไร / ประวัติ [เดิม, ใหม่] เฉพาะตอนเปลี่ยน', async (ctx, st) => {
    const day = addDays(st.today, 21);
    let b = await create(st.u.staff, payload(st.d, day, { source: 'facebook', source_detail: 'Phodjanee Dicharoen' }));
    b = await upd(st.u.staff, b, { source_detail: ' Phodjanee D. ' });
    eq(b.source_detail, 'Phodjanee D.');
    eq(b.logs[0].action, 'update');
    eq(b.logs[0].detail.source_detail, ['Phodjanee Dicharoen', 'Phodjanee D.']);
    eq('source' in b.logs[0].detail, false, 'ช่องทางไม่ได้เปลี่ยน ต้องไม่จด');
    // ไม่ส่งคีย์ = คงเดิม (และไม่จดในประวัติ)
    b = await upd(st.u.staff, b, { note: 'แก้หมายเหตุอย่างเดียว' });
    eq([b.source_detail, b.note, 'source_detail' in b.logs[0].detail], ['Phodjanee D.', 'แก้หมายเหตุอย่างเดียว', false]);
    // ส่งค่าเดิม = ไม่จด
    b = await upd(st.u.staff, b, { source_detail: 'Phodjanee D.' });
    eq('source_detail' in b.logs[0].detail, false);
    // เปลี่ยนช่องทาง + ชื่อพร้อมกัน
    b = await upd(st.u.staff, b, { source: 'instagram', source_detail: '@phodjanee' });
    eq([b.source, b.source_detail], ['instagram', '@phodjanee']);
    // ประวัติจดทั้งช่องทางและชื่อ (ไม่งั้นอ่านเหมือนชื่อ Facebook ถูกแก้เป็นชื่อ IG)
    eq([b.logs[0].detail.source, b.logs[0].detail.source_detail], [['facebook', 'instagram'], ['Phodjanee D.', '@phodjanee']]);
    // ส่งช่องทางเดิม = ไม่จด ; เปลี่ยนช่องทางอย่างเดียว = จดช่องทางอย่างเดียว
    b = await upd(st.u.staff, b, { source: 'instagram' });
    eq(['source' in b.logs[0].detail, 'source_detail' in b.logs[0].detail], [false, false]);
    b = await upd(st.u.staff, b, { source: 'tiktok' });
    eq([b.source, b.source_detail, b.logs[0].detail.source, 'source_detail' in b.logs[0].detail], ['tiktok', '@phodjanee', ['instagram', 'tiktok'], false]);
    b = await upd(st.u.staff, b, { source: 'instagram' });
    // ค่าผิด → ไม่แก้อะไร
    await expectErr(() => upd(st.u.staff, b, { source_detail: 'x'.repeat(201), note: 'ไม่ควรถูกบันทึก' }), 'ชื่อช่องทางติดต่อยาวเกินไป');
    const g = await st.u.staff.rpc('wed_get_booking', { p_booking_id: b.id });
    eq([g.source_detail, g.note, g.updated_at], ['@phodjanee', 'แก้หมายเหตุอย่างเดียว', b.updated_at]);
    // ช่องว่าง / null = ล้าง
    b = await upd(st.u.staff, b, { source_detail: '  ' });
    eq(b.source_detail, null);
    eq(b.logs[0].detail.source_detail, ['@phodjanee', null]);
    b = await upd(st.u.staff, b, { source_detail: 'ใหม่' });
    b = await upd(st.u.staff, b, { source_detail: null });
    eq(b.source_detail, null);
  });

  test('รหัสคำขอเดิมส่งซ้ำ: สร้างงาน = ได้งานเดิม (ข้อมูลชุดเดิม payload_matches = true / ชื่อช่องทางต่าง = false) · แก้งาน = ผลเดิม', async (ctx, st) => {
    const day = addDays(st.today, 22);
    const cid = uuid();
    const p = payload(st.d, day, { source: 'facebook', source_detail: 'Phodjanee Dicharoen', payments: [{ kind: 'payment', method: 'transfer', amount: 3000 }] });
    const r1 = await st.u.staff.rpc('wed_create_booking', { p_client_id: cid, p_payload: p });
    const r2 = await st.u.staff.rpc('wed_create_booking', { p_client_id: cid, p_payload: p });
    eq([r1.already_saved, r1.payload_matches, r2.already_saved, r2.payload_matches, r2.booking.id, r2.booking.source_detail],
      [false, true, true, true, r1.booking.id, 'Phodjanee Dicharoen']);
    // force ไม่นับเป็นข้อมูลงาน (กฎเดิมของ fix-07)
    const r3 = await st.u.staff.rpc('wed_create_booking', { p_client_id: cid, p_payload: { ...p, force: true } });
    eq([r3.already_saved, r3.payload_matches], [true, true]);
    const r4 = await st.u.staff.rpc('wed_create_booking', { p_client_id: cid, p_payload: { ...p, source_detail: 'คนอื่น' } });
    eq([r4.already_saved, r4.payload_matches, r4.booking.source_detail], [true, false, 'Phodjanee Dicharoen']);
    eq((await ctx.pg.one(`select count(*)::int as n from public.wed_bookings where client_id = $1`, [cid])).n, 1);
    eq((await ctx.pg.one(`select count(*)::int as n from public.wed_payments where booking_id = $1`, [r1.booking.id])).n, 1, 'เงินต้องไม่ถูกรับซ้ำ');

    const edit = { client_id: uuid(), source_detail: 'Phodjanee D.' };
    const e1 = await upd(st.u.staff, r1.booking, edit);
    const e2 = await upd(st.u.staff, r1.booking, edit);
    eq([e1.already_saved, e2.already_saved, e2.updated_at, e2.source_detail], [false, true, e1.updated_at, 'Phodjanee D.']);
    await expectErr(() => upd(st.u.staff, e1, { ...edit, source_detail: 'อื่น' }), 'รหัสคำขอนี้ถูกใช้บันทึกการแก้ไขชุดอื่นไปแล้ว');
  });

  test('ราคาล่วงหน้า (wed_quote) ส่งชื่อช่องทางมาด้วยได้ — ยอดเงินไม่เปลี่ยน', async (ctx, st) => {
    const day = addDays(st.today, 23);
    const q0 = await st.u.staff.rpc('wed_quote', { p_payload: payload(st.d, day) });
    const q1 = await st.u.staff.rpc('wed_quote', { p_payload: payload(st.d, day, { source_detail: 'Phodjanee Dicharoen' }) });
    eq(q1.money, q0.money);
  });

  test('สิทธิ์: anon เรียกสร้าง/แก้/ดูงานไม่ได้ · ตัวช่วย wed_read_head / wed_booking_json ผู้ล็อกอินก็เรียกตรงไม่ได้', async (ctx, st) => {
    const b = await create(st.u.staff, payload(st.d, addDays(st.today, 24), { source_detail: 'x' }));
    await expectErr(() => ctx.anon.rpc('wed_create_booking', { p_client_id: uuid(), p_payload: payload(st.d, addDays(st.today, 24)) }),
      'permission denied', { code: '42501' });
    await expectErr(() => ctx.anon.rpc('wed_update_booking', { p_booking_id: b.id, p_updated_at: b.updated_at, p_payload: { source_detail: 'y' } }),
      'permission denied', { code: '42501' });
    await expectErr(() => ctx.anon.rpc('wed_get_booking', { p_booking_id: b.id }), 'permission denied', { code: '42501' });
    await expectErr(() => st.u.staff.rpc('wed_booking_json', { p_booking_id: b.id }), 'permission denied', { code: '42501' });
    await expectErr(() => st.u.staff.one(`select (public.wed_read_head('{"couple_names": "x"}'::jsonb, null::public.wed_bookings)).source_detail`),
      'permission denied', { code: '42501' });
    // ไม่มีสิทธิ์ b.oncloud → ไม่ได้ (ตรวจสิทธิ์ข้างในเหมือนเดิม)
    await expectErr(() => st.u.newcute.rpc('wed_create_booking', { p_client_id: uuid(), p_payload: payload(st.d, addDays(st.today, 24)) }),
      'ไม่มีสิทธิ์ใช้งานระบบ b.oncloud', { code: '42501' });
    // ลิงก์ติดตามงานของลูกค้าไม่ส่งชื่อช่องทาง (ข้อมูลภายในร้าน)
    const pub = await ctx.anon.rpc('wed_public_booking', { p_token: b.public_token });
    ok(!JSON.stringify(pub).includes('source_detail'), 'ลิงก์ลูกค้าไม่ควรมี source_detail');
  });

  test('เนื้อ 4 ฟังก์ชัน = fix-07 ทุกตัวอักษร ยกเว้นบรรทัดที่มีคำว่า source_detail หรือ fix-11 · ฐานข้อมูลใช้เนื้อเดียวกับไฟล์', async (ctx) => {
    for (const name of FNS) {
      const a = await fnBlock(FIX07, name);
      const b = await fnBlock(FIX11, name);
      const stripped = b.split('\n').filter((l) => !l.includes('source_detail') && !l.includes('fix-11')).join('\n');
      eq(stripped, a, `${name} ต่างจาก fix-07 นอกเหนือจากบรรทัด source_detail / fix-11`);
      ok(b.length > a.length, `${name} ไม่มีบรรทัด source_detail`);
      const src = (await ctx.pg.one(`select p.prosrc from pg_proc as p where p.pronamespace = 'public'::regnamespace and p.proname = $1`, [name])).prosrc;
      ok(b.includes(src.replace(/\r\n/g, '\n')), `${name} ในฐานข้อมูลไม่ใช่เนื้อของ fix-11`);
    }
  });

  test('ยอดเงินเหมือนก่อนรัน fix-11 ทุกตัว + งานเดิมไม่ถูกแตะ + รันซ้ำได้ + รัน fix-07 ซ้ำแล้วตารางตรวจผลจับได้ (รัน fix-11 ต่อ = กลับมาครบ, ค่าไม่หาย)', async () => {
    const ctx2 = await createDb({ upTo: FIX10 });
    try {
      const u = await makeUsers(ctx2);
      const d = await seed(ctx2, u);
      const today = await bkkToday(ctx2);
      await u.mgr.rpc('wed_save_settings', { p_settings: { max_jobs_per_day: 0 } });
      const day = addDays(today, 30);
      const p = payload(d, day, {
        source: 'facebook', source_detail: 'Phodjanee Dicharoen',
        addons: [{ addon_id: d.addon.id, qty: 2 }, { name: 'อัลบั้ม', qty: 1, unit_price: 3333.33 }],
        travel_fee: 1500, discount: 777.77, discount_note: 'ลูกค้าเก่า',
        payments: [{ kind: 'payment', method: 'transfer', amount: 5000 }],
      });
      // ก่อน fix-11: ฐานข้อมูลยังไม่รู้จักคีย์นี้ (ข้ามไปเฉยๆ)
      const before = await create(u.staff, p);
      ok(!('source_detail' in before), 'ก่อน fix-11 ต้องยังไม่มี source_detail');
      const oldBooking = await create(u.staff, payload(d, addDays(today, 31), { source: 'line' }));
      await pay(u.staff, oldBooking.id, 1234.56);
      const oldMoney = moneyOf(await u.staff.rpc('wed_get_booking', { p_booking_id: oldBooking.id }));
      const beforeMoney = moneyOf(await u.staff.rpc('wed_get_booking', { p_booking_id: before.id }));

      let res = await loadSqlFile(ctx2, FIX11);
      eq(checkRows(res), ALL_OK);
      // งานเดิม: ยอดเงิน/งวดเหมือนเดิม ชื่อช่องทางว่าง (ไม่เดา)
      const g0 = await u.staff.rpc('wed_get_booking', { p_booking_id: oldBooking.id });
      eq([moneyOf(g0), g0.source, g0.source_detail], [oldMoney, 'line', null]);
      eq(moneyOf(await u.staff.rpc('wed_get_booking', { p_booking_id: before.id })), beforeMoney);
      // payload เดียวกันหลัง fix-11 → ยอดเงิน/งวดเท่ากับก่อน fix-11 ทุกตัว
      const after = await create(u.staff, p);
      eq([after.source_detail, moneyOf(after)], ['Phodjanee Dicharoen', beforeMoney]);

      // รันซ้ำ 2 รอบ: ตารางตรวจผลเหมือนเดิม ค่าไม่หาย constraint มีครั้งเดียว
      res = await loadSqlFile(ctx2, FIX11);
      res = await loadSqlFile(ctx2, FIX11);
      eq(checkRows(res), ALL_OK);
      eq((await u.staff.rpc('wed_get_booking', { p_booking_id: after.id })).source_detail, 'Phodjanee Dicharoen');
      eq(await ctx2.pg.one(`select count(*)::int as n from pg_constraint
                             where conrelid = 'public.wed_bookings'::regclass and conname = 'wed_bookings_source_detail_check'`), { n: 1 });

      // รัน fix-07 ซ้ำภายหลัง → ฟังก์ชันกลับเป็นแบบเดิม: ตารางของ fix-11 ขึ้น "ยังเป็นแบบเดิม" (แถว 2-4)
      await loadSqlFile(ctx2, FIX07);
      const stale = await ctx2.pg.all(`select (public.wed_booking_json($1::uuid) ? 'source_detail') as has`, [after.id]);
      eq(stale[0].has, false);
      // ข้อมูลยังอยู่ในตาราง
      eq((await ctx2.pg.one(`select source_detail from public.wed_bookings where id = $1`, [after.id])).source_detail, 'Phodjanee Dicharoen');
      res = await loadSqlFile(ctx2, FIX11);
      eq(checkRows(res), ALL_OK);
      eq((await u.staff.rpc('wed_get_booking', { p_booking_id: after.id })).source_detail, 'Phodjanee Dicharoen');
    } finally {
      await ctx2.db.close();
    }
  });

  test('ตารางตรวจผลจับของผิดได้: ฟังก์ชันแบบเดิม (fix-07) → แถว 2-4 "ยังเป็นแบบเดิม" · anon เรียกได้ → แถว 6 ผิด', async () => {
    const ctx2 = await createDb({ upTo: FIX10 });
    try {
      await loadSqlFile(ctx2, FIX11);
      // เอาเฉพาะตารางตรวจผลท้ายไฟล์มารัน หลังทำให้ฟังก์ชันกลับเป็นแบบเดิม
      const text = (await readFile(path.join(REPO, FIX11), 'utf8')).replace(/\r\n/g, '\n');
      const sel = text.slice(text.lastIndexOf('\nselect x.ord as "ลำดับ"') + 1);
      await loadSqlFile(ctx2, FIX07);
      let rows = (await ctx2.pg.all(sel)).map((r) => [r['ลำดับ'], r['ผล']]);
      eq(rows.filter(([, v]) => v !== 'ถูกต้อง').map(([n]) => n), [2, 3, 4]);
      await loadSqlFile(ctx2, FIX11);
      await ctx2.pg.query(`grant execute on function public.wed_booking_json(uuid) to anon`);
      rows = (await ctx2.pg.all(sel)).map((r) => [r['ลำดับ'], r['ผล']]);
      eq(rows.filter(([, v]) => v !== 'ถูกต้อง').map(([n]) => n), [6]);
    } finally {
      await ctx2.db.close();
    }
  });

  test('ยังไม่ได้รัน fix-07 → fix-11 หยุดทันทีพร้อมข้อความไทย และไม่สร้างอะไรเลย', async () => {
    const ctx2 = await createDb({ upTo: 'supabase-fix-06-rental-online.sql' });
    try {
      await expectErr(() => loadSqlFile(ctx2, FIX11), 'ต้องรัน supabase-fix-07-wedding.sql ให้เสร็จก่อน');
      eq((await ctx2.pg.one(`select to_regclass('public.wed_bookings') is null as none`)).none, true);
    } finally {
      await ctx2.db.close();
    }
  });
}
