-- =========================================================================
-- supabase-fix-02.sql — สินค้าแบบ "การ์ดต่อแบบ" + ไซส์แยก SKU + รูปไม่จำกัด + แถบหมวดหมู่ (รอบที่ 2)
--
-- ไฟล์นี้ทำอะไร
--   1) ตารางใหม่ product_groups = "แบบสินค้า" 1 แถวต่อ 1 การ์ดในหน้าสินค้า
--      (ชื่อ, หมวดหมู่, สี, รายละเอียด, ติ๊ก "มีไซส์" หรือไม่, เปิดขาย/ปิดใช้งาน)
--   2) ตาราง products เดิมยังเป็น "สินค้าที่ขายได้จริง" 1 แถวต่อ 1 SKU เหมือนเดิม
--      (หน้าขาย, สต๊อก, สติกเกอร์, รายงาน ใช้ได้เหมือนเดิมทุกอย่าง) แต่ทุกแถวต้องอยู่ในแบบใดแบบหนึ่ง:
--        - แบบ "ไม่มีไซส์" = มี SKU เดียว
--        - แบบ "มีไซส์"   = 1 SKU ต่อ 1 ไซส์ แต่ละไซส์มีบาร์โค้ด ราคา และจำนวนขั้นต่ำของตัวเอง
--      ชื่อ/สี/หมวดหมู่ของทุกไซส์ถูกคัดลอกจากแบบให้อัตโนมัติ (แก้ที่แบบที่เดียว)
--      เอาไซส์ออกจากแบบ: ยังมีสต๊อกเหลือ = เอาออกไม่ได้ (ต้องปรับยอดเป็น 0 ก่อน สต๊อกจะได้ไม่หายจากหน้าสต๊อก),
--      ไม่เคยขาย/ไม่เคยรับ-จ่าย = ลบทิ้ง, ไม่งั้นปิดใช้งานและเก็บไว้เป็น "ไซส์ที่เลิกใช้"
--      (ประวัติไม่หาย, เปิดขายทั้งแบบอีกครั้งก็ไม่กลับมา)
--      กันบันทึกทับกัน: ฟอร์มแก้ไขที่เปิดค้างไว้อีกเครื่อง (ข้อมูลเก่า) บันทึกไม่ได้ ต้องโหลดหน้าใหม่ก่อน
--      กันสร้างซ้ำ: เน็ตหลุดหลังกดบันทึกสินค้าใหม่แล้วกดซ้ำ = ได้สินค้าเดิมคืน ไม่เกิดสินค้าซ้ำ
--   3) สินค้าเดิมทุกตัวถูกสร้างเป็นแบบของตัวเองให้อัตโนมัติ (1 สินค้าเดิม = 1 การ์ด)
--      สินค้าเดิมที่มีไซส์ = แบบ "มีไซส์" ที่มี 1 ไซส์ / ไม่มีไซส์ = แบบ "ไม่มีไซส์"
--      สต๊อก ประวัติขาย ประวัติรับ-จ่าย ไม่เปลี่ยนเลย
--   4) ตารางใหม่ product_images = รูปสินค้าไม่จำกัดจำนวนต่อแบบ เรียงลำดับได้ รูปแรก = รูปปก
--      ไฟล์รูปเก็บใน Supabase Storage ถัง "product-images" (สร้างให้ในไฟล์นี้ — ดูรูปได้แบบสาธารณะ,
--      อัปโหลด/ลบได้เฉพาะผู้มีสิทธิ์ "จัดการสินค้า", ไฟล์ละไม่เกิน 5 MB, jpeg/png/webp)
--   5) เพิ่ม/แก้/ลบสินค้าและรูป ทำผ่านฟังก์ชันในฐานข้อมูลเท่านั้น (ตรวจสิทธิ์ + ตรวจข้อมูลครบในที่เดียว):
--        save_product_group, set_product_group_active, delete_product_group, get_product_group,
--        add_product_image, delete_product_image, reorder_product_images
--      แก้ตาราง products / product_groups / product_images ตรงๆ จากแอปไม่ได้อีกต่อไป
--   6) หมวดหมู่: ชื่อซ้ำกันแบบไม่สนตัวพิมพ์เล็ก/ใหญ่และช่องว่างหัวท้ายไม่ได้ (ถ้าข้อมูลเดิมไม่มีชื่อซ้ำ),
--      ชื่อว่างไม่ได้; ลบหมวดหมู่แล้วสินค้าไม่หาย — กลายเป็น "ไม่มีหมวดหมู่"
--   7) ข้อความที่พิมพ์/วางมา (ชื่อ, ไซส์, SKU, ชื่อหมวดหมู่ ฯลฯ) ตัดช่องว่างและอักขระที่มองไม่เห็นหัวท้ายให้
--      (เช่น ช่องว่างแบบไม่ตัดบรรทัด, zero-width space ที่ติดมาตอนก๊อปวาง) — "M" กับ "M␣" เป็นไซส์เดียวกัน
--   8) สินค้าเก่าที่ราคา/จำนวนขั้นต่ำติดลบค้างจากระบบเก่า: ลบหมวดหมู่/เอาไซส์ออก/เปิด-ปิดใช้งาน จะบอกเป็นภาษาไทย
--      ว่าต้องแก้สินค้าตัวไหนก่อน (ดูรายการได้จากข้อ (ง) ท้ายไฟล์)
--
-- วิธีใช้: Supabase > SQL Editor > วางทั้งไฟล์ > กด Run
--   - ต้องรัน supabase-fix-01.sql มาก่อนแล้ว (ไฟล์นี้ตรวจให้ ถ้ายังไม่ได้รันจะหยุดทันทีโดยไม่แก้อะไร)
--   - รันซ้ำได้ปลอดภัย ไม่ทำให้ข้อมูลเสีย (ทั้งไฟล์สำเร็จทั้งหมดหรือไม่เปลี่ยนอะไรเลย)
--   - ⚠️ ต้อง deploy แอปเวอร์ชันใหม่ (หน้าสินค้าแบบการ์ด) ต่อทันทีหลังรันไฟล์นี้
--        แอปเวอร์ชันเก่าจะ เพิ่ม/แก้ไข/ลบ/ปิดใช้งานสินค้า ไม่ได้ (ขึ้น "ไม่มีสิทธิ์ทำรายการนี้")
--        ส่วนหน้าขาย รับ-จ่ายสต๊อก พิมพ์สติกเกอร์ รายงาน ของเวอร์ชันเก่ายังใช้ได้ตามปกติ
--   - ⚠️ ถ้าวันหลังรัน supabase-fix-01.sql ซ้ำ ต้องรันไฟล์นี้ซ้ำตามทุกครั้ง
--        (fix-01 จะเปิดสิทธิ์แก้ตาราง products ตรงๆ กลับมา ไฟล์นี้จะปิดให้อีกรอบ)
--   - รันเสร็จแล้ว SQL Editor จะแสดงรายการ "แบบสินค้า" ทั้งหมดพร้อมจำนวน SKU — ตรวจตามหัวข้อ
--     "ตรวจสอบหลังรัน" ท้ายไฟล์
-- =========================================================================

begin;

-- =========================================================================
-- 0) ตรวจของที่ต้องมีก่อน
-- =========================================================================
do $$
begin
  if to_regprocedure('public.has_perm(text)') is null
     or to_regprocedure('public.is_member()') is null
     or to_regprocedure('public.move_stock(uuid, text, integer, text)') is null
     or to_regprocedure('public.record_sale(uuid, jsonb, numeric, text, text)') is null then
    raise exception 'ต้องรัน supabase-fix-01.sql ให้เสร็จก่อน แล้วค่อยรันไฟล์นี้ (ยังไม่ได้แก้อะไรในฐานข้อมูล)';
  end if;
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception 'ไม่พบระบบ Storage ของ Supabase (storage.buckets / storage.objects) — ยังไม่ได้แก้อะไรในฐานข้อมูล';
  end if;
end
$$;

-- ----- ตัวช่วย (เรียกจาก API ไม่ได้): ตัดช่องว่าง + อักขระที่มองไม่เห็นหัวท้ายข้อความ -----
--   tab/ขึ้นบรรทัด, ช่องว่าง, NBSP (U+00A0), ช่องว่างแบบต่างๆ U+2000-200A, zero-width space/joiner U+200B-200D,
--   LRM/RLM, ตัวคุมทิศทางข้อความ U+202A-202E, U+202F, U+205F, word joiner U+2060, ช่องว่างเต็มความกว้าง U+3000, BOM U+FEFF
--   (btrim ตัดได้แค่ช่องว่างธรรมดา ทำให้ "M" กับ "M"+NBSP กลายเป็นคนละไซส์ที่หน้าตาเหมือนกัน)
create or replace function public.product_clean_text(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(
           p_value,
           '^[\x09-\x0d\x20\x85\xa0\x1680\x180e\x2000-\x200f\x2028-\x202f\x205f-\x2064\x3000\xfeff]+|[\x09-\x0d\x20\x85\xa0\x1680\x180e\x2000-\x200f\x2028-\x202f\x205f-\x2064\x3000\xfeff]+$',
           '',
           'g'
         )
$$;

revoke all on function public.product_clean_text(text) from public, anon, authenticated;

-- =========================================================================
-- 1) ตาราง product_groups (แบบสินค้า = 1 การ์ด)
-- =========================================================================
create table if not exists public.product_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id uuid references public.categories (id) on delete set null,
  color text,
  description text,
  has_sizes boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  -- updated_at = "เวอร์ชัน" ของแบบ: ทุกครั้งที่บันทึก/เปิด-ปิดใช้งาน จะเปลี่ยน → ใช้กันฟอร์มเก่าบันทึกทับ
  updated_at timestamptz not null default now(),
  -- client_id = รหัสคำขอสร้างสินค้าใหม่จากแอป (สุ่มครั้งเดียวต่อฟอร์ม) → กดบันทึกซ้ำแล้วไม่เกิดสินค้าซ้ำ
  client_id uuid,
  constraint product_groups_name_chk check (name = btrim(name) and char_length(name) between 1 and 200)
);

