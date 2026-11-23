// สถานะงาน: ทุกการเปลี่ยนสถานะที่ถูกต้อง + ที่ห้าม, กดซ้ำ (already), สร้าง/แก้งานแบบกันซ้ำ (client_id) และกันเขียนทับ
import { eq, ok, money, expectErr, uuid } from '../run.mjs';
import { makeUsers, seed, payload, create, pay, bkkToday, addDays } from './lib/wed.js';

export async function setup(ctx, st) {
  st.u = await makeUsers(ctx);
  st.d = await seed(ctx, st.u);
  st.today = await bkkToday(ctx);
}

const sess = (date, extra = {}) => ({ session_type: 'reception', date, start_time: '17:00', end_time: '22:00', ...extra });

export function register(test) {
  test('สอบถามไม่ต้องมีวันที่ แต่ล็อกคิว/ยืนยันต้องมีคิวที่ระบุวัน', async (ctx, st) => {
    const b = await create(st.u.staff, payload(st.d, null, { sessions: [{ session_type: 'reception', date: null }] }));
    eq(b.status, 'inquiry');
    eq(b.status_label, 'สอบถาม');
    ok(/^WD-\d{8}-\d{3}$/.test(b.booking_no), 'เลขงานผิดรูปแบบ ' + b.booking_no);
    eq(b.actions.can_hold, false);
    eq(b.actions.block_reasons.hold, 'ต้องมีคิวงานที่ระบุวันที่อย่างน้อย 1 คิวก่อน');
    await expectErr(() => st.u.staff.rpc('wed_hold', { p_booking_id: b.id }), 'ต้องมีคิวงานที่ระบุวันที่');
    await expectErr(() => st.u.staff.rpc('wed_confirm', { p_booking_id: b.id, p_force: true }), 'ต้องมีคิวงานที่ระบุวันที่');
    await expectErr(() => create(st.u.staff, payload(st.d, null, { status: 'hold', sessions: [{ date: null }] })), 'กรุณาระบุวันที่ของคิวที่ 1');
    await expectErr(() => create(st.u.staff, payload(st.d, null, { sessions: [] })), 'กรุณาเพิ่มคิวงานอย่างน้อย 1 คิว');
    await expectErr(() => create(st.u.staff, payload(st.d, addDays(st.today, 5), { status: 'completed' })), 'สถานะเริ่มต้นของงาน');
  });

  test('วงจรเต็ม: สอบถาม → ล็อกคิว → ต่อเวลา (กันซ้ำ) → ยืนยัน (มัดจำ/บังคับ) → ถ่ายเสร็จ → ส่งงาน → ปิดงาน → เปิดใหม่', async (ctx, st) => {
    const day = addDays(st.today, 3);
    const b0 = await create(st.u.staff, payload(st.d, day, { sessions: [sess(st.today), sess(day, { session_type: 'ceremony' })] }));
    let b = await st.u.staff.rpc('wed_hold', { p_booking_id: b0.id, p_hours: 48 });
    eq([b.status, b.already], ['hold', false]);
    const h1 = new Date(b.hold_until).getTime();
    ok(Math.abs(h1 - Date.now() - 48 * 3600e3) < 120e3, 'hold_until ไม่ใช่อีก 48 ชั่วโมง');
    eq((await st.u.staff.rpc('wed_hold', { p_booking_id: b0.id })).already, true);
    const cid = uuid();
    b = await st.u.staff.rpc('wed_extend_hold', { p_booking_id: b0.id, p_hours: 24, p_client_id: cid });
    const h2 = new Date(b.hold_until).getTime();
    ok(Math.abs(h2 - h1 - 24 * 3600e3) < 1000, 'ต่อเวลาไม่ครบ 24 ชั่วโมง');
    b = await st.u.staff.rpc('wed_extend_hold', { p_booking_id: b0.id, p_hours: 24, p_client_id: cid });
    eq([new Date(b.hold_until).getTime(), b.already], [h2, true], 'ต่อเวลาซ้ำด้วยรหัสเดิม');
    await expectErr(() => st.u.staff.rpc('wed_extend_hold', { p_booking_id: b0.id, p_hours: 721 }), '1 ถึง 720');

    // ยังไม่ได้มัดจำ → ต้องบังคับ (hint ให้หน้าจอเปิดกล่องยืนยัน)
    await expectErr(() => st.u.staff.rpc('wed_confirm', { p_booking_id: b0.id }), 'ยังไม่ได้รับมัดจำครบ', { hint: 'wed_deposit' });
    b = await st.u.staff.rpc('wed_confirm', { p_booking_id: b0.id, p_force: true });
    eq([b.status, b.hold_until, b.already], ['confirmed', null, false]);
    ok(b.confirmed_at, 'ไม่มีเวลายืนยัน');
    eq(b.deliverables.map((x) => [x.name, x.qty, x.due_date, x.status]), [
      ['ภาพตกแต่ง', 500, addDays(day, 30), 'pending'],
      ['วิดีโอไฮไลต์', 1, addDays(day, 45), 'pending'],
    ]);
    eq((await st.u.staff.rpc('wed_confirm', { p_booking_id: b0.id })).already, true);
    eq(b.logs.find((l) => l.action === 'confirm').detail.forced, true);

    // มีคิวที่ยังไม่ถึงวัน → ต้องบังคับ ; บังคับแล้วทุกคิวเป็น "เสร็จ"
    await expectErr(() => st.u.staff.rpc('wed_mark_shot', { p_booking_id: b0.id }), 'ยังมีคิวงานที่ยังไม่ถึงวัน', { hint: 'wed_future_sessions' });
    b = await st.u.staff.rpc('wed_mark_shot', { p_booking_id: b0.id, p_force: true });
    eq([b.status, b.sessions.map((s) => s.status)], ['in_production', ['done', 'done']]);
    eq(b.actions.can_mark_delivered, true);

    b = await st.u.staff.rpc('wed_mark_delivered', { p_booking_id: b0.id });
    eq(b.status, 'delivered');
    await expectErr(() => st.u.staff.rpc('wed_complete', { p_booking_id: b0.id }), 'ปิดงานไม่ได้: ยังค้างชำระ ฿45,000.00');
    eq(b.actions.can_complete, false);
    await pay(st.u.staff, b0.id, 45000);
    b = await st.u.staff.rpc('wed_complete', { p_booking_id: b0.id });
    eq([b.status, b.actions.can_reopen], ['completed', false]);
    eq((await st.u.mgr.rpc('wed_get_booking', { p_booking_id: b0.id })).actions.can_reopen, true);
    await expectErr(() => st.u.staff.rpc('wed_reopen', { p_booking_id: b0.id }), 'เฉพาะผู้จัดการ', { code: '42501' });
    await expectErr(() => st.u.staff.rpc('wed_cancel', { p_booking_id: b0.id, p_reason: 'x' }), 'ยกเลิกงานสถานะ "ปิดงาน" ไม่ได้');
    await expectErr(() => pay(st.u.staff, b0.id, 100, { kind: 'refund' }), 'งานนี้ปิดแล้ว');
    b = await st.u.mgr.rpc('wed_reopen', { p_booking_id: b0.id });
    eq(b.status, 'delivered');
    b = await st.u.staff.rpc('wed_complete', { p_booking_id: b0.id });
    eq(b.status, 'completed');
    const acts = b.logs.map((l) => l.action).reverse();
    for (const a of ['create', 'hold', 'extend_hold', 'confirm', 'mark_shot', 'mark_delivered', 'payment', 'complete', 'reopen']) {
      ok(acts.includes(a), 'ประวัติไม่มี ' + a);
    }
    eq(acts.filter((a) => a === 'extend_hold').length, 1);
  });

  test('ปล่อยคิว / ยืนยันตรงจากสอบถาม / ปิดงานจากถ่ายเสร็จต้องบังคับ', async (ctx, st) => {
    const day = addDays(st.today, 10);
    let b = await create(st.u.staff, payload(st.d, day, { status: 'hold' }));
    eq(b.status, 'hold');
    b = await st.u.staff.rpc('wed_release_hold', { p_booking_id: b.id });
    eq([b.status, b.hold_until], ['inquiry', null]);
    eq((await st.u.staff.rpc('wed_release_hold', { p_booking_id: b.id })).already, true);
    await pay(st.u.staff, b.id, 13500);
    b = await st.u.staff.rpc('wed_confirm', { p_booking_id: b.id });
    eq([b.status, b.money.deposit_met], ['confirmed', true]);
    await expectErr(() => st.u.staff.rpc('wed_release_hold', { p_booking_id: b.id }), 'ปล่อยคิวได้เฉพาะงานที่ล็อกคิวอยู่');
    await expectErr(() => st.u.staff.rpc('wed_hold', { p_booking_id: b.id }), 'ล็อกคิวได้เฉพาะงานที่ยังเป็น "สอบถาม"');
    await expectErr(() => st.u.staff.rpc('wed_mark_delivered', { p_booking_id: b.id }), 'บันทึกส่งงานได้เฉพาะงานที่ถ่ายเสร็จแล้ว');
    await expectErr(() => st.u.staff.rpc('wed_complete', { p_booking_id: b.id }), 'ปิดงานได้หลังส่งงานแล้วเท่านั้น');
    await expectErr(() => st.u.staff.rpc('wed_mark_shot', { p_booking_id: b.id }), 'ยังมีคิวงานที่ยังไม่ถึงวัน');
    b = await st.u.staff.rpc('wed_mark_shot', { p_booking_id: b.id, p_force: true });
    await pay(st.u.staff, b.id, b.money.due);
    await expectErr(() => st.u.staff.rpc('wed_complete', { p_booking_id: b.id }), 'ยังไม่ได้บันทึกส่งงาน', { hint: 'wed_not_delivered' });
    b = await st.u.staff.rpc('wed_complete', { p_booking_id: b.id, p_force: true });
    eq(b.status, 'completed');
    eq(b.logs.find((l) => l.action === 'complete').detail.from, 'in_production');
  });

  test('ถ่ายเสร็จเมื่อทุกคิวถึงวันแล้ว: ไม่ต้องบังคับ / คิวที่ยกเลิกไม่นับ', async (ctx, st) => {
    const b0 = await create(st.u.staff, payload(st.d, st.today, {
      status: 'confirmed', force: true,
      sessions: [sess(addDays(st.today, -1)), sess(st.today, { session_type: 'ceremony' }), sess(addDays(st.today, 5), { status: 'cancelled' })],
    }));
    eq(b0.status, 'confirmed');
    const b = await st.u.staff.rpc('wed_mark_shot', { p_booking_id: b0.id });
    eq(b.sessions.map((s) => s.status), ['done', 'done', 'cancelled']);
    eq(b.logs.find((l) => l.action === 'mark_shot').detail.forced, false);
  });

  test('เลื่อนงาน → แก้วันใหม่ → กลับมาสถานะเดิม (เงินคงอยู่, วันเดิมปล่อยคิว)', async (ctx, st) => {
    await st.u.mgr.rpc('wed_save_settings', { p_settings: { max_jobs_per_day: 1 } });
    try {
      const day = addDays(st.today, 60);
      const b0 = await create(st.u.staff, payload(st.d, day, { status: 'confirmed', force: true }));
      await pay(st.u.staff, b0.id, 5000);
      await expectErr(() => st.u.staff.rpc('wed_postpone', { p_booking_id: b0.id, p_reason: '  ' }), 'กรุณาระบุเหตุผลที่เลื่อนงาน');
      let b = await st.u.staff.rpc('wed_postpone', { p_booking_id: b0.id, p_reason: 'ฤกษ์ใหม่' });
      eq([b.status, b.status_before_postpone, b.postpone_reason], ['postponed', 'confirmed', 'ฤกษ์ใหม่']);
      money(b.money.paid, 5000);
      eq(b.actions.can_resume, true);
      // วันเดิมว่างแล้ว: อีกงานล็อกคิววันเดิมได้โดยไม่ต้องบังคับ (รับได้ 1 งาน/วัน)
      const other = await create(st.u.staff, payload(st.d, day, { status: 'hold' }));
      eq(other.status, 'hold');
      // ระหว่างเลื่อน ลบวันที่ได้ (ยังไม่รู้วันใหม่) แต่กลับมาไม่ได้จนกว่าจะใส่วัน
      b = await st.u.staff.rpc('wed_update_booking', {
        p_booking_id: b0.id, p_updated_at: b.updated_at, p_payload: { sessions: [{ id: b.sessions[0].id, session_type: 'reception', date: null }] },
      });
      await expectErr(() => st.u.staff.rpc('wed_resume', { p_booking_id: b0.id }), 'กรุณาระบุวันที่ของทุกคิวงานก่อน');
      // ใส่วันเดิม (ตอนนี้งานอื่นจองแล้ว) → กลับมาไม่ได้ถ้าไม่บังคับ
      b = await st.u.staff.rpc('wed_update_booking', {
        p_booking_id: b0.id, p_updated_at: b.updated_at, p_payload: { sessions: [{ id: b.sessions[0].id, session_type: 'reception', date: day }] },
      });
      await expectErr(() => st.u.staff.rpc('wed_resume', { p_booking_id: b0.id }), 'รับงานได้ 1 งานต่อวัน', { hint: 'wed_capacity' });
      const newDay = addDays(day, 7);
      b = await st.u.staff.rpc('wed_update_booking', {
        p_booking_id: b0.id, p_updated_at: b.updated_at, p_payload: { sessions: [{ id: b.sessions[0].id, session_type: 'reception', date: newDay }] },
      });
      b = await st.u.staff.rpc('wed_resume', { p_booking_id: b0.id });
      eq([b.status, b.status_before_postpone, b.first_session_date], ['confirmed', null, newDay]);
      eq((await st.u.staff.rpc('wed_resume', { p_booking_id: b0.id })).already, true);
      // ล็อกคิว → เลื่อน → กลับมาเป็นล็อกคิวพร้อมเวลาล็อกใหม่
      b = await st.u.staff.rpc('wed_postpone', { p_booking_id: other.id, p_reason: 'ลูกค้าขอเลื่อน' });
      eq(b.hold_until, null);
      b = await st.u.staff.rpc('wed_resume', { p_booking_id: other.id });
      eq(b.status, 'hold');
      ok(b.hold_until, 'กลับมาเป็นล็อกคิวต้องมีเวลาหมดล็อก');
      const inq = await create(st.u.staff, payload(st.d, day));
      await expectErr(() => st.u.staff.rpc('wed_postpone', { p_booking_id: inq.id, p_reason: 'x' }),
        'เลื่อนงานได้เฉพาะงานที่ล็อกคิวหรือยืนยันแล้ว');
    } finally {
      await st.u.mgr.rpc('wed_save_settings', { p_settings: { max_jobs_per_day: 2 } });
    }
  });

  test('ยกเลิก: เหตุผลบังคับ, งานถ่ายแล้วเฉพาะผู้จัดการ, ยกเลิกแล้วทำอะไรต่อไม่ได้ (คืนเงินได้)', async (ctx, st) => {
    const day = addDays(st.today, 20);
    const b0 = await create(st.u.staff, payload(st.d, day, { status: 'confirmed', force: true }));
    await pay(st.u.staff, b0.id, 10000);
    await expectErr(() => st.u.staff.rpc('wed_cancel', { p_booking_id: b0.id, p_reason: '' }), 'กรุณาระบุเหตุผลที่ยกเลิก');
    let b = await st.u.staff.rpc('wed_cancel', { p_booking_id: b0.id, p_reason: 'ลูกค้ายกเลิก' });
    eq([b.status, b.cancel_reason, b.already], ['cancelled', 'ลูกค้ายกเลิก', false]);
    money(b.money.paid, 10000);
    eq(b.next_due, null);
    eq((await st.u.staff.rpc('wed_cancel', { p_booking_id: b0.id, p_reason: 'ซ้ำ' })).already, true);
    for (const [fn, args, msg] of [
      ['wed_confirm', { p_booking_id: b0.id, p_force: true }, 'ยืนยันได้เฉพาะงานที่สอบถามหรือล็อกคิวอยู่'],
      ['wed_hold', { p_booking_id: b0.id }, 'ล็อกคิวได้เฉพาะ'],
      ['wed_mark_shot', { p_booking_id: b0.id, p_force: true }, 'บันทึกถ่ายเสร็จได้เฉพาะงานที่ยืนยันแล้ว'],
      ['wed_postpone', { p_booking_id: b0.id, p_reason: 'x' }, 'เลื่อนงานได้เฉพาะ'],
      ['wed_resume', { p_booking_id: b0.id }, 'ใช้ได้กับงานที่เลื่อนอยู่เท่านั้น'],
      ['wed_set_followup', { p_booking_id: b0.id, p_date: day, p_note: 'x' }, 'งานนี้ยกเลิกแล้ว'],
      ['wed_add_charge', { p_client_id: uuid(), p_booking_id: b0.id, p_kind: 'extra', p_description: 'x', p_amount: 1 }, 'เพิ่มค่าใช้จ่ายได้ตั้งแต่ยืนยันงาน'],
      ['wed_set_installments', { p_booking_id: b0.id, p_items: [] }, 'แก้งวดชำระของงานสถานะ "ยกเลิก" ไม่ได้'],
      ['wed_save_deliverable', { p_booking_id: b0.id, p_item: { name: 'x' } }, 'งานนี้ยกเลิกแล้ว'],
    ]) {
      await expectErr(() => st.u.staff.rpc(fn, args), msg);
    }
    await expectErr(() => st.u.staff.rpc('wed_update_booking', { p_booking_id: b0.id, p_updated_at: b.updated_at, p_payload: {} }),
      'แก้ไขงานสถานะ "ยกเลิก" ไม่ได้');
    await expectErr(() => pay(st.u.staff, b0.id, 100), 'งานนี้ยกเลิกแล้ว รับชำระไม่ได้');
    const r = await pay(st.u.staff, b0.id, 4000, { kind: 'refund' });
    money(r.booking.money.paid, 6000);

    // ถ่ายแล้ว: พนักงานยกเลิกไม่ได้ ผู้จัดการได้
    const b1 = await create(st.u.staff, payload(st.d, st.today, { status: 'confirmed', force: true }));
    await st.u.staff.rpc('wed_mark_shot', { p_booking_id: b1.id });
    await expectErr(() => st.u.staff.rpc('wed_cancel', { p_booking_id: b1.id, p_reason: 'x' }), 'เฉพาะผู้จัดการ', { code: '42501' });
    eq((await st.u.staff.rpc('wed_get_booking', { p_booking_id: b1.id })).actions.can_cancel, false);
    eq((await st.u.mgr.rpc('wed_cancel', { p_booking_id: b1.id, p_reason: 'งานพัง' })).status, 'cancelled');
  });

  test('สร้างงานกันซ้ำ (client_id) + payload_matches + ลูกค้าใหม่ในฟอร์ม', async (ctx, st) => {
    const cid = uuid();
    const p = payload(st.d, addDays(st.today, 15), { customer_id: undefined, customer: { name: 'ฝน ใหม่', phone: '0900000001', source: 'tiktok' } });
    delete p.customer_id;
    const r1 = await st.u.staff.rpc('wed_create_booking', { p_client_id: cid, p_payload: p });
    eq([r1.already_saved, r1.payload_matches, r1.booking.source, r1.booking.customer.name], [false, true, 'tiktok', 'ฝน ใหม่']);
    const r2 = await st.u.staff.rpc('wed_create_booking', { p_client_id: cid, p_payload: p });
    eq([r2.already_saved, r2.payload_matches, r2.booking.id], [true, true, r1.booking.id]);
    const r3 = await st.u.staff.rpc('wed_create_booking', { p_client_id: cid, p_payload: { ...p, note: 'ต่างจากเดิม' } });
    eq([r3.already_saved, r3.payload_matches], [true, false]);
    eq((await ctx.pg.one(`select count(*)::int as n from public.wed_customers where phone = '0900000001'`)).n, 1);
    await expectErr(() => st.u.staff.rpc('wed_create_booking', { p_client_id: null, p_payload: p }), 'รหัสคำขอไม่ถูกต้อง');
    await expectErr(() => create(st.u.staff, { ...payload(st.d, addDays(st.today, 15)), couple_names: '  ' }), 'กรุณากรอกชื่อคู่บ่าวสาว');
    await expectErr(() => create(st.u.staff, { ...payload(st.d, addDays(st.today, 15)), customer_id: uuid() }), 'ไม่พบข้อมูลลูกค้า');
  });

  test('แก้งาน: กันเขียนทับ (updated_at), รหัสคำขอแก้ไขส่งซ้ำได้ผลเดิม, แทนที่คิว/บริการเสริมตาม id', async (ctx, st) => {
    const day = addDays(st.today, 25);
    const b0 = await create(st.u.staff, payload(st.d, day, {
      sessions: [sess(day, { title: 'เลี้ยงเย็น' }), sess(addDays(day, -1), { session_type: 'engagement', title: 'หมั้น' })],
      addons: [{ addon_id: st.d.addon.id, qty: 1 }, { name: 'อัลบั้ม', qty: 1, unit_price: 5000 }],
    }));
    eq(b0.sessions.map((s) => s.title), ['เลี้ยงเย็น', 'หมั้น']);
    await expectErr(() => st.u.staff.rpc('wed_update_booking', { p_booking_id: b0.id, p_updated_at: '2020-01-01T00:00:00Z', p_payload: { note: 'x' } }),
      'ถูกแก้ไขจากเครื่องอื่น');
    const edit = {
      client_id: uuid(), note: 'แก้แล้ว',
      sessions: [{ id: b0.sessions[1].id, session_type: 'engagement', title: 'หมั้นเช้า', date: addDays(day, -1), start_time: '08:09' },
        { session_type: 'prewedding', title: 'พรีเวดดิ้ง', date: addDays(day, -30) }],
      addons: [{ id: b0.addons[1].id, name: 'อัลบั้ม', qty: 2, unit_price: 5000 }],
    };
    const b1 = await st.u.staff.rpc('wed_update_booking', { p_booking_id: b0.id, p_updated_at: b0.updated_at, p_payload: edit });
    eq(b1.sessions.map((s) => [s.title, s.start_time]), [['หมั้นเช้า', '08:09'], ['พรีเวดดิ้ง', null]]);
    eq(b1.sessions[0].id, b0.sessions[1].id, 'คิวเดิมต้องคง id');
    eq(b1.addons.map((a) => [a.id, a.qty, a.amount]), [[b0.addons[1].id, 2, 10000]]);
    eq([b1.note, b1.first_session_date, b1.last_session_date], ['แก้แล้ว', addDays(day, -30), addDays(day, -1)]);
    // ส่งซ้ำด้วยรหัสเดิม (เน็ตหลุด) + updated_at เก่า → ได้ผลเดิม ไม่ชนล็อกเวอร์ชันของตัวเอง
    const b2 = await st.u.staff.rpc('wed_update_booking', { p_booking_id: b0.id, p_updated_at: b0.updated_at, p_payload: edit });
    eq([b2.already_saved, b2.updated_at], [true, b1.updated_at]);
    await expectErr(() => st.u.staff.rpc('wed_update_booking', { p_booking_id: b0.id, p_updated_at: b1.updated_at, p_payload: { ...edit, note: 'อื่น' } }),
      'รหัสคำขอนี้ถูกใช้บันทึกการแก้ไขชุดอื่นไปแล้ว');
    // คีย์ที่ไม่ส่ง = คงเดิม
    const b3 = await st.u.staff.rpc('wed_update_booking', { p_booking_id: b0.id, p_updated_at: b1.updated_at, p_payload: { coordinator_name: 'พี่ต้อม' } });
    eq([b3.coordinator_name, b3.sessions.length, b3.addons.length, b3.note], ['พี่ต้อม', 2, 1, 'แก้แล้ว']);
    // id คิวของงานอื่น → ปฏิเสธ
    const other = await create(st.u.staff, payload(st.d, day));
    await expectErr(() => st.u.staff.rpc('wed_update_booking', {
      p_booking_id: b0.id, p_updated_at: b3.updated_at, p_payload: { sessions: [{ id: other.sessions[0].id, date: day }] },
    }), 'ไม่พบคิวงานนี้ในงาน');
    const upd = b3.logs.filter((l) => l.action === 'update');
    eq(upd.length, 2);
  });

  test('ตรวจข้อมูลคิว: เวลา/เวลาถึงงาน/ลิงก์/กำหนดการ/ทีมงานซ้ำ', async (ctx, st) => {
    const day = addDays(st.today, 30);
    const bad = async (s, msg) => expectErr(() => create(st.u.staff, payload(st.d, day, { sessions: [{ date: day, ...s }] })), msg);
    await bad({ start_time: '18:00', end_time: '17:00' }, 'เวลาเลิกต้องหลังเวลาเริ่ม');
    await bad({ start_time: '18:00', end_time: '18:00' }, 'เวลาเลิกต้องหลังเวลาเริ่ม');
    await bad({ start_time: '10:00', call_time: '10:30' }, 'เวลาทีมถึงงานต้องไม่ช้ากว่าเวลาเริ่มงาน');
    await bad({ start_time: '25:00' }, 'ต้องเป็นเวลาแบบ ชั่วโมง:นาที');
    await bad({ map_url: 'javascript:alert(1)' }, 'ลิงก์แผนที่ ต้องขึ้นต้นด้วย http');
    await bad({ session_type: 'party' }, 'ประเภทคิวงานไม่ถูกต้อง');
    await bad({ crew: [{ crew_id: st.d.crew[0].id }, { crew_id: st.d.crew[0].id }] }, 'เลือกทีมงานคนเดียวกันซ้ำ');
    await bad({ run_sheet: Array.from({ length: 41 }, (_, i) => ({ text: 'x' + i })) }, 'กำหนดการใส่ได้ไม่เกิน 40 แถว');
    await bad({ run_sheet: [{ time: '09:09', text: '' }] }, 'กรุณาใส่รายละเอียดของกำหนดการเวลา 09:09 น.');
    await bad({ date: addDays(st.today, 1200) }, 'ล่วงหน้าได้ไม่เกิน 3 ปี');
    await expectErr(() => create(st.u.staff, payload(st.d, day, { sessions: Array.from({ length: 11 }, () => ({ date: day })) })),
      'ไม่เกิน 10 คิว');
    const ok1 = await create(st.u.staff, payload(st.d, day, {
      sessions: [{ date: day, start_time: '09.30', call_time: '08:00', run_sheet: [{ time: '09:09', text: 'แห่ขันหมาก' }, { time: null, text: '' }, { text: 'รดน้ำสังข์' }],
        map_url: 'https://maps.google.com/?q=1', crew: [st.d.crew[1].id] }],
    }));
    eq(ok1.sessions[0].run_sheet, [{ time: '09:09', text: 'แห่ขันหมาก' }, { time: null, text: 'รดน้ำสังข์' }]);
    eq([ok1.sessions[0].start_time, ok1.sessions[0].call_time, ok1.sessions[0].crew[0].role], ['09:30', '08:00', 'video']);
    // ทีมงานที่ปิดใช้งาน: เลือกใหม่ไม่ได้ แต่คนเดิมในคิวเดิมอยู่ต่อได้
    await st.u.mgr.rpc('wed_save_crew', { p_crew: { id: st.d.crew[1].id, is_active: false } });
    try {
      await bad({ crew: [{ crew_id: st.d.crew[1].id }] }, 'ปิดใช้งานอยู่');
      const keep = await st.u.staff.rpc('wed_update_booking', {
        p_booking_id: ok1.id, p_updated_at: ok1.updated_at,
        p_payload: { sessions: [{ id: ok1.sessions[0].id, date: day, crew: [{ crew_id: st.d.crew[1].id }] }] },
      });
      eq(keep.sessions[0].crew.length, 1);
    } finally {
      await st.u.mgr.rpc('wed_save_crew', { p_crew: { id: st.d.crew[1].id, is_active: true } });
    }
  });
}
