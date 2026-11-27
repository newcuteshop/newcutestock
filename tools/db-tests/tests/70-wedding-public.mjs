// ลิงก์ติดตามงานของคู่บ่าวสาว /wedding-status/<token> (anon): ข้อมูลที่เห็นได้, ปิดบังข้อมูลส่วนตัว, ลิงก์ส่งงาน, ยกเลิก/ปิดลิงก์/เปลี่ยนลิงก์
import { eq, ok, money, expectErr, uuid } from '../run.mjs';
import { makeUsers, seed, payload, create, pay, bkkToday, addDays } from './lib/wed.js';

export async function setup(ctx, st) {
  st.u = await makeUsers(ctx);
  st.d = await seed(ctx, st.u);
  st.today = await bkkToday(ctx);
  await st.u.mgr.rpc('wed_save_settings', { p_settings: {
    phone: '02-123-4567', line_id: '@boncloud', line_url: 'https://line.me/R/ti/p/@boncloud', instagram: 'b.oncloud.wedding',
    promptpay_id: '089-999-8888', promptpay_name: 'บีออนคลาวด์', bank_accounts: [{ bank: 'กสิกรไทย', account_no: '123-4-56789-0', account_name: 'บีออนคลาวด์' }],
    logo_path: 'logo/abc.png', booking_note: 'ขอบคุณที่จองกับเรา' } });
  const D = addDays(st.today, 45);
  st.b = await create(st.u.mgr, payload(st.d, D, {
    status: 'confirmed', force: true, note: 'ลูกค้าจ่ายช้า ระวัง', customer_note: 'อยากได้ภาพแคนดิด',
    coordinator_name: 'พี่นุ่น', coordinator_phone: '0811111111',
    sessions: [{ date: D, title: 'งานเลี้ยงเย็น', start_time: '18:00', end_time: '22:00', call_time: '16:00', venue_name: 'โรงแรม', venue_address: 'ถนน 1',
      map_url: 'https://maps.example/x', notes: 'โน้ตภายในทีม', dress_code: 'ชุดดำ', run_sheet: [{ time: '19:19', text: 'เข้าห้อง' }],
      crew: [{ crew_id: st.d.crew[0].id, fee: 4321 }] }, { date: D, session_type: 'other', status: 'cancelled', title: 'คิวที่ยกเลิก' }],
  }));
  await pay(st.u.staff, st.b.id, 13500);
  await st.u.staff.rpc('wed_update_booking', { p_booking_id: st.b.id, p_updated_at: (await st.u.staff.rpc('wed_get_booking', { p_booking_id: st.b.id })).updated_at,
    p_payload: {} });
}

