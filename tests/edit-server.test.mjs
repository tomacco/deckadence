// edit/serve.mjs + edit/review.mjs end to end: a real server on a scratch copy of the template,
// driven over HTTP the way the browser layer drives it, and read back the way the agent does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, scratchDeck, read, run } from './helpers.mjs';
import * as S from '../components/edit/source.mjs';

const deck = scratchDeck();
let port, srv, base;
const freePort = () => new Promise(r => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const post = (action, body, headers = {}) => fetch(`${base}/__deck/${action}`, {
  method: 'POST', body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', Origin: base, ...headers } });

before(async () => {
  port = await freePort(); base = `http://127.0.0.1:${port}`;
  srv = spawn(process.execPath, [join(ROOT, 'components/edit/serve.mjs'), deck, '--port', String(port), '--author', 'ci'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(`${base}/__deck/state`); return; } catch { await new Promise(r => setTimeout(r, 100)); } }
  throw new Error('edit server did not start');
});
after(() => srv.kill());

test('serves the deck with the edit layer injected on the wire, not on disk', async () => {
  const page = await (await fetch(`${base}/index.html`)).text();
  assert.match(page, /\/__deck\/edit\.js/);
  assert.doesNotMatch(read(deck), /__deck/);
});

test('a text edit is written back into the HTML and logged in the sidecar', async () => {
  const html = read(deck);
  const u = S.editMap(html).s1.find(x => /Your big idea/.test(x.text));
  const r = await post('text', { key: u.key, base: u.html, html: u.html.replace('big', 'bold') });
  assert.equal(r.status, 200, await r.text());
  assert.match(read(deck), /Your bold idea/);
  const side = JSON.parse(read(deck.replace(/\.html$/, '.review.json')));
  assert.equal(side.edits.at(-1).kind, 'text');
});

// The navigator shows POSTERS, keyed by a hash of what can change them. An edit to one station must
// change that station's poster key only, and hand back the station's new markup for the engine.
test('posters: one key per station; a text edit changes only its own station\'s key and returns its markup', async () => {
  const before = await (await fetch(`${base}/__deck/state`)).json();
  assert.equal(before.order.length, 6);
  assert.ok(before.order.every(o => /^[0-9a-f]{12}$/.test(o.poster)), JSON.stringify(before.order));
  assert.equal(new Set(before.order.map(o => o.poster)).size, 6);
  const u = S.editMap(read(deck)).s4.find(x => /Three moves/.test(x.text));
  const r = await post('text', { key: u.key, base: u.html, html: u.html.replace('Three', 'Four') });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.equal(body.station, 's4');
  assert.match(body.inner, /Four moves/);
  const after_ = await (await fetch(`${base}/__deck/state`)).json();
  const changed = after_.order.filter((o, k) => o.poster !== before.order[k].poster).map(o => o.id);
  assert.deepEqual(changed, ['s4']);
  assert.equal(body.poster, after_.order.find(o => o.id === 's4').poster);
});

test('posters: the route renders a PNG (or says why not), and refuses unknown stations and malformed keys', async () => {
  const st = await (await fetch(`${base}/__deck/state`)).json(), o = st.order[0];
  assert.equal((await fetch(`${base}/__deck/poster/${o.id}?h=nothex`)).status, 404);
  assert.equal((await fetch(`${base}/__deck/poster/s99?h=${o.poster}`)).status, 404);
  const r = await fetch(`${base}/__deck/poster/${o.id}?h=${o.poster}`);
  if (st.posters) {
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(r.headers.get('content-type'), 'image/png');
    const png = Buffer.from(await r.arrayBuffer());
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
  } else assert.equal(r.status, 404);
});

test('a write from another origin is refused', async () => {
  const r = await post('comment', { station: 's2', text: 'hi' }, { Origin: 'http://evil.example' });
  assert.equal(r.status, 403);
});

test('a comment from the page reaches the agent, and the agent can reply and resolve', async () => {
  const r = await post('comment', { station: 's2', text: 'Too loud?', at: { x: 100, y: 100 } });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  const { comment } = body;
  const status = run(process.execPath, [join(ROOT, 'components/edit/review.mjs'), deck, '--json']);
  assert.equal(status.code, 0, status.out);
  assert.ok(JSON.parse(status.out).open.some(c => c.id === comment.id), status.out);
  const reply = run(process.execPath, [join(ROOT, 'components/edit/review.mjs'), deck, 'reply', comment.id],
    { input: JSON.stringify({ text: 'Tightened.', proposal: { summary: 'shorter', patch: { find: 'claim <span', replace: 'point <span' } } }) });
  assert.equal(reply.code, 0, reply.out);
  const resolved = run(process.execPath, [join(ROOT, 'components/edit/review.mjs'), deck, 'resolve', comment.id]);
  assert.equal(resolved.code, 0, resolved.out);
  const side = JSON.parse(read(deck.replace(/\.html$/, '.review.json')));
  const c = side.comments.find(x => x.id === comment.id);
  assert.equal(c.resolved, true);
  assert.equal(c.replies.at(-1).role, 'agent');
});

test('a reorder keeps the deck valid', async () => {
  const r = await post('reorder', { order: ['s1', 's3', 's2', 's4', 's5', 's6'] });
  assert.equal(r.status, 200, await r.text());
  const g = run(process.execPath, [join(ROOT, 'components/verify/check.mjs'), deck]);
  assert.equal(g.code, 0, g.out);
});
