-- =========================================================================
-- supabase-fix-07-wedding.sql — ร้านที่ 3 "b.oncloud.wedding content" (ทีมรับถ่ายคอนเทนต์งานแต่ง)
--                               ปฏิทินงาน, การจอง/งาน, คิวงานหลายช่วง, ทีมงาน, แพ็กเกจ, รับเงินเป็นงวด,
--                               ค่าใช้จ่ายเพิ่ม, งานตัดต่อ/ส่งงาน, รายงาน, ลิงก์ติดตามงานของคู่บ่าวสาว
--
-- ไฟล์นี้ทำอะไร
--   1) สิทธิ์ใหม่ "wedding" (งาน/ปฏิทิน/รับเงิน) และ "wedding_manage" (แพ็กเกจ/ทีม/ตั้งค่า/รายงาน)
--      — wedding_manage ทำได้ทุกอย่างที่ wedding ทำได้; แอดมินทำได้ทุกอย่าง
--      — is_member() (พนักงานร้าน NEWCUTE) ไม่นับ 2 สิทธิ์นี้ และไฟล์นี้ไม่สร้าง is_member() ใหม่เลย
--        (พนักงาน b.oncloud อย่างเดียวอ่านยอดขาย/สต๊อก NEWCUTE หรือข้อมูลร้านเช่าชุดไม่ได้)
--   2) ตารางใหม่ 14 ตาราง (ทั้งหมดเปิด RLS + ให้สิทธิ์แบบระบุชัด — Supabase เลิกให้สิทธิ์ตารางใหม่อัตโนมัติตั้งแต่ 30 ต.ค. 2026)
--        wed_settings        ข้อมูลร้าน/การรับเงิน/นโยบาย/เงื่อนไขสัญญา (1 แถว — ชื่อร้านอ่านจากที่นี่เสมอ)
--        wed_packages        แพ็กเกจ (ราคา, ชั่วโมง, จำนวนทีม, รายการงานที่ส่ง)
--        wed_addons          บริการเสริม
--        wed_customers       ลูกค้า (คู่บ่าวสาว + ช่องทางที่รู้จักร้าน)
--        wed_crew            ทีมงาน (ค่าตัวเริ่มต้น = ข้อมูลผู้จัดการเท่านั้น)
--        wed_bookings        การจอง/งาน WD-YYYYMMDD-NNN (ยอดเงินทุกช่องคำนวณที่ฐานข้อมูลเท่านั้น)
--        wed_sessions        คิวงานของการจอง (หมั้น/พิธีเช้า/งานเลี้ยง/พรีเวดดิ้ง) + กำหนดการ
--        wed_session_crew    ทีมที่ลงคิว + ค่าตัว (ผู้จัดการเท่านั้น)
--        wed_booking_addons  บริการเสริมในการจอง
--        wed_charges         ค่าใช้จ่ายเพิ่ม (ล่วงเวลา/เดินทาง/อื่นๆ — ไม่ลบ ยกเลิกพร้อมเหตุผล)
--        wed_payments        รับเงิน/คืนเงิน ใบเสร็จ WR-YYYYMMDD-NNN (ไม่ลบ ยกเลิกพร้อมเหตุผล)
--        wed_installments    งวดชำระ
--        wed_deliverables    งานที่ต้องส่ง (ตัดต่อ/ส่งลิงก์)
--        wed_logs            ประวัติทุกการเปลี่ยนแปลงของงาน
--   3) ค่าตัวทีมงาน/ต้นทุน/กำไร เห็นเฉพาะผู้จัดการ: ตาราง wed_crew และ wed_session_crew อ่านตรงได้เฉพาะผู้จัดการ
--      พนักงานเห็นชื่อทีม/คิวผ่านฟังก์ชัน (JSON ไม่มีค่าตัว) — ตารางที่พนักงานอ่านได้ไม่มีช่องค่าตัวเลย
--   4) ถังไฟล์: wedding-public (โลโก้ร้าน — ดูได้ทุกคน, อัปโหลดเฉพาะผู้จัดการ) /
--               wedding-files (สลิปโอนเงิน — ส่วนตัว พนักงานเท่านั้น)
--   5) ฟังก์ชันของหน้าจอ wed_* (ดูรายการในหัวข้อ 15) + ลิงก์ติดตามงานของลูกค้า wed_public_booking (ไม่ต้องล็อกอิน)
--
-- วิธีใช้: Supabase > SQL Editor > วางทั้งไฟล์ > กด Run
--   - ต้องรัน supabase-fix-01 → 02 → 03 → 04 → 05 มาก่อนแล้ว (ไฟล์นี้ตรวจให้ ถ้ายังไม่ได้รันจะหยุดทันทีโดยไม่แก้อะไร)
--   - รันซ้ำได้ปลอดภัย ไม่ทำให้ข้อมูลเสีย (ทั้งไฟล์สำเร็จทั้งหมดหรือไม่เปลี่ยนอะไรเลย)
--   - รันไฟล์ fix ก่อนหน้าซ้ำทีหลังได้ ไม่กระทบ b.oncloud
--   - รันเสร็จแล้ว SQL Editor จะแสดงตารางสรุป — ดูหัวข้อ "ตรวจสอบหลังรัน" ท้ายไฟล์
-- =========================================================================

begin;

-- =========================================================================
-- 0) ตรวจของที่ต้องมีก่อน (fix-04: ตัวนับเลขเอกสาร/ชื่อผู้ทำรายการ/วันไทย, fix-05: ร้านเช่าชุด, fix-02: ตัวช่วยอ่าน JSON)
-- =========================================================================
do $$
begin
  if to_regprocedure('public.has_perm(text)') is null
     or to_regprocedure('public.is_admin()') is null
     or to_regprocedure('public.is_member()') is null
     or to_regprocedure('public.product_clean_text(text)') is null
     or to_regprocedure('public.product_json_text(jsonb, text)') is null
     or to_regprocedure('public.product_json_num(jsonb, text)') is null
     or to_regprocedure('public.product_json_uuid(jsonb, text)') is null
     or to_regprocedure('public.product_json_bool(jsonb, text)') is null
     or to_regprocedure('public.pos_actor_name(uuid)') is null
     or to_regprocedure('public.pos_bkk_today()') is null
     or to_regprocedure('public.pos_bkk_day(timestamptz)') is null
     or to_regprocedure('public.pos_day_bounds(date)') is null
     or to_regprocedure('public.pos_check_range(date, date)') is null
     or to_regprocedure('public.pos_check_page(integer, integer)') is null
     or to_regclass('public.doc_counters') is null
     or to_regprocedure('public.rental_staff()') is null then
    raise exception 'ต้องรัน supabase-fix-01.sql ถึง supabase-fix-05-rental.sql ให้เสร็จก่อน แล้วค่อยรันไฟล์นี้ (ยังไม่ได้แก้อะไรในฐานข้อมูล)';
  end if;
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception 'ไม่พบระบบ Storage ของ Supabase (storage.buckets / storage.objects) — ยังไม่ได้แก้อะไรในฐานข้อมูล';
  end if;
end
$$;

-- =========================================================================
-- 1) สิทธิ์ (has_perm นับแอดมินให้แล้ว) — ใช้ใน RLS จึงให้ authenticated เรียกได้
-- =========================================================================
create or replace function public.wed_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_perm('wedding') or public.has_perm('wedding_manage')
$$;

create or replace function public.wed_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_perm('wedding_manage')
$$;

revoke all on function public.wed_staff() from public, anon;
grant execute on function public.wed_staff() to authenticated;
revoke all on function public.wed_manager() from public, anon;
grant execute on function public.wed_manager() to authenticated;

-- =========================================================================
-- 2) ตาราง
-- =========================================================================

