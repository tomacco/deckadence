#!/usr/bin/env node
// Deckadence flash probe: Tier 2 of references/pitfalls.md. Real browser, no deps (Node 22+ or Bun).
//   node components/verify/flash.mjs deck/index.html
//   DECK_BROWSER=/path/to/chrome node components/verify/flash.mjs deck/index.html
// Exits nonzero when any station FLASHES: something the audience can see drawn in its finished
// state is then hidden again by the station's own reveal, and animates back in.
//
// WHY A PROBE AND NOT A SCREENSHOT: the flash lasts one flight, from a few hundred ms to about
// 1.7 s, and it is a TRANSITION (visible, then hidden, then visible). A still shot can't show
// it, and a timer sampling every 100 ms misses it too. This samples inside the page on every
// animation frame from departure to after arrival.
//
// What counts as visible, per element of the destination station, per frame:
//   · effective opacity (own × every ancestor up to the station) > .5
//   · on screen (its box intersects the viewport)
//   · a line inside a .clip mask: at least half of it inside the mask
//   · an SVG stroke using strokeDasharray: at least half drawn
//   · a box that is not scaled to nothing
//   (an element on an infinite animation, like a blinking caret, is skipped)
// Plus the station's text: typed text that is cleared (a typewriter reset) is a flash too.
// A FLASH is an element seen visible after departure and later hidden during the same visit.
//
// It walks the deck forward (first visits: the DOM rests in the FINAL state), then back
// (revisits: stations left mid-scene or finished). Each visit is sampled until 1.5 s after
// arrival.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';

const file = resolve(process.argv[2] || 'deck/index.html');
if (!existsSync(file)) { console.error('no such file:', file); process.exit(2); }
const ROOT = dirname(file), PAGE = basename(file);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- static server (no python dependency) ---------- */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(ROOT) || !(await stat(p)).isFile()) throw 0;
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(await readFile(p));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

