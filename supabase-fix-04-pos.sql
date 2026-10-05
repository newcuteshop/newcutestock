-- =========================================================================
-- supabase-fix-04-pos.sql — ระบบหน้าร้าน (POS) รอบที่ 4: ยกเลิกบิล / คืนสินค้า / รับเงิน-เงินทอน / ใบเสร็จ /
--                          ปิดยอดประจำวัน / ข้อมูลร้าน / ตรวจนับสต๊อก / ส่งออก-นำเข้า Excel (CSV)
--
-- ไฟล์นี้ทำอะไร
--   1) สิทธิ์ใหม่ "refunds" (ยกเลิกบิล / คืนสินค้า) — พนักงานที่มีแค่สิทธิ์นี้ก็นับเป็นพนักงานของร้าน (is_member)
--   2) ตาราง sales เพิ่ม: เงินที่รับมา + เงินทอน, ผู้ยกเลิก + เหตุผล, ยอดคืนเงินสะสม, ชื่อพนักงานขาย
--   3) ตารางใหม่ (ทั้งหมดเปิด RLS + ให้สิทธิ์แบบระบุชัด — Supabase เลิกให้สิทธิ์ตารางใหม่อัตโนมัติตั้งแต่ 30 ต.ค. 2026):
--        sale_returns / sale_return_items   ใบคืนสินค้า R-YYYYMMDD-NNN (ยอดคืนเงินคำนวณที่ฐานข้อมูลเท่านั้น)
--        doc_counters                       ตัวนับเลขเอกสารรายวัน (ภายใน)
--        shop_settings                      ข้อมูลร้านบนใบเสร็จ (1 แถว)
--        daily_closings                     ปิดยอดประจำวัน (ปิดใหม่ได้ เก็บประวัติครั้งก่อนไว้)
--        stock_counts / stock_count_items   รอบตรวจนับสต๊อก (นับระหว่างเปิดขายได้)
--        stock_count_ops                    รหัสคำสั่งนับที่บันทึกแล้ว (ภายใน — กันสแกนเบิ้ลเมื่อเครื่องส่งซ้ำหลังเน็ตหลุด)
--        product_imports                    ประวัติการนำเข้าสินค้าจากไฟล์ (กันกดนำเข้าซ้ำ)
--   4) record_sale() รับ p_cash_received (เงินที่รับมา) เพิ่ม — แอปเดิมที่ไม่ส่งยังขายได้ตามปกติ
--   5) ฟังก์ชันใหม่: get_sale_detail, void_sale, return_sale_items, get_shop_settings, save_shop_settings,
--      get_day_summary, close_day, create/get/set_item/apply/cancel stock count, export_* (CSV), import_products
--
-- วิธีใช้: Supabase > SQL Editor > วางทั้งไฟล์ > กด Run
--   - ต้องรัน supabase-fix-01.sql, supabase-fix-02.sql และ supabase-fix-03-integrations.sql มาก่อนแล้ว
--     (ไฟล์นี้ตรวจให้ ถ้ายังไม่ได้รันจะหยุดทันทีโดยไม่แก้อะไร)
--   - รันซ้ำได้ปลอดภัย ไม่ทำให้ข้อมูลเสีย (ทั้งไฟล์สำเร็จทั้งหมดหรือไม่เปลี่ยนอะไรเลย)
--   - รันก่อน deploy แอปเวอร์ชันใหม่ได้: แอปเดิมยังขาย/รับ-จ่ายสต๊อกได้ตามปกติ
--   - [สำคัญ] ไฟล์นี้เปลี่ยน record_sale เป็นแบบ 7 พารามิเตอร์ (ลบแบบ 6 พารามิเตอร์ของ fix-03 ออก)
--       • ถ้าวันหลังรัน supabase-fix-01.sql ซ้ำ ต้องรัน fix-02 → fix-03 → ไฟล์นี้ ซ้ำทันทีตามลำดับ
--         (fix-01 สร้าง record_sale แบบเก่าซ้อนขึ้นมา และสร้าง is_member() ที่ไม่รู้จักสิทธิ์ refunds;
--          fix-03 สร้างแบบ 6 พารามิเตอร์ + sale_json แบบเดิมกลับมา — ไฟล์นี้ลบ/แก้คืนให้ทั้งหมด
--          ระหว่างนั้นหน้าขายจะบันทึกบิลไม่ได้ ("function is not unique") จนกว่าจะรันไฟล์นี้)
--       • รัน supabase-fix-03-integrations.sql ซ้ำ "อย่างเดียว" หลังไฟล์นี้ไม่ได้ — fix-03 จะหยุดเองโดยไม่แก้อะไร
--         (หา record_sale แบบเดิมไม่เจอ) ถ้าจำเป็นต้องรันซ้ำ ให้รันตามลำดับ fix-01 → fix-02 → fix-03 → ไฟล์นี้
--   - รันเสร็จแล้ว SQL Editor จะแสดงตารางสรุป — ดูหัวข้อ "ตรวจสอบหลังรัน" ท้ายไฟล์
-- =========================================================================

begin;

-- =========================================================================
-- 0) ตรวจของที่ต้องมีก่อน
--    (record_sale แบบ 7 พารามิเตอร์ = ไฟล์นี้เคยรันแล้ว → รันซ้ำได้)
-- =========================================================================
do $$
begin
  if to_regprocedure('public.has_perm(text)') is null
     or to_regprocedure('public.is_admin()') is null
     or to_regprocedure('public.is_member()') is null
     or to_regprocedure('public.save_product_group(jsonb, jsonb)') is null
     or to_regprocedure('public.product_clean_text(text)') is null
     or to_regprocedure('public.product_size_rank(text)') is null
     or to_regprocedure('public.sale_json(uuid, boolean)') is null
     or (to_regprocedure('public.record_sale(uuid, jsonb, numeric, text, text, text)') is null
         and to_regprocedure('public.record_sale(uuid, jsonb, numeric, text, text, text, numeric)') is null)
     or not exists (select 1 from information_schema.columns as c
                     where c.table_schema = 'public' and c.table_name = 'sales' and c.column_name = 'voided_at') then
    raise exception 'ต้องรัน supabase-fix-01.sql, supabase-fix-02.sql และ supabase-fix-03-integrations.sql ให้เสร็จก่อน แล้วค่อยรันไฟล์นี้ (ยังไม่ได้แก้อะไรในฐานข้อมูล)';
  end if;
end
$$;

-- =========================================================================
-- 1) สิทธิ์: is_member() นับสิทธิ์ใหม่ "refunds" ด้วย (เนื้อเดิมของ fix-01 ทุกอย่าง เพิ่มแค่คีย์ในรายการ)
--    — ไม่แก้ handle_new_user / ค่าเริ่มต้นของคอลัมน์ permissions: ไม่มีคีย์ = ไม่มีสิทธิ์อยู่แล้ว
-- =========================================================================
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

-- =========================================================================
-- 2) sales: รับเงิน/เงินทอน, ยกเลิกบิล, ยอดคืนเงินสะสม, ชื่อพนักงานขาย
-- =========================================================================
alter table public.sales add column if not exists cash_received numeric(10, 2);
alter table public.sales add column if not exists change_amount numeric(10, 2);
alter table public.sales add column if not exists voided_by uuid;
alter table public.sales add column if not exists void_reason text;
alter table public.sales add column if not exists refunded_amount numeric(10, 2) not null default 0;
-- ชื่อพนักงานขาย ณ ตอนขาย (บิลเก่าเป็น null → ใช้ชื่อจากโปรไฟล์ของ created_by แทน)
alter table public.sales add column if not exists created_by_name text;

do $$
begin
  -- (เพิ่ม foreign key แยกจาก add column — ตั้งชื่อเองจะได้ตรวจได้ว่ามีแล้วหรือยัง ไม่สร้างซ้อน)
  if not exists (
    select 1 from pg_constraint as c
     where c.conrelid = 'public.sales'::regclass and c.conname = 'sales_voided_by_fkey'
  ) then
    alter table public.sales
      add constraint sales_voided_by_fkey
      foreign key (voided_by) references auth.users (id) on delete set null;
  end if;

  -- not valid = ไม่ตรวจแถวเก่า (ไม่มีแถวเก่าที่มีค่าอยู่แล้ว) แต่บังคับทุกแถวที่เขียนใหม่
  if not exists (
    select 1 from pg_constraint as c
     where c.conrelid = 'public.sales'::regclass and c.conname = 'sales_cash_received_chk'
  ) then
    alter table public.sales
      add constraint sales_cash_received_chk check (cash_received is null or cash_received >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint as c
     where c.conrelid = 'public.sales'::regclass and c.conname = 'sales_refunded_chk'
  ) then
    alter table public.sales
      add constraint sales_refunded_chk check (refunded_amount >= 0) not valid;
  end if;

  -- รายงาน/ปิดยอดค้นบิลตามช่วงเวลา — supabase-indexes.sql มี idx_sales_created อยู่แล้ว (สร้างเฉพาะเมื่อยังไม่มีดัชนีใดเลย)
  if not exists (
    select 1
      from pg_index as i
      join pg_attribute as a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
     where i.indrelid = 'public.sales'::regclass
       and a.attname = 'created_at'
  ) then
    create index idx_sales_created_at on public.sales (created_at);
  end if;
end
$$;

-- ยกเลิกบิล/คืนสินค้า/ตรวจนับ ค้นประวัติสต๊อกด้วยเลขอ้างอิง (บิล/ใบคืน/รอบนับ)
create index if not exists idx_stock_movements_ref on public.stock_movements (ref_id);

-- =========================================================================
-- 3) ตารางใหม่
-- =========================================================================

-- ----- ตัวนับเลขเอกสารรายวัน (เลขใบคืนสินค้า R-YYYYMMDD-NNN) — ภายใน ไม่มีใครอ่าน/เขียนผ่าน API ได้ -----
create table if not exists public.doc_counters (
  kind text not null,
  day date not null,
  n integer not null,
  primary key (kind, day)
);

-- ----- ใบคืนสินค้า (1 ครั้งที่กดคืน = 1 ใบ; คืนหลายครั้งต่อบิลได้จนครบ) -----
create table if not exists public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  return_no text not null unique,
  client_id uuid not null unique,                   -- สุ่มจากเครื่องตอนเปิดหน้าคืนสินค้า — กันบันทึกซ้ำเวลาเน็ตหลุด
  sale_id uuid not null references public.sales (id) on delete cascade,
  refund_amount numeric(10, 2) not null check (refund_amount >= 0),
  refund_method text not null check (refund_method in ('cash', 'transfer', 'credit')),
  restock boolean not null default true,            -- false = ของเสีย/ขายต่อไม่ได้ ไม่บวกสต๊อก
  reason text not null check (char_length(reason) between 1 and 200),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sale_returns_sale on public.sale_returns (sale_id);
create index if not exists idx_sale_returns_created on public.sale_returns (created_at);

create table if not exists public.sale_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.sale_returns (id) on delete cascade,
  sale_id uuid not null references public.sales (id) on delete cascade,
  product_id uuid not null references public.products (id),
  qty integer not null check (qty > 0),
  unit_price numeric(10, 2) not null,
  unit_cost numeric(10, 2),
  refund_amount numeric(10, 2) not null check (refund_amount >= 0)
);

create index if not exists idx_sale_return_items_return on public.sale_return_items (return_id);
create index if not exists idx_sale_return_items_sale on public.sale_return_items (sale_id, product_id);
create index if not exists idx_sale_return_items_product on public.sale_return_items (product_id);

-- ----- ข้อมูลร้านบนใบเสร็จ (มีแถวเดียวเสมอ: id = true) -----
create table if not exists public.shop_settings (
  id boolean primary key default true check (id),
  shop_name text not null default 'NEWCUTE',
  branch_name text,
  address text,
  phone text,
  tax_id text,
  receipt_footer text default 'ขอบคุณที่อุดหนุนค่ะ',
  receipt_paper text not null default '80' check (receipt_paper in ('58', '80')),
  show_cashier boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.shop_settings (id) values (true) on conflict (id) do nothing;

-- ----- ปิดยอดประจำวัน (1 แถวต่อวัน; ปิดใหม่ = เก็บแถวเดิมไว้ใน history แล้วเขียนทับ) -----
create table if not exists public.daily_closings (
  day date primary key,
  opening_cash numeric(10, 2) not null default 0,
  counted_cash numeric(10, 2) not null,
  expected_cash numeric(10, 2) not null,
  cash_diff numeric(10, 2) not null,                -- นับได้ − ควรมี (บวก = เงินเกิน, ลบ = เงินขาด)
  cash_detail jsonb,                                -- {"1000":2,"500":1,...} (นับแยกแบงก์/เหรียญ) หรือ null
  summary jsonb not null,                           -- ภาพรวมของวัน ณ ตอนปิดยอด (get_day_summary)
  note text,
  revision integer not null default 1,
  history jsonb not null default '[]'::jsonb,       -- การปิดยอดครั้งก่อนๆ ของวันนี้ (เก่าสุดก่อน)
  closed_by uuid references auth.users (id) on delete set null,
  closed_by_name text,
  closed_at timestamptz not null default now()
);

-- ----- รอบตรวจนับสต๊อก -----
create table if not exists public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid unique,
  name text not null check (char_length(name) between 1 and 100),
  note text check (note is null or char_length(note) <= 500),
  category_id uuid references public.categories (id) on delete set null,   -- นับเฉพาะหมวด (ใช้แสดงรายการ "ยังไม่นับ")
  status text not null default 'open' check (status in ('open', 'applied', 'cancelled')),
  summary jsonb,                                    -- สรุปตอนปรับยอด
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_by uuid references auth.users (id) on delete set null,
  applied_by_name text,
  applied_at timestamptz,
  cancelled_at timestamptz
);

create index if not exists idx_stock_counts_created on public.stock_counts (created_at);

--   system_qty_at_count = สต๊อกในระบบ ณ ตอนแก้บรรทัดนี้ครั้งล่าสุด
--   ตอนปรับยอด: ยอดใหม่ = สต๊อกตอนนั้น + (นับได้ − system_qty_at_count) → ของที่ขาย/รับเข้าหลังนับ ไม่ถูกนับซ้ำหรือหาย
create table if not exists public.stock_count_items (
  count_id uuid not null references public.stock_counts (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  counted_qty integer not null check (counted_qty between 0 and 1000000),
  system_qty_at_count integer not null,
  applied_before integer,
  applied_after integer,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (count_id, product_id)
);

create index if not exists idx_stock_count_items_product on public.stock_count_items (product_id);

-- คำสั่งนับที่บันทึกแล้ว (ภายใน — อ่าน/เขียนผ่าน set_stock_count_item เท่านั้น)
--   op_id = รหัสที่เครื่องสร้างให้ 1 คำสั่งนับ (เช่น สแกน +3) แล้วส่งรหัสเดิมซ้ำเมื่อเน็ตหลุด/ตอบช้า
--   → รหัสที่เคยบันทึกแล้วไม่ถูกบวกซ้ำ (การสแกนนับครบพอดี 1 ครั้ง ไม่หาย ไม่เบิ้ล)
create table if not exists public.stock_count_ops (
  op_id uuid primary key,
  count_id uuid not null references public.stock_counts (id) on delete cascade,
  product_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_count_ops_count on public.stock_count_ops (count_id);

-- ----- ประวัติการนำเข้าสินค้าจากไฟล์ (client_id = 1 ไฟล์ที่เลือก — กดนำเข้าซ้ำได้ผลเดิม ไม่สร้างซ้ำ) -----
create table if not exists public.product_imports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique,
  row_count integer not null,
  summary jsonb not null,                           -- ผลการนำเข้าทั้งก้อน (คืนให้ตอนกดซ้ำ)
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);

-- ----- RLS + สิทธิ์ตาราง: อ่านตามสิทธิ์ / เขียนผ่านฟังก์ชันเท่านั้น -----
alter table public.doc_counters enable row level security;
revoke all on table public.doc_counters from anon, authenticated;
grant all on table public.doc_counters to service_role;

alter table public.sale_returns enable row level security;
drop policy if exists "sale_returns_select" on public.sale_returns;
create policy "sale_returns_select" on public.sale_returns
  for select to authenticated
  using ((select public.is_member()));
revoke all on table public.sale_returns from anon, authenticated;
grant select on table public.sale_returns to authenticated;
grant all on table public.sale_returns to service_role;

alter table public.sale_return_items enable row level security;
drop policy if exists "sale_return_items_select" on public.sale_return_items;
create policy "sale_return_items_select" on public.sale_return_items
  for select to authenticated
  using ((select public.is_member()));
revoke all on table public.sale_return_items from anon, authenticated;
grant select on table public.sale_return_items to authenticated;
grant all on table public.sale_return_items to service_role;

alter table public.shop_settings enable row level security;
drop policy if exists "shop_settings_select" on public.shop_settings;
create policy "shop_settings_select" on public.shop_settings
  for select to authenticated
  using ((select public.is_member()));
revoke all on table public.shop_settings from anon, authenticated;
grant select on table public.shop_settings to authenticated;
grant all on table public.shop_settings to service_role;

alter table public.daily_closings enable row level security;
drop policy if exists "daily_closings_select" on public.daily_closings;
create policy "daily_closings_select" on public.daily_closings
  for select to authenticated
  using ((select public.has_perm('sales')) or (select public.has_perm('reports')));
revoke all on table public.daily_closings from anon, authenticated;
grant select on table public.daily_closings to authenticated;
grant all on table public.daily_closings to service_role;

alter table public.stock_counts enable row level security;
drop policy if exists "stock_counts_select" on public.stock_counts;
create policy "stock_counts_select" on public.stock_counts
  for select to authenticated
  using ((select public.has_perm('stock')));
revoke all on table public.stock_counts from anon, authenticated;
grant select on table public.stock_counts to authenticated;
grant all on table public.stock_counts to service_role;

alter table public.stock_count_items enable row level security;
drop policy if exists "stock_count_items_select" on public.stock_count_items;
create policy "stock_count_items_select" on public.stock_count_items
  for select to authenticated
  using ((select public.has_perm('stock')));
revoke all on table public.stock_count_items from anon, authenticated;
grant select on table public.stock_count_items to authenticated;
grant all on table public.stock_count_items to service_role;

-- ตารางภายใน: ไม่มี policy และไม่ให้สิทธิ์ anon / authenticated เลย (เหมือน doc_counters)
alter table public.stock_count_ops enable row level security;
revoke all on table public.stock_count_ops from anon, authenticated;
grant all on table public.stock_count_ops to service_role;

alter table public.product_imports enable row level security;
drop policy if exists "product_imports_select" on public.product_imports;
create policy "product_imports_select" on public.product_imports
  for select to authenticated
  using ((select public.has_perm('products')));
revoke all on table public.product_imports from anon, authenticated;
grant select on table public.product_imports to authenticated;
grant all on table public.product_imports to service_role;

-- =========================================================================
-- 4) ตัวช่วยภายใน (เรียกจาก API ไม่ได้)
-- =========================================================================

