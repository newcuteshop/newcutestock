-- =========================================================================
-- supabase-fix-08-lock-order.sql — แก้ deadlock ระหว่าง "ออเดอร์จากแพลตฟอร์ม" กับงานหน้าร้าน
--                                  (ขายหน้าร้าน / ยกเลิกบิล / คืนสินค้า / ปรับยอดตรวจนับ / รับ-จ่ายสต๊อก)
--
-- อาการที่แก้
--   ออเดอร์ใหม่จาก Shopee/Lazada/TikTok ฯลฯ เข้ามา "พร้อมกับ" งานหน้าร้านที่แตะสินค้าตัวเดียวกัน
--   → ฐานข้อมูลยกเลิกฝั่งใดฝั่งหนึ่งด้วย error อังกฤษ "deadlock detected" (40P01)
--   สาเหตุมี 2 จุด
--   (1) channel_order_apply (fix-03) สร้างบิลก่อน (trigger เลขบิลล็อกตัวนับของวัน sale_counters
--       + เขียนรายการในบิลทำให้ FK ล็อกแถวสินค้าแบบ key share ตามลำดับที่ group by คืนมา ไม่เรียงตาม id)
--       แล้วค่อยล็อกสินค้าเรียงตาม id — ส่วน record_sale ล็อกสินค้าเรียงตาม id ก่อน แล้วค่อยขอตัวนับเลขบิล
--       → ต่างฝ่ายรอของที่อีกฝ่ายถือ
--   (2) record_channel_order บันทึกบรรทัดสินค้าตามลำดับที่แพลตฟอร์มส่งมา — FK ล็อกแถวสินค้าแบบ key share
--       ทีละบรรทัด (ไม่เรียงตาม id และเกิดก่อน channel_order_apply) ขณะที่งานหน้าร้านล็อกสินค้าแบบ for update
--       ซึ่งชนกับ key share: ขายหน้าร้านถือสินค้า A รอ B / ออเดอร์ถือ key share ของ B รอ A → วน
--       (ออเดอร์ 2 สินค้าขึ้นไปที่ลำดับบรรทัดไม่ตรงลำดับ id ราวครึ่งหนึ่ง + ขาย/ยกเลิก/คืน/ปรับยอดตรวจนับสินค้าชุดเดียวกัน
--        พร้อมกัน — ตอนปรับยอดตรวจนับเกิดง่ายที่สุดเพราะล็อกสินค้าทุกตัวที่นับ)
--
-- ไฟล์นี้ทำอะไร (ไม่แตะตาราง ไม่แตะข้อมูล)
--   1) สร้าง channel_order_apply(uuid, uuid) ใหม่ — พารามิเตอร์/ผลลัพธ์/ข้อความ/การคำนวณเหมือน fix-03 ทุกบรรทัด
--      ต่างกันแค่ "ล็อกสินค้าทุกตัวที่ออเดอร์จะแตะ เรียงตาม id ตั้งแต่ต้น" ก่อนสร้างบิล/เขียนรายการในบิล/ตัด-คืนสต๊อก
--      (ย้ายจุดล็อกเดิมที่อยู่ก่อนตัดสต๊อกขึ้นมา + รวมสินค้าในบิลเดิมของออเดอร์ด้วย) แล้วตั้งสิทธิ์เรียกใช้เหมือนเดิม
--      (ไม่มีใครเรียกตรงได้ — เรียกผ่าน record_channel_order / cancel_channel_order / confirm_return_restock /
--       resolve_channel_order เท่านั้น)
--   2) สร้าง record_sale / void_sale / return_sale_items / apply_stock_count (จาก fix-04) และ move_stock (จาก fix-01)
--      ใหม่ — เหมือนเดิมทุกตัวอักษร ต่างกันคำเดียว: ล็อกสินค้าแบบ "for no key update" แทน "for update"
--      แล้วตั้งสิทธิ์เรียกใช้เหมือนเดิม (ผู้ล็อกอินเรียกได้ / anon เรียกไม่ได้)
--
-- ทำไมล็อกสินค้าแบบ for no key update (ไม่ใช่ for update)
--   ทั้ง 6 ฟังก์ชันแก้แค่ stock_qty ไม่แตะคีย์ของสินค้า (id / sku / barcode) — trigger ของ products ก็ไม่แตะ
--   (updated_at / กันสต๊อกติดลบ / เติมคิวส่งสต๊อก) การแก้สต๊อกจึงเป็น no key update อยู่แล้ว ไม่ต้องยกระดับล็อก
--   no key update กันกันเองได้เท่า for update ทุกกรณี: สองรายการที่แก้สต๊อกตัวเดียวกันยังต้องรอกันทีละราย
--   และยังกันตัวนับสต๊อก (set_stock_count_item อ่านแบบ for share) ไว้เหมือนเดิม
--   ต่างกันแค่ "ไม่ต้องรอ key share" ที่ FK ใส่ไว้ตอนรายการอื่นเขียนแถวที่อ้างถึงสินค้า
--   (บรรทัดออเดอร์ รายการในบิล ประวัติสต๊อก คิวส่งสต๊อก) — key share พวกนี้เกิดตามลำดับใดก็ได้ จึงไม่ทำให้วนอีก:
--     - ออเดอร์ที่บันทึกบรรทัดไปแล้วไม่ขวางขายหน้าร้าน และขายหน้าร้านที่ล็อกสินค้าแล้วไม่ขวางการบันทึกบรรทัดออเดอร์
--     - สองออเดอร์ (เช่น worker ของ Shopee กับ Lazada ทำพร้อมกัน) ที่มีสินค้าเดียวกันไม่รอกันเป็นวง
--     - สร้างบิลของออเดอร์ (FK ไปที่ integration_channels) ไม่ชนกับ save_channel_options / mark_initial_push /
--       request_channel_resync ที่ล็อกช่องทางแล้วเติมคิวส่งสต๊อก (key share ไปที่สินค้า)
--
-- ลำดับการล็อกกลางของระบบ (ฟังก์ชันที่แตะสต๊อก/บิล ขอตามลำดับนี้ — ข้ามขั้นได้ ห้ามย้อน;
--                         ข้อยกเว้นที่ตรวจแล้ว และวงที่ยังเหลือ อยู่ด้านล่าง)
--   1) แถวหัวงานของตัวเอง (ล็อกก่อนอย่างอื่น)
--        ออเดอร์แพลตฟอร์ม: channel_orders → channel_order_lines ของออเดอร์นั้น
--        ยกเลิกบิล/คืนสินค้า (หน้าร้าน): sales แถวบิลนั้น
--        ตรวจนับ: stock_counts แถวรอบนับนั้น
--        แก้สินค้า: advisory lock (save_product_group / import_products) → product_groups
--   2) products เรียงตาม id ทั้งชุดในคำสั่งเดียว
--        for no key update: record_sale, move_stock, void_sale, return_sale_items, apply_stock_count,
--                           channel_order_apply (ทั้งหมดในไฟล์นี้)
--        for update (แก้/ลบสินค้า — ยังเป็นแบบเดิม ไม่ได้แก้ในไฟล์นี้; import_products / save_product_group แก้ SKU-บาร์โค้ดได้):
--                           import_products, save_product_group, set_product_group_active, delete_product_group
--        for share: set_stock_count_item (ตัวเดียว)
--      key share จาก FK (ตอนเขียนแถวที่อ้างถึงสินค้า) ไม่เรียงตาม id และเกิดได้ทุกขั้น — ชนกับ for update ของการแก้สินค้าเท่านั้น
--   3) ตัวนับเลขเอกสาร: sale_counters (trigger set_sale_no ตอนสร้างบิล) / doc_counters
--   4) เขียนแถว: sales (บิลใหม่ / แก้ยอด-ยกเลิกบิลของออเดอร์แพลตฟอร์ม), sale_items, sale_returns,
--      sale_return_items, stock_movements, channel_orders.sale_id, stock_sync_outbox (trigger หลังแก้สต๊อก)
--   ข้อยกเว้นที่ไม่เป็นวง (ตรวจแล้ว)
--     - return_sale_items ขอ doc_counters ('return') ก่อนสินค้า: แถวนี้มีแค่ return_sale_items ใช้
--       (ร้านเช่า/b.oncloud ใช้ doc_counters คนละแถว) และทุกตัวขอตามลำดับเดียวกัน
--     - บิลของออเดอร์แพลตฟอร์มถูกล็อก (แก้ยอด/ยกเลิก) หลังสินค้า: void_sale / return_sale_items ล็อกบิลแล้ว
--       ปฏิเสธบิลแพลตฟอร์มทันที (ไม่ขอสินค้าต่อ) จึงไม่มีใครถือบิลแพลตฟอร์มแล้วรอสินค้า
--
-- ยังเหลือ (ยังไม่แก้ในไฟล์นี้ — เกิดยาก ส่วนใหญ่ตอนแอดมินทำรายการบางอย่าง ต้องแก้ฟังก์ชันนอกชุดนี้)
--   ก) แอดมินแก้/นำเข้าสินค้า (import_products, save_product_group, set_product_group_active, delete_product_group
--      ล็อกสินค้าแบบ for update) พร้อมกับออเดอร์ใหม่ที่มีสินค้าชุดเดียวกัน 2 ตัวขึ้นไป (บรรทัดออเดอร์ใส่ key share
--      ไม่เรียงตาม id) → วนแบบข้อ (2) ด้านบน ระหว่างการแก้สินค้ากับออเดอร์
--   ข) save_channel_options / mark_initial_push / request_channel_resync / disconnect_channel ล็อกแถวช่องทาง
--      (integration_channels) แบบ for update แล้วเติมคิวส่งสต๊อก ขณะที่การแก้สต๊อกใดๆ ถือสินค้าไว้แล้วเติมคิว
--      (FK key share ไปที่แถวช่องทาง + ดัชนี "งานค้าง 1 งานต่อคู่ช่องทาง-สินค้า" ของ stock_sync_outbox) → รอกันเป็นวง
--      (แก้ภายหลังได้ด้วยการล็อกแถวช่องทางแบบ for no key update ในฟังก์ชันตั้งค่าช่องทาง)
--   ค) จับคู่รายการบนแพลตฟอร์มครั้งแรก (จับคู่อัตโนมัติตอนออเดอร์เข้า / set_listing_mapping / upsert_channel_listings)
--      เติมคิวของคู่ (ช่องทาง, สินค้า) โดยไม่ล็อกสินค้า ขณะที่การแก้สต๊อกเติมคิวคู่เดียวกัน → รอกันที่ดัชนีงานค้าง
--   ง) import_products (สินค้า → แบบสินค้า) กับ set_product_group_active / delete_product_group (แบบสินค้า → สินค้า)
--      — แอดมินสองคนทำพร้อมกัน
--   จ) save_product_group ลบไซส์ที่ออเดอร์ที่กำลังบันทึกอ้างถึงอยู่ (FK on delete set null) — แทบไม่เกิด
--   ฉ) คิวส่งสต๊อก (ไม่ใช่ deadlock): fail_outbox (processing → failed) และ claim_outbox ตอนคืนงานที่หมดเวลาจอง
--      (processing → pending) ตรวจ "มีงานค้างของคู่เดียวกันไหม" ก่อนเปลี่ยนสถานะ แต่มองไม่เห็นงานที่รายการแก้สต๊อก
--      ที่ยังไม่ commit เพิ่งเติม → รอรายการนั้นจบ แล้วพังด้วยรหัส 23505 (ซ้ำ) ทั้งชุดคำขอ (ถ้า fail_outbox ชุดเดียวกัน
--      ล็อกงานค้างของคู่อื่นไว้แล้วตอนโอน backoff อาจรอกันเป็นวงได้ด้วย — ผลเหมือนกัน) — worker ลองใหม่เอง
--      เมื่อหมดเวลาจอง ไม่กระทบสต๊อกหรือเงิน (แก้ได้ภายหลังด้วยการเปลี่ยนสถานะแบบไม่ชนดัชนีงานค้าง)
--   ถ้าเกิดข้อ ก–จ ฐานข้อมูลยกเลิกฝั่งเดียวทั้งรายการ (ไม่มีอะไรถูกบันทึกครึ่งๆ): worker ของแพลตฟอร์มลองใหม่เอง
--   แอดมินกดทำรายการใหม่ได้ ; ข้อ ข/ค อาจโดนงานหน้าร้านได้ — หน้าขายส่งคำขอเดิมซ้ำให้เอง 1 ครั้ง แล้วถ้ายังชนอีก
--   ขึ้นข้อความไทยให้กดอีกครั้ง (ยกเลิกบิล/คืนสินค้าขึ้นข้อความไทยเช่นกัน) — รหัสคำขอ client_id เดิม ไม่ได้บิล/ใบคืนซ้ำ
--
-- วิธีใช้: Supabase > SQL Editor > วางทั้งไฟล์ > กด Run
--   - ต้องรัน supabase-fix-01 → 02 → 03 → 04 มาก่อนแล้ว (ไฟล์นี้ตรวจให้ ถ้ายังไม่ได้รันจะหยุดทันทีโดยไม่แก้อะไร)
--   - รันซ้ำได้ปลอดภัย (ทั้งไฟล์สำเร็จทั้งหมดหรือไม่เปลี่ยนอะไรเลย) ไม่ต้องหยุดร้าน
--   - ถ้ารัน supabase-fix-01.sql / supabase-fix-03-integrations.sql / supabase-fix-04-pos.sql ซ้ำภายหลัง
--     ฟังก์ชันในไฟล์นี้จะกลับเป็นแบบเดิม → ต้องรันไฟล์นี้ซ้ำเป็นไฟล์สุดท้าย (ตารางสรุปท้ายไฟล์จะขึ้น "ยังเป็นแบบเดิม")
--   - รันเสร็จแล้ว SQL Editor จะแสดงตารางสรุป — ทุกแถวต้องเป็น "ถูกต้อง"
-- =========================================================================

