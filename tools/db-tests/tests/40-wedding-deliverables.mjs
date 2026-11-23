// งานที่ต้องส่ง: สร้างจากแผนตอนยืนยัน, แผนแก้ได้ก่อนยืนยัน, ส่งแล้วต้องมีลิงก์/หมายเหตุ, ส่งครบ → สถานะงานเปลี่ยนเอง, กระดานงานตัดต่อ
import { eq, ok, expectErr, uuid } from '../run.mjs';
import { makeUsers, seed, payload, create, bkkToday, addDays } from './lib/wed.js';

export async function setup(ctx, st) {
  st.u = await makeUsers(ctx);
  st.d = await seed(ctx, st.u);
  st.today = await bkkToday(ctx);
}

export function register(test) {
  test('แผนงานส่ง: ตามแพ็กเกจ / แก้ได้ก่อนยืนยัน / หลังยืนยันแก้แผนไม่ได้ / แพ็กเกจแก้ทีหลังไม่กระทบงานเดิม', async (ctx, st) => {
    const day = addDays(st.today, 20);
    let b = await create(st.u.staff, payload(st.d, day));
    eq(b.deliverables_plan.map((x) => x.name), ['ภาพตกแต่ง', 'วิดีโอไฮไลต์']);
    eq(b.deliverables, []);
    b = await st.u.staff.rpc('wed_update_booking', { p_booking_id: b.id, p_updated_at: b.updated_at, p_payload: {
      deliverables_plan: [{ name: 'ภาพตกแต่ง', qty: 300, unit: 'ภาพ', due_days: 14 }, { name: '' }, { name: 'คลิปสั้น', due_days: 7 }] } });
    eq(b.deliverables_plan, [{ name: 'ภาพตกแต่ง', qty: 300, unit: 'ภาพ', due_days: 14 }, { name: 'คลิปสั้น', qty: 1, unit: null, due_days: 7 }]);
    // แก้แพ็กเกจกลางทาง: งานเดิมไม่เปลี่ยน
    await st.u.mgr.rpc('wed_save_package', { p_package: { id: st.d.pkg.id, price: 99999, deliverables: [{ name: 'อื่น' }] } });
    try {
      b = await st.u.staff.rpc('wed_get_booking', { p_booking_id: b.id });
      eq([b.package.price, b.deliverables_plan.length], [45000, 2]);
      b = await st.u.staff.rpc('wed_confirm', { p_booking_id: b.id, p_force: true });
      eq(b.deliverables.map((x) => [x.name, x.qty, x.unit, x.due_date, x.status, x.status_label]), [
        ['ภาพตกแต่ง', 300, 'ภาพ', addDays(day, 14), 'pending', 'รอตัด'],
        ['คลิปสั้น', 1, null, addDays(day, 7), 'pending', 'รอตัด']]);
      await expectErr(() => st.u.staff.rpc('wed_update_booking', { p_booking_id: b.id, p_updated_at: b.updated_at,
        p_payload: { deliverables_plan: [{ name: 'ใหม่' }] } }), 'แผนงานที่ส่งแก้ได้ก่อนยืนยันงานเท่านั้น');
      // ส่งแผนเดิมมา (ฟอร์มส่งทุกช่อง) = ไม่ error
      const same = await st.u.staff.rpc('wed_update_booking', { p_booking_id: b.id, p_updated_at: b.updated_at,
        p_payload: { deliverables_plan: b.deliverables_plan, note: 'ok' } });
      eq(same.note, 'ok');
      // ยืนยันซ้ำ / ถ่ายเสร็จ ไม่สร้างรายการซ้ำ
      const shot = await st.u.staff.rpc('wed_mark_shot', { p_booking_id: b.id, p_force: true });
      eq(shot.deliverables.length, 2);
    } finally {
      await st.u.mgr.rpc('wed_save_package', { p_package: { id: st.d.pkg.id, price: 45000,
        deliverables: [{ name: 'ภาพตกแต่ง', qty: 500, unit: 'ภาพ', due_days: 30 }, { name: 'วิดีโอไฮไลต์', qty: 1, unit: 'คลิป', due_days: 45 }] } });
    }
  });

  test('บันทึกรายการส่งงาน: ส่งแล้วต้องมีลิงก์หรือหมายเหตุ, ลิงก์ต้อง http(s), กันซ้ำด้วย client_id, ผู้ตัดต่อ', async (ctx, st) => {
    const b = await create(st.u.staff, payload(st.d, st.today, { status: 'confirmed', force: true }));
    const id0 = b.deliverables[0].id;
    const save = (item) => st.u.staff.rpc('wed_save_deliverable', { p_booking_id: b.id, p_item: item });
    await expectErr(() => save({ id: id0, status: 'delivered' }), 'ต้องใส่ลิงก์ส่งงาน หรือหมายเหตุ');
    await expectErr(() => save({ id: id0, status: 'delivered', link_url: 'javascript:alert(1)' }), 'ลิงก์ส่งงาน ต้องขึ้นต้นด้วย http');
    await expectErr(() => save({ id: id0, status: 'done' }), 'สถานะงานที่ส่งไม่ถูกต้อง');
    await expectErr(() => save({ id: id0, editor_crew_id: uuid() }), 'ไม่พบผู้ตัดต่อ');
    let r = await save({ id: id0, status: 'editing', editor_crew_id: st.d.crew[1].id });
    eq([r.deliverable.status, r.deliverable.editor_name, r.deliverable.delivered_at, r.status], ['editing', 'ไล', null, 'confirmed']);
    r = await save({ id: id0, status: 'delivered', note: 'ส่งทาง Google Drive ของลูกค้า' });
    ok(r.deliverable.delivered_at, 'ส่งแล้วต้องมีเวลาส่ง');
    eq(r.status, 'confirmed', 'ยังไม่ถ่ายเสร็จ = ไม่เปลี่ยนสถานะงาน');
    const cid = uuid();
    r = await save({ client_id: cid, name: 'อัลบั้ม', qty: 1, unit: 'เล่ม', due_date: addDays(st.today, 60) });
    const again = await save({ client_id: cid, name: 'อัลบั้ม' });
    eq([again.already_saved, again.deliverable.id, again.deliverables.length], [true, r.deliverable.id, 3]);
    await expectErr(() => save({ name: '' }), 'กรุณาใส่ชื่องานที่ส่ง');
    const other = await create(st.u.staff, payload(st.d, st.today));
    await expectErr(() => st.u.staff.rpc('wed_save_deliverable', { p_booking_id: other.id, p_item: { id: id0, status: 'pending' } }), 'ไม่พบรายการส่งงานนี้');
    await expectErr(() => st.u.staff.rpc('wed_save_deliverable', { p_booking_id: other.id, p_item: { client_id: cid, name: 'x' } }), 'รหัสคำขอนี้ถูกใช้กับงานอื่นแล้ว');
  });

  test('ส่งครบทุกรายการระหว่างรอส่งงาน → "ส่งงานแล้ว" เอง / เปิดรายการกลับ → กลับเป็นรอส่งงาน / ลบรายการที่ค้าง → ส่งครบ', async (ctx, st) => {
    const b = await create(st.u.staff, payload(st.d, st.today, { status: 'confirmed', force: true }));
    await st.u.staff.rpc('wed_mark_shot', { p_booking_id: b.id });
    const [d1, d2] = b.deliverables.map((x) => x.id);
    const save = (item) => st.u.staff.rpc('wed_save_deliverable', { p_booking_id: b.id, p_item: item });
    let r = await save({ id: d1, status: 'delivered', link_url: 'https://drive.example.com/a' });
    eq(r.status, 'in_production');
    r = await save({ id: d2, status: 'delivered', link_url: 'https://drive.example.com/b' });
    eq([r.status, r.deliverables_summary], ['delivered', { total: 2, open: 0, delivered: 2 }]);
    ok(r.logs.some((l) => l.action === 'auto_delivered'), 'ไม่มีประวัติส่งงานครบอัตโนมัติ');
    ok(r.delivered_at, 'ไม่มีเวลาส่งงาน');
    r = await save({ id: d2, status: 'review' });
    eq([r.status, r.delivered_at], ['in_production', null]);
    ok(r.logs.some((l) => l.action === 'auto_back_to_production'), 'ไม่มีประวัติกลับไปรอส่งงาน');
    r = await st.u.staff.rpc('wed_delete_deliverable', { p_id: d2 });
    eq([r.status, r.deliverables.length], ['delivered', 1]);
    // ส่งงานแล้วด้วยมือ (ยังมีรายการค้าง) — แก้รายการที่ไม่ได้ส่งไม่ทำให้สถานะถอย
    const b2 = await create(st.u.staff, payload(st.d, st.today, { status: 'confirmed', force: true }));
    await st.u.staff.rpc('wed_mark_shot', { p_booking_id: b2.id });
    r = await st.u.staff.rpc('wed_mark_delivered', { p_booking_id: b2.id });
    eq(r.status, 'delivered');
    r = await st.u.staff.rpc('wed_save_deliverable', { p_booking_id: b2.id, p_item: { id: r.deliverables[0].id, status: 'editing' } });
    eq(r.status, 'delivered');
  });

  test('กระดานงานตัดต่อ: เรียงตามกำหนดส่ง, เลยกำหนด, กรองสถานะ/ช่วงวันที่, ไม่รวมงานที่ยกเลิก', async (ctx, st) => {
    const past = addDays(st.today, -40);
    const b = await create(st.u.staff, payload(st.d, past, { couple_names: 'คู่ย้อนหลัง', status: 'confirmed', force: true }));
    // past + 30 = 10 วันก่อน (เลยกำหนด) / past + 45 = อีก 5 วัน
    const all = await st.u.staff.rpc('wed_deliverables_board', {});
    const mine = all.filter((x) => x.booking_id === b.id);
    eq(mine.map((x) => [x.name, x.due_date, x.overdue, x.booking_no, x.couple_names, x.booking_status, x.last_session_date]), [
      ['ภาพตกแต่ง', addDays(past, 30), true, b.booking_no, 'คู่ย้อนหลัง', 'confirmed', past],
      ['วิดีโอไฮไลต์', addDays(past, 45), false, b.booking_no, 'คู่ย้อนหลัง', 'confirmed', past]]);
    const dates = all.map((x) => x.due_date ?? '9999');
    eq(dates, [...dates].sort(), 'ต้องเรียงตามกำหนดส่ง');
    const overdue = await st.u.staff.rpc('wed_deliverables_board', { p_status: 'overdue' });
    ok(overdue.every((x) => x.overdue) && overdue.some((x) => x.booking_id === b.id), 'กรองเลยกำหนดผิด');
    eq((await st.u.staff.rpc('wed_badges')).deliverables_overdue, overdue.length);
    // ภาพรวมวันนี้: งานส่งที่เลยกำหนด + ครบกำหนดใน 7 วัน
    const due = (await st.u.staff.rpc('wed_today', {})).deliverables_due.filter((x) => x.booking_id === b.id);
    eq(due.map((x) => [x.name, x.overdue, x.booking_no]), [['ภาพตกแต่ง', true, b.booking_no], ['วิดีโอไฮไลต์', false, b.booking_no]]);
    const ranged = await st.u.staff.rpc('wed_deliverables_board', { p_from: addDays(past, 40), p_to: addDays(past, 50) });
    eq(ranged.filter((x) => x.booking_id === b.id).map((x) => x.name), ['วิดีโอไฮไลต์']);
    await st.u.staff.rpc('wed_save_deliverable', { p_booking_id: b.id, p_item: { id: mine[0].id, status: 'delivered', link_url: 'https://x.example/1' } });
    eq((await st.u.staff.rpc('wed_deliverables_board', { p_status: 'delivered' })).filter((x) => x.booking_id === b.id).length, 1);
    eq((await st.u.staff.rpc('wed_deliverables_board', { p_status: 'open' })).filter((x) => x.booking_id === b.id).length, 1);
    await expectErr(() => st.u.staff.rpc('wed_deliverables_board', { p_status: 'lost' }), 'สถานะงานที่ส่งไม่ถูกต้อง');
    await st.u.mgr.rpc('wed_cancel', { p_booking_id: b.id, p_reason: 'ทดสอบ' });
    eq((await st.u.staff.rpc('wed_deliverables_board', {})).filter((x) => x.booking_id === b.id).length, 0);
  });
}