-- ชื่อผู้ทำรายการ: ชื่อในโปรไฟล์ → ส่วนหน้า @ ของอีเมล → 'ไม่ทราบชื่อ' (ไม่มีผู้ใช้ = null)
create or replace function public.pos_actor_name(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when p_uid is null then null
           else coalesce(
                  (select coalesce(nullif(btrim(up.full_name), ''),
                                   nullif(split_part(coalesce(up.email, au.email), '@', 1), ''))
                     from (select p_uid as id) as x
                     left join public.user_profiles as up on up.id = x.id
                     left join auth.users as au on au.id = x.id),
                  'ไม่ทราบชื่อ')
         end
$$;

-- วันตามปฏิทินไทย (ฐานข้อมูลใช้เวลา UTC — บิล 23:30 น. ไทยต้องนับเป็นวันนั้น ไม่ใช่วันก่อน/วันถัดไป)
create or replace function public.pos_bkk_day(p_ts timestamptz)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (p_ts at time zone 'Asia/Bangkok')::date
$$;

create or replace function public.pos_bkk_today()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (now() at time zone 'Asia/Bangkok')::date
$$;

-- ช่วงเวลาของวัน (ไทย): [00:00 ของวันนั้น, 00:00 ของวันถัดไป)
create or replace function public.pos_day_bounds(p_day date, out p_start timestamptz, out p_end timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select (p_day::timestamp at time zone 'Asia/Bangkok'),
         ((p_day + 1)::timestamp at time zone 'Asia/Bangkok')
$$;

-- เลขใบคืนสินค้าถัดไปของวันนี้ R-YYYYMMDD-NNN (แถวตัวนับถูกล็อกจนจบรายการ → สองเครื่องพร้อมกันไม่ได้เลขซ้ำ)
create or replace function public.pos_next_return_no()
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
  v_prefix := 'R-' || to_char(v_day::timestamp, 'YYYYMMDD') || '-';

  update public.doc_counters as dc
     set n = dc.n + 1
   where dc.kind = 'return' and dc.day = v_day
  returning dc.n into v_n;

  if not found then
    -- ใบแรกของวัน: ต่อจากเลขที่มีอยู่แล้ว (เผื่อตัวนับถูกล้าง) จะได้ไม่ชนกัน
    select coalesce(max(substr(r.return_no, length(v_prefix) + 1)::integer), 0) + 1
      into v_seed
      from public.sale_returns as r
     where r.return_no like (v_prefix || '%')
       and substr(r.return_no, length(v_prefix) + 1) ~ '^[0-9]{1,9}$';

    insert into public.doc_counters as dc (kind, day, n)
    values ('return', v_day, v_seed)
    on conflict (kind, day) do update set n = dc.n + 1
    returning dc.n into v_n;
  end if;

  -- เกิน 999 ใบต่อวันก็ไม่ตัดหลัก (เหมือนเลขบิลขาย)
  return v_prefix || case when v_n < 1000 then lpad(v_n::text, 3, '0') else v_n::text end;
end;
$$;

-- สถานะบิลสำหรับไฟล์ส่งออก (ตรงกับหน้ารายละเอียดบิล) — ดูจาก "จำนวนชิ้นที่คืน" ไม่ใช่ยอดเงิน:
--   คืนทั้งบิล = มีใบคืน และคืนครบทุกชิ้นแล้ว (ปุ่มคืนสินค้ากดไม่ได้อีก)
--   คืนบางส่วน = มีใบคืน (หรือมียอดคืนเงิน) แต่ยังเหลือชิ้นที่คืนได้
--   (ดูจากเงินจะผิด 2 กรณี: บิลมีของแถมราคา 0 → คืนแค่ชิ้นที่จ่ายเงินก็ "ครบยอด" ทั้งที่ของแถมยังคืนได้
--    / บิลยอดสุทธิ 0 → คืนครบทุกชิ้นแต่ยอดคืน 0 เลยดูเหมือน "ปกติ")
-- แบบเก่า (ดูจากเงิน 4 พารามิเตอร์) ลบทิ้ง — ไม่มีใครอื่นเรียก
drop function if exists public.pos_bill_status(timestamptz, numeric, numeric, boolean);

create or replace function public.pos_bill_status(p_voided_at timestamptz, p_refunded numeric,
                                                  p_has_returns boolean, p_all_returned boolean)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case
           when p_voided_at is not null then 'ยกเลิก'
           when coalesce(p_has_returns, false) and coalesce(p_all_returned, false) then 'คืนทั้งบิล'
           when coalesce(p_has_returns, false) or coalesce(p_refunded, 0) > 0 then 'คืนบางส่วน'
           else 'ปกติ'
         end
$$;

-- ช่วงวันที่ของไฟล์ส่งออก: ต้องครบ, ไม่กลับหัว, ไม่เกิน 366 วัน (นับวันแรกและวันสุดท้าย)
create or replace function public.pos_check_range(p_from date, p_to date)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_from is null or p_to is null then
    raise exception 'กรุณาเลือกช่วงวันที่';
  end if;
  if p_to < p_from then
    raise exception 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น';
  end if;
  if p_to - p_from + 1 > 366 then
    raise exception 'ช่วงวันที่ยาวเกินไป (สูงสุด 1 ปี)';
  end if;
end;
$$;

-- =========================================================================
-- 5) sale_json — เพิ่มข้อมูลยกเลิก/คืนเงิน/รับเงิน/พนักงาน (คีย์เดิมทุกตัวเหมือนเดิม)
-- =========================================================================
create or replace function public.sale_json(p_sale_id uuid, p_already_saved boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', s.id,
    'sale_no', s.sale_no,
    'total_amount', s.total_amount,
    'discount', s.discount,
    'net_amount', s.net_amount,
    'payment_method', s.payment_method,
    'channel', s.channel,
    'note', s.note,
    'created_at', s.created_at,
    'already_saved', coalesce(p_already_saved, false),
    'voided_at', s.voided_at,
    'void_reason', s.void_reason,
    'voided_by_name', public.pos_actor_name(s.voided_by),
    'refunded_amount', s.refunded_amount,
    'cash_received', s.cash_received,
    'change_amount', s.change_amount,
    'cashier_name', coalesce(s.created_by_name, public.pos_actor_name(s.created_by)),
    'channel_id', s.channel_id,
    'external_order_id', s.external_order_id,
    'items', coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'product_id', si.product_id,
                   'name', pr.name,
                   'sku', pr.sku,
                   'size', pr.size,
                   'color', pr.color,
                   'qty', si.qty,
                   'unit_price', si.unit_price,
                   'subtotal', si.subtotal,
                   'stock_after', pr.stock_qty
                 )
                 order by pr.name, pr.size, pr.color, si.product_id
               )
          from public.sale_items as si
          join public.products as pr on pr.id = si.product_id
         where si.sale_id = s.id
      ),
      '[]'::jsonb
    )
  )
  from public.sales as s
  where s.id = p_sale_id
$$;

revoke all on function public.sale_json(uuid, boolean) from public, anon, authenticated;

-- =========================================================================
-- 6) record_sale() รับเงินที่รับมา (p_cash_received) — เฉพาะเงินสด: ต้องไม่น้อยกว่ายอดสุทธิ, เก็บเงินทอนในบิล
--    เนื้อฟังก์ชันเหมือน fix-03 ทุกบรรทัด (ตรวจข้อมูล/ล็อก/กันซ้ำ 3 ชั้น/ประวัติสต๊อก) เพิ่มแค่ส่วนรับเงิน + ชื่อพนักงาน
--    ต้องลบแบบ 6 พารามิเตอร์ (fix-03) และแบบ 5 พารามิเตอร์ (fix-01 ถ้ามีคนรันซ้ำ) ก่อน
--    — ไม่งั้นแอปที่เรียกด้วยชื่อพารามิเตอร์ 5-6 ตัวจะกำกวม ("function is not unique")
-- =========================================================================
drop function if exists public.record_sale(uuid, jsonb, numeric, text, text);
drop function if exists public.record_sale(uuid, jsonb, numeric, text, text, text);

create or replace function public.record_sale(
  p_client_id uuid,
  p_items jsonb,
  p_discount numeric default 0,
  p_payment_method text default 'cash',
  p_note text default null,
  p_channel text default 'store',
  p_cash_received numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_existing_id uuid;
  v_count integer;
  v_elem jsonb;
  v_pid_text text;
  v_qty_text text;
  v_qty integer;
  v_raw_ids uuid[] := '{}';
  v_raw_qtys integer[] := '{}';
  v_ids uuid[];
  v_qtys integer[];
  v_n integer;
  v_name text;
  v_size text;
  v_color text;
  v_price numeric;
  v_cost numeric;
  v_stock integer;
  v_active boolean;
  v_label text;
  v_prices numeric[] := '{}';
  v_costs numeric[] := '{}';
  v_befores integer[] := '{}';
  v_total numeric := 0;
  v_discount numeric;
  v_note text;
  v_channel text;
  v_sale_id uuid;
  v_sale_no text;
  v_after integer;
  v_cash numeric;
  v_change numeric;
begin
  -- ----- ผู้ใช้ + สิทธิ์ -----
  if v_uid is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่';
  end if;
  if not public.has_perm('sales') then
    raise exception 'ไม่มีสิทธิ์บันทึกการขาย';
  end if;
  if p_client_id is null then
    raise exception 'ข้อมูลบิลไม่ครบ (ไม่มีรหัสบิล) กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง';
  end if;

  -- ----- บิลนี้บันทึกไปแล้ว (กดซ้ำ/ส่งซ้ำ) → คืนบิลเดิม ไม่ตัดสต๊อกซ้ำ -----
  select s.id into v_existing_id
    from public.sales as s
   where s.client_id = p_client_id;
  if found then
    return public.sale_json(v_existing_id, true);
  end if;

  -- ----- ตรวจรายการสินค้า -----
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'ไม่มีรายการสินค้าในบิล';
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count = 0 then
    raise exception 'ไม่มีรายการสินค้าในบิล';
  end if;
  if v_count > 200 then
    raise exception 'บิลเดียวมีสินค้าได้ไม่เกิน 200 รายการ';
  end if;

  for v_elem in
    select e.elem from jsonb_array_elements(p_items) as e(elem)
  loop
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'รูปแบบรายการสินค้าไม่ถูกต้อง';
    end if;

    v_pid_text := btrim(v_elem ->> 'product_id');
    if v_pid_text is null
       or v_pid_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'รหัสสินค้าในรายการไม่ถูกต้อง';
    end if;

    v_qty_text := btrim(v_elem ->> 'qty');
    if v_qty_text is null or v_qty_text !~ '^[0-9]{1,9}$' then
      raise exception 'จำนวนสินค้าต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป';
    end if;
    v_qty := v_qty_text::integer;
    if v_qty < 1 then
      raise exception 'จำนวนสินค้าต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป';
    end if;
    if v_qty > 100000 then
      raise exception 'จำนวนสินค้าต่อรายการต้องไม่เกิน 100,000 ชิ้น';
    end if;

    v_raw_ids := v_raw_ids || v_pid_text::uuid;
    v_raw_qtys := v_raw_qtys || v_qty;
  end loop;

  -- สินค้าเดียวกันหลายบรรทัด → รวมเป็นบรรทัดเดียว (เรียงตาม id)
  select array_agg(m.pid order by m.pid), array_agg(m.qty order by m.pid)
    into v_ids, v_qtys
    from (
      select x.pid, sum(x.qty)::integer as qty
        from unnest(v_raw_ids, v_raw_qtys) as x(pid, qty)
       group by x.pid
    ) as m;
  v_n := array_length(v_ids, 1);

  -- ----- วิธีชำระ / ช่องทางขาย / ส่วนลด / หมายเหตุ -----
  if p_payment_method is null or p_payment_method not in ('cash', 'transfer', 'credit') then
    raise exception 'วิธีชำระเงินไม่ถูกต้อง';
  end if;

  -- ช่องทางที่บันทึกขายด้วยมือได้ (ออเดอร์จาก LINE SHOPPING / Shopee ฯลฯ เข้าระบบเองผ่านการเชื่อมต่อ)
  v_channel := coalesce(nullif(btrim(p_channel), ''), 'store');
  if v_channel not in ('store', 'facebook', 'instagram', 'line_chat', 'other_chat') then
    raise exception 'ช่องทางขายไม่ถูกต้อง (เลือกได้: หน้าร้าน, Facebook, Instagram, แชต LINE, แชตอื่นๆ)';
  end if;

  v_discount := round(coalesce(p_discount, 0), 2);
  if v_discount < 0 then
    raise exception 'ส่วนลดต้องไม่ติดลบ';
  end if;

  v_note := nullif(btrim(p_note), '');
  if length(v_note) > 500 then
    raise exception 'หมายเหตุยาวเกิน 500 ตัวอักษร';
  end if;

  -- ----- ล็อกสินค้าทุกตัวในบิล เรียงตาม id (กัน deadlock เวลาขายพร้อมกันหลายเครื่อง) -----
  perform 1
     from public.products as p
    where p.id = any (v_ids)
    order by p.id
      for update;

  -- ระหว่างรอล็อก อาจมีคำขอเดียวกัน (client_id เดิม) บันทึกเสร็จไปแล้ว → คืนบิลนั้น
  select s.id into v_existing_id
    from public.sales as s
   where s.client_id = p_client_id;
  if found then
    return public.sale_json(v_existing_id, true);
  end if;

  -- ----- ตรวจสินค้า + สต๊อก, ราคาเอาจากฐานข้อมูลเท่านั้น -----
  for v_i in 1 .. v_n loop
    select p.name, p.size, p.color, p.sell_price, p.cost_price, p.stock_qty, p.is_active
      into v_name, v_size, v_color, v_price, v_cost, v_stock, v_active
      from public.products as p
     where p.id = v_ids[v_i];
    if not found then
      raise exception 'ไม่พบสินค้าบางรายการ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
    end if;

    -- ชื่อ (ไซส์/สี) เช่น เสื้อยืดขาว (M/ขาว)
    v_label := v_name || coalesce(
      ' (' || nullif(concat_ws('/', nullif(btrim(v_size), ''), nullif(btrim(v_color), '')), '') || ')',
      ''
    );

    if not coalesce(v_active, false) then
      raise exception 'สินค้า "%" ถูกปิดใช้งานแล้ว', v_label;
    end if;
    if v_stock < v_qtys[v_i] then
      raise exception 'สต๊อก "%" ไม่พอ เหลือ % ชิ้น', v_label, v_stock;
    end if;

    v_prices := v_prices || coalesce(v_price, 0);
    v_costs := v_costs || coalesce(v_cost, 0);
    v_befores := v_befores || v_stock;
    v_total := v_total + coalesce(v_price, 0) * v_qtys[v_i];
  end loop;

  if v_total > 99999999.99 then
    raise exception 'ยอดรวมเกินขีดจำกัดของระบบ';
  end if;
  if v_discount > v_total then
    raise exception 'ส่วนลดมากกว่ายอดรวมไม่ได้';
  end if;

  -- ----- รับเงินมา / เงินทอน (เงินสดเท่านั้น; ไม่ส่งมา = ไม่บันทึก, วิธีอื่นไม่สนค่าที่ส่งมา) -----
  if p_payment_method = 'cash' and p_cash_received is not null then
    v_cash := round(p_cash_received, 2);
    if v_cash < 0 or v_cash > 99999999.99 then
      raise exception 'จำนวนเงินที่รับมาไม่ถูกต้อง';
    end if;
    if v_cash < v_total - v_discount then
      raise exception 'รับเงินมาไม่พอ ยอดสุทธิ % บาท', to_char(v_total - v_discount, 'FM999,999,990.00');
    end if;
    v_change := v_cash - (v_total - v_discount);
  end if;

  -- ----- บันทึกหัวบิล (sale_no มาจาก trigger set_sale_no) -----
  insert into public.sales as s
    (client_id, total_amount, discount, net_amount, payment_method, note, created_by, channel,
     cash_received, change_amount, created_by_name)
  values
    (p_client_id, v_total, v_discount, v_total - v_discount, p_payment_method, v_note, v_uid, v_channel,
     v_cash, v_change, public.pos_actor_name(v_uid))
  on conflict (client_id) do nothing
  returning s.id, s.sale_no into v_sale_id, v_sale_no;

  if not found then
    -- คำขอเดียวกันอีกเครื่อง/อีกครั้งบันทึกชนะไปก่อน → คืนบิลนั้น
    select s.id into v_existing_id
      from public.sales as s
     where s.client_id = p_client_id;
    if not found then
      raise exception 'บันทึกการขายไม่สำเร็จ กรุณาลองใหม่';
    end if;
    return public.sale_json(v_existing_id, true);
  end if;

  -- ----- รายการสินค้า + ตัดสต๊อก + ประวัติสต๊อก -----
  for v_i in 1 .. v_n loop
    insert into public.sale_items (sale_id, product_id, qty, unit_price, unit_cost, subtotal)
    values (v_sale_id, v_ids[v_i], v_qtys[v_i], v_prices[v_i], v_costs[v_i], v_prices[v_i] * v_qtys[v_i]);

    update public.products as p
       set stock_qty = p.stock_qty - v_qtys[v_i]
     where p.id = v_ids[v_i]
    returning p.stock_qty into v_after;

    insert into public.stock_movements
      (product_id, type, qty, qty_before, qty_after, note, ref_id, created_by)
    values
      (v_ids[v_i], 'out', v_qtys[v_i], v_befores[v_i], v_after, 'ขาย ' || v_sale_no, v_sale_id, v_uid);
  end loop;

  return public.sale_json(v_sale_id, false);
end;
$$;

revoke all on function public.record_sale(uuid, jsonb, numeric, text, text, text, numeric) from public, anon;
grant execute on function public.record_sale(uuid, jsonb, numeric, text, text, text, numeric) to authenticated;

-- =========================================================================
-- 7) รายละเอียดบิล + ยกเลิกบิล + คืนสินค้า
--    ลำดับล็อกเหมือนกันทุกฟังก์ชัน: บิล (sales) ก่อน → สินค้าเรียงตาม id (เหมือน record_sale) → ไม่ deadlock
-- =========================================================================

-- ใบคืนสินค้า 1 ใบเป็น JSON (ภายใน)
create or replace function public.pos_return_json(p_return_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', r.id,
    'return_no', r.return_no,
    'created_at', r.created_at,
    'refund_amount', r.refund_amount,
    'refund_method', r.refund_method,
    'restock', r.restock,
    'reason', r.reason,
    'created_by_name', coalesce(r.created_by_name, public.pos_actor_name(r.created_by)),
    'sale_id', r.sale_id,
    'sale_no', s.sale_no,
    'items', coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'product_id', ri.product_id,
                   'name', pr.name,
                   'sku', pr.sku,
                   'size', pr.size,
                   'color', pr.color,
                   'qty', ri.qty,
                   'unit_price', ri.unit_price,
                   'refund_amount', ri.refund_amount
                 )
                 order by pr.name, pr.size, pr.color, ri.product_id
               )
          from public.sale_return_items as ri
          join public.products as pr on pr.id = ri.product_id
         where ri.return_id = r.id
      ),
      '[]'::jsonb
    )
  )
  from public.sale_returns as r
  join public.sales as s on s.id = r.sale_id
  where r.id = p_return_id
$$;

