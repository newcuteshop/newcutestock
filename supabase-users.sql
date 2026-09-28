-- =========================================
-- USER PERMISSIONS — เพิ่มระบบสิทธิ์
-- รันใน Supabase SQL Editor (หลัง supabase-schema.sql)
-- ⚠️ รันไฟล์นี้แล้ว ต้องรัน supabase-fix-01.sql ต่อด้วยเสมอ
-- =========================================

-- เพิ่ม column permissions
alter table user_profiles
  add column if not exists permissions jsonb default '{
    "products": true,
    "stock": true,
    "sales": true,
    "labels": true,
    "reports": true,
    "users": false
  }'::jsonb;

alter table user_profiles
  add column if not exists email text;

-- trigger สร้างโปรไฟล์ตอนสมัคร: ได้ staff ที่ไม่มีสิทธิ์ใดๆ เสมอ (เหมือนใน supabase-fix-01.sql ทุกตัวอักษร)
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

-- backfill email ของ user เก่า
update user_profiles up
set email = au.email
from auth.users au
where up.id = au.id and up.email is null;

-- ⚠️ ตั้ง admin คนแรก (เจ้าของร้าน) + ทุกสิทธิ์
-- แก้อีเมลก่อนรัน: เปลี่ยน YOUR_ADMIN_EMAIL@example.com เป็นอีเมลจริง แล้วเอา "-- " หน้าบรรทัดออก
-- update user_profiles
-- set role = 'admin',
--     permissions = '{
--       "products": true,
--       "stock": true,
--       "sales": true,
--       "labels": true,
--       "reports": true,
--       "users": true
--     }'::jsonb
-- where email = 'YOUR_ADMIN_EMAIL@example.com';

-- policy อ่านโปรไฟล์: อ่านได้เฉพาะของตัวเอง / ผู้มีสิทธิ์ "จัดการผู้ใช้" อ่านได้ทุกคน
-- (เหมือนใน supabase-fix-01.sql — ห้ามกลับไปเป็น "ทุกคนที่ล็อกอินอ่านได้หมด"
--  ไม่งั้นบัญชีที่สมัครเองจะเห็นอีเมล/บทบาท/สิทธิ์ของพนักงานทุกคน)
-- has_perm() สร้างใน supabase-fix-01.sql — ติดตั้งใหม่ (ยังไม่มีฟังก์ชัน) ให้อ่านได้แค่ของตัวเองไปก่อน
drop policy if exists "own_profile" on user_profiles;
drop policy if exists "read_all_profiles" on user_profiles;
do $$
begin
  if to_regprocedure('public.has_perm(text)') is not null then
    create policy "read_all_profiles" on public.user_profiles
      for select to authenticated
      using (id = auth.uid() or (select public.has_perm('users')));
  else
    create policy "read_all_profiles" on public.user_profiles
      for select to authenticated
      using (id = auth.uid());
  end if;
end
$$;

-- การเพิ่ม/แก้โปรไฟล์ (ชื่อ, role, สิทธิ์) ทำผ่านฝั่งเซิร์ฟเวอร์เท่านั้น
-- (service role ใน app/(dashboard)/users/actions.ts ซึ่งตรวจสิทธิ์ผู้เรียกก่อนทุกครั้ง)
-- จึงไม่มี policy ให้แก้ผ่าน API ตรง — เดิมมี "update_own_or_admin" ที่ทำให้พนักงานแก้ role/สิทธิ์ของตัวเองได้
drop policy if exists "update_own_or_admin" on user_profiles;
