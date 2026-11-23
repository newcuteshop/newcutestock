// =========================================================================
// tools/qa/checks.mjs — ตรวจหน้าเว็บอัตโนมัติ (รันในหน้าผ่าน page.eval) + ตรวจสีจากภาพหน้าจอ
//
//   const r = await pageChecks(page, { foreign })   → { overflowX, wide:[…], clipped:[…], foreignColors:[…], smallTargets:[…], dialogs:[…] }
//   foreignPalette()                                 → สีของ NEWCUTE + ร้านเช่าที่ "ไม่มี" ในธีม b.oncloud (อ่านจาก app/globals.css)
//   pixelScan(pngPath, colors)                       → จำนวนพิกเซลที่ตรงสีต้องห้ามในภาพ (จับกราฟ Chart.js/รูปใน canvas)
// =========================================================================
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));

function blockColors(css, selector) {
  const at = css.indexOf(selector + ' {');
  if (at < 0) return new Map();
  const end = css.indexOf('\n}', at);
  const out = new Map();
  for (const m of css.slice(at, end).matchAll(/--c-([a-z0-9-]+):\s*(\d+) (\d+) (\d+);/g)) out.set(m[1], `${m[2]},${m[3]},${m[4]}`);
  return out;
}

/** สีของร้านอื่นที่ห้ามโผล่ในหน้า b.oncloud: { 'r,g,b': 'newcute brand-400' } */
export function foreignPalette(cssFile = path.join(REPO, 'app', 'globals.css')) {
  const css = readFileSync(cssFile, 'utf8');
  const nc = blockColors(css, "[data-shop='newcute']");
  const rt = blockColors(css, "[data-shop='rental']");
  const wd = blockColors(css, "[data-shop='wedding']");
  const wedSet = new Set(wd.values());
  const out = {};
  for (const [shop, m] of [['newcute', nc], ['rental', rt]]) {
    for (const [k, v] of m) {
      if (wedSet.has(v) || v === '255,255,255' || v === '0,0,0') continue;
      out[v] = out[v] ? `${out[v]} / ${shop} ${k}` : `${shop} ${k}`;
    }
  }
  return out;
}

