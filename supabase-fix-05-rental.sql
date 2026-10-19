-- =========================================================================
-- supabase-fix-05-rental.sql — ร้านเช่าชุด (ระบบหลังร้าน): ชุดเช่า/ชิ้นจริง, ลูกค้า, การจอง (สัญญาเช่า),
--                              รับ-คืนชุด, ค่าปรับ, รับเงิน/เงินประกัน/คืนเงิน, ปฏิทินว่าง, ภาพรวมวันนี้
--
-- ไฟล์นี้ทำอะไร
--   1) สิทธิ์ใหม่ "rental" (จอง/รับ-คืนชุด/รับเงิน) และ "rental_manage" (จัดการชุด/ราคา/ตั้งค่า/รายงาน)
--      — rental_manage ทำได้ทุกอย่างที่ rental ทำได้; แอดมินทำได้ทุกอย่าง
--      — is_member() (พนักงานร้าน NEWCUTE) ไม่นับ 2 สิทธิ์นี้: พนักงานร้านเช่าอย่างเดียวอ่านยอดขาย/สต๊อก/สินค้าของ NEWCUTE ไม่ได้
--        (ข้อมูลร้านเช่าทุกตารางตรวจด้วย rental_staff() / rental_manager() ของตัวเองอยู่แล้ว)
--   2) ตารางใหม่ 11 ตาราง (ทั้งหมดเปิด RLS + ให้สิทธิ์แบบระบุชัด — Supabase เลิกให้สิทธิ์ตารางใหม่อัตโนมัติตั้งแต่ 30 ต.ค. 2026)
--        rental_settings        ข้อมูลร้าน/การจองออนไลน์/นโยบาย/ข้อตกลงสัญญา (1 แถว — ชื่อร้านยังไม่ตายตัว อ่านจากที่นี่เสมอ)
--        rental_categories      หมวดชุด
--        rental_items           แบบชุด (ราคา, จำนวนวันพื้นฐาน, ค่าวันเพิ่ม, ค่าประกัน, ค่าชดเชยหาย)
--        rental_item_images     รูปชุด (ถัง rental-images แบบสาธารณะ)
--        rental_units           ชิ้นจริงแต่ละตัว (รหัสบาร์โค้ด + ไซส์ + สถานะ)
--        rental_customers       ลูกค้า (บัญชีดำได้)
--        rental_bookings        การจอง/สัญญาเช่า RT-YYYYMMDD-NNN (ยอดเงินทุกช่องคำนวณที่ฐานข้อมูลเท่านั้น)
--        rental_booking_lines   ชุดในการจอง 1 แถว = 1 ชิ้นจริง + ช่วงวันที่กันไว้ (รวมวันเตรียม/ซัก)
--        rental_charges         ค่าปรับ/ค่าเสียหาย/ค่าใช้จ่ายเพิ่ม
--        rental_payments        รับเงิน/คืนเงิน/เงินประกัน (ใบเสร็จ RC-YYYYMMDD-NNN — ไม่ลบ ใช้ยกเลิกพร้อมเหตุผล)
--        rental_logs            ประวัติทุกการเปลี่ยนแปลงของการจอง
--   3) จองซ้อนไม่ได้เด็ดขาด: ฐานข้อมูลบังคับเอง (exclusion constraint ต่อชิ้น + ช่วงวัน — ต้องใช้ส่วนขยาย btree_gist)
--      สองเครื่องกดจองชิ้นเดียวกันพร้อมกัน เครื่องที่สองได้ข้อความภาษาไทยบอกเลขการจองที่ชน
--   4) ถังไฟล์: rental-images (ดูได้ทุกคน, อัปโหลดเฉพาะผู้จัดการร้านเช่า) / rental-slips (ส่วนตัว — พนักงานร้านเช่าเท่านั้น)
--   5) ฟังก์ชันของหน้าจอ rental_* (ดูรายการในหัวข้อ 14)
--
-- วิธีใช้: Supabase > SQL Editor > วางทั้งไฟล์ > กด Run
--   - ต้องรัน supabase-fix-01 → 02 → 03 → 04 มาก่อนแล้ว (ไฟล์นี้ตรวจให้ ถ้ายังไม่ได้รันจะหยุดทันทีโดยไม่แก้อะไร)
--   - รันซ้ำได้ปลอดภัย ไม่ทำให้ข้อมูลเสีย (ทั้งไฟล์สำเร็จทั้งหมดหรือไม่เปลี่ยนอะไรเลย)
--   - รัน supabase-fix-01.sql / supabase-fix-04-pos.sql ซ้ำทีหลังได้ ไม่กระทบร้านเช่า (is_member() ของสองไฟล์นั้นเหมือนของไฟล์นี้)
--   - รันเสร็จแล้ว SQL Editor จะแสดงตารางสรุป — ดูหัวข้อ "ตรวจสอบหลังรัน" ท้ายไฟล์
-- =========================================================================

begin;

-- =========================================================================
-- 0) ตรวจของที่ต้องมีก่อน (fix-04: ตัวนับเลขเอกสาร, ชื่อผู้ทำรายการ, วันไทย / fix-02: ตัวช่วยอ่าน JSON)
-- =========================================================================
do $$
begin
  if to_regprocedure('public.has_perm(text)') is null
     or to_regprocedure('public.is_admin()') is null
     or to_regprocedure('public.is_member()') is null
     or to_regprocedure('public.product_clean_text(text)') is null
     or to_regprocedure('public.product_size_rank(text)') is null
     or to_regprocedure('public.product_json_text(jsonb, text)') is null
     or to_regprocedure('public.product_json_num(jsonb, text)') is null
     or to_regprocedure('public.product_json_uuid(jsonb, text)') is null
     or to_regprocedure('public.product_json_bool(jsonb, text)') is null
     or to_regprocedure('public.get_sale_detail(uuid)') is null
     or to_regprocedure('public.pos_actor_name(uuid)') is null
     or to_regprocedure('public.pos_bkk_today()') is null
     or to_regprocedure('public.pos_bkk_day(timestamptz)') is null
     or to_regprocedure('public.pos_day_bounds(date)') is null
     or to_regclass('public.doc_counters') is null then
    raise exception 'ต้องรัน supabase-fix-01.sql, supabase-fix-02.sql, supabase-fix-03-integrations.sql และ supabase-fix-04-pos.sql ให้เสร็จก่อน แล้วค่อยรันไฟล์นี้ (ยังไม่ได้แก้อะไรในฐานข้อมูล)';
  end if;
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception 'ไม่พบระบบ Storage ของ Supabase (storage.buckets / storage.objects) — ยังไม่ได้แก้อะไรในฐานข้อมูล';
  end if;
end
$$;

-- ส่วนขยายสำหรับ "ห้ามจองซ้อน" (uuid = + ช่วงวันที่ && ในดัชนีเดียวกัน) — Supabase เก็บส่วนขยายไว้ใน schema extensions
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- =========================================================================
-- 1) สิทธิ์
-- =========================================================================
-- is_member() = "พนักงานร้าน NEWCUTE" — เนื้อเดียวกับ fix-04 ทุกตัวอักษร (ไม่มีคีย์ร้านเช่า)
--   สร้างซ้ำไว้ที่นี่เพื่อแก้ฐานข้อมูลที่เคยรันไฟล์นี้รุ่นก่อน (ซึ่งเคยใส่ rental/rental_manage ไว้ → พนักงานร้านเช่าอ่านยอดขาย NEWCUTE ได้)
--   ร้านเช่าใช้ rental_staff() / rental_manager() แยกต่างหากทุกที่ จึงไม่ต้องพึ่ง is_member()
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select up.role = 'admin' or exists (
               select 1
                 from unnest(array['products', 'stock', 'sales', 'labels', 'reports', 'users', 'refunds']) as k(perm)
                where (up.permissions -> k.perm) = 'true'::jsonb
             )
        from public.user_profiles up
       where up.id = auth.uid()
    ),
    false
  )
$$;

revoke execute on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

-- พนักงานร้านเช่า = rental หรือ rental_manage (has_perm นับแอดมินให้แล้ว) — ใช้ใน RLS จึงให้ authenticated เรียกได้
create or replace function public.rental_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_perm('rental') or public.has_perm('rental_manage')
$$;

create or replace function public.rental_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_perm('rental_manage')
$$;

revoke all on function public.rental_staff() from public, anon;
grant execute on function public.rental_staff() to authenticated;
revoke all on function public.rental_manager() from public, anon;
grant execute on function public.rental_manager() to authenticated;

-- =========================================================================
-- 2) ตาราง
-- =========================================================================

-- ----- ตั้งค่าร้านเช่า (มีแถวเดียวเสมอ: id = true) -----
create table if not exists public.rental_settings (
  id boolean primary key default true check (id),
  shop_name text not null default 'ร้านเช่าชุด',
  tagline text,
  address text,
  phone text,
  line_id text,
  line_url text,
  facebook_url text,
  opening_hours text,
  promptpay_id text,                                -- เบอร์มือถือ 10 หลัก หรือเลขผู้เสียภาษี 13 หลัก (ตัวเลขล้วน)
  promptpay_name text,
  bank_accounts jsonb not null default '[]'::jsonb, -- [{bank, account_no, account_name}] ไม่เกิน 5 บัญชี
  booking_deposit_percent numeric(5, 2) not null default 50 check (booking_deposit_percent between 0 and 100),
  min_booking_deposit numeric(10, 2) not null default 0 check (min_booking_deposit >= 0),
  default_base_days integer not null default 3 check (default_base_days between 1 and 60),
  buffer_before_days integer not null default 0 check (buffer_before_days between 0 and 14),
  buffer_after_days integer not null default 1 check (buffer_after_days between 0 and 14),
  late_fee_mode text not null default 'per_day_item' check (late_fee_mode in ('per_day_item', 'fixed_per_day', 'none')),
  late_fee_fixed numeric(10, 2) not null default 0 check (late_fee_fixed >= 0),
  online_enabled boolean not null default true,
  online_hold_hours integer not null default 24 check (online_hold_hours between 1 and 168),
  online_min_lead_days integer not null default 1 check (online_min_lead_days between 0 and 365),
  online_max_days integer not null default 14 check (online_max_days between 1 and 60),
  online_notice text,
  terms_text text not null default '1. การจองจะสมบูรณ์เมื่อผู้เช่าชำระเงินมัดจำตามที่ร้านกำหนดแล้ว เงินมัดจำนำไปหักจากค่าเช่าในวันรับชุด
2. ผู้เช่าต้องวางเงินประกันชุดในวันรับชุด และจะได้รับคืนเมื่อคืนชุดครบถ้วนในสภาพปกติ หลังหักค่าปรับหรือค่าเสียหาย (ถ้ามี)
3. ผู้เช่าต้องแสดงบัตรประชาชนหรือหนังสือเดินทางตัวจริงในวันรับชุด และตรวจสภาพชุดก่อนรับ หากพบตำหนิต้องแจ้งร้านทันที
4. ผู้เช่าต้องคืนชุดภายในวันที่กำหนดในสัญญา หากคืนช้ากว่ากำหนด ร้านคิดค่าปรับตามอัตราที่ร้านกำหนดต่อวัน
5. ห้ามซัก รีด อบ ย้อม ตัด เย็บ หรือดัดแปลงชุดด้วยตนเอง ร้านเป็นผู้ดูแลทำความสะอาดชุดหลังคืน
6. หากชุดชำรุด มีรอยเปื้อนที่ซักไม่ออก ฉีกขาด หรืออุปกรณ์เสริมไม่ครบ ผู้เช่าต้องชำระค่าซ่อมหรือค่าเสียหายตามจริง
7. หากชุดหรืออุปกรณ์เสริมสูญหาย ผู้เช่าต้องชำระค่าชดเชยตามราคาที่ร้านกำหนด
8. การยกเลิกการจองหลังชำระเงินมัดจำแล้ว ร้านขอสงวนสิทธิ์ไม่คืนเงินมัดจำ
9. การเลื่อนวันรับ-คืนชุดต้องแจ้งล่วงหน้า และขึ้นอยู่กับคิวว่างของชุด อาจมีค่าเช่าเพิ่มตามจำนวนวันที่เปลี่ยน
10. หากผู้เช่าไม่มารับชุดตามวันนัดโดยไม่แจ้งล่วงหน้า ถือว่าสละสิทธิ์ และร้านไม่คืนเงินมัดจำ
11. ผู้เช่าต้องดูแลชุดตลอดระยะเวลาเช่า ร้านไม่รับผิดชอบความเสียหายใดที่เกิดจากการใช้งานของผู้เช่าหรือบุคคลอื่น
12. ร้านเก็บข้อมูลส่วนบุคคลของผู้เช่า (ชื่อ เบอร์โทร เลขบัตร ที่อยู่) เพื่อใช้ในการเช่าและการติดต่อเท่านั้น ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562
13. ผู้เช่าได้อ่านและเข้าใจข้อตกลงทั้งหมดแล้ว จึงลงลายมือชื่อไว้เป็นหลักฐาน',
  receipt_footer text default 'ขอบคุณที่ใช้บริการค่ะ',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.rental_settings (id) values (true) on conflict (id) do nothing;

-- ----- หมวดชุด -----
create table if not exists public.rental_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists rental_categories_name_ci on public.rental_categories (lower(name));

-- ----- แบบชุด (ราคาอยู่ที่แบบ; ชิ้นจริงอยู่ใน rental_units) -----
create table if not exists public.rental_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid unique,                            -- สุ่มครั้งเดียวต่อฟอร์มเพิ่มชุด → กดบันทึกซ้ำไม่เกิดชุดซ้ำ
  code text not null check (code ~ '^[!-~]{1,30}$'),
  name text not null check (char_length(name) between 1 and 150),
  category_id uuid references public.rental_categories (id) on delete set null,
  description text check (description is null or char_length(description) <= 3000),
  color text check (color is null or char_length(color) <= 60),
  base_price numeric(10, 2) not null check (base_price >= 0),
  base_days integer not null check (base_days between 1 and 60),
  extra_day_price numeric(10, 2) not null default 0 check (extra_day_price >= 0),
  security_deposit numeric(10, 2) not null default 0 check (security_deposit >= 0),
  replacement_cost numeric(10, 2) not null default 0 check (replacement_cost >= 0),
  buffer_before_days integer check (buffer_before_days is null or buffer_before_days between 0 and 14),  -- null = ตามตั้งค่าร้าน
  buffer_after_days integer check (buffer_after_days is null or buffer_after_days between 0 and 14),
  is_accessory boolean not null default false,
  is_public boolean not null default true,
  is_active boolean not null default true,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()     -- เวอร์ชันของแบบ (กันฟอร์มเก่าบันทึกทับ)
);
create unique index if not exists rental_items_code_ci on public.rental_items (lower(code));
create index if not exists idx_rental_items_category on public.rental_items (category_id);

create table if not exists public.rental_item_images (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.rental_items (id) on delete cascade,
  path text not null unique,
  sort_order integer not null default 0,
  width integer,
  height integer,
  created_at timestamptz not null default now()
);
create index if not exists idx_rental_item_images_item on public.rental_item_images (item_id, sort_order);

