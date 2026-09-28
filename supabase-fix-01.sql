-- =========================================================================
-- supabase-fix-01.sql — แก้ความปลอดภัย + ระบบขาย/สต๊อก (รอบที่ 1)
--
-- ไฟล์นี้ทำอะไร
--   1) ปิดช่องโหว่ "สมัครสมาชิกเอง": ใครสมัครผ่าน anon key จะได้ staff ที่ไม่มีสิทธิ์ใดๆ เสมอ
--      (ไม่เชื่อ role/permissions ที่แนบมากับการสมัครอีกต่อไป)
--   2) พนักงานแก้ role/สิทธิ์ของตัวเองไม่ได้แล้ว — การแก้โปรไฟล์ทำผ่านเซิร์ฟเวอร์ (service role) เท่านั้น
--      และต้องเหลือ Admin อย่างน้อย 1 คนเสมอ
--   3) ฟังก์ชัน has_perm() / is_member() เช็คสิทธิ์ในฐานข้อมูล
--      อ่านข้อมูลร้านได้เฉพาะพนักงานที่มีสิทธิ์อย่างน้อย 1 อย่าง, อ่านโปรไฟล์คนอื่นได้เฉพาะผู้มีสิทธิ์จัดการผู้ใช้
--   4) คอลัมน์/ข้อบังคับใหม่: sales.client_id (กันบันทึกบิลซ้ำ), sale_items.unit_cost (ต้นทุน ณ วันขาย),
--      สต๊อก/ราคาห้ามติดลบ, ลบผู้ใช้ที่เคยขาย/เคยรับ-จ่ายสต๊อกได้ (ประวัติยังอยู่ ผู้ทำรายการกลายเป็นว่าง)
--   5) เลขที่ใบขายตามวันที่ไทย (Asia/Bangkok) ไม่ซ้ำกันแม้ขายพร้อมกันหลายเครื่อง
--   6) record_sale() — บันทึกการขายทั้งบิลในครั้งเดียว: ล็อกสินค้า, ราคาเอาจากฐานข้อมูล,
--      ห้ามขายเกินสต๊อก, กดซ้ำ/เน็ตหลุดแล้วส่งซ้ำก็ไม่เกิดบิลซ้ำ
--   7) move_stock() — รับเข้า/จ่ายออก/ปรับยอด/รับคืน ผ่านฐานข้อมูล ห้ามสต๊อกติดลบ
--   8) สิทธิ์ตาราง: เพิ่ม/แก้/ลบสินค้าและหมวดหมู่ต้องมีสิทธิ์ "จัดการสินค้า";
--      ตารางขาย/สต๊อกเขียนตรงไม่ได้แล้ว ต้องผ่าน 2 ฟังก์ชันข้างบนเท่านั้น
--
-- วิธีใช้: Supabase > SQL Editor > วางทั้งไฟล์ > กด Run
--   - รันครั้งเดียวพอ (ถ้าเผลอรันซ้ำก็ปลอดภัย ไม่ทำให้ข้อมูลเสีย)
--   - ต้องรันหลัง supabase-schema.sql, supabase-indexes.sql, supabase-users.sql
--   - ⚠️ หลังรันแล้ว แอปเวอร์ชันเก่าจะบันทึกขาย/รับ-จ่ายสต๊อกไม่ได้ (เพราะเขียนตารางตรง)
--        ให้รันไฟล์นี้แล้ว deploy แอปเวอร์ชันใหม่ต่อทันที
--   - ⚠️ ต้องทำด้วย: Authentication > Sign In / Providers > ปิด "Allow new users to sign up"
--        (ร้านสร้างบัญชีจากหน้า "จัดการผู้ใช้" อยู่แล้ว — ไฟล์นี้ทำให้บัญชีที่สมัครเองไม่มีสิทธิ์และอ่านข้อมูลไม่ได้
--         แต่ปิดการสมัครไว้ด้วยจะปลอดภัยที่สุด)
--   - รันเสร็จแล้ว SQL Editor จะแสดงรายชื่อบัญชีทั้งหมด — ตรวจตามหัวข้อ "ตรวจสอบหลังรัน" ท้ายไฟล์
-- =========================================================================

