#!/usr/bin/env node
// COMPONENT · edit/serve — the edit-mode dev server. Serves a deck and makes it WRITABLE.
//   node components/edit/serve.mjs deck/index.html [--port 4800] [--author "Name"]
//   (bun works too: bun components/edit/serve.mjs deck/index.html)
// WHAT  · Serves the deck's folder on 127.0.0.1, injects the edit layer (edit.js/edit.css)
//         into the deck page ON THE WIRE — the file on disk never carries edit code — and
//         writes every edit back to the source HTML and the sidecar (index.review.json).
//         Edit mode stays OFF until ?edit=1 or Ctrl+Shift+E; see references/edit.md.
// WHY A SERVER · a browser cannot write the file, and an edit only the browser knows about is
//         lost on reload and invisible to the agent. No server, no edit mode: file:// and
//         GitHub Pages serve the deck exactly as before.
// LIVE  · watches the folder: an agent's change to the deck reloads the page (keeping the
//         station), a change to the sidecar re-renders comments and replies in place.
// SAFETY · localhost + same-origin only: 127.0.0.1, a loopback Host header, and writes only as
//         same-origin JSON POSTs (see the http section and references/edit.md).

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, watch, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename, extname, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as S from './source.mjs';
import * as R from './sidecar.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const deckArg = args.find((a, i) => !a.startsWith('--') && !(i && args[i - 1].startsWith('--')));
if (!deckArg || !existsSync(deckArg)) { console.error('usage: serve.mjs <deck.html> [--port 4800] [--author "Name"]'); process.exit(1); }
const DECK = resolve(deckArg), ROOT = dirname(DECK), PAGE = basename(DECK), SIDE = R.sidecarPath(DECK);
// A packed or streamed deck (components/stream/pack.mjs) is a publishing output: its stations sit inside
// <template> or in other files, so edits would address the wrong markup. Edit the source; pack again.
{ const src = readFileSync(DECK, 'utf8');
  if (S.stations(src).some(st => st.el.attrs['data-src'] !== undefined || /^\s*<template\b[^>]*\bdata-station/i.test(S.inner(src, st.el)))) {
  console.error('this deck is packed or streamed (pack.mjs output): edit its source deck, then pack again'); process.exit(1);
} }
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = +opt('port', 4800);
const AUTHOR = opt('author') || (() => { try { return execSync('git config user.name', { cwd: ROOT }).toString().trim(); } catch { return ''; } })() || process.env.USER || 'author';

const hash = s => createHash('sha1').update(s).digest('hex').slice(0, 12);
const readDeck = () => readFileSync(DECK, 'utf8');
// Our own writes must not echo back as "someone changed the file" — remember what we wrote.
let wroteDeck = hash(readDeck()), wroteSide = existsSync(SIDE) ? hash(readFileSync(SIDE, 'utf8')) : '';

function writeDeck(html) { R.writeAtomic(DECK, html); wroteDeck = hash(html); }
function saveSide(d) { wroteSide = hash(R.save(DECK, d)); }

// One writer at a time, across processes: every action runs inside the sidecar's lock (shared
// with review.mjs) and gets the sidecar freshly READ inside it. A malformed sidecar throws
// there, BEFORE the deck is touched. Then the deck is written, then the sidecar; if the
// sidecar cannot be saved the deck is put back, so disk never holds an edit the log lacks.
const locked = fn => R.withLock(DECK, () => fn(R.load(DECK)));
function commit(d, html, prev) {
  if (html != null) writeDeck(html);
  try { saveSide(d); } catch (e) { if (html != null) writeDeck(prev); throw e; }
}

// Back-fill: a sidecar written before the deck had keys records stations by id only. While
// that id still names a keyed station, add its key now, so the record survives the next
// renumber. Done once at start, under the lock; a sidecar that does not parse is left alone
// (the layer reports it).
function backfillKeys() {
  if (!existsSync(SIDE)) return;
  try {
    locked(d => {
      const list = S.stations(readDeck());
      let n = 0;
      for (const r of [...d.comments, ...d.edits]) {
        if (!r || r.stationKey || typeof r.station !== 'string') continue;
        const st = list.find(s => s.id === r.station);
        if (st && st.key) { r.stationKey = st.key; n++; }
      }
      if (n) { commit(d); console.log(`  sidecar  added data-key to ${n} older record(s)`); }
    });
  } catch (e) { console.error(`  sidecar  ${e.message}`); }
}
backfillKeys();

