// =========================================================================
// tools/qa/seed.mjs — ข้อมูลตั้งต้นของ QA (ผ่าน RPC จริงทั้งหมด ไม่ insert ตรงยกเว้นสินค้า NEWCUTE ตั้งต้น)
//
// seedAll(mock) → { users, summary, today, bookings: { key → booking json }, tokens }
// ผู้ใช้ (หน้า /login: ชื่อผู้ใช้ = รหัสผ่าน):
//   boss   แอดมิน (เห็น 3 ร้าน)          wmgr  ผู้จัดการ b.oncloud (wedding_manage)
//   wstaff พนักงาน b.oncloud (wedding)    ncute พนักงาน NEWCUTE            rent  พนักงานร้านเช่า
// b.oncloud: ตั้งค่าร้าน + พร้อมเพย์ + บัญชี 2 บัญชี, แพ็กเกจ 3, บริการเสริม 4, ทีมงาน 6, ลูกค้า 8,
//   งานทุกสถานะในเดือนนี้และเดือนหน้า: 2 งานวันเดียวกัน (คิวเต็ม) + ทีมชนคิว, งวดเลยกำหนด, งานส่งเลยกำหนด,
//   ล็อกคิวใกล้หมดเวลา, เลื่อน, ยกเลิก (คืนเงินบางส่วน), รับเงินมีสลิป, รายการเงินที่ยกเลิก (void), ค่าล่วงเวลา
// =========================================================================
import { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// PNG สีพื้นเล็กๆ (สลิป/โลโก้ตัวอย่าง) — ไม่ต้องพึ่งไฟล์ภายนอก
export function solidPng(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export async function seedAll(mock) {
  const U = {
    boss: await mock.createUser({ email: 'boss@newcute.com', password: 'newcute:boss', name: 'บอส', role: 'admin' }),
    wmgr: await mock.createUser({ email: 'wmgr@newcute.com', password: 'newcute:wmgr', name: 'ผู้จัดการบีออนคลาวด์', perms: { wedding_manage: true } }),
    wstaff: await mock.createUser({ email: 'wstaff@newcute.com', password: 'newcute:wstaff', name: 'พนักงานบีออนคลาวด์', perms: { wedding: true } }),
    ncute: await mock.createUser({ email: 'ncute@newcute.com', password: 'newcute:ncute', name: 'พนักงานนิวคิวท์', perms: { products: true, stock: true, sales: true, labels: true, reports: true } }),
    rent: await mock.createUser({ email: 'rent@newcute.com', password: 'newcute:rent', name: 'พนักงานร้านเช่า', perms: { rental: true, rental_manage: true } }),
  };
  const today = (await mock.asOwnerQuery(`select public.pos_bkk_today()::text as d`))[0].d;
  const T = (n) => addDays(today, n);
  const id = () => randomUUID();
  const M = U.boss; // แอดมิน = ผู้จัดการทุกร้าน (วันที่รับเงินย้อนหลังได้)

  // ---------- NEWCUTE (ให้หน้าเดิมมีข้อมูลสำหรับเทียบภาพ) ----------
  const g = (await mock.asOwnerQuery(`insert into public.product_groups (name) values ('เสื้อยืด QA') returning id`))[0];
  const prods = [];
  for (const [i, [name, price, qty]] of [['เสื้อยืดลายดอก', 290, 12], ['กางเกงยีนส์ทรงตรง', 690, 4], ['เดรสผ้าไหมสีครีม', 1290, 0], ['หมวกบักเก็ต', 199, 30]].entries()) {
    prods.push((await mock.asOwnerQuery(`insert into public.products (name, sku, sell_price, cost_price, stock_qty, group_id) values ($1, $2, $3, $4, $5, $6) returning id`,
      [name, `QA-${String(i + 1).padStart(3, '0')}`, price, Math.round(price * 0.45), qty, g.id]))[0]);
  }
  await U.ncute.rpc('record_sale', { p_client_id: id(), p_items: [{ product_id: prods[0].id, qty: 2 }, { product_id: prods[3].id, qty: 1 }], p_discount: 0, p_payment_method: 'cash', p_note: null, p_channel: 'store', p_cash_received: 1000 });
  await U.ncute.rpc('record_sale', { p_client_id: id(), p_items: [{ product_id: prods[1].id, qty: 1 }], p_discount: 40, p_payment_method: 'transfer', p_note: null, p_channel: 'store', p_cash_received: null });

  // ---------- ร้านเช่าชุด ----------
  const ritem = await U.rent.rpc('rental_save_item', { p_item: { client_id: id(), code: 'DRS-01', name: 'ชุดไทยจักรพรรดิ สีทอง', base_price: 1500, base_days: 3, security_deposit: 1000 }, p_units: [{ size: 'M' }, { size: 'L' }] });
  await U.rent.rpc('rental_create_booking', { p_client_id: id(), p_payload: { customer: { name: 'คุณเอ ลูกค้าเช่า', phone: '0899999999' }, pickup_date: T(5), return_date: T(7), lines: [{ item_id: ritem.id }], payments: [{ kind: 'payment', method: 'cash', amount: 500 }] } });

  // ---------- b.oncloud: ตั้งค่า ----------
  await M.rpc('wed_save_settings', {
    p_settings: {
      tagline: 'ทีมถ่ายภาพและคอนเทนต์งานแต่ง', phone: '0812345678', line_id: '@boncloud', line_url: 'https://line.me/R/ti/p/@boncloud',
      instagram: 'b.oncloud.wedding', facebook: 'b.oncloud', email: 'hello@boncloud.example', address: '99/9 ถนนพระราม 9 แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพฯ 10310',
      promptpay_id: '0812345678', promptpay_name: 'บริษัท บีออนคลาวด์ จำกัด',
      bank_accounts: [
        { bank: 'กสิกรไทย', account_no: '123-4-56789-0', account_name: 'บจก. บีออนคลาวด์' },
        { bank: 'ไทยพาณิชย์', account_no: '987-6-54321-0', account_name: 'บจก. บีออนคลาวด์' },
      ],
      deposit_percent: 30, min_deposit: 5000, balance_due_days: 7, hold_hours: 72, max_jobs_per_day: 2, overtime_rate: 1500,
      booking_note: 'กรุณาตรวจสอบวันเวลาและสถานที่ หากต้องการแก้ไขแจ้งทาง LINE @boncloud ภายใน 3 วัน',
      receipt_footer: 'ขอบคุณที่ไว้วางใจ b.oncloud.wedding content',
    },
  });

  // ---------- แพ็กเกจ / บริการเสริม / ทีมงาน / ลูกค้า ----------
  const pk = [];
  pk.push(await M.rpc('wed_save_package', { p_package: { client_id: id(), name: 'แพ็กเกจเต็มวัน (พิธีเช้า + งานเลี้ยง)', price: 45000, hours: 12, crew_size: 4, description: 'ช่างภาพ 2 คน วิดีโอ 1 คน คอนเทนต์ 1 คน ตลอดวัน',
    deliverables: [{ name: 'ภาพตกแต่ง', qty: 600, unit: 'ภาพ', due_days: 30 }, { name: 'วิดีโอไฮไลต์', qty: 1, unit: 'คลิป', due_days: 45 }, { name: 'คลิปสั้นลงโซเชียล', qty: 3, unit: 'คลิป', due_days: 7 }] } }));
  pk.push(await M.rpc('wed_save_package', { p_package: { client_id: id(), name: 'แพ็กเกจครึ่งวัน', price: 25000, hours: 5, crew_size: 2, description: 'ช่างภาพ 1 คน วิดีโอ 1 คน',
    deliverables: [{ name: 'ภาพตกแต่ง', qty: 300, unit: 'ภาพ', due_days: 21 }, { name: 'วิดีโอไฮไลต์', qty: 1, unit: 'คลิป', due_days: 30 }] } }));
  pk.push(await M.rpc('wed_save_package', { p_package: { client_id: id(), name: 'พรีเวดดิ้งนอกสถานที่', price: 15900.5, hours: 4, crew_size: 2, description: 'ถ่ายพรีเวดดิ้ง 1 โลเคชัน',
    deliverables: [{ name: 'ภาพตกแต่ง', qty: 80, unit: 'ภาพ', due_days: 14 }] } }));
  const ad = [];
  for (const a of [['ชั่วโมงเพิ่ม', 1500, 'ชม.'], ['โดรน', 3500, 'งาน'], ['ตัดต่อภายในวัน (Same day edit)', 8000, 'งาน'], ['อัลบั้มภาพ 20 หน้า', 4500, 'เล่ม']]) {
    ad.push(await M.rpc('wed_save_addon', { p_addon: { client_id: id(), name: a[0], price: a[1], unit: a[2] } }));
  }
  const crewDefs = [
    ['สมชาย ใจดี', 'ชาย', 'photo', 3500, '#B4532A'], ['วิไล รักงาน', 'ไล', 'video', 4000, '#2F6B4F'], ['ต้น เมฆา', 'ต้น', 'drone', 2500, '#355C9A'],
    ['มายด์ คอนเทนต์', 'มายด์', 'content', 3000, '#8A3D7A'], ['เบียร์ ตัดต่อ', 'เบียร์', 'editor', 2000, '#6B5222'], ['นุ่น ผู้ช่วย', 'นุ่น', 'assistant', 1200, '#4F5B66'],
  ];
  const cr = [];
  for (const c of crewDefs) cr.push(await M.rpc('wed_save_crew', { p_crew: { client_id: id(), name: c[0], nickname: c[1], role: c[2], default_fee: c[3], color: c[4], phone: '0890000' + String(cr.length + 100), line_id: 'crew' + cr.length } }));
  const custDefs = [
    ['มิว ศรีสุข', 'เจ ทองดี', '0812345671', 'instagram'], ['ฝน พรหมมา', 'ต้อม ใจงาม', '0823456782', 'facebook'], ['แพรวา สุวรรณ', 'ภูมิ รักษ์ไทย', '0834567893', 'tiktok'],
    ['กิ๊ฟ วงศ์ใหญ่', 'บอล ศักดิ์ดี', '0845678904', 'line'], ['น้ำหวาน มณี', 'โอ๊ต แก้วกล้า', '0856789015', 'referral'], ['ปราง ศรีวิไล', 'เก่ง ชัยมงคล', '0867890126', 'walkin'],
    ['ใบเฟิร์น อินทร์แก้ว', 'ปอนด์ สายสุวรรณ', '0878901237', 'website'], ['จูน เรืองศรี', 'นนท์ พิทักษ์', '0889012348', 'other'],
  ];
  const cu = [];
  for (const c of custDefs) cu.push(await U.wstaff.rpc('wed_save_customer', { p_customer: { client_id: id(), name: c[0], partner_name: c[1], phone: c[2], line_id: 'line_' + cu.length, instagram: 'ig_' + cu.length, source: c[3], email: `cust${cu.length}@mail.example`, address: '12 หมู่ 3 ต.บางพลี อ.บางพลี จ.สมุทรปราการ' } }));

  const crewOf = (i, extra = {}) => ({ crew_id: cr[i].id, role: cr[i].role, ...extra });
  const sess = (o) => ({ session_type: 'reception', title: 'งานเลี้ยงฉลองมงคลสมรส', start_time: '17:00', end_time: '22:00', call_time: '15:30', venue_name: 'โรงแรมรอยัล ริเวอร์ ห้องบอลรูม', venue_address: '219 ถนนจรัญสนิทวงศ์ บางพลัด กรุงเทพฯ', map_url: 'https://maps.google.com/?q=13.78,100.50', venue_contact: 'คุณแอน 0811112222', dress_code: 'ชุดสุภาพโทนดำ', notes: 'เข้าทางประตูหลังห้องจัดเลี้ยง', run_sheet: [{ time: '17:00', text: 'ลงทะเบียนแขก' }, { time: '18:30', text: 'เปิดตัวบ่าวสาว' }, { time: '19:00', text: 'ตัดเค้ก / กล่าวขอบคุณ' }], crew: [], ...o });
  const B = {};
  const create = async (key, user, payload, opts = {}) => {
    const r = await user.rpc('wed_create_booking', { p_client_id: id(), p_payload: { force: true, ...payload } });
    B[key] = r.booking;
    void opts;
    return r.booking;
  };
  const pay = (user, b, amount, extra = {}) => user.rpc('wed_add_payment', {
    p_client_id: id(), p_booking_id: b.id, p_kind: extra.kind ?? 'payment', p_method: extra.method ?? 'transfer', p_amount: amount,
    p_paid_on: extra.paid_on ?? null, p_purpose: extra.purpose ?? null, p_note: extra.note ?? null, p_slip_path: extra.slip_path ?? null,
  });
  const get = async (key) => { B[key] = await M.rpc('wed_get_booking', { p_booking_id: B[key].id }); return B[key]; };

  const capDay = T(5);
  // 1) สอบถาม (ติดตามวันนี้)
  await create('inquiry', U.wstaff, { customer_id: cu[0].id, couple_names: 'คุณมิว & คุณเจ', package_id: pk[1].id, status: 'inquiry', followup_date: today, followup_note: 'โทรกลับเรื่องวันว่างเดือนหน้า',
    sessions: [sess({ session_type: 'ceremony', title: 'พิธีสงฆ์และรดน้ำสังข์', date: T(12), start_time: '07:00', end_time: '12:00', call_time: '06:00' })] });
  // สอบถามวันเดียวกับวันคิวเต็ม (ไม่นับคิว — โชว์เส้นประเมื่อเปิด "รวมงานสอบถาม")
  await create('inquiry2', U.wstaff, { customer_id: cu[7].id, couple_names: 'คุณจูน & คุณนนท์', package_id: pk[2].id, status: 'inquiry', sessions: [sess({ session_type: 'prewedding', title: 'พรีเวดดิ้งทะเล', date: capDay, start_time: '06:00', end_time: '09:00', call_time: null })] });
  // 2) ล็อกคิวใกล้หมดเวลา (10 ชม.)
  await create('hold', U.wstaff, { customer_id: cu[1].id, couple_names: 'คุณฝน & คุณต้อม', package_id: pk[0].id, status: 'inquiry', sessions: [sess({ date: T(14), crew: [crewOf(0), crewOf(1)] })] });
  B.hold = await U.wstaff.rpc('wed_hold', { p_booking_id: B.hold.id, p_hours: 10 });
  // 3+4) วันเดียวกัน 2 งาน (เต็ม) + ทีมงานคนเดียวกันเวลาทับกัน (ชนคิว)
  await create('capA', U.wmgr, { customer_id: cu[2].id, couple_names: 'คุณแพรวา & คุณภูมิ', package_id: pk[0].id, status: 'confirmed',
    addons: [{ addon_id: ad[1].id, name: ad[1].name, qty: 1, unit_price: 3500 }, { addon_id: ad[0].id, name: ad[0].name, qty: 1.5, unit_price: 1500 }], travel_fee: 1200, discount: 2000, discount_note: 'ส่วนลดจองล่วงหน้า',
    coordinator_name: 'คุณเมย์ (ออแกไนเซอร์)', coordinator_phone: '0891234567', mood_link: 'https://pinterest.com/b/qa-mood', customer_note: 'อยากได้ภาพครอบครัวฝั่งเจ้าสาวเยอะๆ', note: 'ลูกค้า VIP',
    sessions: [sess({ session_type: 'ceremony', title: 'พิธีหมั้นและรดน้ำสังข์', date: capDay, start_time: '07:00', end_time: '12:00', call_time: '06:00', crew: [crewOf(0, { fee: 3500 }), crewOf(1), crewOf(5)] }),
      sess({ date: capDay, start_time: '18:00', end_time: '22:00', call_time: '16:30', crew: [crewOf(0), crewOf(3)] })],
    payments: [{ kind: 'payment', method: 'transfer', amount: 15000, note: 'มัดจำ' }] });
  await create('capB', U.wmgr, { customer_id: cu[3].id, couple_names: 'คุณกิ๊ฟ & คุณบอล', package_id: pk[1].id, status: 'confirmed',
    sessions: [sess({ title: 'งานเลี้ยงกลางวัน', date: capDay, start_time: '10:00', end_time: '15:00', call_time: '09:00', venue_name: 'บ้านสวนริมน้ำ นนทบุรี', crew: [crewOf(0), crewOf(2)] })],
    payments: [{ kind: 'payment', method: 'promptpay', amount: 8000 }] });
  // void 1 รายการ (กรอกผิด)
  const wrong = await pay(U.wmgr, B.capB, 500, { method: 'cash', note: 'กรอกผิด' });
  await U.wmgr.rpc('wed_void_payment', { p_payment_id: wrong.payment.id, p_reason: 'กรอกยอดผิด' });
  // สลิปโอน (อัปโหลดไฟล์จริงเข้าถัง wedding-files ผ่านนโยบาย storage แล้วอ้าง path)
  const slipPath = `${B.capA.id}/${randomUUID()}.png`;
  await U.wstaff.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ('wedding-files', $1, $2, '{"mimetype":"image/png"}'::jsonb)`, [slipPath, U.wstaff.id]);
  mock.putFile('wedding-files', slipPath, solidPng(360, 640, [210, 230, 245]), 'image/png');
  await pay(U.wstaff, B.capA, 4000.75, { method: 'transfer', slip_path: slipPath, note: 'โอนงวด 2 (มีสลิป)' });
  // 5) ยืนยันแล้ว หลายคิว เดือนหน้า + งวดชำระ 3 งวด (งวดแรกเลยกำหนด)
  await create('multi', U.wmgr, { customer_id: cu[4].id, couple_names: 'คุณน้ำหวาน & คุณโอ๊ต', package_id: pk[0].id, status: 'confirmed',
    addons: [{ addon_id: ad[2].id, name: ad[2].name, qty: 1, unit_price: 8000 }, { name: 'ซุ้มถ่ายภาพ (สั่งพิเศษ)', qty: 1, unit_price: 2500.25 }],
    sessions: [sess({ session_type: 'engagement', title: 'พิธีสู่ขอ / หมั้น', date: T(30), start_time: '08:09', end_time: '11:00', call_time: '07:00', crew: [crewOf(0), crewOf(3)] }),
      sess({ session_type: 'reception', date: T(31), crew: [crewOf(0), crewOf(1), crewOf(2), crewOf(3)] }),
      sess({ session_type: 'prewedding', title: 'พรีเวดดิ้งในสตูดิโอ', date: T(18), start_time: '13:00', end_time: '17:00', call_time: '12:00', venue_name: 'สตูดิโอเมฆขาว', crew: [crewOf(3)] })] });
  B.multi = await get('multi');
  const gt = Number(B.multi.money.grand_total);
  B.multi = await U.wmgr.rpc('wed_set_installments', { p_booking_id: B.multi.id, p_items: [
    { label: 'มัดจำ', due_date: T(-3), amount: 15000 }, { label: 'งวดที่ 2', due_date: T(10), amount: 20000 }, { label: 'ยอดคงเหลือ', due_date: T(23), amount: Math.round((gt - 35000) * 100) / 100 }] });
  // 6) ถ่ายเสร็จ รอส่ง (ส่งงานเลยกำหนด) + ค่าล่วงเวลา
  await create('prod', M, { customer_id: cu[5].id, couple_names: 'คุณปราง & คุณเก่ง', package_id: pk[1].id, status: 'confirmed',
    sessions: [sess({ date: T(-20), crew: [crewOf(0), crewOf(1)] })], payments: [{ kind: 'payment', method: 'cash', amount: 10000 }] });
  await pay(M, B.prod, 5000, { paid_on: T(-25), method: 'transfer' });
  B.prod = await M.rpc('wed_mark_shot', { p_booking_id: B.prod.id, p_force: true });
  await M.rpc('wed_add_charge', { p_client_id: id(), p_booking_id: B.prod.id, p_kind: 'overtime', p_description: 'ล่วงเวลา 2 ชม.', p_amount: 3000 });
  B.prod = await get('prod');
  {
    const dl = B.prod.deliverables || [];
    if (dl[0]) await M.rpc('wed_save_deliverable', { p_booking_id: B.prod.id, p_item: { id: dl[0].id, due_date: T(-2), status: 'editing', editor_crew_id: cr[4].id, note: 'เลือกภาพแล้ว 300 ภาพ' } });
    if (dl[1]) await M.rpc('wed_save_deliverable', { p_booking_id: B.prod.id, p_item: { id: dl[1].id, status: 'review', link_url: 'https://drive.example/highlight-draft' } });
  }
  // 7) ส่งงานแล้ว
  await create('deliv', M, { customer_id: cu[6].id, couple_names: 'คุณใบเฟิร์น & คุณปอนด์', package_id: pk[2].id, status: 'confirmed', sessions: [sess({ session_type: 'prewedding', title: 'พรีเวดดิ้งเขาใหญ่', date: T(-40), crew: [crewOf(0)] })] });
  await pay(M, B.deliv, 6000, { paid_on: T(-45) });
  await M.rpc('wed_mark_shot', { p_booking_id: B.deliv.id, p_force: true });
  B.deliv = await get('deliv');
  for (const d of B.deliv.deliverables || []) await M.rpc('wed_save_deliverable', { p_booking_id: B.deliv.id, p_item: { id: d.id, status: 'delivered', link_url: 'https://drive.example/prewedding-final' } });
  // 8) ปิดงาน (จ่ายครบ + ส่งครบ)
  await create('done', M, { customer_id: cu[0].id, couple_names: 'คุณมิ้นท์ & คุณกัน', package_id: pk[2].id, status: 'confirmed', sessions: [sess({ session_type: 'prewedding', title: 'พรีเวดดิ้งคาเฟ่', date: T(-60) })] });
  await M.rpc('wed_mark_shot', { p_booking_id: B.done.id, p_force: true });
  B.done = await get('done');
  for (const d of B.done.deliverables || []) await M.rpc('wed_save_deliverable', { p_booking_id: B.done.id, p_item: { id: d.id, status: 'delivered', link_url: 'https://drive.example/cafe-final' } });
  B.done = await get('done');
  await pay(M, B.done, Number(B.done.money.due), { paid_on: T(-50), method: 'transfer', purpose: 'balance' });
  B.done = await M.rpc('wed_complete', { p_booking_id: B.done.id });
  // 9) เลื่อน
  await create('postp', U.wmgr, { customer_id: cu[1].id, couple_names: 'คุณฝ้าย & คุณเต้', package_id: pk[1].id, status: 'confirmed', sessions: [sess({ date: T(25) })], payments: [{ kind: 'payment', method: 'transfer', amount: 7500 }] });
  B.postp = await U.wmgr.rpc('wed_postpone', { p_booking_id: B.postp.id, p_reason: 'ฝ่ายเจ้าสาวขอเลื่อน รอฤกษ์ใหม่' });
  // 10) ยกเลิก (คืนเงินบางส่วน)
  await create('canc', U.wmgr, { customer_id: cu[2].id, couple_names: 'คุณแนน & คุณบิ๊ก', package_id: pk[1].id, status: 'confirmed', sessions: [sess({ date: T(9) })], payments: [{ kind: 'payment', method: 'cash', amount: 7500 }] });
  B.canc = await U.wmgr.rpc('wed_cancel', { p_booking_id: B.canc.id, p_reason: 'ลูกค้ายกเลิกงาน' });
  await pay(U.wmgr, B.canc, 2500, { kind: 'refund', method: 'transfer', note: 'คืนส่วนเกินมัดจำ' });
  // 11) ยืนยันแล้ว เดือนหน้า ไม่มีมัดจำ (บังคับยืนยัน)
  await create('conf2', U.wmgr, { customer_id: cu[3].id, couple_names: 'คุณข้าวหอม & คุณภู', package_id: pk[0].id, status: 'confirmed', sessions: [sess({ date: T(40), crew: [crewOf(1), crewOf(4)] })] });

  for (const k of Object.keys(B)) await get(k);
  const tokens = Object.fromEntries(Object.entries(B).map(([k, b]) => [k, b.public_token]));
  const summary = Object.fromEntries(Object.entries(B).map(([k, b]) => [k, `${b.booking_no} ${b.status}`]));
  return { users: U, today, bookings: B, tokens, summary, customers: cu, crew: cr, packages: pk, addons: ad, capDay };
}
