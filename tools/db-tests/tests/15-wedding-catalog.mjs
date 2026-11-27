// ตั้งค่าร้าน / แพ็กเกจ / บริการเสริม / ลูกค้า / ทีมงาน — ตรวจข้อมูล, กันซ้ำ (client_id), กันเขียนทับ (updated_at), ลบแบบปลอดภัย
import { eq, ok, money, expectErr, uuid } from '../run.mjs';
import { makeUsers, seed, payload, create, pay, bkkToday, addDays } from './lib/wed.js';

// ทดสอบกฎของ fix-07 ด้วยค่าตั้งต้นเดิม (ชำระยอดคงเหลือก่อนวันงาน 7 วัน / เงื่อนไขตั้งต้นหลายข้อ) — ข้อมูลร้านที่ fix-09 ตั้งให้บอส
//   (ชำระวันงาน + เงื่อนไข 3 ข้อ) ทดสอบใน 33-wedding-pay-on-event-day.mjs
export const dbOptions = { upTo: 'supabase-fix-08-lock-order.sql' };

export async function setup(ctx, st) {
  st.u = await makeUsers(ctx);
  st.d = await seed(ctx, st.u);
  st.today = await bkkToday(ctx);
}

export function register(test) {
  test('ตั้งค่า: ค่าเริ่มต้น, คีย์ที่ไม่ส่ง = คงเดิม, ตรวจพร้อมเพย์/บัญชี/โลโก้/ลิงก์/นโยบาย', async (ctx, st) => {
    let s = await st.u.staff.rpc('wed_get_settings');
    eq([s.shop_name, s.deposit_percent, s.min_deposit, s.balance_due_days, s.hold_hours, s.max_jobs_per_day, s.overtime_rate, s.portal_enabled,
      s.logo_url_path, s.public_url_prefix, s.bank_accounts], ['b.oncloud.wedding content', 30, 0, 7, 72, 2, 0, true, null, '/wedding-status/', []]);
    const clauses = s.terms_text.split('\n').filter((l) => /^\d+\. /.test(l));
    ok(clauses.length >= 12 && clauses.length <= 15, 'เงื่อนไขสัญญาตั้งต้นต้องมี 12–15 ข้อ');
    for (const kw of ['มัดจำ', 'เลื่อนวันงานได้ 1 ครั้ง', 'ยกเลิก', 'ไฟล์ดิบ', 'ลิขสิทธิ์', 'ค่าเดินทาง', 'ล่วงเวลา', 'เหตุสุดวิสัย', 'ข้อมูลส่วนบุคคล']) {
      ok(s.terms_text.includes(kw), 'เงื่อนไขสัญญาไม่มีเรื่อง ' + kw);
    }
    const save = (p) => st.u.mgr.rpc('wed_save_settings', { p_settings: p });
    s = await save({ promptpay_id: '0-8123-45678', overtime_rate: 1500.5, terms_text: '  1. ข้อแรก\n2. ข้อสอง  ' });
    eq([s.promptpay_id, s.overtime_rate, s.terms_text, s.shop_name], ['0812345678', 1500.5, '1. ข้อแรก\n2. ข้อสอง', 'b.oncloud.wedding content']);
    await expectErr(() => save({ promptpay_id: '12345' }), 'พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก');
    await expectErr(() => save({ promptpay_id: 'abc' }), 'พร้อมเพย์ใส่ได้เฉพาะตัวเลข');
    await expectErr(() => save({ bank_accounts: Array.from({ length: 6 }, () => ({ bank: 'a', account_no: '1', account_name: 'b' })) }), 'ไม่เกิน 5 บัญชี');
    await expectErr(() => save({ bank_accounts: [{ bank: 'a', account_no: '' }] }), 'ให้ครบทุกบัญชี');
    await expectErr(() => save({ logo_path: 'other/x.png' }), 'ไฟล์โลโก้ไม่ถูกต้อง');
    await expectErr(() => save({ line_url: 'javascript:x' }), 'ลิงก์ LINE ต้องขึ้นต้นด้วย http');
    await expectErr(() => save({ deposit_percent: 101 }), 'เปอร์เซ็นต์มัดจำต้องอยู่ระหว่าง 0 ถึง 100');
    await expectErr(() => save({ hold_hours: 0 }), 'ต้องเป็นจำนวนเต็ม 1 ถึง 720');
    await expectErr(() => save({ max_jobs_per_day: 51 }), 'ต้องเป็นจำนวนเต็ม 0 ถึง 50');
    await expectErr(() => save({ shop_name: ' ' }), 'กรุณาใส่ชื่อร้าน');
    await expectErr(() => save({ terms_text: '' }), 'กรุณาใส่เงื่อนไขสัญญา');
    await expectErr(() => save({ email: 'x@' }), 'อีเมลร้านไม่ถูกต้อง');
    await expectErr(() => save(['x']), 'ข้อมูลตั้งค่าไม่ถูกต้อง');
    s = await save({ logo_path: 'logo/1f2e.png', bank_accounts: [{ bank: 'กสิกรไทย', account_no: '123', account_name: 'ร้าน' }], booking_note: 'ขอบคุณ' });
    eq([s.logo_url_path, s.bank_accounts.length, s.booking_note], ['/storage/v1/object/public/wedding-public/logo/1f2e.png', 1, 'ขอบคุณ']);
    s = await save({ bank_accounts: null, logo_path: null });
    eq([s.bank_accounts, s.logo_url_path, s.promptpay_id], [[], null, '0812345678']);
  });

  test('แพ็กเกจ/บริการเสริม: สร้างกันซ้ำ, แก้กันเขียนทับ, ลบ = ปิดใช้งานถ้าเคยใช้ / ลบจริงถ้ายังไม่เคยใช้, ปิดแล้วเลือกใหม่ไม่ได้', async (ctx, st) => {
    const cid = uuid();
    const p1 = await st.u.mgr.rpc('wed_save_package', { p_package: { client_id: cid, name: 'ครึ่งวัน', price: 19999.99, hours: 4.5, crew_size: 2,
      deliverables: [{ name: 'ภาพ', qty: 200, unit: 'ภาพ', due_days: 21 }] } });
    eq([p1.already_saved, p1.price, p1.hours, p1.crew_size, p1.deliverables, p1.is_active, p1.bookings_count],
      [false, 19999.99, 4.5, 2, [{ name: 'ภาพ', qty: 200, unit: 'ภาพ', due_days: 21 }], true, 0]);
    const again = await st.u.mgr.rpc('wed_save_package', { p_package: { client_id: cid, name: 'อื่น' } });
    eq([again.already_saved, again.id, again.name], [true, p1.id, 'ครึ่งวัน']);
    const p2 = await st.u.mgr.rpc('wed_save_package', { p_package: { id: p1.id, updated_at: p1.updated_at, price: 21000 } });
    eq([p2.price, p2.name, p2.hours], [21000, 'ครึ่งวัน', 4.5]);
    await expectErr(() => st.u.mgr.rpc('wed_save_package', { p_package: { id: p1.id, updated_at: p1.updated_at, price: 1 } }), 'ถูกแก้ไขจากเครื่องอื่น');
    await expectErr(() => st.u.mgr.rpc('wed_save_package', { p_package: { client_id: uuid(), name: 'x', hours: 1.25 } }), 'ทศนิยม 1 ตำแหน่ง');
    await expectErr(() => st.u.mgr.rpc('wed_save_package', { p_package: { client_id: uuid(), name: 'x', crew_size: 21 } }), '0 ถึง 20');
    await expectErr(() => st.u.mgr.rpc('wed_save_package', { p_package: { client_id: uuid(), name: 'x', deliverables: [{ name: 'a', due_days: 400 }] } }), '0 ถึง 365');
    await expectErr(() => st.u.mgr.rpc('wed_save_package', { p_package: { client_id: uuid(), name: '' } }), 'กรุณาใส่ชื่อแพ็กเกจ');
    // ยังไม่เคยใช้ → ลบจริง
    const tmp = await st.u.mgr.rpc('wed_save_package', { p_package: { client_id: uuid(), name: 'ลบได้' } });
    eq(await st.u.mgr.rpc('wed_delete_package', { p_id: tmp.id }), { ok: true, id: tmp.id, deleted: true, deactivated: false });
    await expectErr(() => st.u.mgr.rpc('wed_delete_package', { p_id: tmp.id }), 'ไม่พบแพ็กเกจนี้');
    // เคยใช้ → ปิดใช้งาน งานเดิมยังจำชื่อ/ราคา
    const b = await create(st.u.staff, payload(st.d, addDays(st.today, 30), { package_id: p1.id }));
    eq(await st.u.mgr.rpc('wed_delete_package', { p_id: p1.id }), { ok: true, id: p1.id, deleted: false, deactivated: true });
    eq((await st.u.staff.rpc('wed_get_booking', { p_booking_id: b.id })).package, { id: p1.id, name: 'ครึ่งวัน', price: 21000, hours: 4.5, description: null });
    await expectErr(() => create(st.u.staff, payload(st.d, addDays(st.today, 30), { package_id: p1.id })), 'ปิดใช้งานแล้ว');
    // งานเดิมที่ใช้แพ็กเกจที่ปิดแล้ว แก้งานต่อได้ (ไม่ได้เปลี่ยนแพ็กเกจ)
    const b2 = await st.u.staff.rpc('wed_update_booking', { p_booking_id: b.id, p_updated_at: b.updated_at, p_payload: { package_id: p1.id, note: 'แก้ได้' } });
    eq(b2.note, 'แก้ได้');
    // พนักงานอ่านรายการแพ็กเกจ/บริการเสริมจากตารางได้ (ฟอร์มจอง)
    ok((await st.u.staff.all(`select id from public.wed_packages`)).length >= 2);
    ok((await st.u.staff.all(`select id from public.wed_addons`)).length >= 1);

    const a1 = await st.u.mgr.rpc('wed_save_addon', { p_addon: { client_id: uuid(), name: 'โดรน', price: 3500, unit: 'งาน' } });
    eq([a1.name, a1.price, a1.unit, a1.bookings_count], ['โดรน', 3500, 'งาน', 0]);
    await create(st.u.staff, payload(st.d, addDays(st.today, 31), { addons: [{ addon_id: a1.id }] }));
    eq((await st.u.mgr.rpc('wed_delete_addon', { p_id: a1.id })).deactivated, true);
    await expectErr(() => create(st.u.staff, payload(st.d, addDays(st.today, 31), { addons: [{ addon_id: a1.id }] })), 'ปิดใช้งานแล้ว');
    const a2 = await st.u.mgr.rpc('wed_save_addon', { p_addon: { client_id: uuid(), name: 'ไม่ได้ใช้' } });
    eq((await st.u.mgr.rpc('wed_delete_addon', { p_id: a2.id })).deleted, true);
  });

  test('ลูกค้า: สร้างกันซ้ำ, เบอร์เก็บเฉพาะตัวเลข, ช่องทาง, แก้กันเขียนทับ, ประวัติงาน + ยอดรวม', async (ctx, st) => {
    const cid = uuid();
    const c = await st.u.staff.rpc('wed_save_customer', { p_customer: { client_id: cid, name: 'แพร', partner_name: 'ภูมิ', phone: '(089) 111-2222',
      instagram: '@prae', email: 'prae@example.com', source: 'referral', note: 'เพื่อนคุณมิวแนะนำ' } });
    eq([c.already_saved, c.phone, c.source, c.source_label, c.stats.bookings], [false, '0891112222', 'referral', 'แนะนำต่อ', 0]);
    eq((await st.u.staff.rpc('wed_save_customer', { p_customer: { client_id: cid, name: 'x', phone: '0000000000' } })).already_saved, true);
    await expectErr(() => st.u.staff.rpc('wed_save_customer', { p_customer: { client_id: uuid(), name: 'x' } }), 'กรุณากรอกเบอร์โทรลูกค้า');
    await expectErr(() => st.u.staff.rpc('wed_save_customer', { p_customer: { client_id: uuid(), name: 'x', phone: '12ab' } }), 'ใส่ได้เฉพาะตัวเลข');
    await expectErr(() => st.u.staff.rpc('wed_save_customer', { p_customer: { client_id: uuid(), name: 'x', phone: '12345' } }), '9-15 หลัก');
    await expectErr(() => st.u.staff.rpc('wed_save_customer', { p_customer: { client_id: uuid(), name: 'x', phone: '0891112222', source: 'tv' } }), 'ช่องทางที่รู้จักร้านไม่ถูกต้อง');
    await expectErr(() => st.u.staff.rpc('wed_save_customer', { p_customer: { client_id: uuid(), name: 'x', phone: '0891112222', email: 'bad' } }), 'อีเมลไม่ถูกต้อง');
    const c2 = await st.u.staff.rpc('wed_save_customer', { p_customer: { id: c.id, updated_at: c.updated_at, line_id: 'prae.p' } });
    eq([c2.line_id, c2.instagram, c2.name], ['prae.p', '@prae', 'แพร']);
    await expectErr(() => st.u.staff.rpc('wed_save_customer', { p_customer: { id: c.id, updated_at: c.updated_at, line_id: 'x' } }), 'ถูกแก้ไขจากเครื่องอื่น');
    const b1 = await create(st.u.staff, payload(st.d, addDays(st.today, 30), { customer_id: c.id }));
    await pay(st.u.staff, b1.id, 2000);
    const b2 = await create(st.u.staff, payload(st.d, addDays(st.today, 90), { customer_id: c.id, package_price: 10000 }));
    await st.u.staff.rpc('wed_cancel', { p_booking_id: b2.id, p_reason: 'x' });
    const g = await st.u.staff.rpc('wed_get_customer', { p_id: c.id });
    eq(g.bookings.map((x) => x.booking_no).sort(), [b1.booking_no, b2.booking_no].sort());
    eq([g.stats.bookings, g.stats.cancelled, g.stats.active], [2, 1, 1]);
    money(g.stats.total_value, 45000);
    money(g.stats.total_paid, 2000);
    eq(g.stats.last_event_date, addDays(st.today, 30));
    await expectErr(() => st.u.staff.rpc('wed_get_customer', { p_id: uuid() }), 'ไม่พบข้อมูลลูกค้านี้');
  });

  test('ทีมงาน: ผู้จัดการสร้าง/แก้, สีต้องเป็น #RRGGBB, ปิดใช้งาน, รายชื่อเรียงคนที่ใช้งานก่อน, ตารางงานรายคน', async (ctx, st) => {
    await expectErr(() => st.u.mgr.rpc('wed_save_crew', { p_crew: { client_id: uuid(), name: 'x', color: 'red' } }), 'สีประจำตัวไม่ถูกต้อง');
    await expectErr(() => st.u.mgr.rpc('wed_save_crew', { p_crew: { client_id: uuid(), name: 'x', role: 'chef' } }), 'หน้าที่ของทีมงานไม่ถูกต้อง');
    await expectErr(() => st.u.mgr.rpc('wed_save_crew', { p_crew: { client_id: uuid(), name: 'x', default_fee: -1 } }), 'ต้องไม่ติดลบ');
    const cid = uuid();
    const c = await st.u.mgr.rpc('wed_save_crew', { p_crew: { client_id: cid, name: 'อ้อม แต่งหน้า', nickname: 'อ้อม', role: 'makeup', color: '#a1b2c3', phone: '090-000-1111' } });
    eq([c.color, c.phone, c.default_fee, c.role_label, c.already_saved], ['#A1B2C3', '0900001111', 0, 'แต่งหน้า', false]);
    eq((await st.u.mgr.rpc('wed_save_crew', { p_crew: { client_id: cid, name: 'ซ้ำ' } })).already_saved, true);
    const c2 = await st.u.mgr.rpc('wed_save_crew', { p_crew: { id: c.id, updated_at: c.updated_at, is_active: false } });
    eq([c2.is_active, c2.name], [false, 'อ้อม แต่งหน้า']);
    await expectErr(() => st.u.mgr.rpc('wed_save_crew', { p_crew: { id: c.id, updated_at: c.updated_at, name: 'x' } }), 'ถูกแก้ไขจากเครื่องอื่น');
    const list = await st.u.staff.rpc('wed_list_crew');
    eq(list[list.length - 1].id, c.id, 'คนที่ปิดใช้งานอยู่ท้ายรายการ');
    eq(Object.keys(list[0]).sort(), ['color', 'created_at', 'id', 'is_active', 'line_id', 'name', 'nickname', 'note', 'phone', 'role', 'role_label', 'updated_at']);
    const D = addDays(st.today, 12);
    await create(st.u.staff, payload(st.d, D, { status: 'hold', sessions: [{ date: D, start_time: '09:00', crew: [{ crew_id: st.d.crew[2].id, role: 'drone' }] }] }));
    await create(st.u.staff, payload(st.d, D, { sessions: [{ date: D, crew: [st.d.crew[2].id] }] }));   // สอบถาม ไม่อยู่ในตารางงาน
    const sch = await st.u.staff.rpc('wed_crew_schedule', { p_crew_id: st.d.crew[2].id, p_from: st.today, p_to: addDays(st.today, 30) });
    eq([sch.crew.name, sch.sessions.length, sch.sessions[0].role_label, sch.sessions[0].start_time, sch.totals], ['ต้น โดรน', 1, 'โดรน', '09:00', { sessions: 1, days: 1 }]);
    await expectErr(() => st.u.staff.rpc('wed_crew_schedule', { p_crew_id: uuid(), p_from: st.today, p_to: st.today }), 'ไม่พบทีมงานคนนี้');
    await expectErr(() => st.u.staff.rpc('wed_crew_schedule', { p_crew_id: c.id, p_from: st.today, p_to: addDays(st.today, 366) }), 'ไม่เกิน 1 ปี');
  });
}