begin;

-- =========================================================================
-- 0) ตรวจของที่ต้องมีก่อน (fix-01: รับ-จ่ายสต๊อก, fix-03: ระบบเชื่อมต่อแพลตฟอร์ม, fix-04: POS ยกเลิกบิล/คืนสินค้า/ตรวจนับ)
-- =========================================================================
do $$
begin
  if to_regprocedure('public.channel_order_apply(uuid, uuid)') is null
     or to_regprocedure('public.record_channel_order(uuid, jsonb, text)') is null
     or to_regprocedure('public.integration_channel_options(text, jsonb)') is null
     or to_regprocedure('public.integration_platform_label(text)') is null
     or to_regprocedure('public.integration_enqueue(uuid, uuid, text, timestamptz)') is null
     or to_regclass('public.integration_channels') is null
     or to_regclass('public.channel_orders') is null
     or to_regclass('public.channel_order_lines') is null
     or to_regclass('public.sale_counters') is null
     or to_regprocedure('public.record_sale(uuid, jsonb, numeric, text, text, text, numeric)') is null
     or to_regprocedure('public.void_sale(uuid, text)') is null
     or to_regprocedure('public.return_sale_items(uuid, uuid, jsonb, text, text, boolean)') is null
     or to_regprocedure('public.apply_stock_count(uuid)') is null
     or to_regprocedure('public.move_stock(uuid, text, integer, text)') is null
     or to_regprocedure('public.sale_json(uuid, boolean)') is null
     or to_regprocedure('public.pos_actor_name(uuid)') is null
     or to_regprocedure('public.pos_sale_detail(uuid)') is null
     or to_regprocedure('public.pos_return_json(uuid)') is null
     or to_regprocedure('public.pos_next_return_no()') is null
     or to_regprocedure('public.pos_require_stock_count()') is null
     or to_regprocedure('public.pos_stock_count_json(uuid)') is null
     or to_regprocedure('public.pos_count_line_stale(uuid, uuid, timestamptz)') is null
     or to_regclass('public.sale_returns') is null
     or to_regclass('public.sale_return_items') is null
     or to_regclass('public.stock_counts') is null
     or to_regclass('public.stock_count_items') is null then
    raise exception 'ต้องรัน supabase-fix-01.sql ถึง supabase-fix-04-pos.sql ให้เสร็จก่อน แล้วค่อยรันไฟล์นี้ (ยังไม่ได้แก้อะไรในฐานข้อมูล)';
  end if;