-- รายละเอียดบิลเต็ม (ภายใน — ผู้เรียกตรวจสิทธิ์เอง): รายการพร้อมจำนวนที่คืนแล้ว/คืนได้อีก, ใบคืนทั้งหมด,
-- ปุ่มยกเลิก/คืนสินค้ากดได้ไหม + เหตุผลภาษาไทยเมื่อกดไม่ได้ (หน้าจอแสดงตามนี้ ไม่ต้องคิดกติกาซ้ำ)
create or replace function public.pos_sale_detail(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s record;
  v_perm boolean := public.has_perm('refunds');
  v_platform boolean;
  v_voided boolean;
  v_has_returns boolean;
  v_items jsonb;
  v_returnable integer;
  v_returns jsonb;
  v_can_void boolean;
  v_void_block text;
  v_void_warning text;
  v_can_return boolean;
  v_return_block text;
  v_platform_msg constant text := 'บิลจากออเดอร์แพลตฟอร์ม ยกเลิกที่หน้าตั้งค่าการเชื่อมต่อ';
begin
  select x.id, x.created_at, x.voided_at, x.channel_id, x.refunded_amount
    into s
    from public.sales as x
   where x.id = p_sale_id;
  if not found then
    return null;
  end if;

  v_platform := s.channel_id is not null;
  v_voided := s.voided_at is not null;
  v_has_returns := s.refunded_amount > 0
                   or exists (select 1 from public.sale_returns as r where r.sale_id = s.id);

  -- รวมบรรทัดตามสินค้า (ปกติ record_sale รวมให้แล้ว — กันไว้เผื่อข้อมูลเก่า)
  with li as (
    select si.product_id,
           sum(si.qty)::integer as qty,
           sum(si.subtotal) as subtotal,
           case when count(distinct si.unit_price) = 1 then min(si.unit_price)
                else round(sum(si.subtotal) / nullif(sum(si.qty), 0), 2) end as unit_price
      from public.sale_items as si
     where si.sale_id = s.id
     group by si.product_id
  ),
  rt as (
    select ri.product_id, sum(ri.qty)::integer as qty
      from public.sale_return_items as ri
     where ri.sale_id = s.id
     group by ri.product_id
  ),
  x as (
    select li.*, pr.name, pr.sku, pr.barcode, pr.size, pr.color, pr.stock_qty,
           coalesce(rt.qty, 0) as returned_qty,
           case when v_voided or v_platform then 0
                else greatest(li.qty - coalesce(rt.qty, 0), 0) end as returnable_qty
      from li
      join public.products as pr on pr.id = li.product_id
      left join rt on rt.product_id = li.product_id
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'product_id', x.product_id,
             'name', x.name,
             'sku', x.sku,
             'barcode', x.barcode,
             'size', x.size,
             'color', x.color,
             'qty', x.qty,
             'unit_price', x.unit_price,
             'subtotal', x.subtotal,
             'stock_after', x.stock_qty,
             'returned_qty', x.returned_qty,
             'returnable_qty', x.returnable_qty
           )
           order by x.name, x.size, x.color, x.product_id
         ), '[]'::jsonb),
         coalesce(sum(x.returnable_qty), 0)::integer
    into v_items, v_returnable
    from x;

  select coalesce(jsonb_agg(public.pos_return_json(r.id) - 'sale_id' - 'sale_no' order by r.created_at, r.return_no),
                  '[]'::jsonb)
    into v_returns
    from public.sale_returns as r
   where r.sale_id = s.id;

  v_void_block := case
    when not v_perm then 'ไม่มีสิทธิ์ยกเลิกบิล'
    when v_voided then 'บิลนี้ถูกยกเลิกแล้ว'
    when v_platform then v_platform_msg
    when v_has_returns then 'บิลนี้มีการคืนสินค้าแล้ว ใช้ "คืนสินค้า" กับส่วนที่เหลือแทน'
    when public.pos_bkk_day(s.created_at) <> public.pos_bkk_today() and not public.is_admin()
      then 'ยกเลิกได้เฉพาะบิลของวันนี้ บิลวันก่อนให้ใช้ "คืนสินค้า" (หรือให้แอดมินยกเลิก)'
    else null
  end;
  v_can_void := v_void_block is null;

  -- แอดมินยกเลิกบิลของวันก่อน: ยกเลิก = "บิลนี้ไม่ควรเกิดขึ้น" (คีย์ผิด/ทดลองระบบ) → ยอดของวันที่ขายลดลง
  -- (ถ้าปิดยอดวันนั้นแล้ว หน้าปิดยอดจะเตือนให้ปิดใหม่) และไม่แตะเงินสดของวันนี้
  -- ถ้าเป็นการคืนเงินให้ลูกค้าวันนี้ ต้องใช้ "คืนสินค้า" — เงินคืนจะไปอยู่ในยอดของวันที่คืนจริง ลิ้นชักวันนี้จึงตรง
  -- → ส่งคำเตือนนี้ให้หน้าต่างยกเลิกบิลแสดงก่อนกดยืนยัน
  if v_can_void and public.pos_bkk_day(s.created_at) <> public.pos_bkk_today() then
    v_void_warning := format(
      'บิลนี้เป็นของวันที่ %s — ยกเลิกแล้วยอดขายของวันนั้นจะลดลง (ถ้าปิดยอดวันนั้นไปแล้ว ต้องปิดยอดใหม่) '
      || 'และจะไม่หักจากเงินสดในลิ้นชักวันนี้ ถ้าคืนเงินให้ลูกค้าวันนี้ ให้ใช้ "คืนสินค้า" แทน',
      to_char(public.pos_bkk_day(s.created_at), 'DD/MM/')
        || (extract(year from public.pos_bkk_day(s.created_at))::integer + 543)::text);
  end if;

  v_return_block := case
    when not v_perm then 'ไม่มีสิทธิ์คืนสินค้า'
    when v_voided then 'บิลนี้ถูกยกเลิกแล้ว'
    when v_platform then v_platform_msg
    when v_returnable <= 0 then 'คืนสินค้าครบทุกชิ้นแล้ว'
    else null
  end;
  v_can_return := v_return_block is null;

  return (public.sale_json(s.id, false) - 'already_saved')
         || jsonb_build_object(
              'items', v_items,
              'returns', v_returns,
              'is_platform', v_platform,
              'can_void', v_can_void,
              'void_block', v_void_block,
              'void_warning', v_void_warning,
              'can_return', v_can_return,
              'return_block', v_return_block
            );
end;
$$;

-- -------------------------------------------------------------------------
-- get_sale_detail(p_sale_id) — รายละเอียดบิลสำหรับหน้าประวัติบิล (พนักงานของร้านทุกคนดูได้)
-- -------------------------------------------------------------------------
create or replace function public.get_sale_detail(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่' using errcode = '42501';
  end if;
  if not public.is_member() then
    raise exception 'ไม่มีสิทธิ์ดูบิล' using errcode = '42501';
  end if;
  v_result := public.pos_sale_detail(p_sale_id);
  if v_result is null then
    raise exception 'ไม่พบบิลนี้';
  end if;
  return v_result;
end;
$$;

-- -------------------------------------------------------------------------
-- void_sale(p_sale_id, p_reason) — ยกเลิกทั้งบิล: คืนสต๊อกทุกรายการ + ติดธงยกเลิก (ยอดเงินในบิลคงไว้ รายงานไม่นับ)
--   กดซ้ำ (บิลยกเลิกไปแล้ว) = คืนผลเดิม already_voided = true ไม่คืนสต๊อกซ้ำ
--   บิลวันก่อน: เฉพาะแอดมิน (พนักงานใช้ "คืนสินค้า" แทน — เงินที่คืนจะไปอยู่ในยอดของวันที่คืนจริง)
-- -------------------------------------------------------------------------
create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text;
  s record;
  v_line record;
  v_after integer;
begin
  if v_uid is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่' using errcode = '42501';
  end if;
  if not public.has_perm('refunds') then
    raise exception 'ไม่มีสิทธิ์ยกเลิกบิล' using errcode = '42501';
  end if;

  v_reason := nullif(public.product_clean_text(p_reason), '');
  if v_reason is null or char_length(v_reason) > 200 then
    raise exception 'กรุณาระบุเหตุผลที่ยกเลิก (ไม่เกิน 200 ตัวอักษร)';
  end if;
  if p_sale_id is null then
    raise exception 'ไม่พบบิลนี้';
  end if;

  -- ล็อกบิลก่อน (กันยกเลิก/คืนสินค้าพร้อมกันสองเครื่อง)
  select x.id, x.sale_no, x.created_at, x.voided_at, x.channel_id, x.refunded_amount
    into s
    from public.sales as x
   where x.id = p_sale_id
     for update;
  if not found then
    raise exception 'ไม่พบบิลนี้';
  end if;

  if s.voided_at is not null then
    return jsonb_build_object('already_voided', true, 'sale', public.pos_sale_detail(s.id));
  end if;
  if s.channel_id is not null then
    raise exception 'บิลจากออเดอร์แพลตฟอร์ม ยกเลิกที่หน้าตั้งค่าการเชื่อมต่อ';
  end if;
  if s.refunded_amount > 0 or exists (select 1 from public.sale_returns as r where r.sale_id = s.id) then
    raise exception 'บิลนี้มีการคืนสินค้าแล้ว ใช้ "คืนสินค้า" กับส่วนที่เหลือแทน';
  end if;
  if public.pos_bkk_day(s.created_at) <> public.pos_bkk_today() and not public.is_admin() then
    raise exception 'ยกเลิกได้เฉพาะบิลของวันนี้ บิลวันก่อนให้ใช้ "คืนสินค้า" (หรือให้แอดมินยกเลิก)';
  end if;

  -- ล็อกสินค้าในบิล เรียงตาม id (ลำดับเดียวกับ record_sale)
  perform 1
     from public.products as p
    where p.id in (select si.product_id from public.sale_items as si where si.sale_id = s.id)
    order by p.id
      for update;

  for v_line in
    select si.product_id, sum(si.qty)::integer as qty
      from public.sale_items as si
     where si.sale_id = s.id
     group by si.product_id
     order by si.product_id
  loop
    update public.products as p
       set stock_qty = p.stock_qty + v_line.qty
     where p.id = v_line.product_id
    returning p.stock_qty into v_after;

    insert into public.stock_movements
      (product_id, type, qty, qty_before, qty_after, note, ref_id, created_by)
    values
      (v_line.product_id, 'return', v_line.qty, v_after - v_line.qty, v_after, 'ยกเลิกบิล ' || s.sale_no, s.id, v_uid);
  end loop;

  update public.sales as x
     set voided_at = now(),
         voided_by = v_uid,
         void_reason = v_reason
   where x.id = s.id;

  return jsonb_build_object('already_voided', false, 'sale', public.pos_sale_detail(s.id));
end;
$$;

-- -------------------------------------------------------------------------
-- return_sale_items(p_client_id, p_sale_id, p_items, p_reason, p_refund_method, p_restock)
--   คืนสินค้าบางส่วนหรือทั้งหมด (คืนได้หลายครั้งต่อบิล จนครบจำนวนที่ขาย) — ยอดเงินคืนคำนวณที่นี่เท่านั้น:
--     ต่อบรรทัด = ราคา × จำนวน × (ยอดสุทธิ ÷ ยอดรวม) ปัด 2 ตำแหน่ง (ส่วนลดของบิลกระจายตามสัดส่วน)
--     คืนครบทุกชิ้นของบิล = คืน "ยอดสุทธิที่เหลือ" พอดี (เศษสตางค์ไปอยู่บรรทัดที่มูลค่าสูงสุด) → รวมทุกใบคืน = ยอดสุทธิของบิลเป๊ะ
--     และไม่มีทางคืนเกินยอดสุทธิ
--   p_items = [{product_id, qty}] (สินค้าเดิมหลายบรรทัด = รวมกัน)
--   p_refund_method ไม่ส่ง = วิธีเดียวกับตอนจ่าย, p_restock = false → ไม่บวกสต๊อก (ของเสีย)
--   p_client_id ส่งซ้ำ = คืนใบเดิม already_saved = true
-- -------------------------------------------------------------------------
create or replace function public.return_sale_items(
  p_client_id uuid,
  p_sale_id uuid,
  p_items jsonb,
  p_reason text,
  p_refund_method text default null,
  p_restock boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_existing record;
  v_reason text;
  v_count integer;
  v_elem jsonb;
  v_pid_text text;
  v_qty_text text;
  v_qty integer;
  v_raw_ids uuid[] := '{}';
  v_raw_qtys integer[] := '{}';
  v_ids uuid[];
  v_qtys integer[];
  v_n integer;
  s record;
  v_method text;
  v_restock boolean := coalesce(p_restock, true);
  v_sold integer;
  v_line_total numeric;
  v_price numeric;
  v_cost numeric;
  v_returned integer;
  v_label text;
  v_prices numeric[] := '{}';
  v_costs numeric[] := '{}';
  v_refunds numeric[] := '{}';
  v_total numeric;
  v_net numeric;
  v_already numeric;
  v_sum numeric := 0;
  v_refund numeric;
  v_delta numeric;
  v_take numeric;
  v_best integer;
  v_full boolean;
  v_return_id uuid;
  v_return_no text;
  v_after integer;
begin
  -- ----- ผู้ใช้ + สิทธิ์ -----
  if v_uid is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่' using errcode = '42501';
  end if;
  if not public.has_perm('refunds') then
    raise exception 'ไม่มีสิทธิ์คืนสินค้า' using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'ข้อมูลไม่ครบ กรุณาโหลดหน้าใหม่';
  end if;

  -- ----- ใบนี้บันทึกไปแล้ว (กดซ้ำ/ส่งซ้ำ) → คืนใบเดิม ไม่คืนเงิน/สต๊อกซ้ำ -----
  select r.id, r.sale_id into v_existing
    from public.sale_returns as r
   where r.client_id = p_client_id;
  if found then
    return jsonb_build_object('already_saved', true,
                              'return', public.pos_return_json(v_existing.id),
                              'sale', public.pos_sale_detail(v_existing.sale_id));
  end if;

  v_reason := nullif(public.product_clean_text(p_reason), '');
  if v_reason is null or char_length(v_reason) > 200 then
    raise exception 'กรุณาระบุเหตุผลการคืนสินค้า (ไม่เกิน 200 ตัวอักษร)';
  end if;

  -- ----- ตรวจรายการ (กติกาเดียวกับ record_sale) -----
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'ไม่มีรายการสินค้าที่จะคืน';
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count = 0 then
    raise exception 'ไม่มีรายการสินค้าที่จะคืน';
  end if;
  if v_count > 200 then
    raise exception 'คืนได้ครั้งละไม่เกิน 200 รายการ';
  end if;

  for v_elem in
    select e.elem from jsonb_array_elements(p_items) as e(elem)
  loop
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'รูปแบบรายการสินค้าไม่ถูกต้อง';
    end if;

    v_pid_text := btrim(v_elem ->> 'product_id');
    if v_pid_text is null
       or v_pid_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'รหัสสินค้าในรายการไม่ถูกต้อง';
    end if;

    v_qty_text := btrim(v_elem ->> 'qty');
    if v_qty_text is null or v_qty_text !~ '^[0-9]{1,9}$' then
      raise exception 'จำนวนที่คืนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป';
    end if;
    v_qty := v_qty_text::integer;
    if v_qty < 1 then
      raise exception 'จำนวนที่คืนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป';
    end if;
    if v_qty > 100000 then
      raise exception 'จำนวนที่คืนต่อรายการต้องไม่เกิน 100,000 ชิ้น';
    end if;

    v_raw_ids := v_raw_ids || v_pid_text::uuid;
    v_raw_qtys := v_raw_qtys || v_qty;
  end loop;

  select array_agg(m.pid order by m.pid), array_agg(m.qty order by m.pid)
    into v_ids, v_qtys
    from (
      select x.pid, sum(x.qty)::integer as qty
        from unnest(v_raw_ids, v_raw_qtys) as x(pid, qty)
       group by x.pid
    ) as m;
  v_n := array_length(v_ids, 1);

  -- ----- ล็อกบิล (ลำดับ: บิล → สินค้า) -----
  if p_sale_id is null then
    raise exception 'ไม่พบบิลนี้';
  end if;
  select x.id, x.sale_no, x.total_amount, x.net_amount, x.payment_method, x.voided_at, x.channel_id
    into s
    from public.sales as x
   where x.id = p_sale_id
     for update;
  if not found then
    raise exception 'ไม่พบบิลนี้';
  end if;

  -- ระหว่างรอล็อก คำขอเดียวกันอาจบันทึกเสร็จไปแล้ว
  select r.id, r.sale_id into v_existing
    from public.sale_returns as r
   where r.client_id = p_client_id;
  if found then
    return jsonb_build_object('already_saved', true,
                              'return', public.pos_return_json(v_existing.id),
                              'sale', public.pos_sale_detail(v_existing.sale_id));
  end if;

  if s.voided_at is not null then
    raise exception 'บิลนี้ถูกยกเลิกแล้ว';
  end if;
  if s.channel_id is not null then
    raise exception 'บิลจากออเดอร์แพลตฟอร์ม ยกเลิกที่หน้าตั้งค่าการเชื่อมต่อ';
  end if;

  v_method := coalesce(nullif(btrim(p_refund_method), ''), s.payment_method);
  if v_method not in ('cash', 'transfer', 'credit') then
    raise exception 'วิธีคืนเงินไม่ถูกต้อง';
  end if;

  -- ----- จำนวนที่คืนได้ + ราคาต่อชิ้นจากบิล (ไม่ใช่ราคาปัจจุบัน) -----
  for v_i in 1 .. v_n loop
    select sum(si.qty)::integer,
           sum(si.subtotal),
           case when count(distinct si.unit_price) = 1 then min(si.unit_price)
                else round(sum(si.subtotal) / nullif(sum(si.qty), 0), 2) end,
           case when count(distinct si.unit_cost) <= 1 then min(si.unit_cost)
                else round(sum(si.unit_cost * si.qty) / nullif(sum(si.qty), 0), 2) end
      into v_sold, v_line_total, v_price, v_cost
      from public.sale_items as si
     where si.sale_id = s.id
       and si.product_id = v_ids[v_i];

    select p.name || coalesce(
             ' (' || nullif(concat_ws('/', nullif(btrim(p.size), ''), nullif(btrim(p.color), '')), '') || ')', '')
      into v_label
      from public.products as p
     where p.id = v_ids[v_i];
    v_label := coalesce(v_label, 'สินค้าที่ถูกลบไปแล้ว');

    if v_sold is null then
      raise exception 'สินค้า "%" ไม่ได้อยู่ในบิลนี้', v_label;
    end if;

    select coalesce(sum(ri.qty), 0)::integer into v_returned
      from public.sale_return_items as ri
     where ri.sale_id = s.id
       and ri.product_id = v_ids[v_i];

    if v_qtys[v_i] > v_sold - v_returned then
      raise exception 'คืน "%" ได้อีกไม่เกิน % ชิ้น', v_label, greatest(v_sold - v_returned, 0);
    end if;

    v_prices := v_prices || coalesce(v_price, 0);
    v_costs := v_costs || v_cost;
  end loop;

  -- ----- ยอดเงินคืน (คำนวณที่ฐานข้อมูลเท่านั้น) -----
  v_total := s.total_amount;
  v_net := s.net_amount;
  select coalesce(sum(r.refund_amount), 0) into v_already
    from public.sale_returns as r
   where r.sale_id = s.id;

  for v_i in 1 .. v_n loop
    v_refunds := v_refunds
                 || case when v_total > 0 then round(v_prices[v_i] * v_qtys[v_i] * v_net / v_total, 2) else 0 end;
    v_sum := v_sum + v_refunds[v_i];
  end loop;
  v_refund := v_sum;

  -- คืนครบทุกชิ้นของบิลหลังใบนี้ไหม (นับรวมใบก่อนๆ)
  select not exists (
           select 1
             from (select si.product_id, sum(si.qty) as sold
                     from public.sale_items as si
                    where si.sale_id = s.id
                    group by si.product_id) as a
             left join (select ri.product_id, sum(ri.qty) as ret
                          from public.sale_return_items as ri
                         where ri.sale_id = s.id
                         group by ri.product_id) as b on b.product_id = a.product_id
             left join unnest(v_ids, v_qtys) as t(pid, qty) on t.pid = a.product_id
            where a.sold > coalesce(b.ret, 0) + coalesce(t.qty, 0)
         )
    into v_full;

  if v_full then
    v_refund := v_net - v_already;
  end if;
  v_refund := greatest(least(v_refund, v_net - v_already), 0);

  -- ปรับบรรทัดให้รวมกันได้เท่ายอดคืนพอดี:
  --   เพิ่ม (เศษสตางค์ตอนคืนครบบิล) → บรรทัดที่มูลค่า ราคา × จำนวน สูงสุด (เท่ากันเลือกตัวท้าย)
  --     — ไม่ใช่บรรทัดท้ายสุดเฉยๆ ซึ่งอาจเป็นของแถมราคา 0 → ใบคืนจะโชว์ว่าคืนเงินค่าของแถม
  --   ลด → ไล่ลดจากบรรทัดท้ายขึ้นมา (ไม่ติดลบ)
  v_delta := v_refund - v_sum;
  if v_delta > 0 then
    v_best := v_n;
    for v_i in reverse v_n .. 1 loop
      if v_prices[v_i] * v_qtys[v_i] > v_prices[v_best] * v_qtys[v_best] then
        v_best := v_i;
      end if;
    end loop;
    v_refunds[v_best] := v_refunds[v_best] + v_delta;
  elsif v_delta < 0 then
    for v_i in reverse v_n .. 1 loop
      exit when v_delta = 0;
      v_take := least(v_refunds[v_i], -v_delta);
      v_refunds[v_i] := v_refunds[v_i] - v_take;
      v_delta := v_delta + v_take;
    end loop;
  end if;

  -- ----- บันทึกใบคืน -----
  v_return_no := public.pos_next_return_no();

  insert into public.sale_returns as r
    (return_no, client_id, sale_id, refund_amount, refund_method, restock, reason, created_by, created_by_name)
  values
    (v_return_no, p_client_id, s.id, v_refund, v_method, v_restock, v_reason, v_uid, public.pos_actor_name(v_uid))
  on conflict (client_id) do nothing
  returning r.id into v_return_id;

  if not found then
    -- คำขอเดียวกันอีกเครื่องบันทึกชนะไปก่อน → คืนใบนั้น
    select r.id, r.sale_id into v_existing
      from public.sale_returns as r
     where r.client_id = p_client_id;
    if not found then
      raise exception 'บันทึกการคืนสินค้าไม่สำเร็จ กรุณาลองใหม่';
    end if;
    return jsonb_build_object('already_saved', true,
                              'return', public.pos_return_json(v_existing.id),
                              'sale', public.pos_sale_detail(v_existing.sale_id));
  end if;

  if v_restock then
    perform 1
       from public.products as p
      where p.id = any (v_ids)
      order by p.id
        for update;
  end if;

  for v_i in 1 .. v_n loop
    insert into public.sale_return_items (return_id, sale_id, product_id, qty, unit_price, unit_cost, refund_amount)
    values (v_return_id, s.id, v_ids[v_i], v_qtys[v_i], v_prices[v_i], v_costs[v_i], v_refunds[v_i]);

    if v_restock then
      update public.products as p
         set stock_qty = p.stock_qty + v_qtys[v_i]
       where p.id = v_ids[v_i]
      returning p.stock_qty into v_after;

      insert into public.stock_movements
        (product_id, type, qty, qty_before, qty_after, note, ref_id, created_by)
      values
        (v_ids[v_i], 'return', v_qtys[v_i], v_after - v_qtys[v_i], v_after,
         'คืนสินค้า ' || v_return_no || ' บิล ' || s.sale_no, s.id, v_uid);
    end if;
  end loop;

  update public.sales as x
     set refunded_amount = x.refunded_amount + v_refund
   where x.id = s.id;

  return jsonb_build_object('already_saved', false,
                            'return', public.pos_return_json(v_return_id),
                            'sale', public.pos_sale_detail(s.id));
end;
$$;

-- =========================================================================
-- 8) ข้อมูลร้าน / ใบเสร็จ
-- =========================================================================
create or replace function public.pos_shop_settings_json()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object(
              'shop_name', ss.shop_name,
              'branch_name', ss.branch_name,
              'address', ss.address,
              'phone', ss.phone,
              'tax_id', ss.tax_id,
              'receipt_footer', ss.receipt_footer,
              'receipt_paper', ss.receipt_paper,
              'show_cashier', ss.show_cashier,
              'updated_at', ss.updated_at)
       from public.shop_settings as ss
      where ss.id),
    jsonb_build_object(
      'shop_name', 'NEWCUTE', 'branch_name', null, 'address', null, 'phone', null, 'tax_id', null,
      'receipt_footer', 'ขอบคุณที่อุดหนุนค่ะ', 'receipt_paper', '80', 'show_cashier', true, 'updated_at', null)
  )
