// Live window in a real browser, measured with components/verify/memory.mjs: no remote debugging, so
// it runs on managed machines that refuse it. Skipped without Chrome unless REQUIRE_BROWSER=1 (CI).
// Each case is paired with the bug put back, so the assertion is shown to be able to fail.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

async function walk(file, extra = []) {
  const out = join(mkdtempSync(join(tmpdir(), 'deck-mem-')), 'mem.json');
  const r = await runAsync(process.execPath, [join(ROOT, 'components/verify/memory.mjs'), file, '--dwell', '250', '--json', out, ...extra],
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

describe('live window (memory.mjs walks every station)', { concurrency: 3, skip }, () => {
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

  // A streamed station that is missing (404) or never answers (held past the engine's 10 s abort) must
  // not freeze the deck: the frame says it could not load, and the walk goes on to the last station.
  test('a streamed station that fails or hangs does not hold the camera', async () => {
    const file = packed(heavyDeck(6), true), dir = dirname(file);
    rmSync(join(dir, 'stations', 'P02.html'));
    const out = join(dir, 'mem.json');
    const r = await runAsync(process.execPath, [join(ROOT, 'components/verify/memory.mjs'), file, '--dwell', '100',
      '--slow', 'stations/P04.html=30000', '--json', out], { timeout: 300_000, env: { DECK_BROWSER: chrome } });
    const m = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(r.code, 1, r.out);                                            // memory.mjs flags the empty arrivals
    assert.deepEqual([...m.unmounted_arrivals].sort(), ['P02', 'P04']);
    assert.equal(m.steps.filter(s => !s.overview).length, 6 + 6 + 1);         // boot + every station: the walk finished
  });

  // A scene whose mount(el) throws breaks that station's own setup, never the deck: every station is
  // still reached and holds its markup (the RIGEL scene is the template's diagram).
  test('a scene mount that throws does not break navigation', async () => {
    const throwing = s => once(s, '  sceneRegistry.diagram = {\n', "  sceneRegistry.diagram = {\n    mount(el) { throw new Error('boom'); },\n");
    const { code, out, m } = await walk(heavyDeck(4, throwing));
    assert.equal(code, 0, out);
    assert.deepEqual(m.unmounted_arrivals, []);
    assert.equal(m.steps.filter(s => !s.overview).length, 6 + 4 + 1);
  });

  test('a deck:mount listener in a later script hears the first station', async () => {
    const { code, out, m } = await walk(heavyDeck(2));
    assert.equal(code, 0, out);
    assert.equal(m.boot_mount_heard, true);
  });

  // Edit mode used to mount every station and give its navigator one live copy of the deck per slide
  // (an iframe each): 68 iframes, 1.2 GB and second-long frames on a 68-slide deck. Now: posters.
  test('edit mode: the navigator, scrolled end to end, holds posters, not decks', async () => {
    const file = heavyDeck(PHOTOS);
    const r = await runAsync(process.execPath, [join(ROOT, 'components/verify/memory.mjs'), file, '--edit', '--dwell', '150', '--json', file + '.json'],
      { timeout: 300_000, env: { DECK_BROWSER: chrome } });
    const m = JSON.parse(readFileSync(file + '.json', 'utf8'));
    assert.equal(r.code, 0, r.out);
    assert.equal(m.nav.items, TOTAL);
    assert.equal(m.nav.iframes, 0, r.out);
    assert.ok(m.nav.live_stations <= 5, r.out);
    assert.ok(m.peak_live_stations <= 5, r.out);
  });

  // The mechanism behind "long decks stay light": three times the stations, nearly the same memory HELD.
  // Without a GPU (CI), Chrome keeps every decoded photo in purgeable cache until memory pressure, so
  // the resident size grows with photos SEEN; where it can, the test applies critical pressure and
  // compares what is left. Where it cannot (remote debugging refused), it compares the peaks.
  test('memory held stays near flat as the deck grows (21 vs 66 stations)', async () => {
    const [small, big] = await Promise.all([walk(heavyDeck(15), ['--pressure']), walk(heavyDeck(60), ['--pressure'])]);
    assert.equal(small.code, 0, small.out); assert.equal(big.code, 0, big.out);
    const p = r => r.m.pressure && r.m.pressure.available ? `, after pressure ${r.m.pressure.after_mb}` : '';
    console.log(`# memory flat: 21 stations peak ${small.m.page_renderer_peak_mb} MB${p(small)}; 66 stations peak ${big.m.page_renderer_peak_mb} MB${p(big)}`);
    assert.ok(big.m.peak_live_stations <= 5, big.out);
    if (small.m.pressure && small.m.pressure.available && big.m.pressure && big.m.pressure.available) {
      // what stays after pressure may grow a little per station (each file's bytes in Chrome's resource
      // cache, the frame, the rail dot), never by a decoded photo (8 MB here) per station seen
      const perStation = (big.m.pressure.after_mb - small.m.pressure.after_mb) / 45;
      assert.ok(perStation < 2.5, `held memory grows ${perStation.toFixed(1)} MB per station (a decoded photo is 8 MB)`);
    } else {
      assert.ok(big.m.page_renderer_peak_mb < small.m.page_renderer_peak_mb * 1.4,
        `21 stations: ${small.m.page_renderer_peak_mb} MB, 66 stations: ${big.m.page_renderer_peak_mb} MB`);
    }
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
