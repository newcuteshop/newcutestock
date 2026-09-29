-- =========================================================================
-- supabase-cron-integrations.sql — ตัวปลุกงานของระบบเชื่อมต่อ (pg_cron + pg_net + Supabase Vault)
--
-- ไฟล์นี้ทำอะไร (ไม่บังคับ — รันเมื่อพร้อมเปิดใช้การเชื่อมต่อจริง)
--   1) เปิดส่วนเสริม pg_cron (ตั้งเวลา) และ pg_net (ยิง HTTP ออกจากฐานข้อมูล)
--   2) เก็บ URL ของ worker และ "ค่าลับของ worker" ไว้ใน Supabase Vault (เข้ารหัสในฐานข้อมูล ไม่อยู่ในโค้ด)
--   3) ตั้งงาน newcute-integrations-tick: ทุก 30 วินาที (ถ้า pg_cron รุ่น 1.5 ขึ้นไป) ไม่งั้นทุก 1 นาที
--      ตรวจก่อนว่ามีงานจริงไหม (สต๊อกรอส่ง / event รอประมวลผล / ถึงรอบดึงออเดอร์ / ถึงเวลาต่ออายุ token)
--      มีงาน → POST https://newcutestock.vercel.app/api/integrations/worker (Authorization: Bearer <ค่าลับ>)
--      ไม่มีงาน → ไม่ปลุก Vercel เลย (ประหยัดโควตา)
--   4) ตั้งงาน newcute-integrations-daily: ทุกวัน 03:00 น. (เวลาไทย) ให้ worker กระทบยอด ต่ออายุ token และล้างข้อมูลเก่า
--
-- ก่อนรัน
--   - ต้องรัน supabase-fix-03-integrations.sql ให้เสร็จก่อน (ไฟล์นี้ตรวจให้)
--   - สุ่ม "ค่าลับของ worker" ยาวอย่างน้อย 32 ตัวอักษร ไม่มีช่องว่าง — สุ่มบนเครื่องตัวเอง (อย่าใช้เว็บสุ่มรหัส):
--       node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
--     แล้วใส่ค่าเดียวกันใน 2 ที่:
--       (1) Vercel > Settings > Environment Variables: INTEGRATIONS_WORKER_SECRET = <ค่าลับ> แล้ว Redeploy
--       (2) ไฟล์นี้ ตรงบรรทัด  v_secret text := 'ใส่ค่าลับของ worker ตรงนี้';   (หัวข้อ 2 ด้านล่าง)
--     [สำคัญ] ห้ามบันทึกไฟล์นี้ที่ใส่ค่าลับแล้วลง GitHub (repo เป็น public) — แก้ใน SQL Editor แล้วรันเลย ไม่ต้องบันทึกไฟล์
--   - ถ้าใช้โดเมนอื่น แก้ v_url ในหัวข้อ 2 ด้วย
--
-- วิธีใช้: Supabase > SQL Editor > วางทั้งไฟล์ > แก้ค่าลับ > กด Run
--   - รันซ้ำได้: งานเดิมจะถูกลบแล้วตั้งใหม่ (ไม่ซ้อนกัน); ถ้าไม่แก้ค่าลับตอนรันซ้ำ ระบบใช้ค่าลับเดิมใน Vault
--   - เปลี่ยนค่าลับ: ใส่ค่าใหม่แล้วรันไฟล์นี้อีกครั้ง + แก้ INTEGRATIONS_WORKER_SECRET บน Vercel ให้ตรงกัน
--   - ถ้าคำสั่งเปิดส่วนเสริม error: Dashboard > Integrations > Cron (หรือ Database > Extensions) เปิด pg_cron และ pg_net
--     ด้วยมือ แล้วรันไฟล์นี้ใหม่
--
-- ตรวจสอบหลังรัน (ตารางสรุปจะแสดงเอง) และคำสั่งที่ใช้บ่อย (เอา "-- " หน้าบรรทัดออกแล้วรันทีละข้อ)
--   ดูงานที่ตั้งไว้:        select jobid, jobname, schedule, active from cron.job where jobname like 'newcute-integrations-%';
--   ดูผลการรันล่าสุด:      select j.jobname, d.status, d.return_message, d.start_time
--                          from cron.job_run_details as d join cron.job as j on j.jobid = d.jobid
--                         where j.jobname like 'newcute-integrations-%' order by d.start_time desc limit 20;
--   ดูผลที่ Vercel ตอบ:     select id, status_code, left(content::text, 200) as content, created
--                          from net._http_response order by created desc limit 20;
--   หยุดตัวปลุกชั่วคราว:     select cron.unschedule(jobid) from cron.job where jobname like 'newcute-integrations-%';
--                          (เปิดใหม่ = รันไฟล์นี้อีกครั้ง)
-- =========================================================================

