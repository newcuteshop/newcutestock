// คิวเต็ม (จำนวนงานต่อวัน + ยืนยันแบบบังคับ) และทีมงานชนคิว (เวลาทับกัน / เวลาถึงงาน / ไม่มีเวลา = ทั้งวัน)
import { eq, ok, expectErr, uuid } from '../run.mjs';
import { makeUsers, seed, payload, create, bkkToday, addDays } from './lib/wed.js';

export async function setup(ctx, st) {
  st.u = await makeUsers(ctx);
  st.d = await seed(ctx, st.u);
  st.today = await bkkToday(ctx);
}

const S = (date, start, end, crew = [], extra = {}) => ({ session_type: 'reception', date, start_time: start, end_time: end, crew, ...extra });

export function register(test) {
  test('คิวเต็ม: งานที่ 3 ของวัน (รับได้ 2) ต้องบังคับ, สอบถามไม่นับ, งานเดียวหลายคิวในวันเดียว = 1 งาน', async (ctx, st) => {
    const D = addDays(st.today, 40);
    const a = await create(st.u.staff, payload(st.d, D, { status: 'confirmed', force: true, couple_names: 'คู่ A',
      sessions: [S(D, '07:00', '10:00', [], { session_type: 'ceremony' }), S(D, '18:00', '22:00')] }));
    const b = await create(st.u.staff, payload(st.d, D, { status: 'hold', couple_names: 'คู่ B' }));
    eq([a.status, b.status], ['confirmed', 'hold']);
    eq(b.capacity_warnings, []);
    // สอบถามไม่กันคิว — สร้างได้เสมอ
    const inq = await create(st.u.staff, payload(st.d, D, { couple_names: 'คู่ C' }));
    eq(inq.status, 'inquiry');
    const err = await expectErr(() => create(st.u.staff, payload(st.d, D, { status: 'hold', couple_names: 'คู่ D' })),
      'รับงานได้ 2 งานต่อวัน', { hint: 'wed_capacity' });
    ok(err.message.includes(a.booking_no) && err.message.includes(b.booking_no) && err.message.includes('คู่ A'), 'ข้อความไม่บอกงานที่มีอยู่: ' + err.message);
    ok(!err.message.includes(inq.booking_no), 'งานสอบถามไม่ควรนับ');
    await expectErr(() => create(st.u.staff, payload(st.d, D, { status: 'confirmed', couple_names: 'คู่ D' })), 'รับงานได้ 2', { hint: 'wed_capacity' });
    eq((await ctx.pg.one(`select count(*)::int as n from public.wed_bookings where couple_names = 'คู่ D'`)).n, 0, 'สร้างไม่สำเร็จต้องไม่เหลือแถว');
    // ล็อกคิว/ยืนยันจากงานสอบถาม = ต้องบังคับเหมือนกัน
    await expectErr(() => st.u.staff.rpc('wed_hold', { p_booking_id: inq.id }), 'รับงานได้ 2', { hint: 'wed_capacity' });
    await expectErr(() => st.u.staff.rpc('wed_confirm', { p_booking_id: inq.id }), 'รับงานได้ 2', { hint: 'wed_capacity' });
    // quote บอกล่วงหน้า
    const q = await st.u.staff.rpc('wed_quote', { p_payload: payload(st.d, D, { status: 'hold' }) });
    eq([q.counts_capacity, q.capacity_warnings.length, q.capacity_warnings[0].count_jobs, q.capacity_warnings[0].max], [true, 1, 3, 2]);
    eq(q.capacity_warnings[0].others.map((o) => o.booking_no).sort(), [a.booking_no, b.booking_no].sort());
    eq(q.sessions[0].jobs_that_day, 2);
    // บังคับ = ได้ + จดประวัติ
    const forced = await st.u.staff.rpc('wed_hold', { p_booking_id: inq.id, p_force: true });
    eq(forced.status, 'hold');
    eq(forced.logs.find((l) => l.action === 'hold').detail.capacity_over, true);
    eq(forced.capacity_warnings.length, 1);
    const day = await st.u.staff.rpc('wed_day', { p_day: D });
    eq([day.count_jobs, day.full, day.capacity], [3, true, 2]);
    // แก้งานเดิมที่อยู่ในวันเต็ม (ไม่ได้เพิ่มวันใหม่) → ไม่ถามซ้ำ
    const a2 = await st.u.staff.rpc('wed_update_booking', { p_booking_id: a.id, p_updated_at: a.updated_at,
      p_payload: { note: 'แก้หมายเหตุ', sessions: a.sessions.map((s) => ({ id: s.id, session_type: s.session_type, date: D, start_time: s.start_time, end_time: s.end_time })) } });
    eq(a2.note, 'แก้หมายเหตุ');
  });

  test('คิวเต็มเมื่อเพิ่มวันใหม่ระหว่างแก้งาน / คิวที่ยกเลิกไม่นับ / 0 = ไม่จำกัด', async (ctx, st) => {
    const E = addDays(st.today, 70);
    await create(st.u.staff, payload(st.d, E, { status: 'hold', couple_names: 'E1' }));
    await create(st.u.staff, payload(st.d, E, { status: 'hold', couple_names: 'E2' }));
    const F = addDays(st.today, 71);
    const x = await create(st.u.staff, payload(st.d, F, { status: 'hold', couple_names: 'X' }));
    const addE = { sessions: [{ id: x.sessions[0].id, date: F }, { date: E, session_type: 'other' }] };
    await expectErr(() => st.u.staff.rpc('wed_update_booking', { p_booking_id: x.id, p_updated_at: x.updated_at, p_payload: addE }),
      'รับงานได้ 2 งานต่อวัน', { hint: 'wed_capacity' });
    // คิววันใหม่ที่ "ยกเลิก" ไม่นับ
    const x2 = await st.u.staff.rpc('wed_update_booking', { p_booking_id: x.id, p_updated_at: x.updated_at,
      p_payload: { sessions: [{ id: x.sessions[0].id, date: F }, { date: E, session_type: 'other', status: 'cancelled' }] } });
    eq(x2.sessions[1].status, 'cancelled');
    eq((await st.u.staff.rpc('wed_day', { p_day: E })).count_jobs, 2);
    const x3 = await st.u.staff.rpc('wed_update_booking', { p_booking_id: x.id, p_updated_at: x2.updated_at,
      p_payload: { force: true, sessions: [{ id: x.sessions[0].id, date: F }, { id: x2.sessions[1].id, date: E, session_type: 'other', status: 'scheduled' }] } });
    eq(x3.logs.find((l) => l.action === 'update').detail.capacity_over, true);
    eq((await st.u.staff.rpc('wed_day', { p_day: E })).count_jobs, 3);
    // ไม่จำกัด
    await st.u.mgr.rpc('wed_save_settings', { p_settings: { max_jobs_per_day: 0 } });
    try {
      const y = await create(st.u.staff, payload(st.d, E, { status: 'hold', couple_names: 'E4' }));
      eq(y.capacity_warnings, []);
      const day = await st.u.staff.rpc('wed_day', { p_day: E });
      eq([day.full, day.capacity], [false, 0]);
    } finally {
      await st.u.mgr.rpc('wed_save_settings', { p_settings: { max_jobs_per_day: 2 } });
    }
  });

  test('ทีมชนคิว: เวลาทับกัน / ต่อกันพอดีไม่ชน / เวลาถึงงานทำให้ชน / ไม่มีเวลา = ทั้งวัน (เตือนแต่บันทึกได้)', async (ctx, st) => {
    await st.u.mgr.rpc('wed_save_settings', { p_settings: { max_jobs_per_day: 0 } });
    const G = addDays(st.today, 90);
    const A = st.d.crew[0].id;
    const B = st.d.crew[1].id;
    const base = await create(st.u.staff, payload(st.d, G, { status: 'hold', couple_names: 'ฐาน', sessions: [S(G, '17:00', '22:00', [A])] }));
    eq(base.crew_conflicts, []);
    const q = (sessions, extra = {}) => st.u.staff.rpc('wed_quote', { p_payload: payload(st.d, G, { sessions, ...extra }) });

    let r = await q([S(G, '20:00', '23:00', [A])]);
    eq(r.crew_conflicts.length, 1);
    const c = r.crew_conflicts[0];
    eq([c.crew_id, c.crew_name, c.date, c.this_index, c.other_booking_no, c.other_couple, c.other_time, c.same_booking],
      [A, 'ชาย', G, 1, base.booking_no, 'ฐาน', '17:00–22:00 น.', false]);
    eq((await q([S(G, '10:00', '17:00', [A])])).crew_conflicts, [], 'จบ 17:00 พอดีกับเริ่ม 17:00 ไม่ชน');
    eq((await q([S(G, '22:00', '23:30', [A])])).crew_conflicts, [], 'เริ่ม 22:00 พอดีกับเลิก 22:00 ไม่ชน');
    eq((await q([S(G, '22:30', '23:30', [A], { call_time: '21:30' })])).crew_conflicts.length, 1, 'เวลาถึงงาน 21:30 ทับ');
    eq((await q([S(G, null, null, [A])])).crew_conflicts.length, 1, 'ไม่มีเวลา = ทั้งวัน');
    eq((await q([S(G, null, '12:00', [A])])).crew_conflicts, [], 'ไม่มีเวลาเริ่ม = ตั้งแต่ 00:00 ถึง 12:00');
    eq((await q([S(G, '20:00', null, [A])])).crew_conflicts.length, 1, 'ไม่มีเวลาเลิก = ถึงสิ้นวัน');
    eq((await q([S(G, '20:00', '23:00', [B])])).crew_conflicts, [], 'คนละคนไม่ชน');
    eq((await q([S(addDays(G, 1), '17:00', '22:00', [A])])).crew_conflicts, [], 'คนละวันไม่ชน');
    // ภายในงานเดียวกัน
    r = await q([S(G, '08:00', '12:00', [B]), S(G, '11:00', '13:00', [B])]);
    eq(r.crew_conflicts.map((x) => [x.this_index, x.same_booking]), [[1, true], [2, true]]);

    // บันทึกได้ (เตือนเท่านั้น) ทั้งสองงานเห็นการชน
    const clash = await create(st.u.staff, payload(st.d, G, { status: 'hold', couple_names: 'ชน', sessions: [S(G, '20:00', '23:00', [A])] }));
    eq(clash.crew_conflicts.length, 1);
    eq(clash.sessions[0].conflicts[0].other_booking_no, base.booking_no);
    const baseNow = await st.u.staff.rpc('wed_get_booking', { p_booking_id: base.id });
    eq(baseNow.sessions[0].conflicts.map((x) => x.other_booking_no), [clash.booking_no]);
    // ปฏิทิน: has_conflict ทั้งสองคิว + รายการชนแบบทางเดียว
    const cal = await st.u.staff.rpc('wed_calendar', { p_from: G, p_to: G });
    const day = cal.days[0];
    eq(day.sessions.map((s) => s.has_conflict), [true, true]);
    eq(cal.conflicts.length, 1);
    eq(new Set([cal.conflicts[0].this_booking_no, cal.conflicts[0].other_booking_no]), new Set([base.booking_no, clash.booking_no]));
    const dd = await st.u.staff.rpc('wed_day', { p_day: G });
    eq(dd.sessions.map((s) => s.conflicts.length), [1, 1]);
    // งานสอบถามไม่นับเป็นงานที่ชน (ยังไม่กันคิว) แต่ตัวเองเห็นคำเตือน
    const inq = await create(st.u.staff, payload(st.d, G, { couple_names: 'ถาม', sessions: [S(G, '18:00', '19:00', [A])] }));
    eq(inq.crew_conflicts.map((x) => x.other_booking_no), [base.booking_no], '18:00–19:00 ชนกับงานฐาน (17–22) แต่ไม่ชนกับ 20–23');
    eq((await st.u.staff.rpc('wed_get_booking', { p_booking_id: base.id })).crew_conflicts.length, 1);
    const cal2 = await st.u.staff.rpc('wed_calendar', { p_from: G, p_to: G, p_include_inquiries: true });
    eq(cal2.days[0].sessions.find((s) => s.booking_id === inq.id).has_conflict, false);
    // คิวที่ยกเลิก / งานที่ยกเลิก ไม่ชน
    await st.u.staff.rpc('wed_cancel', { p_booking_id: clash.id, p_reason: 'ทดสอบ' });
    eq((await st.u.staff.rpc('wed_get_booking', { p_booking_id: base.id })).crew_conflicts, []);
    await st.u.mgr.rpc('wed_save_settings', { p_settings: { max_jobs_per_day: 2 } });
  });
}
