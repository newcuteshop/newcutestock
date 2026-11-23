// ตัวช่วยร่วมของไฟล์ทดสอบ b.oncloud (wed_*) — ผู้ใช้ทุกแบบ + ข้อมูลตั้งต้น (ทีมงาน/แพ็กเกจ/บริการเสริม/ลูกค้า)
import { uuid } from '../../run.mjs';

// วันที่ 'YYYY-MM-DD' ± n วัน (คำนวณแบบปฏิทิน ไม่มีเรื่องเขตเวลา)
export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function bkkToday(ctx) {
  const r = await ctx.pg.one(`select public.pos_bkk_today()::text as d`);
  return r.d;
}

// ผู้ใช้ 6 แบบของตารางสิทธิ์
export async function makeUsers(ctx) {
  return {
    none: await ctx.makeUser({ name: 'ไม่มีสิทธิ์', perms: {} }),
    staff: await ctx.makeUser({ name: 'พนักงานบีออนคลาวด์', perms: { wedding: true } }),
    mgr: await ctx.makeUser({ name: 'ผู้จัดการบีออนคลาวด์', perms: { wedding_manage: true } }),
    admin: await ctx.makeUser({ name: 'แอดมิน', role: 'admin', perms: {} }),
    newcute: await ctx.makeUser({ name: 'พนักงานนิวคิวท์',
      perms: { products: true, stock: true, sales: true, labels: true, reports: true, users: false } }),
    rental: await ctx.makeUser({ name: 'พนักงานร้านเช่า', perms: { rental: true, rental_manage: true } }),
  };
}

// ทีมงาน 3 คน + แพ็กเกจ 1 + บริการเสริม 1 + ลูกค้า 1 (ผ่าน RPC จริงทั้งหมด)
export async function seed(ctx, u) {
  const a = await u.mgr.rpc('wed_save_crew', { p_crew: { client_id: uuid(), name: 'สมชาย ช่างภาพ', nickname: 'ชาย', role: 'photo', default_fee: 2500, color: '#AA3355' } });
  const b = await u.mgr.rpc('wed_save_crew', { p_crew: { client_id: uuid(), name: 'วิไล วิดีโอ', nickname: 'ไล', role: 'video', default_fee: 3000.5 } });
  const c = await u.mgr.rpc('wed_save_crew', { p_crew: { client_id: uuid(), name: 'ต้น โดรน', nickname: 'ต้น', role: 'drone', default_fee: 1200 } });
  const pkg = await u.mgr.rpc('wed_save_package', {
    p_package: {
      client_id: uuid(), name: 'แพ็กเกจเต็มวัน', price: 45000, hours: 10, crew_size: 3,
      deliverables: [
        { name: 'ภาพตกแต่ง', qty: 500, unit: 'ภาพ', due_days: 30 },
        { name: 'วิดีโอไฮไลต์', qty: 1, unit: 'คลิป', due_days: 45 },
      ],
    },
  });
  const addon = await u.mgr.rpc('wed_save_addon', { p_addon: { client_id: uuid(), name: 'ชั่วโมงเพิ่ม', price: 1500, unit: 'ชม.' } });
  const cust = await u.staff.rpc('wed_save_customer', {
    p_customer: { client_id: uuid(), name: 'มิว ใจดี', partner_name: 'เจ รักดี', phone: '081-234-5678', line_id: 'mewjay', source: 'instagram' },
  });
  return { crew: [a, b, c], pkg, addon, cust };
}

// payload งานแบบสั้น (1 คิว) — override ได้ทุกคีย์
export function payload(d, day, over = {}) {
  return {
    customer_id: d.cust.id,
    couple_names: 'คุณมิว & คุณเจ',
    package_id: d.pkg.id,
    sessions: [{ session_type: 'reception', title: 'งานเลี้ยง', date: day, start_time: '17:00', end_time: '22:00', call_time: '15:30', venue_name: 'โรงแรมทดสอบ', crew: [] }],
    ...over,
  };
}

export async function create(user, p, clientId = uuid()) {
  const r = await user.rpc('wed_create_booking', { p_client_id: clientId, p_payload: p });
  return r.booking;
}

export async function pay(user, bookingId, amount, extra = {}) {
  return user.rpc('wed_add_payment', {
    p_client_id: uuid(), p_booking_id: bookingId, p_kind: extra.kind ?? 'payment', p_method: extra.method ?? 'transfer',
    p_amount: amount, p_paid_on: extra.paid_on ?? null, p_purpose: extra.purpose ?? null, p_note: extra.note ?? null,
    p_slip_path: extra.slip_path ?? null,
  });
}