$$;

create or replace function public.get_shop_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่' using errcode = '42501';
  end if;
  if not public.is_member() then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลร้าน' using errcode = '42501';
  end if;
  return public.pos_shop_settings_json();
end;
$$;

-- p_settings = ค่าทั้งชุด (ช่องว่าง/ไม่ส่ง = ไม่มีค่า ยกเว้นชื่อร้านที่ต้องมีเสมอ)
create or replace function public.save_shop_settings(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_branch text;
  v_address text;
  v_phone text;
  v_tax text;
  v_footer text;
  v_paper text;
  v_show boolean;
begin
  if v_uid is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่' using errcode = '42501';
  end if;
  if not public.is_admin() then
    raise exception 'เฉพาะแอดมินเท่านั้น' using errcode = '42501';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'ข้อมูลร้านไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;

  v_name := public.product_json_text(p_settings -> 'shop_name', 'ชื่อร้าน');
  if v_name is null or char_length(v_name) > 100 then
    raise exception 'กรุณาใส่ชื่อร้าน (ไม่เกิน 100 ตัวอักษร)';
  end if;

  v_branch := public.product_json_text(p_settings -> 'branch_name', 'ชื่อสาขา');
  if char_length(v_branch) > 100 then
    raise exception 'ชื่อสาขายาวเกินไป (สูงสุด 100 ตัวอักษร)';
  end if;

  v_address := public.product_json_text(p_settings -> 'address', 'ที่อยู่');
  if char_length(v_address) > 300 then
    raise exception 'ที่อยู่ยาวเกินไป (สูงสุด 300 ตัวอักษร)';
  end if;

  v_phone := public.product_json_text(p_settings -> 'phone', 'เบอร์โทร');
  if char_length(v_phone) > 50 then
    raise exception 'เบอร์โทรยาวเกินไป (สูงสุด 50 ตัวอักษร)';
  end if;

  v_tax := public.product_json_text(p_settings -> 'tax_id', 'เลขผู้เสียภาษี');
  if v_tax is not null and v_tax !~ '^[0-9 -]*$' then
    raise exception 'เลขผู้เสียภาษีใส่ได้เฉพาะตัวเลข';
  end if;
  if char_length(v_tax) > 20 then
    raise exception 'เลขผู้เสียภาษียาวเกินไป (สูงสุด 20 ตัวอักษร)';
  end if;

  v_footer := public.product_json_text(p_settings -> 'receipt_footer', 'ข้อความท้ายใบเสร็จ');
  if char_length(v_footer) > 300 then
    raise exception 'ข้อความท้ายใบเสร็จยาวเกินไป (สูงสุด 300 ตัวอักษร)';
  end if;

  v_paper := coalesce(public.product_json_text(p_settings -> 'receipt_paper', 'ขนาดกระดาษ'), '80');
  if v_paper not in ('58', '80') then
    raise exception 'ขนาดกระดาษใบเสร็จต้องเป็น 58 หรือ 80 มม.';
  end if;

  v_show := coalesce(public.product_json_bool(p_settings -> 'show_cashier', 'การแสดงชื่อพนักงาน'), true);

  insert into public.shop_settings as ss
    (id, shop_name, branch_name, address, phone, tax_id, receipt_footer, receipt_paper, show_cashier, updated_at, updated_by)
  values
    (true, v_name, v_branch, v_address, v_phone, v_tax, v_footer, v_paper, v_show, now(), v_uid)
  on conflict (id) do update
    set shop_name = excluded.shop_name,
        branch_name = excluded.branch_name,
        address = excluded.address,
        phone = excluded.phone,
        tax_id = excluded.tax_id,
        receipt_footer = excluded.receipt_footer,
        receipt_paper = excluded.receipt_paper,
        show_cashier = excluded.show_cashier,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;

  return public.pos_shop_settings_json();
end;
$$;

-- =========================================================================
-- 9) ปิดยอดประจำวัน
--    วัน = ปฏิทินไทยเสมอ; บิลที่ยกเลิกไม่นับในยอดขาย (แสดงแยก); เงินคืนนับในวันที่ "คืนจริง" (ไม่ใช่วันที่ขาย)
--    บิลจากแพลตฟอร์ม (marketplace) นับในยอดขาย แต่ไม่เข้าเงินสดในลิ้นชัก
-- =========================================================================