-- =========================================================================
-- 1) ส่วนเสริม pg_cron + pg_net
-- =========================================================================
-- [extensions:begin]
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise exception 'เปิดส่วนเสริม pg_cron ไม่ได้ (%) — ไปที่ Dashboard > Integrations > Cron (หรือ Database > Extensions) กดเปิด pg_cron แล้วรันไฟล์นี้ใหม่', sqlerrm;
  end;
  begin
    create extension if not exists pg_net;
  exception when others then
    raise exception 'เปิดส่วนเสริม pg_net ไม่ได้ (%) — ไปที่ Dashboard > Database > Extensions กดเปิด pg_net แล้วรันไฟล์นี้ใหม่', sqlerrm;
  end;
end
$$;
-- [extensions:end]

begin;

do $$
begin
  if to_regprocedure('public.integration_work_due()') is null
     or to_regclass('public.stock_sync_outbox') is null then
    raise exception 'ต้องรัน supabase-fix-03-integrations.sql ให้เสร็จก่อน แล้วค่อยรันไฟล์นี้ (ยังไม่ได้แก้อะไร)';
  end if;
  if to_regnamespace('cron') is null or to_regclass('cron.job') is null then
    raise exception 'ไม่พบ pg_cron (schema cron) — เปิดส่วนเสริม pg_cron ก่อน แล้วรันไฟล์นี้ใหม่';
  end if;
  if to_regnamespace('net') is null
     or not exists (select 1 from pg_proc as p where p.pronamespace = to_regnamespace('net') and p.proname = 'http_post') then
    raise exception 'ไม่พบ pg_net (net.http_post) — เปิดส่วนเสริม pg_net ก่อน แล้วรันไฟล์นี้ใหม่';
  end if;
  if to_regclass('vault.secrets') is null or to_regclass('vault.decrypted_secrets') is null
     or not exists (select 1 from pg_proc as p where p.pronamespace = to_regnamespace('vault') and p.proname = 'create_secret')
     or not exists (select 1 from pg_proc as p where p.pronamespace = to_regnamespace('vault') and p.proname = 'update_secret') then
    raise exception 'ไม่พบ Supabase Vault (vault.secrets / vault.create_secret) — โปรเจกต์ Supabase ทุกตัวควรมีอยู่แล้ว ติดต่อผู้ดูแลระบบ';
  end if;
end
$$;

-- =========================================================================
-- 2) URL ของ worker + ค่าลับ → Supabase Vault
-- =========================================================================
do $$
declare
  v_url text := 'https://newcutestock.vercel.app/api/integrations/worker';   -- ← แก้ถ้าใช้โดเมนอื่น
  v_secret text := 'ใส่ค่าลับของ worker ตรงนี้';                              -- ← ค่าเดียวกับ INTEGRATIONS_WORKER_SECRET บน Vercel
  c_placeholder constant text := 'ใส่ค่าลับของ worker ตรงนี้';
  v_id uuid;
begin
  v_url := btrim(v_url);
  if v_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/api/integrations/worker$' then
    raise exception 'URL ของ worker ไม่ถูกต้อง: "%" — ต้องเป็น https://<โดเมน>/api/integrations/worker', v_url;
  end if;

  select s.id into v_id from vault.secrets as s where s.name = 'newcute_integrations_worker_url';
  if found then
    perform vault.update_secret(secret_id := v_id, new_secret := v_url);
  else
    perform vault.create_secret(new_secret := v_url, new_name := 'newcute_integrations_worker_url',
                                new_description := 'NEWCUTE: URL ของ /api/integrations/worker (pg_cron เรียก)');
  end if;

  v_secret := btrim(v_secret);
  select s.id into v_id from vault.secrets as s where s.name = 'newcute_integrations_worker_secret';
  if v_secret = c_placeholder then
    if v_id is null then
      raise exception 'ยังไม่ได้ใส่ค่าลับของ worker: แก้บรรทัด v_secret ในหัวข้อ 2 ให้เป็นค่าเดียวกับ INTEGRATIONS_WORKER_SECRET บน Vercel แล้วรันใหม่';
    end if;
    raise notice 'ไม่ได้ใส่ค่าลับใหม่ — ใช้ค่าลับเดิมที่เก็บใน Vault';
  else
    if char_length(v_secret) < 32 or v_secret ~ '\s' then
      raise exception 'ค่าลับของ worker ต้องยาวอย่างน้อย 32 ตัวอักษร (แนะนำ 48 ขึ้นไป) และห้ามมีช่องว่าง';
    end if;
    if v_id is not null then
      perform vault.update_secret(secret_id := v_id, new_secret := v_secret);
    else
      perform vault.create_secret(new_secret := v_secret, new_name := 'newcute_integrations_worker_secret',
                                  new_description := 'NEWCUTE: ค่าเดียวกับ INTEGRATIONS_WORKER_SECRET บน Vercel');
    end if;
  end if;
