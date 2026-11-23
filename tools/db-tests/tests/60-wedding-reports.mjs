// รายงาน (รายรับตามวันที่รับเงินจริง) + ส่งออก CSV ทีละหน้า
import { eq, ok, money, expectErr, uuid } from '../run.mjs';
import { makeUsers, seed, payload, create, pay, bkkToday, addDays } from './lib/wed.js';

export async function setup(ctx, st) {
  st.u = await makeUsers(ctx);
  st.d = await seed(ctx, st.u);
  st.today = await bkkToday(ctx);
  const T = st.today;
  // ช่วงรายงาน = 3 เดือนปฏิทินที่จบเดือนนี้
  const m0 = T.slice(0, 8) + '01';
  const prev = (d) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() - 1); return x.toISOString().slice(0, 10); };
  st.m1 = prev(m0);
  st.m2 = prev(st.m1);
  st.from = st.m2;
  st.to = T;
  const [A, B] = st.d.crew.map((c) => c.id);
  // งาน 1: ยืนยัน (วันงานในช่วง) ทีม A ค่าตัว 2,500 + B 3,000.50 ; รับเงิน 3 เดือน (ผู้จัดการบันทึกย้อนหลัง) + คืนเงิน + รายการที่ยกเลิก
  st.b1 = await create(st.u.mgr, payload(st.d, st.m1, { couple_names: 'รายงาน 1', status: 'confirmed', force: true,
    sessions: [{ date: st.m1, crew: [{ crew_id: A }, { crew_id: B }] }], addons: [{ name: 'อัลบั้ม', qty: 1, unit_price: 5000 }] }));
  await pay(st.u.mgr, st.b1.id, 10000, { paid_on: addDays(st.m2, 3), method: 'cash' });
  await pay(st.u.mgr, st.b1.id, 20000.25, { paid_on: addDays(st.m1, 4), method: 'transfer' });
  await pay(st.u.mgr, st.b1.id, 1000, { paid_on: addDays(st.m1, 5), method: 'cash', kind: 'refund' });
  const v = await pay(st.u.mgr, st.b1.id, 777, { paid_on: T, method: 'promptpay' });
  await st.u.mgr.rpc('wed_void_payment', { p_payment_id: v.payment.id, p_reason: 'โอนผิดงาน' });
  await pay(st.u.mgr, st.b1.id, 3000, { paid_on: T, method: 'promptpay' });
  await st.u.mgr.rpc('wed_add_charge', { p_client_id: uuid(), p_booking_id: st.b1.id, p_kind: 'overtime', p_description: 'ล่วงเวลา', p_amount: 1500 });
  // งาน 2: ยกเลิก (มัดจำริบ = รายรับ) / งาน 3: สอบถาม / งาน 4: ล็อกคิวในอนาคต (มูลค่างานล่วงหน้า)
  st.b2 = await create(st.u.staff, payload(st.d, addDays(st.m1, 10), { couple_names: 'รายงาน 2', status: 'hold' }));
  await pay(st.u.staff, st.b2.id, 5000);
  await st.u.staff.rpc('wed_cancel', { p_booking_id: st.b2.id, p_reason: 'ลูกค้ายกเลิก' });
  st.b3 = await create(st.u.staff, payload(st.d, addDays(st.m1, 11), { couple_names: 'รายงาน 3', package_id: null, package_name: 'กำหนดเอง', package_price: 9999,
    customer_id: undefined, customer: { name: 'ลูกค้าเฟซ', phone: '0877777777', source: 'facebook' } }));
  st.b4 = await create(st.u.staff, payload(st.d, addDays(T, 30), { couple_names: 'รายงาน 4', status: 'hold' }));
}