end
$$;

-- =========================================================================
-- 1) channel_order_apply — เหมือน fix-03 ทุกบรรทัด ยกเว้นจุดล็อกสินค้า (ดูหัวข้อ "ล็อกสินค้าทุกตัว..." ในฟังก์ชัน)
-- =========================================================================
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
    -- ----- ล็อกสินค้าทุกตัวที่ออเดอร์นี้จะแตะ เรียงตาม id ก่อนเขียนบิลหรือสต๊อกใดๆ (fix-08) -----
    --   ต้องมาก่อนสร้างบิล (trigger เลขบิลล็อกตัวนับของวัน) และก่อนเขียนรายการในบิล (FK ล็อกแถวสินค้าแบบ key share)
    --   = ลำดับเดียวกับ record_sale (สินค้าเรียงตาม id → ตัวนับเลขบิล) → ขายหน้าร้านพร้อมออเดอร์แพลตฟอร์มไม่รอกันเป็นวง
    --   ครอบคลุม: สินค้าของบรรทัดที่จับคู่แล้ว (รายการในบิล + ตัด/คืนสต๊อก)
    --            + สินค้าในบิลเดิมของออเดอร์นี้ (บรรทัดที่ย้ายสินค้า/เอาออก → แก้/ลบรายการในบิล)
    --   ล็อกแบบ no key update (แก้แค่ stock_qty ไม่แตะคีย์) — กันแก้สต๊อกพร้อมกันได้เท่าแบบเดิม
    --   แต่ไม่ชนกับ key share ที่ออเดอร์อื่นถือไว้จากการบันทึกบรรทัดสินค้าเดียวกัน (สองออเดอร์จึงไม่รอกันเป็นวง)
    select array_agg(distinct x.pid order by x.pid) into v_pids
      from (select l.product_id as pid
              from public.channel_order_lines as l
             where l.order_id = o.id and l.product_id is not null
            union all
            select si.product_id
              from public.sale_items as si
              join public.sales as s on s.id = si.sale_id
             where s.id = o.sale_id
                or (s.channel_id = o.channel_id and s.external_order_id = o.external_order_id)) as x;
    if v_pids is not null then
      perform 1 from public.products as p where p.id = any (v_pids) order by p.id for no key update;
    end if;

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

    -- ----- สต๊อก: สินค้าทุกตัวล็อกไว้แล้วตั้งแต่ต้น (เรียงตาม id ก่อนเขียนบิล) — ไม่ล็อกซ้ำตรงนี้ -----
    v_ref := coalesce(o.sale_id, o.id);

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
-- 2) สิทธิ์เรียกใช้ — เหมือน fix-03: ไม่มีใครเรียกตรงได้ (ฟังก์ชันภายในของระบบออเดอร์)
-- =========================================================================
revoke all on function public.channel_order_apply(uuid, uuid) from public, anon, authenticated, service_role;

