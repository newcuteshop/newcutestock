-- =========================================================================
-- supabase-fix-03-integrations.sql — ระบบ "ตั้งค่าการเชื่อมต่อ" (เชื่อมสต๊อกกับ LINE SHOPPING / Facebook-IG /
--                                     Shopee / Lazada / TikTok Shop / ช่องทางอื่น) — ฐานข้อมูล (รอบที่ 3)
--
-- ไฟล์นี้ทำอะไร
--   1) ตารางใหม่ (ทั้งหมดเปิด RLS และให้สิทธิ์แบบระบุชัด):
--        integration_channels       1 แถว = 1 ร้านบน 1 แพลตฟอร์ม (สถานะ, ตัวเลือก, รหัสร้าน, เวลาซิงก์ล่าสุด)
--        integration_credentials    คีย์/โทเคนของร้าน "ที่เข้ารหัสแล้ว" (AES-256-GCM จากฝั่งเซิร์ฟเวอร์)
--                                   — ไม่มีใครอ่านได้เลยนอกจากเซิร์ฟเวอร์ (service_role) แม้แต่แอดมิน
--        integration_oauth_states   รหัสใช้ครั้งเดียวตอนกด "เชื่อมต่อร้าน" (Shopee / Lazada / TikTok)
--        channel_listings           สินค้าบนแพลตฟอร์ม 1 แถว = 1 ไซส์ + จับคู่กับสินค้าในแอป (อัตโนมัติด้วย SKU / เลือกเอง)
--        stock_sync_outbox          คิวส่งสต๊อก — เติมเองอัตโนมัติทุกครั้งที่สต๊อกเปลี่ยน (trigger) 1 งานต่อ 1 สินค้าต่อ 1 ช่องทาง
--        channel_orders / channel_order_lines   ออเดอร์จากแพลตฟอร์ม (บันทึกได้ครั้งเดียวต่อเลขออเดอร์)
--        integration_inbound_events เหตุการณ์ที่แพลตฟอร์มส่งมา (webhook) — กันซ้ำด้วยเลข event
--        integration_sync_log       บันทึกการซิงก์ (เก็บ 60 วัน / ช่องทางละไม่เกิน 5,000 แถว) — ไม่มีคีย์ ไม่มีข้อมูลผู้ซื้อ
--   2) ตาราง sales: เพิ่ม "ช่องทางขาย" (channel ค่าเริ่มต้น 'store' = หน้าร้าน), channel_id + external_order_id
--      (1 ออเดอร์แพลตฟอร์ม = 1 บิล), voided_at (ออเดอร์ถูกยกเลิกทั้งใบ — รายงานไม่ควรนับ),
--      วิธีชำระเพิ่ม 'marketplace' (ลูกค้าจ่ายผ่านแพลตฟอร์ม)
--   3) record_sale() รับ p_channel เพิ่ม (ไม่ใส่ = 'store') ให้หน้าขายเลือก Facebook / Instagram / แชต LINE / แชตอื่นๆ ได้
--      แอปเวอร์ชันเก่าที่ไม่ส่ง p_channel ยังขายได้ตามปกติ
--   4) นโยบายสต๊อก (ตามที่บอสตัดสินใจ): แอปนี้เป็น "สต๊อกหลัก"
--        - ตัดสต๊อกทันทีที่ออเดอร์ถูกสร้าง (ยังไม่จ่ายก็ตัด) — ตั้งเป็น "ตัดเมื่อจ่ายแล้ว" ได้ต่อช่องทาง
--        - ออเดอร์ที่ยกเลิก "ก่อนส่งของ" คืนสต๊อกอัตโนมัติ / ยกเลิกหลังส่งของแล้ว และสินค้าตีกลับ ต้องให้แอดมินกด "รับของคืนแล้ว"
--        - ขายเกิน: ไม่ปฏิเสธออเดอร์ ตัดเท่าที่มี ส่วนที่ขาดติดธง "ขายเกิน" + ส่งสต๊อก 0 ไปทุกช่องทางทันที + แจ้งเตือนสีแดง
--        - ส่งสต๊อก = max(0, สต๊อก − ของที่ค้างส่งจากการขายเกิน − buffer ของช่องทาง) และ "เหลือ ≤ N ส่ง 0" ได้
--        - ส่งสต๊อกครั้งแรกต้องกดยืนยัน "ส่งสต๊อกครั้งแรก" ต่อช่องทางก่อนเสมอ (เพราะจะทับสต๊อกบนแพลตฟอร์ม)
--   5) ฟังก์ชันสำหรับเซิร์ฟเวอร์ (เรียกได้เฉพาะ service_role) และฟังก์ชันสำหรับหน้าตั้งค่า (เฉพาะ Admin)
--      รายละเอียดอยู่ในคอมเมนต์เหนือแต่ละฟังก์ชัน (ชนิดข้อมูลฝั่งแอปอยู่ที่ lib/integrations/types.ts)
--   6) ออเดอร์เดียวกันที่มาทั้งจากไฟล์ CSV (มีแต่ SKU) และจากแพลตฟอร์ม (มีรหัสตัวเลือก) ถือเป็นบรรทัดเดียวกัน
--      เมื่อ SKU ตรงกัน — ตัดสต๊อกครั้งเดียวไม่ว่ามาทางไหนก่อน; รายการแทน 'sku:<sku>' จาก CSV หลีกทางให้รายการจริงเสมอ
--      และไม่ถูกส่งสต๊อกไปแพลตฟอร์ม (ไม่มีรหัสสินค้าบนแพลตฟอร์ม)
--
-- วิธีใช้: Supabase > SQL Editor > วางทั้งไฟล์ > กด Run
--   - ต้องรัน supabase-fix-01.sql และ supabase-fix-02.sql มาก่อนแล้ว (ไฟล์นี้ตรวจให้ ถ้ายังไม่ได้รันจะหยุดทันทีโดยไม่แก้อะไร)
--   - รันซ้ำได้ปลอดภัย ไม่ทำให้ข้อมูลเสีย (ทั้งไฟล์สำเร็จทั้งหมดหรือไม่เปลี่ยนอะไรเลย)
--   - รันก่อน deploy แอปเวอร์ชันใหม่ได้: หน้าขาย/สต๊อก/สินค้า/รายงานของแอปเดิมใช้ได้ตามปกติ
--     (ตราบใดที่ยังไม่ได้ตั้งค่าช่องทางใดๆ ระบบนี้ไม่ทำอะไรเลย)
--   - [สำคัญ] ถ้าวันหลังรัน supabase-fix-01.sql ซ้ำ ต้องรัน supabase-fix-02.sql แล้วตามด้วยไฟล์นี้ซ้ำทันที ตามลำดับ
--        (fix-01 จะสร้าง record_sale แบบเก่าซ้อนขึ้นมา → หน้าขายจะบันทึกบิลไม่ได้ ("function is not unique")
--         จนกว่าจะรันไฟล์นี้ซ้ำ ซึ่งจะลบแบบเก่าออกให้)
--   - ตัวปลุกงานอัตโนมัติ (pg_cron ทุก 30 วินาที/1 นาที) อยู่ในไฟล์แยก supabase-cron-integrations.sql — รันทีหลังเมื่อพร้อมใช้งานจริง
--   - รันเสร็จแล้ว SQL Editor จะแสดงตารางสรุปของระบบเชื่อมต่อ — ดูหัวข้อ "ตรวจสอบหลังรัน" ท้ายไฟล์
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
     or to_regprocedure('public.sale_json(uuid, boolean)') is null
     or to_regclass('public.sale_counters') is null
     or (to_regprocedure('public.record_sale(uuid, jsonb, numeric, text, text)') is null
         and to_regprocedure('public.record_sale(uuid, jsonb, numeric, text, text, text)') is null) then
    raise exception 'ต้องรัน supabase-fix-01.sql และ supabase-fix-02.sql ให้เสร็จก่อน แล้วค่อยรันไฟล์นี้ (ยังไม่ได้แก้อะไรในฐานข้อมูล)';
  end if;
  if to_regclass('public.product_groups') is null
     or to_regclass('public.product_images') is null
     or to_regprocedure('public.save_product_group(jsonb, jsonb)') is null
     or to_regprocedure('public.product_clean_text(text)') is null
     or to_regprocedure('public.product_json_num(jsonb, text)') is null
     or not exists (select 1 from information_schema.columns as c
                     where c.table_schema = 'public' and c.table_name = 'products' and c.column_name = 'is_archived')
     or not exists (select 1 from information_schema.columns as c
                     where c.table_schema = 'public' and c.table_name = 'products' and c.column_name = 'group_id') then
    raise exception 'ต้องรัน supabase-fix-02.sql ให้เสร็จก่อน แล้วค่อยรันไฟล์นี้ (ยังไม่ได้แก้อะไรในฐานข้อมูล)';
  end if;
end
$$;

-- =========================================================================
-- 1) ตัวช่วยสิทธิ์
-- =========================================================================
-- is_admin() = ผู้ใช้ที่ล็อกอินอยู่มีบทบาท admin (เมนูเชื่อมต่อจัดการคีย์ร้าน — ไม่เปิดเป็นสิทธิ์ย่อยให้พนักงาน)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select up.role = 'admin' from public.user_profiles as up where up.id = auth.uid()), false)
$$;

-- เซิร์ฟเวอร์ = คำขอด้วย service role key / SQL Editor / pg_cron (ไม่มี JWT ของผู้ใช้)
--   คำขอของผู้ใช้ผ่าน API มี role ใน JWT เสมอ (anon / authenticated) → ไม่ใช่เซิร์ฟเวอร์ ไม่ว่า session_user จะเป็นอะไร
create or replace function public.integration_is_server()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
           when coalesce(auth.role(), '') = 'service_role' then true
           when coalesce(auth.role(), '') <> '' then false
           else session_user::text in ('postgres', 'supabase_admin')
         end
$$;

-- ตรวจสิทธิ์ในฟังก์ชันของระบบเชื่อมต่อ: เซิร์ฟเวอร์ผ่านเสมอ / p_allow_admin = true → Admin ที่ล็อกอินอยู่ผ่านด้วย
-- คืน auth.uid() (ผู้ทำรายการ ไว้บันทึก audit; เซิร์ฟเวอร์ = null)
create or replace function public.integration_require(p_allow_admin boolean)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.integration_is_server() then
    return auth.uid();
  end if;
  if coalesce(p_allow_admin, false) then
    if auth.uid() is null then
      raise exception 'กรุณาเข้าสู่ระบบใหม่' using errcode = '42501';
    end if;
    if public.is_admin() then
      return auth.uid();
    end if;
    raise exception 'เมนูตั้งค่าการเชื่อมต่อใช้ได้เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น' using errcode = '42501';
  end if;
  raise exception 'ฟังก์ชันนี้เรียกได้จากเซิร์ฟเวอร์ของร้านเท่านั้น' using errcode = '42501';
end;
$$;

-- ชื่อแพลตฟอร์มที่แสดงผล / ใช้ในหมายเหตุสต๊อก ('ขาย LINE SHOPPING #...')
create or replace function public.integration_platform_label(p_platform text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_platform
           when 'line' then 'LINE SHOPPING'
           when 'meta' then 'Facebook/Instagram'
           when 'shopee' then 'Shopee'
           when 'lazada' then 'Lazada'
           when 'tiktok' then 'TikTok Shop'
           when 'generic' then 'ช่องทางอื่น'
           else coalesce(p_platform, '-')
         end
$$;

-- =========================================================================
-- 2) ตาราง
-- =========================================================================

-- ----- ช่องทาง (1 แถว = 1 ร้านบน 1 แพลตฟอร์ม) -----
create table if not exists public.integration_channels (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  display_name text not null,
  environment text not null default 'production',
  status text not null default 'disconnected',
  status_reason text,
  options jsonb not null default '{}'::jsonb,       -- ตัวเลือกการซิงก์ (ดู integration_channel_options) — ไม่มีความลับ
  settings jsonb not null default '{}'::jsonb,      -- ค่าตั้งของแพลตฟอร์มที่ไม่ใช่ความลับ (catalog_id, shop_cipher, seller_id ฯลฯ)
  external_shop_id text,                            -- shop_id / seller_id / TikTok shop id / catalog_id / LINE channelId
  external_shop_name text,
  token_expires_at timestamptz,
  refresh_expires_at timestamptz,
  auth_expires_at timestamptz,                      -- การอนุญาตของร้านหมดอายุ (ต้องกดเชื่อมต่อใหม่)
  next_token_check_at timestamptz,                  -- worker ตั้งเอง: รอบตรวจ/ต่ออายุ token ถัดไป
  orders_cursor timestamptz,                        -- ดึงออเดอร์ที่อัปเดตหลังเวลานี้ (worker ขยับเอง)
  last_sync_at timestamptz,
  last_orders_sync_at timestamptz,
  last_stock_push_at timestamptz,
  last_catalog_sync_at timestamptz,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_error text,
  last_error_at timestamptz,
  consecutive_failures integer not null default 0,
  paused_until timestamptz,                         -- หยุดเรียก API ชั่วคราว (worker ตั้งเมื่อพังติดกัน)
  lease_until timestamptz,                          -- กันสอง worker ทำงานของช่องทางเดียวกันพร้อมกัน
  lease_owner text,
  feed_token_hash text,                             -- sha256 (hex) ของโทเคนลิงก์ฟีด (ตัวโทเคนเข้ารหัสอยู่ใน integration_credentials)
  feed_token_rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint integration_channels_platform_chk
    check (platform in ('line', 'meta', 'shopee', 'lazada', 'tiktok', 'generic')),
  constraint integration_channels_environment_chk
    check (environment in ('sandbox', 'production')),
  constraint integration_channels_status_chk
    check (status in ('disconnected', 'pending_approval', 'connected', 'error', 'paused')),
  constraint integration_channels_name_chk
    check (display_name = btrim(display_name) and char_length(display_name) between 1 and 100),
  constraint integration_channels_reason_chk
    check (status_reason is null or char_length(status_reason) <= 100),
  constraint integration_channels_options_chk check (jsonb_typeof(options) = 'object'),
  constraint integration_channels_settings_chk check (jsonb_typeof(settings) = 'object'),
  constraint integration_channels_shop_chk
    check ((external_shop_id is null or char_length(external_shop_id) <= 200)
           and (external_shop_name is null or char_length(external_shop_name) <= 200)),
  constraint integration_channels_error_chk check (last_error is null or char_length(last_error) <= 1000),
  constraint integration_channels_failures_chk check (consecutive_failures >= 0),
  constraint integration_channels_lease_chk check (lease_owner is null or char_length(lease_owner) <= 100),
  constraint integration_channels_feed_hash_chk check (feed_token_hash is null or feed_token_hash ~ '^[0-9a-f]{64}$')
);

create unique index if not exists integration_channels_shop_key
  on public.integration_channels (platform, environment, external_shop_id) where external_shop_id is not null;
create unique index if not exists integration_channels_feed_key
  on public.integration_channels (feed_token_hash) where feed_token_hash is not null;
create index if not exists idx_integration_channels_updated_by on public.integration_channels (updated_by);

-- ----- ความลับของร้าน (เข้ารหัสแล้ว) — เซิร์ฟเวอร์เท่านั้น -----
--   ciphertext / iv / tag = base64 ของ AES-256-GCM (iv 12 ไบต์, tag 16 ไบต์), AAD = '<channel_id>:<name>'
--   key_version = รุ่นของกุญแจ INTEGRATIONS_ENC_KEY ที่ใช้เข้ารหัส (หมุนกุญแจได้)
--   hint = ข้อความที่หน้าจอแสดงได้ เช่น '•••• 1a2b' (ห้ามใส่ค่าลับทั้งตัว)
--   version = เพิ่มทีละ 1 ทุกครั้งที่เขียน (compare-and-swap ตอนต่ออายุ token)
create table if not exists public.integration_credentials (
  channel_id uuid not null references public.integration_channels (id) on delete cascade,
  name text not null,
  ciphertext text not null,
  iv text not null,
  tag text not null,
  key_version smallint not null default 1,
  hint text,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint integration_credentials_pkey primary key (channel_id, name),
  constraint integration_credentials_name_chk check (name ~ '^[a-z][a-z0-9_]{0,47}$'),
  constraint integration_credentials_cipher_chk
    check (ciphertext ~ '^[A-Za-z0-9+/]+={0,2}$' and char_length(ciphertext) <= 20000),
  constraint integration_credentials_iv_chk check (iv ~ '^[A-Za-z0-9+/]{16}$'),
  constraint integration_credentials_tag_chk check (tag ~ '^[A-Za-z0-9+/]{22}==$'),
  constraint integration_credentials_kv_chk check (key_version >= 1),
  constraint integration_credentials_hint_chk check (hint is null or char_length(hint) <= 80),
  constraint integration_credentials_version_chk check (version >= 1)
);

create index if not exists idx_integration_credentials_updated_by on public.integration_credentials (updated_by);

