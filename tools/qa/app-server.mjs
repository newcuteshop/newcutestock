// =========================================================================
// tools/qa/app-server.mjs — build / start แอป Next ให้ชี้ไปที่ Supabase จำลอง (ไม่ใช้ค่าใน .env.local)
//
//   node app-server.mjs build <dir>            next build ใน <dir> (ค่า env ของ QA + ฟอนต์จำลอง)
//   node app-server.mjs start <dir> <port>     next start -H 127.0.0.1 -p <port> (Ctrl+C ปิด)
//   import { qaEnv, buildApp, startApp, verifyBuild } from './app-server.mjs'
//
// ทำไมต้องตั้ง env เองทุกครั้ง: next อ่าน .env.local (ค่าจริงของร้าน) — ค่าที่อยู่ใน process.env ก่อนแล้วชนะเสมอ
//   จึงต้องส่ง URL/คีย์ของ mock ไปทั้งตอน build (NEXT_PUBLIC_* ฝังลงโค้ดหน้าเว็บ) และตอน start (ฝั่งเซิร์ฟเวอร์)
//   verifyBuild() ตรวจว่าโค้ดหน้าเว็บที่ build แล้วชี้ไปที่ mock จริง (ไม่มีโดเมน supabase.co หลุดเข้าไป)
// TZ=UTC ตอน start = เหมือนเซิร์ฟเวอร์ Vercel (จับบั๊กที่คำนวณ "วันนี้" ด้วยเวลาเครื่องแทนเวลาไทย)
// =========================================================================
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANON_KEY, SERVICE_KEY } from './mock-supabase.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');
export const FONT_MOCK = path.join(HERE, 'font-mock.cjs');

export function qaEnv(mockUrl = 'http://127.0.0.1:54321', extra = {}) {
  return {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: mockUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    NEXT_FONT_GOOGLE_MOCKED_RESPONSES: FONT_MOCK,
    NEXT_TELEMETRY_DISABLED: '1',
    ...extra,
  };
}

function nextBin(dir) {
  const local = path.join(dir, 'node_modules', 'next', 'dist', 'bin', 'next');
  return existsSync(local) ? local : path.join(REPO, 'node_modules', 'next', 'dist', 'bin', 'next');
}

function run(cmd, args, opts, logFile) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => (code === 0 ? resolve(out) : reject(Object.assign(new Error(`${cmd} ${args.join(' ')} exit ${code}`), { out }))));
    void logFile;
  });
}

export async function buildApp(dir, { mockUrl } = {}) {
  return run(process.execPath, [nextBin(dir), 'build'], { cwd: dir, env: qaEnv(mockUrl) });
}

/** ตรวจโค้ดหน้าเว็บที่ build แล้ว: ต้องมี URL ของ mock และไม่มีโดเมน Supabase จริง */
export function verifyBuild(dir, mockUrl = 'http://127.0.0.1:54321') {
  const root = path.join(dir, '.next', 'static', 'chunks');
  let hasMock = false; let hasReal = false;
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.js')) { const s = readFileSync(p, 'utf8'); if (s.includes(mockUrl)) hasMock = true; if (/[a-z0-9]{20}\.supabase\.co/.test(s)) hasReal = true; }
    }
  };
  walk(root);
  return { hasMock, hasReal };
}

export function startApp(dir, port, { mockUrl } = {}) {
  const p = spawn(process.execPath, [nextBin(dir), 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: dir, env: qaEnv(mockUrl, { TZ: 'UTC' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  // ตัวควบคุมพัง/ปิดกลางทาง → ปิด next ด้วย (ไม่ทิ้งพอร์ตค้าง)
  process.on('exit', () => { try { p.kill(); } catch {} });
  p.stdout.on('data', (d) => { log += d; });
  p.stderr.on('data', (d) => { log += d; });
  const ready = (async () => {
    for (let i = 0; i < 300; i++) {
      try { const r = await fetch(`http://127.0.0.1:${port}/login`); if (r.status < 500) return true; } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('next start ไม่ขึ้น: ' + log.slice(-2000));
  })();
  return { proc: p, ready, log: () => log, stop: () => new Promise((r) => { if (p.exitCode !== null) return r(); p.once('exit', r); p.kill(); setTimeout(r, 4000); }) };
}

export function removeNext(dir) { rmSync(path.join(dir, '.next'), { recursive: true, force: true }); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, dir = REPO, port = '3485'] = process.argv.slice(2);
  if (cmd === 'build') { const out = await buildApp(path.resolve(dir)); console.log(out.slice(-4000)); console.log(verifyBuild(path.resolve(dir))); }
  else if (cmd === 'start') { const s = startApp(path.resolve(dir), Number(port)); await s.ready; console.log(`พร้อมที่ http://127.0.0.1:${port}`); process.on('SIGINT', async () => { await s.stop(); process.exit(0); }); }
  else console.log('ใช้: node app-server.mjs build <dir> | start <dir> <port>');
}