export function register(test) {
  test('รายรับตามวันที่รับเงินจริง: รายเดือน, ตามวิธีชำระ, ตามวัตถุประสงค์, ไม่นับรายการยกเลิก, คืนเงินหักออก', async (ctx, st) => {
    const r = await st.u.mgr.rpc('wed_report', { p_from: st.from, p_to: st.to });
    eq([r.from, r.to], [st.from, st.to]);
    const bm = Object.fromEntries(r.income.by_month.map((x) => [x.month, x]));
    eq(r.income.by_month.map((x) => x.month), [st.m2.slice(0, 7), st.m1.slice(0, 7), st.to.slice(0, 7)]);
    eq([bm[st.m2.slice(0, 7)].payment, bm[st.m2.slice(0, 7)].refund, bm[st.m2.slice(0, 7)].net], [10000, 0, 10000]);
    eq([bm[st.m1.slice(0, 7)].payment, bm[st.m1.slice(0, 7)].refund, bm[st.m1.slice(0, 7)].net], [20000.25, 1000, 19000.25]);
    eq([bm[st.to.slice(0, 7)].payment, bm[st.to.slice(0, 7)].net], [8000, 8000]);   // 3,000 + มัดจำงานที่ยกเลิก 5,000 (ไม่นับ 777 ที่ยกเลิก)
    money(r.income.total_payment, 38000.25);
    money(r.income.total_refund, 1000);
    money(r.income.total_net, 37000.25);
    eq(r.income.by_method, { cash: 9000, transfer: 25000.25, promptpay: 3000, credit: 0 });
    money(r.income.by_purpose.deposit, 35000.25);   // ยังไม่ครบมัดจำก่อนรับ = นับเป็นมัดจำทั้งรายการ (10,000 + 20,000.25 + 5,000)
    // งานที่วันงานแรกอยู่ในช่วง
    eq(r.bookings.total, 3);
    eq([r.bookings.by_status.confirmed, r.bookings.by_status.cancelled, r.bookings.by_status.inquiry, r.bookings.by_status.hold], [1, 1, 1, 0]);
    eq([r.bookings.by_source.instagram, r.bookings.by_source.facebook], [2, 1]);
    eq(r.bookings.by_package, [{ package_name: 'แพ็กเกจเต็มวัน', count: 1, value: 51500 }]);
    money(r.bookings.value_total, 51500);
    // ต้นทุนทีม + กำไร
    money(r.crew.cost_total, 5500.5);
    eq(r.crew.by_crew.map((c) => [c.name, c.sessions, c.fees, c.paid, c.unpaid]), [['วิไล วิดีโอ', 1, 3000.5, 0, 3000.5], ['สมชาย ช่างภาพ', 1, 2500, 0, 2500]]);
    money(r.profit_total, 50000 + 1500 - 5500.5);
    money(r.upcoming_value, 45000);
    money(r.outstanding_due_total, (51500 - 32000.25) + 45000);
    money(r.overpaid_total, 0);
    await expectErr(() => st.u.mgr.rpc('wed_report', { p_from: st.from, p_to: addDays(st.from, 366) }), 'ช่วงวันที่ยาวเกินไป');
    await expectErr(() => st.u.mgr.rpc('wed_report', { p_from: st.to, p_to: st.from }), 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น');
  });

  test('ส่งออก CSV: แบ่งหน้าตาม p_offset/p_limit ไม่ซ้ำไม่หาย เรียงคงที่ / รายการเงินรวมที่ยกเลิก (ผลต่อรายรับ 0) / ค่าตัวทีม', async (ctx, st) => {
    for (let i = 0; i < 4; i += 1) {
      await create(st.u.staff, payload(st.d, addDays(st.m1, 15 + i), { couple_names: `หน้า ${i}` }));
    }
    const full = await st.u.mgr.rpcRows('wed_export_bookings', { p_from: st.from, p_to: st.to });
    eq(full.length, 7);
    const pages = [];
    for (let off = 0; off < 10; off += 3) {
      pages.push(...(await st.u.mgr.rpcRows('wed_export_bookings', { p_from: st.from, p_to: st.to, p_offset: off, p_limit: 3 })));
    }
    eq(pages.map((x) => x.booking_no), full.map((x) => x.booking_no));
    eq(new Set(full.map((x) => x.booking_no)).size, 7);
    const iso = (v) => (v instanceof Date ? v.toISOString() : String(v));
    const dates = full.map((x) => iso(x.first_session_date));
    eq(dates, [...dates].sort());
    const r1 = full.find((x) => x.couple_names === 'รายงาน 1');
    eq([r1.status_label, r1.source_label, r1.customer_phone, r1.sessions_count, r1.package_name, r1.addons], ['ยืนยันแล้ว', 'Instagram', '0812345678', 1, 'แพ็กเกจเต็มวัน', 'อัลบั้ม x1']);
    money(r1.crew_cost_total, 5500.5);
    money(r1.profit, 51500 - 5500.5);
    ok(r1.sessions.includes('งานเลี้ยง'), 'คอลัมน์คิวงานไม่มีประเภทคิว');
    await expectErr(() => st.u.mgr.rpcRows('wed_export_bookings', { p_from: st.from, p_to: st.to, p_offset: 0, p_limit: 10001 }), 'ช่วงแถวที่ขอไม่ถูกต้อง');
    await expectErr(() => st.u.mgr.rpcRows('wed_export_bookings', { p_from: st.from, p_to: st.to, p_offset: -1, p_limit: 10 }), 'ช่วงแถวที่ขอไม่ถูกต้อง');
    eq((await st.u.mgr.rpcRows('wed_export_bookings', { p_from: st.from, p_to: st.to, p_offset: 0, p_limit: 1000 })).length, 7);

    const pays = await st.u.mgr.rpcRows('wed_export_payments', { p_from: st.from, p_to: st.to });
    eq(pays.length, 6);
    const voided = pays.find((x) => x.status === 'voided');
    eq([Number(voided.amount), Number(voided.income_effect), voided.status_label, voided.void_reason], [777, 0, 'ยกเลิกแล้ว', 'โอนผิดงาน']);
    const refund = pays.find((x) => x.kind === 'refund');
    eq([Number(refund.income_effect), refund.kind_label, refund.method_label], [-1000, 'คืนเงิน', 'เงินสด']);
    money(pays.reduce((s, x) => s + Number(x.income_effect), 0), 37000.25);
    const pdays = pays.map((x) => iso(x.paid_on));
    eq(pdays, [...pdays].sort());
    const p2 = [];
    for (let off = 0; off < 6; off += 4) {
      p2.push(...(await st.u.mgr.rpcRows('wed_export_payments', { p_from: st.from, p_to: st.to, p_offset: off, p_limit: 4 })));
    }
    eq(p2.map((x) => x.receipt_no), pays.map((x) => x.receipt_no));

    const fees = await st.u.mgr.rpcRows('wed_export_crew_fees', { p_from: st.from, p_to: st.to });
    eq(fees.map((x) => [x.crew_name, Number(x.fee), x.paid, x.role_label]), [['วิไล วิดีโอ', 3000.5, false, 'วิดีโอ'], ['สมชาย ช่างภาพ', 2500, false, 'ช่างภาพ']]);
    eq((await st.u.mgr.rpcRows('wed_export_crew_fees', { p_from: st.from, p_to: st.to, p_offset: 1, p_limit: 1 })).map((x) => x.crew_name), ['สมชาย ช่างภาพ']);
    // จ่ายค่าตัวแล้ว → ช่อง paid + รายงานเห็นยอดจ่าย
    await st.u.mgr.rpc('wed_mark_crew_paid', { p_items: [{ session_id: st.b1.sessions[0].id, crew_id: st.d.crew[0].id, paid_on: st.today }] });
    const r = await st.u.mgr.rpc('wed_report', { p_from: st.from, p_to: st.to });
    money(r.crew.paid_total, 2500);
    const pay2 = await st.u.mgr.rpc('wed_crew_payouts', { p_from: st.from, p_to: st.to });
    eq([pay2.totals.fees, pay2.totals.paid, pay2.totals.unpaid, pay2.totals.sessions], [5500.5, 2500, 3000.5, 2]);
    eq(pay2.crew.find((c) => c.name === 'สมชาย ช่างภาพ').items[0].fee_paid_on, st.today);
    const sch = await st.u.mgr.rpc('wed_crew_schedule', { p_crew_id: st.d.crew[0].id, p_from: st.from, p_to: st.to });
    eq([sch.totals.sessions, sch.totals.fees, sch.totals.paid, sch.sessions[0].booking_no], [1, 2500, 2500, st.b1.booking_no]);
  });
}
