// เงิน: ยอดเศษสตางค์, ส่วนลด, บริการเสริม (จำนวนทศนิยม), ค่าใช้จ่ายเพิ่ม, คืนเงิน, ยกเลิกรายการ, นโยบายมัดจำ ณ ตอนจอง,
//       งวดชำระ (ผลรวม/รับส่วนต่างอัตโนมัติ/สถานะ), กฎรับเงิน (วันที่ย้อนหลัง/รหัสคำขอ/สลิป), เลขใบเสร็จ, ขอบวันตามเวลาไทย
import { eq, ok, money, expectErr, uuid } from '../run.mjs';
import { makeUsers, seed, payload, create, pay, bkkToday, addDays } from './lib/wed.js';

export async function setup(ctx, st) {
  st.u = await makeUsers(ctx);
  st.d = await seed(ctx, st.u);
  st.today = await bkkToday(ctx);
}

export function register(test) {
  test('ยอดเงินเศษสตางค์: แพ็กเกจ + บริการเสริม (2.5 × 1,333.33) + ค่าเดินทาง − ส่วนลด, มัดจำปัดขึ้น', async (ctx, st) => {
    const day = addDays(st.today, 30);
    const b = await create(st.u.staff, payload(st.d, day, {
      addons: [{ name: 'ชั่วโมงเพิ่ม', qty: 2.5, unit_price: 1333.33, unit: 'ชม.' }, { addon_id: st.d.addon.id, qty: 0.5 }],
      travel_fee: 799.99, discount: 1234.56, discount_note: 'ลูกค้าเก่า',
    }));
    eq(b.addons.map((a) => [a.qty, a.unit_price, a.amount]), [[2.5, 1333.33, 3333.33], [0.5, 1500, 750]]);
    const m = b.money;
    money(m.addons_total, 4083.33);
    money(m.pre_discount_total, 45000 + 4083.33 + 799.99);
    money(m.base_total, 45000 + 4083.33 + 799.99 - 1234.56);   // 48648.76
    money(m.grand_total, 48648.76);
    money(m.deposit_required, 14595);                          // ceil(48648.76 × 30%) = ceil(14594.628)
    eq([m.deposit_percent, m.min_deposit, m.deposit_met], [30, 0, false]);
    eq(m.balance_due_date, addDays(day, -7));
    eq(b.discount_note, 'ลูกค้าเก่า');
    // quote = ยอดเดียวกันก่อนบันทึก
    const q = await st.u.staff.rpc('wed_quote', { p_payload: payload(st.d, day, {
      addons: [{ name: 'ชั่วโมงเพิ่ม', qty: 2.5, unit_price: 1333.33 }, { addon_id: st.d.addon.id, qty: 0.5 }],
      travel_fee: 799.99, discount: 1234.56 }) });
    money(q.money.grand_total, 48648.76);
    money(q.money.deposit_required, 14595);
    eq(q.money.discount_ok, true);
    // ส่วนลดเกินยอด → ไม่ได้ / เท่ายอดพอดี = 0 บาท ไม่มีงวด ไม่ต้องมัดจำ
    await expectErr(() => create(st.u.staff, payload(st.d, day, { discount: 45000.01 })), 'ส่วนลด (฿45,000.01) มากกว่ายอดก่อนส่วนลด (฿45,000.00)');
    eq((await st.u.staff.rpc('wed_quote', { p_payload: payload(st.d, day, { discount: 45000.01 }) })).money.discount_ok, false);
    const z = await create(st.u.staff, payload(st.d, day, { discount: 45000 }));
    eq([z.money.grand_total, z.money.deposit_required, z.money.deposit_met, z.installments.length, z.next_due], [0, 0, true, 0, null]);
    await expectErr(() => pay(st.u.staff, z.id, 1), 'งานนี้ไม่มียอดค้างชำระ');
    await expectErr(() => create(st.u.staff, payload(st.d, day, { travel_fee: 10.555 })), 'ทศนิยมได้ไม่เกิน 2 ตำแหน่ง');
    await expectErr(() => create(st.u.staff, payload(st.d, day, { travel_fee: -1 })), 'ต้องไม่ติดลบ');
    await expectErr(() => create(st.u.staff, payload(st.d, day, { addons: [{ name: 'x', qty: 0 }] })), 'จำนวนของ "x" ต้องมากกว่า 0');
    // แพ็กเกจกำหนดเอง (ไม่มี package_id) + แก้ราคาแพ็กเกจเฉพาะงานนี้
    const c = await create(st.u.staff, payload(st.d, day, { package_id: null, package_name: 'ถ่ายครึ่งวัน', package_price: 12345.67, package_hours: 4.5 }));
    eq([c.package.id, c.package.name, c.package.price, c.package.hours, c.deliverables_plan], [null, 'ถ่ายครึ่งวัน', 12345.67, 4.5, []]);
    const o = await create(st.u.staff, payload(st.d, day, { package_price: 39999 }));
    eq([o.package.id, o.package.name, o.package.price, o.deliverables_plan.length], [st.d.pkg.id, 'แพ็กเกจเต็มวัน', 39999, 2]);
    await expectErr(() => create(st.u.staff, payload(st.d, day, { package_id: null, package_price: 100 })), 'กรุณาใส่ชื่อแพ็กเกจ');
  });

  test('นโยบายมัดจำ ณ ตอนจอง: แก้ตั้งค่าทีหลังไม่กระทบงานเดิม / มัดจำขั้นต่ำ / มัดจำไม่เกินยอดสุทธิ', async (ctx, st) => {
    const day = addDays(st.today, 45);
    const old = await create(st.u.staff, payload(st.d, day));
    money(old.money.deposit_required, 13500);
    await st.u.mgr.rpc('wed_save_settings', { p_settings: { deposit_percent: 50, min_deposit: 30000, balance_due_days: 14 } });
    try {
      const r = await pay(st.u.staff, old.id, 100);   // ทำให้คำนวณใหม่
      eq([r.booking.money.deposit_percent, r.booking.money.min_deposit, r.booking.money.balance_due_days], [30, 0, 7]);
      money(r.booking.money.deposit_required, 13500);
      eq(r.booking.money.balance_due_date, addDays(day, -7));
      const nw = await create(st.u.staff, payload(st.d, day));
      money(nw.money.deposit_required, 30000);          // max(30,000, 50% × 45,000 = 22,500)
      eq(nw.money.balance_due_date, addDays(day, -14));
      const small = await create(st.u.staff, payload(st.d, day, { package_price: 20000 }));
      money(small.money.deposit_required, 20000);       // ไม่เกินยอดสุทธิ
      eq(small.installments.map((i) => [i.label, i.amount]), [['ชำระเต็มจำนวน', 20000]]);
      // กำหนดวันชำระยอดคงเหลือเอง
      const ov = await create(st.u.staff, payload(st.d, day, { balance_due_date_override: addDays(day, -3) }));
      eq(ov.money.balance_due_date, addDays(day, -3));
      eq(ov.installments[1].due_date, addDays(day, -3));
    } finally {
      await st.u.mgr.rpc('wed_save_settings', { p_settings: { deposit_percent: 30, min_deposit: 0, balance_due_days: 7 } });
    }
  });

  test('รับเงิน/คืนเงิน/ยกเลิกรายการ: ยอดค้าง/เกินยอด/คืนไม่เกินที่ชำระ/ยกเลิกแล้วยอดติดลบไม่ได้', async (ctx, st) => {
    const b = await create(st.u.staff, payload(st.d, addDays(st.today, 20)));
    await expectErr(() => pay(st.u.staff, b.id, 45000.01), 'ยอดชำระ ฿45,000.01 เกินยอดค้าง ฿45,000.00');
    await expectErr(() => pay(st.u.staff, b.id, 0), 'จำนวนเงินต้องมากกว่า 0');
    await expectErr(() => pay(st.u.staff, b.id, 100000000), 'สูงเกินไป');
    await expectErr(() => pay(st.u.staff, b.id, 10, { method: 'bitcoin' }), 'กรุณาเลือกวิธีชำระเงิน');
    await expectErr(() => pay(st.u.staff, b.id, 10, { kind: 'refund' }), 'ยังไม่มีเงินที่ชำระไว้ให้คืน');
    let r = await pay(st.u.staff, b.id, 13500.5, { method: 'cash' });
    eq([r.already_saved, r.payment.purpose, r.payment.purpose_label, r.payment.kind_label, r.payment.method_label], [false, 'deposit', 'มัดจำ', 'รับชำระ', 'เงินสด']);
    ok(/^WR-\d{8}-\d{3}$/.test(r.payment.receipt_no), 'เลขใบเสร็จผิดรูปแบบ');
    const r2 = await pay(st.u.staff, b.id, 1000);
    eq(r2.payment.purpose, 'installment');
    eq(Number(r2.payment.receipt_no.slice(-3)), Number(r.payment.receipt_no.slice(-3)) + 1);
    await expectErr(() => pay(st.u.staff, b.id, 14500.51, { kind: 'refund' }), 'คืนเงินได้ไม่เกินยอดที่ชำระแล้ว ฿14,500.50');
    const ref = await pay(st.u.staff, b.id, 14000.5, { kind: 'refund', method: 'transfer' });
    money(ref.booking.money.paid, 500);
    money(ref.booking.money.due, 44500);
    // ยกเลิกรับชำระที่ทำให้ยอดติดลบ → ต้องยกเลิกคืนเงินก่อน
    await expectErr(() => st.u.staff.rpc('wed_void_payment', { p_payment_id: r.payment.id, p_reason: 'ผิด' }), 'ยอดชำระจะติดลบ');
    await expectErr(() => st.u.staff.rpc('wed_void_payment', { p_payment_id: ref.payment.id, p_reason: '' }), 'กรุณาระบุเหตุผลที่ยกเลิกรายการเงิน');
    let v = await st.u.staff.rpc('wed_void_payment', { p_payment_id: ref.payment.id, p_reason: 'บันทึกผิด' });
    eq(v.already_voided, false);
    money(v.booking.money.paid, 14500.5);
    v = await st.u.staff.rpc('wed_void_payment', { p_payment_id: ref.payment.id, p_reason: 'ซ้ำ' });
    eq(v.already_voided, true);
    v = await st.u.staff.rpc('wed_void_payment', { p_payment_id: r.payment.id, p_reason: 'บันทึกผิด' });
    money(v.booking.money.paid, 1000);
    eq(v.booking.payments.filter((p) => p.voided_at).length, 2);
    // ชำระปิดยอด → วัตถุประสงค์ "ยอดคงเหลือ"
    const last = await pay(st.u.staff, b.id, 13500);
    eq(last.payment.purpose, 'deposit');
    const fin = await pay(st.u.staff, b.id, 30500);
    eq([fin.payment.purpose, fin.booking.money.due, fin.booking.next_due], ['balance', 0, null]);
    await expectErr(() => pay(st.u.staff, b.id, 1), 'งานนี้ไม่มียอดค้างชำระ');
    await expectErr(() => pay(st.u.staff, b.id, 10, { purpose: 'tip' }), 'วัตถุประสงค์ของรายการเงินไม่ถูกต้อง');
  });

  test('รหัสคำขอรับเงินกันซ้ำ + สลิปต้องอยู่ใต้ <booking_id>/ + วันที่รับเงิน (พนักงานย้อนหลัง 60 วัน / ผู้จัดการได้ทุกวัน / ห้ามอนาคต)', async (ctx, st) => {
    const b = await create(st.u.staff, payload(st.d, addDays(st.today, 20)));
    const other = await create(st.u.staff, payload(st.d, addDays(st.today, 21)));
    const cid = uuid();
    const call = (bid, amount = 1000, extra = {}) => st.u.staff.rpc('wed_add_payment', {
      p_client_id: cid, p_booking_id: bid, p_kind: 'payment', p_method: 'promptpay', p_amount: amount, ...extra });
    const a = await call(b.id);
    const a2 = await call(b.id, 999);
    eq([a2.already_saved, a2.payment.id, a2.payment.amount], [true, a.payment.id, 1000]);
    await expectErr(() => call(other.id), 'รหัสคำขอนี้ถูกใช้กับงานอื่นแล้ว');
    eq((await ctx.pg.one(`select count(*)::int as n from public.wed_payments where booking_id = $1`, [b.id])).n, 1);
    await expectErr(() => st.u.staff.rpc('wed_add_payment', { p_client_id: null, p_booking_id: b.id, p_kind: 'payment', p_method: 'cash', p_amount: 1 }),
      'รหัสคำขอไม่ถูกต้อง');

    await expectErr(() => pay(st.u.staff, b.id, 100, { slip_path: `${other.id}/slip.jpg` }), 'ที่อยู่ไฟล์สลิปไม่ถูกต้อง');
    await expectErr(() => pay(st.u.staff, b.id, 100, { slip_path: `${b.id}/../x.jpg` }), 'ที่อยู่ไฟล์สลิปไม่ถูกต้อง');
    await expectErr(() => pay(st.u.staff, b.id, 100, { slip_path: `x/${b.id}/a.jpg` }), 'ที่อยู่ไฟล์สลิปไม่ถูกต้อง');
    const s = await pay(st.u.staff, b.id, 100, { slip_path: `${b.id}/${uuid()}.jpg` });
    ok(s.payment.slip_path.startsWith(b.id + '/'), 'ไม่ได้เก็บที่อยู่สลิป');

    await expectErr(() => pay(st.u.staff, b.id, 100, { paid_on: addDays(st.today, 1) }), 'ต้องไม่เป็นวันในอนาคต');
    await expectErr(() => pay(st.u.staff, b.id, 100, { paid_on: addDays(st.today, -61) }), 'ย้อนหลังได้ไม่เกิน 60 วัน', { code: '42501' });
    eq((await pay(st.u.staff, b.id, 100, { paid_on: addDays(st.today, -60) })).payment.paid_on, addDays(st.today, -60));
    eq((await pay(st.u.mgr, b.id, 100, { paid_on: addDays(st.today, -400) })).payment.paid_on, addDays(st.today, -400));
    await expectErr(() => pay(st.u.mgr, b.id, 100, { paid_on: addDays(st.today, 1) }), 'ต้องไม่เป็นวันในอนาคต');
    eq((await pay(st.u.staff, b.id, 100)).payment.paid_on, st.today);
  });

  test('ยกเลิกรายการเงินของวันก่อน: พนักงานไม่ได้ ผู้จัดการได้ (ขอบวันตามเวลาไทย 00:00 น.)', async (ctx, st) => {
    const b = await create(st.u.staff, payload(st.d, addDays(st.today, 20)));
    const p1 = (await pay(st.u.staff, b.id, 1000)).payment;
    const p2 = (await pay(st.u.staff, b.id, 1000)).payment;
    const p3 = (await pay(st.u.staff, b.id, 1000)).payment;
    // p1 = 00:00:01 น. วันนี้ (เวลาไทย) → ยังเป็นวันนี้ / p2 = 23:59:59 น. เมื่อวาน (เวลาไทย) → วันก่อน
    await ctx.pg.query(`update public.wed_payments set created_at = (public.pos_bkk_today()::timestamp at time zone 'Asia/Bangkok') + interval '1 second' where id = $1`, [p1.id]);
    await ctx.pg.query(`update public.wed_payments set created_at = (public.pos_bkk_today()::timestamp at time zone 'Asia/Bangkok') - interval '1 second' where id = $1`, [p2.id]);
    await ctx.pg.query(`update public.wed_payments set created_at = now() - interval '3 days' where id = $1`, [p3.id]);
    eq((await st.u.staff.rpc('wed_void_payment', { p_payment_id: p1.id, p_reason: 'ผิด' })).already_voided, false);
    await expectErr(() => st.u.staff.rpc('wed_void_payment', { p_payment_id: p2.id, p_reason: 'ผิด' }), 'ยกเลิกได้เฉพาะรายการที่บันทึกวันนี้', { code: '42501' });
    await expectErr(() => st.u.staff.rpc('wed_void_payment', { p_payment_id: p3.id, p_reason: 'ผิด' }), 'ยกเลิกได้เฉพาะรายการที่บันทึกวันนี้', { code: '42501' });
    eq((await st.u.mgr.rpc('wed_void_payment', { p_payment_id: p2.id, p_reason: 'ผิด' })).already_voided, false);
    const v = await st.u.mgr.rpc('wed_void_payment', { p_payment_id: p3.id, p_reason: 'ผิด' });
    money(v.booking.money.paid, 0);
  });

  test('ค่าใช้จ่ายเพิ่ม (ล่วงเวลา): เฉพาะยืนยันแล้ว–ส่งงาน, กันซ้ำ, ยกเลิกแล้วยอดกลับ', async (ctx, st) => {
    const b = await create(st.u.staff, payload(st.d, addDays(st.today, 20)));
    const ch = (bid, amount, cid = uuid(), kind = 'overtime') => st.u.staff.rpc('wed_add_charge', {
      p_client_id: cid, p_booking_id: bid, p_kind: kind, p_description: 'ล่วงเวลา 1.5 ชม.', p_amount: amount });
    await expectErr(() => ch(b.id, 100), 'เพิ่มค่าใช้จ่ายได้ตั้งแต่ยืนยันงานจนถึงส่งงาน');
    await st.u.staff.rpc('wed_confirm', { p_booking_id: b.id, p_force: true });
    await expectErr(() => ch(b.id, 100, uuid(), 'tip'), 'ประเภทค่าใช้จ่ายไม่ถูกต้อง');
    await expectErr(() => ch(b.id, 0), 'จำนวนเงินต้องมากกว่า 0');
    const cid = uuid();
    let r = await ch(b.id, 2250.75, cid);
    eq(r.already_saved, false);
    money(r.money.charges_total, 2250.75);
    money(r.money.grand_total, 47250.75);
    money(r.money.base_total, 45000);
    money(r.money.deposit_required, 13500);             // มัดจำคิดจากยอดก่อนค่าใช้จ่ายเพิ่ม
    r = await ch(b.id, 2250.75, cid);
    eq([r.already_saved, r.charges.length], [true, 1]);
    eq([r.charges[0].kind_label, r.charges[0].description], ['ค่าล่วงเวลา', 'ล่วงเวลา 1.5 ชม.']);
    r = await st.u.staff.rpc('wed_void_charge', { p_charge_id: r.charges[0].id, p_reason: 'ไม่ได้ทำเกินเวลา' });
    money(r.money.grand_total, 45000);
    eq((await st.u.staff.rpc('wed_void_charge', { p_charge_id: r.charges[0].id, p_reason: 'ซ้ำ' })).already, true);
  });

  test('งวดชำระ: งวดมาตรฐาน, ตั้งเอง (ผลรวมต้องตรง), ยอดเปลี่ยน → งวดค้างสุดท้ายรับส่วนต่าง / ≤0 → กลับงวดมาตรฐาน, สถานะงวด', async (ctx, st) => {
    const day = addDays(st.today, 50);
    let b = await create(st.u.staff, payload(st.d, day));
    eq(b.installments.map((i) => [i.seq, i.label, i.due_date, i.amount, i.status]), [
      [1, 'มัดจำ', st.today, 13500, 'due'],
      [2, 'ยอดคงเหลือ', addDays(day, -7), 31500, 'upcoming'],
    ]);
    eq(b.installments_custom, false);
    eq(b.next_due, { seq: 1, label: 'มัดจำ', due_date: st.today, amount: 13500, overdue: false });
    // งวดมาตรฐานตามยอดเสมอ (ยังไม่ได้แก้เอง)
    b = await st.u.staff.rpc('wed_update_booking', { p_booking_id: b.id, p_updated_at: b.updated_at, p_payload: { travel_fee: 1000 } });
    eq(b.installments.map((i) => i.amount), [13800, 32200]);

    await expectErr(() => st.u.staff.rpc('wed_set_installments', { p_booking_id: b.id, p_items: [{ amount: 10000 }, { amount: 30000 }] }),
      'ยอดรวมงวดต้องเท่ากับยอดสุทธิ ฿46,000.00 (ตอนนี้รวมได้ ฿40,000.00)');
    await expectErr(() => st.u.staff.rpc('wed_set_installments', { p_booking_id: b.id, p_items: [{ amount: 0 }, { amount: 46000 }] }),
      'ยอดงวดที่ 1ต้องมากกว่า 0');
    await expectErr(() => st.u.staff.rpc('wed_set_installments', { p_booking_id: b.id, p_items: Array.from({ length: 13 }, () => ({ amount: 1 })) }),
      'ไม่เกิน 12 งวด');
    b = await st.u.staff.rpc('wed_set_installments', { p_booking_id: b.id, p_items: [
      { label: 'มัดจำจองคิว', amount: 10000, due_date: addDays(st.today, -5) },
      { amount: 15000.33, due_date: st.today },
      { label: 'งวดสุดท้าย', amount: 20999.67, due_date: addDays(day, -1) },
    ] });
    eq(b.installments_custom, true);
    eq(b.installments.map((i) => [i.label, i.status, i.overdue]), [
      ['มัดจำจองคิว', 'due', true], ['งวดที่ 2', 'due', false], ['งวดสุดท้าย', 'upcoming', false]]);
    // ชำระ 12,000 → งวด 1 ครบ งวด 2 บางส่วน
    b = (await pay(st.u.staff, b.id, 12000)).booking;
    eq(b.installments.map((i) => [i.status, i.paid_amount, i.amount_remaining]), [
      ['paid', 10000, 0], ['partial', 2000, 13000.33], ['upcoming', 0, 20999.67]]);
    eq(b.next_due, { seq: 2, label: 'งวดที่ 2', due_date: st.today, amount: 13000.33, overdue: false });
    // ยอดสุทธิเพิ่ม (ค่าใช้จ่ายเพิ่ม 1,000.01) → งวดสุดท้ายที่ยังค้างรับส่วนต่าง + จดประวัติ
    await st.u.staff.rpc('wed_confirm', { p_booking_id: b.id, p_force: true });
    const r = await st.u.staff.rpc('wed_add_charge', { p_client_id: uuid(), p_booking_id: b.id, p_kind: 'travel', p_description: 'ค่าที่พัก', p_amount: 1000.01 });
    eq(r.installments.map((i) => i.amount), [10000, 15000.33, 21999.68]);
    const ab = r.logs.find((l) => l.action === 'installments_absorb');
    ok(ab, 'ไม่มีประวัติรับส่วนต่างของงวด');
    eq([ab.detail.seq, ab.detail.old_amount, ab.detail.new_amount], [3, 20999.67, 21999.68]);
    // ส่วนลดเพิ่มจนงวดสุดท้ายเหลือ ≤ 0 → กลับไปใช้งวดมาตรฐาน
    b = await st.u.staff.rpc('wed_update_booking', { p_booking_id: b.id, p_updated_at: r.updated_at, p_payload: { discount: 22000 } });
    eq(b.installments_custom, false);
    ok(b.logs.some((l) => l.action === 'installments_rebuild'), 'ไม่มีประวัติกลับไปใช้งวดมาตรฐาน');
    money(b.money.grand_total, 25000.01);
    eq(b.installments.map((i) => [i.label, i.amount]), [['มัดจำ', 7200], ['ยอดคงเหลือ', 17800.01]]);
    eq(b.installments.reduce((s, i) => s + i.amount, 0).toFixed(2), '25000.01');
    // ตั้งเองแล้วกดกลับไปใช้งวดมาตรฐาน
    b = await st.u.staff.rpc('wed_set_installments', { p_booking_id: b.id, p_items: [{ amount: 25000.01 }] });
    eq([b.installments.length, b.installments[0].status], [1, 'partial']);
    b = await st.u.staff.rpc('wed_reset_installments', { p_booking_id: b.id });
    eq([b.installments_custom, b.installments.length], [false, 2]);
    eq(b.logs[0].action, 'installments_reset');
  });

  test('รับมัดจำพร้อมสร้างงาน + ยืนยันทันที (ไม่ครบมัดจำและไม่บังคับ = ไม่สร้างอะไรเลย)', async (ctx, st) => {
    const day = addDays(st.today, 33);
    const cid = uuid();
    await expectErr(() => st.u.staff.rpc('wed_create_booking', { p_client_id: cid, p_payload: payload(st.d, day, {
      status: 'confirmed', payments: [{ method: 'transfer', amount: 5000 }] }) }), 'ยังไม่ได้รับมัดจำครบ', { hint: 'wed_deposit' });
    eq((await ctx.pg.one(`select count(*)::int as n from public.wed_bookings where client_id = $1`, [cid])).n, 0);
    const r = await st.u.staff.rpc('wed_create_booking', { p_client_id: cid, p_payload: payload(st.d, day, {
      status: 'confirmed', payments: [{ method: 'transfer', amount: 13500, note: 'มัดจำผ่านแอป' }] }) });
    eq([r.booking.status, r.booking.money.deposit_met, r.booking.payments.length, r.booking.payments[0].purpose], ['confirmed', true, 1, 'deposit']);
    eq(r.booking.deliverables.length, 2);
    await expectErr(() => create(st.u.staff, payload(st.d, day, { payments: [{ kind: 'refund', method: 'cash', amount: 1 }] })),
      'รับเงินพร้อมการสร้างงานได้เฉพาะ "รับชำระ"');
  });

  test('ค่าตัวทีมงาน: ผู้จัดการกำหนดเองได้, คิวเดิมคนเดิมคงค่าเดิม, จ่ายแล้วห้ามแก้/ห้ามเอาออก, ต้นทุนและกำไร', async (ctx, st) => {
    const day = addDays(st.today, 40);
    const [A, B, C] = st.d.crew.map((c) => c.id);
    let b = await create(st.u.mgr, payload(st.d, day, {
      sessions: [{ date: day, crew: [{ crew_id: A, fee: 1999.99 }, { crew_id: B }] }, { date: day, session_type: 'other', status: 'cancelled', crew: [{ crew_id: C }] }],
    }));
    eq(b.sessions[0].crew.map((c) => c.fee).sort(), [1999.99, 3000.5].sort());
    money(b.money.crew_cost_total, 5000.49);              // คิวที่ยกเลิกไม่นับ
    money(b.money.profit, 45000 - 5000.49);
    // พนักงานแก้คิว (ไม่เห็นค่าตัว) → ค่าตัวเดิมคงอยู่
    const sb = await st.u.staff.rpc('wed_get_booking', { p_booking_id: b.id });
    await st.u.staff.rpc('wed_update_booking', { p_booking_id: b.id, p_updated_at: sb.updated_at, p_payload: {
      sessions: [{ id: sb.sessions[0].id, date: day, crew: [{ crew_id: A, fee: 5 }, { crew_id: B }] }, { id: sb.sessions[1].id, date: day, session_type: 'other', status: 'cancelled' }] } });
    b = await st.u.mgr.rpc('wed_get_booking', { p_booking_id: b.id });
    money(b.money.crew_cost_total, 5000.49);
    await st.u.mgr.rpc('wed_mark_crew_paid', { p_items: [{ session_id: b.sessions[0].id, crew_id: A, paid_on: st.today }] });
    b = await st.u.mgr.rpc('wed_get_booking', { p_booking_id: b.id });
    eq(b.sessions[0].crew.find((c) => c.crew_id === A).fee_paid_on, st.today);
    const keepB = { crew_id: B };
    await expectErr(() => st.u.mgr.rpc('wed_update_booking', { p_booking_id: b.id, p_updated_at: b.updated_at, p_payload: {
      sessions: [{ id: b.sessions[0].id, date: day, crew: [keepB] }, { id: b.sessions[1].id, date: day, status: 'cancelled' }] } }), 'จ่ายแล้ว');
    await expectErr(() => st.u.mgr.rpc('wed_update_booking', { p_booking_id: b.id, p_updated_at: b.updated_at, p_payload: {
      sessions: [{ id: b.sessions[0].id, date: day, crew: [{ crew_id: A, fee: 2500 }, keepB] }, { id: b.sessions[1].id, date: day, status: 'cancelled' }] } }), 'แก้ค่าตัวไม่ได้');
    await expectErr(() => st.u.mgr.rpc('wed_update_booking', { p_booking_id: b.id, p_updated_at: b.updated_at, p_payload: {
      sessions: [{ id: b.sessions[1].id, date: day, status: 'cancelled' }] } }), 'จ่ายแล้ว');
    await expectErr(() => st.u.mgr.rpc('wed_mark_crew_paid', { p_items: [{ session_id: b.sessions[0].id, crew_id: A, paid_on: addDays(st.today, 1) }] }), 'อนาคต');
    eq((await st.u.mgr.rpc('wed_mark_crew_paid', { p_items: [{ session_id: b.sessions[0].id, crew_id: A, paid_on: null }] })).updated, 1);
    eq((await st.u.mgr.rpc('wed_mark_crew_paid', { p_items: [{ session_id: b.sessions[0].id, crew_id: A, paid_on: null }] })).updated, 0);
    await expectErr(() => st.u.mgr.rpc('wed_mark_crew_paid', { p_items: [{ session_id: b.sessions[0].id, crew_id: C, paid_on: null }] }), 'ไม่พบทีมงานในคิวนี้');
  });
}
