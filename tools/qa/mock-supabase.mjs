// =========================================================================
// tools/qa/mock-supabase.mjs — Supabase จำลองสำหรับทดสอบหน้าเว็บจริงในเบราว์เซอร์ (ไม่ต่อเน็ต ไม่แตะ Supabase จริง)
//
//   node mock-supabase.mjs [--port 54321] [--seed]       เปิดเซิร์ฟเวอร์ (Ctrl+C ปิด)
//   import { startMock } from './mock-supabase.mjs'         ใช้จากสคริปต์อื่น (คืน { url, ctx, close, users })
//
// ฐานข้อมูล = PGlite (Postgres ในหน่วยความจำ) ที่โหลดไฟล์ supabase-*.sql "ตัวจริง" ของ repo ตามลำดับจริง
//   (ใช้ createDb() ของ tools/db-tests/run.mjs — stub auth/storage/role ชุดเดียวกับชุดทดสอบ SQL)
// ทำไมต้องจำลอง PostgREST เอง: หน้าเว็บเรียก supabase-js ตรง (.from().select() / .rpc() / storage) — ถ้าจำลองผลลัพธ์ด้วยมือ
//   จะไม่เจอบั๊กที่ชื่อคอลัมน์/อาร์กิวเมนต์/สิทธิ์ RLS ไม่ตรงกับ SQL จริง ; ที่นี่ทุกคำขอวิ่งเป็น SQL จริงใต้ role/claims ของผู้ใช้
//
// รองรับ (เท่าที่แอปใช้):
//   /auth/v1    token (password / refresh_token), user, logout, admin/users (list/get/create/update/delete) — JWT ไม่เซ็น
//   /rest/v1    rpc/<fn> (อาร์กิวเมนต์ตามชื่อ, เลือก overload ตามชื่อคีย์, ไม่พบ = PGRST202 แบบของจริง)
//               <table>: select (คอลัมน์, alias:, ::cast, *, embed ตาม FK จริง + !hint/!inner, ชนกันหลาย FK = PGRST201),
//               ตัวกรอง eq/neq/gt/gte/lt/lte/like/ilike/is/in/cs/cd + not. + or=(...)/and=(...), order (nullsfirst/last),
//               limit/offset + embed.limit/order, Prefer count=exact (Content-Range), HEAD, object+json (single),
//               insert/upsert (on_conflict, merge/ignore-duplicates), update, delete, return=representation|minimal
//   /storage/v1 upload (multipart/raw, x-upsert), sign (เดี่ยว/หลายไฟล์), public/sign/authenticated GET, remove
//               — สิทธิ์ใช้นโยบาย RLS ของ storage.objects ใน SQL จริง (insert/select/delete ใต้ role ผู้ใช้)
// =========================================================================
import http from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDb } from '../db-tests/run.mjs';

export const ANON_KEY = 'qa-anon-key';
export const SERVICE_KEY = 'qa-service-key';
const JWT_SECONDS = 24 * 3600;

// ---------- JWT ไม่เซ็น (แอปไม่ตรวจลายเซ็นเอง; ส่งมาให้ mock อ่าน sub/role เท่านั้น) ----------
const b64u = (s) => Buffer.from(s).toString('base64url');
function makeJwt(payload) {
  return `${b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64u(JSON.stringify(payload))}.qa-unsigned`;
}
function readJwt(tok) {
  const parts = String(tok || '').split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
}

