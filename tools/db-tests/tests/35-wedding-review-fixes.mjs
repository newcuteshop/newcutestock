// กันพังซ้ำจากรอบตรวจ (เงิน/ตารางงาน): ค่าตัวทีมงานที่จ่ายแล้วไม่หายจากบัญชี, ค่าตัวไม่รีเซ็ตเมื่อพนักงานย้ายคิว,
//   กำหนดส่งงานเลื่อนตามวันงาน, ล็อกคิว/ยืนยันต้องมีวันทุกคิว, งวดมัดจำนับจากวันล็อกคิว, ค่าใช้จ่ายเพิ่มตอนเลื่อนงาน,
//   ทีมชนคิวของงานยกเลิก/เลื่อน, วัตถุประสงค์รับเงินอัตโนมัติ, ยกเลิกคืนเงินแล้วเงินเกิน, ล็อกคิวที่คืนเงินหมด,
//   เพิ่มรายการส่งงานหลังส่งครบ, วันที่รับเงินย้อนหลังเกินจริง, กระดานงานส่งของงานที่ปิดแล้ว, CSV จำนวนทศนิยม,
//   วันชำระยอดคงเหลือของงานกระชั้นชิด
import { eq, ok, money, expectErr, uuid } from '../run.mjs';
import { makeUsers, seed, payload, create, pay, bkkToday, addDays } from './lib/wed.js';

// ทดสอบกฎของ fix-07 ด้วยค่าตั้งต้นเดิม (ชำระยอดคงเหลือก่อนวันงาน 7 วัน / เงื่อนไขตั้งต้นหลายข้อ) — ข้อมูลร้านที่ fix-09 ตั้งให้บอส
//   (ชำระวันงาน + เงื่อนไข 3 ข้อ) ทดสอบใน 33-wedding-pay-on-event-day.mjs
export const dbOptions = { upTo: 'supabase-fix-08-lock-order.sql' };

export async function setup(ctx, st) {
  st.u = await makeUsers(ctx);
  st.d = await seed(ctx, st.u);
  st.today = await bkkToday(ctx);
  [st.A, st.B, st.C] = st.d.crew.map((c) => c.id);
}

const get = (st, id, who = 'mgr') => st.u[who].rpc('wed_get_booking', { p_booking_id: id });
const upd = (user, b, p) => user.rpc('wed_update_booking', { p_booking_id: b.id, p_updated_at: b.updated_at, p_payload: p });
const markPaid = (st, sid, cid, day) => st.u.mgr.rpc('wed_mark_crew_paid', { p_items: [{ session_id: sid, crew_id: cid, paid_on: day }] });

