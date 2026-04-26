-- =========================================
-- INDEXES — เพิ่มความเร็ว query
-- รันใน Supabase SQL Editor หลัง schema หลัก
-- =========================================

-- products
create index if not exists idx_products_sku       on products(sku);
create index if not exists idx_products_barcode   on products(barcode) where barcode is not null;
create index if not exists idx_products_active    on products(is_active);
create index if not exists idx_products_category  on products(category_id);
create index if not exists idx_products_low_stock on products(stock_qty, min_stock) where is_active = true;

-- stock_movements
create index if not exists idx_movements_product  on stock_movements(product_id);
create index if not exists idx_movements_created  on stock_movements(created_at desc);
create index if not exists idx_movements_type     on stock_movements(type);

-- sales
create index if not exists idx_sales_created      on sales(created_at desc);
create index if not exists idx_sales_payment      on sales(payment_method);
create index if not exists idx_sales_no           on sales(sale_no);

-- sale_items
create index if not exists idx_sale_items_sale    on sale_items(sale_id);
create index if not exists idx_sale_items_product on sale_items(product_id);