begin;

-- =========================================================================
-- 1) ปิดช่องโหว่สมัครสมาชิกเอง
-- =========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- ห้ามเชื่อ role/permissions ใน raw_user_meta_data (ใครถือ anon key ก็ signUp ใส่อะไรมาก็ได้)
  -- บัญชีที่แอดมินสร้างจากหน้า "จัดการผู้ใช้" จะถูกตั้ง role/สิทธิ์จริงด้วย service role ทันทีหลังสร้าง
  insert into public.user_profiles (id, full_name, email, role, permissions)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.email,
    'staff',
    '{"products":false,"stock":false,"sales":false,"labels":false,"reports":false,"users":false}'::jsonb
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ค่าเริ่มต้นของคอลัมน์ = ไม่มีสิทธิ์ (กันพลาดกรณีมีโค้ด insert โปรไฟล์โดยไม่ระบุสิทธิ์)
alter table public.user_profiles
  alter column permissions
  set default '{"products":false,"stock":false,"sales":false,"labels":false,"reports":false,"users":false}'::jsonb;

-- =========================================================================
-- 2) ห้ามแก้โปรไฟล์/สิทธิ์ผ่าน API ตรง — อ่านได้อย่างเดียว
--    (ใครอ่านโปรไฟล์ไหนได้ กำหนดใน policy "read_all_profiles" หัวข้อ 9)
-- =========================================================================
drop policy if exists "update_own_or_admin" on public.user_profiles;
drop policy if exists "own_profile" on public.user_profiles;

revoke insert, update, delete, truncate on table public.user_profiles from anon, authenticated;

-- ต้องเหลือ Admin อย่างน้อย 1 คนเสมอ (กันกรณีแอดมิน 2 คนลด/ลบกันเองพร้อมกันจนไม่เหลือใคร)
-- แอปเช็คก่อนแล้วรอบหนึ่ง แต่เช็คกับบันทึกเป็นคนละคำขอ → ต้องกันที่ฐานข้อมูลอีกชั้น
-- ครอบคลุมทั้งการเปลี่ยน role และการลบ (รวมถึงลบบัญชีใน Authentication ที่ลบโปรไฟล์ตามไปด้วย)
create or replace function public.keep_last_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.role is distinct from 'admin' then
      return null;
    end if;
  elsif old.role is distinct from 'admin' or new.role = 'admin' then
    return null;
  end if;

  -- ให้รายการที่ลด/ลบแอดมินเข้าคิวทีละรายการ → รายการที่มาทีหลังเห็นผลของรายการแรกแล้วค่อยนับ
  perform pg_advisory_xact_lock(hashtext('user_profiles_admins'));
  if not exists (select 1 from public.user_profiles as up where up.role = 'admin') then
    raise exception 'ต้องมี Admin อย่างน้อย 1 คน — ลดบทบาทหรือลบ Admin คนสุดท้ายไม่ได้';
  end if;
  return null;
end;
$$;

revoke all on function public.keep_last_admin() from public, anon, authenticated;

drop trigger if exists keep_last_admin on public.user_profiles;
create trigger keep_last_admin
  after update or delete on public.user_profiles
  for each row execute function public.keep_last_admin();

-- =========================================================================
-- 3) has_perm('products' | 'stock' | 'sales' | 'labels' | 'reports' | 'users')
--    true = ผู้ใช้ที่ล็อกอินอยู่เป็น admin หรือมีสิทธิ์นั้น; ไม่ได้ล็อกอิน/ไม่มีโปรไฟล์ = false
--    นับเฉพาะค่า JSON true จริงๆ ("true" แบบข้อความ / "yes" / 1 = ไม่มีสิทธิ์) ตรงกับที่แอปอ่าน
-- =========================================================================
create or replace function public.has_perm(p text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select up.role = 'admin' or coalesce((up.permissions -> $1) = 'true'::jsonb, false)
        from public.user_profiles up
       where up.id = auth.uid()
    ),
    false
  )