// ---------- ล็อกเดียวทั้งเซิร์ฟเวอร์: PGlite มีการเชื่อมต่อเดียว → begin/commit ของคำขอพร้อมกันห้ามสลับกัน ----------
let chain = Promise.resolve();
function withLock(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

class HttpErr extends Error {
  constructor(status, body) { super(body?.message || String(status)); this.status = status; this.body = body; }
}

const qi = (s) => '"' + String(s).replace(/"/g, '""') + '"';

// error ของ Postgres → สถานะ HTTP แบบ PostgREST
function pgErrStatus(code, role) {
  if (code === '42501') return role === 'anon' ? 401 : 403;
  if (code === '23505' || code === '23503' || code === '40001') return 409;
  if (code === '42883' || code === '42P01') return 404;
  if (code === 'P0001' || /^22/.test(code || '') || /^23/.test(code || '') || code === '42703' || code === '42804') return 400;
  if (code === '57014') return 500;
  return 400;
}
function pgErrBody(e) {
  return { code: e.code ?? null, message: e.message, details: e.detail ?? null, hint: e.hint ?? null };
}

export async function startMock({ port = 54321, host = '127.0.0.1', log = false, dbOptions = {} } = {}) {
  const ctx = await createDb(dbOptions);
  const db = ctx.db;
  const passwords = new Map(); // email → { id, password }
  const refresh = new Map();   // refresh token → user id
  const files = new Map();     // `${bucket}/${name}` → { bytes, type }
  const signTokens = new Map(); // token → `${bucket}/${name}`
  const stats = { requests: 0, errors: [] };

  // ---------- ข้อมูล schema (cache) ----------
  const colTypes = new Map(); // table → Map(col → type)
  async function tableCols(table) {
    if (colTypes.has(table)) return colTypes.get(table);
    const r = await db.query(
      `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type
         from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = $1 and a.attnum > 0 and not a.attisdropped`, [table]);
    const m = new Map(r.rows.map((x) => [x.name, x.type]));
    if (m.size === 0) throw new HttpErr(404, { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache`, details: null, hint: null });
    colTypes.set(table, m);
    return m;
  }
  let fkCache = null;
  async function fks() {
    if (fkCache) return fkCache;
    const r = await db.query(
      `select con.conname as name, c.relname as tbl, f.relname as ftbl,
              (select array_agg(a.attname order by k.ord) from unnest(con.conkey) with ordinality k(n, ord)
                 join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n) as cols,
              (select array_agg(a.attname order by k.ord) from unnest(con.confkey) with ordinality k(n, ord)
                 join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n) as fcols
         from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_class f on f.oid = con.confrelid
         join pg_namespace n on n.oid = c.relnamespace join pg_namespace fn on fn.oid = f.relnamespace
        where con.contype = 'f' and n.nspname = 'public' and fn.nspname = 'public'`);
    fkCache = r.rows.map((x) => ({ ...x, cols: pgArr(x.cols), fcols: pgArr(x.fcols) }));
    return fkCache;
  }
  function pgArr(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') return v.replace(/^\{|\}$/g, '').split(',').filter(Boolean).map((s) => s.replace(/^"|"$/g, ''));
    return [];
  }
  const procCache = new Map();
  async function procs(fn) {
    if (procCache.has(fn)) return procCache.get(fn);
    const r = await db.query(
      `select p.oid, p.proname, p.proretset as retset, p.pronargdefaults as ndef, p.prokind,
              format_type(p.prorettype, null) as rettype, t.typtype as rettyptype,
              coalesce(p.proallargtypes::oid[], p.proargtypes::oid[]) as alltypes,
              p.proargtypes::oid[] as intypes, p.proargnames as names, p.proargmodes::text[] as modes,
              p.pronargs as nargs
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
        where n.nspname = 'public' and p.proname = $1`, [fn]);
    const list = [];
    for (const row of r.rows) {
      const names = pgArr(row.names);
      const modes = row.modes ? pgArr(row.modes) : null;
      const alltypes = pgArr(row.alltypes).map(Number);
      const args = [];
      for (let i = 0; i < alltypes.length; i++) {
        const mode = modes ? modes[i] : 'i';
        if (mode !== 'i' && mode !== 'b' && mode !== 'v') continue;
        args.push({ name: names[i] || '', typeOid: alltypes[i] });
      }
      for (const a of args) {
        const t = await db.query(`select format_type($1::oid, null) as t, typcategory as cat from pg_type where oid = $1::oid`, [a.typeOid]);
        a.type = t.rows[0].t; a.cat = t.rows[0].cat;
      }
      const nreq = args.length - Number(row.ndef || 0);
      args.forEach((a, i) => { a.required = i < nreq; });
      list.push({ retset: row.retset, rettype: row.rettype, rettyptype: row.rettyptype, args });
    }
    procCache.set(fn, list);
    return list;
  }

  // ---------- ตัวตนผู้เรียก ----------
  function authOf(req) {
    const h = req.headers.authorization || '';
    const tok = h.startsWith('Bearer ') ? h.slice(7) : (req.headers.apikey || '');
    if (tok === SERVICE_KEY) return { role: 'service_role', uid: null };
    if (tok === ANON_KEY || !tok) return { role: 'anon', uid: null };
    const p = readJwt(tok);
    if (p && p.sub && (!p.exp || p.exp * 1000 > Date.now())) return { role: p.role || 'authenticated', uid: p.sub, email: p.email };
    if (p && p.role === 'service_role') return { role: 'service_role', uid: null };
    return { role: 'anon', uid: null, badJwt: !!p };
  }

  // 1 คำขอ = 1 รายการ (commit/rollback) ใต้ role + claims ของผู้เรียก — แบบเดียวกับ PostgREST
  async function tx(auth, fn) {
    return withLock(async () => {
      await db.exec('begin');
      try {
        await db.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true),
                               set_config('request.jwt.claims', $3, true), set_config('role', $2, true)`,
          [auth.uid ?? '', auth.role, JSON.stringify({ sub: auth.uid, role: auth.role })]);
        const out = await fn();
        await db.exec('commit');
        return out;
      } catch (e) {
        try { await db.exec('rollback'); } catch {}
        throw e;
      }
    });
  }
  // คำสั่งของเจ้าของฐานข้อมูล (ข้อมูล schema / auth.users) — ยังต้องผ่านล็อก
  const asOwner = (fn) => withLock(fn);

  // ---------- Auth ----------
  async function userJson(id) {
    const r = await db.query(`select id, email, raw_user_meta_data as meta, created_at, last_sign_in_at from auth.users where id = $1`, [id]);
    const u = r.rows[0];
    if (!u) return null;
    return {
      id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.created_at,
      phone: '', confirmed_at: u.created_at, last_sign_in_at: u.last_sign_in_at, app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: u.meta || {}, identities: [], created_at: u.created_at, updated_at: u.created_at, is_anonymous: false,
    };
  }
  async function sessionFor(id) {
    const user = await userJson(id);
    const now = Math.floor(Date.now() / 1000);
    const access_token = makeJwt({ sub: id, role: 'authenticated', aud: 'authenticated', email: user.email, iat: now, exp: now + JWT_SECONDS, session_id: randomUUID() });
    const refresh_token = randomBytes(12).toString('hex');
    refresh.set(refresh_token, id);
    return { access_token, token_type: 'bearer', expires_in: JWT_SECONDS, expires_at: now + JWT_SECONDS, refresh_token, user };
  }

  /** สร้างผู้ใช้ (auth.users → trigger สร้าง user_profiles) + ตั้ง role/สิทธิ์ ; คืน { id, email, password, rpc(), query() } */
  async function createUser({ email, password, name = email, role = 'staff', perms = {} }) {
    const id = randomUUID();
    await asOwner(async () => {
      await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)`, [id, email, JSON.stringify({ full_name: name })]);
      await db.query(`update public.user_profiles set role = $2, full_name = $3, permissions = coalesce(permissions, '{}'::jsonb) || $4::jsonb where id = $1`,
        [id, role, name, JSON.stringify(perms)]);
    });
    passwords.set(email.toLowerCase(), { id, password });
    const auth = { role: 'authenticated', uid: id };
    return {
      id, email, password, name,
      rpc: (fn, args) => callRpc(auth, fn, args),
      query: (sql, params) => tx(auth, async () => (await db.query(sql, params)).rows),
    };
  }

  async function handleAuth(req, res, url, body) {
    const p = url.pathname.replace(/^\/auth\/v1/, '');
    const auth = authOf(req);
    if (p === '/token' && req.method === 'POST') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const rec = passwords.get(String(body?.email || '').toLowerCase());
        if (!rec || rec.password !== body?.password) {
          return send(res, 400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials', message: 'Invalid login credentials' });
        }
        await asOwner(() => db.query(`update auth.users set last_sign_in_at = now() where id = $1`, [rec.id]));
        return send(res, 200, await asOwner(() => sessionFor(rec.id)));
      }
      if (grant === 'refresh_token') {
        const id = refresh.get(body?.refresh_token);
        if (!id) return send(res, 400, { code: 'refresh_token_not_found', error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found', message: 'Invalid Refresh Token: Refresh Token Not Found' });
        return send(res, 200, await asOwner(() => sessionFor(id)));
      }
      return send(res, 400, { code: 'unsupported_grant_type', msg: 'unsupported grant' });
    }
    if (p === '/user' && req.method === 'GET') {
      if (!auth.uid) return send(res, 401, { code: 'bad_jwt', error_code: 'bad_jwt', msg: 'invalid JWT', message: 'invalid JWT' });
      const u = await asOwner(() => userJson(auth.uid));
      if (!u) return send(res, 403, { code: 'user_not_found', error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' });
      return send(res, 200, u);
    }
    if (p === '/logout') { res.writeHead(204, cors(req)); return res.end(); }
    if (p.startsWith('/admin/users')) {
      if (auth.role !== 'service_role') return send(res, 403, { code: 'not_admin', msg: 'User not allowed' });
      const id = p.split('/')[3];
      if (req.method === 'GET' && !id) {
        const ids = await asOwner(async () => (await db.query(`select id from auth.users order by created_at, id`)).rows.map((r) => r.id));
        const users = [];
        for (const x of ids) users.push(await asOwner(() => userJson(x)));
        return send(res, 200, { users, aud: 'authenticated' }, { 'x-total-count': String(users.length) });
      }
      if (req.method === 'GET' && id) {
        const u = await asOwner(() => userJson(id));
        return u ? send(res, 200, u) : send(res, 404, { code: 'user_not_found', msg: 'User not found' });
      }
      if (req.method === 'POST') {
        const u = await createUser({ email: body.email, password: body.password, name: body.user_metadata?.full_name ?? body.email });
        return send(res, 200, await asOwner(() => userJson(u.id)));
      }
      if (req.method === 'PUT' && id) {
        if (body.password) { for (const [e, r] of passwords) if (r.id === id) r.password = body.password; }
        if (body.user_metadata) await asOwner(() => db.query(`update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data,'{}'::jsonb) || $2::jsonb where id = $1`, [id, JSON.stringify(body.user_metadata)]));
        return send(res, 200, await asOwner(() => userJson(id)));
      }
      if (req.method === 'DELETE' && id) {
        await asOwner(() => db.query(`delete from auth.users where id = $1`, [id]));
        return send(res, 200, {});
      }
    }
    return send(res, 404, { code: 'not_found', msg: `mock: ไม่รองรับ ${req.method} ${p}` });
  }

  // ---------- RPC ----------
  function bindValue(a, v, params) {
    if (v === null || v === undefined) return `null::${a.type}`;
    if (a.type === 'jsonb' || a.type === 'json') { params.push(JSON.stringify(v)); return `$${params.length}::${a.type}`; }
    if (a.cat === 'A' && Array.isArray(v)) {
      params.push('{' + v.map((x) => (x === null ? 'NULL' : '"' + String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"')).join(',') + '}');
      return `$${params.length}::text::${a.type}`;
    }
    params.push(typeof v === 'object' ? JSON.stringify(v) : String(v));
    return `$${params.length}::text::${a.type}`;
  }
  async function callRpc(auth, fn, args = {}, opts = {}) {
    const list = await asOwner(() => procs(fn));
    const keys = Object.keys(args || {}).filter((k) => args[k] !== undefined);
    const cand = list.filter((p) => keys.every((k) => p.args.some((a) => a.name === k)) && p.args.every((a) => !a.required || keys.includes(a.name)));
    if (cand.length === 0) {
      throw new HttpErr(404, {
        code: 'PGRST202', details: `Searched for the function public.${fn} with parameters ${keys.join(', ') || '(none)'} or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.`,
        hint: null, message: `Could not find the function public.${fn}(${keys.join(', ')}) in the schema cache`,
      });
    }
    if (cand.length > 1) {
      // PostgREST: เลือกตัวที่ชื่ออาร์กิวเมนต์ตรงที่สุด ; ยังกำกวม = PGRST203
      cand.sort((x, y) => x.args.length - y.args.length);
      if (cand[0].args.length === cand[1].args.length) throw new HttpErr(300, { code: 'PGRST203', message: `Could not choose the best candidate function between: public.${fn}`, details: null, hint: null });
    }
    const p = cand[0];
    const params = [];
    const parts = keys.map((k) => `${qi(k)} => ${bindValue(p.args.find((a) => a.name === k), args[k], params)}`);
    const call = `public.${qi(fn)}(${parts.join(', ')})`;
    return tx(auth, async () => {
      if (p.retset || p.rettype === 'record') {
        let sql = `select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as r from (select * from ${call} x`;
        if (opts.limit != null) sql += ` limit ${Number(opts.limit)}`;
        if (opts.offset != null) sql += ` offset ${Number(opts.offset)}`;
        sql += ') x';
        const r = await db.query(sql, params);
        let out = r.rows[0].r;
        // setof scalar → [v, v] (คอลัมน์เดียวชื่อเดียวกับฟังก์ชัน)
        if (p.rettyptype !== 'c' && p.rettype !== 'record' && Array.isArray(out)) out = out.map((o) => (o && typeof o === 'object' && fn in o ? o[fn] : o));
        return out;
      }
      if (p.rettype === 'void') { await db.query(`select ${call}`, params); return undefined; }
      const r = await db.query(`select to_jsonb(${call}) as r`, params);
      return r.rows[0].r;
    });
  }

  // ---------- select= ----------
  function splitTop(s, sep = ',') {
    const out = []; let depth = 0; let cur = ''; let q = false;
    for (const ch of s) {
      if (ch === '"') q = !q;
      if (!q && ch === '(') depth++;
      if (!q && ch === ')') depth--;
      if (!q && depth === 0 && ch === sep) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim() !== '') out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
  }
  function parseSelect(s) {
    const items = [];
    for (const raw of splitTop((s || '*').replace(/\s+/g, ' ').trim())) {
      const open = raw.indexOf('(');
      if (open > 0 && raw.endsWith(')')) {
        let head = raw.slice(0, open).trim();
        const inner = raw.slice(open + 1, -1);
        let alias = null;
        const colon = head.indexOf(':');
        if (colon > 0 && head[colon + 1] !== ':') { alias = head.slice(0, colon).trim(); head = head.slice(colon + 1).trim(); }
        const [rel, ...hints] = head.split('!');
        const inner_ = hints.includes('inner');
        const left = hints.includes('left');
        const hint = hints.find((h) => h !== 'inner' && h !== 'left') ?? null;
        items.push({ kind: 'embed', rel: rel.trim(), alias: alias || rel.trim(), hint, inner: inner_, left, select: parseSelect(inner) });
      } else if (raw === '*') {
        items.push({ kind: 'star' });
      } else {
        let expr = raw; let alias = null; let cast = null;
        const castAt = expr.indexOf('::');
        if (castAt > 0) { cast = expr.slice(castAt + 2).trim(); expr = expr.slice(0, castAt).trim(); }
        const colon = expr.indexOf(':');
        if (colon > 0) { alias = expr.slice(0, colon).trim(); expr = expr.slice(colon + 1).trim(); }
        if (/^count\(\)$/.test(expr)) { items.push({ kind: 'count', alias: alias || 'count' }); continue; }
        // json path col->a->>b
        const m = /^([A-Za-z_][A-Za-z0-9_]*)((?:->>?[A-Za-z0-9_]+)*)$/.exec(expr);
        if (!m) throw new HttpErr(400, { code: 'PGRST100', message: `mock: select ที่ไม่รองรับ "${raw}"`, details: null, hint: null });
        const pathParts = m[2] ? m[2].match(/->>?[A-Za-z0-9_]+/g) : [];
        const last = pathParts.length ? pathParts[pathParts.length - 1].replace(/^->>?/, '') : null;
        items.push({ kind: 'col', col: m[1], path: pathParts, alias: alias || last || m[1], cast });
      }
    }
    return items;
  }

  async function relFor(base, rel, hint) {
    const all = await fks();
    // many-to-one: base.cols → rel ; one-to-many: rel.cols → base
    let m2o = all.filter((f) => f.tbl === base && f.ftbl === rel);
    let o2m = all.filter((f) => f.tbl === rel && f.ftbl === base);
    if (hint) {
      const match = (f) => f.name === hint || (f.cols.length === 1 && f.cols[0] === hint);
      m2o = m2o.filter(match); o2m = o2m.filter(match);
    }
    const found = [...m2o.map((f) => ({ f, dir: 'm2o' })), ...o2m.map((f) => ({ f, dir: 'o2m' }))];
    if (found.length === 0) {
      throw new HttpErr(400, { code: 'PGRST200', message: `Could not find a relationship between '${base}' and '${rel}' in the schema cache`, details: `Searched for a foreign key relationship between '${base}' and '${rel}'${hint ? ` using the hint '${hint}'` : ''} in the schema 'public', but no matches were found.`, hint: null });
    }
    if (found.length > 1) {
      throw new HttpErr(300, { code: 'PGRST201', message: `Could not embed because more than one relationship was found for '${base}' and '${rel}'`, details: found.map((x) => ({ relationship: x.f.name, cardinality: x.dir === 'm2o' ? 'many-to-one' : 'one-to-many' })), hint: `Try changing '${rel}' to one of: ${found.map((x) => `'${rel}!${x.f.name}'`).join(', ')}` });
    }
    return found[0];
  }

  let aliasN = 0;
  // คืน SQL expression ที่ได้ jsonb ของ 1 แถว ; embeds = subquery ที่อ้าง alias แม่
  async function rowExpr(table, alias, items, embedOpts, params) {
    const cols = await tableCols(table);
    const pieces = []; const pairs = [];
    for (const it of items) {
      if (it.kind === 'star') { pieces.push(`to_jsonb(${alias})`); continue; }
      if (it.kind === 'count') continue;
      if (it.kind === 'col') {
        if (!cols.has(it.col)) throw new HttpErr(400, { code: '42703', message: `column ${table}.${it.col} does not exist`, details: null, hint: null });
        let e = `${alias}.${qi(it.col)}`;
        for (const pp of it.path) e = `(${e})${pp.startsWith('->>') ? '->>' : '->'}'${pp.replace(/^->>?/, '')}'`;
        if (it.cast) e = `(${e})::${it.cast}`;
        pairs.push(`'${it.alias.replace(/'/g, "''")}', ${e}`);
        continue;
      }
      // embed
      const { f, dir } = await relFor(table, it.rel, it.hint);
      const a2 = `t${++aliasN}`;
      const inner = await rowExpr(it.rel, a2, it.select, embedOpts, params);
      const cond = dir === 'm2o'
        ? f.cols.map((c, i) => `${a2}.${qi(f.fcols[i])} = ${alias}.${qi(c)}`).join(' and ')
        : f.cols.map((c, i) => `${a2}.${qi(c)} = ${alias}.${qi(f.fcols[i])}`).join(' and ');
      const eo = embedOpts.get(it.alias) || embedOpts.get(it.rel) || {};
      let where = cond;
      if (eo.filters?.length) where += ' and ' + (await filtersSql(it.rel, a2, eo.filters, params));
      if (dir === 'm2o') {
        pairs.push(`'${it.alias}', (select ${inner} from public.${qi(it.rel)} ${a2} where ${where} limit 1)`);
      } else {
        const ord = eo.order ? await orderSql(it.rel, a2, eo.order) : '';
        const lim = eo.limit != null ? ` limit ${Number(eo.limit)}` : '';
        const off = eo.offset != null ? ` offset ${Number(eo.offset)}` : '';
        pairs.push(`'${it.alias}', (select coalesce(jsonb_agg(x.j), '[]'::jsonb) from (select ${inner} as j from public.${qi(it.rel)} ${a2} where ${where}${ord}${lim}${off}) x)`);
      }
      if (it.inner || eo.filters?.length) {
        // !inner (หรือกรองบน embed แบบ PostgREST ที่ใช้ !inner) → แม่ต้องมีลูกที่ผ่านเงื่อนไข
        if (it.inner) embedOpts.__parentConds = [...(embedOpts.__parentConds || []), `exists (select 1 from public.${qi(it.rel)} ${a2} where ${where})`];
      }
    }
    // jsonb_build_object รับได้ไม่เกิน 100 อาร์กิวเมนต์ → แบ่งเป็นก้อนละ 40 คู่แล้วต่อกันด้วย ||
    for (let i = 0; i < pairs.length; i += 40) pieces.push(`jsonb_build_object(${pairs.slice(i, i + 40).join(', ')})`);
    if (pieces.length === 0) return `'{}'::jsonb`;
    return pieces.join(' || ');
  }

  // ---------- ตัวกรอง ----------
  function splitOpVal(s) {
    const dot = s.indexOf('.');
    if (dot < 0) return [s, ''];
    return [s.slice(0, dot), s.slice(dot + 1)];
  }
  function parseList(v) {
    // (a,b,"c,d")
    const inner = v.replace(/^\(/, '').replace(/\)$/, '');
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '"') { q = !q; continue; }
      if (ch === '\\' && q) { cur += inner[++i]; continue; }
      if (ch === ',' && !q) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (inner !== '') out.push(cur);
    return out;
  }
  async function condSql(table, alias, col, opv, params) {
    const cols = await tableCols(table);
    let negate = false;
    let [op, val] = splitOpVal(opv);
    if (op === 'not') { negate = true; [op, val] = splitOpVal(val); }
    let jsonPath = '';
    const jm = /^([A-Za-z_][A-Za-z0-9_]*)((?:->>?[A-Za-z0-9_]+)*)$/.exec(col);
    if (!jm) throw new HttpErr(400, { code: 'PGRST100', message: `mock: ตัวกรองไม่รองรับ "${col}"`, details: null, hint: null });
    const base = jm[1];
    if (!cols.has(base)) throw new HttpErr(400, { code: '42703', message: `column ${table}.${base} does not exist`, details: null, hint: null });
    let type = cols.get(base);
    let e = `${alias}.${qi(base)}`;
    if (jm[2]) {
      for (const pp of jm[2].match(/->>?[A-Za-z0-9_]+/g)) e = `(${e})${pp.startsWith('->>') ? '->>' : '->'}'${pp.replace(/^->>?/, '')}'`;
      type = jm[2].match(/->>[A-Za-z0-9_]+$/) ? 'text' : 'jsonb';
      jsonPath = jm[2];
    }
    const P = (v, t = type) => { params.push(v); return `($${params.length}::text)::${t}`; };
    let sql;
    switch (op) {
      case 'eq': sql = `${e} = ${P(val)}`; break;
      case 'neq': sql = `${e} <> ${P(val)}`; break;
      case 'gt': sql = `${e} > ${P(val)}`; break;
      case 'gte': sql = `${e} >= ${P(val)}`; break;
      case 'lt': sql = `${e} < ${P(val)}`; break;
      case 'lte': sql = `${e} <= ${P(val)}`; break;
      case 'like': sql = `${e}::text like ${P(val.replace(/\*/g, '%'), 'text')}`; break;
      case 'ilike': sql = `${e}::text ilike ${P(val.replace(/\*/g, '%'), 'text')}`; break;
      case 'is': {
        const v = val.toLowerCase();
        if (!['null', 'true', 'false', 'unknown', 'not_null'].includes(v)) throw new HttpErr(400, { code: 'PGRST100', message: `failed to parse filter (is.${val})`, details: null, hint: null });
        sql = v === 'not_null' ? `${e} is not null` : `${e} is ${v}`; break;
      }
      case 'in': {
        const items = parseList(val);
        if (items.length === 0) { sql = 'false'; break; }
        sql = `${e} in (${items.map((x) => P(x)).join(', ')})`; break;
      }
      case 'cs': sql = `${e} @> ${P(val)}`; break;
      case 'cd': sql = `${e} <@ ${P(val)}`; break;
      case 'ov': sql = `${e} && ${P(val)}`; break;
      default: throw new HttpErr(400, { code: 'PGRST100', message: `mock: ตัวกรอง "${op}" ไม่รองรับ`, details: null, hint: null });
    }
    void jsonPath;
    return negate ? `not (${sql})` : sql;
  }
  // or=(a.eq.1,b.ilike.*x*,and(c.gt.1,d.lt.2))
  async function logicSql(table, alias, kind, body, params) {
    const inner = body.replace(/^\(/, '').replace(/\)$/, '');
    const parts = splitTop(inner);
    const out = [];
    for (const p of parts) {
      const lm = /^(not\.)?(and|or)\((.*)\)$/.exec(p);
      if (lm) { const s = await logicSql(table, alias, lm[2], `(${lm[3]})`, params); out.push(lm[1] ? `not ${s}` : s); continue; }
      const dot = p.indexOf('.');
      out.push(await condSql(table, alias, p.slice(0, dot), p.slice(dot + 1), params));
    }
    return '(' + (out.length ? out.join(kind === 'or' ? ' or ' : ' and ') : 'true') + ')';
  }
  async function filtersSql(table, alias, filters, params) {
    const out = [];
    for (const [k, v] of filters) {
      if (k === 'or' || k === 'and') out.push(await logicSql(table, alias, k, v, params));
      else if (k === 'not.or' || k === 'not.and') out.push(`not ${await logicSql(table, alias, k.slice(4), v, params)}`);
      else out.push(await condSql(table, alias, k, v, params));
    }
    return out.length ? out.join(' and ') : 'true';
  }
  async function orderSql(table, alias, spec) {
    const cols = await tableCols(table);
    const parts = spec.split(',').filter(Boolean).map((p) => {
      const [c, ...mods] = p.split('.');
      if (!cols.has(c)) throw new HttpErr(400, { code: '42703', message: `column ${table}.${c} does not exist`, details: null, hint: null });
      const dir = mods.includes('desc') ? 'desc' : 'asc';
      const nulls = mods.includes('nullsfirst') ? ' nulls first' : mods.includes('nullslast') ? ' nulls last' : '';
      return `${alias}.${qi(c)} ${dir}${nulls}`;
    });
    return parts.length ? ` order by ${parts.join(', ')}` : '';
  }

  const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
  function splitParams(url) {
    const top = []; const embed = new Map(); let order = null; let limit = null; let offset = null;
    for (const [k, v] of url.searchParams) {
      // embed.order / embed.limit / embed.col=filter
      const dot = k.indexOf('.');
      if (dot > 0 && !['not.or', 'not.and'].includes(k) && !/->/.test(k)) {
        const rel = k.slice(0, dot); const rest = k.slice(dot + 1);
        const eo = embed.get(rel) || { filters: [] };
        if (rest === 'order') eo.order = v; else if (rest === 'limit') eo.limit = v; else if (rest === 'offset') eo.offset = v; else eo.filters.push([rest, v]);
        embed.set(rel, eo); continue;
      }
      if (k === 'order') order = v; else if (k === 'limit') limit = v; else if (k === 'offset') offset = v;
      else if (!RESERVED.has(k)) top.push([k, v]);
    }
    return { top, embed, order, limit, offset };
  }

  async function handleTable(req, res, url, body, rawBody) {
    const table = decodeURIComponent(url.pathname.replace(/^\/rest\/v1\//, ''));
    const auth = authOf(req);
    const prefer = String(req.headers.prefer || '');
    const accept = String(req.headers.accept || '');
    const single = accept.includes('application/vnd.pgrst.object+json');
    const wantCount = /count=(exact|planned|estimated)/.test(prefer);
    const { top, embed, order, limit, offset } = splitParams(url);
    const selectSpec = url.searchParams.get('select');

    if (req.method === 'GET' || req.method === 'HEAD') {
      const out = await tx(auth, async () => {
        const params = [];
        const items = parseSelect(selectSpec || '*');
        embed.__parentConds = [];
        const expr = await rowExpr(table, 't0', items, embed, params);
        let where = await filtersSql(table, 't0', top, params);
        if (embed.__parentConds.length) where += ' and ' + embed.__parentConds.join(' and ');
        const ord = order ? await orderSql(table, 't0', order) : '';
        const lim = limit != null ? ` limit ${Number(limit)}` : '';
        const off = offset != null ? ` offset ${Number(offset)}` : '';
        const rows = (await db.query(`select ${expr} as j from public.${qi(table)} t0 where ${where}${ord}${lim}${off}`, params)).rows.map((r) => r.j);
        let total = null;
        if (wantCount) total = Number((await db.query(`select count(*)::int as n from public.${qi(table)} t0 where ${where}`, params)).rows[0].n);
        return { rows, total };
      });
      const start = Number(offset || 0);
      const range = out.rows.length ? `${start}-${start + out.rows.length - 1}` : '*';
      const headers = { 'content-range': `${range}/${out.total ?? '*'}` };
      if (single) {
        if (out.rows.length !== 1) return send(res, 406, { code: 'PGRST116', details: `The result contains ${out.rows.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' });
        return send(res, 200, out.rows[0], headers, req.method === 'HEAD');
      }
      return send(res, 200, out.rows, headers, req.method === 'HEAD');
    }

    const returnRep = /return=representation/.test(prefer);
    const cols = await asOwner(() => tableCols(table));
    const project = (row) => {
      if (!selectSpec || selectSpec === '*') return row;
      const items = parseSelect(selectSpec).filter((x) => x.kind === 'col');
      const o = {};
      for (const it of items) o[it.alias] = row[it.col];
      return o;
    };

    if (req.method === 'POST') {
      const rows = Array.isArray(body) ? body : [body];
      const keysParam = url.searchParams.get('columns');
      const keys = keysParam ? keysParam.split(',').map((s) => s.replace(/"/g, '').trim()) : Object.keys(rows[0] || {});
      for (const k of keys) if (!cols.has(k)) throw new HttpErr(400, { code: 'PGRST204', message: `Could not find the '${k}' column of '${table}' in the schema cache`, details: null, hint: null });
      const onConflict = url.searchParams.get('on_conflict');
      const merge = /resolution=merge-duplicates/.test(prefer);
      const ignore = /resolution=ignore-duplicates/.test(prefer);
      const out = await tx(auth, async () => {
        const kl = keys.map(qi).join(', ');
        let sql = `insert into public.${qi(table)} as t0 (${kl}) select ${kl} from jsonb_populate_recordset(null::public.${qi(table)}, $1::jsonb)`;
        if (merge || ignore) {
          let target = onConflict;
          if (!target) {
            const pk = await db.query(`select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
                                        where i.indrelid = ('public.' || quote_ident($1))::regclass and i.indisprimary`, [table]);
            target = pk.rows.map((r) => r.attname).join(',');
          }
          const tcols = target.split(',').map((s) => s.trim());
          sql += ` on conflict (${tcols.map(qi).join(', ')}) do ` + (ignore ? 'nothing' : `update set ${keys.filter((k) => !tcols.includes(k)).map((k) => `${qi(k)} = excluded.${qi(k)}`).join(', ') || `${qi(tcols[0])} = excluded.${qi(tcols[0])}`}`);
        }
        sql += returnRep ? ' returning to_jsonb(t0) as j' : '';
        const r = await db.query(sql, [JSON.stringify(rows)]);
        return r.rows.map((x) => x.j);
      });
      if (!returnRep) { res.writeHead(201, { ...cors(req), 'content-range': '*/*' }); return res.end(); }
      const data = out.map(project);
      if (single) return send(res, 201, data[0] ?? null);
      return send(res, 201, data);
    }
    if (req.method === 'PATCH') {
      const keys = Object.keys(body || {});
      for (const k of keys) if (!cols.has(k)) throw new HttpErr(400, { code: 'PGRST204', message: `Could not find the '${k}' column of '${table}' in the schema cache`, details: null, hint: null });
      const out = await tx(auth, async () => {
        const params = [JSON.stringify(body)];
        const where = await filtersSql(table, 't0', top, params);
        const sets = keys.map((k) => `${qi(k)} = (jsonb_populate_record(null::public.${qi(table)}, $1::jsonb)).${qi(k)}`).join(', ');
        const r = await db.query(`update public.${qi(table)} as t0 set ${sets} where ${where}${returnRep ? ' returning to_jsonb(t0) as j' : ''}`, params);
        return r.rows.map((x) => x.j);
      });
      if (!returnRep) { res.writeHead(204, cors(req)); return res.end(); }
      const data = out.map(project);
      if (single) return send(res, 200, data[0] ?? null);
      return send(res, 200, data);
    }
    if (req.method === 'DELETE') {
      const out = await tx(auth, async () => {
        const params = [];
        const where = await filtersSql(table, 't0', top, params);
        const r = await db.query(`delete from public.${qi(table)} as t0 where ${where}${returnRep ? ' returning to_jsonb(t0) as j' : ''}`, params);
        return r.rows.map((x) => x.j);
      });
      if (!returnRep) { res.writeHead(204, cors(req)); return res.end(); }
      return send(res, 200, out.map(project));
    }
    void rawBody;
    return send(res, 405, { message: 'method not allowed' });
  }

  // ---------- Storage ----------
  function parseMultipart(buf, ctype) {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype || '');
    if (!m) return null;
    const boundary = Buffer.from('--' + (m[1] || m[2]));
    const parts = [];
    let pos = buf.indexOf(boundary);
    while (pos >= 0) {
      const next = buf.indexOf(boundary, pos + boundary.length);
      if (next < 0) break;
      const part = buf.subarray(pos + boundary.length + 2, next - 2);
      const sep = part.indexOf('\r\n\r\n');
      if (sep >= 0) {
        const head = part.subarray(0, sep).toString('utf8');
        const data = part.subarray(sep + 4);
        const name = /name="([^"]*)"/i.exec(head)?.[1] ?? '';
        const filename = /filename="([^"]*)"/i.exec(head)?.[1];
        const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim();
        parts.push({ name, filename, type, data });
      }
      pos = next;
    }
    return parts;
  }
  const storageErr = (res, req, status, code, message) => send(res, status, { statusCode: String(code), error: code === 404 ? 'not_found' : code === 413 ? 'Payload too large' : 'Unauthorized', message });

  async function handleStorage(req, res, url, rawBody) {
    const auth = authOf(req);
    const p = decodeURIComponent(url.pathname.replace(/^\/storage\/v1/, ''));
    let m;
    // GET public
    if ((m = /^\/object\/public\/([^/]+)\/(.+)$/.exec(p)) && (req.method === 'GET' || req.method === 'HEAD')) {
      const [, bucket, name] = m;
      const b = await asOwner(async () => (await db.query(`select public from storage.buckets where id = $1`, [bucket])).rows[0]);
      const f = files.get(`${bucket}/${name}`);
      if (!b || !b.public || !f) return storageErr(res, req, 400, 404, 'Object not found');
      res.writeHead(200, { ...cors(req), 'content-type': f.type, 'cache-control': 'no-cache' });
      return res.end(req.method === 'HEAD' ? undefined : f.bytes);
    }
    // GET signed
    if ((m = /^\/object\/sign\/([^/]+)\/(.+)$/.exec(p)) && req.method === 'GET') {
      const key = signTokens.get(url.searchParams.get('token'));
      const f = key && files.get(key);
      if (!f || key !== `${m[1]}/${m[2]}`) return storageErr(res, req, 400, 400, 'invalid signature');
      res.writeHead(200, { ...cors(req), 'content-type': f.type });
      return res.end(f.bytes);
    }
    // POST sign (หลายไฟล์)
    if ((m = /^\/object\/sign\/([^/]+)$/.exec(p)) && req.method === 'POST') {
      const bucket = m[1];
      const body = JSON.parse(rawBody.toString('utf8') || '{}');
      const visible = await tx(auth, async () => (await db.query(`select name from storage.objects where bucket_id = $1 and name = any($2::text[])`, [bucket, '{' + (body.paths || []).map((x) => '"' + x + '"').join(',') + '}'])).rows.map((r) => r.name));
      return send(res, 200, (body.paths || []).map((x) => {
        if (!visible.includes(x) || !files.has(`${bucket}/${x}`)) return { error: 'Either the object does not exist or you do not have access to it', path: x, signedURL: null };
        const tok = randomBytes(10).toString('hex'); signTokens.set(tok, `${bucket}/${x}`);
        return { error: null, path: x, signedURL: `/object/sign/${bucket}/${x}?token=${tok}` };
      }));
    }
    // POST sign เดี่ยว
    if ((m = /^\/object\/sign\/([^/]+)\/(.+)$/.exec(p)) && req.method === 'POST') {
      const [, bucket, name] = m;
      const ok = await tx(auth, async () => (await db.query(`select 1 from storage.objects where bucket_id = $1 and name = $2`, [bucket, name])).rows.length > 0);
      if (!ok || !files.has(`${bucket}/${name}`)) return storageErr(res, req, 400, 404, 'Object not found');
      const tok = randomBytes(10).toString('hex'); signTokens.set(tok, `${bucket}/${name}`);
      return send(res, 200, { signedURL: `/object/sign/${bucket}/${name}?token=${tok}` });
    }
    // GET authenticated
    if ((m = /^\/object\/(?:authenticated\/)?([^/]+)\/(.+)$/.exec(p)) && req.method === 'GET') {
      const [, bucket, name] = m;
      const ok = await tx(auth, async () => (await db.query(`select 1 from storage.objects where bucket_id = $1 and name = $2`, [bucket, name])).rows.length > 0);
      const f = files.get(`${bucket}/${name}`);
      if (!ok || !f) return storageErr(res, req, 400, 404, 'Object not found');
      res.writeHead(200, { ...cors(req), 'content-type': f.type });
      return res.end(f.bytes);
    }
    // upload / update
    if ((m = /^\/object\/([^/]+)\/(.+)$/.exec(p)) && (req.method === 'POST' || req.method === 'PUT')) {
      const [, bucket, name] = m;
      let bytes = rawBody; let type = req.headers['content-type'] || 'application/octet-stream';
      if (/multipart\/form-data/i.test(type)) {
        const parts = parseMultipart(rawBody, type) || [];
        const filePart = parts.find((x) => x.filename !== undefined) || parts.find((x) => x.name === '');
        if (!filePart) return storageErr(res, req, 400, 400, 'mock: ไม่พบไฟล์ใน multipart');
        bytes = filePart.data; type = filePart.type || 'application/octet-stream';
      }
      const b = await asOwner(async () => (await db.query(`select file_size_limit, allowed_mime_types from storage.buckets where id = $1`, [bucket])).rows[0]);
      if (!b) return storageErr(res, req, 400, 404, 'Bucket not found');
      if (b.file_size_limit && bytes.length > Number(b.file_size_limit)) return storageErr(res, req, 413, 413, 'The object exceeded the maximum allowed size');
      const mimes = pgArr(b.allowed_mime_types);
      if (mimes.length && !mimes.some((x) => x === type || (x.endsWith('/*') && type.startsWith(x.slice(0, -1))))) return storageErr(res, req, 415, 415, `mime type ${type} is not supported`);
      const upsert = req.method === 'PUT' || String(req.headers['x-upsert']) === 'true';
      try {
        await tx(auth, async () => {
          const ex = files.has(`${bucket}/${name}`);
          if (ex && !upsert) throw Object.assign(new Error('The resource already exists'), { code: 'dup' });
          if (ex) await db.query(`update storage.objects set metadata = $3::jsonb, owner = $4 where bucket_id = $1 and name = $2`, [bucket, name, JSON.stringify({ size: bytes.length, mimetype: type }), auth.uid]);
          else await db.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4::jsonb)`, [bucket, name, auth.uid, JSON.stringify({ size: bytes.length, mimetype: type })]);
        });
      } catch (e) {
        if (e.code === 'dup') return storageErr(res, req, 400, 409, 'The resource already exists');
        return storageErr(res, req, 400, 403, 'new row violates row-level security policy');
      }
      files.set(`${bucket}/${name}`, { bytes: Buffer.from(bytes), type });
      return send(res, 200, { Key: `${bucket}/${name}`, Id: randomUUID() });
    }
    // remove
    if ((m = /^\/object\/([^/]+)$/.exec(p)) && req.method === 'DELETE') {
      const bucket = m[1];
      const body = JSON.parse(rawBody.toString('utf8') || '{}');
      const prefixes = body.prefixes || [];
      const del = await tx(auth, async () => (await db.query(`delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name`, [bucket, '{' + prefixes.map((x) => '"' + x + '"').join(',') + '}'])).rows.map((r) => r.name));
      for (const n of del) files.delete(`${bucket}/${n}`);
      return send(res, 200, del.map((n) => ({ name: n, bucket_id: bucket })));
    }
    return storageErr(res, req, 400, 404, `mock: ไม่รองรับ ${req.method} ${p}`);
  }

  // ---------- HTTP ----------
  function cors(req) {
    return {
      'access-control-allow-origin': req.headers.origin || '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
      'access-control-allow-headers': req.headers['access-control-request-headers'] || 'authorization,apikey,content-type,prefer,accept,x-client-info,x-upsert,range,accept-profile,content-profile',
      'access-control-expose-headers': 'content-range,x-total-count,content-profile,link',
      'access-control-max-age': '600',
    };
  }
  function send(res, status, data, headers = {}, head = false) {
    const req = res.req;
    const body = data === undefined ? '' : JSON.stringify(data);
    res.writeHead(status, { ...cors(req), 'content-type': 'application/json; charset=utf-8', ...headers });
    res.end(head ? undefined : body);
  }

  const server = http.createServer(async (req, res) => {
    stats.requests++;
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const rawBody = Buffer.concat(chunks);
    const url = new URL(req.url, `http://${host}:${port}`);
    if (req.method === 'OPTIONS') { res.writeHead(204, cors(req)); return res.end(); }
    let body = null;
    if (rawBody.length && /json/i.test(req.headers['content-type'] || '')) {
      try { body = JSON.parse(rawBody.toString('utf8')); } catch { return send(res, 400, { code: 'PGRST102', message: 'Empty or invalid json', details: null, hint: null }); }
    }
    const t0 = Date.now();
    try {
      if (url.pathname.startsWith('/auth/v1/')) await handleAuth(req, res, url, body);
      else if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const fn = decodeURIComponent(url.pathname.slice('/rest/v1/rpc/'.length));
        let args = body || {};
        if (req.method === 'GET' || req.method === 'HEAD') { args = {}; for (const [k, v] of url.searchParams) if (!RESERVED.has(k)) args[k] = v; }
        const out = await callRpc(authOf(req), fn, args, { limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset') });
        if (out === undefined) { res.writeHead(204, cors(req)); res.end(); } else send(res, 200, out);
      } else if (url.pathname.startsWith('/rest/v1/')) await handleTable(req, res, url, body, rawBody);
      else if (url.pathname.startsWith('/storage/v1/')) await handleStorage(req, res, url, rawBody);
      else if (url.pathname === '/__qa/health') send(res, 200, { ok: true, requests: stats.requests });
      else if (url.pathname === '/__qa/errors') send(res, 200, stats.errors);
      else send(res, 404, { message: 'mock: ไม่รู้จัก path นี้' });
    } catch (e) {
      const auth = authOf(req);
      const status = e instanceof HttpErr ? e.status : pgErrStatus(e.code, auth.role);
      const b = e instanceof HttpErr ? e.body : pgErrBody(e);
      stats.errors.push({ at: new Date().toISOString(), method: req.method, path: url.pathname + url.search, role: auth.role, status, ...b });
      if (stats.errors.length > 500) stats.errors.shift();
      if (!res.headersSent) send(res, status, b);
    }
    if (log) console.log(`${req.method} ${url.pathname}${url.search.slice(0, 120)} ${res.statusCode} ${Date.now() - t0}ms`);
  });
  await new Promise((r) => server.listen(port, host, r));
  return {
    url: `http://${host}:${port}`, ctx, db, stats, createUser, callRpc,
    asOwnerQuery: (sql, params) => asOwner(async () => (await db.query(sql, params)).rows),
    putFile: (bucket, name, bytes, type) => files.set(`${bucket}/${name}`, { bytes, type }),
    close: async () => { await new Promise((r) => server.close(r)); server.closeAllConnections?.(); await db.close(); },
  };
}

// ---------- CLI ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const port = Number(args[args.indexOf('--port') + 1]) || 54321;
  const m = await startMock({ port, log: args.includes('--log') });
  if (args.includes('--seed')) {
    const { seedAll } = await import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'seed.mjs')).href);
    const info = await seedAll(m);
    console.log('seed:', JSON.stringify(info.summary));
  }
  console.log(`mock supabase พร้อมที่ ${m.url} (anon key: ${ANON_KEY})`);
  const stop = async () => { await m.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