/* ---------- posters: one small still per station, for the navigator ----------
   The navigator used to embed a live copy of the WHOLE deck per slide (an iframe each), so scrolling
   it built N decks in one tab: 1.2 GB and second-long frames on a 68-slide deck. A poster is a PNG
   that headless Chrome renders from `?still=1&dk=thumb#id` (no remote debugging), cached on disk by
   a hash of what can change it: the station's own markup and the deck around the stations (CSS,
   scripts). Editing one station re-renders that station's poster only. Two renders at a time. */
const POSTER_W = 640, POSTER_H = 360, POSTER_DIR = join(tmpdir(), 'deckadence-posters', hash(DECK));
const CHROME = [process.env.DECK_BROWSER, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(existsSync);
/** id → poster hash, for every station in `html`. The shell is the deck with every station emptied. */
function posterKeys(html, list = S.stations(html)) {
  let shell = html;
  for (const st of [...list].reverse()) shell = shell.slice(0, st.el.openEnd) + shell.slice(st.el.closeStart);
  const sh = hash(shell);
  return Object.fromEntries(list.map(st => [st.id, hash(sh + html.slice(st.el.start, st.el.end))]));
}
const posterJobs = new Map(); let posterRunning = 0; const posterQueue = [];
function renderPoster(id, h) {
  const file = join(POSTER_DIR, h + '.png');
  if (existsSync(file)) return Promise.resolve(file);
  if (posterJobs.has(h)) return posterJobs.get(h);
  const job = new Promise(done => {
    const run = () => {
      posterRunning++;
      mkdirSync(POSTER_DIR, { recursive: true });
      const tmp = file + '.' + process.pid + '.png', profile = mkdtempSync(join(tmpdir(), 'deck-poster-'));
      const p = spawn(CHROME, ['--headless=new', '--hide-scrollbars', `--window-size=${POSTER_W},${POSTER_H}`, `--user-data-dir=${profile}`,
        '--virtual-time-budget=4000', `--screenshot=${tmp}`, `http://127.0.0.1:${PORT}/${encodeURIComponent(PAGE)}?still=1&dk=thumb#${encodeURIComponent(id)}`], { stdio: 'ignore' });
      let last = -1;    // a managed Chrome may linger after writing: stop it once the PNG is stable
      const poll = setInterval(() => { const n = existsSync(tmp) ? statSync(tmp).size : -1; if (n > 0 && n === last) p.kill(); last = n; }, 300);
      const guard = setTimeout(() => p.kill(), 60_000);
      p.on('exit', () => {
        clearInterval(poll); clearTimeout(guard); rmSync(profile, { recursive: true, force: true });
        try { if (existsSync(tmp)) R.writeAtomic(file, readFileSync(tmp)); rmSync(tmp, { force: true }); } catch (e) {}
        posterRunning--; posterJobs.delete(h); done(existsSync(file) ? file : null);
        const next = posterQueue.shift(); if (next) next();
      });
    };
    posterRunning < 2 ? run() : posterQueue.push(run);
  });
  posterJobs.set(h, job);
  return job;
}

/* ---------- state the layer needs ---------- */
function state() {
  const html = readDeck();
  const tree = S.parse(html);
  let review, reviewError = null;
  try { review = R.load(DECK); }
  catch (e) { reviewError = e.message; review = { format: R.FORMAT, deck: PAGE, comments: [], edits: [] }; }
  return { deck: PAGE, author: AUTHOR, version: hash(html),
           order: (list => { const ph = posterKeys(html, list); return list.map(s => ({ id: s.id, key: s.key, name: s.name, poster: ph[s.id] })); })(S.stations(html, tree)),
           posters: !!CHROME,
           map: S.editMap(html, tree), review, reviewError };
}

/* ---------- actions ---------- */
const actions = {
  // { key, base, html, selector, version } — one editable unit's new inner HTML
  text: b => locked(d => {
    const html = readDeck();
    const r = S.applyText(html, b.key, b.base, b.html);
    if (r.error) return { status: r.status || 422, body: { error: r.error } };
    if (r.unchanged) return { body: { ok: true, unchanged: true } };
    d.edits.push({ id: R.nextId('e', d.edits), kind: 'text', at: R.now(), author: AUTHOR, station: r.station,
                   ...(r.stationKey ? { stationKey: r.stationKey } : {}), key: b.key, selector: b.selector ? String(b.selector) : null, before: r.before, after: r.after });
    commit(d, r.html, html);
    // the station's whole new markup, so the engine remounts it with the edit (live window), and its
    // new poster hash, so the navigator shows the edit
    const list = S.stations(r.html), st = S.findStation(list, { station: r.station, stationKey: r.stationKey || null });
    return { body: { ok: true, html: r.after, version: hash(r.html), station: st && st.id,
                     inner: st ? S.inner(r.html, st.el) : null, poster: st ? posterKeys(r.html, list)[st.id] : null } };
  }),
  // { order: [ids] } — reorder + staircase relayout, ids stay stable
  reorder: b => locked(d => {
    const html = readDeck();
    const r = S.reorder(html, Array.isArray(b.order) ? b.order : []);
    if (r.error) return { status: 422, body: { error: r.error } };
    if (r.before.join() === r.after.join()) return { body: { ok: true, unchanged: true } };
    d.edits.push({ id: R.nextId('e', d.edits), kind: 'reorder', at: R.now(), author: AUTHOR, before: r.before, after: r.after,
                   ...(r.keyed ? { beforeKeys: r.beforeKeys, afterKeys: r.afterKeys } : {}) });
    commit(d, r.html, html);
    return { body: { ok: true } };
  }),
  // { station, stationKey?, at:{x,y}, anchor:{selector,text}, text } — the station is looked
  // up in the deck on disk and recorded by BOTH its id and its data-key (the key is the
  // address that survives a reorder; the id keeps old tools and keyless decks working).
  comment: b => locked(d => {
    if (!b.station || !String(b.text || '').trim()) return { status: 422, body: { error: 'a comment needs a station and text' } };
    const st = S.findStation(S.stations(readDeck()), { station: String(b.station), stationKey: b.stationKey ? String(b.stationKey) : null });
    if (!st) return { status: 422, body: { error: `no station ${b.stationKey || b.station} in the deck` } };
    const c = { id: R.nextId('c', d.comments), station: st.id, ...(st.key ? { stationKey: st.key } : {}),
                at: { x: Math.round(+b.at?.x || 0), y: Math.round(+b.at?.y || 0) },
                anchor: b.anchor && b.anchor.selector ? { selector: String(b.anchor.selector), text: String(b.anchor.text || '').slice(0, 120),
                  ...(b.anchor.offset ? { offset: { x: +b.anchor.offset.x || 0, y: +b.anchor.offset.y || 0 } } : {}) } : null,
                text: String(b.text).trim(), author: AUTHOR, created: R.now(), resolved: false, replies: [] };
    d.comments.push(c); commit(d);
    return { body: { ok: true, comment: c } };
  }),
  // { comment, text } — the human answers in the thread
  reply: b => locked(d => {
    const c = R.findComment(d, b.comment);
    if (!c || !String(b.text || '').trim()) return { status: 422, body: { error: 'no such comment, or empty reply' } };
    c.replies ||= [];
    c.replies.push({ id: `${c.id}.r${c.replies.length + 1}`, author: AUTHOR, role: 'human', created: R.now(), text: String(b.text).trim() });
    commit(d); return { body: { ok: true } };
  }),
  // { comment, resolved: bool }
  resolve: b => locked(d => {
    const c = R.findComment(d, b.comment);
    if (!c) return { status: 404, body: { error: 'no such comment' } };
    c.resolved = !!b.resolved;
    if (c.resolved) { c.resolvedBy = AUTHOR; c.resolvedAt = R.now(); } else { delete c.resolvedBy; delete c.resolvedAt; }
    commit(d); return { body: { ok: true } };
  }),
  // { reply, choice: apply|keep|other, text } — a decision on an agent's proposal. "apply"
  // with a patch writes the source now; the decision is recorded either way, so the agent
  // reads the outcome on its next turn without asking. A proposal is decided ONCE: a second
  // decision (a double click, a second tab) is refused with 409 and changes nothing.
  decide: b => locked(d => {
    const f = R.findReply(d, b.reply);
    if (!f || !f.reply.proposal) return { status: 404, body: { error: 'no such proposal' } };
    if (f.reply.decision) return { status: 409, body: { error: 'this proposal was already decided', decision: f.reply.decision } };
    if (!['apply', 'keep', 'other'].includes(b.choice)) return { status: 422, body: { error: 'choice must be apply, keep or other' } };
    if (b.choice === 'other' && !String(b.text || '').trim()) return { status: 422, body: { error: '"something else" needs a note for the agent' } };
    const dec = { choice: b.choice, by: AUTHOR, at: R.now() };
    if (b.text) dec.text = String(b.text).trim();
    let reload = false, html = null, prev = null;
    const patch = f.reply.proposal.patch;
    if (b.choice === 'apply' && patch && typeof patch.find === 'string') {
      prev = readDeck();
      // patch.station (an id OR a key) retargets it; otherwise the comment's station, by key first
      const ref = patch.station || patch.stationKey ? { station: patch.station, stationKey: patch.stationKey } : f.comment;
      const r = S.applyPatch(prev, ref, patch.find, patch.replace ?? '');
      if (r.error) { dec.applied = false; dec.error = r.error; }
      else {
        html = r.html; dec.applied = true; reload = true;
        d.edits.push({ id: R.nextId('e', d.edits), kind: 'patch', at: R.now(), author: AUTHOR, station: r.station.id,
                       ...(r.station.key ? { stationKey: r.station.key } : {}), reply: f.reply.id, before: patch.find, after: patch.replace ?? '' });
      }
    }
    f.reply.decision = dec;
    commit(d, html, prev);
    return { body: { ok: true, decision: dec, reload } };
  }),
};

/* ---------- live channel (SSE) ---------- */
const clients = new Set();
const send = (ev, data = {}) => { for (const res of clients) res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); };
let debounce = null;
watch(ROOT, (_, file) => {
  if (file && ![PAGE, basename(SIDE)].includes(String(file))) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    try {
      const h = hash(readDeck());
      if (h !== wroteDeck) { wroteDeck = h; send('deck', { version: h }); }
      const sh = existsSync(SIDE) ? hash(readFileSync(SIDE, 'utf8')) : '';
      if (sh !== wroteSide) { wroteSide = sh; send('review', {}); }
    } catch { /* mid-rename: the next event settles it */ }
  }, 90);
}).on('error', e => console.error('[deckadence edit] watch:', e.message));
setInterval(() => send('ping'), 25000);