-- ภาพรวมของวัน (ภายใน — ไม่มีคีย์ closing / changed_since_close)
create or replace function public.pos_day_summary_core(p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_bills integer;
  v_gross numeric;
  v_discount numeric;
  v_net numeric;
  v_items integer;
  v_by_method jsonb;
  v_by_channel jsonb;
  v_void_count integer;
  v_void_amount numeric;
  v_first timestamptz;
  v_last timestamptz;
  v_ref_count integer;
  v_ref_amount numeric;
  v_ref_cash numeric;
  v_ref_transfer numeric;
  v_ref_credit numeric;
  v_cash_sales numeric;
begin
  select b.p_start, b.p_end into v_start, v_end from public.pos_day_bounds(p_day) as b;

  select count(*) filter (where s.voided_at is null)::integer,
         round(coalesce(sum(s.total_amount) filter (where s.voided_at is null), 0), 2),
         round(coalesce(sum(s.discount) filter (where s.voided_at is null), 0), 2),
         round(coalesce(sum(s.net_amount) filter (where s.voided_at is null), 0), 2),
         count(*) filter (where s.voided_at is not null)::integer,
         round(coalesce(sum(s.net_amount) filter (where s.voided_at is not null), 0), 2),
         min(s.created_at) filter (where s.voided_at is null),
         max(s.created_at) filter (where s.voided_at is null),
         jsonb_build_object(
           'cash', jsonb_build_object(
             'count', count(*) filter (where s.voided_at is null and s.payment_method = 'cash'),
             'amount', round(coalesce(sum(s.net_amount) filter (where s.voided_at is null and s.payment_method = 'cash'), 0), 2)),
           'transfer', jsonb_build_object(
             'count', count(*) filter (where s.voided_at is null and s.payment_method = 'transfer'),
             'amount', round(coalesce(sum(s.net_amount) filter (where s.voided_at is null and s.payment_method = 'transfer'), 0), 2)),
           'credit', jsonb_build_object(
             'count', count(*) filter (where s.voided_at is null and s.payment_method = 'credit'),
             'amount', round(coalesce(sum(s.net_amount) filter (where s.voided_at is null and s.payment_method = 'credit'), 0), 2)),
           'marketplace', jsonb_build_object(
             'count', count(*) filter (where s.voided_at is null and s.payment_method = 'marketplace'),
             'amount', round(coalesce(sum(s.net_amount) filter (where s.voided_at is null and s.payment_method = 'marketplace'), 0), 2))
         ),
         round(coalesce(sum(s.net_amount) filter (where s.voided_at is null and s.payment_method = 'cash'), 0), 2)
    into v_bills, v_gross, v_discount, v_net, v_void_count, v_void_amount, v_first, v_last, v_by_method, v_cash_sales
    from public.sales as s
   where s.created_at >= v_start
     and s.created_at < v_end;

  select coalesce(jsonb_agg(jsonb_build_object('channel', c.channel, 'count', c.n, 'amount', c.amount)
                            order by c.amount desc, c.channel), '[]'::jsonb)
    into v_by_channel
    from (
      select s.channel, count(*)::integer as n, round(coalesce(sum(s.net_amount), 0), 2) as amount
        from public.sales as s
       where s.created_at >= v_start
         and s.created_at < v_end
         and s.voided_at is null
       group by s.channel
    ) as c;

  select coalesce(sum(si.qty), 0)::integer
    into v_items
    from public.sale_items as si
    join public.sales as s on s.id = si.sale_id
   where s.created_at >= v_start
     and s.created_at < v_end
     and s.voided_at is null;

  select count(*)::integer,
         round(coalesce(sum(r.refund_amount), 0), 2),
         round(coalesce(sum(r.refund_amount) filter (where r.refund_method = 'cash'), 0), 2),
         round(coalesce(sum(r.refund_amount) filter (where r.refund_method = 'transfer'), 0), 2),
         round(coalesce(sum(r.refund_amount) filter (where r.refund_method = 'credit'), 0), 2)
    into v_ref_count, v_ref_amount, v_ref_cash, v_ref_transfer, v_ref_credit
    from public.sale_returns as r
   where r.created_at >= v_start
     and r.created_at < v_end;

  return jsonb_build_object(
    'day', to_char(p_day::timestamp, 'YYYY-MM-DD'),
    'is_today', p_day = public.pos_bkk_today(),
    'bills', v_bills,
    'gross', v_gross,
    'discount', v_discount,
    'net', v_net,
    'items_qty', v_items,
    'by_method', v_by_method,
    'by_channel', v_by_channel,
    'voided', jsonb_build_object('count', v_void_count, 'amount', v_void_amount),
    'refunds', jsonb_build_object(
      'count', v_ref_count,
      'amount', v_ref_amount,
      'by_method', jsonb_build_object('cash', v_ref_cash, 'transfer', v_ref_transfer, 'credit', v_ref_credit)),
    'net_after_refunds', round(v_net - v_ref_amount, 2),
    'cash_sales', v_cash_sales,
    'cash_refunds', v_ref_cash,
    'first_bill_at', v_first,
    'last_bill_at', v_last
  );
end;
$$;

-- ภาพรวม + การปิดยอดของวันนั้น (ภายใน)
create or replace function public.pos_day_summary_full(p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_core jsonb := public.pos_day_summary_core(p_day);
  v_closing jsonb;
  v_changed boolean := false;
begin
  select jsonb_build_object(
           'day', to_char(c.day::timestamp, 'YYYY-MM-DD'),
           'opening_cash', c.opening_cash,
           'counted_cash', c.counted_cash,
           'expected_cash', c.expected_cash,
           'cash_diff', c.cash_diff,
           'cash_detail', c.cash_detail,
           'note', c.note,
           'revision', c.revision,
           'closed_by_name', coalesce(c.closed_by_name, public.pos_actor_name(c.closed_by)),
           'closed_at', c.closed_at,
           'summary', c.summary)
    into v_closing
    from public.daily_closings as c
   where c.day = p_day;

  if v_closing is not null then
    -- มีบิล/การคืนเงิน/การยกเลิกเกิดขึ้นหลังปิดยอด → หน้าจอเตือนให้ปิดยอดใหม่
    v_changed :=
         (v_core ->> 'net')::numeric is distinct from (v_closing -> 'summary' ->> 'net')::numeric
      or (v_core -> 'refunds' ->> 'amount')::numeric is distinct from (v_closing -> 'summary' -> 'refunds' ->> 'amount')::numeric
      or (v_core ->> 'cash_sales')::numeric is distinct from (v_closing -> 'summary' ->> 'cash_sales')::numeric
      or (v_core ->> 'cash_refunds')::numeric is distinct from (v_closing -> 'summary' ->> 'cash_refunds')::numeric
      or (v_core ->> 'bills')::integer is distinct from (v_closing -> 'summary' ->> 'bills')::integer
      or (v_core -> 'voided' ->> 'count')::integer is distinct from (v_closing -> 'summary' -> 'voided' ->> 'count')::integer;
  end if;

  return v_core || jsonb_build_object('closing', v_closing, 'changed_since_close', v_changed);
end;
$$;

-- -------------------------------------------------------------------------
-- get_day_summary(p_day) — ไม่ส่งวัน = วันนี้ (ไทย)
-- -------------------------------------------------------------------------
create or replace function public.get_day_summary(p_day date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_day date := coalesce(p_day, public.pos_bkk_today());
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่' using errcode = '42501';
  end if;
  if not (public.has_perm('sales') or public.has_perm('reports')) then
    raise exception 'ไม่มีสิทธิ์ดูยอดประจำวัน' using errcode = '42501';
  end if;
  if v_day > public.pos_bkk_today() then
    raise exception 'ยังไม่ถึงวันนี้';
  end if;
  return public.pos_day_summary_full(v_day);
end;
$$;

-- -------------------------------------------------------------------------
-- close_day(p_day, p_opening_cash, p_counted_cash, p_cash_detail, p_note) — ปิดยอด (ปิดซ้ำได้ เก็บครั้งก่อนไว้ใน history)
--   ควรมี = เงินทอนตั้งต้น + ขายเงินสด − คืนเงินสด ; ส่วนต่าง = นับได้ − ควรมี
--   p_cash_detail (ไม่บังคับ) = {"1000":2,"500":1,...} ต้องรวมได้เท่ายอดที่นับ
-- -------------------------------------------------------------------------
create or replace function public.close_day(
  p_day date,
  p_opening_cash numeric,
  p_counted_cash numeric,
  p_cash_detail jsonb default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_opening numeric;
  v_counted numeric;
  v_detail jsonb;
  v_note text;
  v_kv record;
  v_cnt numeric;
  v_sum numeric := 0;
  v_summary jsonb;
  v_expected numeric;
  v_old record;
begin
  if v_uid is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่' using errcode = '42501';
  end if;
  if not public.has_perm('sales') then
    raise exception 'ไม่มีสิทธิ์ปิดยอด' using errcode = '42501';
  end if;
  if p_day is null then
    raise exception 'กรุณาเลือกวันที่จะปิดยอด';
  end if;
  if p_day > public.pos_bkk_today() then
    raise exception 'ยังไม่ถึงวันนี้';
  end if;

  v_opening := round(coalesce(p_opening_cash, 0), 2);
  if v_opening < 0 or v_opening > 99999999.99 then
    raise exception 'เงินทอนตั้งต้นไม่ถูกต้อง';
  end if;
  if p_counted_cash is null then
    raise exception 'กรุณากรอกยอดเงินสดที่นับได้';
  end if;
  v_counted := round(p_counted_cash, 2);
  if v_counted < 0 or v_counted > 99999999.99 then
    raise exception 'ยอดเงินสดที่นับได้ไม่ถูกต้อง';
  end if;

  -- นับแยกแบงก์/เหรียญ: คีย์ต้องเป็นมูลค่าที่รู้จัก จำนวนเป็นจำนวนเต็ม 0-100,000 และรวมแล้วต้องเท่ายอดที่นับ
  if p_cash_detail is not null and jsonb_typeof(p_cash_detail) <> 'null' then
    if jsonb_typeof(p_cash_detail) <> 'object' then
      raise exception 'ข้อมูลแบงก์/เหรียญไม่ถูกต้อง';
    end if;
    v_detail := '{}'::jsonb;
    for v_kv in select e.key, e.value from jsonb_each(p_cash_detail) as e
    loop
      if v_kv.key not in ('1000', '500', '100', '50', '20', '10', '5', '2', '1', '0.5', '0.25') then
        raise exception 'ข้อมูลแบงก์/เหรียญไม่ถูกต้อง';
      end if;
      if jsonb_typeof(v_kv.value) = 'number' then
        v_cnt := (v_kv.value #>> '{}')::numeric;
      elsif jsonb_typeof(v_kv.value) = 'string' and btrim(v_kv.value #>> '{}') ~ '^[0-9]{1,6}$' then
        v_cnt := btrim(v_kv.value #>> '{}')::numeric;
      else
        raise exception 'ข้อมูลแบงก์/เหรียญไม่ถูกต้อง';
      end if;
      if v_cnt <> trunc(v_cnt) or v_cnt < 0 or v_cnt > 100000 then
        raise exception 'จำนวนแบงก์/เหรียญต้องเป็นจำนวนเต็ม 0 ถึง 100,000';
      end if;
      v_detail := v_detail || jsonb_build_object(v_kv.key, v_cnt::integer);
      v_sum := v_sum + v_kv.key::numeric * v_cnt;
    end loop;
    if abs(v_sum - v_counted) >= 0.005 then
      raise exception 'ยอดนับแบงก์/เหรียญไม่ตรงกับยอดเงินสดที่นับได้';
    end if;
  end if;

  v_note := nullif(public.product_clean_text(p_note), '');
  if char_length(v_note) > 500 then
    raise exception 'หมายเหตุยาวเกิน 500 ตัวอักษร';
  end if;

  -- ปิดยอดวันเดียวกันพร้อมกันสองเครื่อง → ทำทีละรายการ
  perform pg_advisory_xact_lock(hashtext('newcute_close_day'), (p_day - date '2000-01-01'));

  v_summary := public.pos_day_summary_core(p_day);
  v_expected := round(v_opening + (v_summary ->> 'cash_sales')::numeric - (v_summary ->> 'cash_refunds')::numeric, 2);

  select c.* into v_old
    from public.daily_closings as c
   where c.day = p_day
     for update;

  if found then
    update public.daily_closings as c
       set opening_cash = v_opening,
           counted_cash = v_counted,
           expected_cash = v_expected,
           cash_diff = v_counted - v_expected,
           cash_detail = v_detail,
           summary = v_summary,
           note = v_note,
           revision = c.revision + 1,
           history = c.history || jsonb_build_array(to_jsonb(c) - 'history'),
           closed_by = v_uid,
           closed_by_name = public.pos_actor_name(v_uid),
           closed_at = now()
     where c.day = p_day;
  else
    insert into public.daily_closings
      (day, opening_cash, counted_cash, expected_cash, cash_diff, cash_detail, summary, note,
       revision, history, closed_by, closed_by_name, closed_at)
    values
      (p_day, v_opening, v_counted, v_expected, v_counted - v_expected, v_detail, v_summary, v_note,
       1, '[]'::jsonb, v_uid, public.pos_actor_name(v_uid), now());
  end if;

  return public.pos_day_summary_full(p_day);
end;
$$;

-- =========================================================================
-- 10) ตรวจนับสต๊อก
--     นับระหว่างเปิดขายได้: แต่ละบรรทัดจำ "สต๊อกในระบบ ณ ตอนนับ" (system_qty_at_count)
--     ตอนปรับยอด: ยอดใหม่ = สต๊อกตอนนั้น + (นับได้ − สต๊อก ณ ตอนนับ) → ของที่ขายระหว่างนับถูกหักให้อัตโนมัติ
-- =========================================================================

-- บรรทัดนี้ "ต้องนับใหม่" ไหม (ภายใน): สินค้าถูกปรับยอดจากรอบนับอื่นหลังจากนับบรรทัดนี้ครั้งล่าสุด
--   กติกา snapshot (ยอดใหม่ = สต๊อกตอนปรับ + นับได้ − สต๊อก ณ ตอนนับ) มองการปรับยอดของรอบอื่นเหมือนการขายระหว่างนับ
--   → ส่วนต่างถูกนับซ้ำสองครั้ง (เช่น สองรอบนับได้ 8 จากในระบบ 10: รอบแรก → 8, รอบที่สอง → 6)
--   คืนชื่อรอบนับที่ปรับยอดไป (null = ไม่มี) — นับบรรทัดนั้นใหม่ = จำสต๊อก ณ ตอนนับใหม่ ปัญหาหายเอง
create or replace function public.pos_count_line_stale(p_count_id uuid, p_product_id uuid, p_since timestamptz)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select o.name
    from public.stock_movements as m
    join public.stock_counts as o on o.id = m.ref_id
   where m.product_id = p_product_id
     and m.type = 'adjust'
     and o.id <> p_count_id
     and m.created_at > p_since
   order by m.created_at desc, m.id
   limit 1
$$;

-- บรรทัดของรอบนับ (ภายใน) + คีย์เรียง: ชื่อ → ลำดับไซส์ → SKU
--   is_archived = ไซส์ถูกเอาออกจากสินค้าระหว่างนับ / recount_needed = ต้องนับใหม่ (ดู pos_count_line_stale)
--   หน้าจอใช้ 2 ตัวนี้เตือนก่อนกดปรับยอด (ปรับยอดจะไม่ยอมถ้ายังมีบรรทัดแบบนี้ที่ทำให้สต๊อกเปลี่ยน)
create or replace function public.pos_count_item_rows(p_count_id uuid, p_product_id uuid)
returns table (sort_name text, sort_rank integer, sort_size text, sort_sku text,
               counted integer, diff integer, value_diff numeric, item jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select pr.name,
         public.product_size_rank(pr.size),
         lower(pr.size),
         pr.sku,
         ci.counted_qty,
         d.diff,
         d.diff * coalesce(pr.cost_price, 0),
         jsonb_build_object(
           'product_id', pr.id,
           'group_id', pr.group_id,
           'name', pr.name,
           'sku', pr.sku,
           'barcode', pr.barcode,
           'size', pr.size,
           'color', pr.color,
           'category_id', pr.category_id,
           'is_active', coalesce(pr.is_active, false),
           'is_archived', coalesce(pr.is_archived, false),
           'recount_needed', (sc.status = 'open'
                              and public.pos_count_line_stale(sc.id, ci.product_id, ci.updated_at) is not null),
           'cost_price', pr.cost_price,
           'counted_qty', ci.counted_qty,
           'system_qty_at_count', ci.system_qty_at_count,
           'current_qty', pr.stock_qty,
           'expected_after', d.expected_after,
           'diff', d.diff,
           'applied_before', ci.applied_before,
           'applied_after', ci.applied_after,
           'updated_at', ci.updated_at
         )
    from public.stock_count_items as ci
    join public.stock_counts as sc on sc.id = ci.count_id
    join public.products as pr on pr.id = ci.product_id
    cross join lateral (
      select e.expected_after,
             case when sc.status = 'applied'
                  then coalesce(ci.applied_after, 0) - coalesce(ci.applied_before, 0)
                  else e.expected_after - pr.stock_qty end as diff
        from (select case when sc.status = 'applied' then coalesce(ci.applied_after, 0)
                          else greatest(0, pr.stock_qty + ci.counted_qty - ci.system_qty_at_count) end as expected_after) as e
    ) as d
   where ci.count_id = p_count_id
     and (p_product_id is null or ci.product_id = p_product_id)
$$;

create or replace function public.pos_stock_count_json(p_count_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', sc.id,
    'name', sc.name,
    'note', sc.note,
    'category_id', sc.category_id,
    'category_name', c.name,
    'status', sc.status,
    'created_at', sc.created_at,
    'created_by_name', coalesce(sc.created_by_name, public.pos_actor_name(sc.created_by)),
    'applied_at', sc.applied_at,
    'applied_by_name', coalesce(sc.applied_by_name, public.pos_actor_name(sc.applied_by)),
    'cancelled_at', sc.cancelled_at,
    'summary', sc.summary,
    'items', coalesce(
      (select jsonb_agg(r.item order by r.sort_name, r.sort_rank, r.sort_size, r.sort_sku)
         from public.pos_count_item_rows(sc.id, null) as r),
      '[]'::jsonb),
    -- diff_minus = จำนวนที่ลดลงรวม (เป็นบวก) / value_diff = มูลค่าส่วนต่างตามราคาทุน (บวก-ลบหักกันแล้ว)
    'totals', (
      select jsonb_build_object(
               'lines', count(*)::integer,
               'counted_qty', coalesce(sum(r.counted), 0)::integer,
               'diff_plus', coalesce(sum(r.diff) filter (where r.diff > 0), 0)::integer,
               'diff_minus', coalesce(-sum(r.diff) filter (where r.diff < 0), 0)::integer,
               'value_diff', round(coalesce(sum(r.value_diff), 0), 2))
        from public.pos_count_item_rows(sc.id, null) as r)
  )
  from public.stock_counts as sc
  left join public.categories as c on c.id = sc.category_id
  where sc.id = p_count_id
$$;

create or replace function public.pos_require_stock_count()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่' using errcode = '42501';
  end if;
  if not public.has_perm('stock') then
    raise exception 'ไม่มีสิทธิ์ตรวจนับสต๊อก' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

-- -------------------------------------------------------------------------
-- create_stock_count(p_client_id, p_name, p_note, p_category_id) — เริ่มรอบนับใหม่ (client_id ซ้ำ = คืนรอบเดิม)
-- -------------------------------------------------------------------------
create or replace function public.create_stock_count(
  p_client_id uuid,
  p_name text,
  p_note text default null,
  p_category_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.pos_require_stock_count();
  v_id uuid;
  v_name text;
  v_note text;
begin
  if p_client_id is not null then
    select sc.id into v_id from public.stock_counts as sc where sc.client_id = p_client_id;
    if found then
      return public.pos_stock_count_json(v_id);
    end if;
  end if;

  v_name := nullif(public.product_clean_text(p_name), '');
  if v_name is null or char_length(v_name) > 100 then
    raise exception 'กรุณาตั้งชื่อรอบตรวจนับ (ไม่เกิน 100 ตัวอักษร)';
  end if;
  v_note := nullif(public.product_clean_text(p_note), '');
  if char_length(v_note) > 500 then
    raise exception 'หมายเหตุยาวเกิน 500 ตัวอักษร';
  end if;
  if p_category_id is not null
     and not exists (select 1 from public.categories as c where c.id = p_category_id) then
    raise exception 'ไม่พบหมวดหมู่ที่เลือก (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;

  insert into public.stock_counts as sc (client_id, name, note, category_id, created_by, created_by_name)
  values (p_client_id, v_name, v_note, p_category_id, v_uid, public.pos_actor_name(v_uid))
  on conflict (client_id) do nothing
  returning sc.id into v_id;

  if not found then
    select sc.id into v_id from public.stock_counts as sc where sc.client_id = p_client_id;
  end if;
  return public.pos_stock_count_json(v_id);
end;
$$;

create or replace function public.get_stock_count(p_count_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public.pos_require_stock_count();
  v_result := public.pos_stock_count_json(p_count_id);
  if v_result is null then
    raise exception 'ไม่พบรอบตรวจนับนี้';
  end if;
  return v_result;
end;
$$;

-- -------------------------------------------------------------------------
-- set_stock_count_item(p_count_id, p_product_id, p_qty, p_mode, p_op_id)
--   'set' = ตั้งจำนวนที่นับได้ (null = เอาออกจากรายการนับ) / 'add' = บวก/ลบเพิ่ม (สแกนทีละชิ้น +1, กดย้อน −1)
--   p_op_id (ไม่บังคับ) = รหัสคำสั่งจากเครื่อง: ส่งรหัสเดิมซ้ำ (เน็ตหลุด/ตอบช้า) = ไม่ทำซ้ำ คืนบรรทัดปัจจุบัน + replayed = true
--   บรรทัดที่ "ต้องนับใหม่" (ถูกปรับยอดจากรอบนับอื่นหลังนับ) บวก/ลบเพิ่มไม่ได้ ต้องกรอกจำนวนที่นับได้ทั้งหมด ('set')
--     — สแกน +1 จะจำสต๊อก ณ ตอนนี้ใหม่ ทั้งที่ยอดนับเดิมนับไว้ก่อนการปรับยอดนั้น → ส่วนต่างถูกหักซ้ำแบบเงียบๆ
-- -------------------------------------------------------------------------
-- แบบเดิม (4 พารามิเตอร์) ต้องลบก่อน ให้เหลือแบบเดียว (เรียกแบบเดิมโดยไม่ส่ง p_op_id ยังได้เหมือนเดิม)
drop function if exists public.set_stock_count_item(uuid, uuid, integer, text);

create or replace function public.set_stock_count_item(
  p_count_id uuid,
  p_product_id uuid,
  p_qty integer,
  p_mode text default 'set',
  p_op_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.pos_require_stock_count();
  v_mode text := coalesce(nullif(btrim(p_mode), ''), 'set');
  v_status text;
  v_stock integer;
  v_at timestamptz;
  v_line_at timestamptz;
  v_op_count uuid;
  v_op_product uuid;
  v_result jsonb;
begin
  if v_mode not in ('set', 'add') then
    raise exception 'รูปแบบการนับไม่ถูกต้อง';
  end if;

  -- ล็อกรอบนับ: กันนับพร้อมกับกดปรับยอด/ยกเลิกรอบ (การนับหลายเครื่องจะต่อคิวกันสั้นๆ)
  -- และทำให้คำสั่งเดิมที่ส่งซ้ำระหว่างคำขอแรกยังไม่จบ ต้องรอคำขอแรกก่อน แล้วจึงเห็นว่าบันทึกไปแล้ว
  select sc.status into v_status
    from public.stock_counts as sc
   where sc.id = p_count_id
     for update;
  if not found then
    raise exception 'ไม่พบรอบตรวจนับนี้';
  end if;

  -- คำสั่งนี้บันทึกไปแล้ว (เครื่องส่งซ้ำเพราะไม่ได้รับคำตอบ) → ไม่ทำซ้ำ คืนบรรทัดปัจจุบัน
  -- (ตรวจก่อนสถานะรอบ: ถ้ารอบถูกปรับยอดไปแล้ว คำสั่งที่เข้าไปก่อนหน้านั้นยังนับว่าสำเร็จ)
  if p_op_id is not null then
    select o.count_id, o.product_id into v_op_count, v_op_product
      from public.stock_count_ops as o
     where o.op_id = p_op_id;
    if found then
      if v_op_count <> p_count_id or v_op_product <> p_product_id then
        raise exception 'รหัสคำสั่งนับซ้ำกับรายการอื่น กรุณาโหลดหน้าใหม่';
      end if;
      select r.item into v_result
        from public.pos_count_item_rows(p_count_id, p_product_id) as r;
      if v_result is null then
        return jsonb_build_object('product_id', p_product_id, 'removed', true, 'replayed', true);
      end if;
      return v_result || jsonb_build_object('replayed', true);
    end if;
  end if;

  if v_status <> 'open' then
    raise exception 'รอบนับนี้ปิดไปแล้ว';
  end if;

  -- จำรหัสคำสั่ง (ถ้าคำสั่งนี้ไม่สำเร็จ ทั้งคำขอถูกยกเลิก รหัสก็ไม่ถูกจำ → ส่งซ้ำแล้วทำใหม่ได้)
  if p_op_id is not null then
    insert into public.stock_count_ops (op_id, count_id, product_id)
    values (p_op_id, p_count_id, p_product_id);
  end if;

  -- เอาออกจากรายการนับ: ทำได้เสมอ แม้ไซส์นั้นถูกเอาออกจากสินค้าไปแล้วระหว่างนับ
  -- (ไม่งั้นบรรทัดของไซส์ที่เลิกใช้จะค้างอยู่ในรอบนับ ลบไม่ได้ และกดปรับยอดไม่ได้)
  if v_mode = 'set' and p_qty is null then
    delete from public.stock_count_items as ci
     where ci.count_id = p_count_id and ci.product_id = p_product_id;
    update public.stock_counts as sc set updated_at = now() where sc.id = p_count_id;
    return jsonb_build_object('product_id', p_product_id, 'removed', true);
  end if;

  -- อ่านสต๊อกแบบล็อก (for share): ถ้ารอบนับอื่นกำลังปรับยอดสินค้านี้อยู่ (ล็อก for update) ต้องรอให้เสร็จก่อน
  -- แล้วได้สต๊อกหลังปรับ — ไม่งั้นจะจำสต๊อกก่อนปรับ แต่เวลาแก้บรรทัดอยู่หลังการปรับ จึงไม่ถูกตั้งธง "ต้องนับใหม่"
  -- และส่วนต่างถูกหักซ้ำตอนปรับยอดรอบนี้
  select p.stock_qty into v_stock
    from public.products as p
   where p.id = p_product_id
     and not p.is_archived
     for share;
  if not found then
    raise exception 'ไม่พบสินค้านี้';
  end if;
  -- เวลาแก้บรรทัด = เวลาจริงหลังได้ล็อกสินค้า (ไม่ใช่เวลาเริ่มคำขอ) → เทียบกับเวลาบันทึกการปรับยอดของรอบอื่นได้ถูกลำดับเสมอ
  v_at := clock_timestamp();

  if v_mode = 'set' then
    if p_qty < 0 or p_qty > 1000000 then
      raise exception 'จำนวนที่นับต้องเป็น 0 ถึง 1,000,000';
    end if;
    insert into public.stock_count_items as ci
      (count_id, product_id, counted_qty, system_qty_at_count, updated_at, updated_by)
    values
      (p_count_id, p_product_id, p_qty, v_stock, v_at, v_uid)
    on conflict (count_id, product_id) do update
      set counted_qty = excluded.counted_qty,
          system_qty_at_count = excluded.system_qty_at_count,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by;
  else
    if p_qty is null or p_qty = 0 or p_qty < -1000000 or p_qty > 1000000 then
      raise exception 'จำนวนที่เพิ่ม/ลดไม่ถูกต้อง';
    end if;
    select ci.updated_at into v_line_at
      from public.stock_count_items as ci
     where ci.count_id = p_count_id and ci.product_id = p_product_id;
    if found and public.pos_count_line_stale(p_count_id, p_product_id, v_line_at) is not null then
      raise exception 'สินค้านี้ถูกปรับยอดจากรอบนับอื่นหลังจากนับในรอบนี้ — ต้องนับใหม่ กรอกจำนวนที่นับได้ทั้งหมด (สแกนเพิ่มทีละชิ้นไม่ได้)';
    end if;
    insert into public.stock_count_items as ci
      (count_id, product_id, counted_qty, system_qty_at_count, updated_at, updated_by)
    values
      (p_count_id, p_product_id, least(greatest(0, p_qty), 1000000), v_stock, v_at, v_uid)
    on conflict (count_id, product_id) do update
      set counted_qty = least(greatest(0, ci.counted_qty + p_qty), 1000000),
          system_qty_at_count = excluded.system_qty_at_count,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by;
  end if;

  update public.stock_counts as sc set updated_at = now() where sc.id = p_count_id;

  select r.item into v_result
    from public.pos_count_item_rows(p_count_id, p_product_id) as r;
  return v_result;
end;
$$;

-- -------------------------------------------------------------------------
-- apply_stock_count(p_count_id) — ปรับยอดสต๊อกตามที่นับ (ทำได้ครั้งเดียว; กดซ้ำ = คืนผลเดิม already_applied = true)
-- -------------------------------------------------------------------------
create or replace function public.apply_stock_count(p_count_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.pos_require_stock_count();
  sc record;
  v_line record;
  v_after integer;
  v_lines integer := 0;
  v_changed integer := 0;
  v_plus integer := 0;
  v_minus integer := 0;
  v_value numeric := 0;
  v_more text;
begin
  select x.id, x.name, x.status into sc
    from public.stock_counts as x
   where x.id = p_count_id
     for update;
  if not found then
    raise exception 'ไม่พบรอบตรวจนับนี้';
  end if;
  if sc.status = 'applied' then
    return public.pos_stock_count_json(sc.id) || jsonb_build_object('already_applied', true);
  end if;
  if sc.status = 'cancelled' then
    raise exception 'รอบนับนี้ถูกยกเลิกแล้ว';
  end if;
  if not exists (select 1 from public.stock_count_items as ci where ci.count_id = sc.id) then
    raise exception 'ยังไม่ได้นับสินค้าเลย';
  end if;

  -- ล็อกสินค้าเรียงตาม id (ลำดับเดียวกับ record_sale)
  perform 1
     from public.products as p
    where p.id in (select ci.product_id from public.stock_count_items as ci where ci.count_id = sc.id)
    order by p.id
      for update;

  -- ตรวจทุกบรรทัดที่จะทำให้สต๊อกเปลี่ยนก่อนเขียน (ทั้งรอบสำเร็จหรือไม่เปลี่ยนอะไรเลย) — บอกชื่อสินค้าเป็นภาษาไทย
  -- (1) ไซส์ถูกเอาออกจากสินค้าระหว่างนับ: ห้ามใส่สต๊อกให้ไซส์ที่เลิกใช้ (หน้าสต๊อก/มูลค่าสต๊อก/แจ้งเตือนจะมองไม่เห็น)
  -- (2) สินค้าถูกปรับยอดจากรอบนับอื่นหลังนับบรรทัดนี้: ปรับต่อจะหักส่วนต่างซ้ำสองครั้ง → ต้องนับใหม่
  -- (3) ราคา/จำนวนขั้นต่ำติดลบค้างจากระบบเก่า: แก้แถวสินค้าไม่ได้ (ข้อบังคับของ fix-01) → ภาษาไทยแทน error อังกฤษ
  for v_line in
    select x.*,
           count(*) over (partition by x.problem) as n_same,
           row_number() over (partition by x.problem order by x.name, x.sku) as rn
      from (
        select p.name, p.size, p.color, p.sku,
               case when p.is_archived then 1
                    when public.pos_count_line_stale(sc.id, ci.product_id, ci.updated_at) is not null then 2
                    when p.sell_price < 0 or p.cost_price < 0 or p.min_stock < 0 then 3
               end as problem,
               public.pos_count_line_stale(sc.id, ci.product_id, ci.updated_at) as other_count
          from public.stock_count_items as ci
          join public.products as p on p.id = ci.product_id
         where ci.count_id = sc.id
           and greatest(0, p.stock_qty + ci.counted_qty - ci.system_qty_at_count) <> p.stock_qty
      ) as x
     where x.problem is not null
     order by x.problem
     limit 1
  loop
    v_more := case when v_line.n_same > 1 then format(' (และอีก %s รายการ)', v_line.n_same - 1) else '' end;
    if v_line.problem = 1 then
      raise exception 'สินค้า "%" (SKU "%") ถูกเอาไซส์ออกจากสินค้าระหว่างนับ — ลบบรรทัดนี้ออกจากรอบนับ หรือเพิ่มไซส์กลับที่หน้าสินค้าก่อน แล้วค่อยปรับยอด%',
        public.product_label_text(v_line.name, v_line.size, v_line.color), v_line.sku, v_more;
    elsif v_line.problem = 2 then
      raise exception 'สินค้า "%" (SKU "%") ถูกปรับยอดจากรอบนับ "%" หลังจากนับในรอบนี้ — นับสินค้านี้ใหม่ (หรือลบออกจากรอบนี้) แล้วค่อยปรับยอด%',
        public.product_label_text(v_line.name, v_line.size, v_line.color), v_line.sku, v_line.other_count, v_more;
    else
      raise exception 'สินค้า "%" (SKU "%") มีราคาหรือจำนวนขั้นต่ำติดลบค้างจากระบบเก่า — เปิดหน้าแก้ไขสินค้า ใส่ค่าให้ถูกแล้วบันทึกก่อน จึงจะปรับยอดได้%',
        public.product_label_text(v_line.name, v_line.size, v_line.color), v_line.sku, v_more;
    end if;
  end loop;

  for v_line in
    select ci.product_id, ci.counted_qty, ci.system_qty_at_count, p.stock_qty as before_qty, p.cost_price
      from public.stock_count_items as ci
      join public.products as p on p.id = ci.product_id
     where ci.count_id = sc.id
     order by ci.product_id
  loop
    v_after := greatest(0, v_line.before_qty + v_line.counted_qty - v_line.system_qty_at_count);
    v_lines := v_lines + 1;

    update public.stock_count_items as ci
       set applied_before = v_line.before_qty,
           applied_after = v_after
     where ci.count_id = sc.id and ci.product_id = v_line.product_id;

    if v_after <> v_line.before_qty then
      v_changed := v_changed + 1;
      if v_after > v_line.before_qty then
        v_plus := v_plus + (v_after - v_line.before_qty);
      else
        v_minus := v_minus + (v_line.before_qty - v_after);
      end if;
      v_value := v_value + (v_after - v_line.before_qty) * coalesce(v_line.cost_price, 0);

      update public.products as p
         set stock_qty = v_after
       where p.id = v_line.product_id;

      -- เวลาจริง (หลังได้ล็อกสินค้า) ไม่ใช่เวลาเริ่มคำขอ: บรรทัดของรอบนับอื่นที่แก้ก่อนล็อกนี้ (จำสต๊อกก่อนปรับไว้)
      -- มีเวลาก่อนรายการนี้เสมอ → ถูกตั้งธง "ต้องนับใหม่" (pos_count_line_stale) ไม่หลุดเพราะคำขอนี้เริ่มก่อน
      insert into public.stock_movements
        (product_id, type, qty, qty_before, qty_after, note, ref_id, created_by, created_at)
      values
        (v_line.product_id, 'adjust', v_after - v_line.before_qty, v_line.before_qty, v_after,
         'ตรวจนับ: ' || sc.name, sc.id, v_uid, clock_timestamp());
    end if;
  end loop;

  update public.stock_counts as x
     set status = 'applied',
         applied_by = v_uid,
         applied_by_name = public.pos_actor_name(v_uid),
         applied_at = now(),
         updated_at = now(),
         summary = jsonb_build_object(
           'lines', v_lines,
           'changed', v_changed,
           'unchanged', v_lines - v_changed,
           'qty_plus', v_plus,
           'qty_minus', v_minus,
           'value_diff', round(v_value, 2))
   where x.id = sc.id;

  return public.pos_stock_count_json(sc.id) || jsonb_build_object('already_applied', false);
end;
$$;

-- -------------------------------------------------------------------------
-- cancel_stock_count(p_count_id) — ยกเลิกรอบที่ยังไม่ปรับยอด (ยกเลิกซ้ำ = ไม่เปลี่ยนอะไร)
-- -------------------------------------------------------------------------
create or replace function public.cancel_stock_count(p_count_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform public.pos_require_stock_count();
  select x.status into v_status
    from public.stock_counts as x
   where x.id = p_count_id
     for update;
  if not found then
    raise exception 'ไม่พบรอบตรวจนับนี้';
  end if;
  if v_status = 'applied' then
    raise exception 'ปรับยอดไปแล้ว ยกเลิกไม่ได้';
  end if;
  if v_status = 'open' then
    update public.stock_counts as x
       set status = 'cancelled',
           cancelled_at = now(),
           updated_at = now()
     where x.id = p_count_id;
  end if;
  return public.pos_stock_count_json(p_count_id);
end;
$$;

-- =========================================================================
-- 11) ส่งออก CSV (คืนเป็นแถว เรียงลำดับคงที่เสมอ — ดึงทีละหน้าได้โดยแถวไม่หาย/ไม่ซ้ำ)
--     ช่วงวันที่ = วันตามปฏิทินไทย รวมวันแรกและวันสุดท้าย สูงสุด 366 วัน
--     ดึงทีละหน้า: ส่ง p_offset + p_limit (เช่น 0/1000, 1000/1000, ...) ให้ฐานข้อมูลตัดหน้าเอง
--       → แต่ละครั้งคำนวณเฉพาะแถวของหน้านั้น (ชื่อพนักงาน/จำนวนที่คืน/สถานะบิล)
--       ถ้าใช้ .range() ของ PostgREST อย่างเดียว ทุกหน้าต้องสร้างผลของทั้งช่วงวันที่ก่อนแล้วค่อยตัด
--       (ส่งออกทั้งปีจะช้าขึ้นแบบยกกำลังสอง และหน้าท้ายๆ อาจเกินเวลา) — ไม่ส่ง 2 ตัวนี้ = คืนทุกแถวเหมือนเดิม
--     ห้ามใช้ .range() คู่กับ p_offset (จะเลื่อนซ้ำสองชั้น)
-- =========================================================================
-- แบบเดิม (2 พารามิเตอร์) ต้องลบก่อน ไม่งั้นเรียกด้วยชื่อ p_from/p_to จะกำกวม ("function is not unique")
drop function if exists public.export_sales_rows(date, date);
drop function if exists public.export_sale_item_rows(date, date);
drop function if exists public.export_stock_movement_rows(date, date);

-- หน้าที่ขอ (ภายใน): offset ≥ 0, limit 1..10,000 (ไม่ส่ง = ทั้งหมด)
create or replace function public.pos_check_page(p_offset integer, p_limit integer)
returns void
language plpgsql
immutable
security definer
set search_path = public
as $$
begin
  if (p_offset is not null and p_offset < 0) or (p_limit is not null and (p_limit < 1 or p_limit > 10000)) then
    raise exception 'ช่วงแถวที่ขอไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
end;
$$;

create or replace function public.export_sales_rows(p_from date, p_to date,
                                                    p_offset integer default null, p_limit integer default null)
returns table (
  sale_no text, created_at timestamptz, channel text, payment_method text,
  total_amount numeric, discount numeric, net_amount numeric, refunded_amount numeric,
  cash_received numeric, change_amount numeric, status text, cashier_name text, note text, void_reason text
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
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่' using errcode = '42501';
  end if;
  if not public.has_perm('reports') then
    raise exception 'ไม่มีสิทธิ์ส่งออกรายงานขาย' using errcode = '42501';
  end if;
  perform public.pos_check_range(p_from, p_to);
  perform public.pos_check_page(p_offset, p_limit);
  select b.p_start into v_start from public.pos_day_bounds(p_from) as b;
  select b.p_end into v_end from public.pos_day_bounds(p_to) as b;

  -- ตัดหน้าจากคอลัมน์ธรรมดาก่อน (ใช้ดัชนีเวลา) แล้วค่อยคำนวณส่วนที่แพงเฉพาะบิลในหน้านั้น
  return query
    with pagerows as (
      select s.id, s.sale_no, s.created_at, s.channel, s.payment_method, s.total_amount, s.discount,
             s.net_amount, s.refunded_amount, s.cash_received, s.change_amount, s.voided_at,
             s.created_by_name, s.created_by, s.note, s.void_reason
        from public.sales as s
       where s.created_at >= v_start
         and s.created_at < v_end
       order by s.created_at, s.sale_no, s.id
      offset coalesce(p_offset, 0)
       limit p_limit
    ),
    sold as (
      select si.sale_id, si.product_id, sum(si.qty) as qty
        from public.sale_items as si
       where si.sale_id in (select pr.id from pagerows as pr)
       group by si.sale_id, si.product_id
    ),
    ret as (
      select ri.sale_id, ri.product_id, sum(ri.qty) as qty
        from public.sale_return_items as ri
       where ri.sale_id in (select pr.id from pagerows as pr)
       group by ri.sale_id, ri.product_id
    ),
    st as (
      select sold.sale_id, bool_and(coalesce(ret.qty, 0) >= sold.qty) as all_returned
        from sold
        left join ret on ret.sale_id = sold.sale_id and ret.product_id = sold.product_id
       group by sold.sale_id
    ),
    hr as (
      select distinct r.sale_id
        from public.sale_returns as r
       where r.sale_id in (select pr.id from pagerows as pr)
    )
    select pr.sale_no::text,
           pr.created_at,
           pr.channel::text,
           pr.payment_method::text,
           pr.total_amount::numeric,
           pr.discount::numeric,
           pr.net_amount::numeric,
           pr.refunded_amount::numeric,
           pr.cash_received::numeric,
           pr.change_amount::numeric,
           public.pos_bill_status(pr.voided_at, pr.refunded_amount, hr.sale_id is not null, st.all_returned),
           coalesce(pr.created_by_name, public.pos_actor_name(pr.created_by)),
           pr.note::text,
           pr.void_reason::text
      from pagerows as pr
      left join st on st.sale_id = pr.id
      left join hr on hr.sale_id = pr.id
     order by pr.created_at, pr.sale_no, pr.id;
end;
$$;

create or replace function public.export_sale_item_rows(p_from date, p_to date,
                                                        p_offset integer default null, p_limit integer default null)
returns table (
  sale_no text, created_at timestamptz, sku text, product_name text, size text, color text,
  qty integer, unit_price numeric, subtotal numeric, unit_cost numeric, returned_qty integer, bill_status text
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
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่' using errcode = '42501';
  end if;
  if not public.has_perm('reports') then
    raise exception 'ไม่มีสิทธิ์ส่งออกรายงานขาย' using errcode = '42501';
  end if;
  perform public.pos_check_range(p_from, p_to);
  perform public.pos_check_page(p_offset, p_limit);
  select b.p_start into v_start from public.pos_day_bounds(p_from) as b;
  select b.p_end into v_end from public.pos_day_bounds(p_to) as b;

  return query
    with pagerows as (
      select si.id as item_id, si.sale_id, si.product_id, si.qty, si.unit_price, si.subtotal, si.unit_cost,
             s.sale_no, s.created_at, s.voided_at, s.refunded_amount,
             p.sku, p.name, p.size, p.color
        from public.sale_items as si
        join public.sales as s on s.id = si.sale_id
        join public.products as p on p.id = si.product_id
       where s.created_at >= v_start
         and s.created_at < v_end
       -- เรียงด้วยคีย์ที่ไม่เปลี่ยนเท่านั้น (SKU แก้ได้ → ถ้าแก้ระหว่างส่งออกหลายหน้า แถวจะซ้ำ/หายข้ามหน้า)
       order by s.created_at, s.sale_no, si.id
      offset coalesce(p_offset, 0)
       limit p_limit
    ),
    ids as (
      select distinct pr.sale_id from pagerows as pr
    ),
    sold as (
      select si.sale_id, si.product_id, sum(si.qty) as qty
        from public.sale_items as si
       where si.sale_id in (select ids.sale_id from ids)
       group by si.sale_id, si.product_id
    ),
    ret as (
      select ri.sale_id, ri.product_id, sum(ri.qty) as qty
        from public.sale_return_items as ri
       where ri.sale_id in (select ids.sale_id from ids)
       group by ri.sale_id, ri.product_id
    ),
    st as (
      select sold.sale_id, bool_and(coalesce(ret.qty, 0) >= sold.qty) as all_returned
        from sold
        left join ret on ret.sale_id = sold.sale_id and ret.product_id = sold.product_id
       group by sold.sale_id
    ),
    hr as (
      select distinct r.sale_id
        from public.sale_returns as r
       where r.sale_id in (select ids.sale_id from ids)
    )
    select pr.sale_no::text,
           pr.created_at,
           pr.sku::text,
           pr.name::text,
           pr.size::text,
           pr.color::text,
           pr.qty::integer,
           pr.unit_price::numeric,
           pr.subtotal::numeric,
           pr.unit_cost::numeric,
           coalesce(ret.qty, 0)::integer,
           public.pos_bill_status(pr.voided_at, pr.refunded_amount, hr.sale_id is not null, st.all_returned)
      from pagerows as pr
      left join ret on ret.sale_id = pr.sale_id and ret.product_id = pr.product_id
      left join st on st.sale_id = pr.sale_id
      left join hr on hr.sale_id = pr.sale_id
     order by pr.created_at, pr.sale_no, pr.item_id;
end;
$$;

create or replace function public.export_stock_movement_rows(p_from date, p_to date,
                                                             p_offset integer default null, p_limit integer default null)
returns table (
  created_at timestamptz, type text, sku text, product_name text, size text, color text,
  qty_change integer, qty_before integer, qty_after integer, note text, created_by_name text
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
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่' using errcode = '42501';
  end if;
  if not (public.has_perm('stock') or public.has_perm('reports')) then
    raise exception 'ไม่มีสิทธิ์ส่งออกประวัติสต๊อก' using errcode = '42501';
  end if;
  perform public.pos_check_range(p_from, p_to);
  perform public.pos_check_page(p_offset, p_limit);
  select b.p_start into v_start from public.pos_day_bounds(p_from) as b;
  select b.p_end into v_end from public.pos_day_bounds(p_to) as b;

  return query
    with pagerows as (
      select m.id, m.created_at, m.type, m.qty_before, m.qty_after, m.note, m.created_by,
             p.sku, p.name, p.size, p.color
        from public.stock_movements as m
        join public.products as p on p.id = m.product_id
       where m.created_at >= v_start
         and m.created_at < v_end
       order by m.created_at, m.id
      offset coalesce(p_offset, 0)
       limit p_limit
    )
    select pr.created_at,
           pr.type::text,
           pr.sku::text,
           pr.name::text,
           pr.size::text,
           pr.color::text,
           (pr.qty_after - pr.qty_before)::integer,
           pr.qty_before::integer,
           pr.qty_after::integer,
           pr.note::text,
           case when pr.created_by is null then null
                else coalesce(nullif(btrim(up.full_name), ''),
                              nullif(split_part(coalesce(up.email, au.email), '@', 1), ''),
                              'ไม่ทราบชื่อ') end
      from pagerows as pr
      left join public.user_profiles as up on up.id = pr.created_by
      left join auth.users as au on au.id = pr.created_by
     order by pr.created_at, pr.id;
end;
$$;

-- =========================================================================
-- 12) นำเข้าสินค้าจากไฟล์ (CSV จาก Excel)
--     ตรวจทุกแถวก่อนเสมอ (ไม่หยุดที่ข้อผิดพลาดแรก) → p_dry_run = true คืนแผนอย่างเดียว ไม่เขียนอะไร
--     นำเข้าจริงได้เมื่อไม่มีข้อผิดพลาดเลย (ทั้งไฟล์สำเร็จทั้งหมดหรือไม่เปลี่ยนอะไรเลย)
--     SKU ที่มีอยู่แล้ว: แก้ได้แค่ ราคาขาย / ราคาทุน / บาร์โค้ด / จำนวนขั้นต่ำ (ช่องว่าง = คงค่าเดิม)
--     SKU ใหม่: สร้างแบบใหม่ (จัดกลุ่มตาม ชื่อ + สี) หรือเพิ่มไซส์เข้าแบบเดิมที่ชื่อ + สีตรงกัน
-- =========================================================================

-- ค่าในช่อง (ภายใน): ข้อความ/ตัวเลขดิบ → ตัดช่องว่างและอักขระที่มองไม่เห็นหัวท้าย, ว่าง = null
create or replace function public.pos_import_cell(p_elem jsonb, p_key text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case
           when p_elem -> p_key is null or jsonb_typeof(p_elem -> p_key) in ('null', 'object', 'array') then null
           else nullif(public.product_clean_text(p_elem ->> p_key), '')
         end
$$;

-- ตัวเลขในช่อง (ภายใน): รับ '1,234.50' / '฿120' / ' 120 ' / '120 บาท' / เลขไทย; ว่าง = null; อ่านไม่ได้ = NaN
create or replace function public.pos_import_num(p_text text)
returns numeric
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v text;
begin
  if p_text is null then
    return null;
  end if;
  v := translate(p_text, '๐๑๒๓๔๕๖๗๘๙', '0123456789');
  v := regexp_replace(v, 'บาท', '', 'g');
  v := regexp_replace(v, '[฿,[:space:]]', '', 'g');
  if v = '' then
    return null;
  end if;
  if v ~ '^-?([0-9]{1,15}(\.[0-9]{0,6})?|\.[0-9]{1,6})$' then
    return v::numeric;
  end if;
  return 'NaN'::numeric;
end;
$$;

-- -------------------------------------------------------------------------
-- import_products(p_client_id, p_rows, p_dry_run)
--   p_rows = [{row, name, category, color, size, sku, barcode, cost_price, sell_price, stock, min_stock}] (ค่าดิบจากไฟล์)
--   คืน {dry_run, already_saved, summary{...}, rows[{row, sku, name, size, action, errors[], notes[], changes[]}]}
-- -------------------------------------------------------------------------
create or replace function public.import_products(p_client_id uuid, p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_dry boolean := coalesce(p_dry_run, true);
  v_stock_perm boolean;
  v_saved jsonb;
  v_n integer;
  v_i integer;
  v_elem jsonb;
  v_t text;
  v_num numeric;
  v_bad boolean;
  v_p record;
  v_o record;
  v_g jsonb;
  v_gmap jsonb := '{}'::jsonb;
  v_rec record;
  v_errors integer;
  v_summary jsonb;
  v_rows_json jsonb;
  v_result jsonb;
  v_new_categories jsonb;
  v_cat_id uuid;
  v_gid uuid;
  v_new_id uuid;
  v_first integer;
  v_size_bad constant text := '[\x01-\x1f\x7f-\x9f\xa0\xad\x1680\x180e\x2000-\x200f\x2028-\x202f\x205f-\x206f\x3000\xfeff]';
  -- ค่าของแต่ละแถว (ตำแหน่งเดียวกันทุกอาร์เรย์ = แถวเดียวกัน)
  a_row integer[] := '{}';
  a_name text[] := '{}';
  a_cat text[] := '{}';
  a_color text[] := '{}';
  a_size text[] := '{}';
  a_sku text[] := '{}';
  a_barcode text[] := '{}';
  a_cost numeric[] := '{}';
  a_sell numeric[] := '{}';
  a_stock integer[] := '{}';
  a_min integer[] := '{}';
  a_sell_bad boolean[] := '{}';
  a_action text[] := '{}';       -- create / add_size / update / unchanged (error ตัดสินตอนท้าย)
  a_pid uuid[] := '{}';          -- SKU เดิม
  a_gid uuid[] := '{}';          -- แบบเดิม (SKU เดิม / เพิ่มไซส์)
  a_gkey text[] := '{}';         -- ชื่อ|สี ตัวพิมพ์เล็ก (SKU ใหม่)
  a_gcat text[] := '{}';         -- หมวดหมู่ของแบบใหม่ (= แถวแรกของแบบ)
  a_errs jsonb[] := '{}';
  a_notes jsonb[] := '{}';
  a_changes jsonb[] := '{}';
begin
  -- ----- ผู้ใช้ + สิทธิ์ -----
  if v_uid is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่' using errcode = '42501';
  end if;
  if not public.has_perm('products') then
    raise exception 'ไม่มีสิทธิ์นำเข้าสินค้า' using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'ข้อมูลไม่ครบ กรุณาโหลดหน้าใหม่';
  end if;
  v_stock_perm := public.has_perm('stock');

  -- ----- นำเข้าไฟล์นี้ไปแล้ว (กดซ้ำ/เน็ตหลุด) → คืนผลเดิม ไม่สร้างซ้ำ -----
  if not v_dry then
    select pi.summary into v_saved from public.product_imports as pi where pi.client_id = p_client_id;
    if found then
      return v_saved || jsonb_build_object('already_saved', true);
    end if;
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'ไฟล์ว่าง';
  end if;
  v_n := jsonb_array_length(p_rows);
  if v_n > 2000 then
    raise exception 'นำเข้าได้ครั้งละไม่เกิน 2,000 แถว';
  end if;

  -- ทีละคำขอเหมือน save_product_group (ตรวจ SKU ซ้ำ/สร้างแบบ ไม่ชนกับการบันทึกสินค้าจากหน้าอื่น)
  perform pg_advisory_xact_lock(hashtext('newcute_save_product_group'));

  if not v_dry then
    select pi.summary into v_saved from public.product_imports as pi where pi.client_id = p_client_id;
    if found then
      return v_saved || jsonb_build_object('already_saved', true);
    end if;
  end if;

  -- =====================================================================
  -- รอบ 1: อ่าน + ตรวจทีละแถว + จับคู่ SKU กับสินค้าในระบบ
  -- =====================================================================
  for v_i in 1 .. v_n loop
    v_elem := p_rows -> (v_i - 1);
    -- กำหนดทุกช่องของแถวนี้ก่อน (อาร์เรย์ต้องยาวเท่ากันเสมอ)
    a_row[v_i] := v_i;
    a_name[v_i] := null; a_cat[v_i] := null; a_color[v_i] := null; a_size[v_i] := null;
    a_sku[v_i] := null; a_barcode[v_i] := null;
    a_cost[v_i] := null; a_sell[v_i] := null; a_stock[v_i] := null; a_min[v_i] := null;
    a_sell_bad[v_i] := false;
    a_action[v_i] := null; a_pid[v_i] := null; a_gid[v_i] := null; a_gkey[v_i] := null; a_gcat[v_i] := null;
    a_errs[v_i] := '[]'::jsonb; a_notes[v_i] := '[]'::jsonb; a_changes[v_i] := '[]'::jsonb;

    if v_elem is null or jsonb_typeof(v_elem) <> 'object' then
      a_errs[v_i] := jsonb_build_array('แถวนี้รูปแบบไม่ถูกต้อง');
      continue;
    end if;

    v_t := public.pos_import_cell(v_elem, 'row');
    if v_t ~ '^[0-9]{1,9}$' then
      a_row[v_i] := v_t::integer;
    end if;

    if exists (select 1 from jsonb_each(v_elem) as e where jsonb_typeof(e.value) in ('object', 'array')) then
      a_errs[v_i] := a_errs[v_i] || to_jsonb('แถวนี้มีข้อมูลรูปแบบไม่ถูกต้อง'::text);
    end if;

    a_name[v_i] := public.pos_import_cell(v_elem, 'name');
    a_cat[v_i] := public.pos_import_cell(v_elem, 'category');
    a_color[v_i] := public.pos_import_cell(v_elem, 'color');
    a_size[v_i] := public.pos_import_cell(v_elem, 'size');
    a_sku[v_i] := public.pos_import_cell(v_elem, 'sku');
    a_barcode[v_i] := public.pos_import_cell(v_elem, 'barcode');

    -- ----- ข้อความ -----
    if a_sku[v_i] is null then
      a_errs[v_i] := a_errs[v_i] || to_jsonb('ต้องมี SKU'::text);
    elsif a_sku[v_i] !~ '^[ -~]+$' then
      a_errs[v_i] := a_errs[v_i] || to_jsonb(format('SKU "%s" ต้องเป็นตัวอักษรภาษาอังกฤษ ตัวเลข หรือสัญลักษณ์เท่านั้น (ห้ามภาษาไทย)', a_sku[v_i]));
    elsif char_length(a_sku[v_i]) > 64 then
      a_errs[v_i] := a_errs[v_i] || to_jsonb('SKU ยาวเกินไป (สูงสุด 64 ตัวอักษร)'::text);
    end if;
    if a_barcode[v_i] is not null then
      if a_barcode[v_i] !~ '^[ -~]+$' then
        a_errs[v_i] := a_errs[v_i] || to_jsonb(format('บาร์โค้ด "%s" ต้องเป็นตัวอักษรภาษาอังกฤษ ตัวเลข หรือสัญลักษณ์เท่านั้น', a_barcode[v_i]));
      elsif char_length(a_barcode[v_i]) > 64 then
        a_errs[v_i] := a_errs[v_i] || to_jsonb('บาร์โค้ดยาวเกินไป (สูงสุด 64 ตัวอักษร)'::text);
      end if;
    end if;
    if char_length(a_name[v_i]) > 200 then
      a_errs[v_i] := a_errs[v_i] || to_jsonb('ชื่อสินค้ายาวเกินไป (สูงสุด 200 ตัวอักษร)'::text);
    end if;
    if char_length(a_color[v_i]) > 100 then
      a_errs[v_i] := a_errs[v_i] || to_jsonb('ชื่อสียาวเกินไป (สูงสุด 100 ตัวอักษร)'::text);
    end if;
    if a_size[v_i] is not null then
      if char_length(a_size[v_i]) > 20 then
        a_errs[v_i] := a_errs[v_i] || to_jsonb(format('ไซส์ "%s" ยาวเกินไป (สูงสุด 20 ตัวอักษร)', a_size[v_i]));
      elsif a_size[v_i] ~ v_size_bad then
        a_errs[v_i] := a_errs[v_i] || to_jsonb(format('ไซส์ "%s" มีอักขระพิเศษที่มองไม่เห็นปนอยู่ (มักติดมาตอนก๊อปวาง) — ลบแล้วพิมพ์ใหม่', a_size[v_i]));
      end if;
    end if;
    if char_length(a_cat[v_i]) > 100 then
      a_errs[v_i] := a_errs[v_i] || to_jsonb('ชื่อหมวดหมู่ยาวเกินไป (สูงสุด 100 ตัวอักษร)'::text);
    end if;

    -- ----- ราคา (0 - 99,999,999.99 ทศนิยมไม่เกิน 2 ตำแหน่ง) -----
    v_t := public.pos_import_cell(v_elem, 'sell_price');
    v_num := public.pos_import_num(v_t);
    if v_num = 'NaN'::numeric then
      a_errs[v_i] := a_errs[v_i] || to_jsonb(format('ราคาขาย "%s" ต้องเป็นตัวเลข', v_t));
      a_sell_bad[v_i] := true;
    elsif v_num is not null then
      if v_num < 0 or v_num > 99999999.99 then
        a_errs[v_i] := a_errs[v_i] || to_jsonb('ราคาขายต้องอยู่ระหว่าง 0 ถึง 99,999,999.99'::text);
        a_sell_bad[v_i] := true;
      elsif v_num <> round(v_num, 2) then
        a_errs[v_i] := a_errs[v_i] || to_jsonb('ราคาขายมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง'::text);
        a_sell_bad[v_i] := true;
      else
        a_sell[v_i] := round(v_num, 2);
      end if;
    end if;

    v_t := public.pos_import_cell(v_elem, 'cost_price');
    v_num := public.pos_import_num(v_t);
    if v_num = 'NaN'::numeric then
      a_errs[v_i] := a_errs[v_i] || to_jsonb(format('ราคาทุน "%s" ต้องเป็นตัวเลข', v_t));
    elsif v_num is not null then
      if v_num < 0 or v_num > 99999999.99 then
        a_errs[v_i] := a_errs[v_i] || to_jsonb('ราคาทุนต้องอยู่ระหว่าง 0 ถึง 99,999,999.99'::text);
      elsif v_num <> round(v_num, 2) then
        a_errs[v_i] := a_errs[v_i] || to_jsonb('ราคาทุนมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง'::text);
      else
        a_cost[v_i] := round(v_num, 2);
      end if;
    end if;

    -- ----- จำนวน (จำนวนเต็ม) -----
    v_t := public.pos_import_cell(v_elem, 'stock');
    v_num := public.pos_import_num(v_t);
    if v_num = 'NaN'::numeric then
      a_errs[v_i] := a_errs[v_i] || to_jsonb(format('สต๊อก "%s" ต้องเป็นตัวเลข', v_t));
    elsif v_num is not null then
      if v_num <> trunc(v_num) or v_num < 0 or v_num > 100000 then
        a_errs[v_i] := a_errs[v_i] || to_jsonb('สต๊อกต้องเป็นจำนวนเต็ม 0 ถึง 100,000'::text);
      else
        a_stock[v_i] := v_num::integer;
      end if;
    end if;

    v_t := public.pos_import_cell(v_elem, 'min_stock');
    v_num := public.pos_import_num(v_t);
    if v_num = 'NaN'::numeric then
      a_errs[v_i] := a_errs[v_i] || to_jsonb(format('จำนวนขั้นต่ำ "%s" ต้องเป็นตัวเลข', v_t));
    elsif v_num is not null then
      if v_num <> trunc(v_num) or v_num < 0 or v_num > 1000000 then
        a_errs[v_i] := a_errs[v_i] || to_jsonb('จำนวนขั้นต่ำต้องเป็นจำนวนเต็ม 0 ถึง 1,000,000'::text);
      else
        a_min[v_i] := v_num::integer;
      end if;
    end if;

    if a_sku[v_i] is null then
      continue;
    end if;

    -- ----- SKU นี้มีในระบบแล้วไหม (ไม่สนตัวพิมพ์ รวมไซส์ที่เลิกใช้) -----
    select p.id, p.group_id, p.is_archived, p.name, p.size, p.color, p.sell_price, p.cost_price,
           p.barcode, p.min_stock, p.stock_qty, c.name as cat_name
      into v_p
      from public.products as p
      left join public.categories as c on c.id = p.category_id
     where lower(btrim(p.sku)) = lower(a_sku[v_i])
     order by p.is_archived, p.created_at, p.id
     limit 1;

    if found then
      a_pid[v_i] := v_p.id;
      a_gid[v_i] := v_p.group_id;
      if v_p.is_archived then
        a_errs[v_i] := a_errs[v_i] || to_jsonb('SKU นี้เป็นไซส์ที่เลิกใช้แล้ว'::text);
        continue;
      end if;

      -- แก้ได้แค่ 4 ช่องนี้ (ช่องว่าง = คงค่าเดิม)
      if a_sell[v_i] is not null and a_sell[v_i] <> v_p.sell_price then
        a_changes[v_i] := a_changes[v_i] || jsonb_build_object(
          'field', 'sell_price', 'from', to_char(v_p.sell_price, 'FM99999999990.00'), 'to', to_char(a_sell[v_i], 'FM99999999990.00'));
      end if;
      if a_cost[v_i] is not null and a_cost[v_i] <> v_p.cost_price then
        a_changes[v_i] := a_changes[v_i] || jsonb_build_object(
          'field', 'cost_price', 'from', to_char(v_p.cost_price, 'FM99999999990.00'), 'to', to_char(a_cost[v_i], 'FM99999999990.00'));
      end if;
      if a_barcode[v_i] is not null and a_barcode[v_i] is distinct from v_p.barcode then
        select o.name, o.size, o.color into v_o
          from public.products as o
         where o.id <> v_p.id
           and (lower(btrim(o.sku)) = lower(a_barcode[v_i]) or lower(btrim(o.barcode)) = lower(a_barcode[v_i]))
         order by o.created_at, o.id
         limit 1;
        if found then
          a_errs[v_i] := a_errs[v_i] || to_jsonb(format('บาร์โค้ด "%s" ซ้ำกับสินค้า "%s"', a_barcode[v_i],
                                                         public.product_label_text(v_o.name, v_o.size, v_o.color)));
        else
          a_changes[v_i] := a_changes[v_i] || jsonb_build_object('field', 'barcode', 'from', v_p.barcode, 'to', a_barcode[v_i]);
        end if;
      end if;
      if a_min[v_i] is not null and a_min[v_i] <> v_p.min_stock then
        a_changes[v_i] := a_changes[v_i] || jsonb_build_object(
          'field', 'min_stock', 'from', v_p.min_stock::text, 'to', a_min[v_i]::text);
      end if;

      if (a_name[v_i] is not null and a_name[v_i] is distinct from public.product_clean_text(v_p.name))
         or (a_cat[v_i] is not null and lower(a_cat[v_i]) is distinct from lower(public.product_clean_text(v_p.cat_name)))
         or (a_color[v_i] is not null and lower(a_color[v_i]) is distinct from lower(public.product_clean_text(v_p.color)))
         or (a_size[v_i] is not null and lower(a_size[v_i]) is distinct from lower(public.product_clean_text(v_p.size)))
         or (a_stock[v_i] is not null and a_stock[v_i] is distinct from v_p.stock_qty) then
        a_notes[v_i] := a_notes[v_i]
          || to_jsonb('ไม่ได้เปลี่ยนชื่อ/หมวด/สี/ไซส์/สต๊อกของสินค้าที่มีอยู่ (แก้ที่หน้าสินค้า หรือใช้ตรวจนับสต๊อก)'::text);
      end if;

      a_action[v_i] := case when jsonb_array_length(a_changes[v_i]) > 0 then 'update' else 'unchanged' end;

      -- สินค้าเก่าที่ราคา/จำนวนขั้นต่ำติดลบค้างจากระบบเก่า: แก้แถวได้ก็ต่อเมื่อค่าติดลบทุกช่องถูกแก้ในไฟล์นี้ด้วย
      -- (ข้อบังคับ NOT VALID ของ fix-01 ตรวจทั้งแถวทุกครั้งที่แก้ → ไม่งั้นนำเข้าจริงจะพังด้วย error ภาษาอังกฤษทั้งไฟล์)
      if a_action[v_i] = 'update' then
        v_t := concat_ws(', ',
                 case when coalesce(a_sell[v_i], v_p.sell_price) < 0 then 'ราคาขาย' end,
                 case when coalesce(a_cost[v_i], v_p.cost_price) < 0 then 'ราคาทุน' end,
                 case when coalesce(a_min[v_i], v_p.min_stock) < 0 then 'จำนวนขั้นต่ำ' end);
        if v_t <> '' then
          a_errs[v_i] := a_errs[v_i] || to_jsonb(format(
            'สินค้านี้มี%sติดลบค้างจากระบบเก่า — ใส่ค่าที่ถูกในไฟล์ หรือแก้ที่หน้าสินค้าก่อน', v_t));
        end if;
      end if;
    else
      -- ----- SKU ใหม่ -----
      if a_name[v_i] is null or (a_sell[v_i] is null and not a_sell_bad[v_i]) then
        a_errs[v_i] := a_errs[v_i] || to_jsonb('สินค้าใหม่ต้องมีชื่อและราคาขาย'::text);
      end if;

      select o.name, o.size, o.color into v_o
        from public.products as o
       where lower(btrim(o.barcode)) = lower(a_sku[v_i])
       order by o.created_at, o.id
       limit 1;
      if found then
        a_errs[v_i] := a_errs[v_i] || to_jsonb(format('SKU "%s" ซ้ำกับบาร์โค้ดของสินค้า "%s"', a_sku[v_i],
                                                       public.product_label_text(v_o.name, v_o.size, v_o.color)));
      end if;
      if a_barcode[v_i] is not null then
        select o.name, o.size, o.color into v_o
          from public.products as o
         where lower(btrim(o.sku)) = lower(a_barcode[v_i]) or lower(btrim(o.barcode)) = lower(a_barcode[v_i])
         order by o.created_at, o.id
         limit 1;
        if found then
          a_errs[v_i] := a_errs[v_i] || to_jsonb(format('บาร์โค้ด "%s" ซ้ำกับสินค้า "%s"', a_barcode[v_i],
                                                         public.product_label_text(v_o.name, v_o.size, v_o.color)));
        end if;
      end if;

      -- ยอดยกมา = รับสินค้าเข้า → ต้องมีสิทธิ์รับ-จ่ายสต๊อกด้วย (เหมือนหน้าเพิ่มสินค้า)
      if coalesce(a_stock[v_i], 0) > 0 and not v_stock_perm then
        a_errs[v_i] := a_errs[v_i] || to_jsonb('ต้องมีสิทธิ์รับ-จ่ายสต๊อกจึงจะนำเข้าจำนวนสต๊อกได้'::text);
      end if;

      if a_name[v_i] is not null then
        a_gkey[v_i] := lower(a_name[v_i]) || '|' || lower(coalesce(a_color[v_i], ''));
        a_action[v_i] := 'create';     -- อาจเปลี่ยนเป็น add_size ในรอบ 3
      end if;
    end if;
  end loop;

  -- =====================================================================
  -- รอบ 2: SKU / บาร์โค้ด ซ้ำกันเองในไฟล์ (ไม่สนตัวพิมพ์; SKU ของแถวหนึ่งห้ามตรงบาร์โค้ดของอีกแถว)
  -- =====================================================================
  for v_rec in
    with codes as (
      select t.i::integer as i, 1 as k, t.code as raw, lower(t.code) as code
        from unnest(a_sku) with ordinality as t(code, i)
       where t.code is not null
      union all
      select t.i::integer, 2, t.code, lower(t.code)
        from unnest(a_barcode) with ordinality as t(code, i)
       where t.code is not null
    )
    select distinct a.i, a.k, a.raw
      from codes as a
      join codes as b on b.code = a.code and b.i <> a.i
     order by a.i, a.k
  loop
    a_errs[v_rec.i] := a_errs[v_rec.i] || to_jsonb(format(
      case when v_rec.k = 1 then 'SKU "%s" ซ้ำกับแถวอื่นในไฟล์' else 'บาร์โค้ด "%s" ซ้ำกับแถวอื่นในไฟล์' end, v_rec.raw));
  end loop;

  -- =====================================================================
  -- รอบ 3: SKU ใหม่ → แบบเดิมที่ชื่อ + สีตรงกัน (เพิ่มไซส์) หรือแบบใหม่
  -- =====================================================================
  select coalesce(jsonb_object_agg(m.gkey, jsonb_build_object(
           'n', m.n, 'gid', m.gid, 'has_sizes', m.has_sizes, 'is_active', m.is_active,
           'name', m.name, 'cat_name', m.cat_name)), '{}'::jsonb)
    into v_gmap
    from (
      select k.gkey,
             count(*)::integer as n,
             (array_agg(g.id order by g.created_at, g.id))[1] as gid,
             bool_or(g.has_sizes) as has_sizes,
             (array_agg(coalesce(g.is_active, false) order by g.created_at, g.id))[1] as is_active,
             min(g.name) as name,
             min(c.name) as cat_name
        from (select distinct x.gkey from unnest(a_gkey) as x(gkey) where x.gkey is not null) as k
        join public.product_groups as g
          on lower(public.product_clean_text(g.name)) || '|' || lower(coalesce(public.product_clean_text(g.color), '')) = k.gkey
        left join public.categories as c on c.id = g.category_id
       group by k.gkey
    ) as m;

  for v_i in 1 .. v_n loop
    continue when a_action[v_i] is distinct from 'create';
    v_g := v_gmap -> a_gkey[v_i];
    continue when v_g is null;

    a_action[v_i] := null;
    if (v_g ->> 'n')::integer > 1 then
      a_errs[v_i] := a_errs[v_i] || to_jsonb('มีแบบชื่อ/สีนี้ซ้ำหลายแบบ ระบุไม่ได้'::text);
    elsif (v_g ->> 'has_sizes')::boolean and a_size[v_i] is not null then
      a_gid[v_i] := (v_g ->> 'gid')::uuid;
      a_action[v_i] := 'add_size';
      if exists (select 1 from public.products as p
                  where p.group_id = a_gid[v_i]
                    and lower(public.product_clean_text(p.size)) = lower(a_size[v_i])) then
        a_errs[v_i] := a_errs[v_i] || to_jsonb(format('ไซส์ %s มีอยู่แล้วในแบบนี้', a_size[v_i]));
      end if;
      if a_cat[v_i] is not null and lower(a_cat[v_i]) is distinct from lower(public.product_clean_text(v_g ->> 'cat_name')) then
        a_notes[v_i] := a_notes[v_i] || to_jsonb(format('ใช้หมวดหมู่ของแบบเดิม (%s)', coalesce(v_g ->> 'cat_name', 'ไม่มีหมวดหมู่')));
      end if;
      -- ไซส์ใหม่ใช้สถานะเปิด/ปิดขายตามแบบเดิม → บอกให้รู้ ไม่งั้นบอสคิดว่าขายได้แล้ว
      if not coalesce((v_g ->> 'is_active')::boolean, false) then
        a_notes[v_i] := a_notes[v_i] || to_jsonb('แบบนี้ปิดขายอยู่ ไซส์ใหม่จะยังไม่เปิดขาย (เปิดขายได้ที่หน้าสินค้า)'::text);
      end if;
    elsif (v_g ->> 'has_sizes')::boolean then
      a_errs[v_i] := a_errs[v_i] || to_jsonb('แบบนี้มีหลายไซส์ ต้องระบุไซส์'::text);
    else
      a_errs[v_i] := a_errs[v_i] || to_jsonb(format('แบบ "%s" ไม่มีไซส์ เพิ่ม SKU ใหม่จากไฟล์ไม่ได้', v_g ->> 'name'));
    end if;
  end loop;

  -- เพิ่มไซส์: ไซส์ซ้ำกันในไฟล์ (แบบเดียวกัน) / เกิน 50 ไซส์ต่อแบบ
  for v_rec in
    with r as (
      select t.i::integer as i, t.gid, lower(t.sz) as sz, t.sz as raw
        from unnest(a_action, a_gid, a_size) with ordinality as t(act, gid, sz, i)
       where t.act = 'add_size'
    )
    select a.i, a.raw
      from r as a
     where exists (select 1 from r as b where b.gid = a.gid and b.sz = a.sz and b.i <> a.i)
     order by a.i
  loop
    a_errs[v_rec.i] := a_errs[v_rec.i] || to_jsonb(format('ไซส์ %s ซ้ำกันในไฟล์', v_rec.raw));
  end loop;

  for v_rec in
    with r as (
      select t.i::integer as i, t.gid
        from unnest(a_action, a_gid) with ordinality as t(act, gid, i)
       where t.act = 'add_size'
    ),
    too_many as (
      select r.gid
        from r
       group by r.gid
      having count(*) + (select count(*) from public.products as p where p.group_id = r.gid and not p.is_archived) > 50
    )
    select r.i from r join too_many on too_many.gid = r.gid order by r.i
  loop
    a_errs[v_rec.i] := a_errs[v_rec.i] || to_jsonb('แบบหนึ่งมีได้ไม่เกิน 50 ไซส์'::text);
  end loop;

  -- แบบใหม่: ทุกแถวของแบบต้องมีไซส์ทั้งหมด หรือไม่มีเลย (ไม่มีไซส์ = 1 แถว), ไซส์ไม่ซ้ำ, ไม่เกิน 50 ไซส์
  for v_rec in
    with r as (
      select t.i::integer as i, t.gk, t.sz, t.cat
        from unnest(a_action, a_gkey, a_size, a_cat) with ordinality as t(act, gk, sz, cat, i)
       where t.act = 'create'
    ),
    g as (
      select r.gk, count(*)::integer as n, count(r.sz)::integer as n_size, min(r.i) as first_i
        from r
       group by r.gk
    )
    select r.i, g.n, g.n_size, g.first_i,
           exists (select 1 from r as b where b.gk = r.gk and lower(b.sz) = lower(r.sz) and b.i <> r.i) as dup_size
      from r
      join g on g.gk = r.gk
     order by r.i
  loop
    a_gcat[v_rec.i] := a_cat[v_rec.first_i];
    if v_rec.n_size = 0 and v_rec.n > 1 then
      a_errs[v_rec.i] := a_errs[v_rec.i] || to_jsonb('แบบที่ไม่มีไซส์ต้องมี 1 แถว'::text);
    elsif v_rec.n_size > 0 and v_rec.n_size < v_rec.n then
      a_errs[v_rec.i] := a_errs[v_rec.i] || to_jsonb('บางแถวมีไซส์ บางแถวไม่มี'::text);
    elsif v_rec.n_size > 50 then
      a_errs[v_rec.i] := a_errs[v_rec.i] || to_jsonb('แบบหนึ่งมีได้ไม่เกิน 50 ไซส์'::text);
    end if;
    if v_rec.dup_size then
      a_errs[v_rec.i] := a_errs[v_rec.i] || to_jsonb(format('ไซส์ %s ซ้ำกันในไฟล์', a_size[v_rec.i]));
    end if;
    if v_rec.i <> v_rec.first_i and a_cat[v_rec.i] is not null
       and lower(a_cat[v_rec.i]) is distinct from lower(a_cat[v_rec.first_i]) then
      a_notes[v_rec.i] := a_notes[v_rec.i] || to_jsonb(format('ใช้หมวดหมู่ "%s" ตามแถวแรกของแบบนี้',
                                                               coalesce(a_cat[v_rec.first_i], 'ไม่มีหมวดหมู่')));
    end if;
  end loop;

  -- =====================================================================
  -- สรุปผล (แถวที่มีข้อผิดพลาด = action 'error')
  -- =====================================================================
  for v_i in 1 .. v_n loop
    if jsonb_array_length(a_errs[v_i]) > 0 or a_action[v_i] is null then
      if jsonb_array_length(a_errs[v_i]) = 0 then
        a_errs[v_i] := jsonb_build_array('ข้อมูลไม่ครบ');
      end if;
      a_action[v_i] := 'error';
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
           'row', t.rw, 'sku', t.sku, 'name', t.nm, 'size', t.sz, 'action', t.act,
           'errors', t.errs, 'notes', t.notes, 'changes', t.chg) order by t.i), '[]'::jsonb),
         count(*) filter (where t.act = 'error')::integer
    into v_rows_json, v_errors
    from unnest(a_row, a_sku, a_name, a_size, a_action, a_errs, a_notes, a_changes)
         with ordinality as t(rw, sku, nm, sz, act, errs, notes, chg, i);

  -- หมวดหมู่ที่จะสร้างใหม่ (จากแบบใหม่ที่ไม่มีข้อผิดพลาด)
  select coalesce(jsonb_agg(x.name order by x.first_i), '[]'::jsonb)
    into v_new_categories
    from (
      select min(t.cat) as name, min(t.i) as first_i
        from unnest(a_action, a_gcat) with ordinality as t(act, cat, i)
       where t.act = 'create'
         and t.cat is not null
         and not exists (select 1 from public.categories as c
                          where lower(public.product_clean_text(c.name)) = lower(t.cat))
       group by lower(t.cat)
    ) as x;

  select jsonb_build_object(
           'rows', v_n,
           'errors', v_errors,
           'create_groups', count(distinct t.gk) filter (where t.act = 'create')::integer,
           'create_skus', count(*) filter (where t.act = 'create')::integer,
           'add_sizes', count(*) filter (where t.act = 'add_size')::integer,
           'update_skus', count(*) filter (where t.act = 'update')::integer,
           'unchanged_skus', count(*) filter (where t.act = 'unchanged')::integer,
           'opening_qty', coalesce(sum(t.st) filter (where t.act in ('create', 'add_size')), 0)::integer,
           'new_categories', v_new_categories)
    into v_summary
    from unnest(a_action, a_gkey, a_stock) with ordinality as t(act, gk, st, i);

  v_result := jsonb_build_object('dry_run', v_dry, 'already_saved', false, 'summary', v_summary, 'rows', v_rows_json);

  if v_dry then
    return v_result;
  end if;
  if v_errors > 0 then
    raise exception 'ไฟล์ยังมีข้อผิดพลาด % แถว แก้ไขแล้วลองใหม่', v_errors;
  end if;

  -- =====================================================================
  -- บันทึกจริง
  -- =====================================================================
  -- ล็อกสินค้าเดิมที่จะแก้ เรียงตาม id ก่อนเขียน (ลำดับเดียวกับ record_sale / ยกเลิกบิล / คืนสินค้า / ตรวจนับ)
  -- ถ้าแก้ตามลำดับแถวในไฟล์ จะชนกับการขายพร้อมกันแบบรอกันเอง (deadlock) → ฝั่งใดฝั่งหนึ่งพังด้วย error อังกฤษ
  perform 1
     from public.products as p
    where p.id in (select t.pid from unnest(a_action, a_pid) as t(act, pid) where t.act = 'update')
    order by p.id
      for update;

  -- (1) แบบใหม่ + ทุกไซส์ของแบบ (+ ยอดยกมา บันทึกเป็นรับเข้าแบบเดียวกับหน้าเพิ่มสินค้า)
  for v_rec in
    select t.gk, min(t.i)::integer as first_i
      from unnest(a_action, a_gkey) with ordinality as t(act, gk, i)
     where t.act = 'create'
     group by t.gk
     order by min(t.i)
  loop
    v_first := v_rec.first_i;
    v_cat_id := null;
    if a_gcat[v_first] is not null then
      select c.id into v_cat_id
        from public.categories as c
       where lower(public.product_clean_text(c.name)) = lower(a_gcat[v_first])
       order by c.created_at, c.id
       limit 1;
      if not found then
        insert into public.categories as c (name) values (a_gcat[v_first])
        on conflict do nothing
        returning c.id into v_cat_id;
        if v_cat_id is null then
          select c.id into v_cat_id
            from public.categories as c
           where lower(public.product_clean_text(c.name)) = lower(a_gcat[v_first])
           limit 1;
        end if;
      end if;
    end if;

    insert into public.product_groups as g (name, category_id, color, description, has_sizes, is_active)
    values (a_name[v_first], v_cat_id, a_color[v_first], null, a_size[v_first] is not null, true)
    returning g.id into v_gid;

    for v_i in
      select t.i::integer
        from unnest(a_action, a_gkey) with ordinality as t(act, gk, i)
       where t.act = 'create' and t.gk = v_rec.gk
       order by t.i
    loop
      insert into public.products as p
        (group_id, name, sku, barcode, category_id, size, color,
         cost_price, sell_price, stock_qty, min_stock, is_active, is_archived)
      values
        (v_gid, a_name[v_first], a_sku[v_i], a_barcode[v_i], v_cat_id, a_size[v_i], a_color[v_first],
         coalesce(a_cost[v_i], 0), a_sell[v_i], 0, coalesce(a_min[v_i], 0), true, false)
      returning p.id into v_new_id;

      if coalesce(a_stock[v_i], 0) > 0 then
        update public.products as p set stock_qty = a_stock[v_i] where p.id = v_new_id;
        insert into public.stock_movements (product_id, type, qty, qty_before, qty_after, note, ref_id, created_by)
        values (v_new_id, 'in', a_stock[v_i], 0, a_stock[v_i], 'ยอดยกมา (นำเข้าไฟล์)', null, v_uid);
      end if;
    end loop;
  end loop;

  -- (2) เพิ่มไซส์เข้าแบบเดิม (ชื่อ/สี/หมวด/สถานะเปิดขาย ตามแบบเดิม) + ขยับเวลาแก้ไขของแบบ
  --     → ฟอร์มแก้ไขที่เปิดค้างไว้อีกเครื่องจะถูกบังคับให้โหลดใหม่ (ไม่ลบไซส์ที่เพิ่งเพิ่มทิ้ง)
  for v_i in 1 .. v_n loop
    continue when a_action[v_i] is distinct from 'add_size';
    insert into public.products as p
      (group_id, name, sku, barcode, category_id, size, color,
       cost_price, sell_price, stock_qty, min_stock, is_active, is_archived)
    select g.id, g.name, a_sku[v_i], a_barcode[v_i], g.category_id, a_size[v_i], g.color,
           coalesce(a_cost[v_i], 0), a_sell[v_i], 0, coalesce(a_min[v_i], 0), g.is_active, false
      from public.product_groups as g
     where g.id = a_gid[v_i]
    returning p.id into v_new_id;

    if coalesce(a_stock[v_i], 0) > 0 then
      update public.products as p set stock_qty = a_stock[v_i] where p.id = v_new_id;
      insert into public.stock_movements (product_id, type, qty, qty_before, qty_after, note, ref_id, created_by)
      values (v_new_id, 'in', a_stock[v_i], 0, a_stock[v_i], 'ยอดยกมา (นำเข้าไฟล์)', null, v_uid);
    end if;

    update public.product_groups as g set updated_at = now() where g.id = a_gid[v_i];
  end loop;

  -- (3) แก้ราคา/บาร์โค้ด/ขั้นต่ำของ SKU เดิม + ขยับเวลาแก้ไขของแบบ
  for v_i in 1 .. v_n loop
    continue when a_action[v_i] is distinct from 'update';
    update public.products as p
       set sell_price = coalesce(a_sell[v_i], p.sell_price),
           cost_price = coalesce(a_cost[v_i], p.cost_price),
           barcode = coalesce(a_barcode[v_i], p.barcode),
           min_stock = coalesce(a_min[v_i], p.min_stock)
     where p.id = a_pid[v_i];
    update public.product_groups as g set updated_at = now() where g.id = a_gid[v_i];
  end loop;

  insert into public.product_imports (client_id, row_count, summary, created_by, created_by_name)
  values (p_client_id, v_n, v_result, v_uid, public.pos_actor_name(v_uid));

  return v_result;
end;
$$;

-- =========================================================================
-- 13) สิทธิ์เรียกฟังก์ชัน: ฟังก์ชันของหน้าจอ = ผู้ใช้ที่ล็อกอิน (ตรวจสิทธิ์ย่อยข้างใน) / ตัวช่วย = ไม่มีใครเรียกตรงได้
-- =========================================================================
revoke all on function public.pos_actor_name(uuid) from public, anon, authenticated;
revoke all on function public.pos_bkk_day(timestamptz) from public, anon, authenticated;
revoke all on function public.pos_bkk_today() from public, anon, authenticated;
revoke all on function public.pos_day_bounds(date) from public, anon, authenticated;
revoke all on function public.pos_next_return_no() from public, anon, authenticated;
revoke all on function public.pos_bill_status(timestamptz, numeric, boolean, boolean) from public, anon, authenticated;
revoke all on function public.pos_check_range(date, date) from public, anon, authenticated;
revoke all on function public.pos_check_page(integer, integer) from public, anon, authenticated;
revoke all on function public.pos_return_json(uuid) from public, anon, authenticated;
revoke all on function public.pos_sale_detail(uuid) from public, anon, authenticated;
revoke all on function public.pos_shop_settings_json() from public, anon, authenticated;
revoke all on function public.pos_day_summary_core(date) from public, anon, authenticated;
revoke all on function public.pos_day_summary_full(date) from public, anon, authenticated;
revoke all on function public.pos_count_line_stale(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.pos_count_item_rows(uuid, uuid) from public, anon, authenticated;
revoke all on function public.pos_stock_count_json(uuid) from public, anon, authenticated;
revoke all on function public.pos_require_stock_count() from public, anon, authenticated;
revoke all on function public.pos_import_cell(jsonb, text) from public, anon, authenticated;
revoke all on function public.pos_import_num(text) from public, anon, authenticated;

revoke all on function public.get_sale_detail(uuid) from public, anon;
grant execute on function public.get_sale_detail(uuid) to authenticated;
revoke all on function public.void_sale(uuid, text) from public, anon;
grant execute on function public.void_sale(uuid, text) to authenticated;
revoke all on function public.return_sale_items(uuid, uuid, jsonb, text, text, boolean) from public, anon;
grant execute on function public.return_sale_items(uuid, uuid, jsonb, text, text, boolean) to authenticated;
revoke all on function public.get_shop_settings() from public, anon;
grant execute on function public.get_shop_settings() to authenticated;
revoke all on function public.save_shop_settings(jsonb) from public, anon;
grant execute on function public.save_shop_settings(jsonb) to authenticated;
revoke all on function public.get_day_summary(date) from public, anon;
grant execute on function public.get_day_summary(date) to authenticated;
revoke all on function public.close_day(date, numeric, numeric, jsonb, text) from public, anon;
grant execute on function public.close_day(date, numeric, numeric, jsonb, text) to authenticated;
revoke all on function public.create_stock_count(uuid, text, text, uuid) from public, anon;
grant execute on function public.create_stock_count(uuid, text, text, uuid) to authenticated;
revoke all on function public.get_stock_count(uuid) from public, anon;
grant execute on function public.get_stock_count(uuid) to authenticated;
revoke all on function public.set_stock_count_item(uuid, uuid, integer, text, uuid) from public, anon;
grant execute on function public.set_stock_count_item(uuid, uuid, integer, text, uuid) to authenticated;
revoke all on function public.apply_stock_count(uuid) from public, anon;
grant execute on function public.apply_stock_count(uuid) to authenticated;
revoke all on function public.cancel_stock_count(uuid) from public, anon;
grant execute on function public.cancel_stock_count(uuid) to authenticated;
revoke all on function public.export_sales_rows(date, date, integer, integer) from public, anon;
grant execute on function public.export_sales_rows(date, date, integer, integer) to authenticated;
revoke all on function public.export_sale_item_rows(date, date, integer, integer) from public, anon;
grant execute on function public.export_sale_item_rows(date, date, integer, integer) to authenticated;
revoke all on function public.export_stock_movement_rows(date, date, integer, integer) from public, anon;
grant execute on function public.export_stock_movement_rows(date, date, integer, integer) to authenticated;
revoke all on function public.import_products(uuid, jsonb, boolean) from public, anon;
grant execute on function public.import_products(uuid, jsonb, boolean) to authenticated;

-- =========================================================================
-- 14) ให้ API (PostgREST) โหลดโครงสร้างใหม่ทันที
-- =========================================================================
notify pgrst, 'reload schema';

commit;

-- =========================================================================
-- ตรวจสอบหลังรัน
-- =========================================================================
--
-- (ก) SQL Editor จะแสดงตารางสรุปนี้ให้เองหลังกด Run (คำสั่งสุดท้ายของไฟล์ อ่านอย่างเดียว รันซ้ำได้)
--     แถว "record_sale รับเงินที่รับมา" ต้องเป็น "มี (1 แบบ)" — ถ้าเป็น "มี 2 แบบ" ให้รันไฟล์นี้อีกครั้ง
--
-- ข้อที่เหลือไม่บังคับ — เอา "-- " หน้าบรรทัดออก แล้วรันทีละข้อใน SQL Editor
--
-- (ข) ใบคืนสินค้า 20 ใบล่าสุด
-- select r.return_no, s.sale_no, r.refund_amount, r.refund_method, r.restock, r.reason, r.created_by_name, r.created_at
--   from public.sale_returns as r
--   join public.sales as s on s.id = r.sale_id
--  order by r.created_at desc
--  limit 20;
--
-- (ค) ปิดยอด 14 วันล่าสุด
-- select c.day, c.expected_cash, c.counted_cash, c.cash_diff, c.revision, c.closed_by_name, c.closed_at
--   from public.daily_closings as c
--  order by c.day desc
--  limit 14;

-- (ก) สรุประบบหน้าร้าน (อ่านอย่างเดียว)
select x.item as "รายการ", x.value as "ค่า"
  from (values
    (1, 'ตารางใหม่ของระบบหน้าร้าน',
        (select count(*)::text || ' / 9'
           from unnest(array['doc_counters', 'sale_returns', 'sale_return_items', 'shop_settings', 'daily_closings',
                             'stock_counts', 'stock_count_items', 'stock_count_ops', 'product_imports']) as t(name)
          where to_regclass('public.' || t.name) is not null)),
    (2, 'record_sale รับเงินที่รับมา (p_cash_received)',
        (select case count(*)
                  when 0 then 'ไม่มี'
                  when 1 then case when bool_and(pg_get_function_identity_arguments(p.oid) like '%p_cash_received numeric%')
                                   then 'มี (1 แบบ)' else 'ยังเป็นแบบเก่า' end
                  else 'มี ' || count(*) || ' แบบ — รันไฟล์นี้ซ้ำ'
                end
           from pg_proc as p
          where p.pronamespace = 'public'::regnamespace and p.proname = 'record_sale')),
    (3, 'ฟังก์ชันของหน้าจอ (เรียกได้ / ทั้งหมด)',
        (select count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                   and not has_function_privilege('anon', p.oid, 'EXECUTE'))::text
                || ' / ' || count(*)::text
           from pg_proc as p
          where p.pronamespace = 'public'::regnamespace
            and p.proname in ('get_sale_detail', 'void_sale', 'return_sale_items', 'get_shop_settings',
                              'save_shop_settings', 'get_day_summary', 'close_day', 'create_stock_count',
                              'get_stock_count', 'set_stock_count_item', 'apply_stock_count', 'cancel_stock_count',
                              'export_sales_rows', 'export_sale_item_rows', 'export_stock_movement_rows',
                              'import_products', 'record_sale'))),
    (4, 'สิทธิ์ "ยกเลิกบิล / คืนสินค้า" (refunds) นับเป็นพนักงานของร้าน',
        (select case when pg_get_functiondef('public.is_member()'::regprocedure) like '%''refunds''%'
                     then 'ใช่' else 'ไม่ใช่ — รันไฟล์นี้ซ้ำ' end)),
    (5, 'ชื่อร้านบนใบเสร็จ',
        (select coalesce(max(ss.shop_name), '-') from public.shop_settings as ss)),
    (6, 'บิลที่ยกเลิก / ใบคืนสินค้า',
        (select (select count(*) from public.sales as s where s.voided_at is not null)::text
                || ' / ' || (select count(*) from public.sale_returns)::text))
  ) as x(ord, item, value)
 order by x.ord;
