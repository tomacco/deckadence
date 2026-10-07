#!/usr/bin/env node
// memory.mjs — how heavy is this deck in a real browser? Zero dependencies, no remote debugging.
//
//   node components/verify/memory.mjs deck/index.html [--dwell 1200] [--chrome <path>] [--json out.json] [--max-mb N]
//                                     [--slow vendor/anime.umd.min.js=1500]   (delay one file: a slow CDN)
//                                     [--edit]   (through components/edit/serve.mjs, edit mode on: the navigator
//                                                 is opened and every slide in it scrolled into view first)
//
// WHAT  · Serves the deck's folder on 127.0.0.1, injects a small driver on the wire (the deck file is
//         never touched), opens it in headless Chrome at 1920x1080, and walks EVERY station the way a
//         presenter does (goto → wait for the flight → dwell). While it walks, it samples the resident
//         memory of the whole Chrome process tree from `ps` (browser + renderer + GPU), and the driver
//         reports the page's own view at each station: JS heap, live DOM nodes, <img> count.
// WHY   · The engine's memory problem is cumulative (a deck that is fine on slide 3 dies on slide 50),
//         so a single screenshot or a load-time number says nothing. Remote debugging is refused by
//         policy on managed machines, so this reads the OS, not DevTools.
// OUT   · A table every 10 stations, then the peaks. `--json` writes every sample. `--max-mb` makes it a
//         gate: exit 1 when the peak renderer RSS exceeds N MB.
// NOTE  · RSS is the OS's resident set: shared pages are counted once per process, so the TREE total
//         over-counts a little. Compare decks and engine versions with the same tool on the same
//         machine; do not read the absolute number as a bill.
import { spawn, execFileSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep, basename } from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };
const deckArg = argv.find(a => !a.startsWith('--') && !argv[argv.indexOf(a) - 1]?.startsWith('--'));
if (!deckArg || !existsSync(deckArg)) { console.error('usage: memory.mjs <deck.html> [--dwell ms] [--chrome path] [--json out] [--max-mb N]'); process.exit(2); }
const DECK = resolve(deckArg), ROOT = dirname(DECK), PAGE = '/' + basename(DECK);
const DWELL = +opt('dwell', 1200), MAX_MB = opt('max-mb') ? +opt('max-mb') : null, JSON_OUT = opt('json');
// --slow path=ms holds one file back: the engine's script arriving late from a CDN is when the browser
// paints whatever the parser has, before the engine runs (what the live window's paint gate prevents)
const EDIT = argv.includes('--edit');
const SLOW = opt('slow') ? { path: '/' + opt('slow').split('=')[0].replace(/^\//, ''), ms: +opt('slow').split('=')[1] || 1500 } : null;
const CHROME = opt('chrome') || [process.env.DECK_BROWSER, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(existsSync);
if (!CHROME) { console.error('no Chrome found; pass --chrome or set DECK_BROWSER'); process.exit(2); }

// The driver: walk every station through the engine's own hook, report after each arrival.
const DRIVER = `<script>(() => {
  // images the browser actually PAINTED (Element Timing; the decks under test tag <img elementtiming>)
  let painted = 0;
  // this driver is a LATER script than the engine: it must hear the first station's deck:mount too
  const heard = new Set();
  document.addEventListener('deck:mount', e => heard.add(e.detail.key || e.detail.id));
  try { new PerformanceObserver(l => { painted += l.getEntries().length; }).observe({ type: 'element', buffered: true }); } catch (e) {}
  const post = (path, body) => fetch(path, { method: 'POST', body: JSON.stringify(body) }).catch(() => {});
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const snap = (i) => ({ i, key: (D.stations[i] || {}).key || '', heap: performance.memory ? performance.memory.usedJSHeapSize : null,
    nodes: document.getElementsByTagName('*').length, imgs: document.images.length, painted,
    heardMount: D.stations[i] ? heard.has(D.stations[i].key || D.stations[i].el.id) : false,
    live: D.stations.filter(s => s.el.childElementCount > 0).length,
    mounted: !!(D.stations[i] && D.stations[i].el.childElementCount > 0 && !D.stations[i].el.querySelector('.station-error')) });
  let D;
  addEventListener('load', async () => {
    post('/__mem/boot', {});
    for (let k = 0; k < 100 && !(D = window.Deckadence); k++) await sleep(50);
    if (!D) { post('/__mem/done', { error: 'no window.Deckadence' }); return; }
    await sleep(1500);
    if (${EDIT}) {
      // edit mode: open the slide navigator and bring every slide in it into view, as a reviewer scrolls
      for (let k = 0; k < 100 && !document.querySelector('#dk-nav'); k++) await sleep(50);
      const btn = document.querySelector('[data-nav]');
      if (btn && !document.body.classList.contains('dk-nav-open')) btn.click();
      await sleep(800);
      const items = [...document.querySelectorAll('#dk-list .dk-slide')];
      for (const n of items) { n.scrollIntoView({ block: 'center' }); await sleep(250); }
      await sleep(2000);
      await post('/__mem/step', { ...snap(D.current()), nav: true, navItems: items.length, frames: document.querySelectorAll('iframe').length });
    }
    post('/__mem/step', snap(D.current()));
    for (let i = 0; i < D.stations.length; i++) {
      // frame pacing during the flight: every rAF interval from departure to arrival
      const frames = []; let last = performance.now(), on = true;
      const tick = t => { frames.push(t - last); last = t; if (on) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      // walk like a presenter: keys are ignored while the engine is busy, so wait for it (a station
      // that holds the camera forever then shows up as a walk that never finishes)
      for (let k = 0; k < 1200 && D.isBusy(); k++) await sleep(25);
      if (D.isBusy()) { post('/__mem/done', { error: 'the engine stayed busy for 30 s before station ' + (i + 1) + ' (camera held)' }); return; }
      if (i !== D.current()) D.goto(i);
      for (let k = 0; k < 400 && D.isBusy(); k++) await sleep(25);
      on = false;
      await sleep(${DWELL});
      const f = frames.slice(1).sort((a, b) => a - b);
      await post('/__mem/step', { ...snap(i), frames: f.length, p95: f.length ? f[Math.floor(f.length * .95)] : null, long: f.filter(x => x > 50).length });
    }
    D.toOverview(); await sleep(2500);
    await post('/__mem/step', { ...snap(D.current()), overview: true });
    post('/__mem/done', { stations: D.stations.length });
  });
})();</script>`;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.otf': 'font/otf', '.ttf': 'font/ttf' };
const steps = [], samples = [];
let servedBytes = 0, bootBytes = null, bootRequests = null, requests = 0;   // what the deck pulls before the first slide shows
let doneInfo = null, chrome = null;

function treeRss(rootPid) {
  // ps is POSIX on macOS and Linux: pid, ppid, rss (KiB), command
  let out = '';
  try { out = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,command='], { encoding: 'utf8', maxBuffer: 32 << 20 }); } catch (e) { return null; }
  const rows = out.trim().split('\n').map(l => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/); return m && { pid: +m[1], ppid: +m[2], kb: +m[3], cmd: m[4] }; }).filter(Boolean);
  const kids = new Map(); rows.forEach(r => { if (!kids.has(r.ppid)) kids.set(r.ppid, []); kids.get(r.ppid).push(r); });
  const tree = []; const walk = pid => (kids.get(pid) || []).forEach(r => { tree.push(r); walk(r.pid); });
  const me = rows.find(r => r.pid === rootPid); if (me) tree.push(me); walk(rootPid);
  const kind = c => /--type=renderer/.test(c) ? 'renderer' : /--type=gpu-process/.test(c) ? 'gpu' : /--type=/.test(c) ? 'other' : 'browser';
  const by = { browser: 0, renderer: 0, gpu: 0, other: 0 }; let maxRenderer = 0; const renderers = {};
  tree.forEach(r => { by[kind(r.cmd)] += r.kb; if (kind(r.cmd) === 'renderer') { maxRenderer = Math.max(maxRenderer, r.kb); renderers[r.pid] = r.kb; } });
  return { total: tree.reduce((a, r) => a + r.kb, 0), ...by, maxRenderer, renderers, procs: tree.length };
}

let EDIT_PORT = null;
function proxy(req, res, inject) {
  const up = httpRequest({ host: '127.0.0.1', port: EDIT_PORT, path: req.url, method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${EDIT_PORT}`, ...(req.headers.origin ? { origin: `http://127.0.0.1:${EDIT_PORT}` } : {}) } }, r => {
    const isPage = inject && /text\/html/.test(r.headers['content-type'] || '');
    requests++;
    if (!isPage) { res.writeHead(r.statusCode, r.headers); r.on('data', d => { servedBytes += d.length; }); r.pipe(res); return; }
    const chunks = []; r.on('data', d => chunks.push(d)); r.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8').replace(/<\/body>(?![\s\S]*<\/body>)/i, DRIVER + '</body>');
      servedBytes += Buffer.byteLength(body);
      const h = { ...r.headers }; delete h['content-length'];
      res.writeHead(r.statusCode, h); res.end(body);
    });
  });
  up.on('error', () => { try { res.writeHead(502); res.end(); } catch (e) {} });
  req.pipe(up);
}
const srv = createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); res.end(); return; }
  if (req.method === 'POST' && p.startsWith('/__mem/')) {
    let body = ''; req.on('data', d => { body += d; }); req.on('end', () => {
      let j = {}; try { j = JSON.parse(body || '{}'); } catch (e) {}
      if (p === '/__mem/step') { steps.push({ ...j, at: Date.now(), rss: chrome ? treeRss(chrome.pid) : null }); }
      if (p === '/__mem/done') doneInfo = j;
      if (p === '/__mem/boot' && bootBytes === null) { bootBytes = servedBytes; bootRequests = requests; }
      res.writeHead(204); res.end();
    });
    return;
  }
  if (EDIT) { const u = new URL(req.url, 'http://x'); return proxy(req, res, p === PAGE && !/[?&]dk=thumb/.test(u.search)); }
  const file = resolve(join(ROOT, p === '/' ? PAGE : p));
  if (!(file === ROOT || file.startsWith(ROOT + sep)) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  if (SLOW && p === SLOW.path && !SLOW.done) { SLOW.done = true; setTimeout(() => srv.emit('request', req, res), SLOW.ms); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  requests++;
  if (file === DECK) { const body = readFileSync(file, 'utf8').replace(/<\/body>/i, DRIVER + '</body>'); servedBytes += Buffer.byteLength(body); res.end(body); return; }
  servedBytes += statSync(file).size;
  createReadStream(file).pipe(res);
});

