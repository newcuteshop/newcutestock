// มัดจำกำหนดเองต่องาน (deposit_override): ราคาล่วงหน้า, สร้าง/แก้งาน (ตั้ง → ล้าง → ไม่ส่งคีย์ = คงเดิม), ไม่เกินยอดสุทธิ,
//   มัดจำ 0, ได้รับมัดจำครบ/ยืนยันงาน, งวดมาตรฐาน/งวดที่แก้เอง, สิทธิ์เหมือนส่วนลด, ตรวจค่าที่ส่งมา, ประวัติ,
//   ภาพรวมวันนี้/ตัวเลขบนเมนู/รายละเอียดวัน/ส่งออก CSV/ลิงก์ลูกค้า ใช้ยอดเดียวกัน,
//   ค่าใช้จ่ายเพิ่มทีหลังไม่ดันมัดจำกำหนดเองขึ้น (เพดาน = ยอดหลังส่วนลด), รัน fix-07 ซ้ำค่าไม่หาย
import { createDb, loadSqlFile, eq, ok, money, expectErr, uuid } from '../run.mjs';
import { makeUsers, seed, payload, create, pay, bkkToday, addDays } from './lib/wed.js';

// ทดสอบกฎของ fix-07 ด้วยค่าตั้งต้นเดิม (ชำระยอดคงเหลือก่อนวันงาน 7 วัน / เงื่อนไขตั้งต้นหลายข้อ) — ข้อมูลร้านที่ fix-09 ตั้งให้บอส
//   (ชำระวันงาน + เงื่อนไข 3 ข้อ) ทดสอบใน 33-wedding-pay-on-event-day.mjs
export const dbOptions = { upTo: 'supabase-fix-08-lock-order.sql' };

export async function setup(ctx, st) {
  st.u = await makeUsers(ctx);
  st.d = await seed(ctx, st.u);
  st.today = await bkkToday(ctx);
  // ไม่จำกัดคิวต่อวัน — ไฟล์นี้ทดสอบเรื่องเงิน ไม่ใช่คิวเต็ม
  await st.u.mgr.rpc('wed_save_settings', { p_settings: { max_jobs_per_day: 0 } });
}

const upd = (user, b, p) => user.rpc('wed_update_booking', { p_booking_id: b.id, p_updated_at: b.updated_at, p_payload: p });
const plan = (b) => b.installments.map((i) => [i.label, i.amount]);
const src = (m) => [m.deposit_required, m.deposit_override, m.deposit_source];