export function register(test) {
  test('ค่าตัวทีมงาน: งานยกเลิกหลังถ่ายเสร็จ → ค่าตัว (จ่ายแล้ว/ยังไม่จ่าย) ยังอยู่ในหน้าจ่ายค่าตัว รายงาน ส่งออก ตารางงานทีม', async (ctx, st) => {
    const day = addDays(st.today, -3);
    let b = await create(st.u.mgr, payload(st.d, day, {
      status: 'confirmed', force: true,
      sessions: [{ date: day, start_time: '10:00', end_time: '14:00', crew: [{ crew_id: st.A, fee: 4000 }, { crew_id: st.B }] }],
    }));
    await st.u.staff.rpc('wed_mark_shot', { p_booking_id: b.id });
    await markPaid(st, b.sessions[0].id, st.A, st.today);
    const range = { p_from: day, p_to: day };
    const before = await st.u.mgr.rpc('wed_crew_payouts', range);
    eq([before.totals.fees, before.totals.paid, before.totals.unpaid, before.totals.sessions], [7000.5, 4000, 3000.5, 2]);
    b = await st.u.mgr.rpc('wed_cancel', { p_booking_id: b.id, p_reason: 'ลูกค้าขอยกเลิกหลังวันงาน' });
    eq(b.status, 'cancelled');
    const after = await st.u.mgr.rpc('wed_crew_payouts', range);
    eq([after.totals.fees, after.totals.paid, after.totals.unpaid, after.totals.sessions], [7000.5, 4000, 3000.5, 2]);
    eq(after.crew.flatMap((c) => c.items.map((i) => [i.booking_status, i.session_status])), [['cancelled', 'done'], ['cancelled', 'done']]);
    // ค่าตัวที่ยังค้างของงานที่ถ่ายไปแล้ว → ยังกดจ่ายได้
    eq((await markPaid(st, b.sessions[0].id, st.B, st.today)).updated, 1);
    const rep = await st.u.mgr.rpc('wed_report', range);
    eq([rep.crew.cost_total, rep.crew.paid_total], [7000.5, 7000.5]);
    const rows = await st.u.mgr.rpcRows('wed_export_crew_fees', range);
    eq(rows.map((r) => [r.crew_name, Number(r.fee), r.paid, r.booking_status]).sort(), [
      ['วิไล วิดีโอ', 3000.5, true, 'cancelled'], ['สมชาย ช่างภาพ', 4000, true, 'cancelled']]);
    const sch = await st.u.mgr.rpc('wed_crew_schedule', { p_crew_id: st.A, ...range });
    eq([sch.totals.sessions, sch.totals.fees, sch.totals.paid], [1, 4000, 4000]);
    // พนักงานดูตารางงานทีม = งานจริงที่ต้องไป (งานยกเลิกไม่แสดง) และไม่เห็นค่าตัว
    const ss = await st.u.staff.rpc('wed_crew_schedule', { p_crew_id: st.A, ...range });
    eq([ss.totals.sessions, ss.totals.fees], [0, undefined]);
    // ยกเลิกก่อนถ่าย: ค่าตัวที่ยังไม่จ่ายไม่ต้องจ่ายแล้ว / ค่าตัวที่จ่ายล่วงหน้าไปแล้วยังเป็นต้นทุนจริง
    const day2 = addDays(st.today, 150);
    let c = await create(st.u.mgr, payload(st.d, day2, {
      status: 'confirmed', force: true, sessions: [{ date: day2, crew: [{ crew_id: st.A, fee: 1000 }, { crew_id: st.C }] }],
    }));
    await markPaid(st, c.sessions[0].id, st.A, st.today);
    await st.u.staff.rpc('wed_cancel', { p_booking_id: c.id, p_reason: 'ลูกค้ายกเลิก' });
    const r2 = await st.u.mgr.rpc('wed_crew_payouts', { p_from: day2, p_to: day2 });
    eq([r2.totals.fees, r2.totals.paid, r2.totals.unpaid, r2.totals.sessions], [1000, 1000, 0, 1]);
    eq((await st.u.mgr.rpc('wed_report', { p_from: day2, p_to: day2 })).crew.cost_total, 1000);
    eq((await st.u.mgr.rpcRows('wed_export_crew_fees', { p_from: day2, p_to: day2 })).length, 1);
    c = await get(st, c.id);
    money(c.money.crew_cost_total, 2200);   // ระดับงานยังเห็นค่าตัวทั้งหมดของคิวที่ไม่ยกเลิก (ตามเดิม)
  });

  test('คิวที่มีค่าตัวจ่ายแล้ว ตั้งเป็น "ยกเลิก" ไม่ได้ (พนักงาน/ผู้จัดการ) — ยกเลิกการจ่ายก่อนแล้วจึงยกเลิกคิวได้', async (ctx, st) => {
    const day = addDays(st.today, 160);
    let b = await create(st.u.mgr, payload(st.d, day, {
      status: 'confirmed', force: true,
      sessions: [
        { date: day, session_type: 'ceremony', start_time: '07:00', end_time: '11:00', crew: [{ crew_id: st.A, fee: 3000 }] },
        { date: day, session_type: 'reception', start_time: '18:00', end_time: '22:00', crew: [{ crew_id: st.B }] },
      ],
    }));
    const [s1, s2] = b.sessions.map((s) => s.id);
    await markPaid(st, s1, st.A, st.today);
    const sb = await get(st, b.id, 'staff');
    const cancelFirst = (x) => ({ sessions: [
      { id: s1, date: day, session_type: 'ceremony', start_time: '07:00', end_time: '11:00', status: 'cancelled', crew: [{ crew_id: st.A }] },
      { id: s2, date: day, session_type: 'reception', start_time: '18:00', end_time: '22:00', crew: [{ crew_id: st.B }] }] });
    await expectErr(() => upd(st.u.staff, sb, cancelFirst()), 'ยกเลิกคิวไม่ได้ — ยกเลิกการจ่ายค่าตัวก่อน');
    await expectErr(() => upd(st.u.mgr, sb, cancelFirst()), 'ยกเลิกคิวไม่ได้');
    b = await get(st, b.id);
    money(b.money.crew_cost_total, 3000 + 3000.5);
    eq((await st.u.mgr.rpc('wed_crew_payouts', { p_from: day, p_to: day })).totals.paid, 3000);
    // ยกเลิกการจ่ายก่อน → ยกเลิกคิวได้ ค่าตัวคิวนั้นออกจากต้นทุน
    await markPaid(st, s1, st.A, null);
    b = await upd(st.u.staff, await get(st, b.id, 'staff'), cancelFirst());
    eq(b.sessions.map((s) => s.status), ['cancelled', 'scheduled']);
    money((await get(st, b.id)).money.crew_cost_total, 3000.5);
    // ข้อมูลเก่าที่คิวถูกยกเลิกทั้งที่จ่ายแล้ว: ค่าตัวที่จ่ายยังนับเป็นต้นทุนของงานและในหน้าจ่ายค่าตัว
    await ctx.pg.query(`update public.wed_session_crew set fee_paid_on = public.pos_bkk_today() where session_id = $1`, [s1]);
    money((await get(st, b.id)).money.crew_cost_total, 6000.5);
    const po = await st.u.mgr.rpc('wed_crew_payouts', { p_from: day, p_to: day });
    eq([po.totals.fees, po.totals.paid], [6000.5, 3000]);
  });

  test('พนักงานย้ายทีมไปคิวอื่น / ลบคิวแล้วสร้างใหม่ → ค่าตัวที่ผู้จัดการตกลงไว้คงเดิม (ไม่กลับเป็นค่าตัวตั้งต้น)', async (ctx, st) => {
    const day = addDays(st.today, 170);
    const m = { date: day, session_type: 'ceremony', start_time: '07:00', end_time: '11:00' };
    const e = { date: day, session_type: 'reception', start_time: '18:00', end_time: '22:00' };
    let b = await create(st.u.mgr, payload(st.d, day, { sessions: [{ ...m, crew: [{ crew_id: st.A, fee: 9000 }] }, { ...e, crew: [] }] }));
    const [s1, s2] = b.sessions.map((s) => s.id);
    // ย้ายคนเดิมจากคิวเช้าไปคิวเย็น
    b = await upd(st.u.staff, await get(st, b.id, 'staff'), { sessions: [{ id: s1, ...m, crew: [] }, { id: s2, ...e, crew: [{ crew_id: st.A }] }] });
    b = await get(st, b.id);
    eq(b.sessions.map((s) => s.crew.map((c) => c.fee)), [[], [9000]]);
    money(b.money.crew_cost_total, 9000);
    // ลบคิวเย็นแล้วสร้างคิวใหม่ (ไม่มี id) ใส่คนเดิม
    b = await upd(st.u.staff, await get(st, b.id, 'staff'), { sessions: [{ id: s1, ...m, crew: [] }, { ...e, title: 'คิวใหม่', crew: [{ crew_id: st.A }] }] });
    b = await get(st, b.id);
    eq(b.sessions.map((s) => s.crew.map((c) => c.fee)), [[], [9000]]);
    // ใส่คนเดิมเพิ่มอีกคิว (ไม่ได้ย้าย) = คิวใหม่จริง → ค่าตัวตั้งต้น / แถวเดิมใช้ได้ครั้งเดียว
    const s3 = b.sessions[1].id;
    b = await upd(st.u.staff, await get(st, b.id, 'staff'), { sessions: [{ id: s1, ...m, crew: [{ crew_id: st.A }] }, { id: s3, ...e, title: 'คิวใหม่', crew: [{ crew_id: st.A }] }] });
    b = await get(st, b.id);
    eq(b.sessions.map((s) => s.crew.map((c) => c.fee)), [[2500], [9000]]);
    // เอาคนเดิมออกทั้งสองคิวแล้วใส่ใหม่สองคิวพร้อมกัน → ได้ค่าตัวเดิมกลับทั้งสองแถว
    b = await upd(st.u.staff, await get(st, b.id, 'staff'), { sessions: [{ ...m, crew: [{ crew_id: st.A }] }, { ...e, crew: [{ crew_id: st.A }] }] });
    b = await get(st, b.id);
    eq(b.sessions.map((s) => s.crew.map((c) => c.fee)).flat().sort(), [2500, 9000]);
    money(b.money.crew_cost_total, 11500);
    // คนใหม่ที่ไม่เคยอยู่ในงาน = ค่าตัวตั้งต้น / ผู้จัดการส่งค่าตัวมาเอง = ตามที่ส่ง
    b = await upd(st.u.staff, b, { sessions: b.sessions.map((s, i) => ({ id: s.id, ...(i ? e : m), crew: i ? [{ crew_id: st.A }] : [{ crew_id: st.A }, { crew_id: st.C }] })) });
    b = await get(st, b.id);
    eq(b.sessions[0].crew.find((c) => c.crew_id === st.C).fee, 1200);
    b = await upd(st.u.mgr, b, { sessions: [{ id: b.sessions[0].id, ...m, crew: [] }, { id: b.sessions[1].id, ...e, crew: [{ crew_id: st.C, fee: 777 }] }] });
    eq(b.sessions[1].crew.map((c) => [c.crew_id, c.fee]), [[st.C, 777]]);
  });

  test('วันงานเปลี่ยน (เลื่อนงาน → ใส่วันใหม่ → กลับมาจัด / แก้วันของงานที่ยืนยันแล้ว) → กำหนดส่งที่ยังไม่ส่งเลื่อนตาม', async (ctx, st) => {
    const day = addDays(st.today, 20);
    let b = await create(st.u.staff, payload(st.d, day, { status: 'confirmed', force: true }));
    eq(b.deliverables.map((d) => d.due_date), [addDays(day, 30), addDays(day, 45)]);
    b = await st.u.staff.rpc('wed_postpone', { p_booking_id: b.id, p_reason: 'ฤกษ์ใหม่' });
    // ระหว่างเลื่อน: ลบวันที่ก่อน (ยังไม่รู้วันใหม่) → กำหนดส่งยังไม่ขยับ
    b = await upd(st.u.staff, b, { sessions: [{ id: b.sessions[0].id, session_type: 'reception', date: null }] });
    eq(b.deliverables.map((d) => d.due_date), [addDays(day, 30), addDays(day, 45)]);
    const nd = addDays(st.today, 210);
    b = await upd(st.u.staff, b, { sessions: [{ id: b.sessions[0].id, session_type: 'reception', date: nd }] });
    b = await st.u.staff.rpc('wed_resume', { p_booking_id: b.id });
    eq([b.status, b.deliverables.map((d) => d.due_date)], ['confirmed', [addDays(nd, 30), addDays(nd, 45)]]);
    ok(b.deliverables.every((d) => d.due_date > nd), 'กำหนดส่งต้องหลังวันงานใหม่');
    const lg = b.logs.find((l) => l.action === 'deliverables_shift');
    eq([lg.detail.from, lg.detail.to, lg.detail.days, lg.detail.items], [day, nd, 190, 2]);
    // ลิงก์ลูกค้าเห็นกำหนดส่งหลังวันงาน
    const pub = await ctx.anon.rpc('wed_public_booking', { p_token: b.public_token });
    eq(pub.deliverables.map((d) => d.due_date), [addDays(nd, 30), addDays(nd, 45)]);
    // ส่งแล้ว 1 รายการ → แก้วันงานอีก: เฉพาะรายการที่ยังไม่ส่งเลื่อน
    b = await st.u.staff.rpc('wed_save_deliverable', { p_booking_id: b.id, p_item: { id: b.deliverables[0].id, status: 'delivered', link_url: 'https://drive.example.com/x' } });
    const nd2 = addDays(nd, -5);
    b = await upd(st.u.staff, b, { sessions: [{ id: b.sessions[0].id, session_type: 'reception', date: nd2 }] });
    eq(b.deliverables.map((d) => [d.status, d.due_date]), [['delivered', addDays(nd, 30)], ['pending', addDays(nd2, 45)]]);
    // บันทึกเงิน (คำนวณใหม่แต่วันไม่เปลี่ยน) → ไม่ขยับซ้ำ
    const r = await pay(st.u.staff, b.id, 1000);
    eq(r.booking.deliverables.map((d) => d.due_date), [addDays(nd, 30), addDays(nd2, 45)]);
    eq(r.booking.logs.filter((l) => l.action === 'deliverables_shift').length, 2);
  });

  test('ล็อกคิว/ยืนยัน: ต้องมีวันที่ครบทุกคิว (คิวที่ยกเลิกไม่นับ) — ปุ่มและเหตุผลตรงกับเซิร์ฟเวอร์', async (ctx, st) => {
    const day = addDays(st.today, 180);
    let b = await create(st.u.staff, payload(st.d, day, {
      sessions: [{ session_type: 'reception', date: day }, { session_type: 'ceremony', date: null }],
    }));
    eq([b.actions.can_hold, b.actions.can_confirm], [false, false]);
    eq([b.actions.block_reasons.hold, b.actions.block_reasons.confirm],
      ['กรุณาระบุวันที่ของทุกคิวงานก่อน (หรือยกเลิกคิวที่ยังไม่มีวัน)', 'กรุณาระบุวันที่ของทุกคิวงานก่อน (หรือยกเลิกคิวที่ยังไม่มีวัน)']);
    await expectErr(() => st.u.staff.rpc('wed_hold', { p_booking_id: b.id }), 'กรุณาระบุวันที่ของทุกคิวงานก่อน');
    await expectErr(() => st.u.staff.rpc('wed_confirm', { p_booking_id: b.id, p_force: true }), 'กรุณาระบุวันที่ของทุกคิวงานก่อน');
    eq((await get(st, b.id)).status, 'inquiry');
    // ยกเลิกคิวที่ไม่มีวัน → ล็อกคิว/ยืนยันได้ และแก้งานต่อได้ตามปกติ
    b = await upd(st.u.staff, b, { sessions: [{ id: b.sessions[0].id, session_type: 'reception', date: day },
                                              { id: b.sessions[1].id, session_type: 'ceremony', date: null, status: 'cancelled' }] });
    eq([b.actions.can_hold, b.actions.can_confirm, b.actions.block_reasons.hold], [true, true, null]);
    b = await st.u.staff.rpc('wed_hold', { p_booking_id: b.id });
    b = await st.u.staff.rpc('wed_confirm', { p_booking_id: b.id, p_force: true });
    eq(b.status, 'confirmed');
    b = await upd(st.u.staff, b, { note: 'แก้หลังยืนยัน', sessions: b.sessions.map((s) => ({ id: s.id, session_type: s.session_type, date: s.date, status: s.status })) });
    eq(b.note, 'แก้หลังยืนยัน');
  });

  test('งวดมัดจำของงานสอบถามเก่าที่เพิ่งล็อกคิว/ยืนยัน = ครบกำหนดวันนี้ ไม่ขึ้นเลยกำหนดทันที', async (ctx, st) => {
    const mk = async (d) => {
      const b = await create(st.u.staff, payload(st.d, d));
      await ctx.pg.query(`update public.wed_bookings set created_at = now() - interval '20 days' where id = $1`, [b.id]);
      return b;
    };
    const overdueBefore = (await st.u.staff.rpc('wed_badges')).installments_overdue;
    const h = await mk(addDays(st.today, 190));
    let b = await st.u.staff.rpc('wed_hold', { p_booking_id: h.id });
    eq(b.installments.map((i) => [i.label, i.due_date, i.status, i.overdue]),
      [['มัดจำ', st.today, 'due', false], ['ยอดคงเหลือ', addDays(st.today, 183), 'upcoming', false]]);
    eq(b.next_due.overdue, false);
    const c = await mk(addDays(st.today, 191));
    b = await st.u.staff.rpc('wed_confirm', { p_booking_id: c.id, p_force: true });
    eq([b.installments[0].due_date, b.installments[0].overdue], [st.today, false]);
    eq((await st.u.staff.rpc('wed_badges')).installments_overdue, overdueBefore);
    const today = await st.u.staff.rpc('wed_today');
    ok(!today.installments_due.some((x) => [h.id, c.id].includes(x.booking_id) && x.overdue), 'ภาพรวมวันนี้ไม่ควรมีงวดเลยกำหนดของงานที่เพิ่งล็อกคิว');
    // ล็อกคิวแล้วเลยกำหนดจริง (เช่น ล็อกไว้ 3 วันแล้วยังไม่จ่าย) → ยังขึ้นเลยกำหนดตามปกติ
    await ctx.pg.query(`update public.wed_bookings set deposit_due_on = public.pos_bkk_today() - 3 where id = $1`, [h.id]);
    b = await pay(st.u.staff, h.id, 100);
    eq([b.booking.installments[0].due_date, b.booking.installments[0].overdue], [addDays(st.today, -3), true]);
  });

  test('ค่าใช้จ่ายเพิ่มระหว่างเลื่อนงาน: งานที่ยืนยันแล้วถูกเลื่อน = เพิ่ม/ยกเลิกได้ / งานล็อกคิวที่ถูกเลื่อน = ไม่ได้', async (ctx, st) => {
    let b = await create(st.u.staff, payload(st.d, addDays(st.today, 200), { status: 'confirmed', force: true }));
    b = await st.u.staff.rpc('wed_postpone', { p_booking_id: b.id, p_reason: 'ลูกค้าขอเลื่อน' });
    eq([b.actions.can_add_charge, b.actions.block_reasons.add_charge], [true, null]);
    b = await st.u.staff.rpc('wed_add_charge', { p_client_id: uuid(), p_booking_id: b.id, p_kind: 'extra', p_description: 'ค่าเลื่อนวันงาน', p_amount: 2000 });
    money(b.money.grand_total, 47000);
    money(b.next_due.amount, 13500);   // มัดจำเดิม (คิดจากยอดหลังส่วนลด ไม่รวมค่าใช้จ่ายเพิ่ม)
    eq(b.installments.reduce((s, i) => s + i.amount, 0), 47000);
    b = await st.u.staff.rpc('wed_void_charge', { p_charge_id: b.charges[0].id, p_reason: 'ยกเว้นให้' });
    money(b.money.grand_total, 45000);
    let h = await create(st.u.staff, payload(st.d, addDays(st.today, 201), { status: 'hold' }));
    h = await st.u.staff.rpc('wed_postpone', { p_booking_id: h.id, p_reason: 'รอฤกษ์' });
    eq(h.actions.can_add_charge, false);
    ok(h.actions.block_reasons.add_charge, 'ต้องมีเหตุผลที่เพิ่มค่าใช้จ่ายไม่ได้');
    await expectErr(() => st.u.staff.rpc('wed_add_charge', { p_client_id: uuid(), p_booking_id: h.id, p_kind: 'extra', p_description: 'x', p_amount: 1 }),
      'เพิ่มค่าใช้จ่ายได้ตั้งแต่ยืนยันงาน');
  });

  test('จ่ายค่าตัวล็อกงานก่อนแก้ (กันชนกับการแก้งานพร้อมกัน) + หลายงานในครั้งเดียว + รหัสผิดรูปแบบยังแจ้งเป็นภาษาไทย', async (ctx, st) => {
    const src = (await ctx.pg.one(`select prosrc from pg_proc where proname = 'wed_mark_crew_paid'`)).prosrc;
    ok(src.includes('wed_lock_booking'), 'wed_mark_crew_paid ต้องล็อกงานก่อนเขียน');
    const x = await create(st.u.mgr, payload(st.d, addDays(st.today, 220), { sessions: [{ date: addDays(st.today, 220), crew: [{ crew_id: st.A, fee: 100 }] }] }));
    const y = await create(st.u.mgr, payload(st.d, addDays(st.today, 221), { sessions: [{ date: addDays(st.today, 221), crew: [{ crew_id: st.B, fee: 200 }] }] }));
    const r = await st.u.mgr.rpc('wed_mark_crew_paid', { p_items: [
      { session_id: y.sessions[0].id, crew_id: st.B, paid_on: st.today }, { session_id: x.sessions[0].id, crew_id: st.A, paid_on: st.today }] });
    eq(r.updated, 2);
    await expectErr(() => st.u.mgr.rpc('wed_mark_crew_paid', { p_items: [{ session_id: 'not-a-uuid', crew_id: st.A, paid_on: st.today }] }), 'คิวงาน');
  });

  test('ทีมชนคิว: งานที่ยกเลิก/เลื่อนไม่แสดงคำเตือนชนคิว (อีกงานก็ไม่ชนแล้ว) / งานสอบถามยังเตือนล่วงหน้า', async (ctx, st) => {
    const day = addDays(st.today, 230);
    const s = (t) => ({ date: day, start_time: t[0], end_time: t[1], crew: [{ crew_id: st.A }] });
    const x = await create(st.u.staff, payload(st.d, day, { status: 'hold', sessions: [s(['10:00', '14:00'])] }));
    let y = await create(st.u.staff, payload(st.d, day, { status: 'hold', sessions: [s(['12:00', '16:00'])] }));
    eq([y.crew_conflicts.length, y.sessions[0].conflicts.length, (await get(st, x.id)).crew_conflicts.length], [1, 1, 1]);
    const q = await create(st.u.staff, payload(st.d, day, { sessions: [s(['11:00', '13:00'])] }));   // สอบถาม
    ok((await get(st, q.id)).crew_conflicts.length >= 1, 'งานสอบถามต้องเห็นว่าทีมชนคิว');
    y = await st.u.staff.rpc('wed_postpone', { p_booking_id: y.id, p_reason: 'เลื่อน' });
    eq([y.crew_conflicts, y.sessions[0].conflicts, (await get(st, x.id)).crew_conflicts.length], [[], [], 0]);
    y = await st.u.staff.rpc('wed_cancel', { p_booking_id: y.id, p_reason: 'ยกเลิก' });
    eq([y.crew_conflicts, y.sessions[0].conflicts], [[], []]);
  });

  test('วัตถุประสงค์อัตโนมัติ: จ่ายครบทั้งยอดครั้งเดียว = ยอดคงเหลือ (ไม่ใช่มัดจำ) / จ่ายไม่ถึงมัดจำ = มัดจำ', async (ctx, st) => {
    const b = await create(st.u.staff, payload(st.d, addDays(st.today, 240), { package_price: 10000 }));
    let r = await pay(st.u.staff, b.id, 10000);
    eq([r.payment.purpose, r.payment.purpose_label, r.booking.money.due], ['balance', 'ยอดคงเหลือ', 0]);
    const c = await create(st.u.staff, payload(st.d, addDays(st.today, 241), { package_price: 10000 }));
    r = await pay(st.u.staff, c.id, 1000);
    eq(r.payment.purpose, 'deposit');
    r = await pay(st.u.staff, c.id, 9000);   // ยังไม่ครบมัดจำ แต่ปิดยอดทั้งหมด
    eq(r.payment.purpose, 'balance');
  });

  test('ยกเลิกรายการคืนเงินหลังลูกค้าจ่ายเพิ่ม → ยอดจะเกินยอดสุทธิ = ไม่ได้ (ยกเลิกรายการรับซ้ำก่อน)', async (ctx, st) => {
    const b = await create(st.u.staff, payload(st.d, addDays(st.today, 250), { package_price: 10000 }));
    await pay(st.u.staff, b.id, 10000);
    const rf = await pay(st.u.staff, b.id, 4000, { kind: 'refund' });
    const p2 = await pay(st.u.staff, b.id, 4000);
    await expectErr(() => st.u.mgr.rpc('wed_void_payment', { p_payment_id: rf.payment.id, p_reason: 'คืนผิด' }),
      'ยอดชำระจะเป็น ฿14,000.00 เกินยอดสุทธิ ฿10,000.00');
    money((await get(st, b.id)).money.paid, 10000);
    await st.u.mgr.rpc('wed_void_payment', { p_payment_id: p2.payment.id, p_reason: 'รับซ้ำ' });
    const r = await st.u.mgr.rpc('wed_void_payment', { p_payment_id: rf.payment.id, p_reason: 'คืนผิด' });
    eq([r.booking.money.paid, r.booking.money.due], [10000, 0]);
  });

  test('ล็อกคิวที่รับเงินแล้วคืนเงินหมด → หมดเวลาตามปกติ (กลับเป็นสอบถาม) / ยังมีเงินสุทธิ = คงล็อกคิว', async (ctx, st) => {
    const a = await create(st.u.staff, payload(st.d, addDays(st.today, 260), { status: 'hold' }));
    await pay(st.u.staff, a.id, 1000);
    await pay(st.u.staff, a.id, 1000, { kind: 'refund' });
    const k = await create(st.u.staff, payload(st.d, addDays(st.today, 261), { status: 'hold' }));
    await pay(st.u.staff, k.id, 1000);
    await pay(st.u.staff, k.id, 400, { kind: 'refund' });
    await ctx.pg.query(`update public.wed_bookings set hold_until = now() - interval '10 days' where id = any($1::uuid[])`, [[a.id, k.id]]);
    const t = await st.u.staff.rpc('wed_today');
    const ids = t.holds_expiring.map((x) => x.id ?? x.booking_id);
    ok(!ids.includes(a.id), 'งานที่คืนเงินหมดต้องไม่ค้างอยู่ใน "ล็อกคิวใกล้หมด"');
    ok(ids.includes(k.id), 'งานที่ยังมีเงินสุทธิยังต้องอยู่ใน "ล็อกคิวใกล้หมด" (รอยืนยัน)');
    eq([(await get(st, a.id)).status, (await get(st, k.id)).status], ['inquiry', 'hold']);
    ok((await get(st, a.id)).logs.some((l) => l.action === 'hold_expired'), 'ต้องมีประวัติล็อกคิวหมดเวลา');
  });

  test('งาน "ส่งงานแล้ว" เพิ่มรายการส่งงานใหม่ที่ยังไม่ส่ง → กลับเป็นรอส่งงาน / เพิ่มรายการที่ส่งแล้ว = คงสถานะ', async (ctx, st) => {
    const day = addDays(st.today, -6);
    let b = await create(st.u.staff, payload(st.d, day, { status: 'confirmed', force: true }));
    b = await st.u.staff.rpc('wed_mark_shot', { p_booking_id: b.id });
    for (const d of b.deliverables) {
      b = await st.u.staff.rpc('wed_save_deliverable', { p_booking_id: b.id, p_item: { id: d.id, status: 'delivered', link_url: 'https://drive.example.com/d' } });
    }
    eq(b.status, 'delivered');
    b = await st.u.staff.rpc('wed_save_deliverable', { p_booking_id: b.id, p_item: { client_id: uuid(), name: 'ภาพเพิ่ม', status: 'delivered', note: 'ส่งทางไลน์' } });
    eq(b.status, 'delivered');
    b = await st.u.staff.rpc('wed_save_deliverable', { p_booking_id: b.id, p_item: { client_id: uuid(), name: 'คลิปสั้นเพิ่ม' } });
    eq([b.status, b.delivered_at, b.deliverables_summary], ['in_production', null, { total: 4, open: 1, delivered: 3 }]);
    ok(b.logs.some((l) => l.action === 'auto_back_to_production'), 'ต้องมีประวัติกลับไปรอส่งงาน');
  });

  test('วันที่รับเงิน/จ่ายค่าตัวย้อนหลัง: ผู้จัดการย้อนได้ไม่เกิน 3 ปี (กันพิมพ์ปีผิด 1900)', async (ctx, st) => {
    const b = await create(st.u.mgr, payload(st.d, addDays(st.today, 270), { sessions: [{ date: addDays(st.today, 270), crew: [{ crew_id: st.A, fee: 10 }] }] }));
    await expectErr(() => pay(st.u.mgr, b.id, 100, { paid_on: '1900-01-01' }), 'วันที่รับเงินย้อนหลังได้ไม่เกิน 3 ปี');
    const ok2y = addDays(st.today, -730);
    eq((await pay(st.u.mgr, b.id, 100, { paid_on: ok2y })).payment.paid_on, ok2y);
    await expectErr(() => markPaid(st, b.sessions[0].id, st.A, '1900-01-01'), 'วันที่จ่ายค่าตัวย้อนหลังได้ไม่เกิน 3 ปี');
    eq((await markPaid(st, b.sessions[0].id, st.A, ok2y)).updated, 1);
  });

  test('กระดานงานส่ง: งานที่ปิดแล้วไม่นับใน "ยังไม่ส่ง/เลยกำหนด" — ตรงกับตัวเลขบนเมนูและภาพรวมวันนี้', async (ctx, st) => {
    const past = addDays(st.today, -50);
    let b = await create(st.u.staff, payload(st.d, past, { status: 'confirmed', force: true, package_price: 1000 }));
    b = await st.u.staff.rpc('wed_mark_shot', { p_booking_id: b.id });
    await pay(st.u.staff, b.id, 1000);
    const before = (await st.u.staff.rpc('wed_badges')).deliverables_overdue;
    const inBoard = async (status) => (await st.u.staff.rpc('wed_deliverables_board', { p_status: status })).filter((x) => x.booking_id === b.id).length;
    eq([await inBoard('overdue'), await inBoard('open')], [2, 2]);   // past+30 / past+45 เลยกำหนดทั้งคู่
    b = await st.u.staff.rpc('wed_complete', { p_booking_id: b.id, p_force: true });
    eq(b.status, 'completed');
    eq([await inBoard('overdue'), await inBoard('open'), await inBoard(null), await inBoard('pending')], [0, 0, 2, 2]);
    eq((await st.u.staff.rpc('wed_badges')).deliverables_overdue, before - 2);
    const t = await st.u.staff.rpc('wed_today');
    ok(!t.deliverables_due.some((x) => x.booking_id === b.id), 'ภาพรวมวันนี้ไม่ควรมีงานที่ปิดแล้ว');
  });

  test('ส่งออก CSV งาน: จำนวนบริการเสริมทศนิยมแสดงตามจริง (1.5 ไม่ปัดเป็น 2) ตรงกับยอดเงิน', async (ctx, st) => {
    const day = addDays(st.today, 280);
    const b = await create(st.u.staff, payload(st.d, day, { addons: [
      { addon_id: st.d.addon.id, qty: 1.5 }, { name: 'โดรน', qty: 2, unit_price: 100 }, { name: 'ไฟ', qty: 10, unit_price: 1 }, { name: 'จอ', qty: 0.25, unit_price: 4 }] }));
    money(b.money.addons_total, 2250 + 200 + 10 + 1);
    const rows = await st.u.mgr.rpcRows('wed_export_bookings', { p_from: day, p_to: day });
    const row = rows.find((r) => r.booking_no === b.booking_no);
    eq(row.addons, 'ชั่วโมงเพิ่ม x1.5; โดรน x2; ไฟ x10; จอ x0.25');
    money(Number(row.addons_total), 2461);
  });

  test('งานกระชั้นชิด (สร้าง 5 วันก่อนงาน ชำระยอดคงเหลือก่อนงาน 7 วัน): วันชำระยอดคงเหลือ = วันนี้ ทุกที่ตรงกัน ไม่เลยกำหนดตั้งแต่วันสร้าง', async (ctx, st) => {
    const day = addDays(st.today, 5);
    const p = payload(st.d, day, { status: 'hold' });
    const q = await st.u.staff.rpc('wed_quote', { p_payload: p });
    eq(q.money.balance_due_date, st.today);
    const b = await create(st.u.staff, p);
    eq([b.money.balance_due_date, b.installments.map((i) => i.due_date)], [st.today, [st.today, st.today]]);
    ok(b.installments.every((i) => !i.overdue), 'ไม่ควรมีงวดเลยกำหนดในวันที่สร้าง');
    eq(b.next_due.overdue, false);
    // วันที่กำหนดเองยังใช้ตามที่กำหนด / งานที่ยังไม่มีวัน = ยังไม่มีวันชำระยอดคงเหลือ
    const o = await create(st.u.staff, payload(st.d, addDays(st.today, 30), { balance_due_date_override: addDays(st.today, 2) }));
    eq(o.money.balance_due_date, addDays(st.today, 2));
    const n = await create(st.u.staff, payload(st.d, null, { sessions: [{ session_type: 'reception', date: null }] }));
    eq(n.money.balance_due_date, null);
    eq((await st.u.staff.rpc('wed_quote', { p_payload: payload(st.d, null, { sessions: [{ date: null }] }) })).money.balance_due_date, null);
  });
  test('รหัสคำขอสร้างงาน: ส่งซ้ำพร้อม force (คำตอบแรกหาย แล้วคิวเต็มเพราะงานของตัวเอง) = ข้อมูลชุดเดิม ไม่สร้างงาน/มัดจำซ้ำ', async (ctx, st) => {
    const day = addDays(st.today, 300);
    const cid = uuid();
    const p = payload(st.d, day, { status: 'confirmed', force: false, payments: [{ method: 'transfer', amount: 13500, note: 'มัดจำ' }] });
    const r1 = await st.u.staff.rpc('wed_create_booking', { p_client_id: cid, p_payload: p });
    eq([r1.already_saved, r1.payload_matches, r1.booking.status], [false, true, 'confirmed']);
    for (const again of [{ ...p, force: true }, (({ force, ...rest }) => rest)(p)]) {
      const r = await st.u.staff.rpc('wed_create_booking', { p_client_id: cid, p_payload: again });
      eq([r.already_saved, r.payload_matches, r.booking.id], [true, true, r1.booking.id]);
    }
    // ข้อมูลงานต่างจริง (ไม่ใช่แค่ force) → ยังแจ้งว่าไม่ตรง
    eq((await st.u.staff.rpc('wed_create_booking', { p_client_id: cid, p_payload: { ...p, force: true, note: 'อื่น' } })).payload_matches, false);
    eq((await ctx.pg.one(`select count(*)::int as n from public.wed_bookings where client_id = '${cid}'`)).n, 1);
    eq((await ctx.pg.one(`select count(*)::int as n from public.wed_payments where booking_id = '${r1.booking.id}'`)).n, 1);
  });

  test('รหัสคำขอแก้ไขงาน: ส่งซ้ำโดยเปลี่ยนแค่ force = บันทึกแล้ว (ไม่ปฏิเสธว่ารหัสถูกใช้กับข้อมูลชุดอื่น)', async (ctx, st) => {
    const day = addDays(st.today, 310);
    const b0 = await create(st.u.staff, payload(st.d, day));
    const edit = { client_id: uuid(), note: 'แก้รอบแรก', force: false };
    const b1 = await upd(st.u.staff, b0, edit);
    eq(b1.note, 'แก้รอบแรก');
    const b2 = await upd(st.u.staff, b0, { ...edit, force: true });
    eq([b2.already_saved, b2.updated_at], [true, b1.updated_at]);
    const { force, ...noForce } = edit;
    eq((await upd(st.u.staff, b0, noForce)).already_saved, true);
    await expectErr(() => upd(st.u.staff, b1, { ...edit, force: true, note: 'อื่น' }), 'รหัสคำขอนี้ถูกใช้บันทึกการแก้ไขชุดอื่นไปแล้ว');
    eq((await get(st, b0.id)).logs.filter((l) => l.action === 'update').length, 1);
  });
}
