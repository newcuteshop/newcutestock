// =========================================================================
// tools/qa/qa-shell.mjs — เปิดชุด QA ค้างไว้แล้วสั่งงานทีละคำสั่งผ่าน HTTP (สำรวจหน้า/กดปุ่ม/ถ่ายภาพ แบบโต้ตอบ)
//
//   node qa-shell.mjs [--app <dir>:<port>]... [--mock 54321] [--ctl 3499] [--out <โฟลเดอร์ภาพ>]
//     (ต้อง build แอปก่อน: node app-server.mjs build <dir>) ; ไม่ใส่ --app = ใช้ repo ที่พอร์ต 3485
//   แล้วส่งคำสั่ง:  curl -s localhost:3499 -d '{"op":"goto","url":"/wedding"}'
//
// คำสั่ง (JSON):
//   {op:'page', name, w, h, mobile}          สร้าง/เลือกแท็บ (แต่ละแท็บเข้าสู่ระบบด้วย boss อัตโนมัติ, user:'wstaff' เลือกผู้ใช้)
//   {op:'login', user}                        เข้าสู่ระบบผ่านหน้า /login จริง (ชื่อผู้ใช้ = รหัสผ่าน; ดู seed.mjs)
//   {op:'goto', url, base?}                   url ขึ้นต้น '/' = ต่อท้าย base ของแอปแรก (หรือ base ที่ระบุ)
//   {op:'click', target} {op:'fill', target, value} {op:'set', target, value} {op:'key', key}
//       target = 'css' | {text:'ข้อความปุ่ม', within?:'css', exact?:false} | {label:'aria-label'}
//   {op:'eval', js}   {op:'wait', js, timeout}   {op:'idle'}   {op:'media', media:'print'|''}
//   {op:'upload', selector, file}             ใส่ไฟล์ลง <input type=file>
//   {op:'shot', name, full?}                  ภาพหน้าจอ → <out>/<name>.png (+ ตรวจสีร้านอื่นในภาพ)
//   {op:'check'}                              ตรวจล้นจอ / ตัวอักษรถูกตัด / สีร้านอื่น / dialog (checks.mjs)
//   {op:'issues', clear?}                     console error / exception / HTTP ≥ 400 ที่เก็บได้
//   {op:'mockErrors', clear?}                 error ฝั่ง mock (SQL/สิทธิ์/ไม่พบฟังก์ชัน)
//   {op:'downloads'} {op:'waitDownload', from}  ไฟล์ที่ดาวน์โหลด (อยู่ใน <out>/downloads)
//   {op:'rpc', user, fn, args}  {op:'sql', sql, params}   เรียกฐานข้อมูลตรง (ตรวจผล)
//   {op:'seed'}                               ข้อมูล seed (ผู้ใช้/งาน/โทเคน)
//   {op:'quit'}
// =========================================================================
import http from 'node:http';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-supabase.mjs';
import { seedAll } from './seed.mjs';
import { startApp, REPO } from './app-server.mjs';
import { launchChrome } from './cdp.mjs';
import { pageChecks, foreignPalette, pixelScan } from './checks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const apps = argv.flatMap((a, i) => (a === '--app' ? [argv[i + 1]] : [])).map((s) => { const at = s.lastIndexOf(':'); return { dir: path.resolve(s.slice(0, at)), port: Number(s.slice(at + 1)) }; });
if (apps.length === 0) apps.push({ dir: REPO, port: 3485 });
const OUT = path.resolve(opt('--out', path.join(HERE, 'out')));
const MOCK_PORT = Number(opt('--mock', 54321));
const CTL = Number(opt('--ctl', 3499));
mkdirSync(OUT, { recursive: true });

export async function bootQa({ apps, mockPort = MOCK_PORT, out = OUT, chromeDir = path.join(out, 'chrome-profile') }) {
  const mock = await startMock({ port: mockPort });
  const seed = await seedAll(mock);
  const servers = apps.map((a) => ({ ...a, ...startApp(a.dir, a.port, { mockUrl: mock.url }) }));
  await Promise.all(servers.map((s) => s.ready));
  const browser = await launchChrome({ userDataDir: chromeDir, downloadDir: path.join(out, 'downloads') });
  return { mock, seed, servers, browser, out };
}

const FOREIGN = foreignPalette();
const KEY_FOREIGN = Object.keys(FOREIGN).filter((k) => /brand-(300|400|500|600|700)/.test(FOREIGN[k]));

export async function login(page, base, user = 'boss') {
  // หน้า /login ออกจากระบบเดิมก่อน + hydrate ช้ากว่าโหลดเสร็จ → รอแล้วตรวจค่าที่พิมพ์ ลองซ้ำได้ 3 ครั้ง
  for (let i = 0; i < 3; i++) {
    await page.goto(`${base}/login`);
    await page.waitFor(`!!document.querySelector('#login-username')`, 20000);
    await new Promise((r) => setTimeout(r, 1200 + i * 1000));
    await page.fill('#login-username', user);
    await page.fill('#login-password', user);
    const ok = await page.eval(`document.querySelector('#login-username').value === ${JSON.stringify(user)} && document.querySelector('#login-password').value === ${JSON.stringify(user)}`);
    if (!ok) continue;
    await page.click('button[type=submit]');
    if (await page.waitFor(`location.pathname !== '/login'`, 20000)) { await page.idle(); return true; }
  }
  return false;
}

