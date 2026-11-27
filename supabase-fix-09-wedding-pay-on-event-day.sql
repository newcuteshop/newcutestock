-- =========================================================================
-- supabase-fix-09-wedding-pay-on-event-day.sql — ร้าน b.oncloud: ชำระยอดคงเหลือ "วันงาน" + เงื่อนไขตามฟอร์มร้าน
--
-- บอสสั่ง 27/11/2569
--   1) "ตรงกำหนดชำระต้องเป็นวันงานครับ" — เดิมยอดคงเหลือครบกำหนด "ก่อนวันงานแรก 7 วัน" (ค่าเริ่มต้นของตั้งค่าร้าน)
--   2) เงื่อนไขในเอกสารให้เป็นแบบฟอร์มของร้าน 3 ข้อ (ข้อ 3 = ชำระยอดคงเหลือ ณ วันงาน หลังถ่ายเสร็จ)
--
-- ไฟล์นี้ทำอะไร (ต้องรัน supabase-fix-07-wedding.sql มาก่อน)
--   ทำครั้งเดียว: ข้อ 1–3 ทำเฉพาะตอนที่ยังไม่เคยรันไฟล์นี้ — ตัวบอก = ค่าเริ่มต้นของคอลัมน์ wed_settings.balance_due_days
--   (fix-07 ตั้งไว้ 7 · ไฟล์นี้เปลี่ยนเป็น 0 ในรายการเดียวกัน · หน้าตั้งค่าร้านแก้ค่าเริ่มต้นของคอลัมน์ไม่ได้)
--   → รันซ้ำเพื่อดูตารางตรวจผลได้เสมอ ไม่ทับสิ่งที่บอสแก้ภายหลังในตั้งค่าร้าน (นโยบายวัน/เงื่อนไขสัญญา) และไม่แตะงานอีก
--   1) ตั้งค่าร้าน "ชำระยอดคงเหลือก่อนวันงาน" = 0 วัน (= วันงานแรก) และค่าเริ่มต้นของคอลัมน์ = 0
--   2) งานที่ยังไม่ปิด/ไม่ยกเลิก: นโยบายที่จำไว้บนงาน = 0 วัน แล้วคำนวณยอด/งวดใหม่ด้วย wed_recalc ตัวเดิม
--      - วันชำระยอดคงเหลือ = วันงานแรก (งานกระชั้นชิดที่วันครบกำหนดมัดจำช้ากว่าวันงาน ใช้วันครบกำหนดมัดจำ — กฎเดิม)
--      - งวดมาตรฐาน (มัดจำ + ยอดคงเหลือ) เปลี่ยนวันตามให้อัตโนมัติ
--      - ไม่แตะ: งานที่กำหนดวันชำระยอดคงเหลือเอง / งวดที่บอสแก้เอง (วันในงวดตามที่บอสตั้ง) / งานปิดแล้ว / งานยกเลิก
--      - ยอดเงินทุกช่องไม่เปลี่ยน (เปลี่ยนแค่ "วันที่ครบกำหนด")
--      - จดประวัติในหน้างาน: "เปลี่ยนวันชำระยอดคงเหลือเป็นวันงาน" พร้อมวันเดิม/วันใหม่ — เฉพาะงานที่วันครบกำหนดเปลี่ยนจริง
--        (งานที่กำหนดวันเอง / ยังไม่มีวันงาน = วันไม่เปลี่ยน ไม่จด ; งวดที่บอสแก้เอง = จดพร้อมบอกว่างวดคงวันเดิม)
--   3) เงื่อนไขของร้าน (wed_settings.terms_text) = 3 บรรทัดตามฟอร์มร้าน (ขึ้นต้นด้วย "-" แบบฟอร์มร้าน — เอกสารที่ใส่เลขข้อจะตัดขีดออกเอง) (ใช้ในใบยืนยันการจอง/ใบเสนอราคา/สัญญา/ลิงก์ลูกค้า)
--      แก้ต่อได้เองที่ ตั้งค่าร้าน → เงื่อนไขสัญญา
--
-- ท้ายไฟล์มีตารางตรวจผล — รันครั้งแรกทุกแถวต้องขึ้น "ถูกต้อง" (แถว 6–7 เป็นจำนวนให้ทราบ)
--   รันซ้ำหลังบอสแก้ตั้งค่าร้านเอง: แถว 1/3/8 บอก "แก้ภายหลังในตั้งค่าร้าน" = ปกติ (ไฟล์นี้ไม่ทับของบอส)
-- =========================================================================