let editSrv = null;
if (EDIT) {
  EDIT_PORT = 21000 + Math.floor(Math.random() * 3000);
  editSrv = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '../edit/serve.mjs'), DECK, '--port', String(EDIT_PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, no) => { editSrv.stdout.on('data', d => { if (/http:\/\//.test(String(d))) ok(); }); editSrv.on('exit', c => no(new Error('edit server exited ' + c))); setTimeout(ok, 4000); });
}
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
const profile = mkdtempSync(join(tmpdir(), 'deck-mem-'));
chrome = spawn(CHROME, ['--headless=new', '--hide-scrollbars', '--window-size=1920,1080', '--enable-precise-memory-info',
  '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, `http://127.0.0.1:${port}${PAGE}${EDIT ? '?edit=1' : ''}`], { stdio: 'ignore' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { chrome.kill(); } catch (e) {} try { rmSync(profile, { recursive: true, force: true }); } catch (e) {} process.exit(130); });
const t0 = Date.now();
const sampler = setInterval(() => { const r = treeRss(chrome.pid); if (r) samples.push({ t: Date.now() - t0, ...r }); }, 250);
const limitMs = +opt('timeout', 15 * 60_000);
while (!doneInfo && Date.now() - t0 < limitMs && chrome.exitCode === null) await new Promise(r => setTimeout(r, 200));
clearInterval(sampler);
try { chrome.kill(); } catch (e) {}
if (editSrv) try { editSrv.kill(); } catch (e) {}
srv.close();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}

const MB = kb => (kb / 1024).toFixed(0);
if (!doneInfo) { console.log(`FAIL: the walk did not finish (${steps.length} stations reported)`); process.exit(1); }
if (doneInfo.error) { console.log('FAIL: ' + doneInfo.error); process.exit(1); }
console.log(`deck: ${DECK}`);
console.log(`stations walked: ${steps.filter(s => !s.overview).length - 1} (+ boot, + overview), dwell ${DWELL} ms, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log('  station   tree MB  renderer MB  gpu MB  JS heap MB  DOM nodes  <img>  live stations');
steps.forEach((s, k) => {
  if (k % 10 && k !== steps.length - 1 && !s.overview) return;
  const r = s.rss || {};
  console.log(`  ${(s.overview ? 'overview' : String(s.i + 1)).padStart(8)}  ${MB(r.total || 0).padStart(7)}  ${MB(r.maxRenderer || 0).padStart(11)}  ${MB(r.gpu || 0).padStart(6)}`
    + `  ${s.heap ? (s.heap / 1048576).toFixed(0).padStart(10) : '         -'}  ${String(s.nodes).padStart(9)}  ${String(s.imgs).padStart(5)}  ${String(s.live).padStart(13)}`);
});
const peak = k => Math.max(...samples.map(s => s[k] || 0));
const res = { stations: doneInfo.stations, peak_tree_mb: +MB(peak('total')), peak_renderer_mb: +MB(peak('maxRenderer')), peak_gpu_mb: +MB(peak('gpu')),
  final_tree_mb: +MB(samples.at(-1)?.total || 0), peak_heap_mb: +(Math.max(...steps.map(s => s.heap || 0)) / 1048576).toFixed(0),
  peak_dom_nodes: Math.max(...steps.map(s => s.nodes || 0)), peak_live_stations: Math.max(...steps.map(s => s.live || 0)),
  flight_p95_ms: (() => { const v = steps.map(s => s.p95).filter(x => x != null).sort((a, b) => a - b); return v.length ? +v[Math.floor(v.length / 2)].toFixed(1) : null; })(),
  long_frames: steps.reduce((a, s) => a + (s.long || 0), 0),
  boot_painted_images: steps[0] ? steps[0].painted : null,
  boot_mount_heard: steps[0] ? !!steps[0].heardMount : null,
  nav: (() => { const n = steps.find(s => s.nav); if (!n) return null;
    const at = samples.filter(x => x.t <= n.at - t0); const pr = at.length ? Object.values(at.at(-1).renderers || {}) : [];
    return { items: n.navItems, iframes: n.frames, live_stations: n.live, dom_nodes: n.nodes, heap_mb: n.heap ? +(n.heap / 1048576).toFixed(0) : null,
             tree_mb: n.rss ? +MB(n.rss.total) : null, page_renderer_mb: pr.length ? +MB(Math.max(...pr)) : null }; })(),
  boot_mb: +((bootBytes || 0) / 1048576).toFixed(1), boot_requests: bootRequests, total_mb: +(servedBytes / 1048576).toFixed(1),
  // every station the walk ARRIVED on held its content (an empty frame on arrival is a broken mount)
  unmounted_arrivals: steps.filter(s => !s.overview && !s.mounted).map(s => s.key || s.i + 1) };
// the deck's own renderer: the one renderer whose peak is highest (managed browsers run extension
// renderers in the same tree; summing or taking any renderer would measure them, not the deck)
{ const series = {}; samples.forEach(s => Object.entries(s.renderers || {}).forEach(([pid, kb]) => { (series[pid] ||= []).push(kb); }));
  const page = Object.keys(series).sort((a, b) => Math.max(...series[b]) - Math.max(...series[a]))[0];
  res.page_renderer_peak_mb = page ? +MB(Math.max(...series[page])) : null;
  res.page_renderer_final_mb = page ? +MB(series[page].at(-1)) : null; }
if (res.unmounted_arrivals.length) console.log(`FAIL: arrived on station(s) with no content: ${res.unmounted_arrivals.join(', ')}`);
if (res.nav) console.log(`NAVIGATOR (all ${res.nav.items} slides scrolled into view): ${res.nav.iframes} iframes, ${res.nav.live_stations} live stations, ${res.nav.dom_nodes} DOM nodes, page renderer ${res.nav.page_renderer_mb} MB, tree ${res.nav.tree_mb} MB`);
console.log(`LOAD: ${res.boot_mb} MB in ${res.boot_requests} requests by the load event (whole walk: ${res.total_mb} MB)` +
  (res.boot_painted_images != null ? `; ${res.boot_painted_images} image(s) painted by then` : ''));
console.log(`PAGE RENDERER: peak ${res.page_renderer_peak_mb} MB, final ${res.page_renderer_final_mb} MB · flights: median p95 frame ${res.flight_p95_ms} ms, ${res.long_frames} frames over 50 ms`);
console.log(`PEAK: tree ${res.peak_tree_mb} MB · renderer ${res.peak_renderer_mb} MB · gpu ${res.peak_gpu_mb} MB · JS heap ${res.peak_heap_mb} MB · DOM nodes ${res.peak_dom_nodes} · live stations ${res.peak_live_stations}/${res.stations}`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ ...res, steps, samples }, null, 1));
if (res.unmounted_arrivals.length) process.exit(1);
if (MAX_MB !== null && res.page_renderer_peak_mb > MAX_MB) { console.log(`FAIL: page renderer peak ${res.page_renderer_peak_mb} MB > ${MAX_MB} MB`); process.exit(1); }
