-- =========================================================================
-- supabase-fix-10-wedding-package-detail.sql — ร้าน b.oncloud: รายละเอียด "แพ็คเกจหลัก" ตามฟอร์มร้าน
--
-- บอสสั่ง 27/11/2569 "รายละเอียดตรงนี้ทำไมมีแค่นี้ เพิ่มให้ครบตามฟอร์มที่ส่งให้ด้วยครับ"
--   ใบยืนยันการจองขึ้นแค่ "ถ่ายทำ 4 ชั่วโมง" เพราะแพ็กเกจ "แพ็คเกจหลัก" ยังไม่มีรายละเอียด
--   (งานแต่ละงานจำรายละเอียดแพ็กเกจ ณ ตอนจองไว้ — งานที่จองแล้วจึงว่างตามไปด้วย)
--
-- ไฟล์นี้ทำอะไร (รันซ้ำได้ — แตะเฉพาะที่ยังว่าง ไม่ทับรายละเอียดที่บอสพิมพ์เองภายหลัง)
--   1) แพ็กเกจชื่อ "แพ็คเกจหลัก" (สะกด ค หรือ ก ก็ได้) ที่รายละเอียดยังว่าง → ใส่ 8 บรรทัดตามฟอร์มร้าน
--   2) งานที่จองด้วยแพ็กเกจนี้ (ตามแพ็กเกจที่เลือก หรือชื่อแพ็กเกจ ณ ตอนจอง) และรายละเอียดยังว่าง → ใส่ 8 บรรทัดเดียวกัน
--   ไม่แตะ ราคา/ชั่วโมง/ยอดเงิน/งวด — เปลี่ยนแค่ข้อความรายละเอียดที่พิมพ์ในเอกสาร
--   แก้ต่อได้เองที่ ตั้งค่า → แพ็กเกจ (งานใหม่) / หน้าแก้ไขงาน → แพ็กเกจ → ปรับรายละเอียด (งานที่จองแล้ว)
-- ท้ายไฟล์มีตารางตรวจผล — ทุกแถวต้องขึ้น "ถูกต้อง" (แถว 3 เป็นจำนวนให้ทราบ)
-- =========================================================================

begin;

do $$
declare
  v_desc constant text :=
       '-ถ่าย 4 ชม.' || chr(10)
    || '-ช่างภาพ 2 คน' || chr(10)
    || '-ถ่ายกล้องไอโฟน / dji (ได้หลายมู้ด )' || chr(10)
    || '-ตัดคลิปไฮไลท์ 2 คลิป ( 30-45 วิ )' || chr(10)
    || '-เก็บ vdo ฟุตเทจ 300-400+ ทุกโมเม้นในงาน' || chr(10)
    || '-ฟุตเทจ ส่งงานภายใน 24 ชม.' || chr(10)
    || '-คลิปไฮไลท์ ส่งงานภายใน 3-5 วัน (แก้ไขได้ 2 ครั้ง)' || chr(10)
    || '( กทม และปริมณฑลฟรีค่าเดินทาง )';
begin
  update public.wed_packages as p
     set description = v_desc
   where btrim(p.name) ~ '^แพ็[คก]เกจหลัก$'
     and coalesce(btrim(p.description), '') = '';

  update public.wed_bookings as b
     set package_description = v_desc
   where coalesce(btrim(b.package_description), '') = ''
     and (b.package_id in (select p.id from public.wed_packages as p where btrim(p.name) ~ '^แพ็[คก]เกจหลัก$')
          or btrim(coalesce(b.package_name, '')) ~ '^แพ็[คก]เกจหลัก$');
end;
$$;

commit;

-- =========================================================================
-- ตารางตรวจผล
-- =========================================================================
select x.ord as "ลำดับ", x.item as "รายการตรวจ", x.value as "ผล"
  from (values
    (1, 'แพ็กเกจ "แพ็คเกจหลัก" มีรายละเอียดแล้ว',
        (select case when count(*) = 0 then 'ไม่พบแพ็กเกจชื่อนี้ — แจ้งผมชื่อแพ็กเกจที่ใช้จริง'
                     when count(*) filter (where coalesce(btrim(p.description), '') = '') = 0
                       then 'ถูกต้อง (' || count(*) || ' แพ็กเกจ ราคา ' || string_agg(p.price::text, ', ') || ' บาท)'
                     else 'ยังว่าง ' || count(*) filter (where coalesce(btrim(p.description), '') = '') || ' แพ็กเกจ'
                end
           from public.wed_packages as p
          where btrim(p.name) ~ '^แพ็[คก]เกจหลัก$')),
    (2, 'งานที่ใช้แพ็กเกจนี้ ไม่มีงานไหนรายละเอียดว่าง',
        (select case when count(*) = 0 then 'ถูกต้อง' else 'ยังว่าง ' || count(*) || ' งาน' end
           from public.wed_bookings as b
          where coalesce(btrim(b.package_description), '') = ''
            and (b.package_id in (select p.id from public.wed_packages as p where btrim(p.name) ~ '^แพ็[คก]เกจหลัก$')
                 or btrim(coalesce(b.package_name, '')) ~ '^แพ็[คก]เกจหลัก$'))),
    (3, 'ให้ทราบ: งานที่ใช้แพ็กเกจนี้ทั้งหมด',
        (select count(*)::text || ' งาน'
           from public.wed_bookings as b
          where b.package_id in (select p.id from public.wed_packages as p where btrim(p.name) ~ '^แพ็[คก]เกจหลัก$')
             or btrim(coalesce(b.package_name, '')) ~ '^แพ็[คก]เกจหลัก$'))
  ) as x(ord, item, value)
 order by x.ord;
