// ปฏิทิน / รายละเอียดวัน / ภาพรวมวันนี้ / ตัวเลขบนเมนู / ล็อกคิวหมดเวลา / ขอบวันตามเวลาไทย (ฐานข้อมูลตั้งเวลาเป็น UTC)
import { eq, ok, money, expectErr, uuid } from '../run.mjs';
import { makeUsers, seed, payload, create, pay, bkkToday, addDays } from './lib/wed.js';

export async function setup(ctx, st) {
  st.u = await makeUsers(ctx);
  st.d = await seed(ctx, st.u);
  st.today = await bkkToday(ctx);
}

export function register(test) {
  test('ฐานข้อมูลเป็น UTC แต่ "วันนี้" = วันตามเวลาไทย (ภาพรวม/เลขเอกสาร)', async (ctx, st) => {
    const r = await ctx.pg.one(`select current_setting('timezone') as tz, (now() at time zone 'Asia/Bangkok')::date::text as bkk`);
    eq(r.tz, 'UTC');
    eq((await st.u.staff.rpc('wed_today', {})).day, r.bkk);
    const b = await create(st.u.staff, payload(st.d, addDays(st.today, 5)));
    eq(b.booking_no.slice(3, 11), r.bkk.replaceAll('-', ''));
  });

  test('ปฏิทิน: วันละคิว, นับงาน/เต็ม, รวมงานสอบถามได้, กรองทีมงาน, ไม่แสดงงานเลื่อน/ยกเลิก, ช่วงไม่เกิน 62 วัน', async (ctx, st) => {
    const D = addDays(st.today, 100);
    const A = st.d.crew[0].id;
    const c1 = await create(st.u.staff, payload(st.d, D, { status: 'confirmed', force: true, couple_names: 'ยืนยัน',
      sessions: [{ date: D, start_time: '16:00', end_time: '22:00', call_time: '15:00', crew: [A] }, { date: D, session_type: 'ceremony', start_time: '07:00', end_time: '11:00' }] }));
    const h1 = await create(st.u.staff, payload(st.d, D, { status: 'hold', couple_names: 'ล็อก' }));
    const q1 = await create(st.u.staff, payload(st.d, D, { couple_names: 'ถาม' }));
    const p1 = await create(st.u.staff, payload(st.d, addDays(D, 1), { status: 'hold', couple_names: 'เลื่อน' }));
    await st.u.staff.rpc('wed_postpone', { p_booking_id: p1.id, p_reason: 'เลื่อน' });
    const x1 = await create(st.u.staff, payload(st.d, D, { couple_names: 'ยกเลิก' }));
    await st.u.staff.rpc('wed_cancel', { p_booking_id: x1.id, p_reason: 'x' });

    const cal = await st.u.staff.rpc('wed_calendar', { p_from: addDays(D, -1), p_to: addDays(D, 1) });
    eq([cal.from, cal.to, cal.capacity, cal.days.length], [addDays(D, -1), addDays(D, 1), 2, 3]);
    const day = cal.days[1];
    eq([day.day, day.count_jobs, day.full], [D, 2, true]);
    // เรียงตามเวลาถึงงาน/เวลาเริ่ม: 07:00 พิธีเช้า, 15:00 (ถึงงาน) งานเลี้ยง, แล้วงานล็อกคิว 17:00
    eq(day.sessions.map((s) => [s.couple_names, s.start_time, s.call_time, s.type_label, s.status]), [
      ['ยืนยัน', '07:00', null, 'พิธีเช้า', 'confirmed'],
      ['ยืนยัน', '16:00', '15:00', 'งานเลี้ยง', 'confirmed'],
      ['ล็อก', '17:00', '15:30', 'งานเลี้ยง', 'hold']]);
    eq(Object.keys(day.sessions[1]).sort(), ['booking_id', 'booking_no', 'call_time', 'couple_names', 'crew', 'date', 'deposit_met', 'due',
      'end_time', 'has_conflict', 'map_url', 'session_id', 'session_status', 'session_type', 'start_time', 'status', 'status_label', 'title',
      'type_label', 'venue_name']);
    eq(day.sessions[1].crew.map((c) => [c.name, c.nickname, c.role_label, c.color]), [['สมชาย ช่างภาพ', 'ชาย', 'ช่างภาพ', '#AA3355']]);
    eq(cal.days[2].sessions, [], 'งานที่เลื่อนไม่แสดง');
    const withInq = await st.u.staff.rpc('wed_calendar', { p_from: D, p_to: D, p_include_inquiries: true });
    eq(withInq.days[0].sessions.map((s) => s.couple_names).sort(), ['ถาม', 'ยืนยัน', 'ยืนยัน', 'ล็อก'].sort());
    eq(withInq.days[0].count_jobs, 2, 'สอบถามไม่นับเป็นงาน');
    const byCrew = await st.u.staff.rpc('wed_calendar', { p_from: D, p_to: D, p_crew_id: A });
    eq(byCrew.days[0].sessions.map((s) => s.session_id), [c1.sessions[0].id]);
    eq(byCrew.days[0].count_jobs, 2, 'นับงานไม่ขึ้นกับตัวกรอง');
    await expectErr(() => st.u.staff.rpc('wed_calendar', { p_from: D, p_to: addDays(D, 62) }), 'ไม่เกิน 62 วัน');
    eq((await st.u.staff.rpc('wed_calendar', { p_from: D, p_to: addDays(D, 61) })).days.length, 62);
    await expectErr(() => st.u.staff.rpc('wed_calendar', { p_from: D, p_to: addDays(D, -1) }), 'ช่วงวันที่ไม่ถูกต้อง');
    eq([h1.status, q1.status], ['hold', 'inquiry']);
  });

  test('รายละเอียดวัน: ทุกอย่างที่ทีมต้องรู้ (เวลา/สถานที่/กำหนดการ/ลูกค้า/เงิน/งานส่ง) — ค่าตัวเฉพาะผู้จัดการ', async (ctx, st) => {
    const D = addDays(st.today, 120);
    const b = await create(st.u.staff, payload(st.d, D, {
      couple_names: 'คุณฟ้า & คุณภู', coordinator_name: 'พี่นุ่น', coordinator_phone: '0811111111', customer_note: 'ขอภาพครอบครัวเยอะๆ', note: 'ภายใน',
      mood_link: 'https://pin.example/board', addons: [{ addon_id: st.d.addon.id, qty: 2 }],
      sessions: [{ date: D, session_type: 'ceremony', title: 'พิธีสงฆ์', start_time: '07:00', end_time: '12:00', call_time: '06:00',
        venue_name: 'บ้านเจ้าสาว', venue_address: '99 ถ.สุขุมวิท', venue_contact: 'แม่เจ้าสาว 089', map_url: 'https://maps.example/1',
        dress_code: 'โทนครีม', notes: 'ห้ามแฟลชในพิธี', run_sheet: [{ time: '07:09', text: 'ตักบาตร' }], crew: [{ crew_id: st.d.crew[0].id, role: 'content' }] }],
    }));
    await pay(st.u.staff, b.id, 5000);
    const day = await st.u.staff.rpc('wed_day', { p_day: D });
    eq([day.day, day.count_jobs, day.full, day.capacity], [D, 0, false, 2], 'สอบถามแสดงในวันแต่ไม่นับเป็นงาน');
    const s = day.sessions[0];
    eq([s.title, s.start_time, s.end_time, s.call_time, s.venue_name, s.venue_address, s.venue_contact, s.map_url, s.dress_code, s.notes],
      ['พิธีสงฆ์', '07:00', '12:00', '06:00', 'บ้านเจ้าสาว', '99 ถ.สุขุมวิท', 'แม่เจ้าสาว 089', 'https://maps.example/1', 'โทนครีม', 'ห้ามแฟลชในพิธี']);
    eq(s.run_sheet, [{ time: '07:09', text: 'ตักบาตร' }]);
    eq(s.customer, { name: 'มิว ใจดี', partner_name: 'เจ รักดี', phone: '0812345678', line_id: 'mewjay', instagram: null });
    eq(s.coordinator, { name: 'พี่นุ่น', phone: '0811111111' });
    eq([s.package_name, s.addons, s.customer_note, s.note, s.mood_link], ['แพ็กเกจเต็มวัน', [{ name: 'ชั่วโมงเพิ่ม', qty: 2, unit: 'ชม.' }], 'ขอภาพครอบครัวเยอะๆ', 'ภายใน', 'https://pin.example/board']);
    money(s.money.grand_total, 48000);
    money(s.money.paid, 5000);
    eq(s.money.next_due.label, 'มัดจำ');
    money(s.money.next_due.amount, 9400);
    eq(s.deliverables, { total: 0, delivered: 0, items: [] });
    eq(s.crew.map((c) => [c.role, c.role_label, 'fee' in c]), [['content', 'คอนเทนต์', false]]);
    const md = await st.u.mgr.rpc('wed_day', { p_day: D });
    eq(md.sessions[0].crew[0].fee, 2500);
    await expectErr(() => st.u.staff.rpc('wed_day', { p_day: null }), 'กรุณาเลือกวันที่');
  });

  test('ภาพรวมวันนี้ + ตัวเลขบนเมนู: คิววันนี้, 7 วันข้างหน้า, ต้องติดตาม, ล็อกคิวใกล้หมด, งวดค้าง/เลยกำหนด, งานส่งใกล้กำหนด', async (ctx, st) => {
    const T = st.today;
    const before = await st.u.staff.rpc('wed_badges');
    const t1 = await create(st.u.staff, payload(st.d, T, { status: 'confirmed', force: true, couple_names: 'งานวันนี้' }));
    const n1 = await create(st.u.staff, payload(st.d, addDays(T, 3), { status: 'hold', hold_hours: 5, couple_names: 'อีก 3 วัน' }));
    const n2 = await create(st.u.staff, payload(st.d, addDays(T, 8), { status: 'hold', couple_names: 'อีก 8 วัน' }));
    const f1 = await create(st.u.staff, payload(st.d, addDays(T, 200), { couple_names: 'ติดตาม', followup_date: T, followup_note: 'โทรถามแพ็กเกจ' }));
    await create(st.u.staff, payload(st.d, addDays(T, 200), { couple_names: 'ติดตามพรุ่งนี้', followup_date: addDays(T, 1) }));
    // งวดเลยกำหนด: ตั้งงวดเองให้งวดแรกครบกำหนดเมื่อวาน
    await st.u.staff.rpc('wed_set_installments', { p_booking_id: n2.id, p_items: [{ amount: 10000, due_date: addDays(T, -1) }, { amount: 35000, due_date: addDays(T, 5) }] });
    const tod = await st.u.staff.rpc('wed_today', {});
    eq(tod.today_sessions.filter((s) => s.booking_id === t1.id).length, 1);
    ok('customer' in tod.today_sessions[0] && 'run_sheet' in tod.today_sessions[0], 'คิววันนี้ต้องเป็นแบบละเอียด');
    ok(tod.next7.some((s) => s.booking_id === n1.id) && !tod.next7.some((s) => s.booking_id === n2.id), '7 วันข้างหน้าผิด');
    eq(tod.followups.map((x) => [x.couple_names, x.followup_note]), [['ติดตาม', 'โทรถามแพ็กเกจ']]);
    eq(tod.holds_expiring.map((x) => x.id), [n1.id]);
    const inst = tod.installments_due.filter((x) => x.booking_id === n2.id);
    eq(inst.map((x) => [x.seq, x.overdue, x.amount_remaining]), [[1, true, 10000], [2, false, 35000]]);
    ok(tod.installments_due.some((x) => x.booking_id === t1.id && x.seq === 1 && !x.overdue), 'งวดมัดจำครบกำหนดวันนี้ต้องอยู่ในรายการ');
    eq([tod.month.month, tod.month.bookings_confirmed >= 1, 'revenue' in tod.month], [T.slice(0, 7), true, false]);
    const bd = await st.u.staff.rpc('wed_badges');
    eq(bd.followups - before.followups, 1);
    eq(bd.holds_expiring - before.holds_expiring, 1);
    eq(bd.installments_overdue - before.installments_overdue, 1);
    // จ่ายงวดที่เลยกำหนด → หายจากตัวเลข
    await pay(st.u.staff, n2.id, 10000);
    eq((await st.u.staff.rpc('wed_badges')).installments_overdue, before.installments_overdue);
    // ยกเลิกงานที่ต้องติดตาม → หายจากรายการ
    await st.u.staff.rpc('wed_cancel', { p_booking_id: f1.id, p_reason: 'ไม่สนใจ' });
    eq((await st.u.staff.rpc('wed_badges')).followups, before.followups);
    // ตั้งวันติดตามผ่าน wed_set_followup
    const sf = await st.u.staff.rpc('wed_set_followup', { p_booking_id: n2.id, p_date: T, p_note: 'ทวงงวด 2' });
    eq([sf.followup_date, sf.followup_note], [T, 'ทวงงวด 2']);
    eq((await st.u.staff.rpc('wed_badges')).followups, before.followups + 1);
    const cl = await st.u.staff.rpc('wed_set_followup', { p_booking_id: n2.id, p_date: null, p_note: null });
    eq([cl.followup_date, cl.followup_note], [null, null]);
    // รายได้เดือนนี้ (ผู้จัดการ) = เงินรับ − คืน ตามวันที่รับเงิน
    const m = await st.u.mgr.rpc('wed_today', {});
    ok(m.month.revenue >= 10000, 'รายได้ของเดือนไม่รวมเงินที่เพิ่งรับ');
  });

  test('ล็อกคิวหมดเวลา → กลับเป็นสอบถาม (ไม่ยกเลิก) เมื่อเปิดหน้าใดก็ได้ / มีเงินรับแล้ว = คงล็อกคิวไว้', async (ctx, st) => {
    const D = addDays(st.today, 150);
    const a = await create(st.u.staff, payload(st.d, D, { status: 'hold', couple_names: 'หมดเวลา' }));
    const b = await create(st.u.staff, payload(st.d, D, { status: 'hold', couple_names: 'มีมัดจำบางส่วน' }));
    await pay(st.u.staff, b.id, 500);
    await ctx.pg.query(`update public.wed_bookings set hold_until = now() - interval '1 minute' where id = any($1::uuid[])`, [[a.id, b.id]]);
    await st.u.staff.rpc('wed_badges');
    const ra = await st.u.staff.rpc('wed_get_booking', { p_booking_id: a.id });
    eq([ra.status, ra.hold_until], ['inquiry', null]);
    const lg = ra.logs.find((l) => l.action === 'hold_expired');
    ok(lg && lg.actor_name === 'ระบบ', 'ไม่มีประวัติหมดเวลาล็อกคิวจากระบบ');
    eq((await st.u.staff.rpc('wed_get_booking', { p_booking_id: b.id })).status, 'hold');
    // ยกเลิกรายการเงิน → ไม่มีเงินแล้ว → หมดเวลาจริง
    const p = (await st.u.staff.rpc('wed_get_booking', { p_booking_id: b.id })).payments[0];
    await st.u.staff.rpc('wed_void_payment', { p_payment_id: p.id, p_reason: 'โอนผิด' });
    eq((await st.u.staff.rpc('wed_calendar', { p_from: D, p_to: D })).days[0].count_jobs, 0);
    eq((await st.u.staff.rpc('wed_get_booking', { p_booking_id: b.id })).status, 'inquiry');
    // ลิงก์ลูกค้าก็ปล่อยคิวที่หมดเวลา
    const c = await create(st.u.staff, payload(st.d, D, { status: 'hold' }));
    await ctx.pg.query(`update public.wed_bookings set hold_until = now() - interval '1 second' where id = $1`, [c.id]);
    eq((await ctx.anon.rpc('wed_public_booking', { p_token: c.public_token })).status, 'inquiry');
  });

  test('ขอบวันตามเวลาไทย: งานที่สร้าง/ยืนยัน 00:00:01 น. ไทยของวันที่ 1 นับเป็นเดือนนี้ / 23:59:59 น. วันก่อนหน้าไม่นับ', async (ctx, st) => {
    const T = st.today;
    const monthStart = T.slice(0, 8) + '01';
    const a = await create(st.u.staff, payload(st.d, addDays(T, 300), { status: 'confirmed', force: true }));
    const b = await create(st.u.staff, payload(st.d, addDays(T, 301), { status: 'confirmed', force: true }));
    const base0 = await st.u.staff.rpc('wed_today', {});
    const ts = (sec) => `(('${monthStart}'::date)::timestamp at time zone 'Asia/Bangkok') + interval '${sec} second'`;
    await ctx.pg.query(`update public.wed_bookings set created_at = ${ts(1)}, confirmed_at = ${ts(1)} where id = $1`, [a.id]);
    await ctx.pg.query(`update public.wed_bookings set created_at = ${ts(-1)}, confirmed_at = ${ts(-1)} where id = $1`, [b.id]);
    // ตรวจว่าเวลาที่ตั้งเป็นวันก่อนหน้าแบบ UTC จริง (ถ้านับแบบ UTC จะได้ผลผิด)
    const chk = await ctx.pg.one(`select (created_at at time zone 'UTC')::date::text as utc_day from public.wed_bookings where id = $1`, [a.id]);
    eq(chk.utc_day, addDays(monthStart, -1));
    const t = await st.u.staff.rpc('wed_today', {});
    eq(t.month.bookings_confirmed, base0.month.bookings_confirmed - 1);
    eq(t.month.inquiries_new, base0.month.inquiries_new - 1);
    const t2 = await st.u.staff.rpc('wed_today', { p_day: addDays(monthStart, -1) });
    ok(t2.month.bookings_confirmed >= 1, 'งานที่ยืนยัน 23:59:59 น. ต้องนับในเดือนก่อน');
  });
}