/* ---------- browser ---------- */
const CANDIDATES = [process.env.DECK_BROWSER,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const BROWSER = CANDIDATES.find(existsSync);
if (!BROWSER) { console.error('no Chrome/Chromium/Edge found — set DECK_BROWSER'); process.exit(2); }
const DPORT = 9222 + Math.floor(Math.random() * 700);
const UDD = join(tmpdir(), `deck-flash-${process.pid}`);
const chrome = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${DPORT}`,
  `--user-data-dir=${UDD}`, '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
async function done(code) { try { chrome.kill(); } catch {} server.close(); await sleep(300); await rm(UDD, { recursive: true, force: true }).catch(() => {}); process.exit(code); }

let tabs = [];
for (let i = 0; i < 60 && !tabs.some(t => t.type === 'page'); i++) {
  try { tabs = await (await fetch(`http://127.0.0.1:${DPORT}/json`)).json(); } catch {}
  await sleep(200);
}
const page = tabs.find(t => t.type === 'page');
if (!page) { console.error('browser did not start'); await done(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  // the engine's own flash warnings: a reveal without priming, a scene without prep(el)
  if (m.method === 'Runtime.consoleAPICalled') {
    const txt = m.params.args.map(x => x.value ?? '').join(' ');
    if (txt.startsWith('[deckadence]')) errors.push(txt);
  }
};
const send = (method, params = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed');
  return r.result?.result?.value;
}

await send('Runtime.enable');
// headless reports prefers-reduced-motion: reduce, which shortens every flight; probe real timing
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${PAGE}` });
// wait for the engine + its fonts-ready boot
let ready = false;
for (let i = 0; i < 80 && !ready; i++) { await sleep(150); ready = await evaluate('!!(window.Deckadence && document.fonts.status === "loaded")').catch(() => false); }
if (!ready) { console.error('FAIL no window.Deckadence — the probe drives the deck through the engine API'); await done(1); }
await sleep(3500);   // let the first station's own reveal finish

/* ---------- in-page sampler ---------- */
await evaluate(`window.__flashProbe = function (to, settleMs) {
  const D = window.Deckadence, st = D.stations[to], root = st.el;
  const els = [root, ...root.querySelectorAll('*')].filter(e => !e.closest('script, style, defs'));
  const seen = new Map();                     // el -> { firstVisible, hiddenAt }
  let maxText = -1, textDrop = null;
  const W = innerWidth, H = innerHeight;
  // an element on an INFINITE animation (a blinking caret) blinks by design: no verdict
  const loops = e => e.getAnimations && e.getAnimations().some(a => a.effect && a.effect.getTiming().iterations === Infinity);
  function vis(e) {
    if (loops(e)) return -1;
    let o = 1;
    for (let n = e; n && n !== root.parentNode; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
      o *= parseFloat(cs.opacity);
    }
    if (o < .5) return 0;
    const r = e.getBoundingClientRect();
    if (r.width < 1 && r.height < 1 && !(e instanceof SVGGElement)) return 0;
    if (r.right < 0 || r.bottom < 0 || r.left > W || r.top > H) return -1;       // off screen: no verdict
    const clip = e.parentElement && e.parentElement.classList.contains('clip') && getComputedStyle(e.parentElement).overflow === 'hidden' ? e.parentElement : null;
    if (clip) {
      const c = clip.getBoundingClientRect();
      const inside = Math.max(0, Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top));
      if (r.height && inside / r.height < .5) return 0;
    }
    if (e instanceof SVGGeometryElement && e.style.strokeDasharray) {
      const dash = parseFloat(e.style.strokeDasharray), off = Math.abs(parseFloat(e.style.strokeDashoffset) || 0);
      if (dash > 0 && off / dash > .5) return 0;
    }
    return 1;
  }
  function label(e) {
    const c = typeof e.className === 'string' ? e.className : (e.className && e.className.baseVal) || '';
    return e.tagName.toLowerCase() + (c ? '.' + c.trim().split(/\\s+/).join('.') : '') +
      (e.textContent && e.textContent.trim() ? ' "' + e.textContent.trim().slice(0, 32) + '"' : '');
  }
  return new Promise(resolve => {
    const t0 = performance.now(); let arrived = null;
    D.goto(to);
    function frame() {
      const t = performance.now() - t0;
      for (const e of els) {
        const v = vis(e);
        if (v < 0) continue;
        const s = seen.get(e) || {};
        if (v === 1 && s.firstVisible == null) s.firstVisible = t;
        if (v === 0 && s.firstVisible != null && s.hiddenAt == null) s.hiddenAt = t;
        seen.set(e, s);
      }
      const len = (root.innerText || '').replace(/\\s+/g, '').length;
      if (len > maxText) maxText = len;
      else if (maxText > 20 && len < maxText * .85 && !textDrop) textDrop = { t, from: maxText, to: len };
      if (arrived == null && !D.isBusy()) arrived = t;
      if (arrived != null && t - arrived > settleMs) {
        // report only the OUTERMOST flashing elements (a hidden parent hides its children)
        const flashing = els.filter(e => { const s = seen.get(e); return s && s.hiddenAt != null; });
        const top = flashing.filter(e => !flashing.some(p => p !== e && p.contains(e)));
        resolve({ key: st.key || st.el.id, arrived: Math.round(arrived),
          flashes: top.map(e => ({ el: label(e), shownMs: Math.round(seen.get(e).hiddenAt - seen.get(e).firstVisible), hiddenAt: Math.round(seen.get(e).hiddenAt) })),
          textDrop });
        return;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
};`);

const n = await evaluate('Deckadence.stations.length');
const order = [...Array(n).keys()].slice(1).concat([...Array(n - 1).keys()].reverse());   // 1..n-1, then n-2..0
let bad = 0;
console.log(`flash probe · ${PAGE} · ${n} stations · forward then back`);
for (const [k, to] of order.entries()) {
  const pass = k < n - 1 ? 'fwd ' : 'back';
  const r = await evaluate(`__flashProbe(${to}, 1500)`);
  const lines = r.flashes.map(f => `      ${f.el}  (shown ${f.shownMs} ms, then hidden at ${f.hiddenAt} ms)`);
  if (r.textDrop) lines.push(`      text cleared: ${r.textDrop.from} → ${r.textDrop.to} chars at ${Math.round(r.textDrop.t)} ms`);
  if (lines.length) { bad++; console.log(`FAIL ${pass} → ${r.key}  (arrived ${r.arrived} ms)`); lines.slice(0, 8).forEach(l => console.log(l)); if (lines.length > 8) console.log(`      … ${lines.length - 8} more`); }
  else console.log(`  ok ${pass} → ${r.key}`);
  await sleep(2500);   // let the scene run on, so the next visit leaves a station mid- or post-scene
}
for (const e of new Set(errors)) { bad++; console.log('FAIL', e.startsWith('[deckadence]') ? e : 'page exception: ' + e.split('\n')[0]); }
console.log(bad ? `\n${bad} FLASH(ES): something was drawn finished, then hidden and replayed. Prime stations at departure (references/pitfalls.md trap 2).`
                : '\nno flashes');
await done(bad ? 1 : 0);