$$;

revoke execute on function public.has_perm(text) from public, anon;
grant execute on function public.has_perm(text) to authenticated;

-- is_member() = เป็นพนักงานของร้านจริง (admin หรือมีสิทธิ์อย่างน้อย 1 อย่าง)
-- ใช้เป็นเงื่อนไขอ่านข้อมูลร้าน: บัญชีที่สมัครเองผ่าน anon key (ไม่มีสิทธิ์ใดๆ) อ่านอะไรไม่ได้เลย
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
                 from unnest(array['products', 'stock', 'sales', 'labels', 'reports', 'users']) as k(perm)
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
-- 4) คอลัมน์ + ข้อบังคับใหม่
-- =========================================================================
-- รหัสบิลจากเครื่องขาย (สุ่มครั้งเดียวต่อบิล) — กันบันทึกบิลเดิมซ้ำเวลากดซ้ำ/เน็ตหลุด
alter table public.sales add column if not exists client_id uuid;

-- ต้นทุนต่อชิ้น ณ วันที่ขาย (บิลเก่าก่อนไฟล์นี้จะเป็นค่าว่าง)
alter table public.sale_items add column if not exists unit_cost numeric(10,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.sales'::regclass and c.conname = 'sales_client_id_key'
  ) then
    alter table public.sales add constraint sales_client_id_key unique (client_id);
  end if;

  -- NOT VALID = ไม่ตรวจข้อมูลเก่าตอนเพิ่มข้อบังคับ แต่ทุกครั้งที่แก้แถวไหน แถวนั้นต้องผ่าน
  -- (สินค้าที่ราคา/ขั้นต่ำติดลบค้างจากระบบเก่า ต้องแก้ค่านั้นให้ถูกก่อนถึงจะบันทึกแก้ไขได้ — ดู (ค) ท้ายไฟล์)
  -- สต๊อกห้ามติดลบ ใช้ trigger ด้านล่างแทน check (ไม่งั้นสินค้าที่สต๊อกติดลบค้างอยู่จะแก้ชื่อ/ปิดใช้งานไม่ได้เลย)
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.products'::regclass and c.conname = 'products_sell_price_nonneg'
  ) then
    alter table public.products
      add constraint products_sell_price_nonneg check (sell_price >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.products'::regclass and c.conname = 'products_cost_price_nonneg'
  ) then
    alter table public.products
      add constraint products_cost_price_nonneg check (cost_price >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.products'::regclass and c.conname = 'products_min_stock_nonneg'
  ) then
    alter table public.products
      add constraint products_min_stock_nonneg check (min_stock >= 0) not valid;
  end if;
end
$$;

-- สต๊อกห้ามติดลบ: ตรวจเฉพาะตอนที่ "เขียนช่อง stock_qty" และห้ามทำให้ติดลบเพิ่ม
--   - สินค้าที่สต๊อกติดลบค้างมาจากระบบเก่า ยังแก้ชื่อ/ราคา ปิดใช้งาน หรือลบหมวดหมู่ของมันได้ตามปกติ
--   - record_sale / move_stock กันติดลบเองอยู่แล้ว ตัวนี้เป็นด่านสุดท้าย (เช่นแก้ผ่าน service role)
alter table public.products drop constraint if exists products_stock_qty_nonneg;

create or replace function public.products_stock_qty_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.stock_qty < 0 then
    if tg_op = 'INSERT' then
      raise exception 'สต๊อกติดลบไม่ได้ (ใส่มา % ชิ้น)', new.stock_qty
        using errcode = '23514';
    elsif new.stock_qty < old.stock_qty then
      raise exception 'สต๊อกติดลบไม่ได้ (ตอนนี้เหลือ % ชิ้น)', old.stock_qty
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists products_stock_qty_guard on public.products;
create trigger products_stock_qty_guard
  before insert or update of stock_qty on public.products
  for each row execute function public.products_stock_qty_guard();

