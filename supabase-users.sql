-- =========================================
-- USER PERMISSIONS — เพิ่มระบบสิทธิ์
-- รันใน Supabase SQL Editor
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

-- อัพเดต trigger ให้กำหนด permissions เริ่มต้น
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.user_profiles (id, full_name, email, role, permissions)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'staff'),
    coalesce(
      (new.raw_user_meta_data->>'permissions')::jsonb,
      '{
        "products": true,
        "stock": true,
        "sales": true,
        "labels": true,
        "reports": true,
        "users": false
      }'::jsonb
    )
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- backfill email + permissions ของ user เก่า
update user_profiles up
set email = au.email
from auth.users au
where up.id = au.id and up.email is null;

-- ⚠️ เปลี่ยน user แรก (max@newcute.com) ให้เป็น admin + ทุกสิทธิ์
update user_profiles
set role = 'admin',
    permissions = '{
      "products": true,
      "stock": true,
      "sales": true,
      "labels": true,
      "reports": true,
      "users": true
    }'::jsonb
where email = 'max@newcute.com';

-- policy: admin อ่าน/แก้ไข profile ทุกคนได้
drop policy if exists "own_profile" on user_profiles;
create policy "read_all_profiles" on user_profiles
  for select using (auth.role() = 'authenticated');
create policy "update_own_or_admin" on user_profiles
  for update using (
    auth.uid() = id
    or exists (
      select 1 from user_profiles up
      where up.id = auth.uid() and up.role = 'admin'
    )
  );