-- ----- OAuth state (ใช้ครั้งเดียว หมดอายุ 10 นาที) — เก็บเฉพาะ sha256 ของ state -----
create table if not exists public.integration_oauth_states (
  state_hash text primary key,
  channel_id uuid not null references public.integration_channels (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint integration_oauth_states_hash_chk check (state_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists idx_integration_oauth_states_channel on public.integration_oauth_states (channel_id);
create index if not exists idx_integration_oauth_states_created_by on public.integration_oauth_states (created_by);

-- ----- สินค้าบนแพลตฟอร์ม (1 แถว = 1 ไซส์/ตัวเลือก) + การจับคู่กับสินค้าในแอป -----
--   external_sku_id = รหัสตัวเลือกที่ไม่ซ้ำภายในช่องทาง (Shopee '<item_id>:<model_id>', Lazada SkuId, TikTok sku_id,
--                     LINE variantId, Meta retailer_id, CSV 'sku:<sku ตัวเล็ก>')
--   สินค้าในแอป 1 ตัว จับคู่ได้ 1 รายการต่อช่องทาง / mapped ⇔ มี product_id
create table if not exists public.channel_listings (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.integration_channels (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  external_item_id text not null,
  external_sku_id text not null,
  external_sku text,
  external_sku_norm text,                          -- lower(product_clean_text(external_sku)) — trigger ตั้งให้
  external_inventory_id text,                      -- LINE inventoryId (คนละค่ากับ variantId)
  external_name text,
  external_variant_name text,
  external_status text,
  platform_qty integer,                            -- สต๊อกบนแพลตฟอร์มที่อ่านได้ล่าสุด (ใช้ในตาราง "ก่อน/หลัง")
  platform_reserved integer,
  platform_qty_at timestamptz,
  extra jsonb not null default '{}'::jsonb,        -- ข้อมูลเสริมของแพลตฟอร์ม (warehouse ids ฯลฯ) — ไม่มีความลับ
  mapping_status text not null default 'unmapped',
  match_source text,                               -- auto = จับคู่ด้วย SKU / manual = แอดมินเลือกเอง (ไม่ถูกจับคู่อัตโนมัติทับ)
  push_enabled boolean not null default true,
  buffer_override integer,                         -- buffer เฉพาะรายการนี้ (แทนค่าของช่องทาง)
  last_seen_at timestamptz,                        -- เห็นในรายการสินค้าจากแพลตฟอร์มครั้งล่าสุด
  last_pushed_qty integer,
  last_pushed_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_listings_sku_id_key unique (channel_id, external_sku_id),
  constraint channel_listings_product_key unique (channel_id, product_id),
  constraint channel_listings_mapping_chk
    check (mapping_status in ('mapped', 'unmapped', 'conflict', 'ignored', 'gone')),
  constraint channel_listings_mapped_chk check ((mapping_status = 'mapped') = (product_id is not null)),
  constraint channel_listings_match_chk check (match_source is null or match_source in ('auto', 'manual')),
  constraint channel_listings_ids_chk
    check (char_length(external_item_id) between 1 and 200 and char_length(external_sku_id) between 1 and 200
           and (external_inventory_id is null or char_length(external_inventory_id) <= 200)),
  constraint channel_listings_text_chk
    check ((external_sku is null or char_length(external_sku) <= 200)
           and (external_name is null or char_length(external_name) <= 500)
           and (external_variant_name is null or char_length(external_variant_name) <= 200)
           and (external_status is null or char_length(external_status) <= 50)),
  constraint channel_listings_buffer_chk check (buffer_override is null or buffer_override between 0 and 1000),
  constraint channel_listings_extra_chk check (jsonb_typeof(extra) = 'object'),
  constraint channel_listings_error_chk check (last_error is null or char_length(last_error) <= 1000)
);

create index if not exists idx_channel_listings_product on public.channel_listings (product_id);
create index if not exists idx_channel_listings_status on public.channel_listings (channel_id, mapping_status);

-- จับคู่ SKU แบบไม่สนตัวพิมพ์ + ตัดช่องว่าง/อักขระที่มองไม่เห็นหัวท้าย (แบบเดียวกับ fix-02)
--   external_sku_norm คำนวณให้เองใน trigger (ไม่ใช้ index แบบนิพจน์ที่เรียก product_clean_text — ฟังก์ชันนั้นปิดสิทธิ์ไว้)
create index if not exists idx_channel_listings_sku_norm on public.channel_listings (channel_id, external_sku_norm);

-- ----- คิวส่งสต๊อก: 1 งานค้าง (pending/failed) ต่อ ช่องทาง+สินค้า — ขาย 10 ตัวติดกันยังเป็นงานเดียว -----
--   worker อ่านสต๊อกปัจจุบัน ณ ตอนรับงานเสมอ (ส่งค่าสัมบูรณ์ ไม่ส่งผลต่าง)
create table if not exists public.stock_sync_outbox (
  id bigint generated always as identity primary key,
  channel_id uuid not null references public.integration_channels (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  reason text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  locked_by text,
  pushed_qty integer,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz,
  constraint stock_sync_outbox_status_chk
    check (status in ('pending', 'processing', 'done', 'failed', 'dead', 'skipped')),
  constraint stock_sync_outbox_reason_chk
    check (reason in ('stock_change', 'listing_change', 'options_change', 'resync', 'initial_push', 'oversold', 'retry')),
  constraint stock_sync_outbox_attempts_chk check (attempts >= 0),
  constraint stock_sync_outbox_worker_chk check (locked_by is null or char_length(locked_by) <= 100),
  constraint stock_sync_outbox_error_chk check (last_error is null or char_length(last_error) <= 1000)
);

create unique index if not exists stock_sync_outbox_one_open
  on public.stock_sync_outbox (channel_id, product_id) where status in ('pending', 'failed');
create index if not exists idx_stock_sync_outbox_due
  on public.stock_sync_outbox (next_attempt_at) where status in ('pending', 'failed');
create index if not exists idx_stock_sync_outbox_processing
  on public.stock_sync_outbox (channel_id, product_id) where status = 'processing';
create index if not exists idx_stock_sync_outbox_product on public.stock_sync_outbox (product_id);
create index if not exists idx_stock_sync_outbox_done on public.stock_sync_outbox (done_at) where done_at is not null;

-- ----- ออเดอร์จากแพลตฟอร์ม -----
--   status = สถานะกลาง (adapter แปลงจากสถานะของแต่ละแพลตฟอร์ม)
--   stock_tracking: live = ตัด/คืนสต๊อกจริง, shadow = โหมดทดลอง (ดูอย่างเดียว ไม่แตะสต๊อก ไม่สร้างบิล)
--   shipped_at = ของออกจากร้านแล้ว (ใช้ตัดสินว่ายกเลิกแล้วคืนสต๊อกอัตโนมัติได้ไหม)
create table if not exists public.channel_orders (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.integration_channels (id) on delete restrict,
  external_order_id text not null,
  status text not null,
  raw_status text,
  stock_tracking text not null default 'live',
  platform_created_at timestamptz,
  platform_updated_at timestamptz,
  shipped_at timestamptz,
  sale_id uuid references public.sales (id) on delete set null,
  currency text not null default 'THB',
  items_total numeric(12, 2),
  stock_applied boolean not null default false,    -- ตอนนี้ออเดอร์นี้ถือสต๊อกไว้อยู่ (ตัดแล้วยังไม่คืน) อย่างน้อย 1 ชิ้น
  has_oversold boolean not null default false,     -- มีบรรทัดขายเกิน (ตัดได้ไม่ครบ)
  has_unmapped boolean not null default false,     -- มีบรรทัดที่ยังจับคู่สินค้าไม่ได้ (ยังไม่ตัดสต๊อก)
  attention_reasons text[] not null default '{}',
  dismissed_reasons text[] not null default '{}',
  needs_attention boolean generated always as (cardinality(attention_reasons) > 0) stored,
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  last_source text,
  raw jsonb,                                       -- snapshot จากแพลตฟอร์ม (ตัดข้อมูลผู้ซื้อ/ความลับออกแล้ว)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_orders_external_key unique (channel_id, external_order_id),
  constraint channel_orders_status_chk
    check (status in ('unpaid', 'paid', 'ready_to_ship', 'shipped', 'completed', 'cancel_pending',
                      'cancelled', 'return_requested', 'returned', 'expired', 'unknown')),
  constraint channel_orders_tracking_chk check (stock_tracking in ('live', 'shadow')),
  constraint channel_orders_attention_chk
    check (attention_reasons <@ array['unmapped_sku', 'oversold', 'unknown_status', 'return_to_confirm']::text[]
           and dismissed_reasons <@ array['unmapped_sku', 'oversold', 'unknown_status', 'return_to_confirm']::text[]),
  constraint channel_orders_source_chk
    check (last_source is null or last_source in ('webhook', 'poll', 'csv', 'manual', 'admin')),
  constraint channel_orders_text_chk
    check (char_length(external_order_id) between 1 and 100
           and (raw_status is null or char_length(raw_status) <= 100)
           and currency ~ '^[A-Z]{3}$')
);

create index if not exists idx_channel_orders_attention on public.channel_orders (channel_id) where needs_attention;
create index if not exists idx_channel_orders_created on public.channel_orders (channel_id, created_at desc);
create index if not exists idx_channel_orders_sale on public.channel_orders (sale_id);
create index if not exists idx_channel_orders_resolved_by on public.channel_orders (resolved_by);

--   1 บรรทัด = 1 ตัวเลือกสินค้าในออเดอร์ (adapter รวมชิ้นของ SKU เดียวกันเป็นบรรทัดเดียว)
--   ถือสต๊อกอยู่ (held) = qty_deducted − qty_restocked
--   qty_oversold = จำนวนที่ "ควรตัด" แต่สต๊อกไม่พอ (ค้างอยู่ — ถูกหักออกจากสต๊อกที่ส่งไปแพลตฟอร์มจนกว่าจะตัดได้/ยกเว้น)
create table if not exists public.channel_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.channel_orders (id) on delete cascade,
  line_key text not null,
  external_item_id text,
  external_sku_id text,
  external_sku text,
  external_name text,
  listing_id uuid references public.channel_listings (id) on delete set null,
  product_id uuid references public.products (id) on delete set null,
  qty integer not null,
  qty_cancelled integer not null default 0,
  platform_qty_returned integer not null default 0,    -- แพลตฟอร์มแจ้งว่าของตีกลับ/คืนถึงร้านแล้ว (ข้อมูล)
  qty_returned_received integer not null default 0,    -- รับของคืนจริง (แอดมินยืนยัน หรืออัตโนมัติตามตัวเลือก) → คืนสต๊อก
  qty_waived integer not null default 0,               -- ชิ้นที่ขายเกินแล้วแอดมินสั่ง "ไม่ต้องตัดสต๊อก"
  qty_deducted integer not null default 0,
  qty_restocked integer not null default 0,
  qty_oversold integer not null default 0,
  unit_price numeric(12, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_order_lines_key unique (order_id, line_key),
  constraint channel_order_lines_qty_chk check (qty between 0 and 100000),
  constraint channel_order_lines_cancel_chk check (qty_cancelled between 0 and qty),
  constraint channel_order_lines_platform_return_chk check (platform_qty_returned between 0 and qty),
  constraint channel_order_lines_return_chk check (qty_returned_received between 0 and qty),
  constraint channel_order_lines_waive_chk check (qty_waived between 0 and qty),
  constraint channel_order_lines_deduct_chk check (qty_deducted >= 0 and qty_restocked between 0 and qty_deducted),
  constraint channel_order_lines_oversold_chk check (qty_oversold >= 0),
  constraint channel_order_lines_price_chk check (unit_price is null or unit_price between 0 and 99999999.99),
  constraint channel_order_lines_text_chk
    check (char_length(line_key) between 1 and 200
           and (external_item_id is null or char_length(external_item_id) <= 200)
           and (external_sku_id is null or char_length(external_sku_id) <= 200)
           and (external_sku is null or char_length(external_sku) <= 200)
           and (external_name is null or char_length(external_name) <= 500))
);

create index if not exists idx_channel_order_lines_product on public.channel_order_lines (product_id);
create index if not exists idx_channel_order_lines_listing on public.channel_order_lines (listing_id);
create index if not exists idx_channel_order_lines_owed on public.channel_order_lines (product_id) where qty_oversold > 0;

-- ----- เหตุการณ์จากแพลตฟอร์ม (webhook) — กันซ้ำด้วย ช่องทาง + เลข event -----
create table if not exists public.integration_inbound_events (
  id bigint generated always as identity primary key,
  channel_id uuid not null references public.integration_channels (id) on delete cascade,
  event_id text not null,
  event_type text,
  external_order_id text,
  payload jsonb,                                   -- ตัดข้อมูลผู้ซื้อ/ความลับออกแล้ว; ลบทิ้งหลังประมวลผลเสร็จ 7 วัน
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  locked_by text,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint integration_inbound_events_dedupe unique (channel_id, event_id),
  constraint integration_inbound_events_status_chk
    check (status in ('pending', 'processing', 'done', 'ignored', 'failed', 'dead')),
  constraint integration_inbound_events_text_chk
    check (char_length(event_id) between 1 and 200
           and (event_type is null or char_length(event_type) <= 100)
           and (external_order_id is null or char_length(external_order_id) <= 100)
           and (locked_by is null or char_length(locked_by) <= 100)
           and (last_error is null or char_length(last_error) <= 1000)),
  constraint integration_inbound_events_attempts_chk check (attempts >= 0)
);

create index if not exists idx_integration_inbound_due
  on public.integration_inbound_events (next_attempt_at) where status in ('pending', 'failed');
create index if not exists idx_integration_inbound_processing
  on public.integration_inbound_events (locked_until) where status = 'processing';
create index if not exists idx_integration_inbound_received on public.integration_inbound_events (received_at);

-- ----- บันทึกการซิงก์ (แอดมินอ่านได้) -----
create table if not exists public.integration_sync_log (
  id bigint generated always as identity primary key,
  channel_id uuid references public.integration_channels (id) on delete cascade,
  kind text not null,
  ok boolean not null,
  summary text not null,
  detail jsonb,
  actor uuid references auth.users (id) on delete set null,
  duration_ms integer,
  created_at timestamptz not null default now(),
  constraint integration_sync_log_kind_chk
    check (kind in ('push_stock', 'pull_orders', 'webhook', 'order', 'catalog', 'refresh_token', 'test',
                    'oauth', 'reconcile', 'feed', 'csv', 'admin', 'worker')),
  constraint integration_sync_log_summary_chk check (char_length(summary) between 1 and 500),
  constraint integration_sync_log_duration_chk check (duration_ms is null or duration_ms >= 0)
);

create index if not exists idx_integration_sync_log_channel on public.integration_sync_log (channel_id, id desc);
create index if not exists idx_integration_sync_log_created on public.integration_sync_log (created_at);
create index if not exists idx_integration_sync_log_actor on public.integration_sync_log (actor);

-- =========================================================================
-- 3) sales: ช่องทางขาย + เลขออเดอร์ภายนอก + ยกเลิกทั้งใบ + วิธีชำระ 'marketplace'
-- =========================================================================
alter table public.sales add column if not exists channel text not null default 'store';
alter table public.sales add column if not exists channel_id uuid;
alter table public.sales add column if not exists external_order_id text;
alter table public.sales add column if not exists voided_at timestamptz;

do $$
declare
  v_con record;
begin
  if not exists (
    select 1 from pg_constraint as c
     where c.conrelid = 'public.sales'::regclass and c.conname = 'sales_channel_id_fkey'
  ) then
    alter table public.sales
      add constraint sales_channel_id_fkey
      foreign key (channel_id) references public.integration_channels (id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint as c
     where c.conrelid = 'public.sales'::regclass and c.conname = 'sales_channel_chk'
  ) then
    alter table public.sales
      add constraint sales_channel_chk
      check (channel in ('store', 'facebook', 'instagram', 'line_chat', 'other_chat',
                         'line', 'meta', 'shopee', 'lazada', 'tiktok', 'generic'));
  end if;

  -- บิลจากแพลตฟอร์ม = มีทั้ง channel_id และเลขออเดอร์ / บิลหน้าร้านและแชต = ไม่มีทั้งคู่
  if not exists (
    select 1 from pg_constraint as c
     where c.conrelid = 'public.sales'::regclass and c.conname = 'sales_channel_ref_chk'
  ) then
    alter table public.sales
      add constraint sales_channel_ref_chk
      check ((channel_id is null) = (external_order_id is null)
             and (channel_id is null or channel in ('line', 'meta', 'shopee', 'lazada', 'tiktok', 'generic'))
             and (external_order_id is null or char_length(external_order_id) between 1 and 100));
  end if;

  -- วิธีชำระ: เพิ่ม 'marketplace' (หาข้อบังคับเดิมจากนิยามจริง — ชื่ออาจต่างกันในแต่ละฐานข้อมูล)
  for v_con in
    select c.conname::text as conname
      from pg_constraint as c
     where c.conrelid = 'public.sales'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%payment_method%'
  loop
    execute format('alter table public.sales drop constraint %I', v_con.conname);
  end loop;
  alter table public.sales
    add constraint sales_payment_method_check
    check (payment_method in ('cash', 'transfer', 'credit', 'marketplace'));
end
$$;

create unique index if not exists sales_channel_external_key
  on public.sales (channel_id, external_order_id) where external_order_id is not null;
create index if not exists idx_sales_channel on public.sales (channel);

-- =========================================================================
-- 4) ตัวช่วยภายใน (เรียกจาก API ไม่ได้)
-- =========================================================================

-- ตัวเลือกของช่องทาง: ค่าเริ่มต้น + ค่าที่ตั้งไว้ (เฉพาะคีย์ที่รู้จัก)
--   push_stock        ส่งสต๊อกไปแพลตฟอร์ม
--   pull_orders       รับ/ดึงออเดอร์มาตัดสต๊อก
--   stock_buffer      กันสต๊อกไว้ (ชิ้น) — ส่ง max(0, สต๊อก − buffer)
--   zero_at_or_below  เหลือ ≤ N ชิ้น ส่ง 0 (เก็บไว้ขายหน้าร้าน)
--   deduct_on         created = ตัดตอนสร้างออเดอร์ (ค่าเริ่มต้น) / paid = ตัดเมื่อจ่ายแล้ว
--   restock_returns   manual = แอดมินกด "รับของคืนแล้ว" (ค่าเริ่มต้น) / auto = คืนเมื่อแพลตฟอร์มแจ้งว่าของถึงร้าน
--   shadow_mode       โหมดทดลอง: ออเดอร์ใหม่บันทึกไว้ดูอย่างเดียว ไม่แตะสต๊อก
--   poll_seconds      รอบดึงออเดอร์กันพลาด (วินาที)
--   initial_push_done / initial_push_at   ตั้งโดยระบบเมื่อแอดมินกด "ส่งสต๊อกครั้งแรก" (แก้ผ่าน save_channel_options ไม่ได้)
create or replace function public.integration_channel_options(p_platform text, p_options jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
           'push_stock', false,
           'pull_orders', false,
           'stock_buffer', 0,
           'zero_at_or_below', 0,
           'deduct_on', 'created',
           'restock_returns', 'manual',
           'shadow_mode', false,
           'poll_seconds', case when p_platform = 'lazada' then 300 else 900 end,
           'initial_push_done', false,
           'initial_push_at', null
         )
         || coalesce(
              (select jsonb_object_agg(e.key, e.value)
                 from jsonb_each(case when jsonb_typeof(p_options) = 'object' then p_options else '{}'::jsonb end) as e
                where e.key in ('push_stock', 'pull_orders', 'stock_buffer', 'zero_at_or_below', 'deduct_on',
                                'restock_returns', 'shadow_mode', 'poll_seconds', 'initial_push_done', 'initial_push_at')),
              '{}'::jsonb)
$$;

-- ตัดความลับ (แทนค่าด้วย [REDACTED]) และข้อมูลส่วนบุคคลของผู้ซื้อ (ลบทั้งคีย์) ออกจาก JSON ทุกชั้น
-- ใช้กับ payload ของ webhook, snapshot ออเดอร์ และรายละเอียดใน sync log (ชั้นที่สอง — แอปต้องตัดเองก่อนส่งมาด้วย)
create or replace function public.integration_strip(p_value jsonb, p_depth integer default 0)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_out jsonb;
  v_key text;
  v_val jsonb;
begin
  if p_value is null then
    return null;
  end if;
  if coalesce(p_depth, 0) > 20 then
    return '"[DEPTH]"'::jsonb;
  end if;
  if jsonb_typeof(p_value) = 'object' then
    v_out := '{}'::jsonb;
    for v_key, v_val in select e.key, e.value from jsonb_each(p_value) as e loop
      if v_key ~* '^(access_?token|refresh_?token|id_?token|token|.*[_-]token|.*token[_-].*|secret|.*[_-]secret|app_?secret|client_?secret|partner_?key|api_?key|x-api-key|sign|signature|x-myshop-signature|x-hub-signature(-256)?|authorization|proxy-authorization|password|passwd|cookie|set-cookie|appsecret_proof|auth_?code|x-tts-access-token)$' then
        v_out := v_out || jsonb_build_object(v_key, '[REDACTED]');
      elsif v_key ~* '^(buyer|customer|consignee|shipping|delivery_?info)$'
            or v_key ~* '(address|phone|mobile|e_?mail|recipient|receiver|buyer_?(name|user_?name|email|message|note)|customer_?(name|phone|email|first|last)|first_?name|last_?name|full_?name|tax_?id|id_?card|citizen|remark_?buyer|remark_?recipient|message_?to_?seller|note_?to_?seller|billing)' then
        continue;
      else
        v_out := v_out || jsonb_build_object(v_key, public.integration_strip(v_val, coalesce(p_depth, 0) + 1));
      end if;
    end loop;
    return v_out;
  elsif jsonb_typeof(p_value) = 'array' then
    return coalesce(
      (select jsonb_agg(public.integration_strip(a.elem, coalesce(p_depth, 0) + 1) order by a.ord)
         from jsonb_array_elements(p_value) with ordinality as a(elem, ord)),
      '[]'::jsonb);
  end if;
  return p_value;
end;
$$;

-- อ่านจำนวนเต็มจาก JSON (number หรือข้อความตัวเลข) ช่วง [p_min, p_max]; null/ไม่มี = null
create or replace function public.integration_json_int(p_value jsonb, p_label text, p_min integer, p_max integer)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  v_num numeric;
begin
  v_num := public.product_json_num(p_value, p_label);
  if v_num is null then
    return null;
  end if;
  if v_num <> trunc(v_num) or v_num < p_min or v_num > p_max then
    raise exception '%ต้องเป็นจำนวนเต็ม % ถึง %', p_label, p_min, p_max;
  end if;
  return v_num::integer;
end;
$$;

-- อ่านเวลาจาก JSON: ข้อความ ISO 8601 ที่มีโซนเวลา (เช่น 2026-09-29T10:00:00Z / +07:00); null/ว่าง = null
create or replace function public.integration_json_ts(p_value jsonb, p_label text)
returns timestamptz
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
  if jsonb_typeof(p_value) <> 'string' then
    raise exception '%ต้องเป็นเวลาแบบ ISO 8601', p_label;
  end if;
  v_text := btrim(p_value #>> '{}');
  if v_text = '' then
    return null;
  end if;
  if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,9})?)?(Z|z|[+-][0-9]{2}(:?[0-9]{2})?)$' then
    raise exception '%ต้องเป็นเวลาแบบ ISO 8601 พร้อมโซนเวลา (ได้ "%")', p_label, left(v_text, 40);
  end if;
  begin
    return v_text::timestamptz;
  exception when others then
    raise exception '%ไม่ใช่เวลาที่ถูกต้อง (ได้ "%")', p_label, left(v_text, 40);
  end;
end;
$$;

-- บันทึกการซิงก์ (ตัดความลับ/ข้อมูลผู้ซื้อ + จำกัดขนาด + ล้างของเก่า: เก็บ 60 วัน และช่องทางละไม่เกิน 5,000 แถว)
create or replace function public.integration_log(
  p_channel_id uuid,
  p_kind text,
  p_ok boolean,
  p_summary text,
  p_detail jsonb,
  p_actor uuid,
  p_duration_ms integer
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_detail jsonb;
  v_cut bigint;
begin
  if p_kind is null or p_kind not in ('push_stock', 'pull_orders', 'webhook', 'order', 'catalog', 'refresh_token', 'test',
                                      'oauth', 'reconcile', 'feed', 'csv', 'admin', 'worker') then
    raise exception 'ชนิดบันทึกการซิงก์ไม่ถูกต้อง: %', coalesce(p_kind, 'null');
  end if;
  v_detail := public.integration_strip(p_detail, 0);
  if v_detail is not null and octet_length(v_detail::text) > 16000 then
    v_detail := jsonb_build_object('truncated', true, 'bytes', octet_length(v_detail::text));
  end if;

  insert into public.integration_sync_log as l (channel_id, kind, ok, summary, detail, actor, duration_ms)
  values (p_channel_id, p_kind, coalesce(p_ok, false),
          left(coalesce(nullif(btrim(p_summary), ''), '-'), 500), v_detail, p_actor,
          case when p_duration_ms >= 0 then p_duration_ms end)
  returning l.id into v_id;

  -- ล้างของเก่าเป็นระยะ (ทุก 50 แถว) — ตารางไม่โตไม่จำกัด
  if v_id % 50 = 0 then
    delete from public.integration_sync_log as l where l.created_at < now() - interval '60 days';
    if p_channel_id is not null then
      select x.id into v_cut
        from public.integration_sync_log as x
       where x.channel_id = p_channel_id
       order by x.id desc
      offset 5000
       limit 1;
      if v_cut is not null then
        delete from public.integration_sync_log as l where l.channel_id = p_channel_id and l.id <= v_cut;
      end if;
    end if;
  end if;
  return v_id;
end;
$$;

-- จำนวนที่จะส่งให้แพลตฟอร์ม (สูตรเดียวทั้งระบบ):
--   ปิดขาย/เลิกใช้ → 0; เหลือ (สต๊อก − ค้างส่งจากขายเกิน) ≤ zero_at_or_below → 0; ไม่งั้น max(0, เหลือ − buffer)
create or replace function public.integration_push_qty(
  p_options jsonb,
  p_buffer_override integer,
  p_stock integer,
  p_active boolean,
  p_archived boolean,
  p_owed integer
)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  v_avail integer;
begin
  if not coalesce(p_active, false) or coalesce(p_archived, false) then
    return 0;
  end if;
  v_avail := greatest(coalesce(p_stock, 0) - greatest(coalesce(p_owed, 0), 0), 0);
  if v_avail <= coalesce((p_options ->> 'zero_at_or_below')::integer, 0) then
    return 0;
  end if;
  return greatest(v_avail - coalesce(p_buffer_override, (p_options ->> 'stock_buffer')::integer, 0), 0);
end;
$$;

-- ชิ้นที่ค้างส่งจากการขายเกิน (ขายไปแล้วบนแพลตฟอร์มแต่ตัดสต๊อกไม่ได้) ของสินค้านี้ รวมทุกช่องทาง
create or replace function public.integration_owed_qty(p_product_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(l.qty_oversold), 0)::integer
    from public.channel_order_lines as l
    join public.channel_orders as o on o.id = l.order_id
   where l.product_id = p_product_id
     and l.qty_oversold > 0
     and o.stock_tracking = 'live'
$$;

-- เติมคิวส่งสต๊อก: ทุกคู่ (ช่องทาง, สินค้า) ที่จับคู่แล้ว เปิดส่ง และช่องทางพร้อม (null = ทุกช่องทาง / ทุกสินค้า)
--   มีงานค้างของคู่นั้นอยู่แล้ว = รวบเป็นงานเดียว (ขยับเวลาให้เร็วขึ้นได้ ไม่เร่งงานที่รอ backoff หลังล้มเหลว)
--   ช่องทางที่ error/หยุดชั่วคราว ยังเก็บงานไว้ (ส่งเมื่อกลับมาเชื่อมต่อ) / disconnected, pending_approval ไม่เก็บ
create or replace function public.integration_enqueue(
  p_channel_id uuid,
  p_product_id uuid,
  p_reason text,
  p_due timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  insert into public.stock_sync_outbox as o (channel_id, product_id, reason, next_attempt_at)
  select distinct l.channel_id, l.product_id, p_reason, coalesce(p_due, now())
    from public.channel_listings as l
    join public.integration_channels as c on c.id = l.channel_id
   where (p_channel_id is null or l.channel_id = p_channel_id)
     and (p_product_id is null or l.product_id = p_product_id)
     and l.product_id is not null
     and l.mapping_status = 'mapped'
     and l.push_enabled
     and l.external_sku_id not like 'sku:%'           -- รายการแทนจาก CSV ไม่มีรหัสบนแพลตฟอร์มให้ส่งสต๊อก
     and c.platform <> 'generic'
     and c.status in ('connected', 'error', 'paused')
     and (c.options -> 'push_stock') = 'true'::jsonb
     and (c.options -> 'initial_push_done') = 'true'::jsonb
  on conflict (channel_id, product_id) where status in ('pending', 'failed')
  do update set next_attempt_at = least(o.next_attempt_at, excluded.next_attempt_at),
                reason = case when excluded.reason in ('oversold', 'initial_push', 'resync') then excluded.reason
                              else o.reason end,
                updated_at = now()
          where o.status = 'pending';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- updated_at อัตโนมัติ
create or replace function public.integration_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists integration_channels_touch on public.integration_channels;
create trigger integration_channels_touch
  before update on public.integration_channels
  for each row execute function public.integration_touch_updated_at();

drop trigger if exists channel_orders_touch on public.channel_orders;
create trigger channel_orders_touch
  before update on public.channel_orders
  for each row execute function public.integration_touch_updated_at();

drop trigger if exists channel_order_lines_touch on public.channel_order_lines;
create trigger channel_order_lines_touch
  before update on public.channel_order_lines
  for each row execute function public.integration_touch_updated_at();

drop trigger if exists stock_sync_outbox_touch on public.stock_sync_outbox;
create trigger stock_sync_outbox_touch
  before update on public.stock_sync_outbox
  for each row execute function public.integration_touch_updated_at();

-- ----- trigger: สต๊อก/เปิดขาย/เลิกใช้ของสินค้าเปลี่ยน → เข้าคิวส่งสต๊อก -----
--   ครอบคลุมทุกทางที่แก้สต๊อก: record_sale, move_stock, save_product_group, set_product_group_active,
--   record_channel_order และอื่นๆ ในอนาคต — ทำงานในธุรกรรมเดียวกัน (ขายไม่สำเร็จ = ไม่มีงาน)
--   สต๊อกลด/หมด/ปิดขาย = ส่งทันที (ลดโอกาสขายเกิน) / สต๊อกเพิ่ม = รอ 10 วินาที (รวบหลายรายการเป็นงานเดียว)
create or replace function public.products_enqueue_channel_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stock_qty is not distinct from old.stock_qty
     and new.is_active is not distinct from old.is_active
     and new.is_archived is not distinct from old.is_archived then
    return null;
  end if;
  perform public.integration_enqueue(
    null,
    new.id,
    'stock_change',
    case when coalesce(new.stock_qty, 0) <= 0
              or coalesce(new.stock_qty, 0) < coalesce(old.stock_qty, 0)
              or not coalesce(new.is_active, false)
              or coalesce(new.is_archived, false)
         then now()
         else now() + interval '10 seconds'
    end);
  return null;
end;
$$;

drop trigger if exists products_enqueue_channel_sync on public.products;
create trigger products_enqueue_channel_sync
  after update of stock_qty, is_active, is_archived on public.products
  for each row execute function public.products_enqueue_channel_sync();

-- ----- trigger: รายการบนแพลตฟอร์ม -----
--   ก่อนเขียน: คำนวณ SKU แบบปกติ, สินค้าถูกลบ (product_id → null) = กลับเป็น "ยังไม่จับคู่"
create or replace function public.channel_listings_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.external_sku_norm := nullif(lower(public.product_clean_text(new.external_sku)), '');
  if new.product_id is null and new.mapping_status = 'mapped' then
    new.mapping_status := 'unmapped';
    new.match_source := null;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists channel_listings_before_write on public.channel_listings;
create trigger channel_listings_before_write
  before insert or update on public.channel_listings
  for each row execute function public.channel_listings_before_write();

--   หลังเขียน: จับคู่ใหม่ / เปิดส่ง / เปลี่ยน buffer → เข้าคิวส่งสต๊อกของคู่นั้นทันที
create or replace function public.channel_listings_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.product_id is null or new.mapping_status <> 'mapped' or not new.push_enabled then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and new.product_id is not distinct from old.product_id
     and new.mapping_status is not distinct from old.mapping_status
     and new.push_enabled is not distinct from old.push_enabled
     and new.buffer_override is not distinct from old.buffer_override then
    return null;
  end if;
  perform public.integration_enqueue(new.channel_id, new.product_id, 'listing_change', now());
  return null;
end;
$$;

drop trigger if exists channel_listings_after_write on public.channel_listings;
create trigger channel_listings_after_write
  after insert or update of product_id, mapping_status, push_enabled, buffer_override on public.channel_listings
  for each row execute function public.channel_listings_after_write();

-- =========================================================================
-- 5) record_sale() รับช่องทางขาย (p_channel) — แอปเดิมที่ไม่ส่ง p_channel ยังใช้ได้ (ค่าเริ่มต้น 'store')
--    ต้องลบแบบ 5 พารามิเตอร์เดิมก่อน (ถ้ามีทั้งสองแบบ การเรียกด้วยชื่อพารามิเตอร์ 5 ตัวจะกำกวม)
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

drop function if exists public.record_sale(uuid, jsonb, numeric, text, text);

create or replace function public.record_sale(
  p_client_id uuid,
  p_items jsonb,
  p_discount numeric default 0,
  p_payment_method text default 'cash',
  p_note text default null,
  p_channel text default 'store'
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

  -- ----- บันทึกหัวบิล (sale_no มาจาก trigger set_sale_no) -----
  insert into public.sales as s
    (client_id, total_amount, discount, net_amount, payment_method, note, created_by, channel)
  values
    (p_client_id, v_total, v_discount, v_total - v_discount, p_payment_method, v_note, v_uid, v_channel)
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

revoke all on function public.record_sale(uuid, jsonb, numeric, text, text, text) from public, anon;
grant execute on function public.record_sale(uuid, jsonb, numeric, text, text, text) to authenticated;

-- =========================================================================
-- 6) JSON ที่หน้าจอ/เซิร์ฟเวอร์ใช้ (ไม่มีความลับเด็ดขาด)
-- =========================================================================

-- ช่องทาง: ข้อมูลทั่วไป + ตัวเลือก + ชื่อคีย์ที่ตั้งไว้แล้วพร้อมคำใบ้ (ไม่มีค่าลับ) + ตัวนับ (ถ้าขอ)
create or replace function public.integration_channel_json(p_channel_id uuid, p_with_counts boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.integration_channels%rowtype;
  v jsonb;
  v_today timestamptz;
begin
  select * into c from public.integration_channels as x where x.id = p_channel_id;
  if not found then
    return null;
  end if;

  v := jsonb_build_object(
         'id', c.id,
         'platform', c.platform,
         'platform_label', public.integration_platform_label(c.platform),
         'display_name', c.display_name,
         'environment', c.environment,
         'status', c.status,
         'status_reason', c.status_reason,
         'options', public.integration_channel_options(c.platform, c.options),
         'settings', c.settings,
         'db_capabilities', jsonb_build_object(
           'push_stock', c.platform <> 'generic',
           'pull_orders', c.platform not in ('meta', 'generic')),
         'external_shop_id', c.external_shop_id,
         'external_shop_name', c.external_shop_name,
         'token_expires_at', c.token_expires_at,
         'refresh_expires_at', c.refresh_expires_at,
         'auth_expires_at', c.auth_expires_at)
    || jsonb_build_object(
         'last_sync_at', c.last_sync_at,
         'last_orders_sync_at', c.last_orders_sync_at,
         'last_stock_push_at', c.last_stock_push_at,
         'last_catalog_sync_at', c.last_catalog_sync_at,
         'last_test_at', c.last_test_at,
         'last_test_ok', c.last_test_ok,
         'last_error', c.last_error,
         'last_error_at', c.last_error_at,
         'consecutive_failures', c.consecutive_failures,
         'paused_until', c.paused_until,
         'has_feed_token', c.feed_token_hash is not null,
         'feed_token_rotated_at', c.feed_token_rotated_at,
         'created_at', c.created_at,
         'updated_at', c.updated_at,
         'credentials', coalesce(
           (select jsonb_agg(jsonb_build_object('name', k.name, 'hint', k.hint, 'updated_at', k.updated_at)
                             order by k.name)
              from public.integration_credentials as k
             where k.channel_id = c.id and k.name <> 'feed_token'),
           '[]'::jsonb));

  if coalesce(p_with_counts, false) then
    v_today := date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
    v := v || jsonb_build_object('counts',
      (select jsonb_build_object(
                'listings', count(*),
                'mapped', count(*) filter (where l.mapping_status = 'mapped'),
                'unmapped', count(*) filter (where l.mapping_status = 'unmapped'),
                'conflict', count(*) filter (where l.mapping_status = 'conflict'),
                'ignored', count(*) filter (where l.mapping_status = 'ignored'),
                'gone', count(*) filter (where l.mapping_status = 'gone'),
                'push_errors', count(*) filter (where l.mapping_status = 'mapped' and l.last_error is not null))
         from public.channel_listings as l
        where l.channel_id = c.id)
      || (select jsonb_build_object(
                   'outbox_pending', count(*) filter (where o.status in ('pending', 'processing')),
                   'outbox_failed', count(*) filter (where o.status = 'failed'),
                   'outbox_dead', count(*) filter (where o.status = 'dead'))
            from public.stock_sync_outbox as o
           where o.channel_id = c.id
             and o.status in ('pending', 'processing', 'failed', 'dead'))
      || (select jsonb_build_object(
                   'orders_total', count(*),
                   'orders_today', count(*) filter (where o.created_at >= v_today),
                   'orders_attention', count(*) filter (where o.needs_attention),
                   'oversold_orders', count(*) filter (where o.has_oversold),
                   'unmapped_orders', count(*) filter (where o.has_unmapped),
                   'return_to_confirm', count(*) filter (where 'return_to_confirm' = any (o.attention_reasons)))
            from public.channel_orders as o
           where o.channel_id = c.id));
  end if;
  return v;
end;
$$;

-- รายการบนแพลตฟอร์ม + สินค้าในแอปที่จับคู่ + จำนวนที่จะส่งตอนนี้
create or replace function public.integration_listing_json(p_listing_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', l.id,
           'channel_id', l.channel_id,
           'external_item_id', l.external_item_id,
           'external_sku_id', l.external_sku_id,
           'external_sku', l.external_sku,
           'external_inventory_id', l.external_inventory_id,
           'external_name', l.external_name,
           'external_variant_name', l.external_variant_name,
           'external_status', l.external_status,
           'platform_qty', l.platform_qty,
           'platform_reserved', l.platform_reserved,
           'platform_qty_at', l.platform_qty_at,
           'mapping_status', l.mapping_status,
           'match_source', l.match_source,
           'push_enabled', l.push_enabled,
           'buffer_override', l.buffer_override,
           'last_seen_at', l.last_seen_at,
           'last_pushed_qty', l.last_pushed_qty,
           'last_pushed_at', l.last_pushed_at,
           'last_error', l.last_error,
           'last_error_at', l.last_error_at,
           'updated_at', l.updated_at)
      || jsonb_build_object(
           'product', case when p.id is null then null else jsonb_build_object(
             'id', p.id,
             'group_id', p.group_id,
             'sku', p.sku,
             'name', p.name,
             'size', p.size,
             'color', p.color,
             'label', public.product_label_text(p.name, p.size, p.color),
             'stock_qty', p.stock_qty,
             'is_active', coalesce(p.is_active, false),
             'is_archived', p.is_archived) end,
           'owed_qty', case when p.id is null then null else public.integration_owed_qty(p.id) end,
           'push_qty', case when p.id is null then null else public.integration_push_qty(
             public.integration_channel_options(c.platform, c.options), l.buffer_override, p.stock_qty,
             p.is_active, p.is_archived, public.integration_owed_qty(p.id)) end)
    from public.channel_listings as l
    join public.integration_channels as c on c.id = l.channel_id
    left join public.products as p on p.id = l.product_id
   where l.id = p_listing_id
$$;

-- ออเดอร์ + ทุกบรรทัด (ไม่มีข้อมูลผู้ซื้อ)
create or replace function public.integration_order_json(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', o.id,
           'channel_id', o.channel_id,
           'platform', c.platform,
           'platform_label', public.integration_platform_label(c.platform),
           'channel_name', c.display_name,
           'external_order_id', o.external_order_id,
           'status', o.status,
           'raw_status', o.raw_status,
           'stock_tracking', o.stock_tracking,
           'platform_created_at', o.platform_created_at,
           'platform_updated_at', o.platform_updated_at,
           'shipped_at', o.shipped_at,
           'sale_id', o.sale_id,
           'sale_no', s.sale_no,
           'sale_voided_at', s.voided_at,
           'currency', o.currency,
           'items_total', o.items_total)
      || jsonb_build_object(
           'stock_applied', o.stock_applied,
           'has_oversold', o.has_oversold,
           'has_unmapped', o.has_unmapped,
           'needs_attention', o.needs_attention,
           'attention_reasons', to_jsonb(o.attention_reasons),
           'dismissed_reasons', to_jsonb(o.dismissed_reasons),
           'resolved_at', o.resolved_at,
           'last_source', o.last_source,
           'created_at', o.created_at,
           'updated_at', o.updated_at,
           'lines', coalesce(
             (select jsonb_agg(
                       jsonb_build_object(
                         'id', l.id,
                         'line_key', l.line_key,
                         'external_item_id', l.external_item_id,
                         'external_sku_id', l.external_sku_id,
                         'external_sku', l.external_sku,
                         'external_name', l.external_name,
                         'listing_id', l.listing_id,
                         'product', case when p.id is null then null else jsonb_build_object(
                           'id', p.id, 'group_id', p.group_id, 'sku', p.sku,
                           'label', public.product_label_text(p.name, p.size, p.color),
                           'stock_qty', p.stock_qty) end,
                         'qty', l.qty,
                         'qty_cancelled', l.qty_cancelled,
                         'platform_qty_returned', l.platform_qty_returned,
                         'qty_returned_received', l.qty_returned_received,
                         'qty_waived', l.qty_waived,
                         'qty_deducted', l.qty_deducted,
                         'qty_restocked', l.qty_restocked,
                         'held', l.qty_deducted - l.qty_restocked,
                         'qty_oversold', l.qty_oversold,
                         'unit_price', l.unit_price,
                         'max_return_receivable', least(l.qty, l.qty_returned_received + (l.qty_deducted - l.qty_restocked)))
                       order by l.line_key)
                from public.channel_order_lines as l
                left join public.products as p on p.id = l.product_id
               where l.order_id = o.id),
             '[]'::jsonb))
    from public.channel_orders as o
    join public.integration_channels as c on c.id = o.channel_id
    left join public.sales as s on s.id = o.sale_id
   where o.id = p_order_id
$$;

-- =========================================================================
-- 7) รายการสินค้าบนแพลตฟอร์ม + จับคู่อัตโนมัติ
-- =========================================================================

-- เพิ่ม/อัปเดตรายการ 1 แถว (จากรายการสินค้าของแพลตฟอร์ม p_from_catalog = true หรือจากบรรทัดออเดอร์ = false)
--   p_row: {"sku_id","item_id","sku","inventory_id","name","variant_name","status","qty","reserved","extra"}
create or replace function public.integration_listing_upsert(p_channel_id uuid, p_row jsonb, p_from_catalog boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sku_id text;
  v_item_id text;
  v_sku text;
  v_inv text;
  v_name text;
  v_vname text;
  v_status text;
  v_qty integer;
  v_reserved integer;
  v_extra jsonb;
  v_id uuid;
begin
  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    raise exception 'ข้อมูลรายการสินค้าจากแพลตฟอร์มไม่ถูกต้อง';
  end if;
  v_sku_id := public.product_json_text(p_row -> 'sku_id', 'รหัสตัวเลือกสินค้าบนแพลตฟอร์ม (sku_id)');
  if v_sku_id is null then
    raise exception 'รายการสินค้าจากแพลตฟอร์มต้องมี sku_id';
  end if;
  v_item_id := coalesce(public.product_json_text(p_row -> 'item_id', 'รหัสสินค้าบนแพลตฟอร์ม (item_id)'), v_sku_id);
  v_sku := public.product_json_text(p_row -> 'sku', 'SKU บนแพลตฟอร์ม');
  v_inv := public.product_json_text(p_row -> 'inventory_id', 'รหัสคลัง (inventory_id)');
  v_name := left(public.product_json_text(p_row -> 'name', 'ชื่อสินค้าบนแพลตฟอร์ม'), 500);
  v_vname := left(public.product_json_text(p_row -> 'variant_name', 'ชื่อตัวเลือก'), 200);
  v_status := left(public.product_json_text(p_row -> 'status', 'สถานะสินค้าบนแพลตฟอร์ม'), 50);
  v_qty := public.integration_json_int(p_row -> 'qty', 'จำนวนบนแพลตฟอร์ม', -1000000000, 1000000000);
  v_reserved := public.integration_json_int(p_row -> 'reserved', 'จำนวนที่จองไว้บนแพลตฟอร์ม', -1000000000, 1000000000);
  if jsonb_typeof(p_row -> 'extra') = 'object' then
    v_extra := public.integration_strip(p_row -> 'extra', 0);
    if octet_length(v_extra::text) > 8000 then
      raise exception 'ข้อมูลเสริมของรายการ % ใหญ่เกินไป', v_sku_id;
    end if;
  end if;
  if char_length(v_sku_id) > 200 or char_length(v_item_id) > 200 or char_length(v_sku) > 200 or char_length(v_inv) > 200 then
    raise exception 'รหัสสินค้าบนแพลตฟอร์มยาวเกินไป (สูงสุด 200 ตัวอักษร): %', left(v_sku_id, 60);
  end if;

  insert into public.channel_listings as l
    (channel_id, external_item_id, external_sku_id, external_sku, external_inventory_id, external_name,
     external_variant_name, external_status, platform_qty, platform_reserved, platform_qty_at, extra, last_seen_at)
  values
    (p_channel_id, v_item_id, v_sku_id, v_sku, v_inv, v_name, v_vname, v_status, v_qty, v_reserved,
     case when v_qty is not null then now() end, coalesce(v_extra, '{}'::jsonb),
     case when coalesce(p_from_catalog, false) then now() end)
  on conflict (channel_id, external_sku_id) do update
    set external_item_id = excluded.external_item_id,
        external_sku = case when coalesce(p_from_catalog, false) or excluded.external_sku is not null
                            then excluded.external_sku else l.external_sku end,
        external_inventory_id = coalesce(excluded.external_inventory_id, l.external_inventory_id),
        external_name = coalesce(excluded.external_name, l.external_name),
        external_variant_name = coalesce(excluded.external_variant_name, l.external_variant_name),
        external_status = coalesce(excluded.external_status, l.external_status),
        platform_qty = coalesce(excluded.platform_qty, l.platform_qty),
        platform_reserved = coalesce(excluded.platform_reserved, l.platform_reserved),
        platform_qty_at = case when excluded.platform_qty is not null then now() else l.platform_qty_at end,
        extra = case when v_extra is not null then v_extra else l.extra end,
        last_seen_at = case when coalesce(p_from_catalog, false) then now() else l.last_seen_at end,
        mapping_status = case when coalesce(p_from_catalog, false) and l.mapping_status = 'gone'
                              then 'unmapped' else l.mapping_status end
  returning l.id into v_id;
  return v_id;
end;
$$;

-- จับคู่อัตโนมัติด้วย SKU (ตรงกันทุกตัวอักษรแบบไม่สนตัวพิมพ์ + ตัดช่องว่าง/อักขระที่มองไม่เห็นหัวท้าย)
--   ไม่แตะรายการที่แอดมินจับคู่เอง / สั่งไม่ซิงก์ / หายจากแพลตฟอร์ม
--   SKU ซ้ำกันบนแพลตฟอร์ม / ตรงสินค้าในแอปหลายตัว / สินค้านั้นจับคู่กับรายการอื่นอยู่แล้ว = "ขัดแย้ง" (ต้องเลือกเอง)
--   ไม่จับคู่กับไซส์ที่เลิกใช้ (archived) — จับคู่อัตโนมัติไว้แล้วแต่ SKU เปลี่ยน/สินค้าเลิกใช้ = ยกเลิกแล้วตัดสินใหม่
--   p_listing_id = ทำเฉพาะรายการนั้น (null = ทั้งช่องทาง); คืนตัวนับของทั้งช่องทาง
--   รายการแทน 'sku:<sku>' (สร้างจากบรรทัดออเดอร์ที่มีแต่ SKU เช่น ไฟล์ CSV) ไม่ใช่รายการจริงบนแพลตฟอร์ม:
--     ไม่นับเป็น "SKU ซ้ำบนแพลตฟอร์ม" และหลีกทางให้รายการจริงที่ SKU เดียวกันเสมอ
--     (ย้ายบรรทัดออเดอร์ไปที่รายการจริงแล้วลบรายการแทน — ไม่ทำให้รายการจริงกลายเป็น "ขัดแย้ง")
create or replace function public.integration_auto_match(p_channel_id uuid, p_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed integer;
  r record;
begin
  update public.channel_listings as l
     set product_id = null,
         mapping_status = 'unmapped',
         match_source = null
   where l.channel_id = p_channel_id
     and (p_listing_id is null or l.id = p_listing_id)
     and l.mapping_status = 'mapped'
     and l.match_source = 'auto'
     and not exists (
       select 1 from public.products as p
        where p.id = l.product_id
          and not p.is_archived
          and l.external_sku_norm is not null
          and lower(public.product_clean_text(p.sku)) = l.external_sku_norm);

  -- รายการแทนจากไฟล์ CSV ที่แพลตฟอร์มมีรายการจริง SKU เดียวกันแล้ว = หมดหน้าที่
  --   (ที่แอดมินจับคู่เอง/สั่งไม่ซิงก์ไว้ ไม่แตะ; บรรทัดที่ตัดสต๊อกไปแล้วยังถือสินค้าเดิม)
  for r in
    select s.id as sid,
           (select k.id
              from public.channel_listings as k
             where k.channel_id = p_channel_id
               and k.external_sku_id not like 'sku:%'
               and k.external_sku_norm = s.external_sku_norm
               and k.mapping_status not in ('gone', 'ignored')
             order by (k.mapping_status = 'mapped') desc, k.created_at, k.id
             limit 1) as kid
      from public.channel_listings as s
     where s.channel_id = p_channel_id
       and s.external_sku_id like 'sku:%'
       and s.external_sku_norm is not null
       and s.match_source is distinct from 'manual'
       and (p_listing_id is null
            or exists (select 1 from public.channel_listings as t
                        where t.id = p_listing_id
                          and t.external_sku_id not like 'sku:%'
                          and t.external_sku_norm = s.external_sku_norm))
  loop
    continue when r.kid is null;
    update public.channel_order_lines as ol set listing_id = r.kid where ol.listing_id = r.sid;
    delete from public.channel_listings as s where s.id = r.sid;
  end loop;

  with cand as (
    select l.id, l.external_sku_norm as k, (l.external_sku_id like 'sku:%') as stand_in
      from public.channel_listings as l
     where l.channel_id = p_channel_id
       and (p_listing_id is null or l.id = p_listing_id)
       and l.mapping_status in ('unmapped', 'conflict')
       and l.match_source is distinct from 'manual'
  ),
  dup as (
    select l.external_sku_norm as k
      from public.channel_listings as l
     where l.channel_id = p_channel_id
       and l.external_sku_norm in (select cand.k from cand)
       and l.mapping_status not in ('gone', 'ignored')
       and l.external_sku_id not like 'sku:%'
     group by l.external_sku_norm
    having count(*) > 1
  ),
  prod as (
    select lower(public.product_clean_text(p.sku)) as k, count(*) as n, (array_agg(p.id order by p.id))[1] as pid
      from public.products as p
     where not p.is_archived
       and lower(public.product_clean_text(p.sku)) in (select cand.k from cand)
     group by 1
  ),
  decided as (
    select cand.id,
           case when cand.k is null then 'unmapped'
                when cand.k in (select dup.k from dup) then 'conflict'
                when cand.stand_in
                     and exists (select 1 from public.channel_listings as t
                                  where t.channel_id = p_channel_id
                                    and t.external_sku_id not like 'sku:%'
                                    and t.external_sku_norm = cand.k
                                    and t.mapping_status <> 'gone') then 'conflict'
                when prod.pid is null then 'unmapped'
                when prod.n > 1 then 'conflict'
                when exists (select 1 from public.channel_listings as t
                              where t.channel_id = p_channel_id and t.product_id = prod.pid and t.id <> cand.id)
                  then 'conflict'
                else 'mapped'
           end as st,
           prod.pid
      from cand
      left join prod on prod.k = cand.k
  )
  update public.channel_listings as l
     set mapping_status = d.st,
         product_id = case when d.st = 'mapped' then d.pid end,
         match_source = case when d.st = 'mapped' then 'auto' end
    from decided as d
   where l.id = d.id
     and (l.mapping_status is distinct from d.st
          or l.product_id is distinct from (case when d.st = 'mapped' then d.pid end));
  get diagnostics v_changed = row_count;

  return (select jsonb_build_object(
                   'changed', v_changed,
                   'total', count(*),
                   'mapped', count(*) filter (where l.mapping_status = 'mapped'),
                   'unmapped', count(*) filter (where l.mapping_status = 'unmapped'),
                   'conflict', count(*) filter (where l.mapping_status = 'conflict'),
                   'ignored', count(*) filter (where l.mapping_status = 'ignored'),
                   'gone', count(*) filter (where l.mapping_status = 'gone'))
            from public.channel_listings as l
           where l.channel_id = p_channel_id);
end;
$$;

-- หา/สร้างรายการบนแพลตฟอร์มของบรรทัดออเดอร์ (sku_id ก่อน / ไม่มี sku_id ใช้ 'sku:<sku ตัวเล็ก>') แล้วจับคู่อัตโนมัติ
--   บรรทัดที่มีแต่ SKU (ไฟล์ CSV): ใช้รายการที่ SKU เดียวกันของช่องทางนี้ก่อน (ที่จับคู่แล้วก่อน / รายการจริงของแพลตฟอร์มก่อน)
--   จึงไม่สร้างรายการแทนซ้อนกับรายการจริง (ถ้าซ้อน รายการจริงจะ "ขัดแย้ง" และออเดอร์จากไฟล์จะไม่ตัดสต๊อก)
create or replace function public.integration_resolve_listing(
  p_channel_id uuid,
  p_sku_id text,
  p_item_id text,
  p_sku text,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_norm text;
  v_id uuid;
begin
  v_norm := nullif(lower(public.product_clean_text(p_sku)), '');
  v_key := coalesce(p_sku_id, case when v_norm is not null then left('sku:' || v_norm, 200) end);
  if v_key is null then
    return null;
  end if;
  if p_sku_id is null then
    select l.id into v_id
      from public.channel_listings as l
     where l.channel_id = p_channel_id
       and l.external_sku_norm = v_norm
       and (l.mapping_status = 'mapped'
            or (l.mapping_status <> 'gone' and l.external_sku_id not like 'sku:%'))
     order by (l.mapping_status = 'mapped') desc, (l.external_sku_id like 'sku:%'), l.updated_at desc, l.id
     limit 1;
    if found then
      return v_id;
    end if;
  end if;
  select l.id into v_id
    from public.channel_listings as l
   where l.channel_id = p_channel_id and l.external_sku_id = v_key;
  if found then
    return v_id;
  end if;
  v_id := public.integration_listing_upsert(
            p_channel_id,
            jsonb_build_object('sku_id', v_key, 'item_id', coalesce(p_item_id, v_key), 'sku', p_sku, 'name', p_name),
            false);
  perform public.integration_auto_match(p_channel_id, v_id);
  return v_id;
end;
$$;

-- =========================================================================
-- 8) ออเดอร์: คำนวณสต๊อก/บิลของออเดอร์ให้ตรงกับสถานะล่าสุด ("ทำให้ตรงกับ snapshot" — ทำซ้ำได้ผลเหมือนเดิม)
-- =========================================================================

-- ลำดับสถานะ (ใช้กันถอยสถานะเมื่อไม่มีเวลาอัปเดตให้เทียบ)
create or replace function public.integration_status_rank(p_status text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_status
           when 'unpaid' then 10
           when 'paid' then 20
           when 'ready_to_ship' then 30
           when 'cancel_pending' then 35
           when 'shipped' then 40
           when 'completed' then 50
           when 'return_requested' then 60
           when 'returned' then 70
           when 'cancelled' then 90
           when 'expired' then 90
           else 0
         end
$$;

-- บรรทัดที่ยังไม่ได้ถือสต๊อก: ผูกสินค้าตามการจับคู่ปัจจุบัน (บรรทัดที่ตัดสต๊อกไปแล้วไม่ย้ายสินค้า)
--   บรรทัดที่ไม่มีรายการ หรือบรรทัดจาก CSV ที่รายการยังไม่ได้จับคู่ → หารายการใหม่ด้วย integration_resolve_listing
create or replace function public.channel_order_resolve_products(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_listing uuid;
  v_pid uuid;
  v_n integer := 0;
begin
  for r in
    select l.id, l.listing_id, l.product_id, l.external_sku_id, l.external_item_id, l.external_sku, l.external_name,
           o.channel_id
      from public.channel_order_lines as l
      join public.channel_orders as o on o.id = l.order_id
     where l.order_id = p_order_id
       and l.qty_deducted = l.qty_restocked
     order by l.line_key
  loop
    v_listing := r.listing_id;
    -- บรรทัดที่มีแต่ SKU (ไฟล์ CSV) และรายการเดิมยังไม่ได้จับคู่ → หาใหม่ (เช่น ดึงรายการสินค้าของแพลตฟอร์มมาทีหลัง)
    if v_listing is null
       or (r.external_sku_id is null
           and not exists (select 1 from public.channel_listings as cl
                            where cl.id = v_listing and cl.mapping_status = 'mapped')) then
      v_listing := public.integration_resolve_listing(r.channel_id, r.external_sku_id, r.external_item_id,
                                                      r.external_sku, r.external_name);
    end if;
    select case when cl.mapping_status = 'mapped' then cl.product_id end into v_pid
      from public.channel_listings as cl
     where cl.id = v_listing;
    if r.listing_id is distinct from v_listing or r.product_id is distinct from v_pid then
      update public.channel_order_lines as l
         set listing_id = v_listing,
             product_id = v_pid
       where l.id = r.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- หัวใจของระบบออเดอร์: ทำให้ "สต๊อกที่ออเดอร์นี้ถือไว้" และบิล ตรงกับสถานะล่าสุดของออเดอร์
--   ต่อบรรทัด (เฉพาะที่จับคู่สินค้าแล้ว):
--     ต้องออกจากร้าน (out) = สถานะยังขายอยู่ → จำนวน − ยกเลิก − ยกเว้น
--                            ยกเลิก/หมดอายุ "หลังส่งของ" → จำนวน − ยกเว้น (ของยังไม่กลับ จนกว่าแอดมินยืนยันรับคืน)
--                            ยกเลิก/หมดอายุก่อนส่งของ, ยังไม่จ่าย (ตั้ง "ตัดเมื่อจ่ายแล้ว") → 0
--     เป้าหมาย = max(0, out − รับของคืนแล้ว) — ออเดอร์ที่เพิ่งเห็นครั้งแรกในสถานะคืนของ/ยกเลิกหลังส่ง ก็ตัดตามจริง
--       (ของออกจากร้านไปแล้ว) แล้วค่อยคืนเมื่อแอดมินยืนยันรับของ
--     ถือไว้ < เป้าหมาย → ตัดเท่าที่สต๊อกมี ส่วนที่ขาด = ขายเกิน / ถือไว้ > เป้าหมาย → คืนส่วนเกิน
--   สต๊อกไม่มีทางติดลบ และไม่มีทางคืนเกินที่เคยตัดไป
create or replace function public.channel_order_apply(p_order_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.channel_orders%rowtype;
  c public.integration_channels%rowtype;
  v_opts jsonb;
  v_label text;
  v_restock text;
  v_live boolean;
  v_active boolean;
  v_closed boolean;
  r record;
  v_pids uuid[];
  v_held integer;
  v_out integer;
  v_target integer;
  v_take integer;
  v_give integer;
  v_new_os integer;
  v_before integer;
  v_after integer;
  v_deducted integer := 0;
  v_restocked integer := 0;
  v_would integer := 0;
  v_os_changed uuid[] := '{}';
  v_lines jsonb := '[]'::jsonb;
  v_sale_id uuid;
  v_total numeric;
  v_ref uuid;
  v_note text;
  v_reasons text[] := '{}';
  v_has_unmapped boolean;
  v_has_oversold boolean;
  v_applied boolean;
begin
  select * into o from public.channel_orders as x where x.id = p_order_id for update;
  if not found then
    raise exception 'ไม่พบออเดอร์นี้ (อาจถูกลบไปแล้ว)';
  end if;
  select * into c from public.integration_channels as x where x.id = o.channel_id;
  v_opts := public.integration_channel_options(c.platform, c.options);
  v_label := public.integration_platform_label(c.platform);
  v_restock := v_opts ->> 'restock_returns';
  v_live := o.stock_tracking = 'live' and o.status <> 'unknown';
  v_active := o.status in ('paid', 'ready_to_ship', 'shipped', 'completed', 'cancel_pending', 'return_requested', 'returned')
              or (o.status = 'unpaid' and (v_opts ->> 'deduct_on') = 'created');
  v_closed := o.status in ('cancelled', 'expired');

  -- คืนของอัตโนมัติ (ถ้าตั้งไว้): แพลตฟอร์มแจ้งว่าของถึงร้าน = รับคืนแล้ว (ไม่เกินที่ถือไว้)
  if v_live and v_restock = 'auto' then
    update public.channel_order_lines as l
       set qty_returned_received = least(l.platform_qty_returned, l.qty_returned_received + (l.qty_deducted - l.qty_restocked))
     where l.order_id = o.id
       and l.platform_qty_returned > l.qty_returned_received;
  end if;

  if v_live then
    -- ----- บิล (สร้างครั้งแรกที่ออเดอร์ยังขายอยู่และมีบรรทัดที่จับคู่แล้ว; ยกเลิกทั้งใบ = voided_at) -----
    if v_active then
      select coalesce(sum(x.q * x.price), 0) into v_total
        from (
          select greatest(l.qty - l.qty_cancelled, 0) as q, coalesce(l.unit_price, p.sell_price, 0) as price
            from public.channel_order_lines as l
            join public.products as p on p.id = l.product_id
           where l.order_id = o.id
        ) as x;
      if v_total > 99999999.99 then
        raise exception 'ยอดรวมของออเดอร์ % #% เกินขีดจำกัดของระบบ', v_label, o.external_order_id;
      end if;

      if exists (select 1 from public.channel_order_lines as l
                  where l.order_id = o.id and l.product_id is not null and l.qty - l.qty_cancelled > 0) then
        v_sale_id := o.sale_id;
        if v_sale_id is null then
          v_note := left(v_label || ' #' || o.external_order_id, 500);
          insert into public.sales as s
            (total_amount, discount, net_amount, payment_method, note, created_by, channel, channel_id, external_order_id)
          values
            (0, 0, 0, 'marketplace', v_note, null, c.platform, c.id, o.external_order_id)
          on conflict (channel_id, external_order_id) where external_order_id is not null
          do update set voided_at = s.voided_at
          returning s.id into v_sale_id;
          update public.channel_orders as x set sale_id = v_sale_id where x.id = o.id;
          o.sale_id := v_sale_id;
        end if;

        for r in
          select l.product_id,
                 sum(greatest(l.qty - l.qty_cancelled, 0))::integer as q,
                 sum(greatest(l.qty - l.qty_cancelled, 0) * coalesce(l.unit_price, p.sell_price, 0)) as amt
            from public.channel_order_lines as l
            join public.products as p on p.id = l.product_id
           where l.order_id = o.id
           group by l.product_id
        loop
          if r.q > 0 then
            update public.sale_items as si
               set qty = r.q,
                   unit_price = round(r.amt / r.q, 2),
                   subtotal = round(r.amt / r.q, 2) * r.q
             where si.sale_id = v_sale_id and si.product_id = r.product_id;
            if not found then
              insert into public.sale_items (sale_id, product_id, qty, unit_price, unit_cost, subtotal)
              select v_sale_id, r.product_id, r.q, round(r.amt / r.q, 2), p.cost_price, round(r.amt / r.q, 2) * r.q
                from public.products as p
               where p.id = r.product_id;
            end if;
          else
            delete from public.sale_items as si where si.sale_id = v_sale_id and si.product_id = r.product_id;
          end if;
        end loop;
        delete from public.sale_items as si
         where si.sale_id = v_sale_id
           and not exists (select 1 from public.channel_order_lines as l
                            where l.order_id = o.id and l.product_id = si.product_id);

        select coalesce(sum(si.subtotal), 0) into v_total from public.sale_items as si where si.sale_id = v_sale_id;
        update public.sales as s
           set total_amount = v_total,
               discount = 0,
               net_amount = v_total,
               voided_at = null
         where s.id = v_sale_id
           and (s.total_amount is distinct from v_total or s.net_amount is distinct from v_total
                or s.discount <> 0 or s.voided_at is not null);
      elsif o.sale_id is not null then
        update public.sales as s set voided_at = coalesce(s.voided_at, now()) where s.id = o.sale_id and s.voided_at is null;
      end if;
    elsif v_closed and o.sale_id is not null then
      update public.sales as s set voided_at = coalesce(s.voided_at, now()) where s.id = o.sale_id and s.voided_at is null;
    end if;

    -- ----- สต๊อก: ล็อกสินค้าเรียงตาม id (ลำดับเดียวกับ record_sale — ไม่ deadlock) -----
    v_ref := coalesce(o.sale_id, o.id);
    select array_agg(distinct l.product_id order by l.product_id) into v_pids
      from public.channel_order_lines as l
     where l.order_id = o.id and l.product_id is not null;
    if v_pids is not null then
      perform 1 from public.products as p where p.id = any (v_pids) order by p.id for update;
    end if;

    for r in
      select l.*
        from public.channel_order_lines as l
       where l.order_id = o.id and l.product_id is not null
       order by l.line_key
    loop
      v_held := r.qty_deducted - r.qty_restocked;
      if v_active then
        v_out := greatest(r.qty - r.qty_cancelled - r.qty_waived, 0);
      elsif v_closed and o.shipped_at is not null then
        v_out := greatest(r.qty - r.qty_waived, 0);
      else
        v_out := 0;
      end if;
      v_target := greatest(v_out - r.qty_returned_received, 0);

      v_take := 0;
      v_give := 0;
      if v_target > v_held then
        select p.stock_qty into v_before from public.products as p where p.id = r.product_id;
        v_take := least(v_target - v_held, greatest(coalesce(v_before, 0), 0));
        if v_take > 0 then
          update public.products as p
             set stock_qty = v_before - v_take
           where p.id = r.product_id
          returning p.stock_qty into v_after;
          insert into public.stock_movements (product_id, type, qty, qty_before, qty_after, note, ref_id, created_by)
          values (r.product_id, 'out', v_take, v_before, v_after,
                  left('ขาย ' || v_label || ' #' || o.external_order_id, 500), v_ref, p_actor);
        end if;
      elsif v_target < v_held then
        v_give := v_held - v_target;
        select p.stock_qty into v_before from public.products as p where p.id = r.product_id;
        update public.products as p
           set stock_qty = coalesce(v_before, 0) + v_give
         where p.id = r.product_id
        returning p.stock_qty into v_after;
        insert into public.stock_movements (product_id, type, qty, qty_before, qty_after, note, ref_id, created_by)
        values (r.product_id, 'return', v_give, coalesce(v_before, 0), v_after,
                left(case when v_closed and o.shipped_at is null then 'ยกเลิก '
                          when r.qty_returned_received > 0 then 'รับคืน '
                          when r.qty_cancelled > 0 then 'ยกเลิก '
                          else 'คืนสต๊อก ' end
                     || v_label || ' #' || o.external_order_id, 500),
                v_ref, p_actor);
      end if;

      v_new_os := greatest(v_target - (v_held + v_take - v_give), 0);
      if v_take <> 0 or v_give <> 0 or r.qty_oversold <> v_new_os then
        update public.channel_order_lines as l
           set qty_deducted = l.qty_deducted + v_take,
               qty_restocked = l.qty_restocked + v_give,
               qty_oversold = v_new_os
         where l.id = r.id;
      end if;
      if r.qty_oversold <> v_new_os then
        v_os_changed := v_os_changed || r.product_id;
      end if;
      v_deducted := v_deducted + v_take;
      v_restocked := v_restocked + v_give;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
                   'line_key', r.line_key, 'product_id', r.product_id,
                   'deducted_now', v_take, 'restocked_now', v_give,
                   'held', v_held + v_take - v_give, 'oversold', v_new_os));
    end loop;
  elsif o.stock_tracking = 'shadow' and o.status <> 'unknown' then
    -- โหมดทดลอง: ไม่แตะสต๊อก/บิล — แค่บอกว่า "ถ้าเปิดจริงจะตัดกี่ชิ้น"
    select coalesce(sum(greatest(
             case when v_active then greatest(l.qty - l.qty_cancelled - l.qty_waived, 0) else 0 end
             - l.qty_returned_received, 0)), 0)::integer
      into v_would
      from public.channel_order_lines as l
     where l.order_id = o.id and l.product_id is not null;
  end if;

  -- ----- ธงแจ้งเตือน -----
  select coalesce(bool_or(l.product_id is null and l.qty - l.qty_cancelled > 0), false) and not v_closed,
         coalesce(bool_or(l.qty_oversold > 0), false),
         coalesce(sum(l.qty_deducted - l.qty_restocked), 0) > 0
    into v_has_unmapped, v_has_oversold, v_applied
    from public.channel_order_lines as l
   where l.order_id = o.id;

  if v_has_unmapped then
    v_reasons := v_reasons || 'unmapped_sku'::text;
  end if;
  if v_has_oversold then
    v_reasons := v_reasons || 'oversold'::text;
  end if;
  if o.status = 'unknown' then
    v_reasons := v_reasons || 'unknown_status'::text;
  end if;
  if o.stock_tracking = 'live' and v_restock = 'manual'
     and (exists (select 1 from public.channel_order_lines as l
                   where l.order_id = o.id and l.product_id is not null
                     and l.platform_qty_returned > l.qty_returned_received
                     and l.qty_deducted - l.qty_restocked > 0)
          or (v_closed and o.shipped_at is not null and v_applied)) then
    v_reasons := v_reasons || 'return_to_confirm'::text;
  end if;

  -- ที่แอดมินกด "ปิดการแจ้งเตือน" ไว้: ยังซ่อนอยู่ถ้าเหตุเดิมยังอยู่ / เหตุหายไปแล้วลืมได้ (ถ้าเกิดใหม่จะเตือนอีก)
  update public.channel_orders as x
     set attention_reasons = array(select a from unnest(v_reasons) as a where not (a = any (x.dismissed_reasons))),
         dismissed_reasons = array(select a from unnest(x.dismissed_reasons) as a where a = any (v_reasons)),
         has_unmapped = v_has_unmapped,
         has_oversold = v_has_oversold,
         stock_applied = v_applied
   where x.id = o.id
     and (x.attention_reasons is distinct from array(select a from unnest(v_reasons) as a where not (a = any (x.dismissed_reasons)))
          or x.dismissed_reasons is distinct from array(select a from unnest(x.dismissed_reasons) as a where a = any (v_reasons))
          or x.has_unmapped is distinct from v_has_unmapped
          or x.has_oversold is distinct from v_has_oversold
          or x.stock_applied is distinct from v_applied);

  -- ของค้างส่งจากการขายเกินเปลี่ยน → ส่งสต๊อกใหม่ทันทีทุกช่องทาง (สต๊อกอาจเป็น 0 อยู่แล้ว trigger จึงไม่ยิง)
  if cardinality(v_os_changed) > 0 then
    perform public.integration_enqueue(null, u.pid, 'oversold', now())
       from (select distinct x.pid from unnest(v_os_changed) as x(pid)) as u;
  end if;

  return jsonb_build_object(
    'deducted', v_deducted,
    'restocked', v_restocked,
    'shadow_would_deduct', v_would,
    'lines', v_lines);
end;
$$;

-- =========================================================================
-- 9) ฟังก์ชันสำหรับเซิร์ฟเวอร์ (service_role เท่านั้น)
-- =========================================================================

-- ----- record_channel_order: บันทึก/อัปเดตออเดอร์จากแพลตฟอร์ม (ทำซ้ำได้ — webhook ซ้ำ/มาสลับลำดับ/poll ทับ ได้ผลเดียวกัน) -----
--   p_order (adapter แปลงเป็นรูปแบบกลางแล้ว — ดู CONTRACT-INTEGRATIONS.md §3.1):
--   {"external_order_id","status","raw_status","created_at","updated_at","shipped_at","was_shipped","currency","total",
--    "lines":[{"line_key","sku_id","item_id","sku","name","qty","qty_cancelled","qty_returned","unit_price"}], "raw":{...}}
create or replace function public.record_channel_order(p_channel_id uuid, p_order jsonb, p_source text default 'webhook')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.integration_channels%rowtype;
  o public.channel_orders%rowtype;
  v_opts jsonb;
  v_source text;
  v_ext text;
  v_status text;
  v_raw_status text;
  v_created timestamptz;
  v_updated timestamptz;
  v_shipped_at timestamptz;
  v_was_shipped boolean;
  v_currency text;
  v_total numeric;
  v_raw jsonb;
  v_lines jsonb;
  v_elem jsonb;
  v_norm jsonb := '[]'::jsonb;
  v_key text;
  v_sku_id text;
  v_item_id text;
  v_sku text;
  v_name text;
  v_qty integer;
  v_qc integer;
  v_qr integer;
  v_price numeric;
  v_order_id uuid;
  v_is_new boolean;
  v_stale boolean := false;
  v_old_status text;
  v_lines_changed integer := 0;
  v_listing uuid;
  v_old record;
  v_found boolean;
  v_line_sku text;
  v_same integer;
  r record;
  v_apply jsonb;
  v_summary text;
  v_oversold integer;
  v_unmapped integer;
begin
  perform public.integration_require(false);

  v_source := coalesce(nullif(btrim(p_source), ''), 'webhook');
  if v_source not in ('webhook', 'poll', 'csv', 'manual') then
    raise exception 'แหล่งที่มาของออเดอร์ไม่ถูกต้อง: %', left(v_source, 30);
  end if;
  if p_channel_id is null then
    raise exception 'ไม่ได้ระบุช่องทาง';
  end if;
  select * into c from public.integration_channels as x where x.id = p_channel_id;
  if not found then
    raise exception 'ไม่พบช่องทางนี้ (อาจถูกลบไปแล้ว)';
  end if;
  v_opts := public.integration_channel_options(c.platform, c.options);

  -- ----- ตรวจข้อมูลออเดอร์ -----
  if p_order is null or jsonb_typeof(p_order) <> 'object' then
    raise exception 'ข้อมูลออเดอร์ไม่ถูกต้อง';
  end if;
  v_ext := public.product_json_text(p_order -> 'external_order_id', 'เลขออเดอร์');
  if v_ext is null then
    raise exception 'ออเดอร์ไม่มีเลขออเดอร์ (external_order_id)';
  end if;
  if char_length(v_ext) > 100 or v_ext ~ '[\x01-\x1f\x7f]' then
    raise exception 'เลขออเดอร์ไม่ถูกต้อง: %', left(v_ext, 40);
  end if;
  v_status := public.product_json_text(p_order -> 'status', 'สถานะออเดอร์');
  if v_status is null or v_status not in ('unpaid', 'paid', 'ready_to_ship', 'shipped', 'completed', 'cancel_pending',
                                          'cancelled', 'return_requested', 'returned', 'expired', 'unknown') then
    raise exception 'สถานะออเดอร์ #% ไม่ถูกต้อง: % (adapter ต้องแปลงเป็นสถานะกลางก่อน — ไม่รู้จักให้ส่ง unknown)',
      v_ext, coalesce(left(v_status, 40), 'ว่าง');
  end if;
  v_raw_status := left(public.product_json_text(p_order -> 'raw_status', 'สถานะเดิมของแพลตฟอร์ม'), 100);
  v_created := public.integration_json_ts(p_order -> 'created_at', 'เวลาสร้างออเดอร์');
  v_updated := public.integration_json_ts(p_order -> 'updated_at', 'เวลาอัปเดตออเดอร์');
  v_shipped_at := public.integration_json_ts(p_order -> 'shipped_at', 'เวลาส่งของ');
  v_was_shipped := coalesce(public.product_json_bool(p_order -> 'was_shipped', 'สถานะส่งของ (was_shipped)'), false);
  v_currency := upper(coalesce(public.product_json_text(p_order -> 'currency', 'สกุลเงิน'), 'THB'));
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'สกุลเงินไม่ถูกต้อง: %', left(v_currency, 10);
  end if;
  v_total := public.product_json_num(p_order -> 'total', 'ยอดรวมออเดอร์');
  if v_total is not null and (v_total < 0 or v_total > 9999999999.99) then
    raise exception 'ยอดรวมออเดอร์ #% ไม่ถูกต้อง', v_ext;
  end if;
  if jsonb_typeof(p_order -> 'raw') = 'object' then
    v_raw := public.integration_strip(p_order -> 'raw', 0);
    if octet_length(v_raw::text) > 65536 then
      v_raw := jsonb_build_object('truncated', true, 'bytes', octet_length(v_raw::text));
    end if;
  end if;

  v_lines := coalesce(p_order -> 'lines', '[]'::jsonb);
  if jsonb_typeof(v_lines) = 'null' then
    v_lines := '[]'::jsonb;
  end if;
  if jsonb_typeof(v_lines) <> 'array' then
    raise exception 'รายการสินค้าในออเดอร์ #% ไม่ถูกต้อง', v_ext;
  end if;
  if jsonb_array_length(v_lines) > 200 then
    raise exception 'ออเดอร์ #% มีสินค้าเกิน 200 รายการ', v_ext;
  end if;

  for v_elem in select e.elem from jsonb_array_elements(v_lines) as e(elem) loop
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'รายการสินค้าในออเดอร์ #% ไม่ถูกต้อง', v_ext;
    end if;
    v_sku_id := public.product_json_text(v_elem -> 'sku_id', 'รหัสตัวเลือกสินค้า (sku_id)');
    v_item_id := public.product_json_text(v_elem -> 'item_id', 'รหัสสินค้า (item_id)');
    v_sku := public.product_json_text(v_elem -> 'sku', 'SKU');
    v_key := coalesce(public.product_json_text(v_elem -> 'line_key', 'รหัสบรรทัด (line_key)'),
                      v_sku_id,
                      case when nullif(lower(public.product_clean_text(v_sku)), '') is not null
                           then 'sku:' || lower(public.product_clean_text(v_sku)) end);
    if v_key is null then
      raise exception 'บรรทัดสินค้าในออเดอร์ #% ไม่มีทั้ง sku_id และ SKU', v_ext;
    end if;
    if char_length(v_key) > 200 or char_length(v_sku_id) > 200 or char_length(v_item_id) > 200 or char_length(v_sku) > 200 then
      raise exception 'รหัสสินค้าในออเดอร์ #% ยาวเกินไป (สูงสุด 200 ตัวอักษร)', v_ext;
    end if;
    v_name := left(public.product_json_text(v_elem -> 'name', 'ชื่อสินค้า'), 500);
    v_qty := public.integration_json_int(v_elem -> 'qty', 'จำนวนสินค้า', 0, 100000);
    if v_qty is null then
      raise exception 'บรรทัด % ของออเดอร์ #% ไม่มีจำนวนสินค้า', left(v_key, 60), v_ext;
    end if;
    v_qc := coalesce(public.integration_json_int(v_elem -> 'qty_cancelled', 'จำนวนที่ยกเลิก', 0, 100000), 0);
    v_qr := coalesce(public.integration_json_int(v_elem -> 'qty_returned', 'จำนวนที่คืนของ', 0, 100000), 0);
    if v_qc > v_qty or v_qr > v_qty then
      raise exception 'บรรทัด % ของออเดอร์ #%: จำนวนยกเลิก/คืนของมากกว่าจำนวนที่สั่ง', left(v_key, 60), v_ext;
    end if;
    v_price := public.product_json_num(v_elem -> 'unit_price', 'ราคาต่อชิ้น');
    if v_price is not null then
      v_price := round(v_price, 2);
      if v_price < 0 or v_price > 99999999.99 then
        raise exception 'ราคาต่อชิ้นของบรรทัด % ในออเดอร์ #% ไม่ถูกต้อง', left(v_key, 60), v_ext;
      end if;
    end if;
    v_norm := v_norm || jsonb_build_array(jsonb_build_object(
      'line_key', v_key, 'sku_id', v_sku_id, 'item_id', v_item_id, 'sku', v_sku, 'name', v_name,
      'qty', v_qty, 'qc', v_qc, 'qr', v_qr, 'price', v_price));
  end loop;

  if exists (select 1 from jsonb_to_recordset(v_norm) as x(line_key text) group by x.line_key having count(*) > 1) then
    raise exception 'ออเดอร์ #% มีบรรทัดสินค้าซ้ำกัน (line_key ซ้ำ) — adapter ต้องรวมชิ้นของตัวเลือกเดียวกันเป็นบรรทัดเดียว', v_ext;
  end if;

  -- ----- หัวออเดอร์ (ล็อกไว้จนจบรายการ: สอง worker ทำออเดอร์เดียวกันพร้อมกันไม่ได้) -----
  insert into public.channel_orders as co
    (channel_id, external_order_id, status, raw_status, stock_tracking, platform_created_at, platform_updated_at,
     currency, items_total, last_source, raw)
  values
    (c.id, v_ext, v_status, v_raw_status,
     case when (v_opts -> 'shadow_mode') = 'true'::jsonb then 'shadow' else 'live' end,
     v_created, v_updated, v_currency, v_total, v_source, v_raw)
  on conflict (channel_id, external_order_id) do nothing
  returning co.id into v_order_id;
  v_is_new := v_order_id is not null;
  if not v_is_new then
    select co.id into v_order_id
      from public.channel_orders as co
     where co.channel_id = c.id and co.external_order_id = v_ext;
  end if;
  select * into o from public.channel_orders as co where co.id = v_order_id for update;
  v_old_status := o.status;

  if not v_is_new then
    -- ข้อมูลเก่ากว่าที่เคยเห็น → ไม่ถอยสถานะ ไม่แก้อะไร
    if v_updated is not null and o.platform_updated_at is not null then
      v_stale := v_updated < o.platform_updated_at;
    else
      v_stale := v_status <> 'unknown' and o.status <> 'unknown'
                 and public.integration_status_rank(v_status) < public.integration_status_rank(o.status);
    end if;
    if v_stale then
      return public.integration_order_json(o.id)
             || jsonb_build_object('created', false, 'stale', true, 'changed', false,
                                   'deducted', 0, 'restocked', 0, 'shadow_would_deduct', 0);
    end if;
    update public.channel_orders as co
       set status = v_status,
           raw_status = coalesce(v_raw_status, co.raw_status),
           platform_created_at = coalesce(co.platform_created_at, v_created),
           platform_updated_at = greatest(co.platform_updated_at, v_updated),
           currency = v_currency,
           items_total = coalesce(v_total, co.items_total),
           last_source = v_source,
           raw = coalesce(v_raw, co.raw)
     where co.id = o.id;
  end if;

  if v_shipped_at is not null or v_was_shipped or v_status in ('shipped', 'completed', 'return_requested', 'returned') then
    update public.channel_orders as co
       set shipped_at = coalesce(v_shipped_at, now())
     where co.id = v_order_id and co.shipped_at is null;
  end if;

  -- ----- บรรทัดสินค้า (บรรทัดที่ไม่ได้ส่งมาในรอบนี้ = คงเดิม) -----
  --   ออเดอร์เดียวกันมาได้ทั้งจากไฟล์ CSV (บรรทัด 'sku:<sku>' ไม่มีรหัสตัวเลือก) และจากแพลตฟอร์ม (มีรหัสตัวเลือก):
  --   ถือเป็นบรรทัดเดียวกันเมื่อ SKU ตรงกัน — สต๊อกที่ตัดไปแล้วตามบรรทัดไปด้วย จึงไม่ตัดซ้ำไม่ว่ามาทางไหนก่อน
  for r in
    select * from jsonb_to_recordset(v_norm)
      as x(line_key text, sku_id text, item_id text, sku text, name text, qty integer, qc integer, qr integer, price numeric)
  loop
    select l.* into v_old
      from public.channel_order_lines as l
     where l.order_id = v_order_id and l.line_key = r.line_key;
    v_found := found;

    if not v_found then
      v_line_sku := nullif(lower(public.product_clean_text(r.sku)), '');
      if r.sku_id is not null then
        -- บรรทัดจากแพลตฟอร์ม: เคยนำเข้าออเดอร์นี้จาก CSV → ย้ายบรรทัดนั้นมาใช้รหัสของแพลตฟอร์ม
        if v_line_sku is null then
          select cl.external_sku_norm into v_line_sku
            from public.channel_listings as cl
           where cl.channel_id = c.id and cl.external_sku_id = r.sku_id;
        end if;
        if v_line_sku is not null then
          select l.* into v_old
            from public.channel_order_lines as l
           where l.order_id = v_order_id and l.line_key = 'sku:' || v_line_sku and l.external_sku_id is null;
          v_found := found;
          if v_found then
            v_listing := public.integration_resolve_listing(c.id, r.sku_id, r.item_id, r.sku, r.name);
            update public.channel_order_lines as l
               set line_key = r.line_key,
                   external_sku_id = r.sku_id,
                   external_item_id = coalesce(r.item_id, l.external_item_id),
                   listing_id = v_listing
             where l.id = v_old.id
            returning l.* into v_old;
            v_lines_changed := v_lines_changed + 1;
          end if;
        end if;
      elsif v_line_sku is not null and r.line_key = 'sku:' || v_line_sku then
        -- บรรทัดจาก CSV (มีแต่ SKU): แพลตฟอร์มส่งออเดอร์นี้มาแล้ว → ใช้บรรทัดของแพลตฟอร์มที่ SKU ตรงกัน
        select count(*) into v_same
          from public.channel_order_lines as l
         where l.order_id = v_order_id
           and l.external_sku_id is not null
           and (lower(public.product_clean_text(l.external_sku)) = v_line_sku
                or exists (select 1 from public.channel_listings as cl
                            where cl.id = l.listing_id and cl.external_sku_norm = v_line_sku));
        if v_same = 1 then
          select l.* into v_old
            from public.channel_order_lines as l
           where l.order_id = v_order_id
             and l.external_sku_id is not null
             and (lower(public.product_clean_text(l.external_sku)) = v_line_sku
                  or exists (select 1 from public.channel_listings as cl
                              where cl.id = l.listing_id and cl.external_sku_norm = v_line_sku));
          v_found := true;
        elsif v_same > 1 then
          -- แพลตฟอร์มแยก SKU นี้เป็นหลายบรรทัด (หลายตัวเลือก) — ข้อมูลของแพลตฟอร์มละเอียดกว่า ไม่เพิ่มบรรทัดซ้ำ
          continue;
        end if;
      end if;
    end if;

    if not v_found then
      v_listing := public.integration_resolve_listing(c.id, r.sku_id, r.item_id, r.sku, r.name);
      insert into public.channel_order_lines
        (order_id, line_key, external_item_id, external_sku_id, external_sku, external_name, listing_id, product_id,
         qty, qty_cancelled, platform_qty_returned, unit_price)
      values
        (v_order_id, r.line_key, r.item_id, r.sku_id, r.sku, r.name, v_listing,
         (select cl.product_id from public.channel_listings as cl where cl.id = v_listing and cl.mapping_status = 'mapped'),
         r.qty, r.qc, r.qr, r.price);
      v_lines_changed := v_lines_changed + 1;
    else
      if (v_old.qty, v_old.qty_cancelled, v_old.platform_qty_returned) is distinct from (r.qty, r.qc, r.qr)
         or (r.price is not null and v_old.unit_price is distinct from r.price) then
        v_lines_changed := v_lines_changed + 1;
      end if;
      update public.channel_order_lines as l
         set qty = r.qty,
             qty_cancelled = r.qc,
             platform_qty_returned = r.qr,
             qty_returned_received = least(l.qty_returned_received, r.qty),
             qty_waived = least(l.qty_waived, r.qty),
             unit_price = coalesce(r.price, l.unit_price),
             external_item_id = coalesce(r.item_id, l.external_item_id),
             external_sku_id = coalesce(r.sku_id, l.external_sku_id),
             external_sku = coalesce(r.sku, l.external_sku),
             external_name = coalesce(r.name, l.external_name)
       where l.id = v_old.id
         and ((l.qty, l.qty_cancelled, l.platform_qty_returned) is distinct from (r.qty, r.qc, r.qr)
              or (r.price is not null and l.unit_price is distinct from r.price)
              or (r.item_id is not null and l.external_item_id is distinct from r.item_id)
              or (r.sku_id is not null and l.external_sku_id is distinct from r.sku_id)
              or (r.sku is not null and l.external_sku is distinct from r.sku)
              or (r.name is not null and l.external_name is distinct from r.name));
    end if;
  end loop;

  perform public.channel_order_resolve_products(v_order_id);
  v_apply := public.channel_order_apply(v_order_id, null);

  -- ----- บันทึกการซิงก์ (เฉพาะเมื่อมีผลกับสต๊อกหรือมีเรื่องต้องดูแล) -----
  select coalesce(sum(l.qty_oversold), 0), count(*) filter (where l.product_id is null and l.qty - l.qty_cancelled > 0)
    into v_oversold, v_unmapped
    from public.channel_order_lines as l
   where l.order_id = v_order_id;
  if v_is_new or (v_apply ->> 'deducted')::integer > 0 or (v_apply ->> 'restocked')::integer > 0
     or v_old_status is distinct from v_status then
    v_summary := 'ออเดอร์ ' || public.integration_platform_label(c.platform) || ' #' || v_ext || ' (' || v_status || ')'
                 || case when (v_apply ->> 'deducted')::integer > 0 then ' ตัดสต๊อก ' || (v_apply ->> 'deducted') || ' ชิ้น' else '' end
                 || case when (v_apply ->> 'restocked')::integer > 0 then ' คืนสต๊อก ' || (v_apply ->> 'restocked') || ' ชิ้น' else '' end
                 || case when v_oversold > 0 then ' ขายเกิน ' || v_oversold || ' ชิ้น' else '' end
                 || case when v_unmapped > 0 then ' จับคู่สินค้าไม่ได้ ' || v_unmapped || ' รายการ' else '' end
                 || case when (v_apply ->> 'shadow_would_deduct')::integer > 0
                         then ' [โหมดทดลอง: จะตัด ' || (v_apply ->> 'shadow_would_deduct') || ' ชิ้น]' else '' end;
    perform public.integration_log(c.id, 'order', v_oversold = 0 and v_unmapped = 0, v_summary,
      jsonb_build_object('order_id', v_order_id, 'external_order_id', v_ext, 'status', v_status,
                         'previous_status', v_old_status, 'source', v_source,
                         'deducted', (v_apply ->> 'deducted')::integer, 'restocked', (v_apply ->> 'restocked')::integer,
                         'oversold', v_oversold, 'unmapped_lines', v_unmapped),
      null, null);
  end if;

  return public.integration_order_json(v_order_id)
         || jsonb_build_object(
              'created', v_is_new,
              'stale', false,
              'changed', v_is_new or v_lines_changed > 0 or v_old_status is distinct from v_status
                         or (v_apply ->> 'deducted')::integer > 0 or (v_apply ->> 'restocked')::integer > 0,
              'deducted', (v_apply ->> 'deducted')::integer,
              'restocked', (v_apply ->> 'restocked')::integer,
              'shadow_would_deduct', (v_apply ->> 'shadow_would_deduct')::integer,
              'applied_lines', v_apply -> 'lines');
end;
$$;

-- ----- cancel_channel_order: แพลตฟอร์มแจ้งยกเลิก/หมดอายุ โดยไม่มีรายละเอียดทั้งออเดอร์ -----
--   ก่อนส่งของ → คืนสต๊อกอัตโนมัติ / ส่งของแล้ว (p_was_shipped หรือเคยเห็นสถานะส่งแล้ว) → รอแอดมินยืนยันรับของคืน
--   ออเดอร์ที่ไม่เคยเห็น → {"found": false} (ไม่มีอะไรต้องคืน)
create or replace function public.cancel_channel_order(
  p_channel_id uuid,
  p_external_order_id text,
  p_status text default 'cancelled',
  p_raw_status text default null,
  p_was_shipped boolean default null,
  p_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.channel_orders%rowtype;
  v_status text;
  v_apply jsonb;
  v_ext text;
begin
  perform public.integration_require(false);
  v_status := coalesce(nullif(btrim(p_status), ''), 'cancelled');
  if v_status not in ('cancelled', 'expired') then
    raise exception 'cancel_channel_order รับได้เฉพาะสถานะ cancelled หรือ expired';
  end if;
  v_ext := nullif(btrim(p_external_order_id), '');
  if p_channel_id is null or v_ext is null then
    raise exception 'ไม่ได้ระบุช่องทางหรือเลขออเดอร์';
  end if;
  select * into o
    from public.channel_orders as co
   where co.channel_id = p_channel_id and co.external_order_id = v_ext
     for update;
  if not found then
    return jsonb_build_object('found', false, 'external_order_id', v_ext);
  end if;
  if p_updated_at is not null and o.platform_updated_at is not null and p_updated_at < o.platform_updated_at then
    return public.integration_order_json(o.id)
           || jsonb_build_object('found', true, 'stale', true, 'deducted', 0, 'restocked', 0);
  end if;

  update public.channel_orders as co
     set status = v_status,
         raw_status = coalesce(left(nullif(btrim(p_raw_status), ''), 100), co.raw_status),
         platform_updated_at = greatest(co.platform_updated_at, p_updated_at),
         shipped_at = case when coalesce(p_was_shipped, false) then coalesce(co.shipped_at, now()) else co.shipped_at end,
         last_source = 'webhook'
   where co.id = o.id;

  v_apply := public.channel_order_apply(o.id, null);
  if o.status is distinct from v_status or (v_apply ->> 'restocked')::integer > 0 then
    perform public.integration_log(o.channel_id, 'order', true,
      'ออเดอร์ #' || v_ext || ' ' || case when v_status = 'expired' then 'หมดอายุ' else 'ถูกยกเลิก' end
      || case when (v_apply ->> 'restocked')::integer > 0 then ' คืนสต๊อก ' || (v_apply ->> 'restocked') || ' ชิ้น'
              else '' end,
      jsonb_build_object('order_id', o.id, 'status', v_status, 'previous_status', o.status,
                         'restocked', (v_apply ->> 'restocked')::integer),
      null, null);
  end if;
  return public.integration_order_json(o.id)
         || jsonb_build_object('found', true, 'stale', false,
                               'deducted', (v_apply ->> 'deducted')::integer,
                               'restocked', (v_apply ->> 'restocked')::integer);
end;
$$;

-- ----- คิวส่งสต๊อก -----
-- claim_outbox: จองงานที่ถึงเวลา (ช่องทางเชื่อมต่ออยู่ ไม่ถูกพัก ไม่มี event ขาเข้าค้าง ไม่มีงานของสินค้าเดียวกันกำลังส่ง)
--   lease p_lease_seconds วินาที — worker ตายกลางทาง งานกลับมาเอง; งานที่ไม่ต้องส่งแล้ว (ยกเลิกจับคู่/ปิดส่ง) = skipped
--   คืน [{id, channel_id, platform, product_id, sku, qty, stock_qty, owed_qty, reason, attempts, listing:{...}}]
create or replace function public.claim_outbox(
  p_limit integer default 50,
  p_worker text default null,
  p_channel_id uuid default null,
  p_lease_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker text;
  v_limit integer;
  v_lease integer;
  v_ids bigint[];
  r record;
  v_jobs jsonb := '[]'::jsonb;
  v_opts jsonb;
  v_owed integer;
  v_skip text;
begin
  perform public.integration_require(false);
  v_worker := left(coalesce(nullif(btrim(p_worker), ''), 'worker'), 100);
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_lease := least(greatest(coalesce(p_lease_seconds, 60), 10), 600);

  -- งานที่ worker เดิมจองไว้แต่หมดเวลา: มีงานใหม่ของคู่เดียวกันรออยู่แล้ว = ทิ้ง (งานใหม่อ่านสต๊อกล่าสุดเอง) / ไม่งั้นคืนเข้าคิว
  update public.stock_sync_outbox as o
     set status = 'skipped', done_at = now(), locked_until = null,
         last_error = 'หมดเวลาระหว่างส่ง — มีงานใหม่ของสินค้านี้แทนแล้ว'
   where o.status = 'processing' and o.locked_until < now()
     and exists (select 1 from public.stock_sync_outbox as x
                  where x.channel_id = o.channel_id and x.product_id = o.product_id and x.status in ('pending', 'failed'));
  update public.stock_sync_outbox as o
     set status = 'pending', locked_until = null, locked_by = null, next_attempt_at = now(),
         last_error = 'หมดเวลาระหว่างส่ง (worker ไม่ตอบ) — ลองใหม่'
   where o.status = 'processing' and o.locked_until < now();

  with cand as (
    select o.id
      from public.stock_sync_outbox as o
      join public.integration_channels as c on c.id = o.channel_id
     where o.status in ('pending', 'failed')
       and o.next_attempt_at <= now()
       and (p_channel_id is null or o.channel_id = p_channel_id)
       and c.status = 'connected'
       and coalesce(c.paused_until, '-infinity'::timestamptz) <= now()
       and not exists (select 1 from public.stock_sync_outbox as x
                        where x.channel_id = o.channel_id and x.product_id = o.product_id and x.status = 'processing')
       and not exists (select 1 from public.integration_inbound_events as e
                        where e.channel_id = o.channel_id and e.status in ('pending', 'processing')
                          and e.next_attempt_at <= now())
     order by o.next_attempt_at, o.id
     limit v_limit
       for update of o skip locked
  )
  , claimed as (
    update public.stock_sync_outbox as o
       set status = 'processing',
           locked_until = now() + make_interval(secs => v_lease),
           locked_by = v_worker
      from cand
     where o.id = cand.id
    returning o.id
  )
  select coalesce(array_agg(claimed.id), '{}'::bigint[]) into v_ids from claimed;

  for r in
    select o.id, o.channel_id, o.product_id, o.reason, o.attempts,
           c.platform, c.options, c.status as channel_status,
           l.id as listing_id, l.external_item_id, l.external_sku_id, l.external_sku, l.external_inventory_id,
           l.extra, l.platform_qty, l.platform_reserved, l.last_pushed_qty, l.push_enabled, l.buffer_override,
           l.mapping_status,
           p.sku, p.stock_qty, p.is_active, p.is_archived
      from public.stock_sync_outbox as o
      join public.integration_channels as c on c.id = o.channel_id
      left join public.channel_listings as l
        on l.channel_id = o.channel_id and l.product_id = o.product_id and l.mapping_status = 'mapped'
      left join public.products as p on p.id = o.product_id
     where o.id = any (v_ids)
     order by o.channel_id, o.id
  loop
    v_opts := public.integration_channel_options(r.platform, r.options);
    v_skip := case
                when r.listing_id is null then 'ไม่มีรายการที่จับคู่กับสินค้านี้แล้ว'
                when not r.push_enabled then 'ปิดการส่งสต๊อกของรายการนี้'
                when r.platform = 'generic' then 'ช่องทางนี้ส่งสต๊อกผ่าน API ไม่ได้'
                when r.external_sku_id like 'sku:%' then 'รายการนี้มาจากไฟล์ CSV (ไม่มีรหัสสินค้าบนแพลตฟอร์ม) — ส่งสต๊อกไม่ได้'
                when (v_opts -> 'push_stock') <> 'true'::jsonb then 'ช่องทางปิด "ส่งสต๊อก" อยู่'
                when (v_opts -> 'initial_push_done') <> 'true'::jsonb then 'ยังไม่ได้ยืนยัน "ส่งสต๊อกครั้งแรก"'
                when r.sku is null then 'ไม่พบสินค้า'
              end;
    if v_skip is not null then
      update public.stock_sync_outbox as o
         set status = 'skipped', done_at = now(), locked_until = null, last_error = v_skip
       where o.id = r.id;
      continue;
    end if;
    v_owed := public.integration_owed_qty(r.product_id);
    v_jobs := v_jobs || jsonb_build_array(jsonb_build_object(
      'id', r.id,
      'channel_id', r.channel_id,
      'platform', r.platform,
      'product_id', r.product_id,
      'sku', r.sku,
      'qty', public.integration_push_qty(v_opts, r.buffer_override, r.stock_qty, r.is_active, r.is_archived, v_owed),
      'stock_qty', r.stock_qty,
      'owed_qty', v_owed,
      'reason', r.reason,
      'attempts', r.attempts,
      'listing', jsonb_build_object(
        'id', r.listing_id,
        'external_item_id', r.external_item_id,
        'external_sku_id', r.external_sku_id,
        'external_sku', r.external_sku,
        'external_inventory_id', r.external_inventory_id,
        'extra', r.extra,
        'platform_qty', r.platform_qty,
        'platform_reserved', r.platform_reserved,
        'last_pushed_qty', r.last_pushed_qty)));
  end loop;
  return v_jobs;
end;
$$;

-- complete_outbox: ส่งสำเร็จ — p_results = [{"id": 1, "pushed_qty": 5, "platform_qty": 5}] (platform_qty ไม่บังคับ)
--   งานที่ไม่ได้อยู่ในมือ worker นี้แล้ว (lease หมดแล้วถูกจองใหม่) = lost ไม่แก้อะไร
create or replace function public.complete_outbox(p_worker text, p_results jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker text;
  v_elem jsonb;
  v_id bigint;
  v_qty integer;
  v_pqty integer;
  v_row public.stock_sync_outbox%rowtype;
  v_done integer := 0;
  v_lost jsonb := '[]'::jsonb;
begin
  perform public.integration_require(false);
  v_worker := left(coalesce(nullif(btrim(p_worker), ''), 'worker'), 100);
  if p_results is null or jsonb_typeof(p_results) <> 'array' then
    raise exception 'p_results ต้องเป็น JSON array';
  end if;
  for v_elem in select e.elem from jsonb_array_elements(p_results) as e(elem) loop
    v_id := public.integration_json_int(v_elem -> 'id', 'รหัสงาน', 1, 2147483647);
    v_qty := public.integration_json_int(v_elem -> 'pushed_qty', 'จำนวนที่ส่ง', 0, 100000000);
    v_pqty := public.integration_json_int(v_elem -> 'platform_qty', 'จำนวนบนแพลตฟอร์ม', -1000000000, 1000000000);
    update public.stock_sync_outbox as o
       set status = 'done', done_at = now(), locked_until = null, pushed_qty = v_qty, last_error = null
     where o.id = v_id and o.status = 'processing' and o.locked_by = v_worker
    returning o.* into v_row;
    if not found then
      v_lost := v_lost || to_jsonb(v_id);
      continue;
    end if;
    v_done := v_done + 1;
    update public.channel_listings as l
       set last_pushed_qty = v_qty,
           last_pushed_at = now(),
           last_error = null,
           last_error_at = null,
           platform_qty = coalesce(v_pqty, v_qty, l.platform_qty),
           platform_qty_at = case when v_pqty is not null or v_qty is not null then now() else l.platform_qty_at end
     where l.channel_id = v_row.channel_id and l.product_id = v_row.product_id;
    update public.integration_channels as c
       set last_stock_push_at = now(), last_sync_at = now(), consecutive_failures = 0
     where c.id = v_row.channel_id;
  end loop;
  return jsonb_build_object('completed', v_done, 'lost', v_lost);
end;
$$;

-- fail_outbox: ส่งไม่สำเร็จ — p_failures = [{"id": 1, "error": "...", "permanent": false, "retry_after_seconds": 30}]
--   ชั่วคราว → failed + รอ min(30 วิ × 2^(ครั้งที่−1), 1 ชม.) (หรือ Retry-After ถ้ามากกว่า) / ถาวร หรือครบ 8 ครั้ง → dead
create or replace function public.fail_outbox(p_worker text, p_failures jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker text;
  v_elem jsonb;
  v_id bigint;
  v_err text;
  v_perm boolean;
  v_retry integer;
  v_row public.stock_sync_outbox%rowtype;
  v_delay integer;
  v_items jsonb := '[]'::jsonb;
  v_lost jsonb := '[]'::jsonb;
  v_retry_n integer := 0;
  v_dead_n integer := 0;
begin
  perform public.integration_require(false);
  v_worker := left(coalesce(nullif(btrim(p_worker), ''), 'worker'), 100);
  if p_failures is null or jsonb_typeof(p_failures) <> 'array' then
    raise exception 'p_failures ต้องเป็น JSON array';
  end if;
  for v_elem in select e.elem from jsonb_array_elements(p_failures) as e(elem) loop
    v_id := public.integration_json_int(v_elem -> 'id', 'รหัสงาน', 1, 2147483647);
    v_err := left(coalesce(nullif(btrim(v_elem ->> 'error'), ''), 'ส่งสต๊อกไม่สำเร็จ'), 1000);
    v_perm := coalesce(public.product_json_bool(v_elem -> 'permanent', 'permanent'), false);
    v_retry := public.integration_json_int(v_elem -> 'retry_after_seconds', 'retry_after_seconds', 0, 86400);

    select * into v_row
      from public.stock_sync_outbox as o
     where o.id = v_id and o.status = 'processing' and o.locked_by = v_worker
       for update;
    if not found then
      v_lost := v_lost || to_jsonb(v_id);
      continue;
    end if;
    v_delay := greatest(coalesce(v_retry, 0), least(3600, (30 * power(2, least(v_row.attempts, 12)))::integer));
    if v_perm or v_row.attempts + 1 >= 8 then
      update public.stock_sync_outbox as o
         set status = 'dead', attempts = o.attempts + 1, locked_until = null, done_at = now(), last_error = v_err
       where o.id = v_id
      returning o.* into v_row;
      v_dead_n := v_dead_n + 1;
    elsif exists (select 1 from public.stock_sync_outbox as x
                   where x.channel_id = v_row.channel_id and x.product_id = v_row.product_id
                     and x.status in ('pending', 'failed')) then
      -- สต๊อกเปลี่ยนอีกระหว่างส่ง (มีงานใหม่ของคู่เดียวกันรออยู่แล้ว): งานนี้ = skipped
      -- แล้วโอน backoff + จำนวนครั้งไปให้งานใหม่ (กันยิงถี่ตอนแพลตฟอร์มล่ม และยังตายได้เมื่อครบ 8 ครั้ง)
      update public.stock_sync_outbox as x
         set attempts = greatest(x.attempts, v_row.attempts + 1),
             next_attempt_at = greatest(x.next_attempt_at, now() + make_interval(secs => v_delay)),
             last_error = v_err
       where x.channel_id = v_row.channel_id and x.product_id = v_row.product_id
         and x.status in ('pending', 'failed');
      update public.stock_sync_outbox as o
         set status = 'skipped', attempts = o.attempts + 1, locked_until = null, done_at = now(),
             last_error = left(v_err || ' (มีงานใหม่ของสินค้านี้รออยู่ — ลองใหม่ในงานนั้น)', 1000)
       where o.id = v_id
      returning o.* into v_row;
      v_retry_n := v_retry_n + 1;
    else
      update public.stock_sync_outbox as o
         set status = 'failed', attempts = o.attempts + 1, locked_until = null,
             next_attempt_at = now() + make_interval(secs => v_delay), last_error = v_err
       where o.id = v_id
      returning o.* into v_row;
      v_retry_n := v_retry_n + 1;
    end if;
    update public.channel_listings as l
       set last_error = v_err, last_error_at = now()
     where l.channel_id = v_row.channel_id and l.product_id = v_row.product_id;
    update public.integration_channels as c
       set consecutive_failures = c.consecutive_failures + 1, last_error = v_err, last_error_at = now()
     where c.id = v_row.channel_id;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'id', v_row.id, 'status', v_row.status, 'attempts', v_row.attempts,
      'next_attempt_at', case when v_row.status = 'failed' then v_row.next_attempt_at end));
  end loop;
  return jsonb_build_object('retry', v_retry_n, 'dead', v_dead_n, 'lost', v_lost, 'items', v_items);
end;
$$;

-- ----- รายการสินค้าจากแพลตฟอร์ม -----
-- upsert_channel_listings: นำเข้ารายการ (ทีละหน้า ≤ 500 แถว) แล้วจับคู่อัตโนมัติ
--   p_rows = [{"sku_id","item_id","sku","inventory_id","name","variant_name","status","qty","reserved","extra"}]
create or replace function public.upsert_channel_listings(p_channel_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_elem jsonb;
  v_n integer := 0;
  v_match jsonb;
begin
  perform public.integration_require(false);
  if not exists (select 1 from public.integration_channels as c where c.id = p_channel_id) then
    raise exception 'ไม่พบช่องทางนี้';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows ต้องเป็น JSON array';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'ส่งรายการได้ครั้งละไม่เกิน 500 แถว';
  end if;
  for v_elem in select e.elem from jsonb_array_elements(p_rows) as e(elem) loop
    perform public.integration_listing_upsert(p_channel_id, v_elem, true);
    v_n := v_n + 1;
  end loop;
  v_match := public.integration_auto_match(p_channel_id, null);
  update public.integration_channels as c set last_catalog_sync_at = now() where c.id = p_channel_id;
  return jsonb_build_object('received', v_n) || v_match;
end;
$$;

-- mark_missing_listings_gone: หลังดึงรายการครบทุกหน้า — รายการที่ไม่เห็นตั้งแต่ p_seen_before = หายจากแพลตฟอร์ม (หยุดส่ง)
create or replace function public.mark_missing_listings_gone(p_channel_id uuid, p_seen_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  perform public.integration_require(false);
  if p_channel_id is null or p_seen_before is null then
    raise exception 'ต้องระบุช่องทางและเวลาเริ่มดึงรายการ';
  end if;
  update public.channel_listings as l
     set mapping_status = 'gone', product_id = null, match_source = null
   where l.channel_id = p_channel_id
     and l.mapping_status <> 'gone'
     and l.external_sku_id not like 'sku:%'           -- รายการแทนจาก CSV ไม่เคยอยู่ในรายการสินค้าของแพลตฟอร์ม
     and (l.last_seen_at is null or l.last_seen_at < p_seen_before);
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform public.integration_log(p_channel_id, 'catalog', true,
      'รายการที่หายจากแพลตฟอร์ม ' || v_n || ' รายการ (หยุดส่งสต๊อกให้รายการเหล่านี้)', null, null, null);
  end if;
  return v_n;
end;
$$;

-- ----- log_integration: เซิร์ฟเวอร์บันทึกการซิงก์ (ตัดความลับ/ข้อมูลผู้ซื้อให้อีกชั้น) -----
create or replace function public.log_integration(
  p_channel_id uuid,
  p_kind text,
  p_ok boolean,
  p_summary text,
  p_detail jsonb default null,
  p_actor uuid default null,
  p_duration_ms integer default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.integration_require(false);
  return public.integration_log(p_channel_id, p_kind, p_ok, p_summary, p_detail, p_actor, p_duration_ms);
end;
$$;

-- ----- เหตุการณ์ขาเข้า (webhook) -----
-- record_inbound_event: เก็บ event (กันซ้ำด้วย ช่องทาง + event_id) — ซ้ำ = {"duplicate": true}
create or replace function public.record_inbound_event(
  p_channel_id uuid,
  p_event_id text,
  p_event_type text default null,
  p_external_order_id text default null,
  p_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_status text;
  v_event text;
  v_payload jsonb;
begin
  perform public.integration_require(false);
  v_event := nullif(btrim(p_event_id), '');
  if p_channel_id is null or v_event is null then
    raise exception 'ต้องระบุช่องทางและรหัส event';
  end if;
  if char_length(v_event) > 200 then
    raise exception 'รหัส event ยาวเกินไป';
  end if;
  if not exists (select 1 from public.integration_channels as c where c.id = p_channel_id) then
    raise exception 'ไม่พบช่องทางนี้';
  end if;
  v_payload := public.integration_strip(p_payload, 0);
  if v_payload is not null and octet_length(v_payload::text) > 262144 then
    raise exception 'ข้อมูล event ใหญ่เกินไป (สูงสุด 256 KB)';
  end if;
  insert into public.integration_inbound_events as e (channel_id, event_id, event_type, external_order_id, payload)
  values (p_channel_id, v_event, left(nullif(btrim(p_event_type), ''), 100),
          left(nullif(btrim(p_external_order_id), ''), 100), v_payload)
  on conflict (channel_id, event_id) do nothing
  returning e.id, e.status into v_id, v_status;
  if found then
    return jsonb_build_object('id', v_id, 'duplicate', false, 'status', v_status);
  end if;
  select e.id, e.status into v_id, v_status
    from public.integration_inbound_events as e
   where e.channel_id = p_channel_id and e.event_id = v_event;
  return jsonb_build_object('id', v_id, 'duplicate', true, 'status', v_status);
end;
$$;

-- claim_inbound_events: จอง event ที่ถึงเวลา (ตามลำดับที่ได้รับ) — lease p_lease_seconds วินาที
create or replace function public.claim_inbound_events(
  p_limit integer default 20,
  p_worker text default null,
  p_channel_id uuid default null,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker text;
  v_limit integer;
  v_lease integer;
  v_out jsonb;
begin
  perform public.integration_require(false);
  v_worker := left(coalesce(nullif(btrim(p_worker), ''), 'worker'), 100);
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 200);
  v_lease := least(greatest(coalesce(p_lease_seconds, 120), 10), 600);

  update public.integration_inbound_events as e
     set status = 'pending', locked_until = null, locked_by = null, next_attempt_at = now(),
         last_error = 'หมดเวลาระหว่างประมวลผล (worker ไม่ตอบ) — ลองใหม่'
   where e.status = 'processing' and e.locked_until < now();

  with cand as (
    select e.id
      from public.integration_inbound_events as e
     where e.status in ('pending', 'failed')
       and e.next_attempt_at <= now()
       and (p_channel_id is null or e.channel_id = p_channel_id)
     order by e.id
     limit v_limit
       for update skip locked
  ),
  claimed as (
    update public.integration_inbound_events as e
       set status = 'processing',
           locked_until = now() + make_interval(secs => v_lease),
           locked_by = v_worker
      from cand
     where e.id = cand.id
    returning e.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', cl.id,
           'channel_id', cl.channel_id,
           'platform', c.platform,
           'event_id', cl.event_id,
           'event_type', cl.event_type,
           'external_order_id', cl.external_order_id,
           'payload', cl.payload,
           'attempts', cl.attempts,
           'received_at', cl.received_at) order by cl.id), '[]'::jsonb)
    into v_out
    from claimed as cl
    join public.integration_channels as c on c.id = cl.channel_id;
  return v_out;
end;
$$;

-- complete_inbound_event: ประมวลผลเสร็จ (done) หรือไม่ต้องทำอะไร (ignored เช่น ช่องทางปิด "ดึงออเดอร์")
create or replace function public.complete_inbound_event(
  p_id bigint,
  p_worker text,
  p_status text default 'done',
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform public.integration_require(false);
  v_status := coalesce(nullif(btrim(p_status), ''), 'done');
  if v_status not in ('done', 'ignored') then
    raise exception 'สถานะปิดงาน event ต้องเป็น done หรือ ignored';
  end if;
  update public.integration_inbound_events as e
     set status = v_status, processed_at = now(), locked_until = null,
         last_error = left(nullif(btrim(p_note), ''), 1000)
   where e.id = p_id and e.status = 'processing'
     and e.locked_by = left(coalesce(nullif(btrim(p_worker), ''), 'worker'), 100);
  return found;
end;
$$;

-- fail_inbound_event: ประมวลผลไม่สำเร็จ — backoff แบบเดียวกับคิวส่งสต๊อก / ครบ 8 ครั้ง หรือ permanent → dead
create or replace function public.fail_inbound_event(
  p_id bigint,
  p_worker text,
  p_error text,
  p_permanent boolean default false,
  p_retry_after_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.integration_inbound_events%rowtype;
  v_delay integer;
  v_err text;
begin
  perform public.integration_require(false);
  v_err := left(coalesce(nullif(btrim(p_error), ''), 'ประมวลผลไม่สำเร็จ'), 1000);
  select * into v_row
    from public.integration_inbound_events as e
   where e.id = p_id and e.status = 'processing'
     and e.locked_by = left(coalesce(nullif(btrim(p_worker), ''), 'worker'), 100)
     for update;
  if not found then
    return jsonb_build_object('id', p_id, 'lost', true);
  end if;
  v_delay := greatest(coalesce(p_retry_after_seconds, 0), least(3600, (30 * power(2, least(v_row.attempts, 12)))::integer));
  if coalesce(p_permanent, false) or v_row.attempts + 1 >= 8 then
    update public.integration_inbound_events as e
       set status = 'dead', attempts = e.attempts + 1, locked_until = null, processed_at = now(), last_error = v_err
     where e.id = p_id
    returning e.* into v_row;
    perform public.integration_log(v_row.channel_id, 'webhook', false,
      'ประมวลผล event ' || v_row.event_id || ' ไม่สำเร็จถาวร: ' || left(v_err, 200),
      jsonb_build_object('event_id', v_row.event_id, 'event_type', v_row.event_type,
                         'external_order_id', v_row.external_order_id, 'attempts', v_row.attempts),
      null, null);
  else
    update public.integration_inbound_events as e
       set status = 'failed', attempts = e.attempts + 1, locked_until = null,
           next_attempt_at = now() + make_interval(secs => v_delay), last_error = v_err
     where e.id = p_id
    returning e.* into v_row;
  end if;
  return jsonb_build_object('id', v_row.id, 'lost', false, 'status', v_row.status, 'attempts', v_row.attempts,
                            'next_attempt_at', case when v_row.status = 'failed' then v_row.next_attempt_at end);
end;
$$;

-- ----- OAuth state (Shopee / Lazada / TikTok) — เก็บเฉพาะ sha256(state) -----
create or replace function public.create_oauth_state(
  p_channel_id uuid,
  p_state_hash text,
  p_created_by uuid default null,
  p_ttl_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exp timestamptz;
begin
  perform public.integration_require(false);
  if p_state_hash is null or p_state_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'state_hash ต้องเป็น sha256 (hex ตัวเล็ก 64 ตัว)';
  end if;
  if not exists (select 1 from public.integration_channels as c
                  where c.id = p_channel_id and c.platform in ('shopee', 'lazada', 'tiktok')) then
    raise exception 'ช่องทางนี้ไม่ได้ใช้การเชื่อมต่อแบบ OAuth';
  end if;
  delete from public.integration_oauth_states as s where s.expires_at < now() - interval '1 day';
  v_exp := now() + make_interval(secs => least(greatest(coalesce(p_ttl_seconds, 600), 60), 1800));
  insert into public.integration_oauth_states (state_hash, channel_id, created_by, expires_at)
  values (p_state_hash, p_channel_id, p_created_by, v_exp);
  return jsonb_build_object('expires_at', v_exp);
end;
$$;

-- consume_oauth_state: ใช้ state ได้ครั้งเดียว (อะตอมมิก) — ผิด/หมดอายุ/ใช้แล้ว = null
create or replace function public.consume_oauth_state(p_state_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.integration_oauth_states%rowtype;
begin
  perform public.integration_require(false);
  if p_state_hash is null or p_state_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  update public.integration_oauth_states as s
     set used_at = now()
   where s.state_hash = p_state_hash and s.used_at is null and s.expires_at > now()
  returning s.* into v_row;
  if not found then
    return null;
  end if;
  return (select jsonb_build_object('channel_id', c.id, 'platform', c.platform, 'environment', c.environment,
                                    'created_by', v_row.created_by)
            from public.integration_channels as c
           where c.id = v_row.channel_id);
end;
$$;

-- ----- lease ต่อช่องทาง (ดึงออเดอร์ / ต่ออายุ token / ดึงรายการสินค้า) -----
create or replace function public.acquire_channel_lease(p_channel_id uuid, p_worker text, p_seconds integer default 60)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker text;
begin
  perform public.integration_require(false);
  v_worker := left(coalesce(nullif(btrim(p_worker), ''), 'worker'), 100);
  update public.integration_channels as c
     set lease_until = now() + make_interval(secs => least(greatest(coalesce(p_seconds, 60), 5), 600)),
         lease_owner = v_worker
   where c.id = p_channel_id
     and (c.lease_until is null or c.lease_until < now() or c.lease_owner = v_worker);
  return found;
end;
$$;

create or replace function public.release_channel_lease(p_channel_id uuid, p_worker text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.integration_require(false);
  update public.integration_channels as c
     set lease_until = null, lease_owner = null
   where c.id = p_channel_id and c.lease_owner = left(coalesce(nullif(btrim(p_worker), ''), 'worker'), 100);
  return found;
end;
$$;

-- ----- server_update_channel: เซิร์ฟเวอร์อัปเดตสถานะ/ข้อมูลร้าน/เวลา (เฉพาะคีย์ที่อนุญาต) -----
--   p_patch คีย์ที่รับ: status, status_reason, external_shop_id, external_shop_name, settings_merge (object),
--   settings_remove (array ของคีย์), token_expires_at, refresh_expires_at, auth_expires_at, next_token_check_at,
--   orders_cursor, last_sync_at, last_orders_sync_at, last_stock_push_at, last_catalog_sync_at,
--   last_test_ok (ตั้ง last_test_at = now()), last_error (null = ล้าง; ตั้ง last_error_at), consecutive_failures, paused_until
create or replace function public.server_update_channel(p_channel_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.integration_channels%rowtype;
  v_key text;
  v_status text;
  v_text text;
begin
  perform public.integration_require(false);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'p_patch ต้องเป็น JSON object';
  end if;
  select v_bad.key into v_key
    from jsonb_object_keys(p_patch) as v_bad(key)
   where v_bad.key not in ('status', 'status_reason', 'external_shop_id', 'external_shop_name', 'settings_merge',
                           'settings_remove', 'token_expires_at', 'refresh_expires_at', 'auth_expires_at',
                           'next_token_check_at', 'orders_cursor', 'last_sync_at', 'last_orders_sync_at',
                           'last_stock_push_at', 'last_catalog_sync_at', 'last_test_ok', 'last_error',
                           'consecutive_failures', 'paused_until')
   limit 1;
  if found then
    raise exception 'server_update_channel ไม่รู้จักคีย์ "%"', v_key;
  end if;

  select * into c from public.integration_channels as x where x.id = p_channel_id for update;
  if not found then
    raise exception 'ไม่พบช่องทางนี้';
  end if;

  if p_patch ? 'status' then
    v_status := public.product_json_text(p_patch -> 'status', 'status');
    if v_status is null or v_status not in ('disconnected', 'pending_approval', 'connected', 'error', 'paused') then
      raise exception 'สถานะช่องทางไม่ถูกต้อง: %', coalesce(v_status, 'ว่าง');
    end if;
    c.status := v_status;
  end if;
  if p_patch ? 'status_reason' then
    c.status_reason := left(public.product_json_text(p_patch -> 'status_reason', 'status_reason'), 100);
  end if;
  if p_patch ? 'external_shop_id' then
    c.external_shop_id := left(public.product_json_text(p_patch -> 'external_shop_id', 'external_shop_id'), 200);
  end if;
  if p_patch ? 'external_shop_name' then
    c.external_shop_name := left(public.product_json_text(p_patch -> 'external_shop_name', 'external_shop_name'), 200);
  end if;
  if p_patch ? 'settings_merge' then
    if jsonb_typeof(p_patch -> 'settings_merge') <> 'object' then
      raise exception 'settings_merge ต้องเป็น JSON object';
    end if;
    c.settings := c.settings || public.integration_strip(p_patch -> 'settings_merge', 0);
  end if;
  if p_patch ? 'settings_remove' then
    if jsonb_typeof(p_patch -> 'settings_remove') <> 'array' then
      raise exception 'settings_remove ต้องเป็น JSON array ของชื่อคีย์';
    end if;
    c.settings := c.settings - array(select jsonb_array_elements_text(p_patch -> 'settings_remove'));
  end if;
  if octet_length(c.settings::text) > 16000 then
    raise exception 'settings ของช่องทางใหญ่เกินไป';
  end if;
  if p_patch ? 'token_expires_at' then
    c.token_expires_at := public.integration_json_ts(p_patch -> 'token_expires_at', 'token_expires_at');
  end if;
  if p_patch ? 'refresh_expires_at' then
    c.refresh_expires_at := public.integration_json_ts(p_patch -> 'refresh_expires_at', 'refresh_expires_at');
  end if;
  if p_patch ? 'auth_expires_at' then
    c.auth_expires_at := public.integration_json_ts(p_patch -> 'auth_expires_at', 'auth_expires_at');
  end if;
  if p_patch ? 'next_token_check_at' then
    c.next_token_check_at := public.integration_json_ts(p_patch -> 'next_token_check_at', 'next_token_check_at');
  end if;
  if p_patch ? 'orders_cursor' then
    c.orders_cursor := public.integration_json_ts(p_patch -> 'orders_cursor', 'orders_cursor');
  end if;
  if p_patch ? 'last_sync_at' then
    c.last_sync_at := public.integration_json_ts(p_patch -> 'last_sync_at', 'last_sync_at');
  end if;
  if p_patch ? 'last_orders_sync_at' then
    c.last_orders_sync_at := public.integration_json_ts(p_patch -> 'last_orders_sync_at', 'last_orders_sync_at');
  end if;
  if p_patch ? 'last_stock_push_at' then
    c.last_stock_push_at := public.integration_json_ts(p_patch -> 'last_stock_push_at', 'last_stock_push_at');
  end if;
  if p_patch ? 'last_catalog_sync_at' then
    c.last_catalog_sync_at := public.integration_json_ts(p_patch -> 'last_catalog_sync_at', 'last_catalog_sync_at');
  end if;
  if p_patch ? 'last_test_ok' then
    c.last_test_ok := public.product_json_bool(p_patch -> 'last_test_ok', 'last_test_ok');
    c.last_test_at := now();
  end if;
  if p_patch ? 'last_error' then
    v_text := left(public.product_json_text(p_patch -> 'last_error', 'last_error'), 1000);
    c.last_error := v_text;
    c.last_error_at := case when v_text is null then null else now() end;
  end if;
  if p_patch ? 'consecutive_failures' then
    c.consecutive_failures := coalesce(public.integration_json_int(p_patch -> 'consecutive_failures',
                                                                    'consecutive_failures', 0, 1000000), 0);
  end if;
  if p_patch ? 'paused_until' then
    c.paused_until := public.integration_json_ts(p_patch -> 'paused_until', 'paused_until');
  end if;

  update public.integration_channels as x
     set status = c.status,
         status_reason = c.status_reason,
         external_shop_id = c.external_shop_id,
         external_shop_name = c.external_shop_name,
         settings = c.settings,
         token_expires_at = c.token_expires_at,
         refresh_expires_at = c.refresh_expires_at,
         auth_expires_at = c.auth_expires_at,
         next_token_check_at = c.next_token_check_at,
         orders_cursor = c.orders_cursor,
         last_sync_at = c.last_sync_at,
         last_orders_sync_at = c.last_orders_sync_at,
         last_stock_push_at = c.last_stock_push_at,
         last_catalog_sync_at = c.last_catalog_sync_at,
         last_test_ok = c.last_test_ok,
         last_test_at = c.last_test_at,
         last_error = c.last_error,
         last_error_at = c.last_error_at,
         consecutive_failures = c.consecutive_failures,
         paused_until = c.paused_until
   where x.id = c.id;
  return public.integration_channel_json(c.id, false);
end;
$$;

-- ----- ความลับ (เข้ารหัสแล้ว) — แอดมินอ่านไม่ได้ เซิร์ฟเวอร์เท่านั้น -----
-- save_integration_credentials: p_rows = [{"name","ciphertext","iv","tag","key_version","hint"}]
--   p_expected_versions = {"refresh_token": 3} (ไม่บังคับ) → version ปัจจุบันไม่ตรง = ไม่บันทึกอะไรเลย คืน {"ok": false, "conflict": [...]}
create or replace function public.save_integration_credentials(
  p_channel_id uuid,
  p_rows jsonb,
  p_expected_versions jsonb default null,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_elem jsonb;
  v_name text;
  v_conflict jsonb := '[]'::jsonb;
  v_versions jsonb := '{}'::jsonb;
  v_ver bigint;
begin
  perform public.integration_require(false);
  if not exists (select 1 from public.integration_channels as c where c.id = p_channel_id) then
    raise exception 'ไม่พบช่องทางนี้';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'p_rows ต้องเป็น JSON array ที่มีอย่างน้อย 1 รายการ';
  end if;
  if jsonb_array_length(p_rows) > 30 then
    raise exception 'บันทึกความลับได้ครั้งละไม่เกิน 30 รายการ';
  end if;
  if p_expected_versions is not null and jsonb_typeof(p_expected_versions) <> 'object' then
    raise exception 'p_expected_versions ต้องเป็น JSON object';
  end if;

  -- ล็อกทุกแถวของช่องทางนี้ก่อน (สองงานต่ออายุ token พร้อมกัน → งานหลังเห็น version ใหม่)
  perform 1 from public.integration_credentials as k where k.channel_id = p_channel_id order by k.name for update;

  if p_expected_versions is not null then
    select coalesce(jsonb_agg(e.key), '[]'::jsonb) into v_conflict
      from jsonb_each(p_expected_versions) as e
     where coalesce((select k.version from public.integration_credentials as k
                      where k.channel_id = p_channel_id and k.name = e.key), 0)
           is distinct from public.integration_json_int(e.value, 'expected version', 0, 2147483647)::bigint;
    if jsonb_array_length(v_conflict) > 0 then
      return jsonb_build_object('ok', false, 'conflict', v_conflict);
    end if;
  end if;

  for v_elem in select e.elem from jsonb_array_elements(p_rows) as e(elem) loop
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'รูปแบบความลับไม่ถูกต้อง';
    end if;
    v_name := v_elem ->> 'name';
    insert into public.integration_credentials as k
      (channel_id, name, ciphertext, iv, tag, key_version, hint, version, updated_at, updated_by)
    values
      (p_channel_id, v_name, v_elem ->> 'ciphertext', v_elem ->> 'iv', v_elem ->> 'tag',
       coalesce(public.integration_json_int(v_elem -> 'key_version', 'key_version', 1, 32767), 1)::smallint,
       left(nullif(v_elem ->> 'hint', ''), 80), 1, now(), p_actor)
    on conflict (channel_id, name) do update
      set ciphertext = excluded.ciphertext,
          iv = excluded.iv,
          tag = excluded.tag,
          key_version = excluded.key_version,
          hint = excluded.hint,
          version = k.version + 1,
          updated_at = now(),
          updated_by = excluded.updated_by
    returning k.version into v_ver;
    v_versions := v_versions || jsonb_build_object(v_name, v_ver);
  end loop;
  return jsonb_build_object('ok', true, 'versions', v_versions);
end;
$$;

create or replace function public.get_integration_credentials(p_channel_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.integration_require(false);
  return coalesce(
    (select jsonb_agg(jsonb_build_object(
              'name', k.name, 'ciphertext', k.ciphertext, 'iv', k.iv, 'tag', k.tag, 'key_version', k.key_version,
              'hint', k.hint, 'version', k.version, 'updated_at', k.updated_at) order by k.name)
       from public.integration_credentials as k
      where k.channel_id = p_channel_id),
    '[]'::jsonb);
end;
$$;

create or replace function public.delete_integration_credentials(p_channel_id uuid, p_names text[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  perform public.integration_require(false);
  delete from public.integration_credentials as k
   where k.channel_id = p_channel_id and (p_names is null or k.name = any (p_names));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ----- ลิงก์ฟีดสินค้า (Meta / Google / เว็บอื่น) -----
-- set_feed_token: เก็บ sha256 ของโทเคนใหม่ (null = ปิดลิงก์) — ตัวโทเคนเข้ารหัสเก็บเป็นความลับชื่อ 'feed_token'
create or replace function public.set_feed_token(p_channel_id uuid, p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.integration_require(false);
  if p_token_hash is not null and p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token hash ต้องเป็น sha256 (hex ตัวเล็ก 64 ตัว)';
  end if;
  update public.integration_channels as c
     set feed_token_hash = p_token_hash,
         feed_token_rotated_at = case when p_token_hash is null then null else now() end
   where c.id = p_channel_id and c.platform in ('meta', 'generic');
  if not found then
    raise exception 'ลิงก์ฟีดใช้ได้เฉพาะช่องทาง Facebook/Instagram หรือช่องทางอื่น';
  end if;
  perform public.integration_log(p_channel_id, 'feed', true,
    case when p_token_hash is null then 'ปิดลิงก์ฟีดสินค้า' else 'สร้างลิงก์ฟีดสินค้าใหม่ (ลิงก์เดิมใช้ไม่ได้แล้ว)' end,
    null, auth.uid(), null);
  return public.integration_channel_json(p_channel_id, false);
end;
$$;

-- get_feed_items: ข้อมูลแค็ตตาล็อกสาธารณะของลิงก์ฟีด (ไม่มีต้นทุน ไม่มีสต๊อกจริง — มีแค่จำนวนที่ขายได้หลังหัก buffer)
--   โทเคนผิด/ถูกหมุนแล้ว/ตัดการเชื่อมต่อแล้ว = null (route ตอบ 404) — ห้ามตอบไฟล์ว่าง
--   (ใช้ได้แม้ช่องทาง Meta ยังไม่ได้ใส่คีย์ API — ร้านที่ใช้ฟีดอย่างเดียวไม่ต้องเชื่อม API)
create or replace function public.get_feed_items(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.integration_channels%rowtype;
  v_opts jsonb;
begin
  perform public.integration_require(false);
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select * into c
    from public.integration_channels as x
   where x.feed_token_hash = p_token_hash
     and x.platform in ('meta', 'generic');
  if not found then
    return null;
  end if;
  v_opts := public.integration_channel_options(c.platform, c.options);
  return jsonb_build_object(
    'channel_id', c.id,
    'platform', c.platform,
    'generated_at', now(),
    'items', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'sku', p.sku,
                'group_id', g.id,
                'title', g.name,
                'description', coalesce(nullif(btrim(g.description), ''), g.name),
                'category', cat.name,
                'size', p.size,
                'color', coalesce(p.color, g.color),
                'price', p.sell_price,
                'quantity', q.qty,
                'availability', case when q.qty > 0 then 'in stock' else 'out of stock' end,
                'image_paths', coalesce(
                  (select jsonb_agg(i.path order by i.sort_order, i.created_at, i.id)
                     from public.product_images as i
                    where i.group_id = g.id),
                  '[]'::jsonb))
              order by g.name, public.product_size_rank(p.size), lower(p.size), p.sku)
         from public.products as p
         join public.product_groups as g on g.id = p.group_id
         left join public.categories as cat on cat.id = g.category_id
         left join public.channel_listings as l on l.channel_id = c.id and l.product_id = p.id
         cross join lateral (
           select public.integration_push_qty(v_opts, l.buffer_override, p.stock_qty, p.is_active, p.is_archived,
                                              public.integration_owed_qty(p.id)) as qty
         ) as q
        where coalesce(p.is_active, false)
          and not p.is_archived
          and g.is_active
          and (l.id is null or l.mapping_status <> 'ignored')),
      '[]'::jsonb));
end;
$$;

-- ----- ตัวปลุกงาน: มีงานต้องทำไหม (pg_cron เรียกก่อนปลุก Vercel — ไม่มีงาน = ไม่ปลุก) -----
create or replace function public.integration_work_due()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1
                   from public.stock_sync_outbox as o
                   join public.integration_channels as c on c.id = o.channel_id
                  where o.status in ('pending', 'failed')
                    and o.next_attempt_at <= now()
                    and c.status = 'connected'
                    and coalesce(c.paused_until, '-infinity'::timestamptz) <= now())
      or exists (select 1 from public.stock_sync_outbox as o
                  where o.status = 'processing' and o.locked_until < now())
      or exists (select 1 from public.integration_inbound_events as e
                  where e.status in ('pending', 'failed') and e.next_attempt_at <= now())
      or exists (select 1 from public.integration_inbound_events as e
                  where e.status = 'processing' and e.locked_until < now())
      or exists (select 1 from public.integration_channels as c
                  where c.status = 'connected'
                    and (c.options -> 'pull_orders') = 'true'::jsonb
                    and c.platform not in ('meta', 'generic')
                    and coalesce(c.paused_until, '-infinity'::timestamptz) <= now()
                    and coalesce(c.last_orders_sync_at, '-infinity'::timestamptz)
                        <= now() - make_interval(secs => coalesce(
                             (public.integration_channel_options(c.platform, c.options) ->> 'poll_seconds')::integer, 900)))
      or exists (select 1 from public.integration_channels as c
                  where c.status in ('connected', 'error')
                    and c.next_token_check_at <= now())
$$;

-- ----- ล้างข้อมูลเก่า (worker เรียกวันละครั้ง) -----
create or replace function public.integration_housekeeping()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outbox integer;
  v_payload integer;
  v_events integer;
  v_states integer;
  v_log integer;
begin
  perform public.integration_require(false);
  delete from public.stock_sync_outbox as o
   where o.status in ('done', 'skipped') and o.done_at < now() - interval '7 days';
  get diagnostics v_outbox = row_count;
  update public.integration_inbound_events as e
     set payload = null
   where e.payload is not null and e.status in ('done', 'ignored', 'dead') and e.processed_at < now() - interval '7 days';
  get diagnostics v_payload = row_count;
  delete from public.integration_inbound_events as e
   where e.status in ('done', 'ignored', 'dead') and e.received_at < now() - interval '30 days';
  get diagnostics v_events = row_count;
  delete from public.integration_oauth_states as s where s.expires_at < now() - interval '1 day';
  get diagnostics v_states = row_count;
  delete from public.integration_sync_log as l where l.created_at < now() - interval '60 days';
  get diagnostics v_log = row_count;
  return jsonb_build_object('outbox_deleted', v_outbox, 'payloads_cleared', v_payload, 'events_deleted', v_events,
                            'oauth_states_deleted', v_states, 'log_deleted', v_log);
end;
$$;

-- =========================================================================
-- 10) ฟังก์ชันสำหรับหน้าตั้งค่า (Admin ที่ล็อกอินอยู่ — เซิร์ฟเวอร์เรียกได้ด้วย) — ไม่มีฟังก์ชันไหนคืนค่าลับ
-- =========================================================================

create or replace function public.list_integration_channels()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.integration_require(true);
  return coalesce(
    (select jsonb_agg(public.integration_channel_json(c.id, true) order by c.platform, c.created_at, c.id)
       from public.integration_channels as c),
    '[]'::jsonb);
end;
$$;

create or replace function public.get_integration_channel(p_channel_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform public.integration_require(true);
  v := public.integration_channel_json(p_channel_id, true);
  if v is null then
    raise exception 'ไม่พบช่องทางนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  return v;
end;
$$;

-- สร้างช่องทางใหม่ (ยังไม่เชื่อมต่อ) — ช่องทางอื่น (generic: ฟีด/CSV) ใช้งานได้ทันที
create or replace function public.create_integration_channel(
  p_platform text,
  p_display_name text default null,
  p_environment text default 'production'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_platform text;
  v_env text;
  v_name text;
  v_id uuid;
begin
  v_uid := public.integration_require(true);
  v_platform := lower(btrim(coalesce(p_platform, '')));
  if v_platform not in ('line', 'meta', 'shopee', 'lazada', 'tiktok', 'generic') then
    raise exception 'แพลตฟอร์มไม่ถูกต้อง: %', left(coalesce(p_platform, 'ว่าง'), 30);
  end if;
  v_env := lower(btrim(coalesce(nullif(btrim(p_environment), ''), 'production')));
  if v_env not in ('sandbox', 'production') then
    raise exception 'สภาพแวดล้อมต้องเป็น sandbox หรือ production';
  end if;
  v_name := nullif(public.product_clean_text(p_display_name), '');
  if v_name is null then
    v_name := public.integration_platform_label(v_platform) || case when v_env = 'sandbox' then ' (ทดสอบ)' else '' end;
  end if;
  if char_length(v_name) > 100 then
    raise exception 'ชื่อช่องทางยาวเกินไป (สูงสุด 100 ตัวอักษร)';
  end if;

  insert into public.integration_channels as c (platform, display_name, environment, status, options, updated_by)
  values (v_platform, v_name, v_env,
          case when v_platform = 'generic' then 'connected' else 'disconnected' end,
          public.integration_channel_options(v_platform, '{}'::jsonb), v_uid)
  returning c.id into v_id;

  perform public.integration_log(v_id, 'admin', true, 'สร้างช่องทาง "' || v_name || '"',
    jsonb_build_object('platform', v_platform, 'environment', v_env), v_uid, null);
  return public.integration_channel_json(v_id, true);
end;
$$;

-- บันทึกตัวเลือก (ส่งเฉพาะคีย์ที่จะแก้) + เปลี่ยนชื่อช่องทาง
--   เปิด "ส่งสต๊อก" / เปลี่ยน buffer / zero_at_or_below หลังส่งครั้งแรกแล้ว → ส่งสต๊อกทุกรายการใหม่ทันที
create or replace function public.save_channel_options(
  p_channel_id uuid,
  p_options jsonb,
  p_display_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  c public.integration_channels%rowtype;
  v_patch jsonb := '{}'::jsonb;
  v_key text;
  v_val jsonb;
  v_bool boolean;
  v_int integer;
  v_text text;
  v_old jsonb;
  v_new jsonb;
  v_name text;
  v_changed jsonb := '{}'::jsonb;
  v_enqueued integer := 0;
begin
  v_uid := public.integration_require(true);
  select * into c from public.integration_channels as x where x.id = p_channel_id for update;
  if not found then
    raise exception 'ไม่พบช่องทางนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  if p_options is not null and jsonb_typeof(p_options) <> 'object' then
    raise exception 'ข้อมูลตัวเลือกไม่ถูกต้อง';
  end if;

  for v_key, v_val in select e.key, e.value from jsonb_each(coalesce(p_options, '{}'::jsonb)) as e loop
    if v_key in ('push_stock', 'pull_orders', 'shadow_mode') then
      v_bool := public.product_json_bool(v_val, 'ตัวเลือก "' || v_key || '" ');
      if v_bool is null then
        raise exception 'ตัวเลือก "%" ต้องเป็น true หรือ false', v_key;
      end if;
      v_patch := v_patch || jsonb_build_object(v_key, v_bool);
    elsif v_key in ('stock_buffer', 'zero_at_or_below') then
      v_int := public.integration_json_int(v_val, case when v_key = 'stock_buffer' then 'จำนวนกันสต๊อก (buffer) '
                                                       else 'ส่ง 0 เมื่อเหลือไม่เกิน ' end, 0, 1000);
      v_patch := v_patch || jsonb_build_object(v_key, coalesce(v_int, 0));
    elsif v_key = 'poll_seconds' then
      v_int := public.integration_json_int(v_val, 'รอบดึงออเดอร์ (วินาที) ', 60, 86400);
      v_patch := v_patch || jsonb_build_object(v_key, coalesce(v_int, case when c.platform = 'lazada' then 300 else 900 end));
    elsif v_key = 'deduct_on' then
      v_text := public.product_json_text(v_val, 'ตัดสต๊อกเมื่อ ');
      if v_text is null or v_text not in ('created', 'paid') then
        raise exception 'ตัดสต๊อกเมื่อ ต้องเป็น created (สร้างออเดอร์) หรือ paid (จ่ายเงินแล้ว)';
      end if;
      v_patch := v_patch || jsonb_build_object(v_key, v_text);
    elsif v_key = 'restock_returns' then
      v_text := public.product_json_text(v_val, 'คืนสต๊อกเมื่อคืนของ ');
      if v_text is null or v_text not in ('manual', 'auto') then
        raise exception 'คืนสต๊อกเมื่อคืนของ ต้องเป็น manual (แอดมินยืนยัน) หรือ auto (อัตโนมัติ)';
      end if;
      v_patch := v_patch || jsonb_build_object(v_key, v_text);
    elsif v_key in ('initial_push_done', 'initial_push_at') then
      raise exception 'ตัวเลือก "%" ตั้งเองไม่ได้ — ใช้ปุ่ม "ส่งสต๊อกครั้งแรก"', v_key;
    else
      raise exception 'ไม่รู้จักตัวเลือก "%"', left(v_key, 40);
    end if;
  end loop;

  if c.platform = 'generic' and ((v_patch -> 'push_stock') = 'true'::jsonb or (v_patch -> 'pull_orders') = 'true'::jsonb) then
    raise exception 'ช่องทางอื่นส่งสต๊อก/ดึงออเดอร์ผ่าน API ไม่ได้ — ใช้ลิงก์ฟีด ส่งออก CSV หรือนำเข้า CSV ออเดอร์แทน';
  end if;
  if c.platform = 'meta' and (v_patch -> 'pull_orders') = 'true'::jsonb then
    raise exception 'Facebook/Instagram ในไทยไม่มีระบบออเดอร์ให้ดึง — ขายผ่านแชตให้บันทึกที่หน้าขาย (เลือกช่องทาง Facebook หรือ Instagram)';
  end if;

  v_name := c.display_name;
  if p_display_name is not null then
    v_name := nullif(public.product_clean_text(p_display_name), '');
    if v_name is null then
      raise exception 'กรุณากรอกชื่อช่องทาง';
    end if;
    if char_length(v_name) > 100 then
      raise exception 'ชื่อช่องทางยาวเกินไป (สูงสุด 100 ตัวอักษร)';
    end if;
  end if;

  v_old := public.integration_channel_options(c.platform, c.options);
  v_new := v_old || v_patch;
  select coalesce(jsonb_object_agg(e.key, jsonb_build_object('from', v_old -> e.key, 'to', e.value)), '{}'::jsonb)
    into v_changed
    from jsonb_each(v_new) as e
   where e.value is distinct from v_old -> e.key;

  update public.integration_channels as x
     set options = v_new,
         display_name = v_name,
         updated_by = v_uid
   where x.id = c.id;

  if (v_new -> 'initial_push_done') = 'true'::jsonb and (v_new -> 'push_stock') = 'true'::jsonb
     and (v_changed ? 'push_stock' or v_changed ? 'stock_buffer' or v_changed ? 'zero_at_or_below') then
    v_enqueued := public.integration_enqueue(c.id, null, 'options_change', now());
  end if;

  if v_changed <> '{}'::jsonb or v_name is distinct from c.display_name then
    perform public.integration_log(c.id, 'admin', true,
      'แก้ตัวเลือกช่องทาง "' || v_name || '"'
      || case when v_enqueued > 0 then ' (ส่งสต๊อกใหม่ ' || v_enqueued || ' รายการ)' else '' end,
      jsonb_build_object('changed', v_changed, 'display_name', v_name), v_uid, null);
  end if;
  return public.integration_channel_json(c.id, true) || jsonb_build_object('enqueued', v_enqueued);
end;
$$;

-- เปลี่ยนสถานะด้วยมือ:
--   mark_pending_approval   ยังไม่เชื่อมต่อ → "รออนุมัติ API" (สมัครกับแพลตฟอร์มแล้ว รอผล)
--   unmark_pending_approval รออนุมัติ → ยังไม่เชื่อมต่อ
--   pause                   เชื่อมต่อแล้ว/มีข้อผิดพลาด → หยุดชั่วคราว (ไม่เรียก API — งานส่งสต๊อกเก็บไว้ส่งทีหลัง)
--   resume                  หยุดชั่วคราว → เชื่อมต่อแล้ว (ถ้ามีคีย์) / ช่องทางอื่น (generic) ที่ปิดไว้ → เปิดใหม่
create or replace function public.set_channel_state(p_channel_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  c public.integration_channels%rowtype;
  v_action text;
  v_to text;
begin
  v_uid := public.integration_require(true);
  v_action := lower(btrim(coalesce(p_action, '')));
  select * into c from public.integration_channels as x where x.id = p_channel_id for update;
  if not found then
    raise exception 'ไม่พบช่องทางนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;

  if v_action = 'mark_pending_approval' then
    if c.platform = 'generic' then
      raise exception 'ช่องทางอื่นไม่ต้องขออนุมัติ API';
    end if;
    if c.status <> 'disconnected' then
      raise exception 'ตั้งเป็น "รออนุมัติ API" ได้เฉพาะช่องทางที่ยังไม่เชื่อมต่อ';
    end if;
    v_to := 'pending_approval';
  elsif v_action = 'unmark_pending_approval' then
    if c.status <> 'pending_approval' then
      raise exception 'ช่องทางนี้ไม่ได้อยู่ในสถานะ "รออนุมัติ API"';
    end if;
    v_to := 'disconnected';
  elsif v_action = 'pause' then
    if c.status not in ('connected', 'error') then
      raise exception 'หยุดชั่วคราวได้เฉพาะช่องทางที่เชื่อมต่ออยู่';
    end if;
    v_to := 'paused';
  elsif v_action = 'resume' then
    if c.status = 'paused' then
      v_to := case when c.platform = 'generic'
                     or exists (select 1 from public.integration_credentials as k
                                 where k.channel_id = c.id and k.name <> 'feed_token')
                   then 'connected' else 'disconnected' end;
    elsif c.status = 'disconnected' and c.platform = 'generic' then
      v_to := 'connected';
    else
      raise exception 'ช่องทางนี้ไม่ได้หยุดชั่วคราวอยู่';
    end if;
  else
    raise exception 'คำสั่งไม่ถูกต้อง: %', left(coalesce(p_action, 'ว่าง'), 40);
  end if;

  update public.integration_channels as x
     set status = v_to,
         status_reason = null,
         paused_until = null,
         consecutive_failures = case when v_action = 'resume' then 0 else x.consecutive_failures end,
         updated_by = v_uid
   where x.id = c.id;
  perform public.integration_log(c.id, 'admin', true,
    'เปลี่ยนสถานะช่องทาง "' || c.display_name || '": ' || c.status || ' → ' || v_to,
    jsonb_build_object('action', v_action, 'from', c.status, 'to', v_to), v_uid, null);
  return public.integration_channel_json(c.id, true);
end;
$$;

-- ตัดการเชื่อมต่อ: ลบคีย์/โทเคนทั้งหมด ปิดลิงก์ฟีด หยุดงานค้าง ต้องกด "ส่งสต๊อกครั้งแรก" ใหม่เมื่อเชื่อมต่ออีกครั้ง
--   ประวัติออเดอร์/บิล/การจับคู่สินค้า ยังอยู่ครบ
create or replace function public.disconnect_channel(p_channel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  c public.integration_channels%rowtype;
  v_creds integer;
  v_jobs integer;
  v_events integer;
begin
  v_uid := public.integration_require(true);
  select * into c from public.integration_channels as x where x.id = p_channel_id for update;
  if not found then
    raise exception 'ไม่พบช่องทางนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;

  delete from public.integration_credentials as k where k.channel_id = c.id;
  get diagnostics v_creds = row_count;
  delete from public.integration_oauth_states as s where s.channel_id = c.id;
  update public.stock_sync_outbox as o
     set status = 'skipped', done_at = now(), locked_until = null, last_error = 'ตัดการเชื่อมต่อแล้ว'
   where o.channel_id = c.id and o.status in ('pending', 'failed', 'processing');
  get diagnostics v_jobs = row_count;
  update public.integration_inbound_events as e
     set status = 'ignored', processed_at = now(), locked_until = null, last_error = 'ตัดการเชื่อมต่อแล้ว'
   where e.channel_id = c.id and e.status in ('pending', 'failed', 'processing');
  get diagnostics v_events = row_count;

  update public.integration_channels as x
     set status = 'disconnected',
         status_reason = null,
         options = public.integration_channel_options(x.platform, x.options)
                   || jsonb_build_object('initial_push_done', false, 'initial_push_at', null),
         token_expires_at = null,
         refresh_expires_at = null,
         auth_expires_at = null,
         next_token_check_at = null,
         lease_until = null,
         lease_owner = null,
         paused_until = null,
         consecutive_failures = 0,
         last_error = null,
         last_error_at = null,
         feed_token_hash = null,
         feed_token_rotated_at = null,
         updated_by = v_uid
   where x.id = c.id;

  perform public.integration_log(c.id, 'admin', true,
    'ตัดการเชื่อมต่อ "' || c.display_name || '" (ลบคีย์ ' || v_creds || ' รายการ, ยกเลิกงานส่งสต๊อกค้าง ' || v_jobs || ' งาน)',
    jsonb_build_object('credentials_deleted', v_creds, 'jobs_skipped', v_jobs, 'events_ignored', v_events), v_uid, null);
  return public.integration_channel_json(c.id, true);
end;
$$;

-- จับคู่ด้วยมือ: p_product_id = สินค้าในแอป / p_ignore = true "ไม่ซิงก์รายการนี้"
--   ทั้งคู่ว่าง = ยกเลิกการจับคู่ (ให้การจับคู่อัตโนมัติตัดสินใหม่รอบถัดไป)
--   การจับคู่ด้วยมือไม่ถูกการจับคู่อัตโนมัติทับ; จับคู่แล้วเข้าคิวส่งสต๊อกเอง (ถ้าส่งสต๊อกครั้งแรกแล้ว)
--   คืน affected_order_ids = ออเดอร์ที่ยังไม่ได้ตัดสต๊อกของรายการนี้ (กด "ประมวลผลใหม่" เพื่อตัดสต๊อก)
create or replace function public.set_listing_mapping(
  p_listing_id uuid,
  p_product_id uuid default null,
  p_ignore boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_l public.channel_listings%rowtype;
  v_p record;
  v_other public.channel_listings%rowtype;
  v_summary text;
  v_affected jsonb;
begin
  v_uid := public.integration_require(true);
  select * into v_l from public.channel_listings as l where l.id = p_listing_id for update;
  if not found then
    raise exception 'ไม่พบรายการนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;

  if coalesce(p_ignore, false) then
    if p_product_id is not null then
      raise exception 'เลือกได้อย่างเดียว: จับคู่กับสินค้า หรือ ไม่ซิงก์รายการนี้';
    end if;
    update public.channel_listings as l
       set product_id = null, mapping_status = 'ignored', match_source = 'manual', last_error = null, last_error_at = null
     where l.id = v_l.id;
    v_summary := 'ตั้ง "ไม่ซิงก์" รายการ ' || coalesce(v_l.external_sku, v_l.external_sku_id);
  elsif p_product_id is not null then
    select p.id, p.sku, p.is_archived, public.product_label_text(p.name, p.size, p.color) as label into v_p
      from public.products as p
     where p.id = p_product_id;
    if not found then
      raise exception 'ไม่พบสินค้าที่เลือก (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
    end if;
    if v_p.is_archived then
      raise exception 'สินค้า "%" เป็นไซส์ที่เลิกใช้แล้ว จับคู่ไม่ได้', v_p.label;
    end if;
    select * into v_other
      from public.channel_listings as l
     where l.channel_id = v_l.channel_id and l.product_id = p_product_id and l.id <> v_l.id;
    if found then
      raise exception 'สินค้า "%" จับคู่กับรายการ "%" ของช่องทางนี้อยู่แล้ว — ยกเลิกการจับคู่รายการนั้นก่อน',
        v_p.label, coalesce(v_other.external_sku, v_other.external_name, v_other.external_sku_id);
    end if;
    update public.channel_listings as l
       set product_id = p_product_id, mapping_status = 'mapped', match_source = 'manual',
           last_error = null, last_error_at = null
     where l.id = v_l.id;
    v_summary := 'จับคู่ ' || coalesce(v_l.external_sku, v_l.external_sku_id) || ' กับ ' || v_p.label || ' (SKU ' || v_p.sku || ')';
  else
    update public.channel_listings as l
       set product_id = null, mapping_status = 'unmapped', match_source = null
     where l.id = v_l.id;
    v_summary := 'ยกเลิกการจับคู่ ' || coalesce(v_l.external_sku, v_l.external_sku_id);
  end if;

  select coalesce(jsonb_agg(distinct o.id), '[]'::jsonb) into v_affected
    from public.channel_order_lines as ol
    join public.channel_orders as o on o.id = ol.order_id
   where ol.listing_id = v_l.id
     and o.status not in ('cancelled', 'expired')
     and ol.qty_deducted = ol.qty_restocked
     and ol.product_id is distinct from (select l.product_id from public.channel_listings as l where l.id = v_l.id);

  perform public.integration_log(v_l.channel_id, 'admin', true, v_summary,
    jsonb_build_object('listing_id', v_l.id, 'product_id', p_product_id, 'ignore', coalesce(p_ignore, false),
                       'affected_orders', jsonb_array_length(v_affected)),
    v_uid, null);
  return public.integration_listing_json(v_l.id) || jsonb_build_object('affected_order_ids', v_affected);
end;
$$;

-- ตัวเลือกต่อรายการ: เปิด/ปิดส่งสต๊อก, buffer เฉพาะรายการ (p_clear_buffer_override = ใช้ค่าของช่องทาง)
create or replace function public.set_listing_options(
  p_listing_id uuid,
  p_push_enabled boolean default null,
  p_buffer_override integer default null,
  p_clear_buffer_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_l public.channel_listings%rowtype;
begin
  v_uid := public.integration_require(true);
  select * into v_l from public.channel_listings as l where l.id = p_listing_id for update;
  if not found then
    raise exception 'ไม่พบรายการนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  if p_buffer_override is not null and (p_buffer_override < 0 or p_buffer_override > 1000) then
    raise exception 'จำนวนกันสต๊อก (buffer) ต้องเป็น 0 ถึง 1,000';
  end if;
  update public.channel_listings as l
     set push_enabled = coalesce(p_push_enabled, l.push_enabled),
         buffer_override = case when coalesce(p_clear_buffer_override, false) then null
                                else coalesce(p_buffer_override, l.buffer_override) end
   where l.id = v_l.id;
  perform public.integration_log(v_l.channel_id, 'admin', true,
    'แก้ตัวเลือกรายการ ' || coalesce(v_l.external_sku, v_l.external_sku_id),
    jsonb_build_object('listing_id', v_l.id, 'push_enabled', p_push_enabled, 'buffer_override', p_buffer_override,
                       'clear_buffer_override', coalesce(p_clear_buffer_override, false)),
    v_uid, null);
  return public.integration_listing_json(v_l.id);
end;
$$;

-- จับคู่อัตโนมัติด้วย SKU กับรายการที่มีอยู่แล้ว (ไม่เรียกแพลตฟอร์ม) — เช่นหลังเพิ่มสินค้าใหม่ในแอป
create or replace function public.auto_match_channel_listings(p_channel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v jsonb;
begin
  v_uid := public.integration_require(true);
  if not exists (select 1 from public.integration_channels as c where c.id = p_channel_id) then
    raise exception 'ไม่พบช่องทางนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  v := public.integration_auto_match(p_channel_id, null);
  perform public.integration_log(p_channel_id, 'catalog', true,
    'จับคู่อัตโนมัติด้วย SKU: จับคู่แล้ว ' || (v ->> 'mapped') || ' / ขัดแย้ง ' || (v ->> 'conflict')
    || ' / ยังไม่จับคู่ ' || (v ->> 'unmapped'),
    v, v_uid, null);
  return v;
end;
$$;

-- รายการสินค้าบนแพลตฟอร์ม (หน้า "จับคู่สินค้า")
--   p_filter: all | mapped | unmapped | conflict | ignored | gone | errors | todo (ยังไม่จับคู่ + ขัดแย้ง)
create or replace function public.list_channel_listings(
  p_channel_id uuid,
  p_filter text default 'all',
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_filter text;
  v_pat text;
  v_limit integer;
  v_offset integer;
  v_total integer;
  v_rows jsonb;
begin
  perform public.integration_require(true);
  v_filter := lower(coalesce(nullif(btrim(p_filter), ''), 'all'));
  if v_filter not in ('all', 'mapped', 'unmapped', 'conflict', 'ignored', 'gone', 'errors', 'todo') then
    raise exception 'ตัวกรองไม่ถูกต้อง: %', left(p_filter, 20);
  end if;
  v_pat := nullif(public.product_clean_text(p_search), '');
  if v_pat is not null then
    v_pat := '%' || replace(replace(replace(left(v_pat, 100), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  v_limit := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  with f as (
    select l.id, l.mapping_status, l.external_name, l.external_sku_id
      from public.channel_listings as l
      left join public.products as p on p.id = l.product_id
     where l.channel_id = p_channel_id
       and (v_filter = 'all'
            or (v_filter = 'todo' and l.mapping_status in ('unmapped', 'conflict'))
            or (v_filter = 'errors' and l.last_error is not null)
            or l.mapping_status = v_filter)
       and (v_pat is null
            or l.external_sku ilike v_pat or l.external_name ilike v_pat or l.external_variant_name ilike v_pat
            or p.sku ilike v_pat or p.name ilike v_pat)
  )
  select (select count(*) from f),
         coalesce((select jsonb_agg(public.integration_listing_json(pg.id) order by pg.ord)
                     from (select f.id,
                                  row_number() over (order by case f.mapping_status when 'conflict' then 0 when 'unmapped' then 1
                                                                   when 'mapped' then 2 when 'ignored' then 3 else 4 end,
                                                              lower(coalesce(f.external_name, '')), f.external_sku_id) as ord
                             from f
                            order by 2
                           offset v_offset
                            limit v_limit) as pg),
                  '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'offset', v_offset, 'limit', v_limit, 'rows', v_rows);
end;
$$;

-- รายการที่ยังจับคู่ไม่ได้/ขัดแย้ง (ทุกช่องทางถ้า p_channel_id ว่าง) + จำนวนออเดอร์ที่ค้างเพราะรายการนี้ + สินค้าที่ SKU ตรง
create or replace function public.list_unmatched(p_channel_id uuid default null, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.integration_require(true);
  return coalesce(
    (select jsonb_agg(public.integration_listing_json(x.id)
                      || jsonb_build_object(
                           'channel_name', x.display_name,
                           'platform', x.platform,
                           'open_order_lines', x.open_lines,
                           'open_units', x.open_units,
                           'candidates', coalesce(
                             (select jsonb_agg(jsonb_build_object(
                                       'id', p.id, 'sku', p.sku, 'label', public.product_label_text(p.name, p.size, p.color),
                                       'is_active', coalesce(p.is_active, false), 'stock_qty', p.stock_qty) order by p.sku)
                                from public.products as p
                               where x.external_sku_norm is not null
                                 and not p.is_archived
                                 and lower(public.product_clean_text(p.sku)) = x.external_sku_norm),
                             '[]'::jsonb))
                      order by x.open_lines desc, x.updated_at desc)
       from (
         select l.id, l.updated_at, l.external_sku_norm, c.display_name, c.platform,
                (select count(*) from public.channel_order_lines as ol
                   join public.channel_orders as o on o.id = ol.order_id
                  where ol.listing_id = l.id and ol.product_id is null
                    and o.status not in ('cancelled', 'expired'))::integer as open_lines,
                (select coalesce(sum(ol.qty - ol.qty_cancelled), 0) from public.channel_order_lines as ol
                   join public.channel_orders as o on o.id = ol.order_id
                  where ol.listing_id = l.id and ol.product_id is null
                    and o.status not in ('cancelled', 'expired'))::integer as open_units
           from public.channel_listings as l
           join public.integration_channels as c on c.id = l.channel_id
          where l.mapping_status in ('unmapped', 'conflict')
            and (p_channel_id is null or l.channel_id = p_channel_id)
          order by 6 desc, l.updated_at desc
          limit least(greatest(coalesce(p_limit, 100), 1), 500)
       ) as x),
    '[]'::jsonb);
end;
$$;

-- ออเดอร์ล่าสุด (หน้า "ออเดอร์")
--   p_filter: all | attention | oversold | unmapped | return | shadow | open ; p_before = created_at ของแถวสุดท้ายหน้าก่อน
create or replace function public.list_channel_orders(
  p_channel_id uuid default null,
  p_filter text default 'all',
  p_limit integer default 50,
  p_before timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_filter text;
  v_limit integer;
  v_rows jsonb;
  v_last timestamptz;
  v_n integer;
begin
  perform public.integration_require(true);
  v_filter := lower(coalesce(nullif(btrim(p_filter), ''), 'all'));
  if v_filter not in ('all', 'attention', 'oversold', 'unmapped', 'return', 'shadow', 'open') then
    raise exception 'ตัวกรองไม่ถูกต้อง: %', left(p_filter, 20);
  end if;
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);
  select coalesce(jsonb_agg(public.integration_order_json(x.id) order by x.created_at desc, x.id desc), '[]'::jsonb),
         min(x.created_at), count(*)
    into v_rows, v_last, v_n
    from (
      select o.id, o.created_at
        from public.channel_orders as o
       where (p_channel_id is null or o.channel_id = p_channel_id)
         and (p_before is null or o.created_at < p_before)
         and (v_filter = 'all'
              or (v_filter = 'attention' and o.needs_attention)
              or (v_filter = 'oversold' and o.has_oversold)
              or (v_filter = 'unmapped' and o.has_unmapped)
              or (v_filter = 'return' and 'return_to_confirm' = any (o.attention_reasons))
              or (v_filter = 'shadow' and o.stock_tracking = 'shadow')
              or (v_filter = 'open' and o.status not in ('cancelled', 'expired', 'completed', 'returned')))
       order by o.created_at desc, o.id desc
       limit v_limit
    ) as x;
  return jsonb_build_object('rows', v_rows, 'next_before', case when v_n = v_limit then v_last end);
end;
$$;

create or replace function public.get_channel_order(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform public.integration_require(true);
  v := public.integration_order_json(p_order_id);
  if v is null then
    raise exception 'ไม่พบออเดอร์นี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  return v;
end;
$$;

-- "รับของคืนแล้ว": p_qty_received = จำนวนที่รับคืน "ทั้งหมด" ของบรรทัดนี้จนถึงตอนนี้ (ค่าสัมบูรณ์ — กดซ้ำไม่คืนซ้ำ)
--   เพิ่มได้อย่างเดียว ไม่เกินที่ตัดสต๊อกไป; คืนสต๊อกส่วนที่เพิ่มทันที (ประวัติสต๊อก 'รับคืน <แพลตฟอร์ม> #<ออเดอร์>')
create or replace function public.confirm_return_restock(p_line_id uuid, p_qty_received integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_order_id uuid;
  o public.channel_orders%rowtype;
  v_line public.channel_order_lines%rowtype;
  v_held integer;
  v_max integer;
  v_apply jsonb;
begin
  v_uid := public.integration_require(true);
  select l.order_id into v_order_id from public.channel_order_lines as l where l.id = p_line_id;
  if not found then
    raise exception 'ไม่พบรายการนี้ในออเดอร์ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  select * into o from public.channel_orders as x where x.id = v_order_id for update;
  select * into v_line from public.channel_order_lines as l where l.id = p_line_id for update;

  if o.stock_tracking <> 'live' then
    raise exception 'ออเดอร์นี้อยู่ในโหมดทดลอง (ไม่ได้ตัดสต๊อก) จึงไม่ต้องรับคืน';
  end if;
  if v_line.product_id is null then
    raise exception 'บรรทัดนี้ยังไม่ได้จับคู่สินค้า (ไม่ได้ตัดสต๊อก) จึงไม่ต้องรับคืน';
  end if;
  if p_qty_received is null or p_qty_received < 0 then
    raise exception 'จำนวนที่รับคืนต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป';
  end if;
  if p_qty_received < v_line.qty_returned_received then
    raise exception 'ยืนยันรับคืนไปแล้ว % ชิ้น — แก้ลดไม่ได้ (ถ้านับผิดให้ปรับยอดที่เมนูรับ-จ่ายสต๊อก)',
      v_line.qty_returned_received;
  end if;
  v_held := v_line.qty_deducted - v_line.qty_restocked;
  v_max := least(v_line.qty, v_line.qty_returned_received + v_held);
  if p_qty_received > v_max then
    raise exception 'รับคืนได้ไม่เกิน % ชิ้น (ออเดอร์นี้ตัดสต๊อกสินค้านี้ไว้ % ชิ้น)', v_max, v_held;
  end if;
  if p_qty_received = v_line.qty_returned_received then
    return public.integration_order_json(o.id) || jsonb_build_object('restocked', 0);
  end if;

  update public.channel_order_lines as l set qty_returned_received = p_qty_received where l.id = v_line.id;
  v_apply := public.channel_order_apply(o.id, v_uid);
  perform public.integration_log(o.channel_id, 'admin', true,
    'รับของคืน ออเดอร์ #' || o.external_order_id || ' ' || coalesce(v_line.external_sku, v_line.line_key)
    || ' รวม ' || p_qty_received || ' ชิ้น (คืนสต๊อก ' || (v_apply ->> 'restocked') || ' ชิ้น)',
    jsonb_build_object('order_id', o.id, 'line_id', v_line.id, 'qty_received', p_qty_received,
                       'restocked', (v_apply ->> 'restocked')::integer),
    v_uid, null);
  return public.integration_order_json(o.id) || jsonb_build_object('restocked', (v_apply ->> 'restocked')::integer);
end;
$$;

-- จัดการออเดอร์ที่ต้องดูแล:
--   reprocess    ผูกสินค้าตามการจับคู่ล่าสุด + ตัดสต๊อกที่ค้าง (ขายเกิน/จับคู่ไม่ได้ก่อนหน้า) เท่าที่สต๊อกมีตอนนี้
--   waive_owed   ชิ้นที่ขายเกินค้างอยู่ "ไม่ต้องตัดสต๊อก" (เช่น นับสต๊อกผิด/หาของมาจากที่อื่นแล้ว)
--   track_stock  ออเดอร์จากโหมดทดลอง → ตัดสต๊อกจริงตั้งแต่ตอนนี้
--   dismiss      ปิดการแจ้งเตือน (ถ้าเหตุเดิมยังอยู่จะไม่เตือนซ้ำ; เหตุใหม่เตือนตามปกติ)
create or replace function public.resolve_channel_order(p_order_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  o public.channel_orders%rowtype;
  v_action text;
  v_apply jsonb := jsonb_build_object('deducted', 0, 'restocked', 0);
  v_summary text;
begin
  v_uid := public.integration_require(true);
  v_action := lower(btrim(coalesce(p_action, '')));
  select * into o from public.channel_orders as x where x.id = p_order_id for update;
  if not found then
    raise exception 'ไม่พบออเดอร์นี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;

  if v_action = 'reprocess' then
    perform public.channel_order_resolve_products(o.id);
    v_apply := public.channel_order_apply(o.id, v_uid);
    v_summary := 'ประมวลผลออเดอร์ #' || o.external_order_id || ' ใหม่';
  elsif v_action = 'waive_owed' then
    if not exists (select 1 from public.channel_order_lines as l where l.order_id = o.id and l.qty_oversold > 0) then
      raise exception 'ออเดอร์นี้ไม่มีชิ้นที่ขายเกินค้างอยู่';
    end if;
    update public.channel_order_lines as l
       set qty_waived = least(l.qty, l.qty_waived + l.qty_oversold)
     where l.order_id = o.id and l.qty_oversold > 0;
    v_apply := public.channel_order_apply(o.id, v_uid);
    v_summary := 'ยกเว้นการตัดสต๊อกชิ้นที่ขายเกิน ออเดอร์ #' || o.external_order_id;
  elsif v_action = 'track_stock' then
    if o.stock_tracking = 'live' then
      raise exception 'ออเดอร์นี้ตัดสต๊อกจริงอยู่แล้ว';
    end if;
    update public.channel_orders as x set stock_tracking = 'live' where x.id = o.id;
    perform public.channel_order_resolve_products(o.id);
    v_apply := public.channel_order_apply(o.id, v_uid);
    v_summary := 'เปลี่ยนออเดอร์ #' || o.external_order_id || ' จากโหมดทดลองเป็นตัดสต๊อกจริง';
  elsif v_action = 'dismiss' then
    update public.channel_orders as x
       set dismissed_reasons = array(select distinct a from unnest(x.dismissed_reasons || x.attention_reasons) as a order by a),
           attention_reasons = '{}',
           resolved_at = now(),
           resolved_by = v_uid
     where x.id = o.id;
    v_summary := 'ปิดการแจ้งเตือนออเดอร์ #' || o.external_order_id;
  else
    raise exception 'คำสั่งไม่ถูกต้อง: %', left(coalesce(p_action, 'ว่าง'), 40);
  end if;

  perform public.integration_log(o.channel_id, 'admin', true,
    v_summary
    || case when (v_apply ->> 'deducted')::integer > 0 then ' (ตัดสต๊อก ' || (v_apply ->> 'deducted') || ' ชิ้น)' else '' end
    || case when (v_apply ->> 'restocked')::integer > 0 then ' (คืนสต๊อก ' || (v_apply ->> 'restocked') || ' ชิ้น)' else '' end,
    jsonb_build_object('order_id', o.id, 'action', v_action,
                       'deducted', (v_apply ->> 'deducted')::integer, 'restocked', (v_apply ->> 'restocked')::integer),
    v_uid, null);
  return public.integration_order_json(o.id)
         || jsonb_build_object('deducted', (v_apply ->> 'deducted')::integer,
                               'restocked', (v_apply ->> 'restocked')::integer);
end;
$$;

-- บันทึกการซิงก์ (หน้า "บันทึกการซิงก์") — p_before_id = id ของแถวสุดท้ายหน้าก่อน
create or replace function public.list_sync_log(
  p_channel_id uuid default null,
  p_kind text default null,
  p_only_errors boolean default false,
  p_limit integer default 100,
  p_before_id bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_rows jsonb;
  v_last bigint;
  v_n integer;
begin
  perform public.integration_require(true);
  v_limit := least(greatest(coalesce(p_limit, 100), 1), 200);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id,
           'channel_id', x.channel_id,
           'channel_name', x.display_name,
           'platform', x.platform,
           'kind', x.kind,
           'ok', x.ok,
           'summary', x.summary,
           'detail', x.detail,
           'actor', x.actor,
           'actor_name', x.actor_name,
           'duration_ms', x.duration_ms,
           'created_at', x.created_at) order by x.id desc), '[]'::jsonb),
         min(x.id), count(*)
    into v_rows, v_last, v_n
    from (
      select l.*, c.display_name, c.platform, coalesce(up.full_name, up.email) as actor_name
        from public.integration_sync_log as l
        left join public.integration_channels as c on c.id = l.channel_id
        left join public.user_profiles as up on up.id = l.actor
       where (p_channel_id is null or l.channel_id = p_channel_id)
         and (p_kind is null or l.kind = p_kind)
         and (not coalesce(p_only_errors, false) or not l.ok)
         and (p_before_id is null or l.id < p_before_id)
       order by l.id desc
       limit v_limit
    ) as x;
  return jsonb_build_object('rows', v_rows, 'next_before_id', case when v_n = v_limit then v_last end);
end;
$$;

-- ตาราง "ก่อน/หลัง" ก่อนกด "ส่งสต๊อกครั้งแรก": สต๊อกบนแพลตฟอร์มล่าสุดที่อ่านได้ เทียบกับจำนวนที่จะส่ง
create or replace function public.get_initial_push_preview(p_channel_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.integration_channels%rowtype;
  v_opts jsonb;
  v_rows jsonb;
begin
  perform public.integration_require(true);
  select * into c from public.integration_channels as x where x.id = p_channel_id;
  if not found then
    raise exception 'ไม่พบช่องทางนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  v_opts := public.integration_channel_options(c.platform, c.options);
  select coalesce(jsonb_agg(jsonb_build_object(
           'listing_id', x.id,
           'external_sku', x.external_sku,
           'external_name', x.external_name,
           'external_variant_name', x.external_variant_name,
           'product', jsonb_build_object('id', x.pid, 'sku', x.sku, 'label', x.label),
           'stock_qty', x.stock_qty,
           'platform_qty', x.platform_qty,
           'platform_qty_at', x.platform_qty_at,
           'push_qty', x.push_qty) order by x.label, x.sku), '[]'::jsonb)
    into v_rows
    from (
      select l.id, l.external_sku, l.external_name, l.external_variant_name, l.platform_qty, l.platform_qty_at,
             p.id as pid, p.sku, public.product_label_text(p.name, p.size, p.color) as label, p.stock_qty,
             public.integration_push_qty(v_opts, l.buffer_override, p.stock_qty, p.is_active, p.is_archived,
                                         public.integration_owed_qty(p.id)) as push_qty
        from public.channel_listings as l
        join public.products as p on p.id = l.product_id
       where l.channel_id = c.id and l.mapping_status = 'mapped' and l.push_enabled
         and l.external_sku_id not like 'sku:%'
    ) as x;
  return jsonb_build_object(
    'channel_id', c.id,
    'initial_push_done', (v_opts -> 'initial_push_done') = 'true'::jsonb,
    'initial_push_at', v_opts -> 'initial_push_at',
    'push_stock', (v_opts -> 'push_stock') = 'true'::jsonb,
    'rows', v_rows,
    'summary', jsonb_build_object(
      'total', jsonb_array_length(v_rows),
      'increase', (select count(*) from jsonb_array_elements(v_rows) as e
                    where (e.value ->> 'platform_qty') is not null
                      and (e.value ->> 'push_qty')::integer > (e.value ->> 'platform_qty')::integer),
      'decrease', (select count(*) from jsonb_array_elements(v_rows) as e
                    where (e.value ->> 'platform_qty') is not null
                      and (e.value ->> 'push_qty')::integer < (e.value ->> 'platform_qty')::integer),
      'same', (select count(*) from jsonb_array_elements(v_rows) as e
                where (e.value ->> 'platform_qty') is not null
                  and (e.value ->> 'push_qty')::integer = (e.value ->> 'platform_qty')::integer),
      'unknown', (select count(*) from jsonb_array_elements(v_rows) as e where (e.value ->> 'platform_qty') is null)));
end;
$$;

-- ยืนยัน "ส่งสต๊อกครั้งแรก" (ทับสต๊อกบนแพลตฟอร์มด้วยสต๊อกของแอป) — ต้องเชื่อมต่อแล้ว + เปิด "ส่งสต๊อก" + มีรายการที่จับคู่แล้ว
create or replace function public.mark_initial_push(p_channel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  c public.integration_channels%rowtype;
  v_opts jsonb;
  v_n integer;
begin
  v_uid := public.integration_require(true);
  select * into c from public.integration_channels as x where x.id = p_channel_id for update;
  if not found then
    raise exception 'ไม่พบช่องทางนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  if c.platform = 'generic' then
    raise exception 'ช่องทางอื่นส่งสต๊อกผ่าน API ไม่ได้';
  end if;
  v_opts := public.integration_channel_options(c.platform, c.options);
  if (v_opts -> 'initial_push_done') = 'true'::jsonb then
    return jsonb_build_object('already_done', true, 'enqueued', 0, 'channel', public.integration_channel_json(c.id, true));
  end if;
  if c.status <> 'connected' then
    raise exception 'ต้องเชื่อมต่อช่องทางให้สำเร็จก่อน จึงจะส่งสต๊อกครั้งแรกได้';
  end if;
  if (v_opts -> 'push_stock') <> 'true'::jsonb then
    raise exception 'เปิดตัวเลือก "ส่งสต๊อก" ก่อน แล้วจึงกดส่งสต๊อกครั้งแรก';
  end if;
  if not exists (select 1 from public.channel_listings as l
                  where l.channel_id = c.id and l.mapping_status = 'mapped' and l.push_enabled
                    and l.external_sku_id not like 'sku:%') then
    raise exception 'ยังไม่มีสินค้าที่จับคู่แล้ว — ดึงรายการสินค้าจากแพลตฟอร์มและจับคู่ก่อน';
  end if;

  update public.integration_channels as x
     set options = v_opts || jsonb_build_object('initial_push_done', true, 'initial_push_at', now()),
         updated_by = v_uid
   where x.id = c.id;
  v_n := public.integration_enqueue(c.id, null, 'initial_push', now());
  perform public.integration_log(c.id, 'admin', true,
    'ยืนยันส่งสต๊อกครั้งแรก "' || c.display_name || '" (' || v_n || ' รายการ)',
    jsonb_build_object('enqueued', v_n), v_uid, null);
  return jsonb_build_object('already_done', false, 'enqueued', v_n, 'channel', public.integration_channel_json(c.id, true));
end;
$$;

-- ส่งสต๊อกทุกรายการที่จับคู่แล้วใหม่ (ปุ่ม "ซิงก์ตอนนี้") — ต้องส่งสต๊อกครั้งแรกแล้ว
create or replace function public.request_channel_resync(p_channel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  c public.integration_channels%rowtype;
  v_opts jsonb;
  v_n integer;
begin
  v_uid := public.integration_require(true);
  select * into c from public.integration_channels as x where x.id = p_channel_id for update;
  if not found then
    raise exception 'ไม่พบช่องทางนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  v_opts := public.integration_channel_options(c.platform, c.options);
  if c.platform = 'generic' then
    raise exception 'ช่องทางอื่นส่งสต๊อกผ่าน API ไม่ได้ — ใช้ลิงก์ฟีดหรือส่งออก CSV';
  end if;
  if (v_opts -> 'push_stock') <> 'true'::jsonb then
    raise exception 'ช่องทางนี้ปิด "ส่งสต๊อก" อยู่';
  end if;
  if (v_opts -> 'initial_push_done') <> 'true'::jsonb then
    raise exception 'ต้องกด "ส่งสต๊อกครั้งแรก" ก่อน';
  end if;
  if c.status not in ('connected', 'error', 'paused') then
    raise exception 'ช่องทางนี้ยังไม่ได้เชื่อมต่อ';
  end if;
  v_n := public.integration_enqueue(c.id, null, 'resync', now());
  perform public.integration_log(c.id, 'admin', true,
    'สั่งส่งสต๊อกทุกรายการใหม่ (' || v_n || ' รายการ)', jsonb_build_object('enqueued', v_n), v_uid, null);
  return jsonb_build_object('enqueued', v_n);
end;
$$;

-- ลองส่งงานที่ล้มเหลว (failed / dead) ใหม่ทันที
create or replace function public.retry_failed_outbox(p_channel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_skipped integer;
  v_dead integer;
  v_failed integer;
begin
  v_uid := public.integration_require(true);
  if not exists (select 1 from public.integration_channels as c where c.id = p_channel_id) then
    raise exception 'ไม่พบช่องทางนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
  end if;
  -- งานตายที่มีงานใหม่ของสินค้าเดียวกันรออยู่แล้ว = ไม่ต้องทำ
  update public.stock_sync_outbox as o
     set status = 'skipped', done_at = now(), last_error = left(coalesce(o.last_error, '') || ' (แทนที่ด้วยงานใหม่)', 1000)
   where o.channel_id = p_channel_id and o.status = 'dead'
     and exists (select 1 from public.stock_sync_outbox as x
                  where x.channel_id = o.channel_id and x.product_id = o.product_id and x.status in ('pending', 'failed'));
  get diagnostics v_skipped = row_count;
  -- งานตายหลายงานของสินค้าเดียวกัน: เอางานล่าสุดกลับเข้าคิว ที่เหลือ = skipped (คิวเปิดได้ 1 งานต่อคู่)
  with ranked as (
    select o.id, row_number() over (partition by o.product_id order by o.id desc) as rn
      from public.stock_sync_outbox as o
     where o.channel_id = p_channel_id and o.status = 'dead'
  ),
  changed as (
    update public.stock_sync_outbox as o
       set status = case when ranked.rn = 1 then 'pending' else 'skipped' end,
           attempts = case when ranked.rn = 1 then 0 else o.attempts end,
           next_attempt_at = now(),
           done_at = case when ranked.rn = 1 then null else now() end,
           reason = case when ranked.rn = 1 then 'retry' else o.reason end,
           last_error = case when ranked.rn = 1 then null else o.last_error end
      from ranked
     where o.id = ranked.id
    returning o.status
  )
  select count(*) filter (where changed.status = 'pending') into v_dead from changed;
  update public.stock_sync_outbox as o
     set status = 'pending', attempts = 0, next_attempt_at = now(), reason = 'retry', last_error = null
   where o.channel_id = p_channel_id and o.status = 'failed';
  get diagnostics v_failed = row_count;
  perform public.integration_log(p_channel_id, 'admin', true,
    'ลองส่งงานที่ล้มเหลวใหม่ ' || (v_dead + v_failed) || ' งาน', null, v_uid, null);
  return jsonb_build_object('requeued', v_dead + v_failed, 'skipped', v_skipped);
end;
$$;

-- ตัวนับแจ้งเตือนรวม (แบนเนอร์หน้ารวม / จุดแดงบนเมนู)
create or replace function public.integration_alerts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.integration_require(true);
  return (select jsonb_build_object(
                   'attention_orders', count(*) filter (where o.needs_attention),
                   'oversold_orders', count(*) filter (where 'oversold' = any (o.attention_reasons)),
                   'unmapped_orders', count(*) filter (where 'unmapped_sku' = any (o.attention_reasons)),
                   'return_to_confirm', count(*) filter (where 'return_to_confirm' = any (o.attention_reasons)),
                   'unknown_status', count(*) filter (where 'unknown_status' = any (o.attention_reasons)))
            from public.channel_orders as o
           where o.needs_attention)
      || (select jsonb_build_object(
                   'channels_error', count(*) filter (where c.status = 'error'),
                   'auth_expiring', count(*) filter (where c.status in ('connected', 'error')
                                                       and c.auth_expires_at < now() + interval '14 days'))
            from public.integration_channels as c)
      || (select jsonb_build_object('outbox_dead', count(*))
            from public.stock_sync_outbox as o
           where o.status = 'dead');
end;
$$;

-- แถวสำหรับ "ส่งออก CSV สต๊อก" (ทุกสินค้าที่ยังไม่เลิกใช้) — ระบุช่องทาง = คิด buffer/zero ของช่องทางนั้น
create or replace function public.get_export_stock_rows(p_channel_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.integration_channels%rowtype;
  v_opts jsonb;
begin
  perform public.integration_require(true);
  if p_channel_id is not null then
    select * into c from public.integration_channels as x where x.id = p_channel_id;
    if not found then
      raise exception 'ไม่พบช่องทางนี้ (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
    end if;
    v_opts := public.integration_channel_options(c.platform, c.options);
  else
    v_opts := public.integration_channel_options(null, jsonb_build_object('stock_buffer', 0, 'zero_at_or_below', 0));
  end if;
  return coalesce(
    (select jsonb_agg(jsonb_build_object(
              'product_id', p.id,
              'sku', p.sku,
              'barcode', p.barcode,
              'name', p.name,
              'size', p.size,
              'color', p.color,
              'category', cat.name,
              'sell_price', p.sell_price,
              'stock_qty', p.stock_qty,
              'owed_qty', q.owed,
              'available', public.integration_push_qty(v_opts, l.buffer_override, p.stock_qty, p.is_active, p.is_archived, q.owed),
              'is_active', coalesce(p.is_active, false),
              'external_sku', l.external_sku,
              'mapping_status', l.mapping_status)
            order by p.name, public.product_size_rank(p.size), lower(p.size), p.sku)
       from public.products as p
       left join public.categories as cat on cat.id = p.category_id
       left join public.channel_listings as l on p_channel_id is not null and l.channel_id = p_channel_id and l.product_id = p.id
       cross join lateral (select public.integration_owed_qty(p.id) as owed) as q
      where not p.is_archived),
    '[]'::jsonb);
end;
$$;

-- =========================================================================
-- 11) สิทธิ์ตาราง + RLS (ระบุชัดทุกตาราง — Supabase เลิกให้สิทธิ์ตารางใหม่อัตโนมัติตั้งแต่ 30 ต.ค. 2026)
--     ตารางที่ไม่มีความลับ: แอดมินอ่านได้ (หน้าจอใช้ session ผู้ใช้) / เขียนผ่านฟังก์ชันเท่านั้น
--     ตารางความลับ/ภายใน: ไม่มี policy + ไม่ให้สิทธิ์ anon/authenticated เลย (service_role เท่านั้น)
-- =========================================================================
alter table public.integration_channels enable row level security;
drop policy if exists "integration_channels_admin_select" on public.integration_channels;
create policy "integration_channels_admin_select" on public.integration_channels
  for select to authenticated
  using ((select public.is_admin()));
revoke all on table public.integration_channels from public, anon, authenticated;
-- ไม่ให้เห็น feed_token_hash / lease_owner / lease_until
grant select (id, platform, display_name, environment, status, status_reason, options, settings, external_shop_id,
              external_shop_name, token_expires_at, refresh_expires_at, auth_expires_at, next_token_check_at,
              orders_cursor, last_sync_at, last_orders_sync_at, last_stock_push_at, last_catalog_sync_at, last_test_at,
              last_test_ok, last_error, last_error_at, consecutive_failures, paused_until, feed_token_rotated_at,
              created_at, updated_at, updated_by)
  on table public.integration_channels to authenticated;
grant all on table public.integration_channels to service_role;

alter table public.channel_listings enable row level security;
drop policy if exists "channel_listings_admin_select" on public.channel_listings;
create policy "channel_listings_admin_select" on public.channel_listings
  for select to authenticated
  using ((select public.is_admin()));
revoke all on table public.channel_listings from public, anon, authenticated;
grant select on table public.channel_listings to authenticated;
grant all on table public.channel_listings to service_role;

alter table public.stock_sync_outbox enable row level security;
drop policy if exists "stock_sync_outbox_admin_select" on public.stock_sync_outbox;
create policy "stock_sync_outbox_admin_select" on public.stock_sync_outbox
  for select to authenticated
  using ((select public.is_admin()));
revoke all on table public.stock_sync_outbox from public, anon, authenticated;
grant select on table public.stock_sync_outbox to authenticated;
grant all on table public.stock_sync_outbox to service_role;

alter table public.channel_orders enable row level security;
drop policy if exists "channel_orders_admin_select" on public.channel_orders;
create policy "channel_orders_admin_select" on public.channel_orders
  for select to authenticated
  using ((select public.is_admin()));
revoke all on table public.channel_orders from public, anon, authenticated;
grant select on table public.channel_orders to authenticated;
grant all on table public.channel_orders to service_role;

alter table public.channel_order_lines enable row level security;
drop policy if exists "channel_order_lines_admin_select" on public.channel_order_lines;
create policy "channel_order_lines_admin_select" on public.channel_order_lines
  for select to authenticated
  using ((select public.is_admin()));
revoke all on table public.channel_order_lines from public, anon, authenticated;
grant select on table public.channel_order_lines to authenticated;
grant all on table public.channel_order_lines to service_role;

alter table public.integration_sync_log enable row level security;
drop policy if exists "integration_sync_log_admin_select" on public.integration_sync_log;
create policy "integration_sync_log_admin_select" on public.integration_sync_log
  for select to authenticated
  using ((select public.is_admin()));
revoke all on table public.integration_sync_log from public, anon, authenticated;
grant select on table public.integration_sync_log to authenticated;
grant all on table public.integration_sync_log to service_role;

-- ความลับ / state / event ขาเข้า: service_role เท่านั้น (ไม่มี policy = ผู้ใช้ทั่วไปไม่เห็นแม้แถวเดียว)
alter table public.integration_credentials enable row level security;
revoke all on table public.integration_credentials from public, anon, authenticated;
grant all on table public.integration_credentials to service_role;

alter table public.integration_oauth_states enable row level security;
revoke all on table public.integration_oauth_states from public, anon, authenticated;
grant all on table public.integration_oauth_states to service_role;

alter table public.integration_inbound_events enable row level security;
revoke all on table public.integration_inbound_events from public, anon, authenticated;
grant all on table public.integration_inbound_events to service_role;

-- ลำดับเลขของคอลัมน์ identity: เฉพาะ service_role
do $$
declare
  v_seq text;
begin
  foreach v_seq in array array[
    pg_get_serial_sequence('public.stock_sync_outbox', 'id'),
    pg_get_serial_sequence('public.integration_inbound_events', 'id'),
    pg_get_serial_sequence('public.integration_sync_log', 'id')
  ] loop
    execute format('revoke all on sequence %s from public, anon, authenticated', v_seq);
    execute format('grant usage, select on sequence %s to service_role', v_seq);
  end loop;
end
$$;

-- =========================================================================
-- 12) สิทธิ์เรียกฟังก์ชัน
-- =========================================================================

-- ----- ตัวช่วยภายใน + trigger: ไม่มีใครเรียกผ่าน API ได้ -----
revoke all on function public.integration_is_server() from public, anon, authenticated, service_role;
revoke all on function public.integration_require(boolean) from public, anon, authenticated, service_role;
revoke all on function public.integration_platform_label(text) from public, anon, authenticated, service_role;
revoke all on function public.integration_channel_options(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.integration_strip(jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function public.integration_json_int(jsonb, text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.integration_json_ts(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.integration_log(uuid, text, boolean, text, jsonb, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.integration_push_qty(jsonb, integer, integer, boolean, boolean, integer) from public, anon, authenticated, service_role;
revoke all on function public.integration_owed_qty(uuid) from public, anon, authenticated, service_role;
revoke all on function public.integration_enqueue(uuid, uuid, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.integration_touch_updated_at() from public, anon, authenticated, service_role;
revoke all on function public.products_enqueue_channel_sync() from public, anon, authenticated, service_role;
revoke all on function public.channel_listings_before_write() from public, anon, authenticated, service_role;
revoke all on function public.channel_listings_after_write() from public, anon, authenticated, service_role;
revoke all on function public.integration_channel_json(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.integration_listing_json(uuid) from public, anon, authenticated, service_role;
revoke all on function public.integration_order_json(uuid) from public, anon, authenticated, service_role;
revoke all on function public.integration_listing_upsert(uuid, jsonb, boolean) from public, anon, authenticated, service_role;
revoke all on function public.integration_auto_match(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.integration_resolve_listing(uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.integration_status_rank(text) from public, anon, authenticated, service_role;
revoke all on function public.channel_order_resolve_products(uuid) from public, anon, authenticated, service_role;
revoke all on function public.channel_order_apply(uuid, uuid) from public, anon, authenticated, service_role;

-- is_admin(): ใช้ใน policy ของ authenticated (อ่านโปรไฟล์ของตัวเองเท่านั้น)
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- ----- เซิร์ฟเวอร์เท่านั้น (service_role) -----
revoke all on function public.record_channel_order(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_channel_order(uuid, jsonb, text) to service_role;
revoke all on function public.cancel_channel_order(uuid, text, text, text, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.cancel_channel_order(uuid, text, text, text, boolean, timestamptz) to service_role;
revoke all on function public.claim_outbox(integer, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_outbox(integer, text, uuid, integer) to service_role;
revoke all on function public.complete_outbox(text, jsonb) from public, anon, authenticated;
grant execute on function public.complete_outbox(text, jsonb) to service_role;
revoke all on function public.fail_outbox(text, jsonb) from public, anon, authenticated;
grant execute on function public.fail_outbox(text, jsonb) to service_role;
revoke all on function public.upsert_channel_listings(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_channel_listings(uuid, jsonb) to service_role;
revoke all on function public.mark_missing_listings_gone(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.mark_missing_listings_gone(uuid, timestamptz) to service_role;
revoke all on function public.log_integration(uuid, text, boolean, text, jsonb, uuid, integer) from public, anon, authenticated;
grant execute on function public.log_integration(uuid, text, boolean, text, jsonb, uuid, integer) to service_role;
revoke all on function public.record_inbound_event(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_inbound_event(uuid, text, text, text, jsonb) to service_role;
revoke all on function public.claim_inbound_events(integer, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_inbound_events(integer, text, uuid, integer) to service_role;
revoke all on function public.complete_inbound_event(bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_inbound_event(bigint, text, text, text) to service_role;
revoke all on function public.fail_inbound_event(bigint, text, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.fail_inbound_event(bigint, text, text, boolean, integer) to service_role;
revoke all on function public.create_oauth_state(uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.create_oauth_state(uuid, text, uuid, integer) to service_role;
revoke all on function public.consume_oauth_state(text) from public, anon, authenticated;
grant execute on function public.consume_oauth_state(text) to service_role;
revoke all on function public.acquire_channel_lease(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.acquire_channel_lease(uuid, text, integer) to service_role;
revoke all on function public.release_channel_lease(uuid, text) from public, anon, authenticated;
grant execute on function public.release_channel_lease(uuid, text) to service_role;
revoke all on function public.server_update_channel(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.server_update_channel(uuid, jsonb) to service_role;
revoke all on function public.save_integration_credentials(uuid, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.save_integration_credentials(uuid, jsonb, jsonb, uuid) to service_role;
revoke all on function public.get_integration_credentials(uuid) from public, anon, authenticated;
grant execute on function public.get_integration_credentials(uuid) to service_role;
revoke all on function public.delete_integration_credentials(uuid, text[]) from public, anon, authenticated;
grant execute on function public.delete_integration_credentials(uuid, text[]) to service_role;
revoke all on function public.set_feed_token(uuid, text) from public, anon, authenticated;
grant execute on function public.set_feed_token(uuid, text) to service_role;
revoke all on function public.get_feed_items(text) from public, anon, authenticated;
grant execute on function public.get_feed_items(text) to service_role;
revoke all on function public.integration_work_due() from public, anon, authenticated;
grant execute on function public.integration_work_due() to service_role;
revoke all on function public.integration_housekeeping() from public, anon, authenticated;
grant execute on function public.integration_housekeeping() to service_role;

-- ----- หน้าตั้งค่า: Admin ที่ล็อกอินอยู่ (ตรวจ is_admin() ในฟังก์ชัน) + เซิร์ฟเวอร์ -----
revoke all on function public.list_integration_channels() from public, anon;
grant execute on function public.list_integration_channels() to authenticated, service_role;
revoke all on function public.get_integration_channel(uuid) from public, anon;
grant execute on function public.get_integration_channel(uuid) to authenticated, service_role;
revoke all on function public.create_integration_channel(text, text, text) from public, anon;
grant execute on function public.create_integration_channel(text, text, text) to authenticated, service_role;
revoke all on function public.save_channel_options(uuid, jsonb, text) from public, anon;
grant execute on function public.save_channel_options(uuid, jsonb, text) to authenticated, service_role;
revoke all on function public.set_channel_state(uuid, text) from public, anon;
grant execute on function public.set_channel_state(uuid, text) to authenticated, service_role;
revoke all on function public.disconnect_channel(uuid) from public, anon;
grant execute on function public.disconnect_channel(uuid) to authenticated, service_role;
revoke all on function public.set_listing_mapping(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_listing_mapping(uuid, uuid, boolean) to authenticated, service_role;
revoke all on function public.set_listing_options(uuid, boolean, integer, boolean) from public, anon;
grant execute on function public.set_listing_options(uuid, boolean, integer, boolean) to authenticated, service_role;
revoke all on function public.auto_match_channel_listings(uuid) from public, anon;
grant execute on function public.auto_match_channel_listings(uuid) to authenticated, service_role;
revoke all on function public.list_channel_listings(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.list_channel_listings(uuid, text, text, integer, integer) to authenticated, service_role;
revoke all on function public.list_unmatched(uuid, integer) from public, anon;
grant execute on function public.list_unmatched(uuid, integer) to authenticated, service_role;
revoke all on function public.list_channel_orders(uuid, text, integer, timestamptz) from public, anon;
grant execute on function public.list_channel_orders(uuid, text, integer, timestamptz) to authenticated, service_role;
revoke all on function public.get_channel_order(uuid) from public, anon;
grant execute on function public.get_channel_order(uuid) to authenticated, service_role;
revoke all on function public.confirm_return_restock(uuid, integer) from public, anon;
grant execute on function public.confirm_return_restock(uuid, integer) to authenticated, service_role;
revoke all on function public.resolve_channel_order(uuid, text) from public, anon;
grant execute on function public.resolve_channel_order(uuid, text) to authenticated, service_role;
revoke all on function public.list_sync_log(uuid, text, boolean, integer, bigint) from public, anon;
grant execute on function public.list_sync_log(uuid, text, boolean, integer, bigint) to authenticated, service_role;
revoke all on function public.get_initial_push_preview(uuid) from public, anon;
grant execute on function public.get_initial_push_preview(uuid) to authenticated, service_role;
revoke all on function public.mark_initial_push(uuid) from public, anon;
grant execute on function public.mark_initial_push(uuid) to authenticated, service_role;
revoke all on function public.request_channel_resync(uuid) from public, anon;
grant execute on function public.request_channel_resync(uuid) to authenticated, service_role;
revoke all on function public.retry_failed_outbox(uuid) from public, anon;
grant execute on function public.retry_failed_outbox(uuid) to authenticated, service_role;
revoke all on function public.integration_alerts() from public, anon;
grant execute on function public.integration_alerts() to authenticated, service_role;
revoke all on function public.get_export_stock_rows(uuid) from public, anon;
grant execute on function public.get_export_stock_rows(uuid) to authenticated, service_role;

-- =========================================================================
-- 13) ให้ API (PostgREST) โหลดโครงสร้างใหม่ทันที
-- =========================================================================
notify pgrst, 'reload schema';

commit;

-- =========================================================================
-- ตรวจสอบหลังรัน
-- =========================================================================
--
-- (ก) SQL Editor จะแสดงตารางสรุปนี้ให้เองหลังกด Run (คำสั่งสุดท้ายของไฟล์ อ่านอย่างเดียว รันซ้ำได้)
--     แถว "record_sale รับช่องทางขาย" ต้องเป็น "มี (1 แบบ)" — ถ้าเป็น "มี 2 แบบ" แปลว่ามีคนรัน fix-01 ซ้ำ ให้รันไฟล์นี้อีกครั้ง
--
-- ข้อที่เหลือไม่บังคับ — เอา "-- " หน้าบรรทัดออก แล้วรันทีละข้อใน SQL Editor
--
-- (ข) ช่องทางทั้งหมดและสถานะ
-- select c.platform, c.display_name, c.environment, c.status, c.status_reason, c.options, c.last_sync_at, c.last_error
--   from public.integration_channels as c
--  order by c.platform, c.created_at;
--
-- (ค) งานส่งสต๊อกที่ค้าง/ล้มเหลว
-- select c.display_name, o.status, count(*), min(o.next_attempt_at) as next_at, max(o.last_error) as sample_error
--   from public.stock_sync_outbox as o
--   join public.integration_channels as c on c.id = o.channel_id
--  where o.status in ('pending', 'processing', 'failed', 'dead')
--  group by 1, 2
--  order by 1, 2;
--
-- (ง) ออเดอร์ที่ต้องดูแล (ขายเกิน / จับคู่ไม่ได้ / รอยืนยันรับคืน)
-- select c.display_name, o.external_order_id, o.status, o.attention_reasons, o.created_at
--   from public.channel_orders as o
--   join public.integration_channels as c on c.id = o.channel_id
--  where o.needs_attention
--  order by o.created_at desc;

-- (ก) สรุประบบเชื่อมต่อ (อ่านอย่างเดียว)
select x.item as "รายการ", x.value as "ค่า"
  from (values
    (1, 'ช่องทางที่ตั้งค่าไว้',
        (select count(*)::text
                || coalesce(' (' || string_agg(distinct c.platform || ':' || c.status, ', ') || ')', '')
           from public.integration_channels as c)),
    (2, 'รายการสินค้าบนแพลตฟอร์ม (จับคู่แล้ว / ทั้งหมด)',
        (select count(*) filter (where l.mapping_status = 'mapped')::text || ' / ' || count(*)::text
           from public.channel_listings as l)),
    (3, 'งานส่งสต๊อกค้าง (รอ / ล้มเหลว / ตาย)',
        (select count(*) filter (where o.status in ('pending', 'processing'))::text || ' / '
                || count(*) filter (where o.status = 'failed')::text || ' / '
                || count(*) filter (where o.status = 'dead')::text
           from public.stock_sync_outbox as o)),
    (4, 'ออเดอร์จากแพลตฟอร์ม (ทั้งหมด / ต้องดูแล)',
        (select count(*)::text || ' / ' || count(*) filter (where o.needs_attention)::text
           from public.channel_orders as o)),
    (5, 'บิลแยกตามช่องทางขาย',
        (select coalesce(string_agg(s.channel || ' ' || s.n, ', ' order by s.channel), '-')
           from (select sa.channel, count(*) as n from public.sales as sa group by sa.channel) as s)),
    (6, 'record_sale รับช่องทางขาย (p_channel)',
        (select case count(*)
                  when 0 then 'ไม่มี'
                  when 1 then case when bool_and(pg_get_function_identity_arguments(p.oid) like '%p_channel text%')
                                   then 'มี (1 แบบ)' else 'ยังเป็นแบบเก่า' end
                  else 'มี ' || count(*) || ' แบบ — รันไฟล์นี้ซ้ำ'
                end
           from pg_proc as p
          where p.pronamespace = 'public'::regnamespace and p.proname = 'record_sale')),
    (7, 'trigger เติมคิวส่งสต๊อกบน products',
        (select case when count(*) = 1 then 'มี' else 'ไม่มี' end
           from pg_trigger as t
          where t.tgrelid = 'public.products'::regclass and t.tgname = 'products_enqueue_channel_sync'
            and not t.tgisinternal)),
    (8, 'ฟังก์ชันของระบบเชื่อมต่อ (เซิร์ฟเวอร์ / Admin)',
        (select count(*) filter (where has_function_privilege('service_role', p.oid, 'EXECUTE')
                                   and not has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text
                || ' / '
                || count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text
           from pg_proc as p
          where p.pronamespace = 'public'::regnamespace
            and p.proname in ('record_channel_order', 'cancel_channel_order', 'claim_outbox', 'complete_outbox',
                              'fail_outbox', 'upsert_channel_listings', 'mark_missing_listings_gone', 'log_integration',
                              'record_inbound_event', 'claim_inbound_events', 'complete_inbound_event',
                              'fail_inbound_event', 'create_oauth_state', 'consume_oauth_state',
                              'acquire_channel_lease', 'release_channel_lease', 'server_update_channel',
                              'save_integration_credentials', 'get_integration_credentials',
                              'delete_integration_credentials', 'set_feed_token', 'get_feed_items',
                              'integration_work_due', 'integration_housekeeping',
                              'list_integration_channels', 'get_integration_channel', 'create_integration_channel',
                              'save_channel_options', 'set_channel_state', 'disconnect_channel', 'set_listing_mapping',
                              'set_listing_options', 'auto_match_channel_listings', 'list_channel_listings',
                              'list_unmatched', 'list_channel_orders', 'get_channel_order', 'confirm_return_restock',
                              'resolve_channel_order', 'list_sync_log', 'get_initial_push_preview',
                              'mark_initial_push', 'request_channel_resync', 'retry_failed_outbox',
                              'integration_alerts', 'get_export_stock_rows'))),
    (9, 'ความลับที่เก็บไว้ (เข้ารหัสแล้ว — แสดงแค่จำนวน)',
        (select count(*)::text from public.integration_credentials))
  ) as x(ord, item, value)
 order by x.ord;