-- ลบผู้ใช้แล้วประวัติขาย/สต๊อกยังอยู่ (created_by กลายเป็น null แทนที่จะลบไม่ได้)
alter table public.sales drop constraint if exists sales_created_by_fkey;
alter table public.sales
  add constraint sales_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

alter table public.stock_movements drop constraint if exists stock_movements_created_by_fkey;
alter table public.stock_movements
  add constraint stock_movements_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

-- =========================================================================
-- 5) เลขที่ใบขาย S-YYYYMMDD-NNN ตามวันที่ไทย ไม่ชนกัน
-- =========================================================================
create table if not exists public.sale_counters (
  day date primary key,
  n integer not null
);

-- ตารางภายใน: ไม่มี policy = ผู้ใช้ทั่วไปอ่าน/เขียนไม่ได้เลย (ใช้ผ่าน trigger เท่านั้น)
alter table public.sale_counters enable row level security;
revoke all on table public.sale_counters from anon, authenticated;

create or replace function public.generate_sale_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date;
  v_prefix text;
  v_seed integer;
  v_n integer;
begin
  -- ถ้าระบุเลขมาแล้วก็ใช้ตามนั้น
  if new.sale_no is not null and btrim(new.sale_no) <> '' then
    return new;
  end if;

  v_day := (now() at time zone 'Asia/Bangkok')::date;
  v_prefix := 'S-' || to_char(v_day::timestamp, 'YYYYMMDD') || '-';

  -- ปกติ: เลขของวันนี้ +1 (แถวของวันถูกล็อกจนจบรายการ → สองเครื่องขายพร้อมกันก็ไม่ได้เลขซ้ำ)
  update public.sale_counters as sc
     set n = sc.n + 1
   where sc.day = v_day
  returning sc.n into v_n;

  if not found then
    -- บิลแรกของวัน: เริ่มต่อจากเลขที่เคยออกไปแล้ววันนี้ (เช่นบิลจากระบบเก่า) จะได้ไม่ชนกัน
    select coalesce(max(substr(s.sale_no, length(v_prefix) + 1)::integer), 0) + 1
      into v_seed
      from public.sales as s
     where s.sale_no like (v_prefix || '%')
       and substr(s.sale_no, length(v_prefix) + 1) ~ '^[0-9]{1,9}$';

    insert into public.sale_counters as sc (day, n)
    values (v_day, v_seed)
    on conflict (day) do update set n = sc.n + 1
    returning sc.n into v_n;
  end if;

  -- เกิน 999 บิลต่อวันก็ไม่ตัดหลัก (lpad จะตัดเลขทิ้งถ้ายาวเกิน)
  new.sale_no := v_prefix || case when v_n < 1000 then lpad(v_n::text, 3, '0') else v_n::text end;
  return new;
end;
$$;

drop trigger if exists set_sale_no on public.sales;
create trigger set_sale_no
  before insert on public.sales
  for each row execute function public.generate_sale_no();

-- =========================================================================
-- 6) record_sale() — บันทึกการขายทั้งบิล
-- =========================================================================

-- ตัวช่วยภายใน: สร้าง JSON ของบิล (ใช้ทั้งบิลใหม่และบิลที่บันทึกไปแล้ว ให้หน้าตาเหมือนกัน)
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
    'note', s.note,
    'created_at', s.created_at,
    'already_saved', coalesce(p_already_saved, false),
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