begin;

do $$
declare
  r record;
  v_new date;
begin
  -- ทำไปแล้ว (ค่าเริ่มต้นของคอลัมน์ = 0) → ไม่แตะอะไรเลย ไปดูตารางตรวจผลอย่างเดียว
  if exists (select 1
               from information_schema.columns as c
              where c.table_schema = 'public' and c.table_name = 'wed_settings'
                and c.column_name = 'balance_due_days' and c.column_default = '0') then
    raise notice 'fix-09 เคยรันแล้ว — ไม่แตะตั้งค่าร้าน/งาน/เงื่อนไข (ดูตารางตรวจผลด้านล่าง)';
    return;
  end if;

  -- 1) ตั้งค่าร้าน — เปลี่ยนค่าเริ่มต้นของคอลัมน์ก่อน (= ตัวบอกว่าทำแล้ว ; ล็อกตาราง → รันพร้อมกัน 2 หน้าต่าง ตัวหลังรอตัวแรกเสร็จ)
  alter table public.wed_settings alter column balance_due_days set default 0;
  update public.wed_settings set balance_due_days = 0 where balance_due_days <> 0;

  -- 2) งานที่ยังไม่ปิด/ไม่ยกเลิก — ล็อกงานเรียงตาม id ก่อนคำนวณใหม่ (wed_recalc ต้องการให้ผู้เรียกล็อกงานไว้)
  for r in
    select b.id, b.balance_due_date as old_due, b.installments_custom as kept
      from public.wed_bookings as b
     where b.status not in ('completed', 'cancelled')
       and b.balance_due_days is distinct from 0
     order by b.id
       for update
  loop
    update public.wed_bookings as x set balance_due_days = 0 where x.id = r.id;
    perform public.wed_recalc(r.id);
    select x.balance_due_date into v_new from public.wed_bookings as x where x.id = r.id;
    -- จดประวัติเฉพาะงานที่วันครบกำหนดเปลี่ยนจริง (กำหนดวันเอง / ยังไม่มีวันงาน = วันเดิม ไม่ต้องจด)
    if r.old_due is distinct from v_new then
      perform public.wed_log(r.id, 'policy_update',
        jsonb_build_object('reason', 'เปลี่ยนวันชำระยอดคงเหลือเป็นวันงาน (บอสสั่ง 27/11/2569)',
                           'old_balance_due_date', r.old_due, 'new_balance_due_date', v_new,
                           'installments_kept', coalesce(r.kept, false)),
        'ระบบ');
    end if;
  end loop;

  -- 3) เงื่อนไขตามฟอร์มร้าน
  update public.wed_settings
     set terms_text = '-กรณีลูกค้ายกเลิก/เลื่อนวัน จะไม่สามารถคืนเงินมัดจำได้ทุกกรณี' || chr(10)
                   || '-เลื่อนวันได้หากทางทีมมีคิวว่าง' || chr(10)
                   || '-ชำระยอดคงเหลือ ณ วันงาน หลังถ่ายเสร็จ'
   where terms_text is distinct from
         '-กรณีลูกค้ายกเลิก/เลื่อนวัน จะไม่สามารถคืนเงินมัดจำได้ทุกกรณี' || chr(10)
         || '-เลื่อนวันได้หากทางทีมมีคิวว่าง' || chr(10)
         || '-ชำระยอดคงเหลือ ณ วันงาน หลังถ่ายเสร็จ';
end;
$$;

commit;

