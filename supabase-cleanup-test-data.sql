-- =========================================================================
-- supabase-cleanup-test-data.sql — ล้างข้อมูลทดลองระบบ (บิลขาย / คืนสินค้า / ประวัติสต๊อก / ปิดยอด / ตรวจนับ)
--
-- ใช้ตอนไหน: ทดลองขาย/รับ-จ่ายสต๊อกไปแล้ว และอยากเริ่มใช้งานจริงแบบ "ประวัติว่าง"
--   ** ไฟล์นี้ลบข้อมูลถาวร กู้คืนไม่ได้ ** — ไม่มีใครรันให้อัตโนมัติ บอสต้องรันเองเท่านั้น
--
-- ลบอะไร (ทั้งหมดในตารางเหล่านี้):
--   บิลขาย + รายการในบิล (sales, sale_items), ใบคืนสินค้า (sale_returns, sale_return_items),
--   ประวัติรับ-จ่ายสต๊อกทั้งหมด (stock_movements), ปิดยอดประจำวัน (daily_closings),
--   รอบตรวจนับ (stock_counts, stock_count_items), ประวัติการนำเข้าไฟล์ (product_imports),
--   ตัวนับเลขบิล/เลขใบคืน (sale_counters, doc_counters → บิลถัดไปเริ่มที่ -001)
--
-- เก็บไว้ (ไม่ลบ): สินค้า / แบบสินค้า / รูป / หมวดหมู่ / ผู้ใช้ / ข้อมูลร้าน / การตั้งค่าการเชื่อมต่อ
--   - สต๊อกคงเหลือของสินค้าไม่เปลี่ยน — ถ้าอยากให้สต๊อกทุกตัวเป็น 0 ด้วย ให้แก้ v_reset_stock เป็น true (ส่วนที่ 2)
--     (ถ้าเชื่อมต่อแพลตฟอร์มและเปิด "ส่งสต๊อก" ไว้แล้ว สต๊อก 0 จะถูกส่งไปแพลตฟอร์มด้วยอัตโนมัติ — ปกติตอนทดลองยังไม่ได้เชื่อมต่อ)
--   - ลบสินค้าทดลองเองได้ที่หน้า "สินค้า" หลังรันไฟล์นี้ (สินค้าที่ไม่มีประวัติแล้วจะลบได้)
--   - ถ้ามีออเดอร์จากแพลตฟอร์ม (Shopee / Lazada / LINE ฯลฯ) อยู่แล้ว ไฟล์นี้จะหยุดโดยไม่ลบอะไร
--     (ข้อมูลระบบเชื่อมต่อต้องไม่ถูกแตะ)
--
-- วิธีใช้ (Supabase > SQL Editor):
--   1) สำรองข้อมูลก่อน: หน้า "รายงาน" > ส่งออก Excel (บิลขาย + รายการสินค้าที่ขาย)
--      และหน้า "รับ-จ่ายสต๊อก" > ส่งออก Excel (ประวัติสต๊อก) — เลือกช่วงวันที่ให้ครอบคลุมทั้งหมด
--   2) รัน "ส่วนที่ 1" ก่อน (เลือกเฉพาะส่วนที่ 1 แล้วกด Run) — อ่านอย่างเดียว ดูว่าจะลบกี่แถว
--   3) ในส่วนที่ 2 แก้ v_confirm จาก 'ยังไม่ยืนยัน' เป็น 'ยืนยันลบข้อมูลทดสอบ'
--      (และ v_reset_stock เป็น true ถ้าต้องการล้างสต๊อกเป็น 0) แล้วรันส่วนที่ 2
--   4) รันส่วนที่ 1 อีกครั้ง — ทุกตารางต้องเหลือ 0
--   ถ้ารันทั้งไฟล์โดยไม่แก้ v_confirm จะหยุดที่ส่วนที่ 2 โดยไม่ลบอะไรเลย
-- =========================================================================


-- =========================================================================
-- ส่วนที่ 1: ดูจำนวนแถวที่จะถูกลบ (อ่านอย่างเดียว รันกี่ครั้งก็ได้)
-- =========================================================================
select t.name as "ตาราง",
       case
         when to_regclass('public.' || t.name) is null then 'ไม่มีตารางนี้'
         else (xpath('/row/n/text()',
                     query_to_xml(format('select count(*) as n from public.%I', t.name), false, true, '')))[1]::text
       end as "จำนวนแถว"
  from unnest(array['sales', 'sale_items', 'sale_returns', 'sale_return_items', 'stock_movements',
                    'daily_closings', 'stock_counts', 'stock_count_items', 'product_imports',
                    'sale_counters', 'doc_counters', 'channel_orders']) with ordinality as t(name, ord)
union all
select 'products (สต๊อกไม่เป็น 0 — ล้างเฉพาะเมื่อ v_reset_stock = true)',
       (select count(*)::text from public.products as p where p.stock_qty <> 0);


-- =========================================================================
-- ส่วนที่ 2: ลบจริง — แก้ v_confirm ก่อน (ทั้งก้อนสำเร็จทั้งหมดหรือไม่ลบอะไรเลย)
-- =========================================================================
begin;

do $$
declare
  v_confirm text := 'ยังไม่ยืนยัน';      -- แก้เป็น 'ยืนยันลบข้อมูลทดสอบ' เมื่อพร้อมลบ
  v_reset_stock boolean := false;        -- true = ตั้งสต๊อกสินค้าทุกตัวเป็น 0 ด้วย
  v_table text;
  v_n bigint;
  v_msg text := '';
begin
  if v_confirm is distinct from 'ยืนยันลบข้อมูลทดสอบ' then
    raise exception 'ยังไม่ได้ยืนยัน — แก้ v_confirm เป็น ''ยืนยันลบข้อมูลทดสอบ'' ก่อน (ยังไม่ได้ลบอะไร)';
  end if;

  -- ออเดอร์จากแพลตฟอร์มผูกกับบิลและสต๊อกที่ระบบเชื่อมต่อถือไว้ → ห้ามลบเองจากไฟล์นี้
  if to_regclass('public.channel_orders') is not null then
    execute 'select count(*) from public.channel_orders' into v_n;
    if v_n > 0 then
      raise exception 'มีออเดอร์จากแพลตฟอร์มอยู่ ลบเองไม่ได้ (ยังไม่ได้ลบอะไร)';
    end if;
  end if;

  -- ลำดับนี้ปลอดภัยกับ foreign key (ลูกก่อนแม่) — ข้ามตารางที่ยังไม่มี (ยังไม่ได้รันไฟล์ fix บางไฟล์)
  foreach v_table in array array['sale_return_items', 'sale_returns', 'stock_count_items', 'stock_counts',
                                 'daily_closings', 'product_imports', 'sale_items', 'sales', 'stock_movements',
                                 'sale_counters', 'doc_counters']
  loop
    if to_regclass('public.' || v_table) is not null then
      execute format('delete from public.%I', v_table);
      get diagnostics v_n = row_count;
      v_msg := v_msg || format(E'\n  %s: ลบ %s แถว', v_table, v_n);
    end if;
  end loop;

  if v_reset_stock then
    update public.products as p set stock_qty = 0 where p.stock_qty <> 0;
    get diagnostics v_n = row_count;
    v_msg := v_msg || format(E'\n  products: ตั้งสต๊อกเป็น 0 จำนวน %s รายการ', v_n);
  end if;

  raise notice 'ล้างข้อมูลทดลองเรียบร้อย:%', v_msg;
end
$$;

commit;