create or replace function public.record_sale(
  p_client_id uuid,
  p_items jsonb,
  p_discount numeric default 0,
  p_payment_method text default 'cash',
  p_note text default null
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
  v_sale_id uuid;
  v_sale_no text;
  v_after integer;
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

  -- ----- วิธีชำระ / ส่วนลด / หมายเหตุ -----
  if p_payment_method is null or p_payment_method not in ('cash', 'transfer', 'credit') then
    raise exception 'วิธีชำระเงินไม่ถูกต้อง';
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

  -- ----- บันทึกหัวบิล (sale_no มาจาก trigger set_sale_no) -----
  insert into public.sales as s
    (client_id, total_amount, discount, net_amount, payment_method, note, created_by)
  values
    (p_client_id, v_total, v_discount, v_total - v_discount, p_payment_method, v_note, v_uid)
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

-- =========================================================================
-- 7) move_stock() — รับเข้า / จ่ายออก / ปรับยอด / รับคืน
--    in, out, return: p_qty = จำนวนที่เคลื่อนไหว (>= 1)
--    adjust:          p_qty = ยอดที่นับได้จริงทั้งหมด (>= 0)
--    stock_movements.qty ที่เก็บ: in/out/return = จำนวนบวก, adjust = qty_after - qty_before (มีเครื่องหมาย)
-- =========================================================================
create or replace function public.move_stock(
  p_product_id uuid,
  p_type text,
  p_qty integer,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_note text;
  v_before integer;
  v_after integer;
  v_stored integer;
  v_move_id uuid;
  v_created_at timestamptz;
begin
  if v_uid is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่';
  end if;
  if not public.has_perm('stock') then
    raise exception 'ไม่มีสิทธิ์รับ-จ่ายสต๊อก';
  end if;
  if p_product_id is null then
    raise exception 'กรุณาเลือกสินค้า';
  end if;
  if p_type is null or p_type not in ('in', 'out', 'adjust', 'return') then
    raise exception 'ประเภทรายการสต๊อกไม่ถูกต้อง';
  end if;
  if p_qty is null then
    raise exception 'กรุณาระบุจำนวน';
  end if;
  if p_qty > 100000 then
    raise exception 'จำนวนต้องไม่เกิน 100,000 ชิ้น';
  end if;
  if p_type = 'adjust' then
    if p_qty < 0 then
      raise exception 'ยอดที่นับได้จริงต้องไม่ติดลบ';
    end if;
  elsif p_qty < 1 then
    raise exception 'จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป';
  end if;

  v_note := nullif(btrim(p_note), '');
  if length(v_note) > 500 then
    raise exception 'หมายเหตุยาวเกิน 500 ตัวอักษร';
  end if;

  -- ล็อกแถวสินค้า กันสองเครื่องแก้สต๊อกตัวเดียวกันพร้อมกัน
  select p.stock_qty into v_before
    from public.products as p
   where p.id = p_product_id
     for update;
  if not found then
    raise exception 'ไม่พบสินค้านี้ (อาจถูกลบไปแล้ว)';
  end if;
  v_before := coalesce(v_before, 0);

  if p_type in ('in', 'return') then
    v_after := v_before + p_qty;
    v_stored := p_qty;
    if v_after < 0 then
      -- สต๊อกติดลบค้างมาจากระบบเก่า
      raise exception 'สต๊อกสินค้านี้ติดลบอยู่ (% ชิ้น) กรุณาใช้ "ปรับยอด" ให้ตรงกับของจริงก่อน', v_before;
    end if;
  elsif p_type = 'out' then
    v_after := v_before - p_qty;
    v_stored := p_qty;
    if v_after < 0 then
      raise exception 'สต๊อกไม่พอ เหลือ % ชิ้น', v_before;
    end if;
  else
    -- adjust: p_qty คือยอดนับจริง
    if p_qty = v_before then
      raise exception 'ยอดนับเท่ากับในระบบอยู่แล้ว ไม่ต้องปรับ';
    end if;
    v_after := p_qty;
    v_stored := v_after - v_before;
  end if;

  update public.products as p
     set stock_qty = v_after
   where p.id = p_product_id;

  insert into public.stock_movements as m
    (product_id, type, qty, qty_before, qty_after, note, created_by)
  values
    (p_product_id, p_type, v_stored, v_before, v_after, v_note, v_uid)
  returning m.id, m.created_at into v_move_id, v_created_at;

  return jsonb_build_object(
    'id', v_move_id,
    'product_id', p_product_id,
    'type', p_type,
    'qty', v_stored,
    'qty_before', v_before,
    'qty_after', v_after,
    'note', v_note,
    'created_at', v_created_at
  );
end;
$$;

-- =========================================================================
-- 8) สิทธิ์เรียกฟังก์ชัน: เฉพาะผู้ที่ล็อกอินแล้ว (ในฟังก์ชันเช็คสิทธิ์ย่อยอีกชั้น)
-- =========================================================================
revoke all on function public.record_sale(uuid, jsonb, numeric, text, text) from public, anon;
grant execute on function public.record_sale(uuid, jsonb, numeric, text, text) to authenticated;

