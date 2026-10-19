-- =========================================================================
-- supabase-fix-06-rental-online.sql — ร้านเช่าชุด: หน้าจองออนไลน์ (ลิงก์สาธารณะ /book) + รายงาน + ส่งออก CSV
--
-- ไฟล์นี้ทำอะไร
--   1) ฟังก์ชันสำหรับหน้าจองออนไลน์ (ลูกค้าเปิดได้โดยไม่ต้องล็อกอิน — anon เรียกได้)
--        rental_public_info          ข้อมูลร้าน/เงื่อนไขการจอง/หมวด (ชื่อร้านอ่านจากตั้งค่าเสมอ)
--        rental_public_catalog       รายการชุดที่เปิดให้จองออนไลน์ (+ ว่างหรือไม่ เมื่อเลือกวันมาแล้ว)
--        rental_public_item          รายละเอียดชุด 1 แบบ + รูป + ไซส์ + เครื่องประดับแนะนำ
--        rental_public_availability  ปฏิทินว่างรายวันแยกไซส์ (นับรวมวันเตรียม/ซักชุด)
--        rental_public_request       ส่งคำขอจอง → สถานะ "รอยืนยัน" + ลิงก์ติดตามสถานะ (token 64 ตัวอักษร)
--                                    ** เรียกได้เฉพาะ service role ผ่าน API ของแอป /api/book/request (จำกัดจำนวนครั้งต่อ IP ก่อนถึงฐานข้อมูล)
--        rental_public_booking       หน้าติดตามสถานะของลูกค้า (เฉพาะผู้ถือลิงก์ — ชื่อ/เบอร์แสดงแบบปิดบางส่วน)
--        rental_public_cancel        ลูกค้ายกเลิกคำขอที่ยังรอยืนยันและยังไม่ได้ชำระเงิน
--      ไม่มีฟังก์ชันไหนคืนข้อมูลลูกค้าคนอื่น / เลขบัตร / ที่อยู่ / เบอร์เต็ม / รหัสชิ้นจริง / เลขการจองของคนอื่น
--      anon ยังอ่านตารางร้านเช่าตรงๆ ไม่ได้เลย (ตั้งไว้ใน fix-05 — ไฟล์นี้ไม่เปิดสิทธิ์ตารางใดเพิ่ม)
--   2) rental_public_add_slip — บันทึกสลิปโอนเงินของลูกค้า: เรียกได้เฉพาะ service role (API ของแอป /api/book/slip)
--      rental_rate_hit + ตาราง rental_rate_hits — ตัวนับจำนวนครั้งต่อ IP (แบบแฮช ไม่เก็บ IP จริง) ของ API ทั้งสองเส้น
--      สลิปเป็น "รอตรวจ" ไม่นับเป็นเงินจนพนักงานอนุมัติ (rental_review_slip ของ fix-05)
--   3) รายงานร้านเช่า (ผู้จัดการร้านเช่า): rental_report + ส่งออก CSV rental_export_bookings / rental_export_payments
--   4) (ไม่บังคับ) ตัวอย่างตั้งเวลาให้ระบบปล่อยการจองที่หมดเวลาถือทุก 10 นาที — อยู่ท้ายไฟล์ แบบคอมเมนต์ไว้
--
-- วิธีใช้: Supabase > SQL Editor > วางทั้งไฟล์ > กด Run
--   - ต้องรัน supabase-fix-05-rental.sql มาก่อนแล้ว (ไฟล์นี้ตรวจให้ ถ้ายังไม่ได้รันจะหยุดทันทีโดยไม่แก้อะไร)
--   - รันซ้ำได้ปลอดภัย (ทั้งไฟล์สำเร็จทั้งหมดหรือไม่เปลี่ยนอะไรเลย)
--   - ถ้ารัน supabase-fix-05-rental.sql ซ้ำภายหลัง ไม่ต้องรันไฟล์นี้ซ้ำ (ฟังก์ชันของไฟล์นี้ยังอยู่ครบ) แต่รันซ้ำก็ไม่เสียหาย
--   - รันเสร็จแล้ว SQL Editor จะแสดงตารางสรุป — ดูหัวข้อ "ตรวจสอบหลังรัน" ท้ายไฟล์
-- =========================================================================

begin;

-- =========================================================================
-- 0) ตรวจของที่ต้องมีก่อน (fix-05: ตาราง/ตัวช่วยร้านเช่า / fix-04: ตรวจช่วงวันที่/หน้าส่งออก)
-- =========================================================================
do $$
begin
  if to_regclass('public.rental_bookings') is null
     or to_regclass('public.rental_payments') is null
     or to_regclass('public.rental_settings') is null
     or to_regprocedure('public.rental_require(boolean)') is null
     or to_regprocedure('public.rental_create_core(uuid, jsonb, uuid, text, text, integer, text, integer)') is null
     or to_regprocedure('public.rental_add_payment_core(uuid, uuid, text, text, numeric, text, text, text, text)') is null
     or to_regprocedure('public.rental_customer_write(uuid, jsonb, text, boolean, uuid)') is null
     or to_regprocedure('public.rental_booking_json(uuid, boolean)') is null
     or to_regprocedure('public.rental_expire_pending()') is null
     or to_regprocedure('public.rental_lock_booking(uuid)') is null
     or to_regprocedure('public.rental_recalc(uuid)') is null
     or to_regprocedure('public.rental_log(uuid, text, jsonb, text)') is null
     or to_regprocedure('public.rental_block_range(uuid, date, date)') is null
     or to_regprocedure('public.rental_item_buffers(uuid)') is null
     or to_regprocedure('public.pos_check_range(date, date)') is null
     or to_regprocedure('public.pos_check_page(integer, integer)') is null then
    raise exception 'ต้องรัน supabase-fix-05-rental.sql ให้เสร็จก่อน แล้วค่อยรันไฟล์นี้ (ยังไม่ได้แก้อะไรในฐานข้อมูล)';
  end if;
  -- fix-05 รุ่นใหม่ (ชิ้นที่ลูกค้ายังไม่คืน = ไม่ว่าง, วันที่เงินเข้า, ชื่อที่ลูกค้าพิมพ์) — รุ่นเก่า: ให้รัน fix-05 ซ้ำก่อน
  if to_regprocedure('public.rental_unit_free(uuid, daterange, uuid)') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'rental_payments' and column_name = 'confirmed_at')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'rental_bookings' and column_name = 'online_name') then
    raise exception 'supabase-fix-05-rental.sql ในฐานข้อมูลเป็นรุ่นเก่า กรุณารัน supabase-fix-05-rental.sql (รุ่นล่าสุด) ซ้ำก่อน แล้วค่อยรันไฟล์นี้ (ยังไม่ได้แก้อะไรในฐานข้อมูล)';
  end if;
end
$$;

-- =========================================================================
-- 1) ตัวช่วยภายใน (เรียกจาก API ไม่ได้)
-- =========================================================================

-- ชื่อแบบปิดบางส่วน: 'สมหญิง ใจดี' → 'สม*** ใ.' (หน้าสถานะเปิดได้ด้วยลิงก์ — ถ้าลิงก์หลุด คนอื่นไม่เห็นชื่อเต็ม)
create or replace function public.rental_mask_name(p_name text)
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

-- เบอร์แบบปิดบางส่วน: '0812345678' → '08xxxx5678'
create or replace function public.rental_mask_phone(p_phone text)
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

