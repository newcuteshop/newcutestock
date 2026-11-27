-- =========================================================================
-- supabase-fix-11-wedding-source-detail.sql — ร้าน b.oncloud: "ชื่อช่องทางติดต่อ" ต่องาน
--
-- บอสสั่ง 27/11/2569 (แคปหน้าฟอร์มสร้างงาน ช่อง "ลูกค้าติดต่อมาทาง")
--   "ถ้าเลือกช่องทางไหน ต้องมีให้ใส่ชื่อช่องทางนั้นด้วย"
--   เลือก Facebook ต้องใส่ชื่อ Facebook ของลูกค้าได้ (IG / LINE / TikTok / ลูกค้าแนะนำ ... ก็เช่นกัน)
--   แล้วขึ้นในใบยืนยันการจองช่อง "ช่องทางติดต่อ" แบบฟอร์มกระดาษของร้าน เช่น "FB: Phodjanee Dicharoen"
--
-- ไฟล์นี้ทำอะไร (ไม่แตะยอดเงิน/งวด/สถานะ ไม่แก้ข้อมูลงานเดิม — งานเดิมทุกงานยังว่าง = แสดงแบบเดิม)
--   1) เพิ่มคอลัมน์ wed_bookings.source_detail (ข้อความ ไม่บังคับ ไม่เกิน 200 ตัวอักษร — ว่าง = null)
--      เก็บที่ "งาน" (คู่กับช่องทางของงาน wed_bookings.source) ไม่ใช่ที่ลูกค้า: ลูกค้าคนเดิมติดต่อมาคนละช่องทางได้ในแต่ละงาน
--   2) สร้าง 4 ฟังก์ชันใหม่ — คัดลอกจาก supabase-fix-07-wedding.sql ทุกตัวอักษร เพิ่มเฉพาะบรรทัดที่มีคำว่า source_detail หรือ fix-11
--        wed_read_head      อ่าน source_detail จากฟอร์ม (ตัดช่องว่างหัวท้าย, ว่าง = null, เกิน 200 = แจ้งเตือนภาษาไทย,
--                           ไม่ส่งคีย์ตอนแก้งาน = คงค่าเดิม) — ตัวช่วยเดียวกับช่องข้อความอื่นของหัวงาน (wed_json_text)
--        wed_create_booking บันทึกตอนสร้างงาน
--        wed_update_booking บันทึกตอนแก้งาน + จดในประวัติงาน [เดิม, ใหม่] เฉพาะตอนเปลี่ยน
--                           (จดการเปลี่ยน "ช่องทาง" ด้วย เช่น Facebook → LINE — fix-07 ไม่ได้จด อ่านประวัติแล้วสับสน)
--        wed_booking_json   ส่ง source_detail ให้หน้าจอ/เอกสาร
--      ชื่อพารามิเตอร์/ผลลัพธ์/security definer/search_path/สิทธิ์เรียกใช้ เหมือน fix-07 ทุกอย่าง
--   ส่งรหัสคำขอสร้างงาน (client_id) เดิมซ้ำ ยังได้งานเดิมเหมือนเดิม (ลายนิ้วมือข้อมูลรวมชื่อช่องทางไปด้วย ข้อมูลชุดเดิม = ตรงกัน)
--
-- วิธีใช้: Supabase > SQL Editor > วางทั้งไฟล์ > กด Run
--   - ต้องรัน supabase-fix-07-wedding.sql มาก่อนแล้ว (ไฟล์นี้ตรวจให้ ถ้ายังไม่ได้รันจะหยุดทันทีโดยไม่แก้อะไร)
--   - รันซ้ำได้ปลอดภัย (ทั้งไฟล์สำเร็จทั้งหมดหรือไม่เปลี่ยนอะไรเลย) ชื่อช่องทางที่บันทึกไว้แล้วไม่หาย ไม่ต้องหยุดร้าน
--   - ถ้ารัน supabase-fix-07-wedding.sql ซ้ำภายหลัง 4 ฟังก์ชันนี้จะกลับเป็นแบบเดิม (ชื่อช่องทางยังอยู่ในฐานข้อมูล
--     แต่หน้าจอไม่เห็น/บันทึกไม่ได้) → ต้องรันไฟล์นี้ซ้ำต่อท้ายเสมอ (ตารางตรวจผลท้ายไฟล์จะขึ้น "ยังเป็นแบบเดิม")
--   - รันเสร็จแล้ว SQL Editor จะแสดงตารางตรวจผล — ทุกแถวต้องเป็น "ถูกต้อง"
-- =========================================================================

begin;

-- =========================================================================
-- 0) ตรวจของที่ต้องมีก่อน (fix-07: ระบบ b.oncloud รุ่นที่มีมัดจำกำหนดเอง)
-- =========================================================================
do $$
begin
  if to_regclass('public.wed_bookings') is null or to_regclass('public.wed_customers') is null
     or to_regclass('public.wed_logs') is null then
    raise exception 'ต้องรัน supabase-fix-07-wedding.sql ให้เสร็จก่อน แล้วค่อยรันไฟล์นี้ (ยังไม่ได้แก้อะไรในฐานข้อมูล)';
  end if;
  if not exists (select 1 from pg_attribute as a
                  where a.attrelid = 'public.wed_bookings'::regclass and a.attname = 'deposit_override' and not a.attisdropped)
     or to_regprocedure('public.wed_read_head(jsonb, public.wed_bookings)') is null
     or to_regprocedure('public.wed_create_booking(uuid, jsonb)') is null
     or to_regprocedure('public.wed_update_booking(uuid, timestamptz, jsonb)') is null
     or to_regprocedure('public.wed_booking_json(uuid)') is null
     or to_regprocedure('public.wed_booking_mini(uuid)') is null
     or to_regprocedure('public.wed_json_text(jsonb, text, integer)') is null
     or to_regprocedure('public.wed_payload_md5(jsonb)') is null
     or to_regprocedure('public.wed_log(uuid, text, jsonb, text)') is null
     or to_regprocedure('public.wed_lock_booking(uuid)') is null
     or to_regprocedure('public.wed_customer_write(uuid, jsonb, uuid)') is null
     or to_regprocedure('public.wed_recalc(uuid)') is null
     or to_regprocedure('public.wed_installments_json(uuid)') is null
     or to_regprocedure('public.wed_next_due_json(uuid)') is null then
    raise exception 'ต้องรัน supabase-fix-07-wedding.sql (รุ่นล่าสุด) ให้เสร็จก่อน แล้วค่อยรันไฟล์นี้ (ยังไม่ได้แก้อะไรในฐานข้อมูล)';
  end if;
end
$$;

-- =========================================================================
-- 1) คอลัมน์ชื่อช่องทางติดต่อ (งานเดิม = null = แสดงแบบเดิม)
-- =========================================================================
--   source_detail: ชื่อของลูกค้าในช่องทางที่ติดต่อมา (ชื่อ Facebook / ชื่อ IG / LINE ID / ผู้แนะนำ / ลิงก์เว็บ ...)
alter table public.wed_bookings add column if not exists source_detail text
  constraint wed_bookings_source_detail_check check (source_detail is null or char_length(source_detail) between 1 and 200);