alter table public.product_groups add column if not exists client_id uuid;

create index if not exists idx_product_groups_category on public.product_groups (category_id);
create unique index if not exists product_groups_client_id_key on public.product_groups (client_id);

create or replace function public.product_groups_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- updated_at = เวอร์ชันของแบบ: ต้อง "มากขึ้นเสมอ" ทุกครั้งที่แก้ แม้สองรายการเกิดในเสี้ยววินาทีเดียวกัน
  -- (ถ้าซ้ำค่าเดิมได้ ฟอร์มเก่าอาจตรงกับเวอร์ชันใหม่โดยบังเอิญ แล้วบันทึกทับได้)
  new.updated_at := greatest(now(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;

revoke all on function public.product_groups_touch() from public, anon, authenticated;

drop trigger if exists product_groups_updated_at on public.product_groups;
create trigger product_groups_updated_at
  before update on public.product_groups
  for each row execute function public.product_groups_touch();

-- =========================================================================
-- 2) products.group_id — ทุก SKU ต้องอยู่ในแบบใดแบบหนึ่ง
-- =========================================================================
alter table public.products add column if not exists group_id uuid;

-- is_archived = ไซส์ที่ถูกเอาออกจากแบบแล้ว แต่เก็บไว้เพราะมีประวัติขาย/รับ-จ่าย/สต๊อกค้าง (ปิดใช้งานเสมอ)
-- ต่างจาก "ปิดใช้งานชั่วคราว": เปิดขายทั้งแบบอีกครั้ง ไซส์ที่ archived จะไม่กลับมา
alter table public.products add column if not exists is_archived boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint as c
     where c.conrelid = 'public.products'::regclass and c.conname = 'products_group_id_fkey'
  ) then
    -- on delete restrict: ลบแบบที่ยังมี SKU อยู่ไม่ได้ (delete_product_group ลบ SKU ก่อนเสมอ)
    alter table public.products
      add constraint products_group_id_fkey
      foreign key (group_id) references public.product_groups (id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint as c
     where c.conrelid = 'public.products'::regclass and c.conname = 'products_archived_inactive_chk'
  ) then
    -- ไซส์ที่เลิกใช้แล้วขายไม่ได้เด็ดขาด (กันการแก้ตรงผ่าน service role / SQL Editor ด้วย)
    alter table public.products
      add constraint products_archived_inactive_chk
      check (not (is_archived and coalesce(is_active, false)));
  end if;
end
$$;

create index if not exists idx_products_group on public.products (group_id);
-- ใช้ตรวจ SKU/บาร์โค้ดซ้ำแบบไม่สนตัวพิมพ์เล็ก/ใหญ่ (หน้าขายสแกนหาแบบไม่สนตัวพิมพ์)
create index if not exists idx_products_sku_ci on public.products (lower(btrim(sku)));
create index if not exists idx_products_barcode_ci on public.products (lower(btrim(barcode)));

-- =========================================================================
-- 3) ตาราง product_images (รูปไม่จำกัดต่อแบบ, รูปปก = sort_order น้อยสุด)
--    path = ที่อยู่ไฟล์ในถัง product-images ต้องเป็น '<group_id>/<ชื่อไฟล์>'
-- =========================================================================
create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.product_groups (id) on delete cascade,
  path text not null,
  sort_order integer not null default 0,
  width integer,
  height integer,
  bytes integer,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint product_images_path_key unique (path),
  constraint product_images_path_chk check (
    char_length(path) between 38 and 200 and left(path, 37) = group_id::text || '/'
  ),
  constraint product_images_dims_chk check (
    (width is null or width > 0) and (height is null or height > 0) and (bytes is null or bytes > 0)
  )
);

create index if not exists idx_product_images_group on public.product_images (group_id, sort_order);
-- foreign key ไป auth.users: ลบผู้ใช้แล้วไม่ต้องไล่อ่านทั้งตาราง (Supabase advisor เตือน FK ที่ไม่มี index)
create index if not exists idx_product_images_created_by on public.product_images (created_by);

-- =========================================================================
-- 4) สร้างแบบให้สินค้าเดิมทุกตัว (1 สินค้าเดิม = 1 แบบ) — รันซ้ำได้: ทำเฉพาะแถวที่ยังไม่มีแบบ
-- =========================================================================
do $$
declare
  v_con record;
  v_names text[] := '{}';
  v_defs text[] := '{}';
  v_p record;
  v_gid uuid;
  v_name text;
  v_n integer := 0;
begin
  if not exists (select 1 from public.products as p where p.group_id is null) then
    return;
  end if;

  -- ข้อบังคับแบบ NOT VALID (ราคา/ขั้นต่ำห้ามติดลบ) ตรวจทุกแถวที่ถูกแก้ — สินค้าเก่าที่ค่าติดลบค้างอยู่
  -- จะทำให้ใส่ group_id ไม่ได้ → ถอดออกชั่วคราวแล้วใส่คืนแบบเดิมทุกตัวอักษรในรายการเดียวกัน (ค่าในแถวไม่ถูกแตะ)
  for v_con in
    select c.conname::text as conname, pg_get_constraintdef(c.oid) as def
      from pg_constraint as c
     where c.conrelid = 'public.products'::regclass
       and c.contype = 'c'
       and not c.convalidated
     order by c.conname
  loop
    v_names := v_names || v_con.conname;
    v_defs := v_defs || v_con.def;
    execute format('alter table public.products drop constraint %I', v_con.conname);
  end loop;

  for v_p in
    select p.id, p.name, p.sku, p.size, p.color, p.category_id, p.is_active, p.created_at, p.updated_at
      from public.products as p
     where p.group_id is null
     order by p.created_at nulls first, p.id
       for update
  loop
    v_name := public.product_clean_text(left(coalesce(nullif(public.product_clean_text(v_p.name), ''),
                                                      nullif(public.product_clean_text(v_p.sku), ''),
                                                      'สินค้าไม่มีชื่อ'), 200));

    insert into public.product_groups as g
      (name, category_id, color, has_sizes, is_active, created_at, updated_at)
    values (
      v_name,
      v_p.category_id,
      nullif(public.product_clean_text(v_p.color), ''),
      nullif(public.product_clean_text(v_p.size), '') is not null,
      -- หน้าขายถือว่า is_active ว่าง = ปิดใช้งาน → แบบก็ปิดใช้งานเหมือนกัน
      coalesce(v_p.is_active, false),
      coalesce(v_p.created_at, now()),
      coalesce(v_p.updated_at, v_p.created_at, now())
    )
    returning g.id into v_gid;

    update public.products as p
       set group_id = v_gid,
           name = v_name,
           size = nullif(public.product_clean_text(v_p.size), ''),
           color = nullif(public.product_clean_text(v_p.color), '')
     where p.id = v_p.id;

    v_n := v_n + 1;
  end loop;

  for i in 1 .. coalesce(array_length(v_names, 1), 0) loop
    execute format('alter table public.products add constraint %I %s', v_names[i], v_defs[i]);
  end loop;

  raise notice 'สร้างแบบสินค้าให้สินค้าเดิม % รายการ', v_n;
end
$$;

alter table public.products alter column group_id set not null;

-- =========================================================================
-- 5) ชื่อ/สี/หมวดหมู่ของทุก SKU ตามแบบเสมอ (แก้แบบ → ทุกไซส์เปลี่ยนตาม, ลบหมวดหมู่ → ทุกไซส์ไม่มีหมวดหมู่)
-- =========================================================================
create or replace function public.product_groups_sync_variants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.products as p
     set name = new.name,
         color = new.color,
         category_id = new.category_id
   where p.group_id = new.id
     and (p.name is distinct from new.name
          or p.color is distinct from new.color
          or p.category_id is distinct from new.category_id);
  return null;
end;
$$;

revoke all on function public.product_groups_sync_variants() from public, anon, authenticated;

drop trigger if exists product_groups_sync_variants on public.product_groups;
create trigger product_groups_sync_variants
  after update of name, color, category_id on public.product_groups
  for each row
  when (old.name is distinct from new.name
        or old.color is distinct from new.color
        or old.category_id is distinct from new.category_id)
  execute function public.product_groups_sync_variants();

-- =========================================================================
-- 6) หมวดหมู่: ชื่อห้ามว่าง + ห้ามซ้ำแบบไม่สนตัวพิมพ์/ช่องว่างหัวท้าย
--    (เพิ่ม/แก้/ลบ ยังทำผ่านตาราง categories ตรงๆ เหมือนเดิม ต้องมีสิทธิ์ "จัดการสินค้า")
-- =========================================================================

-- ชื่อหมวดหมู่: ตัดช่องว่าง/อักขระที่มองไม่เห็นหัวท้ายก่อนบันทึก
--   → "อื่นๆ"+NBSP ชนกับ "อื่นๆ" (ชื่อซ้ำ) และชื่อที่มีแต่อักขระที่มองไม่เห็น = ชื่อว่าง (ไม่ผ่านข้อบังคับชื่อ)
--   ไม่แตะชื่อหมวดหมู่ที่มีอยู่แล้ว (ทำเฉพาะตอนเพิ่ม/แก้ชื่อ)
create or replace function public.categories_clean_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := public.product_clean_text(new.name);
  return new;
end;
$$;

revoke all on function public.categories_clean_name() from public, anon, authenticated;

drop trigger if exists categories_clean_name on public.categories;
create trigger categories_clean_name
  before insert or update of name on public.categories
  for each row execute function public.categories_clean_name();