-- ----- ชิ้นจริง (1 ตัว = 1 แถว มีรหัสบาร์โค้ดของตัวเอง) -----
create table if not exists public.rental_units (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.rental_items (id) on delete restrict,
  unit_code text not null check (unit_code ~ '^[!-~]{1,40}$'),
  size text check (size is null or char_length(size) between 1 and 20),   -- null = ฟรีไซส์
  status text not null default 'available' check (status in ('available', 'maintenance', 'retired')),
  needs_cleaning boolean not null default false,
  condition_note text check (condition_note is null or char_length(condition_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists rental_units_code_ci on public.rental_units (lower(unit_code));
create index if not exists idx_rental_units_item on public.rental_units (item_id);

-- ----- ลูกค้า -----
create table if not exists public.rental_customers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid unique,
  name text not null check (char_length(name) between 1 and 100),
  phone text check (phone is null or phone ~ '^[0-9]{9,15}$'),
  phone2 text check (phone2 is null or phone2 ~ '^[0-9]{9,15}$'),
  line_id text check (line_id is null or char_length(line_id) <= 50),
  email text check (email is null or char_length(email) <= 100),
  id_card_no text check (id_card_no is null or char_length(id_card_no) <= 30),
  address text check (address is null or char_length(address) <= 500),
  note text check (note is null or char_length(note) <= 1000),
  is_blacklisted boolean not null default false,
  blacklist_reason text check (blacklist_reason is null or char_length(blacklist_reason) <= 200),
  source text not null default 'walkin' check (source in ('walkin', 'online', 'phone', 'line', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_rental_customers_phone on public.rental_customers (phone);
create index if not exists idx_rental_customers_name on public.rental_customers (lower(name));

-- ----- การจอง / สัญญาเช่า -----
create table if not exists public.rental_bookings (
  id uuid primary key default gen_random_uuid(),
  booking_no text not null unique,
  client_id uuid unique,
  public_token text unique,                         -- ลิงก์ดูสถานะของลูกค้า /book/status/<token> (64 ตัวอักษร)
  source text not null default 'walkin' check (source in ('walkin', 'online', 'phone', 'line', 'other')),
  customer_id uuid not null references public.rental_customers (id) on delete restrict,
  status text not null default 'confirmed'
    check (status in ('pending', 'confirmed', 'picked_up', 'returned', 'completed', 'cancelled', 'expired', 'no_show')),
  pickup_date date not null,
  return_date date not null,
  event_date date,
  fitting_date date,
  fitting_time text check (fitting_time is null or char_length(fitting_time) <= 20),
  pickup_time text check (pickup_time is null or char_length(pickup_time) <= 20),
  delivery_method text not null default 'pickup' check (delivery_method in ('pickup', 'delivery')),
  delivery_address text check (delivery_address is null or char_length(delivery_address) <= 500),
  delivery_fee numeric(10, 2) not null default 0 check (delivery_fee >= 0),
  discount numeric(10, 2) not null default 0 check (discount >= 0),
  discount_note text,
  security_override numeric(10, 2) check (security_override is null or security_override >= 0),
  -- ยอดเงินที่คำนวณไว้ (เขียนโดย rental_recalc เท่านั้น — ไม่เชื่อตัวเลขจากเครื่องลูก)
  rent_total numeric(10, 2) not null default 0,
  charges_total numeric(10, 2) not null default 0,
  grand_total numeric(10, 2) not null default 0,
  paid numeric(10, 2) not null default 0,
  due numeric(10, 2) not null default 0,
  security_required numeric(10, 2) not null default 0,
  security_held numeric(10, 2) not null default 0,
  deposit_required numeric(10, 2) not null default 0,
  deposit_met boolean not null default false,
  customer_note text,
  note text,
  cancel_reason text,
  expires_at timestamptz,
  id_checked boolean not null default false,
  confirmed_at timestamptz,
  picked_up_at timestamptz,
  picked_up_by uuid references auth.users (id) on delete set null,
  returned_at timestamptz,
  returned_on date,
  returned_by uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rental_bookings_dates_chk check (return_date >= pickup_date)
);
create index if not exists idx_rental_bookings_status on public.rental_bookings (status);
create index if not exists idx_rental_bookings_pickup on public.rental_bookings (pickup_date);
create index if not exists idx_rental_bookings_return on public.rental_bookings (return_date);
create index if not exists idx_rental_bookings_customer on public.rental_bookings (customer_id);
create index if not exists idx_rental_bookings_source_status on public.rental_bookings (source, status);

-- ----- ชุดในการจอง (1 แถว = 1 ชิ้นจริง) -----
--   block_range = [วันรับ − วันเตรียม, วันคืน + วันซัก + 1) ; blocking = การจองยังกันชิ้นนี้อยู่
--   ห้ามจองซ้อน: ชิ้นเดียวกัน + ช่วงที่ทับกัน + ยังกันอยู่ทั้งคู่ → ฐานข้อมูลปฏิเสธ (SQLSTATE 23P01)
create table if not exists public.rental_booking_lines (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.rental_bookings (id) on delete cascade,
  item_id uuid not null references public.rental_items (id) on delete restrict,
  unit_id uuid not null references public.rental_units (id) on delete restrict,
  size text,
  rent_price numeric(10, 2) not null default 0 check (rent_price >= 0),
  base_price numeric(10, 2) not null default 0,     -- ราคา ณ ตอนจอง (แก้ราคาชุดทีหลังไม่กระทบการจองเดิม)
  base_days integer not null default 1,
  extra_day_price numeric(10, 2) not null default 0,
  deposit numeric(10, 2) not null default 0,        -- ค่าประกันชุด ณ ตอนจอง
  status text not null default 'booked' check (status in ('booked', 'picked_up', 'returned', 'lost')),
  return_condition text check (return_condition is null or return_condition in ('ok', 'dirty', 'damaged', 'lost')),
  return_note text,
  block_range daterange not null,
  blocking boolean not null default true,
  sort_order integer not null default 0,
  constraint rental_lines_no_overlap exclude using gist (unit_id with =, block_range with &&) where (blocking)
);
create index if not exists idx_rental_lines_booking on public.rental_booking_lines (booking_id);
create index if not exists idx_rental_lines_item on public.rental_booking_lines (item_id);
create index if not exists idx_rental_lines_unit on public.rental_booking_lines (unit_id);

-- ----- ค่าปรับ / ค่าใช้จ่ายเพิ่ม (ไม่ลบ — ยกเลิกพร้อมเหตุผล) -----
create table if not exists public.rental_charges (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.rental_bookings (id) on delete cascade,
  line_id uuid references public.rental_booking_lines (id) on delete set null,
  kind text not null check (kind in ('late', 'damage', 'lost', 'cleaning', 'delivery', 'other')),
  description text not null check (char_length(description) between 1 and 200),
  amount numeric(10, 2) not null check (amount > 0),
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_rental_charges_booking on public.rental_charges (booking_id);

-- ----- รับเงิน / คืนเงิน / เงินประกัน (ไม่ลบ — ยกเลิกพร้อมเหตุผล) -----
create table if not exists public.rental_payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid unique,                            -- สุ่มจากเครื่องตอนเปิดหน้ารับเงิน — กดซ้ำ/เน็ตหลุดไม่บันทึกซ้ำ
  booking_id uuid not null references public.rental_bookings (id) on delete restrict,
  receipt_no text unique,                           -- ออกเลขตอนเงินเข้าจริง (สลิปที่รอตรวจยังไม่มีเลข)
  kind text not null check (kind in ('payment', 'refund', 'security_in', 'security_out', 'security_apply')),
  method text not null check (method in ('cash', 'transfer', 'promptpay', 'credit', 'none')),
  amount numeric(10, 2) not null check (amount > 0),
  status text not null default 'confirmed' check (status in ('confirmed', 'pending_review', 'rejected')),
  slip_path text,
  note text check (note is null or char_length(note) <= 300),
  reject_reason text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  constraint rental_payments_method_chk check ((kind = 'security_apply') = (method = 'none'))
);
create index if not exists idx_rental_payments_booking on public.rental_payments (booking_id);
create index if not exists idx_rental_payments_created on public.rental_payments (created_at);
create index if not exists idx_rental_payments_review on public.rental_payments (status) where status = 'pending_review';

-- ----- ประวัติการจอง -----
create table if not exists public.rental_logs (
  id bigserial primary key,
  booking_id uuid not null references public.rental_bookings (id) on delete cascade,
  action text not null,
  detail jsonb,
  actor uuid,
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_rental_logs_booking on public.rental_logs (booking_id, id);

-- ----- คอลัมน์ที่เพิ่มทีหลัง (ฐานข้อมูลที่เคยรันไฟล์นี้รุ่นก่อนได้คอลัมน์ครบเหมือนติดตั้งใหม่) -----
-- นโยบายมัดจำ ณ ตอนจอง (เหมือนราคาชุดที่จำไว้ในบรรทัด): ผู้จัดการแก้ % มัดจำทีหลัง ไม่ทำให้ยอดมัดจำของการจองเดิม
--   (ที่พิมพ์ในสัญญา/แสดงบนหน้าสถานะลูกค้าไปแล้ว) เปลี่ยนตาม — rental_recalc ใช้ค่าชุดนี้เสมอ
alter table public.rental_bookings add column if not exists deposit_percent numeric(5, 2);
alter table public.rental_bookings add column if not exists min_deposit numeric(10, 2);
-- ชื่อที่ลูกค้าพิมพ์ตอนส่งคำขอออนไลน์ (หน้าสถานะแสดงชื่อนี้แบบปิดบางส่วน — ไม่ใช่ชื่อที่ร้านบันทึกไว้ของเบอร์นั้น)
alter table public.rental_bookings add column if not exists online_name text;
-- วันเวลาที่เงินเข้า/ออกจริง = วันที่ใช้ลงบัญชีรายวัน/รายงาน/ใบเสร็จ (เงินที่พนักงานรับ = ตอนบันทึก, สลิป = ตอนอนุมัติ)
alter table public.rental_payments add column if not exists confirmed_at timestamptz;
-- รหัสคำขอของการเพิ่มค่าปรับ (สุ่มจากเครื่องตอนเปิดหน้าต่าง) — เน็ตหลุดแล้วกดบันทึกซ้ำ ไม่ได้ค่าปรับซ้อนสองรายการ
alter table public.rental_charges add column if not exists client_id uuid;
-- ลายนิ้วมือ (md5) ของข้อมูลที่ส่งมาพร้อมรหัสคำขอตอนสร้างการจอง — ส่งรหัสเดิมซ้ำ หน้าจอรู้ได้ว่าเป็นข้อมูลชุดเดิมหรือไม่ (payload_matches)
alter table public.rental_bookings add column if not exists client_payload_md5 text;
create unique index if not exists rental_charges_client_id_key on public.rental_charges (client_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rental_bookings_online_name_chk'
                    and conrelid = 'public.rental_bookings'::regclass) then
    alter table public.rental_bookings
      add constraint rental_bookings_online_name_chk check (online_name is null or char_length(online_name) <= 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rental_bookings_deposit_policy_chk'
                    and conrelid = 'public.rental_bookings'::regclass) then
    alter table public.rental_bookings
      add constraint rental_bookings_deposit_policy_chk
      check ((deposit_percent is null or deposit_percent between 0 and 100) and (min_deposit is null or min_deposit >= 0));
  end if;
end
$$;

-- การจองที่มีอยู่ก่อนแล้ว: ใช้นโยบายมัดจำของร้านตอนนี้เป็นค่าตั้งต้น (รันครั้งเดียว — รันซ้ำไม่แตะแถวที่มีค่าแล้ว)
update public.rental_bookings as b
   set deposit_percent = coalesce(b.deposit_percent, s.booking_deposit_percent),
       min_deposit = coalesce(b.min_deposit, s.min_booking_deposit)
  from public.rental_settings as s
 where s.id and (b.deposit_percent is null or b.min_deposit is null);
-- เงินที่ยืนยันแล้วก่อนมีคอลัมน์นี้: สลิป = เวลาอนุมัติ / อื่นๆ = เวลาบันทึก
update public.rental_payments as p
   set confirmed_at = coalesce(p.reviewed_at, p.created_at)
 where p.status = 'confirmed' and p.confirmed_at is null;
update public.rental_payments as p
   set confirmed_at = null
 where p.status <> 'confirmed' and p.confirmed_at is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rental_payments_confirmed_at_chk'
                    and conrelid = 'public.rental_payments'::regclass) then
    alter table public.rental_payments
      add constraint rental_payments_confirmed_at_chk check ((status = 'confirmed') = (confirmed_at is not null));
  end if;
end
$$;
create index if not exists idx_rental_payments_confirmed on public.rental_payments (confirmed_at);

-- ----- updated_at = เวอร์ชันของแถว (ต้องมากขึ้นเสมอ แม้แก้สองครั้งในเสี้ยววินาทีเดียวกัน) -----
create or replace function public.rental_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := greatest(now(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;

drop trigger if exists rental_items_touch on public.rental_items;
create trigger rental_items_touch before update on public.rental_items
  for each row execute function public.rental_touch();
drop trigger if exists rental_units_touch on public.rental_units;
create trigger rental_units_touch before update on public.rental_units
  for each row execute function public.rental_touch();
drop trigger if exists rental_customers_touch on public.rental_customers;
create trigger rental_customers_touch before update on public.rental_customers
  for each row execute function public.rental_touch();
drop trigger if exists rental_bookings_touch on public.rental_bookings;
create trigger rental_bookings_touch before update on public.rental_bookings
  for each row execute function public.rental_touch();

-- ----- RLS + สิทธิ์ตาราง: อ่านได้เฉพาะพนักงานร้านเช่า / เขียนผ่านฟังก์ชันเท่านั้น / anon อ่านไม่ได้เลย -----
do $$
declare
  t text;
begin
  foreach t in array array['rental_settings', 'rental_categories', 'rental_items', 'rental_item_images', 'rental_units',
                           'rental_customers', 'rental_bookings', 'rental_booking_lines', 'rental_charges',
                           'rental_payments', 'rental_logs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.rental_staff()))',
                   t || '_select', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end
$$;

revoke all on sequence public.rental_logs_id_seq from anon, authenticated;
grant usage, select on sequence public.rental_logs_id_seq to service_role;

-- =========================================================================
-- 3) ตัวช่วยภายใน (เรียกจาก API ไม่ได้)
-- =========================================================================

-- ผู้ใช้ที่ล็อกอิน + สิทธิ์ร้านเช่า (p_manager = ต้องเป็นผู้จัดการร้านเช่า) → uid
create or replace function public.rental_require(p_manager boolean)
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
    if not public.rental_manager() then
      raise exception 'เฉพาะผู้จัดการร้านเช่าชุดเท่านั้น' using errcode = '42501';
    end if;
  elsif not public.rental_staff() then
    raise exception 'ไม่มีสิทธิ์ใช้งานร้านเช่าชุด' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create or replace function public.rental_settings_row()
returns public.rental_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.rental_settings;
begin
  select x.* into s from public.rental_settings as x where x.id;
  if not found then
    insert into public.rental_settings as x (id) values (true) on conflict (id) do nothing;
    select x.* into s from public.rental_settings as x where x.id;
  end if;
  return s;
end;
$$;

-- จำนวนวันเช่า (นับวันรับและวันคืน: รับศุกร์ คืนอาทิตย์ = 3 วัน)
create or replace function public.rental_days(p_from date, p_to date)
returns integer
language sql
immutable
security definer
set search_path = public
as $$
  select (p_to - p_from + 1)::integer
$$;

-- ค่าเช่าต่อชิ้น = ราคาพื้นฐาน + (วันที่เกินจำนวนวันพื้นฐาน × ค่าวันเพิ่ม)
create or replace function public.rental_line_price(p_base numeric, p_base_days integer, p_extra numeric, p_days integer)
returns numeric
language sql
immutable
security definer
set search_path = public
as $$
  select round(coalesce(p_base, 0) + greatest(0, p_days - coalesce(p_base_days, 1)) * coalesce(p_extra, 0), 2)
$$;

-- วันเตรียม/ซักของชุด (ค่าของชุด ไม่ตั้ง = ตามตั้งค่าร้าน)
create or replace function public.rental_item_buffers(p_item_id uuid, out p_before integer, out p_after integer)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(i.buffer_before_days, s.buffer_before_days, 0),
         coalesce(i.buffer_after_days, s.buffer_after_days, 1)
    from (select true as k) as one
    left join public.rental_items as i on i.id = p_item_id
    left join public.rental_settings as s on s.id
$$;

-- ช่วงวันที่ชิ้นถูกกันไว้ [วันรับ − วันเตรียม, วันคืน + วันซัก + 1)
create or replace function public.rental_block_range(p_item_id uuid, p_pickup date, p_return date)
returns daterange
language sql
stable
security definer
set search_path = public
as $$
  select daterange(p_pickup - b.p_before, p_return + b.p_after + 1, '[)')
    from public.rental_item_buffers(p_item_id) as b
$$;

-- ช่วงวันที่ที่บรรทัดหนึ่ง "กันชิ้นไว้จริง" ณ วันนี้
--   ปกติ = block_range ที่บันทึกไว้ / ชิ้นที่ลูกค้ารับไปแล้วยังไม่คืน (picked_up) = ยืดถึงอย่างน้อย วันนี้ + วันซัก
--   (ลูกค้าคืนช้า: ช่วงที่บันทึกไว้จบตั้งแต่วันคืนเดิม แต่ชุดยังไม่กลับมาที่ร้าน — ห้ามให้คนอื่นจอง/รับชิ้นนี้)
create or replace function public.rental_line_busy_range(p_range daterange, p_status text, p_item_id uuid)
returns daterange
language sql
stable
security definer
set search_path = public
as $$
  select case
           when p_status = 'picked_up' then
             daterange(lower(p_range),
                       greatest(upper(p_range),
                                public.pos_bkk_today() + (select bf.p_after from public.rental_item_buffers(p_item_id) as bf) + 1),
                       '[)')
           else p_range
         end
$$;

-- ชิ้นนี้ว่างในช่วง p_range ไหม (ไม่นับบรรทัดของการจอง p_exclude_booking) — ทุกที่ที่ตรวจ "ว่าง" ใช้ตัวนี้ตัวเดียว
create or replace function public.rental_unit_free(p_unit_id uuid, p_range daterange, p_exclude_booking uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
      from public.rental_booking_lines as l
     where l.unit_id = p_unit_id
       and l.blocking
       and l.booking_id is distinct from p_exclude_booking
       and public.rental_line_busy_range(l.block_range, l.status, l.item_id) && p_range)
$$;

-- ข้อความเงิน/วันที่ในข้อความแจ้งเตือน (วันที่แบบไทย พ.ศ.)
create or replace function public.rental_baht(p numeric)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select '฿' || to_char(coalesce(p, 0), 'FM99,999,999,990.00')
$$;

create or replace function public.rental_thai_date(p date)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case when p is null then '-'
              else to_char(p, 'DD/MM/') || (extract(year from p)::integer + 543)::text end
$$;

create or replace function public.rental_status_label(p_status text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case p_status
           when 'pending' then 'รอยืนยัน'
           when 'confirmed' then 'จองแล้ว'
           when 'picked_up' then 'กำลังเช่า'
           when 'returned' then 'คืนชุดแล้ว รอปิดงาน'
           when 'completed' then 'เสร็จสิ้น'
           when 'cancelled' then 'ยกเลิก'
           when 'expired' then 'หมดเวลาถือการจอง'
           when 'no_show' then 'ไม่มารับชุด'
           else coalesce(p_status, '-')
         end
$$;

-- ----- อ่านค่าจาก JSON (ตามแบบ product_json_* ของ fix-02) -----
create or replace function public.rental_json_text(p_value jsonb, p_label text, p_max integer)
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

create or replace function public.rental_json_int(p_value jsonb, p_label text, p_min integer, p_max integer)
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

create or replace function public.rental_json_date(p_value jsonb, p_label text)
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

-- เงิน: ไม่ติดลบ, ทศนิยมไม่เกิน 2 ตำแหน่ง, ไม่เกิน 99,999,999.99 (p_allow_zero = false → ต้องมากกว่า 0)
create or replace function public.rental_check_money(p_value numeric, p_label text, p_allow_zero boolean)
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

create or replace function public.rental_json_money(p_value jsonb, p_label text, p_allow_zero boolean)
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
  return public.rental_check_money(v, p_label, p_allow_zero);
end;
$$;

-- เบอร์โทร: เก็บเฉพาะตัวเลข 9-15 หลัก (ขีด/ช่องว่าง/วงเล็บตัดทิ้ง)
create or replace function public.rental_json_phone(p_value jsonb, p_label text)
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
create or replace function public.rental_reason(p_value text, p_label text)
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

-- ----- ประวัติการจอง (p_actor_name ระบุ = ระบบ/ลูกค้าออนไลน์ ไม่ผูกกับผู้ใช้ที่ล็อกอิน) -----
create or replace function public.rental_log(p_booking_id uuid, p_action text, p_detail jsonb, p_actor_name text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := case when p_actor_name is null then auth.uid() end;
begin
  insert into public.rental_logs (booking_id, action, detail, actor, actor_name)
  values (p_booking_id, p_action, p_detail, v_uid,
          coalesce(p_actor_name, public.pos_actor_name(v_uid), 'ระบบ'));
end;
$$;

-- ----- เลขเอกสารรายวัน (ใช้ตัวนับเดียวกับ fix-04 — แถวตัวนับถูกล็อกจนจบรายการ สองเครื่องพร้อมกันไม่ได้เลขซ้ำ) -----
--   'rental' → RT-YYYYMMDD-NNN (การจอง) / 'rental_receipt' → RC-YYYYMMDD-NNN (ใบเสร็จ)
create or replace function public.rental_next_no(p_kind text)
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
  if p_kind = 'rental' then
    v_prefix := 'RT-';
  elsif p_kind = 'rental_receipt' then
    v_prefix := 'RC-';
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
    if p_kind = 'rental' then
      select coalesce(max(substr(b.booking_no, length(v_prefix) + 1)::integer), 0) + 1
        into v_seed
        from public.rental_bookings as b
       where b.booking_no like (v_prefix || '%')
         and substr(b.booking_no, length(v_prefix) + 1) ~ '^[0-9]{1,9}$';
    else
      select coalesce(max(substr(p.receipt_no, length(v_prefix) + 1)::integer), 0) + 1
        into v_seed
        from public.rental_payments as p
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

-- ----- การจองที่หมดเวลาถือ (pending เลย expires_at) → expired + ปล่อยชิ้น -----
--   เรียกตอนต้นของทุกฟังก์ชันที่สร้าง/แก้การจอง หรืออ่านความว่าง/ภาพรวม (skip locked = ไม่รอแถวที่เครื่องอื่นกำลังแก้)
--   ไม่ปล่อยการจองที่ลูกค้าจ่ายเงินแล้ว หรือมีสลิปรอร้านตรวจ (ลูกค้าโอนทันเวลา แต่ร้านตรวจทีหลัง ต้องไม่เสียชุด)
--   — การจองพวกนี้ค้าง "รอยืนยัน" ไว้ให้พนักงานยืนยัน/ยกเลิกเอง
create or replace function public.rental_expire_pending()
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
    select b.id, b.expires_at
      from public.rental_bookings as b
     where b.status = 'pending'
       and b.expires_at is not null
       and b.expires_at <= now()
       and b.paid <= 0.005
       and not exists (select 1 from public.rental_payments as p
                        where p.booking_id = b.id and p.status = 'pending_review' and p.voided_at is null)
     order by b.expires_at
       for update skip locked
  loop
    update public.rental_bookings as b set status = 'expired' where b.id = r.id;
    update public.rental_booking_lines as l set blocking = false where l.booking_id = r.id;
    perform public.rental_log(r.id, 'expire', jsonb_build_object('expires_at', r.expires_at), 'ระบบ');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ----- ข้อความเมื่อชิ้นไม่ว่าง (บอกเลขการจองที่ชน + วันรับ-คืน) -----
create or replace function public.rental_conflict_text(p_unit_id uuid, p_range daterange, p_exclude_booking uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code text;
  r record;
begin
  select u.unit_code into v_code from public.rental_units as u where u.id = p_unit_id;
  select b.booking_no, b.pickup_date, b.return_date, l.status as line_status
    into r
    from public.rental_booking_lines as l
    join public.rental_bookings as b on b.id = l.booking_id
   where l.unit_id = p_unit_id
     and l.blocking
     and public.rental_line_busy_range(l.block_range, l.status, l.item_id) && p_range
     and l.booking_id is distinct from p_exclude_booking
   order by (l.status = 'picked_up') desc, lower(l.block_range), b.booking_no
   limit 1;
  if not found then
    return format('ชิ้น %s ไม่ว่างในช่วงวันที่นี้ (เพิ่งถูกจองจากเครื่องอื่น) กรุณาเลือกชิ้นหรือวันอื่น', coalesce(v_code, '-'));
  end if;
  if r.line_status = 'picked_up' and r.return_date < public.pos_bkk_today() then
    return format('ชิ้น %s ยังไม่ได้คืนจากการจอง %s (กำหนดคืน %s — ลูกค้ายังไม่นำชุดมาคืน) กรุณาเลือกชิ้นหรือวันอื่น',
                  coalesce(v_code, '-'), r.booking_no, public.rental_thai_date(r.return_date));
  end if;
  return format('ชิ้น %s ไม่ว่าง: ชนกับการจอง %s (รับ %s – คืน %s รวมวันเตรียม/ซักชุด) กรุณาเลือกชิ้นหรือวันอื่น',
                coalesce(v_code, '-'), r.booking_no, public.rental_thai_date(r.pickup_date), public.rental_thai_date(r.return_date));
end;
$$;

-- ----- คำนวณยอดเงินของการจองใหม่ทั้งหมด (ที่เดียวในระบบที่เขียนช่องเงินของการจอง) -----
create or replace function public.rental_recalc(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.rental_bookings%rowtype;
  s public.rental_settings;
  v_rent numeric := 0;
  v_dep numeric := 0;
  v_charges numeric := 0;
  v_pay numeric := 0;
  v_refund numeric := 0;
  v_sin numeric := 0;
  v_sout numeric := 0;
  v_apply numeric := 0;
  v_grand numeric;
  v_paid numeric;
  v_req numeric;
begin
  select x.* into b from public.rental_bookings as x where x.id = p_booking_id;
  if not found then
    return;
  end if;
  s := public.rental_settings_row();

  select coalesce(sum(l.rent_price), 0), coalesce(sum(l.deposit), 0)
    into v_rent, v_dep
    from public.rental_booking_lines as l
   where l.booking_id = p_booking_id;

  select coalesce(sum(c.amount), 0)
    into v_charges
    from public.rental_charges as c
   where c.booking_id = p_booking_id and c.voided_at is null;

  -- นับเฉพาะเงินที่ยืนยันแล้วและไม่ถูกยกเลิก (สลิปรอตรวจ/ถูกปฏิเสธ ไม่นับ)
  select coalesce(sum(p.amount) filter (where p.kind = 'payment'), 0),
         coalesce(sum(p.amount) filter (where p.kind = 'refund'), 0),
         coalesce(sum(p.amount) filter (where p.kind = 'security_in'), 0),
         coalesce(sum(p.amount) filter (where p.kind = 'security_out'), 0),
         coalesce(sum(p.amount) filter (where p.kind = 'security_apply'), 0)
    into v_pay, v_refund, v_sin, v_sout, v_apply
    from public.rental_payments as p
   where p.booking_id = p_booking_id
     and p.status = 'confirmed'
     and p.voided_at is null;

  v_grand := v_rent - b.discount + b.delivery_fee + v_charges;
  if v_grand > 99999999.99 or v_rent > 99999999.99 then
    raise exception 'ยอดรวมของการจองสูงเกินไป (สูงสุด 99,999,999.99)';
  end if;
  v_paid := v_pay + v_apply - v_refund;
  -- มัดจำจอง = max(มัดจำขั้นต่ำ, ปัดขึ้น(ค่าเช่าหลังส่วนลด × %)) แต่ไม่เกินยอดรวม
  --   ใช้นโยบาย ณ ตอนจอง (deposit_percent / min_deposit บนการจอง) — ผู้จัดการแก้ตั้งค่าทีหลังไม่กระทบการจองเดิม
  v_req := least(greatest(v_grand, 0),
                 greatest(coalesce(b.min_deposit, s.min_booking_deposit),
                          ceil(greatest(v_rent - b.discount, 0) * coalesce(b.deposit_percent, s.booking_deposit_percent) / 100)));

  update public.rental_bookings as x
     set rent_total = v_rent,
         charges_total = v_charges,
         grand_total = v_grand,
         paid = v_paid,
         due = v_grand - v_paid,
         security_required = coalesce(b.security_override, v_dep),
         security_held = v_sin - v_sout - v_apply,
         deposit_required = v_req,
         deposit_met = v_paid >= v_req - 0.005
   where x.id = p_booking_id;
end;
$$;

-- ล็อกการจองก่อนแก้ (กันสองเครื่องแก้พร้อมกัน)
create or replace function public.rental_lock_booking(p_booking_id uuid)
returns public.rental_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.rental_bookings%rowtype;
begin
  if p_booking_id is null then
    raise exception 'ไม่พบการจองนี้';
  end if;
  select x.* into b from public.rental_bookings as x where x.id = p_booking_id for update;
  if not found then
    raise exception 'ไม่พบการจองนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  return b;
end;
$$;

-- =========================================================================
-- 4) JSON ที่หน้าจอใช้
-- =========================================================================

create or replace function public.rental_settings_json()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select (to_jsonb(s) - 'id') || jsonb_build_object('public_url_path', '/book')
    from public.rental_settings as s
   where s.id
$$;

create or replace function public.rental_unit_json(p_unit_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', u.id, 'item_id', u.item_id, 'unit_code', u.unit_code, 'size', u.size, 'status', u.status,
           'needs_cleaning', u.needs_cleaning, 'condition_note', u.condition_note, 'updated_at', u.updated_at)
    from public.rental_units as u
   where u.id = p_unit_id
$$;

create or replace function public.rental_item_json(p_item_id uuid, p_already_saved boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with today as (select public.pos_bkk_today() as d)
  select jsonb_build_object(
           'id', i.id, 'code', i.code, 'name', i.name, 'category_id', i.category_id, 'category_name', c.name,
           'description', i.description, 'color', i.color, 'base_price', i.base_price, 'base_days', i.base_days,
           'extra_day_price', i.extra_day_price, 'security_deposit', i.security_deposit,
           'replacement_cost', i.replacement_cost, 'buffer_before_days', i.buffer_before_days,
           'buffer_after_days', i.buffer_after_days, 'is_accessory', i.is_accessory, 'is_public', i.is_public,
           'is_active', i.is_active, 'tags', to_jsonb(i.tags), 'created_at', i.created_at, 'updated_at', i.updated_at,
           'already_saved', coalesce(p_already_saved, false),
           'images', coalesce((
              select jsonb_agg(jsonb_build_object('id', im.id, 'path', im.path, 'sort_order', im.sort_order,
                                                  'width', im.width, 'height', im.height)
                               order by im.sort_order, im.created_at, im.id)
                from public.rental_item_images as im
               where im.item_id = i.id), '[]'::jsonb),
           'units', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'id', u.id, 'unit_code', u.unit_code, 'size', u.size, 'status', u.status,
                       'needs_cleaning', u.needs_cleaning, 'condition_note', u.condition_note,
                       'has_history', exists (select 1 from public.rental_booking_lines as l where l.unit_id = u.id),
                       'next_booking', (
                          select jsonb_build_object('booking_no', b.booking_no, 'pickup_date', b.pickup_date,
                                                    'return_date', b.return_date, 'status', b.status)
                            from public.rental_booking_lines as l
                            join public.rental_bookings as b on b.id = l.booking_id
                           where l.unit_id = u.id
                             and l.blocking
                             and b.status in ('pending', 'confirmed', 'picked_up')
                             and b.return_date >= (select d from today)
                           order by b.pickup_date, b.booking_no
                           limit 1))
                     order by public.product_size_rank(u.size), u.size, u.unit_code)
                from public.rental_units as u
               where u.item_id = i.id), '[]'::jsonb),
           'sizes', coalesce((
              select jsonb_agg(z.size order by public.product_size_rank(z.size), z.size)
                from (select distinct u.size from public.rental_units as u
                       where u.item_id = i.id and u.status = 'available') as z), '[]'::jsonb),
           'stats', (
              select jsonb_build_object(
                       'bookings_total', count(distinct b.id) filter (where b.status not in ('cancelled', 'expired')),
                       'revenue_total', coalesce(sum(l.rent_price) filter (where b.status in ('picked_up', 'returned', 'completed')), 0),
                       'days_rented_90d', coalesce(sum(greatest(0,
                            least(coalesce(b.returned_on, b.return_date), (select d from today))
                            - greatest(b.pickup_date, (select d from today) - 89) + 1))
                            filter (where b.status in ('picked_up', 'returned', 'completed')), 0))
                from public.rental_booking_lines as l
                join public.rental_bookings as b on b.id = l.booking_id
               where l.item_id = i.id))
    from public.rental_items as i
    left join public.rental_categories as c on c.id = i.category_id
   where i.id = p_item_id
$$;

create or replace function public.rental_customer_json(p_customer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', c.id, 'name', c.name, 'phone', c.phone, 'phone2', c.phone2, 'line_id', c.line_id, 'email', c.email,
           'id_card_no', c.id_card_no, 'address', c.address, 'note', c.note, 'is_blacklisted', c.is_blacklisted,
           'blacklist_reason', c.blacklist_reason, 'source', c.source, 'created_at', c.created_at, 'updated_at', c.updated_at,
           'stats', (
              select jsonb_build_object(
                       'bookings', count(*),
                       'completed', count(*) filter (where b.status = 'completed'),
                       'cancelled_no_show', count(*) filter (where b.status in ('cancelled', 'no_show')),
                       'total_paid', coalesce(sum(b.paid), 0),
                       'last_booking_at', max(b.created_at))
                from public.rental_bookings as b
               where b.customer_id = c.id))
    from public.rental_customers as c
   where c.id = p_customer_id
$$;

create or replace function public.rental_payment_json(p_payment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', p.id, 'booking_id', p.booking_id, 'booking_no', b.booking_no, 'receipt_no', p.receipt_no,
           'kind', p.kind, 'method', p.method, 'amount', p.amount, 'status', p.status, 'slip_path', p.slip_path,
           'note', p.note, 'reject_reason', p.reject_reason, 'voided_at', p.voided_at, 'void_reason', p.void_reason,
           'created_by_name', p.created_by_name, 'created_at', p.created_at, 'reviewed_at', p.reviewed_at,
           'confirmed_at', p.confirmed_at)
    from public.rental_payments as p
    join public.rental_bookings as b on b.id = p.booking_id
   where p.id = p_payment_id
$$;

-- ค่าปรับคืนช้าที่แนะนำ (หน้าจอเติมให้ พนักงานแก้ได้)
create or replace function public.rental_late_info(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.rental_bookings%rowtype;
  s public.rental_settings;
  v_today date := public.pos_bkk_today();
  v_days integer := 0;
  v_fee numeric := 0;
begin
  select x.* into b from public.rental_bookings as x where x.id = p_booking_id;
  if not found then
    return jsonb_build_object('late_days', 0, 'suggested_late_fee', 0);
  end if;
  select x.* into s from public.rental_settings as x where x.id;
  if b.status = 'picked_up' then
    v_days := greatest(0, v_today - b.return_date);
  elsif b.status in ('returned', 'completed') and b.returned_on is not null then
    v_days := greatest(0, b.returned_on - b.return_date);
  end if;
  if v_days > 0 then
    if coalesce(s.late_fee_mode, 'per_day_item') = 'per_day_item' then
      select v_days * coalesce(sum(l.extra_day_price), 0) into v_fee
        from public.rental_booking_lines as l
       where l.booking_id = b.id and l.status in ('picked_up', 'returned', 'lost');
    elsif s.late_fee_mode = 'fixed_per_day' then
      v_fee := v_days * s.late_fee_fixed;
    end if;
  end if;
  return jsonb_build_object('late_days', v_days, 'suggested_late_fee', round(v_fee, 2));
end;
$$;

-- การจองแบบย่อ (p_full = false) หรือเต็ม (p_full = true)
create or replace function public.rental_booking_json(p_booking_id uuid, p_full boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.rental_bookings%rowtype;
  c public.rental_customers%rowtype;
  v_today date := public.pos_bkk_today();
  v_mini jsonb;
  v_pending numeric;
  v_names text;
  v_count integer;
  v_late jsonb;
  v_ready boolean;
  v_warn jsonb := '[]'::jsonb;
  v_block jsonb := '[]'::jsonb;
  v_can jsonb;
  v_reasons jsonb;
  v_not_ready text;
begin
  select x.* into b from public.rental_bookings as x where x.id = p_booking_id;
  if not found then
    return null;
  end if;
  select x.* into c from public.rental_customers as x where x.id = b.customer_id;

  select count(*), string_agg(z.name, ', ' order by z.ord) filter (where z.ord <= 3)
    into v_count, v_names
    from (select i.name, row_number() over (order by l.sort_order, l.id) as ord
            from public.rental_booking_lines as l
            join public.rental_items as i on i.id = l.item_id
           where l.booking_id = b.id) as z;

  v_mini := jsonb_build_object(
    'id', b.id, 'booking_no', b.booking_no, 'status', b.status, 'status_label', public.rental_status_label(b.status),
    'source', b.source, 'customer_id', b.customer_id, 'customer_name', c.name, 'customer_phone', c.phone,
    'pickup_date', b.pickup_date, 'return_date', b.return_date, 'fitting_date', b.fitting_date,
    'fitting_time', b.fitting_time, 'pickup_time', b.pickup_time, 'items_count', coalesce(v_count, 0),
    'item_names', case when coalesce(v_count, 0) > 3 then v_names || ' และอีก ' || (v_count - 3) || ' รายการ' else v_names end,
    'grand_total', b.grand_total, 'due', b.due, 'deposit_met', b.deposit_met, 'expires_at', b.expires_at);
  if not coalesce(p_full, false) then
    return v_mini;
  end if;

  select coalesce(sum(p.amount), 0) into v_pending
    from public.rental_payments as p
   where p.booking_id = b.id and p.status = 'pending_review' and p.voided_at is null;

  v_late := public.rental_late_info(b.id);

  -- ข้อควรระวังก่อนรับชุด (ต้องกดยืนยันแบบบังคับพร้อมเหตุผลถ้ายังมี)
  if b.status in ('pending', 'confirmed') then
    if b.due > 0.005 then
      v_warn := v_warn || to_jsonb('ยังค้างชำระ ' || public.rental_baht(b.due));
    end if;
    if b.security_held < b.security_required - 0.005 then
      v_warn := v_warn || to_jsonb('ยังรับเงินประกันไม่ครบ (ขาด ' || public.rental_baht(b.security_required - b.security_held) || ')');
    end if;
    select string_agg(u.unit_code || case when u.status = 'maintenance' then ' (ส่งซ่อม)'
                                          when u.status = 'retired' then ' (เลิกใช้)'
                                          else ' (ยังไม่ได้ซัก/เตรียม)' end, ', ' order by u.unit_code)
      into v_not_ready
      from public.rental_booking_lines as l
      join public.rental_units as u on u.id = l.unit_id
     where l.booking_id = b.id and (u.needs_cleaning or u.status <> 'available');
    if v_not_ready is not null then
      v_warn := v_warn || to_jsonb('ชิ้นยังไม่พร้อม: ' || v_not_ready);
    end if;
    -- ชิ้นที่ยังอยู่กับลูกค้าการจองอื่น (รับไปแล้วยังไม่คืน) — ส่งมอบไม่ได้จริง กดบังคับก็ไม่ได้: ต้องบันทึกรับคืนก่อน หรือสลับชิ้น
    select coalesce(jsonb_agg(to_jsonb(format('ชิ้น %s ยังไม่ได้คืนจากการจอง %s (กำหนดคืน %s) — บันทึกรับคืนก่อน หรือสลับไปชิ้นอื่น',
                                              z.unit_code, z.booking_no, public.rental_thai_date(z.return_date)))
                              order by z.unit_code, z.booking_no), '[]'::jsonb)
      into v_block
      from (select distinct u.unit_code, ob.booking_no, ob.return_date
              from public.rental_booking_lines as l
              join public.rental_units as u on u.id = l.unit_id
              join public.rental_booking_lines as ol
                on ol.unit_id = l.unit_id and ol.booking_id <> b.id and ol.status = 'picked_up'
              join public.rental_bookings as ob on ob.id = ol.booking_id
             where l.booking_id = b.id and l.status = 'booked') as z;
    v_warn := v_warn || v_block;
    if v_today < b.pickup_date then
      v_warn := v_warn || to_jsonb('ยังไม่ถึงวันรับชุด (' || public.rental_thai_date(b.pickup_date) || ')');
    end if;
  end if;

  v_can := jsonb_build_object(
    'can_edit', b.status in ('pending', 'confirmed'),
    'can_confirm', b.status = 'pending',
    'can_extend_hold', b.status = 'pending',
    'can_cancel', b.status in ('pending', 'confirmed'),
    'can_no_show', b.status = 'confirmed' and b.pickup_date < v_today,
    'can_pickup', b.status in ('pending', 'confirmed'),
    'can_extend', b.status in ('confirmed', 'picked_up'),
    'can_return', b.status = 'picked_up',
    'can_complete', b.status = 'returned' and abs(b.due) < 0.005 and b.security_held < 0.005,
    'can_pay', b.status in ('pending', 'confirmed', 'picked_up', 'returned') and b.due > 0.005,
    'can_refund', b.paid > 0.005 and b.status <> 'completed',
    'can_security_in', b.status in ('confirmed', 'picked_up') and b.security_required - b.security_held > 0.005,
    'can_security_out', b.status in ('picked_up', 'returned', 'cancelled', 'no_show') and b.security_held > 0.005,
    'can_security_apply', b.status in ('picked_up', 'returned') and b.security_held > 0.005 and b.due > 0.005,
    'can_add_charge', b.status in ('picked_up', 'returned'));

  v_reasons := jsonb_build_object(
    'complete', case
                  when b.status <> 'returned' then 'ปิดงานได้หลังรับคืนชุดแล้วเท่านั้น'
                  when b.due > 0.005 then 'ยังค้างชำระ ' || public.rental_baht(b.due)
                  when b.due < -0.005 then 'รับเงินเกิน ' || public.rental_baht(-b.due) || ' ต้องคืนเงินก่อน'
                  when b.security_held >= 0.005 then 'ยังถือเงินประกัน ' || public.rental_baht(b.security_held) || ' ต้องคืนหรือหักก่อน'
                end,
    'no_show', case
                 when b.status <> 'confirmed' then 'ใช้ได้กับการจองที่ยืนยันแล้วเท่านั้น'
                 when b.pickup_date >= v_today then 'ยังไม่เลยวันรับชุด'
               end,
    'pickup', case when b.status not in ('pending', 'confirmed') then 'สถานะนี้รับชุดไม่ได้' end,
    'return', case when b.status <> 'picked_up' then 'ยังไม่ได้รับชุดออกไป' end,
    'pay', case
             when b.status not in ('pending', 'confirmed', 'picked_up', 'returned') then 'สถานะนี้รับชำระไม่ได้'
             when b.due <= 0.005 then 'ไม่มียอดค้างชำระ'
           end,
    'pickup_warnings', v_warn,
    'pickup_blockers', v_block);

  return v_mini || jsonb_build_object(
    'public_token', b.public_token,
    'public_url_path', '/book/status/' || b.public_token,
    'customer', jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'phone2', c.phone2, 'line_id', c.line_id,
                                   'email', c.email, 'id_card_no', c.id_card_no, 'address', c.address,
                                   'is_blacklisted', c.is_blacklisted, 'blacklist_reason', c.blacklist_reason),
    'days', public.rental_days(b.pickup_date, b.return_date),
    'event_date', b.event_date, 'delivery_method', b.delivery_method, 'delivery_address', b.delivery_address,
    'customer_note', b.customer_note, 'note', b.note, 'cancel_reason', b.cancel_reason, 'id_checked', b.id_checked,
    'online_name', b.online_name,
    'money', jsonb_build_object(
       'rent_total', b.rent_total, 'discount', b.discount, 'discount_note', b.discount_note,
       'delivery_fee', b.delivery_fee, 'charges_total', b.charges_total, 'grand_total', b.grand_total,
       'paid', b.paid, 'due', b.due, 'security_required', b.security_required,
       'security_override', b.security_override, 'security_held', b.security_held,
       'deposit_required', b.deposit_required, 'deposit_met', b.deposit_met, 'pending_review_total', v_pending,
       'deposit_percent', b.deposit_percent, 'min_deposit', b.min_deposit),
    'lines', coalesce((
       select jsonb_agg(jsonb_build_object(
                'id', l.id, 'item_id', l.item_id, 'item_code', i.code, 'item_name', i.name,
                'is_accessory', i.is_accessory,
                'cover_path', (select im.path from public.rental_item_images as im where im.item_id = i.id
                                order by im.sort_order, im.created_at, im.id limit 1),
                'unit_id', l.unit_id, 'unit_code', u.unit_code, 'size', l.size, 'rent_price', l.rent_price,
                'base_price', l.base_price, 'base_days', l.base_days, 'extra_day_price', l.extra_day_price,
                'deposit', l.deposit, 'replacement_cost', i.replacement_cost, 'status', l.status,
                'return_condition', l.return_condition, 'return_note', l.return_note,
                'unit_status', u.status, 'unit_needs_cleaning', u.needs_cleaning,
                'block_from', lower(l.block_range), 'block_to', upper(l.block_range) - 1, 'blocking', l.blocking)
              order by l.sort_order, l.id)
         from public.rental_booking_lines as l
         join public.rental_items as i on i.id = l.item_id
         join public.rental_units as u on u.id = l.unit_id
        where l.booking_id = b.id), '[]'::jsonb),
    'charges', coalesce((
       select jsonb_agg(jsonb_build_object(
                'id', ch.id, 'line_id', ch.line_id, 'kind', ch.kind, 'description', ch.description, 'amount', ch.amount,
                'voided_at', ch.voided_at, 'void_reason', ch.void_reason, 'created_by_name', ch.created_by_name,
                'created_at', ch.created_at)
              order by ch.created_at, ch.id)
         from public.rental_charges as ch
        where ch.booking_id = b.id), '[]'::jsonb),
    'payments', coalesce((
       select jsonb_agg(jsonb_build_object(
                'id', p.id, 'receipt_no', p.receipt_no, 'kind', p.kind, 'method', p.method, 'amount', p.amount,
                'status', p.status, 'slip_path', p.slip_path, 'note', p.note, 'reject_reason', p.reject_reason,
                'voided_at', p.voided_at, 'void_reason', p.void_reason, 'created_by_name', p.created_by_name,
                'created_at', p.created_at, 'reviewed_at', p.reviewed_at, 'confirmed_at', p.confirmed_at)
              order by p.created_at, p.id)
         from public.rental_payments as p
        where p.booking_id = b.id), '[]'::jsonb),
    'logs', coalesce((
       select jsonb_agg(jsonb_build_object('action', z.action, 'detail', z.detail, 'actor_name', z.actor_name,
                                           'created_at', z.created_at)
              order by z.id desc)
         from (select lg.id, lg.action, lg.detail, lg.actor_name, lg.created_at
                 from public.rental_logs as lg
                where lg.booking_id = b.id
                order by lg.id desc
                limit 200) as z), '[]'::jsonb),
    'late', v_late,
    'overdue', b.status = 'picked_up' and b.return_date < v_today,
    'actions', v_can || jsonb_build_object('block_reasons', v_reasons),
    'created_at', b.created_at, 'created_by_name', b.created_by_name, 'confirmed_at', b.confirmed_at,
    'picked_up_at', b.picked_up_at, 'returned_at', b.returned_at, 'returned_on', b.returned_on,
    'completed_at', b.completed_at, 'cancelled_at', b.cancelled_at, 'updated_at', b.updated_at);
end;
$$;

-- =========================================================================
-- 5) ลูกค้า / หัวการจอง / รายการชุด — ตัวช่วยเขียน (ใช้ร่วมกับ supabase-fix-06-rental-online.sql)
-- =========================================================================

-- เขียนลูกค้า: p_id = null → สร้างใหม่ / มี id → แก้ (คีย์ที่ไม่ส่งมา = คงค่าเดิม)
--   p_can_blacklist = false → แก้สถานะบัญชีดำไม่ได้ (42501)
create or replace function public.rental_customer_write(p_id uuid, p jsonb, p_default_source text,
                                                        p_can_blacklist boolean, p_client_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.rental_customers%rowtype;
  v_new boolean := p_id is null;
  v_bl boolean;
  v_src text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'ข้อมูลลูกค้าไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  if not v_new then
    select x.* into c from public.rental_customers as x where x.id = p_id for update;
    if not found then
      raise exception 'ไม่พบข้อมูลลูกค้านี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
    end if;
  else
    c.is_blacklisted := false;
    c.source := coalesce(p_default_source, 'walkin');
  end if;

  if v_new or p ? 'name' then
    c.name := public.rental_json_text(p -> 'name', 'ชื่อลูกค้า', 100);
    if c.name is null then
      raise exception 'กรุณากรอกชื่อลูกค้า';
    end if;
  end if;
  if v_new or p ? 'phone' then
    c.phone := public.rental_json_phone(p -> 'phone', 'เบอร์โทร');
    if c.phone is null then
      raise exception 'กรุณากรอกเบอร์โทรลูกค้า';
    end if;
  end if;
  if v_new or p ? 'phone2' then
    c.phone2 := public.rental_json_phone(p -> 'phone2', 'เบอร์โทรสำรอง');
  end if;
  if v_new or p ? 'line_id' then
    c.line_id := public.rental_json_text(p -> 'line_id', 'LINE ID', 50);
  end if;
  if v_new or p ? 'email' then
    c.email := public.rental_json_text(p -> 'email', 'อีเมล', 100);
    if c.email is not null and c.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'อีเมลไม่ถูกต้อง';
    end if;
  end if;
  if v_new or p ? 'id_card_no' then
    c.id_card_no := public.rental_json_text(p -> 'id_card_no', 'เลขบัตรประชาชน/พาสปอร์ต', 40);
    if c.id_card_no is not null then
      if c.id_card_no !~ '^[A-Za-z0-9 -]+$' then
        raise exception 'เลขบัตรประชาชน/พาสปอร์ตใส่ได้เฉพาะตัวอักษรอังกฤษและตัวเลข';
      end if;
      c.id_card_no := upper(regexp_replace(c.id_card_no, '[ -]', '', 'g'));
      if c.id_card_no = '' or char_length(c.id_card_no) > 30 then
        raise exception 'เลขบัตรประชาชน/พาสปอร์ตไม่ถูกต้อง';
      end if;
    end if;
  end if;
  if v_new or p ? 'address' then
    c.address := public.rental_json_text(p -> 'address', 'ที่อยู่', 500);
  end if;
  if v_new or p ? 'note' then
    c.note := public.rental_json_text(p -> 'note', 'หมายเหตุลูกค้า', 1000);
  end if;
  if v_new and p ? 'source' then
    v_src := public.rental_json_text(p -> 'source', 'ช่องทางลูกค้า', 20);
    if v_src is not null then
      if v_src not in ('walkin', 'online', 'phone', 'line', 'other') then
        raise exception 'ช่องทางลูกค้าไม่ถูกต้อง';
      end if;
      c.source := v_src;
    end if;
  end if;

  if p ? 'is_blacklisted' then
    v_bl := coalesce(public.product_json_bool(p -> 'is_blacklisted', 'สถานะบัญชีดำ'), false);
    if v_bl is distinct from coalesce(c.is_blacklisted, false) and not p_can_blacklist then
      raise exception 'เฉพาะผู้จัดการร้านเช่าชุดเท่านั้นที่ตั้ง/ยกเลิกบัญชีดำได้' using errcode = '42501';
    end if;
    c.is_blacklisted := v_bl;
  end if;
  if p ? 'blacklist_reason' then
    if not p_can_blacklist
       and public.rental_json_text(p -> 'blacklist_reason', 'เหตุผลบัญชีดำ', 200) is distinct from c.blacklist_reason then
      raise exception 'เฉพาะผู้จัดการร้านเช่าชุดเท่านั้นที่ตั้ง/ยกเลิกบัญชีดำได้' using errcode = '42501';
    end if;
    c.blacklist_reason := public.rental_json_text(p -> 'blacklist_reason', 'เหตุผลบัญชีดำ', 200);
  end if;
  if not coalesce(c.is_blacklisted, false) then
    c.blacklist_reason := null;
  end if;

  if v_new then
    insert into public.rental_customers as x
      (client_id, name, phone, phone2, line_id, email, id_card_no, address, note, is_blacklisted, blacklist_reason, source)
    values
      (p_client_id, c.name, c.phone, c.phone2, c.line_id, c.email, c.id_card_no, c.address, c.note,
       coalesce(c.is_blacklisted, false), c.blacklist_reason, c.source)
    returning x.id into c.id;
  else
    update public.rental_customers as x
       set name = c.name, phone = c.phone, phone2 = c.phone2, line_id = c.line_id, email = c.email,
           id_card_no = c.id_card_no, address = c.address, note = c.note, is_blacklisted = c.is_blacklisted,
           blacklist_reason = c.blacklist_reason
     where x.id = c.id;
  end if;
  return c.id;
end;
$$;

-- ลูกค้าในบัญชีดำที่ใช้เบอร์เดียวกับลูกค้าคนนี้ (เบอร์หลัก/สำรอง สลับกันได้ · เทียบตัวเลขตรงตัว เหมือนหน้าฟอร์มที่ค้นเบอร์ซ้ำ)
--   กันกรณีกรอก "ลูกค้าใหม่" ด้วยเบอร์ของคนในบัญชีดำ → ได้ลูกค้าคนใหม่ที่ไม่ติดบัญชีดำ แล้วจองผ่านโดยไม่มีใครยืนยัน
--   ไม่พบ = คืนแถวว่าง (id เป็น null)
create or replace function public.rental_blacklist_phone_match(p_customer_id uuid)
returns public.rental_customers
language sql
stable
security definer
set search_path = public
as $$
  select x.*
    from public.rental_customers as x
    join public.rental_customers as me on me.id = p_customer_id
   where x.is_blacklisted
     and x.id <> me.id
     and (x.phone in (me.phone, me.phone2) or x.phone2 in (me.phone, me.phone2))
   order by x.updated_at desc, x.id
   limit 1;
$$;

-- หัวการจองจาก payload (คีย์ที่ไม่ส่งมา = คงค่าเดิมของ p_old; p_old = null → การจองใหม่)
--   คืนแถว rental_bookings ที่ยังไม่บันทึก (เฉพาะช่องที่ผู้ใช้กรอก)
create or replace function public.rental_read_head(p jsonb, p_old public.rental_bookings)
returns public.rental_bookings
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.rental_bookings := p_old;
  v_new boolean := p_old.id is null;
  v_today date := public.pos_bkk_today();
  v_days integer;
  v_text text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'ข้อมูลการจองไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  if v_new then
    b.delivery_method := 'pickup';
    b.delivery_fee := 0;
    b.discount := 0;
  end if;

  if v_new or p ? 'pickup_date' then
    b.pickup_date := public.rental_json_date(p -> 'pickup_date', 'วันรับชุด');
  end if;
  if v_new or p ? 'return_date' then
    b.return_date := public.rental_json_date(p -> 'return_date', 'วันคืนชุด');
  end if;
  if b.pickup_date is null then
    raise exception 'กรุณาเลือกวันรับชุด';
  end if;
  if b.return_date is null then
    raise exception 'กรุณาเลือกวันคืนชุด';
  end if;
  if b.return_date < b.pickup_date then
    raise exception 'วันคืนชุดต้องไม่ก่อนวันรับชุด';
  end if;
  v_days := public.rental_days(b.pickup_date, b.return_date);
  if v_days > 60 then
    raise exception 'เช่าได้ไม่เกิน 60 วันต่อการจอง (เลือกไว้ % วัน)', v_days;
  end if;
  if (v_new or b.pickup_date is distinct from p_old.pickup_date) then
    if b.pickup_date < v_today - 30 then
      raise exception 'วันรับชุดย้อนหลังได้ไม่เกิน 30 วัน';
    end if;
    if b.pickup_date > v_today + 730 then
      raise exception 'จองล่วงหน้าได้ไม่เกิน 2 ปี';
    end if;
  end if;

  if v_new or p ? 'event_date' then
    b.event_date := public.rental_json_date(p -> 'event_date', 'วันงาน');
  end if;
  if v_new or p ? 'fitting_date' then
    b.fitting_date := public.rental_json_date(p -> 'fitting_date', 'วันลองชุด');
  end if;
  if v_new or p ? 'fitting_time' then
    b.fitting_time := public.rental_json_text(p -> 'fitting_time', 'เวลาลองชุด', 20);
  end if;
  if v_new or p ? 'pickup_time' then
    b.pickup_time := public.rental_json_text(p -> 'pickup_time', 'เวลารับชุด', 20);
  end if;
  if p ? 'delivery_method' then
    v_text := coalesce(public.rental_json_text(p -> 'delivery_method', 'วิธีรับชุด', 20), 'pickup');
    if v_text not in ('pickup', 'delivery') then
      raise exception 'วิธีรับชุดไม่ถูกต้อง';
    end if;
    b.delivery_method := v_text;
  end if;
  if v_new or p ? 'delivery_address' then
    b.delivery_address := public.rental_json_text(p -> 'delivery_address', 'ที่อยู่จัดส่ง', 500);
  end if;
  if p ? 'delivery_fee' then
    b.delivery_fee := coalesce(public.rental_json_money(p -> 'delivery_fee', 'ค่าจัดส่ง', true), 0);
  end if;
  if p ? 'discount' then
    b.discount := coalesce(public.rental_json_money(p -> 'discount', 'ส่วนลด', true), 0);
  end if;
  if v_new or p ? 'discount_note' then
    b.discount_note := public.rental_json_text(p -> 'discount_note', 'หมายเหตุส่วนลด', 200);
  end if;
  if v_new or p ? 'security_override' then
    b.security_override := public.rental_json_money(p -> 'security_override', 'เงินประกันที่กำหนดเอง', true);
  end if;
  if v_new or p ? 'note' then
    b.note := public.rental_json_text(p -> 'note', 'หมายเหตุ', 1000);
  end if;
  if v_new or p ? 'customer_note' then
    b.customer_note := public.rental_json_text(p -> 'customer_note', 'ข้อความจากลูกค้า', 1000);
  end if;
  return b;
end;
$$;

-- เลือกชิ้นจริงให้ทุกบรรทัด + ราคา + ช่วงวันที่กันไว้ (ยังไม่เขียนอะไร)
--   p_lines = [{line_id?, item_id, size?, unit_id?}] / p_booking_id = การจองที่กำลังแก้ (ไม่นับชิ้นของตัวเองว่าชน)
--   p_strict = true → ชิ้นไม่ว่างแล้วหยุดทันที / false → ใส่ available=false + conflict (ใช้คำนวณราคาล่วงหน้า)
--   ไม่ส่ง size (หรือ null) = ไซส์ไหนก็ได้ / ส่ง size = ต้องตรงไซส์ (ไม่สนตัวพิมพ์)
create or replace function public.rental_resolve_lines(p_lines jsonb, p_pickup date, p_return date,
                                                       p_booking_id uuid, p_strict boolean, p_max integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := public.rental_days(p_pickup, p_return);
  v_out jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_idx integer := 0;
  v_line_id uuid;
  v_item_id uuid;
  v_unit_id uuid;
  v_size text;
  v_old public.rental_booking_lines%rowtype;
  v_keep boolean;
  it public.rental_items%rowtype;
  u public.rental_units%rowtype;
  v_range daterange;
  v_chosen uuid[] := '{}';
  v_line_ids uuid[] := '{}';
  v_conflict text;
  v_unit uuid;
  v_unit_code text;
  v_unit_size text;
  v_base numeric;
  v_bdays integer;
  v_extra numeric;
  v_dep numeric;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'กรุณาเลือกชุดอย่างน้อย 1 รายการ';
  end if;
  if jsonb_array_length(p_lines) > p_max then
    raise exception 'เลือกชุดได้ไม่เกิน % รายการต่อการจอง', p_max;
  end if;

  for v_elem in select e.elem from jsonb_array_elements(p_lines) as e(elem)
  loop
    v_idx := v_idx + 1;
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'ข้อมูลรายการชุดไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
    end if;
    v_line_id := public.product_json_uuid(v_elem -> 'line_id', 'รายการชุด');
    v_item_id := public.product_json_uuid(v_elem -> 'item_id', 'ชุด');
    v_unit_id := public.product_json_uuid(v_elem -> 'unit_id', 'ชิ้นชุด');
    v_size := public.rental_json_text(v_elem -> 'size', 'ไซส์', 20);
    v_old := null;
    v_keep := false;

    if v_line_id is not null then
      if p_booking_id is null then
        raise exception 'ข้อมูลรายการชุดไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
      end if;
      if v_line_id = any(v_line_ids) then
        raise exception 'มีรายการชุดซ้ำกัน กรุณาโหลดหน้าใหม่';
      end if;
      select l.* into v_old
        from public.rental_booking_lines as l
       where l.id = v_line_id and l.booking_id = p_booking_id;
      if not found then
        raise exception 'ไม่พบรายการชุดนี้ในการจอง (อาจถูกแก้จากเครื่องอื่น) กรุณาโหลดหน้าใหม่';
      end if;
      v_line_ids := v_line_ids || v_line_id;
      v_item_id := coalesce(v_item_id, v_old.item_id);
    end if;
    if v_item_id is null and v_unit_id is not null then
      select x.item_id into v_item_id from public.rental_units as x where x.id = v_unit_id;
    end if;
    if v_item_id is null then
      raise exception 'กรุณาเลือกชุดให้ครบทุกรายการ';
    end if;

    select i.* into it from public.rental_items as i where i.id = v_item_id;
    if not found then
      raise exception 'ไม่พบชุดที่เลือก (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
    end if;
    v_keep := v_old.id is not null and v_old.item_id = it.id;
    if not it.is_active and not v_keep then
      raise exception 'ชุด % % ปิดให้เช่าอยู่', it.code, it.name;
    end if;

    -- ราคา ณ ตอนจอง: บรรทัดเดิมชุดเดิม = ใช้ราคาเดิม (แก้ราคาชุดทีหลังไม่กระทบการจองที่มีอยู่)
    if v_keep then
      v_base := v_old.base_price; v_bdays := v_old.base_days; v_extra := v_old.extra_day_price; v_dep := v_old.deposit;
    else
      v_base := it.base_price; v_bdays := it.base_days; v_extra := it.extra_day_price; v_dep := it.security_deposit;
    end if;

    v_range := public.rental_block_range(it.id, p_pickup, p_return);
    v_unit := null;
    v_unit_code := null;
    v_unit_size := null;
    v_conflict := null;

    if v_unit_id is not null then
      select x.* into u from public.rental_units as x where x.id = v_unit_id;
      if not found or u.item_id <> it.id then
        raise exception 'ชิ้นที่เลือกไม่ใช่ของชุด % กรุณาโหลดหน้าใหม่', it.code;
      end if;
      if u.id = any(v_chosen) then
        raise exception 'เลือกชิ้น % ซ้ำในการจองเดียวกัน', u.unit_code;
      end if;
      if u.status <> 'available' and not (v_keep and v_old.unit_id = u.id) then
        v_conflict := format('ชิ้น %s %s เลือกจองไม่ได้', u.unit_code,
                             case u.status when 'maintenance' then 'ส่งซ่อม/ไม่พร้อมให้เช่า' else 'เลิกใช้แล้ว' end);
      elsif not public.rental_unit_free(u.id, v_range, p_booking_id) then
        v_conflict := public.rental_conflict_text(u.id, v_range, p_booking_id);
      else
        v_unit := u.id; v_unit_code := u.unit_code; v_unit_size := u.size;
      end if;
    else
      -- บรรทัดเดิม: ใช้ชิ้นเดิมต่อถ้ายังว่างและไซส์ตรง
      if v_keep then
        select x.* into u from public.rental_units as x where x.id = v_old.unit_id;
        if found and not (u.id = any(v_chosen))
           and (v_size is null or lower(coalesce(u.size, '')) = lower(v_size))
           and public.rental_unit_free(u.id, v_range, p_booking_id) then
          v_unit := u.id; v_unit_code := u.unit_code; v_unit_size := u.size;
        end if;
      end if;
      if v_unit is null then
        select x.id, x.unit_code, x.size into v_unit, v_unit_code, v_unit_size
          from public.rental_units as x
         where x.item_id = it.id
           and x.status = 'available'
           and (v_size is null or lower(coalesce(x.size, '')) = lower(v_size))
           and not (x.id = any(v_chosen))
           and public.rental_unit_free(x.id, v_range, p_booking_id)
         order by x.unit_code, x.id
         limit 1;
        if v_unit is null then
          if not exists (select 1 from public.rental_units as x
                          where x.item_id = it.id and x.status = 'available'
                            and (v_size is null or lower(coalesce(x.size, '')) = lower(v_size))) then
            v_conflict := format('ชุด %s %s%s ไม่มีชิ้นที่พร้อมให้เช่า', it.code, it.name,
                                 case when v_size is null then '' else ' ไซส์ ' || v_size end);
          else
            v_conflict := format('ชุด %s %s%s ไม่ว่างในช่วงวันที่เลือก (%s – %s รวมวันเตรียม/ซักชุด)', it.code, it.name,
                                 case when v_size is null then '' else ' ไซส์ ' || v_size end,
                                 public.rental_thai_date(p_pickup), public.rental_thai_date(p_return));
          end if;
        end if;
      end if;
    end if;

    if v_conflict is not null and p_strict then
      raise exception '%', v_conflict;
    end if;
    if v_unit is not null then
      v_chosen := v_chosen || v_unit;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'line_id', v_line_id, 'item_id', it.id, 'item_code', it.code, 'item_name', it.name,
      'unit_id', v_unit, 'unit_code', v_unit_code, 'size', case when v_unit is null then v_size else v_unit_size end,
      'base_price', v_base, 'base_days', v_bdays, 'extra_day_price', v_extra, 'deposit', v_dep,
      'rent_price', public.rental_line_price(v_base, v_bdays, v_extra, v_days),
      'block_range', v_range::text, 'available', v_conflict is null, 'conflict', v_conflict, 'sort_order', v_idx));
  end loop;
  return v_out;
end;
$$;

-- เขียนบรรทัดชุดของการจอง (pending/confirmed) ตามผลของ rental_resolve_lines
--   ปลดการกันของบรรทัดเดิมทั้งหมดก่อน แล้วกันใหม่ทีละบรรทัด (สลับชิ้นกันเองในการจองเดียวกันได้)
--   ชนกับการจองอื่น (รวมถึงอีกเครื่องที่บันทึกก่อนเสี้ยววินาที) → ข้อความไทยบอกเลขการจองที่ชน
create or replace function public.rental_write_lines(p_booking_id uuid, p_lines jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_elem jsonb;
  v_ids uuid[];
  v_range daterange;
  v_unit uuid;
  v_line uuid;
begin
  select coalesce(array_agg((e.elem ->> 'line_id')::uuid) filter (where e.elem ->> 'line_id' is not null), '{}')
    into v_ids
    from jsonb_array_elements(p_lines) as e(elem);

  update public.rental_booking_lines as l
     set blocking = false
   where l.booking_id = p_booking_id and l.status = 'booked';

  delete from public.rental_booking_lines as l
   where l.booking_id = p_booking_id and l.status = 'booked' and not (l.id = any(v_ids));

  -- เรียงตามรหัสชิ้น (ไม่ใช่ลำดับในฟอร์ม): สองเครื่องจองชุดเดียวกันหลายชิ้นสลับลำดับกัน จะไม่ติดรอกันเอง (deadlock)
  for v_elem in select e.elem from jsonb_array_elements(p_lines) as e(elem)
                 order by e.elem ->> 'unit_id', (e.elem ->> 'sort_order')::integer
  loop
    v_range := (v_elem ->> 'block_range')::daterange;
    v_unit := (v_elem ->> 'unit_id')::uuid;
    v_line := (v_elem ->> 'line_id')::uuid;
    if v_unit is null then
      raise exception '%', coalesce(v_elem ->> 'conflict', 'ชุดที่เลือกไม่ว่าง');
    end if;
    begin
      if v_line is not null then
        update public.rental_booking_lines as l
           set item_id = (v_elem ->> 'item_id')::uuid,
               unit_id = v_unit,
               size = v_elem ->> 'size',
               rent_price = (v_elem ->> 'rent_price')::numeric,
               base_price = (v_elem ->> 'base_price')::numeric,
               base_days = (v_elem ->> 'base_days')::integer,
               extra_day_price = (v_elem ->> 'extra_day_price')::numeric,
               deposit = (v_elem ->> 'deposit')::numeric,
               block_range = v_range,
               blocking = true,
               sort_order = (v_elem ->> 'sort_order')::integer
         where l.id = v_line and l.booking_id = p_booking_id;
      else
        insert into public.rental_booking_lines
          (booking_id, item_id, unit_id, size, rent_price, base_price, base_days, extra_day_price, deposit,
           block_range, blocking, sort_order)
        values
          (p_booking_id, (v_elem ->> 'item_id')::uuid, v_unit, v_elem ->> 'size', (v_elem ->> 'rent_price')::numeric,
           (v_elem ->> 'base_price')::numeric, (v_elem ->> 'base_days')::integer,
           (v_elem ->> 'extra_day_price')::numeric, (v_elem ->> 'deposit')::numeric,
           v_range, true, (v_elem ->> 'sort_order')::integer);
      end if;
    exception
      when exclusion_violation then
        raise exception '%', public.rental_conflict_text(v_unit, v_range, p_booking_id);
      when deadlock_detected or serialization_failure then
        raise exception 'มีการจองชุดเดียวกันพร้อมกันจากอีกเครื่อง กรุณาลองใหม่อีกครั้ง';
    end;
  end loop;
end;
$$;

-- สร้างการจอง (ภายใน — ใช้ทั้งพนักงานและจองออนไลน์) → id การจอง
--   ลูกค้าต้องหามาก่อน (p_customer_id) / ไม่ตรวจสิทธิ์ ไม่ตรวจบัญชีดำ (ผู้เรียกตรวจ)
--   p_status = 'confirmed' | 'pending' (pending ต้องมี p_hold_hours 1..168)
create or replace function public.rental_create_core(p_client_id uuid, p_payload jsonb, p_customer_id uuid,
                                                     p_source text, p_status text, p_hold_hours integer,
                                                     p_actor_name text default null, p_max_lines integer default 30)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := case when p_actor_name is null then auth.uid() end;
  b public.rental_bookings;
  s public.rental_settings;
  v_lines jsonb;
  v_id uuid;
  v_rent numeric;
begin
  if p_source not in ('walkin', 'online', 'phone', 'line', 'other') then
    raise exception 'ช่องทางการจองไม่ถูกต้อง';
  end if;
  if p_status not in ('confirmed', 'pending') then
    raise exception 'สถานะการจองเริ่มต้นต้องเป็น "จองแล้ว" หรือ "รอยืนยัน"';
  end if;
  if p_status = 'pending' and (p_hold_hours is null or p_hold_hours < 1 or p_hold_hours > 168) then
    raise exception 'เวลาถือการจองต้องอยู่ระหว่าง 1 ถึง 168 ชั่วโมง';
  end if;
  if not exists (select 1 from public.rental_customers as c where c.id = p_customer_id) then
    raise exception 'ไม่พบข้อมูลลูกค้า กรุณาเลือกลูกค้าใหม่';
  end if;

  b := public.rental_read_head(p_payload, null::public.rental_bookings);
  v_lines := public.rental_resolve_lines(p_payload -> 'lines', b.pickup_date, b.return_date, null, true, p_max_lines);
  select coalesce(sum((e.elem ->> 'rent_price')::numeric), 0) into v_rent from jsonb_array_elements(v_lines) as e(elem);
  if b.discount > v_rent then
    raise exception 'ส่วนลด (%) มากกว่าค่าเช่ารวม (%)', public.rental_baht(b.discount), public.rental_baht(v_rent);
  end if;

  s := public.rental_settings_row();
  begin
    insert into public.rental_bookings as x
      (booking_no, client_id, public_token, source, customer_id, status, pickup_date, return_date, event_date,
       fitting_date, fitting_time, pickup_time, delivery_method, delivery_address, delivery_fee, discount, discount_note,
       security_override, customer_note, note, expires_at, confirmed_at, created_by, created_by_name,
       deposit_percent, min_deposit)
    values
      (public.rental_next_no('rental'), p_client_id,
       replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
       p_source, p_customer_id, p_status, b.pickup_date, b.return_date, b.event_date,
       b.fitting_date, b.fitting_time, b.pickup_time, b.delivery_method, b.delivery_address, b.delivery_fee, b.discount,
       b.discount_note, b.security_override, b.customer_note, b.note,
       case when p_status = 'pending' then now() + make_interval(hours => p_hold_hours) end,
       case when p_status = 'confirmed' then now() end,
       v_uid, coalesce(p_actor_name, public.pos_actor_name(v_uid)),
       s.booking_deposit_percent, s.min_booking_deposit)
    returning x.id into v_id;
  exception when unique_violation then
    raise exception 'การจองนี้กำลังบันทึกจากอีกเครื่อง กรุณาโหลดหน้าใหม่';
  end;

  perform public.rental_write_lines(v_id, v_lines);
  perform public.rental_recalc(v_id);
  perform public.rental_log(v_id, 'create',
    jsonb_build_object('status', p_status, 'source', p_source, 'pickup_date', b.pickup_date, 'return_date', b.return_date,
                       'lines', jsonb_array_length(v_lines)),
    p_actor_name);
  return v_id;
end;
$$;

-- รับเงิน/คืนเงิน/เงินประกัน (ภายใน) → id รายการ — ตรวจกฎเงินทุกข้อ (การจองต้องถูกล็อกไว้แล้ว)
--   p_status = 'pending_review' (สลิปจากลูกค้า) ไม่ตรวจยอดค้าง ไม่ออกเลขใบเสร็จ (ออกตอนอนุมัติ)
create or replace function public.rental_add_payment_core(p_booking_id uuid, p_client_id uuid, p_kind text, p_method text,
                                                          p_amount numeric, p_note text, p_status text default 'confirmed',
                                                          p_slip_path text default null, p_actor_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := case when p_actor_name is null then auth.uid() end;
  b public.rental_bookings%rowtype;
  v_note text;
  v_method text := p_method;
  v_id uuid;
  v_receipt text;
begin
  if p_kind is null or p_kind not in ('payment', 'refund', 'security_in', 'security_out', 'security_apply') then
    raise exception 'ประเภทรายการเงินไม่ถูกต้อง';
  end if;
  if p_kind = 'security_apply' then
    v_method := 'none';
  elsif v_method is null or v_method not in ('cash', 'transfer', 'promptpay', 'credit') then
    raise exception 'กรุณาเลือกวิธีชำระเงิน (เงินสด / โอนเงิน / พร้อมเพย์ / บัตรเครดิต)';
  end if;
  perform public.rental_check_money(p_amount, 'จำนวนเงิน', false);
  v_note := nullif(public.product_clean_text(p_note), '');
  if char_length(v_note) > 300 then
    raise exception 'หมายเหตุยาวเกินไป (สูงสุด 300 ตัวอักษร)';
  end if;
  if p_status not in ('confirmed', 'pending_review') then
    raise exception 'สถานะรายการเงินไม่ถูกต้อง';
  end if;

  select x.* into b from public.rental_bookings as x where x.id = p_booking_id;
  if not found then
    raise exception 'ไม่พบการจองนี้';
  end if;

  if p_status = 'confirmed' then
    if p_kind = 'payment' then
      if b.status not in ('pending', 'confirmed', 'picked_up', 'returned') then
        raise exception 'การจองสถานะ "%" รับชำระไม่ได้', public.rental_status_label(b.status);
      end if;
      if b.due <= 0.005 then
        raise exception 'การจองนี้ไม่มียอดค้างชำระ';
      end if;
      if p_amount > b.due + 0.005 then
        raise exception 'ยอดชำระ % เกินยอดค้าง %', public.rental_baht(p_amount), public.rental_baht(b.due);
      end if;
    elsif p_kind = 'refund' then
      -- ปิดงานแล้ว = เงินลงตัวแล้ว (ยอดค้าง 0) — คืนเงินทีหลังจะทำให้การจองที่ "เสร็จสิ้น" มียอดค้างขึ้นมาใหม่
      if b.status = 'completed' then
        raise exception 'การจองนี้ปิดงานแล้ว (ยอดเงินลงตัวแล้ว) คืนเงินเพิ่มไม่ได้';
      end if;
      if b.paid <= 0.005 then
        raise exception 'การจองนี้ยังไม่มีเงินที่ชำระไว้ให้คืน';
      end if;
      if p_amount > b.paid + 0.005 then
        raise exception 'คืนเงินได้ไม่เกินยอดที่ชำระแล้ว %', public.rental_baht(b.paid);
      end if;
    elsif p_kind = 'security_in' then
      if b.status not in ('confirmed', 'picked_up') then
        raise exception 'รับเงินประกันได้เมื่อการจองยืนยันแล้วหรือกำลังเช่าเท่านั้น';
      end if;
      if p_amount > b.security_required - b.security_held + 0.005 then
        raise exception 'รับเงินประกันได้อีกไม่เกิน %', public.rental_baht(greatest(b.security_required - b.security_held, 0));
      end if;
    elsif p_kind = 'security_out' then
      if b.status not in ('picked_up', 'returned', 'cancelled', 'no_show') then
        raise exception 'คืนเงินประกันได้หลังรับชุด หรือเมื่อการจองถูกยกเลิกเท่านั้น';
      end if;
      if p_amount > b.security_held + 0.005 then
        raise exception 'คืนเงินประกันได้ไม่เกินยอดที่ถืออยู่ %', public.rental_baht(b.security_held);
      end if;
    else
      if b.status not in ('picked_up', 'returned') then
        raise exception 'หักเงินประกันได้หลังรับชุดแล้วเท่านั้น';
      end if;
      if b.due <= 0.005 then
        raise exception 'การจองนี้ไม่มียอดค้างให้หักจากเงินประกัน';
      end if;
      if p_amount > least(b.security_held, b.due) + 0.005 then
        raise exception 'หักเงินประกันได้ไม่เกิน % (เงินประกันที่ถือ % / ยอดค้าง %)',
          public.rental_baht(least(b.security_held, b.due)), public.rental_baht(b.security_held), public.rental_baht(b.due);
      end if;
    end if;
    v_receipt := public.rental_next_no('rental_receipt');
  elsif p_kind <> 'payment' then
    raise exception 'สลิปรอตรวจต้องเป็นการชำระเงินเท่านั้น';
  end if;

  begin
    insert into public.rental_payments as p
      (client_id, booking_id, receipt_no, kind, method, amount, status, slip_path, note, created_by, created_by_name,
       confirmed_at)
    values
      (p_client_id, b.id, v_receipt, p_kind, v_method, p_amount, p_status, p_slip_path, v_note,
       v_uid, coalesce(p_actor_name, public.pos_actor_name(v_uid)),
       case when p_status = 'confirmed' then now() end)
    returning p.id into v_id;
  exception when unique_violation then
    raise exception 'รายการนี้กำลังบันทึกจากอีกเครื่อง กรุณาโหลดหน้าใหม่';
  end;

  perform public.rental_recalc(b.id);
  perform public.rental_log(b.id, case when p_status = 'pending_review' then 'slip_add' else 'payment' end,
    jsonb_build_object('kind', p_kind, 'method', v_method, 'amount', p_amount, 'receipt_no', v_receipt),
    p_actor_name);
  return v_id;
end;
$$;

-- =========================================================================
-- 6) ตั้งค่าร้านเช่า
-- =========================================================================
create or replace function public.rental_get_settings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.rental_require(false);
  perform public.rental_settings_row();
  return public.rental_settings_json();
end;
$$;

-- p_settings = เฉพาะคีย์ที่ส่งมาเท่านั้นที่ถูกแก้ (หน้าตั้งค่าบันทึกทีละหมวดได้) / ช่องข้อความว่าง = ไม่มีค่า
create or replace function public.rental_save_settings(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  s public.rental_settings;
  v_text text;
  v_elem jsonb;
  v_accounts jsonb := '[]'::jsonb;
  v_bank text;
  v_no text;
  v_name text;
  v_num numeric;
begin
  v_uid := public.rental_require(true);
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'ข้อมูลตั้งค่าไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  perform public.rental_settings_row();
  select x.* into s from public.rental_settings as x where x.id for update;

  if p_settings ? 'shop_name' then
    s.shop_name := public.rental_json_text(p_settings -> 'shop_name', 'ชื่อร้าน', 100);
    if s.shop_name is null then
      raise exception 'กรุณาใส่ชื่อร้าน';
    end if;
  end if;
  if p_settings ? 'tagline' then s.tagline := public.rental_json_text(p_settings -> 'tagline', 'คำโปรย', 200); end if;
  if p_settings ? 'address' then s.address := public.rental_json_text(p_settings -> 'address', 'ที่อยู่ร้าน', 500); end if;
  if p_settings ? 'phone' then s.phone := public.rental_json_text(p_settings -> 'phone', 'เบอร์โทรร้าน', 50); end if;
  if p_settings ? 'line_id' then s.line_id := public.rental_json_text(p_settings -> 'line_id', 'LINE ID', 50); end if;
  if p_settings ? 'line_url' then
    s.line_url := public.rental_json_text(p_settings -> 'line_url', 'ลิงก์ LINE', 300);
    if s.line_url is not null and s.line_url !~* '^https?://[^[:space:]]+$' then
      raise exception 'ลิงก์ LINE ต้องขึ้นต้นด้วย https://';
    end if;
  end if;
  if p_settings ? 'facebook_url' then
    s.facebook_url := public.rental_json_text(p_settings -> 'facebook_url', 'ลิงก์ Facebook', 300);
    if s.facebook_url is not null and s.facebook_url !~* '^https?://[^[:space:]]+$' then
      raise exception 'ลิงก์ Facebook ต้องขึ้นต้นด้วย https://';
    end if;
  end if;
  if p_settings ? 'opening_hours' then
    s.opening_hours := public.rental_json_text(p_settings -> 'opening_hours', 'เวลาเปิดร้าน', 200);
  end if;
  if p_settings ? 'promptpay_id' then
    v_text := public.rental_json_text(p_settings -> 'promptpay_id', 'พร้อมเพย์', 30);
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
    s.promptpay_name := public.rental_json_text(p_settings -> 'promptpay_name', 'ชื่อบัญชีพร้อมเพย์', 100);
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
        v_bank := public.rental_json_text(v_elem -> 'bank', 'ชื่อธนาคาร', 100);
        v_no := public.rental_json_text(v_elem -> 'account_no', 'เลขบัญชี', 100);
        v_name := public.rental_json_text(v_elem -> 'account_name', 'ชื่อบัญชี', 100);
        if v_bank is null or v_no is null or v_name is null then
          raise exception 'กรุณากรอกธนาคาร เลขบัญชี และชื่อบัญชีให้ครบทุกบัญชี';
        end if;
        v_accounts := v_accounts || jsonb_build_array(jsonb_build_object('bank', v_bank, 'account_no', v_no, 'account_name', v_name));
      end loop;
    end if;
    s.bank_accounts := v_accounts;
  end if;
  if p_settings ? 'booking_deposit_percent' then
    v_num := public.product_json_num(p_settings -> 'booking_deposit_percent', 'เปอร์เซ็นต์มัดจำ');
    if v_num is null or v_num < 0 or v_num > 100 or v_num <> round(v_num, 2) then
      raise exception 'เปอร์เซ็นต์มัดจำต้องอยู่ระหว่าง 0 ถึง 100';
    end if;
    s.booking_deposit_percent := v_num;
  end if;
  if p_settings ? 'min_booking_deposit' then
    s.min_booking_deposit := coalesce(public.rental_json_money(p_settings -> 'min_booking_deposit', 'มัดจำขั้นต่ำ', true), 0);
  end if;
  if p_settings ? 'default_base_days' then
    s.default_base_days := coalesce(public.rental_json_int(p_settings -> 'default_base_days', 'จำนวนวันเช่าพื้นฐาน', 1, 60), 3);
  end if;
  if p_settings ? 'buffer_before_days' then
    s.buffer_before_days := coalesce(public.rental_json_int(p_settings -> 'buffer_before_days', 'วันเตรียมชุดก่อนรับ', 0, 14), 0);
  end if;
  if p_settings ? 'buffer_after_days' then
    s.buffer_after_days := coalesce(public.rental_json_int(p_settings -> 'buffer_after_days', 'วันซัก/ตรวจชุดหลังคืน', 0, 14), 1);
  end if;
  if p_settings ? 'late_fee_mode' then
    v_text := coalesce(public.rental_json_text(p_settings -> 'late_fee_mode', 'วิธีคิดค่าปรับคืนช้า', 30), 'per_day_item');
    if v_text not in ('per_day_item', 'fixed_per_day', 'none') then
      raise exception 'วิธีคิดค่าปรับคืนช้าไม่ถูกต้อง';
    end if;
    s.late_fee_mode := v_text;
  end if;
  if p_settings ? 'late_fee_fixed' then
    s.late_fee_fixed := coalesce(public.rental_json_money(p_settings -> 'late_fee_fixed', 'ค่าปรับคืนช้าต่อวัน', true), 0);
  end if;
  if p_settings ? 'online_enabled' then
    s.online_enabled := coalesce(public.product_json_bool(p_settings -> 'online_enabled', 'การเปิดจองออนไลน์'), false);
  end if;
  if p_settings ? 'online_hold_hours' then
    s.online_hold_hours := coalesce(public.rental_json_int(p_settings -> 'online_hold_hours', 'เวลาถือการจองออนไลน์ (ชั่วโมง)', 1, 168), 24);
  end if;
  if p_settings ? 'online_min_lead_days' then
    s.online_min_lead_days := coalesce(public.rental_json_int(p_settings -> 'online_min_lead_days', 'จองล่วงหน้าอย่างน้อย (วัน)', 0, 365), 1);
  end if;
  if p_settings ? 'online_max_days' then
    s.online_max_days := coalesce(public.rental_json_int(p_settings -> 'online_max_days', 'จำนวนวันเช่าสูงสุดทางออนไลน์', 1, 60), 14);
  end if;
  if p_settings ? 'online_notice' then
    s.online_notice := public.rental_json_text(p_settings -> 'online_notice', 'ข้อความบนหน้าจองออนไลน์', 1000);
  end if;
  if p_settings ? 'terms_text' then
    -- ข้อตกลงสัญญา: เก็บการขึ้นบรรทัดไว้ (ตัดแค่ช่องว่างหัวท้าย)
    if jsonb_typeof(p_settings -> 'terms_text') <> 'string' then
      raise exception 'ข้อตกลงในสัญญาไม่ถูกต้อง';
    end if;
    v_text := nullif(public.product_clean_text(p_settings ->> 'terms_text'), '');
    if v_text is null then
      raise exception 'กรุณาใส่ข้อตกลงในสัญญาเช่า';
    end if;
    if char_length(v_text) > 20000 then
      raise exception 'ข้อตกลงในสัญญายาวเกินไป (สูงสุด 20,000 ตัวอักษร)';
    end if;
    s.terms_text := v_text;
  end if;
  if p_settings ? 'receipt_footer' then
    s.receipt_footer := public.rental_json_text(p_settings -> 'receipt_footer', 'ข้อความท้ายใบเสร็จ', 300);
  end if;

  update public.rental_settings as x
     set shop_name = s.shop_name, tagline = s.tagline, address = s.address, phone = s.phone, line_id = s.line_id,
         line_url = s.line_url, facebook_url = s.facebook_url, opening_hours = s.opening_hours,
         promptpay_id = s.promptpay_id, promptpay_name = s.promptpay_name, bank_accounts = s.bank_accounts,
         booking_deposit_percent = s.booking_deposit_percent, min_booking_deposit = s.min_booking_deposit,
         default_base_days = s.default_base_days, buffer_before_days = s.buffer_before_days,
         buffer_after_days = s.buffer_after_days, late_fee_mode = s.late_fee_mode, late_fee_fixed = s.late_fee_fixed,
         online_enabled = s.online_enabled, online_hold_hours = s.online_hold_hours,
         online_min_lead_days = s.online_min_lead_days, online_max_days = s.online_max_days,
         online_notice = s.online_notice, terms_text = s.terms_text, receipt_footer = s.receipt_footer,
         updated_at = now(), updated_by = v_uid
   where x.id;

  return public.rental_settings_json();
end;
$$;

-- =========================================================================
-- 7) หมวดชุด
-- =========================================================================
create or replace function public.rental_save_category(p_id uuid, p_name text, p_sort integer default 0,
                                                       p_active boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_id uuid := p_id;
  r public.rental_categories%rowtype;
begin
  perform public.rental_require(true);
  v_name := nullif(public.product_clean_text(p_name), '');
  if v_name is null or char_length(v_name) > 60 then
    raise exception 'กรุณาใส่ชื่อหมวด (ไม่เกิน 60 ตัวอักษร)';
  end if;
  if p_sort is not null and (p_sort < -100000 or p_sort > 100000) then
    raise exception 'ลำดับหมวดไม่ถูกต้อง';
  end if;
  if exists (select 1 from public.rental_categories as c where lower(c.name) = lower(v_name) and c.id is distinct from v_id) then
    raise exception 'มีหมวดชื่อ "%" อยู่แล้ว', v_name;
  end if;
  begin
    if v_id is null then
      insert into public.rental_categories as c (name, sort_order, is_active)
      values (v_name, coalesce(p_sort, 0), coalesce(p_active, true))
      returning c.* into r;
    else
      update public.rental_categories as c
         set name = v_name, sort_order = coalesce(p_sort, c.sort_order), is_active = coalesce(p_active, c.is_active)
       where c.id = v_id
      returning c.* into r;
      if not found then
        raise exception 'ไม่พบหมวดนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'มีหมวดชื่อ "%" อยู่แล้ว', v_name;
  end;
  return jsonb_build_object('id', r.id, 'name', r.name, 'sort_order', r.sort_order, 'is_active', r.is_active,
                            'created_at', r.created_at);
end;
$$;

create or replace function public.rental_delete_category(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items integer;
begin
  perform public.rental_require(true);
  select count(*) into v_items from public.rental_items as i where i.category_id = p_id;
  delete from public.rental_categories as c where c.id = p_id;
  if not found then
    raise exception 'ไม่พบหมวดนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'items_uncategorized', v_items);
end;
$$;

-- =========================================================================
-- 8) ชุดเช่า + ชิ้นจริง + รูป
-- =========================================================================

-- p_item = ข้อมูลแบบชุด (สร้างใหม่: ส่ง client_id / แก้: ส่ง id + updated_at ตามที่โหลดมา)
--          คีย์ที่ไม่ส่งมา = คงค่าเดิม (แก้) / ค่าเริ่มต้น (สร้าง)
-- p_units = รายการชิ้น "ทั้งหมด" ของชุด [{id?, unit_code?, size?, status?, condition_note?}]
--          ไม่ใส่รหัสชิ้น = สร้างให้ '<รหัสชุด>-NN' / ชิ้นที่หายไปจากรายการ = ลบ (ถ้ายังไม่เคยถูกจอง)
create or replace function public.rental_save_item(p_item jsonb, p_units jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.rental_settings;
  it public.rental_items%rowtype;
  v_new boolean;
  v_id uuid;
  v_client uuid;
  v_found uuid;
  v_ts text;
  v_expected timestamptz;
  v_elem jsonb;
  v_tags text[];
  v_tag text;
  v_units jsonb := '[]'::jsonb;
  v_unit_ids uuid[] := '{}';
  v_codes text[] := '{}';
  v_uid2 uuid;
  v_code text;
  v_size text;
  v_status text;
  v_note text;
  u public.rental_units%rowtype;
  v_n integer;
  r record;
begin
  perform public.rental_require(true);
  if p_item is null or jsonb_typeof(p_item) <> 'object' then
    raise exception 'ข้อมูลชุดไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  if p_units is null or jsonb_typeof(p_units) <> 'array' then
    raise exception 'ข้อมูลชิ้นชุดไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  if jsonb_array_length(p_units) > 200 then
    raise exception 'ชุดหนึ่งแบบมีได้ไม่เกิน 200 ชิ้น';
  end if;
  s := public.rental_settings_row();

  v_id := public.product_json_uuid(p_item -> 'id', 'รหัสชุด');
  v_client := public.product_json_uuid(p_item -> 'client_id', 'รหัสคำขอ');
  v_new := v_id is null;

  if v_new then
    -- กดบันทึกซ้ำ (เน็ตหลุด) → คืนชุดที่สร้างไว้แล้ว ไม่สร้างซ้ำ
    if v_client is not null then
      select i.id into v_found from public.rental_items as i where i.client_id = v_client;
      if found then
        return public.rental_item_json(v_found, true);
      end if;
    end if;
    it.is_accessory := false;
    it.is_public := true;
    it.is_active := true;
    it.extra_day_price := 0;
    it.security_deposit := 0;
    it.replacement_cost := 0;
    it.tags := '{}';
  else
    select i.* into it from public.rental_items as i where i.id = v_id for update;
    if not found then
      raise exception 'ไม่พบชุดนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
    end if;
    v_ts := public.product_json_text(p_item -> 'updated_at', 'เวลาแก้ไขล่าสุด');
    if v_ts is null then
      raise exception 'ข้อมูลชุดไม่ครบ กรุณาโหลดหน้าใหม่';
    end if;
    begin
      v_expected := v_ts::timestamptz;
    exception when others then
      raise exception 'ข้อมูลชุดไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
    end;
    if v_expected <> it.updated_at then
      raise exception 'ชุดนี้ถูกแก้ไขจากเครื่องอื่น กรุณาโหลดหน้าใหม่แล้วแก้อีกครั้ง';
    end if;
  end if;

  if v_new or p_item ? 'code' then
    it.code := public.rental_json_text(p_item -> 'code', 'รหัสชุด', 30);
    if it.code is null then
      raise exception 'กรุณาใส่รหัสชุด';
    end if;
    if it.code !~ '^[!-~]{1,30}$' then
      raise exception 'รหัสชุดใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข และเครื่องหมาย (ห้ามมีช่องว่าง)';
    end if;
    if exists (select 1 from public.rental_items as i where lower(i.code) = lower(it.code) and i.id is distinct from v_id) then
      raise exception 'รหัสชุด % ซ้ำกับชุดอื่น', it.code;
    end if;
  end if;
  if v_new or p_item ? 'name' then
    it.name := public.rental_json_text(p_item -> 'name', 'ชื่อชุด', 150);
    if it.name is null then
      raise exception 'กรุณาใส่ชื่อชุด';
    end if;
  end if;
  if v_new or p_item ? 'category_id' then
    it.category_id := public.product_json_uuid(p_item -> 'category_id', 'หมวดชุด');
    if it.category_id is not null and not exists (select 1 from public.rental_categories as c where c.id = it.category_id) then
      raise exception 'ไม่พบหมวดที่เลือก (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
    end if;
  end if;
  if v_new or p_item ? 'description' then
    it.description := public.rental_json_text(p_item -> 'description', 'รายละเอียดชุด', 3000);
  end if;
  if v_new or p_item ? 'color' then
    it.color := public.rental_json_text(p_item -> 'color', 'สี', 60);
  end if;
  if v_new or p_item ? 'base_price' then
    it.base_price := public.rental_json_money(p_item -> 'base_price', 'ค่าเช่า', true);
    if it.base_price is null then
      raise exception 'กรุณาใส่ค่าเช่า';
    end if;
  end if;
  if v_new or p_item ? 'base_days' then
    it.base_days := coalesce(public.rental_json_int(p_item -> 'base_days', 'จำนวนวันเช่าพื้นฐาน', 1, 60), s.default_base_days);
  end if;
  if p_item ? 'extra_day_price' then
    it.extra_day_price := coalesce(public.rental_json_money(p_item -> 'extra_day_price', 'ค่าเช่าวันเพิ่ม', true), 0);
  end if;
  if p_item ? 'security_deposit' then
    it.security_deposit := coalesce(public.rental_json_money(p_item -> 'security_deposit', 'ค่าประกันชุด', true), 0);
  end if;
  if p_item ? 'replacement_cost' then
    it.replacement_cost := coalesce(public.rental_json_money(p_item -> 'replacement_cost', 'ค่าชดเชยกรณีสูญหาย', true), 0);
  end if;
  if v_new or p_item ? 'buffer_before_days' then
    it.buffer_before_days := public.rental_json_int(p_item -> 'buffer_before_days', 'วันเตรียมชุดก่อนรับ', 0, 14);
  end if;
  if v_new or p_item ? 'buffer_after_days' then
    it.buffer_after_days := public.rental_json_int(p_item -> 'buffer_after_days', 'วันซัก/ตรวจชุดหลังคืน', 0, 14);
  end if;
  if p_item ? 'is_accessory' then
    it.is_accessory := coalesce(public.product_json_bool(p_item -> 'is_accessory', 'ประเภทเครื่องประดับ'), false);
  end if;
  if p_item ? 'is_public' then
    it.is_public := coalesce(public.product_json_bool(p_item -> 'is_public', 'การแสดงบนหน้าจองออนไลน์'), true);
  end if;
  if p_item ? 'is_active' then
    it.is_active := coalesce(public.product_json_bool(p_item -> 'is_active', 'สถานะเปิดให้เช่า'), true);
  end if;
  if p_item ? 'tags' then
    v_tags := '{}';
    if jsonb_typeof(p_item -> 'tags') = 'array' then
      if jsonb_array_length(p_item -> 'tags') > 20 then
        raise exception 'ใส่แท็กได้ไม่เกิน 20 แท็ก';
      end if;
      for v_elem in select e.elem from jsonb_array_elements(p_item -> 'tags') as e(elem)
      loop
        v_tag := public.rental_json_text(v_elem, 'แท็ก', 30);
        if v_tag is not null and not exists (select 1 from unnest(v_tags) as t(x) where lower(t.x) = lower(v_tag)) then
          v_tags := v_tags || v_tag;
        end if;
      end loop;
    elsif jsonb_typeof(p_item -> 'tags') <> 'null' then
      raise exception 'แท็กไม่ถูกต้อง';
    end if;
    it.tags := v_tags;
  end if;

  -- ----- ตรวจรายการชิ้นทั้งหมดก่อนเขียน -----
  for v_elem in select e.elem from jsonb_array_elements(p_units) as e(elem)
  loop
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'ข้อมูลชิ้นชุดไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
    end if;
    v_uid2 := public.product_json_uuid(v_elem -> 'id', 'รหัสชิ้น');
    u := null;
    if v_uid2 is not null then
      if v_new then
        raise exception 'ข้อมูลชิ้นชุดไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
      end if;
      select x.* into u from public.rental_units as x where x.id = v_uid2 and x.item_id = v_id;
      if not found then
        raise exception 'ไม่พบชิ้นนี้ในชุด (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
      end if;
      if v_uid2 = any(v_unit_ids) then
        raise exception 'มีชิ้นซ้ำกันในรายการ กรุณาโหลดหน้าใหม่';
      end if;
      v_unit_ids := v_unit_ids || v_uid2;
    end if;
    v_code := public.rental_json_text(v_elem -> 'unit_code', 'รหัสชิ้น', 40);
    if v_code is not null then
      if v_code !~ '^[!-~]{1,40}$' then
        raise exception 'รหัสชิ้น "%" ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข และเครื่องหมาย (ห้ามมีช่องว่าง)', v_code;
      end if;
      if lower(v_code) = any(v_codes) then
        raise exception 'รหัสชิ้น % ซ้ำกันในรายการ', v_code;
      end if;
      if exists (select 1 from public.rental_units as x where lower(x.unit_code) = lower(v_code) and x.id is distinct from v_uid2) then
        raise exception 'รหัสชิ้น % ซ้ำกับชิ้นอื่น', v_code;
      end if;
      v_codes := v_codes || lower(v_code);
    end if;
    if v_elem ? 'size' or u.id is null then
      v_size := public.rental_json_text(v_elem -> 'size', 'ไซส์', 20);
    else
      v_size := u.size;
    end if;
    v_status := coalesce(public.rental_json_text(v_elem -> 'status', 'สถานะชิ้น', 20), u.status, 'available');
    if v_status not in ('available', 'maintenance', 'retired') then
      raise exception 'สถานะชิ้นไม่ถูกต้อง';
    end if;
    if v_elem ? 'condition_note' or u.id is null then
      v_note := public.rental_json_text(v_elem -> 'condition_note', 'หมายเหตุสภาพชิ้น', 500);
    else
      v_note := u.condition_note;
    end if;
    v_units := v_units || jsonb_build_array(jsonb_build_object('id', v_uid2, 'unit_code', v_code, 'size', v_size,
                                                               'status', v_status, 'condition_note', v_note));
  end loop;

  -- ----- เขียนแบบชุด -----
  begin
    if v_new then
      insert into public.rental_items as i
        (client_id, code, name, category_id, description, color, base_price, base_days, extra_day_price, security_deposit,
         replacement_cost, buffer_before_days, buffer_after_days, is_accessory, is_public, is_active, tags)
      values
        (v_client, it.code, it.name, it.category_id, it.description, it.color, it.base_price, it.base_days,
         it.extra_day_price, it.security_deposit, it.replacement_cost, it.buffer_before_days, it.buffer_after_days,
         it.is_accessory, it.is_public, it.is_active, it.tags)
      returning i.id into v_id;
    else
      update public.rental_items as i
         set code = it.code, name = it.name, category_id = it.category_id, description = it.description, color = it.color,
             base_price = it.base_price, base_days = it.base_days, extra_day_price = it.extra_day_price,
             security_deposit = it.security_deposit, replacement_cost = it.replacement_cost,
             buffer_before_days = it.buffer_before_days, buffer_after_days = it.buffer_after_days,
             is_accessory = it.is_accessory, is_public = it.is_public, is_active = it.is_active, tags = it.tags
       where i.id = v_id;
    end if;
  exception when unique_violation then
    if v_new and v_client is not null then
      select i.id into v_found from public.rental_items as i where i.client_id = v_client;
      if found then
        return public.rental_item_json(v_found, true);
      end if;
    end if;
    raise exception 'รหัสชุด % ซ้ำกับชุดอื่น', it.code;
  end;

  -- ----- ชิ้นที่หายไปจากรายการ: ลบได้เฉพาะชิ้นที่ไม่เคยถูกจอง -----
  for r in
    select x.id, x.unit_code
      from public.rental_units as x
     where x.item_id = v_id and not (x.id = any(v_unit_ids))
     order by x.unit_code
  loop
    if exists (select 1 from public.rental_booking_lines as l where l.unit_id = r.id) then
      raise exception 'ชิ้น % มีประวัติการเช่า ใช้สถานะเลิกใช้แทน', r.unit_code;
    end if;
    delete from public.rental_units as x where x.id = r.id;
  end loop;

  -- ----- แก้ชิ้นเดิม แล้วเพิ่มชิ้นใหม่ (รหัสอัตโนมัติ = เลขถัดไปที่ยังไม่มีใครใช้) -----
  begin
    for v_elem in select e.elem from jsonb_array_elements(v_units) as e(elem) where e.elem ->> 'id' is not null
    loop
      update public.rental_units as x
         set unit_code = coalesce(v_elem ->> 'unit_code', x.unit_code),
             size = v_elem ->> 'size',
             status = v_elem ->> 'status',
             condition_note = v_elem ->> 'condition_note'
       where x.id = (v_elem ->> 'id')::uuid;
    end loop;
    v_n := 0;
    for v_elem in select e.elem from jsonb_array_elements(v_units) as e(elem) where e.elem ->> 'id' is null
    loop
      v_code := v_elem ->> 'unit_code';
      if v_code is null then
        loop
          v_n := v_n + 1;
          v_code := it.code || '-' || lpad(v_n::text, 2, '0');
          exit when not exists (select 1 from public.rental_units as x where lower(x.unit_code) = lower(v_code))
                and not (lower(v_code) = any(v_codes));
        end loop;
      end if;
      insert into public.rental_units (item_id, unit_code, size, status, condition_note)
      values (v_id, v_code, v_elem ->> 'size', v_elem ->> 'status', v_elem ->> 'condition_note');
    end loop;
  exception when unique_violation then
    raise exception 'รหัสชิ้นซ้ำกับชิ้นอื่น กรุณาตรวจรหัสชิ้นแล้วบันทึกอีกครั้ง';
  end;

  return public.rental_item_json(v_id, false);
end;
$$;

create or replace function public.rental_get_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform public.rental_require(false);
  v := public.rental_item_json(p_item_id, false);
  if v is null then
    raise exception 'ไม่พบชุดนี้ (อาจถูกลบไปแล้ว)';
  end if;
  return v;
end;
$$;

-- ลบชุดได้เฉพาะเมื่อยังไม่มีชิ้นไหนเคยถูกจอง → คืนที่อยู่ไฟล์รูปให้แอปลบใน Storage ต่อ
create or replace function public.rental_delete_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_paths jsonb;
begin
  perform public.rental_require(true);
  select i.code into v_code from public.rental_items as i where i.id = p_item_id for update;
  if not found then
    raise exception 'ไม่พบชุดนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  if exists (select 1 from public.rental_booking_lines as l where l.item_id = p_item_id) then
    raise exception 'ชุด % มีประวัติการเช่าแล้ว ลบไม่ได้ ใช้ "ปิดให้เช่า" แทน', v_code;
  end if;
  select coalesce(jsonb_agg(im.path order by im.sort_order, im.id), '[]'::jsonb) into v_paths
    from public.rental_item_images as im where im.item_id = p_item_id;
  delete from public.rental_units as u where u.item_id = p_item_id;
  delete from public.rental_items as i where i.id = p_item_id;
  return jsonb_build_object('ok', true, 'id', p_item_id, 'image_paths', v_paths);
end;
$$;

create or replace function public.rental_set_item_active(p_item_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.rental_require(true);
  if p_active is null then
    raise exception 'กรุณาเลือกสถานะเปิด/ปิดให้เช่า';
  end if;
  update public.rental_items as i set is_active = p_active where i.id = p_item_id;
  if not found then
    raise exception 'ไม่พบชุดนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  return public.rental_item_json(p_item_id, false);
end;
$$;

create or replace function public.rental_add_item_image(p_item_id uuid, p_path text, p_width integer default null,
                                                        p_height integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_row public.rental_item_images%rowtype;
  v_sort integer;
begin
  perform public.rental_require(true);
  perform 1 from public.rental_items as i where i.id = p_item_id for update;
  if not found then
    raise exception 'ไม่พบชุดนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  v_prefix := p_item_id::text || '/';
  if p_path is null or left(p_path, char_length(v_prefix)) <> v_prefix then
    raise exception 'ที่อยู่ไฟล์รูปไม่ถูกต้อง: ต้องขึ้นต้นด้วย "%"', v_prefix;
  end if;
  if substr(p_path, char_length(v_prefix) + 1) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' then
    raise exception 'ชื่อไฟล์รูปไม่ถูกต้อง (ใช้ได้เฉพาะ a-z A-Z 0-9 . _ - และห้ามมีโฟลเดอร์ย่อย)';
  end if;
  if (p_width is not null and (p_width < 1 or p_width > 20000)) or (p_height is not null and (p_height < 1 or p_height > 20000)) then
    raise exception 'ขนาดรูปไม่ถูกต้อง';
  end if;

  select im.* into v_row from public.rental_item_images as im where im.path = p_path;
  if not found then
    if (select count(*) from public.rental_item_images as im where im.item_id = p_item_id) >= 20 then
      raise exception 'ชุดหนึ่งแบบมีรูปได้ไม่เกิน 20 รูป';
    end if;
    select coalesce(max(im.sort_order), 0) + 1 into v_sort from public.rental_item_images as im where im.item_id = p_item_id;
    insert into public.rental_item_images as im (item_id, path, sort_order, width, height)
    values (p_item_id, p_path, v_sort, p_width, p_height)
    returning im.* into v_row;
  end if;
  return jsonb_build_object('id', v_row.id, 'item_id', v_row.item_id, 'path', v_row.path, 'sort_order', v_row.sort_order,
                            'width', v_row.width, 'height', v_row.height, 'created_at', v_row.created_at);
end;
$$;

create or replace function public.rental_delete_item_image(p_image_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  perform public.rental_require(true);
  delete from public.rental_item_images as im where im.id = p_image_id returning im.path into v_path;
  if v_path is null then
    raise exception 'ไม่พบรูปนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  return jsonb_build_object('path', v_path);
end;
$$;

-- p_ids = รูปทั้งหมดของชุดตามลำดับใหม่ (ต้องครบทุกรูป)
create or replace function public.rental_reorder_item_images(p_item_id uuid, p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_have uuid[];
begin
  perform public.rental_require(true);
  perform 1 from public.rental_items as i where i.id = p_item_id for update;
  if not found then
    raise exception 'ไม่พบชุดนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  select coalesce(array_agg(im.id order by im.id), '{}') into v_have
    from public.rental_item_images as im where im.item_id = p_item_id;
  if p_ids is null or cardinality(p_ids) <> cardinality(v_have)
     or (select count(distinct x) from unnest(p_ids) as t(x)) <> cardinality(v_have)
     or not (p_ids <@ v_have) then
    raise exception 'รายการรูปไม่ตรงกับรูปของชุด (อาจมีการเพิ่ม/ลบรูปจากเครื่องอื่น) กรุณาโหลดหน้าใหม่';
  end if;
  update public.rental_item_images as im
     set sort_order = t.ord
    from unnest(p_ids) with ordinality as t(id, ord)
   where im.id = t.id;
  return jsonb_build_object('images', coalesce((
    select jsonb_agg(jsonb_build_object('id', im.id, 'path', im.path, 'sort_order', im.sort_order,
                                        'width', im.width, 'height', im.height) order by im.sort_order, im.id)
      from public.rental_item_images as im where im.item_id = p_item_id), '[]'::jsonb));
end;
$$;

-- สถานะชิ้น (ผู้จัดการ) → คืนการจองที่ยังรอชิ้นนี้อยู่ (ต้องสลับชิ้นให้ลูกค้า)
create or replace function public.rental_set_unit_status(p_unit_id uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text;
  v_conf jsonb := '[]'::jsonb;
begin
  perform public.rental_require(true);
  if p_status is null or p_status not in ('available', 'maintenance', 'retired') then
    raise exception 'สถานะชิ้นไม่ถูกต้อง';
  end if;
  v_note := nullif(public.product_clean_text(p_note), '');
  if char_length(v_note) > 500 then
    raise exception 'หมายเหตุสภาพชิ้นยาวเกินไป (สูงสุด 500 ตัวอักษร)';
  end if;
  update public.rental_units as u
     set status = p_status, condition_note = coalesce(v_note, u.condition_note)
   where u.id = p_unit_id;
  if not found then
    raise exception 'ไม่พบชิ้นนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  if p_status <> 'available' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'booking_id', b.id, 'booking_no', b.booking_no, 'status', b.status, 'pickup_date', b.pickup_date,
             'return_date', b.return_date, 'customer_name', c.name) order by b.pickup_date, b.booking_no), '[]'::jsonb)
      into v_conf
      from public.rental_booking_lines as l
      join public.rental_bookings as b on b.id = l.booking_id
      join public.rental_customers as c on c.id = b.customer_id
     where l.unit_id = p_unit_id
       and l.blocking
       and b.status in ('pending', 'confirmed', 'picked_up')
       and upper(l.block_range) > public.pos_bkk_today();
  end if;
  return jsonb_build_object('unit', public.rental_unit_json(p_unit_id), 'conflicts', v_conf);
end;
$$;

create or replace function public.rental_mark_unit_clean(p_unit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.rental_require(false);
  update public.rental_units as u set needs_cleaning = false where u.id = p_unit_id;
  if not found then
    raise exception 'ไม่พบชิ้นนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  return public.rental_unit_json(p_unit_id);
end;
$$;

-- =========================================================================
-- 9) ลูกค้า
-- =========================================================================
-- p_customer = {id?, client_id?, name, phone, phone2, line_id, email, id_card_no, address, note,
--               is_blacklisted?, blacklist_reason? (ผู้จัดการเท่านั้น), source?, updated_at? (กันเขียนทับ)}
create or replace function public.rental_save_customer(p_customer jsonb)
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
  v_expected timestamptz;
  v_old timestamptz;
begin
  perform public.rental_require(false);
  if p_customer is null or jsonb_typeof(p_customer) <> 'object' then
    raise exception 'ข้อมูลลูกค้าไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  v_id := public.product_json_uuid(p_customer -> 'id', 'รหัสลูกค้า');
  v_client := public.product_json_uuid(p_customer -> 'client_id', 'รหัสคำขอ');
  if v_id is null and v_client is not null then
    select c.id into v_found from public.rental_customers as c where c.client_id = v_client;
    if found then
      return public.rental_customer_json(v_found) || jsonb_build_object('already_saved', true);
    end if;
  end if;
  if v_id is not null then
    v_ts := public.product_json_text(p_customer -> 'updated_at', 'เวลาแก้ไขล่าสุด');
    if v_ts is not null then
      begin
        v_expected := v_ts::timestamptz;
      exception when others then
        raise exception 'ข้อมูลลูกค้าไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
      end;
      select c.updated_at into v_old from public.rental_customers as c where c.id = v_id for update;
      if found and v_old <> v_expected then
        raise exception 'ข้อมูลลูกค้านี้ถูกแก้ไขจากเครื่องอื่น กรุณาโหลดหน้าใหม่แล้วแก้อีกครั้ง';
      end if;
    end if;
  end if;
  begin
    v_id := public.rental_customer_write(v_id, p_customer, 'walkin', public.rental_manager(), v_client);
  exception when unique_violation then
    select c.id into v_found from public.rental_customers as c where c.client_id = v_client;
    if found then
      return public.rental_customer_json(v_found) || jsonb_build_object('already_saved', true);
    end if;
    raise;
  end;
  return public.rental_customer_json(v_id) || jsonb_build_object('already_saved', false);
end;
$$;

create or replace function public.rental_get_customer(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform public.rental_require(false);
  v := public.rental_customer_json(p_id);
  if v is null then
    raise exception 'ไม่พบข้อมูลลูกค้านี้ (อาจถูกลบไปแล้ว)';
  end if;
  return v || jsonb_build_object('bookings', coalesce((
    select jsonb_agg(jsonb_build_object('id', z.id, 'booking_no', z.booking_no, 'status', z.status,
                                        'status_label', public.rental_status_label(z.status),
                                        'pickup_date', z.pickup_date, 'return_date', z.return_date,
                                        'grand_total', z.grand_total, 'due', z.due, 'created_at', z.created_at)
                     order by z.created_at desc, z.booking_no desc)
      from (select b.* from public.rental_bookings as b where b.customer_id = p_id
             order by b.created_at desc, b.booking_no desc limit 50) as z), '[]'::jsonb));
end;
$$;

-- =========================================================================
-- 10) ความว่าง / ปฏิทิน / ตารางงาน
-- =========================================================================
create or replace function public.rental_find_units(p_pickup date, p_return date, p_item_ids uuid[] default null,
                                                    p_search text default null, p_category_id uuid default null,
                                                    p_exclude_booking uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer;
  v_q text;
  v_items jsonb;
begin
  perform public.rental_require(false);
  perform public.rental_expire_pending();
  if p_pickup is null or p_return is null then
    raise exception 'กรุณาเลือกวันรับและวันคืนชุด';
  end if;
  if p_return < p_pickup then
    raise exception 'วันคืนชุดต้องไม่ก่อนวันรับชุด';
  end if;
  v_days := public.rental_days(p_pickup, p_return);
  if v_days > 60 then
    raise exception 'เช่าได้ไม่เกิน 60 วันต่อการจอง';
  end if;
  v_q := nullif(public.product_clean_text(p_search), '');
  if char_length(v_q) > 100 then
    v_q := left(v_q, 100);
  end if;
  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');

  select coalesce(jsonb_agg(x.j order by x.is_accessory, x.code), '[]'::jsonb) into v_items
    from (
      select i.is_accessory, i.code,
             jsonb_build_object(
               'item_id', i.id, 'code', i.code, 'name', i.name, 'category_name', c.name, 'is_accessory', i.is_accessory,
               'cover_path', (select im.path from public.rental_item_images as im where im.item_id = i.id
                               order by im.sort_order, im.created_at, im.id limit 1),
               'base_price', i.base_price, 'base_days', i.base_days, 'extra_day_price', i.extra_day_price,
               'security_deposit', i.security_deposit,
               'rent_price', public.rental_line_price(i.base_price, i.base_days, i.extra_day_price, v_days),
               'sizes', coalesce((
                  select jsonb_agg(jsonb_build_object('size', g.size, 'free_units', g.free_units, 'total_units', g.total_units)
                                   order by public.product_size_rank(g.size), g.size)
                    from (select uu.size, count(*) as total_units,
                                 coalesce(jsonb_agg(jsonb_build_object('unit_id', uu.id, 'unit_code', uu.unit_code,
                                                                       'needs_cleaning', uu.needs_cleaning)
                                                    order by uu.unit_code) filter (where uu.is_free), '[]'::jsonb) as free_units
                            from (select u.id, u.unit_code, u.size, u.needs_cleaning,
                                         public.rental_unit_free(u.id, br.r, p_exclude_booking) as is_free
                                    from public.rental_units as u
                                   where u.item_id = i.id and u.status = 'available') as uu
                           group by uu.size) as g), '[]'::jsonb)) as j
        from public.rental_items as i
        left join public.rental_categories as c on c.id = i.category_id
        cross join lateral (select public.rental_block_range(i.id, p_pickup, p_return) as r) as br
       where i.is_active
         and (p_item_ids is null or i.id = any(p_item_ids))
         and (p_category_id is null or i.category_id = p_category_id)
         and (v_q is null or i.code ilike '%' || v_q || '%' or i.name ilike '%' || v_q || '%'
              or coalesce(i.color, '') ilike '%' || v_q || '%' or array_to_string(i.tags, ' ') ilike '%' || v_q || '%')
       order by i.is_accessory, i.code
       limit 300
    ) as x;

  return jsonb_build_object('days', v_days, 'pickup_date', p_pickup, 'return_date', p_return, 'items', v_items);
end;
$$;

-- ปฏิทินชุด: ทุกชิ้น × ช่วงวันที่ — แยก "วันเช่า" (rent) กับ "วันเตรียม/ซัก" (buffer) ให้หน้าจอระบายสีต่างกัน
create or replace function public.rental_item_calendar(p_item_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.rental_items%rowtype;
  v_units jsonb;
begin
  perform public.rental_require(false);
  perform public.rental_expire_pending();
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'ช่วงวันที่ไม่ถูกต้อง';
  end if;
  if p_to - p_from + 1 > 92 then
    raise exception 'ดูปฏิทินได้ครั้งละไม่เกิน 92 วัน';
  end if;
  select i.* into it from public.rental_items as i where i.id = p_item_id;
  if not found then
    raise exception 'ไม่พบชุดนี้ (อาจถูกลบไปแล้ว)';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'unit_id', u.id, 'unit_code', u.unit_code, 'size', u.size, 'status', u.status, 'needs_cleaning', u.needs_cleaning,
           'blocks', coalesce((
              select jsonb_agg(seg.j order by seg.f, seg.ord)
                from (
                  select sg.f, sg.ord,
                         jsonb_build_object('booking_id', b.id, 'booking_no', b.booking_no, 'status', b.status,
                                            'customer_name', c.name, 'pickup_date', b.pickup_date,
                                            'return_date', b.return_date, 'block_from', sg.f, 'block_to', sg.t,
                                            'kind', sg.kind) as j
                    from public.rental_booking_lines as l
                    join public.rental_bookings as b on b.id = l.booking_id
                    join public.rental_customers as c on c.id = b.customer_id
                    -- ชิ้นที่ลูกค้ายังไม่คืน (คืนช้า) = ยังเช่าอยู่ถึงวันนี้ + วันซักหลังจากนั้น
                    cross join lateral (
                      select public.rental_line_busy_range(l.block_range, l.status, l.item_id) as br,
                             case when l.status = 'picked_up' then greatest(b.return_date, public.pos_bkk_today())
                                  else coalesce(b.returned_on, b.return_date) end as rent_to
                    ) as er
                    cross join lateral (
                      select x.f, x.t, x.kind, x.ord
                        from (values
                               (lower(er.br), b.pickup_date - 1, 'buffer', 1),
                               (b.pickup_date, er.rent_to, 'rent', 2),
                               (er.rent_to + 1, upper(er.br) - 1, 'buffer', 3)
                             ) as x(f, t, kind, ord)
                       where x.f <= x.t
                    ) as sg
                   where l.unit_id = u.id
                     and l.blocking
                     and er.br && daterange(p_from, p_to + 1, '[)')
                     and sg.t >= p_from and sg.f <= p_to
                ) as seg), '[]'::jsonb))
         order by public.product_size_rank(u.size), u.size, u.unit_code), '[]'::jsonb)
    into v_units
    from public.rental_units as u
   where u.item_id = it.id;

  return jsonb_build_object('item', jsonb_build_object('id', it.id, 'code', it.code, 'name', it.name),
                            'from', p_from, 'to', p_to, 'units', v_units);
end;
$$;

create or replace function public.rental_schedule(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := public.pos_bkk_today();
  v_days jsonb;
begin
  perform public.rental_require(false);
  perform public.rental_expire_pending();
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'ช่วงวันที่ไม่ถูกต้อง';
  end if;
  if p_to - p_from + 1 > 92 then
    raise exception 'ดูตารางงานได้ครั้งละไม่เกิน 92 วัน';
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'day', d.day,
             'pickups', coalesce((select jsonb_agg(public.rental_booking_json(b.id, false) order by b.pickup_time nulls last, b.booking_no)
                                    from public.rental_bookings as b
                                   where b.pickup_date = d.day
                                     and b.status in ('pending', 'confirmed', 'picked_up', 'returned', 'completed')), '[]'::jsonb),
             'returns', coalesce((select jsonb_agg(public.rental_booking_json(b.id, false) order by b.booking_no)
                                    from public.rental_bookings as b
                                   where b.return_date = d.day
                                     and b.status in ('pending', 'confirmed', 'picked_up', 'returned', 'completed')), '[]'::jsonb),
             'fittings', coalesce((select jsonb_agg(public.rental_booking_json(b.id, false) order by b.fitting_time nulls last, b.booking_no)
                                     from public.rental_bookings as b
                                    where b.fitting_date = d.day
                                      and b.status in ('pending', 'confirmed', 'picked_up')), '[]'::jsonb))
           || case when d.day = v_today then jsonb_build_object('overdue_returns', coalesce((
                   select jsonb_agg(public.rental_booking_json(b.id, false) order by b.return_date, b.booking_no)
                     from public.rental_bookings as b
                    where b.status = 'picked_up' and b.return_date < v_today), '[]'::jsonb))
                   else '{}'::jsonb end
           order by d.day), '[]'::jsonb)
    into v_days
    from generate_series(0, p_to - p_from) as g(n)
    cross join lateral (select p_from + g.n as day) as d;

  return jsonb_build_object('from', p_from, 'to', p_to, 'days', v_days);
end;
$$;

-- =========================================================================
-- 11) การจอง
-- =========================================================================

-- ราคาล่วงหน้า (อ่านอย่างเดียว) — payload แบบเดียวกับตอนสร้าง (+ booking_id ถ้ากำลังแก้การจองเดิม)
create or replace function public.rental_quote(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.rental_settings;
  b public.rental_bookings;
  v_old public.rental_bookings;
  v_bid uuid;
  v_lines jsonb;
  v_rent numeric;
  v_dep numeric;
  v_grand numeric;
  v_sec numeric;
begin
  perform public.rental_require(false);
  perform public.rental_expire_pending();
  s := public.rental_settings_row();
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'ข้อมูลการจองไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  v_bid := public.product_json_uuid(p_payload -> 'booking_id', 'การจอง');
  if v_bid is not null then
    select x.* into v_old from public.rental_bookings as x where x.id = v_bid;
    if not found then
      raise exception 'ไม่พบการจองนี้';
    end if;
  end if;
  b := public.rental_read_head(p_payload, v_old);
  v_lines := public.rental_resolve_lines(p_payload -> 'lines', b.pickup_date, b.return_date, v_bid, false);
  select coalesce(sum((e.elem ->> 'rent_price')::numeric), 0), coalesce(sum((e.elem ->> 'deposit')::numeric), 0)
    into v_rent, v_dep
    from jsonb_array_elements(v_lines) as e(elem);
  v_grand := v_rent - least(b.discount, v_rent) + b.delivery_fee;
  v_sec := coalesce(b.security_override, v_dep);
  return jsonb_build_object(
    'days', public.rental_days(b.pickup_date, b.return_date),
    'pickup_date', b.pickup_date, 'return_date', b.return_date,
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
                         'line_id', e.elem -> 'line_id', 'item_id', e.elem -> 'item_id', 'item_code', e.elem -> 'item_code',
                         'item_name', e.elem -> 'item_name', 'unit_id', e.elem -> 'unit_id', 'unit_code', e.elem -> 'unit_code',
                         'size', e.elem -> 'size', 'rent_price', e.elem -> 'rent_price', 'deposit', e.elem -> 'deposit',
                         'available', e.elem -> 'available', 'conflict', e.elem -> 'conflict') order by e.ord)
                         from jsonb_array_elements(v_lines) with ordinality as e(elem, ord)), '[]'::jsonb),
    'all_available', not exists (select 1 from jsonb_array_elements(v_lines) as e(elem) where not (e.elem ->> 'available')::boolean),
    'rent_total', v_rent,
    'discount', b.discount,
    'discount_ok', b.discount <= v_rent,
    'delivery_fee', b.delivery_fee,
    'grand_total', v_grand,
    'security_required', v_sec,
    'deposit_required', least(greatest(v_grand, 0),
                              greatest(coalesce(v_old.min_deposit, s.min_booking_deposit),
                                       ceil(greatest(v_rent - b.discount, 0)
                                            * coalesce(v_old.deposit_percent, s.booking_deposit_percent) / 100))));
end;
$$;

create or replace function public.rental_get_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform public.rental_require(false);
  perform public.rental_expire_pending();
  v := public.rental_booking_json(p_booking_id, true);
  if v is null then
    raise exception 'ไม่พบการจองนี้ (อาจถูกลบไปแล้ว)';
  end if;
  return v;
end;
$$;

-- สร้างการจอง (พนักงาน) — p_client_id ส่งซ้ำ = คืนการจองเดิม already_saved = true (ไม่รับเงินซ้ำ)
--   payload: {customer_id? | customer:{...}, pickup_date, return_date, ..., source?, status? ('confirmed'|'pending'),
--             hold_hours?, lines:[{item_id, size?, unit_id?}], force? (ลูกค้าบัญชีดำ), payments?:[{kind, method, amount, note}]}
create or replace function public.rental_create_booking(p_client_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.rental_settings;
  v_found uuid;
  v_cust uuid;
  c public.rental_customers%rowtype;
  v_force boolean;
  v_source text;
  v_status text;
  v_hold integer;
  v_id uuid;
  v_pay jsonb;
  v_bl public.rental_customers;
  v_md5 text;
begin
  perform public.rental_require(false);
  perform public.rental_expire_pending();
  if p_client_id is null then
    raise exception 'รหัสคำขอไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  select b.id, b.client_payload_md5 into v_found, v_md5 from public.rental_bookings as b where b.client_id = p_client_id;
  if found then
    -- payload_matches: true = ส่งข้อมูลชุดเดิมซ้ำ (เน็ตหลุด) / false = รหัสเดิมแต่ข้อมูลอื่น (แท็บที่ทำซ้ำ/ฟอร์มถูกแก้หลังส่ง)
    --   null = การจองที่สร้างก่อนมีคอลัมน์นี้ หรือสร้างจากหน้าจองออนไลน์
    return jsonb_build_object('already_saved', true,
      'payload_matches', case when v_md5 is null then null else v_md5 = md5(coalesce(p_payload, 'null'::jsonb)::text) end,
      'booking', public.rental_booking_json(v_found, true));
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'ข้อมูลการจองไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  s := public.rental_settings_row();

  v_source := coalesce(public.rental_json_text(p_payload -> 'source', 'ช่องทางการจอง', 20), 'walkin');
  if v_source not in ('walkin', 'online', 'phone', 'line', 'other') then
    raise exception 'ช่องทางการจองไม่ถูกต้อง';
  end if;
  v_status := coalesce(public.rental_json_text(p_payload -> 'status', 'สถานะการจอง', 20), 'confirmed');
  if v_status not in ('confirmed', 'pending') then
    raise exception 'สถานะการจองเริ่มต้นต้องเป็น "จองแล้ว" หรือ "รอยืนยัน"';
  end if;
  v_hold := coalesce(public.rental_json_int(p_payload -> 'hold_hours', 'เวลาถือการจอง (ชั่วโมง)', 1, 168), s.online_hold_hours);
  v_force := coalesce(public.product_json_bool(p_payload -> 'force', 'การยืนยัน'), false);
  if p_payload ? 'payments' and jsonb_typeof(p_payload -> 'payments') not in ('array', 'null') then
    raise exception 'ข้อมูลการรับเงินไม่ถูกต้อง';
  end if;

  -- ลูกค้า: เลือกจากที่มี หรือสร้างใหม่จากฟอร์ม
  v_cust := public.product_json_uuid(p_payload -> 'customer_id', 'ลูกค้า');
  if v_cust is null then
    if jsonb_typeof(p_payload -> 'customer') is distinct from 'object' then
      raise exception 'กรุณาเลือกหรือกรอกข้อมูลลูกค้า';
    end if;
    v_cust := public.rental_customer_write(null, (p_payload -> 'customer') - 'is_blacklisted' - 'blacklist_reason',
                                           v_source, false, null);
    -- ลูกค้าใหม่แต่เบอร์ตรงกับคนในบัญชีดำ = ต้องยืนยันเหมือนเลือกคนนั้นเอง (ยกเลิกทั้งรายการ → ไม่เหลือลูกค้าใหม่ค้าง)
    v_bl := public.rental_blacklist_phone_match(v_cust);
    if v_bl.id is not null and not v_force then
      raise exception 'เบอร์โทรนี้เป็นของลูกค้า % ที่อยู่ในบัญชีดำ% — ต้องกดยืนยันเพื่อจองต่อ', v_bl.name,
        case when v_bl.blacklist_reason is not null then ' (' || v_bl.blacklist_reason || ')' else '' end;
    end if;
  end if;
  select x.* into c from public.rental_customers as x where x.id = v_cust;
  if not found then
    raise exception 'ไม่พบข้อมูลลูกค้า กรุณาเลือกลูกค้าใหม่';
  end if;
  if c.is_blacklisted and not v_force then
    raise exception 'ลูกค้า % อยู่ในบัญชีดำ% — ต้องกดยืนยันเพื่อจองต่อ', c.name,
      case when c.blacklist_reason is not null then ' (' || c.blacklist_reason || ')' else '' end;
  end if;

  v_id := public.rental_create_core(p_client_id, p_payload, v_cust, v_source, v_status, v_hold, null, 30);
  update public.rental_bookings as x set client_payload_md5 = md5(p_payload::text) where x.id = v_id;
  if c.is_blacklisted then
    perform public.rental_log(v_id, 'blacklist_override', jsonb_build_object('reason', c.blacklist_reason));
  elsif v_bl.id is not null then
    perform public.rental_log(v_id, 'blacklist_override',
      jsonb_build_object('reason', v_bl.blacklist_reason, 'phone_match', true, 'blacklisted_customer_id', v_bl.id));
  end if;

  -- รับเงินทันที (เช่น มัดจำ + เงินประกัน) — กฎเดียวกับการรับเงินปกติทุกข้อ
  if jsonb_typeof(p_payload -> 'payments') = 'array' then
    if jsonb_array_length(p_payload -> 'payments') > 10 then
      raise exception 'รับเงินพร้อมการจองได้ไม่เกิน 10 รายการ';
    end if;
    for v_pay in select e.elem from jsonb_array_elements(p_payload -> 'payments') as e(elem)
    loop
      if jsonb_typeof(v_pay) <> 'object' then
        raise exception 'ข้อมูลการรับเงินไม่ถูกต้อง';
      end if;
      perform public.rental_lock_booking(v_id);
      perform public.rental_add_payment_core(
        v_id, null,
        public.rental_json_text(v_pay -> 'kind', 'ประเภทรายการเงิน', 20),
        public.rental_json_text(v_pay -> 'method', 'วิธีชำระเงิน', 20),
        public.product_json_num(v_pay -> 'amount', 'จำนวนเงิน'),
        public.rental_json_text(v_pay -> 'note', 'หมายเหตุ', 300));
    end loop;
  end if;

  return jsonb_build_object('already_saved', false, 'payload_matches', true, 'booking', public.rental_booking_json(v_id, true));
end;
$$;

-- แก้การจอง (รอยืนยัน/จองแล้ว เท่านั้น) — p_updated_at = เวลาแก้ล่าสุดตอนโหลดฟอร์ม (กันเขียนทับ)
--   payload: คีย์ที่ไม่ส่ง = คงค่าเดิม; lines = รายการ "ทั้งหมด" [{line_id?, item_id, size?, unit_id?}] (ต้องส่งเสมอ)
--   payload.client_id (uuid ไม่บังคับ) = รหัสคำขอแก้ไขที่เครื่องสุ่มไว้: ส่งซ้ำหลังเน็ตหลุด (ครั้งก่อนบันทึกไปแล้ว)
--     ข้อมูลเดิมทุกตัวอักษร → คืนการจองตามเดิม ไม่ชนล็อกเวอร์ชันของตัวเอง ; รหัสเดิมแต่ข้อมูลอื่น → ปฏิเสธ
--     (จำไว้ในประวัติ action = 'update' : detail.client_id + detail.payload_md5)
create or replace function public.rental_update_booking(p_booking_id uuid, p_updated_at timestamptz, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b_old public.rental_bookings;
  b public.rental_bookings;
  v_cust uuid;
  c public.rental_customers%rowtype;
  v_force boolean;
  v_lines jsonb;
  v_rent numeric;
  v_detail jsonb;
  v_bl public.rental_customers;
  v_client uuid;
  v_md5 text;
  v_prev_md5 text;
begin
  perform public.rental_require(false);
  perform public.rental_expire_pending();
  b_old := public.rental_lock_booking(p_booking_id);
  -- รหัสคำขอแก้ไข: ตรวจหลังได้ล็อก (รอบก่อนของเครื่องเดิมอาจบันทึกเสร็จระหว่างรอ) และก่อนตรวจสถานะ/เวอร์ชัน
  if p_payload is not null and jsonb_typeof(p_payload) = 'object' and p_payload ? 'client_id' then
    v_client := public.product_json_uuid(p_payload -> 'client_id', 'รหัสคำขอ');
  end if;
  if v_client is not null then
    v_md5 := md5(p_payload::text);
    select lg.detail ->> 'payload_md5' into v_prev_md5
      from public.rental_logs as lg
     where lg.booking_id = b_old.id and lg.action = 'update' and lg.detail ->> 'client_id' = v_client::text
     order by lg.id desc
     limit 1;
    if found then
      if v_prev_md5 is distinct from v_md5 then
        raise exception 'รหัสคำขอนี้ถูกใช้บันทึกการแก้ไขชุดอื่นไปแล้ว กรุณาโหลดหน้าใหม่แล้วตรวจข้อมูลก่อนแก้อีกครั้ง';
      end if;
      return public.rental_booking_json(b_old.id, true);
    end if;
  end if;
  if b_old.status not in ('pending', 'confirmed') then
    raise exception 'แก้ไขได้เฉพาะการจองที่ยังไม่รับชุด (สถานะตอนนี้: %)', public.rental_status_label(b_old.status);
  end if;
  if p_updated_at is null or p_updated_at <> b_old.updated_at then
    raise exception 'การจองนี้ถูกแก้ไขจากเครื่องอื่น กรุณาโหลดหน้าใหม่แล้วแก้อีกครั้ง';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'ข้อมูลการจองไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  if not (p_payload ? 'lines') then
    raise exception 'กรุณาส่งรายการชุดทั้งหมดของการจอง';
  end if;
  v_force := coalesce(public.product_json_bool(p_payload -> 'force', 'การยืนยัน'), false);

  b := public.rental_read_head(p_payload, b_old);

  v_cust := b_old.customer_id;
  if p_payload ? 'customer_id' and public.product_json_uuid(p_payload -> 'customer_id', 'ลูกค้า') is not null then
    v_cust := public.product_json_uuid(p_payload -> 'customer_id', 'ลูกค้า');
  elsif jsonb_typeof(p_payload -> 'customer') = 'object' then
    v_cust := public.rental_customer_write(null, (p_payload -> 'customer') - 'is_blacklisted' - 'blacklist_reason',
                                           b_old.source, false, null);
    v_bl := public.rental_blacklist_phone_match(v_cust);
    if v_bl.id is not null and not v_force then
      raise exception 'เบอร์โทรนี้เป็นของลูกค้า % ที่อยู่ในบัญชีดำ% — ต้องกดยืนยันเพื่อจองต่อ', v_bl.name,
        case when v_bl.blacklist_reason is not null then ' (' || v_bl.blacklist_reason || ')' else '' end;
    end if;
  end if;
  select x.* into c from public.rental_customers as x where x.id = v_cust;
  if not found then
    raise exception 'ไม่พบข้อมูลลูกค้า กรุณาเลือกลูกค้าใหม่';
  end if;
  if v_cust <> b_old.customer_id and c.is_blacklisted and not v_force then
    raise exception 'ลูกค้า % อยู่ในบัญชีดำ — ต้องกดยืนยันเพื่อจองต่อ', c.name;
  end if;

  v_lines := public.rental_resolve_lines(p_payload -> 'lines', b.pickup_date, b.return_date, b_old.id, true, 30);
  select coalesce(sum((e.elem ->> 'rent_price')::numeric), 0) into v_rent from jsonb_array_elements(v_lines) as e(elem);
  if b.discount > v_rent then
    raise exception 'ส่วนลด (%) มากกว่าค่าเช่ารวม (%)', public.rental_baht(b.discount), public.rental_baht(v_rent);
  end if;

  perform public.rental_write_lines(b_old.id, v_lines);

  update public.rental_bookings as x
     set customer_id = v_cust, pickup_date = b.pickup_date, return_date = b.return_date, event_date = b.event_date,
         fitting_date = b.fitting_date, fitting_time = b.fitting_time, pickup_time = b.pickup_time,
         delivery_method = b.delivery_method, delivery_address = b.delivery_address, delivery_fee = b.delivery_fee,
         discount = b.discount, discount_note = b.discount_note, security_override = b.security_override,
         note = b.note, customer_note = b.customer_note
   where x.id = b_old.id;
  perform public.rental_recalc(b_old.id);

  v_detail := jsonb_build_object('lines', jsonb_array_length(v_lines));
  if v_client is not null then
    v_detail := v_detail || jsonb_build_object('client_id', v_client, 'payload_md5', v_md5);
  end if;
  if b.pickup_date <> b_old.pickup_date or b.return_date <> b_old.return_date then
    v_detail := v_detail || jsonb_build_object('pickup_date', jsonb_build_array(b_old.pickup_date, b.pickup_date),
                                               'return_date', jsonb_build_array(b_old.return_date, b.return_date));
  end if;
  if v_cust <> b_old.customer_id then
    v_detail := v_detail || jsonb_build_object('customer_changed', true);
  end if;
  if b.discount <> b_old.discount then
    v_detail := v_detail || jsonb_build_object('discount', jsonb_build_array(b_old.discount, b.discount));
  end if;
  perform public.rental_log(b_old.id, 'update', v_detail);
  -- เปลี่ยนเป็นลูกค้าบัญชีดำ / ลูกค้าใหม่ที่เบอร์ตรงกับคนในบัญชีดำ — จดว่ามีคนกดยืนยัน (เหมือนตอนสร้างการจอง)
  if v_cust <> b_old.customer_id and c.is_blacklisted then
    perform public.rental_log(b_old.id, 'blacklist_override', jsonb_build_object('reason', c.blacklist_reason));
  elsif v_bl.id is not null then
    perform public.rental_log(b_old.id, 'blacklist_override',
      jsonb_build_object('reason', v_bl.blacklist_reason, 'phone_match', true, 'blacklisted_customer_id', v_bl.id));
  end if;
  return public.rental_booking_json(b_old.id, true);
end;
$$;

create or replace function public.rental_confirm_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.rental_bookings;
begin
  perform public.rental_require(false);
  perform public.rental_expire_pending();
  b := public.rental_lock_booking(p_booking_id);
  if b.status = 'confirmed' then
    return public.rental_booking_json(b.id, true);
  end if;
  if b.status = 'expired' then
    raise exception 'การจองนี้หมดเวลาถือแล้ว ชุดถูกปล่อยให้คนอื่นจอง กรุณาสร้างการจองใหม่';
  end if;
  if b.status <> 'pending' then
    raise exception 'ยืนยันได้เฉพาะการจองที่รอยืนยัน (สถานะตอนนี้: %)', public.rental_status_label(b.status);
  end if;
  update public.rental_bookings as x
     set status = 'confirmed', confirmed_at = now(), expires_at = null
   where x.id = b.id;
  perform public.rental_log(b.id, 'confirm', jsonb_build_object('deposit_met', b.deposit_met, 'paid', b.paid));
  return public.rental_booking_json(b.id, true);
end;
$$;

-- p_client_id = รหัสคำขอที่เครื่องสุ่มตอนเปิดหน้าต่าง: ส่งซ้ำ (เน็ตหลุดตอนรอคำตอบ) = คืนการจองตามเดิม ไม่ต่อเวลาซ้ำสองรอบ
--   (จำไว้ในประวัติการจอง action = 'extend_hold' · ฐานข้อมูลรุ่นก่อนมีฟังก์ชัน 2 พารามิเตอร์ → ลบทิ้งก่อน ไม่ให้มีสองแบบ)
drop function if exists public.rental_extend_hold(uuid, integer);
create or replace function public.rental_extend_hold(p_booking_id uuid, p_hours integer, p_client_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.rental_bookings;
  v_new timestamptz;
begin
  perform public.rental_require(false);
  perform public.rental_expire_pending();
  if p_hours is null or p_hours < 1 or p_hours > 168 then
    raise exception 'ต่อเวลาถือได้ 1 ถึง 168 ชั่วโมง';
  end if;
  b := public.rental_lock_booking(p_booking_id);
  -- ตรวจหลังได้ล็อก: รอบก่อนของเครื่องเดิมอาจบันทึกเสร็จระหว่างรอ
  if p_client_id is not null and exists (
       select 1 from public.rental_logs as l
        where l.booking_id = b.id and l.action = 'extend_hold' and l.detail ->> 'client_id' = p_client_id::text) then
    return public.rental_booking_json(b.id, true);
  end if;
  if b.status <> 'pending' then
    raise exception 'ต่อเวลาถือได้เฉพาะการจองที่รอยืนยัน (สถานะตอนนี้: %)', public.rental_status_label(b.status);
  end if;
  v_new := greatest(coalesce(b.expires_at, now()), now()) + make_interval(hours => p_hours);
  update public.rental_bookings as x set expires_at = v_new where x.id = b.id;
  perform public.rental_log(b.id, 'extend_hold', jsonb_build_object('hours', p_hours, 'old', b.expires_at, 'new', v_new,
                                                                   'client_id', p_client_id));
  return public.rental_booking_json(b.id, true);
end;
$$;

-- ยกเลิก (รอยืนยัน/จองแล้ว) — เงินที่รับไว้คงอยู่ (มัดจำที่ริบ = รายได้) ถ้าคืนเงินให้บันทึก "คืนเงิน" แยก
create or replace function public.rental_cancel_booking(p_booking_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  b public.rental_bookings;
  v_reason text;
begin
  v_uid := public.rental_require(false);
  perform public.rental_expire_pending();
  v_reason := public.rental_reason(p_reason, 'เหตุผลที่ยกเลิก');
  b := public.rental_lock_booking(p_booking_id);
  if b.status = 'cancelled' then
    return public.rental_booking_json(b.id, true);
  end if;
  if b.status not in ('pending', 'confirmed') then
    raise exception 'ยกเลิกได้เฉพาะการจองที่ยังไม่รับชุด (สถานะตอนนี้: %)', public.rental_status_label(b.status);
  end if;
  update public.rental_bookings as x
     set status = 'cancelled', cancel_reason = v_reason, cancelled_at = now(), cancelled_by = v_uid, expires_at = null
   where x.id = b.id;
  update public.rental_booking_lines as l set blocking = false where l.booking_id = b.id;
  perform public.rental_recalc(b.id);
  perform public.rental_log(b.id, 'cancel', jsonb_build_object('reason', v_reason, 'paid', b.paid, 'security_held', b.security_held));
  return public.rental_booking_json(b.id, true);
end;
$$;

create or replace function public.rental_mark_no_show(p_booking_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  b public.rental_bookings;
  v_reason text;
begin
  v_uid := public.rental_require(false);
  perform public.rental_expire_pending();
  v_reason := coalesce(nullif(public.product_clean_text(p_reason), ''), 'ลูกค้าไม่มารับชุดตามนัด');
  if char_length(v_reason) > 200 then
    raise exception 'เหตุผลยาวเกินไป (สูงสุด 200 ตัวอักษร)';
  end if;
  b := public.rental_lock_booking(p_booking_id);
  if b.status <> 'confirmed' then
    raise exception 'ใช้ได้กับการจองที่ยืนยันแล้วเท่านั้น (สถานะตอนนี้: %)', public.rental_status_label(b.status);
  end if;
  if b.pickup_date >= public.pos_bkk_today() then
    raise exception 'ยังไม่เลยวันรับชุด (%) บันทึกว่าไม่มารับได้ตั้งแต่วันถัดไป', public.rental_thai_date(b.pickup_date);
  end if;
  update public.rental_bookings as x
     set status = 'no_show', cancel_reason = v_reason, cancelled_at = now(), cancelled_by = v_uid
   where x.id = b.id;
  update public.rental_booking_lines as l set blocking = false where l.booking_id = b.id;
  perform public.rental_recalc(b.id);
  perform public.rental_log(b.id, 'no_show', jsonb_build_object('reason', v_reason, 'paid', b.paid));
  return public.rental_booking_json(b.id, true);
end;
$$;

-- รับชุด — payload {id_checked, note?, force?, force_reason?, unit_swaps?:[{line_id, unit_id}]}
--   มีข้อควรระวัง (ค้างชำระ / เงินประกันไม่ครบ / ชิ้นยังไม่พร้อม / ยังไม่ถึงวันรับ) → ต้อง force + เหตุผล
create or replace function public.rental_pickup(p_booking_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  b public.rental_bookings;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_force boolean;
  v_force_reason text;
  v_note text;
  v_idc boolean;
  v_swap jsonb;
  v_line uuid;
  v_unit uuid;
  l public.rental_booking_lines%rowtype;
  u public.rental_units%rowtype;
  v_swapped jsonb := '[]'::jsonb;
  v_swap_lines uuid[] := '{}';
  v_warn jsonb;
  v_confirmed boolean := false;
begin
  v_uid := public.rental_require(false);
  perform public.rental_expire_pending();
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'ข้อมูลการรับชุดไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  b := public.rental_lock_booking(p_booking_id);
  if b.status = 'picked_up' then
    return public.rental_booking_json(b.id, true);
  end if;
  if b.status not in ('pending', 'confirmed') then
    raise exception 'รับชุดไม่ได้ (สถานะตอนนี้: %)', public.rental_status_label(b.status);
  end if;
  v_force := coalesce(public.product_json_bool(v_payload -> 'force', 'การยืนยัน'), false);
  v_idc := coalesce(public.product_json_bool(v_payload -> 'id_checked', 'การตรวจบัตร'), false);
  v_note := public.rental_json_text(v_payload -> 'note', 'หมายเหตุการรับชุด', 500);

  -- สลับชิ้นก่อนรับ (ชิ้นของชุดเดียวกัน ไซส์ไหนก็ได้ ต้องว่างและพร้อมให้เช่า)
  if jsonb_typeof(v_payload -> 'unit_swaps') = 'array' and jsonb_array_length(v_payload -> 'unit_swaps') > 0 then
    for v_swap in select e.elem from jsonb_array_elements(v_payload -> 'unit_swaps') as e(elem)
    loop
      v_line := public.product_json_uuid(v_swap -> 'line_id', 'รายการชุด');
      if v_line is null or v_line = any(v_swap_lines) then
        raise exception 'ข้อมูลการสลับชิ้นไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
      end if;
      v_swap_lines := v_swap_lines || v_line;
    end loop;
    update public.rental_booking_lines as x set blocking = false where x.id = any(v_swap_lines) and x.booking_id = b.id;
    for v_swap in select e.elem from jsonb_array_elements(v_payload -> 'unit_swaps') as e(elem)
    loop
      v_line := public.product_json_uuid(v_swap -> 'line_id', 'รายการชุด');
      v_unit := public.product_json_uuid(v_swap -> 'unit_id', 'ชิ้นชุด');
      select x.* into l from public.rental_booking_lines as x where x.id = v_line and x.booking_id = b.id;
      if not found then
        raise exception 'ไม่พบรายการชุดนี้ในการจอง กรุณาโหลดหน้าใหม่';
      end if;
      select x.* into u from public.rental_units as x where x.id = v_unit;
      if not found or u.item_id <> l.item_id then
        raise exception 'สลับได้เฉพาะชิ้นของชุดเดียวกัน';
      end if;
      if u.status <> 'available' and u.id <> l.unit_id then
        raise exception 'ชิ้น % ไม่พร้อมให้เช่า (%)', u.unit_code, case u.status when 'maintenance' then 'ส่งซ่อม' else 'เลิกใช้' end;
      end if;
      if not public.rental_unit_free(u.id, l.block_range, b.id) then
        raise exception '%', public.rental_conflict_text(u.id, l.block_range, b.id);
      end if;
      begin
        update public.rental_booking_lines as x
           set unit_id = u.id, size = u.size, blocking = true
         where x.id = l.id;
      exception when exclusion_violation then
        raise exception '%', public.rental_conflict_text(u.id, l.block_range, b.id);
      end;
      if u.id <> l.unit_id then
        v_swapped := v_swapped || jsonb_build_array(jsonb_build_object('line_id', l.id, 'from', l.unit_id, 'to', u.id,
                                                                       'unit_code', u.unit_code));
      end if;
    end loop;
  end if;

  -- ข้อควรระวัง (คำนวณหลังสลับชิ้น) — ชิ้นที่ยังอยู่กับลูกค้าคนอื่น = ห้ามรับ แม้กดบังคับ
  v_warn := public.rental_booking_json(b.id, true) -> 'actions' -> 'block_reasons';
  if jsonb_array_length(coalesce(v_warn -> 'pickup_blockers', '[]'::jsonb)) > 0 then
    raise exception 'รับชุดไม่ได้: %',
      (select string_agg(e.t, ' / ' order by e.ord) from jsonb_array_elements_text(v_warn -> 'pickup_blockers') with ordinality as e(t, ord));
  end if;
  v_warn := v_warn -> 'pickup_warnings';
  if jsonb_array_length(v_warn) > 0 then
    if not v_force then
      raise exception 'รับชุดไม่ได้: % — ถ้าต้องการให้รับ ให้กดยืนยันแบบบังคับพร้อมระบุเหตุผล',
        (select string_agg(e.t, ' / ' order by e.ord) from jsonb_array_elements_text(v_warn) with ordinality as e(t, ord));
    end if;
    v_force_reason := public.rental_reason(v_payload ->> 'force_reason', 'เหตุผลที่รับชุดทั้งที่ยังมีข้อควรระวัง');
  end if;

  if b.status = 'pending' then
    v_confirmed := true;
  end if;
  update public.rental_booking_lines as x set status = 'picked_up' where x.booking_id = b.id and x.status = 'booked';
  update public.rental_bookings as x
     set status = 'picked_up', picked_up_at = now(), picked_up_by = v_uid, id_checked = v_idc,
         confirmed_at = coalesce(x.confirmed_at, now()), expires_at = null
   where x.id = b.id;
  perform public.rental_recalc(b.id);
  perform public.rental_log(b.id, 'pickup', jsonb_build_object(
    'id_checked', v_idc, 'note', v_note, 'forced', jsonb_array_length(v_warn) > 0, 'warnings', v_warn,
    'force_reason', v_force_reason, 'swaps', v_swapped, 'auto_confirmed', v_confirmed));
  return public.rental_booking_json(b.id, true);
end;
$$;

-- ขยาย/ย่นวันคืน (จองแล้ว/กำลังเช่า) — p_reprice = คิดค่าเช่าใหม่ตามจำนวนวันใหม่ (ราคา ณ ตอนจอง)
create or replace function public.rental_extend(p_booking_id uuid, p_new_return_date date, p_reprice boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.rental_bookings;
  l record;
  v_days integer;
  v_range daterange;
  v_old_rent numeric;
  v_new_rent numeric;
begin
  perform public.rental_require(false);
  perform public.rental_expire_pending();
  b := public.rental_lock_booking(p_booking_id);
  if b.status not in ('confirmed', 'picked_up') then
    raise exception 'เปลี่ยนวันคืนได้เฉพาะการจองที่ยืนยันแล้วหรือกำลังเช่า (สถานะตอนนี้: %)', public.rental_status_label(b.status);
  end if;
  if p_new_return_date is null then
    raise exception 'กรุณาเลือกวันคืนชุดใหม่';
  end if;
  if p_new_return_date < b.pickup_date then
    raise exception 'วันคืนชุดต้องไม่ก่อนวันรับชุด (%)', public.rental_thai_date(b.pickup_date);
  end if;
  -- ชุดยังอยู่กับลูกค้า: ย่นวันคืนให้เป็นวันที่ผ่านมาแล้วไม่ได้ (คิดค่าเช่าน้อยกว่าวันที่ลูกค้าถือชุดไว้จริง)
  --   — คืนแล้วให้บันทึก "รับคืนชุด" / ลูกค้าที่เลยกำหนดขอต่อวัน (เลื่อนวันคืนให้ช้าลง) ยังทำได้ตามปกติ
  if b.status = 'picked_up' and p_new_return_date < b.return_date and p_new_return_date < public.pos_bkk_today() then
    raise exception 'ลูกค้ายังไม่ได้คืนชุด ย่นวันคืนให้เป็นวันที่ผ่านมาแล้วไม่ได้ (วันคืนใหม่ต้องไม่ก่อนวันนี้ %) — ถ้าคืนชุดแล้วให้บันทึก "รับคืนชุด" แทน',
      public.rental_thai_date(public.pos_bkk_today());
  end if;
  v_days := public.rental_days(b.pickup_date, p_new_return_date);
  if v_days > 60 then
    raise exception 'เช่าได้ไม่เกิน 60 วันต่อการจอง (เลือกไว้ % วัน)', v_days;
  end if;
  if p_new_return_date = b.return_date then
    return public.rental_booking_json(b.id, true);
  end if;
  v_old_rent := b.rent_total;

  update public.rental_booking_lines as x
     set blocking = false
   where x.booking_id = b.id and x.status in ('booked', 'picked_up');
  -- เรียงตามรหัสชิ้นเสมอ (ทุกฟังก์ชันที่กันชิ้นทีละหลายชิ้นใช้ลำดับเดียวกัน → สองเครื่องพร้อมกันไม่ติดรอกันเอง)
  for l in
    select x.id, x.item_id, x.unit_id, x.base_price, x.base_days, x.extra_day_price
      from public.rental_booking_lines as x
     where x.booking_id = b.id and x.status in ('booked', 'picked_up')
     order by x.unit_id, x.id
  loop
    v_range := public.rental_block_range(l.item_id, b.pickup_date, p_new_return_date);
    begin
      update public.rental_booking_lines as x
         set block_range = v_range,
             blocking = true,
             rent_price = case when coalesce(p_reprice, true)
                               then public.rental_line_price(l.base_price, l.base_days, l.extra_day_price, v_days)
                               else x.rent_price end
       where x.id = l.id;
    exception
      when exclusion_violation then
        raise exception '%', public.rental_conflict_text(l.unit_id, v_range, b.id);
      when deadlock_detected or serialization_failure then
        raise exception 'มีการจองชุดเดียวกันพร้อมกันจากอีกเครื่อง กรุณาลองใหม่อีกครั้ง';
    end;
  end loop;

  -- ส่วนลดต้องไม่เกินค่าเช่าใหม่ (เหมือนตอนสร้าง/แก้การจอง) — ไม่อย่างนั้นยอดรวมติดลบและปิดงานไม่ได้
  select coalesce(sum(x.rent_price), 0) into v_new_rent from public.rental_booking_lines as x where x.booking_id = b.id;
  if b.discount > v_new_rent then
    raise exception 'ส่วนลด (%) มากกว่าค่าเช่ารวมหลังเปลี่ยนวันคืน (%) — แก้ส่วนลดก่อน หรือเปลี่ยนวันโดยไม่คิดค่าเช่าใหม่',
      public.rental_baht(b.discount), public.rental_baht(v_new_rent);
  end if;

  update public.rental_bookings as x set return_date = p_new_return_date where x.id = b.id;
  perform public.rental_recalc(b.id);
  perform public.rental_log(b.id, 'extend', jsonb_build_object(
    'old_return_date', b.return_date, 'new_return_date', p_new_return_date, 'reprice', coalesce(p_reprice, true),
    'rent_total_old', v_old_rent,
    'rent_total_new', (select x.rent_total from public.rental_bookings as x where x.id = b.id)));
  return public.rental_booking_json(b.id, true);
end;
$$;

-- เพิ่มค่าปรับ/ค่าใช้จ่าย (ภายใน — ไม่ตรวจสิทธิ์/สถานะ)
create or replace function public.rental_insert_charge(p_booking_id uuid, p_line_id uuid, p_kind text,
                                                       p_description text, p_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_desc text;
  v_id uuid;
begin
  if p_kind is null or p_kind not in ('late', 'damage', 'lost', 'cleaning', 'delivery', 'other') then
    raise exception 'ประเภทค่าใช้จ่ายไม่ถูกต้อง';
  end if;
  v_desc := nullif(public.product_clean_text(p_description), '');
  if v_desc is null or char_length(v_desc) > 200 then
    raise exception 'กรุณาระบุรายละเอียดค่าใช้จ่าย (ไม่เกิน 200 ตัวอักษร)';
  end if;
  perform public.rental_check_money(p_amount, 'จำนวนเงินค่าใช้จ่าย', false);
  if p_line_id is not null and not exists (select 1 from public.rental_booking_lines as l
                                            where l.id = p_line_id and l.booking_id = p_booking_id) then
    raise exception 'ไม่พบรายการชุดนี้ในการจอง กรุณาโหลดหน้าใหม่';
  end if;
  insert into public.rental_charges as c (booking_id, line_id, kind, description, amount, created_by, created_by_name)
  values (p_booking_id, p_line_id, p_kind, v_desc, p_amount, v_uid, public.pos_actor_name(v_uid))
  returning c.id into v_id;
  return v_id;
end;
$$;

-- รับคืนชุด — payload {returned_on?, lines:[{line_id, condition, note?, clean?}], charges:[{line_id?, kind, description, amount}], note?}
--   ทุกชิ้นที่รับออกไปต้องอยู่ในรายการ / คืนก่อนกำหนด = ปล่อยชิ้นให้คนอื่นจองได้เร็วขึ้น
create or replace function public.rental_return(p_booking_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  b public.rental_bookings;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_today date := public.pos_bkk_today();
  v_on date;
  v_elem jsonb;
  v_line uuid;
  v_cond text;
  v_lnote text;
  v_clean boolean;
  v_seen uuid[] := '{}';
  l record;
  v_after integer;
  v_upper date;
  v_summary jsonb := '[]'::jsonb;
  v_buffer_clash jsonb := '[]'::jsonb;
  v_charges numeric := 0;
  v_note text;
  v_amount numeric;
begin
  v_uid := public.rental_require(false);
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'ข้อมูลการรับคืนไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  b := public.rental_lock_booking(p_booking_id);
  if b.status <> 'picked_up' then
    raise exception 'รับคืนได้เฉพาะการจองที่กำลังเช่า (สถานะตอนนี้: %)', public.rental_status_label(b.status);
  end if;
  v_on := coalesce(public.rental_json_date(v_payload -> 'returned_on', 'วันที่คืนชุด'), v_today);
  if v_on < b.pickup_date then
    raise exception 'วันที่คืนชุดต้องไม่ก่อนวันรับชุด (%)', public.rental_thai_date(b.pickup_date);
  end if;
  if v_on > v_today then
    raise exception 'วันที่คืนชุดต้องไม่เกินวันนี้';
  end if;
  v_note := public.rental_json_text(v_payload -> 'note', 'หมายเหตุการรับคืน', 500);
  if jsonb_typeof(v_payload -> 'lines') is distinct from 'array' then
    raise exception 'กรุณาระบุสภาพชุดที่คืนทุกชิ้น';
  end if;

  for v_elem in select e.elem from jsonb_array_elements(v_payload -> 'lines') as e(elem)
  loop
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'ข้อมูลการรับคืนไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
    end if;
    v_line := public.product_json_uuid(v_elem -> 'line_id', 'รายการชุด');
    if v_line is null or v_line = any(v_seen) then
      raise exception 'ข้อมูลการรับคืนไม่ถูกต้อง (รายการชุดซ้ำหรือไม่ครบ) กรุณาโหลดหน้าใหม่';
    end if;
    v_seen := v_seen || v_line;
    select x.id, x.item_id, x.unit_id, x.status, x.block_range, u.unit_code
      into l
      from public.rental_booking_lines as x
      join public.rental_units as u on u.id = x.unit_id
     where x.id = v_line and x.booking_id = b.id;
    if not found or l.status <> 'picked_up' then
      raise exception 'ไม่พบรายการชุดนี้ในการจองที่รับออกไป กรุณาโหลดหน้าใหม่';
    end if;
    v_cond := public.rental_json_text(v_elem -> 'condition', 'สภาพชุด', 20);
    if v_cond is null or v_cond not in ('ok', 'dirty', 'damaged', 'lost') then
      raise exception 'กรุณาเลือกสภาพของชิ้น % (ปกติ / เปื้อน / ชำรุด / สูญหาย)', l.unit_code;
    end if;
    v_lnote := public.rental_json_text(v_elem -> 'note', 'หมายเหตุสภาพชุด', 300);
    v_clean := coalesce(public.product_json_bool(v_elem -> 'clean', 'สถานะพร้อมเช่า'), false);

    -- ช่วงที่กันชิ้นหลังคืน = ถึง วันคืนจริง + วันซัก (คืนเร็ว = ปล่อยชิ้นเร็วขึ้น / คืนช้า = กันวันซักหลังวันคืนจริงเพิ่ม)
    --   คืนช้าแล้วชนการจองถัดไปที่จองไว้ก่อน (ชิ้นต้องส่งต่อทันที ไม่มีวันซัก) → คงช่วงเดิม + บันทึกไว้ให้พนักงานเห็น
    select bf.p_after into v_after from public.rental_item_buffers(l.item_id) as bf;
    v_upper := greatest(v_on + v_after + 1, lower(l.block_range) + 1);
    update public.rental_booking_lines as x
       set status = case when v_cond = 'lost' then 'lost' else 'returned' end,
           return_condition = v_cond,
           return_note = v_lnote
     where x.id = l.id;
    if v_upper <> upper(l.block_range) then
      begin
        update public.rental_booking_lines as x
           set block_range = daterange(lower(x.block_range), v_upper, '[)')
         where x.id = l.id;
      exception when exclusion_violation then
        v_buffer_clash := v_buffer_clash || jsonb_build_array(jsonb_build_object(
          'unit_code', l.unit_code,
          'conflict', public.rental_conflict_text(l.unit_id, daterange(upper(l.block_range), v_upper, '[)'), b.id)));
      end;
    end if;

    if v_cond = 'lost' then
      update public.rental_units as u
         set status = 'retired', needs_cleaning = false,
             condition_note = left('สูญหาย (' || b.booking_no || ')' || coalesce(' ' || v_lnote, ''), 500)
       where u.id = l.unit_id;
    else
      update public.rental_units as u
         set needs_cleaning = not (v_cond = 'ok' and v_clean)
       where u.id = l.unit_id;
    end if;
    v_summary := v_summary || jsonb_build_array(jsonb_build_object('unit_code', l.unit_code, 'condition', v_cond));
  end loop;

  if exists (select 1 from public.rental_booking_lines as x
              where x.booking_id = b.id and x.status = 'picked_up') then
    raise exception 'กรุณาระบุสภาพชุดที่คืนให้ครบทุกชิ้น';
  end if;

  if v_payload ? 'charges' and jsonb_typeof(v_payload -> 'charges') not in ('array', 'null') then
    raise exception 'ข้อมูลค่าปรับไม่ถูกต้อง';
  end if;
  if jsonb_typeof(v_payload -> 'charges') = 'array' then
    if jsonb_array_length(v_payload -> 'charges') > 50 then
      raise exception 'เพิ่มค่าปรับได้ไม่เกิน 50 รายการ';
    end if;
    for v_elem in select e.elem from jsonb_array_elements(v_payload -> 'charges') as e(elem)
    loop
      if jsonb_typeof(v_elem) <> 'object' then
        raise exception 'ข้อมูลค่าปรับไม่ถูกต้อง';
      end if;
      v_amount := public.product_json_num(v_elem -> 'amount', 'จำนวนเงินค่าปรับ');
      perform public.rental_insert_charge(b.id, public.product_json_uuid(v_elem -> 'line_id', 'รายการชุด'),
                                          public.rental_json_text(v_elem -> 'kind', 'ประเภทค่าใช้จ่าย', 20),
                                          public.product_json_text(v_elem -> 'description', 'รายละเอียดค่าใช้จ่าย'),
                                          v_amount);
      v_charges := v_charges + v_amount;
    end loop;
  end if;

  update public.rental_bookings as x
     set status = 'returned', returned_at = now(), returned_on = v_on, returned_by = v_uid
   where x.id = b.id;
  perform public.rental_recalc(b.id);
  perform public.rental_log(b.id, 'return', jsonb_build_object(
    'returned_on', v_on, 'late_days', greatest(0, v_on - b.return_date), 'lines', v_summary,
    'charges_added', v_charges, 'note', v_note));
  if jsonb_array_length(v_buffer_clash) > 0 then
    perform public.rental_log(b.id, 'return_buffer_clash', jsonb_build_object('units', v_buffer_clash));
  end if;
  return public.rental_booking_json(b.id, true);
end;
$$;

-- p_client_id = รหัสคำขอที่เครื่องสุ่มตอนเปิดหน้าต่าง: ส่งซ้ำ = คืนการจองตามเดิม ไม่เพิ่มค่าปรับซ้ำ
--   (ฐานข้อมูลรุ่นก่อนมีฟังก์ชัน 5 พารามิเตอร์ → ลบทิ้งก่อน ไม่ให้มีสองแบบ)
drop function if exists public.rental_add_charge(uuid, text, text, numeric, uuid);
create or replace function public.rental_add_charge(p_booking_id uuid, p_kind text, p_description text, p_amount numeric,
                                                    p_line_id uuid default null, p_client_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.rental_bookings;
  v_id uuid;
  v_found uuid;
begin
  perform public.rental_require(false);
  b := public.rental_lock_booking(p_booking_id);
  -- ตรวจหลังได้ล็อก: รอบก่อนของเครื่องเดิมอาจบันทึกเสร็จระหว่างรอ
  if p_client_id is not null then
    select x.booking_id into v_found from public.rental_charges as x where x.client_id = p_client_id;
    if found then
      if v_found is distinct from b.id then
        raise exception 'รหัสคำขอนี้ถูกใช้กับการจองอื่นแล้ว กรุณาโหลดหน้าใหม่';
      end if;
      return public.rental_booking_json(b.id, true);
    end if;
  end if;
  if b.status not in ('picked_up', 'returned') then
    raise exception 'เพิ่มค่าปรับ/ค่าใช้จ่ายได้หลังรับชุดแล้วเท่านั้น (สถานะตอนนี้: %)', public.rental_status_label(b.status);
  end if;
  v_id := public.rental_insert_charge(b.id, p_line_id, p_kind, p_description, p_amount);
  if p_client_id is not null then
    begin
      update public.rental_charges as x set client_id = p_client_id where x.id = v_id;
    exception when unique_violation then
      raise exception 'รหัสคำขอนี้ถูกใช้กับการจองอื่นแล้ว กรุณาโหลดหน้าใหม่';
    end;
  end if;
  perform public.rental_recalc(b.id);
  perform public.rental_log(b.id, 'charge_add', jsonb_build_object('charge_id', v_id, 'kind', p_kind, 'amount', p_amount,
                                                                  'description', p_description, 'client_id', p_client_id));
  return public.rental_booking_json(b.id, true);
end;
$$;

create or replace function public.rental_void_charge(p_charge_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_reason text;
  ch public.rental_charges%rowtype;
  b public.rental_bookings;
begin
  v_uid := public.rental_require(false);
  v_reason := public.rental_reason(p_reason, 'เหตุผลที่ยกเลิกค่าใช้จ่าย');
  select x.* into ch from public.rental_charges as x where x.id = p_charge_id;
  if not found then
    raise exception 'ไม่พบรายการค่าใช้จ่ายนี้';
  end if;
  b := public.rental_lock_booking(ch.booking_id);
  select x.* into ch from public.rental_charges as x where x.id = p_charge_id for update;
  if ch.voided_at is not null then
    return public.rental_booking_json(b.id, true);
  end if;
  if b.status not in ('picked_up', 'returned') then
    raise exception 'ยกเลิกค่าใช้จ่ายได้เฉพาะการจองที่กำลังเช่าหรือรอปิดงาน (สถานะตอนนี้: %)', public.rental_status_label(b.status);
  end if;
  update public.rental_charges as x
     set voided_at = now(), voided_by = v_uid, void_reason = v_reason
   where x.id = ch.id;
  perform public.rental_recalc(b.id);
  perform public.rental_log(b.id, 'charge_void', jsonb_build_object('charge_id', ch.id, 'amount', ch.amount, 'reason', v_reason));
  return public.rental_booking_json(b.id, true);
end;
$$;

create or replace function public.rental_complete(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.rental_bookings;
  v_pending numeric;
begin
  perform public.rental_require(false);
  b := public.rental_lock_booking(p_booking_id);
  if b.status = 'completed' then
    return public.rental_booking_json(b.id, true);
  end if;
  if b.status <> 'returned' then
    raise exception 'ปิดงานได้หลังรับคืนชุดแล้วเท่านั้น (สถานะตอนนี้: %)', public.rental_status_label(b.status);
  end if;
  perform public.rental_recalc(b.id);
  select x.* into b from public.rental_bookings as x where x.id = b.id;
  if b.due > 0.005 then
    raise exception 'ปิดงานไม่ได้: ยังค้างชำระ %', public.rental_baht(b.due);
  end if;
  if b.due < -0.005 then
    raise exception 'ปิดงานไม่ได้: รับเงินเกิน % ต้องคืนเงินก่อน', public.rental_baht(-b.due);
  end if;
  if b.security_held >= 0.005 then
    raise exception 'ปิดงานไม่ได้: ยังถือเงินประกัน % ต้องคืนหรือหักก่อน', public.rental_baht(b.security_held);
  end if;
  -- สลิปที่ยังไม่ตรวจ = เงินที่อาจเข้ามาแล้ว — ต้องอนุมัติ/ปฏิเสธก่อน ไม่อย่างนั้นอนุมัติทีหลังยอดจะไม่ลงตัว
  select coalesce(sum(p.amount), 0) into v_pending
    from public.rental_payments as p
   where p.booking_id = b.id and p.status = 'pending_review' and p.voided_at is null;
  if v_pending > 0.005 then
    raise exception 'ปิดงานไม่ได้: ยังมีสลิปรอตรวจ % ต้องอนุมัติหรือปฏิเสธก่อน', public.rental_baht(v_pending);
  end if;
  update public.rental_bookings as x set status = 'completed', completed_at = now() where x.id = b.id;
  perform public.rental_log(b.id, 'complete', jsonb_build_object('grand_total', b.grand_total, 'paid', b.paid));
  return public.rental_booking_json(b.id, true);
end;
$$;

-- =========================================================================
-- 12) การเงิน
-- =========================================================================
-- p_client_id ส่งซ้ำ = คืนรายการเดิม already_saved = true (ไม่บันทึกซ้ำ)
create or replace function public.rental_add_payment(p_client_id uuid, p_booking_id uuid, p_kind text, p_method text,
                                                     p_amount numeric, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found record;
  v_id uuid;
begin
  perform public.rental_require(false);
  perform public.rental_expire_pending();
  if p_client_id is null then
    raise exception 'รหัสคำขอไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  select p.id, p.booking_id into v_found from public.rental_payments as p where p.client_id = p_client_id;
  if found then
    if v_found.booking_id is distinct from p_booking_id then
      raise exception 'รหัสคำขอนี้ถูกใช้กับการจองอื่นแล้ว กรุณาโหลดหน้าใหม่';
    end if;
    return jsonb_build_object('already_saved', true, 'payment', public.rental_payment_json(v_found.id),
                              'booking', public.rental_booking_json(v_found.booking_id, true));
  end if;
  perform public.rental_lock_booking(p_booking_id);
  -- ระหว่างรอล็อก เครื่องเดิมอาจบันทึกสำเร็จไปแล้ว
  select p.id into v_id from public.rental_payments as p where p.client_id = p_client_id;
  if v_id is null then
    v_id := public.rental_add_payment_core(p_booking_id, p_client_id, p_kind, p_method, p_amount, p_note);
    return jsonb_build_object('already_saved', false, 'payment', public.rental_payment_json(v_id),
                              'booking', public.rental_booking_json(p_booking_id, true));
  end if;
  return jsonb_build_object('already_saved', true, 'payment', public.rental_payment_json(v_id),
                            'booking', public.rental_booking_json(p_booking_id, true));
end;
$$;

-- ยกเลิกรายการเงิน (ไม่ลบ) — พนักงาน: เฉพาะรายการของวันนี้ / ผู้จัดการ: ทุกวัน
--   ยกเลิกแล้วยอดต้องไม่ขัดกัน (เช่น ยกเลิกรับเงินประกันที่คืนไปแล้ว → ต้องยกเลิกรายการคืนก่อน)
create or replace function public.rental_void_payment(p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_reason text;
  p public.rental_payments%rowtype;
  b public.rental_bookings;
  v_paid numeric;
  v_held numeric;
begin
  v_uid := public.rental_require(false);
  v_reason := public.rental_reason(p_reason, 'เหตุผลที่ยกเลิกรายการเงิน');
  select x.* into p from public.rental_payments as x where x.id = p_payment_id;
  if not found then
    raise exception 'ไม่พบรายการเงินนี้';
  end if;
  b := public.rental_lock_booking(p.booking_id);
  select x.* into p from public.rental_payments as x where x.id = p_payment_id for update;
  if p.voided_at is not null then
    return jsonb_build_object('already_voided', true, 'payment', public.rental_payment_json(p.id),
                              'booking', public.rental_booking_json(b.id, true));
  end if;
  if p.status <> 'confirmed' then
    raise exception 'ยกเลิกได้เฉพาะรายการเงินที่ยืนยันแล้ว (สลิปที่รอตรวจให้กด "ปฏิเสธ" แทน)';
  end if;
  if b.status = 'completed' then
    raise exception 'การจองนี้ปิดงานแล้ว ยกเลิกรายการเงินไม่ได้';
  end if;
  -- "วันของรายการ" = วันที่เงินเข้า/ออกจริง (สลิป = วันที่อนุมัติ) — วันเดียวกับเลขใบเสร็จและรายงาน
  if public.pos_bkk_day(coalesce(p.confirmed_at, p.created_at)) <> public.pos_bkk_today() and not public.rental_manager() then
    raise exception 'ยกเลิกได้เฉพาะรายการของวันนี้ (รายการวันก่อนให้ผู้จัดการร้านเช่าเป็นผู้ยกเลิก)' using errcode = '42501';
  end if;

  v_paid := b.paid - case p.kind when 'payment' then p.amount when 'security_apply' then p.amount
                                 when 'refund' then -p.amount else 0 end;
  v_held := b.security_held - case p.kind when 'security_in' then p.amount when 'security_out' then -p.amount
                                          when 'security_apply' then -p.amount else 0 end;
  if v_held < -0.005 then
    raise exception 'ยกเลิกไม่ได้: เงินประกันจะติดลบ (คืน/หักเงินประกันไปแล้ว) ต้องยกเลิกรายการคืน/หักเงินประกันก่อน';
  end if;
  if v_paid < -0.005 then
    raise exception 'ยกเลิกไม่ได้: ยอดชำระจะติดลบ (คืนเงินไปแล้ว) ต้องยกเลิกรายการคืนเงินก่อน';
  end if;

  update public.rental_payments as x
     set voided_at = now(), voided_by = v_uid, void_reason = v_reason
   where x.id = p.id;
  perform public.rental_recalc(b.id);
  perform public.rental_log(b.id, 'payment_void', jsonb_build_object('payment_id', p.id, 'receipt_no', p.receipt_no,
                                                                    'kind', p.kind, 'amount', p.amount, 'reason', v_reason));
  return jsonb_build_object('already_voided', false, 'payment', public.rental_payment_json(p.id),
                            'booking', public.rental_booking_json(b.id, true));
end;
$$;

-- ตรวจสลิปจากลูกค้า: อนุมัติ (แก้ยอดได้) / ปฏิเสธ (ต้องมีเหตุผล)
--   p_confirm_booking = true → การจองที่รอยืนยันจะถูกยืนยันอัตโนมัติ "เมื่อเงินถึงมัดจำแล้ว"
--   (ยอดในสลิปคือเงินที่เข้ามาจริง จึงอนุมัติได้แม้เกินยอดค้าง — ส่วนเกินให้บันทึกคืนเงิน)
create or replace function public.rental_review_slip(p_payment_id uuid, p_approve boolean, p_amount numeric default null,
                                                     p_reason text default null, p_confirm_booking boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  p public.rental_payments%rowtype;
  b public.rental_bookings;
  v_amount numeric;
  v_reason text;
  v_confirmed boolean := false;
  v_warning text;
begin
  v_uid := public.rental_require(false);
  perform public.rental_expire_pending();
  if p_approve is null then
    raise exception 'กรุณาเลือกอนุมัติหรือปฏิเสธ';
  end if;
  select x.* into p from public.rental_payments as x where x.id = p_payment_id;
  if not found then
    raise exception 'ไม่พบสลิปนี้';
  end if;
  b := public.rental_lock_booking(p.booking_id);
  select x.* into p from public.rental_payments as x where x.id = p_payment_id for update;
  if p.status <> 'pending_review' or p.voided_at is not null then
    raise exception 'สลิปนี้ตรวจไปแล้ว กรุณาโหลดหน้าใหม่';
  end if;

  if p_approve then
    -- ปิดงานแล้ว (ปกติเกิดไม่ได้: ปิดงานต้องตรวจสลิปให้หมดก่อน) — กันไว้อีกชั้นไม่ให้ยอดของงานที่ปิดแล้วเปลี่ยน
    if b.status = 'completed' then
      raise exception 'การจองนี้ปิดงานแล้ว อนุมัติสลิปไม่ได้ — ถ้าเงินเข้ามาจริงให้ติดต่อลูกค้าเรื่องคืนเงิน แล้วกด "ปฏิเสธ" พร้อมเหตุผล';
    end if;
    v_amount := public.rental_check_money(coalesce(p_amount, p.amount), 'ยอดเงินในสลิป', false);
    update public.rental_payments as x
       set status = 'confirmed', amount = v_amount, reviewed_by = v_uid, reviewed_at = now(), confirmed_at = now(),
           receipt_no = public.rental_next_no('rental_receipt')
     where x.id = p.id;
    perform public.rental_recalc(b.id);
    select x.* into b from public.rental_bookings as x where x.id = b.id;
    if coalesce(p_confirm_booking, true) and b.status = 'pending' and b.deposit_met then
      update public.rental_bookings as x
         set status = 'confirmed', confirmed_at = now(), expires_at = null
       where x.id = b.id;
      v_confirmed := true;
    end if;
    perform public.rental_log(b.id, 'slip_approve', jsonb_build_object('payment_id', p.id, 'claimed', p.amount,
                                                                      'amount', v_amount, 'auto_confirmed', v_confirmed,
                                                                      'booking_status', b.status));
    -- เงินเข้าการจองที่ยกเลิก/หมดเวลา/ไม่มารับ: รับเงินไว้ตามจริง แต่บอกหน้าจอให้เตือนเรื่องคืนเงิน
    if b.status in ('cancelled', 'expired', 'no_show') then
      v_warning := format('การจองนี้%s ยอดนี้ถูกบันทึกเป็นเงินที่รับไว้ — ถ้าไม่ได้ริบมัดจำ ต้องบันทึก "คืนเงิน" ให้ลูกค้า',
                          case b.status when 'cancelled' then 'ถูกยกเลิกแล้ว' when 'expired' then 'หมดเวลาถือแล้ว'
                                        else 'ถูกบันทึกว่าไม่มารับชุด' end);
    end if;
    if v_confirmed then
      perform public.rental_log(b.id, 'confirm', jsonb_build_object('by_slip', p.id, 'paid', b.paid));
    end if;
  else
    v_reason := public.rental_reason(p_reason, 'เหตุผลที่ปฏิเสธสลิป');
    update public.rental_payments as x
       set status = 'rejected', reject_reason = v_reason, reviewed_by = v_uid, reviewed_at = now()
     where x.id = p.id;
    perform public.rental_recalc(b.id);
    perform public.rental_log(b.id, 'slip_reject', jsonb_build_object('payment_id', p.id, 'amount', p.amount, 'reason', v_reason));
  end if;
  return public.rental_booking_json(b.id, true) || jsonb_build_object('review_warning', v_warning);
end;
$$;

-- =========================================================================
-- 13) ภาพรวมวันนี้ + ตัวเลขบนเมนู
-- =========================================================================
create or replace function public.rental_today(p_day date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date;
  v_start timestamptz;
  v_end timestamptz;
  v_money jsonb;
begin
  perform public.rental_require(false);
  perform public.rental_expire_pending();
  v_day := coalesce(p_day, public.pos_bkk_today());
  select x.p_start, x.p_end into v_start, v_end from public.pos_day_bounds(v_day) as x;

  -- เงินเข้า-ออกของวัน (เงินจริง: ไม่นับหักเงินประกัน, ไม่นับสลิปรอตรวจ/ถูกปฏิเสธ/ยกเลิก)
  select jsonb_build_object(
           'cash_in', coalesce(sum(p.amount) filter (where p.kind in ('payment', 'security_in')), 0),
           'cash_out', coalesce(sum(p.amount) filter (where p.kind in ('refund', 'security_out')), 0),
           'by_method', jsonb_build_object(
              'cash', coalesce(sum(case when p.kind in ('payment', 'security_in') then p.amount else -p.amount end)
                                 filter (where p.method = 'cash'), 0),
              'transfer', coalesce(sum(case when p.kind in ('payment', 'security_in') then p.amount else -p.amount end)
                                     filter (where p.method = 'transfer'), 0),
              'promptpay', coalesce(sum(case when p.kind in ('payment', 'security_in') then p.amount else -p.amount end)
                                      filter (where p.method = 'promptpay'), 0),
              'credit', coalesce(sum(case when p.kind in ('payment', 'security_in') then p.amount else -p.amount end)
                                   filter (where p.method = 'credit'), 0)))
    into v_money
    from public.rental_payments as p
   where p.confirmed_at >= v_start and p.confirmed_at < v_end
     and p.status = 'confirmed' and p.voided_at is null and p.kind <> 'security_apply';

  return jsonb_build_object(
    'day', v_day,
    'pickups', coalesce((select jsonb_agg(public.rental_booking_json(b.id, false) order by b.pickup_time nulls last, b.booking_no)
                           from public.rental_bookings as b
                          where b.pickup_date = v_day and b.status in ('pending', 'confirmed', 'picked_up')), '[]'::jsonb),
    'returns', coalesce((select jsonb_agg(public.rental_booking_json(b.id, false) order by b.booking_no)
                           from public.rental_bookings as b
                          where b.return_date = v_day and b.status in ('picked_up', 'returned')), '[]'::jsonb),
    'overdue', coalesce((select jsonb_agg(public.rental_booking_json(b.id, false)
                                          || jsonb_build_object('days_late', v_day - b.return_date)
                                          order by b.return_date, b.booking_no)
                           from public.rental_bookings as b
                          where b.status = 'picked_up' and b.return_date < v_day), '[]'::jsonb),
    'pending_online', coalesce((select jsonb_agg(public.rental_booking_json(b.id, false) order by b.expires_at nulls last, b.booking_no)
                                  from public.rental_bookings as b
                                 where b.status = 'pending' and b.source = 'online'), '[]'::jsonb),
    'slips_to_review', (select count(*) from public.rental_payments as p
                         where p.status = 'pending_review' and p.voided_at is null),
    'fittings', coalesce((select jsonb_agg(public.rental_booking_json(b.id, false) order by b.fitting_time nulls last, b.booking_no)
                            from public.rental_bookings as b
                           where b.fitting_date = v_day and b.status in ('pending', 'confirmed', 'picked_up')), '[]'::jsonb),
    'units_need_cleaning', coalesce((select jsonb_agg(jsonb_build_object('unit_id', u.id, 'unit_code', u.unit_code,
                                                                         'item_name', i.name, 'size', u.size)
                                                      order by u.unit_code)
                                       from public.rental_units as u
                                       join public.rental_items as i on i.id = u.item_id
                                      where u.needs_cleaning and u.status <> 'retired'), '[]'::jsonb),
    'maintenance_conflicts', coalesce((select jsonb_agg(jsonb_build_object('unit_id', u.id, 'unit_code', u.unit_code,
                                                                           'unit_status', u.status, 'item_name', i.name,
                                                                           'booking_id', b.id, 'booking_no', b.booking_no,
                                                                           'pickup_date', b.pickup_date)
                                                        order by b.pickup_date, b.booking_no)
                                         from public.rental_booking_lines as l
                                         join public.rental_bookings as b on b.id = l.booking_id
                                         join public.rental_units as u on u.id = l.unit_id
                                         join public.rental_items as i on i.id = u.item_id
                                        where l.blocking and u.status <> 'available'
                                          and b.status in ('pending', 'confirmed')), '[]'::jsonb),
    -- การจองที่รอรับชุดซึ่งชิ้นยังอยู่กับลูกค้าที่คืนช้า (จองไว้ก่อนลูกค้าคนก่อนเลยกำหนด) — ต้องตามชุดคืนหรือสลับชิ้น
    'overdue_conflicts', coalesce((select jsonb_agg(jsonb_build_object('unit_id', u.id, 'unit_code', u.unit_code,
                                                                       'item_name', i.name,
                                                                       'booking_id', b.id, 'booking_no', b.booking_no,
                                                                       'pickup_date', b.pickup_date,
                                                                       'out_booking_id', ob.id, 'out_booking_no', ob.booking_no,
                                                                       'out_return_date', ob.return_date)
                                                    order by b.pickup_date, b.booking_no, u.unit_code)
                                     from public.rental_booking_lines as l
                                     join public.rental_bookings as b on b.id = l.booking_id
                                     join public.rental_units as u on u.id = l.unit_id
                                     join public.rental_items as i on i.id = u.item_id
                                     join public.rental_booking_lines as ol
                                       on ol.unit_id = l.unit_id and ol.booking_id <> l.booking_id and ol.status = 'picked_up'
                                     join public.rental_bookings as ob on ob.id = ol.booking_id
                                    where l.blocking and l.status = 'booked'
                                      and b.status in ('pending', 'confirmed')
                                      and public.rental_line_busy_range(ol.block_range, ol.status, ol.item_id) && l.block_range),
                                  '[]'::jsonb),
    'money_today', v_money,
    'security_held_total', (select coalesce(sum(b.security_held), 0) from public.rental_bookings as b),
    'upcoming_7d', jsonb_build_object(
       'pickups', (select count(*) from public.rental_bookings as b
                    where b.pickup_date between v_day + 1 and v_day + 7 and b.status in ('pending', 'confirmed')),
       'returns', (select count(*) from public.rental_bookings as b
                    where b.return_date between v_day + 1 and v_day + 7 and b.status in ('confirmed', 'picked_up'))));
end;
$$;

create or replace function public.rental_badges()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.rental_require(false);
  perform public.rental_expire_pending();
  return jsonb_build_object(
    'pending_online', (select count(*) from public.rental_bookings as b where b.status = 'pending' and b.source = 'online'),
    'slips', (select count(*) from public.rental_payments as p where p.status = 'pending_review' and p.voided_at is null),
    'overdue', (select count(*) from public.rental_bookings as b
                 where b.status = 'picked_up' and b.return_date < public.pos_bkk_today()));
end;
$$;

-- =========================================================================
-- 14) สิทธิ์เรียกฟังก์ชัน: ฟังก์ชันของหน้าจอ = ผู้ใช้ที่ล็อกอิน (ตรวจสิทธิ์ร้านเช่าข้างใน) / ตัวช่วย = ไม่มีใครเรียกตรงได้
-- =========================================================================
revoke all on function public.rental_touch() from public, anon, authenticated;
revoke all on function public.rental_require(boolean) from public, anon, authenticated;
revoke all on function public.rental_settings_row() from public, anon, authenticated;
revoke all on function public.rental_days(date, date) from public, anon, authenticated;
revoke all on function public.rental_line_price(numeric, integer, numeric, integer) from public, anon, authenticated;
revoke all on function public.rental_item_buffers(uuid) from public, anon, authenticated;
revoke all on function public.rental_block_range(uuid, date, date) from public, anon, authenticated;
revoke all on function public.rental_line_busy_range(daterange, text, uuid) from public, anon, authenticated;
revoke all on function public.rental_unit_free(uuid, daterange, uuid) from public, anon, authenticated;
revoke all on function public.rental_baht(numeric) from public, anon, authenticated;
revoke all on function public.rental_thai_date(date) from public, anon, authenticated;
revoke all on function public.rental_status_label(text) from public, anon, authenticated;
revoke all on function public.rental_json_text(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public.rental_json_int(jsonb, text, integer, integer) from public, anon, authenticated;
revoke all on function public.rental_json_date(jsonb, text) from public, anon, authenticated;
revoke all on function public.rental_check_money(numeric, text, boolean) from public, anon, authenticated;
revoke all on function public.rental_json_money(jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public.rental_json_phone(jsonb, text) from public, anon, authenticated;
revoke all on function public.rental_reason(text, text) from public, anon, authenticated;
revoke all on function public.rental_log(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.rental_next_no(text) from public, anon, authenticated;
revoke all on function public.rental_expire_pending() from public, anon, authenticated;
revoke all on function public.rental_conflict_text(uuid, daterange, uuid) from public, anon, authenticated;
revoke all on function public.rental_recalc(uuid) from public, anon, authenticated;
revoke all on function public.rental_lock_booking(uuid) from public, anon, authenticated;
revoke all on function public.rental_settings_json() from public, anon, authenticated;
revoke all on function public.rental_unit_json(uuid) from public, anon, authenticated;
revoke all on function public.rental_item_json(uuid, boolean) from public, anon, authenticated;
revoke all on function public.rental_customer_json(uuid) from public, anon, authenticated;
revoke all on function public.rental_payment_json(uuid) from public, anon, authenticated;
revoke all on function public.rental_late_info(uuid) from public, anon, authenticated;
revoke all on function public.rental_booking_json(uuid, boolean) from public, anon, authenticated;
revoke all on function public.rental_customer_write(uuid, jsonb, text, boolean, uuid) from public, anon, authenticated;
revoke all on function public.rental_blacklist_phone_match(uuid) from public, anon, authenticated;
revoke all on function public.rental_read_head(jsonb, public.rental_bookings) from public, anon, authenticated;
revoke all on function public.rental_resolve_lines(jsonb, date, date, uuid, boolean, integer) from public, anon, authenticated;
revoke all on function public.rental_write_lines(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.rental_create_core(uuid, jsonb, uuid, text, text, integer, text, integer) from public, anon, authenticated;
revoke all on function public.rental_add_payment_core(uuid, uuid, text, text, numeric, text, text, text, text) from public, anon, authenticated;
revoke all on function public.rental_insert_charge(uuid, uuid, text, text, numeric) from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.rental_get_settings()',
    'public.rental_save_settings(jsonb)',
    'public.rental_save_category(uuid, text, integer, boolean)',
    'public.rental_delete_category(uuid)',
    'public.rental_save_item(jsonb, jsonb)',
    'public.rental_get_item(uuid)',
    'public.rental_delete_item(uuid)',
    'public.rental_set_item_active(uuid, boolean)',
    'public.rental_add_item_image(uuid, text, integer, integer)',
    'public.rental_delete_item_image(uuid)',
    'public.rental_reorder_item_images(uuid, uuid[])',
    'public.rental_set_unit_status(uuid, text, text)',
    'public.rental_mark_unit_clean(uuid)',
    'public.rental_save_customer(jsonb)',
    'public.rental_get_customer(uuid)',
    'public.rental_find_units(date, date, uuid[], text, uuid, uuid)',
    'public.rental_item_calendar(uuid, date, date)',
    'public.rental_schedule(date, date)',
    'public.rental_quote(jsonb)',
    'public.rental_create_booking(uuid, jsonb)',
    'public.rental_update_booking(uuid, timestamptz, jsonb)',
    'public.rental_get_booking(uuid)',
    'public.rental_confirm_booking(uuid)',
    'public.rental_extend_hold(uuid, integer, uuid)',
    'public.rental_cancel_booking(uuid, text)',
    'public.rental_mark_no_show(uuid, text)',
    'public.rental_pickup(uuid, jsonb)',
    'public.rental_extend(uuid, date, boolean)',
    'public.rental_return(uuid, jsonb)',
    'public.rental_add_charge(uuid, text, text, numeric, uuid, uuid)',
    'public.rental_void_charge(uuid, text)',
    'public.rental_complete(uuid)',
    'public.rental_add_payment(uuid, uuid, text, text, numeric, text)',
    'public.rental_void_payment(uuid, text)',
    'public.rental_review_slip(uuid, boolean, numeric, text, boolean)',
    'public.rental_today(date)',
    'public.rental_badges()'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;

-- =========================================================================
-- 15) Supabase Storage
--     rental-images (สาธารณะ — หน้าจองออนไลน์ดูรูปได้): อัปโหลด/แทนที่/ลบ = ผู้จัดการร้านเช่า, ไฟล์ '<item_id>/<ชื่อไฟล์>'
--     rental-slips  (ส่วนตัว — สลิปโอนเงินของลูกค้า): ดู/อัปโหลด = พนักงานร้านเช่า, ไฟล์ '<booking_id>/<ชื่อไฟล์>'
--       (ลูกค้าอัปโหลดผ่าน API ของแอปด้วย service role — anon แตะถังนี้ไม่ได้เลย)
-- =========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rental-images', 'rental-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rental-slips', 'rental-slips', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "rental_images_objects_select" on storage.objects;
create policy "rental_images_objects_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'rental-images' and (select public.rental_staff()));

drop policy if exists "rental_images_objects_insert" on storage.objects;
create policy "rental_images_objects_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'rental-images'
    and (select public.rental_manager())
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
    and split_part(name, '/', 1) in (select i.id::text from public.rental_items as i)
  );

drop policy if exists "rental_images_objects_update" on storage.objects;
create policy "rental_images_objects_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'rental-images' and (select public.rental_manager()))
  with check (
    bucket_id = 'rental-images'
    and (select public.rental_manager())
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
    and split_part(name, '/', 1) in (select i.id::text from public.rental_items as i)
  );

drop policy if exists "rental_images_objects_delete" on storage.objects;
create policy "rental_images_objects_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'rental-images' and (select public.rental_manager()));

drop policy if exists "rental_slips_objects_select" on storage.objects;
create policy "rental_slips_objects_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'rental-slips' and (select public.rental_staff()));

drop policy if exists "rental_slips_objects_insert" on storage.objects;
create policy "rental_slips_objects_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'rental-slips'
    and (select public.rental_staff())
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
    and split_part(name, '/', 1) in (select b.id::text from public.rental_bookings as b)
  );

-- =========================================================================
-- 16) ให้ API (PostgREST) โหลดโครงสร้างใหม่ทันที
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
-- (ข) การจอง 20 รายการล่าสุด
-- select b.booking_no, b.status, b.pickup_date, b.return_date, b.grand_total, b.paid, b.due, b.security_held, b.created_at
--   from public.rental_bookings as b
--  order by b.created_at desc
--  limit 20;
--
-- (ค) ให้สิทธิ์ร้านเช่าแก่ผู้ใช้ (ปกติใช้หน้า "ผู้ใช้งาน" ในแอป)
-- update public.user_profiles
--    set permissions = coalesce(permissions, '{}'::jsonb) || '{"rental": true}'::jsonb
--  where id = '<uuid ผู้ใช้>';

-- (ก) สรุประบบร้านเช่าชุด (อ่านอย่างเดียว)
select x.item as "รายการ", x.value as "ค่า"
  from (values
    (1, 'ตารางของร้านเช่าชุด',
        (select count(*)::text || ' / 11'
           from unnest(array['rental_settings', 'rental_categories', 'rental_items', 'rental_item_images', 'rental_units',
                             'rental_customers', 'rental_bookings', 'rental_booking_lines', 'rental_charges',
                             'rental_payments', 'rental_logs']) as t(name)
          where to_regclass('public.' || t.name) is not null)),
    (2, 'กันจองซ้อน (btree_gist + exclusion constraint)',
        (select case when exists (select 1 from pg_extension as e where e.extname = 'btree_gist')
                      and exists (select 1 from pg_constraint as c where c.conname = 'rental_lines_no_overlap'
                                     and c.contype = 'x')
                     then 'พร้อม' else 'ยังไม่พร้อม — รันไฟล์นี้ซ้ำ' end)),
    (3, 'ฟังก์ชันของหน้าจอ (เรียกได้ / ทั้งหมด)',
        (select count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                   and not has_function_privilege('anon', p.oid, 'EXECUTE'))::text
                || ' / ' || count(*)::text
           from pg_proc as p
          where p.pronamespace = 'public'::regnamespace
            and p.proname in ('rental_get_settings', 'rental_save_settings', 'rental_save_category', 'rental_delete_category',
                              'rental_save_item', 'rental_get_item', 'rental_delete_item', 'rental_set_item_active',
                              'rental_add_item_image', 'rental_delete_item_image', 'rental_reorder_item_images',
                              'rental_set_unit_status', 'rental_mark_unit_clean', 'rental_save_customer',
                              'rental_get_customer', 'rental_find_units', 'rental_item_calendar', 'rental_schedule',
                              'rental_quote', 'rental_create_booking', 'rental_update_booking', 'rental_get_booking',
                              'rental_confirm_booking', 'rental_extend_hold', 'rental_cancel_booking',
                              'rental_mark_no_show', 'rental_pickup', 'rental_extend', 'rental_return',
                              'rental_add_charge', 'rental_void_charge', 'rental_complete', 'rental_add_payment',
                              'rental_void_payment', 'rental_review_slip', 'rental_today', 'rental_badges'))),
    (4, 'พนักงานร้านเช่าอย่างเดียวอ่านข้อมูล NEWCUTE ไม่ได้ (is_member ไม่มีคีย์ร้านเช่า)',
        (select case when pg_get_functiondef('public.is_member()'::regprocedure) not like '%''rental%'
                     then 'ถูกต้อง' else 'ผิด — รันไฟล์นี้ซ้ำ' end)),
    (5, 'ถังไฟล์ rental-images / rental-slips',
        (select count(*)::text || ' / 2' from storage.buckets as b where b.id in ('rental-images', 'rental-slips'))),
    (6, 'ชื่อร้านเช่าชุด',
        (select coalesce(max(s.shop_name), '-') from public.rental_settings as s)),
    (7, 'ชุด / ชิ้น / การจอง',
        (select (select count(*) from public.rental_items)::text || ' / '
                || (select count(*) from public.rental_units)::text || ' / '
                || (select count(*) from public.rental_bookings)::text))
  ) as x(ord, item, value)
 order by x.ord;