-- =========================================================================
-- 3) ฟังก์ชันแก้สต๊อกหน้าร้าน — เหมือนต้นฉบับทุกตัวอักษร ยกเว้นคำล็อกสินค้า: for update → for no key update
--    (เหตุผลดูหัวไฟล์ "ทำไมล็อกสินค้าแบบ for no key update") ลำดับการล็อก/การตรวจ/ข้อความ/การคำนวณ ไม่เปลี่ยน
-- =========================================================================

-- ----- 3.1 record_sale (ต้นฉบับ: supabase-fix-04-pos.sql) — ขายหน้าร้าน/ขายทางแชต -----
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
      for no key update;

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

-- ----- 3.2 void_sale (ต้นฉบับ: supabase-fix-04-pos.sql) — ยกเลิกทั้งบิล คืนสต๊อกทุกรายการ -----
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
      for no key update;

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

-- ----- 3.3 return_sale_items (ต้นฉบับ: supabase-fix-04-pos.sql) — คืนสินค้าบางส่วน/ทั้งหมด -----
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
        for no key update;
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

-- ----- 3.4 apply_stock_count (ต้นฉบับ: supabase-fix-04-pos.sql) — ปรับยอดสต๊อกตามรอบตรวจนับ -----
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
      for no key update;

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

-- ----- 3.5 move_stock (ต้นฉบับ: supabase-fix-01.sql) — รับเข้า / จ่ายออก / ปรับยอด / รับคืน -----
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
     for no key update;
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
-- 4) สิทธิ์เรียกใช้ — เหมือนต้นฉบับ: ผู้ล็อกอินเรียกได้ (ในฟังก์ชันเช็คสิทธิ์ย่อยอีกชั้น) / anon เรียกไม่ได้
-- =========================================================================
revoke all on function public.record_sale(uuid, jsonb, numeric, text, text, text, numeric) from public, anon;
grant execute on function public.record_sale(uuid, jsonb, numeric, text, text, text, numeric) to authenticated;
revoke all on function public.void_sale(uuid, text) from public, anon;
grant execute on function public.void_sale(uuid, text) to authenticated;
revoke all on function public.return_sale_items(uuid, uuid, jsonb, text, text, boolean) from public, anon;
grant execute on function public.return_sale_items(uuid, uuid, jsonb, text, text, boolean) to authenticated;
revoke all on function public.apply_stock_count(uuid) from public, anon;
grant execute on function public.apply_stock_count(uuid) to authenticated;
revoke all on function public.move_stock(uuid, text, integer, text) from public, anon;
grant execute on function public.move_stock(uuid, text, integer, text) to authenticated;