export function register(test) {
  test('anon เปิดลิงก์ได้: ข้อมูลร้าน/คิว/กำหนดการ/แพ็กเกจ/เงิน/งวด/พร้อมเพย์ — ชื่อ/เบอร์ปิดบางส่วน ไม่มีข้อมูลภายในเลย', async (ctx, st) => {
    const r = await ctx.anon.rpc('wed_public_booking', { p_token: st.b.public_token });
    eq([r.state, r.booking_no, r.status, r.status_label, r.couple_names], ['ok', st.b.booking_no, 'confirmed', 'ยืนยันแล้ว', 'คุณมิว & คุณเจ']);
    eq(r.shop, { name: 'b.oncloud.wedding content', tagline: null, phone: '02-123-4567', line_id: '@boncloud', line_url: 'https://line.me/R/ti/p/@boncloud',
      instagram: 'b.oncloud.wedding', facebook: null, tiktok: null, email: null, logo_url_path: '/storage/v1/object/public/wedding-public/logo/abc.png' });
    eq([r.customer_name_masked, r.phone_masked], ['มิ*** ใ.', '08xxxx5678']);
    eq(r.sessions.length, 1, 'คิวที่ยกเลิกไม่แสดง');
    eq(Object.keys(r.sessions[0]).sort(), ['date', 'end_time', 'map_url', 'run_sheet', 'session_type', 'start_time', 'status', 'title', 'type_label', 'venue_address', 'venue_name']);
    eq(r.sessions[0].run_sheet, [{ time: '19:19', text: 'เข้าห้อง' }]);
    eq([r.package_name, r.booking_note], ['แพ็กเกจเต็มวัน', 'ขอบคุณที่จองกับเรา']);
    money(r.money.grand_total, 45000);
    money(r.money.paid, 13500);
    eq(r.money.deposit_met, true);
    eq(r.installments.map((i) => [i.label, i.status]), [['มัดจำ', 'paid'], ['ยอดคงเหลือ', 'upcoming']]);
    eq([r.next_due.label, r.next_due.amount], ['ยอดคงเหลือ', 31500]);
    eq(r.payment_info, { promptpay_id: '0899998888', promptpay_name: 'บีออนคลาวด์', bank_accounts: [{ bank: 'กสิกรไทย', account_no: '123-4-56789-0', account_name: 'บีออนคลาวด์' }] });
    // เงื่อนไขของร้านหลัง supabase-fix-09 = 3 บรรทัดตามฟอร์มร้าน (ขึ้นต้นด้วย "-")
    ok(r.terms_text.startsWith('-กรณีลูกค้ายกเลิก/เลื่อนวัน'), 'ไม่มีเงื่อนไขสัญญา');
    const text = JSON.stringify(r);
    for (const secret of ['0812345678"', 'mewjay', 'ลูกค้าจ่ายช้า', 'อยากได้ภาพแคนดิด', 'โน้ตภายในทีม', 'ชุดดำ', 'พี่นุ่น', '0811111111', 'สมชาย', 'ชาย"', '4321',
      '"fee', '"crew', '"logs', '"note"', 'call_time', '"customer"', 'public_token', st.d.cust.id, 'created_by']) {
      ok(!text.includes(secret), 'ลิงก์ลูกค้ามีข้อมูลภายใน: ' + secret);
    }
    // ผู้ใช้ที่ล็อกอินก็เปิดลิงก์ได้ (เช่นพนักงานกดดูจากเครื่องตัวเอง)
    eq((await st.u.newcute.rpc('wed_public_booking', { p_token: st.b.public_token })).booking_no, st.b.booking_no);
    eq((await ctx.service.rpc('wed_public_booking', { p_token: st.b.public_token.toUpperCase() })).booking_no, st.b.booking_no);
  });

  test('ลิงก์ส่งงานเห็นเฉพาะรายการที่ "ส่งแล้ว"', async (ctx, st) => {
    const b = await st.u.staff.rpc('wed_get_booking', { p_booking_id: st.b.id });
    const [d1, d2] = b.deliverables;
    await st.u.staff.rpc('wed_save_deliverable', { p_booking_id: b.id, p_item: { id: d1.id, status: 'delivered', link_url: 'https://drive.example/done' } });
    await st.u.staff.rpc('wed_save_deliverable', { p_booking_id: b.id, p_item: { id: d2.id, status: 'review', link_url: 'https://drive.example/draft' } });
    const r = await ctx.anon.rpc('wed_public_booking', { p_token: st.b.public_token });
    eq(r.deliverables.map((x) => [x.name, x.status_label, x.link_url]), [
      ['ภาพตกแต่ง', 'ส่งแล้ว', 'https://drive.example/done'], ['วิดีโอไฮไลต์', 'รอตรวจ', null]]);
    ok(!JSON.stringify(r).includes('draft'), 'ลิงก์ร่างหลุด');
  });

  test('ลิงก์ผิดรูปแบบ/ไม่พบ = ข้อความเดียวกัน / เปลี่ยนลิงก์ใหม่ → ลิงก์เดิมใช้ไม่ได้ทันที', async (ctx, st) => {
    for (const t of ['', 'abc', 'g'.repeat(64), st.b.public_token.slice(0, 63), "' or 1=1 --", 'f'.repeat(64)]) {
      await expectErr(() => ctx.anon.rpc('wed_public_booking', { p_token: t }), 'ไม่พบงานนี้');
    }
    await expectErr(() => ctx.anon.rpc('wed_public_booking', { p_token: null }), 'ไม่พบงานนี้');
    const old = st.b.public_token;
    const r = await st.u.staff.rpc('wed_rotate_token', { p_booking_id: st.b.id });
    ok(/^[0-9a-f]{64}$/.test(r.public_token) && r.public_token !== old, 'ลิงก์ใหม่ผิดรูปแบบ');
    eq(r.public_url_path, '/wedding-status/' + r.public_token);
    await expectErr(() => ctx.anon.rpc('wed_public_booking', { p_token: old }), 'ไม่พบงานนี้');
    eq((await ctx.anon.rpc('wed_public_booking', { p_token: r.public_token })).booking_no, st.b.booking_no);
    st.b.public_token = r.public_token;
    ok(r.logs.some((l) => l.action === 'rotate_token'), 'ไม่มีประวัติเปลี่ยนลิงก์');
  });

  test('งานที่ยกเลิก = ข้อมูลน้อยที่สุด / ร้านปิดลิงก์ลูกค้า = ไม่บอกว่ามีงานนี้ (ข้อมูลร้านอย่างเดียว)', async (ctx, st) => {
    const c = await create(st.u.staff, payload(st.d, addDays(st.today, 60), { couple_names: 'คู่ยกเลิก' }));
    await pay(st.u.staff, c.id, 1000);
    await st.u.staff.rpc('wed_cancel', { p_booking_id: c.id, p_reason: 'เปลี่ยนใจ' });
    const r = await ctx.anon.rpc('wed_public_booking', { p_token: c.public_token });
    eq(Object.keys(r).sort(), ['booking_no', 'couple_names', 'shop', 'state', 'status', 'status_label']);
    eq([r.state, r.status, r.status_label], ['cancelled', 'cancelled', 'ยกเลิกแล้ว']);
    await st.u.mgr.rpc('wed_save_settings', { p_settings: { portal_enabled: false } });
    try {
      const d = await ctx.anon.rpc('wed_public_booking', { p_token: st.b.public_token });
      eq(Object.keys(d).sort(), ['shop', 'state']);
      eq([d.state, d.shop.name, d.shop.phone], ['disabled', 'b.oncloud.wedding content', '02-123-4567']);
      eq((await ctx.anon.rpc('wed_public_booking', { p_token: 'nope' })).state, 'disabled', 'ปิดลิงก์แล้วไม่บอกว่าลิงก์ผิดหรือถูก');
    } finally {
      await st.u.mgr.rpc('wed_save_settings', { p_settings: { portal_enabled: true } });
    }
    eq((await ctx.anon.rpc('wed_public_booking', { p_token: st.b.public_token })).state, 'ok');
  });

  test('anon: เรียกได้แค่ wed_public_booking — อ่านตาราง/เรียกฟังก์ชันอื่นไม่ได้เลย', async (ctx, st) => {
    for (const t of ['wed_bookings', 'wed_customers', 'wed_settings', 'wed_payments', 'wed_sessions', 'wed_deliverables']) {
      await expectErr(() => ctx.anon.all(`select * from public.${t}`), 'permission denied', { code: '42501' });
    }
    for (const [fn, args] of [['wed_get_booking', { p_booking_id: st.b.id }], ['wed_calendar', { p_from: st.today, p_to: st.today }],
      ['wed_badges', {}], ['wed_add_payment', { p_client_id: uuid(), p_booking_id: st.b.id, p_kind: 'payment', p_method: 'cash', p_amount: 1 }],
      ['wed_booking_json', { p_booking_id: st.b.id }], ['wed_settings_json', {}], ['wed_mask_phone', { p_phone: '0812345678' }]]) {
      await expectErr(() => ctx.anon.rpc(fn, args), 'permission denied', { code: '42501' });
    }
  });
}