// ---- ตรวจในหน้า (ต้องเป็นฟังก์ชันที่ serialize ได้) ----
function inPage(foreign, opts) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const res = { url: location.pathname + location.search, w: W, overflowX: document.documentElement.scrollWidth - W, wide: [], clipped: [], foreignColors: [], smallTargets: [], dialogs: [], shop: document.documentElement.getAttribute('data-shop') };
  const desc = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 4).join('.');
    if (cls) s += '.' + cls;
    const t = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 50);
    return t ? `${s} "${t}"` : s;
  };
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.01; };
  const fmap = new Map();
  const addF = (p, key, el) => { const k = key + ' ' + foreign[key]; const e = fmap.get(k) || { n: 0, ex: [] }; e.n++; if (e.ex.length < 3) e.ex.push(p + ' @ ' + desc(el)); fmap.set(k, e); };
  const all = [...document.body.querySelectorAll('*')];
  // ภายในกล่องที่เลื่อนแนวนอนได้เอง (ตาราง) ไม่นับว่าล้นหน้า
  const inScroller = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true; } return false; };
  const scaledPreview = (el) => !!el.closest('[data-qa-ignore], [style*="scale("]');
  for (const el of all) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if ((r.right > W + 1 || r.left < -1) && !inScroller(el) && !scaledPreview(el) && getComputedStyle(el).position !== 'fixed') {
      if (res.wide.length < 15) res.wide.push(`${desc(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    }
    // ตัวอักษรไทยถูกตัด (สระ/วรรณยุกต์บน-ล่างหาย) : กล่อง overflow hidden ที่สูงไม่พอกับเนื้อหา
    const s = getComputedStyle(el);
    const hasThai = /[฀-๿]/.test(el.textContent || '');
    // sr-only (กล่อง 1px สำหรับโปรแกรมอ่านหน้าจอ) ตั้งใจซ่อน — ไม่นับ
    const srOnly = el.clientWidth <= 1 || el.clientHeight <= 1;
    if (hasThai && !srOnly && /(hidden|clip)/.test(s.overflowY) && el.children.length <= 3 && !/^\d/.test(String(s.webkitLineClamp || ''))) {
      const fs = parseFloat(s.fontSize);
      const lh = s.lineHeight === 'normal' ? fs * 1.5 : parseFloat(s.lineHeight);
      const over = el.scrollHeight - el.clientHeight;
      const single = s.whiteSpace === 'nowrap' || /ellipsis/.test(s.textOverflow);
      if ((single && lh < fs * 1.35) || (over > 2 && el.clientHeight > 0 && el.clientHeight < lh * 1.2 + 4)) {
        if (res.clipped.length < 15) res.clipped.push(`${desc(el)} fs=${fs} lh=${Math.round(lh * 10) / 10} h=${el.clientHeight} sh=${el.scrollHeight}`);
      }
    }
    // สีร้านอื่น
    if (foreign) {
      const props = ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor', 'outlineColor', 'fill', 'stroke', 'textDecorationColor', 'caretColor', 'accentColor'];
      for (const p of props) {
        const v = s[p];
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(v || '');
        if (!m) continue;
        if (m[4] !== undefined && Number(m[4]) === 0) continue;
        if (p.startsWith('border') && parseFloat(s[p.replace('Color', 'Width')]) === 0) continue;
        if (p === 'outlineColor' && (s.outlineStyle === 'none' || parseFloat(s.outlineWidth) === 0)) continue;
        if ((p === 'caretColor' || p === 'accentColor' || p === 'textDecorationColor') && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && p !== 'textDecorationColor') continue;
        if (p === 'textDecorationColor' && s.textDecorationLine === 'none') continue;
        if ((p === 'fill' || p === 'stroke') && !(el instanceof SVGElement)) continue;
        const key = `${m[1]},${m[2]},${m[3]}`;
        if (foreign[key]) addF(p, key, el);
      }
      for (const p of ['backgroundImage', 'boxShadow']) {
        const v = s[p];
        if (!v || v === 'none') continue;
        for (const m of v.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)) { const key = `${m[1]},${m[2]},${m[3]}`; if (foreign[key]) addF(p, key, el); }
      }
    }
    if (opts.mobile && /^(BUTTON|A|SELECT|INPUT)$/.test(el.tagName) && !['hidden', 'checkbox', 'radio', 'file'].includes(el.type) && !el.closest('p')) {
      if ((r.height < 32 || r.width < 24) && res.smallTargets.length < 20 && !(el.tagName === 'A' && getComputedStyle(el).display === 'inline')) res.smallTargets.push(`${desc(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  res.foreignColors = [...fmap].map(([k, v]) => `${k} ×${v.n}: ${v.ex.join(' | ')}`);
  // dialog ที่เปิดอยู่: ต้องอยู่ในจอ เลื่อนได้ถ้ายาวเกิน มีชื่อ
  for (const d of document.querySelectorAll('[role=dialog], [role=alertdialog], dialog[open]')) {
    if (!vis(d)) continue;
    const r = d.getBoundingClientRect();
    const s = getComputedStyle(d);
    const scrollable = d.scrollHeight <= d.clientHeight + 1 || /(auto|scroll)/.test(s.overflowY) || [...d.querySelectorAll('*')].some((x) => /(auto|scroll)/.test(getComputedStyle(x).overflowY) && x.scrollHeight > x.clientHeight + 1);
    res.dialogs.push({ name: d.getAttribute('aria-label') || document.getElementById(d.getAttribute('aria-labelledby') || '')?.textContent?.trim() || '', top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), vh: H, fits: r.left >= -1 && r.right <= W + 1, scrollable, modal: d.getAttribute('aria-modal') });
  }
  return res;
}

export async function pageChecks(page, { foreign = null } = {}) {
  return page.eval(`(${inPage.toString()})(${JSON.stringify(foreign)}, ${JSON.stringify({ mobile: !!page.view?.mobile })})`);
}

/** นับพิกเซลที่ตรงสีต้องห้าม (ตรงเป๊ะ) ในภาพ PNG → { 'r,g,b': n } เฉพาะที่ ≥ min */
export function pixelScan(file, colors, min = 40) {
  const { PNG } = require('pngjs');
  const png = PNG.sync.read(readFileSync(file));
  const want = new Map(colors.map((c) => [c, 0]));
  const d = png.data;
  for (let i = 0; i < d.length; i += 4) {
    const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
    if (want.has(k)) want.set(k, want.get(k) + 1);
  }
  return Object.fromEntries([...want].filter(([, n]) => n >= min));
}

/** เทียบภาพ 2 ไฟล์ → { diff, total, sizeA, sizeB } (+ เขียนภาพต่างถ้าให้ out) */
export function diffPng(a, b, out = null) {
  const { PNG } = require('pngjs');
  const A = PNG.sync.read(readFileSync(a));
  const B = PNG.sync.read(readFileSync(b));
  const w = Math.min(A.width, B.width); const h = Math.min(A.height, B.height);
  let diff = 0;
  const O = out ? new PNG({ width: w, height: h }) : null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ia = (y * A.width + x) * 4; const ib = (y * B.width + x) * 4; const io = (y * w + x) * 4;
      const same = A.data[ia] === B.data[ib] && A.data[ia + 1] === B.data[ib + 1] && A.data[ia + 2] === B.data[ib + 2];
      if (!same) diff++;
      if (O) { const g = (A.data[ia] + A.data[ia + 1] + A.data[ia + 2]) / 3; O.data[io] = same ? g * 0.3 + 178 : 255; O.data[io + 1] = same ? g * 0.3 + 178 : 0; O.data[io + 2] = same ? g * 0.3 + 178 : 0; O.data[io + 3] = 255; }
    }
  }
  const extra = Math.abs(A.width * A.height - B.width * B.height);
  if (O && diff) { const fs = require('fs'); fs.writeFileSync(out, PNG.sync.write(O)); }
  return { diff: diff + extra, sizeA: `${A.width}x${A.height}`, sizeB: `${B.width}x${B.height}` };
}
