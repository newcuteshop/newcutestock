// สิทธิ์ b.oncloud: ตารางสิทธิ์ 6 แบบ, RLS ทุกตาราง, ค่าตัวทีมงานเห็นเฉพาะผู้จัดการ, ถังไฟล์ + นโยบาย storage, สิทธิ์ฟังก์ชัน
import { createDb, eq, ok, expectErr, uuid } from '../run.mjs';
import { makeUsers, seed, payload, create, pay, bkkToday, addDays } from './lib/wed.js';

const TABLES = ['wed_settings', 'wed_packages', 'wed_addons', 'wed_customers', 'wed_crew', 'wed_bookings', 'wed_sessions',
  'wed_session_crew', 'wed_booking_addons', 'wed_charges', 'wed_payments', 'wed_installments', 'wed_deliverables', 'wed_logs'];
const MANAGER_ONLY_TABLES = ['wed_crew', 'wed_session_crew'];

export async function setup(ctx, st) {
  st.u = await makeUsers(ctx);
  st.d = await seed(ctx, st.u);
  st.today = await bkkToday(ctx);
  // งาน 1 งาน มีทีมงาน + ค่าตัว (ผู้จัดการกำหนดเอง) + เงิน + ค่าใช้จ่าย + รายการส่งงาน → ทุกตารางมีแถว
  const p = payload(st.d, addDays(st.today, 30), {
    sessions: [{ session_type: 'reception', date: addDays(st.today, 30), start_time: '17:00', end_time: '22:00',
      crew: [{ crew_id: st.d.crew[0].id, fee: 7777.77 }, { crew_id: st.d.crew[1].id }] }],
    addons: [{ addon_id: st.d.addon.id, qty: 1 }],
  });
  st.b = await create(st.u.mgr, p);
  await pay(st.u.staff, st.b.id, 20000);
  await st.u.staff.rpc('wed_confirm', { p_booking_id: st.b.id });
  await st.u.staff.rpc('wed_add_charge', { p_client_id: uuid(), p_booking_id: st.b.id, p_kind: 'overtime', p_description: 'ล่วงเวลา 1 ชม.', p_amount: 1500 });
}