revoke all on function public.move_stock(uuid, text, integer, text) from public, anon;
grant execute on function public.move_stock(uuid, text, integer, text) to authenticated;

-- =========================================================================
-- 9) RLS + สิทธิ์ตาราง
--    อ่านข้อมูลร้าน = ต้องเป็นพนักงานจริง (is_member: admin หรือมีสิทธิ์อย่างน้อย 1 อย่าง)
--    บัญชีที่สมัครเองผ่าน anon key ได้ staff ไม่มีสิทธิ์ → ล็อกอินได้ แต่อ่านข้อมูลอะไรไม่ได้เลย
-- =========================================================================

-- ----- user_profiles: อ่านได้เฉพาะโปรไฟล์ตัวเอง / ผู้มีสิทธิ์ "จัดการผู้ใช้" อ่านได้ทุกคน -----
-- (has_perm / is_member เป็น security definer จึงไม่วนกลับมาเช็ค policy นี้ซ้ำ)
alter table public.user_profiles enable row level security;
drop policy if exists "read_all_profiles" on public.user_profiles;
create policy "read_all_profiles" on public.user_profiles
  for select to authenticated
  using (id = auth.uid() or (select public.has_perm('users')));

-- ----- products: พนักงานอ่านได้ / เพิ่ม-แก้-ลบ ต้องมีสิทธิ์ "จัดการสินค้า" -----
alter table public.products enable row level security;
drop policy if exists "authenticated_all" on public.products;
drop policy if exists "products_select" on public.products;
drop policy if exists "products_insert" on public.products;
drop policy if exists "products_update" on public.products;
drop policy if exists "products_delete" on public.products;

create policy "products_select" on public.products
  for select to authenticated
  using ((select public.is_member()));
create policy "products_insert" on public.products
  for insert to authenticated
  with check (public.has_perm('products'));
create policy "products_update" on public.products
  for update to authenticated
  using (public.has_perm('products'))
  with check (public.has_perm('products'));
create policy "products_delete" on public.products
  for delete to authenticated
  using (public.has_perm('products'));

-- stock_qty แก้ตรงไม่ได้ (ไม่อยู่ในรายการคอลัมน์) → เปลี่ยนได้ผ่าน record_sale / move_stock เท่านั้น
revoke insert, update, truncate on table public.products from anon, authenticated;
grant insert (name, sku, barcode, category_id, size, color, cost_price, sell_price, min_stock, image_url, is_active)
  on table public.products to authenticated;
grant update (name, sku, barcode, category_id, size, color, cost_price, sell_price, min_stock, image_url, is_active)
  on table public.products to authenticated;

-- ----- categories: พนักงานอ่านได้ / เพิ่ม-แก้-ลบ ต้องมีสิทธิ์ "จัดการสินค้า" -----
alter table public.categories enable row level security;
drop policy if exists "authenticated_all" on public.categories;
drop policy if exists "categories_select" on public.categories;
drop policy if exists "categories_insert" on public.categories;
drop policy if exists "categories_update" on public.categories;
drop policy if exists "categories_delete" on public.categories;

create policy "categories_select" on public.categories
  for select to authenticated
  using ((select public.is_member()));
create policy "categories_insert" on public.categories
  for insert to authenticated
  with check (public.has_perm('products'));
create policy "categories_update" on public.categories
  for update to authenticated
  using (public.has_perm('products'))
  with check (public.has_perm('products'));
create policy "categories_delete" on public.categories
  for delete to authenticated
  using (public.has_perm('products'));

-- ----- sales / sale_items / stock_movements: พนักงานอ่านได้อย่างเดียว เขียนผ่าน RPC เท่านั้น -----
alter table public.sales enable row level security;
drop policy if exists "authenticated_all" on public.sales;
drop policy if exists "sales_select" on public.sales;
create policy "sales_select" on public.sales
  for select to authenticated
  using ((select public.is_member()));