-- =========================================================================
-- 2) หัวงานจาก payload — เหมือน fix-07 + อ่าน source_detail
-- =========================================================================
-- หัวงานจาก payload (คีย์ที่ไม่ส่งมา = คงค่าเดิมของ p_old; p_old.id = null → งานใหม่)
--   แพ็กเกจ: package_id → จำชื่อ/ราคา/ชั่วโมง/รายละเอียด/แผนงานส่ง ณ ตอนเลือก; ส่ง package_name/package_price/... มาด้วย = แก้เฉพาะงานนี้
--   แผนงานส่ง (deliverables_plan) แก้ได้จนกว่าจะยืนยันงาน (หลังยืนยันให้แก้ที่รายการส่งงานแทน)
--   ชื่อช่องทางติดต่อ (source_detail) ไม่ส่ง = คงค่าเดิม / null หรือช่องว่าง = ไม่มี
create or replace function public.wed_read_head(p jsonb, p_old public.wed_bookings)
returns public.wed_bookings
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.wed_bookings := p_old;
  v_new boolean := p_old.id is null;
  v_pkg_id uuid;
  pk public.wed_packages%rowtype;
  v_plan_open boolean;
  v_plan jsonb;
  v_num numeric;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'ข้อมูลงานไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  v_plan_open := v_new or p_old.status in ('inquiry', 'hold') or (p_old.status = 'postponed' and p_old.confirmed_at is null);
  if v_new then
    b.package_price := 0;
    b.travel_fee := 0;
    b.discount := 0;
    b.deliverables_plan := '[]'::jsonb;
  end if;

  if v_new or p ? 'couple_names' then
    b.couple_names := public.wed_json_text(p -> 'couple_names', 'ชื่อคู่บ่าวสาว', 120);
    if b.couple_names is null then
      raise exception 'กรุณากรอกชื่อคู่บ่าวสาว (เช่น คุณมิว & คุณเจ)';
    end if;
  end if;

  if v_new or p ? 'package_id' then
    v_pkg_id := public.product_json_uuid(p -> 'package_id', 'แพ็กเกจ');
    if v_pkg_id is not null and (v_new or v_pkg_id is distinct from p_old.package_id) then
      select x.* into pk from public.wed_packages as x where x.id = v_pkg_id;
      if not found then
        raise exception 'ไม่พบแพ็กเกจที่เลือก (อาจถูกลบไปแล้ว) กรุณาโหลดหน้าใหม่';
      end if;
      if not pk.is_active then
        raise exception 'แพ็กเกจ "%" ปิดใช้งานแล้ว กรุณาเลือกแพ็กเกจอื่น', pk.name;
      end if;
      b.package_id := pk.id;
      b.package_name := pk.name;
      b.package_price := pk.price;
      b.package_hours := pk.hours;
      b.package_description := pk.description;
      if v_plan_open then
        b.deliverables_plan := coalesce(pk.deliverables, '[]'::jsonb);
      end if;
    elsif v_pkg_id is null then
      b.package_id := null;
    end if;
  end if;
  if p ? 'package_name' then
    b.package_name := public.wed_json_text(p -> 'package_name', 'ชื่อแพ็กเกจ', 100);
  end if;
  if p ? 'package_price' then
    b.package_price := coalesce(public.wed_json_money(p -> 'package_price', 'ราคาแพ็กเกจ', true), 0);
  end if;
  if p ? 'package_hours' then
    v_num := public.product_json_num(p -> 'package_hours', 'ชั่วโมงของแพ็กเกจ');
    if v_num is not null and (v_num < 0 or v_num > 999.9 or v_num <> round(v_num, 1)) then
      raise exception 'ชั่วโมงของแพ็กเกจต้องอยู่ระหว่าง 0 ถึง 999.9 (ทศนิยม 1 ตำแหน่ง)';
    end if;
    b.package_hours := v_num;
  end if;
  if p ? 'package_description' then
    b.package_description := public.wed_json_longtext(p -> 'package_description', 'รายละเอียดแพ็กเกจ', 3000);
  end if;
  if b.package_id is null and b.package_name is null and b.package_price > 0 then
    raise exception 'กรุณาใส่ชื่อแพ็กเกจ';
  end if;

  if p ? 'deliverables_plan' then
    v_plan := public.wed_read_plan(p -> 'deliverables_plan');
    if not v_plan_open and v_plan is distinct from coalesce(p_old.deliverables_plan, '[]'::jsonb) then
      raise exception 'แผนงานที่ส่งแก้ได้ก่อนยืนยันงานเท่านั้น — หลังยืนยันให้แก้ที่รายการส่งงานของงานนี้';
    end if;
    b.deliverables_plan := v_plan;
  end if;

  if p ? 'travel_fee' then
    b.travel_fee := coalesce(public.wed_json_money(p -> 'travel_fee', 'ค่าเดินทาง', true), 0);
  end if;
  if p ? 'discount' then
    b.discount := coalesce(public.wed_json_money(p -> 'discount', 'ส่วนลด', true), 0);
  end if;
  if v_new or p ? 'discount_note' then
    b.discount_note := public.wed_json_text(p -> 'discount_note', 'หมายเหตุส่วนลด', 200);
  end if;
  -- มัดจำกำหนดเอง (บาท): ไม่ส่งคีย์ = คงค่าเดิม / null หรือช่องว่าง = กลับไปคิดอัตโนมัติ / 0 = งานนี้ไม่ต้องมัดจำ
  --   (สิทธิ์เดียวกับส่วนลด/ค่าเดินทาง — ทุกคนที่แก้ฟอร์มงานได้)
  if v_new then
    b.deposit_override := null;
  end if;
  if p ? 'deposit_override' then
    b.deposit_override := public.wed_json_money(p -> 'deposit_override', 'มัดจำ', true);
  end if;
  if v_new or p ? 'followup_date' then
    b.followup_date := public.wed_json_date(p -> 'followup_date', 'วันที่ต้องติดตามลูกค้า');
  end if;
  if v_new or p ? 'followup_note' then
    b.followup_note := public.wed_json_text(p -> 'followup_note', 'เรื่องที่ต้องติดตาม', 500);
  end if;
  if v_new or p ? 'coordinator_name' then
    b.coordinator_name := public.wed_json_text(p -> 'coordinator_name', 'ชื่อผู้ประสานงานวันงาน', 100);
  end if;
  if v_new or p ? 'coordinator_phone' then
    b.coordinator_phone := public.wed_json_text(p -> 'coordinator_phone', 'เบอร์ผู้ประสานงานวันงาน', 50);
  end if;
  if v_new or p ? 'mood_link' then
    b.mood_link := public.wed_json_url(p -> 'mood_link', 'ลิงก์มู้ดแอนด์โทน', 500);
  end if;
  if v_new or p ? 'customer_note' then
    b.customer_note := public.wed_json_longtext(p -> 'customer_note', 'ความต้องการของลูกค้า', 2000);
  end if;
  if v_new or p ? 'note' then
    b.note := public.wed_json_longtext(p -> 'note', 'หมายเหตุภายใน', 2000);
  end if;
  if v_new or p ? 'balance_due_date_override' then
    b.balance_due_date_override := public.wed_json_date(p -> 'balance_due_date_override', 'วันชำระยอดคงเหลือ');
  end if;
  -- fix-11 source_detail: ชื่อในช่องทางที่ลูกค้าติดต่อมา (เช่น ชื่อ Facebook) — ไม่ส่งคีย์ = คงค่าเดิม / ว่าง = ไม่มี (null)
  if v_new or p ? 'source_detail' then b.source_detail := public.wed_json_text(p -> 'source_detail', 'ชื่อช่องทางติดต่อ', 200); end if;
  return b;