export function register(test) {
  test('ราคาล่วงหน้า (wed_quote): ไม่กำหนด = อัตโนมัติ / กำหนดเอง / ช่องว่างหรือ null = อัตโนมัติ / 0 / เกินยอดสุทธิ = ยอดสุทธิ / แก้งานเดิมไม่ส่งคีย์ = ค่าที่บันทึกไว้', async (ctx, st) => {
    const day = addDays(st.today, 30);
    const q = async (over) => (await st.u.staff.rpc('wed_quote', { p_payload: payload(st.d, day, over) })).money;
    let m = await q({});
    ok('deposit_override' in m && 'deposit_source' in m, 'ราคาล่วงหน้าไม่มีคีย์ deposit_override / deposit_source');
    eq([...src(m), m.deposit_percent], [13500, null, 'auto', 30]);
    // ตัวอย่างจากหน้าจอของบอส: ยอดงาน 6,900 → อัตโนมัติ 30% = 2,070
    eq(src(await q({ package_price: 6900 })), [2070, null, 'auto']);
    m = await q({ deposit_override: 5000 });
    eq([...src(m), m.deposit_percent], [5000, 5000, 'manual', 30]);
    eq(src(await q({ deposit_override: '7,500.50' })), [7500.5, 7500.5, 'manual']);
    eq(src(await q({ deposit_override: '' })), [13500, null, 'auto']);
    eq(src(await q({ deposit_override: null })), [13500, null, 'auto']);
    eq(src(await q({ deposit_override: 0 })), [0, 0, 'manual']);
    m = await q({ deposit_override: 99999 });
    eq([m.grand_total, ...src(m)], [45000, 45000, 99999, 'manual']);
    m = await q({ deposit_override: 20000, discount: 30000 });
    eq([m.grand_total, ...src(m)], [15000, 15000, 20000, 'manual']);

    const b = await create(st.u.staff, payload(st.d, day, { deposit_override: 6000 }));
    m = (await st.u.staff.rpc('wed_quote', { p_payload: { booking_id: b.id, travel_fee: 1000 } })).money;
    eq(src(m), [6000, 6000, 'manual']);
    m = (await st.u.staff.rpc('wed_quote', { p_payload: { booking_id: b.id, travel_fee: 1000, deposit_override: null } })).money;
    eq(src(m), [13800, null, 'auto']);                          // ceil(46,000 × 30%)
    m = (await st.u.staff.rpc('wed_quote', { p_payload: { booking_id: b.id, deposit_override: 2500.25 } })).money;
    eq(src(m), [2500.25, 2500.25, 'manual']);
    // ราคาล่วงหน้าไม่บันทึกอะไร
    const again = await st.u.staff.rpc('wed_get_booking', { p_booking_id: b.id });
    eq([again.updated_at, ...src(again.money)], [b.updated_at, 6000, 6000, 'manual']);
  });

  test('สร้างงานพร้อมมัดจำกำหนดเอง: ยอด/งวดมาตรฐาน/งวดถัดไป/คำเตือนยืนยัน, รับเงินครบมัดจำที่กำหนด → ยืนยันได้โดยไม่บังคับ, วัตถุประสงค์รับเงินอัตโนมัติ', async (ctx, st) => {
    const day = addDays(st.today, 40);
    const b = await create(st.u.staff, payload(st.d, day, { deposit_override: 5000 }));
    const m = b.money;
    eq([...src(m), m.deposit_percent, m.min_deposit, m.deposit_met, m.deposit_due], [5000, 5000, 'manual', 30, 0, false, 5000]);
    eq(b.installments.map((i) => [i.seq, i.label, i.due_date, i.amount]), [
      [1, 'มัดจำ', st.today, 5000],
      [2, 'ยอดคงเหลือ', addDays(day, -7), 40000],
    ]);
    eq(b.next_due, { seq: 1, label: 'มัดจำ', due_date: st.today, amount: 5000, overdue: false });
    eq(await ctx.pg.one(`select deposit_override::text as o, deposit_required::text as r from public.wed_bookings where id = $1`, [b.id]),
      { o: '5000.00', r: '5000.00' });
    eq(b.actions.block_reasons.confirm_warning, 'ยังไม่ได้รับมัดจำครบ (ขาด ฿5,000.00) — ยืนยันได้ด้วยการกดยืนยันแบบบังคับ');
    eq(b.logs.find((l) => l.action === 'create').detail.deposit_override, 5000);
    const got = await st.u.staff.rpc('wed_get_booking', { p_booking_id: b.id });
    eq([...src(got.money), plan(got)], [5000, 5000, 'manual', [['มัดจำ', 5000], ['ยอดคงเหลือ', 40000]]]);

    await expectErr(() => st.u.staff.rpc('wed_confirm', { p_booking_id: b.id }), 'ได้รับ ฿0.00 จากมัดจำ ฿5,000.00', { hint: 'wed_deposit' });
    let p = await pay(st.u.staff, b.id, 3000);
    eq([p.payment.purpose, p.booking.money.deposit_met, p.booking.money.deposit_due], ['deposit', false, 2000]);
    eq(p.booking.actions.block_reasons.confirm_warning, 'ยังไม่ได้รับมัดจำครบ (ขาด ฿2,000.00) — ยืนยันได้ด้วยการกดยืนยันแบบบังคับ');
    p = await pay(st.u.staff, b.id, 2000);
    eq([p.payment.purpose, p.booking.money.deposit_met, p.booking.money.deposit_due], ['deposit', true, 0]);
    eq(p.booking.actions.block_reasons.confirm_warning, null);
    eq(p.booking.installments.map((i) => i.status), ['paid', 'upcoming']);
    eq([p.booking.next_due.label, p.booking.next_due.amount], ['ยอดคงเหลือ', 40000]);
    p = await pay(st.u.staff, b.id, 1000);
    eq(p.payment.purpose, 'installment');                      // ครบมัดจำที่กำหนดแล้ว (อัตโนมัติ 13,500 ยังไม่ครบ)
    const c = await st.u.staff.rpc('wed_confirm', { p_booking_id: b.id });
    eq([c.status, c.money.deposit_met], ['confirmed', true]);
    eq(c.logs.find((l) => l.action === 'confirm').detail.forced, false);
  });

  test('มัดจำ 0 บาท: ไม่ต้องมัดจำ (ได้รับมัดจำครบทันที), งวดเดียว "ยอดชำระทั้งหมด", ยืนยัน/สร้างแบบยืนยันทันทีได้โดยไม่รับเงินและไม่บังคับ', async (ctx, st) => {
    const day = addDays(st.today, 41);
    const b = await create(st.u.staff, payload(st.d, day, { deposit_override: 0 }));
    eq([...src(b.money), b.money.deposit_met, b.money.deposit_due], [0, 0, 'manual', true, 0]);
    eq(b.installments.map((i) => [i.label, i.due_date, i.amount]), [['ยอดชำระทั้งหมด', addDays(day, -7), 45000]]);
    eq(b.actions.block_reasons.confirm_warning, null);
    eq(b.logs.find((l) => l.action === 'create').detail.deposit_override, 0);
    const c = await st.u.staff.rpc('wed_confirm', { p_booking_id: b.id });
    eq([c.status, c.money.paid, c.deliverables.length], ['confirmed', 0, 2]);
    eq((await pay(st.u.staff, b.id, 1000)).payment.purpose, 'installment');
    const r = await create(st.u.staff, payload(st.d, addDays(st.today, 42), { status: 'confirmed', deposit_override: 0 }));
    eq([r.status, r.money.paid, r.money.deposit_met], ['confirmed', 0, true]);
  });

  test('แก้งาน: ตั้งค่า → ไม่ส่งคีย์ = คงเดิม → แก้ค่า → null = กลับอัตโนมัติ → ช่องว่างตอนอัตโนมัติ = ไม่เปลี่ยน (ประวัติจด [เดิม, ใหม่] เฉพาะตอนเปลี่ยน)', async (ctx, st) => {
    const day = addDays(st.today, 43);
    let b = await create(st.u.staff, payload(st.d, day));
    eq(src(b.money), [13500, null, 'auto']);
    ok(!('deposit_override' in b.logs.find((l) => l.action === 'create').detail), 'สร้างงานแบบอัตโนมัติไม่ควรจดมัดจำกำหนดเอง');

    b = await upd(st.u.staff, b, { deposit_override: 8000 });
    eq([...src(b.money), plan(b)], [8000, 8000, 'manual', [['มัดจำ', 8000], ['ยอดคงเหลือ', 37000]]]);
    eq([b.logs[0].action, b.logs[0].detail], ['update', { deposit_override: [null, 8000] }]);

    b = await upd(st.u.staff, b, { travel_fee: 500 });          // ไม่ส่งคีย์ = คงค่าเดิม
    eq([...src(b.money), plan(b)], [8000, 8000, 'manual', [['มัดจำ', 8000], ['ยอดคงเหลือ', 37500]]]);
    eq(b.logs[0].detail, { travel_fee: [0, 500] });

    b = await upd(st.u.staff, b, { deposit_override: '9000.5' });
    eq([...src(b.money), b.logs[0].detail], [9000.5, 9000.5, 'manual', { deposit_override: [8000, 9000.5] }]);

    b = await upd(st.u.staff, b, { deposit_override: null });   // กลับไปคิดอัตโนมัติ
    eq([...src(b.money), plan(b)], [13650, null, 'auto', [['มัดจำ', 13650], ['ยอดคงเหลือ', 31850]]]);   // ceil(45,500 × 30%)
    eq(b.logs[0].detail, { deposit_override: [9000.5, null] });

    b = await upd(st.u.staff, b, { deposit_override: '' });     // ช่องว่าง = อัตโนมัติ (เป็นอยู่แล้ว)
    eq([...src(b.money), b.logs[0].detail], [13650, null, 'auto', {}]);
    eq((await ctx.pg.one(`select deposit_override from public.wed_bookings where id = $1`, [b.id])).deposit_override, null);

    b = await upd(st.u.staff, b, { deposit_override: 0 });
    eq([...src(b.money), b.money.deposit_met, b.logs[0].detail], [0, 0, 'manual', true, { deposit_override: [null, 0] }]);
    b = await upd(st.u.staff, b, { deposit_override: 0 });      // ค่าเดิม = ไม่จดซ้ำ
    eq(b.logs[0].detail, {});
  });

  test('ไม่เกินยอดสุทธิ: กำหนดเกินยอด → ยอดสุทธิ / ส่วนลดทีหลังทำให้ยอดต่ำกว่า → ใช้ยอดสุทธิเอง ค่าที่กำหนดยังอยู่ / ยอดกลับขึ้น → กลับไปใช้ค่าที่กำหนด', async (ctx, st) => {
    const day = addDays(st.today, 44);
    let b = await create(st.u.staff, payload(st.d, day, { deposit_override: 50000 }));
    eq([b.money.grand_total, ...src(b.money), plan(b)], [45000, 45000, 50000, 'manual', [['ชำระเต็มจำนวน', 45000]]]);

    b = await create(st.u.staff, payload(st.d, day, { deposit_override: 20000 }));
    eq(plan(b), [['มัดจำ', 20000], ['ยอดคงเหลือ', 25000]]);
    b = await upd(st.u.staff, b, { discount: 30000, discount_note: 'ลดพิเศษ' });
    eq([b.money.grand_total, ...src(b.money), plan(b)], [15000, 15000, 20000, 'manual', [['ชำระเต็มจำนวน', 15000]]]);
    ok(!('deposit_override' in b.logs[0].detail), 'ค่าที่กำหนดไม่ได้เปลี่ยน ไม่ควรจดประวัติมัดจำ');
    const p = await pay(st.u.staff, b.id, 15000);
    eq([p.booking.money.deposit_met, p.booking.money.due], [true, 0]);
    b = await upd(st.u.staff, p.booking, { discount: 0 });
    eq([b.money.grand_total, ...src(b.money), b.money.deposit_met, b.money.deposit_due], [45000, 20000, 20000, 'manual', false, 5000]);
    eq(b.installments.map((i) => [i.label, i.amount, i.status]), [['มัดจำ', 20000, 'partial'], ['ยอดคงเหลือ', 25000, 'upcoming']]);
    eq(b.installments.reduce((s, i) => s + i.amount, 0).toFixed(2), '45000.00');
  });

  test('งวดชำระ: งวดมาตรฐานใช้มัดจำที่กำหนด (รวมเท่ายอดสุทธิพอดี) / งวดที่แก้เองไม่ถูกแตะ / กลับงวดมาตรฐาน = ใช้มัดจำที่กำหนด', async (ctx, st) => {
    const day = addDays(st.today, 46);
    let b = await create(st.u.staff, payload(st.d, day, { deposit_override: 6000.55, travel_fee: 0.01 }));
    eq(plan(b), [['มัดจำ', 6000.55], ['ยอดคงเหลือ', 38999.46]]);
    eq(b.installments.reduce((s, i) => s + i.amount, 0).toFixed(2), '45000.01');
    b = await st.u.staff.rpc('wed_set_installments', { p_booking_id: b.id, p_items: [{ label: 'งวดแรก', amount: 10000 }, { label: 'งวดสอง', amount: 35000.01 }] });
    eq(b.installments_custom, true);
    b = await upd(st.u.staff, b, { deposit_override: 7000 });
    eq([b.money.deposit_required, b.installments_custom, plan(b)], [7000, true, [['งวดแรก', 10000], ['งวดสอง', 35000.01]]]);
    b = await upd(st.u.staff, b, { deposit_override: null });
    eq([b.money.deposit_required, b.installments_custom, plan(b)], [13501, true, [['งวดแรก', 10000], ['งวดสอง', 35000.01]]]);
    b = await upd(st.u.staff, b, { deposit_override: 7000 });
    b = await st.u.staff.rpc('wed_reset_installments', { p_booking_id: b.id });
    eq([b.installments_custom, plan(b)], [false, [['มัดจำ', 7000], ['ยอดคงเหลือ', 38000.01]]]);
  });

  test('สิทธิ์: เหมือนส่วนลด/ค่าเดินทาง — พนักงาน/ผู้จัดการ/แอดมินกำหนดได้ / ไม่มีสิทธิ์ b.oncloud ไม่ได้ทั้งคู่ (ข้อความ/รหัสเดียวกัน) / anon เรียกไม่ได้', async (ctx, st) => {
    const day = addDays(st.today, 47);
    let b = await create(st.u.staff, payload(st.d, day, { discount: 1000, travel_fee: 500, deposit_override: 4000 }));
    eq([b.money.discount, b.money.travel_fee, b.money.deposit_override], [1000, 500, 4000]);
    b = await upd(st.u.staff, b, { discount: 2000, deposit_override: 4500 });
    eq([b.money.discount, b.money.deposit_override, b.money.deposit_required], [2000, 4500, 4500]);
    b = await upd(st.u.mgr, b, { discount: 1500, deposit_override: 3000 });
    eq([b.money.discount, b.money.deposit_override], [1500, 3000]);
    b = await upd(st.u.admin, b, { discount: 0, deposit_override: null });
    eq([b.money.discount, ...src(b.money)], [0, 13650, null, 'auto']);
    const m = await create(st.u.mgr, payload(st.d, day, { discount: 100, deposit_override: 1234.56 }));
    eq([m.money.discount, m.money.deposit_override], [100, 1234.56]);

    for (const u of [st.u.none, st.u.newcute, st.u.rental]) {
      for (const p of [{ discount: 0 }, { deposit_override: 0 }]) {
        await expectErr(() => upd(u, b, p), 'ไม่มีสิทธิ์ใช้งานระบบ b.oncloud', { code: '42501' });
        await expectErr(() => u.rpc('wed_quote', { p_payload: payload(st.d, day, p) }), 'ไม่มีสิทธิ์ใช้งานระบบ b.oncloud', { code: '42501' });
        await expectErr(() => create(u, payload(st.d, day, p)), 'ไม่มีสิทธิ์ใช้งานระบบ b.oncloud', { code: '42501' });
      }
    }
    await expectErr(() => upd(ctx.anon, b, { deposit_override: 0 }), 'permission denied', { code: '42501' });
    const still = await st.u.staff.rpc('wed_get_booking', { p_booking_id: b.id });
    eq([still.updated_at, ...src(still.money)], [b.updated_at, 13650, null, 'auto']);
  });

  test('ตรวจค่าที่ส่งมา (ข้อความไทยแบบเดียวกับช่องเงินอื่น): ติดลบ / ไม่ใช่ตัวเลข / ทศนิยมเกิน 2 ตำแหน่ง / สูงเกิน — ราคาล่วงหน้า สร้าง แก้ ไม่บันทึกอะไรเลย', async (ctx, st) => {
    const day = addDays(st.today, 48);
    const b = await create(st.u.staff, payload(st.d, day, { deposit_override: 5000 }));
    const before = (await ctx.pg.one(`select count(*)::int as n from public.wed_bookings`)).n;
    const bad = [
      [-1, 'มัดจำต้องไม่ติดลบ'],
      ['-0.01', 'มัดจำต้องไม่ติดลบ'],
      ['abc', 'มัดจำต้องเป็นตัวเลข'],
      ['1O0', 'มัดจำต้องเป็นตัวเลข'],
      [true, 'มัดจำต้องเป็นตัวเลข'],
      [{ amount: 1 }, 'มัดจำต้องเป็นตัวเลข'],
      [100.555, 'มัดจำใส่ทศนิยมได้ไม่เกิน 2 ตำแหน่ง'],
      ['1,000.001', 'มัดจำใส่ทศนิยมได้ไม่เกิน 2 ตำแหน่ง'],
      [100000000, 'มัดจำสูงเกินไป (สูงสุด 99,999,999.99)'],
    ];
    for (const [v, msg] of bad) {
      await expectErr(() => st.u.staff.rpc('wed_quote', { p_payload: payload(st.d, day, { deposit_override: v }) }), msg);
      await expectErr(() => create(st.u.staff, payload(st.d, day, { deposit_override: v })), msg);
      await expectErr(() => upd(st.u.staff, b, { deposit_override: v, travel_fee: 999 }), msg);
    }
    eq((await ctx.pg.one(`select count(*)::int as n from public.wed_bookings`)).n, before);
    const after = await st.u.staff.rpc('wed_get_booking', { p_booking_id: b.id });
    eq([after.updated_at, after.travel_fee, ...src(after.money)], [b.updated_at, 0, 5000, 5000, 'manual']);
    // สูงสุดที่ใส่ได้ = 99,999,999.99 (เกินยอดสุทธิ → ใช้ยอดสุทธิ)
    eq(src((await st.u.staff.rpc('wed_quote', { p_payload: payload(st.d, day, { deposit_override: '99,999,999.99' }) })).money),
      [45000, 99999999.99, 'manual']);
    // กันเขียนตรงที่ตาราง (ข้ามฟังก์ชัน) ด้วย check constraint
    await expectErr(() => ctx.pg.query(`update public.wed_bookings set deposit_override = -1 where id = $1`, [b.id]),
      'wed_bookings_deposit_override_check');
  });

  test('ทุกที่ที่แสดงมัดจำใช้ยอดเดียวกัน: ภาพรวมวันนี้ (งวดที่ต้องเก็บ) / ตัวเลขงวดเลยกำหนดบนเมนู / รายละเอียดวัน / ส่งออก CSV / ลิงก์ลูกค้า', async (ctx, st) => {
    const day = addDays(st.today, 50);
    // ตัวอย่างจากหน้าจอของบอส: ยอดงาน 6,900 อัตโนมัติ 30% = 2,070 / 4,830 → กำหนดมัดจำเอง 3,000
    let b = await create(st.u.staff, payload(st.d, day, { package_price: 6900 }));
    eq([...src(b.money), plan(b)], [2070, null, 'auto', [['มัดจำ', 2070], ['ยอดคงเหลือ', 4830]]]);
    b = await upd(st.u.staff, b, { deposit_override: 3000 });
    eq([...src(b.money), plan(b)], [3000, 3000, 'manual', [['มัดจำ', 3000], ['ยอดคงเหลือ', 3900]]]);
    b = await st.u.staff.rpc('wed_confirm', { p_booking_id: b.id, p_force: true });
    // งวดมัดจำครบกำหนดเมื่อวาน (เลยกำหนด)
    await ctx.pg.query(`update public.wed_bookings set created_at = created_at - interval '3 days',
                               deposit_due_on = public.pos_bkk_today() - 1 where id = $1`, [b.id]);
    b = await st.u.staff.rpc('wed_get_booking', { p_booking_id: b.id });
    b = await upd(st.u.staff, b, {});                           // คำนวณใหม่ → งวดมาตรฐานใช้วันครบกำหนดใหม่
    eq(b.installments[0].due_date, addDays(st.today, -1));
    const badges0 = (await st.u.staff.rpc('wed_badges')).installments_overdue;

    const p = await pay(st.u.staff, b.id, 2500);                // เกินมัดจำอัตโนมัติ (2,070) แต่ไม่ถึงมัดจำที่กำหนด (3,000)
    eq([p.payment.purpose, p.booking.money.deposit_met, p.booking.money.deposit_due], ['deposit', false, 500]);
    eq(p.booking.installments.map((i) => [i.label, i.amount, i.amount_remaining, i.status, i.overdue]),
      [['มัดจำ', 3000, 500, 'partial', true], ['ยอดคงเหลือ', 3900, 3900, 'upcoming', false]]);
    eq(p.booking.next_due, { seq: 1, label: 'มัดจำ', due_date: addDays(st.today, -1), amount: 500, overdue: true });
    eq((await st.u.staff.rpc('wed_badges')).installments_overdue, badges0, 'งวดมัดจำยังค้าง ต้องยังนับเป็นงวดเลยกำหนด');

    const t = await st.u.staff.rpc('wed_today');               // งวดยอดคงเหลือครบกำหนดอีก 43 วัน → ยังไม่ขึ้นรายการ 7 วัน
    eq(t.installments_due.filter((x) => x.booking_id === b.id).map((x) => [x.label, x.amount, x.amount_remaining, x.overdue]),
      [['มัดจำ', 3000, 500, true]]);

    const dd = await st.u.staff.rpc('wed_day', { p_day: day });
    const s = dd.sessions.find((x) => x.booking_id === b.id);
    eq([s.money.deposit_required, s.money.deposit_met, s.money.next_due.amount], [3000, false, 500]);

    const rows = await st.u.mgr.rpcRows('wed_export_bookings', { p_from: day, p_to: day });
    const row = rows.find((r) => r.booking_no === b.booking_no);
    money(row.deposit_required, 3000);
    money(row.paid, 2500);
    const prow = (await st.u.mgr.rpcRows('wed_export_payments', { p_from: st.today, p_to: st.today }))
      .find((r) => r.receipt_no === p.payment.receipt_no);
    eq([prow.purpose, prow.purpose_label], ['deposit', 'มัดจำ']);

    const pub = await ctx.anon.rpc('wed_public_booking', { p_token: b.public_token });
    eq([pub.money.deposit_required, pub.money.deposit_due, pub.money.deposit_met], [3000, 500, false]);
    eq(pub.installments.map((i) => [i.label, i.amount, i.amount_remaining]), [['มัดจำ', 3000, 500], ['ยอดคงเหลือ', 3900, 3900]]);
    eq([pub.next_due.label, pub.next_due.amount], ['มัดจำ', 500]);

    const done = await pay(st.u.staff, b.id, 500);
    eq([done.payment.purpose, done.booking.money.deposit_met, done.booking.installments[0].status], ['deposit', true, 'paid']);
    eq((await st.u.staff.rpc('wed_badges')).installments_overdue, badges0 - 1);
    eq((await ctx.anon.rpc('wed_public_booking', { p_token: b.public_token })).money.deposit_met, true);
  });

  test('ค่าใช้จ่ายเพิ่มทีหลังไม่ดันมัดจำกำหนดเองขึ้น (เพดาน = ยอดหลังส่วนลด ฐานเดียวกับ % อัตโนมัติ): กำหนดเกินยอด/เท่ายอด/อัตโนมัติ จ่ายครบแล้วเพิ่มค่าล่วงเวลา → มัดจำยังครบ ส่วนเพิ่มอยู่ในยอดคงเหลือ ไม่เลยกำหนด', async (ctx, st) => {
    const day = addDays(st.today, 52);
    const seen = [];
    for (const ovr of [50000, 45000, null]) {
      const over = { status: 'confirmed', force: true };
      if (ovr !== null) over.deposit_override = ovr;
      let b = await create(st.u.staff, payload(st.d, day, over));
      await pay(st.u.staff, b.id, 45000);
      // วันครบกำหนดมัดจำผ่านไป 10 วันแล้ว (งวดมัดจำที่ยังค้างจะขึ้น "เลยกำหนด")
      await ctx.pg.query(`update public.wed_bookings set created_at = created_at - interval '10 days',
                                 deposit_due_on = public.pos_bkk_today() - 10 where id = $1`, [b.id]);
      const badge0 = (await st.u.staff.rpc('wed_badges')).installments_overdue;
      const r = await st.u.staff.rpc('wed_add_charge', {
        p_client_id: uuid(), p_booking_id: b.id, p_kind: 'overtime', p_description: 'ล่วงเวลา 2 ชม.', p_amount: 3000 });
      eq([r.money.base_total, r.money.grand_total, r.money.deposit_met], [45000, 48000, true]);
      b = await st.u.staff.rpc('wed_get_booking', { p_booking_id: b.id });
      const pub = await ctx.anon.rpc('wed_public_booking', { p_token: b.public_token });
      seen.push([ovr, b.money.deposit_required, b.money.deposit_met, b.money.deposit_due,
        b.installments.map((i) => [i.label, i.amount, i.status, i.overdue]), b.next_due,
        [pub.money.deposit_required, pub.money.deposit_met, pub.money.deposit_due],
        (await st.u.staff.rpc('wed_badges')).installments_overdue - badge0]);
      if (ovr === 50000) {
        // ราคาล่วงหน้าตอนแก้งานที่มีค่าใช้จ่ายเพิ่มแล้ว: เพดานเดียวกัน (ยอดหลังส่วนลด ไม่รวมค่าใช้จ่ายเพิ่ม)
        const q = async (p) => (await st.u.staff.rpc('wed_quote', { p_payload: { booking_id: b.id, ...p } })).money;
        let m = await q({});
        eq([m.grand_total, ...src(m)], [48000, 45000, 50000, 'manual']);
        m = await q({ deposit_override: 46000 });
        eq([m.grand_total, ...src(m)], [48000, 45000, 46000, 'manual']);
        m = await q({ deposit_override: 5000 });
        eq(src(m), [5000, 5000, 'manual']);
        // ยกเลิกค่าใช้จ่ายเพิ่ม → ยอดเดิม มัดจำเดิม
        const v = await st.u.mgr.rpc('wed_void_charge', { p_charge_id: r.charges[0].id, p_reason: 'ใส่ผิด' });
        eq([v.money.grand_total, v.money.deposit_required, v.money.deposit_met], [45000, 45000, true]);
      }
    }
    const rest = { seq: 2, label: 'ยอดคงเหลือ', due_date: addDays(day, -7), amount: 3000, overdue: false };
    eq(seen, [
      [50000, 45000, true, 0, [['มัดจำ', 45000, 'paid', false], ['ยอดคงเหลือ', 3000, 'upcoming', false]], rest, [45000, true, 0], 0],
      [45000, 45000, true, 0, [['มัดจำ', 45000, 'paid', false], ['ยอดคงเหลือ', 3000, 'upcoming', false]], rest, [45000, true, 0], 0],
      [null, 13500, true, 0, [['มัดจำ', 13500, 'paid', false], ['ยอดคงเหลือ', 34500, 'partial', false]], rest, [13500, true, 0], 0],
    ]);
  });

  test('รัน fix-07 ซ้ำ: ฐานที่ยังไม่มีคอลัมน์ → เพิ่มให้ งานเดิมเป็นอัตโนมัติ ยอดเดิมไม่เปลี่ยน / ค่าที่กำหนดไว้ไม่หาย / check constraint มีครั้งเดียว / ตารางสรุป "พร้อม"', async () => {
    const ctx2 = await createDb();
    try {
      const m0 = Object.fromEntries(ctx2.loadResults['supabase-fix-07-wedding.sql'].at(-1).rows.map((r) => [r['รายการ'], r['ค่า']]));
      eq(m0['มัดจำกำหนดเองต่องาน'], 'พร้อม');
      const u = await makeUsers(ctx2);
      const d = await seed(ctx2, u);
      const today = await bkkToday(ctx2);
      const a = await create(u.staff, payload(d, addDays(today, 20)));
      await pay(u.staff, a.id, 1000);
      // จำลองฐานจริงที่รัน fix-07 รุ่นก่อน (ยังไม่มีคอลัมน์นี้)
      await ctx2.pg.query(`alter table public.wed_bookings drop column deposit_override`);
      let res = await loadSqlFile(ctx2, 'supabase-fix-07-wedding.sql');
      eq(Object.fromEntries(res.at(-1).rows.map((r) => [r['รายการ'], r['ค่า']]))['มัดจำกำหนดเองต่องาน'], 'พร้อม');
      let ga = await u.staff.rpc('wed_get_booking', { p_booking_id: a.id });
      eq([...src(ga.money), ga.money.paid, plan(ga)], [13500, null, 'auto', 1000, [['มัดจำ', 13500], ['ยอดคงเหลือ', 31500]]]);
      ga = await upd(u.staff, ga, { deposit_override: 5000 });
      eq(src(ga.money), [5000, 5000, 'manual']);
      const b = await create(u.staff, payload(d, addDays(today, 21), { deposit_override: 0 }));

      res = await loadSqlFile(ctx2, 'supabase-fix-07-wedding.sql');
      res = await loadSqlFile(ctx2, 'supabase-fix-07-wedding.sql');
      eq(Object.fromEntries(res.at(-1).rows.map((r) => [r['รายการ'], r['ค่า']]))['มัดจำกำหนดเองต่องาน'], 'พร้อม');
      ga = await u.staff.rpc('wed_get_booking', { p_booking_id: a.id });
      eq([...src(ga.money), ga.money.paid, plan(ga)], [5000, 5000, 'manual', 1000, [['มัดจำ', 5000], ['ยอดคงเหลือ', 40000]]]);
      const gb = await u.staff.rpc('wed_get_booking', { p_booking_id: b.id });
      eq([...src(gb.money), gb.money.deposit_met], [0, 0, 'manual', true]);
      eq(await ctx2.pg.one(`select count(*)::int as n from pg_constraint
                             where conrelid = 'public.wed_bookings'::regclass and conname = 'wed_bookings_deposit_override_check'`), { n: 1 });
      eq(await ctx2.pg.one(`select format_type(a.atttypid, a.atttypmod) as t, a.attnotnull as nn from pg_attribute as a
                             where a.attrelid = 'public.wed_bookings'::regclass and a.attname = 'deposit_override'`),
        { t: 'numeric(10,2)', nn: false });
    } finally {
      await ctx2.db.close();
    }
  });
}