revoke insert, update, delete, truncate on table public.sales from anon, authenticated;

alter table public.sale_items enable row level security;
drop policy if exists "authenticated_all" on public.sale_items;
drop policy if exists "sale_items_select" on public.sale_items;
create policy "sale_items_select" on public.sale_items
  for select to authenticated
  using ((select public.is_member()));
revoke insert, update, delete, truncate on table public.sale_items from anon, authenticated;

alter table public.stock_movements enable row level security;
drop policy if exists "authenticated_all" on public.stock_movements;
drop policy if exists "stock_movements_select" on public.stock_movements;
create policy "stock_movements_select" on public.stock_movements
  for select to authenticated
  using ((select public.is_member()));
revoke insert, update, delete, truncate on table public.stock_movements from anon, authenticated;

-- =========================================================================
-- 10) ให้ API (PostgREST) โหลดโครงสร้างใหม่ทันที
-- =========================================================================
notify pgrst, 'reload schema';

commit;

-- =========================================================================
-- ตรวจสอบหลังรัน
-- =========================================================================
--
-- (ก) ⚠️ ต้องดูทุกครั้ง — SQL Editor จะแสดงตารางนี้ให้เองหลังกด Run (คำสั่งสุดท้ายของไฟล์ อ่านอย่างเดียว)
--     รายชื่อบัญชีทั้งหมด: Admin และผู้มีสิทธิ์ "จัดการผู้ใช้" ขึ้นก่อน แล้วเรียงบัญชีใหม่สุดก่อน
--     ก่อนไฟล์นี้ ใครก็สมัครเองแล้วตั้งตัวเองเป็น admin ได้ (ไฟล์นี้แยกไม่ออกว่าบัญชีไหนสมัครเอง)
--     เจออีเมลที่ร้านไม่รู้จัก ให้ลบทันที (Authentication > Users หรือหน้า "จัดการผู้ใช้" ในแอป)
--
-- ข้อที่เหลือไม่บังคับ — เอา "-- " หน้าบรรทัดออก แล้วรันทีละข้อใน SQL Editor
--
-- (ข) ตัวนับเลขที่ใบขายของวันนี้ (n = เลขบิลล่าสุดของวันนี้; ไม่มีแถว = วันนี้ยังไม่มีบิลผ่านระบบใหม่)
-- select sc.day, sc.n
--   from public.sale_counters as sc
--  where sc.day = (now() at time zone 'Asia/Bangkok')::date;
--
-- (ค) สินค้าที่มีค่าติดลบค้างจากระบบเก่า
--     - สต๊อกติดลบ: ขาย/จ่ายออก/รับเข้าตัวนั้นไม่ได้จนกว่าจะไปเมนูสต๊อก > "ปรับยอด" ให้ตรงของจริง
--       (แก้ชื่อ/ราคา/ปิดใช้งานได้ตามปกติ)
--     - ราคาทุน/ราคาขาย/สต๊อกขั้นต่ำติดลบ: ปิดใช้งาน ขาย หรือรับ-จ่ายสต๊อกตัวนั้นไม่ได้
--       จนกว่าจะเข้าหน้าแก้ไขสินค้าแล้วแก้ค่านั้นให้ไม่ติดลบ
-- select p.name, p.sku, p.size, p.color, p.stock_qty, p.cost_price, p.sell_price, p.min_stock
--   from public.products as p
--  where p.stock_qty < 0 or p.cost_price < 0 or p.sell_price < 0 or p.min_stock < 0
--  order by p.name;

-- (ก) รายชื่อบัญชีทั้งหมด (อ่านอย่างเดียว รันซ้ำได้)
select au.email,
       au.created_at,
       au.last_sign_in_at,
       up.role,
       up.permissions
  from auth.users as au
  left join public.user_profiles as up on up.id = au.id
 order by coalesce(up.role = 'admin' or (up.permissions -> 'users') = 'true'::jsonb, false) desc,
          au.created_at desc;