export function register(test) {
  test('อ่านตั้งค่า: ไม่มีสิทธิ์ / NEWCUTE / ร้านเช่า = 42501 ; พนักงาน / ผู้จัดการ / แอดมิน = ได้ ; anon = ไม่มีสิทธิ์เรียก', async (ctx, st) => {
    for (const k of ['none', 'newcute', 'rental']) {
      await expectErr(() => st.u[k].rpc('wed_get_settings'), 'ไม่มีสิทธิ์ใช้งานระบบ b.oncloud', { code: '42501' });
      await expectErr(() => st.u[k].rpc('wed_badges'), 'ไม่มีสิทธิ์', { code: '42501' });
      await expectErr(() => st.u[k].rpc('wed_get_booking', { p_booking_id: st.b.id }), 'ไม่มีสิทธิ์', { code: '42501' });
    }
    for (const k of ['staff', 'mgr', 'admin']) {
      eq((await st.u[k].rpc('wed_get_settings')).shop_name, 'b.oncloud.wedding content', k);
    }
    await expectErr(() => ctx.anon.rpc('wed_get_settings'), 'permission denied', { code: '42501' });
    await expectErr(() => ctx.anon.rpc('wed_get_booking', { p_booking_id: st.b.id }), 'permission denied', { code: '42501' });
    // ไม่ได้ล็อกอินแต่ถือ role authenticated (JWT ไม่มี sub)
    await expectErr(() => ctx.asUser(null).rpc('wed_get_settings'), 'กรุณาเข้าสู่ระบบใหม่', { code: '42501' });
  });

  test('งานของผู้จัดการ: พนักงานทำไม่ได้ (42501) ผู้จัดการ/แอดมินทำได้', async (ctx, st) => {
    const today = st.today;
    const mgrOnly = [
      ['wed_save_settings', { p_settings: { tagline: 'x' } }],
      ['wed_save_package', { p_package: { client_id: uuid(), name: 'p' } }],
      ['wed_delete_package', { p_id: st.d.pkg.id }],
      ['wed_save_addon', { p_addon: { client_id: uuid(), name: 'a' } }],
      ['wed_delete_addon', { p_id: st.d.addon.id }],
      ['wed_save_crew', { p_crew: { client_id: uuid(), name: 'c' } }],
      ['wed_crew_payouts', { p_from: today, p_to: addDays(today, 60) }],
      ['wed_mark_crew_paid', { p_items: [{ session_id: st.b.sessions[0].id, crew_id: st.d.crew[0].id, paid_on: today }] }],
      ['wed_reopen', { p_booking_id: st.b.id }],
      ['wed_report', { p_from: today, p_to: addDays(today, 60) }],
    ];
    for (const [fn, args] of mgrOnly) {
      await expectErr(() => st.u.staff.rpc(fn, args), 'เฉพาะผู้จัดการ b.oncloud', { code: '42501' });
    }
    for (const fn of ['wed_export_bookings', 'wed_export_payments', 'wed_export_crew_fees']) {
      await expectErr(() => st.u.staff.rpcRows(fn, { p_from: today, p_to: addDays(today, 60) }), 'เฉพาะผู้จัดการ', { code: '42501' });
    }
    // แอดมินผ่านทุกสิทธิ์โดยไม่ต้องมีคีย์ wedding
    eq((await st.u.admin.rpc('wed_save_settings', { p_settings: { tagline: 'ถ่ายงานแต่งด้วยใจ' } })).tagline, 'ถ่ายงานแต่งด้วยใจ');
    ok((await st.u.admin.rpc('wed_report', { p_from: today, p_to: addDays(today, 60) })).income, 'แอดมินดูรายงานไม่ได้');
    ok((await st.u.mgr.rpc('wed_crew_payouts', { p_from: today, p_to: addDays(today, 60) })).crew.length >= 1);
    // ผู้จัดการทำงานพนักงานได้ด้วย (wedding_manage ครอบ wedding)
    ok((await st.u.mgr.rpc('wed_badges')) !== null);
  });

  test('RLS ทุกตาราง: พนักงานอ่านได้ (ยกเว้นทีมงาน/ค่าตัว) ผู้จัดการอ่านได้ทั้งหมด คนอื่นอ่านไม่เห็นแถว anon ไม่มีสิทธิ์ตาราง', async (ctx, st) => {
    for (const t of TABLES) {
      const all = (await ctx.pg.one(`select count(*)::int as n from public.${t}`)).n;
      ok(all > 0, `ตาราง ${t} ไม่มีแถวสำหรับทดสอบ`);
      const staffN = (await st.u.staff.one(`select count(*)::int as n from public.${t}`)).n;
      eq(staffN, MANAGER_ONLY_TABLES.includes(t) ? 0 : all, `พนักงานอ่าน ${t}`);
      eq((await st.u.mgr.one(`select count(*)::int as n from public.${t}`)).n, all, `ผู้จัดการอ่าน ${t}`);
      eq((await st.u.admin.one(`select count(*)::int as n from public.${t}`)).n, all, `แอดมินอ่าน ${t}`);
      for (const k of ['none', 'newcute', 'rental']) {
        eq((await st.u[k].one(`select count(*)::int as n from public.${t}`)).n, 0, `${k} อ่าน ${t}`);
      }
      await expectErr(() => ctx.anon.all(`select 1 from public.${t} limit 1`), 'permission denied', { code: '42501' });
      // เขียนตรงผ่าน API ไม่ได้เลย (ไม่มีสิทธิ์ insert/update/delete) — ต้องผ่านฟังก์ชันเท่านั้น
      await expectErr(() => st.u.mgr.all(`delete from public.${t}`), 'permission denied', { code: '42501' });
      ok((await ctx.service.one(`select count(*)::int as n from public.${t}`)).n === all, `service_role อ่าน ${t}`);
    }
    await expectErr(() => st.u.staff.all(`update public.wed_bookings set discount = 0`), 'permission denied', { code: '42501' });
    await expectErr(() => st.u.staff.all(`insert into public.wed_logs (booking_id, action) values ($1, 'x')`, [st.b.id]),
      'permission denied', { code: '42501' });
  });

  test('ค่าตัวทีมงาน/ต้นทุน/กำไร: พนักงานไม่เห็นทั้งทางตารางและ JSON ของทุกฟังก์ชัน', async (ctx, st) => {
    // ตารางที่พนักงานอ่านได้ไม่มีคอลัมน์ค่าตัว/ต้นทุนเลย (มีแค่ค่าเดินทางที่ลูกค้าจ่าย)
    const cols = await ctx.pg.all(`
      select c.table_name || '.' || c.column_name as col
        from information_schema.columns as c
       where c.table_schema = 'public' and c.table_name like 'wed\\_%'
         and c.table_name not in ('wed_crew', 'wed_session_crew')
         and (c.column_name like '%fee%' or c.column_name like '%cost%' or c.column_name like '%profit%')
       order by 1`);
    eq(cols.map((r) => r.col), ['wed_bookings.travel_fee']);

    const hasFeeKey = (v) => JSON.stringify(v).match(/"(fee|default_fee|crew_cost_total|profit|fee_paid_on|fees)"/);
    const sb = await st.u.staff.rpc('wed_get_booking', { p_booking_id: st.b.id });
    ok(!hasFeeKey(sb), 'JSON งานของพนักงานมีค่าตัว: ' + hasFeeKey(sb));
    ok(!JSON.stringify(sb).includes('7777.77'), 'ค่าตัวหลุดในข้อมูลงานของพนักงาน');
    eq(sb.sessions[0].crew.length, 2);
    const mb = await st.u.mgr.rpc('wed_get_booking', { p_booking_id: st.b.id });
    const fees = mb.sessions[0].crew.map((c) => c.fee).sort((a, b) => a - b);
    eq(fees, [3000.5, 7777.77]);
    eq(mb.money.crew_cost_total, 10778.27);
    eq(mb.money.profit, Math.round((mb.money.base_total + mb.money.charges_total - 10778.27) * 100) / 100);

    const day = addDays(st.today, 30);
    const checks = [
      ['wed_list_crew', {}],
      ['wed_crew_schedule', { p_crew_id: st.d.crew[0].id, p_from: st.today, p_to: addDays(st.today, 60) }],
      ['wed_calendar', { p_from: addDays(day, -2), p_to: addDays(day, 2) }],
      ['wed_day', { p_day: day }],
      ['wed_today', { p_day: day }],
      ['wed_quote', { p_payload: { booking_id: st.b.id } }],
      ['wed_deliverables_board', {}],
    ];
    for (const [fn, args] of checks) {
      const v = await st.u.staff.rpc(fn, args);
      ok(!hasFeeKey(v), `${fn} ของพนักงานมีค่าตัว: ${hasFeeKey(v)}`);
      ok(!JSON.stringify(v).includes('7777.77'), `${fn} ของพนักงานมีค่าตัว 7777.77`);
    }
    ok(hasFeeKey(await st.u.mgr.rpc('wed_list_crew')), 'ผู้จัดการต้องเห็นค่าตัวเริ่มต้น');
    ok(hasFeeKey(await st.u.mgr.rpc('wed_day', { p_day: day })), 'ผู้จัดการต้องเห็นค่าตัวในรายละเอียดวัน');
    eq((await st.u.mgr.rpc('wed_quote', { p_payload: { booking_id: st.b.id } })).money.crew_cost_total, 10778.27, 'ต้นทุนทีมใน wed_quote ของผู้จัดการ');
    // รายได้ของเดือนในภาพรวม = ผู้จัดการเท่านั้น
    ok(!('revenue' in (await st.u.staff.rpc('wed_today', {})).month), 'พนักงานเห็นรายได้ของเดือน');
    ok('revenue' in (await st.u.mgr.rpc('wed_today', {})).month, 'ผู้จัดการไม่เห็นรายได้ของเดือน');
    // พนักงานส่งค่าตัวมาเอง = ไม่มีผล (ใช้ค่าตัวเริ่มต้น)
    const b2 = await create(st.u.staff, payload(st.d, addDays(st.today, 50), {
      sessions: [{ session_type: 'ceremony', date: addDays(st.today, 50), crew: [{ crew_id: st.d.crew[2].id, fee: 1 }] }],
    }));
    const m2 = await st.u.mgr.rpc('wed_get_booking', { p_booking_id: b2.id });
    eq(m2.sessions[0].crew[0].fee, 1200);
    // ประวัติงาน (พนักงานอ่านได้) ไม่มีจำนวนเงินค่าตัว
    await st.u.mgr.rpc('wed_mark_crew_paid', { p_items: [{ session_id: st.b.sessions[0].id, crew_id: st.d.crew[0].id, paid_on: st.today }] });
    const logs = await st.u.staff.all(`select action, detail from public.wed_logs where booking_id = $1`, [st.b.id]);
    ok(logs.some((l) => l.action === 'crew_paid'), 'ไม่มีประวัติจ่ายค่าตัว');
    ok(!JSON.stringify(logs).includes('7777.77') && !hasFeeKey(logs), 'ประวัติงานมีค่าตัว');
  });

  test('ฟังก์ชันภายในทุกตัวเรียกจาก API ไม่ได้ (authenticated/anon) — เรียกได้เฉพาะรายการที่กำหนด', async (ctx) => {
    const rows = await ctx.pg.all(`
      select p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon
        from pg_proc as p
       where p.pronamespace = 'public'::regnamespace and p.proname like 'wed\\_%'`);
    const authOk = new Set(['wed_staff', 'wed_manager', 'wed_get_settings', 'wed_save_settings', 'wed_save_package', 'wed_delete_package',
      'wed_save_addon', 'wed_delete_addon', 'wed_save_customer', 'wed_get_customer', 'wed_save_crew', 'wed_list_crew',
      'wed_crew_schedule', 'wed_crew_payouts', 'wed_mark_crew_paid', 'wed_calendar', 'wed_day', 'wed_today', 'wed_badges',
      'wed_quote', 'wed_get_booking', 'wed_create_booking', 'wed_update_booking', 'wed_hold', 'wed_extend_hold',
      'wed_release_hold', 'wed_confirm', 'wed_mark_shot', 'wed_mark_delivered', 'wed_complete', 'wed_reopen', 'wed_postpone',
      'wed_resume', 'wed_cancel', 'wed_set_followup', 'wed_rotate_token', 'wed_set_installments', 'wed_reset_installments',
      'wed_add_payment', 'wed_void_payment', 'wed_add_charge', 'wed_void_charge', 'wed_save_deliverable',
      'wed_delete_deliverable', 'wed_deliverables_board', 'wed_report', 'wed_export_bookings', 'wed_export_payments',
      'wed_export_crew_fees', 'wed_public_booking']);
    const badAuth = rows.filter((r) => r.auth !== authOk.has(r.proname)).map((r) => `${r.proname}:${r.auth}`);
    eq(badAuth, [], 'สิทธิ์ authenticated');
    const badAnon = rows.filter((r) => r.anon !== (r.proname === 'wed_public_booking')).map((r) => r.proname);
    eq(badAnon, [], 'สิทธิ์ anon');
    ok(rows.length > 100, 'จำนวนฟังก์ชัน wed_ น้อยผิดปกติ');
    await expectErr(() => ctx.anon.all(`select public.wed_recalc(gen_random_uuid())`), 'permission denied');
  });

  test('ถังไฟล์ + นโยบาย storage: โลโก้ = ผู้จัดการ / สลิป = พนักงาน + ต้องอยู่ใต้ <booking_id>/ / เฉพาะ JPG PNG WEBP', async (ctx, st) => {
    const buckets = await ctx.pg.all(`select id, public, file_size_limit::int as lim, allowed_mime_types from storage.buckets
                                       where id like 'wedding-%' order by id`);
    eq(buckets, [
      { id: 'wedding-files', public: false, lim: 5242880, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] },
      { id: 'wedding-public', public: true, lim: 2097152, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] },
    ]);
    const ins = (s, bucket, name) => s.all(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [bucket, name]);
    await ins(st.u.mgr, 'wedding-public', `logo/${uuid()}.png`);
    await expectErr(() => ins(st.u.staff, 'wedding-public', `logo/${uuid()}.png`), 'row-level security');
    await expectErr(() => ins(st.u.mgr, 'wedding-public', `other/${uuid()}.png`), 'row-level security');
    // เฉพาะ JPG/PNG/WEBP (SVG มีสคริปต์ได้ — เปิดลิงก์ตรงแล้วรันบนโดเมน storage) / ตัวพิมพ์ใหญ่ได้ / ไม่มีนามสกุลไม่ได้
    await ins(st.u.mgr, 'wedding-public', `logo/${uuid()}.WEBP`);
    await ins(st.u.mgr, 'wedding-public', `logo/${uuid()}.jpeg`);
    for (const bad of ['svg', 'html', 'png.svg', 'gif']) {
      await expectErr(() => ins(st.u.mgr, 'wedding-public', `logo/${uuid()}.${bad}`), 'row-level security');
      await expectErr(() => ins(st.u.staff, 'wedding-files', `${st.b.id}/${uuid()}.${bad}`), 'row-level security');
    }
    await expectErr(() => ins(st.u.mgr, 'wedding-public', `logo/${uuid()}`), 'row-level security');
    await ins(st.u.staff, 'wedding-files', `${st.b.id}/slip-1.jpg`);
    await expectErr(() => ins(st.u.staff, 'wedding-files', `${uuid()}/slip-1.jpg`), 'row-level security');
    await expectErr(() => ins(st.u.staff, 'wedding-files', `${st.b.id}/../x.jpg`), 'row-level security');
    await expectErr(() => ins(st.u.newcute, 'wedding-files', `${st.b.id}/slip-2.jpg`), 'row-level security');
    await expectErr(() => ins(st.u.rental, 'wedding-files', `${st.b.id}/slip-3.jpg`), 'row-level security');
    await expectErr(() => ins(ctx.anon, 'wedding-files', `${st.b.id}/slip-4.jpg`), 'row-level security');
    eq((await st.u.staff.all(`select name from storage.objects where bucket_id = 'wedding-files'`)).length, 1);
    eq((await st.u.newcute.all(`select name from storage.objects where bucket_id = 'wedding-files'`)).length, 0);
    eq((await ctx.anon.all(`select name from storage.objects where bucket_id = 'wedding-files'`)).length, 0);
    // พนักงานลบสลิปไม่ได้ (ไม่มีนโยบายลบ) / ผู้จัดการลบโลโก้ได้
    eq((await st.u.staff.all(`delete from storage.objects where bucket_id = 'wedding-files' returning id`)).length, 0);
    eq((await st.u.mgr.all(`delete from storage.objects where bucket_id = 'wedding-public' returning id`)).length, 3);
  });

  test('Supabase ปัจจุบัน (ตารางใหม่ไม่ได้สิทธิ์อัตโนมัติ): สิทธิ์ที่ให้เองครบ พนักงานอ่าน/ทำงานได้ anon อ่านไม่ได้', async () => {
    const ctx2 = await createDb({ tableGrants: 'none' });
    try {
      const u = await makeUsers(ctx2);
      const d = await seed(ctx2, u);
      const today = await bkkToday(ctx2);
      const b = await create(u.staff, payload(d, addDays(today, 10)));
      for (const t of TABLES) {
        await u.staff.all(`select 1 from public.${t} limit 1`);
        await expectErr(() => ctx2.anon.all(`select 1 from public.${t} limit 1`), 'permission denied');
      }
      eq((await u.staff.all(`select id from public.wed_bookings`)).length, 1);
      eq((await ctx2.service.all(`select id from public.wed_bookings`)).length, 1);
      eq((await u.staff.rpc('wed_get_booking', { p_booking_id: b.id })).id, b.id);
    } finally {
      await ctx2.db.close();
    }
  });
}