-- ----- ตั้งค่าร้าน (มีแถวเดียวเสมอ: id = true) -----
create table if not exists public.wed_settings (
  id boolean primary key default true check (id),
  shop_name text not null default 'b.oncloud.wedding content' check (char_length(shop_name) between 1 and 100),
  tagline text check (tagline is null or char_length(tagline) <= 200),
  phone text check (phone is null or char_length(phone) <= 50),
  line_id text check (line_id is null or char_length(line_id) <= 50),
  line_url text check (line_url is null or char_length(line_url) <= 300),
  instagram text check (instagram is null or char_length(instagram) <= 300),
  facebook text check (facebook is null or char_length(facebook) <= 300),
  tiktok text check (tiktok is null or char_length(tiktok) <= 300),
  email text check (email is null or char_length(email) <= 100),
  address text check (address is null or char_length(address) <= 500),
  logo_path text check (logo_path is null or logo_path ~ '^logo/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  promptpay_id text check (promptpay_id is null or promptpay_id ~ '^(0[0-9]{9}|[0-9]{13})$'),
  promptpay_name text check (promptpay_name is null or char_length(promptpay_name) <= 100),
  bank_accounts jsonb not null default '[]'::jsonb,  -- [{bank, account_no, account_name}] ไม่เกิน 5 บัญชี
  deposit_percent numeric(5, 2) not null default 30 check (deposit_percent between 0 and 100),
  min_deposit numeric(10, 2) not null default 0 check (min_deposit >= 0),
  balance_due_days integer not null default 7 check (balance_due_days between 0 and 365),
  hold_hours integer not null default 72 check (hold_hours between 1 and 720),
  max_jobs_per_day integer not null default 2 check (max_jobs_per_day between 0 and 50),   -- 0 = ไม่จำกัด
  overtime_rate numeric(10, 2) not null default 0 check (overtime_rate >= 0),              -- บาท/ชั่วโมง (หน้าจอใช้แนะนำค่าล่วงเวลา)
  terms_text text not null default '1. การจองคิวจะสมบูรณ์เมื่อผู้ว่าจ้างชำระเงินมัดจำตามที่ระบุในใบยืนยันการจองแล้ว และเงินมัดจำไม่สามารถขอคืนได้ทุกกรณี เนื่องจากทางทีมได้ปฏิเสธงานอื่นในวันดังกล่าวให้แล้ว
2. ผู้ว่าจ้างชำระเงินตามงวดที่ระบุในใบยืนยันการจอง และต้องชำระยอดคงเหลือทั้งหมดก่อนวันงานตามกำหนด หากยังไม่ชำระครบ ทีมขอสงวนสิทธิ์ในการส่งมอบไฟล์งานจนกว่าจะชำระครบ
3. ผู้ว่าจ้างเลื่อนวันงานได้ 1 ครั้ง ภายใน 6 เดือนนับจากวันงานเดิม โดยต้องแจ้งล่วงหน้าและขึ้นอยู่กับคิวว่างของทีม เงินที่ชำระแล้วจะยกไปใช้กับวันงานใหม่
4. การยกเลิกงานโดยผู้ว่าจ้างไม่ว่ากรณีใด ทีมขอสงวนสิทธิ์ไม่คืนเงินมัดจำ หากยกเลิกภายใน 30 วันก่อนวันงาน ทีมขอสงวนสิทธิ์ไม่คืนเงินที่ชำระแล้วทั้งหมด
5. ระยะเวลาส่งงานเป็นไปตามที่ระบุในแพ็กเกจ นับจากวันงานวันสุดท้าย ทีมจะส่งงานผ่านลิงก์ออนไลน์ให้ผู้ว่าจ้างดาวน์โหลด และเก็บไฟล์ไว้ให้ไม่น้อยกว่า 60 วันหลังส่งงาน
6. ไฟล์ดิบ (RAW) และไฟล์วิดีโอต้นฉบับไม่รวมอยู่ในแพ็กเกจ เว้นแต่ระบุไว้ในรายการบริการเสริม
7. ลิขสิทธิ์ภาพและวิดีโอเป็นของทีมผู้ให้บริการ ผู้ว่าจ้างใช้งานส่วนตัวได้ไม่จำกัด ทีมขอใช้ผลงานบางส่วนเป็นพอร์ตโฟลิโอและสื่อประชาสัมพันธ์ หากผู้ว่าจ้างไม่ประสงค์ให้เผยแพร่ กรุณาแจ้งเป็นลายลักษณ์อักษรก่อนวันงาน
8. งานนอกพื้นที่ให้บริการ ผู้ว่าจ้างรับผิดชอบค่าเดินทาง ค่าที่พัก และค่าใช้จ่ายของทีมงานตามจริงหรือตามที่ตกลงไว้
9. เวลาทำงานเป็นไปตามชั่วโมงของแพ็กเกจ หากทำงานเกินเวลาที่ตกลง คิดค่าล่วงเวลาตามอัตราที่ทีมกำหนด
10. กรณีเหตุสุดวิสัย เช่น ภัยธรรมชาติ โรคระบาด หรือคำสั่งของทางราชการ ทั้งสองฝ่ายจะตกลงเลื่อนวันงานร่วมกันโดยไม่มีค่าใช้จ่ายเพิ่ม
11. หากเกิดความเสียหายของอุปกรณ์หรือไฟล์งานจากเหตุที่ทีมควบคุมไม่ได้ ความรับผิดชอบของทีมจำกัดไม่เกินจำนวนเงินที่ผู้ว่าจ้างชำระแล้ว
12. ผู้ว่าจ้างต้องแจ้งกำหนดการ สถานที่ และผู้ประสานงานในวันงานให้ทีมทราบล่วงหน้าอย่างน้อย 7 วัน
13. ทีมเก็บข้อมูลส่วนบุคคลของผู้ว่าจ้าง (ชื่อ เบอร์โทร ช่องทางติดต่อ) เพื่อใช้ในการให้บริการและการติดต่อเท่านั้น ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562
14. ผู้ว่าจ้างได้อ่านและเข้าใจเงื่อนไขทั้งหมดแล้ว จึงลงลายมือชื่อไว้เป็นหลักฐาน',
  booking_note text check (booking_note is null or char_length(booking_note) <= 1000),
  receipt_footer text default 'ขอบคุณที่ไว้วางใจให้เราดูแลวันสำคัญของคุณ' check (receipt_footer is null or char_length(receipt_footer) <= 300),
  portal_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.wed_settings (id) values (true) on conflict (id) do nothing;

-- ----- แพ็กเกจ (ราคาอยู่ที่แพ็กเกจ; การจองจำค่า ณ ตอนจองไว้เอง — แก้แพ็กเกจทีหลังไม่กระทบงานเดิม) -----
create table if not exists public.wed_packages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid unique,
  name text not null check (char_length(name) between 1 and 100),
  description text check (description is null or char_length(description) <= 3000),
  price numeric(10, 2) not null default 0 check (price >= 0),
  hours numeric(4, 1) not null default 0 check (hours >= 0),
  crew_size integer not null default 0 check (crew_size between 0 and 20),
  deliverables jsonb not null default '[]'::jsonb,   -- [{name, qty, unit, due_days}] ไม่เกิน 30 รายการ
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----- บริการเสริม -----
create table if not exists public.wed_addons (
  id uuid primary key default gen_random_uuid(),
  client_id uuid unique,
  name text not null check (char_length(name) between 1 and 100),
  price numeric(10, 2) not null default 0 check (price >= 0),
  unit text check (unit is null or char_length(unit) <= 30),
  description text check (description is null or char_length(description) <= 1000),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----- ลูกค้า -----
create table if not exists public.wed_customers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid unique,
  name text not null check (char_length(name) between 1 and 100),
  partner_name text check (partner_name is null or char_length(partner_name) <= 100),
  phone text not null check (phone ~ '^[0-9]{9,15}$'),
  phone2 text check (phone2 is null or phone2 ~ '^[0-9]{9,15}$'),
  line_id text check (line_id is null or char_length(line_id) <= 50),
  instagram text check (instagram is null or char_length(instagram) <= 100),
  facebook text check (facebook is null or char_length(facebook) <= 200),
  email text check (email is null or char_length(email) <= 100),
  address text check (address is null or char_length(address) <= 500),
  source text not null default 'other'
    check (source in ('instagram', 'facebook', 'tiktok', 'line', 'referral', 'walkin', 'website', 'other')),
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_wed_customers_phone on public.wed_customers (phone);
create index if not exists idx_wed_customers_name on public.wed_customers (lower(name));

-- ----- ทีมงาน -----
create table if not exists public.wed_crew (
  id uuid primary key default gen_random_uuid(),
  client_id uuid unique,
  name text not null check (char_length(name) between 1 and 100),
  nickname text check (nickname is null or char_length(nickname) <= 50),
  role text not null default 'photo'
    check (role in ('photo', 'video', 'content', 'drone', 'assistant', 'editor', 'makeup', 'other')),
  phone text check (phone is null or phone ~ '^[0-9]{9,15}$'),
  line_id text check (line_id is null or char_length(line_id) <= 50),
  default_fee numeric(10, 2) not null default 0 check (default_fee >= 0),
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  is_active boolean not null default true,
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----- การจอง / งาน -----
create table if not exists public.wed_bookings (
  id uuid primary key default gen_random_uuid(),
  booking_no text not null unique,
  client_id uuid unique,
  client_payload_md5 text,                           -- ลายนิ้วมือข้อมูลตอนสร้าง (ส่งรหัสคำขอเดิมซ้ำ → payload_matches)
  public_token text unique,                          -- ลิงก์ติดตามงานของลูกค้า /wedding-status/<token> (64 ตัวอักษร)
  source text not null default 'other'
    check (source in ('instagram', 'facebook', 'tiktok', 'line', 'referral', 'walkin', 'website', 'other')),
  customer_id uuid not null references public.wed_customers (id) on delete restrict,
  couple_names text not null check (char_length(couple_names) between 1 and 120),
  status text not null default 'inquiry'
    check (status in ('inquiry', 'hold', 'confirmed', 'in_production', 'delivered', 'completed', 'postponed', 'cancelled')),
  status_before_postpone text check (status_before_postpone is null or status_before_postpone in ('hold', 'confirmed')),
  -- แพ็กเกจ ณ ตอนจอง (package_id = null → แพ็กเกจกำหนดเอง)
  package_id uuid references public.wed_packages (id) on delete set null,
  package_name text check (package_name is null or char_length(package_name) <= 100),
  package_price numeric(10, 2) not null default 0 check (package_price >= 0),
  package_hours numeric(4, 1) check (package_hours is null or package_hours >= 0),
  package_description text check (package_description is null or char_length(package_description) <= 3000),
  deliverables_plan jsonb not null default '[]'::jsonb,  -- [{name, qty, unit, due_days}] → สร้างรายการส่งงานตอนยืนยัน
  travel_fee numeric(10, 2) not null default 0 check (travel_fee >= 0),
  discount numeric(10, 2) not null default 0 check (discount >= 0),
  discount_note text check (discount_note is null or char_length(discount_note) <= 200),
  -- ยอดเงินที่คำนวณไว้ (เขียนโดย wed_recalc เท่านั้น — ไม่เชื่อตัวเลขจากเครื่องลูก; ไม่มีต้นทุนทีมงานในตารางนี้)
  addons_total numeric(10, 2) not null default 0,
  base_total numeric(10, 2) not null default 0,
  charges_total numeric(10, 2) not null default 0,
  grand_total numeric(10, 2) not null default 0,
  paid numeric(10, 2) not null default 0,
  due numeric(10, 2) not null default 0,
  deposit_required numeric(10, 2) not null default 0,
  deposit_met boolean not null default false,
  first_session_date date,
  last_session_date date,
  balance_due_date date,
  -- นโยบาย ณ ตอนจอง (แก้ตั้งค่าร้านทีหลังไม่กระทบงานเดิม)
  deposit_percent numeric(5, 2) check (deposit_percent is null or deposit_percent between 0 and 100),
  min_deposit numeric(10, 2) check (min_deposit is null or min_deposit >= 0),
  balance_due_days integer check (balance_due_days is null or balance_due_days between 0 and 365),
  balance_due_date_override date,                    -- กำหนดวันชำระยอดคงเหลือเอง (null = วันงานแรก − balance_due_days)
  installments_custom boolean not null default false,  -- true = บอสแก้งวดเอง (false = งวดมาตรฐานคำนวณใหม่ให้อัตโนมัติ)
  hold_until timestamptz,
  followup_date date,
  followup_note text check (followup_note is null or char_length(followup_note) <= 500),
  coordinator_name text check (coordinator_name is null or char_length(coordinator_name) <= 100),
  coordinator_phone text check (coordinator_phone is null or char_length(coordinator_phone) <= 50),
  mood_link text check (mood_link is null or (char_length(mood_link) <= 500 and mood_link ~* '^https?://[^[:space:]]+$')),
  customer_note text check (customer_note is null or char_length(customer_note) <= 2000),
  note text check (note is null or char_length(note) <= 2000),
  cancel_reason text,
  postpone_reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  shot_at timestamptz,
  delivered_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  postponed_at timestamptz
);
-- คอลัมน์ที่เพิ่มหลังรอบแรก (add column if not exists = รันซ้ำบนฐานที่เคยรันไฟล์รุ่นก่อนได้)
--   deposit_due_on: วันที่เริ่มนับงวดมัดจำ = วันที่งานเข้า "ล็อกคิว/ยืนยัน" จากสอบถาม
--     (งานสอบถามที่สร้างไว้หลายสัปดาห์แล้วเพิ่งล็อกคิว ต้องไม่ขึ้น "เลยกำหนด" ทันที) — null = นับจากวันที่สร้างงาน
--   deliverables_anchor_date: วันงานวันสุดท้ายที่ใช้คิดกำหนดส่งงานรอบล่าสุด (wed_recalc ดูแล)
--     วันงานเปลี่ยน (เลื่อนงาน/แก้วัน) → เลื่อนกำหนดส่งของรายการที่ยังไม่ส่งไปตามจำนวนวันที่ต่าง
alter table public.wed_bookings add column if not exists deposit_due_on date;
alter table public.wed_bookings add column if not exists deliverables_anchor_date date;
create index if not exists idx_wed_bookings_status on public.wed_bookings (status);
create index if not exists idx_wed_bookings_customer on public.wed_bookings (customer_id);
create index if not exists idx_wed_bookings_package on public.wed_bookings (package_id);
create index if not exists idx_wed_bookings_first_date on public.wed_bookings (first_session_date);
create index if not exists idx_wed_bookings_followup on public.wed_bookings (followup_date) where followup_date is not null;

-- ----- คิวงานของการจอง -----
create table if not exists public.wed_sessions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.wed_bookings (id) on delete cascade,
  session_type text not null default 'reception'
    check (session_type in ('engagement', 'ceremony', 'reception', 'prewedding', 'other')),
  title text check (title is null or char_length(title) <= 120),
  date date,
  start_time time,
  end_time time,
  call_time time,                                    -- เวลาทีมถึงงาน (ไม่ช้ากว่าเวลาเริ่ม)
  venue_name text check (venue_name is null or char_length(venue_name) <= 150),
  venue_address text check (venue_address is null or char_length(venue_address) <= 500),
  map_url text check (map_url is null or (char_length(map_url) <= 500 and map_url ~* '^https?://[^[:space:]]+$')),
  venue_contact text check (venue_contact is null or char_length(venue_contact) <= 150),
  dress_code text check (dress_code is null or char_length(dress_code) <= 2000),
  notes text check (notes is null or char_length(notes) <= 2000),
  run_sheet jsonb not null default '[]'::jsonb,      -- [{time:'HH:MM'|null, text}] ไม่เกิน 40 แถว (ฤกษ์/กำหนดการ)
  status text not null default 'scheduled' check (status in ('scheduled', 'done', 'cancelled')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint wed_sessions_time_chk check (end_time is null or start_time is null or end_time > start_time),
  constraint wed_sessions_call_chk check (call_time is null or start_time is null or call_time <= start_time)
);
create index if not exists idx_wed_sessions_booking on public.wed_sessions (booking_id, sort_order);
create index if not exists idx_wed_sessions_date on public.wed_sessions (date);

-- ----- ทีมที่ลงคิว (ค่าตัว = ต้นทุน: ตารางนี้อ่านตรงได้เฉพาะผู้จัดการ) -----
create table if not exists public.wed_session_crew (
  session_id uuid not null references public.wed_sessions (id) on delete cascade,
  crew_id uuid not null references public.wed_crew (id) on delete restrict,
  role text not null default 'photo'
    check (role in ('photo', 'video', 'content', 'drone', 'assistant', 'editor', 'makeup', 'other')),
  fee numeric(10, 2) not null default 0 check (fee >= 0),
  fee_paid_on date,
  note text check (note is null or char_length(note) <= 300),
  primary key (session_id, crew_id)
);
create index if not exists idx_wed_session_crew_crew on public.wed_session_crew (crew_id);

-- ----- บริการเสริมในการจอง (ชื่อ/ราคา ณ ตอนจอง) -----
create table if not exists public.wed_booking_addons (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.wed_bookings (id) on delete cascade,
  addon_id uuid references public.wed_addons (id) on delete set null,
  name text not null check (char_length(name) between 1 and 100),
  unit text check (unit is null or char_length(unit) <= 30),
  qty numeric(8, 2) not null default 1 check (qty > 0 and qty <= 9999),
  unit_price numeric(10, 2) not null default 0 check (unit_price >= 0),
  amount numeric(10, 2) not null default 0 check (amount >= 0),
  sort_order integer not null default 0
);
create index if not exists idx_wed_booking_addons_booking on public.wed_booking_addons (booking_id);
create index if not exists idx_wed_booking_addons_addon on public.wed_booking_addons (addon_id);

-- ----- ค่าใช้จ่ายเพิ่ม (ไม่ลบ — ยกเลิกพร้อมเหตุผล) -----
create table if not exists public.wed_charges (
  id uuid primary key default gen_random_uuid(),
  client_id uuid unique,
  booking_id uuid not null references public.wed_bookings (id) on delete cascade,
  kind text not null check (kind in ('overtime', 'travel', 'extra', 'other')),
  description text not null check (char_length(description) between 1 and 200),
  amount numeric(10, 2) not null check (amount > 0),
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_wed_charges_booking on public.wed_charges (booking_id);

-- ----- รับเงิน / คืนเงิน (ไม่ลบ — ยกเลิกพร้อมเหตุผล) -----
create table if not exists public.wed_payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid unique,                             -- สุ่มจากเครื่องตอนเปิดหน้ารับเงิน — กดซ้ำ/เน็ตหลุดไม่บันทึกซ้ำ
  booking_id uuid not null references public.wed_bookings (id) on delete restrict,
  receipt_no text not null unique,
  kind text not null check (kind in ('payment', 'refund')),
  method text not null check (method in ('cash', 'transfer', 'promptpay', 'credit')),
  amount numeric(10, 2) not null check (amount > 0),
  paid_on date not null,                             -- วันที่เงินเข้า/ออกจริง (รายงานรายรับใช้วันนี้)
  purpose text check (purpose is null or purpose in ('deposit', 'installment', 'balance', 'extra', 'other')),
  slip_path text check (slip_path is null or char_length(slip_path) <= 200),
  note text check (note is null or char_length(note) <= 300),
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_wed_payments_booking on public.wed_payments (booking_id);
create index if not exists idx_wed_payments_paid_on on public.wed_payments (paid_on);

-- ----- งวดชำระ -----
create table if not exists public.wed_installments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.wed_bookings (id) on delete cascade,
  seq integer not null check (seq between 1 and 50),
  label text not null check (char_length(label) between 1 and 60),
  due_date date,
  amount numeric(10, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (booking_id, seq)
);
create index if not exists idx_wed_installments_due on public.wed_installments (due_date);

-- ----- งานที่ต้องส่ง -----
create table if not exists public.wed_deliverables (
  id uuid primary key default gen_random_uuid(),
  client_id uuid unique,
  booking_id uuid not null references public.wed_bookings (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  qty integer not null default 1 check (qty between 1 and 100000),
  unit text check (unit is null or char_length(unit) <= 30),
  due_date date,
  status text not null default 'pending' check (status in ('pending', 'editing', 'review', 'delivered')),
  link_url text check (link_url is null or (char_length(link_url) <= 1000 and link_url ~* '^https?://[^[:space:]]+$')),
  note text check (note is null or char_length(note) <= 1000),
  editor_crew_id uuid references public.wed_crew (id) on delete set null,
  delivered_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_wed_deliverables_booking on public.wed_deliverables (booking_id, sort_order);
create index if not exists idx_wed_deliverables_due on public.wed_deliverables (due_date);
create index if not exists idx_wed_deliverables_editor on public.wed_deliverables (editor_crew_id);

-- ----- ประวัติงาน -----
create table if not exists public.wed_logs (
  id bigserial primary key,
  booking_id uuid not null references public.wed_bookings (id) on delete cascade,
  action text not null,
  detail jsonb,
  actor uuid,
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_wed_logs_booking on public.wed_logs (booking_id, id);

-- ----- updated_at = เวอร์ชันของแถว (ต้องมากขึ้นเสมอ แม้แก้สองครั้งในเสี้ยววินาทีเดียวกัน) -----
create or replace function public.wed_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := greatest(now(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['wed_packages', 'wed_addons', 'wed_customers', 'wed_crew', 'wed_bookings', 'wed_deliverables']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.wed_touch()',
                   t || '_touch', t);
  end loop;
end
$$;

-- ----- RLS + สิทธิ์ตาราง: อ่านได้เฉพาะพนักงาน b.oncloud / ทีมงาน+ค่าตัว อ่านได้เฉพาะผู้จัดการ /
--       เขียนผ่านฟังก์ชันเท่านั้น / anon อ่านไม่ได้เลย (ลิงก์ลูกค้าใช้ฟังก์ชัน wed_public_booking) -----
do $$
declare
  t text;
begin
  foreach t in array array['wed_settings', 'wed_packages', 'wed_addons', 'wed_customers', 'wed_crew', 'wed_bookings',
                           'wed_sessions', 'wed_session_crew', 'wed_booking_addons', 'wed_charges', 'wed_payments',
                           'wed_installments', 'wed_deliverables', 'wed_logs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.%s()))',
                   t || '_select', t,
                   case when t in ('wed_crew', 'wed_session_crew') then 'wed_manager' else 'wed_staff' end);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end
$$;

revoke all on sequence public.wed_logs_id_seq from anon, authenticated;
grant usage, select on sequence public.wed_logs_id_seq to service_role;

-- =========================================================================
-- 3) ตัวช่วยภายใน (เรียกจาก API ไม่ได้)
-- =========================================================================

-- ผู้ใช้ที่ล็อกอิน + สิทธิ์ b.oncloud (p_manager = ต้องเป็นผู้จัดการ) → uid
create or replace function public.wed_require(p_manager boolean)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่' using errcode = '42501';
  end if;
  if p_manager then
    if not public.wed_manager() then
      raise exception 'เฉพาะผู้จัดการ b.oncloud เท่านั้น' using errcode = '42501';
    end if;
  elsif not public.wed_staff() then
    raise exception 'ไม่มีสิทธิ์ใช้งานระบบ b.oncloud' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create or replace function public.wed_settings_row()
returns public.wed_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.wed_settings;
begin
  select x.* into s from public.wed_settings as x where x.id;
  if not found then
    insert into public.wed_settings as x (id) values (true) on conflict (id) do nothing;
    select x.* into s from public.wed_settings as x where x.id;
  end if;
  return s;
end;
$$;

-- สถานะที่ "กันคิว" (นับจำนวนงานต่อวัน + ตรวจทีมงานชนคิว): ล็อกคิว / ยืนยัน / ถ่ายเสร็จ / ส่งงาน / ปิดงาน
create or replace function public.wed_counting(p_status text)
returns boolean
language sql
immutable
security definer
set search_path = public
as $$
  select coalesce(p_status in ('hold', 'confirmed', 'in_production', 'delivered', 'completed'), false)
$$;

-- ค่าตัวทีมงานแถวนี้นับเป็น "ต้นทุน/ยอดที่ต้องจ่าย" หรือไม่ (ค่าตัวที่จ่ายทีมงาน / รายงาน / ส่งออก / ตารางงานทีม ใช้กฎเดียวกัน)
--   จ่ายแล้ว = นับเสมอ ไม่ว่างาน/คิวจะเป็นสถานะใด (เงินออกไปแล้วจริง ต้องอยู่ในบัญชี)
--   ยังไม่จ่าย = คิวไม่ยกเลิก และ (งานกันคิว หรือ งานที่ยกเลิกหลังถ่ายเสร็จแล้ว — ทีมทำงานไปแล้ว ยังต้องจ่าย)
create or replace function public.wed_crew_fee_counts(p_booking_status text, p_shot_at timestamptz,
                                                      p_session_status text, p_fee_paid_on date)
returns boolean
language sql
immutable
security definer
set search_path = public
as $$
  select p_fee_paid_on is not null
         or (coalesce(p_session_status, '') <> 'cancelled'
             and (public.wed_counting(p_booking_status) or (p_booking_status = 'cancelled' and p_shot_at is not null)))
$$;

-- วันครบกำหนดงวดมัดจำ = วันที่สร้างงาน หรือวันที่งานเข้า "ล็อกคิว/ยืนยัน" (ที่ช้ากว่า) / ยังไม่มีงาน (ดูราคาล่วงหน้า) = วันนี้
create or replace function public.wed_deposit_day(p_created_at timestamptz, p_deposit_due_on date)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(greatest(public.pos_bkk_day(p_created_at), p_deposit_due_on), public.pos_bkk_today())
$$;

-- เพิ่ม/ยกเลิกค่าใช้จ่ายเพิ่มได้: ยืนยันแล้ว → ส่งงานแล้ว + งานที่ยืนยันแล้วถูกเลื่อน (เช่น ค่าเลื่อนวันงาน ต้องอยู่ในยอดที่แจ้งลูกค้าตอนเลื่อน)
create or replace function public.wed_charges_open(p_status text, p_status_before_postpone text)
returns boolean
language sql
immutable
security definer
set search_path = public
as $$
  select coalesce(p_status in ('confirmed', 'in_production', 'delivered')
                  or (p_status = 'postponed' and p_status_before_postpone = 'confirmed'), false)
$$;

-- ลายนิ้วมือคำขอสร้าง/แก้ไขงาน (รหัสคำขอ client_id) = ข้อมูลที่ส่งโดยไม่นับธง force
--   force = แค่ "รับทราบคำเตือนแล้ว" ไม่ใช่ข้อมูลงาน: ส่งครั้งแรกบันทึกแล้วแต่คำตอบหาย → ส่งซ้ำพร้อม force ต้องได้ "ข้อมูลชุดเดิม"
--   (ไม่ใช่ "ฟอร์มถูกแก้หลังส่ง" ที่ชวนให้สร้างงาน/มัดจำซ้ำ) / ไม่ใช่ object (null/อื่นๆ) = ใช้ตามเดิม
create or replace function public.wed_payload_md5(p_payload jsonb)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select md5((case when jsonb_typeof(p_payload) = 'object' then p_payload - 'force'
                   else coalesce(p_payload, 'null'::jsonb) end)::text)
$$;

-- ----- ข้อความเงิน/วันที่/เวลาในข้อความแจ้งเตือน (วันที่แบบไทย พ.ศ.) -----
create or replace function public.wed_baht(p numeric)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case when coalesce(p, 0) < 0 then '-฿' || to_char(-p, 'FM99,999,999,990.00')
              else '฿' || to_char(coalesce(p, 0), 'FM99,999,999,990.00') end
$$;

create or replace function public.wed_thai_date(p date)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case when p is null then '-'
              else to_char(p, 'DD/MM/') || (extract(year from p)::integer + 543)::text end
$$;

-- เวลาแบบ 'HH:MM' (JSON ส่งเวลาเป็นข้อความนี้เสมอ — หน้าจอไม่ต้องตัดวินาทีเอง)
create or replace function public.wed_hhmm(p time)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case when p is null then null else to_char(p, 'HH24:MI') end
$$;

-- ช่วงเวลาที่ "ทีมติดงาน" ของคิว: เริ่ม = เวลาถึงงาน (ถ้ามี) หรือเวลาเริ่ม / ไม่มีเวลา = ทั้งวัน
create or replace function public.wed_busy_text(p_start time, p_end time, p_call time)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case
           when coalesce(p_call, p_start) is null and p_end is null then 'ทั้งวัน'
           when p_end is null then 'ตั้งแต่ ' || to_char(coalesce(p_call, p_start), 'HH24:MI') || ' น.'
           when coalesce(p_call, p_start) is null then 'ถึง ' || to_char(p_end, 'HH24:MI') || ' น.'
           else to_char(coalesce(p_call, p_start), 'HH24:MI') || '–' || to_char(p_end, 'HH24:MI') || ' น.'
         end
$$;

create or replace function public.wed_status_label(p_status text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case p_status
           when 'inquiry' then 'สอบถาม'
           when 'hold' then 'ล็อกคิว รอมัดจำ'
           when 'confirmed' then 'ยืนยันแล้ว'
           when 'in_production' then 'ถ่ายเสร็จ รอส่งงาน'
           when 'delivered' then 'ส่งงานแล้ว'
           when 'completed' then 'ปิดงาน'
           when 'postponed' then 'เลื่อนงาน'
           when 'cancelled' then 'ยกเลิก'
           else coalesce(p_status, '-')
         end
$$;

create or replace function public.wed_type_label(p_type text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case p_type
           when 'engagement' then 'หมั้น/สู่ขอ'
           when 'ceremony' then 'พิธีเช้า'
           when 'reception' then 'งานเลี้ยง'
           when 'prewedding' then 'พรีเวดดิ้ง'
           when 'other' then 'อื่นๆ'
           else coalesce(p_type, '-')
         end
$$;

create or replace function public.wed_role_label(p_role text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case p_role
           when 'photo' then 'ช่างภาพ'
           when 'video' then 'วิดีโอ'
           when 'content' then 'คอนเทนต์'
           when 'drone' then 'โดรน'
           when 'assistant' then 'ผู้ช่วย'
           when 'editor' then 'ตัดต่อ'
           when 'makeup' then 'แต่งหน้า'
           when 'other' then 'อื่นๆ'
           else coalesce(p_role, '-')
         end
$$;

create or replace function public.wed_deliverable_label(p_status text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case p_status
           when 'pending' then 'รอตัด'
           when 'editing' then 'กำลังตัด'
           when 'review' then 'รอตรวจ'
           when 'delivered' then 'ส่งแล้ว'
           else coalesce(p_status, '-')
         end
$$;

create or replace function public.wed_source_label(p_source text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case p_source
           when 'instagram' then 'Instagram'
           when 'facebook' then 'Facebook'
           when 'tiktok' then 'TikTok'
           when 'line' then 'LINE'
           when 'referral' then 'แนะนำต่อ'
           when 'walkin' then 'ติดต่อหน้าร้าน'
           when 'website' then 'เว็บไซต์'
           when 'other' then 'อื่นๆ'
           else coalesce(p_source, '-')
         end
$$;

create or replace function public.wed_method_label(p_method text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case p_method
           when 'cash' then 'เงินสด'
           when 'transfer' then 'โอนเงิน'
           when 'promptpay' then 'พร้อมเพย์'
           when 'credit' then 'บัตรเครดิต'
           else coalesce(p_method, '-')
         end
$$;

create or replace function public.wed_kind_label(p_kind text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case p_kind when 'payment' then 'รับชำระ' when 'refund' then 'คืนเงิน' else coalesce(p_kind, '-') end
$$;

create or replace function public.wed_purpose_label(p_purpose text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case p_purpose
           when 'deposit' then 'มัดจำ'
           when 'installment' then 'ชำระงวด'
           when 'balance' then 'ยอดคงเหลือ'
           when 'extra' then 'ค่าใช้จ่ายเพิ่ม'
           when 'other' then 'อื่นๆ'
           else null
         end
$$;

create or replace function public.wed_charge_label(p_kind text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case p_kind
           when 'overtime' then 'ค่าล่วงเวลา'
           when 'travel' then 'ค่าเดินทาง'
           when 'extra' then 'ค่าบริการเพิ่ม'
           when 'other' then 'อื่นๆ'
           else coalesce(p_kind, '-')
         end
$$;

-- ชื่อแบบปิดบางส่วน: 'มิว ใจดี' → 'มิ*** ใ.' / เบอร์ '0812345678' → '08xxxx5678' (ลิงก์ลูกค้าหลุด คนอื่นไม่เห็นข้อมูลเต็ม)
create or replace function public.wed_mask_name(p_name text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select coalesce((
    select string_agg(case when w.ord = 1
                           then left(w.word, case when char_length(w.word) <= 2 then 1 else 2 end) || '***'
                           else left(w.word, 1) || '.' end, ' ' order by w.ord)
      from regexp_split_to_table(btrim(coalesce(p_name, '')), '[[:space:]]+') with ordinality as w(word, ord)
     where w.ord <= 2 and w.word <> ''), '-')
$$;

create or replace function public.wed_mask_phone(p_phone text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case
           when p_phone is null or p_phone = '' then null
           when char_length(p_phone) <= 6 then repeat('x', char_length(p_phone))
           else left(p_phone, 2) || repeat('x', char_length(p_phone) - 6) || right(p_phone, 4)
         end
$$;

-- ----- อ่านค่าจาก JSON (ตามแบบ product_json_* ของ fix-02) — ข้อความ error เป็นภาษาไทยบอกชื่อช่อง -----
create or replace function public.wed_json_text(p_value jsonb, p_label text, p_max integer)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v text;
begin
  v := public.product_json_text(p_value, p_label);
  if v is not null and char_length(v) > p_max then
    raise exception '%ยาวเกินไป (สูงสุด % ตัวอักษร)', p_label, p_max;
  end if;
  return v;
end;
$$;

-- ข้อความยาวหลายบรรทัด (เก็บการขึ้นบรรทัดไว้ ตัดแค่ช่องว่างหัวท้าย)
create or replace function public.wed_json_longtext(p_value jsonb, p_label text, p_max integer)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'string' then
    raise exception '%ไม่ถูกต้อง', p_label;
  end if;
  v := nullif(public.product_clean_text(p_value #>> '{}'), '');
  if v is not null and char_length(v) > p_max then
    raise exception '%ยาวเกินไป (สูงสุด % ตัวอักษร)', p_label, p_max;
  end if;
  return v;
end;
$$;

create or replace function public.wed_json_int(p_value jsonb, p_label text, p_min integer, p_max integer)
returns integer
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v numeric;
begin
  v := public.product_json_num(p_value, p_label);
  if v is null then
    return null;
  end if;
  if v <> trunc(v) or v < p_min or v > p_max then
    raise exception '%ต้องเป็นจำนวนเต็ม % ถึง %', p_label, p_min, p_max;
  end if;
  return v::integer;
end;
$$;

create or replace function public.wed_json_date(p_value jsonb, p_label text)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'string' then
    raise exception '%ไม่ถูกต้อง', p_label;
  end if;
  v := public.product_clean_text(p_value #>> '{}');
  if v = '' then
    return null;
  end if;
  if v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception '%ไม่ถูกต้อง', p_label;
  end if;
  begin
    return v::date;
  exception when others then
    raise exception '%ไม่ถูกต้อง', p_label;
  end;
end;
$$;

-- เวลา 'HH:MM' (หรือ 'HH:MM:SS') 00:00–23:59
create or replace function public.wed_json_time(p_value jsonb, p_label text)
returns time
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'string' then
    raise exception '%ไม่ถูกต้อง', p_label;
  end if;
  v := public.product_clean_text(p_value #>> '{}');
  if v = '' then
    return null;
  end if;
  if v !~ '^([01][0-9]|2[0-3])[:.][0-5][0-9](:[0-5][0-9])?$' then
    raise exception '%ต้องเป็นเวลาแบบ ชั่วโมง:นาที (เช่น 09:30)', p_label;
  end if;
  return replace(v, '.', ':')::time;
end;
$$;

-- ลิงก์ http/https เท่านั้น (กันลิงก์ javascript:/data: ที่หน้าเว็บเปิดแล้วอันตราย)
create or replace function public.wed_json_url(p_value jsonb, p_label text, p_max integer)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v text;
begin
  v := public.wed_json_text(p_value, p_label, p_max);
  if v is not null and v !~* '^https?://[^[:space:]]+$' then
    raise exception '% ต้องขึ้นต้นด้วย http:// หรือ https://', p_label;
  end if;
  return v;
end;
$$;

-- เงิน: ไม่ติดลบ, ทศนิยมไม่เกิน 2 ตำแหน่ง, ไม่เกิน 99,999,999.99 (p_allow_zero = false → ต้องมากกว่า 0)
create or replace function public.wed_check_money(p_value numeric, p_label text, p_allow_zero boolean)
returns numeric
language plpgsql
immutable
security definer
set search_path = public
as $$
begin
  if p_value is null then
    raise exception 'กรุณาใส่%', p_label;
  end if;
  if p_value <> round(p_value, 2) then
    raise exception '%ใส่ทศนิยมได้ไม่เกิน 2 ตำแหน่ง', p_label;
  end if;
  if p_value < 0 then
    raise exception '%ต้องไม่ติดลบ', p_label;
  end if;
  if p_value = 0 and not p_allow_zero then
    raise exception '%ต้องมากกว่า 0', p_label;
  end if;
  if p_value > 99999999.99 then
    raise exception '%สูงเกินไป (สูงสุด 99,999,999.99)', p_label;
  end if;
  return p_value;
end;
$$;

create or replace function public.wed_json_money(p_value jsonb, p_label text, p_allow_zero boolean)
returns numeric
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v numeric;
begin
  v := public.product_json_num(p_value, p_label);
  if v is null then
    return null;
  end if;
  return public.wed_check_money(v, p_label, p_allow_zero);
end;
$$;

-- เบอร์โทร: เก็บเฉพาะตัวเลข 9-15 หลัก (ขีด/ช่องว่าง/วงเล็บตัดทิ้ง)
create or replace function public.wed_json_phone(p_value jsonb, p_label text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v text;
begin
  v := public.product_json_text(p_value, p_label);
  if v is null then
    return null;
  end if;
  if v !~ '^[0-9 ()+.-]+$' then
    raise exception '%ใส่ได้เฉพาะตัวเลข', p_label;
  end if;
  v := regexp_replace(v, '[^0-9]', '', 'g');
  if v !~ '^[0-9]{9,15}$' then
    raise exception '%ต้องเป็นตัวเลข 9-15 หลัก', p_label;
  end if;
  return v;
end;
$$;

-- ข้อความเหตุผล (บังคับ 1..200 ตัวอักษร)
create or replace function public.wed_reason(p_value text, p_label text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v text := nullif(public.product_clean_text(p_value), '');
begin
  if v is null or char_length(v) > 200 then
    raise exception 'กรุณาระบุ% (ไม่เกิน 200 ตัวอักษร)', p_label;
  end if;
  return v;
end;
$$;

-- ----- ประวัติงาน (p_actor_name ระบุ = ระบบ ไม่ผูกกับผู้ใช้ที่ล็อกอิน) — ห้ามใส่ค่าตัวทีมงานใน detail (พนักงานอ่านได้) -----
create or replace function public.wed_log(p_booking_id uuid, p_action text, p_detail jsonb, p_actor_name text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := case when p_actor_name is null then auth.uid() end;
begin
  insert into public.wed_logs (booking_id, action, detail, actor, actor_name)
  values (p_booking_id, p_action, p_detail, v_uid, coalesce(p_actor_name, public.pos_actor_name(v_uid), 'ระบบ'));
end;
$$;

-- ----- เลขเอกสารรายวัน (ตัวนับเดียวกับ fix-04 — แถวตัวนับถูกล็อกจนจบรายการ สองเครื่องพร้อมกันไม่ได้เลขซ้ำ) -----
--   'wedding' → WD-YYYYMMDD-NNN (การจอง) / 'wedding_receipt' → WR-YYYYMMDD-NNN (ใบเสร็จ) — วันตามเวลาไทยตอนออกเลข
create or replace function public.wed_next_no(p_kind text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := public.pos_bkk_today();
  v_prefix text;
  v_seed integer;
  v_n integer;
begin
  if p_kind = 'wedding' then
    v_prefix := 'WD-';
  elsif p_kind = 'wedding_receipt' then
    v_prefix := 'WR-';
  else
    raise exception 'ชนิดเลขเอกสารไม่ถูกต้อง';
  end if;
  v_prefix := v_prefix || to_char(v_day::timestamp, 'YYYYMMDD') || '-';

  update public.doc_counters as dc
     set n = dc.n + 1
   where dc.kind = p_kind and dc.day = v_day
  returning dc.n into v_n;

  if not found then
    -- เลขแรกของวัน: ต่อจากเลขที่มีอยู่แล้ว (เผื่อตัวนับถูกล้าง) จะได้ไม่ชนกัน
    if p_kind = 'wedding' then
      select coalesce(max(substr(b.booking_no, length(v_prefix) + 1)::integer), 0) + 1
        into v_seed
        from public.wed_bookings as b
       where b.booking_no like (v_prefix || '%')
         and substr(b.booking_no, length(v_prefix) + 1) ~ '^[0-9]{1,9}$';
    else
      select coalesce(max(substr(p.receipt_no, length(v_prefix) + 1)::integer), 0) + 1
        into v_seed
        from public.wed_payments as p
       where p.receipt_no like (v_prefix || '%')
         and substr(p.receipt_no, length(v_prefix) + 1) ~ '^[0-9]{1,9}$';
    end if;

    insert into public.doc_counters as dc (kind, day, n)
    values (p_kind, v_day, v_seed)
    on conflict (kind, day) do update set n = dc.n + 1
    returning dc.n into v_n;
  end if;

  return v_prefix || case when v_n < 1000 then lpad(v_n::text, 3, '0') else v_n::text end;
end;
$$;

-- ----- ล็อกคิวที่หมดเวลา (hold เลย hold_until) → กลับเป็น "สอบถาม" (ไม่ยกเลิก — ลูกค้ายังคุยต่อได้)
--   เรียกตอนต้นของฟังก์ชันอ่าน/เขียนแทบทุกตัว (skip locked = ไม่รอแถวที่เครื่องอื่นกำลังแก้)
--   ไม่ปล่อยงานที่มีการรับเงินแล้ว (ลูกค้าโอนมัดจำทันเวลา แต่บอสยังไม่ได้กดยืนยัน — ต้องไม่เสียคิว)
create or replace function public.wed_expire_holds()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select b.id, b.hold_until
      from public.wed_bookings as b
     where b.status = 'hold'
       and b.hold_until is not null
       and b.hold_until <= now()
       -- มีเงินรับไว้สุทธิ (หลังหักคืนเงิน) = คงล็อกคิวไว้ / คืนเงินหมดแล้ว = ไม่มีอะไรผูกคิวไว้ หมดเวลาตามปกติ
       and b.paid <= 0.005
     order by b.hold_until
       for update skip locked
  loop
    update public.wed_bookings as b set status = 'inquiry', hold_until = null where b.id = r.id;
    perform public.wed_log(r.id, 'hold_expired', jsonb_build_object('hold_until', r.hold_until), 'ระบบ');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ล็อกงานก่อนแก้ (กันสองเครื่องแก้พร้อมกัน)
create or replace function public.wed_lock_booking(p_booking_id uuid)
returns public.wed_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.wed_bookings%rowtype;
begin
  if p_booking_id is null then
    raise exception 'ไม่พบงานนี้';
  end if;
  select x.* into b from public.wed_bookings as x where x.id = p_booking_id for update;
  if not found then
    raise exception 'ไม่พบงานนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  return b;
end;
$$;

-- =========================================================================
-- 4) เงิน / งวดชำระ / คิวเต็ม / ทีมงานชนคิว
-- =========================================================================

-- งวดชำระพร้อมยอดที่จ่ายแล้วของแต่ละงวด: เงินที่รับแล้ว (สุทธิหลังคืนเงิน) ไล่ตัดงวดแรกก่อนเสมอ
--   status: paid = จ่ายครบ / partial = จ่ายบางส่วน / due = ถึงกำหนด (วันนี้หรือเลยแล้ว) / upcoming = ยังไม่ถึงกำหนด
--   overdue = เลยกำหนดแล้วยังค้าง (วันตามเวลาไทย)
create or replace function public.wed_installment_rows(p_booking_id uuid)
returns table (id uuid, seq integer, label text, due_date date, amount numeric, paid_amount numeric,
               amount_remaining numeric, status text, overdue boolean)
language sql
stable
security definer
set search_path = public
as $$
  with b as (
    select greatest(x.paid, 0) as paid from public.wed_bookings as x where x.id = p_booking_id
  ), i as (
    select n.id, n.seq, n.label, n.due_date, n.amount,
           sum(n.amount) over (order by n.seq rows between unbounded preceding and current row) as cum
      from public.wed_installments as n
     where n.booking_id = p_booking_id
  ), a as (
    select i.*, greatest(0, least(i.amount, b.paid - (i.cum - i.amount))) as pa
      from i cross join b
  )
  select a.id, a.seq, a.label, a.due_date, a.amount, a.pa, a.amount - a.pa,
         case when a.amount - a.pa <= 0.005 then 'paid'
              when a.pa > 0.005 then 'partial'
              when a.due_date is not null and a.due_date <= public.pos_bkk_today() then 'due'
              else 'upcoming' end,
         (a.amount - a.pa > 0.005 and a.due_date is not null and a.due_date < public.pos_bkk_today())
    from a
   order by a.seq
$$;

-- งวดมาตรฐาน: [มัดจำ (ครบกำหนดวันที่สร้างงาน/วันที่ล็อกคิวหรือยืนยัน — wed_deposit_day), ยอดคงเหลือ (ครบกำหนดวันชำระยอดคงเหลือ)]
--   มัดจำ = ยอดสุทธิ → งวดเดียว "ชำระเต็มจำนวน" / ไม่มีมัดจำ → งวดเดียว "ยอดชำระทั้งหมด" / ยอดสุทธิ 0 → ไม่มีงวด
create or replace function public.wed_default_plan(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.wed_bookings%rowtype;
  v_dep_day date;
  v_bal_day date;
begin
  select x.* into b from public.wed_bookings as x where x.id = p_booking_id;
  if not found or b.grand_total <= 0.005 then
    return '[]'::jsonb;
  end if;
  v_dep_day := public.wed_deposit_day(b.created_at, b.deposit_due_on);
  v_bal_day := case when b.balance_due_date is null then null else greatest(b.balance_due_date, v_dep_day) end;
  if b.deposit_required <= 0.005 then
    return jsonb_build_array(jsonb_build_object('seq', 1, 'label', 'ยอดชำระทั้งหมด', 'due_date', v_bal_day,
                                                'amount', b.grand_total));
  end if;
  if b.deposit_required >= b.grand_total - 0.005 then
    return jsonb_build_array(jsonb_build_object('seq', 1, 'label', 'ชำระเต็มจำนวน', 'due_date', v_dep_day,
                                                'amount', b.grand_total));
  end if;
  return jsonb_build_array(
    jsonb_build_object('seq', 1, 'label', 'มัดจำ', 'due_date', v_dep_day, 'amount', b.deposit_required),
    jsonb_build_object('seq', 2, 'label', 'ยอดคงเหลือ', 'due_date', v_bal_day, 'amount', b.grand_total - b.deposit_required));
end;
$$;

create or replace function public.wed_write_plan(p_booking_id uuid, p_plan jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.wed_installments as n where n.booking_id = p_booking_id;
  insert into public.wed_installments (booking_id, seq, label, due_date, amount)
  select p_booking_id, (e.elem ->> 'seq')::integer, e.elem ->> 'label', (e.elem ->> 'due_date')::date,
         (e.elem ->> 'amount')::numeric
    from jsonb_array_elements(coalesce(p_plan, '[]'::jsonb)) as e(elem);
end;
$$;

-- ----- คำนวณยอดเงินของงานใหม่ทั้งหมด (ที่เดียวในระบบที่เขียนช่องเงินของงาน) — ผู้เรียกล็อกงานไว้แล้ว -----
--   ยอดก่อนส่วนลด = ราคาแพ็กเกจ + บริการเสริม + ค่าเดินทาง ; ยอดหลังส่วนลด (base_total) = − ส่วนลด
--   ยอดสุทธิ = base_total + ค่าใช้จ่ายเพิ่มที่ยังไม่ยกเลิก ; ชำระแล้ว = รับชำระ − คืนเงิน (ไม่นับรายการที่ยกเลิก)
--   มัดจำ = min(ยอดสุทธิ, max(มัดจำขั้นต่ำ, ปัดขึ้น(base_total × % มัดจำ))) — ใช้นโยบาย ณ ตอนจองที่จำไว้บนงาน
--   งวดชำระ: งวดมาตรฐาน = คำนวณใหม่ตามยอดล่าสุดเสมอ / งวดที่บอสแก้เอง = งวดสุดท้ายที่ยังค้างรับส่วนต่างอัตโนมัติ
--     (ส่วนต่างทำให้งวดนั้นเหลือ ≤ 0 → กลับไปใช้งวดมาตรฐาน) และจดประวัติทุกครั้ง
create or replace function public.wed_recalc(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.wed_bookings%rowtype;
  s public.wed_settings;
  v_addons numeric;
  v_pre numeric;
  v_base numeric;
  v_charges numeric;
  v_grand numeric;
  v_pay numeric;
  v_refund numeric;
  v_paid numeric;
  v_req numeric;
  v_first date;
  v_last date;
  v_bdd date;
  v_plan jsonb;
  v_cur jsonb;
  v_sum numeric;
  v_target record;
  v_new numeric;
  v_shifted integer;
  v_anchor date;
begin
  select x.* into b from public.wed_bookings as x where x.id = p_booking_id;
  if not found then
    return;
  end if;
  s := public.wed_settings_row();

  select coalesce(sum(a.amount), 0) into v_addons from public.wed_booking_addons as a where a.booking_id = b.id;
  v_pre := b.package_price + v_addons + b.travel_fee;
  v_base := v_pre - b.discount;
  if v_base < 0 then
    raise exception 'ส่วนลด (%) มากกว่ายอดก่อนส่วนลด (%)', public.wed_baht(b.discount), public.wed_baht(v_pre);
  end if;
  select coalesce(sum(c.amount), 0) into v_charges
    from public.wed_charges as c where c.booking_id = b.id and c.voided_at is null;
  v_grand := v_base + v_charges;
  if v_grand > 99999999.99 or v_pre > 99999999.99 then
    raise exception 'ยอดรวมของงานสูงเกินไป (สูงสุด 99,999,999.99)';
  end if;
  select coalesce(sum(p.amount) filter (where p.kind = 'payment'), 0),
         coalesce(sum(p.amount) filter (where p.kind = 'refund'), 0)
    into v_pay, v_refund
    from public.wed_payments as p
   where p.booking_id = b.id and p.voided_at is null;
  v_paid := v_pay - v_refund;

  select min(ss.date), max(ss.date) into v_first, v_last
    from public.wed_sessions as ss
   where ss.booking_id = b.id and ss.status <> 'cancelled' and ss.date is not null;
  -- งานกระชั้นชิด (สร้างไม่ถึง balance_due_days วันก่อนงาน) → ไม่ให้วันชำระยอดคงเหลือย้อนไปก่อนวันครบกำหนดมัดจำ
  --   (ตรงกับงวด "ยอดคงเหลือ" ใน wed_default_plan ทุกหน้าจอแสดงวันเดียวกัน) — วันที่กำหนดเองใช้ตามที่กำหนด
  v_bdd := coalesce(b.balance_due_date_override,
                    case when v_first is not null then
                      greatest(v_first - coalesce(b.balance_due_days, s.balance_due_days),
                               public.wed_deposit_day(b.created_at, b.deposit_due_on)) end);
  v_req := least(greatest(v_grand, 0),
                 greatest(coalesce(b.min_deposit, s.min_deposit),
                          ceil(greatest(v_base, 0) * coalesce(b.deposit_percent, s.deposit_percent) / 100)));

  -- วันงานวันสุดท้ายเปลี่ยน (เลื่อนงานแล้วกลับมาจัด / แก้วันที่ของคิว) → กำหนดส่งของรายการที่ยังไม่ส่ง เลื่อนตามจำนวนวันที่ต่าง
  --   (รายการที่ส่งแล้วไม่แตะ / ยังไม่มีวันงาน = จำวันเดิมไว้ รอวันใหม่แล้วค่อยเลื่อนจากวันเดิม)
  if v_last is not null and b.deliverables_anchor_date is not null and v_last <> b.deliverables_anchor_date then
    update public.wed_deliverables as d
       set due_date = d.due_date + (v_last - b.deliverables_anchor_date)
     where d.booking_id = b.id and d.status <> 'delivered' and d.due_date is not null;
    get diagnostics v_shifted = row_count;
    if v_shifted > 0 then
      perform public.wed_log(b.id, 'deliverables_shift',
        jsonb_build_object('from', b.deliverables_anchor_date, 'to', v_last, 'days', v_last - b.deliverables_anchor_date,
                           'items', v_shifted));
    end if;
  end if;
  v_anchor := coalesce(v_last, b.deliverables_anchor_date);

  update public.wed_bookings as x
     set addons_total = v_addons,
         base_total = v_base,
         charges_total = v_charges,
         grand_total = v_grand,
         paid = v_paid,
         due = v_grand - v_paid,
         deposit_required = v_req,
         deposit_met = v_paid >= v_req - 0.005,
         first_session_date = v_first,
         last_session_date = v_last,
         balance_due_date = v_bdd,
         deliverables_anchor_date = v_anchor
   where x.id = b.id
     and (x.addons_total, x.base_total, x.charges_total, x.grand_total, x.paid, x.due, x.deposit_required,
          x.deposit_met, x.first_session_date, x.last_session_date, x.balance_due_date, x.deliverables_anchor_date)
         is distinct from
         (v_addons, v_base, v_charges, v_grand, v_paid, v_grand - v_paid, v_req, v_paid >= v_req - 0.005,
          v_first, v_last, v_bdd, v_anchor);

  -- งานที่ยกเลิก: งวดค้างไว้ตามเดิม (ไม่มีความหมายแล้ว หน้าจอไม่แสดงยอดที่ต้องชำระ)
  if b.status = 'cancelled' then
    return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('seq', n.seq, 'label', n.label, 'due_date', n.due_date, 'amount', n.amount)
                            order by n.seq), '[]'::jsonb),
         coalesce(sum(n.amount), 0)
    into v_cur, v_sum
    from public.wed_installments as n
   where n.booking_id = b.id;

  if not b.installments_custom then
    v_plan := public.wed_default_plan(b.id);
    if v_plan is distinct from v_cur then
      perform public.wed_write_plan(b.id, v_plan);
    end if;
    return;
  end if;

  if abs(v_sum - v_grand) <= 0.005 then
    return;
  end if;
  -- งวดที่บอสแก้เอง แต่ยอดสุทธิเปลี่ยน → งวดสุดท้ายที่ยังค้างรับส่วนต่าง (ไม่มีงวดค้าง = งวดสุดท้าย)
  select r.id, r.seq, r.amount into v_target
    from public.wed_installment_rows(b.id) as r
   order by (r.amount_remaining > 0.005) desc, r.seq desc
   limit 1;
  v_new := case when v_target.id is null then 0 else v_target.amount + (v_grand - v_sum) end;
  if v_target.id is null or v_new <= 0.005 then
    update public.wed_bookings as x set installments_custom = false where x.id = b.id;
    v_plan := public.wed_default_plan(b.id);
    perform public.wed_write_plan(b.id, v_plan);
    perform public.wed_log(b.id, 'installments_rebuild',
      jsonb_build_object('reason', 'ยอดสุทธิเปลี่ยน งวดที่แก้เองใช้ต่อไม่ได้ จึงกลับไปใช้งวดมาตรฐาน',
                         'old_total', v_sum, 'grand_total', v_grand));
  else
    update public.wed_installments as n set amount = v_new where n.id = v_target.id;
    perform public.wed_log(b.id, 'installments_absorb',
      jsonb_build_object('seq', v_target.seq, 'old_amount', v_target.amount, 'new_amount', v_new,
                         'grand_total', v_grand));
  end if;
end;
$$;

-- ----- คิวเต็ม: วันที่ที่งานนี้จะทำให้จำนวนงานเกินที่ร้านรับได้ต่อวัน -----
--   นับ "งาน" (การจอง) ที่สถานะกันคิว และมีคิวที่ไม่ยกเลิกในวันนั้น (งานเดียวมีหลายคิวในวันเดียว = 1 งาน)
--   คืน [{date, count_jobs (รวมงานนี้), max, others:[{booking_id, booking_no, couple_names}]}] — max_jobs_per_day = 0 → ไม่จำกัด
create or replace function public.wed_capacity_check(p_booking_id uuid, p_dates date[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_max integer;
  v_out jsonb := '[]'::jsonb;
  v_d date;
  v_cnt integer;
  v_others jsonb;
begin
  select s.max_jobs_per_day into v_max from public.wed_settings as s where s.id;
  if coalesce(v_max, 0) = 0 then
    return v_out;
  end if;
  for v_d in select distinct x.d from unnest(p_dates) as x(d) where x.d is not null order by x.d
  loop
    select count(*), coalesce(jsonb_agg(jsonb_build_object('booking_id', o.id, 'booking_no', o.booking_no,
                                                           'couple_names', o.couple_names) order by o.booking_no), '[]'::jsonb)
      into v_cnt, v_others
      from (select distinct b.id, b.booking_no, b.couple_names
              from public.wed_sessions as ss
              join public.wed_bookings as b on b.id = ss.booking_id
             where ss.date = v_d and ss.status <> 'cancelled' and public.wed_counting(b.status)
               and b.id is distinct from p_booking_id) as o;
    if v_cnt + 1 > v_max then
      v_out := v_out || jsonb_build_array(jsonb_build_object('date', v_d, 'count_jobs', v_cnt + 1, 'max', v_max,
                                                             'others', v_others));
    end if;
  end loop;
  return v_out;
end;
$$;

-- ล็อกวันที่ก่อนตรวจคิวเต็ม (สองเครื่องรับงานวันเดียวกันพร้อมกัน → เครื่องที่สองรอแล้วนับงานของเครื่องแรกด้วย)
create or replace function public.wed_capacity_lock(p_dates date[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_d date;
begin
  for v_d in select distinct x.d from unnest(p_dates) as x(d) where x.d is not null order by x.d
  loop
    perform pg_advisory_xact_lock(hashtext('wed_day:' || v_d::text));
  end loop;
end;
$$;

-- คิวเต็มแล้วไม่ได้กดยืนยัน → หยุดพร้อมข้อความไทยบอกวันและงานที่มีอยู่ (hint 'wed_capacity' ให้หน้าจอเปิดกล่องยืนยัน)
create or replace function public.wed_capacity_raise(p_warnings jsonb)
returns void
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  w jsonb;
begin
  if p_warnings is null or jsonb_array_length(p_warnings) = 0 then
    return;
  end if;
  w := p_warnings -> 0;
  raise exception 'วันที่ % รับงานได้ % งานต่อวัน มีงานอยู่แล้ว: % — ต้องกดยืนยันเพื่อรับงานเกิน',
    public.wed_thai_date((w ->> 'date')::date), w ->> 'max',
    (select string_agg((o.elem ->> 'booking_no') || ' ' || (o.elem ->> 'couple_names'), ', ')
       from jsonb_array_elements(w -> 'others') as o(elem))
    using hint = 'wed_capacity';
end;
$$;

-- ----- ทีมงานชนคิว (เตือนเท่านั้น บันทึกได้) -----
--   ช่วงที่ติดงาน = [เวลาถึงงาน หรือเวลาเริ่ม, เวลาเลิก) — ไม่มีเวลาเริ่ม = ตั้งแต่ 00:00 / ไม่มีเวลาเลิก = ถึงสิ้นวัน
--   p_rows = คิวของงานนี้ [{session_id?, date, start_time, end_time, call_time, crew:[crew_id… หรือ {crew_id}]}] (ตามลำดับในฟอร์ม)
--   ตรวจกับคิวของงานอื่นที่สถานะกันคิว (ไม่นับงาน p_exclude_booking ที่บันทึกไว้ — ใช้ p_rows แทน) และระหว่างคิวในงานเดียวกัน
create or replace function public.wed_conflicts(p_rows jsonb, p_exclude_booking uuid, p_self_no text, p_self_couple text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select e.ord::integer as idx,
           nullif(e.elem ->> 'session_id', '')::uuid as session_id,
           (e.elem ->> 'date')::date as d,
           nullif(e.elem ->> 'start_time', '')::time as st,
           nullif(e.elem ->> 'end_time', '')::time as et,
           nullif(e.elem ->> 'call_time', '')::time as ct,
           nullif(e.elem ->> 'session_type', '') as stype,
           coalesce(c.elem ->> 'crew_id', c.elem #>> '{}')::uuid as crew_id
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as e(elem, ord)
     cross join lateral jsonb_array_elements(coalesce(e.elem -> 'crew', '[]'::jsonb)) as c(elem)
     where nullif(e.elem ->> 'date', '') is not null
       and coalesce(e.elem ->> 'status', 'scheduled') <> 'cancelled'
  ), others as (
    select ss.id as session_id, b.id as booking_id, b.booking_no, b.couple_names, ss.date as d,
           ss.start_time as st, ss.end_time as et, ss.call_time as ct, ss.session_type as stype, sc.crew_id
      from public.wed_session_crew as sc
      join public.wed_sessions as ss on ss.id = sc.session_id
      join public.wed_bookings as b on b.id = ss.booking_id
     where public.wed_counting(b.status) and ss.status <> 'cancelled' and ss.date is not null
       and b.id is distinct from p_exclude_booking
       and sc.crew_id in (select me.crew_id from me)
  ), pairs as (
    select m.idx, m.session_id, m.d, m.crew_id, o.session_id as o_session, o.booking_id as o_booking,
           o.booking_no as o_no, o.couple_names as o_couple, o.st as o_st, o.et as o_et, o.ct as o_ct, o.stype as o_type,
           false as same_booking
      from me as m
      join others as o
        on o.crew_id = m.crew_id and o.d = m.d
       and coalesce(m.ct, m.st, '00:00'::time) < coalesce(o.et, '24:00'::time)
       and coalesce(o.ct, o.st, '00:00'::time) < coalesce(m.et, '24:00'::time)
    union all
    select m.idx, m.session_id, m.d, m.crew_id, m2.session_id, p_exclude_booking, p_self_no, p_self_couple,
           m2.st, m2.et, m2.ct, m2.stype, true
      from me as m
      join me as m2
        on m2.crew_id = m.crew_id and m2.d = m.d and m2.idx <> m.idx
       and coalesce(m.ct, m.st, '00:00'::time) < coalesce(m2.et, '24:00'::time)
       and coalesce(m2.ct, m2.st, '00:00'::time) < coalesce(m.et, '24:00'::time)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'crew_id', p.crew_id, 'crew_name', coalesce(cr.nickname, cr.name), 'crew_full_name', cr.name, 'date', p.d,
           'this_index', p.idx, 'this_session_id', p.session_id,
           'other_session_id', p.o_session, 'other_booking_id', p.o_booking, 'other_booking_no', p.o_no,
           'other_couple', p.o_couple, 'other_type_label', public.wed_type_label(p.o_type),
           'other_time', public.wed_busy_text(p.o_st, p.o_et, p.o_ct), 'same_booking', p.same_booking)
           order by p.idx, p.d, cr.name, p.o_no), '[]'::jsonb)
    from pairs as p
    left join public.wed_crew as cr on cr.id = p.crew_id
$$;

-- คิวของงานที่บันทึกไว้ → รูปแบบ p_rows ของ wed_conflicts (ภายในเท่านั้น — มีค่าตัว ห้ามส่งออกไปหน้าจอตรงๆ)
create or replace function public.wed_session_rows(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'session_id', ss.id, 'date', ss.date, 'start_time', ss.start_time, 'end_time', ss.end_time,
           'call_time', ss.call_time, 'status', ss.status, 'session_type', ss.session_type,
           'crew', coalesce((select jsonb_agg(jsonb_build_object('crew_id', sc.crew_id, 'role', sc.role, 'fee', sc.fee)
                                              order by sc.crew_id)
                               from public.wed_session_crew as sc
                              where sc.session_id = ss.id), '[]'::jsonb))
           order by ss.sort_order, ss.date nulls last, ss.start_time nulls last, ss.id), '[]'::jsonb)
    from public.wed_sessions as ss
   where ss.booking_id = p_booking_id
$$;

-- คู่คิวที่ทีมงานชนกันในช่วงวันที่ (ทั้งสองทิศ: คิว A ชน B และ B ชน A) — ปฏิทิน/ภาพรวมวันนี้
create or replace function public.wed_conflict_pairs(p_from date, p_to date)
returns table (crew_id uuid, crew_name text, date date, this_session_id uuid, this_booking_id uuid, this_booking_no text,
               this_couple text, this_time text, other_session_id uuid, other_booking_id uuid, other_booking_no text,
               other_couple text, other_time text)
language sql
stable
security definer
set search_path = public
as $$
  with x as (
    select ss.id as sid, b.id as bid, b.booking_no, b.couple_names, ss.date as d, ss.start_time as st,
           ss.end_time as et, ss.call_time as ct, sc.crew_id
      from public.wed_session_crew as sc
      join public.wed_sessions as ss on ss.id = sc.session_id
      join public.wed_bookings as b on b.id = ss.booking_id
     where public.wed_counting(b.status) and ss.status <> 'cancelled'
       and ss.date between p_from and p_to
  )
  select a.crew_id, coalesce(cr.nickname, cr.name), a.d, a.sid, a.bid, a.booking_no, a.couple_names,
         public.wed_busy_text(a.st, a.et, a.ct), o.sid, o.bid, o.booking_no, o.couple_names,
         public.wed_busy_text(o.st, o.et, o.ct)
    from x as a
    join x as o
      on o.crew_id = a.crew_id and o.d = a.d and o.sid <> a.sid
     and coalesce(a.ct, a.st, '00:00'::time) < coalesce(o.et, '24:00'::time)
     and coalesce(o.ct, o.st, '00:00'::time) < coalesce(a.et, '24:00'::time)
    left join public.wed_crew as cr on cr.id = a.crew_id
   order by a.d, cr.name, a.booking_no, o.booking_no
$$;

create or replace function public.wed_conflict_json(p_from date, p_to date, p_one_way boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'crew_id', c.crew_id, 'crew_name', c.crew_name, 'date', c.date,
           'this_session_id', c.this_session_id, 'this_booking_id', c.this_booking_id, 'this_booking_no', c.this_booking_no,
           'this_couple', c.this_couple, 'this_time', c.this_time,
           'other_session_id', c.other_session_id, 'other_booking_id', c.other_booking_id,
           'other_booking_no', c.other_booking_no, 'other_couple', c.other_couple, 'other_time', c.other_time)
           order by c.date, c.crew_name, c.this_booking_no, c.other_booking_no), '[]'::jsonb)
    from public.wed_conflict_pairs(p_from, p_to) as c
   where not p_one_way or c.this_session_id::text < c.other_session_id::text
$$;

-- =========================================================================
-- 5) JSON ที่หน้าจอใช้ (ค่าตัวทีมงาน/ต้นทุน/กำไร ใส่เฉพาะเมื่อผู้เรียกเป็นผู้จัดการ)
--    เวลาในทุก JSON เป็นข้อความ 'HH:MM' (หรือ null)
-- =========================================================================

create or replace function public.wed_settings_json()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select (to_jsonb(s) - 'id')
         || jsonb_build_object(
              'logo_url_path', case when s.logo_path is null then null
                                    else '/storage/v1/object/public/wedding-public/' || s.logo_path end,
              'public_url_prefix', '/wedding-status/')
    from public.wed_settings as s
   where s.id
$$;

create or replace function public.wed_customer_json(p_customer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', c.id, 'name', c.name, 'partner_name', c.partner_name, 'phone', c.phone, 'phone2', c.phone2,
           'line_id', c.line_id, 'instagram', c.instagram, 'facebook', c.facebook, 'email', c.email,
           'address', c.address, 'source', c.source, 'source_label', public.wed_source_label(c.source), 'note', c.note,
           'created_at', c.created_at, 'updated_at', c.updated_at,
           'stats', (
              select jsonb_build_object(
                       'bookings', count(*),
                       'active', count(*) filter (where b.status not in ('completed', 'cancelled')),
                       'completed', count(*) filter (where b.status = 'completed'),
                       'cancelled', count(*) filter (where b.status = 'cancelled'),
                       'total_value', coalesce(sum(b.grand_total) filter (where b.status <> 'cancelled'), 0),
                       'total_paid', coalesce(sum(b.paid), 0),
                       'total_due', coalesce(sum(greatest(b.due, 0)) filter (where b.status not in ('cancelled', 'inquiry')), 0),
                       'last_event_date', max(b.last_session_date) filter (where b.status <> 'cancelled'),
                       'last_booking_at', max(b.created_at))
                from public.wed_bookings as b
               where b.customer_id = c.id))
    from public.wed_customers as c
   where c.id = p_customer_id
$$;

-- ทีมงาน 1 คน (p_manager = true → มีค่าตัวเริ่มต้น)
create or replace function public.wed_crew_json(p_crew_id uuid, p_manager boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', c.id, 'name', c.name, 'nickname', c.nickname, 'role', c.role, 'role_label', public.wed_role_label(c.role),
           'color', c.color, 'is_active', c.is_active, 'phone', c.phone, 'line_id', c.line_id, 'note', c.note,
           'created_at', c.created_at, 'updated_at', c.updated_at)
         || case when p_manager then jsonb_build_object('default_fee', c.default_fee) else '{}'::jsonb end
    from public.wed_crew as c
   where c.id = p_crew_id
$$;

create or replace function public.wed_package_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', p.id, 'name', p.name, 'description', p.description, 'price', p.price, 'hours', p.hours,
           'crew_size', p.crew_size, 'deliverables', p.deliverables, 'is_active', p.is_active, 'sort_order', p.sort_order,
           'created_at', p.created_at, 'updated_at', p.updated_at,
           'bookings_count', (select count(*) from public.wed_bookings as b where b.package_id = p.id))
    from public.wed_packages as p
   where p.id = p_id
$$;

create or replace function public.wed_addon_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', a.id, 'name', a.name, 'price', a.price, 'unit', a.unit, 'description', a.description,
           'is_active', a.is_active, 'sort_order', a.sort_order, 'created_at', a.created_at, 'updated_at', a.updated_at,
           'bookings_count', (select count(distinct ba.booking_id) from public.wed_booking_addons as ba where ba.addon_id = a.id))
    from public.wed_addons as a
   where a.id = p_id
$$;

create or replace function public.wed_payment_json(p_payment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', p.id, 'booking_id', p.booking_id, 'booking_no', b.booking_no, 'couple_names', b.couple_names,
           'receipt_no', p.receipt_no, 'kind', p.kind, 'kind_label', public.wed_kind_label(p.kind),
           'method', p.method, 'method_label', public.wed_method_label(p.method), 'amount', p.amount,
           'paid_on', p.paid_on, 'purpose', p.purpose, 'purpose_label', public.wed_purpose_label(p.purpose),
           'slip_path', p.slip_path, 'note', p.note, 'voided_at', p.voided_at, 'void_reason', p.void_reason,
           'created_by_name', p.created_by_name, 'created_at', p.created_at)
    from public.wed_payments as p
    join public.wed_bookings as b on b.id = p.booking_id
   where p.id = p_payment_id
$$;

create or replace function public.wed_deliverable_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', d.id, 'booking_id', d.booking_id, 'name', d.name, 'qty', d.qty, 'unit', d.unit, 'due_date', d.due_date,
           'status', d.status, 'status_label', public.wed_deliverable_label(d.status), 'link_url', d.link_url,
           'note', d.note, 'editor_crew_id', d.editor_crew_id, 'editor_name', coalesce(cr.nickname, cr.name),
           'delivered_at', d.delivered_at, 'sort_order', d.sort_order,
           'overdue', d.status <> 'delivered' and d.due_date is not null and d.due_date < public.pos_bkk_today(),
           'created_at', d.created_at, 'updated_at', d.updated_at)
    from public.wed_deliverables as d
    left join public.wed_crew as cr on cr.id = d.editor_crew_id
   where d.id = p_id
$$;

-- ทีมในคิว (p_manager = true → มีค่าตัว + วันที่จ่ายค่าตัว)
create or replace function public.wed_session_crew_json(p_session_id uuid, p_manager boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
           jsonb_build_object('crew_id', sc.crew_id, 'name', c.name, 'nickname', c.nickname, 'role', sc.role,
                              'role_label', public.wed_role_label(sc.role), 'color', c.color, 'note', sc.note,
                              'is_active', c.is_active)
           || case when p_manager then jsonb_build_object('fee', sc.fee, 'fee_paid_on', sc.fee_paid_on) else '{}'::jsonb end
           order by c.name, sc.crew_id), '[]'::jsonb)
    from public.wed_session_crew as sc
    join public.wed_crew as c on c.id = sc.crew_id
   where sc.session_id = p_session_id
$$;

-- งวดชำระแบบ JSON (+ ยอดที่ต้องชำระงวดถัดไป)
create or replace function public.wed_installments_json(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'seq', r.seq, 'label', r.label, 'due_date', r.due_date, 'amount', r.amount,
           'paid_amount', r.paid_amount, 'amount_remaining', r.amount_remaining, 'status', r.status, 'overdue', r.overdue)
           order by r.seq), '[]'::jsonb)
    from public.wed_installment_rows(p_booking_id) as r
$$;

-- งวดถัดไปที่ต้องชำระ = งวดแรกที่ยังค้าง (ไม่มีงวด แต่ยังค้าง = ยอดคงเหลือทั้งหมด) / งานยกเลิกหรือไม่ค้าง = null
create or replace function public.wed_next_due_json(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
           when b.status = 'cancelled' or b.due <= 0.005 then null
           else coalesce(
                  (select jsonb_build_object('seq', r.seq, 'label', r.label, 'due_date', r.due_date,
                                             'amount', least(r.amount_remaining, b.due), 'overdue', r.overdue)
                     from public.wed_installment_rows(b.id) as r
                    where r.amount_remaining > 0.005
                    order by r.seq
                    limit 1),
                  jsonb_build_object('seq', null, 'label', 'ยอดคงเหลือ', 'due_date', b.balance_due_date, 'amount', b.due,
                                     'overdue', b.balance_due_date is not null and b.balance_due_date < public.pos_bkk_today()))
         end
    from public.wed_bookings as b
   where b.id = p_booking_id
$$;

-- งานแบบย่อ (รายการ/ภาพรวม)
create or replace function public.wed_booking_mini(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', b.id, 'booking_no', b.booking_no, 'status', b.status, 'status_label', public.wed_status_label(b.status),
           'source', b.source, 'source_label', public.wed_source_label(b.source), 'couple_names', b.couple_names,
           'customer_id', b.customer_id, 'customer_name', c.name, 'customer_phone', c.phone, 'customer_line_id', c.line_id,
           'first_session_date', b.first_session_date, 'last_session_date', b.last_session_date,
           'sessions_count', (select count(*) from public.wed_sessions as ss
                               where ss.booking_id = b.id and ss.status <> 'cancelled'),
           'package_name', b.package_name, 'hold_until', b.hold_until,
           'followup_date', b.followup_date, 'followup_note', b.followup_note,
           'grand_total', b.grand_total, 'paid', b.paid, 'due', b.due, 'deposit_required', b.deposit_required,
           'deposit_met', b.deposit_met, 'created_at', b.created_at, 'updated_at', b.updated_at)
    from public.wed_bookings as b
    join public.wed_customers as c on c.id = b.customer_id
   where b.id = p_booking_id
$$;

-- คิวแบบย่อ (ปฏิทิน) — has_conflict = ทีมในคิวนี้ชนกับคิวอื่น (เฉพาะงานที่กันคิว)
create or replace function public.wed_session_mini(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'session_id', ss.id, 'booking_id', b.id, 'booking_no', b.booking_no, 'status', b.status,
           'status_label', public.wed_status_label(b.status), 'couple_names', b.couple_names,
           'session_type', ss.session_type, 'type_label', public.wed_type_label(ss.session_type), 'title', ss.title,
           'date', ss.date, 'start_time', public.wed_hhmm(ss.start_time), 'end_time', public.wed_hhmm(ss.end_time),
           'call_time', public.wed_hhmm(ss.call_time), 'venue_name', ss.venue_name, 'map_url', ss.map_url,
           'session_status', ss.status,
           'crew', coalesce((select jsonb_agg(jsonb_build_object('crew_id', sc.crew_id, 'name', c.name, 'nickname', c.nickname,
                                                                 'role', sc.role, 'role_label', public.wed_role_label(sc.role),
                                                                 'color', c.color) order by c.name, sc.crew_id)
                               from public.wed_session_crew as sc
                               join public.wed_crew as c on c.id = sc.crew_id
                              where sc.session_id = ss.id), '[]'::jsonb),
           'due', b.due, 'deposit_met', b.deposit_met,
           'has_conflict', public.wed_counting(b.status) and ss.status <> 'cancelled' and ss.date is not null and exists (
              select 1
                from public.wed_session_crew as a
                join public.wed_session_crew as o on o.crew_id = a.crew_id and o.session_id <> a.session_id
                join public.wed_sessions as os on os.id = o.session_id
                join public.wed_bookings as ob on ob.id = os.booking_id
               where a.session_id = ss.id and os.date = ss.date and os.status <> 'cancelled'
                 and public.wed_counting(ob.status)
                 and coalesce(ss.call_time, ss.start_time, '00:00'::time) < coalesce(os.end_time, '24:00'::time)
                 and coalesce(os.call_time, os.start_time, '00:00'::time) < coalesce(ss.end_time, '24:00'::time)))
    from public.wed_sessions as ss
    join public.wed_bookings as b on b.id = ss.booking_id
   where ss.id = p_session_id
$$;

-- งานแบบเต็ม (หน้ารายละเอียดงาน / ผลของทุกฟังก์ชันที่แก้งาน)
create or replace function public.wed_booking_json(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.wed_bookings%rowtype;
  c public.wed_customers%rowtype;
  v_mgr boolean := public.wed_manager();
  v_today date := public.pos_bkk_today();
  v_conf jsonb;
  v_sessions jsonb;
  v_crew_cost numeric;
  v_money jsonb;
  v_dated boolean;
  v_future boolean;
  v_dates date[];
  v_can jsonb;
  v_reasons jsonb;
  v_deliv_open integer;
  v_deliv_total integer;
  v_undated boolean;
begin
  select x.* into b from public.wed_bookings as x where x.id = p_booking_id;
  if not found then
    return null;
  end if;
  select x.* into c from public.wed_customers as x where x.id = b.customer_id;

  -- งานยกเลิก/เลื่อนงานไม่กันคิว → ไม่มีทีมชนคิวให้แก้ (คนอื่นก็ไม่เห็นงานนี้ชน) / สอบถามยังเตือนไว้ล่วงหน้า
  v_conf := case when b.status in ('cancelled', 'postponed') then '[]'::jsonb
                 else public.wed_conflicts(public.wed_session_rows(b.id), b.id, b.booking_no, b.couple_names) end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', ss.id, 'session_type', ss.session_type, 'type_label', public.wed_type_label(ss.session_type),
           'title', ss.title, 'date', ss.date, 'start_time', public.wed_hhmm(ss.start_time),
           'end_time', public.wed_hhmm(ss.end_time), 'call_time', public.wed_hhmm(ss.call_time),
           'venue_name', ss.venue_name, 'venue_address', ss.venue_address, 'map_url', ss.map_url,
           'venue_contact', ss.venue_contact, 'dress_code', ss.dress_code, 'notes', ss.notes, 'run_sheet', ss.run_sheet,
           'status', ss.status, 'sort_order', ss.sort_order,
           'crew', public.wed_session_crew_json(ss.id, v_mgr),
           'conflicts', coalesce((select jsonb_agg(cf.elem) from jsonb_array_elements(v_conf) as cf(elem)
                                   where cf.elem ->> 'this_session_id' = ss.id::text), '[]'::jsonb))
           order by ss.sort_order, ss.date nulls last, ss.start_time nulls last, ss.id), '[]'::jsonb),
         coalesce(bool_or(ss.status <> 'cancelled' and ss.date is not null), false),
         coalesce(bool_or(ss.status = 'scheduled' and (ss.date is null or ss.date > v_today)), false),
         array_agg(ss.date) filter (where ss.status <> 'cancelled' and ss.date is not null),
         coalesce(bool_or(ss.status <> 'cancelled' and ss.date is null), false)
    into v_sessions, v_dated, v_future, v_dates, v_undated
    from public.wed_sessions as ss
   where ss.booking_id = b.id;

  select count(*), count(*) filter (where d.status <> 'delivered')
    into v_deliv_total, v_deliv_open
    from public.wed_deliverables as d where d.booking_id = b.id;

  v_money := jsonb_build_object(
    'package_price', b.package_price, 'addons_total', b.addons_total, 'travel_fee', b.travel_fee,
    'discount', b.discount, 'discount_note', b.discount_note,
    'pre_discount_total', b.package_price + b.addons_total + b.travel_fee,
    'base_total', b.base_total, 'charges_total', b.charges_total, 'grand_total', b.grand_total,
    'paid', b.paid, 'due', b.due, 'deposit_required', b.deposit_required, 'deposit_met', b.deposit_met,
    'deposit_due', greatest(b.deposit_required - b.paid, 0),
    'deposit_percent', b.deposit_percent, 'min_deposit', b.min_deposit, 'balance_due_days', b.balance_due_days,
    'balance_due_date', b.balance_due_date, 'balance_due_date_override', b.balance_due_date_override);
  if v_mgr then
    -- ค่าตัวของคิวที่ไม่ยกเลิก + ค่าตัวที่จ่ายไปแล้ว (จ่ายแล้วเป็นต้นทุนจริงเสมอ แม้คิวถูกยกเลิกทีหลัง)
    select coalesce(sum(sc.fee), 0) into v_crew_cost
      from public.wed_session_crew as sc
      join public.wed_sessions as ss on ss.id = sc.session_id
     where ss.booking_id = b.id and (ss.status <> 'cancelled' or sc.fee_paid_on is not null);
    v_money := v_money || jsonb_build_object('crew_cost_total', v_crew_cost,
                                             'profit', b.base_total + b.charges_total - v_crew_cost);
  end if;

  v_can := jsonb_build_object(
    'can_edit', b.status in ('inquiry', 'hold', 'confirmed', 'postponed', 'in_production'),
    'can_hold', b.status = 'inquiry' and v_dated and not v_undated,
    'can_extend_hold', b.status = 'hold',
    'can_release', b.status = 'hold',
    'can_confirm', b.status in ('inquiry', 'hold') and v_dated and not v_undated,
    'can_mark_shot', b.status = 'confirmed',
    'can_mark_delivered', b.status = 'in_production',
    'can_complete', b.status = 'delivered' and abs(b.due) < 0.005,
    'can_reopen', b.status = 'completed' and v_mgr,
    'can_postpone', b.status in ('hold', 'confirmed'),
    'can_resume', b.status = 'postponed',
    'can_cancel', b.status in ('inquiry', 'hold', 'confirmed', 'postponed')
                  or (b.status in ('in_production', 'delivered') and v_mgr),
    'can_pay', b.status <> 'cancelled' and b.due > 0.005,
    'can_refund', b.paid > 0.005 and b.status <> 'completed',
    'can_add_charge', public.wed_charges_open(b.status, b.status_before_postpone),
    'can_set_installments', b.status not in ('cancelled', 'completed'),
    'can_edit_deliverables', b.status <> 'cancelled',
    'can_set_followup', b.status <> 'cancelled');

  v_reasons := jsonb_build_object(
    'hold', case when b.status <> 'inquiry' then 'ล็อกคิวได้เฉพาะงานที่ยังเป็น "สอบถาม"'
                 when not v_dated then 'ต้องมีคิวงานที่ระบุวันที่อย่างน้อย 1 คิวก่อน'
                 when v_undated then 'กรุณาระบุวันที่ของทุกคิวงานก่อน (หรือยกเลิกคิวที่ยังไม่มีวัน)' end,
    'confirm', case when b.status not in ('inquiry', 'hold') then 'ยืนยันได้เฉพาะงานที่สอบถามหรือล็อกคิวอยู่'
                    when not v_dated then 'ต้องมีคิวงานที่ระบุวันที่อย่างน้อย 1 คิวก่อน'
                    when v_undated then 'กรุณาระบุวันที่ของทุกคิวงานก่อน (หรือยกเลิกคิวที่ยังไม่มีวัน)' end,
    'confirm_warning', case when b.status in ('inquiry', 'hold') and not b.deposit_met
                            then 'ยังไม่ได้รับมัดจำครบ (ขาด ' || public.wed_baht(greatest(b.deposit_required - b.paid, 0))
                                 || ') — ยืนยันได้ด้วยการกดยืนยันแบบบังคับ' end,
    'mark_shot', case when b.status <> 'confirmed' then 'บันทึกถ่ายเสร็จได้เฉพาะงานที่ยืนยันแล้ว' end,
    'mark_shot_warning', case when b.status = 'confirmed' and v_future
                              then 'ยังมีคิวงานที่ยังไม่ถึงวัน (หรือยังไม่ระบุวัน) — ต้องกดยืนยันแบบบังคับ' end,
    'mark_delivered', case when b.status <> 'in_production' then 'บันทึกส่งงานได้เฉพาะงานที่ถ่ายเสร็จแล้ว' end,
    'complete', case when b.status not in ('delivered', 'in_production') then 'ปิดงานได้หลังส่งงานแล้วเท่านั้น'
                     when b.due > 0.005 then 'ยังค้างชำระ ' || public.wed_baht(b.due)
                     when b.due < -0.005 then 'รับเงินเกิน ' || public.wed_baht(-b.due) || ' ต้องคืนเงินก่อน' end,
    'complete_warning', case when b.status = 'in_production'
                             then 'ยังไม่ได้บันทึกส่งงาน (ค้าง ' || v_deliv_open || ' รายการ) — ต้องกดยืนยันแบบบังคับ' end,
    'cancel', case when b.status = 'cancelled' then 'งานนี้ยกเลิกแล้ว'
                   when b.status = 'completed' then 'งานที่ปิดแล้วยกเลิกไม่ได้'
                   when b.status in ('in_production', 'delivered') and not v_mgr
                     then 'งานที่ถ่ายแล้วยกเลิกได้เฉพาะผู้จัดการ' end,
    'pay', case when b.status = 'cancelled' then 'งานที่ยกเลิกรับชำระไม่ได้ (บันทึกคืนเงินได้)'
                when b.due <= 0.005 then 'ไม่มียอดค้างชำระ' end,
    'refund', case when b.status = 'completed' then 'งานที่ปิดแล้วคืนเงินไม่ได้ (เปิดงานใหม่ก่อน)'
                   when b.paid <= 0.005 then 'ยังไม่มีเงินที่ชำระไว้ให้คืน' end,
    'add_charge', case when not public.wed_charges_open(b.status, b.status_before_postpone)
                       then 'เพิ่มค่าใช้จ่ายได้ตั้งแต่ยืนยันงานจนถึงส่งงาน (รวมงานที่ยืนยันแล้วถูกเลื่อน)' end);

  return public.wed_booking_mini(b.id)
    || jsonb_build_object(
      'status_before_postpone', b.status_before_postpone,
      'public_token', b.public_token,
      'public_url_path', '/wedding-status/' || b.public_token,
      'customer', jsonb_build_object('id', c.id, 'name', c.name, 'partner_name', c.partner_name, 'phone', c.phone,
                                     'phone2', c.phone2, 'line_id', c.line_id, 'instagram', c.instagram,
                                     'facebook', c.facebook, 'email', c.email, 'address', c.address,
                                     'source', c.source, 'source_label', public.wed_source_label(c.source), 'note', c.note),
      'package', jsonb_build_object('id', b.package_id, 'name', b.package_name, 'price', b.package_price,
                                    'hours', b.package_hours, 'description', b.package_description),
      'deliverables_plan', b.deliverables_plan,
      'addons', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'addon_id', a.addon_id, 'name', a.name,
                                                              'unit', a.unit, 'qty', a.qty, 'unit_price', a.unit_price,
                                                              'amount', a.amount, 'sort_order', a.sort_order)
                                           order by a.sort_order, a.id)
                            from public.wed_booking_addons as a where a.booking_id = b.id), '[]'::jsonb),
      'travel_fee', b.travel_fee, 'discount', b.discount, 'discount_note', b.discount_note,
      'sessions', v_sessions,
      'crew_conflicts', v_conf,
      'capacity_warnings', case when public.wed_counting(b.status)
                                then public.wed_capacity_check(b.id, v_dates) else '[]'::jsonb end,
      'money', v_money,
      'installments', public.wed_installments_json(b.id),
      'installments_custom', b.installments_custom,
      'next_due', public.wed_next_due_json(b.id))
    || jsonb_build_object(
      'charges', coalesce((select jsonb_agg(jsonb_build_object(
                                   'id', ch.id, 'kind', ch.kind, 'kind_label', public.wed_charge_label(ch.kind),
                                   'description', ch.description, 'amount', ch.amount, 'voided_at', ch.voided_at,
                                   'void_reason', ch.void_reason, 'created_by_name', ch.created_by_name,
                                   'created_at', ch.created_at) order by ch.created_at, ch.id)
                             from public.wed_charges as ch where ch.booking_id = b.id), '[]'::jsonb),
      'payments', coalesce((select jsonb_agg(public.wed_payment_json(p.id) - 'booking_id' - 'booking_no' - 'couple_names'
                                             order by p.created_at, p.id)
                              from public.wed_payments as p where p.booking_id = b.id), '[]'::jsonb),
      'deliverables', coalesce((select jsonb_agg(public.wed_deliverable_json(d.id) order by d.sort_order, d.due_date nulls last, d.id)
                                  from public.wed_deliverables as d where d.booking_id = b.id), '[]'::jsonb),
      'deliverables_summary', jsonb_build_object('total', v_deliv_total, 'open', v_deliv_open,
                                                 'delivered', v_deliv_total - v_deliv_open),
      'logs', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'action', z.action, 'detail', z.detail,
                                                            'actor_name', z.actor_name, 'created_at', z.created_at)
                                         order by z.id desc)
                          from (select lg.* from public.wed_logs as lg where lg.booking_id = b.id
                                 order by lg.id desc limit 200) as z), '[]'::jsonb),
      'coordinator_name', b.coordinator_name, 'coordinator_phone', b.coordinator_phone, 'mood_link', b.mood_link,
      'customer_note', b.customer_note, 'note', b.note, 'cancel_reason', b.cancel_reason,
      'postpone_reason', b.postpone_reason,
      'actions', v_can || jsonb_build_object('block_reasons', v_reasons),
      'created_by_name', b.created_by_name, 'confirmed_at', b.confirmed_at, 'shot_at', b.shot_at,
      'delivered_at', b.delivered_at, 'completed_at', b.completed_at, 'cancelled_at', b.cancelled_at,
      'postponed_at', b.postponed_at);
end;
$$;

-- =========================================================================
-- 6) ตัวช่วยเขียน: ลูกค้า / หัวงาน / คิวงาน / บริการเสริม / แผนงานส่ง / รับเงิน / ยืนยันงาน
-- =========================================================================

-- เขียนลูกค้า: p_id = null → สร้างใหม่ / มี id → แก้ (คีย์ที่ไม่ส่งมา = คงค่าเดิม)
create or replace function public.wed_customer_write(p_id uuid, p jsonb, p_client_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.wed_customers%rowtype;
  v_new boolean := p_id is null;
  v_src text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'ข้อมูลลูกค้าไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  if not v_new then
    select x.* into c from public.wed_customers as x where x.id = p_id for update;
    if not found then
      raise exception 'ไม่พบข้อมูลลูกค้านี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
    end if;
  else
    c.source := 'other';
  end if;

  if v_new or p ? 'name' then
    c.name := public.wed_json_text(p -> 'name', 'ชื่อลูกค้า', 100);
    if c.name is null then
      raise exception 'กรุณากรอกชื่อลูกค้า';
    end if;
  end if;
  if v_new or p ? 'partner_name' then
    c.partner_name := public.wed_json_text(p -> 'partner_name', 'ชื่อคู่บ่าวสาว', 100);
  end if;
  if v_new or p ? 'phone' then
    c.phone := public.wed_json_phone(p -> 'phone', 'เบอร์โทร');
    if c.phone is null then
      raise exception 'กรุณากรอกเบอร์โทรลูกค้า';
    end if;
  end if;
  if v_new or p ? 'phone2' then c.phone2 := public.wed_json_phone(p -> 'phone2', 'เบอร์โทรสำรอง'); end if;
  if v_new or p ? 'line_id' then c.line_id := public.wed_json_text(p -> 'line_id', 'LINE ID', 50); end if;
  if v_new or p ? 'instagram' then c.instagram := public.wed_json_text(p -> 'instagram', 'Instagram', 100); end if;
  if v_new or p ? 'facebook' then c.facebook := public.wed_json_text(p -> 'facebook', 'Facebook', 200); end if;
  if v_new or p ? 'email' then
    c.email := public.wed_json_text(p -> 'email', 'อีเมล', 100);
    if c.email is not null and c.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'อีเมลไม่ถูกต้อง';
    end if;
  end if;
  if v_new or p ? 'address' then c.address := public.wed_json_text(p -> 'address', 'ที่อยู่', 500); end if;
  if v_new or p ? 'note' then c.note := public.wed_json_longtext(p -> 'note', 'หมายเหตุลูกค้า', 1000); end if;
  if p ? 'source' then
    v_src := coalesce(public.wed_json_text(p -> 'source', 'ช่องทางที่รู้จักร้าน', 20), 'other');
    if v_src not in ('instagram', 'facebook', 'tiktok', 'line', 'referral', 'walkin', 'website', 'other') then
      raise exception 'ช่องทางที่รู้จักร้านไม่ถูกต้อง';
    end if;
    c.source := v_src;
  end if;

  if v_new then
    insert into public.wed_customers as x
      (client_id, name, partner_name, phone, phone2, line_id, instagram, facebook, email, address, source, note)
    values
      (p_client_id, c.name, c.partner_name, c.phone, c.phone2, c.line_id, c.instagram, c.facebook, c.email, c.address,
       c.source, c.note)
    returning x.id into c.id;
  else
    update public.wed_customers as x
       set name = c.name, partner_name = c.partner_name, phone = c.phone, phone2 = c.phone2, line_id = c.line_id,
           instagram = c.instagram, facebook = c.facebook, email = c.email, address = c.address, source = c.source,
           note = c.note
     where x.id = c.id;
  end if;
  return c.id;
end;
$$;

-- แผนงานที่ต้องส่ง [{name, qty, unit, due_days}] (ไม่เกิน 30 รายการ) — แบบเดียวกันทั้งแพ็กเกจและบนงาน
create or replace function public.wed_read_plan(p_value jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_name text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return v_out;
  end if;
  if jsonb_typeof(p_value) <> 'array' then
    raise exception 'รายการงานที่ส่งไม่ถูกต้อง';
  end if;
  if jsonb_array_length(p_value) > 30 then
    raise exception 'รายการงานที่ส่งใส่ได้ไม่เกิน 30 รายการ';
  end if;
  for v_elem in select e.elem from jsonb_array_elements(p_value) as e(elem)
  loop
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'รายการงานที่ส่งไม่ถูกต้อง';
    end if;
    v_name := public.wed_json_text(v_elem -> 'name', 'ชื่องานที่ส่ง', 120);
    if v_name is null then
      continue;   -- แถวว่างในฟอร์ม = ไม่นับ
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'name', v_name,
      'qty', coalesce(public.wed_json_int(v_elem -> 'qty', 'จำนวนงานที่ส่ง', 1, 100000), 1),
      'unit', public.wed_json_text(v_elem -> 'unit', 'หน่วยของงานที่ส่ง', 30),
      'due_days', coalesce(public.wed_json_int(v_elem -> 'due_days', 'จำนวนวันส่งงาน', 0, 365), 30)));
  end loop;
  return v_out;
end;
$$;

-- หัวงานจาก payload (คีย์ที่ไม่ส่งมา = คงค่าเดิมของ p_old; p_old.id = null → งานใหม่)
--   แพ็กเกจ: package_id → จำชื่อ/ราคา/ชั่วโมง/รายละเอียด/แผนงานส่ง ณ ตอนเลือก; ส่ง package_name/package_price/... มาด้วย = แก้เฉพาะงานนี้
--   แผนงานส่ง (deliverables_plan) แก้ได้จนกว่าจะยืนยันงาน (หลังยืนยันให้แก้ที่รายการส่งงานแทน)
create or replace function public.wed_read_head(p jsonb, p_old public.wed_bookings)
returns public.wed_bookings
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.wed_bookings := p_old;
  v_new boolean := p_old.id is null;
  v_pkg_id uuid;
  pk public.wed_packages%rowtype;
  v_plan_open boolean;
  v_plan jsonb;
  v_num numeric;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'ข้อมูลงานไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  v_plan_open := v_new or p_old.status in ('inquiry', 'hold') or (p_old.status = 'postponed' and p_old.confirmed_at is null);
  if v_new then
    b.package_price := 0;
    b.travel_fee := 0;
    b.discount := 0;
    b.deliverables_plan := '[]'::jsonb;
  end if;

  if v_new or p ? 'couple_names' then
    b.couple_names := public.wed_json_text(p -> 'couple_names', 'ชื่อคู่บ่าวสาว', 120);
    if b.couple_names is null then
      raise exception 'กรุณากรอกชื่อคู่บ่าวสาว (เช่น คุณมิว & คุณเจ)';
    end if;
  end if;

  if v_new or p ? 'package_id' then
    v_pkg_id := public.product_json_uuid(p -> 'package_id', 'แพ็กเกจ');
    if v_pkg_id is not null and (v_new or v_pkg_id is distinct from p_old.package_id) then
      select x.* into pk from public.wed_packages as x where x.id = v_pkg_id;
      if not found then
        raise exception 'ไม่พบแพ็กเกจที่เลือก (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
      end if;
      if not pk.is_active then
        raise exception 'แพ็กเกจ "%" ปิดใช้งานแล้ว กรุณาเลือกแพ็กเกจอื่น', pk.name;
      end if;
      b.package_id := pk.id;
      b.package_name := pk.name;
      b.package_price := pk.price;
      b.package_hours := pk.hours;
      b.package_description := pk.description;
      if v_plan_open then
        b.deliverables_plan := coalesce(pk.deliverables, '[]'::jsonb);
      end if;
    elsif v_pkg_id is null then
      b.package_id := null;
    end if;
  end if;
  if p ? 'package_name' then
    b.package_name := public.wed_json_text(p -> 'package_name', 'ชื่อแพ็กเกจ', 100);
  end if;
  if p ? 'package_price' then
    b.package_price := coalesce(public.wed_json_money(p -> 'package_price', 'ราคาแพ็กเกจ', true), 0);
  end if;
  if p ? 'package_hours' then
    v_num := public.product_json_num(p -> 'package_hours', 'ชั่วโมงของแพ็กเกจ');
    if v_num is not null and (v_num < 0 or v_num > 999.9 or v_num <> round(v_num, 1)) then
      raise exception 'ชั่วโมงของแพ็กเกจต้องอยู่ระหว่าง 0 ถึง 999.9 (ทศนิยม 1 ตำแหน่ง)';
    end if;
    b.package_hours := v_num;
  end if;
  if p ? 'package_description' then
    b.package_description := public.wed_json_longtext(p -> 'package_description', 'รายละเอียดแพ็กเกจ', 3000);
  end if;
  if b.package_id is null and b.package_name is null and b.package_price > 0 then
    raise exception 'กรุณาใส่ชื่อแพ็กเกจ';
  end if;

  if p ? 'deliverables_plan' then
    v_plan := public.wed_read_plan(p -> 'deliverables_plan');
    if not v_plan_open and v_plan is distinct from coalesce(p_old.deliverables_plan, '[]'::jsonb) then
      raise exception 'แผนงานที่ส่งแก้ได้ก่อนยืนยันงานเท่านั้น — หลังยืนยันให้แก้ที่รายการส่งงานของงานนี้';
    end if;
    b.deliverables_plan := v_plan;
  end if;

  if p ? 'travel_fee' then
    b.travel_fee := coalesce(public.wed_json_money(p -> 'travel_fee', 'ค่าเดินทาง', true), 0);
  end if;
  if p ? 'discount' then
    b.discount := coalesce(public.wed_json_money(p -> 'discount', 'ส่วนลด', true), 0);
  end if;
  if v_new or p ? 'discount_note' then
    b.discount_note := public.wed_json_text(p -> 'discount_note', 'หมายเหตุส่วนลด', 200);
  end if;
  if v_new or p ? 'followup_date' then
    b.followup_date := public.wed_json_date(p -> 'followup_date', 'วันที่ต้องติดตามลูกค้า');
  end if;
  if v_new or p ? 'followup_note' then
    b.followup_note := public.wed_json_text(p -> 'followup_note', 'เรื่องที่ต้องติดตาม', 500);
  end if;
  if v_new or p ? 'coordinator_name' then
    b.coordinator_name := public.wed_json_text(p -> 'coordinator_name', 'ชื่อผู้ประสานงานวันงาน', 100);
  end if;
  if v_new or p ? 'coordinator_phone' then
    b.coordinator_phone := public.wed_json_text(p -> 'coordinator_phone', 'เบอร์ผู้ประสานงานวันงาน', 50);
  end if;
  if v_new or p ? 'mood_link' then
    b.mood_link := public.wed_json_url(p -> 'mood_link', 'ลิงก์มู้ดแอนด์โทน', 500);
  end if;
  if v_new or p ? 'customer_note' then
    b.customer_note := public.wed_json_longtext(p -> 'customer_note', 'ความต้องการของลูกค้า', 2000);
  end if;
  if v_new or p ? 'note' then
    b.note := public.wed_json_longtext(p -> 'note', 'หมายเหตุภายใน', 2000);
  end if;
  if v_new or p ? 'balance_due_date_override' then
    b.balance_due_date_override := public.wed_json_date(p -> 'balance_due_date_override', 'วันชำระยอดคงเหลือ');
  end if;
  return b;
end;
$$;

-- คิวงานจาก payload → รายการที่ตรวจแล้ว (ยังไม่เขียน)
--   p_sessions = คิว "ทั้งหมด" ของงาน [{id?, session_type, title, date, start_time, end_time, call_time, venue_*, map_url,
--                dress_code, notes, run_sheet:[{time, text}], status?, crew:[{crew_id, role?, fee? (ผู้จัดการ), note?}]}]
--   p_require_dates = ต้องมีวันที่ทุกคิว (ยกเว้นคิวที่ยกเลิก) — งานที่ "สอบถาม"/"เลื่อนงาน" ยังไม่ต้องมีวัน
--   ค่าตัว: ผู้จัดการกำหนดได้ (ไม่ส่ง = ค่าเดิม/ค่าตัวเริ่มต้น) / พนักงาน = ค่าเดิมของคนเดิมในคิวเดิม หรือค่าตัวเริ่มต้นเสมอ
create or replace function public.wed_read_sessions(p_sessions jsonb, p_booking_id uuid, p_require_dates boolean,
                                                    p_manager boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := public.pos_bkk_today();
  v_out jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_idx integer := 0;
  v_id uuid;
  v_ids uuid[] := '{}';
  o public.wed_sessions%rowtype;
  v_type text;
  v_title text;
  v_date date;
  v_st time;
  v_et time;
  v_ct time;
  v_status text;
  v_rs jsonb;
  v_rrow jsonb;
  v_rtime time;
  v_rtext text;
  v_crew jsonb;
  v_c jsonb;
  v_cid uuid;
  v_cids uuid[];
  cr public.wed_crew%rowtype;
  v_role text;
  v_fee numeric;
  v_old_fee numeric;
  v_kept boolean;
  v_label text;
  v_pairs text[] := '{}';
  v_used text[] := '{}';
  v_moved record;
begin
  if p_sessions is null or jsonb_typeof(p_sessions) <> 'array' or jsonb_array_length(p_sessions) = 0 then
    raise exception 'กรุณาเพิ่มคิวงานอย่างน้อย 1 คิว';
  end if;
  if jsonb_array_length(p_sessions) > 10 then
    raise exception 'งานหนึ่งมีคิวงานได้ไม่เกิน 10 คิว';
  end if;

  -- คู่ (คิวเดิม, ทีมงาน) ที่ยังอยู่ในรายการใหม่ — แถวเดิมที่ไม่อยู่ในนี้ = ทีมถูกย้าย/เอาออก/คิวถูกลบ
  --   ใช้หาค่าตัวเดิมของทีมที่ "ย้ายคิว" ในงานเดียวกัน (อ่านเป็นข้อความเฉยๆ ค่าที่ผิดรูปแบบไป error ตอนตรวจจริงด้านล่าง)
  if p_booking_id is not null then
    select coalesce(array_agg(lower(e.sid) || ':' || lower(k.cid)), '{}')
      into v_pairs
      from (select coalesce(case when jsonb_typeof(x.elem -> 'id') = 'string' then x.elem ->> 'id' end,
                            case when jsonb_typeof(x.elem -> 'session_id') = 'string' then x.elem ->> 'session_id' end) as sid,
                   x.elem
              from jsonb_array_elements(p_sessions) as x(elem)
             where jsonb_typeof(x.elem) = 'object' and jsonb_typeof(x.elem -> 'crew') = 'array') as e
     cross join lateral (select case jsonb_typeof(c.elem) when 'string' then c.elem #>> '{}'
                                                          when 'object' then c.elem ->> 'crew_id' end as cid
                           from jsonb_array_elements(e.elem -> 'crew') as c(elem)) as k
     where e.sid is not null and k.cid is not null;
  end if;

  for v_elem in select e.elem from jsonb_array_elements(p_sessions) as e(elem)
  loop
    v_idx := v_idx + 1;
    v_label := 'คิวที่ ' || v_idx;
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'ข้อมูลคิวงานไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
    end if;
    v_id := coalesce(public.product_json_uuid(v_elem -> 'id', 'คิวงาน'), public.product_json_uuid(v_elem -> 'session_id', 'คิวงาน'));
    o := null;
    if v_id is not null then
      if p_booking_id is null then
        raise exception 'ข้อมูลคิวงานไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
      end if;
      if v_id = any(v_ids) then
        raise exception 'มีคิวงานซ้ำกัน กรุณาโหลดหน้าใหม่';
      end if;
      select x.* into o from public.wed_sessions as x where x.id = v_id and x.booking_id = p_booking_id;
      if not found then
        raise exception 'ไม่พบคิวงานนี้ในงาน (อาจถูกแก้จากเครื่องอื่น) กรุณาโหลดหน้าใหม่';
      end if;
      v_ids := v_ids || v_id;
    end if;

    v_type := coalesce(public.wed_json_text(v_elem -> 'session_type', 'ประเภทคิวงาน', 20), o.session_type, 'reception');
    if v_type not in ('engagement', 'ceremony', 'reception', 'prewedding', 'other') then
      raise exception '%: ประเภทคิวงานไม่ถูกต้อง', v_label;
    end if;
    v_title := public.wed_json_text(v_elem -> 'title', 'ชื่อคิวงาน', 120);
    v_status := coalesce(public.wed_json_text(v_elem -> 'status', 'สถานะคิวงาน', 20), o.status, 'scheduled');
    if v_status not in ('scheduled', 'done', 'cancelled') then
      raise exception '%: สถานะคิวงานไม่ถูกต้อง', v_label;
    end if;
    v_date := public.wed_json_date(v_elem -> 'date', 'วันที่ของ' || v_label);
    if v_date is null and p_require_dates and v_status <> 'cancelled' then
      raise exception 'กรุณาระบุวันที่ของ%', v_label;
    end if;
    if v_date is not null and v_date is distinct from o.date then
      if v_date < v_today - 730 then
        raise exception 'วันที่ของ%ย้อนหลังได้ไม่เกิน 2 ปี', v_label;
      end if;
      if v_date > v_today + 1100 then
        raise exception 'วันที่ของ%ล่วงหน้าได้ไม่เกิน 3 ปี', v_label;
      end if;
    end if;
    v_st := public.wed_json_time(v_elem -> 'start_time', 'เวลาเริ่มของ' || v_label);
    v_et := public.wed_json_time(v_elem -> 'end_time', 'เวลาเลิกของ' || v_label);
    v_ct := public.wed_json_time(v_elem -> 'call_time', 'เวลาทีมถึงงานของ' || v_label);
    if v_st is not null and v_et is not null and v_et <= v_st then
      raise exception '%: เวลาเลิกต้องหลังเวลาเริ่ม', v_label;
    end if;
    if v_ct is not null and v_st is not null and v_ct > v_st then
      raise exception '%: เวลาทีมถึงงานต้องไม่ช้ากว่าเวลาเริ่มงาน', v_label;
    end if;
    if v_ct is not null and v_st is null and v_et is not null and v_ct >= v_et then
      raise exception '%: เวลาทีมถึงงานต้องก่อนเวลาเลิก', v_label;
    end if;

    -- กำหนดการ (ฤกษ์) ไม่เกิน 40 แถว — แถวที่ไม่มีข้อความ = ไม่นับ
    v_rs := '[]'::jsonb;
    if jsonb_typeof(v_elem -> 'run_sheet') = 'array' then
      if jsonb_array_length(v_elem -> 'run_sheet') > 40 then
        raise exception '%: กำหนดการใส่ได้ไม่เกิน 40 แถว', v_label;
      end if;
      for v_rrow in select e.elem from jsonb_array_elements(v_elem -> 'run_sheet') as e(elem)
      loop
        if jsonb_typeof(v_rrow) <> 'object' then
          raise exception '%: กำหนดการไม่ถูกต้อง', v_label;
        end if;
        v_rtime := public.wed_json_time(v_rrow -> 'time', 'เวลาในกำหนดการ');
        v_rtext := public.wed_json_text(v_rrow -> 'text', 'รายการในกำหนดการ', 200);
        if v_rtext is null then
          if v_rtime is not null then
            raise exception '%: กรุณาใส่รายละเอียดของกำหนดการเวลา % น.', v_label, to_char(v_rtime, 'HH24:MI');
          end if;
          continue;
        end if;
        v_rs := v_rs || jsonb_build_array(jsonb_build_object('time', public.wed_hhmm(v_rtime), 'text', v_rtext));
      end loop;
    elsif v_elem ? 'run_sheet' and jsonb_typeof(v_elem -> 'run_sheet') <> 'null' then
      raise exception '%: กำหนดการไม่ถูกต้อง', v_label;
    end if;

    -- ทีมงานในคิว
    v_crew := '[]'::jsonb;
    v_cids := '{}';
    if jsonb_typeof(v_elem -> 'crew') = 'array' then
      if jsonb_array_length(v_elem -> 'crew') > 20 then
        raise exception '%: ทีมงานในคิวเดียวได้ไม่เกิน 20 คน', v_label;
      end if;
      for v_c in select e.elem from jsonb_array_elements(v_elem -> 'crew') as e(elem)
      loop
        if jsonb_typeof(v_c) = 'string' then
          v_c := jsonb_build_object('crew_id', v_c);
        elsif jsonb_typeof(v_c) <> 'object' then
          raise exception '%: ข้อมูลทีมงานไม่ถูกต้อง', v_label;
        end if;
        v_cid := public.product_json_uuid(v_c -> 'crew_id', 'ทีมงาน');
        if v_cid is null then
          raise exception '%: กรุณาเลือกทีมงาน', v_label;
        end if;
        if v_cid = any(v_cids) then
          raise exception '%: เลือกทีมงานคนเดียวกันซ้ำ', v_label;
        end if;
        select x.* into cr from public.wed_crew as x where x.id = v_cid;
        if not found then
          raise exception '%: ไม่พบทีมงานที่เลือก (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่', v_label;
        end if;
        select sc.fee into v_old_fee from public.wed_session_crew as sc where sc.session_id = v_id and sc.crew_id = v_cid;
        v_kept := found;
        -- ทีมคนนี้ย้ายมาจากคิวอื่นของงานเดียวกัน (ย้ายคิว / เอาออกแล้วใส่ใหม่ / ลบคิวแล้วสร้างใหม่)
        --   → ใช้ค่าตัวเดิมที่ผู้จัดการตกลงไว้ (พนักงานมองไม่เห็นค่าตัว ห้ามรีเซ็ตเป็นค่าตัวตั้งต้นเงียบๆ)
        --   แถวเดิมแต่ละแถวใช้ได้ครั้งเดียว (ใส่ทีมเพิ่มอีกคิว = คิวใหม่จริง ใช้ค่าตัวตั้งต้น)
        if not v_kept and p_booking_id is not null then
          select sc.fee, sc.session_id::text || ':' || sc.crew_id::text as k into v_moved
            from public.wed_session_crew as sc
            join public.wed_sessions as ss on ss.id = sc.session_id
           where ss.booking_id = p_booking_id and sc.crew_id = v_cid
             and not ((sc.session_id::text || ':' || sc.crew_id::text) = any(v_pairs))
             and not ((sc.session_id::text || ':' || sc.crew_id::text) = any(v_used))
           order by ss.sort_order, ss.date nulls last, ss.id
           limit 1;
          if found then
            v_used := v_used || v_moved.k;
            v_old_fee := v_moved.fee;
            v_kept := true;
          end if;
        end if;
        if not cr.is_active and not v_kept then
          raise exception '%: ทีมงาน % ปิดใช้งานอยู่', v_label, coalesce(cr.nickname, cr.name);
        end if;
        v_role := coalesce(public.wed_json_text(v_c -> 'role', 'หน้าที่ของทีมงาน', 20), cr.role);
        if v_role not in ('photo', 'video', 'content', 'drone', 'assistant', 'editor', 'makeup', 'other') then
          raise exception '%: หน้าที่ของทีมงานไม่ถูกต้อง', v_label;
        end if;
        v_fee := null;
        if p_manager then
          v_fee := public.wed_json_money(v_c -> 'fee', 'ค่าตัวทีมงาน', true);
        end if;
        v_fee := coalesce(v_fee, case when v_kept then v_old_fee end, cr.default_fee, 0);
        v_cids := v_cids || v_cid;
        v_crew := v_crew || jsonb_build_array(jsonb_build_object(
          'crew_id', v_cid, 'role', v_role, 'fee', v_fee,
          'note', public.wed_json_text(v_c -> 'note', 'หมายเหตุทีมงาน', 300)));
      end loop;
    elsif v_elem ? 'crew' and jsonb_typeof(v_elem -> 'crew') <> 'null' then
      raise exception '%: ข้อมูลทีมงานไม่ถูกต้อง', v_label;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'session_id', v_id, 'session_type', v_type, 'title', v_title, 'date', v_date,
      'start_time', v_st, 'end_time', v_et, 'call_time', v_ct,
      'venue_name', public.wed_json_text(v_elem -> 'venue_name', 'ชื่อสถานที่', 150),
      'venue_address', public.wed_json_longtext(v_elem -> 'venue_address', 'ที่อยู่สถานที่', 500),
      'map_url', public.wed_json_url(v_elem -> 'map_url', 'ลิงก์แผนที่', 500),
      'venue_contact', public.wed_json_text(v_elem -> 'venue_contact', 'ผู้ติดต่อที่สถานที่', 150),
      'dress_code', public.wed_json_longtext(v_elem -> 'dress_code', 'การแต่งกายของทีม', 2000),
      'notes', public.wed_json_longtext(v_elem -> 'notes', 'หมายเหตุคิวงาน', 2000),
      'run_sheet', v_rs, 'status', v_status, 'sort_order', v_idx, 'crew', v_crew));
  end loop;
  return v_out;
end;
$$;

-- เขียนคิวงานตามผลของ wed_read_sessions: คิวที่หายไปจากรายการ = ลบ / ทีมที่หายไป = เอาออก
--   ค่าตัวที่ "จ่ายแล้ว" ห้ามหาย/ห้ามเปลี่ยน (ยอดจ่ายทีมงานต้องตรงกับที่จ่ายจริง — ยกเลิกการจ่ายก่อนถ้าจำเป็น)
create or replace function public.wed_write_sessions(p_booking_id uuid, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keep uuid[];
  v_elem jsonb;
  v_sid uuid;
  v_c jsonb;
  r record;
begin
  select coalesce(array_agg((e.elem ->> 'id')::uuid) filter (where e.elem ->> 'id' is not null), '{}')
    into v_keep
    from jsonb_array_elements(p_rows) as e(elem);

  -- ทีมที่จ่ายค่าตัวแล้วแต่กำลังจะหายจากคิว
  select c.name, sc.fee_paid_on into r
    from public.wed_session_crew as sc
    join public.wed_sessions as ss on ss.id = sc.session_id
    join public.wed_crew as c on c.id = sc.crew_id
   where ss.booking_id = p_booking_id and sc.fee_paid_on is not null
     and not exists (
       select 1 from jsonb_array_elements(p_rows) as e(elem)
        cross join lateral jsonb_array_elements(e.elem -> 'crew') as k(elem)
        where (e.elem ->> 'id')::uuid = ss.id and (k.elem ->> 'crew_id')::uuid = sc.crew_id)
   limit 1;
  if found then
    raise exception 'ค่าตัวของ % ในคิวนี้จ่ายแล้ว (%) นำออกจากคิวไม่ได้ — ยกเลิกการจ่ายค่าตัวก่อน', r.name, public.wed_thai_date(r.fee_paid_on);
  end if;
  select c.name into r
    from public.wed_session_crew as sc
    join public.wed_sessions as ss on ss.id = sc.session_id
    join public.wed_crew as c on c.id = sc.crew_id
    join lateral (select (k.elem ->> 'fee')::numeric as fee
                    from jsonb_array_elements(p_rows) as e(elem)
                   cross join lateral jsonb_array_elements(e.elem -> 'crew') as k(elem)
                   where (e.elem ->> 'id')::uuid = ss.id and (k.elem ->> 'crew_id')::uuid = sc.crew_id) as nf on true
   where ss.booking_id = p_booking_id and sc.fee_paid_on is not null and nf.fee <> sc.fee
   limit 1;
  if found then
    raise exception 'ค่าตัวของ % ในคิวนี้จ่ายแล้ว แก้ค่าตัวไม่ได้ — ยกเลิกการจ่ายค่าตัวก่อน', r.name;
  end if;
  -- คิวที่มีค่าตัวจ่ายแล้วกำลังถูกตั้งเป็น "ยกเลิก" (ค่าตัวที่จ่ายจริงต้องไม่หายจากยอดจ่าย/ต้นทุน)
  select c.name, sc.fee_paid_on into r
    from public.wed_session_crew as sc
    join public.wed_sessions as ss on ss.id = sc.session_id
    join public.wed_crew as c on c.id = sc.crew_id
   where ss.booking_id = p_booking_id and sc.fee_paid_on is not null and ss.status <> 'cancelled'
     and exists (select 1 from jsonb_array_elements(p_rows) as e(elem)
                  where (e.elem ->> 'id')::uuid = ss.id and e.elem ->> 'status' = 'cancelled')
   limit 1;
  if found then
    raise exception 'คิวนี้มีค่าตัวของ % ที่จ่ายแล้ว (%) ยกเลิกคิวไม่ได้ — ยกเลิกการจ่ายค่าตัวก่อน', r.name, public.wed_thai_date(r.fee_paid_on);
  end if;

  delete from public.wed_sessions as ss where ss.booking_id = p_booking_id and not (ss.id = any(v_keep));

  for v_elem in select e.elem from jsonb_array_elements(p_rows) as e(elem)
  loop
    v_sid := (v_elem ->> 'id')::uuid;
    if v_sid is not null then
      update public.wed_sessions as ss
         set session_type = v_elem ->> 'session_type', title = v_elem ->> 'title', date = (v_elem ->> 'date')::date,
             start_time = (v_elem ->> 'start_time')::time, end_time = (v_elem ->> 'end_time')::time,
             call_time = (v_elem ->> 'call_time')::time, venue_name = v_elem ->> 'venue_name',
             venue_address = v_elem ->> 'venue_address', map_url = v_elem ->> 'map_url',
             venue_contact = v_elem ->> 'venue_contact', dress_code = v_elem ->> 'dress_code', notes = v_elem ->> 'notes',
             run_sheet = v_elem -> 'run_sheet', status = v_elem ->> 'status', sort_order = (v_elem ->> 'sort_order')::integer
       where ss.id = v_sid and ss.booking_id = p_booking_id;
    else
      insert into public.wed_sessions as ss
        (booking_id, session_type, title, date, start_time, end_time, call_time, venue_name, venue_address, map_url,
         venue_contact, dress_code, notes, run_sheet, status, sort_order)
      values
        (p_booking_id, v_elem ->> 'session_type', v_elem ->> 'title', (v_elem ->> 'date')::date,
         (v_elem ->> 'start_time')::time, (v_elem ->> 'end_time')::time, (v_elem ->> 'call_time')::time,
         v_elem ->> 'venue_name', v_elem ->> 'venue_address', v_elem ->> 'map_url', v_elem ->> 'venue_contact',
         v_elem ->> 'dress_code', v_elem ->> 'notes', v_elem -> 'run_sheet', v_elem ->> 'status',
         (v_elem ->> 'sort_order')::integer)
      returning ss.id into v_sid;
    end if;

    delete from public.wed_session_crew as sc
     where sc.session_id = v_sid
       and not exists (select 1 from jsonb_array_elements(v_elem -> 'crew') as k(elem)
                        where (k.elem ->> 'crew_id')::uuid = sc.crew_id);
    for v_c in select k.elem from jsonb_array_elements(v_elem -> 'crew') as k(elem)
    loop
      insert into public.wed_session_crew as sc (session_id, crew_id, role, fee, note)
      values (v_sid, (v_c ->> 'crew_id')::uuid, v_c ->> 'role', (v_c ->> 'fee')::numeric, v_c ->> 'note')
      on conflict (session_id, crew_id) do update
        set role = excluded.role, fee = excluded.fee, note = excluded.note;
    end loop;
  end loop;
end;
$$;

-- บริการเสริมจาก payload [{id?, addon_id?, name?, unit?, qty, unit_price?}] (ไม่เกิน 30 รายการ)
--   เลือกจากรายการบริการเสริม: ไม่ส่งชื่อ/ราคา = ใช้ของรายการ ณ ตอนนี้ / ยอด = จำนวน × ราคาต่อหน่วย (ปัด 2 ตำแหน่ง)
create or replace function public.wed_read_addons(p_addons jsonb, p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_idx integer := 0;
  v_id uuid;
  v_ids uuid[] := '{}';
  o public.wed_booking_addons%rowtype;
  v_aid uuid;
  ad public.wed_addons%rowtype;
  v_name text;
  v_qty numeric;
  v_price numeric;
  v_amount numeric;
begin
  if p_addons is null or jsonb_typeof(p_addons) = 'null' then
    return v_out;
  end if;
  if jsonb_typeof(p_addons) <> 'array' then
    raise exception 'ข้อมูลบริการเสริมไม่ถูกต้อง';
  end if;
  if jsonb_array_length(p_addons) > 30 then
    raise exception 'บริการเสริมใส่ได้ไม่เกิน 30 รายการ';
  end if;
  for v_elem in select e.elem from jsonb_array_elements(p_addons) as e(elem)
  loop
    v_idx := v_idx + 1;
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'ข้อมูลบริการเสริมไม่ถูกต้อง';
    end if;
    v_id := public.product_json_uuid(v_elem -> 'id', 'บริการเสริม');
    o := null;
    if v_id is not null then
      if p_booking_id is null or v_id = any(v_ids) then
        raise exception 'ข้อมูลบริการเสริมไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
      end if;
      select x.* into o from public.wed_booking_addons as x where x.id = v_id and x.booking_id = p_booking_id;
      if not found then
        raise exception 'ไม่พบบริการเสริมนี้ในงาน (อาจถูกแก้จากเครื่องอื่น) กรุณาโหลดหน้าใหม่';
      end if;
      v_ids := v_ids || v_id;
    end if;
    v_aid := public.product_json_uuid(v_elem -> 'addon_id', 'บริการเสริม');
    ad := null;
    if v_aid is not null then
      select x.* into ad from public.wed_addons as x where x.id = v_aid;
      if not found then
        raise exception 'ไม่พบบริการเสริมที่เลือก (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
      end if;
      if not ad.is_active and o.addon_id is distinct from v_aid then
        raise exception 'บริการเสริม "%" ปิดใช้งานแล้ว', ad.name;
      end if;
    end if;
    v_name := coalesce(public.wed_json_text(v_elem -> 'name', 'ชื่อบริการเสริม', 100), ad.name, o.name);
    if v_name is null then
      raise exception 'กรุณาใส่ชื่อบริการเสริมรายการที่ %', v_idx;
    end if;
    v_qty := coalesce(public.product_json_num(v_elem -> 'qty', 'จำนวนบริการเสริม'), 1);
    if v_qty <= 0 or v_qty > 9999 or v_qty <> round(v_qty, 2) then
      raise exception 'จำนวนของ "%" ต้องมากกว่า 0 และไม่เกิน 9,999 (ทศนิยมไม่เกิน 2 ตำแหน่ง)', v_name;
    end if;
    v_price := coalesce(public.wed_json_money(v_elem -> 'unit_price', 'ราคาบริการเสริม', true),
                        case when o.id is not null and o.addon_id is not distinct from v_aid then o.unit_price end,
                        ad.price, 0);
    v_amount := round(v_qty * v_price, 2);
    if v_amount > 99999999.99 then
      raise exception 'ยอดของ "%" สูงเกินไป', v_name;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'addon_id', v_aid, 'name', v_name,
      'unit', coalesce(public.wed_json_text(v_elem -> 'unit', 'หน่วยบริการเสริม', 30),
                       case when v_elem ? 'unit' then null else coalesce(ad.unit, o.unit) end),
      'qty', v_qty, 'unit_price', v_price, 'amount', v_amount, 'sort_order', v_idx));
  end loop;
  return v_out;
end;
$$;

create or replace function public.wed_write_addons(p_booking_id uuid, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_elem jsonb;
begin
  delete from public.wed_booking_addons as a
   where a.booking_id = p_booking_id
     and not exists (select 1 from jsonb_array_elements(p_rows) as e(elem) where (e.elem ->> 'id')::uuid = a.id);
  for v_elem in select e.elem from jsonb_array_elements(p_rows) as e(elem)
  loop
    if v_elem ->> 'id' is not null then
      update public.wed_booking_addons as a
         set addon_id = (v_elem ->> 'addon_id')::uuid, name = v_elem ->> 'name', unit = v_elem ->> 'unit',
             qty = (v_elem ->> 'qty')::numeric, unit_price = (v_elem ->> 'unit_price')::numeric,
             amount = (v_elem ->> 'amount')::numeric, sort_order = (v_elem ->> 'sort_order')::integer
       where a.id = (v_elem ->> 'id')::uuid and a.booking_id = p_booking_id;
    else
      insert into public.wed_booking_addons (booking_id, addon_id, name, unit, qty, unit_price, amount, sort_order)
      values (p_booking_id, (v_elem ->> 'addon_id')::uuid, v_elem ->> 'name', v_elem ->> 'unit',
              (v_elem ->> 'qty')::numeric, (v_elem ->> 'unit_price')::numeric, (v_elem ->> 'amount')::numeric,
              (v_elem ->> 'sort_order')::integer);
    end if;
  end loop;
end;
$$;

-- วันที่ของคิวที่ไม่ยกเลิก (จากผลของ wed_read_sessions)
create or replace function public.wed_rows_dates(p_rows jsonb)
returns date[]
language sql
immutable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct (e.elem ->> 'date')::date) filter (where e.elem ->> 'date' is not null
                                                                       and e.elem ->> 'status' <> 'cancelled'), '{}')
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as e(elem)
$$;

create or replace function public.wed_booking_dates(p_booking_id uuid)
returns date[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct ss.date) filter (where ss.date is not null), '{}')
    from public.wed_sessions as ss
   where ss.booking_id = p_booking_id and ss.status <> 'cancelled'
$$;

-- ส่งงานครบทุกรายการระหว่าง "ถ่ายเสร็จ รอส่งงาน" → "ส่งงานแล้ว" อัตโนมัติ / มีรายการกลับไปยังไม่ส่ง → กลับเป็นรอส่งงาน
create or replace function public.wed_sync_delivered(p_booking_id uuid, p_reopened boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.wed_bookings%rowtype;
  v_total integer;
  v_open integer;
begin
  select x.* into b from public.wed_bookings as x where x.id = p_booking_id;
  if not found then
    return;
  end if;
  select count(*), count(*) filter (where d.status <> 'delivered') into v_total, v_open
    from public.wed_deliverables as d where d.booking_id = b.id;
  if b.status = 'in_production' and v_total > 0 and v_open = 0 then
    update public.wed_bookings as x set status = 'delivered', delivered_at = now() where x.id = b.id;
    perform public.wed_log(b.id, 'auto_delivered', jsonb_build_object('deliverables', v_total));
  elsif b.status = 'delivered' and p_reopened and v_open > 0 then
    update public.wed_bookings as x set status = 'in_production', delivered_at = null where x.id = b.id;
    perform public.wed_log(b.id, 'auto_back_to_production', jsonb_build_object('open', v_open));
  end if;
end;
$$;

-- รับเงิน/คืนเงิน (ภายใน) → id รายการ — ตรวจกฎเงินทุกข้อ (ผู้เรียกล็อกงานไว้แล้ว)
--   วันที่รับเงิน: ไม่เป็นวันในอนาคต / พนักงานย้อนหลังได้ไม่เกิน 60 วัน / ผู้จัดการย้อนหลังได้ไม่เกิน 3 ปี
--   วัตถุประสงค์ไม่ส่ง = เดาให้: ปิดยอดค้างทั้งหมด → ยอดคงเหลือ / ยังไม่ครบมัดจำ → มัดจำ / อื่นๆ → ชำระงวด
create or replace function public.wed_add_payment_core(p_booking_id uuid, p_client_id uuid, p_kind text, p_method text,
                                                       p_amount numeric, p_paid_on date, p_purpose text, p_note text,
                                                       p_slip_path text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := public.pos_bkk_today();
  b public.wed_bookings%rowtype;
  v_note text;
  v_paid_on date := coalesce(p_paid_on, public.pos_bkk_today());
  v_purpose text := p_purpose;
  v_receipt text;
  v_id uuid;
  v_prefix text;
begin
  if p_kind is null or p_kind not in ('payment', 'refund') then
    raise exception 'ประเภทรายการเงินไม่ถูกต้อง (รับชำระ / คืนเงิน)';
  end if;
  if p_method is null or p_method not in ('cash', 'transfer', 'promptpay', 'credit') then
    raise exception 'กรุณาเลือกวิธีชำระเงิน (เงินสด / โอนเงิน / พร้อมเพย์ / บัตรเครดิต)';
  end if;
  perform public.wed_check_money(p_amount, 'จำนวนเงิน', false);
  v_note := nullif(public.product_clean_text(p_note), '');
  if char_length(v_note) > 300 then
    raise exception 'หมายเหตุยาวเกินไป (สูงสุด 300 ตัวอักษร)';
  end if;
  if v_purpose is not null and v_purpose not in ('deposit', 'installment', 'balance', 'extra', 'other') then
    raise exception 'วัตถุประสงค์ของรายการเงินไม่ถูกต้อง';
  end if;
  if v_paid_on > v_today then
    raise exception 'วันที่รับเงินต้องไม่เป็นวันในอนาคต';
  end if;
  if v_paid_on < v_today - 60 and not public.wed_manager() then
    raise exception 'วันที่รับเงินย้อนหลังได้ไม่เกิน 60 วัน (ย้อนหลังกว่านี้ให้ผู้จัดการบันทึก)' using errcode = '42501';
  end if;
  -- ผู้จัดการย้อนหลังได้ แต่ไม่เกิน 3 ปี (กันพิมพ์ปีผิด เช่น 1900 → รายรับไปตกเดือนที่รายงานไม่เคยเปิดดู)
  if v_paid_on < (v_today - interval '3 years')::date then
    raise exception 'วันที่รับเงินย้อนหลังได้ไม่เกิน 3 ปี กรุณาตรวจปีที่กรอก';
  end if;

  select x.* into b from public.wed_bookings as x where x.id = p_booking_id;
  if not found then
    raise exception 'ไม่พบงานนี้';
  end if;
  if p_slip_path is not null then
    v_prefix := b.id::text || '/';
    if left(p_slip_path, char_length(v_prefix)) <> v_prefix
       or substr(p_slip_path, char_length(v_prefix) + 1) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' then
      raise exception 'ที่อยู่ไฟล์สลิปไม่ถูกต้อง กรุณาอัปโหลดสลิปใหม่';
    end if;
  end if;

  if p_kind = 'payment' then
    if b.status = 'cancelled' then
      raise exception 'งานนี้ยกเลิกแล้ว รับชำระไม่ได้ (บันทึกคืนเงินได้)';
    end if;
    if b.due <= 0.005 then
      raise exception 'งานนี้ไม่มียอดค้างชำระ';
    end if;
    if p_amount > b.due + 0.005 then
      raise exception 'ยอดชำระ % เกินยอดค้าง %', public.wed_baht(p_amount), public.wed_baht(b.due);
    end if;
    if v_purpose is null then
      -- ปิดยอดค้างทั้งหมดในครั้งเดียว = ยอดคงเหลือ (แม้ยังไม่เคยมัดจำ — ใบเสร็จต้องไม่เขียนว่า "มัดจำ" ตอนจ่ายครบ)
      v_purpose := case when p_amount >= b.due - 0.005 then 'balance'
                        when b.paid + 0.005 < b.deposit_required then 'deposit'
                        else 'installment' end;
    end if;
  else
    -- ปิดงานแล้ว = เงินลงตัวแล้ว — คืนเงินทีหลังจะทำให้งานที่ปิดแล้วมียอดค้างขึ้นมาใหม่
    if b.status = 'completed' then
      raise exception 'งานนี้ปิดแล้ว (ยอดเงินลงตัวแล้ว) คืนเงินไม่ได้ — ผู้จัดการเปิดงานใหม่ก่อน';
    end if;
    if b.paid <= 0.005 then
      raise exception 'งานนี้ยังไม่มีเงินที่ชำระไว้ให้คืน';
    end if;
    if p_amount > b.paid + 0.005 then
      raise exception 'คืนเงินได้ไม่เกินยอดที่ชำระแล้ว %', public.wed_baht(b.paid);
    end if;
  end if;

  v_receipt := public.wed_next_no('wedding_receipt');
  begin
    insert into public.wed_payments as p
      (client_id, booking_id, receipt_no, kind, method, amount, paid_on, purpose, slip_path, note, created_by, created_by_name)
    values
      (p_client_id, b.id, v_receipt, p_kind, p_method, p_amount, v_paid_on, v_purpose, p_slip_path, v_note,
       v_uid, public.pos_actor_name(v_uid))
    returning p.id into v_id;
  exception when unique_violation then
    raise exception 'รายการนี้กำลังบันทึกจากอีกเครื่อง กรุณาโหลดหน้าใหม่';
  end;

  perform public.wed_recalc(b.id);
  perform public.wed_log(b.id, p_kind,
    jsonb_build_object('payment_id', v_id, 'method', p_method, 'amount', p_amount, 'paid_on', v_paid_on,
                       'purpose', v_purpose, 'receipt_no', v_receipt));
  return v_id;
end;
$$;

-- สร้างรายการส่งงานจากแผนงานส่งของงาน (ครั้งเดียว — มีรายการอยู่แล้วไม่สร้างซ้ำ)
--   กำหนดส่ง = วันงานวันสุดท้าย + จำนวนวันส่งงานของแต่ละรายการ
create or replace function public.wed_make_deliverables(p_booking_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.wed_bookings%rowtype;
  v_n integer;
begin
  select x.* into b from public.wed_bookings as x where x.id = p_booking_id;
  if not found or exists (select 1 from public.wed_deliverables as d where d.booking_id = b.id) then
    return 0;
  end if;
  insert into public.wed_deliverables (booking_id, name, qty, unit, due_date, sort_order)
  select b.id, e.elem ->> 'name', coalesce((e.elem ->> 'qty')::integer, 1), e.elem ->> 'unit',
         b.last_session_date + coalesce((e.elem ->> 'due_days')::integer, 30), e.ord::integer
    from jsonb_array_elements(coalesce(b.deliverables_plan, '[]'::jsonb)) with ordinality as e(elem, ord);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ยืนยันงาน (ภายใน — งานถูกล็อกไว้แล้ว) จาก "สอบถาม" หรือ "ล็อกคิว"
--   ต้องมีคิวที่ระบุวันที่ / คิวเต็ม (จากสอบถาม) หรือยังไม่ได้รับมัดจำ → ต้องกดยืนยันแบบบังคับ (p_force)
create or replace function public.wed_confirm_core(p_booking_id uuid, p_force boolean, p_skip_capacity boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.wed_bookings%rowtype;
  v_dates date[];
  v_warn jsonb;
  v_made integer;
begin
  select x.* into b from public.wed_bookings as x where x.id = p_booking_id;
  v_dates := public.wed_booking_dates(b.id);
  if coalesce(array_length(v_dates, 1), 0) = 0 then
    raise exception 'ยืนยันงานไม่ได้: ต้องมีคิวงานที่ระบุวันที่อย่างน้อย 1 คิว';
  end if;
  -- คิวที่ไม่มีวันจะไม่ถูกนับคิวเต็ม/ทีมชนคิว/ปฏิทิน และฟอร์มแก้งานหลังยืนยันจะบันทึกไม่ได้ → ต้องมีวันครบทุกคิว
  if exists (select 1 from public.wed_sessions as ss where ss.booking_id = b.id and ss.status <> 'cancelled' and ss.date is null) then
    raise exception 'กรุณาระบุวันที่ของทุกคิวงานก่อน (หรือยกเลิกคิวที่ยังไม่มีวัน)';
  end if;
  -- จากสอบถามตรงไปยืนยัน: งวดมัดจำเริ่มนับวันนี้ (จากล็อกคิว = ใช้วันที่ล็อกคิวเดิม)
  if b.status = 'inquiry' then
    update public.wed_bookings as x set deposit_due_on = public.pos_bkk_today() where x.id = b.id;
  end if;
  if not public.wed_counting(b.status) and not p_skip_capacity then
    perform public.wed_capacity_lock(v_dates);
    v_warn := public.wed_capacity_check(b.id, v_dates);
    if jsonb_array_length(v_warn) > 0 and not coalesce(p_force, false) then
      perform public.wed_capacity_raise(v_warn);
    end if;
  end if;
  perform public.wed_recalc(b.id);
  select x.* into b from public.wed_bookings as x where x.id = p_booking_id;
  if not b.deposit_met and not coalesce(p_force, false) then
    raise exception 'ยังไม่ได้รับมัดจำครบ (ได้รับ % จากมัดจำ %) — ต้องกดยืนยันแบบบังคับเพื่อยืนยันงานก่อนรับมัดจำ',
      public.wed_baht(b.paid), public.wed_baht(b.deposit_required)
      using hint = 'wed_deposit';
  end if;
  update public.wed_bookings as x
     set status = 'confirmed', confirmed_at = coalesce(x.confirmed_at, now()), hold_until = null
   where x.id = b.id;
  v_made := public.wed_make_deliverables(b.id);
  perform public.wed_log(b.id, 'confirm',
    jsonb_build_object('from', b.status, 'deposit_met', b.deposit_met, 'paid', b.paid, 'forced', coalesce(p_force, false),
                       'deliverables_created', v_made, 'capacity_over', coalesce(jsonb_array_length(v_warn), 0) > 0));
end;
$$;

-- =========================================================================
-- 7) ตั้งค่าร้าน
-- =========================================================================
create or replace function public.wed_get_settings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.wed_require(false);
  perform public.wed_settings_row();
  return public.wed_settings_json();
end;
$$;

-- p_settings = เฉพาะคีย์ที่ส่งมาเท่านั้นที่ถูกแก้ (หน้าตั้งค่าบันทึกทีละแท็บได้) / ช่องข้อความว่าง = ไม่มีค่า
--   นโยบายมัดจำ/วันชำระที่แก้ที่นี่ ใช้กับงานที่สร้างใหม่เท่านั้น (งานเดิมจำนโยบาย ณ ตอนจองไว้)
create or replace function public.wed_save_settings(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  s public.wed_settings;
  v_text text;
  v_elem jsonb;
  v_accounts jsonb := '[]'::jsonb;
  v_bank text;
  v_no text;
  v_name text;
  v_num numeric;
begin
  v_uid := public.wed_require(true);
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'ข้อมูลตั้งค่าไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  perform public.wed_settings_row();
  select x.* into s from public.wed_settings as x where x.id for update;

  if p_settings ? 'shop_name' then
    s.shop_name := public.wed_json_text(p_settings -> 'shop_name', 'ชื่อร้าน', 100);
    if s.shop_name is null then
      raise exception 'กรุณาใส่ชื่อร้าน';
    end if;
  end if;
  if p_settings ? 'tagline' then s.tagline := public.wed_json_text(p_settings -> 'tagline', 'คำโปรย', 200); end if;
  if p_settings ? 'phone' then s.phone := public.wed_json_text(p_settings -> 'phone', 'เบอร์โทรร้าน', 50); end if;
  if p_settings ? 'line_id' then s.line_id := public.wed_json_text(p_settings -> 'line_id', 'LINE ID', 50); end if;
  if p_settings ? 'line_url' then s.line_url := public.wed_json_url(p_settings -> 'line_url', 'ลิงก์ LINE', 300); end if;
  if p_settings ? 'instagram' then s.instagram := public.wed_json_text(p_settings -> 'instagram', 'Instagram', 300); end if;
  if p_settings ? 'facebook' then s.facebook := public.wed_json_text(p_settings -> 'facebook', 'Facebook', 300); end if;
  if p_settings ? 'tiktok' then s.tiktok := public.wed_json_text(p_settings -> 'tiktok', 'TikTok', 300); end if;
  if p_settings ? 'email' then
    s.email := public.wed_json_text(p_settings -> 'email', 'อีเมลร้าน', 100);
    if s.email is not null and s.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'อีเมลร้านไม่ถูกต้อง';
    end if;
  end if;
  if p_settings ? 'address' then s.address := public.wed_json_longtext(p_settings -> 'address', 'ที่อยู่ร้าน', 500); end if;
  if p_settings ? 'logo_path' then
    v_text := public.wed_json_text(p_settings -> 'logo_path', 'ไฟล์โลโก้', 140);
    if v_text is not null and v_text !~ '^logo/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' then
      raise exception 'ไฟล์โลโก้ไม่ถูกต้อง กรุณาอัปโหลดใหม่';
    end if;
    s.logo_path := v_text;
  end if;
  if p_settings ? 'promptpay_id' then
    v_text := public.wed_json_text(p_settings -> 'promptpay_id', 'พร้อมเพย์', 30);
    if v_text is not null then
      if v_text !~ '^[0-9 -]+$' then
        raise exception 'พร้อมเพย์ใส่ได้เฉพาะตัวเลข (เบอร์มือถือ 10 หลัก หรือเลขผู้เสียภาษี 13 หลัก)';
      end if;
      v_text := regexp_replace(v_text, '[^0-9]', '', 'g');
      if not (v_text ~ '^0[0-9]{9}$' or v_text ~ '^[0-9]{13}$') then
        raise exception 'พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขผู้เสียภาษี 13 หลัก';
      end if;
    end if;
    s.promptpay_id := v_text;
  end if;
  if p_settings ? 'promptpay_name' then
    s.promptpay_name := public.wed_json_text(p_settings -> 'promptpay_name', 'ชื่อบัญชีพร้อมเพย์', 100);
  end if;
  if p_settings ? 'bank_accounts' then
    if jsonb_typeof(p_settings -> 'bank_accounts') = 'null' then
      v_accounts := '[]'::jsonb;
    elsif jsonb_typeof(p_settings -> 'bank_accounts') <> 'array' then
      raise exception 'ข้อมูลบัญชีธนาคารไม่ถูกต้อง';
    else
      if jsonb_array_length(p_settings -> 'bank_accounts') > 5 then
        raise exception 'ใส่บัญชีธนาคารได้ไม่เกิน 5 บัญชี';
      end if;
      for v_elem in select e.elem from jsonb_array_elements(p_settings -> 'bank_accounts') as e(elem)
      loop
        if jsonb_typeof(v_elem) <> 'object' then
          raise exception 'ข้อมูลบัญชีธนาคารไม่ถูกต้อง';
        end if;
        v_bank := public.wed_json_text(v_elem -> 'bank', 'ชื่อธนาคาร', 100);
        v_no := public.wed_json_text(v_elem -> 'account_no', 'เลขบัญชี', 100);
        v_name := public.wed_json_text(v_elem -> 'account_name', 'ชื่อบัญชี', 100);
        if v_bank is null or v_no is null or v_name is null then
          raise exception 'กรุณากรอกธนาคาร เลขบัญชี และชื่อบัญชีให้ครบทุกบัญชี';
        end if;
        v_accounts := v_accounts || jsonb_build_array(jsonb_build_object('bank', v_bank, 'account_no', v_no, 'account_name', v_name));
      end loop;
    end if;
    s.bank_accounts := v_accounts;
  end if;
  if p_settings ? 'deposit_percent' then
    v_num := public.product_json_num(p_settings -> 'deposit_percent', 'เปอร์เซ็นต์มัดจำ');
    if v_num is null or v_num < 0 or v_num > 100 or v_num <> round(v_num, 2) then
      raise exception 'เปอร์เซ็นต์มัดจำต้องอยู่ระหว่าง 0 ถึง 100';
    end if;
    s.deposit_percent := v_num;
  end if;
  if p_settings ? 'min_deposit' then
    s.min_deposit := coalesce(public.wed_json_money(p_settings -> 'min_deposit', 'มัดจำขั้นต่ำ', true), 0);
  end if;
  if p_settings ? 'balance_due_days' then
    s.balance_due_days := coalesce(public.wed_json_int(p_settings -> 'balance_due_days', 'จำนวนวันก่อนวันงานที่ต้องชำระครบ', 0, 365), 7);
  end if;
  if p_settings ? 'hold_hours' then
    s.hold_hours := coalesce(public.wed_json_int(p_settings -> 'hold_hours', 'เวลาล็อกคิวรอมัดจำ (ชั่วโมง)', 1, 720), 72);
  end if;
  if p_settings ? 'max_jobs_per_day' then
    s.max_jobs_per_day := coalesce(public.wed_json_int(p_settings -> 'max_jobs_per_day', 'จำนวนงานสูงสุดต่อวัน', 0, 50), 2);
  end if;
  if p_settings ? 'overtime_rate' then
    s.overtime_rate := coalesce(public.wed_json_money(p_settings -> 'overtime_rate', 'ค่าล่วงเวลาต่อชั่วโมง', true), 0);
  end if;
  if p_settings ? 'terms_text' then
    v_text := public.wed_json_longtext(p_settings -> 'terms_text', 'เงื่อนไขสัญญา', 20000);
    if v_text is null then
      raise exception 'กรุณาใส่เงื่อนไขสัญญา';
    end if;
    s.terms_text := v_text;
  end if;
  if p_settings ? 'booking_note' then
    s.booking_note := public.wed_json_longtext(p_settings -> 'booking_note', 'ข้อความบนเอกสารการจอง', 1000);
  end if;
  if p_settings ? 'receipt_footer' then
    s.receipt_footer := public.wed_json_longtext(p_settings -> 'receipt_footer', 'ข้อความท้ายใบเสร็จ', 300);
  end if;
  if p_settings ? 'portal_enabled' then
    s.portal_enabled := coalesce(public.product_json_bool(p_settings -> 'portal_enabled', 'การเปิดลิงก์ติดตามงานของลูกค้า'), false);
  end if;

  update public.wed_settings as x
     set shop_name = s.shop_name, tagline = s.tagline, phone = s.phone, line_id = s.line_id, line_url = s.line_url,
         instagram = s.instagram, facebook = s.facebook, tiktok = s.tiktok, email = s.email, address = s.address,
         logo_path = s.logo_path, promptpay_id = s.promptpay_id, promptpay_name = s.promptpay_name,
         bank_accounts = s.bank_accounts, deposit_percent = s.deposit_percent, min_deposit = s.min_deposit,
         balance_due_days = s.balance_due_days, hold_hours = s.hold_hours, max_jobs_per_day = s.max_jobs_per_day,
         overtime_rate = s.overtime_rate, terms_text = s.terms_text, booking_note = s.booking_note,
         receipt_footer = s.receipt_footer, portal_enabled = s.portal_enabled, updated_at = now(), updated_by = v_uid
   where x.id;

  return public.wed_settings_json();
end;
$$;

-- =========================================================================
-- 8) แพ็กเกจ + บริการเสริม (ผู้จัดการ) — สร้าง: ส่ง client_id (กดซ้ำไม่เกิดซ้ำ) / แก้: ส่ง id + updated_at ที่โหลดมา
--    คีย์ที่ไม่ส่งมา = คงค่าเดิม (แก้) / ค่าเริ่มต้น (สร้าง)
-- =========================================================================
create or replace function public.wed_save_package(p_package jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pk public.wed_packages%rowtype;
  v_id uuid;
  v_client uuid;
  v_found uuid;
  v_ts text;
  v_num numeric;
  v_new boolean;
begin
  perform public.wed_require(true);
  if p_package is null or jsonb_typeof(p_package) <> 'object' then
    raise exception 'ข้อมูลแพ็กเกจไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  v_id := public.product_json_uuid(p_package -> 'id', 'แพ็กเกจ');
  v_client := public.product_json_uuid(p_package -> 'client_id', 'รหัสคำขอ');
  v_new := v_id is null;
  if v_new then
    if v_client is not null then
      select x.id into v_found from public.wed_packages as x where x.client_id = v_client;
      if found then
        return public.wed_package_json(v_found) || jsonb_build_object('already_saved', true);
      end if;
    end if;
    pk.price := 0; pk.hours := 0; pk.crew_size := 0; pk.deliverables := '[]'::jsonb; pk.is_active := true; pk.sort_order := 0;
  else
    select x.* into pk from public.wed_packages as x where x.id = v_id for update;
    if not found then
      raise exception 'ไม่พบแพ็กเกจนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
    end if;
    v_ts := public.product_json_text(p_package -> 'updated_at', 'เวลาแก้ไขล่าสุด');
    if v_ts is not null and v_ts::timestamptz <> pk.updated_at then
      raise exception 'แพ็กเกจนี้ถูกแก้ไขจากเครื่องอื่น กรุณาโหลดหน้าใหม่แล้วแก้อีกครั้ง';
    end if;
  end if;

  if v_new or p_package ? 'name' then
    pk.name := public.wed_json_text(p_package -> 'name', 'ชื่อแพ็กเกจ', 100);
    if pk.name is null then
      raise exception 'กรุณาใส่ชื่อแพ็กเกจ';
    end if;
  end if;
  if v_new or p_package ? 'description' then
    pk.description := public.wed_json_longtext(p_package -> 'description', 'รายละเอียดแพ็กเกจ', 3000);
  end if;
  if p_package ? 'price' then
    pk.price := coalesce(public.wed_json_money(p_package -> 'price', 'ราคาแพ็กเกจ', true), 0);
  end if;
  if p_package ? 'hours' then
    v_num := coalesce(public.product_json_num(p_package -> 'hours', 'ชั่วโมงทำงาน'), 0);
    if v_num < 0 or v_num > 999.9 or v_num <> round(v_num, 1) then
      raise exception 'ชั่วโมงทำงานต้องอยู่ระหว่าง 0 ถึง 999.9 (ทศนิยม 1 ตำแหน่ง)';
    end if;
    pk.hours := v_num;
  end if;
  if p_package ? 'crew_size' then
    pk.crew_size := coalesce(public.wed_json_int(p_package -> 'crew_size', 'จำนวนทีมงาน', 0, 20), 0);
  end if;
  if p_package ? 'deliverables' then
    pk.deliverables := public.wed_read_plan(p_package -> 'deliverables');
  end if;
  if p_package ? 'is_active' then
    pk.is_active := coalesce(public.product_json_bool(p_package -> 'is_active', 'สถานะแพ็กเกจ'), true);
  end if;
  if p_package ? 'sort_order' then
    pk.sort_order := coalesce(public.wed_json_int(p_package -> 'sort_order', 'ลำดับแพ็กเกจ', -100000, 100000), 0);
  end if;

  if v_new then
    begin
      insert into public.wed_packages as x (client_id, name, description, price, hours, crew_size, deliverables, is_active, sort_order)
      values (v_client, pk.name, pk.description, pk.price, pk.hours, pk.crew_size, pk.deliverables, pk.is_active, pk.sort_order)
      returning x.id into v_id;
    exception when unique_violation then
      select x.id into v_found from public.wed_packages as x where x.client_id = v_client;
      return public.wed_package_json(v_found) || jsonb_build_object('already_saved', true);
    end;
  else
    update public.wed_packages as x
       set name = pk.name, description = pk.description, price = pk.price, hours = pk.hours, crew_size = pk.crew_size,
           deliverables = pk.deliverables, is_active = pk.is_active, sort_order = pk.sort_order
     where x.id = v_id;
  end if;
  return public.wed_package_json(v_id) || jsonb_build_object('already_saved', false);
end;
$$;

-- ลบแพ็กเกจ: เคยใช้ในงานแล้ว = ปิดใช้งานแทน (งานเดิมจำชื่อ/ราคาไว้เองอยู่แล้ว) / ยังไม่เคยใช้ = ลบจริง
create or replace function public.wed_delete_package(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.wed_require(true);
  if not exists (select 1 from public.wed_packages as x where x.id = p_id) then
    raise exception 'ไม่พบแพ็กเกจนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  if exists (select 1 from public.wed_bookings as b where b.package_id = p_id) then
    update public.wed_packages as x set is_active = false where x.id = p_id;
    return jsonb_build_object('ok', true, 'id', p_id, 'deleted', false, 'deactivated', true);
  end if;
  delete from public.wed_packages as x where x.id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'deleted', true, 'deactivated', false);
end;
$$;

create or replace function public.wed_save_addon(p_addon jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ad public.wed_addons%rowtype;
  v_id uuid;
  v_client uuid;
  v_found uuid;
  v_ts text;
  v_new boolean;
begin
  perform public.wed_require(true);
  if p_addon is null or jsonb_typeof(p_addon) <> 'object' then
    raise exception 'ข้อมูลบริการเสริมไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  v_id := public.product_json_uuid(p_addon -> 'id', 'บริการเสริม');
  v_client := public.product_json_uuid(p_addon -> 'client_id', 'รหัสคำขอ');
  v_new := v_id is null;
  if v_new then
    if v_client is not null then
      select x.id into v_found from public.wed_addons as x where x.client_id = v_client;
      if found then
        return public.wed_addon_json(v_found) || jsonb_build_object('already_saved', true);
      end if;
    end if;
    ad.price := 0; ad.is_active := true; ad.sort_order := 0;
  else
    select x.* into ad from public.wed_addons as x where x.id = v_id for update;
    if not found then
      raise exception 'ไม่พบบริการเสริมนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
    end if;
    v_ts := public.product_json_text(p_addon -> 'updated_at', 'เวลาแก้ไขล่าสุด');
    if v_ts is not null and v_ts::timestamptz <> ad.updated_at then
      raise exception 'บริการเสริมนี้ถูกแก้ไขจากเครื่องอื่น กรุณาโหลดหน้าใหม่แล้วแก้อีกครั้ง';
    end if;
  end if;
  if v_new or p_addon ? 'name' then
    ad.name := public.wed_json_text(p_addon -> 'name', 'ชื่อบริการเสริม', 100);
    if ad.name is null then
      raise exception 'กรุณาใส่ชื่อบริการเสริม';
    end if;
  end if;
  if p_addon ? 'price' then ad.price := coalesce(public.wed_json_money(p_addon -> 'price', 'ราคาบริการเสริม', true), 0); end if;
  if v_new or p_addon ? 'unit' then ad.unit := public.wed_json_text(p_addon -> 'unit', 'หน่วย', 30); end if;
  if v_new or p_addon ? 'description' then
    ad.description := public.wed_json_longtext(p_addon -> 'description', 'รายละเอียดบริการเสริม', 1000);
  end if;
  if p_addon ? 'is_active' then
    ad.is_active := coalesce(public.product_json_bool(p_addon -> 'is_active', 'สถานะบริการเสริม'), true);
  end if;
  if p_addon ? 'sort_order' then
    ad.sort_order := coalesce(public.wed_json_int(p_addon -> 'sort_order', 'ลำดับ', -100000, 100000), 0);
  end if;
  if v_new then
    begin
      insert into public.wed_addons as x (client_id, name, price, unit, description, is_active, sort_order)
      values (v_client, ad.name, ad.price, ad.unit, ad.description, ad.is_active, ad.sort_order)
      returning x.id into v_id;
    exception when unique_violation then
      select x.id into v_found from public.wed_addons as x where x.client_id = v_client;
      return public.wed_addon_json(v_found) || jsonb_build_object('already_saved', true);
    end;
  else
    update public.wed_addons as x
       set name = ad.name, price = ad.price, unit = ad.unit, description = ad.description, is_active = ad.is_active,
           sort_order = ad.sort_order
     where x.id = v_id;
  end if;
  return public.wed_addon_json(v_id) || jsonb_build_object('already_saved', false);
end;
$$;

create or replace function public.wed_delete_addon(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.wed_require(true);
  if not exists (select 1 from public.wed_addons as x where x.id = p_id) then
    raise exception 'ไม่พบบริการเสริมนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  if exists (select 1 from public.wed_booking_addons as a where a.addon_id = p_id) then
    update public.wed_addons as x set is_active = false where x.id = p_id;
    return jsonb_build_object('ok', true, 'id', p_id, 'deleted', false, 'deactivated', true);
  end if;
  delete from public.wed_addons as x where x.id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'deleted', true, 'deactivated', false);
end;
$$;

-- =========================================================================
-- 9) ลูกค้า
-- =========================================================================
-- p_customer = {id?, client_id?, name, partner_name, phone, phone2, line_id, instagram, facebook, email, address,
--               source, note, updated_at? (กันเขียนทับ)}
create or replace function public.wed_save_customer(p_customer jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_client uuid;
  v_found uuid;
  v_ts text;
  v_old timestamptz;
begin
  perform public.wed_require(false);
  if p_customer is null or jsonb_typeof(p_customer) <> 'object' then
    raise exception 'ข้อมูลลูกค้าไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  v_id := public.product_json_uuid(p_customer -> 'id', 'รหัสลูกค้า');
  v_client := public.product_json_uuid(p_customer -> 'client_id', 'รหัสคำขอ');
  if v_id is null and v_client is not null then
    select c.id into v_found from public.wed_customers as c where c.client_id = v_client;
    if found then
      return public.wed_customer_json(v_found) || jsonb_build_object('already_saved', true);
    end if;
  end if;
  if v_id is not null then
    v_ts := public.product_json_text(p_customer -> 'updated_at', 'เวลาแก้ไขล่าสุด');
    if v_ts is not null then
      select c.updated_at into v_old from public.wed_customers as c where c.id = v_id for update;
      if found and v_old <> v_ts::timestamptz then
        raise exception 'ข้อมูลลูกค้านี้ถูกแก้ไขจากเครื่องอื่น กรุณาโหลดหน้าใหม่แล้วแก้อีกครั้ง';
      end if;
    end if;
  end if;
  begin
    v_id := public.wed_customer_write(v_id, p_customer, v_client);
  exception when unique_violation then
    select c.id into v_found from public.wed_customers as c where c.client_id = v_client;
    if found then
      return public.wed_customer_json(v_found) || jsonb_build_object('already_saved', true);
    end if;
    raise;
  end;
  return public.wed_customer_json(v_id) || jsonb_build_object('already_saved', false);
end;
$$;

create or replace function public.wed_get_customer(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform public.wed_require(false);
  perform public.wed_expire_holds();
  v := public.wed_customer_json(p_id);
  if v is null then
    raise exception 'ไม่พบข้อมูลลูกค้านี้ (อาจถูกลบไปแล้ว)';
  end if;
  return v || jsonb_build_object('bookings', coalesce((
    select jsonb_agg(public.wed_booking_mini(z.id) order by z.created_at desc, z.booking_no desc)
      from (select b.id, b.created_at, b.booking_no from public.wed_bookings as b where b.customer_id = p_id
             order by b.created_at desc, b.booking_no desc limit 100) as z), '[]'::jsonb));
end;
$$;

-- =========================================================================
-- 10) ทีมงาน
-- =========================================================================
-- p_crew = {id? + updated_at? | client_id?, name, nickname, role, phone, line_id, default_fee, color, is_active, note}
create or replace function public.wed_save_crew(p_crew jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cr public.wed_crew%rowtype;
  v_id uuid;
  v_client uuid;
  v_found uuid;
  v_ts text;
  v_new boolean;
  v_text text;
begin
  perform public.wed_require(true);
  if p_crew is null or jsonb_typeof(p_crew) <> 'object' then
    raise exception 'ข้อมูลทีมงานไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  v_id := public.product_json_uuid(p_crew -> 'id', 'ทีมงาน');
  v_client := public.product_json_uuid(p_crew -> 'client_id', 'รหัสคำขอ');
  v_new := v_id is null;
  if v_new then
    if v_client is not null then
      select x.id into v_found from public.wed_crew as x where x.client_id = v_client;
      if found then
        return public.wed_crew_json(v_found, true) || jsonb_build_object('already_saved', true);
      end if;
    end if;
    cr.role := 'photo'; cr.default_fee := 0; cr.is_active := true;
  else
    select x.* into cr from public.wed_crew as x where x.id = v_id for update;
    if not found then
      raise exception 'ไม่พบทีมงานคนนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
    end if;
    v_ts := public.product_json_text(p_crew -> 'updated_at', 'เวลาแก้ไขล่าสุด');
    if v_ts is not null and v_ts::timestamptz <> cr.updated_at then
      raise exception 'ข้อมูลทีมงานนี้ถูกแก้ไขจากเครื่องอื่น กรุณาโหลดหน้าใหม่แล้วแก้อีกครั้ง';
    end if;
  end if;
  if v_new or p_crew ? 'name' then
    cr.name := public.wed_json_text(p_crew -> 'name', 'ชื่อทีมงาน', 100);
    if cr.name is null then
      raise exception 'กรุณาใส่ชื่อทีมงาน';
    end if;
  end if;
  if v_new or p_crew ? 'nickname' then cr.nickname := public.wed_json_text(p_crew -> 'nickname', 'ชื่อเล่น', 50); end if;
  if p_crew ? 'role' then
    v_text := coalesce(public.wed_json_text(p_crew -> 'role', 'หน้าที่', 20), 'photo');
    if v_text not in ('photo', 'video', 'content', 'drone', 'assistant', 'editor', 'makeup', 'other') then
      raise exception 'หน้าที่ของทีมงานไม่ถูกต้อง';
    end if;
    cr.role := v_text;
  end if;
  if v_new or p_crew ? 'phone' then cr.phone := public.wed_json_phone(p_crew -> 'phone', 'เบอร์โทรทีมงาน'); end if;
  if v_new or p_crew ? 'line_id' then cr.line_id := public.wed_json_text(p_crew -> 'line_id', 'LINE ID', 50); end if;
  if p_crew ? 'default_fee' then
    cr.default_fee := coalesce(public.wed_json_money(p_crew -> 'default_fee', 'ค่าตัวเริ่มต้น', true), 0);
  end if;
  if v_new or p_crew ? 'color' then
    v_text := public.wed_json_text(p_crew -> 'color', 'สีประจำตัว', 7);
    if v_text is not null and v_text !~ '^#[0-9A-Fa-f]{6}$' then
      raise exception 'สีประจำตัวไม่ถูกต้อง';
    end if;
    cr.color := upper(v_text);
  end if;
  if p_crew ? 'is_active' then
    cr.is_active := coalesce(public.product_json_bool(p_crew -> 'is_active', 'สถานะทีมงาน'), true);
  end if;
  if v_new or p_crew ? 'note' then cr.note := public.wed_json_longtext(p_crew -> 'note', 'หมายเหตุ', 1000); end if;

  if v_new then
    begin
      insert into public.wed_crew as x (client_id, name, nickname, role, phone, line_id, default_fee, color, is_active, note)
      values (v_client, cr.name, cr.nickname, cr.role, cr.phone, cr.line_id, cr.default_fee, cr.color, cr.is_active, cr.note)
      returning x.id into v_id;
    exception when unique_violation then
      select x.id into v_found from public.wed_crew as x where x.client_id = v_client;
      return public.wed_crew_json(v_found, true) || jsonb_build_object('already_saved', true);
    end;
  else
    update public.wed_crew as x
       set name = cr.name, nickname = cr.nickname, role = cr.role, phone = cr.phone, line_id = cr.line_id,
           default_fee = cr.default_fee, color = cr.color, is_active = cr.is_active, note = cr.note
     where x.id = v_id;
  end if;
  return public.wed_crew_json(v_id, true) || jsonb_build_object('already_saved', false);
end;
$$;

-- รายชื่อทีมงาน (พนักงานเห็นชื่อ/หน้าที่/สี/ช่องทางติดต่อ — ค่าตัวเริ่มต้นเฉพาะผู้จัดการ)
create or replace function public.wed_list_crew()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mgr boolean;
begin
  perform public.wed_require(false);
  v_mgr := public.wed_manager();
  return coalesce((select jsonb_agg(public.wed_crew_json(c.id, v_mgr) order by c.is_active desc, c.name, c.id)
                     from public.wed_crew as c), '[]'::jsonb);
end;
$$;

-- ตารางงานของทีมงาน 1 คน (คิวของงานที่กันคิว ไม่นับคิวที่ยกเลิก) — ค่าตัวเฉพาะผู้จัดการ
create or replace function public.wed_crew_schedule(p_crew_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mgr boolean;
  v_crew jsonb;
  v_rows jsonb;
  v_tot jsonb;
begin
  perform public.wed_require(false);
  perform public.wed_expire_holds();
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'ช่วงวันที่ไม่ถูกต้อง';
  end if;
  if p_to - p_from + 1 > 366 then
    raise exception 'ดูตารางงานได้ครั้งละไม่เกิน 1 ปี';
  end if;
  v_mgr := public.wed_manager();
  v_crew := public.wed_crew_json(p_crew_id, v_mgr);
  if v_crew is null then
    raise exception 'ไม่พบทีมงานคนนี้ (อาจถูกลบไปแล้ว)';
  end if;
  select coalesce(jsonb_agg(public.wed_session_mini(ss.id)
                            || jsonb_build_object('role', sc.role, 'role_label', public.wed_role_label(sc.role),
                                                  'note', sc.note)
                            || case when v_mgr then jsonb_build_object('fee', sc.fee, 'fee_paid_on', sc.fee_paid_on)
                                    else '{}'::jsonb end
                            order by ss.date, coalesce(ss.call_time, ss.start_time) nulls last, b.booking_no), '[]'::jsonb),
         jsonb_build_object('sessions', count(*), 'days', count(distinct ss.date))
         || case when v_mgr then jsonb_build_object(
                   'fees', coalesce(sum(sc.fee), 0),
                   'paid', coalesce(sum(sc.fee) filter (where sc.fee_paid_on is not null), 0),
                   'unpaid', coalesce(sum(sc.fee) filter (where sc.fee_paid_on is null), 0)) else '{}'::jsonb end
    into v_rows, v_tot
    from public.wed_session_crew as sc
    join public.wed_sessions as ss on ss.id = sc.session_id
    join public.wed_bookings as b on b.id = ss.booking_id
   where sc.crew_id = p_crew_id and ss.date between p_from and p_to
     -- ผู้จัดการ = กฎเดียวกับหน้าจ่ายค่าตัว (ยอดต้องตรงกัน) / พนักงาน = ตารางงานจริง (คิวที่ไม่ยกเลิกของงานที่กันคิว)
     and case when v_mgr then public.wed_crew_fee_counts(b.status, b.shot_at, ss.status, sc.fee_paid_on)
              else ss.status <> 'cancelled' and public.wed_counting(b.status) end;
  return jsonb_build_object('crew', v_crew, 'from', p_from, 'to', p_to, 'sessions', v_rows, 'totals', v_tot);
end;
$$;

-- ค่าตัวทีมงานในช่วงวันที่ (ตามวันคิวงาน) แยกรายคน — กฎ wed_crew_fee_counts: จ่ายแล้วนับเสมอ /
--   ยังไม่จ่าย = คิวไม่ยกเลิกของงานที่กันคิว หรือของงานที่ยกเลิกหลังถ่ายเสร็จ (ทีมทำงานไปแล้ว) — แต่ละรายการบอกสถานะงาน/คิว
create or replace function public.wed_crew_payouts(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crew jsonb;
  v_tot jsonb;
begin
  perform public.wed_require(true);
  perform public.wed_expire_holds();
  perform public.pos_check_range(p_from, p_to);
  with it as (
    select sc.crew_id, sc.session_id, sc.role, sc.fee, sc.fee_paid_on, ss.date, ss.session_type, ss.status as session_status,
           b.id as booking_id, b.booking_no, b.couple_names, b.status as booking_status
      from public.wed_session_crew as sc
      join public.wed_sessions as ss on ss.id = sc.session_id
      join public.wed_bookings as b on b.id = ss.booking_id
     where ss.date between p_from and p_to
       and public.wed_crew_fee_counts(b.status, b.shot_at, ss.status, sc.fee_paid_on)
  )
  select coalesce(jsonb_agg(z.j order by z.name, z.crew_id), '[]'::jsonb)
    into v_crew
    from (
      select c.id as crew_id, c.name,
             jsonb_build_object(
               'crew_id', c.id, 'name', c.name, 'nickname', c.nickname, 'role', c.role,
               'role_label', public.wed_role_label(c.role), 'color', c.color, 'is_active', c.is_active,
               'sessions', count(*), 'fees', coalesce(sum(it.fee), 0),
               'paid', coalesce(sum(it.fee) filter (where it.fee_paid_on is not null), 0),
               'unpaid', coalesce(sum(it.fee) filter (where it.fee_paid_on is null), 0),
               'items', jsonb_agg(jsonb_build_object(
                          'session_id', it.session_id, 'booking_id', it.booking_id, 'booking_no', it.booking_no,
                          'couple_names', it.couple_names, 'booking_status', it.booking_status, 'date', it.date,
                          'session_type', it.session_type, 'type_label', public.wed_type_label(it.session_type),
                          'session_status', it.session_status, 'role', it.role,
                          'role_label', public.wed_role_label(it.role), 'fee', it.fee, 'fee_paid_on', it.fee_paid_on)
                        order by it.date, it.booking_no)) as j
        from it
        join public.wed_crew as c on c.id = it.crew_id
       group by c.id
    ) as z;
  select jsonb_build_object('fees', coalesce(sum(sc.fee), 0),
                            'paid', coalesce(sum(sc.fee) filter (where sc.fee_paid_on is not null), 0),
                            'unpaid', coalesce(sum(sc.fee) filter (where sc.fee_paid_on is null), 0),
                            'sessions', count(*))
    into v_tot
    from public.wed_session_crew as sc
    join public.wed_sessions as ss on ss.id = sc.session_id
    join public.wed_bookings as b on b.id = ss.booking_id
   where ss.date between p_from and p_to
     and public.wed_crew_fee_counts(b.status, b.shot_at, ss.status, sc.fee_paid_on);
  return jsonb_build_object('from', p_from, 'to', p_to, 'crew', v_crew, 'totals', v_tot);
end;
$$;

-- บันทึกจ่ายค่าตัว: p_items = [{session_id, crew_id, paid_on}] (paid_on = null → ยกเลิกการจ่าย) ไม่เกิน 500 รายการ
create or replace function public.wed_mark_crew_paid(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_elem jsonb;
  v_sid uuid;
  v_cid uuid;
  v_day date;
  v_bid uuid;
  v_n integer := 0;
  v_today date := public.pos_bkk_today();
begin
  perform public.wed_require(true);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'กรุณาเลือกรายการค่าตัวอย่างน้อย 1 รายการ';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'บันทึกได้ครั้งละไม่เกิน 500 รายการ';
  end if;
  -- ล็อกทุกงานที่เกี่ยวข้องก่อน (เรียงตาม id เสมอ) — การแก้งาน (wed_update_booking) ถือล็อกงานตลอดช่วงตรวจ "ค่าตัวจ่ายแล้ว"
  --   จนลบ/เขียนทีมในคิวเสร็จ → การจ่ายค่าตัวพร้อมกันต้องรอ ไม่แทรกกลางทาง (ไม่งั้นแถวที่เพิ่งจ่ายถูกลบ/ค่าตัวถูกเขียนทับได้)
  for v_bid in select distinct ss.booking_id
                 from public.wed_sessions as ss
                where ss.id = any (select (e.elem ->> 'session_id')::uuid
                                     from jsonb_array_elements(p_items) as e(elem)
                                    where jsonb_typeof(e.elem) = 'object'
                                      and e.elem ->> 'session_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
                order by ss.booking_id
  loop
    perform public.wed_lock_booking(v_bid);
  end loop;
  for v_elem in select e.elem from jsonb_array_elements(p_items) as e(elem)
                 order by e.elem ->> 'session_id', e.elem ->> 'crew_id'
  loop
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'ข้อมูลรายการค่าตัวไม่ถูกต้อง';
    end if;
    v_sid := public.product_json_uuid(v_elem -> 'session_id', 'คิวงาน');
    v_cid := public.product_json_uuid(v_elem -> 'crew_id', 'ทีมงาน');
    v_day := public.wed_json_date(v_elem -> 'paid_on', 'วันที่จ่ายค่าตัว');
    if v_sid is null or v_cid is null then
      raise exception 'ข้อมูลรายการค่าตัวไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
    end if;
    if v_day is not null and v_day > v_today then
      raise exception 'วันที่จ่ายค่าตัวต้องไม่เป็นวันในอนาคต';
    end if;
    if v_day is not null and v_day < (v_today - interval '3 years')::date then
      raise exception 'วันที่จ่ายค่าตัวย้อนหลังได้ไม่เกิน 3 ปี กรุณาตรวจปีที่กรอก';
    end if;
    update public.wed_session_crew as sc
       set fee_paid_on = v_day
     where sc.session_id = v_sid and sc.crew_id = v_cid and sc.fee_paid_on is distinct from v_day;
    if found then
      v_n := v_n + 1;
      select ss.booking_id into v_bid from public.wed_sessions as ss where ss.id = v_sid;
      -- ประวัติงานพนักงานอ่านได้ → จดแค่ว่าใคร/คิวไหน/วันที่ ไม่จดจำนวนเงิน
      perform public.wed_log(v_bid, case when v_day is null then 'crew_unpaid' else 'crew_paid' end,
        jsonb_build_object('session_id', v_sid, 'crew_id', v_cid, 'paid_on', v_day));
    elsif not exists (select 1 from public.wed_session_crew as sc where sc.session_id = v_sid and sc.crew_id = v_cid) then
      raise exception 'ไม่พบทีมงานในคิวนี้ (อาจถูกแก้จากเครื่องอื่น) กรุณาโหลดหน้าใหม่';
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'updated', v_n);
end;
$$;

-- =========================================================================
-- 11) ปฏิทินงาน / รายละเอียดวัน / ภาพรวมวันนี้ / ตัวเลขบนเมนู
-- =========================================================================

-- คิวแบบละเอียด (แผงรายละเอียดวันในปฏิทิน / ภาพรวมวันนี้ / รูปตารางงานส่งกลุ่มทีม)
create or replace function public.wed_day_session_json(p_session_id uuid, p_manager boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.wed_session_mini(ss.id)
         || jsonb_build_object(
              'venue_address', ss.venue_address, 'venue_contact', ss.venue_contact, 'dress_code', ss.dress_code,
              'notes', ss.notes, 'run_sheet', ss.run_sheet,
              'crew', public.wed_session_crew_json(ss.id, p_manager),
              'package_name', b.package_name, 'package_hours', b.package_hours,
              'addons', coalesce((select jsonb_agg(jsonb_build_object('name', a.name, 'qty', a.qty, 'unit', a.unit)
                                                   order by a.sort_order, a.id)
                                    from public.wed_booking_addons as a where a.booking_id = b.id), '[]'::jsonb),
              'deliverables', (select jsonb_build_object(
                                        'total', count(*), 'delivered', count(*) filter (where d.status = 'delivered'),
                                        'items', coalesce(jsonb_agg(jsonb_build_object(
                                                   'name', d.name, 'qty', d.qty, 'unit', d.unit, 'status', d.status,
                                                   'status_label', public.wed_deliverable_label(d.status),
                                                   'due_date', d.due_date) order by d.sort_order, d.id), '[]'::jsonb))
                                 from public.wed_deliverables as d where d.booking_id = b.id),
              'money', jsonb_build_object('grand_total', b.grand_total, 'paid', b.paid, 'due', b.due,
                                          'deposit_required', b.deposit_required, 'deposit_met', b.deposit_met,
                                          'next_due', public.wed_next_due_json(b.id)),
              'customer', jsonb_build_object('name', c.name, 'partner_name', c.partner_name, 'phone', c.phone,
                                             'line_id', c.line_id, 'instagram', c.instagram),
              'coordinator', jsonb_build_object('name', b.coordinator_name, 'phone', b.coordinator_phone),
              'mood_link', b.mood_link, 'customer_note', b.customer_note, 'note', b.note,
              'sessions_in_booking', (select count(*) from public.wed_sessions as x
                                       where x.booking_id = b.id and x.status <> 'cancelled'),
              'conflicts', coalesce((select jsonb_agg(jsonb_build_object(
                                              'crew_id', cp.crew_id, 'crew_name', cp.crew_name, 'date', cp.date,
                                              'this_session_id', cp.this_session_id,
                                              'other_session_id', cp.other_session_id, 'other_booking_id', cp.other_booking_id,
                                              'other_booking_no', cp.other_booking_no, 'other_couple', cp.other_couple,
                                              'other_time', cp.other_time) order by cp.crew_name, cp.other_booking_no)
                                       from public.wed_conflict_pairs(ss.date, ss.date) as cp
                                      where cp.this_session_id = ss.id), '[]'::jsonb))
    from public.wed_sessions as ss
    join public.wed_bookings as b on b.id = ss.booking_id
    join public.wed_customers as c on c.id = b.customer_id
   where ss.id = p_session_id
$$;

-- จำนวนงาน (การจองที่กันคิว) ต่อวัน — งานเดียวหลายคิวในวันเดียว = 1 งาน
create or replace function public.wed_jobs_on(p_day date)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct b.id)::integer
    from public.wed_sessions as ss
    join public.wed_bookings as b on b.id = ss.booking_id
   where ss.date = p_day and ss.status <> 'cancelled' and public.wed_counting(b.status)
$$;

-- ปฏิทินงาน (ช่วงไม่เกิน 62 วัน = เดือนที่แสดง + วันของเดือนก่อน/หลังที่เห็นในตาราง)
--   แต่ละวัน: count_jobs/full นับงานทั้งหมดเสมอ (ไม่ขึ้นกับตัวกรอง) / sessions = คิวตามตัวกรอง
--   แสดงงานที่กันคิว + (เลือกได้) งานที่ยังสอบถาม — ไม่แสดงงานที่เลื่อน/ยกเลิก และคิวที่ยกเลิก
create or replace function public.wed_calendar(p_from date, p_to date, p_crew_id uuid default null,
                                               p_include_inquiries boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer;
  v_days jsonb;
begin
  perform public.wed_require(false);
  perform public.wed_expire_holds();
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'ช่วงวันที่ไม่ถูกต้อง';
  end if;
  if p_to - p_from + 1 > 62 then
    raise exception 'ดูปฏิทินได้ครั้งละไม่เกิน 62 วัน';
  end if;
  select s.max_jobs_per_day into v_max from public.wed_settings as s where s.id;

  with d as (
    select p_from + g.n as day from generate_series(0, p_to - p_from) as g(n)
  ), ses as (
    select ss.id, ss.date, ss.start_time, ss.call_time, b.booking_no
      from public.wed_sessions as ss
      join public.wed_bookings as b on b.id = ss.booking_id
     where ss.date between p_from and p_to and ss.status <> 'cancelled'
       and (public.wed_counting(b.status) or (coalesce(p_include_inquiries, false) and b.status = 'inquiry'))
       and (p_crew_id is null or exists (select 1 from public.wed_session_crew as sc
                                          where sc.session_id = ss.id and sc.crew_id = p_crew_id))
  ), jobs as (
    select ss.date, count(distinct b.id)::integer as n
      from public.wed_sessions as ss
      join public.wed_bookings as b on b.id = ss.booking_id
     where ss.date between p_from and p_to and ss.status <> 'cancelled' and public.wed_counting(b.status)
     group by ss.date
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'day', d.day,
           'count_jobs', coalesce(j.n, 0),
           'full', coalesce(v_max, 0) > 0 and coalesce(j.n, 0) >= v_max,
           'sessions', coalesce((select jsonb_agg(public.wed_session_mini(x.id)
                                                  order by coalesce(x.call_time, x.start_time) nulls last, x.booking_no, x.id)
                                   from ses as x where x.date = d.day), '[]'::jsonb))
           order by d.day), '[]'::jsonb)
    into v_days
    from d
    left join jobs as j on j.date = d.day;

  return jsonb_build_object('from', p_from, 'to', p_to, 'capacity', coalesce(v_max, 0), 'days', v_days,
                            'conflicts', public.wed_conflict_json(p_from, p_to, true));
end;
$$;

-- รายละเอียดวันเดียว (คิวทุกคิวของวันนั้น รวมงานที่ยังสอบถาม — ไม่รวมงานที่เลื่อน/ยกเลิก)
create or replace function public.wed_day(p_day date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mgr boolean;
  v_max integer;
  v_n integer;
begin
  perform public.wed_require(false);
  perform public.wed_expire_holds();
  if p_day is null then
    raise exception 'กรุณาเลือกวันที่';
  end if;
  v_mgr := public.wed_manager();
  select s.max_jobs_per_day into v_max from public.wed_settings as s where s.id;
  v_n := public.wed_jobs_on(p_day);
  return jsonb_build_object(
    'day', p_day,
    'capacity', coalesce(v_max, 0),
    'count_jobs', v_n,
    'full', coalesce(v_max, 0) > 0 and v_n >= v_max,
    'sessions', coalesce((select jsonb_agg(public.wed_day_session_json(ss.id, v_mgr)
                                           order by coalesce(ss.call_time, ss.start_time) nulls last, b.booking_no, ss.id)
                            from public.wed_sessions as ss
                            join public.wed_bookings as b on b.id = ss.booking_id
                           where ss.date = p_day and ss.status <> 'cancelled'
                             and (public.wed_counting(b.status) or b.status = 'inquiry')), '[]'::jsonb),
    'conflicts', public.wed_conflict_json(p_day, p_day, true));
end;
$$;

-- ภาพรวมวันนี้ (p_day ไม่ส่ง = วันนี้ตามเวลาไทย)
create or replace function public.wed_today(p_day date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date;
  v_mgr boolean;
  v_month_start date;
  v_month_end date;
  v_month jsonb;
begin
  perform public.wed_require(false);
  perform public.wed_expire_holds();
  v_day := coalesce(p_day, public.pos_bkk_today());
  v_mgr := public.wed_manager();
  v_month_start := date_trunc('month', v_day::timestamp)::date;
  v_month_end := (v_month_start + interval '1 month')::date - 1;

  v_month := jsonb_build_object(
    'month', to_char(v_month_start, 'YYYY-MM'),
    'bookings_confirmed', (select count(*) from public.wed_bookings as b
                            where b.confirmed_at is not null and b.status not in ('cancelled', 'inquiry')
                              and public.pos_bkk_day(b.confirmed_at) between v_month_start and v_month_end),
    'jobs', (select count(distinct b.id) from public.wed_sessions as ss
               join public.wed_bookings as b on b.id = ss.booking_id
              where ss.date between v_month_start and v_month_end and ss.status <> 'cancelled'
                and public.wed_counting(b.status)),
    'inquiries_new', (select count(*) from public.wed_bookings as b
                       where public.pos_bkk_day(b.created_at) between v_month_start and v_month_end));
  if v_mgr then
    v_month := v_month || jsonb_build_object(
      'revenue', (select coalesce(sum(case when p.kind = 'payment' then p.amount else -p.amount end), 0)
                    from public.wed_payments as p
                   where p.voided_at is null and p.paid_on between v_month_start and v_month_end));
  end if;

  return jsonb_build_object(
    'day', v_day,
    'capacity', (select s.max_jobs_per_day from public.wed_settings as s where s.id),
    'today_sessions', coalesce((select jsonb_agg(public.wed_day_session_json(ss.id, v_mgr)
                                                 order by coalesce(ss.call_time, ss.start_time) nulls last, b.booking_no, ss.id)
                                  from public.wed_sessions as ss
                                  join public.wed_bookings as b on b.id = ss.booking_id
                                 where ss.date = v_day and ss.status <> 'cancelled' and public.wed_counting(b.status)),
                               '[]'::jsonb),
    'next7', coalesce((select jsonb_agg(public.wed_session_mini(ss.id)
                                        order by ss.date, coalesce(ss.call_time, ss.start_time) nulls last, b.booking_no, ss.id)
                         from public.wed_sessions as ss
                         join public.wed_bookings as b on b.id = ss.booking_id
                        where ss.date between v_day + 1 and v_day + 7 and ss.status <> 'cancelled'
                          and public.wed_counting(b.status)), '[]'::jsonb),
    'followups', coalesce((select jsonb_agg(public.wed_booking_mini(b.id) order by b.followup_date, b.booking_no)
                             from public.wed_bookings as b
                            where b.followup_date is not null and b.followup_date <= v_day
                              and b.status in ('inquiry', 'hold', 'confirmed', 'postponed')), '[]'::jsonb),
    'holds_expiring', coalesce((select jsonb_agg(public.wed_booking_mini(b.id) order by b.hold_until, b.booking_no)
                                  from public.wed_bookings as b
                                 where b.status = 'hold' and b.hold_until is not null
                                   and b.hold_until <= now() + interval '24 hours'), '[]'::jsonb),
    'installments_due', coalesce((select jsonb_agg(jsonb_build_object(
                                           'booking_id', b.id, 'booking_no', b.booking_no, 'couple_names', b.couple_names,
                                           'status', b.status, 'status_label', public.wed_status_label(b.status),
                                           'installment_id', r.id, 'seq', r.seq, 'label', r.label, 'due_date', r.due_date,
                                           'amount', r.amount, 'amount_remaining', r.amount_remaining,
                                           'overdue', r.due_date < v_day)
                                         order by r.due_date, b.booking_no, r.seq)
                                    from public.wed_bookings as b
                                   cross join lateral public.wed_installment_rows(b.id) as r
                                   where b.status in ('hold', 'confirmed', 'in_production', 'delivered', 'postponed')
                                     and r.amount_remaining > 0.005 and r.due_date is not null
                                     and r.due_date <= v_day + 7), '[]'::jsonb),
    'deliverables_due', coalesce((select jsonb_agg(public.wed_deliverable_json(d.id)
                                                   || jsonb_build_object('booking_no', b.booking_no,
                                                                         'couple_names', b.couple_names,
                                                                         'booking_status', b.status)
                                                   order by d.due_date, b.booking_no, d.sort_order)
                                    from public.wed_deliverables as d
                                    join public.wed_bookings as b on b.id = d.booking_id
                                   where d.status <> 'delivered' and d.due_date is not null and d.due_date <= v_day + 7
                                     and b.status not in ('cancelled', 'completed')), '[]'::jsonb),
    'conflicts', public.wed_conflict_json(v_day, v_day + 30, true),
    'month', v_month);
end;
$$;

-- ตัวเลขบนเมนู (เบาที่สุด — layout เรียกทุกหน้า)
create or replace function public.wed_badges()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date;
begin
  perform public.wed_require(false);
  perform public.wed_expire_holds();
  v_today := public.pos_bkk_today();
  return jsonb_build_object(
    'followups', (select count(*) from public.wed_bookings as b
                   where b.followup_date is not null and b.followup_date <= v_today
                     and b.status in ('inquiry', 'hold', 'confirmed', 'postponed')),
    'holds_expiring', (select count(*) from public.wed_bookings as b
                        where b.status = 'hold' and b.hold_until is not null
                          and b.hold_until <= now() + interval '24 hours'),
    'deliverables_overdue', (select count(*) from public.wed_deliverables as d
                              join public.wed_bookings as b on b.id = d.booking_id
                             where d.status <> 'delivered' and d.due_date < v_today
                               and b.status not in ('cancelled', 'completed')),
    'installments_overdue', (select count(*) from public.wed_bookings as b
                              cross join lateral public.wed_installment_rows(b.id) as r
                             where b.status in ('hold', 'confirmed', 'in_production', 'delivered', 'postponed')
                               and r.overdue));
end;
$$;

-- =========================================================================
-- 12) การจอง / งาน
-- =========================================================================

-- ราคา/คิวเต็ม/ทีมชนคิว ล่วงหน้า (อ่านอย่างเดียว) — payload แบบเดียวกับตอนสร้าง (+ booking_id ถ้ากำลังแก้งานเดิม)
--   ไม่บังคับวันที่ของคิว (ฟอร์มยังกรอกไม่ครบได้) แต่ค่าที่ผิดรูปแบบยังแจ้ง error ตามปกติ
create or replace function public.wed_quote(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.wed_settings;
  v_mgr boolean;
  v_old public.wed_bookings;
  b public.wed_bookings;
  v_bid uuid;
  v_status text;
  v_rows jsonb;
  v_addons jsonb;
  v_addons_total numeric;
  v_pre numeric;
  v_base numeric;
  v_charges numeric := 0;
  v_grand numeric;
  v_paid numeric := 0;
  v_req numeric;
  v_first date;
  v_dates date[];
  v_crew_cost numeric;
  v_out jsonb;
begin
  perform public.wed_require(false);
  perform public.wed_expire_holds();
  s := public.wed_settings_row();
  v_mgr := public.wed_manager();
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'ข้อมูลงานไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  v_bid := public.product_json_uuid(p_payload -> 'booking_id', 'งาน');
  if v_bid is not null then
    select x.* into v_old from public.wed_bookings as x where x.id = v_bid;
    if not found then
      raise exception 'ไม่พบงานนี้';
    end if;
    v_charges := v_old.charges_total;
    v_paid := v_old.paid;
  end if;
  v_status := coalesce(public.wed_json_text(p_payload -> 'status', 'สถานะงาน', 20), v_old.status, 'inquiry');
  -- ชื่อคู่บ่าวสาวยังไม่กรอกก็ดูราคาได้
  b := public.wed_read_head(case when v_old.id is null and nullif(btrim(coalesce(p_payload ->> 'couple_names', '')), '') is null
                                 then p_payload || '{"couple_names": "-"}'::jsonb else p_payload end, v_old);

  if p_payload ? 'sessions' or v_old.id is null then
    v_rows := public.wed_read_sessions(p_payload -> 'sessions', v_bid, false, v_mgr);
  else
    v_rows := public.wed_session_rows(v_old.id);
  end if;
  if p_payload ? 'addons' or v_old.id is null then
    v_addons := public.wed_read_addons(p_payload -> 'addons', v_bid);
  else
    select coalesce(jsonb_agg(to_jsonb(a) order by a.sort_order, a.id), '[]'::jsonb) into v_addons
      from public.wed_booking_addons as a where a.booking_id = v_old.id;
  end if;
  select coalesce(sum((e.elem ->> 'amount')::numeric), 0) into v_addons_total from jsonb_array_elements(v_addons) as e(elem);

  v_pre := b.package_price + v_addons_total + b.travel_fee;
  v_base := v_pre - least(b.discount, v_pre);
  v_grand := v_base + v_charges;
  v_req := least(greatest(v_grand, 0),
                 greatest(coalesce(v_old.min_deposit, s.min_deposit),
                          ceil(v_base * coalesce(v_old.deposit_percent, s.deposit_percent) / 100)));
  v_dates := public.wed_rows_dates(v_rows);
  select min(x.d) into v_first from unnest(v_dates) as x(d);

  v_out := jsonb_build_object(
    'booking_id', v_bid,
    'status', v_status,
    'counts_capacity', public.wed_counting(v_status),
    'package', jsonb_build_object('id', b.package_id, 'name', b.package_name, 'price', b.package_price,
                                  'hours', b.package_hours, 'description', b.package_description),
    'deliverables_plan', b.deliverables_plan,
    'addons', v_addons,
    'money', jsonb_build_object(
       'package_price', b.package_price, 'addons_total', v_addons_total, 'travel_fee', b.travel_fee,
       'discount', b.discount, 'discount_ok', b.discount <= v_pre, 'pre_discount_total', v_pre,
       'base_total', v_base, 'charges_total', v_charges, 'grand_total', v_grand, 'paid', v_paid,
       'due', v_grand - v_paid, 'deposit_required', v_req,
       'deposit_percent', coalesce(v_old.deposit_percent, s.deposit_percent),
       'min_deposit', coalesce(v_old.min_deposit, s.min_deposit),
       -- กฎเดียวกับ wed_recalc (งานกระชั้นชิด = ไม่ก่อนวันครบกำหนดมัดจำ)
       'balance_due_date', coalesce(b.balance_due_date_override,
                                    case when v_first is not null then
                                      greatest(v_first - coalesce(v_old.balance_due_days, s.balance_due_days),
                                               public.wed_deposit_day(v_old.created_at, v_old.deposit_due_on)) end)),
    'sessions', (select coalesce(jsonb_agg(jsonb_build_object(
                          'index', e.ord, 'id', e.elem -> 'id', 'session_type', e.elem -> 'session_type',
                          'date', e.elem -> 'date', 'start_time', public.wed_hhmm((e.elem ->> 'start_time')::time),
                          'end_time', public.wed_hhmm((e.elem ->> 'end_time')::time),
                          'call_time', public.wed_hhmm((e.elem ->> 'call_time')::time),
                          'status', e.elem -> 'status',
                          'jobs_that_day', case when e.elem ->> 'date' is null then null
                                                else public.wed_jobs_on((e.elem ->> 'date')::date) end)
                          order by e.ord), '[]'::jsonb)
                   from jsonb_array_elements(v_rows) with ordinality as e(elem, ord)),
    'crew_conflicts', public.wed_conflicts(v_rows, v_bid, v_old.booking_no, b.couple_names),
    'capacity_warnings', public.wed_capacity_check(v_bid, v_dates),
    'capacity', s.max_jobs_per_day);
  if v_mgr then
    select coalesce(sum((k.elem ->> 'fee')::numeric), 0) into v_crew_cost
      from jsonb_array_elements(v_rows) as e(elem)
     cross join lateral jsonb_array_elements(coalesce(e.elem -> 'crew', '[]'::jsonb)) as k(elem)
     where coalesce(e.elem ->> 'status', 'scheduled') <> 'cancelled';
    v_out := jsonb_set(v_out, '{money}', (v_out -> 'money')
                       || jsonb_build_object('crew_cost_total', v_crew_cost, 'profit', v_grand - v_crew_cost));
  end if;
  return v_out;
end;
$$;

create or replace function public.wed_get_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform public.wed_require(false);
  perform public.wed_expire_holds();
  v := public.wed_booking_json(p_booking_id);
  if v is null then
    raise exception 'ไม่พบงานนี้ (อาจถูกลบไปแล้ว)';
  end if;
  return v;
end;
$$;

-- สร้างงาน — p_client_id ส่งซ้ำ = คืนงานเดิม already_saved = true (ไม่รับเงินซ้ำ)
--   payload: {customer_id? | customer:{...}, couple_names, status? ('inquiry'|'hold'|'confirmed'), hold_hours?, source?,
--             package_id? | package_name/package_price/package_hours/package_description, deliverables_plan?,
--             addons:[...], travel_fee, discount, discount_note, sessions:[...], followup_date, followup_note,
--             coordinator_name, coordinator_phone, mood_link, customer_note, note, balance_due_date_override?,
--             force? (คิวเต็ม / ยืนยันก่อนได้มัดจำ), payments?:[{kind:'payment', method, amount, note?, paid_on?, purpose?, slip_path?}]}
create or replace function public.wed_create_booking(p_client_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.wed_settings;
  v_uid uuid;
  v_mgr boolean;
  v_found uuid;
  v_md5 text;
  v_status text;
  v_force boolean;
  v_hold integer;
  v_cust uuid;
  c public.wed_customers%rowtype;
  v_source text;
  b public.wed_bookings;
  v_rows jsonb;
  v_addons jsonb;
  v_pre numeric;
  v_dates date[];
  v_warn jsonb;
  v_id uuid;
  v_pay jsonb;
begin
  v_uid := public.wed_require(false);
  perform public.wed_expire_holds();
  if p_client_id is null then
    raise exception 'รหัสคำขอไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  select x.id, x.client_payload_md5 into v_found, v_md5 from public.wed_bookings as x where x.client_id = p_client_id;
  if found then
    -- payload_matches: true = ส่งข้อมูลชุดเดิมซ้ำ (เน็ตหลุด) / false = รหัสเดิมแต่ข้อมูลอื่น (แท็บที่ทำซ้ำ/ฟอร์มถูกแก้หลังส่ง)
    return jsonb_build_object('already_saved', true,
      'payload_matches', case when v_md5 is null then null else v_md5 = public.wed_payload_md5(p_payload) end,
      'booking', public.wed_booking_json(v_found));
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'ข้อมูลงานไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  s := public.wed_settings_row();
  v_mgr := public.wed_manager();

  v_status := coalesce(public.wed_json_text(p_payload -> 'status', 'สถานะงาน', 20), 'inquiry');
  if v_status not in ('inquiry', 'hold', 'confirmed') then
    raise exception 'สถานะเริ่มต้นของงานต้องเป็น "สอบถาม" "ล็อกคิว" หรือ "ยืนยันแล้ว"';
  end if;
  v_force := coalesce(public.product_json_bool(p_payload -> 'force', 'การยืนยัน'), false);
  v_hold := coalesce(public.wed_json_int(p_payload -> 'hold_hours', 'เวลาล็อกคิว (ชั่วโมง)', 1, 720), s.hold_hours);
  if p_payload ? 'payments' and jsonb_typeof(p_payload -> 'payments') not in ('array', 'null') then
    raise exception 'ข้อมูลการรับเงินไม่ถูกต้อง';
  end if;

  -- ลูกค้า: เลือกจากที่มี หรือสร้างใหม่จากฟอร์ม
  v_cust := public.product_json_uuid(p_payload -> 'customer_id', 'ลูกค้า');
  if v_cust is null then
    if jsonb_typeof(p_payload -> 'customer') is distinct from 'object' then
      raise exception 'กรุณาเลือกหรือกรอกข้อมูลลูกค้า';
    end if;
    v_cust := public.wed_customer_write(null, p_payload -> 'customer', null);
  end if;
  select x.* into c from public.wed_customers as x where x.id = v_cust;
  if not found then
    raise exception 'ไม่พบข้อมูลลูกค้า กรุณาเลือกลูกค้าใหม่';
  end if;
  v_source := coalesce(public.wed_json_text(p_payload -> 'source', 'ช่องทางที่ลูกค้าติดต่อ', 20), c.source, 'other');
  if v_source not in ('instagram', 'facebook', 'tiktok', 'line', 'referral', 'walkin', 'website', 'other') then
    raise exception 'ช่องทางที่ลูกค้าติดต่อไม่ถูกต้อง';
  end if;

  b := public.wed_read_head(p_payload, null::public.wed_bookings);
  v_rows := public.wed_read_sessions(p_payload -> 'sessions', null, v_status <> 'inquiry', v_mgr);
  v_addons := public.wed_read_addons(p_payload -> 'addons', null);
  select b.package_price + coalesce(sum((e.elem ->> 'amount')::numeric), 0) + b.travel_fee into v_pre
    from jsonb_array_elements(v_addons) as e(elem);
  if b.discount > v_pre then
    raise exception 'ส่วนลด (%) มากกว่ายอดก่อนส่วนลด (%)', public.wed_baht(b.discount), public.wed_baht(v_pre);
  end if;
  v_dates := public.wed_rows_dates(v_rows);
  if v_status <> 'inquiry' then
    perform public.wed_capacity_lock(v_dates);
    v_warn := public.wed_capacity_check(null, v_dates);
    if jsonb_array_length(v_warn) > 0 and not v_force then
      perform public.wed_capacity_raise(v_warn);
    end if;
  end if;

  begin
    insert into public.wed_bookings as x
      (booking_no, client_id, client_payload_md5, public_token, source, customer_id, couple_names, status,
       package_id, package_name, package_price, package_hours, package_description, deliverables_plan,
       travel_fee, discount, discount_note, deposit_percent, min_deposit, balance_due_days, balance_due_date_override,
       hold_until, followup_date, followup_note, coordinator_name, coordinator_phone, mood_link, customer_note, note,
       created_by, created_by_name)
    values
      (public.wed_next_no('wedding'), p_client_id, public.wed_payload_md5(p_payload),
       replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
       v_source, v_cust, b.couple_names, case when v_status = 'hold' then 'hold' else 'inquiry' end,
       b.package_id, b.package_name, b.package_price, b.package_hours, b.package_description, b.deliverables_plan,
       b.travel_fee, b.discount, b.discount_note, s.deposit_percent, s.min_deposit, s.balance_due_days,
       b.balance_due_date_override,
       case when v_status = 'hold' then now() + make_interval(hours => v_hold) end,
       b.followup_date, b.followup_note, b.coordinator_name, b.coordinator_phone, b.mood_link, b.customer_note, b.note,
       v_uid, public.pos_actor_name(v_uid))
    returning x.id into v_id;
  exception when unique_violation then
    raise exception 'งานนี้กำลังบันทึกจากอีกเครื่อง กรุณาโหลดหน้าใหม่';
  end;

  perform public.wed_write_sessions(v_id, v_rows);
  perform public.wed_write_addons(v_id, v_addons);
  perform public.wed_recalc(v_id);
  perform public.wed_log(v_id, 'create',
    jsonb_build_object('status', v_status, 'source', v_source, 'sessions', jsonb_array_length(v_rows),
                       'dates', to_jsonb(v_dates), 'capacity_over', coalesce(jsonb_array_length(v_warn), 0) > 0));

  -- รับเงินทันที (เช่น มัดจำ) — กฎเดียวกับการรับเงินปกติทุกข้อ
  if jsonb_typeof(p_payload -> 'payments') = 'array' then
    if jsonb_array_length(p_payload -> 'payments') > 5 then
      raise exception 'รับเงินพร้อมการสร้างงานได้ไม่เกิน 5 รายการ';
    end if;
    for v_pay in select e.elem from jsonb_array_elements(p_payload -> 'payments') as e(elem)
    loop
      if jsonb_typeof(v_pay) <> 'object' then
        raise exception 'ข้อมูลการรับเงินไม่ถูกต้อง';
      end if;
      if coalesce(v_pay ->> 'kind', 'payment') <> 'payment' then
        raise exception 'รับเงินพร้อมการสร้างงานได้เฉพาะ "รับชำระ"';
      end if;
      perform public.wed_add_payment_core(
        v_id, null, 'payment',
        public.wed_json_text(v_pay -> 'method', 'วิธีชำระเงิน', 20),
        public.product_json_num(v_pay -> 'amount', 'จำนวนเงิน'),
        public.wed_json_date(v_pay -> 'paid_on', 'วันที่รับเงิน'),
        public.wed_json_text(v_pay -> 'purpose', 'วัตถุประสงค์', 20),
        public.wed_json_text(v_pay -> 'note', 'หมายเหตุ', 300),
        public.wed_json_text(v_pay -> 'slip_path', 'ไฟล์สลิป', 200));
    end loop;
  end if;

  if v_status = 'confirmed' then
    perform public.wed_confirm_core(v_id, v_force, true);
  end if;

  return jsonb_build_object('already_saved', false, 'payload_matches', true, 'booking', public.wed_booking_json(v_id));
end;
$$;

-- แก้งาน (สอบถาม/ล็อกคิว/ยืนยันแล้ว/เลื่อนงาน/ถ่ายเสร็จ) — p_updated_at = เวลาแก้ล่าสุดตอนโหลดฟอร์ม (กันเขียนทับ)
--   payload: คีย์ที่ไม่ส่ง = คงค่าเดิม; sessions / addons = รายการ "ทั้งหมด" (ส่งมา = แทนที่ทั้งชุดตาม id ที่ส่งกลับมา)
--   payload.client_id (ไม่บังคับ) = รหัสคำขอแก้ไข: ส่งซ้ำหลังเน็ตหลุด ข้อมูลเดิมทุกตัวอักษร → คืนงานตามเดิม
--     ไม่ชนล็อกเวอร์ชันของตัวเอง ; รหัสเดิมแต่ข้อมูลอื่น → ปฏิเสธ (จำไว้ในประวัติ action = 'update')
--   คิวเต็ม: ตรวจเฉพาะวันที่ "เพิ่มเข้ามาใหม่" ของงานที่กันคิว (วันที่เดิมที่เคยยืนยันรับเกินไว้แล้วไม่ถามซ้ำ)
create or replace function public.wed_update_booking(p_booking_id uuid, p_updated_at timestamptz, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b_old public.wed_bookings;
  b public.wed_bookings;
  v_mgr boolean;
  v_client uuid;
  v_md5 text;
  v_prev_md5 text;
  v_force boolean;
  v_cust uuid;
  v_source text;
  v_rows jsonb;
  v_addons jsonb;
  v_pre numeric;
  v_old_dates date[];
  v_new_dates date[];
  v_warn jsonb;
  v_detail jsonb;
begin
  perform public.wed_require(false);
  perform public.wed_expire_holds();
  v_mgr := public.wed_manager();
  b_old := public.wed_lock_booking(p_booking_id);
  -- รหัสคำขอแก้ไข: ตรวจหลังได้ล็อก (รอบก่อนของเครื่องเดิมอาจบันทึกเสร็จระหว่างรอ) และก่อนตรวจสถานะ/เวอร์ชัน
  if p_payload is not null and jsonb_typeof(p_payload) = 'object' and p_payload ? 'client_id' then
    v_client := public.product_json_uuid(p_payload -> 'client_id', 'รหัสคำขอ');
  end if;
  if v_client is not null then
    v_md5 := public.wed_payload_md5(p_payload);
    select lg.detail ->> 'payload_md5' into v_prev_md5
      from public.wed_logs as lg
     where lg.booking_id = b_old.id and lg.action = 'update' and lg.detail ->> 'client_id' = v_client::text
     order by lg.id desc
     limit 1;
    if found then
      if v_prev_md5 is distinct from v_md5 then
        raise exception 'รหัสคำขอนี้ถูกใช้บันทึกการแก้ไขชุดอื่นไปแล้ว กรุณาโหลดหน้าใหม่แล้วตรวจข้อมูลก่อนแก้อีกครั้ง';
      end if;
      return public.wed_booking_json(b_old.id) || jsonb_build_object('already_saved', true);
    end if;
  end if;
  if b_old.status not in ('inquiry', 'hold', 'confirmed', 'postponed', 'in_production') then
    raise exception 'แก้ไขงานสถานะ "%" ไม่ได้', public.wed_status_label(b_old.status);
  end if;
  if p_updated_at is null or p_updated_at <> b_old.updated_at then
    raise exception 'งานนี้ถูกแก้ไขจากเครื่องอื่น กรุณาโหลดหน้าใหม่แล้วแก้อีกครั้ง';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'ข้อมูลงานไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  v_force := coalesce(public.product_json_bool(p_payload -> 'force', 'การยืนยัน'), false);

  b := public.wed_read_head(p_payload, b_old);

  v_cust := b_old.customer_id;
  if p_payload ? 'customer_id' and public.product_json_uuid(p_payload -> 'customer_id', 'ลูกค้า') is not null then
    v_cust := public.product_json_uuid(p_payload -> 'customer_id', 'ลูกค้า');
    if not exists (select 1 from public.wed_customers as x where x.id = v_cust) then
      raise exception 'ไม่พบข้อมูลลูกค้า กรุณาเลือกลูกค้าใหม่';
    end if;
  elsif jsonb_typeof(p_payload -> 'customer') = 'object' then
    v_cust := public.wed_customer_write(null, p_payload -> 'customer', null);
  end if;
  v_source := b_old.source;
  if p_payload ? 'source' then
    v_source := coalesce(public.wed_json_text(p_payload -> 'source', 'ช่องทางที่ลูกค้าติดต่อ', 20), b_old.source);
    if v_source not in ('instagram', 'facebook', 'tiktok', 'line', 'referral', 'walkin', 'website', 'other') then
      raise exception 'ช่องทางที่ลูกค้าติดต่อไม่ถูกต้อง';
    end if;
  end if;

  if p_payload ? 'sessions' then
    v_rows := public.wed_read_sessions(p_payload -> 'sessions', b_old.id,
                                       b_old.status not in ('inquiry', 'postponed'), v_mgr);
  end if;
  if p_payload ? 'addons' then
    v_addons := public.wed_read_addons(p_payload -> 'addons', b_old.id);
  end if;
  select b.package_price + b.travel_fee
         + case when v_addons is null then b_old.addons_total
                else (select coalesce(sum((e.elem ->> 'amount')::numeric), 0) from jsonb_array_elements(v_addons) as e(elem)) end
    into v_pre;
  if b.discount > v_pre then
    raise exception 'ส่วนลด (%) มากกว่ายอดก่อนส่วนลด (%)', public.wed_baht(b.discount), public.wed_baht(v_pre);
  end if;

  if v_rows is not null then
    v_old_dates := public.wed_booking_dates(b_old.id);
  end if;
  if v_rows is not null and public.wed_counting(b_old.status) then
    select coalesce(array_agg(x.d), '{}') into v_new_dates
      from unnest(public.wed_rows_dates(v_rows)) as x(d)
     where not (x.d = any(v_old_dates));
    perform public.wed_capacity_lock(v_new_dates);
    v_warn := public.wed_capacity_check(b_old.id, v_new_dates);
    if jsonb_array_length(v_warn) > 0 and not v_force then
      perform public.wed_capacity_raise(v_warn);
    end if;
  end if;

  if v_rows is not null then
    perform public.wed_write_sessions(b_old.id, v_rows);
  end if;
  if v_addons is not null then
    perform public.wed_write_addons(b_old.id, v_addons);
  end if;
  update public.wed_bookings as x
     set customer_id = v_cust, source = v_source, couple_names = b.couple_names, package_id = b.package_id,
         package_name = b.package_name, package_price = b.package_price, package_hours = b.package_hours,
         package_description = b.package_description, deliverables_plan = b.deliverables_plan,
         travel_fee = b.travel_fee, discount = b.discount, discount_note = b.discount_note,
         balance_due_date_override = b.balance_due_date_override, followup_date = b.followup_date,
         followup_note = b.followup_note, coordinator_name = b.coordinator_name, coordinator_phone = b.coordinator_phone,
         mood_link = b.mood_link, customer_note = b.customer_note, note = b.note
   where x.id = b_old.id;
  perform public.wed_recalc(b_old.id);

  -- ประวัติ: จดเฉพาะสิ่งที่เปลี่ยน (ไม่จดค่าตัวทีมงาน — พนักงานอ่านประวัติได้)
  v_detail := '{}'::jsonb;
  if v_client is not null then
    v_detail := v_detail || jsonb_build_object('client_id', v_client, 'payload_md5', v_md5);
  end if;
  if v_rows is not null then
    v_detail := v_detail || jsonb_build_object('sessions', jsonb_array_length(v_rows));
    if public.wed_booking_dates(b_old.id) is distinct from v_old_dates then
      v_detail := v_detail || jsonb_build_object('dates', jsonb_build_array(to_jsonb(v_old_dates),
                                                                            to_jsonb(public.wed_booking_dates(b_old.id))));
    end if;
  end if;
  if v_new_dates is not null and coalesce(array_length(v_new_dates, 1), 0) > 0 then
    v_detail := v_detail || jsonb_build_object('new_dates', to_jsonb(v_new_dates),
                                               'capacity_over', jsonb_array_length(v_warn) > 0);
  end if;
  if v_cust <> b_old.customer_id then
    v_detail := v_detail || jsonb_build_object('customer_changed', true);
  end if;
  if b.package_id is distinct from b_old.package_id or b.package_price <> b_old.package_price then
    v_detail := v_detail || jsonb_build_object('package', jsonb_build_array(b_old.package_name, b.package_name),
                                               'package_price', jsonb_build_array(b_old.package_price, b.package_price));
  end if;
  if b.discount <> b_old.discount then
    v_detail := v_detail || jsonb_build_object('discount', jsonb_build_array(b_old.discount, b.discount));
  end if;
  if b.travel_fee <> b_old.travel_fee then
    v_detail := v_detail || jsonb_build_object('travel_fee', jsonb_build_array(b_old.travel_fee, b.travel_fee));
  end if;
  if v_addons is not null then
    v_detail := v_detail || jsonb_build_object('addons', jsonb_array_length(v_addons));
  end if;
  perform public.wed_log(b_old.id, 'update', v_detail);
  return public.wed_booking_json(b_old.id) || jsonb_build_object('already_saved', false);
end;
$$;

-- ----- เปลี่ยนสถานะ (ทุกตัวคืน JSON งานแบบเต็ม; กดซ้ำเมื่อเป็นสถานะนั้นอยู่แล้ว = already: true) -----

-- ล็อกคิว (สอบถาม → ล็อกคิว รอมัดจำ) p_hours ไม่ส่ง = ตามตั้งค่าร้าน / คิวเต็ม → p_force
create or replace function public.wed_hold(p_booking_id uuid, p_hours integer default null, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.wed_bookings;
  s public.wed_settings;
  v_hours integer;
  v_dates date[];
  v_warn jsonb;
begin
  perform public.wed_require(false);
  perform public.wed_expire_holds();
  s := public.wed_settings_row();
  v_hours := coalesce(p_hours, s.hold_hours);
  if v_hours < 1 or v_hours > 720 then
    raise exception 'เวลาล็อกคิวต้องอยู่ระหว่าง 1 ถึง 720 ชั่วโมง';
  end if;
  b := public.wed_lock_booking(p_booking_id);
  if b.status = 'hold' then
    return public.wed_booking_json(b.id) || jsonb_build_object('already', true);
  end if;
  if b.status <> 'inquiry' then
    raise exception 'ล็อกคิวได้เฉพาะงานที่ยังเป็น "สอบถาม" (สถานะตอนนี้: %)', public.wed_status_label(b.status);
  end if;
  v_dates := public.wed_booking_dates(b.id);
  if coalesce(array_length(v_dates, 1), 0) = 0 then
    raise exception 'ล็อกคิวไม่ได้: ต้องมีคิวงานที่ระบุวันที่อย่างน้อย 1 คิว';
  end if;
  -- กฎเดียวกับตอนสร้างงานแบบล็อกคิว: ทุกคิวต้องมีวัน (คิวไม่มีวัน = ไม่กันคิว/ไม่เห็นในปฏิทิน และแก้งานต่อไม่ได้)
  if exists (select 1 from public.wed_sessions as ss where ss.booking_id = b.id and ss.status <> 'cancelled' and ss.date is null) then
    raise exception 'กรุณาระบุวันที่ของทุกคิวงานก่อน (หรือยกเลิกคิวที่ยังไม่มีวัน)';
  end if;
  perform public.wed_capacity_lock(v_dates);
  v_warn := public.wed_capacity_check(b.id, v_dates);
  if jsonb_array_length(v_warn) > 0 and not coalesce(p_force, false) then
    perform public.wed_capacity_raise(v_warn);
  end if;
  -- งวดมัดจำเริ่มนับวันที่ล็อกคิว (ไม่ใช่วันที่ลูกค้าทักมาสอบถาม) → คำนวณงวดใหม่
  update public.wed_bookings as x
     set status = 'hold', hold_until = now() + make_interval(hours => v_hours), deposit_due_on = public.pos_bkk_today()
   where x.id = b.id;
  perform public.wed_recalc(b.id);
  perform public.wed_log(b.id, 'hold', jsonb_build_object('hours', v_hours, 'capacity_over', jsonb_array_length(v_warn) > 0));
  return public.wed_booking_json(b.id) || jsonb_build_object('already', false);
end;
$$;

-- ต่อเวลาล็อกคิว — p_client_id ส่งซ้ำ (เน็ตหลุด) = ไม่ต่อซ้ำสองรอบ
create or replace function public.wed_extend_hold(p_booking_id uuid, p_hours integer, p_client_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.wed_bookings;
  v_new timestamptz;
begin
  perform public.wed_require(false);
  perform public.wed_expire_holds();
  if p_hours is null or p_hours < 1 or p_hours > 720 then
    raise exception 'ต่อเวลาล็อกคิวได้ 1 ถึง 720 ชั่วโมง';
  end if;
  b := public.wed_lock_booking(p_booking_id);
  if p_client_id is not null and exists (
       select 1 from public.wed_logs as l
        where l.booking_id = b.id and l.action = 'extend_hold' and l.detail ->> 'client_id' = p_client_id::text) then
    return public.wed_booking_json(b.id) || jsonb_build_object('already', true);
  end if;
  if b.status <> 'hold' then
    raise exception 'ต่อเวลาได้เฉพาะงานที่ล็อกคิวอยู่ (สถานะตอนนี้: %)', public.wed_status_label(b.status);
  end if;
  v_new := greatest(coalesce(b.hold_until, now()), now()) + make_interval(hours => p_hours);
  update public.wed_bookings as x set hold_until = v_new where x.id = b.id;
  perform public.wed_log(b.id, 'extend_hold', jsonb_build_object('hours', p_hours, 'old', b.hold_until, 'new', v_new,
                                                                'client_id', p_client_id));
  return public.wed_booking_json(b.id) || jsonb_build_object('already', false);
end;
$$;

-- ปล่อยคิว (ล็อกคิว → สอบถาม)
create or replace function public.wed_release_hold(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.wed_bookings;
begin
  perform public.wed_require(false);
  perform public.wed_expire_holds();
  b := public.wed_lock_booking(p_booking_id);
  if b.status = 'inquiry' then
    return public.wed_booking_json(b.id) || jsonb_build_object('already', true);
  end if;
  if b.status <> 'hold' then
    raise exception 'ปล่อยคิวได้เฉพาะงานที่ล็อกคิวอยู่ (สถานะตอนนี้: %)', public.wed_status_label(b.status);
  end if;
  update public.wed_bookings as x set status = 'inquiry', hold_until = null where x.id = b.id;
  perform public.wed_log(b.id, 'release_hold', jsonb_build_object('hold_until', b.hold_until));
  return public.wed_booking_json(b.id) || jsonb_build_object('already', false);
end;
$$;

-- ยืนยันงาน (สอบถาม/ล็อกคิว → ยืนยันแล้ว) — ยังไม่ได้มัดจำ หรือคิวเต็ม → p_force
create or replace function public.wed_confirm(p_booking_id uuid, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.wed_bookings;
begin
  perform public.wed_require(false);
  perform public.wed_expire_holds();
  b := public.wed_lock_booking(p_booking_id);
  if b.status = 'confirmed' then
    return public.wed_booking_json(b.id) || jsonb_build_object('already', true);
  end if;
  if b.status not in ('inquiry', 'hold') then
    raise exception 'ยืนยันได้เฉพาะงานที่สอบถามหรือล็อกคิวอยู่ (สถานะตอนนี้: %)', public.wed_status_label(b.status);
  end if;
  perform public.wed_confirm_core(b.id, coalesce(p_force, false), false);
  return public.wed_booking_json(b.id) || jsonb_build_object('already', false);
end;
$$;

-- ถ่ายเสร็จ (ยืนยันแล้ว → ถ่ายเสร็จ รอส่งงาน) — คิวที่ถึงวันแล้วเป็น "เสร็จ" / ยังมีคิวในอนาคต → p_force
create or replace function public.wed_mark_shot(p_booking_id uuid, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.wed_bookings;
  v_today date := public.pos_bkk_today();
  v_future integer;
  v_done integer;
begin
  perform public.wed_require(false);
  perform public.wed_expire_holds();
  b := public.wed_lock_booking(p_booking_id);
  if b.status = 'in_production' then
    return public.wed_booking_json(b.id) || jsonb_build_object('already', true);
  end if;
  if b.status <> 'confirmed' then
    raise exception 'บันทึกถ่ายเสร็จได้เฉพาะงานที่ยืนยันแล้ว (สถานะตอนนี้: %)', public.wed_status_label(b.status);
  end if;
  select count(*) into v_future from public.wed_sessions as ss
   where ss.booking_id = b.id and ss.status = 'scheduled' and (ss.date is null or ss.date > v_today);
  if v_future > 0 and not coalesce(p_force, false) then
    raise exception 'ยังมีคิวงานที่ยังไม่ถึงวันหรือยังไม่ระบุวัน % คิว — ต้องกดยืนยันแบบบังคับ', v_future
      using hint = 'wed_future_sessions';
  end if;
  update public.wed_sessions as ss
     set status = 'done'
   where ss.booking_id = b.id and ss.status = 'scheduled'
     and (coalesce(p_force, false) or (ss.date is not null and ss.date <= v_today));
  get diagnostics v_done = row_count;
  update public.wed_bookings as x set status = 'in_production', shot_at = now() where x.id = b.id;
  perform public.wed_make_deliverables(b.id);
  perform public.wed_log(b.id, 'mark_shot', jsonb_build_object('sessions_done', v_done, 'future_sessions', v_future,
                                                              'forced', coalesce(p_force, false) and v_future > 0));
  perform public.wed_sync_delivered(b.id);
  return public.wed_booking_json(b.id) || jsonb_build_object('already', false);
end;
$$;

-- ส่งงานแล้ว (ถ่ายเสร็จ → ส่งงานแล้ว) — ปกติเกิดเองเมื่อทุกรายการส่งงานเป็น "ส่งแล้ว"
create or replace function public.wed_mark_delivered(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.wed_bookings;
  v_open integer;
begin
  perform public.wed_require(false);
  b := public.wed_lock_booking(p_booking_id);
  if b.status = 'delivered' then
    return public.wed_booking_json(b.id) || jsonb_build_object('already', true);
  end if;
  if b.status <> 'in_production' then
    raise exception 'บันทึกส่งงานได้เฉพาะงานที่ถ่ายเสร็จแล้ว (สถานะตอนนี้: %)', public.wed_status_label(b.status);
  end if;
  select count(*) into v_open from public.wed_deliverables as d where d.booking_id = b.id and d.status <> 'delivered';
  update public.wed_bookings as x set status = 'delivered', delivered_at = now() where x.id = b.id;
  perform public.wed_log(b.id, 'mark_delivered', jsonb_build_object('open_deliverables', v_open));
  return public.wed_booking_json(b.id) || jsonb_build_object('already', false);
end;
$$;

-- ปิดงาน (ส่งงานแล้ว → ปิดงาน; ถ่ายเสร็จยังไม่ส่ง → p_force) — ยอดต้องลงตัวพอดี
create or replace function public.wed_complete(p_booking_id uuid, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.wed_bookings;
begin
  perform public.wed_require(false);
  b := public.wed_lock_booking(p_booking_id);
  if b.status = 'completed' then
    return public.wed_booking_json(b.id) || jsonb_build_object('already', true);
  end if;
  if b.status = 'in_production' and not coalesce(p_force, false) then
    raise exception 'ยังไม่ได้บันทึกส่งงาน — ต้องกดยืนยันแบบบังคับเพื่อปิดงาน' using hint = 'wed_not_delivered';
  end if;
  if b.status not in ('delivered', 'in_production') then
    raise exception 'ปิดงานได้หลังส่งงานแล้วเท่านั้น (สถานะตอนนี้: %)', public.wed_status_label(b.status);
  end if;
  perform public.wed_recalc(b.id);
  select x.* into b from public.wed_bookings as x where x.id = b.id;
  if b.due >= 0.005 then
    raise exception 'ปิดงานไม่ได้: ยังค้างชำระ %', public.wed_baht(b.due);
  end if;
  if b.due <= -0.005 then
    raise exception 'ปิดงานไม่ได้: รับเงินเกิน % ต้องบันทึกคืนเงินก่อน', public.wed_baht(-b.due);
  end if;
  update public.wed_bookings as x set status = 'completed', completed_at = now() where x.id = b.id;
  perform public.wed_log(b.id, 'complete', jsonb_build_object('from', b.status, 'grand_total', b.grand_total, 'paid', b.paid));
  return public.wed_booking_json(b.id) || jsonb_build_object('already', false);
end;
$$;

-- เปิดงานใหม่ (ปิดงาน → ส่งงานแล้ว) — ผู้จัดการเท่านั้น (เช่น ต้องคืนเงิน/แก้ยอดหลังปิดงาน)
create or replace function public.wed_reopen(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.wed_bookings;
begin
  perform public.wed_require(true);
  b := public.wed_lock_booking(p_booking_id);
  if b.status = 'delivered' then
    return public.wed_booking_json(b.id) || jsonb_build_object('already', true);
  end if;
  if b.status <> 'completed' then
    raise exception 'เปิดงานใหม่ได้เฉพาะงานที่ปิดแล้ว (สถานะตอนนี้: %)', public.wed_status_label(b.status);
  end if;
  update public.wed_bookings as x set status = 'delivered', completed_at = null where x.id = b.id;
  perform public.wed_log(b.id, 'reopen', jsonb_build_object('completed_at', b.completed_at));
  return public.wed_booking_json(b.id) || jsonb_build_object('already', false);
end;
$$;

-- เลื่อนงาน (ล็อกคิว/ยืนยันแล้ว → เลื่อนงาน) — ปล่อยคิวของวันเดิม เงินที่รับไว้คงอยู่
create or replace function public.wed_postpone(p_booking_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.wed_bookings;
  v_reason text;
begin
  perform public.wed_require(false);
  perform public.wed_expire_holds();
  v_reason := public.wed_reason(p_reason, 'เหตุผลที่เลื่อนงาน');
  b := public.wed_lock_booking(p_booking_id);
  if b.status = 'postponed' then
    return public.wed_booking_json(b.id) || jsonb_build_object('already', true);
  end if;
  if b.status not in ('hold', 'confirmed') then
    raise exception 'เลื่อนงานได้เฉพาะงานที่ล็อกคิวหรือยืนยันแล้ว (สถานะตอนนี้: %)', public.wed_status_label(b.status);
  end if;
  update public.wed_bookings as x
     set status = 'postponed', status_before_postpone = b.status, postpone_reason = v_reason, postponed_at = now(),
         hold_until = null
   where x.id = b.id;
  perform public.wed_log(b.id, 'postpone', jsonb_build_object('reason', v_reason, 'from', b.status,
                                                             'dates', to_jsonb(public.wed_booking_dates(b.id))));
  return public.wed_booking_json(b.id) || jsonb_build_object('already', false);
end;
$$;

-- กลับมาจัดงาน (เลื่อนงาน → สถานะเดิมก่อนเลื่อน) หลังแก้วันที่ของคิวแล้ว — คิวเต็ม → p_force
create or replace function public.wed_resume(p_booking_id uuid, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.wed_bookings;
  s public.wed_settings;
  v_to text;
  v_dates date[];
  v_warn jsonb;
begin
  perform public.wed_require(false);
  perform public.wed_expire_holds();
  s := public.wed_settings_row();
  b := public.wed_lock_booking(p_booking_id);
  if b.status <> 'postponed' then
    if b.status in ('hold', 'confirmed') then
      return public.wed_booking_json(b.id) || jsonb_build_object('already', true);
    end if;
    raise exception 'ใช้ได้กับงานที่เลื่อนอยู่เท่านั้น (สถานะตอนนี้: %)', public.wed_status_label(b.status);
  end if;
  v_to := coalesce(b.status_before_postpone, 'confirmed');
  if exists (select 1 from public.wed_sessions as ss where ss.booking_id = b.id and ss.status <> 'cancelled' and ss.date is null) then
    raise exception 'กรุณาระบุวันที่ของทุกคิวงานก่อน (แก้งานแล้วใส่วันใหม่)';
  end if;
  v_dates := public.wed_booking_dates(b.id);
  if coalesce(array_length(v_dates, 1), 0) = 0 then
    raise exception 'กรุณาระบุวันงานใหม่ก่อน (แก้งานแล้วใส่วันที่ของคิวงาน)';
  end if;
  perform public.wed_capacity_lock(v_dates);
  v_warn := public.wed_capacity_check(b.id, v_dates);
  if jsonb_array_length(v_warn) > 0 and not coalesce(p_force, false) then
    perform public.wed_capacity_raise(v_warn);
  end if;
  update public.wed_bookings as x
     set status = v_to, status_before_postpone = null,
         hold_until = case when v_to = 'hold' then now() + make_interval(hours => s.hold_hours) end
   where x.id = b.id;
  perform public.wed_recalc(b.id);
  perform public.wed_log(b.id, 'resume', jsonb_build_object('to', v_to, 'dates', to_jsonb(v_dates),
                                                           'capacity_over', jsonb_array_length(v_warn) > 0));
  return public.wed_booking_json(b.id) || jsonb_build_object('already', false);
end;
$$;

-- ยกเลิกงาน — เงินที่รับไว้คงอยู่ (มัดจำที่ริบ = รายได้) ถ้าคืนเงินให้บันทึก "คืนเงิน" แยก
--   ถ่ายเสร็จ/ส่งงานแล้ว ยกเลิกได้เฉพาะผู้จัดการ / ปิดงานแล้วยกเลิกไม่ได้
create or replace function public.wed_cancel(p_booking_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  b public.wed_bookings;
  v_reason text;
begin
  v_uid := public.wed_require(false);
  perform public.wed_expire_holds();
  v_reason := public.wed_reason(p_reason, 'เหตุผลที่ยกเลิก');
  b := public.wed_lock_booking(p_booking_id);
  if b.status = 'cancelled' then
    return public.wed_booking_json(b.id) || jsonb_build_object('already', true);
  end if;
  if b.status in ('in_production', 'delivered') and not public.wed_manager() then
    raise exception 'งานที่ถ่ายแล้วยกเลิกได้เฉพาะผู้จัดการ b.oncloud' using errcode = '42501';
  end if;
  if b.status not in ('inquiry', 'hold', 'confirmed', 'postponed', 'in_production', 'delivered') then
    raise exception 'ยกเลิกงานสถานะ "%" ไม่ได้', public.wed_status_label(b.status);
  end if;
  update public.wed_bookings as x
     set status = 'cancelled', cancel_reason = v_reason, cancelled_at = now(), cancelled_by = v_uid, hold_until = null
   where x.id = b.id;
  perform public.wed_log(b.id, 'cancel', jsonb_build_object('reason', v_reason, 'from', b.status, 'paid', b.paid));
  return public.wed_booking_json(b.id) || jsonb_build_object('already', false);
end;
$$;

-- วันที่ต้องติดตามลูกค้า (p_date = null → ล้าง)
create or replace function public.wed_set_followup(p_booking_id uuid, p_date date, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.wed_bookings;
  v_note text;
begin
  perform public.wed_require(false);
  b := public.wed_lock_booking(p_booking_id);
  if b.status = 'cancelled' then
    raise exception 'งานนี้ยกเลิกแล้ว';
  end if;
  v_note := nullif(public.product_clean_text(p_note), '');
  if char_length(v_note) > 500 then
    raise exception 'เรื่องที่ต้องติดตามยาวเกินไป (สูงสุด 500 ตัวอักษร)';
  end if;
  if p_date is not null and (p_date < public.pos_bkk_today() - 365 or p_date > public.pos_bkk_today() + 1100) then
    raise exception 'วันที่ต้องติดตามไม่ถูกต้อง';
  end if;
  update public.wed_bookings as x
     set followup_date = p_date, followup_note = case when p_date is null and v_note is null then null else v_note end
   where x.id = b.id;
  perform public.wed_log(b.id, 'followup', jsonb_build_object('date', p_date, 'note', v_note));
  return public.wed_booking_json(b.id);
end;
$$;

-- เปลี่ยนลิงก์ติดตามงานของลูกค้า (ลิงก์เดิมใช้ไม่ได้ทันที — กรณีลิงก์หลุดไปถึงคนอื่น)
create or replace function public.wed_rotate_token(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.wed_bookings;
begin
  perform public.wed_require(false);
  b := public.wed_lock_booking(p_booking_id);
  update public.wed_bookings as x
     set public_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
   where x.id = b.id;
  perform public.wed_log(b.id, 'rotate_token', '{}'::jsonb);
  return public.wed_booking_json(b.id);
end;
$$;

-- =========================================================================
-- 13) การเงิน: งวดชำระ / รับเงิน-คืนเงิน / ค่าใช้จ่ายเพิ่ม
-- =========================================================================

-- ตั้งงวดชำระเอง p_items = [{label, due_date, amount}] (1..12 งวด) — ยอดรวมทุกงวดต้องเท่ากับยอดสุทธิพอดี
create or replace function public.wed_set_installments(p_booking_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.wed_bookings;
  v_elem jsonb;
  v_idx integer := 0;
  v_plan jsonb := '[]'::jsonb;
  v_label text;
  v_amount numeric;
  v_sum numeric := 0;
begin
  perform public.wed_require(false);
  b := public.wed_lock_booking(p_booking_id);
  if b.status in ('cancelled', 'completed') then
    raise exception 'แก้งวดชำระของงานสถานะ "%" ไม่ได้', public.wed_status_label(b.status);
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'ข้อมูลงวดชำระไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  if jsonb_array_length(p_items) > 12 then
    raise exception 'แบ่งชำระได้ไม่เกิน 12 งวด';
  end if;
  perform public.wed_recalc(b.id);
  select x.* into b from public.wed_bookings as x where x.id = b.id;
  for v_elem in select e.elem from jsonb_array_elements(p_items) as e(elem)
  loop
    v_idx := v_idx + 1;
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'ข้อมูลงวดชำระไม่ถูกต้อง';
    end if;
    v_label := coalesce(public.wed_json_text(v_elem -> 'label', 'ชื่องวด', 60), 'งวดที่ ' || v_idx);
    v_amount := public.wed_json_money(v_elem -> 'amount', 'ยอดงวดที่ ' || v_idx, false);
    if v_amount is null then
      raise exception 'กรุณาใส่ยอดงวดที่ %', v_idx;
    end if;
    v_sum := v_sum + v_amount;
    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'seq', v_idx, 'label', v_label, 'due_date', public.wed_json_date(v_elem -> 'due_date', 'วันครบกำหนดงวดที่ ' || v_idx),
      'amount', v_amount));
  end loop;
  if abs(v_sum - b.grand_total) > 0.005 then
    raise exception 'ยอดรวมงวดต้องเท่ากับยอดสุทธิ % (ตอนนี้รวมได้ %)', public.wed_baht(b.grand_total), public.wed_baht(v_sum);
  end if;
  perform public.wed_write_plan(b.id, v_plan);
  update public.wed_bookings as x set installments_custom = true where x.id = b.id;
  perform public.wed_log(b.id, 'installments_set', jsonb_build_object('count', v_idx, 'total', v_sum));
  return public.wed_booking_json(b.id);
end;
$$;

-- กลับไปใช้งวดมาตรฐาน (มัดจำ + ยอดคงเหลือ)
create or replace function public.wed_reset_installments(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.wed_bookings;
begin
  perform public.wed_require(false);
  b := public.wed_lock_booking(p_booking_id);
  if b.status in ('cancelled', 'completed') then
    raise exception 'แก้งวดชำระของงานสถานะ "%" ไม่ได้', public.wed_status_label(b.status);
  end if;
  update public.wed_bookings as x set installments_custom = false where x.id = b.id;
  perform public.wed_recalc(b.id);
  perform public.wed_write_plan(b.id, public.wed_default_plan(b.id));
  perform public.wed_log(b.id, 'installments_reset', '{}'::jsonb);
  return public.wed_booking_json(b.id);
end;
$$;

-- รับเงิน/คืนเงิน — p_client_id ส่งซ้ำ = คืนรายการเดิม already_saved = true (ไม่บันทึกซ้ำ)
--   สลิป (ไม่บังคับ): อัปโหลดเข้าถัง wedding-files ที่ '<booking_id>/<ชื่อไฟล์>' ก่อน แล้วส่ง p_slip_path
create or replace function public.wed_add_payment(p_client_id uuid, p_booking_id uuid, p_kind text, p_method text,
                                                  p_amount numeric, p_paid_on date default null,
                                                  p_purpose text default null, p_note text default null,
                                                  p_slip_path text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found record;
  v_id uuid;
begin
  perform public.wed_require(false);
  perform public.wed_expire_holds();
  if p_client_id is null then
    raise exception 'รหัสคำขอไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  select p.id, p.booking_id into v_found from public.wed_payments as p where p.client_id = p_client_id;
  if found then
    if v_found.booking_id is distinct from p_booking_id then
      raise exception 'รหัสคำขอนี้ถูกใช้กับงานอื่นแล้ว กรุณาโหลดหน้าใหม่';
    end if;
    return jsonb_build_object('already_saved', true, 'payment', public.wed_payment_json(v_found.id),
                              'booking', public.wed_booking_json(v_found.booking_id));
  end if;
  perform public.wed_lock_booking(p_booking_id);
  -- ระหว่างรอล็อก เครื่องเดิมอาจบันทึกสำเร็จไปแล้ว
  select p.id into v_id from public.wed_payments as p where p.client_id = p_client_id;
  if v_id is not null then
    return jsonb_build_object('already_saved', true, 'payment', public.wed_payment_json(v_id),
                              'booking', public.wed_booking_json(p_booking_id));
  end if;
  v_id := public.wed_add_payment_core(p_booking_id, p_client_id, p_kind, p_method, p_amount, p_paid_on, p_purpose,
                                      p_note, p_slip_path);
  return jsonb_build_object('already_saved', false, 'payment', public.wed_payment_json(v_id),
                            'booking', public.wed_booking_json(p_booking_id));
end;
$$;

-- ยกเลิกรายการเงิน (ไม่ลบ) — พนักงาน: เฉพาะรายการที่บันทึกวันนี้ (เวลาไทย) / ผู้จัดการ: ทุกวัน
--   ยกเลิกแล้วยอดชำระต้องไม่ติดลบ (ยกเลิกรับชำระที่คืนเงินไปแล้ว → ต้องยกเลิกรายการคืนเงินก่อน)
create or replace function public.wed_void_payment(p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_reason text;
  p public.wed_payments%rowtype;
  b public.wed_bookings;
  v_paid numeric;
begin
  v_uid := public.wed_require(false);
  v_reason := public.wed_reason(p_reason, 'เหตุผลที่ยกเลิกรายการเงิน');
  select x.* into p from public.wed_payments as x where x.id = p_payment_id;
  if not found then
    raise exception 'ไม่พบรายการเงินนี้';
  end if;
  b := public.wed_lock_booking(p.booking_id);
  select x.* into p from public.wed_payments as x where x.id = p_payment_id for update;
  if p.voided_at is not null then
    return jsonb_build_object('already_voided', true, 'payment', public.wed_payment_json(p.id),
                              'booking', public.wed_booking_json(b.id));
  end if;
  if b.status = 'completed' then
    raise exception 'งานนี้ปิดแล้ว ยกเลิกรายการเงินไม่ได้ — ผู้จัดการเปิดงานใหม่ก่อน';
  end if;
  if public.pos_bkk_day(p.created_at) <> public.pos_bkk_today() and not public.wed_manager() then
    raise exception 'ยกเลิกได้เฉพาะรายการที่บันทึกวันนี้ (รายการวันก่อนให้ผู้จัดการเป็นผู้ยกเลิก)' using errcode = '42501';
  end if;
  v_paid := b.paid - case p.kind when 'payment' then p.amount else -p.amount end;
  if v_paid < -0.005 then
    raise exception 'ยกเลิกไม่ได้: ยอดชำระจะติดลบ (คืนเงินไปแล้ว) ต้องยกเลิกรายการคืนเงินก่อน';
  end if;
  -- ยกเลิกรายการคืนเงินหลังลูกค้าจ่ายเพิ่มไปแล้ว → ยอดชำระจะเกินยอดสุทธิ (ปิดงานไม่ได้จนกว่าจะคืนเงินใหม่)
  if p.kind = 'refund' and v_paid > b.grand_total + 0.005 then
    raise exception 'ยกเลิกไม่ได้: ยอดชำระจะเป็น % เกินยอดสุทธิ % — ยกเลิกรายการรับชำระที่รับซ้ำก่อน แล้วจึงยกเลิกรายการคืนเงินนี้',
      public.wed_baht(v_paid), public.wed_baht(b.grand_total);
  end if;
  update public.wed_payments as x
     set voided_at = now(), voided_by = v_uid, void_reason = v_reason
   where x.id = p.id;
  perform public.wed_recalc(b.id);
  perform public.wed_log(b.id, 'payment_void', jsonb_build_object('payment_id', p.id, 'receipt_no', p.receipt_no,
                                                                 'kind', p.kind, 'amount', p.amount, 'reason', v_reason));
  return jsonb_build_object('already_voided', false, 'payment', public.wed_payment_json(p.id),
                            'booking', public.wed_booking_json(b.id));
end;
$$;

-- ค่าใช้จ่ายเพิ่ม (ล่วงเวลา/เดินทาง/บริการเพิ่ม/อื่นๆ) ตั้งแต่ยืนยันงานจนถึงส่งงาน + งานที่ยืนยันแล้วถูกเลื่อน (ค่าเลื่อนวัน)
--   — p_client_id ส่งซ้ำ = ไม่เพิ่มซ้ำ
create or replace function public.wed_add_charge(p_client_id uuid, p_booking_id uuid, p_kind text, p_description text,
                                                 p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  b public.wed_bookings;
  v_found uuid;
  v_desc text;
  v_id uuid;
begin
  v_uid := public.wed_require(false);
  b := public.wed_lock_booking(p_booking_id);
  if p_client_id is not null then
    select x.booking_id into v_found from public.wed_charges as x where x.client_id = p_client_id;
    if found then
      if v_found is distinct from b.id then
        raise exception 'รหัสคำขอนี้ถูกใช้กับงานอื่นแล้ว กรุณาโหลดหน้าใหม่';
      end if;
      return public.wed_booking_json(b.id) || jsonb_build_object('already_saved', true);
    end if;
  end if;
  if not public.wed_charges_open(b.status, b.status_before_postpone) then
    raise exception 'เพิ่มค่าใช้จ่ายได้ตั้งแต่ยืนยันงานจนถึงส่งงาน รวมงานที่ยืนยันแล้วถูกเลื่อน (สถานะตอนนี้: %)', public.wed_status_label(b.status);
  end if;
  if p_kind is null or p_kind not in ('overtime', 'travel', 'extra', 'other') then
    raise exception 'ประเภทค่าใช้จ่ายไม่ถูกต้อง';
  end if;
  v_desc := nullif(public.product_clean_text(p_description), '');
  if v_desc is null or char_length(v_desc) > 200 then
    raise exception 'กรุณาใส่รายละเอียดค่าใช้จ่าย (ไม่เกิน 200 ตัวอักษร)';
  end if;
  perform public.wed_check_money(p_amount, 'จำนวนเงิน', false);
  begin
    insert into public.wed_charges as x (client_id, booking_id, kind, description, amount, created_by, created_by_name)
    values (p_client_id, b.id, p_kind, v_desc, p_amount, v_uid, public.pos_actor_name(v_uid))
    returning x.id into v_id;
  exception when unique_violation then
    raise exception 'รายการนี้กำลังบันทึกจากอีกเครื่อง กรุณาโหลดหน้าใหม่';
  end;
  perform public.wed_recalc(b.id);
  perform public.wed_log(b.id, 'charge_add', jsonb_build_object('charge_id', v_id, 'kind', p_kind, 'amount', p_amount,
                                                               'description', v_desc));
  return public.wed_booking_json(b.id) || jsonb_build_object('already_saved', false);
end;
$$;

create or replace function public.wed_void_charge(p_charge_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_reason text;
  ch public.wed_charges%rowtype;
  b public.wed_bookings;
begin
  v_uid := public.wed_require(false);
  v_reason := public.wed_reason(p_reason, 'เหตุผลที่ยกเลิกค่าใช้จ่าย');
  select x.* into ch from public.wed_charges as x where x.id = p_charge_id;
  if not found then
    raise exception 'ไม่พบรายการค่าใช้จ่ายนี้';
  end if;
  b := public.wed_lock_booking(ch.booking_id);
  select x.* into ch from public.wed_charges as x where x.id = p_charge_id for update;
  if ch.voided_at is not null then
    return public.wed_booking_json(b.id) || jsonb_build_object('already', true);
  end if;
  if not public.wed_charges_open(b.status, b.status_before_postpone) then
    raise exception 'ยกเลิกค่าใช้จ่ายได้ตั้งแต่ยืนยันงานจนถึงส่งงาน รวมงานที่ยืนยันแล้วถูกเลื่อน (สถานะตอนนี้: %)', public.wed_status_label(b.status);
  end if;
  update public.wed_charges as x set voided_at = now(), voided_by = v_uid, void_reason = v_reason where x.id = ch.id;
  perform public.wed_recalc(b.id);
  perform public.wed_log(b.id, 'charge_void', jsonb_build_object('charge_id', ch.id, 'amount', ch.amount, 'reason', v_reason));
  return public.wed_booking_json(b.id) || jsonb_build_object('already', false);
end;
$$;

-- =========================================================================
-- 14) งานที่ต้องส่ง (ตัดต่อ/ส่งลิงก์)
-- =========================================================================
-- p_item = {id? (แก้) | client_id? (สร้าง — ส่งซ้ำไม่เกิดซ้ำ), name, qty, unit, due_date, status, link_url, note,
--           editor_crew_id, sort_order} — คีย์ที่ไม่ส่งมา = คงค่าเดิม (แก้)
--   "ส่งแล้ว" ต้องมีลิงก์ส่งงานหรือหมายเหตุ (เช่น ส่งทางไดรฟ์ของลูกค้า) / ทุกรายการส่งแล้ว → งานเป็น "ส่งงานแล้ว" เอง
--   คืน JSON งานแบบเต็ม + deliverable (รายการที่บันทึก) + already_saved
create or replace function public.wed_save_deliverable(p_booking_id uuid, p_item jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.wed_bookings;
  d public.wed_deliverables%rowtype;
  v_id uuid;
  v_client uuid;
  v_found record;
  v_new boolean;
  v_old_status text;
  v_text text;
  v_editor uuid;
begin
  perform public.wed_require(false);
  b := public.wed_lock_booking(p_booking_id);
  if p_item is null or jsonb_typeof(p_item) <> 'object' then
    raise exception 'ข้อมูลงานที่ส่งไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  v_id := public.product_json_uuid(p_item -> 'id', 'งานที่ส่ง');
  v_client := public.product_json_uuid(p_item -> 'client_id', 'รหัสคำขอ');
  v_new := v_id is null;
  if v_new and v_client is not null then
    select x.id, x.booking_id into v_found from public.wed_deliverables as x where x.client_id = v_client;
    if found then
      if v_found.booking_id <> b.id then
        raise exception 'รหัสคำขอนี้ถูกใช้กับงานอื่นแล้ว กรุณาโหลดหน้าใหม่';
      end if;
      return public.wed_booking_json(b.id)
             || jsonb_build_object('deliverable', public.wed_deliverable_json(v_found.id), 'already_saved', true);
    end if;
  end if;
  if b.status = 'cancelled' then
    raise exception 'งานนี้ยกเลิกแล้ว แก้รายการส่งงานไม่ได้';
  end if;
  if v_new then
    d.qty := 1;
    d.status := 'pending';
    d.sort_order := coalesce((select max(x.sort_order) from public.wed_deliverables as x where x.booking_id = b.id), 0) + 1;
  else
    select x.* into d from public.wed_deliverables as x where x.id = v_id and x.booking_id = b.id for update;
    if not found then
      raise exception 'ไม่พบรายการส่งงานนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
    end if;
  end if;
  v_old_status := d.status;

  if v_new or p_item ? 'name' then
    d.name := public.wed_json_text(p_item -> 'name', 'ชื่องานที่ส่ง', 120);
    if d.name is null then
      raise exception 'กรุณาใส่ชื่องานที่ส่ง';
    end if;
  end if;
  if p_item ? 'qty' then d.qty := coalesce(public.wed_json_int(p_item -> 'qty', 'จำนวน', 1, 100000), 1); end if;
  if v_new or p_item ? 'unit' then d.unit := public.wed_json_text(p_item -> 'unit', 'หน่วย', 30); end if;
  if v_new or p_item ? 'due_date' then d.due_date := public.wed_json_date(p_item -> 'due_date', 'กำหนดส่ง'); end if;
  if p_item ? 'status' then
    v_text := coalesce(public.wed_json_text(p_item -> 'status', 'สถานะงานที่ส่ง', 20), 'pending');
    if v_text not in ('pending', 'editing', 'review', 'delivered') then
      raise exception 'สถานะงานที่ส่งไม่ถูกต้อง';
    end if;
    d.status := v_text;
  end if;
  if v_new or p_item ? 'link_url' then d.link_url := public.wed_json_url(p_item -> 'link_url', 'ลิงก์ส่งงาน', 1000); end if;
  if v_new or p_item ? 'note' then d.note := public.wed_json_longtext(p_item -> 'note', 'หมายเหตุงานที่ส่ง', 1000); end if;
  if v_new or p_item ? 'editor_crew_id' then
    v_editor := public.product_json_uuid(p_item -> 'editor_crew_id', 'ผู้ตัดต่อ');
    if v_editor is not null and not exists (select 1 from public.wed_crew as c where c.id = v_editor) then
      raise exception 'ไม่พบผู้ตัดต่อที่เลือก กรุณาโหลดหน้าใหม่';
    end if;
    d.editor_crew_id := v_editor;
  end if;
  if p_item ? 'sort_order' then
    d.sort_order := coalesce(public.wed_json_int(p_item -> 'sort_order', 'ลำดับ', -100000, 100000), 0);
  end if;
  if d.status = 'delivered' and d.link_url is null and d.note is null then
    raise exception 'บันทึก "ส่งแล้ว" ต้องใส่ลิงก์ส่งงาน หรือหมายเหตุวิธีส่งงาน';
  end if;
  if d.status = 'delivered' and v_old_status is distinct from 'delivered' then
    d.delivered_at := now();
  elsif d.status <> 'delivered' then
    d.delivered_at := null;
  end if;

  begin
    if v_new then
      insert into public.wed_deliverables as x
        (client_id, booking_id, name, qty, unit, due_date, status, link_url, note, editor_crew_id, delivered_at, sort_order)
      values
        (v_client, b.id, d.name, d.qty, d.unit, d.due_date, d.status, d.link_url, d.note, d.editor_crew_id, d.delivered_at,
         d.sort_order)
      returning x.id into v_id;
    else
      update public.wed_deliverables as x
         set name = d.name, qty = d.qty, unit = d.unit, due_date = d.due_date, status = d.status, link_url = d.link_url,
             note = d.note, editor_crew_id = d.editor_crew_id, delivered_at = d.delivered_at, sort_order = d.sort_order
       where x.id = v_id;
    end if;
  exception when unique_violation then
    raise exception 'รายการนี้กำลังบันทึกจากอีกเครื่อง กรุณาโหลดหน้าใหม่';
  end;
  perform public.wed_log(b.id, case when v_new then 'deliverable_add' else 'deliverable_update' end,
    jsonb_build_object('deliverable_id', v_id, 'name', d.name, 'status', jsonb_build_array(v_old_status, d.status),
                       'link_url', d.link_url));
  -- มีงานต้องส่งเพิ่ม (รายการกลับเป็นยังไม่ส่ง หรือเพิ่มรายการใหม่ที่ยังไม่ส่ง) → งานที่ "ส่งงานแล้ว" กลับเป็นรอส่งงาน
  perform public.wed_sync_delivered(b.id, (v_new or v_old_status = 'delivered') and d.status <> 'delivered');
  return public.wed_booking_json(b.id)
         || jsonb_build_object('deliverable', public.wed_deliverable_json(v_id), 'already_saved', false);
end;
$$;

create or replace function public.wed_delete_deliverable(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.wed_deliverables%rowtype;
  b public.wed_bookings;
begin
  perform public.wed_require(false);
  select x.* into d from public.wed_deliverables as x where x.id = p_id;
  if not found then
    raise exception 'ไม่พบรายการส่งงานนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  b := public.wed_lock_booking(d.booking_id);
  if b.status = 'cancelled' then
    raise exception 'งานนี้ยกเลิกแล้ว แก้รายการส่งงานไม่ได้';
  end if;
  delete from public.wed_deliverables as x where x.id = d.id;
  perform public.wed_log(b.id, 'deliverable_delete', jsonb_build_object('deliverable_id', d.id, 'name', d.name,
                                                                       'status', d.status));
  perform public.wed_sync_delivered(b.id);
  return public.wed_booking_json(b.id);
end;
$$;

-- กระดานงานตัดต่อ/ส่งงาน (ทุกงานที่ไม่ยกเลิก) — p_status: pending/editing/review/delivered, 'open' = ยังไม่ส่ง,
--   'overdue' = เลยกำหนดยังไม่ส่ง, null = ทั้งหมด / p_from..p_to = ช่วงกำหนดส่ง / ไม่เกิน 1,000 รายการ เรียงตามกำหนดส่ง
create or replace function public.wed_deliverables_board(p_status text default null, p_from date default null,
                                                         p_to date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := public.pos_bkk_today();
begin
  perform public.wed_require(false);
  if p_status is not null and p_status not in ('pending', 'editing', 'review', 'delivered', 'open', 'overdue') then
    raise exception 'สถานะงานที่ส่งไม่ถูกต้อง';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'ช่วงวันที่ไม่ถูกต้อง';
  end if;
  return coalesce((
    select jsonb_agg(public.wed_deliverable_json(z.id)
                     || jsonb_build_object('booking_no', z.booking_no, 'couple_names', z.couple_names,
                                           'booking_status', z.bstatus,
                                           'booking_status_label', public.wed_status_label(z.bstatus),
                                           'last_session_date', z.last_session_date)
                     order by z.due_date nulls last, z.booking_no, z.sort_order, z.id)
      from (select d.id, d.due_date, d.sort_order, b.booking_no, b.couple_names, b.status as bstatus, b.last_session_date
              from public.wed_deliverables as d
              join public.wed_bookings as b on b.id = d.booking_id
             where b.status <> 'cancelled'
               -- งานที่ปิดแล้ว (ปิดแบบบังคับทั้งที่ยังมีรายการค้าง) ไม่นับเป็น "ยังไม่ส่ง/เลยกำหนด" — กฎเดียวกับตัวเลขบนเมนู/ภาพรวมวันนี้
               and (p_status is null
                    or (p_status = 'open' and d.status <> 'delivered' and b.status <> 'completed')
                    or (p_status = 'overdue' and d.status <> 'delivered' and d.due_date < v_today and b.status <> 'completed')
                    or d.status = p_status)
               and (p_from is null or d.due_date >= p_from)
               and (p_to is null or d.due_date <= p_to)
             order by d.due_date nulls last, b.booking_no, d.sort_order, d.id
             limit 1000) as z), '[]'::jsonb);
end;
$$;

-- =========================================================================
-- 15) รายงาน + ส่งออก CSV (ผู้จัดการ)
--     รายรับ = เงินสดตามวันที่รับ/คืนเงินจริง (paid_on) ไม่นับรายการที่ยกเลิก
--     งานในช่วง = งานที่วันงานแรก (first_session_date) อยู่ในช่วง
-- =========================================================================
create or replace function public.wed_report(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := public.pos_bkk_today();
  v_income jsonb;
  v_bookings jsonb;
  v_crew jsonb;
  v_profit numeric;
begin
  perform public.wed_require(true);
  perform public.pos_check_range(p_from, p_to);
  perform public.wed_expire_holds();

  with pay as (
    select p.paid_on, p.kind, p.method, p.amount,
           case p.kind when 'refund' then -p.amount else p.amount end as net
      from public.wed_payments as p
     where p.voided_at is null and p.paid_on between p_from and p_to
  ), months as (
    select to_char(m, 'YYYY-MM') as month
      from generate_series(date_trunc('month', p_from::timestamp), date_trunc('month', p_to::timestamp), interval '1 month') as g(m)
  )
  select jsonb_build_object(
           'by_month', coalesce((select jsonb_agg(jsonb_build_object(
                                          'month', mo.month,
                                          'payment', coalesce((select sum(x.amount) from pay as x
                                                                where x.kind = 'payment' and to_char(x.paid_on, 'YYYY-MM') = mo.month), 0),
                                          'refund', coalesce((select sum(x.amount) from pay as x
                                                               where x.kind = 'refund' and to_char(x.paid_on, 'YYYY-MM') = mo.month), 0),
                                          'net', coalesce((select sum(x.net) from pay as x
                                                            where to_char(x.paid_on, 'YYYY-MM') = mo.month), 0))
                                        order by mo.month)
                                   from months as mo), '[]'::jsonb),
           'by_method', jsonb_build_object(
              'cash', coalesce((select sum(x.net) from pay as x where x.method = 'cash'), 0),
              'transfer', coalesce((select sum(x.net) from pay as x where x.method = 'transfer'), 0),
              'promptpay', coalesce((select sum(x.net) from pay as x where x.method = 'promptpay'), 0),
              'credit', coalesce((select sum(x.net) from pay as x where x.method = 'credit'), 0)),
           'by_purpose', jsonb_build_object(
              'deposit', coalesce((select sum(x.amount) from public.wed_payments as x where x.voided_at is null
                                     and x.kind = 'payment' and x.purpose = 'deposit' and x.paid_on between p_from and p_to), 0),
              'installment', coalesce((select sum(x.amount) from public.wed_payments as x where x.voided_at is null
                                         and x.kind = 'payment' and x.purpose = 'installment' and x.paid_on between p_from and p_to), 0),
              'balance', coalesce((select sum(x.amount) from public.wed_payments as x where x.voided_at is null
                                     and x.kind = 'payment' and x.purpose = 'balance' and x.paid_on between p_from and p_to), 0),
              'extra', coalesce((select sum(x.amount) from public.wed_payments as x where x.voided_at is null
                                   and x.kind = 'payment' and x.purpose = 'extra' and x.paid_on between p_from and p_to), 0),
              'other', coalesce((select sum(x.amount) from public.wed_payments as x where x.voided_at is null
                                   and x.kind = 'payment' and coalesce(x.purpose, 'other') = 'other'
                                   and x.paid_on between p_from and p_to), 0)),
           'total_payment', coalesce((select sum(x.amount) from pay as x where x.kind = 'payment'), 0),
           'total_refund', coalesce((select sum(x.amount) from pay as x where x.kind = 'refund'), 0),
           'total_net', coalesce((select sum(x.net) from pay as x), 0))
    into v_income;

  with bk as (
    select b.* from public.wed_bookings as b where b.first_session_date between p_from and p_to
  )
  select jsonb_build_object(
           'total', (select count(*) from bk),
           'created', (select count(*) from public.wed_bookings as b
                        where public.pos_bkk_day(b.created_at) between p_from and p_to),
           'by_status', (select jsonb_build_object(
                                  'inquiry', count(*) filter (where bk.status = 'inquiry'),
                                  'hold', count(*) filter (where bk.status = 'hold'),
                                  'confirmed', count(*) filter (where bk.status = 'confirmed'),
                                  'in_production', count(*) filter (where bk.status = 'in_production'),
                                  'delivered', count(*) filter (where bk.status = 'delivered'),
                                  'completed', count(*) filter (where bk.status = 'completed'),
                                  'postponed', count(*) filter (where bk.status = 'postponed'),
                                  'cancelled', count(*) filter (where bk.status = 'cancelled')) from bk),
           'by_source', (select jsonb_build_object(
                                  'instagram', count(*) filter (where bk.source = 'instagram'),
                                  'facebook', count(*) filter (where bk.source = 'facebook'),
                                  'tiktok', count(*) filter (where bk.source = 'tiktok'),
                                  'line', count(*) filter (where bk.source = 'line'),
                                  'referral', count(*) filter (where bk.source = 'referral'),
                                  'walkin', count(*) filter (where bk.source = 'walkin'),
                                  'website', count(*) filter (where bk.source = 'website'),
                                  'other', count(*) filter (where bk.source = 'other')) from bk),
           'by_package', coalesce((select jsonb_agg(jsonb_build_object('package_name', z.name, 'count', z.n, 'value', z.v)
                                                    order by z.v desc, z.name)
                                     from (select coalesce(bk.package_name, 'ไม่ระบุแพ็กเกจ') as name, count(*) as n,
                                                  sum(bk.grand_total) as v
                                             from bk where bk.status not in ('cancelled', 'inquiry')
                                            group by 1) as z), '[]'::jsonb),
           'value_total', (select coalesce(sum(bk.grand_total), 0) from bk where bk.status not in ('cancelled', 'inquiry')))
    into v_bookings;

  -- ต้นทุนทีมงานในช่วง (ตามวันคิว) — กฎเดียวกับหน้าจ่ายค่าตัว (wed_crew_fee_counts: จ่ายแล้วนับเสมอ /
  --   ยังไม่จ่าย = คิวไม่ยกเลิกของงานที่กันคิว หรือของงานที่ยกเลิกหลังถ่ายเสร็จ)
  with it as (
    select sc.crew_id, sc.fee, sc.fee_paid_on
      from public.wed_session_crew as sc
      join public.wed_sessions as ss on ss.id = sc.session_id
      join public.wed_bookings as b on b.id = ss.booking_id
     where ss.date between p_from and p_to
       and public.wed_crew_fee_counts(b.status, b.shot_at, ss.status, sc.fee_paid_on)
  )
  select jsonb_build_object(
           'cost_total', coalesce((select sum(it.fee) from it), 0),
           'paid_total', coalesce((select sum(it.fee) from it where it.fee_paid_on is not null), 0),
           'by_crew', coalesce((select jsonb_agg(jsonb_build_object('crew_id', z.crew_id, 'name', z.name, 'nickname', z.nickname,
                                                                   'sessions', z.n, 'fees', z.fees, 'paid', z.paid,
                                                                   'unpaid', z.fees - z.paid)
                                                 order by z.fees desc, z.name)
                                  from (select c.id as crew_id, c.name, c.nickname, count(*) as n, sum(it.fee) as fees,
                                               coalesce(sum(it.fee) filter (where it.fee_paid_on is not null), 0) as paid
                                          from it join public.wed_crew as c on c.id = it.crew_id
                                         group by c.id) as z), '[]'::jsonb))
    into v_crew;

  -- กำไรขั้นต้นของงานที่ยืนยันแล้วขึ้นไปซึ่งวันงานแรกอยู่ในช่วง = (ยอดหลังส่วนลด + ค่าใช้จ่ายเพิ่ม) − ค่าตัวทีมทุกคิว
  select coalesce(sum(b.base_total + b.charges_total
                      - coalesce((select sum(sc.fee) from public.wed_session_crew as sc
                                    join public.wed_sessions as ss on ss.id = sc.session_id
                                   where ss.booking_id = b.id
                                     and (ss.status <> 'cancelled' or sc.fee_paid_on is not null)), 0)), 0)
    into v_profit
    from public.wed_bookings as b
   where b.first_session_date between p_from and p_to
     and b.status in ('confirmed', 'in_production', 'delivered', 'completed');

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'income', v_income,
    'bookings', v_bookings,
    'crew', v_crew,
    'profit_total', v_profit,
    'upcoming_value', (select coalesce(sum(b.grand_total), 0) from public.wed_bookings as b
                        where b.status in ('hold', 'confirmed') and b.first_session_date >= v_today),
    'outstanding_due_total', (select coalesce(sum(greatest(b.due, 0)), 0) from public.wed_bookings as b
                               where b.status in ('hold', 'confirmed', 'in_production', 'delivered', 'postponed')),
    'overpaid_total', (select coalesce(sum(greatest(-b.due, 0)), 0) from public.wed_bookings as b
                        where b.status <> 'cancelled'));
end;
$$;

-- ส่งออก CSV (คืนเป็นแถว เรียงลำดับคงที่ — ดึงทีละหน้าด้วย p_offset + p_limit แบบเดียวกับ fix-04/06; หน้าจอใช้หน้าละ 1,000)
--   ห้ามใช้ .range() ของ PostgREST คู่กับ p_offset (จะเลื่อนซ้ำสองชั้น)
--   wed_export_bookings: ตามวันงานแรก / wed_export_payments: ตามวันที่รับเงิน (ทุกรายการรวมที่ยกเลิก) /
--   wed_export_crew_fees: ตามวันคิวงาน (กฎเดียวกับหน้าจ่ายค่าตัว — wed_crew_fee_counts)
create or replace function public.wed_export_bookings(p_from date, p_to date,
                                                      p_offset integer default null, p_limit integer default null)
returns table (
  booking_no text, status text, status_label text, source text, source_label text, created_at timestamptz,
  customer_name text, customer_phone text, couple_names text, first_session_date date, last_session_date date,
  sessions_count integer, sessions text, package_name text, package_price numeric, addons text, addons_total numeric,
  travel_fee numeric, discount numeric, base_total numeric, charges_total numeric, grand_total numeric, paid numeric,
  due numeric, deposit_required numeric, crew_cost_total numeric, profit numeric, cancel_reason text, note text,
  created_by_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.wed_require(true);
  perform public.pos_check_range(p_from, p_to);
  perform public.pos_check_page(p_offset, p_limit);
  return query
    with pagerows as (
      select b.*
        from public.wed_bookings as b
       where b.first_session_date between p_from and p_to
       order by b.first_session_date, b.booking_no, b.id
      offset coalesce(p_offset, 0)
       limit p_limit
    ), cost as (
      select pr.id, coalesce((select sum(sc.fee) from public.wed_session_crew as sc
                                join public.wed_sessions as ss on ss.id = sc.session_id
                               where ss.booking_id = pr.id
                                 and (ss.status <> 'cancelled' or sc.fee_paid_on is not null)), 0) as v
        from pagerows as pr
    )
    select pr.booking_no::text, pr.status::text, public.wed_status_label(pr.status), pr.source::text,
           public.wed_source_label(pr.source), pr.created_at, c.name::text, c.phone::text, pr.couple_names::text,
           pr.first_session_date, pr.last_session_date,
           (select count(*)::integer from public.wed_sessions as ss where ss.booking_id = pr.id and ss.status <> 'cancelled'),
           (select string_agg(public.wed_thai_date(ss.date) || ' ' || public.wed_type_label(ss.session_type)
                              || coalesce(' ' || public.wed_hhmm(ss.start_time), '')
                              || coalesce(' @ ' || ss.venue_name, ''), '; ' order by ss.sort_order, ss.date, ss.id)
              from public.wed_sessions as ss where ss.booking_id = pr.id and ss.status <> 'cancelled'),
           pr.package_name::text, pr.package_price::numeric,
           -- จำนวนทศนิยม (เช่น 1.5 ชม.) แสดงตามจริง ตัดศูนย์ท้าย ('#' ไม่ใช่รูปแบบทศนิยมของ to_char — เคยปัดเป็นจำนวนเต็ม)
           (select string_agg(a.name || ' x' || rtrim(to_char(a.qty, 'FM9999990.99'), '.'), '; ' order by a.sort_order, a.id)
              from public.wed_booking_addons as a where a.booking_id = pr.id),
           pr.addons_total::numeric, pr.travel_fee::numeric, pr.discount::numeric, pr.base_total::numeric,
           pr.charges_total::numeric, pr.grand_total::numeric, pr.paid::numeric, pr.due::numeric,
           pr.deposit_required::numeric, co.v::numeric, (pr.base_total + pr.charges_total - co.v)::numeric,
           pr.cancel_reason::text, pr.note::text, pr.created_by_name::text
      from pagerows as pr
      join public.wed_customers as c on c.id = pr.customer_id
      join cost as co on co.id = pr.id
     order by pr.first_session_date, pr.booking_no, pr.id;
end;
$$;

create or replace function public.wed_export_payments(p_from date, p_to date,
                                                      p_offset integer default null, p_limit integer default null)
returns table (
  receipt_no text, paid_on date, created_at timestamptz, booking_no text, couple_names text, customer_name text,
  kind text, kind_label text, method text, method_label text, purpose text, purpose_label text, amount numeric,
  income_effect numeric, status text, status_label text, has_slip boolean, note text, created_by_name text,
  voided_at timestamptz, void_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.wed_require(true);
  perform public.pos_check_range(p_from, p_to);
  perform public.pos_check_page(p_offset, p_limit);
  return query
    with pagerows as (
      select p.*
        from public.wed_payments as p
       where p.paid_on between p_from and p_to
       order by p.paid_on, p.created_at, p.id
      offset coalesce(p_offset, 0)
       limit p_limit
    )
    select pr.receipt_no::text, pr.paid_on, pr.created_at, b.booking_no::text, b.couple_names::text, c.name::text,
           pr.kind::text, public.wed_kind_label(pr.kind), pr.method::text, public.wed_method_label(pr.method),
           pr.purpose::text, public.wed_purpose_label(pr.purpose), pr.amount::numeric,
           (case when pr.voided_at is not null then 0 when pr.kind = 'refund' then -pr.amount else pr.amount end)::numeric,
           (case when pr.voided_at is not null then 'voided' else 'confirmed' end)::text,
           case when pr.voided_at is not null then 'ยกเลิกแล้ว' else 'ปกติ' end,
           pr.slip_path is not null, pr.note::text, pr.created_by_name::text, pr.voided_at, pr.void_reason::text
      from pagerows as pr
      join public.wed_bookings as b on b.id = pr.booking_id
      join public.wed_customers as c on c.id = b.customer_id
     order by pr.paid_on, pr.created_at, pr.id;
end;
$$;

create or replace function public.wed_export_crew_fees(p_from date, p_to date,
                                                       p_offset integer default null, p_limit integer default null)
returns table (
  date date, booking_no text, couple_names text, booking_status text, booking_status_label text, session_type text,
  type_label text, session_title text, crew_name text, crew_nickname text, role text, role_label text, fee numeric,
  fee_paid_on date, paid boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.wed_require(true);
  perform public.pos_check_range(p_from, p_to);
  perform public.pos_check_page(p_offset, p_limit);
  return query
    select ss.date, b.booking_no::text, b.couple_names::text, b.status::text, public.wed_status_label(b.status),
           ss.session_type::text, public.wed_type_label(ss.session_type), ss.title::text, c.name::text, c.nickname::text,
           sc.role::text, public.wed_role_label(sc.role), sc.fee::numeric, sc.fee_paid_on, sc.fee_paid_on is not null
      from public.wed_session_crew as sc
      join public.wed_sessions as ss on ss.id = sc.session_id
      join public.wed_bookings as b on b.id = ss.booking_id
      join public.wed_crew as c on c.id = sc.crew_id
     where ss.date between p_from and p_to
       and public.wed_crew_fee_counts(b.status, b.shot_at, ss.status, sc.fee_paid_on)
     order by ss.date, b.booking_no, c.name, sc.session_id, sc.crew_id
    offset coalesce(p_offset, 0)
     limit p_limit;
end;
$$;

-- =========================================================================
-- 16) ลิงก์ติดตามงานของคู่บ่าวสาว /wedding-status/<token> (ไม่ต้องล็อกอิน — anon เรียกได้)
--     เฉพาะสิ่งที่ลูกค้าควรเห็น: ไม่มีทีมงาน/ค่าตัว/หมายเหตุภายใน/ประวัติ/เบอร์เต็ม/ที่อยู่ลูกค้า
--     state: 'ok' | 'cancelled' (ข้อมูลน้อยที่สุด) | 'disabled' (ร้านปิดลิงก์ลูกค้า — ไม่บอกว่ามีงานนี้หรือไม่)
--     ลิงก์ผิดรูปแบบ/ไม่พบ/ถูกเปลี่ยนลิงก์ใหม่แล้ว → error 'ไม่พบงานนี้' (ข้อความเดียวกัน)
-- =========================================================================
create or replace function public.wed_public_booking(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.wed_settings;
  v_token text := lower(btrim(coalesce(p_token, '')));
  b public.wed_bookings%rowtype;
  c public.wed_customers%rowtype;
  v_shop jsonb;
begin
  s := public.wed_settings_row();
  v_shop := jsonb_build_object(
    'name', s.shop_name, 'tagline', s.tagline, 'phone', s.phone, 'line_id', s.line_id, 'line_url', s.line_url,
    'instagram', s.instagram, 'facebook', s.facebook, 'tiktok', s.tiktok, 'email', s.email,
    'logo_url_path', case when s.logo_path is null then null
                          else '/storage/v1/object/public/wedding-public/' || s.logo_path end);
  if not coalesce(s.portal_enabled, false) then
    return jsonb_build_object('state', 'disabled', 'shop', v_shop);
  end if;
  if v_token !~ '^[0-9a-f]{64}$' then
    raise exception 'ไม่พบงานนี้ กรุณาตรวจลิงก์อีกครั้ง หรือติดต่อร้าน';
  end if;
  perform public.wed_expire_holds();
  select x.* into b from public.wed_bookings as x where x.public_token = v_token;
  if not found then
    raise exception 'ไม่พบงานนี้ กรุณาตรวจลิงก์อีกครั้ง หรือติดต่อร้าน';
  end if;
  if b.status = 'cancelled' then
    return jsonb_build_object('state', 'cancelled', 'shop', v_shop, 'booking_no', b.booking_no, 'status', b.status,
                              'status_label', 'ยกเลิกแล้ว', 'couple_names', b.couple_names);
  end if;
  select x.* into c from public.wed_customers as x where x.id = b.customer_id;

  return jsonb_build_object(
    'state', 'ok',
    'shop', v_shop,
    'booking_no', b.booking_no,
    'status', b.status,
    'status_label', public.wed_status_label(b.status),
    'couple_names', b.couple_names,
    'customer_name_masked', public.wed_mask_name(c.name),
    'phone_masked', public.wed_mask_phone(c.phone),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object(
                                   'session_type', ss.session_type, 'type_label', public.wed_type_label(ss.session_type),
                                   'title', ss.title, 'date', ss.date, 'start_time', public.wed_hhmm(ss.start_time),
                                   'end_time', public.wed_hhmm(ss.end_time), 'venue_name', ss.venue_name,
                                   'venue_address', ss.venue_address, 'map_url', ss.map_url, 'run_sheet', ss.run_sheet,
                                   'status', ss.status)
                                 order by ss.sort_order, ss.date nulls last, ss.start_time nulls last, ss.id)
                            from public.wed_sessions as ss where ss.booking_id = b.id and ss.status <> 'cancelled'), '[]'::jsonb),
    'package_name', b.package_name,
    'package_hours', b.package_hours,
    'addons', coalesce((select jsonb_agg(jsonb_build_object('name', a.name, 'qty', a.qty, 'unit', a.unit)
                                         order by a.sort_order, a.id)
                          from public.wed_booking_addons as a where a.booking_id = b.id), '[]'::jsonb),
    'deliverables', coalesce((select jsonb_agg(jsonb_build_object(
                                       'name', d.name, 'qty', d.qty, 'unit', d.unit, 'due_date', d.due_date,
                                       'status', d.status, 'status_label', public.wed_deliverable_label(d.status),
                                       'link_url', case when d.status = 'delivered' then d.link_url end,
                                       'delivered_at', d.delivered_at)
                                     order by d.sort_order, d.due_date nulls last, d.id)
                                from public.wed_deliverables as d where d.booking_id = b.id), '[]'::jsonb),
    'deliverables_plan', case when exists (select 1 from public.wed_deliverables as d where d.booking_id = b.id)
                              then '[]'::jsonb else b.deliverables_plan end,
    'money', jsonb_build_object('grand_total', b.grand_total, 'paid', b.paid, 'due', b.due,
                                'deposit_required', b.deposit_required, 'deposit_met', b.deposit_met,
                                'deposit_due', greatest(b.deposit_required - b.paid, 0),
                                'balance_due_date', b.balance_due_date),
    'installments', coalesce((select jsonb_agg(jsonb_build_object('label', r.label, 'due_date', r.due_date,
                                                                  'amount', r.amount, 'paid_amount', r.paid_amount,
                                                                  'amount_remaining', r.amount_remaining,
                                                                  'status', r.status, 'overdue', r.overdue)
                                               order by r.seq)
                                from public.wed_installment_rows(b.id) as r), '[]'::jsonb),
    'next_due', public.wed_next_due_json(b.id),
    'payment_info', jsonb_build_object('promptpay_id', s.promptpay_id, 'promptpay_name', s.promptpay_name,
                                       'bank_accounts', coalesce(s.bank_accounts, '[]'::jsonb)),
    'booking_note', s.booking_note,
    'terms_text', s.terms_text,
    'hold_until', case when b.status = 'hold' then b.hold_until end,
    'created_at', b.created_at, 'confirmed_at', b.confirmed_at, 'shot_at', b.shot_at,
    'delivered_at', b.delivered_at, 'completed_at', b.completed_at);
end;
$$;

-- =========================================================================
-- 17) สิทธิ์เรียกฟังก์ชัน: ฟังก์ชันของหน้าจอ = ผู้ใช้ที่ล็อกอิน (ตรวจสิทธิ์ข้างใน) / ลิงก์ลูกค้า = anon ด้วย /
--     ตัวช่วย = ไม่มีใครเรียกตรงได้ (Supabase เลิกให้สิทธิ์ฟังก์ชันใหม่อัตโนมัติ — ระบุให้ชัดทุกตัว)
-- =========================================================================
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.wed_touch()',
    'public.wed_require(boolean)',
    'public.wed_settings_row()',
    'public.wed_counting(text)',
    'public.wed_crew_fee_counts(text, timestamptz, text, date)',
    'public.wed_deposit_day(timestamptz, date)',
    'public.wed_charges_open(text, text)',
    'public.wed_payload_md5(jsonb)',
    'public.wed_baht(numeric)',
    'public.wed_thai_date(date)',
    'public.wed_hhmm(time)',
    'public.wed_busy_text(time, time, time)',
    'public.wed_status_label(text)',
    'public.wed_type_label(text)',
    'public.wed_role_label(text)',
    'public.wed_deliverable_label(text)',
    'public.wed_source_label(text)',
    'public.wed_method_label(text)',
    'public.wed_kind_label(text)',
    'public.wed_purpose_label(text)',
    'public.wed_charge_label(text)',
    'public.wed_mask_name(text)',
    'public.wed_mask_phone(text)',
    'public.wed_json_text(jsonb, text, integer)',
    'public.wed_json_longtext(jsonb, text, integer)',
    'public.wed_json_int(jsonb, text, integer, integer)',
    'public.wed_json_date(jsonb, text)',
    'public.wed_json_time(jsonb, text)',
    'public.wed_json_url(jsonb, text, integer)',
    'public.wed_check_money(numeric, text, boolean)',
    'public.wed_json_money(jsonb, text, boolean)',
    'public.wed_json_phone(jsonb, text)',
    'public.wed_reason(text, text)',
    'public.wed_log(uuid, text, jsonb, text)',
    'public.wed_next_no(text)',
    'public.wed_expire_holds()',
    'public.wed_lock_booking(uuid)',
    'public.wed_installment_rows(uuid)',
    'public.wed_default_plan(uuid)',
    'public.wed_write_plan(uuid, jsonb)',
    'public.wed_recalc(uuid)',
    'public.wed_capacity_check(uuid, date[])',
    'public.wed_capacity_lock(date[])',
    'public.wed_capacity_raise(jsonb)',
    'public.wed_conflicts(jsonb, uuid, text, text)',
    'public.wed_session_rows(uuid)',
    'public.wed_conflict_pairs(date, date)',
    'public.wed_conflict_json(date, date, boolean)',
    'public.wed_settings_json()',
    'public.wed_customer_json(uuid)',
    'public.wed_crew_json(uuid, boolean)',
    'public.wed_package_json(uuid)',
    'public.wed_addon_json(uuid)',
    'public.wed_payment_json(uuid)',
    'public.wed_deliverable_json(uuid)',
    'public.wed_session_crew_json(uuid, boolean)',
    'public.wed_installments_json(uuid)',
    'public.wed_next_due_json(uuid)',
    'public.wed_booking_mini(uuid)',
    'public.wed_session_mini(uuid)',
    'public.wed_booking_json(uuid)',
    'public.wed_customer_write(uuid, jsonb, uuid)',
    'public.wed_read_plan(jsonb)',
    'public.wed_read_head(jsonb, public.wed_bookings)',
    'public.wed_read_sessions(jsonb, uuid, boolean, boolean)',
    'public.wed_write_sessions(uuid, jsonb)',
    'public.wed_read_addons(jsonb, uuid)',
    'public.wed_write_addons(uuid, jsonb)',
    'public.wed_rows_dates(jsonb)',
    'public.wed_booking_dates(uuid)',
    'public.wed_sync_delivered(uuid, boolean)',
    'public.wed_add_payment_core(uuid, uuid, text, text, numeric, date, text, text, text)',
    'public.wed_make_deliverables(uuid)',
    'public.wed_confirm_core(uuid, boolean, boolean)',
    'public.wed_day_session_json(uuid, boolean)',
    'public.wed_jobs_on(date)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;

  foreach f in array array[
    'public.wed_get_settings()',
    'public.wed_save_settings(jsonb)',
    'public.wed_save_package(jsonb)',
    'public.wed_delete_package(uuid)',
    'public.wed_save_addon(jsonb)',
    'public.wed_delete_addon(uuid)',
    'public.wed_save_customer(jsonb)',
    'public.wed_get_customer(uuid)',
    'public.wed_save_crew(jsonb)',
    'public.wed_list_crew()',
    'public.wed_crew_schedule(uuid, date, date)',
    'public.wed_crew_payouts(date, date)',
    'public.wed_mark_crew_paid(jsonb)',
    'public.wed_calendar(date, date, uuid, boolean)',
    'public.wed_day(date)',
    'public.wed_today(date)',
    'public.wed_badges()',
    'public.wed_quote(jsonb)',
    'public.wed_get_booking(uuid)',
    'public.wed_create_booking(uuid, jsonb)',
    'public.wed_update_booking(uuid, timestamptz, jsonb)',
    'public.wed_hold(uuid, integer, boolean)',
    'public.wed_extend_hold(uuid, integer, uuid)',
    'public.wed_release_hold(uuid)',
    'public.wed_confirm(uuid, boolean)',
    'public.wed_mark_shot(uuid, boolean)',
    'public.wed_mark_delivered(uuid)',
    'public.wed_complete(uuid, boolean)',
    'public.wed_reopen(uuid)',
    'public.wed_postpone(uuid, text)',
    'public.wed_resume(uuid, boolean)',
    'public.wed_cancel(uuid, text)',
    'public.wed_set_followup(uuid, date, text)',
    'public.wed_rotate_token(uuid)',
    'public.wed_set_installments(uuid, jsonb)',
    'public.wed_reset_installments(uuid)',
    'public.wed_add_payment(uuid, uuid, text, text, numeric, date, text, text, text)',
    'public.wed_void_payment(uuid, text)',
    'public.wed_add_charge(uuid, uuid, text, text, numeric)',
    'public.wed_void_charge(uuid, text)',
    'public.wed_save_deliverable(uuid, jsonb)',
    'public.wed_delete_deliverable(uuid)',
    'public.wed_deliverables_board(text, date, date)',
    'public.wed_report(date, date)',
    'public.wed_export_bookings(date, date, integer, integer)',
    'public.wed_export_payments(date, date, integer, integer)',
    'public.wed_export_crew_fees(date, date, integer, integer)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;

  execute 'revoke all on function public.wed_public_booking(text) from public';
  execute 'grant execute on function public.wed_public_booking(text) to anon, authenticated, service_role';
end
$$;

-- =========================================================================
-- 18) Supabase Storage
--     wedding-public (สาธารณะ — โลโก้บนเอกสาร/ลิงก์ลูกค้า): อัปโหลด/แทนที่/ลบ = ผู้จัดการ, ไฟล์ 'logo/<ชื่อไฟล์>' ไม่เกิน 2 MB
--     wedding-files  (ส่วนตัว — สลิปโอนเงิน): ดู/อัปโหลด = พนักงาน b.oncloud, ไฟล์ '<booking_id>/<ชื่อไฟล์>' ไม่เกิน 5 MB
--     รับเฉพาะ JPG/PNG/WEBP (เหมือนถังของ NEWCUTE/ร้านเช่า) — SVG มีสคริปต์ได้ ห้ามเข้าถังที่เปิดลิงก์ตรงได้
-- =========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wedding-public', 'wedding-public', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wedding-files', 'wedding-files', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "wedding_public_objects_select" on storage.objects;
create policy "wedding_public_objects_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'wedding-public' and (select public.wed_staff()));

drop policy if exists "wedding_public_objects_insert" on storage.objects;
create policy "wedding_public_objects_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'wedding-public'
    and (select public.wed_manager())
    and name ~ '^logo/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
    and name ~* '\.(jpe?g|png|webp)$'
  );

drop policy if exists "wedding_public_objects_update" on storage.objects;
create policy "wedding_public_objects_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'wedding-public' and (select public.wed_manager()))
  with check (
    bucket_id = 'wedding-public'
    and (select public.wed_manager())
    and name ~ '^logo/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
    and name ~* '\.(jpe?g|png|webp)$'
  );

drop policy if exists "wedding_public_objects_delete" on storage.objects;
create policy "wedding_public_objects_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'wedding-public' and (select public.wed_manager()));

drop policy if exists "wedding_files_objects_select" on storage.objects;
create policy "wedding_files_objects_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'wedding-files' and (select public.wed_staff()));

drop policy if exists "wedding_files_objects_insert" on storage.objects;
create policy "wedding_files_objects_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'wedding-files'
    and (select public.wed_staff())
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
    and name ~* '\.(jpe?g|png|webp)$'
    and split_part(name, '/', 1) in (select b.id::text from public.wed_bookings as b)
  );

-- =========================================================================
-- 19) ให้ API (PostgREST) โหลดโครงสร้างใหม่ทันที
-- =========================================================================
notify pgrst, 'reload schema';

commit;

-- =========================================================================
-- ตรวจสอบหลังรัน
-- =========================================================================
--
-- (ก) SQL Editor จะแสดงตารางสรุปนี้ให้เองหลังกด Run (คำสั่งสุดท้ายของไฟล์ อ่านอย่างเดียว รันซ้ำได้)
--
-- ข้อที่เหลือไม่บังคับ — เอา "-- " หน้าบรรทัดออก แล้วรันทีละข้อใน SQL Editor
--
-- (ข) งาน 20 รายการล่าสุด
-- select b.booking_no, b.status, b.couple_names, b.first_session_date, b.grand_total, b.paid, b.due, b.created_at
--   from public.wed_bookings as b
--  order by b.created_at desc
--  limit 20;
--
-- (ค) ให้สิทธิ์ b.oncloud แก่ผู้ใช้ (ปกติใช้หน้า "ผู้ใช้งาน" ในแอป)
-- update public.user_profiles
--    set permissions = coalesce(permissions, '{}'::jsonb) || '{"wedding": true}'::jsonb
--  where id = '<uuid ผู้ใช้>';
--
-- (ง) (ไม่บังคับ) ปล่อยคิวที่ล็อกหมดเวลาทุก 10 นาทีด้วย pg_cron — ปกติไม่จำเป็น ทุกหน้าที่เปิดเรียกให้อยู่แล้ว
-- select cron.schedule('wedding-expire-holds', '*/10 * * * *', $cron$select public.wed_expire_holds()$cron$);

-- (ก) สรุประบบ b.oncloud (อ่านอย่างเดียว)
select x.item as "รายการ", x.value as "ค่า"
  from (values
    (1, 'ตารางของ b.oncloud',
        (select count(*)::text || ' / 14'
           from unnest(array['wed_settings', 'wed_packages', 'wed_addons', 'wed_customers', 'wed_crew', 'wed_bookings',
                             'wed_sessions', 'wed_session_crew', 'wed_booking_addons', 'wed_charges', 'wed_payments',
                             'wed_installments', 'wed_deliverables', 'wed_logs']) as t(name)
          where to_regclass('public.' || t.name) is not null)),
    (2, 'ทุกตารางเปิด RLS',
        (select case when count(*) filter (where not c.relrowsecurity) = 0 and count(*) = 14 then 'ถูกต้อง'
                     else 'ผิด — รันไฟล์นี้ซ้ำ' end
           from pg_class as c
          where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'wed\_%')),
    (3, 'ฟังก์ชันของหน้าจอ (เรียกได้ / ทั้งหมด)',
        (select count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                   and not has_function_privilege('anon', p.oid, 'EXECUTE'))::text
                || ' / ' || count(*)::text
           from pg_proc as p
          where p.pronamespace = 'public'::regnamespace
            and p.proname in ('wed_get_settings', 'wed_save_settings', 'wed_save_package', 'wed_delete_package',
                              'wed_save_addon', 'wed_delete_addon', 'wed_save_customer', 'wed_get_customer',
                              'wed_save_crew', 'wed_list_crew', 'wed_crew_schedule', 'wed_crew_payouts',
                              'wed_mark_crew_paid', 'wed_calendar', 'wed_day', 'wed_today', 'wed_badges', 'wed_quote',
                              'wed_get_booking', 'wed_create_booking', 'wed_update_booking', 'wed_hold',
                              'wed_extend_hold', 'wed_release_hold', 'wed_confirm', 'wed_mark_shot',
                              'wed_mark_delivered', 'wed_complete', 'wed_reopen', 'wed_postpone', 'wed_resume',
                              'wed_cancel', 'wed_set_followup', 'wed_rotate_token', 'wed_set_installments',
                              'wed_reset_installments', 'wed_add_payment', 'wed_void_payment', 'wed_add_charge',
                              'wed_void_charge', 'wed_save_deliverable', 'wed_delete_deliverable',
                              'wed_deliverables_board', 'wed_report', 'wed_export_bookings', 'wed_export_payments',
                              'wed_export_crew_fees'))),
    (4, 'ลิงก์ติดตามงานของลูกค้า (ลูกค้าเรียกได้ / ทั้งหมด)',
        (select count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE'))::text || ' / ' || count(*)::text
           from pg_proc as p
          where p.pronamespace = 'public'::regnamespace and p.proname = 'wed_public_booking')),
    (5, 'ตัวช่วยภายในที่เรียกตรงจาก API ได้ (ต้องเป็น 0)',
        (select count(*)::text
           from pg_proc as p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'wed\_%'
            and p.proname not in ('wed_staff', 'wed_manager', 'wed_public_booking')
            and has_function_privilege('anon', p.oid, 'EXECUTE'))),
    (6, 'ตาราง b.oncloud ที่ลูกค้า (anon) อ่านตรงได้ (ต้องเป็น 0)',
        (select count(*)::text
           from pg_class as c
          where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'wed\_%'
            and has_table_privilege('anon', c.oid, 'SELECT'))),
    (7, 'พนักงาน b.oncloud อย่างเดียวอ่านข้อมูล NEWCUTE ไม่ได้ (is_member ไม่มีคีย์ wedding)',
        (select case when pg_get_functiondef('public.is_member()'::regprocedure) not like '%''wedding%'
                     then 'ถูกต้อง' else 'ผิด — ตรวจ is_member()' end)),
    (8, 'ถังไฟล์ wedding-public / wedding-files',
        (select count(*)::text || ' / 2' from storage.buckets as b where b.id in ('wedding-public', 'wedding-files'))),
    (9, 'ชื่อร้าน',
        (select coalesce(max(s.shop_name), '-') from public.wed_settings as s)),
    (10, 'แพ็กเกจ / ทีมงาน / ลูกค้า / งาน',
        (select (select count(*) from public.wed_packages)::text || ' / '
                || (select count(*) from public.wed_crew)::text || ' / '
                || (select count(*) from public.wed_customers)::text || ' / '
                || (select count(*) from public.wed_bookings)::text))
  ) as x(ord, item, value)
 order by x.ord;
