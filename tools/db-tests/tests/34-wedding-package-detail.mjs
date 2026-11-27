// supabase-fix-10 (27/11/2569): ใส่รายละเอียด "แพ็คเกจหลัก" ตามฟอร์มร้าน — แพ็กเกจ + งานที่จองแล้ว (เฉพาะที่ยังว่าง)
//   ไม่ทับรายละเอียดที่พิมพ์ไว้ · ไม่แตะแพ็กเกจอื่น · ไม่แตะยอดเงิน · สะกด ค/ก ได้ทั้งคู่ · รันซ้ำได้
import { loadSqlFile, eq } from '../run.mjs';
import { makeUsers, seed, payload, create, bkkToday, addDays } from './lib/wed.js';
import { uuid } from '../run.mjs';

const FIX10 = 'supabase-fix-10-wedding-package-detail.sql';
const DESC = '-ถ่าย 4 ชม.\n-ช่างภาพ 2 คน\n-ถ่ายกล้องไอโฟน / dji (ได้หลายมู้ด )\n-ตัดคลิปไฮไลท์ 2 คลิป ( 30-45 วิ )\n'
  + '-เก็บ vdo ฟุตเทจ 300-400+ ทุกโมเม้นในงาน\n-ฟุตเทจ ส่งงานภายใน 24 ชม.\n-คลิปไฮไลท์ ส่งงานภายใน 3-5 วัน (แก้ไขได้ 2 ครั้ง)\n'
  + '( กทม และปริมณฑลฟรีค่าเดินทาง )';

export async function setup(ctx, st) {
  st.u = await makeUsers(ctx);
  st.d = await seed(ctx, st.u);
  st.today = await bkkToday(ctx);
  await st.u.mgr.rpc('wed_save_settings', { p_settings: { max_jobs_per_day: 0 } });
}

async function run(ctx) {
  const res = await loadSqlFile(ctx, FIX10);
  return res[res.length - 1].rows.map((r) => [r['ลำดับ'], r['ผล']]);
}

export function register(test) {
  test('fix-10: แพ็คเกจหลักที่ไม่มีรายละเอียด → ใส่ตามฟอร์มร้าน ทั้งแพ็กเกจและงานที่จองแล้ว, ไม่ทับของที่พิมพ์ไว้, รันซ้ำได้', async (ctx, st) => {
    const main = await st.u.mgr.rpc('wed_save_package', { p_package: { client_id: uuid(), name: 'แพ็คเกจหลัก', price: 5900, hours: 4, crew_size: 2 } });
    const typed = await st.u.mgr.rpc('wed_save_package', { p_package: { client_id: uuid(), name: 'แพ็กเกจหลัก ', price: 7000, hours: 5, description: 'ของบอสเอง' } });
    const day = addDays(st.today, 20);
    const b1 = await create(st.u.staff, payload(st.d, day, { package_id: main.id }));
    const b2 = await create(st.u.staff, payload(st.d, day, { package_id: typed.id }));
    const other = await create(st.u.staff, payload(st.d, day));
    eq([b1.package.description, b2.package.description], [null, 'ของบอสเอง']);
    const before = (await st.u.mgr.rpc('wed_get_booking', { p_booking_id: b1.id })).money;

    const check = await run(ctx);
    eq(check.slice(1), [[2, 'ถูกต้อง'], [3, '2 งาน']]);
    ok1(check[0][0] === 1 && check[0][1].startsWith('ถูกต้อง (2 แพ็กเกจ'));

    const pk = await ctx.pg.all(`select name, description from public.wed_packages where id in ($1, $2) order by price`, [main.id, typed.id]);
    eq(pk.map((p) => p.description), [DESC, 'ของบอสเอง']);
    const g = async (id) => st.u.mgr.rpc('wed_get_booking', { p_booking_id: id });
    const a1 = await g(b1.id);
    eq([a1.package.description, (await g(b2.id)).package.description, (await g(other.id)).package.description],
      [DESC, 'ของบอสเอง', null]);
    eq(a1.money, before);

    // รันซ้ำ: ผลเหมือนเดิม
    eq(await run(ctx), check);
  });
}

function ok1(c) { if (!c) throw new Error('ตารางตรวจผลแถว 1 ไม่ถูกต้อง'); }