/** แท็บเพิ่ม: ใช้คุกกี้ session เดิม + ตั้งธง "เข้าสู่ระบบในหน้าต่างนี้แล้ว" ก่อนโหลดทุกหน้า (ไม่ผ่าน /login ซึ่งออกจากระบบทุกแท็บ) */
export async function enterWithoutLogin(page) {
  await page.addInitScript(`try { if (location.pathname !== '/login') sessionStorage.setItem('newcute-entered', '1'); } catch (e) {}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const qa = await bootQa({ apps });
  const base = `http://127.0.0.1:${apps[0].port}`;
  const pages = new Map();
  let cur = null;
  const c_user_forced = (u) => u !== 'boss';
  const getPage = async (name, view, user = 'boss') => {
    if (!pages.has(name)) {
      const p = await qa.browser.newPage(view);
      p.name = name;
      if (pages.size === 0 || c_user_forced(user)) await login(p, base, user); else await enterWithoutLogin(p);
      pages.set(name, p);
    }
    cur = pages.get(name);
    return cur;
  };
  await getPage('desktop', { width: 1440, height: 900 });
  const handlers = {
    async page(c) { const p = await getPage(c.name, { width: c.w ?? 1440, height: c.h ?? 900, mobile: !!c.mobile, dpr: c.dpr ?? 1 }, c.user); return { name: p.name, view: p.view }; },
    async login(c) { return login(cur, base, c.user || 'boss'); },
    async goto(c) { const u = c.url.startsWith('/') ? (c.base || base) + c.url : c.url; await cur.goto(u); return cur.eval('location.href'); },
    async click(c) { await cur.click(c.target); await cur.idle({ quiet: c.quiet ?? 400 }); return true; },
    async fill(c) { await cur.fill(c.target, c.value); return true; },
    async set(c) { await cur.setValue(c.target, c.value); return true; },
    async key(c) { await cur.key(c.key); return true; },
    async eval(c) { return cur.eval(c.js); },
    async wait(c) { return cur.waitFor(c.js, c.timeout ?? 15000); },
    async idle() { return cur.idle(); },
    async media(c) { await cur.emulateMedia(c.media); return true; },
    async upload(c) { await cur.uploadFile(c.selector, c.file); return true; },
    async shot(c) { const f = path.join(qa.out, `${c.name}.png`); await cur.screenshot(f, { fullPage: c.full !== false }); return { file: f, foreignPixels: pixelScan(f, KEY_FOREIGN) }; },
    // checks.mjs โหลดใหม่ทุกครั้ง (แก้ตัวตรวจได้โดยไม่ต้องเปิดชุด QA ใหม่)
    async check() { const m = await import('./checks.mjs?t=' + Date.now()); return m.pageChecks(cur, { foreign: m.foreignPalette() }); },
    async issues(c) { const i = cur.issues.slice(); if (c.clear) cur.issues.length = 0; return i; },
    async mockErrors(c) { const e = qa.mock.stats.errors.slice(); if (c.clear) qa.mock.stats.errors.length = 0; return e; },
    async downloads() { return qa.browser.downloads; },
    async waitDownload(c) { return qa.browser.waitDownload(c.from ?? 0, c.timeout ?? 30000); },
    async rpc(c) { return qa.seed.users[c.user || 'boss'].rpc(c.fn, c.args || {}); },
    async sql(c) { return qa.mock.asOwnerQuery(c.sql, c.params || []); },
    async seed() { return { today: qa.seed.today, capDay: qa.seed.capDay, summary: qa.seed.summary, ids: Object.fromEntries(Object.entries(qa.seed.bookings).map(([k, b]) => [k, b.id])), tokens: qa.seed.tokens, customers: qa.seed.customers.map((x) => x.id), crew: qa.seed.crew.map((x) => x.id) }; },
    async log(c) { const s = qa.servers[c.i ?? 0]; return s.log().slice(-(c.n ?? 3000)); },
  };
  const srv = http.createServer(async (req, res) => {
    let body = ''; for await (const ch of req) body += ch;
    let c; try { c = JSON.parse(body || '{}'); } catch { c = {}; }
    if (c.op === 'quit') {
      res.end('{"ok":true}');
      await qa.browser.close(); for (const s of qa.servers) await s.stop(); await qa.mock.close(); srv.close(); process.exit(0);
    }
    try {
      const out = await (handlers[c.op] ? handlers[c.op](c) : Promise.reject(new Error('ไม่รู้จักคำสั่ง ' + c.op)));
      res.end(JSON.stringify({ ok: true, out }, null, 1));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: e.message })); }
  });
  srv.listen(CTL, '127.0.0.1', () => console.log(`qa-shell พร้อม: http://127.0.0.1:${CTL} (แอป ${apps.map((a) => a.port).join(', ')}, mock ${qa.mock.url})`));
}
