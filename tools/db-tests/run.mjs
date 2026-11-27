// =========================================================================
// tools/db-tests/run.mjs — ชุดทดสอบ SQL ของ NEWCUTE / ร้านเช่าชุด / b.oncloud (PGlite = Postgres ในหน่วยความจำ)
//
//   node run.mjs                 รันทุกไฟล์ใน tests/ (เรียงตามชื่อไฟล์)
//   node run.mjs wedding-money   รันเฉพาะไฟล์ที่ชื่อมีคำนี้ (หลายคำได้)
//   SQL_DIR=<โฟลเดอร์> node run.mjs   โหลดไฟล์ supabase-*.sql จากโฟลเดอร์อื่น (ใช้ทดสอบสำเนาที่แก้ทดลอง)
//
// ทุกไฟล์ทดสอบได้ฐานข้อมูลใหม่ของตัวเอง (โหลด SQL ของ repo ตามลำดับจริงทุกครั้ง) — ไม่มีอะไรค้างข้ามไฟล์
// ไม่ต่อเน็ต ไม่แตะ Supabase จริง: auth / storage / role ของ Supabase จำลองขึ้นมาให้พอใช้ (ดู BOOTSTRAP_SQL)
// =========================================================================
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');
const SQL_DIR = process.env.SQL_DIR ? path.resolve(process.env.SQL_DIR) : REPO;

// ลำดับเดียวกับที่รันจริงใน Supabase SQL Editor
export const MIGRATIONS = [
  'supabase-schema.sql',
  'supabase-indexes.sql',
  'supabase-users.sql',
  'supabase-fix-01.sql',
  'supabase-fix-02.sql',
  'supabase-fix-03-integrations.sql',
  'supabase-fix-04-pos.sql',
  'supabase-fix-05-rental.sql',
  'supabase-fix-06-rental-online.sql',
  'supabase-fix-07-wedding.sql',
  'supabase-fix-08-lock-order.sql',
  'supabase-fix-09-wedding-pay-on-event-day.sql',
  'supabase-fix-10-wedding-package-detail.sql',
];

// ----- ของ Supabase ที่ไฟล์ SQL พึ่ง (จำลองแบบน้อยที่สุด) -----
//   tableGrants = 'legacy' → ตารางใหม่ได้สิทธิ์ anon/authenticated อัตโนมัติ (Supabase ก่อน 30 ต.ค. 2026 — ตรวจว่าเรา revoke ครบ)
//                 'none'   → ไม่ให้อัตโนมัติ (Supabase ปัจจุบัน — ตรวจว่าเรา grant เองครบ)
//   ฟังก์ชัน: Postgres ให้ EXECUTE กับ PUBLIC เสมอ + Supabase ให้ anon/authenticated เพิ่ม → ตรวจว่า revoke ครบ
function bootstrapSql(tableGrants) {
  return `
set timezone = 'UTC';
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  last_sign_in_at timestamptz,
  created_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable as $f$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$f$;
create or replace function auth.role() returns text language sql stable as $f$
  select nullif(current_setting('request.jwt.claim.role', true), '')::text
$f$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
${tableGrants === 'legacy'
    ? 'alter default privileges in schema public grant all on tables to anon, authenticated, service_role;'
    : 'alter default privileges in schema public grant all on tables to service_role;'}
`;
}

// ----- ตัวช่วยสำหรับไฟล์ทดสอบ -----
export class TestFailure extends Error {}

