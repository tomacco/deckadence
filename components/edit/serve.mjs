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

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, watch } from 'node:fs';
import { resolve, dirname, basename, extname, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as S from './source.mjs';
import * as R from './sidecar.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const deckArg = args.find((a, i) => !a.startsWith('--') && !(i && args[i - 1].startsWith('--')));
if (!deckArg || !existsSync(deckArg)) { console.error('usage: serve.mjs <deck.html> [--port 4800] [--author "Name"]'); process.exit(1); }
const DECK = resolve(deckArg), ROOT = dirname(DECK), PAGE = basename(DECK), SIDE = R.sidecarPath(DECK);
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = +opt('port', 4800);
const AUTHOR = opt('author') || (() => { try { return execSync('git config user.name', { cwd: ROOT }).toString().trim(); } catch { return ''; } })() || process.env.USER || 'author';

const hash = s => createHash('sha1').update(s).digest('hex').slice(0, 12);
const readDeck = () => readFileSync(DECK, 'utf8');
// Our own writes must not echo back as "someone changed the file" — remember what we wrote.
let wroteDeck = hash(readDeck()), wroteSide = existsSync(SIDE) ? hash(readFileSync(SIDE, 'utf8')) : '';

// One writer at a time: edits, comments and decisions all read-modify-write two files.
let chain = Promise.resolve();
const serial = fn => (chain = chain.then(fn, fn));

function writeDeck(html) { R.writeAtomic(DECK, html); wroteDeck = hash(html); }
function saveSide(d) { wroteSide = hash(R.save(DECK, d)); }

/* ---------- state the layer needs ---------- */
function state() {
  const html = readDeck();
  const tree = S.parse(html);
  return { deck: PAGE, author: AUTHOR, version: hash(html),
           order: S.stations(html, tree).map(s => ({ id: s.id, name: s.name })),
           map: S.editMap(html, tree), review: R.load(DECK) };
}

/* ---------- actions ---------- */
const actions = {
  // { key, base, html, selector, version } — one editable unit's new inner HTML
  text(b) {
    const html = readDeck();
    const r = S.applyText(html, b.key, b.base, b.html);
    if (r.error) return { status: r.status || 422, body: { error: r.error } };
    if (r.unchanged) return { body: { ok: true, unchanged: true } };
    writeDeck(r.html);
    const d = R.load(DECK);
    d.edits.push({ id: R.nextId('e', d.edits), kind: 'text', at: R.now(), author: AUTHOR, station: r.station,
                   key: b.key, selector: b.selector || null, before: r.before, after: r.after });
    saveSide(d);
    return { body: { ok: true, html: r.after, version: hash(r.html) } };
  },
  // { order: [ids] } — reorder + staircase relayout, ids stay stable
  reorder(b) {
    const html = readDeck();
    const r = S.reorder(html, b.order || []);
    if (r.error) return { status: 422, body: { error: r.error } };
    if (r.before.join() === r.after.join()) return { body: { ok: true, unchanged: true } };
    writeDeck(r.html);
    const d = R.load(DECK);
    d.edits.push({ id: R.nextId('e', d.edits), kind: 'reorder', at: R.now(), author: AUTHOR, before: r.before, after: r.after });
    saveSide(d);
    return { body: { ok: true } };
  },
  // { station, at:{x,y}, anchor:{selector,text}, text }
  comment(b) {
    if (!b.station || !String(b.text || '').trim()) return { status: 422, body: { error: 'a comment needs a station and text' } };
    const d = R.load(DECK);
    const c = { id: R.nextId('c', d.comments), station: b.station,
                at: { x: Math.round(+b.at?.x || 0), y: Math.round(+b.at?.y || 0) },
                anchor: b.anchor && b.anchor.selector ? { selector: String(b.anchor.selector), text: String(b.anchor.text || '').slice(0, 120),
                  ...(b.anchor.offset ? { offset: { x: +b.anchor.offset.x || 0, y: +b.anchor.offset.y || 0 } } : {}) } : null,
                text: String(b.text).trim(), author: AUTHOR, created: R.now(), resolved: false, replies: [] };
    d.comments.push(c); saveSide(d);
    return { body: { ok: true, comment: c } };
  },
  // { comment, text } — the human answers in the thread
  reply(b) {
    const d = R.load(DECK), c = R.findComment(d, b.comment);
    if (!c || !String(b.text || '').trim()) return { status: 422, body: { error: 'no such comment, or empty reply' } };
    c.replies ||= [];
    c.replies.push({ id: `${c.id}.r${c.replies.length + 1}`, author: AUTHOR, role: 'human', created: R.now(), text: String(b.text).trim() });
    saveSide(d); return { body: { ok: true } };
  },
  // { comment, resolved: bool }
  resolve(b) {
    const d = R.load(DECK), c = R.findComment(d, b.comment);
    if (!c) return { status: 404, body: { error: 'no such comment' } };
    c.resolved = !!b.resolved;
    if (c.resolved) { c.resolvedBy = AUTHOR; c.resolvedAt = R.now(); } else { delete c.resolvedBy; delete c.resolvedAt; }
    saveSide(d); return { body: { ok: true } };
  },
  // { reply, choice: apply|keep|other, text } — a decision on an agent's proposal. "apply"
  // with a patch writes the source now; the decision is recorded either way, so the agent
  // reads the outcome on its next turn without asking.
  decide(b) {
    const d = R.load(DECK), f = R.findReply(d, b.reply);
    if (!f || !f.reply.proposal) return { status: 404, body: { error: 'no such proposal' } };
    if (!['apply', 'keep', 'other'].includes(b.choice)) return { status: 422, body: { error: 'choice must be apply, keep or other' } };
    if (b.choice === 'other' && !String(b.text || '').trim()) return { status: 422, body: { error: '"something else" needs a note for the agent' } };
    const dec = { choice: b.choice, by: AUTHOR, at: R.now() };
    if (b.text) dec.text = String(b.text).trim();
    let reload = false;
    const patch = f.reply.proposal.patch;
    if (b.choice === 'apply' && patch && typeof patch.find === 'string') {
      const html = readDeck();
      const r = S.applyPatch(html, patch.station || f.comment.station, patch.find, patch.replace ?? '');
      if (r.error) { dec.applied = false; dec.error = r.error; }
      else {
        writeDeck(r.html); dec.applied = true; reload = true;
        d.edits.push({ id: R.nextId('e', d.edits), kind: 'patch', at: R.now(), author: AUTHOR, station: patch.station || f.comment.station,
                       reply: f.reply.id, before: patch.find, after: patch.replace ?? '' });
      }
    }
    f.reply.decision = dec;
    saveSide(d);
    return { body: { ok: true, decision: dec, reload } };
  },
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
});
setInterval(() => send('ping'), 25000);

