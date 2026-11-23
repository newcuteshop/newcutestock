// =========================================================================
// tools/qa/wedding-tour.mjs — เดินทุกหน้าของร้าน b.oncloud ที่ 2 ขนาดจอ (375×812 / 1440×900) ผ่าน qa-shell
//   ถ่ายภาพเต็มหน้า + ตรวจ (ล้นจอแนวนอน, ตัวอักษรไทยถูกตัด, สีของร้านอื่นใน DOM/ในภาพ, console error, HTTP ≥ 400, error ฝั่ง mock)
//
//   node qa-shell.mjs --app <repo>:3485 --out <out>     (อีกหน้าต่าง)
//   node wedding-tour.mjs [--only คำ] [--prefix tour]    → <out>/<prefix>-<d|m>-<ชื่อ>.png + <out>/<prefix>-report.json
// =========================================================================
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const CTL = `http://127.0.0.1:${opt('--ctl', 3499)}`;
const ONLY = opt('--only', '');
const PREFIX = opt('--prefix', 'tour');

export async function q(cmd) {
  const r = await fetch(CTL, { method: 'POST', body: JSON.stringify(cmd) });
  const j = await r.json();
  if (!j.ok) throw new Error(`${cmd.op}: ${j.error}`);
  return j.out;
}

const seed = await q({ op: 'seed' });
const id = seed.ids;
const ROUTES = [
  ['dashboard', '/wedding'], ['calendar', '/wedding/calendar'], ['calendar-inq', '/wedding/calendar?inquiries=1'],
  ['bookings', '/wedding/bookings'], ['bookings-new', '/wedding/bookings/new'], ['bookings-new-date', `/wedding/bookings/new?date=${seed.capDay}`],
  ['booking-capA', `/wedding/bookings/${id.capA}`], ['booking-multi', `/wedding/bookings/${id.multi}`], ['booking-prod', `/wedding/bookings/${id.prod}`],
  ['booking-hold', `/wedding/bookings/${id.hold}`], ['booking-inquiry', `/wedding/bookings/${id.inquiry}`], ['booking-done', `/wedding/bookings/${id.done}`],
  ['booking-postp', `/wedding/bookings/${id.postp}`], ['booking-canc', `/wedding/bookings/${id.canc}`], ['booking-deliv', `/wedding/bookings/${id.deliv}`],
  ['booking-edit', `/wedding/bookings/${id.capA}/edit`], ['booking-404', '/wedding/bookings/00000000-0000-4000-8000-000000000000'],
  ['deliverables', '/wedding/deliverables'], ['deliverables-overdue', '/wedding/deliverables?status=overdue'],
  ['customers', '/wedding/customers'], ['customer', `/wedding/customers/${seed.customers[0]}`], ['customer-new', '/wedding/customers/new'],
  ['crew', '/wedding/crew'], ['payments', '/wedding/payments'], ['reports', '/wedding/reports'], ['settings', '/wedding/settings'], ['packages', '/wedding/packages'],
  ['portal-capA', `/wedding-status/${seed.tokens.capA}`], ['portal-multi', `/wedding-status/${seed.tokens.multi}`], ['portal-deliv', `/wedding-status/${seed.tokens.deliv}`],
  ['portal-canc', `/wedding-status/${seed.tokens.canc}`], ['portal-notfound', `/wedding-status/${'0'.repeat(64)}`], ['portal-bad', '/wedding-status/abc'], ['portal-root', '/wedding-status'],
].filter(([n]) => !ONLY || n.includes(ONLY));

const VIEWS = [{ name: 'd', w: 1440, h: 900, mobile: false }, { name: 'm', w: 375, h: 812, mobile: true }];
const report = [];
for (const v of VIEWS) {
  await q({ op: 'page', name: `tour-${v.name}`, w: v.w, h: v.h, mobile: v.mobile });
  for (const [name, url] of ROUTES) {
    await q({ op: 'issues', clear: true });
    await q({ op: 'mockErrors', clear: true });
    const href = await q({ op: 'goto', url });
    await q({ op: 'eval', js: 'new Promise((r) => setTimeout(r, 700))' });
    const shot = await q({ op: 'shot', name: `${PREFIX}-${v.name}-${name}` });
    const chk = await q({ op: 'check' });
    const issues = await q({ op: 'issues', clear: true });
    const mockErr = await q({ op: 'mockErrors', clear: true });
    const row = {
      view: v.name, name, url, landed: href.replace(/^https?:\/\/[^/]+/, ''), shop: chk.shop, file: shot.file, foreignPixels: shot.foreignPixels,
      overflowX: chk.overflowX, wide: chk.wide, clipped: chk.clipped, foreignColors: chk.foreignColors, smallTargets: chk.smallTargets.length,
      issues: issues.map((i) => `${i.kind}: ${i.text}`), mockErrors: mockErr.map((e) => `${e.status} ${e.method} ${e.path.slice(0, 120)} ${e.code}: ${e.message}`),
    };
    report.push(row);
    const flags = [row.overflowX > 0 && `ล้น ${row.overflowX}px`, row.wide.length && `กว้างเกิน ${row.wide.length}`, row.clipped.length && `ตัดตัวอักษร ${row.clipped.length}`,
      row.foreignColors.length && `สีร้านอื่น ${row.foreignColors.length}`, Object.keys(row.foreignPixels).length && 'พิกเซลสีร้านอื่น', row.issues.length && `console/http ${row.issues.length}`,
      row.mockErrors.length && `mock ${row.mockErrors.length}`, row.shop !== 'wedding' && `shop=${row.shop}`].filter(Boolean);
    console.log(`${v.name} ${name.padEnd(22)} ${row.landed.slice(0, 50).padEnd(50)} ${flags.join(', ') || 'ok'}`);
  }
}
const out = path.join(path.dirname((await q({ op: 'shot', name: `${PREFIX}-last` })).file), `${PREFIX}-report.json`);
writeFileSync(out, JSON.stringify(report, null, 1));
console.log('รายงาน:', out);
