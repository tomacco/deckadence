// Live window in a real browser, measured with components/verify/memory.mjs: no remote debugging, so
// it runs on managed machines that refuse it. Skipped without Chrome unless REQUIRE_BROWSER=1 (CI).
// Each case is paired with the bug put back, so the assertion is shown to be able to fail.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ROOT, once, runAsync, findChrome } from './helpers.mjs';
import { heavyDeck } from './heavy-deck.mjs';
import { pack } from '../components/stream/pack.mjs';

const chrome = findChrome();
if (!chrome && process.env.REQUIRE_BROWSER) throw new Error('REQUIRE_BROWSER is set but no Chrome was found');
const skip = !chrome && 'no Chrome/Chromium found (set DECK_BROWSER)';
const PHOTOS = 20;                                   // + the template's 6 = 26 stations
const TOTAL = PHOTOS + 6;

async function walk(file) {
  const out = join(mkdtempSync(join(tmpdir(), 'deck-mem-')), 'mem.json');
  const r = await runAsync(process.execPath, [join(ROOT, 'components/verify/memory.mjs'), file, '--dwell', '250', '--json', out],
    { timeout: 300_000, env: { DECK_BROWSER: chrome } });
  let m = null; try { m = JSON.parse(readFileSync(out, 'utf8')); } catch (e) {}
  return { ...r, m };
}
const allLive = s => once(s, '<html lang="en">', '<html lang="en" data-live="all">');
const noPaintGate = s => once(s, '  body:not(.deck-ready) #world { visibility: hidden; }', '');
function packed(file, split) {
  const res = pack(readFileSync(file, 'utf8'), { split });
  const dir = dirname(file), name = split ? 'index.stream.html' : 'index.packed.html';
  if (split) { mkdirSync(join(dir, 'stations'), { recursive: true }); res.fragments.forEach(f => writeFileSync(join(dir, 'stations', f.name), f.content)); }
  writeFileSync(join(dir, name), res.html);
  return join(dir, name);
}

describe('live window (memory.mjs walks every station)', { concurrency: true, skip }, () => {
  test('only the stations near the camera are in the DOM, and every arrival has its content', async () => {
    const { code, out, m } = await walk(heavyDeck(PHOTOS));
    assert.equal(code, 0, out);
    assert.ok(m.peak_live_stations <= 5, `peak live stations ${m.peak_live_stations} (window is ±2)\n${out}`);
    assert.deepEqual(m.unmounted_arrivals, []);
  });

  test('the bug put back: data-live="all" keeps every station live, and the same assertion fails', async () => {
    const { code, out, m } = await walk(heavyDeck(PHOTOS, allLive));
    assert.equal(code, 0, out);
    assert.equal(m.peak_live_stations, TOTAL);
  });

  // The engine's script arriving late (anime.js from a slow CDN) is when the browser paints what the parser
  // has: without the gate that is every station stacked at 0,0, every photo painted and decoded at once.
  test('the paint gate: nothing is painted while the engine is late (and without it, every photo is)', async () => {
    const slow = f => runAsync(process.execPath, [join(ROOT, 'components/verify/memory.mjs'), f, '--dwell', '100',
      '--slow', 'vendor/anime.umd.min.js=2500', '--json', f + '.json'], { timeout: 300_000, env: { DECK_BROWSER: chrome } })
      .then(r => ({ ...r, m: JSON.parse(readFileSync(f + '.json', 'utf8')) }));
    const [gated, open] = await Promise.all([slow(heavyDeck(PHOTOS)), slow(heavyDeck(PHOTOS, noPaintGate))]);
    assert.equal(gated.code, 0, gated.out); assert.equal(open.code, 0, open.out);
    assert.equal(gated.m.boot_painted_images, 0, gated.out);                  // the start station has no photo
    assert.ok(open.m.boot_painted_images >= PHOTOS / 2, `ungated painted ${open.m.boot_painted_images} photos at load\n${open.out}`);
  });

  for (const split of [false, true]) {
    test(`a ${split ? 'streamed (--split)' : 'packed'} deck loads almost nothing up front and mounts every station`, async () => {
      const src = heavyDeck(PHOTOS);
      const [authored, pk] = await Promise.all([walk(src), walk(packed(src, split))]);
      assert.equal(pk.code, 0, pk.out);
      assert.deepEqual(pk.m.unmounted_arrivals, []);
      assert.ok(pk.m.peak_live_stations <= 5, pk.out);
      assert.ok(pk.m.boot_mb < 1, `packed boot ${pk.m.boot_mb} MB`);
      assert.ok(authored.m.boot_mb > 5, `authored boot ${authored.m.boot_mb} MB (the photos load with the page)`);
    });
  }
});