/* ---------- http ----------
 * Security model: localhost + same-origin only. The server binds 127.0.0.1, answers only to
 * a Host naming this port on a loopback name (DNS rebinding), and takes a write only as a
 * same-origin POST with Content-Type: application/json (CSRF — a page elsewhere can send
 * text/plain or a form cross-origin without a preflight, never JSON with a local Origin). */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4', '.ico': 'image/x-icon' };
const NOCACHE = { 'Cache-Control': 'no-cache' };  // never cache an asset longer than its document
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', ...NOCACHE }); res.end(JSON.stringify(body)); };
const MAX_BODY = 1 << 20;
const HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'].flatMap(h => [`${h}:${PORT}`, ...(PORT === 80 ? [h] : [])]));
const ORIGINS = new Set([...HOSTS].map(h => 'http://' + h));

function inject(html) {
  const tag = '<link rel="stylesheet" href="/__deck/edit.css">\n<script src="/__deck/edit.js"></script>\n';
  const at = html.toLowerCase().lastIndexOf('</body>');
  return at < 0 ? html + tag : html.slice(0, at) + tag + html.slice(at);
}

/** Why a write is refused, or null: it must come from a page this server served. */
function refuseWrite(req) {
  const origin = req.headers.origin;
  if (origin !== undefined ? !ORIGINS.has(origin) : req.headers['sec-fetch-site'] !== 'same-origin')
    return [403, 'cross-origin write refused — edit mode only takes writes from its own page'];
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return [415, 'writes must be Content-Type: application/json'];
  if (+req.headers['content-length'] > MAX_BODY) return [413, 'body too large'];
  return null;
}

