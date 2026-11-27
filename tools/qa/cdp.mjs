// =========================================================================
// tools/qa/cdp.mjs — ตัวขับ Chrome แบบ headless ผ่าน Chrome DevTools Protocol (ไม่ต้องติดตั้งแพ็กเกจเพิ่ม)
//
//   const browser = await launchChrome({ userDataDir, downloadDir })
//   const page = await browser.newPage({ width: 375, height: 812, mobile: true })
//   await page.goto('http://127.0.0.1:3485/wedding'); await page.screenshot('a.png', { fullPage: true })
//   page.issues → console error / exception / คำขอที่พัง (สถานะ ≥ 400) ที่เก็บไว้ตั้งแต่เปิดหน้า
//   await browser.close()
//
// ใช้ WebSocket ในตัวของ Node (≥ 22) ; หา chrome.exe จาก CHROME_PATH หรือที่ติดตั้งปกติของ Windows/macOS/Linux
// =========================================================================
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

export function findChrome() {
  const list = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const hit = list.find((p) => existsSync(p));
  if (!hit) throw new Error('ไม่พบ Chrome — ตั้ง CHROME_PATH เป็นไฟล์ chrome.exe');
  return hit;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchChrome({ userDataDir, downloadDir, headless = true, timezone = 'Asia/Bangkok', lang = 'th-TH' } = {}) {
  mkdirSync(userDataDir, { recursive: true });
  try { rmSync(path.join(userDataDir, 'DevToolsActivePort')); } catch {}
  const args = [
    headless ? '--headless=new' : '', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication,PasswordManagerOnboarding',
    '--hide-scrollbars', '--disable-save-password-bubble', '--password-store=basic', '--force-color-profile=srgb', '--font-render-hinting=none', `--lang=${lang}`, 'about:blank',
  ].filter(Boolean);
  const proc = spawn(findChrome(), args, { stdio: 'ignore', env: { ...process.env, TZ: timezone } });
  let port = null; let wsPath = null;
  for (let i = 0; i < 200 && !port; i++) {
    await sleep(100);
    try {
      const [p, w] = readFileSync(path.join(userDataDir, 'DevToolsActivePort'), 'utf8').split('\n');
      if (p && w) { port = Number(p); wsPath = w.trim(); }
    } catch {}
  }
  if (!port) { proc.kill(); throw new Error('เปิด Chrome ไม่สำเร็จ (ไม่มี DevToolsActivePort)'); }
  const conn = await Connection.open(`ws://127.0.0.1:${port}${wsPath}`);
  if (downloadDir) {
    mkdirSync(downloadDir, { recursive: true });
    await conn.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.resolve(downloadDir), eventsEnabled: true });
  }
  const downloads = [];
  conn.on('Browser.downloadWillBegin', (p) => downloads.push({ guid: p.guid, name: p.suggestedFilename, state: 'started' }));
  conn.on('Browser.downloadProgress', (p) => { const d = downloads.find((x) => x.guid === p.guid); if (d) d.state = p.state; });
  return {
    conn, proc, downloads, timezone,
    async newPage(view = {}) {
      const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
      const page = new Page(conn, sessionId, targetId, this);
      await page.init(view);
      return page;
    },
    /** รอไฟล์ดาวน์โหลดที่เริ่มหลัง index นี้เสร็จ → ชื่อไฟล์ */
    async waitDownload(fromIndex, timeout = 30000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        const d = downloads.slice(fromIndex).find((x) => x.state === 'completed' || x.state === 'canceled');
        if (d) return d.state === 'completed' ? d.name : null;
        await sleep(100);
      }
      return null;
    },
    async close() {
      try { await conn.send('Browser.close'); } catch {}
      await sleep(300);
      try { proc.kill(); } catch {}
      conn.close();
    },
  };
}