function fmt(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

// ค่าที่ส่งเข้า SQL: object/array → jsonb, อย่างอื่นปล่อยให้ Postgres เดาชนิดจากพารามิเตอร์ของฟังก์ชัน
function bindArgs(args) {
  const names = Object.keys(args ?? {});
  const params = [];
  const parts = names.map((name) => {
    const v = args[name];
    if (v === undefined) return null;
    if (v === null) { return `${name} => null`; }
    if (typeof v === 'object' && !(v instanceof Date)) {
      params.push(JSON.stringify(v));
      return `${name} => $${params.length}::jsonb`;
    }
    params.push(v instanceof Date ? v.toISOString() : v);
    return `${name} => $${params.length}`;
  }).filter(Boolean);
  return { sql: parts.join(', '), params };
}

// extensions = ส่วนขยาย PGlite เพิ่มเติม (เช่น pageinspect ใช้ดูล็อกแถวในไฟล์ทดสอบลำดับการล็อก) — ต้อง create extension เอง
// preparedTransactions = จำนวน prepare transaction ที่ค้างได้พร้อมกัน (0 = ปิดแบบ Postgres ปกติ)
//   ใช้จำลอง "อีกรายการที่ยังไม่ commit ถือล็อกอยู่" บนการเชื่อมต่อเดียวของ PGlite (ดู tests/80-pos-lock-order.mjs)
export async function createDb({ tableGrants = 'legacy', upTo = null, extraSql = [], extensions = {}, preparedTransactions = 0 } = {}) {
  const db = new PGlite({
    extensions: { btree_gist, uuid_ossp, ...extensions },
    ...(preparedTransactions > 0
      ? { startParams: [...PGlite.defaultStartParams, '-c', `max_prepared_transactions=${preparedTransactions}`] }
      : {}),
  });
  await db.exec(bootstrapSql(tableGrants));
  const files = upTo ? MIGRATIONS.slice(0, MIGRATIONS.indexOf(upTo) + 1) : MIGRATIONS;
  const results = {};
  for (const f of files) {
    const text = await readFile(path.join(SQL_DIR, f), 'utf8');
    try {
      results[f] = await db.exec(text);
    } catch (e) {
      throw new Error(`โหลด ${f} ไม่สำเร็จ: ${e.message}${e.where ? '\n  ที่ ' + e.where : ''}`);
    }
  }
  for (const s of extraSql) await db.exec(s);
  return new Ctx(db, results);
}

// โหลดไฟล์ SQL ซ้ำบนฐานข้อมูลเดิม (เหมือนกด Run ซ้ำใน SQL Editor) — พังกลางทาง = rollback ทั้งไฟล์ แล้วโยน error ต่อ
export async function loadSqlFile(ctx, file) {
  const text = await readFile(path.join(SQL_DIR, file), 'utf8');
  try {
    return await ctx.db.exec(text);
  } catch (e) {
    await ctx.db.exec('rollback');
    throw e;
  }
}

class Session {
  constructor(ctx, role, uid) {
    this.ctx = ctx;
    this.role = role; // 'authenticated' | 'anon' | 'service_role' | null (= postgres เจ้าของฐานข้อมูล)
    this.uid = uid ?? null;
  }

  // 1 คำสั่ง = 1 รายการ (commit ถ้าสำเร็จ / rollback ถ้าพัง) — แบบเดียวกับ PostgREST
  async query(sql, params = []) {
    const db = this.ctx.db;
    await db.exec('begin');
    try {
      if (this.role) {
        await db.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true),
                               set_config('role', $2, true)`, [this.uid ?? '', this.role]);
      }
      const res = await db.query(sql, params);
      await db.exec('commit');
      return res.rows;
    } catch (e) {
      await db.exec('rollback');
      throw e;
    }
  }

  async one(sql, params = []) {
    const rows = await this.query(sql, params);
    if (rows.length !== 1) throw new TestFailure(`คาด 1 แถว ได้ ${rows.length}: ${sql}`);
    return rows[0];
  }

  async all(sql, params = []) {
    return this.query(sql, params);
  }

  // เรียกฟังก์ชันแบบ PostgREST /rpc: rpc('wed_get_booking', { p_booking_id: id })
  async rpc(fn, args = {}) {
    const { sql, params } = bindArgs(args);
    const rows = await this.query(`select public.${fn}(${sql}) as r`, params);
    return rows[0].r;
  }

  // ฟังก์ชันที่คืนเป็นตาราง (ส่งออก CSV)
  async rpcRows(fn, args = {}) {
    const { sql, params } = bindArgs(args);
    return this.query(`select * from public.${fn}(${sql})`, params);
  }
}

class Ctx {
  constructor(db, loadResults) {
    this.db = db;
    this.loadResults = loadResults;
    this.pg = new Session(this, null, null);
    this.anon = new Session(this, 'anon', null);
    this.service = new Session(this, 'service_role', null);
  }

  asUser(uid) { return new Session(this, 'authenticated', uid); }
  asAnon() { return this.anon; }
  asService() { return this.service; }
  asPostgres() { return this.pg; }

  // ผู้ใช้ใหม่ 1 คน (auth.users → trigger สร้าง user_profiles) + ตั้ง role/สิทธิ์ด้วยเจ้าของฐานข้อมูล
  async makeUser({ name = 'ผู้ใช้ทดสอบ', role = 'staff', perms = {} } = {}) {
    const id = randomUUID();
    const email = `u${id.slice(0, 8)}@test.local`;
    await this.pg.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)`,
      [id, email, JSON.stringify({ full_name: name })]);
    await this.pg.query(`update public.user_profiles set role = $2, full_name = $3,
                                permissions = coalesce(permissions, '{}'::jsonb) || $4::jsonb where id = $1`,
      [id, role, name, JSON.stringify(perms)]);
    const s = this.asUser(id);
    s.name = name;
    return s;
  }
}

// ----- ตัวช่วยตรวจผล -----
export function eq(actual, expected, label = '') {
  const a = normalize(actual);
  const b = normalize(expected);
  if (fmt(a) !== fmt(b)) {
    throw new TestFailure(`${label ? label + ': ' : ''}คาด ${fmt(b)} ได้ ${fmt(a)}`);
  }
}

// ตัวเลขจาก numeric มาเป็นข้อความ/ตัวเลขก็ได้ — เทียบเป็นตัวเลขทศนิยม 2 ตำแหน่ง
export function money(actual, expected, label = '') {
  const a = Number(actual);
  const b = Number(expected);
  if (!Number.isFinite(a) || Math.abs(a - b) > 0.0049) {
    throw new TestFailure(`${label ? label + ': ' : ''}คาดเงิน ${b} ได้ ${fmt(actual)}`);
  }
}

export function ok(cond, label = 'เงื่อนไขไม่เป็นจริง') {
  if (!cond) throw new TestFailure(label);
}

function normalize(v) {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = normalize(v[k]);
    return o;
  }
  return v;
}