end
$$;

-- =========================================================================
-- 3) ฟังก์ชันที่ pg_cron เรียก (postgres เท่านั้น — ผู้ใช้ทั่วไป/API เรียกไม่ได้)
-- =========================================================================
-- ปลุก worker เฉพาะเมื่อมีงาน — คืนเลขคำขอของ pg_net (null = ไม่มีงาน ไม่ได้ปลุก)
create or replace function public.integrations_tick()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
  v_req bigint;
begin
  if not public.integration_work_due() then
    return null;
  end if;
  select ds.decrypted_secret into v_url
    from vault.decrypted_secrets as ds
   where ds.name = 'newcute_integrations_worker_url';
  select ds.decrypted_secret into v_secret
    from vault.decrypted_secrets as ds
   where ds.name = 'newcute_integrations_worker_secret';
  if v_url is null or v_secret is null then
    raise warning 'NEWCUTE: ไม่พบ URL/ค่าลับของ worker ใน Vault — รัน supabase-cron-integrations.sql ใหม่';
    return null;
  end if;
  select net.http_post(
           url := v_url,
           body := jsonb_build_object('source', 'pg_cron', 'mode', 'tick'),
           headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
           timeout_milliseconds := 55000)
    into v_req;
  return v_req;
end;
$$;

-- งานรายวัน: ปลุก worker เสมอ (กระทบยอด / ต่ออายุ token / ล้างข้อมูลเก่า)
create or replace function public.integrations_daily()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
  v_req bigint;
begin
  select ds.decrypted_secret into v_url
    from vault.decrypted_secrets as ds
   where ds.name = 'newcute_integrations_worker_url';
  select ds.decrypted_secret into v_secret
    from vault.decrypted_secrets as ds
   where ds.name = 'newcute_integrations_worker_secret';
  if v_url is null or v_secret is null then
    raise warning 'NEWCUTE: ไม่พบ URL/ค่าลับของ worker ใน Vault — รัน supabase-cron-integrations.sql ใหม่';
    return null;
  end if;
  select net.http_post(
           url := v_url,
           body := jsonb_build_object('source', 'pg_cron', 'mode', 'daily'),
           headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
           timeout_milliseconds := 55000)
    into v_req;
  return v_req;
end;
$$;

revoke all on function public.integrations_tick() from public, anon, authenticated, service_role;
revoke all on function public.integrations_daily() from public, anon, authenticated, service_role;

-- =========================================================================
-- 4) ตั้งเวลา (ลบงานเดิมชื่อเดียวกันก่อน → รันซ้ำไม่ซ้อน)
--    ทุก 30 วินาทีต้องใช้ pg_cron 1.5 ขึ้นไป — รุ่นเก่ากว่าหรืออ่านรุ่นไม่ได้ ใช้ทุก 1 นาที
-- =========================================================================
do $$
declare
  v_ver text;
  v_m text[];
  v_sched text := '* * * * *';
begin
  perform cron.unschedule(j.jobid)
     from cron.job as j
    where j.jobname in ('newcute-integrations-tick', 'newcute-integrations-daily');

  select e.extversion into v_ver from pg_extension as e where e.extname = 'pg_cron';
  v_m := regexp_match(coalesce(v_ver, ''), '^([0-9]+)\.([0-9]+)');
  if v_m is not null and (v_m[1]::integer > 1 or (v_m[1]::integer = 1 and v_m[2]::integer >= 5)) then
    v_sched := '30 seconds';
  end if;

  perform cron.schedule('newcute-integrations-tick', v_sched, 'select public.integrations_tick()');
  -- 20:00 UTC = 03:00 น. เวลาไทย
  perform cron.schedule('newcute-integrations-daily', '0 20 * * *', 'select public.integrations_daily()');
  raise notice 'ตั้งตัวปลุกระบบเชื่อมต่อแล้ว: % (pg_cron รุ่น %)', v_sched, coalesce(v_ver, 'ไม่ทราบ');
end
$$;

commit;

-- สรุป (อ่านอย่างเดียว): งานที่ตั้งไว้ + ค่าที่เก็บใน Vault (ไม่แสดงค่าลับ) + ตอนนี้มีงานรอไหม
select j.jobname as "งาน",
       j.schedule as "รอบ",
       case when j.active then 'เปิด' else 'ปิด' end as "สถานะ",
       (select string_agg(s.name, ', ' order by s.name)
          from vault.secrets as s
         where s.name in ('newcute_integrations_worker_url', 'newcute_integrations_worker_secret')) as "เก็บใน Vault",
       case when public.integration_work_due() then 'มีงานรอ (จะปลุก worker รอบถัดไป)' else 'ไม่มีงานรอ' end as "ตอนนี้"
  from cron.job as j
 where j.jobname like 'newcute-integrations-%'
 order by j.jobname;