create or replace function public.rental_kind_label(p_kind text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case p_kind
           when 'payment' then 'ชำระเงิน'
           when 'refund' then 'คืนเงิน'
           when 'security_in' then 'เงินประกันชุด'
           when 'security_out' then 'คืนเงินประกันชุด'
           when 'security_apply' then 'หักจากเงินประกันชุด'
           else coalesce(p_kind, '-')
         end
$$;

create or replace function public.rental_method_label(p_method text)
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
           when 'none' then 'หักจากเงินประกัน'
           else coalesce(p_method, '-')
         end
$$;

create or replace function public.rental_source_label(p_source text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case p_source
           when 'walkin' then 'หน้าร้าน'
           when 'online' then 'จองออนไลน์'
           when 'phone' then 'โทรศัพท์'
           when 'line' then 'LINE'
           when 'other' then 'อื่นๆ'
           else coalesce(p_source, '-')
         end
$$;

-- หน้าจองออนไลน์ปิดอยู่ → หยุดพร้อมข้อความเดียวกันทุกฟังก์ชัน (หน้าเว็บแสดงช่องทางติดต่อแทน)
create or replace function public.rental_public_require_open()
returns public.rental_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.rental_settings;
begin
  s := public.rental_settings_row();
  if not coalesce(s.online_enabled, false) then
    raise exception 'ร้านปิดรับจองออนไลน์ชั่วคราว กรุณาติดต่อร้านโดยตรง';
  end if;
  return s;
end;
$$;

-- ช่วงวันที่ที่ลูกค้าเลือกบนหน้าจองออนไลน์ (วันรับ ≥ วันนี้ + จองล่วงหน้าขั้นต่ำ, จำนวนวัน 1..สูงสุดของร้าน)
create or replace function public.rental_public_check_dates(p_pickup date, p_return date, s public.rental_settings)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := public.pos_bkk_today();
  v_days integer;
begin
  if p_pickup is null or p_return is null then
    raise exception 'กรุณาเลือกทั้งวันรับชุดและวันคืนชุด';
  end if;
  if p_return < p_pickup then
    raise exception 'วันคืนชุดต้องไม่ก่อนวันรับชุด';
  end if;
  if p_pickup < v_today + s.online_min_lead_days then
    if s.online_min_lead_days = 0 then
      raise exception 'วันรับชุดต้องไม่ก่อนวันนี้';
    end if;
    raise exception 'จองออนไลน์ต้องจองล่วงหน้าอย่างน้อย % วัน (รับชุดได้ตั้งแต่ %)',
      s.online_min_lead_days, public.rental_thai_date(v_today + s.online_min_lead_days);
  end if;
  if p_pickup > v_today + 730 then
    raise exception 'จองล่วงหน้าได้ไม่เกิน 2 ปี';
  end if;
  v_days := public.rental_days(p_pickup, p_return);
  if v_days > s.online_max_days then
    raise exception 'จองออนไลน์ได้ไม่เกิน % วันต่อครั้ง (เลือกไว้ % วัน) ถ้าต้องการเช่านานกว่านี้กรุณาติดต่อร้าน',
      s.online_max_days, v_days;
  end if;
  return v_days;
end;
$$;

-- ลิงก์สถานะ → id การจอง (token = 64 ตัวอักษร 0-9a-f; ผิดรูปแบบ/ไม่พบ = ข้อความเดียวกัน ไม่บอกว่ามีหรือไม่มี)
create or replace function public.rental_public_find(p_token text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_token text := lower(btrim(coalesce(p_token, '')));
  v_id uuid;
begin
  if v_token !~ '^[0-9a-f]{64}$' then
    raise exception 'ไม่พบการจองนี้ กรุณาตรวจลิงก์อีกครั้ง';
  end if;
  select b.id into v_id from public.rental_bookings as b where b.public_token = v_token;
  if v_id is null then
    raise exception 'ไม่พบการจองนี้ กรุณาตรวจลิงก์อีกครั้ง';
  end if;
  return v_id;
end;
$$;

-- ข้อมูลหน้าสถานะของลูกค้า (เฉพาะสิ่งที่ลูกค้าควรเห็น — ไม่มี id ลูกค้า/เลขบัตร/ที่อยู่/รหัสชิ้นจริง/บันทึกภายในร้าน)
create or replace function public.rental_public_booking_json(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.rental_bookings%rowtype;
  c public.rental_customers%rowtype;
  s public.rental_settings;
  v_pending numeric;
  v_slips integer;
  v_slips_all integer;
begin
  select x.* into b from public.rental_bookings as x where x.id = p_booking_id;
  if not found then
    return null;
  end if;
  select x.* into c from public.rental_customers as x where x.id = b.customer_id;
  select x.* into s from public.rental_settings as x where x.id;

  select coalesce(sum(p.amount) filter (where p.status = 'pending_review' and p.voided_at is null), 0),
         -- สลิปที่ร้านปฏิเสธ/ยกเลิกรายการไม่นับในโควตา 5 ใบ (ลูกค้าส่งใบที่ชัดกว่าได้)
         count(*) filter (where p.slip_path is not null and p.voided_at is null
                            and p.status in ('pending_review', 'confirmed')),
         -- แต่รวมทุกใบที่เคยส่ง (ทุกสถานะ รวมที่ยกเลิกรายการ) ไม่เกิน 10 ครั้ง — นับแบบเดียวกับ rental_public_add_slip / /api/book/slip
         count(*) filter (where p.slip_path is not null)
    into v_pending, v_slips, v_slips_all
    from public.rental_payments as p
   where p.booking_id = b.id;

  return jsonb_build_object(
    'booking_no', b.booking_no,
    'status', b.status,
    'status_label', public.rental_status_label(b.status),
    'shop_name', s.shop_name,
    -- ชื่อที่ผู้ส่งคำขอพิมพ์เอง (ไม่ใช่ชื่อที่ร้านบันทึกไว้ของเบอร์นั้น — คนที่ใส่เบอร์คนอื่นจะไม่เห็นชื่อเจ้าของเบอร์)
    'customer_name_masked', public.rental_mask_name(coalesce(b.online_name, c.name)),
    'phone_masked', public.rental_mask_phone(c.phone),
    'pickup_date', b.pickup_date,
    'return_date', b.return_date,
    'days', public.rental_days(b.pickup_date, b.return_date),
    'event_date', b.event_date,
    'lines', coalesce((
       select jsonb_agg(jsonb_build_object(
                'item_name', i.name, 'item_code', i.code, 'size', l.size, 'rent_price', l.rent_price,
                'deposit', l.deposit,
                'cover_path', (select im.path from public.rental_item_images as im where im.item_id = i.id
                                order by im.sort_order, im.created_at, im.id limit 1))
              order by l.sort_order, l.id)
         from public.rental_booking_lines as l
         join public.rental_items as i on i.id = l.item_id
        where l.booking_id = b.id), '[]'::jsonb),
    'money', jsonb_build_object(
       'rent_total', b.rent_total, 'discount', b.discount, 'delivery_fee', b.delivery_fee,
       'charges_total', b.charges_total, 'grand_total', b.grand_total, 'paid', b.paid, 'due', b.due,
       'deposit_required', b.deposit_required, 'deposit_met', b.deposit_met,
       -- ยอดที่ควรโอนตอนนี้เพื่อให้ครบมัดจำ (ไม่หักสลิปที่รอตรวจ — หน้าเว็บแสดงยอดรอตรวจแยกให้เห็นเอง)
       'deposit_due', greatest(b.deposit_required - b.paid, 0),
       'security_required', b.security_required, 'pending_review_total', v_pending),
    'payments', coalesce((
       select jsonb_agg(jsonb_build_object(
                'created_at', p.created_at, 'amount', p.amount, 'status', p.status,
                'status_label', case p.status when 'confirmed' then 'ร้านรับเงินแล้ว'
                                              when 'pending_review' then 'รอร้านตรวจสลิป'
                                              when 'rejected' then 'สลิปไม่ผ่านการตรวจ กรุณาติดต่อร้าน'
                                              else p.status end,
                'kind', p.kind, 'kind_label', public.rental_kind_label(p.kind))
              order by p.created_at, p.id)
         from public.rental_payments as p
        where p.booking_id = b.id and p.voided_at is null), '[]'::jsonb),
    'expires_at', case when b.status = 'pending' then b.expires_at end,
    'payment_info', jsonb_build_object('promptpay_id', s.promptpay_id, 'promptpay_name', s.promptpay_name,
                                       'bank_accounts', coalesce(s.bank_accounts, '[]'::jsonb)),
    'slips_count', v_slips,
    'slips_max', 5,
    'can_upload_slip', b.status in ('pending', 'confirmed') and v_slips < 5 and v_slips_all < 10,
    'can_cancel', b.status = 'pending' and b.paid <= 0.005 and v_pending <= 0.005,
    'contact', jsonb_build_object('phone', s.phone, 'line_id', s.line_id, 'line_url', s.line_url),
    'created_at', b.created_at, 'confirmed_at', b.confirmed_at, 'picked_up_at', b.picked_up_at,
    'returned_at', b.returned_at, 'completed_at', b.completed_at, 'cancelled_at', b.cancelled_at);
end;
$$;

-- ชุดที่ลูกค้าเห็นได้: เปิดให้เช่า + แสดงบนหน้าจองออนไลน์ + มีชิ้นพร้อมให้เช่าอย่างน้อย 1 ชิ้น
create or replace function public.rental_public_item_ok(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.rental_items as i
     where i.id = p_item_id and i.is_active and i.is_public
       and exists (select 1 from public.rental_units as u where u.item_id = i.id and u.status = 'available'))
$$;

-- ----- ตัวนับจำนวนครั้งต่อผู้ส่ง (API /api/book/request และ /api/book/slip เรียกด้วย service role) -----
--   bucket = '<ชื่อด่าน>:<แฮชของ IP>' (เซิร์ฟเวอร์แฮชก่อนส่ง — ไม่มี IP จริงในฐานข้อมูล) · นับเป็นช่วงเวลาคงที่ p_window_seconds
--   กันสคริปต์ยิงคำขอจองถือชุดทั้งร้าน/ส่งสลิปถล่ม — ตั้งค่าเผื่อเน็ตมือถือที่หลายเครื่องใช้ IP เดียวกัน
--   ไม่มีใครอ่าน/เขียนตารางนี้ผ่าน API ได้ (RLS เปิด ไม่มีนโยบาย ไม่ให้สิทธิ์ตาราง)
create table if not exists public.rental_rate_hits (
  bucket text not null check (char_length(bucket) between 1 and 100),
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (bucket, window_start)
);
create index if not exists idx_rental_rate_hits_window on public.rental_rate_hits (window_start);
alter table public.rental_rate_hits enable row level security;
revoke all on table public.rental_rate_hits from public, anon, authenticated;

-- นับ 1 ครั้ง แล้วคืน true = ยังไม่เกิน p_limit ในช่วงเวลานี้ / false = เกินแล้ว (ให้ API ตอบ "ส่งบ่อยเกินไป")
create or replace function public.rental_rate_hit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_hits integer;
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'เรียกได้จาก API ของแอปเท่านั้น' using errcode = '42501';
  end if;
  if p_bucket is null or char_length(p_bucket) not between 1 and 100
     or p_limit is null or p_limit < 1 or p_limit > 100000
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'ค่าที่ใช้จำกัดจำนวนครั้งไม่ถูกต้อง';
  end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rental_rate_hits as r (bucket, window_start, hits)
  values (p_bucket, v_start, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  -- ล้างช่วงเวลาที่เก่ากว่า 2 วัน (มีดัชนี — ส่วนใหญ่ไม่มีแถวให้ลบ)
  delete from public.rental_rate_hits as r where r.window_start < now() - interval '2 days';
  return v_hits <= p_limit;
end;
$$;

-- =========================================================================
-- 2) หน้าจองออนไลน์ (anon เรียกได้ — ยกเว้นส่งคำขอจอง: ผ่าน API ของแอป)
-- =========================================================================

-- ข้อมูลร้าน + เงื่อนไขการจอง (ทำงานแม้ปิดจองออนไลน์ — หน้าเว็บใช้แสดงช่องทางติดต่อ)
create or replace function public.rental_public_info()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.rental_settings;
begin
  s := public.rental_settings_row();
  return jsonb_build_object(
    'online_enabled', s.online_enabled, 'shop_name', s.shop_name, 'tagline', s.tagline, 'address', s.address,
    'phone', s.phone, 'line_id', s.line_id, 'line_url', s.line_url, 'facebook_url', s.facebook_url,
    'opening_hours', s.opening_hours, 'online_notice', s.online_notice, 'terms_text', s.terms_text,
    'booking_deposit_percent', s.booking_deposit_percent, 'min_booking_deposit', s.min_booking_deposit,
    'online_min_lead_days', s.online_min_lead_days, 'online_max_days', s.online_max_days,
    'online_hold_hours', s.online_hold_hours, 'default_base_days', s.default_base_days,
    'today', public.pos_bkk_today(),
    -- เฉพาะหมวดที่เปิดอยู่และมีชุดให้ลูกค้าเห็นอย่างน้อย 1 แบบ (ไม่มีปุ่มหมวดที่กดแล้วว่าง)
    'categories', coalesce((
       select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort_order, c.name)
         from public.rental_categories as c
        where c.is_active
          and exists (select 1 from public.rental_items as i
                       where i.category_id = c.id and public.rental_public_item_ok(i.id))), '[]'::jsonb));
end;
$$;

-- รายการชุด — p_size: ตรงไซส์ (ไม่สนตัวพิมพ์) หรือชุดฟรีไซส์ / วันที่: ต้องส่งคู่กัน (ไม่ส่ง = ไม่คำนวณความว่าง)
create or replace function public.rental_public_catalog(p_category_id uuid default null, p_search text default null,
                                                        p_pickup date default null, p_return date default null,
                                                        p_size text default null, p_include_accessories boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.rental_settings;
  v_days integer;
  v_dates boolean := p_pickup is not null or p_return is not null;
  v_q text;
  v_size text;
  v_items jsonb;
begin
  s := public.rental_public_require_open();
  perform public.rental_expire_pending();
  if v_dates then
    v_days := public.rental_public_check_dates(p_pickup, p_return, s);
  end if;
  v_q := left(nullif(public.product_clean_text(p_search), ''), 100);
  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  v_size := left(nullif(public.product_clean_text(p_size), ''), 20);

  select coalesce(jsonb_agg(x.j order by x.is_accessory, x.cat_sort, x.code), '[]'::jsonb) into v_items
    from (
      select i.is_accessory, coalesce(c.sort_order, 2147483647) as cat_sort, i.code,
             jsonb_build_object(
               'id', i.id, 'code', i.code, 'name', i.name, 'category_name', c.name, 'color', i.color,
               'is_accessory', i.is_accessory,
               'base_price', i.base_price, 'base_days', i.base_days, 'extra_day_price', i.extra_day_price,
               'security_deposit', i.security_deposit,
               'cover_path', (select im.path from public.rental_item_images as im where im.item_id = i.id
                               order by im.sort_order, im.created_at, im.id limit 1),
               'sizes', coalesce((
                  select jsonb_agg(z.size order by public.product_size_rank(z.size), z.size)
                    from (select distinct u.size from public.rental_units as u
                           where u.item_id = i.id and u.status = 'available') as z), '[]'::jsonb),
               'available', case when v_dates then exists (
                  select 1
                    from public.rental_units as u
                   where u.item_id = i.id and u.status = 'available'
                     and (v_size is null or u.size is null or lower(u.size) = lower(v_size))
                     and public.rental_unit_free(u.id, public.rental_block_range(i.id, p_pickup, p_return))) end,
               'rent_price', case when v_dates then public.rental_line_price(i.base_price, i.base_days, i.extra_day_price, v_days) end
             ) as j
        from public.rental_items as i
        left join public.rental_categories as c on c.id = i.category_id
       where i.is_active and i.is_public
         and (coalesce(p_include_accessories, false) or not i.is_accessory)
         and (p_category_id is null or i.category_id = p_category_id)
         and exists (select 1 from public.rental_units as u
                      where u.item_id = i.id and u.status = 'available'
                        and (v_size is null or u.size is null or lower(u.size) = lower(v_size)))
         and (v_q is null or i.code ilike '%' || v_q || '%' or i.name ilike '%' || v_q || '%'
              or coalesce(i.color, '') ilike '%' || v_q || '%' or array_to_string(i.tags, ' ') ilike '%' || v_q || '%')
       order by i.is_accessory, coalesce(c.sort_order, 2147483647), i.code
       limit 500
    ) as x;

  return jsonb_build_object('items', v_items, 'pickup_date', p_pickup, 'return_date', p_return, 'days', v_days);
end;
$$;

-- รายละเอียดชุด (ค้นด้วยรหัสชุด ไม่สนตัวพิมพ์ — ใช้เป็นลิงก์ /book/item/<รหัส>)
create or replace function public.rental_public_item(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.rental_items%rowtype;
  v_code text := left(nullif(public.product_clean_text(p_code), ''), 30);
begin
  perform public.rental_public_require_open();
  select i.* into it from public.rental_items as i where lower(i.code) = lower(v_code);
  if not found or not public.rental_public_item_ok(it.id) then
    raise exception 'ไม่พบชุดนี้ (อาจปิดรับจองออนไลน์แล้ว)';
  end if;
  return jsonb_build_object(
    'id', it.id, 'code', it.code, 'name', it.name,
    'category_name', (select c.name from public.rental_categories as c where c.id = it.category_id),
    'description', it.description, 'color', it.color, 'is_accessory', it.is_accessory, 'tags', to_jsonb(it.tags),
    'base_price', it.base_price, 'base_days', it.base_days, 'extra_day_price', it.extra_day_price,
    'security_deposit', it.security_deposit,
    'images', coalesce((
       select jsonb_agg(jsonb_build_object('path', im.path, 'width', im.width, 'height', im.height)
                        order by im.sort_order, im.created_at, im.id)
         from public.rental_item_images as im where im.item_id = it.id), '[]'::jsonb),
    'sizes', coalesce((
       select jsonb_agg(z.size order by public.product_size_rank(z.size), z.size)
         from (select distinct u.size from public.rental_units as u
                where u.item_id = it.id and u.status = 'available') as z), '[]'::jsonb),
    'accessories', coalesce((
       select jsonb_agg(a.j order by a.code)
         from (select i.code,
                      jsonb_build_object(
                        'id', i.id, 'code', i.code, 'name', i.name, 'base_price', i.base_price, 'base_days', i.base_days,
                        'extra_day_price', i.extra_day_price, 'security_deposit', i.security_deposit,
                        'cover_path', (select im.path from public.rental_item_images as im where im.item_id = i.id
                                        order by im.sort_order, im.created_at, im.id limit 1),
                        'sizes', coalesce((
                           select jsonb_agg(z.size order by public.product_size_rank(z.size), z.size)
                             from (select distinct u.size from public.rental_units as u
                                    where u.item_id = i.id and u.status = 'available') as z), '[]'::jsonb)) as j
                 from public.rental_items as i
                where i.is_accessory and i.id <> it.id and public.rental_public_item_ok(i.id)
                order by i.code
                limit 12) as a), '[]'::jsonb));
end;
$$;

-- ปฏิทินว่างรายวันแยกไซส์: วันหนึ่ง "ว่าง" สำหรับไซส์หนึ่งเมื่อมีชิ้นของไซส์นั้นที่ไม่มีการจองทับช่วง
--   [วัน − วันเตรียม, วัน + วันซัก] (คือเริ่มเช่าหรือเช่าต่อเนื่องผ่านวันนั้นได้) — free = จำนวนชิ้นที่ว่าง
create or replace function public.rental_public_availability(p_item_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := public.pos_bkk_today();
  v_before integer;
  v_after integer;
  v_days jsonb;
begin
  perform public.rental_public_require_open();
  perform public.rental_expire_pending();
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'ช่วงวันที่ไม่ถูกต้อง';
  end if;
  if p_from < v_today then
    raise exception 'ดูวันว่างได้ตั้งแต่วันนี้เป็นต้นไป';
  end if;
  if p_to - p_from + 1 > 120 then
    raise exception 'ดูวันว่างได้ครั้งละไม่เกิน 120 วัน';
  end if;
  if p_item_id is null or not public.rental_public_item_ok(p_item_id) then
    raise exception 'ไม่พบชุดนี้ (อาจปิดรับจองออนไลน์แล้ว)';
  end if;
  select bf.p_before, bf.p_after into v_before, v_after from public.rental_item_buffers(p_item_id) as bf;

  select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'sizes', d.sizes) order by d.day), '[]'::jsonb)
    into v_days
    from (
      select dd.day,
             coalesce((
               select jsonb_agg(jsonb_build_object('size', g.size, 'free', g.free)
                                order by public.product_size_rank(g.size), g.size)
                 from (select u.size,
                              count(*) filter (where public.rental_unit_free(
                                u.id, daterange(dd.day - v_before, dd.day + v_after + 1, '[)')))::integer as free
                         from public.rental_units as u
                        where u.item_id = p_item_id and u.status = 'available'
                        group by u.size) as g), '[]'::jsonb) as sizes
        from (select p_from + g.n as day from generate_series(0, p_to - p_from) as g(n)) as dd
    ) as d;

  return jsonb_build_object('item_id', p_item_id, 'from', p_from, 'to', p_to,
                            'buffer_before_days', v_before, 'buffer_after_days', v_after, 'days', v_days);
end;
$$;

-- ส่งคำขอจองออนไลน์ → การจอง "รอยืนยัน" (ถือชิ้นไว้ตามเวลาถือของร้าน)
--   p_client_id = สุ่มจากเครื่องลูกค้าครั้งเดียวต่อฟอร์ม → กดส่งซ้ำ/เน็ตหลุด ได้การจองเดิม (ต้องเป็นเบอร์เดียวกัน)
--   payload = {name, phone, line_id?, note?, event_date?, pickup_date, return_date, lines:[{item_id, size}] (1..10),
--              consent: true, accept_terms: true, website: '' (ช่องดักบอท ต้องว่าง)}
--   ส่วนลด/ค่าส่ง/สถานะ/รหัสชิ้น ที่แนบมาในคำขอจะถูกละทิ้ง (ลูกค้ากำหนดราคาเองไม่ได้)
create or replace function public.rental_public_request(p_client_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.rental_settings;
  v_today date := public.pos_bkk_today();
  v_actor constant text := 'ลูกค้าออนไลน์';
  v_found record;
  v_raw text;
  v_name text;
  v_phone text;
  v_line text;
  v_note text;
  v_event date;
  v_pick date;
  v_ret date;
  v_lines jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_item uuid;
  v_size text;
  it public.rental_items%rowtype;
  v_range daterange;
  v_unit uuid;
  v_chosen uuid[] := '{}';
  v_items_seen text[] := '{}';
  v_req_n integer;
  v_units_n integer;
  v_free_n integer;
  v_cust uuid;
  v_existing boolean := false;
  c public.rental_customers%rowtype;
  v_id uuid;
  b public.rental_bookings%rowtype;
begin
  -- ส่งคำขอจองผ่าน API ของแอปเท่านั้น (จำกัดจำนวนครั้งต่อ IP ก่อนถึงฐานข้อมูล) — แม้มีคนเผลอให้สิทธิ์ anon ภายหลัง ก็ยังเรียกตรงไม่ได้
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'ส่งคำขอจองผ่านหน้าจองออนไลน์ของร้านเท่านั้น' using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'รหัสคำขอไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'ข้อมูลการจองไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  -- ช่องดักบอท (ซ่อนจากคนจริง): มีค่า = ปฏิเสธด้วยข้อความกลางๆ ไม่บอกเหตุผล
  if nullif(public.product_clean_text(p_payload ->> 'website'), '') is not null then
    raise exception 'ส่งคำขอไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
  end if;

  -- เบอร์มือถือ/เบอร์บ้านไทย 9-10 หลัก (+66 แปลงเป็น 0)
  v_raw := public.product_json_text(p_payload -> 'phone', 'เบอร์โทร');
  if v_raw is null then
    raise exception 'กรุณากรอกเบอร์โทร';
  end if;
  if v_raw !~ '^[0-9 ()+.-]+$' then
    raise exception 'เบอร์โทรใส่ได้เฉพาะตัวเลข';
  end if;
  v_phone := regexp_replace(v_raw, '[^0-9]', '', 'g');
  if v_phone ~ '^66[0-9]{8,9}$' then
    v_phone := '0' || substr(v_phone, 3);
  end if;
  if v_phone !~ '^0[0-9]{8,9}$' then
    raise exception 'เบอร์โทรต้องเป็นเบอร์ไทย 9-10 หลัก ขึ้นต้นด้วย 0 (เช่น 0812345678)';
  end if;

  -- ส่งซ้ำด้วยรหัสคำขอเดิม → คืนการจองเดิม (เฉพาะการจองออนไลน์ของเบอร์เดียวกัน — ไม่ให้เดารหัสแล้วได้ลิงก์ของคนอื่น)
  select b2.id, b2.source, c2.phone into v_found
    from public.rental_bookings as b2
    join public.rental_customers as c2 on c2.id = b2.customer_id
   where b2.client_id = p_client_id;
  if found then
    if v_found.source = 'online' and v_found.phone = v_phone then
      select x.* into b from public.rental_bookings as x where x.id = v_found.id;
      return jsonb_build_object('already_saved', true, 'booking_no', b.booking_no, 'token', b.public_token,
                                'status_path', '/book/status/' || b.public_token, 'status', b.status,
                                'expires_at', b.expires_at, 'deposit_required', b.deposit_required,
                                'grand_total', b.grand_total);
    end if;
    raise exception 'คำขอนี้ถูกใช้ไปแล้ว กรุณาโหลดหน้าใหม่แล้วส่งอีกครั้ง';
  end if;

  s := public.rental_public_require_open();

  if p_payload -> 'consent' is distinct from 'true'::jsonb then
    raise exception 'กรุณายินยอมให้ร้านเก็บและใช้ข้อมูลส่วนบุคคลเพื่อการจอง (PDPA)';
  end if;
  if p_payload -> 'accept_terms' is distinct from 'true'::jsonb then
    raise exception 'กรุณาอ่านและยอมรับข้อตกลงการเช่าชุด';
  end if;

  v_name := public.rental_json_text(p_payload -> 'name', 'ชื่อ', 100);
  if v_name is null then
    raise exception 'กรุณากรอกชื่อผู้จอง';
  end if;
  v_line := public.rental_json_text(p_payload -> 'line_id', 'LINE ID', 50);
  v_note := public.rental_json_text(p_payload -> 'note', 'ข้อความถึงร้าน', 500);
  v_event := public.rental_json_date(p_payload -> 'event_date', 'วันงาน');
  if v_event is not null and (v_event < v_today or v_event > v_today + 730) then
    raise exception 'วันงานต้องไม่ก่อนวันนี้ และไม่เกิน 2 ปีข้างหน้า';
  end if;
  v_pick := public.rental_json_date(p_payload -> 'pickup_date', 'วันรับชุด');
  v_ret := public.rental_json_date(p_payload -> 'return_date', 'วันคืนชุด');
  perform public.rental_public_check_dates(v_pick, v_ret, s);

  if jsonb_typeof(p_payload -> 'lines') is distinct from 'array' or jsonb_array_length(p_payload -> 'lines') = 0 then
    raise exception 'กรุณาเลือกชุดอย่างน้อย 1 รายการ';
  end if;
  if jsonb_array_length(p_payload -> 'lines') > 10 then
    raise exception 'จองออนไลน์ได้ไม่เกิน 10 รายการต่อครั้ง';
  end if;

  -- จำกัดจำนวนคำขอค้าง: ทำทีละคำขอ (สองคำขอพร้อมกันจะไม่เกินโควตาเพราะนับหลังได้ล็อก)
  perform pg_advisory_xact_lock(hashtext('public.rental_public_request'));
  perform public.rental_expire_pending();
  if exists (select 1 from public.rental_bookings as x where x.client_id = p_client_id) then
    raise exception 'คำขอนี้กำลังบันทึกอยู่ กรุณาโหลดหน้าใหม่';
  end if;
  if (select count(*) from public.rental_bookings as x
        join public.rental_customers as y on y.id = x.customer_id
       where x.status = 'pending' and x.source = 'online' and y.phone = v_phone) >= 3 then
    raise exception 'เบอร์นี้มีคำขอจองที่รอร้านยืนยันอยู่ 3 รายการแล้ว กรุณารอร้านติดต่อกลับ หรือติดต่อร้านโดยตรง';
  end if;
  if (select count(*) from public.rental_bookings as x where x.status = 'pending' and x.source = 'online') >= 200 then
    raise exception 'ขณะนี้มีคำขอจองรอร้านยืนยันจำนวนมาก กรุณาติดต่อร้านโดยตรง';
  end if;
  -- เบอร์เดียวถือชุดที่ยังรอยืนยันได้รวมไม่เกิน 10 ชิ้น (กันคนส่งคำขอเต็มโควตาเพื่อกันชุดทั้งร้านไว้)
  if (select count(*) from public.rental_booking_lines as l
        join public.rental_bookings as x on x.id = l.booking_id
        join public.rental_customers as y on y.id = x.customer_id
       where x.status = 'pending' and x.source = 'online' and y.phone = v_phone)
     + jsonb_array_length(p_payload -> 'lines') > 10 then
    raise exception 'เบอร์นี้มีชุดที่รอร้านยืนยันรวมเกิน 10 ชิ้นแล้ว กรุณารอร้านติดต่อกลับ หรือติดต่อร้านโดยตรง';
  end if;

  -- รายการชุด: เฉพาะชุดที่แสดงบนหน้าจองออนไลน์ / ไม่ระบุไซส์ = ชุดฟรีไซส์เท่านั้น (เลือกชิ้นฟรีไซส์ที่ว่างให้)
  for v_elem in select e.elem from jsonb_array_elements(p_payload -> 'lines') as e(elem)
  loop
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'ข้อมูลรายการชุดไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
    end if;
    v_item := public.product_json_uuid(v_elem -> 'item_id', 'ชุด');
    v_size := public.rental_json_text(v_elem -> 'size', 'ไซส์', 20);
    select i.* into it from public.rental_items as i where i.id = v_item;
    if v_item is null or not found or not public.rental_public_item_ok(v_item) then
      raise exception 'ไม่พบชุดที่เลือก หรือชุดนี้ปิดรับจองออนไลน์แล้ว กรุณาโหลดหน้าใหม่';
    end if;
    -- คำขอออนไลน์ที่ยังไม่จ่ายมัดจำ (ไม่มีเงิน/ไม่มีสลิปรอตรวจ) ถือชุดแบบ+ไซส์เดียวกันในช่วงวันที่ทับกันได้ไม่เกินครึ่งหนึ่ง
    --   ของชิ้นไซส์นั้น (อย่างน้อย 1 ชิ้น) — เหลือชิ้นให้ลูกค้าหน้าร้าน/ลูกค้าที่โอนแล้วเสมอ แม้มีคนส่งคำขอปลอมจำนวนมาก
    if not ((it.id::text || '|' || lower(coalesce(v_size, ''))) = any(v_items_seen)) then
      v_items_seen := v_items_seen || (it.id::text || '|' || lower(coalesce(v_size, '')));
      v_range := public.rental_block_range(it.id, v_pick, v_ret);
      -- นับด้วยตัวอ่านเดียวกับลูป (uuid ตัวพิมพ์ใหญ่/มีวงเล็บ หรือไซส์มีช่องว่าง ก็นับเป็นชุด+ไซส์เดียวกัน — เลี่ยงโควตาไม่ได้)
      select count(*) into v_req_n
        from jsonb_array_elements(p_payload -> 'lines') as e(x)
       where jsonb_typeof(e.x) = 'object'
         and public.product_json_uuid(e.x -> 'item_id', 'ชุด') = it.id
         and lower(coalesce(public.rental_json_text(e.x -> 'size', 'ไซส์', 20), '')) = lower(coalesce(v_size, ''));
      select count(*), count(*) filter (where public.rental_unit_free(u.id, v_range))
        into v_units_n, v_free_n
        from public.rental_units as u
       where u.item_id = it.id and u.status = 'available'
         and lower(coalesce(u.size, '')) = lower(coalesce(v_size, ''));
      -- ขอมากกว่าจำนวนชิ้นที่ว่าง = ไม่ว่างอยู่แล้ว (ให้ข้อความ "ไม่ว่าง" ตามปกติด้านล่าง)
      if v_req_n <= v_free_n
         and v_req_n + (select count(*)
              from public.rental_booking_lines as l
              join public.rental_units as u on u.id = l.unit_id
              join public.rental_bookings as x on x.id = l.booking_id
             where l.item_id = it.id and l.blocking and l.block_range && v_range
               and lower(coalesce(u.size, '')) = lower(coalesce(v_size, ''))
               and x.status = 'pending' and x.source = 'online' and x.paid <= 0.005
               and not exists (select 1 from public.rental_payments as p
                                where p.booking_id = x.id and p.status = 'pending_review' and p.voided_at is null))
         > greatest(1, ceil(v_units_n / 2.0)) then
        raise exception '%', format('ชุด %s %s%s มีคำขอจองออนไลน์ที่ยังไม่ชำระมัดจำในช่วงวันที่นี้ครบจำนวนที่เปิดให้จองออนไลน์แล้ว กรุณาติดต่อร้านโดยตรง หรือลองใหม่ภายหลัง',
          it.code, it.name, case when v_size is null then '' else ' ไซส์ ' || v_size end);
      end if;
    end if;
    if v_size is not null then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('item_id', it.id, 'size', v_size));
    else
      if not exists (select 1 from public.rental_units as u
                      where u.item_id = it.id and u.status = 'available' and u.size is null) then
        raise exception 'กรุณาเลือกไซส์ของชุด % %', it.code, it.name;
      end if;
      v_range := public.rental_block_range(it.id, v_pick, v_ret);
      select u.id into v_unit
        from public.rental_units as u
       where u.item_id = it.id and u.status = 'available' and u.size is null
         and not (u.id = any(v_chosen))
         and public.rental_unit_free(u.id, v_range)
       order by u.unit_code, u.id
       limit 1;
      if v_unit is null then
        raise exception 'ชุด % % (ฟรีไซส์) ไม่ว่างในช่วงวันที่เลือก กรุณาเลือกวันอื่น', it.code, it.name;
      end if;
      v_chosen := v_chosen || v_unit;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('item_id', it.id, 'unit_id', v_unit));
    end if;
  end loop;

  -- ลูกค้า: เบอร์ที่มีอยู่แล้ว = ผูกกับลูกค้าเดิม (ไม่แก้ข้อมูลเดิม ไม่เปิดเผยข้อมูลเดิม; ถ้ามีหลายคน เลือกคนที่ติดบัญชีดำก่อน
  --   เพื่อให้พนักงานเห็นธง) / ไม่มี = สร้างลูกค้าใหม่ ช่องทาง "ออนไลน์"
  select x.* into c
    from public.rental_customers as x
   where x.phone = v_phone
   order by x.is_blacklisted desc, x.updated_at desc, x.id
   limit 1;
  if found then
    v_cust := c.id;
    v_existing := true;
  else
    v_cust := public.rental_customer_write(null, jsonb_build_object('name', v_name, 'phone', v_phone, 'line_id', v_line),
                                           'online', false, null);
    select x.* into c from public.rental_customers as x where x.id = v_cust;
  end if;

  -- สร้างการจองด้วยตัวช่วยเดียวกับพนักงาน — ส่งเฉพาะช่องที่ลูกค้ากำหนดได้
  --   (ชนกับการจองอื่นในเสี้ยววินาทีเดียวกัน → ข้อความกลางๆ ไม่บอกเลขการจองของคนอื่น)
  begin
    v_id := public.rental_create_core(
      p_client_id,
      jsonb_build_object('pickup_date', v_pick, 'return_date', v_ret, 'event_date', v_event,
                         'customer_note', v_note, 'lines', v_lines),
      v_cust, 'online', 'pending', s.online_hold_hours, v_actor, 10);
  exception when others then
    if sqlerrm like '%ชนกับการจอง%' or sqlerrm like '%เพิ่งถูกจองจากเครื่องอื่น%' or sqlerrm like '%ยังไม่ได้คืนจากการจอง%' then
      raise exception 'ชุดที่เลือกเพิ่งถูกจองไป กรุณาเลือกวันหรือไซส์อื่น';
    end if;
    raise;
  end;

  -- ชื่อที่ลูกค้าพิมพ์ (หน้าสถานะใช้ชื่อนี้ ไม่ใช่ชื่อที่ร้านบันทึกไว้ของเบอร์นั้น)
  update public.rental_bookings as x set online_name = v_name where x.id = v_id;

  perform public.rental_log(v_id, 'online_request', jsonb_build_object(
    'name', v_name, 'line_id', v_line, 'linked_existing_customer', v_existing,
    'name_differs', v_existing and lower(c.name) <> lower(v_name),
    'blacklisted', c.is_blacklisted), v_actor);
  if c.is_blacklisted then
    -- รับคำขอไว้ตามปกติ (ไม่บอกลูกค้า) แต่ติดธงให้พนักงานเห็นก่อนยืนยัน
    perform public.rental_log(v_id, 'blacklist_flag', jsonb_build_object('reason', c.blacklist_reason), v_actor);
  end if;

  select x.* into b from public.rental_bookings as x where x.id = v_id;
  return jsonb_build_object('already_saved', false, 'booking_no', b.booking_no, 'token', b.public_token,
                            'status_path', '/book/status/' || b.public_token, 'status', b.status,
                            'expires_at', b.expires_at, 'deposit_required', b.deposit_required,
                            'grand_total', b.grand_total);
end;
$$;

-- หน้าติดตามสถานะ (ผู้ถือลิงก์)
create or replace function public.rental_public_booking(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.rental_expire_pending();
  v_id := public.rental_public_find(p_token);
  return public.rental_public_booking_json(v_id);
end;
$$;

-- ลูกค้ายกเลิกเอง: เฉพาะคำขอที่ "รอยืนยัน" และยังไม่มีเงิน/สลิปรอตรวจ (มีเงินแล้วต้องคุยกับร้านเรื่องมัดจำ)
create or replace function public.rental_public_cancel(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  b public.rental_bookings;
begin
  perform public.rental_expire_pending();
  v_id := public.rental_public_find(p_token);
  b := public.rental_lock_booking(v_id);
  if b.status = 'cancelled' then
    return public.rental_public_booking_json(b.id);
  end if;
  if b.status = 'expired' then
    raise exception 'คำขอนี้หมดเวลาถือการจองแล้ว ไม่ต้องยกเลิก';
  end if;
  if b.status <> 'pending' then
    raise exception 'การจองนี้ร้านยืนยันแล้ว หากต้องการยกเลิกกรุณาติดต่อร้าน';
  end if;
  if b.paid > 0.005 or exists (select 1 from public.rental_payments as p
                                where p.booking_id = b.id and p.status = 'pending_review' and p.voided_at is null) then
    raise exception 'การจองนี้มีการชำระเงินหรือส่งสลิปแล้ว หากต้องการยกเลิกกรุณาติดต่อร้าน';
  end if;
  update public.rental_bookings as x
     set status = 'cancelled', cancel_reason = 'ลูกค้ายกเลิกผ่านลิงก์ออนไลน์', cancelled_at = now(), expires_at = null
   where x.id = b.id;
  update public.rental_booking_lines as l set blocking = false where l.booking_id = b.id;
  perform public.rental_recalc(b.id);
  perform public.rental_log(b.id, 'cancel', jsonb_build_object('reason', 'ลูกค้ายกเลิกผ่านลิงก์ออนไลน์', 'by_customer', true),
                            'ลูกค้าออนไลน์');
  return public.rental_public_booking_json(b.id);
end;
$$;

-- บันทึกสลิป (service role เท่านั้น — API ของแอปอัปโหลดไฟล์เข้าถัง rental-slips แล้วค่อยเรียก)
--   ไฟล์ '<booking_id>/<ชื่อไฟล์>' / สลิปไม่เกิน 5 ใบต่อการจอง / ส่งไฟล์เดิมซ้ำ = ไม่บันทึกซ้ำ
create or replace function public.rental_public_add_slip(p_token text, p_path text, p_amount numeric, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  b public.rental_bookings;
  v_prefix text;
  v_pay uuid;
begin
  -- กันพลาดซ้ำสองชั้น: แม้มีคนเผลอให้สิทธิ์ anon/authenticated ภายหลัง ก็ยังเรียกไม่ได้
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'ส่งสลิปผ่านหน้าติดตามสถานะการจองเท่านั้น' using errcode = '42501';
  end if;
  perform public.rental_expire_pending();
  v_id := public.rental_public_find(p_token);
  b := public.rental_lock_booking(v_id);

  v_prefix := b.id::text || '/';
  if p_path is null or left(p_path, char_length(v_prefix)) <> v_prefix
     or substr(p_path, char_length(v_prefix) + 1) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' then
    raise exception 'ที่อยู่ไฟล์สลิปไม่ถูกต้อง';
  end if;

  select p.id into v_pay from public.rental_payments as p where p.booking_id = b.id and p.slip_path = p_path;
  if found then
    return jsonb_build_object('ok', true, 'already_saved', true, 'payment_id', v_pay);
  end if;

  if b.status = 'expired' then
    raise exception 'คำขอนี้หมดเวลาถือการจองแล้ว กรุณาส่งคำขอจองใหม่หรือติดต่อร้าน';
  end if;
  if b.status not in ('pending', 'confirmed') then
    raise exception 'การจองสถานะ "%" ส่งสลิปไม่ได้ กรุณาติดต่อร้าน', public.rental_status_label(b.status);
  end if;
  -- โควตา 5 ใบ นับเฉพาะสลิปที่รอตรวจ/ผ่านแล้ว (ใบที่ร้านปฏิเสธส่งใหม่ได้) และรวมทุกใบไม่เกิน 10 ครั้ง
  if (select count(*) from public.rental_payments as p
       where p.booking_id = b.id and p.slip_path is not null and p.voided_at is null
         and p.status in ('pending_review', 'confirmed')) >= 5
     or (select count(*) from public.rental_payments as p
          where p.booking_id = b.id and p.slip_path is not null) >= 10 then
    raise exception 'ส่งสลิปได้ไม่เกิน 5 ครั้งต่อการจอง กรุณาติดต่อร้าน';
  end if;
  perform public.rental_check_money(p_amount, 'ยอดเงินที่โอน', false);

  v_pay := public.rental_add_payment_core(b.id, null, 'payment', 'transfer', p_amount, p_note, 'pending_review',
                                          p_path, 'ลูกค้าออนไลน์');
  -- ลูกค้าโอนแล้ว: ต่อเวลาถือให้อย่างน้อยอีก online_hold_hours (การจองที่มีสลิปรอตรวจไม่ถูกปล่อยอยู่แล้ว
  --   แต่ถ้าร้านปฏิเสธสลิป ลูกค้าจะยังมีเวลาส่งใบใหม่ และหน้าสถานะไม่แสดงเวลาที่หมดไปแล้ว)
  if b.status = 'pending' then
    update public.rental_bookings as x
       set expires_at = greatest(coalesce(x.expires_at, now()),
                                 now() + make_interval(hours => (select coalesce(s.online_hold_hours, 24)
                                                                   from public.rental_settings as s where s.id)))
     where x.id = b.id;
  end if;
  return jsonb_build_object('ok', true, 'already_saved', false, 'payment_id', v_pay);
end;
$$;

-- =========================================================================
-- 3) รายงาน (ผู้จัดการร้านเช่า)
--    รายรับ = เงินสดตามวันที่รับ/คืนเงินจริง (ไม่นับเงินประกันเข้า-ออก; หักเงินประกันเป็นค่าเช่า/ค่าปรับ = รายรับของวันที่หัก)
--    รายได้ค่าเช่าต่อชุด = ค่าเช่าของการจองที่รับชุดไปแล้ว และวันรับชุดอยู่ในช่วงรายงาน
-- =========================================================================
create or replace function public.rental_report(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := public.pos_bkk_today();
  v_start timestamptz;
  v_end timestamptz;
  v_span integer;
  v_income jsonb;
  v_charges jsonb;
  v_bookings jsonb;
  v_items jsonb;
  v_security jsonb;
begin
  perform public.rental_require(true);
  perform public.pos_check_range(p_from, p_to);
  perform public.rental_expire_pending();
  v_span := p_to - p_from + 1;
  select x.p_start into v_start from public.pos_day_bounds(p_from) as x;
  select x.p_end into v_end from public.pos_day_bounds(p_to) as x;

  -- เงินที่ยืนยันแล้วและไม่ถูกยกเลิกในช่วง (วันตามเวลาไทย) — ผลต่อรายรับ: ชำระ/หักประกัน = +, คืนเงิน = −
  with pay as (
    select public.pos_bkk_day(p.confirmed_at) as day, p.kind, p.method, p.amount,
           case p.kind when 'refund' then -p.amount
                       when 'payment' then p.amount
                       when 'security_apply' then p.amount
                       else 0 end as income
      from public.rental_payments as p
     where p.confirmed_at >= v_start and p.confirmed_at < v_end
       and p.status = 'confirmed' and p.voided_at is null
  )
  select jsonb_build_object(
           'by_day', coalesce((
              select jsonb_agg(jsonb_build_object('day', d.day, 'payment', d.pay, 'refund', d.ref, 'net', d.pay - d.ref)
                               order by d.day)
                from (select g.day,
                             coalesce((select sum(r.amount) from pay as r
                                        where r.day = g.day and r.kind in ('payment', 'security_apply')), 0) as pay,
                             coalesce((select sum(r.amount) from pay as r
                                        where r.day = g.day and r.kind = 'refund'), 0) as ref
                        from (select p_from + s.n as day from generate_series(0, v_span - 1) as s(n)) as g) as d), '[]'::jsonb),
           'by_method', jsonb_build_object(
              'cash', coalesce(sum(pay.income) filter (where pay.method = 'cash'), 0),
              'transfer', coalesce(sum(pay.income) filter (where pay.method = 'transfer'), 0),
              'promptpay', coalesce(sum(pay.income) filter (where pay.method = 'promptpay'), 0),
              'credit', coalesce(sum(pay.income) filter (where pay.method = 'credit'), 0),
              'security_apply', coalesce(sum(pay.amount) filter (where pay.kind = 'security_apply'), 0)),
           'total_payment', coalesce(sum(pay.amount) filter (where pay.kind in ('payment', 'security_apply')), 0),
           'total_refund', coalesce(sum(pay.amount) filter (where pay.kind = 'refund'), 0),
           'total_net', coalesce(sum(pay.income), 0))
    into v_income
    from pay;

  -- เงินประกันเข้า-ออกในช่วง (ไม่ใช่รายรับ — แสดงแยกให้ตรวจเงินสดในลิ้นชัก)
  select jsonb_build_object(
           'received', coalesce(sum(p.amount) filter (where p.kind = 'security_in'), 0),
           'returned', coalesce(sum(p.amount) filter (where p.kind = 'security_out'), 0),
           'applied', coalesce(sum(p.amount) filter (where p.kind = 'security_apply'), 0))
    into v_security
    from public.rental_payments as p
   where p.confirmed_at >= v_start and p.confirmed_at < v_end
     and p.status = 'confirmed' and p.voided_at is null;

  select jsonb_build_object(
           'late', coalesce(sum(ch.amount) filter (where ch.kind = 'late'), 0),
           'damage', coalesce(sum(ch.amount) filter (where ch.kind = 'damage'), 0),
           'lost', coalesce(sum(ch.amount) filter (where ch.kind = 'lost'), 0),
           'cleaning', coalesce(sum(ch.amount) filter (where ch.kind = 'cleaning'), 0),
           'delivery', coalesce(sum(ch.amount) filter (where ch.kind = 'delivery'), 0),
           'other', coalesce(sum(ch.amount) filter (where ch.kind = 'other'), 0),
           'total', coalesce(sum(ch.amount), 0))
    into v_charges
    from public.rental_charges as ch
   where ch.created_at >= v_start and ch.created_at < v_end and ch.voided_at is null;

  select jsonb_build_object(
           'created', (select count(*) from public.rental_bookings as b where b.created_at >= v_start and b.created_at < v_end),
           'completed', (select count(*) from public.rental_bookings as b
                          where b.status = 'completed' and b.completed_at >= v_start and b.completed_at < v_end),
           'cancelled', (select count(*) from public.rental_bookings as b
                          where b.status = 'cancelled' and b.cancelled_at >= v_start and b.cancelled_at < v_end),
           'expired', (select count(*) from public.rental_bookings as b
                        where b.status = 'expired' and b.expires_at >= v_start and b.expires_at < v_end),
           'no_show', (select count(*) from public.rental_bookings as b
                        where b.status = 'no_show' and b.cancelled_at >= v_start and b.cancelled_at < v_end),
           'picked_up', (select count(*) from public.rental_bookings as b
                          where b.picked_up_at >= v_start and b.picked_up_at < v_end),
           'by_source', (select jsonb_build_object(
                                  'walkin', count(*) filter (where b.source = 'walkin'),
                                  'online', count(*) filter (where b.source = 'online'),
                                  'phone', count(*) filter (where b.source = 'phone'),
                                  'line', count(*) filter (where b.source = 'line'),
                                  'other', count(*) filter (where b.source = 'other'))
                           from public.rental_bookings as b where b.created_at >= v_start and b.created_at < v_end))
    into v_bookings;

  -- ชุดยอดนิยม: รายได้ค่าเช่า (วันรับชุดในช่วง), วันที่ถูกเช่าจริงในช่วง, อัตราการใช้ = วันถูกเช่า ÷ (ชิ้นที่ยังใช้ × วันในช่วง)
  select coalesce(jsonb_agg(z.j order by z.rev desc, z.days_rented desc, z.code), '[]'::jsonb) into v_items
    from (
      select st.code, st.rev, st.days_rented,
             jsonb_build_object(
               'item_id', st.id, 'code', st.code, 'name', st.name, 'is_accessory', st.is_accessory,
               'units', st.units, 'bookings', st.bookings, 'rent_revenue', st.rev, 'days_rented', st.days_rented,
               'utilization_pct', case when st.units > 0
                                       then round(st.days_rented * 100.0 / (st.units * v_span), 1) else 0 end) as j
        from (
          select i.id, i.code, i.name, i.is_accessory,
                 (select count(*) from public.rental_units as u where u.item_id = i.id and u.status <> 'retired')::integer as units,
                 coalesce(rv.bookings, 0)::integer as bookings,
                 coalesce(rv.rev, 0) as rev,
                 coalesce(dr.days_rented, 0)::integer as days_rented
            from public.rental_items as i
            left join lateral (
              select count(distinct l.booking_id) as bookings, sum(l.rent_price) as rev
                from public.rental_booking_lines as l
                join public.rental_bookings as b on b.id = l.booking_id
               where l.item_id = i.id
                 and b.status in ('picked_up', 'returned', 'completed')
                 and b.pickup_date between p_from and p_to) as rv on true
            left join lateral (
              select sum(greatest(0,
                       least(case when b.status = 'picked_up' then greatest(b.return_date, v_today)
                                  else coalesce(b.returned_on, b.return_date) end, p_to)
                       - greatest(b.pickup_date, p_from) + 1)) as days_rented
                from public.rental_booking_lines as l
                join public.rental_bookings as b on b.id = l.booking_id
               where l.item_id = i.id
                 and l.status in ('picked_up', 'returned', 'lost')
                 and b.status in ('picked_up', 'returned', 'completed')) as dr on true
           where i.is_active or coalesce(rv.rev, 0) > 0 or coalesce(dr.days_rented, 0) > 0
        ) as st
       order by st.rev desc, st.days_rented desc, st.code
       limit 50
    ) as z;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'days', v_span,
    'income', v_income,
    'security', v_security,
    'charges', v_charges,
    'bookings', v_bookings,
    'items', v_items,
    'security_held_total', (select coalesce(sum(b.security_held), 0) from public.rental_bookings as b),
    'overdue_count', (select count(*) from public.rental_bookings as b where b.status = 'picked_up' and b.return_date < v_today),
    -- ยอดที่ลูกค้ายังค้าง (เฉพาะการจองที่ยังไม่ปิด/ไม่ยกเลิก) และยอดที่ร้านต้องคืน (รับเงินเกิน)
    'outstanding_due_total', (select coalesce(sum(greatest(b.due, 0)), 0) from public.rental_bookings as b
                               where b.status in ('pending', 'confirmed', 'picked_up', 'returned')),
    'overpaid_total', (select coalesce(sum(greatest(-b.due, 0)), 0) from public.rental_bookings as b
                        where b.status in ('pending', 'confirmed', 'picked_up', 'returned')));
end;
$$;

-- =========================================================================
-- 4) ส่งออก CSV (คืนเป็นแถว เรียงลำดับคงที่ — ดึงทีละหน้าด้วย p_offset + p_limit ≤ 10,000 แบบเดียวกับ fix-04)
--    ห้ามใช้ .range() ของ PostgREST คู่กับ p_offset (จะเลื่อนซ้ำสองชั้น)
--
--    rental_export_bookings (ตามวันรับชุด): booking_no เลขการจอง, status/status_label สถานะ, source/source_label ช่องทาง,
--      created_at วันที่สร้าง, customer_name/customer_phone ลูกค้า, pickup_date/return_date/days วันรับ-คืน/จำนวนวัน,
--      returned_on วันที่คืนจริง, event_date วันงาน, items รายการชุด "รหัส ชื่อ ไซส์ [รหัสชิ้น]; ...", items_count จำนวนชิ้น,
--      rent_total ค่าเช่า, discount ส่วนลด, delivery_fee ค่าส่ง, charges_total ค่าปรับ/ค่าใช้จ่าย, grand_total ยอดรวม,
--      paid ชำระแล้ว, due ค้างชำระ (ติดลบ = รับเกิน), security_required/security_held เงินประกันที่ต้องวาง/ที่ถืออยู่,
--      deposit_required มัดจำที่ต้องจ่าย, cancel_reason เหตุผลยกเลิก, note หมายเหตุร้าน, created_by_name ผู้สร้าง
--    rental_export_payments (ตามวันที่เงินเข้า/ออกจริง เวลาไทย = confirmed_at ถ้ายืนยันแล้ว ไม่งั้น created_at;
--      ทุกสถานะรวมรายการที่ยกเลิก): receipt_no เลขใบเสร็จ, created_at เวลาบันทึก/เวลาลูกค้าส่งสลิป,
--      booking_no, customer_name, kind/kind_label ประเภท, method/method_label วิธีชำระ, amount จำนวนเงิน,
--      status/status_label สถานะ (ยืนยัน/รอตรวจสลิป/ปฏิเสธ/ยกเลิกแล้ว),
--      cash_effect เงินสดเข้า(+)/ออก(−) จริง (รวมเงินประกัน), income_effect ผลต่อรายรับ (ชำระ/หักประกัน +, คืนเงิน −)
--        — สองช่องนี้เป็น 0 เมื่อรายการยังไม่ยืนยันหรือถูกยกเลิก,
--      has_slip มีสลิป, note หมายเหตุ, created_by_name ผู้บันทึก, reviewed_at เวลาตรวจสลิป, voided_at/void_reason การยกเลิก,
--      confirmed_at เวลาที่เงินเข้า/ออกจริง (วันเดียวกับเลขใบเสร็จ RC และรายงาน — สลิป = เวลาอนุมัติ)
-- =========================================================================
create or replace function public.rental_export_bookings(p_from date, p_to date,
                                                         p_offset integer default null, p_limit integer default null)
returns table (
  booking_no text, status text, status_label text, source text, source_label text, created_at timestamptz,
  customer_name text, customer_phone text, pickup_date date, return_date date, days integer, returned_on date,
  event_date date, items text, items_count integer, rent_total numeric, discount numeric, delivery_fee numeric,
  charges_total numeric, grand_total numeric, paid numeric, due numeric, security_required numeric,
  security_held numeric, deposit_required numeric, cancel_reason text, note text, created_by_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.rental_require(true);
  perform public.pos_check_range(p_from, p_to);
  perform public.pos_check_page(p_offset, p_limit);
  return query
    with pagerows as (
      select b.*
        from public.rental_bookings as b
       where b.pickup_date between p_from and p_to
       order by b.pickup_date, b.booking_no, b.id
      offset coalesce(p_offset, 0)
       limit p_limit
    )
    select pr.booking_no::text,
           pr.status::text,
           public.rental_status_label(pr.status),
           pr.source::text,
           public.rental_source_label(pr.source),
           pr.created_at,
           c.name::text,
           c.phone::text,
           pr.pickup_date,
           pr.return_date,
           public.rental_days(pr.pickup_date, pr.return_date),
           pr.returned_on,
           pr.event_date,
           (select string_agg(i.code || ' ' || i.name || coalesce(' ไซส์ ' || l.size, '') || ' [' || u.unit_code || ']',
                              '; ' order by l.sort_order, l.id)
              from public.rental_booking_lines as l
              join public.rental_items as i on i.id = l.item_id
              join public.rental_units as u on u.id = l.unit_id
             where l.booking_id = pr.id),
           (select count(*)::integer from public.rental_booking_lines as l where l.booking_id = pr.id),
           pr.rent_total::numeric,
           pr.discount::numeric,
           pr.delivery_fee::numeric,
           pr.charges_total::numeric,
           pr.grand_total::numeric,
           pr.paid::numeric,
           pr.due::numeric,
           pr.security_required::numeric,
           pr.security_held::numeric,
           pr.deposit_required::numeric,
           pr.cancel_reason::text,
           pr.note::text,
           pr.created_by_name::text
      from pagerows as pr
      join public.rental_customers as c on c.id = pr.customer_id
     order by pr.pickup_date, pr.booking_no, pr.id;
end;
$$;

-- (เพิ่มคอลัมน์ confirmed_at → ชนิดผลลัพธ์เปลี่ยน ต้องลบรุ่นเดิมก่อน; สิทธิ์เรียกตั้งใหม่ในหัวข้อ 5)
drop function if exists public.rental_export_payments(date, date, integer, integer);
create or replace function public.rental_export_payments(p_from date, p_to date,
                                                         p_offset integer default null, p_limit integer default null)
returns table (
  receipt_no text, created_at timestamptz, booking_no text, customer_name text, kind text, kind_label text,
  method text, method_label text, amount numeric, status text, status_label text, cash_effect numeric,
  income_effect numeric, has_slip boolean, note text, created_by_name text, reviewed_at timestamptz,
  voided_at timestamptz, void_reason text, confirmed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  perform public.rental_require(true);
  perform public.pos_check_range(p_from, p_to);
  perform public.pos_check_page(p_offset, p_limit);
  select x.p_start into v_start from public.pos_day_bounds(p_from) as x;
  select x.p_end into v_end from public.pos_day_bounds(p_to) as x;
  return query
    with pagerows as (
      select p.*, coalesce(p.confirmed_at, p.created_at) as money_at
        from public.rental_payments as p
       where coalesce(p.confirmed_at, p.created_at) >= v_start and coalesce(p.confirmed_at, p.created_at) < v_end
       order by coalesce(p.confirmed_at, p.created_at), p.id
      offset coalesce(p_offset, 0)
       limit p_limit
    )
    select pr.receipt_no::text,
           pr.created_at,
           b.booking_no::text,
           c.name::text,
           pr.kind::text,
           public.rental_kind_label(pr.kind),
           pr.method::text,
           public.rental_method_label(pr.method),
           pr.amount::numeric,
           (case when pr.voided_at is not null then 'voided' else pr.status end)::text,
           case when pr.voided_at is not null then 'ยกเลิกแล้ว'
                when pr.status = 'confirmed' then 'ยืนยันแล้ว'
                when pr.status = 'pending_review' then 'รอตรวจสลิป'
                when pr.status = 'rejected' then 'ปฏิเสธสลิป'
                else pr.status end,
           (case when pr.voided_at is null and pr.status = 'confirmed'
                 then case pr.kind when 'payment' then pr.amount when 'security_in' then pr.amount
                                   when 'refund' then -pr.amount when 'security_out' then -pr.amount else 0 end
                 else 0 end)::numeric,
           (case when pr.voided_at is null and pr.status = 'confirmed'
                 then case pr.kind when 'payment' then pr.amount when 'security_apply' then pr.amount
                                   when 'refund' then -pr.amount else 0 end
                 else 0 end)::numeric,
           pr.slip_path is not null,
           pr.note::text,
           pr.created_by_name::text,
           pr.reviewed_at,
           pr.voided_at,
           pr.void_reason::text,
           pr.confirmed_at
      from pagerows as pr
      join public.rental_bookings as b on b.id = pr.booking_id
      join public.rental_customers as c on c.id = b.customer_id
     order by pr.money_at, pr.id;
end;
$$;

-- =========================================================================
-- 5) สิทธิ์เรียกฟังก์ชัน
--    หน้าจองออนไลน์ = anon + ผู้ใช้ที่ล็อกอิน / รับสลิป = service role เท่านั้น / รายงาน = ผู้ใช้ที่ล็อกอิน (ตรวจสิทธิ์ข้างใน)
--    ตัวช่วย = ไม่มีใครเรียกตรงได้ (Supabase เลิกให้สิทธิ์ฟังก์ชันใหม่อัตโนมัติ — ระบุให้ชัดทุกตัว)
-- =========================================================================
revoke all on function public.rental_mask_name(text) from public, anon, authenticated;
revoke all on function public.rental_mask_phone(text) from public, anon, authenticated;
revoke all on function public.rental_kind_label(text) from public, anon, authenticated;
revoke all on function public.rental_method_label(text) from public, anon, authenticated;
revoke all on function public.rental_source_label(text) from public, anon, authenticated;
revoke all on function public.rental_public_require_open() from public, anon, authenticated;
revoke all on function public.rental_public_check_dates(date, date, public.rental_settings) from public, anon, authenticated;
revoke all on function public.rental_public_find(text) from public, anon, authenticated;
revoke all on function public.rental_public_booking_json(uuid) from public, anon, authenticated;
revoke all on function public.rental_public_item_ok(uuid) from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.rental_mask_name(text)', 'public.rental_mask_phone(text)', 'public.rental_kind_label(text)',
    'public.rental_method_label(text)', 'public.rental_source_label(text)', 'public.rental_public_require_open()',
    'public.rental_public_check_dates(date, date, public.rental_settings)', 'public.rental_public_find(text)',
    'public.rental_public_booking_json(uuid)', 'public.rental_public_item_ok(uuid)'
  ]
  loop
    execute format('revoke all on function %s from service_role', f);
  end loop;

  foreach f in array array[
    'public.rental_public_info()',
    'public.rental_public_catalog(uuid, text, date, date, text, boolean)',
    'public.rental_public_item(text)',
    'public.rental_public_availability(uuid, date, date)',
    'public.rental_public_booking(text)',
    'public.rental_public_cancel(text)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;

  -- เรียกได้เฉพาะ API ของแอป (service role): ส่งสลิป / ส่งคำขอจอง / ตัวนับจำนวนครั้งต่อ IP
  foreach f in array array[
    'public.rental_public_add_slip(text, text, numeric, text)',
    'public.rental_public_request(uuid, jsonb)',
    'public.rental_rate_hit(text, integer, integer)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;

  foreach f in array array[
    'public.rental_report(date, date)',
    'public.rental_export_bookings(date, date, integer, integer)',
    'public.rental_export_payments(date, date, integer, integer)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;

-- =========================================================================
-- 6) ให้ API (PostgREST) โหลดโครงสร้างใหม่ทันที
-- =========================================================================
notify pgrst, 'reload schema';

commit;

-- =========================================================================
-- (ไม่บังคับ) ตั้งเวลาให้ระบบปล่อยการจองที่หมดเวลาถือทุก 10 นาที ด้วย pg_cron
--   ปกติไม่จำเป็น: ทุกฟังก์ชันที่อ่านความว่าง/สร้างการจอง/เปิดหน้าภาพรวม เรียก rental_expire_pending() ให้อยู่แล้ว
--   ใช้เมื่ออยากให้ตัวเลข "รอยืนยัน" บนเมนูตรงเวลาแม้ไม่มีใครเปิดระบบ
--   rental_expire_pending() เป็นตัวช่วยภายใน (เรียกจาก API ไม่ได้) — pg_cron รันในนามเจ้าของฐานข้อมูลจึงเรียกได้
--   เปิดใช้: Database > Extensions > เปิด pg_cron แล้วเอา "-- " หน้าบรรทัดออก แล้วรันใน SQL Editor
--
-- select cron.schedule('rental-expire-pending', '*/10 * * * *', $cron$select public.rental_expire_pending()$cron$);
--
--   ดูงานที่ตั้งไว้:  select jobid, jobname, schedule, command from cron.job where jobname = 'rental-expire-pending';
--   ยกเลิก:          select cron.unschedule('rental-expire-pending');
-- =========================================================================

-- =========================================================================
-- ตรวจสอบหลังรัน (ตารางสรุปนี้ SQL Editor แสดงให้เองหลังกด Run — อ่านอย่างเดียว รันซ้ำได้)
-- =========================================================================
select x.item as "รายการ", x.value as "ค่า"
  from (values
    (1, 'ฟังก์ชันหน้าจองออนไลน์ (ลูกค้าเรียกได้ / ทั้งหมด)',
        (select count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE'))::text || ' / ' || count(*)::text
           from pg_proc as p
          where p.pronamespace = 'public'::regnamespace
            and p.proname in ('rental_public_info', 'rental_public_catalog', 'rental_public_item', 'rental_public_availability',
                              'rental_public_booking', 'rental_public_cancel'))),
    (2, 'ส่งคำขอจอง/รับสลิปออนไลน์ (เฉพาะ service role ผ่าน API ของแอป)',
        (select case when bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE')
                                   and not has_function_privilege('anon', p.oid, 'EXECUTE')
                                   and not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
                     then 'ถูกต้อง' else 'ผิด — รันไฟล์นี้ซ้ำ' end
           from pg_proc as p
          where p.pronamespace = 'public'::regnamespace
            and p.proname in ('rental_public_add_slip', 'rental_public_request', 'rental_rate_hit'))),
    (3, 'รายงาน/ส่งออก (ผู้ใช้ที่ล็อกอินเรียกได้ / ทั้งหมด)',
        (select count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                   and not has_function_privilege('anon', p.oid, 'EXECUTE'))::text || ' / ' || count(*)::text
           from pg_proc as p
          where p.pronamespace = 'public'::regnamespace
            and p.proname in ('rental_report', 'rental_export_bookings', 'rental_export_payments'))),
    (4, 'ตารางร้านเช่าที่ลูกค้า (anon) อ่านตรงได้',
        (select count(*)::text
           from pg_class as c
          where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'rental\_%'
            and has_table_privilege('anon', c.oid, 'SELECT'))),
    (5, 'เปิดรับจองออนไลน์',
        (select case when bool_or(s.online_enabled) then 'เปิด' else 'ปิด' end from public.rental_settings as s)),
    (6, 'คำขอจองออนไลน์ที่รอยืนยัน',
        (select count(*)::text from public.rental_bookings as b where b.status = 'pending' and b.source = 'online'))
  ) as x(ord, item, value)
 order by x.ord;