// ต้องพัง: pattern = ข้อความบางส่วน (string) หรือ RegExp ; code = SQLSTATE ที่คาด (ไม่บังคับ)
export async function expectErr(promiseOrFn, pattern, { code, hint } = {}) {
  let err = null;
  try {
    await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn);
  } catch (e) {
    err = e;
  }
  if (!err) throw new TestFailure(`คาดว่าจะ error (${pattern}) แต่ทำงานสำเร็จ`);
  if (err instanceof TestFailure) throw err;
  const msg = String(err.message ?? err);
  if (pattern instanceof RegExp ? !pattern.test(msg) : pattern && !msg.includes(pattern)) {
    throw new TestFailure(`ข้อความ error ไม่ตรง: คาด ${pattern} ได้ "${msg}"`);
  }
  if (code && err.code !== code) {
    throw new TestFailure(`SQLSTATE ไม่ตรง: คาด ${code} ได้ ${err.code} ("${msg}")`);
  }
  if (hint !== undefined && err.hint !== hint) {
    throw new TestFailure(`hint ไม่ตรง: คาด ${hint} ได้ ${err.hint} ("${msg}")`);
  }
  return err;
}

export const uuid = () => randomUUID();

// ----- ตัวรัน -----
async function main() {
  const filters = process.argv.slice(2);
  const dir = path.join(HERE, 'tests');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.mjs')).sort()
    .filter((f) => filters.length === 0 || filters.some((x) => f.includes(x)));
  let passed = 0;
  let failed = 0;
  const failures = [];
  const t0 = Date.now();

  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(dir, f)).href);
    const tests = [];
    const test = (name, fn) => tests.push({ name, fn });
    let ctx = null;
    try {
      // ไฟล์ทดสอบส่งออก setup(ctx) (ไม่บังคับ) + register(test) ; หรือ default(test)
      if (typeof mod.register !== 'function') throw new Error('ไฟล์ทดสอบต้อง export function register(test)');
      mod.register(test);
      ctx = mod.noDefaultDb ? null : await createDb(mod.dbOptions ?? {});
      const state = {};
      if (typeof mod.setup === 'function') await mod.setup(ctx, state);
      for (const t of tests) {
        const ts = Date.now();
        try {
          await t.fn(ctx, state);
          passed += 1;
          console.log(`  ok   ${f} › ${t.name} (${Date.now() - ts} ms)`);
        } catch (e) {
          failed += 1;
          failures.push(`${f} › ${t.name}: ${e.message}`);
          console.log(`  FAIL ${f} › ${t.name}\n       ${e.message}${e.where ? '\n       ที่ ' + e.where : ''}`);
        }
      }
    } catch (e) {
      failed += 1;
      failures.push(`${f} (setup): ${e.message}`);
      console.log(`  FAIL ${f} (setup)\n       ${e.message}${e.where ? '\n       ที่ ' + e.where : ''}`);
    } finally {
      if (ctx) await ctx.db.close();
    }
  }

  console.log(`\n${passed} ผ่าน, ${failed} ไม่ผ่าน (${((Date.now() - t0) / 1000).toFixed(1)} วินาที)`);
  if (failed) {
    console.log('\nไม่ผ่าน:\n' + failures.map((x) => '  - ' + x).join('\n'));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
