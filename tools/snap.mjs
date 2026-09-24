// Headless browser check: starts a Vite dev server (or serves dist/ with --dist), opens a page in
// headless Chrome/Edge (WebGL via SwiftShader, requestAnimationFrame runs), runs steps, saves
// screenshots and prints console output and page errors. Exit code 1 if the page threw.
//
// Usage:
//   node tools/snap.mjs --path "/" --wait 3000 --shot out/title.png
//   node tools/snap.mjs --path "/harness/clean.html" --wait 4000 --shot out/clean.png
//   node tools/snap.mjs --steps tools/steps/smoke.json
//   node tools/snap.mjs --dist --path "/" --shot out/prod.png        (after npm run build)
//
// Steps file: JSON array, each one of:
//   {"goto": "/"}  {"wait": 1000}  {"waitFor": "js expr", "timeout": 30000}
//   {"eval": "js expr (may use await)"}  {"click": [x, y]}  {"clickSel": "css selector"}
//   {"move": [x, y]}  {"key": "w"}  {"keyDown": "w"}  {"keyUp": "w"}  {"hold": "w", "ms": 1500}
//   {"down": [x, y]}  {"up": [x, y]}  {"tap": [x, y]} (touch, needs --mobile)
//   {"drag": [[x1, y1], [x2, y2], ...], "ms": 800}   mouse down, glide through the points over ms, mouse up
//   {"scrub": [x, y], "radius": 30, "ms": 2000}       down, zig-zag around a point for ms (scraping), up
//   {"shot": "out/name.png"}  {"size": [1600, 900]}
// Flags: --size WxH (default 1440x900), --mobile (390x844 touch), --touch (touch + mobile UA at --size, e.g. iPad 1024x768), --gpu (real GPU via D3D11: ~60 fps instead of ~2 fps SwiftShader; use it for feel/timing checks), --verbose
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes('--' + n);

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean);
const executablePath = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!executablePath) { console.error('No Chrome/Edge found'); process.exit(2); }

let steps = [];
if (flag('steps')) steps = JSON.parse(fs.readFileSync(path.resolve(ROOT, flag('steps')), 'utf8'));
else {
  steps.push({ goto: flag('path', '/') });
  steps.push({ wait: Number(flag('wait0', 1500)) });
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--eval') steps.push({ eval: args[i + 1] });
    if (args[i] === '--wait') steps.push({ wait: Number(args[i + 1]) });
    if (args[i] === '--shot') steps.push({ shot: args[i + 1] });
    if (args[i] === '--click') steps.push({ click: args[i + 1].split(',').map(Number) });
    if (args[i] === '--clickSel') steps.push({ clickSel: args[i + 1] });
    if (args[i] === '--key') steps.push({ key: args[i + 1] });
    if (args[i] === '--hold') steps.push({ hold: args[i + 1], ms: Number(args[i + 2]) || 1000 });
  }
}

// ---------------------------------------------------------------- server
let base;
let closeServer = async () => {};
if (has('dist')) {
  const dist = path.join(ROOT, 'dist');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]).replace(/^\/floss-boss/, '');
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(dist, p);
    if (!f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  closeServer = async () => server.close();
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: ROOT, server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error', clearScreen: false });
  await vite.listen();
  const addr = vite.httpServer.address();
  base = `http://127.0.0.1:${addr.port}`;
  closeServer = async () => vite.close();
}