function handle(req, res) {
  if (!HOSTS.has(String(req.headers.host || '').toLowerCase())) { res.writeHead(421, { 'Content-Type': 'text/plain' }); return res.end('unknown host'); }
  const url = new URL(req.url, 'http://x');
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400, { 'Content-Type': 'text/plain' }); return res.end('bad path'); }
  if (p.includes('\0')) { res.writeHead(400, { 'Content-Type': 'text/plain' }); return res.end('bad path'); }
  if (p.startsWith('/__deck/') && req.method === 'POST') {
    const act = Object.hasOwn(actions, p.slice(8)) && actions[p.slice(8)];
    if (!act) return json(res, 404, { error: 'no such action' });
    const no = refuseWrite(req);
    if (no) { res.setHeader('Connection', 'close'); json(res, no[0], { error: no[1] }); return req.resume(); }
    const chunks = []; let size = 0, over = false;
    req.on('data', c => {
      if (over) return;
      size += c.length;
      if (size > MAX_BODY) { over = true; res.setHeader('Connection', 'close'); json(res, 413, { error: 'body too large' }); res.on('finish', () => req.destroy()); }
      else chunks.push(c);
    });
    req.on('end', () => {
      if (over) return;
      let b;
      try { b = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return json(res, 400, { error: 'bad json' }); }
      if (!b || typeof b !== 'object' || Array.isArray(b)) return json(res, 400, { error: 'body must be a JSON object' });
      try { const r = act(b); json(res, r.status || 200, r.body); if (!r.status) send('review', { by: 'layer' }); }
      catch (e) { json(res, 500, { error: e.message }); }
    });
    return;
  }
  if (p === '/__deck/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', ...NOCACHE });
    res.write('retry: 1500\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
  }
  if (p === '/__deck/state') return json(res, 200, state());
  if (p.startsWith('/__deck/poster/') && req.method === 'GET') {
    const id = p.slice('/__deck/poster/'.length), h = url.searchParams.get('h') || '';
    if (!CHROME) return json(res, 404, { error: 'no Chrome to render posters (set DECK_BROWSER)' });
    if (!/^[0-9a-f]{12}$/.test(h) || !S.stations(readDeck()).some(st => st.id === id)) return json(res, 404, { error: 'no such poster' });
    renderPoster(id, h).then(file => {
      if (!file) return json(res, 503, { error: 'poster render failed' });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=31536000, immutable' });   // the hash is in the URL
      res.end(readFileSync(file));
    });
    return;
  }
  if (p === '/__deck/edit.js' || p === '/__deck/edit.css') {
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)], ...NOCACHE });
    return res.end(readFileSync(join(HERE, basename(p))));
  }
  if (p === '/') { res.writeHead(302, { Location: '/' + encodeURIComponent(PAGE) + url.search }); return res.end(); }
  // Static: the deck's folder, minus dotfiles and dot-directories (.git, .env, ...).
  if (p.split('/').some(seg => seg.startsWith('.'))) { res.writeHead(404); return res.end('not found'); }
  const file = resolve(ROOT, '.' + p);
  if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403); return res.end(); }
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
  const body = file === DECK ? inject(readDeck()) : readFileSync(file);
  res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', ...NOCACHE });
  res.end(body);
}

// No single request may take the server down: whatever one throws becomes that request's 500.
createServer((req, res) => {
  req.on('error', () => {}); res.on('error', () => {});
  try { handle(req, res); }
  catch (e) {
    console.error('[deckadence edit]', e);
    if (!res.headersSent) json(res, 500, { error: e.message }); else res.destroy();
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`deckadence edit server · ${PAGE} · author "${AUTHOR}"`);
  console.log(`  present  http://127.0.0.1:${PORT}/${PAGE}`);
  console.log(`  edit     http://127.0.0.1:${PORT}/${PAGE}?edit=1   (or Ctrl+Shift+E)`);
  console.log(`  sidecar  ${SIDE}`);
});