-- =========================================================================
-- ตารางตรวจผล
-- =========================================================================
select x.ord as "ลำดับ", x.item as "รายการตรวจ", x.value as "ผล"
  from (values
    (1, 'ตั้งค่าร้าน: ชำระยอดคงเหลือก่อนวันงาน = 0 วัน (วันงาน)',
        (select case when count(*) = 1 and bool_and(s.balance_due_days = 0) then 'ถูกต้อง'
                     else 'ตอนนี้ ' || coalesce(min(s.balance_due_days)::text, '-') || ' วัน — แก้ภายหลังในตั้งค่าร้าน (ไฟล์นี้ไม่ทับ)' end
           from public.wed_settings as s)),
    (2, 'ค่าเริ่มต้นของคอลัมน์ = 0',
        (select case when c.column_default = '0' then 'ถูกต้อง' else 'เป็น ' || coalesce(c.column_default, 'null') || ' — รันไฟล์นี้ซ้ำ' end
           from information_schema.columns as c
          where c.table_schema = 'public' and c.table_name = 'wed_settings' and c.column_name = 'balance_due_days')),
    (3, 'งานที่ยังไม่ปิด/ไม่ยกเลิก ที่ยังใช้นโยบายเดิม (ก่อนวันงาน N วัน)',
        (select case when count(*) = 0 then 'ถูกต้อง'
                     else count(*) || ' งานใช้นโยบายอื่น — ตั้งค่าร้านถูกแก้ภายหลัง (ไฟล์นี้ไม่ทับ)' end
           from public.wed_bookings as b
          where b.status not in ('completed', 'cancelled') and b.balance_due_days is distinct from 0)),
    (4, 'วันชำระยอดคงเหลือ = วันงานแรก (งานที่ใช้นโยบายวันงาน ไม่นับงานที่กำหนดวันเอง)',
        (select case when count(*) = 0 then 'ถูกต้อง' else 'ไม่ตรง ' || count(*) || ' งาน' end
           from public.wed_bookings as b
          where b.status not in ('completed', 'cancelled')
            and b.balance_due_days = 0
            and b.balance_due_date_override is null
            and b.first_session_date is not null
            and b.balance_due_date is distinct from
                greatest(b.first_session_date, public.wed_deposit_day(b.created_at, b.deposit_due_on)))),
    (5, 'งวด "ยอดคงเหลือ" ของงวดมาตรฐาน ตรงวันชำระของงาน',
        (select case when count(*) = 0 then 'ถูกต้อง' else 'ไม่ตรง ' || count(*) || ' งวด' end
           from public.wed_installments as n
           join public.wed_bookings as b on b.id = n.booking_id
          where b.status not in ('completed', 'cancelled')
            and not b.installments_custom
            and n.label in ('ยอดคงเหลือ', 'ยอดชำระทั้งหมด')
            -- กฎเดียวกับ wed_default_plan: ยังไม่มีวันงาน = ไม่มีวันครบกำหนด
            and n.due_date is distinct from
                case when b.balance_due_date is null then null
                     else greatest(b.balance_due_date, public.wed_deposit_day(b.created_at, b.deposit_due_on)) end)),
    (6, 'ให้ทราบ: งานที่บอสแก้งวดเอง (วันในงวดคงตามที่ตั้งไว้)',
        (select count(*)::text || ' งาน'
           from public.wed_bookings as b
          where b.status not in ('completed', 'cancelled') and b.installments_custom)),
    (7, 'ให้ทราบ: งานที่กำหนดวันชำระยอดคงเหลือเอง (คงวันเดิม)',
        (select count(*)::text || ' งาน'
           from public.wed_bookings as b
          where b.status not in ('completed', 'cancelled') and b.balance_due_date_override is not null)),
    (8, 'เงื่อนไขของร้าน = 3 ข้อตามฟอร์มร้าน',
        (select case when count(*) = 1
                      and bool_and(s.terms_text = '-กรณีลูกค้ายกเลิก/เลื่อนวัน จะไม่สามารถคืนเงินมัดจำได้ทุกกรณี' || chr(10)
                                                || '-เลื่อนวันได้หากทางทีมมีคิวว่าง' || chr(10)
                                                || '-ชำระยอดคงเหลือ ณ วันงาน หลังถ่ายเสร็จ')
                     then 'ถูกต้อง' else 'แก้ภายหลังในตั้งค่าร้าน → เงื่อนไขสัญญา (ไฟล์นี้ไม่ทับ)' end
           from public.wed_settings as s))
  ) as x(ord, item, value)
 order by x.ord;