end;
$$;

-- =========================================================================
-- 3) งานแบบเต็ม — เหมือน fix-07 + ส่ง source_detail
-- =========================================================================
-- งานแบบเต็ม (หน้ารายละเอียดงาน / ผลของทุกฟังก์ชันที่แก้งาน)
create or replace function public.wed_booking_json(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.wed_bookings%rowtype;
  c public.wed_customers%rowtype;
  v_mgr boolean := public.wed_manager();
  v_today date := public.pos_bkk_today();
  v_conf jsonb;
  v_sessions jsonb;
  v_crew_cost numeric;
  v_money jsonb;
  v_dated boolean;
  v_future boolean;
  v_dates date[];
  v_can jsonb;
  v_reasons jsonb;
  v_deliv_open integer;
  v_deliv_total integer;
  v_undated boolean;
begin
  select x.* into b from public.wed_bookings as x where x.id = p_booking_id;
  if not found then
    return null;
  end if;
  select x.* into c from public.wed_customers as x where x.id = b.customer_id;

  -- งานยกเลิก/เลื่อนงานไม่กันคิว → ไม่มีทีมชนคิวให้แก้ (คนอื่นก็ไม่เห็นงานนี้ชน) / สอบถามยังเตือนไว้ล่วงหน้า
  v_conf := case when b.status in ('cancelled', 'postponed') then '[]'::jsonb
                 else public.wed_conflicts(public.wed_session_rows(b.id), b.id, b.booking_no, b.couple_names) end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', ss.id, 'session_type', ss.session_type, 'type_label', public.wed_type_label(ss.session_type),
           'title', ss.title, 'date', ss.date, 'start_time', public.wed_hhmm(ss.start_time),
           'end_time', public.wed_hhmm(ss.end_time), 'call_time', public.wed_hhmm(ss.call_time),
           'venue_name', ss.venue_name, 'venue_address', ss.venue_address, 'map_url', ss.map_url,
           'venue_contact', ss.venue_contact, 'dress_code', ss.dress_code, 'notes', ss.notes, 'run_sheet', ss.run_sheet,
           'status', ss.status, 'sort_order', ss.sort_order,
           'crew', public.wed_session_crew_json(ss.id, v_mgr),
           'conflicts', coalesce((select jsonb_agg(cf.elem) from jsonb_array_elements(v_conf) as cf(elem)
                                   where cf.elem ->> 'this_session_id' = ss.id::text), '[]'::jsonb))
           order by ss.sort_order, ss.date nulls last, ss.start_time nulls last, ss.id), '[]'::jsonb),
         coalesce(bool_or(ss.status <> 'cancelled' and ss.date is not null), false),
         coalesce(bool_or(ss.status = 'scheduled' and (ss.date is null or ss.date > v_today)), false),
         array_agg(ss.date) filter (where ss.status <> 'cancelled' and ss.date is not null),
         coalesce(bool_or(ss.status <> 'cancelled' and ss.date is null), false)
    into v_sessions, v_dated, v_future, v_dates, v_undated
    from public.wed_sessions as ss
   where ss.booking_id = b.id;

  select count(*), count(*) filter (where d.status <> 'delivered')
    into v_deliv_total, v_deliv_open
    from public.wed_deliverables as d where d.booking_id = b.id;

  v_money := jsonb_build_object(
    'package_price', b.package_price, 'addons_total', b.addons_total, 'travel_fee', b.travel_fee,
    'discount', b.discount, 'discount_note', b.discount_note,
    'pre_discount_total', b.package_price + b.addons_total + b.travel_fee,
    'base_total', b.base_total, 'charges_total', b.charges_total, 'grand_total', b.grand_total,
    'paid', b.paid, 'due', b.due, 'deposit_required', b.deposit_required, 'deposit_met', b.deposit_met,
    'deposit_due', greatest(b.deposit_required - b.paid, 0),
    'deposit_percent', b.deposit_percent, 'min_deposit', b.min_deposit, 'balance_due_days', b.balance_due_days,
    'balance_due_date', b.balance_due_date, 'balance_due_date_override', b.balance_due_date_override,
    -- มัดจำกำหนดเอง: deposit_source = 'manual' → หน้าจอ/เอกสารห้ามเขียนว่า "N% ของยอดงาน"
    'deposit_override', b.deposit_override,
    'deposit_source', case when b.deposit_override is null then 'auto' else 'manual' end);
  if v_mgr then
    -- ค่าตัวของคิวที่ไม่ยกเลิก + ค่าตัวที่จ่ายไปแล้ว (จ่ายแล้วเป็นต้นทุนจริงเสมอ แม้คิวถูกยกเลิกทีหลัง)
    select coalesce(sum(sc.fee), 0) into v_crew_cost
      from public.wed_session_crew as sc
      join public.wed_sessions as ss on ss.id = sc.session_id
     where ss.booking_id = b.id and (ss.status <> 'cancelled' or sc.fee_paid_on is not null);
    v_money := v_money || jsonb_build_object('crew_cost_total', v_crew_cost,
                                             'profit', b.base_total + b.charges_total - v_crew_cost);
  end if;

  v_can := jsonb_build_object(
    'can_edit', b.status in ('inquiry', 'hold', 'confirmed', 'postponed', 'in_production'),
    'can_hold', b.status = 'inquiry' and v_dated and not v_undated,
    'can_extend_hold', b.status = 'hold',
    'can_release', b.status = 'hold',
    'can_confirm', b.status in ('inquiry', 'hold') and v_dated and not v_undated,
    'can_mark_shot', b.status = 'confirmed',
    'can_mark_delivered', b.status = 'in_production',
    'can_complete', b.status = 'delivered' and abs(b.due) < 0.005,
    'can_reopen', b.status = 'completed' and v_mgr,
    'can_postpone', b.status in ('hold', 'confirmed'),
    'can_resume', b.status = 'postponed',
    'can_cancel', b.status in ('inquiry', 'hold', 'confirmed', 'postponed')
                  or (b.status in ('in_production', 'delivered') and v_mgr),
    'can_pay', b.status <> 'cancelled' and b.due > 0.005,
    'can_refund', b.paid > 0.005 and b.status <> 'completed',
    'can_add_charge', public.wed_charges_open(b.status, b.status_before_postpone),
    'can_set_installments', b.status not in ('cancelled', 'completed'),
    'can_edit_deliverables', b.status <> 'cancelled',
    'can_set_followup', b.status <> 'cancelled');

  v_reasons := jsonb_build_object(
    'hold', case when b.status <> 'inquiry' then 'ล็อกคิวได้เฉพาะงานที่ยังเป็น "สอบถาม"'
                 when not v_dated then 'ต้องมีคิวงานที่ระบุวันที่อย่างน้อย 1 คิวก่อน'
                 when v_undated then 'กรุณาระบุวันที่ของทุกคิวงานก่อน (หรือยกเลิกคิวที่ยังไม่มีวัน)' end,
    'confirm', case when b.status not in ('inquiry', 'hold') then 'ยืนยันได้เฉพาะงานที่สอบถามหรือล็อกคิวอยู่'
                    when not v_dated then 'ต้องมีคิวงานที่ระบุวันที่อย่างน้อย 1 คิวก่อน'
                    when v_undated then 'กรุณาระบุวันที่ของทุกคิวงานก่อน (หรือยกเลิกคิวที่ยังไม่มีวัน)' end,
    'confirm_warning', case when b.status in ('inquiry', 'hold') and not b.deposit_met
                            then 'ยังไม่ได้รับมัดจำครบ (ขาด ' || public.wed_baht(greatest(b.deposit_required - b.paid, 0))
                                 || ') — ยืนยันได้ด้วยการกดยืนยันแบบบังคับ' end,
    'mark_shot', case when b.status <> 'confirmed' then 'บันทึกถ่ายเสร็จได้เฉพาะงานที่ยืนยันแล้ว' end,
    'mark_shot_warning', case when b.status = 'confirmed' and v_future
                              then 'ยังมีคิวงานที่ยังไม่ถึงวัน (หรือยังไม่ระบุวัน) — ต้องกดยืนยันแบบบังคับ' end,
    'mark_delivered', case when b.status <> 'in_production' then 'บันทึกส่งงานได้เฉพาะงานที่ถ่ายเสร็จแล้ว' end,
    'complete', case when b.status not in ('delivered', 'in_production') then 'ปิดงานได้หลังส่งงานแล้วเท่านั้น'
                     when b.due > 0.005 then 'ยังค้างชำระ ' || public.wed_baht(b.due)
                     when b.due < -0.005 then 'รับเงินเกิน ' || public.wed_baht(-b.due) || ' ต้องคืนเงินก่อน' end,
    'complete_warning', case when b.status = 'in_production'
                             then 'ยังไม่ได้บันทึกส่งงาน (ค้าง ' || v_deliv_open || ' รายการ) — ต้องกดยืนยันแบบบังคับ' end,
    'cancel', case when b.status = 'cancelled' then 'งานนี้ยกเลิกแล้ว'
                   when b.status = 'completed' then 'งานที่ปิดแล้วยกเลิกไม่ได้'
                   when b.status in ('in_production', 'delivered') and not v_mgr
                     then 'งานที่ถ่ายแล้วยกเลิกได้เฉพาะผู้จัดการ' end,
    'pay', case when b.status = 'cancelled' then 'งานที่ยกเลิกรับชำระไม่ได้ (บันทึกคืนเงินได้)'
                when b.due <= 0.005 then 'ไม่มียอดค้างชำระ' end,
    'refund', case when b.status = 'completed' then 'งานที่ปิดแล้วคืนเงินไม่ได้ (เปิดงานใหม่ก่อน)'
                   when b.paid <= 0.005 then 'ยังไม่มีเงินที่ชำระไว้ให้คืน' end,
    'add_charge', case when not public.wed_charges_open(b.status, b.status_before_postpone)
                       then 'เพิ่มค่าใช้จ่ายได้ตั้งแต่ยืนยันงานจนถึงส่งงาน (รวมงานที่ยืนยันแล้วถูกเลื่อน)' end);

  return public.wed_booking_mini(b.id)
    || jsonb_build_object(
      'status_before_postpone', b.status_before_postpone,
      'source_detail', b.source_detail,
      'public_token', b.public_token,
      'public_url_path', '/wedding-status/' || b.public_token,
      'customer', jsonb_build_object('id', c.id, 'name', c.name, 'partner_name', c.partner_name, 'phone', c.phone,
                                     'phone2', c.phone2, 'line_id', c.line_id, 'instagram', c.instagram,
                                     'facebook', c.facebook, 'email', c.email, 'address', c.address,
                                     'source', c.source, 'source_label', public.wed_source_label(c.source), 'note', c.note),
      'package', jsonb_build_object('id', b.package_id, 'name', b.package_name, 'price', b.package_price,
                                    'hours', b.package_hours, 'description', b.package_description),
      'deliverables_plan', b.deliverables_plan,
      'addons', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'addon_id', a.addon_id, 'name', a.name,
                                                              'unit', a.unit, 'qty', a.qty, 'unit_price', a.unit_price,
                                                              'amount', a.amount, 'sort_order', a.sort_order)
                                           order by a.sort_order, a.id)
                            from public.wed_booking_addons as a where a.booking_id = b.id), '[]'::jsonb),
      'travel_fee', b.travel_fee, 'discount', b.discount, 'discount_note', b.discount_note,
      'sessions', v_sessions,
      'crew_conflicts', v_conf,
      'capacity_warnings', case when public.wed_counting(b.status)
                                then public.wed_capacity_check(b.id, v_dates) else '[]'::jsonb end,
      'money', v_money,
      'installments', public.wed_installments_json(b.id),
      'installments_custom', b.installments_custom,
      'next_due', public.wed_next_due_json(b.id))
    || jsonb_build_object(
      'charges', coalesce((select jsonb_agg(jsonb_build_object(
                                   'id', ch.id, 'kind', ch.kind, 'kind_label', public.wed_charge_label(ch.kind),
                                   'description', ch.description, 'amount', ch.amount, 'voided_at', ch.voided_at,
                                   'void_reason', ch.void_reason, 'created_by_name', ch.created_by_name,
                                   'created_at', ch.created_at) order by ch.created_at, ch.id)
                             from public.wed_charges as ch where ch.booking_id = b.id), '[]'::jsonb),
      'payments', coalesce((select jsonb_agg(public.wed_payment_json(p.id) - 'booking_id' - 'booking_no' - 'couple_names'
                                             order by p.created_at, p.id)
                              from public.wed_payments as p where p.booking_id = b.id), '[]'::jsonb),
      'deliverables', coalesce((select jsonb_agg(public.wed_deliverable_json(d.id) order by d.sort_order, d.due_date nulls last, d.id)
                                  from public.wed_deliverables as d where d.booking_id = b.id), '[]'::jsonb),
      'deliverables_summary', jsonb_build_object('total', v_deliv_total, 'open', v_deliv_open,
                                                 'delivered', v_deliv_total - v_deliv_open),
      'logs', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'action', z.action, 'detail', z.detail,
                                                            'actor_name', z.actor_name, 'created_at', z.created_at)
                                         order by z.id desc)
                          from (select lg.* from public.wed_logs as lg where lg.booking_id = b.id
                                 order by lg.id desc limit 200) as z), '[]'::jsonb),
      'coordinator_name', b.coordinator_name, 'coordinator_phone', b.coordinator_phone, 'mood_link', b.mood_link,
      'customer_note', b.customer_note, 'note', b.note, 'cancel_reason', b.cancel_reason,
      'postpone_reason', b.postpone_reason,
      'actions', v_can || jsonb_build_object('block_reasons', v_reasons),
      'created_by_name', b.created_by_name, 'confirmed_at', b.confirmed_at, 'shot_at', b.shot_at,
      'delivered_at', b.delivered_at, 'completed_at', b.completed_at, 'cancelled_at', b.cancelled_at,
      'postponed_at', b.postponed_at);
