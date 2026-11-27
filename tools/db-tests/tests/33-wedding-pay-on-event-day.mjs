// supabase-fix-09 (บอสสั่ง 27/11/2569): ชำระยอดคงเหลือ "วันงาน" + เงื่อนไขร้าน 3 ข้อ
//   ฐานข้อมูลก่อน fix-09 (นโยบายเดิม 7 วันก่อนวันงาน) → สร้างงานหลายแบบ → รัน fix-09 →
//   งานปกติ/งานกระชั้นชิด = วันงาน (งวดมาตรฐานตาม) · ยอดเงินไม่เปลี่ยน · กำหนดวันเอง/งวดแก้เอง/งานยกเลิก = ไม่แตะ ·
//   จดประวัติเฉพาะงานที่วันเปลี่ยนจริง · ตารางตรวจผลถูกต้องทุกข้อ · รันซ้ำไม่จดประวัติซ้ำ · งานใหม่หลัง fix-09 = วันงาน ·
//   ทำครั้งเดียว: บอสแก้ตั้งค่าร้านภายหลัง → รันซ้ำไม่ทับ
import { loadSqlFile, eq, ok, money } from '../run.mjs';
import { makeUsers, seed, payload, create, pay, bkkToday, addDays } from './lib/wed.js';

export const dbOptions = { upTo: 'supabase-fix-08-lock-order.sql' };

const FIX09 = 'supabase-fix-09-wedding-pay-on-event-day.sql';
const TERMS = '-กรณีลูกค้ายกเลิก/เลื่อนวัน จะไม่สามารถคืนเงินมัดจำได้ทุกกรณี\n'
  + '-เลื่อนวันได้หากทางทีมมีคิวว่าง\n'
  + '-ชำระยอดคงเหลือ ณ วันงาน หลังถ่ายเสร็จ';

export async function setup(ctx, st) {
  st.u = await makeUsers(ctx);
  st.d = await seed(ctx, st.u);
  st.today = await bkkToday(ctx);
  await st.u.mgr.rpc('wed_save_settings', { p_settings: { max_jobs_per_day: 0 } });
}

const get = (st, id) => st.u.mgr.rpc('wed_get_booking', { p_booking_id: id });
const plan = (b) => b.installments.map((i) => [i.label, i.due_date, i.amount]);
const moneyOf = (b) => [b.money.grand_total, b.money.paid, b.money.due, b.money.deposit_required, b.money.deposit_met];
const policyLogs = (b) => b.logs.filter((l) => l.action === 'policy_update');

// ผลของ select ตัวสุดท้ายในไฟล์ (ตารางตรวจผล)
async function runFix09(ctx) {
  const res = await loadSqlFile(ctx, FIX09);
  const last = res[res.length - 1];
  return last.rows.map((r) => [r['ลำดับ'], r['ผล']]);
}

