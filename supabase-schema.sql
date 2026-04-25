-- =========================================
-- STOCK APP — Supabase SQL Schema
-- วิธีใช้: ไปที่ Supabase > SQL Editor > วาง SQL นี้แล้วกด Run
-- =========================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ===== หมวดหมู่สินค้า =====
create table categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  created_at timestamptz default now()
);

-- ===== สินค้า =====
create table products (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  sku text not null unique,
  barcode text unique,
  category_id uuid references categories(id) on delete set null,
  size text,
  color text,
  cost_price numeric(10,2) not null default 0,
  sell_price numeric(10,2) not null default 0,
  stock_qty integer not null default 0,
  min_stock integer not null default 5,
  image_url text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ===== การเคลื่อนไหวสต๊อก =====
create table stock_movements (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products(id) on delete cascade,
  type text not null check (type in ('in','out','adjust','return')),
  qty integer not null,
  qty_before integer not null,
  qty_after integer not null,
  note text,
  ref_id uuid,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- ===== การขาย =====
create table sales (
  id uuid primary key default uuid_generate_v4(),
  sale_no text not null unique,
  total_amount numeric(10,2) not null default 0,
  discount numeric(10,2) not null default 0,
  net_amount numeric(10,2) not null default 0,
  payment_method text not null check (payment_method in ('cash','transfer','credit')),
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- ===== รายการในใบขาย =====
create table sale_items (
  id uuid primary key default uuid_generate_v4(),
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid not null references products(id),
  qty integer not null,
  unit_price numeric(10,2) not null,
  subtotal numeric(10,2) not null
);

-- ===== โปรไฟล์ผู้ใช้ =====
create table user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'staff' check (role in ('admin','staff')),
  created_at timestamptz default now()
);

-- =========================================
-- AUTO-UPDATE updated_at
-- =========================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger products_updated_at
  before update on products
  for each row execute function update_updated_at();

-- =========================================
-- AUTO-CREATE user_profile เมื่อ signup
-- =========================================
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into user_profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data->>'full_name', 'staff');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- =========================================
-- AUTO SALE NUMBER (เช่น S-20240101-001)
-- =========================================
create or replace function generate_sale_no()
returns trigger as $$
declare
  today text := to_char(now(), 'YYYYMMDD');
  count int;
  new_no text;
begin
  select count(*) into count
  from sales
  where created_at::date = current_date;
  new_no := 'S-' || today || '-' || lpad((count + 1)::text, 3, '0');
  new.sale_no := new_no;
  return new;
end;
$$ language plpgsql;

create trigger set_sale_no
  before insert on sales
  for each row execute function generate_sale_no();

-- =========================================
-- ROW LEVEL SECURITY (RLS)
-- =========================================
alter table categories      enable row level security;
alter table products        enable row level security;
alter table stock_movements enable row level security;
alter table sales           enable row level security;
alter table sale_items      enable row level security;
alter table user_profiles   enable row level security;

-- ผู้ใช้ที่ login แล้วเข้าถึงได้ทุก table
create policy "authenticated_all" on categories      for all using (auth.role() = 'authenticated');
create policy "authenticated_all" on products        for all using (auth.role() = 'authenticated');
create policy "authenticated_all" on stock_movements for all using (auth.role() = 'authenticated');
create policy "authenticated_all" on sales           for all using (auth.role() = 'authenticated');
create policy "authenticated_all" on sale_items      for all using (auth.role() = 'authenticated');
create policy "own_profile"       on user_profiles   for all using (auth.uid() = id);

-- =========================================
-- ข้อมูลตัวอย่าง
-- =========================================
insert into categories (name) values
  ('เสื้อยืด'), ('กางเกง'), ('เสื้อเชิ้ต'), ('ชุดกีฬา'), ('อื่นๆ');