commit;

-- =========================================================================
-- ตรวจสอบหลังรัน
-- =========================================================================
--
-- (ก) SQL Editor จะแสดงตารางสรุปนี้ให้เองหลังกด Run (คำสั่งสุดท้ายของไฟล์ อ่านอย่างเดียว รันซ้ำได้)
--     ทุกแถวต้องเป็น "ถูกต้อง"
--     - แถว 2 หรือแถว 6 เป็น "ยังเป็นแบบเดิม" = มีคนรัน fix-01 / fix-03 / fix-04 ซ้ำ → รันไฟล์นี้อีกครั้ง
--     - แถว 5 เป็น "ขาด ... ตัว" = ระบบออเดอร์ (fix-03) ไม่ครบ → รัน supabase-fix-03-integrations.sql แล้วรันไฟล์นี้ซ้ำ

-- (ก) สรุปลำดับการล็อก (อ่านอย่างเดียว)
select x.item as "รายการ", x.value as "ค่า"
  from (values
    (1, 'channel_order_apply มีแบบเดียว',
        (select case count(*)
                  when 1 then 'ถูกต้อง'
                  when 0 then 'ไม่มี — รัน supabase-fix-03-integrations.sql แล้วรันไฟล์นี้ซ้ำ'
                  else 'มี ' || count(*) || ' แบบ — ตรวจฐานข้อมูล'
                end
           from pg_proc as p
          where p.pronamespace = 'public'::regnamespace and p.proname = 'channel_order_apply')),
    (2, 'ล็อกสินค้าก่อนเขียนบิล/รายการในบิล (เรียงตาม id)',
        (select case
                  when count(*) = 0 then 'ไม่มีฟังก์ชัน — ดูแถว 1'
                  when count(*) > 1 then 'มีหลายแบบ — ดูแถว 1'
                  when bool_and(x.lk > 0
                                and x.lk < x.ins_sale and x.lk < x.ins_item
                                and x.lk < x.upd_item and x.lk < x.del_item
                                and x.old_lock = 0) then 'ถูกต้อง'
                  else 'ยังเป็นแบบเดิม — รันไฟล์นี้ซ้ำ'
                end
           from (select position('order by p.id for no key update' in d.def) as lk,
                        position('order by p.id for update' in d.def) as old_lock,
                        position('insert into public.sales' in d.def) as ins_sale,
                        position('insert into public.sale_items' in d.def) as ins_item,
                        position('update public.sale_items' in d.def) as upd_item,
                        position('delete from public.sale_items' in d.def) as del_item
                   from (select lower(pg_get_functiondef(p.oid)) as def
                           from pg_proc as p
                          where p.pronamespace = 'public'::regnamespace and p.proname = 'channel_order_apply') as d
                ) as x)),
    (3, 'channel_order_apply เรียกตรงไม่ได้ (public / anon / authenticated / service_role)',
        (select case
                  when count(*) = 0 then 'ไม่มีฟังก์ชัน'
                  when bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')
                               or has_function_privilege('authenticated', p.oid, 'EXECUTE')
                               or has_function_privilege('service_role', p.oid, 'EXECUTE')
                               or exists (select 1
                                            from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as a
                                           where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
                    then 'ผิด — รันไฟล์นี้ซ้ำ'
                  else 'ถูกต้อง'
                end
           from pg_proc as p
          where p.pronamespace = 'public'::regnamespace and p.proname = 'channel_order_apply')),
    (4, 'channel_order_apply เป็น security definer + search_path = public',
        (select case
                  when count(*) = 0 then 'ไม่มีฟังก์ชัน'
                  when bool_and(p.prosecdef and p.proconfig = array['search_path=public']) then 'ถูกต้อง'
                  else 'ผิด — รันไฟล์นี้ซ้ำ'
                end
           from pg_proc as p
          where p.pronamespace = 'public'::regnamespace and p.proname = 'channel_order_apply')),
    (5, 'ฟังก์ชันที่เรียก channel_order_apply ยังอยู่ครบ 4 ตัว',
        (select case
                  when count(*) filter (where to_regprocedure(f.sig) is null) = 0 then 'ถูกต้อง'
                  else 'ขาด ' || count(*) filter (where to_regprocedure(f.sig) is null)
                       || ' ตัว — รัน supabase-fix-03-integrations.sql แล้วรันไฟล์นี้ซ้ำ'
                end
           from unnest(array['public.record_channel_order(uuid, jsonb, text)',
                             'public.cancel_channel_order(uuid, text, text, text, boolean, timestamptz)',
                             'public.confirm_return_restock(uuid, integer)',
                             'public.resolve_channel_order(uuid, text)']) as f(sig))),
    (6, 'ขาย/ยกเลิกบิล/คืนสินค้า/ปรับยอดตรวจนับ/รับ-จ่ายสต๊อก ล็อกสินค้าแบบ no key update',
        (select case
                  when count(*) filter (where f.def is null) > 0
                    then 'ไม่มีฟังก์ชัน ' || string_agg(f.name, ', ' order by f.ord) filter (where f.def is null)
                         || ' — รัน supabase-fix-01.sql ถึง supabase-fix-04-pos.sql แล้วรันไฟล์นี้ซ้ำ'
                  when count(*) filter (where position(f.new_lock in f.def) = 0 or position(f.old_lock in f.def) > 0) > 0
                    then 'ยังเป็นแบบเดิม (' || string_agg(f.name, ', ' order by f.ord)
                                              filter (where position(f.new_lock in f.def) = 0
                                                         or position(f.old_lock in f.def) > 0)
                         || ') — รันไฟล์นี้ซ้ำ'
                  else 'ถูกต้อง'
                end
           from (select s.ord, s.name, s.new_lock, s.old_lock,
                        regexp_replace(lower(pg_get_functiondef(to_regprocedure(s.sig))), '\s+', ' ', 'g') as def
                   from (values
                     (1, 'record_sale', 'public.record_sale(uuid, jsonb, numeric, text, text, text, numeric)',
                         'order by p.id for no key update', 'order by p.id for update'),
                     (2, 'void_sale', 'public.void_sale(uuid, text)',
                         'order by p.id for no key update', 'order by p.id for update'),
                     (3, 'return_sale_items', 'public.return_sale_items(uuid, uuid, jsonb, text, text, boolean)',
                         'order by p.id for no key update', 'order by p.id for update'),
                     (4, 'apply_stock_count', 'public.apply_stock_count(uuid)',
                         'order by p.id for no key update', 'order by p.id for update'),
                     (5, 'move_stock', 'public.move_stock(uuid, text, integer, text)',
                         'where p.id = p_product_id for no key update', 'where p.id = p_product_id for update')
                   ) as s(ord, name, sig, new_lock, old_lock)) as f)),
    (7, 'ฟังก์ชันในแถว 6 เป็น security definer + search_path = public, ผู้ล็อกอินเรียกได้, anon เรียกไม่ได้',
        (select case
                  when count(*) filter (where f.oid is null) > 0 then 'ไม่มีฟังก์ชัน — ดูแถว 6'
                  when count(*) filter (where not f.good) > 0
                    then 'ผิด (' || string_agg(f.name, ', ' order by f.ord) filter (where not f.good) || ') — รันไฟล์นี้ซ้ำ'
                  else 'ถูกต้อง'
                end
           from (select s.ord, s.name, p.oid,
                        coalesce(p.prosecdef and p.proconfig = array['search_path=public']
                                 and has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                 and not has_function_privilege('anon', p.oid, 'EXECUTE')
                                 and not exists (select 1
                                                   from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as a
                                                  where a.grantee = 0 and a.privilege_type = 'EXECUTE'), false) as good
                   from (values
                     (1, 'record_sale', 'public.record_sale(uuid, jsonb, numeric, text, text, text, numeric)'),
                     (2, 'void_sale', 'public.void_sale(uuid, text)'),
                     (3, 'return_sale_items', 'public.return_sale_items(uuid, uuid, jsonb, text, text, boolean)'),
                     (4, 'apply_stock_count', 'public.apply_stock_count(uuid)'),
                     (5, 'move_stock', 'public.move_stock(uuid, text, integer, text)')
                   ) as s(ord, name, sig)
                   left join pg_proc as p on p.oid = to_regprocedure(s.sig)) as f))
  ) as x(ord, item, value)
 order by x.ord;