end;
$$;

-- =========================================================================
-- 4) สร้างงาน — เหมือน fix-07 + บันทึก source_detail
-- =========================================================================
-- สร้างงาน — p_client_id ส่งซ้ำ = คืนงานเดิม already_saved = true (ไม่รับเงินซ้ำ)
--   payload: {customer_id? | customer:{...}, couple_names, status? ('inquiry'|'hold'|'confirmed'), hold_hours?, source?,
--             source_detail? (ชื่อช่องทางติดต่อ เช่น ชื่อ Facebook ของลูกค้า),
--             package_id? | package_name/package_price/package_hours/package_description, deliverables_plan?,
--             addons:[...], travel_fee, discount, discount_note, sessions:[...], followup_date, followup_note,
--             coordinator_name, coordinator_phone, mood_link, customer_note, note, balance_due_date_override?,
--             deposit_override? (มัดจำกำหนดเอง บาท / null = อัตโนมัติ),
--             force? (คิวเต็ม / ยืนยันก่อนได้มัดจำ), payments?:[{kind:'payment', method, amount, note?, paid_on?, purpose?, slip_path?}]}
create or replace function public.wed_create_booking(p_client_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.wed_settings;
  v_uid uuid;
  v_mgr boolean;
  v_found uuid;
  v_md5 text;
  v_status text;
  v_force boolean;
  v_hold integer;
  v_cust uuid;
  c public.wed_customers%rowtype;
  v_source text;
  b public.wed_bookings;
  v_rows jsonb;
  v_addons jsonb;
  v_pre numeric;
  v_dates date[];
  v_warn jsonb;
  v_id uuid;
  v_pay jsonb;
begin
  v_uid := public.wed_require(false);
  perform public.wed_expire_holds();
  if p_client_id is null then
    raise exception 'รหัสคำขอไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  select x.id, x.client_payload_md5 into v_found, v_md5 from public.wed_bookings as x where x.client_id = p_client_id;
  if found then
    -- payload_matches: true = ส่งข้อมูลชุดเดิมซ้ำ (เน็ตหลุด) / false = รหัสเดิมแต่ข้อมูลอื่น (แท็บที่ทำซ้ำ/ฟอร์มถูกแก้หลังส่ง)
    return jsonb_build_object('already_saved', true,
      'payload_matches', case when v_md5 is null then null else v_md5 = public.wed_payload_md5(p_payload) end,
      'booking', public.wed_booking_json(v_found));
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'ข้อมูลงานไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  s := public.wed_settings_row();
  v_mgr := public.wed_manager();

  v_status := coalesce(public.wed_json_text(p_payload -> 'status', 'สถานะงาน', 20), 'inquiry');
  if v_status not in ('inquiry', 'hold', 'confirmed') then
    raise exception 'สถานะเริ่มต้นของงานต้องเป็น "สอบถาม" "ล็อกคิว" หรือ "ยืนยันแล้ว"';
  end if;
  v_force := coalesce(public.product_json_bool(p_payload -> 'force', 'การยืนยัน'), false);
  v_hold := coalesce(public.wed_json_int(p_payload -> 'hold_hours', 'เวลาล็อกคิว (ชั่วโมง)', 1, 720), s.hold_hours);
  if p_payload ? 'payments' and jsonb_typeof(p_payload -> 'payments') not in ('array', 'null') then
    raise exception 'ข้อมูลการรับเงินไม่ถูกต้อง';
  end if;

  -- ลูกค้า: เลือกจากที่มี หรือสร้างใหม่จากฟอร์ม
  v_cust := public.product_json_uuid(p_payload -> 'customer_id', 'ลูกค้า');
  if v_cust is null then
    if jsonb_typeof(p_payload -> 'customer') is distinct from 'object' then
      raise exception 'กรุณาเลือกหรือกรอกข้อมูลลูกค้า';
    end if;
    v_cust := public.wed_customer_write(null, p_payload -> 'customer', null);
  end if;
  select x.* into c from public.wed_customers as x where x.id = v_cust;
  if not found then
    raise exception 'ไม่พบข้อมูลลูกค้า กรุณาเลือกลูกค้าใหม่';
  end if;
  v_source := coalesce(public.wed_json_text(p_payload -> 'source', 'ช่องทางที่ลูกค้าติดต่อ', 20), c.source, 'other');
  if v_source not in ('instagram', 'facebook', 'tiktok', 'line', 'referral', 'walkin', 'website', 'other') then
    raise exception 'ช่องทางที่ลูกค้าติดต่อไม่ถูกต้อง';
  end if;

  b := public.wed_read_head(p_payload, null::public.wed_bookings);
  v_rows := public.wed_read_sessions(p_payload -> 'sessions', null, v_status <> 'inquiry', v_mgr);
  v_addons := public.wed_read_addons(p_payload -> 'addons', null);
  select b.package_price + coalesce(sum((e.elem ->> 'amount')::numeric), 0) + b.travel_fee into v_pre
    from jsonb_array_elements(v_addons) as e(elem);
  if b.discount > v_pre then
    raise exception 'ส่วนลด (%) มากกว่ายอดก่อนส่วนลด (%)', public.wed_baht(b.discount), public.wed_baht(v_pre);
  end if;
  v_dates := public.wed_rows_dates(v_rows);
  if v_status <> 'inquiry' then
    perform public.wed_capacity_lock(v_dates);
    v_warn := public.wed_capacity_check(null, v_dates);
    if jsonb_array_length(v_warn) > 0 and not v_force then
      perform public.wed_capacity_raise(v_warn);
    end if;
  end if;

  begin
    insert into public.wed_bookings as x
      (booking_no, client_id, client_payload_md5, public_token, source, customer_id, couple_names, status,
       package_id, package_name, package_price, package_hours, package_description, deliverables_plan,
       travel_fee, discount, discount_note, deposit_percent, min_deposit, balance_due_days, balance_due_date_override,
       deposit_override,
       hold_until, followup_date, followup_note, coordinator_name, coordinator_phone, mood_link, customer_note, note,
       source_detail,
       created_by, created_by_name)
    values
      (public.wed_next_no('wedding'), p_client_id, public.wed_payload_md5(p_payload),
       replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
       v_source, v_cust, b.couple_names, case when v_status = 'hold' then 'hold' else 'inquiry' end,
       b.package_id, b.package_name, b.package_price, b.package_hours, b.package_description, b.deliverables_plan,
       b.travel_fee, b.discount, b.discount_note, s.deposit_percent, s.min_deposit, s.balance_due_days,
       b.balance_due_date_override, b.deposit_override,
       case when v_status = 'hold' then now() + make_interval(hours => v_hold) end,
       b.followup_date, b.followup_note, b.coordinator_name, b.coordinator_phone, b.mood_link, b.customer_note, b.note,
       b.source_detail,
       v_uid, public.pos_actor_name(v_uid))
    returning x.id into v_id;
  exception when unique_violation then
    raise exception 'งานนี้กำลังบันทึกจากอีกเครื่อง กรุณาโหลดหน้าใหม่';
  end;

  perform public.wed_write_sessions(v_id, v_rows);
  perform public.wed_write_addons(v_id, v_addons);
  perform public.wed_recalc(v_id);
  perform public.wed_log(v_id, 'create',
    jsonb_build_object('status', v_status, 'source', v_source, 'sessions', jsonb_array_length(v_rows),
                       'dates', to_jsonb(v_dates), 'capacity_over', coalesce(jsonb_array_length(v_warn), 0) > 0)
    -- มัดจำกำหนดเองตั้งแต่สร้างงาน (ไม่มีคีย์นี้ = อัตโนมัติ)
    || case when b.deposit_override is null then '{}'::jsonb
            else jsonb_build_object('deposit_override', b.deposit_override) end);

  -- รับเงินทันที (เช่น มัดจำ) — กฎเดียวกับการรับเงินปกติทุกข้อ
  if jsonb_typeof(p_payload -> 'payments') = 'array' then
    if jsonb_array_length(p_payload -> 'payments') > 5 then
      raise exception 'รับเงินพร้อมการสร้างงานได้ไม่เกิน 5 รายการ';
    end if;
    for v_pay in select e.elem from jsonb_array_elements(p_payload -> 'payments') as e(elem)
    loop
      if jsonb_typeof(v_pay) <> 'object' then
        raise exception 'ข้อมูลการรับเงินไม่ถูกต้อง';
      end if;
      if coalesce(v_pay ->> 'kind', 'payment') <> 'payment' then
        raise exception 'รับเงินพร้อมการสร้างงานได้เฉพาะ "รับชำระ"';
      end if;
      perform public.wed_add_payment_core(
        v_id, null, 'payment',
        public.wed_json_text(v_pay -> 'method', 'วิธีชำระเงิน', 20),
        public.product_json_num(v_pay -> 'amount', 'จำนวนเงิน'),
        public.wed_json_date(v_pay -> 'paid_on', 'วันที่รับเงิน'),
        public.wed_json_text(v_pay -> 'purpose', 'วัตถุประสงค์', 20),
        public.wed_json_text(v_pay -> 'note', 'หมายเหตุ', 300),
        public.wed_json_text(v_pay -> 'slip_path', 'ไฟล์สลิป', 200));
    end loop;
  end if;

  if v_status = 'confirmed' then
    perform public.wed_confirm_core(v_id, v_force, true);
  end if;

  return jsonb_build_object('already_saved', false, 'payload_matches', true, 'booking', public.wed_booking_json(v_id));
end;
$$;

-- =========================================================================
-- 5) แก้งาน — เหมือน fix-07 + บันทึก source_detail (+ ประวัติ [เดิม, ใหม่])
-- =========================================================================
-- แก้งาน (สอบถาม/ล็อกคิว/ยืนยันแล้ว/เลื่อนงาน/ถ่ายเสร็จ) — p_updated_at = เวลาแก้ล่าสุดตอนโหลดฟอร์ม (กันเขียนทับ)
--   payload: คีย์ที่ไม่ส่ง = คงค่าเดิม; sessions / addons = รายการ "ทั้งหมด" (ส่งมา = แทนที่ทั้งชุดตาม id ที่ส่งกลับมา)
--   payload.client_id (ไม่บังคับ) = รหัสคำขอแก้ไข: ส่งซ้ำหลังเน็ตหลุด ข้อมูลเดิมทุกตัวอักษร → คืนงานตามเดิม
--     ไม่ชนล็อกเวอร์ชันของตัวเอง ; รหัสเดิมแต่ข้อมูลอื่น → ปฏิเสธ (จำไว้ในประวัติ action = 'update')
--   คิวเต็ม: ตรวจเฉพาะวันที่ "เพิ่มเข้ามาใหม่" ของงานที่กันคิว (วันที่เดิมที่เคยยืนยันรับเกินไว้แล้วไม่ถามซ้ำ)
create or replace function public.wed_update_booking(p_booking_id uuid, p_updated_at timestamptz, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b_old public.wed_bookings;
  b public.wed_bookings;
  v_mgr boolean;
  v_client uuid;
  v_md5 text;
  v_prev_md5 text;
  v_force boolean;
  v_cust uuid;
  v_source text;
  v_rows jsonb;
  v_addons jsonb;
  v_pre numeric;
  v_old_dates date[];
  v_new_dates date[];
  v_warn jsonb;
  v_detail jsonb;
begin
  perform public.wed_require(false);
  perform public.wed_expire_holds();
  v_mgr := public.wed_manager();
  b_old := public.wed_lock_booking(p_booking_id);
  -- รหัสคำขอแก้ไข: ตรวจหลังได้ล็อก (รอบก่อนของเครื่องเดิมอาจบันทึกเสร็จระหว่างรอ) และก่อนตรวจสถานะ/เวอร์ชัน
  if p_payload is not null and jsonb_typeof(p_payload) = 'object' and p_payload ? 'client_id' then
    v_client := public.product_json_uuid(p_payload -> 'client_id', 'รหัสคำขอ');
  end if;
  if v_client is not null then
    v_md5 := public.wed_payload_md5(p_payload);
    select lg.detail ->> 'payload_md5' into v_prev_md5
      from public.wed_logs as lg
     where lg.booking_id = b_old.id and lg.action = 'update' and lg.detail ->> 'client_id' = v_client::text
     order by lg.id desc
     limit 1;
    if found then
      if v_prev_md5 is distinct from v_md5 then
        raise exception 'รหัสคำขอนี้ถูกใช้บันทึกการแก้ไขชุดอื่นไปแล้ว กรุณาโหลดหน้าใหม่แล้วตรวจข้อมูลก่อนแก้อีกครั้ง';
      end if;
      return public.wed_booking_json(b_old.id) || jsonb_build_object('already_saved', true);
    end if;
  end if;
  if b_old.status not in ('inquiry', 'hold', 'confirmed', 'postponed', 'in_production') then
    raise exception 'แก้ไขงานสถานะ "%" ไม่ได้', public.wed_status_label(b_old.status);
  end if;
  if p_updated_at is null or p_updated_at <> b_old.updated_at then
    raise exception 'งานนี้ถูกแก้ไขจากเครื่องอื่น กรุณาโหลดหน้าใหม่แล้วแก้อีกครั้ง';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'ข้อมูลงานไม่ถูกต้อง กรุณาโหลดหน้าใหม่';
  end if;
  v_force := coalesce(public.product_json_bool(p_payload -> 'force', 'การยืนยัน'), false);

  b := public.wed_read_head(p_payload, b_old);

  v_cust := b_old.customer_id;
  if p_payload ? 'customer_id' and public.product_json_uuid(p_payload -> 'customer_id', 'ลูกค้า') is not null then
    v_cust := public.product_json_uuid(p_payload -> 'customer_id', 'ลูกค้า');
    if not exists (select 1 from public.wed_customers as x where x.id = v_cust) then
      raise exception 'ไม่พบข้อมูลลูกค้า กรุณาเลือกลูกค้าใหม่';
    end if;
  elsif jsonb_typeof(p_payload -> 'customer') = 'object' then
    v_cust := public.wed_customer_write(null, p_payload -> 'customer', null);
  end if;
  v_source := b_old.source;
  if p_payload ? 'source' then
    v_source := coalesce(public.wed_json_text(p_payload -> 'source', 'ช่องทางที่ลูกค้าติดต่อ', 20), b_old.source);
    if v_source not in ('instagram', 'facebook', 'tiktok', 'line', 'referral', 'walkin', 'website', 'other') then
      raise exception 'ช่องทางที่ลูกค้าติดต่อไม่ถูกต้อง';
    end if;
  end if;

  if p_payload ? 'sessions' then
    v_rows := public.wed_read_sessions(p_payload -> 'sessions', b_old.id,
                                       b_old.status not in ('inquiry', 'postponed'), v_mgr);
  end if;
  if p_payload ? 'addons' then
    v_addons := public.wed_read_addons(p_payload -> 'addons', b_old.id);
  end if;
  select b.package_price + b.travel_fee
         + case when v_addons is null then b_old.addons_total
                else (select coalesce(sum((e.elem ->> 'amount')::numeric), 0) from jsonb_array_elements(v_addons) as e(elem)) end
    into v_pre;
  if b.discount > v_pre then
    raise exception 'ส่วนลด (%) มากกว่ายอดก่อนส่วนลด (%)', public.wed_baht(b.discount), public.wed_baht(v_pre);
  end if;

  if v_rows is not null then
    v_old_dates := public.wed_booking_dates(b_old.id);
  end if;
  if v_rows is not null and public.wed_counting(b_old.status) then
    select coalesce(array_agg(x.d), '{}') into v_new_dates
      from unnest(public.wed_rows_dates(v_rows)) as x(d)
     where not (x.d = any(v_old_dates));
    perform public.wed_capacity_lock(v_new_dates);
    v_warn := public.wed_capacity_check(b_old.id, v_new_dates);
    if jsonb_array_length(v_warn) > 0 and not v_force then
      perform public.wed_capacity_raise(v_warn);
    end if;
  end if;

  if v_rows is not null then
    perform public.wed_write_sessions(b_old.id, v_rows);
  end if;
  if v_addons is not null then
    perform public.wed_write_addons(b_old.id, v_addons);
  end if;
  update public.wed_bookings as x
     set customer_id = v_cust, source = v_source, couple_names = b.couple_names, package_id = b.package_id,
         source_detail = b.source_detail,
         package_name = b.package_name, package_price = b.package_price, package_hours = b.package_hours,
         package_description = b.package_description, deliverables_plan = b.deliverables_plan,
         travel_fee = b.travel_fee, discount = b.discount, discount_note = b.discount_note,
         deposit_override = b.deposit_override,
         balance_due_date_override = b.balance_due_date_override, followup_date = b.followup_date,
         followup_note = b.followup_note, coordinator_name = b.coordinator_name, coordinator_phone = b.coordinator_phone,
         mood_link = b.mood_link, customer_note = b.customer_note, note = b.note
   where x.id = b_old.id;
  perform public.wed_recalc(b_old.id);

  -- ประวัติ: จดเฉพาะสิ่งที่เปลี่ยน (ไม่จดค่าตัวทีมงาน — พนักงานอ่านประวัติได้)
  v_detail := '{}'::jsonb;
  if v_client is not null then
    v_detail := v_detail || jsonb_build_object('client_id', v_client, 'payload_md5', v_md5);
  end if;
  if v_rows is not null then
    v_detail := v_detail || jsonb_build_object('sessions', jsonb_array_length(v_rows));
    if public.wed_booking_dates(b_old.id) is distinct from v_old_dates then
      v_detail := v_detail || jsonb_build_object('dates', jsonb_build_array(to_jsonb(v_old_dates),
                                                                            to_jsonb(public.wed_booking_dates(b_old.id))));
    end if;
  end if;
  if v_new_dates is not null and coalesce(array_length(v_new_dates, 1), 0) > 0 then
    v_detail := v_detail || jsonb_build_object('new_dates', to_jsonb(v_new_dates),
                                               'capacity_over', jsonb_array_length(v_warn) > 0);
  end if;
  if v_cust <> b_old.customer_id then
    v_detail := v_detail || jsonb_build_object('customer_changed', true);
  end if;
  if b.package_id is distinct from b_old.package_id or b.package_price <> b_old.package_price then
    v_detail := v_detail || jsonb_build_object('package', jsonb_build_array(b_old.package_name, b.package_name),
                                               'package_price', jsonb_build_array(b_old.package_price, b.package_price));
  end if;
  if b.discount <> b_old.discount then
    v_detail := v_detail || jsonb_build_object('discount', jsonb_build_array(b_old.discount, b.discount));
  end if;
  if b.travel_fee <> b_old.travel_fee then
    v_detail := v_detail || jsonb_build_object('travel_fee', jsonb_build_array(b_old.travel_fee, b.travel_fee));
  end if;
  -- มัดจำกำหนดเอง [เดิม, ใหม่] (null = อัตโนมัติ)
  if b.deposit_override is distinct from b_old.deposit_override then
    v_detail := v_detail || jsonb_build_object('deposit_override',
                                               jsonb_build_array(b_old.deposit_override, b.deposit_override));
  end if;
  if v_addons is not null then
    v_detail := v_detail || jsonb_build_object('addons', jsonb_array_length(v_addons));
  end if;
  -- fix-11 source_detail: ชื่อช่องทางติดต่อ [เดิม, ใหม่] (null = ไม่มี) — จดเฉพาะตอนเปลี่ยน
  if b.source_detail is distinct from b_old.source_detail then v_detail := v_detail || jsonb_build_object('source_detail', jsonb_build_array(b_old.source_detail, b.source_detail)); end if;
  -- fix-11 ช่องทางที่ติดต่อมา [เดิม, ใหม่] (fix-07 ไม่ได้จด → ประวัติอ่านเหมือนชื่อ Facebook ถูกแก้เป็น LINE ID) — จดเฉพาะตอนเปลี่ยน
  if v_source is distinct from b_old.source then v_detail := v_detail || jsonb_build_object('source', jsonb_build_array(b_old.source, v_source)); end if; -- fix-11
  perform public.wed_log(b_old.id, 'update', v_detail);
  return public.wed_booking_json(b_old.id) || jsonb_build_object('already_saved', false);
end;
$$;


-- =========================================================================
-- 6) สิทธิ์เรียกใช้ — เหมือน fix-07: ตัวช่วย = ไม่มีใครเรียกตรงได้ / สร้าง-แก้งาน = ผู้ใช้ที่ล็อกอิน (ตรวจสิทธิ์ข้างใน)
-- =========================================================================
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.wed_read_head(jsonb, public.wed_bookings)',
    'public.wed_booking_json(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;

  foreach f in array array[
    'public.wed_create_booking(uuid, jsonb)',
    'public.wed_update_booking(uuid, timestamptz, jsonb)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;

-- ให้ API (PostgREST) โหลดโครงสร้างใหม่ทันที
notify pgrst, 'reload schema';

commit;

-- =========================================================================
-- ตารางตรวจผล (อ่านอย่างเดียว) — ทุกแถวต้องขึ้น "ถูกต้อง"
-- =========================================================================
select x.ord as "ลำดับ", x.item as "รายการตรวจ", x.value as "ผล"
  from (values
    (1, 'คอลัมน์ชื่อช่องทางติดต่อ (wed_bookings.source_detail) ข้อความ ไม่บังคับ ไม่เกิน 200 ตัวอักษร',
        (select case when count(*) = 1 then 'ถูกต้อง' else 'ยังไม่มี — รันไฟล์นี้ซ้ำ' end
           from pg_attribute as a
          where a.attrelid = 'public.wed_bookings'::regclass and a.attname = 'source_detail' and not a.attisdropped
            and a.atttypid = 'text'::regtype and not a.attnotnull
            and exists (select 1 from pg_constraint as k
                         where k.conrelid = a.attrelid and k.conname = 'wed_bookings_source_detail_check'))),
    (2, 'อ่านชื่อช่องทางจากฟอร์ม (wed_read_head) ตัดช่องว่างหัวท้าย / ช่องว่างล้วน = ไม่มี',
        (select case when (public.wed_read_head('{"couple_names": "ตรวจ", "source_detail": "  FB ทดสอบ  "}'::jsonb,
                                                null::public.wed_bookings)).source_detail = 'FB ทดสอบ'
                      and (public.wed_read_head('{"couple_names": "ตรวจ", "source_detail": "   "}'::jsonb,
                                                null::public.wed_bookings)).source_detail is null
                     then 'ถูกต้อง' else 'ยังเป็นแบบเดิม — รันไฟล์นี้ซ้ำเป็นไฟล์สุดท้าย' end)),
    (3, 'บันทึกชื่อช่องทางตอนสร้างงาน / แก้งาน (wed_create_booking / wed_update_booking) + ประวัติจดการเปลี่ยนช่องทาง',
        (select case when count(*) filter (where p.proname = 'wed_create_booking' and p.prosrc like '%b.source_detail,%') = 1
                      and count(*) filter (where p.proname = 'wed_update_booking' and p.prosrc like '%source_detail = b.source_detail,%'
                                             and p.prosrc like '%''source'', jsonb_build_array(b_old.source, v_source)%') = 1
                     then 'ถูกต้อง' else 'ยังเป็นแบบเดิม — รันไฟล์นี้ซ้ำเป็นไฟล์สุดท้าย' end
           from pg_proc as p
          where p.oid in ('public.wed_create_booking(uuid, jsonb)'::regprocedure,
                          'public.wed_update_booking(uuid, timestamptz, jsonb)'::regprocedure))),
    (4, 'ส่งชื่อช่องทางให้หน้าจอ/ใบยืนยันการจอง (wed_booking_json)',
        (select case when p.prosrc like '%''source_detail'', b.source_detail,%' then 'ถูกต้อง'
                     else 'ยังเป็นแบบเดิม — รันไฟล์นี้ซ้ำเป็นไฟล์สุดท้าย' end
           from pg_proc as p
          where p.oid = 'public.wed_booking_json(uuid)'::regprocedure)),
    (5, 'ทั้ง 4 ฟังก์ชันเป็น security definer + search_path = public',
        (select case when count(*) filter (where p.prosecdef and p.proconfig @> array['search_path=public']) = 4
                     then 'ถูกต้อง' else 'ผิด — รันไฟล์นี้ซ้ำ' end
           from pg_proc as p
          where p.oid in ('public.wed_read_head(jsonb, public.wed_bookings)'::regprocedure,
                          'public.wed_booking_json(uuid)'::regprocedure,
                          'public.wed_create_booking(uuid, jsonb)'::regprocedure,
                          'public.wed_update_booking(uuid, timestamptz, jsonb)'::regprocedure))),
    (6, 'ลูกค้า/คนนอก (anon) เรียกทั้ง 4 ฟังก์ชันไม่ได้',
        (select case when count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')) = 0 and count(*) = 4
                     then 'ถูกต้อง' else 'ผิด — รันไฟล์นี้ซ้ำ' end
           from pg_proc as p
          where p.oid in ('public.wed_read_head(jsonb, public.wed_bookings)'::regprocedure,
                          'public.wed_booking_json(uuid)'::regprocedure,
                          'public.wed_create_booking(uuid, jsonb)'::regprocedure,
                          'public.wed_update_booking(uuid, timestamptz, jsonb)'::regprocedure))),
    (7, 'ผู้ล็อกอินเรียกสร้าง/แก้งานได้ · ตัวช่วย (wed_read_head / wed_booking_json) เรียกตรงไม่ได้',
        (select case when has_function_privilege('authenticated', 'public.wed_create_booking(uuid, jsonb)'::regprocedure, 'EXECUTE')
                      and has_function_privilege('authenticated', 'public.wed_update_booking(uuid, timestamptz, jsonb)'::regprocedure, 'EXECUTE')
                      and not has_function_privilege('authenticated', 'public.wed_read_head(jsonb, public.wed_bookings)'::regprocedure, 'EXECUTE')
                      and not has_function_privilege('authenticated', 'public.wed_booking_json(uuid)'::regprocedure, 'EXECUTE')
                     then 'ถูกต้อง' else 'ผิด — รันไฟล์นี้ซ้ำ' end))
  ) as x(ord, item, value)
 order by x.ord;