-- ลบหมวดหมู่ = สินค้าในหมวดกลายเป็น "ไม่มีหมวดหมู่" (ต้องแก้แถวสินค้า) — แต่สินค้าเก่าที่ราคา/จำนวนขั้นต่ำติดลบค้าง
-- แก้แถวไม่ได้ (ข้อบังคับ NOT VALID ของ fix-01) → บอกเป็นภาษาไทยว่าต้องแก้สินค้าตัวไหนก่อน แทน error ภาษาอังกฤษ
create or replace function public.categories_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec record;
begin
  select p.name, p.size, p.color, p.sku into v_rec
    from public.products as p
   where (p.category_id = old.id
          or p.group_id in (select g.id from public.product_groups as g where g.category_id = old.id))
     and (p.sell_price < 0 or p.cost_price < 0 or p.min_stock < 0)
   order by p.created_at, p.id
   limit 1;
  if found then
    raise exception 'ลบหมวดหมู่ "%" ไม่ได้: สินค้า "%" (SKU "%") ในหมวดนี้มีราคาหรือจำนวนขั้นต่ำติดลบค้างจากระบบเก่า — เปิดหน้าแก้ไขสินค้านั้น ใส่ค่าให้ถูกแล้วบันทึกก่อน จึงจะลบหมวดหมู่ได้',
      old.name, public.product_label_text(v_rec.name, v_rec.size, v_rec.color), v_rec.sku;
  end if;
  return old;
end;
$$;

revoke all on function public.categories_delete_guard() from public, anon, authenticated;

drop trigger if exists categories_delete_guard on public.categories;
create trigger categories_delete_guard
  before delete on public.categories
  for each row execute function public.categories_delete_guard();

do $$
begin
  if not exists (
    select 1 from pg_constraint as c
     where c.conrelid = 'public.categories'::regclass and c.conname = 'categories_name_chk'
  ) then
    -- NOT VALID: ไม่ตรวจชื่อเก่า ตรวจเฉพาะตอนเพิ่ม/แก้ชื่อ
    alter table public.categories
      add constraint categories_name_chk
      check (btrim(name) <> '' and char_length(btrim(name)) <= 100) not valid;
  end if;

  if to_regclass('public.categories_name_ci_key') is null then
    if exists (
      select 1 from public.categories as c
       group by lower(btrim(c.name))
      having count(*) > 1
    ) then
      raise notice 'มีหมวดหมู่ชื่อซ้ำกันอยู่แล้ว (ต่างกันแค่ตัวพิมพ์/ช่องว่าง) — ข้ามการกันชื่อซ้ำไว้ก่อน ดูข้อ (ข) ท้ายไฟล์';
    else
      create unique index categories_name_ci_key on public.categories (lower(btrim(name)));
    end if;
  end if;
end
$$;

-- =========================================================================
-- 7) สิทธิ์ตาราง + RLS
--    อ่าน: พนักงานจริง (is_member) / เขียน: ผ่านฟังก์ชันข้อ 8 เท่านั้น
--    (ให้สิทธิ์แบบระบุชัดทุกตาราง — Supabase เลิกให้สิทธิ์ตารางใหม่อัตโนมัติตั้งแต่ 30 ต.ค. 2026)
-- =========================================================================
alter table public.product_groups enable row level security;
drop policy if exists "product_groups_select" on public.product_groups;
create policy "product_groups_select" on public.product_groups
  for select to authenticated
  using ((select public.is_member()));
revoke all on table public.product_groups from anon, authenticated;
grant select on table public.product_groups to authenticated;
grant all on table public.product_groups to service_role;

alter table public.product_images enable row level security;
drop policy if exists "product_images_select" on public.product_images;
create policy "product_images_select" on public.product_images
  for select to authenticated
  using ((select public.is_member()));
revoke all on table public.product_images from anon, authenticated;
grant select on table public.product_images to authenticated;
grant all on table public.product_images to service_role;

-- products: อ่านได้เหมือนเดิม (policy products_select จาก fix-01) / เขียนตรงไม่ได้แล้ว
-- (revoke ระดับตารางถอนสิทธิ์รายคอลัมน์ที่ fix-01 ให้ไว้ด้วย)
drop policy if exists "products_insert" on public.products;
drop policy if exists "products_update" on public.products;
drop policy if exists "products_delete" on public.products;
revoke insert, update, delete, truncate on table public.products from anon, authenticated;
grant select on table public.products to authenticated;
grant all on table public.products to service_role;

-- =========================================================================
-- 8) ฟังก์ชัน
-- =========================================================================

