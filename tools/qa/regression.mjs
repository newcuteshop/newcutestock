// =========================================================================
// tools/qa/regression.mjs — เทียบภาพหน้าจอ "ก่อน/หลัง" แบบพิกเซลต่อพิกเซล (NEWCUTE + ร้านเช่าต้องเหมือนเดิมทุกพิกเซล)
//
// ขั้นตอน:
//   1) สร้างชุดก่อนแก้:  git archive HEAD | tar -x -C <base>  แล้ว junction/symlink <base>/node_modules → repo/node_modules
//   2) build ทั้งสองชุด:  node app-server.mjs build <repo>  และ  node app-server.mjs build <base>
//   3) เปิด qa-shell ด้วย 2 แอป: node qa-shell.mjs --app <repo>:3485 --app <base>:3486 --out <out>
//   4) node regression.mjs --cur 3485 --base 3486 --out <out>/reg      (ภาพ cur-*.png / base-*.png / diff-*.png + summary.json)
// ทั้งสองแอปใช้ mock + ข้อมูล seed เดียวกัน ถ่ายสลับกันทีละหน้าในเวลาไล่เลี่ยกัน (นาฬิกา/วันที่บนจอตรงกัน)
// =========================================================================
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { diffPng } from './checks.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const CTL = `http://127.0.0.1:${opt('--ctl', 3499)}`;
const CUR = `http://127.0.0.1:${opt('--cur', 3485)}`;
const BASE = `http://127.0.0.1:${opt('--base', 3486)}`;
const OUT = path.resolve(opt('--out', 'out/reg'));
mkdirSync(OUT, { recursive: true });

async function q(cmd) {
  const r = await fetch(CTL, { method: 'POST', body: JSON.stringify(cmd) });
  const j = await r.json();
  if (!j.ok) throw new Error(`${cmd.op}: ${j.error}`);
  return j.out;
}

export const ROUTES = [
  ['login', '/login'], ['dashboard', '/dashboard'], ['products', '/products'], ['sales', '/sales'], ['stock', '/stock'], ['users', '/users'],
  ['rental', '/rental'], ['rental-bookings', '/rental/bookings'], ['rental-calendar', '/rental/calendar'], ['book', '/book'],
  ['select', '/select'],
];

// ก่อนถ่าย: ซ่อนเคอร์เซอร์กะพริบในช่องที่โฟกัสอัตโนมัติ + จบแอนิเมชันที่ค้าง (ไม่ให้ภาพต่างเพราะจังหวะเวลา)
const STABILIZE = `(() => { if (!document.getElementById('qa-nocaret')) { const st = document.createElement('style'); st.id = 'qa-nocaret'; st.textContent = '*{caret-color:transparent!important}'; document.head.appendChild(st); } document.querySelectorAll('*').forEach((el) => { el.getAnimations?.().forEach((a) => { try { a.finish(); } catch {} }); }); return true; })()`;

async function capture(tag, base, route, view) {
  if (route === '/login') {
    // หน้า /login ออกจากระบบเอง → ใช้แท็บแยกที่ไม่ต้องเข้าสู่ระบบต่อ
    await q({ op: 'page', name: `reg-login-${view.name}`, w: view.w, h: view.h, mobile: view.mobile });
  } else {
    await q({ op: 'page', name: `reg-${view.name}`, w: view.w, h: view.h, mobile: view.mobile });
  }
  await q({ op: 'goto', url: route, base });
  await q({ op: 'eval', js: 'new Promise((r) => setTimeout(r, 900))' });
  await q({ op: 'eval', js: STABILIZE });
  const shot = await q({ op: 'shot', name: path.relative(path.resolve(opt('--shots', OUT + '/..')), path.join(OUT, `${tag}-${view.name}-${route.replace(/\W+/g, '_') || 'root'}`)).replace(/\\/g, '/') });
  return shot.file;
}

const VIEWS = [{ name: 'd', w: 1440, h: 900, mobile: false }, { name: 'm', w: 375, h: 812, mobile: true }];
const results = [];
for (const view of VIEWS) {
  for (const [name, route] of ROUTES) {
    if (route === '/login') continue; // ทำท้ายสุด (ออกจากระบบ)
    const a = await capture('base', BASE, route, view);
    const b = await capture('cur', CUR, route, view);
    const d = diffPng(a, b, path.join(OUT, `diff-${view.name}-${name}.png`));
    results.push({ view: view.name, name, route, ...d, base: a, cur: b });
    console.log(`${view.name} ${route.padEnd(18)} diff=${d.diff} ${d.sizeA} vs ${d.sizeB}`);
  }
  // ลิ้นชักเมนูมือถือ
  if (view.mobile) {
    for (const [name, route] of [['drawer-newcute', '/dashboard'], ['drawer-rental', '/rental']]) {
      const files = [];
      for (const [tag, base] of [['base', BASE], ['cur', CUR]]) {
        await q({ op: 'page', name: `reg-${view.name}`, w: view.w, h: view.h, mobile: true });
        await q({ op: 'goto', url: route, base });
        await q({ op: 'click', target: 'button[aria-label^="เปิดเมนู"]' });
        await q({ op: 'eval', js: 'new Promise((r) => setTimeout(r, 700))' });
        const s = await q({ op: 'shot', name: path.relative(path.resolve(OUT, '..'), path.join(OUT, `${tag}-m-${name}`)).replace(/\\/g, '/'), full: false });
        files.push(s.file);
      }
      const d = diffPng(files[0], files[1], path.join(OUT, `diff-m-${name}.png`));
      results.push({ view: 'm', name, route: route + ' (เมนู)', ...d, base: files[0], cur: files[1] });
      console.log(`m ${name.padEnd(18)} diff=${d.diff}`);
    }
  }
}
for (const view of VIEWS) {
  const a = await capture('base', BASE, '/login', view);
  const b = await capture('cur', CUR, '/login', view);
  const d = diffPng(a, b, path.join(OUT, `diff-${view.name}-login.png`));
  results.push({ view: view.name, name: 'login', route: '/login', ...d, base: a, cur: b });
  console.log(`${view.name} /login diff=${d.diff}`);
}
writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(results, null, 1));
const bad = results.filter((r) => r.diff > 0 && r.name !== 'select');
console.log(bad.length ? `ต่าง ${bad.length} หน้า (ไม่นับ /select)` : 'เหมือนเดิมทุกพิกเซล (ไม่นับ /select)');
process.exit(bad.length ? 1 : 0);