class Connection {
  static open(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const c = new Connection(ws);
      ws.onopen = () => resolve(c);
      ws.onerror = (e) => reject(new Error('CDP websocket error ' + (e?.message || '')));
    });
  }
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, method } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`)); else resolve(msg.result);
        return;
      }
      if (msg.method) {
        const key = msg.sessionId ? `${msg.sessionId}:${msg.method}` : msg.method;
        for (const h of this.handlers.get(key) || []) h(msg.params);
        for (const h of this.handlers.get(msg.method) || []) if (!msg.sessionId) void h; // เหตุการณ์ระดับเบราว์เซอร์ส่งด้านบนแล้ว
      }
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`${method}: หมดเวลา`)); } }, 90000);
    });
  }
  on(key, fn) { if (!this.handlers.has(key)) this.handlers.set(key, []); this.handlers.get(key).push(fn); }
  close() { try { this.ws.close(); } catch {} }
}

class Page {
  constructor(conn, sessionId, targetId, browser) {
    this.conn = conn; this.sid = sessionId; this.targetId = targetId; this.browser = browser;
    this.issues = []; this.inflight = new Map(); this.lastNet = Date.now(); this.view = null;
  }
  send(m, p) { return this.conn.send(m, p, this.sid); }
  on(ev, fn) { this.conn.on(`${this.sid}:${ev}`, fn); }
  async init({ width = 1440, height = 900, mobile = false, dpr = 1 } = {}) {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
    await this.send('Log.enable');
    await this.send('Network.setCacheDisabled', { cacheDisabled: false });
    if (this.browser.timezone) await this.send('Emulation.setTimezoneOverride', { timezoneId: this.browser.timezone });
    this.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error' || p.type === 'assert') this.issues.push({ kind: 'console', url: this.url, text: p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 500) });
    });
    this.on('Runtime.exceptionThrown', (p) => this.issues.push({ kind: 'exception', url: this.url, text: (p.exceptionDetails.exception?.description || p.exceptionDetails.text || '').slice(0, 800) }));
    this.on('Log.entryAdded', (p) => { if (p.entry.level === 'error') this.issues.push({ kind: 'log', url: this.url, text: `${p.entry.text} ${p.entry.url || ''}`.slice(0, 500) }); });
    this.on('Network.requestWillBeSent', (p) => { this.inflight.set(p.requestId, p.request.url); this.lastNet = Date.now(); });
    const done = (p) => { this.inflight.delete(p.requestId); this.lastNet = Date.now(); };
    this.on('Network.loadingFinished', done);
    this.on('Network.loadingFailed', (p) => { const u = this.inflight.get(p.requestId); done(p); if (!p.canceled && u && !/^data:/.test(u)) this.issues.push({ kind: 'netfail', url: this.url, text: `${p.errorText} ${u}`.slice(0, 400) }); });
    this.on('Network.responseReceived', (p) => { if (p.response.status >= 400) this.issues.push({ kind: 'http', url: this.url, status: p.response.status, text: `${p.response.status} ${p.response.url}`.slice(0, 400) }); });
    this.on('Page.javascriptDialogOpening', (p) => { this.issues.push({ kind: 'dialog', url: this.url, text: `${p.type}: ${p.message}` }); void this.send('Page.handleJavaScriptDialog', { accept: true }); });
    await this.setViewport({ width, height, mobile, dpr });
  }
  async setViewport({ width, height, mobile = false, dpr = 1 }) {
    this.view = { width, height, mobile, dpr };
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile, screenWidth: width, screenHeight: height });
    await this.send('Emulation.setTouchEmulationEnabled', mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  }
  addInitScript(source) { return this.send('Page.addScriptToEvaluateOnNewDocument', { source }); }
  async goto(url, { wait = 'idle', timeout = 45000 } = {}) {
    this.url = url;
    const loaded = new Promise((r) => { const h = () => r(); this.on('Page.loadEventFired', h); });
    await this.send('Page.navigate', { url });
    await Promise.race([loaded, sleep(timeout)]);
    if (wait === 'idle') await this.idle({ timeout });
  }
  async idle({ quiet = 600, timeout = 30000 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const pending = [...this.inflight.values()].filter((u) => !/_next\/webpack-hmr|\/__nextjs/.test(u));
      if (pending.length === 0 && Date.now() - this.lastNet > quiet) return true;
      await sleep(100);
    }
    return false;
  }
  async eval(expr, { awaitPromise = true } = {}) {
    const src = typeof expr === 'function' ? `(${expr})()` : expr;
    const r = await this.send('Runtime.evaluate', { expression: src, awaitPromise, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  /** รอจน expr เป็นจริง (ข้อความ JS) */
  async waitFor(expr, timeout = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (await this.eval(expr)) return true; } catch {}
      await sleep(150);
    }
    return false;
  }
  async url_() { return this.eval('location.href'); }
  /** คลิกด้วยเมาส์จริงที่กลางกล่องของ selector (หรือปุ่มที่มีข้อความตรง) */
  async click(target, { timeout = 10000 } = {}) {
    const ok = await this.waitFor(`!!(${finder(target)})`, timeout);
    if (!ok) throw new Error(`ไม่พบปุ่ม/ช่อง: ${JSON.stringify(target)}`);
    const box = await this.eval(`(() => { const el = ${finder(target)}; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await sleep(60);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
    await sleep(120);
  }
  /** พิมพ์ลงช่อง (ล้างก่อน) แบบ React เห็นการเปลี่ยนแปลง */
  async fill(target, value) {
    await this.click(target);
    // ล้างค่าด้วย native setter + input event (React เห็น) — ไม่พึ่ง Ctrl+A/Delete ซึ่งไม่ทำงานใน CDP และโดนตัวกรอกรหัสผ่านอัตโนมัติแทรก
    await this.eval(`(() => { const el = ${finder(target)}; el.focus(); if ('value' in el) { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
    if (value !== '') await this.send('Input.insertText', { text: String(value) });
    await sleep(80);
  }
  /** ตั้งค่า <select>/<input type=date> แบบ React (native setter + event) */
  async setValue(target, value) {
    const ok = await this.waitFor(`!!(${finder(target)})`, 8000);
    if (!ok) throw new Error(`ไม่พบช่อง: ${JSON.stringify(target)}`);
    await this.eval(`(() => { const el = ${finder(target)}; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(value))});
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(80);
  }
  async key(key) {
    const code = key === 'Escape' ? 'Escape' : key === 'Enter' ? 'Enter' : key;
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: key === 'Escape' ? 27 : key === 'Enter' ? 13 : 0 });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: key === 'Escape' ? 27 : key === 'Enter' ? 13 : 0 });
  }
  async uploadFile(selector, filePath) {
    const doc = await this.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await this.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
    if (!nodeId) throw new Error('ไม่พบช่องไฟล์ ' + selector);
    await this.send('DOM.setFileInputFiles', { nodeId, files: [path.resolve(filePath)] });
  }
  async emulateMedia(media) { await this.send('Emulation.setEmulatedMedia', { media: media || '' }); }
  async screenshot(file, { fullPage = true, maxHeight = 12000 } = {}) {
    await sleep(150);
    // แอปนี้ล็อกความสูงหน้าไว้เท่าจอ (h-[100dvh]) แล้วเลื่อนในกล่อง <main> → "ทั้งหน้า" ของเอกสารไม่ยาวขึ้น
    // วิธี: หากล่องเลื่อนแนวตั้งที่ใหญ่ที่สุด แล้วขยายความสูงจอจำลองชั่วคราวให้พอดีเนื้อหา → ถ่าย → คืนขนาดเดิม
    // (มี dialog เปิดอยู่ = ถ่ายเท่าจอ เพราะ dialog ต้องดูในขนาดจอจริง)
    let extra = 0;
    if (fullPage) {
      extra = await this.eval(`(() => { const open = [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].some((d) => { const r = d.getBoundingClientRect(); const s = getComputedStyle(d); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && r.right > 0 && r.left < innerWidth; }); if (open) return 0;
        let best = document.documentElement.scrollHeight - innerHeight;
        for (const el of document.querySelectorAll('main, div, section')) { const s = getComputedStyle(el); if (!/(auto|scroll)/.test(s.overflowY) || el.clientHeight < innerHeight * 0.5) continue; best = Math.max(best, el.scrollHeight - el.clientHeight); }
        return Math.max(0, Math.ceil(best)); })()`).catch(() => 0);
    }
    const v = this.view;
    // แท็บที่ไม่ได้อยู่หน้าสุด Chrome ไม่วาดหน้า → captureScreenshot ค้างจนหมดเวลา → ดึงแท็บขึ้นหน้าก่อนถ่ายเสมอ
    await this.send('Page.bringToFront').catch(() => {});
    let r;
    try {
      if (extra > 0) {
        await this.send('Emulation.setDeviceMetricsOverride', { width: v.width, height: Math.min(v.height + extra, maxHeight), deviceScaleFactor: v.dpr, mobile: v.mobile, screenWidth: v.width, screenHeight: v.height });
        await sleep(400);
      }
      r = await this.send('Page.captureScreenshot', { format: 'png' });
    } finally {
      // ถ่ายไม่สำเร็จก็ต้องคืนขนาดจอเดิม (ไม่งั้นแท็บค้างที่ความสูงที่ขยายไว้)
      if (extra > 0) { await this.setViewport(v).catch(() => {}); await sleep(150); }
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
  async close() { try { await this.conn.send('Target.closeTarget', { targetId: this.targetId }); } catch {} }
}

// target: 'css selector' | { text: 'ข้อความปุ่ม', within?: 'css', tag?: 'button' } | { label: 'aria-label' }
function finder(target) {
  if (typeof target === 'string') return `document.querySelector(${JSON.stringify(target)})`;
  if (target.label) return `document.querySelector('[aria-label=${JSON.stringify(target.label).replace(/'/g, "\\'")}]')`;
  // within: เอากล่องที่มองเห็นตัวสุดท้าย (dialog ซ้อนกัน = ตัวบนสุด ; ลิ้นชักเมนูที่ซ่อนอยู่ไม่นับ)
  const within = target.within ? `[...document.querySelectorAll(${JSON.stringify(target.within)})].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && r.right > 0 && r.left < innerWidth; }).pop()` : 'document';
  const tag = target.tag || 'button, a, [role=button], [role=tab], label, summary, [role=menuitem], [role=option]';
  const exact = target.exact !== false;
  return `(() => { const root = ${within}; if (!root) return null; const want = ${JSON.stringify(target.text)};
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'; };
    const els = [...root.querySelectorAll(${JSON.stringify(tag)})].filter(vis);
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
    return els.find((el) => ${exact ? 'norm(el.textContent) === want' : 'norm(el.textContent).includes(want)'}) || els.find((el) => norm(el.textContent).includes(want)) || null; })()`;
}
export { finder, sleep };
