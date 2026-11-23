# ชุดทดสอบ SQL (PGlite)

ทดสอบไฟล์ `supabase-*.sql` ทั้งหมดของ repo บน Postgres ในหน่วยความจำ ([PGlite](https://pglite.dev)) — ไม่ต่อเน็ต ไม่แตะ Supabase จริง
ทุกไฟล์ทดสอบได้ฐานข้อมูลใหม่ของตัวเอง โดยโหลด SQL ตามลำดับจริงที่รันใน Supabase SQL Editor:

```
supabase-schema.sql → supabase-indexes.sql → supabase-users.sql → supabase-fix-01.sql → supabase-fix-02.sql
→ supabase-fix-03-integrations.sql → supabase-fix-04-pos.sql → supabase-fix-05-rental.sql
→ supabase-fix-06-rental-online.sql → supabase-fix-07-wedding.sql → supabase-fix-08-lock-order.sql
```

(`supabase-cron-integrations.sql` และ `supabase-cleanup-test-data.sql` ไม่ได้โหลด — ต้องใช้ pg_cron/pg_net ของ Supabase)

## วิธีรัน

```sh
cd tools/db-tests
npm install            # ครั้งแรกครั้งเดียว (ติดตั้ง @electric-sql/pglite ไว้ในโฟลเดอร์นี้เท่านั้น)
node run.mjs           # รันทุกไฟล์ใน tests/
node run.mjs money     # รันเฉพาะไฟล์ที่ชื่อมีคำว่า money (ใส่หลายคำได้: node run.mjs 20 25)
```

ผ่านทั้งหมด = exit code 0 / มีข้อไม่ผ่าน = exit code 1 พร้อมรายการข้อที่ไม่ผ่านท้ายผลลัพธ์

ทดสอบสำเนา SQL ที่แก้ทดลอง (เช่น ตรวจว่าชุดทดสอบจับกฎที่พังได้จริง) โดยไม่แตะไฟล์ใน repo:

```sh
SQL_DIR=/path/to/copy node run.mjs 30     # โฟลเดอร์ต้องมีไฟล์ supabase-*.sql ครบทุกไฟล์
```

## สิ่งที่จำลองแทน Supabase (ดู `bootstrapSql()` ใน run.mjs)

- role `anon`, `authenticated`, `service_role` (bypassrls)
- schema `auth`: ตาราง `auth.users` + `auth.uid()` / `auth.role()` อ่านจาก `request.jwt.claim.sub` / `request.jwt.claim.role`
- schema `storage`: `storage.buckets` / `storage.objects` (เปิด RLS)
- default privileges: ฟังก์ชัน/sequence ใหม่ให้สิทธิ์ anon + authenticated อัตโนมัติ (ตรวจว่าไฟล์ SQL revoke ครบ)
  ตารางใหม่: `createDb({ tableGrants: 'legacy' })` (ค่าเริ่มต้น — ให้สิทธิ์อัตโนมัติแบบ Supabase เดิม ตรวจว่า revoke ครบ)
  หรือ `'none'` (แบบ Supabase ตั้งแต่ 30 ต.ค. 2026 — ตรวจว่า grant เองครบ)
- `set timezone = 'UTC'` เหมือน Supabase — "วันนี้" ของระบบต้องมาจาก `pos_bkk_today()` (เวลาไทย) เสมอ

## เขียนไฟล์ทดสอบใหม่

ไฟล์ `tests/NN-ชื่อ.mjs` (เรียงตามชื่อ) ส่งออก:

```js
import { eq, ok, money, expectErr, uuid } from '../run.mjs';

export const dbOptions = { tableGrants: 'legacy' };   // ไม่บังคับ
export async function setup(ctx, state) { state.u = await ctx.makeUser({ perms: { wedding: true } }); }  // ไม่บังคับ
export function register(test) {
  test('ชื่อข้อทดสอบ (ภาษาไทย)', async (ctx, state) => {
    const r = await state.u.rpc('wed_get_settings');           // เรียกแบบ PostgREST /rpc (อาร์กิวเมนต์ตามชื่อ)
    eq(r.shop_name, 'b.oncloud.wedding content');
    await expectErr(() => ctx.anon.rpc('wed_get_settings'), 'permission denied', { code: '42501' });
  });
}
```

ตัวช่วย (จาก `run.mjs`):

| ตัวช่วย | ใช้ทำอะไร |
|---|---|
| `ctx.makeUser({ name, role, perms })` | สร้างผู้ใช้ใน auth.users + ตั้ง role/สิทธิ์ → ได้ session ของผู้ใช้คนนั้น |
| `ctx.asUser(uid)` / `ctx.asAnon()` / `ctx.asService()` / `ctx.asPostgres()` | session ตาม role (`ctx.anon`, `ctx.service`, `ctx.pg` ก็ได้) |
| `s.rpc(fn, args)` / `s.rpcRows(fn, args)` | เรียกฟังก์ชัน (คืนค่าเดียว / คืนเป็นตาราง) — object/array ส่งเป็น jsonb |
| `s.query(sql, params)` / `s.one(...)` / `s.all(...)` | SQL ตรง (1 คำสั่ง = 1 รายการ commit/rollback แบบ PostgREST) |
| `eq(a, b)` / `money(a, b)` / `ok(cond)` | ตรวจค่า (eq เทียบ JSON ไม่สนลำดับคีย์ / money เทียบเงิน 2 ตำแหน่ง) |
| `expectErr(fn, ข้อความบางส่วน, { code, hint })` | ต้อง error ตามข้อความ (และ SQLSTATE / hint ถ้าระบุ) |
| `createDb(opts)` / `loadSqlFile(ctx, file)` | ฐานข้อมูลใหม่อีกก้อน / โหลดไฟล์ SQL ซ้ำ (rollback ถ้าพัง) — `opts.upTo` = โหลดถึงไฟล์นั้น, `opts.extensions` = ส่วนขยาย PGlite เพิ่ม (เช่น pageinspect), `opts.preparedTransactions` = เปิด prepare transaction (จำลองอีกรายการที่ถือล็อกค้าง) |

ตัวช่วยร่วมของ b.oncloud อยู่ที่ `tests/lib/wed.js` (ผู้ใช้ 6 แบบ, ทีมงาน/แพ็กเกจ/บริการเสริม/ลูกค้าตั้งต้น, payload งาน, รับเงิน)

## ไฟล์ทดสอบที่มี

| ไฟล์ | ครอบคลุม |
|---|---|
| `00-migrations` | ทุกไฟล์โหลดได้, ตารางสรุปท้าย fix-07, รัน fix-07 ซ้ำ (ข้อมูล/ตั้งค่าไม่หาย), ตรวจของที่ต้องมีก่อน, ขายหน้าร้าน + ร้านเช่ายังใช้ได้ |
| `10-wedding-permissions` | ตารางสิทธิ์ (ไม่มีสิทธิ์ / wedding / wedding_manage / แอดมิน / NEWCUTE / ร้านเช่า / anon), RLS ทุกตาราง, ค่าตัวทีมงานไม่หลุดถึงพนักงาน, สิทธิ์ฟังก์ชัน, ถังไฟล์ (JPG/PNG/WEBP เท่านั้น) + นโยบาย storage, โหมดไม่ให้สิทธิ์ตารางอัตโนมัติ |
| `15-wedding-catalog` | ตั้งค่าร้าน, แพ็กเกจ, บริการเสริม, ลูกค้า, ทีมงาน |
| `20-wedding-status` | ทุกการเปลี่ยนสถานะ + ที่ห้าม, กดซ้ำ, สร้าง/แก้งานกันซ้ำ + กันเขียนทับ, ตรวจข้อมูลคิว |
| `25-wedding-capacity-conflicts` | คิวเต็ม (บังคับ/ไม่จำกัด/คิวยกเลิก/วันใหม่ตอนแก้งาน), ทีมชนคิว (ทับ/ต่อพอดี/เวลาถึงงาน/ไม่มีเวลา) |
| `30-wedding-money` | ยอดเศษสตางค์, ส่วนลด, มัดจำ ณ ตอนจอง, รับ/คืน/ยกเลิกรายการเงิน, วันที่รับเงิน, สลิป, งวดชำระ, ค่าตัวทีมงาน |
| `32-wedding-deposit-override` | มัดจำกำหนดเองต่องาน: ราคาล่วงหน้า/สร้าง/แก้ (ตั้ง → ไม่ส่งคีย์ = คงเดิม → null/ช่องว่าง = อัตโนมัติ), ไม่เกินยอดหลังส่วนลด (ค่าใช้จ่ายเพิ่มทีหลังไม่ดันมัดจำขึ้น), มัดจำ 0 ยืนยันได้โดยไม่บังคับ, ได้รับมัดจำครบ/วัตถุประสงค์รับเงินอัตโนมัติ, งวดมาตรฐาน/งวดที่แก้เอง, สิทธิ์เหมือนส่วนลด, ตรวจค่า (ติดลบ/ไม่ใช่ตัวเลข/ทศนิยมเกิน 2 ตำแหน่ง/สูงเกิน), ประวัติ [เดิม, ใหม่], ภาพรวมวันนี้/เมนู/รายละเอียดวัน/CSV/ลิงก์ลูกค้าใช้ยอดเดียวกัน, รัน fix-07 ซ้ำ (ฐานที่ยังไม่มีคอลัมน์ + ค่าไม่หาย) |
| `35-wedding-review-fixes` | กันพังซ้ำจากรอบตรวจ: ค่าตัวที่จ่ายแล้ว/งานยกเลิกหลังถ่ายยังอยู่ในบัญชี, คิวที่จ่ายแล้วยกเลิกไม่ได้, ย้ายคิวค่าตัวไม่รีเซ็ต, กำหนดส่งเลื่อนตามวันงาน, ล็อกคิว/ยืนยันต้องมีวันทุกคิว, งวดมัดจำนับจากวันล็อกคิว, ค่าใช้จ่ายเพิ่มตอนเลื่อนงาน, ทีมชนคิวของงานยกเลิก/เลื่อน, วัตถุประสงค์จ่ายครบ, ยกเลิกคืนเงินแล้วเงินเกิน, ล็อกคิวที่คืนเงินหมด, เพิ่มรายการส่งงานหลังส่งครบ, วันที่ย้อนหลังเกิน 3 ปี, กระดานงานส่งของงานที่ปิดแล้ว, CSV จำนวนทศนิยม, วันชำระยอดคงเหลือของงานกระชั้นชิด, รหัสคำขอสร้าง/แก้ไขงานไม่นับธง force |
| `40-wedding-deliverables` | แผนงานส่ง, รายการส่งงาน, ส่งครบ → ส่งงานแล้วอัตโนมัติ, กระดานงานตัดต่อ |
| `50-wedding-calendar` | ปฏิทิน, รายละเอียดวัน, ภาพรวมวันนี้, ตัวเลขบนเมนู, ล็อกคิวหมดเวลา, ขอบวันตามเวลาไทย |
| `60-wedding-reports` | รายงานรายรับตามวันที่รับเงิน, ต้นทุน/กำไร, ส่งออก CSV แบ่งหน้า |
| `70-wedding-public` | ลิงก์ติดตามงานของลูกค้า (ปิดบังข้อมูล, ลิงก์ส่งงาน, ยกเลิก, ปิดลิงก์, เปลี่ยนลิงก์, anon เรียกอย่างอื่นไม่ได้) |
| `80-pos-lock-order` | fix-08 กัน deadlock ออเดอร์แพลตฟอร์ม vs งานหน้าร้าน: ผลเหมือนก่อนรัน fix-08 ทุกขั้น (บิลแรก/ส่งซ้ำ/เปลี่ยนจำนวน/ขายเกิน/ย้ายรายการ/จับคู่ไม่ได้/ยังไม่จ่าย→จ่าย/ยกเลิก/คืนของ/หมดอายุก่อน-หลังส่ง/คืนสต๊อกอัตโนมัติ/ยกเว้นส่วนที่ขาด/บิลที่ออเดอร์ไม่ได้จำ sale_id/โหมดทดลอง→ตัดสต๊อก + ขาย/ยกเลิกบิล/คืนสินค้า/ตรวจนับ/รับ-จ่ายสต๊อก), ล็อกสินค้าก่อนเขียนบิล + ล็อกแบบ no key update ก่อนแก้สต๊อกทุกฟังก์ชัน (pageinspect อ่านบิตล็อกแถว), อีกรายการถือล็อกค้างจริง (prepare transaction ในโปรเซสแยก `tests/lib/lock-hold-child.mjs` — ต้องไม่รอทุกขาของวง, SQL เดิมต้องรอ), เนื้อฟังก์ชันเหมือนต้นฉบับยกเว้นคำล็อก, รันซ้ำ, ตรวจของที่ต้องมีก่อน, ตารางสรุปจับของผิด |