// ---------------------------------------------------------------- browser
const [w, h] = (has('mobile') ? '390x844' : flag('size', '1440x900')).split('x').map(Number);
const browser = await puppeteer.launch({
  executablePath, headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', ...(has('gpu') ? ['--use-angle=d3d11', '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']), '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
const touch = has('mobile') || has('touch');
await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch });
const errors = [];
page.on('console', (m) => {
  const t = m.type();
  if (/favicon|fonts\.g/.test(m.location()?.url || '')) return;
  if (t === 'error' || t === 'warn' || t === 'warning' || has('verbose') || t === 'log') console.log(`[console.${t}] ${m.text()}`);
});
page.on('pageerror', (e) => { console.log(`[pageerror] ${e.message}\n${e.stack || ''}`); errors.push(e.message); });
page.on('requestfailed', (r) => { if (!/fonts\.g/.test(r.url())) console.log(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`); });
page.on('response', (r) => { if (r.status() >= 400) console.log(`[http ${r.status()}] ${r.url()}`); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const s of steps) {
  try {
    if (s.goto !== undefined) {
      // Git Bash rewrites "/path" args into "C:/Program Files/Git/path"; undo that.
      let g = String(s.goto).replace(/\\/g, '/').replace(/^[A-Za-z]:\/.*?\/Git(?=\/)/, '');
      if (!g.startsWith('/')) g = '/' + g;
      await page.goto(base + g, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    else if (s.wait !== undefined) await sleep(s.wait);
    else if (s.waitFor !== undefined) {
      const t0 = Date.now();
      const timeout = s.timeout || 30000;
      while (!(await page.evaluate(s.waitFor).catch(() => false))) {
        if (Date.now() - t0 > timeout) { console.log(`[waitFor timeout] ${s.waitFor}`); break; }
        await sleep(150);
      }
    } else if (s.eval !== undefined) {
      const code = s.eval.includes('await') ? `(async () => { return (${s.eval}); })()` : s.eval;
      const r = await page.evaluate(code);
      console.log(`[eval] ${s.eval.slice(0, 80)} => ${JSON.stringify(r)?.slice(0, 2000)}`);
    } else if (s.click) await page.mouse.click(s.click[0], s.click[1]);
    else if (s.clickSel) await page.click(s.clickSel);
    else if (s.move) await page.mouse.move(s.move[0], s.move[1]);
    else if (s.down) { await page.mouse.move(s.down[0], s.down[1]); await page.mouse.down(); }
    else if (s.up) { if (Array.isArray(s.up)) await page.mouse.move(s.up[0], s.up[1]); await page.mouse.up(); }
    else if (s.tap) await page.touchscreen.tap(s.tap[0], s.tap[1]);
    else if (s.drag) {
      const pts = s.drag; const ms = s.ms || 800; const per = Math.max(2, Math.round(ms / 16 / Math.max(1, pts.length - 1)));
      await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1]; const [bx, by] = pts[i];
        for (let k = 1; k <= per; k++) { await page.mouse.move(ax + (bx - ax) * k / per, ay + (by - ay) * k / per); await sleep(16); }
      }
      await page.mouse.up();
    }
    else if (s.scrub) {
      const [cx, cy] = s.scrub; const r = s.radius || 30; const ms = s.ms || 2000; const t0 = Date.now();
      await page.mouse.move(cx, cy); await page.mouse.down();
      let i = 0;
      while (Date.now() - t0 < ms) { i++; await page.mouse.move(cx + Math.sin(i * 0.9) * r, cy + Math.cos(i * 0.37) * r * 0.6); await sleep(16); }
      await page.mouse.up();
    }
    else if (s.key) await page.keyboard.press(s.key);
    else if (s.keyDown) await page.keyboard.down(s.keyDown);
    else if (s.keyUp) await page.keyboard.up(s.keyUp);
    else if (s.hold) { await page.keyboard.down(s.hold); await sleep(s.ms || 1000); await page.keyboard.up(s.hold); }
    else if (s.size) await page.setViewport({ width: s.size[0], height: s.size[1] });
    else if (s.shot) {
      const out = path.resolve(ROOT, s.shot);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await page.screenshot({ path: out });
      console.log(`[shot] ${s.shot}`);
    }
  } catch (e) {
    console.log(`[step error] ${JSON.stringify(s)}: ${e.message}`);
    errors.push(e.message);
  }
}
await browser.close();
await closeServer();
console.log(errors.length ? `DONE with ${errors.length} error(s)` : 'DONE ok');
process.exit(errors.length ? 1 : 0);