-- ----- ตัวช่วยภายใน (เรียกจาก API ไม่ได้) -----
-- อ่านค่าข้อความจาก JSON: null/ไม่มี/ว่าง = null, ตัดช่องว่าง/อักขระที่มองไม่เห็นหัวท้าย, ตัวเลขรับเป็นข้อความ
create or replace function public.product_json_text(p_value jsonb, p_label text)
returns text
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) in ('string', 'number') then
    return nullif(public.product_clean_text(p_value #>> '{}'), '');
  end if;
  raise exception '%ไม่ถูกต้อง', p_label;
end;
$$;

-- อ่านตัวเลขจาก JSON: number หรือข้อความตัวเลข (มีจุลภาคได้), null/ไม่มี/ว่าง = null
create or replace function public.product_json_num(p_value jsonb, p_label text)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v_text text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) = 'number' then
    return (p_value #>> '{}')::numeric;
  end if;
  if jsonb_typeof(p_value) = 'string' then
    v_text := replace(public.product_clean_text(p_value #>> '{}'), ',', '');
    if v_text = '' then
      return null;
    end if;
    if v_text ~ '^-?[0-9]{1,15}(\.[0-9]{1,6})?$' then
      return v_text::numeric;
    end if;
  end if;
  raise exception '%ต้องเป็นตัวเลข', p_label;
end;
$$;

create or replace function public.product_json_uuid(p_value jsonb, p_label text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
declare
  v_text text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) = 'string' then
    v_text := public.product_clean_text(p_value #>> '{}');
    if v_text = '' then
      return null;
    end if;
    if v_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return v_text::uuid;
    end if;
  end if;
  raise exception '%ไม่ถูกต้อง', p_label;
end;
$$;

create or replace function public.product_json_bool(p_value jsonb, p_label text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) = 'boolean' then
    return (p_value #>> '{}')::boolean;
  end if;
  raise exception '%ไม่ถูกต้อง', p_label;
end;
$$;

-- ลำดับไซส์: (ไม่มีไซส์) XXS XS S M L XL 2XL 3XL 4XL 5XL → ไซส์อื่น (ตัวเลขน้อยไปมาก แล้วตามตัวอักษร) → Free/ฟรีไซส์ ท้ายสุด
create or replace function public.product_size_rank(p_size text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case upper(regexp_replace(coalesce(p_size, ''), '[[:space:]]+', '', 'g'))
           when '' then 0
           when 'XXS' then 5 when '2XS' then 5
           when 'XS' then 10
           when 'S' then 20
           when 'M' then 30
           when 'L' then 40
           when 'XL' then 50
           when '2XL' then 60 when 'XXL' then 60
           when '3XL' then 70 when 'XXXL' then 70
           when '4XL' then 80 when 'XXXXL' then 80
           when '5XL' then 90 when 'XXXXXL' then 90
           when 'F' then 1000 when 'FS' then 1000 when 'FREE' then 1000 when 'FREESIZE' then 1000
           when 'ฟรีไซส์' then 1000 when 'ฟรีไซซ์' then 1000 when 'ฟรีไซด์' then 1000
           else 500
         end
$$;

-- ชื่อเต็มของ SKU แบบเดียวกับ productLabel() ในแอป: 'เสื้อยืด · M · ขาว'
create or replace function public.product_label_text(p_name text, p_size text, p_color text)
returns text
language sql
immutable
set search_path = public
as $$
  select concat_ws(' · ', nullif(btrim(p_name), ''), nullif(btrim(p_size), ''), nullif(btrim(p_color), ''))
$$;

-- ทุก SKU ของแบบ พร้อม JSON และคีย์เรียงตามไซส์ (k1 = ลำดับไซส์มาตรฐาน, k2 = ตัวเลขนำหน้า, k3 = ตัวอักษร)
create or replace function public.product_variant_rows(p_group_id uuid)
returns table (id uuid, is_archived boolean, created_at timestamptz, k1 integer, k2 numeric, k3 text, j jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         p.is_archived,
         p.created_at,
         public.product_size_rank(p.size),
         substring(btrim(p.size) from '^[0-9]{1,6}(?:\.[0-9]{1,3})?')::numeric,
         lower(p.size),
         jsonb_build_object(
           'id', p.id,
           'size', p.size,
           'sku', p.sku,
           'barcode', p.barcode,
           'cost_price', p.cost_price,
           'sell_price', p.sell_price,
           'min_stock', p.min_stock,
           'stock_qty', p.stock_qty,
           'is_active', coalesce(p.is_active, false),
           -- true = ถ้าเอาไซส์นี้ออกจากแบบ จะถูกเก็บเป็น archived (ปิดใช้งาน) แทนการลบ
           --        (เคยขาย / เคยรับ-จ่ายสต๊อก / สต๊อกไม่เป็น 0)
           'has_history', (
             p.stock_qty <> 0
             or exists (select 1 from public.sale_items as si where si.product_id = p.id)
             or exists (select 1 from public.stock_movements as m where m.product_id = p.id)
           )
         )
    from public.products as p
   where p.group_id = p_group_id
$$;

-- JSON ของแบบสินค้า (ใช้เป็นผลลัพธ์ของทุกฟังก์ชันที่คืนแบบสินค้า ให้หน้าตาเหมือนกันเสมอ)
create or replace function public.product_group_json(p_group_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', g.id,
    'name', g.name,
    'category_id', g.category_id,
    'color', g.color,
    'description', g.description,
    'has_sizes', g.has_sizes,
    'is_active', g.is_active,
    'has_sales', exists (
      select 1
        from public.products as p
        join public.sale_items as si on si.product_id = p.id
       where p.group_id = g.id
    ),
    'created_at', g.created_at,
    'updated_at', g.updated_at,
    -- variants = ไซส์ปัจจุบันของแบบ (ฟอร์มแก้ไขแสดงและส่งกลับมาทั้งหมด)
    -- archived_variants = ไซส์ที่เอาออกไปแล้วแต่มีประวัติ (อ่านอย่างเดียว; ส่ง id กลับมาใน p_variants = นำกลับมาใช้)
    'variants', coalesce(
      (
        select jsonb_agg(v.j order by v.k1, v.k2 nulls last, v.k3, v.created_at, v.id)
          from public.product_variant_rows(g.id) as v
         where not v.is_archived
      ),
      '[]'::jsonb
    ),
    'archived_variants', coalesce(
      (
        select jsonb_agg(v.j order by v.k1, v.k2 nulls last, v.k3, v.created_at, v.id)
          from public.product_variant_rows(g.id) as v
         where v.is_archived
      ),
      '[]'::jsonb
    ),
    'images', coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'id', i.id,
                   'path', i.path,
                   'sort_order', i.sort_order,
                   'width', i.width,
                   'height', i.height
                 )
                 order by i.sort_order, i.created_at, i.id
               )
          from public.product_images as i
         where i.group_id = g.id
      ),
      '[]'::jsonb
    )
  )
  from public.product_groups as g
  where g.id = p_group_id
$$;

revoke all on function public.product_json_text(jsonb, text) from public, anon, authenticated;
revoke all on function public.product_json_num(jsonb, text) from public, anon, authenticated;
revoke all on function public.product_json_uuid(jsonb, text) from public, anon, authenticated;
revoke all on function public.product_json_bool(jsonb, text) from public, anon, authenticated;
revoke all on function public.product_size_rank(text) from public, anon, authenticated;
revoke all on function public.product_label_text(text, text, text) from public, anon, authenticated;
revoke all on function public.product_variant_rows(uuid) from public, anon, authenticated;
revoke all on function public.product_group_json(uuid) from public, anon, authenticated;

-- -------------------------------------------------------------------------
-- save_product_group(p_group, p_variants) — เพิ่ม/แก้แบบสินค้าพร้อมทุกไซส์ในครั้งเดียว
--   p_variants = ไซส์ปัจจุบันทั้งหมดของแบบ: รายการที่มี id = แก้ (id ของไซส์ที่เลิกใช้ = นำกลับมาใช้),
--   ไม่มี id = เพิ่มใหม่, ไซส์เดิมที่ไม่ได้ส่งมา = ลบ (ถ้าไม่เคยขาย/รับ-จ่าย และสต๊อกเป็น 0)
--   ไม่งั้นปิดใช้งานและเก็บเป็นไซส์ที่เลิกใช้ (is_archived); ไซส์ที่ยังมีสต๊อกเหลือ เอาออกไม่ได้
--   แก้แบบเดิม: p_group.updated_at ต้องตรงกับค่าล่าสุดในฐานข้อมูล (ค่าที่ได้ตอนโหลดฟอร์ม) ไม่งั้นปฏิเสธ
--     — กันฟอร์มเก่าที่เปิดค้างอีกเครื่องบันทึกทับ (ลบไซส์ที่เพิ่งเพิ่ม / เอาไซส์ที่เลิกใช้กลับมา / เปิดขายสินค้าที่เพิ่งปิด)
--   สร้างแบบใหม่: p_group.client_id (ไม่บังคับ) ส่งซ้ำ = คืนแบบที่สร้างไว้แล้ว + already_saved = true
-- -------------------------------------------------------------------------
create or replace function public.save_product_group(p_group jsonb, p_variants jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gid uuid;
  v_existing boolean := false;
  v_name text;
  v_category_id uuid;
  v_color text;
  v_description text;
  v_has_sizes boolean;
  v_active boolean;
  v_old_active boolean;
  v_ts text;
  v_expected timestamptz;
  v_old_updated timestamptz;
  v_client_id uuid;
  v_found_id uuid;
  v_count integer;
  v_elem jsonb;
  v_idx integer := 0;
  v_vid uuid;
  v_size text;
  v_sku text;
  v_barcode text;
  v_cost numeric;
  v_sell numeric;
  v_min numeric;
  v_vactive boolean;
  v_open numeric;
  v_prefix text;
  v_norm jsonb := '[]'::jsonb;
  v_rec record;
  v_other record;
  v_pay_ids uuid[];
  v_del_ids uuid[];
  v_keep_ids uuid[];
  v_new_id uuid;
begin
  -- ----- ผู้ใช้ + สิทธิ์ -----
  if v_uid is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่';
  end if;
  if not public.has_perm('products') then
    raise exception 'ไม่มีสิทธิ์จัดการสินค้า';
  end if;

  -- ----- ข้อมูลแบบสินค้า -----
  if p_group is null or jsonb_typeof(p_group) <> 'object' then
    raise exception 'ข้อมูลสินค้าไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;

  v_gid := public.product_json_uuid(p_group -> 'id', 'รหัสสินค้า');

  v_name := public.product_json_text(p_group -> 'name', 'ชื่อสินค้า');
  if v_name is null then
    raise exception 'กรุณากรอกชื่อสินค้า';
  end if;
  if char_length(v_name) > 200 then
    raise exception 'ชื่อสินค้ายาวเกินไป (สูงสุด 200 ตัวอักษร)';
  end if;

  v_category_id := public.product_json_uuid(p_group -> 'category_id', 'หมวดหมู่');

  v_color := public.product_json_text(p_group -> 'color', 'สี');
  if char_length(v_color) > 100 then
    raise exception 'ชื่อสียาวเกินไป (สูงสุด 100 ตัวอักษร)';
  end if;

  v_description := public.product_json_text(p_group -> 'description', 'รายละเอียดสินค้า');
  if char_length(v_description) > 2000 then
    raise exception 'รายละเอียดสินค้ายาวเกินไป (สูงสุด 2,000 ตัวอักษร)';
  end if;

  v_has_sizes := public.product_json_bool(p_group -> 'has_sizes', 'ตัวเลือก "มีไซส์"');
  if v_has_sizes is null then
    raise exception 'กรุณาระบุว่าสินค้านี้มีไซส์หรือไม่';
  end if;

  v_active := public.product_json_bool(p_group -> 'is_active', 'สถานะเปิดขาย');

  -- เวลาแก้ไขล่าสุดของแบบ ตอนที่โหลดฟอร์ม (ส่งกลับมาตามที่ได้รับทุกตัวอักษร) — บังคับเมื่อแก้แบบเดิม ตรวจหลังล็อกแถว
  v_ts := public.product_json_text(p_group -> 'updated_at', 'เวลาแก้ไขล่าสุด');
  if v_ts is not null then
    if v_ts !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' then
      raise exception 'ข้อมูลสินค้าไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
    end if;
    begin
      v_expected := v_ts::timestamptz;
    exception when others then
      raise exception 'ข้อมูลสินค้าไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
    end;
  end if;

  -- รหัสคำขอ (สุ่มครั้งเดียวต่อฟอร์มเพิ่มสินค้าใหม่) — ใช้เฉพาะตอนสร้างแบบใหม่
  v_client_id := public.product_json_uuid(p_group -> 'client_id', 'รหัสคำขอ');

  -- ----- ไซส์ / SKU -----
  if p_variants is null or jsonb_typeof(p_variants) <> 'array' then
    raise exception 'ข้อมูลไซส์และราคาไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  v_count := jsonb_array_length(p_variants);
  if v_has_sizes then
    if v_count < 1 then
      raise exception 'กรุณาเพิ่มไซส์อย่างน้อย 1 ไซส์';
    end if;
    if v_count > 50 then
      raise exception 'สินค้าหนึ่งแบบมีได้ไม่เกิน 50 ไซส์';
    end if;
  elsif v_count <> 1 then
    raise exception 'สินค้าแบบไม่มีไซส์ต้องมี SKU และราคาชุดเดียว (ถ้ามีหลายไซส์ ให้ติ๊ก "มีไซส์")';
  end if;

  for v_elem in
    select e.elem from jsonb_array_elements(p_variants) as e(elem)
  loop
    v_idx := v_idx + 1;
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'ข้อมูลไซส์และราคาไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
    end if;

    v_vid := public.product_json_uuid(v_elem -> 'id', 'รหัสรายการสินค้า');

    v_size := public.product_json_text(v_elem -> 'size', 'ไซส์');
    if v_has_sizes then
      if v_size is null then
        raise exception 'กรุณากรอกไซส์ให้ครบทุกแถว';
      end if;
      v_prefix := 'ไซส์ ' || v_size || ': ';
    else
      if v_size is not null then
        raise exception 'สินค้าแบบไม่มีไซส์ต้องไม่ระบุไซส์ (ถ้ามีหลายไซส์ ให้ติ๊ก "มีไซส์")';
      end if;
      v_prefix := '';
    end if;

    v_sku := public.product_json_text(v_elem -> 'sku', v_prefix || 'SKU ');
    if v_sku is null then
      raise exception '%กรุณากรอก SKU', v_prefix;
    end if;

    v_barcode := public.product_json_text(v_elem -> 'barcode', v_prefix || 'บาร์โค้ด');

    v_sell := public.product_json_num(v_elem -> 'sell_price', v_prefix || 'ราคาขาย');
    if v_sell is null then
      raise exception '%กรุณากรอกราคาขาย', v_prefix;
    end if;
    v_sell := round(v_sell, 2);
    if v_sell < 0 then
      raise exception '%ราคาขายต้องไม่ติดลบ', v_prefix;
    end if;
    if v_sell > 99999999.99 then
      raise exception '%ราคาขายสูงเกินไป', v_prefix;
    end if;

    v_cost := round(coalesce(public.product_json_num(v_elem -> 'cost_price', v_prefix || 'ราคาทุน'), 0), 2);
    if v_cost < 0 then
      raise exception '%ราคาทุนต้องไม่ติดลบ', v_prefix;
    end if;
    if v_cost > 99999999.99 then
      raise exception '%ราคาทุนสูงเกินไป', v_prefix;
    end if;

    v_min := coalesce(public.product_json_num(v_elem -> 'min_stock', v_prefix || 'จำนวนขั้นต่ำ'), 0);
    if v_min <> trunc(v_min) or v_min < 0 or v_min > 1000000 then
      raise exception '%จำนวนขั้นต่ำต้องเป็นจำนวนเต็ม 0 ถึง 1,000,000', v_prefix;
    end if;

    v_vactive := coalesce(public.product_json_bool(v_elem -> 'is_active', v_prefix || 'สถานะเปิดขาย'), true);

    v_open := coalesce(public.product_json_num(v_elem -> 'opening_qty', v_prefix || 'ยอดยกมา'), 0);
    if v_open <> trunc(v_open) or v_open < 0 or v_open > 100000 then
      raise exception '%ยอดยกมาต้องเป็นจำนวนเต็ม 0 ถึง 100,000 ชิ้น', v_prefix;
    end if;
    if v_open > 0 and v_vid is not null then
      raise exception '%ใส่ยอดยกมาได้เฉพาะรายการที่เพิ่มใหม่ — ของที่มีอยู่แล้วให้รับเข้าที่เมนูรับ-จ่ายสต๊อก', v_prefix;
    end if;

    v_norm := v_norm || jsonb_build_array(jsonb_build_object(
      'idx', v_idx,
      'id', v_vid,
      'size', v_size,
      'sku', v_sku,
      'barcode', v_barcode,
      'cost_price', v_cost,
      'sell_price', v_sell,
      'min_stock', v_min::integer,
      'is_active', v_vactive,
      'opening_qty', v_open::integer,
      'prefix', v_prefix
    ));
  end loop;

  -- ----- ซ้ำกันเองในข้อมูลที่ส่งมา -----
  if exists (
    select 1
      from jsonb_to_recordset(v_norm) as x(id uuid)
     where x.id is not null
     group by x.id
    having count(*) > 1
  ) then
    raise exception 'มีรายการซ้ำกันในข้อมูลที่ส่งมา กรุณาโหลดหน้าใหม่';
  end if;

  select min(x.size) as size into v_rec
    from jsonb_to_recordset(v_norm) as x(size text)
   where x.size is not null
   group by lower(x.size)
  having count(*) > 1
   limit 1;
  if found then
    raise exception 'ไซส์ "%" ซ้ำกัน — แต่ละไซส์ต้องไม่ซ้ำกัน', v_rec.size;
  end if;

  -- รหัสของไซส์หนึ่ง (SKU หรือบาร์โค้ด) ห้ามตรงกับรหัสของอีกไซส์ (หน้าขายสแกนหาแบบไม่สนตัวพิมพ์)
  with codes as (
    select x.idx, 'sku'::text as kind, x.sku as code
      from jsonb_to_recordset(v_norm) as x(idx integer, sku text)
    union all
    select x.idx, 'barcode'::text, x.barcode
      from jsonb_to_recordset(v_norm) as x(idx integer, barcode text)
     where x.barcode is not null
  )
  select a.code, a.kind as kind_a, b.kind as kind_b into v_rec
    from codes as a
    join codes as b on lower(a.code) = lower(b.code) and a.idx < b.idx
   order by a.idx, b.idx
   limit 1;
  if found then
    if v_rec.kind_a = 'sku' and v_rec.kind_b = 'sku' then
      raise exception 'SKU "%" ซ้ำกันในสินค้านี้ — แต่ละไซส์ต้องมี SKU ของตัวเอง', v_rec.code;
    end if;
    raise exception 'รหัส "%" ใช้ซ้ำกันหลายไซส์ในสินค้านี้ — SKU และบาร์โค้ดของแต่ละไซส์ต้องไม่ซ้ำกัน', v_rec.code;
  end if;

  if not public.has_perm('stock')
     and exists (select 1 from jsonb_to_recordset(v_norm) as x(opening_qty integer) where x.opening_qty > 0) then
    raise exception 'ไม่มีสิทธิ์รับ-จ่ายสต๊อก จึงใส่ยอดยกมาไม่ได้ — เว้นช่องยอดยกมาว่างไว้ แล้วให้ผู้มีสิทธิ์รับสินค้าเข้าที่เมนูรับ-จ่ายสต๊อก';
  end if;

  -- ----- บันทึกทีละคำขอ (กันสองเครื่องตั้ง SKU เดียวกันพร้อมกัน — ตรวจซ้ำแบบไม่สนตัวพิมพ์ได้แม่นยำ) -----
  perform pg_advisory_xact_lock(hashtext('newcute_save_product_group'));

  -- กดบันทึกสินค้าใหม่ซ้ำ (ครั้งแรกสำเร็จแล้วแต่เน็ตหลุดก่อนได้คำตอบ) = คืนแบบที่สร้างไว้แล้ว ไม่สร้างซ้ำ
  if v_gid is null and v_client_id is not null then
    select g.id into v_found_id
      from public.product_groups as g
     where g.client_id = v_client_id;
    if found then
      return public.product_group_json(v_found_id) || jsonb_build_object('already_saved', true);
    end if;
  end if;

  if v_category_id is not null
     and not exists (select 1 from public.categories as c where c.id = v_category_id) then
    raise exception 'ไม่พบหมวดหมู่ที่เลือก (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;

  if v_gid is not null then
    select g.is_active, g.updated_at into v_old_active, v_old_updated
      from public.product_groups as g
     where g.id = v_gid
       for update;
    if not found then
      raise exception 'ไม่พบสินค้านี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
    end if;
    -- ฟอร์มต้องโหลดมาจากเวอร์ชันล่าสุด (ทุกการบันทึก/เปิด-ปิดใช้งาน/ลบหมวดหมู่ของแบบนี้ เปลี่ยน updated_at;
    -- ขายของ รับ-จ่ายสต๊อก เพิ่ม/ลบ/เรียงรูป ไม่เปลี่ยน)
    if v_expected is null then
      raise exception 'ข้อมูลสินค้าไม่ครบ (ไม่มีเวลาแก้ไขล่าสุด) กรุณาโหลดหน้าใหม่แล้วแก้ไขอีกครั้ง';
    end if;
    if v_expected <> v_old_updated then
      raise exception 'สินค้านี้ถูกแก้ไขจากเครื่องอื่นหลังจากที่คุณเปิดหน้านี้ — กรุณาโหลดหน้าใหม่แล้วแก้ไขอีกครั้ง';
    end if;
    v_existing := true;
    v_active := coalesce(v_active, v_old_active, true);
    -- ล็อกทุก SKU ของแบบนี้ เรียงตาม id (ลำดับเดียวกับ record_sale — กัน deadlock)
    perform 1
       from public.products as p
      where p.group_id = v_gid
      order by p.id
        for update;
  else
    v_active := coalesce(v_active, true);
    insert into public.product_groups as g (name, category_id, color, description, has_sizes, is_active, client_id)
    values (v_name, v_category_id, v_color, v_description, v_has_sizes, v_active, v_client_id)
    returning g.id into v_gid;
  end if;

  -- รายการที่มี id ต้องเป็นของแบบนี้
  select x.id into v_vid
    from jsonb_to_recordset(v_norm) as x(id uuid)
   where x.id is not null
     and not exists (select 1 from public.products as p where p.id = x.id and p.group_id = v_gid)
   limit 1;
  if found then
    raise exception 'ไม่พบบางไซส์ของสินค้านี้ (อาจถูกลบหรือแก้ไขจากเครื่องอื่น) กรุณาโหลดหน้าใหม่';
  end if;

  -- ----- ตรวจรูปแบบรหัส/ไซส์ เฉพาะค่าที่ใหม่หรือเปลี่ยน (ค่าเก่าจากระบบเดิมที่ไม่ได้แก้ ไม่บังคับ) -----
  for v_rec in
    select x.idx, x.id, x.size, x.sku, x.barcode, x.prefix,
           p.sku as old_sku, p.barcode as old_barcode, p.size as old_size
      from jsonb_to_recordset(v_norm) as x(idx integer, id uuid, size text, sku text, barcode text, prefix text)
      left join public.products as p on p.id = x.id
     order by x.idx
  loop
    if v_rec.size is not null and (v_rec.id is null or v_rec.size is distinct from v_rec.old_size) then
      if char_length(v_rec.size) > 20 then
        raise exception 'ไซส์ "%" ยาวเกินไป (สูงสุด 20 ตัวอักษร)', v_rec.size;
      end if;
      -- อักขระที่มองไม่เห็นกลางคำ (zero-width space, NBSP, ตัวคุม ฯลฯ) ทำให้ไซส์หน้าตาเหมือนกันแต่เป็นคนละไซส์
      if v_rec.size ~ '[\x01-\x1f\x7f-\x9f\xa0\xad\x1680\x180e\x2000-\x200f\x2028-\x202f\x205f-\x206f\x3000\xfeff]' then
        raise exception 'ไซส์ "%" มีอักขระพิเศษที่มองไม่เห็นปนอยู่ (มักติดมาตอนก๊อปวาง) — ลบช่องไซส์แล้วพิมพ์ใหม่', v_rec.size;
      end if;
    end if;
    if v_rec.id is null or v_rec.sku is distinct from v_rec.old_sku then
      if v_rec.sku !~ '^[ -~]+$' then
        raise exception '%SKU "%" ต้องเป็นตัวอักษรภาษาอังกฤษ ตัวเลข หรือสัญลักษณ์เท่านั้น (ห้ามภาษาไทย)', v_rec.prefix, v_rec.sku;
      end if;
      if char_length(v_rec.sku) > 64 then
        raise exception '%SKU ยาวเกินไป (สูงสุด 64 ตัวอักษร)', v_rec.prefix;
      end if;
    end if;
    if v_rec.barcode is not null and (v_rec.id is null or v_rec.barcode is distinct from v_rec.old_barcode) then
      if v_rec.barcode !~ '^[ -~]+$' then
        raise exception '%บาร์โค้ด "%" ต้องเป็นตัวอักษรภาษาอังกฤษ ตัวเลข หรือสัญลักษณ์เท่านั้น', v_rec.prefix, v_rec.barcode;
      end if;
      if char_length(v_rec.barcode) > 64 then
        raise exception '%บาร์โค้ดยาวเกินไป (สูงสุด 64 ตัวอักษร)', v_rec.prefix;
      end if;
    end if;
  end loop;

  -- ----- ไซส์เดิมที่ไม่ได้ส่งมา: ไม่มีประวัติ = ลบ / มีประวัติ = ปิดใช้งานเก็บไว้เป็นไซส์ที่เลิกใช้ (is_archived) -----
  select coalesce(array_agg(x.id), '{}'::uuid[]) into v_pay_ids
    from jsonb_to_recordset(v_norm) as x(id uuid)
   where x.id is not null;

  select coalesce(array_agg(l.id order by l.id) filter (where not l.has_history), '{}'::uuid[]),
         coalesce(array_agg(l.id order by l.id) filter (where l.has_history), '{}'::uuid[])
    into v_del_ids, v_keep_ids
    from (
      select p.id,
             (p.stock_qty <> 0
              or exists (select 1 from public.sale_items as si where si.product_id = p.id)
              or exists (select 1 from public.stock_movements as m where m.product_id = p.id)) as has_history
        from public.products as p
       where p.group_id = v_gid
         and p.id <> all (v_pay_ids)
    ) as l;

  -- เปลี่ยนเป็นแบบมีไซส์: SKU เดิมที่ไม่มีไซส์และมีประวัติแล้ว ต้องใส่ไซส์ให้ (ไม่งั้นสต๊อก/ประวัติของมันจะหายจากการ์ด)
  if v_has_sizes then
    select p.sku into v_rec
      from public.products as p
     where p.id = any (v_keep_ids)
       and nullif(btrim(p.size), '') is null
     limit 1;
    if found then
      raise exception 'สินค้าเดิม (SKU "%") เคยขายหรือรับ-จ่ายสต๊อกแล้ว ลบไม่ได้ — ตอนเปลี่ยนเป็นแบบมีไซส์ ให้กำหนดไซส์ให้รายการเดิมด้วย', v_rec.sku;
    end if;
  end if;

  -- ไซส์ที่ส่งมา ห้ามชนกับไซส์เดิมที่ถูกปิดใช้งานเก็บไว้ (ให้เปิดใช้งานรายการเดิมแทนการเพิ่มใหม่)
  select k.size, k.sku into v_rec
    from public.products as k
    join jsonb_to_recordset(v_norm) as x(size text)
      on lower(coalesce(nullif(btrim(k.size), ''), '')) = lower(coalesce(x.size, ''))
   where k.id = any (v_keep_ids)
   limit 1;
  if found then
    if nullif(btrim(v_rec.size), '') is null then
      raise exception 'สินค้านี้มีรายการเดิม (SKU "%") ที่เคยขายหรือรับ-จ่ายสต๊อกแล้ว — ให้แก้ไขรายการเดิมแทนการเพิ่มใหม่', v_rec.sku;
    end if;
    raise exception 'ไซส์ "%" มีอยู่แล้ว (SKU "%" ปิดใช้งานอยู่เพราะเคยขายหรือรับ-จ่ายสต๊อก) — ให้เปิดใช้งานไซส์เดิมแทนการเพิ่มใหม่', btrim(v_rec.size), v_rec.sku;
  end if;

  -- ไซส์ที่จะถูกเก็บเป็น "เลิกใช้" แต่ราคา/จำนวนขั้นต่ำติดลบค้างจากระบบเก่า: แก้แถวนั้นไม่ได้ (ข้อบังคับของ fix-01)
  -- → บอกเป็นภาษาไทยให้แก้ค่าก่อน (ตรวจก่อนเรื่องสต๊อก เพราะแถวแบบนี้ปรับยอดสต๊อกไม่ได้จนกว่าจะแก้ราคา)
  select p.size, p.sku into v_rec
    from public.products as p
   where p.id = any (v_keep_ids)
     and (p.sell_price < 0 or p.cost_price < 0 or p.min_stock < 0)
     and (p.is_active is distinct from false
          or p.is_archived is distinct from true
          or p.name is distinct from v_name
          or p.color is distinct from v_color
          or p.category_id is distinct from v_category_id)
   order by public.product_size_rank(p.size), lower(p.size), p.id
   limit 1;
  if found then
    raise exception 'ไซส์ "%" (SKU "%") มีราคาหรือจำนวนขั้นต่ำติดลบค้างจากระบบเก่า — ใส่ไซส์นี้กลับในรายการ แก้ค่าให้ถูกแล้วบันทึกก่อน จึงจะเอาออกได้',
      coalesce(v_rec.size, 'ไม่มีไซส์'), v_rec.sku;
  end if;

  -- ไซส์ปัจจุบันที่จะเอาออกแต่ยังมีสต๊อกเหลือ: ห้าม — ถ้าเก็บเป็น "เลิกใช้" (ปิดใช้งาน) สต๊อกนั้นจะหายจาก
  -- หน้าสต๊อก มูลค่าสต๊อก และแจ้งเตือนของใกล้หมด (ไซส์ที่เลิกใช้ไปแล้วก่อนหน้านี้ไม่นับ)
  select p.size, p.sku, p.stock_qty into v_rec
    from public.products as p
   where p.id = any (v_keep_ids)
     and not p.is_archived
     and p.stock_qty <> 0
   order by public.product_size_rank(p.size), lower(p.size), p.id
   limit 1;
  if found then
    raise exception 'ไซส์ "%" (SKU "%") ยังมีสต๊อก % ชิ้น เอาออกไม่ได้ — ปรับยอดเป็น 0 ที่เมนูรับ-จ่ายสต๊อกก่อน หรือปิดขายเฉพาะไซส์นี้แทน',
      coalesce(v_rec.size, 'ไม่มีไซส์'), v_rec.sku, v_rec.stock_qty;
  end if;

  delete from public.products as p
   where p.id = any (v_del_ids);

  update public.products as p
     set is_active = false,
         is_archived = true,
         name = v_name,
         color = v_color,
         category_id = v_category_id
   where p.id = any (v_keep_ids)
     and (p.is_active is distinct from false
          or p.is_archived is distinct from true
          or p.name is distinct from v_name
          or p.color is distinct from v_color
          or p.category_id is distinct from v_category_id);

  -- ----- SKU/บาร์โค้ด ห้ามตรงกับ SKU หรือบาร์โค้ดของสินค้าอื่น (ไม่สนตัวพิมพ์เล็ก/ใหญ่) -----
  for v_rec in
    select x.idx, x.id, x.sku, x.barcode, p.sku as old_sku, p.barcode as old_barcode
      from jsonb_to_recordset(v_norm) as x(idx integer, id uuid, sku text, barcode text)
      left join public.products as p on p.id = x.id
     order by x.idx
  loop
    if v_rec.id is null or v_rec.sku is distinct from v_rec.old_sku then
      select o.name, o.size, o.color into v_other
        from public.products as o
       where o.id <> all (v_pay_ids)
         and (lower(btrim(o.sku)) = lower(v_rec.sku) or lower(btrim(o.barcode)) = lower(v_rec.sku))
       order by o.created_at, o.id
       limit 1;
      if found then
        raise exception 'SKU "%" ซ้ำกับสินค้า "%"', v_rec.sku, public.product_label_text(v_other.name, v_other.size, v_other.color);
      end if;
    end if;
    if v_rec.barcode is not null and (v_rec.id is null or v_rec.barcode is distinct from v_rec.old_barcode) then
      select o.name, o.size, o.color into v_other
        from public.products as o
       where o.id <> all (v_pay_ids)
         and (lower(btrim(o.barcode)) = lower(v_rec.barcode) or lower(btrim(o.sku)) = lower(v_rec.barcode))
       order by o.created_at, o.id
       limit 1;
      if found then
        raise exception 'บาร์โค้ด "%" ซ้ำกับสินค้า "%"', v_rec.barcode, public.product_label_text(v_other.name, v_other.size, v_other.color);
      end if;
    end if;
  end loop;

  -- ----- แก้ไซส์เดิม (2 ขั้น: SKU/บาร์โค้ดที่เปลี่ยนใส่ค่าชั่วคราวก่อน → สลับ SKU ระหว่างไซส์ได้) -----
  update public.products as p
     set name = v_name,
         color = v_color,
         category_id = v_category_id,
         size = x.size,
         sku = case when x.sku is distinct from p.sku then '~' || p.id::text else p.sku end,
         barcode = case when x.barcode is distinct from p.barcode then null else p.barcode end,
         cost_price = x.cost_price,
         sell_price = x.sell_price,
         min_stock = x.min_stock,
         is_active = (v_active and x.is_active),
         is_archived = false
    from jsonb_to_recordset(v_norm) as x(id uuid, size text, sku text, barcode text,
                                          cost_price numeric, sell_price numeric, min_stock integer, is_active boolean)
   where p.id = x.id;

  update public.products as p
     set sku = x.sku,
         barcode = x.barcode
    from jsonb_to_recordset(v_norm) as x(id uuid, sku text, barcode text)
   where p.id = x.id
     and (p.sku is distinct from x.sku or p.barcode is distinct from x.barcode);

  -- ----- เพิ่มไซส์ใหม่ (+ ยอดยกมา บันทึกเป็นรับเข้าแบบเดียวกับ move_stock) -----
  for v_rec in
    select x.idx, x.size, x.sku, x.barcode, x.cost_price, x.sell_price, x.min_stock, x.is_active, x.opening_qty
      from jsonb_to_recordset(v_norm) as x(idx integer, id uuid, size text, sku text, barcode text,
                                           cost_price numeric, sell_price numeric, min_stock integer,
                                           is_active boolean, opening_qty integer)
     where x.id is null
     order by x.idx
  loop
    insert into public.products as p
      (group_id, name, sku, barcode, category_id, size, color,
       cost_price, sell_price, stock_qty, min_stock, is_active)
    values
      (v_gid, v_name, v_rec.sku, v_rec.barcode, v_category_id, v_rec.size, v_color,
       v_rec.cost_price, v_rec.sell_price, 0, v_rec.min_stock, v_active and v_rec.is_active)
    returning p.id into v_new_id;

    if v_rec.opening_qty > 0 then
      update public.products as p
         set stock_qty = v_rec.opening_qty
       where p.id = v_new_id;

      insert into public.stock_movements
        (product_id, type, qty, qty_before, qty_after, note, created_by)
      values
        (v_new_id, 'in', v_rec.opening_qty, 0, v_rec.opening_qty, 'ยอดยกมา', v_uid);
    end if;
  end loop;

  -- ----- แก้หัวแบบสินค้า (ทำหลังสุด: ทุกไซส์ตรงกับแบบแล้ว trigger ซิงก์จึงไม่ต้องแก้อะไรเพิ่ม) -----
  if v_existing then
    update public.product_groups as g
       set name = v_name,
           category_id = v_category_id,
           color = v_color,
           description = v_description,
           has_sizes = v_has_sizes,
           is_active = v_active
     where g.id = v_gid;
  end if;

  return public.product_group_json(v_gid) || jsonb_build_object('already_saved', false);
end;
$$;

-- -------------------------------------------------------------------------
-- set_product_group_active(p_group_id, p_active) — เปิดขาย/ปิดใช้งานทั้งแบบ
--   ปิด = ทุก SKU ปิด / เปิด = ทุกไซส์ปัจจุบันของแบบเปิด (ไซส์ที่ archived ไม่กลับมา)
-- -------------------------------------------------------------------------
create or replace function public.set_product_group_active(p_group_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rec record;
begin
  if v_uid is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่';
  end if;
  if not public.has_perm('products') then
    raise exception 'ไม่มีสิทธิ์จัดการสินค้า';
  end if;
  if p_group_id is null then
    raise exception 'กรุณาเลือกสินค้า';
  end if;
  if p_active is null then
    raise exception 'กรุณาระบุว่าจะเปิดขายหรือปิดใช้งาน';
  end if;

  perform 1
     from public.product_groups as g
    where g.id = p_group_id
      for update;
  if not found then
    raise exception 'ไม่พบสินค้านี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;

  perform 1
     from public.products as p
    where p.group_id = p_group_id
    order by p.id
      for update;

  -- SKU เก่าที่ราคา/จำนวนขั้นต่ำติดลบค้างจากระบบเก่า แก้แถวไม่ได้ (ข้อบังคับของ fix-01) → บอกเป็นภาษาไทย
  select p.size, p.sku into v_rec
    from public.products as p
   where p.group_id = p_group_id
     and (p.sell_price < 0 or p.cost_price < 0 or p.min_stock < 0)
     and case when p_active then not p.is_archived and p.is_active is distinct from true
              else p.is_active is distinct from false end
   order by public.product_size_rank(p.size), lower(p.size), p.id
   limit 1;
  if found then
    raise exception 'SKU "%" (ไซส์ %) ของสินค้านี้มีราคาหรือจำนวนขั้นต่ำติดลบค้างจากระบบเก่า — เปิดหน้าแก้ไขสินค้า ใส่ค่าให้ถูกแล้วบันทึกก่อน',
      v_rec.sku, coalesce(v_rec.size, '-');
  end if;

  if p_active then
    update public.products as p
       set is_active = true
     where p.group_id = p_group_id
       and not p.is_archived
       and p.is_active is distinct from true;
  else
    update public.products as p
       set is_active = false
     where p.group_id = p_group_id
       and p.is_active is distinct from false;
  end if;

  update public.product_groups as g
     set is_active = p_active
   where g.id = p_group_id;

  return public.product_group_json(p_group_id);
end;
$$;

-- -------------------------------------------------------------------------
-- delete_product_group(p_group_id) — ลบทั้งแบบ (เคยขายแล้ว หรือยังมีสต๊อกเหลือ ลบไม่ได้ → ให้ปิดใช้งานแทน)
--   คืน image_paths ให้แอปลบไฟล์ใน Storage ต่อ
-- -------------------------------------------------------------------------
create or replace function public.delete_product_group(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_paths text[];
  v_rec record;
begin
  if v_uid is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่';
  end if;
  if not public.has_perm('products') then
    raise exception 'ไม่มีสิทธิ์จัดการสินค้า';
  end if;
  if p_group_id is null then
    raise exception 'กรุณาเลือกสินค้า';
  end if;

  perform 1
     from public.product_groups as g
    where g.id = p_group_id
      for update;
  if not found then
    raise exception 'ไม่พบสินค้านี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;

  -- ล็อก SKU ก่อนตรวจ: บิลที่กำลังบันทึกพร้อมกันจะรอ หรือเราจะเห็นบิลนั้นแล้ว
  perform 1
     from public.products as p
    where p.group_id = p_group_id
    order by p.id
      for update;

  if exists (
    select 1
      from public.products as p
      join public.sale_items as si on si.product_id = p.id
     where p.group_id = p_group_id
  ) then
    raise exception 'สินค้านี้มีประวัติการขาย ลบไม่ได้ — ให้ปิดใช้งานแทน';
  end if;

  -- ยังมีสต๊อกเหลือ: ห้ามลบ (ไม่งั้นสต๊อกและประวัติรับ-จ่ายหายไปทั้งหมด — ผู้มีแค่สิทธิ์จัดการสินค้า
  -- รับ-จ่ายสต๊อกไม่ได้ ก็ต้องลบสต๊อกทิ้งไม่ได้เหมือนกัน)
  select p.sku, p.stock_qty into v_rec
    from public.products as p
   where p.group_id = p_group_id
     and p.stock_qty <> 0
   order by p.is_archived, public.product_size_rank(p.size), lower(p.size), p.id
   limit 1;
  if found then
    raise exception 'สินค้านี้ยังมีสต๊อกเหลืออยู่ (SKU "%" เหลือ % ชิ้น) ลบไม่ได้ — ปรับยอดสต๊อกเป็น 0 ที่เมนูรับ-จ่ายสต๊อกก่อน หรือปิดใช้งานแทน',
      v_rec.sku, v_rec.stock_qty;
  end if;

  select coalesce(array_agg(i.path order by i.sort_order, i.created_at, i.id), '{}'::text[])
    into v_paths
    from public.product_images as i
   where i.group_id = p_group_id;

  -- ประวัติรับ-จ่ายสต๊อกของ SKU เหล่านี้ถูกลบตาม (stock_movements on delete cascade)
  delete from public.products as p where p.group_id = p_group_id;
  delete from public.product_images as i where i.group_id = p_group_id;
  delete from public.product_groups as g where g.id = p_group_id;

  return jsonb_build_object('deleted', true, 'id', p_group_id, 'image_paths', to_jsonb(v_paths));
end;
$$;

-- -------------------------------------------------------------------------
-- get_product_group(p_group_id) — อ่านแบบสินค้า (หน้าตาเดียวกับผลของ save_product_group)
--   ไม่พบ = null
-- -------------------------------------------------------------------------
create or replace function public.get_product_group(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่';
  end if;
  if not public.is_member() then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลสินค้า';
  end if;
  if p_group_id is null then
    return null;
  end if;
  return public.product_group_json(p_group_id);
end;
$$;

-- -------------------------------------------------------------------------
-- add_product_image — เรียกหลังอัปโหลดไฟล์ขึ้น Storage สำเร็จแล้ว
--   path ต้องเป็น '<group_id>/<ชื่อไฟล์>' (ชื่อไฟล์: a-z A-Z 0-9 . _ - ห้ามมีโฟลเดอร์ย่อย)
--   ส่ง path เดิมซ้ำ (เน็ตหลุดแล้วกดใหม่) = คืนรูปเดิม ไม่เพิ่มซ้ำ
-- -------------------------------------------------------------------------
create or replace function public.add_product_image(
  p_group_id uuid,
  p_path text,
  p_width integer default null,
  p_height integer default null,
  p_bytes integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_prefix text;
  v_row public.product_images%rowtype;
  v_sort integer;
begin
  if v_uid is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่';
  end if;
  if not public.has_perm('products') then
    raise exception 'ไม่มีสิทธิ์จัดการสินค้า';
  end if;
  if p_group_id is null then
    raise exception 'กรุณาเลือกสินค้า';
  end if;

  perform 1
     from public.product_groups as g
    where g.id = p_group_id
      for update;
  if not found then
    raise exception 'ไม่พบสินค้านี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;

  v_prefix := p_group_id::text || '/';
  if p_path is null or left(p_path, char_length(v_prefix)) <> v_prefix then
    raise exception 'ที่อยู่ไฟล์รูปไม่ถูกต้อง: ต้องขึ้นต้นด้วย "%"', v_prefix;
  end if;
  if substr(p_path, char_length(v_prefix) + 1) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' then
    raise exception 'ชื่อไฟล์รูปไม่ถูกต้อง (ใช้ได้เฉพาะ a-z A-Z 0-9 . _ - และห้ามมีโฟลเดอร์ย่อย)';
  end if;
  if (p_width is not null and (p_width < 1 or p_width > 20000))
     or (p_height is not null and (p_height < 1 or p_height > 20000)) then
    raise exception 'ขนาดรูปไม่ถูกต้อง';
  end if;
  if p_bytes is not null and (p_bytes < 1 or p_bytes > 52428800) then
    raise exception 'ขนาดไฟล์รูปไม่ถูกต้อง';
  end if;

  select i.* into v_row
    from public.product_images as i
   where i.path = p_path;
  if not found then
    select coalesce(max(i.sort_order), 0) + 1 into v_sort
      from public.product_images as i
     where i.group_id = p_group_id;

    insert into public.product_images as i (group_id, path, sort_order, width, height, bytes, created_by)
    values (p_group_id, p_path, v_sort, p_width, p_height, p_bytes, v_uid)
    returning i.* into v_row;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'group_id', v_row.group_id,
    'path', v_row.path,
    'sort_order', v_row.sort_order,
    'width', v_row.width,
    'height', v_row.height,
    'bytes', v_row.bytes,
    'created_at', v_row.created_at
  );
end;
$$;

-- -------------------------------------------------------------------------
-- delete_product_image(p_image_id) — ลบรูปออกจากสินค้า คืน path ให้แอปลบไฟล์ใน Storage ต่อ
-- -------------------------------------------------------------------------
create or replace function public.delete_product_image(p_image_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gid uuid;
  v_path text;
begin
  if v_uid is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่';
  end if;
  if not public.has_perm('products') then
    raise exception 'ไม่มีสิทธิ์จัดการสินค้า';
  end if;
  if p_image_id is null then
    raise exception 'กรุณาเลือกรูป';
  end if;

  select i.group_id into v_gid
    from public.product_images as i
   where i.id = p_image_id;
  if not found then
    raise exception 'ไม่พบรูปนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;

  -- เข้าคิวเดียวกับการเพิ่ม/เรียงรูปของสินค้านี้
  perform 1
     from public.product_groups as g
    where g.id = v_gid
      for update;

  delete from public.product_images as i
   where i.id = p_image_id
  returning i.path into v_path;
  if not found then
    raise exception 'ไม่พบรูปนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;

  return v_path;
end;
$$;

-- -------------------------------------------------------------------------
-- reorder_product_images(p_group_id, p_ids) — p_ids = id รูปทั้งหมดของสินค้านี้ตามลำดับใหม่ (ตัวแรก = รูปปก)
-- -------------------------------------------------------------------------
create or replace function public.reorder_product_images(p_group_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[] := coalesce(p_ids, '{}'::uuid[]);
begin
  if v_uid is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่';
  end if;
  if not public.has_perm('products') then
    raise exception 'ไม่มีสิทธิ์จัดการสินค้า';
  end if;
  if p_group_id is null then
    raise exception 'กรุณาเลือกสินค้า';
  end if;

  perform 1
     from public.product_groups as g
    where g.id = p_group_id
      for update;
  if not found then
    raise exception 'ไม่พบสินค้านี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;

  if array_position(v_ids, null) is not null
     or (select count(*) from unnest(v_ids) as u(id)) <> (select count(distinct u.id) from unnest(v_ids) as u(id))
     or exists (
       select 1 from public.product_images as i
        where i.group_id = p_group_id and i.id <> all (v_ids)
     )
     or exists (
       select 1 from unnest(v_ids) as u(id)
        where not exists (
          select 1 from public.product_images as i where i.id = u.id and i.group_id = p_group_id
        )
     ) then
    raise exception 'รายการรูปไม่ตรงกับรูปที่มีอยู่ตอนนี้ (อาจมีการแก้ไขจากเครื่องอื่น) กรุณาโหลดหน้าใหม่';
  end if;

  update public.product_images as i
     set sort_order = o.ord::integer
    from unnest(v_ids) with ordinality as o(id, ord)
   where i.id = o.id
     and i.sort_order is distinct from o.ord::integer;
end;
$$;

-- ----- สิทธิ์เรียกฟังก์ชัน: เฉพาะผู้ที่ล็อกอินแล้ว (ในฟังก์ชันเช็คสิทธิ์ย่อยอีกชั้น) -----
revoke all on function public.save_product_group(jsonb, jsonb) from public, anon;
grant execute on function public.save_product_group(jsonb, jsonb) to authenticated;

revoke all on function public.set_product_group_active(uuid, boolean) from public, anon;
grant execute on function public.set_product_group_active(uuid, boolean) to authenticated;

revoke all on function public.delete_product_group(uuid) from public, anon;
grant execute on function public.delete_product_group(uuid) to authenticated;

revoke all on function public.get_product_group(uuid) from public, anon;
grant execute on function public.get_product_group(uuid) to authenticated;

revoke all on function public.add_product_image(uuid, text, integer, integer, integer) from public, anon;
grant execute on function public.add_product_image(uuid, text, integer, integer, integer) to authenticated;

revoke all on function public.delete_product_image(uuid) from public, anon;
grant execute on function public.delete_product_image(uuid) to authenticated;

revoke all on function public.reorder_product_images(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_product_images(uuid, uuid[]) to authenticated;

-- =========================================================================
-- 9) Supabase Storage: ถัง product-images
--    ดูรูป: ลิงก์สาธารณะ (ถังเป็น public) / อัปโหลด-แทนที่-ลบ: ผู้มีสิทธิ์ "จัดการสินค้า"
--    ไฟล์ต้องอยู่ที่ '<group_id ที่มีอยู่จริง>/<ชื่อไฟล์>'
-- =========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "product_images_objects_select" on storage.objects;
create policy "product_images_objects_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images' and (select public.is_member()));

drop policy if exists "product_images_objects_insert" on storage.objects;
create policy "product_images_objects_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (select public.has_perm('products'))
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
    and split_part(name, '/', 1) in (select g.id::text from public.product_groups as g)
  );

drop policy if exists "product_images_objects_update" on storage.objects;
create policy "product_images_objects_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and (select public.has_perm('products')))
  with check (
    bucket_id = 'product-images'
    and (select public.has_perm('products'))
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
    and split_part(name, '/', 1) in (select g.id::text from public.product_groups as g)
  );

drop policy if exists "product_images_objects_delete" on storage.objects;
create policy "product_images_objects_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and (select public.has_perm('products')));

-- =========================================================================
-- 10) ให้ API (PostgREST) โหลดโครงสร้างใหม่ทันที
-- =========================================================================
notify pgrst, 'reload schema';

commit;

-- =========================================================================
-- ตรวจสอบหลังรัน
-- =========================================================================
--
-- (ก) SQL Editor จะแสดงตารางนี้ให้เองหลังกด Run (คำสั่งสุดท้ายของไฟล์ อ่านอย่างเดียว)
--     แบบสินค้าทุกแบบ + จำนวน SKU: สินค้าเดิมแต่ละตัวต้องขึ้นเป็น 1 แบบ มี 1 SKU (สินค้าที่มีไซส์ = "มีไซส์")
--
-- ข้อที่เหลือไม่บังคับ — เอา "-- " หน้าบรรทัดออก แล้วรันทีละข้อใน SQL Editor
--
-- (ข) หมวดหมู่ที่ชื่อซ้ำกัน (ต่างกันแค่ตัวพิมพ์/ช่องว่าง) — ถ้ามี ระบบยังไม่กันชื่อซ้ำให้
--     แก้ชื่อหรือลบให้เหลือชื่อละ 1 หมวด แล้วรันไฟล์นี้ซ้ำอีกครั้ง
-- select lower(btrim(c.name)) as ชื่อ, count(*) as จำนวน, string_agg(c.id::text, ', ') as รหัส
--   from public.categories as c
--  group by lower(btrim(c.name))
-- having count(*) > 1;
--
-- (ค) ถังเก็บรูปสินค้า (ต้องได้ 1 แถว public = true)
-- select b.id, b.public, b.file_size_limit, b.allowed_mime_types
--   from storage.buckets as b
--  where b.id = 'product-images';
--
-- (ง) สินค้าเก่าที่ราคาทุน/ราคาขาย/จำนวนขั้นต่ำติดลบค้างจากระบบเก่า (ไม่มีแถว = ไม่มีปัญหา)
--     ตัวที่ขึ้นในนี้: ลบหมวดหมู่ของมัน / เอาไซส์นั้นออก / เปิด-ปิดใช้งาน จะถูกปฏิเสธพร้อมบอกชื่อสินค้า
--     แก้: เปิดหน้าแก้ไขสินค้านั้น ใส่ราคาให้ถูกแล้วบันทึก
-- select g.name as แบบสินค้า, p.size, p.sku, p.cost_price, p.sell_price, p.min_stock, p.stock_qty
--   from public.products as p
--   join public.product_groups as g on g.id = p.group_id
--  where p.cost_price < 0 or p.sell_price < 0 or p.min_stock < 0
--  order by g.name, p.sku;

-- (ก) แบบสินค้าทั้งหมด (อ่านอย่างเดียว รันซ้ำได้)
select g.name as "แบบสินค้า",
       coalesce(c.name, '-') as "หมวดหมู่",
       case when g.has_sizes then 'มีไซส์' else 'ไม่มีไซส์' end as "ชนิด",
       count(p.id) as "จำนวน SKU",
       coalesce(
         string_agg(coalesce(p.size, '-') || ' = ' || p.sku, ', '
                    order by public.product_size_rank(p.size), p.size, p.sku),
         ''
       ) as "ไซส์ = SKU",
       coalesce(sum(p.stock_qty), 0) as "สต๊อกรวม",
       case when g.is_active then 'เปิดขาย' else 'ปิดใช้งาน' end as "สถานะ"
  from public.product_groups as g
  left join public.categories as c on c.id = g.category_id
  left join public.products as p on p.group_id = g.id
 group by g.id, g.name, c.name, g.has_sizes, g.is_active, g.created_at
 order by g.created_at, g.name, g.id;
