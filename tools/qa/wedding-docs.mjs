// =========================================================================
// tools/qa/wedding-docs.mjs — เปิด "ส่งเอกสาร" (DocumentCenter) ในหน้างาน แล้วสั่งสร้างรูป PNG จริงในเบราว์เซอร์ทุกชนิดเอกสาร
//   (ปุ่ม "บันทึกรูป" → ไฟล์ดาวน์โหลด) + ภาพหน้าจอตัวอย่าง + พิมพ์ A4 / สัญญาจ้าง (จำลองสื่อพิมพ์)
//
//   node wedding-docs.mjs [--booking capA] [--view d|m]     (ต้องเปิด qa-shell ไว้)
//   ผล: <out>/docs/<booking>-<view>-<ชนิด>.png (รูปที่แอปสร้าง) + <out>/docs/<booking>-<view>-<ชนิด>-ui.png (ภาพหน้าจอ dialog)
// =========================================================================
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const CTL = `http://127.0.0.1:${opt('--ctl', 3499)}`;
const BK = opt('--booking', 'capA');
const VIEW = opt('--view', 'd');
async function q(cmd) {
  const r = await fetch(CTL, { method: 'POST', body: JSON.stringify(cmd) });
  const j = await r.json();
  if (!j.ok) throw new Error(`${cmd.op}: ${j.error}`);
  return j.out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const seed = await q({ op: 'seed' });
const v = VIEW === 'm' ? { w: 375, h: 812, mobile: true } : { w: 1440, h: 900, mobile: false };
await q({ op: 'page', name: `docs-${VIEW}`, ...v });
const firstShot = await q({ op: 'shot', name: 'docs/_probe', full: false });
const OUT = path.dirname(firstShot.file);
const DL = path.join(OUT, '..', 'downloads');
mkdirSync(OUT, { recursive: true });

await q({ op: 'goto', url: `/wedding/bookings/${seed.ids[BK]}` });
await q({ op: 'issues', clear: true });
const DLG = '[role=dialog][aria-modal=true]';
const ready = `(() => { const d = [...document.querySelectorAll('${DLG}')].pop(); if (!d) return false; const b = [...d.querySelectorAll('button')].find((x) => /บันทึกรูป/.test(x.textContent)); return !!b && !b.disabled; })()`;
const results = [];

async function exportPng(tag) {
  await q({ op: 'wait', js: ready, timeout: 40000 });
  await sleep(500);
  await q({ op: 'shot', name: `docs/${BK}-${VIEW}-${tag}-ui`, full: false });
  const from = (await q({ op: 'downloads' })).length;
  await q({ op: 'click', target: { text: 'บันทึกรูป', within: DLG } });
  const name = await q({ op: 'waitDownload', from, timeout: 60000 });
  const msg = await q({ op: 'eval', js: `(() => { const d = [...document.querySelectorAll('${DLG}')].pop(); const a = d && d.querySelector('[role=alert],[role=status]'); return a ? a.textContent.trim() : ''; })()` });
  let file = null;
  if (name) { file = path.join(OUT, `${BK}-${VIEW}-${tag}.png`); copyFileSync(path.join(DL, name), file); }
  results.push({ tag, download: name, file, message: msg });
  console.log(`${tag.padEnd(22)} ${name ? 'ได้รูป ' + file : 'ไม่ได้ไฟล์'} ${msg}`);
}

await q({ op: 'click', target: { text: 'ส่งเอกสาร', exact: true } });
await q({ op: 'wait', js: `!!document.querySelector('${DLG} [role=radiogroup]')`, timeout: 15000 });
for (const [kind, label] of [['confirmation', 'ใบยืนยันการจอง'], ['quote', 'ใบเสนอราคา'], ['payment_request', 'ใบแจ้งชำระเงิน'], ['receipt', 'ใบเสร็จรับเงิน'], ['schedule', 'ตารางคิววันงาน'], ['delivery', 'สรุปการส่งงาน']]) {
  const ok = await q({ op: 'eval', js: `(() => { const r = [...document.querySelectorAll('${DLG} [role=radio]')].find((x) => x.textContent.includes(${JSON.stringify(label)})); if (!r || r.disabled || r.getAttribute('aria-disabled') === 'true') return false; return true; })()` });
  if (!ok) { console.log(`${kind}: ปุ่มเลือกใช้ไม่ได้ในงานนี้`); results.push({ tag: kind, skipped: true }); continue; }
  await q({ op: 'click', target: { text: label, within: `${DLG} [role=radiogroup]`, tag: '[role=radio]', exact: false } });
  await exportPng(kind);
  if (kind === 'schedule') {
    await q({ op: 'click', target: { text: 'สำหรับทีมงาน', within: DLG, tag: 'button, label, [role=switch]', exact: false } });
    await exportPng('schedule-crew');
    await q({ op: 'click', target: { text: 'สำหรับทีมงาน', within: DLG, tag: 'button, label, [role=switch]', exact: false } });
  }
}
// พิมพ์ A4 + สัญญาจ้าง: กดแล้วจับ DOM ที่ PrintPortal ใส่ (body.printing) + จำลองสื่อพิมพ์
for (const [tag, label] of [['print-a4', 'พิมพ์ A4'], ['contract', 'สัญญาจ้าง A4']]) {
  await q({ op: 'eval', js: `(() => { window.__qaPrinted = 0; window.print = () => { window.__qaPrinted++; window.__qaPrintBody = document.body.className; }; return true; })()` });
  await q({ op: 'click', target: { text: label, within: DLG, exact: false } });
  await sleep(2500);
  const st = await q({ op: 'eval', js: `({ printed: window.__qaPrinted, bodyClass: window.__qaPrintBody || document.body.className, portal: !!document.getElementById('print-root'), textLen: (document.getElementById('print-root')?.innerText || '').length, heightPx: document.getElementById('print-root')?.scrollHeight || 0 })` });
  await q({ op: 'eval', js: `document.body.classList.add('printing'); true` });
  await q({ op: 'media', media: 'print' });
  await sleep(600);
  const shot = await q({ op: 'shot', name: `docs/${BK}-${VIEW}-${tag}-print` });
  await q({ op: 'media', media: '' });
  // จบการพิมพ์แบบเบราว์เซอร์จริง (afterprint) → PrintPortal เก็บกวาด พร้อมพิมพ์ครั้งต่อไป
  await q({ op: 'eval', js: `window.dispatchEvent(new Event('afterprint')); true` });
  await sleep(600);
  results.push({ tag, ...st, file: shot.file });
  console.log(`${tag.padEnd(22)} print()=${st.printed} body="${st.bodyClass}" portal=${st.portal} text=${st.textLen} h=${st.heightPx} → ${shot.file}`);
}
const issues = await q({ op: 'issues', clear: true });
const mock = await q({ op: 'mockErrors', clear: true });
console.log('console/http:', JSON.stringify(issues.map((i) => i.text)).slice(0, 1500));
console.log('mock:', JSON.stringify(mock.map((e) => `${e.status} ${e.path} ${e.message}`)).slice(0, 1500));