/* ---------- http ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4', '.ico': 'image/x-icon' };
const NOCACHE = { 'Cache-Control': 'no-cache' };  // never cache an asset longer than its document
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', ...NOCACHE }); res.end(JSON.stringify(body)); };

function inject(html) {
  const tag = '<link rel="stylesheet" href="/__deck/edit.css">\n<script src="/__deck/edit.js"></script>\n';
  const at = html.toLowerCase().lastIndexOf('</body>');
  return at < 0 ? html + tag : html.slice(0, at) + tag + html.slice(at);
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  if (p === '/__deck/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', ...NOCACHE });
    res.write('retry: 1500\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
  }
  if (p === '/__deck/state') { try { return json(res, 200, state()); } catch (e) { return json(res, 500, { error: e.message }); } }
  if (p === '/__deck/edit.js' || p === '/__deck/edit.css') {
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)], ...NOCACHE });
    return res.end(readFileSync(join(HERE, basename(p))));
  }
  if (p.startsWith('/__deck/') && req.method === 'POST') {
    const name = p.slice(8), act = actions[name];
    if (!act) return json(res, 404, { error: 'no such action' });
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => serial(() => {
      let b; try { b = JSON.parse(raw || '{}'); } catch { return json(res, 400, { error: 'bad json' }); }
      try { const r = act(b); json(res, r.status || 200, r.body); if (!r.status) send('review', { by: 'layer' }); }
      catch (e) { json(res, 500, { error: e.message }); }
    }));
    return;
  }
  if (p === '/') { res.writeHead(302, { Location: '/' + encodeURIComponent(PAGE) + url.search }); return res.end(); }
  const file = resolve(ROOT, '.' + p);
  if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403); return res.end(); }
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
  const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, ...NOCACHE });
  res.end(file === DECK ? inject(readDeck()) : readFileSync(file));
}).listen(PORT, '127.0.0.1', () => {
  console.log(`deckadence edit server · ${PAGE} · author "${AUTHOR}"`);
  console.log(`  present  http://127.0.0.1:${PORT}/${PAGE}`);
  console.log(`  edit     http://127.0.0.1:${PORT}/${PAGE}?edit=1   (or Ctrl+Shift+E)`);
  console.log(`  sidecar  ${SIDE}`);
});
