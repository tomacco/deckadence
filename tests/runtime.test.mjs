// The shared runtime: every deck in the repo runs the same engine files, install.mjs keeps a deck on its
// pinned major, check.mjs refuses a deck whose runtime is missing or of another major, and the single-file
// export carries the runtime inside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ROOT, TEMPLATE, LANDING, read, scratchDeck, once, run, check } from './helpers.mjs';
import { pack } from '../components/stream/pack.mjs';
import { loaderFor, pinOf } from '../components/runtime/runtime.mjs';

const install = (file, ...args) => run(process.execPath, [join(ROOT, 'components/runtime/install.mjs'), file, ...args]);

test('the landing runs the current runtime, byte for byte (a stale copy fails)', () => {
  const r = install(LANDING, '--check');
  assert.equal(r.code, 0, r.out);
  const drifted = install(scratchDeck(LANDING, undefined, { js: s => s + '\n// a hand edit' }), '--check');
  assert.equal(drifted.code, 1, drifted.out);
  assert.match(drifted.out, /FAIL deckadence\/deckadence\.js differs/);
});

test('install puts the runtime beside a deck and pins it; the deck file is otherwise untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deck-install-')), file = join(dir, 'index.html');
  const unpinned = once(read(TEMPLATE), ' data-deckadence="2"', '');
  writeFileSync(file, unpinned);
  assert.equal(check(file).code, 1);                                         // nothing installed yet
  const r = install(file);
  assert.equal(r.code, 0, r.out);
  assert.equal(read(file), read(TEMPLATE));                                   // only the pin was added
  assert.equal(read(join(dir, 'deckadence/deckadence.js')), read(join(dirname(TEMPLATE), 'deckadence/deckadence.js')));
  assert.equal(check(file).code, 0, check(file).out);
});

test('install refuses another major unless --major says the deck was ported', () => {
  const file = scratchDeck(TEMPLATE, s => once(s, 'data-deckadence="2"', 'data-deckadence="1"'));
  const r = install(file);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /pinned to runtime 1/);
  assert.equal(pinOf(read(file)), '1');
  const m = install(file, '--major');
  assert.equal(m.code, 0, m.out);
  assert.equal(pinOf(read(file)), '2');
});

test('check.mjs FAILS a deck whose runtime is missing, or of a major it is not pinned to', () => {
  const missing = join(mkdtempSync(join(tmpdir(), 'deck-bare-')), 'index.html');
  copyFileSync(TEMPLATE, missing);
  const a = check(missing);
  assert.equal(a.code, 1, a.out);
  assert.match(a.out, /FAIL runtime: deckadence\/deckadence\.js is missing/);
  const b = check(scratchDeck(TEMPLATE, s => once(s, 'data-deckadence="2"', 'data-deckadence="3"')));
  assert.equal(b.code, 1, b.out);
  assert.match(b.out, /FAIL runtime: the deck is pinned to runtime 3 but runs 2\./);
});

test('the single-file export inlines the runtime: alone in a folder, it still passes every gate', () => {
  const src = scratchDeck(TEMPLATE, s => s.replace('https://cdn.jsdelivr.net/npm/animejs@4.4.1/dist/bundles/anime.umd.min.js', 'vendor/anime.umd.min.js'));
  const { html, inlined } = pack(read(src), { load: loaderFor(src) });
  assert.deepEqual(inlined.sort(), ['deckadence/deckadence.css', 'deckadence/deckadence.js', 'vendor/anime.umd.min.js']);
  const noComments = html.replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(noComments, /<script[^>]*\bsrc=/);
  assert.doesNotMatch(noComments, /<link[^>]*rel="stylesheet"[^>]*href="(?!https:)/);
  const alone = join(mkdtempSync(join(tmpdir(), 'deck-single-')), 'talk.html');
  writeFileSync(alone, html);
  const r = check(alone);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ok runtime 2\.\d+\.\d+, pinned to 2 \(inline\)/);
  // and a split deck keeps the runtime linked: it is served with its folder
  assert.match(pack(read(src), { split: true, load: loaderFor(src) }).html, /<script src="deckadence\/deckadence\.js"><\/script>/);
});

test('pack refuses a single-file export whose runtime is not beside the deck', () => {
  const bare = join(mkdtempSync(join(tmpdir(), 'deck-bare-')), 'index.html');
  copyFileSync(TEMPLATE, bare);
  assert.throws(() => pack(read(bare), { load: loaderFor(bare) }), /cannot inline deckadence\/deckadence\.css, deckadence\/deckadence\.js/);
});