export function register(test) {
  test('fix-09: งานเดิมเปลี่ยนวันชำระยอดคงเหลือเป็นวันงาน — ยอดเงินไม่เปลี่ยน, กำหนดเอง/งวดแก้เอง/ยกเลิก ไม่แตะ, ตารางตรวจผลถูกต้อง, รันซ้ำได้', async (ctx, st) => {
    const day = addDays(st.today, 30);
    // ก่อน fix-09: นโยบายร้าน = 7 วันก่อนวันงาน
    eq((await st.u.staff.rpc('wed_get_settings')).balance_due_days, 7);

    const normal = await create(st.u.staff, payload(st.d, day));
    await pay(st.u.staff, normal.id, 13500);
    const override = await create(st.u.staff, payload(st.d, day, { balance_due_date_override: addDays(day, -3) }));
    let custom = await create(st.u.staff, payload(st.d, day));
    custom = await st.u.staff.rpc('wed_set_installments', { p_booking_id: custom.id, p_items: [
      { label: 'มัดจำ', amount: 10000, due_date: st.today },
      { label: 'งวดสุดท้าย', amount: 35000, due_date: addDays(day, -10) },
    ] });
    const cancelled = await create(st.u.staff, payload(st.d, day));
    await st.u.staff.rpc('wed_cancel', { p_booking_id: cancelled.id, p_reason: 'ลูกค้ายกเลิก' });
    const soon = await create(st.u.staff, payload(st.d, addDays(st.today, 3)));
    const noDate = await create(st.u.staff, payload(st.d, null, { sessions: [{ session_type: 'reception', date: null }] }));

    const before = {};
    for (const b of [normal, override, custom, cancelled, soon, noDate]) before[b.id] = await get(st, b.id);
    eq(before[normal.id].money.balance_due_date, addDays(day, -7));
    eq(plan(before[normal.id]).map((r) => r[1]), [st.today, addDays(day, -7)]);
    eq(before[soon.id].money.balance_due_date, st.today);          // งานกระชั้นชิด: ไม่ย้อนก่อนวันครบกำหนดมัดจำ

    const check = await runFix09(ctx);
    eq(check.filter(([n]) => ![6, 7].includes(n)).map(([n, v]) => [n, v]),
      [[1, 'ถูกต้อง'], [2, 'ถูกต้อง'], [3, 'ถูกต้อง'], [4, 'ถูกต้อง'], [5, 'ถูกต้อง'], [8, 'ถูกต้อง']]);
    eq(check.filter(([n]) => [6, 7].includes(n)), [[6, '1 งาน'], [7, '1 งาน']]);

    // ตั้งค่าร้าน
    const s = await st.u.staff.rpc('wed_get_settings');
    eq([s.balance_due_days, s.terms_text], [0, TERMS]);

    // งานปกติ: วันงาน + งวดมาตรฐานตาม + ยอดเงินเดิม + ประวัติ
    const n1 = await get(st, normal.id);
    eq([n1.money.balance_due_days, n1.money.balance_due_date], [0, day]);
    eq(plan(n1), [['มัดจำ', st.today, 13500], ['ยอดคงเหลือ', day, 31500]]);
    eq(moneyOf(n1), moneyOf(before[normal.id]));
    const lg = policyLogs(n1);
    eq(lg.length, 1);
    eq([lg[0].actor_name, lg[0].detail.old_balance_due_date, lg[0].detail.new_balance_due_date, lg[0].detail.installments_kept],
      ['ระบบ', addDays(day, -7), day, false]);

    // งานกระชั้นชิด: วันงาน (ไม่ใช่วันนี้แล้ว)
    const s1 = await get(st, soon.id);
    eq([s1.money.balance_due_date, plan(s1)[1][1]], [addDays(st.today, 3), addDays(st.today, 3)]);
    eq(moneyOf(s1), moneyOf(before[soon.id]));

    // กำหนดวันเอง: คงวันเดิม
    const o1 = await get(st, override.id);
    eq([o1.money.balance_due_days, o1.money.balance_due_date, plan(o1)], [0, addDays(day, -3), plan(before[override.id])]);
    eq(policyLogs(o1).length, 0, 'วันไม่เปลี่ยน ต้องไม่จดประวัติ');

    // งวดที่บอสแก้เอง: วันในงวดคงเดิม
    const c1 = await get(st, custom.id);
    eq([c1.installments_custom, plan(c1)], [true, plan(before[custom.id])]);
    eq(c1.money.balance_due_date, day);
    eq(policyLogs(c1).map((l) => [l.detail.old_balance_due_date, l.detail.new_balance_due_date, l.detail.installments_kept]),
      [[addDays(day, -7), day, true]]);

    // งานยกเลิก: ไม่แตะเลย
    const x1 = await get(st, cancelled.id);
    eq([x1.money.balance_due_days, x1.money.balance_due_date, policyLogs(x1).length],
      [before[cancelled.id].money.balance_due_days, before[cancelled.id].money.balance_due_date, 0]);

    // ยังไม่มีวันงาน: ไม่มีวันครบกำหนด
    const d1 = await get(st, noDate.id);
    eq([d1.money.balance_due_days, d1.money.balance_due_date, policyLogs(d1).length], [0, null, 0]);

    // รันซ้ำ: ตารางตรวจผลเหมือนเดิม ไม่จดประวัติซ้ำ
    const again = await runFix09(ctx);
    eq(again, check);
    eq(policyLogs(await get(st, normal.id)).length, 1);

    // งานใหม่หลัง fix-09 = วันงาน
    const day2 = addDays(st.today, 60);
    const fresh = await create(st.u.staff, payload(st.d, day2));
    eq([fresh.money.balance_due_days, fresh.money.balance_due_date], [0, day2]);
    eq(plan(fresh).map((r) => r[1]), [st.today, day2]);
    money(fresh.money.grand_total, 45000);
    // ราคาล่วงหน้าในฟอร์มตรงกับที่บันทึก
    const q = await st.u.staff.rpc('wed_quote', { p_payload: payload(st.d, day2) });
    eq(q.money.balance_due_date, day2);
  });

  test('fix-09 ทำครั้งเดียว: บอสแก้ตั้งค่าร้านภายหลัง (นโยบาย 3 วัน + เงื่อนไขใหม่) → รันไฟล์ซ้ำไม่ทับ ไม่แตะงาน ตารางตรวจผลไม่บอกให้รันซ้ำ', async (ctx, st) => {
    // ทดสอบก่อนหน้ารัน fix-09 ไปแล้ว (ฐานข้อมูลเดียวกันใน suite นี้)
    eq((await st.u.staff.rpc('wed_get_settings')).balance_due_days, 0);
    const MINE = 'เงื่อนไขที่บอสแก้เอง';
    await st.u.mgr.rpc('wed_save_settings', { p_settings: { balance_due_days: 3, terms_text: MINE } });
    const day = addDays(st.today, 40);
    const later = await create(st.u.staff, payload(st.d, day));
    eq([later.money.balance_due_days, later.money.balance_due_date], [3, addDays(day, -3)]);

    const check = await runFix09(ctx);
    const s = await st.u.staff.rpc('wed_get_settings');
    eq([s.balance_due_days, s.terms_text], [3, MINE]);
    const l1 = await get(st, later.id);
    eq([l1.money.balance_due_days, l1.money.balance_due_date, policyLogs(l1).length], [3, addDays(day, -3), 0]);
    const byRow = Object.fromEntries(check);
    eq([byRow[2], byRow[4], byRow[5]], ['ถูกต้อง', 'ถูกต้อง', 'ถูกต้อง']);
    ok(byRow[1].includes('3 วัน') && byRow[1].includes('ไม่ทับ'), 'แถว 1: ' + byRow[1]);
    ok(byRow[3].includes('ไม่ทับ') && byRow[8].includes('ไม่ทับ'), 'แถว 3/8: ' + byRow[3] + ' / ' + byRow[8]);
    ok(!check.some(([, v]) => String(v).includes('รันไฟล์นี้ซ้ำ')), 'ตารางตรวจผลยังบอกให้รันซ้ำ');
  });
}
